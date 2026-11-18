// The weekly triage (PRD E6-S5). Invented institutions and numbers only; no network, no model.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { makeDir, put, loadJson, REPO } from './kit.mjs';
import { runTriage, renderTriage, readTriage, validateTriageRules, calendarBlock, nextQuarterEnd, lastQuarterEnd, nextMonthDay, triageLoads, triageSummary, FINDING_TYPES } from '../src/triage.mjs';
import { LOADS, snapshotFromDir, withUnitOfWork, applyPlanToDir } from '../src/uow.mjs';
import { indexUrl } from '../src/sources/filings.mjs';

const metros = loadJson('metros.json');
const scoring = loadJson('scoring.json');
const rules = () => structuredClone(loadJson('triage.json'));
const LAST = new Date('2026-11-09T14:00:00Z');   // a Monday: the previous triage
const NOW = new Date('2026-11-16T14:00:00Z');    // the Monday after
const LOAN_SALES = 'https://www.fdic.gov/resources/resolutions/asset-sales/loan-sales';

// ---- An invented world ----------------------------------------------------------------------------------------------------------
const state = (cert, type, rep = '20260630') => ({ id: `fdic:${cert}:${type}:${rep}`, type, kind: 'state', label: `Example rule ${type}`, period: rep, evidence: [`fdic:${cert}:${rep}`], rule: 'rising' });
const acq = (cert, transnum, effective) => ({ id: `fdic:${cert}:acquired-metro-bank:${transnum}`, type: 'acquired-metro-bank', kind: 'event', rule: 'acquisition', eventKind: 'merger', transnum, effective, period: effective, targetCert: '9001', metros: [{ cbsa: '38060', label: 'Phoenix', branches: 3 }], evidence: [] });
const cand = (cert, name, tier, signals = [], over = {}) => ({ key: `fdic:${cert}`, cert: String(cert), name, tier, score: tier === 'A' ? 60 : tier === 'B' ? 30 : 5, axes: { distress: 20, fit: 20, timing: 10 }, filtersFailed: [], signals, latestRepdte: '20260630', ...over });
const latestDoc = (items, over = {}) => ({ runId: 'score-1', scoredAt: '2026-11-16T13:00:00.000Z', asOf: '2026-11-16', latestRepdte: '20260630', provisional: false, items, failedBanks: [], ...over });
const acc = (n) => `0000000001-26-${String(n).padStart(6, '0')}`;
const filing = (n, bank, searches, fileDate, firstSeenAt) => ({ n, bank, searches, fileDate, firstSeenAt });
const loan = (n, over = {}) => ({ key: `cmbs:1001:${n}`, cik: '1001', assetNumber: String(n), period: '2026-10-31', metros: ['31080'], sectors: ['multifamily'], specialServicer: 'Example Special Servicing LLC', specialServicingSince: null, signals: [], paidOff: false, properties: [{ name: 'Example Apartments' }], ...over });
const failure = (cert, name, failedOn, over = {}) => ({ cert: String(cert), name, failedOn, inMetros: true, metros: [{ cbsa: '31080', branches: 2, basis: ['main office'] }], seller: 'FDIC', loanSales: LOAN_SALES, ...over });
const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';

function writeFilings(dir, list) {
  const filers = {}, recs = {};
  for (const f of list) {
    const cik = `99${f.bank.slice(5).padStart(5, '0')}`;
    filers[f.bank] = { ciks: { [cik]: { status: 'confirmed', by: 'Pat Example', at: '2026-11-01T00:00:00Z' } } };
    recs[acc(f.n)] = { key: `sec:${acc(f.n)}`, accession: acc(f.n), form: '8-K', fileDate: f.fileDate, searches: f.searches, filerCiks: [cik], items: [], cik, link: indexUrl(cik, acc(f.n)), firstSeenAt: f.firstSeenAt };
  }
  put(dir, 'sources/edgar/filers.json', filers);
  put(dir, 'sources/edgar/filings.json', recs);
}

function world({ items = [], latestOver = {}, decisions, aliases, touches = [], accounts = [], suppression, runs = [], failed, loans, filings = [], fdicState } = {}, dir = makeDir()) {
  if (items !== null) put(dir, 'candidates/latest.json', latestDoc(items, latestOver));
  if (decisions) put(dir, 'candidates/decisions.json', decisions);
  if (aliases) put(dir, 'candidates/aliases.json', aliases);
  if (touches.length) put(dir, 'touches.jsonl', jsonl(touches));
  for (const a of accounts) put(dir, `accounts/${a.id}.json`, a);
  if (suppression) put(dir, 'suppression.json', { entries: suppression });
  if (runs.length) put(dir, 'sources/runs.jsonl', jsonl(runs));
  if (failed) put(dir, 'sources/fdic/failed.json', failed);
  if (loans) put(dir, 'sources/edgar/loans.json', Object.fromEntries(loans.map((l) => [l.key, l])));
  if (filings.length) writeFilings(dir, filings);
  if (fdicState) put(dir, 'sources/fdic/state.json', fdicState);
  return dir;
}
const run = (dir, { now = NOW, since, r = rules() } = {}) => runTriage({ dir, rules: r, metros, scoring, now, since });
const all = (t) => [...t.actNow, ...t.watch, ...t.inConversation];
const where = (t, key) => all(t).find((i) => i.key === key) ?? null;
const types = (item) => item.findings.map((f) => f.type);
const read = (dir, rel) => JSON.parse(readFileSync(join(dir, rel), 'utf8'));

