# County watchers: what each source publishes, and whether we may read it

Recon of November 18, 2026, for the weekly watchers in `docs/county-data-build-vs-buy.md` section 3.4. It decides which watchers get built. Each source has an entry in `sources.json` with the same dated checks.

**How it was read.** Everything below is **Checked**, meaning fetched live on 2026-11-18 between 03:09 and 03:23 UTC, unless it is marked otherwise:

- robots.txt was read first on each host, and its rules were applied by the fetcher.
- Every request sent the User-Agent in `config.json` ("Valley Capital Partners" and the firm's contact).
- Requests to one host were at least 21 seconds apart, or 60 seconds where robots.txt asked for it. That came to 67 requests over 14 hosts, five of them failed connections to Hays.
- Only GET requests were sent: no form was submitted, nothing was logged into, and no challenge was attempted.
- Redirects were not followed automatically.
- Two sample notices were downloaded, both from Caldwell. They are kept outside the repository, and nothing in this file comes from them except their structure.

No prospect data is in this file. Examples are invented.

## 1. Summary

| County | Source | Format | Fields (L = in the list, D = only on the linked notice) | Updates, history | Verdict |
|---|---|---|---|---|---|
| **Caldwell, TX** | caldwellcounty.texas.gov/foreclosures | HTML list; one scanned PDF per notice, with an OCR text layer | L: sale date, borrower (in the label). D: lender (beneficiary, mortgagee, servicer), trustee and substitute trustees, borrower, address or legal description, original principal, recording reference, sale date, time and place, notice date. No APN. | As filed, at least 21 days before each first-Tuesday sale; 12–21 a month in 2026; back to 2020 | **Allowed** (b), with conditions |
| Travis, TX | countyclerk.traviscountytx.gov/departments/recording/meetings/, which links to www.tccsearch.org | A records search app, not reached | Not seen | — | **Unclear**: www.tccsearch.org is blocked here |
| Hays, TX | hayscountytx.com | Not reached | Not seen | — | **Unclear**: the host refused connections; add www.hayscountytx.com |
| Denver, CO | www.denvergov.org/foreclosuresearch/ (GTS) | ASP.NET search: POST, session, a reCAPTCHA field; the reports page is empty | Not seen (search filters only) | — | **Unclear**: possible CAPTCHA; ask the Public Trustee |
| Adams, CO | apps.adcogov.org/PTForeclosureSearch/reports | Cloudflare challenge on every request | Not seen | Weekly sales | **Not allowed**: challenge page |
| Jefferson, CO | gts.co.jefferson.co.us/AllReports.aspx (GTS) | Reports page, not reached | Not seen | Weekly: a Tuesday pre-sale report | **Unclear**: host blocked here |
| Douglas, CO | apps.douglasco.gov/gts/ (GTS) | "Current Pre Sale List" report, not reached | Not seen | Weekly: Monday after 1 pm | **Unclear**: host blocked here |
| Arapahoe, CO | www.arapahoeco.gov | Not read | Not seen | — | **Not allowed**: robots.txt disallows all |
| Broomfield, CO | Public Trustee list not found on egov.broomfield.org; EagleWeb at /recorder/web/ | EagleWeb: a guest login by POST | Not seen | — | List **unclear** (host); EagleWeb **not allowed** (login) |
| Colorado courts, Rule 120 | www.coloradojudicial.gov | Not read | Not seen | — | **Not allowed now**: the site banned this address |

**One watcher is cleared today: Caldwell.** Four more wait only on a host being allowed and a dated read: Jefferson, Douglas, Travis and Hays. Three need a principal to ask the county: Denver, Adams and Arapahoe. The Rule 120 notices need counsel and a principal.

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

### Travis — unclear

- **Page:** `https://countyclerk.traviscountytx.gov/departments/recording/meetings/`, under "Foreclosure Notices". The clerk "posts notices of real property ... where a power of sale has been conferred". The "SEARCH FORECLOSURE NOTICES" button opens `https://www.tccsearch.org/`, which is **not reachable from this environment**.
- **robots.txt** of the clerk's site (200): `User-agent: *`, `Disallow: /wp-admin/`, `Allow: /wp-admin/admin-ajax.php`. The robots.txt of www.tccsearch.org was not read.
- **Terms:** the clerk's site has no terms or disclaimer page; none is in its sitemap or footer. The search app's terms were not read.
- **Format and fields:** not seen. The records search holds the index from the mid 1980s and redacted images from December 2005 (the clerk's page). Notices follow the same statutory forms as Caldwell's.
- **Verdict: unclear.** The notices sit in a search app (c) on a blocked host. To do: allow **www.tccsearch.org**, then read and date its robots.txt and terms, and check for a login, a CAPTCHA or a per-page fee.

### Hays — unclear

- `hayscountytx.com:443` refused every connection: five attempts between 03:09 and 03:18 UTC, which the proxy reported as "host allowed, but the gateway could not connect to it". The county's site probably answers on **www.hayscountytx.com**, which is not allowed here. Nothing was read.
- **Verdict: unclear.** To do: allow www.hayscountytx.com, find the clerk's foreclosure-notice page, then read and date its robots.txt and terms.

## 3. Colorado

The notice of election and demand (NED) must state the outstanding principal balance and the holder's attorney (C.R.S. 38-38-101; build-vs-buy 3.1, Seen). So a public trustee's list or report usually carries the lender, the attorney and an amount. Warning before sale is 110–125 days.

**Three counties run the same software.** Denver moved to GTS on May 1, 2026; Jefferson (gts.co.jefferson.co.us) and Douglas (apps.douglasco.gov/gts/) use it too. Denver's copy, version 2.2.2.0, answers `/AllReports.aspx` with a 301 to `/AllReports`, then a 302 to `/reports`: a page headed "Available Report Types" and "Search Reports". Douglas's page tells users to open "Foreclosure Reports" and choose "Current Pre Sale List" under "Available Report Types". **So one GTS reports parser could serve all three** (inferred), once their hosts are readable and their reports are seen.

### Denver — unclear

- **Pages:**
  - The Public Trustee's page: `https://www.denvergov.org/Government/Agencies-Departments-Offices/Agencies-Departments-Offices-Directory/Denver-Clerk-and-Recorder/Recording-Division/Denver-Public-Trustee`.
  - The search: `https://www.denvergov.org/foreclosuresearch/`.
  - The reports page: `https://www.denvergov.org/foreclosuresearch/reports`. Its "Available Report Types" list is **empty**.
  - The rest of the Public Trustee's page links auctions (a third-party auction site), statistics and forms, not lists.
- **robots.txt** (200; 1.24 MB, 7,719 lines): one group, `User-agent: *`, with 7,716 `Disallow` lines for named content pages. None of them matches `/foreclosuresearch/`. There is no Crawl-delay.
- **Terms:** `https://www.denvergov.org/Terms-of-Use`. Disclaimers only: "neither the city nor any of its employees assumes any legal liability or responsibility for the accuracy, completeness or usefulness of any information disclosed". Nothing on automated access or copying.
- **Format:**
  - The first request sets cookies through an ASP.NET cookie check (`?AspxAutoDetectCookieSupport=1`).
  - The search is a WebForms page. Results come only by POST, with `__VIEWSTATE`, `__EVENTVALIDATION` and the session cookies.
  - The form carries a hidden `g-recaptcha-response` field. No reCAPTCHA script was seen in the page, so whether it is enforced is unknown.
  - The filters are foreclosure number, borrower or grantor, current owner, ZIP, street, subdivision, status (about 40 values, "New Foreclosure" and "NED Recorded" among them), NED recording dates, sold dates and scheduled sale dates. The result columns were not seen.
- **Verdict: unclear.** robots.txt and the terms allow it. But a watcher would have to POST to a form built for a CAPTCHA, and the rule never solves one. **A principal asks the Public Trustee** to turn on a weekly new-foreclosure (NED) report on the empty GTS reports page, as Jefferson and Douglas do. Failing that, they ask whether automated searching is acceptable and whether the reCAPTCHA is enforced. A bulk subscription under C.R.S. 30-10-101(2.5) stays the alternative.

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

### Jefferson — unclear

- **Pages:**
  - `https://www.jeffco.us/2343/Search-Foreclosures` links the "Foreclosure Property Search" (`http://gts.co.jefferson.co.us/`) and the "Foreclosure Reports" (`http://gts.co.jefferson.co.us/AllReports.aspx`), both over plain http. That host is **not reachable from this environment**.
  - The county's Alert Center (`https://www.jeffco.us/AlertCenter.aspx?AID=2166`, November 17, 2026) announced a "Preliminary Bid Report-Tuesday" listing the properties for that week's online sale, uploaded to the reports page.
- **robots.txt** of www.jeffco.us (200): `User-agent: *` with `Disallow: /Search`, `/RSS.aspx`, `/rss.aspx`, `/publiclogin.aspx` and others, and `Crawl-delay: 10`. The Alert Center's RSS feed is disallowed, so it is not a trigger. The GTS host's robots.txt was not read.
- **Terms:** `https://www.jeffco.us/2845/Privacy-and-Site-Disclaimer` says nothing on automated access. It claims copyright in "All content included on this site, such as text, graphics, logos, button icons, images, audio clips, digital downloads, data compilations, and software". The Public Trustee's own disclaimer covers accuracy only.
- **Verdict: unclear** (host blocked). To do:
  1. Allow **gts.co.jefferson.co.us** (it is linked over http; check whether https answers too).
  2. Read and date its robots.txt and terms.
  3. List its report types: the Tuesday pre-sale report, and any new-NED report.

  Counsel looks at the data-compilation copyright claim with D-B9.

### Douglas — unclear

- **Pages:** `https://www.douglasco.gov/public-trustee/foreclosure-sale-process/`. Its "Search Now" goes to `https://apps.douglasco.gov/gts/`, which is **not reachable from this environment**. The pre-sale list "can be accessed on the Foreclosure Property Search", "posted after 1:00pm on the Monday before the sale", under "Foreclosure Reports" and then "Current Pre Sale List". Sales are online, Wednesdays at 10 am.
- **robots.txt:**
  - www.douglasco.gov (200): `User-agent: *`, `Disallow: /wp-login.php`, `Disallow: /wp-admin/`, `Crawl-delay: 60`.
  - www.douglas.co.us/robots.txt answers 301 to that file.
  - The apps host's robots.txt was not read.
- **Terms:** the Public Trustee page's disclaimer (`https://www.douglasco.gov/public-trustee/`): "The User agrees that data from the PUBLIC TRUSTEE website will be used for only lawful and ethical purposes ... The User shall not attempt to hack, reverse engineer, break into, or compromise the PUBLIC TRUSTEE website." Automated reading is not forbidden. The privacy policy says nothing on it.
- **Verdict: unclear** (host blocked). To do: allow **apps.douglasco.gov**, read and date its robots.txt and terms, and see the pre-sale list's format. Keep the 60-second delay unless its own robots.txt says otherwise.

### Arapahoe — not allowed

- **robots.txt:** `https://www.arapahoeco.gov/robots.txt` answers 302 to `https://files.arapahoeco.gov/robots.txt`. That file allows Googlebot, Bingbot, FacebookBot, LinkedInBot/1.0 and Twitterbot, then `User-agent: *` and `Disallow: /`. RFC 9309 says to follow the redirect, so the file governs www. **No page was read after it.**
- **Verdict: not allowed.** Robots.txt disallows the site for us. The Public Trustee search's own address is unknown. A principal asks for a weekly list by email, a bulk subscription, or written permission.

### Broomfield — list unclear, EagleWeb not allowed

- **egov.broomfield.org:** there is no robots.txt (404), so nothing is restricted. The root and the paths `/PTForeclosureSearch/`, `/publictrustee/` and `/gts/` all answer 404. **The Public Trustee's weekly new-foreclosure PDFs were not found here.** The county's own pages are on www.broomfield.org, which is not reachable here.
- **EagleWeb** (`https://egov.broomfield.org/recorder/web/`) is the recorder's index of documents recorded since November 15, 2001. It opens on a disclaimer: "If you choose not to accept the conditions stated above, please exit this search application." Its "I Acknowledge" button POSTs a guest login (`loginPOST.jsp`, `guest=true`) and starts a session. **A login, even a guest one, counts as not allowed** unless the terms expressly allow automated use, and these do not mention it.
- **Verdicts:** the list is **unclear**: allow **www.broomfield.org**, find where the Public Trustee posts the PDFs, then read that host. EagleWeb is **not allowed**.

### Colorado courts, Rule 120 notices — not allowed now

- **robots.txt** of www.coloradojudicial.gov (200, Drupal): `User-agent: *`, with `Disallow: /dockets`, `/search/`, `/sealed-case` and `/user/login`. There is no Crawl-delay.
- **What happened:** the first two requests (robots.txt, then a 404 page) were answered normally, about a minute apart. The third (`/trial-courts-district`) answered **HTTP 403, "... has been banned up to Wed, 18 Nov 2026 20:32:05 +0000"**, naming this environment's shared egress address. One request already queued got the same answer, and nothing was sent after. Whether the ban was caused by us or by others on the shared address is unknown.
- **Verdict: not allowed now.** A block is never worked around. A principal asks the Judicial Branch whether automated reading of posted Rule 120 notices is acceptable. Counsel reads Chief Justice Directive 05-01 (D-B9). The page is then read from an address the site has not banned, never by retrying from this one.

## 4. Recommended build order

The ranking puts sources that are allowed, machine-readable, and carry a lender plus an amount or APN first. Only one source meets all three today.

1. **Caldwell: build now.**
   - **Run:** one GET a week of `https://caldwellcounty.texas.gov/foreclosures`, which holds all years.
   - **Read:** each `li.doc-item`'s `href` and `time[datetime]`. Key each notice by the `href`; keep the ETag.
   - **Fetch:** only new PDFs, 21 seconds apart. Parse the OCR text layer: the labelled blocks (`LENDER:`, `BORROWER:`, `Original Principal Amount:`, `Recorded:`) for the attorney's form, and the recital for the servicer's form.
   - **Review:** send anything unparsed or uncertain to the review queue.
   - **What it gives:** the lender (or the mortgagee and servicer) and the original principal on every notice. No APN.
   - **Why first:** it is the only cleared Texas list, and its parser is the template for Travis and Hays, which use the same statutory forms.
2. **Jefferson, once `gts.co.jefferson.co.us` is allowed and read.**
   - **URL:** `http://gts.co.jefferson.co.us/AllReports.aspx`; the format is not seen.
   - **Why:** an official weekly report (b) in one of the larger Denver-metro counties. Colorado's notices give 110 days or more of warning, and the NED must state the holder, the attorney and the outstanding balance.
3. **Douglas, once `apps.douglasco.gov` is allowed and read.**
   - **URL:** the "Current Pre Sale List" in the reports page of `https://apps.douglasco.gov/gts/`, probably `/gts/reports` like Denver's copy (inferred).
   - **Pacing:** 60 seconds between requests.
   - **Why:** the same GTS product as Jefferson, so the same parser.
4. **Travis, once `www.tccsearch.org` is allowed and its robots.txt and terms permit automation.**
   - **Why:** the largest county in either metro. But it is a search app (c), so its terms decide.
   - **Reuse:** the Caldwell notice parser.

Then:

- **Hays**: allow www.hayscountytx.com and read it.
- **Denver**: ask the Public Trustee for a GTS report. It would then use the Jefferson parser.
- **Broomfield**: find the list's host.
- **Adams and Arapahoe**: only by the county's permission or a feed.
- **Rule 120**: after counsel.

Jefferson, Douglas and Travis fields are **not seen**: each needs its own short spike before its parser is written.

## 5. For a principal

**Hosts to allow** (data-sources D6): www.tccsearch.org (Travis), www.hayscountytx.com (Hays), gts.co.jefferson.co.us (Jefferson; linked over http), apps.douglasco.gov (Douglas) and www.broomfield.org (Broomfield). Each then needs its own dated robots.txt and terms read before a watcher runs.

**To confirm:**
1. **Caldwell:** that lender-level use is "any use permitted by the Texas Public Information Act", and that the no-solicitation-of-individuals condition holds. The disclaimer is under the District Attorney's review, so recheck it monthly.
2. **Denver:** ask the Public Trustee for a weekly new-foreclosure report on its GTS reports page, or for its word on automated searching and the reCAPTCHA.
3. **Adams:** ask for the weekly report by email, or an allowance past the Cloudflare challenge.
4. **Arapahoe:** ask for a feed or written permission, since robots.txt disallows everything.
5. **Rule 120:** counsel on CJD 05-01, and an approach to the Judicial Branch. Do not retry from this environment, whose address the site banned.
6. **Jefferson:** counsel on the county's copyright claim in "data compilations", with D-B9.
