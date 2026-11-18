// A fake publictrustee.example for the invented Example County source (src/sources/counties/example.mjs). Every name, address, number
// and amount here is invented. Two weeks of its list: the second changes one document, adds two and drops one. The bank list the lender
// names are matched against has two banks of one name in two states, so a name can be ambiguous.
import { EXAMPLE_HOST } from '../src/sources/counties/example.mjs';

export const INSTITUTIONS = Object.freeze({
  9001: { CERT: '9001', NAME: 'Example Bank, National Association', CITY: 'Sampleton', STALP: 'CO' },
  9002: { CERT: '9002', NAME: 'Sample Community Bank', CITY: 'Anytown', STALP: 'CO' },
  9003: { CERT: '9003', NAME: 'First Example Bank', CITY: 'Sampleton', STALP: 'TX' },
  9004: { CERT: '9004', NAME: 'First Example Bank', CITY: 'Otherville', STALP: 'CO' },
  9005: { CERT: '9005', NAME: 'Example Mountain Bank', CITY: 'Peakview', STALP: 'CO' },
});

// The borrowers and properties: none may ever reach a bank's file, a log, the review list or a model's input.
export const BORROWERS = ['Sample Holdings LLC', 'Sample Retail Partners LLC', 'Sample Storage LLC', 'Sample Hotel Group LLC', 'Sample Apartments LLC', 'Sample Office Owner LLC', 'Sample Land Trust', 'Sample Plaza LLC'];
export const ADDRESSES = ['100 Example Way', '200 Sample Street', '300 Invented Road', '400 Example Avenue', '500 Sample Boulevard', '600 Example Court', '700 Placeholder Lane'];

