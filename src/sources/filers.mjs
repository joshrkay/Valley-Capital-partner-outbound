// The bank-to-filer map for the SEC filings listener (PRD E13-S1). Most banks never file with the SEC themselves; their holding
// company does. So each bank in the FDIC list (keyed fdic:CERT) is mapped to the SEC filer IDs (CIKs) that file for it, wherever
// that filer is based. A principal decides every mapping: `suggest` proposes, `confirm` and `reject` record the decision, and only
// confirmed mappings are ever searched. Nothing here guesses.
//
// Suggestions come from two public sources:
//   - FDIC /institutions: the holding company's name (NAMEHCR), its RSSD ID (RSSDHCR), city and state (CITYHCR, STALPHCR), and
//     the bank's own RSSD ID (FED_RSSD). Checked live 2026-11-13: every row carries every one of these keys, and a bank with no
//     holding company has empty strings. The stored FDIC list keeps none of them, so they are read here, read-only.
//   - The SEC's entity lookup (src/sources/efts.mjs, lookupEntities), by the holding company's name; and each candidate's latest
//     10-K or 10-Q from full-text search, whose SIC code and state show whether it is a bank.
// Banks with the same holding company (the same RSSDHCR) share a filer, so a filer confirmed for one is proposed for the others.
import { join } from 'node:path';
import { readJson, writeJson, audit } from '../store.mjs';
import { pacer, realSleep } from './http.mjs';
import { fdicQuery, orFilter, checkFields } from './fdic.mjs';
import { eftsClient, lookupEntities, search, padCik, addDays, ymd, MAX_CIKS } from './efts.mjs';
import { startRun, finishRun } from './runlog.mjs';

export const filerPaths = (dir) => ({
  map: join(dir, 'sources', 'edgar', 'filers.json'),
  suggestions: join(dir, 'sources', 'edgar', 'filer-suggestions.json'),
  institutions: join(dir, 'sources', 'fdic', 'institutions.json'),
});

// FDIC /institutions fields for the holding company (verified live 2026-11-13).
export const HC_FIELDS = Object.freeze(['CERT', 'NAME', 'NAMEHCR', 'RSSDHCR', 'FED_RSSD', 'CITYHCR', 'STALPHCR']);

export function parseBank(key) {
  const m = /^fdic:(\d{1,10})$/.exec(String(key ?? '').trim());
  if (!m) throw new Error(`Not a bank key: "${key}". Bank keys look like fdic:<CERT>.`);
  const cert = String(Number(m[1]));
  return { key: `fdic:${cert}`, cert };
}

const requireBy = (by) => {
  const s = typeof by === 'string' ? by.trim() : '';
  if (!s) throw new Error('--by NAME is required: a principal decides every mapping.');
  return s;
};

export const loadFilers = (dir) => readJson(filerPaths(dir).map, {});

// CIK -> the banks it is confirmed for. Only these are searched.
export function confirmedCiks(map) {
  const out = new Map();
  for (const [bank, e] of Object.entries(map ?? {})) {
    for (const [cik, d] of Object.entries(e?.ciks ?? {})) {
      if (d?.status !== 'confirmed') continue;
      if (!out.has(cik)) out.set(cik, new Set());
      out.get(cik).add(bank);
    }
  }
  return out;
}

