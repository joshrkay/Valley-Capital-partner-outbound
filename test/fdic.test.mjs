// The FDIC adapter (PRD E2-S2, E3-S1, E3-S2) against a fake FDIC server. Invented banks and numbers only; no network.
// The fake mimics the real API where it matters: `FIELD:(A OR B)` lists, `[A TO B]` ranges, paging by offset, sorting,
// and silently dropping fields it does not know (verified behavior of the real API, 2026-11-13).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runFdic, fdicQuery, orFilter, checkFields, checkHistoryRows, quartersBack, isoDate, monthsBefore, parseCsv, parseFailedBankCsv, placeInMetros, eventOf,
  FDIC_FIELDS, YTD_FLOW_FIELDS, FDIC_LOAN_SALES_URL, FAILURE_CODES, STRUCTURE_CODES, fdicPaths } from '../src/sources/fdic.mjs';
import { RUNS, CHANGES } from '../src/sources/runlog.mjs';
import { readJson, readJsonl, writeJson } from '../src/store.mjs';
import { makeDir, put } from './kit.mjs';
import { fakeFdic, METROS, TABLES, fin, FAILED_BANK_CSV } from './fdic-fake.mjs';

const opts = (dir, fetchImpl, over = {}) => ({ dir, metros: METROS, fetchImpl, quarters: 2, sleep: async () => {}, minIntervalMs: 0, now: new Date('2026-11-13T12:00:00Z'), ...over });
const listFiles = (dir) => (existsSync(dir) ? readdirSync(dir, { recursive: true }).map(String) : []);

test('orFilter builds the OR form FDIC accepts, and refuses unsafe or empty input', () => {
  assert.equal(orFilter('STALP', ['TX', 'CO'], { quote: true }), 'STALP:("TX" OR "CO")');
  assert.equal(orFilter('CBSA_NO', [12420, '19740', 12420]), 'CBSA_NO:(12420 OR 19740)');
  assert.throws(() => orFilter('STALP', ['TX") OR (ACTIVE:0']), /unsafe/);
  assert.throws(() => orFilter('CERT', []), /no values/);
});

test('quartersBack lists quarter ends oldest first, across years, and rejects a non-quarter date', () => {
  assert.deepEqual(quartersBack('20260630', 4), ['20250930', '20251231', '20260331', '20260630']);
  assert.equal(quartersBack('20260630', 8)[0], '20240930');
  assert.throws(() => quartersBack('20260615', 2), /quarter-end/);
});

test('fdicQuery pages by offset until the reported total, and flags a count mismatch', async () => {
  const rows = Array.from({ length: 5 }, (_, i) => ({ CERT: String(i) }));
  const a = fakeFdic({ institutions: rows });
  const r = await fdicQuery({ endpoint: 'institutions', fields: ['CERT'], limit: 2, http: { fetchImpl: a.fetchImpl } });
  assert.equal(r.rows.length, 5);
  assert.deepEqual(a.calls.map((c) => c.offset), ['0', '2', '4']);
  assert.equal(r.mismatch, false);
  const b = fakeFdic({ institutions: rows }, { totalBump: 1 });
  assert.equal((await fdicQuery({ endpoint: 'institutions', fields: ['CERT'], limit: 2, http: { fetchImpl: b.fetchImpl } })).mismatch, true);
});

test('checkFields: a key absent from ANY row is missing (with how many rows lacked it); nulls are allowed and counted; ID is ignored', () => {
  const r = checkFields([{ A: 1, B: null }, { A: 2, B: null }, { A: null }], ['A', 'B', 'C', 'ID']);
  assert.deepEqual(r.missing, [{ field: 'B', rowsLacking: 1, rows: 3 }, { field: 'C', rowsLacking: 3, rows: 3 }]);
  assert.deepEqual(r.nulls, { A: 1, B: 2 });
  assert.deepEqual(checkFields([], ['A']), { missing: [], nulls: {}, absentOptional: {} });
});

test('checkFields: a field verified as optional may be absent from some rows (counted as null) but not from every row', () => {
  const some = checkFields([{ W: 'x' }, {}], ['W'], { optional: ['W'] });
  assert.deepEqual(some.missing, []);
  assert.deepEqual(some.absentOptional, { W: 1 });
  assert.deepEqual(some.nulls, { W: 1 });
  assert.deepEqual(checkFields([{}, {}], ['W'], { optional: ['W'] }).missing, [{ field: 'W', rowsLacking: 2, rows: 2 }], 'absent everywhere still fails: the field may have been renamed');
});

