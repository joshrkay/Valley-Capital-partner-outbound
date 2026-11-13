// The SEC filings listener (PRD E13-S1): the full-text search client, the saved searches, the run, its signals, and its checks,
// against a fake EDGAR full-text search and the fake FDIC. Invented filers, filings and people only; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { makeDir } from './kit.mjs';
import { loadRules } from '../src/rules.mjs';
import { readJson, readJsonl, writeJson } from '../src/store.mjs';
import { runFdic } from '../src/sources/fdic.mjs';
import { padCik, searchParams, checkBody, echoProblems, normalizeHit, search, eftsClient, lookupEntities } from '../src/sources/efts.mjs';
import { loadFilingRules, validateFilingRules, runFilings, filingSignals, filingProxies, discoveredFilers, verifyFilings, filingsPaths, indexUrl } from '../src/sources/filings.mjs';
import { confirmFiler } from '../src/sources/filers.mjs';
import { fakeSearch, ACC, DOCS, SECRET_TEXT, PERSON, withHoldingCompanies, URL_EFTS } from './edgar-search-fake.mjs';
import { fakeFdic, METROS, TABLES } from './fdic-fake.mjs';

const rules = loadRules();
const FR = loadFilingRules();
const NOW = new Date('2026-11-13T12:00:00Z');
const UA = 'Example Firm ops@example.test';
const SEC = { ...rules.config.sec, userAgent: UA, minIntervalMs: 0 };
const nosleep = async () => {};
const day = (n) => new Date(NOW.getTime() + n * 86400000);

// A data folder with the FDIC bank list as `sources run fdic` writes it: banks 101, 102 and 103 are in the list.
async function bankList() {
  const dir = makeDir();
  const r = await runFdic({ dir, metros: METROS, fetchImpl: fakeFdic(withHoldingCompanies(TABLES())).fetchImpl, quarters: 2, sleep: nosleep, minIntervalMs: 0, now: NOW });
  assert.equal(r.outcome, 'ok', JSON.stringify(r));
  return dir;
}
const mapped = async () => {
  const dir = await bankList();
  confirmFiler({ dir, bank: 'fdic:101', cik: '9900101', by: 'Pat Example', now: NOW });
  confirmFiler({ dir, bank: 'fdic:102', cik: '9900102', by: 'Pat Example', now: NOW });
  return dir;
};
const run = (dir, fake = fakeSearch(), over = {}) => runFilings({ dir, sec: SEC, rules: FR, fetchImpl: fake.fetchImpl, now: NOW, sleep: nosleep, ...over });
const client = (fake, over = {}) => eftsClient({ sec: SEC, fetchImpl: fake.fetchImpl, sleep: nosleep, ...over });
const raw = async (fake, params) => (await fake.fetchImpl(`${URL_EFTS}?${new URLSearchParams(params)}`, { headers: {} })).json();
const P = (dir) => filingsPaths(dir);
const allFiles = (dir) => { const out = []; const walk = (d) => { for (const n of readdirSync(d)) { const a = join(d, n); statSync(a).isDirectory() ? walk(a) : out.push(readFileSync(a, 'utf8')); } }; walk(dir); return out.join('\n'); };

// ---- The client --------------------------------------------------------------------------------------------------------------
test('the request: phrases quoted, CIKs zero-padded, items never sent, and from left out on the first page', () => {
  assert.equal(padCik('9900101'), '0009900101');
  assert.equal(padCik('0009900101'), '0009900101');
  assert.throws(() => padCik('99-01'), /Not a CIK/);
  assert.deepEqual(searchParams({ phrases: ['loan sale', 'commercial real estate'], forms: ['8-K', '10-Q'], ciks: ['0009900101'], startdt: '2026-11-01', enddt: '2026-11-13' }),
    { q: '"loan sale" "commercial real estate"', forms: '8-K,10-Q', dateRange: 'custom', startdt: '2026-11-01', enddt: '2026-11-13', ciks: '0009900101' });
  assert.equal(searchParams({ forms: ['8-K'], startdt: 'a', enddt: 'b', from: 200 }).from, 200);
  assert.equal('items' in searchParams({ forms: ['8-K'], startdt: 'a', enddt: 'b', items: ['2.06'] }), false);
});

