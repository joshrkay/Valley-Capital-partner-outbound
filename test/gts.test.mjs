// The GTS readers (src/sources/counties/gts.mjs) and the Jefferson and Douglas adapters (jefferson.mjs, douglas.mjs), against the fakes
// in test/gts-fake.mjs: the index, links found by their text, files known by their ETag and the report's dates, pdftotext, the NED and
// pre-sale parsers with every field checked, the decision gate, two weeks of each county's watcher, the backfill and the verify check.
// Invented data only. No network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { makeDir, put, config } from './kit.mjs';
import { readJson, readJsonl } from '../src/store.mjs';
import { defineNoticeSource, runNoticeSource, verifyNoticeSource, runnable } from '../src/sources/notices.mjs';
import { reportLinks, findReport, parseReportIndex, planFiles, fileKey, pdfToText, hasPdftotext, parsePreSaleText, apnIn, mdy, longYmd, layoutLines, readLayout } from '../src/sources/counties/gts.mjs';
import { jefferson, parseNedText, commercialFromLoanType, JEFFERSON_REPORTS } from '../src/sources/counties/jefferson.mjs';
import { douglas } from '../src/sources/counties/douglas.mjs';
import { buildDocument, loansPaths, readLoanState, readBankLoans, loanEvents } from '../src/loans.mjs';
import { INSTITUTIONS } from './county-notices-fake.mjs';
import { nedText, nedRecord, presaleText, NED_WEEK1, NED_WEEK2, JEFFERSON_PRESALE, DOUGLAS_MONDAY, DOUGLAS_TUESDAY, reportsHtml, indexHtml, textPdf, layoutOf,
  jeffersonSite, douglasSite, BORROWERS, ADDRESSES, LEGAL_WORDS, APNS } from './gts-fake.mjs';

const POPPLER = hasPdftotext();
const URL_J = 'https://gts.co.jefferson.co.us/Report_Files/NED%2011-12-2026.pdf';
const URL_D = 'https://apps.douglasco.gov/gts/Report_Files/11-18-26%20PreSale.pdf';
// The adapters as a principal would leave them once the decision is recorded: for the tests only.
const allowed = (s) => defineNoticeSource({ ...s, terms: { ...s.terms, decision: 'allowed', by: 'Pat Example' } });
const J = allowed(jefferson), D = allowed(douglas);
const counties = (over = {}) => { const c = config().counties; return { ...c, sources: { ...c.sources, jefferson: { enabled: true }, douglas: { enabled: true } }, ...over }; };
const T1 = new Date('2026-11-18T12:00:00Z'), T2 = new Date('2026-11-25T12:00:00Z');
const world = () => { const dir = makeDir(); put(dir, 'sources/fdic/institutions.json', INSTITUTIONS); return dir; };
const run = (dir, source, site, now = T1, over = {}) => runNoticeSource({ dir, source, counties: counties(), fetchImpl: site.fetchImpl, sleep: async () => {}, now, clock: () => now, pdfToText: layoutOf, ...over });

test('the index: its title, and each file with its month, posted date, address (spaces encoded), link text and description, oldest first', () => {
  const html = indexHtml('Jefferson', 'Election and Demand Notices Filed', [['November, 2026', [
    { posted: '11/12/2026', file: 'NED 11-12-2026.pdf', text: 'NED\'S recorded on November 12, 2026' },
    { posted: 'soon', file: 'NED  11-5-2026.pdf', text: 'NED\'S recorded on November 5, 2026\t' },
  ]], ['October, 2026', [{ posted: '10/22/2026', file: 'NED 10-22-2026.pdf', text: 'NEDs' }]]]);
  const idx = parseReportIndex(`${html}<a href="Report_Files/notes.docx">x</a>`, { url: 'https://gts.co.jefferson.co.us/report?t=7' });
  assert.equal(idx.title, 'Election and Demand Notices Filed');
  assert.deepEqual(idx.files.map((f) => [f.month, f.posted, f.url]), [
    ['2026-10', '2026-10-22', 'https://gts.co.jefferson.co.us/Report_Files/NED%2010-22-2026.pdf'],
    ['2026-11', '2026-11-12', 'https://gts.co.jefferson.co.us/Report_Files/NED%2011-12-2026.pdf'],
    ['2026-11', null, 'https://gts.co.jefferson.co.us/Report_Files/NED%20%2011-5-2026.pdf'],
  ], 'oldest first; a posted date that is not a date is null and sorts last; two spaces in a name stay two');
  assert.equal(idx.files[1].label, 'NED\'S recorded on November 12, 2026');
  // Douglas's index sits under /gts/: its relative links resolve there.
  const d = parseReportIndex(indexHtml('Douglas', 'Current Pre Sale List', [['November, 2026', [{ posted: '11/16/2026', file: '11-18-26 PreSale.pdf', text: 'Pre-Sale Report' }]]], 1), { url: 'https://apps.douglasco.gov/gts/report?t=1' });
  assert.equal(d.files[0].url, 'https://apps.douglasco.gov/gts/Report_Files/11-18-26%20PreSale.pdf');
});

