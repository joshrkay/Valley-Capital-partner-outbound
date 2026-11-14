# Listening sources: press, news, deals and people

**Research note of 2026-11-14.** Two desk-research reports on where the pipeline could listen next, kept together:

- **Part A, press releases and news:** wires, bank newsrooms and investor-relations (IR) platforms, government press feeds, news aggregators and APIs, trade press, and earnings calls.
- **Part B, deals, people and notices:** LinkedIn, loan-sale advisors and note marketplaces, job postings, public-notice sites, conference and association rosters, X, and the personal-data rules.

Their findings are folded into `docs/data-sources.md`, and into the PRD stories they change (see "Where the findings went", below).

**Method: search excerpts only. No primary page has been read yet.** This environment blocks direct page fetches, so every fact came through web-search excerpts, and none is "Seen on page". Before any adapter is built, its own spike reads the primary pages listed in A.7 and B.7, as E2 requires.

**No bank and no private person is named.** Examples are described by pattern. Vendors, platforms, advisors, publishers, regulators and associations are named.

**Tags.** Every fact carries one:

| Tag | Meaning |
|---|---|
| **[P]** Seen on page | Read on the publisher's own page. **No fact in this note has this tag.** |
| **[E]** Seen in a search excerpt | A web search of the named page returned it. Quoted wording is the excerpt's: it may be partial, or from an old copy of the page. Where the excerpt showed how old the indexed copy was, the note says so. "[E, third-party]" (Part A) and "[E, secondary]" (Part B) mean the excerpt came from a page other than the publisher's. |
| **[I]** Inference | Reasoning from tagged facts. |
| **[U]** Unconfirmed | From memory, from a weak secondary source, not found in the pass, or not settled by the search. |

`docs/data-sources.md` marks an [E] fact **Seen** when the excerpt was of the official page, and **Unconfirmed** when it was of a secondary page. No tag was upgraded on the way.

**Verdicts.** Both parts use the verdicts defined in B.0: Build, Licensed only, Manual, Not used. "Build" always means "Build, gated on the terms check": a source is automated only when its terms allow it, or a principal has recorded a decision that they do (`docs/data-sources.md`, section 1).

## Summary

**What the two passes found:**

1. **The OCC Weekly Bulletin is gone.** The Corporate Applications Search (CAS, apps.occ.gov/CAS/) replaced it "effective December 19, 2025". Applications appear there after a "five-day delay" [E]. (A.3)
2. **State bulletins list the state-chartered banks' applications.** California DFPI's Monthly Bulletin has a "Bank Activity" section. Colorado publishes a monthly "Financial Institution Activity" bulletin. The Texas Department of Banking lists corporate filings, and the Finance Commission's packet carries a Corporate Division report [E]. A state nonmember bank's merger never shows in OCC CAS, and shows in Fed H.2 only when a holding-company application is needed [I]. (A.3)
3. **EDGAR misses a class of banks.** 104 banks traded on OTCQX in Q2 2026 [E]. OTC Pink banks are not counted [U]. Banks registered under Exchange Act §12(i) file with their regulator, and the FDIC "does not participate in the SEC's EDGAR" [E]. So the claim that "EDGAR carries the same public filers' releases" holds for SEC filers only. (A.2, A.6)
4. **The wires bar automation.** PR Newswire's terms ban robots and "data mine" [E]. Business Wire limits use to "retrieving RSS feeds, and the reading of releases" [E]. GlobeNewswire's website terms were not found [U]. GlobeNewswire is integrated with OTC Markets' disclosure service [E], so it is the one wire worth asking [I]. (A.1)
5. **The aggregator questions are settled.** Bing Search APIs were retired on August 11, 2025 [E]. NewsAPI.org's free plan cannot be used in production, "including internally" [E]. Google News RSS is for "personal, non-commercial use" [E, third-party quotes]. GDELT is the only aggregator whose terms plainly allow commercial use without a fee [E, secondary quote]. (A.4)
6. **Trade press is for a principal to read.** Bisnow, Connect CRE and PR Newswire bar automated access explicitly; several publishers allow internal or personal reading [E]. (A.5)
7. **LinkedIn has no automated path for a third party.** The User Agreement, effective November 3, 2025, bars scraping, bots, and copying information "obtained from the Services" [E]. No official API lets an outside firm read other people's posts or job changes [I]. *hiQ v. LinkedIn* ended on contract, in a consent judgment of December 8, 2022 [E]. Sales Navigator Core, at US$1,079.88 a year [E], suits only a principal reading alerts and logging signals by hand [I]. (B.1)
8. **Loan-sale advisors describe the seller and rarely name it.** In small samples, DebtX named it in 0 of 10 closed deals, JLL Invest in 0 of 5 listings, and FFN in 2 of 4 bank-seller sales [E]. Their listing titles carry the metro and size [E]. CRE Direct named both the bank seller and the advisor in at least one 2026 loan offering [E]. (B.2)
9. **Job postings are a weak timing signal**, a modifier and never a trigger [I]. In a sample, banks' special-assets postings were on Paylocity, Workable and iCIMS, not Greenhouse or Lever [E]. LinkUp says it indexes employer websites only [E]. Revelio, Coresignal and Lightcast's profile product pass the LinkedIn risk on [I]. (B.3)
10. **Statewide public-notice sites exist in all five states** [E]. They are not earlier than the county recorders [I], but they may give the lender, trustee and counsel for Los Angeles, San Diego and Clark, whose document images are not online [I]. Texas trustee's sale notices are not published in newspapers [E]. (B.4)
11. **Conference speaker pages are public, and attendee lists are not** [E]. IMN's Bank Special Assets events are the best public forum source for E22 [I]. (B.5)
12. **X is pay-per-use**, about $0.005 per post read [E, secondary], and its Developer Agreement restricts "tracking, alerting, or monitoring" [E]. Not used. (B.6)

## The ranked additions

Each report ranked its own top five by value against effort and legal risk (A.8, B.8). They are merged here on the same yardstick. Part A's fifth (a principal's reading list, led by a Commercial Mortgage Alert trial) and Part B's fifth (a trade-press loan-offering trial) are the same item, so the ten become nine. These are recommendations.

