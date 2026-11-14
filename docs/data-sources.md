# Data sources: what we pull, what we listen for, and in what order

Desk research of November 13, 2026, for the getting-data side of the PRD (`docs/prd-signal-pipeline.md`). Every fact about an outside source in section 2 has one of these marks. The two built sources were checked live in the PRD (E3, E4-S1). Sections 3 to 7 are this plan's judgments, built on section 2.

- **Checked**: fetched or tested live.
- **Seen**: the official page's own text, read through search results. The page itself could not be fetched, because this development environment's network blocks most of these hosts.
- **Unconfirmed**: from memory or a secondary source.

**Updated November 14, 2026** with the listening research in `docs/listening-sources.md`: news wires, bank newsrooms, regulator press feeds, news aggregators, trade press, loan-sale advisors and note marketplaces, LinkedIn, job postings, public-notice sites and forums. That pass read search excerpts only. Its [E] facts are marked **Seen** here when the excerpt was of the official page, and **Unconfirmed** when it was of a secondary page. Its [U] facts are Unconfirmed. Its inferences are marked "inferred". "Open question N" below means that note's list.

Before any adapter is built, a short spike moves its facts to Checked, as the CMBS spike (E4-S1) did. No prospect data is in this file: examples are described, not named.

## 1. How the data side works

**Four questions.** Every source earns its place by answering one of them:

| Question | What answers it | Today |
|---|---|---|
| 1. **The paper.** What CRE loans does this lender hold, in which categories and metros, and how stressed? | Call Reports, CMBS loan data, concentration ratios | FDIC and CMBS **built** |
| 2. **The pressure.** Who is under pressure to sell, and why now? | Concentration against capital, losses, regulator orders, mergers, failures, held-for-sale disclosures | Partly (FDIC trends) |
| 3. **The assets.** Which specific loans are in trouble right now, and which lender holds each? | County foreclosure notices, receiverships, bankruptcies, CMBS special servicing, loan-sale listings | CMBS **built** |
| 4. **The person.** Who decides whether the loans are sold? | Proxy statements, bank leadership pages, industry forum rosters, contact databases | Planned (E7) |

**Listening means comparing.** Each source is pulled on its own schedule: every few hours, daily, weekly, monthly or quarterly. Each pull is compared with the last one, and that comparison produces two kinds of signal. Every signal type declares which kind it is:

- **State signals** hold while a condition holds, and are recomputed from each pull. They drop away when the condition ends. Examples:
  - a loan in special servicing;
  - a bank's noncurrent CRE above a threshold in the latest quarter.

  Most of the built FDIC and CMBS signals are of this kind (`src/metrics.mjs`, `src/sources/edgar.mjs`).
- **Event signals** record a change once, with its date, and keep it. Examples:
  - a loan newly marked for note sale;
  - a new notice of trustee's sale;
  - a merger approved;
  - a bankruptcy petition.

  The change log (E2-S4) already records transitions. Filings and notices are events by nature.

Scoring and cards read both kinds. An adapter that turned a lasting condition into a one-time event would lose that condition after the first pull. So the kind is part of each signal's definition, and of its tests.

FDIC and EDGAR already keep the rest of the contract, and every new adapter keeps the same:

- a recorded fake for tests;
- the run log, field checks and change log (E2);
- a `sources verify` check against the live source;
- a worker job kind and a line in the schedule.

**Where it runs.** The worker runs on GitHub Actions, whose network is open, so adapters run there **once the platform is switched on** (E12-S7: the GitHub secrets set and `PLATFORM_ENABLED` true). Until then, nothing runs on a schedule, and no live check runs by itself.

This development environment blocks most of the hosts in section 7, so adapters are built and tested against fakes. Until the worker is on, a person runs `outbound sources run <source>` and `outbound sources verify <source>` by hand, from a machine with an open network. An adapter is not done until that live check has passed once.

**Rules carried over:**

- Asset-level details (property, address, borrower, the filing itself) are context for a principal only. They never reach the drafter, and a test proves it for every new source.
- A source is automated only when its terms allow it, or a principal has recorded a decision that they do.
- Every request declares who we are. SEC sources wait for the User-Agent contact (Q11).

## 2. The source map

Priority is for this firm: **High** feeds scoring or candidates directly, **Med** adds context, **Low** is not worth building now.

### 2.1 The paper

| Source | What it adds | Access | Key and terms | Cadence | Priority |
|---|---|---|---|---|---|
| FDIC BankFind | Banks, branch deposits, 8 quarters of CRE by category and stage. Checked (PRD E3, Appendix A). | api.fdic.gov | None | Quarterly | **Built** |
| SEC ABS-EE EX-102 and 10-D | CMBS loans in our metros, special servicing, workout codes, servicers. Checked (PRD E4-S1). | sec.gov | Declared User-Agent | Monthly | **Built** |
| **Concentration screen** (FFIEC CDR bulk Call Reports) | The 2006 interagency guidance's screen. Checked against its text (71 FR 74580, December 12, 2006, via FDIC FIL-104-2006). Either test is enough: (a) construction and land loans at or above 100% of total risk-based capital; or (b) CRE at or above 300% of total risk-based capital **and** CRE grown 50% or more over 36 months. Computed from Call Report items (RC-C loans, RC-R capital), using the guidance's own definitions. | cdr.ffiec.gov/public/PWS/DownloadBulkData.aspx: ZIP, tab-delimited or XBRL. Seen. | None for bulk. Seen. | Quarterly | **High** |
| UBPR bulk (same page) | Page 7B: non-owner-occupied CRE as a percentage of capital (line 29), and its 3-year growth (line 30). Seen. **A cross-check, not the screen.** UBPR divides by tier 1 capital plus allowance, while the guidance divides by total risk-based capital (Seen). So a UBPR value of 300% is not the regulatory test. | Same page | None for bulk. Seen. | Quarterly | Med |
| FFIEC CDR bulk Call Reports | Every Call Report item. The main gain over BankFind is Schedule RI-C: allowance for credit losses on construction and other CRE, at banks with $1B+ in assets. Seen. BankFind already carries most of the CRE detail. Checked against the FDIC field list. | Same bulk page | None for bulk. The web service needs an account. Seen. | Quarterly | Med |
| NCUA 5300 | Credit unions' CRE by type (non-owner-occupied, construction and development) with delinquency buckets. Seen. **A seller class we do not cover yet.** | ncua.gov quarterly data: ZIP of CSVs. Seen. | None | About 70–76 days after quarter end. Seen. | Med–High, if in scope (D2) |
| SEC Financial Statement and Notes data sets | Public banks' CRE splits. The companyfacts and frames APIs drop them, because they keep only whole-entity facts (Checked). Banks tag CRE with their own custom members, which this data set keeps in its DIM table. Checked. | sec.gov/data-research/sec-markets-data/financial-statement-notes-data-sets | Declared User-Agent, 10 requests a second. Checked. | Monthly | Med (later) |
| Freddie Mac K-deals, Fannie Mae DUS | Agency multifamily loan data. Registration needed; no property address found. Seen. | fm-msia.com, capitalmarkets.fanniemae.com | Registration | Monthly | Low: different sellers |

### 2.2 The pressure

