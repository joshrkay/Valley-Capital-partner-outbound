// The scope rule (docs/county-loans.md section 3a, src/loans.mjs): the firm buys commercial real estate loans only, so a document known
// to be residential (a home-mortgage loan type, or, with no loan type, every borrower a person) stays stored and reaches no bank's file,
// review list or event. A bank named only as a loan's original lender, where the document names another current holder, is shown as such
// and gets no event. The rebuild writes the index again from the stored documents. Invented names only; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { makeDir, put, REPO } from './kit.mjs';
import { readJson, writeJson } from '../src/store.mjs';
import { buildDocument, diffDocuments, writeDiff, buildLoanIndex, rebuildLoanIndex, loanScope, scopeAll, scopeShown, eventShown, loanEvents, loansPaths, readBankLoans,
  commercialFromLoanType as sharedClassifier } from '../src/loans.mjs';
import { naturalPerson, isEntityName } from '../src/lenders.mjs';
import { commercialFromLoanType, jefferson } from '../src/sources/counties/jefferson.mjs';
import { caldwellCounty, CALDWELL_ID } from '../src/sources/counties/caldwell.mjs';
import { INSTITUTIONS } from './county-notices-fake.mjs';

const AT = '2026-11-16T12:00:00.000Z';

// ---- The loan type to the commercial flag: one test per mapping ----------------------------------------------------------------
const MAPPINGS = [
  // Residential programs and labels: false.
  ['FNMA', false], ['fnma', false], ['F.N.M.A.', false], ['Fannie Mae', false], ['FANNIE-MAE', false],
  ['FHLMC', false], ['Freddie Mac', false], ['freddie  mac', false],
  ['FHA', false], ['F.H.A.', false], [' fha ', false],
  ['VA', false], ['V.A.', false], ['va', false],
  ['USDA', false], ['RHS', false], ['USDA/RHS', false], ['GNMA', false],
  ['Conventional', false], ['CONVENTIONAL', false], ['Conv', false], ['CONV', false], ['Conv.', false],
  ['Conventional Residential', false], ['CONVENTIONAL RESIDENTIAL', false], ['Conventional-Residential', false], ['conventional   residential', false],
  ['Residential', false], ['Reverse', false], ['Reverse Mortgage', false], ['HECM', false],
  ['HELOC', false], ['Heloc', false], ['H.E.L.O.C.', false], ['Home Equity', false], ['Home Equity Line of Credit', false],
  // Commercial, business-purpose, construction, SBA and multifamily: true.
  ['Commercial', true], ['COMMERCIAL', true], ['BPL Commercial', true], ['BPL-Commercial', true], ['Business', true], ['business purpose', true],
  ['Construction', true], ['SBA', true], ['S.B.A.', true], ['Multifamily', true], ['Multi-Family', true],
  // The misspellings a county's own reports carry.
  ['Commerical Real Estate', true], ['COMERCIAL', true],
  // Unknown, blank or unrecognized: null, never guessed.
  ['Unknown', null], ['UNKNOWN', null], ['', null], ['   ', null], [null, null], [undefined, null], ['Seller Carry', null], ['Other', null], ['FHA Commercial Hybrid X', true],
];
for (const [type, want] of MAPPINGS) {
  test(`the loan type ${JSON.stringify(type)} reads as ${want === null ? 'not known (null)' : want ? 'commercial' : 'residential'}`, () => {
    assert.equal(commercialFromLoanType(type), want);
  });
}
test('the Jefferson adapter and the scope rule use one classifier', () => {
  assert.equal(commercialFromLoanType, sharedClassifier);
});

