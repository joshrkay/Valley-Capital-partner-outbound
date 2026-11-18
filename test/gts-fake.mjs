// Fakes of two GTS public trustee sites (src/sources/counties/gts.mjs, jefferson.mjs, douglas.mjs): their reports pages, report indexes
// and PDF reports. Every name, address, number and amount here is INVENTED. The layout is the reports' own: each line's labels sit in the
// columns `pdftotext -layout` gives for the county's PDFs, the names and legal descriptions wrap where theirs do, and pages carry the
// same headers and footers. The PDFs are real PDFs (textPdf), so the run reads them through pdftotext when poppler is installed;
// layoutOf reads the same text back out of them without poppler, so the run's tests do not depend on it.
import { JEFFERSON_HOST } from '../src/sources/counties/jefferson.mjs';
import { DOUGLAS_HOST } from '../src/sources/counties/douglas.mjs';

// The borrowers, owners, addresses and legal descriptions: none may reach a bank's file, the review list, a log or the state.
export const BORROWERS = ['Sample Ardent Holdings LLC', 'Sample Birchwood Partners LLC', 'Pat Q. Sampleton', 'Sample Corvid Storage LLC', 'Jordan R. Exampleby',
  'Sample Dunmore Plaza LLC', 'Casey T. Placeholder', 'Sample Elmhurst Lofts LLC', 'Sample Fenwick Retail LLC', 'Sample Garnet Office LLC', 'Robin K. Inventive'];
export const ADDRESSES = ['100 Example Way, Anytown, CO 80000', '300 Invented Road, Sampleton, CO 80001', '400 Example Avenue, Anytown, CO 80000', '500 Sample Boulevard, Anytown, CO 80000',
  '600 Example Court, Otherville, CO 80002', '700 Placeholder Lane, Anytown, CO 80000', '800 Sample Street, Peakview, CO 80009', '900 Invented Circle, Anytown, CO 80000'];
export const LEGAL_WORDS = ['SAMPLE ACRES', 'EXAMPLE HEIGHTS', 'INVENTED PARK', 'PLACEHOLDER RANCH', 'SAMPLE MEADOWS'];
export const APNS = ['99-999-01-001', '99-999-02-007', '99-901-01-050', '99-902-17-058', '999000102003', '9999-903-23-010'];

// ---- Layout --------------------------------------------------------------------------------------------------------------------
// One line with each text at its column, and at least one space between two texts, as pdftotext prints a column that overflows.
export const place = (...cols) => cols.reduce((s, [at, t]) => (t === '' ? s : s.length && s.length >= at ? `${s} ${t}` : s.padEnd(at) + t), '');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const longDate = (ymd) => { const [y, m, d] = ymd.split('-').map(Number); return `${MONTHS[m - 1]} ${d}, ${y}`; };
export const slash = (ymd) => { const [y, m, d] = ymd.split('-'); return `${m}/${d}/${y}`; };
const weekday = (ymd) => DAYS[new Date(`${ymd}T12:00:00Z`).getUTCDay()];
// Pages of lines to pdftotext's text: each page ends with a newline and a form feed.
const pagesText = (pages) => pages.map((p) => `${p.join('\n')}\n\f`).join('');

