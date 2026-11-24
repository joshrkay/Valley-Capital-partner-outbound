// What a Colorado parcel is, from its assessor's classification (docs/county-loans.md section 3a). Every Colorado assessor files its
// parcels under the state's four-digit abstract codes: the first digit is the class (0 vacant land, 1 residential, 2 commercial,
// 3 industrial, 4 agricultural, 9 exempt; 5 to 8 natural resources, mines, oil and gas, state assessed), the second says land (1) or
// improvements (2), and the last two the use. A parcel carries up to six codes, each with its actual value (Jefferson: TAXCLS..TAXCLS6
// and VALACT..VALACT6), up to four building uses (STTTYPUSE..STTTYPUSE4) and the units of each structure (STTNBRUNT..STTNBRUNT4).
//
// Read from a cross-tabulation of Jefferson County's live parcel layer (TAXCLS against STTTYPUSE, 2026-11-23), under the principal's
// ruling of 2026-11-23 (no residential property at all; multifamily is 5 or more units):
//   1112/1212 houses; 1115/1215 duplexes and triplexes; 1130/1230 condos; 1135/1235 manufactured homes; 1177/1277 houses   residential
//   1120/1220 (4 to 8 units): 5 or more units on the parcel                                                                 multifamily
//                             1 to 4 units                                                                                  residential
//                             no unit count                                                                                 units-unknown
//   1125/1225 apartments of 9 or more units (and some elderly housing)                                                      multifamily
//   2112/2212 retail stores, convenience stores, neighbourhood centres                                                      retail
//   2115/2215 hotels and motels (limited and full service, B&B)                                                             hospitality
//   2120/2220 office buildings                                                                                              office
//   2125/2225 recreation; 2130/2230 special purpose (restaurants, repair garages, fast food, medical office, bank branches)  other-commercial
//   2135/2235 industrial flex and storage warehouses; every 3xxx code                                                       industrial
//   2140, 2145/2245 (office and retail condominiums), 2150/2250 (mixed): the building use names the sector, else            other-commercial
//   0100 residential vacant land; 0200 commercial and 0300 industrial vacant land; 05xx, 0600, 0700 other land              land, by use
//   4xxx agricultural; 9xxx exempt (government, schools, churches, some non-profit housing)
// Any other code (1140 and 1150 among Jefferson's, 5xxx to 8xxx) is 'other'.
//
// A parcel with codes of more than one kind (a house and an office, a mini-warehouse with a manager's apartment) is read by value:
// vacant-land codes give way to any improvement code (land under a house is a house), and among the rest the kind holding the most of
// the parcel's actual value decides; within commercial the sector, and within land the use, holding the most. Two kinds of equal value,
// or mixed kinds with no value to choose by, are 'other': never a guess.

// The codes read as residential, and the apartment codes; land (x1xx) and improvements (x2xx) alike.
const RESIDENTIAL = new Set(['1112', '1212', '1115', '1215', '1130', '1230', '1135', '1235', '1177', '1277']);
const SMALL_APARTMENTS = new Set(['1120', '1220']);   // 4 to 8 units: multifamily only with 5 or more
const APARTMENTS = new Set(['1125', '1225']);         // 9 or more units
export const MULTIFAMILY_MIN_UNITS = 5;
// Vacant land (0xxx), by its use: residential, commercial, industrial, or other land.
const LAND_USES = Object.freeze({ '0100': 'residential', '0200': 'commercial', '0300': 'industrial' });
// Commercial (2xxx, land 21xx or improvements 22xx), by the use in the last two digits. The mixed uses are read from the building use.
const COMMERCIAL = Object.freeze({ 12: 'retail', 15: 'hospitality', 20: 'office', 25: 'other-commercial', 30: 'other-commercial', 35: 'industrial' });
const MIXED_COMMERCIAL = new Set(['40', '45', '50']);
// A building use to a sector, for the mixed codes only, first match wins: a hotel or motel, apartments, an industrial or warehouse
// building (an industrial condominium's office build-out stays industrial), a store or market, an office.
const USE_SECTORS = [
  [/\b(?:hotel|motel|bed\s*(?:&|and)\s*breakfast|lodge)\b/i, 'hospitality'],
  [/\bapartment/i, 'multifamily'],
  [/\b(?:industrial|warehouse|manufacturing|distribution)\b/i, 'industrial'],
  [/\b(?:store|retail|shopping|market|supermarket|mall)\b/i, 'retail'],
  [/\boffice\b/i, 'office'],
];
export const sectorOfUse = (use) => USE_SECTORS.find(([re]) => re.test(String(use ?? '')))?.[1] ?? null;

