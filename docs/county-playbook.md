# County playbook: one county at a time

How the firm gets property-record data, county by county, starting with **Maricopa County (Phoenix)**. It builds on `docs/data-sources.md`, section 2.3. Research is from November 13, 2026. Facts carry the same marks:

- **Checked**: fetched or queried live.
- **Seen**: the official page's text, read through search results.
- **Unconfirmed**.

No prospect data is in this file: no borrower, owner or lender names.

## 1. Why the county is the unit

- In all five states, the county holds the property records: deeds of trust, foreclosure notices, liens, the tax roll and the assessor's file. Cities do not.
- Each county runs its own system, with its own terms and its own delay, so each county is its own build.
- The city is a second layer: what is happening at the property.
- Some large CRE areas belong to no city. The Las Vegas Strip is unincorporated Clark County, and much of Maricopa is unincorporated. There, the county is also the city.

## 2. The checklist for every county

Each layer is judged by one question: **does it name the lender, or lead to it?** The firm buys loans from lenders, so a distressed property matters only once we know whose loan it is.

| Layer | What it tells us |
|---|---|
| A. Foreclosure trail | Notice of default or of trustee's sale, its cancellation, the trustee's deed: lender, trustee, sale date |
| B. Other recorded documents | Assignments (a loan changed hands); substitutions of trustee (often just before a notice); modifications; releases (payoffs); mechanics' liens (stalled construction); lis pendens |
| C. The lender map | The lender on every commercial deed of trust: which banks hold commercial loans where |
| D. Property tax | Delinquent commercial taxes; the tax lien sale |
| E. Assessor | Commercial or not, use code, units, owner entity, value |
| F. Courts | Receiverships, judicial foreclosures, lender lawsuits |
| G. City layer | Code enforcement, building permits (a project issued but never finished), vacant-building registries, licence changes |

**A county is done** when four things hold:
1. Its sources and their terms are recorded, with the date checked.
2. Its adapters pass a live check.
3. Four weeks of data have been measured:
   - commercial notices a month;
   - the share matched to a known bank or servicer;
   - the delay from recording;
   - the false-alarm rate.
4. A principal has decided whether to expand.

**Rules that hold in every county:**
- **Never get around bot protection.** Maricopa's new recorder site answers automated requests with a Cloudflare challenge, and the Clerk of Court's site with an Akamai block. We stop there.
- **Honour robots.txt and the terms.** Where they forbid automated access, we ask the office for permission or use its paid bulk route.
- **Names are prospect data.** They live only in the platform's database (Supabase) and the data folder, never in the repository, logs or notes.
- **The asset rule.** A property or filing is context for a principal. It never reaches the drafter.
- **Counsel clears each state's public-records law before we use it commercially.** Arizona's is below.

## 3. Maricopa County, the pilot

### What the records offer

The legacy recorder is `legacy.recorder.maricopa.gov` ("LR").

| Layer | Finding | Mark |
|---|---|---|
| A | **Notice of trustee's sale is code NS**, about 450–650 a month countywide (141 in 4 business days, November 9–13). Its cancellation is **CQ**; the trustee's deed is **TD**. The sale can come no sooner than the 91st day after recording (A.R.S. 33-808). | Checked |
| A | LR lists documents by code and date (one code per request, 500 rows a page, paged by recording number) and lists them the same day. The **detail page names the parties without saying who is grantor or grantee**, and names appear about 2 business days later. | Checked |
| A | Document images are free PDFs, **scans with no text layer**, so reading them needs OCR. By statute (A.R.S. 33-808(C)), a notice of trustee's sale must show the **parcel number (APN), the original principal, and the beneficiary's and trustee's names and addresses**. | Checked |
| B | Other codes, with a week's volume (November 2–6):<br>• assignment AS: 399 (older codes AD, CA, AM, PG folded in)<br>• substitution of trustee ST: 138<br>• modification MF: 142<br>• mechanics' lien ML: 38<br>• lis pendens LP: 31<br>• full reconveyance DR: 556 on one day<br>• deed of trust DT: 350 on one day<br>The old-to-new code map is at `LR/recdocdata/newdoccodelist.aspx`. | Checked |
| C | The index has no roles, and a deed of trust's named entity may be MERS, a nominee, rather than the lender. **The lender and the APN are on the image, not in the index.** | Checked on one sample |
| D | **Treasurer:**<br>• delinquent list by parcel (CD035): $375<br>• tax-sale list (CD055), with class codes: $25, each January<br>• weekly activity (CD05): $2,500<br>The lien sale runs online each February. A free map shows delinquent parcels. First-half 2026 taxes became delinquent on November 2. | Checked (map Seen) |
| E | **Assessor:**<br>• free downloads: Secured Master (parcel, use code, owner and mailing address, legal class, units, values), Commercial Master, Apartment Master<br>• an API whose token is "on request"; price and terms not stated<br>Legal classes: 1.12 commercial, 1.8 shopping centre, 4.2 rental. Use-code ranges (03xx apartments, 04xx–06xx lodging, 11xx–16xx retail and office) are Unconfirmed against the state manual. | Checked; use codes Unconfirmed |
| F | **Superior Court:**<br>• case search by party or case number only, not by case type or date<br>• case types 133 Foreclosure, 158 Quiet Title and 187 Real Property; **no receivership type**, since receivers are appointed inside other cases<br>• bulk new-filings lists only by agreement with the Clerk<br>• the Clerk's site blocks scripts | Case types Checked; the rest Seen |

