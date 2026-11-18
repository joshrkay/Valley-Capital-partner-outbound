# County loans: the core of the pipeline

The parts of the county pipeline that do not depend on any county's format (`docs/county-data-build-vs-buy.md` 5.2, components 5 and 9). The goal is to show each bank's individual loans that public records name, on its bank page. Three real counties are built, and all three are enabled, each on a principal's recorded decision: Caldwell County, Texas (section 8), and Jefferson and Douglas in Colorado (section 5a, decided 2026-11-18). The weekly job still runs only once a principal sets `COUNTIES_ENABLED`. The invented example runs only against its fake.

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
  - The rest: `trustee`, `attorney`, `borrower`, `grantor`, `owner`, `servicer`. Neither of the last two is ever matched:
    - `owner`: the property's current owner where a list names one apart from the borrower (Colorado's NED reports do). Borrower side.
    - `servicer`: the mortgage servicer, which a Texas notice names apart from the mortgagee. It collects for the lender and is not one.
  - A document must name at least one lender-side party.
- **Dates:** `recorded`, `filed`, `listed` (the date of a county list that gave the entry; see below), `sale`, and `notice`, the date a notice itself states. A document needs a recording, filing, notice or list date. A notice of sale whose own date could not be read is known by its sale date. A document is known by the first of filed, recorded, notice, listed and sale it has; the event says "was filed on", "was recorded on", "dated ... was posted", "was listed on" or "for a sale on ... was posted".
- **Amounts.** Each amount has a basis:
  - `document`: stated on the document;
  - `index`: in the county's index;
  - `not-stated`;
  - `not-read`: on the image, not read yet.

  A stated amount has a value in dollars; the other two have none, and are never zero. An original principal is the size when the loan was made. It is never divided by a reported balance (`docs/paper-estimate.md` Q2).
- **Not read.** `unread` names, by its place in the record (`dates.sale`, `amounts.unpaidBalance.asOf`), every field the source gave that failed its check: a misread date, an amount that is not money, an OCR error. So "not read" is never confused with "not on the document". An amount not read also has the basis `not-read`, and its adapter names it in `unread` too.
- **The deed of trust** has its recording number (or book and page) and its recording date, and `dated`, the date it was signed, when the source gives it.
- **The sale place** (`salePlace`), when the notice gives it.
- **The source:** the document's own link, its ETag, and `listUrl` when the document's link would name a person (a Texas notice's file is named for the debtor). The bank's file and the events carry `listUrl` instead of the document's link.
- **Property type** is null until a county's assessor join gives a use code. It is never guessed.
- **What a public trustee's list adds** (all optional; a source without them keeps the shape above):
  - `dates.listed`: the date of the county's own list that gave an entry that is not itself a recorded document (a pre-sale list's run date). The event then says "was listed on".
  - `property.legal`: the legal description, where the list gives one.
  - an amount's `label` (the county's word for the figure, such as "Total Indebtedness") and `asOf`.
  - `loan { type, commercial }`: the county's loan type as written ("BPL Commercial") and the flag its adapter reads from it (`commercialFromLoanType`, section 3a). Unknown or blank types give `null`, never a guess.
  - `foreclosure { number, reception, attorneyFileNumber, publication, amendedPublication, bid, deficiency }`: the public trustee's file.

  The bank's file carries the loan type and its flag, and none of the rest.
- **The id** is `<source>:<document number>`, uppercased, with spaces removed. So a weekly re-read lands on the same id, and a new document is new. A list keyed by a case or foreclosure number that carries several documents gives each its own suffix (`FC-2026-0001/NED`).
- **The content hash** covers the document's content. It leaves out the fetch date and the run. Nothing outside `RECORD_KEYS` is stored: an adapter cannot add a field by accident.

## 2. Where it lives

