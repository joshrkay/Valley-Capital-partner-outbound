// An invented world for the CMBS link (docs/county-loans.md section 9, src/cmbslinks.mjs): CMBS trusts and their loans as sources.edgar
// stores them (built through the adapter's own parser from an invented EX-102), and county documents as the watchers store them (built
// through buildDocument). Every trust, firm, property, place, person and amount here is invented.
import { join } from 'node:path';
import { put } from './kit.mjs';
import { parseCmbsAssets, toLoan, loanSignals, metroIndex, CMBS_NS } from '../src/sources/edgar.mjs';
import { buildDocument } from '../src/loans.mjs';
import { readJson } from '../src/store.mjs';

export const REPO_METROS = JSON.parse((await import('node:fs')).readFileSync(new URL('../metros.json', import.meta.url), 'utf8'));
export const SERVICER = 'Sample Special Servicing LLC';
export const TRUST_NAME = 'Example 2019-X1 Mortgage Trust';
export const TRUST = { cik: '1900001', name: TRUST_NAME, accession: '0001900001-26-000102', filed: '2026-10-28', period: '2026-10-13', loans: 40, loansInMarket: 3,
  specialServicer: SERVICER, specialServicers: [SERVICER], specialServicerMatched: true, distributionReport: '0001900001-26-000101' };
// A second shelf with the same series: the shelf's own words must tell them apart.
export const OTHER = { cik: '1900002', name: 'Sample 2019-X1 Commercial Mortgage Trust', accession: '0001900002-26-000102', filed: '2026-10-28', period: '2026-10-13', loans: 30, loansInMarket: 1,
  specialServicer: 'Placeholder Special Servicer Inc', specialServicers: ['Placeholder Special Servicer Inc'], specialServicerMatched: false, distributionReport: null };

const prop = (p) => `<property><propertyName>${p.name}</propertyName><propertyAddress>1 Invented Way</propertyAddress><propertyCity>${p.city}</propertyCity><propertyState>${p.state}</propertyState><propertyZip>80000</propertyZip><propertyCounty>${p.county}</propertyCounty><propertyTypeCode>${p.type}</propertyTypeCode>`
  + `<mostRecentValuationAmount>6100000</mostRecentValuationAmount><mostRecentValuationDate>05-01-2026</mostRecentValuationDate><mostRecentPhysicalOccupancyPercentage>.64</mostRecentPhysicalOccupancyPercentage>`
  + `<mostRecentNetOperatingIncomeAmount>410000</mostRecentNetOperatingIncomeAmount><mostRecentDebtServiceCoverageNetCashFlowpercentage>.78</mostRecentDebtServiceCoverageNetCashFlowpercentage></property>`;
export const assetXml = (a) => `<assets><assetNumber>${a.n}</assetNumber><reportingPeriodBeginningDate>09-12-2026</reportingPeriodBeginningDate><reportingPeriodEndDate>10-13-2026</reportingPeriodEndDate>`
  + `<originatorName>${a.originator ?? 'Example Origination Bank, National Association'}</originatorName><originationDate>06-08-2019</originationDate><originalLoanAmount>${a.amount ?? '7460000.00'}</originalLoanAmount>`
  + `<maturityDate>07-01-2029</maturityDate><reportPeriodEndActualBalanceAmount>${a.balance ?? '6912345.67'}</reportPeriodEndActualBalanceAmount><paidThroughDate>${a.paidThrough ?? '01-01-2026'}</paidThroughDate>`
  + `<paymentStatusLoanCode>${a.status ?? '3'}</paymentStatusLoanCode>${a.ss === false ? '' : '<mostRecentSpecialServicerTransferDate>03-04-2026</mostRecentSpecialServicerTransferDate>'}`
  + `${a.workout === null ? '' : `<workoutStrategyCode>${a.workout ?? '2'}</workoutStrategyCode>`}<primaryServicerName>Example Master Servicer</primaryServicerName>`
  + `<servicerWatchlistComments>Borrower Pat Example asked the servicer for forbearance.</servicerWatchlistComments>`
  + (a.props ?? [{ name: 'Example Inn Anytown', city: 'Anytown', state: 'CO', county: 'Arapahoe', type: 'LO' }]).map(prop).join('') + '</assets>';
