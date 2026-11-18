// The source adapter for a county notice list (src/sources/notices.mjs) and its invented example (src/sources/counties/example.mjs),
// run against the fake (test/county-notices-fake.mjs): the interface's checks, fetch with the firm's User-Agent and rate limit, robots.txt,
// parse, the field check that writes nothing, two weeks of the watcher, and the verify check. No network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { makeDir, put, config } from './kit.mjs';
import { readJson, readJsonl } from '../src/store.mjs';
import { defineNoticeSource, runnable, validateCountyConfig, runNoticeSource, verifyNoticeSource, htmlTables, parseUsd, parseDate, CHANNELS } from '../src/sources/notices.mjs';
import { exampleCounty, parseExampleList, EXAMPLE_LIST } from '../src/sources/counties/example.mjs';
import { COUNTY_SOURCES, countySource, watchedCounties, countyCoverage } from '../src/counties.mjs';
import { loansPaths, loanEvents, readBankLoans, readLoanState } from '../src/loans.mjs';
import { fakeCounty, listHtml, WEEK1, WEEK2, INSTITUTIONS, BORROWERS, ADDRESSES, HEADERS } from './county-notices-fake.mjs';

const counties = () => config().counties;
const T1 = new Date('2026-11-16T12:00:00Z'), T2 = new Date('2026-11-23T12:00:00Z');
const world = () => { const dir = makeDir(); put(dir, 'sources/fdic/institutions.json', INSTITUTIONS); return dir; };
const run = (dir, f, now = T1, over = {}) => runNoticeSource({ dir, source: exampleCounty, counties: counties(), fetchImpl: f.fetchImpl, sleep: async () => {}, now, clock: () => now, allowExample: true, ...over });

test('the interface: an adapter declares its county, channel, cadence, hosts, terms, requests and parser, or it is refused', () => {
  assert.deepEqual(Object.keys(CHANNELS), ['a', 'b', 'c']);
  const good = { id: 'x-county', label: 'X', county: { fips: '99002', name: 'X' }, state: 'CO', channel: 'b', cadence: 'weekly', hosts: ['x.example'], terms: {}, requests: () => [], parse: () => ({}) };
  assert.equal(defineNoticeSource(good).id, 'x-county');
  for (const [k, v, re] of [['id', 'X County', /safe id/], ['channel', 'd', /channel/], ['cadence', 'daily', /cadence/], ['hosts', [], /hosts/], ['parse', null, /parse/], ['state', 'Colorado', /state/], ['county', { fips: '1', name: 'X' }, /fips/]])
    assert.throws(() => defineNoticeSource({ ...good, [k]: v }), re, k);
  // Only an allowed, dated terms decision runs a real source; an example runs only against its fake.
  assert.match(runnable(defineNoticeSource(good)).reason, /no recorded decision/);
  assert.equal(runnable(defineNoticeSource({ ...good, terms: { decision: 'allowed', robotsCheckedOn: '2026-11-20', termsCheckedOn: '2026-11-20', by: 'Pat Example' } })).ok, true);
  assert.match(runnable(exampleCounty).reason, /invented/);
  assert.equal(runnable(exampleCounty, { allowExample: true }).ok, true);
  assert.deepEqual(Object.keys(COUNTY_SOURCES), ['example-county']);
  assert.throws(() => countySource('nowhere-county'), /No county source/);
});

test('config.counties: the firm\'s User-Agent, three requests a minute, and no county watched until a principal lists one', () => {
  const c = counties();
  assert.deepEqual(validateCountyConfig(c), []);
  assert.equal(c.minIntervalMs, 20000);
  assert.equal(c.userAgent, config().sec.userAgent, 'the same contact as the SEC, FDIC and Federal Reserve requests');
  assert.deepEqual(c.watch, [], 'the example is never watched in the shipped config');
  assert.ok(validateCountyConfig({ ...c, minIntervalMs: -1 }).some((e) => /minIntervalMs/.test(e)));
  assert.ok(validateCountyConfig({ ...c, watch: ['Bad Id'] }).some((e) => /watch/.test(e)));
});