// ---- Documents, as the adapters build them ----------------------------------------------------------------------------------------
const party = (role, name) => ({ role, name });
// A Jefferson NED: its loan type and the flag the adapter reads (or, `flag`, the flag an older classifier stored).
const ned = (n, type, parties, { recorded = '2026-11-12', flag } = {}) => buildDocument({
  documentType: 'election_and_demand', documentNumber: `${n}/NED`, dates: { recorded, filed: null, listed: null, sale: '2027-03-10' }, parties,
  property: { address: null, apn: null }, amounts: { originalPrincipal: { value: 1000000, basis: 'index' }, unpaidBalance: { value: 900000, basis: 'index' } },
  ...(type ? { loan: { type, commercial: flag === undefined ? commercialFromLoanType(type) : flag } } : {}),
  foreclosure: { number: n }, url: 'https://gts.co.jefferson.co.us/Report_Files/NED%2011-12-2026.pdf',
}, { source: jefferson, fetchedAt: AT, runId: 'r1' }).record;
// A Jefferson pre-sale entry: no loan type, a grantor.
const sale = (n, parties) => buildDocument({
  documentType: 'notice_of_trustee_sale', documentNumber: `${n}/SALE`, dates: { recorded: null, filed: null, listed: '2026-11-17', sale: '2026-11-19' }, parties,
  property: { address: null, apn: null }, amounts: { originalPrincipal: { value: null, basis: 'not-stated' }, unpaidBalance: { value: 245000, basis: 'index' } },
  foreclosure: { number: n }, url: 'https://gts.co.jefferson.co.us/Report_Files/Preliminary%20bid%20report.pdf',
}, { source: jefferson, fetchedAt: AT, runId: 'r1' }).record;
// A Caldwell notice of sale: no loan type; a borrower and grantor.
const notice = (n, parties) => buildDocument({
  documentType: 'notice_of_trustee_sale', documentNumber: n, dates: { recorded: null, filed: null, sale: '2026-12-01', notice: '2026-10-21' }, parties,
  property: { address: null, apn: null }, amounts: { originalPrincipal: { value: 412500, basis: 'document' }, unpaidBalance: { value: null, basis: 'not-stated' } },
  url: `https://caldwellcounty.texas.gov/files/public-documents/foreclosures/2026/${n}.pdf`, listLink: 'https://caldwellcounty.texas.gov/foreclosures#fc-m-2026-12',
}, { source: caldwellCounty, fetchedAt: AT, runId: 'r1' }).record;
function store(dir, sourceId, docs, runId = 'r1') {
  for (const d of docs) assert.ok(d, 'every document builds');
  writeDiff(dir, sourceId, diffDocuments({}, docs, { now: new Date(AT), runId }), { runId, now: new Date(AT) });
}
const world = () => { const dir = makeDir(); put(dir, 'sources/fdic/institutions.json', INSTITUTIONS); return dir; };

// ---- The rule, one document at a time ---------------------------------------------------------------------------------------------
test('a natural person: not an entity by the entity test, and read as a person\'s name; anything unclear is not taken for one', () => {
  assert.deepEqual(['Pat Q. Sampleton', 'PAT EXAMPLE AND JORDAN EXAMPLE', 'Robin K. Inventive'].map(naturalPerson), [true, true, true]);
  assert.deepEqual(['Sample Holdings LLC', 'Sample Land Trust', 'Pat Example, Trustee of the Example Family Trust', 'Sample Widgets, a Texas limited liability company', 'J0rdan Examp1e', 'Sample'].map(naturalPerson), [false, false, false, false, false, false]);
  assert.equal(isEntityName('Sample Ardent Holdings LLC'), true);
});