// ---- Jefferson's NED report ------------------------------------------------------------------------------------------------------
// One record, line by line, in the report's columns. Fields are given as printed ("1/7/2026", "$1,000.00"); `wrap` fields are arrays
// of lines; a field left undefined prints its label with no value; `omit` drops a label's line altogether.
export function nedRecord(r) {
  const o = new Set(r.omit ?? []);
  const L = [];
  const add = (key, line) => { if (!o.has(key)) L.push(line); };
  const wrapped = (key, at, label, lines = [''], col = 37) => { if (o.has(key)) return; L.push(place([at, label], [col, lines[0] ?? ''])); for (const x of lines.slice(1)) L.push(place([37, x])); };
  add('number', place([0, 'Foreclosure Number:'], [28, r.number ?? '']));
  add('nedDate', place([0, 'NED Date:'], [20, r.nedDate ?? ''], [43, 'Reception #:'], [63, r.nedReception ?? '']));
  add('saleDate', place([0, 'Original Sale Date:'], [20, r.saleDate ?? '']));
  add('dotDate', place([0, 'Deed of Trust Date:'], [20, r.dotDate ?? ''], [43, 'Recording Date:'], [61, r.dotRecorded ?? ''], [89, 'Reception #:'], [109, r.dotReception ?? '']));
  add('reRecorded', place([43, 'Re-Recording Date'], [89, 'Re-Recorded #:']));
  if (!o.has('legal')) { const [first, ...more] = r.legal ?? ['']; L.push(place([0, 'Legal:'], [7, first])); for (const x of more) L.push(place([7, x])); }
  if (r.apn) L.push('', place([6, `APN #: ${r.apn}`]), ''); else L.push('', '', '');
  add('address', place([0, 'Address:'], [9, r.address ?? '']));
  add('original', place([0, 'Original Note Amt:'], [19, r.original ?? ''], ...(o.has('loanType') ? [] : [[45, 'LoanType:'], [64, r.loanType ?? '']]), [92, 'Interest Rate:'], [111, r.rate ?? '']));
  add('current', place([0, 'Current Amount:'], [19, r.current ?? ''], [45, 'As Of:'], [64, r.asOf ?? ''], [92, 'Interest Type:'], [111, r.rateType ?? '']));
  wrapped('holder', 1, 'Current Lender (Beneficiary):', r.holder);
  wrapped('owner', 1, 'Current Owner:', r.owner);
  wrapped('lender', 1, 'Grantee (Lender On Deed of Trust):', r.lender, 36);
  wrapped('grantor', 1, 'Grantor (Borrower On Deed of Trust)', r.grantor);
  L.push('');
  add('newspaper', place([0, 'Publication:'], [13, r.newspaper ?? 'Sample Courier'], [41, 'First Publication Date:'], [65, r.firstPublication ?? '']));
  add('lastPublication', place([41, 'Last Publication Date:'], [64, r.lastPublication ?? '']));
  add('attorney', place([0, 'Attorney for Beneficiary:'], [28, r.attorney ?? '']));
  add('attorneyFile', place([0, 'Attorney File Number:'], [28, r.attorneyFile ?? ''], [56, 'Phone:'], [63, r.phone ?? '(555)010-0100'], [97, 'Fax:']));
  return L;
}
// The report: two records a page, each page with the report's header and its page number.
export function nedText(records, { from = '2026-11-12', through = from, county = 'Jefferson', perPage = 2 } = {}) {
  const pages = [];
  for (let i = 0; i < Math.max(records.length, 1); i += perPage) pages.push(records.slice(i, i + perPage));
  return pagesText(pages.map((recs, n) => [
    place([11, `Notices of Election and Demand Filed in ${county} County`]), '',
    place([33, `From ${longDate(from)} Through ${longDate(through)}`]),
    `${county} County Public Trustee makes no representation or warranties about the accuracy or adequacy of these`,
    'reports. You should conduct your own due diligence.', '', '',
    ...recs.flatMap(nedRecord), '', '', '',
    place([59, `Page ${n + 1} of ${pages.length}`]),
  ]));
}

