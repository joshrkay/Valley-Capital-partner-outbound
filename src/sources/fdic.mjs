// FDIC BankFind adapter (PRD E2-S2, E3-S1, E3-S2). Public data, no key. Field names, query syntax and quirks were verified
// against FDIC's own definition files and live queries on 2026-11-13 (PRD Appendix A). Three quirks shape this file:
//   1. A list filter must be `FIELD:("A" OR "B")`. The comma form `FIELD:(A,B)` returns zero rows with no error.
//   2. A field name the API does not recognize is dropped silently, so every step checks that each requested field came back.
//   3. Charge-off fields without a Q suffix are year-to-date; only the quarterly (Q) versions are requested.
// A run fetches everything first, checks it, and only then writes. A failed check writes nothing but the run log line.
// The same run also records failures (PRD E3-S5), structure events (E3-S6) and the fields of the concentration screen (E3-S7).
import { join } from 'node:path';
import { readJson, writeJson, readText, appendJsonl } from '../store.mjs';
import { getJson, pacer, realSleep } from './http.mjs';
import { startRun, finishRun, sourceBlock, assertSourced, upsertWithChanges, CHANGES, scrub } from './runlog.mjs';

export const FDIC_BASE = 'https://api.fdic.gov/banks';
// When a bank fails, the FDIC sells its loans. This page is shown as a link only; it is never fetched or scraped.
export const FDIC_LOAN_SALES_URL = 'https://www.fdic.gov/resources/resolutions/asset-sales/loan-sales';
// Structure events and failures are re-read over this many months on every run. Stored events are kept after they age out.
export const STRUCTURE_LOOKBACK_MONTHS = 36;

export const FDIC_FIELDS = Object.freeze({
  // INACTIVE and ENDEFYMD were present on every row in live checks (52 open banks, 1,210 closed ones; 2026-11-13). ENDEFYMD is
  // "12/31/9999" for an open bank and the day it became inactive for a closed one.
  institutions: ['CERT', 'NAME', 'CITY', 'STALP', 'ASSET', 'WEBADDR', 'ACTIVE', 'INACTIVE', 'ENDEFYMD'],
  // Branch rows: STALP here is the BRANCH's state in live data (despite its definition), so it is not requested; HQ state comes from /institutions.
  locations: ['CERT', 'CBSA_NO', 'CBSA', 'COUNTY', 'STCNTY', 'MAINOFF'],
  // DEPSUMBR is the branch's own deposits. DEPSUM, the bank's total, is carried only on the main-office row (see pullSod).
  sod: ['CERT', 'YEAR', 'DEPSUMBR', 'DEPSUM', 'STCNTYBR', 'MSABR', 'CNTYNAMB', 'STALPBR'],
  failures: ['CERT', 'NAME', 'FAILDATE', 'RESTYPE'],
  // Closed charters: how and when each ended. CHANGEC1 is FDIC's code for the structure event that closed the record, from the same
  // code list as /history (211 = "Failure - Whole Institution"). STCNTY is the main office's state and county FIPS code; it was on all
  // 447 charters closed since November 2023, while CBSA_NO was absent on 97 of them, so placement uses the county.
  closed: ['CERT', 'NAME', 'CITY', 'STALP', 'ACTIVE', 'INACTIVE', 'ENDEFYMD', 'CHANGEC1', 'STCNTY'],
  // One row per deal on the leaving bank's side. The keys present vary by event: see checkHistoryRows.
  history: ['TRANSNUM', 'CHANGECODE', 'EFFDATE', 'OUT_CERT', 'ACQ_CERT', 'CERT'],
  // A deal's branch records (code 713, "Branch Acquired in Merger/Consolidation/Failure"): CERT is the bank that took the branch;
  // OFF_PSTNUM and OFF_CNTYNUM are the branch's state and county FIPS codes. All four were on every row checked live.
  historyBranches: ['TRANSNUM', 'CERT', 'OFF_PSTNUM', 'OFF_CNTYNUM'],
  financials: [
    'CERT', 'REPDTE', 'ASSET', 'CB', 'LNLSNET', 'NCLNLS', 'NALNLS', 'P3ASSET', 'P9ASSET',
    'LNRECONS', 'LNRENRES', 'LNRENROW', 'LNRENROT', 'LNREMULT',
    'NCRECONS', 'NCRENRES', 'NCRENROW', 'NCRENROT', 'NCREMULT',
    'NARECONS', 'NARENRES', 'NAREMULT',
    'P3RENRES', 'P3REMULT', 'P9RENRES', 'P9REMULT',
    'ORE', 'ORECONS', 'ORENRES', 'OREMULT',
    'NTLNLSQ', 'NTRECONQ', 'NTRENRSQ', 'NTREMULQ',
    // The concentration screen (PRD E3-S7; meanings from FDIC's "All Financial Reports" definitions, checked live on 268 banks):
    // LNCOMRE = CRE loans not secured by real estate; RBC = total risk-based capital; RBCT1J = tier 1 capital;
    // LNATRES = the allowance for credit losses on loans and leases; CBLRIND = 1 when the bank uses the community bank leverage ratio.
    'LNCOMRE', 'RBC', 'RBCT1J', 'LNATRES', 'CBLRIND',
  ],
  // The CRE balance 12 quarters before the latest, for the screen's 36-month growth test: one extra quarter, not a wider pull.
  growthBase: ['CERT', 'REPDTE', 'LNRECONS', 'LNREMULT', 'LNRENROT', 'LNCOMRE'],
  // A gone bank's CRE book at its last report: the target of an acquisition, or a failed bank.
  lastCre: ['CERT', 'REPDTE', 'LNRECONS', 'LNREMULT', 'LNRENRES'],
});

