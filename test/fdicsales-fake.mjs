// A fake www.fdic.gov for the loan-sale adapter's tests (PRD E16-S2). Invented sales, banks, advisors and people only. The pages copy
// the real layout seen on 2026-11-14: the loan-sales page's "Loan Sales Event(s)" list, a sale page with its Event Date field, Key Dates
// table, receivership sentence, portfolio paragraphs and a contacts block (a person, a phone number, an email address) that must never
// be stored, and an announcement PDF made of FlateDecode text streams.
import { deflateSync } from 'node:zlib';

export const PERSON = 'Pat Person';
export const PHONE = '(555) 010-0100';
export const EMAIL = 'pat.person@example.test';
export const ADVISOR = 'Example Loan Advisors';

export const ROBOTS = ['User-agent: *', 'Crawl-delay: 30', 'Disallow: /search/', 'Disallow: /asset-sales/private-', '', 'User-agent: SomeOtherBot', 'Disallow: /'].join('\n');

export const LISTING = (slugs = ['exb-26-sale-announcement', 'exb2-26-sale-announcement']) => `<!doctype html><html><head><title>Loan Sales | FDIC.gov</title></head><body>
<header><nav><a href="/asset-sales/events/site-wide-banner">Banner</a></nav></header>
<main id="main-content"><p>A loan sale is one of the disposition strategies that the FDIC uses.</p>
<h2>Loan Sales Event(s)</h2><table><thead><tr><th>Description</th><th>Date(s)</th><th>Location</th></tr></thead><tbody>
${slugs.map((s) => `<tr><td><a href="/asset-sales/events/${s}">${s.replace(/-sale-announcement$/, '').toUpperCase()} Sale Announcement</a></td><td>October 26 - December 2, 2026</td><td>Virtual</td></tr>`).join('\n')}
</tbody></table>
<h2>Loan Sale Advisors</h2><p>${ADVISOR}<br>${PERSON}<br>${PHONE}<br><a href="mailto:${EMAIL}">${PERSON}</a></p></main></body></html>`;

export const EMPTY_LISTING = `<html><body><main><h2>Loan Sales Event(s)</h2><p>There are no loan sales event announcements at this time.</p></main></body></html>`;

export const SALE_PAGE = ({ id = 'EXB2-26', bank = 'Example Prairie Bank, Sampleton, Arizona (EPB)', loans = '312', upb = '41,512,300', dates = 'October 26&ndash;December 2, 2026, All Day', pdf = true, receiver = true } = {}) => `<!doctype html><html><head><title>${id} Sale Announcement | FDIC.gov</title></head><body>
<main id="main-content"><h1 class='text-align-center'>${id} Sale Announcement </h1>
<article class="node--event-v2"><div>
<div class="field field--name-field-event-smartdate field--type-smartdate field--label-inline field__items"><div class="field__label">Event Date</div><div class="field__item">${dates}</div></div>
<div class="field field--name-field-where field--type-string field--label-inline field__items"><div class="field__label">Location</div><div class="field__item">Virtual</div></div>
<div class="field field--name-body field--type-text-with-summary field--label-hidden field__items"><div class="field__item"><p>Loan Sale Announcement<br><span>$41.5 Million Sealed-Bid Loan Sale</span></p>
${pdf ? `<p><a href="/asset-sales/${id.toLowerCase()}-loan-sale-announcement.pdf" type="pdf" title="${id} Loan Sale Announcement"><span>${id} Loan Sale Announcement</span></a></p>` : ''}
<table><thead><tr><th colspan="2"><p>Key Dates</p></th></tr></thead><tbody>
<tr><td><span>Bidder Due Diligence&nbsp;&nbsp;</span></td><td><span>10/26/2026 – 12/02/2026</span></td></tr>
<tr><td><span>Calculation Date</span></td><td><span>10/30/2026</span></td></tr>
<tr><td><span>Bid Deadline</span></td><td><span>12/02/2026</span></td></tr>
<tr><td><span>Final Funding/Closing</span></td><td><span>12/18/2026</span></td></tr></tbody></table>
<p class="text-align-justify"><span>The Federal Deposit Insurance Corporation (FDIC), ${receiver ? `in its capacity as Receiver for ${bank}, is conducting` : 'is conducting'} a competitive sealed-bid sale comprised of ${loans} loans having an unpaid principal balance (UPB) of $${upb}. The portfolio consists primarily of commercial real estate loans and commercial loans. The loans will be offered for sale in all-cash pools to be structured by the Loan Sale Advisor and the FDIC based on loan performance. The number, size, and composition of the pools remain subject to change and will be described in the bid package.</span></p>
<h2 class="text-align-justify"><span>Portfolio Composition</span></h2><p><span>Approximately 61.20% of UPB (190 loans, $25,405,528 in UPB) is performing and approximately 38.80% of UPB (122 loans, $16,106,772 in UPB) is nonperforming. Balances, coupons, and maturity dates are based on FDIC loan data as of September 25, 2026.</span></p>
<h2 class="text-align-justify"><span>Prospective Bidder Inquiries and Contacts</span></h2><p><span>All inquiries or contacts regarding the proposed sale are to be directed to the Loan Sale Advisor (${ADVISOR}). For more information, please contact:</span></p>
<div class="embedded-entity"><p class="text-align-center"><span>${PERSON}</span><br><span><a href="tel:5550100100">${PHONE}</a></span><br><a href="mailto:${EMAIL}"><span>${EMAIL}</span></a></p></div>
<p>General inquiries may be directed to: <a href="mailto:sales@example.test">sales@example.test</a></p>
</div></div></div></article></main>
<div class="block-fdic-node-last-updated-block"><p>Last Updated: October 15, 2026</p></div></body></html>`;

