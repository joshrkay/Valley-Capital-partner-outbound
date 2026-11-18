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
import { matchLender, reviewKey, bankLike, LENDER_ROLES, SET_ASIDE, PERSON_WITHHELD } from './lenders.mjs';

export const CONTEXT_NOTE = 'Context for the firm\'s principals only: never in a message, never given to a model, never scored.';

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
// Party roles as the document names them. LENDER_ROLES (src/lenders.mjs) are the ones matched to a bank. A servicer (a Texas notice
// names the mortgage servicer apart from the mortgagee) is its own role and never matched: it collects for the lender, it is not one.
export const ROLES = Object.freeze(['lender', 'beneficiary', 'holder', 'assignor', 'assignee', 'trustee', 'attorney', 'borrower', 'grantor', 'servicer']);
// recorded: the county's recording date; filed: a court or clerk filing date; sale: the scheduled sale; notice: the date the notice
// itself states (a Texas notice of sale is dated by its trustee or attorney, and the clerk's filed stamp is often unreadable).
export const DATE_KINDS = Object.freeze(['recorded', 'filed', 'sale', 'notice']);
// The fields a reader can fail to read (an OCR misread, a value that fails its check). Each one not read is listed in the record's
// `unread`, so "not read" is never confused with "not on the document"; an amount not read also has the basis "not-read".
export const READ_FIELDS = Object.freeze(['dates.recorded', 'dates.filed', 'dates.sale', 'dates.notice', 'salePlace', 'property.address', 'amounts.originalPrincipal',
  'amounts.unpaidBalance', 'deedOfTrust.reference', 'deedOfTrust.dated', 'deedOfTrust.recorded', 'lender', 'servicer', 'trustee', 'borrower']);
export const AMOUNT_KINDS = Object.freeze(['originalPrincipal', 'unpaidBalance']);
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
const CONTENT = ['sourceId', 'county', 'state', 'documentType', 'documentNumber', 'dates', 'parties', 'property', 'amounts', 'deedOfTrust', 'salePlace', 'unread'];
export const contentOf = (r) => ({ ...Object.fromEntries(CONTENT.map((k) => [k, r?.[k] ?? null])), urls: (r?.sources ?? []).map((s) => s.url).sort() });
export const hashDocument = (r) => createHash('sha256').update(stable(contentOf(r))).digest('hex').slice(0, 16);

