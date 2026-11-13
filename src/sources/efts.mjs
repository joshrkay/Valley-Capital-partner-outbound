// EDGAR full-text search, the client for the SEC filings listener (PRD E13-S1). The endpoint is undocumented. Everything below was
// confirmed live, read-only, on 2026-11-13, at most one request a second:
//
// The request: GET https://efts.sec.gov/LATEST/search-index with
//   q             Phrases in double quotes. Phrases separated by spaces must ALL appear: each becomes a `must` match_phrase.
//                 `OR` between phrases makes them alternatives (`should`). A bare `AND` is not an operator: it is searched for as
//                 the word "and". There is no proximity operator, so "near" can only mean "in the same document". This client
//                 sends AND-only queries, which the response's echo can confirm exactly.
//   forms         A comma list, matched on the root form, so 8-K also returns 8-K/A.
//   dateRange=custom, startdt, enddt   An inclusive file-date range, YYYY-MM-DD.
//   ciks          A comma list of 10-digit, zero-padded CIKs. An UNPADDED CIK silently matches nothing (HTTP 200, zero hits).
//                 100 CIKs in one request worked; this client sends at most 50.
//   locationCodes A comma list of states: the filer's business address (`biz_states`). With locationType=incorporated, the
//                 state of incorporation instead.
//   sics          A comma list of SIC codes.
//   items         8-K item numbers. The server honors it, but the cache below ignores it, so this client NEVER sends it.
//   from          The offset. A page holds 100 hits, and from + 100 may not pass 10,000.
//
// The response: Elasticsearch's own shape, { took, timed_out, _shards, hits: { total: { value, relation }, max_score, hits },
//   aggregations, query }. `query` echoes the search the server ran, which is how a response is matched to its request.
//   - Each hit is ONE DOCUMENT of a filing (the main document or an exhibit). So one filing (accession, `adsh`) can come back
//     several times. Without q, the server adds a filter on sequence 1, so only main documents come back.
//   - `_id` is "<accession>:<file name>".
//   - `_source` carries: ciks, display_names, form, root_forms, file_date, period_ending, biz_states, inc_states, sics, file_type,
//     sequence (a number on some documents, a string on others), and more.
//   - `items` holds the 8-K item numbers ("2.06", "9.01") on every document of an 8-K, and [] on other forms.
//   - The text itself (doc_text) is excluded by the server, and no snippet is returned.
//
// Errors: an error comes back as HTTP 200 with { errorType, errorMessage }. Seen: paging past 10,000, which is the query's fault;
//   and, during a live run, a failed lookup of the server's own search cluster ("getaddrinfo EBUSY ..."), which is not. A failure
//   also comes back as HTTP 500 with { message: "Internal server error" }: seen twice, and gone on retry. So every body is
//   checked; an error body other than the 10,000 limit is retried twice after a pause, and 5xx is retried (src/sources/http.mjs).
//
// The cache: responses come through a CDN. It caches for up to about a minute, keyed on q, forms, the dates, ciks, locationCodes
//   and from. Parameter order does not matter. It does NOT key on items or sics. Seen: a request for SIC 6021 got the cached
//   answer for 6022, and a request without items got another request's items-filtered answer. So:
//   - items are never sent: 8-K items are matched on the hits;
//   - every response's echoed query is compared with the request;
//   - every hit is filtered again on the fields it carries;
//   - a response that does not match is retried once, after the cache has had time to expire.
//
// The entity lookup: ?keysTyped=<text> returns up to 10 SEC entities whose name has every word typed, or whose CIK is the text
//   (padded or not): hits [{ _id: "<unpadded CIK>", _source: { entity: "NAME (TICKER)", entity_words, tickers, rank } }].
import { getJson, pacer, realSleep } from './http.mjs';

export const EFTS = 'https://efts.sec.gov/LATEST/search-index';
export const PAGE = 100;
export const RESULT_WINDOW = 10000;
export const MAX_CIKS = 50;
// The hit fields this listener uses. Every hit must carry every one as a key (PRD E2-S2), or the run fails and writes nothing.
export const HIT_FIELDS = Object.freeze(['adsh', 'ciks', 'display_names', 'form', 'root_forms', 'file_date', 'biz_states', 'sics', 'items', 'file_type', 'sequence']);

