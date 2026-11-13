// The SEC filings listener (PRD E13-S1): a daily watch of banks' SEC filings for signs they are selling CRE loans. It runs the saved
// searches in filings.json on EDGAR full-text search (src/sources/efts.mjs) for every filer a principal has confirmed for a bank
// (src/sources/filers.mjs), and keeps three things in the data folder:
//   - sources/edgar/filings.json: every hit on a mapped filer, one record per filing (accession). These are EVENT signals
//     (docs/data-sources.md, section 1): a dated change, recorded once and kept. A later run never drops one.
//   - sources/edgar/proxies.json: the confirmed filers' proxy statements (DEF 14A): form, date and link only, for the briefer. No
//     names are extracted; people fall under the contact rules (PRD E7).
//   - sources/edgar/discovery.json: hits of the discovery search, by state and bank SIC code, on filers NOT mapped to any bank.
//     A for-review list for a principal. These never become signals.
// The full-text search returns no filing text or snippets, and nothing here stores any: every record holds a form, dates, item
// numbers, ids and links. Even so, filings are context for a principal only and never reach the drafter (test/filings-handoff).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from '../paths.mjs';
import { readJson, writeJson } from '../store.mjs';
import { realSleep } from './http.mjs';
import { startRun, finishRun, sourceBlock, upsertWithChanges, SOURCE_KEYS } from './runlog.mjs';
import { EFTS, eftsClient, search, lookupEntities, validPhrase, addDays, daysBetween, ymd, padCik } from './efts.mjs';
import { loadFilers, confirmedCiks } from './filers.mjs';

export const SEC_ARCHIVES = 'https://www.sec.gov/Archives/edgar/data';
export const indexUrl = (cik, accession) => `${SEC_ARCHIVES}/${Number(cik)}/${String(accession).replace(/-/g, '')}/${accession}-index.htm`;
const ACCESSION = /^\d{10}-\d{2}-\d{6}$/;

export const filingsPaths = (dir) => {
  const base = join(dir, 'sources', 'edgar');
  return { filings: join(base, 'filings.json'), proxies: join(base, 'proxies.json'), discovery: join(base, 'discovery.json'), state: join(base, 'filings-state.json') };
};

// ---- The rules file ------------------------------------------------------------------------------------------------------------
export function validateFilingRules(r) {
  const errors = [];
  const posInt = (v, k, max = Infinity) => { if (!Number.isInteger(v) || v < 0 || v > max) errors.push(`${k} must be a whole number from 0 to ${max}`); };
  posInt(r?.lookbackDays, 'lookbackDays', 3660); posInt(r?.overlapDays, 'overlapDays', 60); posInt(r?.backfillDays, 'backfillDays', 3660);
  posInt(r?.cacheWaitMs, 'cacheWaitMs', 600000);
  if (!Number.isInteger(r?.maxCiksPerRequest) || r.maxCiksPerRequest < 1 || r.maxCiksPerRequest > 100) errors.push('maxCiksPerRequest must be 1 to 100');
  const searches = Array.isArray(r?.searches) ? r.searches : [];
  if (!searches.length) errors.push('searches: at least one');
  const ids = new Set();
  const FORM = /^[A-Z0-9][A-Z0-9 /-]{0,15}$/;
  for (const s of searches) {
    const id = s?.id;
    if (!/^[a-z0-9][a-z0-9-]{1,47}$/.test(String(id ?? ''))) { errors.push(`search id "${id}": lowercase letters, digits and hyphens`); continue; }
    if (ids.has(id)) errors.push(`search id "${id}" is used twice`);
    ids.add(id);
    if (typeof s.label !== 'string' || !s.label.trim()) errors.push(`${id}: a label`);
    if (!Array.isArray(s.forms) || !s.forms.length || s.forms.some((f) => !FORM.test(String(f)))) errors.push(`${id}: forms, such as ["8-K"]`);
    const phrases = s.phrases ?? [], items = s.items ?? [];
    if (!Array.isArray(phrases) || phrases.some((p) => !validPhrase(p))) errors.push(`${id}: each phrase is plain words, with no quotes`);
    if (!Array.isArray(items) || items.some((i) => !/^\d\.\d{2}$/.test(String(i)))) errors.push(`${id}: items are 8-K item numbers, such as "2.06"`);
    if (items.length && !(s.forms ?? []).every((f) => f === '8-K')) errors.push(`${id}: items apply to 8-K searches only`);
    if (!phrases.length && !items.length) errors.push(`${id}: needs phrases or items, or it would return every filing`);
  }
  const d = r?.discovery;
  if (!d || !Array.isArray(d.states) || !d.states.length || d.states.some((x) => !/^[A-Z]{2}$/.test(String(x)))) errors.push('discovery.states: two-letter state codes');
  if (!Array.isArray(d?.sics) || !d.sics.length || d.sics.some((x) => !/^\d{4}$/.test(String(x)))) errors.push('discovery.sics: four-digit SIC codes');
  for (const id of d?.searches ?? []) if (!ids.has(id)) errors.push(`discovery.searches: no search "${id}"`);
  if (!Array.isArray(r?.proxies?.forms) || !r.proxies.forms.length || r.proxies.forms.some((f) => !FORM.test(String(f)))) errors.push('proxies.forms, such as ["DEF 14A"]');
  posInt(r?.proxies?.lookbackDays, 'proxies.lookbackDays', 3660);
  return errors;
}

