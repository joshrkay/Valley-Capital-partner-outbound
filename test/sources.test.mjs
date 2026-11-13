// The ingestion framework (PRD E2): the polite HTTP client, the run log, provenance and amend-aware updates. No network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { getJson, buildUrl, pacer, HttpError } from '../src/sources/http.mjs';
import { startRun, finishRun, sourceBlock, assertSourced, upsertWithChanges, scrub, RUNS, CHANGES } from '../src/sources/runlog.mjs';
import { readJsonl } from '../src/store.mjs';
import { makeDir } from './kit.mjs';

const json = (body, status = 200, headers = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

// A fetch that answers from a script: each entry is a Response, an Error to throw, or a function of the URL.
function scripted(steps) {
  const calls = [];
  let i = 0;
  const fetchImpl = async (url) => {
    calls.push(url);
    const s = steps[Math.min(i++, steps.length - 1)];
    if (s instanceof Error) throw s;
    return typeof s === 'function' ? s(url) : s.clone();
  };
  return { fetchImpl, calls };
}

const recorder = () => { const waits = []; return { waits, sleep: async (ms) => { waits.push(ms); } }; };

test('getJson: returns parsed JSON and builds the query string, skipping empty params', async () => {
  const { fetchImpl, calls } = scripted([json({ ok: 1 })]);
  assert.deepEqual(await getJson('https://example.test/x', { a: 'b c', skip: undefined, none: '' }, { fetchImpl }), { ok: 1 });
  assert.equal(calls[0], 'https://example.test/x?a=b+c');
  assert.equal(buildUrl('https://example.test/y', { n: 0 }), 'https://example.test/y?n=0');
});

test('getJson: retries 5xx with doubling backoff, then succeeds', async () => {
  const { fetchImpl, calls } = scripted([json({}, 503), json({}, 502), json({ done: true })]);
  const r = recorder();
  assert.deepEqual(await getJson('https://example.test/x', {}, { fetchImpl, sleep: r.sleep, backoffMs: 10 }), { done: true });
  assert.equal(calls.length, 3);
  assert.deepEqual(r.waits, [10, 20]);
});

test('getJson: a 4xx other than 429 fails at once, without retrying', async () => {
  const { fetchImpl, calls } = scripted([json({ error: 'bad' }, 400)]);
  await assert.rejects(getJson('https://example.test/x', {}, { fetchImpl, sleep: async () => {} }), (e) => e instanceof HttpError && e.status === 400 && e.attempts === 1);
  assert.equal(calls.length, 1);
});

test('getJson: 429 honors Retry-After, capped by maxBackoffMs', async () => {
  const { fetchImpl } = scripted([json({}, 429, { 'retry-after': '120' }), json({ ok: true })]);
  const r = recorder();
  await getJson('https://example.test/x', {}, { fetchImpl, sleep: r.sleep, maxBackoffMs: 5000 });
  assert.deepEqual(r.waits, [5000]);
});

test('getJson: network errors are retried; exhausting retries throws with the attempt count', async () => {
  const ok = scripted([new TypeError('socket hang up'), json({ ok: true })]);
  assert.deepEqual(await getJson('https://example.test/x', {}, { fetchImpl: ok.fetchImpl, sleep: async () => {} }), { ok: true });
  const bad = scripted([json({}, 500)]);
  await assert.rejects(getJson('https://example.test/x', {}, { fetchImpl: bad.fetchImpl, sleep: async () => {}, retries: 2 }), (e) => e.status === 500 && e.attempts === 3);
  assert.equal(bad.calls.length, 3);
});

test('getJson: a non-JSON body is a clear error', async () => {
  const { fetchImpl } = scripted([new Response('<html>maintenance</html>', { status: 200 })]);
  await assert.rejects(getJson('https://example.test/x', {}, { fetchImpl }), /not JSON/);
});

test('pacer: spaces calls at least minIntervalMs apart', async () => {
  let clock = 1000;
  const waits = [];
  const pace = pacer(200, { now: () => clock, sleep: async (ms) => { waits.push(ms); clock += ms; } });
  await pace(); clock += 50; await pace(); await pace();
  assert.deepEqual(waits, [150, 200]);
});

test('run log: one line per run; outcome ok, then suspect when a run reads nothing after a run of the same query that read rows', () => {
  const dir = makeDir();
  const q = { metros: ['12420'] };
  finishRun(dir, startRun({ source: 'fdic', query: q }), { rowsRead: 5, rowsWritten: 5 });
  const second = finishRun(dir, startRun({ source: 'fdic', query: q }), { rowsRead: 0 });
  const otherQuery = finishRun(dir, startRun({ source: 'fdic', query: { metros: ['99999'] } }), { rowsRead: 0 });
  const flagged = finishRun(dir, startRun({ source: 'fdic', query: q }), { rowsRead: 3, suspect: true });
  const failed = finishRun(dir, startRun({ source: 'fdic', query: q }), { rowsRead: 0, outcome: 'failed', errors: ['boom'] });
  const lines = readJsonl(RUNS(dir));
  assert.equal(lines.length, 5);
  assert.equal(lines[0].outcome, 'ok');
  assert.equal(second.outcome, 'suspect');
  assert.equal(otherQuery.outcome, 'ok', 'a different query has no history to compare with');
  assert.equal(flagged.outcome, 'suspect');
  assert.equal(failed.outcome, 'failed');
  for (const k of ['runId', 'source', 'query', 'startedAt', 'finishedAt', 'rowsRead', 'rowsWritten', 'rowsChanged', 'outcome', 'missingFields', 'errors']) assert.ok(k in lines[0], k);
});

test('run log: never contains an email address or a phone number', () => {
  const dir = makeDir();
  finishRun(dir, startRun({ source: 'fdic', query: {} }), { outcome: 'failed', errors: ['contact jordan@acmebank.test or (555) 010-0199 or 555.010.0123'], notes: ['call +1 555 010 0100'] });
  const raw = readFileSync(RUNS(dir), 'utf8');
  assert.doesNotMatch(raw, /@/);
  assert.doesNotMatch(raw, /\d{3}[\s.-]\d{4}/);
  assert.match(raw, /\[redacted\]/);
  assert.equal(scrub('REPDTE 20260630 CERT 3511'), 'REPDTE 20260630 CERT 3511', 'codes and dates are not mistaken for phone numbers');
});

test('provenance: a source block needs every field, and a record without one is rejected', () => {
  const ok = sourceBlock({ source: 'fdic', endpoint: '/financials', query: { filters: 'CERT:1' }, recordId: 1, period: 20260630, fetchedAt: '2026-11-13T00:00:00Z', runId: 'r1' });
  assert.equal(ok.recordId, '1');
  assert.equal(ok.period, '20260630');
  assert.throws(() => sourceBlock({ source: 'fdic', endpoint: '/financials', query: {}, recordId: '1', period: '', fetchedAt: 'x', runId: 'r1' }), /period/);
  assert.throws(() => assertSourced({ CERT: '1' }), /no _source/);
  assert.throws(() => assertSourced({ _source: { source: 'fdic' } }), /missing/);
});

test('upsert: inserts quietly, logs amended values with old and new, ignores unchanged and new fields', () => {
  const dir = makeDir();
  const src = (runId) => ({ source: 'fdic', endpoint: '/financials', query: {}, recordId: 'x', period: '20260630', fetchedAt: '2026-11-13T00:00:00Z', runId });
  const first = upsertWithChanges(undefined, { A: 1, B: 2, _source: src('r1') }, { key: 'fdic:1:20260630', runId: 'r1', dir });
  assert.equal(first.changed, 0);
  assert.equal(existsSync(CHANGES(dir)), false);
  const second = upsertWithChanges(first.record, { A: 1, B: 3, C: 4, _source: src('r2') }, { key: 'fdic:1:20260630', runId: 'r2', dir });
  assert.equal(second.changed, 1);
  assert.deepEqual({ A: second.record.A, B: second.record.B, C: second.record.C, run: second.record._source.runId }, { A: 1, B: 3, C: 4, run: 'r2' });
  const changes = readJsonl(CHANGES(dir));
  assert.equal(changes.length, 1);
  assert.deepEqual({ key: changes[0].key, field: changes[0].field, old: changes[0].old, new: changes[0].new, runId: changes[0].runId }, { key: 'fdic:1:20260630', field: 'B', old: 2, new: 3, runId: 'r2' });
  assert.throws(() => upsertWithChanges(first.record, { A: 9 }, { key: 'k', runId: 'r3', dir }), /no _source/);
});
