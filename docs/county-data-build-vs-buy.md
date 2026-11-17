# County data: build it or buy it

A principal asked: **"What is ATTOM doing to get this data, and why can't we do the same thing ourselves instead of paying them?"** This note answers that. It builds on `docs/county-playbook.md` (Maricopa, the ATTOM trial plan), `docs/data-sources.md` (section 2.3, the vendor survey) and `docs/paper-estimate.md` (E14-S4, the observed layer). It does not repeat them.

Research is from November 17, 2026. The development environment could not open county or vendor pages directly (their hosts are blocked), so almost every outside fact was read through search excerpts of the official page. Marks, as in the other docs:

- **Checked**: fetched or tested live: facts carried over from the playbook, and Maricopa's robots.txt files, read on November 17, 2026.
- **Seen**: the official page's or statute's own text, read through search results.
- **Unconfirmed**: a secondary source, or memory.
- **[verify]**: a gap to close before money or code depends on it.

No prospect data is in this file: no borrower, owner or lender names.

## 1. The short answer

- **ATTOM does not have a secret source.** It gets recorder data the same ways anyone can: it buys bulk feeds from counties, licenses data from other aggregators, sends local collectors to read and copy notices, and keys the fields off document images. Then it cleans and links what it gets. (Section 2.)
- **What we pay ATTOM for is scale and history, not access.** The FTC found in 2014 that building national recorder data from scratch "would be cost-prohibitive" for a new entrant, mainly because of the years of history. Seen. We need 18 counties, not 3,000, so most of that barrier does not apply to us.
- **Most of our counties sell a bulk feed.** Maricopa, Clark, San Diego, Orange, Travis, Jefferson and Douglas publish bulk index or image products, at prices from about $10 a day to about $1,000 a month. Colorado law lets every clerk sell a daily bulk subscription. (Section 3.)
- **Los Angeles is the exception.** The Registrar-Recorder offers no online access and publishes no bulk product. LA is where ATTOM (or another vendor) is worth paying for.
- **The hard part is not the feed. It is the image.** In most counties the index has names and document types, but the loan amount, the property's parcel number and often the lender's role are only on the scanned document. A self-built pipeline must read images, but only for the few hundred commercial documents a month, never the whole county.
- **Arizona favours building.** A.R.S. 39-121.03(C) provides treble damages for commercial use of a record obtained "from anyone other than the custodian" (playbook, Seen). Buying Maricopa records from the Recorder is the legally clean route.
- **Weekly watchers are possible almost everywhere, but not by scraping search sites.** In most counties the watcher reads an official feed (a bulk index file) or a list the law says must be public (Texas foreclosure postings, Colorado public trustee lists). Search sites are off limits unless robots.txt and the terms allow automation; Maricopa's robots.txt and challenge page rule its sites out (Checked). Los Angeles has neither a feed nor a list, so its watcher is a vendor feed. (Sections 3.4 and 4.)
- **Recommendation: hybrid.** Build Maricopa now (already decided, D7), then Clark and the Colorado counties, then Travis. Buy Los Angeles from a vendor. Decide Orange and San Diego after the ATTOM trial is measured against our own Maricopa pipeline. Never scrape a search site. (Section 7.)

## 2. What ATTOM and its peers actually do

### 2.1 How they get the records

| Method | What it is | Evidence | Mark |
|---|---|---|---|
| **Bulk purchase from the county** | A contract for the daily index and images, by FTP or download, priced per record, per image or per month. Title insurers, lenders and data aggregators are the main buyers. Counties usually sign a contract with each buyer, and resale limits are common. | PRIA's 2025 paper *Access to and Sale of Bulk Records*. County examples in section 3. | Seen |
| **Licensing from another aggregator** | ATTOM's predecessor, RealtyTrac, got national assessor and recorder bulk data **from CoreLogic**, as the FTC's remedy when CoreLogic bought DataQuick in 2014. The order required data "of the same scope and quality" DataQuick had, and in 2018 the FTC extended it to at least 2022 after finding CoreLogic had slowed delivery. | FTC press releases, 2014 and 2018; FTC analysis | Seen |
| **Title plants** | Title insurers copy every day's recordings and index them for title searches. First American's DataTree links to its title plant data and claims over 7.5 billion document images. A 1980s account of the Los Angeles plant describes abstracting about 10,000 documents a working day from the recorder's daily microfilm. | DataTree pages; ETHW history | Seen (counts are self-reported) |
| **Local collectors** | ATTOM says its aggregators collect pre-foreclosure notices "online, by monitoring newspapers, or by physically visiting places where notices are posted". PropertyRadar says it gathers some data itself and buys the rest, and reports trustee-sale results the day of the sale, weeks before the deed is recorded. | ATTOM foreclosure pages; PropertyRadar "how we do it" | Seen |
| **Keying from images** | The FTC order defines recorder data as information "abstracted from transactions". CoreLogic sold its India operations (about 4,000 staff) to an outsourcing firm in 2011. Title-plant vendors describe double keying and sampling, and newer ones describe automated extraction. | FTC order; Inman, 2011; DataTrace | Seen; where any vendor keys today: Unconfirmed |
| **Public-records requests** | Any vendor can ask under a state's public-records law. California requires electronic records at direct cost (Gov. Code 7922.575; *Sierra Club v. Superior Court*, 2013, on Orange County's parcel database). | Statute and case | Seen. Which vendors use this route: Unconfirmed |
| **Scraping public search sites** | Some smaller vendors likely do it (inferred). No major vendor says so. | None found | Unconfirmed. **Not a route for us** (section 4) |

### 2.2 What they add on top

| Step | What they claim | Mark |
|---|---|---|
| **Standardizing** | ATTOM runs an "Enterprise Data Management Program" of "more than 20 steps" that converts each county's format into one national format: address standardization, owner-name parsing, institutional owner flags, a permanent ATTOM ID per property. | Seen |
| **Lender names** | ATTOM's recorder data lists a "standardized lender name". Its loan-originator data is standardized with NMLS identifiers. How lender names are standardized is not published. | Seen; method Unconfirmed |
| **Assignments** | ICE's property-transfer data carries assignor and assignee names, original lender and loan amount. ATTOM sells assignment and release records. Whether either links an assignment back to its original deed of trust is not published. | Seen; linking Unconfirmed (playbook trial question 5) |
| **History** | Decades of deeds and mortgages, which customers license "a decade or more" back (FTC). | Seen |
| **Coverage claims** | ATTOM: "over 3,000 counties", recorder deeds in "over 2,690". ICE: "more than 3,100 county recorder offices". The counts differ between pages of the same vendor. | Seen |

**None of them says how complete commercial deeds of trust are.** Their products are built for residential mortgage markets. Whether a $6 million deed of trust on a Los Angeles hotel has its lender and amount filled in is exactly what the ATTOM trial must measure (playbook section 5).

### 2.3 What their licences forbid

