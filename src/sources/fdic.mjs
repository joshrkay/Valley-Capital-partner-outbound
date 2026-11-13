// FDIC BankFind adapter (PRD E2-S2, E3-S1, E3-S2). Public data, no key. Field names, query syntax and quirks were verified
// against FDIC's own definition files and live queries on 2026-11-13 (PRD Appendix A). Three quirks shape this file:
//   1. A list filter must be `FIELD:("A" OR "B")`. The comma form `FIELD:(A,B)` returns zero rows with no error.
//   2. A field name the API does not recognize is dropped silently, so every step checks that each requested field came back.
//   3. Charge-off fields without a Q suffix are year-to-date; only the quarterly (Q) versions are requested.
// A run fetches everything first, checks it, and only then writes. A failed check writes nothing but the run log line.
import { join } from 'node:path';
import { readJson, writeJson } from '../store.mjs';
import { getJson, pacer, realSleep } from './http.mjs';
import { startRun, finishRun, sourceBlock, assertSourced, upsertWithChanges } from './runlog.mjs';

export const FDIC_BASE = 'https://api.fdic.gov/banks';

export const FDIC_FIELDS = Object.freeze({
  institutions: ['CERT', 'NAME', 'CITY', 'STALP', 'ASSET', 'WEBADDR', 'ACTIVE'],
  // Branch rows: STALP here is the BRANCH's state in live data (despite its definition), so it is not requested; HQ state comes from /institutions.
  locations: ['CERT', 'CBSA_NO', 'CBSA', 'COUNTY', 'STCNTY', 'MAINOFF'],
  // DEPSUM is the institution's total deposits, repeated on every branch row; DEPSUMBR is the branch's own.
  sod: ['CERT', 'YEAR', 'DEPSUMBR', 'DEPSUM', 'STCNTYBR', 'MSABR', 'CNTYNAMB', 'STALPBR'],
  failures: ['CERT', 'NAME', 'FAILDATE', 'RESTYPE'],
  financials: [
    'CERT', 'REPDTE', 'ASSET', 'CB', 'LNLSNET', 'NCLNLS', 'NALNLS', 'P3ASSET', 'P9ASSET',
    'LNRECONS', 'LNRENRES', 'LNRENROW', 'LNRENROT', 'LNREMULT',
    'NCRECONS', 'NCRENRES', 'NCRENROW', 'NCRENROT', 'NCREMULT',
    'NARECONS', 'NARENRES', 'NAREMULT',
    'P3RENRES', 'P3REMULT', 'P9RENRES', 'P9REMULT',
    'ORE', 'ORECONS', 'ORENRES', 'OREMULT',
    'NTLNLSQ', 'NTRECONQ', 'NTRENRSQ', 'NTREMULQ',
  ],
});

// Year-to-date flow fields. Comparing them quarter to quarter is wrong, so they are never requested.
export const YTD_FLOW_FIELDS = Object.freeze(['NTLNLS', 'NTRECONS', 'NTRENRES', 'NTREMULT']);
if (FDIC_FIELDS.financials.some((f) => YTD_FLOW_FIELDS.includes(f))) throw new Error('A year-to-date flow field is in the financials field list; use the quarterly (Q) version.');

export const fdicPaths = (dir) => {
  const base = join(dir, 'sources', 'fdic');
  return { base, state: join(base, 'state.json'), institutions: join(base, 'institutions.json'), footprint: join(base, 'footprint.json'), financials: (cert) => join(base, 'financials', `${cert}.json`) };
};

// Builds `FIELD:("A" OR "B")` (quote) or `FIELD:(1 OR 2)`. Values are codes, states or numbers only, so nothing can inject syntax.
export function orFilter(field, values, { quote = false } = {}) {
  const list = [...new Set((values ?? []).map((v) => String(v)))];
  if (!list.length) throw new Error(`orFilter(${field}): no values.`);
  for (const v of list) if (!/^[A-Za-z0-9_.-]+$/.test(v)) throw new Error(`orFilter(${field}): unsafe value "${v}".`);
  return `${field}:(${list.map((v) => (quote ? `"${v}"` : v)).join(' OR ')})`;
}

