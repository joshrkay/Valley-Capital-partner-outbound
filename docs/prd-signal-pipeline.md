# PRD: the distressed-debt signal pipeline

**Status: draft v1, November 13, 2026.** This turns the outside blueprint and technical spec the principals shared into work that can be built in this repository. It extends `docs/outbound-plan.md`: agents 4 and 5, a review screen, and the connection to a principal's mailbox. It keeps every rule in that plan. Where the blueprint and the plan disagree, the plan wins, and section 4 lists each case. Open decisions use the defaults in section 5 until a principal says otherwise. **[verify]** marks a claim not yet checked against a primary source. Every FDIC fact below was checked on November 13, 2026, against FDIC's own definition files and live API queries.

**Readers:** the principals, who decide, and whoever builds it, including Claude Code sessions.

## 0. The end goal

**Purposeful outreach to the right person, at the right time, backed by research into what paper the institution holds, what those loans look like, and where the firm has an advantage.** Everything in this PRD serves that one goal. Each part either moves outreach closer to it or protects it. A part that does neither is out of scope.

The goal is a chain. A weak link breaks it:

| Link | The question | What answers it | Epics |
|---|---|---|---|
| 1. **The paper** | What loans does this institution likely hold, how distressed are they, and in which categories and metros? | The **paper profile**: FDIC category balances and distress stages over 8 quarters, deposit footprint, and, for servicers, loan-level CMBS data | E3, E4, E6-S6 |
| 2. **The advantage** | Is that paper what we buy, where we buy it, from a seller we can deal with directly? | **Fit**: the buy box matched against the profile, plus the advantage signals in E6-S7 | E0, E6-S2, E6-S7 |
| 3. **The time** | Why now and not last quarter? | **Timing** signals: a new quarter, early delinquencies turning into noncurrent loans, first charge-offs, the quarter-end review windows | E3-S4, E10 |
| 4. **The institution** | Which institutions rank highest on paper, advantage and timing together? | The candidate list, with a principal deciding | E6 |
| 5. **The person** | Who decides whether that paper is sold? | The briefer, sourced, confirmed by a principal | E1, E7 |
| 6. **The message** | What does a short, accurate first touch say? | The drafter: approved claims only, matched to the paper's sector, checked in code | Existing agent 3, E6-S8 |
| 7. **The send** | How does it reach them without burning the name? | A principal's own mailbox, caps, stop on reply | E9 |
| 8. **Learning** | Which signals led to conversations and loan tapes? | Outcomes linked back to signals | Goal 5, E11, E15 |

**What public data can and cannot say about the paper.** It should be read honestly, so no one over-trusts it:

- **Bank Call Reports** give balances and distress stages by **category**: construction, multifamily, and nonfarm nonresidential, split into owner-occupied and other. They do not show individual loans, hotel or retail separately, loan sizes, or maturities. A bank's paper profile is an informed inference, not a loan tape.
- **Public banks' 10-K and 10-Q filings** sometimes break out hotels, retail and loan sizes. The briefer reads these (`bank.exposure`).
- **CMBS loan-level data** (E4) is the one free public source that shows individual loans: property type, location, balance, maturity and special-servicing status. It describes servicers' paper, not banks'.
- **County filings** (E5) show individual distressed assets and the lender behind each. They are context for a principal only.
- The actual loan tape comes from the conversation the outreach opens, after a confidentiality agreement. That conversation is the point of all of this.

**Where the research goes, and where it does not.** The paper profile, the fit and the signals go to the principal and the briefer. They choose who to approach, when, and which of the firm's sectors to lead with. **They never appear in the message.** A message says "we buy multifamily loans from banks in Phoenix". It never says "your multifamily non-accruals rose". Two reasons:

- Telling a bank what we see in its numbers reads as a pitch by a predator, which the voice guide forbids.
- Every bank figure is a risk fact that the drafter is already barred from using.

The research makes the message well aimed. It does not make it about the recipient's problems.

## 1. Problem

Valley Capital buys commercial real estate loans, and sometimes the properties behind them, from banks, special servicers and funds. The people who decide whether a loan is sold are few, they know each other, and they hear from buyers constantly. The agents in this repository can research an institution and draft a first message once a principal has chosen it. Choosing, though, is done from memory: nothing tells the firm which institutions in its six metros are under pressure right now. Without that layer, outreach either stays inside the principals' existing contacts or becomes a broadcast. A broadcast costs the firm its name with exactly the people it needs.

## 2. Goals

1. **Know who is under pressure, every quarter, from public data.** Every bank with a branch in the six metros has a current, sourced distress score within 7 days of FDIC publishing a new quarter.
2. **Give a principal a short list they can act on.** A principal can review the week's candidates in under 30 minutes and promote, dismiss or snooze each one in a single action.
3. **No invented facts.** Every figure in a score, a "why now" card, a brief or a draft traces to a stored source record. The target is zero exceptions, enforced in code.
4. **A person makes every touch.** No code path sends a message. Approving a draft puts it in the principal's own mailbox, and the principal sends it.
5. **Learn which signals lead to conversations.** Every touch and reply links back to the signal that started it, so the score can be tuned on outcomes after 60 days.

## 3. Non-goals

| Not doing | Why |
|---|---|
| Sending or auto-sending any message | Plan section 5: every outward touch starts with a person approving it, one at a time. One wrong message to a bank closes the account for years. |
| Contacting borrowers, guarantors or property owners | Plan section 2, group C. It conflicts with the site's promise to banks and carries different legal risk. |
| Pricing loans or predicting a particular loan's default | The system ranks institutions. Underwriting stays with the principals. |
| Building a CRM | Plan section 5. If the principals adopt one, the store syncs to it (P2). |
| Paying for data before it is tested | County feeds, contact vendors and CMBS analytics each wait for the vendor test (E7) and a budget decision. |
| Residential distress | One-to-four family lines and home foreclosures are ignored. |
| AI voice, ringless voicemail, texts, LinkedIn automation | Already banned in `config.json`. |

## 4. The blueprint and the spec, reconciled

### 4.1 Where the plan's existing rules win

| Blueprint says | This PRD does | Why |
|---|---|---|
| Send and track through Resend | Gmail drafts in the principal's own mailbox, on a separate warmed sending domain | Resend's acceptable use policy prohibits unsolicited mail, including cold outreach and scraped or purchased lists. A suspension could also take the newsletter down. |
| Track opens | No tracking pixels or tracked links | Bank email filters quarantine them. The blueprint itself also says to avoid them. |
| An "Approve & Send" button | "Approve" creates a Gmail draft; the principal clicks send in Gmail | Keeps the rule that nothing here sends, at the cost of one click. |
| Emails use quarter-end pressure, "as-is/where-is", "15-day close" | Quarter-end decides **when** a follow-up is offered for review, never what it says. The linter keeps blocking all three phrases. | No approved claim backs a 15-day close. Broker language reads as a broker. |
| Claude scores each loan and assigns tiers | Scores are computed in code from a readable formula. A model writes only the summary, and code checks every number in it. | A score in code can be explained, tested and argued with. |
| Python, Meltano, Next.js | Node 22 in this repository; a small review screen in Release 2 | One language for one small team. |
| 10 to 15 emails a day | The existing caps: 15 first contacts a week per sender, 20 emails a day | The principals' time to answer replies sets the real limit. |
| Filter banks by headquarters state | Filter by **where a bank has branches** in the six metros, plus headquarters state if a principal opts in | A headquarters filter misses every bank chartered elsewhere that lends in these metros, and includes rural banks that never lend in them. |
| Database isolation per entity | Kept, as P2: designed in, built when a second entity exists | Matches the plan's data rule. |

### 4.2 The FDIC section of the spec, checked against FDIC