| Source | Event | Access | Key and terms | Cadence | Priority |
|---|---|---|---|---|---|
| **EDGAR full-text search** | 8-K Items 2.01 (acquisitions) and 2.06 (material impairments). Phrases such as "transferred to held for sale" with "commercial real estate", "loan sale", "balance sheet repositioning". DEF 14A proxies for named officers. A test since November 2025 found 211 held-for-sale filings, 30 by California filers, and 37 proxies naming a chief credit officer in our five states. Checked. | efts.sec.gov/LATEST/search-index (phrase, form, date, location filters; 100 hits a page). Checked. | Undocumented endpoint: a broad query can return an error body with HTTP 200 (Checked), so the adapter must check the body. Declared User-Agent, 10 requests a second. | Same day | **High** |
| **FDIC structure events** | Mergers and acquisitions with acquirer and target. An acquirer often sells the target's CRE book. | api.fdic.gov/banks/history, rebuilt daily. Checked. | None | Daily | **High** |
| **Failed banks and FDIC loan sales** | A failed bank's loans are sold by the FDIC in sealed-bid pools. One bank in our metros failed in September 2026. | fdic.gov failed-bank CSV and asset-sales/loan-sales pages. Seen. **The `/failures` API is stale**: its index was built August 25, 2026, and it lacks that September failure. Checked. | Bidding needs an eligibility certification, a confidentiality agreement, $1M net worth and deposits. Seen. | Per event | **High** |
| **Merger applications, federal** | Applications before they close. **OCC Corporate Applications Search (CAS):** "effective December 19, 2025, the Weekly Bulletin has been replaced by the Corporate Applications Search (CAS) tool, which provides the same information". Applications appear after a "five-day delay". Seen. It covers national banks and federal savings associations: mergers, branch closings and business combinations, with status and OCC action. Seen. **Fed H.2** (weekly): "Actions of the Board, Its Staff, and the Federal Reserve Banks; Applications and Reports Received", including delegated approvals. Seen. **Fed orders RSS:** "Orders on Banking Applications". Seen. | apps.occ.gov/CAS/; a date range of at most 5 years. Seen. No CAS RSS found: Unconfirmed. federalreserve.gov/releases/h2/YYYYMMDD/ and `/delactions.htm`. Seen. federalreserve.gov/feeds/press_orders.xml. Seen on November 13; the filename was not re-found on November 14 (open question 6). | None. CAS terms and robots.txt not read (open question 7). The Fed: "Unless otherwise indicated, information on Board's website is in the public domain and may be copied and distributed without permission." Seen. | Weekly | **High** |
| **Merger applications, state** | State-chartered banks' applications: mergers, acquisitions of control, branch sales, conversions. A state nonmember bank's merger never shows in OCC CAS, and shows in H.2 only when a holding-company application is needed (inferred). Whether the FDIC publishes its own applications list is not known (open question 8). | **California DFPI:** the Monthly Bulletin, issued under Financial Code §376, has a "Bank Activity" section (dfpi.ca.gov/news/monthly-bulletins/; email subscription). Seen. **Colorado Division of Banking:** a monthly "Financial Institution Activity" bulletin of approved applications, removed after completion (PDFs such as banking.colorado.gov/sites/banking/files/2026-01_Bulletin.pdf). Seen. **Texas Department of Banking:** a corporate filings page (dob.texas.gov/banks-trust-companies/2025-corporate-filings), and the Finance Commission meeting packet's Corporate Division report of "significant bank and trust applications" received. Seen. No RSS found: Unconfirmed. | None. The agencies' own terms not read. Texas state policy: an agency may not charge a fee "to access, use, reproduce, or link to its website information unless the Legislature specifically authorizes it". Seen. | Monthly. Texas packets about every two months: Unconfirmed. | **High** |
| **Regulator press feeds** | Failures and acquiring banks, enforcement-order releases and loan-sale notices (FDIC); orders and enforcement actions (Fed); monthly enforcement-action releases (OCC). A dated cross-check on the order lists and the failure adapters. | FDIC press releases: a "Subscribe via RSS" link. Seen. The GovDelivery feed is public.govdelivery.com/topics/USFDIC_26/feed.rss: Unconfirmed (a third-party guide). Fed feeds: federalreserve.gov/feeds/feeds.htm. Seen. OCC: an RSS index at occ.gov/rss/index-rss.html, with "OCC News Releases" and "OCC Bulletins". Seen. | None. Fed: public domain, as above. Seen. FDIC Archive: "information that is created by or for the US government on this site is within the public domain" and "may be freely distributed and copied", crediting the FDIC. Seen. OCC: no copyright statement found (Unconfirmed); a federal work, so public domain (inferred). | Daily | **High** |
| FFIEC NIC | Holding-company ownership and merger history, keyed by RSSD ID. Links banks across names and charters. | ffiec.gov/npw/FinancialReport/DataDownload: CSV or XML. Seen. | None | Unconfirmed | Med–High |
| **Enforcement orders** | Regulator orders against a bank, often about CRE concentration, credit administration or capital | OCC: api.occ.gov/EnforcementActions/list, needs a free key (Seen). FDIC: orders.fdic.gov search, monthly, no API (Seen). Fed: enforcement search and RSS (Seen). Texas Department of Banking and California DFPI: stable list pages (Seen); the Texas department's press releases are mostly consent orders and enforcement (Seen). Arizona, Nevada, Colorado: little or nothing for banks (Seen). Colorado's monthly bulletin lists approved applications, not orders: see "Merger applications, state". Seen. | OCC key. The rest are HTML or PDF. | Monthly | **High** (OCC, FDIC, Fed); Med (TX, CA) |
| FRED | Market context: rates, CRE delinquency and prices, lending standards (series in 2.5) | api.stlouisfed.org | Free key, 120 requests a minute. **The default terms are non-commercial; commercial use has extra restrictions.** Seen. Needs a legal check (D4). | Daily to quarterly | **High**, after the check |
| **Newsrooms of banks with no EDGAR filer** | The bank's own release: merger, branch sale, capital raise, loan sale. For an OTC or §12(i) bank this may be the only place it appears, besides local press (inferred). 104 banks traded on OTCQX in Q2 2026. Seen. Many deregistered from the SEC and publish through OTC Markets instead: Seen. Banks that register securities at the bank level file with their regulator under Exchange Act §12(i). The FDIC "does not participate in the SEC's EDGAR", and had about 15 such filers in 2018 and 2022. Seen. | The bank's newsroom. Q4-hosted and Notified-hosted (`*.gcs-web.com`) IR sites carry RSS pages; B2i lists RSS. Seen. FDIC filings: efr.fdic.gov (Seen in a 2011 letter; whether it is current: Unconfirmed). OTC Markets: a data feed needs a distribution agreement, and each "RSS feed" licence an addendum. Seen. | Each bank's own site terms and robots.txt: none read. | Daily: RSS first, one conditional GET per host | Med–High: it depends on how many Tier A and B banks have no EDGAR filer (open question 1) |
| GDELT DOC 2.0 | Headlines that mention a universe bank with a loan-sale, merger or capital phrase. It can pick up local news of private banks (inferred). It returns article URLs and titles, ranked (Seen), not the text (Unconfirmed). A rolling 3-month window by default, extendable to the past year (Seen, GDELT's blog). | api.gdeltproject.org/api/v2/doc/doc, no key. Seen. Its filters and result cap: Unconfirmed (open question 10). | "all datasets released by the GDELT Project are available for unlimited and unrestricted use for any academic, commercial, or governmental use of any kind without fee", with a citation and link. Unconfirmed: a secondary quote of its terms. The linked articles stay under their publishers' terms, so they are never fetched. | Daily | Med |
| Special-assets job postings | A posting for special assets, workout, loan sales or credit resolution at a target bank. **A modifier, never a trigger**: these roles exist in normal times (inferred). In a small sample of such postings, the hosts were Paylocity, Workable and iCIMS, and none was on Greenhouse or Lever. No market-share data for community banks was found. Seen. | LinkUp: listings "collected directly from employer websites by indexing jobs that are publicly available", in daily feeds. Seen. Greenhouse Job Board API: the GET needs no authentication. Seen. Lever Postings API: no key (Unconfirmed: secondary pages). | LinkUp: a licence; terms and price not read (D10). Greenhouse: reuse rights unclear (Unconfirmed). | Daily | Low–Med: a modifier only |

### 2.3 The assets

The county-by-county plan, starting with Maricopa, is in `docs/county-playbook.md`. It also covers the Phoenix city layer and the Los Angeles vendor comparison.

**The foreclosure trail differs by state.** The warning time decides how useful a county source is:

| State | What is recorded or posted, and where | Warning before sale | Receiverships |
|---|---|---|---|
| Texas | Notice of trustee's sale, filed with the county clerk and posted on the county's website (Prop. Code 51.002). Seen. No newspaper publication is required. Seen. | **About 21 days.** Seen. | Used, mostly with CMBS loans. Unconfirmed. |
| Colorado | Notice of election and demand, filed by the lender's attorney with the county public trustee, which names the attorney. Seen. | **110–125 days.** Seen. | Common in commercial deeds of trust. Unconfirmed. Court search costs $5 a name. Seen. |
| California | Notice of default, then notice of trustee's sale, recorded with the county recorder | At least 3 months, then at least 20 days. Unconfirmed. | Common: judicial foreclosure with a rents receiver. Unconfirmed. |
| Arizona | Notice of trustee's sale, recorded with the county recorder | **At least 91 days** (A.R.S. 33-808). Seen. | Common. Uniform receivership act since 2019. Unconfirmed. |
| Nevada | Notice of default, recorded with the county recorder | At least 3 months. Unconfirmed. | Uniform receivership act since 2017. Seen. |

**The six main counties:**

| County | Where | Access | Commercial or residential | Recommendation |
|---|---|---|---|---|
| **Maricopa** (Phoenix) | recorder.maricopa.gov document search ("Notice of Trustee Sale" by date); documents viewable online. Seen. | Free search, updated daily. Bulk needs an account with a $300 deposit and a commercial-purpose statement (A.R.S. 39-121.03). Seen. | Join on parcel number to the assessor's free downloads, which include a commercial file, plus a free-token API. Seen. | **Free adapter. The best of the six.** |
| **Denver** | denvergov.org/foreclosuresearch: search by date range of the notice. Moved to new software on May 1, 2026. Seen. | Free search; no bulk found | Not on the notice. Join to assessor data on Denver's open data catalog. Seen. | **Free adapter**, weekly |
| Adams, Jefferson, Douglas, Broomfield (Denver metro) | Weekly new-foreclosure PDFs (Adams, Broomfield, Jefferson), search pages (all). Seen. | Free | Assessor join | **Free adapters**. Adams is the easiest. Vendor fallback: SKLD (quote only). |
| **Travis** (Austin) | countyclerk.traviscountytx.gov notices, and travis.tx.publicsearch.us. Seen. Williamson, Bastrop and Caldwell post PDFs. Seen. | Free search, no bulk. GovOS terms may bar direct third-party access to the system. Unconfirmed. | Join to the appraisal district's free export. Seen. | Free adapter, after reading the terms. **Low early value** (21 days), but it names who is enforcing. |
| **Los Angeles** | The registrar-recorder offers **no online access** to records or indexes. Seen. | In person or by mail only | Assessor parcel layers. Seen. | **Vendor only**, plus court monitoring for receiverships |
| **San Diego**, **Orange** | Recorder index online; document type and date searchable. No images online. San Diego dropped parcel-number search in December 2024 (AB 1785). Seen. | Free index, 24–48 hour lag (San Diego). Seen. | San Diego parcels free, without owners. Seen. | Free adapter on the index for early flags; **vendor** for lender, trustee and law firm, which appear only on the document image. Unconfirmed. |
| **Clark** (Las Vegas) | recorderecomm.clarkcountynv.gov: document type and date. No images online. Seen. | Free index. Copies paid. | Parcel data $2,500 for the county. Seen. | Free index adapter, plus a vendor or ordered copies |
| Pinal (Phoenix metro) | acclaim.pinalcountyaz.gov, document type search. Seen. | Free search; image cost not found | Unconfirmed | With Maricopa |

**Courts and other asset events:**

| Source | Event | Access | Key and terms | Priority |
|---|---|---|---|---|
| **Bankruptcy courts' public RSS feeds** (Arizona, Colorado, Nevada, Central and Southern California, Western Texas) | Every public docket entry, including new chapter 11 petitions | "Entries made in the last 24 hours" feed on each court's CM/ECF site. Seen. No filter for single-asset real estate. Seen. | Free, no account. **The window is 12–24 hours, so a missed poll loses filings.** Electronic filing runs every day of the week, so polling must too: see section 5, step 9. | **High** |
| PACER Case Locator | The petition itself: single-asset real estate box, the secured lender | Official API. Seen. | PACER account. $0.10 a page, $3 a document at most, waived under $30 a quarter. Seen. | Med: confirms an RSS hit |
| CourtListener / RECAP | Docket search and alerts | Free token | **Internal business tools count as commercial use**, so a commercial agreement is needed. The free tier allows 125 requests a day. Seen. | Only under an agreement |
| State court dockets | Receiverships and judicial foreclosure (California, Arizona, Nevada) | Travis and Maricopa searches free (Seen, Unconfirmed); LA free by case number only (Seen); Colorado $5 a name (Seen) | Varies | Med; Trellis is a vendor option |
| Loan-sale listings | Non-performing loans and pools actually for sale, with metro and size; the seller is usually unnamed | JLL Invest public pages; First Financial Network bank and FDIC sale notices; FDIC loan sales. Seen. DebtX and Mission Capital too: see the advisor table below. | Free to view. NDA or registration for the offering memo. Terms not found, for any advisor. | **High** for deal flow: poll a few times a week, gently, once the terms allow |
| National Law Review "Distressed Deal Alert" and "NPNS Weekly Update" | New distressed transactions with bid deadlines, auction dates and contacts; public notices of bankruptcy, receivership and UCC Article 9 sales. Two weekly emails since July 15, 2025. Seen. | Email: natlawreview.com/newsletters. Seen. | Price and terms not found | Med: **Manual**, a principal subscribes |
| KBRA, Morningstar DBRS, Trepp, CRED iQ | Commentary that names troubled CMBS loans and servicers | Public research pages and releases. Seen. | Some need free registration | Med: mostly overlaps our CMBS data |
| UCC filings (state) | UCC-3 assignments can reveal a loan sale | Free search in California and Colorado; $1 a search and a $65 daily file in Texas; Nevada bulk paid. Seen. | Varies | Low (later) |

**The advisor listing watch** (PRD E16-S8 listings, E19-S1 mandates). Listing titles carry the metro and size, for example a $10.3 million non-performing loan in Denver. Seen. That is enough for a listing event and a mandate. The seller is usually only described ("Seller: Bank", "a regional bank"). A description goes in an optional `sellerDescription`, shown to a principal and never used to match a bank. A described seller is never guessed into a `fdic:CERT`. The seller-named counts below are small samples of search-indexed pages, not a full crawl.

| Source | What it shows | Seller named | Terms | Verdict |
|---|---|---|---|---|
| **DebtX** (debtx.com) | A deal archive and current deals. Titles with size and often metro or state; status, seller type, bid date, loan counts, collateral. Seen. | 0 of 10 closed deals sampled: all "Seller: Bank". Seen. | Not found; robots.txt not read. WordPress-style paths, so `/feed/` probably exists (inferred). | **Build, gated** on the terms or DebtX's written permission (D11). A principal reads it meanwhile. |
| **First Financial Network** (ffncorp.com) | A loan-sale marketplace, quarterly loan-sale events and announcement PDFs, for example a $22M CRE sale with bids due December 8, 2026. Seen. | 2 of 4 bank-seller sales seen: two 2026 announcement files carry the bank's name in their file names. FDIC sales name the failed bank. Seen. | Not found; robots.txt not read. | **Build, gated.** The highest value of the advisors, because some announcements name the seller. |
| **Mission Capital** (missioncap.com, market.missioncap.com) | "CLOSED DEAL ALERT" posts with size and asset type, a marketplace of sale memos, and mandate releases. Seen. | 1 of 3 of its own posts sampled. A 2026 trade item named a bank seller in one of its mandates. Seen. | Not found; robots.txt not read. | **Build, gated.** |
| **JLL Invest** (invest.jll.com) | Listings with size and metro in the title, cross-listed on Crexi. Seen. | 0 of 5 listings sampled; 1 of 2 tombstones on JLL's service page. Seen. | Not read. | **Build, gated.** |
| **Crexi** (crexi.com) | Note and loan listings with city and state, including advisors' cross-listings and pools from Xchange.Loans. Seen. | Not in the excerpts. Seen. | The Master Service Agreement prohibits "any unauthorized data mining, scraping, robot or other automated data gathering". Seen. | **Manual**: a principal's saved-search alerts. Never built. |
| **RealINSIGHT Marketplace** (rimarketplace.com) | Sale events for "real property, mortgage notes, mezzanine notes or any other type of property, sold on behalf of the owners". Seen. | No: listings name the platform and the sales agent. Seen. | The automated-access clause was not returned: Unconfirmed. | **Manual**, by saved search |
| **Xchange.Loans** | A CRE loan marketplace for lenders selling non-performing CRE loans; most listings close in under 60 days. Seen. | Not stated | Not found | **Manual**, by saved search; recheck the terms |
| **Revere** (platform.reverecre.com) | Brokers' loan-sale project pages. Seen. | Not stated | Not read | **Manual**, by saved search |
| Garnet, Newmark, CBRE, Cushman & Wakefield, Hilco | Garnet is mostly consumer, residential and charge-off portfolios. CBRE has a 2025 capabilities PDF with a deal table. Cushman & Wakefield's listings run on RealINSIGHT and Revere. Seen. | Sometimes, in the brokers' own releases: Newmark 1 of 2, Cushman & Wakefield 0 of 2. Seen. | Not read | **Manual** |

Not used: Eastdil Secured and Berkadia (no loan-sale listings or advisory found; Seen), LoanMLS (a secondary page says it no longer operates: Unconfirmed), Auction.com's commercial side (no 2026 note activity found; Seen; recheck yearly), and Ten-X (2.6).

**Trade press that names sellers.** The advisors rarely name the seller; these sometimes do.

| Source | What it gives | Access and terms | Cost | Verdict |
|---|---|---|---|---|
| **Commercial Real Estate Direct** (crenews.com, "Loan Offerings (LOAN)") | 2026 items name the bank seller and the advisor, for example a May 2026 Texas office loan offering. Seen. | Paywalled: Unconfirmed. Subscription terms not read. | Not found | **Licensed only** for any automated use; **Manual** meanwhile (D8) |
| **Commercial Mortgage Alert** (Green Street) | A weekly covering commercial MBS and real-estate debt, with a "Loan sales" section. Seen. It reports loan-sale mandates and pools on offer, often naming the seller: Unconfirmed. | A "Free 3-Week Trial Subscription". Seen. Terms not read. | "Upwards of $8,000" a year. Unconfirmed: a secondary blog. | **Licensed only, read by a principal.** Start with the trial (D8). |

**Statewide public-notice sites.** Each of our five states has one, run by its newspapers' association. Seen.

| State | Site | What it offers | Verdict |
|---|---|---|---|
| Arizona | arizonapublicnotices.com | Free; phrase search across all publications. A notice of trustee's sale is published "at least once a week for four consecutive weeks" (A.R.S. 33-808). Seen. Whether the published form names the beneficiary: Unconfirmed. | **Manual.** Maricopa's recorder is earlier. |
| Texas | texaspublicnotices.com | Statewide since 2022. Seen. **But a notice of trustee's sale is not published in newspapers:** Prop. Code 51.002 requires posting, filing and certified mail, and the county posts the notice online "without charge or registration". Seen. | **Not used** for foreclosures: the county pages are the source |
| Colorado | publicnoticecolorado.com | All notices in papers of record; SmartSearch daily email alerts. Seen. | **Manual** at most: the public trustees post earlier |
| California | capublicnotice.com | Member newspapers' notices. Voluntary: AB 2095, which would have required it, was vetoed in 2024. Seen. Whether it carries trustee's sale notices, by county: Unconfirmed. No alert feature found. | **Manual**, then a coverage spike (open question 19) |
| Nevada | nevadapublicnotice.com | Keyword email alerts. Seen. | **Manual**, then a spike |

**They are not earlier than the recorders** (inferred): newspaper publication follows the recording or filing, and the upload follows the newspaper's run. **What they may give is names.** For Los Angeles, San Diego and Clark, whose document images are not online, the published text may carry the trustee, the lender and sometimes the lender's counsel (inferred; whether the notices name the beneficiary is Unconfirmed, open question 27). If the spike finds them, they could replace part of the vendor spend in D1. Notices name no property type, so they are joined to the assessor data, and asset details stay principal context.

**Vendors** (for counties without free documents):

| Vendor | Coverage | Lender, trustee, attorney | Delivery | Price |
|---|---|---|---|---|
| PropertyRadar | Trustee sales in AZ, CA, NV; one page also lists CO. Seen. | Foreclosing lender, trustee, sale number. Seen. | Export; API on all plans. Seen. | $119, $249 or $599 a month (cached page). Seen. |
| ATTOM (owns RealtyTrac) | National. Publishes commercial foreclosure reports. Seen. | Lender and trustee fields. Seen. | API, bulk files. Seen. | Quote; property API from $500 a month. Seen. |
| SKLD | Six Denver-metro counties. Seen. | Lender, foreclosure attorney. Seen. | Daily or weekly reports. Seen. | Quote |
| Reonomy (Altus) | National commercial; pre-foreclosure filter with mortgage lender. Seen. | Lender yes, trustee not found | Web app | Not found |

### 2.4 The person

This part follows the contact rules in E7: every person has a source, a principal confirms the role, and only business addresses are used.

- **Proxy statements (DEF 14A)**, through EDGAR full-text search. Free. They name the chief credit officer only when that person is among the named executive officers. Checked.
- **Bank leadership pages**: free, read by the briefer.
- **Industry rosters**: CREFC forum chairs, including the special servicers forum (Seen), and MBA CREF session pages (Seen). Good for servicers' asset managers.
- **Conference speaker pages: forum evidence for E22** (`bank.memberships` findings, forum targets only, under E22-S2 and E22-S4's rules).
  - IMN's Bank Special Assets events (Texas, December 1–2, 2026; East) and its Distressed CRE West and East events publish speaker pages. The Texas event's speakers include bank special-assets executives. Seen. The best public forum source for banks (inferred).
  - CREFC conference program pages, with sessions and speakers. Seen.
  - The California Bankers Association's Lending & Credit Conference, November 3–5, 2026, with speakers and handouts. Seen. The best state-level forum source for credit officers (inferred).
  - RMA chapter event pages. One 2026 distressed-CRE panel at a chapter included a bank's special-assets officer. Seen.
  - **How it is read:** a principal keeps a list of about 10–15 events in config (name, host, URL, dates). The briefer reads those URLs when it researches an account. Nothing polls.
  - **Attendee lists never enter the pipeline.** CREFC's goes only to registered in-person attendees, "for up to 30 days after the conference ends", and attendee contact details are "a CREFC Member benefit". Informa's attendee list stays in its event app: it "does not export into excel and is only viewable within the app". Seen. A list a principal receives as an attendee is for their own in-person networking. It never goes into `network/`, `contacts/` or research, and nobody is emailed from it. Third-party "predicted" attendee lists are not used.
- **LinkedIn: a principal may read it; the pipeline never does.**
  - The User Agreement is "Effective on November 3, 2025". Section 8.2, its "Don'ts" list, bars scraping tools, bots, and copying information "obtained from the Services, whether directly or through third parties". Seen. The copying clause was seen only as LinkedIn's help page paraphrases it, so its exact current wording is Unconfirmed.
  - No official API lets a third party read other people's posts or job changes (inferred). The Marketing APIs allow member data only for managing your own Pages or Profiles, and SNAP partners "do not actually get access to the LinkedIn data". Seen.
  - *hiQ v. LinkedIn* ended on contract. In November 2022 the court found hiQ in breach of the User Agreement. On December 8, 2022 it entered a consent judgment and permanent injunction: $500,000, no scraping in breach of the User Agreement without written permission, and deletion of the scraped data and the code. Seen. The earlier CFAA rulings never made scraping lawful under the contract (inferred).
  - Parsing LinkedIn's alert emails automatically is not used either. It fits the copying clause, and it rebuilds the export that Sales Navigator withholds (inferred). Only with LinkedIn's written permission (open question 16).
- **The Sales Navigator Core workflow**, if a seat is bought (D9). Core costs US$119.99 a month, or US$1,079.88 a year. Seen. It gives lead alerts (a saved lead changed jobs or roles), account alerts (senior hires, layoffs, headcount, more posted jobs), and up to 50 lead and 50 account saved searches with weekly alerts. Seen. There is no native export (Unconfirmed: secondary pages); CRM Sync, on Advanced Plus, is the sanctioned route out. Seen.
  1. One seat, in a principal's own name. The principal saves the target banks, the ranked intermediaries (E19), and only leads already named in the account record from a public source (E7).
  2. The principal reads the alerts in Sales Navigator or in the email client. No forwarding rule, no parser, and no copy and paste of profile text.
  3. When an alert matters, the principal logs a signal by hand, **against the institution only** (`fdic:CERT` or `intermediary:<slug>`): the type (`person_moved`, `senior_hire`, `headcount_change` or `hiring_special_assets`), the date seen, the source "Sales Navigator, seen by a principal", and who logged it. No profile URL, no LinkedIn text, no screenshot.
  4. **Any person needs a public, non-LinkedIn source before E7 uses them:** the bank's leadership page, a press release, a proxy or an association page. Only then may `account set-person` name them.
  5. The signal shapes who and when, never the message.
- **Contact databases**, for addresses: Apollo (about $49–119 a user a month), Clay (free, $185 or $495 a month), ZoomInfo (about $15,000 a year and up). All Unconfirmed: get quotes. This is a budget decision (Q8).
- Cold email to business addresses still falls under CAN-SPAM. The FTC says there is "no exception for business-to-business email". Seen.
- **Personal data from new sources.** The rules are in `docs/listening-sources.md`, Part B 6.5. In short: no LinkedIn data by any route, including vendors built on it; no profile built by combining sources; nothing from an attendee list, a members-only directory or behind a login; and `forget` (E7-S3) covers any new store. Its CCPA facts were not searched, so they are Unconfirmed. Whether the thresholds reach the firm is D13.

### 2.5 Market context (FRED series)

These series are context on a card. They never score an institution. All Seen:

- **Rates:** `SOFR`, `DGS5`, `DGS10`.
- **CRE delinquency at banks:** `DRCRELEXFACBS`; by bank size `DRCRELEXFT100S` and `DRCRELEXFOBN`.
- **CRE charge-offs:** `CORCREXFACBS`. The ID guessed earlier, `CORCRELEXFACBS`, does not exist.
- **CRE prices:** `COMREPUSQ159N` and `BOGZ1FL075035503Q`.
- **Lending standards (SLOOS):** `SUBLPDRCSC`, `SUBLPDRCSM`, `SUBLPDRCSN`. **Demand:** `SUBLPDRCDC`, `SUBLPDRCDM`, `SUBLPDRCDN`.
- **Bank CRE balances (H.8):** `CREACBM027SBOG`, `CLDACBW027NBOG`, `SMPACBM027NBOG`, `SNFACBM027NBOG`.

The Fed is closing its own data download tool by July 1, 2027, and points users to FRED. Seen.

### 2.6 Not used, and why

| Source | Reason |
|---|---|
| LinkedIn | Its terms forbid bots and scraping. Seen. The User Agreement effective November 3, 2025, section 8.2, bars scraping tools, bots and copying. No official API gives a third party other people's posts or job changes (inferred, from the API pages). *hiQ v. LinkedIn* ended in a consent judgment and permanent injunction on December 8, 2022. Seen. A principal may read Sales Navigator by hand (2.4); nothing is automated, alert emails included. |
| Job-data vendors that draw on LinkedIn (Revelio, Coresignal, Lightcast's profiles) | They pass the LinkedIn risk on. Revelio's profiles come "from networking sites, mainly LinkedIn". Coresignal's sources "primarily encompass professional social networks". Lightcast's most common source for profiles is "online professional network sites". Seen. Lightcast's postings product may be acceptable (open question 22). |
| LoopNet and Ten-X | The terms bar building databases from the product. Seen. Ten-X still has a commercial notes search page, and its participation terms require note buyers to be accredited investors. Seen. Its terms could not be re-read on November 14. |
| Google News RSS | Personal, non-commercial use only. The feed's own notice, as quoted by third parties: "This XML feed is made available solely for the purpose of rendering Google News results within a personal feed reader for personal, non-commercial use. Any other use of the feed is expressly prohibited." Unconfirmed: not yet seen on a Google page. The legacy Google News terms say the same: "You may only display the content of the Service for your own personal use (i.e., non-commercial use)". Seen, an old version. |
| Bing News Search API | Retired. "Bing Search APIs will be retired on August 11, 2025", then "decommissioned completely". Seen. |
| NewsAPI.org's free plan | It "cannot be used in a staging or production environment (including internally)". The Business plan is "$449 per month". Seen. GDELT covers discovery for free (2.2). |
| Common Crawl CC-NEWS | Monthly bulk files, so late. Its FAQ says to respect the terms of the sites crawled (Seen, in a paraphrase), and third-party content keeps its copyright. Seen. Publishers dispute its use. Seen. |
| CourtListener's free tier | Internal business tools count as commercial use. Seen. |
| News-wire RSS (Business Wire, PR Newswire, GlobeNewswire) | **Not automated.** Business Wire limits use of its site to "submission of news releases for distribution via Business Wire Connect, retrieving RSS feeds, and the reading of releases, marketing, and other materials"; any other use needs its "express written consent". Seen. Its "commercial activities" wording, seen on November 13, was not re-found on November 14 (open question 4). PR Newswire's terms bar using "any robot, spider, site search/retrieval application, or other manual or automatic device or process to access, search, download, retrieve, index or "data mine" any content or data from the Site". Seen, in an indexed copy about 3 years old. GlobeNewswire's website terms were not found: Unconfirmed. **GlobeNewswire is the one wire worth asking (D7):** it is integrated with OTC Markets' disclosure service (Seen, an older announcement), so it likely carries releases of banks that are not on EDGAR (inferred). **EDGAR carries the same releases as 8-K exhibits for SEC filers only.** OTCQX banks (104 in Q2 2026, Seen), OTC Pink banks (count Unconfirmed) and banks registered under Exchange Act §12(i) that file with the FDIC (Seen) are not on EDGAR: see "Newsrooms of banks with no EDGAR filer" (2.2). A principal may read Business Wire's banking feed in a reader (counsel to confirm, D12). |
| Trade headlines (Bisnow, Commercial Observer, The Real Deal, GlobeSt, Connect CRE, Banking Dive) | **Not automated; read by a principal** (the principal reading list, section 3). Bisnow's terms: a user "may not use any robot, spider, scraper or other automated means to access the Sites", and may use them "only for INTERNAL OR PERSONAL purposes". Seen, in an indexed copy about 3 years old. Connect CRE's terms prohibit robots, spiders and AI systems (Seen, in a paraphrase). Commercial Observer's access is personal and non-commercial (Seen, in a paraphrase). The Real Deal's subscription licence covers use "solely for personal or internal business purposes". Seen. trepp.com and bizjournals.com refused the search tool's user agent. Seen. Bisnow has metro feeds for Denver, LA and Austin. Seen. |
| X (Twitter) API | Pay-per-use, about $0.005 per post read (Unconfirmed: secondary pages). The Developer Agreement, last updated April 27, 2026, restricts "tracking, alerting, or monitoring", and matching a handle to a person off X needs opt-in consent. Seen. Few advisors post there. A principal may follow accounts by hand (open question 24). |
| Workday careers endpoints | Undocumented: "not documented as a public contract", and they can change without notice. The official REST API needs per-tenant OAuth. Unconfirmed: secondary pages. |
| Indeed and Google job search | No read API. Indeed's Publisher job-search API is deprecated (Unconfirmed: secondary pages). Its Job Sync API is for ATS partners to post jobs. Seen. Google's old Jobs API shut down in 2021, and Cloud Talent Solution searches only your own jobs (Unconfirmed: secondary pages). Special-assets postings come from LinkUp or the Greenhouse and Lever boards instead (2.2). |

## 3. What we listen for

| Signal | Source | Pulled | Attaches to | Lead time |
|---|---|---|---|---|
| CMBS loan marked for note sale (workout code 5) | SEC CMBS | Monthly | Special servicer | The sale is planned: act now |
| CMBS loan moved to special servicing, or maturing within the window | SEC CMBS | Monthly | Special servicer | Months |
| Noncurrent or past-due CRE rising, first charge-offs | FDIC | Quarterly | Bank | Quarters (**built**) |
| Bank meets the concentration screen (construction 100%, or CRE 300% with 50% growth, of total risk-based capital) | Call Reports (UBPR as a cross-check) | Quarterly | Bank | Quarters: pressure from examiners |
| Enforcement order | OCC, FDIC, Fed, state lists | Monthly | Bank | Months |
| Enforcement press release | FDIC press RSS, OCC news RSS, the Fed's enforcement feed, Texas Department of Banking releases | Daily | Bank | Months. A dated cross-check on the monthly order lists |
| Merger application pending | OCC CAS, Fed H.2, the California, Colorado and Texas bulletins | Weekly (federal), monthly (state) | Applicant and target | Weeks to months before close: earlier than FDIC `/history`, which records only the close |
| Merger approved or closed | Fed orders RSS, FDIC history | Weekly | Acquirer, after close | 1–2 quarters after close |
| Bank failure | FDIC failed-bank CSV, loan-sale page | Daily | The FDIC as seller | Weeks: sealed bids |
| Loans moved to held for sale, loan sale disclosed, "repositioning" | EDGAR full-text search | Daily | That bank, and peers with similar books | Often late for that bank (the sale is under way); a lead on its next sale and on peers |
| Commercial notice of default, election and demand, or trustee's sale | County adapters, vendors; for Los Angeles, San Diego and Clark, the statewide notice sites may give the names (read by a principal) | Daily or weekly | The enforcing lender (context for a principal) | 21 days (TX) to 125 days (CO) |
| Receivership petition on commercial property | State court dockets | Daily | The lender | Weeks to months |
| Chapter 11 of a real estate entity in our districts | Bankruptcy RSS, then PACER | Every few hours | The secured lender named in the petition | Months |
| Release by a bank with no EDGAR filer: merger, branch sale, capital raise, loan sale | The newsroom registry (RSS first); OTC Markets pages and FDIC filings, read by a principal | Daily | That bank | Same day. For a loan sale, at or after the sale: a lead on the bank's next sale and on peers |
| Headline naming a universe bank with a loan-sale, merger or capital phrase | GDELT DOC 2.0 | Daily | That bank, in a principal's queue: the headline and link only | Days. A "sources say" story can come before any release |
| Loan or pool listed for sale in our metros | DebtX, FFN, Mission Capital, JLL Invest (once each is allowed); Crexi, RealINSIGHT, Xchange.Loans and Revere by a principal's saved search; FDIC | A few times a week | The advisor (a mandate, E19-S1) and the listing ledger (E16-S8), as principal context. The seller only when the listing names it; a `sellerDescription` is never matched to a bank | Days to weeks: bid dates |
| A bank named as the seller of a loan offering | FFN announcements, brokers' tombstones, CRE Direct, Commercial Mortgage Alert (read by a principal) | Weekly | That bank (a sale event) and the advisor | Days to weeks |
| Special-assets job posting: **a modifier only, never a trigger** | LinkUp, if licensed (D10); the Greenhouse and Lever boards; Sales Navigator's posted-jobs alert, read by a principal | Daily (feed); weekly (alerts) | Bank | Months: the hire comes before workout volume and any sale. It strengthens a pressure signal, such as an order, the concentration screen or rising noncurrent loans; it never starts one |
| Principal-logged Sales Navigator signal (`person_moved`, `senior_hire`, `headcount_change`, `hiring_special_assets`) | Sales Navigator Core, read by a principal (2.4) | Weekly | The institution only (`fdic:CERT` or `intermediary:<slug>`), never a person | Months |
| Rates move, lending standards tighten | FRED | Daily / quarterly | Context on cards only | — |

Every signal keeps the PRD's rule: it shapes **who** and **when**, never the text of a message.

### Principal reading list

What the terms keep out of the pipeline, a principal reads. Anything that matters goes in by hand: a sourced note, or a principal-confirmed record (the E19-S1 pattern), audited with their name. Nothing is forwarded, parsed or copied in automatically. Asset details stay principal context, and a person is named only under E7. The frequencies are this plan's placeholders.

| What | Read for | Who reads it | How often | Why it stays manual |
|---|---|---|---|---|
| The advisors' sites and buyer-list emails: DebtX, FFN, Mission Capital, JLL Invest (until step 14 is allowed); Garnet, Newmark, CBRE, Cushman & Wakefield, Hilco | Listings in our metros; a seller named in an FFN announcement or a broker's tombstone | The principal who owns buyer-list registrations (PRD D-I2) | A few times a week; CBRE's capabilities PDF once a year | Terms not read, or permission not given (D11) |
| Note marketplaces, by saved search: Crexi, RealINSIGHT, Xchange.Loans, Revere | Notes and pools listed in our metros | The same principal | As the alerts arrive | Crexi's agreement bars scraping (2.3); the others' terms are not read |
| Commercial Mortgage Alert (a 3-week trial first), CRE Direct's loan offerings | Pools on offer and loan offerings with the seller named | The principal who holds the subscription (D8) | Weekly | Licence-bound |
| Statewide notice sites: Nevada's keyword alerts; Arizona and California searched until an alert is found ("trustee's sale", "notice of sale", plus commercial words) | The lender, trustee and counsel for Los Angeles, San Diego and Clark | A principal | As the alerts arrive; weekly searches | Terms not read (D14) |
| The National Law Review's Distressed Deal Alert and NPNS Weekly Update | Distressed sales with bid dates; receivership and UCC Article 9 sale notices | A principal | Weekly | An email newsletter; terms not read |
| Sales Navigator Core alerts | Job changes and senior hires at target banks and intermediaries; more posted jobs | The principal who holds the seat (D9) | The weekly digest | LinkedIn's terms (2.4) |
| Trade press: Bisnow's metro newsletters (Denver, Los Angeles, Austin–San Antonio), Connect CRE's "Return to Lender", Banking Dive, American Banker's headlines, Commercial Observer, The Real Deal, GlobeSt, Trepp, CRED iQ | Distress, lender takebacks, bank M&A and enforcement; "sources say" loan-sale stories | A principal | Weekly | The terms bar automation, or allow only internal or personal reading (2.6; D12) |
| Business journals: Austin, Denver and Phoenix; Los Angeles and San Diego | Local deals, private banks | A principal | Weekly | Subscription terms |
| Business Wire's banking feed, in a feed reader | Releases by banks and holding companies | A principal | Daily | Use is limited to "retrieving RSS feeds, and the reading of releases" (D12) |
| Google Alerts by email, for Tier A names | Local news | A principal | As they arrive | Google's terms bar automated access against robots.txt |
| Earnings calls of Tier A public banks: the IR webcast, or a transcript | Remarks on loan sales and held-for-sale moves, which can come before the 8-K | A principal | Quarterly | Seeking Alpha's transcripts are "solely for personal, non-commercial purposes" (Seen); vendors are licensed |
| Banks with no EDGAR filer: OTC Markets pages, the FDIC filing portal, and newsrooms that offer only email alerts (a filtered mailbox) | Releases and financials | A principal | Quarterly; email as it arrives | OTC Markets licenses its feeds (2.2); the FDIC portal waits for a count of such filers in our states |
| Arizona DIFI and Nevada FID | New charters and orders | A principal | Quarterly | Little bank content; Arizona's state works are copyrighted (Seen) |
| X: the advisors' accounts | Closed-deal posts | A principal, if wanted | As wanted | The Developer Agreement restricts monitoring (2.6) |

The forum event list (2.4) is not on this list: the briefer reads those pages when it researches an account. A principal keeps the list current.

## 4. Learning

**Finding and checking sources.** Each source goes through three steps:

1. A spike settles its facts and terms.
2. An adapter is built against a recorded fake.
3. `sources verify` keeps checking it against the live source.

A source registry (`sources.json`) lists every source: cadence, hosts, key needed, terms status with the date checked, and the principal's decision. `sources status` flags any source that is overdue or whose terms check is older than a year.

**Learning which signals work.** Accounts created from a candidate already carry `originSignals`. Four pieces are missing:

- Outcome events on the account: reply, call, NDA, loan tape, bid, close.
- A quarterly report counting outcomes by signal type and by lead time.
- **Principals change the weights in `scoring.json`.** Nothing re-weights itself until there are enough outcomes to mean something (a placeholder of 30 conversations).
- Signal types that never lead anywhere are shown as such, so a principal can retire them.

## 5. Build order

**Phase 1: free, no account, terms allow automation.** These can start now:

1. **Fix failure detection.** **Built** (PRD E3-S5). Do not rely on `/failures` alone. Cross-check `/institutions` (inactive date) and the FDIC's failed-bank CSV, and add a verify check that flags a gap. Small.
2. **EDGAR full-text listener.** **Built** (PRD E13-S1); waits for the SEC contact (Q11) and confirmed filers. Daily saved searches for 8-K Items 2.01 and 2.06, held-for-sale and loan-sale phrases, and DEF 14A officer names. It reuses the SEC client and pacing. **It waits for the User-Agent contact (Q11).**
   - **Production searches** cover the SEC filer IDs (CIKs) of every bank in our candidate universe, **wherever it files from**. That universe includes banks headquartered outside our five states that have branches in our metros (PRD 4.1, A2). Mapping each bank to its filer, usually the holding company, is part of this story: through NIC's RSSD ID and the filer's name, confirmed by a principal when unsure.
   - **A separate discovery search** by filer state (our five states) finds banks not yet in the universe. Its hits go to a principal for review and never score directly.
3. **FDIC structure and failures.** **Built** (PRD E3-S5, E3-S6). `/history` mergers involving our banks, the failed-bank CSV, and the FDIC loan-sale page.
4. **Concentration screen.** **Built from FDIC BankFind fields** (PRD E3-S7), so it needs no FFIEC download; the UBPR cross-check is still to do. The guidance's definition was checked against its text on 2026-11-13. Computed quarterly from bulk Call Report items with the guidance's definitions and denominator, and cross-checked against UBPR Page 7B. A pressure signal for scoring.
5. **Colorado public trustees.** Adams weekly PDFs first, then Denver, Jefferson, Douglas and Broomfield.
6. **Maricopa.** Recorder search for notices of trustee's sale, joined to the assessor's commercial file.

**Phase 2: free accounts, opened in the firm's name.**

7. FRED, after the terms check: rate context (E4-S4) and the series in 2.5.
8. Enforcement orders: the OCC API with a key, plus the FDIC, Fed, Texas and California lists.
9. The six bankruptcy courts' RSS feeds, with PACER lookups to confirm. Requirements:
   - Polled **seven days a week**, with a gap between polls well under the shortest feed window (every 6 hours at most). This needs its own schedule: today's worker runs only on weekday afternoons (`.github/workflows/platform-worker.yml`), which would leave a gap of over 60 hours each weekend.
   - Entry IDs are stored, so overlapping polls never double-count an entry.
   - An alert fires when the last successful poll is older than the feed's window, because entries in that gap are lost.
10. NCUA credit unions, if in scope.
11. Maricopa assessor API token, if the downloads fall short.

**Phase 3: budget and permission decisions.**

12. A vendor for California and Nevada (PropertyRadar, or ATTOM by quote); SKLD if the free Colorado adapters fall short.
13. Texas notice adapters: little warning, but they show who is enforcing.
14. **Loan-sale listing watch** (PRD E16-S8, E19-S1): DebtX, FFN, Mission Capital and JLL Invest, each after its own spike reads its robots.txt and terms, or with the advisor's written permission (D11). RSS first where it exists (`/feed/` is likely, not checked). Listing events carry an optional `sellerDescription` that is never matched to a bank. Second in the listening ranking; a principal reads the sites meanwhile (section 3).
15. Headline feeds, only with written permission: GlobeNewswire first, if D7 is asked and granted.
16. A contact database.

**The listening additions** (`docs/listening-sources.md`, in the order of its ranking). They are numbered on from 16, so the steps above keep their numbers. **Each starts with its own spike** that reads the source's robots.txt and terms and dates them, the E2 pattern. The adapter is built only if they allow it, or a principal records a decision that they do. The ranking's manual items (5 and 9) are on the principal reading list (section 3), and its second item is step 14.

17. **Merger applications and regulator press** (ranked 1; PRD E18-S3, and a cross-check for E18-S2). Phase 1: free, no account. OCC CAS weekly, in place of the Weekly Bulletin; Fed H.2 weekly; the Fed orders and enforcement RSS; FDIC press RSS (GovDelivery); OCC news RSS. The spike also confirms the Fed feed filenames, and whether CAS has an export or a query URL (open questions 6 and 7). Each application is an event, `merger_pending`.
18. **State monthly bulletins** (ranked 3; E18-S3). Phase 1. California DFPI's Monthly Bulletin ("Bank Activity"), Colorado's "Financial Institution Activity" bulletin, and Texas DOB's corporate filings with the Finance Commission's Corporate Division report. Monthly HTML and PDF. The spike also asks whether the FDIC publishes its own applications list (open question 8).
19. **The forum event list** (ranked 4; E22-S2). No adapter and no polling: about 10–15 event pages in config, which the briefer reads when it researches an account (2.4). Each event site's terms are read when it is added to the list.
20. **Statewide notice sites** (ranked 6; E5, E22-S3). Phase 3. First a coverage spike of about a day on the California and Nevada sites, for Los Angeles, San Diego and Clark (open question 19). Built only if the terms allow it or the association agrees (D14). Alerts are read by hand meanwhile.
21. **Newsroom registry for banks with no EDGAR filer** (ranked 7). Phase 1, but only if open question 1 finds enough such banks. A principal-kept registry in the data folder (it names prospects): one row per bank with the newsroom URL, the IR platform, the RSS URL, the robots.txt verdict and the terms, each dated. RSS first; once a day, one conditional GET per host, at most about 300 hosts; headline, date, link and matched phrase only, never the full text. Plus the FDIC filing portal for §12(i) filers, once we know any are in our states.
22. **GDELT headline listener** (ranked 8). Phase 1: no key. Bank name plus phrase queries; the headline and URL only, to a principal's queue; the linked article is never fetched. The spike checks GDELT's terms at the source and whether its filters make about 300 banks a day practical (open question 10).
23. **A `signals log` command** (with ranked 9, Sales Navigator), only if D9 buys a seat: a principal records a signal against an institution, in their own words, audited. A possible later story; it never takes a person's name.
24. **Special-assets job postings** (next in line). Phase 3: a LinkUp feed, if D10's quote is taken. Meanwhile, the Greenhouse and Lever boards, only for universe banks found on them. Signals are modifiers only.

Each step is a story with acceptance criteria in the PRD's format, and each ships with its fake, field checks, change log and verify check.

## 6. Decisions needed

| # | Decision | Default meanwhile |
|---|---|---|
| D1 | Budget for county data: a CA/NV vendor at about $119–599 a month, and a quote from SKLD for Colorado (Q8) | Free sources only |
| D2 | Are credit unions sellers we want? | Not in scope |
| D3 | Which free accounts to open in the firm's name: FRED key, OCC API key, PACER account, Maricopa assessor token | None opened |
| D4 | Counsel's view on FRED's commercial-use terms, and on news-wire and headline feeds | FRED waits; feeds not used |
| D5 | The SEC User-Agent contact (Q11). It blocks the EDGAR full-text listener and live CMBS runs. | Waits |
| D6 | Whether to allow this development environment to reach the hosts in section 7 for live checks | Fakes in development; live checks on the worker |
| D7 | Ask GlobeNewswire (Notified) for written permission, or a media-partner feed, to monitor its M&A subject feed and its banking and real-estate industry feeds internally. Worth a letter only if many Tier A and B banks have no EDGAR filer (open questions 1 and 3) | Not asked; no wire is automated |
| D8 | A 3-week Commercial Mortgage Alert trial, or a CRE Direct subscription, read by a principal. Commercial Mortgage Alert is "upwards of $8,000" a year (Unconfirmed); CRE Direct's price was not found. During a trial, count how often the selling bank is named, in which metros (open question 11) | No trial; neither is read |
| D9 | One Sales Navigator Core seat, US$1,079.88 a year, in a principal's name, worked by hand under 2.4's rules | No seat |
| D10 | Ask LinkUp for a quote: employer-site postings filtered to the candidate universe and special-assets titles (open question 21) | No quote; no postings feed |
| D11 | Whether DebtX, FFN, Mission Capital and JLL Invest allow polite automated reading, or will give written permission or an RSS feed; and whether their buyer-registration agreements allow parsing their teaser emails (open questions 17 and 18) | A principal reads the sites; step 14 waits |
| D12 | Counsel, with D4: does "internal or personal" (Bisnow) or "reading of releases" (Business Wire) cover a principal reading a feed in a reader inside an internal tool? Does "personal, non-commercial" (Google, Seeking Alpha, Arizent) bar a principal's own reading for business? Do LinkedIn's Sales Solutions terms say anything about alert emails? (Open questions 5 and 16) | Read only on the publisher's own site, newsletter or email |
| D13 | Counsel: do the CCPA thresholds reach the firm, and does any new store (a manual signal log, a licensed feed) need notice at collection or the deletion workflow? (Open question 25) | No new store names a person; the signal log names the institution only |
| D14 | Ask the California and Nevada press associations for permission to read their notice sites automatically, after the coverage spike (open questions 19 and 20) | Alerts read by hand |

## 7. Hosts each adapter needs

| Adapter | Hosts |
|---|---|
| FDIC | api.fdic.gov, www.fdic.gov, orders.fdic.gov |
| Backtest (PRD E17) | api.fdic.gov, through the FDIC client; it reads the SEC and www.fdic.gov records only as their own adapters stored them |
| SEC | www.sec.gov, efts.sec.gov, data.sec.gov |
| FFIEC | cdr.ffiec.gov, www.ffiec.gov |
| FRED | api.stlouisfed.org |
| Federal Reserve | www.federalreserve.gov |
| OCC | api.occ.gov, apps.occ.gov |
| NCUA | ncua.gov |
| Bankruptcy courts | ecf.azb.uscourts.gov, ecf.cob.uscourts.gov, ecf.nvb.uscourts.gov, ecf.cacb.uscourts.gov, ecf.casb.uscourts.gov, ecf.txwb.uscourts.gov, pcl.uscourts.gov |
| Colorado trustees | denvergov.org, apps.adcogov.org, jeffco.us, douglas.co.us, foreclosure.broomfield.org |
| Maricopa | recorder.maricopa.gov, legacy.recorder.maricopa.gov, mcassessor.maricopa.gov |
| Other counties (index adapters) | travis.tx.publicsearch.us, countyclerk.traviscountytx.gov, arcc-acclaim.sdcounty.ca.gov, cr.occlerkrecorder.gov, recorderecomm.clarkcountynv.gov, acclaim.pinalcountyaz.gov |
| Merger applications and regulator press (step 17) | www.occ.gov, public.govdelivery.com, plus the Federal Reserve, OCC and FDIC hosts above. *Not yet allowed; requested when that adapter's spike starts.* |
| State bulletins (step 18) | dfpi.ca.gov, banking.colorado.gov, www.dob.texas.gov, dob.texas.gov, www.fc.texas.gov. *Not yet allowed; requested when that adapter's spike starts.* |
| Advisor listings (step 14) | debtx.com, www.ffncorp.com, www.missioncap.com, market.missioncap.com, invest.jll.com. *Not yet allowed; requested when that adapter's spike starts.* |
| Statewide notice sites (step 20) | www.capublicnotice.com, nevadapublicnotice.com, arizonapublicnotices.com. *Not yet allowed; requested when that adapter's spike starts.* |
| Newsroom registry (step 21) | efr.fdic.gov. Each bank's newsroom host is kept in the registry in the data folder, not here, because it names prospects. *Not yet allowed; requested when that adapter's spike starts.* |
| GDELT (step 22) | api.gdeltproject.org. *Not yet allowed; requested when that adapter's spike starts.* |
| Job postings (step 24) | boards-api.greenhouse.io, api.lever.co, and LinkUp's feed host once licensed. *Not yet allowed; requested when that adapter's spike starts.* |

The forum event list (step 19) needs no host here: the briefer reads those pages through the model's own web fetch tool, not the worker's network.
