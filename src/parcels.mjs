// The property behind a county filing, from the county's own parcel record (docs/county-loans.md section 3a). A county's foreclosure list
// gives a loan type, which in Jefferson County describes the loan's purpose, not the property: an investor's "Commercial" or "BPL" loan
// on a house is a home, and an apartment building can carry a "Conventional" loan. So each filing's address is matched to the county's
// parcel layer, and the assessor's classification says what the property is (src/sources/parcels/colorado.mjs). The scope rule
// (src/loans.mjs loanScope) reads the stored match: only a parcel confirmed commercial, multifamily of 5 or more units, or commercial land
// is a lead.
//
// One adapter per county (PARCEL_SOURCES); only Jefferson has one (src/sources/parcels/jefferson.mjs). A filing from any other county
// has no parcel lookup: its property is not confirmed, so it is not a lead, and it goes on the property-not-confirmed list.
//
// MATCHING IS TOLERANT BUT NEVER GUESSES.
//   - The filing's address ("NUMBER STREET[, # or UNIT X], CITY, ST ZIP") is parsed; the layer is asked for every parcel with that
//     street number in that ZIP code, or in that city when the filing gives no ZIP code (or the ZIP code finds no parcel on the street).
//   - A parcel is a candidate only when its street matches the filing's after normalising both the same way: suffixes (STREET is ST,
//     AVENUE is AVE), directions before or after the name (N, S, E, W and the full words), punctuation, ordinals (26TH is 26) and highway
//     designators (I-70, US 285, ST HWY 58). An exact match of every part wins; failing that, the core words of the name must be equal
//     ("S. Frontage Rd" is "I-70 FRONTAGE RD S"), with no suffix and no direction that contradicts (MILLER ST is not MILLER CT, and N
//     MAIN is not S MAIN).
//   - Several parcels at one address are narrowed by the filing's unit. If those left still disagree on the property type, the match is
//     ambiguous, never a pick.
//   - Each match records how it was made (the street exact or by core words, by ZIP code or city, the unit used) and a confidence.
//
// WHERE IT LIVES. loans/parcels/<source>.json, by document id: derived data, with each match's parcel identifiers (schedule number and
// PIN), the assessor's codes and actual values, the building uses, units and buildings, the kind and sector, how it was matched, the
// confidence and when it was checked. No owner, and no address: the document's address is kept only as a hash, to notice a change. The
// stored documents (loans/docs) and their content hash are never touched. Like everything under loans/, no model-facing action and no
// scoring run loads it (src/uow.mjs).
//
// WHEN IT RUNS. The weekly loans.watch job looks up the documents a county run added or changed, and any not looked up yet, before the
// index is built; a lookup that fails is counted and never fails the county's run. `outbound loans parcels` fills what is missing (or,
// with --refresh, everything). `outbound loans rebuild` reads the stored matches and never the network.
import { createHash } from 'node:crypto';
import { readJson, writeJson } from './store.mjs';
import { getJson, getText, realSleep, HttpError } from './sources/http.mjs';
import { parseRobots, robotsFor, robotsAllows } from './sources/fdicsales.mjs';
import { loadDocuments, loansPaths, scopeAll, readParcelMatches, unconfirmedEntry, CONTEXT_NOTE, SECTORS, UNCONFIRMED } from './loans.mjs';
import { fdicPaths } from './sources/fdic.mjs';
import { loadAliases } from './candidates.mjs';
import { PARCEL_SOURCES, parcelSourceFor } from './sources/parcels/index.mjs';

// The adapters, by the county source id whose documents they serve (src/sources/parcels/index.mjs).
export { PARCEL_SOURCES, parcelSourceFor };
export const PARCELS_NOTE = `${CONTEXT_NOTE} Each county filing matched to the county's parcel record, for its property type. No owner and no address.`;

// ---- Streets ---------------------------------------------------------------------------------------------------------------------
const DIRECTIONS = Object.freeze({ N: 'N', S: 'S', E: 'E', W: 'W', NE: 'NE', NW: 'NW', SE: 'SE', SW: 'SW', NORTH: 'N', SOUTH: 'S', EAST: 'E', WEST: 'W',
  NORTHEAST: 'NE', NORTHWEST: 'NW', SOUTHEAST: 'SE', SOUTHWEST: 'SW' });
