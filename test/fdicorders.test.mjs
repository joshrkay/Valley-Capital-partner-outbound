// FDIC enforcement orders (PRD next-five E18-S2, source 2) against a fake www.fdic.gov and a fake browser. Invented banks and people
// only; no network. One test drives a real headless Chromium against a page served from this machine, when Playwright is installed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { makeDir, put, REPO } from './kit.mjs';
import { loadRules } from '../src/rules.mjs';
import { readJson, readJsonl } from '../src/store.mjs';
import { RUNS, CHANGES } from '../src/sources/runlog.mjs';
import { enforcementPaths, enforcementSignals, unmatchedOrders, ordersFor } from '../src/sources/enforcement.mjs';
import {
  runFdicOrders, verifyFdicOrders, releaseLinks, parseRelease, mapColumns, parseCapture, classifyFdicType, parseDate, isOrganization, captureShape,
  maskText, linkTermination, browserSession, validateFdicOrdersConfig,
} from '../src/sources/fdicorders.mjs';
import { coverageReport } from '../src/coverage.mjs';
import { fakeWww, fakeSession, CAPTURE_SEPT, CAPTURE_JULY, PEOPLE } from './fdicorders-fake.mjs';
import { INSTITUTIONS } from './enforcement-fake.mjs';

const rules = loadRules();
const NOW = new Date('2026-11-16T12:00:00Z');
const ENF = { ...rules.config.enforcement, fdic: { ...rules.config.enforcement.fdic, minIntervalMs: 0 } };
const world = () => { const dir = makeDir(); put(dir, 'sources/fdic/institutions.json', INSTITUTIONS); return dir; };
const run = (dir, { www = fakeWww(), session = fakeSession(), ...over } = {}) => runFdicOrders({ dir, enforcement: ENF, fetchImpl: www.fetchImpl, session, now: NOW, clock: () => NOW, sleep: async () => {}, nowMs: () => 0, ...over });
const stored = (dir) => readJson(enforcementPaths(dir).fdicOrders, {});

// ---- Releases --------------------------------------------------------------------------------------------------------------------
test('the releases: enforcement releases on a year page; each one\'s orders link, release date and the month of its orders', () => {
  assert.deepEqual(releaseLinks('<a href="/news/press-releases/2026/fdic-publishes-september-enforcement-actions">x</a><a href="/news/press-releases/2026/fdic-board-meeting">y</a><a href="/news/press-releases/2025/fdic-makes-public-december-enforcement-actions">z</a>'),
    ['/news/press-releases/2026/fdic-publishes-september-enforcement-actions', '/news/press-releases/2025/fdic-makes-public-december-enforcement-actions']);
  const r = parseRelease('<a href="https://orders.fdic.gov/s/press-release-orders?prYear=2026&amp;prDate=30&amp;prMonth=1">Orders</a>', { path: '/news/press-releases/2026/fdic-publishes-december-enforcement-actions' });
  assert.deepEqual([r.releaseDate, r.ordersMonth, r.ordersUrl], ['2026-01-30', '2025-12', 'https://orders.fdic.gov/s/press-release-orders?prYear=2026&prDate=30&prMonth=1'], 'December\'s orders, released in January');
  assert.equal(parseRelease('<p>no link</p>', { path: 'x' }).ordersUrl, null);
});

// ---- Parsing the table -----------------------------------------------------------------------------------------------------------
test('columns by header words; types as codes; dates in three formats; organizations by their words', () => {
  assert.deepEqual(mapColumns(['Institution Name', 'City', 'State', 'Respondent', 'Order Type', 'Issue Date', 'Docket Number']), { institution: 0, city: 1, state: 2, respondent: 3, type: 4, date: 5, docket: 6 });
  assert.deepEqual(mapColumns(['Name', 'Location', 'Action', 'Date']), { institution: 0, location: 1, type: 2, date: 3 });
  assert.deepEqual(classifyFdicType('Order Terminating Consent Order'), { type: 'termination', terminatesType: 'consent_order' });
  assert.deepEqual(classifyFdicType('Order to Cease and Desist'), { type: 'cease_and_desist', terminatesType: null });
  assert.equal(classifyFdicType('Amended Supervisory Prompt Corrective Action Directive').type, 'modification');
  assert.equal(classifyFdicType('Supervisory Prompt Corrective Action Directive').type, 'pca_directive');
  assert.equal(classifyFdicType('Order to Pay Civil Money Penalty').type, 'civil_money_penalty');
  assert.deepEqual(['09/14/2026', '2026-09-14', 'September 14, 2026', 'soon'].map(parseDate), ['2026-09-14', '2026-09-14', '2026-09-14', null]);
  assert.deepEqual(['Example Bank, N.A.', 'Example Bancshares, Inc.', 'First Example Co.', 'Robin Sample', 'Jane Q. Public'].map(isOrganization), [true, true, true, false, false]);
  assert.deepEqual(validateFdicOrdersConfig(rules.config.enforcement.fdic), []);
});

