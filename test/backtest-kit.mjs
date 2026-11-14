// An invented world for the backtest tests (PRD E17): FDIC tables over 2020 to 2023 for the fake FDIC API in fdic-fake.mjs. Every bank,
// name and number is invented. The window is 2022-03-31 to 2023-12-31 (8 as-of quarters), with 8 quarters of lookback before it.
//   201 Example Hill Bank        HQ TX, a branch in Austin. Moderate, steady CRE distress. Took over 203 in an assisted merger.
//   202 Example Gone Bank        HQ CA, a branch in Los Angeles. Rising CRE distress; FAILED on 2023-05-12. Inactive today.
//   203 Example Assisted Bank    HQ CO, a branch in Denver. Rising distress; sold in an ASSISTED MERGER to 201 on 2023-09-15. Inactive today.
//   204 Example Calm Bank        HQ TX, its only office outside the metros. No distress. Acquirer in the failure of 202 and the merger of 206.
//   205 Example Prairie Bank     HQ SD (not one of our states), a branch in Denver: in the universe through the Summary of Deposits only.
//   206 Example Merged Bank      HQ TX, a branch in Austin. An ORDINARY MERGER into 204 on 2022-11-01. Inactive today.
//   207 Example Faraway Bank     HQ NV (not one of our states in this world), no branch in the metros: never in the universe.
import { fin, METROS } from './fdic-fake.mjs';
import { FDIC_FIELDS, quartersBack } from '../src/sources/fdic.mjs';

export { METROS };
export const NOW = new Date('2026-11-14T12:00:00Z');
export const FROM = '2022-03-31';
export const TO = '2023-12-31';
export const AS_OF = ['2022-03-31', '2022-06-30', '2022-09-30', '2022-12-31', '2023-03-31', '2023-06-30', '2023-09-30', '2023-12-31'];
export const REPS = quartersBack('20231231', 16);   // 2020-03-31 to 2023-12-31

// The backtest block of config.json with the window above and a holdout of the last two as-of quarters.
export const btConfig = (over = {}) => ({
  window: { from: FROM, to: TO }, callReportLagDays: 60, sodReleaseLagDays: 120, minCoverage: 0.95, minLabels: 20, holdoutFrom: '2023-09-30',
  topK: 2, horizonQuarters: 4, universe: 'hq-states-and-metro-footprint', labelKinds: ['failure', 'assisted_merger', 'disclosed_sale', 'fdic_loan_sale'], ...over,
});

const CALM = {
  ASSET: 900000, LNLSNET: 600000, LNRECONS: 50000, LNREMULT: 100000, LNRENRES: 250000, LNRENROW: 100000, LNRENROT: 150000, LNCOMRE: 1000,
  NCRECONS: 0, NCREMULT: 0, NCRENRES: 0, NCRENROW: 0, NCRENROT: 0, NARECONS: 0, NAREMULT: 0, NARENRES: 0, NARENROW: 0, NARENROT: 0,
  P3RENRES: 0, P3REMULT: 0, P9RENRES: 0, P9REMULT: 0, P3RECONS: 0, P9RECONS: 0, P3RENROW: 0, P3RENROT: 0, P9RENROW: 0, P9RENROT: 0,
  ORE: 0, ORECONS: 0, OREMULT: 0, ORENRES: 0, NTRECONQ: 0, NTREMULQ: 0, NTRENRSQ: 0, NTLNLSQ: 0, CBLRIND: 0, RBC: 90000, RBCT1J: 80000, LNATRES: 5000,
};
// i counts quarters from 2020-03-31 (0) to 2023-12-31 (15).
const STRESS = {
  201: () => ({ NCREMULT: 1500, NCRENRES: 2500, P3RENRES: 1200 }),
  202: (i) => ({ NCREMULT: 500 * i, NCRENRES: 900 * i, NARENRES: 400 * i, P3RENRES: 600 * i, P3REMULT: 300 * i, ORENRES: 150 * i, NTRENRSQ: i > 8 ? 200 : 0 }),
  203: (i) => ({ NCREMULT: 300 * i, NCRENRES: 700 * i, P3RENRES: 500 * i, NTREMULQ: i > 10 ? 150 : 0 }),
};
// The last quarter each bank filed: a bank files until it fails or merges.
const LAST = { 202: '20230331', 203: '20230630', 206: '20220930' };

