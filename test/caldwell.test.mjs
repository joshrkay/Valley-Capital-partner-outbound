// The Caldwell County, Texas reader (src/sources/counties/caldwell.mjs): the principal's decision as the gate, the list, the two notice
// layouts, the OCR checks that leave a misread value unread instead of guessing it, the run against the fake county (robots.txt first,
// the firm's User-Agent, 21 seconds apart, only new notices fetched, a block that stops everything) and the verify check. The weekly
// worker job and the workflow are in test/loans-watch.test.mjs. Invented data only (test/caldwell-fake.mjs); no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { makeDir, put, config } from './kit.mjs';
import { readJson } from '../src/store.mjs';
import { runNoticeSource, verifyNoticeSource, runnable, clearBlock, looksLikeChallenge } from '../src/sources/notices.mjs';
import { caldwellCounty, caldwellSource, registryEntry, termsFrom, intervalFrom, parseCaldwellList, noticeNumber, readCaldwellNotice, detectLayout, labelledBlocks,
  numericDateReadings, readDateAt, monthOf, texasSaleDay, readDollars, lenderName, splitNames, borrowerName, isEntityName, readAddress, readRecording, CALDWELL_ID, CALDWELL_LIST } from '../src/sources/counties/caldwell.mjs';
import { pdfToText, hasPdfToText } from '../src/sources/pdftext.mjs';
import { COUNTY_SOURCES, countyCoverage } from '../src/counties.mjs';
import { loansPaths, loanEvents, readBankLoans, readLoanState } from '../src/loans.mjs';
import { matchLender } from '../src/lenders.mjs';
import { fakeCaldwell, listHtml, textPdf, WEEK1, WEEK2, SERVICER_NOTICE, ATTORNEY_NOTICE, RUINED_NOTICE, CHALLENGE, INSTITUTIONS, PEOPLE, BORROWER_FIRMS, ADDRESSES } from './caldwell-fake.mjs';

const PDF = await hasPdfToText();
const needsPdf = PDF ? {} : { skip: 'pdftotext (poppler-utils) is not installed here' };
const counties = () => config().counties;
const T1 = new Date('2026-11-18T14:00:00Z'), T2 = new Date('2026-11-25T14:00:00Z'), T3 = new Date('2026-12-02T14:00:00Z');
const world = () => { const dir = makeDir(); put(dir, 'sources/fdic/institutions.json', INSTITUTIONS); return dir; };
const run = (dir, f, now = T1, over = {}) => runNoticeSource({ dir, source: caldwellCounty, counties: counties(), fetchImpl: f.fetchImpl, sleep: async () => {}, now, clock: () => now, ...over });
const read = (text, over = {}) => readCaldwellNotice(text, { fetchedAt: T1.toISOString(), ...over });
// What pdftotext gives for an invented notice, as the live reader sees it.
const viaPdf = async (text) => (await pdfToText(textPdf(text))).text;

