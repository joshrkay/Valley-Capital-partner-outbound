// PRD E15-S4: what led to conversations. Deterministic, with no model. It reads the confirmed call outcomes (outcomes.jsonl, written
// only when a principal confirms a call: src/calls.mjs) and counts them three ways: by the signal types that started each account, by
// tier, and by the lead time from the account's first signal to its first meeting. It never changes scoring weights. Below
// config.outcomes.minToTune confirmed outcomes it says the counts are too few to tune on; above it, a principal still decides.
//
// A meeting a principal recorded by hand (`outbound guard event --type meeting`, or the account page) has no outcome, but it is a held
// call: the report counts it as one, with no other outcome code, linked to its account's origin signals. A confirmed call's own meeting
// carries `ref: call:<proposal id>` (src/calls.mjs confirmProposal), so it is never counted twice. The web app's Status page shows the
// same report (web/lib/ops.mjs outcomesOverview), counts only.
import { join } from 'node:path';
import { readJson, readJsonl, writeJson, audit, safeId } from './store.mjs';
import { OUTCOME_CODES, OUTCOMES_LOG, needDate, originOf } from './calls.mjs';

const DAY = 86400000;
const days = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);
export const HAND_PICKED = '(none: picked by hand)';
export const NO_ACCOUNT = '(unknown: no account record)';
export const UNTIERED = 'untiered';
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const TOUCHES_LOG = 'touches.jsonl';

// The settings a principal sets in config.json (placeholders until then), with the defaults the report has always used.
export function reportSettings(config) {
  const c = config?.outcomes ?? {};
  return { minToTune: c.minToTune ?? 30, buckets: c.leadTimeBucketsDays ?? [30, 90, 180, 365] };
}

// Bucket labels from the edges in config, e.g. [30, 90] -> "0-30 days", "31-90 days", "over 90 days".
export function leadTimeBucket(d, edges) {
  if (d === null || d === undefined) return 'unknown: no signal date or no meeting';
  if (d < 0) return 'meeting before the first signal';
  let lo = 0;
  for (const e of edges) { if (d <= e) return `${lo}-${e} days`; lo = e + 1; }
  return `over ${edges.at(-1)} days`;
}

const confirmedOf = (lines) => (lines ?? []).filter((l) => l?.type === 'call_outcome' && l.accountId && ISO.test(String(l.date)) && Array.isArray(l.codes));

// The meetings recorded by hand: a meeting in the touch log that no confirmed call explains, as { accountId, date }, by date. A confirmed
// call's meeting carries ref "call:<proposal id>", and so does one whose confirmation is still being finished. A meeting on the account
// and date of a confirmed call is that call's too: confirming a call finds a meeting already recorded for that day and logs no second one
// (it may have been recorded by hand first, or before refs existed). The same account and date recorded twice is one meeting.
export function handMeetings({ touches, lines }) {
  const confirmed = new Set(confirmedOf(lines).map((l) => `${l.accountId}\n${l.date}`));
  const seen = new Set();
  const out = [];
  for (const t of touches ?? []) {
    if (t?.type !== 'meeting' || !t.accountId || !ISO.test(String(t.date))) continue;
    if (typeof t.ref === 'string' && t.ref.startsWith('call:')) continue;
    const k = `${t.accountId}\n${t.date}`;
    if (confirmed.has(k) || seen.has(k)) continue;
    seen.add(k);
    out.push({ accountId: String(t.accountId), date: t.date });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.accountId.localeCompare(b.accountId));
}

// The accounts the report must read: those with a meeting recorded by hand (a confirmed outcome carries its own origin). Valid ids only.
export function accountsNeeded({ touches, lines }) {
  const ok = (id) => { try { safeId(id); return true; } catch { return false; } };
  return [...new Set(handMeetings({ touches, lines }).map((m) => m.accountId))].filter(ok);
}

