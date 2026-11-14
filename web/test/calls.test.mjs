// The account page's calls section (PRD E15), through web/lib/ops.mjs, against the repository's fake Supabase REST API. The model is
// never called here: the web app only queues model work. Invented data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fakePostgrest } from '../../test/postgrest-fake.mjs';
import { platformClient } from '../../src/platform/client.mjs';
import { snapshotFromDir } from '../../src/uow.mjs';
import { setup, ID, NOTES, PROPOSAL_REPLY, GOOD_BRIEF, rules } from '../../test/calls-kit.mjs';
import { fakeClient, textReply } from '../../test/kit.mjs';
import { work } from '../../src/platform/worker.mjs';
import * as ops from '../lib/ops.mjs';

const URL_ = 'https://example-project.supabase.test';
const DATE = '2026-11-17';

async function seeded() {
  const fake = fakePostgrest();
  const client = platformClient({ url: URL_, key: 'anon-key', accessToken: 'user:pat@example.test', fetchImpl: fake.fetchImpl });
  const worker = platformClient({ url: URL_, key: 'service', fetchImpl: fake.fetchImpl });
  const snap = snapshotFromDir(setup());
  await client.flush({ docs: [...Object.entries(snap.docs).map(([p, body]) => ({ path: p, kind: 'json', body, baseVersion: 0 })), ...Object.entries(snap.texts).map(([p, text]) => ({ path: p, kind: 'text', text, baseVersion: 0 }))], lines: Object.entries(snap.logs).flatMap(([p, ls]) => ls.map((l) => ({ path: p, line: l }))) });
  const model = fakeClient([(params) => textReply(params.output_config.format.schema.required.includes('who') ? GOOD_BRIEF : PROPOSAL_REPLY)]);
  const runJobs = () => work({ client: worker, rules, deps: { makeModelClient: async () => model, now: () => new Date('2026-11-14T15:00:00Z') } });
  return { fake, client, runJobs };
}

test('a call brief is queued, not run; once the worker writes it, the page shows it and its check result', async () => {
  const { fake, client, runJobs } = await seeded();
  assert.equal((await ops.accountCalls(client, ID)).latestBrief, null);
  await assert.rejects(ops.queueCallPrep(client, { id: ID, date: '17/11/2026' }), /YYYY-MM-DD/);
  await ops.queueCallPrep(client, { id: ID, date: DATE });
  assert.deepEqual([fake.jobs[0].kind, fake.jobs[0].params], ['call.prep', { account: ID, date: DATE }]);
  await runJobs();
  const c = await ops.accountCalls(client, ID);
  assert.deepEqual([c.latestBrief.date, c.latestBrief.usable, c.latestBrief.status], [DATE, true, 'usable']);
  assert.match(c.latestBrief.md, /## 6\. What we can say: approved claims only/);
});

test('a brief that failed a check is NOT USABLE on the page, with the reasons', async () => {
  const { client } = await seeded();
  await client.flush({ docs: [
    { path: `calls/${ID}/${DATE}-prep.json`, kind: 'json', body: { account: ID, date: DATE, status: 'not_usable', usable: false, problems: [{ code: 'NUMBER_NOT_IN_INPUTS', message: 'Why now, item 1: the number 9.99 does not appear in any input.' }], warnings: [], preparedAt: '2026-11-14T15:00:00Z' }, baseVersion: 0 },
    { path: `calls/${ID}/${DATE}-prep.md`, kind: 'text', text: '# Call brief\n', baseVersion: 0 },
  ], lines: [] });
  const c = await ops.accountCalls(client, ID);
  assert.deepEqual([c.latestBrief.usable, c.latestBrief.status, c.latestBrief.problems[0].code], [false, 'not_usable', 'NUMBER_NOT_IN_INPUTS']);
});

test('pasted notes are saved as the principal and a proposal is queued; the job carries no note text', async () => {
  const { fake, client, runJobs } = await seeded();
  await assert.rejects(ops.logCallNotes(client, { id: ID, date: DATE, notes: ' ', by: 'Pat Example' }), /empty/);
  await ops.logCallNotes(client, { id: ID, date: DATE, notes: NOTES, by: 'Pat Example' });
  assert.equal(fake.docs.get(`calls/${ID}/${DATE}-notes.md`).text, `${NOTES}\n`);
  assert.equal(fake.docs.get(`calls/${ID}/${DATE}-notes.md`).updated_by, 'pat@example.test', 'written as the signed-in principal');
  const job = fake.jobs.at(-1);
  assert.deepEqual([job.kind, job.params], ['call.extract', { account: ID, date: DATE, by: 'Pat Example' }]);
  assert.doesNotMatch(JSON.stringify(job.params), /Jordan|Riley|confidentiality/);
  await runJobs();
  const c = await ops.accountCalls(client, ID);
  assert.equal(c.pending.length, 1);
  assert.deepEqual(c.pending[0].outcomes.map((o) => o.code), ['held', 'nda_requested', 'tape_promised']);
  assert.equal(fake.lines.some((l) => l.path === 'outcomes.jsonl'), false, 'nothing recorded before a principal confirms');
  assert.equal(fake.lines.some((l) => l.path === 'touches.jsonl' && l.line.type === 'meeting'), false);
});

test('confirming from the page records the meeting and the outcome; rejecting records nothing', async () => {
  const { fake, client, runJobs } = await seeded();
  await ops.logCallNotes(client, { id: ID, date: DATE, notes: NOTES, by: 'Pat Example' });
  await runJobs();
  const [p] = (await ops.accountCalls(client, ID)).pending;
  const r = await ops.confirmCall(client, { id: ID, proposal: p.id, by: 'Pat Example' });
  assert.equal(r.outcome.date, DATE);
  assert.ok(fake.lines.some((l) => l.path === 'touches.jsonl' && l.line.type === 'meeting' && l.by === 'pat@example.test'));
  const outcome = fake.lines.find((l) => l.path === 'outcomes.jsonl').line;
  assert.deepEqual([outcome.institutionKey, outcome.confirmedBy, outcome.originSignals.length], ['fdic:99999', 'Pat Example', 2]);
  const c = await ops.accountCalls(client, ID);
  assert.deepEqual([c.pending.length, c.outcomes.length], [0, 1]);
  assert.match(c.latestFollowUp.md, /## What was agreed/);
  assert.equal(fake.docs.get(`accounts/${ID}.json`).body.person.name, 'Jordan Sample', 'no one named in the notes became the person');
  await assert.rejects(ops.confirmCall(client, { id: ID, proposal: p.id, by: 'Pat Example' }), /already confirmed/);

  const second = await seeded();
  await ops.logCallNotes(second.client, { id: ID, date: DATE, notes: NOTES, by: 'Pat Example' });
  await second.runJobs();
  const [q] = (await ops.accountCalls(second.client, ID)).pending;
  await ops.rejectCall(second.client, { id: ID, proposal: q.id, by: 'Pat Example', reason: 'wrong codes' });
  assert.deepEqual((await ops.accountCalls(second.client, ID)).proposals.map((x) => x.status), ['rejected']);
  assert.equal(second.fake.lines.some((l) => l.path === 'outcomes.jsonl'), false);
  await assert.rejects(ops.accountCalls(client, '../etc'), /Invalid id/);
});
