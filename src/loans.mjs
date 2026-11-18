// County loan documents (docs/county-loans.md; docs/county-data-build-vs-buy.md 3.2, 3.4 and 5.2): the parts of the county pipeline that
// do not depend on any county's format.
//   - The record: one per public-records document about a loan (a notice of trustee's sale, a deed of trust, an assignment...), with a
//     stable id per source and document number, so a weekly re-read is idempotent and a new document is detectable as new.
//   - The weekly watcher's diff (component 9): write a new document, update a changed one, leave an unchanged one alone.
//   - The index: every stored document's lender, beneficiary or holder matched to a bank (component 5, src/lenders.mjs), giving one file
//     per bank (what the bank page reads), the review list of names that matched no bank or several, and a dated event for each
//     document newly matched to a bank.
// Each county's adapter (src/sources/notices.mjs, src/counties.mjs) only fetches and parses; everything here is shared.
//
// RULES. Loan and borrower detail is context for the firm's principals only. It lives in the data folder's loans/ and the platform
// database, never in this repository, a log or a message. No model-facing action loads loans/ (src/uow.mjs; test/loans-handoff.test.mjs),
// and a bank's file holds no borrower, grantor or property address. The change log names a changed field, never its value. Events are
// context: no score, weight or tier reads them (LOADS.score does not cover loans/, and scoring.json has no county signal).
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { readJson, writeJson, listFiles, appendJsonl, safeId } from './store.mjs';
import { paperFileId } from './paper.mjs';
import { fdicPaths } from './sources/fdic.mjs';
import { loadAliases } from './candidates.mjs';
import { sourceBlock, CHANGES, CONTEXT_ONLY_VALUE } from './sources/runlog.mjs';
import { matchLender, reviewKey, bankLike, cleanLenderName, naturalPerson, LENDER_ROLES, SET_ASIDE, PERSON_WITHHELD } from './lenders.mjs';

export const CONTEXT_NOTE = 'Context for the firm\'s principals only: never in a message, never given to a model, never scored.';

// ---- Scope: commercial loans only ----------------------------------------------------------------------------------------------
// The firm buys commercial real estate loans, and most loans a county's foreclosure list names are home mortgages. One rule decides,
// everywhere the pipeline builds what a principal sees (each bank's file, the review list, the events; the triage and the bank page
// check it again): a document is IN SCOPE unless it is known to be residential.
//   1. Its loan type reads as a residential program or label (FNMA, FHA, VA, Conventional...): the stored commercial flag is false.
//      A stored null is read again from the type, so a type the classifier learns later applies to the documents already stored.
//   2. A document with no loan type of its own takes its case's: another document of the same foreclosure in the same source that gives
//      one (a Colorado pre-sale entry and its NED).
//   3. With no loan type that says commercial or residential (none at all, as in Caldwell and Douglas, or "Unknown"), every borrower
//      and grantor it names is a natural person, not an entity: a home loan in all but name.
// Otherwise it is in scope: a commercial type, an entity among the borrowers, or none named. A document out of scope stays in
// loans/docs/<source>.json (the weekly diff stays idempotent), and nothing downstream uses it.
export const OUT_OF_SCOPE = Object.freeze({ 'residential-loan-type': 'a residential loan type', 'individual-borrowers': 'every borrower a person, no commercial loan type' });

// The county's loan type, as written, to the commercial flag: true for a commercial, business-purpose, construction, SBA or multifamily
// loan; false for the residential programs and labels (a HELOC included); null for a blank, "Unknown" or any other type (never guessed,
// and then rule 3 decides). Case, punctuation and spaces are ignored ("F.H.A.", "Fannie-Mae", "CONVENTIONAL RESIDENTIAL"), and so is
// the misspelling "Commerical" that Jefferson's own reports carry.
const RESIDENTIAL_TYPES = new Set(['fnma', 'fanniemae', 'fhlmc', 'freddiemac', 'fha', 'va', 'usda', 'rhs', 'usdarhs', 'gnma', 'ginniemae',
  'conventional', 'conv', 'conventionalresidential', 'convresidential', 'residential', 'reverse', 'reversemortgage', 'hecm',
  'heloc', 'homeequity', 'homeequityloan', 'homeequityline', 'homeequitylineofcredit']);