test('an unpadded CIK matches nothing at the source, as live: the client always pads', async () => {
  const fake = fakeSearch();
  const q = { forms: '8-K', dateRange: 'custom', startdt: '2026-11-01', enddt: '2026-11-13' };
  assert.equal((await raw(fake, { ...q, ciks: '9900101' })).hits.total.value, 0);
  assert.ok((await raw(fake, { ...q, ciks: '0009900101' })).hits.total.value > 0);
});

test('every body is checked: an error body with HTTP 200, a failure body and an unknown shape all fail with the reason', () => {
  assert.throws(() => checkBody({ errorType: 'ResponseError', errorMessage: 'search_phase_execution_exception: Result window is too large, from + size must be less than or equal to: [10000]' }), (e) => e.kind === 'window' && /answered with an error: search_phase/.test(e.message));
  assert.throws(() => checkBody({ errorType: 'ResponseError', errorMessage: 'failed to create query' }), (e) => e.kind === 'error');
  assert.throws(() => checkBody({ message: 'Internal server error' }), (e) => e.kind === 'failed');
  assert.throws(() => checkBody({ took: 1 }), (e) => e.kind === 'shape');
});

test('the echo: an answer to another query is caught, whether another phrase, other CIKs, other dates, or a filter not asked for', async () => {
  const fake = fakeSearch();
  const asked = { phrases: ['commercial real estate'], forms: ['8-K'], ciks: ['0009900101'], startdt: '2026-11-01', enddt: '2026-11-13', from: 0 };
  const body = await raw(fake, searchParams(asked));
  assert.deepEqual(echoProblems(body, asked), { missing: false, problems: [] });
  assert.match(echoProblems(body, { ...asked, phrases: ['note sale'] }).problems.join(), /phrases/);
  assert.match(echoProblems(body, { ...asked, ciks: ['0009900102'] }).problems.join(), /ciks/);
  assert.match(echoProblems(body, { ...asked, enddt: '2026-11-12' }).problems.join(), /dates/);
  const withItems = await raw(fake, { ...searchParams(asked), items: '2.06' });
  assert.match(echoProblems(withItems, asked).problems.join(), /a filter on items that was not asked for/);
  const noQ = await raw(fake, searchParams({ ...asked, phrases: [] }));
  assert.deepEqual(echoProblems(noQ, { ...asked, phrases: [] }).problems, [], 'the server adds a main-documents filter when there is no phrase');
  assert.equal(echoProblems({ hits: { hits: [], total: { value: 0 } } }, asked).missing, true);
});

test('a hit keeps only the fields the listener uses: never text, snippets or highlights, and sequence is always a string', async () => {
  const body = await raw(fakeSearch({ leakText: true }), { forms: 'DEF 14A', dateRange: 'custom', startdt: '2026-01-01', enddt: '2026-11-13', ciks: '0009900101' });
  assert.ok(body.hits.hits[0]._source.doc_text, 'the fake sends text here, as the real server never does');
  const h = normalizeHit(body.hits.hits[0]);
  assert.deepEqual(Object.keys(h).sort(), ['accession', 'bizStates', 'ciks', 'document', 'fileDate', 'fileType', 'form', 'incStates', 'items', 'names', 'periodEnding', 'rootForms', 'sequence', 'sics']);
  assert.equal(h.sequence, '1');
  assert.equal(h.document, 'exhc-def14a-2026.htm');
  assert.doesNotMatch(JSON.stringify(h), new RegExp(PERSON));
});