| Path | What |
|---|---|
| `loans/docs/<source>.json` | Every document a source has given, by id. Only the watcher writes it. |
| `loans/banks/fdic-<CERT>.json` | The bank's matched documents in scope (section 3a), newest first, with the engine's labels, each with its `scope` and `relation`. **No borrower, grantor, address or APN.** The bank page reads only this file. |
| `loans/review.json` | Names on documents in scope that matched no bank or several, with their candidates; and the names set aside, with their class. |
| `loans/events.json` | One dated event per document in scope and bank that holds the loan now, written the first time they match. |
| `loans/state.json` | Each source's last run and up to 12 runs: documents read, new, changed, unchanged (and, for a linked-document source, listed, fetched, held and deferred). For a source that reads report files, the files it has read (address, posted date, ETag, Last-Modified and the report's dates; up to 200), never their contents. A recorded block. Also the index's counts. |
| `loans/cmbs.json` | One entry per document in scope whose current holder is a CMBS trust: linked to the trust's own loan record from SEC EDGAR, or "trust named, loan not found" with the reason (section 9). **No borrower, address or servicer commentary.** The triage and the special servicer's page read it. |
| `loans/lists/<source>.json` | A linked-document source's list: each page's ETag, the documents recorded as history on its first run, and the documents held as unreadable, by id and reason. **No name and no link.** |

**The platform.** Every path fits the existing `documents` table (a test checks each path against the table's own path rule).

- The bank page loads `loans/banks/fdic-<CERT>.json` and `loans/state.json` with the principal's token, as it loads `paper/fdic-<CERT>.json`.
- **The worker job `loans.watch`** runs every enabled county, each in its own unit of work (`LOADS.loans`): each source `config.counties.watch` lists that `config.counties.sources` does not mark not enabled, and each one it marks enabled (`enabledSourceIds`). So enabling Jefferson or Douglas there adds it to the weekly run with no other change. Its result holds counts only. A county its gate refuses, or whose run fails, fails the job, which turns the workflow red. The jobs table's kind list needs the migration `supabase/migrations/20261118120000_jobs_loans_watch.sql`.

## 3. The lender match (component 5)

`src/lenders.mjs`, `matchLender`. Only lender-side roles are matched. A trustee, an attorney, a borrower or a grantor never is. A borrower's or grantor's name never reaches the review list.

**Set aside first, and never matched to a bank, whatever an alias says:**

- **People:** a lender named as one or more people, with no word an institution's name carries. A person who financed a sale is not an institution, and no person named in a notice is ever a lead. The review list counts them in one line and names none.

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

## 3a. Scope: commercial loans only

The firm buys commercial real estate loans, and most loans a county's foreclosure list names are home mortgages (the first Jefferson backfill: of 137 documents matched to a bank, 76 were flagged residential, 58 had a loan type the classifier did not know, and 3 were commercial). One rule, `loanScope` in `src/loans.mjs`: **a document is in scope unless it is known to be residential.**

1. **Its loan type** reads as a residential program or label: the flag `loan.commercial` is `false`. A stored `null` is read again from the type, so a type the classifier learns later applies to documents already stored.
2. **A document with no loan type of its own takes its case's**: another document of the same foreclosure number in the same source that gives one (a Colorado pre-sale entry and its NED).
3. **With no loan type that decides**, either none at all (Caldwell, Douglas, a pre-sale entry with no NED stored) or one that reads `null` ("Unknown"), it is residential when every borrower and grantor it names is a natural person: not an entity by the entity test (`isEntityName`, `src/lenders.mjs`), and read as a person's name (`personName`). A name that is neither is not taken for a person.

Otherwise it is in scope: a commercial type, or an unknown or blank one with an entity among the borrowers or no borrower named. (After the first rebuild, the 12 remaining events still held 5 "Unknown" loans to individuals and 4 HELOCs; rule 3 now covers the first, and the classifier the second.)

**The classifier** (`commercialFromLoanType`, shared by the Jefferson adapter and the rule; case, punctuation and spaces ignored):

| Loan type | Flag |
|---|---|
| Commercial (and the misspellings Commerical, Comercial), BPL Commercial, Business, Construction, SBA, Multifamily | `true` |
| FNMA, Fannie Mae, FHLMC, Freddie Mac, FHA, VA, USDA, RHS, GNMA, Conventional, Conv, Conventional Residential, Residential, Reverse (Mortgage), HECM, HELOC, Home Equity (Line of Credit) | `false` |
| Unknown, blank, anything else | `null`: rule 3 decides |

**Where it applies.** The index (`buildLoanIndex`) applies it before the lender match: a document out of scope gives no bank row, no review name, no set-aside count and no event. It stays in `loans/docs/<source>.json`, so the weekly diff stays idempotent. Each bank row and event carries the `scope` it was written under (`{ commercial, borrowers }`, no name), and two guards check it again: the triage's county loop (`eventShown`) and the bank page (`inScope` in `web/lib/loans-view.mjs`), as do `outbound loans show` and `outbound loans events`. A row or event written before the rule carries no `scope` and shows nowhere until the rebuild writes it again.

**The counts.** The run result, the job result and the run's state carry `inScope` and `outOfScope` (this source's stored documents); the index's counts add `outOfScopeWhy` (`residential-loan-type`, `individual-borrowers`), `originated` and `eventsRemoved`. The verify check's `matched` counts only documents in scope.