// Street suffixes to their USPS abbreviations (Publication 28, appendix C1), for those a Colorado address uses. Applied to every token on
// both sides, so a name word that is also a suffix ("Bear Creek") reads the same on both.
const SUFFIX_FORMS = [
  ['ST', 'STREET', 'STR', 'STRT'], ['AVE', 'AVENUE', 'AV', 'AVEN', 'AVN', 'AVNUE'], ['RD', 'ROAD'], ['DR', 'DRIVE', 'DRV', 'DRIV'], ['PL', 'PLACE'],
  ['CT', 'COURT', 'CRT'], ['CIR', 'CIRCLE', 'CIRC', 'CIRCL', 'CRCL'], ['BLVD', 'BOULEVARD', 'BOUL', 'BOULV', 'BLV'], ['LN', 'LANE'], ['WAY', 'WY'],
  ['PKWY', 'PARKWAY', 'PARKWY', 'PKY', 'PKWAY'], ['TRL', 'TRAIL', 'TRAILS', 'TRLS'], ['TER', 'TERRACE', 'TERR'], ['HWY', 'HIGHWAY', 'HIWAY', 'HIWY', 'HWAY'],
  ['LOOP', 'LP', 'LOOPS'], ['SQ', 'SQUARE', 'SQR', 'SQU'], ['PT', 'POINT'], ['XING', 'CROSSING', 'CRSSNG'], ['ALY', 'ALLEY', 'ALLY'], ['RDG', 'RIDGE'],
  ['VW', 'VIEW'], ['HL', 'HILL'], ['CRK', 'CREEK'], ['CYN', 'CANYON', 'CANYN', 'CNYN'], ['MTN', 'MOUNTAIN', 'MNTAIN', 'MNTN', 'MOUNTIN'], ['MT', 'MOUNT', 'MNT'],
  ['GLN', 'GLEN'], ['GRV', 'GROVE'], ['HTS', 'HEIGHTS'], ['MDW', 'MEADOW'], ['MDWS', 'MEADOWS'], ['PASS'], ['PATH', 'PATHS'], ['PIKE', 'PIKES'], ['ROW'],
  ['RUN'], ['WALK', 'WALKS'], ['VLY', 'VALLEY'], ['EST', 'ESTATE'], ['ESTS', 'ESTATES'], ['GDNS', 'GARDENS'], ['GDN', 'GARDEN'], ['CV', 'COVE'], ['BND', 'BEND'],
  ['LNDG', 'LANDING'], ['PARK', 'PRK'], ['PLZ', 'PLAZA'], ['SPG', 'SPRING'], ['SPGS', 'SPRINGS'], ['VIS', 'VISTA'], ['TRCE', 'TRACE'], ['CMN', 'COMMON'],
];
const SUFFIXES = new Map(SUFFIX_FORMS.flatMap(([abbr, ...forms]) => [[abbr, abbr], ...forms.map((f) => [f, abbr])]));
const SUFFIX_SET = new Set(SUFFIX_FORMS.map(([abbr]) => abbr));
const NUMBER_WORDS = Object.freeze({ FIRST: '1', SECOND: '2', THIRD: '3', FOURTH: '4', FIFTH: '5', SIXTH: '6', SEVENTH: '7', EIGHTH: '8', NINTH: '9', TENTH: '10',
  ELEVENTH: '11', TWELFTH: '12' });
const isHighway = (t) => /^HWY\d+$/.test(t);

// A street's text to its parts: { pre, post, tokens, hwy }. tokens is the name and its suffix, normalised; pre and post the direction
// before and after; hwy the highway designators ("HWY70" for I-70). `stripUnit` (a filing's street) drops a bare unit after the suffix
// ("W 20TH AVE 106", "S UNION WAY C-103"); a parcel's unit is its own field.
export function streetKey(street, { stripUnit = false } = {}) {
  let s = ` ${String(street ?? '').toUpperCase().replace(/[.,;]/g, ' ').replace(/\s+/g, ' ')} `;
  // Highway designators, before suffixes are read: I-70, I 70, INTERSTATE 70, the "1-70" the county's own data carries; US 285, US HWY
  // 285, U S HIGHWAY 285; ST HWY 58, STATE HIGHWAY 58, CO HWY 58, SH 58; HWY 6.
  s = s.replace(/\s(?:INTERSTATE|I)\s*-?\s*(\d{1,3})(?=\s)/g, ' HWY$1 ')
    .replace(/\s1-(\d{2,3})(?=\s)/g, ' HWY$1 ')
    .replace(/\sU\s?S\s+(?:(?:HWY|HIGHWAY)\s+)?(\d{1,3})(?=\s)/g, ' HWY$1 ')
    .replace(/\s(?:STATE|ST|CO|COLORADO)\s+(?:HWY|HIGHWAY)\s*(\d{1,3})(?=\s)/g, ' HWY$1 ')
    .replace(/\sSH\s*(\d{1,3})(?=\s)/g, ' HWY$1 ')
    .replace(/\s(?:HWY|HIGHWAY)\s*(\d{1,3})(?=\s)/g, ' HWY$1 ');
  let raw = s.replace(/[^A-Z0-9\s/-]/g, ' ').trim().split(/\s+/).filter(Boolean);
  const norm = (t) => {
    if (isHighway(t)) return t;
    const ord = /^(\d+)(?:ST|ND|RD|TH)$/.exec(t);
    if (ord) return String(Number(ord[1]));
    if (/^\d+$/.test(t)) return String(Number(t));
    return NUMBER_WORDS[t] ?? DIRECTIONS[t] ?? SUFFIXES.get(t) ?? t;
  };
  let tokens = raw.map(norm);
  if (stripUnit && tokens.length > 2) {
    const last = raw[raw.length - 1], prev = tokens[tokens.length - 2], before = tokens[tokens.length - 3];
    const unitLike = (/\d/.test(last) && !/^\d+(?:ST|ND|RD|TH)$/.test(last) && !isHighway(tokens[tokens.length - 1])) || (/^[A-Z]$/.test(last) && !DIRECTIONS[last]);
    const afterStreet = (SUFFIX_SET.has(prev) && prev !== 'HWY' && !(prev === 'RD' && ['COUNTY', 'CO', 'CR'].includes(before))) || Object.values(DIRECTIONS).includes(prev);
    if (unitLike && afterStreet) { raw = raw.slice(0, -1); tokens = tokens.slice(0, -1); }
  }
  // The directions before and after the name, a highway designator counting as a name ("S US HWY 285" is the highway with S before it).
  const dirs = new Set(Object.values(DIRECTIONS));
  let pre = null, post = null;
  if (tokens.length > 1 && dirs.has(tokens[0])) { pre = tokens[0]; tokens = tokens.slice(1); }
  if (tokens.length > 1 && dirs.has(tokens[tokens.length - 1])) { post = tokens[tokens.length - 1]; tokens = tokens.slice(0, -1); }
  return { pre, post, tokens: tokens.filter((t) => !isHighway(t)), hwy: tokens.filter(isHighway).sort() };
}