export function loadFilingRules(root = REPO) {
  const r = JSON.parse(readFileSync(join(root, 'filings.json'), 'utf8'));
  const errors = validateFilingRules(r);
  if (errors.length) throw new Error(`filings.json: ${errors.join('; ')}`);
  return r;
}

const chunks = (a, n) => { const out = []; for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out; };
const uniq = (a) => [...new Set(a)].sort();

// ---- The run -------------------------------------------------------------------------------------------------------------------
// `since` (YYYY-MM-DD) searches every confirmed filer from that date. Without it, a run starts `overlapDays` before the last run
// ended (the index can lag a filing by a day or more), or `lookbackDays` back on a first run; a filer never searched before is
// searched `backfillDays` back, so a new mapping brings its recent history. Any failed search fails the whole run, writes nothing
// but the run-log line, and leaves the window where it was, so the next run covers it again.
export async function runFilings({ dir, sec, rules = loadFilingRules(), fetchImpl = globalThis.fetch, now = new Date(), clock = () => new Date(), sleep = realSleep, since }) {
  const client = eftsClient({ sec, fetchImpl, sleep });   // refuses a placeholder User-Agent, as the CMBS run does
  const ruleErrors = validateFilingRules(rules);
  if (ruleErrors.length) throw new Error(`filings.json: ${ruleErrors.join('; ')}`);
  const today = ymd(now);
  if (since !== undefined && since !== null && since !== true) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(since)) || Number.isNaN(Date.parse(`${since}T00:00:00Z`))) throw new Error('--since must be a date: YYYY-MM-DD.');
    if (since > today) throw new Error(`--since ${since} is after today (${today}).`);
  } else since = null;

  const p = filingsPaths(dir);
  const state = readJson(p.state, {});
  const byCik = confirmedCiks(loadFilers(dir));
  const ciks = [...byCik.keys()].sort();
  const start = since ?? (state.window?.end ? addDays(state.window.end, -rules.overlapDays) : addDays(today, -rules.lookbackDays));
  const searchedFrom = { ...(state.searchedFrom ?? {}) };
  const backfill = addDays(today, -rules.backfillDays);
  const groups = (since
    ? [{ startdt: since, ciks }]
    : [{ startdt: start, ciks: ciks.filter((c) => searchedFrom[c]) }, { startdt: backfill < start ? backfill : start, ciks: ciks.filter((c) => !searchedFrom[c]), backfill: true }]
  ).filter((g) => g.ciks.length);
  const searchById = Object.fromEntries(rules.searches.map((s) => [s.id, s]));
  const run = startRun({ source: 'filings', query: { searches: Object.keys(searchById).sort(), discovery: { states: rules.discovery.states, sics: rules.discovery.sics, searches: rules.discovery.searches }, proxies: rules.proxies.forms }, now });
  const fetchedAt = now.toISOString();
  const notes = [`window ${start} to ${today}`];
  const counts = { filers: ciks.length, newFilers: groups.find((g) => g.backfill)?.ciks.length ?? 0, requests: 0, searches: 0, hitsRead: 0, retried: 0, dropped: 0, filings: 0, filingsNew: 0, proxies: 0, proxiesNew: 0, discovered: 0, discoveredNew: 0 };
  const missing = {}, nullCounts = {};
  let suspect = false, echoMissing = 0, short = 0;
  const log = [];

  // Identical requests (the two 8-K item searches send the same one) are fetched once.
  const memo = new Map();
  const fetchOnce = async (asked) => {
    const k = JSON.stringify(asked);
    if (!memo.has(k)) {
      const res = await search({ client, cacheWaitMs: rules.cacheWaitMs, ...asked });
      counts.searches++; counts.hitsRead += res.read; counts.retried += res.retried; counts.dropped += res.dropped; echoMissing += res.echoMissing; if (res.short) short++;
      for (const [f, n] of Object.entries(res.missing)) missing[f] = (missing[f] ?? 0) + n;
      for (const [f, n] of Object.entries(res.nulls)) nullCounts[f] = (nullCounts[f] ?? 0) + n;
      memo.set(k, res);
    }
    return memo.get(k);
  };
  const itemsOk = (s, h) => !(s.items ?? []).length || h.items.some((i) => s.items.includes(i));

  try {
    // 1. Production: every saved search, for every confirmed filer.
    const found = new Map();   // accession -> { hits, searches, ciks, windows }
    for (const s of rules.searches) for (const g of groups) for (const part of chunks(g.ciks, rules.maxCiksPerRequest)) {
      const asked = { phrases: s.phrases ?? [], forms: s.forms, ciks: part, startdt: g.startdt, enddt: today };
      const res = await fetchOnce(asked);
      const kept = res.hits.filter((h) => itemsOk(s, h));
      log.push({ kind: 'production', search: s.id, startdt: g.startdt, enddt: today, ciks: part.length, hits: kept.length });
      for (const h of kept) {
        const f = found.get(h.accession) ?? { hits: [], searches: new Set(), ciks: new Set(), query: { search: s.id, startdt: g.startdt, enddt: today } };
        f.hits.push(h); f.searches.add(s.id);
        for (const c of h.ciks) if (part.includes(c)) f.ciks.add(c);
        found.set(h.accession, f);
      }
    }

    // 2. Discovery: the same searches by state and bank SIC code, kept only for filers mapped to no bank.
    const seen = new Map();
    for (const id of rules.discovery.searches) {
      const s = searchById[id];
      const asked = { phrases: s.phrases ?? [], forms: s.forms, states: rules.discovery.states, sics: rules.discovery.sics, startdt: start, enddt: today };
      const res = await fetchOnce(asked);
      let kept = 0;
      for (const h of res.hits) {
        if (!itemsOk(s, h) || h.ciks.some((c) => byCik.has(c))) continue;
        const f = seen.get(h.accession) ?? { hits: [], searches: new Set(), query: { search: id, startdt: start, enddt: today } };
        f.hits.push(h); f.searches.add(id); seen.set(h.accession, f); kept++;
      }
      log.push({ kind: 'discovery', search: id, startdt: start, enddt: today, hits: kept });
    }

    // 3. Proxy statements of confirmed filers.
    const proxyHits = new Map();
    const proxyStart = addDays(today, -rules.proxies.lookbackDays);
    for (const part of chunks(ciks, rules.maxCiksPerRequest)) {
      const res = await fetchOnce({ phrases: [], forms: rules.proxies.forms, ciks: part, startdt: proxyStart, enddt: today });
      log.push({ kind: 'proxies', startdt: proxyStart, enddt: today, ciks: part.length, hits: res.hits.length });
      for (const h of res.hits) { const f = proxyHits.get(h.accession) ?? { hits: [], ciks: new Set() }; f.hits.push(h); for (const c of h.ciks) if (part.includes(c)) f.ciks.add(c); proxyHits.set(h.accession, f); }
    }
    counts.requests = client.requests();

    // 4. The field check, before anything is written.
    if (Object.keys(missing).length) {
      const names = Object.keys(missing).sort();
      const line = finishRun(dir, run, { rowsRead: counts.hitsRead, outcome: 'failed', missingFields: names, errors: [`EDGAR full-text search did not return field(s): ${names.map((f) => `${f} (absent from ${missing[f]} hits)`).join(', ')}. The response may have changed; nothing was written.`], notes, nullCounts, now: clock() });
      return { runId: run.runId, outcome: line.outcome, ...counts, missingFields: names, errors: line.errors };
    }

    // 5. Records, merged into what is stored. Events are kept: a search that matched before stays on the record.
    const main = (hits) => hits.find((h) => h.sequence === '1') ?? hits[0];
    const docs = (hits) => uniq(hits.filter((h) => h.document).map((h) => `${h.document}|${h.fileType ?? ''}`)).map((x) => { const [name, type] = x.split('|'); return { name, type: type || null }; });
    const src = (acc, m, query) => sourceBlock({ source: 'filings', endpoint: EFTS, query, recordId: acc, period: m.fileDate, fetchedAt, runId: run.runId });
    const base = (acc, x, cik) => {
      const m = main(x.hits);
      return { key: `sec:${acc}`, accession: acc, form: m.form, rootForm: m.rootForms[0] ?? m.form, fileDate: m.fileDate, periodEnding: m.periodEnding,
        filerCiks: uniq(x.hits.flatMap((h) => h.ciks)), filerNames: uniq(x.hits.flatMap((h) => h.names)), items: uniq(m.items), cik, link: indexUrl(cik, acc), documents: docs(x.hits) };
    };
    let changed = 0;
    const merge = (path, built, kindCount) => {
      const prev = readJson(path, {});
      const next = { ...prev };
      for (const [acc, rec] of built) {
        const old = prev[acc];
        const keep = old ? {
          ...(rec.searches ? { searches: uniq([...(old.searches ?? []), ...rec.searches]) } : {}),
          documents: [...new Map([...(old.documents ?? []), ...rec.documents].map((d) => [d.name, d])).values()].sort((a, b) => (a.name < b.name ? -1 : 1)),
          firstSeenAt: old.firstSeenAt, firstRunId: old.firstRunId,
        } : { firstSeenAt: fetchedAt, firstRunId: run.runId };
        const u = upsertWithChanges(old, { ...rec, ...keep }, { key: rec.key, runId: run.runId, dir, now });
        next[acc] = u.record; changed += u.changed;
        if (!old) counts[`${kindCount}New`]++;
      }
      counts[kindCount] = Object.keys(next).length;
      return next;
    };
    const filings = merge(p.filings, [...found].map(([acc, x]) => {
      const cik = [...x.ciks].sort()[0];
      return [acc, { ...base(acc, x, cik), searches: uniq([...x.searches]), kind: 'event', contextOnly: true, _source: src(acc, main(x.hits), { ...x.query, ciks: [cik] }) }];
    }), 'filings');
    const proxies = merge(p.proxies, [...proxyHits].map(([acc, x]) => {
      const cik = [...x.ciks].sort()[0];
      const rec = base(acc, x, cik);
      return [acc, { ...rec, kind: 'proxy', contextOnly: true, _source: src(acc, main(x.hits), { forms: rules.proxies.forms, ciks: [cik], startdt: proxyStart, enddt: today }) }];
    }), 'proxies');
    const discovery = merge(p.discovery, [...seen].map(([acc, x]) => {
      const m = main(x.hits);
      const cik = m.ciks[0];
      return [acc, { ...base(acc, x, cik), searches: uniq([...x.searches]), bizStates: uniq(x.hits.flatMap((h) => h.bizStates)), sics: uniq(x.hits.flatMap((h) => h.sics)),
        kind: 'for_review', contextOnly: true, _source: src(acc, m, { ...x.query, states: rules.discovery.states, sics: rules.discovery.sics }) }];
    }), 'discovered');

    // 6. Write, then the state the next run starts from.
    for (const g of groups) for (const c of g.ciks) if (!searchedFrom[c] || g.startdt < searchedFrom[c]) searchedFrom[c] = g.startdt;
    writeJson(p.filings, filings);
    writeJson(p.proxies, proxies);
    writeJson(p.discovery, discovery);
    writeJson(p.state, { lastRun: run.runId, ranAt: fetchedAt, window: { start, end: today }, searchedFrom, counts, searches: log });
    if (!ciks.length) { suspect = true; notes.push('no confirmed filers: the saved searches covered no bank. Run: outbound filers suggest, then confirm'); }
    if (echoMissing) { suspect = true; notes.push(`${echoMissing} response(s) carried no query echo, so they could not be matched to their request`); }
    if (short) { suspect = true; notes.push(`${short} search(es) returned fewer hits than the total they reported`); }
    if (counts.dropped) { suspect = true; notes.push(`${counts.dropped} hit(s) did not match their own request and were dropped (a cached answer to another query?)`); }
    if (counts.retried) notes.push(`${counts.retried} response(s) did not match the request at first and were fetched again after the cache expired`);
    if (counts.newFilers) notes.push(`${counts.newFilers} filer(s) searched for the first time, back to ${groups.find((g) => g.backfill).startdt}`);
    const written = counts.filingsNew + counts.proxiesNew + counts.discoveredNew;
    const line = finishRun(dir, run, { rowsRead: counts.hitsRead, rowsWritten: written, rowsChanged: changed, outcome: 'ok', suspect, notes, nullCounts, now: clock() });
    return { runId: run.runId, outcome: line.outcome, window: { start, end: today }, ...counts, changed, notes: notes.length };
  } catch (e) {
    counts.requests = client.requests();
    const line = finishRun(dir, run, { rowsRead: counts.hitsRead, outcome: 'failed', errors: [String(e.message).slice(0, 300)], notes, now: clock() });
    return { runId: run.runId, outcome: line.outcome, ...counts, errors: line.errors };
  }
}

