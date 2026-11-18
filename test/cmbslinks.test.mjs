// The CMBS link (docs/county-loans.md section 9, src/cmbslinks.mjs): a county filing whose current holder is a CMBS trust, linked to the
// trust's own loan record from SEC EDGAR. The recognizer, the match, the block, the rebuild after each job, the triage line, and the rules
// (context only, no borrower, no commentary, out of the drafter's and briefer's loads). Invented trusts, firms and places only
// (test/cmbs-fake.mjs); no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeDir, put, loadJson } from './kit.mjs';
import { cmbsTrustOf, residentialSecuritization, trustCandidates, matchCmbsAsset, cmbsBlock, cmbsLinkLabel, buildCmbsLinks, currentHolders, cmbsLinksForServicer,
  originatorKey, cityOf, workoutOf, moneyShort, BLOCK_KEYS, NOT_FOUND, CMBS_LINKS_REL } from '../src/cmbslinks.mjs';
import { LOADS, snapshotFromDir, withUnitOfWork, callDeskLoads } from '../src/uow.mjs';
import { callLoads } from '../src/calls.mjs';
import { runTriage } from '../src/triage.mjs';
import { readJson } from '../src/store.mjs';
import { TRUST, OTHER, TRUST_NAME, SERVICER, storedLoans, countyDoc, holderOf, writeWorld, readLinks, DOC_ONLY } from './cmbs-fake.mjs';

const NOW = new Date('2026-11-17T13:00:00Z');
const MONDAY = new Date('2026-11-23T14:00:00Z');
const covers = (prefix, rel) => prefix === '' || rel === prefix || (prefix.endsWith('/') && rel.startsWith(prefix));
const named = (name) => cmbsTrustOf(name);
const ctx = (loans = storedLoans(TRUST, [{ n: '37' }])) => ({ trusts: { [TRUST.cik]: TRUST, [OTHER.cik]: OTHER }, loans });

// ---- 1. The name ------------------------------------------------------------------------------------------------------------------
test('the recognizer reads a CMBS trust and its series from a holder\'s name, in the forms a county document gives', () => {
  assert.deepEqual(named(holderOf()), { trust: TRUST_NAME, series: '2019-X1', shelfTokens: ['example'], commercial: true });
  const cases = [
    ['Example Trustee Bank, National Association, as Trustee for the Benefit of the Registered Holders of Sample Commercial Mortgage Trust 2017-SMP, Commercial Mortgage Pass-Through Certificates, Series 2017-SMP', 'Sample Commercial Mortgage Trust 2017-SMP', '2017-SMP'],
    ['Example Trustee Bank, as Trustee, for the benefit of the holders of EXAMPLE 2015-CCRE22 Mortgage Trust Commercial Mortgage Pass-Through Certificates', 'EXAMPLE 2015-CCRE22 Mortgage Trust', '2015-CCRE22'],
    ['Example Trustee Bank, N.A., as Trustee for the registered holders of Placeholder Bank of Example Merrill Trust 2019-C7, Commercial Mortgage Pass-Through Certificates, Series 2019-C7', 'Placeholder Bank of Example Merrill Trust 2019-C7', '2019-C7'],
    ['J.P. Example Chase Commercial Mortgage Securities Trust 2018-PHH', 'J.P. Example Chase Commercial Mortgage Securities Trust 2018-PHH', '2018-PHH'],
    ['EXAMPLE 2019-BNK19, Commercial Mortgage Pass-Through Certificates, Series 2019-BNK19', 'EXAMPLE 2019-BNK19', '2019-BNK19'],
    ['Example 2019-X1 Mortgage Trust', 'Example 2019-X1 Mortgage Trust', '2019-X1'],
  ];
  for (const [name, trust, series] of cases) {
    const r = named(name);
    assert.ok(r, name);
    assert.deepEqual([r.trust, r.series], [trust, series], name);
  }
  assert.deepEqual(named('Example Origination Bank, N.A., as Trustee for Example Initials 2019-X1 Mortgage Trust').shelfTokens, ['example', 'initials']);
  assert.deepEqual(named('J.P. Example Chase Commercial Mortgage Securities Trust 2018-PHH').shelfTokens, ['jp', 'example', 'chase'], 'initials run together');
  // Only the certificates carry the series: the shelf comes from the depositor's name before them, the trust's name is not given.
  const depositor = named('Example Trustee Bank, as Trustee for the registered holders of Sample Commercial Mortgage Securities Inc., Commercial Mortgage Pass-Through Certificates, Series 2007-PWR16');
  assert.deepEqual([depositor.trust, depositor.series, depositor.shelfTokens], [null, '2007-PWR16', ['sample']]);
  assert.equal(named('Example Trustee Bank, as Trustee, Commercial Mortgage Pass-Through Certificates, Series 2019-X1').shelfTokens.length, 0, 'no shelf named');
  // A name that does not say "Commercial" is still a candidate; only the EDGAR pull can confirm it.
  assert.equal(named('Example Trustee Bank, as Trustee for Example 2019-X1 Mortgage Trust').commercial, false);
});