// A principal's decision on one bank and one filer. The previous decision on the same pair is kept in its history; every decision
// is audited with who made it.
function decide({ dir, bank, cik, by, status, reason, now = new Date() }) {
  const who = requireBy(by);
  const b = parseBank(bank);
  const c = padCik(cik);
  const p = filerPaths(dir);
  const inst = readJson(p.institutions, null);
  if (!inst) throw new Error('No FDIC bank list yet. Run: outbound sources run fdic');
  const row = inst[b.cert];
  if (!row) throw new Error(`${b.key} is not in the FDIC bank list (sources/fdic/institutions.json).`);
  const map = readJson(p.map, {});
  const entry = map[b.key] ?? { bank: b.key, ciks: {} };
  const prev = entry.ciks[c];
  const suggestions = readJson(p.suggestions, null);
  const sug = suggestions?.banks?.[b.key];
  const cand = sug?.candidates?.find((x) => x.cik === c);
  const evidence = cand
    ? { suggestedAt: suggestions?.at ?? null, match: cand.match, basis: cand.basis, holdingCompany: sug.holdingCompany ?? null, rssdHcr: sug.rssdHcr ?? null, lastFiling: cand.lastFiling ?? null, sics: cand.sics ?? [], states: cand.states ?? [] }
    : prev?.evidence ?? null;
  entry.name = row.NAME ?? entry.name ?? null;
  if (sug?.rssdHcr) entry.rssdHcr = sug.rssdHcr;
  entry.ciks[c] = {
    status, filer: cand?.name ?? prev?.filer ?? null, by: who, at: now.toISOString(), ...(reason ? { reason: String(reason).slice(0, 300) } : {}),
    basis: cand ? 'suggested' : prev?.basis ?? 'manual', ...(evidence ? { evidence } : {}),
    ...(prev ? { history: [...(prev.history ?? []), { status: prev.status, by: prev.by, at: prev.at, ...(prev.reason ? { reason: prev.reason } : {}) }] } : {}),
  };
  map[b.key] = entry;
  writeJson(p.map, map);
  audit(dir, { type: status === 'confirmed' ? 'filer_confirmed' : 'filer_rejected', bank: b.key, cik: c, by: who });
  return { bank: b.key, bankName: entry.name, cik: c, ...entry.ciks[c] };
}

export const confirmFiler = ({ dir, bank, cik, by, now }) => decide({ dir, bank, cik, by, status: 'confirmed', now });
export const rejectFiler = ({ dir, bank, cik, by, reason, now }) => decide({ dir, bank, cik, by, reason, status: 'rejected', now });

const universeOf = (inst) => Object.values(inst ?? {}).filter((i) => i?.inUniverse && i.status === 'active').sort((a, b) => Number(a.CERT) - Number(b.CERT));

// Every bank in the list, with its mapping: confirmed (and to which filers), rejected only, or not mapped yet.
export function filerStatus({ dir }) {
  const p = filerPaths(dir);
  const inst = readJson(p.institutions, null);
  if (!inst) throw new Error('No FDIC bank list yet. Run: outbound sources run fdic');
  const map = readJson(p.map, {});
  const rows = universeOf(inst).map((i) => {
    const key = `fdic:${i.CERT}`;
    const ciks = Object.entries(map[key]?.ciks ?? {}).map(([cik, d]) => ({ cik, status: d.status, filer: d.filer ?? null, by: d.by, at: d.at }));
    const status = ciks.some((c) => c.status === 'confirmed') ? 'confirmed' : ciks.length ? 'rejected' : 'unmapped';
    return { bank: key, name: i.NAME ?? null, status, ciks };
  });
  const outside = Object.keys(map).filter((k) => !rows.some((r) => r.bank === k) && Object.values(map[k].ciks ?? {}).some((d) => d.status === 'confirmed'));
  const n = (s) => rows.filter((r) => r.status === s).length;
  return { banks: rows.length, confirmed: n('confirmed'), rejectedOnly: n('rejected'), unmapped: n('unmapped'), filers: confirmedCiks(map).size, mappedOutsideList: outside, rows };
}

// Names compared without case, punctuation or legal-form words: "Example Bancorp, Inc." and "EXAMPLE BANCORP" are the same name.
// SEC names often end in a state tag that tells same-named filers apart ("/TX/", "/TX", "/MD/"): 11 of 41 candidates in a live
// run of 2026-11-13. It is dropped too.
export const normName = (s) => String(s ?? '').toUpperCase().replace(/\s*\/[A-Z]{2,3}\/?\s*$/, '').replace(/&/g, ' AND ').replace(/[^A-Z0-9 ]/g, ' ')
  .replace(/\b(THE|INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LTD|LIMITED|LLC|N A|NA)\b/g, ' ').replace(/\s+/g, ' ').trim();