// ---- What the listener gives the rest of the pipeline ----------------------------------------------------------------------------
// Event signals by institution key. A filing belongs to every bank whose CONFIRMED filer is among the filing's filers, so a mapping
// rejected after a run takes its filings away with it. Labels come from fixed templates (the search's label from filings.json, the
// form and the date), never from a filing. Discovery hits are never returned here.
export function filingSignals({ dir, rules = loadFilingRules() } = {}) {
  const filings = readJson(filingsPaths(dir).filings, {});
  const byCik = confirmedCiks(loadFilers(dir));
  const labels = Object.fromEntries((rules?.searches ?? []).map((s) => [s.id, s.label]));
  const out = {};
  for (const f of Object.values(filings)) {
    const via = new Map();
    for (const c of f.filerCiks ?? []) for (const b of byCik.get(c) ?? []) if (!via.has(b)) via.set(b, c);
    for (const [key, cik] of via) {
      (out[key] ??= []).push({
        id: `sec-filing:${f.accession}`, kind: 'event', type: 'sec_filing', source: 'filings', key,
        searches: f.searches, form: f.form, items: f.items, fileDate: f.fileDate, period: f.fileDate, accession: f.accession, cik, link: f.link,
        label: `${f.searches.map((s) => labels[s] ?? s).join('; ')} (${f.form}, filed ${f.fileDate})`,
        evidence: [f.key], firstSeenAt: f.firstSeenAt,
      });
    }
  }
  for (const list of Object.values(out)) list.sort((a, b) => (a.fileDate !== b.fileDate ? (a.fileDate < b.fileDate ? 1 : -1) : a.accession < b.accession ? -1 : 1));
  return out;
}