const NED = (o) => ({ nedDate: '11/12/2026', saleDate: '03/10/2027', rate: '7.000', rateType: 'Fixed', firstPublication: '01/20/2027', lastPublication: '02/17/2027', ...o });
export const NED_WEEK1 = () => [
  NED({ number: 'J2699001', nedReception: '2026099001', dotDate: '06/15/2019', dotRecorded: '06/20/2019', dotReception: '2019009001',
    legal: [`LOT 4, BLOCK 7, ${LEGAL_WORDS[0]} FILING NO. 2, COUNTY OF JEFFERSON, STATE OF COLORADO.`], apn: APNS[0], address: ADDRESSES[0],
    original: '$4,200,000.00', loanType: 'Commercial', current: '$3,875,000.00', asOf: '10/30/2026', holder: ['Example Bank, N.A.'], owner: [BORROWERS[0]],
    lender: ['Example Bank, N.A., Its Successors and Assigns'], grantor: [BORROWERS[0]], attorney: 'Sample & Example LLP', attorneyFile: 'CO-26-0000101-XX' }),
  NED({ number: 'J2699002', nedReception: '2026099002', dotDate: '03/11/2022', dotRecorded: '03/18/2022', dotReception: '2022099002',
    legal: [`Lot 12, ${LEGAL_WORDS[1]} Block 3 Replat No. 1, according to the Plat thereof recorded May 2, 2019 at Reception No.`, '2019099999, County of Jefferson, State of Colorado.'],
    address: '', original: '2,150,000.00', loanType: 'BPL Commercial', current: '2,010,500.00', asOf: '11/03/2026', rate: '9.500', rateType: 'Adjustable',
    holder: ['Sample Trust Company, N.A., not in its individual capacity, but solely as trustee on behalf of Sample', '2025-1 Trust'], owner: [BORROWERS[1]],
    lender: ['Mortgage Electronic Registration Systems, Inc. as Nominee for Sample Community Bank,', 'Its Successors and Assigns'], grantor: [BORROWERS[1]],
    attorney: 'Example Law Group, P.C.', attorneyFile: 'Sample Matter' }),
  NED({ number: 'J2699003', nedReception: '2026099003', dotDate: '07/07/2012', dotRecorded: '07/12/2012', dotReception: '2012099003',
    legal: [`LOT 21, ${LEGAL_WORDS[2]} SUBDIVISION, COUNTY OF JEFFERSON,`, 'STATE OF COLORADO'], apn: APNS[1], address: ADDRESSES[1],
    original: '$150,000.00', loanType: 'FHA', current: '$128,400.00', asOf: '11/03/2026', holder: ['EXAMPLE MOUNTAIN BANK'], owner: [BORROWERS[2]],
    lender: ['MORTGAGE ELECTRONIC REGISTRATION SYSTEMS, INC. AS NOMINEE FOR', 'EXAMPLE HOME LOANS LLC, ITS SUCCESSORS AND ASSIGNS'], grantor: [BORROWERS[2]],
    attorney: 'Sample Law Firm, P.C.', attorneyFile: '19-000003', phone: '(555)010-0103' }),
  NED({ number: 'J2699004', nedReception: '2026099004', dotDate: '01/05/2026', dotRecorded: '01/20/2026', dotReception: '2026099104',
    legal: [`Lots 2, 4 and 5, Block 6, ${LEGAL_WORDS[3]} Unit 2`, 'County of Jefferson, State of Colorado'], address: ADDRESSES[2],
    original: '$120,000.00', loanType: 'business', current: '$81,000.00', asOf: '10/20/2026', holder: ['SAMPLE LENDING PARTNERS LLC'], owner: [BORROWERS[3]],
    lender: ['SAMPLE LENDING PARTNERS LLC'], grantor: [`${BORROWERS[3]} AND ${BORROWERS[4]}`], attorney: 'SAMPLE EXAMPLE PARTNERS, LLC', attorneyFile: '7001-2' }),
  NED({ number: 'J2699005', nedReception: '2026099005', dotDate: '02/02/2020', dotRecorded: '02/10/2020', dotReception: '2020099005',
    legal: [`LOT 6, BLOCK 3, ${LEGAL_WORDS[4]} FILING NO. 4, COUNTY OF JEFFERSON, STATE OF COLORADO.`], address: ADDRESSES[3],
    original: '$600,000.00', loanType: 'Conventional', current: '$550,000.00', asOf: '07/01/2026', holder: ['First Example Bank'], owner: [BORROWERS[5]],
    lender: ['MORTGAGE ELECTRONIC REGISTRATION SYSTEMS, INC. AS NOMINEE FOR', 'FIRST EXAMPLE BANK, ITS SUCCESSORS AND', 'ASSIGNS'], grantor: [BORROWERS[5]],
    attorney: 'Sample Law Firm, P.C.', attorneyFile: '26-000005' }),
];
// The week before's file (11/5): one record of its own.
export const NED_EARLIER = () => [
  NED({ number: 'J2698990', nedDate: '11/05/2026', nedReception: '2026098990', saleDate: '03/03/2027', dotDate: '04/01/2021', dotRecorded: '04/09/2021', dotReception: '2021098990',
    legal: [`LOT 30, BLOCK 2, ${LEGAL_WORDS[0]} FILING NO. 6, COUNTY OF JEFFERSON, STATE OF COLORADO`], address: ADDRESSES[4],
    original: '$1,250,000.00', loanType: 'Commercial', current: '$1,180,000.00', asOf: '11/01/2026', holder: ['Example Bank, N.A.'], owner: [BORROWERS[6]],
    lender: ['Example Bank, N.A.'], grantor: [BORROWERS[6]], attorney: 'Sample & Example LLP', attorneyFile: 'CO-26-0000090-XX', firstPublication: '01/13/2027', lastPublication: '02/10/2027' }),
];
// The next week's file (11/19): two new NEDs.
export const NED_WEEK2 = () => [
  NED({ number: 'J2699010', nedDate: '11/19/2026', nedReception: '2026099010', saleDate: '03/17/2027', dotDate: '05/01/2022', dotRecorded: '05/19/2022', dotReception: '2022099010',
    legal: [`LOT 4, ${LEGAL_WORDS[1]} FILING NO. 2, COUNTY OF JEFFERSON, STATE OF COLORADO.`], apn: '99-999-03-010', address: ADDRESSES[5],
    original: '$3,100,000.00', loanType: 'Commercial', current: '$2,940,000.00', asOf: '11/15/2026', holder: ['Example Bank, N.A.'], owner: [BORROWERS[7]],
    lender: ['Example Bank, N.A.'], grantor: [BORROWERS[7]], attorney: 'Sample & Example LLP', attorneyFile: 'CO-26-0000110-XX', firstPublication: '01/27/2027', lastPublication: '02/24/2027' }),
  NED({ number: 'J2699011', nedDate: '11/19/2026', nedReception: '2026099011', saleDate: '03/17/2027', dotDate: '10/01/2020', dotRecorded: '10/08/2020', dotReception: '2020099011',
    legal: [`LOT 2, BLOCK 1, ${LEGAL_WORDS[2]} WEST, COUNTY OF JEFFERSON, STATE OF COLORADO.`], address: ADDRESSES[6],
    original: '$300,000.00', loanType: 'VA', current: '$280,000.00', asOf: '11/05/2026', holder: ['Sample Community Bank'], owner: [BORROWERS[8]],
    lender: ['Sample Community Bank'], grantor: [BORROWERS[8]], attorney: 'Example Law Group, P.C.', attorneyFile: 'CO-26-0000111-XX', firstPublication: '01/27/2027', lastPublication: '02/24/2027' }),
];