const COMMERCIAL_WORDS = /\b(?:comm?er(?:ci|ic)al|business|construction|multi ?family|sba)\b|^bpl\b/;
export function commercialFromLoanType(type) {
  const words = String(type ?? '').toLowerCase().replace(/\./g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  if (!words) return null;
  if (COMMERCIAL_WORDS.test(words)) return true;
  return RESIDENTIAL_TYPES.has(words.replace(/ /g, '')) ? false : null;
}

// A document's case, for rule 2: its source and foreclosure number.
const caseKey = (doc) => (doc?.foreclosure?.number ? `${doc.sourceId}|${String(doc.foreclosure.number).toUpperCase()}` : null);
const flagOf = (loan) => (typeof loan?.commercial === 'boolean' ? loan.commercial : commercialFromLoanType(loan?.type));

// One document's scope. `caseLoan` is the loan of another document of its case, for one with no loan type. Returns { inScope, why,
// loanType, commercial, borrowers }: why is a key of OUT_OF_SCOPE or null; borrowers is 'individuals' (every borrower and grantor a
// natural person), 'entity' (at least one is not) or null (none named, or the loan type decided). No name is returned.
export function loanScope(doc, { caseLoan = null } = {}) {
  const loan = doc?.loan?.type ? doc.loan : caseLoan?.type ? caseLoan : null;
  const commercial = loan ? flagOf(loan) : null;
  if (commercial !== null) {
    return { inScope: commercial, why: commercial ? null : 'residential-loan-type', loanType: loan.type, commercial, borrowers: null };
  }
  // No type, or one that says neither ("Unknown"): the borrowers decide (rule 3).
  const names = (doc?.parties ?? []).filter((p) => p.role === 'borrower' || p.role === 'grantor').map((p) => p.name);
  const borrowers = !names.length ? null : names.every(naturalPerson) ? 'individuals' : 'entity';
  return { inScope: borrowers !== 'individuals', why: borrowers === 'individuals' ? 'individual-borrowers' : null, loanType: loan?.type ?? null, commercial: null, borrowers };
}

// Every document's scope, by id: the documents of one source or all, with each case's loan type for rule 2.
export function scopeAll(docs = []) {
  const cases = new Map();
  for (const d of docs) { const k = caseKey(d); if (k && d.loan?.type && !cases.has(k)) cases.set(k, d.loan); }
  return new Map(docs.map((d) => [d.id, loanScope(d, { caseLoan: cases.get(caseKey(d)) ?? null })]));
}

// The guard the triage and the bank page apply to what the index wrote: a bank's row or an event shows only when the scope rule wrote it
// (it carries `scope`) and that scope is not residential. A file written before the rule, or by anything else, shows nothing until
// `outbound loans rebuild` writes it again.
export const scopeShown = (x) => !!x?.scope && typeof x.scope === 'object' && x.scope.commercial !== false && x.scope.borrowers !== 'individuals';
// An event also needs a match on the bank that holds the loan now (relation 'current'): never one that only originated it.
export const eventShown = (e) => scopeShown(e) && e.relation === 'current';

// ---- What a document is --------------------------------------------------------------------------------------------------------
// Every document type the pipeline keeps, with the stage of a loan's life it marks. A county's own codes map to these in its adapter.
export const DOC_TYPES = Object.freeze({
  notice_of_trustee_sale: { label: 'Notice of trustee\'s sale', lower: 'notice of trustee\'s sale', stage: 'sale' },
  notice_of_default: { label: 'Notice of default', lower: 'notice of default', stage: 'default' },
  election_and_demand: { label: 'Notice of election and demand', lower: 'notice of election and demand', stage: 'default' },
  rule_120_notice: { label: 'Rule 120 notice', lower: 'Rule 120 notice', stage: 'court' },
  lis_pendens: { label: 'Lis pendens', lower: 'lis pendens', stage: 'court' },
  assignment: { label: 'Assignment', lower: 'assignment', stage: 'assigned' },
  deed_of_trust: { label: 'Deed of trust', lower: 'deed of trust', stage: 'recorded' },
  trustees_deed: { label: 'Trustee\'s deed', lower: 'trustee\'s deed', stage: 'foreclosed' },
  release: { label: 'Release', lower: 'release', stage: 'released' },
});
export const STAGES = Object.freeze({
  recorded: 'Loan recorded', assigned: 'Loan assigned', default: 'Foreclosure started', court: 'In court', sale: 'Sale scheduled',
  foreclosed: 'Sold at foreclosure', released: 'Released',
});
// Party roles as the document names them. LENDER_ROLES (src/lenders.mjs) are the ones matched to a bank. Neither of the last two is
// ever matched:
//   owner     the property's current owner where a list names one apart from the borrower (Colorado's NED reports do): borrower side
//   servicer  the mortgage servicer, which a Texas notice names apart from the mortgagee: it collects for the lender, it is not one
export const ROLES = Object.freeze(['lender', 'beneficiary', 'holder', 'assignor', 'assignee', 'trustee', 'attorney', 'borrower', 'grantor', 'owner', 'servicer']);
// recorded: the county recorded it; filed: a court or clerk filing; listed: the date of the county's own list that gave it, for an entry
// that is not itself a recorded document (a pre-sale list's run date); sale: the scheduled sale; notice: the date the notice itself
// states (a Texas notice of sale is dated by its trustee or attorney, and the clerk's filed stamp is often unreadable).
export const DATE_KINDS = Object.freeze(['recorded', 'filed', 'listed', 'sale', 'notice']);
export const AMOUNT_KINDS = Object.freeze(['originalPrincipal', 'unpaidBalance']);
// A Colorado public trustee's foreclosure file: its amounts, read with the same rules as the document's.
export const FORECLOSURE_AMOUNTS = Object.freeze(['bid', 'deficiency']);
// Where an amount comes from. A stated amount (document, index) has a value in dollars; the other two have none.
export const AMOUNT_BASES = Object.freeze({
  document: 'stated on the document', index: 'in the county\'s index', 'not-stated': 'not stated on the document', 'not-read': 'not read yet',
});
// Property types, from the assessor's use code once a county's join is built. Null until then: "not known yet", never a guess.
export const PROPERTY_TYPES = Object.freeze({
  office: 'Office', retail: 'Retail', hotel: 'Hotel', industrial: 'Industrial', multifamily: 'Apartments', 'mixed-use': 'Mixed use',
  land: 'Land', 'other-commercial': 'Other commercial', residential: 'Residential',
});

// ---- Ids and hashes ------------------------------------------------------------------------------------------------------------
// The id is the source and the document's own number: "example-county:2026-001234". A county's recording number is unique within
// the county; a list keyed by a case or foreclosure number that carries several documents gives each its own suffix
// (FC-2026-0001/NED), which its adapter decides. Case and spaces are ignored, so a re-read always lands on the same id.
const DOCNUM = /^[A-Z0-9][A-Z0-9./_-]{0,63}$/;
export const docNumberKey = (n) => String(n ?? '').trim().toUpperCase().replace(/\s+/g, '');
export function documentId(sourceId, number) {
  safeId(sourceId);
  const k = docNumberKey(number);
  if (!DOCNUM.test(k)) throw new Error(`document number "${number ?? ''}" is empty or holds characters other than letters, digits and . / _ -`);
  return `${sourceId}:${k}`;
}

const stable = (v) => (Array.isArray(v) ? `[${v.map(stable).join(',')}]` : v && typeof v === 'object'
  ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}` : JSON.stringify(v ?? null));
// The fields that make a document what it is. The fetch date, the run and the first-seen date are not among them, so reading the same
// document again gives the same hash.
//   loan         the county's own loan type, as written ("BPL Commercial"), and the commercial flag its adapter reads from it (null
//                when the type is blank or one the adapter does not know: never guessed)
//   foreclosure  a public trustee's foreclosure file, where the list gives one (Colorado): its number, the NED's reception number,
//                the publication dates, the lender's bid and the deficiency, and the attorney's file number
//   salePlace    where the sale is held, when the notice says (a Texas notice does)
//   unread       the fields the source gave but that failed their check (a date that is not a date, an amount that is not money, an OCR
//                misread): each is left empty and named here by its place in the record, never guessed, so "not read" is never
//                confused with "not on the document". An amount that failed also says so in its own basis, 'not-read'
const CONTENT = ['sourceId', 'county', 'state', 'documentType', 'documentNumber', 'dates', 'parties', 'property', 'amounts', 'deedOfTrust', 'loan', 'foreclosure', 'salePlace', 'unread'];
export const contentOf = (r) => ({ ...Object.fromEntries(CONTENT.map((k) => [k, r?.[k] ?? null])), urls: (r?.sources ?? []).map((s) => s.url).sort() });
export const hashDocument = (r) => createHash('sha256').update(stable(contentOf(r))).digest('hex').slice(0, 16);

// Every key a stored document may carry. Nothing else is stored, so an adapter cannot add a field (a phone, a note) by accident.
export const RECORD_KEYS = Object.freeze(['id', ...CONTENT, 'sources', 'contentHash', 'contextOnly', 'firstSeenAt', 'firstRunId', 'updatedAt', 'updatedRunId', '_source']);
const PARSED_KEYS = new Set(['documentType', 'documentNumber', 'dates', 'parties', 'property', 'amounts', 'deedOfTrust', 'loan', 'foreclosure', 'salePlace', 'unread', 'url', 'etag', 'listLink']);
const FIELD_PATH = /^[a-z][A-Za-z]*(\.[a-z][A-Za-z]*){0,2}$/;

// ---- Building a record ---------------------------------------------------------------------------------------------------------
const YMD = /^\d{4}-\d{2}-\d{2}$/;
export const validYmd = (s) => typeof s === 'string' && YMD.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const text = (v) => (v === undefined || v === null ? null : String(v).replace(/\s+/g, ' ').trim() || null);

// From what an adapter parsed (one document) to a stored record. `source` is the adapter (its id, county, state and hosts). Returns
// { record, errors }: a document with any error is not a record, and the run that read it fails before anything is written.
export function buildDocument(parsed, { source, fetchedAt, runId }) {
  const errors = [];
  const err = (m) => errors.push(m);
  const p = parsed && typeof parsed === 'object' ? parsed : {};
  for (const k of Object.keys(p)) if (!PARSED_KEYS.has(k)) err(`"${k}" is not a field of a document`);
  const documentType = p.documentType;
  if (!DOC_TYPES[documentType]) err(`document type "${documentType}" is not one of ${Object.keys(DOC_TYPES).join(', ')}`);
  const documentNumber = text(p.documentNumber);
  let id = null;
  try { id = documentId(source.id, documentNumber); } catch (e) { err(e.message); }

  const dates = {};
  for (const k of DATE_KINDS) {
    const v = p.dates?.[k] ?? null;
    if (v !== null && !validYmd(v)) err(`dates.${k} "${v}" is not a date (YYYY-MM-DD)`);
    dates[k] = v;
  }
  if (!dates.recorded && !dates.filed && !dates.listed && !dates.notice && !(documentType === 'notice_of_trustee_sale' && dates.sale))
    err('the document has neither a recording date nor a filing date, nor a notice date, nor the date of the list that gave it');

  const parties = [];
  for (const x of Array.isArray(p.parties) ? p.parties : []) {
    if (!ROLES.includes(x?.role)) { err(`party role "${x?.role}" is not one of ${ROLES.join(', ')}`); continue; }
    const name = text(x.name);
    if (!name) { err(`a ${x.role} with no name`); continue; }
    const state = text(x.state);
    if (state !== null && !/^[A-Z]{2}$/.test(state)) err(`a party's state "${state}" is not a two-letter code`);
    const party = { role: x.role, name, city: text(x.city), state };
    if (!parties.some((q) => q.role === party.role && q.name === party.name)) parties.push(party);
  }
  if (!parties.some((q) => LENDER_ROLES.includes(q.role))) err('the document names no lender, beneficiary or holder');

  const pt = p.property?.propertyType ?? null;
  if (pt !== null && !PROPERTY_TYPES[pt]) err(`property type "${pt}" is not one of ${Object.keys(PROPERTY_TYPES).join(', ')}`);
  // The legal description is kept only where the list gives one, so a source without it keeps the shorter shape.
  const legal = text(p.property?.legal);
  const property = { address: text(p.property?.address), apn: text(p.property?.apn), ...(legal ? { legal } : {}), useCode: text(p.property?.useCode), propertyType: pt };

  // An amount: its value with its basis; with the county's own label for the figure ("Total Indebtedness") and the date it is as of,
  // where the list gives them.
  const amountOf = (a = {}, where) => {
    const raw = a.value === undefined || a.value === null || a.value === '' ? null : Number(a.value);
    const basis = a.basis ?? 'not-read';
    if (!AMOUNT_BASES[basis]) { err(`${where}: basis "${basis}" is not one of ${Object.keys(AMOUNT_BASES).join(', ')}`); return null; }
    const stated = basis === 'document' || basis === 'index';
    if (stated && !(Number.isFinite(raw) && raw >= 0)) err(`${where}: an amount ${AMOUNT_BASES[basis]} needs a value in dollars`);
    if (!stated && raw !== null) err(`${where}: an amount ${AMOUNT_BASES[basis]} has no value`);
    const label = text(a.label), asOf = a.asOf ?? null;
    if (asOf !== null && !validYmd(asOf)) err(`${where}.asOf "${asOf}" is not a date (YYYY-MM-DD)`);
    return { value: stated ? raw : null, unit: 'dollars', basis, ...(label ? { label } : {}), ...(asOf ? { asOf } : {}) };
  };
  const amounts = {};
  for (const k of AMOUNT_KINDS) { const a = amountOf(p.amounts?.[k] ?? {}, `amounts.${k}`); if (a) amounts[k] = a; }

  // The deed of trust the document refers to: its recording number (or book and page; a Texas clerk calls the book a volume), when it
  // was recorded, and the date it was signed (`dated`), which a notice gives apart from the recording.
  let deedOfTrust = null;
  if (p.deedOfTrust) {
    const dated = p.deedOfTrust.dated ?? null;
    const d = { documentNumber: text(p.deedOfTrust.documentNumber), recorded: p.deedOfTrust.recorded ?? null, ...(dated ? { dated } : {}), book: text(p.deedOfTrust.book), page: text(p.deedOfTrust.page) };
    if (d.recorded !== null && !validYmd(d.recorded)) err(`deedOfTrust.recorded "${d.recorded}" is not a date (YYYY-MM-DD)`);
    if (dated !== null && !validYmd(dated)) err(`deedOfTrust.dated "${dated}" is not a date (YYYY-MM-DD)`);
    if (d.documentNumber || d.recorded || d.dated || (d.book && d.page)) deedOfTrust = d;
  }
  const salePlace = text(p.salePlace);
  const etag = text(p.etag);

  // The county's loan type and the commercial flag read from it. A flag without a type would be a guess.
  let loan = null;
  if (p.loan) {
    const type = text(p.loan.type), commercial = p.loan.commercial ?? null;
    if (commercial !== null && typeof commercial !== 'boolean') err('loan.commercial must be true, false or null');
    if (commercial !== null && !type) err('loan.commercial is set without the loan type it is read from');
    if (type && type.length > 60) err('loan.type is longer than a loan type');
    if (type || commercial !== null) loan = { type, commercial };
  }

  let foreclosure = null;
  if (p.foreclosure) {
    const f = p.foreclosure;
    const pair = (x, where) => {
      if (!x) return null;
      const o = { first: x.first ?? null, last: x.last ?? null };
      for (const k of ['first', 'last']) if (o[k] !== null && !validYmd(o[k])) err(`${where}.${k} "${o[k]}" is not a date (YYYY-MM-DD)`);
      return o.first || o.last ? o : null;
    };
    const fc = {
      number: text(f.number), reception: text(f.reception), attorneyFileNumber: text(f.attorneyFileNumber),
      publication: pair(f.publication, 'foreclosure.publication'), amendedPublication: pair(f.amendedPublication, 'foreclosure.amendedPublication'),
    };
    for (const k of FORECLOSURE_AMOUNTS) fc[k] = f[k] ? amountOf(f[k], `foreclosure.${k}`) : null;
    for (const k of ['number', 'reception', 'attorneyFileNumber']) if (fc[k] && fc[k].length > 80) err(`foreclosure.${k} is too long to be a number`);
    if (Object.values(fc).some((v) => v !== null)) foreclosure = fc;
  }

  const unread = [];
  for (const u of Array.isArray(p.unread) ? p.unread : []) {
    if (!FIELD_PATH.test(String(u))) { err(`unread: "${u}" is not a field name`); continue; }
    if (!unread.includes(u)) unread.push(u);
  }
  unread.sort();

  let link = null, listUrl = null;
  try {
    const u = new URL(text(p.url) ?? '');
    if (!['https:', 'http:'].includes(u.protocol)) throw new Error('scheme');
    if (!(source.hosts ?? []).includes(u.host)) err(`the document's link is on ${u.host}, which is not one of the source's hosts`);
    link = u.toString();
  } catch { err(`the document's link "${p.url ?? ''}" is not a web address`); }
  // Where the list shows the document, for a source whose document links name a person (a Texas notice's file is named for the debtor):
  // the bank's file and the events carry this link instead of the document's own.
  if (p.listLink !== undefined && p.listLink !== null) {
    try {
      const u = new URL(String(p.listLink));
      if (!['https:', 'http:'].includes(u.protocol) || !(source.hosts ?? []).includes(u.host)) throw new Error('host');
      listUrl = u.toString();
    } catch { err('the list link is not a web address on one of the source\'s hosts'); }
  }

  if (errors.length) return { record: null, errors };
  const record = {
    id, sourceId: source.id, county: { fips: source.county.fips, name: source.county.name }, state: source.state,
    documentType, documentNumber, dates, parties, property, amounts, deedOfTrust, loan, foreclosure, salePlace, unread,
    sources: [{ url: link, fetchedAt, ...(etag ? { etag } : {}), ...(listUrl ? { listUrl } : {}) }], contextOnly: true,
  };
  record.contentHash = hashDocument(record);
  record._source = sourceBlock({ source: `county:${source.id}`, endpoint: link, query: { source: source.id }, recordId: id, period: documentDate(record).date, fetchedAt, runId });
  return { record, errors: [] };
}

