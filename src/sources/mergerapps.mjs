// Merger applications (PRD next-five E18-S3): a bank merger heard of when it is APPLIED for, not when it closes, so a principal can be
// in front of the acquirer while it decides what to do with the target's CRE book. Event signals only, no points.
//
// SOURCE: the Federal Reserve's weekly H.2 release, "Actions of the Board, Its Staff, and the Federal Reserve Banks; Applications and
// Reports Received". Checked live on 2026-11-16:
//   - Weeks live at /releases/h2/<YYYYMMDD>/ (the Saturday ending the week); /releases/h2/ links every week. robots.txt answers 404.
//   - Each week has one page per Reserve Bank district (boston.htm ... sanfrancisco.htm). Each page's table "Filings received during
//     the week ending <date>" has: Filer | Filing Type | Filing Proposal | End of Comment Period (Newspaper, Federal Register). Seen in
//     84 district pages from June 2025 to November 2026. The filing type cell can hold several codes ("3A3* 3A5Election (Domestic)").
//     An application is listed again each week its comment period runs.
//   - The codes kept: 18C (a bank merger, Bank Merger Act section 18(c)), 3A1 (becoming a bank holding company), 3A3 (a holding
//     company acquiring a bank's shares) and 3A5 (holding companies merging). 3A1 is often a bank forming its own holding company, so
//     it is labelled as such, never as an acquisition. Change in Bank Control notices name individuals and are skipped, as are
//     branches, premises, investments and the rest.
//   - Approvals: "delactions.htm" (actions under delegated authority, by section: Bank Holding Companies, Bank Mergers, ...) and the
//     week's Board actions page give entries "<Filer>, <City>, <State> -- <what>." followed by "Approved: <date>" (or Granted,
//     Withdrawn, Denied, Returned). An entry is matched to a stored application by the filer's name and a merger or acquisition verb.
//   - The H.2 sees only what the Federal Reserve decides: holding-company applications (most bank acquisitions go through one) and
//     state member banks' mergers. A merger of two nonmember banks with no holding-company application goes to the FDIC; of national
//     banks, to the OCC. NOT BUILT: the OCC's Corporate Applications Search (apps.occ.gov/CAS/) is a script-drawn application with no
//     plain pages, and the FDIC publishes no applications list that was found (data-sources open question 8). State bulletins: not
//     built (E18-S2's state spike: Texas and California did not yield what was needed).
//
// RULES. Only organizations are stored: every party is checked for an organization word (isOrganization), and the proposal text is
// never stored, only the parties parsed from it with their city, state and role. When the merger closes and FDIC's /history shows it
// (E3-S6, sources/fdic/events.json), the pending signal ends and links to that structure event, so the merger is never counted twice.
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { getText, realSleep, HttpError } from './http.mjs';
import { startRun, finishRun, sourceBlock, upsertWithChanges, SOURCE_KEYS } from './runlog.mjs';
import { STATES } from './fdicsales.mjs';
import { isOrganization } from './fdicorders.mjs';
import { resolveParty } from './enforcement.mjs';
import { loadAliases } from '../candidates.mjs';
import { fdicPaths } from './fdic.mjs';
import { readJson, writeJson } from '../store.mjs';
import { norm } from '../guard.mjs';

export const FED_WWW = 'https://www.federalreserve.gov';
export const H2_INDEX = '/releases/h2/';
export const DISTRICTS = Object.freeze(['boston', 'newyork', 'philadelphia', 'cleveland', 'richmond', 'atlanta', 'chicago', 'stlouis', 'minneapolis', 'kansascity', 'dallas', 'sanfrancisco']);
export const KINDS = Object.freeze({
  '18C': 'bank merger (Bank Merger Act section 18(c))',
  '3A5': 'merger of bank holding companies (section 3(a)(5))',
  '3A3': 'acquisition of a bank by a holding company (section 3(a)(3))',
  '3A1': 'formation of a bank holding company (section 3(a)(1))',
});
const PRECEDENCE = ['18C', '3A5', '3A3', '3A1'];
export const mergerPaths = (dir) => { const base = join(dir, 'sources', 'mergers'); return { base, applications: join(base, 'applications.json'), state: join(base, 'state.json') }; };
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ymd8 = (w) => `${w.slice(0, 4)}-${w.slice(4, 6)}-${w.slice(6, 8)}`;
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const pad = (n) => String(n).padStart(2, '0');

