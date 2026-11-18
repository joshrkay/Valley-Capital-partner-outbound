// Douglas County, Colorado: the Public Trustee's GTS "Current Pre Sale List" (docs/county-watchers-recon.md, section 3; sources.json
// entry co-douglas-presale-list). Two PDFs a week: the Monday pre-sale report (after 1 pm) and the Tuesday update, for the Wednesday
// sale, both in the GTS pre-sale template that Jefferson's list shares (parsePreSaleText, src/sources/counties/gts.mjs). Each record a
// scheduled trustee's sale, its id the foreclosure number with "/SALE"; the Tuesday update is read after the Monday list, so where both
// give a sale the update's figures are kept. Douglas publishes no new-NED report: this is its only list.
//
// NOT ENABLED. Its reports page asks the reader to accept its terms (lawful and ethical use, a release of liability), and opening a
// report is taken as accepting them. It runs only once a principal records that the firm accepts them (terms.decision 'allowed', with
// who decided). Until then runNoticeSource refuses it and nothing is fetched. config.counties.sources.douglas says the same.
//
// PACING. The apps host sets no Crawl-delay; the county's main site asks 60 seconds, and a week's four or five requests keep to it.
import { defineNoticeSource } from '../notices.mjs';
import { parsePreSaleText, gtsPageParser, pdfToText, fileKey } from './gts.mjs';

export const DOUGLAS_HOST = 'apps.douglasco.gov';
export const DOUGLAS_BASE = `https://${DOUGLAS_HOST}/gts/`;
export const DOUGLAS_REPORTS = `${DOUGLAS_BASE}reports`;

export const DOUGLAS_REPORT_KINDS = Object.freeze({
  'presale-index': { texts: ['Current Pre Sale List', 'Pre Sale List'], file: 'presale' },
});

export async function parseDouglasFile(bytes, { url, kind, etag = null, lastModified = null, pdfToText: extract = pdfToText }) {
  const text = await extract(bytes);
  const parsed = parsePreSaleText(text, { url, county: 'Douglas' });
  return { ...parsed, file: { key: fileKey({ etag, lastModified }, parsed.reportDates), kind, from: parsed.reportDates.from, through: parsed.reportDates.through, rows: parsed.rows } };
}

export const douglas = defineNoticeSource({
  id: 'douglas',
  label: 'Douglas County Public Trustee: the pre-sale list',
  county: { fips: '08035', name: 'Douglas' },
  state: 'CO',
  channel: 'b',
  cadence: 'weekly',
  hosts: [DOUGLAS_HOST],
  minIntervalMs: 60000,
  terms: {
    robotsCheckedOn: '2026-11-18', termsCheckedOn: '2026-11-18', decision: null, by: null,
    waitingOn: 'a principal recording that the firm accepts the reports page\'s terms (lawful and ethical use only, and a release of liability).',
  },
  requests: () => [{ url: DOUGLAS_REPORTS, kind: 'reports' }],
  parse: gtsPageParser({ reports: DOUGLAS_REPORT_KINDS, weekly: ['presale-index'] }),
  parseFile: parseDouglasFile,
});
