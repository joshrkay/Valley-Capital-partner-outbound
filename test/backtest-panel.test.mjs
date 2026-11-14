// PRD E17-S1: the point-in-time panel. Invented banks only (test/backtest-kit.mjs), the fake FDIC API, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { makeDir } from './kit.mjs';
import { fakeFdic } from './fdic-fake.mjs';
import { readJson, readJsonl, exists, listFiles } from '../src/store.mjs';
import { scoreBank } from '../src/score.mjs';
import { loadRules } from '../src/rules.mjs';
import { runPanel, readPanel, asOfQuarters, knownQuarter, sodReleasedOn, sodYearFor, pointInTime, verifyPanel, backtestPaths } from '../src/backtest/panel.mjs';
import { btTables, btConfig, METROS, NOW, FROM, TO, AS_OF } from './backtest-kit.mjs';

const rules = loadRules();
const SCORING = rules.scoring;
const pull = (dir, { tables = btTables(), cfg = btConfig(), fake, ...over } = {}) => {
  const f = fake ?? fakeFdic(tables);
  return runPanel({ dir, metros: METROS, config: cfg, lookbackQuarters: 8, from: FROM, to: TO, fetchImpl: f.fetchImpl, now: NOW, clock: () => NOW, sleep: async () => {}, ...over }).then((r) => ({ r, calls: f.calls }));
};

test('as-of quarters run from --from to --to, quarter-ends only', () => {
  assert.deepEqual(asOfQuarters(FROM, TO), AS_OF);
  assert.throws(() => asOfQuarters('2022-03-30', TO), /quarter-end/);
  assert.throws(() => asOfQuarters(TO, FROM), /after/);
});

test('availability: a Call Report is known from quarter-end plus callReportLagDays; the Summary of Deposits from its release date', () => {
  assert.equal(knownQuarter('2022-06-30', 60), '20220331');
  assert.equal(knownQuarter('2022-05-30', 60), '20220331', 'March 31 plus 60 days is May 30: known that day');
  assert.equal(knownQuarter('2022-05-29', 60), '20211231', 'one day earlier, only the December report is known');
  assert.equal(knownQuarter('2022-06-30', 100), '20211231');
  assert.equal(sodReleasedOn(2022, 120), '2022-10-28');
  assert.equal(sodYearFor('2022-09-30', 120), 2021, 'June 2022 deposits are not yet released on September 30');
  assert.equal(sodYearFor('2022-12-31', 120), 2022);
});

test('the panel pulls every window quarter plus lookbackQuarters before it, with the FDIC client, and stores it in backtest/panel/', async () => {
  const dir = makeDir();
  const { r, calls } = await pull(dir);
  assert.equal(r.outcome, 'ok', JSON.stringify(r.notes));
  const fin = calls.filter((c) => c.endpoint === 'financials');
  assert.ok(fin.length && fin.every((c) => c.filters.includes('REPDTE:[20200331 TO 20231231]')), 'window plus 8 quarters of lookback');
  const p = backtestPaths(dir);
  for (const f of [p.state, p.institutions, p.universe, p.failed, p.events]) assert.ok(exists(f), f);
  assert.deepEqual(listFiles(p.financials, '.json'), ['201.json', '202.json', '203.json', '204.json', '205.json', '206.json']);
  const state = readJson(p.state);
  assert.deepEqual(state.asOf, AS_OF);
  assert.equal(state.runId, r.runId);
  assert.equal(state.callReportLagDays, 60);
  // Summary of Deposits years, each with the release date that is its availability date.
  assert.deepEqual(state.sod.map((s) => s.year), [2021, 2022, 2023]);
  for (const s of state.sod) { assert.equal(s.releasedOn, sodReleasedOn(s.year, 120)); assert.match(s.releaseBasis, /sodReleaseLagDays/); }
  assert.deepEqual(listFiles(p.sod, '.json'), ['2021.json', '2022.json', '2023.json']);
});