test('institutions.WEBADDR absent on one bank (as FDIC really does) passes, is stored as null, and is noted', async () => {
  const dir = makeDir();
  const tables = TABLES();
  delete tables.institutions[0].WEBADDR;   // bank 101
  const s = await runFdic(opts(dir, fakeFdic(tables).fetchImpl));
  assert.equal(s.outcome, 'ok', JSON.stringify(s.errors));
  assert.equal(readJson(fdicPaths(dir).institutions)['101'].WEBADDR, null);
  assert.equal(s.nullCounts['institutions.WEBADDR'], 1);
  assert.ok(s.notes.some((n) => /institutions\.WEBADDR: key absent on 1 of 2 rows/.test(n)));
  const all = TABLES();
  for (const r of all.institutions) delete r.WEBADDR;
  const f = await runFdic(opts(makeDir(), fakeFdic(all).fetchImpl));
  assert.equal(f.outcome, 'failed');
  assert.deepEqual(f.missingFields, ['institutions.WEBADDR']);
});

test('the run log records when the run finished, not only when it started', async () => {
  const dir = makeDir();
  const s = await runFdic({ ...opts(dir, fakeFdic(TABLES()).fetchImpl), now: new Date('2026-11-13T10:00:00Z'), clock: () => new Date('2026-11-13T10:00:07Z') });
  assert.equal(s.outcome, 'ok');
  const line = readJsonl(join(dir, 'sources', 'runs.jsonl')).at(-1);
  assert.equal(line.startedAt, '2026-11-13T10:00:00.000Z');
  assert.equal(line.finishedAt, '2026-11-13T10:00:07.000Z');
});

test('only quarterly charge-off fields are requested; year-to-date ones never are', async () => {
  for (const f of YTD_FLOW_FIELDS) assert.ok(!FDIC_FIELDS.financials.includes(f), f);
  for (const f of ['NTLNLSQ', 'NTRECONQ', 'NTRENRSQ', 'NTREMULQ']) assert.ok(FDIC_FIELDS.financials.includes(f), f);
  const dir = makeDir();
  const f = fakeFdic(TABLES());
  await runFdic(opts(dir, f.fetchImpl));
  const finCalls = f.calls.filter((c) => c.endpoint === 'financials' && c.fields.includes('NCRENRES'));
  assert.ok(finCalls.length);
  for (const c of finCalls) for (const y of YTD_FLOW_FIELDS) assert.ok(!c.fields.split(',').includes(y), `${y} was requested`);
  const stored = readJson(fdicPaths(dir).financials('101')).quarters['20260630'];
  assert.equal(stored.NTLNLS, undefined);
});

test('a full run writes the bank list, footprint, financials and state, every record sourced to this run', async () => {
  const dir = makeDir();
  const f = fakeFdic(TABLES());
  const s = await runFdic(opts(dir, f.fetchImpl));
  assert.equal(s.outcome, 'ok', JSON.stringify(s));
  assert.equal(s.banks, 2);
  assert.equal(s.latestRepdte, '20260630');
  assert.equal(s.newQuarter, true);
  assert.deepEqual(s.quarters, ['20260331', '20260630']);
  assert.ok(f.calls.some((c) => c.endpoint === 'locations' && c.filters === 'CBSA_NO:(12420 OR 19740 OR 31080)'));

  const p = fdicPaths(dir);
  const inst = readJson(p.institutions);
  assert.equal(inst['102'].STALP, 'SD', 'headquarters state comes from /institutions, not from the branch row (CA)');
  assert.deepEqual(inst['101'].via, { branch: true, hq: false });
  assert.equal(inst['101'].status, 'active');
  assert.equal(inst['102'].status, 'active', 'open-bank assistance is not a failure');
  assert.equal(inst['102'].assistanceOn, '2009-01-16');
  assert.equal(inst['700'], undefined, 'a bank with no branch in the metros is not included without the HQ opt-in');

  const fp = readJson(p.footprint);
  assert.deepEqual(fp['101'].branchesByMetro, { 12420: 2, 19740: 1 });
  assert.equal(fp['101'].sod.year, 2026);
  assert.deepEqual(fp['101'].sod.depositsByMetro, { 12420: 300, 19740: 200 }, 'Denver county 08031 arrives as the number 8031 and is still matched');
  assert.equal(fp['101'].sod.metroShare, 0.5);
  // The total comes from the main-office row even when that row is outside every metro (it used to read 0 from the metro rows).
  assert.equal(fp['102'].sod.totalDeposits, 40000000);
  assert.equal(fp['102'].sod.metroShare, 0.000125);
  assert.ok(s.notes.some((n) => /MSA code different/.test(n)), 'an MSABR disagreement is noted');

  const f101 = readJson(p.financials('101'));
  assert.deepEqual(Object.keys(f101.quarters).sort(), ['20260331', '20260630'], 'only the last N quarters are pulled');
  assert.equal(readJson(p.state).latestRepdte, '20260630');

  const records = [...Object.values(inst), ...Object.values(fp), ...Object.values(fp).map((x) => x.sod).filter(Boolean), ...Object.values(f101.quarters)];
  for (const r of records) { assert.ok(r._source, 'missing _source'); assert.equal(r._source.runId, s.runId); }
  const runs = readJsonl(RUNS(dir));
  assert.equal(runs.length, 1);
  assert.equal(runs[0].outcome, 'ok');
  assert.equal(runs[0].rowsWritten, s.rowsWritten);
});