// FDIC's structure-event codes used here, with FDIC's own descriptions (read live from /history, 2026-11-13). A code is on the leaving
// bank's row; the acquirer's side of a merger is a separate row (810), which is not requested. Checked against /failures on 111 closed
// banks: 211, 215 and 230 were always FAILURE there; 217 and 235 mostly; 213 (assisted merger) mostly ASSISTANCE, so it is not a failure.
export const STRUCTURE_CODES = Object.freeze({
  211: { kind: 'failure', label: 'Failure - Whole Institution' },
  213: { kind: 'assisted-merger', label: 'Merger - Assisted' },
  215: { kind: 'failure', label: 'Failure Multiple Acquirer' },
  216: { kind: 'failure', label: 'Bridge Bank Resolution' },
  217: { kind: 'failure', label: 'Passthrough Receivership/Conservatorship Resolution' },
  221: { kind: 'merger', label: 'Absorption - Without Assistance' },
  222: { kind: 'merger', label: 'Consolidated - Without Assistance' },
  223: { kind: 'merger', label: 'Merger - Without Assistance' },
  224: { kind: 'affiliate-reorganization', label: 'Affiliated Institution Merger (Pooling), i.e. Corporate Reorganization' },
  230: { kind: 'failure', label: 'Closing - Failure Payoff' },
  235: { kind: 'failure', label: 'RTC Supervised Payoffs, Liquidations, and Closings' },
});
export const FAILURE_CODES = Object.freeze(Object.keys(STRUCTURE_CODES).filter((c) => STRUCTURE_CODES[c].kind === 'failure').map(Number));
const ACQUIRER_REQUIRED = Object.keys(STRUCTURE_CODES).filter((c) => STRUCTURE_CODES[c].kind !== 'failure').map(Number);

// Year-to-date flow fields. Comparing them quarter to quarter is wrong, so they are never requested.
export const YTD_FLOW_FIELDS = Object.freeze(['NTLNLS', 'NTRECONS', 'NTRENRES', 'NTREMULT']);
if (FDIC_FIELDS.financials.some((f) => YTD_FLOW_FIELDS.includes(f))) throw new Error('A year-to-date flow field is in the financials field list; use the quarterly (Q) version.');