// ---- The GTS pre-sale list -------------------------------------------------------------------------------------------------------
// Each county prints the same template in its own columns (Jefferson's through Acrobat Distiller, Douglas's straight from Crystal
// Reports): where its title, run date and time, sale date and page footer sit, and where each label's value starts.
export const PRESALE_LAYOUT = Object.freeze({
  Jefferson: { title: 27, run: 78, time: 93, sale: 41, saleGap: false, footerPage: 91, number: 21, grantor: 21, legal: 23, address: 16, beneficiary: 26, beneficiaryWrap: 26,
    first: 19, last: 18, amendedFirst: 33, amendedLastLabel: 59, amendedLast: 94, money: 28, dollar: '$ ', totalGap: 23 },
  Douglas: { title: 35, run: 113, time: 130, sale: 51, saleGap: true, footerPage: 130, number: 22, grantor: 22, legal: 24, address: 16, beneficiary: 33, beneficiaryWrap: 32,
    first: 22, last: 22, amendedFirst: 33, amendedLastLabel: 59, amendedLast: 94, money: 31, dollar: '$', totalGap: 25 },
});
export function presaleRecord(r, layout) {
  const c = layout, o = new Set(r.omit ?? []), L = [];
  const money = (v) => (v === undefined ? '' : /^\$/.test(v) || !/^[\d,.]+$/.test(v) ? v : `${c.dollar}${v}`);
  if (!o.has('number')) L.push(place([0, 'Foreclosure: #:'], [c.number, r.number ?? '']));
  if (!o.has('grantor')) L.push(place([0, 'The Grantor:'], [c.grantor, r.grantor ?? '']));
  L.push('');
  if (!o.has('legal')) { const [first, ...more] = r.legal ?? ['']; L.push(place([0, 'Legal Description:'], [c.legal, first])); for (const x of more) L.push(x === '' ? '' : place([c.legal, x])); }
  if (!o.has('address')) L.push(place([0, 'Street Address:'], [16, r.address ?? '']));
  L.push('');
  if (!o.has('beneficiary')) { const [first, ...more] = r.beneficiary ?? ['']; L.push(place([0, 'Current Beneficiary Name:'], [c.beneficiary, first])); for (const x of more) L.push(place([c.beneficiaryWrap, x])); }
  if (!(r.beneficiary ?? []).slice(1).length) L.push('');
  L.push(place([0, 'First Publication:'], [c.first, r.firstPublication ?? '']), '');
  L.push(place([0, 'Last Publication:'], [c.last, r.lastPublication ?? '']), '');
  if (r.amendedFirst || r.amendedLast) L.push(place([0, 'Amended First Publication:'], [c.amendedFirst, r.amendedFirst ?? ''], [c.amendedLastLabel, 'Amended Last Publication:'], [c.amendedLast, r.amendedLast ?? '']), '');
  L.push(place([0, 'Publication Newspaper:'], [c.money, r.newspaper ?? 'Sample County News']));
  if (!o.has('bid')) L.push(place([0, "Lender's Bid Amount:"], [c.money, money(r.bid)]));
  if (!o.has('deficiency')) L.push(place([0, 'Deficiency:'], [c.money, money(r.deficiency)]));
  if (!o.has('total')) L.push(place([0, 'Total Indebtedness:'], [c.money, money(r.total)]));
  return L;
}
// The list: the title and sale date on the first page, records one or two a page, the total after the last, each page's footer.
export function presaleText(records, { county = 'Jefferson', runDate = '2026-11-17', runTime = '11:30:00AM', saleDate = '2026-11-19', perPage = 2, total = records.length, title = true, saleLine = true } = {}) {
  const c = PRESALE_LAYOUT[county];
  const pages = [];
  for (let i = 0; i < Math.max(records.length, 1); i += perPage) pages.push(records.slice(i, i + perPage));
  return pagesText(pages.map((recs, n) => [
    ...(n === 0 ? [
      ...(title ? [place([c.title, `${county} County Pre Sale Foreclosure List`], [c.run, slash(runDate)], [c.time, runTime])] : []),
      ...(c.saleGap ? [''] : []),
      ...(saleLine ? [place([c.sale, `Sale Date: ${longDate(saleDate)}`])] : []), '', '', '',
    ] : []),
    ...recs.flatMap((r, k) => [...presaleRecord(r, c), ...(k < recs.length - 1 ? ['', ''] : [])]),
    ...(n === pages.length - 1 && total !== null ? ['', '', '', place([0, 'Total Foreclosures:'], [c.totalGap, String(total)])] : []),
    '', '', '', '', place([0, `${weekday(runDate)}, ${longDate(runDate)}`], [c.footerPage, `Page ${n + 1} of ${pages.length}`]),
  ]));
}