test('the headquarters-state opt-in adds banks headquartered in the five states', async () => {
  const dir = makeDir();
  const f = fakeFdic(TABLES());
  const s = await runFdic(opts(dir, f.fetchImpl, { includeHq: true }));
  assert.equal(s.outcome, 'ok');
  const inst = readJson(fdicPaths(dir).institutions);
  assert.deepEqual(inst['700'].via, { branch: false, hq: true });
  assert.ok(f.calls.some((c) => c.endpoint === 'institutions' && c.filters === 'STALP:("TX" OR "CO" OR "CA") AND ACTIVE:1'));
  assert.deepEqual(readJson(fdicPaths(dir).footprint)['700'].branchesByMetro, {});
});

test('a re-run updates instead of duplicating; an amended value is logged with old and new', async () => {
  const dir = makeDir();
  const tables = TABLES();
  await runFdic(opts(dir, fakeFdic(tables).fetchImpl));
  const again = await runFdic(opts(dir, fakeFdic(tables).fetchImpl));
  assert.equal(again.newQuarter, false);
  assert.equal(again.changed, 0);
  tables.financials[1] = fin('101', '20260630', { NCRENRES: 4242 });
  const amended = await runFdic(opts(dir, fakeFdic(tables).fetchImpl));
  assert.equal(amended.changed, 1);
  const ch = readJsonl(CHANGES(dir)).find((c) => c.key === 'fdic:101:20260630');
  assert.equal(ch.field, 'NCRENRES');
  assert.equal(ch.new, 4242);
  assert.equal(readJson(fdicPaths(dir).financials('101')).quarters['20260630'].NCRENRES, 4242);
  assert.equal(Object.keys(readJson(fdicPaths(dir).financials('101')).quarters).length, 2);
});

test('a field FDIC did not return fails the run, names the field, and writes nothing', async () => {
  const dir = makeDir();
  const tables = TABLES();
  tables.financials = tables.financials.map(({ NCREMULT, ...rest }) => rest);
  const s = await runFdic(opts(dir, fakeFdic(tables).fetchImpl));
  assert.equal(s.outcome, 'failed');
  assert.deepEqual(s.missingFields, ['financials.NCREMULT']);
  assert.match(s.errors[0], /financials\.NCREMULT \(absent from 4 of 4 rows\)/);
  assert.deepEqual(listFiles(fdicPaths(dir).base), [], 'nothing written under sources/fdic');
  const runs = readJsonl(RUNS(dir));
  assert.equal(runs.length, 1);
  assert.equal(runs[0].outcome, 'failed');
  assert.deepEqual(runs[0].missingFields, ['financials.NCREMULT']);
});

test('a key missing from even one row fails the run and writes nothing', async () => {
  const dir = makeDir();
  const tables = TABLES();
  const { LNRENROT, ...lacking } = tables.financials[0];
  tables.financials[0] = lacking;
  const s = await runFdic(opts(dir, fakeFdic(tables).fetchImpl));
  assert.equal(s.outcome, 'failed');
  assert.deepEqual(s.missingDetail, [{ step: 'financials', field: 'LNRENROT', rowsLacking: 1, rows: 4 }]);
  assert.match(s.errors[0], /absent from 1 of 4 rows/);
  assert.deepEqual(listFiles(fdicPaths(dir).base), []);
});

