// PRD section 0 and E15: the research and the paper estimate never reach the drafter, and the follow-up after a call carries only what
// was agreed. Run end to end on a data folder: a researched account with a paper estimate, a call brief, call notes and a confirmed
// outcome. Every name, number and note is invented, with distinctive values so a leak is easy to spot.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fakeClient, SENDER } from './kit.mjs';
import { rules, ID, NOTES, PROPOSAL_REPLY, GOOD_BRIEF, PAPER, CARD, PIPELINE, FINDINGS, setup, reply } from './calls-kit.mjs';
import { readJson } from '../src/store.mjs';
import { loadContext } from '../src/guard.mjs';
import { buildDraftPrompt, runDrafter, approveDraft } from '../src/draft.mjs';
import { runCallPrep, saveNotes, runCallExtract, confirmProposal, editProposal } from '../src/calls.mjs';
import { LOADS } from '../src/uow.mjs';

const DATE = '2026-11-17';
const NOW = new Date('2026-11-14T15:00:00Z');     // the brief, before the call
const AFTER = new Date('2026-11-20T15:00:00Z');   // the notes and the confirmation, after it
const acct = (dir) => readJson(join(dir, 'accounts', `${ID}.json`));

// What must never reach the drafter: the paper estimate, the research beyond its cleared facts, the pipeline, the call brief, the notes.
const PAPER_LEAKS = ['812345', '812.3', '15.17', '35.29', '0.1517', 'officeShare', 'Office share', 'peer-prior', 'paper', 'Participations', 'tapeRequest', 'estimate'];
const RESEARCH_LEAKS = ['Example Grove Apartments', '27,182,818', '27182818', 'receiver', 'court.test'];
const PIPELINE_LEAKS = ['43.21', '6.17', '2.04', '0.0617', 'noncurrent', PIPELINE.signals[0].label, 'acquired-metro-bank', 'fdic:99999', '41.7', 'Phoenix'];
const CALL_LEAKS = ['Riley Example', 'workout side', '30 minutes', 'two multifamily loans', 'contact borrowers', 'NOT USABLE', 'Call brief', 'nda_requested', 'tape_promised', '2026-12-01', 'Follow up on'];

async function throughTheCall() {
  const dir = setup();
  await runCallPrep({ client: fakeClient([reply(GOOD_BRIEF)]), dir, account: acct(dir), date: DATE, rules, now: NOW });
  saveNotes({ dir, id: ID, date: DATE, notes: NOTES, by: 'Pat Example', now: AFTER });
  const ex = await runCallExtract({ client: fakeClient([reply(PROPOSAL_REPLY)]), dir, id: ID, date: DATE, by: 'Pat Example', models: rules.models, now: AFTER });
  return { dir, ex };
}

const drafterInput = (dir) => {
  const facts = readJson(join(dir, 'facts', `${ID}.json`)).filter((f) => f.use === 'draft');   // exactly what runDrafter passes on
  const { system, user } = buildDraftPrompt({ account: acct(dir), channel: 'email', step: 3, sender: SENDER, facts, claims: rules.claims, priorTouches: [], rules });
  return `${system}\n${user}`;
};

test('with a paper estimate, a call brief and call notes in the data folder, the drafter still sees none of them', async () => {
  const { dir } = await throughTheCall();
  // Before the call is confirmed the guard still allows the next step, so the drafter's own dry run shows exactly what it would send.
  const ctx = loadContext({ dir, config: { ...rules.config, stopEvents: ['opt_out', 'meeting', 'handoff'] }, env: {} });   // let the reply pass, for this probe only
  const dry = await runDrafter({ client: fakeClient([new Error('no model in a dry run')]), dir, account: acct(dir), channel: 'linkedin_note', step: 3, senderId: 'pat', date: '2026-11-15', ctx, rules: { ...rules, config: ctx.config }, dryRun: true });
  assert.equal(dry.dryRun, true, JSON.stringify(dry));
  const both = `${dry.system}\n${dry.user}`;
  for (const leak of [...PAPER_LEAKS, ...RESEARCH_LEAKS, ...PIPELINE_LEAKS, ...CALL_LEAKS]) assert.ok(!both.includes(leak), `drafter input leaked "${leak}"`);
  assert.match(dry.user, /"sector":"multifamily"/, 'the drafter gets the sector');
  assert.match(dry.user, /intends to reduce multifamily loans through sales/, 'and the briefer\'s cleared facts, as before');
});