export function btTables({ missing = [] } = {}) {
  const banks = ['201', '202', '203', '204', '205', '206', '207'];
  const financials = [];
  for (const cert of banks) {
    REPS.forEach((r, i) => {
      if (LAST[cert] && r > LAST[cert]) return;
      if (missing.some((m) => m.cert === cert && m.repdte === r)) return;
      financials.push(fin(cert, r, { ...CALM, ...(STRESS[cert]?.(i) ?? {}) }));
    });
  }
  const inst = (CERT, NAME, CITY, STALP, ESTYMD, ENDEFYMD, extra = {}) => ({ CERT, NAME, CITY, STALP, ASSET: 900000, WEBADDR: null, ACTIVE: ENDEFYMD === '12/31/9999' ? 1 : 0, INACTIVE: ENDEFYMD === '12/31/9999' ? 0 : 1, ESTYMD, ENDEFYMD, STCNTY: '48453', ...extra });
  const sod = [];
  for (const YEAR of [2019, 2020, 2021, 2022, 2023]) {
    const row = (CERT, BRNUM, STCNTYBR, DEPSUMBR, DEPSUM) => sod.push({ CERT, YEAR, BRNUM, STCNTYBR, MSABR: 0, DEPSUMBR, DEPSUM, CNTYNAMB: 'Invented', STALPBR: 'XX' });
    row(201, 0, 48453, 400000, 700000); row(201, 1, 48001, 300000, 0);
    if (YEAR <= 2022) row(202, 0, 6037, 500000, 500000);
    if (YEAR <= 2023) row(203, 0, 8031, 350000, 350000);
    row(204, 0, 48001, 800000, 800000);
    row(205, 0, 46099, 900000, 1000000); row(205, 3, 8031, 100000, 0);
    if (YEAR <= 2022) row(206, 0, 48453, 200000, 200000);
    row(207, 0, 32003, 100000, 100000);
  }
  return {
    institutions: [
      inst(201, 'Example Hill Bank', 'Austin', 'TX', '01/01/1990', '12/31/9999'),
      inst(202, 'Example Gone Bank', 'Los Angeles', 'CA', '01/01/2000', '05/12/2023', { CHANGEC1: 211, STCNTY: '06037' }),
      inst(203, 'Example Assisted Bank', 'Denver', 'CO', '06/01/2005', '09/15/2023', { CHANGEC1: 213, STCNTY: '08031' }),
      inst(204, 'Example Calm Bank', 'Elsewhere', 'TX', '01/01/1980', '12/31/9999', { STCNTY: '48001' }),
      inst(205, 'Example Prairie Bank', 'Sioux Falls', 'SD', '01/01/1970', '12/31/9999', { STCNTY: '46099' }),
      inst(206, 'Example Merged Bank', 'Austin', 'TX', '01/01/1995', '11/01/2022', { CHANGEC1: 223 }),
      inst(207, 'Example Faraway Bank', 'Reno', 'NV', '01/01/1960', '12/31/9999', { STCNTY: '32031' }),
    ],
    failures: [{ CERT: 202, NAME: 'EXAMPLE GONE BANK', FAILDATE: '5/12/2023', RESTYPE: 'FAILURE' }],
    history: [
      { TRANSNUM: 2023000202, CHANGECODE: 211, EFFDATE: '2023-05-12T00:00:00', OUT_CERT: 202, ACQ_CERT: 204, ORG_ROLE_CDE: 'FI' },
      { TRANSNUM: 2023000203, CHANGECODE: 213, EFFDATE: '2023-09-15T00:00:00', OUT_CERT: 203, ACQ_CERT: 201, CERT: 203, ORG_ROLE_CDE: 'FI' },
      { TRANSNUM: 2023000203, CHANGECODE: 810, EFFDATE: '2023-09-15T00:00:00', OUT_CERT: 203, ACQ_CERT: 201, CERT: 201, ORG_ROLE_CDE: 'FI' },
      { TRANSNUM: 2022000206, CHANGECODE: 223, EFFDATE: '2022-11-01T00:00:00', OUT_CERT: 206, ACQ_CERT: 204, CERT: 206, ORG_ROLE_CDE: 'FI' },
      { TRANSNUM: 2018000001, CHANGECODE: 223, EFFDATE: '2018-03-01T00:00:00', OUT_CERT: 333, ACQ_CERT: 201, CERT: 333, ORG_ROLE_CDE: 'FI' },
    ],
    sod,
    financials,
  };
}

// FDIC loan-sale announcements as src/sources/fdicsales.mjs stores them: one receivership matched to 202 (the failed bank).
export const SALES = () => ({
  '2023-SALE-INVENTED-1': { key: 'fdic-sale:2023-SALE-INVENTED-1', saleId: '2023-SALE-INVENTED-1', title: 'Invented loan sale', page: 'https://www.fdic.gov/asset-sales/events/invented-1', announcedOn: '2023-08-01',
    eventDates: { start: '2023-08-01', end: '2023-09-01' }, keyDates: {}, receiverships: [{ name: 'Example Gone Bank', key: 'fdic:202', failedCert: '202', matchedBy: 'name and state' }, { name: 'Example Unknown Bank', key: null }] },
});

export const FIN_FIELD_COUNT = FDIC_FIELDS.financials.length;