test('explicit nulls pass the field check and are counted in the summary and the run log', async () => {
  const dir = makeDir();
  const tables = TABLES();
  tables.financials[1] = fin('101', '20260630', { LNRENROT: null, NCRENROT: null });
  tables.financials[3] = fin('102', '20260630', { LNRENROT: null });
  const s = await runFdic(opts(dir, fakeFdic(tables).fetchImpl));
  assert.equal(s.outcome, 'ok', JSON.stringify(s.errors));
  assert.equal(s.nullCounts['financials.LNRENROT'], 2);
  assert.equal(s.nullCounts['financials.NCRENROT'], 1);
  assert.equal(readJsonl(RUNS(dir))[0].nullCounts['financials.LNRENROT'], 2);
  assert.equal(readJson(fdicPaths(dir).financials('101')).quarters['20260630'].LNRENROT, null, 'a null is stored as null, never as 0');
});

test('banks that left the market are flagged, not dropped: failed (FAILURE only), inactive, and left', async () => {
  const dir = makeDir();
  const src = { source: 'fdic', endpoint: '/institutions', query: {}, recordId: 'x', period: '2026-08-01', fetchedAt: '2026-08-01T00:00:00Z', runId: 'old' };
  writeJson(fdicPaths(dir).institutions, {
    998: { CERT: '998', NAME: 'Example Merged Bank', ACTIVE: 1, inUniverse: true, status: 'active', _source: src },
    999: { CERT: '999', NAME: 'Example Failed Bank', ACTIVE: 1, inUniverse: true, status: 'active', _source: src },
  });
  const s = await runFdic(opts(dir, fakeFdic(TABLES()).fetchImpl));
  assert.equal(s.outcome, 'ok');
  const inst = readJson(fdicPaths(dir).institutions);
  assert.equal(inst['999'].status, 'failed');
  assert.equal(inst['999'].failedOn, '2026-07-17');
  assert.equal(inst['998'].status, 'inactive');
  for (const c of ['998', '999']) { assert.equal(inst[c].inUniverse, false); assert.equal(inst[c].leftOn, '2026-11-13'); }
  assert.deepEqual(s.flagged.failed, ['999']);
  assert.deepEqual(s.flagged.inactive, ['998']);
  assert.deepEqual(s.flagged.left.sort(), ['998', '999']);
  assert.ok(readJsonl(CHANGES(dir)).some((c) => c.key === 'fdic:999' && c.field === 'status' && c.old === 'active' && c.new === 'failed'));
  // E3-S5 and E3-S6: how each charter ended. 998 was acquired: it is gone, and the change log says by whom.
  assert.deepEqual(inst['999'].failedSources, ['failures', 'history', 'institutions']);
  assert.deepEqual(inst['998'].acquiredBy, { cert: '101', on: '2026-06-01', transnum: '2026000998', code: 223 });
  assert.equal(inst['998'].closedOn, '2026-06-01');
  assert.deepEqual(inst['998'].endedBy, { code: 223, label: 'Merger - Without Assistance' });
  assert.deepEqual(s.flagged.acquired, ['998']);
  const ch = readJsonl(CHANGES(dir));
  assert.ok(ch.some((c) => c.key === 'fdic:998' && c.field === 'acquiredBy' && c.new.cert === '101'), 'being acquired is in the change log');
  assert.ok(ch.some((c) => c.key === 'fdic:998' && c.field === 'status' && c.old === 'active' && c.new === 'inactive'));
  assert.ok(ch.some((c) => c.key === 'fdic:101' && c.field === 'acquired' && c.new.targetCert === '998'));
  assert.equal(readJson(fdicPaths(dir).events)['2026000998'].targetOnOurList, true);
});

test('no bank matching the metro filter is suspect and writes nothing', async () => {
  const dir = makeDir();
  const tables = TABLES();
  tables.locations = [];
  const s = await runFdic(opts(dir, fakeFdic(tables).fetchImpl));
  assert.equal(s.outcome, 'suspect');
  assert.equal(s.banks, 0);
  assert.deepEqual(listFiles(fdicPaths(dir).base), []);
});

test('an HTTP failure fails the run cleanly and writes nothing but the run log', async () => {
  const dir = makeDir();
  const s = await runFdic(opts(dir, fakeFdic(TABLES(), { failWith: 404 }).fetchImpl));
  assert.equal(s.outcome, 'failed');
  assert.match(s.errors[0], /HTTP 404/);
  assert.deepEqual(listFiles(fdicPaths(dir).base), []);
  assert.equal(readJsonl(RUNS(dir))[0].outcome, 'failed');
});