// ---- HTML ------------------------------------------------------------------------------------------------------------------------
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', ndash: '–', mdash: '—' };
const decode = (s) => String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e.toLowerCase()] ?? m));
const text = (h) => decode(String(h ?? '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
export function parseDate(s) {
  const m = new RegExp(`\\b(${MONTHS.join('|')})\\s+(\\d{1,2}),?\\s+(\\d{4})\\b`, 'i').exec(String(s ?? ''));
  if (m) return `${m[3]}-${pad(MONTHS.indexOf(m[1].toLowerCase()) + 1)}-${pad(m[2])}`;
  const n = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/.exec(String(s ?? ''));
  return n ? `${n[3]}-${pad(n[1])}-${pad(n[2])}` : null;
}

// The weeks the H.2 index links, oldest first, as YYYYMMDD. Older weeks are linked "YYYYMMDD/default.htm", recent ones "YYYYMMDD".
export function weeksFromIndex(html) {
  return [...new Set([...String(html ?? '').matchAll(/href="(?:\/releases\/h2\/)?(\d{8})(?:\/(?:default\.htm)?)?"/g)].map((m) => m[1]))].sort();
}

// A district page's "Filings received" table: { weekEnding, rows: [{ filer, types, proposal, newspaper, fedreg }] }, or null with no table.
export function parseDistrictPage(html) {
  const s = String(html ?? '');
  const head = /Filings received during the week ending ([^<]+)</i.exec(s);
  const table = /<table class="pubtables"[\s\S]*?<\/table>/i.exec(s.slice(head ? head.index : 0));
  if (!head || !table) return null;
  const rows = [];
  for (const tr of table[0].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...tr[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) => text(c[1]));
    if (cells.length < 5 || /^filer$/i.test(cells[0])) continue;
    rows.push({ filer: cells[0], typeText: cells[1], types: [...new Set([...cells[1].matchAll(/(?<![A-Za-z0-9])(18C|3A[1-5]|4C8)(?![0-9])/gi)].map((m) => m[1].toUpperCase()))], proposal: cells[2], newspaper: parseDate(cells[3]), fedreg: parseDate(cells[4]) });
  }
  return { weekEnding: parseDate(head[1]), rows };
}

// ---- The proposal: who acquires whom ---------------------------------------------------------------------------------------------
const STATE_ALT = [...Object.keys(STATES).sort((a, b) => b.length - a.length).map((s) => s.split(' ').map((w) => (w === 'of' ? w : w[0].toUpperCase() + w.slice(1))).join('\\s+')), ...Object.values(STATES)].join('|');
const stateOf = (s) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return /^[A-Z]{2}$/.test(t) ? t : STATES[t.toLowerCase()] ?? null; };
const CUT = /\s*(?:,|;)?\s*(?:pursuant to\b|in addition\b|and (?:to )?retain\b|to retain\b|and thereby (?:to )?establish\b|and to establish\b|to establish\b|and (?:to )?engage\b|to engage\b|and elect\b)/i;
const RELOCATE = /,?\s*to relocate its head office to [^,]+,\s*[A-Za-z ]+,\s*and\s+/i;
const CONNECT = /,?\s+(?:to become a bank holding company (?:by|through) (?:acquiring|merging with|the acquisition of)|to become a bank holding company|and become a bank holding company by acquiring|to (?:acquire|merge with|merge)|and (?:thereby|therefore),?(?:\s+indirectly)?(?:\s+(?:acquire|acquiring|retain))?|with and into|by acquiring|by merging with|through the acquisition of|which controls)\s+/gi;
const QUANT = /^(?:(?:up to|approximately|an additional|additional|all(?: of the)?|the(?=\s+(?:outstanding|voting|shares|common)\b)|outstanding|voting|shares|percent|or more|\d+(?:\.\d+)?|of|common|stock)\s+)+/i;
// Two organizations in one segment: split on ";" or on "and" only where the piece before it ends with a state ("X, City, State and Y"),
// so a name that holds "and" ("Farmers Trust and Savings Bank") stays whole.
const PIECES = new RegExp(`\\s*;\\s*|(?<=\\b(?:${STATE_ALT})),?\\s+and\\s+(?=[A-Z])`);
const PLACE = new RegExp(`^(.*?),\\s*([A-Z][^,]*?),?\\s+(${STATE_ALT})\\.?$`);
const BOTH = new RegExp(`,?\\s*(?:both|all) of\\s+([A-Z][^,]*?),\\s*(${STATE_ALT})\\.?$`);