export class EftsError extends Error {
  constructor(message, { kind, detail } = {}) { super(message); this.name = 'EftsError'; this.kind = kind; this.detail = detail; }
}

export function padCik(c) {
  const s = String(c ?? '').trim();
  if (!/^\d{1,10}$/.test(s)) throw new Error(`Not a CIK: "${c}". A CIK is 1 to 10 digits.`);
  return s.padStart(10, '0');
}

// A phrase is plain words: no quotes or brackets, so it can never change the query's structure.
const PHRASE = /^[A-Za-z0-9](?:[A-Za-z0-9 ,.'&/-]*[A-Za-z0-9])?$/;
export const validPhrase = (p) => typeof p === 'string' && PHRASE.test(p) && !/\s{2,}/.test(p);
export const queryText = (phrases) => phrases.map((p) => `"${p}"`).join(' ');

export const ymd = (d) => d.toISOString().slice(0, 10);
export const addDays = (s, n) => ymd(new Date(Date.parse(`${s}T00:00:00Z`) + n * 86400000));
export const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

// The query string for one page. `from` is left out on the first page, as the site's own search sends it.
export function searchParams({ phrases = [], forms, ciks = [], startdt, enddt, states = [], sics = [], from = 0 }) {
  return {
    ...(phrases.length ? { q: queryText(phrases) } : {}),
    forms: forms.join(','), dateRange: 'custom', startdt, enddt,
    ...(ciks.length ? { ciks: ciks.join(',') } : {}),
    ...(states.length ? { locationCodes: states.join(',') } : {}),
    ...(sics.length ? { sics: sics.join(',') } : {}),
    ...(from ? { from } : {}),
  };
}

// An error body (HTTP 200), a failure body, or a shape this client does not understand: all throw, with the server's reason.
export function checkBody(body) {
  if (body && typeof body === 'object' && (body.errorType || body.errorMessage)) {
    const msg = String(body.errorMessage ?? body.errorType);
    throw new EftsError(`EDGAR full-text search answered with an error: ${msg.slice(0, 200)}`, { kind: /result window is too large/i.test(msg) ? 'window' : 'error' });
  }
  if (body && typeof body === 'object' && body.message && !body.hits) throw new EftsError(`EDGAR full-text search failed: ${String(body.message).slice(0, 200)}`, { kind: 'failed' });
  if (!body?.hits || !Array.isArray(body.hits.hits) || typeof body.hits.total?.value !== 'number') throw new EftsError('Unexpected response shape from EDGAR full-text search.', { kind: 'shape' });
  return body;
}

const sorted = (a) => [...(a ?? [])].map(String).sort();
const same = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));

// Compares the server's echo of the search it ran with what was asked. Returns { missing } when there is no echo to compare, or
// { problems: [...] }, empty when they agree. A filter the request did not ask for (items, sics, inc_states) means the cache served
// another request's answer.
export function echoProblems(body, asked) {
  const q = body?.query;
  const bool = q?.query?.bool;
  if (!bool || !Array.isArray(bool.filter) || !Array.isArray(bool.must)) return { missing: true, problems: [] };
  const problems = [];
  const must = bool.must.map((m) => m?.match_phrase?.doc_text);
  if (must.some((x) => typeof x !== 'string') || !same(must, asked.phrases ?? [])) problems.push(`phrases ${JSON.stringify(must)}`);
  if ((bool.should ?? []).length) problems.push('alternatives (should) present');
  const terms = {};
  let range = null;
  for (const f of bool.filter) {
    if (f?.terms) Object.assign(terms, f.terms);
    else if (f?.range?.file_date) range = f.range.file_date;
    else if (f?.term?.sequence !== undefined) { if ((asked.phrases ?? []).length) problems.push('a main-documents-only filter on a phrase search'); }
    else problems.push(`unexpected filter ${JSON.stringify(f).slice(0, 80)}`);
  }
  const want = { root_forms: asked.forms, ciks: asked.ciks, biz_states: asked.states, sics: asked.sics };
  for (const [k, v] of Object.entries(want)) if (!same(terms[k], v ?? [])) problems.push(`${k} ${JSON.stringify(terms[k] ?? [])}`);
  for (const k of Object.keys(terms)) if (!(k in want)) problems.push(`a filter on ${k} that was not asked for`);
  if (range?.gte !== asked.startdt || range?.lte !== asked.enddt) problems.push(`dates ${JSON.stringify(range)}`);
  if (Number(q.from ?? 0) !== Number(asked.from ?? 0)) problems.push(`from ${q.from}`);
  return { missing: false, problems };
}

