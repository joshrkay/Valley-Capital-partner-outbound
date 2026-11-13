// E1: pilot the briefer on accounts the principals already know, before any account the pipeline found is researched.
// A principal writes a "what is true" sheet, marks each finding true, false or unknown, and the scorecard measures
// precision, recall and fabrication. A fabrication is a finding cleared for use in a message that a principal marks false.
// The gate: accounts created from a candidate (they carry originSignals) cannot be researched until a principal records
// a pass, which this module allows only with enough fully reviewed accounts and zero fabrications.
import { join } from 'node:path';
import { readJson, writeJson, listFiles, exists, safeId, audit } from './store.mjs';

const VERDICTS = ['true', 'false', 'unknown'];
const truthPath = (dir, id) => join(dir, 'pilot', `${safeId(id)}.truth.json`);
const reviewPath = (dir, id) => join(dir, 'pilot', `${safeId(id)}.review.json`);
const statusPath = (dir) => join(dir, 'pilot', 'status.json');
const needBy = (by) => { const b = String(by ?? '').trim(); if (!b || b === 'true') throw new Error('A name is required: --by "Pat Example".'); return b; };

// One section per playbook question, so the sheet and the brief can be compared question by question.
// `foundInBrief` is filled by the principal while reading the brief: true, false, or left null.
export function truthTemplate({ account, playbooks }) {
  const pb = playbooks.types[account.type];
  if (!pb) throw new Error(`No playbook for account type "${account.type}".`);
  return {
    _note: 'Write what you know to be true, with a source where you have one. Leave a section empty if you do not know. After reading the brief, set foundInBrief to true or false for every section you filled. This file never leaves the data folder.',
    account: account.id, type: account.type, writtenBy: '[CONFIRM: name]', date: '',
    sections: pb.questions.map((q) => ({ questionId: q.id, ask: q.ask, truth: '', sources: [], foundInBrief: null })),
  };
}

export function writeTruthTemplate({ dir, account, playbooks }) {
  const p = truthPath(dir, account.id);
  if (exists(p)) throw new Error(`A truth sheet already exists: ${p}. Edit it; it is not overwritten.`);
  writeJson(p, truthTemplate({ account, playbooks }));
  audit(dir, { type: 'pilot_truth_template', accountId: account.id });
  return p;
}

function research(dir, id) {
  const r = readJson(join(dir, 'research', `${safeId(id)}.json`), null);
  if (!r) throw new Error(`No research for ${id}. Run the briefer first: outbound research run --account ${id}`);
  return r;
}

const reviewFile = (dir, id, r) => readJson(reviewPath(dir, id), { account: id, researchDate: r.date, verdicts: {} });

// The findings of the latest research run, each with the verdict recorded so far. A review of an older run is not carried over.
export function reviewList({ dir, accountId }) {
  const r = research(dir, accountId);
  const rev = reviewFile(dir, accountId, r);
  const stale = rev.researchDate !== r.date;
  return {
    researchDate: r.date, staleReview: stale,
    findings: r.findings.map((f) => ({ id: f.id, kind: f.kind, use: f.use, assetSpecific: !!f.asset_specific, claim: f.claim, quote: f.quote, url: f.source_url, verdict: stale ? null : rev.verdicts[f.id]?.verdict ?? null })),
  };
}

export function markFinding({ dir, accountId, findingId, verdict, by, note, now = new Date() }) {
  const who = needBy(by);
  if (!VERDICTS.includes(verdict)) throw new Error(`Verdict must be one of: ${VERDICTS.join(', ')}.`);
  const r = research(dir, accountId);
  if (!r.findings.some((f) => f.id === findingId)) throw new Error(`No finding "${findingId}" in the research for ${accountId}. See: outbound pilot review --account ${accountId}`);
  let rev = reviewFile(dir, accountId, r);
  if (rev.researchDate !== r.date) rev = { account: accountId, researchDate: r.date, verdicts: {} };   // research was re-run: start over
  rev.verdicts[findingId] = { verdict, by: who, at: now.toISOString(), ...(note && note !== true ? { note: String(note) } : {}) };
  writeJson(reviewPath(dir, accountId), rev);
  audit(dir, { type: 'pilot_verdict', accountId, findingId, verdict, by: who });
  return rev.verdicts[findingId];
}

