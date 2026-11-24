// Jefferson County, Colorado: the county's public parcel layer, for the property type of a county filing (src/parcels.mjs,
// docs/county-loans.md section 3a). One adapter per county; only Jefferson has one.
//
// THE SOURCE. An ArcGIS FeatureServer layer, open with no token (capabilities Query and Extract, maxRecordCount 2000):
//   https://gisportal.jeffco.us/server2/rest/services/Parcel/FeatureServer/20/query
// The host has no robots.txt (404, checked 2026-11-23); the lookup reads it again on every run all the same, and stops if one appears
// that disallows the layer.
//
// THE LICENCE. "Jefferson County GIS data is covered by the Creative Commons Attribution 4.0 International License"
// (https://www.jeffco.us/3165/Maps-Data-Download, read 2026-11-23): commercial use and storage are allowed with attribution. Wherever a
// property type read from it is shown (the bank page, the events, the triage, the command line), it is attributed as ATTRIBUTION.
//
// WHAT IS READ. The site address (to match), the assessor's classification codes with their actual values, the building uses, units
// and buildings, and the schedule number and PIN that identify the parcel. NEVER an owner or a mailing address (OWNNAM*, OWNICO, DBA,
// MAIL*): they are personal data, the query never asks for them, and parcelOf never copies them even if a response carried them.
import { classifyColorado } from './colorado.mjs';

export const JEFFERSON_PARCELS_HOST = 'gisportal.jeffco.us';
export const ATTRIBUTION = 'Jefferson County Assessor parcel data (CC BY 4.0)';

const SLOTS = ['', '2', '3', '4', '5', '6'];
// Every field the query asks for. Owner and mailing fields are never among them (test/parcels.test.mjs checks).
export const OUT_FIELDS = Object.freeze([
  'SCH', 'PIN', 'PRPSTRNUM', 'PRPSTRDIR', 'PRPSTRNAM', 'PRPSTRTYP', 'PRPSTRSFX', 'PRPSTRUNT', 'PRPADDRESS', 'PRPCTYNAM', 'PRPZIP5',
  ...SLOTS.map((n) => `TAXCLS${n}`), ...SLOTS.map((n) => `VALACT${n}`),
  'STTTYPUSE', 'STTTYPUSE2', 'STTTYPUSE3', 'STTTYPUSE4', 'STTNBRUNT', 'STTNBRUNT2', 'STTNBRUNT3', 'STTNBRUNT4', 'STTNBRBLDG', 'STTNBRBLD2', 'STTNBRBLD3', 'STTNBRBLD4',
]);

const text = (v) => (v === undefined || v === null ? null : String(v).replace(/\s+/g, ' ').trim() || null);
const upper = (v) => text(v)?.toUpperCase() ?? null;
const count = (...vs) => vs.map((v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0)).reduce((a, b) => a + b, 0);

export const jeffersonParcels = Object.freeze({
  id: 'co-jefferson-assessor-parcels',
  label: 'Jefferson County Assessor parcel data',
  countySourceIds: Object.freeze(['jefferson']),
  attribution: ATTRIBUTION,
  licence: Object.freeze({ name: 'Creative Commons Attribution 4.0 International', short: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/', terms: 'https://www.jeffco.us/3165/Maps-Data-Download', checkedOn: '2026-11-23' }),
  host: JEFFERSON_PARCELS_HOST,
  endpoint: `https://${JEFFERSON_PARCELS_HOST}/server2/rest/services/Parcel/FeatureServer/20/query`,
  robots: Object.freeze({ url: `https://${JEFFERSON_PARCELS_HOST}/robots.txt`, checkedOn: '2026-11-23', status: 404 }),
  outFields: OUT_FIELDS,
  // At most this many (number AND ZIP) or (number AND city) clauses in one OR query, and this long between requests at least.
  maxClauses: 40,
  minIntervalMs: 1500,
  // The street number is a string zero-padded to five digits ("00711"); a longer one cannot be on the layer.
  numberKey: (n) => (/^\d{1,5}$/.test(String(n)) ? String(n).padStart(5, '0') : null),
  // The city names a filing writes that the layer spells otherwise.
  cityAliases: Object.freeze({ WHEATRIDGE: 'WHEAT RIDGE' }),
  // One clause of the OR query. The values are digits and a city's letters only (src/parcels.mjs checks), so nothing can break out of
  // the quotes; a quote is doubled all the same. The layer holds a few cities in lower case, so the city is compared upper-cased.
  clause: ({ number, zip, city }) => (zip ? `(PRPSTRNUM='${number}' AND PRPZIP5='${zip}')` : `(PRPSTRNUM='${number}' AND UPPER(PRPCTYNAM)='${String(city).replace(/'/g, "''")}')`),
  // A feature's attributes to a parcel: its identifiers, site address (to match, never stored), codes with their values, uses, units
  // and buildings. Nothing else is read.
  parcelOf: (a = {}) => ({
    sch: text(a.SCH), pin: text(a.PIN),
    number: /^\d+$/.test(text(a.PRPSTRNUM) ?? '') ? String(Number(a.PRPSTRNUM)).padStart(5, '0') : null,
    street: [a.PRPSTRDIR, a.PRPSTRNAM, a.PRPSTRTYP, a.PRPSTRSFX].map(text).filter(Boolean).join(' ') || (text(a.PRPADDRESS)?.replace(/^\d+\s+/, '') ?? null),
    unit: text(a.PRPSTRUNT), city: upper(a.PRPCTYNAM), zip: /^\d{5}$/.test(text(a.PRPZIP5) ?? '') ? text(a.PRPZIP5) : null,
    codes: SLOTS.map((n) => ({ code: text(a[`TAXCLS${n}`]), value: Number(a[`VALACT${n}`]) || 0 })).filter((c) => c.code),
    uses: ['STTTYPUSE', 'STTTYPUSE2', 'STTTYPUSE3', 'STTTYPUSE4'].map((k) => text(a[k])).filter(Boolean),
    units: count(a.STTNBRUNT, a.STTNBRUNT2, a.STTNBRUNT3, a.STTNBRUNT4) || null,
    buildings: count(a.STTNBRBLDG, a.STTNBRBLD2, a.STTNBRBLD3, a.STTNBRBLD4) || null,
  }),
  classify: classifyColorado,
});