// One code to its kind: { kind, sector, landUse }. sector is set for commercial ('mixed' for a code the building use decides), landUse
// for land. `units` is the parcel's unit count, for the 4 to 8 unit apartment code.
export function kindOfCode(code, { units = null } = {}) {
  const c = String(code ?? '').trim();
  if (!/^\d{4}$/.test(c)) return null;
  if (c[0] === '0') return { kind: 'land', sector: null, landUse: LAND_USES[c] ?? 'other' };
  if (c[0] === '1') {
    if (RESIDENTIAL.has(c)) return { kind: 'residential', sector: null };
    if (APARTMENTS.has(c)) return { kind: 'commercial', sector: 'multifamily' };
    if (SMALL_APARTMENTS.has(c)) {
      const n = Number(units);
      if (!(Number.isFinite(n) && n > 0)) return { kind: 'units-unknown', sector: null };
      return n >= MULTIFAMILY_MIN_UNITS ? { kind: 'commercial', sector: 'multifamily' } : { kind: 'residential', sector: null };
    }
    return { kind: 'other', sector: null };
  }
  if (c[0] === '2') {
    const use = c.slice(2);
    if ((c[1] === '1' || c[1] === '2') && COMMERCIAL[use]) return { kind: 'commercial', sector: COMMERCIAL[use] };
    return { kind: 'commercial', sector: MIXED_COMMERCIAL.has(use) ? 'mixed' : 'other-commercial' };
  }
  if (c[0] === '3') return { kind: 'commercial', sector: 'industrial' };
  if (c[0] === '4') return { kind: 'agricultural', sector: null };
  if (c[0] === '9') return { kind: 'exempt', sector: null };
  return { kind: 'other', sector: null };
}

// The entry of a value table with the most value; the first in the record's order on a tie.
const most = (entries) => entries.reduce((a, b) => (b.value > a.value ? b : a));

// A parcel's codes ([{ code, value }]), building uses and units to { kind, sector, landUse, code, why }: kind one of residential,
// commercial, land, exempt, agricultural, units-unknown, other (PARCEL_KINDS in src/loans.mjs); sector, for commercial, one of SECTORS;
// landUse, for land, residential, commercial, industrial or other; code, the assessor's code that decided.
export function classifyColorado({ codes = [], uses = [], units = null } = {}) {
  const slots = (codes ?? []).map((c) => ({ code: String(c?.code ?? '').trim(), value: Number(c?.value) > 0 ? Number(c.value) : 0 }))
    .map((s) => ({ ...s, ...kindOfCode(s.code, { units }) })).filter((s) => s.kind);
  if (!slots.length) return { kind: 'other', sector: null, landUse: null, code: null, why: 'no assessor class' };
  const improved = slots.filter((s) => s.kind !== 'land');
  const pool = improved.length ? improved : slots;
  const byKind = new Map();
  for (const s of pool) { const k = byKind.get(s.kind) ?? { kind: s.kind, value: 0, slots: [] }; k.value += s.value; k.slots.push(s); byKind.set(s.kind, k); }
  let win;
  if (byKind.size === 1) win = [...byKind.values()][0];
  else {
    const ranked = [...byKind.values()].sort((a, b) => b.value - a.value);
    if (!(ranked[0].value > ranked[1].value)) return { kind: 'other', sector: null, landUse: null, code: null, why: 'codes of more than one kind, with no value to choose by' };
    win = ranked[0];
  }
  if (win.kind === 'land') {
    // Within land, the use holding the most value.
    const byUse = new Map();
    for (const s of win.slots) { const e = byUse.get(s.landUse) ?? { landUse: s.landUse, value: 0, code: s.code }; e.value += s.value; byUse.set(s.landUse, e); }
    const uses2 = [...byUse.values()];
    if (uses2.length > 1 && uses2.filter((e) => e.value === most(uses2).value).length > 1) return { kind: 'land', sector: null, landUse: 'other', code: win.slots[0].code, why: 'land of more than one use, with no value to choose by' };
    const best = most(uses2);
    return { kind: 'land', sector: null, landUse: best.landUse, code: best.code };
  }
  if (win.kind !== 'commercial') return { kind: win.kind, sector: null, landUse: null, code: win.slots[0].code };
  // The sector holding the most value; the first in the record's order on a tie. A mixed code's sector comes from the building use.
  const bySector = new Map();
  for (const s of win.slots) {
    const sector = s.sector === 'mixed' ? (uses ?? []).map(sectorOfUse).find(Boolean) ?? 'other-commercial' : s.sector;
    const e = bySector.get(sector) ?? { sector, value: 0, code: s.code };
    e.value += s.value; bySector.set(sector, e);
  }
  // Sectors of equal value (often every value 0, where the assessor left them blank): the building use decides when it names one of the
  // tied sectors; otherwise 'other-commercial'. Commercial either way, so still a lead: only the sector label is never a guess.
  const sectors = [...bySector.values()];
  const best = most(sectors);
  const tied = sectors.filter((e) => e.value === best.value);
  if (tied.length > 1) {
    const byUse = (uses ?? []).map(sectorOfUse).find((s) => s && tied.some((e) => e.sector === s));
    const pick = byUse ? tied.find((e) => e.sector === byUse) : null;
    return pick ? { kind: 'commercial', sector: pick.sector, landUse: null, code: pick.code } : { kind: 'commercial', sector: 'other-commercial', landUse: null, code: tied[0].code, why: 'commercial codes of more than one sector, with no value to choose by' };
  }
  return { kind: 'commercial', sector: best.sector, landUse: null, code: best.code };
}
