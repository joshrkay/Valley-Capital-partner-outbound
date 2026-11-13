# Data sources: what we pull, what we listen for, and in what order

Desk research of November 13, 2026, for the getting-data side of the PRD (`docs/prd-signal-pipeline.md`). Every fact about an outside source in section 2 has one of these marks. The two built sources were checked live in the PRD (E3, E4-S1). Sections 3 to 7 are this plan's judgments, built on section 2.

- **Checked**: fetched or tested live.
- **Seen**: the official page's own text, read through search results. The page itself could not be fetched, because this development environment's network blocks most of these hosts.
- **Unconfirmed**: from memory or a secondary source.

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
| **Concentration screen** (FFIEC CDR bulk Call Reports) | The 2006 interagency guidance's screen. Unconfirmed, from memory; the spike confirms it against the guidance. Either test is enough: (a) construction and land loans at or above 100% of total risk-based capital; or (b) CRE at or above 300% of total risk-based capital **and** CRE grown 50% or more over 36 months. Computed from Call Report items (RC-C loans, RC-R capital), using the guidance's own definitions. | cdr.ffiec.gov/public/PWS/DownloadBulkData.aspx: ZIP, tab-delimited or XBRL. Seen. | None for bulk. Seen. | Quarterly | **High** |
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
| **Merger applications** | Applications before they close: Federal Reserve orders RSS, H.2 weekly, OCC Weekly Bulletin | federalreserve.gov/feeds/press_orders.xml. Seen. | None | Weekly | **High** |
| FFIEC NIC | Holding-company ownership and merger history, keyed by RSSD ID. Links banks across names and charters. | ffiec.gov/npw/FinancialReport/DataDownload: CSV or XML. Seen. | None | Unconfirmed | Med–High |
| **Enforcement orders** | Regulator orders against a bank, often about CRE concentration, credit administration or capital | OCC: api.occ.gov/EnforcementActions/list, needs a free key (Seen). FDIC: orders.fdic.gov search, monthly, no API (Seen). Fed: enforcement search and RSS (Seen). Texas Department of Banking and California DFPI: stable list pages (Seen). Arizona, Nevada, Colorado: little or nothing for banks (Seen). | OCC key. The rest are HTML or PDF. | Monthly | **High** (OCC, FDIC, Fed); Med (TX, CA) |
| FRED | Market context: rates, CRE delinquency and prices, lending standards (series in 2.5) | api.stlouisfed.org | Free key, 120 requests a minute. **The default terms are non-commercial; commercial use has extra restrictions.** Seen. Needs a legal check (D4). | Daily to quarterly | **High**, after the check |

### 2.3 The assets

**The foreclosure trail differs by state.** The warning time decides how useful a county source is:

| State | What is recorded or posted, and where | Warning before sale | Receiverships |
|---|---|---|---|
| Texas | Notice of trustee's sale, filed with the county clerk and posted on the county's website (Prop. Code 51.002). Seen. | **About 21 days.** Seen. | Used, mostly with CMBS loans. Unconfirmed. |
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
| Loan-sale listings | Non-performing loans and pools actually for sale, with metro and size; the seller is usually unnamed | JLL Invest public pages; First Financial Network bank and FDIC sale notices; FDIC loan sales. Seen. | Free to view. NDA or registration for the offering memo. Terms not found. | **High** for deal flow: poll a few times a week, gently |
| KBRA, Morningstar DBRS, Trepp, CRED iQ | Commentary that names troubled CMBS loans and servicers | Public research pages and releases. Seen. | Some need free registration | Med: mostly overlaps our CMBS data |
| UCC filings (state) | UCC-3 assignments can reveal a loan sale | Free search in California and Colorado; $1 a search and a $65 daily file in Texas; Nevada bulk paid. Seen. | Varies | Low (later) |

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
- **Contact databases**, for addresses: Apollo (about $49–119 a user a month), Clay (free, $185 or $495 a month), ZoomInfo (about $15,000 a year and up). All Unconfirmed: get quotes. This is a budget decision (Q8).
- Cold email to business addresses still falls under CAN-SPAM. The FTC says there is "no exception for business-to-business email". Seen.

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
| LinkedIn | Its terms forbid bots and scraping. Seen. Job-data vendors that resell LinkedIn data pass the risk on. |
| LoopNet and Ten-X | The terms bar building databases from the product. Seen. |
| Google News RSS | Personal, non-commercial use only. Unconfirmed. |
| CourtListener's free tier | Internal business tools count as commercial use. Seen. |
| News-wire RSS (Business Wire, PR Newswire, GlobeNewswire) | **On hold.** Business Wire allows retrieving RSS but prohibits "commercial activities". Seen. The others' terms were not found. EDGAR carries the same public filers' releases as 8-K exhibits. |
| Trade headlines (Bisnow, Commercial Observer, The Real Deal, GlobeSt) | On hold for terms. Bisnow has metro feeds for Denver, LA and Austin. Seen. |
| Job postings for special-assets roles | Later, if ever. Greenhouse's public board API needs no key (Seen), but most banks use Workday, whose endpoints are undocumented. |

