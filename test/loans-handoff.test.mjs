// County loan documents (docs/county-loans.md) are context for the firm's principals only. Proved by the load lists, and end to end in one
// data folder holding a bank, its account and a county document naming it:
//   - the drafter's load list (LOADS.draft) cannot read loans/, and its input carries nothing from a document;
//   - no other model-facing action loads loans/ either (research, approve, call prep, call notes, the call desk);
//   - scoring never reads loans/, so a document changes no score, weight or tier: the same data scores the same with and without it;
//   - the weekly triage lists a document's event under Watch, never act now, and it never brings back a bank a principal dismissed.
// The names, numbers and amounts are invented and distinctive, so a leak is easy to spot.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { account, models, SENDER, makeDir, put } from './kit.mjs';
import { loadRules } from '../src/rules.mjs';
import { readJson, writeJson } from '../src/store.mjs';
import { LOADS, withUnitOfWork, snapshotFromDir } from '../src/uow.mjs';
import { loadContext } from '../src/guard.mjs';
import { runFdic } from '../src/sources/fdic.mjs';
import { runScoring } from '../src/score.mjs';
import { promote, dismiss } from '../src/candidates.mjs';
import { runDrafter } from '../src/draft.mjs';
import { runBriefer } from '../src/research.mjs';
import { runTriage } from '../src/triage.mjs';
import { callLoads } from '../src/calls.mjs';
import { callDeskLoads } from '../src/uow.mjs';
import { runNoticeSource } from '../src/sources/notices.mjs';
import { exampleCounty } from '../src/sources/counties/example.mjs';
import { readBankLoans, loanEvents } from '../src/loans.mjs';
import { fakeFdic, METROS, TABLES } from './fdic-fake.mjs';
import { fakeCounty, WEEK1 } from './county-notices-fake.mjs';
import { confirmAll } from './parcels-kit.mjs';
import { readFileSync } from 'node:fs';

const rules = loadRules();
const NOW = new Date('2026-11-16T12:00:00Z');
const covers = (prefix, rel) => prefix === '' || rel === prefix || (prefix.endsWith('/') && rel.startsWith(prefix));
const LOAN_PATHS = ['loans/docs/example-county.json', 'loans/banks/fdic-101.json', 'loans/review.json', 'loans/events.json', 'loans/state.json', 'loans/parcels/example-county.json', 'loans/unconfirmed.json'];
// What only the county document holds.
const LEAKS = ['Zephyrine', 'Quillon', '8,765,432', '8765432', '2026-777001', '2026-777002', '2019-5550101', 'publictrustee.example', 'Example County', 'trustee\'s sale', 'election and demand',
  'county_document', 'loans/', 'Sample & Example LLP'];
const ROWS = () => [
  { ...WEEK1()[4], number: '2026-777001', recorded: '11/11/2026', beneficiary: 'Example Hill Country Bank', holder: 'Example Hill Country Bank', grantor: 'Zephyrine Holdings LLC', address: '4417 Quillon Way, Anytown, CO 80000',
    original: '$8,765,432.00', outstanding: '$8,100,000.00', deedOfTrust: '2019-5550101 (03/01/2019)' },
  { ...WEEK1()[0], number: '2026-777002', recorded: '11/12/2026', beneficiary: 'Example Hill Country Bank', holder: 'Example Hill Country Bank', grantor: 'Zephyrine Holdings LLC', address: '4417 Quillon Way, Anytown, CO 80000' },
];

const MODEL_FACING = () => ({
  research: LOADS.research, draft: LOADS.draft, approve: LOADS.approve, callDesk: LOADS.callDesk, callDeskNarrowed: callDeskLoads('acme-bank'),
  ...Object.fromEntries(['callPrep', 'callNotes', 'callExtract', 'callConfirm'].flatMap((k) => [[k, LOADS[k]], [`${k}Narrowed`, callLoads(k, 'acme-bank')]])),
});

