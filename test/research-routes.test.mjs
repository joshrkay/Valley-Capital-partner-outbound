// PRD E17-S2: the lender side of a route, researched with sources. Four playbook topics (board, counsel, advisors, memberships); each
// finding names the people, firms and associations its quote names; code keeps a name only if the quote holds it; and the four topics
// are context only, never cleared for a message. All names and pages are invented.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { newLedger, absorb } from '../src/model.mjs';
import { processFindings, decideUse, schemaFor, buildPrompt, runBriefer } from '../src/research.mjs';
import { readJson } from '../src/store.mjs';
import { makeDir, account, models, fakeClient, textReply, loadJson, REPO } from './kit.mjs';

const playbooks = loadJson('playbooks.json');
const BOARD = 'https://acmebank.test/about/board';
const BOARD_TEXT = 'Board of Directors. Casey Q. Example, Director, is a partner at Example Grove Partners LLP. Morgan Sample, Chair, joined the board in 2018.';
const COUNSEL = 'https://court.example.test/docket/2026-0042';
const COUNSEL_TEXT = 'Plaintiff Acme Community Bank is represented by Riley Counsel of Sample & Sample LLP, attorneys for the lender.';
const fetchBlocks = (id, url, text) => [
  { type: 'server_tool_use', id, name: 'web_fetch', input: { url } },
  { type: 'web_fetch_tool_result', tool_use_id: id, content: { type: 'web_fetch_result', url, retrieved_at: '2026-11-13T10:00:00Z', content: { type: 'document', title: 'Page', source: { type: 'text', media_type: 'text/plain', data: text } } } },
];
const ledgerWith = () => { const l = newLedger(); absorb(l, [...fetchBlocks('f1', BOARD, BOARD_TEXT), ...fetchBlocks('f2', COUNSEL, COUNSEL_TEXT)]); return l; };
const finding = (o) => ({ id: 'b1', question_id: 'bank.board', kind: 'person', claim: 'Casey Q. Example is a director and a partner at Example Grove Partners LLP.', quote: 'Casey Q. Example, Director, is a partner at Example Grove Partners LLP', source_url: BOARD, source_title: 'Board', publisher: 'Acme Community Bank', published: '2026-09', evidence_tier: 'company', use: 'draft', asset_specific: false, corroborated_by: [],
  entities: [{ type: 'person', name: 'Casey Q. Example', affiliation: 'Example Grove Partners LLP', role: 'Director' }], ...o });
const raw = (findings) => ({ findings, gaps: [], contradictions: [], risk_screen: { approach: 'ok', reasons: [], finding_ids: [] }, person_check: { status: 'unconfirmed', note: '', finding_ids: [] }, angle: { text: '', finding_ids: [] } });
const NOW = Date.UTC(2026, 10, 13);

test('the playbook has the four route topics, each context only, and bank.access is replaced by them', () => {
  const ids = playbooks.types.bank.questions.map((q) => q.id);
  for (const id of ['bank.board', 'bank.counsel', 'bank.advisors', 'bank.memberships']) {
    const q = playbooks.types.bank.questions.find((x) => x.id === id);
    assert.ok(q, `${id} is missing`);
    assert.equal(q.contextOnly, true, `${id} must be context only`);
  }
  assert.ok(!ids.includes('bank.access'), 'bank.access is replaced by bank.counsel and bank.advisors');
  const advisors = playbooks.types.bank.questions.find((x) => x.id === 'bank.advisors');
  assert.match(advisors.ask, /FDIC/);
  assert.match(advisors.ask, /receiver/);
  const memberships = playbooks.types.bank.questions.find((x) => x.id === 'bank.memberships');
  assert.match(memberships.ask, /login/);
  const agenda = readFileSync(join(REPO, 'docs', 'research-agenda.md'), 'utf8');
  for (const id of ['bank.board', 'bank.counsel', 'bank.advisors', 'bank.memberships']) assert.ok(agenda.includes(`| ${id} |`), `the research agenda lacks a row for ${id}`);
  assert.ok(!agenda.includes('| bank.access |'), 'the agenda still lists bank.access');
});