test('runFdic refuses to run without metros', async () => {
  await assert.rejects(runFdic({ dir: makeDir(), metros: { metros: [] }, fetchImpl: async () => { throw new Error('no network'); } }), /no metros/);
});

// ---- Failures (PRD E3-S5) ---------------------------------------------------------------------------------------------------------
test('dates: FDIC\'s M/D/YYYY and timestamps, the CSV\'s forms, the open-ended 12/31/9999, and months back', () => {
  assert.equal(isoDate('9/25/2026'), '2026-09-25');
  assert.equal(isoDate('09/25/2026'), '2026-09-25');
  assert.equal(isoDate('2026-09-25T00:00:00'), '2026-09-25');
  assert.equal(isoDate('25-Sep-26'), '2026-09-25');
  assert.equal(isoDate('September 25, 2026'), '2026-09-25');
  assert.equal(isoDate('12/31/9999'), null, 'an open bank has no end date');
  assert.equal(isoDate('2/30/2026'), null);
  assert.equal(isoDate(''), null);
  assert.equal(monthsBefore('2026-11-13', 36), '2023-11-13');
  assert.equal(monthsBefore('2026-03-31', 1), '2026-02-28');
});

test('the failure codes are the /history descriptions that mean a failure; an assisted merger is not one', () => {
  assert.deepEqual(FAILURE_CODES, [211, 215, 216, 217, 230, 235]);
  assert.equal(STRUCTURE_CODES[211].label, 'Failure - Whole Institution');
  assert.equal(STRUCTURE_CODES[213].kind, 'assisted-merger');
  assert.equal(STRUCTURE_CODES[224].kind, 'affiliate-reorganization');
});

test('a failure missing from the stale /failures index is still found, from /institutions and /history, placed in a metro, with the FDIC as seller', async () => {
  const dir = makeDir();
  const f = fakeFdic(TABLES());
  const s = await runFdic(opts(dir, f.fetchImpl));
  assert.equal(s.outcome, 'ok', JSON.stringify(s.errors));
  // Failures are looked for nationwide over the lookback window, not only among banks we already know.
  for (const q of ['FAILDATE:[2023-11-13 TO *]', 'ACTIVE:0 AND CHANGEC1:(211 OR 215 OR 216 OR 217 OR 230 OR 235) AND ENDEFYMD:[2023-11-13 TO *]']) assert.ok(f.calls.some((c) => c.filters === q), q);
  const failed = readJson(fdicPaths(dir).failed);
  const x = failed['99999'];
  assert.equal(x.failedOn, '2026-09-25');
  assert.deepEqual(x.agree, ['institutions', 'history']);
  assert.deepEqual(x.missingFrom, ['failures']);
  assert.equal(x.sources.failures, null);
  assert.deepEqual(x.sources.institutions, { on: '2026-09-25', code: 211, label: 'Failure - Whole Institution' });
  assert.equal(x.sources.history.transnum, '2026099999');
  assert.equal(x.inMetros, true);
  assert.deepEqual(x.metros, [{ cbsa: '31080', branches: 1, basis: ['branches in the FDIC structure event', 'main office'] }]);
  assert.equal(x.seller, 'FDIC');
  assert.equal(x.loanSales, FDIC_LOAN_SALES_URL);
  assert.deepEqual(x.lastCre, { repdte: '20260630', value: 15000, fields: { LNRECONS: 4000, LNREMULT: 5000, LNRENRES: 6000 } });
  assert.equal(x._source.endpoint, '/institutions + /history');
  assert.deepEqual(failed['999'].agree, ['failures', 'institutions', 'history'], 'a failure all three know about');
  assert.deepEqual(s.failedInMetros.map((y) => y.cert), ['999', '99999']);
  assert.deepEqual(s.failuresIndex, { builtAt: '2026-08-25T14:13:18Z', lacks: ['99999'] });
  assert.ok(s.notes.some((n) => /\/failures index \(built 2026-08-25T14:13:18Z\) lacks 1 failure\(s\) that \/institutions or \/history show: cert 99999/.test(n)));
  assert.equal(readJson(fdicPaths(dir).state).failuresIndex.lacks, 1);
  // The run log line counts the new pulls, with ids only.
  const line = readJsonl(RUNS(dir)).at(-1);
  assert.ok(line.notes.includes('failures: 2 since 2023-11-13 across failures, institutions, history; 2 with a presence in the metros'), JSON.stringify(line.notes));
  assert.ok(line.notes.includes('history: 3 deals read since 2023-11-13; 1 with a bank on our list on either side (1 new)'));
  assert.ok(!JSON.stringify(line).includes('Example Bank'), 'no bank names in the run log');
  // A failed bank never joins the bank list: that is built from active branches.
  assert.equal(readJson(fdicPaths(dir).institutions)['99999'], undefined);
  assert.ok(readJsonl(CHANGES(dir)).some((c) => c.key === 'fdic:99999' && c.field === 'failed' && c.new.on === '2026-09-25'));
});

