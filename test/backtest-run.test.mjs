// PRD E17-S3 and S4: the replay and the report. Invented banks only (test/backtest-kit.mjs); no network, no model.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { makeDir, put, config, REPO, PLACEHOLDER_UA, placeholderBuybox } from './kit.mjs';
import { fakeFdic } from './fdic-fake.mjs';
import { readJson, readJsonl, exists } from '../src/store.mjs';
import { loadRules } from '../src/rules.mjs';
import { contentHash, validateBuybox } from '../src/score.mjs';
import { LOADS, withUnitOfWork, snapshotFromDir, applyPlanToDir } from '../src/uow.mjs';
import { runPanel, backtestPaths } from '../src/backtest/panel.mjs';
import { buildLabels } from '../src/backtest/labels.mjs';
import { runBacktest, readReport, renderReport, summarize, KNOWN_LIMITS, validateCalibration } from '../src/backtest/run.mjs';
import { btTables, btConfig, METROS, NOW, FROM, TO, AS_OF, SALES } from './backtest-kit.mjs';

const base = loadRules();
const rulesWith = (over = {}, { scoring, buybox } = {}) => ({ ...base, config: { ...config(), backtest: btConfig(over) }, scoring: scoring ?? structuredClone(base.scoring), buybox: buybox ?? base.buybox, metros: base.metros });
const filledBuybox = () => ({ ...structuredClone(base.buybox), sectors: { include: ['hospitality', 'multifamily', 'retail'], shortTermRentalPortfolios: 'out' }, loanSize: { minUsd: 1000000, maxUsd: 25000000 }, statuses: ['non-performing'], lien: 'first', exclusions: ['ground-up construction'] });
const weighted = (id, w) => { const s = structuredClone(base.scoring); s.components.find((c) => c.id === id).weight = w; return s; };

async function world({ pulledAt = NOW, labelsConfig = { ...config(), backtest: btConfig() } } = {}) {
  const dir = makeDir();
  const f = fakeFdic(btTables());
  const r = await runPanel({ dir, metros: METROS, config: btConfig(), lookbackQuarters: 8, from: FROM, to: TO, fetchImpl: f.fetchImpl, now: pulledAt, clock: () => pulledAt, sleep: async () => {} });
  assert.equal(r.outcome, 'ok');
  put(dir, 'sources/fdic/sales.json', SALES());
  assert.equal(buildLabels({ dir, config: labelsConfig, now: pulledAt, clock: () => pulledAt }).outcome, 'ok');
  return dir;
}
// The labels' config with the SEC contact set: a [CONFIRM] placeholder, or an invented firm's.
const labelsWithSec = (userAgent) => { const c = { ...config(), backtest: btConfig() }; c.sec.userAgent = userAgent; return c; };
const run = (dir, opts = {}) => runBacktest({ dir, rules: opts.rules ?? rulesWith(), now: NOW, ...opts });
const head = (rep, i = 0) => rep.results[i].headline.all;

test('ONE SCORER: the backtest imports scoreBank and never copies it; a change to a component weight changes its output', async () => {
  const src = ['panel', 'labels', 'run'].map((m) => readFileSync(join(REPO, 'src', 'backtest', `${m}.mjs`), 'utf8')).join('\n');
  assert.match(src, /import \{[^}]*\bscoreBank\b[^}]*\} from '\.\.\/score\.mjs'/);
  for (const forked of [/function scoreBank/, /function tierFor/, /function component\(/, /weight \* Math\.min/]) assert.doesNotMatch(src, forked);
  const dir = await world();
  const a = run(dir);
  const b = run(dir, { rules: rulesWith({}, { scoring: weighted('creNoncurrentRatio', 40) }) });
  assert.notEqual(a.hash, b.hash);
  const pts = (rep) => rep.report.results[0].topByQuarter['2022-03-31'].map((x) => x.distress);
  assert.notDeepEqual(pts(a), pts(b), 'distress points move with the weight');
  assert.notEqual(a.report.inputs.scoring[0].hash, b.report.inputs.scoring[0].hash);
});

