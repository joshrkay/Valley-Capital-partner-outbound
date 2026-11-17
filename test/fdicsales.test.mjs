// The FDIC loan-sale adapter (PRD E16-S2) against a fake www.fdic.gov. Invented sales, banks, advisors and people only; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeDir, put, PLACEHOLDER_UA } from './kit.mjs';
import { loadRules } from '../src/rules.mjs';
import { readJson, readJsonl } from '../src/store.mjs';
import {
  runFdicSales, verifyFdicSales, fdicSalesPaths, fdicUserAgent, parseRobots, robotsFor, robotsAllows, parseListing, parseSalePage,
  parseReceiverships, eventRange, pdfText, parseAnnouncementPdf, matchReceivership,
} from '../src/sources/fdicsales.mjs';
import { fakeFdicWww, ROBOTS, LISTING, EMPTY_LISTING, SALE_PAGE, makePdf, PDF_LINES, PERSON, PHONE, EMAIL, ADVISOR } from './fdicsales-fake.mjs';

const rules = loadRules();
const NOW = new Date('2026-11-14T12:00:00Z');
const UA = 'Example Firm ops@example.test';
const FDIC = { ...rules.config.fdic, userAgent: UA };
const PLACEHOLDER = { ...rules.config.fdic, userAgent: PLACEHOLDER_UA.fdic };
const FAILED = { 9001: { cert: '9001', name: 'Example Prairie Bank', city: 'Sampleton', state: 'AZ', failedOn: '2026-09-25', inMetros: true, metros: [{ cbsa: '38060', basis: ['main office'] }] } };

// A clock that moves only when the adapter sleeps, so the waits it asks for can be checked exactly.
function clock() { let t = 1_000_000; const waits = []; return { waits, nowMs: () => t, sleep: async (ms) => { waits.push(ms); t += ms; } }; }
const run = (dir, site, over = {}) => { const c = clock(); return runFdicSales({ dir, fdic: FDIC, personalDomains: rules.config.personalDomains, fetchImpl: site.fetchImpl, now: NOW, sleep: c.sleep, nowMs: c.nowMs, ...over }).then((r) => ({ ...r, waits: c.waits })); };

test('the User-Agent: a placeholder is refused, and so is a personal email address', async () => {
  assert.throws(() => fdicUserAgent(PLACEHOLDER, rules.config.personalDomains), /fdic\.userAgent is a placeholder/);
  assert.throws(() => fdicUserAgent({ ...FDIC, userAgent: '' }, rules.config.personalDomains), /fdic\.userAgent is a placeholder/, 'an empty contact is no contact');
  assert.throws(() => fdicUserAgent({ userAgent: 'Example Firm someone@gmail.com' }, rules.config.personalDomains), /personal domain/);
  assert.equal(fdicUserAgent({ userAgent: UA }, rules.config.personalDomains), UA);
  const site = fakeFdicWww();
  await assert.rejects(runFdicSales({ dir: makeDir(), fdic: PLACEHOLDER, personalDomains: rules.config.personalDomains, fetchImpl: site.fetchImpl, now: NOW, sleep: async () => {} }), /placeholder/);
  assert.equal(site.calls.length, 0, 'nothing was requested');
});

test('robots.txt: the "*" group applies, the longest rule wins, wildcards and anchors work, and Crawl-delay is read', () => {
  const r = robotsFor(parseRobots(ROBOTS), UA);
  assert.equal(r.crawlDelay, 30);
  assert.equal(robotsAllows(r, '/asset-sales/loan-sales'), true);
  assert.equal(robotsAllows(r, '/search/anything'), false);
  assert.equal(robotsAllows(r, '/asset-sales/private-sale'), false);
  assert.equal(robotsAllows(robotsFor(parseRobots(ROBOTS), 'SomeOtherBot/1.0'), '/asset-sales/loan-sales'), false, 'a named group replaces "*"');
  const g = robotsFor(parseRobots('User-agent: *\nDisallow: /core/\nAllow: /core/*.css$\nDisallow: /x$'), UA);
  assert.equal(robotsAllows(g, '/core/a.css'), true); assert.equal(robotsAllows(g, '/core/a.css?v=1'), false); assert.equal(robotsAllows(g, '/x'), false); assert.equal(robotsAllows(g, '/xy'), true);
});

