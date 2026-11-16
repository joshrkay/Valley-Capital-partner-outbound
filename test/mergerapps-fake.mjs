// A fake H.2 (the Federal Reserve's weekly "Actions of the Board ... Applications and Reports Received") for the merger-applications
// adapter's tests (PRD next-five E18-S3). Invented banks and people only. The pages copy the real layout seen on 2026-11-16: an index
// linking each week's folder; per district, a "Filings received during the week ending ..." table (Filer | Filing Type | Filing
// Proposal | Newspaper | Federal Register); and the delegated-actions page's "<Org> -- <what>" entries with "Approved: <date>".
import { DISTRICTS } from '../src/sources/mergerapps.mjs';

export const PEOPLE = ['Pat Person', 'Robin Sample'];
export const WEEKS = ['20261024', '20261031', '20261107'];
const LONG = (w) => { const d = new Date(`${w.slice(0, 4)}-${w.slice(4, 6)}-${w.slice(6)}T00:00:00Z`); return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }); };

const row = (filer, type, proposal, news = 'Not&nbsp;available', fed = '11/27/2026', i = 1) => `<tr><th class="stub" id="xr${i}" headers="xa1">${filer}</th><td class="column__text" headers="xa2 xr${i}">${type}</td><td class="column__text data" headers="xa3 xr${i}">${proposal}</td><td class="data" headers="xa4 xb1 xr${i}">${news}</td><td class="data" headers="xa4 xb2 xr${i}">${fed}</td></tr>`;
export const districtPage = (w, district, rows = []) => `<!doctype html><html><head><title>Federal Reserve Board - H.2 - ${district} - Week ending ${LONG(w)}</title></head><body>
<nav>menu</nav><div class="col-xs-12"><h3>District: Federal Reserve Bank of ${district} <a href="H2.pdf">PDF</a></h3><h4>Filings received during the week ending ${LONG(w)}</h4>
<div class="data-table"><table class="pubtables" id="x"><thead><tr><th class="colhead" id="xa1" rowspan="2">Filer</th><th id="xa2" rowspan="2" class="colhead">Filing Type</th><th rowspan="2" id="xa3" class="colhead">Filing Proposal</th><th id="xa4" class="colhead" colspan="2">End of Comment Period</th></tr><tr><th class="colhead" id="xb1">Newspaper</th><th id="xb2" class="colhead">Federal Register</th></tr></thead>
<tbody>${rows.join('')}</tbody></table></div><h5>Availability of CRA Public Evaluations</h5><table class="pubtables"><tr><td>EXAMPLE ST BK, SAMPLETON, TEXAS</td></tr></table>
<p>Last Update: ${LONG(w)}</p></div></body></html>`;

const HOLDINGS = row('EXAMPLE HOLDINGS, INC.', '* 3A5', 'Example Holdings, Inc., Houston, Texas, to acquire Example Valley Bancshares, Inc., and thereby indirectly acquire The Example Valley Bank, both of Sampleton, Texas.', 'Not&nbsp;available', '11/27/2026', 1);
const CONTROL = row('EXAMPLE VALLEY BANCSHARES', 'Change in Bank Control', 'Notice by Pat Person, Sampleton, Texas, to acquire 10 percent or more of the shares of Example Valley Bancshares, Inc., and join Robin Sample as a group acting in concert.', 'Not&nbsp;available', '11/20/2026', 2);
const BRANCH = row('EXAMPLE DESERT BANK', '* Branch (Domestic)', 'Example Desert Bank, Mesa Example, Arizona, to establish a branch at 1 Example Way, Mesa Example AZ 85000', '11/14/2026', 'Not&nbsp;applicable', 3);
const DESERT = row('EXAMPLE DESERT BANK', '* 18C', 'Example Desert Bank, Mesa Example, Arizona, to merge with Example Canyon Bank, Canyon Example, Arizona, and thereby establish branches at the locations of Example Canyon Bank.', 'Not&nbsp;available', 'Not&nbsp;applicable', 4);
const COAST = row('EXAMPLE COAST BANCORP', '* 3A3* 3A5Election (Domestic)', 'Example Coast Bancorp, Harbor, California, to acquire up to 100 percent of the voting shares of Example Coast Bank, Harbor, California.', '12/01/2026', '12/04/2026', 5);

export const PAGES = () => ({
  '20261024': { dallas: [HOLDINGS, CONTROL, BRANCH] },
  '20261031': { dallas: [HOLDINGS, DESERT] },
  '20261107': { sanfrancisco: [COAST] },
});
export const DELACTIONS = (w) => (w === '20261107' ? `<html><body><h3>Bank Holding Companies</h3><h4>Dallas</h4>
<p>Example Holdings, Inc., Houston, Texas -- to acquire Example Valley Bancshares, Inc., and thereby indirectly acquire The Example Valley Bank, both of Sampleton, Texas.</p><p>Approved: November 4, 2026</p>
<h4>San Francisco</h4><p>Example Coast Bancorp, Harbor, California -- withdrawal of its application to acquire Example Coast Bank, Harbor, California.</p><p>Withdrawn: November 6, 2026</p>
<p>Example Holdings, Inc., Houston, Texas -- relief from certain commitments entered into by Pat Person.</p><p>Granted: November 5, 2026</p></body></html>` : '<html><body><h3>Bank Holding Companies</h3></body></html>');

export function fakeH2({ weeks = WEEKS, pages = PAGES(), missing = [], status = {} } = {}) {
  const calls = [];
  const files = { '/releases/h2/': `<html><body>${weeks.map((w, i) => `<a href="${i % 2 ? w : `${w}/default.htm`}">${w}</a>`).join(' ')}<a href="20050702/h2.pdf">old</a></body></html>` };
  for (const w of weeks) {
    for (const d of DISTRICTS) if (!missing.includes(`${w}/${d}`)) files[`/releases/h2/${w}/${d}.htm`] = districtPage(w, d, pages[w]?.[d] ?? []);
    files[`/releases/h2/${w}/delactions.htm`] = DELACTIONS(w);
    files[`/releases/h2/${w}/default.htm`] = '<html><body><h4>Actions taken during the week</h4></body></html>';
  }
  const fetchImpl = async (url) => {
    const u = new URL(url);
    calls.push(u.pathname);
    if (status[u.pathname]) return new Response('error', { status: status[u.pathname] });
    if (u.origin !== 'https://www.federalreserve.gov' || !(u.pathname in files)) return new Response('not found', { status: 404 });
    return new Response(files[u.pathname], { status: 200, headers: { 'content-type': 'text/html' } });
  };
  return { fetchImpl, calls, files };
}
