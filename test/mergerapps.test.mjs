// Merger applications (PRD next-five E18-S3) against a fake H.2. Invented banks and people only; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { makeDir, put, REPO } from './kit.mjs';
import { loadRules } from '../src/rules.mjs';
import { readJson } from '../src/store.mjs';
import { RUNS, CHANGES } from '../src/sources/runlog.mjs';
import {
  runMergerApps, verifyMergerApps, mergerPaths, weeksFromIndex, parseDistrictPage, proposalParties, applicationOf, parseActions, applyOutcomes,
  closingEvent, mergerSignals, validateMergerConfig,
} from '../src/sources/mergerapps.mjs';
import { detectMergerSignals, scoreBank } from '../src/score.mjs';
import { buildCard } from '../src/candidates.mjs';
import { LOADS } from '../src/uow.mjs';
import { fakeH2, districtPage, PEOPLE } from './mergerapps-fake.mjs';
import { INSTITUTIONS } from './enforcement-fake.mjs';

const rules = loadRules();
const NOW = new Date('2026-11-16T12:00:00Z');
const CFG = { ...rules.config.mergers, minIntervalMs: 0 };
const EVENTS = { 9001: { transnum: '9001', code: 223, kind: 'merger', label: 'Merger - Without Assistance', effective: '2026-11-10', acquirerCert: '1002', targetCert: '7777' } };
const world = ({ events = {} } = {}) => { const dir = makeDir(); put(dir, 'sources/fdic/institutions.json', INSTITUTIONS); put(dir, 'sources/fdic/events.json', events); return dir; };
const run = (dir, site = fakeH2(), over = {}) => runMergerApps({ dir, mergers: CFG, fetchImpl: site.fetchImpl, now: NOW, clock: () => NOW, sleep: async () => {}, nowMs: () => 0, ...over });
const apps = (dir) => readJson(mergerPaths(dir).applications, {});
const byFiler = (dir, f) => Object.values(apps(dir)).find((a) => a.filer === f);

// ---- Parsing ---------------------------------------------------------------------------------------------------------------------
test('the index and a district page: weeks, then each filing with its codes, proposal and comment dates', () => {
  assert.deepEqual(weeksFromIndex('<a href="20261107">w</a><a href="20261031/default.htm">x</a><a href="20261024/">y</a><a href="20050702/h2.pdf">z</a>'), ['20261024', '20261031', '20261107']);
  const p = parseDistrictPage(districtPage('20261031', 'dallas', [`<tr><th>EXAMPLE BANK</th><td>* 3A3* 3A5Election (Domestic)</td><td>Proposal</td><td>12/01/2026</td><td>Not&nbsp;available</td></tr>`]));
  assert.equal(p.weekEnding, '2026-10-31');
  assert.deepEqual(p.rows, [{ filer: 'EXAMPLE BANK', typeText: '* 3A3* 3A5Election (Domestic)', types: ['3A3', '3A5'], proposal: 'Proposal', newspaper: '2026-12-01', fedreg: null }]);
  assert.equal(parseDistrictPage('<html>no table</html>'), null);
  assert.deepEqual(validateMergerConfig(rules.config.mergers), []);
});

