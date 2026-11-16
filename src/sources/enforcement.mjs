// Enforcement orders (PRD next-five E18-S2): public enforcement actions against banks, recorded with their type and date, so a principal
// knows when an examiner has told a bank to cut its problem assets. Orders reach banks the SEC never sees (most banks under the $10
// billion cap file nothing with the SEC), which is why this source exists.
//
// SOURCES, in the PRD's order. Only the first is built:
//   1. The Federal Reserve's enforcement actions (BUILT, below).
//   2. FDIC's monthly orders at orders.fdic.gov: NOT BUILT. From the development environment on 2026-11-16 the host failed TLS
//      verification through the agent proxy, so nothing about its pages could be checked. Its spike is still to do.
//   3. The Texas Department of Banking and California DFPI list pages: NOT BUILT; not spiked.
//   4. The OCC API (api.occ.gov/EnforcementActions/list): NOT BUILT; it waits for the free key in the firm's name (D-E2, Q21).
//
// THE FEDERAL RESERVE: what was checked live on 2026-11-16.
//   - www.federalreserve.gov/robots.txt answers 404, so no path is disallowed. The site's terms (/disclaimer.htm) were reachable; the
//     records are public U.S. government information [verify: a principal reads the terms before the first scheduled run].
//   - The search page (/supervisionreg/enforcementactions.htm) is an Angular app that reads three JSON files under
//     /supervisionreg/files/: ea-cms-recent.json (2019 on; 386 actions on 2026-11-16, the newest effective 2026-11-09), ea-old.json
//     (1989 to 2018; 2,513 actions, whose termination dates are still updated: the newest was 2025-12-04) and actiontypes.json.
//     Both action files are { "eaitems": [ ... ] } with a byte-order mark. The same names directly under /supervisionreg/ are stale
//     copies (one is empty): the app's own paths are the ones read here.
//   - An action carries: id (a number, or a numeric string in the recent file), edt (effective date), tdt (termination date, with
//     1950-01-01 meaning none recorded), type (free text, sometimes several types, sometimes with a penalty amount, and sometimes the
//     name of a person: "Civil Money Penalty $100,000 (collectively with <name>)"), bkorg (the organizations, "Name, City, State",
//     several joined by ";", "and" or ","), url and urlname (a press release, or a letter or order PDF), note (rare free text), and,
//     for an action against an individual, person and porg (the person and their organization).
//   - No FDIC cert and no RSSD ID: a bank is matched by name, state and city only. The organization is often the holding company.
//   - A termination is not its own record: the original action's tdt is filled in. So a termination here is a record built from it,
//     dated tdt, that links to the order it ends. The termination's own press release is not in the files (the press-release feed,
//     /feeds/press_enforcement.xml, announces some) and is not linked.
//   - The order document: a press release page links the order as a PDF under /newsevents/pressreleases/files/. Two orders read on
//     2026-11-16 were FlateDecode text that the reader in fdicsales.mjs reads with no new dependency. That reader does not split pages,
//     so the flags below are recorded per document, and page numbers are NOT recorded (pages: null).
//
// RULES. An action against an individual (a person field, or a prohibition, a Section 19 letter or a suspension) is skipped while the
// file is parsed: no person's name reaches the store, the run log or the change log. The raw type text and the note are never stored
// (both can name a person); a type is stored only as codes from TYPES below. Of an order's text, only which fixed phrases appear
// (config.enforcement.flags) is stored, never the text. Orders are context for a principal and the briefer, never for the drafter.
import { join } from 'node:path';
import { getText, getBytes, realSleep, HttpError } from './http.mjs';
import { startRun, finishRun, sourceBlock, upsertWithChanges, SOURCE_KEYS, CHANGES } from './runlog.mjs';
import { parseRobots, robotsFor, robotsAllows, STATES, pdfText } from './fdicsales.mjs';
import { readJson, writeJson, appendJsonl } from '../store.mjs';
import { norm } from '../guard.mjs';
import { matchInstitution, loadAliases, addAlias } from '../candidates.mjs';
import { fdicPaths } from './fdic.mjs';

export const FED_WWW = 'https://www.federalreserve.gov';
export const FED_FILES = Object.freeze({ recent: '/supervisionreg/files/ea-cms-recent.json', old: '/supervisionreg/files/ea-old.json' });
export const FED_SEARCH_PAGE = `${FED_WWW}/supervisionreg/enforcementactions.htm`;
export const NO_TERMINATION = '1950-01-01';

export const enforcementPaths = (dir) => {
  const base = join(dir, 'sources', 'enforcement');
  return { base, orders: join(base, 'orders.json'), state: join(base, 'state.json') };
};

