# County watchers: what each source publishes, and whether we may read it

Recon of November 18, 2026, for the weekly watchers in `docs/county-data-build-vs-buy.md` section 3.4. It decides which watchers get built. Each source has an entry in `sources.json` with the same dated checks.

**How it was read.** Everything below is **Checked**, meaning fetched live on 2026-11-18, unless it is marked otherwise. There were two rounds:

- **Round 1**, 03:09–03:23 UTC: 67 requests over 14 hosts, five of them failed connections to Hays.
- **Round 2**, 03:43–03:49 UTC, after five more hosts were allowed (www.tccsearch.org, www.hayscountytx.com, gts.co.jefferson.co.us, apps.douglasco.gov and www.broomfield.org): 26 requests.

The rules were the same in both rounds:

- robots.txt was read first on each host, and its rules were applied by the fetcher.
- Every request sent the User-Agent in `config.json` ("Valley Capital Partners" and the firm's contact).
- Requests to one host were at least 21 seconds apart, or longer where robots.txt asked.
- Only GET requests were sent: no form was submitted, nothing was logged into, and no challenge was attempted.
- Redirects were not followed automatically.
- Each host was dropped at its first block or challenge.

Five samples were downloaded: two Caldwell notices, one Douglas pre-sale list, and one Jefferson NED report and pre-sale list. They are kept outside the repository, and nothing in this file comes from them except their structure.

No prospect data is in this file. Examples are invented.

## 1. Summary

| County | Source | Format | Fields (L = in the list, D = only on the linked notice) | Updates, history | Verdict |
|---|---|---|---|---|---|
| **Jefferson, CO: NED report** | gts.co.jefferson.co.us/report?t=7 (GTS) | HTML index (GET), one text-based PDF a week | L: everything below, with no linked documents. Current lender, lender on the deed of trust, attorney and file number, grantor and current owner, address, original note amount, current amount, loan type (commercial types included), NED date, deed of trust recording and reception numbers, original sale date. A parcel number sometimes (3 of 11). | Weekly (one recording day); current month weekly, monthly archive from January 2025 | **Allowed** (b) |
| **Jefferson, CO: pre-sale list** | gts.co.jefferson.co.us/report?t=6 | HTML index, one text-based PDF (Crystal Reports) | L: grantor, legal description (parcel in 8 of 11), address, current beneficiary, publication dates, lender's bid, deficiency, total indebtedness, sale date. No attorney, no recording reference. | Weekly, Tuesday, for the Thursday sale; current week only | **Allowed** (b) |
| **Douglas, CO: pre-sale list** | apps.douglasco.gov/gts/report?t=1 (GTS) | HTML index, text-based PDFs (Crystal Reports): Monday pre-sale and Tuesday update | L: the same template and labels as Jefferson's pre-sale list (parcel in 2 of 5) | Weekly, Monday after 1 pm, for the Wednesday sale; current week only | **Allowed** (b); a principal records accepting its terms |
| **Caldwell, TX** | caldwellcounty.texas.gov/foreclosures | HTML list; one scanned PDF per notice, with an OCR text layer | L: sale date, borrower (in the label). D: lender (beneficiary, mortgagee, servicer), trustee and substitute trustees, borrower, address or legal description, original principal, recording reference, sale date, time and place, notice date. No APN. | As filed, at least 21 days before each first-Tuesday sale; 12–21 a month in 2026; back to 2020 | **Allowed** (b), with conditions |
| Travis, TX | countyclerk.traviscountytx.gov/departments/recording/meetings/, which links to www.tccsearch.org | Cloudflare challenge on the search app | Not seen | — | **Not allowed**: challenge page |
| Hays, TX | hayscountytx.com, www.hayscountytx.com | Both refuse connections from this environment | Not seen | — | **Unclear**: read from another network |
| Denver, CO | www.denvergov.org/foreclosuresearch/ (GTS) | ASP.NET search: POST, session, a reCAPTCHA field; the reports page is empty | Not seen (search filters only) | — | **Unclear**: possible CAPTCHA; ask the Public Trustee |
| Adams, CO | apps.adcogov.org/PTForeclosureSearch/reports | Cloudflare challenge on every request | Not seen | Weekly sales | **Not allowed**: challenge page |
| Arapahoe, CO | www.arapahoeco.gov | Not read | Not seen | — | **Not allowed**: robots.txt disallows all |
| Broomfield, CO | foreclosure.broomfield.org/centralrecords/ForeclosureSearch, linked from www.broomfield.org | Weekly reports inside the search, not reached | Not seen | Weekly, Monday after 2 pm | List **unclear** (host blocked); EagleWeb on egov.broomfield.org **not allowed** (login) |
| Colorado courts, Rule 120 | www.coloradojudicial.gov | Not read | Not seen | — | **Not allowed now**: the site banned this address |

**Four watchers are cleared:**

- **Jefferson's NED report.** It is the best source found: an early signal, machine-readable, with the lender, the attorney, two amounts and a loan-type field.
- **Jefferson's and Douglas's pre-sale lists.** They share one parser.
- **Caldwell.**

Two more wait on a read: Hays from another network, and Broomfield once foreclosure.broomfield.org is allowed. Denver, Adams, Arapahoe and Travis need the county's permission or a feed, and the Rule 120 notices need counsel.

## 2. Texas

The statutory notice (Prop. Code 51.002) is filed with the clerk at least 21 days before the first-Tuesday sale, and the county must post it online "without charge or registration" (build-vs-buy 3.4, Seen). So every Texas list is a public list by law: channel (b).

### Caldwell — allowed

- **Page:** `https://caldwellcounty.texas.gov/foreclosures`. It holds all notices, newest sale month first, "organized by sale month". It has a year filter, `?year=YYYY` (2020 to 2026), and a GET name search, `?q=`. 610 notices were listed on November 18.
- **robots.txt** (200, 117 bytes): `User-agent: *`, `Disallow: /admin`, `Disallow: /api`, `Disallow: /auth`. The list and `/files/` are allowed.
- **Terms:** `https://caldwellcounty.texas.gov/disclaimer`, effective August 21, 2026, "under review by the Caldwell County District Attorney's office". It reads: "You may read, print and download material from this site for personal, non-commercial use, and for any use permitted by the Texas Public Information Act." Among what it forbids: "use automated means to place an unreasonable load on the site, or to circumvent its rate limits; harvest personal information from the site for solicitation". Automated access itself is not forbidden.
- **Format.**
  - **The list** is one `li.doc-item` per notice. Each holds:
    - `a.doc-link`, linking to `/files/public-documents/foreclosures/{folder}/{file}.pdf`. The folder is a year (`2023`, `2024`, `2026`) or `migrated-2026-06`.
    - `span.doc-link__label`: the clerk's free-text label, a sale date and the debtor's name, in mixed formats such as "12-1-26 Example" or "10.06.26 Example".
    - `span.doc-link__meta`: "(PDF, 1.0 MB)".
    - `span.fc-sale-date > time[datetime="YYYY-MM-DD"]`.

    Month headings ("December 2026") group the items.
  - **The notices** are 2–4 letter pages. Each page is a 200 dpi grayscale JPEG scan with an invisible OCR text layer (`pdftotext` returns about 7–8 KB per notice). The OCR is readable but noisy: slashes and digits in dates are misread, and the clerk's filed stamp comes out garbled. Files carry an ETag and are served through Cloudflare, which challenged nothing.
- **Fields, in the two layouts seen:**
  - **A servicer's form.** A header with the servicer's or trustee firm's address and a TS number. Then one long recital, holding:
    - the deed of trust date and the grantor or borrower;
    - the original trustee;
    - the beneficiary, often "Mortgage Electronic Registration Systems, Inc., as nominee for Example Mortgage LLC";
    - "the original amount of $NNN,NNN.00" and the recording reference ("Volume 2024-NNNNNN");
    - a legal description and "Commonly known as: 123 Example Dr";
    - the substitute trustees;
    - the mortgage servicer and the mortgagee, who is the current holder;
    - the sale date, time and place.

    It ends with "WITNESS, my hand this <date>" and the signer's firm.
  - **An attorney's form** (a private or commercial lender). Labelled blocks: `DATE:`; `NOTE:` with Date, Maker, Payee and Original Principal Amount; `DEED OF TRUST:` with Date, Grantor, Trustee, Beneficiary and `Recorded: Document Number`; `LENDER:`; `BORROWER:` (for example "Example Holdings, LLC, a Texas limited liability company"); then `PROPERTY:`, often a metes-and-bounds tract with no street address.
  - **No APN** appears in either layout, so a parcel join goes through the address or the legal description.
- **Updates and history:** notices arrive as they are filed, through the 3–5 weeks before each first Tuesday. By sale month, 2026 ran 12–21 a month from May to October. The list goes back to 2020. **The list's sale dates are unreliable before 2025.** January holds 20–53 notices in each year from 2020 to 2024, against 1–12 in other months, which looks like a default date. Take the sale date from the notice.
- **Verdict: allowed, by channel (b).** Conditions, recorded in `sources.json`:
  1. Read the list once a week (twice if a principal wants more warning), plus only the new PDFs.
  2. Never use a borrower's name, or any individual named in a notice, for outreach. The signal is the enforcing lender, an institution, which keeps us clear of "harvest personal information ... for solicitation".
  3. Re-read the disclaimer monthly while the District Attorney's review is open.

  A principal records that this lender-level use is "any use permitted by the Texas Public Information Act" (Gov. Code 552.222: the office may not ask the purpose). **Value:** the county is small and mostly residential, but the attorney's form names the lender and the original principal in labelled fields.

### Travis — not allowed

- **Page:** `https://countyclerk.traviscountytx.gov/departments/recording/meetings/`, under "Foreclosure Notices". The clerk "posts notices of real property ... where a power of sale has been conferred". The "SEARCH FORECLOSURE NOTICES" button opens `https://www.tccsearch.org/`.
- **robots.txt:**
  - The clerk's site (200): `User-agent: *`, `Disallow: /wp-admin/`, `Allow: /wp-admin/admin-ajax.php`.
  - www.tccsearch.org (200, Cloudflare-managed): `User-agent: *`, `Content-Signal: search=yes,ai-train=no,use=reference`, `Allow: /`. Named AI crawlers get `Disallow: /`.
- **Terms:** the clerk's site has no terms or disclaimer page; none is in its sitemap or footer. The search app's terms sit behind its challenge.
- **Format:** `https://www.tccsearch.org/` answered **HTTP 403 with a Cloudflare managed challenge** ("Just a moment...", `cf-mitigated: challenge`). Two requests were sent, robots.txt and then the root, and none after.
- **Verdict: not allowed.** The rule never passes a challenge by software. Channel (a) remains: the clerk's "Daily Real Property Information on CD" at $10 a CD (build-vs-buy 3.1). A principal can also ask the clerk for the notices by email, or for an allowance for the firm's User-Agent. The notices use the same statutory forms as Caldwell's, so the Caldwell parser carries over whatever the channel.

### Hays — unclear

- Both `hayscountytx.com:443` and, once it was allowed, `www.hayscountytx.com:443` refused every connection: seven attempts in all, between 03:09 and 03:48 UTC. The proxy reported "host allowed, but the gateway could not connect to it". The county may be firewalling this environment's network. Nothing was read.
- **Verdict: unclear.** To do: read the site from another network (a principal's machine or the worker), find the clerk's foreclosure-notice page, then read and date its robots.txt and terms. If the county blocks the worker's network too, that is a block, and the watcher does not run.

## 3. Colorado

The notice of election and demand (NED) must state the outstanding principal balance and the holder's attorney (C.R.S. 38-38-101; build-vs-buy 3.1, Seen). So a public trustee's list or report usually carries the lender, the attorney and an amount. Warning before sale is 110–125 days.

### GTS: one reports layout for Denver, Jefferson and Douglas

Denver (since May 1, 2026), Jefferson (version 2.2.6.0) and Douglas run the same foreclosure software, GTS, and its reports work the same way in all three:

- **The search** is an ASP.NET page behind an "Accept Terms" POST button, with a hidden `g-recaptcha-response` field. **A watcher never uses it.**
- **The reports page** (`{base}/reports`; the old `AllReports.aspx` redirects there) shows a disclaimer and "Available Report Types", each a GET link `{base}/report?t={n}`. **The type numbers differ by county**: Jefferson's pre-sale list is `t=6`, Douglas's is `t=1`. So find the links by their text.
- **Each report index** is plain HTML: a month heading (`<h2>November, 2026</h2>`), then `ol > li`, each with `span` (the posted date, M/D/YYYY), `a[href="Report_Files/{file}.pdf"]`, and `span` (a description).
  - File names are typed by staff and vary: "NED 11-12-2026.pdf", "11-18-26 PreSale.pdf", "UPDATED Sale Report 11-18-2026.pdf".
  - One name repeats every week: Jefferson's "Preliminary bid report-Tuesday.pdf". So a run keys on ETag or Last-Modified (both are sent) and on the dates inside the report.
- **The pre-sale list is one template in both counties** ("<County> County Pre Sale Foreclosure List"), so **one parser serves Jefferson's and Douglas's pre-sale lists**, and Denver's if it ever publishes one.
  - Douglas's PDF comes straight from Crystal Reports; Jefferson's is the same report printed through Acrobat Distiller. Both have a text layer, and `pdftotext -layout` reads the labels cleanly.
  - Amounts are written "$1,234,567.89" or "$ 0.00".
- **The NED report is Jefferson's alone** and needs its own parser. Douglas publishes no NED report, and Denver's reports page is empty.

### Jefferson — allowed (NED report and pre-sale list)

- **Pages:**
  - `https://www.jeffco.us/2343/Search-Foreclosures` links the reports at `http://gts.co.jefferson.co.us/AllReports.aspx`. Over https, that redirects `AllReports.aspx`, then `/AllReports`, then `/reports`.
  - The reports page offers four types: "Pre Sale List" (`/report?t=6`), "Election and Demand Notices Filed" (`/report?t=7`), "Statistical & Historical Reports" (`/report?t=11`) and "Archived Election and Demand Notices Filed" (`/report?t=14`).
- **robots.txt:**
  - `https://gts.co.jefferson.co.us/robots.txt` answers **404**, so nothing is restricted.
  - www.jeffco.us (200): `User-agent: *` with `Disallow: /Search`, `/RSS.aspx`, `/rss.aspx`, `/publiclogin.aspx` and others, and `Crawl-delay: 10`. Its Alert Center RSS feed is disallowed, so it is not a trigger.
- **Terms:** disclaimers of accuracy only.
  - The GTS front page: "we can make no guarantees or warranties as to the accuracy or the timeliness of the data".
  - The reports page: "THE PROPERTIES THAT APPEAR ON THE WEEKLY SALE/AUCTION LIST ... ARE TIMELY AND VALID ONLY AS OF THE DATE AND TIME THEY ARE POSTED".
  - Each NED report: "Jefferson County Public Trustee makes no representation or warranties about the accuracy or adequacy of these reports."
  - The county's site disclaimer (`https://www.jeffco.us/2845/Privacy-and-Site-Disclaimer`) claims copyright in its content, "data compilations" included. Nothing anywhere addresses automated access.
- **The NED report** (`/report?t=7`):
  - **Posting:** one PDF a week, for the NEDs recorded that day ("NED'S recorded on November 12, 2026"; the November 5 and 12 files were posted). It is 6 pages and 11 records on November 12.
  - **Header:** "Notices of Election and Demand Filed in Jefferson County / From <date> Through <date>".
  - **Each record starts** with `Foreclosure Number: J26NNNNN`, then labelled lines:
    - `NED Date:` and `Reception #:`;
    - `Original Sale Date:`;
    - `Deed of Trust Date:`, `Recording Date:` and `Reception #:`, then `Re-Recording Date` and `Re-Recorded #:`;
    - `Legal:` (multi-line; it holds an `APN #:` in 3 of 11);
    - `Address:`;
    - `Original Note Amt:`, `LoanType:` and `Interest Rate:`;
    - `Current Amount:`, `As Of:` and `Interest Type:`;
    - `Current Lender (Beneficiary):` (which can wrap, e.g. "Example Bank, N.A., not in its individual capacity, but solely as trustee for Example Trust 20XX-1");
    - `Current Owner:`;
    - `Grantee (Lender On Deed of Trust):` (often MERS as nominee for the originator);
    - `Grantor (Borrower On Deed of Trust)`;
    - `Publication:` with its first and last dates;
    - `Attorney for Beneficiary:` (e.g. "Example Law Firm, LLP");
    - `Attorney File Number:`, `Phone:` and `Fax:`.
  - **Loan types seen:** Conventional or Conv, FHA, VA, **Commercial**, **BPL Commercial** and **business**, three of the 11. That is a ready-made commercial filter.
  - **History:** the archive (`/report?t=14`) holds one compiled PDF a month, January 2025 to October 2026 (22 files).
- **The pre-sale list** (`/report?t=6`): one PDF each Tuesday for that Thursday's online sale ("Preliminary Bid List for 11/19/2026"; 10 pages, 11 records). It is the GTS pre-sale template described above, with a `PARCEL:` number in 8 of 11 legal descriptions.
- **Verdict: allowed, by channel (b),** for both reports. Conditions:
  1. Read only the reports index and the PDFs it links, by GET, 21 seconds apart. Never touch the search or its "Accept Terms" form.
  2. Store the extracted fields, not the county's PDFs beyond a run's cache, given the data-compilation copyright claim (counsel, with D-B9).
  3. Borrower and owner names stay principal context.

### Douglas — allowed (pre-sale list)

- **Pages:**
  - `https://www.douglasco.gov/public-trustee/foreclosure-sale-process/` sends users to `https://apps.douglasco.gov/gts/`, then "Foreclosure Reports" and "Current Pre Sale List".
  - The reports page (`https://apps.douglasco.gov/gts/reports`) offers one type: "Current Pre Sale List", `/gts/report?t=1`.
  - On November 18 that index listed two PDFs: the Monday "Pre-Sale Report for Wednesday 11/18/26" (posted 11/16) and the Tuesday "Updated Sale Report" (posted 11/17).
- **robots.txt:**
  - `https://apps.douglasco.gov/robots.txt` answers **404** (Apache), so nothing is restricted.
  - The county's main site, www.douglasco.gov, asks `Crawl-delay: 60`. It does not govern the apps host, but its weekly two or three requests can keep to it anyway.
  - The apps host is served through Cloudflare, which challenged nothing.
- **Terms:** the reports page repeats the Public Trustee's disclaimer and asks for acceptance: "The User agrees that data from the TRUSTEE website will be used for only lawful and ethical purposes and will not be used to communicate false or incorrect information regarding foreclosure. The User shall not attempt to hack, reverse engineer, break into, or compromise the TRUSTEE website. If you accept these terms, please click the button below." The report links follow. Automated reading is not forbidden.
- **Format and fields:** the GTS pre-sale template, made directly by Crystal Reports with embedded fonts. The Monday file was 3 pages with 5 records.
  - **Header:** "Douglas County Pre Sale Foreclosure List", the run date and time, and `Sale Date:`.
  - **Each record:** `Foreclosure: #:`, `The Grantor:`, `Legal Description:` (an `APN:` or `PARCEL ID:` inside it in 2 of 5), `Street Address:`, `Current Beneficiary Name:`, `First Publication:` and `Last Publication:` (and sometimes `Amended First/Last Publication:`), `Publication Newspaper:`, `Lender's Bid Amount:`, `Deficiency:` and `Total Indebtedness:`.
  - **Absent:** no attorney, no recording reference, no original principal.
  - **Signal:** it comes in the sale week, 110 days or more after the NED.
- **Verdict: allowed, by channel (b),** once a principal records that the firm accepts the reports page's terms: opening a report is taken as accepting them. A principal can also ask the Public Trustee to publish a new-NED report, as Jefferson does.

### Denver — unclear

- **Pages:**
  - The Public Trustee's page: `https://www.denvergov.org/Government/Agencies-Departments-Offices/Agencies-Departments-Offices-Directory/Denver-Clerk-and-Recorder/Recording-Division/Denver-Public-Trustee`.
  - The search: `https://www.denvergov.org/foreclosuresearch/`.
  - The GTS reports page: `https://www.denvergov.org/foreclosuresearch/reports`. Its "Available Report Types" list is **empty**.
  - The rest of the Public Trustee's page links auctions (a third-party auction site), statistics and forms, not lists.
- **robots.txt** (200; 1.24 MB, 7,719 lines): one group, `User-agent: *`, with 7,716 `Disallow` lines for named content pages. None of them matches `/foreclosuresearch/`. There is no Crawl-delay.
- **Terms:** `https://www.denvergov.org/Terms-of-Use`. Disclaimers only: "neither the city nor any of its employees assumes any legal liability or responsibility for the accuracy, completeness or usefulness of any information disclosed". Nothing on automated access or copying.
- **Format:**
  - The first request sets cookies through an ASP.NET cookie check (`?AspxAutoDetectCookieSupport=1`).
  - The search is a WebForms page. Results come only by POST, with `__VIEWSTATE`, `__EVENTVALIDATION` and the session cookies.
  - The form carries a hidden `g-recaptcha-response` field. No reCAPTCHA script was seen in the page, so whether it is enforced is unknown.
  - The filters are foreclosure number, borrower or grantor, current owner, ZIP, street, subdivision, status (about 40 values, "New Foreclosure" and "NED Recorded" among them), NED recording dates, sold dates and scheduled sale dates. The result columns were not seen.
- **Verdict: unclear.** robots.txt and the terms allow it. But a watcher would have to POST to a form built for a CAPTCHA, and the rule never solves one. **A principal asks the Public Trustee** to post a weekly NED report on its empty GTS reports page. Jefferson's NED parser would then serve it, if the template matches (inferred). Failing that, they ask whether automated searching is acceptable and whether the reCAPTCHA is enforced. A bulk subscription under C.R.S. 30-10-101(2.5) stays the alternative.

### Adams — not allowed

- **Pages:**
  - The Public Trustee division: `https://adamscountyco.gov/our-county/elected-officials/treasurer-public-trustee/public-trustee-division/`.
  - Its "Foreclosure Reports" link: `http://apps.adcogov.org/PTForeclosureSearch/reports`.
  - Its "Foreclosure Listings/Search": `https://adamscountyco.gov/service/search-foreclosures/`, which redirects (302) to `https://apps.adcogov.org/PTForeclosureSearch/`.
  - Sales are online every Wednesday.
- **robots.txt:**
  - apps.adcogov.org (200, Cloudflare-managed): `User-agent: *`, `Content-Signal: search=yes,ai-train=no,use=reference`, `Allow: /`. Named AI crawlers (ClaudeBot, GPTBot, CCBot and others) get `Disallow: /`.
  - adamscountyco.gov: `Disallow: /wp-admin/`, `Crawl-delay: 10`.
- **Terms:** `https://adamscountyco.gov/privacy-policy/` has disclaimers only ("any use of such information is undertaken at the visitor's sole risk"). The search app's own terms could not be read.
- **Format:** every request to apps.adcogov.org (the root, and `/PTForeclosureSearch/reports`) answered **HTTP 403 with a Cloudflare managed challenge**: "Just a moment...", `cf-mitigated: challenge`.
- **Verdict: not allowed.** The rule never passes a challenge by software. A principal asks the Public Trustee for the weekly New Foreclosure Report by email, a bulk subscription, or an allowance for the firm's User-Agent. If the reports ever open, note the Content-Signal: it reserves AI training, which no watcher does.

### Arapahoe — not allowed

- **robots.txt:** `https://www.arapahoeco.gov/robots.txt` answers 302 to `https://files.arapahoeco.gov/robots.txt`. That file allows Googlebot, Bingbot, FacebookBot, LinkedInBot/1.0 and Twitterbot, then `User-agent: *` and `Disallow: /`. RFC 9309 says to follow the redirect, so the file governs www. **No page was read after it.**
- **Verdict: not allowed.** Robots.txt disallows the site for us. The Public Trustee search's own address is unknown. A principal asks for a weekly list by email, a bulk subscription, or written permission.

### Broomfield — list unclear, EagleWeb not allowed

- **The Public Trustee's pages on www.broomfield.org** (`/255/Public-Trustee`, `/805/Foreclosure-Information`, `/807/Foreclosure-Sale`) link the "Foreclosure Property Search" at `http://foreclosure.broomfield.org/centralrecords/ForeclosureSearch`, over plain http. **That host is not reachable from this environment.**
  - Bid information is "in the Foreclosure Reports section of the Foreclosure Property Search under weekly reports" after 2 p.m. each Monday.
  - Sales are Wednesdays at 10 a.m.
  - Combined notices run for five weeks in the Sunday Broomfield Enterprise.
  - No list is posted on www.broomfield.org itself.
- **robots.txt of www.broomfield.org** (200): the CivicPlus default, identical to www.jeffco.us's. `User-agent: *` with `Disallow: /Search`, `/RSS.aspx` and others, and `Crawl-delay: 10`.
- **Terms:** the county's privacy policy (`https://www.broomfield.org/653/Internet-Privacy-Policy`) says nothing on automated access. The search's terms were not read.
- **egov.broomfield.org:**
  - There is no robots.txt (404).
  - The root and the paths `/PTForeclosureSearch/`, `/publictrustee/` and `/gts/` answer 404.
  - **EagleWeb** (`/recorder/web/`) is the recorder's index of documents recorded since November 15, 2001. It opens on a disclaimer ("If you choose not to accept the conditions stated above, please exit this search application"). Its "I Acknowledge" button POSTs a guest login (`loginPOST.jsp`, `guest=true`). **A login, even a guest one, counts as not allowed** unless the terms expressly allow automated use, and these do not mention it.
- **Verdicts:** the weekly reports are **unclear**: allow **foreclosure.broomfield.org**, then read and date its robots.txt and terms, and see whether the reports open by GET. EagleWeb is **not allowed**.

### Colorado courts, Rule 120 notices — not allowed now

- **robots.txt** of www.coloradojudicial.gov (200, Drupal): `User-agent: *`, with `Disallow: /dockets`, `/search/`, `/sealed-case` and `/user/login`. There is no Crawl-delay.
- **What happened:** the first two requests (robots.txt, then a 404 page) were answered normally, about a minute apart. The third (`/trial-courts-district`) answered **HTTP 403, "... has been banned up to Wed, 18 Nov 2026 20:32:05 +0000"**, naming this environment's shared egress address. One request already queued got the same answer, and nothing was sent after. Whether the ban was caused by us or by others on the shared address is unknown.
- **Verdict: not allowed now.** A block is never worked around. A principal asks the Judicial Branch whether automated reading of posted Rule 120 notices is acceptable. Counsel reads Chief Justice Directive 05-01 (D-B9). The page is then read from an address the site has not banned, never by retrying from this one.

## 4. Recommended build order

The ranking puts sources that are allowed, machine-readable, and carry a lender plus an amount or APN first.

1. **Jefferson's NED report: build first.**
   - **Run:** one GET a week of `https://gts.co.jefferson.co.us/report?t=7`.
   - **Read:** each `li > a[href^="Report_Files/"]` posted since the last run. Fetch only new PDFs (`https://gts.co.jefferson.co.us/Report_Files/{file}.pdf`, spaces URL-encoded), 21 seconds apart, keyed on ETag.
   - **Split:** split the `pdftotext -layout` text on `Foreclosure Number:`, then read the labelled lines.
   - **What it gives:** the current lender, the lender on the deed of trust, the attorney, the original and current amounts, the recording and reception numbers, the NED date, the original sale date, a commercial loan-type flag, and sometimes the APN.
   - **Why first:** it is the earliest Colorado signal (110–125 days before sale), text-based, and the richest record found. A one-time backfill from the monthly archive (`/report?t=14`, back to January 2025) gives history.
2. **The GTS pre-sale parser: Jefferson and Douglas together.**
   - **URLs:** `https://gts.co.jefferson.co.us/report?t=6` (Tuesday) and `https://apps.douglasco.gov/gts/report?t=1` (Monday after 1 pm, updated Tuesday), each linking `{base}/Report_Files/{file}.pdf`.
   - **Split:** on `Foreclosure: #:`; the labels are listed in section 3.
   - **What it gives:** the current beneficiary, total indebtedness, lender's bid, deficiency, and often the parcel number.
   - **Why:** one parser for two counties. For Douglas it is the only list; for Jefferson it confirms which NED cases reach a sale.
   - **Before it runs:** a principal records accepting Douglas's reports terms.
3. **Caldwell.**
   - **Run:** one GET a week of `https://caldwellcounty.texas.gov/foreclosures`. Key each `li.doc-item` on its `href` and read its `time[datetime]`.
   - **Fetch:** only new PDFs, 21 seconds apart. Parse the OCR text layer: the labelled blocks (`LENDER:`, `BORROWER:`, `Original Principal Amount:`, `Recorded:`) for the attorney's form, and the recital for the servicer's form. Send anything uncertain to the review queue.
   - **Why third:** it is allowed and carries the lender and the original principal, but the notices are scans with noisy OCR, and the county is small. Its parser is the template for any Texas notice channel later: Travis by CD or by permission, and Hays.

Then:

- **Broomfield**: allow foreclosure.broomfield.org and read its weekly reports.
- **Hays**: read from another network.
- **Denver**: ask for a GTS NED report, which Jefferson's parser may serve.
- **Travis**: a channel (a) daily CD, or the clerk's permission.
- **Adams and Arapahoe**: only by the county's permission or a feed.
- **Rule 120**: after counsel.

## 5. For a principal

**Hosts to allow:** foreclosure.broomfield.org (Broomfield's search and weekly reports; linked over http). Hays needs a read from another network, not a host entry: both of its hosts refuse this environment's connections.

**To confirm:**
1. **Douglas:** record that the firm accepts the reports page's terms (lawful and ethical use only; a release of liability). Opening a report is taken as accepting them.
2. **Jefferson:** counsel on the county's copyright claim in "data compilations", with D-B9. The watcher stores extracted fields only.
3. **Caldwell:** that lender-level use is "any use permitted by the Texas Public Information Act", and that the no-solicitation-of-individuals condition holds. The disclaimer is under the District Attorney's review, so recheck it monthly.
4. **Travis:** buy the clerk's daily CD (channel (a)), or ask the clerk for the notices or an allowance past the Cloudflare challenge on www.tccsearch.org.
5. **Denver:** ask the Public Trustee for a weekly NED report on its GTS reports page, or for its word on automated searching and the reCAPTCHA.
6. **Adams:** ask for the weekly report by email, or an allowance past the Cloudflare challenge.
7. **Arapahoe:** ask for a feed or written permission, since robots.txt disallows everything.
8. **Rule 120:** counsel on CJD 05-01, and an approach to the Judicial Branch. Do not retry from this environment, whose address the site banned.