test('proposals: the applicant first, then each bank or holding company acquired, with city and state; no person', () => {
  const p = (t) => proposalParties(t).map((x) => `${x.name}|${x.city}|${x.state}`);
  assert.deepEqual(p('Example Holdings, Inc., Houston, Texas, to acquire Example Valley Bancshares, Inc., and thereby indirectly acquire The Example Valley Bank, both of Sampleton, Texas.'),
    ['Example Holdings, Inc.|Houston|TX', 'Example Valley Bancshares, Inc.|Sampleton|TX', 'The Example Valley Bank|Sampleton|TX']);
  assert.deepEqual(p('Example Trust and Savings Bank, Buffalo Example, Iowa to merge with Peoples Example Bank, Wells, Minnesota and thereby establish one branch located at 98 3rd Street SE, Wells, Minnesota.'),
    ['Example Trust and Savings Bank|Buffalo Example|IA', 'Peoples Example Bank|Wells|MN'], 'a name holding "and" stays whole; the branch clause is cut');
  assert.deepEqual(p('Example Acquisition, Inc., San Antonio, Texas to become a bank holding company through the acquisition of Example Bancshares, Inc. and therefore, Citizens Example Bank of Luling, both of Luling, Texas'),
    ['Example Acquisition, Inc.|San Antonio|TX', 'Example Bancshares, Inc.|Luling|TX', 'Citizens Example Bank of Luling|Luling|TX']);
  assert.deepEqual(p('Example Bancorp, Mission Example, California to become a bank holding company by acquiring 100 percent of Example Bank of California, Mission Example, California.'),
    ['Example Bancorp|Mission Example|CA', 'Example Bank of California|Mission Example|CA']);
  assert.deepEqual(p('C3 Example Holdings, Inc., Random Lake, Wisconsin, to relocate its head office to Independence, Wisconsin, and become a bank holding company by acquiring Northern Example Corporation, and thereby indirectly acquiring Independence Example Bank, both of Independence, Wisconsin.'),
    ['C3 Example Holdings, Inc.|Random Lake|WI', 'Northern Example Corporation|Independence|WI', 'Independence Example Bank|Independence|WI']);
  assert.deepEqual(p('Example Bancorp, Hyannis, Massachusetts, to merge with Bluestone Example, MHC, and thereby indirectly acquire Bluestone Example Bank, both of Raynham, Massachusetts, pursuant to Sections 3(a)(3) and 3(a)(5) of the Bank Holding Company Act of 1956.'),
    ['Example Bancorp|Hyannis|MA', 'Bluestone Example, MHC|Raynham|MA', 'Bluestone Example Bank|Raynham|MA']);
  assert.deepEqual(p('Notice by Pat Person, Sampleton, Texas, to acquire 10 percent or more of the shares of Example Valley Bancshares, Inc.'), ['Example Valley Bancshares, Inc.|null|null'], 'a person is never a party');
});

test('an application: the first party acquires, the rest are acquired; codes kept, others and changes in control skipped; a stable key', () => {
  const row = { filer: 'EXAMPLE BANK OF CALIFORNIA', typeText: '* 3A5', types: ['3A5'], proposal: 'Example Bancorp, Mission Example, California to become a bank holding company by acquiring Example Bank of California, Mission Example, California.', newspaper: null, fedreg: '2026-11-27' };
  const a = applicationOf(row, { district: 'sanfrancisco', week: '20261031' });
  assert.deepEqual(a.parties.map((x) => [x.role, x.name]), [['acquirer', 'Example Bancorp'], ['target', 'Example Bank of California']], 'the filer column can be the bank; the applicant is the first party');
  assert.deepEqual([a.kind, a.filedWeek, a.commentEnds, a.link], ['3A5', '2026-10-31', '2026-11-27', 'https://www.federalreserve.gov/releases/h2/20261031/sanfrancisco.htm']);
  assert.equal(applicationOf(row, { district: 'sanfrancisco', week: '20261107' }).key, a.key, 'the same filing in a later week is the same application');
  assert.equal(applicationOf({ ...row, types: [], typeText: 'Change in Bank Control' }, { district: 'x', week: '20261031' }), null);
  assert.equal(applicationOf({ ...row, types: [], typeText: '* Branch (Domestic)' }, { district: 'x', week: '20261031' }), null);
  assert.ok(!('proposal' in a), 'the proposal text is never kept');
});