test('search pages through every hit, 100 at a time, and splits a window the server will not page through', async () => {
  const many = (n, date) => Array.from({ length: n }, (_, i) => ({ adsh: `0009999999-26-${String(100000 + i).padStart(6, '0')}`.slice(0, 20), filer: 'hill', form: '8-K', root: '8-K', date, items: ['8.01'], seq: '1', name: `d${i}.htm`, fileType: '8-K', text: 'other events' }));
  const fake = fakeSearch({ docs: [...many(250, '2026-11-02')] });
  const r = await search({ client: client(fake), forms: ['8-K'], ciks: ['0009900101'], startdt: '2026-11-01', enddt: '2026-11-13' });
  assert.deepEqual([r.hits.length, r.pages, r.short], [250, 3, false]);
  assert.deepEqual(fake.calls.map((c) => c.params.from ?? '0'), ['0', '100', '200']);

  const big = fakeSearch({ docs: [...many(6000, '2026-11-01'), ...many(4050, '2026-11-02')] });
  const s = await search({ client: client(big), forms: ['8-K'], ciks: ['0009900101'], startdt: '2026-11-01', enddt: '2026-11-02' });
  assert.equal(s.hits.length, 10050, 'every hit, though the whole window holds more than 10,000');
  assert.deepEqual(s.windows.map((w) => [w.startdt, w.enddt, w.total]), [['2026-11-01', '2026-11-01', 6000], ['2026-11-02', '2026-11-02', 4050]]);
  await assert.rejects(search({ client: client(fakeSearch({ docs: many(10001, '2026-11-01') })), forms: ['8-K'], startdt: '2026-11-01', enddt: '2026-11-01' }), /More than 10000 hits on 2026-11-01/);
});

test('the CDN cache: an answer for another SIC list is detected, waited out, and fetched again; one that never expires fails', async () => {
  let t = 0;
  const sleep = async (ms) => { t += ms; };
  const asked = { phrases: ['balance sheet repositioning'], forms: ['8-K'], states: ['TX', 'AZ'], startdt: '2026-11-01', enddt: '2026-11-13' };
  const fake = fakeSearch({ cache: true, clock: () => t, ttlMs: 60000 });
  await raw(fake, searchParams({ ...asked, sics: ['5411'] }));   // someone else's search, a moment earlier: a grocer's SIC
  const r = await search({ client: client(fake, { sleep }), cacheWaitMs: 65000, ...asked, sics: ['6022'] });
  assert.equal(r.retried, 1);
  assert.equal(t, 65000, 'it waited for the cache to expire');
  assert.deepEqual(r.hits.map((h) => h.accession), [ACC.desertRepositioning], 'the bank, not the grocer');

  const stuck = fakeSearch({ cache: true, clock: () => 0, ttlMs: Infinity });
  await raw(stuck, searchParams({ ...asked, sics: ['5411'] }));
  await assert.rejects(search({ client: client(stuck), cacheWaitMs: 1, ...asked, sics: ['6022'] }), /does not match the request, even after waiting/);
});

test('a hit that does not match its own request is dropped, even when the echo agrees', async () => {
  const fake = fakeSearch();
  const lying = { ...fake, fetchImpl: async (url, init) => { const res = await fake.fetchImpl(url.replace(/ciks=[^&]+/, 'ciks=0009900101%2C0009900102'), init); const b = await res.json(); b.query.query.bool.filter = b.query.query.bool.filter.map((f) => (f.terms?.ciks ? { terms: { ciks: ['0009900102'] } } : f)); return new Response(JSON.stringify(b), { status: 200 }); } };
  const r = await search({ client: client(lying), forms: ['8-K'], ciks: ['0009900102'], startdt: '2026-11-01', enddt: '2026-11-13' });
  assert.ok(r.dropped > 0);
  assert.ok(r.hits.every((h) => h.ciks.includes('0009900102')));
});

test('an error body is the server\'s own trouble at times (seen live): asked again twice after a pause, then the run fails', async () => {
  let n = 0;
  const waits = [];
  const flaky = fakeSearch({ errorFor: () => n++ < 2 });
  const r = await search({ client: client(flaky, { sleep: async (ms) => { waits.push(ms); } }), forms: ['8-K'], ciks: ['0009900102'], startdt: '2026-11-01', enddt: '2026-11-13' });
  assert.equal(r.hits.length, 2);
  assert.deepEqual(waits, [2000, 8000]);
  const down = fakeSearch({ errorFor: () => true });
  await assert.rejects(search({ client: client(down), forms: ['8-K'], startdt: '2026-11-01', enddt: '2026-11-13' }), /answered with an error/);
  assert.equal(down.calls.length, 3);
});