test('the recognizer refuses residential and consumer securitizations, plain banks, trustees and people', () => {
  const residential = [
    'Example Trustee Bank, N.A., as Trustee for Example Home Equity Loan Trust 2006-HE3, Asset-Backed Pass-Through Certificates, Series 2006-HE3',
    'Example Trust Company Americas, as Trustee for Example Alternative Loan Trust 2005-AR6, Mortgage Pass-Through Certificates Series 2005-AR6',
    'The Bank of Example, as Trustee for the Certificateholders of Example Mortgage Trust 2006-5, Mortgage Pass-Through Certificates, Series 2006-5',
    'Example Trustee Bank, as Trustee for Example Mortgage Loan Trust 2007-FF1',
    'Example Trustee Bank, as Trustee for Sample Residential Asset Securities Corporation 2006-KS3',
    'Example Trustee Bank, as Trustee for Example ARM Trust 2005-10',
    'Example Trustee Bank, as Trustee for Example Structured Asset Securities Corporation 2006-WF1',
    'Example Trustee Bank, as Indenture Trustee for Example Auto Receivables Trust 2025-1',
    'Example Trustee Bank, as Trustee for Example Mortgage-Backed Notes, Series 2004-2',
    'Example Trustee Bank, as Trustee for Example HELOC Trust 2006-1, Home Equity Line of Credit Backed Notes',
  ];
  for (const n of residential) { assert.equal(named(n), null, n); }
  assert.equal(residentialSecuritization('Commercial Mortgage Pass-Through Certificates, Series 2019-X1'), false);
  assert.equal(residentialSecuritization('Mortgage Pass-Through Certificates, Series 2006-5'), true);
  for (const n of ['Example Origination Bank, N.A.', 'Example Trustee Bank, N.A., as Trustee', 'Sample Capital Fund LP', 'First Example Bank', 'Example Bank 2019 Holdings LLC', 'Pat Example and Jordan Example',
    'Example Public Trustee', 'Mortgage Electronic Registration Systems, Inc., as nominee for Example Origination Bank', 'Example Bank, dated 2018-06-08']) {
    assert.equal(named(n), null, n);
  }
});

test('a name confirmed as CMBS only by the EDGAR pull: same series, and the same shelf when the name gives one', () => {
  const trusts = { [TRUST.cik]: TRUST, [OTHER.cik]: OTHER };
  assert.deepEqual(trustCandidates(named(holderOf()), trusts).trusts.map((t) => t.cik), [TRUST.cik], 'the shelf tells two trusts of one series apart');
  assert.deepEqual(trustCandidates(named(holderOf('Sample 2019-X1 Commercial Mortgage Trust')), trusts).trusts.map((t) => t.cik), [OTHER.cik]);
  const seriesOnly = trustCandidates(named('Example Trustee Bank, as Trustee, Commercial Mortgage Pass-Through Certificates, Series 2019-X1'), trusts);
  assert.deepEqual([seriesOnly.by, seriesOnly.trusts.length], ['series', 2], 'a series alone is two trusts here: ambiguous, never a choice');
  assert.deepEqual(trustCandidates(named(holderOf('Placeholder 2019-X1 Mortgage Trust')), trusts).trusts, [], 'another shelf of the same series');
  assert.deepEqual(trustCandidates(named(holderOf('Example 2020-X2 Mortgage Trust', '2020-X2')), trusts).trusts, []);
});

