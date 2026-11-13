// E1: the pilot. Truth sheets, verdicts, the scorecard, the pass gate, and the research gate for pipeline accounts. Invented data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { makeDir, put, account, config } from './kit.mjs';
import { loadRules } from '../src/rules.mjs';
import { truthTemplate, writeTruthTemplate, reviewList, markFinding, scorecard, passPilot, pilotStatus, researchGate } from '../src/pilot.mjs';
import { readJson } from '../src/store.mjs';

const { playbooks } = loadRules();
const finding = (id, over = {}) => ({ id, kind: 'structure', use: 'context', asset_specific: false, claim: `claim ${id}`, quote: `quote ${id}`, source_url: `https://example.test/${id}`, ...over });
const researchRec = (id, findings, over = {}) => ({ account: id, date: '2026-11-10', findings, dropped: [{ reason: 'invented URL' }], run: { costUsd: 1.25, queries: ['q1', 'q2'], fetches: ['f1'] }, ...over });

// Sets up one researched account with a filled truth sheet. Returns the data dir.
function setup({ id = 'acme-bank', findings = [finding('F1', { use: 'draft' }), finding('F2')], fill = true, dir = makeDir() } = {}) {
  const a = account({ id });
  put(dir, `research/${id}.json`, researchRec(id, findings));
  writeTruthTemplate({ dir, account: a, playbooks });
  if (fill) {
    const p = join(dir, 'pilot', `${id}.truth.json`);
    const t = readJson(p);
    t.sections[0].truth = 'State-chartered, about $2 billion in assets.'; t.sections[0].foundInBrief = true;
    t.sections[1].truth = 'Rising multifamily non-accruals.'; t.sections[1].foundInBrief = false;
    put(dir, `pilot/${id}.truth.json`, t);
  }
  return dir;
}

test('the truth sheet has one section per playbook question and is never overwritten', () => {
  const t = truthTemplate({ account: account(), playbooks });
  assert.deepEqual(t.sections.map((s) => s.questionId), playbooks.types.bank.questions.map((q) => q.id));
  assert.ok(t.sections.every((s) => s.foundInBrief === null && s.truth === ''));
  const dir = makeDir();
  writeTruthTemplate({ dir, account: account(), playbooks });
  assert.throws(() => writeTruthTemplate({ dir, account: account(), playbooks }), /already exists/);
  assert.throws(() => truthTemplate({ account: account({ type: 'unknown' }), playbooks }), /No playbook/);
});

test('verdicts need a name, a known verdict and a real finding, and are audited', () => {
  const dir = setup();
  assert.throws(() => markFinding({ dir, accountId: 'acme-bank', findingId: 'F1', verdict: 'true' }), /name is required/);
  assert.throws(() => markFinding({ dir, accountId: 'acme-bank', findingId: 'F1', verdict: 'maybe', by: 'Pat' }), /Verdict must be/);
  assert.throws(() => markFinding({ dir, accountId: 'acme-bank', findingId: 'F9', verdict: 'true', by: 'Pat' }), /No finding "F9"/);
  assert.throws(() => markFinding({ dir, accountId: 'no-such', findingId: 'F1', verdict: 'true', by: 'Pat' }), /No research/);
  markFinding({ dir, accountId: 'acme-bank', findingId: 'F1', verdict: 'true', by: 'Pat' });
  assert.equal(reviewList({ dir, accountId: 'acme-bank' }).findings.find((f) => f.id === 'F1').verdict, 'true');
  assert.match(readFileSync(join(dir, 'audit.jsonl'), 'utf8'), /"type":"pilot_verdict"/);
});

test('a new research run starts the review over rather than carrying old verdicts', () => {
  const dir = setup();
  markFinding({ dir, accountId: 'acme-bank', findingId: 'F1', verdict: 'true', by: 'Pat' });
  put(dir, 'research/acme-bank.json', researchRec('acme-bank', [finding('F1', { use: 'draft' })], { date: '2026-11-12' }));
  const r = reviewList({ dir, accountId: 'acme-bank' });
  assert.equal(r.staleReview, true);
  assert.equal(r.findings[0].verdict, null);
  markFinding({ dir, accountId: 'acme-bank', findingId: 'F1', verdict: 'false', by: 'Pat' });
  assert.equal(reviewList({ dir, accountId: 'acme-bank' }).staleReview, false);
});

test('the scorecard counts fabrications only for findings cleared for a message', () => {
  const dir = setup();
  markFinding({ dir, accountId: 'acme-bank', findingId: 'F1', verdict: 'false', by: 'Pat' });   // cleared for draft, marked false: a fabrication
  markFinding({ dir, accountId: 'acme-bank', findingId: 'F2', verdict: 'false', by: 'Pat' });   // context only, marked false: wrong, not a fabrication
  const { accounts, totals } = scorecard({ dir });
  assert.equal(accounts[0].fabrications, 1);
  assert.deepEqual(accounts[0].fabricationIds, ['F1']);
  assert.equal(accounts[0].wrongButContextOnly, 1);
  assert.equal(totals.fabrications, 1);
  assert.equal(totals.precision, 0);
});

