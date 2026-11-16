// The forum event list (PRD E22-S2; docs/data-sources.md 2.4, build step 19). A principal keeps events.json: about 10 to 15 public
// conference and association event pages (speaker lists, programs, agendas), each with its host, dates, association, the states or
// metros it covers, and the date the principal read the site's terms. The briefer reads the pages that apply to the bank it researches,
// as fenced data for bank.memberships only (src/research.mjs forumSection). Nothing polls and nothing here fetches a page: the briefer
// reads them through the model's own web fetch tool.
//
// Public pages only. A URL whose path, query or subdomain suggests an attendee list, a members-only page, a login or a portal is refused
// on load, as are plain http, credentials, ports and tracking parameters. An entry with no terms date, or with [CONFIRM] anywhere in it,
// is a placeholder: it is checked on load but never passed to the briefer. The list names events only: an unknown field is refused, so
// no speaker list can be pasted into it.
//
// It never reaches the drafter: loadRules() does not load it, and only the briefer's callers (cli.mjs `research run`, the worker's
// research job) call loadEvents().
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from './paths.mjs';

// The one playbook question the list serves.
export const FORUM_QUESTION = 'bank.memberships';
const FIELDS = new Set(['_note', 'id', 'name', 'host', 'url', 'dates', 'association', 'national', 'states', 'metros', 'termsCheckedOn']);
const MAX_EVENTS = 50, MAX_CAP = 30;

// ---- A public page ---------------------------------------------------------------------------------------------------------------
const words = (s) => String(s ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
// A word that marks a page behind a login or for members only. "member" and "attend" are stems (members, membership, attendees,
// attending); "remember" is not one. A directory is a member directory unless it is the speakers', exhibitors' or sponsors'.
const SHOWCASE = /^(speakers?|exhibitors?|sponsors?)$/;
function notPublic(ws) {
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i], pair = `${w} ${ws[i + 1] ?? ''}`;
    if (/^(attend|member)/.test(w) || /login|logon|signin|signon|portal|password|myaccount/.test(w)) return true;
    if (['log in', 'log on', 'sign in', 'sign on', 'my account'].includes(pair)) return true;
    if (/directory/.test(w) && !SHOWCASE.test(ws[i - 1] ?? '')) return true;
  }
  return false;
}
// Query parameters that track a click rather than choose a page.
const TRACKING_PREFIX = /^(utm_|elq|hsa_|pk_|mtm_|_hs|__hs|vero_|oly_)/;
const TRACKING = new Set(['fbclid', 'gclid', 'gbraid', 'wbraid', 'dclid', 'msclkid', 'yclid', 'twclid', 'ttclid', 'li_fat_id', 'igshid', 'mc_cid', 'mc_eid', 'hsctatracking',
  'mkt_tok', 'trk', 'trkid', 'trkcampaign', '_ga', '_gl', 's_cid', 's_kwcid', 'ef_id', 'cmpid', 'campaignid', 'ref', 'ref_src', 'referrer']);
const HOST = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

// Why a URL may not go on the list, or null when it may: a real https address of a public page, with no tracking.
export function urlProblem(url) {
  if (typeof url !== 'string' || !url.trim() || /\s/.test(url) || url.length > 500) return 'is not a URL';
  if (/[[\]]/.test(url)) return 'is a placeholder, not a URL';
  let u;
  try { u = new URL(url); } catch { return 'is not a URL'; }
  if (u.protocol !== 'https:') return 'must use https';
  if (u.username || u.password) return 'carries credentials';
  if (u.port) return 'names a port: a public page needs none';
  if (!HOST.test(u.hostname)) return 'needs a real host name, not an address or a local name';
  const sub = u.hostname.split('.').slice(0, -2);
  let path = u.pathname;
  try { path = decodeURIComponent(path); } catch { /* a malformed escape: read the path as written */ }
  const query = [...u.searchParams].flat();
  if (notPublic(sub.flatMap(words)) || notPublic(words(path)) || notPublic(query.flatMap(words)))
    return 'suggests a page that is not public (an attendee list, a members-only page, a login or a portal)';
  const tracker = [...u.searchParams.keys()].find((k) => TRACKING_PREFIX.test(k.toLowerCase()) || TRACKING.has(k.toLowerCase()));
  if (tracker) return `has a tracking parameter (${tracker})`;
  return null;
}

