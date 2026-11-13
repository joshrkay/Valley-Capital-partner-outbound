// The FDIC adapter (PRD E2-S2, E3-S1, E3-S2) against a fake FDIC server. Invented banks and numbers only; no network.
// The fake mimics the real API where it matters: `FIELD:(A OR B)` lists, `[A TO B]` ranges, paging by offset, sorting,
// and silently dropping fields it does not know (verified behavior of the real API, 2026-11-13).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runFdic, fdicQuery, orFilter, checkFields, quartersBack, FDIC_FIELDS, YTD_FLOW_FIELDS, fdicPaths } from '../src/sources/fdic.mjs';
import { RUNS, CHANGES } from '../src/sources/runlog.mjs';
import { readJson, readJsonl, writeJson } from '../src/store.mjs';
import { makeDir } from './kit.mjs';

const unq = (v) => v.replace(/^"|"$/g, '');
function matches(row, clause) {
  const m = /^(\w+):(.*)$/.exec(clause.trim());
  if (!m) throw new Error(`fake FDIC: cannot parse ${clause}`);
  const [, field, expr] = m;
  const v = row[field];
  if (v === undefined) return false;
  if (expr.startsWith('[')) { const [lo, hi] = expr.slice(1, -1).split(' TO '); return String(v) >= lo && String(v) <= hi; }
  if (expr.startsWith('(')) {
    if (expr.includes(',')) return false;   // the real API returns nothing for the comma form
    return expr.slice(1, -1).split(' OR ').map(unq).some((x) => String(v) === x || Number(v) === Number(x));
  }
  return String(v) === unq(expr) || Number(v) === Number(unq(expr));
}
const splitAnd = (f) => (f ? f.split(/ AND (?![^(]*\))/) : []);

function fakeFdic(tables, { totalBump = 0, failWith } = {}) {
  const calls = [];
  const fetchImpl = async (url) => {
    const u = new URL(url);
    const endpoint = u.pathname.split('/').pop();
    const p = Object.fromEntries(u.searchParams);
    calls.push({ endpoint, ...p });
    if (failWith) return new Response('{}', { status: failWith });
    let rows = (tables[endpoint] ?? []).filter((r) => splitAnd(p.filters).every((c) => matches(r, c)));
    if (p.sort_by) rows = [...rows].sort((a, b) => (String(a[p.sort_by]) < String(b[p.sort_by]) ? -1 : 1) * (p.sort_order === 'DESC' ? -1 : 1));
    const limit = Number(p.limit ?? 10), offset = Number(p.offset ?? 0);
    const fields = p.fields ? p.fields.split(',') : null;
    const page = rows.slice(offset, offset + limit).map((r, i) => ({ data: { ...(fields ? Object.fromEntries(fields.filter((f) => f in r).map((f) => [f, r[f]])) : r), ID: `id-${offset + i}` } }));
    return new Response(JSON.stringify({ meta: { total: rows.length + totalBump }, data: page }), { status: 200 });
  };
  return { fetchImpl, calls };
}

const METROS = {
  metros: [
    { cbsa: '12420', label: 'Austin', counties: { 48453: 'Travis' } },
    { cbsa: '19740', label: 'Denver', counties: { '08031': 'Denver' } },
    { cbsa: '31080', label: 'Los Angeles', counties: { '06037': 'Los Angeles' } },
  ],
  hqStates: ['TX', 'CO', 'CA'],
};

const fin = (cert, repdte, over = {}) => ({
  ...Object.fromEntries(FDIC_FIELDS.financials.map((f, i) => [f, 100 + i])),
  NTLNLS: 999999,   // a year-to-date field exists in the source but must never be requested
  CERT: cert, REPDTE: repdte, ...over,
});