// ---- 2. The asset -----------------------------------------------------------------------------------------------------------------
test('a unique match: the trust, the original amount to the dollar, the state, and the city, county or originator', () => {
  const m = matchCmbsAsset(countyDoc(), named(holderOf()), ctx());
  assert.equal(m.status, 'linked');
  assert.equal(m.loan.key, 'cmbs:1900001:37');
  assert.deepEqual(m.matchedOn, ['originalAmount', 'state', 'city', 'county', 'originator', 'originationDate']);
  // Any one of city, county and originator is enough beside the amount and the state; each one alone:
  const elsewhere = storedLoans(TRUST, [{ n: '37', props: [{ name: 'Example Inn', city: 'Otherville', state: 'CO', county: 'Denver', type: 'LO' }] }]);
  const byOriginator = matchCmbsAsset(countyDoc(), named(holderOf()), ctx(elsewhere));
  assert.deepEqual([byOriginator.status, byOriginator.matchedOn, byOriginator.disagreed], ['linked', ['originalAmount', 'state', 'originator', 'originationDate'], ['city', 'county']]);
  const byCounty = matchCmbsAsset(countyDoc({ parties: [{ role: 'holder', name: holderOf() }, { role: 'lender', name: 'Another Example Lender LLC' }, { role: 'grantor', name: 'Zephyrine Hospitality LLC' }], property: { address: null } }), named(holderOf()), ctx());
  assert.deepEqual([byCounty.status, byCounty.matchedOn, byCounty.disagreed], ['linked', ['originalAmount', 'state', 'county', 'originationDate'], ['originator']]);
  // MERS as nominee is read through, and the legal form is not part of the name.
  const mers = matchCmbsAsset(countyDoc({ parties: [{ role: 'holder', name: holderOf() }, { role: 'lender', name: 'Mortgage Electronic Registration Systems, Inc., as nominee for Example Origination Bank, National Association, its successors and assigns' }, { role: 'grantor', name: 'Zephyrine Hospitality LLC' }] }), named(holderOf()), ctx(elsewhere));
  assert.deepEqual([mers.status, mers.matchedOn.includes('originator')], ['linked', true]);
  assert.equal(originatorKey('The Example Origination Bank, N.A.'), originatorKey('Example Origination Bank, National Association'));
  assert.equal(originatorKey('Example Realty Funding Inc.'), originatorKey('EXAMPLE REALTY FUNDING, INC'));
  assert.notEqual(originatorKey('Example Realty Funding Inc.'), originatorKey('Example Realty Capital Inc.'), 'nothing fuzzy');
  assert.equal(cityOf('4417 Quillon Way, Anytown, CO 80000', 'CO'), 'Anytown');
  assert.equal(cityOf('4417 Quillon Way, Anytown, CO 80000', 'TX'), null);
  assert.equal(cityOf('4417 QUILLON WAY ANYTOWN CO', 'CO'), null, 'no comma, no ZIP: not read');
});

test('no link on two candidates or a missing key: the document is "trust named, loan not found", with the reason', () => {
  const doc = countyDoc();
  const n = named(holderOf());
  // Two loans with the same amount in the same county: never a choice.
  const twins = storedLoans(TRUST, [{ n: '37' }, { n: '38' }]);
  assert.deepEqual(pick(matchCmbsAsset(doc, n, ctx(twins))), { status: 'not-found', reason: 'ambiguous', candidates: 2 });
  // The amount differs by a dollar.
  assert.deepEqual(pick(matchCmbsAsset(doc, n, ctx(storedLoans(TRUST, [{ n: '37', amount: '7460001.00' }])))), { status: 'not-found', reason: 'no-asset' });
  // The county document states no original amount.
  assert.deepEqual(pick(matchCmbsAsset(countyDoc({ amounts: { originalPrincipal: { value: null, basis: 'not-stated' } } }), n, ctx())), { status: 'not-found', reason: 'no-original-amount' });
  // The same amount in another state only (asset 12 is in Arizona).
  assert.deepEqual(pick(matchCmbsAsset(doc, n, ctx(storedLoans(TRUST, [{ n: '12', props: [{ name: 'Example Suites', city: 'Mesa', state: 'AZ', county: 'Maricopa', type: 'LO' }] }])))), { status: 'not-found', reason: 'no-asset' });
  // The amount and the state, but neither city, county nor originator agrees.
  const nowhere = storedLoans(TRUST, [{ n: '37', originator: 'Another Example Lender LLC', props: [{ name: 'Example Inn', city: 'Otherville', state: 'CO', county: 'Denver', type: 'LO' }] }]);
  assert.deepEqual(pick(matchCmbsAsset(doc, n, ctx(nowhere))), { status: 'not-found', reason: 'no-asset' });
  // The trust says "Commercial" but is not in the pull; or there is no pull yet.
  assert.deepEqual(pick(matchCmbsAsset(doc, named(holderOf('Placeholder 2019-X1 Mortgage Trust')), ctx())), { status: 'not-found', reason: 'trust-not-in-edgar' });
  assert.deepEqual(pick(matchCmbsAsset(doc, n, { trusts: null, loans: {} })), { status: 'not-found', reason: 'edgar-not-run' });
  assert.deepEqual(pick(matchCmbsAsset(doc, named('Example Trustee Bank, as Trustee, Commercial Mortgage Pass-Through Certificates, Series 2019-X1'), ctx())), { status: 'not-found', reason: 'trust-ambiguous', candidates: 2 });
  // Not shown to be CMBS: no "Commercial" and not in the pull. Never recorded (it could be residential).
  assert.deepEqual(pick(matchCmbsAsset(doc, named('Example Trustee Bank, as Trustee for Placeholder 2019-X1 Mortgage Trust'), ctx())), { status: 'unconfirmed' });
  for (const r of Object.keys(NOT_FOUND)) assert.ok(NOT_FOUND[r].length > 10);
});
const pick = (m) => ({ status: m.status, ...(m.reason ? { reason: m.reason } : {}), ...(m.candidates ? { candidates: m.candidates } : {}) });