const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };
const pad5 = (v) => String(v).padStart(5, '0');

// One query, paged by offset until FDIC's reported total is reached. A count mismatch is reported, not hidden.
export async function fdicQuery({ endpoint, filters, fields, sortBy, sortOrder, limit = 10000, maxRows = Infinity, http = {} }) {
  const rows = [];
  let total = 0, offset = 0, pages = 0;
  for (;;) {
    await http.pace?.();
    const body = await getJson(`${FDIC_BASE}/${endpoint}`, { filters, fields: fields?.join(','), sort_by: sortBy, sort_order: sortOrder, limit, offset }, http);
    pages++;
    if (!body || !Array.isArray(body.data) || typeof body.meta?.total !== 'number') throw new Error(`Unexpected response shape from FDIC /${endpoint}.`);
    total = body.meta.total;
    const page = body.data.map((d) => d?.data ?? {});
    rows.push(...page);
    offset += page.length;
    if (!page.length || offset >= total || rows.length >= maxRows) break;
    if (pages > Math.ceil(total / limit) + 1) break;   // never loop forever on a misbehaving server
  }
  const expected = Math.min(total, maxRows);
  return { rows: rows.slice(0, maxRows === Infinity ? rows.length : maxRows), total, mismatch: rows.length < expected, pages };
}

// FDIC's financials and branch endpoints report a value they do not have as an explicit null with the key present, and the API
// drops a field name it does not know entirely (both verified live). So EVERY returned row must carry EVERY requested key: a key
// absent from any row means a renamed or misspelled field, or a response we do not understand. Nulls are allowed and counted.
// The one exception is a short list of fields verified to be omitted rather than nulled (OPTIONAL_KEYS): an absent optional key
// is treated as null and counted, but an optional key absent from EVERY row still fails, so a renamed field is still caught.
// ID is FDIC's own key and is ignored.
export const OPTIONAL_KEYS = Object.freeze({
  // Verified live 2026-11-13: /institutions omitted WEBADDR for 1 of 268 banks (a foreign bank's U.S. branch) and sent '' for another.
  institutions: ['WEBADDR'],
});

export function checkFields(rows, fields, { optional = [] } = {}) {
  const missing = [], nulls = {}, absentOptional = {};
  for (const f of fields) {
    if (f === 'ID') continue;
    let lacking = 0, n = 0;
    for (const r of rows) {
      if (!Object.prototype.hasOwnProperty.call(r, f)) lacking++;
      else if (r[f] === null) n++;
    }
    const isOptional = optional.includes(f);
    if (lacking && (!isOptional || lacking === rows.length)) missing.push({ field: f, rowsLacking: lacking, rows: rows.length });
    else if (lacking) { absentOptional[f] = lacking; n += lacking; }
    if (n) nulls[f] = n;
  }
  return { missing, nulls, absentOptional };
}

// Runs a filter over many values in chunks (long OR lists make long URLs) and concatenates the results.
async function collect({ endpoint, values, filtersFor, chunkSize = 50, fields, sortBy, sortOrder, pageSize, http }) {
  const out = { rows: [], total: 0, mismatch: false };
  for (const part of chunk(values, chunkSize)) {
    const r = await fdicQuery({ endpoint, filters: filtersFor(part), fields, sortBy, sortOrder, limit: pageSize, http });
    out.rows.push(...r.rows); out.total += r.total; out.mismatch ||= r.mismatch;
  }
  return out;
}

// The quarter ends from `latest` back, oldest first: quartersBack('20260630', 3) -> ['20251231', '20260331', '20260630'].
export function quartersBack(latest, n) {
  const ends = { 3: '0331', 6: '0630', 9: '0930', 12: '1231' };
  let y = Number(latest.slice(0, 4)), m = Number(latest.slice(4, 6));
  if (!ends[m] || latest.slice(6) !== ends[m].slice(2)) throw new Error(`Not a quarter-end report date: ${latest}`);
  const out = [];
  for (let i = 0; i < n; i++) { out.unshift(`${y}${ends[m]}`); m -= 3; if (m === 0) { m = 12; y--; } }
  return out;
}

const metroList = (metros) => (Array.isArray(metros) ? metros : metros?.metros ?? []);