test('a transient HTTP 500 is retried; the entity lookup finds by every word of a name, or by CIK', async () => {
  const fake = fakeSearch({ fail500: 1 });
  const r = await search({ client: client(fake), forms: ['8-K'], ciks: ['0009900102'], startdt: '2026-11-01', enddt: '2026-11-13' });
  assert.equal(fake.calls.length, 2);
  assert.deepEqual(r.hits.map((h) => h.accession).sort(), [ACC.acquisition, ACC.otherEvent].sort());
  const byName = await lookupEntities({ client: client(fakeSearch()), text: 'EXAMPLE HILL COUNTRY BANCSHARES' });
  assert.deepEqual(byName.map((e) => [e.cik, e.name]), [['0009900101', 'EXAMPLE HILL COUNTRY BANCSHARES, INC.'], ['0009900301', 'EXAMPLE HILL COUNTRY BANCSHARES CAPITAL TRUST I']]);
  assert.deepEqual((await lookupEntities({ client: client(fakeSearch()), text: '9900102' })).map((e) => e.cik), ['0009900102']);
});

// ---- The saved searches ------------------------------------------------------------------------------------------------------
test('filings.json: valid; every search has phrases or 8-K items; AND-only phrases; discovery uses known searches and bank SIC codes', () => {
  assert.deepEqual(validateFilingRules(FR), []);
  assert.match(FR._note, /PLACEHOLDER/);
  for (const id of ['8k-acquisition', '8k-impairment', 'transferred-held-for-sale-cre', 'loans-held-for-sale-cre', 'loan-sale-cre', 'note-sale-cre', 'balance-sheet-repositioning']) assert.ok(FR.searches.some((s) => s.id === id), id);
  assert.deepEqual(FR.searches.find((s) => s.id === '8k-impairment').items, ['2.06']);
  assert.deepEqual(FR.discovery.states, ['TX', 'CO', 'CA', 'AZ', 'NV']);
  assert.deepEqual(FR.proxies.forms, ['DEF 14A']);
  const bad = structuredClone(FR);
  bad.searches.push({ id: '8k-impairment', label: 'x', forms: ['8-K'], items: ['2.06'] }, { id: 'quoted', label: 'x', forms: ['8-K'], phrases: ['"loan sale" OR "x"'] }, { id: 'items-10q', label: 'x', forms: ['10-Q'], items: ['2.06'] }, { id: 'everything', label: 'x', forms: ['8-K'] });
  bad.discovery.searches.push('missing');
  assert.deepEqual(validateFilingRules(bad), ['search id "8k-impairment" is used twice', 'quoted: each phrase is plain words, with no quotes', 'items-10q: items apply to 8-K searches only', 'everything: needs phrases or items, or it would return every filing', 'discovery.searches: no search "missing"']);
});

