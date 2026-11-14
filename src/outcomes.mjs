// PRD E15-S4: what led to conversations. Deterministic, with no model. It reads the confirmed call outcomes (outcomes.jsonl, written
// only when a principal confirms a call: src/calls.mjs) and counts them three ways: by the signal types that started each account, by
// tier, and by the lead time from the account's first signal to its first meeting. It never changes scoring weights. Below
// config.outcomes.minToTune confirmed outcomes it says the counts are too few to tune on; above it, a principal still decides.
import { join } from 'node:path';
import { readJsonl, writeJson, audit } from './store.mjs';
import { OUTCOME_CODES, OUTCOMES_LOG, needDate } from './calls.mjs';

const DAY = 86400000;
const days = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);
export const HAND_PICKED = '(none: picked by hand)';
export const UNTIERED = 'untiered';
const ISO = /^\d{4}-\d{2}-\d{2}$/;

// Bucket labels from the edges in config, e.g. [30, 90] -> "0-30 days", "31-90 days", "over 90 days".
export function leadTimeBucket(d, edges) {
  if (d === null || d === undefined) return 'unknown: no signal date or no meeting';
  if (d < 0) return 'meeting before the first signal';
  let lo = 0;
  for (const e of edges) { if (d <= e) return `${lo}-${e} days`; lo = e + 1; }
  return `over ${edges.at(-1)} days`;
}