const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
// The name without its trailing suffix, when it has one and more than one token.
const stripSuffix = (t) => (t.length > 1 && SUFFIX_SET.has(t[t.length - 1]) ? t.slice(0, -1) : t);
// How a filing's street (a) stands to a parcel's (b): 'exact' when every part is equal; 'core-words' when the name's words are equal,
// with or without a suffix on one side (never two different suffixes), and the directions do not contradict (either has none, or they
// share one), whatever the highway designators; null otherwise.
export function compareStreets(a, b) {
  if (!a || !b) return null;
  const da = [a.pre, a.post].filter(Boolean), db = [b.pre, b.post].filter(Boolean);
  const directionsAgree = !da.length || !db.length || da.some((d) => db.includes(d));
  if (!a.tokens?.length || !b.tokens?.length) {
    // A street that is only a highway ("12345 HWY 285"): the same highway, and directions that do not contradict.
    if (a.tokens?.length || b.tokens?.length || !a.hwy.length || !same(a.hwy, b.hwy) || !directionsAgree) return null;
    return a.pre === b.pre && a.post === b.post ? 'exact' : 'core-words';
  }
  if (same(a.tokens, b.tokens) && a.pre === b.pre && a.post === b.post && same(a.hwy, b.hwy)) return 'exact';
  const words = same(a.tokens, b.tokens) || same(a.tokens, stripSuffix(b.tokens)) || same(stripSuffix(a.tokens), b.tokens);
  return words && directionsAgree ? 'core-words' : null;
}

// A unit for comparing: letters and digits only, leading zeros dropped ("#04-207" is "4207").
export const unitKey = (u) => {
  const k = String(u ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/(^|[A-Z])0+(?=\d)/g, '$1');
  return k || null;
};

