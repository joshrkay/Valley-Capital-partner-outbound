// The lender match (docs/county-loans.md; county-data-build-vs-buy 5.2, component 5): a principal's alias first, then the exact
// normalized name narrowed by the party's own state and city; MERS, trustees, servicers and law firms set aside and never matched; nothing
// fuzzy merges. Invented banks and names only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { matchLender, setAsideClass, cleanLenderName, bankLike, reviewKey, LENDER_ROLES } from '../src/lenders.mjs';
import { INSTITUTIONS } from './county-notices-fake.mjs';

const ctx = (over = {}) => ({ institutions: INSTITUTIONS, aliases: {}, documentState: 'CO', ...over });
const m = (name, over = {}, party = {}) => matchLender({ role: 'beneficiary', name, ...party }, ctx(over));

test('the exact normalized name matches: N.A. is National Association, a leading "The" and punctuation do not count', () => {
  assert.deepEqual([m('Example Bank, N.A.').status, m('Example Bank, N.A.').key], ['matched', 'fdic:9001']);
  assert.equal(m('EXAMPLE BANK, NATIONAL ASSOCIATION').key, 'fdic:9001');
  assert.equal(m('The Example Mountain Bank').key, 'fdic:9005');
  assert.equal(m('Example Mountain Bank').how, 'name');
});

test('the legal phrases after a name are not the name: successors and assigns, successor by merger, "as beneficiary", the charter', () => {
  assert.equal(cleanLenderName('Sample Community Bank, its successors and assigns'), 'Sample Community Bank');
  assert.equal(cleanLenderName('Example Bank, N.A., successor by merger to Faraway Example Bank'), 'Example Bank, N.A.');
  assert.equal(cleanLenderName('Example Mountain Bank, as beneficiary'), 'Example Mountain Bank');
  assert.equal(cleanLenderName('Example Bank, N.A., a national banking association'), 'Example Bank, N.A.');
  assert.equal(cleanLenderName('Example Mountain Bank, a Colorado state bank'), 'Example Mountain Bank');
  for (const n of ['Sample Community Bank, its successors and assigns', 'Example Bank, N.A., a national banking association']) assert.equal(m(n).status, 'matched', n);
});

test('a principal\'s alias first: the name as the document gives it, a holding company included', () => {
  const aliases = { 'fdic:9002': ['Sample Bancorp'] };
  assert.equal(m('Sample Bancorp').status, 'unmatched', 'no alias: no bank of that name');
  const hit = m('Sample Bancorp', { aliases });
  assert.deepEqual([hit.status, hit.key, hit.how], ['matched', 'fdic:9002', 'alias']);
  // An alias wins over a bank of the exact name: the principal decided.
  assert.equal(m('Example Mountain Bank', { aliases: { 'fdic:9001': ['Example Mountain Bank'] } }).key, 'fdic:9001');
});

test('two banks of one name are ambiguous, with both as candidates; the document\'s state is shown, never used to choose', () => {
  const r = m('First Example Bank');
  assert.equal(r.status, 'ambiguous');
  assert.equal(r.key, undefined, 'no bank is chosen');
  assert.deepEqual(r.candidates.map((c) => [c.key, c.state, c.inDocumentState]), [['fdic:9003', 'TX', false], ['fdic:9004', 'CO', true]]);
  // The party's own address, when the document gives it, narrows by state and then city.
  assert.equal(m('First Example Bank', {}, { state: 'TX' }).key, 'fdic:9003');
  assert.equal(m('First Example Bank', {}, { state: 'CO', city: 'Otherville' }).key, 'fdic:9004');
  // An address in a state where no bank of that name is: unmatched, with the banks of that name elsewhere as candidates.
  const far = m('Example Mountain Bank', {}, { state: 'TX' });
  assert.deepEqual([far.status, far.candidates.map((c) => c.key)], ['unmatched', ['fdic:9005']]);
});

test('nothing fuzzy merges: a similar name is a suggestion for a principal, never a match', () => {
  const r = m('Example Mountain Bank and Trust');
  assert.equal(r.status, 'unmatched');
  assert.equal(r.key, undefined);
  assert.ok(r.suggestions.some((s) => s.key === 'fdic:9005'), JSON.stringify(r.suggestions));
  assert.equal(m('Sample Capital Fund LP').status, 'unmatched');
  assert.deepEqual([bankLike('Sample Capital Fund LP'), bankLike('Sample Bancorp'), bankLike('Example Bank, N.A.')], [false, true, true]);
});

test('MERS is a nominee, never the lender: bare MERS is set aside; "as nominee for" reads the lender it names', () => {
  for (const n of ['Mortgage Electronic Registration Systems, Inc.', 'MERS', 'MERS, Inc., its successors and assigns']) assert.deepEqual([m(n).status, m(n).class], ['set-aside', 'mers'], n);
  const nom = m('Mortgage Electronic Registration Systems, Inc., as nominee for Sample Community Bank');
  assert.deepEqual([nom.status, nom.key], ['matched', 'fdic:9002']);
  assert.match(nom.how, /through MERS as nominee/);
  assert.equal(m('MERS, as nominee for Sample Capital Fund LP').status, 'unmatched', 'a nominee for a fund is the fund');
});