test('the scope of one document: its loan type first, then its case\'s, then its borrowers; in scope unless known residential', () => {
  const lend = [party('holder', 'Example Bank, N.A.')];
  // Its own loan type. A flag an older classifier left null is read again from the type.
  assert.deepEqual(loanScope(ned('J2600101', 'Commercial', lend)), { inScope: true, why: null, loanType: 'Commercial', commercial: true, borrowers: null });
  assert.deepEqual(loanScope(ned('J2600102', 'FNMA', lend, { flag: null })), { inScope: false, why: 'residential-loan-type', loanType: 'FNMA', commercial: false, borrowers: null });
  // A type that says neither ("Unknown"): the borrowers decide, as with no type. Every one a person: out; an entity: in.
  assert.deepEqual(loanScope(ned('J2600103', 'Unknown', [...lend, party('grantor', 'Pat Q. Sampleton')])),
    { inScope: false, why: 'individual-borrowers', loanType: 'Unknown', commercial: null, borrowers: 'individuals' });
  assert.deepEqual(loanScope(ned('J2600104', 'Unknown', [...lend, party('grantor', 'Sample Corvid Storage LLC')])),
    { inScope: true, why: null, loanType: 'Unknown', commercial: null, borrowers: 'entity' });
  assert.equal(loanScope(ned('J2600105', 'HELOC', [...lend, party('grantor', 'Sample Corvid Storage LLC')])).why, 'residential-loan-type', 'a HELOC is out whoever borrows');
  // No loan type: the borrowers decide. Every one a person: out; an entity among them, or none named: in.
  assert.deepEqual(loanScope(notice('A1', [...lend, party('borrower', 'Pat Example and Jordan Example'), party('grantor', 'Pat Example and Jordan Example')])),
    { inScope: false, why: 'individual-borrowers', loanType: null, commercial: null, borrowers: 'individuals' });
  assert.deepEqual(loanScope(notice('A2', [...lend, party('borrower', 'Pat Example'), party('grantor', 'Sample Retail Partners LLC')])).borrowers, 'entity');
  assert.deepEqual(loanScope(notice('A3', lend)), { inScope: true, why: null, loanType: null, commercial: null, borrowers: null });
  // A pre-sale entry takes its case's loan type from the NED of the same foreclosure: an FHA case is out whoever borrows; a
  // commercial case is in even with a person as grantor; with no NED, the grantor decides.
  const docs = [ned('J2600201', 'FHA', lend), sale('J2600201', [...lend, party('grantor', 'Sample Corvid Storage LLC')]),
    ned('J2600202', 'Commercial', lend), sale('J2600202', [...lend, party('grantor', 'Robin K. Inventive')]), sale('J2600203', [...lend, party('grantor', 'Robin K. Inventive')])];
  const s = scopeAll(docs);
  assert.deepEqual(['jefferson:J2600201/SALE', 'jefferson:J2600202/SALE', 'jefferson:J2600203/SALE'].map((id) => [s.get(id).inScope, s.get(id).why, s.get(id).loanType]),
    [[false, 'residential-loan-type', 'FHA'], [true, null, 'Commercial'], [false, 'individual-borrowers', null]]);
});

// ---- The mixed set ----------------------------------------------------------------------------------------------------------------
// Commercial, FNMA, Conventional Residential and an unknown type in Jefferson; in Caldwell, a couple's home loan and an LLC's loan. Each
// out-of-scope document names a bank and a name that would otherwise reach the review list.
function mixed() {
  const dir = world();
  store(dir, 'jefferson', [
    ned('J2600001', 'Commercial', [party('holder', 'Example Bank, N.A.'), party('lender', 'Example Bank, N.A.'), party('grantor', 'Sample Holdings LLC')], { recorded: '2026-11-12' }),
    ned('J2600002', 'FNMA', [party('holder', 'Sample Community Bank'), party('lender', 'Sample Home Lending Bank'), party('grantor', 'Pat Q. Sampleton')], { recorded: '2026-11-11' }),
    ned('J2600003', 'Conventional Residential', [party('holder', 'Example Mountain Bank'), party('lender', 'Mortgage Electronic Registration Systems, Inc.'), party('grantor', 'Jordan R. Exampleby')], { recorded: '2026-11-10' }),
    ned('J2600004', 'Unknown', [party('holder', 'Example Bank, N.A.'), party('lender', 'Sample Prairie Bank'), party('grantor', 'Sample Inventive Works LLC')], { recorded: '2026-11-09' }),
  ]);
  store(dir, CALDWELL_ID, [
    notice('0000000000000A01', [party('lender', 'Example Bank, N.A.'), party('beneficiary', 'Sample Lone Star Bank'), party('holder', 'Example Bank, N.A.'),
      party('borrower', 'Pat Example and Jordan Example'), party('grantor', 'Pat Example and Jordan Example')]),
    notice('0000000000000A02', [party('lender', 'Sample Community Bank'), party('holder', 'Sample Community Bank'), party('borrower', 'Sample Retail Partners LLC'), party('grantor', 'Sample Retail Partners LLC')]),
  ]);
  return dir;
}