const PS = (o) => ({ firstPublication: '09/02/2026', lastPublication: '09/30/2026', ...o });
export const JEFFERSON_PRESALE = () => [
  PS({ number: 'J2690044', grantor: BORROWERS[9], legal: [`LOT 6, BLOCK 2, A REPLAT OF ${LEGAL_WORDS[3]} SUBDIVISION FILING NO. 4,`, 'COUNTY OF JEFFERSON, STATE OF COLORADO.', '', `PARCEL: ${APNS[2]}`],
    address: ADDRESSES[7], beneficiary: ['Example Bank, N.A.'], bid: '245,000.00', deficiency: '0.00', total: '245,000.00' }),
  PS({ number: 'J2690055', grantor: BORROWERS[10], legal: ['PARCEL 2, SECTION 14, TOWNSHIP 9 SOUTH, RANGE 99 WEST, OF THE 6TH PRINCIPAL MERIDIAN,', 'COUNTY OF JEFFERSON, STATE OF COLORADO, MORE PARTICULARLY DESCRIBED AS FOLLOWS:',
    'BEGINNING AT THE SOUTHWEST CORNER OF SAID PARCEL 2; THENCE NORTH 01 DEGREES 02 MINUTES 03', 'SECONDS WEST, A DISTANCE OF 100.00 FEET TO THE POINT OF BEGINNING.'],
    address: ADDRESSES[0], beneficiary: ['Sample Community Bank'], bid: '400,000.00', deficiency: '25,000.00', total: '425,000.00' }),
  PS({ number: 'J2690085', grantor: BORROWERS[0], legal: [`CONDOMINIUM UNIT 7, BUILDING NO. 3, ${LEGAL_WORDS[4]} TOWNHOMES, ACCORDING TO THE DECLARATION`, 'THEREOF IN BOOK 9999 PAGE 101, RECORDED 01/02/1980.', '', `APN #: ${APNS[3]}`],
    address: ADDRESSES[1], beneficiary: ['Sample Loan Servicing LLC'], bid: '90,000.00', deficiency: '40,000.00', total: '130,000.00' }),
];
export const DOUGLAS_MONDAY = () => [
  PS({ number: '249166', grantor: BORROWERS[3], legal: [`LOT 5, ${LEGAL_WORDS[0]} Subdivision, County of Douglas, State of Colorado. APN:`, APNS[4],
    'and together with: all buildings, improvements and fixtures now or later on the land,', 'and all easements and appurtenances.'],
    address: ADDRESSES[2], beneficiary: ['Example Mountain Bank'], firstPublication: '05/20/2026', lastPublication: '06/17/2026', amendedFirst: '8/5/26', amendedLast: '09/02/2026',
    bid: '$1,600,000.00', deficiency: '$700,000.00', total: '$2,300,000.00' }),
  PS({ number: '269021', grantor: BORROWERS[5], legal: [`LOT 8, BLOCK 4, ${LEGAL_WORDS[1]} FILING NO. 2, COUNTY OF DOUGLAS,`, 'STATE OF COLORADO.'],
    address: ADDRESSES[3], beneficiary: ['SAMPLE TRUST COMPANY, NATIONAL ASSOCIATION, NOT IN ITS INDIVIDUAL', 'CAPACITY BUT SOLELY AS TRUSTEE FOR SAMPLE TRUST'],
    bid: '$500,000.00', deficiency: '$0.00', total: '$500,000.00' }),
  PS({ number: '269151', grantor: BORROWERS[7], legal: [`LOT 2, BLOCK 3, ${LEGAL_WORDS[2]} FILING NO. 5, TOWN OF SAMPLETON,`, 'COUNTY OF DOUGLAS, STATE OF COLORADO', `PARCEL ID: ${APNS[5]}`],
    address: ADDRESSES[4], beneficiary: ['SAMPLE CENTRAL CREDIT UNION'], bid: '$1,200,000.00', deficiency: '$0.00', total: '$1,200,000.00' }),
];
// Tuesday's update: the first sale's bid lowered and its deficiency raised, the third withdrawn.
export const DOUGLAS_TUESDAY = () => [{ ...DOUGLAS_MONDAY()[0], bid: '$1,500,000.00', deficiency: '$800,000.00' }, DOUGLAS_MONDAY()[1]];