test('a bank counts as failed if any one source says so; a failure outside the metros is kept but not in the metros', async () => {
  const t = TABLES();
  t.history = t.history.filter((r) => r.TRANSNUM !== 2026099999);   // only /institutions knows of 99999 now
  t.institutions.push({ CERT: 88888, NAME: 'Example Faraway Bank', CITY: 'Elsewhere', STALP: 'ZZ', ASSET: 1, WEBADDR: '', ACTIVE: 0, INACTIVE: 1, ENDEFYMD: '08/01/2026', CHANGEC1: 230, STCNTY: '99001' });
  const dir = makeDir();
  const s = await runFdic(opts(dir, fakeFdic(t).fetchImpl));
  assert.equal(s.outcome, 'ok', JSON.stringify(s.errors));
  const failed = readJson(fdicPaths(dir).failed);
  assert.deepEqual(failed['99999'].agree, ['institutions']);
  assert.deepEqual(failed['99999'].metros, [{ cbsa: '31080', branches: null, basis: ['main office'] }], 'placed by its main office alone');
  assert.equal(failed['88888'].inMetros, false);
  assert.equal(failed['88888'].sources.institutions.label, 'Closing - Failure Payoff');
  assert.ok(!s.failedInMetros.some((y) => y.cert === '88888'));
});

test('the failed-bank CSV, when a person saved one, is a fourth source: rows in the window count, older rows do not', async () => {
  const dir = makeDir();
  put(dir, 'sources/fdic/failed-banks.csv', FAILED_BANK_CSV);
  const s = await runFdic(opts(dir, fakeFdic(TABLES()).fetchImpl));
  assert.equal(s.outcome, 'ok', JSON.stringify(s.errors));
  const failed = readJson(fdicPaths(dir).failed);
  assert.deepEqual(failed['99999'].agree, ['institutions', 'history', 'csv']);
  assert.deepEqual(failed['99999'].sources.csv, { on: '2026-09-25', acquirer: 'Example Acquiring Bank' });
  assert.deepEqual(failed['999'].agree, ['failures', 'institutions', 'history', 'csv']);
  assert.equal(failed['444'], undefined, 'a 2010 failure is outside the lookback window');
  assert.ok(s.notes.some((n) => /failed-bank CSV: 3 rows read, newest closing 2026-09-25/.test(n)));
  assert.deepEqual(readJson(fdicPaths(dir).state).failedBankCsv, { rows: 3 });
});

test('the CSV parser: quoted commas, a byte-order mark, non-breaking spaces in headers', () => {
  assert.deepEqual(parseCsv('a,"b, c","d ""q"""\r\n1,2,3\n'), [['a', 'b, c', 'd "q"'], ['1', '2', '3']]);
  const r = parseFailedBankCsv(FAILED_BANK_CSV);
  assert.deepEqual(r.missing, []);
  assert.deepEqual(r.rows[0], { cert: '99999', closed: '2026-09-25', name: 'Example Bank, N.A.', city: 'Los Angeles', state: 'CA', acquirer: 'Example Acquiring Bank' });
});

test('a failed-bank CSV whose headers differ fails the run loudly, names what it found, and writes nothing', async () => {
  const dir = makeDir();
  put(dir, 'sources/fdic/failed-banks.csv', FAILED_BANK_CSV.replace('State ', 'ST'));
  const s = await runFdic(opts(dir, fakeFdic(TABLES()).fetchImpl));
  assert.equal(s.outcome, 'failed');
  assert.deepEqual(s.missingFields, ['failed-banks-csv.State']);
  assert.match(s.errors[0], /has no column "State"\. Its headers are: "Bank Name", "City", "ST", "Cert"/);
  assert.deepEqual(listFiles(fdicPaths(dir).base), ['failed-banks.csv'], 'nothing written beside the CSV');
  const bad = makeDir();
  put(bad, 'sources/fdic/failed-banks.csv', `${FAILED_BANK_CSV}\r\nExample Broken Bank,Austin,TX,,No Acquirer,soon,1`);
  const b = await runFdic(opts(bad, fakeFdic(TABLES()).fetchImpl));
  assert.equal(b.outcome, 'failed');
  assert.deepEqual(b.missingFields, ['failed-banks-csv.Cert (a number)']);
});

