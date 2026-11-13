// PRD E12-S3: the engine's client for the platform database, against a fake Supabase REST API (test/postgrest-fake.mjs). The SQL rules
// it relies on are tested against a real Postgres in test/db.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { platformClient, pathFilter, ConflictError, PlatformError } from '../src/platform/client.mjs';
import { LOADS } from '../src/uow.mjs';
import { readJson, writeJson } from '../src/store.mjs';
import { promote } from '../src/candidates.mjs';
import { fakePostgrest } from './postgrest-fake.mjs';

const URL_ = 'https://example-project.supabase.test';
const asPat = (fake, over = {}) => platformClient({ url: URL_, key: 'anon-key', accessToken: 'user:pat@example.test', fetchImpl: fake.fetchImpl, ...over });
const asWorker = (fake, over = {}) => platformClient({ url: URL_, key: 'service', fetchImpl: fake.fetchImpl, ...over });
const seedDoc = (fake, path, body, version = 1) => fake.docs.set(path, { path, kind: 'json', body, text: null, version });

test('the path filter takes folders by prefix and files exactly, and escapes LIKE wildcards in a prefix', () => {
  assert.equal(pathFilter(['accounts/', 'senders.json']), '(path.like."accounts/*",path.eq."senders.json")');
  assert.equal(pathFilter(['a_b/']), '(path.like."a\\\\_b/*")');
  assert.equal(pathFilter(['']), null);
  assert.equal(pathFilter([]), null);
});

test('load returns only what the prefixes cover, with versions, texts and log lines', async () => {
  const fake = fakePostgrest();
  seedDoc(fake, 'accounts/acme.json', { id: 'acme' }, 4);
  seedDoc(fake, 'senders.json', { senders: [] }, 2);
  seedDoc(fake, 'research/acme.json', { secret: 'not loaded' });
  fake.docs.set('accounts/notes.md', { path: 'accounts/notes.md', kind: 'text', body: null, text: 'hello', version: 1 });
  fake.lines.push({ id: 1, path: 'touches.jsonl', line: { type: 'touch' }, by: 'x' }, { id: 2, path: 'audit.jsonl', line: { type: 'a' }, by: 'x' });
  const snap = await asPat(fake).load(['accounts/', 'senders.json', 'touches.jsonl']);
  assert.deepEqual(Object.keys(snap.docs).sort(), ['accounts/acme.json', 'senders.json']);
  assert.deepEqual(snap.texts, { 'accounts/notes.md': 'hello' });
  assert.deepEqual(snap.logs, { 'touches.jsonl': [{ type: 'touch' }] });
  assert.equal(snap.versions['accounts/acme.json'], 4);
});

test('load pages through more rows than one response holds', async () => {
  const fake = fakePostgrest();
  for (let i = 0; i < 7; i++) seedDoc(fake, `accounts/a${i}.json`, { i });
  const snap = await asPat(fake, { pageSize: 3 }).load(['accounts/']);
  assert.equal(Object.keys(snap.docs).length, 7);
  assert.equal(fake.calls.filter((c) => c.path === 'documents').length, 3);
});

test('a unit of work runs the engine against the database and writes the change back with versions', async () => {
  const fake = fakePostgrest();
  seedDoc(fake, 'accounts/acme.json', { id: 'acme', tier: 'B' }, 5);
  const c = asPat(fake);
  const { result, plan } = await c.unitOfWork(LOADS.account, (dir) => {
    const a = readJson(join(dir, 'accounts', 'acme.json'));
    a.tier = 'A';
    writeJson(join(dir, 'accounts', 'acme.json'), a);
    return a.tier;
  });
  assert.equal(result, 'A');
  assert.equal(plan.docs[0].baseVersion, 5);
  assert.deepEqual(fake.docs.get('accounts/acme.json'), { path: 'accounts/acme.json', kind: 'json', body: { id: 'acme', tier: 'A' }, text: null, version: 6, updated_by: 'pat@example.test' });
});