test('the parsers: the sale list (inside main only), dates, key dates, receiverships, size, advisor, and no contact at all', () => {
  const l = parseListing(LISTING());
  assert.equal(l.heading, true);
  assert.deepEqual(l.events.map((e) => e.slug), ['exb-26-sale-announcement', 'exb2-26-sale-announcement'], 'the banner link in the header is ignored');
  assert.equal(parseListing(EMPTY_LISTING).empty, true);
  const p = parseSalePage(SALE_PAGE(), { url: 'https://www.fdic.gov/asset-sales/events/exb2-26-sale-announcement' });
  assert.equal(p.saleId, 'EXB2-26'); assert.equal(p.title, 'EXB2-26 Sale Announcement'); assert.equal(p.headline, '$41.5 Million Sealed-Bid Loan Sale');
  assert.deepEqual(p.eventDates, { start: '2026-10-26', end: '2026-12-02', text: 'October 26–December 2, 2026, All Day' });
  assert.deepEqual(p.keyDates, { dueDiligence: { start: '2026-10-26', end: '2026-12-02' }, calculationDate: '2026-10-30', bidDeadline: '2026-12-02', closing: '2026-12-18', other: [] });
  assert.deepEqual(p.receiverships, [{ name: 'Example Prairie Bank', city: 'Sampleton', state: 'AZ', abbr: 'EPB' }]);
  assert.deepEqual([p.loans, p.upb, p.dataAsOf, p.pageUpdatedOn, p.advisor], [312, 41512300, '2026-09-25', '2026-10-15', ADVISOR]);
  assert.equal(p.pdf, 'https://www.fdic.gov/asset-sales/exb2-26-loan-sale-announcement.pdf');
  assert.ok(p.portfolio.some((s) => /consists primarily of commercial real estate/.test(s)));
  assert.ok(p.portfolio.some((s) => /^Approximately 61\.20% of UPB/.test(s)), 'a heading is not glued to its paragraph');
  const flat = JSON.stringify(p);
  for (const leak of [PERSON, PHONE, EMAIL, '555', 'sales@example.test', 'mailto', 'tel:']) assert.ok(!flat.includes(leak), `parsed page leaked "${leak}"`);
});

test('receiverships: several in one sentence, a bank name with commas, and a clause with no place', () => {
  assert.deepEqual(parseReceiverships('Example First Bank, Anytown, Texas (EFB), and Example Second Bank, N.A., Othertown, Nevada (ESB)'),
    [{ name: 'Example First Bank', city: 'Anytown', state: 'TX', abbr: 'EFB' }, { name: 'Example Second Bank, N.A.', city: 'Othertown', state: 'NV', abbr: 'ESB' }]);
  assert.deepEqual(parseReceiverships('various failed institutions'), [{ name: 'various failed institutions', city: null, state: null, abbr: null }]);
  assert.deepEqual(eventRange('December 15, 2026–January 20, 2027'), { start: '2026-12-15', end: '2027-01-20', text: 'December 15, 2026–January 20, 2027' });
  assert.deepEqual(eventRange('December 15–January 20, 2027'), { start: '2026-12-15', end: '2027-01-20', text: 'December 15–January 20, 2027' }, 'a sale over the new year');
});

test('a receivership is matched to the failed-bank record by name and state, never by a guess', () => {
  assert.deepEqual([matchReceivership({ name: 'Example Prairie Bank', state: 'AZ' }, FAILED).cert, matchReceivership({ name: 'Example Prairie Bank', state: 'AZ' }, FAILED).matchedBy], ['9001', 'name and state']);
  assert.equal(matchReceivership({ name: 'Example Prairie Bank', state: 'TX' }, FAILED).cert, null, 'same name, other state: no match');
  assert.equal(matchReceivership({ name: 'Example Prairie Bank, N.A.', state: 'AZ' }, FAILED).cert, '9001', 'a legal suffix does not block the match');
  const two = { ...FAILED, 9002: { cert: '9002', name: 'Example Prairie Bank', state: 'AZ', city: 'Elsewhere' } };
  assert.deepEqual(matchReceivership({ name: 'Example Prairie Bank', state: 'AZ' }, two).ambiguous, ['9001', '9002'], 'two candidates: left unmatched, both shown');
  assert.equal(matchReceivership({ name: 'Example Prairie Bank', state: 'AZ', city: 'Sampleton' }, two).cert, '9001', 'the city decides between them');
});

