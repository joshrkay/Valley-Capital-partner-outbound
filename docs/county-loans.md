# County loans: the core of the pipeline

The parts of the county pipeline that do not depend on any county's format (`docs/county-data-build-vs-buy.md` 5.2, components 5 and 9). The goal is to show each bank's individual loans that public records name, on its bank page. The first real county is Caldwell County, Texas (section 8). An invented example stays for the tests and runs only against its fake.

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
  - The rest: `trustee`, `attorney`, `borrower`, `grantor`, `servicer`. A Texas notice names the mortgage servicer apart from the mortgagee; the servicer collects for the lender and is never matched.
  - A document must name at least one lender-side party.
- **Dates:** `recorded`, `filed`, `sale`, and `notice`, the date a notice itself states. A document needs one of the first three or a notice date; a notice of sale whose own date could not be read is known by its sale date.
- **Amounts.** Each amount has a basis:
  - `document`: stated on the document;
  - `index`: in the county's index;
  - `not-stated`;
  - `not-read`: on the image, not read yet.

  A stated amount has a value in dollars; the other two have none, and are never zero. An original principal is the size when the loan was made. It is never divided by a reported balance (`docs/paper-estimate.md` Q2).
- **Not read.** `unread` lists every field the reader could not read (an OCR misread, a value that failed its check), so "not read" is never confused with "not on the document". An amount not read also has the basis `not-read`.
- **The deed of trust** has its recording number (or book and page), its recording date, and `dated`, the date it was signed.
- **The sale place** (`salePlace`), when the notice gives it.
- **The source:** the document's own link, its ETag, and `listUrl` when the document's link would name a person (a Texas notice's file is named for the debtor). The bank's file and the events carry `listUrl` instead of the document's link.
- **Property type** is null until a county's assessor join gives a use code. It is never guessed.
- **The id** is `<source>:<document number>`, uppercased, with spaces removed. So a weekly re-read lands on the same id, and a new document is new. A list keyed by a case or foreclosure number that carries several documents gives each its own suffix (`FC-2026-0001/NED`).
- **The content hash** covers the document's content. It leaves out the fetch date and the run. Nothing outside `RECORD_KEYS` is stored: an adapter cannot add a field by accident.

## 2. Where it lives

| Path | What |
|---|---|
| `loans/docs/<source>.json` | Every document a source has given, by id. Only the watcher writes it. |
| `loans/banks/fdic-<CERT>.json` | The bank's matched documents, newest first, with the engine's labels. **No borrower, grantor, address or APN.** The bank page reads only this file. |
| `loans/review.json` | Names that matched no bank or several, with their candidates; and the names set aside, with their class. |
| `loans/events.json` | One dated event per document and bank, written the first time they match. |
| `loans/state.json` | Each source's last run and up to 12 runs: documents read, new, changed, unchanged (and, for a linked-document source, listed, fetched, held and deferred). A recorded block. Also the index's counts. |
| `loans/lists/<source>.json` | A linked-document source's list: each page's ETag, the documents recorded as history on its first run, and the documents held as unreadable, by id and reason. **No name and no link.** |

**The platform.** Every path fits the existing `documents` table (a test checks each path against the table's own path rule).

- The bank page loads `loans/banks/fdic-<CERT>.json` and `loans/state.json` with the principal's token, as it loads `paper/fdic-<CERT>.json`.
- **The worker job `loans.watch`** runs every county in `config.counties.watch`, each in its own unit of work (`LOADS.loans`). Its result holds counts only. A county its gate refuses, or whose run fails, fails the job, which turns the workflow red. The jobs table's kind list needs the migration `supabase/migrations/20261118120000_jobs_loans_watch.sql`.

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
- `minIntervalMs`, optional: the source's own spacing between requests when its registry entry asks for more than the config's.
- `requests({ now, state })`: the pages to read.
- `parse(text, { url, fetchedAt })`, which returns:
  - `documents`, in `buildDocument`'s shape;
  - `rows`;
  - `skipped`, each with a reason;
  - `missing`: a count per required field. One is a format change: the run fails and writes nothing.
- **A linked-document source** (a list that only links each document, as a Texas clerk's posted notices do) also provides `readDocument(bytes, { url, item, fetchedAt })`, async, and `parserVersion`. Its `parse` returns `items` (`documentNumber`, `url`, `listedDate`, `listLink`) instead of documents.
- **A fake** with invented data (`test/county-notices-fake.mjs`; `test/caldwell-fake.mjs` for Caldwell).
- **Its live check:** `outbound loans verify --source ID`, run once from an open network before the source is listed in `config.counties.watch`.

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

## 6. Where it shows

- **The bank page:**
  - a **Loans we can see** card in the sidebar: the count, the newest three and the watched counties;
  - a **Loans we can see** tab: each document's type, county, date, stage, amounts with their basis, property type and a link to the source document.
  - With none, the page says which counties are watched and that none has a document for this bank yet.
- **System status:** a **County records** row per watched county: the last run, documents read, new this week, matched to a bank, and names to review.
- **The command line:** `outbound loans run | verify | status | show | review | alias | match | events`.

## 7. Not built yet

- The image reader (component 4).
- The commercial filter and the assessor join that gives `useCode` and `propertyType` (component 3).
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

