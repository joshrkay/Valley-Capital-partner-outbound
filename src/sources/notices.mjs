// A source adapter for a county notice list (docs/county-loans.md; docs/county-data-build-vs-buy.md 3.4 and 5.2, component 9): the
// interface a county's parser plugs into, and the run and the verify check that every such source shares.
//
// WHAT AN ADAPTER PROVIDES (defineNoticeSource checks each):
//   id, label        a safe id ("example-county") and a plain name
//   county, state    { fips, name } and the two-letter state of the county
//   channel          'a' an official feed bought under the county's agreement; 'b' a free public list meant to be read; 'c' a public
//                    search site, only after a dated read of its robots.txt and terms allows it (county-data-build-vs-buy 3.4)
//   cadence          'weekly', or 'twice-weekly' (Texas, where a notice gives about 21 days)
//   hosts            every host it reads. Nothing else is fetched, not even a document's own link
//   terms            { robotsCheckedOn, termsCheckedOn, decision, by }, and optionally nextRecheckOn and waitingOn: the dated check
//                    data-sources section 4 asks for. A source runs only with decision 'allowed', both dates and who decided, a terms
//                    check under a year old, and, when the decision sets a recheck date, only until that date; an invented example runs
//                    only against its fake
//   example          true for an invented source (src/sources/counties/example.mjs): never run against the network
//   requests({ now, state })        the pages to read this run, [{ url, kind? }]; `state` is the source's last run (loans/state.json)
//   parse(text, { url, fetchedAt, kind, state, since })  one page to { documents, rows, skipped, missing, follow, known, items }:
//                    documents in the shape buildDocument (src/loans.mjs) takes, the rows read, the rows skipped with a reason (a document
//                    type we do not keep), and a count per required field the page lacks. A missing field is a format change: the run
//                    fails and writes nothing. `follow` lists further pages the page links that this run reads too, [{ url, kind,
//                    binary?, posted?, label?, conditional? }] (a report index's files); `known` counts the linked files left alone
//                    because they were read before (see `files` below). `items` lists linked documents, one record each (see readDocument)
// and, optionally:
//   parseFile(bytes, { url, fetchedAt, kind, posted, label, etag, lastModified, pdfToText })  a followed file read as bytes (a PDF
//                    report holding many documents): a promise of the same shape as parse gives, plus `file: { key, ... }`, the file's
//                    own key and dates, which the run keeps in the source's state on success, so the next run knows which files it read
//   readDocument(bytes, { url, item, fetchedAt })  for a list that links one document per file (a Texas clerk's posted notices: one
//                    scanned PDF each): one fetched file to { document, layout, reason }, async: document in buildDocument's shape
//                    (without url), or null with the reason it could not be read. parse then returns `items`: [{ documentNumber, url,
//                    listedDate, listLink }], the number being the record's id within the source; listedDate the list's own date for
//                    it, used only to choose the first run's backfill; listLink, when the document's own URL would name a person, a link
//                    to where the list shows it, which the bank's file and the events carry instead
//   parserVersion    with readDocument: a whole number, raised when the reader improves, so a document held as unreadable is fetched
//                    once more
//   backfill         { since, requests({ now, state, since }) }: a one-time read of the source's archive back to `since`, with the
//                    same gate, robots.txt and pacing as the weekly run (outbound loans backfill)
//   minIntervalMs    a longer interval between requests than config.counties.minIntervalMs, where the county's own site asks one
// and, outside the module: a fake with invented data for its tests (test/county-notices-fake.mjs for the example), and its live
// check, which is verifyNoticeSource below run against the real host once the source is allowed.
//
// THE GATE. runnable: the decision above, config.counties.sources (a source it marks not enabled never runs), and no recorded block.
//
// THE RUN. robots.txt first, for every host (a 404 allows everything; any other failure stops the run, since the rules would be
// unknown); a disallowed page stops the run. Every request names the firm (config.counties.userAgent) and keeps at least
// config.counties.minIntervalMs apart, or the source's own interval or the host's Crawl-delay if that is longer. Nothing bypasses a
// block: no login, no CAPTCHA, no challenge page, no second address. A refusal (401, 403, 407, 429, 451) or a challenge page, on a
// page or in place of a file, stops the run, writes nothing, and records the block, so the source does not run again until a
// principal decides and clears it (clearBlock). Each page is parsed and every document built and checked before anything is written;
// then the weekly diff (src/loans.mjs) writes what is new or changed, and the index matches lenders to banks and records the events.
//
// FOLLOWED PAGES AND FILES (parse's `follow`). A followed page is read only on one of the source's hosts, after its robots.txt, and at
// most MAX_DEPTH links from a requested page. A followed file the source read before is asked for with its ETag and Last-Modified,
// and a 304 is not read again.
//
// LINKED DOCUMENTS (parse's `items`, readDocument). The list is read with its last ETag when the last run left nothing undone; only
// documents not stored yet are fetched, at most config.counties.maxDocumentsPerRun a run, the rest left for the next. On a source's
// first run only documents the list dates within config.counties.backfillDays are read; the rest are recorded as history and never
// fetched. A document that cannot be read (no lender, no date, not a PDF) is held, by id and reason only, and fetched again only when
// the adapter's parserVersion rises. loans/lists/<source>.json keeps the list's ETag, the history and the held documents: ids and
// reasons, no names and no links. Every message about a linked document says "a listed document", never its path.
import { readJson, writeJson, safeId } from '../store.mjs';
import { getText, getBytes, getFile, realSleep, HttpError } from './http.mjs';
import { startRun, finishRun, SOURCE_KEYS } from './runlog.mjs';
import { parseRobots, robotsFor, robotsAllows } from './fdicsales.mjs';
import { buildDocument, diffDocuments, writeDiff, buildLoanIndex, loadDocuments, loansPaths, readLoanState, hashDocument, documentId, docNumberKey, documentDate, DOC_TYPES, RECORD_KEYS, validYmd } from '../loans.mjs';
import { matchLender, reviewKey, LENDER_ROLES } from '../lenders.mjs';
import { loadAliases } from '../candidates.mjs';
import { fdicPaths } from './fdic.mjs';