| Vendor | What the terms say | Mark |
|---|---|---|
| ATTOM | The website terms bar copying, redistributing, sublicensing and "stored for subsequent use" without written permission; data is governed by "a separate license agreement". Bulk licensing is sold for use "directly on your servers and software", including internal dashboards. The bulk licence itself was not found. | Seen; the licence [verify] |
| First American (DataTree, DNA Store) | Use "solely ... within Customer's own organization by Customer's own employees"; "shall not resell, relicense or redistribute"; the restrictions apply "both during and after the term". | Seen (EULA of February 9, 2023) |
| PropertyRadar | Internal use only, no combining with other data, delete everything within 30 days of cancelling. | Checked (playbook) |
| CoreLogic / Cotality, ICE | Not found. Their 10-Ks warn that public-record sources can stop supplying data or restrict its use by legislation. | Seen (risk factors); licences Unconfirmed |

**What this means for us.** A vendor field is rented, not owned. Anything we take from a vendor must carry its source, so it can be deleted when the contract ends, unless the licence grants retention in writing (playbook question 7). A field we buy from a county under its own agreement stays ours, within that agreement.

### 2.4 Why it is hard for them and easier for us

The FTC's 2014 analysis says an entrant needs "several years of national historical data and an ability to provide go-forward national data", that the data "are available from local (county or county-equivalent) government offices", and that collecting it "would be cost-prohibitive for a potential entrant". Seen.

Three things make our problem smaller:

1. **18 counties, not 3,000.** Six of them hold almost all the commercial lending we care about.
2. **Going forward first.** A new notice of default matters this month. The lender map (E14-S4) needs history, but only for commercial loans still outstanding, so roughly the last 10 years (inferred).
3. **A narrow slice.** We need commercial parcels and loans of $1–25 million, not every deed in the county. So we need the whole index, but images for only a small share of documents.

## 3. County by county

### 3.1 The table

Ordered by commercial volume. "Lender in index" means whether the lender's name is in the index data we would buy, without reading the image. "Amount" means the loan amount or original principal. "Weekly watcher" applies the firm's rule from section 3.4: allowed only through an official feed, or a public list or site whose robots.txt and terms allow automated access, with nothing bypassed. The channels behind each verdict are in 3.4.

| County | Bulk channel | Price seen | Document types | Lender in index? | Amount in index? | Weekly watcher | Mark |
|---|---|---|---|---|---|---|---|
| **Los Angeles** | **None published.** No online access to records or indexes; viewing in person at Norwalk, indexed by grantor, grantee and year; copies by mail, online form or in person. A state recorders' paper says resellers buy and resell document images, so some channel exists. | No bulk price found. Certified copies $6 first page, $3 each more. Assessor parcel file with use codes (SBF Abstract) $50 (prices "as of July 1, 2021"). | All California types: deed of trust, assignment, substitution of trustee, notice of default, notice of trustee's sale, rescission, trustee's deed, lis pendens, reconveyance | Names in the index, by grantor and grantee [verify role] | No (image only) [verify] | **Not allowed on county sources** (there is no online search or feed to watch). Allowed via a **vendor feed** under licence. | Seen; channel [verify] |
| **Maricopa** | Recorder bulk account (index and images); the legacy search is closed to automation by robots.txt | $0.015 per index record; $0.08 per image; or $250 a day for all of the previous day (about $62,000 a year). $300 deposit, commercial-purpose statement. | DT, AS, ST, MF, NS, CQ, TD, LP, ML, DR (playbook codes) | Names without roles; a deed of trust may name MERS. **Lender and APN are on the image.** | No. The notice of trustee's sale must state the original principal (A.R.S. 33-808(C)), on the image. | **Allowed via the bulk account** (daily files). Not via search sites: robots.txt disallows `/recdocdata/`, and the new site serves a Cloudflare challenge (Checked). | Checked (playbook); fees Seen |
| **Clark** | FTP subscription: index and images, "pushed" or "pulled" | 2020 schedule: index $394–457 a month, images $374–436 a month, or $18–22 a day. Plain copies $1 a page. | Trust deeds, notice of breach and election to sell (default), notice of trustee's sale, reconveyances, assignments, lis pendens | Names, grantor and grantee [verify role]. The index has a **parcel number** (the public search filters by it). | A "Total Value" (consideration) field exists in the index; **whether it is filled on deeds of trust [verify]** | **Allowed via the FTP index subscription.** AcclaimWeb search: robots and terms not read [verify]. | Seen; 2020 prices [verify current] |
| **San Diego** | Daily-image subscription for all recorded documents; custom electronic downloads; free online index (24–48 hour lag) | $150 setup plus vendor costs; **$0.125 an image, divided equally among the subscribers**; custom downloads $0.32 an image (County Admin. Code sec. 86.10). Bulk index product not found. | All California types | Names [verify role] | No (image only) [verify] | **Allowed via the daily-image subscription** once an index route is settled. Online index: robots and terms not read [verify]. | Seen; index channel [verify] |
| **Orange** | Weekly digital index subscription; digital copies of a day's recordings; online retrieval by subscription for title companies, mortgage bankers and banks | 2024 board item: weekly index **$77 a week** (down from $280); digital copies **$0.02 a page**; older subscription $1 first page, $0.50 each more. Plain copies $1 a page. Online index since 1982, no images. | All California types | Names [verify role] | No (image only) [verify] | **Allowed via the weekly digital index**, which is a weekly delta by design. RecorderWorks search: robots and terms not read [verify]. | Seen; whether the 2024 fees were adopted [verify] |
| **Travis** | "Daily Real Property Information on CD (Call for Bulk Data Requests)"; online search (GovOS) | **$10 a CD** (Gov. Code 552.261) | Deed of trust, assignment, release, lis pendens, substitute trustee's deed. Notices of trustee's sale are filed and posted, not recorded (Prop. Code 51.002), and the clerk posts them online. | Names, grantor and grantee [verify role] | No. Texas has no transfer tax, so no amount field (inferred) [verify] | **Allowed via the daily CD**, and via the county's foreclosure-notice posting, which the law requires to be viewable "without charge or registration" [verify its robots.txt]. GovOS publicsearch: robots and terms not read [verify]. | Seen |
| **Denver** | No bulk program found. Online search; Colorado Open Records Act requests; state law allows a daily bulk subscription (C.R.S. 30-10-101(2.5)). | Not published. Certified copies $1 a document plus $0.25 a page. | Deed of trust (to the public trustee), assignment, release, notice of election and demand, certificate of purchase, public trustee's deed, lis pendens | [verify] | No. The notice of election and demand must state the **outstanding principal balance** and the holder's attorney (C.R.S. 38-38-101). | **Allowed via the Public Trustee's foreclosure search** if its robots.txt and terms allow [verify]; via a bulk subscription once asked for. | Seen |
| Jefferson | Daily download, index and images, by agreement | **$1,000 a month**; 1995 to date $500 a month | As Denver | [verify] | No | **Allowed via the daily download**; or the Public Trustee's search and Tuesday pre-sale report [verify robots] | Seen |
| Douglas | FTP bulk subscription: daily tab-delimited index (since 1983) and Group IV TIFF images; signed agreement and deposit; files removed after 5 working days | **$0.03 an image, $0.04 an index document**; charged for both even if one is not downloaded | As Denver | [verify] | No | **Allowed via the FTP subscription** (must pull at least every 5 working days) | Seen; deposit [verify] |
| Arapahoe | No bulk product found. Free account; watermarked images free, unwatermarked $0.25 a page. | Not published | As Denver | [verify] | No | Recorder site: **not allowed** (a login is required, and the account terms were not read). Public Trustee search: [verify]. Ask for a bulk subscription. | Seen |
| Adams | No bulk product found. The public trustee posts weekly foreclosure PDFs (data-sources). | Not published | As Denver | [verify] | No | **Allowed via the Public Trustee's foreclosure reports** (PDF files by date) [verify robots] | Seen |
| Broomfield | No bulk product found. Free index online; images by subscription type. | Not published | As Denver | [verify] | No | **Allowed via the Public Trustee's weekly PDFs** [verify robots]; EagleWeb search [verify] | Seen |
| Clear Creek, Elbert, Gilpin, Park | Not researched: little CRE | — | As Denver | — | — | Not researched | — |
| Pinal | Acclaim search by document type; watermarked images; no bulk product found | Copies $1 a page | As Maricopa | [verify] | No | **Pending.** Acclaim search: robots and terms not read [verify]. Ask for a bulk product. | Seen (playbook) |
| Williamson | No bulk product found; online search and purchase | Not published | As Travis | [verify] | No | **Allowed via the county's foreclosure-notice posting** [verify robots]. Records search: a third party says registration is needed, so not allowed [verify]. | Seen |
| Hays | No bulk policy found. A job posting describes staff copying records to CDs and an FTP site. | Not published | As Travis | [verify] | No | **Allowed via the county's foreclosure-notice posting** [verify robots] | Seen |
| Bastrop, Caldwell | No bulk product found. Caldwell's records search is hosted by a third party; requests go under the Public Information Act. | Not published | As Travis | [verify] | No | **Allowed via the counties' foreclosure-notice postings** [verify robots] | Seen |