test('the gate is the principal\'s decision in sources.json: allowed, dated, who decided, the conditions, and the next recheck', () => {
  const e = registryEntry();
  assert.equal(e.id, CALDWELL_ID);
  assert.deepEqual([e.enabled, e.verdict, e.principalDecision.decision, e.principalDecision.decidedOn, e.principalDecision.by], [true, 'allowed', 'allowed', '2026-11-18', 'a principal']);
  assert.equal(e.principalDecision.conditions.length, 3);
  assert.match(e.principalDecision.conditions.join(' '), /lender-level/i);
  assert.match(e.principalDecision.conditions.join(' '), /no individual named in a notice, is ever contacted/i);
  assert.match(e.principalDecision.conditions.join(' '), /disclaimer monthly/i);
  assert.equal(e.principalDecision.nextRecheckOn, '2026-12-18');
  assert.equal(caldwellCounty.terms.decision, 'allowed');
  assert.equal(caldwellCounty.minIntervalMs, 21000, 'sources.json pacing: 21 seconds');
  assert.equal(intervalFrom({ pacing: { minIntervalSeconds: 5 } }), 21000, 'never less than 21 seconds');
  assert.equal(runnable(caldwellCounty, { now: T1 }).ok, true);
  // After the recheck date, nothing runs until a principal rechecks and records the next date.
  assert.match(runnable(caldwellCounty, { now: new Date('2026-12-19T09:00:00Z') }).reason, /rechecked by 2026-12-18/);
  // An entry not enabled, or with no decision, refuses.
  assert.match(runnable(caldwellSource({ ...e, enabled: false }), { now: T1 }).reason, /no recorded decision/);
  assert.match(runnable(caldwellSource({ ...e, principalDecision: null }), { now: T1 }).reason, /no recorded decision/);
  assert.equal(termsFrom({ ...e, verdict: 'unclear' }).decision.startsWith('allowed'), true, 'the decision itself is kept for the message');
  assert.notEqual(termsFrom({ ...e, verdict: 'unclear' }).decision, 'allowed');
  // A terms read more than a year old refuses too.
  assert.match(runnable(caldwellSource({ ...e, principalDecision: { ...e.principalDecision, termsCheckedOn: '2025-11-01', nextRecheckOn: null } }), { now: T1 }).reason, /more than a year ago/);
  assert.ok(COUNTY_SOURCES[CALDWELL_ID], 'registered');
  assert.deepEqual(config().counties.watch, [CALDWELL_ID], 'watched');
});

test('the list: one item per notice PDF, keyed on a hash of its link, the listed sale date, a link to the month; images skipped', () => {
  const p = parseCaldwellList(listHtml(WEEK1()));
  assert.deepEqual([p.rows, p.items.length, p.skipped.map((s) => s.reason), p.missing], [6, 5, ['an image, not a PDF with a text layer'], {}]);
  const first = p.items.find((i) => i.listedDate === '2026-12-01');
  assert.match(first.documentNumber, /^[0-9A-F]{16}$/);
  assert.equal(first.documentNumber, noticeNumber('/files/public-documents/foreclosures/2026/12-1-26%20Pat%20Example.pdf'), 'the same link, encoded or not, is the same number');
  assert.equal(first.listLink, `${CALDWELL_LIST}#fc-m-2026-12`);
  assert.equal(first.url, 'https://caldwellcounty.texas.gov/files/public-documents/foreclosures/2026/12-1-26%20Pat%20Example.pdf');
  assert.equal(p.items.find((i) => !i.listedDate).listLink, `${CALDWELL_LIST}#fc-m-undated`);
  for (const i of p.items) for (const n of [...PEOPLE, ...BORROWER_FIRMS, 'Example', 'Sample']) assert.ok(!i.documentNumber.includes(n) && !i.listLink.includes(n));
  // A page with no notices, or with no sale dates at all, is a format change.
  assert.deepEqual(parseCaldwellList('<html><ul></ul></html>').missing, { 'li.doc-item': 1 });
  assert.deepEqual(parseCaldwellList(listHtml(WEEK1(), { withTimes: false })).missing, { 'time[datetime]': 1 });
});