test('links are found by their text, never the type number: the same texts find each county\'s reports, and "Archived" is a different report', () => {
  const jl = reportLinks(reportsHtml('Jefferson', [['/report?t=6', 'Pre Sale List'], ['/report?t=7', 'Election and Demand Notices Filed'], ['/report?t=14', 'Archived Election and Demand Notices Filed']]), { url: JEFFERSON_REPORTS });
  const dl = reportLinks(reportsHtml('Douglas', [['/gts/report?t=1', 'Current Pre Sale List']]), { url: 'https://apps.douglasco.gov/gts/reports' });
  const presale = ['Pre Sale List', 'Current Pre Sale List'];
  assert.equal(findReport(jl, presale).url, 'https://gts.co.jefferson.co.us/report?t=6');
  assert.equal(findReport(dl, presale).url, 'https://apps.douglasco.gov/gts/report?t=1');
  assert.equal(findReport(jl, ['Election and Demand Notices Filed']).url, 'https://gts.co.jefferson.co.us/report?t=7');
  assert.equal(findReport(jl, ['archived  election and demand notices filed']).url, 'https://gts.co.jefferson.co.us/report?t=14', 'case and spacing ignored');
  // Renumbered: the text still finds it.
  const moved = reportLinks(reportsHtml('Jefferson', [['/report?t=99', 'Election and Demand Notices Filed']]), { url: JEFFERSON_REPORTS });
  assert.equal(findReport(moved, ['Election and Demand Notices Filed']).url, 'https://gts.co.jefferson.co.us/report?t=99');
  assert.equal(findReport(dl, ['Election and Demand Notices Filed']), null);
});

test('files are known by their validator and the report\'s own dates: a file read before is left alone, a repeated name is asked for conditionally', () => {
  const files = [{ url: 'https://h.example/Report_Files/a.pdf', posted: '2026-11-17', label: 'a' }, { url: 'https://h.example/Report_Files/b.pdf', posted: '2026-11-24', label: 'b' }, { url: 'https://h.example/Report_Files/c.pdf', posted: '2026-11-24', label: 'c' }];
  const state = { files: [{ url: 'https://h.example/Report_Files/a.pdf', posted: '2026-11-17', etag: '"1"' }, { url: 'https://h.example/Report_Files/b.pdf', posted: '2026-11-17', etag: '"2"', lastModified: 'Tue, 17 Nov 2026 18:00:00 GMT' }] };
  const p = planFiles(files, state, { kind: 'presale' });
  assert.equal(p.known, 1, 'a: same address, same posted date: no request');
  assert.deepEqual(p.follow.map((f) => [f.label, f.conditional ?? null]), [['b', { etag: '"2"', lastModified: 'Tue, 17 Nov 2026 18:00:00 GMT' }], ['c', null]]);
  assert.ok(p.follow.every((f) => f.binary && f.kind === 'presale'));
  // No state (the verify check): every file, none conditional. `since` keeps only files from that date.
  assert.equal(planFiles(files, null, { kind: 'x' }).follow.length, 3);
  assert.deepEqual(planFiles([{ url: 'u1', posted: '2024-12-01' }, { url: 'u2', posted: '2025-01-01' }, { url: 'u3', posted: null, month: '2024-11' }], null, { kind: 'ned', since: '2025-01-01' }).follow.map((f) => f.url), ['u2']);
  // The key: the ETag (else Last-Modified) and the report's dates, never the name.
  assert.equal(fileKey({ etag: '"b0:0"', lastModified: 'x' }, { from: '2026-11-17', through: '2026-11-19' }), 'etag:"b0:0"|2026-11-17..2026-11-19');
  assert.equal(fileKey({ lastModified: 'Tue, 17 Nov 2026 18:00:00 GMT' }, { from: '2026-11-17', through: '2026-11-19' }), 'modified:Tue, 17 Nov 2026 18:00:00 GMT|2026-11-17..2026-11-19');
  assert.notEqual(fileKey({ etag: '"1"' }, { from: '2026-11-17', through: '2026-11-19' }), fileKey({ etag: '"1"' }, { from: '2026-11-24', through: '2026-11-26' }), 'the same name and validator a week on is a new report');
});

test('pdftotext: a child process, the PDF on stdin and the layout text back; a file that is not a PDF is refused, and a missing poppler says so', { skip: !POPPLER && 'poppler-utils (pdftotext) is not installed' }, async () => {
  const text = nedText(NED_WEEK1().slice(0, 2));
  const got = await pdfToText(textPdf(text));
  assert.match(got, /Foreclosure Number:\s+J2699001/);
  assert.match(got, /Original Note Amt: \$4,200,000\.00\s+LoanType:\s+Commercial\s+Interest Rate:/, 'columns kept on one line');
  // The parse of poppler's text is the parse of the text itself.
  assert.deepEqual(parseNedText(got, { url: URL_J }).documents, parseNedText(text, { url: URL_J }).documents);
  await assert.rejects(pdfToText(Buffer.from('<html>an error page</html>')), /not a PDF/);
  await assert.rejects(pdfToText(Buffer.from('%PDF-1.4\nnot really')), /could not read the file/);
});

test('pdftotext missing: the error names poppler-utils', async () => {
  await assert.rejects(pdfToText(textPdf('x\f'), { bin: 'pdftotext-not-installed-here' }), /poppler-utils/);
});