export const CHANNELS = Object.freeze({ a: 'an official feed under the county\'s agreement', b: 'a free public list meant to be read', c: 'a public search site, after a dated terms read' });
export const CADENCES = Object.freeze({ weekly: 7, 'twice-weekly': 4 });
const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const RUNS_KEPT = 12;
const FILES_KEPT = 200;
export const MAX_DEPTH = 3;
export const MAX_REQUESTS = 100;
// The longest a terms check holds (sources.json: "A terms check older than a year ... stops the source until a principal decides").
export const TERMS_MAX_AGE_DAYS = 365;
// The linked-document limits when config.counties does not set them.
export const LINKED_DEFAULTS = Object.freeze({ maxDocumentBytes: 15_000_000, maxDocumentsPerRun: 40, backfillDays: 60 });

// ---- The interface -------------------------------------------------------------------------------------------------------------
export function defineNoticeSource(spec) {
  const e = [];
  try { safeId(spec?.id); } catch { e.push('id must be a safe id (lowercase letters, digits, hyphens)'); }
  if (typeof spec?.label !== 'string' || !spec.label.trim()) e.push('label is required');
  if (!/^\d{5}$/.test(String(spec?.county?.fips ?? '')) || typeof spec?.county?.name !== 'string' || !spec.county.name.trim()) e.push('county needs a five-digit fips code and a name');
  if (!/^[A-Z]{2}$/.test(String(spec?.state ?? ''))) e.push('state must be a two-letter code');
  if (!CHANNELS[spec?.channel]) e.push(`channel must be one of ${Object.keys(CHANNELS).join(', ')}`);
  if (!CADENCES[spec?.cadence]) e.push(`cadence must be one of ${Object.keys(CADENCES).join(', ')}`);
  if (!Array.isArray(spec?.hosts) || !spec.hosts.length || spec.hosts.some((h) => !HOST.test(String(h)))) e.push('hosts must list every host it reads');
  if (!spec?.terms || typeof spec.terms !== 'object') e.push('terms: { robotsCheckedOn, termsCheckedOn, decision, by } is required');
  for (const f of ['requests', 'parse']) if (typeof spec?.[f] !== 'function') e.push(`${f} must be a function`);
  if (spec?.parseFile !== undefined && typeof spec.parseFile !== 'function') e.push('parseFile must be a function');
  if (spec?.readDocument !== undefined && typeof spec.readDocument !== 'function') e.push('readDocument must be a function');
  if (spec?.backfill !== undefined && (typeof spec.backfill?.requests !== 'function' || !validYmd(spec.backfill?.since))) e.push('backfill needs { since: YYYY-MM-DD, requests }');
  if (spec?.minIntervalMs !== undefined && !(Number.isInteger(spec.minIntervalMs) && spec.minIntervalMs >= 0 && spec.minIntervalMs <= 600000)) e.push('minIntervalMs must be a whole number from 0 to 600000');
  if (spec?.parserVersion !== undefined && !(Number.isInteger(spec.parserVersion) && spec.parserVersion >= 1)) e.push('parserVersion must be a whole number from 1');
  if (e.length) throw new Error(`County source ${spec?.id ?? '(no id)'}: ${e.join('; ')}.`);
  return Object.freeze({ ...spec, example: !!spec.example, hosts: Object.freeze([...spec.hosts]), terms: Object.freeze({ ...spec.terms }),
    ...(spec.backfill ? { backfill: Object.freeze({ ...spec.backfill }) } : {}), parserVersion: spec.parserVersion ?? 1 });
}