test('the PDF reader: text from FlateDecode streams with no dependency, the announcement date, and an unreadable PDF said so', () => {
  const t = pdfText(makePdf(PDF_LINES()));
  assert.equal(t.readable, true, JSON.stringify(t));
  assert.match(t.text, /SEALED BID SALE ANNOUNCEMENT\nOCTOBER 14, 2026/);
  assert.deepEqual(parseAnnouncementPdf(t.text), { announcedOn: '2026-10-14', loans: 312, upb: 41512300 });
  const hex = pdfText(makePdf(PDF_LINES(), { hexOnly: true }));
  assert.equal(hex.readable, false); assert.equal(hex.text, '');
  assert.deepEqual(pdfText(Buffer.from('<html>not a pdf</html>')), { text: '', readable: false, reason: 'not a PDF' });
});

test('a full run: robots first, gentle pacing, every request identified, sales recorded with dates, receivership, PDF date and advisor', async () => {
  const dir = makeDir();
  put(dir, 'sources/fdic/failed.json', FAILED);
  const site = fakeFdicWww();
  const r = await run(dir, site);
  assert.equal(r.outcome, 'ok', JSON.stringify(r));
  assert.deepEqual([r.listed, r.pagesRead, r.salesNew, r.pdfsRead, r.receiverships, r.matched, r.requests], [2, 3, 2, 2, 2, 2, 6]);
  assert.equal(site.calls[0].path, '/robots.txt', 'robots.txt is read before anything else');
  assert.ok(site.calls.every((c) => c.ua === UA), 'every request names the firm');
  assert.ok(r.waits.length === 5 && r.waits.every((w) => w >= 30000), `the Crawl-delay (30 s) outranks the 20 s minimum: ${r.waits}`);
  const sales = readJson(fdicSalesPaths(dir).sales);
  const s = sales['EXB2-26'];
  assert.deepEqual([s.announcedOn, s.keyDates.bidDeadline, s.upb, s.loans, s.advisor, s.seller, s.buyer], ['2026-10-14', '2026-12-02', 41512300, 312, ADVISOR, 'FDIC as receiver', 'unknown']);
  assert.deepEqual(s.receiverships.map((x) => [x.key, x.matchedBy, x.inMetros, x.metros]), [['fdic:9001', 'name and state', true, ['38060']]]);
  assert.deepEqual([s.pdf.readable, s.pdf.announcedOn, s.pdf.differsFromPage], [true, '2026-10-14', undefined]);
  assert.equal(sales['EXB-26'].announcedOn, '2026-08-27');
  assert.equal(s._source.endpoint, '/asset-sales/events/exb2-26-sale-announcement');
  const raw = readFileSync(fdicSalesPaths(dir).sales, 'utf8') + readFileSync(join(dir, 'sources', 'runs.jsonl'), 'utf8');
  for (const leak of [PERSON, PHONE, EMAIL, 'sales@example.test']) assert.ok(!raw.includes(leak), `stored "${leak}"`);
});

test('a second run adds nothing, reads no PDF again, and keeps a sale after it leaves the list', async () => {
  const dir = makeDir();
  await run(dir, fakeFdicWww());
  const again = await run(dir, fakeFdicWww());
  assert.deepEqual([again.outcome, again.salesNew, again.pdfsRead, again.pdfsKept, again.changed], ['ok', 0, 0, 2, 0]);
  const later = fakeFdicWww({ listing: LISTING(['exb2-26-sale-announcement']) });
  const third = await run(dir, later);
  assert.equal(third.listed, 1);
  assert.deepEqual(Object.keys(readJson(fdicSalesPaths(dir).sales)).sort(), ['EXB-26', 'EXB2-26'], 'the finished sale is kept');
  assert.ok(!later.calls.some((c) => c.path.endsWith('.pdf')), 'a PDF already read is not fetched again');
});

test('a changed date is logged as a change; an empty list is a normal run, not a failure', async () => {
  const dir = makeDir();
  await run(dir, fakeFdicWww());
  await run(dir, fakeFdicWww({ pages: { '/asset-sales/events/exb2-26-sale-announcement': SALE_PAGE().replace('<td><span>12/02/2026</span></td>', '<td><span>12/09/2026</span></td>') } }));
  const ch = readJsonl(join(dir, 'sources', 'changes.jsonl')).filter((c) => c.key === 'fdic-sale:EXB2-26' && c.field === 'keyDates');
  assert.equal(ch.length, 1);
  assert.equal(ch[0].new.bidDeadline, '2026-12-09');
  const empty = await run(dir, fakeFdicWww({ listing: EMPTY_LISTING }));
  assert.deepEqual([empty.outcome, empty.listed], ['ok', 0]);
});