// ---- Types ---------------------------------------------------------------------------------------------------------------------
// Codes, labels from code only. ACTIVE types are orders that stay in force until terminated; a penalty is a one-off.
export const TYPES = Object.freeze({
  consent_order: 'consent order',
  cease_and_desist: 'cease-and-desist order',
  written_agreement: 'formal written agreement',
  pca_directive: 'prompt corrective action directive',
  civil_money_penalty: 'civil money penalty',
  modification: 'modification of an earlier order',
  other: 'enforcement action',
  termination: 'termination',
});
export const ACTIVE_TYPES = Object.freeze(['consent_order', 'cease_and_desist', 'written_agreement', 'pca_directive']);
export const REGULATORS = Object.freeze({ frb: 'Federal Reserve' });
const PRECEDENCE = ['pca_directive', 'cease_and_desist', 'consent_order', 'written_agreement', 'civil_money_penalty', 'modification', 'other'];

// Kinds of action that are against individuals by definition, whatever else the record says.
const INDIVIDUAL = /prohibition|section 19|suspension/i;

export function classifyType(text) {
  const t = String(text ?? '');
  const codes = new Set();
  if (/amendment|modification/i.test(t)) codes.add('modification');
  else {
    if (/cease and desist|cease-and-desist/i.test(t)) codes.add('cease_and_desist');
    if (/consent order/i.test(t)) codes.add('consent_order');
    if (/written agreement/i.test(t)) codes.add('written_agreement');
    if (/prompt corrective action/i.test(t)) codes.add('pca_directive');
  }
  if (/civil money penalty/i.test(t)) codes.add('civil_money_penalty');
  if (!codes.size) codes.add('other');
  const types = PRECEDENCE.filter((c) => codes.has(c));
  return { type: types[0], types };
}

// ---- Organizations ---------------------------------------------------------------------------------------------------------------
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’' };
const decode = (s) => String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e.toLowerCase()] ?? m));
// State names as the Fed writes them ("Texas", "District of Columbia") or two-letter codes; case-sensitive, so "Co" or "in" is never a state.
const STATE_NAMES = Object.keys(STATES).sort((a, b) => b.length - a.length).map((s) => s.split(' ').map((w) => (w === 'of' ? w : w[0].toUpperCase() + w.slice(1))).join('\\s+'));
const PARTY = new RegExp(`(.+?),\\s*([^,;]+?),\\s*(${[...STATE_NAMES, ...Object.values(STATES)].join('|')})(?=\\s*(?:[;,]|\\band\\b|$))`, 'g');
const stateOf = (s) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return /^[A-Z]{2}$/.test(t) ? t : STATES[t.toLowerCase()] ?? null; };
const cleanName = (s) => s.replace(/^[\s;,]+/, '').replace(/^and\s+/i, '').replace(/[\s,;]+$/, '').replace(/\s+/g, ' ').trim();

// "Example Bancorp, Inc., Sampleton, Texas; and Example Bank, Sampleton, Texas" -> two parties with city and state. A text with no
// "City, State" at all is one party with city and state null.
export function parseParties(text) {
  const t = decode(text).replace(/\s+/g, ' ').trim();
  if (!t) return [];
  const out = [];
  for (const m of t.matchAll(PARTY)) {
    const name = cleanName(m[1]); const state = stateOf(m[3]);
    if (name && state) out.push({ name, city: m[2].trim(), state });
  }
  return out.length ? out : [{ name: cleanName(t), city: null, state: null }];
}

// ---- One file of the Fed's actions ----------------------------------------------------------------------------------------------
const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const REQUIRED_FIELDS = Object.freeze(['id', 'edt', 'type', 'url', 'bkorg']);
// tdt is left empty on a few records (one of 2,513 in ea-old.json on 2026-11-16), which is read as "no termination recorded". Absent
// from more than this share of a file's organization records, it is a format change, and the run fails.
const TDT_MAX_ABSENT = 0.5;

// Reads one action file into bank orders. Returns { orders, read, skippedIndividual, missing: { field: n } }. An action against an
// individual is skipped first, whatever its other fields (the file's only record with no url, on 2026-11-16, is one). An organization
// record without one of REQUIRED_FIELDS, or with a date that is not YYYY-MM-DD, is counted in `missing` (the run then fails and writes
// nothing), as is tdt when most records lack it.
export function parseFedFile(text, { file } = {}) {
  let body;
  try { body = JSON.parse(String(text ?? '').replace(/^﻿/, '')); } catch (e) { throw new Error(`${file ?? 'The file'} is not JSON: ${e.message}`); }
  if (!Array.isArray(body?.eaitems)) throw new Error(`${file ?? 'The file'} has no "eaitems" list: the format may have changed.`);
  const missing = {};
  const orders = [];
  let skippedIndividual = 0, noTdt = 0, orgs = 0;
  const blank = (v) => v === undefined || v === null || String(v).trim() === '';
  for (const it of body.eaitems) {
    // Against an individual: skipped here, before anything is kept. Nothing of the record (not even its id) is returned.
    if (!blank(it?.person) || !blank(it?.porg) || INDIVIDUAL.test(String(it?.type ?? ''))) { skippedIndividual++; continue; }
    orgs++;
    const gaps = REQUIRED_FIELDS.filter((f) => blank(it?.[f]));
    if (!blank(it?.edt) && !DATE.test(String(it.edt))) gaps.push('edt');
    if (!blank(it?.tdt) && !DATE.test(String(it.tdt))) gaps.push('tdt');
    if (blank(it?.tdt)) noTdt++;
    if (gaps.length) { for (const g of new Set(gaps)) missing[g] = (missing[g] ?? 0) + 1; continue; }
    const { type, types } = classifyType(it.type);
    // "DNE" (does not exist) stands in for the link on some old records: no document is published, so none is linked.
    const none = /^dne$/i.test(String(it.url).trim());
    const link = none ? null : new URL(String(it.url).trim(), FED_WWW).toString();
    const kind = none ? 'none' : /\.pdf$/i.test(link) ? 'order' : 'press release';
    orders.push({
      key: `frb:${String(it.id).trim()}`, regulator: 'frb', sourceId: String(it.id).trim(), type, types,
      date: String(it.edt), terminatedOn: it.tdt && it.tdt !== NO_TERMINATION ? String(it.tdt) : null,
      parties: parseParties(it.bkorg), link, linkKind: kind, file: file ?? null,
    });
  }
  if (orgs && noTdt / orgs > TDT_MAX_ABSENT) missing.tdt = (missing.tdt ?? 0) + noTdt;
  return { orders, read: body.eaitems.length, skippedIndividual, missing };
}