test('the NED report: each record split on "Foreclosure Number:", every label mapped to the record, lender-side and borrower-side apart', () => {
  const p = parseNedText(nedText(NED_WEEK1()), { url: URL_J });
  assert.deepEqual([p.rows, p.documents.length, p.skipped, p.missing], [5, 5, [], {}]);
  assert.deepEqual(p.reportDates, { from: '2026-11-12', through: '2026-11-12' });
  const [a, b, c, d, e] = p.documents;
  assert.deepEqual([a.documentType, a.documentNumber, a.dates], ['election_and_demand', 'J2699001/NED', { recorded: '2026-11-12', filed: null, listed: null, sale: '2027-03-10' }]);
  assert.deepEqual(a.parties, [{ role: 'holder', name: 'Example Bank, N.A.' }, { role: 'lender', name: 'Example Bank, N.A., Its Successors and Assigns' }, { role: 'attorney', name: 'Sample & Example LLP' },
    { role: 'grantor', name: BORROWERS[0] }, { role: 'owner', name: BORROWERS[0] }]);
  assert.deepEqual(a.property, { address: ADDRESSES[0], apn: APNS[0], legal: `LOT 4, BLOCK 7, ${LEGAL_WORDS[0]} FILING NO. 2, COUNTY OF JEFFERSON, STATE OF COLORADO. APN #: ${APNS[0]}`, useCode: null, propertyType: null });
  assert.deepEqual(a.amounts, { originalPrincipal: { value: 4200000, basis: 'index', label: 'Original Note Amt' }, unpaidBalance: { value: 3875000, basis: 'index', label: 'Current Amount', asOf: '2026-10-30' } });
  assert.deepEqual(a.deedOfTrust, { documentNumber: '2019009001', recorded: '2019-06-20', dated: '2019-06-15' });
  assert.deepEqual(a.loan, { type: 'Commercial', commercial: true });
  assert.deepEqual(a.foreclosure, { number: 'J2699001', reception: '2026099001', attorneyFileNumber: 'CO-26-0000101-XX', publication: { first: '2027-01-20', last: '2027-02-17' }, amendedPublication: null, bid: null, deficiency: null });
  assert.deepEqual(a.unread, []);
  assert.equal(a.url, URL_J);
  // Names that wrap are read whole; a lender through MERS keeps its words for the matcher; an amount without "$" is still money.
  assert.equal(b.parties[0].name, 'Sample Trust Company, N.A., not in its individual capacity, but solely as trustee on behalf of Sample 2025-1 Trust');
  assert.equal(b.parties[1].name, 'Mortgage Electronic Registration Systems, Inc. as Nominee for Sample Community Bank, Its Successors and Assigns');
  assert.deepEqual([b.property.address, b.property.apn, b.amounts.originalPrincipal.value, b.loan], [null, null, 2150000, { type: 'BPL Commercial', commercial: true }]);
  assert.equal(b.foreclosure.attorneyFileNumber, 'Sample Matter', 'the file number stops at "Phone:"');
  assert.equal(c.property.legal, `LOT 21, ${LEGAL_WORDS[2]} SUBDIVISION, COUNTY OF JEFFERSON, STATE OF COLORADO APN #: ${APNS[1]}`);
  assert.equal(e.parties[1].name, 'MORTGAGE ELECTRONIC REGISTRATION SYSTEMS, INC. AS NOMINEE FOR FIRST EXAMPLE BANK, ITS SUCCESSORS AND ASSIGNS');
  // LoanType kept, and read to the commercial flag: three of the five are commercial.
  assert.deepEqual(p.documents.map((x) => [x.loan.type, x.loan.commercial]), [['Commercial', true], ['BPL Commercial', true], ['FHA', false], ['business', true], ['Conventional', false]]);
  assert.deepEqual([commercialFromLoanType('Conv'), commercialFromLoanType('VA'), commercialFromLoanType('Seller Carry'), commercialFromLoanType('')], [false, false, null, null], 'an unknown type is not guessed');
  // Each document builds into a record for the source.
  for (const x of p.documents) assert.deepEqual(buildDocument(x, { source: J, fetchedAt: T1.toISOString(), runId: 'r' }).errors, []);
  // Field counts, per label.
  assert.deepEqual(p.stats['Address:'], { parsed: 4, notRead: 0, empty: 1, absent: 0 });
  assert.deepEqual(p.stats['APN # (in Legal)'], { parsed: 2, notRead: 0, empty: 0, absent: 3 });
  assert.equal(d.parties.find((x) => x.role === 'grantor').name, `${BORROWERS[3]} AND ${BORROWERS[4]}`);
});

