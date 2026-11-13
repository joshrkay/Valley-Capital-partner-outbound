// A fake SEC EDGAR for tests, shared by the adapter's tests and the worker's. Invented trusts, loans and people only.
// The fixtures copy the real formats seen on 2026-11-13: the fixed-width form index, a filing's index.json, an EX-102 in the CMBS
// namespace (MM-DD-YYYY dates, ZIPs without leading zeros), and a distribution report whose cover splits phrases across tags.
import { CMBS_NS } from '../src/sources/edgar.mjs';

export const idxLine = (form, company, cik, date, acc) => `${form.padEnd(17)}${company.padEnd(62)}${String(cik).padEnd(12)}${date}  edgar/data/${cik}/${acc}.txt`;
export const FORM_IDX = [
  'Description:           Master Index of EDGAR Dissemination Feed by Form Type', '', 'Form Type   Company Name   CIK   Date Filed  File Name', '-'.repeat(120),
  idxLine('10-D', 'Example Commercial Mortgage Trust 2021-C1', 1000001, '2026-10-28', '0009999999-26-000101'),
  idxLine('ABS-EE', 'Example Commercial Mortgage Trust 2021-C1', 1000001, '2026-10-28', '0009999999-26-000102'),
  idxLine('ABS-EE', 'Example Auto Receivables Trust 2025-1', 1000002, '2026-10-20', '0009999999-26-000201'),
  idxLine('ABS-EE', 'Example Card Master Trust', 1000003, '2026-10-21', '0009999999-26-000301'),
  idxLine('ABS-EE', 'Example Commercial Mortgage Trust 2019-C9', 1000004, '2026-08-01', '0009999999-26-000401'),   // too old for the window
  idxLine('10-K', 'Someone Else Inc', 1000005, '2026-10-22', '0009999999-26-000501'),
].join('\n');

export const prop = (o) => `<property><propertyName>${o.name}</propertyName><propertyAddress>1 Example Way</propertyAddress><propertyCity>${o.city}</propertyCity><propertyState>${o.state}</propertyState><propertyZip>${o.zip}</propertyZip><propertyCounty>${o.county}</propertyCounty><propertyTypeCode>${o.type}</propertyTypeCode>${o.status ? `<propertyStatusCode>${o.status}</propertyStatusCode>` : ''}<mostRecentPhysicalOccupancyPercentage>.81</mostRecentPhysicalOccupancyPercentage><mostRecentDebtServiceCoverageNetCashFlowpercentage>.92</mostRecentDebtServiceCoverageNetCashFlowpercentage><largestTenant>Example Tenant Co</largestTenant></property>`;
export const asset = (n, props, extra = '') => `<assets><assetTypeNumber>Prospectus Loan ID</assetTypeNumber><assetNumber>${n}</assetNumber><reportingPeriodBeginningDate>09-12-2026</reportingPeriodBeginningDate><reportingPeriodEndDate>10-13-2026</reportingPeriodEndDate><originationDate>10-14-2021</originationDate><originalLoanAmount>25000000.00</originalLoanAmount><maturityDate>11-06-2027</maturityDate><reportPeriodInterestRatePercentage>.04500000</reportPeriodInterestRatePercentage><reportPeriodEndActualBalanceAmount>24100000.00</reportPeriodEndActualBalanceAmount><primaryServicerName>Example Master Servicer</primaryServicerName>${extra}${props.map(prop).join('')}</assets>`;
export const EX102 = `<?xml version="1.0" encoding="utf-8"?>
<assetData xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns="${CMBS_NS}">
${asset(1, [{ name: 'Example Apartments &amp; Lofts', city: 'Los Angeles', state: 'CA', zip: '90012', county: 'Los Angeles', type: 'MF' }], '<paymentStatusLoanCode>3</paymentStatusLoanCode><mostRecentSpecialServicerTransferDate>06-02-2026</mostRecentSpecialServicerTransferDate><workoutStrategyCode>5</workoutStrategyCode>')}
${asset(2, [{ name: 'Example Office Tower', city: 'Phoenix', state: 'AZ', zip: '85004', county: 'Maricopa', type: 'OF' }], '<paymentStatusLoanCode>0</paymentStatusLoanCode>')}
${asset(3, [{ name: 'Example Harbor Hotel', city: 'Boston', state: 'MA', zip: '2110', county: 'Suffolk', type: 'LO' }], '<paymentStatusLoanCode>0</paymentStatusLoanCode>')}
${asset(4, [{ name: 'Example Plaza', city: 'Aurora', state: 'CO', zip: '80012', county: 'Arapahoe', type: 'RT', status: '6' }, { name: 'Example Annex', city: 'Boston', state: 'MA', zip: '2110', county: 'Suffolk', type: 'RT' }], '<paymentStatusLoanCode>0</paymentStatusLoanCode><mostRecentSpecialServicerTransferDate>01-05-2025</mostRecentSpecialServicerTransferDate><mostRecentMasterServicerReturnDate>08-01-2025</mostRecentMasterServicerReturnDate>')}
</assetData>`;
export const NOT_CMBS = `<?xml version="1.0"?><assetData xmlns="http://www.sec.gov/edgar/document/absee/autoloan/assetdata"><assets><assetNumber>1</assetNumber></assets></assetData>`;
// The cover, as real reports lay it out: the label split across tags, then the firm, then a named contact in the next cell.
export const REPORT = (firm) => `<html><body><table><tr><td><span>Special</span> <span>Servicer</span></td><td>${firm}&nbsp;&nbsp;&nbsp;</td><td>Attention: Pat Person (555) 010-0100 pat.person@example.test</td></tr></table>${'<p>loan detail</p>'.repeat(5000)}</body></html>`;

export function fakeSec({ firm = 'Example Special Servicing LLC', ex102 = EX102 } = {}) {
  const calls = [];
  const files = {
    'https://www.sec.gov/Archives/edgar/full-index/2026/QTR3/form.idx': '',
    'https://www.sec.gov/Archives/edgar/full-index/2026/QTR4/form.idx': FORM_IDX,
    'https://www.sec.gov/Archives/edgar/data/1000001/000999999926000102/index.json': JSON.stringify({ directory: { item: [{ name: 'exh_102.xml', size: String(ex102.length) }, { name: 'exh_103.xml', size: '900' }] } }),
    'https://www.sec.gov/Archives/edgar/data/1000001/000999999926000102/exh_102.xml': ex102,
    'https://www.sec.gov/Archives/edgar/data/1000002/000999999926000201/index.json': JSON.stringify({ directory: { item: [{ name: 'ex102auto.xml', size: '126372387' }] } }),
    'https://www.sec.gov/Archives/edgar/data/1000003/000999999926000301/index.json': JSON.stringify({ directory: { item: [{ name: 'ex102card.xml', size: '4000' }] } }),
    'https://www.sec.gov/Archives/edgar/data/1000003/000999999926000301/ex102card.xml': NOT_CMBS,
    'https://www.sec.gov/Archives/edgar/data/1000001/000999999926000101/index.json': JSON.stringify({ directory: { item: [{ name: 'trust_10d.htm' }, { name: 'trust_ex991-202610.htm', size: '1500000' }] } }),
    'https://www.sec.gov/Archives/edgar/data/1000001/000999999926000101/trust_ex991-202610.htm': REPORT(firm),
  };
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, ua: init.headers?.['user-agent'] });
    if (!(url in files)) return new Response('not found', { status: 404 });
    return new Response(files[url], { status: 200 });
  };
  return { fetchImpl, calls };
}
