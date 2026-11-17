// PRD E12-S3: the engine's client for the platform database, against a fake Supabase REST API (test/postgrest-fake.mjs). The SQL rules
// it relies on are tested against a real Postgres in test/db.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { platformClient, pathFilter, ConflictError, PlatformError, isJwt, flushBatches, FLUSH_BATCH_BYTES } from '../src/platform/client.mjs';
import { LOADS } from '../src/uow.mjs';
import { readJson, writeJson, appendJsonl } from '../src/store.mjs';
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

test('headers: a JWT key also goes in Authorization; a new-style key goes in apikey only; a session token always wins', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => { seen.push(init.headers); return new Response('[]', { status: 200 }); };
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.c2ln';
  await platformClient({ url: URL_, key: jwt, fetchImpl }).candidates();
  await platformClient({ url: URL_, key: 'sb_publishable_abc123', fetchImpl }).candidates();
  await platformClient({ url: URL_, key: 'sb_publishable_abc123', accessToken: 'user-session-jwt', fetchImpl }).candidates();
  assert.deepEqual([seen[0].apikey, seen[0].Authorization], [jwt, `Bearer ${jwt}`]);
  assert.deepEqual([seen[1].apikey, seen[1].Authorization], ['sb_publishable_abc123', undefined]);
  assert.equal(seen[2].Authorization, 'Bearer user-session-jwt');
  assert.equal(isJwt(jwt), true); assert.equal(isJwt('sb_secret_x'), false);
});

// PRD E7-S3: a deletion request's log redactions, through the platform. The fake applies the same rules as flush_uow (test/db.test.mjs).
test('redactions: applied to the matching log line; anything but "[removed]" on an unprotected key is refused; an old database is caught', async () => {
  const fake = fakePostgrest();
  fake.lines.push({ id: 1, path: 'touches.jsonl', line: { type: 'reply', accountId: 'acme', date: '2026-11-11', note: 'Jordan replied' }, by: 'x' });
  const c = asPat(fake);
  const old = { type: 'reply', accountId: 'acme', date: '2026-11-11', note: 'Jordan replied' };
  await assert.rejects(c.flush({ docs: [], lines: [], redactions: [{ path: 'touches.jsonl', old, new: { ...old, type: '[removed]' } }] }), (e) => e.code === '42501');
  await assert.rejects(c.flush({ docs: [], lines: [], redactions: [{ path: 'touches.jsonl', old, new: { ...old, note: 'someone' } }] }), (e) => e.code === '42501');
  await assert.rejects(c.flush({ docs: [], lines: [], redactions: [{ path: 'audit.jsonl', old, new: { ...old, note: '[removed]' } }] }), (e) => e.code === '42501');
  await assert.rejects(c.flush({ docs: [], lines: [], redactions: [{ path: 'touches.jsonl', old: { ...old, note: 'gone' }, new: { ...old, note: '[removed]' } }] }), ConflictError);
  const r = await c.flush({ docs: [], lines: [], redactions: [{ path: 'touches.jsonl', old, new: { ...old, note: '[removed]' } }] });
  assert.equal(r.redacted, 1);
  assert.deepEqual(fake.lines[0].line, { type: 'reply', accountId: 'acme', date: '2026-11-11', note: '[removed]' });
  // A database without the redaction migration ignores the key and answers without "redacted": the client refuses to call it done.
  const legacy = async (url, init) => (String(url).endsWith('rpc/flush_uow') ? new Response(JSON.stringify({ written: 0, appended: 0 }), { status: 200 }) : fake.fetchImpl(url, init));
  await assert.rejects(asPat(fake, { fetchImpl: legacy }).flush({ docs: [], lines: [], redactions: [{ path: 'touches.jsonl', old, new: old }] }), /redaction migration/);
  await asPat(fake, { fetchImpl: legacy }).flush({ docs: [], lines: [] });   // a plan without redactions is unaffected
});