test('a mixed set: only the documents in scope give bank rows, events and review names; the others stay stored', () => {
  const dir = mixed();
  const P = loansPaths(dir);
  const c = buildLoanIndex({ dir, now: new Date(AT), runId: 'r1' });
  assert.deepEqual([c.documents, c.inScope, c.outOfScope, c.outOfScopeWhy], [6, 3, 3, { 'residential-loan-type': 2, 'individual-borrowers': 1 }]);
  assert.deepEqual([c.bySource.jefferson.inScope, c.bySource.jefferson.outOfScope, c.bySource[CALDWELL_ID].inScope, c.bySource[CALDWELL_ID].outOfScope], [2, 2, 1, 1]);
  // Bank rows: the commercial NED and the unknown one for Example Bank; the LLC's Caldwell loan for Sample Community Bank. None from the
  // FNMA NED (Sample Community Bank), the Conventional Residential one (Example Mountain Bank) or the couple's home loan (Example Bank).
  assert.deepEqual(readBankLoans({ dir, key: 'fdic:9001' }).loans.map((l) => [l.id, l.loanType, l.commercial, l.relation]),
    [['jefferson:J2600001/NED', 'Commercial', true, 'current'], ['jefferson:J2600004/NED', 'Unknown', null, 'current']]);
  assert.deepEqual(readBankLoans({ dir, key: 'fdic:9002' }).loans.map((l) => [l.id, l.scope]), [[`${CALDWELL_ID}:0000000000000A02`, { commercial: null, borrowers: 'entity' }]]);
  assert.equal(readBankLoans({ dir, key: 'fdic:9005' }), null);
  // Events: one per document in scope and bank, each carrying the scope the guard checks.
  const ev = loanEvents({ dir });
  assert.deepEqual(ev.map((e) => e.id).sort(), ['county:jefferson:J2600001/NED:fdic:9001', 'county:jefferson:J2600004/NED:fdic:9001', `county:${CALDWELL_ID}:0000000000000A02:fdic:9002`]);
  assert.ok(ev.every(eventShown));
  // Review names: only from the unknown NED. The FNMA lender, the home loan's beneficiary and the MERS set aside on the Conventional
  // Residential NED reach nothing.
  const rv = readJson(P.review);
  assert.deepEqual(rv.entries.map((e) => [e.name, e.documents]), [['Sample Prairie Bank', ['jefferson:J2600004/NED']]]);
  assert.deepEqual(rv.setAside, []);
  // Every document stays stored, so the weekly diff stays idempotent.
  assert.equal(Object.keys(readJson(P.docs('jefferson'))).length, 4);
  assert.equal(Object.keys(readJson(P.docs(CALDWELL_ID))).length, 2);
  // Nothing of a borrower in any bank's file, the review list or the events.
  const out = ['fdic-9001', 'fdic-9002'].map((b) => readFileSync(join(P.banksDir, `${b}.json`), 'utf8')).concat(readFileSync(P.review, 'utf8'), readFileSync(P.events, 'utf8')).join('\n');
  for (const leak of ['Pat Q. Sampleton', 'Pat Example', 'Robin K. Inventive', 'Sample Inventive Works LLC', 'Sample Holdings LLC', 'Sample Retail Partners LLC', 'Sample Home Lending Bank', 'Sample Lone Star Bank']) assert.ok(!out.includes(leak), leak);
  // The same again: nothing written.
  const before = [P.events, P.review, P.bank('fdic:9001')].map((p) => readFileSync(p, 'utf8'));
  const again = buildLoanIndex({ dir, now: new Date('2026-11-23T12:00:00Z'), runId: 'r2' });
  assert.deepEqual([again.eventsNew, again.eventsRemoved, again.bankFilesWritten], [0, 0, 0]);
  assert.deepEqual([P.events, P.review, P.bank('fdic:9001')].map((p) => readFileSync(p, 'utf8')), before);
});