// E3-S1: banks with a branch in a metro, counted per metro. Matching is on the CBSA code; names drift.
export async function pullBranches({ metros, http, pageSize }) {
  const codes = metroList(metros).map((m) => m.cbsa);
  const r = await fdicQuery({ endpoint: 'locations', filters: orFilter('CBSA_NO', codes), fields: FDIC_FIELDS.locations, limit: pageSize, http });
  const byCert = new Map();
  for (const row of r.rows) {
    const cert = String(row.CERT), cbsa = String(row.CBSA_NO);
    if (!byCert.has(cert)) byCert.set(cert, {});
    const b = byCert.get(cert); b[cbsa] = (b[cbsa] ?? 0) + 1;
  }
  return { ...r, byCert, filters: orFilter('CBSA_NO', codes) };
}

export async function pullHqCerts({ states, http, pageSize }) {
  const filters = `${orFilter('STALP', states, { quote: true })} AND ACTIVE:1`;
  const r = await fdicQuery({ endpoint: 'institutions', filters, fields: ['CERT'], limit: pageSize, http });
  return { ...r, certs: new Set(r.rows.map((x) => String(x.CERT))), filters };
}

export async function pullInstitutions({ certs, http, pageSize, chunkSize }) {
  return collect({ endpoint: 'institutions', values: certs, filtersFor: (p) => orFilter('CERT', p), chunkSize, fields: FDIC_FIELDS.institutions, pageSize, http });
}

export async function pullFailures({ certs, http, pageSize, chunkSize }) {
  return collect({ endpoint: 'failures', values: certs, filtersFor: (p) => orFilter('CERT', p), chunkSize, fields: FDIC_FIELDS.failures, pageSize, http });
}

// Summary of Deposits, latest year, joined to metros by branch COUNTY (STCNTYBR, which FDIC returns as a number, so it is zero-padded)
// rather than by MSABR. MSABR disagreements are counted so a drift in FDIC's coding shows up in the run notes.
export async function pullSod({ metros, http, pageSize }) {
  const countyToMetro = new Map();
  for (const m of metroList(metros)) for (const c of Object.keys(m.counties ?? {})) countyToMetro.set(pad5(c), String(m.cbsa));
  if (!countyToMetro.size) return { rows: [], total: 0, mismatch: false, year: null, byCert: new Map(), msaMismatches: 0, rowsRead: 0 };
  const countyFilter = orFilter('STCNTYBR', [...countyToMetro.keys()].map((c) => Number(c)));
  const latest = await fdicQuery({ endpoint: 'sod', filters: countyFilter, fields: ['YEAR'], sortBy: 'YEAR', sortOrder: 'DESC', limit: 1, maxRows: 1, http });
  const year = latest.rows[0]?.YEAR ?? null;
  if (year === null) return { rows: [], total: 0, mismatch: false, year, byCert: new Map(), msaMismatches: 0, rowsRead: latest.rows.length };
  const filters = `YEAR:${Number(year)} AND ${countyFilter}`;
  const r = await fdicQuery({ endpoint: 'sod', filters, fields: FDIC_FIELDS.sod, limit: pageSize, http });
  const byCert = new Map();
  let msaMismatches = 0;
  for (const row of r.rows) {
    const cbsa = countyToMetro.get(pad5(row.STCNTYBR));
    if (!cbsa) continue;
    if (row.MSABR !== undefined && String(row.MSABR) !== cbsa) msaMismatches++;
    const cert = String(row.CERT);
    if (!byCert.has(cert)) byCert.set(cert, { depositsByMetro: {}, totalDeposits: null });
    const s = byCert.get(cert);
    s.depositsByMetro[cbsa] = (s.depositsByMetro[cbsa] ?? 0) + (Number(row.DEPSUMBR) || 0);
    if (row.DEPSUM !== undefined && row.DEPSUM !== null) s.totalDeposits = Math.max(s.totalDeposits ?? 0, Number(row.DEPSUM));
  }
  return { ...r, year: Number(year), byCert, msaMismatches, filters, rowsRead: r.rows.length + latest.rows.length };
}