export const fdicPaths = (dir) => {
  const base = join(dir, 'sources', 'fdic');
  return { base, state: join(base, 'state.json'), institutions: join(base, 'institutions.json'), footprint: join(base, 'footprint.json'), financials: (cert) => join(base, 'financials', `${cert}.json`),
    failed: join(base, 'failed.json'), events: join(base, 'events.json'), failedBanksCsv: join(base, 'failed-banks.csv') };
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
  let total = 0, offset = 0, pages = 0, index = null;
  for (;;) {
    await http.pace?.();
    const body = await getJson(`${FDIC_BASE}/${endpoint}`, { filters, fields: fields?.join(','), sort_by: sortBy, sort_order: sortOrder, limit, offset }, http);
    pages++;
    if (!body || !Array.isArray(body.data) || typeof body.meta?.total !== 'number') throw new Error(`Unexpected response shape from FDIC /${endpoint}.`);
    total = body.meta.total;
    // FDIC names the search index behind each endpoint and when it was built. /failures was built 2026-08-25 and had not been rebuilt by
    // 2026-11-13, while /institutions and /history are rebuilt daily (all three checked live), so the date is kept for the run notes.
    index = body.meta.index?.createTimestamp ? { name: String(body.meta.index.name ?? ''), builtAt: String(body.meta.index.createTimestamp) } : index;
    const page = body.data.map((d) => d?.data ?? {});
    rows.push(...page);
    offset += page.length;
    if (!page.length || offset >= total || rows.length >= maxRows) break;
    if (pages > Math.ceil(total / limit) + 1) break;   // never loop forever on a misbehaving server
  }
  const expected = Math.min(total, maxRows);
  return { rows: rows.slice(0, maxRows === Infinity ? rows.length : maxRows), total, mismatch: rows.length < expected, pages, index };
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
  // Verified live 2026-11-13: CHANGEC1 was absent on 19 of 447 charters closed since November 2023. Their /history held no closing event
  // of a kind FDIC lists in CHANGEC1, so none of them is a failure. It is present on every failure, which is what this pull looks for.
  'institutions-closed': ['CHANGEC1'],
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

// /history leaves out, rather than nulls, the keys an event does not have. Verified live 2026-11-13 on 397 deals since October 2023 and
// older samples: a failure (211) or affiliate merger (224) row has no CERT; a payoff (230) has no OUT_CERT or ACQ_CERT; a merger row has
// all three. So the check is per event: every row needs TRANSNUM, CHANGECODE and EFFDATE, and the bank that left (OUT_CERT, or CERT
// when OUT_CERT is absent); a merger row also needs ACQ_CERT. Same result shape as checkFields.
export function checkHistoryRows(rows) {
  const lacking = { TRANSNUM: 0, CHANGECODE: 0, EFFDATE: 0, 'OUT_CERT or CERT': 0, 'ACQ_CERT (merger rows)': 0 };
  const has = (r, f) => Object.prototype.hasOwnProperty.call(r, f) && r[f] !== null;
  let mergers = 0;
  for (const r of rows) {
    for (const f of ['TRANSNUM', 'CHANGECODE', 'EFFDATE']) if (!has(r, f)) lacking[f]++;
    if (!has(r, 'OUT_CERT') && !has(r, 'CERT')) lacking['OUT_CERT or CERT']++;
    if (ACQUIRER_REQUIRED.includes(Number(r.CHANGECODE))) { mergers++; if (!has(r, 'ACQ_CERT')) lacking['ACQ_CERT (merger rows)']++; }
  }
  const missing = Object.entries(lacking).filter(([, n]) => n > 0).map(([field, n]) => ({ field, rowsLacking: n, rows: field.startsWith('ACQ_CERT') ? mergers : rows.length }));
  return { missing, nulls: {}, absentOptional: {} };
}

// Runs a filter over many values in chunks (long OR lists make long URLs) and concatenates the results.
async function collect({ endpoint, values, filtersFor, chunkSize = 50, fields, sortBy, sortOrder, pageSize, http }) {
  const out = { rows: [], total: 0, mismatch: false, index: null };
  for (const part of chunk(values, chunkSize)) {
    const r = await fdicQuery({ endpoint, filters: filtersFor(part), fields, sortBy, sortOrder, limit: pageSize, http });
    out.rows.push(...r.rows); out.total += r.total; out.mismatch ||= r.mismatch; out.index = r.index ?? out.index;
  }
  return out;
}
const none = () => ({ rows: [], total: 0, mismatch: false, index: null });

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

// ---- Failures and structure events (PRD E3-S5, E3-S6) ---------------------------------------------------------------------------
// A failed bank has already left /locations, so it is never in the bank list built from branches. Failures are therefore found
// nationwide, since `since`, from three FDIC sources, then placed in the metros. Date ranges take ISO dates on all three endpoints,
// although FAILDATE and ENDEFYMD come back as M/D/YYYY (checked live).
export async function pullRecentFailures({ since, http, pageSize }) {
  const filters = `FAILDATE:[${since} TO *]`;
  return { ...(await fdicQuery({ endpoint: 'failures', filters, fields: FDIC_FIELDS.failures, limit: pageSize, http })), filters };
}

export async function pullHistory({ since, http, pageSize }) {
  const filters = `${orFilter('CHANGECODE', Object.keys(STRUCTURE_CODES))} AND EFFDATE:[${since} TO *]`;
  return { ...(await fdicQuery({ endpoint: 'history', filters, fields: FDIC_FIELDS.history, limit: pageSize, http })), filters };
}

// Closed charters: every failure FDIC's /institutions shows since `since` (found by its closing code), plus the given certs if closed.
export async function pullClosed({ certs, since, http, pageSize, chunkSize }) {
  const discovery = `ACTIVE:0 AND ${orFilter('CHANGEC1', FAILURE_CODES)} AND ENDEFYMD:[${since} TO *]`;
  const d = await fdicQuery({ endpoint: 'institutions', filters: discovery, fields: FDIC_FIELDS.closed, limit: pageSize, http });
  const k = certs.length ? await collect({ endpoint: 'institutions', values: certs, filtersFor: (p) => `${orFilter('CERT', p)} AND ACTIVE:0`, chunkSize, fields: FDIC_FIELDS.closed, pageSize, http }) : none();
  const byCert = new Map([...d.rows, ...k.rows].map((r) => [String(r.CERT), r]));
  return { rows: [...d.rows, ...k.rows], byCert, total: d.total + k.total, mismatch: d.mismatch || k.mismatch, index: d.index, discovery };
}

export async function pullHistoryBranches({ transnums, http, pageSize, chunkSize }) {
  if (!transnums.length) return none();
  return collect({ endpoint: 'history', values: transnums, filtersFor: (p) => `CHANGECODE:713 AND ${orFilter('TRANSNUM', p)}`, chunkSize, fields: FDIC_FIELDS.historyBranches, pageSize, http });
}

export async function pullGrowthBase({ certs, repdte, http, pageSize, chunkSize }) {
  if (!certs.length) return none();
  return collect({ endpoint: 'financials', values: certs, filtersFor: (p) => `${orFilter('CERT', p)} AND REPDTE:${repdte}`, chunkSize, fields: FDIC_FIELDS.growthBase, pageSize, http });
}

export async function pullLastCre({ certs, from, to, http, pageSize, chunkSize }) {
  if (!certs.length) return none();
  return collect({ endpoint: 'financials', values: certs, filtersFor: (p) => `${orFilter('CERT', p)} AND REPDTE:[${from} TO ${to}]`, chunkSize, fields: FDIC_FIELDS.lastCre, pageSize, http });
}

const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const ymdOf = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const validYmd = (s) => { const t = Date.parse(`${s}T00:00:00Z`); return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s ? s : null; };
// FDIC dates: M/D/YYYY (FAILDATE, ENDEFYMD), YYYY-MM-DDT00:00:00 (EFFDATE), and the CSV's forms. "12/31/9999" means "still open".
export function isoDate(v) {
  const s = String(v ?? '').trim();
  let m;
  if ((m = /^(\d{4})-(\d{2})-(\d{2})(?:T[\d:.]+Z?)?$/.exec(s))) return s.startsWith('9999') ? null : validYmd(ymdOf(m[1], m[2], m[3]));
  if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s))) return m[3] === '9999' ? null : validYmd(ymdOf(m[3], m[1], m[2]));
  if ((m = /^(\d{1,2})-([A-Za-z]{3})-(\d{2}|\d{4})$/.exec(s)) && MON[m[2].toLowerCase()]) return validYmd(ymdOf(m[3].length === 2 ? `20${m[3]}` : m[3], MON[m[2].toLowerCase()], m[1]));
  if ((m = /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/.exec(s)) && MON[m[1].slice(0, 3).toLowerCase()]) return validYmd(ymdOf(m[3], MON[m[1].slice(0, 3).toLowerCase()], m[2]));
  return null;
}
export function monthsBefore(ymd, months) {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 - months, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return ymdOf(t.getUTCFullYear(), t.getUTCMonth() + 1, Math.min(d, last));
}

// FDIC's failed-bank list, as a CSV a person saves to the data folder (sources/fdic/failed-banks.csv). It is optional: www.fdic.gov is
// blocked from the development environment, so the file is read when present and never fetched.
// UNCONFIRMED: these column names are FDIC's documented ones as remembered (https://www.fdic.gov/bank-failures/download-data.csv);
// they were NOT checked against the live file. Headers are compared ignoring case and spacing only. Any expected header that is not
// there fails the run loudly and writes nothing, so a renamed column cannot quietly drop a failure.
export const FAILED_BANK_CSV_COLUMNS = Object.freeze({ name: 'Bank Name', city: 'City', state: 'State', cert: 'Cert', acquirer: 'Acquiring Institution', closed: 'Closing Date' });

export function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  const s = String(text ?? '').replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; continue; }
    if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

const normHeader = (h) => String(h ?? '').replace(/[\s ]+/g, ' ').trim().toLowerCase();