test('a capture: orders against banks kept with codes, dates, place and the order\'s link; individuals and insurance terminations skipped', () => {
  const rel = { releaseDate: '2026-10-30', ordersMonth: '2026-09', ordersUrl: 'https://orders.fdic.gov/s/press-release-orders?prYear=2026&prDate=30&prMonth=10' };
  const p = parseCapture(CAPTURE_SEPT(), { release: rel });
  assert.deepEqual([p.rows, p.orders.length, p.skippedIndividual, p.skippedNotDistress, p.skippedBlank], [7, 3, 2, 1, 1]);
  assert.deepEqual(p.orders.map((o) => [o.key, o.type, o.date, o.parties[0].state]), [
    ['fdicorder:FDIC-26-0101b', 'consent_order', '2026-09-14', 'AZ'], ['fdicorder:FDIC-26-0103b:termination', 'termination', '2026-09-20', 'CA'], ['fdicorder:FDIC-26-0110b', 'cease_and_desist', '2026-09-02', 'OH']]);
  const c = p.orders[0];
  assert.deepEqual([c.regulator, c.parties, c.link, c.linkKind, c.dateBasis, c.release], ['fdic', [{ name: 'Example Desert Bank', city: 'Mesa Example', state: 'AZ' }], 'https://orders.fdic.gov/sfc/servlet.shepherd/document/download/069A1', 'order', 'order', '2026-10-30']);
  const b = parseCapture(CAPTURE_JULY(), { release: { releaseDate: '2026-08-28', ordersUrl: 'https://orders.fdic.gov/s/x' } });
  assert.deepEqual(b.orders.map((o) => [o.type, o.parties[0], o.date]), [['consent_order', { name: 'Example Coast Bank', city: 'Harbor', state: 'CA' }, '2026-07-10'], ['written_agreement', { name: 'Example Valley Bancorp, Inc.', city: 'Sampleton', state: 'TX' }, '2026-07-20']]);
  assert.match(b.orders[0].key, /^fdicorder:[0-9a-f]{16}$/, 'no docket: a stable hash');
  assert.equal(parseCapture(CAPTURE_JULY(), { release: { releaseDate: '2026-08-28' } }).orders[0].key, b.orders[0].key, 'the same row gives the same key');
  const all = JSON.stringify([p, b]);
  for (const name of PEOPLE) assert.ok(!all.includes(name), `${name} must not be parsed into an order`);
  assert.equal(parseCapture({ tables: [{ headers: ['Foo', 'Bar'], rows: [] }] }).error, 'no table with a name column and a type column');
});

test('the debug shape masks every word outside a fixed vocabulary: no name can be read from it', () => {
  const shape = JSON.stringify(captureShape(CAPTURE_SEPT()));
  for (const w of ['Desert', 'Coast', 'Valley', 'Faraway', 'Mesa', 'Harbor', 'Sampleton', ...PEOPLE.flatMap((n) => n.split(' '))]) assert.ok(!shape.includes(w), `${w} is masked`);
  assert.match(shape, /Institution Name/);
  assert.match(shape, /Order to Cease and Desist/);
  assert.equal(maskText('Example Bank, Harbor, CA 09/14/2026'), 'Aaaaaaa Bank, Aaaaaa, CA 99/99/9999');
});

// ---- The run -------------------------------------------------------------------------------------------------------------------
test('a run: the releases in the window found and captured oldest first; orders stored; a termination closes the order it ends', async () => {
  const dir = world();
  const www = fakeWww(), session = fakeSession();
  const r = await run(dir, { www, session });
  assert.equal(r.outcome, 'ok', JSON.stringify(r));
  assert.deepEqual([r.releasesNew, r.captured, r.rows, r.ordersNew, r.terminationsLinked, r.skippedIndividual, r.skippedNotDistress], [3, 2, 11, 5, 1, 4, 1]);
  assert.deepEqual(session.calls.filter((c) => c[0] === 'capture').map((c) => new URL(c[1]).searchParams.get('prMonth')), ['8', '10'], 'oldest first; the 2025 release is outside the window');
  assert.ok(!www.calls.includes('/news/press-releases/2024'));
  const o = stored(dir);
  const coast = Object.values(o).find((x) => x.kind === 'order' && x.parties[0].name === 'Example Coast Bank');
  assert.equal(coast.terminatedOn, '2026-09-20');
  assert.equal(o['fdicorder:FDIC-26-0103b:termination'].terminates, coast.key);
  assert.equal(o['fdicorder:FDIC-26-0101b']._source.source, 'fdicorders');
  const st = readJson(enforcementPaths(dir).fdicState);
  assert.deepEqual(Object.keys(st.releases).sort(), ['2025-03-28', '2026-08-28', '2026-10-30']);
  assert.equal(st.releases['2025-03-28'].capturedAt, null);
  // A second run captures nothing again: no browser is opened.
  const s2 = fakeSession();
  const again = await run(dir, { session: s2 });
  assert.deepEqual([again.outcome, again.releasesNew, again.captured, s2.calls.length], ['ok', 0, 0, 0]);
  // --since reaches the older release.
  const back = await run(dir, { session: fakeSession({ captures: { 'prMonth=3': CAPTURE_JULY } }), since: '2025-01-01' });
  assert.equal(back.captured, 1);
});