| Spec says | Checked finding (November 13, 2026) |
|---|---|
| Both endpoints are `GET https://fdic.gov` | The base is `https://api.fdic.gov/banks`, with `/institutions`, `/financials`, `/locations`, `/sod`, `/history`, `/failures`, `/summary` and `/demographics` (from FDIC's `swagger.yaml`). |
| `filters=STALP:(TX,CO,CA,AZ,NV) AND ACTIVE:1` | **Returns zero banks, with no error.** The working form is `STALP:("TX" OR "CO" OR "CA" OR "AZ" OR "NV") AND ACTIVE:1`, which returns 549 active banks. |
| `NAASSET`: non-accrual loans specifically | FDIC's title is "NONACCRUAL-TOTAL ASSETS". Nonaccrual **loans** is `NALNLS`. |
| `NTLNLS`: net charge-offs (quarterly) | `NTLNLS` is **year-to-date**. The quarterly field is `NTLNLSQ`. A live check confirmed it: one bank showed 2, 3, 2, 2 year-to-date against 2, 1, −1, 0 quarterly through 2025. |
| `LNRENRES`: commercial real estate / hospitality | It is nonfarm nonresidential real estate. Hotels sit inside it and cannot be separated. It splits into owner-occupied (`LNRENROW`) and other (`LNRENROT`); the second is closer to investor CRE. |
| `REPDTE:[20240101 TO 20261231]` | The range syntax works. The latest published quarter as of November 13, 2026 is **June 30, 2026**. The September quarter is not out yet. |
| (not mentioned) | **The API silently drops a field name it does not recognize**, verified with a made-up field. A typo returns data without that field instead of an error, so every run must check that each field came back (E2-S2). |
| (missing) | Multifamily, its own Call Report line, and the category breakdowns: noncurrent, nonaccrual, 30–89 and 90+ days past due, foreclosed property (OREO) and quarterly charge-offs for construction, multifamily and nonfarm nonresidential. All verified field names are in Appendix A. |

### 4.3 Verified, and not yet verified

- **Verified live on November 13, 2026:**
  - The FDIC endpoints, filter syntax and field names in Appendix A.
  - The six metro codes, and 4,413 branches belonging to 268 distinct banks inside them.
  - The year-to-date and quarterly charge-off fields.
  - The silent dropping of unknown fields.
  - FRED is reachable but refuses requests without an API key (HTTP 400). SEC EDGAR is reachable.
- **Not yet verified:**
  - Which fields the SEC's loan-level CMBS data (Form ABS-EE) carries. The E4 spike settles it.
  - What each county offers, at what cost and on what terms. The E5 spike settles it. A first look: the Travis County Clerk posts foreclosure notices, but no searchable database turned up. Denver's Public Trustee moved to new software in May 2026, and a data export is unconfirmed. Vendors sell some county feeds.
  - The SEC's current requirements for automated clients **[verify]**.
  - Gmail permission scopes **[verify]**.
- **Desk research of November 13, 2026** covers the six counties, bank and regulator data beyond FDIC, court and event sources, and people sources. It is in `docs/data-sources.md`, with a confidence mark on every fact about an outside source, the signals we listen for, and a build order. It is the starting point for the E5-S1 spike and for the new source stories.

## 5. Assumptions (defaults until a principal decides)

| # | Decision | Default used here | Changes if wrong |
|---|---|---|---|
| A1 | Buy box | Hotels, multifamily and retail. Whether short-term rental portfolios are in is open. Size, status and lien are placeholders. | Scoring weights and filters (E0-S1) |
| A2 | Geography | Banks with at least one branch in the six metro areas, plus headquarters-state banks a principal opts in | The bank list (E3-S1) |
| A3 | Sellers first | Banks first (FDIC, Release 1), servicers next (CMBS, Release 2) | The order of releases |
| A4 | What "approve" does | Creates a Gmail draft; the principal sends | E9 |
| A5 | Volume | The existing caps in `config.json` | Guard configuration |
| A6 | Review surface | **Decided November 13, 2026:** a private web app for the firm's principals only, on Supabase (Postgres with row-level security) and Next.js on Vercel. The command line stays for operators. | E8, E11 |
| A7 | Paid data | None until tested and budgeted | E5, E7 |
| A8 | Firm claims | Only the approved claims in `claims.json` | The drafter |
| A9 | Entities | One firm; separation designed in, not built | E8-S1 |

## 6. How it fits together

```
 Public sources                  Code only                           People and the existing agents
 ──────────────                  ─────────                           ──────────────────────────────
 FDIC (quarterly)          ┐
 SEC CMBS data (monthly)   ├─► adapters ─► records with ─► scoring ─► candidate list ─► a principal ─► briefer ─► drafter
 FRED rates (daily)        │   (E2–E5)     their sources   (E6)       + "why now"       promotes        (agent 2)  (agent 3)
 County records (varies)   ┘                in OUTBOUND_DATA_DIR                        or dismisses                  │
                                            (Postgres in Release 2)                                                   ▼
                                                                                      guard ◄── send and reply ◄── approval
                                                                                    (agent 1)    detection          creates a Gmail draft;
                                                                                                 (E9)               the principal sends it
```

Rules that apply everywhere:

- **Prospect data never goes in this repository,** including candidate lists, scores tied to institutions, accounts, contacts, drafts and replies. It lives in `OUTBOUND_DATA_DIR`, and from Release 2 in a private Postgres database. Rule files (`buybox.json`, `metros.json`, `scoring.json`) are committed because they hold no prospect data.
- **Text from a source is data, never instructions.** It is fenced and escaped before any model sees it, as `src/model.mjs` does today.
- **Facts about a particular asset are for a principal only.** A named property, a filing or a CMBS loan is context and never reaches the drafter. This is the existing `kind: asset` rule, and it applies to every new source.
- **Bank credit figures are for a principal only.** FDIC metrics are risk facts. The existing `decideUse` rule already keeps risk facts out of drafts, and no message tells a bank its own noncurrent ratio.
- **Every number a person sees shows its source:** the field, the report date, the date it was fetched, and the run that fetched it.
- **Models:** code first. Haiku at low effort suggests name matches. Sonnet at high effort writes briefs and drafts, as today. The "why now" card uses no model; it is built from templates in code (E6-S3). Nothing here needs the top-tier model.

## 7. Data model

| Entity | Key | Holds | Source | Written by |
|---|---|---|---|---|
| `institution` | FDIC `CERT` for banks; an internal id for servicers, funds and counsel | Name, aliases, headquarters state, total assets, community-bank flag, active flag, website, and verified email `domains`, each with its source (for reply matching, E9-S3) | FDIC `/institutions`; domains from the website address and a principal's confirmation | E3, E6, E9 |
| `financial_quarter` | `CERT` + `REPDTE` | The Appendix A fields as reported (in thousands of dollars), plus fetch date and run | FDIC `/financials` | E3 |
| `footprint` | `CERT` + year | Branches per metro; deposits per metro and their share of the bank's total | FDIC `/locations`, `/sod` | E3 |
| `cmbs_loan` | Trust + loan id | Property type, location, balance, rate, maturity, payment status, special-servicing transfer, servicers (pending the spike) | SEC ABS-EE | E4 |
| `rate` | Series + date | SOFR, 5-year and 10-year Treasury yields | FRED | E4 |
| `filing` | County + document number | Document type, date, lender, trustee, lender's counsel, commercial flag. **Context only.** | County, or a vendor | E5 |
| `signal` | id | Institution key, type, value, period, evidence (record ids), an asset-specific flag | Derived | E3–E5 |
| `candidate` | Institution key + scoring run | Score, components, tier, "why now" card, status (new, promoted, dismissed or snoozed), reason, who, when | Derived | E6 |
| `account` | Account id (existing `accounts/<id>.json`) | Existing fields plus `institutionKey` and `originSignals`; the institution's confirmed email `domains`, each with its source; `contact.provenance` (where each person field came from) and `contact.verification` (E7-S3) | A principal's promotion; a principal's contact entries | E6, E7 |
| `source_run` | Run id | Source, parameters, row counts, field check, errors, duration, outcome | | E2 |
| Existing | | `touches.jsonl`, `audit.jsonl`, `suppression.json` (with hashed entries for a forgotten person, E7-S3), briefs, facts, drafts | | Agents 1–3 |
| `contacts/` | Data folder | `known.json` (people we know, for vendor tests), `vendor-tests/<vendor>-<date>.json` and `.md` (refs and counts only), `vendors.json` (recorded passes) | A principal; the harness | E7-S2 |

## 8. Epics, user stories and acceptance criteria

**Priority:** P0 must ship in its release. P1 is a fast follow. P2 is designed for but not built.
**Release:** R1 "Know the banks", R2 "Review and send from my mailbox", R3 "More signals, more people" (section 12).

| Epic | Release | Priority | Depends on |
|---|---|---|---|
| E0 Configuration the system reads | R1 | P0 | Principals |
| E1 Pilot the agents already built | R1 | P0 | API key, truth sheets |
| E2 Ingestion framework | R1 | P0 | none |
| E3 FDIC bank distress signals | R1 | P0 | E0, E2 |
| E4 CMBS loan signals and rate context | R2 | P0 (spike), P1 (build) | E2, E6 |
| E5 County public-record signals | R2 spike, R3 build | P1 | E2, E6 |
| E6 Matching, scoring and the candidate list | R1 | P0 | E0, E3 |
| E7 Contact finding | R3 | P1 | E1 |
| E8 Private database and review screen | R2 | P0 | E6 |
| E9 Mailbox: Gmail drafts, sends and replies | R2 | P0 | E8, sending domain |
| E10 Quarterly follow-up and nurture | R3 | P1 | E9 |
| E11 Scheduling, monitoring and cost | R2 | P0 | E8 |
| E12 Platform foundation | R2 | P0 | E1–E6 (built) |
| E13 Event listeners | R2 | P1 | E2, E3, E12 |
| E14 The paper estimate | R2 | P0 | E3, E4, E6 |
| E15 Call prep and outcomes | R2 | P0 (S1, S2), P1 (S3, S4) | E1, E7, E12; E14 if present |
| E16 Who sells to whom | R2 | P1 | E3, E4, E12, E13 |
| E17 to E21 | Now to R3 | P0 to P2 | See `docs/prd-next-five.md` |

---

### E0. Configuration the system reads

**E0-S1. Buy box file.** *As a principal, I want to write our buy box once, in one file, so that every score and filter uses the same definition.* P0, R1.
- [ ] `buybox.json` holds sectors, loan size range, loan statuses (performing, sub-performing, non-performing, foreclosed), lien position, metros (by code) and exclusions.
- [ ] If any field still holds a `[CONFIRM]` placeholder, `outbound score run` refuses and lists the unfilled fields. This is the same rule `senders.json` uses.
- [ ] A test checks the file against its schema, and checks that every metro code also appears in `metros.json`.
- [ ] Each scoring run records the content hash of the buy box it used, so an old score can be traced to the definition behind it.
- [ ] If the principals treat the buy box as confidential, it moves to `OUTBOUND_DATA_DIR`. The loader reads either location (open question Q12).

**E0-S2. Metro definitions.** *As a principal, I want the six metros defined by official codes so that "in our market" means the same thing in every query.* P0, R1.
- [ ] `metros.json` lists the six core-based statistical area (CBSA) codes verified on November 13, 2026, under the names FDIC uses. Names can drift; the code is what matches.

  | Code | Name in FDIC data |
  |---|---|
  | 12420 | Austin-Round Rock-Georgetown, TX |
  | 19740 | Denver-Aurora-Lakewood, CO |
  | 31080 | Los Angeles-Long Beach-Anaheim, CA |
  | 38060 | Phoenix-Mesa-Chandler, AZ |
  | 29820 | Las Vegas-Henderson-Paradise, NV |
  | 41740 | San Diego-Chula Vista-Carlsbad, CA |

- [ ] Each metro lists its county FIPS codes, for county records and the CMBS location filter. They come from the Census Bureau's July 2023 delineation file, checked November 13, 2026. A first version taken from FDIC branch records missed Gilpin County, CO, which has no bank branch. Each metro also keeps FDIC's older name (`fdicName`).
- [ ] Given a source returns a different name for a known code, then the run logs a warning and still matches on the code.

**E0-S3. Readiness in `status`.** *As a principal, I want `outbound status` to show every prerequisite for Release 2 sending so that nothing reaches a mailbox before the setup is right.* P1, R2.
- [ ] `status` shows: senders complete, sending domain set, SPF, DKIM and DMARC records found (DNS lookup), warm-up marked complete by a named person, Gmail connected, kill switch state.
- [ ] Any missing item means `readyToSend: false`, with the reason.

---

### E1. Pilot the agents already built

The briefer and drafter have never run against the live API (README, "Status"). New candidates should not flow into them until they have been checked against accounts the principals know.

**E1-S1. Truth sheets.** *As a principal, I want to write a short "what is true" sheet for 10–15 accounts I know well so that the briefer can be scored against reality.* P0, R1.
- [ ] `outbound pilot template --account ID` writes a sheet to `OUTBOUND_DATA_DIR/pilot/`. Its sections match the playbook questions (identity, exposure, intent, people, access, risk).
- [ ] Sheets are never committed. The existing data-rule test covers a `pilot/` path.

**E1-S2. Finding review.** *As a principal, I want to mark each finding in a pilot brief as true, false or unknown so that precision and fabrication are measured, not guessed.* P0, R1.
- [ ] `outbound pilot review --account ID` walks each finding with its quote and source, records a verdict and the reviewer's name, and can resume where it stopped.
- [ ] Given a finding cleared for drafts is marked false, then it counts as a **fabrication**.

**E1-S3. Scorecard and gate.** *As a principal, I want a scorecard across the pilot accounts so that I can decide whether to trust the briefer on accounts I don't know.* P0, R1.
- [ ] Per account and in total, it shows: findings true, false and unknown; truth-sheet facts the brief missed (recall); findings the code dropped; tokens, searches, fetches and cost.
- [ ] **The gate:** a principal can record `pilotPassed`, with name and date, only when at least 10 accounts are reviewed and fabrications are zero. Until then, `research run` refuses any account created from a candidate (E6-S4). Hand-picked accounts can still run.
- [ ] The measured costs replace the placeholder caps in `models.json` (note in the PR).

**E1-S4. Draft edits.** *As a principal, I want to see how much I changed each pilot draft so that we know whether the drafter is close.* P1, R1.
- [ ] At approval, the difference between the generated and the approved text is recorded as a ratio. No message text is added to the touch log.
- [ ] The scorecard reports the median edit ratio and the drafts rejected outright.

---

### E2. Ingestion framework

Every adapter (E3–E5) is built on this shared framework.

**E2-S1. Run log.** *As an operator, I want every source run recorded so that I can tell a quiet quarter from a broken feed.* P0, R1.
- [ ] Each run appends one line to `runs.jsonl` with source, parameters, rows read, rows written, rows changed, duration and outcome (`ok`, `suspect` or `failed`).
- [ ] Given a run returns zero rows where the previous run of the same query returned rows, then the outcome is `suspect`, not `ok`.
- [ ] Run logs contain counts and ids only. A test fails if a log line contains an email address or a phone number.

**E2-S2. Field check.** *As an operator, I want a run to fail loudly when a requested field doesn't come back so that a renamed or misspelled field can't silently erase a signal.* P0, R1.
- [ ] FDIC drops unknown field names silently, and returns a missing value as an explicit `null` with the key still present. Both were verified live on November 13, 2026. So: **every returned row must contain every requested field as a key.** Given a key is absent from any row, then the run fails, names the field and how many rows lacked it, and writes nothing.
- [ ] A key that is present with a `null` value is allowed and counted per field.
- [ ] One verified exception, listed in code (`OPTIONAL_KEYS`): `/institutions` **omits** `WEBADDR` for a bank with no website instead of sending null. On November 13, 2026 it did so for 1 of 268 banks. An absent optional key is stored as null and noted in the run log. If it is absent from every row, the run still fails. No other field is optional.
- [ ] Tests: a fake response with one row missing one key fails the run; nulls pass and are counted.

**E2-S3. Sources on every record.** *As a principal, I want every stored value to say where it came from so that I can check any number I'm shown.* P0, R1.
- [ ] Every record carries: source, endpoint and query, the source's own record id, the period it covers, when it was fetched, and the run id.
- [ ] The writer rejects a record missing any of these. A test covers it.

**E2-S4. Re-runs update, not duplicate.** *As an operator, I want a re-run to update existing records so that amended filings replace old values without double counting.* P0, R1.
- [ ] Each source has a natural key, for example `CERT` + `REPDTE`. Re-running the same query gives the same row count.
- [ ] A changed value is updated, and the change is logged with the old value, new value and run id.

**E2-S5. A polite client.** *As an operator, I want every adapter to respect each source's limits so that the firm is never blocked by a public data provider.* P0, R1.
- [ ] Timeouts on every call. Retries with backoff only on 429 and 5xx, capped. No retry on other 4xx.
- [ ] Pagination by offset until the reported total is reached. A count mismatch makes the run `suspect`.
- [ ] Where a source asks automated clients to identify themselves (the SEC asks for a User-Agent with a contact and a request-rate ceiling **[verify current policy]**), the contact comes from configuration filled in by a principal. It is never hard-coded and never a personal address.
- [ ] Concurrency and request rate are set per source in configuration.

**E2-S6. Checking the scrapers against their sources.** *As a principal, I want proof that what we stored is what the sources say, and that nothing was missed, so that a quiet data error never reaches a decision.* P0, R1. **Built** (`src/sources/verify.mjs`, `outbound sources verify`, `outbound platform verify`).
- [x] FDIC:
  - the latest quarter is stored;
  - the list of banks equals FDIC's list of banks with a branch in the metros;
  - every stored value for the latest quarter equals FDIC's;
  - ratios computed from stored values equal FDIC's own (`NCRECONR`, `NCLNLSR`) within 0.01 points.
- [x] EDGAR:
  - every filer has a recorded outcome, and a CMBS-looking name set aside as non-CMBS is flagged;
  - for a few trusts, re-read from SEC, parsed loan counts and balances equal a plain count of the file;
  - every stored loan belongs to a trust in the latest run and carries its source.
- [x] Read-only; exits 1 on any failure. A spot-check list of records with their public URL lets a person compare by eye, and is left out of scheduled-job logs.
- [x] The worker workflow runs the checks weekly for FDIC and monthly for CMBS.
- [x] **First live runs (2026-11-13):** FDIC passed every check (8,576 values; 500 ratios). The EDGAR checks found five defects in the adapter, all fixed with tests:
  - the namespace attribute order;
  - depositor co-filings;
  - amendments without an EX-102;
  - per-property records counted as loans (2,594 in 60 trusts);
  - servicer names cut short.

---

### E3. FDIC bank distress signals

**E3-S1. The bank list for our metros.** *As a principal, I want the list of banks that actually operate in our six metros so that we look at the lenders there, not just banks headquartered in five states.* P0, R1.
- [ ] The list = active institutions with at least one branch in a metro, from `/locations` with `filters=CBSA_NO:(12420 OR 19740 OR 31080 OR 38060 OR 29820 OR 41740)`. A principal can add headquarters-state banks from `/institutions` with `STALP:("TX" OR "CO" OR "CA" OR "AZ" OR "NV") AND ACTIVE:1`.
- [ ] A sanity check, not a test fixture: on November 13, 2026 the branch query returned 4,413 branches of 268 distinct banks, and the headquarters query returned 549 banks.
- [ ] Each bank's headquarters state comes from its `/institutions` record, never from a branch row. Verified live: a branch row's `STALP` is the **branch's** state despite FDIC's definition. For example, a national bank headquartered in SD shows CO on its Denver branches.
- [ ] For each bank, record branches per metro and, from the latest Summary of Deposits (taken each June 30), deposits per metro and the share of the bank's deposits in the six metros.
- [ ] Given a bank has closed, merged or failed since the last run (`ACTIVE`, `/history`, `/failures`), then it is flagged rather than silently dropped, and a failure sets its risk screen to "do not approach".
- [ ] Only `/failures` records with `RESTYPE: "FAILURE"` mark a bank as failed. The endpoint also returns open-bank **assistance** (`RESTYPE: "ASSISTANCE"`: 593 records, including two of today's largest banks in 2008–2009), which is kept as `assistanceOn`, for context only. A first live run that counted assistance as failure wrongly flagged three open banks.

**E3-S2. Quarterly financials.** *As a principal, I want at least eight quarters of commercial real estate credit data for every bank on the list so that a trend, not one quarter, drives the score.* P0, R1.
- [ ] For each bank, pull the Appendix A fields for the last 8 published quarters. Every run re-pulls all 8, because Call Reports get amended.
- [ ] Charge-offs use the quarterly fields (`NTLNLSQ`, `NTRENRSQ`, `NTREMULQ`, `NTRECONQ`). Year-to-date fields are never compared quarter to quarter.
- [ ] Values are stored as reported, in thousands of dollars. Ratios are computed in code (E3-S3), never by a model.
- [ ] A weekly check reads the latest `REPDTE`. Given it has moved past the latest stored quarter, then the new quarter is ingested and scoring re-runs, finishing within 7 days of publication. (As of November 13, 2026 the latest quarter is June 30, 2026.)

**E3-S3. Distress metrics.** *As a principal, I want each bank's commercial real estate credit shown as a few plain metrics so that I can see why it ranks where it does.* P0, R1.
- [ ] Computed in code, with each formula written in Appendix A. "CRE" below means construction, multifamily and nonfarm nonresidential together.
  - CRE noncurrent ratio = (`NCRENRES` + `NCREMULT` + `NCRECONS`) / (`LNRENRES` + `LNREMULT` + `LNRECONS`), with the change from last quarter and from four quarters ago.
  - CRE nonaccrual ratio = (`NARENRES` + `NAREMULT` + `NARECONS`) / the same base.
  - Early-stage delinquency = (`P3RENRES` + `P3REMULT`) / (`LNRENRES` + `LNREMULT`). Loans 30–89 days past due are what tends to show up as noncurrent next.
  - Commercial foreclosed property (OREO) = `ORENRES` + `OREMULT` + `ORECONS`, and its change.
  - CRE net charge-offs this quarter = `NTRENRSQ` + `NTREMULQ` + `NTRECONQ`.
  - Investor CRE share = `LNRENROT` / `LNRENRES`.
- [ ] Multifamily is also shown on its own, since the Call Report gives it its own line. The screen says plainly that hotel and retail loans are inside nonfarm nonresidential and cannot be separated.
- [ ] A zero denominator gives an empty metric with the reason, never 0.
- [ ] A test checks each formula against hand-computed invented values.

**E3-S4. Signals from the metrics.** *As a principal, I want changes recorded as named signals so that the candidate list says what changed, not just a number.* P0, R1.
- [ ] Signal rules live in `scoring.json`, with every threshold marked as a placeholder. Examples: CRE noncurrent ratio up two quarters running; the first CRE charge-off in eight quarters; commercial OREO up from last quarter; early-stage delinquency rising.
- [ ] Each signal points to the `financial_quarter` records behind it.
- [ ] FDIC signals are institution-level risk facts. A test confirms the drafter's input never includes one.

**E3-S5. Failed banks, from every FDIC source.** *As a principal, I want every bank failure in our metros caught on time, with the FDIC named as the seller, so that a late FDIC index never hides a failed bank's loan sale.* P0, R1. **Built** (`src/sources/fdic.mjs`, `src/score.mjs`, `outbound sources run fdic`, `outbound candidates list`). First live run (2026-11-13): 10 failures since November 2023. FDIC's `/failures` lacked 2 of them, among them the September 25, 2026 failure in the Los Angeles metro. The adapter found it and placed it there.
- [x] `/failures` alone is not trusted. Its index was built on August 25, 2026, and lacks the failures of August 21 and September 25, 2026. `/institutions` and `/history` are rebuilt daily and show both. Verified live.
- [x] A bank counts as failed if any source says so. This extends E3-S1, which read `/failures` only. The sources:
  - `/failures`: `RESTYPE` `FAILURE`, with `FAILDATE`.
  - `/institutions`: `ACTIVE` 0, `INACTIVE` 1, `ENDEFYMD` (the day the bank became inactive; `12/31/9999` while open), and `CHANGEC1`, FDIC's code for the event that closed the charter. The failure codes are 211, 215, 216, 217, 230 and 235, with FDIC's own descriptions from `/history` (211 is "Failure - Whole Institution"). Checked against `/failures` on 111 closed banks. Code 213, an assisted merger, is mostly assistance there, so it is not a failure.
  - `/history`: the same codes, on the failed bank's row.
  - FDIC's failed-bank CSV, when a person saves it as `sources/fdic/failed-banks.csv` in the data folder. Its columns were **checked** against the live file on 2026-11-13: Bank Name, City, State, Cert, Acquiring Institution, Closing Date and Fund, with 578 banks since October 2000. FDIC sends each header with a trailing non-breaking space, in Latin-1 bytes labelled UTF-8, and the parser handles both. The file is not fetched yet; fetching it with the weekly run is a follow-up now that www.fdic.gov is reachable. A header that differs fails the run, names the headers found, and writes nothing.
- [x] Failures are looked for nationwide over 36 months. A failed bank has left `/locations`, so it is never on the bank list.
- [x] Each record (`sources/fdic/failed.json`) keeps each source's date and code, the sources that agree (`agree`), and those that do not yet (`missingFrom`).
- [x] A failed bank is placed in the metros by three things, and each metro says which placed it:
  - its branches in our last footprint;
  - the branches FDIC lists in the failure (`/history` code 713: `OFF_PSTNUM` and `OFF_CNTYNUM`, the branch's state and county);
  - its main office's county (`STCNTY`). `CBSA_NO` is not used: it was absent on 97 of 447 charters closed since November 2023.
- [x] The FDIC is the seller. `candidates list` shows failed banks in the metros beside the candidates, never as candidates, with the FDIC loan-sale page as a link. The page is not scraped. A failed bank stays listed for `failedBanks.windowQuarters` (placeholder: 8).
- [x] Change log: a new failure, and a known bank's status change. The run notes name the certs `/failures` lacks, and when its index was built.
- [x] `sources verify fdic`: `fdic.failures` checks that every failure any source shows is in our record. `fdic.failures-index` warns when `/failures` lacks a failure the others show. A warning does not fail the run, because the adapter already reads all three. First live check: 2 failures missing from `/failures`.
- [ ] Check the CSV's column names against the live file, once www.fdic.gov is reachable.

**E3-S6. Mergers and acquisitions.** *As a principal, I want to know when a bank on our list buys a bank with a presence in our metros so that we can approach the acquirer while it decides which loans to keep.* P0, R1. **Built** (`src/sources/fdic.mjs`, `src/metrics.mjs`, `src/score.mjs`). First live run (2026-11-13): 382 deals nationwide since November 2023, 60 of them with a bank on our list on one side, and 12 acquisition signals.
- [x] `/history`, filtered by event code and effective date (`EFFDATE`), over 36 months. Codes: mergers 221–223, an assisted merger 213, an affiliate reorganization 224, and the failure codes. Each deal has one row on the leaving bank's side. The acquirer's row (810) is not read.
- [x] The field check is per event, because `/history` leaves out the keys an event lacks (verified live): a failure row has no `CERT`, and a payoff has no `OUT_CERT` or `ACQ_CERT`. Every row needs `TRANSNUM`, `CHANGECODE`, `EFFDATE` and the bank that left (`OUT_CERT`, or `CERT`). A merger row also needs `ACQ_CERT`.
- [x] Deals with a bank on our list on either side are kept in `sources/fdic/events.json`, keyed by `TRANSNUM`. Each has the target's cert, the date the deal took effect, the target's metros (placed as in E3-S5), and its CRE at its last report. Events are never dropped when they age out.
- [x] **Event signal** `acquired-metro-bank`, declared `kind: event`. It attaches to the acquirer, with the effective date and the target's cert, when the target had a presence in the six metros. It stays visible for `windowQuarters` (placeholder: 4) from that date. Its id is the deal's, so it is the same signal on every run. It counts a merger, an assisted merger, and taking over a failed bank. A merger inside one holding company (224) does not count by default.
- [x] Being acquired means the target is gone. Its record gets `acquiredBy` and `closedOn`. The change log records the acquirer and the status change.
- [x] The card states it from a fixed template, for example: "It acquired another bank (FDIC cert N) with 4 branches in Phoenix, effective June 1, 2026."
- [x] `sources verify fdic`: `fdic.events` checks that every deal FDIC shows with a bank on our list is stored with the same acquirer, target and date.

**E3-S7. The concentration screen.** *As a principal, I want to see which banks meet the regulators' CRE concentration screen so that I know whose examiners are likely pressing them to cut CRE.* P0, R1. **Built** (`src/metrics.mjs`, `src/score.mjs`, `src/candidates.mjs`), from BankFind fields in the existing `sources.fdic` job. First live run (2026-11-13): 27 banks meet test (a), 15 meet test (b), 39 meet either.
- [x] **The definition is checked** against the guidance text on 2026-11-13: 71 FR 74580 (December 12, 2006), read from FDIC's copy (FIL-104-2006). The guidance calls these criteria a screen for closer supervisory review, not limits on lending. Either test is enough:
  - (a) construction and land development loans at or above 100% of total risk-based capital; or
  - (b) CRE at or above 300% of total risk-based capital, **and** CRE grown 50% or more over the prior 36 months.

  CRE = construction and land development + multifamily + nonfarm nonresidential not owner-occupied + loans to finance CRE not secured by real estate. A principal confirms this against the guidance text. The code comment and the `scoring.json` note say the same.
- [x] The fields. Meanings are from FDIC's own definitions file (`All Financial Reports.xlsx`, at api.fdic.gov/banks/docs). Each was checked live on the 268 metro banks, for June 30, 2026 and June 30, 2023:

  | Need | Field | Checked live |
  |---|---|---|
  | Construction and land development | `LNRECONS` | FDIC's own construction-to-tier-1 ratio, `LNCDT1R`, equals `LNRECONS` / `RBCT1J` on 267 of 267 banks |
  | Multifamily | `LNREMULT` | |
  | Nonfarm nonresidential, not owner-occupied | `LNRENROT` | `LNRENROT` + `LNRENROW` = `LNRENRES` on 267 of 268 banks |
  | CRE loans not secured by real estate | `LNCOMRE` | Above 0 at 132 banks |
  | Total risk-based capital | `RBC` | FDIC gives only a title ("RBC-TOTAL-PCA"). It equals `RBCT1J` + `RBCT2` on 195 of 196 non-CBLR banks. `RBC` over risk-weighted assets equals FDIC's own total capital ratio on all 195. |
  | Tier 1 capital | `RBCT1J` | Equals `RBCT1` on all 268 |
  | Allowance for credit losses on loans | `LNATRES` | Equals `LNLSRES` on all 268 |
  | CBLR election | `CBLRIND` | 1 at 72 banks |

- [x] CBLR banks report no total risk-based capital. FDIC sends `RBC` as **0** for them, not null (all 72), so a naive ratio would divide by zero. For them the denominator is tier 1 capital plus the allowance (`RBCT1J` + `LNATRES`), UBPR's approach. Every computed value and every signal names its denominator. A non-CBLR bank with `RBC` of 0 gets no ratio, with the reason.
- [x] The 36-month test needs CRE 12 quarters before the latest. The adapter fetches that one quarter (`growthBase`, four fields) and does not widen the 8-quarter pull. It is kept apart from `quarters`.
- [x] The paper profile shows the ratios (`profile.concentration`): construction to capital, CRE to capital, and 36-month CRE growth. Each comes with its fields, report dates and denominator, and with whether each test is met.
- [x] **State signals** `concentration-construction` and `concentration-cre`, declared `kind: state`. They are recomputed from the latest quarter on every run, and they drop away when the ratio falls below. Thresholds are in `scoring.json`, marked as placeholders.
- [x] The card states them from fixed templates, with the denominator's words taken from code, then says the definition is unconfirmed. No model is used.
- [x] `sources verify fdic`: `fdic.ratios` now includes `LNCDT1R`. `fdic.concentration` checks that each CBLR flag matches how `RBC` is reported, and that the stored growth-base quarter equals FDIC's.
- [x] The firm's rule holds: a test runs the fake pull, scoring and promotion, then checks that the briefer gets the ratios and the acquisition as data, and that the drafter's input has no ratio, denominator, signal, deal or cert.
- [ ] TODO: cross-check against UBPR Page 7B (lines 29–30), once cdr.ffiec.gov is reachable.
- [ ] A principal decides whether the screen and acquisitions add points to the score, and on which axis. Today they are signals only.

---

### E4. CMBS loan signals and rate context

**E4-S1. Field coverage spike.** *As a principal, I want to know exactly what the SEC's loan-level CMBS data says about each loan before we build on it.* P0, R2. **Done November 13, 2026. Decision: build.**
- [x] Read the EX-102 asset files of 6 trusts' October 2026 ABS-EE filings (vintages 2019–2024; 315 loans, 735 properties). The code meanings come from the SEC's ABS XML Technical Specification v3.1 (`eis_ABS_CMBSAssetData.xsd`).
- [x] **Finding filings.** EDGAR's quarterly form index (`full-index/YYYY/QTRn/form.idx`) lists every ABS-EE filing; Q4 2026 had 964 by November 13. A filing's EX-102 is CMBS when its XML namespace is `http://www.sec.gov/edgar/document/absee/cmbs/assetdata`, which is more reliable than the trust's name. Filings arrive monthly, one per trust. EX-102 files run 0.27–0.82 MB, so about 300 trusts is roughly 150–250 MB a month. Only loans in the metros are kept.
- [x] **The field map.** Each `<assets>` element is one loan. Each `<property>` inside it is one property, and a loan can have many (the sample had a 180-property portfolio).

  | Need | Field | Notes |
  |---|---|---|
  | Location | `property/propertyState`, `propertyCounty`, `propertyCity`, `propertyZip` | County was on 544 of 735 properties. ZIPs lose their leading zeros (`02141` arrives as `2141`). Match on state plus county name; a ZIP crosswalk can fill in a missing county (P1). |
  | Property type | `property/propertyTypeCode` | LO Lodging, MF Multifamily, RT Retail, MU Mixed use, OF Office, IN Industrial, SS Self storage, WH Warehouse, HC Health care, MH Mobile home park, CH Cooperative housing, SE Securities (defeased), ZZ Missing, 98 Other |
  | Balance | `reportPeriodEndActualBalanceAmount` | Dollars. `originalLoanAmount` too. |
  | Rate | `reportPeriodInterestRatePercentage`, `originalInterestRatePercentage` | Fractions (0.02792 is 2.792%) |
  | Maturity | `maturityDate` | MM-DD-YYYY. Also `postModificationMaturityDate` and `hyperAmortizingDate`. |
  | Payment status | `paymentStatusLoanCode` | 0 Current, A in grace or not yet due, B under 30 days late, 1 30–59 days, 2 60–89 days, 3 90+ days, 4 performing matured balloon, 5 non-performing matured balloon |
  | Special servicing | `mostRecentSpecialServicerTransferDate`, `mostRecentMasterServicerReturnDate` | On 21 of 315 loans |
  | **Workout strategy** | `workoutStrategyCode` | 1 Modification, 2 Foreclosure, 3 Bankruptcy, 4 Extension, **5 Note sale**, 6 DPO, 7 REO, 8 Resolved, 9 Pending return to master servicer, 10 Deed in lieu, 11 Full payoff, 12 Reps and warranties, 13 TBD, 98 Other. **Code 5 means the special servicer plans to sell the note, the most direct signal there is.** |
  | Property status | `property/propertyStatusCode` | 1 In foreclosure, 2 REO, 3 Defeased, 4 Partial release, 5 Substituted, 6 Same as at securitization |
  | Performance | `property/mostRecentDebtServiceCoverageNetCashFlowpercentage`, `mostRecentPhysicalOccupancyPercentage`, `mostRecentNetOperatingIncomeAmount`, `mostRecentValuationAmount` | Most loans have them |
  | Modification | `modificationCode`, `lastModificationDate` | 1 Maturity extension, 2 Amortization change, 3 Principal write-off, 5 Temporary rate cut, 6–7 Capitalization, 8 Combination, 10 Forbearance, 98 Other |
  | Primary servicer | `primaryServicerName` | In EX-102 |
  | **Special servicer** | **not in EX-102** | It is on the cover of the trust's monthly distribution report (10-D, exhibit 99.1), next to a named contact. Its format varies by certificate administrator. |

- [x] **Sample result.** 33 of 315 loans (10%) have a property in a buy-box metro: Los Angeles 17, Las Vegas 5, Phoenix 4, San Diego 4, Austin 2, Denver 1. Their types were mixed use 9, self storage 6, multifamily 5, retail 5, office 4, lodging 2 and others. One was distressed: an office loan in foreclosure, 90+ days late. Across all six trusts the workout codes were: resolved 7, REO 4, foreclosure 3, TBD 3, other 3, full payoff 1.
- [x] **Rules carried into the build:**
  - Property names, addresses and tenant names are asset-level, so they are context for a principal only and never reach the drafter.
  - Only the special servicer's **firm** name is extracted from the distribution report. A named person there falls under the contact rules (E7): sourced, verified, business addresses only.
  - The report's free-text servicer commentary is not ingested in Release 2.
**E4-S2. Loans in our metros.** *As a principal, I want CMBS loans on properties in our metros and sectors so that I can see which servicers hold stressed loans where we buy.* P1, R2. **Built** (`src/sources/edgar.mjs`, `outbound sources run edgar`, worker job `sources.edgar`). A live run on 40 trusts (2026-11-13) found 17 CMBS trusts and 1,205 loans, and kept 51: 13 in special servicing, 21 maturing within 18 months. Seven special servicers were named, with no unknowns.
- [ ] Discovery: the quarterly form index gives the latest ABS-EE filing per trust; the EX-102 namespace classifies it as CMBS.
- [ ] Parsing uses a small, tested parser for this flat schema, with no new dependency.
- [ ] A loan is kept when any of its properties is in a buy-box metro (state plus county name, per `metros.json`) and its property type maps to a buy-box sector: LO to hospitality, MF to multifamily, RT to retail. MU (mixed use) is shown, marked as possibly in the buy box.
- [ ] Stored per trust and loan, keyed `cmbs:<CIK>:<assetNumber>`, with the reporting period and the E2 run log, field check and change log. Status changes are logged (E2-S4).
- [ ] The special servicer's firm name is read from the 10-D exhibit 99.1 cover. Names are matched against a list a principal has reviewed; an unrecognized name is flagged, never guessed.
- [ ] Requests send a declared User-Agent whose contact comes from config (Q11) and stay under the SEC's request-rate guidance. The run refuses while that contact is a placeholder.

**E4-S3. Special-servicing and maturity signals.** *As a principal, I want to know when a loan in our metros moves to special servicing or nears maturity so that its servicer becomes a candidate.* P1, R2. **Built in part:** per-loan signals (special servicing, note sale, DPO, REO, foreclosure, delinquency, maturity, modification) and a per-servicer summary (`sources/edgar/servicers.json`), shown on the platform's Servicers screen. Not built yet: servicers as candidates in the scored list.
- [ ] The signal attaches to the **servicer**, a candidate institution. The loan is context for a principal only (the asset rule), and a test confirms it never reaches the drafter.
- [ ] The maturity window is set in `scoring.json` (placeholder: within 18 months).

**E4-S4. Rate context.** *As a principal, I want current SOFR and 5- and 10-year Treasury yields shown beside each maturity signal so that I can judge refinancing stress myself.* P1, R2.
- [ ] Daily FRED series `SOFR`, `DGS5` and `DGS10`. The free FRED key is saved as a credential and never put in the repository.
- [ ] Where the loan's rate is in the data, show it beside the current yield. The card never states a refinancing outcome as a fact.

---

### E5. County public-record signals

**E5-S1. Reachability spike** (research agenda B7). *As a principal, I want to know what each county actually offers, and at what cost, before we build or buy anything.* P1, R2.
- [ ] A table for Travis (TX), Denver (CO), Los Angeles (CA), Maricopa (AZ), Clark (NV) and San Diego (CA). For each county:
  - which documents exist (for example, notices of trustee's sale, notices of election and demand, notices of default) **[verify by state]**;
  - how to reach them: search page, bulk export, API or in person;
  - cost, and whether the terms allow automated access;
  - how to tell commercial from residential (for example, assessor land-use codes);
  - how long after recording a document appears;
  - the vendor and its price, wherever free access falls short.
- [ ] A decision for each county: a free adapter, a vendor, or skip.

**E5-S2. Filing ingestion.** *As a principal, I want commercial foreclosure filings in our metros captured so that I can see which lenders are enforcing on commercial property.* P1, R3, for the counties the spike approves.
- [ ] Commercial only. Lender, trustee and lender's counsel extracted.
- [ ] Every filing is stored as context only. A test confirms none reaches the drafter.

**E5-S3. Lenders and counsel rolled up.** *As a principal, I want filings counted by lender and by the lender's law firm so that I can see who is enforcing and which firms they use.* P1, R3.
- [ ] Lender names matched to banks through E6-S1.
- [ ] Filings per law firm, per metro, per quarter. This feeds the counsel ranking in plan section 3.2.

---

### E6. Matching, scoring and the candidate list

**E6-S1. One key per institution.** *As a principal, I want every mention of a bank, from any source, tied to one record so that signals from different sources add up instead of splitting.* P0, R1.
- [ ] Banks are keyed by `CERT`. Servicers, funds and law firms get internal ids. Each has an alias table.
- [ ] Automatic matching only on an exact normalized name or a known alias.
- [ ] Anything fuzzier goes to a review queue with a suggested match and a confidence score (Haiku, low effort). Nothing below exact merges without a principal.

**E6-S2. A score I can read.** *As a principal, I want a score whose parts I can see so that I trust the ranking and can argue with it.* P0, R1.
- [ ] The formula and weights live in `scoring.json`, committed, with placeholders marked. They are not in a prompt.
- [ ] Each candidate shows its components, each with its field, report date and value.
- [ ] The same inputs always give the same score. A test covers it.
- [ ] Hard filters from the buy box and size apply before scoring. By default, total assets under $10 billion, matching the direct-sale route; `ASSET` is in thousands. Banks that fail a filter get no tier.
- [ ] Every component belongs to one **axis**:
  - **distress**: is the institution under pressure?
  - **fit**: is its likely paper what we buy, where we buy it?
  - **timing**: why now?

  Each candidate shows a subtotal per axis.
- [ ] Tiers: **A**, outreach candidate, needs meaningful distress **and** fit (a distressed bank whose paper we don't buy is not a candidate). **B**, watch. Placeholder thresholds per axis.

**E6-S3. A "why now" card.** *As a principal, I want a three-to-five-line summary for each candidate so that I can decide in under a minute.* P0, R1.
- [ ] Built **in code**, with no model. Each sentence comes from one fixed template per signal type or profile fact, filled only with computed values.
  - Why: a model's card checked only for names and numbers can still invent a judgement ("deterioration accelerated") out of allowed words.
- [ ] Every sentence carries the ids of the signals or records it states. The same input always gives the same card.
- [ ] No template can emit the name of a property, borrower or filing.
- [ ] The card leads with the fit: which category of the bank's paper matches what we buy, and where. It states its period ("as of June 30, 2026") and names no property, borrower or filing.

**E6-S4. Promote, dismiss, snooze.** *As a principal, I want to act on each candidate in one step so that the list reflects my judgment and doesn't keep nagging.* P0, R1.
- [ ] Command line first: `outbound candidates list|show|promote|dismiss|snooze`.
- [ ] Promote creates `accounts/<id>.json` with `institutionKey`, `originSignals`, tier and sector, and writes an audit line with the principal's name.
- [ ] Dismiss requires a reason. A dismissed candidate returns only when a new signal fires after the dismissal.
- [ ] Suppressed institutions, including aliases and affiliates in `suppression.json`, never appear as candidates. A test covers it.
- [ ] No code path creates an account without a principal's name on it. A test covers it.

**E6-S5. Weekly triage.** *As a principal, I want one triage every Monday of what changed across every source, grouped by institution and sorted into act now, watch and already in conversation, so that I know where to spend the week without having to remember to look.* P1, R2. **Built** (`src/triage.mjs`, `triage.json`, `outbound triage run|show`, worker job `triage.run`, the web app's **This week** page). Tested on invented data; not yet run on the live data folder.
- [x] **Rules** live in `triage.json`, committed, with no prospect data. Every value is a placeholder with a `_note`: the window, what counts as act now and as watch, the in-conversation and opt-out events, the order within a category, the calendar settings, and when a source counts as stale.
- [x] **Code only, no model.** Every sentence comes from a fixed template filled with computed values. The same inputs give the same triage, byte for byte (a test).
- [x] **It compares with the previous triage's snapshot,** `triage/state.json`: each candidate's tier and signal ids, and every event seen.
  - The first run has no snapshot and says "first triage, no comparison". It reports only events dated in the window, plus baseline counts.
  - A second run on the same day compares with the same snapshot as the first, so re-running Monday's triage does not empty it.
- [x] **The window** runs from the last triage, or from `--since DATE`, or over the last 7 days (placeholder). Both edges are in.
  - With a snapshot, an event is new when the snapshot has not seen it, so an event FDIC indexed late is still caught, with a note saying so.
  - An event dated more than 90 days back (placeholder) is never new, so a backfill does not flood the list.
- [x] **What it finds:**
  - new candidates, and candidates that dropped out;
  - tier changes;
  - state signals that turned on or off, compared by type, so a new quarter alone changes nothing;
  - new SEC filings, by `firstSeenAt`;
  - acquisitions;
  - failures in our metros, with the FDIC as the seller;
  - CMBS loans newly coded for a note sale (workout code 5) or newly in special servicing, with their servicer;
  - a newly published FDIC quarter;
  - source runs in the window that failed or look suspect.
- [x] **Act now:** a CMBS note sale; a failure in our metros; an SEC filing that matched a loan-sale or held-for-sale search; a move to Tier A, new or from Tier B; a Tier A bank crossing the concentration screen. It applies only at an institution that is not in conversation, suppressed, opted out, dismissed or snoozed. A bank that fails a hard filter is listed under watch instead.
- [x] **Watch:** other SEC filings, acquisitions, CMBS loans newly in special servicing, a new Tier B candidate, a move down to Tier B, state signals that turned on or off, and candidates that dropped out.
- [x] **Already in conversation:** an institution with a reply, meeting or handoff in `touches.jsonl`. It is shown apart, with its latest touch date and the week's findings, and is never act now. A hand-picked account counts too.
- [x] **Left out, and counted:**
  - Opt-outs are matched by institution key or name and left out of every list, so neither the person nor the institution is surfaced again.
  - Suppressed institutions are left out the same way.
  - Snoozed candidates stay out until the snooze ends. Dismissed ones stay out until a new signal fires after the dismissal (E6-S4).
- [x] **Each item** carries the institution key and name, the category, a one-line reason, the signal or event ids and their dates, and links: the candidate or account page, the servicer page, the SEC filing index and the FDIC loan-sale page. Items are sorted by category, then strength, then date.
- [x] **System health:** failed and suspect runs in the window; sources whose last ok run is older than a limit (placeholders: FDIC 8 days, CMBS 35, SEC filings 4); scoring that is stale or behind the FDIC data.
- [x] **The calendar:** the next quarter-end and the days until it; whether the review window is open (placeholder: 6 weeks before the quarter-end); when the next FDIC quarter is expected (placeholder lag: 60 days); when the next CMBS reporting cycle lands (placeholder: the 15th). Like E10-S1, it decides **when** a principal looks, never what a message says. The triage never feeds the drafter or the briefer: a test checks their load lists and their code.
- [x] **Output:** `triage/<date>.json` and `.md` in the data folder, the updated snapshot, and an audit line with counts only. The data-rule test also refuses a tracked `triage/` file.
- [x] **Surfaces:**
  - `outbound triage run [--since D]` and `outbound triage show [--date D]`;
  - worker job `triage.run`, whose result holds counts only. Its unit of work loads the snapshot and the day's two files, never past triages;
  - every Monday the workflow queues it after the FDIC check and a scoring run. Scoring uses `--draft-buybox` (a PROVISIONAL list while the buy box has placeholders) unless the repository variable `SCORING_STRICT` is `true`;
  - the web app's **This week** page (`/triage`), first in the nav, server-rendered from the stored record.
- [ ] The database's job-kind list gains `triage.run` in the merge migration. This change adds no migration. Until it lands, `enqueue triage.run` is refused, and the Monday queue step fails with it.
- [ ] Delivery beyond the data folder and the web app is still Q13. It goes only to the firm's principals, never to a prospect.
- [ ] A principal reviews `triage.json`: the act-now rules, the window, the calendar settings and the staleness limits.

**E6-S6. The paper profile.** *As a principal, I want to see what paper an institution likely holds, how distressed each part of it is, and where it lends, so that I approach it knowing what it probably has to sell.* P0, R1.
- [ ] Each candidate carries a profile, computed in code. For each CRE category (construction, multifamily, nonfarm nonresidential, with owner-occupied and other shown separately where the fields allow), it shows:
  - balance and share of the CRE book;
  - each stage of distress: 30–89 days, 90+ days, nonaccrual, noncurrent, OREO, quarterly charge-offs;
  - the direction over 4 quarters;
  - whether the buy box buys that category in the bank's metros.
- [ ] The profile also shows the metro footprint: branches and share of deposits by metro.
- [ ] Every number carries its field and report date.
- [ ] The profile says plainly what the data cannot show: hotel and retail are inside nonfarm nonresidential, and there are no loan sizes, maturities or individual loans.

**E6-S7. Advantage signals.** *As a principal, I want to see where we have an edge with an institution so that we spend outreach where we can win, not just where there is distress.* P1, R1 for FDIC-derived signals, R2 for the rest.
- [ ] Signals that suggest a direct, less contested sale, each shown with its evidence:
  - assets under the direct-sale threshold, so the bank is more likely to sell without an advisor (FDIC; R1);
  - a CRE book concentrated in the categories and metros we buy (FDIC; R1);
  - a regulatory order that pushes the bank to reduce problem assets (the briefer's `bank.regulatory`);
  - no loan sale advisor found (`bank.advisors`, which replaced `bank.access` in E17-S2);
  - the bank has sold loans before (`bank.intent`).
- [ ] An advantage signal never overrides the risk screen. An active sale run by an advisor, or a failing bank, still means wait or do not approach.

**E6-S8. The research travels with the account.** *As a principal, I want the briefer and the drafter to start from what the pipeline already found so that research goes deeper on the right paper and the message leads with the right sector.* P0, R1.
- [ ] Promoting a candidate copies its profile, fit, signals and period into the account file (`pipeline` block).
- [ ] The briefer's prompt includes that block as data. It focuses `bank.exposure` and `bank.intent` on the matching categories, for example: "look for multifamily credit-quality disclosures and any stated plan to sell multifamily loans".
- [ ] The drafter receives only which **sector** to lead with and which approved site page to link. A test confirms the drafter's input contains no FDIC figure, no ratio and no signal text.
- [ ] Given a draft that mentions the bank's own figures, distress or trend, then the existing linter blocks it.

---

### E7. Contact finding

Rules across the epic:
- Contact details live in the data folder and the database only: the account file, the known list and the vendor tests (`contacts/`). The data-rule test fails on any tracked file under `contacts/`.
- None of it reaches the drafter. The drafter writes to a name and a title; the address is the guard's business. `test/contacts-handoff.test.mjs` proves it.
- Nothing contacts a mail server. Verifying an address looks up its domain's MX record in DNS, and that is all. A test fails if the contact modules use a network socket, SMTP, RCPT or `fetch`.
- Audit lines and job results hold ids, codes and counts, never a name or an address.

**E7-S1. Institution-first research names the candidates.** *As a principal, I want the briefer to research a promoted bank before anyone is named, and to bring back who most likely decides, so that the first message reaches the right person.* P0, **R1** (built).
- [x] An account with no named person is researched in **institution mode**. The prompt says no one is named. For `bank.people` it asks for up to three people who most likely decide on loan sales, each a sourced person finding, and forbids guessing a name. *(Checked in `src/research.mjs` `buildPrompt` and `test/research.test.mjs`.)*
- [x] In institution mode the person check reads `not_named` whatever the model says. The brief lists the candidate findings and says a principal chooses. *(`processFindings`, `renderBrief`.)*
- [x] `outbound account set-person --account ID --name N [--title T] --by NAME` records the choice, with an audit line. It resets the role to unconfirmed. Confirming the role is still a separate step for a principal (`account confirm-role`). *Since E7-S3 it also needs a source, normally the candidate's finding (`--finding F3`).*
- [x] The guard still refuses any touch until a person is named, their role confirmed, and their address verified. **Built here:** the guard had no rule of its own that a person is named. Only `confirm-role` required a name, so an account edited by hand could pass a letter or a LinkedIn note with no one named. The guard now refuses every channel with `PERSON_MISSING`. The role is `ROLE_UNCONFIRMED`; the address is `EMAIL_UNVERIFIED` (E7-S3).

**E7-S2. Vendor test before paying.** *As a principal, I want any contact-data vendor tested on 50 people we already know so that we pay for accuracy, not claims.* P1, R3. **Built** (`src/vendors.mjs`, `outbound contacts ...`). There is no vendor API and no key: a principal exports the vendor's results to a file.
- [x] A test harness compares each vendor's results against the known list. It reports correct, wrong and missing emails, and whether titles are current.
  - The known list is `contacts/known.json` in the data folder, written by a principal: name, institution, email, title and an as-of date for each person.
  - `outbound contacts vendor-test --vendor NAME --results FILE` reads the vendor's CSV or JSON export, mapping its own column names (name, or first and last name; company or organization; work email; job title). It matches each known person by normalized name (case, punctuation, initials, honorifics and suffixes dropped) and institution (legal suffixes such as N.A. dropped).
  - For each known person it reports the email as correct, wrong or missing, and the title as current, stale or missing (EVP, CCO and similar abbreviations count as the full title). It also reports coverage, the vendor's records not on the list, and duplicates.
  - Rates: correct email over the known people we hold an address for; wrong email over the addresses the vendor gave; current title over the known people we hold a title for.
  - It writes `contacts/vendor-tests/<vendor>-<date>.json` and `.md`. Rows name the known list's refs only, never a name, an address or a title, so a deletion request removes a person from one place.
- [x] No vendor is wired in until a principal records a pass against a threshold the principals set.
  - `outbound contacts vendor-pass --vendor NAME --by NAME` records a pass in `contacts/vendors.json` only when the latest test meets every threshold in `contacts.json` (`vendorPass`: minimum sample 50, minimum correct-email rate, maximum wrong-email rate, minimum title-current rate). Every value is a placeholder (D-C2). Otherwise it lists the failures and exits 1.
  - A vendor as the source of a field (`--source vendor`), or as how an address is known (`--method vendor`), is refused without that pass.
- [ ] The principals set the thresholds (D-C2) and run the first test on 50 people they know.

**E7-S3. Verified, sourced addresses.** *As a principal, I want every email address verified and sourced so that we don't bounce or reach the wrong person.* P1, R3. **Built** (`src/accounts.mjs`, `src/forget.mjs`, the guard, `outbound account ...`, the account page's contact section).
- [x] Every address is verified before use, and every field records where it came from (existing guard rules: business addresses only, no role or personal addresses).
  - **Sources.** Each person field (name, title, email, phone, mailing address) has one entry in `contact.provenance`: the field, its value, a source kind, a URL or brief finding id, the date seen, and who set it, with when. The kinds:
    - `brief_finding` (`--finding F3`): the URL and date come from the brief. Naming a person from a finding requires a person finding that names them.
    - `institution_site` (`--url`).
    - `correspondence`.
    - `principal_known`.
    - `vendor`, only with a recorded pass (E7-S2).
  - `account set-person`, `set-email`, `set-phone` and `set-address` each take a source. Naming a different person clears the last one's address, phone and verification.
  - A new address starts unverified. A personal, role or malformed address is refused when it is set, and so is a suppressed one.
  - **Domains.** `account add-domain` records each of the institution's email domains, with a source, in `account.domains` (E9-S3 matches replies by them). A personal domain is refused. A domain another account already holds is flagged for a principal.
  - **Verification.** `account verify-email --method institution_site --url URL | correspondence | principal_known | vendor --vendor NAME`. Every check is required:
    - the syntax is valid;
    - the address has a recorded source;
    - it is a business address for a person (no personal domain, no role local part);
    - the domain is one of the account's confirmed domains, or a subdomain of one;
    - the domain has an MX record, which is not a null MX. This is one DNS lookup (`node:dns` `resolveMx`, injectable so tests never touch the network). `contacts.json` `requireMx` (D-C3).
    - the address is not suppressed.

    The address is `verified` only when every check passes **and** the principal's attestation is recorded with it (`contact.verification`: address, method, page or vendor, date seen, who, when). A failed check leaves it unverified and revokes an earlier verification. No mail server is ever contacted.
  - **The guard**, for email:
    - `EMAIL_UNVERIFIED` when there is no verification record;
    - `EMAIL_UNVERIFIED` when the verification is for a different address than the current one;
    - `EMAIL_UNVERIFIED` when it is older than `contacts.json` `reverifyDays` (placeholder 180, D-C1). With no period set, nothing counts as verified.
    - `EMAIL_UNSOURCED` when the current address has no source of its own.
  - **One rule, read everywhere.** These four checks are one function, `emailCheck` in `src/guard.mjs`. The guard, the contact view (`contactStatus`) and the direct route to the decision-maker (E17-S5) all call it, so nothing shows an address as verified when the guard would refuse it.
  - `account contact` (and the web page) shows each field with its source, the address's state and the date to verify again by. The state is one of: unverified, verified, expired, verified for another address, or unsourced (verified, but the address has no source of its own, so the guard refuses it).
- [x] A deletion request removes the person from every record, and the removal is logged.
  - `outbound account forget-person --account ID --by NAME --reason TEXT --confirm "ACCOUNT NAME"`, or the account page, which also needs the account's name typed. `--name` and `--email` reach a person who is no longer on the account.
  - It runs as one unit of work over every store that can hold a person (`LOADS.forget`). Each store, and how it is handled:

    | Store | Handled |
    |---|---|
    | `accounts/` | Every account that holds them (the same address, or the same name at the same institution) loses their fields, sources, verification and role. They leave people lists, such as names from call notes, and other text is redacted. The account keeps the institution's own data, and a `forgotten` record: who, when, and the reason with the name removed. |
    | `research/` | Person findings that name them, and the findings their fields were sourced from, are removed, with pages no other finding cites. Ids that pointed at them are dropped. Other text is redacted, search queries included. |
    | `briefs/` | Rebuilt from the scrubbed research, then redacted. |
    | `facts/` | The same findings are removed; other text is redacted. |
    | `drafts/` | A draft that names them is emptied to its step, channel, dates, claims used and approval. Its text, subject and output are gone, and it cannot be approved (`approveDraft` refuses it). |
    | `calls/` | Notes, call briefs, proposals and follow-ups are redacted. They leave every people list. The outcome codes stay. |
    | `outcomes.jsonl` | Holds no names by design; any value that names them would become `[removed]`. |
    | `touches.jsonl` | It stores the type, account, institution, step, channel, sender, dates and, for an event, a free-text `note`. A value that names them, in practice the note, becomes `[removed]`. The event itself stays, so a reply or an opt-out keeps stopping outreach. |
    | `pilot/` | Truth sheets are redacted. Review verdicts on removed findings are dropped. |
    | `contacts/` | Their row leaves the known list. Vendor reports hold refs only, and are redacted all the same. |
    | `network/` | The firm's network (E17-S1) can hold them if the firm knows them. Their entry goes: their name at their institution, or their address or phone anywhere. Every route and choice that used the entry goes with it, as when a principal removes an entry (`dropNetworkEntries`). Other entries are redacted: fully at their institution, for contact details elsewhere. |
    | `routes/` | Routes (E17) hold lender-side names: targets, the direct route's person and candidates, reasoning lines, checklists. A routes file that still names them, judged at its account's level as for research, is rebuilt from the scrubbed research and network by `buildRoutes`, with no model. A choice whose route named them is removed, and the file says a choice was removed. A routes file whose account is gone is redacted instead. Before anything is written, `routes.json` is checked, so an error in it stops the deletion before it starts. |
    | `suppression.json` | Plain entries for their address or name become hashes, keeping their reason and date. Hashed entries are added for the address, and for the name with each name of the institution (its name, aliases and key). |
    | `audit.jsonl` | Never rewritten: it holds ids, codes and counts. |

  - **How a mention is found.** Their address, phone and street address identify them anywhere. Their full name identifies them in the records of their own institution, in any of its accounts: as written, reversed ("Sample, Jordan"), with a middle initial, or as a page slug. A first or last name alone is redacted only in their own account's file, drafts, calls and touch-log notes, where it can only mean them. A name in another institution's records may be someone else, and is left alone (D-C6).
  - **Never again.** The guard matches hashed entries as it matches plain ones (`SUPPRESSED_EMAIL`, `SUPPRESSED_PERSON`), and naming them, or setting their address, is refused.
  - **The log line.** One audit line, `person_forgotten`: the account id, who, when, and the number of files or lines changed in each store, `routes` and `network` included. It holds no name and no address. The rebuild of a routes file writes no line of its own. The command line prints the same counts.
  - **The platform.** Migration `20261114200000_log_redaction.sql` lets `flush_uow` redact log lines.
    - Only `touches.jsonl` and `outcomes.jsonl`. The audit log is never rewritten.
    - A value may only become `"[removed]"`. No key is added or dropped.
    - `type`, `accountId`, `institution`, `date`, `id` and `ref` never change.
    - A line that changed since it was loaded is a conflict, and the whole flush is undone.
    - `test/db.test.mjs` runs it on Postgres 16, and `test/postgrest-fake.mjs` applies the same rules.
    - The client refuses to report a redaction as done by a database without the migration. The web app checks that before it scrubs anything.
    - No new job kind: every contact action runs inside a web request or a command-line unit of work.
- [ ] Counsel reviews the deletion process and the hashed suppression (Q16, research agenda G1), and the principals decide D-C4 to D-C6.
- [x] The account page's older "Set person" form, in "The person" panel, had no source fields, so it was refused. **Removed.** The panel now points to the contact section, whose "Name the person" form is the only way to name a person on the web. `web/test/contact.test.mjs` checks that.
- [x] **Every command that names a person carries a source.** That covers `outbound account set-person` and its help text, and the routes checklists (E17-S6): naming a candidate uses `--finding ID` with the candidate's own finding, and after an introduction it uses `--source correspondence`. `test/routes.test.mjs` runs each checklist's command on the command line.

**Plumbing.**
- [x] `contacts.json` at the repository root: `reverifyDays`, `requireMx` and `vendorPass`, every value a placeholder with a `_note`. `loadRules()` gives it to the guard as `config.contacts`.
- [x] Units of work (`src/uow.mjs`, `LOADS`):
  - `person`, `verify` and `domain`, narrowed to one account by `contactLoads()`. `domain` reads every account, to flag a shared domain.
  - `forget`: every store above, `routes/` and `network/` included. It also loads the guard's files and `sales/ledger.json`, which a routes rebuild reads.
  - `vendors`: `contacts/`.

  The drafter's list holds none of them. No model-facing action loads `contacts/`, `routes/` or `network/`: not research, the drafter, call prep, or the reading of call notes. `test/private-stores-handoff.test.mjs` proves it from the load lists, and end to end for the briefer's, the drafter's and call prep's prompts.
- [x] **Web**, on the account page, through `web/lib/ops.mjs` as the signed-in principal (`web/app/accounts/[id]/contact.jsx`):
  - each field and its source;
  - naming the person with a source, choosing from the brief's candidates;
  - the address and its state;
  - the domains;
  - the verify form, with the checks and an attestation;
  - forget person, which needs the account's name typed.

**Decisions for a principal.**

| # | Decision | Default |
|---|---|---|
| D-C1 | How long a verification lasts before the address must be verified again (`contacts.json` `reverifyDays`) | 180 days (placeholder) |
| D-C2 | The vendor thresholds (`contacts.json` `vendorPass`): minimum sample, minimum correct-email rate, maximum wrong-email rate, minimum title-current rate | 50 people; 90%; 3%; 80% (placeholders) |
| D-C3 | Is the MX lookup required to verify an address (`contacts.json` `requireMx`)? It is one DNS query. No mail server is contacted either way, and a principal's attestation is required either way | Required |
| D-C4 | How long a forgotten person's hashed suppression entries are kept | For good, never pruned: a pruned entry would let them be named and contacted again |
| D-C5 | How the suppression hash is made. It is SHA-256 of the normalized address, and of the normalized name with each name of the institution, with a fixed prefix and no secret. Anyone who already holds an address or a name can test it against the list; that is how the guard matches. Someone with a long list of candidates could test those too. A keyed hash (HMAC) would resist that, but needs the same secret on every machine that runs the guard | Unsalted SHA-256 |
| D-C6 | How far a deletion reaches. A name alone in another institution's records is left, because it may be someone else; only the address, phone and street address are removed there. The same holds for the firm's network: an entry with their name at another organization stays, and so does another bank's research that names them, and that bank's routes through anyone but their own entry. Call notes and briefs are redacted, not deleted, so the bank's facts and the outcome codes stay. A title in free text is not redacted | As built |

---

### E8. Private database and review screen

**E8-S1. A private database.** *As a principal, I want the data in one private database with access control so that it can run on a schedule and be reviewed in a browser, and never touches the repository.* P0, R2.
- [ ] A private Postgres database (Supabase), with row-level security on every table. Access is limited to named principals, plus a service role for scheduled jobs.
- [ ] Moving from files is one command and can be re-run safely. Files stay readable until a principal confirms the switch.
- [ ] Keys live in environment variables or a secret store, never in the repository. The data-rule test (`test/repo.test.mjs`) fails on any tracked file under `pilot/`, `candidates/` or a root `sources/`, on run logs, and on any `.sql`, `.csv`, `.tsv`, `.xlsx` or `.dump` file outside `test/fixtures/` (built).
- [ ] Each entity gets its own schema by design, but only one is built (P2).

**E8-S2. Candidate screen.** *As a principal, I want to filter candidates by metro, sector, tier and signal and open a bank's 8-quarter trend so that I can clear the list in under 30 minutes.* P0, R2.
- [ ] A list view with filters, and a bank detail page with each metric's trend and the source of every value.
- [ ] The same actions as the command line (E6-S4), with the same audit trail.
- [ ] Sign-in is required. Unauthenticated requests get nothing. No third-party analytics, and no prospect data in client-side logs.

**E8-S3. Approval queue.** *As a principal, I want to read a draft beside its facts, lint result and guard result, edit it, and approve it so that approving is quick and safe.* P0, R2.
- [ ] Every edit re-runs the linter and the guard (existing `approveDraft`). A blocked draft shows its reasons and cannot be approved.
- [ ] Approve never sends. It creates the Gmail draft (E9-S1).
- [ ] Who approved and when is audited.

**E8-S4. Market view.** *As a principal, I want a map of distress across the six metros so that I can see where pressure is building.* P2.
- [ ] Metros shaded by the median CRE noncurrent ratio of their banks, weighted by metro deposits, with drill-down to the list.

---

### E9. Mailbox: Gmail drafts, sends and replies

**E9-S1. Approve creates a Gmail draft.** *As a principal, I want an approved email to appear as a draft in my own Gmail so that I can send it with one click from my real mailbox.* P0, R2.
- [ ] The draft holds the approved text exactly, in plain text, with the sender's signature. No tracking pixel, no tracked links. It is from the principal's mailbox on the sending domain.
- [ ] The code calls only Gmail's draft-creation and read endpoints. Google's permission for creating drafts also allows sending **[verify scope]**, so the limit is enforced in code: a test fails if any send method is referenced.
- [ ] The guard runs again at draft creation (caps, suppression, kill switch). If it refuses, no draft is created.

**E9-S2. Noticing a send.** *As a principal, I want the system to notice when I've sent a draft so that the touch log and cadence are right without me typing a command.* P0, R2.
- [ ] A sync reads the draft's thread. When it sees the message sent, it **always** records the touch with the actual send date, using `recordObservedSend` (built).
  - The pre-send `recordTouch` refuses a touch the guard rejects. For a send that has already happened, refusing to log it would leave the caps and cadence counting from a false history.
  - Any rule the send broke (a cap filled, or a suppression added after approval) is kept on the record, audited, and shown to the principal.
  - `outbound guard record` uses the same function.
- [ ] Given the principal edited the text in Gmail before sending, then the sent text is linted, and any failure is flagged for review and noted in the audit log. Message text is not stored in the touch log.

**E9-S3. Any reply stops outreach.** *As a principal, I want any reply from anyone at a bank to stop outreach to everyone there immediately so that we never send a next step after someone has answered.* P0, R2.
- [ ] Inbound mail is matched to accounts by thread first. Otherwise by sender domain, against the institution's **verified `domains`** list, not its name aliases. Names and DNS domains are different things.
  - Each domain carries its source.
  - Personal domains (`config.personalDomains`) never match.
  - A domain shared by several institutions (a holding company, an affiliate, a shared service provider) goes to a principal for review rather than stopping or missing one institution.
  - Given a reply from an unknown domain on no known thread, then it is flagged for review and never silently dropped.
- [ ] Any reply records a `reply` event, which stops outreach across the bank (existing rule).
- [ ] An opt-out, or anything that reads like one, suppresses the person and the address at once.
- [ ] Ambiguous mail is treated as a reply and flagged. A bounce records a `bounce` event.
- [ ] Only a category and a date are stored. Reply text is not kept.

**E9-S4. Reply sorting** (agent 6). *As a principal, I want replies sorted into interested, not now, wrong person, opt-out, bounce and out-of-office so that I answer the interested ones first.* P1, R3.
- [ ] Haiku at low effort sorts replies. Opt-outs are handled at once regardless of how confident the sort is. It alerts a principal on "interested" and never replies with substance.

---

### E10. Quarterly follow-up and nurture

**E10-S1. Quarter-end windows.** *As a principal, I want non-responders brought back for my review in the weeks before each quarter-end so that follow-up lands when banks decide what to clear.* P1, R3.
- [ ] The guard gains a nurture state after `SEQUENCE_COMPLETE`, with at most one touch a quarter (configurable). Never after a reply, opt-out, meeting or handoff.
- [ ] Windows open on configurable dates: by default March 10, June 10, September 10 and December 10.
- [ ] Accounts in a window appear in the approval queue. Nothing is drafted or sent without a person.
- [ ] The **message** never mentions quarter-end. The existing linter rule stays, and a test confirms a nurture draft that mentions it fails.

**E10-S2. Zero-ask nurture content.** *As a principal, I want follow-ups to share something useful the firm has published so that a follow-up is worth reading.* P1, R3.
- [ ] Nurture drafts may link only to firm-published pages present in `site-snapshot/pages.json`, such as the news desk and the monthly Hotel loan watch.
- [ ] No deal flow, no named assets, no recommendations of third parties.

---

### E11. Scheduling, monitoring and cost

**E11-S1. Schedules.** *As an operator, I want sources to refresh on their own schedule so that the list stays current without anyone remembering.* P0, R2.
- [ ] The FDIC new-quarter check runs weekly. Summary of Deposits annually, after its release. CMBS monthly. FRED daily, if E4-S4 ships. County feeds as decided in E5-S1.
- [ ] Before E8, runs are manual from a principal's machine. Scheduled runs (for example GitHub Actions) start only once data lives in the private database, never on the runner's disk.
- [ ] Job logs carry counts and run ids only. A check fails the job if a log line looks like an email address or a phone number. Keys live in the scheduler's secret store.

**E11-S2. Failure alerts.** *As an operator, I want to hear when a run fails or looks wrong so that a broken feed doesn't go unnoticed for a quarter.* P0, R2.
- [ ] A `failed` or `suspect` run alerts the operator. The alert names the source and the run id and carries no prospect data.

**E11-S3. Cost.** *As a principal, I want to see what the models cost per run and per month so that spending is a decision, not a surprise.* P1, R2.
- [ ] Tokens and estimated cost per run and per month (existing `estimateCost`), and the cost per "why now" card.
- [ ] Brief costs use the E1 measurements. Web search fees are shown separately once known.

**E11-S4. Kill switch.** *As a principal, I want one switch that stops everything outward-facing so that I can pause the system at once.* P0, R2.
- [ ] With the kill switch set (config, environment variable, or a `KILL` file), no Gmail draft is created and no mailbox write happens. The candidate list shows a banner.
- [ ] Ingestion of public data may continue.

---

### E12. Platform foundation

**Decided November 13, 2026:**
- A private web app for the firm's principals only, not partners or outside customers.
- Supabase (Postgres with row-level security) holds the data, and is the system of record.
- Next.js on Vercel serves the app.
- Release 2 is built on this. E8 (the screens) and E11 (schedules) sit on top of it.

**The design, in one paragraph.** The engine (guard, briefer, drafter, pilot, scoring, sources) stays exactly as it is: synchronous, tested, and reading and writing through the helpers in `src/store.mjs`. Those helpers gain a second backend, a **unit of work**. An action loads only the documents it needs from Postgres into memory, runs the same engine code against them, then writes back every changed document and new log line in **one transaction**, with a version check on each document. The web app reads small per-candidate rows kept in step with each write, never the whole candidate file (7.6 MB on live data). Long jobs (pulls, scoring, research, drafting) go on a queue that a worker runs, never inside a web request. Measured on the live data folder: 12 MB in 279 files.

**E12-S1. One engine, two storage backends.** *As an operator, I want the platform to run the same tested code as the command line so that nothing behaves differently on the web.* P0, R2. **Built** (`src/store.mjs`, `src/uow.mjs`, `test/uow.test.mjs`).
- [ ] `src/store.mjs` routes every read, write, append, list and existence check by root: files for a normal data folder, memory for a unit of work. The ten or so direct `existsSync` and `readFileSync` calls in `src/` and `cli.mjs` move behind the helpers.
- [ ] The whole existing test suite passes unchanged on files.
- [ ] A new test runs these flows on both backends and gets identical stored results: promote, dismiss, set person, confirm role, the guard's check and record, pilot verdicts, approving a draft.
- [ ] Given an action reads a path its unit of work did not load, then it fails loudly with the path. It never silently reads empty.

**E12-S2. The database.** *As a principal, I want our data in one private database that only named principals can open so that the platform is safe to use from a browser.* P0, R2. **Built and tested on Postgres 16** (`supabase/migrations/`, `npm run test:db`).
- [ ] Migrations live in `supabase/migrations/`.
- [ ] Tables:
  - `documents` (path, body, version, updated_at, updated_by);
  - `log_lines` (path, line, at), append-only;
  - `candidates`: one row per candidate with the columns the list filters on (key, tier, score, axes, metros, sectors, name, card, period) and the full item;
  - `principals` (email, name, active);
  - `jobs` (kind, params, status, requested_by, timestamps, result).
- [ ] Row-level security is on every table:
  - a signed-in user whose email is an active principal may read, and may write through the flush function only;
  - the anonymous key gets nothing;
  - the worker uses the service role.
- [ ] One Postgres function applies a unit of work atomically. Given any document's version changed since it was loaded, then nothing is written and the action is retried once, or reported.
- [ ] No prospect data in migrations or seed files. The data-rule test also rejects `supabase/seed*.sql` with data rows.

**E12-S3. A client with no new dependency.** **Built** (`src/platform/client.mjs`). It is tested against an in-memory fake of the REST API. The real REST layer is first exercised when a Supabase project exists, at E12-S7. *As an operator, I want the engine to reach Postgres through Supabase's REST API with plain `fetch` so that the engine gains no new dependency.* P0, R2.
- [ ] Loading and flushing a unit of work, claiming and finishing jobs, and the candidate projection all go through PostgREST and RPC calls.
- [ ] Tested against a fake server, like the FDIC adapter.

**E12-S4. The worker.** *As a principal, I want to start research, drafting, data pulls and scoring from the web and have them run in the background so that a ten-minute research run never times out a page.* P0, R2. **Built** (`src/platform/worker.mjs`, `.github/workflows/platform-worker.yml`).
- [ ] `outbound worker --once` claims the oldest queued job (skip-locked) and runs the same function the command line runs, in a unit of work. It records the result and frees the job.
- [ ] Job kinds: `sources.fdic`, `score.run`, `research.run`, `draft.run`, and `triage.run` (E6-S5).
- [x] A scheduled GitHub Actions workflow runs the worker hourly on weekdays (12:17 to 23:17 UTC) and queues the weekly FDIC check on Mondays (E11-S1), then scoring and the weekly triage (E6-S5). Logs carry job ids, kinds and outcomes only. Keys live in Actions secrets. It is off until the repository variable `PLATFORM_ENABLED` is `true`.
- [ ] **Known limit:** a job queued from the web waits up to an hour for the next run. A "run now" trigger from the app needs a GitHub token on the server (P1).
- [ ] The kill switch, a `KILL` document or the config flag, stops every job that could create a draft or touch a mailbox.

**E12-S5. The web app.** *As a principal, I want to work the candidate list, read briefs, run the pilot and approve drafts from a browser so that the system fits a working day.* P0, R2. **Built** (`web/`). Tested against a fake Supabase seeded with live FDIC data; not yet run against a real project (E12-S7).
- [ ] Next.js in `web/`, sign-in through Supabase Auth email links, allowed only for active principals.
- [ ] Screens: Candidates (E8-S2), Bank detail with the paper profile and 8-quarter trend, Accounts, Account and brief, the approval queue (E8-S3), Pilot, Status (runs, jobs, kill switch).
- [ ] Quick actions call the engine through a unit of work on the server: promote, dismiss, snooze, set person, confirm role, pilot verdicts, approve. Long ones are queued (E12-S4).
- [ ] There is no send button anywhere, matching the plan.
- [ ] The site sends a no-index header, loads no third-party scripts or analytics, and logs no prospect data on the client.

**E12-S6. Moving data in and out.** **Built** (`src/platform/move.mjs`). *As an operator, I want to load an existing data folder into the platform and export it back so that nothing is lost, and the firm always holds a copy it can read.* P0 for push, P1 for pull. R2.
- [ ] `outbound platform push` copies a data folder into Postgres and can be re-run safely.
- [ ] `outbound platform pull --to DIR` writes the platform's data back to a folder, which must be outside the repository.

**E12-S7. Deploy.** *As a principal, I want the app at an address only we use so that the platform is real.* P0, R2. **Needs Q17 and Q18 first.**
- [ ] A Supabase project and a Vercel project, both dedicated to Valley Capital.
- [ ] Keys in each platform's secret store.
- [ ] The principals' emails in `principals`.
- [ ] Preview deployments protected or off.

---

### E13. Event listeners

Some sources report a dated change rather than a state: a filing, a notice, an order. A listener records each new event once, with its date, and keeps it (`docs/data-sources.md`, section 1). Every listener keeps the E2 contract:
- a recorded fake;
- the run log, field checks and the change log;
- a verify check;
- a worker job kind and a line in the schedule.

**E13-S1. The SEC filings listener.** *As a principal, I want banks' SEC filings watched every day for signs that they are selling CRE loans so that I hear of a held-for-sale transfer, a loan sale or an impairment when it is filed, not a quarter later.* P1, R2. **Built** (`src/sources/efts.mjs`, `src/sources/filers.mjs`, `src/sources/filings.mjs`, `filings.json`, `outbound sources run filings`, worker job `sources.filings`). Live runs wait for the SEC User-Agent contact (Q11).
- [x] **The endpoint, checked live on 2026-11-13.** It is EDGAR full-text search (`efts.sec.gov/LATEST/search-index`), which is undocumented. The findings are written in `src/sources/efts.mjs`:
  - Phrases separated by spaces must all appear in one document. `OR` makes alternatives. There is no proximity operator, so "near" means "in the same document".
  - `ciks` filters by filer, but only with 10-digit, zero-padded CIKs. An unpadded one silently matches nothing.
  - Each hit is one document of a filing, so a filing can come back several times. Every hit carries the 8-K item numbers.
  - The response echoes the query the server ran.
  - Errors come back as HTTP 200 with an error body. Seen: paging past 10,000, and once a failure inside the server.
  - A cache serves answers keyed without 8-K items or SIC codes. Seen: a request got another request's answer.
  - An entity lookup (`keysTyped`) finds SEC filers by name or CIK.
- [x] **The client** reuses the SEC pacing, retries and declared User-Agent. It refuses while `config.sec.userAgent` is a placeholder.
  - Every body is checked.
  - Every response's echo is compared with its request, and every hit is filtered again on its own fields.
  - 8-K items are matched on the hits, never sent to the server.
  - A response with no echo counts as mismatched: the hits carry no text, so only the echo confirms the phrases.
  - A mismatched response is fetched again after the cache expires, then fails the run. A window of over 10,000 hits is split.
- [x] **Saved searches** live in `filings.json`. Each has an id, a label, forms, and phrases or 8-K items:
  - 8-K Items 2.01 and 2.06;
  - "transferred to held for sale", "loans held for sale", "loan sale" and "note sale", each with "commercial real estate";
  - "balance sheet repositioning".

  Every search is a placeholder.
- [x] **The bank-to-filer map** is `sources/edgar/filers.json`, keyed `fdic:CERT`.
  - `outbound filers suggest` proposes filers. It uses FDIC's holding-company name and RSSD ID (`NAMEHCR`, `RSSDHCR`), the SEC's entity lookup, and each candidate's latest 10-K or 10-Q with its SIC code.
  - A filer confirmed for one bank is proposed for the other banks of its holding company.
  - `filers confirm` and `filers reject` record a principal's decision, audited with their name.
  - **Only confirmed mappings are searched.**
- [x] **Signals.** Every hit on a confirmed filer is an **event** signal.
  - It is stored once per filing, de-duplicated on the accession number. It is kept when a later run no longer sees it.
  - Each carries the search ids, form, 8-K items, file date, accession number, a link to the filing index, and the bank key.
  - `filingSignals({ dir })` returns them by bank key. A filing belongs to a bank only while its filer is confirmed.
- [x] A new filer is searched back a year, once. Later runs start each filer three days before the day it was last searched to. So a filer left unconfirmed while other runs moved on is searched over the gap once it is confirmed again. `--since DATE` searches every filer from a date; a bare `--since` is refused.
- [x] Proxy statements (DEF 14A) of confirmed filers are recorded by form, date and link, for the briefer. No names are extracted (E7).
- [x] **A discovery search** finds bank filers not in the list. It searches by business-address state (our five) and bank SIC code. Its hits go to a for-review list (`outbound filers discovered`) and never become signals.
- [x] **Into scoring:** each filing becomes an event signal on its bank's candidate (`detectFilingSignals` in `src/score.mjs`). It is shown while its file date is within `scoring.json` `filings.windowDays` (placeholder: 180), and stated on the card from a fixed template. It adds no points until a principal decides how filings should count.
- [x] **E2:**
  - a fake shaped like the real responses (`test/edgar-search-fake.mjs`);
  - the run log;
  - a field check on every field used: a missing one fails the run and writes nothing;
  - a short read (fewer hits than the reported total), or a hit that does not match its request, fails the run too. Nothing is written and the window stays where it was, because the listener's window never comes back to a day it has passed;
  - the change log;
  - `outbound sources verify filings`: fresh, mapped, sourced, stored filings found again, every confirmed filer still an SEC entity.
- [x] Filings are context for a principal only. The search returns no filing text, and none is stored. A test proves no filing, link, CIK, label or person reaches the drafter.
- [x] Worker job `sources.filings` (migration `20261113213000_jobs_filings.sql`). The workflow queues it on weekdays at 23:37 UTC, then verifies it. A `suspect` run fails the job, unlike the FDIC and CMBS jobs: their next run reads the same state again, but the listener's window has moved past a suspect run.
- [x] **First live run (2026-11-13).** It used a scratch folder, a neutral User-Agent and throwaway mappings:
  - Suggestions for 30 banks: 41 candidates for 15 banks, from 30 lookups.
  - 18 of the 22 exact-name candidates had filed no 10-K or 10-Q in over a year: same-named entities that do not report. So filing evidence outranks the name.
  - With 4 mappings, a 30-day run made 12 requests and read 116 hits. It found 3 filings and 4 proxy statements, plus 21 filings from 16 bank filers for review.
  - Every verify check passed.
  - The first try met an error body from inside the server. Such errors are now retried twice.
- [ ] The signals are wired into scoring (`scoring.json`, `src/score.mjs`), after merge.
- [ ] A principal confirms the filer map, and reviews the searches, windows and bank SIC codes.

### E14. The paper estimate

*As a principal, I want one page per candidate that estimates what CRE the lender holds — how much, which property types, where, what sizes, when it matures, whether the lender already sells, and how much fits our buy box — with every number tiered as reported, observed or inferred, so that I go into the first call knowing the paper.* The design, the critical-detail checklist and stories E14-S1 to S6 are in `docs/paper-estimate.md`. P0 for E14-S1 (data in hand), R2. **E14-S1, the reported layer, is built** (`src/paper.mjs`; `outbound paper show`; the candidate page); what it defers is listed under the story.

### E15. Call prep and outcomes

When the person who decides on loan sales agrees to talk, a principal needs a one-page brief before the call. After it, the outcome is recorded and linked back to the signals that started the account. That link is the learning loop of Goal 5: which signals lead to conversations, confidentiality agreements and loan tapes. **Built** (`src/calls.mjs`, `src/outcomes.mjs`, `outbound call ...`, `outbound outcomes report`, worker jobs `call.prep` and `call.extract`, the account page).

Rules across the epic:
- The brief and the notes are for principals only. They live in the data folder (`calls/<account>/`) and the database, never in the repository.
- Nothing a model extracts is recorded until a principal confirms it. Nothing is sent.
- The research and the paper estimate never reach the drafter (section 0). `test/calls-handoff.test.mjs` proves it.
- Logs and job results carry codes, counts and ids. They never carry a prospect's name or note text.

**E15-S1. The call brief.** *As a principal, I want a one-page brief before a call so that I know who I am speaking with, why now, what they likely hold, and what I may and may not say.* P0, R2. **Built.**
- [x] `outbound call prep --account ID [--date YYYY-MM-DD]`, and the worker job `call.prep`. `--dry-run` shows the request and spends nothing.
- [x] One model call (`callJson`, a strict JSON schema, its own entry `callPrep` in `models.json`). It has no tools. It writes from these inputs only, each with an id:
  - the account: the person, and whether the role is confirmed;
  - the latest research brief: every finding, the risk screen, the person check and the gaps;
  - the signals and the "why now" card from the candidate record, or the account's `pipeline` block when the bank is no longer listed;
  - the paper profile, and the paper estimate (`paper/<key>.json`, E14) when it exists;
  - the touch history: each step sent, with its approved subject and claims, and any reply, meeting or opt-out, including from another contact at the bank;
  - earlier confirmed calls;
  - the approved claims for the account's audience and sector;
  - the playbook questions, and the fixed rules of section 7.
- [x] Sections:
  1. Who you are speaking with.
  2. Why now.
  3. What they likely hold.
  4. What they may want, and likely objections.
  5. Questions to ask.
  6. What we can say.
  7. What not to say.
  8. Next-step options.

  Then the sources cited, by id.
- [x] Code writes these parts, not the model:
  - the warnings at the top: no person named, **the role unconfirmed**, a risk screen of wait or do not approach, an opt-out, a suppression;
  - the tier and as-of date of each line in section 3;
  - the approved claims' own wording in section 6;
  - the paper estimate's tape-request list in section 5;
  - the fixed rules of section 7: never quote their own distress figures back to them, the drafter's voice rules, and the bank's own words from the site's terminology rules;
  - the list of sources cited.
- [x] **Code checks it.** Every item must cite an input. Any failure marks the brief **not usable**:

  | Check | Fails when |
  |---|---|
  | `CITE_MISSING`, `CITE_UNKNOWN` | An item cites nothing, or cites an id that is not among the inputs |
  | `NUMBER_NOT_IN_INPUTS` | A number in the brief does not appear in the inputs. Numbers are compared as numbers, so 6.10% equals 6.1. |
  | `CLAIM_UNKNOWN`, `CLAIM_UNAPPROVED`, `CLAIM_WRONG_AUDIENCE`, `CLAIM_WRONG_SECTOR`, `CLAIM_NOT_WORD_FOR_WORD` | A claim in section 6 is not an approved claim for this bank and sector, quoted word for word |
  | `TIER_UPGRADED`, `ESTIMATE_AS_FACT`, `HOLDINGS_UNSOURCED` | A holding is labelled stronger than the weakest tier it cites, an inferred value is not called an estimate, or a holding rests on neither the paper estimate nor the profile |
  | `FIRM_STATEMENT` | A response, question or next step says something about the firm outside the approved claims (`terminology.json` `claimPhrases`) |
  | `ROLE_OVERSTATED` | Section 1 calls the role confirmed when no principal has confirmed it |

  A number that is in the inputs, but not in the inputs its item cites, is a warning.
- [x] One repair round, as the drafter has. A brief that still fails is saved as `not_usable`. Its Markdown opens with "NOT USABLE" and the reasons, before the brief itself. The command exits 1, and the web page shows the same. It is never shown as if fine.
- [x] Stored in the data folder: `calls/<accountId>/<date>-prep.json` (the record) and `.md` (to read).
- [ ] The paper estimate is read defensively until E14-S1 lands. The file is `paper/<key>.json`, or the same with the key's colon written as `-` or `_`, since a platform document path cannot hold a colon. A value is any object with a tier (reported, observed or inferred) and a value, or a low and a high. The tape request is a list under a key that starts `tapeRequest`. Align both with E14-S1 when it merges.
- [ ] The first live run, with a key, read against a call a principal has already had.

**E15-S2. Recording the call.** *As a principal, I want to paste my notes after a call and confirm what they say so that the outcome is on record and linked to the signals that started the account.* P0, R2. **Built.**
- [x] `outbound call log --account ID --date D --by NAME --notes FILE` (or `-` for stdin). The notes are saved to `calls/<id>/<date>-notes.md`, for principals only. Then a model call (`models.json` `callExtract`) turns them into a **proposal**. On the platform, saving is a quick action, and reading the notes is the job `call.extract`.
- [x] **Only a call that has happened is recorded.** A call date later than today (UTC) is refused when the notes are saved, and again at confirmation, since the guard stops on any meeting whatever its date. Call prep still takes a future date.
- [x] **A proposal matches its notes.** Each proposal keeps a digest of the notes it was read from. New notes for a date mark that date's pending proposals `superseded`, and a proposal whose notes no longer match cannot be confirmed.
- [x] The proposal holds:
  - outcome codes from a fixed list: `held`, `nda_requested`, `nda_signed`, `tape_promised`, `tape_received`, `not_selling_now` (with a when, if stated), `wrong_person` (with a referral, if any), `interested_later`, `pricing_discussed`, `declined`;
  - objections;
  - commitments: who (us, them, both or unclear) does what, and by when;
  - a follow-up date;
  - the people mentioned.
- [x] Code checks the proposal for the principal. Each code and objection carries a quote, which is looked for in the notes. Dates must be real dates. A missing `held` is flagged. The findings are shown; they do not block a principal.
- [x] **It is recorded nowhere until a principal confirms it.** Until then only the notes and the pending proposal exist. `outbound call confirm --account ID --proposal PID --by NAME`:
  - records a guard event of type `meeting`, which stops the automated sequence (the existing rule);
  - appends a line to `outcomes.jsonl`: the account, `institutionKey`, `originSignals` with their types, the first signal's date, the tier, the call date, the codes, counts and the confirmer;
  - adds the outcome, with its details, to the account (`outcomes`);
  - writes the follow-up checklist (E15-S3).
- [x] **A confirmation that stops partway is finished by running it again.** It is keyed to the proposal id: the outcome on the account and the line in `outcomes.jsonl` carry it as their id, and the meeting event carries `ref: call:<id>`. A rerun writes only what is missing, as the first run confirmed it, and never a second meeting or line. On the platform it is one transaction. The command line stages it in a unit of work over the folder and writes nothing until every step has run. It then writes the outcome on the account first, which locks the date. The proposal is written last, so it reads pending until the rest is written. Meanwhile it cannot be rejected, and `call list` marks it unfinished.
- [x] One confirmed outcome per call date. A confirmed or rejected proposal cannot be confirmed. A confirmed call's notes are not replaced. `outbound call reject` and `outbound call list` complete the set.
- [x] **People named in the notes are never added automatically.** They stay on the proposal and the outcome as "unconfirmed, from call notes". A principal adds one through `account set-person`, then `account confirm-role` (E7).
- [x] Logs carry counts only. Audit lines and job results hold codes, counts and ids, never a name or note text. The outcome line holds no name either. A test checks both.
- [ ] A principal can correct a proposal before confirming it. Today they reject it and log the notes again.
- [ ] A meeting recorded by hand (`guard event --type meeting`) has no outcome, so the report does not count it.

**E15-S3. The follow-up.** *As a principal, I want what was agreed on the call turned into a follow-up so that nothing promised is forgotten.* P1, R2. **Built as a checklist. The email is deferred.**
- [x] On confirmation, a checklist is written to `calls/<id>/<date>-followup.md` and `.json`, and shown on the account page. Its facts are only what was agreed:
  - each commitment, with who and by when;
  - the follow-up date;
  - the approved claim that matches, word for word: `nda-first` when they asked for a confidentiality agreement, `no-obligation` when pricing came up;
  - the paper estimate's tape-request list, when a tape was promised.
- [x] It shows the guard's view: the hard stops (an opt-out, a suppression, a bounce, the kill switch), and that the sequence is over. Nothing is drafted or sent.
- [ ] **The follow-up email is deferred.** The drafter cannot take a post-call context without changing its rules:
  - The guard ends the sequence on a meeting (`SEQUENCE_STOPPED`). `runDrafter` refuses before any model call, and `approveDraft` refuses too. A post-call email would need a new exception to the stop rule.
  - The drafter writes only from the briefer's cleared facts, and every personal line must cite one. What was agreed on a call is not one.
  - Its steps come from `config.sequence`. A follow-up is not a step.

  So the principal writes the follow-up from their own mailbox, with the checklist. A test proves the stop rule still holds after a call.
- [ ] **A decision for a principal.** The guard has no record type for a principal's own message after a meeting. Recorded with `guard record`, it is logged with the violation `SEQUENCE_STOPPED`. That is right for the sequence, but it reads as a broken rule. One option: a `correspondence` record that the guard logs outside the sequence, still under the kill switch, suppression and opt-out. A post-call email could then go through the drafter with the agreed facts as its only facts. Not built.

**E15-S4. What led to conversations.** *As a principal, I want to see which signals led to conversations, confidentiality agreements and tapes so that the score can be tuned on outcomes, not guesses.* P1, R2. **Built.**
- [x] `outbound outcomes report [--since D]`. Deterministic, with no model. It reads confirmed outcomes only (`outcomes.jsonl`). `--since` chooses which calls are counted. An account's first signal and first held call still come from all its confirmed calls, so the window never moves its lead time.
- [x] For each group it counts the accounts, the confirmed calls, and the accounts that reached each outcome code:
  - by the signal types in `originSignals`. An account started by several types counts once under each. An account picked by hand has its own row.
  - by tier;
  - by lead time, from the account's first signal date to its first `held` call, in buckets set in `config.json` (placeholders: 30, 90, 180 and 365 days).
- [x] Written to `reports/outcomes-<date>.json`, and printed.
- [x] With fewer than `config.outcomes.minToTune` confirmed outcomes (placeholder: 30), it says the counts are too few to tune weights on.
- [x] **It never changes weights.** A test checks that it writes only its report, and that `scoring.json` is unchanged.
- [ ] A principal sets `minToTune` and the buckets.

**Plumbing.**
- [x] Migration `20261114120000_jobs_calls.sql` adds `call.prep` and `call.extract` to `jobs_kind_check`, with every earlier kind. `test/db.test.mjs` runs it on Postgres 16, and `test/postgrest-fake.mjs` knows the kinds. A test checks that the newest migration lists exactly the worker's kinds.
- [x] Units of work (`src/uow.mjs`, `LOADS`): `callPrep`, `callNotes`, `callExtract`, `callConfirm` and `outcomes`, each narrowed to one account's folders. `callConfirm` also reads `outcomes.jsonl`, to finish an interrupted confirmation without a second line.
- [x] **Web**, on the account page, through `web/lib/ops.mjs` and the principal's session:
  - the latest call brief, marked NOT USABLE with its reasons when a check failed;
  - a form to paste notes, which saves them as the principal and queues `call.extract`;
  - each pending proposal, with confirm and reject;
  - the confirmed outcomes, and the follow-up checklist.
- [x] `test/calls-handoff.test.mjs` proves, end to end, that the research and the paper estimate never reach the drafter, and that the follow-up carries only what was agreed.
- [ ] The outcomes report on the web (the Status screen). The command line has it.

### E16. Who sells to whom

**Why.** A lender that has sold loans before is the warmest prospect there is. The known buyers show who the firm competes with. Completed sales give price evidence. Today those facts are spread over four sources, or not kept at all: a CMBS loan that is liquidated drops out of the next month's report.

**The design, in one paragraph.** One **sale ledger**, `sales/ledger.json` in the data folder, holds every sale event any source shows. Each event has a stable id, so a rebuild never counts one twice. `outbound sales build` rebuilds it from stored data only; nothing in the build fetches. The CMBS run and the FDIC loan-sale run rebuild it when they finish. Each source is a **feeder**: a function from stored records to events. Later sources plug in as feeders, and two of them already have their event shape. The ledger answers three questions for a principal: who has sold, who has bought, and at what recovery. It never answers them in a message.

**The event.** Built in `src/sales.mjs`; `validateEvent` checks each one before it enters the ledger.
- `id`, `kind` and `date` (YYYY-MM-DD).
- `seller` and `buyer`: `{ kind, key?, name }`. The kinds are `bank` (key `fdic:CERT`), `servicer` (key `servicer:<slug>`), `trust` (key `cmbs-trust:CIK`), `fdic` (key `fdic-receiver`), `other` (a named party that is none of these, such as a fund that took an assignment), and `unknown`. A CMBS trust's seller carries `via`: the special servicer that acted for it.
- `asset`: `{ kind: loan | pool | bank | unknown, propertyType, metro or county, balance }`, in dollars, with `balanceBasis` saying where the balance came from.
- `priceEvidence` (CMBS only, optional).
- `tier`: `reported` (the seller or a regulator reported it) or `observed` (built from a record we can see), as in `docs/paper-estimate.md`, section 3.
- `sources`: `[{ source, ids, link, date }]`.
- `firstSeenAt`, `supported`, and a `_source` block for the build.

**Rules.**
- No invented facts. A buyer no source names is `unknown`, and the check refuses an event that names one for a kind whose sources never do. Only a whole-bank deal and a recorded assignment can name a buyer.
- An implied recovery is labelled approximate and carries `isPrice: false`. The check refuses one without the label.
- Property names and addresses are kept in the ledger for a principal. They never go in the run log. In the change log, a change to them is recorded by field name only.
- Every event is context for a principal only. A test proves no event, signal, label, party, property, price or source reaches the drafter.

**E16-S1. CMBS completed dispositions.** *As a principal, I want every CMBS loan in our metros and sectors that is liquidated recorded as a sale, with its servicer and its loss, so that I know which special servicers sell and at what recovery.* P1, R2. **Built** (`src/sources/edgar.mjs`, `sources/edgar/dispositions.json`).
- [x] The adapter stores, on each loan: `liquidationPrepaymentCode` (item 2(i)(1), with the schema's 11 meanings), `liquidationPrepaymentDate`, `realizedLossToTrustAmount`, the full `workoutStrategyCode` list (the schema lets it repeat; the old parser kept only the last), `originatorName`, `originationDate`, `originalLoanAmount`, `originalTermLoanNumber`, and `reportPeriodBeginningScheduleLoanBalanceAmount`.
- [x] A field check counts how many kept loans lack each of these optional fields (`state.json` `fieldCoverage`, and the run log's `nullCounts`). A value that is present but malformed is a run note.
- [x] Each loan keeps a **workout history**: every code it has shown, with the first period seen, carried from run to run.
- [x] A curtailment (codes 1, 10 and 11) is a partial payment. The loan keeps its signals. Before, any liquidation code silenced them.
- [x] A kept loan whose report shows code **3** (disposition) or **6** (DPO) is written to `dispositions.json` and kept for good. The loan leaves the next report, so the month that carries the code is the only chance to see it.
- [x] Kind: `note_sale_completed` if workout code 5 (note sale) is in the loan's history or current report; else `dpo` for code 6; else `disposition`. A disposition may be an REO sale or a foreclosure, and the event says so.
- [x] Seller: the trust, through its special servicer, by firm name. Buyer: unknown.
- [x] Price evidence: the balance before liquidation, the realized loss, and an implied recovery = 1 − loss ÷ balance.
  - The balance is the report's beginning scheduled balance: the realized loss is defined against it (item 2(h)). Without it, the previous report's ending balance is used, and the event says which.
  - The magnitude of the loss is used, because filers differ on its sign; a negative figure is flagged. A missing loss or balance gives no value, with the reason. A zero loss gives 1, and says so.
  - Labelled approximate: the loss is net of liquidation expenses and can include advances. It is never shown as the price.
- [ ] Check live, on a few trusts, how often each field is filled, and which sign filers use for the loss. The coverage counts are in each run's state. *(Not run yet: the live SEC request was not permitted in the session that built this.)*

**E16-S2. FDIC loan-sale announcements.** *As a principal, I want each FDIC loan sale recorded, with its dates, the failed banks behind it and the pools, so that I see the FDIC's sales as they are announced.* P1, R2. **Built** (`src/sources/fdicsales.mjs`, `outbound sources run fdicsales`, worker job `sources.fdicsales`).
- [x] **Checked live on 2026-11-14** (nine requests to www.fdic.gov, a few a minute at most):
  - `robots.txt` allows `/asset-sales/` and sets `Crawl-delay: 1`.
  - The loan-sales page lists the current sales under "Loan Sales Event(s)". Each links a sale page under `/asset-sales/events/`.
  - A sale page has an Event Date field, a Key Dates table (row labels vary), a sentence naming the receivership with the loan count and UPB, portfolio paragraphs, the loan-sale advisor's firm name, and then named contacts with phone numbers and email addresses.
  - The announcement PDF is FlateDecode text in simple fonts. Node's zlib reads it, with no new dependency. Its first lines give the announcement date, which the page does not.
- [x] **Results and buyers: not published where we can read them.** The loan-sales page links "FDIC Closed Loan Sales" (January 2010 on), an application on `sales.fdic.gov`. This environment's network refused that host. `/asset-sales/historical-sales` links the same application and lists no results itself. So only announcements are recorded, and every buyer is unknown.
- [x] Per sale: the id and name, the event and key dates (due diligence, calculation date, bid deadline, closing), the receiverships, the loan count and UPB, the portfolio and pool sentences, the data's as-of date, the advisor's firm name, and the PDF link. The announcement date comes from the PDF when its text can be read; a PDF that cannot be read is kept as a link only.
- [x] Each receivership is matched to `sources/fdic/failed.json` by name (legal suffixes ignored) and state, and by city when two banks share a name. Two candidates leave it unmatched, with both listed. Nothing is guessed.
- [x] **Gentle.** `robots.txt` is read first, and only paths it allows are read; a `robots.txt` that cannot be read stops the run. Requests are at least `config.fdic.minIntervalMs` apart (placeholder 20 seconds, so three a minute), or the Crawl-delay if longer. At most `maxEvents` sale pages a run. A PDF is read once, when it is new or its link changes.
- [x] `config.fdic.userAgent` is a placeholder; the run refuses while it is one, and refuses an email address at a personal domain.
- [x] The contacts block is cut off before anything is parsed. A test proves no person, phone number or email address is stored.
- [x] E2: a fake shaped like the real pages (`test/fdicsales-fake.mjs`), the run log, a field check (a sale page without its id, dates or receivership fails the run and writes nothing), the change log, and `outbound sources verify fdicsales` (fresh, every listed sale stored, every record sourced and free of contacts).
- [ ] Ask whether the closed-sales application may be read, and whether it names buyers (D-S1). If it does, results become events with the buyer named.

**E16-S3. Sales banks disclose to the SEC.** *As a principal, I want a bank's filing that reports a completed sale or disposition recorded as a sale so that a bank that sells is on the "has sold" list.* P1, R2. **Built**, from the stored records of the filings listener (E13-S1), read only.
- [x] Each hit of `8k-acquisition` (Item 2.01), `loan-sale-cre` or `note-sale-cre` on a confirmed filer becomes a `bank_disclosed_sale`. The list is `config.sales.filingSearches`, a placeholder.
- [x] Seller: the bank, by `fdic:CERT`. Buyer: unknown. Asset: unknown. No filing text is stored or fetched; the filing's link is kept for a principal.
- [x] An Item 2.01 hit can be the bank buying, not selling. The event says so.
- [x] When a filer mapping is rejected later, its events stay in the ledger, marked `supported: false`, and leave every view and signal. They come back if the mapping is confirmed again.

**E16-S4. Whole-bank acquisitions.** *As a principal, I want every acquisition of a bank with a presence in our metros recorded with its acquirer so that I know who buys here.* P1, R2. **Built**, from `sources/fdic/events.json` (E3-S6), read only.
- [x] Kinds in `config.sales.acquisitionKinds` (placeholder: merger, assisted merger, failure). An affiliate reorganization (224) is left out, as in `scoring.json`.
- [x] Seller: the target. When the target failed, the seller is the FDIC as its receiver. Buyer: the acquirer, by FDIC cert. **This is the one buyer list available today.**
- [x] The asset is the target bank, with its CRE at its last report (thousands of dollars, times 1,000).

**E16-S5. The ledger, its views and its signals.** *As a principal, I want the sale events in one place, with who has sold, who has bought and at what recovery, so that I can use them when choosing whom to approach.* P1, R2. **Built** (`src/sales.mjs`, `outbound sales ...`).
- [x] `outbound sales build`: the run log, the input field checks (a stored record without a required field fails the build and writes nothing), `validateEvent` on every event, the change log, and `outbound sales verify`.
- [x] `salesBySeller({ dir })`: for each seller, by the institution that acted, the count by kind, the latest date and the events. This is the **"has sold before"** list. An unknown seller is left out.
- [x] `knownBuyers({ dir })`: by buyer, counts by kind, property type, metro and quarter.
- [x] `priceEvidence({ dir })`: CMBS liquidations by property type and metro, with the approximate implied recovery, 1 − Σ loss ÷ Σ balance over the events that have both, and the range. Labelled.
- [x] `saleSignals({ dir })`: **event** signals by institution key (`fdic:CERT` or `servicer:<slug>`), shaped like `filingSignals`. Each is `{ id, kind: 'event', type: 'sale', source: 'sales', key, role: 'seller', saleKind, tier, date, period, label, link, evidence, firstSeenAt }`. Labels come from fixed templates, with no names. The FDIC as receiver and a CMBS trust get none: they are not institutions we approach.
- [x] CLI: `outbound sales list [--seller KEY] [--kind K]`, `sales sellers`, `sales buyers`, `sales pricing`.
- [x] Worker: `sources.fdicsales` is in `JOB_KINDS` and the worker; `sources.edgar` and `sources.fdicsales` rebuild the ledger in the same unit of work (`LOADS.sales`).
- [ ] The job-kind migration for `sources.fdicsales`, added when this is merged.
- [ ] Wire `saleSignals` into scoring (`src/score.mjs`), after merge. A principal decides whether "has sold before" adds points, and on which axis.
- [ ] A line in the worker workflow's schedule for `sources.fdicsales`, once the migration and the FDIC contact are in place.

**E16-S6. The Sales screen.** *As a principal, I want a Sales page so that I can read the ledger without the command line.* P1, R2. **Built** (`web/app/sales/page.jsx`, `web/lib/sales-view.mjs`).
- [x] Server-rendered from the stored ledger, in the existing style, and linked in the nav. It shows recent events, the sellers who have sold (linked to the bank's candidate page or the servicer's page), the known buyers, and the price evidence under the approximate label.

**E16-S7. Recorded assignments of deeds of trust** (county records). *As a principal, I want each recorded assignment of a commercial deed of trust in our counties recorded as a sale, with the chain to the current holder, so that I see which lenders sell loans and who buys them.* P1, R3.
- [x] **The shape, with no adapter:** `assignmentEvent` in `src/sales.mjs`. Assignor, assignee, the original deed of trust (recording number, date, original principal, beneficiary), the APN, the recording date, and the chain. Tier `observed`. A test proves the ledger accepts it.
- [x] **MERS** is a nominee, never a party. "MERS as nominee for X" resolves to X; MERS with no lender named resolves to unknown. The event check refuses MERS as a seller or buyer.
- [x] **The chain to the current holder** (`chainToCurrentHolder`): oldest assignment first, from the deed's beneficiary. An assignor who is not the holder so far marks a gap. An assignment to MERS with no lender named leaves the holder as it was, marked uncertain. The holder is certain only when every step is known.
- [ ] The feeder, on the Maricopa Recorder's bulk feed (code AS, `docs/county-playbook.md`) or ATTOM, once the account or trial exists. Names matched to `fdic:CERT` by E6-S1, never guessed.
- [ ] Commercial only, joined on the APN to the assessor's file.

**E16-S8. Loan-sale listings.** *As a principal, I want loans and pools listed for sale in our metros recorded so that I see the supply, and who sells it when the listing says.* P2, R3.
- [x] **The shape, with no adapter:** `listingEvent`. Site, listing id, date, title, advisor, property type, metro or county, balance, loan count, status, lien and bid date. The seller is usually unknown; the buyer is always unknown. Tier `observed`. A test proves the ledger accepts it.
- [ ] The feeders, for listing sites and loan-sale advisors' sale notices, once a principal has read each site's terms (data-sources 2.3).

**Decisions for a principal.**

| # | Decision | Default |
|---|---|---|
| D-S1 | May we read the FDIC's closed-sales application (`sales.fdic.gov`) for results and buyers? Its terms and its contents are unchecked. | Announcements only |
| D-S2 | Does "has sold before" add points, on which axis, and for how long? | Signals only, no points (as for filings) |
| D-S3 | Which filing searches count as a disclosed sale (`config.sales.filingSearches`)? An Item 2.01 hit may be a purchase. | Item 2.01, loan sale, note sale |
| D-S4 | Do whole-bank acquisitions after a failure belong in the buyer list beside ordinary mergers? | Yes, with the FDIC as seller |
| D-S5 | Show the implied recovery to principals at all? It is not a price, and could anchor a bid. | Shown, labelled approximate, by group and per loan |
| D-S6 | The FDIC request contact (`config.fdic.userAgent`): the firm's name and a monitored business address | Placeholder: the run refuses |

### E17. Routes to the decision-maker

**Why.** For each target, the firm wants to know who actually decides on loan sales, then the best way in. A warm route gets a much better reply rate than a cold email (plan section 4: "Introductions first"). E7-S1 already finds who decides: the briefer brings back sourced candidates, and a principal names one and confirms the role. This epic finds the ways in:

| Route | What it is | Where the lender side comes from |
|---|---|---|
| **direct** | The named or candidate person | The account and the briefer's `bank.people` findings (E7-S1) |
| **counsel** | The lender's own law firm | `bank.counsel` findings, and county foreclosure filings that name the lender's counsel (shape only; no adapter yet) |
| **advisor** | A loan-sale advisor or broker the lender has used | `bank.advisors` findings, and the sale ledger's named parties where the lender sold (E16) |
| **board** | A director or officer who connects to someone in the firm's network | `bank.board` and `bank.people` findings |
| **forum** | A shared industry forum or association roster (CREFC, state bankers' associations, RMA, conference speaker lists) | `bank.memberships` findings |

**Status: built** (stories S1, S2 and S4 to S7, and the shape and seam of S3), tested on invented data only. The county feeder, the first live research run, and every decision below are open.

**The design, in one paragraph.** The firm's own relationships (people the principals know, firms they work with, associations they belong to) are kept in a private **network**, `network/network.json` in the data folder, entered by a principal. The briefer researches the lender side with four new playbook topics and returns sourced findings, each naming the people, firms and associations its quote names. Then `buildRoutes`, in code with no model, matches the lender side against the network by normalized names and organizations, and writes a ranked list of routes for one account to `routes/<accountId>.json` and `.md`. Each route has its type, its target, its bridge (who in the network connects), its evidence (finding ids with URLs, ledger event ids, county record ids and network entry ids), a tier and one fixed-template line of reasoning. A principal chooses a route; the choice gives them a checklist. **Matching happens in code, so no model ever sees the firm's network.**

**Rules.**
- **No invented facts.** No match means no route. A lender-side name is used only if it appears in a quote that was checked against the retrieved text.
- **The direct route is always listed,** with its status from the existing prerequisites: a person named, the role confirmed, the address verified.
- **A route relaxes no guard rule.** Nothing is drafted or sent to a network contact or an intermediary. A chosen warm route gives a principal a checklist only (who to ask, what evidence to cite), like the follow-up checklist of E15-S3. The plan's referral mapper (agent 7) drafts the ask to the connector; this epic does not (D-R7).
- **The network is private.** It lives in the data folder (and the platform) only, never in the repository. It never reaches the briefer or the drafter. Audit lines carry ids only, never a name from the network.
- **No scraping.** Nothing here reads LinkedIn, or any page that needs a login or bypasses bot protection or robots.txt. The lender side comes only from the briefer's sourced research and stored data.
- Prospect data, network data and routes are context for a principal only.

**E17-S1. The firm's network.** *As a principal, I want to record the people we know, the firms we work with and the associations we belong to, so that the system can find warm routes without anyone keeping them in their head.* P1, R2. **Built** (`src/network.mjs`, `outbound network ...`, the `/network` page).
- [x] Kept in the data folder only, in one document, `network/network.json`: people (name, organization, title, relationship, which principal knows them, whether they agreed to be asked for introductions), firms (name, kind: law, advisor, broker or other; relationship; who knows them) and memberships (association, which principal belongs, role). Each entry has an id that carries no name (`np-1`, `nf-2`, `nm-3`) and optional aliases for matching.
- [x] `outbound network add-person|add-firm|add-membership|list|remove`, each with `--by`. A duplicate (the same normalized name and organization) is refused, naming the existing id.
- [x] **Names and relationships only.** An entry that holds an email address or a phone number is refused: nothing here contacts anyone.
- [x] Every change and every listing writes an audit line with ids, kinds and counts, and the principal who acted (`by`, as in every audit line). Never a name from the network.
- [x] **Removing an entry removes it everywhere routes stored it.** Every `routes/<id>.json` and `.md` is rewritten without the routes it bridged; a choice that used it is removed, and the file says a choice was removed.
- [x] **A deletion request reaches the network and the routes (E7-S3).** If the firm knows the forgotten person, their entry is removed the same way: their name at their institution, or their address or phone if an entry ever held one. A routes file that names them is rebuilt from the scrubbed research. Both are in `LOADS.forget`, and the `person_forgotten` line counts them.
- [x] A test proves no network name reaches an audit line, a job, or the repository.

**E17-S2. The lender side, researched with sources.** *As a principal, I want the briefer to find the bank's directors and officers, its outside counsel, the advisors it has used and the associations it belongs to, each with a source, so that routes rest on evidence.* P1, R2. **Built** (`playbooks.json`, `docs/research-agenda.md`, `src/research.mjs`). Not yet run live.
- [x] Four playbook questions, in `playbooks.json` and `docs/research-agenda.md`: `bank.board`, `bank.counsel`, `bank.advisors` and `bank.memberships`. They replace `bank.access`.
- [x] Findings keep the existing format, with tiers and sources. Each also lists the **entities** its quote names: type (person, firm or association), name, affiliation and role. Code keeps an entity only if its name appears in the quote, and an affiliation only if it does too.
- [x] **These four topics are context only.** A finding under them is never cleared for a message, whatever the model proposes. Who connects to a bank is for a principal choosing a way in.
- [x] `bank.advisors` says that an FDIC loan sale's advisor works for the FDIC as receiver, not for a bank.
- [x] Public pages only: never a members-only directory, or an attendee list that needs a login.
- [x] `src/research.mjs` changes only as much as this needs, and every existing research test passes unchanged.

**E17-S3. County-record counsel: the shape and the seam.** *As a principal, I want the law firm a county foreclosure filing names for the lender recorded, so that the lender's own counsel is a route.* P1, R3. **The shape and the seam are built** (`src/routes.mjs`); the feeder is not.
- [x] **The shape, with no adapter:** `counselEvent` in `src/routes.mjs`. County, document number and type, recording date, the lender (MERS resolved as in E16-S7), the lender's counsel (the firm and the attorneys named), the trustee, the APN, the source and link. Tier `observed`. `validateCounselEvent` checks each event.
- [x] **The seam:** `buildRoutes` takes `counselFeeders`, each a function from stored records to events, as `buildLedger` takes `feeders`. None is wired in. A test proves an event from a fake feeder becomes a counsel route, and an invalid one fails the build and writes nothing.
- [x] A filing names a particular property and borrower, so it is asset-specific: a route cites its document number and link only, and the checklist says never to mention the property.
- [ ] The feeder, on a county recorder's feed or a vendor, after the E5 spike. Names matched to `fdic:CERT` by E6-S1, never guessed.

**E17-S4. Matching and ranking.** *As a principal, I want every route to an account found and ranked the same way every time, with its evidence, so that I can trust the list and argue with it.* P1, R2. **Built** (`src/routes.mjs`, `routes.json`, `outbound routes build|show`).
- [x] `buildRoutes({ dir, id, rules })` (`src/routes.mjs`): code only, no model, deterministic. The same inputs give the same routes, ids and order.
- [x] **Lender side:** the account's research (`research/<id>.json`); the sale ledger's named parties where the bank was the seller (a listing's advisor), plus the FDIC's loan-sale advisor when the bank is a failed bank whose loans the FDIC sells, **labelled a route into the FDIC's sale, not into the bank**; and county counsel events from the seam.
- [x] **Matching**, on normalized names: lowercase, "&" read as "and", punctuation dropped; legal suffixes (LLP, LLC, Inc., N.A. and the like) and a leading "the" dropped from firm names; honorifics and suffixes dropped from a person's name, then the first and last words only, so a middle name or initial does not matter. Equality only, on the name or an alias. No fuzzy matching.
  - A person: by name. Corroborated when the network entry's organization is the lender or the person's affiliation in the source; otherwise **same name only**, which is inferred. Only people from officer, board, counsel and advisor findings are matched this way.
  - A firm: by name, against a network firm or a network person's organization.
  - An association: by name, against a principal's membership.
  - A colleague: a network person at the lender-side person's firm. Inferred.
  - **A membership finding** (`bank.memberships`): its people are only ever forum targets, never a board route. A speaker list says nothing about who is a director or officer.
    - A finding that names more than one association gives no forum route. A flat list of entities cannot say who appears with which ("the bank belongs to A; its officer spoke at B").
    - A forum route's person targets are the bank's own people: their affiliation is the bank, or none is given. A finding whose people are all from elsewhere gives no route. One that names no one lists the bank itself.
    - Both are counted under "Left out" (`multiAssociation`, `peopleElsewhere`).
    - The fuller fix: link each person to an association in the research output. That is not built (`src/research.mjs` is unchanged).
- [x] **Tier**, as in `docs/paper-estimate.md` section 3: the weakest of the evidence and the match. A government, regulator or company source is reported; press is observed; other is inferred (placeholders in `routes.json`). A support check that did not say "yes", a same-name match and a colleague are inferred.
- [x] **Only checked evidence.** A finding whose quote could not be checked against retrieved text, and that no second source corroborates, is not used. It is counted.
- [x] **Current or not:** evidence older than `routes.json` `currency.maxAgeDays` for its route type (placeholders) marks the route not current. An undated page counts from the research run.
- [x] **Held, never ranked:** a route whose bridge or target is on the suppression list (a person or an institution entry), or whose bridge has not agreed to be asked when `consent.required` is on. A contact who said no is never a route; they are counted.
- [x] **The order comes from `routes.json`** (placeholders): route type, then tier, then current before not, then the amount of evidence, then the id.
- [x] Written to `routes/<accountId>.json` and `.md`. A rebuild keeps a choice whose route still exists, and marks one whose route is gone.
- [x] `outbound routes build --account ID` and `outbound routes show --account ID [--json]`.
- [ ] **Known limits of matching**, for a principal to work around with aliases: a nickname ("Bob" for "Robert"), a maiden or married name, a renamed or merged firm, an acronym with no alias ("CREFC" for "CRE Finance Council"), and a name the quote abbreviates ("Ms. Doe" for "Jane Doe") do not match. Two different people with the same first and last name do match, as inferred and labelled "same name only". A finding from research run before E17-S2 names no entities, so it gives no route until the account is researched again; it is counted.
- [ ] The first live research run with the four topics, read against what the principals know (the E1 pilot), before any route is trusted.

**E17-S5. The direct route, always.** *As a principal, I want the direct route shown with what it still needs, so that I know whether it is ready.* P1, R2. **Built.**
- [x] Listed first or last as the order says, whatever else is found. Its target is the named person, or the candidates from the research when nobody is named.
- [x] **Its evidence is the bank's own people findings only**: topics mapped to `officer`, which is `bank.people`, as for the candidates. A speaker list, a court filing or an advisor's page that names the person does not make the direct route reported or current.
- [x] Its status, from the existing prerequisites: a person named, the role confirmed (and by whom), the address verified.
  - **The address is read by the guard's own rule**, `emailCheck` in `src/guard.mjs` (E7-S3). It is verified only when there is a verification record for the current address, no older than `contacts.json` `reverifyDays`, and the address has a source of its own. A nested status the guard does not read counts for nothing.
  - The status carries the rule's state (unverified, expired, verified for another address, unsourced, verified) and the guard's codes for what is missing (`EMAIL_UNVERIFIED`, `EMAIL_UNSOURCED`).
  - Tests: an expired verification, a verification for an old address, an unsourced address and a nested status each show as not verified. The guard refuses each of them.
- [x] The guard's view: the hard stops (an opt-out at the bank, a suppression, a bounce, the kill switch) and whether the bank is already in conversation. Shown, never overridden.

**E17-S6. Choosing a route: a checklist, not a message.** *As a principal, I want to record which route I will take and get a checklist, so that I ask the right person with the right evidence.* P1, R2. **Built** (`outbound routes choose`).
- [x] `outbound routes choose --account ID --route RID --by NAME` records the choice, with an audit line (account, route id and type, who). It writes the checklist into the routes file and its Markdown.
- [x] **The checklist:** who to ask (the bridge, their relationship, which principal knows them, whether they agreed to be asked); whom it reaches; the evidence to cite, with links; what never to mention (an asset-specific record's property or borrower); the guard's view; and what comes after an introduction: the person is named with `account set-person`, the role confirmed and the address verified, then the drafter and the guard as for any account.
- [x] **Every command a checklist names works as written**, once its capitals are filled in. Naming a person needs a source (E7-S3).
  - The direct route names a candidate with `--finding ID` and lists each candidate's own finding.
  - After an introduction, the person is named with `--source correspondence`.
  - The address steps give `set-email` with a source, then `verify-email`.
- [x] **Choosing the direct route rebuilds it** from the account, its research and the guard as they are now, and stores it in place of the old one. Its target and prerequisites change without a build, so the checklist never says a person is ready because they were at the last build.
- [x] **A route relaxes no guard rule.** Choosing is refused when the bank has an opt-out or is suppressed: an introduction must not go around either. Choosing changes no account, drafts nothing, queues nothing and records no touch, and the guard's verdict for the account is the same before and after. A test proves it.
- [x] Choosing a held route is refused, with the reason.
- [x] Choosing checks the stored route again against the network and the suppression list as they are now: a contact who has since said no, an entry that is gone, or a party suppressed since the build refuses the choice.

**E17-S7. The screens.** *As a principal, I want the routes on the account page and the network on its own page, so that I can work both from a browser.* P1, R2. **Built** (`web/app/accounts/[id]/routes.jsx`, `web/app/network/`, `web/lib/routes-ops.mjs`). Tested against the fake Supabase API, not yet against a real project (E12-S7).
- [x] **Account page:** a routes section in its own component (`web/app/accounts/[id]/routes.jsx`), added to the page with one import and one element. It shows the direct route's status, the ranked routes with their tier, bridge, reasoning and evidence links, the held routes, a build button and a choose button, and the chosen route's checklist.
- [x] **Network page** (`/network`): the people, firms and memberships, with forms to add each and a button to remove each, and how many chosen routes use each entry. Viewing it writes an audit line.
- [x] Both run the engine's own functions in a unit of work as the signed-in principal. Building routes is code, so it runs there, not as a job.

**Plumbing.**
- [x] `LOADS` in `src/uow.mjs`: `routes` (the guard's four files, the account, its research, `sales/ledger.json`, `network/` and its own routes file, narrowed to one account by `routesLoads`) and `network` (`network/`, and `routes/`, which removal rewrites).
- [x] No new job kind: both run inside units of work from the command line and the web.
- [x] **Handoff tests:** `network/` and `routes/` are in neither `LOADS.draft` nor `LOADS.research`, and no drafter or briefer code reads them. End to end, with a network, research and a chosen route in the data folder, the drafter's input and the briefer's prompt carry no network name, route id or bridge. `test/private-stores-handoff.test.mjs` adds `contacts/` and call prep: none of the three private stores is in any model-facing load list, and with all three in one data folder, neither the briefer's prompt, the drafter's input nor call prep's prompt carries any of them.
- [x] `LOADS.forget` includes `routes/` and `network/` (E7-S3), with the guard's files and the sale ledger for the rebuild.
- [x] **Review findings (PR #8)**, each fixed with a test in `test/routes.test.mjs`:
  - the address read by the guard's rule (E17-S5);
  - a membership finding's people as forum targets only;
  - one association per finding, and only the bank's own people (E17-S4);
  - the direct route's evidence limited to `bank.people` (E17-S5);
  - the direct route rebuilt when chosen (E17-S6).
- [x] `test/repo.test.mjs`: the data-folder rule covers `network/` and `routes/`.
- [x] The README describes it.

**Decisions for a principal.**

| # | Decision | Default |
|---|---|---|
| D-R1 | The route order (`routes.json` `order.types`) | Board, counsel, advisor, forum, then direct (a placeholder) |
| D-R2 | Must a network contact have agreed to be asked for introductions before a route through them is listed? (`consent.required`) | No: the consent state is shown and the checklist says to ask first. A contact who said no is never a route. |
| D-R3 | How long a finding stays current (`currency.maxAgeDays`) | Board, forum and direct 365 days; counsel and advisor 730; from the page's date, or the research run's when the page is undated (placeholders) |
| D-R4 | Buy a contact database? It ties to E7-S2, the vendor test being built: no vendor until it passes on 50 people we know. A vendor's data would feed the lender side only, never the network, and only under a license that allows it (research agenda B8). | No |
| D-R5 | Same-name matches for people, with no shared organization: show them as inferred, or drop them? (`matching.personNameOnly`) | Shown, inferred, labelled "same name only" |
| D-R6 | A known buyer of the bank's loans (E16) who is in the network: a route? It is not one of the five. | Not a route |
| D-R7 | Draft the ask to the connector, as the plan's agent 7 would? | No: a checklist only |
| D-R8 | Cap asks per connector (plan section 4) | No cap in code; the network page shows how many chosen routes use each entry |
| D-R9 | Import the principals' contact exports (the plan's referral mapper, with their consent) | Entered by hand only |

## 9. Definition of done (every story)

- Node 22 with ES modules, in this repository. Any new dependency comes with a stated reason in the PR.
- `npm test` passes with no network and no key. Adapters are tested against recorded responses that contain only invented or public data.
- No prospect data in the repository, PRs, issues, workflow logs or artifacts (plan section 7).
- Every number a person sees carries its source.
- Every placeholder is marked as one. Nothing is presented as researched that wasn't.
- The README and this PRD are updated when behavior changes.

## 10. Success metrics

**Leading (system; targets set now):**

| Metric | Target | How measured |
|---|---|---|
| Coverage | 100% of banks with a branch in the six metros scored on the latest FDIC quarter | Candidates compared with the bank list, every run |
| Freshness | A new FDIC quarter scored within 7 days of publication | Date the new `REPDTE` was first seen, compared with the scoring run date |
| Silent failures | 0 runs that wrote data with a missing field | The field check (E2-S2) |
| Unsourced figures | 0 in cards, briefs and drafts | Code checks, plus a monthly sample read by a principal |
| Pilot fabrication | 0 across at least 10 reviewed briefs | E1-S3 scorecard |
| Review time | The weekly list cleared in 30 minutes or less | Principal's own report, weeks 1–4 |

**Lagging (market):** this market has no benchmark, so these get a baseline in the first 60 days and targets after that (plan section 10).

- Two-way conversations per month, by originating signal type and tier.
- NDAs, loan tapes, indicative prices, bids and closings, by originating signal.
- Tier A against Tier B conversion, which tests whether the score ranks well.
- Harm: opt-outs, complaints, bounce rate, and messages that should not have gone. The target for the last is 0.

## 11. Open questions

Q19 to Q27, for epics E17 to E21, are in `docs/prd-next-five.md`, section 4.

| # | Question | Who answers | Blocks | Default meanwhile |
|---|---|---|---|---|
| Q1 | The full buy box: size range, statuses, lien, exclusions. Are short-term rental portfolios in? | Principals | E6 thresholds (not E3 ingestion) | Placeholders; scoring refuses to run until filled |
| Q2 | Metro branch footprint only, or headquarters states as well? | Principals | E3-S1 | Both, headquarters-only banks by opt-in |
| Q3 | Sellers first: banks, servicers, or both? | Principals | Release order | Banks in R1, servicers in R2 |
| Q4 | Approve creates a Gmail draft, or sends directly? | Principals | E9 | Gmail draft |
| Q5 | Who sends, and how many hours a week do they have for replies and calls? | Principals | Caps | Existing caps |
| Q6 | Is there a CRM to sync to? | Principals | E8 scope | **Decided:** the platform is the system of record (Supabase); no CRM for now |
| Q7 | Is there an Anthropic API key for the pilot, a sending domain, and a principal named on the site? | Principals | E1, E9 | E1 waits for the key |
| Q8 | Budget for county and contact data | Principals | E5, E7 | Free sources only |
| Q9 | Can the firm stand behind "15-day close" or "all-cash"? | Principals, then counsel | New claims | Blocked |
| Q10 | More than one entity using this? | Principals | E8-S1 | **Decided:** principals of one firm only; no partner workspaces or outside customers |
| Q11 | Which contact name and email go in the SEC User-Agent? | Principals | E4 | E4 waits |
| Q12 | Is the buy box confidential (data folder) or a rule file (committed)? | Principals | none | Committed |
| Q13 | How is the weekly triage delivered to the principal? | Principals | E6-S5 | A file in the data folder, and the web app's This week page |
| Q14 | Which Supabase organization and project? Is the existing connection the firm's? | Principals | E8 | E8 waits |
| Q15 | Is the sending mailbox on Google Workspace, and can an administrator approve API access? | Principals | E9 | E9 waits |
| Q16 | Channel and state rules, privacy notice, deletion process (research agenda G1) | Counsel | R2 sending | Nothing sends before counsel |
| Q17 | Where does the Supabase project live? The only organization connected today ("Rivet") holds unrelated projects. | Principals | E12-S7 | A new organization and project for Valley Capital |
| Q18 | Which Vercel team hosts the app, and at what address? The only team connected today ("cartboost") belongs to another business. | Principals | E12-S7 | A new team for Valley Capital; a subdomain of the firm's domain |

## 12. Timeline and phasing

There are no hard external deadlines. If the principals want the **December 10, 2026** window, only Release 1 and the E1 pilot can be ready by then. Release 2 cannot.

| Release | Contents | Gate to start the next one |
|---|---|---|
| **R1 Know the banks** | E0-S1, E0-S2, E1, E2, E3, E6-S1 to S4, S6, S8, the FDIC part of S7, and E7-S1 (institution-first research). Command line only, FDIC data only. | E1 passes (zero fabrications on 10+ accounts); a principal has worked the candidate list for 2 weeks |
| **R2 Review and send from my mailbox** | E4 spike (then build if approved), E5-S1 spike, E6-S5, E8, E9-S1 to S3, E11, E0-S3 | Sending domain authenticated and warmed; a principal named on the site; counsel's answers on G1 |
| **R3 More signals, more people** | E5-S2 and S3, E7, E9-S4, E10, the remaining P1 stories | Plan section 12, step 4: a clean audit before anything moves past a person approving each touch |

Dependencies outside the code: the principals (Q1–Q15), counsel (Q16), the website (plan section 9: live, indexable, a named principal, a phone number and a street address), and the sending domain's warm-up.

## Appendix A. FDIC fields used (verified November 13, 2026)

Base `https://api.fdic.gov/banks`. Titles are FDIC's own, from `risview_properties.yaml`, `institution_properties.yaml`, `location_properties.yaml` and `sod_properties.yaml`. Amounts are in thousands of dollars.

**Query rules:**

- Several values: `FIELD:("A" OR "B")` for text, `FIELD:(1 OR 2)` for codes. The comma form returns nothing.
- Ranges: `REPDTE:[20250101 TO 20251231]`.
- An unknown field name is dropped silently.
- `limit` up to 10,000 per page; page with `offset`.

**Institutions (`/institutions`):** `CERT` (FDIC Certificate #), `NAME`, `CITY`, `STALP` (state of the main office), `ASSET` (Total assets), `WEBADDR`, `ACTIVE` (1 = open and insured).

**Branches (`/locations`):** `CERT`, `CBSA_NO`, `CBSA`, `COUNTY`, `STCNTY` (state + county FIPS), `MAINOFF` (main office flag).

**Summary of Deposits (`/sod`):** `CERT`, `YEAR`, `DEPSUMBR` (domestic deposits, branch), `DEPSUM` (the bank's total deposits, repeated on each row; the base for metro share), `MSABR`, `CNTYNAMB`, `STCNTYBR`, `STALPBR`. `STCNTYBR` and `MSABR` arrive as **numbers**, so Denver's `08031` comes as `8031`. The county join zero-pads them to five digits.

**Failures (`/failures`):** `CERT`, `NAME`, `FAILDATE`, `RESTYPE`. Only `FAILURE` counts; `ASSISTANCE` does not.

**First live run (November 13, 2026):** 268 banks; 8 quarters, September 30, 2024 to June 30, 2026; SOD year 2026; 11,160 rows read; about 6 seconds; no missing fields; 24 fields with explicit nulls. A second run found no new quarter and 0 changes. 16 banks have branches in the metros but no SOD rows there.

**Financials (`/financials`):**

| Field | FDIC title | Used for |
|---|---|---|
| `REPDTE` | Report Date | Period key |
| `ASSET` | Total assets | Size filter |
| `CB` | Community Bank | Context |
| `LNLSNET` | LOANS AND LEASES-NET | Context |
| `NCLNLS` | TOTAL N/C-LOANS & LEASES | Context |
| `NALNLS` | NONACCRUAL-LOANS & LEASES | Context (the spec's `NAASSET` is total nonaccrual **assets**) |
| `P3ASSET`, `P9ASSET` | 30-89 / 90+ DAYS P/D-TOTAL ASSETS | Context |
| `LNRECONS` | RE CONSTRUCTION & LAND DEVELOP | Base |
| `LNRENRES` | RE NONFARM NONRESIDENTIAL PROP | Base |
| `LNRENROW` / `LNRENROT` | OWNER-OCC / OTHER NONFARM NONRES RE LNS | Investor share |
| `LNREMULT` | RE MULTIFAMILY | Base |
| `NCRECONS` | TOTAL N/C CONST REAL ESTATE CONSTRUCTION | Noncurrent ratio |
| `NCRENRES` | TOTAL N/C NONFARM NONRES RE | Noncurrent ratio |
| `NCRENROW` / `NCRENROT` | N/C OWN-OCCUPIED / OTHER NONFARM NONRES | Detail |
| `NCREMULT` | TOTAL N/C MULTIFAMLY RE | Noncurrent ratio |
| `NARECONS` | NONACCRUAL-RE*CONSTRUCTION | Nonaccrual ratio |
| `NARENRES` | NONACCRUAL-RE*NONFARM NONRES | Nonaccrual ratio |
| `NAREMULT` | NONACCRUAL-RE*MULTIFAMILY | Nonaccrual ratio |
| `P3RENRES` / `P3REMULT` | 30-89 DAYS P/D-RE*NONFARM NONRES / MULTIFAMILY | Early-stage delinquency |
| `P9RENRES` / `P9REMULT` | 90+ DAYS P/D-RE*NONFARM NONRES / MULTIFAMILY | Detail |
| `ORE` | OTHER REAL ESTATE OWNED | Context |
| `ORECONS` / `ORENRES` / `OREMULT` | ALL OTHER RE OWNED-CONST / NONFARM / MULTI | Commercial OREO |
| `NTLNLSQ` | TOTAL LN&LS NET CHARGE-OFFS QUARTERLY | Context (`NTLNLS` is year-to-date) |
| `NTRECONQ` | CONSTRUCTION RE LN NET-CHG-QTR | Quarterly CRE charge-offs |
| `NTRENRSQ` | NONFARM NONRES RE LN NET-CHG-QTR | Quarterly CRE charge-offs |
| `NTREMULQ` | MULTIFAMILY RE LN NET-CHG-QTR | Quarterly CRE charge-offs |

**Added for the paper estimate (E14-S1, checked live November 14, 2026).** Titles are FDIC's own. Details and live results are in `docs/paper-estimate.md` 4.2 and the comments in `src/sources/fdic.mjs`.

| Field | FDIC title | Used for |
|---|---|---|
| `P3RECONS` / `P9RECONS` | 30-89 / 90+ DAYS P/D-RE*CONSTRUCTION | Construction stages (now also in the paper profile) |
| `P3RENROW`, `P3RENROT`, `P9RENROW`, `P9RENROT`, `NARENROW`, `NARENROT` | 30-89 / 90+ / NONACCRUAL, OWN-OCC and OTHER NONFARM NONRES | Stages of owner-occupied and investor nonfarm nonresidential |
| `P3COMRE` | 30-89 DAYS P/D-COMMERCIAL RE | 30-89 stage of `LNCOMRE`, CRE not secured by real estate (see the field's comment) |
| `LNRENR1`–`LNRENR4`, `LNRENR1N`–`LNRENR4N` | RE NONFARM NONRES-UNDER 100 / 100-250 / 250-1M / UNDER 1M, $ and NUM | Loan sizes. **Semiannual:** June and December only |
| `LNRECNOT` / `LNRECNFM` | OTHER RE CONSTRUCTION & LAND LN / 1-4 FAM RE CONSTRUCTION LOANS | Construction split |
| `UCCOMRES` / `UCCOMREU` | UNUSED COMMIT-SECURED / UNSECURED COM RE | Unused CRE commitments, portfolio level |
| `RSCONS`, `RSMULT`, `RSNRES`, `RSOTHER`, `NARSNRES`, `RSLNLTOT` | RESTRUCTURED LN by type, NONACCR RESTRUCTURED NFNR LN, RESTRUCTURED LOANS - TOTAL | Restructured balances. **The split by type is semiannual in practice**; the total is quarterly |
| `LNLSSALE`, `NALNSALE`, `P9LNSALE`, `P3LNSALE` | LOANS & LEASES HELD FOR RESALE; NONACCRUAL / 90+ / 30-89 P/D-L&L HELD FOR SALE | Seller evidence |
| `NETGNSLN` / `NTGLLNQ` | NET G/L ON SALES OF LOANS (year to date) / QUARTERLY | Seller evidence, not CRE-specific |
| `LNOT3LES`, `LNOT3T12`, `LNOT1T3`, `LNOT3T5`, `LNOT5T15`, `LNOTOV15` | ALL OTHER LNS & LS * 3 MO OR LESS ... OVER 15 YRS | Maturity and repricing proxy, not CRE-specific |

## Appendix C. Release 1 build contract

Modules (each with its own tests under `test/`, no network, invented data only):

| Module | Stories | Does |
|---|---|---|
| `src/sources/http.mjs` | E2-S5 | A polite JSON client: timeouts, capped backoff on 429 and 5xx, an injectable `fetch` |
| `src/sources/runlog.mjs` | E2-S1, S3, S4 | Run log, the source block required on every record, and an update that logs changed values |
| `src/sources/fdic.mjs` | E2-S2, E3-S1, S2 | FDIC queries and paging, the field check, the bank list, footprint, financials, the new-quarter check, `runFdic` |
| `src/metrics.mjs` | E3-S3, S4 | Pure functions: Appendix A formulas per quarter, and signals from `scoring.json` rules |
| `src/score.mjs` | E0-S1, E6-S2 | Buy box and scoring config checks, hard filters, the score, tiers |
| `src/candidates.mjs` | E6-S1, S3, S4 | Candidate list, the "why now" card and its number check, promote, dismiss and snooze, suppression filtering |
| `src/pilot.mjs` | E1 | Truth sheets, finding review, the scorecard, the gate |
| `cli.mjs` | all | `sources run fdic`, `score run`, `candidates ...`, `pilot ...` |

Data folder layout (inside `OUTBOUND_DATA_DIR`, never the repository). Amounts are in thousands of dollars, as FDIC reports them. Ids are strings.

```
sources/runs.jsonl                  one line per run: { runId, source, query, startedAt, finishedAt, rowsRead, rowsWritten, rowsChanged, outcome: ok|suspect|failed, missingFields, errors }
sources/changes.jsonl               { runId, key, field, old, new, at }
sources/fdic/state.json             { latestRepdte, checkedAt }
sources/fdic/institutions.json      { "<CERT>": { CERT, NAME, CITY, STALP, ASSET, WEBADDR, ACTIVE, via: { branch, hq }, status: active|inactive|failed, _source } }
sources/fdic/footprint.json         { "<CERT>": { branchesByMetro: { "<cbsa>": n }, sod: { year, depositsByMetro: { "<cbsa>": n }, totalDeposits, metroShare } | null, _source } }
sources/fdic/financials/<CERT>.json { CERT, quarters: { "<REPDTE>": { <Appendix A fields>, _source } } }
candidates/latest.json              { runId, scoredAt, latestRepdte, buyboxHash, scoringHash, items: [candidate] }
candidates/decisions.json           { "<key>": { status: promoted|dismissed|snoozed, by, at, reason, until, accountId } }
pilot/<accountId>.truth.json, pilot/<accountId>.review.json, pilot/status.json
```

Record shapes:

- **`_source`** = `{ source, endpoint, query, recordId, period, fetchedAt, runId }`. The writer rejects a record without one.
- **Candidate** =
  ```
  { key: "fdic:<CERT>", cert, name, metros: ["<cbsa>"], assets, tier: "A"|"B"|null, score, filtersFailed: [string],
    axes: { distress, fit, timing },
    profile: { categories: [...], footprint: {...}, limits: [string] },   // E6-S6, the paper profile
    components: [{ id, axis, label, value, weight, points, inputs: [{ field, repdte, value }] }],
    signals: [{ id, type, label, period, evidence: ["fdic:<CERT>:<REPDTE>"] }],
    card: { text, checked } | null, latestRepdte }
  ```
- **Account `pipeline` block** (E6-S8), written on promotion:
  ```
  { key, period, tier, axes, profile, signals, leadSector }
  ```
  The briefer reads all of it as data. The drafter reads only `leadSector`.

## Appendix B. Sources

- FDIC BankFind Suite API documentation and definition files: https://api.fdic.gov/banks/docs/ (`swagger.yaml`, `risview_properties.yaml`, `institution_properties.yaml`, `location_properties.yaml`, `sod_properties.yaml`). Live queries run November 13, 2026.
- Resend Acceptable Use Policy: https://resend.com/legal/acceptable-use
- Denver Public Trustee and Foreclosures: https://denvergov.org/Government/Agencies-Departments-Offices/Agencies-Departments-Offices-Directory/Denver-Clerk-and-Recorder/Recording-Division/Denver-Public-Trustee
- Travis County Clerk, foreclosure notices: https://countyclerk.traviscountytx.gov/?p=483
- Texas State Law Library, the foreclosure sale: https://guides.sll.texas.gov/foreclosure/the-sale
- SKLD, Colorado foreclosure reports (an example vendor): https://skld.com/foreclosures