// ---- The run -----------------------------------------------------------------------------------------------------------------
test('a full run: every saved search for the confirmed filers, one record per filing, 8-K items matched on the hits', async () => {
  const dir = await mapped();
  const fake = fakeSearch();
  const r = await run(dir, fake);
  assert.equal(r.outcome, 'ok', JSON.stringify(r));
  const filings = readJson(P(dir).filings);
  assert.deepEqual(Object.keys(filings).sort(), [ACC.impairment, ACC.heldForSale, ACC.loanSale, ACC.acquisition, ACC.oldImpairment].sort(), 'not the Item 8.01 8-K, the proxy, or the periodic reports with no phrase');
  const hfs = filings[ACC.heldForSale];
  assert.deepEqual(hfs.searches, ['loans-held-for-sale-cre', 'transferred-held-for-sale-cre'], 'one record for a filing two searches matched');
  assert.deepEqual([hfs.form, hfs.fileDate, hfs.cik, hfs.kind, hfs.contextOnly], ['8-K', '2026-11-11', '0009900101', 'event', true]);
  assert.ok(hfs.documents.some((x) => x.name === 'exhc-ex991-q3.htm' && x.type === 'EX-99.1'), 'the exhibit the phrases were in');
  assert.equal(hfs.link, 'https://www.sec.gov/Archives/edgar/data/9900101/000999999926000502/0009999999-26-000502-index.htm');
  assert.equal(hfs.link, indexUrl('0009900101', ACC.heldForSale));
  assert.deepEqual(filings[ACC.impairment].items, ['2.06', '9.01']);
  assert.equal(filings[ACC.impairment]._source.endpoint, URL_EFTS);
  assert.equal(filings[ACC.oldImpairment].fileDate, '2026-03-02', 'a new filer is searched back a year');
  assert.deepEqual(Object.keys(readJson(P(dir).proxies)), [ACC.proxy]);
  assert.deepEqual(Object.keys(readJson(P(dir).discovery)).sort(), [ACC.desertImpairment, ACC.desertRepositioning].sort(), 'not the grocer (its SIC), and not filers already mapped');
  // Requests: declared, padded, never with items; the two 8-K item searches share one request; discovery by state and bank SIC.
  assert.ok(fake.calls.every((c) => c.ua === UA));
  assert.ok(fake.calls.every((c) => !('items' in c.params)));
  assert.ok(fake.calls.filter((c) => c.params.ciks).every((c) => c.params.ciks.split(',').every((x) => /^\d{10}$/.test(x))));
  assert.deepEqual([r.requests, r.searches, r.filings, r.proxies, r.discovered], [12, 12, 5, 1, 2]);
  const disc = fake.calls.filter((c) => c.params.locationCodes);
  assert.equal(disc.length, 5);
  assert.ok(disc.every((c) => c.params.locationCodes === 'TX,CO,CA,AZ,NV' && c.params.sics === FR.discovery.sics.join(',')));
});

test('signals: one event per filing and bank, from fixed templates, newest first; discovery hits never become signals', async () => {
  const dir = await mapped();
  await run(dir);
  const sig = filingSignals({ dir, rules: FR });
  assert.deepEqual(Object.keys(sig).sort(), ['fdic:101', 'fdic:102']);
  assert.deepEqual(sig['fdic:101'].map((s) => s.accession), [ACC.heldForSale, ACC.impairment, ACC.oldImpairment]);
  const s = sig['fdic:101'][1];
  assert.deepEqual(s, {
    id: `sec-filing:${ACC.impairment}`, kind: 'event', type: 'sec_filing', source: 'filings', key: 'fdic:101', searches: ['8k-impairment'], form: '8-K', items: ['2.06', '9.01'],
    fileDate: '2026-11-10', period: '2026-11-10', accession: ACC.impairment, cik: '0009900101', link: indexUrl('0009900101', ACC.impairment),
    label: '8-K Item 2.06: material impairments (8-K, filed 2026-11-10)', evidence: [`sec:${ACC.impairment}`], firstSeenAt: NOW.toISOString(),
  });
  const everything = JSON.stringify(sig);
  for (const a of [ACC.desertImpairment, ACC.desertRepositioning, ACC.proxy]) assert.ok(!everything.includes(a), a);
  // A filer shared by two banks (the same holding company) gives both the signal; a rejected mapping takes it away.
  confirmFiler({ dir, bank: 'fdic:103', cik: '9900101', by: 'Pat Example', now: NOW });
  assert.equal(filingSignals({ dir, rules: FR })['fdic:103'].length, 3);
  const { rejectFiler } = await import('../src/sources/filers.mjs');
  rejectFiler({ dir, bank: 'fdic:101', cik: '9900101', by: 'Pat Example', reason: 'a different holding company' });
  assert.equal(filingSignals({ dir, rules: FR })['fdic:101'], undefined);
  assert.deepEqual(filingProxies({ dir })['fdic:103'], [{ form: 'DEF 14A', fileDate: '2026-04-02', accession: ACC.proxy, link: indexUrl('0009900101', ACC.proxy) }]);
});

