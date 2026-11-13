// A fake FDIC BankFind API for tests, shared by the FDIC adapter's tests and the platform parity tests. Invented banks and numbers only.
// It mimics the real API where it matters: `FIELD:(A OR B)` lists, `[A TO B]` ranges with `*` open bounds, paging by offset, sorting,
// and silently dropping fields it does not know (verified behavior of the real API, 2026-11-13). It also mimics how a key a row does not
// have is left out, not nulled (/history and CHANGEC1), and the index each endpoint reports, with /failures built on 2026-08-25.
import { FDIC_FIELDS } from '../src/sources/fdic.mjs';

const unq = (v) => v.replace(/^"|"$/g, '');
// Dates: FDIC filters date fields with ISO dates even where it returns M/D/YYYY (FAILDATE, ENDEFYMD) or a timestamp (EFFDATE).
const asIso = (x) => { const s = unq(String(x)); const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s); return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : s; };
export function matches(row, clause) {
  const m = /^(\w+):(.*)$/.exec(clause.trim());
  if (!m) throw new Error(`fake FDIC: cannot parse ${clause}`);
  const [, field, expr] = m;
  const v = row[field];
  if (v === undefined) return false;
  if (expr.startsWith('[')) {   // ranges compare as numbers when both sides are numeric, else as dates; `*` is an open bound, as in the real API
    const [lo, hi] = expr.slice(1, -1).split(' TO ');
    const cmp = (a, b) => { if (Number.isFinite(Number(a)) && Number.isFinite(Number(b))) return Number(a) - Number(b); const x = asIso(a), y = asIso(b); return x < y ? -1 : x > y ? 1 : 0; };
    return (lo === '*' || cmp(v, lo) >= 0) && (hi === '*' || cmp(v, hi) <= 0);
  }
  if (expr.startsWith('(')) {
    if (expr.includes(',')) return false;   // the real API returns nothing for the comma form
    return expr.slice(1, -1).split(' OR ').map(unq).some((x) => String(v) === x || Number(v) === Number(x));
  }
  return String(v) === unq(expr) || Number(v) === Number(unq(expr));
}
const splitAnd = (f) => (f ? f.split(/ AND (?![^(]*\))/) : []);

export const INDEX_BUILT = { failures: '2026-08-25T14:13:18Z' };

export function fakeFdic(tables, { totalBump = 0, failWith, indexBuilt = INDEX_BUILT } = {}) {
  const calls = [];
  const fetchImpl = async (url) => {
    const u = new URL(url);
    const endpoint = u.pathname.split('/').pop();
    const p = Object.fromEntries(u.searchParams);
    calls.push({ endpoint, ...p });
    if (failWith) return new Response('{}', { status: failWith });
    let rows = (tables[endpoint] ?? []).filter((r) => splitAnd(p.filters).every((c) => matches(r, c)));
    if (p.sort_by) rows = [...rows].sort((a, b) => (String(a[p.sort_by]) < String(b[p.sort_by]) ? -1 : 1) * (p.sort_order === 'DESC' ? -1 : 1));
    const limit = Number(p.limit ?? 10), offset = Number(p.offset ?? 0);
    const fields = p.fields ? p.fields.split(',') : null;
    const page = rows.slice(offset, offset + limit).map((r, i) => ({ data: { ...(fields ? Object.fromEntries(fields.filter((f) => f in r).map((f) => [f, r[f]])) : r), ID: `id-${offset + i}` } }));
    const index = { name: `${endpoint}_fake`, createTimestamp: indexBuilt[endpoint] ?? '2026-11-13T10:00:07Z' };
    return new Response(JSON.stringify({ meta: { total: rows.length + totalBump, index }, data: page }), { status: 200 });
  };
  return { fetchImpl, calls };
}

export const METROS = {
  metros: [
    { cbsa: '12420', label: 'Austin', counties: { 48453: 'Travis' } },
    { cbsa: '19740', label: 'Denver', counties: { '08031': 'Denver' } },
    { cbsa: '31080', label: 'Los Angeles', counties: { '06037': 'Los Angeles' } },
  ],
  hqStates: ['TX', 'CO', 'CA'],
};

export const fin = (cert, repdte, over = {}) => ({
  ...Object.fromEntries(FDIC_FIELDS.financials.map((f, i) => [f, 100 + i])),
  NTLNLS: 999999,   // a year-to-date field exists in the source but must never be requested
  CBLRIND: 0,       // a flag, 0 or 1: not on the community bank leverage ratio
  CERT: cert, REPDTE: repdte, ...over,
});

