// A fake caldwellcounty.texas.gov for the Caldwell reader (src/sources/counties/caldwell.mjs). Every name, address, number and amount
// here is INVENTED; no line comes from a real notice. The notices copy only the two layouts' structure and the kinds of OCR error the
// recon describes (docs/county-watchers-recon.md): slashes read as 1 or l, a misspelled month, periods for commas, a garbled label, a
// clerk's stamp beside the text. Each is served as a real PDF whose text layer is invisible (render mode 3), as a scan's OCR layer is,
// so the tests read it with pdftotext exactly as the live reader does.
import { CALDWELL_HOST } from '../src/sources/counties/caldwell.mjs';

// The invented people and firms: none may reach a bank's file, an event, the review list, a log, the run's state or a job result.
export const PEOPLE = ['Pat Example', 'Jordan Example', 'Casey Sampleclerk', 'Riley Placeholder', 'Morgan Sample'];
export const BORROWER_FIRMS = ['Sample Retail Partners LLC', 'Sample Hotel Group LLC'];
export const ADDRESSES = ['123 EXAMPLE LANE', '400 SAMPLE ROAD'];
export const INSTITUTIONS = Object.freeze({
  9001: { CERT: '9001', NAME: 'Example Bank, National Association', CITY: 'Sampleton', STALP: 'CO' },
  9002: { CERT: '9002', NAME: 'Sample Community Bank', CITY: 'Anytown', STALP: 'TX' },
  9005: { CERT: '9005', NAME: 'Example Mountain Bank', CITY: 'Peakview', STALP: 'CO' },
});

// The servicer's form: one recital. The sale date's slashes come out as 1s ("121112026"), a slash as an l ("3/14l2023"), a zero as
// an O ("3/2O/2023"), and the "and" before the servicer as "ald".
export const SERVICER_NOTICE = `Sample Default Services, LLC                                                  FILED 0ct l9 2O26 ;Lk,
P.O. Box 0000                                                                         Casey Sampleclerk
Anytown, Texas 75000                                                                  C0UNTY CLERK
TS#: 26-00001
                         NOTICE OF SUBSTITUTE TRUSTEE'S SALE
WHEREAS, on 3/14l2023, Pat Example and Jordan Example, husband and wife, as
Grantor/Borrower, executed and delivered that certain Deed of Trust, in favor of Sample Title Trustee, as Trustee, Mortgage
Electronic Registration Systems, Inc., as beneficiary, as nominee for Example Bank, N.A., as Beneficiary which deed
of trust secures the payment of that certain promissory note of even date therewith in the original amount of $412,500.00,
payable to the order of Mortgage Electronic Registration Systems, Inc., as beneficiary, as nominee for Example Bank, N.A.,
which Deed of Trust is Recorded on 3/2O/2023 as Volume 2023-004321, Book, Page, in Caldwell County, Texas, Deed of Trust
covers all of the real property described therein, to-wit:
Lot 7, Block B, Of Sample Meadows Subdivision, A Subdivision in Caldwell County, Texas.
Commonly known as: 123 EXAMPLE LANE ANYTOWN, TX 78644
WHEREAS, the Trustee named in the Deed of Trust having been removed, the legal holder of the indebtedness described
in the Deed of Trust appointed Riley Placeholder, Sample Posting and Publishing, LLC, Example Auctions, Inc., or any one of
them, as Substitute Trustee (each being referred to as the "Substitute Trustee"), upon the contingency authorized by the Deed of Trust: and
WHEREAS, defaults have occurred in the covenants of the Deed of Trust, and the indebtedness secured by the Deed of Trust is now
wholly due, ald Sample Loan Servicing, LLC whose address is 1 Example Plaza, Anytown, TX 75000, is acting as the mortgage
servicer for Example Bank, N.A., which is the mortgagee of the Note and Deed of Trust and the legal holder of such indebtedness.
NOW, THEREFORE, NOTICE IS HEREBY GIVEN, that on 121112026 at 1:00 PM, or no later than three (3) hours after such time,
in Caldwell County, Texas, the Substitute Trustee will sell the Property at public venue to the highest bidder for cash. The
sale will take place at the area designated by the Commissioner's Court for sales of real property under a power of sale
conferred by a deed of trust or other contract lien as follows: OUTSIDE THE MAIN ENTRANCE OF THE EXAMPLE COUNTY JUSTICE
CENTER, 100 SAMPLE STREET, ANYTOWN, TEXAS 78644
NOTICE IS FURTHER GIVEN that the Property will be sold without any representations or warranties whatsoever.
WITNESS, my hand this 10/2l/2026                                WITNESS, my hand this
      By: Morgan Sample, Trustee Sale Specialist                    By: Substitute Trustee(s)
`;