export const signalsFor = ({ dir, key, rules }) => filingSignals({ dir, rules })[key] ?? [];

// Proxy statements by institution key, newest first: form, date and link, for the briefer to read. No names.
export function filingProxies({ dir }) {
  const proxies = readJson(filingsPaths(dir).proxies, {});
  const byCik = confirmedCiks(loadFilers(dir));
  const out = {};
  for (const f of Object.values(proxies)) {
    const banks = new Set((f.filerCiks ?? []).flatMap((c) => [...(byCik.get(c) ?? [])]));
    for (const key of banks) (out[key] ??= []).push({ form: f.form, fileDate: f.fileDate, accession: f.accession, link: f.link });
  }
  for (const list of Object.values(out)) list.sort((a, b) => (a.fileDate < b.fileDate ? 1 : -1));
  return out;
}

// The discovery list, by filer, leaving out any filer since confirmed for a bank: for a principal to review.
export function discoveredFilers({ dir }) {
  const d = readJson(filingsPaths(dir).discovery, {});
  const byCik = confirmedCiks(loadFilers(dir));
  const by = new Map();
  for (const f of Object.values(d)) {
    if ((f.filerCiks ?? []).some((c) => byCik.has(c))) continue;
    const e = by.get(f.cik) ?? { cik: f.cik, name: f.filerNames?.[0]?.replace(/\s*\(CIK \d+\)\s*$/, '').trim() ?? null, states: [], sics: [], filings: [] };
    e.states = uniq([...e.states, ...(f.bizStates ?? [])]); e.sics = uniq([...e.sics, ...(f.sics ?? [])]);
    e.filings.push({ accession: f.accession, form: f.form, fileDate: f.fileDate, items: f.items, searches: f.searches, link: f.link });
    by.set(f.cik, e);
  }
  return [...by.values()].map((e) => ({ ...e, filings: e.filings.sort((a, b) => (a.fileDate < b.fileDate ? 1 : -1)), latest: e.filings.map((x) => x.fileDate).sort().at(-1) }))
    .sort((a, b) => (a.latest < b.latest ? 1 : -1));
}