test('after the call is confirmed, the account carries the outcome, and the drafter\'s input still carries none of it', async () => {
  const { dir, ex } = await throughTheCall();
  confirmProposal({ dir, id: ID, proposalId: ex.proposalId, by: 'Pat Example', rules, now: AFTER });
  assert.equal(acct(dir).outcomes.length, 1);
  const input = drafterInput(dir);
  for (const leak of [...PAPER_LEAKS, ...RESEARCH_LEAKS, ...PIPELINE_LEAKS, ...CALL_LEAKS, 'outcome', 'commitment', 'confidentiality agreement by']) assert.ok(!input.includes(leak), `drafter input leaked "${leak}"`);
});

test('a proposal a principal corrected, then confirmed, reaches the drafter in no form', async () => {
  const { dir, ex } = await throughTheCall();
  editProposal({ dir, id: ID, proposalId: ex.proposalId, by: 'Sam Example', now: AFTER, edits: {
    outcomes: [{ code: 'held' }, { code: 'wrong_person', referral: 'Morgan Example in special assets' }],
    objections: ['They distrust zebra-striped buyers.'],
    commitments: [{ who: 'us', what: 'Mail the quokka memo', by: '2026-11-25' }],
    followUpDate: '2026-12-09',
  } });
  confirmProposal({ dir, id: ID, proposalId: ex.proposalId, by: 'Pat Example', rules, now: AFTER });
  assert.deepEqual(acct(dir).outcomes[0].edited.by, ['Sam Example']);
  const input = drafterInput(dir);
  for (const leak of [...PAPER_LEAKS, ...RESEARCH_LEAKS, ...PIPELINE_LEAKS, ...CALL_LEAKS, 'Morgan Example', 'zebra-striped', 'quokka', '2026-12-09', '2026-11-25', 'wrong_person', 'Sam Example']) assert.ok(!input.includes(leak), `drafter input leaked "${leak}"`);
  for (const p of [`calls/${ID}/proposals/${ex.proposalId}.json`, 'outcomes.jsonl']) assert.ok(!LOADS.draft.some((x) => x === '' || p.startsWith(x)), `LOADS.draft covers ${p}`);
});

test('the follow-up carries only what was agreed: the commitments, the follow-up date, the matching approved claim and the tape request', async () => {
  const { dir, ex } = await throughTheCall();
  confirmProposal({ dir, id: ID, proposalId: ex.proposalId, by: 'Pat Example', rules, now: AFTER });
  const f = readJson(join(dir, 'calls', ID, `${DATE}-followup.json`));
  const md = await import('node:fs').then((fs) => fs.readFileSync(join(dir, 'calls', ID, `${DATE}-followup.md`), 'utf8'));
  // What may be in it.
  assert.deepEqual(f.items.map((i) => i.what), PROPOSAL_REPLY.commitments.map((c) => c.what));
  assert.deepEqual(f.claims.map((c) => c.text), [rules.claims.find((c) => c.id === 'nda-first').text]);
  assert.deepEqual(f.tape, PAPER.tapeRequest, 'the tape request is a list of fields, never a paper value');
  assert.equal(f.followUpDate, '2026-12-01');
  // What may not: the paper estimate's values, the research, the pipeline, anything else from the notes, and any name.
  const both = `${JSON.stringify(f)}\n${md}`;
  for (const leak of ['812345', '812.3', '15.17', '35.29', 'Office share', ...RESEARCH_LEAKS, ...PIPELINE_LEAKS, ...CARD, ...FINDINGS.map((x) => x.claim), 'Riley Example', 'Jordan Sample', 'workout side', '30 minutes', 'two multifamily loans', 'contact borrowers'])
    assert.ok(!both.includes(leak), `follow-up leaked "${leak}"`);
  assert.equal(f.email.drafted, false, 'nothing is drafted, and nothing is ever sent');
});

test('the stop rule is not weakened: after the call, the drafter refuses before any model call and an older draft cannot be approved', async () => {
  const { dir, ex } = await throughTheCall();
  const ctx = loadContext({ dir, config: rules.config, env: {} });
  confirmProposal({ dir, id: ID, proposalId: ex.proposalId, by: 'Pat Example', rules, now: AFTER });
  const after = loadContext({ dir, config: rules.config, env: {} });
  const client = fakeClient([new Error('must not be called')]);
  const r = await runDrafter({ client, dir, account: acct(dir), channel: 'email', step: 3, senderId: 'pat', date: '2026-11-20', ctx: after, rules });
  assert.equal(r.blocked, 'guard');
  assert.ok(r.errors.some((e) => e.code === 'SEQUENCE_STOPPED'));
  assert.equal(client.calls.length, 0);
  const ok = approveDraft({ dir, account: acct(dir), channel: 'email', step: 2, by: 'Pat Example', ctx: after, rules });
  assert.ok(ok.errors?.some((e) => e.code === 'GUARD_SEQUENCE_STOPPED'), JSON.stringify(ok));
  assert.ok(ctx.touches.length < after.touches.length, 'the meeting was added to the touch log, not taken out of it');
});
