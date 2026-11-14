// Signal coverage (PRD next-five E18-S1): for Tier A, Tier B and all candidates, how many each signal source can see. Invented banks
// only; stored data only, no network, no model.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { makeDir, put, REPO } from './kit.mjs';
import { buildCoverage, coverageReport, renderCoverage, COVERAGE_PATHS, COVERAGE_ROWS } from '../src/coverage.mjs';
import { LOADS, withUnitOfWork, snapshotFromDir } from '../src/uow.mjs';
import { validateEvent, servicerKey } from '../src/sales.mjs';

// ---- An invented world: nine banks across the tiers, and every source state ----------------------------------------------------
const cand = (cert, name, tier) => ({ key: `fdic:${cert}`, cert: String(cert), name, tier, score: tier === 'A' ? 60 : tier === 'B' ? 30 : 5, axes: { distress: 20, fit: 20, timing: 10 }, filtersFailed: [], signals: [], latestRepdte: '20260630' });
const ITEMS = [
  cand(101, 'Alder Example Bank', 'A'),     // a confirmed filer (and a rejected one); sold before (an SEC filing)
  cand(102, 'Birch Example Bank', 'A'),     // every filer rejected
  cand(103, 'Cedar Example Bank', 'A'),     // no filer; named as a CMBS special servicer (same name, other case)
  cand(104, 'Dogwood Example Bank', 'A'),   // an entry with no filer at all; nothing anywhere
  cand(201, 'Elm Example Bank', 'B'),       // confirmed; a special servicer through a principal's alias
  cand(202, 'Fir Example Bank', 'B'),       // no filer; special servicer of a CMBS liquidation in the ledger, so it has sold too
  cand(203, 'Ginkgo Example Bank', 'B'),    // no filer; only ever an acquirer in the ledger, which is not a sale
  cand(301, 'Hazel Example Bank', null),    // untiered; confirmed; its only sale event is no longer supported
  cand(302, 'Ivy Example Bank', null),      // untiered; rejected; sold itself in a whole-bank deal
];
const latestDoc = (items = ITEMS, over = {}) => ({ runId: 'score-1', scoredAt: '2026-11-16T13:00:00.000Z', asOf: '2026-11-16', latestRepdte: '20260630', provisional: false, items, failedBanks: [], ...over });
const pick = (s, by = 'Pat Example') => ({ status: s, by, at: '2026-11-01T00:00:00.000Z' });
const FILERS = {
  'fdic:101': { bank: 'fdic:101', ciks: { '0009900101': pick('confirmed'), '0009900199': pick('rejected') } },
  'fdic:102': { bank: 'fdic:102', ciks: { '0009900102': pick('rejected') } },
  'fdic:104': { bank: 'fdic:104', ciks: {} },
  'fdic:201': { bank: 'fdic:201', ciks: { '0009900201': pick('confirmed') } },
  'fdic:301': { bank: 'fdic:301', ciks: { '0009900301': pick('confirmed') } },
  'fdic:302': { bank: 'fdic:302', ciks: { '0009900302': pick('rejected') } },
  'fdic:999': { bank: 'fdic:999', ciks: { '0009900999': pick('confirmed') } },   // not a candidate: never counted
};
const svc = (name) => ({ name, loans: 1, balance: 1000000, specialServicing: 1, noteSale: 0, delinquent: 0, maturing: 0, metros: ['31080'], sectors: ['multifamily'] });
const SERVICERS = Object.fromEntries(['CEDAR EXAMPLE BANK', 'Elm Special Servicing LLC', 'Juniper Example Servicing', 'Cedar Example Bancorp', 'Unknown'].map((n) => [n, svc(n)]));
const ALIASES = { 'fdic:201': ['Elm Special Servicing LLC'] };
const unknown = { kind: 'unknown', name: 'unknown' };
const src = (source, id, date) => [{ source, ids: [id], link: null, date }];
const EVENTS = [
  { id: 'sec-sale:0000000001-26-000001:fdic:101', kind: 'bank_disclosed_sale', date: '2026-08-01', seller: { kind: 'bank', key: 'fdic:101', name: 'Alder Example Bank' }, buyer: unknown,
    asset: { kind: 'unknown', propertyType: null, metro: null, balance: null }, tier: 'reported', sources: src('filings', '0000000001-26-000001', '2026-08-01'), contextOnly: true },
  { id: 'cmbs-liquidation:1001:7', kind: 'disposition', date: '2026-07-15', seller: { kind: 'trust', key: 'cmbs-trust:1001', name: 'Example Mortgage Trust 2019-C1', via: { kind: 'servicer', key: servicerKey('Fir Example Bank'), name: 'Fir Example Bank', matched: true } }, buyer: unknown,
    asset: { kind: 'loan', propertyType: 'Multifamily', metro: '31080', balance: 2000000 }, tier: 'reported', sources: src('edgar', '1001:7', '2026-07-31'), contextOnly: true },
  { id: 'fdic-deal:9001', kind: 'whole_bank_acquisition', date: '2026-05-01', seller: { kind: 'bank', key: 'fdic:302', name: 'Ivy Example Bank' }, buyer: { kind: 'bank', key: 'fdic:203', name: 'Ginkgo Example Bank' },
    asset: { kind: 'bank', key: 'fdic:302', propertyType: null, metro: '31080', balance: null }, tier: 'reported', sources: src('fdic', '9001', '2026-05-01'), contextOnly: true },
  { id: 'sec-sale:0000000001-26-000002:fdic:301', kind: 'bank_disclosed_sale', date: '2026-06-01', seller: { kind: 'bank', key: 'fdic:301', name: 'Hazel Example Bank' }, buyer: unknown,
    asset: { kind: 'unknown', propertyType: null, metro: null, balance: null }, tier: 'reported', sources: src('filings', '0000000001-26-000002', '2026-06-01'), contextOnly: true, supported: false },
  { id: 'fdic-sale:EX-1', kind: 'fdic_sale_announced', date: '2026-09-01', seller: { kind: 'fdic', key: 'fdic-receiver', name: 'FDIC as receiver' }, buyer: unknown,
    asset: { kind: 'pool', propertyType: null, metro: null, balance: null }, tier: 'reported', sources: src('fdicsales', 'EX-1', null), contextOnly: true },
];
const LEDGER = { builtAt: '2026-11-16T12:00:00.000Z', runId: 'sales-1', events: Object.fromEntries(EVENTS.map((e) => [e.id, e])) };

