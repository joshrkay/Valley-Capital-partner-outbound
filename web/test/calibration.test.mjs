// The Calibration page (PRD next-five E17-S5): reading the backtest's stored reports through the platform client, and the pure view.
// The reports are real: the engine's own backtest (src/backtest/) runs on the invented banks of test/backtest-kit.mjs, and the data
// folder goes into the fake Supabase REST API the way `outbound platform push` sends it. No network, no browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakePostgrest } from '../../test/postgrest-fake.mjs';
import { makeDir, put, config, placeholderBuybox } from '../../test/kit.mjs';
import { fakeFdic } from '../../test/fdic-fake.mjs';
import { btTables, btConfig, METROS, NOW, FROM, TO, SALES } from '../../test/backtest-kit.mjs';
import { platformClient } from '../../src/platform/client.mjs';
import { push } from '../../src/platform/move.mjs';
import { loadRules } from '../../src/rules.mjs';
import { runPanel } from '../../src/backtest/panel.mjs';
import { buildLabels } from '../../src/backtest/labels.mjs';
import { runBacktest, KNOWN_LIMITS } from '../../src/backtest/run.mjs';
import { calibrationOverview } from '../lib/calibration-ops.mjs';
import { calibrationPage, NO_REPORT } from '../lib/calibration-view.mjs';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..');
const URL_ = 'https://example-project.supabase.test';
const client = (fake) => platformClient({ url: URL_, key: 'anon-key', accessToken: 'user:pat@example.test', fetchImpl: fake.fetchImpl });

// The decided settings (2026-11-14) on the invented window: a bank holdout, horizons side by side, and two eras.
const base = loadRules();
const BT = btConfig({ holdoutFrom: undefined, holdout: { by: 'bank', share: 0.5, seed: 'test-seed' }, horizonsReported: [2, 4],
  eras: [{ id: 'early', label: 'Early', from: '2022-03-31', to: '2022-12-31' }, { id: 'late', label: 'Late', from: '2023-03-31', to: '2023-12-31' }] });
// The placeholder buy box (test/kit.mjs), so the report's PROVISIONAL line is tested whatever buybox.json ships.
const rules = { ...base, buybox: placeholderBuybox(), config: { ...config(), backtest: BT } };
const DAY1 = new Date('2026-11-14T12:00:00Z'), DAY2 = new Date('2026-11-15T09:00:00Z'), DAY3 = new Date('2026-11-16T10:00:00Z');

// A data folder with the panel and the labels, as `outbound backtest panel` and `labels` leave it. No report yet.
async function world() {
  const dir = makeDir();
  const f = fakeFdic(btTables());
  const p = await runPanel({ dir, metros: METROS, config: BT, lookbackQuarters: 8, from: FROM, to: TO, fetchImpl: f.fetchImpl, now: NOW, clock: () => NOW, sleep: async () => {} });
  assert.equal(p.outcome, 'ok');
  put(dir, 'sources/fdic/sales.json', SALES());
  assert.equal(buildLabels({ dir, config: rules.config, now: NOW, clock: () => NOW }).outcome, 'ok');
  return dir;
}
const altScoring = () => { const s = structuredClone(base.scoring); s.components.find((c) => c.id === 'creNoncurrentRatio').weight = 40; const p = join(makeDir(), 'alt-scoring.json'); writeFileSync(p, JSON.stringify(s)); return p; };
const bt = (dir, now, opts = {}) => runBacktest({ dir, rules, now, ...opts }).report;

// The folder goes into the platform whole, panel and labels included, so a test can see that the page never loads them.
async function platformWith(dir) {
  const fake = fakePostgrest();
  const c = client(fake);
  await push({ client: c, dir });
  fake.calls.length = 0;
  return { fake, c };
}
const docsBefore = (fake) => JSON.stringify([...fake.docs.entries()]) + JSON.stringify(fake.lines);