For comparison, two counties outside our metros publish their whole contract: Pima (AZ) charges $50 setup and $500 a year for daily images, and $8,000 for all historical images; San Bernardino (CA) charges $0.05 an image and $0.05 an index entry, with daily files kept for 7 days. Seen. They show what to ask our counties for.

### 3.2 What is in the index, and what is only on the image

This decides the cost of building. The index is cheap and arrives as data. The image is a scan that has to be read.

| Field | Usually in the index | Usually only on the image |
|---|---|---|
| Document type, recording date, document number | Yes | — |
| Party names | Yes | — |
| Party roles (which name is the lender) | Sometimes. Maricopa's index has none (Checked). | Yes |
| MERS as nominee, not the lender | Shows as a name | The real lender is named in the body |
| Parcel number (APN) | Clark yes (Seen); Maricopa no (Checked); others [verify] | Yes |
| Original loan amount | No, except possibly Clark's "Total Value" [verify] | Yes |
| The deed of trust a notice refers to | No | Yes (recording number or date) |
| Unpaid balance on a notice | No | Yes. California's notice of sale must state it (Civ. Code 2924f) [verify the subsection]; Colorado's notice of election and demand states the outstanding principal (C.R.S. 38-38-101). |

**Commercial loans are less often in MERS** than home loans, so the lender is usually named on the deed of trust itself (inferred). MERS has a commercial product (MERS Commercial, 2003). Seen. How common it is in our counties: Unconfirmed.

### 3.3 State rules on access and redaction

| State | Rule | What it means for us | Mark |
|---|---|---|---|
| **California** | Gov. Code 7928.205 (formerly 6254.21) bars posting an elected or appointed official's home address online. AB 1785 (2024, in force January 1, 2025) added the official's name together with the APN. Los Angeles cites this rule for offering no online access; San Diego dropped APN search; Orange removed instant online downloads in FY 2022-23 "to promote public safety". | Online search is shrinking, not bulk sale. The state recorders' association says the posting rule "does not extend to entities that purchase and resell images". We never post anything, so the rule does not touch internal use. | Seen |
| California | Gov. Code 27300–27307: recorders must keep a "public record" version of each document with the Social Security number truncated (1980 onward). | Bulk images we buy are the truncated version. | Seen |
| California | Gov. Code 27366: copy fees set by the board "to recover the direct and indirect costs". Gov. Code 7921.300: no limit on access based on purpose. | Prices are cost-based, and the county may not ask why we want them. Whether the CPRA's direct-cost rule (7922.575) or the recorder's own fee statute governs a bulk image request: [verify with counsel]. | Seen |
| **Arizona** | A.R.S. 39-121.03: a commercial-purpose statement before commercial use; treble damages under (C) for commercial use of a record obtained from anyone but the custodian. A.R.S. 11-483 and 11-484: eligible persons (judges, peace officers and others) can have identifying information redacted. | Buy from the Recorder, state every use (playbook). Vendor-sourced Maricopa data needs counsel (D8). | Seen |
| **Nevada** | NRS 239.052: copy fees may not exceed actual cost. NRS 247.530–.545: listed persons (judges, peace officers, prosecutors and others) may have their personal information kept confidential and off the internet. | Clark's FTP prices should track cost. Confidential records may be missing from bulk files. | Seen |
| **Texas** | Gov. Code 552.222: the office "may not inquire into the purpose" of a request. Local Gov. Code 118.011(e): non-paper copies are priced under Gov. Code 552.231 and 552.262. 1 TAC 70.3 sets labour at $15 an hour. | The cheapest and least restricted state. A bulk request needs no statement of purpose. | Seen |
| **Colorado** | C.R.S. 30-10-101(2.5): a clerk may sell "a daily copy in bulk of all documents recorded", by subscription, within 3 business days, at a fee covering production cost. | Every Denver-metro clerk can sell a feed. If one does not publish a price, ask under this section. | Seen (2020 text) [verify current] |

### 3.4 Weekly watchers

A principal wants a **watcher** per county: once a week it records what is new since last week. New notices of default (or election and demand), notices of trustee's sale, lis pendens, assignments, and deeds of trust whose lender matches a bank in our universe. Each new item is an **event signal** with its date (data-sources section 1), stored in the data folder, never in the repository.

**The rule.** A watcher is allowed only where robots.txt and the terms allow automated access and nothing must be bypassed: no CAPTCHA solving, no shared logins, no passing challenge pages by software, no rotating addresses. A site behind a login counts as not allowed unless the account's own terms expressly allow automated use. It declares who we are in its User-Agent and keeps to a slow request rate (the playbook's 3 a minute).

**The channels, best first:**
- **(a) An official feed**: a bulk or daily index file, FTP or API, bought under the county's agreement. Allowed by design. A weekly run reads the week's daily files.
- **(b) A free public list meant to be read**: a Colorado public trustee's foreclosure list, a Texas county's foreclosure-notice posting, Rule 120 notices on the Colorado courts' site, a statewide notice site. Allowed if its robots.txt and terms allow.
- **(c) A public search site**: allowed only after its robots.txt and terms are read and allow it, and only if no CAPTCHA, login or per-page fee stands in the way.

**What could be read from here.** This environment's network blocks every county host except Maricopa's legacy recorder and assessor (tested November 17, 2026). So Maricopa's robots.txt files are Checked; every other robots.txt and terms page is **[verify]**, to be read from an open network in the first spike. Until then, (c) counts as **not allowed**.