test('events are kept: a later run keeps a filing it no longer sees, logs a new search match as a change, and never duplicates', async () => {
  const dir = await mapped();
  await run(dir);
  const docs = DOCS().filter((x) => x.adsh !== ACC.oldImpairment).map((x) => (x.adsh === ACC.impairment && x.seq === '2' ? { ...x, text: `${x.text}; a balance sheet repositioning` } : x));
  const fake = fakeSearch({ docs });
  const r = await run(dir, fake, { now: day(1) });
  assert.equal(r.outcome, 'ok', JSON.stringify(r));
  const filings = readJson(P(dir).filings);
  assert.equal(Object.keys(filings).length, 5);
  assert.ok(filings[ACC.oldImpairment], 'an event is never dropped');
  assert.deepEqual(filings[ACC.impairment].searches, ['8k-impairment', 'balance-sheet-repositioning']);
  assert.equal(filings[ACC.impairment].firstSeenAt, NOW.toISOString(), 'first seen stays first seen');
  const ch = readJsonl(join(dir, 'sources', 'changes.jsonl')).filter((c) => c.key === `sec:${ACC.impairment}`);
  assert.deepEqual(ch.map((c) => c.field).sort(), ['documents', 'searches']);
  assert.deepEqual(ch.find((c) => c.field === 'searches').old, ['8k-impairment']);
  // The second run starts three days before the first ended, not a year back.
  assert.ok(fake.calls.filter((c) => c.params.ciks && c.params.forms !== 'DEF 14A').every((c) => c.params.startdt === '2026-11-10'));
  assert.equal(r.filingsNew, 0);
});

test('a filer confirmed later is searched back a year once; --since searches every filer from that date', async () => {
  const dir = await bankList();
  confirmFiler({ dir, bank: 'fdic:101', cik: '9900101', by: 'Pat Example' });
  await run(dir);
  confirmFiler({ dir, bank: 'fdic:102', cik: '9900102', by: 'Pat Example' });
  const fake = fakeSearch();
  const r = await run(dir, fake, { now: day(1) });
  assert.equal(r.newFilers, 1);
  const prod = fake.calls.filter((c) => c.params.ciks && c.params.forms !== 'DEF 14A');
  assert.deepEqual([...new Set(prod.map((c) => `${c.params.ciks}@${c.params.startdt}`))].sort(), ['0009900101@2026-11-10', '0009900102@2025-11-14']);
  assert.deepEqual(readJson(P(dir).state).searchedFrom, { '0009900101': '2025-11-13', '0009900102': '2025-11-14' });

  const since = fakeSearch();
  await run(dir, since, { now: day(2), since: '2026-11-01' });
  assert.ok(since.calls.filter((c) => c.params.ciks && c.params.forms !== 'DEF 14A').every((c) => c.params.startdt === '2026-11-01' && c.params.ciks === '0009900101,0009900102'));
  await assert.rejects(run(dir, fakeSearch(), { since: '11/01/2026' }), /--since must be a date/);
  await assert.rejects(run(dir, fakeSearch(), { since: '2026-12-01' }), /after today/);
});

test('only confirmed filers are searched: a rejected or merely suggested filer never is', async () => {
  const dir = await bankList();
  confirmFiler({ dir, bank: 'fdic:101', cik: '9900101', by: 'Pat Example' });
  const { rejectFiler } = await import('../src/sources/filers.mjs');
  rejectFiler({ dir, bank: 'fdic:102', cik: '9900102', by: 'Pat Example' });
  writeJson(join(dir, 'sources', 'edgar', 'filer-suggestions.json'), { at: NOW.toISOString(), banks: { 'fdic:103': { candidates: [{ cik: '0009900301' }] } } });
  const fake = fakeSearch();
  await run(dir, fake);
  assert.deepEqual([...new Set(fake.calls.filter((c) => c.params.ciks).map((c) => c.params.ciks))], ['0009900101']);
});