### The finding that changes the plan
LR's `robots.txt` says **`Disallow: /recdocdata/`**, which is the search path itself (file dated October 2, 2026; Checked). Its other pages already redirect to the new site, which is behind Cloudflare. So **LR is not a route for automation unless the Recorder agrees in writing.**

The sanctioned route is the **Recorder's bulk account**:
- **To open it:** a $300 deposit and a $50 standing balance. A commercial-purpose statement under A.R.S. 39-121.03 must be on file first.
- **Fees** (Seen):
  - $0.015 per grantor/grantee index record;
  - $0.08 per image (the unit is unclear);
  - or $250 a day for all of the previous day's recordings, about $62,000 a year.
- **Rough metered cost:** the codes above come to about 25,000 index records a month, about $375. Images are needed only for the few hundred notices a month that name only companies. Unconfirmed until the account's price list is in hand.

**Arizona's law needs counsel.** A.R.S. 39-121.03 requires a commercial-purpose statement before records are used commercially. Its subsection (C) provides for treble damages for commercial use of a public record obtained "from anyone other than the custodian" (Seen). That bears on buying Maricopa records from a vendor.

### Recommended adapter
1. **Source.** The bulk account's daily name index, plus images. The LR endpoints are used only with the Recorder's written permission.
2. **Codes.**
   - Daily: NS, CQ, TD, ST, LP, AS, MF, ML, DR, RZ.
   - DT as the baseline for the lender map.
   - Keep the old-to-new code map.
3. **Triage.** Flag documents whose parties are all companies. Read those notices' images: APN, beneficiary, trustee, original principal, sale date, and the deed of trust they cite. OCR, or Claude reading the PDF with every field checked against the statute's list, is a choice for D6.
4. **Commercial filter.** Join the APN to the monthly Secured Master. Keep legal class 1.x, class 4.2 with 5 or more units, or anything in the Commercial or Apartment Master. Then apply a principal's floor on original principal.
5. **Chain.** Follow each notice to its deed of trust, then to that loan's assignments and substitutions, to find the **current holder**. Close the record on a cancellation (CQ) or a trustee's deed (TD).
6. **Output.** A table per lender: active notices, total principal, property types. Matched to FDIC banks and CMBS servicers.
7. **Tax.** CD055 each January and CD035 each quarter, joined on the APN.
8. **Courts.** A Clerk bulk agreement for case types 133, 134, 158 and 187. Until then, lender names are searched by hand.
9. **Schedule.**
   - Recorder: nightly, with names pulled again three business days later.
   - Assessor: monthly.
   - Courts: weekly.
   - Live requests at most 3 a minute.
10. **The estimate to test:** about 10–35 commercial notices a month, from 5.2% of 1.71 million parcels being commercial or apartment. The four-week measure replaces it with a real count.

### Pinal County (Phoenix metro)
- **Recorder:** Acclaim, searchable by document type. Images are watermarked unofficial copies; $1 a page for copies. Seen.
- **Assessor:** no official free bulk file. A public parcel map service exists. Seen.
- Small next to Maricopa; it follows once Maricopa works.