test('no person\'s name reaches the store, the state file, the run log or the change log', async () => {
  const dir = world();
  await run(dir);
  const all = [readFileSync(enforcementPaths(dir).fdicOrders, 'utf8'), readFileSync(enforcementPaths(dir).fdicState, 'utf8'), readFileSync(RUNS(dir), 'utf8'), existsSync(CHANGES(dir)) ? readFileSync(CHANGES(dir), 'utf8') : ''].join('\n');
  for (const name of PEOPLE) assert.ok(!all.includes(name), `${name} must not be stored`);
  assert.doesNotMatch(all, /Prohibition|Section 19|Order to Pay/);
});

test('a table that cannot be mapped fails the run, writes nothing, names the headers, and writes the masked shape on request', async () => {
  const dir = world();
  const shapeFile = join(makeDir(), 'shape.json');
  const odd = () => ({ url: 'u', pages: 1, tables: [{ headers: ['Col A', 'Col B'], rows: [{ cells: ['Pat Person', 'Example Desert Bank'], links: [] }] }] });
  const r = await run(dir, { session: fakeSession({ captures: { 'prMonth=8': odd, 'prMonth=10': odd } }), debugCapture: shapeFile });
  assert.equal(r.outcome, 'failed');
  assert.match(r.errors[0], /no table with a name column and a type column.*"Col A","Col B".*masked shape/);
  assert.ok(!existsSync(enforcementPaths(dir).fdicOrders), 'nothing was written');
  const shape = readFileSync(shapeFile, 'utf8');
  assert.match(shape, /Col A/);
  assert.ok(!shape.includes('Pat') && !shape.includes('Desert'));
  await assert.rejects(run(dir, { debugCapture: join(REPO, 'shape.json') }), /outside the repository/);
  const blocked = await run(world(), { session: fakeSession({ robots: 'User-agent: *\nDisallow: /s/' }) });
  assert.match(blocked.errors[0], /robots\.txt on orders\.fdic\.gov disallows/);
});

test('every row skipped as an individual marks the run suspect: the name column may be mapped wrong', async () => {
  const people = () => ({ url: 'u', pages: 1, tables: [{ headers: ['Respondent', 'Order Type'], rows: [{ cells: ['Pat Person', 'Consent Order'], links: [] }] }] });
  const r = await run(world(), { session: fakeSession({ captures: { 'prMonth=8': people, 'prMonth=10': people } }) });
  assert.equal(r.outcome, 'suspect');
});

test('linkTermination: the latest order of the type it ends, same bank, before it, not yet terminated', () => {
  const o = (key, date, over = {}) => ({ key, kind: 'order', type: 'consent_order', date, terminatedOn: null, parties: [{ name: 'Example Coast Bank', state: 'CA' }], ...over });
  const orders = { a: o('a', '2020-01-01'), b: o('b', '2024-01-01'), c: o('c', '2025-01-01', { terminatedOn: '2025-06-01' }), d: o('d', '2027-01-01'), e: o('e', '2024-06-01', { type: 'written_agreement' }) };
  assert.equal(linkTermination({ terminatesType: 'consent_order', date: '2026-09-20', parties: [{ name: 'EXAMPLE COAST BANK', state: 'CA' }] }, orders), 'b');
  assert.equal(linkTermination({ terminatesType: 'consent_order', date: '2026-09-20', parties: [{ name: 'Example Coast Bank', state: 'NV' }] }, orders), null);
});