function world({ latest = latestDoc(), filers = FILERS, servicers = SERVICERS, aliases = ALIASES, ledger = LEDGER } = {}, dir = makeDir()) {
  if (latest) put(dir, COVERAGE_PATHS.latest, latest);
  if (aliases) put(dir, COVERAGE_PATHS.aliases, aliases);
  if (filers) put(dir, COVERAGE_PATHS.filers, filers);
  if (servicers) put(dir, COVERAGE_PATHS.servicers, servicers);
  if (ledger) put(dir, COVERAGE_PATHS.ledger, ledger);
  return dir;
}
const row = (r, id) => r.rows.find((x) => x.id === id);
const counts = (r, id) => Object.fromEntries(['A', 'B', 'all'].map((g) => [g, row(r, id).cells[g].count]));
const texts = (r, id) => ['A', 'B', 'all'].map((g) => row(r, id).cells[g].text);

test('the fixture is honest: every sale event is one the ledger would accept', () => {
  for (const e of EVENTS) assert.deepEqual(validateEvent(e), [], e.id);
});

test('the counts: confirmed, rejected and unmapped filers, CMBS links, sale-ledger events, by tier and for all candidates', () => {
  const r = coverageReport({ dir: world() });
  assert.deepEqual(r.groups.map((g) => [g.id, g.label, g.total]), [['A', 'Tier A', 4], ['B', 'Tier B', 3], ['all', 'All candidates', 9]]);
  assert.deepEqual(r.rows.map((x) => x.id), COVERAGE_ROWS);
  assert.deepEqual(counts(r, 'sec-confirmed'), { A: 1, B: 1, all: 3 }, 'a confirmed filer counts even beside a rejected one; a non-candidate never counts');
  assert.deepEqual(counts(r, 'sec-not-confirmed'), { A: 3, B: 2, all: 6 });
  assert.deepEqual(counts(r, 'sec-rejected'), { A: 1, B: 0, all: 2 });
  assert.deepEqual(counts(r, 'sec-unmapped'), { A: 2, B: 2, all: 4 }, 'no entry, and an entry with no filer, are both unmapped');
  assert.deepEqual(counts(r, 'cmbs'), { A: 1, B: 2, all: 3 }, 'exact name in any case, a principal\'s alias, and the ledger\'s servicer; never a near name');
  assert.deepEqual(counts(r, 'sale'), { A: 1, B: 1, all: 3 }, 'the seller that acted, a servicer by name; not an acquirer, not an unsupported event');
  assert.equal(row(r, 'sec-rejected').parent, 'sec-not-confirmed');
  assert.deepEqual(row(r, 'cmbs').detail, { servicerNames: 5, matched: 3, text: '5 special servicer names in the stored CMBS data; 3 match a candidate. Nothing fuzzier is counted.' }, 'Unknown is not a name');
  // Every candidate is in exactly one filer state.
  for (const g of ['A', 'B', 'all']) assert.equal(row(r, 'sec-confirmed').cells[g].count + row(r, 'sec-rejected').cells[g].count + row(r, 'sec-unmapped').cells[g].count, r.groups.find((x) => x.id === g).total);
});

