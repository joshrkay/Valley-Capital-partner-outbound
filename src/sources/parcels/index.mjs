// The parcel sources (src/parcels.mjs, docs/county-loans.md section 3a): one adapter per county, by the county source id whose documents
// it serves. Only Jefferson has one. Kept apart from src/parcels.mjs so the scope rule (src/loans.mjs) can tell a county with no parcel
// source from a filing not looked up yet, without importing the lookup.
import { jeffersonParcels } from './jefferson.mjs';

const ADAPTERS = [jeffersonParcels];
export const PARCEL_SOURCES = Object.freeze(Object.fromEntries(ADAPTERS.flatMap((a) => a.countySourceIds.map((id) => [id, a]))));
export const parcelSourceFor = (sourceId, registry = PARCEL_SOURCES) => registry[sourceId] ?? null;
