// Jefferson County, Colorado: the Public Trustee's GTS reports (docs/county-watchers-recon.md, section 3; sources.json entries
// co-jefferson-ned-report and co-jefferson-presale-list). One adapter reads both weekly reports:
//   - "Election and Demand Notices Filed": one PDF a week of the NEDs recorded that day, the earliest Colorado signal (110 to 125 days
//     before a sale). Each record a notice of election and demand, its id the foreclosure number with "/NED".
//   - "Pre Sale List": one PDF each Tuesday for that Thursday's sale, the GTS pre-sale template (src/sources/counties/gts.mjs). Each
//     record a scheduled trustee's sale, its id the foreclosure number with "/SALE", so it sits beside the case's NED.
// and, once, the archive "Archived Election and Demand Notices Filed": one compiled PDF a month from January 2025 (outbound loans backfill).
//
// NOT ENABLED. It runs only once a principal records the decision that its reports may be read by software (terms.decision 'allowed',
// with who decided), and counsel has noted the county's copyright claim in "data compilations": the watcher stores extracted fields only,
// never the county's PDFs. Until then runNoticeSource refuses it and nothing is fetched. config.counties.sources.jefferson says the same.
//
// THE NED REPORT. Each page starts "Notices of Election and Demand Filed in Jefferson County", "From <date> Through <date>" and a
// two-line disclaimer, and ends "Page N of M". Each record starts "Foreclosure Number:", then labelled lines (NED_SCHEMA), several of them
// in columns: "NED Date:" with its "Reception #:"; "Deed of Trust Date:" with "Recording Date:" and "Reception #:"; "Original Note Amt:"
// with "LoanType:" and "Interest Rate:"; "Current Amount:" with "As Of:" and "Interest Type:". The names and the legal description wrap
// onto indented lines. A parcel number sits inside the legal description in some records ("APN #:").
import { defineNoticeSource } from '../notices.mjs';
import { layoutLines, readLayout, fieldReader, readApn, longYmd, parsePreSaleText, gtsPageParser, pdfToText, fileKey, FORECLOSURE_NUMBER, RECEPTION_NUMBER, NAME } from './gts.mjs';

export const JEFFERSON_HOST = 'gts.co.jefferson.co.us';
export const JEFFERSON_BASE = `https://${JEFFERSON_HOST}/`;
export const JEFFERSON_REPORTS = `${JEFFERSON_BASE}reports`;
export const BACKFILL_SINCE = '2025-01-01';

export const NED_SCHEMA = Object.freeze([
  { label: 'Foreclosure Number:', id: 'number' },
  { label: 'NED Date:', id: 'nedDate', inline: [{ label: 'Reception #:', id: 'nedReception' }] },
  { label: 'Original Sale Date:', id: 'saleDate' },
  { label: 'Deed of Trust Date:', id: 'dotDate', inline: [{ label: 'Recording Date:', id: 'dotRecorded' }, { label: 'Reception #:', id: 'dotReception' }] },
  { label: 'Re-Recording Date', id: 'reRecorded', inline: [{ label: 'Re-Recorded #:', id: 'reRecordedNumber' }] },
  { label: 'Legal:', id: 'legal', multiline: true },
  { label: 'Address:', id: 'address', multiline: true },
  { label: 'Original Note Amt:', id: 'original', inline: [{ label: 'LoanType:', id: 'loanType' }, { label: 'Interest Rate:', id: 'rate' }] },
  { label: 'Current Amount:', id: 'current', inline: [{ label: 'As Of:', id: 'asOf' }, { label: 'Interest Type:', id: 'rateType' }] },
  { label: 'Current Lender (Beneficiary):', id: 'holder', multiline: true },
  { label: 'Current Owner:', id: 'owner', multiline: true },
  { label: 'Grantee (Lender On Deed of Trust):', id: 'lender', multiline: true },
  { label: 'Grantor (Borrower On Deed of Trust)', id: 'grantor', multiline: true },
  { label: 'Publication:', id: 'newspaper', inline: [{ label: 'First Publication Date:', id: 'firstPublication' }] },
  { label: 'Last Publication Date:', id: 'lastPublication' },
  { label: 'Attorney for Beneficiary:', id: 'attorney', multiline: true },
  { label: 'Attorney File Number:', id: 'attorneyFile', inline: [{ label: 'Phone:', id: 'phone' }, { label: 'Fax:', id: 'fax' }] },
]);
// The labels every NED report has; one no record carries is a format change.
export const NED_REQUIRED = Object.freeze(['number', 'nedDate', 'nedReception', 'holder', 'lender', 'grantor', 'original', 'current', 'loanType']);
const NED_TITLE = /^\s*Notices of Election and Demand Filed in (.+?) County\s*$/;
const NED_RANGE = /^\s*From\s+(.+?)\s+Through\s+(.+?)\s*$/;
const NED_FURNITURE = [NED_TITLE, NED_RANGE, /makes no representation or warranties about the accuracy/, /^\s*reports\. You should conduct your own due diligence\.?\s*$/, /^\s*Page\s+\d+\s+of\s+\d+\s*$/];

