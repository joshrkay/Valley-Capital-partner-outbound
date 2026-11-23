// A fake of Jefferson County's ArcGIS parcel layer (src/sources/parcels/jefferson.mjs), with invented parcels only. It reads the query the
// way the real FeatureServer does: an OR of (PRPSTRNUM='NNNNN' AND PRPZIP5='ZZZZZ') or (PRPSTRNUM='NNNNN' AND UPPER(PRPCTYNAM)='CITY')
// clauses, a page of at most `maxRecordCount` features with exceededTransferLimit, and resultOffset for the next. Every feature carries
// owner and mailing fields too, so a test can prove the lookup never keeps them. No network.
export const HOST = 'gisportal.jeffco.us';
export const OWNER = 'Zephyrine Owner Holdings LLC';
export const MAILING = '77 Quillonfield Road';

// An invented parcel: its site address, assessor codes ([[code, value]]), building uses, units and identifiers, with owner fields set.
let seq = 0;
export function parcel({ num, dir = null, name, type = null, sfx = null, unit = null, city = 'ANYTOWN', zip = '80000', codes = [['1112', 100000], ['1212', 300000]], uses = ['1 Story/Ranch'], units = 0, sch = null } = {}) {
  seq += 1;
  const a = {
    OBJECTID: seq, SCH: sch ?? String(900000 + seq), PIN: `99-999-00-${String(seq).padStart(3, '0')}`,
    PRPSTRNUM: String(num).padStart(5, '0'), PRPSTRDIR: dir, PRPSTRNAM: name, PRPSTRTYP: type, PRPSTRSFX: sfx, PRPSTRUNT: unit,
    PRPADDRESS: [num, dir, name, type, sfx].filter(Boolean).join(' '), PRPCTYNAM: city, PRPZIP5: zip,
    STTTYPUSE: uses[0] ?? null, STTTYPUSE2: uses[1] ?? null, STTTYPUSE3: null, STTTYPUSE4: null, STTNBRUNT: units, STTNBRUNT2: 0, STTNBRUNT3: 0, STTNBRUNT4: 0,
    STTNBRBLDG: 1, STTNBRBLD2: 0, STTNBRBLD3: 0, STTNBRBLD4: 0,
    OWNNAM: OWNER, OWNNAM2: null, OWNICO: null, DBA: null, MAILSTRNBR: '77', MAILSTRNAM: MAILING, MAILCTYNAM: 'SAMPLETON', MAILZIP5: '80999',
  };
  ['', '2', '3', '4', '5', '6'].forEach((n, i) => { a[`TAXCLS${n}`] = codes[i]?.[0] ?? null; a[`VALACT${n}`] = codes[i]?.[1] ?? 0; });
  return a;
}

const CLAUSE = /\(PRPSTRNUM='(\d{5})' AND (?:PRPZIP5='(\d{5})'|UPPER\(PRPCTYNAM\)='([A-Z .'-]+)')\)/g;
// fetchImpl for the lookup. `robots`: robots.txt's body (null: a 404). `fail`: the status every query answers with instead (or a
// function of the call number); `error`: an ArcGIS error body with status 200. `maxRecordCount`: the page size.
export function fakeArcgis({ parcels = [], robots = null, fail = null, error = null, maxRecordCount = 2000 } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const ua = init.headers?.['user-agent'] ?? null;
    if (u.host !== HOST) return new Response('not found', { status: 404 });
    if (u.pathname === '/robots.txt') { calls.push({ path: u.pathname, ua }); return robots === null ? new Response('<html>404</html>', { status: 404 }) : new Response(robots, { status: 200 }); }
    const p = Object.fromEntries(u.searchParams);
    const call = { path: u.pathname, ua, where: p.where, outFields: (p.outFields ?? '').split(','), returnGeometry: p.returnGeometry, f: p.f, resultOffset: p.resultOffset ?? null, clauses: [...String(p.where ?? '').matchAll(CLAUSE)].length };
    calls.push(call);
    const status = typeof fail === 'function' ? fail(calls.filter((c) => c.where).length) : fail;
    if (status) return new Response('{"error":"down"}', { status });
    if (error) return Response.json({ error });
    if (!u.pathname.endsWith('/FeatureServer/20/query')) return new Response('not found', { status: 404 });
    // The where clause is exactly an OR of the clauses: anything else is refused, as a malformed query would be.
    const clauses = [...String(p.where).matchAll(CLAUSE)];
    if (!clauses.length || clauses.map((m) => m[0]).join(' OR ') !== p.where) return Response.json({ error: { code: 400, message: 'Unable to complete operation.' } });
    const hits = parcels.filter((x) => clauses.some(([, num, zip, city]) => x.PRPSTRNUM === num && (zip ? x.PRPZIP5 === zip : String(x.PRPCTYNAM ?? '').toUpperCase() === city)));
    const from = Number(p.resultOffset ?? 0);
    const page = hits.slice(from, from + maxRecordCount);
    return Response.json({ features: page.map((attributes) => ({ attributes })), ...(from + page.length < hits.length ? { exceededTransferLimit: true } : {}) });
  };
  return { fetchImpl, calls, queries: () => calls.filter((c) => c.where !== undefined) };
}