test('reading values through OCR errors: each date, amount and name is read once and only once, or not at all', () => {
  // Slashes read as 1s or ls: tried every way; read only when one reading is a real date the field allows.
  assert.deepEqual(numericDateReadings('121112026', texasSaleDay), ['2026-12-01']);
  assert.deepEqual(numericDateReadings('3/14l2023'), ['2023-03-14']);
  assert.deepEqual(numericDateReadings('3/2O/2023'), ['2023-03-20'], 'an O is a zero');
  assert.equal(numericDateReadings('lll2l2023').length, 2, '1/12/2023 or 11/2/2023: two readings');
  assert.equal(readDateAt('lll2l2023').date, null, 'so it is not read');
  assert.equal(readDateAt('9/?1l?026').date, null);
  assert.equal(readDateAt('Jaruary 9,2023').date, '2023-01-09');
  assert.equal(readDateAt('Sept. 17, 2026').date, '2026-09-17');
  assert.equal(readDateAt('17th day of September, 2026').date, '2026-09-17');
  assert.equal(readDateAt('Febuary 30, 2026').date, null, 'not a real date');
  assert.deepEqual([monthOf('Novernber'), monthOf('Octobcr'), monthOf('Jume'), monthOf('Jule'), monthOf('Ju')], [11, 10, 6, null, null], 'Jule is as near June as July');
  // A Texas sale day: the first Tuesday, or the first Wednesday when that Tuesday is January 1 or July 4.
  assert.deepEqual(['2026-12-01', '2026-12-08', '2026-12-02', '2030-01-01', '2030-01-02', '2028-07-05', '2026-11-03'].map(texasSaleDay), [true, false, false, false, true, true, true]);
  // Dollars: commas, or periods for them when nothing else is possible; never a space inside.
  assert.deepEqual(['$123,456.00', '$250.000.00', '$1,500,000', '$1 50,000.00', '$12.50', '$4.200.000,00', 'about $3M'].map(readDollars), [123456, 250000, 1500000, null, null, 4200000, null]);
  // MERS is read through to the lender; with no lender named it stays MERS, which is never a lender.
  assert.equal(lenderName('Mortgage Electronic Registration Systems, Inc., as beneficiary, as nominee for Example Bank, N.A., its successors and assigns').through, 'Example Bank, N.A.');
  assert.equal(lenderName('Modgage Electronic Registration Systems, Inc. ("MERS")').through, null);
  assert.equal(matchLender({ role: 'beneficiary', name: lenderName('MERS, as nominee for Example Bank, N.A.').name }, { institutions: INSTITUTIONS }).key, 'fdic:9001');
  assert.equal(lenderName('Sample Community Bank, A Texas State Bank').name, 'Sample Community Bank');
  assert.equal(lenderName('}{ffi[ $${]] ffiil|'), null, 'OCR debris is not a name');
  assert.deepEqual(splitNames('Riley Placeholder, Exampleauctions,com, LLC, Sample Sales and Posting LLC, Example Posting Inc., or any one of them'), ['Riley Placeholder', 'Exampleauctions.com, LLC', 'Sample Sales and Posting LLC', 'Example Posting Inc.']);
  assert.equal(borrowerName('Pat Example and Jordan Example, husband and wife, as Grantor/Borrower'), 'Pat Example and Jordan Example');
  assert.equal(borrowerName('Pa:t Example'), null, 'a colon inside a name is OCR debris');
  assert.deepEqual([isEntityName('Sample Retail Partners LLC'), isEntityName('Sample Land Trust'), isEntityName('Pat Example and Jordan Example')], [true, true, false]);
  assert.equal(readAddress('123 EXAMPLE LANE ANYTOWN, TX 78644 WHEREAS'), '123 EXAMPLE LANE ANYTOWN, TX 78644');
  assert.equal(readAddress('tl23 EXAMPLE DR ANYTOWN, TX 78644'), null, 'a misread house number is not read');
  assert.deepEqual(readRecording('as Volume 2023-004321, Book, Page'), { documentNumber: '2023-004321', book: null, page: null });
  assert.deepEqual(readRecording('Volume 123, Page 456'), { documentNumber: null, book: '123', page: '456' });
});