// E3-S2: the last `quarters` published quarters for every bank, re-pulled each run because Call Reports get amended.
export async function pullFinancials({ certs, latestRepdte, quarters = 8, http, pageSize, chunkSize }) {
  const qs = quartersBack(latestRepdte, quarters);
  const range = `REPDTE:[${qs[0]} TO ${qs.at(-1)}]`;
  const r = await collect({ endpoint: 'financials', values: certs, filtersFor: (p) => `${orFilter('CERT', p)} AND ${range}`, chunkSize, fields: FDIC_FIELDS.financials, sortBy: 'REPDTE', sortOrder: 'ASC', pageSize, http });
  return { ...r, range, quarters: qs };
}

// The latest report date FDIC has published, compared with the last one this data folder saw.
export async function checkNewQuarter({ dir, http }) {
  const r = await fdicQuery({ endpoint: 'financials', fields: ['REPDTE'], sortBy: 'REPDTE', sortOrder: 'DESC', limit: 1, maxRows: 1, http });
  const latestRepdte = r.rows[0]?.REPDTE ? String(r.rows[0].REPDTE) : null;
  const previous = readJson(fdicPaths(dir).state, {})?.latestRepdte ?? null;
  return { ...r, latestRepdte, previous, newQuarter: !!latestRepdte && latestRepdte !== previous && (!previous || latestRepdte > previous) };
}

const parseFailDate = (s) => { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(s ?? '')); return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : (s ? String(s) : null); };