| County | (a) Official feed | (b) Free public list | (c) Search site: robots.txt / terms / CAPTCHA, login, fee | Verdict |
|---|---|---|---|---|
| Los Angeles | None published | No recorder list. Trustee-sale notices are published in newspapers; California's statewide notice site is voluntary, coverage and terms [verify]. Superior Court has no new-filings list. | **No online search exists.** | **Vendor feed only** (under licence). A principal reads notice sites by hand meanwhile (data-sources reading list). |
| Maricopa | **Bulk account** (decided, D7) | arizonapublicnotices.com: a trustee's sale notice runs weekly for 4 weeks (A.R.S. 33-808) [verify terms] | Legacy search: robots.txt `Disallow: /recdocdata/` (file dated October 2, 2026; Checked). New site: Cloudflare challenge, even on robots.txt (Checked). Assessor search: robots.txt disallows `/mcs/` and query paths (file dated September 17, 2021; Checked); use the free downloads instead. Superior Court: blocks scripts (playbook). | **Allowed via (a)** |
| Clark | **FTP index** subscription | nevadapublicnotice.com, keyword email alerts [verify terms] | AcclaimWeb: free search by name, document type and parcel; no images online; no login for search (Seen); robots and terms [verify] | **Allowed via (a)** |
| San Diego | Daily-image subscription; index route [verify] | Newspaper notices [verify] | Acclaim index, free, 24–48 hour lag, no images; robots and terms [verify] | **Allowed via (a)** once the index route is settled |
| Orange | **Weekly digital index**, $77 a week (2024) [verify adopted] | Newspaper notices [verify] | RecorderWorks: index only, no images, instant downloads removed in FY 2022-23; robots and terms [verify] | **Allowed via (a)**: the product is already a weekly delta |
| Travis | **Daily CD**, $10 | **The county's foreclosure-notice page.** Since September 1, 2023 a county must post each notice of sale on its website "publicly viewable without charge or registration", with the sale's date, time and place (Prop. Code 51.002, SB 62). Seen. robots [verify]. | GovOS publicsearch: watermarked images; robots and terms [verify] | **Allowed via (a) and (b)** |
| Williamson, Hays, Bastrop, Caldwell | None found | Each county's foreclosure-notice page (Prop. Code 51.002) [verify robots] | Williamson: registration needed (third-party claim), so not allowed [verify]. Others [verify]. | **Allowed via (b)** |
| Denver | None published; ask under C.R.S. 30-10-101(2.5) | **Public Trustee foreclosure search** (new GTS software since May 1, 2026, denvergov.org/foreclosuresearch). Seen. Rule 120 notices may be posted on the courts' site [verify for Denver]. | Recorder search [verify] | **Allowed via (b)** if robots and terms allow [verify] |
| Jefferson | **Daily download**, $1,000 a month | Public Trustee foreclosure search; pre-sale report every Tuesday afternoon. Seen. | [verify] | **Allowed via (a)**, or (b) [verify] |
| Douglas | **FTP bulk** | Public Trustee foreclosure search; a sale list every Wednesday morning. Seen. | [verify] | **Allowed via (a)** |
| Arapahoe | None found; ask | Public Trustee foreclosure search [verify the official address] | Recorder site needs an account (free) to read records (Seen): **a login, so not allowed** | **Pending (b)** [verify] |
| Adams | None found; ask | **Public Trustee reports:** "New Foreclosure Report" PDFs by date, monthly totals, and a tentative sale list every Monday after noon. Seen. | [verify] | **Allowed via (b)** [verify robots] |
| Broomfield | None found; ask | Public Trustee weekly new-foreclosure PDFs (data-sources) | EagleWeb: free index, images by subscription [verify] | **Allowed via (b)** [verify robots] |
| Pinal | None found; ask | arizonapublicnotices.com [verify terms] | Acclaim: watermarked images [verify robots and terms] | **Pending** |

**Courts, for every county.**
- **Bankruptcy:** each court's public RSS feed is meant for automated reading (data-sources step 9). Allowed.
- **Colorado Rule 120:** a lender must get a court order before a public trustee sale. The clerk may post the notice "electronically on the court's public website" (C.R.C.P. 120). Seen. Notices from Boulder, Weld and Pueblo appear on coloradojudicial.gov, named by case number and address. Seen. Whether the Denver-metro districts post them there, and the site's robots and terms: [verify]. Remote access to court records is governed by Chief Justice Directive 05-01 [verify its terms on bulk use].
- **Texas, California, Arizona and Nevada courts:** no new-filings list was found. Maricopa's Clerk blocks scripts (playbook). Texas's statewide re:SearchTX needs an account (Unconfirmed), so not allowed. Receiverships and lender suits stay with a principal or a licensed vendor (Trellis, data-sources).

**State open-data portals** carry foreclosure counts, not documents (inferred). Useful for context, not for a watcher.

**Weekly is enough** almost everywhere: the shortest warning is Texas's 21 days, then Arizona's 91 days, California's three months and Colorado's 110 days or more (data-sources 2.3). For Texas, run the watcher twice a week if a principal wants more than two weeks' warning.

## 4. What is legal and appropriate for this firm

The repository's standing rules: never get around bot protection or robots.txt; no scraping where terms forbid it; no LinkedIn scraping; prospect data never committed. Applied to county records:

| Route | Allowed here? | Why |
|---|---|---|
| **Buying a county's official bulk feed** under its agreement | **Yes.** The preferred route. | It is what the county offers for this purpose. Read the agreement for resale and use limits, and file any statement it needs (Arizona). |
| **Public-records requests** (Texas PIA, California CPRA, Colorado CORA, Nevada NRS 239, Arizona with a commercial-purpose statement) | **Yes.** | A lawful request to the custodian. Good for one-time history pulls and for counties with no published product. |
| **A vendor licence** (ATTOM, DataTree, ICE, Cotality) | **Yes, within the licence.** | Tag every vendor field by source. Arizona and Nevada data from a vendor wait for counsel (playbook D8). |
| **A principal reading a county's public search by hand** | **Yes,** for a specific deal. | A person using the site as intended. Nothing is copied into the pipeline in bulk. |
| **Automated scraping of a county search site** (Maricopa LR, AcclaimWeb in Clark and Pinal, GovOS publicsearch in Travis, RecorderWorks in Orange, EagleWeb in Broomfield) | **No.** | Maricopa's legacy site disallows the search path in robots.txt and its new site sits behind Cloudflare (Checked). The vendor-hosted portals' terms were not found, and are presumed to restrict automated use until read [verify each]. Even where nothing forbids it, the county's bulk product is the route the county intends, and usually cheaper. |
| Scraping a vendor's website, or a vendor's data reached without a licence | **No.** | Their terms forbid it (2.3). |

**Our own handling:**
- County records name borrowers, so they live only in the data folder and the platform database, never in this repository, logs or notes (playbook rules).
- Asset details are principal context and never reach the drafter.
- Nothing is posted publicly, which keeps us outside the California and Nevada posting rules.
- Records a county later marks confidential (Nevada, Arizona) are removed when the county's next file drops them [verify how each county signals this].

### 4.1 The law in plain English

This is a summary for principals, not legal advice. Counsel reviews it with D8.