// Proposes filers for every bank in the list that has none confirmed. Writes sources/edgar/filer-suggestions.json and one run-log
// line, and returns the suggestions. Reads FDIC and SEC only; decides nothing.
export async function suggestFilers({ dir, sec, rules, fetchImpl = globalThis.fetch, sleep = realSleep, now = new Date(), clock = () => new Date(), limit = Infinity, fdicMinIntervalMs = 200 }) {
  const client = eftsClient({ sec, fetchImpl, sleep });   // refuses a placeholder User-Agent before any request
  const p = filerPaths(dir);
  const inst = readJson(p.institutions, null);
  if (!inst) throw new Error('No FDIC bank list yet. Run: outbound sources run fdic');
  const map = readJson(p.map, {});
  const confirmed = confirmedCiks(map);
  const universe = universeOf(inst);
  const isMapped = (i) => Object.values(map[`fdic:${i.CERT}`]?.ciks ?? {}).some((d) => d.status === 'confirmed');
  const todo = universe.filter((i) => !isMapped(i)).slice(0, limit);
  const cfg = rules?.suggest ?? {};
  const bankSics = rules?.discovery?.sics ?? [];
  const run = startRun({ source: 'filers', query: { step: 'suggest' }, now });
  let rowsRead = 0;
  try {
    // 1. Holding companies, for every bank in the list (so a filer confirmed for one bank can be proposed for its siblings).
    const http = { fetchImpl, sleep, retries: 3, timeoutMs: 60000, pace: pacer(fdicMinIntervalMs, { sleep }) };
    const certs = universe.map((i) => String(i.CERT));
    const rows = [];
    for (let i = 0; i < certs.length; i += 50) rows.push(...(await fdicQuery({ endpoint: 'institutions', filters: orFilter('CERT', certs.slice(i, i + 50)), fields: HC_FIELDS, http })).rows);
    rowsRead += rows.length;
    const fc = checkFields(rows, HC_FIELDS);
    if (fc.missing.length) throw new Error(`FDIC did not return requested field(s): ${fc.missing.map((m) => `${m.field} (absent from ${m.rowsLacking} of ${m.rows} rows)`).join(', ')}. A field name may have changed; nothing was written.`);
    const hc = new Map(rows.map((r) => [String(r.CERT), r]));
    const siblingFiler = new Map();   // RSSDHCR -> [{ cik, bank, by }]
    for (const i of universe) {
      const r = hc.get(String(i.CERT));
      const rssd = String(r?.RSSDHCR ?? '').trim();
      if (!rssd || rssd === '0') continue;
      for (const [cik, d] of Object.entries(map[`fdic:${i.CERT}`]?.ciks ?? {})) if (d.status === 'confirmed') siblingFiler.set(rssd, [...(siblingFiler.get(rssd) ?? []), { cik, bank: `fdic:${i.CERT}`, by: d.by, filer: d.filer }]);
    }

    // 2. SEC entities by name: the holding company's, or the bank's own when FDIC shows no holding company. One lookup per name.
    const lookups = new Map();
    const banks = {};
    for (const i of todo) {
      const key = `fdic:${i.CERT}`;
      const r = hc.get(String(i.CERT)) ?? {};
      const holdingCompany = String(r.NAMEHCR ?? '').trim() || null;
      const rssdHcr = String(r.RSSDHCR ?? '').trim() || null;
      const source = holdingCompany ?? String(r.NAME ?? i.NAME ?? '');
      const query = normName(source);
      if (query && !lookups.has(query)) lookups.set(query, await lookupEntities({ client, text: query }));
      const rejected = new Set(Object.entries(map[key]?.ciks ?? {}).filter(([, d]) => d.status === 'rejected').map(([c]) => c));
      const cands = new Map();
      for (const s of (rssdHcr && siblingFiler.get(rssdHcr)) || []) {
        if (rejected.has(s.cik)) continue;
        cands.set(s.cik, { cik: s.cik, name: s.filer, entity: s.filer, tickers: null, match: 'sibling', basis: `the same holding company (RSSD ${rssdHcr}) as ${s.bank}, whose filer ${s.by} confirmed` });
      }
      for (const e of lookups.get(query) ?? []) {
        if (rejected.has(e.cik) || cands.has(e.cik)) continue;
        const exact = normName(e.name) === query;
        cands.set(e.cik, { ...e, match: exact ? 'exact' : 'words', basis: `${exact ? 'the same name as' : 'every word of'} ${holdingCompany ? 'the holding company' : "the bank's own name (FDIC shows no holding company)"}` });
      }
      banks[key] = { bank: key, name: r.NAME ?? i.NAME ?? null, holdingCompany, rssdHcr, fedRssd: String(r.FED_RSSD ?? '').trim() || null, holdingCompanyPlace: [r.CITYHCR, r.STALPHCR].filter(Boolean).join(', ') || null, query, candidates: [...cands.values()] };
    }

    // 3. Evidence: each candidate's latest 10-K or 10-Q, whose SIC code and state show what it is.
    const all = [...new Set(Object.values(banks).flatMap((b) => b.candidates.map((c) => c.cik)))].sort();
    const ev = new Map();
    const today = ymd(now);
    let missing = {};
    for (let i = 0; i < all.length; i += MAX_CIKS) {
      const res = await search({ client, cacheWaitMs: rules?.cacheWaitMs, forms: cfg.evidenceForms ?? ['10-K', '10-Q'], ciks: all.slice(i, i + MAX_CIKS), startdt: addDays(today, -(cfg.evidenceDays ?? 400)), enddt: today });
      rowsRead += res.read;
      for (const [k, n] of Object.entries(res.missing)) missing[k] = (missing[k] ?? 0) + n;
      for (const h of res.hits) for (const c of h.ciks) {
        const cur = ev.get(c);
        if (!cur || h.fileDate > cur.fileDate) ev.set(c, { form: h.form, fileDate: h.fileDate, accession: h.accession, sics: h.sics, states: h.bizStates, filer: h.names[0] ?? null });
      }
    }
    if (Object.keys(missing).length) throw new Error(`EDGAR full-text search did not return field(s): ${Object.entries(missing).map(([k, n]) => `${k} (absent from ${n} hits)`).join(', ')}. Nothing was written.`);

    // 4. Rank: a sibling's confirmed filer, then a recent 10-K or 10-Q, then a bank's SIC code, then an exact name. The filing
    // weighs most: in a live run of 2026-11-13, 18 of 22 exact-name candidates had filed no 10-K or 10-Q in over a year (same-named
    // entities that do not report), and so could never produce a hit.
    const rank = (c) => (c.match === 'sibling' ? 0 : 1000) + (c.lastFiling ? 0 : 100) + (c.bankSic ? 0 : 10) + (c.match === 'exact' ? 0 : 1);
    let candidates = 0;
    for (const b of Object.values(banks)) {
      b.candidates = b.candidates.map((c) => {
        const e = ev.get(c.cik);
        return { ...c, lastFiling: e ? { form: e.form, fileDate: e.fileDate, accession: e.accession } : null, sics: e?.sics ?? [], states: e?.states ?? [], bankSic: !!e?.sics?.some((s) => bankSics.includes(s)) };
      }).sort((x, y) => rank(x) - rank(y) || (x.cik < y.cik ? -1 : 1)).slice(0, cfg.maxCandidates ?? 5);
      candidates += b.candidates.length;
    }
    const outRec = { at: now.toISOString(), runId: run.runId, banks };
    writeJson(p.suggestions, outRec);
    const line = finishRun(dir, run, { rowsRead, rowsWritten: Object.keys(banks).length, outcome: 'ok', notes: [`${todo.length} unmapped bank(s), ${lookups.size} name lookup(s), ${candidates} candidate(s)`], now: clock() });
    return { runId: run.runId, outcome: line.outcome, unmapped: todo.length, lookups: lookups.size, candidates, banks };
  } catch (e) {
    const line = finishRun(dir, run, { rowsRead, outcome: 'failed', errors: [String(e.message).slice(0, 300)], now: clock() });
    return { runId: run.runId, outcome: line.outcome, errors: line.errors, banks: {} };
  }
}