// ---- Where it lives ------------------------------------------------------------------------------------------------------------
// loans/docs/<source>.json   every document a source has given, by id (the watcher writes it)
// loans/banks/fdic-<CERT>.json  the bank's matched documents, without borrower or address (what the bank page reads)
// loans/review.json          names that matched no bank or several, with their candidates; and the names set aside
// loans/events.json          one dated event per document newly matched to a bank
// loans/state.json           each source's runs (last run, documents read, new and changed), and the index's counts
export const loansPaths = (dir) => {
  const base = join(dir, 'loans');
  return {
    base, docsDir: join(base, 'docs'), banksDir: join(base, 'banks'),
    docs: (sourceId) => join(base, 'docs', `${safeId(sourceId)}.json`),
    bank: (key) => join(base, 'banks', `${paperFileId(key)}.json`),
    list: (sourceId) => join(base, 'lists', `${safeId(sourceId)}.json`),
    review: join(base, 'review.json'), events: join(base, 'events.json'), state: join(base, 'state.json'),
  };
};
// The bank's file as a document path, for the platform (the bank page loads only this one, as it loads paper/fdic-<CERT>.json).
export const loanBankRel = (key) => `loans/banks/${paperFileId(key)}.json`;
export const LOAN_STATE_REL = 'loans/state.json';
export const LOAN_EVENTS_REL = 'loans/events.json';