test('outcomes: approvals and withdrawals matched to the filer, only for a merger or acquisition, never before the filing', () => {
  const entries = parseActions('<p>Example Holdings, Inc., Houston, Texas -- to acquire Example Bank.</p><p>Approved: November 4, 2026</p><p>Example Holdings, Inc., Houston, Texas -- relief from commitments.</p><p>Granted: November 5, 2026</p>');
  assert.deepEqual(entries.map((e) => [e.who, e.outcome, e.date]), [['Example Holdings, Inc., Houston, Texas', 'approved', '2026-11-04'], ['Example Holdings, Inc., Houston, Texas', 'granted', '2026-11-05']]);
  const a = { key: 'h2:x', filer: 'EXAMPLE HOLDINGS, INC.', parties: [{ name: 'Example Holdings, Inc.', role: 'acquirer' }], filedWeek: '2026-10-24' };
  const old = { ...a, key: 'h2:y', filedWeek: '2026-11-30' };
  const store = { [a.key]: a, [old.key]: old };
  assert.deepEqual(applyOutcomes(store, entries), ['h2:x']);
  assert.equal(store['h2:x'].approvedOn, '2026-11-04');
  assert.equal(store['h2:y'].approvedOn, undefined, 'an approval before an application was filed is not its approval');
});

// ---- The run -------------------------------------------------------------------------------------------------------------------
test('a run: every week and district read once; filings deduplicated across weeks; outcomes applied; closes linked to FDIC events', async () => {
  const dir = world({ events: EVENTS });
  const site = fakeH2();
  const r = await run(dir, site);
  assert.equal(r.outcome, 'ok', JSON.stringify(r));
  assert.deepEqual([r.weeks, r.rowsRead, r.kept, r.applicationsNew, r.skippedPeople, r.skippedOther, r.outcomes, r.closed], [3, 6, 4, 3, 1, 1, 2, 1]);
  assert.equal(site.calls.filter((c) => /\/(dallas|boston)\.htm$/.test(c)).length, 6, 'each district page read once per week');
  const h = byFiler(dir, 'EXAMPLE HOLDINGS, INC.');
  assert.deepEqual([h.kind, h.filedWeek, h.lastSeenWeek, h.approvedOn, h.closedBy], ['3A5', '2026-10-24', '2026-10-31', '2026-11-04', null]);
  assert.deepEqual(h.parties.map((p) => [p.role, p.name, p.state]), [['acquirer', 'Example Holdings, Inc.', 'TX'], ['target', 'Example Valley Bancshares, Inc.', 'TX'], ['target', 'The Example Valley Bank', 'TX']]);
  assert.equal(byFiler(dir, 'EXAMPLE COAST BANCORP').withdrawnOn, '2026-11-06');
  const d = byFiler(dir, 'EXAMPLE DESERT BANK');
  assert.deepEqual([d.kind, d.closedBy, d.closedOn], ['18C', 'fdic-event:9001', '2026-11-10']);
  assert.equal(readJson(mergerPaths(dir).state).latestWeek, '20261107');
  // Nothing new: only the index is read.
  site.calls.length = 0;
  const again = await run(dir, site);
  assert.deepEqual([again.outcome, again.weeks, again.applicationsNew, site.calls], ['ok', 0, 0, ['/releases/h2/']]);
});

test('no person\'s name, and no proposal text, reaches the store, the state file, the run log or the change log', async () => {
  const dir = world({ events: EVENTS });
  await run(dir);
  const all = [readFileSync(mergerPaths(dir).applications, 'utf8'), readFileSync(mergerPaths(dir).state, 'utf8'), readFileSync(RUNS(dir), 'utf8'), existsSync(CHANGES(dir)) ? readFileSync(CHANGES(dir), 'utf8') : ''].join('\n');
  for (const name of PEOPLE) assert.ok(!all.includes(name), `${name} must not be stored`);
  assert.doesNotMatch(all, /thereby|to acquire|establish branches/);
});

test('a district page without its table fails the run and writes nothing', async () => {
  const dir = world();
  const r = await run(dir, fakeH2({ missing: ['20261031/chicago'] }));
  assert.equal(r.outcome, 'failed');
  assert.match(r.errors[0], /chicago, week 2026-10-31, has no "Filings received" table/);
  assert.ok(!existsSync(mergerPaths(dir).applications));
  const empty = await run(world(), fakeH2({ weeks: [] }));
  assert.match(empty.errors[0], /lists no weeks/);
});