// ---- The current holder ------------------------------------------------------------------------------------------------------------
test('a bank named only as the original lender, where the document names another current holder: on its page with the holder, no event', () => {
  const dir = world();
  store(dir, 'jefferson', [
    // A CMBS trust's trustee now holds a loan Example Bank made: shown as originated, no event.
    ned('J2600301', 'Commercial', [party('holder', 'Sample Trust Company, N.A., as trustee for Sample Commercial Mortgage Trust 2019-C1'), party('lender', 'Example Bank, N.A.'), party('grantor', 'Sample Office Owner LLC')]),
    // Another bank holds what Example Bank made: an event for the holder, none for the originator.
    ned('J2600302', 'BPL Commercial', [party('holder', 'Sample Community Bank'), party('lender', 'Example Bank, N.A., Its Successors and Assigns'), party('grantor', 'Sample Plaza LLC')]),
    // A person holds it: the page never names them.
    ned('J2600303', 'Commercial', [party('holder', 'Pat Example'), party('lender', 'Example Bank, N.A.'), party('grantor', 'Sample Storage LLC')]),
    // MERS alone as holder is a nominee, not a separate holder: Example Bank is the sole lender, and gets its event.
    ned('J2600304', 'Commercial', [party('holder', 'Mortgage Electronic Registration Systems, Inc.'), party('lender', 'Example Bank, N.A.'), party('grantor', 'Sample Hotel Group LLC')]),
    // The bank is the current holder and the original lender: an event, "a loan from this bank".
    ned('J2600305', 'Commercial', [party('holder', 'Example Bank, N.A.'), party('lender', 'Example Bank, N.A.'), party('grantor', 'Sample Apartments LLC')]),
  ]);
  const c = buildLoanIndex({ dir, now: new Date(AT), runId: 'r1' });
  assert.equal(c.originated, 3);
  const rows = Object.fromEntries(readBankLoans({ dir, key: 'fdic:9001' }).loans.map((l) => [l.documentNumber, l]));
  assert.deepEqual(Object.keys(rows).sort(), ['J2600301/NED', 'J2600302/NED', 'J2600303/NED', 'J2600304/NED', 'J2600305/NED'], 'every document still shows on the originator\'s page');
  assert.deepEqual([rows['J2600301/NED'].relation, rows['J2600301/NED'].heldBy, rows['J2600301/NED'].relationLabel],
    ['originated', 'Sample Trust Company, N.A., as trustee for Sample Commercial Mortgage Trust 2019-C1', 'Originated by this bank; now held by Sample Trust Company, N.A., as trustee for Sample Commercial Mortgage Trust 2019-C1']);
  assert.equal(rows['J2600302/NED'].relationLabel, 'Originated by this bank; now held by Sample Community Bank');
  assert.deepEqual([rows['J2600303/NED'].heldBy, rows['J2600303/NED'].relationLabel], [null, 'Originated by this bank; now held by a person (name withheld)']);
  assert.ok(!readFileSync(loansPaths(dir).bank('fdic:9001'), 'utf8').includes('Pat Example'), 'no person named');
  assert.deepEqual([rows['J2600304/NED'].relation, rows['J2600305/NED'].relation, rows['J2600305/NED'].relationLabel], ['current', 'current', null]);
  // Events: only the matches on the bank that holds the loan now.
  const ev = loanEvents({ dir });
  assert.deepEqual(ev.map((e) => [e.documentId.replace('jefferson:', ''), e.key]).sort(), [['J2600302/NED', 'fdic:9002'], ['J2600304/NED', 'fdic:9001'], ['J2600305/NED', 'fdic:9001']]);
  assert.equal(ev.find((e) => e.key === 'fdic:9002').label, 'A notice of election and demand was recorded on November 12, 2026 for a loan this bank holds on a property in Jefferson County, CO.');
  assert.ok(ev.every((e) => e.relation === 'current'));
});