// The attorney's form: labelled blocks. A misspelled month ("Febuary"), periods for the amount's commas, a garbled LENDER label, a
// label split over three lines, and the clerk's stamp (with a deputy clerk's name) in the right-hand column.
export const ATTORNEY_NOTICE = `NOTICE OF CONFIDENTIALITY RIGHTS: IF YOU ARE A NATURAL PERSON, YOU MAY REMOVE OR STRIKE ANY OR ALL OF THE
FOLLOWING INFORMATION FROM ANY INSTRUMENT THAT TRANSFERS AN INTEREST IN REAL PROPERTY BEFORE IT IS FILED FOR RECORD.
                     NOTICE OF SUBSTITUTE TRUSTEE'S SALE
DATE:                October 9,2026
NOTE: Real Estate Lien Note described as follows:
       Date:         Febuary 3,2021
       Maker:        Sample Retail Partners LLC
                     A Texas Limited Liability Company
       Payee:        Sample Community Bank
       Original
       Principal
       Amount:       $1.250.000.00
DEED OF TRUST: Deed of Trust described as follows:                       FILED  OCT l2 2O26
       Date:         Febuary 3,2021                                       DEPUTY
       Grantor:      Sample Retail Partners LLC                           Casey Sampleclerk
                     A Texas Limited Liability Company                    COUNTY CLERK
       Trustee:      Example Trustee
       Beneficiary:  Sample Community Bank
       Recorded:     Document Number 2021-001234, in the Official Public Records of
                     Caldwell County, Texas.
I,F],NDER:   Sample Community Bank
BORROWER:    Sample Retail Partners LLC,
             A Texas Limited Liability Company
PROPERTY:    The real property described as follows:
             Being 2.50 acres out of the Sample Survey, Abstract No. 0, in Caldwell County, Texas.
SUBSTITUTE
TRUSTEE:     Riley Placeholder of Sample & Example, PLLC, as Substitute Trustee
DATE AND TIME OF SUBSTITUTE TRUSTEE'S SALE OF PROPERTY:
November 3,2026, the first Tuesday of the month, to commence at 10:00 A.M., or within three (3) hours after that time.
PLACE OF SUBSTITUTE TRUSTEE'S SALE OF PROPERTY:
The sale will take place at the area designated by the Commissioner's Court for sales of real property under a power of sale
conferred by a deed of trust or other contract lien as follows:
THE MAIN ENTRANCE OF THE EXAMPLE COUNTY JUDICIAL CENTER, 100 SAMPLE STREET, ANYTOWN, TEXAS 78644, OR IF THE
PRECEDING AREA IS NO LONGER THE DESIGNATED AREA, AT THE AREA MOST RECENTLY DESIGNATED BY THE COUNTY COMMISSIONER'S COURT.
EXECUTED as of October 9, 2026.
`;

// A notice the OCR ruined: no lender can be read, so it is held, never stored.
export const RUINED_NOTICE = `N0TICE 0F SUBST1TUTE TRUSTEE'S SALE
WHEREAS, on 4/?l/2O22, ]{e{ $ffi}ilil, as Grantor/Borrower, executed and delivered that certain Deed of Trust, in favor of
ffi$il ill, as Trustee, }{ffi[ $\${]] ffiil|, as Beneficiary which deed of trust secures the original amount of $1 50,0O0.00
NOTICE IS HEREBY GIVEN, that on 1l?/2O26 at l:00 PM the property will be sold.
`;