// Banks: 101 Austin+Denver (HQ TX); 102 a branch in Los Angeles but HQ in SD (open, received assistance long ago);
// 998 and 999 were in the market last run and are not now: 998 was merged into 101 on 2026-06-01, 999 failed on 2026-07-17.
// 99999 ("Example Bank", Los Angeles) failed on 2026-09-25: /institutions and /history show it, the stale /failures index does not.
export const TABLES = () => ({
  locations: [
    { CERT: '101', CBSA_NO: '12420', CBSA: 'Austin-Round Rock-Georgetown, TX', COUNTY: 'Travis', STCNTY: '48453', STALP: 'TX', MAINOFF: 1 },
    { CERT: '101', CBSA_NO: '12420', CBSA: 'Austin-Round Rock-Georgetown, TX', COUNTY: 'Travis', STCNTY: '48453', STALP: 'TX', MAINOFF: 0 },
    { CERT: '101', CBSA_NO: '19740', CBSA: 'Denver-Aurora-Lakewood, CO', COUNTY: 'Denver', STCNTY: '08031', STALP: 'CO', MAINOFF: 0 },
    { CERT: '102', CBSA_NO: '31080', CBSA: 'Los Angeles-Long Beach-Anaheim, CA', COUNTY: 'Los Angeles', STCNTY: '06037', STALP: 'CA', MAINOFF: 0 },
    { CERT: '555', CBSA_NO: '99999', CBSA: 'Elsewhere', COUNTY: 'Other', STCNTY: '99001', STALP: 'ZZ', MAINOFF: 1 },
  ],
  // As in the real data: an open bank's ENDEFYMD is 12/31/9999 and it has no CHANGEC1 key; a closed one carries the code that closed it.
  institutions: [
    { CERT: 101, NAME: 'Example Hill Country Bank', CITY: 'Austin', STALP: 'TX', ASSET: 900000, WEBADDR: 'www.example.test', ACTIVE: 1, INACTIVE: 0, ENDEFYMD: '12/31/9999', STCNTY: '48453' },
    { CERT: 102, NAME: 'Example National Bank', CITY: 'Sioux Falls', STALP: 'SD', ASSET: 50000000, WEBADDR: 'www.example2.test', ACTIVE: 1, INACTIVE: 0, ENDEFYMD: '12/31/9999', STCNTY: '46099' },
    // FDIC sends a value it lacks as an explicit null with the key present.
    { CERT: 998, NAME: 'Example Merged Bank', CITY: 'Denver', STALP: 'CO', ASSET: 1, WEBADDR: null, ACTIVE: 0, INACTIVE: 1, ENDEFYMD: '06/01/2026', CHANGEC1: 223, STCNTY: '08031' },
    { CERT: 999, NAME: 'Example Failed Bank', CITY: 'Phoenix', STALP: 'AZ', ASSET: 1, WEBADDR: null, ACTIVE: 0, INACTIVE: 1, ENDEFYMD: '07/17/2026', CHANGEC1: 211, STCNTY: '04013' },
    { CERT: 700, NAME: 'Example Rural Bank', CITY: 'Elsewhere', STALP: 'TX', ASSET: 50000, WEBADDR: null, ACTIVE: 1, INACTIVE: 0, ENDEFYMD: '12/31/9999', STCNTY: '48001' },
    { CERT: 99999, NAME: 'Example Bank', CITY: 'Los Angeles', STALP: 'CA', ASSET: 1, WEBADDR: '', ACTIVE: 0, INACTIVE: 1, ENDEFYMD: '09/25/2026', CHANGEC1: 211, STCNTY: '06037' },
  ],
  failures: [
    { CERT: 102, NAME: 'EXAMPLE NATIONAL BANK', FAILDATE: '1/16/2009', RESTYPE: 'ASSISTANCE' },
    { CERT: 999, NAME: 'EXAMPLE FAILED BANK', FAILDATE: '7/17/2026', RESTYPE: 'FAILURE' },
  ],
  // Structure events. As in the real data, each deal has one row on the leaving bank's side (a merger code, or a failure code) and one on
  // the acquirer's (810), and keys an event lacks are left out: a failure row has no CERT. Code 713 rows are the deal's branches.
  history: [
    { TRANSNUM: 2026000998, CHANGECODE: 223, EFFDATE: '2026-06-01T00:00:00', OUT_CERT: 998, ACQ_CERT: 101, CERT: 998, ORG_ROLE_CDE: 'FI' },
    { TRANSNUM: 2026000998, CHANGECODE: 810, EFFDATE: '2026-06-01T00:00:00', OUT_CERT: 998, ACQ_CERT: 101, CERT: 101, ORG_ROLE_CDE: 'FI' },
    { TRANSNUM: 2026000998, CHANGECODE: 713, EFFDATE: '2026-06-01T00:00:00', CERT: 101, OFF_PSTNUM: 8, OFF_CNTYNUM: 31, ORG_ROLE_CDE: 'BR' },
    { TRANSNUM: 2026000998, CHANGECODE: 713, EFFDATE: '2026-06-01T00:00:00', CERT: 101, OFF_PSTNUM: 8, OFF_CNTYNUM: 31, ORG_ROLE_CDE: 'BR' },
    { TRANSNUM: 2026000999, CHANGECODE: 211, EFFDATE: '2026-07-17T00:00:00', OUT_CERT: 999, ACQ_CERT: 700, ORG_ROLE_CDE: 'FI' },
    { TRANSNUM: 2026000999, CHANGECODE: 713, EFFDATE: '2026-07-17T00:00:00', CERT: 700, OFF_PSTNUM: 48, OFF_CNTYNUM: 453, ORG_ROLE_CDE: 'BR' },
    { TRANSNUM: 2026099999, CHANGECODE: 211, EFFDATE: '2026-09-25T00:00:00', OUT_CERT: 99999, ACQ_CERT: 555, ORG_ROLE_CDE: 'FI' },
    { TRANSNUM: 2026099999, CHANGECODE: 713, EFFDATE: '2026-09-25T00:00:00', CERT: 555, OFF_PSTNUM: 6, OFF_CNTYNUM: 37, ORG_ROLE_CDE: 'BR' },
    // Outside the lookback window: never read.
    { TRANSNUM: 2019000001, CHANGECODE: 223, EFFDATE: '2019-03-01T00:00:00', OUT_CERT: 333, ACQ_CERT: 102, CERT: 333, ORG_ROLE_CDE: 'FI' },
  ],
  // As in the real data: DEPSUM (the bank's total) is carried only on the main-office row (BRNUM 0); every other row has DEPSUM 0.
  // Bank 101's main office is in a metro county; bank 102's is in SD, outside every metro, which is the case that used to give a total of 0.
  sod: [
    { CERT: 101, YEAR: 2026, BRNUM: 0, STCNTYBR: 48453, MSABR: 12420, DEPSUMBR: 300, DEPSUM: 1000, CNTYNAMB: 'Travis', STALPBR: 'TX' },
    { CERT: 101, YEAR: 2026, BRNUM: 1, STCNTYBR: 8031, MSABR: 0, DEPSUMBR: 200, DEPSUM: 0, CNTYNAMB: 'Denver', STALPBR: 'CO' },
    { CERT: 101, YEAR: 2026, BRNUM: 2, STCNTYBR: 48001, MSABR: 0, DEPSUMBR: 500, DEPSUM: 0, CNTYNAMB: 'Anderson', STALPBR: 'TX' },
    { CERT: 102, YEAR: 2026, BRNUM: 0, STCNTYBR: 46099, MSABR: 43620, DEPSUMBR: 39995000, DEPSUM: 40000000, CNTYNAMB: 'Minnehaha', STALPBR: 'SD' },
    { CERT: 102, YEAR: 2026, BRNUM: 7, STCNTYBR: 6037, MSABR: 31080, DEPSUMBR: 5000, DEPSUM: 0, CNTYNAMB: 'Los Angeles', STALPBR: 'CA' },
    { CERT: 101, YEAR: 2025, BRNUM: 0, STCNTYBR: 48453, MSABR: 12420, DEPSUMBR: 1, DEPSUM: 1, CNTYNAMB: 'Travis', STALPBR: 'TX' },
  ],
  // The last five rows are outside the 2-quarter pull the tests use: the 12-quarters-back base for the growth test, and the last reports
  // of two banks that are gone (998 before its merger, 99999 before it failed).
  financials: [fin('101', '20260331'), fin('101', '20260630'), fin('102', '20260331'), fin('102', '20260630'), fin('101', '20251231'),
    fin('101', '20230630'), fin('102', '20230630'),
    fin('998', '20260331', { LNRECONS: 1000, LNREMULT: 2000, LNRENRES: 3000 }), fin('99999', '20260630', { LNRECONS: 4000, LNREMULT: 5000, LNRENRES: 6000 })],
});

// A failed-bank CSV with the columns we expect FDIC's to have (unconfirmed), quoting as FDIC's export does. Invented banks only.
export const FAILED_BANK_CSV = [
  '﻿Bank Name ,City ,State ,Cert ,Acquiring Institution ,Closing Date ,Fund',
  '"Example Bank, N.A.",Los Angeles,CA,99999,Example Acquiring Bank,25-Sep-26,10550',
  'Example Failed Bank,Phoenix,AZ,999,Example Rural Bank,17-Jul-26,10549',
  'Example Old Bank,Austin,TX,444,No Acquirer,1-Mar-10,10100',
].join('\r\n');