const ymdOf = (d) => new Date(d).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.floor((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

// Whether a source may run: an example only against its fake; any other only once a principal's dated terms decision allows it, while
// that terms check is under a year old, until the recheck date the decision set, never while config.counties.sources marks it not
// enabled, and while no block is recorded against it. `state` is the source's entry in loans/state.json.
export function runnable(source, { allowExample = false, counties = null, now = new Date(), state = null } = {}) {
  if (source.example) return allowExample ? { ok: true } : { ok: false, reason: `${source.label} is invented. It runs only against its fake, in the tests.` };
  const t = source.terms ?? {};
  const waiting = String(t.waitingOn ?? '').trim() ? ` Waiting on: ${String(t.waitingOn).trim()}` : '';
  if (t.decision !== 'allowed' || !validYmd(t.robotsCheckedOn) || !validYmd(t.termsCheckedOn) || !String(t.by ?? '').trim())
    return { ok: false, reason: `${source.label} has no recorded decision that its robots.txt and terms allow automated reading (terms.decision 'allowed', both dates and who decided). Nothing was read.${waiting}` };
  const cfg = counties?.sources?.[source.id];
  if (cfg && cfg.enabled !== true) return { ok: false, reason: `${source.label} is not enabled in config.counties.sources.${cfg.waitingOn ? ` Waiting on: ${cfg.waitingOn}` : ''} Nothing was read.` };
  const today = ymdOf(now);
  if (daysBetween(t.termsCheckedOn, today) > TERMS_MAX_AGE_DAYS)
    return { ok: false, reason: `${source.label}: its terms were last read on ${t.termsCheckedOn}, more than a year ago. A principal reads them again and records the date. Nothing was read.` };
  if (t.nextRecheckOn !== undefined && t.nextRecheckOn !== null) {
    if (!validYmd(t.nextRecheckOn)) return { ok: false, reason: `${source.label}: the decision's recheck date "${t.nextRecheckOn}" is not a date. Nothing was read.` };
    if (today > t.nextRecheckOn)
      return { ok: false, reason: `${source.label}: the principal's decision asks for its terms to be rechecked by ${t.nextRecheckOn}, and that date has passed. A principal rereads them and records the check and the next recheck date in sources.json. Nothing was read.` };
  }
  if (state?.blocked)
    return { ok: false, reason: `${source.label} was blocked on ${String(state.blocked.at ?? '').slice(0, 10)} (${state.blocked.reason}). Nothing is read again until a principal decides and clears it: outbound loans unblock --source ${source.id} --by NAME.` };
  return { ok: true };
}

// The sources the weekly job reads (loans.watch): every source config.counties.watch lists that config.counties.sources does not mark
// not enabled, and every source config.counties.sources marks enabled, in that order. Ids only; the gate still decides each run.
export function enabledSourceIds(counties = {}) {
  const cfg = counties?.sources ?? {};
  const off = (id) => cfg[id] && cfg[id].enabled !== true;
  const on = Object.entries(cfg).filter(([id, s]) => !id.startsWith('_') && s?.enabled === true).map(([id]) => id);
  return [...new Set([...(counties?.watch ?? []).filter((id) => !off(id)), ...on])];
}

const placeholder = (v) => !String(v ?? '').trim() || /\[confirm/i.test(String(v));
export function validateCountyConfig(c) {
  if (!c || typeof c !== 'object') return ['config.counties is missing'];
  const errors = [];
  const int = (v, k, min, max) => { if (!Number.isInteger(v) || v < min || v > max) errors.push(`counties.${k} must be a whole number from ${min} to ${max}`); };
  if (typeof c.userAgent !== 'string') errors.push('counties.userAgent must be a string: the firm\'s name and a monitored business contact');
  int(c.minIntervalMs, 'minIntervalMs', 0, 600000);
  int(c.maxBytes, 'maxBytes', 1, 50_000_000);
  int(c.freshDays, 'freshDays', 1, 366);
  // The linked-document limits are optional: LINKED_DEFAULTS when absent.
  if (c.maxDocumentBytes !== undefined) int(c.maxDocumentBytes, 'maxDocumentBytes', 1, 50_000_000);
  if (c.maxDocumentsPerRun !== undefined) int(c.maxDocumentsPerRun, 'maxDocumentsPerRun', 1, 500);
  if (c.backfillDays !== undefined) int(c.backfillDays, 'backfillDays', 0, 3660);
  if (!Array.isArray(c.watch) || c.watch.some((id) => { try { safeId(id); return false; } catch { return true; } })) errors.push('counties.watch must list source ids');
  // Each registered real source's switch: enabled true only once a principal has recorded the decision its adapter's terms carry.
  if (c.sources !== undefined) {
    if (!c.sources || typeof c.sources !== 'object' || Array.isArray(c.sources)) errors.push('counties.sources must map source ids to { enabled, waitingOn }');
    else for (const [id, s] of Object.entries(c.sources)) {
      if (id.startsWith('_')) continue;
      try { safeId(id); } catch { errors.push(`counties.sources: "${id}" is not a source id`); continue; }
      if (typeof s?.enabled !== 'boolean') errors.push(`counties.sources.${id}.enabled must be true or false`);
      if (s?.waitingOn !== undefined && typeof s.waitingOn !== 'string') errors.push(`counties.sources.${id}.waitingOn must be text`);
    }
  }
  return errors;
}

// A page that is a challenge or a CAPTCHA, not the list: the run stops there. Read from the first part of the page only.
const CHALLENGE = /cf-chl|challenge-platform|cf_chl_opt|<title>\s*just a moment|attention required|g-recaptcha|h-captcha|hcaptcha|cf-turnstile|captcha/i;
export const looksLikeChallenge = (text) => CHALLENGE.test(String(text ?? '').slice(0, 50000));
// Answers that mean the host refused us. Each stops the run and is recorded as a block.
export const BLOCK_STATUSES = Object.freeze([401, 403, 407, 429, 451]);

// A principal clears a recorded block once they have decided the source may be read again (outbound loans unblock).
export function clearBlock({ dir, sourceId, by, now = new Date() }) {
  if (!String(by ?? '').trim()) throw new Error('Who clears the block (--by NAME) is required.');
  const state = readLoanState(dir);
  const mine = state.sources?.[sourceId];
  if (!mine?.blocked) return { sourceId, cleared: false };
  const { blocked, ...rest } = mine;
  writeJson(loansPaths(dir).state, { ...state, sources: { ...state.sources, [sourceId]: { ...rest, lastBlock: { ...blocked, clearedAt: now.toISOString(), clearedBy: String(by).trim() } } } });
  return { sourceId, cleared: true, blockedAt: blocked.at };
}

// ---- Parsing helpers for a list page ---------------------------------------------------------------------------------------------
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘' };
const decode = (s) => String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, x) => (x[0] === '#' ? String.fromCodePoint(x[1].toLowerCase() === 'x' ? parseInt(x.slice(2), 16) : parseInt(x.slice(1), 10)) : ENT[x.toLowerCase()] ?? m));
export const cellText = (html) => decode(String(html ?? '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

// Every table on a page: its id, its header cells and its rows, each row's cells as text with the first link in each cell. No script
// runs and no markup survives: a cell is text.
export function htmlTables(html) {
  const out = [];
  for (const t of String(html ?? '').matchAll(/<table\b([^>]*)>([\s\S]*?)<\/table>/gi)) {
    const id = /\bid\s*=\s*"([^"]*)"/i.exec(t[1])?.[1] ?? null;
    let headers = null;
    const rows = [];
    for (const r of t[2].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...r[1].matchAll(/<(t[hd])\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)];
      if (!cells.length) continue;
      if (!headers && cells.every((c) => c[1].toLowerCase() === 'th')) { headers = cells.map((c) => cellText(c[2])); continue; }
      rows.push({ cells: cells.map((c) => cellText(c[2])), links: cells.map((c) => decode(/\bhref\s*=\s*"([^"]+)"/i.exec(c[2])?.[1] ?? '') || null) });
    }
    out.push({ id, headers: headers ?? [], rows });
  }
  return out;
}

// "$4,200,000.00" -> 4200000; blank -> null; anything else -> NaN, which buildDocument refuses.
export function parseUsd(s) {
  const t = String(s ?? '').trim();
  if (!t) return null;
  if (!/^\$?\s?\d{1,3}(,\d{3})*(\.\d{1,2})?$|^\$?\s?\d+(\.\d{1,2})?$/.test(t)) return Number.NaN;
  return Number(t.replace(/[$,\s]/g, ''));
}
// "11/10/2026" or "2026-11-10" -> "2026-11-10"; blank -> null; anything else is returned as it is, for buildDocument to refuse.
export function parseDate(s) {
  const t = String(s ?? '').trim();
  if (!t) return null;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : t;
}



// ---- The run ---------------------------------------------------------------------------------------------------------------------
const LINKED_COUNTS = ['listed', 'fetched', 'held', 'deferred'];
const stamp = (runId, at, outcome, counts, error) => ({ runId, ranAt: at, outcome, read: counts.read, added: counts.added, changed: counts.changed, unchanged: counts.unchanged, skipped: counts.skipped,
  ...(counts.files || counts.filesNotModified || counts.filesKnown ? { files: counts.files, filesNotModified: counts.filesNotModified, filesKnown: counts.filesKnown } : {}),
  ...(counts.listed !== undefined ? Object.fromEntries(LINKED_COUNTS.map((k) => [k, counts[k]])) : {}), ...(error ? { error } : {}) });
// The files a source has read (a report index's PDFs), newest first, one per key: what the next run asks for conditionally or leaves.
const fileKey = (f) => f.key ?? `${f.url}|${f.etag ?? f.lastModified ?? ''}`;
export function mergeFiles(prev = [], add = []) {
  const out = [], seen = new Set();
  for (const f of [...add, ...prev]) { const k = fileKey(f); if (seen.has(k)) continue; seen.add(k); out.push({ ...f, key: k }); }
  return out.slice(0, FILES_KEPT);
}
function recordRun(dir, source, entry, { files = [], blocked = null } = {}) {
  const state = readLoanState(dir);
  const prev = state.sources?.[source.id] ?? {};
  const kept = entry.outcome === 'failed' ? prev.files ?? [] : mergeFiles(prev.files ?? [], files);
  const mine = { id: source.id, label: source.label, county: source.county, state: source.state, channel: source.channel, cadence: source.cadence,
    lastRun: entry, lastOk: entry.outcome === 'ok' ? { runId: entry.runId, ranAt: entry.ranAt } : prev.lastOk ?? null, runs: [entry, ...(prev.runs ?? [])].slice(0, RUNS_KEPT),
    ...(kept.length ? { files: kept } : {}), ...(blocked ?? prev.blocked ? { blocked: blocked ?? prev.blocked } : {}), ...(prev.lastBlock ? { lastBlock: prev.lastBlock } : {}) };
  writeJson(loansPaths(dir).state, { ...state, sources: { ...(state.sources ?? {}), [source.id]: mine } });
}
const stable = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((y) => [y, x[y]])) : x));
// A reason that is safe for a log: no quoted value (a document number, a name) survives.
const safeReason = (s) => String(s ?? '').replace(/"[^"]*"/g, '"…"').slice(0, 160);