// ---- Signals, scoring, the card ------------------------------------------------------------------------------------------------------
test('signals: an open application on each bank in the list it names; closed or withdrawn ones give none, so a merger is never counted twice', async () => {
  const dir = world({ events: EVENTS });
  await run(dir);
  const s = mergerSignals({ dir });
  assert.deepEqual(Object.keys(s), ['fdic:1001'], 'Desert closed (FDIC\'s event speaks for it); Coast withdrawn');
  assert.deepEqual(s['fdic:1001'].map((x) => [x.type, x.role, x.date, x.approvedOn]), [['merger_pending', 'target', '2026-10-24', '2026-11-04']]);
  assert.equal(s['fdic:1001'][0].label, 'A pending merger of bank holding companies (section 3(a)(5)), with this bank as the bank acquired: filed with the Federal Reserve in the week ending 2026-10-24, approved 2026-11-04');
  // Without the FDIC event, the Desert application is open and names its acquirer.
  const open = world();
  await run(open);
  assert.deepEqual(mergerSignals({ dir: open })['fdic:1002'].map((x) => x.role), ['acquirer']);
  assert.deepEqual(detectMergerSignals({ signals: s['fdic:1001'], windowDays: 365, asOf: '2027-12-01' }), [], 'outside the window');
});

test('scoring: no points; the card states the application from its template', async () => {
  const dir = world({ events: EVENTS });
  await run(dir);
  const mergers = mergerSignals({ dir })['fdic:1001'];
  const base = { cert: '1001', institution: INSTITUTIONS[1001], footprint: {}, financials: null, scoring: rules.scoring, buybox: rules.buybox, metros: rules.metros, latestRepdte: '20260630', asOf: '2026-11-16' };
  const a = scoreBank(base), b = scoreBank({ ...base, mergers });
  assert.equal(b.score, a.score);
  assert.deepEqual(b.signals.filter((x) => x.rule === 'merger').map((x) => x.id), [mergers[0].id]);
  const card = buildCard({ ...b, latestRepdte: '20260630' }, { scoring: rules.scoring });
  assert.ok(card.sentences.some((x) => x.text.startsWith('A pending merger of bank holding companies') && x.evidence.includes(mergers[0].evidence[0])));
});

test('closingEvent: by the resolved target, else by the acquirer; never an event before the filing, never a failure', () => {
  const app = { filedWeek: '2026-10-31', parties: [{ name: 'Example Desert Bank', state: 'AZ', role: 'acquirer' }, { name: 'Example Coast Bank', state: 'CA', role: 'target' }] };
  const ev = (t, eff, over = {}) => ({ transnum: t, kind: 'merger', effective: eff, acquirerCert: '1002', targetCert: '1005', ...over });
  const ctx = (events) => ({ events, institutions: INSTITUTIONS, aliases: {} });
  assert.equal(closingEvent(app, ctx({ a: ev('a', '2026-12-01'), b: ev('b', '2026-11-15') })).transnum, 'b');
  assert.equal(closingEvent(app, ctx({ a: ev('a', '2026-01-01') })), null);
  assert.equal(closingEvent(app, ctx({ a: ev('a', '2026-12-01', { targetCert: '9999' }) })), null, 'a resolved target must be the event\'s target');
  assert.equal(closingEvent(app, ctx({ a: ev('a', '2026-12-01', { kind: 'failure' }) })), null);
});