**The current holder.** A document can name the loan's original lender (`lender`, or `beneficiary` on the deed of trust) apart from its current holder (`holder`: Jefferson's "Current Lender (Beneficiary)", a Texas notice's current mortgagee). Each bank row has a `relation`:

- `current`: the bank holds the loan by the document: as its current holder, a party to an assignment, or as lender or beneficiary when the document names no separate current holder. MERS alone as holder is a nominee, not a separate holder.
- `originated`: the bank is named only as the original lender and the document names another current holder, as `holder` or as an assignee (a CMBS trust's trustee, a fund, another bank). The CMBS link reads the current holder the same way (`currentHolders`, section 9). The row shows "Originated by this bank; now held by <holder>" (`relationLabel`, `heldBy`; a person is never named: "a person (name withheld)"), and **no event is written**: "a loan from this bank" would mislead.

**The rebuild** (`outbound loans rebuild`, `rebuildLoanIndex`): every bank's file, the review list and the events written again from the stored documents under the rule, reading no county and leaving the documents untouched. An event whose document is now out of scope, or whose bank only originated the loan, is removed; one that remains is written again from its document and keeps its `matchedAt`, `runId` and `basis`, so the triage does not list it twice. It refuses a folder with no stored document, or with no bank list (which would empty every bank's file). On a folder pulled from the platform:

```sh
npm run outbound -- platform pull --to ~/valley-outbound-pulled
OUTBOUND_DATA_DIR=~/valley-outbound-pulled npm run outbound -- loans rebuild
npm run outbound -- platform push --from ~/valley-outbound-pulled
```

## 4. The weekly watcher (component 9) and its event

`diffDocuments` and `buildLoanIndex` in `src/loans.mjs`.

- **The weekly diff:**
  - a new id is written;
  - a changed one is updated, keeping when it was first seen; the change log names the field, never its value;
  - an unchanged one is left exactly as it was;
  - a document no longer listed stays, as history.