// ---- Matching a party to a bank in the universe ----------------------------------------------------------------------------------
// A principal's alias first (candidates/aliases.json), then the exact normalized name, narrowed by state and then city when the party
// gives them. One bank is a match. Two or more is ambiguous; none is unmatched. Both go to the review list; nothing is guessed.
// `institutions` is sources/fdic/institutions.json (CERT -> { NAME, CITY, STALP }).
// Names normalized once per bank list and alias table (both are plain objects read from the store), so matching thousands of orders
// does not normalize every bank's name again for each party.
const nameIndex = new WeakMap(), aliasIndex = new WeakMap();
const byNormName = (institutions) => {
  if (!nameIndex.has(institutions)) {
    const m = new Map();
    for (const [cert, i] of Object.entries(institutions)) { const k = norm(i?.NAME); if (k) m.set(k, [...(m.get(k) ?? []), [cert, i]]); }
    nameIndex.set(institutions, m);
  }
  return nameIndex.get(institutions);
};
const byNormAlias = (aliases) => {
  if (!aliasIndex.has(aliases)) {
    const m = new Map();
    for (const [key, list] of Object.entries(aliases)) for (const a of list ?? []) { const k = norm(a); if (k && !m.has(k)) m.set(k, key); }
    aliasIndex.set(aliases, m);
  }
  return aliasIndex.get(aliases);
};

export function resolveParty(party, { institutions = {}, aliases = {} } = {}) {
  const q = norm(party?.name);
  if (!q) return { key: null, how: 'none', candidates: [] };
  const alias = byNormAlias(aliases ?? {}).get(q);
  if (alias) return { key: alias, how: 'alias', candidates: [alias] };
  const byName = byNormName(institutions ?? {}).get(q) ?? [];
  const byState = party.state ? byName.filter(([, i]) => !i?.STALP || i.STALP === party.state) : byName;
  const byCity = party.city && byState.length > 1 ? byState.filter(([, i]) => !i?.CITY || norm(i.CITY) === norm(party.city)) : byState;
  const pool = byCity.length ? byCity : byState;
  if (pool.length === 1) return { key: `fdic:${pool[0][0]}`, how: party.state ? 'name and state' : 'name', candidates: [`fdic:${pool[0][0]}`] };
  if (pool.length > 1) return { key: null, how: 'ambiguous', candidates: pool.map(([c]) => `fdic:${c}`).sort() };
  return { key: null, how: 'none', candidates: [] };
}

// Every bank an order names, as keys. An order against a holding company matches only through an alias a principal added.
export function orderBanks(order, ctx) {
  return [...new Set((order?.parties ?? []).map((p) => resolveParty(p, ctx).key).filter(Boolean))].sort();
}

// ---- Rules ---------------------------------------------------------------------------------------------------------------------
export function validateEnforcementConfig(c) {
  const errors = [];
  const posInt = (v, k, max) => { if (!Number.isInteger(v) || v < 0 || v > max) errors.push(`enforcement.${k} must be a whole number from 0 to ${max}`); };
  if (!c || typeof c !== 'object') return ['config.enforcement is missing'];
  posInt(c.minIntervalMs, 'minIntervalMs', 600000);
  posInt(c.maxDocsPerRun, 'maxDocsPerRun', 500);
  posInt(c.maxPdfBytes, 'maxPdfBytes', 50_000_000);
  posInt(c.reviewWindowDays, 'reviewWindowDays', 36600);
  if (!(typeof c.minShare === 'number' && c.minShare >= 0 && c.minShare <= 1)) errors.push('enforcement.minShare must be a number from 0 to 1');
  if (!Array.isArray(c.flags) || !c.flags.length || c.flags.some((f) => typeof f !== 'string' || !/^[a-z][a-z ]{2,60}$/.test(f))) errors.push('enforcement.flags: lowercase phrases, letters and spaces only');
  return errors;
}