test('LOADS: loans/ is out of the drafter\'s list, every other model-facing list and scoring\'s; the watcher and the triage have their own', () => {
  for (const [kind, list] of Object.entries(MODEL_FACING())) for (const p of LOAN_PATHS) assert.ok(!list.some((x) => covers(x, p)), `${kind} covers ${p}`);
  for (const p of LOAN_PATHS) assert.ok(!LOADS.score.some((x) => covers(x, p)), `scoring covers ${p}`);
  assert.ok(!LOADS.draft.some((p) => p === '' || 'loans/'.startsWith(p) || p.startsWith('loans')), `LOADS.draft: ${LOADS.draft.join(', ')}`);
  assert.deepEqual(LOADS.loans, ['loans/', 'sources/fdic/institutions.json', 'candidates/aliases.json', 'sources/runs.jsonl']);
  assert.deepEqual(LOADS.triage.filter((p) => p.startsWith('loans')), ['loans/events.json', 'loans/cmbs.json'], 'the triage reads the events and the CMBS links only, never the documents, the parcel matches or the property-not-confirmed list');
  // Scoring's rules name no county signal.
  assert.doesNotMatch(JSON.stringify(rules.scoring.signals ?? []), /county|trustee|loan document|lis pendens/i);
});

async function world() {
  const dir = makeDir();
  await runFdic({ dir, metros: METROS, fetchImpl: fakeFdic(TABLES()).fetchImpl, quarters: 2, sleep: async () => {}, minIntervalMs: 0, now: NOW });
  runScoring({ dir, buybox: rules.buybox, scoring: rules.scoring, metros: rules.metros, now: NOW, allowPlaceholders: true });
  return dir;
}
// Each document's county parcel record says retail (test/parcels-kit.mjs, no network), so each is a lead (docs/county-loans.md 3a).
const county = (dir, now = NOW) => runNoticeSource({ dir, source: exampleCounty, counties: rules.config.counties, fetchImpl: fakeCounty({ rows: ROWS() }).fetchImpl, sleep: async () => {}, now, clock: () => now, allowExample: true, parcels: confirmAll('retail') });
const scored = (dir) => { const l = readJson(join(dir, 'candidates', 'latest.json')); return JSON.stringify({ ...l, runId: null, scoredAt: null }); };

test('a county document changes no score, weight or tier: the same data scores the same with and without it, and scoring cannot load it', async () => {
  const dir = await world();
  const before = scored(dir);
  const paperBefore = readJson(join(dir, 'paper', 'fdic-101.json'));
  const r = await county(dir);
  assert.equal(r.outcome, 'ok', JSON.stringify(r));
  assert.equal(readBankLoans({ dir, key: 'fdic:101' }).loans.length, 2, 'the documents name the bank');
  assert.equal(loanEvents({ dir, key: 'fdic:101' }).length, 2);
  runScoring({ dir, buybox: rules.buybox, scoring: rules.scoring, metros: rules.metros, now: NOW, allowPlaceholders: true });
  assert.equal(scored(dir), before, 'every item, score, axis, tier, signal and card the same');
  assert.deepEqual(readJson(join(dir, 'paper', 'fdic-101.json')), paperBefore, 'the paper record is not even rewritten');
  for (const leak of LEAKS) assert.ok(!scored(dir).includes(leak), `the candidate list holds "${leak}"`);
  // Inside scoring's own unit of work, a loan file cannot be read.
  const snap = snapshotFromDir(dir);
  assert.ok(snap.docs['loans/banks/fdic-101.json']);
  await withUnitOfWork({ load: async () => snap, flush: async () => {} }, LOADS.score, async (root) => {
    for (const p of LOAN_PATHS) assert.throws(() => readJson(join(root, p)), /was not loaded/, p);
  });
});

