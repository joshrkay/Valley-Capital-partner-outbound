# County loans: the core of the pipeline

The parts of the county pipeline that do not depend on any county's format (`docs/county-data-build-vs-buy.md` 5.2, components 5 and 9). The goal is to show each bank's individual loans that public records name, on its bank page. Two real counties are built, Jefferson and Douglas in Colorado (section 5a), and **neither is enabled**: each waits on a principal's recorded decision. The invented example runs against its fake.

**The rule.** Loan and borrower detail is context for the firm's principals only:

- It lives in the data folder's `loans/` and the platform database, never in this repository.
- It never goes in a log or a message.
- No model-facing action loads `loans/` (research, draft, approve, call prep, call notes, the call desk), and neither does scoring. A county document cannot change a score, a weight or a tier. `test/loans-handoff.test.mjs` proves each of these.

## 1. The record

One record per public-records document about a loan (`src/loans.mjs`, `buildDocument`). Example (invented):

```json
{
  "id": "example-county:2026-004105",
  "sourceId": "example-county",
  "county": { "fips": "99001", "name": "Example" },
  "state": "CO",
  "documentType": "notice_of_trustee_sale",
  "documentNumber": "2026-004105",
  "dates": { "recorded": "2026-11-11", "filed": null, "sale": "2026-12-09" },
  "parties": [
    { "role": "beneficiary", "name": "Example Bank, N.A.", "city": null, "state": null },
    { "role": "holder", "name": "Sample Capital Fund LP", "city": null, "state": null },
    { "role": "attorney", "name": "Example Law Group, P.C.", "city": null, "state": null },
    { "role": "grantor", "name": "Sample Office Owner LLC", "city": null, "state": null }
  ],
  "property": { "address": "500 Sample Boulevard, Anytown, CO 80000", "apn": "0000-00-0-00-005", "useCode": null, "propertyType": null },
  "amounts": {
    "originalPrincipal": { "value": 7800000, "unit": "dollars", "basis": "document" },
    "unpaidBalance": { "value": 7215000, "unit": "dollars", "basis": "document" }
  },
  "deedOfTrust": { "documentNumber": "2018-0333222", "recorded": "2018-04-27", "book": null, "page": null },
  "sources": [{ "url": "https://publictrustee.example/documents/2026-004105", "fetchedAt": "2026-11-16T12:00:00.000Z" }],
  "contentHash": "3f9c0a1b2c3d4e5f",
  "contextOnly": true,
  "firstSeenAt": "2026-11-16T12:00:00.000Z", "firstRunId": "county:example-county-20261116T120000Z-ab12",
  "updatedAt": null, "updatedRunId": null,
  "_source": { "source": "county:example-county", "endpoint": "https://publictrustee.example/documents/2026-004105", "query": { "source": "example-county" }, "recordId": "example-county:2026-004105", "period": "2026-11-11", "fetchedAt": "2026-11-16T12:00:00.000Z", "runId": "county:example-county-20261116T120000Z-ab12" }
}
```

- **Document types** and the stage each marks:

  | Type | Stage |
  |---|---|
  | `deed_of_trust` | Loan recorded |
  | `assignment` | Loan assigned |
  | `notice_of_default`, `election_and_demand` | Foreclosure started |
  | `rule_120_notice`, `lis_pendens` | In court |
  | `notice_of_trustee_sale` | Sale scheduled |
  | `trustees_deed` | Sold at foreclosure |
  | `release` | Released |

  A county's own codes are mapped to these in its adapter.
- **Roles:**
  - The lender side: `lender`, `beneficiary`, `holder`, `assignor`, `assignee`.
  - The rest: `trustee`, `attorney`, `borrower`, `grantor`.
  - A document must name at least one lender-side party.
- **Amounts.** Each amount has a basis:
  - `document`: stated on the document;
  - `index`: in the county's index;
  - `not-stated`;
  - `not-read`: on the image, not read yet.

  A stated amount has a value in dollars; the other two have none, and are never zero. An original principal is the size when the loan was made. It is never divided by a reported balance (`docs/paper-estimate.md` Q2).