// lines: outcomes.jsonl. touches: touches.jsonl (for the meetings recorded by hand). accounts: { id: account record, or null }, for the
// accounts with such a meeting (accountsNeeded); one with no record is counted under NO_ACCOUNT.
export function buildOutcomesReport({ lines, touches = [], accounts = {}, since = null, minToTune = 30, buckets = [30, 90, 180, 365], now = new Date() }) {
  const seen = new Set();
  const confirmed = confirmedOf(lines)
    .filter((l) => { const k = l.id ?? `${l.accountId}:${l.date}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .map((l) => ({ ...l, held: l.codes.includes('held'), byHand: false }));
  // A meeting recorded by hand: a held call with no outcome code, linked to the account's origin signals as they stand now.
  const byHand = handMeetings({ touches, lines: confirmed }).map((m) => {
    const a = Object.hasOwn(accounts ?? {}, m.accountId) ? accounts[m.accountId] : null;
    const origin = a ? originOf(a) : { types: [], firstSignalDate: null };
    return { id: `meeting:${m.accountId}:${m.date}`, accountId: m.accountId, date: m.date, codes: [], held: true, byHand: true, originSignalTypes: a ? origin.types : null, firstSignalDate: origin.firstSignalDate, tier: a?.tier ?? null };
  });
  const all = [...confirmed, ...byHand].sort((a, b) => (a.date === b.date ? String(a.id).localeCompare(String(b.id)) : a.date.localeCompare(b.date)));
  // An account's first signal and first held call come from every call, confirmed or recorded by hand. `since` only chooses which calls
  // are counted, so it never moves an account's first meeting to its first call inside the window.
  const first = new Map();
  for (const o of all) {
    const f = first.get(o.accountId) ?? { signal: null, meeting: null };
    if (ISO.test(String(o.firstSignalDate)) && (!f.signal || o.firstSignalDate < f.signal)) f.signal = o.firstSignalDate;
    if (o.held && !f.meeting) f.meeting = o.date;
    first.set(o.accountId, f);
  }
  const counted = all.filter((l) => !since || l.date >= since);

  const accts = new Map();
  for (const o of counted) {
    const f = first.get(o.accountId);
    const a = accts.get(o.accountId) ?? { types: new Set(), noRecord: false, tier: o.tier ?? null, firstSignalDate: f.signal, firstMeeting: f.meeting, calls: 0, byHand: 0, reached: new Set() };
    a.calls += 1;
    if (o.byHand) a.byHand += 1;
    if (o.held) a.reached.add('held');
    for (const c of o.codes) a.reached.add(c);
    if (o.originSignalTypes === null) a.noRecord = true;
    for (const t of o.originSignalTypes ?? []) a.types.add(t);
    accts.set(o.accountId, a);
  }

  const codes = Object.keys(OUTCOME_CODES);
  const empty = () => ({ accounts: 0, calls: 0, byHand: 0, reached: Object.fromEntries(codes.map((c) => [c, 0])) });
  const add = (g, a) => { g.accounts += 1; g.calls += a.calls; g.byHand += a.byHand; for (const c of a.reached) g.reached[c] += 1; };
  const tally = (keysOf) => {
    const out = {};
    for (const a of accts.values()) for (const k of keysOf(a)) add((out[k] ??= empty()), a);
    return Object.fromEntries(Object.entries(out).sort(([x, gx], [y, gy]) => (gy.accounts - gx.accounts) || x.localeCompare(y)));
  };
  const lead = (a) => (a.firstSignalDate && a.firstMeeting ? days(a.firstSignalDate, a.firstMeeting) : null);
  const leads = [...accts.values()].map(lead).filter((d) => d !== null).sort((x, y) => x - y);
  const totals = empty();
  for (const a of accts.values()) add(totals, a);
  const outcomes = counted.filter((o) => !o.byHand).length;
  const meetingsByHand = counted.length - outcomes;
  const tooFew = outcomes < minToTune;
  const hand = meetingsByHand ? ` ${meetingsByHand} meeting(s) recorded by hand are counted as held calls, but carry no outcome and do not count toward ${minToTune}.` : '';
  return {
    generatedAt: now.toISOString(), since, minToTune, outcomes, meetingsByHand, tooFewToTune: tooFew,
    note: tooFew
      ? `${outcomes} confirmed outcome(s), fewer than ${minToTune}: too few to tune scoring weights on.${hand} Read these counts as a record, not a result.`
      : `${outcomes} confirmed outcomes. Enough to look at; a principal decides whether any weight changes. This report changes none.${hand}`,
    counting: '"accounts" counts each account once per group; "calls" counts confirmed calls and meetings recorded by hand; "byHand" counts the meetings recorded by hand (a guard meeting event that no confirmed call explains), each a held call with no other outcome; "reached" counts the accounts that reached each outcome in any call. A confirmed call\'s own meeting is counted once, as the call. An account started by several signal types counts once under each. With --since, only calls on or after it are counted, but lead time still runs from the account\'s first signal to its first held call ever.',
    totals,
    bySignalType: tally((a) => (a.types.size ? [...a.types] : [a.noRecord ? NO_ACCOUNT : HAND_PICKED])),
    byTier: tally((a) => [a.tier ?? UNTIERED]),
    byLeadTime: tally((a) => [leadTimeBucket(lead(a), buckets)]),
    leadTimeDays: { accounts: leads.length, min: leads[0] ?? null, median: leads.length ? leads[Math.floor((leads.length - 1) / 2)] : null, max: leads.at(-1) ?? null },
    weights: 'unchanged: this report never edits scoring.json',
  };
}

// What the report reads from a data folder: the outcome lines, the touch log, and the accounts with a meeting recorded by hand. Read only.
export function readOutcomeInputs(dir) {
  const lines = readJsonl(join(dir, OUTCOMES_LOG));
  const touches = readJsonl(join(dir, TOUCHES_LOG));
  const accounts = Object.fromEntries(accountsNeeded({ touches, lines }).map((id) => [id, readJson(join(dir, 'accounts', `${id}.json`), null)]));
  return { lines, touches, accounts };
}

export function runOutcomesReport({ dir, config, since = null, now = new Date() }) {
  if (since !== null && since !== undefined) needDate(since, '--since');
  const report = buildOutcomesReport({ ...readOutcomeInputs(dir), since: since ?? null, ...reportSettings(config), now });
  const path = join(dir, 'reports', `outcomes-${now.toISOString().slice(0, 10)}.json`);
  writeJson(path, report);
  audit(dir, { type: 'outcomes_report', outcomes: report.outcomes, meetingsByHand: report.meetingsByHand, accounts: report.totals.accounts, tooFewToTune: report.tooFewToTune });
  return { report, path };
}

const SHOWN = ['held', 'nda_requested', 'nda_signed', 'tape_promised', 'tape_received'];
export function renderOutcomesReport(r) {
  const row = (k, g) => `  ${k.padEnd(38)} ${String(g.accounts).padStart(8)} ${String(g.calls).padStart(6)} ${String(g.byHand ?? 0).padStart(8)} ${SHOWN.map((c) => String(g.reached[c]).padStart(12)).join('')}`;
  const head = `  ${''.padEnd(38)} ${'accounts'.padStart(8)} ${'calls'.padStart(6)} ${'by hand'.padStart(8)} ${['held', 'NDA asked', 'NDA signed', 'tape prom.', 'tape recd'].map((h) => h.padStart(12)).join('')}`;
  const table = (title, groups) => [title, head, ...Object.entries(groups).map(([k, g]) => row(k, g)), ''];
  return [
    `Confirmed call outcomes${r.since ? ` since ${r.since}` : ''}: ${r.outcomes}, and ${r.meetingsByHand ?? 0} meeting(s) recorded by hand. ${r.note}`, '',
    ...table('By the signal types that started the account', r.bySignalType),
    ...table('By tier', r.byTier),
    ...table('By lead time, first signal to first meeting', r.byLeadTime),
    `Lead time in days over ${r.leadTimeDays.accounts} account(s): min ${r.leadTimeDays.min ?? '-'}, median ${r.leadTimeDays.median ?? '-'}, max ${r.leadTimeDays.max ?? '-'}.`,
    `Totals: ${r.totals.accounts} account(s), ${r.totals.calls} call(s), ${r.totals.byHand ?? 0} of them recorded by hand. Other outcomes: ${Object.keys(r.totals.reached).filter((c) => !SHOWN.includes(c)).map((c) => `${c} ${r.totals.reached[c]}`).join(', ')}.`,
    r.counting, `Scoring weights: ${r.weights}.`,
  ].join('\n');
}