// Does the whole FDIC step: bank list, institution details, failures, footprint, financials. Writes the PRD Appendix C files and
// one run-log line, and returns a summary. Never throws for a data problem: a failed run returns outcome "failed" with the reason.
export async function runFdic({ dir, metros, includeHq = false, fetchImpl = globalThis.fetch, now = new Date(), quarters = 8, pageSize = 10000, chunkSize = 50, sleep = realSleep, minIntervalMs = 200, retries = 3, timeoutMs = 60000, clock = () => new Date() }) {
  const list = metroList(metros);
  if (!list.length) throw new Error('runFdic: no metros given (pass metros.json).');
  const hqStates = includeHq ? (metros?.hqStates ?? []) : [];
  const query = { metros: list.map((m) => String(m.cbsa)).sort(), hqStates, quarters };
  const run = startRun({ source: 'fdic', query, now });
  const http = { fetchImpl, sleep, retries, timeoutMs, pace: pacer(minIntervalMs, { sleep }) };
  const fetchedAt = now.toISOString();
  const asOf = fetchedAt.slice(0, 10);
  const paths = fdicPaths(dir);

  let rowsRead = 0, suspect = false;
  const missing = [], notes = [], nullCounts = {};
  const missingNames = () => missing.map((m) => `${m.step}.${m.field}`);
  const take = (step, res, fields) => {
    rowsRead += res.rowsRead ?? res.rows.length;
    if (res.mismatch) { suspect = true; notes.push(`${step}: received ${res.rows.length} rows of ${res.total} reported`); }
    if (fields) {
      const c = checkFields(res.rows, fields, { optional: OPTIONAL_KEYS[step] ?? [] });
      for (const m of c.missing) missing.push({ step, ...m });
      for (const [f, n] of Object.entries(c.nulls)) nullCounts[`${step}.${f}`] = (nullCounts[`${step}.${f}`] ?? 0) + n;
      for (const [f, n] of Object.entries(c.absentOptional)) notes.push(`${step}.${f}: key absent on ${n} of ${res.rows.length} rows (optional field; stored as null)`);
    }
    return res;
  };
  const fail = (errors) => {
    const line = finishRun(dir, run, { rowsRead, outcome: 'failed', missingFields: missingNames(), errors, notes, nullCounts, now: clock() });
    return { runId: run.runId, outcome: line.outcome, banks: 0, latestRepdte: null, newQuarter: false, missingFields: missingNames(), missingDetail: missing, changed: 0, rowsRead, rowsWritten: 0, nullCounts, notes, errors: line.errors };
  };

  try {
    // 1. Fetch and check everything.
    const quarter = take('financials-latest', await checkNewQuarter({ dir, http }), ['REPDTE']);
    if (!quarter.latestRepdte) return fail(['FDIC returned no report date.']);
    const branches = take('locations', await pullBranches({ metros: list, http, pageSize }), FDIC_FIELDS.locations);
    const hq = includeHq ? take('institutions-hq', await pullHqCerts({ states: hqStates, http, pageSize }), ['CERT']) : { certs: new Set() };
    const universe = [...new Set([...branches.byCert.keys(), ...hq.certs])].sort((a, b) => Number(a) - Number(b));
    if (!universe.length) {
      notes.push('No banks matched the metro filter. The filter syntax or the metro codes may be wrong; nothing was written.');
      const line = finishRun(dir, run, { rowsRead, outcome: 'ok', suspect: true, notes, now: clock() });
      return { runId: run.runId, outcome: line.outcome, banks: 0, latestRepdte: quarter.latestRepdte, newQuarter: false, missingFields: [], changed: 0, rowsRead, rowsWritten: 0, notes };
    }
    const existingInst = readJson(paths.institutions, {});
    const known = Object.keys(existingInst);
    const allCerts = [...new Set([...universe, ...known])].sort((a, b) => Number(a) - Number(b));
    const inst = take('institutions', await pullInstitutions({ certs: allCerts, http, pageSize, chunkSize }), FDIC_FIELDS.institutions);
    const fails = take('failures', await pullFailures({ certs: allCerts, http, pageSize, chunkSize }), FDIC_FIELDS.failures);
    const sod = take('sod', await pullSod({ metros: list, http, pageSize }), FDIC_FIELDS.sod);
    const fin = take('financials', await pullFinancials({ certs: universe, latestRepdte: quarter.latestRepdte, quarters, http, pageSize, chunkSize }), FDIC_FIELDS.financials);
    if (sod.msaMismatches) notes.push(`sod: ${sod.msaMismatches} branch rows had an MSA code different from their county's metro; county was used.`);
    if (missing.length) return fail([`FDIC did not return requested field(s): ${missing.map((m) => `${m.step}.${m.field} (absent from ${m.rowsLacking} of ${m.rows} rows)`).join(', ')}. A field name may have changed; nothing was written.`]);

    // 2. Build records. Every record carries its source; assertSourced runs on each before anything is written.
    const uni = new Set(universe);
    // /failures also lists open-bank ASSISTANCE (for example 2008-09 assistance to banks that are open today). Only a FAILURE
    // record marks a bank failed; assistance is kept as context. Verified live 2026-11-13: 593 assistance records exist.
    const isFailure = (f) => String(f.RESTYPE ?? '').toUpperCase() === 'FAILURE';
    const failedBy = new Map(fails.rows.filter(isFailure).map((f) => [String(f.CERT), parseFailDate(f.FAILDATE)]));
    const assistedBy = new Map(fails.rows.filter((f) => !isFailure(f)).map((f) => [String(f.CERT), parseFailDate(f.FAILDATE)]));
    const instRows = new Map(inst.rows.map((r) => [String(r.CERT), r]));
    const flagged = { failed: [], inactive: [], left: [] };
    let changed = 0, rowsWritten = 0;
    const nextInst = { ...existingInst };
    for (const cert of allCerts) {
      const row = instRows.get(cert);
      const prev = existingInst[cert];
      if (!row && !prev) continue;
      const status = failedBy.has(cert) ? 'failed' : row ? (Number(row.ACTIVE) === 1 ? 'active' : 'inactive') : prev.status;
      const inUniverse = uni.has(cert);
      const rec = {
        ...(row ? Object.fromEntries(FDIC_FIELDS.institutions.map((f) => [f, f === 'CERT' ? cert : row[f] ?? null])) : {}),
        via: { branch: branches.byCert.has(cert), hq: hq.certs.has(cert) }, inUniverse, status,
        ...(failedBy.has(cert) ? { failedOn: failedBy.get(cert) } : {}),
        ...(assistedBy.has(cert) ? { assistanceOn: assistedBy.get(cert) } : {}),
        ...(prev?.inUniverse && !inUniverse ? { leftOn: asOf } : {}),
        _source: sourceBlock({ source: 'fdic', endpoint: '/institutions', query: { filters: `CERT:${cert}` }, recordId: row?.ID ?? cert, period: asOf, fetchedAt, runId: run.runId }),
      };
      if (status === 'failed') flagged.failed.push(cert); else if (status === 'inactive') flagged.inactive.push(cert);
      if (prev?.inUniverse && !inUniverse) flagged.left.push(cert);
      const u = upsertWithChanges(prev, rec, { key: `fdic:${cert}`, runId: run.runId, dir, now });
      nextInst[cert] = u.record; changed += u.changed; rowsWritten++;
    }

    const footprint = {};
    for (const cert of universe) {
      const s = sod.byCert.get(cert);
      const metroDeposits = s ? Object.values(s.depositsByMetro).reduce((a, b) => a + b, 0) : 0;
      footprint[cert] = {
        branchesByMetro: branches.byCert.get(cert) ?? {},
        sod: s ? {
          year: sod.year, depositsByMetro: s.depositsByMetro, totalDeposits: s.totalDeposits,
          metroShare: s.totalDeposits ? Math.round((metroDeposits / s.totalDeposits) * 1e6) / 1e6 : null,
          _source: sourceBlock({ source: 'fdic', endpoint: '/sod', query: { filters: `YEAR:${sod.year} AND CERT:${cert}` }, recordId: `${sod.year}_${cert}`, period: String(sod.year), fetchedAt, runId: run.runId }),
        } : null,
        _source: sourceBlock({ source: 'fdic', endpoint: '/locations', query: { filters: branches.filters }, recordId: cert, period: asOf, fetchedAt, runId: run.runId }),
      };
      assertSourced(footprint[cert]);
      if (footprint[cert].sod) assertSourced(footprint[cert].sod);
    }

    const finByCert = new Map();
    for (const row of fin.rows) {
      const cert = String(row.CERT), repdte = String(row.REPDTE);
      if (!uni.has(cert)) continue;
      if (!finByCert.has(cert)) finByCert.set(cert, {});
      const rec = { ...Object.fromEntries(FDIC_FIELDS.financials.filter((f) => f in row).map((f) => [f, row[f]])), CERT: cert, REPDTE: repdte,
        _source: sourceBlock({ source: 'fdic', endpoint: '/financials', query: { filters: `CERT:${cert} AND REPDTE:${repdte}` }, recordId: row.ID ?? `${cert}_${repdte}`, period: repdte, fetchedAt, runId: run.runId }) };
      finByCert.get(cert)[repdte] = rec;
    }
    const finFiles = [];
    for (const [cert, qs] of finByCert) {
      const existing = readJson(paths.financials(cert), { CERT: cert, quarters: {} });
      const next = { CERT: cert, quarters: { ...existing.quarters } };
      for (const [repdte, rec] of Object.entries(qs)) {
        const u = upsertWithChanges(existing.quarters?.[repdte], rec, { key: `fdic:${cert}:${repdte}`, runId: run.runId, dir, now });
        next.quarters[repdte] = u.record; changed += u.changed; rowsWritten++;
      }
      finFiles.push([cert, next]);
    }

    // 3. Write. Atomic per file (store.writeJson).
    for (const r of Object.values(nextInst)) assertSourced(r);
    writeJson(paths.institutions, nextInst);
    writeJson(paths.footprint, footprint); rowsWritten += Object.keys(footprint).length;
    for (const [cert, data] of finFiles) writeJson(paths.financials(cert), data);
    writeJson(paths.state, { latestRepdte: quarter.latestRepdte, previousRepdte: quarter.previous, checkedAt: fetchedAt, sodYear: sod.year, runId: run.runId });

    const line = finishRun(dir, run, { rowsRead, rowsWritten, rowsChanged: changed, outcome: 'ok', suspect, notes, nullCounts, now: clock() });
    return { runId: run.runId, outcome: line.outcome, banks: universe.length, latestRepdte: quarter.latestRepdte, newQuarter: quarter.newQuarter, quarters: fin.quarters, sodYear: sod.year, missingFields: [], changed, rowsRead, rowsWritten, nullCounts, flagged, notes };
  } catch (e) {
    return fail([e.message]);
  }
}