test('the replay runs each as-of quarter of the panel with the data known then; the training run leaves the declared holdout out', async () => {
  const dir = await world();
  const { report } = run(dir);
  assert.equal(report.mode, 'training');
  assert.equal(report.inputs.holdoutFrom, '2023-09-30');
  assert.deepEqual(report.quarters.evaluated, AS_OF.slice(0, 6));
  assert.deepEqual(report.quarters.holdout, AS_OF.slice(6));
  const byQ = Object.fromEntries(report.results[0].byQuarter.map((q) => [q.asOf, q]));
  assert.deepEqual(AS_OF.slice(0, 6).map((d) => byQ[d].scored), [6, 6, 6, 5, 5, 4]);
  assert.equal(byQ['2022-06-30'].knownQuarter, '20220331');
  assert.equal(byQ['2022-06-30'].sodYear, 2021);
  assert.throws(() => run(dir, { rules: rulesWith({ holdoutFrom: undefined }) }), /holdoutFrom/);
});

test('every output is PROVISIONAL while the buy box has placeholders; the hard filters run with the buy box as it stands', async () => {
  const dir = await world();
  const unfilled = placeholderBuybox();
  assert.ok(validateBuybox(unfilled).placeholders.length > 0);
  const p = run(dir, { rules: rulesWith({}, { buybox: unfilled }) });
  assert.equal(p.report.provisional, true);
  assert.match(readFileSync(p.paths.md, 'utf8'), /^# PROVISIONAL/);
  assert.match(summarize(p.report), /^PROVISIONAL/);
  const f = run(dir, { rules: rulesWith({}, { buybox: filledBuybox() }) });
  assert.equal(f.report.provisional, false);
  assert.doesNotMatch(readFileSync(f.paths.md, 'utf8'), /PROVISIONAL/);
});

test('each run records the hash of each scoring file, the buy box hash, and the run ids of the panel and the labels', async () => {
  const dir = await world();
  const alt = join(makeDir(), 'alt-scoring.json');
  writeFileSync(alt, JSON.stringify(weighted('earlyStageDelinquency', 30)));
  const r = run(dir, { scoringPaths: [alt] });
  const i = r.report.inputs;
  assert.deepEqual(i.scoring.map((s) => [s.path, s.hash]), [[alt, contentHash(weighted('earlyStageDelinquency', 30))]]);
  assert.equal(i.buyboxHash, contentHash(base.buybox));
  assert.equal(i.panelRunId, readJson(backtestPaths(dir).state).runId);
  assert.equal(i.labelsRunId, readJson(backtestPaths(dir).labels).runId);
  const line = readJsonl(backtestPaths(dir).runs).at(-1);
  for (const k of ['reportHash', 'scoring', 'buyboxHash', 'panelRunId', 'labelsRunId', 'holdoutFrom', 'mode']) assert.ok(k in line, k);
  assert.equal(line.reportHash, r.hash);
  assert.doesNotMatch(JSON.stringify(line), /Example/, 'counts and ids only');
});

test('--compare A B runs two scoring files side by side, on the training quarters only', async () => {
  const dir = await world();
  const a = join(makeDir(), 'a.json'); writeFileSync(a, JSON.stringify(base.scoring));
  const b = join(makeDir(), 'b.json'); writeFileSync(b, JSON.stringify(weighted('creNoncurrentYoY', 0)));
  const { report, paths } = run(dir, { mode: 'compare', scoringPaths: [a, b] });
  assert.equal(report.results.length, 2);
  assert.deepEqual(report.quarters.evaluated, AS_OF.slice(0, 6));
  assert.deepEqual(report.results.map((x) => x.scoring.hash), [contentHash(base.scoring), contentHash(weighted('creNoncurrentYoY', 0))]);
  assert.match(readFileSync(paths.md, 'utf8'), /Side by side/);
  assert.throws(() => run(dir, { mode: 'compare', scoringPaths: [a] }), /two scoring files/);
});

test('HOLDOUT: scored once with --holdout and recorded; a second holdout run with another scoring file is marked "reused holdout"', async () => {
  const dir = await world();
  const h1 = run(dir, { mode: 'holdout' });
  assert.deepEqual(h1.report.quarters.evaluated, AS_OF.slice(6));
  assert.equal(h1.report.reusedHoldout, false);
  assert.equal(readJsonl(backtestPaths(dir).holdout).length, 1);
  const again = run(dir, { mode: 'holdout' });
  assert.equal(again.report.reusedHoldout, false, 'the same scoring file again is the same holdout run');
  const alt = join(makeDir(), 'alt.json'); writeFileSync(alt, JSON.stringify(weighted('creOreoRatio', 20)));
  const h2 = run(dir, { mode: 'holdout', scoringPaths: [alt] });
  assert.equal(h2.report.reusedHoldout, true);
  assert.match(readFileSync(h2.paths.md, 'utf8'), /reused holdout/i);
  assert.throws(() => run(dir, { mode: 'holdout', scoringPaths: [alt, alt] }), /one scoring file/);
  // Moving the holdout after runs were made on another split is shown on the report.
  const moved = run(dir, { rules: rulesWith({ holdoutFrom: '2023-12-31' }) });
  assert.deepEqual(moved.report.holdoutMovedFrom, ['quarter:2023-09-30']);
  assert.match(readFileSync(moved.paths.md, 'utf8'), /The holdout moved/);
});

test('ROLLING ORIGIN is offered when the holdout holds fewer than minLabels labelled banks, and runs train-to-T, test T+1 to T+4', async () => {
  const dir = await world();
  const h = run(dir, { mode: 'holdout' });
  assert.equal(h.report.holdoutLabelledBanks < 20, true);
  assert.equal(h.report.rollingOffered, true);
  assert.match(readFileSync(h.paths.md, 'utf8'), /outbound backtest run --rolling/);
  const r = run(dir, { mode: 'rolling' });
  assert.equal(r.report.mode, 'rolling');
  assert.deepEqual(r.report.folds.map((f) => [f.trainTo, f.test]), [
    ['2022-03-31', AS_OF.slice(1, 5)], ['2022-06-30', AS_OF.slice(2, 6)], ['2022-09-30', AS_OF.slice(3, 7)], ['2022-12-31', AS_OF.slice(4, 8)]]);
});

test('REPORT: written to backtest/report-<hash>.json and .md; the same inputs give the same hash; `report` prints the summary', async () => {
  const dir = await world();
  const r = run(dir);
  assert.match(r.hash, /^[0-9a-f]{16}$/);
  assert.equal(r.paths.json, join(dir, 'backtest', `report-${r.hash}.json`));
  assert.ok(exists(r.paths.json) && exists(r.paths.md));
  assert.equal(run(dir).hash, r.hash);
  const copy = join(makeDir(), 'same-content.json'); writeFileSync(copy, JSON.stringify(base.scoring));
  assert.equal(run(dir, { scoringPaths: [copy] }).hash, r.hash, 'the hash follows the scoring file\'s content, not its path');
  assert.equal(readReport({ dir }).hash, r.hash, 'the latest report');
  assert.equal(readReport({ dir, hash: r.hash }).hash, r.hash);
  assert.match(summarize(readReport({ dir })), /Base rate/);
});

test('THE HEADLINE LEAVES OUT FIT: groups rank by distress and timing points only; the all-axis tiers are a separate context table', async () => {
  const dir = await world();
  const a = run(dir).report;
  for (const [asOf, top] of Object.entries(a.results[0].topByQuarter)) {
    const dt = top.map((x) => x.distress + x.timing);
    assert.deepEqual(dt, [...dt].sort((x, y) => y - x), asOf);
    assert.ok(top.length <= 2 && top.every((x) => x.distress + x.timing > 0));
  }
  // Every fit weight set to 0: the headline groups do not move; the context table (Tier A needs fit) does.
  const s = structuredClone(base.scoring);
  for (const c of s.components) if (c.axis === 'fit') c.weight = 0;
  const b = run(dir, { rules: rulesWith({}, { scoring: s }) }).report;
  const keys = (rep) => Object.fromEntries(Object.entries(rep.results[0].topByQuarter).map(([q, t]) => [q, t.map((x) => x.key)]));
  assert.deepEqual(keys(b), keys(a));
  assert.deepEqual(head(b).groups, head(a).groups);
  assert.notDeepEqual(b.results[0].context, a.results[0].context);
  assert.match(a.results[0].context.label, /context/i);
  assert.match(a.results[0].context.label, /never cite/);
  // The Tier A distress group: distress at or above the Tier A distress threshold.
  assert.equal(head(a).groups.tierADistress.threshold, base.scoring.tiers.A.distress);
});

test('THE FIGURES: base rate, observed-label yield, lift, share of observed labels captured, and lead time, by bank-quarter', async () => {
  const dir = await world();
  const h = head(run(dir).report);
  // 32 bank-quarters in the six training quarters; 202 is labelled at four of them (its failure), 203 at four (its assisted merger).
  assert.equal(h.observations, 32);
  assert.equal(h.labelled, 8);
  assert.equal(h.labelledBanks, 2);
  assert.equal(h.baseRate, 0.25);
  const top = h.groups.topK;
  assert.equal(top.k, 2);
  assert.equal(top.observations, 12);
  assert.equal(top.labelled, 8);
  assert.equal(top.yield, 0.6667);
  assert.equal(top.lift, 2.67);
  assert.equal(top.captured, 1);
  assert.deepEqual(h.leadTime.distribution, { 1: 0, 2: 0, 3: 0, 4: 2, 'not in the top K': 0 });
  assert.equal(h.leadTime.median, 4);
  // --horizon 1: a label counts only within one quarter of the as-of date.
  const one = head(run(dir, { horizon: 1 }).report);
  assert.equal(one.labelled, 2);
});

test('STRATA and the METRO SUBSET: every figure split by whether the bank has a confirmed SEC filer; the metro subset with its size', async () => {
  const dir = await world();
  put(dir, 'sources/edgar/filers.json', { 'fdic:202': { bank: 'fdic:202', ciks: { '0000990001': { status: 'confirmed', by: 'Pat Example', at: '2026-11-01T00:00:00Z' } } } });
  buildLabels({ dir, config: { ...config(), backtest: btConfig() }, now: NOW, clock: () => NOW });
  const res = run(dir).report.results[0].headline;
  assert.equal(res.bySecFiler.withFiler.observations, 5);
  assert.equal(res.bySecFiler.withoutFiler.observations, 27);
  assert.match(res.bySecFiler.note, /coverage effect, not a scoring effect/);
  assert.equal(res.metro.all.observations, 26, '204 has no branch in the metros');
  assert.match(res.metro.note, /small sample/);
  assert.ok(res.metro.bySecFiler.withFiler && res.metro.bySecFiler.withoutFiler);
});

test('PER COMPONENT: for each component, the labelled rate where it scored above zero against the rest, with counts', async () => {
  const dir = await world();
  const comps = run(dir).report.results[0].components;
  assert.deepEqual(comps.map((c) => c.id), base.scoring.components.map((c) => c.id));
  for (const c of comps) {
    assert.equal(c.scored.observations + c.rest.observations, 32, c.id);
    assert.ok('labelled' in c.scored && 'rate' in c.rest && c.axis, c.id);
  }
  const nc = comps.find((c) => c.id === 'creNoncurrentRatio');
  assert.equal(nc.scored.labelled, 8, 'every labelled bank-quarter had CRE noncurrent loans');
});

test('SMALL NUMBERS: below minLabels labelled banks a figure says "too few to tune on" with its count', async () => {
  const dir = await world();
  const { report, paths } = run(dir);
  assert.equal(head(report).tooFewToTune, true);
  assert.match(head(report).note, /too few to tune on/);
  assert.match(readFileSync(paths.md, 'utf8'), /too few to tune on \(2 labelled banks/);
  const many = head(run(dir, { rules: rulesWith({ minLabels: 2 }) }).report);
  assert.equal(many.tooFewToTune, false);
});

test('WORDS: never "precision" or "recall"; unlabelled banks are never called negatives; the known limits are stated in fixed text', async () => {
  const dir = await world();
  for (const mode of ['training', 'holdout', 'rolling']) {
    const { report, paths } = run(dir, { mode });
    const md = readFileSync(paths.md, 'utf8');
    const json = readFileSync(paths.json, 'utf8');
    for (const t of [md, json, summarize(report)]) assert.doesNotMatch(t, /precision|recall/i, mode);
    for (const l of KNOWN_LIMITS) { assert.ok(md.includes(l), l); assert.ok(report.limits.includes(l)); }
    let rest = md; for (const l of KNOWN_LIMITS) rest = rest.split(l).join('');
    assert.doesNotMatch(rest, /negative/i);
  }
  const all = KNOWN_LIMITS.join(' ');
  for (const re of [/amended/, /forced/, /fit axis is not tested/, /unlabelled/]) assert.match(all, re);
});

test('label kinds: what counted, and disclosed_sale listed as unavailable rather than left out', async () => {
  // While the SEC contact is a placeholder, the reasons name it (Q11).
  const dir = await world({ labelsConfig: labelsWithSec(PLACEHOLDER_UA.sec) });
  const { report, paths } = run(dir);
  assert.equal(report.labelKinds.disclosed_sale.status, 'unavailable');
  assert.match(report.labelKinds.disclosed_sale.reasons.join(' '), /Q11/);
  assert.equal(report.labelKinds.failure.status, 'on');
  assert.equal(report.labelKinds.merger.status, 'off');
  assert.match(readFileSync(paths.md, 'utf8'), /disclosed_sale: unavailable/);
  // With the contact filled and no confirmed filer, it is still listed as unavailable: it needs confirmed filers.
  const filled = run(await world({ labelsConfig: labelsWithSec('Invented Firm ops@invented-firm.test') }));
  assert.equal(filled.report.labelKinds.disclosed_sale.status, 'unavailable');
  assert.doesNotMatch(filled.report.labelKinds.disclosed_sale.reasons.join(' '), /Q11/);
  assert.match(filled.report.labelKinds.disclosed_sale.reasons.join(' '), /confirmed filer/);
  assert.match(readFileSync(filled.paths.md, 'utf8'), /disclosed_sale: unavailable/);
});

test('a horizon that runs past the labels\' date is flagged: those labels are incomplete', async () => {
  const dir = await world({ pulledAt: new Date('2024-06-30T00:00:00Z') });   // the labels' sources were last read on that date
  const { report } = run(dir, { mode: 'holdout' });
  assert.deepEqual(report.quarters.horizonIncomplete, ['2023-09-30', '2023-12-31']);
  assert.match(renderReport(report), /horizon runs past/);
});

test('NO NETWORK after S1 and S2, and IT NEVER WRITES scoring.json; a _calibration note names a report hash of the right form', async () => {
  const dir = await world();
  const repoScoring = createHash('sha256').update(readFileSync(join(REPO, 'scoring.json'))).digest('hex');
  const alt = join(makeDir(), 'alt.json'); writeFileSync(alt, JSON.stringify(base.scoring));
  const altBefore = readFileSync(alt, 'utf8');
  const saved = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('the backtest replay must not touch the network'); };
  try { for (const mode of ['training', 'holdout', 'rolling']) run(dir, { mode }); run(dir, { scoringPaths: [alt] }); } finally { globalThis.fetch = saved; }
  assert.equal(createHash('sha256').update(readFileSync(join(REPO, 'scoring.json'))).digest('hex'), repoScoring);
  assert.equal(readFileSync(alt, 'utf8'), altBefore);
  for (const m of ['panel', 'labels', 'run']) assert.doesNotMatch(readFileSync(join(REPO, 'src', 'backtest', `${m}.mjs`), 'utf8'), /writeJson\([^)]*scoring/);
  // The note a PR adds when it changes weights.
  assert.deepEqual(validateCalibration({ report: '0123456789abcdef', evaluation: 'holdout', by: 'Pat Example', on: '2026-12-01' }), []);
  assert.match(validateCalibration({ report: 'report-xyz', evaluation: 'holdout', by: 'Pat Example', on: '2026-12-01' }).join(), /16 hexadecimal/);
  assert.match(validateCalibration({ report: '0123456789abcdef', evaluation: 'training', by: 'Pat Example', on: '2026-12-01' }).join(), /holdout/);
  if (base.scoring._calibration !== undefined) assert.deepEqual(validateCalibration(base.scoring._calibration), [], 'scoring.json _calibration');
});

test('UNIT OF WORK: each backtest step runs with exactly its load list, and no model-facing action loads backtest/', async () => {
  for (const kind of ['backtestPanel', 'backtestLabels', 'backtestRun']) assert.ok(Array.isArray(LOADS[kind]) && LOADS[kind].length, `LOADS.${kind}`);
  assert.ok(!LOADS.backtestRun.some((x) => x.startsWith('sources/')), 'the replay reads the panel and the labels only');
  const covers = (prefix, rel) => prefix === '' || rel === prefix || (prefix.endsWith('/') && rel.startsWith(prefix));
  for (const kind of ['research', 'draft', 'callPrep', 'callExtract']) for (const p of ['backtest/labels.json', 'backtest/panel/state.json', 'backtest/report-0123456789abcdef.md']) assert.ok(!LOADS[kind].some((x) => covers(x, p)), `${kind} covers ${p}`);
  const dir = makeDir();
  const uow = (prefixes, fn) => withUnitOfWork({ load: async (p) => snapshotFromDir(dir, p), flush: async (plan) => applyPlanToDir(plan, dir) }, prefixes, fn);
  const f = fakeFdic(btTables());
  const { result: p } = await uow(LOADS.backtestPanel, (root) => runPanel({ dir: root, metros: METROS, config: btConfig(), lookbackQuarters: 8, from: FROM, to: TO, fetchImpl: f.fetchImpl, now: NOW, clock: () => NOW, sleep: async () => {} }));
  assert.equal(p.outcome, 'ok');
  put(dir, 'sources/fdic/sales.json', SALES());
  const { result: l } = await uow(LOADS.backtestLabels, (root) => buildLabels({ dir: root, config: { ...config(), backtest: btConfig() }, now: NOW, clock: () => NOW }));
  assert.equal(l.outcome, 'ok');
  const { result: r } = await uow(LOADS.backtestRun, (root) => runBacktest({ dir: root, rules: rulesWith(), now: NOW }));
  assert.equal(head(r.report).labelled, 8);
});

test('COMMAND LINE: backtest run, --compare A B, report and verify on a data folder; labels --filings refuses while disclosed_sale is unavailable', async () => {
  const dir = await world();
  const env = { ...process.env, OUTBOUND_DATA_DIR: dir };
  const cli = (...args) => execFileSync(process.execPath, [join(REPO, 'cli.mjs'), 'backtest', ...args], { env, encoding: 'utf8', stdio: 'pipe' });
  const out = cli('run');
  // The command line reads the shipped buybox.json, so its summary is PROVISIONAL exactly while that file has placeholders, and the
  // report records that file's hash. The PROVISIONAL output on an explicit placeholder buy box is checked above.
  const shippedUnfilled = validateBuybox(base.buybox, { metros: base.metros }).placeholders.length > 0;
  assert.equal(/^PROVISIONAL/.test(out), shippedUnfilled, out);
  assert.match(out, /Base rate/);
  const hash = /Backtest report ([0-9a-f]{16})/.exec(out)[1];
  assert.ok(out.includes(join(dir, 'backtest', `report-${hash}.md`)), out);
  const written = readReport({ dir, hash });
  assert.deepEqual([written.provisional, written.inputs.buyboxHash], [shippedUnfilled, contentHash(base.buybox)]);
  const a = join(makeDir(), 'a.json'); writeFileSync(a, JSON.stringify(base.scoring));
  const b = join(makeDir(), 'b.json'); writeFileSync(b, JSON.stringify(weighted('creNoncurrentYoY', 0)));
  assert.match(cli('run', '--compare', a, b), new RegExp(`${a}[\\s\\S]*${b}`));
  assert.match(cli('report'), /Backtest report [0-9a-f]{16}: two scoring files side by side/);
  assert.match(cli('report', '--hash', hash), new RegExp(`Backtest report ${hash}`));
  assert.match(cli('verify'), /PASS {2}backtest\.coverage/);
  // The command line reads the shipped config.json, so this checks the reason that holds whatever it ships: the data folder has no
  // confirmed filer. The SEC-contact reason (Q11) is checked on an explicit placeholder in test/backtest-labels.test.mjs.
  assert.throws(() => cli('labels', '--filings'), /disclosed_sale is unavailable, so outbound backtest labels --filings does not run[\s\S]*confirmed filer/);
  assert.throws(() => cli('run', '--horizon', 'x'), /horizon/);
});

// ---- Decided 2026-11-14: the holdout by bank (D-B5), horizons side by side (D-B1), and eras (Q6) ---------------------------------
const BANK_SPLIT = { by: 'bank', share: 0.5, seed: 'test-seed' };
const bankRules = (over = {}, extra) => rulesWith({ holdoutFrom: undefined, holdout: BANK_SPLIT, ...over }, extra);

test('HOLDOUT BY BANK: a fixed share of banks, chosen by the declared seed, is held out across every quarter; training never counts them', async () => {
  const { inHoldout, holdoutSpec } = await import('../src/backtest/run.mjs');
  const spec = holdoutSpec({ holdout: BANK_SPLIT });
  const certs = ['201', '202', '203', '204', '205', '206'];
  const held = certs.filter((c) => inHoldout(c, spec));
  assert.ok(held.length > 0 && held.length < certs.length, `the seed splits the invented banks (held out: ${held.join(', ')})`);
  assert.deepEqual(certs.filter((c) => inHoldout(c, spec)), held, 'the same seed gives the same split every time');
  assert.notDeepEqual(certs.filter((c) => inHoldout(c, holdoutSpec({ holdout: { ...BANK_SPLIT, seed: 'another' } }))), held, 'another seed, another split');

  const dir = await world();
  const t = run(dir, { rules: bankRules() });
  assert.deepEqual(t.report.quarters.evaluated, AS_OF, 'every quarter is evaluated');
  const keys = (rep) => new Set(rep.results[0].byQuarter.length && Object.values(rep.results[0].topByQuarter).flat().map((x) => x.key));
  for (const k of keys(t.report)) assert.ok(!held.includes(k.replace('fdic:', '')), `training counts no held-out bank (${k})`);
  assert.equal(t.report.split.by, 'bank');
  assert.equal(t.report.split.heldOutBanks, held.length, 'every held-out bank of the universe (201 to 206; 207 is never in it) is counted');
  assert.equal(readJsonl(backtestPaths(dir).holdout).length, 0, 'a training run does not touch the holdout');

  const h = run(dir, { mode: 'holdout', rules: bankRules() });
  for (const k of keys(h.report)) assert.ok(held.includes(k.replace('fdic:', '')), `the holdout counts only held-out banks (${k})`);
  assert.equal(head(h.report).observations + head(t.report).observations, run(dir, { rules: rulesWith({ holdoutFrom: '2099-12-31' }) }).report.results[0].headline.all.observations,
    'held-out and training bank-quarters add up to the whole universe');
  assert.equal(readJsonl(backtestPaths(dir).holdout).length, 1);
  assert.match(readFileSync(h.paths.md, 'utf8'), /Holdout: by bank, a share of 0\.5/);

  const alt = join(makeDir(), 'alt.json'); writeFileSync(alt, JSON.stringify(weighted('creOreoRatio', 20)));
  assert.equal(run(dir, { mode: 'holdout', rules: bankRules(), scoringPaths: [alt] }).report.reusedHoldout, true, 'a second scoring file on the same held-out banks is a reused holdout');
  const r = run(dir, { mode: 'rolling', rules: bankRules() });
  assert.equal(r.report.reusedHoldout, false, 'rolling under a bank split runs on the training banks and never touches the holdout');
  const moved = run(dir, { rules: bankRules({ holdout: { ...BANK_SPLIT, seed: 'changed' } }) });
  assert.ok(moved.report.holdoutMovedFrom.includes('bank:0.5:test-seed'), 'changing the seed is shown as a moved holdout');
  assert.throws(() => run(dir, { rules: bankRules({ holdout: { by: 'bank', share: 0.5 } }) }), /seed/);
  assert.throws(() => run(dir, { rules: bankRules({ holdout: { by: 'bank', share: 1.5, seed: 'x' } }) }), /share/);
  assert.throws(() => run(dir, { rules: bankRules({ holdout: { by: 'era' } }) }), /not built/);
});

test('HORIZONS SIDE BY SIDE: one ranking, a label counted within each reported horizon; the headline horizon is marked', async () => {
  const dir = await world();
  const { report, paths } = run(dir, { rules: rulesWith({ horizonsReported: [2, 4, 8] }) });
  const bh = report.results[0].byHorizon;
  assert.deepEqual(bh.map((b) => b.horizon), [2, 4, 8]);
  assert.deepEqual(bh.map((b) => b.headline), [false, true, false]);
  assert.deepEqual(bh.find((b) => b.headline).groups, head(report).groups, 'the headline horizon matches the headline');
  assert.ok(bh[0].labelled <= bh[1].labelled && bh[1].labelled <= bh[2].labelled, 'a longer horizon can only add labels');
  assert.deepEqual(bh.map((b) => b.observations), [head(report).observations, head(report).observations, head(report).observations], 'the same bank-quarters at every horizon');
  assert.deepEqual(report.inputs.horizonsReported, [2, 4, 8]);
  assert.match(readFileSync(paths.md, 'utf8'), /### By horizon/);
  assert.match(summarize(report), /by horizon \(common sample, [^)]*\): 2q lift/);
  const one = run(dir, { rules: rulesWith({ horizonsReported: undefined }) });
  assert.doesNotMatch(readFileSync(one.paths.md, 'utf8'), /### By horizon/, 'one horizon, no table');
  assert.throws(() => run(dir, { rules: rulesWith({ horizonsReported: [0] }) }), /horizonsReported/);
});

test('ERAS: every report shows each era apart beside the pooled headline, and says the pooled figure mixes them', async () => {
  const dir = await world();
  const eras = [{ id: 'early', label: 'Early', from: '2022-03-31', to: '2022-12-31' }, { id: 'late', label: 'Late', from: '2023-03-31', to: '2023-12-31' }];
  const { report, paths } = run(dir, { rules: rulesWith({ holdoutFrom: '2099-12-31', eras }) });
  const be = report.results[0].byEra;
  assert.deepEqual(be.map((e) => [e.id, e.quarters]), [['early', 4], ['late', 4]]);
  assert.equal(be[0].observations + be[1].observations, head(report).observations, 'the eras cover the pooled figure exactly');
  const md = readFileSync(paths.md, 'utf8');
  assert.match(md, /### By era/);
  assert.match(md, /mixes eras/);
  assert.match(summarize(report), /era Early: base rate/);
  assert.throws(() => run(dir, { rules: rulesWith({ eras: [{ id: 'x', from: '2023-12-31', to: '2022-03-31' }] }) }), /eras/);
});

test('the mode says banks, not quarters, when the holdout is by bank', async () => {
  const dir = await world();
  assert.match(run(dir, { rules: bankRules() }).report.modeLabel, /^training banks/);
  assert.match(run(dir, { mode: 'holdout', rules: bankRules() }).report.modeLabel, /^HELD-OUT banks/);
  assert.match(run(dir).report.modeLabel, /^training quarters/);
});

test('HORIZONS ON A COMMON SAMPLE: every horizon uses only the quarters whose longest horizon has complete labels', async () => {
  const dir = await world();
  // Labels are complete through NOW (2026-11-14). A 12-quarter horizon from 2023-12-31 ends 2026-12-31, after it: that quarter is left out.
  const { report, paths } = run(dir, { rules: rulesWith({ holdoutFrom: '2099-12-31', horizonsReported: [2, 4, 12] }) });
  const res = report.results[0];
  assert.deepEqual([res.horizonSample.quarters, res.horizonSample.left, res.horizonSample.to], [7, 1, '2023-09-30']);
  const n = res.byHorizon.map((b) => b.observations);
  assert.ok(n.every((x) => x === n[0]), 'the same bank-quarters at every horizon');
  assert.ok(n[0] < head(report).observations, 'the incomplete quarter is left out of the horizon table, not of the headline');
  assert.match(readFileSync(paths.md, 'utf8'), /1 later quarter\(s\) are left out here/);
  const none = run(dir, { rules: rulesWith({ holdoutFrom: '2099-12-31', horizonsReported: [4, 40] }) });
  assert.equal(none.report.results[0].horizonSample.quarters, 0);
  assert.match(readFileSync(none.paths.md, 'utf8'), /cannot be compared on a common sample/);
});

test('ERAS PARTITION THE PANEL: overlaps and repeated ids are refused, and quarters outside every era get their own row', async () => {
  const dir = await world();
  const r2 = (eras) => run(dir, { rules: rulesWith({ holdoutFrom: '2099-12-31', eras }) });
  assert.throws(() => r2([{ id: 'a', from: '2022-03-31', to: '2022-12-31' }, { id: 'b', from: '2022-12-31', to: '2023-12-31' }]), /overlap/);
  assert.throws(() => r2([{ id: 'a', from: '2022-03-31', to: '2022-06-30' }, { id: 'a', from: '2023-03-31', to: '2023-12-31' }]), /unique/);
  const { report, paths } = r2([{ id: 'early', label: 'Early', from: '2022-03-31', to: '2022-09-30' }]);
  const be = report.results[0].byEra;
  assert.deepEqual(be.map((e) => [e.label, e.quarters]), [['Early', 3], ['Outside every era', 5]]);
  assert.equal(be.reduce((a, e) => a + e.observations, 0), head(report).observations, 'every bank-quarter is in exactly one row');
  assert.match(readFileSync(paths.md, 'utf8'), /Outside every era/);
});

test('BANK-SPLIT WORDING: compare, rolling, reused and moved holdouts speak of banks, and a moved seed names both splits', async () => {
  const dir = await world();
  const a = join(makeDir(), 'a.json'); writeFileSync(a, JSON.stringify(base.scoring));
  const b = join(makeDir(), 'b.json'); writeFileSync(b, JSON.stringify(weighted('creNoncurrentYoY', 0)));
  assert.match(readFileSync(run(dir, { mode: 'compare', scoringPaths: [a, b], rules: bankRules() }).paths.md, 'utf8'), /Side by side \(training banks only\)/);
  assert.match(readFileSync(run(dir, { mode: 'rolling', rules: bankRules() }).paths.md, 'utf8'), /training banks only \(the held-out banks are left out\)/);
  run(dir, { mode: 'holdout', rules: bankRules() });
  const re = run(dir, { mode: 'holdout', rules: bankRules(), scoringPaths: [b] });
  assert.match(readFileSync(re.paths.md, 'utf8'), /These held-out banks were scored before/);
  assert.match(summarize(re.report), /these held-out banks were scored before/);
  const moved = run(dir, { rules: bankRules({ holdout: { ...BANK_SPLIT, seed: 'changed' } }) });
  const md = readFileSync(moved.paths.md, 'utf8');
  assert.match(md, /Earlier runs used a bank holdout \(share 0\.5, seed "test-seed"\); this one uses a bank holdout \(share 0\.5, seed "changed"\)/);
  assert.doesNotMatch(md, /null/);
});