// A large flush in batches (a weekly scoring run is about 41 MB). A plan shaped like a scoring run's, with invented banks: the
// candidate list, a paper record per bank, a regulatory record and the run's audit line, in the engine's order (sorted by path).
const scoringPlan = (n = 12, pad = 600) => {
  const items = Array.from({ length: n }, (_, i) => ({ key: `fdic:${90001 + i}`, cert: String(90001 + i), name: `Example Bank ${i + 1}`, tier: i < 2 ? 'A' : 'B', score: 80 - i, axes: { distress: 30, fit: 30, timing: 20 - i }, metros: ['31080'], sectors: ['multifamily'], filtersFailed: [], latestRepdte: '20260630', card: { text: `Example Bank ${i + 1}` } }));
  return {
    docs: [
      { path: 'candidates/latest.json', kind: 'json', body: { runId: 'score-1', items }, baseVersion: 0 },
      ...items.map((it) => ({ path: `paper/fdic-${it.cert}.json`, kind: 'json', body: { cert: it.cert, name: it.name, runId: 'score-1', notes: 'x'.repeat(pad) }, baseVersion: 0 })),
      { path: 'regulatory/fdic-90001.json', kind: 'json', body: { orders: [] }, baseVersion: 0 },
    ],
    lines: [{ path: 'audit.jsonl', line: { type: 'scoring_run', runId: 'score-1', banks: n } }],
  };
};
const LIMIT = 4000;   // small enough that the plan above needs several calls; its candidate list (about 3 KB) still fits in one
const size = (plan) => Buffer.byteLength(JSON.stringify(plan));
// Each flush_uow call as it was sent, with what the database held at that moment.
const recordFlushes = (fake) => {
  const sent = [];
  const fetchImpl = async (url, init) => {
    if (String(url).endsWith('rpc/flush_uow')) sent.push({ body: init.body, plan: JSON.parse(init.body).plan, stored: [...fake.docs.keys()], candidates: fake.candidates.size, lines: fake.lines.length });
    return fake.fetchImpl(url, init);
  };
  return { sent, fetchImpl };
};

test('a plan within the batch limit is one flush_uow call, sent exactly as before', async () => {
  const fake = fakePostgrest();
  const rec = recordFlushes(fake);
  const plan = scoringPlan();
  assert.ok(size(plan) < FLUSH_BATCH_BYTES && size(plan) > LIMIT);
  const res = await asWorker(fake, { fetchImpl: rec.fetchImpl }).flush(plan);
  assert.equal(rec.sent.length, 1);
  assert.equal(rec.sent[0].body, JSON.stringify({ plan }));
  assert.deepEqual(res, { written: plan.docs.length, appended: 1, redacted: 0 }, 'the database\'s answer, as it is');
  assert.equal(flushBatches(plan)[0], plan);
  assert.equal(flushBatches(plan).length, 1);
});

test('a larger plan goes in batches under the limit: every document once, the candidate list and the log lines last', async () => {
  const fake = fakePostgrest();
  const rec = recordFlushes(fake);
  const plan = scoringPlan();
  const res = await asWorker(fake, { fetchImpl: rec.fetchImpl, flushBatchBytes: LIMIT }).flush(plan);
  assert.ok(rec.sent.length >= 3, `${rec.sent.length} calls`);
  for (const s of rec.sent) assert.ok(size(s.plan) <= LIMIT, `a call of ${size(s.plan)} bytes`);
  const written = rec.sent.flatMap((s) => s.plan.docs.map((d) => d.path));
  assert.deepEqual([...written].sort(), plan.docs.map((d) => d.path).sort(), 'every document, each once');
  const last = rec.sent.at(-1);
  assert.deepEqual(last.plan.docs.map((d) => d.path), ['candidates/latest.json']);
  assert.deepEqual(last.plan.lines, plan.lines);
  for (const s of rec.sent.slice(0, -1)) assert.deepEqual(s.plan.lines, []);
  // When the last call went out, every other document was saved, and the Candidates page and the log had not changed yet.
  assert.deepEqual(plan.docs.map((d) => d.path).filter((p) => p !== 'candidates/latest.json' && !last.stored.includes(p)), []);
  assert.deepEqual([last.candidates, last.lines], [0, 0]);
  for (const d of plan.docs) assert.equal(fake.docs.get(d.path).version, 1);
  assert.equal(fake.candidates.size, 12);
  assert.deepEqual(fake.lines.map((l) => l.line.type), ['scoring_run']);
  assert.deepEqual(res, { written: plan.docs.length, appended: 1, redacted: 0, batches: rec.sent.length });
  // A document larger than the limit is never split: it goes whole, on its own.
  const big = { path: 'paper/fdic-99999.json', kind: 'json', body: { notes: 'y'.repeat(LIMIT) }, baseVersion: 0 };
  const batches = flushBatches({ ...plan, docs: [...plan.docs, big] }, LIMIT);
  assert.deepEqual(batches.filter((b) => b.docs.includes(big)).map((b) => b.docs.length), [1]);
  assert.deepEqual(batches.at(-1).docs.map((d) => d.path), ['candidates/latest.json']);
});