test('field checks: a sale page without its receivership fails the run and writes nothing; a changed list page fails too', async () => {
  const dir = makeDir();
  const r = await run(dir, fakeFdicWww({ pages: { '/asset-sales/events/exb-26-sale-announcement': SALE_PAGE({ id: 'EXB-26', receiver: false }) } }));
  assert.equal(r.outcome, 'failed');
  assert.deepEqual(r.missingFields, ['exb-26-sale-announcement: receiverships']);
  assert.equal(readJson(fdicSalesPaths(dir).sales, null), null, 'nothing written');
  const moved = await run(makeDir(), fakeFdicWww({ listing: '<html><main><p>Redesigned</p></main></html>' }));
  assert.equal(moved.outcome, 'failed');
  assert.match(moved.errors[0], /no "Loan Sales Event\(s\)" section/);
});

test('robots.txt is obeyed: a disallowed sale page is not fetched, a disallowed list stops the run, and a failed robots read stops it too', async () => {
  const site = fakeFdicWww({ robots: `${ROBOTS}\n`.replace('Disallow: /search/', 'Disallow: /search/\nDisallow: /asset-sales/events/exb-26') });
  const r = await run(makeDir(), site);
  assert.equal(r.outcome, 'ok');
  assert.equal(r.robotsSkipped, 1);
  assert.ok(!site.calls.some((c) => c.path === '/asset-sales/events/exb-26-sale-announcement'));
  const blocked = await run(makeDir(), fakeFdicWww({ robots: 'User-agent: *\nDisallow: /asset-sales/' }));
  assert.equal(blocked.outcome, 'failed'); assert.match(blocked.errors[0], /robots\.txt disallows/);
  const down = await run(makeDir(), fakeFdicWww({ status: { '/robots.txt': 503 } }));
  assert.equal(down.outcome, 'failed', 'we do not crawl without knowing the rules');
  const none = await run(makeDir(), fakeFdicWww({ robots: null }));
  assert.equal(none.outcome, 'ok', 'no robots.txt (404) allows everything');
});

test('an unreadable PDF is kept as a link only, and the sale still records its page dates', async () => {
  const dir = makeDir();
  const r = await run(dir, fakeFdicWww({ pdfs: { '/asset-sales/exb2-26-loan-sale-announcement.pdf': makePdf(PDF_LINES(), { hexOnly: true }) } }));
  assert.equal(r.pdfsUnreadable, 1);
  const s = readJson(fdicSalesPaths(dir).sales)['EXB2-26'];
  assert.deepEqual([s.pdf.readable, s.pdf.link, s.announcedOn, s.eventDates.start], [false, 'https://www.fdic.gov/asset-sales/exb2-26-loan-sale-announcement.pdf', null, '2026-10-26']);
});

test('verify: every listed sale stored, every record sourced with no contact; and it says when the contact is a placeholder', async () => {
  const dir = makeDir();
  await run(dir, fakeFdicWww());
  const v = await verifyFdicSales({ dir, fdic: FDIC, personalDomains: rules.config.personalDomains, fetchImpl: fakeFdicWww().fetchImpl, sleep: async () => {}, now: NOW });
  assert.deepEqual(v.checks.map((c) => [c.id, c.ok]), [['fdicsales.fresh', true], ['fdicsales.sourced', true], ['fdicsales.listed', true]], JSON.stringify(v.checks));
  assert.equal(v.sample[0].check.startsWith('https://www.fdic.gov/asset-sales/events/'), true);
  const more = await verifyFdicSales({ dir, fdic: FDIC, fetchImpl: fakeFdicWww({ listing: LISTING(['exb2-26-sale-announcement', 'exb3-26-sale-announcement']) }).fetchImpl, sleep: async () => {}, now: NOW });
  assert.equal(more.checks.find((c) => c.id === 'fdicsales.listed').ok, false);
  const quiet = fakeFdicWww();
  const ph = await verifyFdicSales({ dir, fdic: PLACEHOLDER, fetchImpl: quiet.fetchImpl, sleep: async () => {}, now: NOW });
  assert.match(ph.checks.find((c) => c.id === 'fdicsales.listed').summary, /Skipped: .*placeholder/);
  assert.equal(quiet.calls.length, 0, 'nothing was requested with the placeholder');
});