test('the current holder: a trust named only as an earlier beneficiary, with another holder now, is not linked; MERS alone is no holder', () => {
  const p = (role, name) => ({ role, name });
  assert.deepEqual(currentHolders({ parties: [p('holder', 'A'), p('beneficiary', 'B'), p('lender', 'C')] }).map((x) => x.name), ['A']);
  assert.deepEqual(currentHolders({ parties: [p('beneficiary', 'B'), p('lender', 'C')] }).map((x) => x.name), ['B'], 'no separate holder: the beneficiary holds it');
  assert.deepEqual(currentHolders({ parties: [p('holder', 'Mortgage Electronic Registration Systems, Inc.'), p('beneficiary', 'B')] }).map((x) => x.name), ['B']);
  assert.deepEqual(currentHolders({ parties: [p('assignor', 'A'), p('assignee', 'B')] }).map((x) => x.name), ['B']);
});

// ---- 3. The block -------------------------------------------------------------------------------------------------------------------
test('the block: every field picked by name, CREFC workout codes decoded, no commentary and no borrower', () => {
  const loans = storedLoans(TRUST, [{ n: '37' }]);
  const loan = loans['cmbs:1900001:37'];
  const b = cmbsBlock({ ...loan, servicerWatchlistComments: 'Borrower Pat Example asked for forbearance.', borrower: 'Zephyrine Hospitality LLC' }, TRUST, loan.properties[0]);
  assert.deepEqual(Object.keys(b), BLOCK_KEYS);
  assert.deepEqual([b.trust, b.cik, b.assetNumber, b.property.name, b.property.type.code, b.balance, b.paidThrough, b.paymentStatus.code, b.specialServicingSince, b.workout.label, b.valuation, b.valuationDate, b.occupancy, b.noi, b.dscr, b.masterServicer, b.specialServicer],
    [TRUST_NAME, '1900001', '37', 'Example Inn Anytown', 'LO', 6912345.67, '2026-01-01', '3', '2026-03-04', 'Foreclosure', 6100000, '2026-05-01', 0.64, 410000, 0.78, 'Example Master Servicer', SERVICER]);
  assert.deepEqual(b.filings, { absEe: 'https://www.sec.gov/Archives/edgar/data/1900001/000190000126000102/', ex102: 'https://www.sec.gov/Archives/edgar/data/1900001/000190000126000102/exh_102.xml', distributionReport: 'https://www.sec.gov/Archives/edgar/data/1900001/000190000126000101/' });
  for (const leak of DOC_ONLY) assert.ok(!JSON.stringify(b).includes(leak), `the block holds "${leak}"`);
  assert.ok(!JSON.stringify(loans).includes('forbearance'), 'the EDGAR adapter never stores the servicer\'s commentary either');
  const want = { 1: 'Modification', 2: 'Foreclosure', 3: 'Bankruptcy', 4: 'Extension', 5: 'Note sale', 6: 'Discounted payoff', 7: 'REO', 8: 'Resolved', 9: 'Pending return to master servicer', 10: 'Deed in lieu of foreclosure', 11: 'Full payoff', 12: 'Reps and warranties', 13: 'To be determined', 98: 'Other' };
  for (const [c, label] of Object.entries(want)) assert.deepEqual(workoutOf(c), { code: c, label });
  assert.equal(workoutOf(null), null);
  assert.deepEqual([moneyShort(7460000), moneyShort(25000000), moneyShort(1.25e9), moneyShort(950000)], ['$7.5M', '$25.0M', '$1.25B', '$950K']);
});