test('trustees, servicers and law firms are set aside, never matched to a bank, whatever an alias says', () => {
  const cases = [
    ['Example Title Company', 'trustee'], ['Sample Trustee Services LLC', 'trustee'], ['Example Foreclosure Services, Inc.', 'trustee'], ['Public Trustee of Example County', 'trustee'],
    ['Example Bank, N.A., as Trustee for the Holders of Sample Trust 2019-C1', 'trustee'], ['Example Reconveyance Corp.', 'trustee'],
    ['Example Loan Servicing LLC', 'servicer'], ['Sample Asset Partners, as special servicer', 'servicer'], ['Example Bank, N.A., as attorney-in-fact', 'servicer'], ['Sample Loan Services', 'servicer'],
    ['Sample & Example LLP', 'law-firm'], ['Example Law Group, P.C.', 'law-firm'], ['Sample Attorneys at Law', 'law-firm'], ['Example Legal PLLC', 'law-firm'],
  ];
  for (const [n, cls] of cases) {
    assert.equal(setAsideClass(n), cls, n);
    const aliases = { 'fdic:9001': [n] };
    const r = m(n, { aliases });
    assert.deepEqual([r.status, r.class, r.key], ['set-aside', cls, undefined], `${n} is ${cls}, even with an alias`);
  }
  // A bank's own name with "Trust" or "Bank and Trust" is not a trustee.
  for (const n of ['Example Bank and Trust', 'Sample Trust Company', 'First Example Bank']) assert.equal(setAsideClass(n), null, n);
});

test('only the lender side is matched: a trustee, an attorney, a borrower or a grantor is never matched, even with a bank\'s name', () => {
  assert.deepEqual([...LENDER_ROLES], ['lender', 'beneficiary', 'holder', 'assignor', 'assignee']);
  for (const role of ['trustee', 'attorney', 'borrower', 'grantor']) assert.deepEqual([matchLender({ role, name: 'Example Bank, N.A.' }, ctx()).status], ['not-a-lender'], role);
  for (const role of LENDER_ROLES) assert.equal(matchLender({ role, name: 'Example Bank, N.A.' }, ctx()).key, 'fdic:9001', role);
});

test('the review key groups one name however it is written', () => {
  assert.equal(reviewKey('Sample Capital Fund, L.P.'), reviewKey('SAMPLE CAPITAL FUND LP'));
  assert.equal(reviewKey('Sample Community Bank, its successors and assigns'), reviewKey('Sample Community Bank'));
});

test('a person named as lender is set aside, never matched, whatever an alias says; an institution never reads as a person', async () => {
  const { personName, PERSON_WITHHELD } = await import('../src/lenders.mjs');
  for (const n of ['Pat Example and Jordan Example', 'Pat Example a/k/a Pat Sample', 'PAT EXAMPLE, JR.']) {
    assert.equal(personName(n), true, n);
    assert.deepEqual([m(n).status, m(n).class], ['set-aside', 'person'], n);
    assert.equal(m(n, { aliases: { 'fdic:9001': [n] } }).status, 'set-aside', 'an alias cannot make a person a bank');
  }
  for (const n of ['Example Bank, N.A.', 'Sample Capital Fund LP', 'Sample Bancorp', 'Example Mountain Bank', 'Sample Community Bank, its successors and assigns', 'Example Lending LLC',
    'TIAA, FSB', 'United States of America, acting through the Rural Housing Service', 'Sample Parts & Services, Ltd.', 'The Example Family Trust']) assert.equal(personName(n), false, n);
  assert.match(PERSON_WITHHELD, /name withheld/);
});

test('the review list names no person: people set aside are one counted line with the name withheld', async () => {
  const { makeDir, put } = await import('./kit.mjs');
  const { buildDocument, diffDocuments, writeDiff, buildLoanIndex, loansPaths } = await import('../src/loans.mjs');
  const { readFileSync } = await import('node:fs');
  const { exampleCounty } = await import('../src/sources/counties/example.mjs');
  const dir = makeDir();
  put(dir, 'sources/fdic/institutions.json', INSTITUTIONS);
  const doc = (n, lender) => buildDocument({ documentType: 'notice_of_trustee_sale', documentNumber: n, dates: { recorded: '2026-11-11', filed: null, sale: '2026-12-01' }, parties: [{ role: 'lender', name: lender }, { role: 'grantor', name: 'Sample Holdings LLC' }],
    amounts: {}, url: `https://publictrustee.example/documents/${n}` }, { source: exampleCounty, fetchedAt: '2026-11-16T12:00:00.000Z', runId: 'r1' }).record;
  writeDiff(dir, 'example-county', diffDocuments({}, [doc('1', 'Pat Example and Jordan Example'), doc('2', 'Riley Placeholder'), doc('3', 'Example Bank, N.A.')], { runId: 'r1' }), { runId: 'r1' });
  // Each a lead: its county parcel confirms a commercial property (docs/county-loans.md 3a).
  (await import('./parcels-kit.mjs')).confirmParcels(dir, 'example-county');
  const idx = buildLoanIndex({ dir, runId: 'r1' });
  assert.deepEqual([idx.matchedDocuments, idx.setAside], [1, 2]);
  const review = readFileSync(loansPaths(dir).review, 'utf8');
  for (const leak of ['Pat Example', 'Jordan Example', 'Riley Placeholder']) assert.ok(!review.includes(leak), leak);
  assert.deepEqual(JSON.parse(review).setAside.map((x) => [x.class, x.count]), [['person', 2]]);
});