// ---- The rules file ---------------------------------------------------------------------------------------------------------------
test('the committed triage.json is valid, holds no prospect data, and every section carries a _note', () => {
  const r = rules();
  assert.deepEqual(validateTriageRules(r), []);
  assert.match(r._note, /PLACEHOLDER/);
  for (const [k, v] of Object.entries(r)) if (v && typeof v === 'object') assert.match(String(v._note ?? ''), /PLACEHOLDER/, `${k} needs a _note saying its values are placeholders`);
  const searches = loadJson('filings.json').searches.map((s) => s.id);
  for (const id of r.actNow.secFilingSearches) assert.ok(searches.includes(id), `actNow.secFilingSearches: ${id} is not a search in filings.json`);
  const conc = scoring.concentration.signals.map((s) => s.id);
  for (const id of r.actNow.concentrationOnTierA) assert.ok(conc.includes(id), `actNow.concentrationOnTierA: ${id} is not a concentration signal in scoring.json`);
  assert.deepEqual(Object.keys(r.strength).filter((k) => k !== '_note').sort(), [...FINDING_TYPES].sort());
  assert.doesNotMatch(readFileSync(join(REPO, 'triage.json'), 'utf8'), /fdic:\d|cmbs:\d|@|\bBank\b/, 'a rule file names no institution, key or address');
});

test('bad rules are refused with every reason', () => {
  const r = rules();
  r.window.defaultDays = 0; r.watch.stateSignalTiers = ['C']; delete r.strength['state-off']; r.optOut.events = ['reply']; r.inConversation.events = ['opt_out']; r.calendar.cmbsReportingDay = 32; r.actNow.moveToTierA = 'yes';
  const e = validateTriageRules(r);
  for (const m of [/window.defaultDays/, /stateSignalTiers/, /strength.state-off/, /optOut.events/, /inConversation.events/, /cmbsReportingDay/, /actNow.moveToTierA/]) assert.ok(e.some((x) => m.test(x)), String(m));
  assert.throws(() => run(world(), { r }), /triage.json has errors/);
  assert.throws(() => run(world(), { since: '2026-13-01' }), /--since needs a date/);
  assert.throws(() => run(world(), { since: true }), /--since needs a date/);
  assert.throws(() => run(world(), { since: '2026-11-17' }), /in the future/);
});

