// An INVENTED county notice list, so the adapter interface (src/sources/notices.mjs) has one complete example: Example County, a
// Colorado-style public trustee's weekly list of newly recorded foreclosure documents. Its host, publictrustee.example, does not exist,
// and every name in its fake (test/county-notices-fake.mjs) is invented. It is marked `example`, so it never runs against the network:
// runNoticeSource refuses it unless a test passes its fake. A real county's adapter copies this shape and replaces the parser.
//
// The page: one table, id "recorded", one row per recorded document, newest first:
//   Reception no.         the county's recording number, linked to the document's page (required; the record's id)
//   Document              the county's name for the document type (required; mapped below, others skipped)
//   Recorded              the recording date, MM/DD/YYYY (required)
//   Filed                 the court filing date, for a Rule 120 notice or a lis pendens
//   Sale date             the scheduled sale, when one is set
//   Original beneficiary  the lender on the deed of trust (on an assignment: the assignor) (required)
//   Current holder        the holder of the debt (on an assignment: the assignee) (required)
//   Holder's attorney     the attorney filing for the holder (Colorado's notice of election and demand names one)
//   Grantor               the borrower (required)
//   Property address, APN the property
//   Assessor use          the assessor's use, joined by the county ("Commercial: office"); blank when not joined
//   Original principal    as stated on the document; blank when it states none
//   Outstanding principal the unpaid balance as stated (C.R.S. 38-38-101 requires it on a notice of election and demand)
//   Deed of trust         the deed of trust the document refers to: "2019-0456789 (06/03/2019)"
import { defineNoticeSource, htmlTables, parseUsd, parseDate } from '../notices.mjs';

export const EXAMPLE_HOST = 'publictrustee.example';
export const EXAMPLE_LIST = `https://${EXAMPLE_HOST}/foreclosures/recorded`;

// The county's document names, to the pipeline's types. A name not here (a certificate of redemption, a withdrawal) is skipped.
export const EXAMPLE_TYPES = Object.freeze({
  'notice of election and demand': 'election_and_demand',
  'rule 120 notice': 'rule_120_notice',
  'notice of sale': 'notice_of_trustee_sale',
  "public trustee's deed": 'trustees_deed',
  'release of deed of trust': 'release',
  'assignment of deed of trust': 'assignment',
  'lis pendens': 'lis_pendens',
  'deed of trust': 'deed_of_trust',
});
// The assessor's use, as the county words it, to the pipeline's property types. Anything else stays unknown.
const USES = Object.freeze({ 'commercial: office': 'office', 'commercial: retail': 'retail', 'commercial: hotel': 'hotel', 'commercial: industrial': 'industrial',
  'commercial: mixed use': 'mixed-use', 'residential: multifamily (5+)': 'multifamily', 'vacant land': 'land' });

const COLUMNS = Object.freeze({
  number: 'Reception no.', type: 'Document', recorded: 'Recorded', filed: 'Filed', sale: 'Sale date', beneficiary: 'Original beneficiary',
  holder: 'Current holder', attorney: 'Holder\'s attorney', grantor: 'Grantor', address: 'Property address', apn: 'APN', use: 'Assessor use',
  original: 'Original principal', outstanding: 'Outstanding principal', deedOfTrust: 'Deed of trust',
});
export const REQUIRED_COLUMNS = Object.freeze(['number', 'type', 'recorded', 'beneficiary', 'holder', 'grantor']);

const amount = (s) => { const v = parseUsd(s); return v === null ? { value: null, basis: 'not-stated' } : { value: v, basis: 'document' }; };
const deedOf = (s) => {
  const m = /^\s*([A-Za-z0-9./_-]+)\s*(?:\((\d{1,2}\/\d{1,2}\/\d{4})\))?\s*$/.exec(String(s ?? ''));
  return m ? { documentNumber: m[1], recorded: m[2] ? parseDate(m[2]) : null } : null;
};

export function parseExampleList(html, { url } = {}) {
  const table = htmlTables(html).find((t) => t.id === 'recorded');
  if (!table) return { documents: [], rows: 0, skipped: [], missing: { table: 1 } };
  const col = Object.fromEntries(Object.entries(COLUMNS).map(([k, h]) => [k, table.headers.findIndex((x) => x.toLowerCase() === h.toLowerCase())]));
  const missing = Object.fromEntries(REQUIRED_COLUMNS.filter((k) => col[k] < 0).map((k) => [COLUMNS[k], 1]));
  if (Object.keys(missing).length) return { documents: [], rows: table.rows.length, skipped: [], missing };
  const documents = [], skipped = [];
  for (const r of table.rows) {
    const cell = (k) => (col[k] >= 0 ? r.cells[col[k]] ?? '' : '');
    const documentType = EXAMPLE_TYPES[cell('type').toLowerCase()];
    if (!documentType) { skipped.push({ reason: 'a document type the pipeline does not keep' }); continue; }
    // On an assignment the two lender columns are the assignor and the assignee.
    const [from, to] = documentType === 'assignment' ? ['assignor', 'assignee'] : ['beneficiary', 'holder'];
    const parties = [
      ...(cell('beneficiary') ? [{ role: from, name: cell('beneficiary') }] : []),
      ...(cell('holder') ? [{ role: to, name: cell('holder') }] : []),
      ...(cell('attorney') ? [{ role: 'attorney', name: cell('attorney') }] : []),
      ...(cell('grantor') ? [{ role: 'grantor', name: cell('grantor') }] : []),
    ];
    const link = r.links[col.number] ? new URL(r.links[col.number], url ?? EXAMPLE_LIST).toString() : null;
    documents.push({
      documentType, documentNumber: cell('number'),
      dates: { recorded: parseDate(cell('recorded')), filed: parseDate(cell('filed')), sale: parseDate(cell('sale')) },
      parties,
      property: { address: cell('address') || null, apn: cell('apn') || null, useCode: null, propertyType: USES[cell('use').toLowerCase()] ?? null },
      amounts: { originalPrincipal: amount(cell('original')), unpaidBalance: amount(cell('outstanding')) },
      deedOfTrust: deedOf(cell('deedOfTrust')),
      url: link,
    });
  }
  return { documents, rows: table.rows.length, skipped, missing: {} };
}

export const exampleCounty = defineNoticeSource({
  id: 'example-county',
  label: 'Example County Public Trustee, recorded foreclosure documents (invented)',
  county: { fips: '99001', name: 'Example' },
  state: 'CO',
  channel: 'b',
  cadence: 'weekly',
  hosts: [EXAMPLE_HOST],
  example: true,
  terms: { robotsCheckedOn: null, termsCheckedOn: null, decision: 'example', by: null },
  requests: () => [{ url: EXAMPLE_LIST }],
  parse: parseExampleList,
});