export const ex102 = (assets) => `<?xml version="1.0" encoding="utf-8"?><assetData xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns="${CMBS_NS}">${assets.map(assetXml).join('')}</assetData>`;

// The trust's in-market loans as runEdgar stores them: through parseCmbsAssets, toLoan and loanSignals, with the trust's servicer.
export function storedLoans(trust, assets, { now = new Date('2026-11-18T12:00:00Z') } = {}) {
  const idx = metroIndex(REPO_METROS);
  const out = {};
  for (const a of parseCmbsAssets(ex102(assets)).assets) {
    const src = { source: 'edgar', endpoint: `ABS-EE ${trust.accession} exh_102.xml`, query: { cik: trust.cik }, recordId: `${trust.cik}:${a.fields.assetNumber}`, period: a.fields.reportingPeriodEndDate, fetchedAt: now.toISOString(), runId: 'edgar-test' };
    const loan = toLoan({ asset: a, trust, idx, sectors: ['hospitality', 'multifamily', 'retail'], src });
    if (!loan) continue;
    loan.signals = loanSignals(loan, { now });
    loan.specialServicer = trust.specialServicer; loan.specialServicerMatched = trust.specialServicerMatched;
    out[loan.key] = loan;
  }
  return out;
}

// The holder as a Colorado NED names it.
export const holderOf = (trust = TRUST_NAME, series = '2019-X1') => `Example Trustee Bank, N.A., as Trustee for the registered holders of ${trust}, Commercial Mortgage Pass-Through Certificates, Series ${series}`;
export const SOURCE = { id: 'example-arapahoe', county: { fips: '08005', name: 'Arapahoe' }, state: 'CO', hosts: ['publictrustee.example'] };
// One county document, through buildDocument. Overrides replace whole fields.
export function countyDoc(over = {}, { source = SOURCE, firstSeenAt = '2026-11-10T12:00:00.000Z' } = {}) {
  const parsed = {
    documentType: 'election_and_demand', documentNumber: over.documentNumber ?? 'FC-2026-0101/NED', dates: { recorded: '2026-11-03' },
    parties: [{ role: 'holder', name: holderOf() }, { role: 'lender', name: 'Example Origination Bank, N.A.' }, { role: 'grantor', name: 'Zephyrine Hospitality LLC' }, { role: 'attorney', name: 'Sample & Example LLP' }],
    property: { address: '4417 Quillon Way, Anytown, CO 80000', apn: '99-999-01-001' },
    amounts: { originalPrincipal: { value: 7460000, basis: 'index' }, unpaidBalance: { value: 7015000, basis: 'index' } },
    deedOfTrust: { documentNumber: '2019-5550101', recorded: '2019-06-10', dated: '2019-06-08' }, loan: { type: 'BPL Commercial', commercial: true },
    url: 'https://publictrustee.example/foreclosures/FC-2026-0101', ...over,
  };
  const { record, errors } = buildDocument(parsed, { source, fetchedAt: firstSeenAt, runId: 'county-test' });
  if (errors.length) throw new Error(errors.join('; '));
  return { ...record, firstSeenAt, firstRunId: 'county-test', updatedAt: null, updatedRunId: null };
}
// The borrower-side and address detail only the county document holds: none of it may reach the link file, the triage or a job result.
export const DOC_ONLY = ['Zephyrine', 'Quillon', '99-999-01-001', 'Sample & Example LLP', 'Pat Example', 'forbearance'];

export function writeWorld(dir, { docs = [], trusts = { [TRUST.cik]: TRUST, [OTHER.cik]: OTHER }, loans = null, edgar = true } = {}) {
  put(dir, `loans/docs/${SOURCE.id}.json`, Object.fromEntries(docs.map((d) => [d.id, d])));
  if (!edgar) return dir;
  put(dir, 'sources/edgar/trusts.json', trusts);
  put(dir, 'sources/edgar/loans.json', loans ?? storedLoans(TRUST, [{ n: '37' }, { n: '12', props: [{ name: 'Example Suites Mesa', city: 'Mesa', state: 'AZ', county: 'Maricopa', type: 'LO' }] }]));
  put(dir, 'sources/edgar/state.json', { lastRun: 'edgar-test', ranAt: '2026-11-17T12:00:00.000Z', counts: {} });
  return dir;
}
export const readLinks = (dir) => readJson(join(dir, 'loans', 'cmbs.json'), null);
