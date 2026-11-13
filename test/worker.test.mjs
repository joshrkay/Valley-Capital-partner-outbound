// PRD E12-S4 and E12-S6: the worker runs queued jobs through units of work, and data moves between a folder and the platform. Against
// the fake Supabase REST API and the fake FDIC server; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { makeDir, put, REPO } from './kit.mjs';
import { fakePostgrest } from './postgrest-fake.mjs';
import { fakeFdic, METROS, TABLES } from './fdic-fake.mjs';
import { platformClient } from '../src/platform/client.mjs';
import { work, runJob } from '../src/platform/worker.mjs';
import { push, pull } from '../src/platform/move.mjs';
import { snapshotFromDir } from '../src/uow.mjs';
import { loadRules } from '../src/rules.mjs';
import { runFdic } from '../src/sources/fdic.mjs';
import { runScoring } from '../src/score.mjs';

const rules = loadRules();
const NOW = new Date('2026-11-13T12:00:00Z');
const URL_ = 'https://example-project.supabase.test';
const pat = (fake) => platformClient({ url: URL_, key: 'anon-key', accessToken: 'user:pat@example.test', fetchImpl: fake.fetchImpl });
const worker = (fake) => platformClient({ url: URL_, key: 'service', fetchImpl: fake.fetchImpl });
// The worker uses the real rule files. The fake FDIC server only has banks in three of the six metros; queries for the others return
// nothing, as the real API would for a metro with no branches.
const testRules = rules;
const deps = (over = {}) => ({ fetchImpl: fakeFdic(TABLES()).fetchImpl, now: () => NOW, ...over });

test('a principal queues the FDIC pull and scoring; the worker runs both and the candidate list appears', async () => {
  const fake = fakePostgrest();
  await pat(fake).enqueue('sources.fdic');
  await pat(fake).enqueue('score.run', { draftBuybox: true });
  const logged = [];
  const done = await work({ client: worker(fake), rules: testRules, deps: deps(), log: (l) => logged.push(l) });
  assert.deepEqual(done.map((d) => [d.kind, d.outcome]), [['sources.fdic', 'done'], ['score.run', 'done']]);
  assert.ok(fake.docs.has('sources/fdic/institutions.json'));
  assert.ok(fake.docs.has('candidates/latest.json'));
  assert.ok(fake.candidates.size > 0, 'the projection was filled');
  const [fdicJob, scoreJob] = fake.jobs;
  assert.equal(fdicJob.result.outcome, 'ok');
  assert.equal(scoreJob.result.provisional, true);
  assert.equal(typeof scoreJob.result.tierA, 'number');
  // What the worker prints, which lands in scheduled-job logs, is ids, kinds and outcomes only.
  assert.deepEqual(logged, [`job ${fdicJob.id} sources.fdic done`, `job ${scoreJob.id} score.run done`]);
  for (const j of fake.jobs) assert.doesNotMatch(JSON.stringify(j.result), /Example|Bank/, 'no institution name in a job result');
});

test('scoring with an unfilled buy box fails the job with the reason, and writes nothing', async () => {
  const fake = fakePostgrest();
  await pat(fake).enqueue('sources.fdic');
  await pat(fake).enqueue('score.run');
  const done = await work({ client: worker(fake), rules: testRules, deps: deps() });
  assert.deepEqual(done.map((d) => d.outcome), ['done', 'failed']);
  assert.match(fake.jobs[1].result.error, /\[CONFIRM\] placeholders/);
  assert.equal(fake.docs.has('candidates/latest.json'), false);
});

test('research needs a model key, and a pipeline account waits for the pilot without spending anything', async () => {
  const fake = fakePostgrest();
  await pat(fake).flush({ docs: [{ path: 'accounts/acme-bank.json', kind: 'json', body: { id: 'acme-bank', name: 'Acme', type: 'bank', originSignals: ['s1'], person: {} }, baseVersion: 0 }], lines: [] });
  await pat(fake).enqueue('research.run', { account: 'acme-bank' });
  await work({ client: worker(fake), rules, deps: deps() });
  assert.equal(fake.jobs[0].status, 'failed');
  assert.match(fake.jobs[0].result.error, /needs ANTHROPIC_API_KEY/);

  let modelCalls = 0;
  const model = { messages: { create: async () => { modelCalls++; } }, beta: { messages: { create: async () => { modelCalls++; } } } };
  await pat(fake).enqueue('research.run', { account: 'acme-bank' });
  await work({ client: worker(fake), rules, deps: deps({ makeModelClient: async () => model }) });
  assert.equal(fake.jobs[1].status, 'failed');
  assert.equal(fake.jobs[1].result.reason, 'pilot_gate');
  assert.equal(modelCalls, 0, 'the gate refused before any model call');
});

test('bad job parameters fail plainly', async () => {
  const fake = fakePostgrest();
  const model = async () => ({});
  await assert.rejects(runJob({ client: worker(fake), job: { kind: 'research.run', params: { account: '../etc' } }, rules, deps: deps({ makeModelClient: model }) }), /valid account id/);
  await assert.rejects(runJob({ client: worker(fake), job: { kind: 'draft.run', params: { account: 'a', channel: 'sms' } }, rules, deps: deps({ makeModelClient: model }) }), /needs a channel/);
  await assert.rejects(runJob({ client: worker(fake), job: { kind: 'send.email', params: {} }, rules }), /Unknown job kind/);
});

// A real data folder, made by the FDIC pull and scoring on the fake server.
async function dataFolder() {
  const dir = makeDir();
  await runFdic({ dir, metros: METROS, fetchImpl: fakeFdic(TABLES()).fetchImpl, quarters: 2, sleep: async () => {}, minIntervalMs: 0, now: NOW });
  runScoring({ dir, buybox: rules.buybox, scoring: rules.scoring, metros: rules.metros, now: NOW, allowPlaceholders: true });
  put(dir, 'briefs/acme-bank.md', '# Brief: Acme\n');
  return dir;
}

test('push copies a folder in; a second push changes nothing; pull writes the same folder back out', async () => {
  const fake = fakePostgrest();
  const dir = await dataFolder();
  const first = await push({ client: worker(fake), dir, chunkBytes: 2_000 });
  assert.ok(first.written > 5); assert.ok(first.requests > 1, 'large folders go in several requests'); assert.ok(first.appended > 0);
  assert.ok(fake.candidates.size > 0, 'pushing candidates/latest.json filled the projection');
  const again = await push({ client: worker(fake), dir });
  assert.deepEqual([again.written, again.appended], [0, 0], 'nothing new on a re-run');

  const out = join(makeDir(), 'copy');
  const r = await pull({ client: worker(fake), to: out });
  assert.equal(r.documents, first.written);
  assert.deepEqual(snapshotFromDir(out), snapshotFromDir(dir));
});

test('pull refuses the repository and a folder that is not empty', async () => {
  const fake = fakePostgrest();
  await assert.rejects(pull({ client: worker(fake), to: join(REPO, 'data') }), /inside the repository/);
  const busy = makeDir(); put(busy, 'x.json', {});
  await assert.rejects(pull({ client: worker(fake), to: busy }), /not empty/);
  await assert.rejects(pull({ client: worker(fake) }), /--to DIR/);
});
