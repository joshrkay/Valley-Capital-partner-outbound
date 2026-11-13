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
| 8. **Learning** | Which signals led to conversations and loan tapes? | Outcomes linked back to signals | Goal 5, E11 |

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
| `account` | Account id (existing `accounts/<id>.json`) | Existing fields plus `institutionKey` and `originSignals` | A principal's promotion | E6 |
| `source_run` | Run id | Source, parameters, row counts, field check, errors, duration, outcome | | E2 |
| Existing | | `touches.jsonl`, `audit.jsonl`, `suppression.json`, briefs, facts, drafts | | Agents 1–3 |

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

**E6-S5. Weekly digest.** *As a principal, I want one weekly summary so that I don't have to remember to look.* P1, R2.
- [ ] It lists new candidates, tier changes, a newly published FDIC quarter, and runs that failed or look suspect.
- [ ] It is written to the data folder. How it is delivered to the principal is an open question (Q13). It goes only to the firm's own people, never to a prospect.

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
  - no loan sale advisor found (`bank.access`);
  - the bank has sold loans before (`bank.intent`).
- [ ] An advantage signal never overrides the risk screen. An active sale run by an advisor, or a failing bank, still means wait or do not approach.

**E6-S8. The research travels with the account.** *As a principal, I want the briefer and the drafter to start from what the pipeline already found so that research goes deeper on the right paper and the message leads with the right sector.* P0, R1.
- [ ] Promoting a candidate copies its profile, fit, signals and period into the account file (`pipeline` block).
- [ ] The briefer's prompt includes that block as data. It focuses `bank.exposure` and `bank.intent` on the matching categories, for example: "look for multifamily credit-quality disclosures and any stated plan to sell multifamily loans".
- [ ] The drafter receives only which **sector** to lead with and which approved site page to link. A test confirms the drafter's input contains no FDIC figure, no ratio and no signal text.
- [ ] Given a draft that mentions the bank's own figures, distress or trend, then the existing linter blocks it.

---

### E7. Contact finding

**E7-S1. Institution-first research names the candidates.** *As a principal, I want the briefer to research a promoted bank before anyone is named, and to bring back who most likely decides, so that the first message reaches the right person.* P0, **R1** (built).
- [ ] An account with no named person is researched in **institution mode**. The prompt says no one is named. For `bank.people` it asks for up to three people who most likely decide on loan sales, each a sourced person finding, and forbids guessing a name.
- [ ] In institution mode the person check reads `not_named` whatever the model says. The brief lists the candidate findings and says a principal chooses.
- [ ] `outbound account set-person --account ID --name N [--title T] --by NAME` records the choice, with an audit line. It resets the role to unconfirmed. Confirming the role is still a separate step for a principal (`account confirm-role`).
- [ ] The guard still refuses any touch until a person is named, their role confirmed, and their address verified (existing rules).

**E7-S2. Vendor test before paying.** *As a principal, I want any contact-data vendor tested on 50 people we already know so that we pay for accuracy, not claims.* P1, R3.
- [ ] A test harness compares each vendor's results against the known list. It reports correct, wrong and missing emails, and whether titles are current.
- [ ] No vendor is wired in until a principal records a pass against a threshold the principals set.

**E7-S3. Verified, sourced addresses.** *As a principal, I want every email address verified and sourced so that we don't bounce or reach the wrong person.* P1, R3.
- [ ] Every address is verified before use, and every field records where it came from (existing guard rules: business addresses only, no role or personal addresses).
- [ ] A deletion request removes the person from every record, and the removal is logged.

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
- [ ] Job kinds: `sources.fdic`, `score.run`, `research.run`, `draft.run`.
- [x] A scheduled GitHub Actions workflow runs the worker hourly on weekdays (12:17 to 23:17 UTC) and queues the weekly FDIC check on Mondays (E11-S1). Logs carry job ids, kinds and outcomes only. Keys live in Actions secrets. It is off until the repository variable `PLATFORM_ENABLED` is `true`.
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
  - A mismatched response is fetched again after the cache expires. A window of over 10,000 hits is split.
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
- [x] A new filer is searched back a year, once. Later runs start three days before the last one ended. `--since` searches every filer from a date.
- [x] Proxy statements (DEF 14A) of confirmed filers are recorded by form, date and link, for the briefer. No names are extracted (E7).
- [x] **A discovery search** finds bank filers not in the list. It searches by business-address state (our five) and bank SIC code. Its hits go to a for-review list (`outbound filers discovered`) and never become signals.
- [x] **E2:**
  - a fake shaped like the real responses (`test/edgar-search-fake.mjs`);
  - the run log;
  - a field check on every field used: a missing one fails the run and writes nothing;
  - the change log;
  - `outbound sources verify filings`: fresh, mapped, sourced, stored filings found again, confirmed filers still SEC entities.
- [x] Filings are context for a principal only. The search returns no filing text, and none is stored. A test proves no filing, link, CIK, label or person reaches the drafter.
- [x] Worker job `sources.filings` (migration `20261113213000_jobs_filings.sql`). The workflow queues it on weekdays at 23:37 UTC, then verifies it.
- [x] **First live run (2026-11-13).** It used a scratch folder, a neutral User-Agent and throwaway mappings:
  - Suggestions for 30 banks: 41 candidates for 15 banks, from 30 lookups.
  - 18 of the 22 exact-name candidates had filed no 10-K or 10-Q in over a year: same-named entities that do not report. So filing evidence outranks the name.
  - With 4 mappings, a 30-day run made 12 requests and read 116 hits. It found 3 filings and 4 proxy statements, plus 21 filings from 16 bank filers for review.
  - Every verify check passed.
  - The first try met an error body from inside the server. Such errors are now retried twice.
- [ ] The signals are wired into scoring (`scoring.json`, `src/score.mjs`), after merge.
- [ ] A principal confirms the filer map, and reviews the searches, windows and bank SIC codes.

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
| Q13 | How is the weekly digest delivered to the principal? | Principals | E6-S5 | A file in the data folder |
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