// ---- The rule file -----------------------------------------------------------------------------------------------------------------
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const text = (v) => typeof v === 'string' && v.trim().length > 0 && v.length <= 200;

// A placeholder waits for a principal: no terms date yet, or a [CONFIRM] marker anywhere, its note included.
export const isPlaceholder = (e) => !e?.termsCheckedOn || /\[CONFIRM/i.test(JSON.stringify(e));

// Every problem with the list, as plain sentences. `metros` is metros.json: an event's metros must be among its CBSA codes.
export function validateEvents(raw, { metros } = {}) {
  const errors = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ['the file is not an object'];
  if (!Number.isInteger(raw.maxPerAccount) || raw.maxPerAccount < 0 || raw.maxPerAccount > MAX_CAP) errors.push(`maxPerAccount: a whole number from 0 to ${MAX_CAP}`);
  for (const k of Object.keys(raw)) if (!k.startsWith('_') && !['maxPerAccount', 'events'].includes(k)) errors.push(`unknown field "${k}"`);
  if (!Array.isArray(raw.events)) return [...errors, 'events: a list of events'];
  if (raw.events.length > MAX_EVENTS) errors.push(`events: at most ${MAX_EVENTS}; the list is meant to be short`);
  const known = new Set((metros?.metros ?? []).map((m) => String(m.cbsa)));
  const ids = new Set(), urls = new Map();
  raw.events.forEach((e, i) => {
    if (!e || typeof e !== 'object' || Array.isArray(e)) { errors.push(`event ${i + 1}: an object`); return; }
    const id = String(e.id ?? '');
    if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(id)) errors.push(`event id "${id}" (event ${i + 1}): lowercase letters, digits and hyphens`);
    else if (ids.has(id)) errors.push(`event id "${id}" is used twice`);
    ids.add(id);
    const at = id || `event ${i + 1}`;
    for (const k of Object.keys(e)) if (!FIELDS.has(k)) errors.push(`${at}: unknown field "${k}": events only (name, host, url, dates, association, where it applies, the terms date), never a person`);
    if (e._note !== undefined && typeof e._note !== 'string') errors.push(`${at}: _note is text`);
    if (!text(e.name)) errors.push(`${at}: a name`);
    if (!text(e.host)) errors.push(`${at}: a host (who runs the event)`);
    if (!text(e.association)) errors.push(`${at}: an association, as a principal would write it in the network`);
    const live = !isPlaceholder(e);
    if (e.url === null || e.url === undefined) { if (live) errors.push(`${at}: a confirmed event needs a URL`); }
    else {
      const why = urlProblem(e.url);
      if (why) errors.push(`${at}: url "${String(e.url).slice(0, 120)}" ${why}`);
      else {
        const key = new URL(e.url).href.toLowerCase().replace(/\/+$/, '');
        if (urls.has(key)) errors.push(`${at}: the same page twice (also ${urls.get(key)})`);
        urls.set(key, at);
      }
    }
    if (e.dates === null || e.dates === undefined) { if (live) errors.push(`${at}: a confirmed event needs its dates`); }
    else if (typeof e.dates !== 'object' || Array.isArray(e.dates) || typeof e.dates.start !== 'string' || typeof e.dates.end !== 'string') errors.push(`${at}: dates are { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" }`);
    else {
      for (const k of ['start', 'end']) if (!isDate(e.dates[k])) errors.push(`${at}: dates.${k} "${e.dates[k]}" is not a real date (YYYY-MM-DD)`);
      if (isDate(e.dates.start) && isDate(e.dates.end) && e.dates.end < e.dates.start) errors.push(`${at}: the event ends before it starts`);
    }
    if (e.termsCheckedOn !== null && e.termsCheckedOn !== undefined && !isDate(e.termsCheckedOn)) errors.push(`${at}: termsCheckedOn is the day a principal read the site's terms, YYYY-MM-DD, or null`);
    const states = e.states ?? [], ms = e.metros ?? [];
    if (!Array.isArray(states) || states.some((s) => !/^[A-Z]{2}$/.test(String(s)))) errors.push(`${at}: states are two-letter codes, such as "TX"`);
    if (!Array.isArray(ms)) errors.push(`${at}: metros are CBSA codes from metros.json`);
    else for (const m of ms) if (!known.has(String(m))) errors.push(`${at}: metro "${m}" is not a metro in metros.json`);
    if (typeof e.national !== 'boolean') errors.push(`${at}: national is true or false`);
    else if (e.national && ((Array.isArray(states) && states.length) || (Array.isArray(ms) && ms.length))) errors.push(`${at}: a national event lists no states or metros`);
    else if (!e.national && !(Array.isArray(states) && states.length) && !(Array.isArray(ms) && ms.length)) errors.push(`${at}: say where it applies: national, or states or metros`);
  });
  return errors;
}