test('the NED checks: a date or amount that fails is not read and named, a label missing leaves its field empty, and a report without its labels is a format change', () => {
  const recs = NED_WEEK1().slice(0, 3);
  recs[0] = { ...recs[0], saleDate: '13/45/2027', current: 'about $3.9M', asOf: '10/31', dotReception: 'see deed' };
  recs[1] = { ...recs[1], omit: ['owner', 'lastPublication'] };
  recs[2] = { ...recs[2], number: 'not a number' };
  const p = parseNedText(nedText(recs), { url: URL_J });
  assert.deepEqual([p.rows, p.documents.length, p.skipped], [3, 2, [{ reason: 'the foreclosure number could not be read' }]]);
  const [a, b] = p.documents;
  assert.deepEqual([a.dates.sale, a.amounts.unpaidBalance, a.deedOfTrust.documentNumber], [null, { value: null, basis: 'not-read' }, null]);
  assert.deepEqual([...a.unread].sort(), ['amounts.unpaidBalance', 'amounts.unpaidBalance.asOf', 'dates.sale', 'deedOfTrust.documentNumber']);
  // The counts cover every record read, the one left out too.
  assert.deepEqual(p.stats['Original Sale Date:'], { parsed: 2, notRead: 1, empty: 0, absent: 0 });
  assert.deepEqual(p.stats['Foreclosure Number:'], { parsed: 2, notRead: 1, empty: 0, absent: 0 });
  // Missing labels: no owner, no last publication date; nothing guessed, nothing marked unread.
  assert.deepEqual([b.parties.some((x) => x.role === 'owner'), b.foreclosure.publication, b.unread], [false, { first: '2027-01-20', last: null }, []]);
  assert.deepEqual(p.stats['Current Owner:'], { parsed: 2, notRead: 0, empty: 0, absent: 1 });
  // An unreadable NED date, or no lender at all, leaves the record out with its reason.
  const q = parseNedText(nedText([{ ...NED_WEEK1()[0], nedDate: '11/12' }, { ...NED_WEEK1()[1], holder: [''], lender: [''] }]), { url: URL_J });
  assert.deepEqual(q.skipped.map((s) => s.reason), ['the NED date could not be read', 'no lender named']);
  // Format changes: a label no record carries, a report for another county, no title.
  assert.deepEqual(parseNedText(nedText(NED_WEEK1().map((r) => ({ ...r, omit: ['lender'] }))), { url: URL_J }).missing, { 'Grantee (Lender On Deed of Trust):': 1 });
  assert.deepEqual(Object.keys(parseNedText(nedText(NED_WEEK1(), { county: 'Denver' }), { url: URL_J }).missing), ['a report titled for Jefferson County']);
  assert.ok(Object.keys(parseNedText('Foreclosure Number: J1\n', { url: URL_J }).missing).some((k) => /title/.test(k)));
});

test('the pre-sale list, one parser for both counties: split on "Foreclosure: #:", the parcel read from inside the legal description, the header\'s sale date', () => {
  const j = parsePreSaleText(presaleText(JEFFERSON_PRESALE()), { url: URL_J, county: 'Jefferson' });
  assert.deepEqual([j.rows, j.documents.length, j.skipped, j.missing], [3, 3, [], {}]);
  assert.deepEqual(j.reportDates, { from: '2026-11-17', through: '2026-11-19' });
  const [a, b, c] = j.documents;
  assert.deepEqual([a.documentType, a.documentNumber, a.dates], ['notice_of_trustee_sale', 'J2690044/SALE', { recorded: null, filed: null, listed: '2026-11-17', sale: '2026-11-19' }]);
  assert.deepEqual(a.parties, [{ role: 'holder', name: 'Example Bank, N.A.' }, { role: 'grantor', name: BORROWERS[9] }]);
  assert.deepEqual([a.property.apn, a.property.address], [APNS[2], ADDRESSES[7]]);
  assert.deepEqual(a.amounts, { originalPrincipal: { value: null, basis: 'not-stated' }, unpaidBalance: { value: 245000, basis: 'index', label: 'Total Indebtedness' } });
  assert.deepEqual([a.foreclosure.bid, a.foreclosure.deficiency], [{ value: 245000, basis: 'index', label: 'Lender\'s Bid Amount' }, { value: 0, basis: 'index', label: 'Deficiency' }], '"$ 0.00" is zero, stated');
  assert.deepEqual(a.foreclosure.publication, { first: '2026-09-02', last: '2026-09-30' });
  assert.equal(b.property.apn, null, '"PARCEL 1, SECTION 30" carries no label, so no number');
  assert.equal(c.property.apn, APNS[3]);
  const d = parsePreSaleText(presaleText(DOUGLAS_MONDAY(), { county: 'Douglas', runDate: '2026-11-16', runTime: '1:15:00PM', saleDate: '2026-11-18' }), { url: URL_D, county: 'Douglas' });
  assert.deepEqual([d.rows, d.documents.length, d.missing], [3, 3, {}]);
  const [x, y, z] = d.documents;
  assert.equal(x.property.apn, APNS[4], '"APN:" at a line\'s end, its number on the next');
  assert.equal(z.property.apn, APNS[5], '"PARCEL ID:"');
  assert.equal(y.parties[0].name, 'SAMPLE TRUST COMPANY, NATIONAL ASSOCIATION, NOT IN ITS INDIVIDUAL CAPACITY BUT SOLELY AS TRUSTEE FOR SAMPLE TRUST');
  // "8/5/26" has a two-digit year: not read, never given a century.
  assert.deepEqual([x.foreclosure.amendedPublication, x.unread], [{ first: null, last: '2026-09-02' }, ['foreclosure.amendedPublication.first']]);
  assert.deepEqual([x.amounts.unpaidBalance.value, x.foreclosure.bid.value, x.foreclosure.deficiency.value], [2300000, 1600000, 700000]);
  for (const doc of [...j.documents, ...d.documents]) assert.deepEqual(buildDocument(doc, { source: doc.documentNumber.startsWith('J') ? J : D, fetchedAt: T1.toISOString(), runId: 'r' }).errors, []);
  // Helpers.
  assert.deepEqual([mdy('11/5/2026'), mdy('8/5/26'), mdy('02/30/2026'), longYmd('Tuesday, November 17, 2026'), longYmd('Smarch 1, 2026')], ['2026-11-05', null, null, '2026-11-17', null]);
  assert.deepEqual([apnIn('LOT 1. APN: 12-345-67-890').apn, apnIn('PARCEL NO.: 1234567').apn, apnIn('APN: pending').apn, apnIn('APN: pending').labelled, apnIn('LOT 2').labelled], ['12-345-67-890', '1234567', null, true, false]);
});