// ---- Checking the listener against the source (PRD E2-S6) ------------------------------------------------------------------------
const check = (id, ok, summary, detail) => ({ id, ok: !!ok, summary, ...(detail ? { detail } : {}) });
const pick = (arr, n, seed = 1) => {
  const a = [...arr]; let x = seed;
  for (let i = a.length - 1; i > 0; i--) { x = (x * 1103515245 + 12345) % 2147483648; const j = x % (i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, n);
};
const TEXT_KEYS = ['doc_text', 'text', 'snippet', 'snippets', 'highlight', 'excerpt'];

export async function verifyFilings({ dir, sec, rules = loadFilingRules(), fetchImpl = globalThis.fetch, sample = 5, recheck = rules?.verify?.recheck ?? 5, seed = 1, sleep = realSleep, now = new Date() }) {
  const p = filingsPaths(dir);
  const state = readJson(p.state, null);
  if (!state) return { source: 'filings', checks: [check('filings.present', false, 'No SEC filings run yet. Run: outbound sources run filings')], sample: [] };
  const filings = readJson(p.filings, {}), proxies = readJson(p.proxies, {}), discovery = readJson(p.discovery, {});
  const map = loadFilers(dir);
  const byCik = confirmedCiks(map);
  const today = ymd(now);
  const checks = [];

  // 1. Fresh: the last run reached recently.
  const age = daysBetween(state.window?.end ?? '1970-01-01', today);
  const fresh = rules?.verify?.freshDays ?? 4;
  checks.push(check('filings.fresh', age <= fresh, age <= fresh ? `The last run covered filings to ${state.window.end} (${age} day(s) ago).` : `The last run covered filings only to ${state.window?.end}, ${age} days ago (more than ${fresh}). Run: outbound sources run filings`));

  // 2. Mapped: the saved searches cover at least one bank.
  const banks = new Set([...byCik.values()].flatMap((s) => [...s]));
  const orphaned = Object.values(filings).filter((f) => !(f.filerCiks ?? []).some((c) => byCik.has(c))).length;
  checks.push(check('filings.mapped', byCik.size > 0, byCik.size ? `${byCik.size} confirmed filer(s) cover ${banks.size} bank(s).${orphaned ? ` ${orphaned} stored filing(s) belong to no filer confirmed now (a mapping was rejected since), so they give no signal.` : ''}` : 'No confirmed filers, so the saved searches cover no bank. Run: outbound filers suggest, then outbound filers confirm'));

  // 3. Sourced: every record carries its source and a filing-index link for its own accession, and no filing text.
  const all = [...Object.values(filings), ...Object.values(proxies), ...Object.values(discovery)];
  const bad = all.filter((f) => !ACCESSION.test(String(f.accession ?? '')) || f.link !== indexUrl(f.cik, f.accession) || !f._source || SOURCE_KEYS.some((k) => f._source[k] === undefined || f._source[k] === null || f._source[k] === '') || TEXT_KEYS.some((k) => k in f));
  checks.push(check('filings.sourced', !bad.length, bad.length ? `${bad.length} of ${all.length} stored records lack a source block or a matching filing-index link, or hold text.` : `All ${all.length} stored records (filings ${Object.keys(filings).length}, proxy statements ${Object.keys(proxies).length}, for review ${Object.keys(discovery).length}) carry their source and a filing-index link, and no filing text.`, bad.length ? { first: bad.slice(0, 10).map((f) => f.accession) } : undefined));

  // 4. Recall: search again for a few stored filings, each on its filer and its own file date. Every one must come back.
  // 5. Filers: every confirmed CIK is still an SEC entity.
  const ua = String(sec?.userAgent ?? '');
  if (!ua || /\[confirm/i.test(ua)) {
    checks.push(check('filings.recall', false, 'Skipped: config.sec.userAgent is a placeholder, so nothing can be fetched from SEC.'));
    checks.push(check('filings.filers', false, 'Skipped: config.sec.userAgent is a placeholder.'));
  } else {
    const client = eftsClient({ sec, fetchImpl, sleep });
    const byId = Object.fromEntries((rules?.searches ?? []).map((s) => [s.id, s]));
    const pool = [...Object.values(filings).map((f) => ({ f, what: 'filing' })), ...Object.values(proxies).map((f) => ({ f, what: 'proxy' })), ...Object.values(discovery).map((f) => ({ f, what: 'for review' }))];
    const results = [];
    for (const { f, what } of pick(pool, recheck, seed)) {
      const s = what === 'proxy' ? { forms: rules.proxies.forms, phrases: [], items: [] } : byId[f.searches?.[0]];
      if (!s) { results.push({ accession: f.accession, what, ok: false, reason: `search "${f.searches?.[0]}" is no longer in filings.json` }); continue; }
      try {
        const res = await search({ client, cacheWaitMs: rules.cacheWaitMs, phrases: s.phrases ?? [], forms: s.forms, ciks: [padCik(f.cik)], startdt: f.fileDate, enddt: f.fileDate });
        const hit = res.hits.find((h) => h.accession === f.accession);
        const itemsOk = !hit || !(s.items ?? []).length || hit.items.some((i) => s.items.includes(i));
        results.push({ accession: f.accession, what, search: what === 'proxy' ? 'proxies' : f.searches[0], ok: !!hit && itemsOk, ...(hit ? {} : { reason: 'not returned' }), ...(hit && !itemsOk ? { reason: 'returned without the item searched for' } : {}) });
      } catch (e) { results.push({ accession: f.accession, what, ok: false, reason: String(e.message).slice(0, 120) }); }
    }
    const lost = results.filter((r) => !r.ok);
    checks.push(check('filings.recall', !lost.length, !results.length ? 'Nothing stored yet to search for again.' : lost.length ? `${lost.length} of ${results.length} stored filings did not come back when searched for again.` : `${results.length} stored filing(s) searched for again on their filer and date: every one came back.`, { filings: results }));

    const gone = [], renamed = [];
    for (const cik of [...byCik.keys()].sort().slice(0, 100)) {
      try {
        const e = (await lookupEntities({ client, text: String(Number(cik)) })).find((x) => x.cik === cik);
        if (!e) { gone.push(cik); continue; }
        const stored = [...byCik.get(cik)].map((b) => map[b]?.ciks?.[cik]?.filer).find(Boolean);
        if (stored && stored.toUpperCase() !== e.name.toUpperCase()) renamed.push({ cik, stored, now: e.name });
      } catch (err) { gone.push(`${cik} (${String(err.message).slice(0, 60)})`); }
    }
    checks.push(check('filings.filers', !gone.length, gone.length ? `${gone.length} of ${byCik.size} confirmed CIK(s) are not found as SEC entities: check the mapping.` : `All ${byCik.size} confirmed CIK(s) are SEC entities.${renamed.length ? ` ${renamed.length} now go by another name; a principal may want to look.` : ''}`, gone.length || renamed.length ? { gone, renamed } : undefined));
  }

  const sampleRows = pick(Object.values(filings), sample, seed).map((f) => {
    const banksOf = uniq((f.filerCiks ?? []).flatMap((c) => [...(byCik.get(c) ?? [])]));
    return { accession: f.accession, form: f.form, fileDate: f.fileDate, items: f.items, searches: f.searches, banks: banksOf, check: f.link };
  });
  return { source: 'filings', checks, sample: sampleRows };
}