// ---- The first run -------------------------------------------------------------------------------------------------------------
test('the first run has no snapshot: it says so, reports only events dated in the window, and writes the triage and the snapshot', () => {
  const dir = world({
    items: [cand(1, 'Alpha Example Bank', 'A', [state(1, 'cre-noncurrent-rising'), acq(1, '5001', '2026-11-12')]), cand(2, 'Bravo Example Bank', 'B'), cand(3, 'Charlie Example Bank', null)],
    filings: [filing(1, 'fdic:2', ['loan-sale-cre'], '2026-11-12', '2026-11-13T23:40:00.000Z'), filing(2, 'fdic:3', ['loan-sale-cre'], '2026-10-01', '2026-10-02T23:40:00.000Z')],
    failed: { 77: failure(77, 'Golf Example Bank', '2026-11-13') },
    loans: [loan(1, { signals: [{ type: 'note_sale' }] })],
  });
  const t = run(dir);
  assert.equal(t.firstRun, true);
  assert.match(t.note, /^First triage, no comparison/);
  assert.equal(t.comparedWith, null);
  assert.equal(t.window.basis, 'default');
  assert.equal(t.window.from, '2026-11-09T14:00:00.000Z');
  // No candidate-list diff on a first run: Alpha is Tier A, but there is nothing to compare with.
  assert.ok(!all(t).some((i) => i.findings.some((f) => ['new-tier-a', 'new-tier-b', 'state-on'].includes(f.type))));
  assert.deepEqual(t.actNow.map((i) => [i.key, types(i)]), [['fdic:77', ['failure-in-metros']], ['fdic:2', ['sec-filing-strong']]]);
  assert.deepEqual(t.watch.map((i) => [i.key, types(i)]), [['fdic:1', ['acquisition']]]);
  assert.equal(where(t, 'fdic:3'), null, 'a filing first seen before the window is not new');
  assert.equal(where(t, 'servicer:Example Special Servicing LLC'), null, 'a note sale cannot be called new without a snapshot');
  assert.deepEqual(t.baseline, { tierA: 1, tierB: 1, cmbsNoteSale: 1, cmbsSpecialServicing: 0, eventsSeen: 5 });
  // Written to the data folder: the day's triage (JSON and Markdown) and the snapshot.
  assert.deepEqual(readdirSync(join(dir, 'triage')).sort(), ['2026-11-16.json', '2026-11-16.md', 'state.json']);
  assert.deepEqual(read(dir, 'triage/2026-11-16.json'), JSON.parse(JSON.stringify(t)));
  const md = readFileSync(join(dir, 'triage/2026-11-16.md'), 'utf8');
  assert.match(md, /^# Weekly triage: November 16, 2026/);
  assert.match(md, /First triage, no comparison/);
  assert.match(md, /never sent to anyone and never given to the drafter/);
  const snap = read(dir, 'triage/state.json');
  assert.deepEqual(Object.keys(snap.candidates), ['fdic:1', 'fdic:2', 'fdic:3']);
  assert.equal(snap.candidates['fdic:1'].tier, 'A');
  assert.deepEqual(snap.candidates['fdic:1'].signals.map((s) => s.type).sort(), ['acquired-metro-bank', 'cre-noncurrent-rising']);
  assert.ok(snap.seen[`sec-filing:${acc(2)}:strong`], 'events outside the window are still recorded as seen');
  assert.ok(snap.seen['cmbs:1001:1:note_sale']);
  assert.equal(snap.baseline, null);
  // The audit line carries counts only.
  const line = readFileSync(join(dir, 'audit.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).find((l) => l.type === 'triage_run');
  assert.deepEqual([line.actNow, line.watch, line.firstRun], [2, 1, true]);
  assert.doesNotMatch(JSON.stringify(line), /Example|fdic:|cmbs:|servicer/);
});

// ---- Every kind of change ----------------------------------------------------------------------------------------------------
test('each diff against the snapshot: new candidates, tier changes, drop-outs, and state signals on and off', () => {
  const before = [
    cand(1, 'Alpha Example Bank', 'B'), cand(2, 'Bravo Example Bank', 'A'), cand(3, 'Charlie Example Bank', 'A'), cand(4, 'Delta Example Bank', 'A'),
    cand(5, 'Echo Example Bank', 'B', [state(5, 'cre-oreo-up')]), cand(6, 'Foxtrot Example Bank', 'A'), cand(7, 'Golf Example Bank', 'B'),
    cand(8, 'Hotel Example Bank', null), cand(9, 'India Example Bank', null), cand(10, 'Juliet Example Bank', 'A', [state(10, 'cre-oreo-up', '20260331')]),
  ];
  const dir = world({ items: before });
  run(dir, { now: LAST });
  world({ latestOver: { runId: 'score-2' }, items: [
    cand(1, 'Alpha Example Bank', 'A'), cand(2, 'Bravo Example Bank', 'B'), cand(3, 'Charlie Example Bank', null),
    cand(5, 'Echo Example Bank', 'B'), cand(6, 'Foxtrot Example Bank', 'A', [state(6, 'concentration-cre'), state(6, 'cre-noncurrent-rising')]),
    cand(7, 'Golf Example Bank', 'B', [state(7, 'concentration-construction')]), cand(8, 'Hotel Example Bank', 'A'), cand(9, 'India Example Bank', 'B'),
    cand(10, 'Juliet Example Bank', 'A', [state(10, 'cre-oreo-up', '20260630')]),   // the same state signal, a new quarter: no change
  ] }, dir);
  const t = run(dir);
  assert.equal(t.firstRun, false);
  assert.equal(t.comparedWith.date, '2026-11-09');
  assert.equal(t.window.basis, 'lastTriage');
  assert.deepEqual(t.actNow.map((i) => [i.key, types(i)]), [['fdic:8', ['new-tier-a']], ['fdic:1', ['tier-up-a']], ['fdic:6', ['concentration-tier-a', 'state-on']]]);
  assert.deepEqual(t.watch.map((i) => [i.key, types(i)]), [['fdic:9', ['new-tier-b']], ['fdic:2', ['tier-down-b']], ['fdic:7', ['state-on']], ['fdic:3', ['dropped']], ['fdic:4', ['dropped']], ['fdic:5', ['state-off']]]);
  assert.equal(where(t, 'fdic:10'), null, 'a state signal carried into a new quarter is not a change');
  const reason = (k) => where(t, k).reason;
  assert.match(reason('fdic:1'), /^Moved from Tier B to Tier A: score 60 \(distress 20, fit 20, timing 10\) on data as of June 30, 2026\.$/);
  assert.match(reason('fdic:8'), /^New candidate at Tier A: /);
  assert.match(reason('fdic:6'), /^A Tier A bank now meets the CRE concentration screen: Example rule concentration-cre, as of June 30, 2026\.$/);
  assert.match(reason('fdic:7'), /^New signal: Example rule concentration-construction/, 'the concentration screen at a Tier B bank is watch');
  assert.match(reason('fdic:3'), /^Dropped out of the candidate list: it was Tier A, and its score is now below the Tier B cut\.$/);
  assert.match(reason('fdic:4'), /no longer scores it/);
  assert.match(reason('fdic:5'), /^Signal no longer on: Foreclosed commercial property up from last quarter\.$/, 'the title is built from the rule in scoring.json');
  assert.deepEqual(where(t, 'fdic:6').ids, ['fdic:6:concentration-cre:20260630', 'fdic:6:cre-noncurrent-rising:20260630']);
  assert.deepEqual(where(t, 'fdic:1').links, { candidate: '/candidates/fdic%3A1', account: null, servicer: null, filings: [], fdicLoanSales: null });
  assert.equal(where(t, 'fdic:1').tier, 'A');
});

test('new events since the window began: SEC filings, acquisitions, failures in our metros, CMBS loans, and a new FDIC quarter', () => {
  const items = [cand(1, 'Alpha Example Bank', 'A'), cand(2, 'Bravo Example Bank', 'B')];
  const oldFiling = filing(1, 'fdic:1', ['loan-sale-cre'], '2026-10-20', '2026-10-21T23:40:00.000Z');
  const dir = world({ items, filings: [oldFiling], loans: [loan(1, { signals: [{ type: 'special_servicing' }], specialServicingSince: '2026-10-15' })], fdicState: { latestRepdte: '20260630', checkedAt: '2026-11-09T13:45:00.000Z' } });
  run(dir, { now: LAST });
  world({
    items: [cand(1, 'Alpha Example Bank', 'A', [acq(1, '5001', '2026-11-12')]), cand(2, 'Bravo Example Bank', 'B')],
    filings: [oldFiling, filing(2, 'fdic:1', ['transferred-held-for-sale-cre'], '2026-11-12', '2026-11-12T23:40:00.000Z'), filing(3, 'fdic:2', ['8k-impairment'], '2026-11-13', '2026-11-13T23:40:00.000Z')],
    failed: { 77: failure(77, 'Golf Example Bank', '2026-11-13'), 78: failure(78, 'Hotel Example Bank', '2026-11-13', { inMetros: false, metros: [] }) },
    loans: [loan(1, { signals: [{ type: 'special_servicing' }], specialServicingSince: '2026-10-15' }), loan(2, { signals: [{ type: 'note_sale' }, { type: 'special_servicing' }], specialServicingSince: '2026-08-01' }),
      loan(3, { specialServicer: 'Other Example Servicer LLC', metros: ['29820'], sectors: ['hospitality'], signals: [{ type: 'special_servicing' }], specialServicingSince: '2026-11-10' })],
    fdicState: { latestRepdte: '20260930', previousRepdte: '20260630', checkedAt: '2026-11-16T13:45:00.000Z' },
  }, dir);
  const t = run(dir);
  assert.deepEqual(t.actNow.map((i) => [i.key, types(i)]), [
    ['servicer:Example Special Servicing LLC', ['cmbs-note-sale']], ['fdic:77', ['failure-in-metros']], ['fdic:1', ['sec-filing-strong', 'acquisition']],
  ]);
  assert.deepEqual(t.watch.map((i) => [i.key, types(i)]), [['fdic:2', ['sec-filing']], ['servicer:Other Example Servicer LLC', ['cmbs-special-servicing']]]);
  assert.equal(where(t, 'fdic:78'), null, 'a failure outside our metros is not listed');
  const svc = where(t, 'servicer:Example Special Servicing LLC');
  assert.equal(svc.reason, 'A CMBS loan in Los Angeles (multifamily) is newly coded for a note sale (workout code 5); Example Special Servicing LLC is its special servicer.');
  assert.deepEqual([svc.ids, svc.links.servicer], [['cmbs:1001:2:note_sale'], '/servicers/Example%20Special%20Servicing%20LLC']);
  assert.ok(!svc.findings.some((f) => f.type === 'cmbs-special-servicing'), 'a transfer older than maxEventAgeDays is not new');
  assert.doesNotMatch(JSON.stringify(t), /Example Apartments/, 'no property is ever named');
  const fail = where(t, 'fdic:77');
  assert.match(fail.reason, /^It failed on November 13, 2026, with a presence in Los Angeles\. The FDIC is the seller of its loans/);
  assert.equal(fail.links.fdicLoanSales, LOAN_SALES);
  const alpha = where(t, 'fdic:1');
  assert.match(alpha.reason, /^An SEC filing matched a loan-sale or held-for-sale search: Loans transferred to held for sale, in a filing that mentions commercial real estate \(8-K, filed 2026-11-12\)\.$/);
  assert.match(alpha.findings[1].reason, /^It acquired a bank \(FDIC cert 9001\) with a presence in Phoenix, effective November 12, 2026\.$/);
  assert.deepEqual(alpha.links.filings, [indexUrl('9900001', acc(2))]);
  assert.deepEqual(alpha.dates, ['2026-11-12']);
  assert.ok(!alpha.ids.includes(`sec-filing:${acc(1)}`), 'a filing the last triage saw is not new again');
  assert.match(where(t, 'servicer:Other Example Servicer LLC').reason, /in Las Vegas \(hospitality\) moved to special servicing on November 10, 2026; Other Example Servicer LLC/);
  assert.deepEqual([t.fdicQuarter.newlyPublished, t.fdicQuarter.previous, t.fdicQuarter.latest], [true, '20260630', '20260930']);
  assert.match(t.fdicQuarter.line, /A new FDIC quarter is published: September 30, 2026 \(before: June 30, 2026\)\./);
  assert.equal(t.health.scoring.status, 'behind', 'scoring has not caught up with the new quarter');
  // A week later, with nothing new: nothing is reported twice.
  const next = run(dir, { now: new Date('2026-11-23T14:00:00Z') });
  assert.deepEqual([next.actNow.length, next.watch.length, next.fdicQuarter.newlyPublished], [0, 0, false]);
});

test('an event found late is reported once, with a note; one dated before maxEventAgeDays never is', () => {
  const dir = world({ items: [] });
  run(dir, { now: LAST });
  world({ items: [], failed: { 77: failure(77, 'Golf Example Bank', '2026-10-20'), 79: failure(79, 'Kilo Example Bank', '2026-06-01') } }, dir);
  const t = run(dir);
  assert.deepEqual(t.actNow.map((i) => i.key), ['fdic:77']);
  assert.match(t.actNow[0].reason, /Dated October 20, 2026, before this window: first seen since the last triage\.$/);
  assert.equal(run(dir, { now: new Date('2026-11-23T14:00:00Z') }).actNow.length, 0);
});

// ---- Category rules ----------------------------------------------------------------------------------------------------------
test('category rules come from triage.json: hard filters, toggles, and the order by category, strength and date', () => {
  const items = [cand(1, 'Alpha Example Bank', 'A'), cand(2, 'Bravo Example Bank', null, [], { filtersFailed: ['total assets are above the cap'] })];
  const dir = world({ items });
  run(dir, { now: LAST });
  world({ items: [...items, cand(3, 'Charlie Example Bank', 'A')],
    filings: [filing(1, 'fdic:1', ['loan-sale-cre'], '2026-11-10', '2026-11-10T23:40:00.000Z'), filing(2, 'fdic:2', ['loan-sale-cre'], '2026-11-12', '2026-11-12T23:40:00.000Z'),
      filing(3, 'fdic:4', ['note-sale-cre'], '2026-11-11', '2026-11-11T23:40:00.000Z'), filing(4, 'fdic:3', ['loan-sale-cre'], '2026-11-13', '2026-11-13T23:40:00.000Z')],
    loans: [loan(1, { signals: [{ type: 'note_sale' }] })] }, dir);
  const t = run(dir);
  // Strength first (the note sale), then the newest date (Charlie's filing, Nov 13, before Alpha's, Nov 10).
  assert.deepEqual(t.actNow.map((i) => i.key), ['servicer:Example Special Servicing LLC', 'fdic:3', 'fdic:1']);
  assert.deepEqual(types(where(t, 'fdic:3')), ['sec-filing-strong', 'new-tier-a']);
  assert.deepEqual(t.watch.map((i) => [i.key, i.findings[0].category, i.notes?.[0]]), [
    ['fdic:2', 'watch', 'It fails a hard filter (total assets are above the cap), so it is listed under watch.'],
    ['fdic:4', 'watch', 'It is not in the latest candidate list, so it is listed under watch.'],
  ]);
  // Every act-now rule can be turned off in triage.json, and its findings fall back to watch.
  const off = rules();
  Object.assign(off.actNow, { cmbsNoteSale: false, moveToTierA: false, secFilingSearches: [], requirePassesFilters: false });
  const dir2 = world({ items });
  run(dir2, { now: LAST, r: off });
  world({ items: [...items, cand(3, 'Charlie Example Bank', 'A')], filings: [filing(2, 'fdic:2', ['loan-sale-cre'], '2026-11-12', '2026-11-12T23:40:00.000Z')], loans: [loan(1, { signals: [{ type: 'note_sale' }] })] }, dir2);
  const t2 = run(dir2, { r: off });
  assert.equal(t2.actNow.length, 0);
  assert.deepEqual(t2.watch.map((i) => [i.key, types(i)]), [['servicer:Example Special Servicing LLC', ['cmbs-note-sale']], ['fdic:3', ['new-tier-a']], ['fdic:2', ['sec-filing']]]);
});

test('an act-now item leads with its act-now finding, whatever the strengths say', () => {
  const r = rules(); r.strength.acquisition = 99;
  const dir = world({ items: [cand(1, 'Alpha Example Bank', 'B')] });
  run(dir, { now: LAST, r });
  world({ items: [cand(1, 'Alpha Example Bank', 'A', [acq(1, '5001', '2026-11-12')])] }, dir);
  const t = run(dir, { r });
  assert.deepEqual([t.actNow[0].key, types(t.actNow[0]), t.actNow[0].strength], ['fdic:1', ['tier-up-a', 'acquisition'], 80]);
  assert.match(t.actNow[0].reason, /^Moved from Tier B to Tier A/);
});

test('an opted-out institution never appears in act now, or anywhere: it is counted; so is a suppressed one', () => {
  const items = [cand(1, 'Alpha Example Bank', 'B'), cand(2, 'Bravo Example Bank', 'B'), cand(3, 'Charlie Example Bank', 'A'), cand(4, 'Delta Example Bank', 'A'), cand(5, 'Echo Example Bank', 'A')];
  const touches = [
    { type: 'touch', accountId: 'alpha', institution: 'Alpha Example Bank', step: 1, channel: 'letter', date: '2026-10-01' },
    { type: 'opt_out', accountId: 'alpha', institution: 'Alpha Example Bank', date: '2026-11-12' },
    { type: 'opt_out', accountId: 'bravo-by-hand', institution: 'Bravo Example Bank', date: '2026-09-01' },    // hand-picked: matched by name
    { type: 'reply', accountId: 'charlie', institution: 'Charlie Example Bank', date: '2026-10-05' },
    { type: 'opt_out', accountId: 'charlie', institution: 'Charlie Example Bank', date: '2026-10-06' },        // replied, then opted out
  ];
  const accounts = [{ id: 'alpha', name: 'Alpha Example Bank', institutionKey: 'fdic:1' }, { id: 'bravo-by-hand', name: 'Bravo Example Bank' }, { id: 'charlie', name: 'Charlie Example Bank', institutionKey: 'fdic:3' }];
  const dir = world({ items, touches, accounts, suppression: [{ type: 'institution', value: 'Delta Example Bank', reason: 'under NDA' }] });
  run(dir, { now: LAST });
  world({ items: [cand(1, 'Alpha Example Bank', 'A'), cand(2, 'Bravo Example Bank', 'A'), cand(3, 'Charlie Example Bank', 'A', [state(3, 'concentration-cre')]), cand(4, 'Delta Example Bank', 'A'), cand(5, 'Echo Example Bank', 'A')],
    filings: [filing(1, 'fdic:1', ['loan-sale-cre'], '2026-11-12', '2026-11-12T23:40:00.000Z'), filing(2, 'fdic:2', ['note-sale-cre'], '2026-11-12', '2026-11-12T23:40:00.000Z'), filing(4, 'fdic:4', ['loan-sale-cre'], '2026-11-12', '2026-11-12T23:40:00.000Z'), filing(5, 'fdic:5', ['loan-sale-cre'], '2026-11-12', '2026-11-12T23:40:00.000Z')] }, dir);
  const t = run(dir);
  assert.deepEqual(all(t).map((i) => i.key), ['fdic:5'], 'only the institution nobody opted out of, and that is not suppressed');
  assert.deepEqual([t.counts.optedOut, t.counts.optOutsInWindow, t.counts.suppressed], [3, 1, 1]);
  const text = JSON.stringify(t) + readFileSync(join(dir, 'triage/2026-11-16.md'), 'utf8');
  for (const n of ['Alpha Example Bank', 'Bravo Example Bank', 'Charlie Example Bank', 'Delta Example Bank', 'fdic:1', 'fdic:2', 'fdic:3', 'fdic:4']) assert.ok(!text.includes(n), `${n} must never be surfaced`);
  assert.match(text, /Opted out: 3 institutions \(1 in this window\)\. Never listed\./);
});

test('a snooze is honoured until its date, and ends on it; a dismissed bank stays out until a new signal fires', () => {
  const items = [cand(1, 'Alpha Example Bank', 'A'), cand(2, 'Bravo Example Bank', 'A'), cand(3, 'Charlie Example Bank', 'B', [state(3, 'cre-oreo-up')]), cand(4, 'Delta Example Bank', 'A')];
  const decisions = {
    'fdic:1': { status: 'snoozed', by: 'Pat Example', at: '2026-11-01T00:00:00Z', until: '2026-12-01' },
    'fdic:2': { status: 'snoozed', by: 'Pat Example', at: '2026-11-01T00:00:00Z', until: '2026-11-16' },   // ends today
    'fdic:3': { status: 'dismissed', by: 'Pat Example', at: '2026-11-02T00:00:00Z', reason: 'not now', signalIds: ['fdic:3:cre-oreo-up:20260630'] },
    'fdic:4': { status: 'dismissed', by: 'Pat Example', at: '2026-11-02T00:00:00Z', reason: 'not now', signalIds: [] },
  };
  const dir = world({ items, decisions });
  run(dir, { now: LAST });
  world({ items: [cand(1, 'Alpha Example Bank', 'A'), cand(2, 'Bravo Example Bank', 'A'), cand(3, 'Charlie Example Bank', 'A', [state(3, 'cre-oreo-up')]), cand(4, 'Delta Example Bank', 'A')],
    filings: ['fdic:1', 'fdic:2', 'fdic:4'].map((b, i) => filing(i + 1, b, ['loan-sale-cre'], '2026-11-12', '2026-11-12T23:40:00.000Z')) }, dir);
  const t = run(dir);
  assert.deepEqual(t.actNow.map((i) => i.key).sort(), ['fdic:2', 'fdic:4']);
  assert.deepEqual(where(t, 'fdic:2').notes, ['The snooze ended on November 16, 2026.']);
  assert.deepEqual(where(t, 'fdic:4').notes, ['Dismissed on November 2, 2026; a new signal has fired since.']);
  assert.equal(where(t, 'fdic:1'), null, 'snoozed until December 1');
  assert.equal(where(t, 'fdic:3'), null, 'dismissed, and its move to Tier A is not a new signal');
  assert.deepEqual([t.counts.snoozed, t.counts.dismissed, t.counts.heldBack], [1, 1, 2]);
  // On December 1 the snooze is over.
  assert.ok(where(run(dir, { now: new Date('2026-12-01T14:00:00Z'), since: '2026-11-01' }), 'fdic:1'));
});

test('an institution already in conversation is shown apart, with its latest touch date, and never in act now', () => {
  const items = [cand(1, 'Alpha Example Bank', 'A'), cand(2, 'Bravo Example Bank', 'A')];
  const touches = [
    { type: 'touch', accountId: 'alpha', institution: 'Alpha Example Bank', step: 1, channel: 'letter', date: '2026-10-01' },
    { type: 'reply', accountId: 'alpha', institution: 'Alpha Example Bank', date: '2026-10-20', note: 'free text is never copied' },
    { type: 'touch', accountId: 'alpha-2', institution: 'Alpha Example Bank', step: 2, channel: 'email', date: '2026-11-10' },   // a second contact there
    { type: 'meeting', accountId: 'echo', institution: 'Echo Example Partners', date: '2026-11-03' },
    { type: 'touch', accountId: 'bravo', institution: 'Bravo Example Bank', step: 1, channel: 'letter', date: '2026-11-02' },       // a send, no reply
  ];
  const accounts = [{ id: 'alpha', name: 'Alpha Example Bank', institutionKey: 'fdic:1' }, { id: 'alpha-2', name: 'Alpha Example Bank' }, { id: 'echo', name: 'Echo Example Partners' }, { id: 'bravo', name: 'Bravo Example Bank', institutionKey: 'fdic:2' }];
  const dir = world({ items, touches, accounts });
  run(dir, { now: LAST });
  world({ items, filings: [filing(1, 'fdic:1', ['loan-sale-cre'], '2026-11-12', '2026-11-12T23:40:00.000Z'), filing(2, 'fdic:2', ['loan-sale-cre'], '2026-11-12', '2026-11-12T23:40:00.000Z')] }, dir);
  const t = run(dir);
  assert.deepEqual(t.actNow.map((i) => i.key), ['fdic:2'], 'a send without a reply is not a conversation');
  assert.deepEqual(t.inConversation.map((i) => [i.key, i.latestTouch.date, i.conversation.map((c) => c.type)]), [['fdic:1', '2026-11-10', ['reply']], ['account:echo', '2026-11-03', ['meeting']]]);
  const alpha = t.inConversation[0];
  assert.equal(alpha.reason, 'In conversation: a reply recorded on October 20, 2026; the latest touch was on November 10, 2026. 1 new finding this window.');
  assert.deepEqual(types(alpha), ['sec-filing-strong']);
  assert.ok(alpha.findings.every((f) => f.category === 'watch'), 'nothing in conversation is act now');
  assert.deepEqual([alpha.links.account, t.inConversation[1].links.account], ['/accounts/alpha', '/accounts/echo']);
  assert.doesNotMatch(JSON.stringify(t), /free text/);
  const md = readFileSync(join(dir, 'triage/2026-11-16.md'), 'utf8');
  assert.match(md, /## Already in conversation \(2\)\n\nShown apart/);
});

// ---- The window ------------------------------------------------------------------------------------------------------------------
test('the window: both edges are in, the default is 7 days, --since starts it on a day, and a same-day re-run keeps its baseline', () => {
  const items = [cand(1, 'Alpha Example Bank', 'A'), cand(2, 'Bravo Example Bank', 'A'), cand(3, 'Charlie Example Bank', 'A'), cand(4, 'Delta Example Bank', 'A')];
  const at = ['2026-11-09T14:00:00.000Z', '2026-11-09T13:59:59.999Z', '2026-11-16T14:00:00.000Z', '2026-11-16T14:00:00.001Z'];
  const dir = world({ items,
    filings: at.map((a, i) => filing(i + 1, `fdic:${i + 1}`, ['loan-sale-cre'], '2026-11-09', a)),
    failed: { 70: failure(70, 'Kilo Example Bank', '2026-11-09'), 71: failure(71, 'Lima Example Bank', '2026-11-08'), 72: failure(72, 'Mike Example Bank', '2026-11-17'), 73: failure(73, 'November Example Bank', '2026-11-01') },
    runs: [{ runId: 'fdic-a', source: 'fdic', outcome: 'failed', finishedAt: '2026-11-09T14:00:00.000Z', errors: ['HTTP 503'] }, { runId: 'fdic-b', source: 'fdic', outcome: 'failed', finishedAt: '2026-11-09T13:00:00.000Z', errors: [] }],
  });
  const t = run(dir);
  assert.deepEqual(t.actNow.map((i) => i.key).sort(), ['fdic:1', 'fdic:3', 'fdic:70'], 'first seen at the window start and at now are in; a millisecond outside is out; a future-dated failure is out');
  assert.deepEqual(t.health.runs.map((r) => r.runId), ['fdic-a']);
  const s = run(world({ items: [], failed: { 73: failure(73, 'November Example Bank', '2026-11-01'), 74: failure(74, 'Oscar Example Bank', '2026-10-31') } }), { since: '2026-11-01' });
  assert.deepEqual([s.window.basis, s.window.from, s.actNow.map((i) => i.key)], ['since', '2026-11-01T00:00:00.000Z', ['fdic:73']]);

  // Re-running the same day compares with the same snapshot as the first run of the day.
  const d2 = world({ items: [cand(1, 'Alpha Example Bank', 'B')] });
  run(d2, { now: LAST });
  world({ items: [cand(1, 'Alpha Example Bank', 'A')] }, d2);
  const first = run(d2);
  const again = run(d2, { now: new Date('2026-11-16T15:00:00Z') });
  assert.deepEqual([first.comparedWith.date, again.comparedWith.date], ['2026-11-09', '2026-11-09']);
  assert.deepEqual(again.actNow.map((i) => [i.key, types(i)]), [['fdic:1', ['tier-up-a']]]);
  assert.equal(read(d2, 'triage/state.json').baseline.date, '2026-11-09');
  // With a snapshot, --since still reports events by date, even ones the last triage saw.
  const d3 = world({ items: [], failed: { 77: failure(77, 'Golf Example Bank', '2026-11-05') } });
  run(d3, { now: LAST });
  assert.equal(run(d3).actNow.length, 0);
  assert.deepEqual(run(d3, { now: new Date('2026-11-17T14:00:00Z'), since: '2026-11-01' }).actNow.map((i) => i.key), ['fdic:77']);
});

// ---- The calendar --------------------------------------------------------------------------------------------------------------
test('calendar math around quarter-ends and year-end', () => {
  assert.deepEqual(['2026-12-31', '2027-01-01', '2026-09-30', '2026-10-01', '2026-03-31', '2026-04-01'].map(nextQuarterEnd), ['2026-12-31', '2027-03-31', '2026-09-30', '2026-12-31', '2026-03-31', '2026-06-30']);
  assert.deepEqual(['2027-01-01', '2026-12-31', '2026-01-15'].map(lastQuarterEnd), ['2026-12-31', '2026-09-30', '2025-12-31']);
  const cal = { reviewWindowWeeks: 6, callReportLagDays: 60, cmbsReportingDay: 15 };
  const c = (today, latestRepdte = '20260630', over = {}) => calendarBlock({ today, latestRepdte, calendar: { ...cal, ...over } });
  // The review window opens 6 weeks (42 days) before the quarter-end, and closes on it.
  assert.deepEqual([c('2026-11-18').reviewWindow.open, c('2026-11-18').reviewWindow.daysUntilOpen, c('2026-11-19').reviewWindow.open, c('2026-11-19').reviewWindow.opens], [false, 1, true, '2026-11-19']);
  assert.deepEqual([c('2026-12-31').quarterEnd.daysUntil, c('2026-12-31').reviewWindow.open, c('2026-12-31').reviewWindow.daysLeft], [0, true, 0]);
  assert.deepEqual([c('2027-01-01').quarterEnd, c('2027-01-01').reviewWindow.opens, c('2027-01-01').reviewWindow.open], [{ date: '2027-03-31', daysUntil: 89 }, '2027-02-17', false]);
  // The next FDIC quarter, across the year-end, and overdue.
  assert.deepEqual([c('2026-11-16', '20260930').fdic.quarter, c('2026-11-16', '20260930').fdic.expected], ['20261231', '2027-03-01']);
  assert.deepEqual([c('2026-12-05').fdic.quarter, c('2026-12-05').fdic.expected, c('2026-12-05').fdic.overdueDays], ['20260930', '2026-11-29', 6]);
  assert.deepEqual([c('2026-11-16', null).fdic.quarter, c('2026-01-10', null).fdic.quarter], ['20260930', '20251231']);
  // The CMBS reporting day, across the year-end, on the day itself, and in a short month.
  assert.deepEqual([c('2026-12-20').cmbs, c('2026-12-15').cmbs.daysUntil], [{ date: '2027-01-15', day: 15, daysUntil: 26 }, 0]);
  assert.deepEqual([nextMonthDay('2027-02-01', 31), nextMonthDay('2028-02-01', 31), nextMonthDay('2027-01-31', 31), nextMonthDay('2027-02-28', 30)], ['2027-02-28', '2028-02-29', '2027-01-31', '2027-02-28']);
  // In the triage itself.
  const t = run(world({ items: [] }));
  assert.deepEqual([t.calendar.quarterEnd.date, t.calendar.quarterEnd.daysUntil, t.calendar.reviewWindow.open, t.calendar.reviewWindow.opens], ['2026-12-31', 45, false, '2026-11-19']);
  assert.match(renderTriage(t), /- Next quarter-end: December 31, 2026, in 45 days\.\n- Review window: opens November 19, 2026 \(6 weeks before the quarter-end\), in 3 days; not open yet\./);
});

// ---- System health -----------------------------------------------------------------------------------------------------------
test('failed and suspect runs in the window are reported, and so are stale sources and scoring', () => {
  const dir = world({ items: [], latestOver: { scoredAt: '2026-11-01T13:00:00.000Z' }, runs: [
    { runId: 'fdic-1', source: 'fdic', outcome: 'ok', finishedAt: '2026-11-16T13:50:00.000Z', errors: [] },
    { runId: 'edgar-1', source: 'edgar', outcome: 'ok', finishedAt: '2026-09-01T14:00:00.000Z', errors: [] },
    { runId: 'edgar-2', source: 'edgar', outcome: 'failed', finishedAt: '2026-11-12T14:00:00.000Z', errors: ['HTTP 503 from the form index'] },
    { runId: 'filings-1', source: 'filings', outcome: 'suspect', finishedAt: '2026-11-15T23:40:00.000Z', errors: [] },
    { runId: 'fdic-0', source: 'fdic', outcome: 'failed', finishedAt: '2026-10-01T14:00:00.000Z', errors: ['old'] },
  ] });
  const t = run(dir);
  assert.deepEqual(t.health.runs.map((r) => [r.runId, r.source, r.outcome, r.errors, r.firstError]), [['filings-1', 'filings', 'suspect', 0, null], ['edgar-2', 'edgar', 'failed', 1, 'HTTP 503 from the form index']]);
  assert.deepEqual(t.health.sources.map((s) => [s.source, s.status]), [['fdic', 'fresh'], ['edgar', 'stale'], ['filings', 'no_ok_run']]);
  assert.equal(t.health.sources[1].ageDays, 76);
  assert.deepEqual([t.health.scoring.status, t.health.scoring.ageDays], ['stale', 15]);
  assert.equal(t.counts.healthIssues, 5);
  const md = renderTriage(t);
  assert.match(md, /- Failed or suspect runs in the window: 2\.\n  - filings run filings-1 was suspect/);
  assert.match(md, /- Source edgar is stale: last ok run September 1, 2026, 76 days ago \(limit 35 days\)\./);
  assert.match(md, /- Scoring is stale: the last run was 15 days ago/);
  const none = run(world({ items: null }));
  assert.deepEqual([none.health.scoring.status, none.health.sources.map((s) => s.status)], ['none', ['never_run', 'never_run', 'never_run']]);
  assert.match(renderTriage(none), /Candidate list: none yet\./);
});

// ---- Determinism, the unit of work, and the drafter ----------------------------------------------------------------------------------
const busyWorld = (dir) => world({
  items: [cand(1, 'Alpha Example Bank', 'A', [acq(1, '5001', '2026-11-12')]), cand(2, 'Bravo Example Bank', 'B', [state(2, 'cre-oreo-up')]), cand(3, 'Charlie Example Bank', 'A')],
  decisions: { 'fdic:3': { status: 'snoozed', by: 'Pat Example', at: '2026-11-01T00:00:00Z', until: '2026-12-01' } },
  touches: [{ type: 'reply', accountId: 'bravo', institution: 'Bravo Example Bank', date: '2026-11-10' }], accounts: [{ id: 'bravo', name: 'Bravo Example Bank', institutionKey: 'fdic:2' }],
  filings: [filing(1, 'fdic:1', ['loan-sale-cre'], '2026-11-12', '2026-11-12T23:40:00.000Z'), filing(2, 'fdic:3', ['loan-sale-cre'], '2026-11-12', '2026-11-12T23:40:00.000Z')],
  failed: { 77: failure(77, 'Golf Example Bank', '2026-11-13') }, loans: [loan(1, { signals: [{ type: 'note_sale' }] })],
  runs: [{ runId: 'edgar-2', source: 'edgar', outcome: 'failed', finishedAt: '2026-11-12T14:00:00.000Z', errors: ['HTTP 503'] }], fdicState: { latestRepdte: '20260630', checkedAt: '2026-11-16T13:45:00.000Z' },
}, dir);
const outputs = (dir) => ['triage/2026-11-16.json', 'triage/2026-11-16.md', 'triage/state.json'].map((p) => readFileSync(join(dir, p), 'utf8'));

test('determinism: the same inputs give the same triage, byte for byte', () => {
  const a = busyWorld(); const b = busyWorld();
  for (const d of [a, b]) { put(d, 'triage/state.json', { version: 1, triageId: 'triage-2026-11-09', date: '2026-11-09', generatedAt: LAST.toISOString(), latestRepdte: '20260630', scoringRunId: 'score-0', candidates: { 'fdic:2': { name: 'Bravo Example Bank', tier: 'B', signals: [] }, 'fdic:3': { name: 'Charlie Example Bank', tier: 'B', signals: [] } }, seen: {}, baseline: null }); }
  const ta = run(a); const tb = run(b);
  assert.deepEqual(ta, tb);
  assert.deepEqual(outputs(a), outputs(b));
  assert.ok(ta.actNow.length >= 3 && ta.inConversation.length === 1 && ta.counts.snoozed === 1);
});

test('the worker\'s unit of work loads exactly what the triage needs, and stores the same as a data folder', async () => {
  const a = busyWorld(); const b = busyWorld();
  run(a);
  const snap = snapshotFromDir(b);
  const { plan } = await withUnitOfWork({ load: async () => snap, flush: async (p) => applyPlanToDir(p, b) }, triageLoads('2026-11-16'), (dir) => run(dir));
  assert.deepEqual(outputs(b), outputs(a));
  assert.deepEqual(plan.docs.map((d) => d.path), ['triage/2026-11-16.json', 'triage/2026-11-16.md', 'triage/state.json']);
  assert.deepEqual(plan.lines.map((l) => [l.path, l.line.type]), [['audit.jsonl', 'triage_run']]);
  assert.ok(!LOADS.triage.includes('triage/'), 'past triages are never loaded');
});

test('the triage never reaches the drafter or the briefer, and a job result holds counts only', () => {
  const covers = (list) => list.some((p) => p === '' || 'triage/'.startsWith(p) || p.startsWith('triage'));
  assert.equal(covers(LOADS.draft), false);
  assert.equal(covers(LOADS.research), false);
  for (const f of ['src/draft.mjs', 'src/research.mjs', 'src/lint.mjs', 'src/model.mjs']) assert.doesNotMatch(readFileSync(join(REPO, f), 'utf8'), /triage/i, `${f} must not read the triage`);
  const t = run(busyWorld());
  const s = triageSummary(t);
  assert.deepEqual(Object.keys(s).sort(), ['actNow', 'date', 'dismissed', 'firstRun', 'healthIssues', 'heldBack', 'inConversation', 'newQuarter', 'optOutsInWindow', 'optedOut', 'snoozed', 'suppressed', 'watch']);
  assert.doesNotMatch(JSON.stringify(s), /Example|fdic:|servicer/);
});

test('readTriage finds the latest triage, or one by date', () => {
  const dir = busyWorld();
  assert.equal(readTriage({ dir }), null);
  run(dir, { now: LAST });
  run(dir);
  assert.equal(readTriage({ dir }).date, '2026-11-16');
  assert.match(readTriage({ dir, date: '2026-11-09' }).markdown, /^# Weekly triage: November 9, 2026/);
  assert.equal(readTriage({ dir, date: '2026-11-02' }), null);
  assert.throws(() => readTriage({ dir, date: '11/16/2026' }), /--date needs a date/);
});

test('the command line: triage run writes to the data folder, and triage show prints it', () => {
  const dir = makeDir();
  const env = { ...process.env, OUTBOUND_DATA_DIR: dir };
  const cli = (...args) => execFileSync(process.execPath, [join(REPO, 'cli.mjs'), ...args], { env, encoding: 'utf8' });
  const ran = cli('triage', 'run');
  assert.match(ran, /^# Weekly triage: /);
  assert.match(ran, /First triage, no comparison/);
  assert.ok(existsSync(join(dir, 'triage', 'state.json')));
  assert.equal(cli('triage', 'show').trim(), readTriage({ dir }).markdown.trim());
  assert.match(cli('triage', 'show', '--date', '2001-01-01'), /No triage for 2001-01-01 yet/);
  assert.throws(() => execFileSync(process.execPath, [join(REPO, 'cli.mjs'), 'triage', 'run', '--since'], { env, encoding: 'utf8', stdio: 'pipe' }), /--since needs a date/);
});