| Rank | Addition | From | Verdict | Why this rank |
|---|---|---|---|---|
| 1 | **Federal applications and press feeds**: OCC CAS (in place of the Weekly Bulletin), Fed H.2 weekly, the Fed orders and enforcement RSS, FDIC press RSS (GovDelivery), OCC news RSS | A, rank 1 | Build (gated) | The earliest merger signal we can get, plus dated enforcement releases. Free and public domain (the Fed's statement [E]; the others [I]). Low effort: RSS and one weekly query. It fixes a stale source, and it is already a story (E18-S3). Nothing in it needs money or anyone's permission. |
| 2 | **Advisor listing watch and buyer-list registration**: DebtX, FFN, Mission Capital and JLL Invest; Crexi, RealINSIGHT, Xchange.Loans and Revere by a principal's saved search | B, rank 1 | Build (gated) for the four advisors; Manual for the marketplaces | The highest value in either report: live supply in our metros, with size and bid dates, the advisor as a mandate, and now and then a named seller. It is second only because no advisor's terms or robots.txt could be read. It stays Manual until they are (open questions 17 and 18). |
| 3 | **State monthly application bulletins**: California DFPI ("Bank Activity"), Colorado ("Financial Institution Activity"), Texas DOB corporate filings and the Finance Commission's Corporate Division report | A, rank 2 | Build (gated) | It completes rank 1 for state nonmember banks, which CAS never shows and H.2 often misses [I]. Government sites, so low legal risk. It sits below rank 2 because the gap it fills is inferred, and monthly HTML and PDF parsing costs more than RSS. |
| 4 | **Forum speaker pages into the briefer**: a principal-kept list of about 10–15 events (IMN Bank Special Assets Texas, East and West; IMN Distressed CRE; CREFC; CBA Lending & Credit; RMA chapter conferences in TX, AZ and CO) | B, rank 2 | No adapter: the briefer reads the listed pages | The cheapest addition: no adapter, nothing polls, and only public pages under E22-S2's rules. It is the best public source for the person question, through E22's forum routes [I]. It sits below the first three because it shapes the route, not the timing. Attendee lists stay out. |
| 5 | **Seller-naming trade press on trial, and the principal reading list**: Commercial Mortgage Alert's 3-week trial or CRE Direct's loan offerings; then Bisnow metro newsletters, Connect CRE's "Return to Lender", Banking Dive, Google Alerts by email for Tier A names, and Business Wire's banking feed in a reader | A, rank 5, and B, rank 5 | Manual; Licensed only for any automated use | Trade press is the one source seen that names both the bank seller and the advisor [E], usually before any release [U]. Both reports ranked it fifth: it costs a subscription (Commercial Mortgage Alert is "upwards of $8,000" [E, secondary]) and reading time, and the terms keep it out of the pipeline. |
| 6 | **Statewide public-notice alerts in AZ, NV and CA, then a coverage spike** | B, rank 3 | Manual; Build only with permission | It may give the lender, trustee and counsel names that `docs/data-sources.md` 2.3 says need a vendor or ordered copies in Los Angeles, San Diego and Clark, and so cut D1's spend. It sits below rank 5 because it is not earlier than the recorders, California's coverage is unknown, and whether the notices name the beneficiary is [U]. |
| 7 | **Newsroom registry for banks with no EDGAR filer**: a principal-kept URL per Tier A and B bank, RSS first, one conditional GET a day, headlines only; plus the FDIC portal for §12(i) filers | A, rank 3 | Build (gated), bounded | It closes the largest gap the EDGAR listener leaves, but only if such banks are many. Its value hangs on open question 1, and its effort is medium (a manual registry and a small adapter). Part A ranked it third. Here it waits behind additions that pay off whatever that count turns out to be. |
| 8 | **GDELT DOC 2.0 headline listener**: a bank name plus a phrase, URL and title only, to a principal's queue | A, rank 4 | Build (gated) | The only aggregator with clear commercial terms at no cost [E, secondary], and little effort. Its value is medium: headlines only, noisy, and the linked articles are never fetched. |
| 9 | **Sales Navigator Core, worked by hand**: one seat (about $1,080 a year), alerts read by a principal, signals logged by hand against the institution, any person corroborated from a public, non-LinkedIn source | B, rank 4 | Manual | Medium value: job changes and senior hires at target banks, months before a sale. It is last because it costs a seat, gives the pipeline only hand-logged institution signals, and is the most rule-bound: its risk is low only while nothing is automated. |

**Next in line, not ranked:** a LinkUp quote for employer-site job postings (B.8, open question 21), and a letter asking Notified (GlobeNewswire) for written permission, once open question 1 shows enough banks with no EDGAR filer (A.1, A.8).

**Where the findings went.**

- `docs/data-sources.md`: sections 2.2 to 2.6 (sources and corrections), section 3 (new signal rows, and a principal reading list), section 5 (step 14 widened, and steps 17 to 24), section 6 (decisions D7 to D14) and section 7 (hosts, not yet allowed).
- `docs/prd-next-five.md`: E18-S3's sources and the merger-application hosts, and E19-S1's feeders.
- `docs/prd-signal-pipeline.md`: E16-S8's feeders. It does not cite the OCC Weekly Bulletin anywhere.

---

## Part A. Press releases and news

Desk research of 2026-11-14. It extends `docs/data-sources.md` §2.6 ("Not used, and why") and §3 ("What we listen for") for six kinds of source: wire services, bank newsrooms and investor-relations (IR) platforms, government press feeds, news aggregators and APIs, trade press, and earnings-call transcripts. No individual bank is named; examples are described by pattern.

### A.0 How to read this part

The tags are in the header of this note.

**Limits of this pass.**
- Direct fetches were blocked: WebFetch failed with `ENOTFOUND` for `www.businesswire.com` and `www.federalreserve.gov`, and I stopped there, as the tool instructs. Everything below came through WebSearch, so nothing is "Seen on page". The repo doc's "Seen" mark is the same level as **[E]** here.
- The search tool's own user agent was refused for three domains: `trepp.com`, `bizjournals.com` and `acbj.com`. [E: the tool returned "not accessible to our user agent".] This suggests those publishers block AI crawlers in robots.txt [I].
- The shared 200-search limit ran out before I could check Motley Fool's terms, GlobeNewswire's website terms, a few feed filenames and robots.txt rules. Each gap is marked [U] and listed in the open questions at the end of this note.
- I followed no instruction found inside a search result.

### Part A summary

Facts:
1. **The OCC Weekly Bulletin is gone.** The OCC's page says that "effective December 19, 2025, the Weekly Bulletin has been replaced by the Corporate Applications Search (CAS) tool, which provides the same information" (apps.occ.gov/CAS/). Applications appear there after a "five-day delay". [E] `docs/data-sources.md` §2.2 and §3 still cite the bulletin.
2. **PR Newswire's terms ban robots.** The terms bar using "any robot, spider, site search/retrieval application, or other manual or automatic device or process to access, search, download, retrieve, index or "data mine" any content or data from the Site". [E, indexed copy about 3 years old] Business Wire limits site use to "retrieving RSS feeds, and the reading of releases" and forbids "any other manner" without written consent. [E] GlobeNewswire's website terms were not found. [U]
3. **EDGAR misses a class of banks.** In the second quarter of 2026, 104 banks traded on OTCQX [E, issuer release of 2026-10-14]. Many of them deregistered from the SEC under the JOBS Act and publish financials and news through OTC Markets instead [E, OTC Markets case study]. Banks that register securities at the bank level (not the holding company) file with their banking regulator under Exchange Act §12(i). The FDIC "does not participate in the SEC's EDGAR" [E], and about 15 banks were FDIC filers in 2018 and 2022 [E]. **The repo's claim that "EDGAR carries the same public filers' releases" holds only for SEC filers.**
4. **GlobeNewswire is wired into OTC Markets.** It integrates with OTC Markets' Disclosure & News Service for OTCQX companies [E, older announcement], so it is probably the main wire for non-SEC OTC banks [I].
5. **Federal works are public domain; state works vary.** The Federal Reserve Board's own words: "Unless otherwise indicated, information on Board's website is in the public domain and may be copied and distributed without permission." [E] The Arizona State Library says Arizona state works are **not** in the public domain [E]. Other state sites give no single rule [E].
6. **Three aggregator questions are settled.**
   - Bing Search APIs, news included, were retired on August 11, 2025 [E].
   - NewsAPI.org's free plan cannot be used "in a staging or production environment (including internally)". Business costs $449 a month [E].
   - Google News RSS carries a notice limiting it to "a personal feed reader for personal, non-commercial use" [E, third-party quotes only].
7. **GDELT is the only aggregator whose terms plainly allow commercial use without a fee.** It requires a citation [E, secondary quote of its terms].
8. **Trade-press terms mostly bar automated access.** Bisnow, Connect CRE and PR Newswire say so explicitly [E]. Several allow internal or personal reading [E]. So trade press is principal-read material, not an adapter [I].

Recommendations (justified in each section, and ranked in A.8):
- Build the federal application and press feeds now: OCC CAS, Fed H.2 and the Fed RSS feeds, FDIC press RSS and OCC news RSS.
- Build three state monthly bulletins: California, Colorado and Texas.
- Keep a small, principal-kept newsroom registry, only for universe banks that do not file on EDGAR.
- Add GDELT as a headline-only discovery feed.
- Put everything else on a principal's reading list, starting with a trial of Commercial Mortgage Alert.
- Ask one wire, GlobeNewswire (Notified), for written permission.

### Corrections to `docs/data-sources.md`

The research pass edited nothing. These corrections were folded into `docs/data-sources.md` with this note, on 2026-11-14, so "still cite" below describes the doc before that.

| Where | Today | Finding |
|---|---|---|
| §2.2 "Merger applications", §3 | "OCC Weekly Bulletin" | Replaced by CAS on 2025-12-19 [E]. Use apps.occ.gov/CAS/ (already in §7's host list as apps.occ.gov). |
| §2.6 Google News RSS | "Unconfirmed" | The feed's own notice says "personal feed reader for personal, non-commercial use. Any other use of the feed is expressly prohibited." [E, third-party quotes; still not seen on a Google page] |
| §2.6 News-wire RSS | "The others' terms were not found." | PR Newswire: robot/spider/"data mine" ban [E]. Business Wire's "commercial activities" wording was **not** re-found in this pass [U]; its "limited to ... retrieving RSS feeds, and the reading of releases" clause was [E]. |
| §2.6 News-wire RSS | "EDGAR carries the same public filers' releases" | True for SEC filers only. OTCQX banks (104 in Q2 2026 [E]), OTC Pink banks [U count] and §12(i) banks [E] are not on EDGAR. |
| §2.2 Enforcement, state lists | Arizona, Nevada, Colorado: "little or nothing" | Colorado publishes a monthly "Financial Institution Activity" bulletin of approved applications [E]. It covers applications, not enforcement, but it is a listening source. |

---

### A.1 Wire services

| Source | What it gives | Access | Terms (quoted, tagged) | Cost | Signal and attaches to | Verdict |
|---|---|---|---|---|---|---|
| **Business Wire** | Issuer-paid releases: issuer named, date, dateline city. A loan or pool size appears only if the issuer states it [I]. | **RSS (headlines):** "a simple list of news release headlines that, when clicked, take the viewer to BusinessWire.com" [E, businesswire.com/help/feed-options]. Industry feeds include "Banking", "Commercial Building & Real Estate" and "REIT" at `feed.businesswire.com/rss/home/?rss=<code>`; the banking code is `G1QFDERJXkJeGVpSWw==` [E, third-party dataset; live status U]. **No state feeds** found; the nearest is "Public Policy/Government \| State/Local" [E]. **Licensed:** full-text Atom, NX, FTP/SFTP NewsML, and "over 250 subject and industry keyword options" [E]. | "Use of the Business Wire Site is limited to submission of news releases for distribution via Business Wire Connect, retrieving RSS feeds, and the reading of releases, marketing, and other materials." "Except as specifically permitted in this Agreement, the Business Wire Agreement or by express written consent of Business Wire, You may not use the Site or the material on the Site in any other manner." Business Wire "reserves the right to make changes to these Terms of Use at any time". [E, https://www.businesswire.com/terms-of-use; no "last updated" date in the excerpt] | Feed licensing is sold as "Business Wire Newsfeed Licensing Options" for media partners [E]. No price published [E: none found]. | **Event:** merger, capital raise, loan sale or earnings release. **Attaches to** the issuer, usually the holding company. **Lead time:** same day as the 8-K [I]. **Overlap:** almost total with EDGAR for SEC filers [I]. | **Not used** for automation. **Manual** is allowed: a principal reading the Banking feed fits "retrieving RSS feeds, and the reading of releases" [I; counsel to confirm]. Ask for written consent only if the count in open question 1 justifies it. |
| **PR Newswire** (Cision) | Same as Business Wire | **RSS index:** https://www.prnewswire.com/rss/, with subcategories "Banking & Financial Services" and "Real Estate" [E]. Example feed: `https://www.prnewswire.com/rss/financial-services-latest-news.rss` [E, third-party]. "Full-text XML and HTML news feeds for websites" [E]. **Partner API:** returns "XML, JSON, Atom and Full-Text RSS", after registering [E, Cision partner pages]. Usage PDF: `prnewswire.com/content/dam/prnewswire/contactUs/Content+API+Services+Usage+Documentation_PRN.pdf` [E, title only]. | **Terms of use** bar users to "use any robot, spider, site search/retrieval application, or other manual or automatic device or process to access, search, download, retrieve, index or "data mine" any content or data from the Site" [E, prnewswire.com/terms-of-use/, indexed copy about 3 years old; no date seen]. **Member Center:** "all other uses of PR Newswire's daily news release file, including but not limited to any electronic redistribution or database storage and retrieval require express written consent" [E, portal.prnewswire.com/Popup/facts.aspx, undated]. **Contrary evidence:** PR Newswire's own release of October/November 2025 says its "robots.txt file is open, intentionally allowing legitimate AI and search bots to crawl, scan, and index all public content hosted on its platform" [E]. That is a press statement, not a licence or a change to the terms [I]. A "personal, noncommercial use" clause showed in one excerpt; a second search attributed that wording to PRWeb [E, conflicting], so [U]. | Partner API: "Pricing on request" [E, third-party marketplace] | Same as Business Wire | **Licensed only** (the Content API under a Cision partner agreement). **Not used** meanwhile. |
| **GlobeNewswire** (Notified) | Same as Business Wire. **Also the wire integrated with OTC Markets' Disclosure & News Service:** available to "OTCQX companies and OTCQB and OTC Pink companies that are customers of GlobeNewswire and the service" [E, older Nasdaq and OTC announcement]. So it likely carries many non-SEC bank releases [I]. | **RSS:** https://www.globenewswire.com/rss/list, organized as "RSS by Subject · RSS by Industry and RSS by Location" [E]. Feed patterns: `/RssFeed/subjectcode/27-Mergers%20And%20Acquisitions/feedTitle/GlobeNewswire%20-%20Mergers%20And%20Acquisitions` and `/RssFeed/industry/<id>-<name>/feedTitle/...` [E, third-party]. Organization feeds take a base64 organization ID [E, third-party]. About 77 subject and 176 industry feeds [E, third-party]. "Curated feeds are available by subject, location, industry, stock exchange, or custom delivery requirement" [E]. Reader accounts can build custom RSS [E]. Whether location goes down to US states: [U]. | **Website terms of use: not found** [U]. The Notified Terms and Conditions (portal.notified.com/terms-conditions/en) are a customer contract that licenses Intrado to distribute releases [E]. The widget guidelines say GlobeNewswire "reserves the right to block or limit access to our feeds for any reason" [E]. | A newsfeed fact sheet says the feed is "available at no additional cost to networks receiving public company news" [E, undated PDF, globenewswire.com/Home/Learning-Support/Knowledge-Base/GlobeNewswire-Newsfeed-Fact-Sheet-North-America.pdf]. Whether a non-media firm qualifies: [U]. | Same events, **plus OTC banks** that are not on EDGAR [I]. **Lead time:** same day. **Overlap with EDGAR:** low for OTC banks [I]. | **Licensed only.** Ask Notified for written permission, or a media-partner feed, for internal monitoring of the M&A subject feed and the banking and real-estate industry feeds. It is the one wire worth asking. **Not used** until then. |
| **ACCESS Newswire** (Accesswire) | Small-cap and microcap releases [I]. The company is "ACCESS Newswire Inc. (f/k/a Issuer Direct Corporation)" [E] and has combined with Newswire.com [E]. | Newsroom at https://newsroom.accessnewswire.com/ and `/newsroom/en/<category>/...` [E]. RSS feed URLs not found [U]. | The Terms of Service (https://www.accessnewswire.com/terms-of-service, "last updated August 1, 2025") are a contract "by and between ACCESS Newswire Inc. ... and the Customer identified in the applicable Sales Order" [E]. No visitor, robots or RSS clause seen [U]. | n/a | Same; share of non-SEC banks that use it: [U] | **Not used.** Revisit if the newsroom check in open question 2 shows our non-SEC banks use it. |
| **EIN Presswire** (Newsmatics) | Paid releases, often from low-cost issuers, plus EIN Newsdesk's aggregation of other outlets' news by topic and place [E, I]. Noisy, and much of the content is other publishers' [I]. | **RSS directory:** https://www.einnews.com/all_rss, with "Real Estate & Property Management" and every US state [E]. A per-state banking list at https://www.einnews.com/all_rss/banking-finance-investment [E]. Subdomains banking.einnews.com and realestate.einnews.com [E]. | The site footer says the Terms & Conditions were "last updated on September 30, 2025" [E, einpresswire.com/terms and /legal/terms]. An older user agreement (indexed copy about 1,230 days old): "Don't interfere with our Services or try to access them using a method other than the interface and the instructions that we provide." "You may not use content from our Services unless you obtain permission from its owner or are otherwise permitted by law." [E] The paid Newsdesk lists "Use of our RSS Feeds" as a feature [E]. | Release plans from $149 a month [E, third-party, 2026-09]. Newsdesk monitoring price not found [U]. | Weak. Content rights often belong to third parties [I]. | **Not used** |
| **Newsfile** (TMX Newsfile) | Releases, mostly from Canadian and US small caps [I]. Little US bank coverage [U]. | Each company page: "the last 10 releases are available for public consumption in RSS format. Full text RSS feeds which can be categorized by type and industry are available upon request." [E] | The website terms (newsfilecorp.com/TermsOfUse.php, indexed copy about 433 days old) license viewing and printing "for non-commercial or personal use only"; other uses need "prior written consent" [E]. | Not found | Weak | **Not used** |

**Facts.** No wire publishes a price for a feed [E]. Only GlobeNewswire states that a feed costs nothing, in an undated sheet [E]. No wire offered US-state RSS in what I could see. GlobeNewswire's "location" feeds are the nearest, at an unknown granularity [U].

**Inferences.** For SEC-registered banks, a wire release duplicates the 8-K EX-99 that our EDGAR listener already reads. The September 2026 example in A.2 was on EDGAR too [E]. A wire adds value only for banks that do not file on EDGAR. Those banks lean toward GlobeNewswire because of the OTC integration, and possibly ACCESS Newswire [I, U].

**Recommendation.** Settle open question 1 first: how many Tier A and B banks are not on EDGAR. If there are more than a handful, ask GlobeNewswire for permission. Otherwise the newsroom registry (A.2) covers them with less legal surface.

---

### A.2 Bank newsrooms and IR platforms

| Source | What it gives | Access | Terms (quoted, tagged) | Cost | Signal and attaches to | Verdict |
|---|---|---|---|---|---|---|
| **The bank's own website news page** | The release itself: the seller is named (it is the bank), dated, often with the dollar size [I]. For a private or OTC bank this may be the **only** place the news appears, besides local press [I]. | HTML on the bank's site, usually under "About", "News" or "Investor relations". Built on assorted bank-website platforms [U]. RSS is sometimes offered [U]. | **The bank's own site terms govern** [I]. Sampled robots.txt rules: **none read** in this pass [U]. | Free | Merger, branch sale, capital raise, loan sale, executive change → that bank. **Lead time:** same day. **Overlap with EDGAR:** none for non-SEC banks. | **Build, bounded** (see the approach below), for non-EDGAR banks only |
| **Q4** (Q4 Inc.) hosted IR sites | Press releases, SEC-filing lists, events and webcasts, email alerts [E] | Q4 sites carry an RSS page, for example `/investor-resources/rss/default.aspx` or `/rss-feeds/`, and a "Subscribe to RSS feed" link on the press-release page [E, examples from non-bank Q4 sites]. Q4's own tools page lists a "regulatory news feed" that passes IR news through from the chosen newswire [E, q4inc.com/products/tools-feeds]. | The bank's site terms [I]. Q4 markets the platform as "AI-ready", with "automatic tagging and structured data for press releases, filings and leadership bios" [E, q4inc.com/platform/platform-features/investor-relations-websites]. robots.txt: [U]. | Free to read | Same as above | **Build** (RSS first) for registry banks that use it |
| **Notified IR** (GlobeNewswire IR; sites on `*.gcs-web.com`) | Same | An RSS page at `/rss-feeds` or `/node/5951`, with feeds for "news releases, SEC filings, and calendar events", and an "Email Alerts" link [E, several gcs-web subdomains, banks among them]. The feeds are raw XML [E]. | The bank's site terms [I]; robots.txt [U] | Free to read | Same | **Build** (RSS first) |
| **S&P Global Market Intelligence** IR services | A US-banks brochure lists "Investor relations services" [E]. Whether hosted bank IR websites (the former SNL product) still exist, and their URL pattern: [U]. | [U] | [U] | n/a | Same | **Manual** check when a registry bank uses it |
| **Equisolve** | "Our core products are IR Websites, ETF Websites, Corporate Websites, and Newsrooms/Media Centers." [E] | RSS not mentioned in what I saw [U]; email alerts [U] | Bank's site terms [I] | Free to read | Same | **Manual** until a feed is confirmed |
| **B2i Technologies** (not in the brief; a small-cap IR vendor) | Automates "SEC filings, press releases, stock information, and investor email alerts" [E]. Lists "RSS (Press Releases and Multimedia)" among its features [E]. Delivered through a JavaScript API or WordPress plugin [E]. | RSS [E]; email alerts [E] | Bank's site terms [I] | Free to read | Same | **Build** (RSS) where present |
| **OTC Markets company pages** | News and financial reports of OTC-traded banks, through the OTC Disclosure & News Service [E]. 104 banks traded on OTCQX in Q2 2026, with an average market capitalization of $166M [E]. OTCQX banks must post annual audited and quarterly financial statements on OTC Markets' site [E]. | otcmarkets.com company pages. GlobeNewswire integration; PR Newswire through OTCIQ [E]. | Feed recipients are licensees: "Firms receiving the Information over a data feed, including but not limited to internal and external distribution, ... non-display data, and all external use cases are considered Distributors" and must sign a distribution agreement [E, OTC Markets Market Data Policies v4.0, April 2021]. The order form lists **"RSS feed" licenses**, each needing an addendum [E, 2022 form]. OTC Markets says its public website data is "vulnerable to unauthorized scraping" and that it "vigorously defend[s]" its rights [E, annual report]. Website terms text: [U]. | Fee schedule at otcmarkets.com/market-data/fee-schedule, not read [U] | Releases and financials of non-SEC banks | **Licensed only** for a feed. **Manual** for a principal to read a Tier A bank's OTC page. |
| **FDIC electronic filing research portal** (§12(i) banks) | Exchange Act filings of FDIC-supervised banks with registered securities (8-K equivalents) [E]. About 15 banks (2018, January 2022) [E]. | https://efr.fdic.gov/fcxweb/efr/index.html [E, 2011 FIL; whether it is still current: U]. OCC and Fed equivalents: [U]. | FDIC public-domain statement (see A.3) [E] | Free | 8-K-type events → that bank | **Manual** until we know whether any of these filers are in our states; then a small **Build** |

#### Which deals community banks announce

| Deal | Announced? | Where | Tag |
|---|---|---|---|
| Merger or acquisition (definitive agreement, approvals, close) | Nearly always, at signing and at close | Wire, the bank's site, an 8-K for SEC filers | [I] |
| Branch sale | Usually, on signing | Same | [I] |
| Capital raise (subordinated notes, private placement, common offering) | Usually | Same | [I] |
| "Balance sheet repositioning" | Common. **It usually means selling securities, not loans** [I]. Do not score it as a loan-sale signal without the word "loan". | Earnings release, 8-K | [I] |
| **Loan sale** | **Rarely on its own.** Usually it is a line in the earnings release ("sold $X of loans", "transferred to held for sale"). A standalone release comes when the sale is material. | Earnings release; a standalone release when material | [I]. One 2026 example below [E]. |

**One 2026 example [E].** A Nasdaq-listed bank holding company outside our six metros announced, through GlobeNewswire:
- definitive agreements with six purchasers to sell about $205M (unpaid principal) of mostly criticized or classified commercial and multifamily real-estate loans;
- an estimated pre-tax loss;
- that five of the six sales had **already closed**.

The release was also filed as an 8-K EX-99.1. The next quarter's release reported more CRE loans moved to held for sale, and an equity raise. **Lesson** [I]: for the seller itself, the release arrives at or after the sale. Its value is as a lead on that bank's next sale and on peers with similar books, as §3 of the repo doc already says.

#### Proposed bounded approach (a recommendation)

1. **Scope.** Only Tier A and B banks with **no EDGAR filer** (OTC, §12(i), private). SEC filers are covered by the EDGAR listener.
2. **A registry, kept by a principal.** It lives in the data folder, not the repo (it names prospects). One row per bank:
   - the newsroom URL;
   - the IR platform (Q4, Notified, B2i, own site, OTC page);
   - the RSS URL, if any;
   - whether an email alert exists;
   - the robots.txt verdict for that path, with the date checked;
   - the site terms (quote and date);
   - the principal's decision: RSS, page check, email, or none.
3. **Polling rules.**
   - RSS first, then a page check only where robots.txt allows the path and the terms do not forbid automated access.
   - Once a day, one request per host, with a conditional GET (ETag and If-Modified-Since).
   - The declared User-Agent, as with the SEC.
   - At most about 300 hosts. No JavaScript rendering, no following of links beyond the release itself.
   - Where a site offers only email alerts, a principal subscribes with a filtered mailbox. That stays manual.
4. **Matching.** Title and lead-paragraph phrases: `loan sale`, `sale of loans`, `held for sale`, `nonperforming`, `classified`, `note sale`, `branch sale`/`sale of branches`, `definitive agreement`, `merger`, `subordinated notes`, `private placement`, `capital raise`, `repositioning` (flagged as weak). The output is an **event signal** attached to the bank's `institutionKey`.
5. **Stored.** The URL, the title, the date and the matched phrase. No full text. This keeps to research-agenda §0.8's "short quotes, not full text".

---

### A.3 Government press feeds

| Source | What it gives | Access | Terms (quoted, tagged) | Cost | Signal and attaches to | Verdict |
|---|---|---|---|---|---|---|
| **FDIC press releases** | Failures and acquiring banks, enforcement-order releases, loan-sale notices, rules. The bank is named and dated. | https://www.fdic.gov/news/press-releases has a "Subscribe via RSS" link [E]. The GovDelivery feed is `https://public.govdelivery.com/topics/USFDIC_26/feed.rss`; Financial Institution Letters are `USFDIC_19` [E, third-party integration guide]. | FDIC Archive "Content and Copyright": "information that is created by or for the US government on this site is within the public domain" and "may be freely distributed and copied"; credit the FDIC [E, archive.fdic.gov]. The main site's policy warns that *linked* sites may be copyrighted [E, fdic.gov/about/website-policies]. 17 U.S.C. §105 bars copyright in federal works [I]. | Free | Failure → the FDIC as seller. Enforcement release → that bank. **Overlap:** the existing FDIC adapters (failures CSV, history) [I]. | **Build** (cheap; a cross-check on failures and enforcement) |
| **Federal Reserve press RSS** | All releases; "Orders on Banking Applications"; "Enforcement Actions"; "Banking and Consumer Regulatory Policy" [E] | https://www.federalreserve.gov/feeds/feeds.htm [E]. `press_all.xml`, `press_monetary.xml` and `press_bcreg.xml` [E, third-party]. The orders and enforcement filenames, which the repo doc gives as `press_orders.xml`, were **not** confirmed in this pass [U]. | "Unless otherwise indicated, information on Board's website is in the public domain and may be copied and distributed without permission. Please cite to the Board as the source of the information." [E, https://www.federalreserve.gov/disclaimer.htm; no date seen] | Free | Merger approval → the acquirer. Enforcement → that bank. **Lead time:** one to two quarters before close. | **Build** (already planned) |
| **Federal Reserve H.2** (weekly) | "Actions of the Board, Its Staff, and the Federal Reserve Banks; Applications and Reports Received", including delegated approvals (branches, BHC acquisitions) [E] | `https://www.federalreserve.gov/releases/h2/YYYYMMDD/` and `/delactions.htm`. Weekly through 2026 [E]. | As above | Free | Application received or approved → applicant. Lead time is earlier than the orders. | **Build** (weekly) |
| **OCC news releases** | Enforcement-action releases (monthly), bulletins, speeches | RSS index https://www.occ.gov/rss/index-rss.html: "OCC News Releases · OCC Bulletins · OCC Speeches · OCC Congressional Testimony · OCC Community Affairs News · OCC Publications" [E] | No OCC copyright statement found [U]. Federal work, so public domain [I]. | Free | Enforcement → national bank | **Build** |
| **OCC Corporate Applications Search (CAS)**; replaced the Weekly Bulletin | Applications and notices from national banks and federal savings associations, with status and OCC action: mergers, branch closings, business combinations [E] | https://apps.occ.gov/CAS/. "Five-day delay" from receipt; "date range entered should not exceed 5 years" [E]. Earlier bulletins are folded into CAS [E]. No RSS found [U]. | As OCC; CAS terms and robots.txt [U] | Free | Merger or branch-sale application → applicant and target. Lead time: weeks to months before close. | **Build** (weekly query), after reading CAS's terms and robots.txt |
| **Texas Department of Banking** | Press releases (mostly consent orders and enforcement) [E]. The monthly "Supervisory Update News Summary" PDF (around the 15th) [E]. A "Corporate Filings" page of approved charters, conversions and orders [E]. | https://www.dob.texas.gov/news-and-events; PDFs at `/sites/default/files/files/Applications-Forms-Publications/Publications/Suns/sunsMM-YY.pdf`; https://dob.texas.gov/banks-trust-companies/2025-corporate-filings [E]. The **Finance Commission meeting packet** has a Corporate Division report listing "significant bank and trust applications" received, mergers among them [E, fc.texas.gov, 2025-12-12 packet]. No RSS found [U]. | Site Policies page exists; the excerpt showed only privacy text [E, dob.texas.gov/site-policies]. The Texas state policy says an agency may not charge a fee "to access, use, reproduce, or link to its website information unless the Legislature specifically authorizes it" [E, DIR state website policy]. Copyright status of the department's own works: [U]. | Free | State-bank merger or conversion application → that bank. Lead time: months (packets come roughly every two months [U]). | **Build** (small: monthly PDF plus the packet's Corporate Division section) |
| **California DFPI** | Press releases (478 in total; filterable by "Commercial Banks") [E]. The **Monthly Bulletin**, issued under Financial Code §376, with a "Bank Activity" section [E]. | https://dfpi.ca.gov/press-releases/; https://dfpi.ca.gov/news/monthly-bulletins/; email subscription at https://dfpi.ca.gov/news/subscribe/ (Press Releases, Monthly Bulletins) [E]. No RSS found [U]. | DFPI's own terms not seen [U]. Other California agencies say: "In general, information presented on this website, unless otherwise indicated, is in the public domain." [E, results.ca.gov; oag.ca.gov] | Free | State-bank applications (mergers, acquisitions of control, branch sales, name changes) → that bank. Monthly. | **Build** (monthly). California has the most banks of our states [I]. |
| **Arizona DIFI** | Press releases, "DIFI Notes", and enforcement (mostly insurance and money transmitters); occasional new-bank charter releases [E] | https://difi.az.gov/communications [E]. Older domains azdfi.gov and dfi.az.gov still host PDFs [E]. | The Arizona State Library says Arizona state works are **not** in the public domain and are copyrighted; public-records law may allow copies, and commercial use of public records requires a fee [E, azlibrary.gov/about/website-policies]. Internal reading of facts is probably not affected [I; counsel]. | Free | Little bank content [E] | **Manual** (a quarterly look) |
| **Colorado Division of Banking** | Public notices (Banking Board notices by the 10th of each month; "Use of Name"); a **monthly "Financial Institution Activity" bulletin** of approved applications, removed after completion; Banking Board agendas and minutes, including interagency merger applications [E] | https://banking.colorado.gov/public-notices; bulletin PDFs such as `https://banking.colorado.gov/sites/banking/files/2026-01_Bulletin.pdf` [E]. Contact: DORA_applications@state.co.us [E]. | No single Colorado rule on state works [E, CU policy brief]. Division's own terms: [U]. | Free | State-bank applications → that bank. Monthly. | **Build** (small monthly PDF) |
| **Nevada FID** | Licensing, enforcement actions, notices; no merger list found [E] | https://fid.nv.gov; https://fid.nv.gov/Notice/Information [E] | The state printer may copyright state publications (NRS 344.070) [E]. FID's own terms: [U]. | Free | Little | **Manual** |

**Inferences.**
- **The state bulletins cover banks the federal lists miss** [I]. A state nonmember bank (FDIC-supervised) merger shows up in Fed H.2 only if a holding-company application is needed, and never in OCC CAS. The California, Colorado and Texas bulletins list it [I]. Whether the FDIC publishes its own applications list was not checked [U].
- All of these are **event** signals with a date. Pending applications give the earliest merger signal we can get, ahead of FDIC `/history`, which records only the close.

---

### A.4 News aggregators and APIs

| Source | What it gives | Access | Terms (quoted, tagged) | Cost | Signal and attaches to | Verdict |
|---|---|---|---|---|---|---|
| **GDELT DOC 2.0** | Full-text search over worldwide online news, "across all 65 machine translated languages" [E]. It returns article URLs and titles, ranked [E], not the article text [U]. A rolling 3-month window by default, extendable to the past year with `timespan` [E, GDELT blog]. NEAR and REPEAT operators [E]. | `https://api.gdeltproject.org/api/v2/doc/doc?query=...&mode=ArtList&format=json`. No key [E]. Filters such as `sourcecountry` and `domain`, and the result cap: [U]. | "all datasets released by the GDELT Project are available for unlimited and unrestricted use for any academic, commercial, or governmental use of any kind without fee", with a citation and link required [E, secondary quote of the terms on the GDELT About page]. **The articles it links to stay under their publishers' terms** [I]. | Free | A headline mentioning a universe bank with loan-sale, merger or capital phrases → that bank. Picks up local news of non-SEC banks [I]. | **Build**: headline and URL only, to a principal's queue. Never fetch the linked article automatically. |
| **Google Alerts** (RSS delivery option) | Google's matches for a query, by email or RSS. RSS has been an official option since 2008 (removed in 2013, later restored) [E, secondary]. | Feed URL per alert, created in a Google account | Google Terms of Service (effective 2024-05-22) bar "using automated means to access content from any of our services in violation of the machine-readable instructions on our web pages (for example, robots.txt files that disallow crawling, training, or other activities)" [E, policies.google.com/terms archive]. A US version effective 2026-07-30 exists; whether the bullet survives in it: [U]. An older services clause, "made available for your personal, non-commercial use only", is from an old version [E, forum quote]. | Free | Same as GDELT | **Manual**: alerts emailed to a principal, not fed into the pipeline |
| **Google News RSS** | Search-result feeds | `news.google.com/rss/search?q=...` [U] | The feed's notice: "This XML feed is made available solely for the purpose of rendering Google News results within a personal feed reader for personal, non-commercial use. Any other use of the feed is expressly prohibited." [E, third-party quotes] The legacy Google News terms: "You may only display the content of the Service for your own personal use (i.e., non-commercial use)" and no robots [E, google.com/intl/en_us/terms_google_news.html, old]. | Free | n/a | **Not used** (rechecked; the reason is firmer than in the repo doc) |
| **Bing News Search API** | n/a | n/a | "Bing Search APIs will be retired on August 11, 2025", then "decommissioned completely". The suggested replacement is "Grounding with Bing Search" in Azure AI Agents [E, learn.microsoft.com lifecycle announcement]. | n/a | n/a | **Not used** (retired) |
| **NewsAPI.org** | Headline search across indexed outlets | REST API with a key | The free Developer plan "may be used for development and testing in a development environment only, and cannot be used in a staging or production environment (including internally)" [E, newsapi.org/pricing]. The terms page reads "Last updated: April 30, 2020" [E, newsapi.org/terms]. | Business "$449 per month"; Advanced "$1,749 per month" [E] | Coverage of local and small-bank news is likely thin [I] | **Not used** (cost against value; GDELT covers discovery) |
| **NewsAPI.ai / Event Registry** | Article and event search, with entity and concept tagging [U] | REST API priced in tokens: an article search is 1 token (5 per searched year); at most 100 articles a search; unused tokens lapse [E, newsapi.ai/plans] | Commercial terms not found [U] | 5,000 tokens for $90 a month [E, third-party] | Same as GDELT, better tagging [U] | **Licensed only**: trial it if GDELT proves too noisy |
| **Common Crawl CC-NEWS** | Monthly WARC files of news pages since 2016 [E] | S3 `crawl-data/CC-NEWS/` [E] | Common Crawl's FAQ: no republishing unless fair use, no reselling, "respect the terms of the sites crawled" [E, paraphrased]. Its terms were updated March 7, 2024 [E, secondary]. Third-party content keeps its copyright [E]. Publishers dispute it: a News/Media Alliance letter of 2026-04-30 and a Digital Content Next cease-and-desist [E]. | Free (compute cost) | Bulk and late | **Not used** |
| **Factiva** (Dow Jones) | Licensed archive of news and wires, including regional papers [U] | Web app; a Retrieval API for retrieval-augmented generation [E] | Licence-bound [I] | No list price. Estimate: about $79 a user a month for one user, $700–900 a month for 10 users [E, third-party] | Broad coverage, with rights cleared for licensed use [I] | **Licensed only**: only if principals want a research seat |
| **LexisNexis** (Nexis Newsdesk, Nexis Data+) | Same as Factiva | Web app, API | Licence-bound [I] | Quote only [E] | Same | **Licensed only** |
| **Bloomberg** | Terminal news, bank data | Terminal | Licence-bound [I] | Roughly $25,000–32,000 a seat a year [U, from memory] | Same | **Licensed only** (not worth it for this use [I]) |
| **Debtwire** (ION Analytics) | Distressed-debt news; coverage of CRE loan sales [U] | Subscription [E] | Licence-bound [I] | Quote only [E] | Possibly names sellers before a sale [U] | **Licensed only**: ask for a trial |
| **Commercial Mortgage Alert** (Green Street News) | "One of Green Street's four weekly News publications", covering commercial MBS and real-estate debt markets [E]. It reports loan-sale mandates and pools on offer, often naming the seller [U]. | Subscription; "Free 3-Week Trial Subscription" [E] | Licence-bound [I] | "Upwards of $8,000" [E, third-party blog] | **A pool being marketed, seller named**: the event we most want, with days to weeks of lead [U/I] | **Licensed only, principal-read.** Start the trial. |
| **American Banker** (Arizent) | Bank industry news: M&A, enforcement, credit | RSS: `https://www.americanbanker.com/feed?rss=true`, `/rss`, and per-topic `.rss` [E] | 2016 RSS terms: readers may not post, copy or distribute full-text stories or substantial portions; attribution required [E, archived page]. The Arizent subscription agreement limits display and printing to personal, non-commercial use [E, arizent.com/news/arizent-subscription-agreement]. | Not found [U] | Bank-level news, mostly larger banks [I] | **Manual** (a principal reads the headlines) |
| **S&P Capital IQ Pro / SNL** | A bank M&A deal database and regulatory data; UBPR and FPR fields in the screener; "60k+ banks" [E]. A loan-sale transaction dataset: [U]. | Web app; API (Xpressfeed) | Licence-bound [I] | No list price. API "from $30,000 a year into six figures" [E, third-party] | Deals, loan sales [U] | **Licensed only** (research-agenda B8 already lists it) |

---

### A.5 Trade press

| Source | What it gives | Access | Terms (quoted, tagged) | Cost | Signal and attaches to | Verdict |
|---|---|---|---|---|---|---|
| **Bisnow** | Metro CRE news: distress, loan sales, lender takebacks; lenders are sometimes named [I] | RSS: `https://www.bisnow.com/rss-feed/denver`, `/los-angeles`, `/austin-san-antonio`, `/home` [E]. Phoenix, San Diego and Las Vegas feeds: [U]. Free metro newsletters [U]. | "may not use any robot, spider, scraper or other automated means to access the Sites". Use is allowed "only for INTERNAL OR PERSONAL purposes". No archiving, reproducing or republishing without express written permission. "Any use of the Content not expressly permitted by these Terms is a breach of these Terms." [E, https://www.bisnow.com/legal/terms, indexed copy about 3 years old] | Free | Asset and lender events → lender (principal context) | **Manual** (metro newsletters to a principal) |
| **Commercial Observer** | National CRE finance news; New York-heavy [I] | RSS [U] | Access is personal and non-commercial; no reproducing or exploiting without written consent [E, commercialobserver.com/terms/, paraphrased]. The subscriber agreement bars subscribers to "reproduce, retransmit, distribute, store in a retrievable device, or disseminate" without express written consent [E, commercialobserver.com/subscriber-agreement/]. | Subscription [U] | Lender and loan-sale stories, mostly outside our metros [I] | **Manual** |
| **The Real Deal** | CRE news, including Los Angeles [U] | Category pages such as `therealdeal.com/category/commercial-real-estate/`; feeds made by third-party tools [E] | The subscription licence covers use "solely for personal or internal business purposes"; no redistributing, commercializing or derivative works [E, therealdeal.com/terms-and-conditions/, last updated September 2023]. Site-wide terms for non-subscribers: [U]. | Subscription [U] | Same | **Manual** |
| **GlobeSt** (ALM Global, trading as Centellic) | National CRE news [I] | Feed hosted on FeedBlitz [E, third-party directory] | Footer links to "Terms of Use"; the text was not found [U] | Partly free [U] | Same | **Manual** |
| **Banking Dive** (Industry Dive, now Informa TechTarget) | Bank industry news: M&A, enforcement, CRE exposure [I] | RSS at `https://www.bankingdive.com/feeds/news` [E, directory]; free newsletter [E] | Industry Dive terms, "Effective as of October 2016": "All rights not expressly granted under this Agreement" are reserved [E, industrydive.com/terms-of-use]. No RSS clause seen [U]. | Free | Bank-level news → bank | **Manual** (the newsletter). A permission request is possible later. |
| **CoStar News** | CRE news inside CoStar | Licensed product | "News" is defined to include "CoStar News" within the CoStar terms [E]. The UK commercial licence bars "scraping, disassembling or reverse engineering any portion of the Licensed Product" [E]. CoStar is known for litigation [E, third-party]. | Subscription, quote | n/a | **Licensed only** (and not worth it for this) |
| **Connect CRE** | Market news, including a weekly **"Return to Lender"** column [E, title only; content U] | Feeds by market: Austin, Texas, California, Bay Area, Southwest; the main hub is `https://www.connectcre.com/feed` [E, connectcre.com/rss-info/] | The terms (connectcre.com/terms-and-conditions/, indexed copy about 935 days old) prohibit using robots, spiders or AI systems to access, copy, scrape or index the content, and even prohibit linking [E, paraphrased]. The RSS page lets you feed or embed news if it appears "unaltered" and attributed [E]. The two conflict [I]. | Free | Properties returned to lenders → lender (principal context) | **Manual** |
| **Trepp blog and TreppWire** | CMBS distress commentary, loan-level names [I] | Blog, daily newsletter, weekly podcast [E] | **trepp.com refused the search tool's user agent** [E]. Terms: [U]. | TreppWire free or paid: [U] | Overlaps our CMBS data [I] | **Manual** |
| **CRED iQ blog** | CMBS and CRE research posts [E] | https://cred-iq.com/blog/category/research/ [E]; RSS [U] | The privacy policy (revised 2025-09-12) points to a "Website Terms of Use" and a "Master Subscriber Agreement" [E]. Their text: [U]. | Free blog | Overlaps CMBS | **Manual** |
| **American City Business Journals**: Austin, Denver, Phoenix | Local bank and CRE news, sometimes about private banks [I] | bizjournals.com; RSS [U]. A 2019-era forum reports an "I am not a robot" page for non-browser fetches [E]. | **bizjournals.com and acbj.com refused the search tool's user agent** [E]. Terms: [U]. | Subscription [U] | Local deals → bank | **Manual** (a principal's subscription in Austin, Denver and Phoenix) |
| **Los Angeles Business Journal; San Diego Business Journal** | Local business news | Their own sites | **Not ACBJ titles**: ACBJ sold both in 1988 [E, secondary]. The LA title is part of California Business Journals [E]. Terms: [U]. | Subscription [U] | Same | **Manual** |
| **Las Vegas** | No ACBJ title found [E: none in results] | n/a | n/a | n/a | n/a | n/a (local press: [U]) |

**Inference.** Trade press names assets and lenders more than sellers. Where it names a bank selling loans, the source is often unnamed people ("sources say"), and it usually comes before any release [U]. That is real lead time, so a principal reading it is worth the effort. But the terms keep it out of automation, and its asset details are principal context only under the repo's existing rule.

---

### A.6 Earnings-call transcripts and webcasts

| Source | What it gives | Access | Terms (quoted, tagged) | Cost | Signal and attaches to | Verdict |
|---|---|---|---|---|---|---|
| **The bank's IR webcast** (Q4 or Notified event pages) | Live and archived audio; occasionally a transcript on the IR site [U] | IR events page; the RSS "events" feed on Notified sites [E] | The bank's site terms [I] | Free | Management answers on loan sales, held for sale, "exploring a sale of ..." → bank. **Lead time:** can come **before** the 8-K or the sale [I]. | **Manual** (a principal listens to Tier A public banks' calls) |
| **Seeking Alpha** | Free transcripts, wide coverage [E] | Web; captcha in place [E, tutorial] | Access and copies are "solely for personal, non-commercial purposes"; written consent is needed to reprint [E, about.seekingalpha.com/terms] | Free or premium [E] | Same | **Not used** for automation; **Manual** reading is fine [I] |
| **Motley Fool** transcripts | Transcripts of larger companies [U] | Web | Not checked: the search limit ran out [U] | Free [U] | Same | **Not used** until its terms are read |
| **Quartr API** | "earnings calls, transcripts, filings, and slide presentations from over 14,000 companies globally" [E] | API | Licence [I] | "Custom" [E, quartr.com/pricing/api] | Text searchable for "loan sale" and "held for sale" [I] | **Licensed only**: ask about coverage of $1–10B banks |
| **Financial Modeling Prep** | Transcripts for "over 7,000 stocks with 15+ years" [E, third-party marketplace] | API | Commercial licence terms [U] | From $200 a month [E, third-party] | Same | **Licensed only** (trial) |
| **EarningsCall API; Benzinga live transcript API** | Transcripts, live (Benzinga) [E] | API | [U] | Not published [E] | Same | **Licensed only** |
| **S&P Capital IQ, FactSet, LSEG** | Full transcripts, small caps included [U] | Licensed | Licence-bound [I] | High [U] | Same | **Licensed only** |

**Can mentions be found?** Yes, wherever a transcript exists: it is plain text, so phrases such as "loan sale", "held for sale", "note sale", "bulk sale" and "exit the relationship" can be matched [I]. The gap is coverage. Many banks under $10B do not hold calls at all, or have no transcript published [U]. Vendors did not say how many small banks they cover [E: not addressed].

**What our EDGAR listener leaves uncovered** [I]:
1. **Non-SEC banks.** OTCQX (104 banks in Q2 2026 [E]), OTC Pink [U], and §12(i) banks filing with the FDIC, OCC or Fed [E]. This is the largest gap, and the newsroom registry (A.2) and the state bulletins (A.3) are aimed at it.
2. **Spoken remarks.** Management's answers on a call are not in the 8-K. The earnings release (Item 2.02, EX-99.1) and slides (Item 7.01, EX-99.2) are. Merger-call transcripts are often filed under Rule 425 [U]; check whether the EDGAR listener's form list includes 425.
3. **Pending applications** before any 8-K: OCC CAS, Fed H.2 and the state bulletins (A.3).
4. **Unannounced marketing of a pool.** Commercial Mortgage Alert, trade press, and the loan-sale advisors already in `docs/data-sources.md` §2.3 (JLL, FFN).
5. **Local news about private banks.** GDELT, and the business journals read by a principal.

---

### A.7 Hosts to allow for a primary-source pass

Each host has the URL or URLs needed there. Every host also needs `/robots.txt` read; it is listed once per host where it matters most.

| Host | URL(s) needed |
|---|---|
| www.businesswire.com | /terms-of-use; /help/feed-options; /robots.txt |
| feed.businesswire.com | /rss/home/?rss=G1QFDERJXkJeGVpSWw== (banking sample); the feed index; /robots.txt |
| www.prnewswire.com | /terms-of-use/; /rss/; /robots.txt; /contact-us/prnewswire-partners/; /content/dam/prnewswire/contactUs/Content+API+Services+Usage+Documentation_PRN.pdf |
| portal.prnewswire.com | /Popup/facts.aspx |
| www.globenewswire.com | /rss/list; /newswire-press-release-content; /Home/Learning-Support/Knowledge-Base/GlobeNewswire-Newsfeed-Fact-Sheet-North-America.pdf; the footer "Terms of Use" page (URL unknown); /robots.txt |
| portal.notified.com | /terms-conditions/en |
| www.accessnewswire.com | /terms-of-service; /robots.txt |
| newsroom.accessnewswire.com | / (look for RSS); /robots.txt |
| www.einpresswire.com | /terms; /legal/terms; /all-rss |
| www.einnews.com | /all_rss; /all_rss/banking-finance-investment |
| www.newsfilecorp.com | /TermsOfUse.php; /newswire/newswire-integrate-press-releases.php |
| www.q4inc.com | /products/tools-feeds; /platform/platform-features/investor-relations-websites |
| One Q4-hosted and one Notified-hosted (`*.gcs-web.com`) IR site of a registry bank, chosen by a principal (not named here) | /rss page; /robots.txt; site terms |
| www.equisolve.com | /ir-websites |
| b2itech.com | /software |
| www.otcmarkets.com | the website terms of use (footer); /market-data/fee-schedule; /files/OTCM%20Market%20Data%20Policies-v4.0.pdf; /robots.txt |
| blog.otcmarkets.com | /2026/01/26/otcqx-banks-continued-to-grow-in-2025/ |
| efr.fdic.gov | /fcxweb/efr/index.html |
| www.fdic.gov | /news/press-releases (the RSS link target); /about/website-policies |
| archive.fdic.gov | the "Content and Copyright" page |
| public.govdelivery.com | /topics/USFDIC_26/feed.rss |
| www.federalreserve.gov | /feeds/feeds.htm (confirm the orders and enforcement filenames); /disclaimer.htm; /releases/h2/ |
| www.occ.gov | /rss/index-rss.html; /topics/charters-and-licensing/weekly-bulletin/index-weekly-bulletin.html; the website-policies page (footer) |
| apps.occ.gov | /CAS/ (terms, export options); /robots.txt |
| www.dob.texas.gov | /news-and-events; /site-policies; /banks-trust-companies/2025-corporate-filings; the Suns PDF folder |
| www.fc.texas.gov | the meeting-packet index (Corporate Division report) |
| dfpi.ca.gov | /press-releases/; /news/monthly-bulletins/; /news/subscribe/; the conditions-of-use page (footer) |
| difi.az.gov | /communications |
| azlibrary.gov | /about/website-policies |
| banking.colorado.gov | /public-notices; /sites/banking/files/2026-01_Bulletin.pdf (and the index of bulletins) |
| fid.nv.gov | /; /Notice/Information |
| api.gdeltproject.org | /api/v2/doc/doc?query=...&mode=ArtList&format=json (a live test) |
| www.gdeltproject.org | /about.html (the terms-of-use section) |
| blog.gdeltproject.org | /gdelt-doc-2-0-api-debuts/ (the parameter reference) |
| policies.google.com | /terms (the current US version, effective 2026-07-30) |
| news.google.com | /rss/search?q=bank (read the `<copyright>` element) |
| learn.microsoft.com | /en-us/lifecycle/announcements/bing-search-api-retirement |
| newsapi.org | /pricing; /terms |
| newsapi.ai | /plans; its terms page |
| commoncrawl.org | /terms-of-use |
| www.bisnow.com | /legal/terms; /rss-feed/denver; /rss-feed/phoenix (test); /robots.txt |
| commercialobserver.com | /terms/; /subscriber-agreement/; /feed |
| therealdeal.com | /terms-and-conditions/; /robots.txt |
| www.globest.com | the terms of use (footer); /robots.txt |
| www.bankingdive.com | /feeds/news; the terms of use |
| www.industrydive.com | /terms-of-use |
| www.costar.com | /about/terms-conditions |
| www.connectcre.com | /terms-and-conditions/; /rss-info/; /robots.txt |
| www.trepp.com | the terms of use; the TreppWire signup; /robots.txt |
| cred-iq.com | the Website Terms of Use; /blog/feed (test) |
| www.bizjournals.com | the user agreement; /robots.txt; the Austin, Denver and Phoenix RSS pages |
| labusinessjournal.com, www.sdbj.com | the terms of use |
| www.americanbanker.com | /rss; the terms of use |
| arizent.com | /news/arizent-subscription-agreement |
| www.greenstreet.com | the Commercial Mortgage Alert subscription and trial terms |
| about.seekingalpha.com | /terms |
| www.fool.com | the terms of use |
| quartr.com | /pricing/api |
| site.financialmodelingprep.com | the terms of service; /developer/docs/earning-call-transcript-api |

### A.8 Part A's top five

Merged into the ranking at the top of this note.

Ranked by value against effort and legal risk:

| Rank | Addition | Value | Effort | Legal risk | Why this rank |
|---|---|---|---|---|---|
| 1 | **Federal applications and press feeds**: OCC CAS (in place of the Weekly Bulletin), Fed H.2 weekly, the Fed orders and enforcement RSS, FDIC press RSS (GovDelivery), OCC news RSS | High: the earliest merger signal (pending applications), plus enforcement releases | Low: RSS and one weekly query | Very low: public domain (Fed stated [E]; others [I]) | It fixes a stale source in the repo doc, and every piece is free and dated. |
| 2 | **State monthly bulletins**: the California DFPI Monthly Bulletin ("Bank Activity"), Colorado's "Financial Institution Activity" bulletin, Texas DOB corporate filings and the Finance Commission's Corporate Division report | High for state-chartered banks, which federal lists may miss [I] | Low to medium: monthly HTML and PDF parsing | Low: government sites. Arizona-style copyright does not bar reading facts [I]. | It covers state nonmember banks' applications, which are invisible in OCC CAS and often in H.2 [I]. |
| 3 | **Non-EDGAR newsroom registry** (A.2): a principal-kept URL per Tier A and B bank with no SEC filer, RSS first, robots and terms recorded, one conditional GET a day, headlines only; plus the FDIC portal for §12(i) filers | High if open question 1 finds many such banks. It closes the main gap EDGAR leaves. | Medium: the registry is manual, the adapter is small | Low: the bank publishes its own news, and we honor robots.txt and the terms | Its value depends on open question 1, so settle that first. |
| 4 | **GDELT DOC 2.0** headline listener: a bank-name plus phrase query, URL and title only, to a principal's queue | Medium: local and trade coverage of private banks, and early "sources say" stories | Low: one free API | Low: GDELT's terms allow commercial use with a citation [E, secondary]. Linked articles are never fetched. | The only aggregator with clear commercial terms at no cost. |
| 5 | **A principal's reading list**: a 3-week **Commercial Mortgage Alert** trial, then decide; Bisnow metro newsletters (Denver, Los Angeles, Austin–San Antonio); Connect CRE "Return to Lender"; Banking Dive; Google Alerts by email for Tier A names; a Business Wire banking feed in a reader | High for Commercial Mortgage Alert (named sellers of pools on offer [U]); medium for the rest | Low: subscriptions and reading time | None for reading. Nothing is automated, and findings go in as sourced notes. | It captures trade-press lead time that the terms keep out of the pipeline. |

Not in the top five, but worth one letter: ask **Notified (GlobeNewswire)** for written permission (see A.1), once open question 1 shows enough non-EDGAR banks.

---

## Part B. Deals, people and notices

Desk research of **November 14, 2026**, for `docs/data-sources.md` sections 2.3, 2.4, 2.6 and 3, the routes epic (E22, `docs/prd-signal-pipeline.md`) and the intermediaries epic (E19, `docs/prd-next-five.md`). No bank and no private person is named. Vendors, platforms, advisors and associations are named.

### B.0 How to read this part

The tags are in the header of this note. In this part, "doc 2.3" and the like mean `docs/data-sources.md`, section 2.3.

Where an [E] fact comes from a secondary page (a vendor blog, a review site), the cell says "secondary". Quotes marked [E] are the wording the search returned. The exact current wording on the live page still needs the primary-source pass in B.7.

**Limits of this pass.**

- **Fetching was blocked.** One fetch was tried, of `www.linkedin.com/legal/user-agreement`. It failed: the host does not resolve in this session. As instructed, no other host was tried and nothing was done to get around the proxy. **No `robots.txt` was read for any host.** Every robots.txt cell is therefore [U].
- **The search budget ran out.** The 200-search limit for the turn, shared by every agent in it, was reached during B.6. The following were **not searched**, and are given from memory, tagged [U]: CCPA/CPRA details, the YouTube Data API, podcasts, and state UCC.
- **Seller-named counts come from small samples.** They count search-indexed pages and listings, not a full crawl of each site.

**The verdicts:**

- **Build**: an adapter, once its terms are read and allow it.
- **Licensed only**: through a paid licence that covers our use.
- **Manual**: a principal reads it and logs a signal by hand.
- **Not used.**

The repo's rule stands: a source is automated only when its terms allow it, or a principal has recorded a decision that they do (data-sources section 1). So "Build" below always means **"Build, gated on the terms check"**.

---

### Part B summary

1. **LinkedIn: no automated path exists for a third party.**
   - The User Agreement, effective November 3, 2025 [E], bars scraping, bots, and copying information "obtained from the Services" [E].
   - The Marketing/Community Management APIs allow member data only for managing your own Pages or Profiles [E].
   - SNAP is limited-access and never hands LinkedIn data to the partner [E].
   - Sales Navigator Core, at about $1,080 a year [E], gives job-change, account and saved-search alerts [E]. Those alerts suit only a principal reading them and logging signals by hand.
2. **hiQ v. LinkedIn ended in LinkedIn's favour on contract.** A consent judgment of December 8, 2022 [E] ordered $500,000, a permanent injunction, and deletion of the data [E]. The CFAA rulings do not make scraping lawful under the contract [I].
3. **Loan-sale advisors mostly describe the seller and rarely name it.** In the samples:
   - **DebtX:** 0 of 10 closed deals name the seller ("Seller: Bank") [E].
   - **JLL Invest:** 0 of 5 listings name it [E].
   - **First Financial Network (FFN):** names the bank in some announcement files (2 of 4 bank-seller sales seen) [E].
   - **The large brokers' own press releases:** sometimes name a bank seller (Newmark 1 of 2; JLL 1 of 2) [E].
   - **Trade press:** Commercial Real Estate Direct names the bank seller and the advisor in at least one 2026 loan offering [E].
4. **Listing titles carry what we need.** DebtX and JLL Invest titles hold the **metro and size** (for example "$10.3 Million Non-Performing Loan | Denver, CO") [E], which is enough for E16-S8 listing events and E19-S1 mandates.
5. **No advisor's terms or robots.txt could be read.** Each needs the second pass before any Build.
6. **Job postings are a weak timing signal.**
   - In a sample of special-assets postings, the hosts seen were Paylocity, Workable and iCIMS, not Greenhouse or Lever [E].
   - **LinkUp** is the one licensed postings vendor that says it indexes employer websites only [E], so it carries no LinkedIn risk [I].
   - **Revelio** (profiles "mainly LinkedIn" [E]), **Coresignal** ("primarily professional social networks" [E]) and **Lightcast's profile product** (most commonly "online professional network sites" [E]) pass the LinkedIn risk on [I].
7. **Statewide press-association notice sites exist in all five states** [E]. Colorado's [E] and Nevada's [E] offer keyword email alerts.
   - **Texas:** trustee's sale notices are posted and filed, not published in newspapers [E], so the Texas site adds little [I].
   - **California, Arizona and Nevada:** published trustee's sale text may give the trustee and lender for counties whose recorder images are not online (Los Angeles, San Diego, Clark) [I]. California's site is voluntary: the bill to mandate it was vetoed in 2024 [E].
8. **Conference speaker pages are public, and attendee lists are not.**
   - IMN's "Bank Special Assets" events (Texas on December 1–2, 2026; East; Distressed CRE West) publish speaker pages naming bank special-assets officers [E]. This is the best public forum source for E22 [I].
   - CREFC's attendee list goes only to registered in-person attendees, for up to 30 days after the event, and contact details are a member benefit [E].
9. **X is now pay-per-use, about $0.005 per post read [E, secondary].** Its terms restrict "tracking, alerting, or monitoring" [E], and few advisors post there. Not used.
10. **Top five additions** (B.8):
    1. advisor listing watch and buyer-list registration;
    2. IMN, CREFC, RMA and bankers' association speaker pages into the briefer;
    3. statewide notice alerts for AZ, NV and CA;
    4. Sales Navigator Core, worked by hand;
    5. a trial of trade-press loan-offering coverage.

---

### B.1 LinkedIn, done properly

#### B.1.1 The User Agreement: what it says about scraping, bots and automated access

**URL:** `https://www.linkedin.com/legal/user-agreement`. **Version:** "Effective on November 3, 2025" [E: the official page header, as the search returned it]. **Checked:** 2026-11-14, through search excerpts only. The page itself was blocked.

Section 8.2 is the "Don'ts" list, cited by LinkedIn's own help page as the source of these prohibitions [E]. You agree that you will not:

| Clause | Wording as returned [tag] | Where seen |
|---|---|---|
| Scraping tools | "Develop, support or use software, devices, scripts, robots or any other means or processes (such as crawlers, browser plugins and add-ons or any other technology) to scrape or copy the Services, including profiles and other data from the Services" [E] | UA excerpt and help page `https://www.linkedin.com/help/linkedin/answer/a1341387` ("Prohibited software and extensions") |
| Bots | "Use bots or other unauthorized automated methods to access the Services, add or download contacts, send or redirect messages, create, comment on, like, share, or re-share posts, or otherwise drive inauthentic engagement" [E: the first part of the clause is confirmed; the rest of the list is from the 2020 copy and secondary pages, so the full current wording is U] | Help page a1341387; 2020 copy (PDF) |
| Copying information obtained from LinkedIn | Bars copying, using, displaying or distributing "any information (including content) obtained from the Services, whether directly or through third parties (such as search tools or data aggregators or brokers), without the consent of the content owner" [E: the help page's paraphrase; exact current wording U] | Help page a1341387 |
| Use limits | "Override any security feature or bypass or circumvent any access controls or use limits of the Services (such as caps on keyword searches or profile views)" [E: in the 2020 copy, where it was 8.1(c); current numbering U] | 2020 copy |

**LinkedIn's own gloss** ("Automated activity on LinkedIn", `https://www.linkedin.com/help/linkedin/answer/90586`): automated activity "is a violation of LinkedIn's User Agreement, and may be a violation of privacy legislation in specific jurisdictions" [E]. The prohibited-software page says LinkedIn does not permit third-party crawlers, bots or browser extensions that scrape its site, and that accounts using them may be restricted or shut down [E].

**Not read:**

- `https://www.linkedin.com/robots.txt` [U];
- the Crawling Terms [U].

A search for the phrase sometimes attributed to LinkedIn's robots.txt ("The use of robots or other automated means to access LinkedIn without the express permission of LinkedIn is strictly prohibited") found no source for it [E]. Treat that wording as unconfirmed.

**Enforcement since hiQ** [E]:

- LinkedIn sued one LinkedIn-data API vendor in January 2025. That vendor shut down in July 2025 [E]; one low-quality page dates the shutdown July 2026, which conflicts [U].
- It sued another (*LinkedIn Corp. v. ProAPIs Inc.*, N.D. Cal. No. 3:25-cv-8393) in October 2025. That suit alleges fake accounts and the resale of scraped data at up to $15,000 a month [E]. The latest report found was of December 2025: the parties were exploring an early resolution [E].

#### B.1.2 The official APIs: can a third party read other people's or companies' posts and job changes?

| API | What it allows | What it forbids [tag] | Third-party read of others' posts or job changes? |
|---|---|---|---|
| **Marketing APIs, including Community Management** (`https://learn.microsoft.com/en-us/linkedin/marketing/restricted-use-cases`) | Managing your own LinkedIn Pages and your members' own profiles through an approved app [E] | "Accessing, using, or storing member data for any use case other than managing LinkedIn Pages or Profiles via your application violates the Marketing API Terms" [E]. Member data "can only be displayed" in your app [E]. It cannot be combined with other data "to build or enrich profiles or leads" [E]. Storage is capped at 48 hours for member social activity and 24 hours for most profile data [E]. None of the Community Management data may be used in a social feed use case [E]. Secondary pages add bans on prospecting, CRM enrichment and lead creation [E, secondary]. | **No** [I] |
| **API Terms of Use** (`https://legal.linkedin.com/api-terms-of-use`) | Governs all LinkedIn APIs | The current text was not returned [U]. The archived 2012 version barred sharing API content with data brokers and recruiters, and barred combining API content with scraped data [E: UNT web archive]. | No [I] |
| **Sales Navigator Application Platform (SNAP)** (`https://business.linkedin.com/sales-solutions/partners/become-a-partner`) | Three families [E]:<br>• **Display Services**: Sales Navigator embedded in a partner's app, and the customer needs Advanced or Advanced Plus;<br>• **Analytics Services**: the customer's own team's activity;<br>• **Sync Services**: CRM Sync, which must be in the customer's contract. | "SNAP is a limited-access program" [E]. With Display, "Content is pulled directly from LinkedIn within the browser, and the partners do not actually get access to the LinkedIn data" [E: LinkedIn's data and privacy resources page]. Several third parties say SNAP is closed to new partners. LinkedIn's page still invites proposals, so the status conflicts [E, secondary]. | **No.** The partner never holds the data [I]. |
| **Sign In with LinkedIn, Job Posting and Talent APIs** | The member's own basic profile; posting jobs; recruiting-system integrations [U] | Not reviewed [U] | No [I] |

**Conclusion [I].** No official LinkedIn API lets an outside firm read other people's posts or job changes, or other companies' posts, for prospecting.

#### B.1.3 Sales Navigator: alerts, saved searches and cost

**Alerts and saved searches** [E: LinkedIn help pages `https://www.linkedin.com/help/sales-navigator/answer/a105133` (alerts overview) and `.../a102024` (saved searches)]:

- **Lead alerts, for leads you have saved:**
  - "Lead Changed Jobs": a saved lead moved to a new company;
  - "Lead Changed Roles": a new position at the same company;
  - news mentions and shares [E].
- **Account alerts, for saved companies:**
  - senior hires;
  - layoffs;
  - headcount growth or slowing over 90 days;
  - increases in posted jobs [E].
- **Saved searches:** up to **50 lead searches and 50 account searches**, each with **weekly** alerts of new matches, by email and on the homepage [E].
- **Where alerts appear:** the homepage alerts feed, filterable by type, date or list. Bookmarks on alerts expire after 60 days [E].
- **Email:** a "Weekly Top Alerts Digest" email option, set under Settings, Alert preferences [E: the page is about 1,300 days old, so menu names may have changed].
- **Plan limits:**
  - buyer-intent alerts need Advanced or Advanced Plus [E];
  - CRM-related alerts need Advanced Plus with CRM Sync [E].
- **Getting data out:** there is no native export of leads or accounts to CSV [E, secondary]. CRM Sync, on Advanced Plus with Salesforce or Dynamics 365 only, is the sanctioned route out [E].

**Cost** [E: the official compare-plans page `https://business.linkedin.com/sales-solutions/compare-plans`, as returned 2026-11-14]:

| Plan | Price |
|---|---|
| **Core** | US$119.99 a month, or US$1,079.88 a year per licence (about 25% off) |
| **Advanced** | US$159.99 a month, or US$1,799.88 a year |
| **Advanced Plus** | By quote. The ~$1,600 a seat a year figure is an older third-party estimate [U]. |

Prices exclude taxes and vary by currency [E].

#### B.1.4 The final outcome of hiQ v. LinkedIn

No. 17-cv-03301-EMC, N.D. Cal. [E].

- **2017:** a preliminary injunction let hiQ keep scraping public profiles [E].
- **2019, and again in 2022 after the Supreme Court vacated and remanded:** the Ninth Circuit upheld that injunction on the CFAA question [E]. **This was never a final ruling that scraping is lawful.**
- **November 2022:** the district court ruled that hiQ had breached the User Agreement, through its scraping and its use of fake identities [E].
- **December 6, 2022:** the parties stipulated to a consent judgment [E].
- **December 8, 2022:** the court entered the **Consent Judgment and Permanent Injunction** [E]:
  - **$500,000** against hiQ;
  - a permanent injunction against scraping LinkedIn in breach of the User Agreement without written permission, and against fake accounts;
  - deletion of the scraped member data and of the code.

  hiQ's stipulations to CFAA and trespass liability carry no precedential value [E].

**Lesson [I].** A breach-of-contract claim succeeds where a CFAA claim may not. Whoever accepted the terms (anyone with an account, a Sales Navigator seat or an API key) takes on the contract risk. Data bought from a vendor built on scraped LinkedIn data carries that vendor's exposure, and possibly a demand to delete.

#### B.1.5 Would automatically processing LinkedIn's alert emails breach the terms?

**Facts:**

- The copying clause covers information "obtained from the Services, whether directly or through third parties", used "without the consent of the content owner" [E].
- Sales Navigator is designed with no export, and CRM Sync is the only sanctioned route out [E].
- The Marketing API terms forbid combining member data "to build or enrich profiles or leads" [E].

These terms govern the APIs, but they show LinkedIn's stated position on member data [I].

**Inferences [I]:**

- **The copying clause is the stronger fit.** An alert email is information obtained from the Services. A mail rule plus a parser that writes job changes into our store copies and uses that information, for the profiles of members who never consented. That fits the copying clause more directly than the bots clause: the bots clause is about accessing the Services, and reading our own inbox is not that.
- **It also rebuilds the forbidden export.** It recreates, by another path, the export that LinkedIn withholds on purpose.
- **Following links is plain automated access.** If the parser followed links in the email, for example to the profile or to unsubscribe tracking, that would be automated access to the Services.
- **The Sales Solutions terms were not read [U].** They may add their own restrictions. This is a question for counsel (open question 16).

**Verdict: Not used, unless LinkedIn gives written permission.** The risk is not worth it: the evidence is a few alerts a week for a short list of accounts.

#### B.1.6 A compliant workflow

This is a **recommendation**.

1. **One Sales Navigator Core seat**, in a principal's own name and on a firm card. Core is enough for lead and account alerts and saved searches.
2. **The principal saves:**
   - each target bank (account) from the candidate list;
   - the ranked intermediaries (E19);
   - only leads already named in the account record from a public source (E7).
3. **Saved searches** as account searches. For example: banks in our five states, with title keywords for special assets, workout, credit administration and loan sales. Weekly alerts.
4. **Reading:** the principal reads the weekly digest or the alerts feed **in Sales Navigator or the email client**. No forwarding rule, no parser, no copy and paste of profile text.
5. **Logging by hand.** When an alert matters, the principal records a signal in their own words. This uses the existing principal-confirmation pattern of E19-S1; a small `outbound signals log` command is a possible later story [I]. The record holds:
   - the type: `person_moved`, `senior_hire`, `headcount_change`, or `hiring_special_assets`;
   - the institution key (`fdic:CERT` or `intermediary:<slug>`);
   - the date seen;
   - the source "Sales Navigator, seen by a principal";
   - who logged it.

   It holds **no profile URL, no LinkedIn text and no screenshot**.
6. **Corroborate before use.** A LinkedIn-sourced person change never confirms a role under E7. The briefer must find a public, non-LinkedIn source first: the bank's leadership page, a press release, a proxy or an association page. Only then may `account set-person` name the person.
7. **The signal shapes who and when, never the message text**, as for every signal.

---

### B.2 Loan-sale advisors, brokers and note marketplaces

#### B.2.1 Facts

| Source | What it gives | Access | Terms (quoted, tagged) | Cost | Signal and attaches to | Verdict |
|---|---|---|---|---|---|---|
| **DebtX** (`debtx.com`) | Deal archive (`/deal`) and current deals (`/deal-type/current-deals`). Each deal page has a title with size and often metro or state (for example a $6.4M San Diego office loan sale, $20.7M of CRE loans in Texas, a $7.8M mixed pool in CA) [E], plus status (Closed, Indicative Bid), seller type, bid date, loan and relationship counts and collateral [E]. Case studies [E]. **Seller named: 0 of 10 closed deals sampled, all "Seller: Bank"**, dated 2021 to 2026 [E]. Some deals list a credit union as seller [E]. | HTML. RSS not confirmed: the site looks like WordPress, so `/feed/` probably exists [I]. Also posts deals on Bluesky (`debtx.bsky.social`) [E]. Acquired by Heritage Global, announced January 12, 2026, on Business Wire [E]. | Terms not found by search [U]. robots.txt not read [U]. Data tapes and bidding need registration and a confidentiality agreement [U]. | Free to view [I] | Event: a loan or pool listed, or closed. Attaches to the **intermediary** (an E19-S1 mandate, kind `loan_sale_advisor`, seller "bank (described)") and to the E16-S8 listing ledger. Lead time: days to weeks before the bid date [I]. | **Build (gated)** on the terms check, or DebtX's written permission. Manual meanwhile. |
| **First Financial Network** (`www.ffncorp.com`) | Loan Sale Marketplace (`/loan-sale-marketplace/`), Buy Loans (`/buy-loans/`), quarterly loan-sale events, event pages (`/events/...`) and announcement PDFs (`/wp-content/uploads/...`) [E]. 2026 examples: a $22M CRE sale in the 4Q2026 quarterly event, bids due December 8, 2026; an $11M CRE and C&I sale; an SBA 7(a) sale; FDIC and agency sales [E]. **Seller named: 2 of 4 bank-seller sales seen.** Two 2026 announcement files carry a bank's name in their file names. Two other releases say "on behalf of a major bank" and "on behalf of a bank" [E]. FDIC sales name the failed bank [E]. | HTML plus PDFs (FlateDecode-style PDFs like the FDIC's [U]). RSS not confirmed; WordPress, so `/feed/` probably exists [I]. No wire releases found [E]. | Terms not found [U]. robots.txt not read [U]. Due diligence needs registration and a confidentiality agreement [U]. Doc 2.3 already lists FFN as "terms not found". | Free to view [I] | Event: a sale announced, with key dates. Attaches to the intermediary (mandate) and, **when the bank is named, to the bank** (E16 sale event "has sold"; E19-S4 route `advisor`). Lead time: 2 to 6 weeks to the bid date [I]. | **Build (gated).** The highest value of the advisors, because some announcements name the seller. |
| **Mission Capital Advisors** (`www.missioncap.com`; marketplace `market.missioncap.com`) | News (`/news/`), with a "Closed Deal" tag archive (`/news/tag/closed-deal/`) of "CLOSED DEAL ALERT" posts with size and asset type [E]. A marketplace serving sale-announcement memos (`/memo/export_memorandum/...`) [E]. Mandate releases ("Bank Taps Mission Capital…") [E]. **Seller named: 1 of 3 own posts sampled** (a 2013 release). The others say "a California bank" (2015) and "Regional Bank" in a recent closed-deal alert [E]. A 2026 trade-press item named a bank seller in a Mission Capital mandate [E]. A subsidiary of Marcus & Millichap [E]. | HTML; WordPress-style paths, so `/feed/` probably exists [I]. Posts closed deals on X (`@MissionCapital`) and LinkedIn [E]. | Terms page not found by search [U]. robots.txt not read [U]. | Free to view | As DebtX. Closed alerts give mandate history for the E19-S2 ranking. | **Build (gated).** Manual meanwhile. |
| **Garnet Capital Advisors** (`www.garnetcapital.com`) | Offerings page (`/auctionline`), with sale IDs and open dates. Example: a commercial sale of a $150M office loan portfolio, opened August 18, 2026 [E]. Mostly consumer, residential and charge-off portfolios [E]. Seller not stated in the excerpts [E]. | HTML. Releases on newswire.com [E]. | Terms not found [U] | Free to view | Few CRE bank sales. Intermediary mandate only. | **Manual** (low CRE yield) |
| **JLL Loan Sales Advisory** (`www.us.jll.com/en/solutions/loan-sales`; listings on `invest.jll.com`; newsroom `www.jll.com/en-us/newsroom`) | Service page with tombstones [E]. JLL Invest listings with **size and metro in the title**, for example "$10.3 Million Non-Performing Loan, Denver, CO" [E]. **Seller named: 0 of 5 listings sampled.** One says "commercial bank" and four say "the seller", with JLL "working exclusively for the seller" [E]. The service page names a seller in 1 of 2 tombstones seen (a regional bank holding company, about 2024); the other says "one of the country's largest banks" [E]. Cross-lists notes on Crexi [E]. | HTML | Terms of invest.jll.com not read [U]. Doc 2.3: free to view, an NDA for the offering memorandum, terms not found. | Free to view | Listing event with metro and size. Intermediary mandate. The tombstones give an occasional named seller (E16 "has sold"). | **Build (gated)** for invest.jll.com. Manual meanwhile. |
| **Newmark Loan Sale Advisory** (`www.nmrk.com/services/capital-markets/loan-sale-advisory`) | Service page: performing, sub-performing, non-performing and classified loan sales; a Los Angeles office [E]. Press releases (`/insights/press-releases/...`). **Seller named: 1 of 2 releases seen** (a bank, 2023); the 2025 release seen does not name one [E]. Newmark was the FDIC's advisor on a large failed-bank CRE portfolio in 2023 [E]. | HTML press releases. Corporate wire use not checked [U]. | Terms not read [U] | Free | Intermediary mandate. A named bank seller occasionally. | **Manual** (few posts) |
| **CBRE National Loan & Portfolio Sale Advisory** (`www.cbre.com/.../loan-and-portfolio-sales`) | Service page [E]. A 2025 capabilities PDF on `mediaassets.cbre.com` with a deal table, including bank sales and a Denver office example [E]. Trade press covers its deals [E]. Seller naming in its own materials not counted [U]. | HTML or PDF | Terms not read [U] | Free | Intermediary mandate (from the PDF) | **Manual** (an annual read of the capabilities PDF) |
| **Cushman & Wakefield Loan Sales** (`www.cushmanwakefield.com/en/united-states/services/capital-markets/loan-and-portfolio-sales`) | Service page: lenders, special servicers, FDIC and agency sales [E]. Its listings run on RealINSIGHT Marketplace and the Revere platform: a Los Angeles non-performing office note auctioned April 13–15, 2026, and a $64.8M non-performing loan sale [E]. **Seller named: 0 of 2** [E]. | HTML; listings on third-party platforms | Terms not read [U] | Free | Listing event (metro, size). Intermediary mandate. | **Manual** (through the RealINSIGHT and Revere alerts) |
| **Eastdil Secured** | No public loan-sale tombstones or listings found. Mentioned only in trade league tables [E]. | — | — | — | — | **Not used.** Watch the trade press. |
| **Walker & Dunlop** | In Q3 2026 it is **selling its own** repurchased agency notes and foreclosed assets, mostly in Q4 2026 and the rest early in 2027, per its earnings call [E]. No loan-sale advisory for banks found [E]. | SEC filings, earnings calls | — | — | A seller event, not a bank. Context only. | **Not used** (the EDGAR listener already sees its 8-Ks [I]) |
| **Berkadia** | Newsroom of property sales and financings. No note or loan-sale advisory found [E]. | HTML | — | — | — | **Not used** |
| **Ten-X** (`www.ten-x.com/search/commercial-notes-for-sale/`) | A commercial notes search page still exists, undated [E]. The participation terms require note buyers to be accredited investors (Rule 501(a) of Regulation D) [E]. CoStar-affiliated (a `costar.com/ten-x` page) [E]. | HTML | Doc 2.6 (Seen): the terms bar building databases. This pass could not re-read them [U]. | Free to view; buyer's premium [U] | Listing event | **Not used** (terms) |
| **Crexi** (`www.crexi.com`, notes under `/properties/...Note-Loan`) | Note and loan listings, including NPLs cross-listed by JLL and pools from Xchange.Loans [E]. Listings carry the city and state [E]. Seller not named in the excerpts [E]. | HTML; account alerts [U] | The Master Service Agreement (`/msa/`) prohibits "any unauthorized data mining, scraping, robot or other automated data gathering" [E]. The general ToS at `/tos` was not read [U]. | Free to browse; paid tiers [U] | Listing event (metro, size) | **Manual** (a principal's saved-search alerts). No Build. |
| **RealINSIGHT Marketplace** (`rimarketplace.com`, `marketplace.realinsight.com`) | Sale events for "real property, mortgage notes, mezzanine notes or any other type of property, sold on behalf of the owners" [E]. Reserve auctions; some "Subject to Seller Approval" [E]. Bidders must "electronically execute a confidentiality agreement" for the data room [E]. **Listings name the platform and the sales agent, not the seller** [E]. Operated by CWFS-REDS LLC and CWFS Insight LLC; Maryland law [E]. | HTML; account alerts [U] | Terms of Service at `/legal/terms-of-service`: the automated-access clause was not returned [U] | Free to browse | Listing event; the sales agent is the intermediary | **Manual** |
| **Xchange.Loans** (`xchange.loans`) | A CRE loan marketplace with active and closed listings; "no seller fees"; most listings close in under 60 days [E]. Partnered with Matthews (2025) for sealed-bid note sales [E]. A sponsor of IMN's Bank Special Assets Texas [E]. Built for lenders selling non-performing CRE loans [E]. | HTML; also on Crexi [E] | Terms not found [U] | Free to browse [U] | Listing event | **Manual**; recheck the terms |
| **Revere CRE platform** (`platform.reverecre.com`) | A deal-marketing platform hosting brokers' loan-sale project pages (for example the $64.8M NPL above) [E] | HTML; logins for deal rooms [U] | Not read [U] | — | Listing event via the broker | **Manual** |
| **Hilco Real Estate Sales, note sales** (`hilcorealestatesales.com/expertise/note-sales/`) | A note-sales practice page [E] | HTML | Not read [U] | — | Intermediary | **Manual** (low priority) |
| **LoanMLS** | Status conflicts. A 2025 article calls it a note marketplace [E]. An October 2026 comparison page says it no longer operates and the domain redirects [E, secondary]. | — | — | — | — | **Not used** |
| **Auction.com (commercial)** | Historical commercial note and asset closings [E]. No 2026 commercial note activity found; its 2026 reports are residential [E]. | — | Not read [U] | — | — | **Not used** (recheck yearly) |
| **Trade press: Commercial Real Estate Direct** (`crenews.com`, "Loan Offerings (LOAN)" subject archive) | 2026 items name the **bank seller and the advisor**, for example a May 2026 Texas office loan offering by a named bank through Mission Capital [E] | HTML, paywalled [U] | Subscription terms not read [U] | Subscription; price not found [U] | Event: an offering, with the seller named. Attaches to the **bank** (E16 sale event) and the intermediary (E19 mandate). | **Licensed only** (automated use), or **Manual** (a principal reads it) |
| **Trade press: Commercial Mortgage Alert** (Green Street, `greenstreetnews.com`) | A weekly with a "Loan sales" section [E] | Paywalled; 3-week free trial [E] | Not read [U] | "Upwards of $8,000" a year [E, secondary] | As CRE Direct | **Licensed only** or **Manual** |

#### B.2.2 Inferences

- **What a listing really tells us [I].** The advisors' own listings almost never name the seller. Their value is the **metro, size, property type and timing**, plus the **advisor**, which is a mandate for E19-S1. The seller comes from:
  - FFN's announcements, sometimes;
  - the large brokers' tombstones, occasionally;
  - the trade press, more often.
- **"A regional bank" is not matchable.** E16-S8's `listingEvent` already keeps the seller unknown. Add an optional `sellerDescription` (for example "bank", "regional bank", "credit union"), shown to a principal but never used to match a bank. A described seller must never be guessed into a `fdic:CERT` [I].
- **RSS.** Mission Capital, FFN and DebtX use WordPress-style paths (`/news/tag/...`, `/wp-content/uploads/...`, `/deal-type/...`), so `/feed/` is likely. That would be a cheaper and gentler poll than HTML [I, to confirm in the second pass].
- **Buyer-list registration** (E19-S3) puts the firm on the advisors' email blasts. Those are timelier than the web pages [U]. Whether the registration terms allow parsing those emails into the ledger is an open question (open question 18). Assets learned under an NDA already go to the NDA list (E19-S3).

#### B.2.3 Fit with E19 and E22

- **E19-S1** gains a feeder per advisor: `listingEvent` becomes a mandate `{ intermediary, kind: loan_sale_advisor, seller (often unknown), date, metro, propertyType, balance, sources }`.
- **E19-S2:** listing counts in our metros feed the ranking.
- **E19-S3:** registration status for DebtX, FFN, Mission Capital, JLL, CBRE, Newmark, C&W and Xchange.Loans.
- **E19-S4 and the E22 `advisor` route:** only when a source names the bank as seller (FFN announcements, broker tombstones, trade press).

---

### B.3 Job postings as a signal

#### B.3.1 Facts

| Source | What it gives | Access | Terms (quoted, tagged) | Cost | Signal and attaches to | Verdict |
|---|---|---|---|---|---|---|
| **Which ATS banks use** (a sample) | In a search for special-assets postings, the hosts seen were **Paylocity (2), Workable (2) and iCIMS (1, through an aggregator)**. The rest were aggregators: Indeed, ZipRecruiter, career.com [E]. **None on Greenhouse or Lever** [E]. No market-share data for community banks found [E]. | — | — | — | — | Context |
| **Greenhouse Job Board API** (`boards-api.greenhouse.io/v1/boards/{board_token}/jobs`; docs `developers.greenhouse.io/job-board.html`) | A company's open jobs as JSON [E] | Documented; GET needs no authentication; only the application POST uses Basic Auth [E] | The docs describe the data as public and meant for career pages and syndication [E]. A secondary page says the docs carry no terms of use or redistribution statement [E, secondary], so reuse rights are unclear [U]. | Free | A special-assets posting at a bank on Greenhouse. Attaches to the bank. | **Build** (cheap, documented), **but low coverage** of banks [I] |
| **Lever Postings API** (`api.lever.co/v0/postings/{site}?mode=json`; EU `api.eu.lever.co`) | Open postings as JSON [E, secondary] | Public, no key [E, secondary]. Official client at `github.com/lever/postings-api` [E]. | Terms not found [U] | Free | As Greenhouse | **Build** (low coverage) |
| **Workday** (`*.myworkdayjobs.com`, path `/wday/cxs/{tenant}/External/jobs`) | JSON behind the careers site [E, secondary] | **Undocumented**: "not documented as a public contract" and can change without notice [E, secondary]. The official REST API needs per-tenant OAuth [E, secondary]. Some tenants return 401 or 422 [E, secondary]. | Not read [U] | — | — | **Not used** (doc 2.6 agrees) |
| **iCIMS, UKG, Paycom, ADP, Paylocity, Workable** | Hosted careers pages | No public documented read API found for iCIMS, UKG, Paycom, ADP or Paylocity [U]. Workable has a public jobs widget [U]. | Not read [U] | — | — | **Not used**, except through a licensed vendor |
| **Indeed** | The **Publisher job-search API is deprecated**: sign-ups closed about 2020 and the endpoint was dark by about 2023–24 [E, secondary; dates conflict]. The **Job Sync API** is GraphQL for ATS partners to *post* jobs, and needs partner approval [E: `docs.indeed.com/job-sync-api`]. The other partner APIs are employer-side [E, secondary]. | No read API | Indeed's terms not read [U] | — | — | **Not used** |
| **Google for Jobs** | No public read API. The old Jobs API shut down in 2021, and Cloud Talent Solution searches only your own jobs [E, secondary]. Google's documentation covers publishing your own jobs [E, secondary]. | — | Automated querying of Google Search is against Google's terms [U] | — | — | **Not used** |
| **LinkUp** (`www.linkup.com/data`) | Job listings "collected directly from employer websites by indexing jobs that are publicly available" [E: the FactSet listing, repeated on LinkUp's own pages]. Employers counted at 75,000 to 86,000 [E]. Daily feeds; raw and custom feeds [E]. "Does not intentionally collect personal data" [E]. | Licensed feed or API | Licence terms not read [U] | Quote [U] | A special-assets, workout, loan-sales or credit-resolution posting at a target bank. Attaches to the bank. | **Licensed only.** **Lowest LinkedIn risk:** employer sites only, by its own account [I]. |
| **Lightcast** (`docs.lightcast.io`, `kb.lightcast.io`) | **Postings:** "over 220,000 current and historical sources", "publicly available online job boards and company websites", deduplicated daily [E]. **Profiles:** 600M+ profiles. "The most common source of data that Lightcast hold on profiles are from online professional network sites" [E]. Lightcast will not list its sources [E]. | Licensed | Not read [U] | Quote [U] | As LinkUp (postings) | **Licensed only, postings product only.** Its profiles are likely LinkedIn-derived [I]. Whether LinkedIn job ads are among the job-board sources is unconfirmed [U]. |
| **Revelio Labs** (`www.reveliolabs.com`) | Profiles "from networking sites, mainly LinkedIn" [E: the RPLS methodology]. Postings from company pages and "job boards such as LinkedIn and Indeed" (the COSMOS data set) [E]. | Licensed, platform or API | Not read [U] | Quote; trial [E] | — | **Not used: LinkedIn-derived** [E] |
| **Coresignal** (`coresignal.com`) | Data "collected exclusively from publicly available online sources", which "primarily encompass professional social networks" [E]. Says it never collects from behind logins [E]. | Self-serve API | Not read [U] | Mini plan $49 a month for 2,500 credits [E]. Higher tiers $800 to $1,500 a month [E, secondary]. | — | **Not used: most likely LinkedIn-derived** [I] |
| **People Data Labs** (`docs.peopledatalabs.com/docs/data-sources`) | Two kinds of sources: "proprietary" (the "Data Union" of contributing customers and partners, about 45M records a month, the large majority of person data) and "public data sources" [E]. The public sources are not listed [E]. A secondary page says it does not supply raw LinkedIn data [E, secondary]. Older anecdotes say LinkedIn-derived fields were present [U]. | API | Not read [U] | Pro $98 a month for 350 person credits; free tier of 100 a month [E, secondary] | Job-change enrichment for a known person | **Not used** for signals. Its LinkedIn provenance is unknown [U], and buying person records adds CCPA exposure (B.6.5). |

#### B.3.2 Inferences

- **The signal is noisy [I].** Indeed shows tens of thousands of results for "bank special assets officer" [E]; the count includes broad matches. Special-assets roles exist in normal times. A posting is a **modifier**, never a trigger.
  - Stronger forms: "loan sales" or "note sales" named in the duties, a new "Director of Special Assets" role, several postings at once, or a posting soon after a pressure signal (an enforcement order, the concentration screen, rising noncurrent loans).
  - It attaches to the **bank**, with a **lead time of months**: the hire comes before workout volume and any sale [I].
- **Coverage [I].** Greenhouse and Lever are cheap and documented, but community banks seldom use them (none in the sample). A licensed employer-site feed (LinkUp) is the only route with both coverage and clean provenance.
- **Provenance rule [I].** Any job or people dataset whose vendor names LinkedIn, or "professional networks", as a source inherits the LinkedIn risk of B.1. Licence it only with a warranty that it holds no LinkedIn-scraped data, and choose postings products over profile products.

#### B.3.3 Fit and recommendation

- **E22:** none directly. A job posting names a role, not a person. The pipeline must never chase the hire's name from a profile [I].
- **Scoring:** an event signal `hiring_special_assets`, `kind: 'event'`, attached to `fdic:CERT`, shaping when only.
- **Recommendation:**
  - ask LinkUp for a quote filtered to the candidate universe and the title keywords;
  - meanwhile, a Greenhouse and Lever adapter only for banks found on those boards (probably few);
  - Sales Navigator's "increased number of posted jobs" account alert, read by hand (B.1.3).

---

### B.4 Public-notice websites (trustee's sale and foreclosure notices)

#### B.4.1 Facts

| Source | What it gives | Access | Terms (quoted, tagged) | Cost | Signal and attaches to | Verdict |
|---|---|---|---|---|---|---|
| **Arizona: arizonapublicnotices.com** (Arizona Media Association) | Notices uploaded by Arizona newspapers; free [E]. One-word and phrase search across all publications [E: `/Help.aspx`]. **Law:** a notice of trustee's sale must be published "at least once a week for four consecutive weeks" in a newspaper of general circulation in the county (A.R.S. 33-808) [E: azleg.gov]. The statutory form (33-808, subsection C or D) includes the beneficiary's and trustee's names and addresses [U: the search did not return the form]. | HTML search; an email alert feature like Colorado's is likely, since the Arizona Newspapers Association licensed its software to other states [E], but it is not confirmed for Arizona [U] | Terms and robots.txt not read [U] | Free [E] | Event: a notice of trustee's sale. Attaches to the enforcing lender (beneficiary), the trustee and counsel: E22-S3 counsel events and E5 county events. Lead time: about 91 days to the sale [E: doc 2.3]. | **Manual** now. Build (gated) if the terms allow. **Maricopa's recorder is earlier** (B.4.2). |
| **Texas: texaspublicnotices.com** (Texas Press Association) | A statewide repository since early 2022 [E]. Gov. Code 2051.054 (SB 943, effective September 1, 2023): if the Association keeps a statewide site, newspapers send their notices to it, and it must be free, updated as notices arrive, and searchable by subject and location [E]. "Not a substitute for the official publication" [E]. **But a Texas notice of trustee's sale is posted at the courthouse, filed with the county clerk and sent by certified mail. Prop. Code 51.002 requires no newspaper publication** [E: statute excerpts]. **The county must post a filed notice on its website, "publicly available for viewing without charge or registration"** [E]. | HTML search | Not read [U] | Free [E] | Few Texas foreclosure notices [I] | **Not used** for foreclosures. The county pages already in doc 2.3 (Travis) are the primary source. |
| **Colorado: publicnoticecolorado.com** (Colorado Press Association) | A database of all notices in Colorado papers of record, with an archive of several years [E]. Upload is required by law (C.R.S. 24-70-103, per a practice manual) [E]. The public trustee's combined notice is published once a week for five consecutive weeks [E]. **SmartSearch:** sign up, confirm by email, choose daily emails [E: `/SmartSearchSignup.aspx`]. | HTML; SmartSearch email alerts [E] | Not read [U] | Free [E] | As Arizona. The combined notice names the holder of the debt and the lender's attorney [U for the published text; doc 2.3 has "Seen" for the public trustee's filing]. | **Manual** at most. The public trustees' own pages (doc 2.3, phase 1) are **earlier** and already planned. |
| **California: capublicnotice.com** (California News Publishers Association) | A statewide site that aggregates notices from member newspapers [E]. **Participation is voluntary.** AB 2095, which would have required newspapers to post notices online and link to this site, was **vetoed in 2024** [E]. Trustee's sale notices are published in newspapers [E]. Whether the site carries them, by county, is not known [U]. A published notice of trustee's sale names the trustee and usually the beneficiary [U]. The publication rule (Civil Code 2924f) was not confirmed by this search [U]. | HTML; alerts not found [E] | Not read [U]. The bill text says newspapers "shall not charge a fee … to access public notices" [E], but it was vetoed. | Free [I] | Event: a notice of trustee's sale, with the trustee and lender in the text. **Potentially the only free source of lender and trustee names for Los Angeles**, where the recorder offers no online access [E: doc 2.3], **and San Diego**, where images are not online [E: doc 2.3] [I]. | **Manual**, then a coverage spike (open question 19) |
| **Nevada: nevadapublicnotice.com** (Nevada Press Association) | Notices from Nevada newspapers, "posted … as a public service" [E]. **"Subscribe … with a keyword or phrase, so that when a notice is uploaded … you receive an email"** [E]. The NPA's 2017 guide pointed to publicnoticeads.com [E]. Do not confuse it with `notice.nv.gov`, the state's site for public-body meetings [E]. The publication rule for a notice of trustee's sale (NRS 107.080) was not confirmed by this search [U]. | HTML; keyword email alerts [E] | Not read [U] | Free [E] | As California: text for Clark County, where recorder images are not online [E: doc 2.3] [I] | **Manual**, then a spike |
| **publicnoticeads.com** | A hub that links state sites [E] | — | Not read [U] | — | — | Not used (index only) |
| **usalegalnotice.com** (Newspaper Association Managers) | Links to 47 statewide notice sites [E] | — | — | — | — | Not used (index only) |
| **National Law Review: "Distressed Deal Alert" and "NPNS Weekly Update"** (`natlawreview.com/newsletters`) | Since July 15, 2025, two weekly emails [E]:<br>• **Distressed Deal Alert:** new distressed transactions with bid deadlines, auction dates and contacts;<br>• **NPNS Weekly Update:** public notices on its affiliated sites, covering bankruptcy, receivership and **UCC Article 9 sales**.<br>An affiliate claims 22,000 and 5,000 subscribers [E, secondary]. | Email | Not read [U] | Price not found [U] | Event: a UCC sale or receivership. Attaches to the secured party, usually a lender or fund [I]. | **Manual** (a principal subscribes) |
| **California Attorney General residential foreclosure-sale database** | Residential only [E] | — | — | — | — | **Not used** |

#### B.4.2 Inferences

- **Is a notice site timelier than the county recorder [I]? No, in every state where the recorder has an online index.**
  - Newspaper publication follows the recording or filing, and the upload follows the newspaper's run.
  - Arizona's first publication may come days or weeks after Maricopa records the notice.
  - Colorado's public trustees post the filing before the five-week publication run.
  - In Texas the county website is the primary source.
- **Where notice sites help: names, not timing.** They help for the counties whose document images are not online: **Los Angeles, San Diego and Clark**. There, the published text may carry the trustee, the beneficiary (lender) and sometimes the lender's counsel. That is the counsel and lender evidence that doc 2.3 says needs a vendor or ordered copies.
  - If the coverage spike shows these notices on the CA and NV sites, they become a **free substitute for part of the PropertyRadar or ATTOM spend (D1)**, though later than the recorder [I].
  - The California notice of default is recorded but not published [U], so the earliest California event stays recorder-only.
- **Alerts first.** Email alerts (Colorado's SmartSearch, Nevada's keyword subscription) are notifications to the firm. Reading them is Manual. Parsing them automatically needs the terms check, or the association's permission [I]. Press associations exist to widen public access, so asking for permission is reasonable [I].
- **Commercial filtering.** Notices name no property type. Join on the address or APN to the assessor data already planned (doc 2.3), and keep only commercial [I].

#### B.4.3 Fit

- **E22-S3** (the county-record counsel feeder): published notice text is a candidate feeder for CA and NV, once tested.
- **E19-S1:** trustee companies and lender counsel become `trustee_counsel` and `lender_counsel` mandates.
- **The rule stays:** asset-level details (property, borrower) are for a principal only.

---

### B.5 Conference and association rosters (the E22 "forum" routes)

#### B.5.1 Facts

| Source | What it gives | Access | Terms (quoted, tagged) | Cost | Signal and attaches to | Verdict |
|---|---|---|---|---|---|---|
| **CREFC** (`www.crefc.org`) | **Public:** conference program pages with sessions and speakers (June 2026 conference, New York, June 8–10) [E]; forum chairs (doc 2.4, Seen). **Attendee list:** "only accessible for up to 30 days after the conference ends", to **registered in-person attendees only**; "contact information for attendees is a CREFC Member benefit and is only available to CREFC Members"; "the official conference attendee list is exclusively provided by CREFC" [E: the "See Who's Attending" page of the January 2026 conference]. The member directory is members-only [U]. A third party (Vendelux) sells a "predicted" attendee list [E]. | HTML (public). App or portal (attendees). | As quoted. The site's terms of use were not read [U]. | Free to read. Registration and membership are paid [U]. | `bank.memberships` findings (forum route): a bank's officer on a CREFC panel. Intermediary corroboration: special servicers, advisors. | **Manual / briefer** (public program pages, read at research time). Attendee list: **Not used** in the pipeline. A registered principal may use it in person only. Vendelux: **Not used**. |
| **IMN / Informa Connect** (`informaconnect.com`) | **Public speaker pages:**<br>• **Bank Special Assets Texas**, December 1–2, 2026, Dallas (`/imn-bank-dallas/`), whose speakers include bank special-assets executives [E];<br>• **Bank Special Assets East** (`/imn-bank-east/`) [E];<br>• **Distressed CRE West** (`/imn-distressed-cre-west/speakers/` and `/agenda/`, July 2026) [E];<br>• **Distressed CRE East** [E].<br>Sponsor pages (for example a loan marketplace sponsoring the Texas event) [E]. **Attendee lists:** at Informa events, the list is in the event app, from about 3 weeks before the event, "does not export into excel and is only viewable within the app" [E: an exhibitor FAQ]. At one Informa event: "We do not distribute attendee list nor do we sell attendee list" [E]. | HTML (speakers, agenda, sponsors). App (attendees). | The attendee-list wording as quoted [E]. The IMN event terms were not read [U]. | Free to read. Registration paid [U]. | **The best forum source [I].** Bank special-assets officers on panels give `bank.memberships` findings and forum targets. Sponsors and speakers from advisors give E19 corroboration. | **Manual / briefer.** A principal-maintained list of event URLs that the briefer reads. **Highest priority among the forum sources.** |
| **MBA CREF Convention** (`www.mba.org/conferences-and-education/cref-convention-expo`) | **Public:** featured speakers; an agenda PDF naming speakers by session; some sessions marked "Open to MBA Members; Closed to Media"; a sponsor list by tier [E]. The February 8–11, 2026 event has passed [E]. Attendance estimated at 3,000+ [E, secondary]. **Attendee-list policy: not found** [E]. The MBA CRE Servicing Solutions Conference also publishes its schedule [E]. | HTML or PDF | Not read [U] | Paid | Servicers' and lenders' people as forum targets. Few community banks [I]. | **Manual / briefer** (lower value for our banks) |
| **RMA** (`www.rmahq.org`, `community.rmahq.org`) | **Public:**<br>• the national conference's "Featured Speakers" page [E];<br>• chapter event pages: the **Texas chapter's 2026 spring conference in Austin (April 9–10)**, listing real-estate and credit-quality topics [E], and a 2026 distressed-CRE panel at another chapter whose panelists included a bank's special-assets officer [E];<br>• an event calendar [E]. | HTML | Not read [U]. The member directory was not found [E] and is presumed members-only [U]. | Paid membership [U] | **Chapter pages in TX, AZ, CO, CA and NV name community-bank credit and special-assets people [I].** Forum route. | **Manual / briefer** |
| **ABA** (`www.aba.com`) | The Conference for Community Bankers, February 15–17, 2026, Orlando; a program download [E]. **2027: February 14–16, Chula Vista, California** [E]. Attendee lists not public [I]. | HTML or PDF | Not read [U] | Paid | Mostly bank CEOs and regulators [I]. A weak forum route. | **Manual** (low) |
| **Texas Bankers Association** (`www.texasbankers.com`) | Convention May 20–22, 2026, Dallas; the agenda and a recap are public [E]. Member directory not found [E]. | HTML | Not read [U] | Paid | Forum route for Texas banks | **Manual / briefer** |
| **Independent Bankers Association of Texas** (`membership.ibat.org`) | Convention pages; law firms list panels at its conventions [E] | HTML | Not read [U] | Paid | As TBA | Manual |
| **Arizona Bankers Association** | A "Banker Summit" program published on issuu (2024) [E]. Directory not found [E]. Its host was not confirmed: probably `azbankers.org` [U]. | HTML or issuu | Not read [U] | Paid | Forum route for Arizona banks | Manual |
| **Colorado Bankers Association** (`www.coloradobankers.org`) | "Over 126 banks and 20,000 banking professionals" [E: a Denver Chamber listing]. Directory not found [E]. | HTML | Not read [U] | Paid | Forum route | Manual |
| **California Bankers Association** (`www.calbankers.com`) | Event pages with speakers and handouts: **Lending & Credit Conference, November 3–5, 2026**; Risk & Compliance; the annual conference; the Bank Presidents Seminar [E] | HTML | Not read [U] | Paid | **The Lending & Credit Conference is the best state-level forum source for credit officers [I].** | **Manual / briefer** |
| **Nevada Bankers Association; Western Bankers Association** | Nothing found [E] | — | — | — | — | Recheck |

#### B.5.2 Inferences and rules for the pipeline

- **The briefer already has the right rule:** public pages only, never a members-only directory or a login-gated attendee list (E22-S2). Speaker pages fit `bank.memberships`. E22-S4's limits apply: one association per finding, and people only as forum targets.
- **The speaker-to-association link [I].** IMN's single-event pages name one event (one association) per page, so they avoid the "more than one association" drop in E22-S4 by construction.
- **The registered attendee's own use [I].** An attendee list received as a registered attendee is for that principal's in-person networking under the organizer's terms. It must not be loaded into `network/`, `contacts/` or research, or used to email people. CREFC limits contact details to members and to 30 days [E]. Informa keeps lists in-app and unexportable [E].
- **An event calendar, not a crawler [I].** Keep a small, principal-maintained list in config: event name, host, URL and dates, for about 10–15 events (IMN Bank Special Assets Texas, East and West, Distressed CRE West and East, CREFC January and June, CBA Lending & Credit, RMA chapter conferences in TX, AZ and CO, TBA, IBAT). The briefer reads those URLs only when researching an account. Nothing polls.

---

### B.6 Other sources

| Source | What it gives | Access | Terms (quoted, tagged) | Cost | Signal and attaches to | Verdict |
|---|---|---|---|---|---|---|
| **X (Twitter) API** (`docs.x.com`) | Posts from advisor accounts, for example one advisor's closed-deal posts [E] | **Pay-per-use is the default:** $0.005 per post read, $0.010 per user read, $0.015 per post created ($0.20 with a link). A monthly read cap of 2M or 3M before Enterprise (sources conflict). Legacy Basic ($200 a month) migrated after June 1, 2026. Pro ($5,000 a month) being retired; date unconfirmed. Enterprise about $42,000 to $50,000 a month. [All E, secondary; the official pricing page was not returned.] | **Developer Agreement, last updated April 27, 2026** [E]:<br>• delete X Content within 24 hours of a deletion request or of removal, and keep offline copies in sync [E];<br>• "off-X matching" (linking a handle to a person) needs express opt-in consent [E];<br>• restricted uses include investigating or tracking X users and "tracking, alerting, or monitoring" [E].<br>**ToS:** crawling or scraping without prior written consent has been prohibited since September 29, 2023 [E: TechCrunch]. Liquidated damages of $15,000 per 1,000,000 posts accessed in breach within 24 hours [E, secondary]. Forum: Tarrant County, Texas [E, secondary]. | Cents a month at our volume [I] | Advisor deal posts duplicate their websites [I] | **Not used.** Low yield, and the "monitoring" restriction is ambiguous for following company accounts (open question 24). A principal may follow accounts by hand. |
| **Bluesky** | DebtX posts deal listings there [E] | The AT Protocol's public API [U] | Not read [U] | Free [U] | Duplicates debtx.com [I] | Not used (the website is enough) |
| **YouTube Data API** | Conference talks | Not searched (budget). From memory: free with a daily quota, and the developer policies limit data storage [U]. | [U] | Free [U] | Little: talks name speakers that the event pages already list [I] | **Not used** |
| **Podcasts and newsletters** | **Notable:** the National Law Review's Distressed Deal Alert and NPNS (B.4) [E]; Commercial Mortgage Alert and CRE Direct (B.2) [E]. Not searched further [U]. | Email or subscription | [U] | Varies | — | **Manual** for NLR; **Licensed only** for CMA and CRE Direct |
| **State UCC search** | Nothing found beyond doc 2.3 (not searched: budget) [U] | — | — | — | — | No change: Low (later) |

#### B.6.5 Personal data: what the pipeline must not do

These are **rules for the pipeline**, not legal advice. The CCPA, TDPSA, CPA, Nevada and Arizona facts were not searched (the budget ran out) and are [U] from memory. Counsel should confirm them (open question 25). CAN-SPAM is Seen in the repo's doc 2.4.

**The law in brief:**

- **California (CCPA as amended by CPRA) [U]:**
  - It covers California residents' personal information, **including business contact and employee information since the B2B and HR exemptions lapsed on January 1, 2023** [U].
  - It applies to businesses over the revenue threshold (about $25M, indexed), or that buy, sell or share the personal information of 100,000 or more consumers or households, or that earn half their revenue from selling or sharing it [U].
  - It gives rights to know, delete, correct and opt out of sale or sharing, and requires notice at collection and data minimization [U].
  - The Delete Act's DROP platform (data brokers process deletion requests from August 2026) applies to **data brokers**. The firm is not one if it does not sell personal information [U].
- **Texas TDPSA and Colorado CPA** exclude people acting in a commercial or employment context [U]. **Nevada** (NRS 603A) gives an opt-out of sale [U]. **Arizona** has no comprehensive privacy law [U].
- **CAN-SPAM:** "no exception for business-to-business email" (FTC, doc 2.4, Seen). It requires:
  - honest headers and subject lines;
  - a physical postal address;
  - a working opt-out, honoured within 10 business days [U for the 10 days].
- **LinkedIn** warns that automated activity "may be a violation of privacy legislation" [E]. **X** requires opt-in consent for off-X matching [E].

**The pipeline must not:**

1. Scrape, or automatically ingest, LinkedIn pages, alert emails or exports; or buy data that its vendor sourced from LinkedIn (Revelio, Coresignal, Lightcast profiles).
2. Build a profile of a person by **combining sources** (a job change, plus an address, plus conference attendance). Keep only what E7 needs: a name, a role at the institution with a source, and a verified business address.
3. Store any person's data from an attendee list, a members-only directory, or anything behind a login.
4. Infer or store sensitive information (health, family and the like) about anyone.
5. Email any address that E7 has not sourced and verified, or skip the CAN-SPAM elements, or ignore an opt-out. The guard enforces these today; no new source may go around it.
6. Keep a person's record after a deletion request. `forget` (E7-S3) must cover any new store. That includes a manual signal log, if it ever names a person; better that it names only the institution (B.1.6).
7. Put a job-change or people signal into a message. Signals shape who and when only.
8. Send personal data from a new source to a model-facing step (the briefer's prompt, the drafter), beyond what E7 already allows.

### B.7 Hosts to allow for a primary-source pass

**Blocked this session.** Every host below was read only through search excerpts. One fetch was tried, on `www.linkedin.com`, and it failed to resolve. By instruction, no other host was tried, so each one below is unread at the primary source.

| Host | URLs needed |
|---|---|
| **LinkedIn** | |
| `www.linkedin.com` | `/legal/user-agreement` (section 8.2 and date); `/robots.txt`; `/legal/crawling-terms`; `/help/linkedin/answer/a1341387`; `/help/linkedin/answer/90586`; `/help/sales-navigator/answer/a105133`; `/help/sales-navigator/answer/a102024` |
| `legal.linkedin.com` | `/api-terms-of-use`; the Sales Solutions and Sales Navigator product terms (find from the index) |
| `business.linkedin.com` | `/sales-solutions/compare-plans`; `/sales-solutions/partners/become-a-partner`; `/sales-solutions/sales-navigator-data-and-privacy-resources-new` |
| `learn.microsoft.com` | `/en-us/linkedin/marketing/restricted-use-cases`; `/en-us/linkedin/sales/sync-services/` |
| **Advisors** | |
| `www.missioncap.com` | `/robots.txt`; `/feed/`; `/news/tag/closed-deal/`; the terms or privacy page from the footer |
| `market.missioncap.com` | `/robots.txt`; the marketplace terms |
| `debtx.com` | `/robots.txt`; `/feed/`; `/deal`; `/deal-type/current-deals`; the terms of use from the footer |
| `www.ffncorp.com` | `/robots.txt`; `/feed/`; `/loan-sale-marketplace/`; `/buy-loans/`; `/quarterly-loan-sale-event/`; the terms from the footer |
| `www.garnetcapital.com` | `/robots.txt`; `/auctionline`; the terms |
| `invest.jll.com` | `/robots.txt`; the terms of use; the listings index |
| `www.us.jll.com` | `/en/solutions/loan-sales` |
| `www.jll.com` | `/robots.txt`; the terms of use |
| `www.nmrk.com` | `/robots.txt`; `/services/capital-markets/loan-sale-advisory`; `/insights/press-releases` |
| `www.cbre.com` | `/robots.txt`; the loan-and-portfolio-sales page |
| `mediaassets.cbre.com` | the 2025 National Loan & Portfolio Sale Advisors capabilities PDF |
| `www.cushmanwakefield.com` | `/en/united-states/services/capital-markets/loan-and-portfolio-sales`; `/robots.txt` |
| `www.ten-x.com` | `/robots.txt`; `/search/commercial-notes-for-sale/`; `/company/legal/participation-terms`; the terms of use |
| `www.crexi.com` | `/tos`; `/msa/`; `/robots.txt` |
| `rimarketplace.com` | `/legal/terms-of-service`; `/legal/listing-terms`; `/legal/auction-terms`; `/robots.txt` |
| `marketplace.realinsight.com` | `/sales`; `/robots.txt` |
| `xchange.loans` | `/robots.txt`; the terms of use; the listings |
| `platform.reverecre.com` | the terms; `/robots.txt` |
| `hilcorealestatesales.com` | `/expertise/note-sales/` |
| `www.auction.com` | the commercial note pages; the terms |
| `crenews.com` | `/subject/loan-offerings-loan/`; the subscription terms |
| `greenstreetnews.com` | the Commercial Mortgage Alert subscription terms and price |
| **Jobs** | |
| `developers.greenhouse.io` | `/job-board.html` |
| `boards-api.greenhouse.io` | `/v1/boards/{token}/jobs` (a test) |
| `www.greenhouse.com` | `/legal` (API and website terms) |
| `api.lever.co` | `/v0/postings/{site}?mode=json` (a test) |
| `hire.lever.co` | `/developer` |
| `github.com` | `/lever/postings-api` |
| `docs.indeed.com` | `/job-sync-api` |
| `www.indeed.com` | `/legal` |
| `www.linkup.com` | `/data`; `/products/raw`; the licence terms |
| `data.support.linkup.com` | the methodology articles |
| `kb.lightcast.io` | `/en/articles/6957504-profiles-methodology`; `/en/articles/7124763-data-collection-and-processing-methodology` |
| `docs.lightcast.io` | `/data/docs/whats-the-complete-list-of-sources-lightcast-uses` |
| `www.reveliolabs.com` | `/public-labor-statistics/methodology` |
| `www.data-dictionary.reveliolabs.com` | `/methodology.html` |
| `coresignal.com` | `/data-transparency/`; `/pricing` |
| `docs.peopledatalabs.com` | `/docs/data-sources` |
| **Public notices** | |
| `arizonapublicnotices.com` | `/Help.aspx`; the terms; `/robots.txt`; the alert sign-up page |
| `texaspublicnotices.com` | the home page, search and terms; `/robots.txt` |
| `www.publicnoticecolorado.com` | `/SmartSearchSignup.aspx`; `/Help.aspx`; the terms; `/robots.txt` |
| `www.capublicnotice.com` | the search (county and type filters); the terms; `/robots.txt` |
| `nevadapublicnotice.com` | the subscription page; the terms; `/robots.txt` |
| `www.publicnoticeads.com` | the state list |
| `www.usalegalnotice.com` | the index |
| `www.pnrc.net` | `/2022/09/06/a-survey-of-statewide-public-notice-websites/` |
| `natlawreview.com` | `/newsletters`; the subscription terms |
| **Statutes** | |
| `www.azleg.gov` | `/ars/33/00808.htm` (the form's beneficiary line) |
| `statutes.capitol.texas.gov` | `/Docs/PR/htm/PR.51.htm` |
| `leginfo.legislature.ca.gov` | Civil Code 2924f |
| `www.leg.state.nv.us` | `/NRS/NRS-107.html` (107.080) |
| `colorado.public.law` | `/statutes/crs_38-38-103` |
| **Forums** | |
| `www.crefc.org` | `/January2026/January2026/See_Whos_Attending.aspx`; the member directory page; the terms of use |
| `informaconnect.com` | `/imn-bank-dallas/`; `/imn-bank-east/`; `/imn-distressed-cre-west/speakers/`; the event terms and conditions |
| `www.mba.org` | `/conferences-and-education/cref-convention-expo` (registration FAQ and attendee policy) |
| `community.rmahq.org` | `/theannualriskmanagementconference/speakers`; the chapter pages for Texas, Arizona, Colorado, Southern California and Nevada |
| `www.rmahq.org` | `/chapters/chapter-event-calendar` |
| `www.aba.com` | `/training-events/conferences/conference-for-community-bankers/program` |
| Bankers' associations | `www.texasbankers.com`; `membership.ibat.org`; `www.coloradobankers.org`; `www.calbankers.com` (`/events-education/upcoming-events`); the Arizona and Nevada bankers' association hosts (not confirmed; probably `azbankers.org` and `nvbankers.org` [U]); `www.westernbankers.com` [U] |
| **Other** | |
| `docs.x.com` | `/developer-terms/agreement`; `/developer-terms/restricted-use-cases`; the pricing page |
| `x.com` | `/tos` |
| `developers.google.com` | `/youtube/v3/getting-started`; `/youtube/terms/developer-policies` (only if YouTube is reconsidered) |
| `cppa.ca.gov`, `oag.ca.gov` | `/privacy/ccpa` (thresholds, the B2B scope, DROP) |

### B.8 Part B's top five

Merged into the ranking at the top of this note.

Ranked by value against effort and legal risk. These are **recommendations**.

1. **Advisor listing watch, plus buyer-list registration (E16-S8, E19-S1 to S3).**
   - **What:** DebtX, FFN, Mission Capital and JLL Invest first; Crexi, RealINSIGHT and Xchange.Loans by saved-search email, read by a principal.
   - **Value:** the highest. Metro, size and bid dates for live supply in our metros, the advisor as a mandate, and the seller named in some FFN announcements and broker tombstones.
   - **Effort:** low to medium. The `listingEvent` shape exists; add an optional `sellerDescription`.
   - **Risk:** low, once each site's terms are read or permission granted (open questions 17 and 18). **Manual until then.**
2. **Speaker pages from the forums into the briefer (E22 forum routes, E19 corroboration).**
   - **What:** a principal-maintained event list with IMN Bank Special Assets Texas, East and West, IMN Distressed CRE, CREFC, CBA Lending & Credit, and RMA chapter conferences in TX, AZ and CO.
   - **Value:** high. Bank special-assets and credit officers on public panels give forum targets, and advisors' sponsorships corroborate mandates.
   - **Effort:** low. No adapter: the briefer reads listed URLs at research time.
   - **Risk:** low (public pages, E22-S2's rules). Attendee lists stay out of the pipeline.
3. **Statewide public-notice alerts in AZ, NV and CA (CO and TX skipped), then a coverage spike (E5, E22-S3).**
   - **What:** a principal sets keyword alerts ("trustee's sale", "notice of sale", plus commercial words).
   - **Value:** medium to high, where the published text gives the lender, trustee and counsel for counties without online images (Los Angeles, San Diego, Clark). It might cut D1's vendor spend.
   - **Effort:** low for the alerts. The spike is about a day.
   - **Risk:** low as Manual. A Build needs permission (open questions 19 and 20).
4. **Sales Navigator Core, worked by hand (B.1.6).**
   - **What:** one seat (about $1,080 a year); saved target banks and intermediaries; weekly alerts read by a principal; signals logged by hand against the institution; any person corroborated from a public non-LinkedIn source before E7 uses them.
   - **Value:** medium. It gives job changes and senior hires at target banks months before a sale.
   - **Effort:** low, plus an optional small `signals log` command.
   - **Risk:** low if nothing is automated. High if anyone parses the emails, so that is not allowed (B.1.5).
5. **Trade-press loan-offering coverage on a trial (CRE Direct, or Commercial Mortgage Alert's 3-week trial).**
   - **What:** a principal reads loan-offering items and logs seller-named sales into the ledger by principal confirmation (the E19-S1 pattern).
   - **Value:** medium to high. It is the one source seen that names both the bank seller and the advisor.
   - **Effort:** low.
   - **Risk:** low as Manual. Licensed only for any automated use (open question 11).

**Next in line:** a LinkUp quote for employer-site job postings filtered to the candidate banks (open question 21). It is the only clean route for the hiring signal, but the signal is noisy, so it sits below the five above.

**Ruled out:**

- scraping or auto-parsing anything from LinkedIn;
- Revelio, Coresignal and Lightcast profiles, which are LinkedIn-derived;
- Workday's undocumented endpoints;
- Indeed's and Google's job search, which have no read API;
- Ten-X and the Crexi automation (terms);
- the X API (low yield, and the monitoring restriction);
- third-party "predicted" attendee lists.

---

## Open questions that could change a verdict (both parts)

One list for both parts: Part A's questions come first (1 to 15), then Part B's (16 to 27). Part A's question 11 and Part B's Q4 asked the same thing about the trade press, so they are merged as 11. Each item ends with where it came from and, where one exists, the decision in `docs/data-sources.md` section 6 that it feeds.

1. **How many Tier A and B banks have no EDGAR filer?** That is: OTC-traded, §12(i), or private. If the count is near zero, the newsroom registry, the GlobeNewswire request and the OTC licence all drop. If it is large, they move up. A principal can answer it from the CIK mapping in E13 (`docs/data-sources.md` §5 step 2). *(Part A, 1.)*
2. **Which wire, IR platform and alert option do those banks use?** A one-time look at each newsroom, recorded in the registry. *(Part A, 2.)*
3. Will **Notified (GlobeNewswire)** give written permission, or a free media-partner feed, for internal monitoring? Does it have US-state location feeds? *(Part A, 3. Decision D7.)*
4. Is Business Wire's **"commercial activities"** clause, cited in the repo doc, in the current terms? What is the "last updated" date of the Business Wire, PR Newswire and GlobeNewswire terms? *(Part A, 4.)*
5. **Counsel (D4):** does "internal or personal" (Bisnow) or "reading of releases" (Business Wire) cover a principal reading a feed in a reader inside an internal tool? Does "personal, non-commercial" (Google, Seeking Alpha, Arizent) bar even a principal's own reading for business? *(Part A, 5. Decision D12.)*
6. The **Fed feed filenames** for orders and enforcement (the repo doc's `press_orders.xml`). *(Part A, 6.)*
7. **OCC CAS:** its terms, its robots.txt, and whether it has an export or query URL suited to a weekly pull. *(Part A, 7.)*
8. Does the **FDIC publish applications** for state nonmember banks (mergers, branch sales)? If yes, it may matter more than the state bulletins. *(Part A, 8.)*
9. How often do the **Texas Finance Commission packets** come out, and do they list applications at a useful lead time? *(Part A, 9.)*
10. Do **GDELT's filters** (`sourcecountry`, `domain`) and its result cap make bank-name queries practical for about 300 banks a day? *(Part A, 10.)*
11. **The trade press that names sellers (Commercial Mortgage Alert, CRE Direct):** how often does each name the selling bank, for which of our metros, and at what price? Does a licence allow internal database use? Check Commercial Mortgage Alert during the trial. *Could change:* B.2: Licensed only, as a seller-named source for E16 and E19-S4. *(Part A, 11, and Part B, Q4, merged. Decision D8.)*
12. Do **transcript vendors** cover listed banks of $1–10B? How many of our public Tier A banks hold calls at all? *(Part A, 12.)*
13. Does the current US **Google Terms of Service** (effective 2026-07-30) keep the "automated means ... robots.txt" bullet? *(Part A, 13.)*
14. **The Arizona copyright position:** does it affect internal reading of DIFI releases? Probably not [I]; counsel to say. *(Part A, 14.)*
15. Are the **Trepp, ACBJ and Connect CRE** robots.txt files blocking AI crawlers? That would confirm "Manual" for them. *(Part A, 15.)*
16. Do LinkedIn's **Sales Solutions and Sales Navigator terms** (not read) say anything about processing alert emails? Would LinkedIn give written permission? *Could change:* B.1.5: Not used to Manual-assisted (unlikely). *(Part B, Q1. Decision D12.)*
17. Do the **terms and robots.txt of DebtX, FFN, Mission Capital and invest.jll.com** allow polite automated reading? Do they have RSS? Would each advisor give written permission, given they want buyers? *Could change:* B.2: Build (gated) to Build, or to Manual. *(Part B, Q2. Decision D11.)*
18. Do the advisors' **buyer-registration agreements** allow us to parse their teaser emails into our ledger? What is pre-NDA and what is under NDA? *Could change:* B.2: an email feeder, or Manual. *(Part B, Q3. Decision D11.)*
19. Do **capublicnotice.com and nevadapublicnotice.com** carry commercial notices of trustee's sale for Los Angeles, San Diego and Clark, with the trustee, beneficiary and counsel named? How many days do they lag the recorder? *Could change:* B.4: Manual to Build (gated); and part of D1 (the vendor budget). *(Part B, Q5. Decision D14.)*
20. Do the **press associations' terms** allow automated reading or alert parsing, or will they grant it? *Could change:* B.4. *(Part B, Q6. Decision D14.)*
21. What does **LinkUp** charge for a feed filtered to our banks and titles? What share of our banks post on their own websites? What is the base rate of special-assets postings? *Could change:* B.3: Licensed only, adopted or dropped. *(Part B, Q7. Decision D10.)*
22. Do **Lightcast's postings** include LinkedIn job ads as a source? *Could change:* B.3: Lightcast postings, acceptable or not. *(Part B, Q8.)*
23. Is the firm, or a principal, a **CREFC, RMA or state bankers' association member**? What do the member directories' terms allow? *Could change:* B.5: forum routes, and whether a principal can use directories in person. *(Part B, Q9.)*
24. Does **X's "tracking, alerting, or monitoring" restriction** cover following public company accounts? *Could change:* B.6: X to Manual or Build. *(Part B, Q10.)*
25. Do the **CCPA thresholds** reach the firm? Does any new store (a manual signal log, a licensed feed) need notice at collection or the deletion workflow? *Could change:* B.1.6, B.3 and B.6.5. *(Part B, Q11. Decision D13.)*
26. Is **SNAP** closed to new partners? (It makes no difference unless LinkedIn opened a data-sharing tier.) *Could change:* B.1.2. *(Part B, Q12.)*
27. Does the **Arizona statutory form** (A.R.S. 33-808) name the beneficiary, and does a California notice of trustee's sale name the beneficiary? *Could change:* B.4: the value of the counsel and lender route from notices. *(Part B, Q13.)*