test('a batch that fails stops the flush with its error: the batches before it stay written, nothing after is sent', async () => {
  const plan = scoringPlan();
  const second = flushBatches(plan, LIMIT)[1].docs[0].path;
  // A conflict: someone else saved a document of the second batch since the run loaded it. It stays a ConflictError.
  const fake = fakePostgrest();
  seedDoc(fake, second, { cert: 'edited elsewhere' }, 1);
  const rec = recordFlushes(fake);
  await assert.rejects(asWorker(fake, { fetchImpl: rec.fetchImpl, flushBatchBytes: LIMIT }).flush(plan), (e) => e instanceof ConflictError && e.code === '40001' && e.message.includes(second));
  assert.equal(rec.sent.length, 2, 'nothing after the failed batch is sent');
  for (const d of rec.sent[0].plan.docs) assert.equal(fake.docs.get(d.path)?.version, 1, `${d.path}: the first batch stays written`);
  for (const d of rec.sent[1].plan.docs.filter((x) => x.path !== second)) assert.equal(fake.docs.has(d.path), false, `${d.path}: the failed batch wrote nothing`);
  assert.equal(fake.docs.has('candidates/latest.json'), false);
  assert.deepEqual([fake.candidates.size, fake.lines.length], [0, 0], 'the Candidates page and the log are unchanged');
  // Any other failure surfaces as it does for a single call: here a statement timeout on the second call.
  const fake2 = fakePostgrest();
  let n = 0;
  const failing = async (url, init) => (String(url).endsWith('rpc/flush_uow') && ++n === 2 ? new Response(JSON.stringify({ code: '57014', message: 'canceling statement due to statement timeout' }), { status: 500 }) : fake2.fetchImpl(url, init));
  await assert.rejects(asWorker(fake2, { fetchImpl: failing, flushBatchBytes: LIMIT }).flush(plan), (e) => e instanceof PlatformError && !(e instanceof ConflictError) && e.code === '57014' && e.status === 500 && /statement timeout/.test(e.message));
  assert.equal(n, 2);
  assert.deepEqual([fake2.candidates.size, fake2.lines.length], [0, 0]);
});

test('a conflict partway through a large flush: the unit of work loads again, sees the saved batches\' versions, and finishes', async () => {
  const fake = fakePostgrest();
  const template = scoringPlan();
  for (const d of template.docs) seedDoc(fake, d.path, d.body, 1);   // last week's run
  let runs = 0, flushes = 0, edited = null;
  const fetchImpl = async (url, init) => {   // someone else saves the first document of the second call, just before it is sent
    if (String(url).endsWith('rpc/flush_uow') && ++flushes === 2) { edited = JSON.parse(init.body).plan.docs[0].path; seedDoc(fake, edited, { cert: 'edited elsewhere' }, 5); }
    return fake.fetchImpl(url, init);
  };
  const { plan } = await asWorker(fake, { fetchImpl, flushBatchBytes: LIMIT }).unitOfWork(LOADS.score, (dir) => {
    runs++;
    for (const d of template.docs) writeJson(join(dir, ...d.path.split('/')), { ...d.body, runId: 'score-2' });
    appendJsonl(join(dir, 'audit.jsonl'), { type: 'scoring_run', runId: 'score-2', banks: 12 });
  });
  assert.equal(runs, 2);
  const firstBatch = flushBatches(plan, LIMIT)[0].docs.map((d) => d.path);
  for (const p of firstBatch) assert.equal(plan.docs.find((d) => d.path === p).baseVersion, 2, `${p}: written by the first try, reloaded`);
  assert.equal(plan.docs.find((d) => d.path === edited).baseVersion, 5);
  assert.equal(fake.docs.get('candidates/latest.json').body.runId, 'score-2');
  assert.equal(fake.candidates.size, 12);
  assert.deepEqual(fake.lines.map((l) => l.line.runId), ['score-2'], 'the log records the run once, when its writes are in');
});

test('a gateway error page (HTML, not JSON) is reported with its HTTP status, not as a parse error', async () => {
  const fetchImpl = async () => new Response('<html><body>522: Connection timed out</body></html>', { status: 522, headers: { 'content-type': 'text/html' } });
  const client = platformClient({ url: 'https://example-project.supabase.test', key: 'sb_secret_example', fetchImpl });
  await assert.rejects(client.flush({ docs: [], lines: [] }), (e) => e instanceof PlatformError && e.status === 522 && /HTTP 522/.test(e.message));
});