// Returns { rows: [{ cert, name, city, state, acquirer, closed }], missing: [{ field, rowsLacking, rows }], headers }.
export function parseFailedBankCsv(text) {
  const [head = [], ...body] = parseCsv(text);
  const headers = head.map((h) => String(h).replace(/[\s ]+/g, ' ').trim());
  const at = Object.fromEntries(Object.entries(FAILED_BANK_CSV_COLUMNS).map(([k, col]) => [k, head.map(normHeader).indexOf(normHeader(col))]));
  const missing = Object.entries(at).filter(([, i]) => i < 0).map(([k]) => ({ field: FAILED_BANK_CSV_COLUMNS[k], rowsLacking: body.length, rows: body.length, header: true }));
  if (missing.length) return { rows: [], missing, headers };
  let noCert = 0, noDate = 0;
  const rows = [];
  for (const r of body) {
    const cert = String(r[at.cert] ?? '').trim();
    const closed = isoDate(r[at.closed]);
    if (!/^\d+$/.test(cert)) { noCert++; continue; }
    if (!closed) { noDate++; continue; }
    rows.push({ cert, closed, name: String(r[at.name] ?? '').trim(), city: String(r[at.city] ?? '').trim(), state: String(r[at.state] ?? '').trim(), acquirer: String(r[at.acquirer] ?? '').trim() });
  }
  if (noCert) missing.push({ field: `${FAILED_BANK_CSV_COLUMNS.cert} (a number)`, rowsLacking: noCert, rows: body.length });
  if (noDate) missing.push({ field: `${FAILED_BANK_CSV_COLUMNS.closed} (a date)`, rowsLacking: noDate, rows: body.length });
  return { rows, missing, headers };
}

// Places a bank that is gone (failed, or acquired) in the metros, from what is known: its branches in our last footprint, the
// branches FDIC lists in the deal that ended it, and its main office's county. Each metro says which of these placed it.
export function placeInMetros({ metros, hqCounty, lastFootprint, branchRows = [], previous = [] }) {
  const list = metroList(metros);
  const codes = new Set(list.map((m) => String(m.cbsa)));
  const cmap = new Map();
  for (const m of list) for (const c of Object.keys(m.counties ?? {})) cmap.set(pad5(c), String(m.cbsa));
  const out = new Map();
  const add = (cbsa, basis, n) => {
    if (!out.has(cbsa)) out.set(cbsa, { cbsa, branches: null, basis: [] });
    const e = out.get(cbsa);
    if (!e.basis.includes(basis)) e.basis.push(basis);
    if (Number.isFinite(n)) e.branches = Math.max(e.branches ?? 0, n);
  };
  for (const p of previous) for (const b of p.basis ?? []) add(String(p.cbsa), b, p.branches ?? undefined);
  for (const [c, n] of Object.entries(lastFootprint?.branchesByMetro ?? {})) if (codes.has(String(c)) && Number(n) > 0) add(String(c), 'branches in our last footprint', Number(n));
  const counted = {};
  for (const b of branchRows) {
    if (b.OFF_PSTNUM === undefined || b.OFF_PSTNUM === null || b.OFF_CNTYNUM === undefined || b.OFF_CNTYNUM === null) continue;
    const c = cmap.get(`${String(b.OFF_PSTNUM).padStart(2, '0')}${String(b.OFF_CNTYNUM).padStart(3, '0')}`);
    if (c) counted[c] = (counted[c] ?? 0) + 1;
  }
  for (const [c, n] of Object.entries(counted)) add(c, 'branches in the FDIC structure event', n);
  const hq = hqCounty !== undefined && hqCounty !== null && hqCounty !== '' ? cmap.get(pad5(hqCounty)) : null;
  if (hq) add(hq, 'main office', undefined);
  return [...out.values()].sort((a, b) => (a.cbsa < b.cbsa ? -1 : a.cbsa > b.cbsa ? 1 : 0));
}

// One /history row as a deal: the bank that left (OUT_CERT, or CERT on rows without one), the acquirer if any, and the date it took effect.
export function eventOf(row) {
  const code = Number(row.CHANGECODE);
  const def = STRUCTURE_CODES[code] ?? { kind: 'other', label: `code ${code}` };
  const present = (v) => v !== undefined && v !== null && v !== '';
  return { transnum: String(row.TRANSNUM), code, kind: def.kind, label: def.label, effective: isoDate(row.EFFDATE),
    targetCert: present(row.OUT_CERT) ? String(row.OUT_CERT) : present(row.CERT) ? String(row.CERT) : null,
    acquirerCert: present(row.ACQ_CERT) && Number(row.ACQ_CERT) !== 0 ? String(row.ACQ_CERT) : null };
}

// Summary of Deposits, latest year, joined to metros by branch COUNTY (STCNTYBR, which FDIC returns as a number, so it is zero-padded)
// rather than by MSABR. MSABR disagreements are counted so a drift in FDIC's coding shows up in the run notes.
export async function pullSod({ metros, http, pageSize, chunkSize = 50 }) {
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
  }
  // DEPSUM is the bank's total deposits, but FDIC carries it ONLY on the main-office row (branch 0) and sends 0 on every other row.
  // Verified 2026-11-13: one bank's DEPSUM of 55,417 equals its two branches' DEPSUMBR, 33,198 + 22,219. A main office outside the
  // metros is not among the rows above, so reading DEPSUM from them gave 0 for most banks. The totals are fetched on their own:
  // exactly one row per bank, the one with DEPSUM above zero.
  const certs = [...byCert.keys()];
  const totals = certs.length
    ? await collect({ endpoint: 'sod', values: certs, filtersFor: (p) => `${orFilter('CERT', p)} AND YEAR:${Number(year)} AND DEPSUM:[1 TO *]`, chunkSize, fields: ['CERT', 'DEPSUM'], pageSize, http })
    : { rows: [], total: 0, mismatch: false };
  for (const row of totals.rows) { const s = byCert.get(String(row.CERT)); if (s) s.totalDeposits = Number(row.DEPSUM); }
  const noTotal = certs.filter((c) => !byCert.get(c).totalDeposits).length;
  // FDIC's branch figures can sum to $1,000 more than its own total (rounding; seen on 3 banks on 2026-11-13). Within 0.1% is rounding;
  // beyond that, the county join is suspect.
  const overOne = certs.filter((c) => { const s = byCert.get(c); const m = Object.values(s.depositsByMetro).reduce((a, b) => a + b, 0); return s.totalDeposits && m > s.totalDeposits * 1.001; }).length;
  return { ...r, year: Number(year), byCert, msaMismatches, filters, totals, noTotal, overOne, rowsRead: r.rows.length + latest.rows.length };
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
const byNum = (a, b) => Number(a) - Number(b);
// /failures also lists open-bank ASSISTANCE (for example 2008-09 assistance to banks that are open today). Only a FAILURE record marks a
// bank failed; assistance is kept as context. Verified live 2026-11-13: 593 assistance records exist.
const isFailure = (f) => String(f.RESTYPE ?? '').toUpperCase() === 'FAILURE';
const FAILURE_SOURCES = ['failures', 'institutions', 'history'];