## 4. The city layer: Phoenix first

| Dataset | Access | Join | Use | Mark |
|---|---|---|---|---|
| **Building permits** (ShapePHX permits layer; issued-permit export since 1998) | ArcGIS REST, no key; CSV export | **APN** | A commercial permit issued and never finished points to a stalled project and a stressed construction loan | Seen |
| **Property maintenance (code cases)**: monthly, CC-BY, about 106,000 cases from 2024 to 2026 | phoenixopendata.com (CKAN), no key | Address only: match to the assessor's situs address | Escalations (ticket, city abatement, vacant unit); notes mention vacant, boarded or commercial | Checked |
| Vacant property registry (non-residential, 50+ units) | Owner login only; no public list | — | The best flag, but only through a public-records request | Checked |
| Mesa permits and code cases | Socrata API | Address; parcel field Unconfirmed | Same uses as Phoenix | Seen |
| Tempe code violations | ArcGIS Hub | APN | Residential only | Seen |
| Arizona lodging tax by hotel | Confidential by law (A.R.S. 42-2001) | — | Not available | Seen |

## 5. Los Angeles: a vendor or nothing

The LA County Registrar-Recorder offers no online access to records or indexes (Seen). So LA, and the lender and trustee fields in Orange, San Diego and Clark, come from a vendor.

| Vendor | What fits | Delivery and price | Licence |
|---|---|---|---|
| **ATTOM** | Notices of default and of sale, lis pendens, REO; foreclosing lender, trustee; assignment and release records; deeds of trust with a standardized lender name | API, bulk, Snowflake. API from $500 a month; pre-foreclosure by quote. **Free 30-day trial key.** | Bulk is sold for hosting on our own servers. Checked (pages); some fields Seen |
| PropertyRadar | LA recorder since 1949, foreclosures since 2002, trustee sales since 2006; Orange, San Diego, Clark, Maricopa | API and webhooks on every plan; $119, $249 or $599 a month | **Internal use only, no combining with other data, and delete everything within 30 days of cancelling.** That rules it out as a system of record. Checked |
| ICE, Cotality (formerly CoreLogic), First American DataTree | Foreclosure and assignment data, national | Quote only | Unconfirmed |
| Reonomy | Commercial debt records with lenders | About $400–500 a month | Unconfirmed |
| Trellis | Indexes California "appointment of receiver" motions, LA Superior Court included | About $37 a month; API by quote | Unconfirmed |

**Plan:** trial ATTOM first. The trial measures five things:
- coverage of LA commercial notices of default and of sale;
- whether the lender, after any assignment, the trustee, the sale number and the APN are filled in;
- the delay from recording;
- lender-name standardization;
- whether assignments link back to the original loan.

Questions for ATTOM:
1. How LA documents are collected, and with what delay.
2. Whether those fields are parsed or only on the image.
3. Commercial capture by property type.
4. How MERS is handled.
5. Lender parent IDs.
6. Lis pendens and receiverships.
7. **Whether we may store the data, join it to ours and keep it after the contract ends.**
8. The price for commercial-only data in the four counties, delivered daily.

## 6. Decisions

| # | Decision | Default meanwhile |
|---|---|---|
| D7 | Maricopa route:<br>• ask the Recorder for written permission to use the legacy search;<br>• open the metered bulk account (the $300 deposit, then about $375 a month);<br>• buy the full daily feed (about $62,000 a year); or<br>• use a vendor. | **Recommended:** open the metered account, and ask for permission while it is set up |
| D8 | Counsel on A.R.S. 39-121.03:<br>• which commercial-purpose statements to file;<br>• whether viewing free online counts as obtaining a record;<br>• whether vendor data exposes the firm under subsection (C).<br>California and Nevada need the same review before a vendor feed is used there. | Nothing is used commercially before counsel answers |
| D9 | What counts as commercial: which legal classes, how many units, and what floor on original principal | Class 1.x, or 4.2 with 5 or more units; no floor |
| D10 | Reading notice images: OCR, or Claude reading the PDF with every field checked | Decided when the adapter is built |
| D11 | Treasurer files: CD055 each January ($25) and CD035 each quarter ($375) | Not bought |
