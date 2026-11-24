// The weekly triage (PRD E6-S5). Every Monday: what changed since the last triage across every data source, grouped by institution and
// sorted into act now, watch or already in conversation, each with one line of reasoning; where we are in the calendar; and the health
// of the sources. Code only, no model: every sentence is a fixed template filled with computed values, and the same inputs always give
// the same triage. It compares the current state with the previous triage's snapshot (triage/state.json): each candidate's tier and
// signal ids, and every event seen. The rules (the window, what counts as act now and watch, the calendar) live in triage.json, all
// placeholders.
//
// The triage is internal. It is prospect data, kept in the data folder (and the platform), for the firm's principals only. It is never
// sent to anyone and never given to the drafter: the quarter-end calendar decides when a principal looks, never what a message says
// (PRD E10-S1), and the linter keeps quarter-end language out of messages. Its audit line carries counts only.
import { join } from 'node:path';
import { readJson, readJsonl, writeJson, writeText, readText, listFiles, audit } from './store.mjs';
import { norm } from './guard.mjs';
import { suppressedBy } from './candidates.mjs';
import { periodLabel, shiftQuarter, signalTitle } from './metrics.mjs';
import { contentHash } from './score.mjs';
import { filingSignals, loadFilingRules } from './sources/filings.mjs';
import { FDIC_LOAN_SALES_URL } from './sources/fdic.mjs';
import { LOADS } from './uow.mjs';
import { eventShown, scopeShown } from './loans.mjs';

export const CATEGORIES = Object.freeze(['actNow', 'watch', 'inConversation']);
export const CATEGORY_LABELS = Object.freeze({ actNow: 'Act now', watch: 'Watch', inConversation: 'Already in conversation' });
// Every kind of finding, each with its own fixed template below. Which are act now is decided by triage.json `actNow`.
export const FINDING_TYPES = Object.freeze(['cmbs-note-sale', 'failure-in-metros', 'sec-filing-strong', 'new-tier-a', 'tier-up-a', 'concentration-tier-a',
  'sec-filing', 'acquisition', 'cmbs-special-servicing', 'new-tier-b', 'tier-down-b', 'state-on', 'county-cmbs', 'county-document', 'dropped', 'state-off']);
export const HEALTH_SOURCES = Object.freeze(['fdic', 'edgar', 'filings']);
const TOUCH_EVENTS = ['reply', 'opt_out', 'bounce', 'meeting', 'handoff'];
export const INTERNAL_NOTE = 'Internal: for the firm\'s principals only. It is never sent to anyone and never given to the drafter. The calendar decides when to look, never what a message says.';
export const FIRST_RUN_NOTE = 'First triage, no comparison: there is no earlier snapshot, so new candidates, tier changes and signals that turned on or off are not reported. Events dated in the window are. The next triage compares with this one.';