// Does the whole FDIC step: bank list, institution details, failures, structure events, footprint, financials. Writes the PRD Appendix C
// files plus failed.json and events.json, and one run-log line, and returns a summary. Never throws for a data problem: a failed run
// returns outcome "failed" with the reason.
export async function runFdic({ dir, metros, includeHq = false, fetchImpl = globalThis.fetch, now = new Date(), quarters = 8, pageSize = 10000, chunkSize = 50, sleep = realSleep, minIntervalMs = 200, retries = 3, timeoutMs = 60000, clock = () => new Date(), lookbackMonths = STRUCTURE_LOOKBACK_MONTHS }) {
  const list = metroList(metros);
  if (!list.length) throw new Error('runFdic: no metros given (pass metros.json).');
  const hqStates = includeHq ? (metros?.hqStates ?? []) : [];
  const query = { metros: list.map((m) => String(m.cbsa)).sort(), hqStates, quarters };
  const run = startRun({ source: 'fdic', query, now });
  const http = { fetchImpl, sleep, retries, timeoutMs, pace: pacer(minIntervalMs, { sleep }) };
  const fetchedAt = now.toISOString();
  const asOf = fetchedAt.slice(0, 10);
  const since = monthsBefore(asOf, lookbackMonths);
  const paths = fdicPaths(dir);

  let rowsRead = 0, suspect = false;
  const missing = [], notes = [], nullCounts = {};
  const missingNames = () => missing.map((m) => `${m.step}.${m.field}`);
  const take = (step, res, fields, check) => {
    rowsRead += res.rowsRead ?? res.rows.length;
    if (res.mismatch) { suspect = true; notes.push(`${step}: received ${res.rows.length} rows of ${res.total} reported`); }
    if (fields || check) {
      const c = check ? check(res.rows) : checkFields(res.rows, fields, { optional: OPTIONAL_KEYS[step] ?? [] });
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
    const L = quarter.latestRepdte;
    const branches = take('locations', await pullBranches({ metros: list, http, pageSize }), FDIC_FIELDS.locations);
    const hq = includeHq ? take('institutions-hq', await pullHqCerts({ states: hqStates, http, pageSize }), ['CERT']) : { certs: new Set() };
    const universe = [...new Set([...branches.byCert.keys(), ...hq.certs])].sort(byNum);
    if (!universe.length) {
      notes.push('No banks matched the metro filter. The filter syntax or the metro codes may be wrong; nothing was written.');
      const line = finishRun(dir, run, { rowsRead, outcome: 'ok', suspect: true, notes, now: clock() });
      return { runId: run.runId, outcome: line.outcome, banks: 0, latestRepdte: L, newQuarter: false, missingFields: [], changed: 0, rowsRead, rowsWritten: 0, notes };
    }
    const existingInst = readJson(paths.institutions, {});
    const existingFootprint = readJson(paths.footprint, {});   // where a bank that has gone had branches, as of the last run
    const existingFailed = readJson(paths.failed, {});
    const existingEvents = readJson(paths.events, {});
    const known = Object.keys(existingInst);
    const allCerts = [...new Set([...universe, ...known])].sort(byNum);
    const uni = new Set(universe), knownSet = new Set(allCerts);
    const inst = take('institutions', await pullInstitutions({ certs: allCerts, http, pageSize, chunkSize }), FDIC_FIELDS.institutions);
    const fails = take('failures', await pullFailures({ certs: allCerts, http, pageSize, chunkSize }), FDIC_FIELDS.failures);
    const recentFails = take('failures-recent', await pullRecentFailures({ since, http, pageSize }), FDIC_FIELDS.failures);
    const hist = take('history', await pullHistory({ since, http, pageSize }), null, checkHistoryRows);

    // FDIC's failed-bank CSV, when a person has saved one to the data folder. Its column names are unconfirmed, so a header that is not
    // there stops the run here, naming what was found.
    const csvText = readText(paths.failedBanksCsv, null);
    const csv = csvText === null ? null : parseFailedBankCsv(csvText);
    if (csv) {
      rowsRead += csv.rows.length;
      for (const m of csv.missing) missing.push({ step: 'failed-banks-csv', ...m });
      const absent = csv.missing.filter((m) => m.header).map((m) => m.field);
      if (absent.length) return fail([`The failed-bank CSV (sources/fdic/failed-banks.csv) has no column ${absent.map((a) => `"${a}"`).join(', ')}. Its headers are: ${csv.headers.map((h) => `"${h}"`).join(', ')}. The expected names are unconfirmed (FAILED_BANK_CSV_COLUMNS in src/sources/fdic.mjs); check them against the file. Nothing was written.`]);
    }

    const events = hist.rows.map(eventOf).filter((e) => e.targetCert && e.effective);
    // The deals that matter: a bank on our list on either side. Failures matter wherever they happened, until placed below.
    const deals = events.filter((e) => (e.acquirerCert && uni.has(e.acquirerCert)) || knownSet.has(e.targetCert));
    const failureEvents = events.filter((e) => e.kind === 'failure');
    const csvRecent = (csv?.rows ?? []).filter((r) => r.closed >= since || knownSet.has(r.cert));
    const instRows = new Map(inst.rows.map((r) => [String(r.CERT), r]));
    const failCandidates = [...failureEvents.map((e) => e.targetCert), ...recentFails.rows.filter(isFailure).map((f) => String(f.CERT)), ...csvRecent.map((r) => r.cert)];
    const closedCerts = [...new Set([...allCerts.filter((c) => instRows.has(c) && Number(instRows.get(c).ACTIVE) !== 1), ...deals.map((e) => e.targetCert), ...failCandidates])].sort(byNum);
    const closed = take('institutions-closed', await pullClosed({ certs: closedCerts, since, http, pageSize, chunkSize }), FDIC_FIELDS.closed);

    // A bank counts as failed if any source says so. Each source's own date and code are kept, so the record shows which ones agree.
    const failSrc = new Map();
    const say = (cert, src, v) => { if (!failSrc.has(cert)) failSrc.set(cert, {}); const s = failSrc.get(cert); if (!s[src]) s[src] = v; };
    for (const f of [...fails.rows, ...recentFails.rows]) if (isFailure(f)) say(String(f.CERT), 'failures', { on: isoDate(f.FAILDATE) ?? parseFailDate(f.FAILDATE), restype: 'FAILURE' });
    for (const r of closed.rows) { const code = Number(r.CHANGEC1); if (FAILURE_CODES.includes(code)) say(String(r.CERT), 'institutions', { on: isoDate(r.ENDEFYMD), code, label: STRUCTURE_CODES[code].label }); }
    for (const e of failureEvents) say(e.targetCert, 'history', { on: e.effective, code: e.code, label: e.label, transnum: e.transnum, acquirerCert: e.acquirerCert });
    for (const r of csvRecent) say(r.cert, 'csv', { on: r.closed, acquirer: r.acquirer || null });

    // Each deal's branch records place the bank that left it: wanted for every failure and every deal on our list.
    const placeDeals = [...new Map([...deals, ...failureEvents].map((e) => [e.transnum, e])).values()];
    const hbr = take('history-branches', await pullHistoryBranches({ transnums: placeDeals.map((e) => e.transnum).sort(byNum), http, pageSize, chunkSize }), FDIC_FIELDS.historyBranches);
    const branchesOf = new Map();
    for (const b of hbr.rows) { const t = String(b.TRANSNUM); if (!branchesOf.has(t)) branchesOf.set(t, []); branchesOf.get(t).push(b); }
    const failureDeal = new Map(failureEvents.map((e) => [e.targetCert, e]));
    const place = (cert, transnum, previous) => placeInMetros({ metros: list, hqCounty: closed.byCert.get(cert)?.STCNTY, lastFootprint: existingFootprint[cert], branchRows: transnum ? branchesOf.get(transnum) ?? [] : [], previous: previous ?? [] });
    const failedMetros = new Map([...failSrc.keys()].map((c) => [c, place(c, failureDeal.get(c)?.transnum, existingFailed[c]?.metros)]));
    const dealMetros = new Map(deals.map((e) => [e.transnum, place(e.targetCert, e.transnum, existingEvents[e.transnum]?.targetMetros)]));

    const sod = take('sod', await pullSod({ metros: list, http, pageSize, chunkSize }), FDIC_FIELDS.sod);
    if (sod.totals) take('sod-totals', sod.totals, ['CERT', 'DEPSUM']);
    if (sod.noTotal) notes.push(`sod: ${sod.noTotal} bank(s) with metro deposits but no main-office total in SOD ${sod.year}; their deposit share is unknown`);
    if (sod.overOne) { suspect = true; notes.push(`sod: ${sod.overOne} bank(s) with more deposits in the metros than in total; check the county join`); }
    const fin = take('financials', await pullFinancials({ certs: universe, latestRepdte: L, quarters, http, pageSize, chunkSize }), FDIC_FIELDS.financials);
    if (sod.msaMismatches) notes.push(`sod: ${sod.msaMismatches} branch rows had an MSA code different from their county's metro; county was used.`);
    // The concentration screen's 36-month growth test needs the CRE balance 12 quarters before the latest: one more quarter, not a wider pull.
    const baseRep = quartersBack(L, 13)[0];
    const base = quarters > 12 ? none() : take('financials-base', await pullGrowthBase({ certs: universe, repdte: baseRep, http, pageSize, chunkSize }), FDIC_FIELDS.growthBase);
    // The CRE book of a bank that is gone, at its last report: the target of an acquisition by a bank on our list, or a failed bank in the metros.
    const creCerts = [...new Set([...deals.filter((e) => e.acquirerCert && uni.has(e.acquirerCert)).map((e) => e.targetCert), ...[...failedMetros].filter(([, m]) => m.length).map(([c]) => c)])].sort(byNum);
    const lastCre = take('financials-last-cre', await pullLastCre({ certs: creCerts, from: baseRep, to: L, http, pageSize, chunkSize }), FDIC_FIELDS.lastCre);
    if (missing.length) return fail([`FDIC did not return requested field(s): ${missing.map((m) => `${m.step}.${m.field} (absent from ${m.rowsLacking} of ${m.rows} rows)`).join(', ')}. A field name may have changed; nothing was written.`]);

    // 2. Build records. Every record carries its source; assertSourced runs on each before anything is written.
    let changed = 0, rowsWritten = 0;
    const logChange = (key, field, value) => { appendJsonl(CHANGES(dir), scrub({ runId: run.runId, key, field, old: null, new: value, at: now.toISOString() })); changed++; };
    const failedBy = new Map([...failSrc].map(([c, s]) => [c, s.history?.on ?? s.institutions?.on ?? s.failures?.on ?? s.csv?.on ?? null]));
    const assistedBy = new Map(fails.rows.filter((f) => !isFailure(f)).map((f) => [String(f.CERT), parseFailDate(f.FAILDATE)]));
    const acquiredOf = new Map(deals.filter((e) => e.kind !== 'failure').map((e) => [e.targetCert, e]));
    const flagged = { failed: [], inactive: [], left: [], acquired: [] };
    const nextInst = { ...existingInst };
    for (const cert of allCerts) {
      const row = instRows.get(cert);
      const prev = existingInst[cert];
      if (!row && !prev) continue;
      const status = failSrc.has(cert) ? 'failed' : row ? (Number(row.ACTIVE) === 1 ? 'active' : 'inactive') : prev.status;
      const inUniverse = uni.has(cert);
      const c = closed.byCert.get(cert);
      const acq = acquiredOf.get(cert);
      const code = c && c.CHANGEC1 !== undefined && c.CHANGEC1 !== null ? Number(c.CHANGEC1) : null;
      const rec = {
        ...(row ? Object.fromEntries(FDIC_FIELDS.institutions.map((f) => [f, f === 'CERT' ? cert : row[f] ?? null])) : {}),
        via: { branch: branches.byCert.has(cert), hq: hq.certs.has(cert) }, inUniverse, status,
        ...(failSrc.has(cert) ? { failedOn: failedBy.get(cert), failedSources: Object.keys(failSrc.get(cert)).sort() } : {}),
        ...(assistedBy.has(cert) ? { assistanceOn: assistedBy.get(cert) } : {}),
        ...(c ? { closedOn: isoDate(c.ENDEFYMD), endedBy: code === null ? null : { code, label: STRUCTURE_CODES[code]?.label ?? null } } : {}),
        ...(acq ? { acquiredBy: { cert: acq.acquirerCert, on: acq.effective, transnum: acq.transnum, code: acq.code } } : {}),
        ...(prev?.inUniverse && !inUniverse ? { leftOn: asOf } : {}),
        _source: sourceBlock({ source: 'fdic', endpoint: '/institutions', query: { filters: `CERT:${cert}` }, recordId: row?.ID ?? cert, period: asOf, fetchedAt, runId: run.runId }),
      };
      if (status === 'failed') flagged.failed.push(cert); else if (status === 'inactive') flagged.inactive.push(cert);
      if (prev?.inUniverse && !inUniverse) flagged.left.push(cert);
      if (acq) flagged.acquired.push(cert);
      // Being acquired means the bank is gone. Its status change is logged by the update below; the acquirer is logged here, once.
      if (acq && prev && !prev.acquiredBy) logChange(`fdic:${cert}`, 'acquiredBy', rec.acquiredBy);
      const u = upsertWithChanges(prev, rec, { key: `fdic:${cert}`, runId: run.runId, dir, now });
      nextInst[cert] = u.record; changed += u.changed; rowsWritten++;
    }

    const lastCreOf = (cert, before) => {
      const lim = String(before ?? asOf).replace(/-/g, '');
      const r = lastCre.rows.filter((x) => String(x.CERT) === cert && String(x.REPDTE) <= lim).sort((a, b) => (String(a.REPDTE) < String(b.REPDTE) ? 1 : -1))[0];
      if (!r) return null;
      const fields = Object.fromEntries(['LNRECONS', 'LNREMULT', 'LNRENRES'].map((f) => [f, r[f] ?? null]));
      const vals = Object.values(fields);
      return { repdte: String(r.REPDTE), value: vals.some((v) => v === null) ? null : vals.reduce((s, v) => s + Number(v), 0), fields };
    };

    // Failed banks (E3-S5): a separate record, because a failed bank leaves the bank list. The FDIC is then the seller of its loans.
    const checked = [...FAILURE_SOURCES, ...(csv ? ['csv'] : [])];
    const namesOf = new Map([...(csv?.rows ?? []).map((r) => [r.cert, { NAME: r.name, CITY: r.city, STALP: r.state }]), ...fails.rows.map((f) => [String(f.CERT), { NAME: f.NAME }]), ...recentFails.rows.map((f) => [String(f.CERT), { NAME: f.NAME }]), ...closed.rows.map((r) => [String(r.CERT), r])]);
    const nextFailed = { ...existingFailed };
    const lacks = [];
    for (const [cert, s] of [...failSrc].sort(([a], [b]) => byNum(a, b))) {
      const prev = existingFailed[cert];
      const where = failedMetros.get(cert);
      const agree = checked.filter((k) => s[k]);
      const dates = [...new Set(agree.map((k) => s[k].on).filter(Boolean))].sort();
      if (!s.failures && (s.institutions || s.history)) lacks.push(cert);
      const nm = namesOf.get(cert) ?? {};
      const deal = failureDeal.get(cert);
      const rec = {
        cert, name: nm.NAME ?? null, city: nm.CITY ?? null, state: nm.STALP ?? null, failedOn: failedBy.get(cert),
        sources: Object.fromEntries(checked.map((k) => [k, s[k] ?? null])), agree, missingFrom: checked.filter((k) => !s[k]),
        ...(dates.length > 1 ? { datesDiffer: dates } : {}),
        acquirerCert: deal?.acquirerCert ?? null, transnum: deal?.transnum ?? null,
        inMetros: where.length > 0, metros: where, onOurListBefore: !!existingInst[cert],
        lastCre: where.length ? lastCreOf(cert, failedBy.get(cert)) : null,
        seller: 'FDIC', loanSales: FDIC_LOAN_SALES_URL,
        _source: sourceBlock({ source: 'fdic', endpoint: agree.map((k) => (k === 'csv' ? 'failed-bank CSV' : `/${k}`)).join(' + '), query: { filters: `CERT:${cert}` }, recordId: cert, period: failedBy.get(cert) ?? asOf, fetchedAt, runId: run.runId }),
      };
      if (!prev && !existingInst[cert]) logChange(`fdic:${cert}`, 'failed', { on: rec.failedOn, agree, inMetros: rec.inMetros });
      const u = upsertWithChanges(prev, rec, { key: `fdic-failed:${cert}`, runId: run.runId, dir, now });
      nextFailed[cert] = u.record; changed += u.changed; rowsWritten++;
    }
    const failuresIndex = { builtAt: recentFails.index?.builtAt ?? fails.index?.builtAt ?? null, lacks };
    if (lacks.length) notes.push(`failures: FDIC's /failures index (built ${failuresIndex.builtAt ?? 'unknown'}) lacks ${lacks.length} failure(s) that /institutions or /history show: cert ${lacks.join(', ')}. Failure is taken from all three sources.`);
    notes.push(csv ? `failed-bank CSV: ${csv.rows.length} rows read, newest closing ${csv.rows.map((r) => r.closed).sort().at(-1) ?? 'none'}` : 'failed-bank CSV: not provided (optional: save FDIC\'s failed-bank list as sources/fdic/failed-banks.csv in the data folder)');

    // Structure events (E3-S6): kept once seen, keyed by FDIC's transaction number. Events are never dropped when they age out.
    const nextEvents = { ...existingEvents };
    let newEvents = 0;
    for (const e of deals) {
      const prev = existingEvents[e.transnum];
      const where = dealMetros.get(e.transnum);
      const acquirerOnList = !!e.acquirerCert && uni.has(e.acquirerCert);
      const rec = {
        transnum: e.transnum, code: e.code, kind: e.kind, label: e.label, effective: e.effective,
        acquirerCert: e.acquirerCert, targetCert: e.targetCert, acquirerOnOurList: acquirerOnList, targetOnOurList: knownSet.has(e.targetCert),
        targetMetros: where, targetInMetros: where.length > 0, targetLastCre: acquirerOnList ? lastCreOf(e.targetCert, e.effective) : null,
        _source: sourceBlock({ source: 'fdic', endpoint: '/history', query: { filters: `TRANSNUM:${e.transnum}` }, recordId: e.transnum, period: e.effective, fetchedAt, runId: run.runId }),
      };
      if (!prev) {
        newEvents++;
        if (e.acquirerCert && knownSet.has(e.acquirerCert)) logChange(`fdic:${e.acquirerCert}`, 'acquired', { targetCert: e.targetCert, on: e.effective, transnum: e.transnum, code: e.code });
      }
      const u = upsertWithChanges(prev, rec, { key: `fdic-event:${e.transnum}`, runId: run.runId, dir, now });
      nextEvents[e.transnum] = u.record; changed += u.changed; rowsWritten++;
    }
    // Counts and ids only, as for every run-log line.
    notes.push(`failures: ${failSrc.size} since ${since} across ${checked.join(', ')}; ${[...failedMetros.values()].filter((m) => m.length).length} with a presence in the metros`);
    notes.push(`history: ${hist.rows.length} deals read since ${since}; ${deals.length} with a bank on our list on either side (${newEvents} new)`);

    const footprint = {};
    for (const cert of universe) {
      const s = sod.byCert.get(cert);
      const metroDeposits = s ? Object.values(s.depositsByMetro).reduce((a, b) => a + b, 0) : 0;
      footprint[cert] = {
        branchesByMetro: branches.byCert.get(cert) ?? {},
        sod: s ? {
          year: sod.year, depositsByMetro: s.depositsByMetro, totalDeposits: s.totalDeposits,
          metroShare: s.totalDeposits ? Math.min(1, Math.round((metroDeposits / s.totalDeposits) * 1e6) / 1e6) : null,   // capped: see pullSod on rounding
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
    const baseByCert = new Map(base.rows.filter((r) => uni.has(String(r.CERT))).map((r) => [String(r.CERT), r]));
    const finFiles = [];
    for (const [cert, qs] of finByCert) {
      const existing = readJson(paths.financials(cert), { CERT: cert, quarters: {} });
      const next = { CERT: cert, quarters: { ...existing.quarters }, ...(existing.growthBase ? { growthBase: { ...existing.growthBase } } : {}) };
      for (const [repdte, rec] of Object.entries(qs)) {
        const u = upsertWithChanges(existing.quarters?.[repdte], rec, { key: `fdic:${cert}:${repdte}`, runId: run.runId, dir, now });
        next.quarters[repdte] = u.record; changed += u.changed; rowsWritten++;
      }
      // Kept apart from `quarters`, so the 8-quarter metrics never see a partial quarter.
      const b = baseByCert.get(cert);
      if (b) {
        const rep = String(b.REPDTE);
        const rec = { ...Object.fromEntries(FDIC_FIELDS.growthBase.filter((f) => f in b).map((f) => [f, b[f]])), CERT: cert, REPDTE: rep,
          _source: sourceBlock({ source: 'fdic', endpoint: '/financials', query: { filters: `CERT:${cert} AND REPDTE:${rep}`, fields: FDIC_FIELDS.growthBase.join(',') }, recordId: b.ID ?? `${cert}_${rep}`, period: rep, fetchedAt, runId: run.runId }) };
        const u = upsertWithChanges(existing.growthBase?.[rep], rec, { key: `fdic:${cert}:${rep}`, runId: run.runId, dir, now });
        next.growthBase = { ...(next.growthBase ?? {}), [rep]: u.record }; changed += u.changed; rowsWritten++;
      }
      finFiles.push([cert, next]);
    }

    // 3. Write. Atomic per file (store.writeJson).
    for (const r of [...Object.values(nextInst), ...Object.values(nextFailed), ...Object.values(nextEvents)]) assertSourced(r);
    writeJson(paths.institutions, nextInst);
    writeJson(paths.footprint, footprint); rowsWritten += Object.keys(footprint).length;
    for (const [cert, data] of finFiles) writeJson(paths.financials(cert), data);
    writeJson(paths.failed, nextFailed);
    writeJson(paths.events, nextEvents);
    const failedInMetros = Object.values(nextFailed).filter((f) => f.inMetros && f.failedOn && f.failedOn >= since)
      .map((f) => ({ cert: f.cert, failedOn: f.failedOn, agree: f.agree, missingFrom: f.missingFrom, metros: f.metros.map((m) => m.cbsa), seller: f.seller, loanSales: f.loanSales }));
    writeJson(paths.state, { latestRepdte: L, previousRepdte: quarter.previous, checkedAt: fetchedAt, sodYear: sod.year, runId: run.runId,
      structureSince: since, lookbackMonths, failuresIndex: { builtAt: failuresIndex.builtAt, lacks: lacks.length }, failedInMetros: failedInMetros.length,
      structureEvents: Object.keys(nextEvents).length, growthBaseRepdte: quarters > 12 ? null : baseRep, failedBankCsv: csv ? { rows: csv.rows.length } : null });

    const line = finishRun(dir, run, { rowsRead, rowsWritten, rowsChanged: changed, outcome: 'ok', suspect, notes, nullCounts, now: clock() });
    return { runId: run.runId, outcome: line.outcome, banks: universe.length, latestRepdte: L, newQuarter: quarter.newQuarter, quarters: fin.quarters, sodYear: sod.year, missingFields: [], changed, rowsRead, rowsWritten, nullCounts, flagged,
      failedInMetros, failuresIndex, structureEvents: { read: hist.rows.length, kept: deals.length, new: newEvents }, notes };
  } catch (e) {
    return fail([e.message]);
  }
}
