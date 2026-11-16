// A fake www.fdic.gov (the monthly enforcement releases) and a fake browser session (the order lists on orders.fdic.gov) for the FDIC
// orders adapter's tests (PRD next-five E18-S2). Invented banks and people only. The release pages copy the real layout seen on
// 2026-11-16; the order tables are GUESSES in two layouts, since the rendered page could not be seen from the development environment.

export const PEOPLE = ['Pat Person', 'Robin Sample', 'Casey Nobody', 'Jamie Doe'];
const REL = (y, slug) => `/news/press-releases/${y}/${slug}`;
export const RELEASES = {
  [REL(2026, 'fdic-publishes-september-enforcement-actions')]: 'https://orders.fdic.gov/s/press-release-orders?prYear=2026&amp;prDate=30&amp;prMonth=10',
  [REL(2026, 'fdic-publishes-july-enforcement-actions')]: 'https://orders.fdic.gov/s/press-release-orders?prYear=2026&amp;prDate=28&amp;prMonth=8',
  [REL(2025, 'fdic-makes-public-february-enforcement-actions')]: 'https://orders.fdic.gov/s/press-release-orders?prYear=2025&amp;prDate=28&amp;prMonth=3',
};
const yearPage = (y) => `<html><body><main>${Object.keys(RELEASES).filter((p) => p.includes(`/${y}/`)).map((p) => `<a href="${p}" rel="bookmark">x</a>`).join('\n')}
<a href="/news/press-releases/${y}/fdic-board-meeting">other</a></main></body></html>`;
const releasePage = (href) => `<html><body><main><h1>FDIC Publishes Enforcement Actions</h1><p>The FDIC issued 17 orders.</p>
<p><a href="${href}">Enforcement Decisions and Orders</a></p><p><a href="mailto:MediaRequests@fdic.gov">Media</a></p></main></body></html>`;

export function fakeWww({ robots = 'User-agent: *\nCrawl-delay: 1\nDisallow: /search/', pages = {} } = {}) {
  const calls = [];
  const files = { '/robots.txt': robots, '/news/press-releases/2026': yearPage(2026), '/news/press-releases/2025': yearPage(2025), ...Object.fromEntries(Object.entries(RELEASES).map(([p, h]) => [p, releasePage(h)])), ...pages };
  const fetchImpl = async (url) => {
    const u = new URL(url);
    calls.push(u.pathname);
    if (u.origin !== 'https://www.fdic.gov' || !(u.pathname in files) || files[u.pathname] === null) return new Response('not found', { status: 404 });
    return new Response(files[u.pathname], { status: 200, headers: { 'content-type': 'text/html' } });
  };
  return { fetchImpl, calls };
}

const row = (cells, links = []) => ({ cells, links });
const DOC = (id) => [{ text: 'View', href: `https://orders.fdic.gov/sfc/servlet.shepherd/document/download/069${id}` }];
// Layout A: separate institution, city, state, respondent, type, date and docket columns.
export const CAPTURE_SEPT = () => ({ url: 'https://orders.fdic.gov/s/press-release-orders?prYear=2026&prDate=30&prMonth=10', pages: 2, tables: [
  { headers: ['Institution Name', 'City', 'State', 'Respondent', 'Order Type', 'Issue Date', 'Docket Number'], rows: [
    row(['Example Desert Bank', 'Mesa Example', 'AZ', 'Example Desert Bank', 'Consent Order', '09/14/2026', 'FDIC-26-0101b'], DOC('A1')),
    row(['Example Desert Bank', 'Mesa Example', 'AZ', 'Pat Person', 'Order of Prohibition from Further Participation', '09/14/2026', 'FDIC-26-0102e']),
    row(['Example Coast Bank', 'Harbor', 'CA', 'Example Coast Bank', 'Order Terminating Consent Order', '09/20/2026', 'FDIC-26-0103b'], DOC('A3')),
    row(['Example Valley Bank', 'Sampleton', 'TX', 'Robin Sample', 'Order to Pay Civil Money Penalty', '09/22/2026', 'FDIC-26-0104k']),
    row(['Gone Example Bank', 'Sampleton', 'TX', 'Gone Example Bank', 'Order of Termination of Insurance', '09/25/2026', 'FDIC-26-0105t']),
    row(['Faraway Example Bank', 'Somewhere', 'OH', 'Faraway Example Bank', 'Order to Cease and Desist', '09/02/2026', 'FDIC-26-0110b']),
    row(['', '', '', '', '', '', '']),
  ] },
  { headers: ['Hearing', 'Date'], rows: [row(['None scheduled', ''])] },
] });
// Layout B: a name, a "City, State" location, an action and a written-out date; no docket.
export const CAPTURE_JULY = () => ({ url: 'https://orders.fdic.gov/s/press-release-orders?prYear=2026&prDate=28&prMonth=8', pages: 1, tables: [
  { headers: ['Name', 'Location', 'Action', 'Date'], rows: [
    row(['Example Coast Bank', 'Harbor, California', 'Consent Order', 'July 10, 2026'], DOC('B1')),
    row(['Casey Nobody', 'Sampleton, TX', 'Section 19 Order', 'July 12, 2026']),
    row(['Jamie Doe', 'Harbor, CA', 'Order to Pay', 'July 13, 2026']),
    row(['Example Valley Bancorp, Inc.', 'Sampleton, Texas', 'Written Agreement', 'July 20, 2026']),
  ] },
] });

export function fakeSession({ captures = { 'prMonth=10': CAPTURE_SEPT, 'prMonth=8': CAPTURE_JULY }, robots = 'User-agent: *\nAllow: /\nDisallow: */secur/forgotpassword.jsp?*' } = {}) {
  const calls = [];
  return {
    calls,
    async text(url) { calls.push(['text', url]); return { status: 200, text: robots }; },
    async capture(url) {
      calls.push(['capture', url]);
      const k = Object.keys(captures).find((x) => url.includes(x));
      if (!k) throw new Error(`no capture for ${url}`);
      return captures[k]();
    },
    close: async () => {},
  };
}