const placeholder = (v) => !String(v ?? '').trim() || /\[confirm/i.test(String(v));
const addDays = (ymd, n) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const ymdOf = (d) => new Date(d).toISOString().slice(0, 10);

// ---- Flags: which fixed phrases an order's document contains ---------------------------------------------------------------------
export function flagsIn(text, phrases) {
  const t = ` ${String(text ?? '').toLowerCase().replace(/[^a-z]+/g, ' ')} `;
  const counts = {};
  for (const p of phrases) {
    const words = p.toLowerCase().replace(/[^a-z]+/g, ' ').trim();
    const n = (t.match(new RegExp(`(?<= )${words}(?= )`, 'g')) ?? []).length;
    if (n) counts[p] = n;
  }
  return { found: Object.keys(counts).sort(), counts };
}

// The press release's link to the order PDF: the first PDF on www.federalreserve.gov under /newsevents/pressreleases/files/.
export function orderPdfLink(html) {
  for (const m of String(html ?? '').matchAll(/href="([^"]+\.pdf)"/gi)) {
    let u; try { u = new URL(m[1], FED_WWW); } catch { continue; }
    if (u.host === new URL(FED_WWW).host && u.pathname.startsWith('/newsevents/pressreleases/files/')) return u.toString();
  }
  return null;
}