// The list, checked, with each metro's state (from metros.json) so an account's metros give its states. Throws on any problem.
export function parseEvents(raw, { metros } = {}) {
  const errors = validateEvents(raw, { metros });
  if (errors.length) throw new Error(`events.json: ${errors.join('; ')}`);
  return { maxPerAccount: raw.maxPerAccount, events: structuredClone(raw.events), metroState: Object.fromEntries((metros?.metros ?? []).map((m) => [String(m.cbsa), m.state])) };
}

export function loadEvents(root = REPO) {
  const read = (f) => JSON.parse(readFileSync(join(root, f), 'utf8'));
  return parseEvents(read('events.json'), { metros: read('metros.json') });
}

// ---- Which events apply to an account ------------------------------------------------------------------------------------------------
// Where a bank is: the metros where it has a branch (the pipeline's footprint) and any a principal wrote on the account (`metros`, CBSA
// codes); its headquarters state (the pipeline's `hqState`), any states a principal wrote (`states`), and the state of each metro.
export function accountPlaces(account, metroState = {}) {
  const metros = new Set();
  for (const c of Array.isArray(account?.metros) ? account.metros : []) metros.add(String(c).trim());
  for (const m of account?.pipeline?.profile?.footprint?.metros ?? []) if (Number(m?.branches?.value ?? 0) > 0) metros.add(String(m.cbsa));
  const states = new Set();
  for (const s of Array.isArray(account?.states) ? account.states : []) states.add(String(s).trim().toUpperCase());
  if (account?.pipeline?.hqState) states.add(String(account.pipeline.hqState).trim().toUpperCase());
  for (const c of metros) if (metroState[c]) states.add(metroState[c]);
  return { states: [...states].filter((s) => /^[A-Z]{2}$/.test(s)).sort(), metros: [...metros].filter(Boolean).sort() };
}

const RANK = { metro: 0, state: 1, national: 2 };
// The confirmed events for this account: those in its metros, then its states, then national ones; within each, the newest first. At
// most `maxPerAccount`. Each carries only what the briefer reads, and why it was picked.
export function eventsFor({ account, events }) {
  const cap = events?.maxPerAccount ?? 0;
  if (!Array.isArray(events?.events) || !(cap > 0)) return [];
  const where = accountPlaces(account, events.metroState ?? {});
  const picked = [];
  for (const e of events.events) {
    if (isPlaceholder(e)) continue;
    const match = (e.metros ?? []).some((m) => where.metros.includes(String(m))) ? 'metro'
      : (e.states ?? []).some((s) => where.states.includes(s)) ? 'state'
        : e.national === true ? 'national' : null;
    if (match) picked.push({ id: e.id, name: e.name, host: e.host, association: e.association, url: e.url, dates: { start: e.dates.start, end: e.dates.end }, match });
  }
  return picked.sort((a, b) => RANK[a.match] - RANK[b.match] || b.dates.start.localeCompare(a.dates.start) || a.id.localeCompare(b.id)).slice(0, cap);
}
