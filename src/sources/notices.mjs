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
//   terms            { robotsCheckedOn, termsCheckedOn, decision, by }: the dated check data-sources section 4 asks for. A source runs
//                    only with decision 'allowed', both dates and who decided; an invented example runs only against its fake
//   example          true for an invented source (src/sources/counties/example.mjs): never run against the network
//   requests({ now, state })        the pages to read this run, [{ url }]; `state` is the source's last run (loans/state.json)
//   parse(text, { url, fetchedAt }) one page to { documents, rows, skipped, missing }: documents in the shape buildDocument
//                    (src/loans.mjs) takes, the rows read, the rows skipped with a reason (a document type we do not keep), and a count
//                    per required field the page lacks. A missing field is a format change: the run fails and writes nothing
// and, outside the module: a fake with invented data for its tests (test/county-notices-fake.mjs for the example), and its live
// check, which is verifyNoticeSource below run against the real host once the source is allowed.
//
// THE RUN. robots.txt first, for every host (a 404 allows everything; any other failure stops the run, since the rules would be
// unknown); a disallowed page stops the run. Every request names the firm (config.counties.userAgent) and keeps at least
// config.counties.minIntervalMs apart, or the host's Crawl-delay if that is longer. Nothing bypasses a block: no login, no CAPTCHA, no
// challenge page, no second address. Each page is parsed and every document built and checked before anything is written; then the
// weekly diff (src/loans.mjs) writes what is new or changed, and the index matches lenders to banks and records the events.
import { readJson, writeJson, safeId } from '../store.mjs';
import { getText, realSleep, HttpError } from './http.mjs';
import { startRun, finishRun, SOURCE_KEYS } from './runlog.mjs';
import { parseRobots, robotsFor, robotsAllows } from './fdicsales.mjs';
import { buildDocument, diffDocuments, writeDiff, buildLoanIndex, loadDocuments, loansPaths, readLoanState, hashDocument, documentId, docNumberKey, DOC_TYPES, RECORD_KEYS, validYmd } from '../loans.mjs';
import { matchLender, reviewKey, LENDER_ROLES } from '../lenders.mjs';
import { loadAliases } from '../candidates.mjs';
import { fdicPaths } from './fdic.mjs';

export const CHANNELS = Object.freeze({ a: 'an official feed under the county\'s agreement', b: 'a free public list meant to be read', c: 'a public search site, after a dated terms read' });
export const CADENCES = Object.freeze({ weekly: 7, 'twice-weekly': 4 });
const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const RUNS_KEPT = 12;

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
  if (e.length) throw new Error(`County source ${spec?.id ?? '(no id)'}: ${e.join('; ')}.`);
  return Object.freeze({ ...spec, example: !!spec.example, hosts: Object.freeze([...spec.hosts]), terms: Object.freeze({ ...spec.terms }) });
}