// ---- Into the pipeline ---------------------------------------------------------------------------------------------------------------
test('FDIC orders give the same signals as the Fed\'s, with "from the FDIC"; they reach the review list, the bank lists and coverage', async () => {
  const dir = world();
  await run(dir);
  const s = enforcementSignals({ dir });
  assert.deepEqual(s['fdic:1002'].map((x) => x.label), ['Under a consent order from the FDIC effective 2026-09-14; no termination is recorded', 'Consent order from the FDIC, effective 2026-09-14']);
  assert.deepEqual(s['fdic:1005'].map((x) => x.type), ['enforcement_terminated', 'enforcement'], 'terminated: no state signal');
  assert.deepEqual(ordersFor({ dir, key: 'fdic:1005' }).map((x) => x.kind), ['termination', 'order']);
  assert.deepEqual(unmatchedOrders({ dir, enforcement: ENF, hqStates: rules.metros.hqStates, now: NOW }).map((x) => x.parties[0].name), ['Example Valley Bancorp, Inc.']);
  const items = Object.entries(INSTITUTIONS).map(([cert, i]) => ({ key: `fdic:${cert}`, cert, name: i.NAME, tier: 'B', score: 1, axes: {}, signals: [] }));
  put(dir, 'candidates/latest.json', { runId: 'score-1', latestRepdte: '20260630', items });
  const cov = coverageReport({ dir }).rows.find((x) => x.id === 'enforcement');
  assert.deepEqual([cov.notRun, cov.cells.all.count], [false, 2]);
});

test('verify: fresh, sourced and person-free, and every release on www.fdic.gov in the window captured', async () => {
  const dir = world();
  await run(dir);
  const ok = await verifyFdicOrders({ dir, enforcement: ENF, fetchImpl: fakeWww().fetchImpl, sleep: async () => {}, now: NOW });
  assert.deepEqual(ok.checks.map((c) => [c.id, c.ok]), [['fdicorders.fresh', true], ['fdicorders.sourced', true], ['fdicorders.complete', true]], JSON.stringify(ok.checks));
  const more = fakeWww({ pages: { '/news/press-releases/2026': '<a href="/news/press-releases/2026/fdic-publishes-october-enforcement-actions">x</a><a href="/news/press-releases/2026/fdic-publishes-september-enforcement-actions">y</a>' } });
  const bad = await verifyFdicOrders({ dir, enforcement: ENF, fetchImpl: more.fetchImpl, sleep: async () => {}, now: new Date('2027-01-15T00:00:00Z') });
  assert.deepEqual(bad.checks.map((c) => c.ok), [false, true, false]);
  assert.deepEqual(bad.checks[2].detail.missing, ['/news/press-releases/2026/fdic-publishes-october-enforcement-actions']);
});

// ---- The real browser, against a page on this machine -------------------------------------------------------------------------------
let playwright = null;
try { playwright = (await import('node:module')).createRequire(import.meta.url)('playwright'); } catch { playwright = null; }
test('the browser: a table drawn by script is read, and its Next button followed to the last page', { skip: playwright ? false : 'Playwright is not installed here (npm run fdic-orders:setup)' }, async () => {
  const rows = [['Example Desert Bank', 'Consent Order', '09/14/2026'], ['Example Coast Bank', 'Order Terminating Consent Order', '09/20/2026'], ['Example Valley Bank', 'Written Agreement', '09/21/2026']];
  const page = `<!doctype html><html><body><div id="app">Loading</div><script>
    const rows = ${JSON.stringify(rows)}; let at = 0;
    function draw() { setTimeout(() => {
      const r = rows.slice(at, at + 2).map((x) => '<tr>' + x.map((c, i) => '<td>' + (i === 0 ? '<a href="/doc/' + encodeURIComponent(c) + '.pdf">' + c + '</a>' : c) + '</td>').join('') + '</tr>').join('');
      document.getElementById('app').innerHTML = '<table><thead><tr><th>Institution Name</th><th>Order Type</th><th>Issue Date</th></tr></thead><tbody>' + r + '</tbody></table>'
        + '<button id="n" ' + (at + 2 >= rows.length ? 'disabled' : '') + '>Next</button>';
      document.getElementById('n').onclick = () => { at += 2; draw(); };
    }, 200); }
    draw();
  </script></body></html>`;
  const server = createServer((req, res) => { res.writeHead(200, { 'content-type': req.url.endsWith('.txt') ? 'text/plain' : 'text/html' }); res.end(req.url.endsWith('.txt') ? 'User-agent: *\nAllow: /' : page); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const s = await browserSession({ playwright, timeoutMs: 15000 });
  try {
    assert.match((await s.text(`${base}/robots.txt`)).text, /Allow: \//);
    const cap = await s.capture(`${base}/s/press-release-orders?prYear=2026&prDate=30&prMonth=10`);
    assert.equal(cap.pages, 2);
    assert.deepEqual(cap.tables[0].headers, ['Institution Name', 'Order Type', 'Issue Date']);
    assert.deepEqual(cap.tables[0].rows.map((r) => r.cells[0]), ['Example Desert Bank', 'Example Coast Bank', 'Example Valley Bank']);
    assert.match(cap.tables[0].rows[0].links[0].href, /\/doc\/Example%20Desert%20Bank\.pdf$/);
    const parsed = parseCapture(cap, { release: { releaseDate: '2026-10-30' } });
    assert.deepEqual(parsed.orders.map((o) => o.type), ['consent_order', 'termination', 'written_agreement']);
  } finally { await s.close(); server.close(); }
});