// A one-page PDF whose text is in a FlateDecode content stream, as the FDIC's announcements are. `hexOnly` writes the text as hex
// glyph codes instead, which the adapter's reader does not decode: it must record the PDF as a link only.
export function makePdf(lines, { hexOnly = false } = {}) {
  const show = (l) => (hexOnly ? `<${Buffer.from(l, 'latin1').toString('hex')}> Tj` : `(${l.replace(/([()\\])/g, '\\$1')}) Tj`);
  const content = ['BT', '/F1 12 Tf', ...lines.map((l, i) => `1 0 0 1 72 ${720 - i * 14} Tm ${show(l)}`), 'ET'].join('\n');
  const z = deflateSync(Buffer.from(content, 'latin1'));
  const head = ['%PDF-1.6\n', '1 0 obj\n<</Type/Catalog/Pages 2 0 R>>\nendobj\n', '2 0 obj\n<</Type/Pages/Kids[3 0 R]/Count 1>>\nendobj\n',
    '3 0 obj\n<</Type/Page/Parent 2 0 R/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>\nendobj\n', `4 0 obj\n<</Filter/FlateDecode/Length ${z.length}>>\nstream\n`].join('');
  return Buffer.concat([Buffer.from(head, 'latin1'), z, Buffer.from('\nendstream\nendobj\n5 0 obj\n<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>\nendobj\ntrailer\n<</Root 1 0 R>>\n%%EOF\n', 'latin1')]);
}
export const PDF_LINES = (id = 'EXB2-26', upb = '41,512,300') => ['SEALED BID SALE ANNOUNCEMENT', 'OCTOBER 14, 2026', 'FEDERAL DEPOSIT INSURANCE CORPORATION AS RECEIVER FOR', 'EXAMPLE PRAIRIE BANK, SAMPLETON, ARIZONA (EPB)', id,
  'The Federal Deposit Insurance Corporation (FDIC), in its capacity as Receiver for Example Prairie Bank, Sampleton, Arizona (EPB), is',
  `conducting a competitive sealed-bid sale comprised of 312 loans having an unpaid principal balance (UPB) of $${upb}.`, `Please contact ${PERSON} ${PHONE} ${EMAIL}`];

const BASE = 'https://www.fdic.gov';
export function fakeFdicWww({ robots = ROBOTS, listing = LISTING(), pages = {}, pdfs = {}, status = {} } = {}) {
  const calls = [];
  const files = {
    '/robots.txt': robots,
    '/asset-sales/loan-sales': listing,
    '/asset-sales/events/exb-26-sale-announcement': SALE_PAGE({ id: 'EXB-26', loans: '1,204', upb: '22,000,000', dates: 'September 8&ndash;October 13, 2026, All Day' }),
    '/asset-sales/events/exb2-26-sale-announcement': SALE_PAGE(),
    '/asset-sales/exb-26-loan-sale-announcement.pdf': makePdf(PDF_LINES('EXB-26', '22,000,000').map((l) => l.replace('312 loans', '1,204 loans')).map((l, i) => (i === 1 ? 'AUGUST 27, 2026' : l))),
    '/asset-sales/exb2-26-loan-sale-announcement.pdf': makePdf(PDF_LINES()),
    ...pages, ...pdfs,
  };
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    calls.push({ url, path: u.pathname, ua: init.headers?.['user-agent'] });
    if (u.origin !== BASE) return new Response('not found', { status: 404 });
    if (status[u.pathname]) return new Response('error', { status: status[u.pathname] });
    if (!(u.pathname in files) || files[u.pathname] === null) return new Response('not found', { status: 404 });
    const body = files[u.pathname];
    return new Response(body, { status: 200, headers: { 'content-type': Buffer.isBuffer(body) ? 'application/pdf' : 'text/html' } });
  };
  return { fetchImpl, calls };
}