test('parse: the list page to documents, a document type not kept skipped, every party with its role, amounts with their basis', () => {
  const p = parseExampleList(listHtml(WEEK1()), { url: EXAMPLE_LIST });
  assert.deepEqual([p.rows, p.documents.length, p.skipped.length, p.missing], [9, 8, 1, {}]);
  const nts = p.documents.find((d) => d.documentNumber === '2026-004105');
  assert.deepEqual([nts.documentType, nts.dates.sale, nts.url], ['notice_of_trustee_sale', '2026-12-09', 'https://publictrustee.example/documents/2026-004105']);
  assert.deepEqual(nts.amounts, { originalPrincipal: { value: 7800000, basis: 'document' }, unpaidBalance: { value: 7215000, basis: 'document' } });
  const asg = p.documents.find((d) => d.documentType === 'assignment');
  assert.deepEqual(asg.parties.map((x) => x.role), ['assignor', 'assignee', 'grantor']);
  assert.deepEqual(asg.amounts.unpaidBalance, { value: null, basis: 'not-stated' });
  assert.deepEqual(asg.deedOfTrust, { documentNumber: '2020-0099887', recorded: '2020-09-14' });
  // A required column gone is a format change.
  assert.deepEqual(parseExampleList(listHtml(WEEK1(), { headers: HEADERS.filter((h) => h !== 'Current holder') })).missing, { 'Current holder': 1 });
  assert.deepEqual(parseExampleList('<html>no table</html>').missing, { table: 1 });
  // Helpers: text only, no markup survives; money and dates.
  const t = htmlTables('<table id="x"><tr><th>A</th></tr><tr><td><b>x &amp; y</b><script>bad()</script></td></tr></table>')[0];
  assert.deepEqual([t.id, t.headers, t.rows[0].cells[0]], ['x', ['A'], 'x & y bad()']);
  assert.deepEqual([parseUsd('$4,200,000.00'), parseUsd(''), Number.isNaN(parseUsd('about 4M'))], [4200000, null, true]);
  assert.deepEqual([parseDate('3/4/2027'), parseDate('2027-03-04'), parseDate('')], ['2027-03-04', '2027-03-04', null]);
});

test('fetch: robots.txt first, the firm\'s User-Agent on every request, requests paced at the configured interval', async () => {
  const dir = world();
  const f = fakeCounty();
  const waits = [];
  let clock = 0;
  const r = await runNoticeSource({ dir, source: exampleCounty, counties: counties(), fetchImpl: f.fetchImpl, now: T1, clock: () => T1, allowExample: true,
    sleep: async (ms) => { waits.push(ms); clock += ms; }, nowMs: () => clock });
  assert.equal(r.outcome, 'ok', JSON.stringify(r));
  assert.deepEqual(f.calls.map((c) => c.path), ['/robots.txt', '/foreclosures/recorded']);
  assert.ok(f.calls.every((c) => c.ua === 'Valley Capital Partners josh@valleycapitalpartner.com'), 'every request names the firm');
  assert.deepEqual(waits, [20000], 'the second request waits the configured 20 seconds (3 a minute)');
  // A Crawl-delay longer than the interval wins.
  const waits2 = []; let c2 = 0;
  await runNoticeSource({ dir: world(), source: exampleCounty, counties: counties(), fetchImpl: fakeCounty({ robots: 'User-agent: *\nCrawl-delay: 45\n' }).fetchImpl, now: T1, allowExample: true, sleep: async (ms) => { waits2.push(ms); c2 += ms; }, nowMs: () => c2 });
  assert.deepEqual(waits2, [45000]);
});