// Banks: 101 Austin+Denver (HQ TX); 102 a branch in Los Angeles but HQ in SD (open, received assistance long ago);
// 998 and 999 were in the market last run and are not now: 998 closed without failing, 999 failed.
const TABLES = () => ({
  locations: [
    { CERT: '101', CBSA_NO: '12420', CBSA: 'Austin-Round Rock-Georgetown, TX', COUNTY: 'Travis', STCNTY: '48453', STALP: 'TX', MAINOFF: 1 },
    { CERT: '101', CBSA_NO: '12420', CBSA: 'Austin-Round Rock-Georgetown, TX', COUNTY: 'Travis', STCNTY: '48453', STALP: 'TX', MAINOFF: 0 },
    { CERT: '101', CBSA_NO: '19740', CBSA: 'Denver-Aurora-Lakewood, CO', COUNTY: 'Denver', STCNTY: '08031', STALP: 'CO', MAINOFF: 0 },
    { CERT: '102', CBSA_NO: '31080', CBSA: 'Los Angeles-Long Beach-Anaheim, CA', COUNTY: 'Los Angeles', STCNTY: '06037', STALP: 'CA', MAINOFF: 0 },
    { CERT: '555', CBSA_NO: '99999', CBSA: 'Elsewhere', COUNTY: 'Other', STCNTY: '99001', STALP: 'ZZ', MAINOFF: 1 },
  ],
  institutions: [
    { CERT: 101, NAME: 'Example Hill Country Bank', CITY: 'Austin', STALP: 'TX', ASSET: 900000, WEBADDR: 'www.example.test', ACTIVE: 1 },
    { CERT: 102, NAME: 'Example National Bank', CITY: 'Sioux Falls', STALP: 'SD', ASSET: 50000000, WEBADDR: 'www.example2.test', ACTIVE: 1 },
    // FDIC sends a value it lacks as an explicit null with the key present.
    { CERT: 998, NAME: 'Example Merged Bank', CITY: 'Denver', STALP: 'CO', ASSET: 1, WEBADDR: null, ACTIVE: 0 },
    { CERT: 999, NAME: 'Example Failed Bank', CITY: 'Phoenix', STALP: 'AZ', ASSET: 1, WEBADDR: null, ACTIVE: 0 },
    { CERT: 700, NAME: 'Example Rural Bank', CITY: 'Elsewhere', STALP: 'TX', ASSET: 50000, WEBADDR: null, ACTIVE: 1 },
  ],
  failures: [
    { CERT: 102, NAME: 'EXAMPLE NATIONAL BANK', FAILDATE: '1/16/2009', RESTYPE: 'ASSISTANCE' },
    { CERT: 999, NAME: 'EXAMPLE FAILED BANK', FAILDATE: '7/17/2026', RESTYPE: 'FAILURE' },
  ],
  sod: [
    { CERT: 101, YEAR: 2026, STCNTYBR: 48453, MSABR: 12420, DEPSUMBR: 300, DEPSUM: 1000, CNTYNAMB: 'Travis', STALPBR: 'TX' },
    { CERT: 101, YEAR: 2026, STCNTYBR: 8031, MSABR: 0, DEPSUMBR: 200, DEPSUM: 1000, CNTYNAMB: 'Denver', STALPBR: 'CO' },
    { CERT: 102, YEAR: 2026, STCNTYBR: 6037, MSABR: 31080, DEPSUMBR: 5000, DEPSUM: 40000000, CNTYNAMB: 'Los Angeles', STALPBR: 'CA' },
    { CERT: 101, YEAR: 2025, STCNTYBR: 48453, MSABR: 12420, DEPSUMBR: 1, DEPSUM: 1, CNTYNAMB: 'Travis', STALPBR: 'TX' },
  ],
  financials: [fin('101', '20260331'), fin('101', '20260630'), fin('102', '20260331'), fin('102', '20260630'), fin('101', '20251231')],
});

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

test('no file in the repository holds FDIC data written by a test (tests write only to temp folders)', () => {
  assert.equal(existsSync(join(fdicPaths(process.cwd()).base)), false);
  assert.ok(readFileSync(new URL('../src/sources/fdic.mjs', import.meta.url), 'utf8').includes('FIELD:("A" OR "B")'));
});
