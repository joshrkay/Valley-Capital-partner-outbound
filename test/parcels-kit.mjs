// Invented parcel matches for tests (docs/county-loans.md 3a). Only a filing whose county parcel record confirms a commercial property
// is a lead, so a test of the index, the events, the triage or the CMBS link records a match for its invented documents first: in
// loans/parcels/<source>.json, as src/parcels.mjs lookupParcels writes it, with no network. Nothing here is real.
import { readJson, writeJson } from '../src/store.mjs';
import { loansPaths, loadDocuments } from '../src/loans.mjs';

export const ATTRIBUTION = 'Example County Assessor parcel data (CC BY 4.0)';
// A matched record of each class a test needs: { kind, sector, landUse, decidedBy, uses, units }.
export const CLASSES = Object.freeze({
  retail: { kind: 'commercial', sector: 'retail', decidedBy: '2112', uses: ['Store, Retail'] },
  hotel: { kind: 'commercial', sector: 'hospitality', decidedBy: '2115', uses: ['Hotel - Limited Service'], units: 40 },
  apartments: { kind: 'commercial', sector: 'multifamily', decidedBy: '1125', uses: ['Apartments with GL Units'], units: 24 },
  office: { kind: 'commercial', sector: 'office', decidedBy: '2120', uses: ['Office Building'] },
  industrial: { kind: 'commercial', sector: 'industrial', decidedBy: '2135', uses: ['Storage Warehouse'] },
  otherCommercial: { kind: 'commercial', sector: 'other-commercial', decidedBy: '2130', uses: ['Restaurant'] },
  commercialLand: { kind: 'land', landUse: 'commercial', decidedBy: '0200', uses: [] },
  house: { kind: 'residential', decidedBy: '1112', uses: ['1 Story/Ranch'] },
  residentialLand: { kind: 'land', landUse: 'residential', decidedBy: '0100', uses: [] },
  exempt: { kind: 'exempt', decidedBy: '9149', uses: [] },
});

const record = (id, cls) => ({
  documentId: id, addressKey: '0000000000000000', checkedAt: '2026-11-16T12:00:00.000Z', status: 'matched', query: 'zip',
  how: { street: 'exact', place: 'zip', unit: false }, confidence: 'high', candidates: 1, parcelCount: 1,
  parcels: [{ sch: '000001', pin: '00-000-00-001', codes: [{ code: cls.decidedBy, value: 100000 }], uses: cls.uses ?? [], units: cls.units ?? null, buildings: 1 }],
  kind: cls.kind, sector: cls.sector ?? null, landUse: cls.landUse ?? null, decidedBy: cls.decidedBy,
});

// Records a parcel match for documents of one source: `ids` (all the source's stored documents when null), each of class `cls` (a key
// of CLASSES or a class object), or by id through `byId`. Statuses other than 'matched' are given as { status }.
// `cls` may also be a function of the stored document, for documents whose ids a test does not know in advance (a hashed number).
export function confirmParcels(dir, sourceId, { ids = null, cls = 'retail', byId = {} } = {}) {
  const path = loansPaths(dir).parcels(sourceId);
  const file = readJson(path, null) ?? { sourceId, parcelSource: 'example-parcels', label: 'Example County Assessor parcel data', attribution: ATTRIBUTION, contextOnly: true, matches: {} };
  const docs = loadDocuments(dir, sourceId) ?? {};
  const all = ids ?? Object.keys(docs);
  for (const id of all) {
    const c = byId[id] ?? (typeof cls === 'function' ? cls(docs[id]) : cls);
    const o = typeof c === 'string' ? CLASSES[c] : c;
    file.matches[id] = o.status && o.status !== 'matched' ? { documentId: id, addressKey: '0000000000000000', checkedAt: '2026-11-16T12:00:00.000Z', status: o.status } : record(id, o);
  }
  writeJson(path, file);
  return file;
}

// A parcel lookup for runNoticeSource's `parcels` hook: confirms every stored document of the source (as `cls`, or per id), with no
// network. Returns counts as lookupParcels does.
export const confirmAll = (cls = 'retail', byId = {}) => async ({ dir, sourceId }) => {
  const f = confirmParcels(dir, sourceId, { cls, byId });
  return { sourceId, outcome: 'ok', looked: Object.keys(f.matches).length, matched: Object.keys(f.matches).length, ambiguous: 0, unmatched: 0, noAddress: 0, noPlace: 0, failed: 0, requests: 0 };
};

// The parcel file a platform test stores as a document (loans/parcels/<source>.json), for documents it names: { path, body }.
export function parcelDocument(sourceId, ids, cls = 'retail') {
  const o = typeof cls === 'string' ? CLASSES[cls] : cls;
  return { path: `loans/parcels/${sourceId}.json`, body: { sourceId, parcelSource: 'example-parcels', label: 'Example County Assessor parcel data', attribution: ATTRIBUTION, contextOnly: true, matches: Object.fromEntries(ids.map((id) => [id, record(id, o)])) } };
}