// Organizations a proposal names, in order, each { name, city, state }. A person (no organization word) is dropped. Pure.
export function proposalParties(proposal) {
  let t = decode(proposal).replace(/\s+/g, ' ').trim().replace(RELOCATE, ' and ');
  const cut = CUT.exec(t); if (cut) t = t.slice(0, cut.index);
  t = t.replace(/\s*\([^)]{1,40}\)/g, '').replace(/(?<!\b(?:Inc|Corp|Co|Ltd|N\.A))\.$/, '');
  const segs = t.split(CONNECT).map((x) => x.trim()).filter(Boolean);
  const out = [];
  for (let seg of segs) {
    seg = seg.replace(QUANT, '').replace(/^,\s*/, '').trim();
    let shared = null;
    const both = BOTH.exec(seg);
    if (both) { shared = { city: both[1].trim(), state: stateOf(both[2]) }; seg = seg.slice(0, both.index).trim(); }
    for (const piece of seg.split(PIECES).map((x) => x.trim()).filter(Boolean)) {
      const m = PLACE.exec(piece);
      const p = m ? { name: m[1].trim(), city: m[2].trim(), state: stateOf(m[3]) } : { name: piece.replace(/,$/, '').trim(), city: null, state: null };
      if (!isOrganization(p.name)) continue;
      out.push(p);
    }
    if (shared) for (const p of out) if (!p.state) { p.city = shared.city; p.state = shared.state; }
  }
  const seen = new Map();
  for (const p of out) { const k = norm(p.name).replace(/^the /, ''); if (!seen.has(k)) seen.set(k, p); else if (!seen.get(k).state && p.state) seen.set(k, p); }
  return [...seen.values()];
}

// One row to an application: the proposal's first organization is the applicant, the acquirer (the filer column can be the applicant's
// bank: "Partners Bank of California" files for "Partners Bancorp ... to become a bank holding company by acquiring" it); every other
// organization is a target.
// Returns null for a row with no kept code, or none whose filer and parties are organizations.
export function applicationOf(row, { district, week }) {
  const codes = PRECEDENCE.filter((c) => row.types.includes(c));
  if (!codes.length || !isOrganization(row.filer)) return null;
  const parties = proposalParties(row.proposal);
  const fk = norm(row.filer).replace(/^the /, '');
  const first = parties[0] ?? { name: row.filer, city: null, state: null };
  const withRoles = [{ ...first, role: 'acquirer' }, ...parties.filter((p) => p !== first).map((p) => ({ ...p, role: 'target' }))];
  const id = createHash('sha256').update([fk, codes.join('+'), norm(row.proposal)].join('|')).digest('hex').slice(0, 16);
  return { key: `h2:${id}`, regulator: 'frb', kind: codes[0], kinds: codes, filer: row.filer, parties: withRoles, district,
    filedWeek: ymd8(week), commentEnds: [row.newspaper, row.fedreg].filter(Boolean).sort().at(-1) ?? null,
    link: `${FED_WWW}${H2_INDEX}${week}/${district}.htm` };
}