// The loan type, as the county writes it, to the commercial flag: true for a commercial or business-purpose loan, false for the
// residential programs, null for a blank or unknown type (never guessed).
const RESIDENTIAL = new Set(['conventional', 'conv', 'fha', 'va', 'usda', 'rhs', 'reverse', 'reverse mortgage', 'hecm']);
export function commercialFromLoanType(type) {
  const t = String(type ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!t) return null;
  if (/\b(commercial|business)\b/.test(t) || /^bpl\b/.test(t)) return true;
  return RESIDENTIAL.has(t) ? false : null;
}
const LOAN_TYPE = /^[A-Za-z][A-Za-z0-9 .\/&()-]{0,39}$/;

// One NED report's text to documents. Returns { documents, rows, skipped, missing, stats, reportDates }.
export function parseNedText(text, { url, county = 'Jefferson' } = {}) {
  const raw = layoutLines(text);
  const missing = {}, stats = {}, skipped = [], documents = [];
  const miss = (k) => { missing[k] = (missing[k] ?? 0) + 1; };
  const title = raw.map((l) => NED_TITLE.exec(l)).find(Boolean);
  if (!title) miss('the report\'s title ("Notices of Election and Demand Filed in ... County")');
  else if (title[1].trim().toLowerCase() !== county.toLowerCase()) miss(`a report titled for ${county} County`);
  const range = raw.map((l) => NED_RANGE.exec(l)).find(Boolean);
  const from = range ? longYmd(range[1]) : null, through = range ? longYmd(range[2]) : null;
  if (!from || !through) miss('the report\'s dates ("From <date> Through <date>")');

  const { records } = readLayout(layoutLines(text, NED_FURNITURE), NED_SCHEMA);
  if (!records.length && raw.some((l) => /Foreclosure Number/i.test(l))) miss('Foreclosure Number:');
  if (records.length) for (const id of NED_REQUIRED) if (!records.some((r) => r.present.has(id))) miss(NED_SCHEMA.find((s) => s.id === id)?.label ?? NED_SCHEMA.flatMap((s) => s.inline ?? []).find((s) => s.id === id).label);

  for (const rec of records) {
    const r = fieldReader(rec, stats);
    const number = r.text('number', 'Foreclosure Number:', null, { max: 20, re: FORECLOSURE_NUMBER });
    const nedDate = r.date('nedDate', 'NED Date:', 'dates.recorded');
    const nedReception = r.text('nedReception', 'Reception # (NED)', 'foreclosure.reception', { max: 14, re: RECEPTION_NUMBER });
    const saleDate = r.date('saleDate', 'Original Sale Date:', 'dates.sale');
    const dotDate = r.date('dotDate', 'Deed of Trust Date:', 'deedOfTrust.dated');
    const dotRecorded = r.date('dotRecorded', 'Recording Date: (deed of trust)', 'deedOfTrust.recorded');
    const dotReception = r.text('dotReception', 'Reception # (deed of trust)', 'deedOfTrust.documentNumber', { max: 14, re: RECEPTION_NUMBER });
    const legal = r.text('legal', 'Legal:', 'property.legal', { max: 8000 });
    const apn = readApn(r, legal, 'APN # (in Legal)');
    const address = r.text('address', 'Address:', 'property.address', { max: 200 });
    const loanType = r.text('loanType', 'LoanType:', 'loan.type', { max: 40, re: LOAN_TYPE });
    const original = r.amount('original', 'Original Note Amt:', 'amounts.originalPrincipal', { label: 'Original Note Amt' });
    const asOf = r.date('asOf', 'As Of:', 'amounts.unpaidBalance.asOf');
    const current = r.amount('current', 'Current Amount:', 'amounts.unpaidBalance', { label: 'Current Amount', ...(asOf ? { asOf } : {}) });
    const holder = r.text('holder', 'Current Lender (Beneficiary):', 'parties.holder', { re: NAME });
    const lender = r.text('lender', 'Grantee (Lender On Deed of Trust):', 'parties.lender', { re: NAME });
    const grantor = r.text('grantor', 'Grantor (Borrower On Deed of Trust)', 'parties.grantor', { re: NAME });
    const owner = r.text('owner', 'Current Owner:', 'parties.owner', { re: NAME });
    const attorney = r.text('attorney', 'Attorney for Beneficiary:', 'parties.attorney', { re: NAME });
    const attorneyFile = r.text('attorneyFile', 'Attorney File Number:', 'foreclosure.attorneyFileNumber', { max: 60 });
    const first = r.date('firstPublication', 'First Publication Date:', 'foreclosure.publication.first');
    const last = r.date('lastPublication', 'Last Publication Date:', 'foreclosure.publication.last');
    if (!number) { skipped.push({ reason: 'the foreclosure number could not be read' }); continue; }
    if (!nedDate) { skipped.push({ reason: 'the NED date could not be read' }); continue; }
    if (!holder && !lender) { skipped.push({ reason: 'no lender named' }); continue; }
    documents.push({
      documentType: 'election_and_demand', documentNumber: `${number}/NED`,
      dates: { recorded: nedDate, filed: null, listed: null, sale: saleDate },
      parties: [
        ...(holder ? [{ role: 'holder', name: holder }] : []), ...(lender ? [{ role: 'lender', name: lender }] : []),
        ...(attorney ? [{ role: 'attorney', name: attorney }] : []), ...(grantor ? [{ role: 'grantor', name: grantor }] : []), ...(owner ? [{ role: 'owner', name: owner }] : []),
      ],
      property: { address, apn, legal, useCode: null, propertyType: null },
      amounts: { originalPrincipal: original, unpaidBalance: current },
      deedOfTrust: { documentNumber: dotReception, recorded: dotRecorded, dated: dotDate },
      loan: loanType ? { type: loanType, commercial: commercialFromLoanType(loanType) } : null,
      foreclosure: { number, reception: nedReception, attorneyFileNumber: attorneyFile, publication: { first, last }, amendedPublication: null, bid: null, deficiency: null },
      unread: r.unread,
      url,
    });
  }
  return { documents, rows: records.length, skipped, missing, stats, reportDates: { from, through } };
}