const DAY = 86400000;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const uniq = (a) => [...new Set(a)];
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => new Date(d).toISOString().slice(0, 10);
export const validDate = (s) => typeof s === 'string' && YMD.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && ymd(`${s}T00:00:00Z`) === s;
const dayNum = (s) => Math.floor(Date.parse(`${s}T00:00:00Z`) / DAY);
export const addDays = (s, n) => new Date((dayNum(s) + n) * DAY).toISOString().slice(0, 10);
export const daysBetween = (from, to) => dayNum(to) - dayNum(from);
const repToYmd = (r) => (/^\d{8}$/.test(String(r ?? '')) ? `${String(r).slice(0, 4)}-${String(r).slice(4, 6)}-${String(r).slice(6, 8)}` : null);
const ymdToRep = (s) => s.replace(/-/g, '');
export const longDate = (s) => (validDate(s) ? periodLabel(ymdToRep(s)) : String(s ?? ''));
const repLabel = (r) => (/^\d{8}$/.test(String(r ?? '')) ? periodLabel(r) : String(r ?? ''));
const listWords = (xs) => (xs.length <= 1 ? xs.join('') : xs.length === 2 ? `${xs[0]} and ${xs[1]}` : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
const certOf = (key) => (/^fdic:\d+$/.test(key) ? key.slice(5) : undefined);
const tiered = (t) => t === 'A' || t === 'B';

export const triagePaths = (dir, date) => ({
  state: join(dir, 'triage', 'state.json'),
  json: date ? join(dir, 'triage', `${date}.json`) : null,
  md: date ? join(dir, 'triage', `${date}.md`) : null,
});
// What a triage run reads and writes in a unit of work: LOADS.triage, plus the day's two output files, so past triages are never loaded.
export const triageLoads = (date) => [...LOADS.triage, `triage/${date}.json`, `triage/${date}.md`];

// ---- The rules file ------------------------------------------------------------------------------------------------------------
export function validateTriageRules(r) {
  if (!isObj(r)) return ['triage.json is not an object'];
  const e = [];
  const int = (v, min, max = Infinity) => Number.isInteger(v) && v >= min && v <= max;
  const ids = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string' && x.length > 0);
  if (!int(r.window?.defaultDays, 1, 366)) e.push('window.defaultDays must be a whole number from 1 to 366');
  if (!int(r.window?.maxEventAgeDays, 1, 3660)) e.push('window.maxEventAgeDays must be a whole number of 1 or more');
  for (const k of ['cmbsNoteSale', 'failureInMetros', 'moveToTierA', 'requirePassesFilters']) if (typeof r.actNow?.[k] !== 'boolean') e.push(`actNow.${k} must be true or false`);
  for (const k of ['secFilingSearches', 'concentrationOnTierA']) if (!ids(r.actNow?.[k])) e.push(`actNow.${k} must be a list of ids`);
  const st = r.watch?.stateSignalTiers;
  if (!Array.isArray(st) || st.some((t) => !['A', 'B'].includes(t))) e.push('watch.stateSignalTiers must list A, B or both');
  for (const k of ['signalsOff', 'droppedOut']) if (typeof r.watch?.[k] !== 'boolean') e.push(`watch.${k} must be true or false`);
  const conv = r.inConversation?.events;
  if (!ids(conv) || !conv.length || conv.some((x) => !TOUCH_EVENTS.includes(x) || x === 'opt_out')) e.push(`inConversation.events must list one or more of ${TOUCH_EVENTS.filter((x) => x !== 'opt_out').join(', ')}`);
  const oo = r.optOut?.events;
  if (!ids(oo) || !oo.includes('opt_out') || oo.some((x) => !TOUCH_EVENTS.includes(x))) e.push('optOut.events must include opt_out, and list guard events only');
  if (!int(r.calendar?.reviewWindowWeeks, 1, 13)) e.push('calendar.reviewWindowWeeks must be a whole number from 1 to 13');
  if (!int(r.calendar?.callReportLagDays, 0, 365)) e.push('calendar.callReportLagDays must be a whole number from 0 to 365');
  if (!int(r.calendar?.cmbsReportingDay, 1, 31)) e.push('calendar.cmbsReportingDay must be a whole number from 1 to 31');
  for (const s of [...HEALTH_SOURCES, 'scoring']) if (!int(r.health?.staleDays?.[s], 1)) e.push(`health.staleDays.${s} must be a whole number of 1 or more`);
  for (const t of FINDING_TYPES) if (!(typeof r.strength?.[t] === 'number' && Number.isFinite(r.strength[t]))) e.push(`strength.${t} must be a number`);
  return e;
}

// ---- The calendar --------------------------------------------------------------------------------------------------------------
// Pure date math on YYYY-MM-DD strings, in UTC. A quarter-end is March 31, June 30, September 30 or December 31.
const QUARTER_ENDS = [[3, 31], [6, 30], [9, 30], [12, 31]];
export function nextQuarterEnd(today) {   // on or after today
  const y = Number(today.slice(0, 4));
  for (const yr of [y, y + 1]) for (const [m, d] of QUARTER_ENDS) { const s = `${yr}-${pad(m)}-${pad(d)}`; if (s >= today) return s; }
  return null;
}
export function lastQuarterEnd(today) {   // strictly before today
  const y = Number(today.slice(0, 4));
  for (const yr of [y, y - 1]) for (const [m, d] of [...QUARTER_ENDS].reverse()) { const s = `${yr}-${pad(m)}-${pad(d)}`; if (s < today) return s; }
  return null;
}
export function nextMonthDay(today, day) {   // the next date on or after today that falls on `day` of its month (clamped to the month's end)
  let y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
  for (let i = 0; i < 2; i++) {
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const s = `${y}-${pad(m)}-${pad(Math.min(day, last))}`;
    if (s >= today) return s;
    m += 1; if (m > 12) { m = 1; y += 1; }
  }
  return null;
}

export function calendarBlock({ today, latestRepdte, calendar }) {
  const qe = nextQuarterEnd(today);
  const opens = addDays(qe, -7 * calendar.reviewWindowWeeks);
  const open = today >= opens && today <= qe;
  // The next FDIC quarter is the one after the latest published; with no FDIC data, the last quarter that has ended.
  const nextRep = latestRepdte && /^\d{8}$/.test(String(latestRepdte)) ? shiftQuarter(String(latestRepdte), 1) : ymdToRep(lastQuarterEnd(today));
  const nextRepYmd = repToYmd(nextRep);
  const expected = addDays(nextRepYmd, calendar.callReportLagDays);
  const cmbs = nextMonthDay(today, calendar.cmbsReportingDay);
  return {
    today,
    quarterEnd: { date: qe, daysUntil: daysBetween(today, qe) },
    reviewWindow: { weeks: calendar.reviewWindowWeeks, opens, closes: qe, open, daysUntilOpen: open ? 0 : daysBetween(today, opens), daysLeft: open ? daysBetween(today, qe) : null },
    fdic: { quarter: nextRep, quarterEnd: nextRepYmd, expected, lagDays: calendar.callReportLagDays, basedOn: latestRepdte ?? null, overdueDays: expected < today ? daysBetween(expected, today) : 0 },
    cmbs: { date: cmbs, day: calendar.cmbsReportingDay, daysUntil: daysBetween(today, cmbs) },
  };
}

// ---- Who we are already talking to ---------------------------------------------------------------------------------------------
// The guard's log (touches.jsonl) grouped by institution. An account promoted from the candidate list carries its institution key; a
// hand-picked account is matched to a candidate by its name or aliases, and otherwise stands as itself (account:<id>). Two accounts at
// one institution are one group.
export function relations({ touches = [], accounts = [], items = [], aliases = {}, rules }) {
  const acct = new Map(accounts.map((a) => [a.id, a]));
  const keyByName = new Map();
  for (const it of [...items].sort((a, b) => cmp(a.key, b.key))) { const n = norm(it.name); if (n && !keyByName.has(n)) keyByName.set(n, it.key); }
  for (const k of Object.keys(aliases).sort()) for (const a of aliases[k] ?? []) { const n = norm(a); if (n && !keyByName.has(n)) keyByName.set(n, k); }
  const groups = new Map();
  const byName = new Map();
  for (const t of touches) {
    if (!t || typeof t !== 'object') continue;
    const a = acct.get(t.accountId);
    const names = uniq([t.institution, a?.name, ...(a?.aliases ?? [])].map(norm).filter(Boolean));
    const key = a?.institutionKey ?? names.map((n) => keyByName.get(n)).find(Boolean) ?? (t.accountId ? `account:${t.accountId}` : `name:${names[0] ?? 'unknown'}`);
    const g = groups.get(key) ?? names.map((n) => byName.get(n)).find(Boolean) ?? { key, name: a?.name ?? t.institution ?? key, names: new Set(), accountIds: new Set(), rows: [] };
    if (/^(account|name):/.test(g.key) && !/^(account|name):/.test(key)) { g.key = key; g.name = a?.name ?? t.institution ?? g.name; }   // a real institution key wins
    groups.set(key, g);
    for (const n of names) { g.names.add(n); if (!byName.has(n)) byName.set(n, g); }
    if (t.accountId) g.accountIds.add(t.accountId);
    g.rows.push(t);
  }
  const out = [];
  for (const g of new Set(groups.values())) {
    const dated = g.rows.filter((r) => validDate(String(r.date ?? '').slice(0, 10)));
    const latest = dated.reduce((best, r) => (!best || String(r.date) > String(best.date) ? r : best), null);
    const conversation = dated.filter((r) => rules.inConversation.events.includes(r.type)).map((r) => ({ type: r.type, date: String(r.date).slice(0, 10) }))
      .sort((a, b) => cmp(b.date, a.date) || cmp(a.type, b.type));
    const optOuts = dated.filter((r) => rules.optOut.events.includes(r.type)).map((r) => String(r.date).slice(0, 10)).sort();
    out.push({ key: g.key, name: g.name, names: g.names, accountIds: [...g.accountIds].sort(), latestTouch: latest ? { date: String(latest.date).slice(0, 10), type: latest.type } : null,
      conversation, optedOut: optOuts.length > 0 || g.rows.some((r) => rules.optOut.events.includes(r.type)), optOuts });
  }
  return out.sort((a, b) => cmp(a.key, b.key));
}

// The order of the county lines among themselves (docs/county-loans.md 3a): a property the county's parcel record puts in a buy-box
// sector first (buybox.json sectors.include: hospitality, multifamily, retail), then another commercial sector, then commercial land.
// Every one of them still shows. (Only a lead has an event: a filing whose property no parcel confirms has no line here.)
export const countyRank = (sector, buyboxSectors = []) => (sector && buyboxSectors.includes(sector) ? 0 : sector ? 1 : 2);

// ---- The run ---------------------------------------------------------------------------------------------------------------------
// rules: triage.json. metros and scoring (metros.json, scoring.json) supply labels only; buybox (buybox.json) the sectors whose county
// lines come first. since: YYYY-MM-DD, the start of the window.
export function runTriage({ dir, rules, now = new Date(), since, metros, scoring, filingRules, buybox = null } = {}) {
  const errs = validateTriageRules(rules);
  if (errs.length) throw new Error(`triage.json has errors:\n  ${errs.join('\n  ')}`);
  const today = ymd(now);
  if (since !== undefined && since !== null) {
    if (!validDate(since)) throw new Error('--since needs a date: YYYY-MM-DD.');
    if (since > today) throw new Error(`--since ${since} is in the future.`);
  }
  const P = triagePaths(dir, today);

  // The snapshot to compare with. A second run on the same day compares with the same snapshot as the first, so re-running Monday's
  // triage recomputes Monday's triage rather than an empty one.
  const prevState = readJson(P.state, null);
  const base = prevState ? (prevState.date === today ? prevState.baseline ?? null : prevState) : null;

  // The window: [from, to]. Instants compare as instants; a date-only value is in the window when its day is.
  const toMs = now.getTime();
  let fromMs, basis;
  if (since) { fromMs = Date.parse(`${since}T00:00:00Z`); basis = 'since'; }
  else if (base?.generatedAt && !Number.isNaN(Date.parse(base.generatedAt))) { fromMs = Math.min(Date.parse(base.generatedAt), toMs); basis = 'lastTriage'; }
  else { fromMs = toMs - rules.window.defaultDays * DAY; basis = 'default'; }
  const fromDay = ymd(fromMs);
  const window = { from: new Date(fromMs).toISOString(), to: now.toISOString(), fromDate: fromDay, toDate: today, basis, defaultDays: rules.window.defaultDays };
  const inWindowAt = (iso) => { const t = Date.parse(String(iso ?? '')); return !Number.isNaN(t) && t >= fromMs && t <= toMs; };
  const inWindowDay = (d) => validDate(d) && d >= fromDay && d <= today;
  const ageFloor = addDays(today, -rules.window.maxEventAgeDays);

  // Events: with a snapshot, an event is new when the snapshot has not seen it (so one the FDIC indexed late is still caught); with
  // none, or with --since, when its date (for a filing: when we first saw it) is in the window. An event dated in the future, or more
  // than maxEventAgeDays ago, is never new.
  const useSeen = !!base && !since;
  const seenPrev = isObj(base?.seen) ? base.seen : {};
  const seenNow = {};
  const newness = ({ seenKey, date, at, noLate = false }) => {
    seenNow[seenKey] = today;
    if (!validDate(date) || date > today || date < ageFloor) return null;
    if (useSeen) {
      if (seenPrev[seenKey] !== undefined) return null;
      return { late: !noLate && (at ? !inWindowAt(at) : date < fromDay) };
    }
    return (at ? inWindowAt(at) : inWindowDay(date)) ? { late: false } : null;
  };
  const lateNote = (n, date) => (n.late ? ` Dated ${longDate(date)}, before this window: first seen since the last triage.` : '');

  // Inputs. Every one is optional: a source that has not run yet adds nothing.
  const latest = readJson(join(dir, 'candidates', 'latest.json'), null);
  const items = latest?.items ?? [];
  const byKey = new Map(items.map((i) => [i.key, i]));
  const decisions = readJson(join(dir, 'candidates', 'decisions.json'), {});
  const aliases = readJson(join(dir, 'candidates', 'aliases.json'), {});
  const suppression = readJson(join(dir, 'suppression.json'), { entries: [] }).entries ?? [];
  const touches = readJsonl(join(dir, 'touches.jsonl'));
  const accounts = listFiles(join(dir, 'accounts'), '.json').map((f) => readJson(join(dir, 'accounts', f), null)).filter((a) => a && typeof a.id === 'string');
  const runs = readJsonl(join(dir, 'sources', 'runs.jsonl'));
  const fdicState = readJson(join(dir, 'sources', 'fdic', 'state.json'), null);
  const failed = readJson(join(dir, 'sources', 'fdic', 'failed.json'), {});
  const loans = readJson(join(dir, 'sources', 'edgar', 'loans.json'), {});
  const countyEvents = readJson(join(dir, 'loans', 'events.json'), {});
  const cmbsLinks = readJson(join(dir, 'loans', 'cmbs.json'), null)?.links ?? {};
  const filings = filingSignals({ dir, rules: filingRules ?? loadFilingRules() });

  const labelOf = (c) => metros?.metros?.find((m) => m.cbsa === String(c))?.label ?? `CBSA ${c}`;
  // A rule's title, as its stored signals carry it (signalTitle, src/metrics.mjs): built from the rule, with its scoring.json label as the fallback.
  const ruleLabels = new Map([...(scoring?.signals ?? []), ...(scoring?.concentration?.signals ?? [])].map((r) => [r.id, signalTitle(r) ?? r.label]));
  const signalLabel = (type) => ruleLabels.get(type) ?? type;
  const nameOf = (key) => byKey.get(key)?.name || base?.candidates?.[key]?.name || key;

  // ---- Findings: one per change, each from its own template ----
  const findings = [];
  const add = (f) => findings.push({ ids: [], dates: [], signalIds: [], links: {}, rank: 0, ...f, strength: rules.strength[f.type] });
  const buyboxSectors = Array.isArray(buybox?.sectors?.include) ? buybox.sectors.include : [];

  // SEC filings (E13-S1), straight from the listener's store so a filing found since the last scoring run is not missed.
  const strong = new Set(rules.actNow.secFilingSearches);
  for (const key of Object.keys(filings).sort()) {
    for (const s of filings[key]) {
      const isStrong = (s.searches ?? []).some((x) => strong.has(x));
      const n = newness({ seenKey: isStrong ? `${s.id}:strong` : s.id, date: s.fileDate, at: s.firstSeenAt });
      if (!n) continue;
      add({ key, name: nameOf(key), type: isStrong ? 'sec-filing-strong' : 'sec-filing', act: isStrong,
        reason: `${isStrong ? 'An SEC filing matched a loan-sale or held-for-sale search' : 'An SEC filing matched a saved search'}: ${s.label}.${lateNote(n, s.fileDate)}`,
        ids: [s.id], dates: [s.fileDate], signalIds: [s.id], links: { filing: s.link ?? null } });
    }
  }

  // Acquisitions (E3-S6): the event signals scoring attached to the acquirer.
  for (const it of [...items].sort((a, b) => cmp(a.key, b.key))) {
    for (const s of it.signals ?? []) {
      if (s.rule !== 'acquisition' || !validDate(s.effective)) continue;
      const n = newness({ seenKey: s.id, date: s.effective });
      if (!n) continue;
      const where = listWords(uniq((s.metros ?? []).map((m) => m.label ?? labelOf(m.cbsa))));
      add({ key: it.key, name: it.name, type: 'acquisition', act: false,
        reason: `${s.eventKind === 'failure' ? 'It took over a failed bank' : 'It acquired a bank'} (FDIC cert ${String(s.targetCert).replace(/\D/g, '')}) with a presence in ${where || 'our metros'}, effective ${longDate(s.effective)}.${lateNote(n, s.effective)}`,
        ids: [s.id], dates: [s.effective], signalIds: [s.id] });
    }
  }

  // Failures in our metros (E3-S5). The FDIC is the seller; the failed bank is the institution.
  for (const f of Object.values(failed).filter((x) => x && x.inMetros && validDate(x.failedOn)).sort((a, b) => cmp(String(a.cert), String(b.cert)))) {
    const id = `fdic-failure:${f.cert}`;
    const n = newness({ seenKey: id, date: f.failedOn });
    if (!n) continue;
    const where = listWords(uniq((f.metros ?? []).map((m) => labelOf(m.cbsa))));
    add({ key: `fdic:${f.cert}`, name: f.name || `FDIC cert ${f.cert}`, type: 'failure-in-metros', act: rules.actNow.failureInMetros, exempt: true,
      reason: `It failed on ${longDate(f.failedOn)}, with a presence in ${where || 'our metros'}. The FDIC is the seller of its loans, usually in sealed-bid pools.${lateNote(n, f.failedOn)}`,
      ids: [id], dates: [f.failedOn], signalIds: [id], links: { fdicLoanSales: f.loanSales ?? FDIC_LOAN_SALES_URL } });
  }

  // CMBS loans in our metros (E4-S3): newly coded for a note sale, or newly in special servicing. The special servicer is the
  // institution. Loans are asset-level: only the loan key, metros and sectors are stated, never a property.
  for (const loan of Object.values(loans).filter((l) => l && typeof l.key === 'string' && !l.paidOff).sort((a, b) => cmp(a.key, b.key))) {
    const types = new Set((loan.signals ?? []).map((s) => s.type));
    const servicer = typeof loan.specialServicer === 'string' && loan.specialServicer ? loan.specialServicer : 'Unknown';
    const key = `servicer:${servicer}`;
    const name = servicer === 'Unknown' ? 'Special servicer not identified' : servicer;
    const where = listWords(uniq((loan.metros ?? []).map(labelOf)));
    const sectors = listWords(uniq(loan.sectors ?? []));
    const who = servicer === 'Unknown' ? 'its special servicer could not be read from the trust\'s report' : `${servicer} is its special servicer`;
    const links = { servicer: `/servicers/${encodeURIComponent(servicer)}` };
    if (types.has('note_sale')) {
      const date = validDate(loan.period) ? loan.period : ymd(loan._source?.fetchedAt ?? now);
      const id = `${loan.key}:note_sale`;
      const n = newness({ seenKey: id, date, noLate: true });
      if (n) add({ key, name, type: 'cmbs-note-sale', act: rules.actNow.cmbsNoteSale, exempt: true,
        reason: `A CMBS loan in ${where || 'our metros'}${sectors ? ` (${sectors})` : ''} is newly coded for a note sale (workout code 5); ${who}.`,
        ids: [id], dates: [date], signalIds: [id], links });
    }
    if (types.has('special_servicing') && validDate(loan.specialServicingSince)) {
      const id = `${loan.key}:special_servicing:${loan.specialServicingSince}`;
      const n = newness({ seenKey: id, date: loan.specialServicingSince });
      if (n) add({ key, name, type: 'cmbs-special-servicing', act: false, exempt: true,
        reason: `A CMBS loan in ${where || 'our metros'}${sectors ? ` (${sectors})` : ''} moved to special servicing on ${longDate(loan.specialServicingSince)}; ${who}.${lateNote(n, loan.specialServicingSince)}`,
        ids: [id], dates: [loan.specialServicingSince], signalIds: [id], links });
    }
  }

  // County loan documents (docs/county-loans.md): each document newly matched to a bank is a dated event, for a principal's context.
  // Always watch, never act now (no rule in triage.json makes it one), and it carries no signal id, so it never brings back a bank a
  // principal dismissed: an event is context, not a signal, and nothing scores it. Its line is the event's own fixed template.
  // The scope guard (src/loans.mjs, eventShown): only an event the scope rule wrote, about a lead (a county parcel confirmed commercial,
  // multifamily of 5 or more units, or commercial land), on the bank that holds the loan now. An event written before the rule waits for
  // `outbound loans rebuild`. The line
  // names the property and whether the county's parcel record confirmed it; a buy-box sector comes first among the county lines
  // (countyRank), and a property type from a parcel record is attributed under the list.
  for (const e of Object.values(countyEvents).filter((x) => x && typeof x.id === 'string' && /^fdic:\d+$/.test(String(x.key)) && eventShown(x)).sort((a, b) => cmp(a.id, b.id))) {
    const n = newness({ seenKey: e.id, date: e.date, at: e.matchedAt });
    if (!n) continue;
    const sector = typeof e.sector === 'string' && e.sector ? e.sector : null;
    add({ key: e.key, name: nameOf(e.key), type: 'county-document', act: false, reason: `${e.label}${lateNote(n, e.date)}`, ids: [e.id], dates: [e.date],
      rank: countyRank(sector, buyboxSectors), sector, propertySource: typeof e.propertySource === 'string' && e.propertySource ? e.propertySource : null });
  }

  // County filings on CMBS loans (docs/county-loans.md section 9, src/cmbslinks.mjs): a document whose current holder is a CMBS trust,
  // linked to the trust's own record of the loan. The special servicer is the institution, as for the CMBS findings above. The same
  // rules as a county event: always watch, no signal id, the scope guard (scopeShown), and its line is the link's own fixed template.
  for (const l of Object.values(cmbsLinks).filter((x) => x && x.status === 'linked' && typeof x.documentId === 'string' && x.cmbs?.loanKey && scopeShown(x)).sort((a, b) => cmp(a.id, b.id))) {
    const servicer = typeof l.cmbs.specialServicer === 'string' && l.cmbs.specialServicer ? l.cmbs.specialServicer : 'Unknown';
    const id = `cmbs-link:${l.documentId}:${l.cmbs.loanKey}`;
    const n = newness({ seenKey: id, date: l.date, at: l.firstSeenAt });
    if (!n) continue;
    add({ key: `servicer:${servicer}`, name: servicer === 'Unknown' ? 'Special servicer not identified' : servicer, type: 'county-cmbs', act: false, exempt: true,
      reason: `${l.label}${lateNote(n, l.date)}`, ids: [id], dates: [l.date], links: { servicer: `/servicers/${encodeURIComponent(servicer)}` } });
  }

  // Changes against the snapshot: new candidates, tier changes, candidates that dropped out, state signals on and off.
  const asOf = latest?.asOf ?? (latest?.scoredAt ? String(latest.scoredAt).slice(0, 10) : today);
  if (base && latest) {
    const prevC = isObj(base.candidates) ? base.candidates : {};
    const stateTiers = rules.watch.stateSignalTiers;
    const scoreRef = (k) => `score:${latest.runId}:${k}`;
    for (const it of [...items].sort((a, b) => cmp(a.key, b.key))) {
      const p = prevC[it.key];
      const T = it.tier ?? null;
      const was = p ? p.tier ?? null : null;
      const line = `score ${it.score} (distress ${it.axes?.distress ?? 0}, fit ${it.axes?.fit ?? 0}, timing ${it.axes?.timing ?? 0}) on data as of ${repLabel(it.latestRepdte)}`;
      const tierF = (type, act, reason) => add({ key: it.key, name: it.name, type, act, reason, ids: [scoreRef(it.key)], dates: [asOf] });
      if (tiered(T) && !tiered(was)) tierF(T === 'A' ? 'new-tier-a' : 'new-tier-b', T === 'A' && rules.actNow.moveToTierA, `New candidate at Tier ${T}: ${line}.`);
      else if (T === 'A' && was === 'B') tierF('tier-up-a', rules.actNow.moveToTierA, `Moved from Tier B to Tier A: ${line}.`);
      else if (T === 'B' && was === 'A') tierF('tier-down-b', false, `Moved from Tier A to Tier B: ${line}.`);
      else if (!tiered(T) && tiered(was) && rules.watch.droppedOut) tierF('dropped', false, `Dropped out of the candidate list: it was Tier ${was}, and ${it.filtersFailed?.length ? 'now fails a hard filter' : 'its score is now below the Tier B cut'}.`);
      // State signals, compared by type: a state signal's id carries its quarter, so a new quarter alone changes no type.
      if (p && (stateTiers.includes(T) || stateTiers.includes(was))) {
        const cur = new Map((it.signals ?? []).filter((s) => s.kind === 'state').map((s) => [s.type, s]));
        const before = new Map((p.signals ?? []).filter((s) => s.kind === 'state').map((s) => [s.type, s]));
        for (const type of [...cur.keys()].sort()) {
          if (before.has(type)) continue;
          const s = cur.get(type);
          const conc = T === 'A' && rules.actNow.concentrationOnTierA.includes(type);
          const label = s.label ?? signalLabel(type);
          add({ key: it.key, name: it.name, type: conc ? 'concentration-tier-a' : 'state-on', act: conc,
            reason: conc ? `A Tier A bank now meets the CRE concentration screen: ${label}, as of ${repLabel(s.period)}.` : `New signal: ${label}, as of ${repLabel(s.period)}.`,
            ids: [s.id], dates: [repToYmd(s.period) ?? asOf], signalIds: [s.id] });
        }
        if (rules.watch.signalsOff) for (const type of [...before.keys()].sort()) {
          if (cur.has(type)) continue;
          add({ key: it.key, name: it.name, type: 'state-off', act: false, reason: `Signal no longer on: ${signalLabel(type)}.`, ids: [before.get(type).id], dates: [asOf] });
        }
      }
    }
    if (rules.watch.droppedOut) {
      for (const k of Object.keys(prevC).sort()) {
        if (byKey.has(k) || !tiered(prevC[k]?.tier)) continue;
        add({ key: k, name: prevC[k].name || k, type: 'dropped', act: false, reason: `Dropped out of the candidate list: it was Tier ${prevC[k].tier}, and the latest scoring run no longer scores it.`, ids: [`score:${latest.runId}:${k}`], dates: [asOf] });
      }
    }
  }

  // ---- Who is left out, and who is in conversation ----
  const rels = relations({ touches, accounts, items, aliases, rules });
  const relByKey = new Map(rels.map((r) => [r.key, r]));
  const relByName = new Map();
  for (const r of rels) for (const n of r.names) if (!relByName.has(n)) relByName.set(n, r);
  const relFor = (key, name) => relByKey.get(key) ?? [name, ...(aliases[key] ?? [])].map(norm).filter(Boolean).map((n) => relByName.get(n)).find(Boolean) ?? null;
  const isSuppressed = (key, name) => !!suppressedBy({ key, cert: certOf(key), name }, suppression, aliases);
  const accountFor = (key) => {
    if (key.startsWith('account:')) return key.slice(8);
    const d = decisions[key];
    if (d?.status === 'promoted' && d.accountId) return d.accountId;
    return accounts.filter((a) => a.institutionKey === key).map((a) => a.id).sort()[0] ?? null;
  };
  const returned = new Set();   // dismissed candidates a new signal has brought back
  const decisionFor = (key, fs) => {
    const d = decisions[key];
    if (d?.status === 'snoozed' && validDate(d.until)) return today < d.until ? { held: 'snoozed' } : { note: `The snooze ended on ${longDate(d.until)}.` };
    if (d?.status === 'dismissed') {
      const known = new Set(d.signalIds ?? []);
      const fresh = (byKey.get(key)?.signals ?? []).some((s) => !known.has(s.id)) || fs.some((f) => f.signalIds.some((id) => !known.has(id)));
      if (fresh) returned.add(key);
      return fresh ? { note: `Dismissed on ${longDate(ymd(d.at ?? now))}; a new signal has fired since.` } : { held: 'dismissed' };
    }
    return {};
  };

  const groups = new Map();
  for (const f of findings) { if (!groups.has(f.key)) groups.set(f.key, []); groups.get(f.key).push(f); }
  // An item leads with its act-now findings, so its one line of reasoning always says why it is in its category.
  const byFinding = (a, b) => (Number(!!b.act) - Number(!!a.act)) || (b.strength - a.strength) || (a.rank - b.rank) || cmp(b.dates.at(-1) ?? '', a.dates.at(-1) ?? '') || cmp(a.type, b.type) || cmp(a.ids[0] ?? '', b.ids[0] ?? '');
  const linksFor = (key, fs) => {
    const acct = accountFor(key);
    return {
      candidate: byKey.has(key) ? `/candidates/${encodeURIComponent(key)}` : null,
      account: acct ? `/accounts/${encodeURIComponent(acct)}` : null,
      servicer: fs.find((f) => f.links.servicer)?.links.servicer ?? null,
      filings: uniq(fs.map((f) => f.links.filing).filter(Boolean)).sort(),
      fdicLoanSales: fs.find((f) => f.links.fdicLoanSales)?.links.fdicLoanSales ?? null,
    };
  };
  const finding = (f) => ({ type: f.type, category: f.act ? 'actNow' : 'watch', strength: f.strength, reason: f.reason, ids: f.ids, dates: f.dates, ...(f.note ? { note: f.note } : {}),
    ...(f.type === 'county-document' ? { sector: f.sector ?? null, ...(f.propertySource ? { propertySource: f.propertySource } : {}) } : {}) });
  const makeItem = (key, name, category, fs, extra = {}) => {
    const sorted = [...fs].sort(byFinding);
    const dates = uniq(sorted.flatMap((f) => f.dates)).filter(Boolean).sort();
    const notes = uniq([...sorted.map((f) => f.note).filter(Boolean), ...(extra.notes ?? [])]);
    const cand = byKey.get(key);
    return { key, name, category, strength: sorted[0]?.strength ?? 0, rank: sorted[0]?.rank ?? 0, date: extra.date ?? dates.at(-1) ?? null, reason: extra.reason ?? sorted[0]?.reason ?? '',
      ...(cand ? { tier: cand.tier ?? null } : {}), findings: sorted.map(finding), ids: uniq(sorted.flatMap((f) => f.ids)), dates, links: linksFor(key, sorted),
      ...(notes.length ? { notes } : {}), ...(extra.latestTouch ? { latestTouch: extra.latestTouch, conversation: extra.conversation } : {}) };
  };

  const counts = { actNow: 0, watch: 0, inConversation: 0, snoozed: 0, dismissed: 0, heldBack: 0, optedOut: 0, optOutsInWindow: 0, suppressed: 0, healthIssues: 0 };
  const suppressedKeys = new Set();
  const out = { actNow: [], watch: [], inConversation: [] };
  const convFindings = new Map();
  for (const key of [...groups.keys()].sort()) {
    const fs = groups.get(key);
    const name = fs.find((f) => f.name)?.name ?? key;
    if (isSuppressed(key, name)) { suppressedKeys.add(key); continue; }
    const r = relFor(key, name);
    if (r?.optedOut) continue;
    if (r && r.conversation.length) { convFindings.set(r.key, [...(convFindings.get(r.key) ?? []), ...fs]); continue; }
    const d = decisionFor(key, fs);
    if (d.held) { counts.heldBack++; continue; }
    // A bank that fails a hard filter is not an outreach candidate, so its strong events are listed under watch (failures and
    // servicers are not scored and are exempt).
    const cand = byKey.get(key);
    const checked = fs.map((f) => {
      if (!f.act || f.exempt || !rules.actNow.requirePassesFilters) return f;
      if (!cand) return { ...f, act: false, note: 'It is not in the latest candidate list, so it is listed under watch.' };
      if (cand.filtersFailed?.length) return { ...f, act: false, note: `It fails a hard filter (${cand.filtersFailed[0]}), so it is listed under watch.` };
      return f;
    });
    const category = checked.some((f) => f.act) ? 'actNow' : 'watch';
    out[category].push(makeItem(key, name, category, checked, { notes: d.note ? [d.note] : [] }));
  }
  for (const r of rels) {
    if (r.optedOut) { counts.optedOut++; counts.optOutsInWindow += r.optOuts.filter((d) => inWindowDay(d)).length; continue; }
    if (!r.conversation.length) continue;
    const key = r.key.startsWith('name:') ? `account:${r.accountIds[0] ?? r.key.slice(5)}` : r.key;
    const name = byKey.get(r.key)?.name ?? r.name;
    if (isSuppressed(r.key, name) || [...r.names].some((n) => isSuppressed(r.key, n))) { suppressedKeys.add(r.key); continue; }
    const fs = convFindings.get(r.key) ?? [];
    const last = r.conversation[0];
    out.inConversation.push(makeItem(key, name, 'inConversation', fs.map((f) => ({ ...f, act: false })), {
      date: r.latestTouch?.date ?? last.date, latestTouch: r.latestTouch, conversation: r.conversation,
      reason: `In conversation: a ${last.type.replace('_', ' ')} recorded on ${longDate(last.date)}; the latest touch was on ${longDate(r.latestTouch?.date ?? last.date)}.${fs.length ? ` ${fs.length} new finding${fs.length === 1 ? '' : 's'} this window.` : ''}`,
    }));
  }
  for (const [key, d] of Object.entries(decisions)) {
    if (d?.status === 'snoozed' && validDate(d.until) && today < d.until) counts.snoozed++;
    if (d?.status === 'dismissed') { const known = new Set(d.signalIds ?? []); if (!returned.has(key) && !(byKey.get(key)?.signals ?? []).some((s) => !known.has(s.id))) counts.dismissed++; }
  }
  counts.suppressed = suppressedKeys.size;
  const byItem = (a, b) => (b.strength - a.strength) || (a.rank - b.rank) || cmp(b.date ?? '', a.date ?? '') || cmp(a.key, b.key);
  for (const c of CATEGORIES) { out[c].sort(byItem); counts[c] = out[c].length; }
  // CC BY 4.0: each parcel source a county line's property type came from, said once under the lists.
  const attributions = uniq(CATEGORIES.flatMap((c) => out[c].flatMap((i) => i.findings.map((f) => f.propertySource).filter(Boolean)))).sort();

  // ---- The FDIC quarter ----
  const maxRep = (...xs) => xs.filter((x) => /^\d{8}$/.test(String(x ?? ''))).map(String).sort().at(-1) ?? null;
  const latestSeen = maxRep(fdicState?.latestRepdte, latest?.latestRepdte);
  let previous, newlyPublished;
  if (base) { previous = base.latestRepdte ?? null; newlyPublished = !!latestSeen && (!previous || latestSeen > previous); }
  else { previous = fdicState?.previousRepdte ?? null; newlyPublished = !!(latestSeen && previous && latestSeen > previous && inWindowAt(fdicState?.checkedAt)); }
  const fdicQuarter = { latest: latestSeen, previous, newlyPublished, scoredOn: latest?.latestRepdte ?? null, checkedAt: fdicState?.checkedAt ?? null,
    line: newlyPublished ? `A new FDIC quarter is published: ${repLabel(latestSeen)}${previous ? ` (before: ${repLabel(previous)})` : ''}.`
      : latestSeen ? `No new FDIC quarter: the latest published is ${repLabel(latestSeen)}.` : 'No FDIC data yet.' };

  // ---- System health ----
  const finishedAt = (r) => r.finishedAt ?? r.startedAt ?? null;
  const flagged = runs.filter((r) => r && ['failed', 'suspect'].includes(r.outcome) && inWindowAt(finishedAt(r)))
    .map((r) => ({ runId: String(r.runId ?? ''), source: String(r.source ?? ''), outcome: r.outcome, finishedAt: finishedAt(r), errors: (r.errors ?? []).length, firstError: r.errors?.[0] ? String(r.errors[0]).slice(0, 200) : null }))
    .sort((a, b) => cmp(b.finishedAt, a.finishedAt) || cmp(a.runId, b.runId));
  const newest = (rs) => rs.reduce((best, r) => (!best || String(finishedAt(r)) > String(finishedAt(best)) ? r : best), null);
  const sources = HEALTH_SOURCES.map((source) => {
    const mine = runs.filter((r) => r?.source === source && finishedAt(r) && Date.parse(finishedAt(r)) <= toMs);
    const last = newest(mine); const ok = newest(mine.filter((r) => r.outcome === 'ok'));
    const limitDays = rules.health.staleDays[source];
    if (!last) return { source, status: 'never_run', limitDays };
    const ageDays = ok ? daysBetween(ymd(finishedAt(ok)), today) : null;
    return { source, status: !ok ? 'no_ok_run' : ageDays > limitDays ? 'stale' : 'fresh', lastRun: finishedAt(last), lastOutcome: last.outcome, lastOk: ok ? finishedAt(ok) : null, ageDays, limitDays };
  });
  const scoringAge = latest?.scoredAt ? daysBetween(ymd(latest.scoredAt), today) : null;
  const behind = !!(latest && latestSeen && latest.latestRepdte && latestSeen > latest.latestRepdte);
  const scoringHealth = !latest ? { status: 'none', limitDays: rules.health.staleDays.scoring }
    : { status: behind ? 'behind' : scoringAge > rules.health.staleDays.scoring ? 'stale' : 'fresh', runId: latest.runId ?? null, scoredAt: latest.scoredAt ?? null, latestRepdte: latest.latestRepdte ?? null,
      fdicLatest: latestSeen, provisional: !!latest.provisional, ageDays: scoringAge, limitDays: rules.health.staleDays.scoring };
  const health = { runs: flagged, sources, scoring: scoringHealth };
  counts.healthIssues = flagged.length + sources.filter((s) => ['stale', 'no_ok_run'].includes(s.status)).length + (scoringHealth.status === 'fresh' ? 0 : 1);

  const calendar = calendarBlock({ today, latestRepdte: latestSeen, calendar: rules.calendar });

  // On a first run, the state the next triage will compare with, in counts.
  const loanList = Object.values(loans).filter((l) => l && !l.paidOff);
  const baseline = base ? null : {
    tierA: items.filter((i) => i.tier === 'A').length, tierB: items.filter((i) => i.tier === 'B').length,
    cmbsNoteSale: loanList.filter((l) => (l.signals ?? []).some((s) => s.type === 'note_sale')).length,
    cmbsSpecialServicing: loanList.filter((l) => (l.signals ?? []).some((s) => s.type === 'special_servicing')).length,
    eventsSeen: Object.keys(seenNow).length,
  };

  const id = `triage-${today}`;
  const record = {
    version: 1, id, date: today, generatedAt: now.toISOString(), internal: INTERNAL_NOTE,
    firstRun: !base, note: base ? null : FIRST_RUN_NOTE,
    comparedWith: base ? { triageId: base.triageId ?? null, date: base.date ?? null, generatedAt: base.generatedAt ?? null } : null,
    window, rulesHash: contentHash(rules),
    candidates: latest ? { runId: latest.runId ?? null, scoredAt: latest.scoredAt ?? null, latestRepdte: latest.latestRepdte ?? null, provisional: !!latest.provisional } : null,
    fdicQuarter, counts, actNow: out.actNow, watch: out.watch, inConversation: out.inConversation, calendar, health, baseline,
    ...(attributions.length ? { attributions } : {}),
  };

  // The snapshot the next triage compares with. Seen events are kept until they have not been seen for maxEventAgeDays.
  const seen = {};
  for (const k of uniq([...Object.keys(seenPrev), ...Object.keys(seenNow)]).sort()) {
    const last = seenNow[k] ?? seenPrev[k];
    if (validDate(last) && last >= ageFloor) seen[k] = last;
  }
  const snapCandidates = latest
    ? Object.fromEntries([...items].sort((a, b) => cmp(a.key, b.key)).map((i) => [i.key, { name: i.name ?? '', tier: i.tier ?? null, signals: (i.signals ?? []).map((s) => ({ id: s.id, type: s.type, kind: s.kind })).sort((a, b) => cmp(a.id, b.id)) }]))
    : (isObj(base?.candidates) ? base.candidates : {});
  const { baseline: _drop, ...baseFlat } = base ?? {};
  const state = { version: 1, triageId: id, date: today, generatedAt: now.toISOString(), latestRepdte: latestSeen ?? base?.latestRepdte ?? null,
    scoringRunId: latest?.runId ?? base?.scoringRunId ?? null, candidates: snapCandidates, seen, baseline: base ? baseFlat : null };

  writeJson(P.json, record);
  writeText(P.md, renderTriage(record));
  writeJson(P.state, state);
  audit(dir, { type: 'triage_run', id, date: today, firstRun: record.firstRun, newQuarter: fdicQuarter.newlyPublished, ...counts });
  return record;
}

// The counts a job result and a log may carry: no names, no keys.
export const triageSummary = (r) => ({ date: r.date, firstRun: r.firstRun, newQuarter: r.fdicQuarter?.newlyPublished ?? false, ...r.counts });

// A stored triage: the given date's, or the latest. { date, record, markdown } or null.
export function readTriage({ dir, date } = {}) {
  if (date !== undefined && date !== null && !validDate(date)) throw new Error('--date needs a date: YYYY-MM-DD.');
  const d = date ?? readJson(triagePaths(dir).state, null)?.date ?? listFiles(join(dir, 'triage'), '.json').map((f) => f.replace(/\.json$/, '')).filter(validDate).sort().at(-1) ?? null;
  if (!d) return null;
  const p = triagePaths(dir, d);
  const record = readJson(p.json, null);
  const markdown = readText(p.md, null) ?? (record ? renderTriage(record) : null);
  return record || markdown ? { date: d, record, markdown } : null;
}

// ---- The written triage (triage/<date>.md) ---------------------------------------------------------------------------------------
// Fixed templates over the record; nothing here adds a fact the record does not hold.
const at = (iso) => (iso ? `${longDate(ymd(iso))}, ${new Date(iso).toISOString().slice(11, 16)} UTC` : '');
const days = (n) => `${n} day${n === 1 ? '' : 's'}`;
export function calendarLines(c) {
  return [
    `Next quarter-end: ${longDate(c.quarterEnd.date)}, ${c.quarterEnd.daysUntil === 0 ? 'today' : `in ${days(c.quarterEnd.daysUntil)}`}.`,
    c.reviewWindow.open ? `Review window: open since ${longDate(c.reviewWindow.opens)} (${c.reviewWindow.weeks} weeks before the quarter-end), ${days(c.reviewWindow.daysLeft)} left.`
      : `Review window: opens ${longDate(c.reviewWindow.opens)} (${c.reviewWindow.weeks} weeks before the quarter-end), in ${days(c.reviewWindow.daysUntilOpen)}; not open yet.`,
    `Next FDIC quarter: ${repLabel(c.fdic.quarter)}, expected around ${longDate(c.fdic.expected)} (a Call Report lag of ${days(c.fdic.lagDays)})${c.fdic.overdueDays ? `; not yet seen, ${days(c.fdic.overdueDays)} after the expected date` : ''}.`,
    `Next CMBS reporting cycle: ${longDate(c.cmbs.date)} (day ${c.cmbs.day} of each month), ${c.cmbs.daysUntil === 0 ? 'today' : `in ${days(c.cmbs.daysUntil)}`}.`,
  ];
}
export function healthLines(h) {
  const SRC = { never_run: 'has never run', no_ok_run: 'has no ok run', stale: 'is stale', fresh: 'is fresh' };
  const lines = [];
  lines.push(h.runs.length ? `Failed or suspect runs in the window: ${h.runs.length}.` : 'Failed or suspect runs in the window: none.');
  for (const r of h.runs) lines.push(`  ${r.source} run ${r.runId} was ${r.outcome} (${at(r.finishedAt)}): ${r.errors} error${r.errors === 1 ? '' : 's'}${r.firstError ? `, first: ${r.firstError}` : ''}.`);
  for (const s of h.sources) lines.push(`Source ${s.source} ${SRC[s.status]}${s.lastOk ? `: last ok run ${longDate(ymd(s.lastOk))}, ${days(s.ageDays)} ago (limit ${days(s.limitDays)})` : s.lastRun ? `: last run ${longDate(ymd(s.lastRun))} was ${s.lastOutcome}` : ''}.`);
  const sc = h.scoring;
  lines.push(sc.status === 'none' ? 'Scoring: no candidate list yet.'
    : `Scoring ${sc.status === 'behind' ? `is behind the FDIC data: it scored ${repLabel(sc.latestRepdte)}, and ${repLabel(sc.fdicLatest)} is published` : sc.status === 'stale' ? `is stale: the last run was ${days(sc.ageDays)} ago (limit ${days(sc.limitDays)})` : `is fresh: run ${sc.runId}, ${days(sc.ageDays)} ago`}${sc.provisional ? '. The list is PROVISIONAL: the buy box still has placeholders' : ''}.`);
  return lines;
}
const linkWords = (l) => [l.account ? `account ${l.account}` : null, l.candidate ? `candidate ${l.candidate}` : null, l.servicer ? `servicer ${l.servicer}` : null,
  ...(l.filings ?? []).map((u) => `filing ${u}`), l.fdicLoanSales ? `FDIC loan sales ${l.fdicLoanSales}` : null].filter(Boolean);

export function renderTriage(r) {
  const L = [];
  L.push(`# Weekly triage: ${longDate(r.date)}`, '', r.internal, '');
  const basis = r.window.basis === 'since' ? 'from --since' : r.window.basis === 'lastTriage' ? `since the last triage, ${at(r.window.from)}` : `the last ${days(r.window.defaultDays)}`;
  L.push(`- Window: ${longDate(r.window.fromDate)} to ${longDate(r.window.toDate)} (${basis}).`);
  if (r.firstRun) L.push(`- ${r.note}`);
  L.push(r.candidates ? `- Candidate list: scoring run ${r.candidates.runId}, data as of ${repLabel(r.candidates.latestRepdte)}${r.candidates.provisional ? '. PROVISIONAL: the buy box still has placeholders' : ''}.` : '- Candidate list: none yet.');
  L.push(`- FDIC: ${r.fdicQuarter.line}`);
  if (r.baseline) L.push(`- Baseline for the next comparison: Tier A ${r.baseline.tierA}, Tier B ${r.baseline.tierB}; CMBS loans coded for a note sale ${r.baseline.cmbsNoteSale}, in special servicing ${r.baseline.cmbsSpecialServicing}; ${r.baseline.eventsSeen} events seen.`);
  const section = (cat, intro) => {
    const list = r[cat];
    L.push('', `## ${CATEGORY_LABELS[cat]} (${list.length})`, '');
    if (intro) L.push(intro, '');
    if (!list.length) { L.push(cat === 'inConversation' ? 'No institution is in conversation.' : 'Nothing this window.'); return; }
    list.forEach((it, i) => {
      L.push(`${i + 1}. **${it.name}** (${it.key}): ${it.reason}`);
      const rest = cat === 'inConversation' ? it.findings : it.findings.slice(1);
      for (const f of rest) L.push(`   - ${f.reason}`);
      for (const n of it.notes ?? []) L.push(`   - Note: ${n}`);
      if (it.ids.length) L.push(`   - Ids: ${it.ids.join(', ')}. Dates: ${it.dates.join(', ')}.`);
      const lw = linkWords(it.links);
      if (lw.length) L.push(`   - Links: ${lw.join(' · ')}`);
    });
  };
  section('actNow');
  section('watch');
  section('inConversation', 'Shown apart: a principal is already talking to these institutions. Nothing here is act now.');
  if (r.attributions?.length) L.push('', `Property type: ${r.attributions.join('; ')}.`);
  const c = r.counts;
  L.push('', '## Left out', '');
  L.push(`- Snoozed: ${c.snoozed}. Dismissed: ${c.dismissed}. They come back when the snooze ends, or when a new signal fires after the dismissal. Held back this window: ${c.heldBack}.`);
  L.push(`- Opted out: ${c.optedOut} institution${c.optedOut === 1 ? '' : 's'} (${c.optOutsInWindow} in this window). Never listed.`);
  L.push(`- Suppressed: ${c.suppressed}. Never listed.`);
  L.push('', '## Calendar', '', 'Internal: it decides when a principal looks, never what a message says.', '');
  for (const l of calendarLines(r.calendar)) L.push(`- ${l}`);
  L.push('', '## System health', '');
  for (const l of healthLines(r.health)) L.push(l.startsWith('  ') ? `  - ${l.trim()}` : `- ${l}`);
  return `${L.join('\n')}\n`;
}