// ---- The rebuild -------------------------------------------------------------------------------------------------------------------
// A data folder as the platform gives it back, written before the scope rule: the old classifier left FNMA's flag null, every document
// matched gave a bank row and an event with no scope, and the review list holds the FNMA document's lender.
function pulled() {
  const dir = world();
  const docs = [
    ned('J2600401', 'Commercial', [party('holder', 'Example Bank, N.A.'), party('lender', 'Example Bank, N.A.'), party('grantor', 'Sample Holdings LLC')]),
    ned('J2600402', 'FNMA', [party('holder', 'Sample Community Bank'), party('lender', 'Sample Home Lending Bank'), party('grantor', 'Pat Q. Sampleton')], { flag: null }),
    ned('J2600403', 'Commercial', [party('holder', 'Sample Trust Company, N.A., as trustee for Sample Commercial Mortgage Trust 2019-C1'), party('lender', 'Example Mountain Bank'), party('grantor', 'Sample Plaza LLC')]),
  ];
  store(dir, 'jefferson', docs);
  store(dir, CALDWELL_ID, [notice('0000000000000B01', [party('holder', 'Example Bank, N.A.'), party('borrower', 'Pat Example and Jordan Example')])]);
  const P = loansPaths(dir);
  const old = (docId, key, label) => ({ id: `county:${docId}:${key}`, kind: 'event', type: 'county_document', key, documentId: docId, label, date: '2026-11-12', basis: 'new-document',
    matchedAt: '2026-11-10T09:00:00.000Z', runId: 'county:jefferson-backfill', contextOnly: true, scored: false });
  writeJson(P.events, Object.fromEntries([
    old('jefferson:J2600401/NED', 'fdic:9001', 'old sentence'), old('jefferson:J2600402/NED', 'fdic:9002', 'old sentence'),
    old('jefferson:J2600403/NED', 'fdic:9005', 'old sentence'), old(`${CALDWELL_ID}:0000000000000B01`, 'fdic:9001', 'old sentence'),
  ].map((e) => [e.id, e])));
  const row = (id) => ({ id, documentType: 'election_and_demand', roles: ['holder'], loanType: 'FNMA', commercial: null });
  writeJson(P.bank('fdic:9002'), { key: 'fdic:9002', contextOnly: true, counts: { documents: 1 }, loans: [row('jefferson:J2600402/NED')] });
  writeJson(P.review, { entries: [{ name: 'Sample Home Lending Bank', status: 'unmatched', roles: ['lender'], candidates: [], suggestions: [], documents: ['jefferson:J2600402/NED'], counties: [], count: 1 }], setAside: [] });
  return dir;
}