test('the pre-sale checks: a total that does not match, a list for another county, no sale date, an amount that is not money', () => {
  const count = parsePreSaleText(presaleText(JEFFERSON_PRESALE(), { total: 4 }), { url: URL_J, county: 'Jefferson' });
  assert.deepEqual(Object.keys(count.missing), ['Total Foreclosures: (4 listed, 3 read)']);
  assert.deepEqual(Object.keys(parsePreSaleText(presaleText(JEFFERSON_PRESALE(), { total: null }), { url: URL_J, county: 'Jefferson' }).missing), ['Total Foreclosures:']);
  assert.deepEqual(Object.keys(parsePreSaleText(presaleText(DOUGLAS_MONDAY(), { county: 'Douglas' }), { url: URL_D, county: 'Jefferson' }).missing), ['a list titled for Jefferson County']);
  assert.deepEqual(Object.keys(parsePreSaleText(presaleText(JEFFERSON_PRESALE(), { saleLine: false }), { url: URL_J, county: 'Jefferson' }).missing), ['Sale Date:']);
  assert.deepEqual(Object.keys(parsePreSaleText(presaleText(JEFFERSON_PRESALE().map((r) => ({ ...r, omit: ['bid'] }))), { url: URL_J, county: 'Jefferson' }).missing), ['Lender\'s Bid Amount:']);
  const bad = JEFFERSON_PRESALE(); bad[0] = { ...bad[0], total: 'TBD', firstPublication: '04/31/2026' };
  const p = parsePreSaleText(presaleText(bad), { url: URL_J, county: 'Jefferson' });
  assert.deepEqual([p.documents[0].amounts.unpaidBalance, p.documents[0].foreclosure.publication.first, [...p.documents[0].unread].sort()], [{ value: null, basis: 'not-read' }, null, ['amounts.unpaidBalance', 'foreclosure.publication.first']]);
  assert.deepEqual(p.missing, {});
  // A record whose beneficiary is blank names no lender: left out, with its reason.
  const none = JEFFERSON_PRESALE(); none[1] = { ...none[1], beneficiary: [''] };
  assert.deepEqual(parsePreSaleText(presaleText(none), { url: URL_J, county: 'Jefferson' }).skipped, [{ reason: 'no current beneficiary named' }]);
});

test('the layout reader: a lead label and its columns, wrapped lines, a repeated label, and lines outside any record', () => {
  const lines = layoutLines('preamble\nA: one     B: two\n   wraps\nA: again\nC:\n stray line\f', []);
  const r = readLayout(lines, [{ label: 'A:', id: 'a', inline: [{ label: 'B:', id: 'b' }], multiline: false }, { label: 'C:', id: 'c' }]);
  assert.deepEqual(r.records.map((x) => x.fields), [{ a: 'one', b: 'two' }, { a: 'again', c: '' }]);
  assert.deepEqual([r.preamble, r.stray], [['preamble'], 2]);
});

test('THE GATE: Jefferson and Douglas ship with the principal\'s decision of 2026-11-18 and are enabled; without a recorded decision, or while config marks them not enabled, they refuse to run or backfill and fetch nothing', async () => {
  // As shipped: the decision is recorded on each adapter, and config.counties.sources enables both.
  for (const s of [jefferson, douglas]) {
    assert.deepEqual([s.terms.decision, s.terms.by, s.terms.decidedOn], ['allowed', 'a principal', '2026-11-18'], `${s.id} carries the decision`);
    assert.equal(runnable(s).ok, true, `${s.id} is runnable as shipped`);
    assert.equal(config().counties.sources[s.id].enabled, true, `${s.id} is enabled in config`);
  }
  const calls = [];
  const fetchImpl = async (u) => { calls.push(u); return new Response('', { status: 500 }); };
  // Without a recorded decision, nothing is read.
  const undecided = (s) => defineNoticeSource({ ...s, terms: { ...s.terms, decision: null, by: null, waitingOn: 'a principal\'s recorded decision.' } });
  for (const s of [jefferson, douglas].map(undecided)) {
    await assert.rejects(runNoticeSource({ dir: world(), source: s, counties: config().counties, fetchImpl }), /no recorded decision[\s\S]*Waiting on/);
    assert.match(runnable(s).reason, /Waiting on: a principal/);
  }
  await assert.rejects(runNoticeSource({ dir: world(), source: undecided(jefferson), counties: config().counties, fetchImpl, backfill: { since: '2025-01-01' } }), /no recorded decision/);
  // A recorded decision is not enough while config.counties.sources marks the source not enabled.
  const c = config().counties;
  const off = { ...c, sources: { ...c.sources, jefferson: { enabled: false, waitingOn: 'paused by a principal.' }, douglas: { enabled: false, waitingOn: 'paused by a principal.' } } };
  await assert.rejects(runNoticeSource({ dir: world(), source: J, counties: off, fetchImpl }), /not enabled in config\.counties\.sources[\s\S]*Waiting on/);
  await assert.rejects(runNoticeSource({ dir: world(), source: D, counties: off, fetchImpl }), /not enabled/);
  assert.deepEqual(calls, [], 'not one request');
  // Its verify check reads nothing either.
  const dir = world();
  put(dir, 'loans/state.json', { sources: { jefferson: { lastOk: { ranAt: T1.toISOString() } } } });
  const v = await verifyNoticeSource({ dir, source: undecided(jefferson), counties: config().counties, fetchImpl, now: T1 });
  assert.match(v.checks.find((x) => x.id === 'county.recall').summary, /no recorded decision/);
  assert.deepEqual(calls, []);
});