test('the sentence: the county event\'s style, with the loan, the trust and who services it', () => {
  const base = { status: 'linked', documentType: 'election_and_demand', countyLabel: 'Example County, CO', date: '2026-11-03', dateKind: 'recorded' };
  const loan = storedLoans(TRUST, [{ n: '37' }])['cmbs:1900001:37'];
  const block = cmbsBlock(loan, TRUST, loan.properties[0]);
  assert.equal(cmbsLinkLabel({ ...base, cmbs: block }), 'A notice of election and demand was recorded on November 3, 2026 in Example County, CO on a $7.5M hotel loan held by a CMBS trust (Example 2019-X1 Mortgage Trust, loan 37); it has been with special servicer Sample Special Servicing LLC since March 4, 2026.');
  assert.equal(cmbsLinkLabel({ ...base, documentType: 'notice_of_trustee_sale', dateKind: 'notice', cmbs: { ...block, inSpecialServicing: false, property: { type: { code: 'MF' } } } }),
    'A notice of trustee\'s sale dated November 3, 2026 was posted in Example County, CO on a $7.5M apartment loan held by a CMBS trust (Example 2019-X1 Mortgage Trust, loan 37); it is not in special servicing in the trust\'s report for October 13, 2026; the trust\'s special servicer is Sample Special Servicing LLC.');
  assert.match(cmbsLinkLabel({ ...base, cmbs: { ...block, specialServicer: null } }), /it has been in special servicing since March 4, 2026; the trust's report did not name a special servicer we could read\.$/);
  assert.equal(cmbsLinkLabel({ ...base, status: 'not-found', reason: 'no-asset', named: { trust: TRUST_NAME, series: '2019-X1' } }),
    `A notice of election and demand was recorded on November 3, 2026 in Example County, CO on a loan held by a CMBS trust (Example 2019-X1 Mortgage Trust); its loan was not found in the trust's SEC loan file: ${NOT_FOUND['no-asset']}. Look it up by hand.`);
});

// ---- The rebuild ----------------------------------------------------------------------------------------------------------------------
test('buildCmbsLinks: linked and not-found entries, the scope rule, no borrower or address, rewritten only on a change', () => {
  const docs = [
    countyDoc(),
    // Not found: the same trust, an amount no stored loan has.
    countyDoc({ documentNumber: 'FC-2026-0102/NED', amounts: { originalPrincipal: { value: 3210000, basis: 'index' } } }),
    // Out of scope: a residential loan type. Never linked, whatever its holder.
    countyDoc({ documentNumber: 'FC-2026-0103/NED', loan: { type: 'FHA', commercial: false } }),
    // Out of scope: no loan type, and every borrower a person.
    countyDoc({ documentNumber: 'FC-2026-0104/NED', loan: null, parties: [{ role: 'holder', name: holderOf() }, { role: 'grantor', name: 'Pat Example and Jordan Example' }] }),
    // The trust is only the beneficiary on the deed of trust; a fund holds the loan now.
    countyDoc({ documentNumber: 'FC-2026-0105/NED', parties: [{ role: 'holder', name: 'Sample Capital Fund LP' }, { role: 'beneficiary', name: holderOf() }, { role: 'grantor', name: 'Zephyrine Hospitality LLC' }] }),
    // A residential securitization with a series a CMBS trust also has: never read as CMBS.
    countyDoc({ documentNumber: 'FC-2026-0106/NED', parties: [{ role: 'holder', name: 'Example Trustee Bank, as Trustee for Example Home Equity Loan Trust 2019-X1, Asset-Backed Pass-Through Certificates, Series 2019-X1' }, { role: 'grantor', name: 'Zephyrine Hospitality LLC' }] }),
    // A bank holds it: nothing to link.
    countyDoc({ documentNumber: 'FC-2026-0107/NED', parties: [{ role: 'holder', name: 'Example Origination Bank, N.A.' }, { role: 'grantor', name: 'Zephyrine Hospitality LLC' }] }),
  ];
  const dir = writeWorld(makeDir(), { docs });
  const c = buildCmbsLinks({ dir, now: NOW });
  assert.deepEqual(c, { documents: 7, outOfScope: 2, named: 2, linked: 1, notFound: 1, unconfirmed: 0, byReason: { 'no-asset': 1 }, written: true });
  const f = readLinks(dir);
  assert.deepEqual(Object.keys(f.links).sort(), ['example-arapahoe:FC-2026-0101/NED', 'example-arapahoe:FC-2026-0102/NED']);
  const l = f.links['example-arapahoe:FC-2026-0101/NED'];
  assert.deepEqual([l.status, l.cmbs.loanKey, l.contextOnly, l.scored, l.scope], ['linked', 'cmbs:1900001:37', true, false, { commercial: true, borrowers: null }]);
  assert.equal(f.links['example-arapahoe:FC-2026-0102/NED'].reason, 'no-asset');
  const text = JSON.stringify(f);
  for (const leak of DOC_ONLY) assert.ok(!text.includes(leak), `the link file holds "${leak}"`);
  assert.equal(CMBS_LINKS_REL, 'loans/cmbs.json');
  assert.match(CMBS_LINKS_REL, /^[A-Za-z0-9_][A-Za-z0-9_./-]*$/, 'fits the documents table\'s path rule');
  // The same data again: nothing written, and the link keeps when it was first made.
  assert.equal(buildCmbsLinks({ dir, now: new Date('2026-11-18T13:00:00Z') }).written, false);
  assert.equal(readLinks(dir).links['example-arapahoe:FC-2026-0101/NED'].firstSeenAt, NOW.toISOString());
  // A new month's loan file changes the block: rewritten, still first made at the same time.
  put(dir, 'sources/edgar/loans.json', storedLoans(TRUST, [{ n: '37', balance: '6800000.00', paidThrough: '02-01-2026' }]));
  assert.equal(buildCmbsLinks({ dir, now: new Date('2026-11-20T13:00:00Z') }).written, true);
  const after = readLinks(dir).links['example-arapahoe:FC-2026-0101/NED'];
  assert.deepEqual([after.cmbs.balance, after.cmbs.paidThrough, after.firstSeenAt], [6800000, '2026-02-01', NOW.toISOString()]);
  // Before any EDGAR pull: the "Commercial" trust is recorded as not found, to look up by hand.
  const early = writeWorld(makeDir(), { docs: [countyDoc()], edgar: false });
  buildCmbsLinks({ dir: early, now: NOW });
  assert.deepEqual([readLinks(early).links['example-arapahoe:FC-2026-0101/NED'].reason, readLinks(early).edgar], ['edgar-not-run', null]);
});

test('the servicer\'s list holds its linked filings in scope only', () => {
  const dir = writeWorld(makeDir(), { docs: [countyDoc()] });
  buildCmbsLinks({ dir, now: NOW });
  const f = readLinks(dir);
  assert.deepEqual(cmbsLinksForServicer(f, SERVICER).map((e) => e.documentId), ['example-arapahoe:FC-2026-0101/NED']);
  assert.deepEqual(cmbsLinksForServicer(f, 'Placeholder Special Servicer Inc'), []);
  const residential = { links: { x: { ...f.links['example-arapahoe:FC-2026-0101/NED'], scope: { commercial: false, borrowers: null } } } };
  assert.deepEqual(cmbsLinksForServicer(residential, SERVICER), [], 'the scope guard');
  assert.deepEqual(cmbsLinksForServicer({ links: { x: { ...f.links['example-arapahoe:FC-2026-0101/NED'], scope: undefined } } }, SERVICER), [], 'written before the rule: not shown');
});

// ---- The triage ---------------------------------------------------------------------------------------------------------------------
test('the weekly triage: one Watch line per newly linked filing, under its special servicer, never act now, never twice', () => {
  const dir = writeWorld(makeDir(), { docs: [countyDoc(), countyDoc({ documentNumber: 'FC-2026-0102/NED', amounts: { originalPrincipal: { value: 3210000, basis: 'index' } } })] });
  buildCmbsLinks({ dir, now: NOW });
  const rules = structuredClone(loadJson('triage.json'));
  const t = runTriage({ dir, rules, now: MONDAY, metros: loadJson('metros.json'), scoring: loadJson('scoring.json') });
  const lines = [...t.actNow, ...t.watch, ...t.inConversation].flatMap((i) => i.findings.filter((f) => f.type === 'county-cmbs').map((f) => ({ ...f, key: i.key, name: i.name, category: i.category, links: i.links })));
  assert.equal(lines.length, 1, 'the linked filing only; the not-found one waits for a principal on `outbound loans cmbs`');
  assert.deepEqual([lines[0].key, lines[0].name, lines[0].category, lines[0].links.servicer], [`servicer:${SERVICER}`, SERVICER, 'watch', `/servicers/${encodeURIComponent(SERVICER)}`]);
  assert.equal(lines[0].reason, 'A notice of election and demand was recorded on November 3, 2026 in Arapahoe County, CO on a $7.5M hotel loan held by a CMBS trust (Example 2019-X1 Mortgage Trust, loan 37); it has been with special servicer Sample Special Servicing LLC since March 4, 2026.');
  assert.ok(!t.actNow.length);
  const md = readFileSync(join(dir, 'triage', '2026-11-23.md'), 'utf8');
  assert.match(md, /held by a CMBS trust/);
  for (const leak of DOC_ONLY) assert.ok(!md.includes(leak) && !JSON.stringify(t).includes(leak), `the triage holds "${leak}"`);
  // The next week: seen, not listed again.
  const t2 = runTriage({ dir, rules, now: new Date('2026-11-30T14:00:00Z'), metros: loadJson('metros.json'), scoring: loadJson('scoring.json') });
  assert.ok(![...t2.actNow, ...t2.watch].some((i) => i.findings.some((f) => f.type === 'county-cmbs')));
  // A link the scope rule did not write (or wrote residential) is never listed.
  const d2 = makeDir();
  const f = readJson(join(dir, 'loans', 'cmbs.json'));
  for (const e of Object.values(f.links)) e.scope = { commercial: false, borrowers: null };
  put(d2, 'loans/cmbs.json', f);
  const t3 = runTriage({ dir: d2, rules, now: MONDAY, metros: loadJson('metros.json'), scoring: loadJson('scoring.json') });
  assert.ok(![...t3.actNow, ...t3.watch].some((i) => i.findings.some((x) => x.type === 'county-cmbs')));
  assert.equal(rules.strength['county-cmbs'] > rules.strength['county-document'] && rules.strength['county-cmbs'] < rules.strength['cmbs-special-servicing'], true);
});

// ---- The rules: context only, out of every model-facing load ------------------------------------------------------------------------
test('LOADS: the link file is out of the drafter\'s, the briefer\'s, every model-facing list\'s and scoring\'s; its own job loads only what it needs', () => {
  const modelFacing = { research: LOADS.research, draft: LOADS.draft, approve: LOADS.approve, callDesk: LOADS.callDesk, callDeskNarrowed: callDeskLoads('acme-bank'),
    ...Object.fromEntries(['callPrep', 'callNotes', 'callExtract', 'callConfirm'].flatMap((k) => [[k, LOADS[k]], [`${k}Narrowed`, callLoads(k, 'acme-bank')]])), score: LOADS.score };
  for (const [kind, list] of Object.entries(modelFacing)) for (const p of [CMBS_LINKS_REL, 'loans/docs/example-arapahoe.json']) assert.ok(!list.some((x) => covers(x, p)), `${kind} covers ${p}`);
  assert.deepEqual(LOADS.cmbs, ['loans/docs/', 'loans/cmbs.json', 'sources/edgar/trusts.json', 'sources/edgar/loans.json', 'sources/edgar/state.json']);
  assert.ok(LOADS.triage.includes(CMBS_LINKS_REL) && !LOADS.triage.some((p) => p === 'loans/' || p.startsWith('loans/docs')), 'the triage reads the links, never the documents');
  // Scoring's rules name no county or CMBS-link signal.
  assert.doesNotMatch(JSON.stringify(loadJson('scoring.json').signals ?? []), /county|cmbs link|trustee/i);
});

test('the rebuild runs inside a unit of work with exactly LOADS.cmbs, and writes only loans/cmbs.json', async () => {
  const dir = writeWorld(makeDir(), { docs: [countyDoc()] });
  put(dir, 'loans/events.json', {}); put(dir, 'candidates/latest.json', { items: [] });
  const snap = snapshotFromDir(dir, LOADS.cmbs);
  const { plan, result } = await withUnitOfWork({ load: async () => snap, flush: async () => {} }, LOADS.cmbs, (root) => buildCmbsLinks({ dir: root, now: NOW }));
  assert.equal(result.linked, 1);
  assert.deepEqual(plan.docs.map((d) => d.path), ['loans/cmbs.json']);
  assert.deepEqual(plan.lines, []);
});

// ---- The rebuild after each job (the worker, against the fake Supabase REST API) ---------------------------------------------------
const LA = { id: 'example-la', county: { fips: '06037', name: 'Los Angeles' }, state: 'CA', hosts: ['records.example'] };
// The EDGAR fake's trust (test/edgar-fake.mjs): asset 1 is a Los Angeles apartment loan of $25,000,000 in special servicing.
const laDoc = () => countyDoc({ documentNumber: '2026-0909', parties: [{ role: 'holder', name: holderOf('Example Commercial Mortgage Trust 2021-C1', '2021-C1') }, { role: 'grantor', name: 'Zephyrine Apartments LLC' }],
  property: { address: '1 Quillon Street, Los Angeles, CA 90012' }, amounts: { originalPrincipal: { value: 25000000, basis: 'document' } }, deedOfTrust: null, url: 'https://records.example/doc/2026-0909' }, { source: LA });
async function platform() {
  const { fakePostgrest } = await import('./postgrest-fake.mjs');
  const { platformClient } = await import('../src/platform/client.mjs');
  const fake = fakePostgrest();
  const doc = laDoc();
  fake.docs.set(`loans/docs/${LA.id}.json`, { path: `loans/docs/${LA.id}.json`, kind: 'json', body: { [doc.id]: doc }, text: null, version: 1 });
  const url = 'https://example-project.supabase.test';
  return { fake, pat: platformClient({ url, key: 'anon-key', accessToken: 'user:pat@example.test', fetchImpl: fake.fetchImpl }), service: platformClient({ url, key: 'service', fetchImpl: fake.fetchImpl }), doc };
}

test('after sources.edgar the worker rebuilds the links in their own unit of work, and the job result holds counts only', async () => {
  const { fakeSec } = await import('./edgar-fake.mjs');
  const { work } = await import('../src/platform/worker.mjs');
  const { loadRules } = await import('../src/rules.mjs');
  const shipped = loadRules();
  const rules = { ...shipped, config: { ...shipped.config, sec: { ...shipped.config.sec, userAgent: 'Example Firm ops@example.test', minIntervalMs: 0, knownSpecialServicers: ['Example Special Servicing LLC'] } } };
  const { fake, pat, service, doc } = await platform();
  await pat.enqueue('sources.edgar');
  await work({ client: service, rules, deps: { fetchImpl: fakeSec().fetchImpl, now: () => new Date('2026-11-13T12:00:00Z') } });
  const job = fake.jobs[0];
  assert.equal(job.status, 'done', JSON.stringify(job.result));
  assert.deepEqual([job.result.cmbsLinks.outcome, job.result.cmbsLinks.linked, job.result.cmbsLinks.notFound, job.result.cmbsLinks.written], ['ok', 1, 0, true]);
  const link = fake.docs.get('loans/cmbs.json').body.links[doc.id];
  assert.deepEqual([link.status, link.cmbs.loanKey, link.cmbs.specialServicer, link.cmbs.inSpecialServicing], ['linked', 'cmbs:1000001:1', 'Example Special Servicing LLC', true]);
  assert.equal(link.label, 'A notice of election and demand was recorded on November 3, 2026 in Los Angeles County, CA on a $25.0M apartment loan held by a CMBS trust (Example Commercial Mortgage Trust 2021-C1, loan 1); it has been with special servicer Example Special Servicing LLC since June 2, 2026.');
  assert.doesNotMatch(JSON.stringify(job.result), /Example|Sample|Zephyrine|Quillon/, 'the job result holds counts, not names');
  assert.ok(fake.docs.has('sales/ledger.json'), 'the sale ledger is still rebuilt first');
});

test('after loans.watch the worker rebuilds the links from the documents now stored, even with no county run this week', async () => {
  const { work } = await import('../src/platform/worker.mjs');
  const { loadRules } = await import('../src/rules.mjs');
  const shipped = loadRules(), sc = shipped.config.counties;
  const off = Object.fromEntries(Object.keys(sc.sources).filter((k) => !k.startsWith('_')).map((k) => [k, { enabled: false, waitingOn: 'paused for this test.' }]));
  const rules = { ...shipped, config: { ...shipped.config, counties: { ...sc, watch: [], sources: { ...sc.sources, ...off } } } };
  const { fake, pat, service, doc } = await platform();
  // What sources.edgar stored: the trust and its in-market loan.
  const trust = { cik: '1000001', name: 'Example Commercial Mortgage Trust 2021-C1', accession: '0009999999-26-000102', specialServicer: SERVICER, specialServicerMatched: true, distributionReport: null };
  const loans = storedLoans(trust, [{ n: '1', amount: '25000000.00', originator: 'Example Origination Bank', props: [{ name: 'Example Apartments', city: 'Los Angeles', state: 'CA', county: 'Los Angeles', type: 'MF' }] }]);
  for (const [path, body] of [['sources/edgar/trusts.json', { 1000001: trust }], ['sources/edgar/loans.json', loans], ['sources/edgar/state.json', { lastRun: 'edgar-x', ranAt: '2026-11-13T12:00:00Z' }]]) fake.docs.set(path, { path, kind: 'json', body, text: null, version: 1 });
  await pat.enqueue('loans.watch');
  await work({ client: service, rules, deps: { now: () => new Date('2026-11-16T14:00:00Z'), fetchImpl: async () => { throw new Error('no network in this test'); } } });
  const job = fake.jobs[0];
  assert.equal(job.status, 'done', JSON.stringify(job.result));
  assert.deepEqual([job.result.watched, job.result.cmbsLinks.outcome, job.result.cmbsLinks.linked], [0, 'ok', 1]);
  assert.equal(fake.docs.get('loans/cmbs.json').body.links[doc.id].cmbs.specialServicer, SERVICER);
  assert.doesNotMatch(JSON.stringify(job.result), /Example|Sample|Zephyrine|Quillon/);
  // The same week again: nothing changed, nothing written.
  const version = fake.docs.get('loans/cmbs.json').version;
  await pat.enqueue('loans.watch');
  await work({ client: service, rules, deps: { now: () => new Date('2026-11-16T15:00:00Z') } });
  assert.deepEqual([fake.jobs[1].status, fake.jobs[1].result.cmbsLinks.written, fake.docs.get('loans/cmbs.json').version], ['done', false, version]);
});