test('the rebuild: from the stored documents alone, events now out of scope or on an originator removed, the rest keep when they were matched', () => {
  const dir = pulled();
  const P = loansPaths(dir);
  const docsBefore = [P.docs('jefferson'), P.docs(CALDWELL_ID)].map((p) => readFileSync(p, 'utf8'));
  // Before it: the triage's and the bank page's guard already show nothing written before the rule.
  assert.ok(!Object.values(readJson(P.events)).some(eventShown));
  assert.ok(!readBankLoans({ dir, key: 'fdic:9002' }).loans.some(scopeShown));
  const r = rebuildLoanIndex({ dir, now: new Date('2026-11-18T15:00:00Z') });
  assert.equal(r.runId, 'loans-rebuild-20261118T150000Z');
  assert.deepEqual([r.documents, r.inScope, r.outOfScope, r.outOfScopeWhy, r.originated, r.eventsRemoved, r.eventsNew], [4, 2, 2, { 'residential-loan-type': 1, 'individual-borrowers': 1 }, 1, 3, 0]);
  // The one event left keeps when it was matched, its run and its basis; the rest is written again from its document, with its scope.
  const ev = readJson(P.events);
  assert.deepEqual(Object.keys(ev), ['county:jefferson:J2600401/NED:fdic:9001']);
  const e = ev['county:jefferson:J2600401/NED:fdic:9001'];
  assert.deepEqual([e.matchedAt, e.runId, e.basis, e.relation, e.scope], ['2026-11-10T09:00:00.000Z', 'county:jefferson-backfill', 'new-document', 'current', { commercial: true, borrowers: null }]);
  assert.equal(e.label, 'A notice of election and demand was recorded on November 12, 2026 for a loan from this bank on a property in Jefferson County, CO.');
  assert.ok(eventShown(e));
  // The FNMA document's bank file is emptied, its lender is off the review list; the originator's page shows the trust's loan.
  assert.deepEqual(readBankLoans({ dir, key: 'fdic:9002' }).loans, []);
  assert.deepEqual(readJson(P.review).entries, []);
  assert.deepEqual(readBankLoans({ dir, key: 'fdic:9005' }).loans.map((l) => [l.id, l.relation]), [['jefferson:J2600403/NED', 'originated']]);
  assert.deepEqual(readBankLoans({ dir, key: 'fdic:9001' }).loans.map((l) => l.id), ['jefferson:J2600401/NED']);
  // The documents are not touched.
  assert.deepEqual([P.docs('jefferson'), P.docs(CALDWELL_ID)].map((p) => readFileSync(p, 'utf8')), docsBefore);
  // Run again: nothing to do, nothing written.
  const eventsText = readFileSync(P.events, 'utf8');
  const again = rebuildLoanIndex({ dir, now: new Date('2026-11-18T16:00:00Z') });
  assert.deepEqual([again.eventsRemoved, again.eventsNew, again.bankFilesWritten], [0, 0, 0]);
  assert.equal(readFileSync(P.events, 'utf8'), eventsText);
});

test('the rebuild refuses a folder with no stored document, or with no bank list, and writes nothing', () => {
  assert.throws(() => rebuildLoanIndex({ dir: makeDir() }), /No stored county document/);
  const dir = pulled();
  const P = loansPaths(dir);
  writeJson(join(dir, 'sources', 'fdic', 'institutions.json'), {});
  const before = [P.events, P.review, P.bank('fdic:9002')].map((p) => readFileSync(p, 'utf8'));
  assert.throws(() => rebuildLoanIndex({ dir }), /No bank list/);
  assert.deepEqual([P.events, P.review, P.bank('fdic:9002')].map((p) => readFileSync(p, 'utf8')), before);
  assert.ok(!existsSync(P.bank('fdic:9001')));
});

test('the command line: outbound loans rebuild on a data folder, reading no county', () => {
  const dir = pulled();
  const env = { ...process.env, OUTBOUND_DATA_DIR: dir };
  const out = execFileSync(process.execPath, [join(REPO, 'cli.mjs'), 'loans', 'rebuild'], { env, encoding: 'utf8' });
  assert.match(out, /^Rebuilt from 4 stored document\(s\) \(loans-rebuild-\d{8}T\d{6}Z\): 2 in scope, 2 out of scope \(1 a residential loan type, 1 every borrower a person, no commercial loan type\)\./);
  assert.match(out, /Events: 3 removed, 0 new/);
  assert.match(out, /jefferson: 3 stored, 2 in scope, 1 out of scope/);
  assert.doesNotMatch(out, /Pat |Sampleton|Sample Home Lending/, 'counts only, no borrower');
  // `loans show` and `loans events` apply the same guard.
  const show = execFileSync(process.execPath, [join(REPO, 'cli.mjs'), 'loans', 'show', '--key', 'fdic:9005'], { env, encoding: 'utf8' });
  assert.match(show, /Originated by this bank; now held by Sample Trust Company, N\.A\., as trustee for Sample Commercial Mortgage Trust 2019-C1/);
  const events = execFileSync(process.execPath, [join(REPO, 'cli.mjs'), 'loans', 'events'], { env, encoding: 'utf8' });
  assert.deepEqual(events.trim().split('\n').map((l) => l.split('  ')[1]), ['fdic:9001']);
});