test('the servicer\'s form: the recital read into the record\'s shape, each party in its own role', needsPdf, async () => {
  const text = await viaPdf(SERVICER_NOTICE);
  assert.equal(detectLayout(text), 'servicer');
  const r = read(text);
  assert.equal(r.reason, null);
  const d = r.document;
  assert.deepEqual(d.dates, { recorded: null, filed: null, sale: '2026-12-01', notice: '2026-10-21' });
  assert.deepEqual(d.parties.map((p) => [p.role, p.name]), [
    ['lender', 'Mortgage Electronic Registration Systems, Inc., as nominee for Example Bank, N.A.'],
    ['beneficiary', 'Mortgage Electronic Registration Systems, Inc., as nominee for Example Bank, N.A.'],
    ['holder', 'Example Bank, N.A.'], ['servicer', 'Sample Loan Servicing, LLC'],
    ['trustee', 'Riley Placeholder'], ['trustee', 'Sample Posting and Publishing, LLC'], ['trustee', 'Example Auctions, Inc.'],
    ['grantor', 'Pat Example and Jordan Example'],
  ]);
  assert.deepEqual(d.amounts.originalPrincipal, { value: 412500, basis: 'document' });
  assert.deepEqual(d.amounts.unpaidBalance, { value: null, basis: 'not-stated' }, 'a Texas notice states no balance');
  assert.equal(d.property.address, '123 EXAMPLE LANE ANYTOWN, TX 78644');
  assert.deepEqual(d.deedOfTrust, { documentNumber: '2023-004321', book: null, page: null, dated: '2023-03-14', recorded: '2023-03-20' });
  assert.match(d.salePlace, /^OUTSIDE THE MAIN ENTRANCE OF THE EXAMPLE COUNTY JUSTICE CENTER/);
  assert.deepEqual(d.unread, []);
  assert.equal(r.fields.borrowerKind, 'individual');
  // The clerk's stamp (a deputy clerk's name) and the signer are no party.
  assert.ok(!JSON.stringify(d).includes('Casey Sampleclerk') && !JSON.stringify(d).includes('Morgan Sample'));
});

test('the attorney\'s form: the labelled blocks, a garbled label, a split label, and the stamp column kept out of every value', needsPdf, async () => {
  const text = await viaPdf(ATTORNEY_NOTICE);
  assert.equal(detectLayout(text), 'attorney');
  assert.ok(labelledBlocks(text).some((b) => b.label === 'lender' && b.indent === 0 && !b.section), 'I,F],NDER: is LENDER:, at the top, out of the deed of trust\'s block');
  assert.ok(labelledBlocks(text).some((b) => b.label === 'date' && b.section === 'deedOfTrust'), 'the deed of trust\'s own Date:');
  assert.ok(labelledBlocks(text).some((b) => b.label === 'principal' && b.text === '$1.250.000.00'), 'Original / Principal / Amount: is one label');
  const d = read(text).document;
  assert.deepEqual(d.dates, { recorded: null, filed: null, sale: '2026-11-03', notice: '2026-10-09' });
  assert.deepEqual(d.parties.map((p) => [p.role, p.name]), [['lender', 'Sample Community Bank'], ['beneficiary', 'Sample Community Bank'], ['holder', 'Sample Community Bank'],
    ['trustee', 'Riley Placeholder of Sample & Example, PLLC'], ['borrower', 'Sample Retail Partners LLC'], ['grantor', 'Sample Retail Partners LLC']]);
  assert.deepEqual(d.amounts.originalPrincipal, { value: 1250000, basis: 'document' }, '$1.250.000.00 read as dollars');
  assert.equal(d.property.address, null, 'a tract with no street address: not stated, and not listed as unread');
  assert.deepEqual(d.deedOfTrust, { documentNumber: '2021-001234', book: null, page: null, dated: '2021-02-03', recorded: null });
  assert.match(d.salePlace, /^THE MAIN ENTRANCE OF THE EXAMPLE COUNTY JUDICIAL CENTER, 100 SAMPLE STREET, ANYTOWN, TEXAS 78644$/);
  assert.deepEqual(d.unread, []);
  assert.ok(!JSON.stringify(d).includes('Casey Sampleclerk'), 'the deputy clerk in the stamp column is no part of any value');
});