// ---- The HTML pages --------------------------------------------------------------------------------------------------------------
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const shell = (county, title, body, action) => `


<!DOCTYPE html>

<html lang="en">
<head>
   <!-- version: 2.2.6.0 -->
   <meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>
	${county} Report - ${esc(title)}
</title>
<link href="Custom/Custom.css" rel="stylesheet" /><link href="favicon.ico" rel="shortcut icon" type="image/x-icon" />
</head>
<body class="custom font-sans">
   <div class="flex flex-col justify-between min-h-screen">
      <form method="post" action="${action}" id="ctl01">
<input type="hidden" name="__VIEWSTATE" id="__VIEWSTATE" value="SAMPLEVIEWSTATEbase64AAAA==" />
<input type="hidden" name="__VIEWSTATEGENERATOR" id="__VIEWSTATEGENERATOR" value="0000AAAA" />
   <!-- Begin Custom Header -->
   <!-- End Custom Header -->
   <p><a href="./">Back To Foreclosure Search</a></p>
   <p><a href="reports">Back To Foreclosure Reports</a></p>
${body}
   <!-- Begin Custom Footer -->
   <!-- End Custom Footer -->
      </form>
   </div>
</body>
</html>`;
// The reports page: the disclaimer, then "Available Report Types", one GET link each.
export const reportsHtml = (county, links) => shell(county, 'Foreclosure Reports', `   <h1>Foreclosure Reports</h1>
   <h2>Disclaimer</h2>
   <span id="MainContent_CustomContentPlaceHolder_tbReportsDisclaimer">THE INFORMATION ON THIS SAMPLE PAGE IS INVENTED.</span>
   <h2>Available Report Types</h2>
   <ul>
${links.map(([href, text]) => `      <li><a href="${esc(href)}">${esc(text)}</a></li>`).join('\n')}
   </ul>
   <h2>Search Reports</h2>
   <input type="submit" name="search" value="Search" />`, './reports');
// A report's index: its title, then a month heading and its list of files, newest first.
export const indexHtml = (county, title, months, t = 7) => shell(county, title, `   <h1 id="MainContent_CustomContentPlaceHolder_lblTitle">${esc(title)}</h1>
   ${months.map(([heading, items]) => `<h2>${esc(heading)}</h2><ol class="list-none p-0">${items.map((f) => `<li class="grid grid-cols-[90px_max-content]"><span>${esc(f.posted)}</span><a href="Report_Files/${esc(f.file)}" target="_blank">${esc(f.text)}</a><span>${esc(f.description ?? f.text)}</span></li>`).join('')}</ol>`).join('')}`, `./report?t=${t}`);