// ---- Addresses -------------------------------------------------------------------------------------------------------------------
const UNIT_WORD = '(?:#|UNIT|APT|APARTMENT|CONDO|STE|SUITE|BLDG|BUILDING|SPC|SPACE|RM|ROOM)';
const cleanUnit = (u) => {
  let s = String(u ?? '').toUpperCase().trim();
  for (let i = 0; i < 3; i++) s = s.replace(new RegExp(`^[\\s#./-]*${UNIT_WORD}?(?=[\\s#./\\d-]|$)[\\s#./-]*`), '').trim();
  return s || null;
};
const CITY = /^[A-Z][A-Z .'-]*[A-Z]$/;

// A filing's property address to { numbers, street, unit, city, state, zip }, or { error: 'no-address' } when it has no street number.
// The shape is "NUMBER STREET[, # or UNIT X], CITY, ST ZIP", with the variants filings carry: a unit after the street with or without
// a comma, "#", "UNIT" or "APT"; two numbers ("965 & 975", "1560-1562", "2220-22"); no ZIP code; text before a colon ("For informational
// purposes only: ..."). Upper case throughout. Pure.
export function parseAddress(address) {
  let s = String(address ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
  if (s.includes(':')) s = s.slice(s.lastIndexOf(':') + 1).trim();
  const parts = s.split(',').map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return { error: 'no-address' };
  let state = null, zip = null, city = null, m;
  const last = parts[parts.length - 1];
  if (parts.length > 1 && (m = /^([A-Z]{2})\s*(\d{5})(?:-?\d{4})?$/.exec(last))) { state = m[1]; zip = m[2]; parts.pop(); }
  else if (parts.length > 1 && (m = /^(\d{5})(?:-?\d{4})?$/.exec(last))) { zip = m[1]; parts.pop(); }
  else if (parts.length > 1 && (m = /^([A-Z]{2})$/.exec(last))) { state = m[1]; parts.pop(); }
  else if (parts.length > 1 && (m = /^([A-Z][A-Z .'-]*?)\s+([A-Z]{2})(?:\s+(\d{5})(?:-?\d{4})?)?$/.exec(last))) { city = m[1].trim(); state = m[2]; zip = m[3] ?? null; parts.pop(); }
  if (!city && parts.length > 1 && CITY.test(parts[parts.length - 1]) && !new RegExp(`^${UNIT_WORD}\\b`).test(parts[parts.length - 1])) city = parts.pop();
  const line = parts.shift();
  const n = /^(\d{1,6})(?:[A-Z](?=\s))?(?:\s*(?:-|&|AND)\s*(\d{1,6}))?\s+(.+)$/.exec(line ?? '');
  if (!n) return { error: 'no-address' };
  const numbers = [String(Number(n[1]))];
  if (n[2]) {
    // "2220-22" is 2220 and 2222; "1560-1562" and "965 & 975" are both numbers as written.
    const second = n[2].length < n[1].length ? `${n[1].slice(0, n[1].length - n[2].length)}${n[2]}` : n[2];
    if (String(Number(second)) !== numbers[0]) numbers.push(String(Number(second)));
  }
  let street = n[3], unit = null;
  // Two numbers with only a space between ("9723 9727 W 17TH AVE"): the second is a number too when it is as long and within 20 of the
  // first, which no street name is.
  const two = /^(\d{1,6})\s+(?=\S)/.exec(street);
  if (!n[2] && two && two[1].length === n[1].length && Math.abs(Number(two[1]) - Number(n[1])) <= 20 && Number(two[1]) !== Number(n[1])) {
    numbers.push(String(Number(two[1]))); street = street.slice(two[0].length);
  }
  const u = new RegExp(`(?:^|\\s)${UNIT_WORD}(?=[\\s#./\\d-]|$)(.*)$`).exec(street);
  if (u) { unit = cleanUnit(u[0]); street = street.slice(0, u.index).trim(); }
  for (const p of parts) if (!unit) unit = cleanUnit(p);
  // A bare unit after the suffix ("W 20TH AVE 106") is dropped from the street by streetKey; keep it as the unit.
  const key = streetKey(street, { stripUnit: true });
  if (!unit) {
    const plain = streetKey(street);
    if (plain.tokens.length + (plain.post ? 1 : 0) > key.tokens.length + (key.post ? 1 : 0)) unit = cleanUnit(street.split(/\s+/).pop());
  }
  if (!key.tokens.length && !key.hwy.length) return { error: 'no-address' };
  return { numbers, street, key, unit, city: city && CITY.test(city) ? city.replace(/\s+/g, ' ') : null, state, zip };
}

// A document's address, hashed: stored with its match, so a changed address is looked up again, and never stored itself.
export const addressKey = (doc) => createHash('sha256').update(String(doc?.property?.address ?? '').replace(/\s+/g, ' ').trim().toUpperCase()).digest('hex').slice(0, 16);

// ---- One document's match --------------------------------------------------------------------------------------------------------
const MAX_STORED_PARCELS = 10;
// A parcel as the match stores it: its identifiers and what the assessor says. No address and no owner.
const storedParcel = (p) => ({ sch: p.sch ?? null, pin: p.pin ?? null, codes: p.codes ?? [], uses: p.uses ?? [], units: p.units ?? null, buildings: p.buildings ?? null });
const classKey = (c) => `${c.kind}|${c.sector ?? ''}|${c.landUse ?? ''}`;

// One parsed address against the parcels the layer returned for its numbers in its ZIP code (or city). Pure. Returns the record stored
// for the document, less its document id, address hash and date: { status, query, how, confidence, candidates, parcelCount, parcels,
// kind, sector, decidedBy } for a match; { status: 'ambiguous', ..., classes } when the parcels left disagree on the property type;
// { status: 'unmatched', query, candidates, reason } when no parcel is on the filing's street. `exactOnly` (the city's second look for
// an address whose ZIP code found nothing) takes no match by core words.
export function decideMatch(parsed, parcels = [], { query = 'zip', classify, exactOnly = false }) {
  const numbers = new Set(parsed.numbers.map((x) => String(Number(x))));
  const here = parcels.filter((p) => p.number && numbers.has(String(Number(p.number))));
  if (!here.length) return { status: 'unmatched', query, candidates: 0, reason: 'no parcel with this street number here' };
  const levels = here.map((p) => ({ p, level: compareStreets(parsed.key, streetKey(p.street)) }));
  const exact = levels.filter((x) => x.level === 'exact').map((x) => x.p);
  const core = exactOnly ? [] : levels.filter((x) => x.level === 'core-words').map((x) => x.p);
  let pool = exact.length ? exact : core;
  const street = exact.length ? 'exact' : 'core-words';
  if (!pool.length) return { status: 'unmatched', query, candidates: here.length, reason: 'no parcel on this street at this number' };
  // Several parcels at the address: the filing's unit narrows them.
  let unit = false;
  if (pool.length > 1 && parsed.unit) {
    const want = unitKey(parsed.unit);
    const mine = pool.filter((p) => unitKey(p.unit) === want);
    if (mine.length) { pool = mine; unit = true; }
  }
  // A parcel with no assessor class says nothing about the property; it counts only when no parcel has one.
  let classed = pool.map((p) => ({ p, c: classify(p) }));
  const withClass = classed.filter((x) => (x.p.codes ?? []).length);
  if (withClass.length) classed = withClass;
  const classes = [...new Map(classed.map((x) => [classKey(x.c), { kind: x.c.kind, sector: x.c.sector ?? null, landUse: x.c.landUse ?? null }])).values()];
  const base = { query, how: { street, place: query, unit }, candidates: here.length, parcelCount: classed.length, parcels: classed.slice(0, MAX_STORED_PARCELS).map((x) => storedParcel(x.p)) };
  if (classes.length > 1) return { status: 'ambiguous', ...base, confidence: null, classes };
  const { c } = classed[0];
  return { status: 'matched', ...base, confidence: street === 'exact' && query === 'zip' ? 'high' : 'medium', kind: c.kind, sector: c.kind === 'commercial' ? c.sector : null,
    landUse: c.kind === 'land' ? c.landUse ?? 'other' : null, decidedBy: c.code ?? null };
}

// ---- The layer (ArcGIS) ----------------------------------------------------------------------------------------------------------
const REFUSED = [401, 403, 407, 429, 451];
// One OR query of up to maxClauses clauses, every page of it: [attributes]. returnGeometry is always false. An answer the layer marks
// as an error, or with no feature list, throws; the error names the layer's code only, never its message, which can echo the query
// (street numbers and ZIP codes) into a job's result.
export async function queryLayer(adapter, where, { get, maxPages = 10 }) {
  const out = [];
  let offset = 0;
  for (let page = 0; page < maxPages; page++) {
    const body = await get(adapter.endpoint, { where, outFields: adapter.outFields.join(','), returnGeometry: 'false', orderByFields: 'OBJECTID', resultOffset: offset || undefined, f: 'json' });
    if (body?.error) throw new Error(`the parcel layer answered with an error (code ${Number.isFinite(Number(body.error.code)) ? Number(body.error.code) : 'none'})`);
    if (!Array.isArray(body?.features)) throw new Error('the parcel layer answered without a feature list');
    out.push(...body.features.map((f) => f?.attributes ?? {}));
    if (!body.exceededTransferLimit) return out;
    if (!body.features.length) throw new Error('the parcel layer said there were more parcels but gave none');
    offset += body.features.length;
  }
  throw new Error(`more parcels than ${maxPages} pages for one query`);
}

const placeholder = (v) => !String(v ?? '').trim() || /\[confirm/i.test(String(v));
const stableJson = (v) => (Array.isArray(v) ? `[${v.map(stableJson).join(',')}]` : v && typeof v === 'object'
  ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableJson(v[k])}`).join(',')}}` : JSON.stringify(v ?? null));

// Looks up the parcels of one county source's stored documents and writes loans/parcels/<source>.json. Which documents: those in `ids`
// (the ones a county run added or changed), and every one with no stored match or whose address changed since; with `refresh`, all.
// Never throws: a failure (the network, the layer, robots.txt, a placeholder User-Agent) is returned as counts with an outcome, and the
// documents it left are looked up next time. Requests: robots.txt first; then batches of up to adapter.maxClauses clauses, at least
// adapter.minIntervalMs (1.5 s) apart, or config.counties.parcels.minIntervalMs or a robots.txt Crawl-delay if longer; with the firm's
// User-Agent, retries and timeouts from src/sources/http.mjs. Returns counts only: no address, no parcel number.
export async function lookupParcels({ dir, sourceId, ids = null, refresh = false, counties = {}, fetchImpl = globalThis.fetch, sleep = realSleep, nowMs = () => Date.now(), now = new Date(), registry = PARCEL_SOURCES } = {}) {
  const counts = { sourceId, outcome: 'ok', looked: 0, matched: 0, ambiguous: 0, unmatched: 0, noAddress: 0, noPlace: 0, noZip: 0, byCity: 0, failed: 0, requests: 0, bySector: {} };
  const adapter = parcelSourceFor(sourceId, registry);
  if (!adapter) return { ...counts, outcome: 'no-source' };
  const cfg = counties?.parcels ?? {};
  if (cfg.enabled === false) return { ...counts, outcome: 'off' };
  try {
    if (placeholder(counties?.userAgent)) throw new Error('config.counties.userAgent is a placeholder. Every request names the firm and a monitored business contact; a principal fills it.');
    const userAgent = counties.userAgent.trim();
    const P = loansPaths(dir);
    const file = readJson(P.parcels(sourceId), null) ?? {};
    const old = file.matches ?? {};
    const want = ids ? new Set(ids) : null;
    const docs = Object.values(loadDocuments(dir, sourceId) ?? {}).filter((d) => d && typeof d.id === 'string').sort((a, b) => (a.id < b.id ? -1 : 1));
    const todo = docs.filter((d) => refresh || want?.has(d.id) || !old[d.id] || old[d.id].addressKey !== addressKey(d));
    counts.looked = todo.length;
    const at = now.toISOString();
    const next = { ...old };
    const put = (d, rec) => { next[d.id] = { documentId: d.id, addressKey: addressKey(d), checkedAt: at, ...rec }; };

    // Parse every address; those with no street number or no place are decided without a request.
    const asks = [];
    const cityOf = (c) => (c ? adapter.cityAliases?.[c] ?? c : null);
    for (const d of todo) {
      const parsed = parseAddress(d.property?.address);
      if (parsed.error) { put(d, { status: 'no-address' }); continue; }
      const nums = parsed.numbers.map(adapter.numberKey);
      if (nums.some((x) => !x)) { put(d, { status: 'unmatched', query: parsed.zip ? 'zip' : 'city', candidates: 0, reason: 'a street number longer than the layer holds' }); continue; }
      if (!parsed.zip) counts.noZip++;
      const city = cityOf(parsed.city);
      if (!parsed.zip && !city) { put(d, { status: 'no-place' }); continue; }
      asks.push({ d, parsed, nums, city });
    }

    // The requests: robots.txt once, then the batched OR queries, paced.
    let interval = Math.max(adapter.minIntervalMs, Number.isInteger(cfg.minIntervalMs) ? cfg.minIntervalMs : 0);
    let last = -Infinity, stopped = null, robotsRead = false;
    const pace = async () => { const wait = last + interval - nowMs(); if (wait > 0) await sleep(wait); last = nowMs(); };
    const opts = { fetchImpl, userAgent, sleep, retries: 2, timeoutMs: 60000 };
    const readRobots = async () => {
      robotsRead = true;
      await pace(); counts.requests++;
      let rules = { rules: [], crawlDelay: null };
      try { rules = robotsFor(parseRobots((await getText(adapter.robots.url, {}, { ...opts, maxBytes: 500_000 })).text), userAgent); }
      catch (e) { if (!(e instanceof HttpError && e.status === 404)) throw e; }
      if (rules.crawlDelay) interval = Math.max(interval, rules.crawlDelay * 1000);
      if (!robotsAllows(rules, new URL(adapter.endpoint).pathname)) throw new Error(`robots.txt on ${adapter.host} disallows the parcel layer; nothing was asked.`);
    };
    const get = async (url, params) => { await pace(); counts.requests++; return getJson(url, params, opts); };
    // One pass: each ask's clauses (place 'zip' or 'city'), batched; returns Map clause key -> parcels, and the failed keys.
    const keyOf = (num, place, value) => `${num}|${place}:${value}`;
    const pass = async (list, place) => {
      const clauses = new Map();
      for (const a of list) for (const num of a.nums) {
        const value = place === 'zip' ? a.parsed.zip : a.city;
        clauses.set(keyOf(num, place, value), adapter.clause(place === 'zip' ? { number: num, zip: value } : { number: num, city: value }));
      }
      const found = new Map([...clauses.keys()].map((k) => [k, []]));
      const failed = new Set();
      const keys = [...clauses.keys()];
      for (let i = 0; i < keys.length; i += adapter.maxClauses) {
        const chunk = keys.slice(i, i + adapter.maxClauses);
        if (stopped) { chunk.forEach((k) => failed.add(k)); continue; }
        try {
          if (!robotsRead) await readRobots();
          const rows = await queryLayer(adapter, chunk.map((k) => clauses.get(k)).join(' OR '), { get });
          for (const attrs of rows) {
            const p = adapter.parcelOf(attrs);
            for (const k of [keyOf(p.number, 'zip', p.zip), keyOf(p.number, 'city', p.city)]) if (found.has(k) && chunk.includes(k)) found.get(k).push(p);
          }
        } catch (e) {
          chunk.forEach((k) => failed.add(k));
          counts.error ??= String(e.message ?? e).slice(0, 300);
          // A refusal, or robots.txt saying no: nothing more is asked this run.
          if ((e instanceof HttpError && REFUSED.includes(e.status)) || /robots\.txt/.test(String(e.message))) stopped = e;
        }
      }
      return { found, failed };
    };
    const decide = (a, place, found, more = {}) => decideMatch(a.parsed, a.nums.flatMap((num) => found.get(keyOf(num, place, place === 'zip' ? a.parsed.zip : a.city)) ?? []), { query: place, classify: adapter.classify, ...more });
    const failedAsk = (a, place, r) => a.nums.some((num) => r.failed.has(keyOf(num, place, place === 'zip' ? a.parsed.zip : a.city)));

    // First by ZIP code (or by city with none); then, for a ZIP code that found no parcel on the street, by city.
    const byZip = asks.filter((a) => a.parsed.zip), byCity = asks.filter((a) => !a.parsed.zip);
    const r1 = await pass(byZip, 'zip');
    const r2 = await pass(byCity, 'city');
    const again = [];
    for (const a of byZip) {
      if (failedAsk(a, 'zip', r1)) { counts.failed++; continue; }
      const m = decide(a, 'zip', r1.found);
      if (m.status === 'unmatched' && a.city) again.push({ a, m }); else put(a.d, m);
    }
    for (const a of byCity) { if (failedAsk(a, 'city', r2)) counts.failed++; else put(a.d, decide(a, 'city', r2.found)); }
    const r3 = await pass(again.map((x) => x.a), 'city');
    for (const { a, m } of again) {
      // The city's lookup failed: nothing is stored, so the document is looked up again next time.
      if (failedAsk(a, 'city', r3)) { counts.failed++; continue; }
      // A second look across the whole city is weaker than the ZIP code: only an exact street counts.
      const c = decide(a, 'city', r3.found, { exactOnly: true });
      put(a.d, c.status === 'unmatched' ? m : c);
    }

    for (const d of todo) {
      const rec = next[d.id];
      if (!rec || rec.checkedAt !== at) continue;
      if (rec.status === 'matched') { counts.matched++; const k = classWord(rec); counts.bySector[k] = (counts.bySector[k] ?? 0) + 1; }
      else if (rec.status === 'ambiguous') counts.ambiguous++;
      else if (rec.status === 'unmatched') counts.unmatched++;
      else if (rec.status === 'no-address') counts.noAddress++;
      else if (rec.status === 'no-place') counts.noPlace++;
      if (rec.query === 'city' && (rec.status === 'matched' || rec.status === 'ambiguous')) counts.byCity++;
    }
    const out = { sourceId, parcelSource: adapter.id, label: adapter.label, attribution: adapter.attribution, licence: adapter.licence, contextOnly: true, note: PARCELS_NOTE, matches: next };
    const { updatedAt: _u, ...before } = file;
    if ((Object.keys(next).length || Object.keys(file).length) && stableJson(before) !== stableJson(out)) writeJson(P.parcels(sourceId), { ...out, updatedAt: at });
    if (counts.failed) counts.outcome = counts.failed === asks.length ? 'failed' : 'partial';
    return counts;
  } catch (e) {
    return { ...counts, outcome: 'failed', failed: counts.looked, error: String(e.message ?? e).slice(0, 300) };
  }
}

// ---- The report ------------------------------------------------------------------------------------------------------------------
// How a matched parcel is counted: its sector; commercial, residential or other land; or its kind.
function classWord(m) {
  if (m.kind === 'commercial') return m.sector ?? 'other-commercial';
  if (m.kind === 'land') return m.landUse === 'commercial' || m.landUse === 'industrial' ? 'commercial-land' : m.landUse === 'residential' ? 'residential-land' : 'other-land';
  return m.kind;
}

// For `outbound loans parcels` and the docs: of one source's stored documents, how their stored matches stand (matched by how,
// ambiguous, unmatched, no address, no ZIP code and no city, not looked up), the matched ones by class; the leads by the loan type alone
// (the rule before the parcel record) and by the parcel record, with how many moved each way; the documents out (homes and residential
// land); and the property-not-confirmed list by reason, with the entries to check by hand (unconfirmedEntry: no address, no name, no
// parcel number).
export function parcelReport({ dir, sourceId }) {
  const docs = Object.values(loadDocuments(dir, sourceId) ?? {}).filter((d) => d && typeof d.id === 'string');
  const matches = readParcelMatches(dir);
  const r = { sourceId, documents: docs.length, matched: 0, exact: 0, coreWords: 0, byZip: 0, byCity: 0, unitUsed: 0, high: 0, medium: 0, ambiguous: 0, unmatched: 0, noAddress: 0, noPlace: 0, notLooked: 0, noZip: 0,
    byClass: {}, leadsBefore: 0, leads: 0, movedIn: 0, movedOut: 0, leadsBySector: {}, out: 0, outByWhy: {}, unconfirmed: 0, unconfirmedByReason: {}, unconfirmedLoanTypeWouldKeep: 0, review: [] };
  for (const d of docs) {
    const m = matches.get(d.id);
    const parsed = parseAddress(d.property?.address);
    if (!parsed.error && !parsed.zip) r.noZip++;
    if (!m) { r.notLooked++; continue; }
    if (m.status === 'matched') {
      r.matched++;
      if (m.how?.street === 'exact') r.exact++; else r.coreWords++;
      if (m.how?.place === 'city') r.byCity++; else r.byZip++;
      if (m.how?.unit) r.unitUsed++;
      if (m.confidence === 'high') r.high++; else r.medium++;
      const k = classWord(m);
      r.byClass[k] = (r.byClass[k] ?? 0) + 1;
    } else if (m.status === 'ambiguous') r.ambiguous++;
    else if (m.status === 'unmatched') r.unmatched++;
    else if (m.status === 'no-address') r.noAddress++;
    else if (m.status === 'no-place') r.noPlace++;
  }
  const scopes = scopeAll(docs, { parcels: matches });
  const institutions = readJson(fdicPaths(dir).institutions, {}) ?? {}, aliases = loadAliases(dir);
  for (const d of docs.sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const s = scopes.get(d.id);
    if (s.loanTypeInScope) r.leadsBefore++;
    if (s.inScope) {
      r.leads++;
      const k = s.property.sector ?? 'commercial-land';
      r.leadsBySector[k] = (r.leadsBySector[k] ?? 0) + 1;
      if (!s.loanTypeInScope) r.movedIn++;
      continue;
    }
    if (s.loanTypeInScope) r.movedOut++;
    if (!s.review) { r.out++; r.outByWhy[s.why] = (r.outByWhy[s.why] ?? 0) + 1; continue; }
    const e = unconfirmedEntry(d, s, { institutions, aliases });
    r.unconfirmed++;
    r.unconfirmedByReason[e.reason] = (r.unconfirmedByReason[e.reason] ?? 0) + 1;
    if (e.loanTypeInScope) r.unconfirmedLoanTypeWouldKeep++;
    // Itemized for a check by hand: those the loan type alone would keep, and those matched to a parcel whose class does not decide (an
    // apartment code with no unit count, exempt, agricultural, other land, another class). The rest are counted.
    if (e.loanTypeInScope || e.parcel.status === 'matched') r.review.push(e);
  }
  r.review.sort((a, b) => (Number(b.loanTypeInScope) - Number(a.loanTypeInScope)) || (a.date !== b.date ? (String(a.date) < String(b.date) ? 1 : -1) : a.id < b.id ? -1 : 1));
  return r;
}

const ORDER = [...Object.keys(SECTORS), 'commercial-land', 'residential', 'residential-land', 'other-land', 'exempt', 'agricultural', 'units-unknown', 'other'];
const listOf = (o, order = ORDER) => [...order.filter((k) => o[k]), ...Object.keys(o).filter((k) => !order.includes(k) && o[k]).sort()].map((k) => `${k} ${o[k]}`).join(', ') || 'none';
// The report in words. Counts, and the property-not-confirmed entries the loan type alone would keep, each by its document id, type,
// county, date, loan type, reason, banks matched and public link: never an address, a name or a parcel number.
export function parcelReportText(r, { lookup = null, attribution = null } = {}) {
  const L = [];
  if (lookup) L.push(`${r.sourceId}: looked up ${lookup.looked} document(s) now in ${lookup.requests} request(s), outcome ${lookup.outcome}${lookup.failed ? `, ${lookup.failed} lookup(s) failed (tried again next time)` : ''}${lookup.error ? `: ${lookup.error}` : ''}.`);
  L.push(`${r.sourceId}: ${r.documents} stored document(s).`,
    `  matched: ${r.matched} (street exact ${r.exact}, by core words ${r.coreWords}; by ZIP code ${r.byZip}, by city ${r.byCity}; narrowed by unit ${r.unitUsed}; confidence high ${r.high}, medium ${r.medium})`,
    `  ambiguous: ${r.ambiguous}; unmatched: ${r.unmatched}; no address: ${r.noAddress}; no ZIP code and no city: ${r.noPlace}; not looked up yet: ${r.notLooked}`,
    `  no ZIP code: ${r.noZip} (looked up by city)`,
    `  matched, by class: ${listOf(r.byClass)}`,
    `  leads: ${r.leadsBefore} by the loan type alone (the rule before the parcel record); ${r.leads} by the parcel record (${r.movedIn} moved in, ${r.movedOut} moved out)`,
    `  leads by sector: ${listOf(r.leadsBySector)}`,
    `  out: ${r.out} (${listOf(r.outByWhy, ['residential-parcel', 'residential-land'])})`,
    `  property not confirmed, not leads: ${r.unconfirmed} (${listOf(r.unconfirmedByReason, Object.keys(UNCONFIRMED))}); the loan type alone would keep ${r.unconfirmedLoanTypeWouldKeep}${r.review.length ? '. To check by hand (the loan type alone would keep it, or its parcel\'s class does not decide):' : ''}`,
    ...r.review.map((e) => `    ${e.date ?? '-'}  ${e.id}  ${e.typeLabel}, ${e.countyLabel}; loan type: ${e.loanType ?? 'none'}; ${e.reasonText}${e.parcel.code ? ` (assessor code ${e.parcel.code})` : ''}${e.banks.length ? `; banks: ${e.banks.join(', ')}` : ''}; ${e.link ?? 'no link'}`));
  if (attribution) L.push(`Property type: ${attribution}.`);
  return L.join('\n');
}