## 3. What we listen for

| Signal | Source | Pulled | Attaches to | Lead time |
|---|---|---|---|---|
| CMBS loan marked for note sale (workout code 5) | SEC CMBS | Monthly | Special servicer | The sale is planned: act now |
| CMBS loan moved to special servicing, or maturing within the window | SEC CMBS | Monthly | Special servicer | Months |
| Noncurrent or past-due CRE rising, first charge-offs | FDIC | Quarterly | Bank | Quarters (**built**) |
| Bank meets the concentration screen (construction 100%, or CRE 300% with 50% growth, of total risk-based capital) | Call Reports (UBPR as a cross-check) | Quarterly | Bank | Quarters: pressure from examiners |
| Enforcement order | OCC, FDIC, Fed, state lists | Monthly | Bank | Months |
| Merger application or approval | Fed RSS, H.2, OCC bulletin, FDIC history | Weekly | Acquirer, after close | 1–2 quarters after close |
| Bank failure | FDIC failed-bank CSV, loan-sale page | Daily | The FDIC as seller | Weeks: sealed bids |
| Loans moved to held for sale, loan sale disclosed, "repositioning" | EDGAR full-text search | Daily | That bank, and peers with similar books | Often late for that bank (the sale is under way); a lead on its next sale and on peers |
| Commercial notice of default, election and demand, or trustee's sale | County adapters, vendors | Daily or weekly | The enforcing lender (context for a principal) | 21 days (TX) to 125 days (CO) |
| Receivership petition on commercial property | State court dockets | Daily | The lender | Weeks to months |
| Chapter 11 of a real estate entity in our districts | Bankruptcy RSS, then PACER | Every few hours | The secured lender named in the petition | Months |
| Loan or pool listed for sale in our metros | JLL Invest, FFN, FDIC | A few times a week | Principal context (seller usually unnamed) | Days to weeks: bid dates |
| Rates move, lending standards tighten | FRED | Daily / quarterly | Context on cards only | — |

Every signal keeps the PRD's rule: it shapes **who** and **when**, never the text of a message.

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

1. **Fix failure detection.** Do not rely on `/failures` alone. Cross-check `/institutions` (inactive date) and the FDIC's failed-bank CSV, and add a verify check that flags a gap. Small.
2. **EDGAR full-text listener.** Daily saved searches for 8-K Items 2.01 and 2.06, held-for-sale and loan-sale phrases, and DEF 14A officer names. It reuses the SEC client and pacing. **It waits for the User-Agent contact (Q11).**
   - **Production searches** cover the SEC filer IDs (CIKs) of every bank in our candidate universe, **wherever it files from**. That universe includes banks headquartered outside our five states that have branches in our metros (PRD 4.1, A2). Mapping each bank to its filer, usually the holding company, is part of this story: through NIC's RSSD ID and the filer's name, confirmed by a principal when unsure.
   - **A separate discovery search** by filer state (our five states) finds banks not yet in the universe. Its hits go to a principal for review and never score directly.
3. **FDIC structure and failures.** `/history` mergers involving our banks, the failed-bank CSV, and the FDIC loan-sale page.
4. **Concentration screen.** Computed quarterly from bulk Call Report items with the guidance's definitions and denominator, and cross-checked against UBPR Page 7B. A pressure signal for scoring.
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
14. Loan-sale listing watch (JLL Invest, FFN).
15. Headline feeds, only with written permission.
16. A contact database.

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

## 7. Hosts each adapter needs

| Adapter | Hosts |
|---|---|
| FDIC | api.fdic.gov, www.fdic.gov, orders.fdic.gov |
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