test('the run log, the field check and the change log (PRD E2): a missing field fails the run and writes nothing', async () => {
  const dir = await mapped();
  await run(dir);
  const line = readJsonl(join(dir, 'sources', 'runs.jsonl')).at(-1);
  assert.deepEqual([line.source, line.outcome, line.rowsWritten], ['filings', 'ok', 8]);
  assert.ok(line.rowsRead > 0);
  assert.match(line.notes[0], /window 2026-11-06 to 2026-11-13/);
  assert.doesNotMatch(JSON.stringify(line), /@|Example/, 'counts and ids only');

  const fresh = await mapped();
  const r = await run(fresh, fakeSearch({ dropField: 'items' }));
  assert.equal(r.outcome, 'failed');
  assert.deepEqual(r.missingFields, ['items']);
  assert.match(r.errors[0], /did not return field\(s\): items \(absent from \d+ hits\)/);
  assert.equal(existsSync(P(fresh).filings), false, 'nothing written');
  assert.equal(existsSync(P(fresh).state), false, 'the window is not moved');
});

test('a failed search fails the whole run and leaves the window where it was', async () => {
  const dir = await mapped();
  const r = await run(dir, fakeSearch({ errorFor: (p) => /note sale/.test(p.q ?? '') }));
  assert.equal(r.outcome, 'failed');
  assert.match(r.errors[0], /answered with an error: search_phase_execution_exception/);
  assert.equal(existsSync(P(dir).filings), false);
  assert.equal(existsSync(P(dir).state), false);
  assert.equal(readJsonl(join(dir, 'sources', 'runs.jsonl')).at(-1).outcome, 'failed');
});

test('with no confirmed filer only discovery runs, the run is suspect, and a filer mapped later leaves the review list', async () => {
  const dir = await bankList();
  const r = await run(dir);
  assert.equal(r.outcome, 'suspect');
  assert.match(readJsonl(join(dir, 'sources', 'runs.jsonl')).at(-1).notes.join(), /no confirmed filers/);
  assert.deepEqual(readJson(P(dir).filings), {});
  assert.deepEqual(discoveredFilers({ dir }).map((e) => e.cik).sort(), ['0009900101', '0009900201']);
  confirmFiler({ dir, bank: 'fdic:101', cik: '9900101', by: 'Pat Example' });
  const left = discoveredFilers({ dir });
  assert.deepEqual(left.map((e) => e.cik), ['0009900201']);
  assert.deepEqual(left[0].filings.map((f) => f.accession).sort(), [ACC.desertImpairment, ACC.desertRepositioning].sort());
  assert.deepEqual(filingSignals({ dir, rules: FR }), {}, 'a for-review hit is never a signal, even once its filer is mapped');
});

test('the run refuses a placeholder User-Agent, because the SEC asks for a real contact', async () => {
  await assert.rejects(runFilings({ dir: await mapped(), sec: rules.config.sec, rules: FR, fetchImpl: fakeSearch().fetchImpl, now: NOW, sleep: nosleep }), /sec\.userAgent is a placeholder/);
});

test('nothing stored holds filing text or a person, even if the server sent text', async () => {
  const dir = await mapped();
  await run(dir, fakeSearch({ leakText: true }));
  const stored = allFiles(join(dir, 'sources'));
  assert.ok(!stored.includes(SECRET_TEXT.slice(0, 30)));
  assert.ok(!stored.includes(PERSON));
  assert.doesNotMatch(stored, /doc_text|highlight/);
});

// ---- The checks against the source -------------------------------------------------------------------------------------------
const vf = (dir, fake = fakeSearch(), over = {}) => verifyFilings({ dir, sec: SEC, rules: FR, fetchImpl: fake.fetchImpl, sleep: nosleep, now: NOW, recheck: 8, ...over });
const byId = (r) => Object.fromEntries(r.checks.map((c) => [c.id, c]));

test('verify: on clean data every check passes, stored filings come back when searched for again, and spot checks carry their link', async () => {
  const dir = await mapped();
  await run(dir);
  const r = await vf(dir);
  for (const c of r.checks) assert.equal(c.ok, true, `${c.id}: ${c.summary}`);
  assert.deepEqual(r.checks.map((c) => c.id), ['filings.fresh', 'filings.mapped', 'filings.sourced', 'filings.recall', 'filings.filers']);
  assert.equal(byId(r)['filings.recall'].detail.filings.length, 8);
  assert.match(r.sample[0].check, /^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\/\d+\/\d{18}\/\d{10}-\d{2}-\d{6}-index\.htm$/);
});