// ---- The run -------------------------------------------------------------------------------------------------------------------
// Reads both action files, keeps every order against an organization (nationwide: matching happens when the data is read, so an alias
// a principal adds later takes effect at once), records terminations, and reads the order documents of the orders that name a bank
// in the universe, at most maxDocsPerRun a run, each once. The field check runs before anything is written.
export async function runEnforcement({ dir, enforcement = {}, fetchImpl = globalThis.fetch, now = new Date(), clock = () => new Date(), sleep = realSleep, nowMs = () => Date.now() }) {
  const cfgErrors = validateEnforcementConfig(enforcement);
  if (cfgErrors.length) throw new Error(`config.json: ${cfgErrors.join('; ')}`);
  const ua = placeholder(enforcement.userAgent) ? undefined : String(enforcement.userAgent).trim();
  const run = startRun({ source: 'enforcement', query: { regulator: 'frb', files: Object.values(FED_FILES) }, now });
  const fetchedAt = now.toISOString();
  const notes = [];
  if (!ua) notes.push('config.enforcement.userAgent is a placeholder: requests sent no custom User-Agent');
  const counts = { requests: 0, actionsRead: 0, skippedIndividual: 0, orders: 0, ordersNew: 0, terminations: 0, terminationsNew: 0, terminationsRemoved: 0, inUniverse: 0, docsRead: 0, docsUnreadable: 0, docsKept: 0, docsDeferred: 0 };
  const interval = Math.max(0, Number(enforcement.minIntervalMs ?? 2000));
  let last = -Infinity;
  const pace = async () => { const wait = last + interval - nowMs(); if (wait > 0) await sleep(wait); last = nowMs(); };
  const opts = { fetchImpl, userAgent: ua, sleep, retries: 2, timeoutMs: 60000 };
  const text = async (path, maxBytes = 20_000_000) => { await pace(); counts.requests++; return getText(new URL(path, FED_WWW).toString(), {}, { ...opts, maxBytes }); };
  const p = enforcementPaths(dir);
  try {
    // 1. robots.txt. A 404 allows everything; any other failure stops the run, since the rules would be unknown.
    let robots = { rules: [], crawlDelay: null };
    try { robots = robotsFor(parseRobots((await text('/robots.txt', 500_000)).text), ua ?? ''); }
    catch (e) { if (!(e instanceof HttpError && e.status === 404)) throw e; notes.push('robots.txt: none (404), so every path is allowed'); }
    const allowed = (path) => robotsAllows(robots, new URL(path, FED_WWW).pathname);
    for (const f of Object.values(FED_FILES)) if (!allowed(f)) throw new Error(`robots.txt disallows ${f}; nothing was read.`);

    // 2. Both files, then the field check, before anything is written.
    const parsed = {};
    for (const [which, path] of Object.entries(FED_FILES)) {
      const got = await text(path);
      if (got.truncated) throw new Error(`${path} was larger than the 20 MB read limit; nothing was written.`);
      parsed[which] = parseFedFile(got.text, { file: path });
      counts.actionsRead += parsed[which].read; counts.skippedIndividual += parsed[which].skippedIndividual;
    }
    const missing = {};
    for (const x of Object.values(parsed)) for (const [f, n] of Object.entries(x.missing)) missing[f] = (missing[f] ?? 0) + n;
    if (Object.keys(missing).length) {
      const names = Object.keys(missing).sort();
      const line = finishRun(dir, run, { rowsRead: counts.actionsRead, outcome: 'failed', missingFields: names, errors: [`The Federal Reserve's action files lack field(s) on some records: ${names.map((f) => `${f} (${missing[f]})`).join(', ')}. The format may have changed; nothing was written.`], notes, now: clock() });
      return { runId: run.runId, outcome: line.outcome, ...counts, missingFields: names, errors: line.errors };
    }
    // A file that shrank well below what it held last time is not trusted: an order can be dropped from a file, never from history.
    const prevState = readJson(p.state, null);
    const shrank = Object.entries(parsed).filter(([w, x]) => (prevState?.read?.[w] ?? 0) > 0 && x.read < prevState.read[w] * enforcement.minShare).map(([w, x]) => `${FED_FILES[w]} has ${x.read} actions, down from ${prevState.read[w]}`);
    if (shrank.length) {
      const line = finishRun(dir, run, { rowsRead: counts.actionsRead, outcome: 'failed', errors: [`${shrank.join('; ')} (below config.enforcement.minShare). Nothing was written.`], notes, now: clock() });
      return { runId: run.runId, outcome: line.outcome, ...counts, errors: line.errors };
    }

    // 3. Records. An id in both files keeps the recent file's version.
    const byKey = new Map();
    for (const x of [parsed.old, parsed.recent]) for (const o of x.orders) byKey.set(o.key, o);
    const prev = readJson(p.orders, {});
    const institutions = readJson(fdicPaths(dir).institutions, {});
    const ctx = { institutions, aliases: loadAliases(dir) };
    const src = (o, recordId, period) => sourceBlock({ source: 'enforcement', endpoint: o.file, query: { regulator: 'frb', file: o.file }, recordId, period, fetchedAt, runId: run.runId });
    const built = [];
    for (const o of byKey.values()) {
      const { file, ...rest } = o;
      const old = prev[o.key];
      built.push({ ...rest, kind: 'order', flags: old?.flags ?? null, contextOnly: true, firstSeenAt: old?.firstSeenAt ?? fetchedAt, firstRunId: old?.firstRunId ?? run.runId, _source: src(o, o.sourceId, o.date) });
      if (o.terminatedOn) {
        const tk = `${o.key}:termination`;
        const told = prev[tk];
        built.push({ key: tk, regulator: 'frb', sourceId: o.sourceId, type: 'termination', types: ['termination'], terminates: o.key, terminatesType: o.type, date: o.terminatedOn, terminatedOn: null,
          parties: o.parties, link: o.link, linkKind: o.linkKind, kind: 'termination', contextOnly: true, firstSeenAt: told?.firstSeenAt ?? fetchedAt, firstRunId: told?.firstRunId ?? run.runId, _source: src(o, `${o.sourceId}:termination`, o.terminatedOn) });
      }
    }

    // 4. Order documents, for orders that name a bank in the universe: read once, and again only when the link changes.
    const phrases = enforcement.flags;
    const budget = { left: enforcement.maxDocsPerRun };
    for (const rec of built) {
      if (rec.kind !== 'order' || !orderBanks(rec, ctx).length) continue;
      counts.inUniverse++;
      // Kept: a document already read for this link and these phrases. One that could not be fetched (retry) is tried again.
      if (rec.flags && !rec.flags.retry && rec.flags.source === rec.link && JSON.stringify(rec.flags.phrases) === JSON.stringify(phrases)) { counts.docsKept++; continue; }
      if (budget.left <= 0) { counts.docsDeferred++; continue; }
      budget.left--;
      rec.flags = await readFlags(rec.link, { text, pace, counts, opts, enforcement, phrases, allowed, fetchedAt });
    }
    if (counts.docsDeferred) notes.push(`${counts.docsDeferred} order document(s) not read this run (config.enforcement.maxDocsPerRun); the next run reads them`);

    // 5. Merge. Orders are kept once seen, also after they leave the file. A termination is rebuilt each run from its order's
    // termination date: one whose date was removed at the source is removed here too, and the change log says so.
    let changed = 0;
    const next = { ...prev };
    const builtKeys = new Set(built.map((r) => r.key));
    for (const rec of built) {
      const u = upsertWithChanges(prev[rec.key], rec, { key: rec.key, runId: run.runId, dir, now });
      next[rec.key] = u.record; changed += u.changed;
      if (!prev[rec.key]) counts[rec.kind === 'order' ? 'ordersNew' : 'terminationsNew']++;
    }
    for (const [k, r] of Object.entries(prev)) {
      if (r?.kind !== 'termination' || builtKeys.has(k) || !byKey.has(r.terminates)) continue;
      appendJsonl(CHANGES(dir), { runId: run.runId, key: k, field: 'removed', old: r.date, new: null, at: now.toISOString() });
      delete next[k]; counts.terminationsRemoved++; changed++;
    }
    counts.orders = Object.values(next).filter((r) => r.kind === 'order').length;
    counts.terminations = Object.values(next).filter((r) => r.kind === 'termination').length;
    writeJson(p.orders, next);
    writeJson(p.state, { lastRun: run.runId, ranAt: fetchedAt, read: { recent: parsed.recent.read, old: parsed.old.read }, newest: [...byKey.values()].map((o) => o.date).sort().at(-1) ?? null, intervalMs: interval, counts });
    notes.push(`${counts.actionsRead} actions read, ${counts.skippedIndividual} against individuals skipped; ${counts.orders} orders against organizations stored (${counts.ordersNew} new), ${counts.terminations} terminations; ${counts.inUniverse} name a bank in the universe`);
    const line = finishRun(dir, run, { rowsRead: counts.actionsRead, rowsWritten: counts.ordersNew + counts.terminationsNew, rowsChanged: changed, outcome: 'ok', notes, now: clock() });
    return { runId: run.runId, outcome: line.outcome, ...counts, changed };
  } catch (e) {
    const line = finishRun(dir, run, { rowsRead: counts.actionsRead, outcome: 'failed', errors: [String(e.message).slice(0, 300)], notes, now: clock() });
    return { runId: run.runId, outcome: line.outcome, ...counts, errors: line.errors };
  }
}