test('a value that fails its check is not read, never guessed: unread, with the basis "not-read"', needsPdf, async () => {
  // The amount with a space inside, the notice date unreadable, the address's house number misread: each not read.
  const bad = SERVICER_NOTICE.replace('$412,500.00', '$4 12,500.00').replace('this 10/2l/2026', 'this 1O/?l/2026').replace('123 EXAMPLE LANE', 'l23 EXAMPLE LANE');
  const d = read(await viaPdf(bad)).document;
  assert.deepEqual(d.amounts.originalPrincipal, { value: null, basis: 'not-read' });
  assert.deepEqual([d.dates.sale, d.dates.notice, d.property.address], ['2026-12-01', null, null]);
  assert.deepEqual(d.unread, ['dates.notice', 'property.address'], 'the amount is listed by its basis when the record is built');
  // A sale date that is not a first Tuesday is not read; with the notice date also unread, the notice cannot be a record: it is held.
  const noDates = bad.replace('on 121112026 at', 'on 12/8/2026 at');
  assert.equal(read(await viaPdf(noDates)).reason, 'neither the sale date nor the notice date could be read');
  assert.equal(read(await viaPdf(noDates)).fields.saleDate, 'not-read');
  // The sale must come 21 days or more after the notice. When it does not, the sale date stands only if the list gives the same one.
  const close = SERVICER_NOTICE.replace('this 10/2l/2026', 'this 11/15/2026');
  assert.equal(read(await viaPdf(close)).document, null, 'sixteen days apart, and no list date: neither read, so no record');
  assert.equal(read(await viaPdf(SERVICER_NOTICE.replace('this 10/2l/2026', 'this 11/2l/2026'))).document.dates.notice, null, 'a notice dated after the fetch is not read');
  assert.deepEqual(read(await viaPdf(close), { listedDate: '2026-12-01' }).document.dates, { recorded: null, filed: null, sale: '2026-12-01', notice: null });
  // The OCR ruined the lender: held.
  assert.equal(read(await viaPdf(RUINED_NOTICE)).reason, 'no lender, beneficiary or mortgagee could be read');
  assert.equal(read('A page of something else entirely.').reason, 'neither known layout');
});

test('the run: robots.txt first, the firm\'s User-Agent, 21 seconds apart, the backfill window, only new notices fetched', needsPdf, async () => {
  const dir = world();
  const f = fakeCaldwell();
  const waits = []; let clock = 0;
  const r = await run(dir, f, T1, { sleep: async (ms) => { waits.push(ms); clock += ms; }, nowMs: () => clock });
  assert.equal(r.outcome, 'ok', JSON.stringify(r));
  // Listed: 5 PDFs and an image. The first run reads only what the list dates within 60 days: the December servicer notice and the two
  // November ones; the July one and the undated one are history. The ruined notice is held.
  assert.deepEqual([r.listed, r.skipped, r.history, r.fetched, r.read, r.held, r.added, r.deferred], [5, 1, 2, 3, 2, 1, 2, 0]);
  assert.deepEqual(r.layouts, { servicer: 1, attorney: 1 });
  assert.deepEqual(f.calls.map((c) => c.path), ['/robots.txt', '/foreclosures', 'notice', 'notice', 'notice']);
  assert.ok(f.calls.every((c) => c.ua === config().counties.userAgent), 'every request names the firm');
  assert.ok(waits.length === 4 && waits.every((w) => w === 21000), `every request after the first waits 21 seconds: ${waits}`);
  // Week two: one new notice. Only it is fetched; the held one is not fetched again.
  const f2 = fakeCaldwell({ items: WEEK2() });
  const r2 = await run(dir, f2, T2);
  assert.deepEqual([r2.outcome, r2.listed, r2.known, r2.history, r2.heldBefore, r2.fetched, r2.added], ['ok', 6, 2, 2, 1, 1, 1]);
  assert.deepEqual(f2.calls.filter((c) => c.path === 'notice').map((c) => c.file), ['/files/public-documents/foreclosures/2027/1-5-27 Jordan Example.pdf']);
  // Week three, the list unchanged and served with an ETag: a conditional GET once the ETag is kept, and no notice fetched.
  const f3 = fakeCaldwell({ items: WEEK2(), etag: '"list-1"' });
  await run(dir, f3, T3);
  const f4 = fakeCaldwell({ items: WEEK2(), etag: '"list-1"' });
  const r4 = await run(dir, f4, new Date('2026-12-09T14:00:00Z'));
  assert.deepEqual([r4.outcome, r4.notModified, r4.fetched, r4.added], ['ok', 1, 0, 0]);
  assert.equal(f4.calls.find((c) => c.path === '/foreclosures').ifNoneMatch, '"list-1"');
  // A raised parserVersion fetches the held notice once more.
  const better = caldwellSource(); const v2 = { ...better, parserVersion: better.parserVersion + 1 };
  const f5 = fakeCaldwell({ items: WEEK2() });
  const r5 = await run(dir, f5, new Date('2026-12-16T14:00:00Z'), { source: Object.freeze(v2) });
  assert.deepEqual([r5.fetched, r5.held], [1, 1]);
});