test('nothing is bypassed: robots.txt disallowing the list, a host not declared, a placeholder User-Agent or an invented source stops the run', async () => {
  const dir = world();
  const r = await run(dir, fakeCounty({ robots: 'User-agent: *\nDisallow: /foreclosures/\n' }));
  assert.equal(r.outcome, 'failed');
  assert.match(r.errors[0], /robots\.txt on publictrustee\.example disallows \/foreclosures\/recorded/);
  assert.ok(!existsSync(loansPaths(dir).docs('example-county')), 'nothing written');
  const other = defineNoticeSource({ ...exampleCounty, requests: () => [{ url: 'https://elsewhere.example/list' }] });
  assert.match((await run(world(), fakeCounty(), T1, { source: other })).errors[0], /elsewhere\.example is not one of the source's hosts/);
  await assert.rejects(run(world(), fakeCounty(), T1, { counties: { ...counties(), userAgent: '[CONFIRM: firm and contact]' } }), /userAgent is a placeholder/);
  await assert.rejects(runNoticeSource({ dir: world(), source: exampleCounty, counties: counties(), fetchImpl: fakeCounty().fetchImpl }), /invented/);
  // A 404 robots.txt allows everything, and says so.
  const ok = await run(world(), fakeCounty({ robots: null }));
  assert.equal(ok.outcome, 'ok');
});

test('the field check: a missing column or an unreadable document fails the run, and nothing is written', async () => {
  const dir = world();
  const r = await run(dir, fakeCounty({ html: listHtml(WEEK1(), { headers: HEADERS.filter((h) => h !== 'Grantor') }) }));
  assert.deepEqual([r.outcome, r.missingFields], ['failed', ['Grantor']]);
  assert.ok(!existsSync(loansPaths(dir).docs('example-county')));
  const bad = WEEK1(); bad[0] = { ...bad[0], outstanding: 'about $3.9M' };
  const r2 = await run(dir, fakeCounty({ rows: bad }));
  assert.equal(r2.outcome, 'failed');
  assert.match(r2.errors[0], /document 2026-004101: amounts.unpaidBalance/);
  assert.ok(!existsSync(loansPaths(dir).docs('example-county')));
  const st = readLoanState(dir).sources['example-county'];
  assert.deepEqual([st.lastRun.outcome, st.lastOk], ['failed', null], 'the failure is on the Status page');
  const lines = readJsonl(join(dir, 'sources', 'runs.jsonl'));
  assert.deepEqual(lines.map((l) => [l.source, l.outcome]), [['county:example-county', 'failed'], ['county:example-county', 'failed']]);
});

test('two weeks of the watcher: new documents written, a changed one updated, unchanged ones left alone, dated events for the banks', async () => {
  const dir = world();
  const r1 = await run(dir, fakeCounty());
  assert.deepEqual([r1.outcome, r1.read, r1.added, r1.changed, r1.unchanged, r1.skipped, r1.index.eventsNew], ['ok', 8, 8, 0, 0, 1, 5]);
  const P = loansPaths(dir);
  const docsAfter1 = readFileSync(P.docs('example-county'), 'utf8');
  // The same week again: idempotent. Nothing new, nothing rewritten, no event.
  const again = await run(dir, fakeCounty(), new Date('2026-11-16T18:00:00Z'));
  assert.deepEqual([again.added, again.changed, again.unchanged, again.index.eventsNew, again.index.bankFilesWritten], [0, 0, 8, 0, 0]);
  assert.equal(readFileSync(P.docs('example-county'), 'utf8'), docsAfter1);

  const r2 = await run(dir, fakeCounty({ rows: WEEK2() }), T2);
  assert.deepEqual([r2.read, r2.added, r2.changed, r2.unchanged], [8, 2, 1, 5]);
  const docs = readJson(P.docs('example-county'));
  assert.equal(Object.keys(docs).length, 10, 'the documents that dropped off the list stay');
  const ned = docs['example-county:2026-004101'];
  assert.deepEqual([ned.amounts.unpaidBalance.value, ned.dates.sale, ned.firstSeenAt, ned.updatedAt], [3850000, '2027-03-11', T1.toISOString(), T2.toISOString()]);
  assert.equal(docs['example-county:2026-004102'].sources[0].fetchedAt, T1.toISOString(), 'unchanged: left alone');
  const changes = readJsonl(join(dir, 'sources', 'changes.jsonl'));
  assert.deepEqual(changes.map((c) => [c.key, c.field]).sort(), [['example-county:2026-004101', 'amounts'], ['example-county:2026-004101', 'dates']]);

  const ev = loanEvents({ dir });
  assert.equal(ev.length, 7, 'two more: the new notice (Example Bank) and the new deed of trust (Example Mountain Bank); none for the changed one');
  assert.match(ev.find((e) => e.documentId === 'example-county:2026-004121').label, /^A deed of trust was recorded on November 18, 2026 for a loan from this bank/);
  const fresh = ev.find((e) => e.documentId === 'example-county:2026-004120');
  assert.equal(fresh.label, 'A notice of election and demand was recorded on November 17, 2026 for a loan from this bank on a property in Example County, CO.');
  assert.equal(fresh.key, 'fdic:9001');
  assert.equal(readBankLoans({ dir, key: 'fdic:9001' }).loans[0].id, 'example-county:2026-004120', 'newest first');
  // State: each run with its counts, for the Status page.
  const st = readLoanState(dir).sources['example-county'];
  assert.deepEqual([st.lastRun.read, st.lastRun.added, st.lastRun.changed, st.runs.length, st.lastOk.ranAt], [8, 2, 1, 3, T2.toISOString()]);
  // Nothing about a borrower or an address in the run log, the state or the events.
  const logs = [readFileSync(join(dir, 'sources', 'runs.jsonl'), 'utf8'), readFileSync(P.state, 'utf8'), readFileSync(P.events, 'utf8'), readFileSync(join(dir, 'sources', 'changes.jsonl'), 'utf8')].join('\n');
  for (const leak of [...BORROWERS, ...ADDRESSES, '555-0142', 'trustee@publictrustee.example']) assert.ok(!logs.includes(leak), leak);
});

test('the verify check: fresh, sourced, recall against the list, and every lender name matched, set aside or on the review list', async () => {
  const dir = world();
  assert.equal((await verifyNoticeSource({ dir, source: exampleCounty, counties: counties(), allowExample: true })).checks[0].id, 'county.present');
  await run(dir, fakeCounty());
  const v = await verifyNoticeSource({ dir, source: exampleCounty, counties: counties(), fetchImpl: fakeCounty().fetchImpl, sleep: async () => {}, now: new Date('2026-11-17T12:00:00Z'), allowExample: true });
  assert.deepEqual(v.checks.map((c) => [c.id, c.ok]), [['county.fresh', true], ['county.sourced', true], ['county.recall', true], ['county.matched', true]], JSON.stringify(v.checks));
  assert.ok(v.sample.length && v.sample.every((s) => s.check.startsWith('https://publictrustee.example/documents/')));
  // The list now holds documents not stored: recall fails. A run later than freshDays: stale.
  const later = await verifyNoticeSource({ dir, source: exampleCounty, counties: counties(), fetchImpl: fakeCounty({ rows: WEEK2() }).fetchImpl, sleep: async () => {}, now: new Date('2026-12-01T12:00:00Z'), allowExample: true });
  assert.deepEqual(later.checks.filter((c) => !c.ok).map((c) => c.id).sort(), ['county.fresh', 'county.recall']);
  // A stored record that was tampered with fails the sourced check.
  const P = loansPaths(dir);
  const docs = readJson(P.docs('example-county'));
  docs['example-county:2026-004101'].amounts.unpaidBalance.value = 1;
  put(dir, 'loans/docs/example-county.json', docs);
  const t = await verifyNoticeSource({ dir, source: exampleCounty, counties: counties(), fetchImpl: fakeCounty().fetchImpl, sleep: async () => {}, now: new Date('2026-11-17T12:00:00Z'), allowExample: true });
  assert.deepEqual(t.checks.find((c) => c.id === 'county.sourced').detail.bad, ['example-county:2026-004101']);
  // The example is never verified against the network.
  const live = await verifyNoticeSource({ dir, source: exampleCounty, counties: counties(), now: new Date('2026-11-17T12:00:00Z') });
  assert.match(live.checks.find((c) => c.id === 'county.recall').summary, /invented/);
});

test('watched counties and coverage: the configured list and every source that ran, with the last run, documents read and new this week', async () => {
  assert.deepEqual(watchedCounties({ config: counties(), state: { sources: {} } }), [], 'no county is watched in the shipped config');
  const dir = world();
  await run(dir, fakeCounty());
  await run(dir, fakeCounty({ rows: WEEK2() }), T2);
  const rows = countyCoverage({ config: counties(), state: readLoanState(dir), now: new Date('2026-11-24T12:00:00Z') });
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.deepEqual([r.id, r.countyLabel, r.channel, r.example, r.configured, r.lastRun.outcome, r.read, r.newThisWeek, r.changedThisWeek, r.stored, r.matchedDocuments],
    ['example-county', 'Example County, CO', 'b', true, false, 'ok', 8, 2, 1, 10, 7]);
  // Two weeks on, nothing new this week.
  assert.equal(countyCoverage({ config: counties(), state: readLoanState(dir), now: new Date('2026-12-08T12:00:00Z') })[0].newThisWeek, 0);
  // A listed county that never ran is shown as such.
  const listed = countyCoverage({ config: { ...counties(), watch: ['example-county'] }, state: { sources: {} } })[0];
  assert.deepEqual([listed.configured, listed.lastRun, listed.read, listed.newThisWeek], [true, null, null, null]);
});