// ---- A PDF from layout text, and the text back out ---------------------------------------------------------------------------------
// Each line one Courier text line, each page its own page, so pdftotext -layout gives the lines back in their columns.
const pdfEsc = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
export function textPdf(text) {
  const pages = String(text).split('\f').filter((p, i, a) => i < a.length - 1 || p.trim()).map((p) => p.replace(/^\n/, '').replace(/\n$/, '').split('\n'));
  const objs = [];
  const add = (s) => { objs.push(s); return objs.length; };
  const cat = add(''), pagesId = add(''), font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>');
  const kids = [];
  for (const lines of pages) {
    const body = `BT /F1 6 Tf 8 TL 12 780 Td\n${lines.map((l) => `(${pdfEsc(l)}) Tj T*`).join('\n')}\nET`;
    const c = add(`<< /Length ${Buffer.byteLength(body, 'latin1')} >>\nstream\n${body}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Contents ${c} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`));
  }
  objs[cat - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  let out = '%PDF-1.4\n';
  const offs = [];
  objs.forEach((o, i) => { offs.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root ${cat} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
// The layout text of a textPdf, without poppler: each content stream's lines, each page ended by a newline and a form feed.
export async function layoutOf(bytes) {
  const s = Buffer.from(bytes).toString('latin1');
  if (!s.startsWith('%PDF-')) throw new Error('the file is not a PDF');
  const pages = [...s.matchAll(/stream\n([\s\S]*?)\nendstream/g)].map((m) => [...m[1].matchAll(/\(((?:\\.|[^\\)])*)\) Tj T\*/g)].map((x) => x[1].replace(/\\(.)/g, '$1')));
  return pages.map((p) => `${p.join('\n')}\n\f`).join('');
}

// ---- The sites ------------------------------------------------------------------------------------------------------------------
// fetchImpl for runNoticeSource and verifyNoticeSource. `pages` maps a path with its query ("/report?t=7") to HTML; `files` maps a file's
// path ("/Report_Files/NED 11-12-2026.pdf", unencoded) to { bytes, etag, lastModified }. A request whose If-None-Match is the file's
// ETag is answered 304. `robots` is robots.txt's body, null for a 404 (as both counties answer).
export function fakeGts({ host, pages = {}, files = {}, robots = null, status = {} }) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const h = init.headers ?? {};
    const path = `${decodeURIComponent(u.pathname)}${u.search}`;
    calls.push({ url, path, ua: h['user-agent'] ?? null, ifNoneMatch: h['if-none-match'] ?? null, ifModifiedSince: h['if-modified-since'] ?? null });
    if (u.host !== host) return new Response('not found', { status: 404 });
    if (status[path]) return new Response('error', { status: status[path] });
    if (u.pathname === '/robots.txt') return robots === null ? new Response('File or directory not found.', { status: 404 }) : new Response(robots, { status: 200 });
    if (pages[path] !== undefined) return new Response(pages[path], { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
    const f = files[path];
    if (f) {
      if (f.etag && h['if-none-match'] === f.etag) return new Response(null, { status: 304, headers: { etag: f.etag } });
      return new Response(f.bytes, { status: 200, headers: { 'content-type': 'application/pdf', ...(f.etag ? { etag: f.etag } : {}), ...(f.lastModified ? { 'last-modified': f.lastModified } : {}) } });
    }
    return new Response('not found', { status: 404 });
  };
  return { fetchImpl, calls };
}
const file = (text, etag, lastModified) => ({ bytes: textPdf(text), etag, lastModified });

// Jefferson's site in a given week. Week 1 (Nov 18): the NED index lists Nov 5 and Nov 12, the pre-sale list is for Nov 19. Week 2
// (Nov 25): Nov 19 is added, and the pre-sale list, under the same file name, is for Nov 26 (`presaleSame` keeps last week's file, so
// its ETag answers 304). `archive` adds the archive index (Dec 2024 to Feb 2025).
export function jeffersonSite({ week = 1, presaleSame = false, robots = null, nedText: ned = null } = {}) {
  const nedFiles = [{ posted: '11/5/2026', file: 'NED 11-5-2026.pdf', text: 'NED\'S recorded on November 5, 2026\t', description: 'NED\'S recorded on November 5, 2026\t' },
    { posted: '11/12/2026', file: 'NED 11-12-2026.pdf', text: 'NED\'S recorded on November 12, 2026' }];
  if (week >= 2) nedFiles.push({ posted: '11/19/2026', file: 'NED 11-19-2026.pdf', text: 'NED\'S recorded on November 19, 2026' });
  const presale = week >= 2 && !presaleSame
    ? { posted: '11/24/2026', text: 'Preliminary Bid List for 11/26/2026', body: presaleText([JEFFERSON_PRESALE()[1], JEFFERSON_PRESALE()[2]], { runDate: '2026-11-24', runTime: '11:45:10AM', saleDate: '2026-11-26' }), etag: '"b0000000000002:0"', lm: 'Tue, 24 Nov 2026 18:00:00 GMT' }
    : { posted: week >= 2 ? '11/24/2026' : '11/17/2026', text: 'Preliminary Bid List for 11/19/2026', body: presaleText(JEFFERSON_PRESALE()), etag: '"b0000000000001:0"', lm: 'Tue, 17 Nov 2026 18:00:00 GMT' };
  const pages = {
    '/reports': reportsHtml('Jefferson', [['/report?t=6', 'Pre Sale List'], ['/report?t=7', 'Election and Demand Notices Filed'], ['/report?t=11', 'Statistical & Historical Reports'], ['/report?t=14', 'Archived Election and Demand Notices Filed']]),
    '/report?t=7': indexHtml('Jefferson', 'Election and Demand Notices Filed', [['November, 2026', [...nedFiles].reverse()]], 7),
    '/report?t=6': indexHtml('Jefferson', 'Pre Sale List', [['November, 2026', [{ posted: presale.posted, file: 'Preliminary bid report-Tuesday.pdf', text: presale.text }]]], 6),
    '/report?t=14': indexHtml('Jefferson', 'Archived Election and Demand Notices Filed', [
      ['February, 2025', [{ posted: '2/1/2025', file: 'February 2025 Election and Demand Notices.pdf', text: 'NEDs recorded February 2025\t', description: '' }]],
      ['January, 2025', [{ posted: '1/1/2025', file: 'January 2025 Election and Demand Notices.pdf', text: 'NED\'s recorded January 2025', description: '' }]],
      ['December, 2024', [{ posted: '12/1/2024', file: 'December 2024 Election and Demand Notices.pdf', text: 'NEDs recorded December 2024', description: '' }]],
    ], 14),
  };
  const files = {
    '/Report_Files/NED 11-5-2026.pdf': file(nedText(NED_EARLIER(), { from: '2026-11-05' }), '"a0000000000001:0"', 'Thu, 05 Nov 2026 16:00:00 GMT'),
    '/Report_Files/NED 11-12-2026.pdf': file(ned ?? nedText(NED_WEEK1(), { from: '2026-11-12' }), '"a0000000000002:0"', 'Thu, 12 Nov 2026 16:00:00 GMT'),
    '/Report_Files/NED 11-19-2026.pdf': file(nedText(NED_WEEK2(), { from: '2026-11-19' }), '"a0000000000003:0"', 'Thu, 19 Nov 2026 16:00:00 GMT'),
    '/Report_Files/Preliminary bid report-Tuesday.pdf': file(presale.body, presale.etag, presale.lm),
    '/Report_Files/January 2025 Election and Demand Notices.pdf': file(nedText([NED({ ...NED_WEEK1()[0], number: 'J2500101', nedDate: '01/09/2025', nedReception: '2025000101', saleDate: '05/15/2025' })], { from: '2025-01-01', through: '2025-01-31' }), '"a1000000:0"', 'Sat, 01 Feb 2025 09:00:00 GMT'),
    '/Report_Files/February 2025 Election and Demand Notices.pdf': file(nedText([NED({ ...NED_WEEK1()[2], number: 'J2500201', nedDate: '02/12/2025', nedReception: '2025000201', saleDate: '06/12/2025' })], { from: '2025-02-01', through: '2025-02-28' }), '"a2000000:0"', 'Sat, 01 Mar 2025 09:00:00 GMT'),
    '/Report_Files/December 2024 Election and Demand Notices.pdf': file(nedText([NED({ ...NED_WEEK1()[3], number: 'J2400301', nedDate: '12/10/2024', nedReception: '2024000301', saleDate: '04/10/2025' })], { from: '2024-12-01', through: '2024-12-31' }), '"a3000000:0"', 'Wed, 01 Jan 2025 09:00:00 GMT'),
  };
  return fakeGts({ host: JEFFERSON_HOST, pages, files, robots });
}

// Douglas's site: Monday's pre-sale report, and from Tuesday its update (listed first, as GTS lists the newest first).
export function douglasSite({ tuesday = true, robots = null } = {}) {
  const items = [
    ...(tuesday ? [{ posted: '11/17/2026', file: 'UPDATED Sale Report 11-18-2026.pdf', text: 'Updated Sale Report 11-18-2026', description: 'Updated Sale Report for Wednesday 11/18/26' }] : []),
    { posted: '11/16/2026', file: '11-18-26 PreSale.pdf', text: 'Pre-Sale Report for Wednesday 11/18/26' },
  ];
  const pages = {
    '/gts/reports': reportsHtml('Douglas', [['/gts/report?t=1', 'Current Pre Sale List']]),
    '/gts/report?t=1': indexHtml('Douglas', 'Current Pre Sale List', [['November, 2026', items]], 1),
  };
  const files = {
    '/gts/Report_Files/11-18-26 PreSale.pdf': file(presaleText(DOUGLAS_MONDAY(), { county: 'Douglas', runDate: '2026-11-16', runTime: '1:15:00PM', saleDate: '2026-11-18' }), '"c0000000000001:0"', 'Mon, 16 Nov 2026 20:00:00 GMT'),
    '/gts/Report_Files/UPDATED Sale Report 11-18-2026.pdf': file(presaleText(DOUGLAS_TUESDAY(), { county: 'Douglas', runDate: '2026-11-17', runTime: '2:20:00PM', saleDate: '2026-11-18' }), '"c0000000000002:0"', 'Tue, 17 Nov 2026 21:00:00 GMT'),
  };
  return fakeGts({ host: DOUGLAS_HOST, pages, files, robots });
}