async function readFlags(link, { text, pace, counts, opts, enforcement, phrases, allowed, fetchedAt }) {
  const base = { source: link, phrases, pages: null, checkedAt: fetchedAt };
  if (!link) return { ...base, document: null, readable: false, reason: 'the source publishes no document for this order', found: [], counts: {} };
  try {
    let pdf = /\.pdf$/i.test(new URL(link).pathname) ? link : null;
    if (new URL(link).host !== new URL(FED_WWW).host) return { ...base, document: null, readable: false, reason: 'not on www.federalreserve.gov, so not fetched', found: [], counts: {} };
    if (!pdf) {
      if (!allowed(link)) return { ...base, document: null, readable: false, reason: 'robots.txt disallows the press release', found: [], counts: {} };
      pdf = orderPdfLink((await text(link, 2_000_000)).text);
      if (!pdf) return { ...base, document: null, readable: false, reason: 'the press release links no order document', found: [], counts: {} };
    }
    if (!allowed(pdf)) return { ...base, document: pdf, readable: false, reason: 'robots.txt disallows the order document', found: [], counts: {} };
    await pace(); counts.requests++;
    const got = await getBytes(pdf, {}, { ...opts, maxBytes: enforcement.maxPdfBytes });
    const t = got.truncated ? { readable: false, reason: 'larger than config.enforcement.maxPdfBytes' } : pdfText(got.bytes);
    if (!t.readable) { counts.docsUnreadable++; return { ...base, document: pdf, readable: false, reason: t.reason, found: [], counts: {} }; }
    counts.docsRead++;
    return { ...base, document: pdf, readable: true, reason: null, ...flagsIn(t.text, phrases) };
  } catch (e) {
    counts.docsUnreadable++;
    return { ...base, document: null, readable: false, reason: `not fetched: ${String(e.message).slice(0, 80)}`, retry: true, found: [], counts: {} };
  }
}

// ---- What the orders give the rest of the pipeline ---------------------------------------------------------------------------------
const typeLabel = (t) => TYPES[t] ?? TYPES.other;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const article = (s) => (/^[aeiou]/i.test(s) ? 'an' : 'a');

// Signals by institution key, from the stored orders and the current aliases. Each order gives an EVENT signal (type 'enforcement');
// an order of an ACTIVE type with no termination recorded also gives a STATE signal ('enforcement_active'), which ends when its
// termination is recorded; a termination gives an event ('enforcement_terminated'). Labels are fixed templates over codes and dates.
export function enforcementSignals({ dir, institutions, aliases } = {}) {
  const orders = readJson(enforcementPaths(dir).orders, {});
  const ctx = { institutions: institutions ?? readJson(fdicPaths(dir).institutions, {}), aliases: aliases ?? loadAliases(dir) };
  const out = {};
  const terminated = new Set(Object.values(orders).filter((r) => r?.kind === 'termination').map((r) => r.terminates));
  for (const r of Object.values(orders)) {
    if (!r || !DATE.test(String(r.date))) continue;
    const reg = REGULATORS[r.regulator] ?? r.regulator;
    for (const key of orderBanks(r, ctx)) {
      const common = { source: 'enforcement', key, regulator: r.regulator, link: r.link, evidence: [r.key], firstSeenAt: r.firstSeenAt ?? null, flags: r.flags?.found ?? [] };
      if (r.kind === 'termination') {
        (out[key] ??= []).push({ ...common, id: `enforcement:${r.key}`, kind: 'event', type: 'enforcement_terminated', orderType: r.terminatesType, terminates: r.terminates, date: r.date, period: r.date,
          label: `${cap(typeLabel(r.terminatesType))} from the ${reg} terminated, effective ${r.date}` });
        continue;
      }
      (out[key] ??= []).push({ ...common, id: `enforcement:${r.key}`, kind: 'event', type: 'enforcement', orderType: r.type, orderTypes: r.types, date: r.date, period: r.date,
        label: `${cap(typeLabel(r.type))} from the ${reg}, effective ${r.date}` });
      if (ACTIVE_TYPES.includes(r.type) && !terminated.has(r.key)) {
        (out[key] ??= []).push({ ...common, id: `enforcement-active:${r.key}`, kind: 'state', type: 'enforcement_active', orderType: r.type, date: r.date, period: r.date,
          label: `Under ${article(typeLabel(r.type))} ${typeLabel(r.type)} from the ${reg} effective ${r.date}; no termination is recorded` });
      }
    }
  }
  for (const list of Object.values(out)) list.sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : a.id < b.id ? -1 : 1));
  return out;
}