const arr = (v) => (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v]);
const cik10 = (c) => { try { return padCik(c); } catch { return String(c); } };

// One hit, reduced to the fields the listener keeps. An allowlist: text, snippets and highlights are never copied, even if the
// server one day sends them.
export function normalizeHit(h) {
  const s = h?._source ?? {};
  const id = String(h?._id ?? '');
  return {
    accession: String(s.adsh ?? id.split(':')[0]), document: id.includes(':') ? id.slice(id.indexOf(':') + 1) : null, fileType: s.file_type ?? null,
    form: s.form ?? null, rootForms: arr(s.root_forms).map(String), fileDate: s.file_date ?? null, periodEnding: s.period_ending ?? null,
    ciks: arr(s.ciks).map(cik10), names: arr(s.display_names).map(String), bizStates: arr(s.biz_states).map(String), incStates: arr(s.inc_states).map(String),
    sics: arr(s.sics).map(String), items: arr(s.items).map(String), sequence: s.sequence === undefined || s.sequence === null ? null : String(s.sequence),
  };
}

// Field check: how many hits lack each used field as a key, and how many carry it as an explicit null.
export function checkHitFields(hits) {
  const missing = {}, nulls = {};
  for (const h of hits) {
    if (!h || typeof h._id !== 'string') missing._id = (missing._id ?? 0) + 1;
    const s = h?._source ?? {};
    for (const f of HIT_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(s, f)) missing[f] = (missing[f] ?? 0) + 1;
      else if (s[f] === null) nulls[f] = (nulls[f] ?? 0) + 1;
    }
  }
  return { missing, nulls };
}

// Does a hit belong to the request? The server already filtered it; this repeats each filter on the hit's own fields, so a cached
// answer to another query cannot slip through.
export function hitMatches(h, asked) {
  if (!h.rootForms.some((f) => asked.forms.includes(f))) return false;
  if (asked.ciks?.length && !h.ciks.some((c) => asked.ciks.includes(c))) return false;
  if (!h.fileDate || h.fileDate < asked.startdt || h.fileDate > asked.enddt) return false;
  if (asked.states?.length && !h.bizStates.some((s) => asked.states.includes(s))) return false;
  if (asked.sics?.length && !h.sics.some((s) => asked.sics.includes(s))) return false;
  return true;
}