export const loadDocuments = (dir, sourceId) => readJson(loansPaths(dir).docs(sourceId), {});
export function allDocuments(dir) {
  const P = loansPaths(dir);
  return listFiles(P.docsDir, '.json').flatMap((f) => Object.values(readJson(join(P.docsDir, f), {}) ?? {})).filter((d) => d && typeof d.id === 'string');
}
export const readBankLoans = ({ dir, key }) => readJson(loansPaths(dir).bank(key), null);
export const readLoanState = (dir) => readJson(loansPaths(dir).state, { sources: {}, index: null });

// ---- The weekly diff (component 9) ---------------------------------------------------------------------------------------------
// Pure. `store` is a source's stored documents by id; `incoming` the records built from this week's read. A new id is written with the
// run as its first sighting; a known id whose content hash differs is updated, keeping when it was first seen; a known id with the same
// hash is left exactly as it is (the same object, so nothing is rewritten). A document the source no longer lists stays in the store:
// a notice list shows what is current, and the record is history. Within one read, a repeated id counts once (the last wins).
export function diffDocuments(store = {}, incoming = [], { now = new Date(), runId = null } = {}) {
  const at = now.toISOString();
  const byId = new Map();
  let duplicates = 0;
  for (const doc of incoming) { if (byId.has(doc.id)) duplicates++; byId.set(doc.id, doc); }
  const next = { ...store };
  const added = [], changed = [], unchanged = [];
  for (const doc of [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const old = store[doc.id];
    if (!old) { next[doc.id] = { ...doc, firstSeenAt: at, firstRunId: runId, updatedAt: null, updatedRunId: null }; added.push(doc.id); continue; }
    if (old.contentHash === doc.contentHash) { unchanged.push(doc.id); continue; }
    const fields = CONTENT.filter((k) => stable(old[k]) !== stable(doc[k]));
    if (stable(contentOf(old).urls) !== stable(contentOf(doc).urls)) fields.push('sources');
    next[doc.id] = { ...doc, firstSeenAt: old.firstSeenAt ?? at, firstRunId: old.firstRunId ?? runId, updatedAt: at, updatedRunId: runId };
    changed.push({ id: doc.id, fields });
  }
  return { next, added, changed, unchanged, duplicates };
}

// Writes a source's documents after a diff, only when something was added or changed, and logs each changed field by name only: the
// values are loan and borrower detail, which never go in a log.
export function writeDiff(dir, sourceId, diff, { runId, now = new Date() }) {
  if (!diff.added.length && !diff.changed.length) return false;
  writeJson(loansPaths(dir).docs(sourceId), diff.next);
  for (const c of diff.changed) for (const field of c.fields) appendJsonl(CHANGES(dir), { runId, key: c.id, field, old: CONTEXT_ONLY_VALUE, new: CONTEXT_ONLY_VALUE, at: now.toISOString() });
  return true;
}

// ---- Events --------------------------------------------------------------------------------------------------------------------
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const longDate = (s) => (validYmd(s) ? `${MONTHS[Number(s.slice(5, 7)) - 1]} ${Number(s.slice(8, 10))}, ${s.slice(0, 4)}` : String(s ?? ''));
export const countyLabel = (doc) => `${doc?.county?.name ?? 'an unnamed'} County, ${doc?.state ?? ''}`.replace(/, $/, '');
// The date a document is known by: when it was filed, else recorded, else the date the notice itself states, else the date of the
// county list that gave it, else (a notice of sale whose own date could not be read) the sale date it gives.
export const documentDate = (doc) => {
  const d = doc?.dates ?? {};
  if (d.filed) return { date: d.filed, kind: 'filed' };
  if (d.recorded) return { date: d.recorded, kind: 'recorded' };
  if (d.notice) return { date: d.notice, kind: 'notice' };
  if (d.listed) return { date: d.listed, kind: 'listed' };
  if (d.sale) return { date: d.sale, kind: 'sale' };
  return { date: null, kind: 'recorded' };
};
// The link the bank's file and the events carry: where the list shows the document when its own link would name a person.
export const publicLink = (doc) => doc?.sources?.[0]?.listUrl ?? doc?.sources?.[0]?.url ?? null;

// The event's sentence, a fixed template over the document's type, date, county and the bank's role on it. Example: "A notice of
// trustee's sale was filed on November 10, 2026 for a loan from this bank on a property in Example County, CO."
export function eventLabel(doc, roles = []) {
  const t = DOC_TYPES[doc.documentType];
  const { date, kind } = documentDate(doc);
  const article = /^[aeiou]/i.test(t.lower) ? 'An' : 'A';
  // A notice known only by its own date: "A notice of trustee's sale dated November 10, 2026 was posted for a loan ...".
  const lead = kind === 'notice' ? `${article} ${t.lower} dated ${longDate(date)} was posted` : kind === 'sale' ? `${article} ${t.lower} for a sale on ${longDate(date)} was posted`
    : `${article} ${t.lower} was ${kind} on ${longDate(date)}`;
  const where = countyLabel(doc);
  if (roles.includes('assignee')) return `${lead} moving a loan on a property in ${where} to this bank.`;
  if (roles.includes('assignor')) return `${lead} moving a loan on a property in ${where} from this bank to another holder.`;
  if (roles.includes('holder') && !roles.includes('lender') && !roles.includes('beneficiary')) return `${lead} for a loan this bank holds on a property in ${where}.`;
  return `${lead} for a loan from this bank on a property in ${where}.`;
}

// ---- The index: documents to banks ---------------------------------------------------------------------------------------------
const roleOrder = (a, b) => LENDER_ROLES.indexOf(a) - LENDER_ROLES.indexOf(b);
const byNewest = (a, b) => {
  const da = documentDate(a).date ?? '', db = documentDate(b).date ?? '';
  return da !== db ? (da < db ? 1 : -1) : a.id < b.id ? -1 : 1;
};
// How a bank stands to the loan a document names:
//   current     it holds the loan by the document: its current holder, beneficiary or mortgagee (role holder), a party to an assignment,
//               or its lender or deed-of-trust beneficiary when the document names no separate current holder
//   originated  it is named only as the original lender (lender, beneficiary) and the document names another current holder (a CMBS
//               trust's trustee, a fund, another bank). Its page shows the document, "Originated by this bank; now held by <holder>",
//               and no event is written: "a loan from this bank" would mislead
// MERS named as holder with no lender behind it is a nominee, not a separate holder.
const ORIGINATING = ['lender', 'beneficiary'];
const originatedLabel = (heldBy) => `Originated by this bank; now held by ${heldBy ?? 'a person (name withheld)'}`;
// The current holder as the page names it: the name without its legal phrases, a MERS nominee read through. A person is never named.
const holderName = (m) => (m.status === 'set-aside' && m.class === 'person' ? null : m.matchedName || cleanLenderName(m.name) || m.name);

// What the bank page shows for one document: no borrower, grantor or owner, no address, legal description or APN, and nothing of the
// foreclosure file but the loan type and its commercial flag. The labels are the engine's own words, so the page and the command line
// say the same. `scope` is what the scope rule read (the guard checks it again); `relation` and `heldBy` how the bank stands to the loan.
export function loanRow(doc, roles, how, { scope = loanScope(doc), relation = 'current', heldBy = null } = {}) {
  const { date, kind } = documentDate(doc);
  const stage = DOC_TYPES[doc.documentType]?.stage ?? null;
  const pt = doc.property?.propertyType ?? null;
  return {
    id: doc.id, sourceId: doc.sourceId, documentType: doc.documentType, typeLabel: DOC_TYPES[doc.documentType]?.label ?? doc.documentType, documentNumber: doc.documentNumber,
    stage, stageLabel: STAGES[stage] ?? null, county: doc.county, countyLabel: countyLabel(doc), state: doc.state, date, dateKind: kind, saleDate: doc.dates?.sale ?? null, roles, how,
    amounts: doc.amounts, propertyType: pt, propertyTypeLabel: pt ? PROPERTY_TYPES[pt] ?? null : null, useCode: doc.property?.useCode ?? null,
    loanType: scope.loanType, commercial: scope.commercial, scope: { commercial: scope.commercial, borrowers: scope.borrowers },
    relation, heldBy: relation === 'originated' ? heldBy : null, relationLabel: relation === 'originated' ? originatedLabel(heldBy) : null,
    deedOfTrust: doc.deedOfTrust ? { documentNumber: doc.deedOfTrust.documentNumber, recorded: doc.deedOfTrust.recorded, dated: doc.deedOfTrust.dated ?? null, book: doc.deedOfTrust.book ?? null, page: doc.deedOfTrust.page ?? null } : null,
    link: publicLink(doc), firstSeenAt: doc.firstSeenAt ?? null,
  };
}
const sansStamp = ({ builtAt, runId, ...rest }) => stable(rest);
const eventId = (doc, key) => `county:${doc.id}:${key}`;

// One event, from its document, the bank, the bank's roles and the document's scope. `first` is when it was first matched: its run, the
// time and the basis, kept when an event is written again.
function eventOf(doc, key, roles, scope, first) {
  const { date, kind } = documentDate(doc);
  return {
    id: eventId(doc, key), kind: 'event', type: 'county_document', key, documentId: doc.id, sourceId: doc.sourceId, documentType: doc.documentType,
    stage: DOC_TYPES[doc.documentType].stage, roles, date, dateKind: kind, county: doc.county, state: doc.state, link: publicLink(doc),
    label: eventLabel(doc, roles), basis: first.basis, relation: 'current', scope: { commercial: scope.commercial, borrowers: scope.borrowers },
    firstSeenAt: doc.firstSeenAt ?? null, matchedAt: first.matchedAt, runId: first.runId, contextOnly: true, scored: false,
  };
}

// Applies the scope rule to every stored document, matches the lender-side parties of those in scope against the bank list and the
// aliases, then writes each bank's file (rewritten only when its content changed), the review list, and the events: one for each
// document in scope and bank that holds the loan now (relation current), the first time they match: "new-document" when the document
// arrived in this run, "new-match" when an alias a principal added since made it match. An event is kept, and written again from its
// document with when it was first matched, until the rule no longer allows it: its document is out of scope, or the bank only
// originated the loan. Documents out of scope give no bank row, no review name, no set-aside count and no event.
// Returns counts only, with each source's.
export function buildLoanIndex({ dir, now = new Date(), runId = null, institutions, aliases } = {}) {
  const P = loansPaths(dir);
  const inst = institutions ?? readJson(fdicPaths(dir).institutions, {});
  const al = aliases ?? loadAliases(dir);
  const at = now.toISOString();
  const docs = allDocuments(dir).sort(byNewest);
  const scopes = scopeAll(docs);
  const byId = new Map(docs.map((d) => [d.id, d]));
  const banks = new Map(), review = new Map(), aside = new Map(), bySource = {}, outOfScopeWhy = {};
  const pairs = [], notCurrent = new Set();
  let lenderParties = 0, matchedParties = 0, inScope = 0, outOfScope = 0, originated = 0;
  for (const doc of docs) {
    const src = (bySource[doc.sourceId] ??= { documents: 0, inScope: 0, outOfScope: 0, matchedDocuments: 0, reviewNames: 0 });
    src.documents++;
    const scope = scopes.get(doc.id);
    if (!scope.inScope) { outOfScope++; src.outOfScope++; outOfScopeWhy[scope.why] = (outOfScopeWhy[scope.why] ?? 0) + 1; continue; }
    inScope++; src.inScope++;
    const mine = new Map(), holders = [];
    for (const party of doc.parties ?? []) {
      if (!LENDER_ROLES.includes(party.role)) continue;
      lenderParties++;
      const m = matchLender(party, { institutions: inst, aliases: al, documentState: doc.state });
      if (party.role === 'holder' && !(m.status === 'set-aside' && m.class === 'mers')) holders.push(m);
      if (m.status === 'matched') {
        matchedParties++;
        const e = mine.get(m.key) ?? { roles: new Set(), how: m.how };
        e.roles.add(party.role); mine.set(m.key, e);
      } else if (m.status === 'set-aside') {
        // A person set aside is counted, never named: the review list holds no person's name.
        const k = m.class === 'person' ? 'person' : `${m.class}:${reviewKey(m.name)}`;
        const e = aside.get(k) ?? { name: m.class === 'person' ? PERSON_WITHHELD : m.name, class: m.class, why: SET_ASIDE[m.class], count: 0 };
        e.count++; aside.set(k, e);
      } else {
        const k = reviewKey(m.name);
        const e = review.get(k) ?? { name: m.name, status: m.status, bankLike: bankLike(m.matchedName || m.name), roles: [], candidates: m.candidates ?? [], suggestions: m.suggestions ?? [], documents: [], counties: [], count: 0, firstSeenAt: doc.firstSeenAt ?? null };
        if (!e.roles.includes(party.role)) e.roles.push(party.role);
        if (!e.documents.includes(doc.id) && e.documents.length < 20) e.documents.push(doc.id);
        const c = countyLabel(doc);
        if (!e.counties.includes(c)) e.counties.push(c);
        e.count++;
        if (doc.firstSeenAt && (!e.firstSeenAt || doc.firstSeenAt < e.firstSeenAt)) e.firstSeenAt = doc.firstSeenAt;
        if (!review.has(k)) src.reviewNames++;
        review.set(k, e);
      }
    }
    if (mine.size) src.matchedDocuments++;
    for (const [key, e] of mine) {
      const roles = [...e.roles].sort(roleOrder);
      // Named only as the original lender while the document names another current holder: on the bank's page, never an event.
      const other = roles.every((r) => ORIGINATING.includes(r)) ? holders.find((h) => !(h.status === 'matched' && h.key === key)) : null;
      if (other) { originated++; notCurrent.add(eventId(doc, key)); } else pairs.push({ doc, key, roles, scope });
      if (!banks.has(key)) banks.set(key, []);
      banks.get(key).push(loanRow(doc, roles, e.how, { scope, relation: other ? 'originated' : 'current', heldBy: other ? holderName(other) : null }));
    }
  }

  // Each bank's file, and an emptied file for a bank no document matches any more (an alias removed), so its page says so.
  let bankFilesWritten = 0;
  const known = new Set(listFiles(P.banksDir, '.json').map((f) => f.replace(/\.json$/, '')).filter((f) => /^fdic-\d+$/.test(f)).map((f) => `fdic:${f.slice(5)}`));
  for (const key of [...new Set([...banks.keys(), ...known])].sort()) {
    const loans = banks.get(key) ?? [];
    const byStage = {};
    for (const l of loans) byStage[l.stage] = (byStage[l.stage] ?? 0) + 1;
    const rec = { key, builtAt: at, runId, contextOnly: true, note: CONTEXT_NOTE, counts: { documents: loans.length, byStage }, loans };
    const old = readJson(P.bank(key), null);
    if (old && sansStamp(old) === sansStamp(rec)) continue;
    writeJson(P.bank(key), rec);
    bankFilesWritten++;
  }

  // The review list: bank-like names first, then ambiguous ones, then the most documents. Set-aside names apart, so a principal can
  // check the classifier.
  const entries = [...review.values()].sort((a, b) => (Number(b.bankLike) - Number(a.bankLike)) || (Number(b.status === 'ambiguous') - Number(a.status === 'ambiguous')) || (b.count - a.count) || (a.name < b.name ? -1 : 1));
  const setAside = [...aside.values()].sort((a, b) => (a.class !== b.class ? (a.class < b.class ? -1 : 1) : b.count - a.count || (a.name < b.name ? -1 : 1)));
  const reviewRec = { builtAt: at, runId, contextOnly: true, note: CONTEXT_NOTE, entries, setAside };
  const oldReview = readJson(P.review, null);
  if (!oldReview || sansStamp(oldReview) !== sansStamp(reviewRec)) writeJson(P.review, reviewRec);

  // Events: one per document and bank, the first time they are matched. One the rule no longer allows is removed: its document is out
  // of scope, or the bank only originated the loan. One that remains is written again from its document, keeping when it was matched.
  const events = readJson(P.events, {}) ?? {};
  const eventsBefore = stable(events);
  let eventsNew = 0, eventsRemoved = 0;
  for (const [id, e] of Object.entries(events)) {
    const doc = byId.get(e?.documentId);
    if ((doc && !scopes.get(doc.id).inScope) || notCurrent.has(id)) { delete events[id]; eventsRemoved++; }
  }
  for (const { doc, key, roles, scope } of pairs) {
    const old = events[eventId(doc, key)];
    const first = old ? { matchedAt: old.matchedAt ?? at, runId: old.runId ?? null, basis: old.basis ?? 'new-match' }
      : { matchedAt: at, runId, basis: runId && doc.firstRunId === runId ? 'new-document' : 'new-match' };
    events[eventId(doc, key)] = eventOf(doc, key, roles, scope, first);
    if (!old) eventsNew++;
  }
  if (stable(events) !== eventsBefore) writeJson(P.events, events);

  const counts = { documents: docs.length, inScope, outOfScope, outOfScopeWhy, lenderParties, matchedParties, matchedDocuments: Object.values(bySource).reduce((n, s) => n + s.matchedDocuments, 0), banks: banks.size, originated, review: entries.length, setAside: setAside.reduce((n, s) => n + s.count, 0), eventsNew, eventsRemoved, bankFilesWritten };
  const state = readLoanState(dir);
  writeJson(P.state, { ...state, sources: state.sources ?? {}, index: { builtAt: at, runId, counts, bySource } });
  return { ...counts, bySource };
}

// The rebuild (`outbound loans rebuild`): each bank's file, the review list and the events written again from the stored documents
// under the current rules, without reading any county. Events about documents now out of scope, or on a bank that only originated the
// loan, are removed; the others keep when they were first matched. The documents themselves are not touched. Safe on a data folder
// pulled from the platform (`outbound platform pull --to DIR`, then `outbound platform push --from DIR`): it writes only under loans/,
// and refuses a folder with no stored document or no bank list, which would otherwise empty every bank's file.
export function rebuildLoanIndex({ dir, now = new Date() } = {}) {
  const P = loansPaths(dir);
  if (!allDocuments(dir).length) throw new Error(`No stored county document in ${P.docsDir}: point OUTBOUND_DATA_DIR at the whole data folder (outbound platform pull --to DIR).`);
  const institutions = readJson(fdicPaths(dir).institutions, {});
  if (!institutions || typeof institutions !== 'object' || !Object.keys(institutions).length)
    throw new Error(`No bank list at ${fdicPaths(dir).institutions}: rebuilding without it would empty every bank's file. Pull the whole data folder first.`);
  const runId = `loans-rebuild-${now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}`;
  return { runId, ...buildLoanIndex({ dir, now, runId, institutions }) };
}

// Every event, newest first, optionally for one bank: for the triage (src/triage.mjs) and `outbound loans events`.
export function loanEvents({ dir, key = null } = {}) {
  return Object.values(readJson(loansPaths(dir).events, {}) ?? {}).filter((e) => e && (!key || e.key === key))
    .sort((a, b) => (a.date !== b.date ? (String(a.date) < String(b.date) ? 1 : -1) : a.id < b.id ? -1 : 1));
}