export function buildOutcomesReport({ lines, since = null, minToTune = 30, buckets = [30, 90, 180, 365], now = new Date() }) {
  const seen = new Set();
  const confirmed = (lines ?? [])
    .filter((l) => l?.type === 'call_outcome' && l.accountId && ISO.test(String(l.date)) && Array.isArray(l.codes))
    .filter((l) => { const k = l.id ?? `${l.accountId}:${l.date}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => (a.date === b.date ? String(a.id).localeCompare(String(b.id)) : a.date.localeCompare(b.date)));
  // An account's first signal and first held call come from every confirmed outcome. `since` only chooses which calls are counted, so
  // it never moves an account's first meeting to its first call inside the window.
  const first = new Map();
  for (const o of confirmed) {
    const f = first.get(o.accountId) ?? { signal: null, meeting: null };
    if (ISO.test(String(o.firstSignalDate)) && (!f.signal || o.firstSignalDate < f.signal)) f.signal = o.firstSignalDate;
    if (o.codes.includes('held') && !f.meeting) f.meeting = o.date;
    first.set(o.accountId, f);
  }
  const outcomes = confirmed.filter((l) => !since || l.date >= since);

  const accounts = new Map();
  for (const o of outcomes) {
    const f = first.get(o.accountId);
    const a = accounts.get(o.accountId) ?? { types: new Set(), tier: o.tier ?? null, firstSignalDate: f.signal, firstMeeting: f.meeting, calls: 0, reached: new Set() };
    a.calls += 1;
    for (const c of o.codes) a.reached.add(c);
    for (const t of o.originSignalTypes ?? []) a.types.add(t);
    accounts.set(o.accountId, a);
  }

  const codes = Object.keys(OUTCOME_CODES);
  const empty = () => ({ accounts: 0, calls: 0, reached: Object.fromEntries(codes.map((c) => [c, 0])) });
  const tally = (keysOf) => {
    const out = {};
    for (const a of accounts.values()) {
      for (const k of keysOf(a)) {
        const g = (out[k] ??= empty());
        g.accounts += 1; g.calls += a.calls;
        for (const c of a.reached) g.reached[c] += 1;
      }
    }
    return Object.fromEntries(Object.entries(out).sort(([x, gx], [y, gy]) => (gy.accounts - gx.accounts) || x.localeCompare(y)));
  };
  const lead = (a) => (a.firstSignalDate && a.firstMeeting ? days(a.firstSignalDate, a.firstMeeting) : null);
  const leads = [...accounts.values()].map(lead).filter((d) => d !== null).sort((x, y) => x - y);
  const totals = empty();
  for (const a of accounts.values()) { totals.accounts += 1; totals.calls += a.calls; for (const c of a.reached) totals.reached[c] += 1; }
  const tooFew = outcomes.length < minToTune;
  return {
    generatedAt: now.toISOString(), since, minToTune, outcomes: outcomes.length, tooFewToTune: tooFew,
    note: tooFew
      ? `${outcomes.length} confirmed outcome(s), fewer than ${minToTune}: too few to tune scoring weights on. Read these counts as a record, not a result.`
      : `${outcomes.length} confirmed outcomes. Enough to look at; a principal decides whether any weight changes. This report changes none.`,
    counting: '"accounts" counts each account once per group; "calls" counts confirmed calls; "reached" counts the accounts that reached each outcome in any confirmed call. An account started by several signal types counts once under each. With --since, only calls on or after it are counted, but lead time still runs from the account\'s first signal to its first held call ever.',
    totals,
    bySignalType: tally((a) => (a.types.size ? [...a.types] : [HAND_PICKED])),
    byTier: tally((a) => [a.tier ?? UNTIERED]),
    byLeadTime: tally((a) => [leadTimeBucket(lead(a), buckets)]),
    leadTimeDays: { accounts: leads.length, min: leads[0] ?? null, median: leads.length ? leads[Math.floor((leads.length - 1) / 2)] : null, max: leads.at(-1) ?? null },
    weights: 'unchanged: this report never edits scoring.json',
  };
}

export function runOutcomesReport({ dir, config, since = null, now = new Date() }) {
  if (since !== null && since !== undefined) needDate(since, '--since');
  const cfg = config?.outcomes ?? {};
  const report = buildOutcomesReport({ lines: readJsonl(join(dir, OUTCOMES_LOG)), since: since ?? null, minToTune: cfg.minToTune ?? 30, buckets: cfg.leadTimeBucketsDays ?? [30, 90, 180, 365], now });
  const path = join(dir, 'reports', `outcomes-${now.toISOString().slice(0, 10)}.json`);
  writeJson(path, report);
  audit(dir, { type: 'outcomes_report', outcomes: report.outcomes, accounts: report.totals.accounts, tooFewToTune: report.tooFewToTune });
  return { report, path };
}

const SHOWN = ['held', 'nda_requested', 'nda_signed', 'tape_promised', 'tape_received'];
export function renderOutcomesReport(r) {
  const row = (k, g) => `  ${k.padEnd(38)} ${String(g.accounts).padStart(8)} ${String(g.calls).padStart(6)} ${SHOWN.map((c) => String(g.reached[c]).padStart(12)).join('')}`;
  const head = `  ${''.padEnd(38)} ${'accounts'.padStart(8)} ${'calls'.padStart(6)} ${['held', 'NDA asked', 'NDA signed', 'tape prom.', 'tape recd'].map((h) => h.padStart(12)).join('')}`;
  const table = (title, groups) => [title, head, ...Object.entries(groups).map(([k, g]) => row(k, g)), ''];
  return [
    `Confirmed call outcomes${r.since ? ` since ${r.since}` : ''}: ${r.outcomes}. ${r.note}`, '',
    ...table('By the signal types that started the account', r.bySignalType),
    ...table('By tier', r.byTier),
    ...table('By lead time, first signal to first meeting', r.byLeadTime),
    `Lead time in days over ${r.leadTimeDays.accounts} account(s): min ${r.leadTimeDays.min ?? '-'}, median ${r.leadTimeDays.median ?? '-'}, max ${r.leadTimeDays.max ?? '-'}.`,
    `Totals: ${r.totals.accounts} account(s), ${r.totals.calls} call(s). Other outcomes: ${Object.keys(r.totals.reached).filter((c) => !SHOWN.includes(c)).map((c) => `${c} ${r.totals.reached[c]}`).join(', ')}.`,
    r.counting, `Scoring weights: ${r.weights}.`,
  ].join('\n');
}