// The reports this adapter follows from Jefferson's reports page, found by their link text.
export const JEFFERSON_REPORT_KINDS = Object.freeze({
  'ned-index': { texts: ['Election and Demand Notices Filed'], file: 'ned' },
  'presale-index': { texts: ['Pre Sale List', 'Current Pre Sale List'], file: 'presale' },
  'archive-index': { texts: ['Archived Election and Demand Notices Filed'], file: 'ned' },
});

// A file the run read: its text from pdftotext, then the NED or pre-sale parser by the kind of index that listed it, and its key.
export async function parseJeffersonFile(bytes, { url, kind, etag = null, lastModified = null, pdfToText: extract = pdfToText }) {
  const text = await extract(bytes);
  const parsed = kind === 'presale' ? parsePreSaleText(text, { url, county: 'Jefferson' }) : parseNedText(text, { url, county: 'Jefferson' });
  return { ...parsed, file: { key: fileKey({ etag, lastModified }, parsed.reportDates), kind, from: parsed.reportDates.from, through: parsed.reportDates.through, rows: parsed.rows } };
}

export const jefferson = defineNoticeSource({
  id: 'jefferson',
  label: 'Jefferson County Public Trustee: new foreclosures (NED report) and the pre-sale list',
  county: { fips: '08059', name: 'Jefferson' },
  state: 'CO',
  channel: 'b',
  cadence: 'weekly',
  hosts: [JEFFERSON_HOST],
  minIntervalMs: 21000,
  terms: {
    robotsCheckedOn: '2026-11-18', termsCheckedOn: '2026-11-18', decision: null, by: null,
    waitingOn: 'a principal\'s recorded decision that the GTS reports may be read by software, and counsel\'s note on the county\'s copyright claim in "data compilations" (D-B9).',
  },
  requests: () => [{ url: JEFFERSON_REPORTS, kind: 'reports' }],
  parse: gtsPageParser({ reports: JEFFERSON_REPORT_KINDS, weekly: ['ned-index', 'presale-index'], backfill: ['archive-index'] }),
  parseFile: parseJeffersonFile,
  backfill: { since: BACKFILL_SINCE, requests: () => [{ url: JEFFERSON_REPORTS, kind: 'archive-reports' }] },
});