// ---- A PDF with an invisible text layer ----------------------------------------------------------------------------------------------
// Courier 7 pt, so each character is 4.2 pt wide (a 130-character line fits the page) and a line's spacing survives pdftotext -layout.
// 80 lines a page.
const esc = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
export function textPdf(text) {
  const lines = String(text).split('\n');
  const pages = [];
  for (let i = 0; i < lines.length; i += 80) pages.push(lines.slice(i, i + 80));
  const objects = [];
  const add = (body) => { objects.push(body); return objects.length; };
  const catalog = add(null), pagesObj = add(null), font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>');
  const kids = [];
  for (const pg of pages) {
    const ops = ['BT', '3 Tr', '/F1 7 Tf'];
    pg.forEach((line, n) => {
      // Each run of text at its own column, so wide gaps stay gaps.
      for (const m of line.matchAll(/\S+(?: \S+)*/g)) ops.push(`1 0 0 1 ${(20 + m.index * 4.2).toFixed(1)} ${(770 - n * 9).toFixed(1)} Tm (${esc(m[0])}) Tj`);
    });
    ops.push('ET');
    const content = ops.join('\n');
    const stream = add(`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${stream} 0 R >>`));
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objects[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => { offsets.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

// ---- The list ---------------------------------------------------------------------------------------------------------------------
// Each item: its file under /files/public-documents/foreclosures/ (named, as the county names them, for the sale date and the debtor),
// its listed sale date (null: the undated section), and the notice it serves.
const NOTICES = { servicer: SERVICER_NOTICE, attorney: ATTORNEY_NOTICE, ruined: RUINED_NOTICE };
export const WEEK1 = () => [
  { file: '2026/12-1-26 Pat Example.pdf', sale: '2026-12-01', notice: 'servicer' },
  { file: '2026/11-3-26 Sample Retail Partners.pdf', sale: '2026-11-03', notice: 'attorney' },
  { file: '2026/11-3-26 Ruined Example.pdf', sale: '2026-11-03', notice: 'ruined' },
  { file: '2026/10-6-26 Morgan Sample.jpg', sale: '2026-10-06', notice: null },
  { file: '2026/7-7-26 Old Example.pdf', sale: '2026-07-07', notice: 'servicer' },
  { file: 'Sample Hotel Group foreclosure.pdf', sale: null, notice: 'attorney' },
];
// The next week: one new notice, posted for the January sale.
export const WEEK2 = () => [{ file: '2027/1-5-27 Jordan Example.pdf', sale: '2027-01-05', notice: 'attorney' }, ...WEEK1()];

const h = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export function listHtml(items = WEEK1(), { itemClass = 'doc-item', withTimes = true } = {}) {
  const groups = new Map();
  for (const it of items) { const k = it.sale ? it.sale.slice(0, 7) : 'undated'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(it); }
  const keys = [...groups.keys()].sort((a, b) => (a === 'undated' ? 1 : b === 'undated' ? -1 : a < b ? 1 : -1));
  const li = (it) => `<li class="${itemClass}"><a class="doc-link" href="/files/public-documents/foreclosures/${h(it.file)}"><span class="doc-link__label">${h(it.file.split('/').pop().replace(/\.\w+$/, ''))}</span> <span class="doc-link__meta">(PDF, 1.0 MB)</span></a>${withTimes && it.sale ? `<span class="fc-sale-date">Sale date: <time datetime="${it.sale}">${it.sale}</time></span>` : ''}</li>`;
  const sections = keys.map((k) => `<section class="fc-month" aria-labelledby="fc-m-${k}"><h3 id="fc-m-${k}" class="has-rule">${k === 'undated' ? 'Notices without a listed sale date' : `${MONTHS[Number(k.slice(5)) - 1]} ${k.slice(0, 4)}`}</h3><ul class="doc-list fc-list" role="list">${groups.get(k).map(li).join('')}</ul></section>`);
  return `<!doctype html><html><head><title>Foreclosures | Caldwell County</title></head><body><main><h2>Notices of Trustee's Sale</h2>
<p class="doc-count">${items.length} notices.</p>${sections.join('\n')}<p>Questions: call 555-0142.</p></main></body></html>`;
}

export const ROBOTS = 'User-agent: *\nDisallow: /admin\nDisallow: /api\nDisallow: /auth\n';
export const CHALLENGE = '<!doctype html><html><head><title>Just a moment...</title></head><body><div id="cf-chl-widget">Checking your browser</div></body></html>';

// fetchImpl for the reader. `items` is the list served; `etag` makes the list answer a matching If-None-Match with 304; `status` maps
// a path (or "notices") to an HTTP status; `noticeBody` replaces every notice's body (a challenge page, say).
export function fakeCaldwell({ items = WEEK1(), robots = ROBOTS, html = null, etag = null, status = {}, noticeBody = null } = {}) {
  const calls = [];
  const byPath = new Map(items.map((it) => [`/files/public-documents/foreclosures/${it.file}`, it]));
  const pdfs = new Map();
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const path = decodeURIComponent(u.pathname);
    const ifNoneMatch = init.headers?.['if-none-match'] ?? null;
    calls.push({ path: path.startsWith('/files/') ? 'notice' : path, file: path.startsWith('/files/') ? path : null, ua: init.headers?.['user-agent'] ?? null, ifNoneMatch });
    if (u.host !== CALDWELL_HOST) return new Response('not found', { status: 404 });
    const st = status[path] ?? (path.startsWith('/files/') ? status.notices : undefined);
    if (st) return new Response('refused', { status: st });
    if (path === '/robots.txt') return robots === null ? new Response('not found', { status: 404 }) : new Response(robots, { status: 200, headers: { 'content-type': 'text/plain' } });
    if (path === '/foreclosures') {
      if (etag && ifNoneMatch === etag) return new Response(null, { status: 304, headers: { etag } });
      return new Response(html ?? listHtml(items), { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', ...(etag ? { etag } : {}) } });
    }
    const it = byPath.get(path);
    if (!it) return new Response('not found', { status: 404 });
    if (noticeBody) return new Response(noticeBody, { status: 200, headers: { 'content-type': 'text/html' } });
    if (!it.notice) return new Response(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70]), { status: 200, headers: { 'content-type': 'image/jpeg' } });
    if (!pdfs.has(it.notice)) pdfs.set(it.notice, textPdf(NOTICES[it.notice]));
    return new Response(pdfs.get(it.notice), { status: 200, headers: { 'content-type': 'application/pdf', etag: `"f-${it.notice}"` } });
  };
  return { fetchImpl, calls };
}