test('a conflict reloads and runs again once by default; with retries 0 it is reported, never repeated', async () => {
  const fake = fakePostgrest();
  seedDoc(fake, 'accounts/acme.json', { id: 'acme', n: 0 }, 1);
  let runs = 0;
  const bump = (dir) => { runs++; const a = readJson(join(dir, 'accounts', 'acme.json')); a.n += 1; writeJson(join(dir, 'accounts', 'acme.json'), a); };
  fake.hooks.beforeFlush = () => seedDoc(fake, 'accounts/acme.json', { id: 'acme', n: 10 }, 2);   // someone else saves first
  await asPat(fake).unitOfWork(LOADS.account, bump);
  assert.equal(runs, 2);
  assert.equal(fake.docs.get('accounts/acme.json').body.n, 11, 'the second run started from the other person\'s change');

  runs = 0;
  fake.hooks.beforeFlush = () => seedDoc(fake, 'accounts/acme.json', { id: 'acme', n: 50 }, 4);
  await assert.rejects(asPat(fake).unitOfWork(LOADS.account, bump, { retries: 0 }), (e) => e instanceof ConflictError && /changed since it was loaded/.test(e.message));
  assert.equal(runs, 1);
  assert.equal(fake.docs.get('accounts/acme.json').body.n, 50, 'nothing was written');
});

test('promote runs through the platform exactly as it does on a folder', async () => {
  const fake = fakePostgrest();
  const item = { key: 'fdic:1', cert: '1', name: 'Example Bank', tier: 'A', score: 70, axes: { distress: 30, fit: 30, timing: 10 }, metros: ['31080'], sectors: ['multifamily'], filtersFailed: [], signals: [{ id: 'fdic:1:cre-noncurrent-rising:20260630' }], profile: { categories: [] }, latestRepdte: '20260630', card: { text: 'card' } };
  const c = asPat(fake);
  await c.flush({ docs: [{ path: 'candidates/latest.json', kind: 'json', body: { runId: 'score-1', items: [item] }, baseVersion: 0 }], lines: [] });
  const { result } = await c.unitOfWork(LOADS.candidates, (dir) => promote({ dir, key: 'fdic:1', by: 'Pat Example' }));
  assert.equal(result.id, 'example-bank');
  assert.equal(fake.docs.get('accounts/example-bank.json').body.institutionKey, 'fdic:1');
  assert.equal(fake.docs.get('candidates/decisions.json').body['fdic:1'].status, 'promoted');
  assert.ok(fake.lines.some((l) => l.path === 'audit.jsonl' && l.line.type === 'candidate_promoted' && l.by === 'pat@example.test'));
  assert.deepEqual((await c.candidates({ tier: 'A', metro: '31080' })).map((r) => r.key), ['fdic:1']);
  assert.equal((await c.candidate('fdic:1')).name, 'Example Bank');
});

test('the job queue through the client: a principal queues, the worker claims and finishes', async () => {
  const fake = fakePostgrest();
  const id = await asPat(fake).enqueue('score.run', { draftBuybox: true });
  await assert.rejects(asPat(fake).claimJob(), (e) => e instanceof PlatformError && e.code === '42501');
  await assert.rejects(asPat(fake).enqueue('send.email'), PlatformError);
  const job = await asWorker(fake).claimJob();
  assert.deepEqual([job.id, job.kind, job.status, job.requested_by], [id, 'score.run', 'running', 'pat@example.test']);
  assert.equal(await asWorker(fake).claimJob(), null);
  await asWorker(fake).finishJob(id, true, { banks: 268 });
  assert.equal(fake.jobs[0].status, 'done');
});

test('someone who is not a principal reads nothing and cannot write', async () => {
  const fake = fakePostgrest();
  seedDoc(fake, 'accounts/acme.json', { id: 'acme' });
  const stranger = platformClient({ url: URL_, key: 'anon-key', accessToken: 'user:someone@example.test', fetchImpl: fake.fetchImpl });
  assert.deepEqual(await stranger.load(['accounts/']), { docs: {}, texts: {}, logs: {}, versions: {} });
  await assert.rejects(stranger.flush({ docs: [], lines: [] }), (e) => e.code === '42501');
  assert.throws(() => platformClient({ url: URL_ }), /needs the project URL and a key/);
});