test('the pull reaches back far enough for the quarter known on the first as-of date, whatever the lag; the lookback is at least 1', async () => {
  // A lag of 100 days: on 2022-03-31 the September 2021 report is the latest known, so two quarters of lookback start in June 2021.
  const dir = makeDir();
  const { r, calls } = await pull(dir, { cfg: btConfig({ callReportLagDays: 100 }), lookbackQuarters: 2 });
  assert.ok(calls.filter((c) => c.endpoint === 'financials').every((c) => c.filters.includes('REPDTE:[20210630 TO 20231231]')), JSON.stringify(calls.find((c) => c.endpoint === 'financials')));
  assert.equal(r.coverage['2022-03-31'], 1);
  const pit = pointInTime({ panel: readPanel(dir), asOf: '2022-03-31' });
  assert.deepEqual(Object.keys(pit.banks[0].financials.quarters), ['20210630', '20210930']);
  await assert.rejects(pull(makeDir(), { lookbackQuarters: 0 }), /lookbackQuarters/);
});

test('UNIVERSE: banks that later failed or merged are in the panel for the quarters they were active (a bank inactive today)', async () => {
  const dir = makeDir();
  await pull(dir);
  const panel = readPanel(dir);
  const inAt = (cert) => AS_OF.filter((d) => panel.universe[d].members[cert]);
  // 202 is inactive today: it failed on 2023-05-12. It is in the universe through March 31, 2023, and not after.
  assert.equal(panel.institutions['202'].ACTIVE, 0);
  assert.deepEqual(inAt('202'), AS_OF.slice(0, 5));
  assert.ok(Object.keys(panel.financials.get('202').quarters).includes('20230331'));
  // 206 merged into 204 on 2022-11-01 (inactive today); 203 was sold in an assisted merger on 2023-09-15.
  assert.deepEqual(inAt('206'), AS_OF.slice(0, 3));
  assert.deepEqual(inAt('203'), AS_OF.slice(0, 6));
  // 205: headquartered outside our states, in through a Summary of Deposits branch in Denver. 207: neither, never in.
  assert.deepEqual(inAt('205'), AS_OF);
  assert.deepEqual(panel.universe['2022-03-31'].members['205'], { hq: false, branch: true, rows: true });
  assert.deepEqual(inAt('207'), []);
  assert.deepEqual(panel.universe['2022-03-31'].members['201'], { hq: true, branch: true, rows: true });
  assert.equal(panel.universe['2022-03-31'].members['204'].branch, false, 'HQ in our states, no branch in the metros');
});

test('the panel keeps the window\'s failures (from all three FDIC sources) and structure events, placed in the metros by the Summary of Deposits', async () => {
  const dir = makeDir();
  await pull(dir);
  const panel = readPanel(dir);
  const f = panel.failed['202'];
  assert.equal(f.failedOn, '2023-05-12');
  assert.deepEqual(f.agree, ['failures', 'institutions', 'history']);
  const ev = Object.values(panel.events);
  assert.deepEqual(ev.map((e) => `${e.kind}:${e.targetCert}`).sort(), ['assisted-merger:203', 'failure:202', 'merger:206']);
  const assisted = ev.find((e) => e.kind === 'assisted-merger');
  assert.equal(assisted.acquirerCert, '201');
  assert.equal(assisted.targetInMetros, true);
  assert.deepEqual(assisted.targetMetros.map((m) => m.cbsa), ['19740']);
  assert.match(assisted.targetMetros[0].basis[0], /Summary of Deposits, June 2022/);
});

