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
const DATE = '2026-11-12';   // a call that has taken place: the web app reads the real clock, and a future call date is refused

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
  await assert.rejects(ops.logCallNotes(client, { id: ID, date: '2999-01-01', notes: NOTES, by: 'Pat Example' }), /later than today/);
  assert.equal(fake.jobs.length, 0, 'a future call date queues nothing');
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

test('a principal corrects a proposal on the page, then confirms it: the form becomes the correction, audited without its values', async () => {
  const { fake, client, runJobs } = await seeded();
  await ops.logCallNotes(client, { id: ID, date: DATE, notes: NOTES, by: 'Pat Example' });
  await runJobs();
  const c = await ops.accountCalls(client, ID);
  const [p] = c.pending;
  assert.deepEqual(c.codes.map((x) => x.code), ['held', 'nda_requested', 'nda_signed', 'tape_promised', 'tape_received', 'not_selling_now', 'wrong_person', 'interested_later', 'pricing_discussed', 'declined'], 'the form offers the fixed list of codes');
  assert.deepEqual(c.who, ['us', 'them', 'both', 'unclear']);
  assert.deepEqual(p.edits, []);
  // The form as the page posts it: a checkbox per code, a line per objection, a row per commitment (an empty "what" drops the row).
  const fd = new FormData();
  for (const code of ['held', 'wrong_person']) fd.append('code', code);
  fd.set('when', 'ignored: not_selling_now is not ticked');
  fd.set('referral', ' the head of special assets ');
  fd.set('objections', 'A buyer may contact borrowers.\r\n\n  They want a quick close.  \n');
  fd.set('commitmentRows', '3');
  fd.set('who.0', 'us'); fd.set('what.0', 'Send our confidentiality agreement'); fd.set('by.0', '2026-11-20');
  fd.set('who.1', 'them'); fd.set('what.1', '  '); fd.set('by.1', '');
  fd.set('who.2', 'both'); fd.set('what.2', 'Agree a date for the next call'); fd.set('by.2', 'next week');
  fd.set('followUpDate', '');
  const edits = ops.proposalEditsFromForm(fd);
  assert.deepEqual(edits, {
    outcomes: [{ code: 'held', when: '', referral: '' }, { code: 'wrong_person', when: '', referral: 'the head of special assets' }],
    objections: ['A buyer may contact borrowers.', 'They want a quick close.'],
    commitments: [{ who: 'us', what: 'Send our confidentiality agreement', by: '2026-11-20' }, { who: 'both', what: 'Agree a date for the next call', by: 'next week' }],
    followUpDate: '',
  });
  await assert.rejects(ops.editCall(client, { id: ID, proposal: p.id, by: 'Sam Example', edits: { ...edits, outcomes: [{ code: 'sold_everything' }] } }), /"sold_everything" is not an outcome code/);
  const e = await ops.editCall(client, { id: ID, proposal: p.id, by: 'Sam Example', edits, seenEdits: '0' });
  assert.deepEqual(e.fields, ['outcomes', 'objections', 'commitments', 'followUpDate']);
  await assert.rejects(ops.editCall(client, { id: ID, proposal: p.id, by: 'Pat Example', edits: { ...edits, followUpDate: '2026-12-01' }, seenEdits: '0' }), /was corrected since you loaded it \(by Sam Example\)/, 'a stale form does not overwrite another principal\'s correction');
  const after = (await ops.accountCalls(client, ID)).pending[0];
  assert.deepEqual([after.status, after.edits.map((x) => x.by), after.outcomes.map((o) => o.code)], ['pending', ['Sam Example'], ['held', 'wrong_person']]);
  const doc = fake.docs.get(`calls/${ID}/proposals/${p.id}.json`);
  assert.equal(doc.updated_by, 'pat@example.test', 'written as the signed-in principal');
  const audited = fake.lines.filter((l) => l.path === 'audit.jsonl' && l.line.type === 'call_proposal_edited').map((l) => l.line);
  assert.deepEqual(audited.map((a) => [a.by, a.fields]), [['Sam Example', ['outcomes', 'objections', 'commitments', 'followUpDate']]]);
  assert.doesNotMatch(JSON.stringify(audited), /special assets|quick close|wrong_person|confidentiality/);
  assert.equal(fake.lines.some((l) => l.path === 'outcomes.jsonl'), false, 'nothing recorded before a principal confirms');
  // The confirm button carries how many corrections its principal saw.
  await assert.rejects(ops.confirmCall(client, { id: ID, proposal: p.id, by: 'Pat Example', seenEdits: '0' }), /was corrected since you loaded it/);
  const r = await ops.confirmCall(client, { id: ID, proposal: p.id, by: 'Pat Example', seenEdits: '1' });
  assert.deepEqual([r.outcome.codes, r.outcome.edited], [['held', 'wrong_person'], { by: ['Sam Example'], fields: ['outcomes', 'objections', 'commitments', 'followUpDate'] }]);
  assert.deepEqual((await ops.accountCalls(client, ID)).outcomes[0].edited.by, ['Sam Example']);
  assert.equal(fake.docs.get(`accounts/${ID}.json`).body.person.name, 'Jordan Sample', 'no one named in the notes became the person');
});