// A followed page, as the run and the verify check take it from a parse: an address on one of the source's hosts, its kind, and for a
// file read as bytes the index's posted date and label and, when it was read before, its validators.
function followed(f, depth) {
  const u = new URL(String(f?.url ?? ''));
  if (!['https:', 'http:'].includes(u.protocol)) throw new Error(`a followed link "${f?.url}" is not a web address`);
  return { url: u.toString(), u, kind: f.kind ?? null, binary: !!f.binary, posted: f.posted ?? null, label: f.label ?? null, conditional: f.conditional ?? null, depth };
}

// One run of one source. Returns counts only (no name, no address, no document link), as a job result and the run log may carry. With
// `backfill: { since }` it reads the source's archive back to that date instead of the weekly pages (the same gate, robots.txt and
// pacing).
export async function runNoticeSource({ dir, source, counties = {}, fetchImpl = globalThis.fetch, now = new Date(), clock = () => new Date(), sleep = realSleep, nowMs = () => Date.now(), allowExample = false, backfill = null, pdfToText }) {
  const cfgErrors = validateCountyConfig(counties);
  if (cfgErrors.length) throw new Error(`config.json: ${cfgErrors.join('; ')}`);
  const prior = readLoanState(dir).sources?.[source.id] ?? null;
  const may = runnable(source, { allowExample, counties, now, state: prior });
  if (!may.ok) throw new Error(may.reason);
  if (backfill && !source.backfill) throw new Error(`${source.label} has no archive to backfill from.`);
  const since = backfill ? backfill.since ?? source.backfill.since : null;
  if (backfill && !validYmd(since)) throw new Error(`backfill since "${since}" is not a date (YYYY-MM-DD).`);
  if (placeholder(counties.userAgent)) throw new Error('config.counties.userAgent is a placeholder. Every request to a county names the firm and a monitored business contact; a principal fills it.');
  const ua = counties.userAgent.trim();
  const limits = { ...LINKED_DEFAULTS, ...Object.fromEntries(Object.keys(LINKED_DEFAULTS).filter((k) => counties[k] !== undefined).map((k) => [k, counties[k]])) };
  const linked = typeof source.readDocument === 'function';
  const P = loansPaths(dir);
  const list = linked ? readJson(P.list(source.id), null) : null;
  const run = startRun({ source: `county:${source.id}`, query: backfill ? { source: source.id, backfill: since } : { source: source.id }, now });
  const fetchedAt = now.toISOString();
  const notes = [];
  const counts = { requests: 0, pages: 0, files: 0, filesNotModified: 0, filesKnown: 0, rows: 0, read: 0, skipped: 0, added: 0, changed: 0, unchanged: 0, duplicates: 0,
    ...(linked ? { listed: 0, known: 0, history: 0, heldBefore: 0, fetched: 0, held: 0, deferred: 0, notFetched: 0, notModified: 0, layouts: {} } : {}) };
  let interval = Math.max(counties.minIntervalMs, source.minIntervalMs ?? 0);
  let last = -Infinity;
  const pace = async () => { const wait = last + interval - nowMs(); if (wait > 0) await sleep(wait); last = nowMs(); };
  const opts = { fetchImpl, userAgent: ua, sleep, retries: 2, timeoutMs: 60000 };
  const fail = (message, extra = {}) => {
    const { blocked = null, ...lineExtra } = extra;
    const line = finishRun(dir, run, { rowsRead: counts.rows, outcome: 'failed', errors: [String(message).slice(0, 300)], notes, now: clock(), ...lineExtra });
    recordRun(dir, source, stamp(run.runId, fetchedAt, 'failed', counts, String(message).slice(0, 200)), { blocked });
    return { runId: run.runId, outcome: 'failed', ...counts, errors: line.errors, ...(blocked ? { blocked: true } : {}), ...(lineExtra.missingFields ? { missingFields: lineExtra.missingFields } : {}) };
  };
  // A refusal or a challenge: stop at once, write nothing, and record the block so no later run tries again on its own.
  const block = (why) => fail(`Blocked: ${why}. Nothing more was requested and nothing was written. The source stays stopped until a principal decides: outbound loans unblock --source ${source.id} --by NAME`, { blocked: { at: fetchedAt, reason: why } });
  const refused = (e) => e instanceof HttpError && BLOCK_STATUSES.includes(e.status);
  try {
    const first = (backfill ? source.backfill.requests({ now, state: prior, since }) : source.requests({ now, state: prior })) ?? [];
    const pages = first.map((p) => followed(p, 0));
    for (const p of pages) if (!source.hosts.includes(p.u.host)) return fail(`${p.u.host} is not one of the source's hosts; nothing was read.`);
    // 1. robots.txt, once per host: every requested page's host first, and a followed page's or a linked document's before it is read.
    const robots = new Map();
    const robotsOf = async (u) => {
      if (robots.has(u.host)) return robots.get(u.host);
      await pace(); counts.requests++;
      try {
        const r = robotsFor(parseRobots((await getText(`${u.protocol}//${u.host}/robots.txt`, {}, { ...opts, maxBytes: 500_000 })).text), ua);
        robots.set(u.host, r);
        if (r.crawlDelay) interval = Math.max(interval, r.crawlDelay * 1000);
      } catch (e) {
        if (refused(e)) throw Object.assign(new Error(`HTTP ${e.status} on ${u.host}/robots.txt`), { block: true });
        if (!(e instanceof HttpError && e.status === 404)) throw e;
        robots.set(u.host, { rules: [], crawlDelay: null });
        notes.push(`${u.host}/robots.txt: none (404), so every path is allowed`);
      }
      return robots.get(u.host);
    };
    try { for (const p of pages) await robotsOf(p.u); } catch (e) { if (e.block) return block(e.message); throw e; }
    for (const p of pages) if (!robotsAllows(robots.get(p.u.host), `${p.u.pathname}${p.u.search}`)) return fail(`robots.txt on ${p.u.host} disallows ${p.u.pathname}; nothing was read.`);

    // 2. The pages and the files they link, parsed, and every document built and checked before anything is written. A linked-document
    // source's list is read with its last ETag when the last run left nothing undone, so an unchanged list costs no download.
    const docs = [], missing = {}, problems = [], files = [], skippedWhy = {}, items = [], pageMeta = {};
    const queue = [...pages], done = new Set();
    const take = (parsed) => {
      counts.rows += parsed.rows ?? 0;
      counts.skipped += (parsed.skipped ?? []).length;
      for (const s of parsed.skipped ?? []) skippedWhy[s?.reason ?? 'no reason given'] = (skippedWhy[s?.reason ?? 'no reason given'] ?? 0) + 1;
      counts.filesKnown += parsed.known ?? 0;
      for (const [f, n] of Object.entries(parsed.missing ?? {})) missing[f] = (missing[f] ?? 0) + n;
      for (const d of parsed.documents ?? []) {
        const b = buildDocument(d, { source, fetchedAt, runId: run.runId });
        if (b.record) docs.push(b.record); else problems.push(`document ${docNumberKey(d?.documentNumber) || '(no number)'}: ${b.errors[0]}`);
      }
      items.push(...(parsed.items ?? []));
    };
    while (queue.length) {
      const p = queue.shift();
      if (done.has(p.url)) continue;
      done.add(p.url);
      if (counts.requests >= MAX_REQUESTS) return fail(`More than ${MAX_REQUESTS} requests in one run; nothing was written.`);
      try { await robotsOf(p.u); } catch (e) { if (e.block) return block(e.message); throw e; }
      if (!robotsAllows(robots.get(p.u.host), `${p.u.pathname}${p.u.search}`)) return fail(`robots.txt on ${p.u.host} disallows ${p.u.pathname}; nothing was written.`);
      await pace(); counts.requests++;
      let parsed;
      if (p.binary) {
        let got;
        try { got = await getFile(p.url, { ...opts, maxBytes: counties.maxBytes, conditional: p.conditional }); }
        catch (e) { if (refused(e)) return block(`HTTP ${e.status} on ${p.u.pathname}`); throw e; }
        if (got.notModified) { counts.filesNotModified++; continue; }
        if (got.truncated) return fail(`${p.u.pathname} was larger than config.counties.maxBytes; nothing was written.`);
        if (/text\/html/i.test(got.contentType ?? '') && looksLikeChallenge(got.bytes.subarray(0, 50000).toString('utf8'))) return block(`a challenge page instead of ${p.u.pathname}`);
        counts.files++;
        parsed = (await source.parseFile(got.bytes, { url: p.url, fetchedAt, kind: p.kind, posted: p.posted, label: p.label, etag: got.etag, lastModified: got.lastModified, pdfToText })) ?? {};
        if (parsed.file) files.push({ ...parsed.file, url: p.url, posted: p.posted, etag: got.etag, lastModified: got.lastModified, readAt: fetchedAt, runId: run.runId });
      } else {
        const prevPage = linked && p.depth === 0 ? list?.pages?.[p.url] ?? null : null;
        let got;
        try { got = await getText(p.url, {}, { ...opts, maxBytes: counties.maxBytes, conditional: list?.complete && prevPage?.etag ? { etag: prevPage.etag } : null }); }
        catch (e) { if (refused(e)) return block(`HTTP ${e.status} on ${p.u.pathname}`); throw e; }
        if (got.notModified) { counts.notModified++; counts.rows += prevPage?.items ?? 0; pageMeta[p.url] = prevPage; continue; }
        if (got.truncated) return fail(`${p.u.pathname} was larger than config.counties.maxBytes; nothing was written.`);
        if (looksLikeChallenge(got.text)) return block(`a challenge page on ${p.u.pathname}`);
        counts.pages++;
        parsed = source.parse(got.text, { url: p.url, fetchedAt, kind: p.kind, state: prior, since }) ?? {};
        if (linked && p.depth === 0) pageMeta[p.url] = { etag: got.etag ?? null, items: (parsed.items ?? []).length };
      }
      take(parsed);
      if (Object.keys(missing).length) break;   // a format change: nothing more is fetched, and the run fails below
      for (const f of parsed.follow ?? []) {
        const next = followed(f, p.depth + 1);
        if (next.depth > MAX_DEPTH) return fail(`A link ${MAX_DEPTH + 1} pages deep was not followed; nothing was written.`);
        if (!source.hosts.includes(next.u.host)) return fail(`${next.u.host} is not one of the source's hosts; nothing was written.`);
        if (next.binary && typeof source.parseFile !== 'function') return fail('The source links a file but has no parseFile; nothing was written.');
        queue.push(next);
      }
    }
    const gaps = Object.keys(missing).sort();
    if (gaps.length) return fail(`The list lacks field(s): ${gaps.map((f) => `${f} (${missing[f]})`).join(', ')}. Its format may have changed; nothing was written.`, { missingFields: gaps });
    if (problems.length) return fail(`${problems.length} document(s) could not be read, so nothing was written. First: ${problems[0]}`);
    if (counts.skipped) notes.push(`${counts.skipped} row(s) skipped: ${Object.entries(skippedWhy).map(([why, n]) => `${why} (${n})`).join('; ')}`);
    if (counts.files || counts.filesNotModified || counts.filesKnown) notes.push(`${counts.files} file(s) read; ${counts.filesNotModified} unchanged since the last read (304); ${counts.filesKnown} listed and read before, not asked for`);

    // 3. A linked-document source: fetch the documents not stored yet, and read each.
    let listOut = null, suspect = false;
    if (linked) {
      const stored = loadDocuments(dir, source.id);
      const firstRun = !list;
      const history = new Set(list?.history ?? []);
      const held = { ...(list?.held ?? {}) };
      const cutoff = ymdOf(now.getTime() - limits.backfillDays * 86400000);
      const seen = new Set(), todo = [], bad = [];
      for (const it of items) {
        let id;
        try { id = documentId(source.id, it.documentNumber); new URL(it.url); } catch (e) { bad.push(safeReason(e.message)); continue; }
        if (seen.has(id)) { counts.duplicates++; continue; }
        seen.add(id); counts.listed++;
        if (stored[id]) { counts.known++; continue; }
        if (history.has(id)) { counts.history++; continue; }
        if (held[id] && (held[id].parserVersion ?? 0) >= source.parserVersion) { counts.heldBefore++; continue; }
        // The first run reads only the backfill window; what the list dates earlier, or not at all, is history and never fetched.
        if (firstRun && !(validYmd(it.listedDate) && it.listedDate >= cutoff)) { history.add(id); counts.history++; continue; }
        todo.push({ ...it, id });
      }
      if (bad.length) return fail(`${bad.length} listed document(s) have no usable number or link, so nothing was written. Its format may have changed. First: ${bad[0]}`);
      todo.sort((a, b) => String(b.listedDate ?? '').localeCompare(String(a.listedDate ?? '')) || (a.id < b.id ? -1 : 1));
      // At most maxDocumentsPerRun a run, and never past MAX_REQUESTS: the rest wait for the next run.
      const room = Math.max(0, MAX_REQUESTS - counts.requests - 1);
      const batch = todo.slice(0, Math.min(limits.maxDocumentsPerRun, room));
      counts.deferred = todo.length - batch.length;
      const hold = (id, reason) => { held[id] = { reason, at: fetchedAt, parserVersion: source.parserVersion }; counts.held++; };
      // Every message below is about "a listed document", never its path: a Texas notice's file name is the debtor's name.
      for (const it of batch) {
        const u = new URL(it.url);
        if (!source.hosts.includes(u.host)) return fail(`A listed document is on ${u.host}, which is not one of the source's hosts; nothing was written.`);
        try { await robotsOf(u); } catch (e) { if (e.block) return block(e.message); throw e; }
        if (!robotsAllows(robots.get(u.host), `${u.pathname}${u.search}`)) return fail(`robots.txt on ${u.host} disallows a listed document; nothing was written.`);
        await pace(); counts.requests++;
        let got;
        try { got = await getBytes(it.url, {}, { ...opts, maxBytes: limits.maxDocumentBytes }); }
        catch (e) {
          if (refused(e)) return block(`HTTP ${e.status} on a listed document`);
          if (e instanceof HttpError && [404, 410].includes(e.status)) { hold(it.id, `not found (HTTP ${e.status})`); continue; }
          counts.notFetched++;   // a server or network error: tried again next run
          continue;
        }
        if (got.truncated) { hold(it.id, 'larger than config.counties.maxDocumentBytes'); continue; }
        if (!got.bytes.subarray(0, 1024).toString('latin1').includes('%PDF-')) {
          const head = got.bytes.subarray(0, 50000).toString('utf8');
          if (looksLikeChallenge(head)) return block('a challenge page instead of a listed document');
          hold(it.id, `not a PDF (${String(got.contentType ?? 'no type').split(';')[0].trim()})`);
          continue;
        }
        counts.fetched++;
        let r;
        try { r = await source.readDocument(got.bytes, { url: it.url, item: it, fetchedAt }); }
        catch (e) { if (e?.name === 'PdfToolMissing') return fail(e.message); hold(it.id, 'the reader failed on it'); continue; }
        if (!r?.document) { hold(it.id, safeReason(r?.reason ?? 'not read')); continue; }
        const b = buildDocument({ ...r.document, documentNumber: it.documentNumber, url: it.url, ...(got.etag ? { etag: got.etag } : {}), ...(it.listLink ? { listLink: it.listLink } : {}) }, { source, fetchedAt, runId: run.runId });
        if (!b.record) { hold(it.id, `not a complete record: ${safeReason(b.errors[0])}`); continue; }
        docs.push(b.record);
        delete held[it.id];
        if (r.layout) counts.layouts[r.layout] = (counts.layouts[r.layout] ?? 0) + 1;
      }
      if (counts.fetched >= 3 && !docs.length) { suspect = true; notes.push(`none of the ${counts.fetched} document(s) fetched could be read: the documents' format may have changed`); }
      if (counts.held) notes.push(`${counts.held} document(s) held as unreadable (no lender or no date read, or not a PDF); fetched again when the reader improves`);
      if (counts.deferred) notes.push(`${counts.deferred} new document(s) left for the next run (config.counties.maxDocumentsPerRun)`);
      if (counts.notFetched) notes.push(`${counts.notFetched} document(s) not fetched (a server or network error); tried again next run`);
      listOut = { sourceId: source.id, pages: pageMeta, complete: !counts.deferred && !counts.notFetched, history: [...history].sort(), held };
    }

    // 4. The weekly diff, then the index (lender match, bank files, review list, events).
    const diff = diffDocuments(loadDocuments(dir, source.id), docs, { now, runId: run.runId });
    Object.assign(counts, { read: docs.length, added: diff.added.length, changed: diff.changed.length, unchanged: diff.unchanged.length, duplicates: counts.duplicates + diff.duplicates });
    writeDiff(dir, source.id, diff, { runId: run.runId, now });
    if (listOut && stable(listOut) !== stable(list)) writeJson(P.list(source.id), listOut);
    const index = buildLoanIndex({ dir, now, runId: run.runId });
    notes.push(`${counts.read} document(s) read: ${counts.added} new, ${counts.changed} changed, ${counts.unchanged} unchanged; ${index.eventsNew} new event(s) for banks in the list`);
    // Quiet: a run that read nothing because everything its source lists was read before (a file answered 304, or one already read).
    const quiet = counts.files === 0 && counts.filesNotModified + counts.filesKnown > 0;
    const line = finishRun(dir, run, { rowsRead: counts.rows, rowsWritten: counts.added, rowsChanged: counts.changed, outcome: 'ok', suspect, quiet, notes, now: clock() });
    recordRun(dir, source, stamp(run.runId, fetchedAt, line.outcome, counts), { files });
    return { runId: run.runId, outcome: line.outcome, ...counts, index };
  } catch (e) {
    return fail(e.message);
  }
}