**1. The federal anti-hacking law (CFAA).** It punishes access "without authorization" or that "exceeds authorized access".
- *Van Buren v. United States* (Supreme Court, June 3, 2021) read the law narrowly, as a "gates-up-or-down" question: either you may enter a system, or part of it, or you may not. Using data you are allowed to see for a bad purpose is not a crime under it. Seen. The Court left open, in a footnote, whether a gate can be a contract term rather than a technical barrier. Seen.
- *hiQ v. LinkedIn* (Ninth Circuit, April 2022) held that scraping pages anyone can see without logging in is likely not "without authorization", even after a cease-and-desist letter. Seen.
- **But** courts have found liability where a scraper kept going after the site both told it to stop and blocked it technically (*Facebook v. Power Ventures*, Ninth Circuit; *Craigslist v. 3Taps*, N.D. Cal. 2013). Seen, through commentary [verify against the opinions].
- **In short:** reading public pages without a login is low risk under this law. Going through a login, a block or a challenge page, or carrying on after a letter, is high risk.

**2. The terms of use (contract).** This is where scrapers usually lose.
- hiQ won on the anti-hacking law and still lost on contract: in November 2022 the court found it in breach of LinkedIn's User Agreement, and it accepted a $500,000 judgment and a permanent injunction (data-sources 2.4, Seen).
- *Meta v. Bright Data* (N.D. Cal., January 23, 2024) went the other way, because Meta's terms covered only logged-in use and the scraper never logged in. Seen. Commentators read it narrowly; one notes that most courts have found scrapers in breach when they knew the terms forbade it. Seen (commentary).
- Many county search sites are run by private vendors (Harris's Acclaim, GovOS, Tyler), whose terms may govern [verify each].
- **In short:** if the terms forbid automated access, a watcher breaches a contract, whatever the anti-hacking law says. That is why our rule reads the terms first.

**3. Getting around barriers (anti-circumvention).**
- The DMCA (17 U.S.C. 1201) bars circumventing a technological measure that protects a copyrighted work. In *Ticketmaster v. RMG Technologies* (C.D. Cal. 2007), a court treated a CAPTCHA as such a measure and stopped the sale of software that beat it, on a preliminary injunction that commentators criticised. Seen.
- California's computer-crime law (Penal Code 502) punishes access "without permission". Courts are split on whether that requires beating a technical barrier, but beating one is clearly enough. Seen.
- **In short:** solving a CAPTCHA, passing a challenge page by software, rotating addresses to dodge a block, or using someone else's login is where civil and criminal risk concentrates. Our rule forbids all of it.

**4. robots.txt.** It is not a law. But ignoring it is evidence that we knew the owner did not want automated access, which matters for the contract and computer-crime claims above (inferred). Our rule honours it in every case.

**5. State rules on commercial use of recorded documents.**
- **Arizona:** before using public records commercially, file a statement of the commercial purpose (A.R.S. 39-121.03). Using a record for a commercial purpose other than the one stated, or using a record obtained commercially from anyone but the custodian, risks treble damages under (C). Seen (playbook). A watcher on Maricopa data must stay within the statement on file.
- **California:** no limit on access based on purpose (Gov. Code 7921.300). But agencies may not post officials' home addresses, or their names with parcel numbers, online (Gov. Code 7928.205, AB 1785), and recorders keep a public version with Social Security numbers truncated (Gov. Code 27300–27307). Seen. This is why Los Angeles has no online search and San Diego dropped parcel search. It limits what counties post, not what we may hold internally; we never post.
- **Nevada:** judges, peace officers, prosecutors and others may have their personal information kept confidential by the recorder (NRS 247.530–.545). Seen. Copy fees are capped at actual cost (NRS 239.052).
- **Texas:** the office may not ask why we want records (Gov. Code 552.222), and foreclosure notices must be posted online free and without registration (Prop. Code 51.002). Seen. The most open state for a watcher.
- **Colorado:** clerks may sell daily bulk copies by subscription (C.R.S. 30-10-101(2.5)); court records follow Chief Justice Directive 05-01. Seen.

**What we do, then:** watchers run only on (a) and (b) channels that pass the rule, and on (c) sites only after a dated read of robots.txt and the terms allows it. Each source's check is recorded in `sources.json` with the date, as data-sources section 4 requires. A cease-and-desist letter or a new block stops that watcher at once until a principal decides.

## 5. What a self-built pipeline needs

### 5.1 The design in one line

**Take the whole index every day; keep only what can be commercial; read images only for those.** The index is cheap. Images cost money to buy and effort to read, so they are bought for a few hundred documents a month, not tens of thousands.

### 5.2 The components

| # | Component | Built | What it does | Effort (engineer-weeks) |
|---|---|---|---|---|
| 1 | **Feed ingest** | Once, then an adapter per county | Pulls the county's daily files; checks fields; keeps the run log and change log (the existing E2 framework) | 1–2, then about 1 per county |
| 2 | **Document-type map** | Per county | Maps county codes to our types (deed of trust, assignment, substitution, notice, cancellation, trustee's deed, release, lis pendens). Maricopa already has its old-to-new code list (playbook). | 0.5 per county |
| 3 | **Commercial filter** | Once, then per county | Where the index has the APN (Clark), join to the assessor's use code. Where it does not (Maricopa), match the borrower's name to the owner names of commercial parcels in the assessor file, and keep documents whose parties are all companies. Then confirm on the image. | 1–2, then about 1 per county |
| 4 | **Image reader** | Once, with per-state field lists | Reads the lender, trustee, APN, original amount, unpaid balance and the deed of trust cited, and checks each against the statute's required fields. Anything uncertain goes to a principal's review queue. The OCR-or-model choice is playbook D10. | 2–3, then about 1 per state |
| 5 | **Lender match to `fdic:CERT`** | Once | Reuses `resolveParty` in `src/sources/enforcement.mjs`: a principal's alias first (`candidates/aliases.json`), then the exact normalized name, narrowed by state and city. Adds former names and holding companies from FDIC history and FFIEC NIC. MERS, trustees and servicers are recognised and set aside, never matched to a bank. Nothing fuzzy merges without a principal (E6-S1). | 2 |
| 6 | **Loan chain** | Once, then per state | Links each notice to its deed of trust, then the deed of trust to its assignments and substitutions, to find the **current holder**. Closes the record on a cancellation, trustee's deed or release. | 2, then 0.5 per state |
| 7 | **Lender map output** | Once | Feeds the observed layer (E14-S4): loans by charter, property type, original principal, vintage and county, with coverage. | 1–2 |
| 8 | **Verify and measure** | Per county | The live check, then four weeks of counts: commercial notices a month, share matched to a bank, delay, false alarms (playbook "done" test). | 0.5 per county |
| 9 | **Weekly watcher** | Once, then per channel | Compares the week's items with the store, keyed by county and document number, and writes each new one as a dated event signal (3.4). An (a) feed needs nothing extra; each (b) list (a public trustee page, a Texas posting page, the Rule 120 notices) needs its own small parser, its fake and its verify check. | 1, then 0.5–1 per (b) list |

**Totals (estimate).** The first county, with the shared parts, is about **10–14 engineer-weeks**. Each further county is about **3–4 engineer-weeks**, less within a state already built. Ongoing work is about 1–2 days a county a month (format changes, review queues), plus a principal's time on the alias queue. These are this plan's estimates, not measurements.

### 5.3 Reading images: cost

Reading is cheap; buying the image is what costs money. At list prices, OCR of 10,000 pages a month costs about $15 with Google Document AI's OCR ($1.50 per 1,000 pages) or $150 with Amazon Textract's queries ($0.015 a page). Seen. Having a model read the page and check every field (D10) costs more per page; price it from the current price list before deciding.

**A rule to keep:** never OCR a whole county's history. Ten years of deeds of trust in a large county run to tens of millions of pages, and the images alone would cost far more than any vendor (inferred). History is built only for documents the commercial filter has already selected, or bought from a vendor.

## 6. Build versus buy: the costs

### 6.1 Data fees if we build (per year, estimates)

| County | Route | Data fees a year | Basis |
|---|---|---|---|
| Maricopa | Metered bulk account | **$5,000–15,000** | About $375 a month of index records (playbook), plus images for commercial notices and deeds of trust. The range is mostly how many deed-of-trust pages we buy [verify whether first pages can be bought alone]. |
| Clark | FTP index, plus copies or the image feed | **$5,000–10,000** | $394–457 a month for the index; $374–436 more for all images (2020 prices) [verify current]. |
| San Diego | Custom image downloads, plus an index route | **$6,000–20,000** [verify] | $0.32 an image for the documents we pick. The index route is open: no bulk index product found. The daily all-image subscription's cost depends on how many others subscribe. |
| Orange | Weekly index, plus selected copies | **$10,000–25,000** [verify] | $77 a week (about $4,000 a year) for the index; selected copies at $1 a page. All of a day's images at $0.02 a page would be far more. |
| Travis | Daily CD, plus selected copies | **$3,000–8,000** [verify] | $10 a CD; copies under the PIA cost rules. |
| Denver metro (5 counties) | Statutory bulk subscriptions | **$15,000–35,000** [verify] | Jefferson $12,000 a year; Douglas per item; Denver, Arapahoe and Adams to be quoted under C.R.S. 30-10-101(2.5). |
| Los Angeles | No county route | — | Vendor only |
| **Total, excluding LA** | | **About $45,000–110,000 a year** | Plus the engineering in 5.2 |

### 6.2 What buying costs

- **ATTOM:** the property API "from $500 a month"; pre-foreclosure and bulk by quote; a free 30-day trial key (playbook, Checked from the pages). No bulk price is published anywhere we found. Seen.
- **DataTree, ICE, Cotality:** quote only. Unconfirmed.
- **PropertyRadar:** $119–599 a month, but its licence rules it out as a system of record (playbook).

So the comparison cannot be finished until quotes arrive. The question to ask each vendor is narrow: **commercial records only, six metros, daily, with the lender, amount, APN and assignment link filled in, and the right to keep the data after the contract ends.**

### 6.3 What decides it, beyond price

| Factor | Favours | Why |
|---|---|---|
| Arizona law | **Build** | Treble damages for commercial use of a record not obtained from the custodian (A.R.S. 39-121.03(C)) |
| Los Angeles access | **Buy** | No county channel published |
| Keeping the data | **Build** | Vendor fields are rented; county data bought under a county agreement stays ours |
| History (10 years of deeds of trust) | **Buy**, if the licence lets us keep it | A county backfile must be filtered and read; a vendor has already keyed it |
| Lender names standardized to banks | Even | Vendors standardize to their own lender codes, not to FDIC certificates. We still have to map to `fdic:CERT`. |
| Commercial completeness | Unknown | The ATTOM trial measures it; our Maricopa pipeline gives the comparison |
| Delay | **Build** | County feeds arrive the next day (Clark, Maricopa) to three business days (Colorado). A vendor's delay is a trial question. |
| Engineering time | **Buy** | 5.2's estimates are real work |

## 7. Recommendation and phased plan

**Build where the county sells a clean feed. Buy where it does not. Decide the middle with measurements, not guesses.**

| Phase | When | What | Gate to the next phase |
|---|---|---|---|
| **0. Quotes and trial** | Now, 30 days | Start the ATTOM trial on Los Angeles, Maricopa and Clark, with the playbook's eight questions. Ask ATTOM, DataTree, ICE and Cotality for the narrow quote in 6.2. Ask Clark, San Diego, Orange and the Denver-metro clerks for their current bulk terms in writing. **A one-day spike, from an open network, reads and dates robots.txt and the terms of every (b) and (c) host in 3.4.** | Quotes, terms and the robots/terms record in hand |
| **0b. Free watchers** | Weeks 2–6 | Watchers on the (b) lists the spike clears: the Colorado public trustees (Adams, Denver, Jefferson, Douglas, Broomfield; data-sources step 5) and the Texas foreclosure-notice pages (Travis first). No money, little code; they start the event history while the feeds are bought. | Each passes its live check |
| **1. Maricopa, built** | Months 1–3 | Already decided (D7). Build the shared components in 5.2 against the bulk feed. Run it beside the ATTOM trial on the same weeks: coverage of commercial notices, lender match rate, amount fill rate, delay, and accuracy on 50 documents checked by hand. | Our pipeline finds at least as many commercial notices as ATTOM, and matches at least as many to banks [thresholds: principal sets] |
| **2. Clark and Colorado, built** | Months 3–6 | Clark's FTP index (the APN is in the index, so filtering is cheap). Denver metro: subscriptions under C.R.S. 30-10-101(2.5), Jefferson and Douglas first since their prices are published. Colorado's notice of election and demand names the holder's attorney and the outstanding balance, which also feeds the counsel work (E5-S3). | Four weeks measured per county |
| **3. Los Angeles, bought** | From month 1, on the trial result | ATTOM if the trial passes and the licence allows storage; otherwise compare DataTree. Our own lender match (component 5) runs on the vendor's lender names. | Trial passed; counsel on the licence (D8) |
| **4. Orange and San Diego, decided** | Month 4 | Build if the county quotes (index plus selected images) and our Maricopa numbers beat the vendor. Otherwise extend the LA vendor contract to them. | Phase 1 measured; county quotes |
| **5. Travis and the rest** | Months 6–9 | Travis for the lender map (its 21-day notices give little warning but name who is enforcing). Then Williamson, Hays, Pinal, as their volume justifies. | Principal's decision per county |
| **History** | With phase 3 | Buy 10 years of commercial deeds of trust from the vendor **only if** the licence lets us keep them. Otherwise build history county by county from backfiles (Jefferson sells 1995 to date for $500 a month), filtered first. | Licence terms |

**Where ATTOM is still worth buying:**
- Los Angeles, which has no county channel.
- History, if the licence allows retention.
- Orange and San Diego, if their quotes make selective image buying dear.
- As the yardstick: the trial tells us what "complete" looks like before we trust our own pipeline.

**What changes in the engine:** E5-S2 (filing ingestion) gets one adapter per county or vendor, each with its fake, field checks and verify check. E6-S1's matching gains MERS, trustee and servicer handling. E14-S4's observed layer reads the lender map. Each vendor field carries its source so it can be deleted on termination.

## 8. Decisions for a principal

| # | Decision | Default meanwhile |
|---|---|---|
| D-B1 | Start the ATTOM 30-day trial now, on LA, Maricopa and Clark | Not started |
| D-B2 | Send the narrow quote request (6.2) to ATTOM, DataTree, ICE and Cotality | Not sent |
| D-B3 | Write to Clark, San Diego, Orange, Denver, Jefferson, Douglas, Arapahoe and Adams for current bulk terms and sample file layouts | Not sent |
| D-B4 | The pass marks for phase 1 against the trial (coverage, match rate, amount fill, accuracy) | None set |
| D-B5 | Engineering budget: about 10–14 engineer-weeks for Maricopa, 3–4 for each further county | Maricopa only (D7) |
| D-B6 | History: buy it, or build it from county backfiles | Decided after the licence terms (D-B2) |
| D-B7 | Counsel: vendor licences (retention, combining with our data) and California's fee statute for bulk images, with D8 | Nothing vendor-sourced kept after a trial |
| D-B8 | Adopt the watcher rule in 3.4 (official feeds and permitted lists only; a search site only after a dated robots.txt and terms read allows it; nothing bypassed), and allow the spike's hosts from an open network (data-sources D6) | No watcher runs; (c) sites count as not allowed |
| D-B9 | Counsel on 4.1: the anti-hacking, contract and anti-circumvention points, and Chief Justice Directive 05-01 for the Rule 120 notices | Watchers only on (a) channels and on (b) lists whose terms clearly allow automated reading |

## 9. Still to verify

1. Each county's current bulk price and agreement text; Clark's prices are from a 2020 schedule, Jefferson's and Douglas's from older pages.
2. Whether Los Angeles sells its daily images or index to anyone under contract, and on what terms.
3. Whether Orange's 2024 fee proposal ($77 a week index, $0.02 a page) was adopted, and whether a buyer that is not a title company, mortgage banker or bank may subscribe.
4. Whether San Diego sells its index in bulk, and how many subscribers share the daily-image fee.
5. In each index: whether party roles are present, whether the APN is present, and whether Clark's "Total Value" is filled on deeds of trust.
6. The terms of use of the vendor-hosted search portals (Acclaim, GovOS publicsearch, RecorderWorks, EagleWeb).
7. ATTOM's bulk licence: storage, combining with our data, retention after termination.
8. How common MERS is on commercial deeds of trust in our counties.
9. The exact subsection of Civ. Code 2924f that requires the unpaid balance on a California notice of sale.
10. robots.txt and the terms of use of every watcher host in 3.4, read and dated from an open network. Only Maricopa's were readable from here.
11. Which Denver-metro district courts post Rule 120 notices on coloradojudicial.gov, and that site's robots.txt and terms.
12. Arapahoe's Public Trustee search address, and whether Williamson's records search really needs registration.
13. The terms of the statewide notice sites (California, Arizona, Nevada, Colorado), and whether California's carries trustee-sale notices for our counties (data-sources open question 19).

## Sources

**Vendors and the market**
- ATTOM, recorder data: https://www.attomdata.com/data/property-data/recorder-data/
- ATTOM, foreclosure data: https://www.attomdata.com/data/foreclosure-data/
- ATTOM Cloud help, pre-foreclosure: https://cloud-help.attomdata.com/article/511-preforeclosure
- ATTOM Cloud help, loan originator (NMLS standardization): https://attom-cloud.helpscoutdocs.com/article/594-loan-originator
- ATTOM terms of use: https://www.attomdata.com/terms-of-use/
- ATTOM bulk licensing FAQ: https://www.attomdata.com/solutions/delivery/bulk-data-licensing/faqs/
- FTC, CoreLogic and DataQuick, 2014: https://www.ftc.gov/news-events/news/press-releases/2014/03/ftc-puts-conditions-corelogic-incs-proposed-acquisition-dataquick-information-systems
- FTC analysis of the consent agreement: https://www.ftc.gov/system/files/documents/cases/140324corelogicanalysis.pdf
- FTC, 2018 modification: https://www.ftc.gov/news-events/news/press-releases/2018/03/ftc-adds-requirements-2014-order-remedy-corelogic-incs-compliance-deficiencies
- CoreLogic 10-K, FY2016: https://www.sec.gov/Archives/edgar/data/0000036047/000003604717000011/clgx-12312016x10k.htm
- Black Knight 10-K, FY2019: https://www.sec.gov/Archives/edgar/data/1627014/000162701420000005/bki2019form10-k.htm
- ICE property transfer data: https://www.icemortgagetechnology.com/products/property-data/residential/public-records/property-transfer-data
- First American DataTree, California: https://dna.firstam.com/solutions/property-data/datatree-property-research/us/ca
- First American DNA Store EULA (2023): https://dnastore.firstam.com/content/pdf/DNA_Online_Store_EULA_2.9.2023.pdf
- PropertyRadar, how we do it: https://www.propertyradar.com/how-we-do-it
- PropertyRadar user agreement: https://www.propertyradar.com/user-agreement
- DataTrace, title plant: https://www.datatracetitle.com/real-estate-title-plant
- The Los Angeles title plant (history): https://ethw.org/First-Hand:The_Title_Plant_Operating_System:_A_Data_Base_System_of_Index_Files_for_Recorded_Documents
- CoreLogic's India operations sold (2011): https://inman.com/2011/07/26/corelogic-selling-india-operations
- PRIA, *Access to and Sale of Bulk Records* (2025): https://pria.us/wp-content/uploads/Bulk-Records_STYLE_07_2025_CLEAN-1.pdf
- Weisbord and Sterk, "The Commodification of Public Land Records", 97 Notre Dame L. Rev. 507 (2022): https://scholarship.law.nd.edu/ndlr/vol97/iss2/1/
- County Recorders' Association of California, "Recorded Documents in California: Access vs. Privacy" (2024): https://content.lavote.gov/docs/rrcc/documents/crac-access-vs-privacy-update3.pdf

**Counties**
- Los Angeles, viewing real estate records: https://www.lavote.gov/home/recorder/real-estate-records/viewing-real-estate-records/view-real-estate-records
- Los Angeles, real estate records FAQ: https://www.lavote.gov/home/recorder/real-estate-records/faqs
- Los Angeles copy fees: https://rrcc.lacounty.gov/general/Schedule_Fees.cfm
- Los Angeles Assessor, data sales: https://assessor.lacounty.gov/real-estate-toolkit/data-sales
- Maricopa Recorder, recording fees (bulk section): https://recorder.maricopa.gov/recording/recording-fees.html
- Clark Recorder fee schedule, 2020: https://www.clarkcountynv.gov/adobe/assets/urn:aaid:aem:4278e8f0-3579-468d-85bb-88b2fa9da3e1/original/as/feeschedule-2020.pdf
- Clark Recorder fees: https://www.clarkcountynv.gov/government/elected_officials/county_recorder/fees
- Clark parcel search: https://recorderecomm.clarkcountynv.gov/AcclaimWeb/Search/SearchTypeParcel
- Clark consideration search: https://recorderecomm.clarkcountynv.gov/AcclaimWeb/Search/SearchTypeConsideration
- San Diego County Administrative Code sec. 86.10: https://codelibrary.amlegal.com/codes/san_diego/latest/sandiego_admin/0-0-0-37010
- San Diego Recorder fee schedule (rev. June 30, 2025): https://www.sdarcc.gov/content/dam/arcc/recorder-county-clerk/forms/Recorder%20County%20Clerk%20Fee%20Schedule.pdf
- Orange County board item, June 25, 2024: http://cams.ocgov.com/Web_Publisher_sam/Agenda06_25_2024_files/images/A24-000359.HTM
- Orange County, obtaining copies: https://www.ocrecorder.com/recorder-services/obtaining-official-record-copies
- Orange County fee schedule, 2026: https://ocrecorder.com/sites/ocrecorder/files/2026-01/FeeSchedule.pdf
- Travis County Clerk fee schedule (updated March 18, 2025): https://countyclerk.traviscountytx.gov/wp-content/uploads/recording/pdf_tc_recording_Detailed_Fee_Schedule_10.12.18DLMUpdated-3-18-25.pdf
- Travis County Clerk, real property records: https://countyclerk.traviscountytx.gov/departments/recording/real-property/
- Hays County Clerk fees (2024): https://hayscountytx.com/download/county_clerk/official_public_records_fees_and_forms/Clerk-Fees-Records-Division-Effective-01-01-2024.pdf
- Caldwell County Clerk, official public records: https://caldwellcounty.texas.gov/government/county-clerk/official-public-records
- Denver Clerk and Recorder, find records: https://www.denvergov.org/Government/Agencies-Departments-Offices/Agencies-Departments-Offices-Directory/Denver-Clerk-and-Recorder/Recording-Division/find-records
- Jefferson County recording fees: https://www.jeffco.us/1599/Recording-Documents-and-Fees
- Douglas County bulk data subscriber agreement: https://www.douglas.co.us/documents/bulk-data-subscribers-agreement-fees.pdf
- Douglas County recording fee schedule, 2023: https://www.douglasco.gov/documents/recording-fee-schedule-2023.pdf/
- Arapahoe County recording fees: https://www.arapahoeco.gov/your_county/county_departments/clerk_and_recorder/recording/recording_fees.php
- Arapahoe County digital records FAQ: https://files.arapahoeco.gov/Clerk%20and%20Recorder/recorder/DOC_DigitalRecordsFAQs_20250324.pdf
- Adams County recording fee schedule: https://adamscountyco.gov/our-county/elected-officials/clerk-recorder/recording/recording-department-fee-schedule/
- Broomfield recorder search: https://egov.broomfield.org/recorder/web/
- Pima County (comparison): https://www.recorder.pima.gov/SubscriptionFees
- San Bernardino County (comparison): https://arc.sbcounty.gov/recorderclerksubscriptions/

**Watcher channels**
- Maricopa legacy recorder robots.txt (Checked November 17, 2026): https://legacy.recorder.maricopa.gov/robots.txt
- Maricopa Assessor robots.txt (Checked November 17, 2026): https://mcassessor.maricopa.gov/robots.txt
- Tex. Prop. Code 51.002 (county posting of notices of sale): https://statutes.capitol.texas.gov/Docs/PR/htm/PR.51.htm
- SB 62 (2023), bill analysis: https://capitol.texas.gov/tlodocs/88R/analysis/html/SB00062I.htm
- Travis County Clerk, foreclosure notices: https://countyclerk.traviscountytx.gov/?p=483
- Denver Public Trustee (GTS software from May 1, 2026): https://denvergov.org/Government/Agencies-Departments-Offices/Agencies-Departments-Offices-Directory/Denver-Clerk-and-Recorder/Recording-Division/Denver-Public-Trustee
- Adams County Public Trustee, new foreclosure report (example file): https://apps.adcogov.org/PTForeclosureSearch/Report_Files/New%20Foreclosure%20Report%2007-28-2026.pdf
- Adams County Public Trustee, sale process: https://adamscountyco.gov/our-county/elected-officials/treasurer-public-trustee/public-trustee-division/foreclosure-sale-bidding-post-sale-process/
- Jefferson County Public Trustee, search foreclosures: https://www.jeffco.us/1001/Search-Foreclosures
- Douglas County Public Trustee: https://www.douglas.co.us/?p=5888
- C.R.C.P. 120: https://www.courtrules.net/colorado/colorado-civil-procedure/rule-120
- A Rule 120 notice posted on the courts' site (example): https://www.coloradojudicial.gov/sites/default/files/2025-11/2025CV30014%20Notice%20of%20Deadline.pdf
- Chief Justice Directive 05-01 (public access to court records): https://www.coloradojudicial.gov/sites/default/files/2025-11/CJD05-01%20Amendments%20Effective%2011.10.2025%20signed%20WEB%20A11Y.pdf

**Law on automated access**
- *Van Buren v. United States*, 593 U.S. 374 (2021): https://www.law.cornell.edu/supremecourt/text/19-783
- *hiQ v. LinkedIn* (9th Cir. 2022), commentary: https://www.zwillgen.com/alternative-data/ninth-circuit-rules-scraping-public-website-likely-not-cfaa-violation/
- *Meta v. Bright Data* (N.D. Cal. 2024), report: https://techcrunch.com/2024/01/24/court-rules-in-favor-of-a-web-scraper-bright-data-which-meta-had-used-and-then-sued
- *Ticketmaster v. RMG Technologies* (C.D. Cal. 2007), order: https://www.cacd.uscourts.gov/sites/default/files/CV07-2534ABD.pdf
- California Penal Code 502 and the split on "without permission", in a 2015 practitioner article: https://www.mto.com/Templates/media/files/Reprints/Daily%20Journal_Computer%20Crime_J_Blavin_10-5-2015.pdf
- *Facebook v. Power Ventures* (9th Cir. 2016) and *Craigslist v. 3Taps* (N.D. Cal. 2013): read only through commentary; cite from the opinions [verify]

**Statutes and cases**
- C.R.S. 30-10-101 (Colorado bulk subscription): https://colorado.public.law/statutes/crs_30-10-101
- C.R.S. 38-38-101 (notice of election and demand): https://colorado.public.law/statutes/crs_38-38-101
- Cal. Gov. Code 7928.205: https://california.public.law/codes/government_code_section_7928.205
- AB 1785 (2024): https://legiscan.com/CA/text/AB1785/2023
- Cal. Gov. Code 27301 (SSN truncation): https://california.public.law/codes/government_code_section_27301
- Cal. Gov. Code 27366 (copy fees): https://california.public.law/codes/government_code_section_27366
- Cal. Gov. Code 7921.300: https://law.counselstack.com/statute/ca/GOV/7921.300.
- Cal. Gov. Code 7922.575: https://california.public.law/codes/government_code_section_7922.575
- *Sierra Club v. Superior Court* (2013): https://scocal.stanford.edu/opinion/sierra-club-v-super-ct-34241
- Cal. Civ. Code 2924f: https://california.public.law/codes/civil_code_section_2924f
- Tex. Gov't Code 552.222: https://texas.public.law/statutes/tex._gov't_code_section_552.222
- Tex. Local Gov't Code 118.011: https://statutes.capitol.texas.gov/docs/LG/htm/LG.118.htm
- 1 Tex. Admin. Code 70.3: https://www.law.cornell.edu/regulations/texas/1-Tex-Admin-Code-SS-70-3
- NRS 239.052: https://law.justia.com/codes/nevada/chapter-239/statute-239-052/
- NRS 247.540: https://nevada.public.law/statutes/nrs_247.540
- A.R.S. 11-484: https://www.azleg.gov/ars/11/00484.htm
- Maricopa Recorder, facts about redaction: https://recorder.maricopa.gov/asset/jcr:21c7224e-199b-476a-a7f6-336fdf4e0066/Important%20Facts%20About%20Redaction.pdf

**Tools**
- Amazon Textract pricing: https://aws.amazon.com/textract/pricing/
- Google Document AI pricing: https://cloud.google.com/document-ai/pricing
- FFIEC National Information Center: https://www.ffiec.gov/npw