- **Property type** is null until a county's assessor join gives a use code. It is never guessed.
- **What a public trustee's list adds** (all optional; a source without them keeps the shape above):
  - `dates.listed`: the date of the county's own list that gave an entry that is not itself a recorded document (a pre-sale list's run date). The event then says "was listed on".
  - `property.legal`: the legal description, where the list gives one.
  - `deedOfTrust.dated`: the deed of trust's own date, beside its recording date and number.
  - an amount's `label` (the county's word for the figure, such as "Total Indebtedness") and `asOf`.
  - `loan { type, commercial }`: the county's loan type as written ("BPL Commercial") and the flag its adapter reads from it. Unknown or blank types give `null`, never a guess.
  - `foreclosure { number, reception, attorneyFileNumber, publication, amendedPublication, bid, deficiency }`: the public trustee's file.
  - `unread`: the fields the list gave that failed their check, each left empty and named here (an amount also says `not-read` in its basis).
  - the role `owner`: the property's current owner where the list names one apart from the borrower. Borrower side, never matched.

  The bank's file carries the loan type and its flag, and none of the rest.
- **The id** is `<source>:<document number>`, uppercased, with spaces removed. So a weekly re-read lands on the same id, and a new document is new. A list keyed by a case or foreclosure number that carries several documents gives each its own suffix (`FC-2026-0001/NED`).
- **The content hash** covers the document's content. It leaves out the fetch date and the run. Nothing outside `RECORD_KEYS` is stored: an adapter cannot add a field by accident.

## 2. Where it lives

| Path | What |
|---|---|
| `loans/docs/<source>.json` | Every document a source has given, by id. Only the watcher writes it. |
| `loans/banks/fdic-<CERT>.json` | The bank's matched documents, newest first, with the engine's labels. **No borrower, grantor, address or APN.** The bank page reads only this file. |
| `loans/review.json` | Names that matched no bank or several, with their candidates; and the names set aside, with their class. |
| `loans/events.json` | One dated event per document and bank, written the first time they match. |
| `loans/state.json` | Each source's last run and up to 12 runs: documents read, new, changed, unchanged. For a source that reads files, the files it has read (address, posted date, ETag, Last-Modified and the report's dates; up to 200), never their contents. Also the index's counts. |