// Read-only, and narrow: only GETs, exact paths only (never a folder), never the panel or the labels.
function assertNarrowReadOnly(fake, before) {
  assert.ok(fake.calls.every((x) => x.method === 'GET'), `read-only: ${fake.calls.filter((x) => x.method !== 'GET').map((x) => x.path).join(', ')}`);
  for (const x of fake.calls) {
    assert.ok(['documents', 'log_lines'].includes(x.path), x.path);
    assert.ok(x.query.or && !/\*/.test(x.query.or), `exact paths only, never a folder: ${x.query.or}`);
    assert.doesNotMatch(x.query.or, /backtest\/(panel|labels)/, 'never the panel or the labels');
  }
  assert.equal(docsBefore(fake), before, 'nothing written');
  assert.equal(fake.jobs.length, 0, 'nothing queued');
}

const text = (v) => JSON.stringify(v);
const rowOf = (table, label) => table.rows.find((r) => r.label === label);

test('NO REPORT YET: the page says how to make one, from the command line, and loads only the run log', async () => {
  const empty = fakePostgrest();
  const data = await calibrationOverview(client(empty));
  assert.equal(data.report, null);
  assert.deepEqual(data.runs, []);
  const v = calibrationPage(data);
  assert.equal(v.report, null);
  assert.deepEqual(v.reports, []);
  assert.deepEqual(v.noReport, NO_REPORT);
  assert.deepEqual(v.noReport.steps.map((s) => s.command), ['outbound backtest panel', 'outbound backtest labels', 'outbound backtest run', 'outbound backtest report']);
  assert.match(v.noReport.intro, /command line/);
  assert.match(text(v.noReport), /outbound platform push/, 'how a report reaches the platform this page reads');
  assert.deepEqual(empty.calls.map((x) => x.query.or), ['(path.eq."backtest/runs.jsonl")', '(path.eq."backtest/runs.jsonl")']);

  // A panel and labels on the platform, but no run yet: still no report, and the panel is never read.
  const { fake, c } = await platformWith(await world());
  const before = docsBefore(fake);
  assert.equal((await calibrationOverview(c)).report, null);
  assertNarrowReadOnly(fake, before);
});