test('the scorecard reports recall from the truth sheet, cost, and what the code dropped', () => {
  const dir = setup();
  markFinding({ dir, accountId: 'acme-bank', findingId: 'F1', verdict: 'true', by: 'Pat' });
  markFinding({ dir, accountId: 'acme-bank', findingId: 'F2', verdict: 'unknown', by: 'Pat' });
  const { accounts, totals } = scorecard({ dir });
  const a = accounts[0];
  assert.equal(a.truthFacts, 2); assert.equal(a.truthFound, 1); assert.equal(a.truthMissed, 1); assert.equal(a.truthNotChecked, 0);
  assert.equal(totals.recall, 0.5);
  assert.equal(totals.precision, 1);   // unknown does not count either way
  assert.equal(a.droppedByCode, 1);
  assert.equal(a.costUsd, 1.25); assert.equal(a.searches, 2); assert.equal(a.fetches, 1);
  assert.equal(totals.fullyReviewed, 1);
});

test('an account with a truth sheet but no research shows up as not researched', () => {
  const dir = makeDir();
  writeTruthTemplate({ dir, account: account({ id: 'beta-bank' }), playbooks });
  const { accounts, totals } = scorecard({ dir });
  assert.equal(accounts[0].researched, false);
  assert.equal(totals.researched, 0);
});

test('a pass is refused with too few fully reviewed accounts, or any fabrication, and recorded otherwise', () => {
  const dir = setup();
  markFinding({ dir, accountId: 'acme-bank', findingId: 'F1', verdict: 'true', by: 'Pat' });
  markFinding({ dir, accountId: 'acme-bank', findingId: 'F2', verdict: 'true', by: 'Pat' });
  const few = passPilot({ dir, by: 'Pat', minAccounts: 2 });
  assert.equal(few.ok, false); assert.match(few.reasons.join(' '), /1 of the required 2/);
  assert.equal(pilotStatus(dir).passed, false);

  setup({ dir, id: 'beta-bank' });
  markFinding({ dir, accountId: 'beta-bank', findingId: 'F1', verdict: 'false', by: 'Pat' });
  markFinding({ dir, accountId: 'beta-bank', findingId: 'F2', verdict: 'true', by: 'Pat' });
  const fab = passPilot({ dir, by: 'Pat', minAccounts: 2 });
  assert.equal(fab.ok, false); assert.match(fab.reasons.join(' '), /marked false/);

  markFinding({ dir, accountId: 'beta-bank', findingId: 'F1', verdict: 'true', by: 'Pat' });
  assert.throws(() => passPilot({ dir, minAccounts: 2 }), /name is required/);
  const ok = passPilot({ dir, by: 'Pat', minAccounts: 2 });
  assert.equal(ok.ok, true);
  assert.equal(pilotStatus(dir).passed, true); assert.equal(pilotStatus(dir).by, 'Pat');
});

test('an unchecked truth section keeps an account from counting as fully reviewed', () => {
  const dir = setup({ fill: false });
  const p = join(dir, 'pilot', 'acme-bank.truth.json');
  const t = readJson(p); t.sections[0].truth = 'Something true.'; put(dir, 'pilot/acme-bank.truth.json', t);   // filled, foundInBrief left null
  markFinding({ dir, accountId: 'acme-bank', findingId: 'F1', verdict: 'true', by: 'Pat' });
  markFinding({ dir, accountId: 'acme-bank', findingId: 'F2', verdict: 'true', by: 'Pat' });
  assert.equal(scorecard({ dir }).totals.fullyReviewed, 0);
});

test('research gate: pipeline accounts wait for the pilot; hand-picked accounts do not', () => {
  const dir = makeDir();
  const cfg = config();
  assert.equal(researchGate({ dir, account: account(), config: cfg }).allowed, true);
  const fromPipeline = account({ originSignals: ['sig-1'] });
  const g = researchGate({ dir, account: fromPipeline, config: cfg });
  assert.equal(g.allowed, false); assert.match(g.reason, /has not passed its pilot/);
  put(dir, 'pilot/status.json', { passed: true, by: 'Pat' });
  assert.equal(researchGate({ dir, account: fromPipeline, config: cfg }).allowed, true);
  assert.equal(researchGate({ dir: makeDir(), account: fromPipeline, config: { ...cfg, pilot: { requiredForPipelineAccounts: false } } }).allowed, true);
});

test('the shipped config requires the pilot for pipeline accounts, with a floor of 10', () => {
  const cfg = config();
  assert.equal(cfg.pilot.requiredForPipelineAccounts, true);
  assert.ok(cfg.pilot.minAccounts >= 10);
});
