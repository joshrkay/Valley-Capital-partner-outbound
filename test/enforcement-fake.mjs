// A fake www.federalreserve.gov for the enforcement adapter's tests (PRD next-five E18-S2). Invented banks, orders and people only. The
// files copy the real layout seen on 2026-11-16: { "eaitems": [...] } with a byte-order mark, ids as numbers in the old file and numeric
// strings in the recent one, 1950-01-01 for "no termination", several organizations in one bkorg, actions against individuals with
// person and porg, a type that names a person, a note, and one individual's record with no url. A press release links its order PDF.
import { makePdf } from './fdicsales-fake.mjs';

// The people in the fixtures. None of them may ever reach the store, the run log or the change log.
export const PEOPLE = ['Pat Person', 'Robin Sample', 'Lee Example', 'Jamie Doe', 'Casey Nobody'];

// The bank list the orders are matched against (sources/fdic/institutions.json).
export const INSTITUTIONS = {
  1001: { CERT: '1001', NAME: 'Example Valley Bank', CITY: 'Sampleton', STALP: 'TX' },
  1002: { CERT: '1002', NAME: 'Example Desert Bank', CITY: 'Mesa Example', STALP: 'AZ' },
  1003: { CERT: '1003', NAME: 'First Example Bank', CITY: 'Sampleton', STALP: 'TX' },
  1004: { CERT: '1004', NAME: 'First Example Bank', CITY: 'Otherville', STALP: 'CO' },
  1005: { CERT: '1005', NAME: 'Example Coast Bank', CITY: 'Harbor', STALP: 'CA' },
};

const R = (n) => `/newsevents/pressreleases/enforcement${n}.htm`;
export const RECENT = () => [
  { id: '50001', edt: '2026-09-24', tdt: '1950-01-01', type: 'Written Agreement', bkorg: 'Example Valley Bancorp, Inc., Sampleton, Texas', url: R('20261002a'), urlname: 'Press Release' },
  { id: '50002', edt: '2026-08-14', tdt: '1950-01-01', type: 'Cease and Desist Order, Civil Money Penalty', bkorg: 'Example Desert Bank, Mesa Example, Arizona', url: `https://www.federalreserve.gov${R('20260820b')}`, urlname: 'Press Release' },
  { id: '50003', edt: '2026-08-12', tdt: '1950-01-01', type: 'Prohibition from Banking', person: 'Pat Person', porg: 'Example Desert Bank, Mesa Example, Arizona', url: R('20260820a'), urlname: 'Press Release' },
  { id: '50004', edt: '2025-03-01', tdt: '2026-06-30', type: 'Cease and Desist Order', bkorg: 'Example Coast Bank, Harbor, California', url: '/newsevents/pressreleases/files/enf20250301a1.pdf', urlname: 'Order (PDF)' },
  { id: '50005', edt: '2026-07-01', tdt: '1950-01-01', type: 'Civil Money Penalty $100,000 (collectively with Robin Sample)', bkorg: 'Faraway Example Bank, Somewhere, Ohio', url: R('20260705a'), urlname: 'Press Release' },
  { id: '50006', edt: '2026-01-10', tdt: '1950-01-01', type: 'Written Agreement', bkorg: 'First Example Bank', url: R('20260115a'), urlname: 'Press Release' },
  { id: '50007', edt: '2026-02-02', tdt: '1950-01-01', type: 'Section 19 Letters', person: 'Lee Example', porg: 'Example Valley Bank', url: '/supervisionreg/files/example20260202.pdf', urlname: 'Letter (PDF)' },
];
export const OLD = () => [
  { id: 2001, edt: '2012-05-01', tdt: '1950-01-01', bkorg: 'Example Valley Bank, Sampleton, Texas', type: 'Cease and Desist Order', note: 'Modification requested by Jamie Doe on 5/1/2013.', url: R('20120503a'), urlname: 'Press Release' },
  { id: 2002, edt: '1999-07-07', tdt: '1950-01-01', person: 'Casey Nobody', porg: 'Example Holding Co. Sampleton, TX', type: 'Cease and Desist Order', url: null, urlname: 'DNE' },
  { id: 2003, edt: '2010-03-01', tdt: '2014-04-01', bkorg: 'Example Coast Bancorp, Harbor, California; and Example Coast Bank, Harbor, California', type: 'Written Agreement', url: R('20100303a'), urlname: 'Press Release' },
];
export const file = (items) => `﻿${JSON.stringify({ eaitems: items })}`;

export const ORDER_LINES = ['UNITED STATES OF AMERICA', 'BEFORE THE BOARD OF GOVERNORS OF THE FEDERAL RESERVE SYSTEM', 'Cease and Desist Order', 'EXAMPLE DESERT BANK', 'Mesa Example, Arizona',
  'The Bank shall submit a plan to reduce classified assets and to manage its commercial real estate', 'loans. The plan shall address commercial real estate concentrations of credit.'];
const PRESS = (pdf) => `<!doctype html><html><body><div id="article"><h3>Federal Reserve Board issues enforcement action with Example Bank</h3>
<p>For release at 11:00 a.m. EDT</p><p><a href="${pdf}">Order (PDF)</a></p><p>Media contact: Pat Person 555-010-0100</p></div></body></html>`;

const BASE = 'https://www.federalreserve.gov';
export function fakeFed({ recent = RECENT(), old = OLD(), robots = null, pages = {}, status = {} } = {}) {
  const calls = [];
  const files = {
    '/supervisionreg/files/ea-cms-recent.json': file(recent),
    '/supervisionreg/files/ea-old.json': file(old),
    [R('20261002a')]: PRESS('/newsevents/pressreleases/files/enf20261002a1.pdf'),
    '/newsevents/pressreleases/files/enf20261002a1.pdf': makePdf(['Written Agreement', 'EXAMPLE VALLEY BANCORP, INC.', 'The Bank shall maintain sound problem assets management.']),
    [R('20260820b')]: PRESS('/newsevents/pressreleases/files/enf20260820b1.pdf'),
    '/newsevents/pressreleases/files/enf20260820b1.pdf': makePdf(ORDER_LINES),
    '/newsevents/pressreleases/files/enf20250301a1.pdf': makePdf(['Order to Cease and Desist', 'EXAMPLE COAST BANK', 'The Bank shall improve its liquidity.']),
    ...(robots === null ? {} : { '/robots.txt': robots }),
    ...pages,
  };
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    calls.push({ url, path: u.pathname, ua: init.headers?.['user-agent'] });
    if (u.origin !== BASE) return new Response('not found', { status: 404 });
    if (status[u.pathname]) return new Response('error', { status: status[u.pathname] });
    if (!(u.pathname in files) || files[u.pathname] === null) return new Response('not found', { status: 404 });
    const body = files[u.pathname];
    return new Response(body, { status: 200, headers: { 'content-type': Buffer.isBuffer(body) ? 'application/pdf' : u.pathname.endsWith('.json') ? 'application/json' : 'text/html' } });
  };
  return { fetchImpl, calls };
}