// ---- The verify check (PRD E2-S6), read-only --------------------------------------------------------------------------------------
const check = (id, ok, summary, detail) => ({ id, ok: !!ok, summary, ...(detail ? { detail } : {}) });
const ALLOWED_KEYS = new Set(RECORD_KEYS);

// Fresh, sourced, complete against the live list, and every lender name accounted for. Writes nothing.
export async function verifyNoticeSource({ dir, source, counties = {}, fetchImpl = globalThis.fetch, sleep = realSleep, now = new Date(), sample = 5, allowExample = false, pdfToText }) {
  const name = `county:${source.id}`;
  const st = readLoanState(dir).sources?.[source.id] ?? null;
  const stored = loadDocuments(dir, source.id);
  if (!st) return { source: name, checks: [check('county.present', false, `${source.label} has not run yet. Run: outbound loans run --source ${source.id}`)], sample: [] };
  const checks = [];
  const okAt = Date.parse(st.lastOk?.ranAt ?? '');
  const age = Number.isFinite(okAt) ? Math.floor((now.getTime() - okAt) / 86400000) : null;
  const fresh = age !== null && age <= (counties.freshDays ?? CADENCES[source.cadence] + 3);
  checks.push(check('county.fresh', fresh, age === null ? 'No run has succeeded yet.' : `The last good run was ${age} day(s) ago${fresh ? '' : `, more than config.counties.freshDays (${counties.freshDays})`}.`));

  const recs = Object.values(stored);
  const bad = recs.filter((r) => {
    if (!r?._source || SOURCE_KEYS.some((k) => r._source[k] === undefined || r._source[k] === null || r._source[k] === '')) return true;
    if (Object.keys(r).some((k) => !ALLOWED_KEYS.has(k)) || !DOC_TYPES[r.documentType] || r.sourceId !== source.id) return true;
    try { if (documentId(source.id, r.documentNumber) !== r.id) return true; } catch { return true; }
    if (r.contentHash !== hashDocument(r)) return true;
    try { if (!source.hosts.includes(new URL(r.sources?.[0]?.url).host)) return true; } catch { return true; }
    return !validYmd(documentDate(r).date);
  });
  checks.push(check('county.sourced', !bad.length, `${recs.length - bad.length} of ${recs.length} stored documents carry their source, a known type, a date, a link on the source's own host, an id from their number, a matching content hash and no field outside the record.`, bad.length ? { bad: bad.slice(0, 10).map((r) => r?.id) } : undefined));

  // Recall: the list again, with every page and file it links read afresh (no state, so nothing is left as read before). Every document
  // on it must be stored, with the same content; one stored and no longer listed is history. For a linked-document source, every listed
  // document must be stored, held as unreadable, or history from before its first run (its documents are not fetched again here).
  const may = runnable(source, { allowExample, counties, now });
  if (!may.ok) checks.push(check('county.recall', false, may.reason));
  else {
    try {
      const ua = placeholder(counties.userAgent) ? undefined : counties.userAgent.trim();
      const interval = Math.max(counties.minIntervalMs ?? 0, source.minIntervalMs ?? 0);
      let lastAt = -Infinity;
      const pace = async () => { const wait = lastAt + interval - Date.now(); if (wait > 0) await sleep(wait); lastAt = Date.now(); };
      const live = new Map(), listed = new Map();
      const fetchedAt = now.toISOString();
      const queue = (source.requests({ now, state: st }) ?? []).map((p) => followed(p, 0)), done = new Set();
      let n = 0;
      while (queue.length) {
        const p = queue.shift();
        if (done.has(p.url)) continue;
        done.add(p.url);
        if (!source.hosts.includes(p.u.host)) throw new Error(`${p.u.host} is not one of the source's hosts`);
        if (++n > MAX_REQUESTS) throw new Error(`more than ${MAX_REQUESTS} pages`);
        await pace();
        const http = { fetchImpl, userAgent: ua, sleep, maxBytes: counties.maxBytes };
        let parsed;
        if (p.binary) {
          const got = await getFile(p.url, http);
          if (got.truncated) throw new Error(`${p.u.pathname} was larger than config.counties.maxBytes`);
          parsed = (await source.parseFile(got.bytes, { url: p.url, fetchedAt, kind: p.kind, posted: p.posted, label: p.label, etag: got.etag, lastModified: got.lastModified, pdfToText })) ?? {};
        } else parsed = source.parse((await getText(p.url, {}, http)).text, { url: p.url, fetchedAt, kind: p.kind, state: null, since: null }) ?? {};
        for (const d of parsed.documents ?? []) { const b = buildDocument(d, { source, fetchedAt, runId: 'verify' }); if (b.record) live.set(b.record.id, b.record); }
        for (const it of parsed.items ?? []) { try { listed.set(documentId(source.id, it.documentNumber), it); } catch { /* counted by the run */ } }
        for (const f of parsed.follow ?? []) if (p.depth < MAX_DEPTH) queue.push(followed(f, p.depth + 1));
      }
      if (typeof source.readDocument === 'function') {
        const lf = readJson(loansPaths(dir).list(source.id), { history: [], held: {} });
        const history = new Set(lf.history ?? []);
        const ids = [...listed.keys()];
        const notYet = ids.filter((id) => !stored[id] && !history.has(id) && !lf.held?.[id]);
        const inStore = ids.filter((id) => stored[id]).length, inHeld = ids.filter((id) => lf.held?.[id]).length, inHistory = ids.filter((id) => history.has(id)).length;
        const gone = recs.filter((r) => !listed.has(r.id)).length;
        checks.push(check('county.recall', !notYet.length, notYet.length
          ? `${notYet.length} of ${ids.length} listed document(s) are not stored yet: new since the last run, or left for the next one. Run: outbound loans run --source ${source.id}`
          : `All ${ids.length} listed document(s) are accounted for: ${inStore} stored, ${inHeld} held as unreadable, ${inHistory} history from before the first run.${gone ? ` ${gone} stored document(s) are no longer listed; they stay as history.` : ''}`, notYet.length ? { missing: notYet.slice(0, 10) } : undefined));
      } else {
        const missingHere = [...live.keys()].filter((id) => !stored[id]);
        const differ = [...live.values()].filter((d) => stored[d.id] && stored[d.id].contentHash !== d.contentHash).map((d) => d.id);
        const gone = recs.filter((r) => !live.has(r.id)).length;
        const ok = !missingHere.length && !differ.length;
        checks.push(check('county.recall', ok, ok ? `All ${live.size} document(s) on the list are stored with the same content.${gone ? ` ${gone} stored document(s) are no longer listed; they stay as history.` : ''}`
          : `${missingHere.length} document(s) on the list are not stored; ${differ.length} differ from what is stored. Run: outbound loans run --source ${source.id}`, ok ? undefined : { missing: missingHere.slice(0, 10), differ: differ.slice(0, 10) }));
      }
    } catch (e) { checks.push(check('county.recall', false, `The list could not be read: ${e instanceof HttpError ? `HTTP ${e.status}` : String(e.message).slice(0, 120)}`)); }
  }

  // Every lender-side name is matched to a bank, set aside, or on the review list. One that is none of these is a bug.
  const institutions = readJson(fdicPaths(dir).institutions, {});
  const aliases = loadAliases(dir);
  const reviewKeys = new Set((readJson(loansPaths(dir).review, { entries: [] }).entries ?? []).map((e) => reviewKey(e.name)));
  let matched = 0, aside = 0, onReview = 0;
  const neither = [];
  for (const r of recs) for (const p of r.parties ?? []) {
    if (!LENDER_ROLES.includes(p.role)) continue;
    const m = matchLender(p, { institutions, aliases, documentState: r.state });
    if (m.status === 'matched') matched++;
    else if (m.status === 'set-aside') aside++;
    else if (reviewKeys.has(reviewKey(m.name))) onReview++;
    else neither.push(r.id);
  }
  checks.push(check('county.matched', !neither.length, `${matched + aside + onReview + neither.length} lender, beneficiary or holder name(s): ${matched} matched to a bank in the list, ${aside} set aside (MERS, trustees, servicers, law firms, people), ${onReview} on the review list (outbound loans review).${neither.length ? ` ${neither.length} are none of these: a bug. Run: outbound loans match` : ''}`, neither.length ? { neither: [...new Set(neither)].slice(0, 10) } : undefined));

  // The sample links to where the list shows each document when its own link would name a person.
  const rows = recs.filter((r) => (r.parties ?? []).some((p) => matchLender(p, { institutions, aliases, documentState: r.state }).status === 'matched'))
    .sort((a, b) => (a.id < b.id ? -1 : 1)).slice(0, sample)
    .map((r) => ({ id: r.id, type: r.documentType, recorded: r.dates?.recorded ?? null, date: documentDate(r).date, check: r.sources?.[0]?.listUrl ?? r.sources?.[0]?.url ?? null }));
  return { source: name, checks, sample: rows };
}