// ---- Structure events (PRD E3-S6) -------------------------------------------------------------------------------------------------
test('checkHistoryRows: the keys each kind of event has; a failure row without CERT passes, a merger without ACQ_CERT fails', () => {
  const ok = [
    { TRANSNUM: 1, CHANGECODE: 211, EFFDATE: '2026-09-25T00:00:00', OUT_CERT: 9, ACQ_CERT: 8 },   // failure: no CERT, as FDIC sends it
    { TRANSNUM: 2, CHANGECODE: 230, EFFDATE: '2013-09-13T00:00:00', CERT: 7 },                   // payoff: no OUT_CERT or ACQ_CERT
    { TRANSNUM: 3, CHANGECODE: 224, EFFDATE: '2026-10-01T00:00:00', OUT_CERT: 6, ACQ_CERT: 5 },   // affiliate merger: no CERT
  ];
  assert.deepEqual(checkHistoryRows(ok).missing, []);
  const bad = checkHistoryRows([...ok, { TRANSNUM: 4, CHANGECODE: 223, EFFDATE: '2026-10-01T00:00:00', OUT_CERT: 4 }, { TRANSNUM: 5, CHANGECODE: 211, EFFDATE: '2026-10-01T00:00:00' }]);
  assert.deepEqual(bad.missing, [{ field: 'OUT_CERT or CERT', rowsLacking: 1, rows: 5 }, { field: 'ACQ_CERT (merger rows)', rowsLacking: 1, rows: 2 }]);
  assert.deepEqual(eventOf(ok[1]), { transnum: '2', code: 230, kind: 'failure', label: 'Closing - Failure Payoff', effective: '2013-09-13', targetCert: '7', acquirerCert: null });
});

test('a merger by a bank on our list is kept, dated, with the target\'s cert, its branches in the metros and its last CRE book', async () => {
  const dir = makeDir();
  const f = fakeFdic(TABLES());
  const s = await runFdic(opts(dir, f.fetchImpl));
  assert.equal(s.outcome, 'ok', JSON.stringify(s.errors));
  assert.ok(f.calls.some((c) => c.endpoint === 'history' && c.filters === 'CHANGECODE:(211 OR 213 OR 215 OR 216 OR 217 OR 221 OR 222 OR 223 OR 224 OR 230 OR 235) AND EFFDATE:[2023-11-13 TO *]'));
  assert.ok(f.calls.some((c) => c.endpoint === 'history' && c.filters === 'CHANGECODE:713 AND TRANSNUM:(2026000998 OR 2026000999 OR 2026099999)'));
  const ev = readJson(fdicPaths(dir).events);
  assert.deepEqual(Object.keys(ev), ['2026000998'], 'the acquirer-side 810 row and a 2019 deal are not read; failures of banks not on our list go to failed.json');
  const e = ev['2026000998'];
  assert.deepEqual([e.kind, e.code, e.effective, e.acquirerCert, e.targetCert, e.acquirerOnOurList, e.targetInMetros], ['merger', 223, '2026-06-01', '101', '998', true, true]);
  assert.deepEqual(e.targetMetros, [{ cbsa: '19740', branches: 2, basis: ['branches in the FDIC structure event', 'main office'] }]);
  assert.deepEqual(e.targetLastCre, { repdte: '20260331', value: 6000, fields: { LNRECONS: 1000, LNREMULT: 2000, LNRENRES: 3000 } });
  assert.equal(e._source.endpoint, '/history');
  assert.deepEqual(s.structureEvents, { read: 3, kept: 1, new: 1 });
});

test('a structure event is kept after it leaves the lookback window; a re-run changes and logs nothing', async () => {
  const dir = makeDir();
  const tables = TABLES();
  await runFdic(opts(dir, fakeFdic(tables).fetchImpl));
  const lines = readJsonl(CHANGES(dir)).length;
  const again = await runFdic(opts(dir, fakeFdic(tables).fetchImpl));
  assert.equal(again.changed, 0);
  assert.equal(readJsonl(CHANGES(dir)).length, lines, 'no change logged twice');
  const later = await runFdic(opts(dir, fakeFdic({ ...tables, history: [] }).fetchImpl, { now: new Date('2030-01-15T12:00:00Z') }));
  assert.equal(later.outcome, 'ok', JSON.stringify(later.errors));
  assert.ok(readJson(fdicPaths(dir).events)['2026000998'], 'an event signal is a dated change, and it is kept');
  assert.ok(readJson(fdicPaths(dir).failed)['99999'], 'so is a failure');
});