// Stored order records (orders and terminations) by bank key, each list newest first: for `outbound enforcement list` and the
// briefer's later use (E18-S4). One pass over the orders.
export function ordersByBank({ dir }) {
  const orders = readJson(enforcementPaths(dir).orders, {});
  const ctx = { institutions: readJson(fdicPaths(dir).institutions, {}), aliases: loadAliases(dir) };
  const out = new Map();
  for (const r of Object.values(orders)) for (const k of orderBanks(r, ctx)) out.set(k, [...(out.get(k) ?? []), r]);
  for (const l of out.values()) l.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.key < b.key ? -1 : 1));
  return out;
}
export const ordersFor = ({ dir, key }) => ordersByBank({ dir }).get(key) ?? [];

// The review list: orders (not terminations) dated within reviewWindowDays of today (by the order's date or its termination's) that
// match no bank, or more than one, and that name a party a principal should look at: one in the metros' states (metros.json hqStates,
// where a holding company of a bank in the list usually is), one whose name is shared by two banks, or one whose name resembles a bank
// in the list in its own state (matchInstitution's suggestions). Every other unmatched order is a bank elsewhere and is left out.
// Each party comes with its suggestions; nothing is guessed.
const reviewParty = (x, { institutions, aliases, hqStates }) => {
  const m = resolveParty(x, { institutions, aliases });
  if (m.key) return null;
  const sameState = Object.fromEntries(Object.entries(institutions).filter(([, i]) => !x.state || i?.STALP === x.state));
  const suggestions = m.how === 'ambiguous' ? [] : matchInstitution(x.name, { institutions: sameState }).suggestions;
  if (!(m.how === 'ambiguous' || suggestions.length || (x.state && hqStates.includes(x.state)))) return null;
  return { ...x, how: m.how, candidates: m.candidates, suggestions };
};
const inWindow = (r, from) => r.date >= from || (r.terminatedOn && r.terminatedOn >= from);

export function unmatchedOrders({ dir, enforcement = {}, hqStates = [], now = new Date() }) {
  const orders = readJson(enforcementPaths(dir).orders, {});
  const ctx = { institutions: readJson(fdicPaths(dir).institutions, {}), aliases: loadAliases(dir), hqStates };
  const from = addDays(ymdOf(now), -(enforcement.reviewWindowDays ?? 1825));
  const rows = [];
  for (const r of Object.values(orders)) {
    if (r?.kind !== 'order' || !inWindow(r, from) || orderBanks(r, ctx).length) continue;
    const parties = (r.parties ?? []).map((x) => reviewParty(x, ctx)).filter(Boolean);
    if (parties.length) rows.push({ key: r.key, regulator: r.regulator, type: r.type, date: r.date, terminatedOn: r.terminatedOn ?? null, link: r.link, parties });
  }
  return rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.key < b.key ? -1 : 1));
}

// A principal resolves a review-list entry: the name the order uses becomes an alias of a bank in the universe.
export function aliasParty({ dir, key, name, by }) {
  if (!/^fdic:\d+$/.test(String(key ?? ''))) throw new Error('--key must be fdic:<CERT>.');
  if (typeof name !== 'string' || !name.trim()) throw new Error('--name: the organization\'s name exactly as the order gives it.');
  const institutions = readJson(fdicPaths(dir).institutions, {});
  if (!institutions[key.slice(5)]) throw new Error(`${key} is not in the bank list (sources/fdic/institutions.json). Only a bank in the universe can be given an alias.`);
  return { key, bank: institutions[key.slice(5)].NAME ?? null, aliases: addAlias({ dir, key, alias: name.trim(), by }) };
}

// ---- Checking it against the source (read-only) (PRD E2-S6) ----------------------------------------------------------------------
const check = (id, ok, summary, detail) => ({ id, ok: !!ok, summary, ...(detail ? { detail } : {}) });
const ORDER_KEYS = new Set(['key', 'regulator', 'sourceId', 'type', 'types', 'terminates', 'terminatesType', 'date', 'terminatedOn', 'parties', 'link', 'linkKind', 'kind', 'flags', 'contextOnly', 'firstSeenAt', 'firstRunId', '_source']);