- **Re-reading the same week** writes no document, no bank file and no event.
- **An event** is written for each document in scope newly matched to a bank that holds the loan by the document (section 3a: a match on the current holder, or on the sole lender when the document names no separate holder; never on a bank that only originated it). Its sentence is a fixed template:

  > A notice of trustee's sale was filed on November 10, 2026 for a loan from this bank on a property in Example County, CO.

  - The date is the filing date, or the recording date when there is none, or the notice's own date ("A notice of trustee's sale dated October 21, 2026 was posted for a loan from this bank ..."), or its sale date ("A notice of trustee's sale for a sale on December 1, 2026 was posted ...").
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
- `terms { robotsCheckedOn, termsCheckedOn, decision, by, nextRecheckOn }`. A real source runs only with `decision: 'allowed'`, both dates and who decided (county-data-build-vs-buy D-B8), a terms read under a year old, and only until `nextRecheckOn` when the decision sets one. A real county's terms come from its principal decision in `sources.json`. An `example` source runs only against its fake.
- `requests({ now, state })`: the pages to read.
- `parse(text, { url, fetchedAt, kind, state, since })`, which returns:
  - `documents`, in `buildDocument`'s shape;
  - `rows`;
  - `skipped`, each with a reason;
  - `missing`: a count per required field. One is a format change: the run fails and writes nothing;
  - optionally `follow`: further pages or files the page links, which the same run reads (at most three links deep, only on the source's hosts, after their robots.txt), and `known`, the linked files left alone because they were read before;
  - optionally `items`: for a linked-document source, one per listed document (`documentNumber`, `url`, `listedDate`, `listLink`).
- Optionally:
  - `parseFile(bytes, ctx)` for a followed file read as bytes (a PDF report holding many documents). It also returns `file { key }`, which the run keeps in the source's state on success. A file read before is asked for again with its ETag and Last-Modified, and a 304 is not read.
  - `readDocument(bytes, ctx)`, async, and `parserVersion`, for a list that links one document per file, as a Texas clerk's posted notices do. Each new file is fetched once and read into one record.
  - `backfill { since, requests }`: a one-time read of the source's archive (`outbound loans backfill --source ID [--since DATE]`), with the same gate.
  - `minIntervalMs`: a longer interval than the config's, where the county or its registry entry asks one.
- **A fake** with invented data (`test/county-notices-fake.mjs`; `test/caldwell-fake.mjs` for Caldwell; `test/gts-fake.mjs` for Jefferson and Douglas).
- **Its live check:** `outbound loans verify --source ID`, run once from an open network before the source is listed in `config.counties.watch`.
- **Its switch:** `config.counties.sources.<id>` `{ enabled, waitingOn }`. A source marked `enabled: false` is refused even with a recorded decision.

**The shared run** (`runNoticeSource`):

1. robots.txt first; a disallowed page stops the run.
2. The firm's User-Agent (`config.counties.userAgent`) on every request.
3. At least 20 seconds between requests (3 a minute), or the source's own spacing, or a longer Crawl-delay.
4. Nothing bypassed: no login, CAPTCHA or challenge page. A refusal (401, 403, 407, 429, 451) or a challenge page stops the run, writes nothing, and records the block in `loans/state.json`. The source then refuses to run until a principal decides and clears it: `outbound loans unblock --source ID --by NAME`.
5. **A linked-document source:** the list is read with its last ETag when the last run left nothing undone. Only documents not stored yet are fetched, at most `config.counties.maxDocumentsPerRun` a run; the rest wait for the next. On the first run, only documents the list dates within `config.counties.backfillDays` are read; the rest are history, never fetched. A document that cannot be read (no lender, no date, not a PDF) is held by id and reason, and fetched again only when the adapter's `parserVersion` rises. Every message about a document says "a listed document", never its path.
6. Every document built and checked before anything is written.
7. The run log line (`county:<id>`, counts only) and `loans/state.json`.

**The verify check:**

- **fresh**;
- **sourced:** source block, type, date, the link on the source's own host, id, hash, no extra field;
- **recall:** every listed document is stored, with the same content (a linked-document source: stored, held as unreadable, or history from before its first run);
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
| `LoanType` | `loan.type`, and `loan.commercial` by the shared classifier (section 3a): true for Commercial, BPL Commercial, Business, Construction, SBA or Multifamily; false for FNMA, FHLMC, FHA, VA, USDA, RHS, GNMA, Conventional, Conventional Residential, Residential, Reverse or HECM; null otherwise |
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

**Enabled**, on a principal's decision of 2026-11-18, recorded on each adapter's `terms` (`decision: 'allowed'`) and in `sources.json`, and both are `enabled: true` in `config.counties.sources`:

- Jefferson: its GTS reports may be read weekly by software; only the facts read out are stored, never the county's PDFs. Its "data compilations" copyright claim goes to counsel (D-B9).
- Douglas: the firm accepts its reports page's terms (lawful and ethical use only, a release of liability).

The backfill of Jefferson's NED archive (`report?t=14`, monthly from January 2025) sits behind the same gate.

## 6. Where it shows

- **The bank page:**
  - a **Loans we can see** card in the sidebar: the count, the newest three and the watched counties;
  - a **Loans we can see** tab: each document's type, county, date, stage, amounts with their basis, property type and a link to the source document; for a loan the bank only originated, "Originated by this bank; now held by ...".
  - Only rows in scope show (section 3a).
  - With none, the page says which counties are watched and that none has a document for this bank yet.
- **System status:** a **County records** row per watched county: the last run, documents read, new this week, matched to a bank, and names to review.
- **The command line:** `outbound loans run | backfill | verify | status | show | review | alias | match | rebuild | events | cmbs`.
- **CMBS links** (section 9): a filing whose current holder is a CMBS trust shows on the special servicer's page and as a Watch line in the triage.

## 7. Not built yet

- The other counties in the recon.
- The image reader (component 4).
- The assessor join that gives `useCode` and `propertyType` (component 3). The scope rule (section 3a) is the commercial filter until then: it reads the loan type and the borrowers, never the property.
- The loan chain to the current holder (component 6).
- The observed layer's figures (E14-S4).
- Removing a document a county later marks confidential.
- Counsel's view on holding borrower names (data-sources D13).
- For Caldwell: reading a notice the county replaces at the same link (each file's ETag is kept for it), and the notices its list gives without a sale date (history on the first run; a new one is fetched).

## 8. Caldwell County, Texas

`src/sources/counties/caldwell.mjs`; the recon is `docs/county-watchers-recon.md` (Caldwell). Source id `tx-caldwell-notices-of-sale`.

**The decision.** A principal decided on 2026-11-18 that Caldwell may be read weekly, recorded in `sources.json` (`principalDecision`), on three conditions:

- lender-level use only;
- no borrower, and no individual named in a notice, is ever contacted from this data;
- the county's disclaimer is rechecked monthly, because it is under review by the County District Attorney's office.

The decision is the gate: the adapter's terms come from it, and the source runs only while the entry is enabled, its verdict allowed, and today is on or before `nextRecheckOn` (2026-12-18 at first). After that date the weekly job refuses and fails until a principal rereads the disclaimer and records the check (`termsCheckedOn`, `terms.checkedOn`) and the next date.

**The list.** One GET a week of `https://caldwellcounty.texas.gov/foreclosures`, which holds every notice since 2020, 21 seconds after robots.txt. Each `li.doc-item` is one notice:

- The link to its PDF names the sale date and the debtor, so the record's number is a hash of the link's path (stable from week to week), and the bank's file and the events carry a link to the list's month (`#fc-m-YYYY-MM`) instead.
- The clerk's label (a debtor's name) is never read.
- The list's sale date (`time[datetime]`) chooses the first run's backfill and corroborates a notice's own reading. It is never the record's sale date: before 2025 a default date fills January.
- A JPEG (an image with no text layer) is skipped.

**The notices.** Each is a scanned PDF with an OCR text layer, read by `pdftotext` from poppler-utils, run as a child process (`src/sources/pdftext.mjs`; no npm dependency). The PDF goes in on stdin, and the text is never stored, logged or returned. Each new notice is fetched once, 21 seconds apart.

**Two readers.** The trustee firms use many templates, all built from the recon's two kinds. Both readers run on every notice:

- **Labelled blocks** (the attorney's form; also the two-column tables and the numbered forms' `Date:` and `Place:` lines). A label is matched to the one it most nearly is, so OCR's `I,F],NDER:` is `LENDER:`. A label split over lines is joined. A heading gives each label its meaning: `Date:` under the sale is the sale date, under the deed of trust its date, and before any heading the notice's own date. A value stops at a wide gap, and continues only at its own column, so the clerk's stamp (which names a deputy clerk) never joins a value.
- **The recital** (the servicer's form; also the numbered forms' paragraphs): "WHEREAS, on <date>, <grantor> ... executed", "in favor of ... as Trustee, <beneficiary>, as Beneficiary", "MERS ... as nominee for <lender>", "original principal amount of $X", "<holder> is the current mortgagee", "<servicer>, as Mortgage Servicer", "appointed <names> ... as Substitute Trustee", "NOTICE IS HEREBY GIVEN, that on <date>", "WITNESS, my hand this <date>".

Each field takes its candidates in order, labels first. The first that passes its check is read. Two that pass and disagree leave the field not read. The layout is the reader that gave the lender.

**OCR errors are not read, never guessed:**

- **Amounts** must read as dollars: `$N,NNN.NN`, or periods for the commas when no other reading is possible (`$250.000.00`). No space inside. From $1,000 to $1,000,000,000.
- **Numeric dates** are tried every way their ambiguous characters allow: `l`, `I`, `|` and `1` as a digit or a slash, `O` as zero, and `t`, `,`, `'`, `.` or `-` between digits as a slash. A date is read only when exactly one reading gives a real date the field allows, so `121112026` is December 1, 2026, and `lll2l2023` is not read. A month name is read when one month is clearly nearest.
- **The sale date** must be a Texas sale day: the first Tuesday, or the first Wednesday when that Tuesday is January 1 or July 4. It must fall 21 to 180 days after the notice date. When the two disagree, the sale date stands only if the list gives the same date.
- **When no reading gives the sale date,** the one Texas sale day the notice names near the fetch is read, if there is exactly one.
- **A name** must be letters, with no OCR debris and no address after it. Letter fragments are not a name.
- **A borrower that repeats a lender's name** is a misread.

A notice with no lender, or with neither date read, is held, not stored.

**The live check of 2026-11-18** (counts only; the files stayed outside the repository):

- **The requests:** robots.txt, the list and 28 notices, all answered 200, started at least 21 seconds apart. No challenge.
- **The list:** 610 items, 601 PDFs and 9 images. The 28 PDFs the list dates in the 60-day backfill were read; 573 are history.
- **The notices:** 17 stored, 11 held (6 with neither date readable, 5 with no lender readable). The layout was the attorney's form for 14 and the servicer's form for 14.
- **The main fields, of 28:**
  - lender: 23 read;
  - sale date: 19 read;
  - original principal: 12 read, of the 14 that state one;
  - street address: 3 read, of the 5 that state one (most give only a legal description).
- **The lender match:** of 38 lender-side names, 1 matched an FDIC-insured institution (on a held notice), 7 were set aside, and 30 are non-bank lenders.
- **The borrowers:** 2 are entities and 19 are individuals; 7 were not read.

**The fake** (`test/caldwell-fake.mjs`): an invented notice in each layout and a ruined one, served as real PDFs with an invisible text layer, so the tests read them with pdftotext. `test/caldwell.test.mjs` covers the gate, the list, both readers, the OCR checks, the run, blocks, the verify check, the worker job and the workflow. The pdftotext tests skip where poppler-utils is not installed.

**The worker** runs `loans.watch` each Monday, queued by the 13:41 UTC cron before scoring and the triage, once a principal sets the repository variable `COUNTIES_ENABLED` to `true`. That is safe only after the migration is applied. The workflow installs poppler-utils on every run.


## 9. The CMBS link

A county filing whose current holder is a CMBS trust (Jefferson's "Current Lender (Beneficiary)" reads "<trustee bank>, as Trustee for the registered holders of <shelf> <series> Mortgage Trust, Commercial Mortgage Pass-Through Certificates, Series <series>") is linked to the trust's own record of the loan in its monthly SEC filing (Form ABS-EE, exhibit 102), which `sources.edgar` stores. The principal then sees the loan's servicing status and the special servicer to call next to the county event. On such a document the index writes no event for the originating bank (section 3a, relation `originated`): the link is its event. `src/cmbslinks.mjs`.

**1. The name** (`cmbsTrustOf`). From each current-holder party (the `holder` or an `assignee`; the `beneficiary` only when no one else holds the loan now; MERS alone is not a holder) it reads the trust and its series (a year, a hyphen and a token: `2020-B21`, `2019-C7`, `2017-SMP`) and the shelf's own words. A residential or consumer securitization is never read as CMBS: "Mortgage Pass-Through Certificates" without "Commercial", Mortgage-Backed, Mortgage Loan Trust, Asset-Backed, Home Equity, Alternative Loan, Residential, Home Loan, ARM trusts and the like. The name only picks candidates. **The proof is `sources/edgar/trusts.json`**, which holds only trusts whose EX-102 is in the SEC's CMBS namespace: the trust must be there, with the same series and, when the name gives one, the same shelf. A name not there is recorded as not found only when it says "Commercial"; otherwise it is left alone (it could be residential).

**2. The asset** (`matchCmbsAsset`), from `sources/edgar/loans.json`, no network:

- required: the trust, the original amount to the dollar (the document's stated `originalPrincipal` against EX-102 `originalLoanAmount`), and a property in the document's state;
- and also: that property's city (from the document's address, read only to match and never stored) or county agrees, or the trust's `originatorName` is the document's original lender (`lender`, MERS as nominee read through), compared after the lender match's normalising (legal phrases, a leading "The" and the legal form cut). Nothing fuzzy.
- Two or more candidates, or a missing key: **no link**. The document is recorded as "trust named, loan not found" with the reason (`edgar-not-run`, `trust-not-in-edgar`, `trust-ambiguous`, `no-original-amount`, `no-asset`, `ambiguous`) for a principal to look up by hand. `loans.json` keeps only loans in our metros and sectors, and a pari passu note's trust share is not the whole loan, so a true loan can be not found; it is never guessed.

**3. The block.** A linked entry carries `cmbs`: the trust, CIK, asset number, the property's name and type, the original and current balance, the paid-through date, the payment status, whether it is in special servicing and since when (the transfer date), the workout strategy decoded from the CREFC codes (1 Modification, 2 Foreclosure, 3 Bankruptcy, 4 Extension, 5 Note sale, 6 Discounted payoff, 7 REO, 8 Resolved, 9 Pending return to master servicer, 10 Deed in lieu, 11 Full payoff, 12 Reps and warranties, 13 To be determined, 98 Other), the latest valuation and its date, occupancy, NOI and DSCR, the master servicer (`primaryServicerName`) and the special servicer (the trust's distribution report), and the SEC links (the ABS-EE filing, its EX-102, the 10-D). Every field is picked by name, so **no servicer commentary** (it can name borrowers and people) and **no borrower** is ever stored or shown.

**Where it lives:** `loans/cmbs.json`, one entry per document in scope whose current holder is a CMBS trust, keyed by document id: the document's type, county, date and public link, its stated original amount, the trust as named, the outcome with its reason, what agreed (`matchedOn`) and what differed (`disagreed`), the block, the scope it was written under, and a fixed sentence. No borrower, grantor or owner, no address, APN or legal description. Like every county event it is context only (`scored: false`): no score, weight or tier reads it, and no model-facing action loads it (`LOADS.cmbs`, `test/cmbslinks.test.mjs`).

**The scope rule** (section 3a) applies as everywhere: a document out of scope is never linked, and each entry carries its `scope`, which the triage and the servicer page check again.

**When it is rebuilt.** Whenever either side changes, from stored data only, in its own unit of work (`LOADS.cmbs`, flushed through `flush_uow` like the other jobs), and rewritten only when an entry changed:

- after the county runs of the worker's `loans.watch`;
- after `sources.edgar`, as the sale ledger is;
- on the command line after `loans run`, `backfill`, `match`, `alias` and `rebuild`, and `sources run edgar`.

Each job's result carries the link counts only.

**Where it shows:**

- **The weekly triage**, under **Watch** and never act now (`triage.json` strength `county-cmbs`): one line per newly linked document, under its special servicer (as the CMBS findings are), with no signal id. For example (invented): "A notice of election and demand was recorded on November 3, 2026 in Example County, CO on a $7.5M hotel loan held by a CMBS trust (Example 2019-X1 Mortgage Trust, loan 37); it has been with special servicer Sample Special Servicing LLC since March 4, 2026."
- **The special servicer's page** (`/servicers/<name>`): "County filings on its loans", each with the county filing, the trust's loan, its servicing figures and the SEC links.
- **The command line:** `outbound loans cmbs`, linked and not found.