test('end to end: the drafter, inside a unit of work with exactly LOADS.draft, cannot read loans/, and its input holds nothing from a document', async () => {
  const dir = await world();
  await county(dir);
  const promoted = promote({ dir, key: 'fdic:101', by: 'Pat Example', now: NOW });
  const a = { ...readJson(join(dir, 'accounts', `${promoted.id}.json`)), person: account().person, contact: account().contact };
  writeJson(join(dir, 'accounts', `${a.id}.json`), a);
  for (const leak of LEAKS) assert.ok(!JSON.stringify(a).includes(leak), `the account holds "${leak}"`);
  put(dir, 'senders.json', { senders: [SENDER] });
  put(dir, `facts/${a.id}.json`, [{ id: `${a.id}:F1`, kind: 'intent', claim: 'The bank says it intends to reduce its loan concentrations.', quote: 'intends to reduce', url: 'https://example.test/q3', publisher: 'Example', published: '2026-10-28', tier: 'company', use: 'draft', asset_specific: false }]);
  put(dir, `research/${a.id}.json`, { account: a.id, riskScreen: { approach: 'ok', reasons: [], finding_ids: [] }, personCheck: { status: 'confirmed' } });
  put(dir, 'touches.jsonl', `${JSON.stringify({ type: 'touch', accountId: a.id, step: 1, channel: 'letter', sender: 'pat', date: '2026-11-10' })}\n`);
  const snap = snapshotFromDir(dir);
  // Every loan path but the property-not-confirmed list (written only when a document's property is not confirmed; none here).
  for (const p of LOAN_PATHS.filter((x) => x !== 'loans/unconfirmed.json')) assert.ok(snap.docs[p], `${p} is in the data folder`);
  const blind = (root) => { for (const p of LOAN_PATHS) assert.throws(() => readJson(join(root, p)), /was not loaded/, p); };

  const { result: d } = await withUnitOfWork({ load: async () => snap, flush: async () => {} }, LOADS.draft, async (root) => {
    blind(root);
    return runDrafter({ client: null, dir: root, account: a, channel: 'email', step: 2, senderId: 'pat', date: '2026-11-16', ctx: loadContext({ dir: root, config: rules.config, env: {} }), rules, dryRun: true });
  });
  assert.equal(d.dryRun, true, JSON.stringify(d));
  for (const leak of LEAKS) assert.ok(!`${d.system}\n${d.user}`.includes(leak), `drafter input leaked "${leak}"`);
  assert.match(d.user, /intends to reduce its loan concentrations/, 'the drafter still gets its one cleared fact');

  // The briefer cannot read it either.
  const { result: b } = await withUnitOfWork({ load: async () => snap, flush: async () => {} }, LOADS.research, async (root) => {
    blind(root);
    return runBriefer({ client: null, dir: root, account: a, models: models(), playbooks: rules.playbooks, now: NOW, dryRun: true });
  });
  assert.equal(b.dryRun, true);
  // (Its playbook names county notices, "trustee's sale" among them, as things to look for on the open web: only the invented values count.)
  for (const leak of LEAKS.filter((l) => !['loans/', 'trustee\'s sale', 'election and demand'].includes(l))) assert.ok(!`${b.system}\n${b.user}`.includes(leak), `briefer prompt leaked "${leak}"`);
});

test('the weekly triage: each new event is a Watch line in the event\'s own sentence, never act now, never twice, never a dismissed bank back', async () => {
  const dir = await world();
  await county(dir, new Date('2026-11-15T12:00:00Z'));
  const t = runTriage({ dir, rules: rules.triage, now: NOW, metros: rules.metros, scoring: rules.scoring });
  const all = [...t.actNow, ...t.watch].flatMap((i) => i.findings.map((f) => ({ ...f, key: i.key, category: i.category })));
  const mine = all.filter((f) => f.type === 'county-document');
  assert.equal(mine.length, 2, JSON.stringify(all.map((f) => f.type)));
  assert.ok(mine.every((f) => f.category === 'watch' && f.key === 'fdic:101'));
  assert.ok(mine.some((f) => f.reason === 'A notice of trustee\'s sale was recorded on November 11, 2026 for a loan from this bank on a retail property in Example County, CO; property type confirmed from the county\'s parcel record.'), JSON.stringify(mine));
  assert.match(readFileSync(join(dir, 'triage', '2026-11-16.md'), 'utf8'), /^Property type: Example County Assessor parcel data \(CC BY 4\.0\)\.$/m, 'the property type is attributed under the lists');
  assert.ok(!t.actNow.some((i) => i.findings.some((f) => f.type === 'county-document')));
  // The next week: already seen, not listed again.
  const t2 = runTriage({ dir, rules: rules.triage, now: new Date('2026-11-23T12:00:00Z'), metros: rules.metros, scoring: rules.scoring });
  assert.ok(![...t2.actNow, ...t2.watch].some((i) => i.findings.some((f) => f.type === 'county-document')));

  // A bank a principal dismissed stays off: an event is context, not a signal.
  const dir2 = await world();
  dismiss({ dir: dir2, key: 'fdic:101', by: 'Pat Example', reason: 'not now', now: NOW });
  await county(dir2, new Date('2026-11-15T12:00:00Z'));
  const t3 = runTriage({ dir: dir2, rules: rules.triage, now: NOW, metros: rules.metros, scoring: rules.scoring });
  assert.ok(![...t3.actNow, ...t3.watch].some((i) => i.key === 'fdic:101'), 'the dismissed bank is not brought back by a county event');
});