test('Jefferson, two weeks: robots.txt, the reports page, both indexes by link text, every PDF once; the next week only what is new', async () => {
  const dir = world();
  const s1 = jeffersonSite();
  const waits = [];
  let clock = 0;
  const r1 = await runNoticeSource({ dir, source: J, counties: counties(), fetchImpl: s1.fetchImpl, now: T1, clock: () => T1, pdfToText: layoutOf, sleep: async (ms) => { waits.push(ms); clock += ms; }, nowMs: () => clock });
  assert.equal(r1.outcome, 'ok', JSON.stringify(r1));
  assert.deepEqual(s1.calls.map((c) => c.path), ['/robots.txt', '/reports', '/report?t=7', '/report?t=6', '/Report_Files/NED 11-5-2026.pdf', '/Report_Files/NED 11-12-2026.pdf', '/Report_Files/Preliminary bid report-Tuesday.pdf']);
  assert.ok(s1.calls.every((c) => c.ua === config().counties.userAgent), 'every request names the firm');
  assert.ok(waits.length === 6 && waits.every((w) => w === 21000), `21 seconds apart, the adapter's own interval: ${waits}`);
  assert.deepEqual([r1.files, r1.read, r1.added, r1.rows, r1.skipped], [3, 9, 9, 9, 0]);
  const P = loansPaths(dir);
  const docs = readJson(P.docs('jefferson'));
  assert.deepEqual(Object.keys(docs).sort(), ['jefferson:J2690044/SALE', 'jefferson:J2690055/SALE', 'jefferson:J2690085/SALE', 'jefferson:J2698990/NED', 'jefferson:J2699001/NED', 'jefferson:J2699002/NED', 'jefferson:J2699003/NED', 'jefferson:J2699004/NED', 'jefferson:J2699005/NED']);
  const ned = docs['jefferson:J2699001/NED'];
  assert.deepEqual([ned.documentType, ned.county, ned.loan, ned.sources[0].url], ['election_and_demand', { fips: '08059', name: 'Jefferson' }, { type: 'Commercial', commercial: true }, 'https://gts.co.jefferson.co.us/Report_Files/NED%2011-12-2026.pdf']);
  // The scope rule: the FHA NED (J2699003) and the Conventional one (J2699005) are home mortgages, and so is the pre-sale entry whose
  // only grantor is a person (J2690055, no NED to give its loan type). They stay stored and reach no bank's file, review list or event.
  assert.deepEqual([r1.inScope, r1.outOfScope, r1.index.outOfScopeWhy], [6, 3, { 'residential-loan-type': 2, 'individual-borrowers': 1 }]);
  // Banks: Example Bank (holder on two NEDs and on the sale list); Sample Community Bank, through MERS, only as the original lender of a
  // loan a trust's trustee now holds. Example Mountain Bank's only loan is the FHA one: no file.
  const ex = readBankLoans({ dir, key: 'fdic:9001' });
  assert.deepEqual(ex.loans.map((l) => [l.id, l.dateKind, l.loanType, l.commercial, l.relation]), [
    ['jefferson:J2690044/SALE', 'listed', null, null, 'current'], ['jefferson:J2699001/NED', 'recorded', 'Commercial', true, 'current'], ['jefferson:J2698990/NED', 'recorded', 'Commercial', true, 'current']]);
  const sc = readBankLoans({ dir, key: 'fdic:9002' });
  assert.deepEqual(sc.loans.map((l) => [l.id, l.roles, l.relation, l.relationLabel]), [['jefferson:J2699002/NED', ['lender'], 'originated',
    'Originated by this bank; now held by Sample Trust Company, N.A., not in its individual capacity, but solely as trustee on behalf of Sample 2025-1 Trust']]);
  assert.equal(readBankLoans({ dir, key: 'fdic:9005' }), null);
  const review = readJson(P.review);
  // The review list keeps each name as the report gives it, never a borrower's or an owner's, and none from a document out of scope.
  assert.deepEqual(review.entries.map((e) => [e.name, e.status]), [['SAMPLE LENDING PARTNERS LLC', 'unmatched']]);
  assert.ok(review.entries.every((e) => e.roles.every((x) => ['holder', 'lender'].includes(x))));
  assert.deepEqual(review.setAside.map((x) => x.class).sort(), ['servicer', 'trustee']);
  assert.deepEqual(loanEvents({ dir }).map((e) => e.key).sort(), ['fdic:9001', 'fdic:9001', 'fdic:9001'], 'no event for the bank that only originated the loan');
  const ev = loanEvents({ dir, key: 'fdic:9001' });
  assert.equal(ev.find((e) => e.documentId === 'jefferson:J2690044/SALE').label, 'A notice of trustee\'s sale was listed on November 17, 2026 for a loan this bank holds on a property in Jefferson County, CO.');
  assert.equal(ev.find((e) => e.documentId === 'jefferson:J2699001/NED').label, 'A notice of election and demand was recorded on November 12, 2026 for a loan from this bank on a property in Jefferson County, CO.');
  // The files read, keyed on their ETag and the report's dates.
  const st = readLoanState(dir).sources.jefferson;
  assert.deepEqual(st.files.map((f) => f.key).sort(), ['etag:"a0000000000001:0"|2026-11-05..2026-11-05', 'etag:"a0000000000002:0"|2026-11-12..2026-11-12', 'etag:"b0000000000001:0"|2026-11-17..2026-11-19']);

  // The same week again: the indexes are read, no PDF is asked for, nothing is written; a quiet run, not a suspect one.
  const again = jeffersonSite();
  const r1b = await run(dir, J, again, new Date('2026-11-18T18:00:00Z'));
  assert.deepEqual(again.calls.map((c) => c.path), ['/robots.txt', '/reports', '/report?t=7', '/report?t=6']);
  assert.deepEqual([r1b.outcome, r1b.files, r1b.filesKnown, r1b.read, r1b.added], ['ok', 0, 3, 0, 0]);

  // Week 2: a new NED file, and the pre-sale list under the same name with a new posted date. The pre-sale file is asked for with its
  // ETag; it changed, so it is read: J2690044 is off the list (history), the other two are unchanged.
  const s2 = jeffersonSite({ week: 2 });
  const r2 = await run(dir, J, s2, T2);
  assert.equal(r2.outcome, 'ok', JSON.stringify(r2));
  assert.deepEqual(s2.calls.slice(4).map((c) => [c.path, c.ifNoneMatch]), [['/Report_Files/NED 11-19-2026.pdf', null], ['/Report_Files/Preliminary bid report-Tuesday.pdf', '"b0000000000001:0"']]);
  assert.deepEqual([r2.files, r2.filesKnown, r2.read, r2.added, r2.changed], [2, 2, 4, 2, 2]);
  const docs2 = readJson(P.docs('jefferson'));
  assert.equal(Object.keys(docs2).length, 11, 'the sale no longer listed stays, as history');
  assert.deepEqual([docs2['jefferson:J2690055/SALE'].dates.listed, docs2['jefferson:J2690055/SALE'].dates.sale], ['2026-11-24', '2026-11-26'], 'the continued sale is updated');

  // Week 2 again, but the pre-sale file did not change under its new posted date: the server answers 304 and nothing is read.
  const dir3 = world();
  await run(dir3, J, jeffersonSite(), T1);
  const s3 = jeffersonSite({ week: 2, presaleSame: true });
  const r3 = await run(dir3, J, s3, T2);
  assert.deepEqual([r3.outcome, r3.files, r3.filesNotModified, r3.filesKnown], ['ok', 1, 1, 2]);

  // Nothing about a borrower, an owner, an address or a legal description in the log, the state, the events, a bank's file or the review list.
  const logs = [readFileSync(join(dir, 'sources', 'runs.jsonl'), 'utf8'), readFileSync(P.state, 'utf8'), readFileSync(P.events, 'utf8'), readFileSync(P.review, 'utf8'),
    ...['fdic-9001', 'fdic-9002'].map((b) => readFileSync(join(P.banksDir, `${b}.json`), 'utf8'))].join('\n');
  for (const leak of [...BORROWERS, ...ADDRESSES, ...LEGAL_WORDS, ...APNS]) assert.ok(!logs.includes(leak), leak);
});