export async function verifyEnforcement({ dir, enforcement = {}, hqStates = [], fetchImpl = globalThis.fetch, sleep = realSleep, now = new Date(), sample = 5, freshDays = 40 }) {
  const p = enforcementPaths(dir);
  const state = readJson(p.state, null), orders = readJson(p.orders, null);
  if (!state || !orders) return { source: 'enforcement', checks: [check('enforcement.present', false, 'No enforcement orders yet. Run: outbound sources run enforcement')], sample: [] };
  const checks = [];
  const age = Math.floor((now.getTime() - Date.parse(state.ranAt)) / 86400000);
  checks.push(check('enforcement.fresh', age <= freshDays, age <= freshDays ? `The last run was ${age} day(s) ago.` : `The last run was ${age} days ago (more than ${freshDays}). Run: outbound sources run enforcement`));

  const recs = Object.values(orders);
  const bad = recs.filter((r) => !r?._source || SOURCE_KEYS.some((k) => r._source[k] === undefined || r._source[k] === null || r._source[k] === '') || !(String(r.link ?? '').startsWith(`${FED_WWW}/`) || (r.link === null && r.linkKind === 'none')) || !TYPES[r.type] || !DATE.test(String(r.date)) || Object.keys(r).some((k) => !ORDER_KEYS.has(k)));
  const orphans = recs.filter((r) => r?.kind === 'termination' && !orders[r.terminates]);
  checks.push(check('enforcement.sourced', !bad.length && !orphans.length, `${recs.length - bad.length} of ${recs.length} stored records carry their source, a link on www.federalreserve.gov (or the source's own "DNE": no document), a type code and a date, and no field outside the order's own.${orphans.length ? ` ${orphans.length} termination(s) point to no stored order.` : ''}`, bad.length || orphans.length ? { bad: bad.slice(0, 10).map((r) => r?.key), orphans: orphans.slice(0, 10).map((r) => r.key) } : undefined));

  // Recall: both files again; every stored order must still be in them, and every order in them must be stored.
  const ua = placeholder(enforcement.userAgent) ? undefined : String(enforcement.userAgent).trim();
  let last = -Infinity; const interval = Math.max(0, Number(enforcement.minIntervalMs ?? 2000));
  const pace = async () => { const wait = last + interval - Date.now(); if (wait > 0) await sleep(wait); last = Date.now(); };
  try {
    const live = new Map();
    for (const path of Object.values(FED_FILES)) {
      await pace();
      const x = parseFedFile((await getText(`${FED_WWW}${path}`, {}, { fetchImpl, userAgent: ua, sleep, maxBytes: 20_000_000 })).text, { file: path });
      for (const o of x.orders) live.set(o.key, o);
    }
    const stored = recs.filter((r) => r.kind === 'order');
    const gone = stored.filter((r) => !live.has(r.key)).map((r) => r.key);
    const notStored = [...live.keys()].filter((k) => !orders[k]);
    const termDiff = stored.filter((r) => live.has(r.key) && (live.get(r.key).terminatedOn ?? null) !== (r.terminatedOn ?? null)).map((r) => r.key);
    const ok = !gone.length && !notStored.length && !termDiff.length;
    checks.push(check('enforcement.recall', ok, ok ? `All ${stored.length} stored orders were found again in the Federal Reserve's files, with the same termination dates, and none there is missing here.`
      : `${gone.length} stored order(s) no longer in the files; ${notStored.length} order(s) in the files not stored; ${termDiff.length} with a different termination date. Run: outbound sources run enforcement`, ok ? undefined : { gone: gone.slice(0, 10), notStored: notStored.slice(0, 10), termination: termDiff.slice(0, 10) }));
  } catch (e) { checks.push(check('enforcement.recall', false, `The Federal Reserve's files could not be read: ${String(e.message).slice(0, 120)}`)); }

  // Matched or on the review list: the PRD's rule, for every order in the review window that names a party a principal should look
  // at (see unmatchedOrders). Both counts are reported; the check fails only if such an order is neither.
  const ctx = { institutions: readJson(fdicPaths(dir).institutions, {}), aliases: loadAliases(dir), hqStates };
  const review = unmatchedOrders({ dir, enforcement, hqStates, now });
  const reviewKeys = new Set(review.map((r) => r.key));
  const from = addDays(ymdOf(now), -(enforcement.reviewWindowDays ?? 1825));
  const windowed = recs.filter((r) => r.kind === 'order' && inWindow(r, from));
  const matched = windowed.filter((r) => orderBanks(r, ctx).length);
  const neither = windowed.filter((r) => !orderBanks(r, ctx).length && (r.parties ?? []).some((x) => reviewParty(x, ctx)) && !reviewKeys.has(r.key));
  checks.push(check('enforcement.matched', !neither.length, `${windowed.length} order(s) in the review window: ${matched.length} matched to a bank in the list, ${review.length} on the review list (outbound enforcement unmatched), and ${windowed.length - matched.length - review.length} naming no party in the metros' states or like a bank in the list.${neither.length ? ` ${neither.length} should be on the review list and are not: a bug.` : ''}`, neither.length ? { neither: neither.slice(0, 10).map((r) => r.key) } : undefined));

  const rows = matched.sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, sample).map((r) => ({ key: r.key, type: r.type, date: r.date, terminatedOn: r.terminatedOn ?? null, banks: orderBanks(r, ctx), flags: r.flags?.found ?? null, check: r.link }));
  return { source: 'enforcement', checks, sample: rows };
}