// Whether a source may run: an example only against its fake; any other only once a principal's dated terms decision allows it.
export function runnable(source, { allowExample = false } = {}) {
  if (source.example) return allowExample ? { ok: true } : { ok: false, reason: `${source.label} is invented. It runs only against its fake, in the tests.` };
  const t = source.terms ?? {};
  if (t.decision !== 'allowed' || !validYmd(t.robotsCheckedOn) || !validYmd(t.termsCheckedOn) || !String(t.by ?? '').trim())
    return { ok: false, reason: `${source.label} has no recorded decision that its robots.txt and terms allow automated reading (terms.decision 'allowed', both dates and who decided). Nothing was read.` };
  return { ok: true };
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
  if (!Array.isArray(c.watch) || c.watch.some((id) => { try { safeId(id); return false; } catch { return true; } })) errors.push('counties.watch must list source ids');
  return errors;
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
const stamp = (runId, at, outcome, counts, error) => ({ runId, ranAt: at, outcome, read: counts.read, added: counts.added, changed: counts.changed, unchanged: counts.unchanged, skipped: counts.skipped, ...(error ? { error } : {}) });
function recordRun(dir, source, entry) {
  const state = readLoanState(dir);
  const prev = state.sources?.[source.id] ?? {};
  const mine = { id: source.id, label: source.label, county: source.county, state: source.state, channel: source.channel, cadence: source.cadence,
    lastRun: entry, lastOk: entry.outcome === 'ok' ? { runId: entry.runId, ranAt: entry.ranAt } : prev.lastOk ?? null, runs: [entry, ...(prev.runs ?? [])].slice(0, RUNS_KEPT) };
  writeJson(loansPaths(dir).state, { ...state, sources: { ...(state.sources ?? {}), [source.id]: mine } });
}

// One run of one source. Returns counts only (no name, no address), as a job result and the run log may carry.
export async function runNoticeSource({ dir, source, counties = {}, fetchImpl = globalThis.fetch, now = new Date(), clock = () => new Date(), sleep = realSleep, nowMs = () => Date.now(), allowExample = false }) {
  const cfgErrors = validateCountyConfig(counties);
  if (cfgErrors.length) throw new Error(`config.json: ${cfgErrors.join('; ')}`);
  const may = runnable(source, { allowExample });
  if (!may.ok) throw new Error(may.reason);
  if (placeholder(counties.userAgent)) throw new Error('config.counties.userAgent is a placeholder. Every request to a county names the firm and a monitored business contact; a principal fills it.');
  const ua = counties.userAgent.trim();
  const run = startRun({ source: `county:${source.id}`, query: { source: source.id }, now });
  const fetchedAt = now.toISOString();
  const notes = [];
  const counts = { requests: 0, pages: 0, rows: 0, read: 0, skipped: 0, added: 0, changed: 0, unchanged: 0, duplicates: 0 };
  let interval = counties.minIntervalMs;
  let last = -Infinity;
  const pace = async () => { const wait = last + interval - nowMs(); if (wait > 0) await sleep(wait); last = nowMs(); };
  const opts = { fetchImpl, userAgent: ua, sleep, retries: 2, timeoutMs: 60000 };
  const fail = (message, extra = {}) => {
    const line = finishRun(dir, run, { rowsRead: counts.rows, outcome: 'failed', errors: [String(message).slice(0, 300)], notes, now: clock(), ...extra });
    recordRun(dir, source, stamp(run.runId, fetchedAt, 'failed', counts, String(message).slice(0, 200)));
    return { runId: run.runId, outcome: 'failed', ...counts, errors: line.errors, ...(extra.missingFields ? { missingFields: extra.missingFields } : {}) };
  };
  try {
    const pages = (source.requests({ now, state: readLoanState(dir).sources?.[source.id] ?? null }) ?? []).map((p) => ({ ...p, u: new URL(p.url) }));
    for (const p of pages) if (!source.hosts.includes(p.u.host)) return fail(`${p.u.host} is not one of the source's hosts; nothing was read.`);
    // 1. robots.txt, once per host.
    const robots = new Map();
    for (const p of pages) {
      if (robots.has(p.u.host)) continue;
      await pace(); counts.requests++;
      try {
        const r = robotsFor(parseRobots((await getText(`${p.u.protocol}//${p.u.host}/robots.txt`, {}, { ...opts, maxBytes: 500_000 })).text), ua);
        robots.set(p.u.host, r);
        if (r.crawlDelay) interval = Math.max(interval, r.crawlDelay * 1000);
      } catch (e) {
        if (!(e instanceof HttpError && e.status === 404)) throw e;
        robots.set(p.u.host, { rules: [], crawlDelay: null });
        notes.push(`${p.u.host}/robots.txt: none (404), so every path is allowed`);
      }
    }
    for (const p of pages) if (!robotsAllows(robots.get(p.u.host), `${p.u.pathname}${p.u.search}`)) return fail(`robots.txt on ${p.u.host} disallows ${p.u.pathname}; nothing was read.`);

    // 2. The pages, parsed, and every document built and checked before anything is written.
    const docs = [], missing = {}, problems = [];
    for (const p of pages) {
      await pace(); counts.requests++;
      const got = await getText(p.url, {}, { ...opts, maxBytes: counties.maxBytes });
      if (got.truncated) return fail(`${p.u.pathname} was larger than config.counties.maxBytes; nothing was written.`);
      counts.pages++;
      const parsed = source.parse(got.text, { url: p.url, fetchedAt }) ?? {};
      counts.rows += parsed.rows ?? 0;
      counts.skipped += (parsed.skipped ?? []).length;
      for (const [f, n] of Object.entries(parsed.missing ?? {})) missing[f] = (missing[f] ?? 0) + n;
      for (const d of parsed.documents ?? []) {
        const b = buildDocument(d, { source, fetchedAt, runId: run.runId });
        if (b.record) docs.push(b.record); else problems.push(`document ${docNumberKey(d?.documentNumber) || '(no number)'}: ${b.errors[0]}`);
      }
    }
    const gaps = Object.keys(missing).sort();
    if (gaps.length) return fail(`The list lacks field(s): ${gaps.map((f) => `${f} (${missing[f]})`).join(', ')}. Its format may have changed; nothing was written.`, { missingFields: gaps });
    if (problems.length) return fail(`${problems.length} document(s) could not be read, so nothing was written. First: ${problems[0]}`);
    if (counts.skipped) notes.push(`${counts.skipped} row(s) skipped: a document type the pipeline does not keep`);

    // 3. The weekly diff, then the index (lender match, bank files, review list, events).
    const diff = diffDocuments(loadDocuments(dir, source.id), docs, { now, runId: run.runId });
    Object.assign(counts, { read: docs.length, added: diff.added.length, changed: diff.changed.length, unchanged: diff.unchanged.length, duplicates: diff.duplicates });
    writeDiff(dir, source.id, diff, { runId: run.runId, now });
    const index = buildLoanIndex({ dir, now, runId: run.runId });
    notes.push(`${counts.read} document(s) read: ${counts.added} new, ${counts.changed} changed, ${counts.unchanged} unchanged; ${index.eventsNew} new event(s) for banks in the list`);
    const line = finishRun(dir, run, { rowsRead: counts.rows, rowsWritten: counts.added, rowsChanged: counts.changed, outcome: 'ok', notes, now: clock() });
    recordRun(dir, source, stamp(run.runId, fetchedAt, line.outcome, counts));
    return { runId: run.runId, outcome: line.outcome, ...counts, index };
  } catch (e) {
    return fail(e.message);
  }
}

// ---- The verify check (PRD E2-S6), read-only --------------------------------------------------------------------------------------
const check = (id, ok, summary, detail) => ({ id, ok: !!ok, summary, ...(detail ? { detail } : {}) });
const ALLOWED_KEYS = new Set(RECORD_KEYS);

// Fresh, sourced, complete against the live list, and every lender name accounted for. Writes nothing.
export async function verifyNoticeSource({ dir, source, counties = {}, fetchImpl = globalThis.fetch, sleep = realSleep, now = new Date(), sample = 5, allowExample = false }) {
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
    return !validYmd(r.dates?.filed ?? r.dates?.recorded);
  });
  checks.push(check('county.sourced', !bad.length, `${recs.length - bad.length} of ${recs.length} stored documents carry their source, a known type, a date, a link on the source's own host, an id from their number, a matching content hash and no field outside the record.`, bad.length ? { bad: bad.slice(0, 10).map((r) => r?.id) } : undefined));

  // Recall: the list again. Every document on it must be stored, with the same content; one stored and no longer listed is history.
  const may = runnable(source, { allowExample });
  if (!may.ok) checks.push(check('county.recall', false, may.reason));
  else {
    try {
      const ua = placeholder(counties.userAgent) ? undefined : counties.userAgent.trim();
      let lastAt = -Infinity;
      const pace = async () => { const wait = lastAt + (counties.minIntervalMs ?? 0) - Date.now(); if (wait > 0) await sleep(wait); lastAt = Date.now(); };
      const live = new Map();
      for (const p of source.requests({ now, state: st }) ?? []) {
        if (!source.hosts.includes(new URL(p.url).host)) throw new Error(`${new URL(p.url).host} is not one of the source's hosts`);
        await pace();
        const parsed = source.parse((await getText(p.url, {}, { fetchImpl, userAgent: ua, sleep, maxBytes: counties.maxBytes })).text, { url: p.url, fetchedAt: now.toISOString() }) ?? {};
        for (const d of parsed.documents ?? []) { const b = buildDocument(d, { source, fetchedAt: now.toISOString(), runId: 'verify' }); if (b.record) live.set(b.record.id, b.record); }
      }
      const missingHere = [...live.keys()].filter((id) => !stored[id]);
      const differ = [...live.values()].filter((d) => stored[d.id] && stored[d.id].contentHash !== d.contentHash).map((d) => d.id);
      const gone = recs.filter((r) => !live.has(r.id)).length;
      const ok = !missingHere.length && !differ.length;
      checks.push(check('county.recall', ok, ok ? `All ${live.size} document(s) on the list are stored with the same content.${gone ? ` ${gone} stored document(s) are no longer listed; they stay as history.` : ''}`
        : `${missingHere.length} document(s) on the list are not stored; ${differ.length} differ from what is stored. Run: outbound loans run --source ${source.id}`, ok ? undefined : { missing: missingHere.slice(0, 10), differ: differ.slice(0, 10) }));
    } catch (e) { checks.push(check('county.recall', false, `The list could not be read: ${String(e.message).slice(0, 120)}`)); }
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
  checks.push(check('county.matched', !neither.length, `${matched + aside + onReview + neither.length} lender, beneficiary or holder name(s): ${matched} matched to a bank in the list, ${aside} set aside (MERS, trustees, servicers, law firms), ${onReview} on the review list (outbound loans review).${neither.length ? ` ${neither.length} are none of these: a bug. Run: outbound loans match` : ''}`, neither.length ? { neither: [...new Set(neither)].slice(0, 10) } : undefined));

  const rows = recs.filter((r) => (r.parties ?? []).some((p) => matchLender(p, { institutions, aliases, documentState: r.state }).status === 'matched'))
    .sort((a, b) => (a.id < b.id ? -1 : 1)).slice(0, sample).map((r) => ({ id: r.id, type: r.documentType, recorded: r.dates.recorded, check: r.sources?.[0]?.url ?? null }));
  return { source: name, checks, sample: rows };
}