test('a /history row missing a key its event needs fails the run, names it, and writes nothing', async () => {
  const dir = makeDir();
  const t = TABLES();
  delete t.history[0].ACQ_CERT;   // a merger with no acquirer
  const s = await runFdic(opts(dir, fakeFdic(t).fetchImpl));
  assert.equal(s.outcome, 'failed');
  assert.deepEqual(s.missingFields, ['history.ACQ_CERT (merger rows)']);
  assert.deepEqual(listFiles(fdicPaths(dir).base), []);
});

test('placeInMetros: last footprint, the deal\'s branches and the main office, each named; earlier placements are kept', () => {
  const m = placeInMetros({ metros: METROS, hqCounty: '6037', lastFootprint: { branchesByMetro: { 12420: 3, 99999: 4 } }, branchRows: [{ OFF_PSTNUM: 8, OFF_CNTYNUM: 31 }, { OFF_PSTNUM: 48, OFF_CNTYNUM: 453 }, { OFF_PSTNUM: 1, OFF_CNTYNUM: 1 }] });
  assert.deepEqual(m, [
    { cbsa: '12420', branches: 3, basis: ['branches in our last footprint', 'branches in the FDIC structure event'] },
    { cbsa: '19740', branches: 1, basis: ['branches in the FDIC structure event'] },
    { cbsa: '31080', branches: null, basis: ['main office'] },
  ]);
  assert.deepEqual(placeInMetros({ metros: METROS, previous: [{ cbsa: '19740', branches: 2, basis: ['branches in our last footprint'] }] }), [{ cbsa: '19740', branches: 2, basis: ['branches in our last footprint'] }]);
  assert.deepEqual(placeInMetros({ metros: METROS, hqCounty: '99001' }), []);
});

// ---- The concentration screen's fields (PRD E3-S7) ------------------------------------------------------------------------------
test('the screen\'s capital fields ride on the 8-quarter pull; the 36-month base is ONE extra quarter, kept apart from the quarters', async () => {
  for (const x of ['LNCOMRE', 'RBC', 'RBCT1J', 'LNATRES', 'CBLRIND']) assert.ok(FDIC_FIELDS.financials.includes(x), x);
  const dir = makeDir();
  const f = fakeFdic(TABLES());
  await runFdic(opts(dir, f.fetchImpl));
  const finCalls = f.calls.filter((c) => c.endpoint === 'financials' && /^CERT:\(101 OR 102\)/.test(c.filters ?? ''));
  assert.deepEqual(finCalls.map((c) => c.filters), ['CERT:(101 OR 102) AND REPDTE:[20260331 TO 20260630]', 'CERT:(101 OR 102) AND REPDTE:20230630']);
  assert.equal(finCalls[1].fields, FDIC_FIELDS.growthBase.join(','));
  const file = readJson(fdicPaths(dir).financials('101'));
  assert.deepEqual(Object.keys(file.quarters).sort(), ['20260331', '20260630']);
  assert.deepEqual(Object.keys(file.growthBase), ['20230630']);
  assert.deepEqual(Object.keys(file.growthBase['20230630']).filter((k) => k !== '_source').sort(), [...FDIC_FIELDS.growthBase].sort());
  assert.equal(file.growthBase['20230630']._source.period, '20230630');
  assert.equal(readJson(fdicPaths(dir).state).growthBaseRepdte, '20230630');
});

test('a capital field FDIC did not return fails the run like any other field', async () => {
  const dir = makeDir();
  const t = TABLES();
  t.financials = t.financials.map(({ CBLRIND, ...rest }) => rest);
  const s = await runFdic(opts(dir, fakeFdic(t).fetchImpl));
  assert.equal(s.outcome, 'failed');
  assert.ok(s.missingFields.includes('financials.CBLRIND'));
});

test('no file in the repository holds FDIC data written by a test (tests write only to temp folders)', () => {
  assert.equal(existsSync(join(fdicPaths(process.cwd()).base)), false);
  assert.ok(readFileSync(new URL('../src/sources/fdic.mjs', import.meta.url), 'utf8').includes('FIELD:("A" OR "B")'));
});