// ---- Checking, loads and the command line --------------------------------------------------------------------------------------------
test('verify: fresh, sourced and person-free, and the latest week read again with every stored application found', async () => {
  const dir = world({ events: EVENTS });
  await run(dir);
  const ok = await verifyMergerApps({ dir, mergers: CFG, fetchImpl: fakeH2().fetchImpl, sleep: async () => {}, now: NOW });
  assert.deepEqual(ok.checks.map((c) => [c.id, c.ok]), [['mergerapps.fresh', true], ['mergerapps.sourced', true], ['mergerapps.recall', true]], JSON.stringify(ok.checks));
  const gone = await verifyMergerApps({ dir, mergers: CFG, fetchImpl: fakeH2({ pages: {} }).fetchImpl, sleep: async () => {}, now: new Date('2026-12-30T00:00:00Z') });
  assert.deepEqual(gone.checks.map((c) => c.ok), [false, true, false]);
  assert.match((await verifyMergerApps({ dir: makeDir(), mergers: CFG })).checks[0].summary, /No merger applications yet/);
});

test('no drafting, research or call action loads the applications; the job\'s load list is narrow; the command line lists them', async () => {
  for (const k of ['draft', 'research', 'callPrep', 'callConfirm', 'pilot', 'routes']) assert.ok(!LOADS[k].some((p) => p.startsWith('sources/')), `${k} must not load sources/`);
  assert.deepEqual(LOADS.mergers, ['sources/mergers/', 'sources/fdic/institutions.json', 'sources/fdic/events.json', 'candidates/aliases.json', 'sources/runs.jsonl']);
  const dir = world();
  await run(dir);
  const out = execFileSync(process.execPath, [join(REPO, 'cli.mjs'), 'mergers', 'list'], { env: { ...process.env, OUTBOUND_DATA_DIR: dir }, encoding: 'utf8' });
  assert.match(out, /2 application\(s\) open and naming a bank in the list/);
  assert.match(out, /in the list: fdic:1001 \(target\)/);
});

// Decided 2026-11-16 (next-five Q5): accept the gap, and count it. Invented applications and events only.
test('THE GAP: mergers that closed from leadDays after the first H.2 week, split by whether an application named them first', async () => {
  const { mergerGap } = await import('../src/sources/mergerapps.mjs');
  assert.equal(mergerGap({ dir: makeDir() }).ran, false, 'no applications yet');
  const dir = makeDir();
  put(dir, 'sources/mergers/applications.json', {
    'h2:a': { key: 'h2:a', filedWeek: '2025-06-07', closedBy: 'fdic-event:1', parties: [] },
    'h2:b': { key: 'h2:b', filedWeek: '2025-09-06', closedBy: null, parties: [] },
  });
  assert.equal(mergerGap({ dir }).ran, false, 'no FDIC events yet');
  put(dir, 'sources/fdic/events.json', {
    1: { transnum: '1', kind: 'merger', effective: '2026-02-01', targetCert: '11', acquirerCert: '12' },          // closed an application
    2: { transnum: '2', kind: 'merger', effective: '2026-03-01', targetCert: '21', acquirerCert: '22' },          // seen only at close
    3: { transnum: '3', kind: 'assisted-merger', effective: '2026-04-01', targetCert: '31', acquirerCert: '32' }, // seen only at close
    4: { transnum: '4', kind: 'merger', effective: '2025-07-01', targetCert: '41', acquirerCert: '42' },          // before the lead: not counted
    5: { transnum: '5', kind: 'failure', effective: '2026-05-01', targetCert: '51', acquirerCert: '52' },         // not a merger
    6: { transnum: '6', kind: 'affiliate-reorganization', effective: '2026-05-02', targetCert: '61' },            // not a merger
  });
  const g = mergerGap({ dir, leadDays: 180 });
  assert.deepEqual([g.firstWeek, g.since, g.closes, g.seenAsApplication, g.notSeen, g.share], ['2025-06-07', '2025-12-04', 3, 1, 2, 0.667]);
  assert.deepEqual(g.rows.map((r) => r.transnum), ['2', '3']);
  const out = execFileSync('node', [join(REPO, 'cli.mjs'), 'mergers', 'gap'], { env: { ...process.env, OUTBOUND_DATA_DIR: dir }, encoding: 'utf8' });
  assert.match(out, /Seen only at their close: 2 \(66\.7%\)/);
});