test('ONE REPORT: the headline by SEC-filer coverage and the metro subset, lead times, per component with counts, provenance and the known limits', async () => {
  const dir = await world();
  const r = bt(dir, DAY1);
  const { fake, c } = await platformWith(dir);
  const before = docsBefore(fake);
  const data = await calibrationOverview(c);
  assert.equal(data.report.hash, r.hash, 'the latest stored report');
  assert.deepEqual(data.report, JSON.parse(JSON.stringify(r)), 'read as stored, nothing recomputed');
  assertNarrowReadOnly(fake, before);
  assert.deepEqual([...new Set(fake.calls.map((x) => x.query.or))], ['(path.eq."backtest/runs.jsonl")', `(path.eq."backtest/runs.jsonl",path.eq."backtest/report-${r.hash}.json")`]);

  const v = calibrationPage(data);
  const rep = v.report;
  assert.equal(rep.hash, r.hash);
  assert.equal(rep.kind, 'Training');
  const res = r.results[0], h = res.headline, view = rep.results[0];

  // The headline: the distress-and-timing ranking only, every stratum with its counts.
  assert.match(view.headline.intro, /distress and timing points only/);
  assert.match(view.headline.intro, /fit is left out/);
  assert.deepEqual(view.headline.rows.map((x) => x.label), ['The training banks', 'With a confirmed SEC filer', 'Without one', 'The metro subset', 'With a confirmed SEC filer', 'Without one']);
  const all = view.headline.rows[0];
  const g = h.all.groups.topK, d = h.all.groups.tierADistress;
  assert.deepEqual(all.cells, [
    String(h.all.observations), `${h.all.labelledBanks} of ${h.all.banks}`, `${(h.all.baseRate * 100).toFixed(1)}% (${h.all.labelled} of ${h.all.observations})`,
    `${(g.yield * 100).toFixed(1)}% (${g.labelled} of ${g.observations})`, `${g.lift}×`, `${(g.captured * 100).toFixed(1)}% (${g.labelled} of ${h.all.labelled})`,
    `${(d.yield * 100).toFixed(1)}% (${d.labelled} of ${d.observations})`, `${d.lift}×`, `${(d.captured * 100).toFixed(1)}% (${d.labelled} of ${h.all.labelled})`,
    String(h.all.leadTime.median),
  ]);
  assert.match(text(view.headline.head), new RegExp(`Top ${BT.topK} by distress and timing`));
  assert.match(text(view.headline.head), new RegExp(`Distress at or above ${base.scoring.tiers.A.distress}`));
  for (const w of ['Base rate', 'Observed-label yield', 'Lift over the base rate', 'Share of observed labels captured', 'Median lead time']) assert.ok(text(view.headline.head).includes(w), w);
  assert.equal(view.headline.rows[1].cells[0], String(h.bySecFiler.withFiler.observations));
  assert.equal(view.headline.rows[2].cells[0], String(h.bySecFiler.withoutFiler.observations));
  assert.equal(view.headline.rows[3].cells[0], String(h.metro.all.observations));
  assert.ok(view.headline.notes.includes(h.bySecFiler.note), 'a coverage effect, not a scoring effect');
  assert.ok(view.headline.notes.includes(h.metro.note));
  assert.equal(view.metroSize, `The metro subset: ${h.metro.size.observations} bank-quarters, ${h.metro.size.banks} banks (a small sample).`);

  // Too few to tune on, with the count, below minLabels: the invented world has one or two labelled banks.
  assert.ok(h.all.labelledBanks < BT.minLabels);
  assert.equal(all.read, h.all.note);
  assert.match(all.read, /^too few to tune on \(\d+ labelled banks?, fewer than minLabels 20\)$/);
  for (const row of view.headline.rows) assert.match(row.read, /^too few to tune on \(\d+ labelled banks?/);

  // Lead times: the distribution of quarter-ends from first entering the top K to the label, per stratum.
  assert.deepEqual(view.leadTime.head, ['', '1 quarter', '2 quarters', '3 quarters', '4 quarters', `Not in the top ${BT.topK} within the horizon`, 'Labelled banks', 'Median']);
  assert.deepEqual(view.leadTime.rows[0].cells, [...Object.values(h.all.leadTime.distribution).map(String), String(h.all.leadTime.banks), String(h.all.leadTime.median)]);
  assert.equal(view.leadTime.rows.length, 6);

  // The eras beside the pooled figure, and the horizons side by side.
  assert.match(view.byEra.intro, /mixes eras/);
  assert.deepEqual(view.byEra.rows.map((x) => x.label), ['Early (2022-03-31 to 2022-12-31)', 'Late (2023-03-31 to 2023-12-31)']);
  assert.deepEqual(view.byHorizon.rows.map((x) => x.label), ['2', '4 (headline)']);

  // Per component: each component in scoring.json, scored above 0 against the rest, with counts.
  assert.deepEqual(view.components.rows.map((x) => x.label), base.scoring.components.map((x) => x.id));
  assert.match(view.components.intro, /Below minLabels \(20\) labelled banks, a rate says "too few to tune on", with its count/);
  const counts = (c) => [String(c.observations), String(c.labelled), { text: c.rate === null ? '–' : `${(c.rate * 100).toFixed(1)}%`, note: c.tooFewToTune ? `too few to tune on (${c.labelledBanks} labelled bank${c.labelledBanks === 1 ? '' : 's'})` : null }];
  res.components.forEach((comp, n) => assert.deepEqual(view.components.rows[n].cells, [comp.axis, String(comp.weight), ...counts(comp.scored), ...counts(comp.rest)], comp.id));
  assert.ok(view.components.rows.some((x) => x.cells[4].note?.startsWith('too few to tune on (')), 'a component below minLabels says so, with its count');
  const fitRow = view.components.rows.find((x) => x.cells[0] === 'fit');
  assert.match(fitRow.labelNote, /not tested/);

  // The all-axis tiers only in a table labelled context, which a _calibration note may never cite.
  assert.match(view.context.title, /^Context/);
  assert.equal(view.context.label, res.context.label);
  assert.match(view.context.label, /never cite/);
  assert.deepEqual(view.context.rows.map((x) => x.label), ['Tier A', 'Tier B', 'Untiered']);
  const { context, ...rest } = view;
  assert.doesNotMatch(text(rest), /all-axis|Tier A \(|Tier B|Untiered/, 'the all-axis tiers appear nowhere but the context table');

  // Provenance: the run, the hashes and run ids, and PROVISIONAL.
  const prov = Object.fromEntries(rep.provenance.map((x) => [x.label, x.value]));
  assert.equal(prov.Report, r.hash);
  assert.match(prov['Kind of run'], /^Training: training banks \(the held-out banks left out\)/);
  assert.match(prov['Holdout run'], /^No/);
  assert.match(prov.PROVISIONAL, /^Yes: the buy box still has placeholders/);
  assert.equal(prov['Scoring file'], `scoring.json (hash ${r.inputs.scoring[0].hash})`);
  assert.equal(prov['Buy box hash'], r.inputs.buyboxHash);
  assert.equal(prov['Panel run'], r.inputs.panelRunId);
  assert.equal(prov['Labels run'], `${r.inputs.labelsRunId}, complete through ${r.quarters.labelsAsOf}`);
  assert.match(prov.Holdout, /by bank, a share of 0\.5 chosen by the seed "test-seed"/);
  assert.ok(rep.banners.some((b) => /^PROVISIONAL\./.test(b.text)));

  // Label kinds, with disclosed_sale listed as unavailable rather than left out; the report's notes and words.
  assert.ok(rep.labelKinds.some((x) => /^disclosed_sale: unavailable/.test(x)));
  assert.deepEqual(rep.notes, r.notes);
  assert.deepEqual(rep.words, r.words);

  // The known limits, in the report's fixed text, word for word.
  assert.deepEqual(rep.limits, [...KNOWN_LIMITS]);
  assert.equal(rep.scoringJson, r.scoringJson);

  // The list of stored reports.
  assert.deepEqual(v.reports.map((x) => [x.hash, x.kind, x.shown, x.latest]), [[r.hash, 'Training', true, true]]);
  assert.equal(v.reports[0].href, `/calibration?report=${r.hash}`);
  assert.equal(v.reports[0].date, '2026-11-14 12:00 UTC');
});

test('A HOLDOUT REPORT: marked a holdout run, the one kind a _calibration note may cite; the list shows both runs, newest first', async () => {
  const dir = await world();
  const t = bt(dir, DAY1);
  const h = bt(dir, DAY2, { mode: 'holdout' });
  assert.equal(h.reusedHoldout, false);
  const { fake, c } = await platformWith(dir);
  const before = docsBefore(fake);
  const v = calibrationPage(await calibrationOverview(c));
  assertNarrowReadOnly(fake, before);
  assert.equal(v.report.hash, h.hash);
  assert.equal(v.report.kind, 'Holdout');
  const prov = Object.fromEntries(v.report.provenance.map((x) => [x.label, x.value]));
  assert.match(prov['Holdout run'], /^Yes: the held-out banks, scored once for this scoring file/);
  assert.match(prov['Holdout run'], /a _calibration note may cite/);
  assert.equal(v.report.results[0].headline.rows[0].label, 'The held-out banks');
  assert.ok(!v.report.banners.some((b) => /REUSED/.test(b.text)));
  assert.deepEqual(v.reports.map((x) => [x.hash, x.kind, x.shown, x.latest]), [[h.hash, 'Holdout', true, true], [t.hash, 'Training', false, false]]);
});

test('A REUSED HOLDOUT: a second scoring file on the same held-out banks is marked, naming the earlier report; a principal can open any stored report', async () => {
  const dir = await world();
  const t = bt(dir, DAY1);
  const h = bt(dir, DAY2, { mode: 'holdout' });
  const u = bt(dir, DAY3, { mode: 'holdout', scoringPaths: [altScoring()] });
  assert.equal(u.reusedHoldout, true);
  const { fake, c } = await platformWith(dir);
  const before = docsBefore(fake);
  const v = calibrationPage(await calibrationOverview(c));
  assert.equal(v.report.hash, u.hash);
  assert.equal(v.report.kind, 'Reused holdout');
  const reused = v.report.banners.find((b) => /^REUSED HOLDOUT\./.test(b.text));
  assert.ok(reused, 'a banner');
  assert.ok(reused.text.includes(h.hash), 'it names the report that scored these banks first');
  assert.match(reused.text, /should not cite/);
  const prov = Object.fromEntries(v.report.provenance.map((x) => [x.label, x.value]));
  assert.match(prov['Holdout run'], new RegExp(`^Yes, a REUSED HOLDOUT: these held-out banks were scored before with a different scoring file \\(report ${h.hash}\\)`));
  assert.deepEqual(v.reports.map((x) => [x.hash, x.kind, x.latest]), [[u.hash, 'Reused holdout', true], [h.hash, 'Holdout', false], [t.hash, 'Training', false]]);

  // Opening an older report by its hash loads that one report, and only it.
  fake.calls.length = 0;
  const older = calibrationPage(await calibrationOverview(c, { hash: t.hash }));
  assert.equal(older.report.hash, t.hash);
  assert.deepEqual(older.reports.map((x) => [x.hash, x.shown]), [[u.hash, false], [h.hash, false], [t.hash, true]]);
  assert.deepEqual([...new Set(fake.calls.map((x) => x.query.or))], [`(path.eq."backtest/runs.jsonl",path.eq."backtest/report-${t.hash}.json")`]);

  // A hash that is not one never reaches a path; one that is not stored says so.
  fake.calls.length = 0;
  const bad = calibrationPage(await calibrationOverview(c, { hash: '../panel/state' }));
  assert.equal(bad.report, null);
  assert.match(bad.notice, /is not a report hash/);
  assert.equal(bad.reports.length, 3, 'the list still shows');
  assert.ok(fake.calls.every((x) => x.query.or === '(path.eq."backtest/runs.jsonl")'), 'nothing but the run log is read');
  const gone = calibrationPage(await calibrationOverview(c, { hash: 'ffffffffffffffff' }));
  assert.equal(gone.report, null);
  assert.equal(gone.notice, 'Report ffffffffffffffff is not stored. Choose one from the list below.');
  assertNarrowReadOnly(fake, before);
});

test('ROLLING ORIGIN and COMPARE render too: the folds, and each scoring file\'s own headline', async () => {
  const dir = await world();
  const roll = bt(dir, DAY1, { mode: 'rolling' });
  const cmp = bt(dir, DAY2, { mode: 'compare', scoringPaths: [altScoring(), altScoring()] });
  const { c } = await platformWith(dir);
  const vr = calibrationPage(await calibrationOverview(c, { hash: roll.hash }));
  assert.equal(vr.report.kind, 'Rolling origin');
  assert.equal(vr.report.folds.rows.length, roll.folds.length);
  const vc = calibrationPage(await calibrationOverview(c, { hash: cmp.hash }));
  assert.equal(vc.report.kind, 'Compare (two scoring files)');
  assert.equal(vc.report.results.length, 2);
  assert.deepEqual(vc.report.results.map((x) => x.scoringHash), cmp.results.map((x) => x.scoring.hash));
});

test('WORDS: the rendered page never says "precision" or "recall", whatever the report', async () => {
  const dir = await world();
  const reports = [bt(dir, DAY1), bt(dir, DAY2, { mode: 'holdout' }), bt(dir, DAY3, { mode: 'holdout', scoringPaths: [altScoring()] }), bt(dir, DAY3, { mode: 'rolling' }),
    bt(dir, DAY3, { mode: 'compare', scoringPaths: [altScoring(), altScoring()] })];
  const { c } = await platformWith(dir);
  const pages = [calibrationPage(await calibrationOverview(client(fakePostgrest()))), calibrationPage({ report: null, runs: [], notice: null })];
  for (const r of reports) pages.push(calibrationPage(await calibrationOverview(c, { hash: r.hash })));
  for (const p of pages) assert.doesNotMatch(text(p), /precision|recall/i);
  // Every word the page shows comes from the view or the page itself: neither source holds them either.
  for (const f of ['app/calibration/page.jsx', 'lib/calibration-view.mjs', 'lib/calibration-ops.mjs']) assert.doesNotMatch(readFileSync(join(WEB, f), 'utf8'), /precision|recall/i, f);
});

test('the page is linked from Status with one line, and from the main navigation', () => {
  const status = readFileSync(join(WEB, 'app/status/page.jsx'), 'utf8');
  assert.equal(status.split('\n').filter((l) => l.includes('href="/calibration"')).length, 1);
  assert.match(readFileSync(join(WEB, 'app/layout.jsx'), 'utf8'), /<a href="\/calibration">Calibration<\/a>/);
  const page = readFileSync(join(WEB, 'app/calibration/page.jsx'), 'utf8');
  assert.doesNotMatch(page, /enqueue|unitOfWork|action=|'use server'/, 'the page runs nothing and offers no action');
});