// Per account and in total. Recall comes from the truth sheet: sections a principal filled, and whether the brief found them.
export function scorecard({ dir }) {
  const ids = listFiles(join(dir, 'pilot'), '.truth.json').map((f) => f.replace(/\.truth\.json$/, ''));
  const accounts = ids.map((id) => {
    const truth = readJson(truthPath(dir, id));
    const filled = truth.sections.filter((s) => String(s.truth ?? '').trim());
    const r = readJson(join(dir, 'research', `${id}.json`), null);
    if (!r) return { account: id, researched: false, truthFacts: filled.length };
    const { findings, staleReview } = reviewList({ dir, accountId: id });
    const count = (pred) => findings.filter(pred).length;
    const fab = findings.filter((f) => f.use === 'draft' && f.verdict === 'false');
    return {
      account: id, researched: true, researchDate: r.date, staleReview,
      findings: findings.length, unreviewed: count((f) => f.verdict === null),
      true: count((f) => f.verdict === 'true'), false: count((f) => f.verdict === 'false'), unknown: count((f) => f.verdict === 'unknown'),
      fabrications: fab.length, fabricationIds: fab.map((f) => f.id), wrongButContextOnly: count((f) => f.use !== 'draft' && f.verdict === 'false'),
      droppedByCode: r.dropped?.length ?? 0,
      truthFacts: filled.length, truthFound: filled.filter((s) => s.foundInBrief === true).length, truthMissed: filled.filter((s) => s.foundInBrief === false).length,
      truthNotChecked: filled.filter((s) => s.foundInBrief !== true && s.foundInBrief !== false).length,
      costUsd: r.run?.costUsd ?? null, searches: r.run?.queries?.length ?? null, fetches: r.run?.fetches?.length ?? null,
    };
  });
  const done = accounts.filter((a) => a.researched);
  const sum = (k) => done.reduce((n, a) => n + (a[k] ?? 0), 0);
  const reviewedTrue = sum('true'); const reviewedFalse = sum('false');
  const totals = {
    accounts: accounts.length, researched: done.length, fullyReviewed: done.filter((a) => a.unreviewed === 0 && !a.staleReview && a.truthNotChecked === 0).length,
    fabrications: sum('fabrications'), precision: reviewedTrue + reviewedFalse ? reviewedTrue / (reviewedTrue + reviewedFalse) : null,
    recall: sum('truthFound') + sum('truthMissed') ? sum('truthFound') / (sum('truthFound') + sum('truthMissed')) : null,
    costUsd: Math.round(sum('costUsd') * 100) / 100, costPerBrief: done.length ? Math.round((sum('costUsd') / done.length) * 100) / 100 : null,
  };
  return { accounts, totals };
}

export const pilotStatus = (dir) => readJson(statusPath(dir), { passed: false });

// Records a pass only when the evidence supports one. Returns the reasons when it does not.
export function passPilot({ dir, by, minAccounts, now = new Date() }) {
  const who = needBy(by);
  const { totals } = scorecard({ dir });
  const reasons = [];
  if (totals.fullyReviewed < minAccounts) reasons.push(`${totals.fullyReviewed} of the required ${minAccounts} accounts are fully reviewed (every finding marked and every filled truth section checked).`);
  if (totals.fabrications > 0) reasons.push(`${totals.fabrications} finding(s) cleared for a message were marked false. Fix the briefer before passing.`);
  if (reasons.length) { audit(dir, { type: 'pilot_pass_refused', by: who, reasons: reasons.length }); return { ok: false, reasons, totals }; }
  const status = { passed: true, by: who, at: now.toISOString(), accounts: totals.fullyReviewed, fabrications: 0, precision: totals.precision, recall: totals.recall, costPerBrief: totals.costPerBrief };
  writeJson(statusPath(dir), status);
  audit(dir, { type: 'pilot_passed', by: who, accounts: status.accounts });
  return { ok: true, status, totals };
}

// Accounts the pipeline created (they carry originSignals) wait for the pilot. Accounts a principal picked by hand do not.
export function researchGate({ dir, account, config }) {
  const fromPipeline = Array.isArray(account.originSignals) && account.originSignals.length > 0;
  if (!fromPipeline || config.pilot?.requiredForPipelineAccounts === false) return { allowed: true };
  if (pilotStatus(dir).passed) return { allowed: true };
  return { allowed: false, reason: `${account.id} came from the candidate list, and the briefer has not passed its pilot yet. Run the pilot on accounts you know (outbound pilot ...) and record a pass first. See docs/prd-signal-pipeline.md, E1.` };
}