const D = (o) => ({ filed: '', sale: '', attorney: '', address: '', apn: '', use: '', original: '', outstanding: '', deedOfTrust: '', ...o });
export const WEEK1 = () => [
  D({ number: '2026-004101', type: 'Notice of Election and Demand', recorded: '11/10/2026', sale: '03/04/2027', beneficiary: 'Example Bank, N.A.', holder: 'Example Bank, N.A.', attorney: 'Sample & Example LLP',
    grantor: 'Sample Holdings LLC', address: '100 Example Way, Anytown, CO 80000', apn: '0000-00-0-00-001', use: 'Commercial: office', original: '$4,200,000.00', outstanding: '$3,875,000.00', deedOfTrust: '2019-0456789 (06/03/2019)' }),
  D({ number: '2026-004102', type: 'Notice of Election and Demand', recorded: '11/12/2026', beneficiary: 'Mortgage Electronic Registration Systems, Inc., as nominee for Sample Community Bank', holder: 'Sample Community Bank, its successors and assigns',
    attorney: 'Example Law Group, P.C.', grantor: 'Sample Retail Partners LLC', address: '200 Sample Street, Anytown, CO 80000', apn: '0000-00-0-00-002', use: 'Commercial: retail', original: '$2,150,000.00', outstanding: '$2,010,500.00', deedOfTrust: '2021-0012345 (02/11/2021)' }),
  D({ number: '2026-004103', type: 'Rule 120 Notice', recorded: '11/12/2026', filed: '11/13/2026', beneficiary: 'First Example Bank', holder: 'First Example Bank', attorney: 'Sample & Example LLP',
    grantor: 'Sample Storage LLC', address: '300 Invented Road, Anytown, CO 80000', use: 'Commercial: industrial' }),
  D({ number: '2026-004104', type: 'Assignment of Deed of Trust', recorded: '11/09/2026', beneficiary: 'Example Mountain Bank', holder: 'Sample Capital Fund LP', grantor: 'Sample Hotel Group LLC',
    address: '400 Example Avenue, Anytown, CO 80000', use: 'Commercial: hotel', deedOfTrust: '2020-0099887 (09/14/2020)' }),
  D({ number: '2026-004105', type: 'Notice of Sale', recorded: '11/11/2026', sale: '12/09/2026', beneficiary: 'Example Bank, N.A.', holder: 'Sample Capital Fund LP', attorney: 'Example Law Group, P.C.',
    grantor: 'Sample Office Owner LLC', address: '500 Sample Boulevard, Anytown, CO 80000', original: '$7,800,000.00', outstanding: '$7,215,000.00', deedOfTrust: '2018-0333222 (04/27/2018)' }),
  D({ number: '2026-004106', type: 'Release of Deed of Trust', recorded: '11/13/2026', beneficiary: 'Example Bank, N.A.', holder: '', grantor: 'Sample Apartments LLC', address: '600 Example Court, Anytown, CO 80000',
    use: 'Residential: multifamily (5+)', deedOfTrust: '2016-0777111 (08/02/2016)' }),
  D({ number: '2026-004107', type: 'Certificate of Redemption', recorded: '11/13/2026', beneficiary: 'Example Bank, N.A.', holder: 'Example Bank, N.A.', grantor: 'Sample Land Trust' }),
  D({ number: '2026-004108', type: 'Notice of Election and Demand', recorded: '11/13/2026', beneficiary: 'Mortgage Electronic Registration Systems, Inc.', holder: 'Example Loan Servicing LLC, as servicer',
    attorney: 'Sample & Example LLP', grantor: 'Sample Land Trust', address: '700 Placeholder Lane, Anytown, CO 80000', use: 'Vacant land', original: '$950,000.00', outstanding: '$912,000.00' }),
  D({ number: '2026-004109', type: 'Lis Pendens', recorded: '11/13/2026', filed: '11/12/2026', beneficiary: 'Sample Bancorp', holder: 'Sample Bancorp', grantor: 'Sample Plaza LLC', address: '200 Sample Street, Anytown, CO 80000' }),
];
// The next week: 4101's balance and sale date were amended, 4102 to 4105 and 4108 are unchanged, 4106 to 4107 and 4109 dropped off the
// list, and two documents are new.
export const WEEK2 = () => [
  { ...WEEK1()[0], sale: '03/11/2027', outstanding: '$3,850,000.00' },
  ...WEEK1().slice(1, 5),
  WEEK1()[7],
  D({ number: '2026-004120', type: 'Notice of Election and Demand', recorded: '11/17/2026', sale: '03/18/2027', beneficiary: 'Example Bank, N.A.', holder: 'Example Bank, N.A.', attorney: 'Sample & Example LLP',
    grantor: 'Sample Plaza LLC', address: '200 Sample Street, Anytown, CO 80000', use: 'Commercial: mixed use', original: '$3,100,000.00', outstanding: '$2,940,000.00', deedOfTrust: '2022-0055443 (05/19/2022)' }),
  D({ number: '2026-004121', type: 'Deed of Trust', recorded: '11/18/2026', beneficiary: 'Example Mountain Bank', holder: '', grantor: 'Sample Holdings LLC', address: '100 Example Way, Anytown, CO 80000', original: '$1,500,000.00' }),
];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const HEADERS = ['Reception no.', 'Document', 'Recorded', 'Filed', 'Sale date', 'Original beneficiary', 'Current holder', 'Holder\'s attorney', 'Grantor', 'Property address', 'APN', 'Assessor use', 'Original principal', 'Outstanding principal', 'Deed of trust'];
const FIELDS = ['number', 'type', 'recorded', 'filed', 'sale', 'beneficiary', 'holder', 'attorney', 'grantor', 'address', 'apn', 'use', 'original', 'outstanding', 'deedOfTrust'];
export function listHtml(rows, { headers = HEADERS } = {}) {
  const head = `<tr>${headers.map((h) => `<th scope="col">${esc(h)}</th>`).join('')}</tr>`;
  const body = rows.map((r) => `<tr>${FIELDS.filter((_, i) => headers.includes(HEADERS[i])).map((f) => (f === 'number' ? `<td><a href="/documents/${esc(r.number)}">${esc(r.number)}</a></td>` : `<td>${esc(r[f] ?? '')}</td>`)).join('')}</tr>`).join('\n');
  return `<!doctype html><html><head><title>Recorded foreclosure documents</title></head><body><h1>Example County Public Trustee</h1>
<p>Questions: call 555-0142 or write to trustee@publictrustee.example.</p>
<table id="recorded"><thead>${head}</thead><tbody>
${body}
</tbody></table></body></html>`;
}

export const ROBOTS = 'User-agent: *\nDisallow: /admin/\n';

// fetchImpl for runNoticeSource and verifyNoticeSource. `rows` is the list served; `robots` the robots.txt body (null: a 404).
export function fakeCounty({ rows = WEEK1(), robots = ROBOTS, html = null, status = {} } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    calls.push({ url, path: u.pathname, ua: init.headers?.['user-agent'] ?? null });
    if (u.host !== EXAMPLE_HOST) return new Response('not found', { status: 404 });
    if (status[u.pathname]) return new Response('error', { status: status[u.pathname] });
    if (u.pathname === '/robots.txt') return robots === null ? new Response('not found', { status: 404 }) : new Response(robots, { status: 200 });
    if (u.pathname === '/foreclosures/recorded') return new Response(html ?? listHtml(rows), { status: 200, headers: { 'content-type': 'text/html' } });
    return new Response('not found', { status: 404 });
  };
  return { fetchImpl, calls };
}