// A client bound to the SEC's rules: the declared User-Agent from config (never a placeholder), the pacing and the retries.
export function eftsClient({ sec, fetchImpl = globalThis.fetch, sleep = realSleep }) {
  const ua = String(sec?.userAgent ?? '');
  if (!ua || /\[confirm/i.test(ua)) throw new Error('config.json sec.userAgent is a placeholder. The SEC asks automated clients to name themselves with a contact; a principal fills it (PRD Q11).');
  const pace = pacer(sec.minIntervalMs ?? 150, { sleep });
  const opts = { fetchImpl, userAgent: ua, sleep, retries: 3, timeoutMs: 60000 };
  let requests = 0;
  const get = async (params) => { await pace(); requests++; return getJson(EFTS, params, opts); };
  return {
    get,
    // A checked body. An error body other than the 10,000 limit may be the server's own trouble (seen live), so it is asked again,
    // twice, after a pause. The limit is the query's fault and is never retried.
    getChecked: async (params, { waits = sec.errorWaitsMs ?? [2000, 8000] } = {}) => {
      for (let attempt = 0; ; attempt++) {
        try { return checkBody(await get(params)); } catch (e) {
          if (!(e instanceof EftsError) || !['error', 'failed'].includes(e.kind) || attempt >= waits.length) throw e;
          await sleep(waits[attempt]);
        }
      }
    },
    requests: () => requests,
    sleep,
  };
}

// One search, every page. A window with more hits than the server will page through is split in half, down to a single day.
// Returns { hits (normalized, filtered), read, pages, short, echoMissing, retried, dropped, missing, nulls, windows }.
export async function search({ client, cacheWaitMs = 65000, phrases = [], forms, ciks = [], startdt, enddt, states = [], sics = [] }) {
  const base = { phrases, forms, ciks, states, sics };
  const out = { hits: [], read: 0, pages: 0, short: false, echoMissing: 0, retried: 0, dropped: 0, missing: {}, nulls: {}, windows: [] };
  const page = async (asked) => {
    for (let attempt = 0; ; attempt++) {
      const body = await client.getChecked(searchParams(asked));
      const echo = echoProblems(body, asked);
      if (echo.missing) { out.echoMissing++; return body; }
      if (!echo.problems.length) return body;
      if (attempt >= 1) throw new EftsError(`The response does not match the request, even after waiting for the cache: ${echo.problems.join('; ')}.`, { kind: 'mismatch', detail: echo.problems });
      out.retried++;
      await client.sleep(cacheWaitMs);
    }
  };
  const window = async (s, e) => {
    let total = null, read = 0;
    for (let from = 0; ; ) {
      const asked = { ...base, startdt: s, enddt: e, from };
      let body;
      try { body = await page(asked); } catch (err) {
        if (err.kind !== 'window' || s === e) throw err;
        total = RESULT_WINDOW;   // paged too far: treat as too broad and split
        break;
      }
      if (total === null) total = body.hits.total.value >= RESULT_WINDOW || body.hits.total.relation !== 'eq' ? RESULT_WINDOW : body.hits.total.value;
      if (total >= RESULT_WINDOW) break;
      const raw = body.hits.hits;
      out.pages++; out.read += raw.length; read += raw.length;
      const f = checkHitFields(raw);
      for (const [k, n] of Object.entries(f.missing)) out.missing[k] = (out.missing[k] ?? 0) + n;
      for (const [k, n] of Object.entries(f.nulls)) out.nulls[k] = (out.nulls[k] ?? 0) + n;
      for (const h of raw.map(normalizeHit)) { if (hitMatches(h, asked)) out.hits.push(h); else out.dropped++; }
      // The next offset is what actually arrived, so a smaller page than 100 skips nothing.
      from += raw.length;
      if (!raw.length || read >= total || from + Number(body.query?.size ?? PAGE) > RESULT_WINDOW) break;
    }
    if (total >= RESULT_WINDOW) {
      if (s === e) throw new EftsError(`More than ${RESULT_WINDOW} hits on ${s} alone; narrow the search.`, { kind: 'broad' });
      const mid = addDays(s, Math.floor(daysBetween(s, e) / 2));
      await window(s, mid);
      await window(addDays(mid, 1), e);
      return;
    }
    if (read < total) out.short = true;
    out.windows.push({ startdt: s, enddt: e, total, read });
  };
  await window(startdt, enddt);
  return out;
}

// SEC entities matching a name, or the one entity with a given CIK.
export async function lookupEntities({ client, text }) {
  const body = await client.getChecked({ keysTyped: String(text) });
  return body.hits.hits.filter((h) => /^\d{1,10}$/.test(String(h?._id ?? ''))).map((h) => {
    const entity = String(h._source?.entity ?? '');
    return { cik: padCik(h._id), entity, name: entity.replace(/\s*\([^()]*\)\s*$/, '').trim() || entity, tickers: h._source?.tickers ?? null };
  });
}