test('each share states its denominator', () => {
  const r = coverageReport({ dir: world() });
  assert.deepEqual(texts(r, 'sec-confirmed'), ['1 of 4 (25.0%)', '1 of 3 (33.3%)', '3 of 9 (33.3%)']);
  assert.deepEqual(texts(r, 'cmbs'), ['1 of 4 (25.0%)', '2 of 3 (66.7%)', '3 of 9 (33.3%)']);
  const c = row(r, 'sec-unmapped').cells.all;
  assert.deepEqual([c.count, c.of, c.share], [4, 9, 0.4444]);
});

test('enforcement is not built yet: shown as not built, never as zero', () => {
  const r = coverageReport({ dir: world() });
  const e = row(r, 'enforcement');
  assert.equal(e.built, false);
  for (const g of ['A', 'B', 'all']) {
    assert.equal(e.cells[g].count, null);
    assert.equal(e.cells[g].share, null);
    assert.equal(e.cells[g].text, 'not built');
  }
  assert.ok(r.rows.filter((x) => x.id !== 'enforcement').every((x) => x.built === true));
  assert.match(renderCoverage(r), /Enforcement record\s+not built\s+not built\s+not built/);
});

test('the empty case: no candidate list, or one with no bank, gives counts of 0 and says so, with no division by zero', () => {
  for (const [dir, why] of [[makeDir(), /no scoring run has stored a candidate list/], [world({ latest: latestDoc([]) }), /the latest scoring run scored no bank/]]) {
    const r = coverageReport({ dir });
    assert.equal(r.empty, true);
    assert.match(r.note, /^No candidates yet/);
    assert.match(r.note, why);
    assert.deepEqual(r.groups.map((g) => g.total), [0, 0, 0]);
    for (const x of r.rows) for (const g of ['A', 'B', 'all']) {
      const c = x.cells[g];
      assert.equal(c.of, 0);
      assert.equal(c.share, null, `${x.id} ${g}: no share of nothing`);
      if (x.built) { assert.equal(c.count, 0); assert.equal(c.text, '0 of 0'); }
    }
    assert.doesNotMatch(JSON.stringify(r) + renderCoverage(r), /NaN|Infinity/);
    assert.match(renderCoverage(r), /No candidates yet/);
  }
});

test('a tier with no bank shows 0 of 0 beside tiers that have some', () => {
  const r = coverageReport({ dir: world({ latest: latestDoc(ITEMS.filter((i) => i.tier !== 'A')) }) });
  assert.equal(r.empty, false);
  assert.equal(r.note, null);
  assert.deepEqual(r.groups.map((g) => g.total), [0, 3, 5]);
  assert.deepEqual(texts(r, 'sec-confirmed'), ['0 of 0', '1 of 3 (33.3%)', '2 of 5 (40.0%)']);
  assert.equal(r.groups[0].note, 'No Tier A candidates.');
});