test('the weekly triage lists only what the scope rule allows: no home, no property a parcel does not confirm, no bank that only originated the loan, nothing written before the rule', async () => {
  const dir = await world();
  const rows = () => [
    ROWS()[0],
    // Its property is matched to no county parcel: not a lead, whatever its loan type (the property-not-confirmed list).
    { ...ROWS()[1], number: '2026-777003', grantor: 'Pat Example and Jordan Example' },
    // A house by its county parcel record: out.
    { ...ROWS()[1], number: '2026-777005', grantor: 'Zephyrine Holdings LLC' },
    // The bank made the loan; a CMBS trust's trustee holds it now: on the bank's page, never This week.
    { ...ROWS()[1], number: '2026-777004', holder: 'Sample Trust Company, N.A., as trustee for Sample Commercial Mortgage Trust 2019-C1', grantor: 'Zephyrine Retail LLC' },
  ];
  const at = new Date('2026-11-15T12:00:00Z');
  const parcels = confirmAll('retail', { 'example-county:2026-777003': { status: 'unmatched' }, 'example-county:2026-777005': 'house' });
  const r = await runNoticeSource({ dir, source: exampleCounty, counties: rules.config.counties, fetchImpl: fakeCounty({ rows: rows() }).fetchImpl, sleep: async () => {}, now: at, clock: () => at, allowExample: true, parcels });
  assert.deepEqual([r.outcome, r.inScope, r.outOfScope, r.index.originated, r.index.eventsNew, r.index.outOfScopeWhy], ['ok', 2, 2, 1, 1, { 'not-confirmed': 1, 'residential-parcel': 1 }], JSON.stringify(r));
  assert.equal(readBankLoans({ dir, key: 'fdic:101' }).loans.find((l) => l.documentNumber === '2026-777004').relationLabel,
    'Originated by this bank; now held by Sample Trust Company, N.A., as trustee for Sample Commercial Mortgage Trust 2019-C1');
  // An event written before the scope rule (no scope, no relation), as a folder pulled before the rebuild holds: the guard keeps it off.
  const events = readJson(join(dir, 'loans', 'events.json'));
  const stale = { ...Object.values(events)[0], id: 'county:example-county:2026-777009:fdic:101', documentId: 'example-county:2026-777009', label: 'A stale event written before the scope rule.' };
  delete stale.scope;
  delete stale.relation;
  writeJson(join(dir, 'loans', 'events.json'), { ...events, [stale.id]: stale });
  const t = runTriage({ dir, rules: rules.triage, now: NOW, metros: rules.metros, scoring: rules.scoring });
  const mine = [...t.actNow, ...t.watch].flatMap((i) => i.findings).filter((f) => f.type === 'county-document');
  assert.deepEqual(mine.map((f) => f.reason), ['A notice of trustee\'s sale was recorded on November 11, 2026 for a loan from this bank on a retail property in Example County, CO; property type confirmed from the county\'s parcel record.']);
});