test('each finding lists the entities its quote names; a name the quote does not hold is dropped, and so is an affiliation', () => {
  const r = processFindings({ raw: raw([
    finding(),
    finding({ id: 'b2', claim: 'Morgan Sample chairs the board.', quote: 'Morgan Sample, Chair, joined the board in 2018',
      entities: [{ type: 'person', name: 'Morgan Sample', affiliation: 'Invented Holdings Inc', role: 'Chair' }, { type: 'person', name: 'Someone Invented', affiliation: '', role: 'Director' }, { type: 'planet', name: 'Morgan Sample', affiliation: '', role: '' }] }),
    finding({ id: 'c1', question_id: 'bank.counsel', kind: 'relationship', claim: 'Sample & Sample LLP represents the bank.', quote: 'represented by Riley Counsel of Sample & Sample LLP, attorneys for the lender', source_url: COUNSEL, evidence_tier: 'government', asset_specific: true,
      entities: [{ type: 'firm', name: 'Sample & Sample LLP', affiliation: '', role: 'attorneys for the lender' }, { type: 'person', name: 'Riley Counsel', affiliation: 'Sample & Sample LLP', role: 'attorney' }] }),
    finding({ id: 'p0', question_id: 'bank.intent', kind: 'intent', entities: undefined }),   // an answer from before the entities field: none
  ]), ledger: ledgerWith(), playbooks, now: NOW });
  assert.equal(r.findings.length, 4);
  const [b1, b2, c1, p0] = r.findings;
  assert.deepEqual(b1.entities, [{ type: 'person', name: 'Casey Q. Example', affiliation: 'Example Grove Partners LLP', role: 'Director' }]);
  assert.deepEqual(b2.entities, [{ type: 'person', name: 'Morgan Sample', affiliation: '', role: 'Chair' }], 'the invented person and the unknown type are dropped; the affiliation not in the quote is cleared');
  assert.equal(b2.entitiesDropped, 2);
  assert.equal(b2.affiliationsDropped, 1);
  assert.deepEqual(c1.entities.map((e) => [e.type, e.name, e.affiliation]), [['firm', 'Sample & Sample LLP', ''], ['person', 'Riley Counsel', 'Sample & Sample LLP']]);
  assert.deepEqual(p0.entities, []);
  assert.equal(b1.contextOnlyTopic, true);
  assert.equal(c1.contextOnlyTopic, true);
  assert.equal(p0.contextOnlyTopic, false);
});

test('a route topic is never cleared for a message, whatever the model proposed and the support check said', () => {
  const r = processFindings({ raw: raw([finding()]), ledger: ledgerWith(), playbooks, now: NOW });
  const f = r.findings[0];
  assert.equal(f.requestedUse, 'draft');
  const [use, why] = decideUse(f, 'yes');
  assert.equal(use, 'context');
  assert.match(why, /who connects to the institution/);
  // The existing rule is unchanged for every other topic.
  assert.deepEqual(decideUse({ requestedUse: 'draft', asset_specific: false, kind: 'intent', evidence_tier: 'company', stale: false, status: 'verified', corroborations: 1 }, 'yes'), ['draft', '']);
});

test('the schema asks for entities, and the prompt says how to fill them and that the route topics are context', () => {
  const s = schemaFor(playbooks.kinds);
  const item = s.properties.findings.items;
  assert.ok(item.required.includes('entities'));
  assert.deepEqual(item.properties.entities.items.properties.type.enum, ['person', 'firm', 'association']);
  const { system, user } = buildPrompt({ account: account({ person: {} }), playbook: playbooks.types.bank, playbooks, models: models(), today: '2026-11-13' });
  assert.match(system, /entities:/);
  assert.match(system, /must appear in the quote/);
  assert.match(system, /contextOnly/);
  for (const id of ['bank.board', 'bank.counsel', 'bank.advisors', 'bank.memberships']) assert.ok(user.includes(id), `the prompt lacks ${id}`);
});

test('end to end: route findings are kept with their entities in the research record, and the drafter\'s facts carry neither the names nor a draft use', async () => {
  const dir = makeDir();
  const client = fakeClient([
    { content: [...fetchBlocks('f1', BOARD, BOARD_TEXT), { type: 'text', text: JSON.stringify(raw([finding()])) }], stop_reason: 'end_turn', usage: {}, model: 'fake' },
    textReply({ verdicts: [{ id: 'F1', supports: 'yes' }] }),
  ]);
  const out = await runBriefer({ client, dir, account: account({ person: {} }), models: models(), playbooks, now: new Date('2026-11-13T12:00:00Z') });
  assert.equal(out.ok, true);
  assert.equal(out.draftReady, 0);
  const rec = readJson(join(dir, 'research', 'acme-bank.json'));
  assert.deepEqual(rec.findings[0].entities.map((e) => e.name), ['Casey Q. Example']);
  assert.equal(rec.findings[0].use, 'context');
  const facts = readJson(join(dir, 'facts', 'acme-bank.json'));
  assert.equal(facts[0].use, 'context');
  assert.equal('entities' in facts[0], false, 'the facts file the drafter reads has no entities');
});