test('POINT IN TIME: the scorer sees only the reports known on the as-of date, the deposits released by then, and events up to that date', async () => {
  const dir = makeDir();
  await pull(dir);
  const panel = readPanel(dir);
  const at = (asOf, lag = 60) => pointInTime({ panel, asOf, lagDays: lag, lookbackQuarters: 8, sodReleaseLagDays: 120 });
  const june = at('2022-06-30');
  assert.equal(june.knownQuarter, '20220331');
  assert.equal(june.sodYear, 2021);
  const b202 = june.banks.find((b) => b.cert === '202');
  assert.deepEqual(Object.keys(b202.financials.quarters).sort(), ['20200630', '20200930', '20201231', '20210331', '20210630', '20210930', '20211231', '20220331']);
  assert.equal(b202.footprint.sod.year, 2021);
  assert.deepEqual(b202.footprint.branchesByMetro, { 31080: 1 });
  assert.equal(b202.institution.ACTIVE, 1, 'active on that date, whatever it is today');
  assert.equal(at('2022-06-30', 100).knownQuarter, '20211231');
  // The assisted merger takes effect on 2023-09-15: the acquirer's event signal appears at the first as-of date after it, not before.
  const sig = (asOf) => { const b = at(asOf).banks.find((x) => x.cert === '201'); return scoreBank({ ...b, scoring: SCORING, buybox: rules.buybox, metros: rules.metros }).signals.filter((s) => s.rule === 'acquisition').length; };
  assert.equal(sig('2023-06-30'), 0);
  assert.equal(sig('2023-09-30'), 1);
  assert.ok(at('2023-06-30').banks.find((x) => x.cert === '201').events.every((e) => e.effective <= '2023-06-30'));
});

test('the run log, field checks and change log (E2): counts and ids only, a missing field fails the run and writes no panel, an amendment is logged', async () => {
  const dir = makeDir();
  const { r } = await pull(dir);
  const line = readJsonl(join(dir, 'sources', 'runs.jsonl')).at(-1);
  assert.equal(line.source, 'backtest-panel');
  assert.equal(line.runId, r.runId);
  assert.equal(line.outcome, 'ok');
  assert.ok(line.rowsRead > 0 && line.rowsWritten > 0);
  assert.doesNotMatch(JSON.stringify(line), /Example/, 'no bank name in the run log');

  // FDIC drops a field name it does not know, silently: the check catches it and nothing is written.
  const bad = makeDir();
  const t = btTables();
  for (const row of t.financials) delete row.NCREMULT;
  const { r: rb } = await pull(bad, { tables: t });
  assert.equal(rb.outcome, 'failed');
  assert.match(rb.errors.join(' '), /NCREMULT/);
  assert.equal(exists(backtestPaths(bad).state), false);
  assert.equal(readJsonl(join(bad, 'sources', 'runs.jsonl')).at(-1).outcome, 'failed');

  // A re-pull after FDIC amended a filed value logs the old and new value.
  const t2 = btTables();
  t2.financials.find((x) => x.CERT === '202' && x.REPDTE === '20220930').NCRENRES = 77777;
  await pull(dir, { tables: t2 });
  const ch = readJsonl(join(dir, 'sources', 'changes.jsonl')).filter((c) => c.key === 'fdic:202:20220930' && c.field === 'NCRENRES');
  assert.equal(ch.length, 1);
  assert.equal(ch[0].new, 77777);
});

test('VERIFY: every as-of quarter needs rows for at least minCoverage of its universe, or the run is suspect', async () => {
  const dir = makeDir();
  await pull(dir);
  const ok = verifyPanel({ dir, config: btConfig() });
  assert.equal(ok.checks.find((c) => c.id === 'backtest.coverage').ok, true);
  // 204 has no Call Report for September 30, 2022, the quarter known on December 31, 2022: 4 of 5 banks there have rows.
  const gap = makeDir();
  const { r } = await pull(gap, { tables: btTables({ missing: [{ cert: '204', repdte: '20220930' }] }) });
  assert.equal(r.outcome, 'suspect');
  assert.match(r.notes.join(' '), /2022-12-31: 4 of 5/);
  assert.equal(readJson(backtestPaths(gap).universe)['2022-12-31'].coverage, 0.8);
  const v = verifyPanel({ dir: gap, config: btConfig() });
  const c = v.checks.find((x) => x.id === 'backtest.coverage');
  assert.equal(c.ok, false);
  assert.match(c.summary, /2022-12-31/);
  assert.equal(verifyPanel({ dir: makeDir(), config: btConfig() }).checks[0].ok, false, 'no panel yet');
});