test('verify: a filing the source no longer returns, a stale run, a record with text, and an unknown filer each fail', async () => {
  const dir = await mapped();
  await run(dir);
  const gone = fakeSearch({ docs: DOCS().filter((x) => x.adsh !== ACC.heldForSale) });
  const recall = byId(await vf(dir, gone))['filings.recall'];
  assert.equal(recall.ok, false);
  assert.deepEqual(recall.detail.filings.filter((x) => !x.ok).map((x) => [x.accession, x.reason]), [[ACC.heldForSale, 'not returned']]);
  assert.match(byId(await vf(dir, fakeSearch(), { now: day(10) }))['filings.fresh'].summary, /10 days ago.*Run: outbound sources run filings/);
  const f = readJson(P(dir).filings); f[ACC.loanSale].snippet = 'a filing excerpt'; writeJson(P(dir).filings, f);
  assert.equal(byId(await vf(dir))['filings.sourced'].ok, false);
  confirmFiler({ dir, bank: 'fdic:103', cik: '9900999', by: 'Pat Example' });
  const filers = byId(await vf(dir))['filings.filers'];
  assert.equal(filers.ok, false); assert.deepEqual(filers.detail.gone, ['0009900999']);
});

test('verify: nothing run yet, no confirmed filer, or a placeholder contact each fail and say what to do', async () => {
  assert.match((await vf(makeDir())).checks[0].summary, /Run: outbound sources run filings/);
  const none = await bankList();
  await run(none);
  assert.match(byId(await vf(none))['filings.mapped'].summary, /outbound filers suggest/);
  const dir = await mapped();
  await run(dir);
  const r = byId(await vf(dir, fakeSearch(), { sec: rules.config.sec }));
  assert.equal(r['filings.recall'].ok, false); assert.match(r['filings.recall'].summary, /placeholder/);
});

// ---- The worker ----------------------------------------------------------------------------------------------------------------
test('the listener runs as a job: refused while the SEC contact is a placeholder, then through a unit of work, with counts only', async () => {
  const { fakePostgrest } = await import('./postgrest-fake.mjs');
  const { platformClient } = await import('../src/platform/client.mjs');
  const { work, JOB_KINDS } = await import('../src/platform/worker.mjs');
  const { push } = await import('../src/platform/move.mjs');
  assert.ok(JOB_KINDS.includes('sources.filings'));
  const fake = fakePostgrest();
  const worker = platformClient({ url: 'https://example-project.supabase.test', key: 'service', fetchImpl: fake.fetchImpl });
  await push({ client: worker, dir: await mapped() });
  const queue = () => fake.jobs.push({ id: fake.jobs.length + 1, kind: 'sources.filings', params: {}, status: 'queued', requested_by: 'pat@example.test', result: null });
  const deps = { fetchImpl: fakeSearch().fetchImpl, now: () => NOW, sleep: nosleep };
  queue();
  await work({ client: worker, rules, deps });
  assert.equal(fake.jobs[0].status, 'failed');
  assert.match(fake.jobs[0].result.error, /sec\.userAgent is a placeholder/);

  queue();
  const filled = { ...rules, filings: FR, config: { ...rules.config, sec: SEC } };
  const done = await work({ client: worker, rules: filled, deps });
  assert.deepEqual(done.map((d) => [d.kind, d.outcome]), [['sources.filings', 'done']]);
  assert.deepEqual([fake.jobs[1].result.outcome, fake.jobs[1].result.filings, fake.jobs[1].result.proxies, fake.jobs[1].result.discovered], ['ok', 5, 1, 2]);
  assert.ok(fake.docs.has('sources/edgar/filings.json') && fake.docs.has('sources/edgar/filings-state.json'));
  assert.doesNotMatch(JSON.stringify(fake.jobs[1].result), /Example|EXAMPLE|0009/, 'the job result holds counts, not names or ids');
});