**The platform.** Every path fits the existing `documents` table, so **no migration is needed** (a test checks each path against the table's own path rule).

- The bank page loads `loans/banks/fdic-<CERT>.json` and `loans/state.json` with the principal's token, as it loads `paper/fdic-<CERT>.json`.
- A worker job kind for the watcher would need the jobs table's kind list widened. It is left for the first real county adapter: until then there is nothing to run on the worker.

## 3. The lender match (component 5)

`src/lenders.mjs`, `matchLender`. Only lender-side roles are matched. A trustee, an attorney, a borrower or a grantor never is. A borrower's or grantor's name never reaches the review list.

**Set aside first, and never matched to a bank, whatever an alias says:**

- **MERS**, a nominee and not the lender. "MERS, as nominee for X" is read as X.
- **Trustees:** trustee or foreclosure-services companies, title companies, public trustees, reconveyance companies, or any party "as trustee".
- **Servicers:** "as servicer", "as attorney-in-fact", or "servicing", "servicer" or "loan services" in the name.
- **Law firms:** LLP, PLLC, P.C., P.A., Esq., "attorneys", "law firm", "law office", "law group".

**Then matching**, with `resolveParty` from `src/sources/enforcement.mjs`:

1. **A principal's alias** (`candidates/aliases.json`), on the name exactly as the document gives it, then without its legal phrases.
2. **The exact normalized name**, after the legal phrases are cut: "its successors and assigns", "successor by merger to", "as beneficiary", "a national banking association". A leading "The" is ignored, and N.A. equals National Association. The name is narrowed by the state and then the city **the document gives for that party**.
3. The county's state is shown beside each candidate, never used to choose: banks lend across state lines.

**The outcome:**

- One bank is a match.
- Two or more are **ambiguous**. The name goes to the review list with every candidate.
- None is **unmatched**. The name goes to the review list. Its candidates are banks of that name in another state; its suggestions are similar names, for a principal only.
- **Nothing fuzzy merges.** A principal resolves a review entry with `outbound loans alias --key fdic:CERT --name "..." --by NAME`, which matches every stored document again.

Former names and holding companies from FDIC history or FFIEC NIC are not added yet. A principal's alias covers them meanwhile.

## 4. The weekly watcher (component 9) and its event

`diffDocuments` and `buildLoanIndex` in `src/loans.mjs`.

- **The weekly diff:**
  - a new id is written;
  - a changed one is updated, keeping when it was first seen; the change log names the field, never its value;
  - an unchanged one is left exactly as it was;
  - a document no longer listed stays, as history.
- **Re-reading the same week** writes no document, no bank file and no event.
- **An event** is written for each document newly matched to a bank. Its sentence is a fixed template:

  > A notice of trustee's sale was filed on November 10, 2026 for a loan from this bank on a property in Example County, CO.

  - The date is the filing date, or the recording date when there is none.
  - An assignment says "moving a loan ... from this bank to another holder" (or "to this bank").
  - `basis` is `new-document`, or `new-match` when a principal's alias made an older document match.
- **Events are context only.**
  - `scored: false`; scoring never loads `loans/`, and `scoring.json` has no county signal.
  - The weekly triage lists them under **Watch**, never act now (`triage.json` strength `county-document`), once each.
  - They carry no signal id, so they never bring back a bank a principal dismissed.
  - The bank page shows the documents themselves.

## 5. What a county adapter must provide

`defineNoticeSource` in `src/sources/notices.mjs`. `src/sources/counties/example.mjs` is a complete, invented example.

- `id`, `label`, `county { fips, name }`, `state`.
- `channel`:
  - `a`: an official feed under the county's agreement;
  - `b`: a free public list meant to be read;
  - `c`: a search site, only after a dated terms read allows it.
- `cadence`: `weekly`, or `twice-weekly` for Texas.
- `hosts`: every host it reads. Nothing else is fetched.
- `terms { robotsCheckedOn, termsCheckedOn, decision, by }`. A real source runs only with `decision: 'allowed'`, both dates and who decided (county-data-build-vs-buy D-B8). An `example` source runs only against its fake.
- `requests({ now, state })`: the pages to read.
- `parse(text, { url, fetchedAt, kind, state, since })`, which returns:
  - `documents`, in `buildDocument`'s shape;
  - `rows`;
  - `skipped`, each with a reason;
  - `missing`: a count per required field. One is a format change: the run fails and writes nothing;
  - optionally `follow`: further pages or files the page links, which the same run reads (at most three links deep, only on the source's hosts, after their robots.txt), and `known`, the linked files left alone because they were read before.
- Optionally:
  - `parseFile(bytes, ctx)` for a followed file read as bytes (a PDF). It also returns `file { key }`, which the run keeps in the source's state on success. A file read before is asked for again with its ETag and Last-Modified, and a 304 is not read.
  - `backfill { since, requests }`: a one-time read of the source's archive (`outbound loans backfill --source ID [--since DATE]`), with the same gate.
  - `minIntervalMs`: a longer interval than the config's, where the county asks one.
- **A fake** with invented data (`test/county-notices-fake.mjs`).
- **Its live check:** `outbound loans verify --source ID`, run once from an open network before the source is listed in `config.counties.watch`.
- **Its switch:** `config.counties.sources.<id>` `{ enabled, waitingOn }`. A source marked `enabled: false` is refused even with a recorded decision.

**The shared run** (`runNoticeSource`):

1. robots.txt first; a disallowed page stops the run.
2. The firm's User-Agent (`config.counties.userAgent`) on every request.
3. At least 20 seconds between requests (3 a minute), or a longer Crawl-delay.
4. Nothing bypassed: no login, CAPTCHA or challenge page.
5. Every document built and checked before anything is written.
6. The run log line (`county:<id>`, counts only) and `loans/state.json`.

**The verify check:**

- **fresh**;
- **sourced:** source block, type, date, the link on the source's own host, id, hash, no extra field;
- **recall:** every listed document is stored, with the same content;
- **matched:** every lender name is matched, set aside, or on the review list.

## 5a. The GTS counties: Jefferson and Douglas

Colorado's public trustees in Jefferson and Douglas run GTS (`docs/county-watchers-recon.md`, section 3). `src/sources/counties/gts.mjs` holds what their reports share; `jefferson.mjs` and `douglas.mjs` are the adapters.

- **The reports page** (`{base}/reports`) is read first, and each report is found by its link's text, never its type number (Jefferson's pre-sale list is `t=6`, Douglas's `t=1`).
- **Each report's index:** the month heading, then one item per file with its posted date, its `Report_Files/{file}.pdf` link and a description. Files are read oldest first, so a later update wins.
- **Files are keyed** on the server's ETag (or Last-Modified) and the report's own dates, never the name alone: Jefferson's pre-sale file has the same name every week.
  - A file already read with the same posted date is not asked for.
  - The same name under a new posted date is asked for with its ETag; a 304 is not read.
- **The text** comes from `pdftotext -layout` (poppler-utils), run as a child process with the PDF on stdin. No PDF is written to disk.
- **Every amount and date is checked:**
  - a field that fails is left empty and named in `unread`;
  - a label a record lacks leaves its field empty;
  - a label no record has, a missing title, or a pre-sale count that differs from the list's own `Total Foreclosures:` is a format change, and the run writes nothing;
  - a two-digit year is not read, since its century would be a guess.

**Jefferson's NED report** (`election_and_demand`, id `<foreclosure number>/NED`):

| Label | Record |
|---|---|
| `Current Lender (Beneficiary)` | party `holder` |
| `Grantee (Lender On Deed of Trust)` | party `lender` (MERS as nominee is read as the nominee's principal) |
| `Grantor (Borrower On Deed of Trust)`, `Current Owner` | parties `grantor`, `owner` |
| `Attorney for Beneficiary`, `Attorney File Number` | party `attorney`; `foreclosure.attorneyFileNumber` |
| `Address`, `Legal` (with `APN #:` inside it) | `property.address`, `legal`, `apn` |
| `Original Note Amt` | `amounts.originalPrincipal` (basis `index`) |
| `Current Amount`, `As Of` | `amounts.unpaidBalance` with its `asOf` |
| `Deed of Trust Date`, `Recording Date`, `Reception #` | `deedOfTrust.dated`, `recorded`, `documentNumber` |
| `NED Date`, its `Reception #` | `dates.recorded`; `foreclosure.reception` |
| `Original Sale Date` | `dates.sale` |
| `LoanType` | `loan.type`, and `loan.commercial`: true for Commercial, BPL Commercial or business; false for Conventional, Conv, FHA, VA, USDA and reverse; null otherwise |
| `First` and `Last Publication Date` | `foreclosure.publication` |

**The pre-sale list, one parser for both counties** (`notice_of_trustee_sale`, id `<foreclosure number>/SALE`):

| Label | Record |
|---|---|
| `Current Beneficiary Name` | party `holder` |
| `The Grantor` | party `grantor` |
| `Legal Description` (with `PARCEL:`, `PARCEL ID:` or `APN:` inside it), `Street Address` | `property.legal`, `apn`, `address` |
| `Total Indebtedness` | `amounts.unpaidBalance`, labelled "Total Indebtedness" |
| `Lender's Bid Amount`, `Deficiency` | `foreclosure.bid`, `deficiency` |
| `First`/`Last Publication`, `Amended First`/`Last Publication` | `foreclosure.publication`, `amendedPublication` |
| the header's run date and `Sale Date:` | `dates.listed`, `dates.sale` |

**Not kept:** interest rate and type, the re-recording date and number, the newspaper, and the attorney's phone and fax.

**Not enabled.** Both are registered in `src/counties.mjs`, `sources.json` (`adapter`) and `config.counties.sources` with `enabled: false`, and their adapters' `terms.decision` is unset:

- Jefferson waits on a principal's decision and counsel's note on its "data compilations" copyright claim.
- Douglas waits on a principal accepting its reports page's terms.

The backfill of Jefferson's NED archive (`report?t=14`, monthly from January 2025) sits behind the same gate.

## 6. Where it shows

- **The bank page:**
  - a **Loans we can see** card in the sidebar: the count, the newest three and the watched counties;
  - a **Loans we can see** tab: each document's type, county, date, stage, amounts with their basis, property type and a link to the source document.
  - With none, the page says which counties are watched and that none has a document for this bank yet.
- **System status:** a **County records** row per watched county: the last run, documents read, new this week, matched to a bank, and names to review.
- **The command line:** `outbound loans run | backfill | verify | status | show | review | alias | match | events`.

## 7. Not built yet

- Enabling Jefferson and Douglas: each waits on a principal (section 5a). The other counties in the recon.
- The image reader (component 4).
- The commercial filter and the assessor join that gives `useCode` and `propertyType` (component 3).
- The loan chain to the current holder (component 6).
- The observed layer's figures (E14-S4).
- A worker job kind.
- Removing a document a county later marks confidential.
- Counsel's view on holding borrower names (data-sources D13).