// Every key a stored document may carry. Nothing else is stored, so an adapter cannot add a field (a phone, a note) by accident.
export const RECORD_KEYS = Object.freeze(['id', ...CONTENT, 'sources', 'contentHash', 'contextOnly', 'firstSeenAt', 'firstRunId', 'updatedAt', 'updatedRunId', '_source']);
const PARSED_KEYS = new Set(['documentType', 'documentNumber', 'dates', 'parties', 'property', 'amounts', 'deedOfTrust', 'salePlace', 'unread', 'url', 'etag', 'listLink']);

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
  if (!dates.recorded && !dates.filed && !dates.notice && !(documentType === 'notice_of_trustee_sale' && dates.sale)) err('the document has no recording, filing or notice date');

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
  const property = { address: text(p.property?.address), apn: text(p.property?.apn), useCode: text(p.property?.useCode), propertyType: pt };

  const amounts = {};
  for (const k of AMOUNT_KINDS) {
    const a = p.amounts?.[k] ?? {};
    const raw = a.value === undefined || a.value === null || a.value === '' ? null : Number(a.value);
    const basis = a.basis ?? 'not-read';
    if (!AMOUNT_BASES[basis]) { err(`amounts.${k}: basis "${basis}" is not one of ${Object.keys(AMOUNT_BASES).join(', ')}`); continue; }
    const stated = basis === 'document' || basis === 'index';
    if (stated && !(Number.isFinite(raw) && raw >= 0)) err(`amounts.${k}: an amount ${AMOUNT_BASES[basis]} needs a value in dollars`);
    if (!stated && raw !== null) err(`amounts.${k}: an amount ${AMOUNT_BASES[basis]} has no value`);
    amounts[k] = { value: stated ? raw : null, unit: 'dollars', basis };
  }

  // The deed of trust the document refers to: its recording number (or book and page; a Texas clerk calls the book a volume), when it
  // was recorded, and the date it was signed (`dated`), which a notice gives apart from the recording.
  let deedOfTrust = null;
  if (p.deedOfTrust) {
    const d = { documentNumber: text(p.deedOfTrust.documentNumber), recorded: p.deedOfTrust.recorded ?? null, dated: p.deedOfTrust.dated ?? null, book: text(p.deedOfTrust.book), page: text(p.deedOfTrust.page) };
    for (const k of ['recorded', 'dated']) if (d[k] !== null && !validYmd(d[k])) err(`deedOfTrust.${k} "${d[k]}" is not a date (YYYY-MM-DD)`);
    if (d.documentNumber || d.recorded || d.dated || (d.book && d.page)) deedOfTrust = d;
  }
  const salePlace = text(p.salePlace);
  // Every field not read, an amount whose basis is "not-read" among them.
  const unread = [...new Set([...(Array.isArray(p.unread) ? p.unread : []), ...AMOUNT_KINDS.filter((k) => amounts[k]?.basis === 'not-read').map((k) => `amounts.${k}`)])].sort();
  for (const f of unread) if (!READ_FIELDS.includes(f)) err(`unread: "${f}" is not one of ${READ_FIELDS.join(', ')}`);
  const etag = text(p.etag);

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
    documentType, documentNumber, dates, parties, property, amounts, deedOfTrust, salePlace, unread, sources: [{ url: link, fetchedAt, ...(etag ? { etag } : {}), ...(listUrl ? { listUrl } : {}) }], contextOnly: true,
  };
  record.contentHash = hashDocument(record);
  record._source = sourceBlock({ source: `county:${source.id}`, endpoint: link, query: { source: source.id }, recordId: id, period: dates.filed ?? dates.recorded ?? dates.notice ?? dates.sale, fetchedAt, runId });
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
// The date a document is known by: its filing date, else its recording date, else the date the notice itself states, else (a notice of
// sale whose own date could not be read) the sale date it gives.
export const documentDate = (doc) => {
  const d = doc?.dates ?? {};
  return d.filed ? { date: d.filed, kind: 'filed' } : d.recorded ? { date: d.recorded, kind: 'recorded' } : d.notice ? { date: d.notice, kind: 'notice' }
    : d.sale ? { date: d.sale, kind: 'sale' } : { date: null, kind: 'recorded' };
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
// What the bank page shows for one document: no borrower, no grantor, no address, no APN. The labels are the engine's own words, so
// the page and the command line say the same.
export function loanRow(doc, roles, how) {
  const { date, kind } = documentDate(doc);
  const stage = DOC_TYPES[doc.documentType]?.stage ?? null;
  const pt = doc.property?.propertyType ?? null;
  return {
    id: doc.id, sourceId: doc.sourceId, documentType: doc.documentType, typeLabel: DOC_TYPES[doc.documentType]?.label ?? doc.documentType, documentNumber: doc.documentNumber,
    stage, stageLabel: STAGES[stage] ?? null, county: doc.county, countyLabel: countyLabel(doc), state: doc.state, date, dateKind: kind, saleDate: doc.dates?.sale ?? null, roles, how,
    amounts: doc.amounts, propertyType: pt, propertyTypeLabel: pt ? PROPERTY_TYPES[pt] ?? null : null, useCode: doc.property?.useCode ?? null,
    deedOfTrust: doc.deedOfTrust ? { documentNumber: doc.deedOfTrust.documentNumber, recorded: doc.deedOfTrust.recorded, dated: doc.deedOfTrust.dated ?? null, book: doc.deedOfTrust.book ?? null, page: doc.deedOfTrust.page ?? null } : null,
    link: publicLink(doc), firstSeenAt: doc.firstSeenAt ?? null,
  };
}
const sansStamp = ({ builtAt, runId, ...rest }) => stable(rest);

// Matches every stored document's lender-side parties against the bank list and the aliases, then writes each bank's file (rewritten
// only when its content changed), the review list, and an event for each document and bank not matched before: "new-document" when the
// document arrived in this run, "new-match" when an alias a principal added since made it match. An event, once written, is kept.
// Returns counts only.
export function buildLoanIndex({ dir, now = new Date(), runId = null, institutions, aliases } = {}) {
  const P = loansPaths(dir);
  const inst = institutions ?? readJson(fdicPaths(dir).institutions, {});
  const al = aliases ?? loadAliases(dir);
  const at = now.toISOString();
  const docs = allDocuments(dir).sort(byNewest);
  const banks = new Map(), review = new Map(), aside = new Map(), bySource = {};
  const pairs = [];
  let lenderParties = 0, matchedParties = 0;
  for (const doc of docs) {
    const src = (bySource[doc.sourceId] ??= { documents: 0, matchedDocuments: 0, reviewNames: 0 });
    src.documents++;
    const mine = new Map();
    for (const party of doc.parties ?? []) {
      if (!LENDER_ROLES.includes(party.role)) continue;
      lenderParties++;
      const m = matchLender(party, { institutions: inst, aliases: al, documentState: doc.state });
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
      pairs.push({ doc, key, roles });
      if (!banks.has(key)) banks.set(key, []);
      banks.get(key).push(loanRow(doc, roles, e.how));
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

  // Events: one per document and bank, the first time they are matched.
  const events = readJson(P.events, {});
  let eventsNew = 0;
  for (const { doc, key, roles } of pairs) {
    const id = `county:${doc.id}:${key}`;
    if (events[id]) continue;
    const { date, kind } = documentDate(doc);
    events[id] = {
      id, kind: 'event', type: 'county_document', key, documentId: doc.id, sourceId: doc.sourceId, documentType: doc.documentType,
      stage: DOC_TYPES[doc.documentType].stage, roles, date, dateKind: kind, county: doc.county, state: doc.state, link: publicLink(doc),
      label: eventLabel(doc, roles), basis: runId && doc.firstRunId === runId ? 'new-document' : 'new-match',
      firstSeenAt: doc.firstSeenAt ?? null, matchedAt: at, runId, contextOnly: true, scored: false,
    };
    eventsNew++;
  }
  if (eventsNew) writeJson(P.events, events);

  const counts = { documents: docs.length, lenderParties, matchedParties, matchedDocuments: Object.values(bySource).reduce((n, s) => n + s.matchedDocuments, 0), banks: banks.size, review: entries.length, setAside: setAside.reduce((n, s) => n + s.count, 0), eventsNew, bankFilesWritten };
  const state = readLoanState(dir);
  writeJson(P.state, { ...state, sources: state.sources ?? {}, index: { builtAt: at, runId, counts, bySource } });
  return counts;
}

// Every event, newest first, optionally for one bank: for the triage (src/triage.mjs) and `outbound loans events`.
export function loanEvents({ dir, key = null } = {}) {
  return Object.values(readJson(loansPaths(dir).events, {}) ?? {}).filter((e) => e && (!key || e.key === key))
    .sort((a, b) => (a.date !== b.date ? (String(a.date) < String(b.date) ? 1 : -1) : a.id < b.id ? -1 : 1));
}