// ---- Approvals and other outcomes ---------------------------------------------------------------------------------------------------
// Entries "<Org>, <City>, <State> -- <what>" with their outcome line, from delactions.htm or the Board actions page. Pure.
const OUTCOME = /^(Approved|Granted|Withdrawn|Denied|Returned|Permitted|Terminated):\s*(.+)$/i;
export function parseActions(html) {
  const s = String(html ?? '').replace(/<(script|style)[\s\S]*?<\/\1>/gi, '');
  const lines = decode(s.replace(/<\/(p|div|li|h\d|tr|dd|dt|td)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ')).split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const out = [];
  for (let i = 0; i < lines.length - 1; i++) {
    if (!/ -- /.test(lines[i])) continue;
    const o = OUTCOME.exec(lines[i + 1]);
    if (!o) continue;
    const [who, what] = lines[i].split(/ -- /);
    out.push({ who: who.trim(), what: what.trim(), outcome: o[1].toLowerCase(), date: parseDate(o[2]) });
  }
  return out;
}
const VERB = /\bmerge|acquir|become a bank holding company/i;
// An organization's name for comparison: no leading "The", no corporate suffix ("Example Holdings, Inc." = "EXAMPLE HOLDINGS").
const orgKey = (n) => norm(n).replace(/^the /, '').replace(/\b(inc|incorporated|corp|corporation|co|company|llc|ltd)\b/g, ' ').replace(/\s+/g, ' ').trim();
const OUTCOME_FIELD = { approved: 'approvedOn', granted: 'approvedOn', permitted: 'approvedOn', withdrawn: 'withdrawnOn', denied: 'deniedOn', returned: 'withdrawnOn', terminated: 'withdrawnOn' };
// Applies outcomes to applications: an entry whose leading organization is the filer's name (or the acquirer's), on or after the week
// filed, and that speaks of a merger or an acquisition. Returns the keys changed.
export function applyOutcomes(apps, entries) {
  const changed = [];
  for (const e of entries) {
    const field = OUTCOME_FIELD[e.outcome];
    if (!field || !e.date || !VERB.test(e.what)) continue;
    const first = e.who.split(/\s*;\s*/)[0];
    const lead = orgKey(PLACE.exec(first)?.[1] ?? first);
    for (const a of Object.values(apps)) {
      if (a[field] || a.withdrawnOn || a.deniedOn || e.date < addDays(a.filedWeek, -6)) continue;
      const names = [a.filer, ...a.parties.filter((p) => p.role === 'acquirer').map((p) => p.name)].map(orgKey);
      if (!names.includes(lead)) continue;
      a[field] = e.date; changed.push(a.key);
    }
  }
  return [...new Set(changed)];
}
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

// ---- The close: FDIC's structure event takes over ---------------------------------------------------------------------------------
// The structure event (sources/fdic/events.json, E3-S6) that closes an application: a merger whose target is the application's
// resolved target (or, when no target resolved, whose acquirer is its resolved acquirer), effective on or after the week it was filed.
export function closingEvent(app, { events = {}, institutions = {}, aliases = {} }) {
  const ctx = { institutions, aliases };
  const certOf = (role) => app.parties.filter((p) => p.role === role).map((p) => resolveParty(p, ctx).key).filter(Boolean).map((k) => k.slice(5));
  const targets = certOf('target'), acquirers = certOf('acquirer');
  const after = Object.values(events).filter((e) => e?.effective && e.effective >= addDays(app.filedWeek, -6) && e.kind !== 'failure');
  const hit = targets.length ? after.filter((e) => targets.includes(String(e.targetCert))) : acquirers.length ? after.filter((e) => acquirers.includes(String(e.acquirerCert))) : [];
  return hit.sort((a, b) => (a.effective < b.effective ? -1 : 1))[0] ?? null;
}

// ---- Rules ---------------------------------------------------------------------------------------------------------------------
export function validateMergerConfig(c) {
  const errors = [];
  if (!c || typeof c !== 'object') return ['config.mergers is missing'];
  const posInt = (v, k, max) => { if (!Number.isInteger(v) || v < 0 || v > max) errors.push(`mergers.${k} must be a whole number from 0 to ${max}`); };
  posInt(c.minIntervalMs, 'minIntervalMs', 600000); posInt(c.backfillWeeks, 'backfillWeeks', 260); posInt(c.maxWeeksPerRun, 'maxWeeksPerRun', 520); posInt(c.minRowsPerWeek, 'minRowsPerWeek', 100);
  if (!Array.isArray(c.districts) || !c.districts.length || c.districts.some((d) => !DISTRICTS.includes(d))) errors.push(`mergers.districts: one or more of ${DISTRICTS.join(', ')}`);
  return errors;
}
const placeholder = (v) => !String(v ?? '').trim() || /\[confirm/i.test(String(v));

// ---- The run -------------------------------------------------------------------------------------------------------------------
// The index; each week not read before, oldest first, back to backfillWeeks (at most maxWeeksPerRun): its district pages, then its
// approvals pages. A district page with no "Filings received" table fails the run and writes nothing (the format changed). Then every
// stored application is checked against FDIC's structure events for a close.
export async function runMergerApps({ dir, mergers = {}, fetchImpl = globalThis.fetch, now = new Date(), clock = () => new Date(), sleep = realSleep, nowMs = () => Date.now() }) {
  const errs = validateMergerConfig(mergers);
  if (errs.length) throw new Error(`config.json: ${errs.join('; ')}`);
  const ua = placeholder(mergers.userAgent) ? undefined : String(mergers.userAgent).trim();
  const p = mergerPaths(dir);
  const run = startRun({ source: 'mergerapps', query: { release: 'H.2', districts: mergers.districts }, now });
  const fetchedAt = now.toISOString();
  const notes = [];
  const counts = { requests: 0, weeks: 0, rowsRead: 0, kept: 0, applications: 0, applicationsNew: 0, skippedPeople: 0, skippedOther: 0, outcomes: 0, closed: 0 };
  const interval = Math.max(0, Number(mergers.minIntervalMs ?? 1000));
  let last = -Infinity;
  const pace = async () => { const wait = last + interval - nowMs(); if (wait > 0) await sleep(wait); last = nowMs(); };
  const get = async (path) => { await pace(); counts.requests++; return (await getText(new URL(path, FED_WWW).toString(), {}, { fetchImpl, userAgent: ua, sleep, retries: 2, maxBytes: 3_000_000 })).text; };
  const state = readJson(p.state, { weeks: {} });
  try {
    const all = weeksFromIndex(await get(H2_INDEX));
    if (!all.length) throw new Error('The H.2 index lists no weeks: the page may have changed. Nothing was written.');
    const from = addDays(now.toISOString().slice(0, 10), -7 * mergers.backfillWeeks).replace(/-/g, '');
    const todo = all.filter((w) => w >= from && !state.weeks?.[w]);
    const batch = todo.slice(0, mergers.maxWeeksPerRun);
    if (todo.length > batch.length) notes.push(`${todo.length - batch.length} week(s) left for the next run (config.mergers.maxWeeksPerRun)`);
    const prev = readJson(p.applications, {});
    const next = structuredClone(prev);
    const weeks = { ...(state.weeks ?? {}) };
    const fresh = [];
    for (const w of batch) {
      let rows = 0;
      for (const d of mergers.districts) {
        const page = parseDistrictPage(await get(`${H2_INDEX}${w}/${d}.htm`).catch((e) => { if (e instanceof HttpError && e.status === 404) return ''; throw e; }));
        if (!page) {
          const line = finishRun(dir, run, { rowsRead: counts.rowsRead, outcome: 'failed', missingFields: [`${w}/${d}: Filings received`], errors: [`The H.2 page for ${d}, week ${ymd8(w)}, has no "Filings received" table: the format may have changed, or the week predates the HTML pages. Nothing was written.`], notes, now: clock() });
          return { runId: run.runId, outcome: line.outcome, ...counts, errors: line.errors };
        }
        rows += page.rows.length; counts.rowsRead += page.rows.length;
        for (const r of page.rows) {
          if (/change in bank control/i.test(r.typeText) && !r.types.length) { counts.skippedPeople++; continue; }
          const a = applicationOf(r, { district: d, week: w });
          if (!a) { counts.skippedOther++; continue; }
          counts.kept++;
          if (next[a.key]) { next[a.key].lastSeenWeek = a.filedWeek; continue; }
          fresh.push(a.key);
          next[a.key] = { ...a, lastSeenWeek: a.filedWeek, approvedOn: null, withdrawnOn: null, deniedOn: null, closedBy: null, contextOnly: true, firstSeenAt: fetchedAt, firstRunId: run.runId,
            _source: sourceBlock({ source: 'mergerapps', endpoint: a.link, query: { release: 'H.2', week: ymd8(w), district: d }, recordId: a.key, period: a.filedWeek, fetchedAt, runId: run.runId }) };
        }
      }
      if (rows < mergers.minRowsPerWeek) notes.push(`week ${ymd8(w)}: only ${rows} filing(s) across the districts read`);
      // The week's outcomes: approvals and withdrawals under delegated authority, and the Board's own.
      const entries = [];
      for (const page of ['delactions.htm', 'default.htm']) entries.push(...parseActions(await get(`${H2_INDEX}${w}/${page}`).catch((e) => { if (e instanceof HttpError && e.status === 404) return ''; throw e; })));
      counts.outcomes += applyOutcomes(next, entries).length;
      weeks[w] = { readAt: fetchedAt, rows };
      counts.weeks++;
    }

    // The close: FDIC's structure events. A closed application keeps its record; its pending signal ends.
    const ctx = { events: readJson(fdicPaths(dir).events, {}), institutions: readJson(fdicPaths(dir).institutions, {}), aliases: loadAliases(dir) };
    for (const a of Object.values(next)) {
      if (a.closedBy || a.withdrawnOn || a.deniedOn) continue;
      const e = closingEvent(a, ctx);
      if (e) { a.closedBy = `fdic-event:${e.transnum}`; a.closedOn = e.effective; counts.closed++; }
    }

    let changed = 0;
    const out = {};
    for (const [k, a] of Object.entries(next)) { const u = upsertWithChanges(prev[k], a, { key: k, runId: run.runId, dir, now }); out[k] = u.record; changed += u.changed; }
    counts.applications = Object.keys(out).length; counts.applicationsNew = fresh.length;
    writeJson(p.applications, out);
    writeJson(p.state, { lastRun: run.runId, ranAt: fetchedAt, from: ymd8(from), latestWeek: Object.keys(weeks).sort().at(-1) ?? null, weeks, counts });
    notes.push(`${counts.weeks} week(s) read: ${counts.rowsRead} filings, ${counts.kept} merger or acquisition filing(s) (${fresh.length} new application(s)); ${counts.outcomes} outcome(s) and ${counts.closed} close(s) recorded`);
    const line = finishRun(dir, run, { rowsRead: all.length, rowsWritten: fresh.length, rowsChanged: changed, outcome: 'ok', notes, now: clock() });
    return { runId: run.runId, outcome: line.outcome, ...counts, changed };
  } catch (e) {
    const line = finishRun(dir, run, { rowsRead: counts.rowsRead, outcome: 'failed', errors: [String(e.message).slice(0, 300)], notes, now: clock() });
    return { runId: run.runId, outcome: line.outcome, ...counts, errors: line.errors };
  }
}

// ---- What the applications give the rest of the pipeline ----------------------------------------------------------------------------
// Event signals by institution key, type 'merger_pending', for each bank in the list an open application names (as acquirer or target).
// An application closed by FDIC's structure event, withdrawn or denied gives no pending signal: the structure event's own signal (E3-S6)
// speaks for a closed merger, so it is never counted twice. Labels are fixed templates over a code, a role and dates.
export function mergerSignals({ dir, institutions, aliases } = {}) {
  const apps = readJson(mergerPaths(dir).applications, {});
  const ctx = { institutions: institutions ?? readJson(fdicPaths(dir).institutions, {}), aliases: aliases ?? loadAliases(dir) };
  const out = {};
  for (const a of Object.values(apps)) {
    if (!a || a.closedBy || a.withdrawnOn || a.deniedOn || !DATE.test(String(a.filedWeek))) continue;
    const seen = new Set();
    for (const p of a.parties ?? []) {
      const key = resolveParty(p, ctx).key;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const what = KINDS[a.kind] ?? 'merger or acquisition';
      (out[key] ??= []).push({
        id: `merger:${a.key}:${p.role}`, kind: 'event', type: 'merger_pending', source: 'mergerapps', key, role: p.role, applicationKind: a.kind,
        date: a.filedWeek, period: a.filedWeek, approvedOn: a.approvedOn ?? null, commentEnds: a.commentEnds ?? null, link: a.link, evidence: [a.key], firstSeenAt: a.firstSeenAt ?? null,
        label: `${a.kind === '3A1' ? `An application for the ${what}` : `A pending ${what}`}, with this bank as the ${p.role === 'acquirer' ? (a.kind === '3A1' ? 'holding company or its bank' : 'acquirer') : 'bank acquired'}: filed with the Federal Reserve in the week ending ${a.filedWeek}${a.approvedOn ? `, approved ${a.approvedOn}` : ', not yet approved'}`,
      });
    }
  }
  for (const list of Object.values(out)) list.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id < b.id ? -1 : 1));
  return out;
}

// ---- Checking it against the source (read-only) --------------------------------------------------------------------------------------
const check = (id, ok, summary, detail) => ({ id, ok: !!ok, summary, ...(detail ? { detail } : {}) });
const KEYS = new Set(['key', 'regulator', 'kind', 'kinds', 'filer', 'parties', 'district', 'filedWeek', 'lastSeenWeek', 'commentEnds', 'link', 'approvedOn', 'withdrawnOn', 'deniedOn', 'closedBy', 'closedOn', 'contextOnly', 'firstSeenAt', 'firstRunId', '_source']);
export async function verifyMergerApps({ dir, mergers = {}, fetchImpl = globalThis.fetch, sleep = realSleep, now = new Date(), sample = 5, freshDays = 10 }) {
  const p = mergerPaths(dir);
  const state = readJson(p.state, null), apps = readJson(p.applications, null);
  if (!state || !apps) return { source: 'mergerapps', checks: [check('mergerapps.present', false, 'No merger applications yet. Run: outbound sources run mergerapps')], sample: [] };
  const checks = [];
  const age = Math.floor((now.getTime() - Date.parse(state.ranAt)) / 86400000);
  checks.push(check('mergerapps.fresh', age <= freshDays, age <= freshDays ? `The last run was ${age} day(s) ago; the latest week read ends ${state.latestWeek ? ymd8(state.latestWeek) : 'nowhere'}.` : `The last run was ${age} days ago (more than ${freshDays}). Run: outbound sources run mergerapps`));
  const recs = Object.values(apps);
  const bad = recs.filter((r) => !r?._source || SOURCE_KEYS.some((k) => r._source[k] === undefined || r._source[k] === null || r._source[k] === '') || !KINDS[r.kind] || !DATE.test(String(r.filedWeek)) || Object.keys(r).some((k) => !KEYS.has(k)) || !String(r.link ?? '').startsWith(`${FED_WWW}${H2_INDEX}`));
  const people = recs.filter((r) => !isOrganization(r.filer) || (r.parties ?? []).some((x) => !isOrganization(x.name)));
  checks.push(check('mergerapps.sourced', !bad.length && !people.length, `${recs.length - bad.length} of ${recs.length} stored applications carry their source, a kept code, a week and an H.2 link, and no proposal text.${people.length ? ` ${people.length} name a party with no organization word: it may be a person, and must not be stored.` : ' Every party is an organization.'}`, bad.length || people.length ? { bad: bad.slice(0, 10).map((r) => r?.key), people: people.slice(0, 10).map((r) => r.key) } : undefined));
  // Recall: the latest week read, again; every application stored from it must come back.
  const w = state.latestWeek;
  if (w) {
    try {
      const ua = placeholder(mergers.userAgent) ? undefined : String(mergers.userAgent).trim();
      const live = new Set();
      for (const d of mergers.districts ?? DISTRICTS) {
        await sleep(Math.max(0, mergers.minIntervalMs ?? 1000));
        const page = parseDistrictPage((await getText(`${FED_WWW}${H2_INDEX}${w}/${d}.htm`, {}, { fetchImpl, userAgent: ua, sleep, maxBytes: 3_000_000 })).text);
        for (const r of page?.rows ?? []) { const a = applicationOf(r, { district: d, week: w }); if (a) live.add(a.key); }
      }
      const expected = recs.filter((r) => r.lastSeenWeek === ymd8(w)).map((r) => r.key);
      const lost = expected.filter((k) => !live.has(k));
      const notStored = [...live].filter((k) => !apps[k]);
      checks.push(check('mergerapps.recall', !lost.length && !notStored.length, !lost.length && !notStored.length ? `Week ending ${ymd8(w)} read again: all ${expected.length} application(s) stored from it came back, and none there is missing here.` : `Week ending ${ymd8(w)}: ${lost.length} stored application(s) not found again; ${notStored.length} there not stored.`, lost.length || notStored.length ? { lost: lost.slice(0, 10), notStored: notStored.slice(0, 10) } : undefined));
    } catch (e) { checks.push(check('mergerapps.recall', false, `The H.2 could not be read: ${String(e.message).slice(0, 120)}`)); }
  }
  const rows = recs.sort((a, b) => (a.filedWeek < b.filedWeek ? 1 : -1)).slice(0, sample).map((r) => ({ key: r.key, kind: r.kind, filedWeek: r.filedWeek, approvedOn: r.approvedOn, closedBy: r.closedBy, check: r.link }));
  return { source: 'mergerapps', checks, sample: rows };
}