test('Jefferson: a page or file that fails stops the run and writes nothing; a format change says which label', async () => {
  const dir = world();
  const bad = await run(dir, J, jeffersonSite({ nedText: nedText(NED_WEEK1().map((r) => ({ ...r, omit: ['loanType'] }))) }));
  assert.deepEqual([bad.outcome, bad.missingFields], ['failed', ['LoanType:']]);
  assert.ok(!existsSync(loansPaths(dir).docs('jefferson')), 'nothing written');
  assert.equal(readLoanState(dir).sources.jefferson.files, undefined, 'no file is marked read, so the next run reads them again');
  const gone = jeffersonSite();
  const broken = { fetchImpl: async (u, i) => (String(u).endsWith('/reports') ? new Response(reportsHtml('Jefferson', [['/report?t=6', 'Pre Sale List']]), { status: 200 }) : gone.fetchImpl(u, i)) };
  const r = await run(world(), J, broken);
  assert.deepEqual([r.outcome, r.missingFields], ['failed', ['the reports page\'s link "Election and Demand Notices Filed"']]);
  assert.deepEqual(gone.calls.map((c) => c.path), ['/robots.txt'], 'a format change stops the run: neither index nor any PDF is fetched');
  // robots.txt disallowing the files stops the run before any is read.
  const blocked = jeffersonSite({ robots: 'User-agent: *\nDisallow: /Report_Files/\n' });
  const rb = await run(world(), J, blocked);
  assert.equal(rb.outcome, 'failed');
  assert.match(rb.errors[0], /robots\.txt on gts\.co\.jefferson\.co\.us disallows \/Report_Files\//);
  assert.ok(!blocked.calls.some((c) => c.path.startsWith('/Report_Files/')));
});

test('the backfill: the archive index found by its text, every monthly file from January 2025, the same gate; a second backfill asks for nothing', async () => {
  const dir = world();
  const site = jeffersonSite();
  const r = await run(dir, J, site, T1, { backfill: { since: '2025-01-01' } });
  assert.equal(r.outcome, 'ok', JSON.stringify(r));
  assert.deepEqual(site.calls.map((c) => c.path), ['/robots.txt', '/reports', '/report?t=14', '/Report_Files/January 2025 Election and Demand Notices.pdf', '/Report_Files/February 2025 Election and Demand Notices.pdf']);
  assert.deepEqual(Object.keys(readJson(loansPaths(dir).docs('jefferson'))).sort(), ['jefferson:J2500101/NED', 'jefferson:J2500201/NED']);
  assert.deepEqual(readJsonl(join(dir, 'sources', 'runs.jsonl')).at(-1).query, { source: 'jefferson', backfill: '2025-01-01' });
  const again = jeffersonSite();
  const r2 = await run(dir, J, again, T2, { backfill: {} });
  assert.deepEqual([r2.outcome, r2.files, r2.filesKnown], ['ok', 0, 2], 'the default since is January 2025, and both files are known');
  await assert.rejects(run(world(), D, douglasSite(), T1, { backfill: { since: '2025-01-01' } }), /no archive/);
  await assert.rejects(run(world(), J, jeffersonSite(), T1, { backfill: { since: 'last year' } }), /not a date/);
});

test('Douglas: Monday\'s list and Tuesday\'s update, read oldest first so the update\'s figures are kept; a minute between requests', async () => {
  const dir = world();
  const site = douglasSite();
  const waits = [];
  let clock = 0;
  const r = await runNoticeSource({ dir, source: D, counties: counties(), fetchImpl: site.fetchImpl, now: T1, clock: () => T1, pdfToText: layoutOf, sleep: async (ms) => { waits.push(ms); clock += ms; }, nowMs: () => clock });
  assert.equal(r.outcome, 'ok', JSON.stringify(r));
  assert.deepEqual(site.calls.map((c) => c.path), ['/robots.txt', '/gts/reports', '/gts/report?t=1', '/gts/Report_Files/11-18-26 PreSale.pdf', '/gts/Report_Files/UPDATED Sale Report 11-18-2026.pdf']);
  assert.ok(waits.every((w) => w === 60000), String(waits));
  assert.deepEqual([r.files, r.read, r.added, r.duplicates], [2, 5, 3, 2]);
  const docs = readJson(loansPaths(dir).docs('douglas'));
  const first = docs['douglas:249166/SALE'];
  assert.deepEqual([first.foreclosure.bid.value, first.foreclosure.deficiency.value, first.dates.listed, first.sources[0].url], [1500000, 800000, '2026-11-17', 'https://apps.douglasco.gov/gts/Report_Files/UPDATED%20Sale%20Report%2011-18-2026.pdf']);
  assert.equal(docs['douglas:269151/SALE'].dates.listed, '2026-11-16', 'withdrawn by Tuesday: Monday\'s entry stays');
  assert.equal(readBankLoans({ dir, key: 'fdic:9005' }).loans[0].id, 'douglas:249166/SALE');
  assert.deepEqual(first.county, { fips: '08035', name: 'Douglas' });
});

test('the verify check for a GTS county: fresh, sourced, recall against every listed file read afresh, and every lender name accounted for', async () => {
  const dir = world();
  await run(dir, J, jeffersonSite(), T1);
  const v = await verifyNoticeSource({ dir, source: J, counties: counties(), fetchImpl: jeffersonSite().fetchImpl, sleep: async () => {}, now: new Date('2026-11-19T12:00:00Z'), pdfToText: layoutOf });
  assert.deepEqual(v.checks.map((c) => [c.id, c.ok]), [['county.fresh', true], ['county.sourced', true], ['county.recall', true], ['county.matched', true]], JSON.stringify(v.checks));
  assert.ok(v.sample.every((x) => x.check.startsWith('https://gts.co.jefferson.co.us/Report_Files/')));
  // A week on, the list holds documents not stored: recall fails until the run.
  const later = await verifyNoticeSource({ dir, source: J, counties: counties(), fetchImpl: jeffersonSite({ week: 2 }).fetchImpl, sleep: async () => {}, now: new Date('2026-11-25T12:00:00Z'), pdfToText: layoutOf });
  assert.equal(later.checks.find((c) => c.id === 'county.recall').ok, false);
});

test('end to end through poppler: the run reads the real PDFs with pdftotext and stores the same documents', { skip: !POPPLER && 'poppler-utils (pdftotext) is not installed' }, async () => {
  const a = world(), b = world();
  const ra = await run(a, J, jeffersonSite(), T1, { pdfToText: undefined });
  const rb = await run(b, J, jeffersonSite(), T1);
  assert.equal(ra.outcome, 'ok', JSON.stringify(ra));
  const strip = (dir) => Object.fromEntries(Object.entries(readJson(loansPaths(dir).docs('jefferson'))).map(([k, v]) => [k, v.contentHash]));
  assert.deepEqual(strip(a), strip(b));
  const d = world();
  assert.equal((await run(d, D, douglasSite(), T1, { pdfToText: undefined })).read, 5);
});