test('a source that has not run is said to be not run, so its zero is not read as a measurement', () => {
  const r = coverageReport({ dir: world({ filers: null, servicers: null, aliases: null, ledger: null }) });
  assert.deepEqual(r.stores.map((s) => [s.id, s.present]), [['filers', false], ['servicers', false], ['ledger', false]]);
  assert.deepEqual(counts(r, 'sec-unmapped'), { A: 4, B: 3, all: 9 }, 'with no map, every bank is unmapped');
  assert.deepEqual(counts(r, 'cmbs'), { A: 0, B: 0, all: 0 });
  assert.deepEqual(counts(r, 'sale'), { A: 0, B: 0, all: 0 });
  assert.equal(row(r, 'cmbs').notRun, true);
  assert.match(renderCoverage(r), /Not run yet: the bank-to-filer map .*the CMBS pull .*the sale ledger/s);
  const full = coverageReport({ dir: world() });
  assert.match(r.notRunNote, /^Not run yet: .*\. A 0 on their lines means the source has not run, not that it sees nothing\.$/);
  assert.ok(full.stores.every((s) => s.present) && full.rows.every((x) => !x.notRun));
  assert.equal(full.notRunNote, null);
  assert.doesNotMatch(renderCoverage(full), /Not run yet/);
});

test('deterministic and counts only: the same data gives the same report, which names no bank', () => {
  const a = coverageReport({ dir: world() });
  const b = coverageReport({ dir: world() });
  assert.deepEqual(a, b);
  assert.equal(renderCoverage(a), renderCoverage(b));
  assert.deepEqual(a.candidates, { runId: 'score-1', scoredAt: '2026-11-16T13:00:00.000Z', latestRepdte: '20260630', provisional: false });
  assert.doesNotMatch(JSON.stringify(a) + renderCoverage(a), /Example Bank|Servicing|fdic:\d|servicer:|0009900/);
  // Pure: the same stores handed straight in give the same report.
  assert.deepEqual(buildCoverage({ latest: latestDoc(), aliases: ALIASES, filers: FILERS, servicers: SERVICERS, ledger: LEDGER }), a);
});

test('the written report: fixed templates, the denominators, and what each line counts', () => {
  const t = renderCoverage(coverageReport({ dir: world({ latest: latestDoc(ITEMS, { provisional: true }) }) }));
  assert.match(t, /^# Signal coverage/);
  assert.match(t, /scoring run score-1, data as of June 30, 2026/);
  assert.match(t, /PROVISIONAL/);
  assert.match(t, /Tier A \(4\)\s+Tier B \(3\)\s+All candidates \(9\)/);
  assert.match(t, /Confirmed SEC filer\s+1 of 4 \(25\.0%\)\s+1 of 3 \(33\.3%\)\s+3 of 9 \(33\.3%\)/);
  assert.match(t, /\n {2}rejected only\s+1 of 4/);
  assert.match(t, /5 special servicer names in the stored CMBS data; 3 match a candidate/);
  assert.match(t, /no network, no model/i);
});

test('no network: the module reads stored files only', () => {
  const code = readFileSync(join(REPO, 'src', 'coverage.mjs'), 'utf8');
  assert.doesNotMatch(code, /fetch\(|http\.mjs|node:https?|model\.mjs/);
});

test('the unit of work: LOADS.coverage is narrow, and a run in it gives the same report as the data folder and writes nothing', async () => {
  assert.deepEqual([...LOADS.coverage].sort(), Object.values(COVERAGE_PATHS).sort());
  assert.ok(LOADS.coverage.every((p) => p && !p.endsWith('/')), 'exact files only, never a folder');
  const dir = world();
  const { result, plan } = await withUnitOfWork({ load: async (prefixes) => snapshotFromDir(dir, prefixes), flush: async () => assert.fail('nothing is written') }, LOADS.coverage, (root) => coverageReport({ dir: root }));
  assert.deepEqual(result, coverageReport({ dir }));
  assert.deepEqual([plan.docs.length, plan.lines.length], [0, 0]);
});

test('the command line: outbound coverage prints the report, --json the record, and help lists it', () => {
  const dir = world();
  const env = { ...process.env, OUTBOUND_DATA_DIR: dir };
  const cli = (...args) => execFileSync(process.execPath, [join(REPO, 'cli.mjs'), ...args], { env, encoding: 'utf8' });
  const text = cli('coverage');
  assert.match(text, /^# Signal coverage/);
  assert.match(text, /Confirmed SEC filer\s+1 of 4 \(25\.0%\)/);
  assert.deepEqual(JSON.parse(cli('coverage', '--json')), coverageReport({ dir }));
  assert.match(cli('help'), /outbound coverage \[--json\]/);
  assert.match(execFileSync(process.execPath, [join(REPO, 'cli.mjs'), 'coverage'], { env: { ...process.env, OUTBOUND_DATA_DIR: makeDir() }, encoding: 'utf8' }), /No candidates yet/);
});