test('the record, the bank\'s file and the events: matched through MERS, the notice\'s own dates, and no name, address or file link', needsPdf, async () => {
  const dir = world();
  await run(dir, fakeCaldwell());
  await run(dir, fakeCaldwell({ items: WEEK2() }), T2);
  const P = loansPaths(dir);
  const docs = Object.values(readJson(P.docs(CALDWELL_ID)));
  assert.equal(docs.length, 3);
  for (const d of docs) {
    assert.equal(d.documentType, 'notice_of_trustee_sale');
    assert.match(d.sources[0].url, /^https:\/\/caldwellcounty\.texas\.gov\/files\/public-documents\/foreclosures\//);
    assert.match(d.sources[0].listUrl, /^https:\/\/caldwellcounty\.texas\.gov\/foreclosures#fc-m-\d{4}-\d{2}$/);
    assert.match(d.sources[0].etag, /^"f-/);
  }
  const bank = readBankLoans({ dir, key: 'fdic:9001' });
  assert.equal(bank.loans.length, 1);
  assert.deepEqual([bank.loans[0].how, bank.loans[0].dateKind, bank.loans[0].date, bank.loans[0].saleDate, bank.loans[0].amounts.originalPrincipal.value], ['name, named through MERS as nominee', 'notice', '2026-10-21', '2026-12-01', 412500]);
  assert.equal(bank.loans[0].link, `${CALDWELL_LIST}#fc-m-2026-12`, 'the list\'s month, not the file named for the debtor');
  assert.equal(readBankLoans({ dir, key: 'fdic:9002' }).loans.length, 2);
  const ev = loanEvents({ dir, key: 'fdic:9001' })[0];
  assert.equal(ev.label, 'A notice of trustee\'s sale dated October 21, 2026 was posted for a loan from this bank on a property in Caldwell County, TX.');
  // Nothing about a person, a borrower, an address or a file name anywhere but the documents themselves.
  const outside = [P.state, P.events, P.review, P.list(CALDWELL_ID), join(dir, 'sources', 'runs.jsonl'), ...['fdic-9001', 'fdic-9002'].map((k) => join(P.banksDir, `${k}.json`))]
    .filter(existsSync).map((p) => readFileSync(p, 'utf8')).join('\n');
  for (const leak of [...PEOPLE, ...BORROWER_FIRMS, ...ADDRESSES, '/files/', '12-1-26', 'Sample Loan Servicing', '555-0142']) assert.ok(!outside.includes(leak), leak);
  assert.ok(!readFileSync(P.docs(CALDWELL_ID), 'utf8').includes('Casey Sampleclerk'), 'the deputy clerk is not stored even in the documents');
});

test('nothing is bypassed: a refusal or a challenge page stops the run, writes nothing, and keeps the source stopped until a principal clears it', needsPdf, async () => {
  const dir = world();
  const r = await run(dir, fakeCaldwell({ status: { notices: 403 } }));
  assert.deepEqual([r.outcome, r.blocked], ['failed', true]);
  assert.match(r.errors[0], /Blocked: HTTP 403 on a listed document/);
  assert.ok(!existsSync(loansPaths(dir).docs(CALDWELL_ID)) && !existsSync(loansPaths(dir).list(CALDWELL_ID)), 'nothing written');
  const f = fakeCaldwell();
  await assert.rejects(run(dir, f), /was blocked on 2026-11-18 .*outbound loans unblock/);
  assert.equal(f.calls.length, 0, 'not even robots.txt is requested while blocked');
  assert.throws(() => clearBlock({ dir, sourceId: CALDWELL_ID, by: '' }), /--by NAME/);
  assert.equal(clearBlock({ dir, sourceId: CALDWELL_ID, by: 'Pat Principal', now: T1 }).cleared, true);
  assert.equal(readLoanState(dir).sources[CALDWELL_ID].lastBlock.clearedBy, 'Pat Principal');
  assert.equal((await run(dir, fakeCaldwell())).outcome, 'ok');
  // A challenge page instead of the list, or instead of a notice; a 429 on the list; robots.txt refusing.
  assert.match((await run(world(), fakeCaldwell({ html: CHALLENGE }))).errors[0], /Blocked: a challenge page on \/foreclosures/);
  assert.match((await run(world(), fakeCaldwell({ noticeBody: CHALLENGE }))).errors[0], /Blocked: a challenge page instead of a listed document/);
  assert.match((await run(world(), fakeCaldwell({ status: { '/foreclosures': 429 } }), T1, { sleep: async () => {} })).errors[0], /Blocked: HTTP 429/);
  assert.match((await run(world(), fakeCaldwell({ status: { '/robots.txt': 403 } }))).errors[0], /Blocked: HTTP 403 on caldwellcounty\.texas\.gov\/robots\.txt/);
  // robots.txt disallowing the notice files stops the run without naming the file.
  const d = await run(world(), fakeCaldwell({ robots: 'User-agent: *\nDisallow: /files/\n' }));
  assert.equal(d.outcome, 'failed');
  assert.match(d.errors[0], /disallows a listed document/);
  assert.ok(!d.errors[0].includes('Example'));
  assert.equal(looksLikeChallenge(listHtml()), false, 'the real list\'s markup is not a challenge');
});

test('the verify check: fresh, sourced, recall (stored, held or history) against the list, every lender name accounted for', needsPdf, async () => {
  const dir = world();
  await run(dir, fakeCaldwell());
  const v = await verifyNoticeSource({ dir, source: caldwellCounty, counties: counties(), fetchImpl: fakeCaldwell().fetchImpl, sleep: async () => {}, now: new Date('2026-11-19T12:00:00Z') });
  assert.deepEqual(v.checks.map((c) => [c.id, c.ok]), [['county.fresh', true], ['county.sourced', true], ['county.recall', true], ['county.matched', true]], JSON.stringify(v.checks));
  assert.match(v.checks.find((c) => c.id === 'county.recall').summary, /All 5 listed document\(s\) are accounted for: 2 stored, 1 held as unreadable, 2 history/);
  assert.ok(v.sample.every((s) => s.check.startsWith(`${CALDWELL_LIST}#`)), 'the sample links to the list, never a file named for a debtor');
  const later = await verifyNoticeSource({ dir, source: caldwellCounty, counties: counties(), fetchImpl: fakeCaldwell({ items: WEEK2() }).fetchImpl, sleep: async () => {}, now: new Date('2026-11-19T12:00:00Z') });
  assert.match(later.checks.find((c) => c.id === 'county.recall').summary, /1 of 6 listed document\(s\) are not stored yet/);
  // Coverage for the Status page.
  const row = countyCoverage({ config: counties(), state: readLoanState(dir), now: new Date('2026-11-19T12:00:00Z') }).find((x) => x.id === CALDWELL_ID);
  assert.deepEqual([row.countyLabel, row.configured, row.read, row.newThisWeek, row.stored], ['Caldwell County, TX', true, 2, 2, 2]);
});
