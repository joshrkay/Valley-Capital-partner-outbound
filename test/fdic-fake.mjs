// A fake FDIC BankFind API for tests, shared by the FDIC adapter's tests and the platform parity tests. Invented banks and numbers only.
// It mimics the real API where it matters: `FIELD:(A OR B)` lists, `[A TO B]` ranges with `*` open bounds, paging by offset, sorting,
// and silently dropping fields it does not know (verified behavior of the real API, 2026-11-13).
import { FDIC_FIELDS } from '../src/sources/fdic.mjs';

const unq = (v) => v.replace(/^"|"$/g, '');
export function matches(row, clause) {
  const m = /^(\w+):(.*)$/.exec(clause.trim());
  if (!m) throw new Error(`fake FDIC: cannot parse ${clause}`);
  const [, field, expr] = m;
  const v = row[field];
  if (v === undefined) return false;
  if (expr.startsWith('[')) {   // ranges compare as numbers when both sides are numeric; `*` is an open bound, as in the real API
    const [lo, hi] = expr.slice(1, -1).split(' TO ');
    const cmp = (a, b) => (Number.isFinite(Number(a)) && Number.isFinite(Number(b)) ? Number(a) - Number(b) : String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0);
    return (lo === '*' || cmp(v, lo) >= 0) && (hi === '*' || cmp(v, hi) <= 0);
  }
  if (expr.startsWith('(')) {
    if (expr.includes(',')) return false;   // the real API returns nothing for the comma form
    return expr.slice(1, -1).split(' OR ').map(unq).some((x) => String(v) === x || Number(v) === Number(x));
  }
  return String(v) === unq(expr) || Number(v) === Number(unq(expr));
}
const splitAnd = (f) => (f ? f.split(/ AND (?![^(]*\))/) : []);

export function fakeFdic(tables, { totalBump = 0, failWith } = {}) {
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
    return new Response(JSON.stringify({ meta: { total: rows.length + totalBump }, data: page }), { status: 200 });
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
  CERT: cert, REPDTE: repdte, ...over,
});

// Banks: 101 Austin+Denver (HQ TX); 102 a branch in Los Angeles but HQ in SD (open, received assistance long ago);
// 998 and 999 were in the market last run and are not now: 998 closed without failing, 999 failed.
export const TABLES = () => ({
  locations: [
    { CERT: '101', CBSA_NO: '12420', CBSA: 'Austin-Round Rock-Georgetown, TX', COUNTY: 'Travis', STCNTY: '48453', STALP: 'TX', MAINOFF: 1 },
    { CERT: '101', CBSA_NO: '12420', CBSA: 'Austin-Round Rock-Georgetown, TX', COUNTY: 'Travis', STCNTY: '48453', STALP: 'TX', MAINOFF: 0 },
    { CERT: '101', CBSA_NO: '19740', CBSA: 'Denver-Aurora-Lakewood, CO', COUNTY: 'Denver', STCNTY: '08031', STALP: 'CO', MAINOFF: 0 },
    { CERT: '102', CBSA_NO: '31080', CBSA: 'Los Angeles-Long Beach-Anaheim, CA', COUNTY: 'Los Angeles', STCNTY: '06037', STALP: 'CA', MAINOFF: 0 },
    { CERT: '555', CBSA_NO: '99999', CBSA: 'Elsewhere', COUNTY: 'Other', STCNTY: '99001', STALP: 'ZZ', MAINOFF: 1 },
  ],
  institutions: [
    { CERT: 101, NAME: 'Example Hill Country Bank', CITY: 'Austin', STALP: 'TX', ASSET: 900000, WEBADDR: 'www.example.test', ACTIVE: 1 },
    { CERT: 102, NAME: 'Example National Bank', CITY: 'Sioux Falls', STALP: 'SD', ASSET: 50000000, WEBADDR: 'www.example2.test', ACTIVE: 1 },
    // FDIC sends a value it lacks as an explicit null with the key present.
    { CERT: 998, NAME: 'Example Merged Bank', CITY: 'Denver', STALP: 'CO', ASSET: 1, WEBADDR: null, ACTIVE: 0 },
    { CERT: 999, NAME: 'Example Failed Bank', CITY: 'Phoenix', STALP: 'AZ', ASSET: 1, WEBADDR: null, ACTIVE: 0 },
    { CERT: 700, NAME: 'Example Rural Bank', CITY: 'Elsewhere', STALP: 'TX', ASSET: 50000, WEBADDR: null, ACTIVE: 1 },
  ],
  failures: [
    { CERT: 102, NAME: 'EXAMPLE NATIONAL BANK', FAILDATE: '1/16/2009', RESTYPE: 'ASSISTANCE' },
    { CERT: 999, NAME: 'EXAMPLE FAILED BANK', FAILDATE: '7/17/2026', RESTYPE: 'FAILURE' },
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
  financials: [fin('101', '20260331'), fin('101', '20260630'), fin('102', '20260331'), fin('102', '20260630'), fin('101', '20251231')],
});

