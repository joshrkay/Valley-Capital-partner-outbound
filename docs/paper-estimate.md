# The paper estimate: what a lender likely holds, before the first call

PRD epic E14, feature 1 of the five discussed on November 14, 2026. It answers the end goal's first two links (PRD section 0): **what paper the institution holds, what those loans look like, and where the firm has an advantage.**

Today that answer is spread across several screens. This feature puts it on one page per candidate, with every number traced to its source. Facts about sources carry the usual marks:

- **Checked**: tested live.
- **Seen**: read on the official page or schema.
- **Unconfirmed**.

## 1. Rules

- **It is an estimate.** It is not the loan tape: the tape comes from the conversation, under a confidentiality agreement. Every number says how it was made, and none is stated as more certain than its method allows.
- **Principals and the briefer only.** The estimate never appears in a message, and the drafter never sees it. A test proves this (PRD section 0).
- **No invented numbers.** Every value traces to source fields, files, dates and a named method. When there is no basis, the answer is "unknown", never a guess.

## 2. What it answers

| # | Question | Answer is built from |
|---|---|---|
| Q1 | How much CRE, of which kinds, and how stressed? | Call Report balances, stages and losses |
| Q2 | Which property types (office, retail, hotel, industrial, multifamily)? | The bank's own disclosure, else observed loans, else peers |
| Q3 | Where (which metros)? | Deposit footprint, then observed loans |
| Q4 | What sizes? | Call Report loan-size counts, then observed loans |
| Q5 | When do they mature or reprice, and how hard is refinancing? | Maturity buckets, vintages, rates |
| Q6 | Is this lender already a seller? | Held-for-sale balances, loan-sale gains, filings, assignments, mergers |
| Q7 | How much fits our buy box, and where is our edge? | The estimate matched against `buybox.json` and approved claims |
| Q8 | What do we not know, and what do we ask for? | The gaps, turned into a request list for the tape |

## 3. Every number has a tier

| Tier | Meaning | Example |
|---|---|---|
| **Reported** | The lender reported it to a regulator or the SEC | Multifamily balance at June 30, 2026 |
| **Observed** | Built from individual loans we can see | 14 recorded deeds of trust on Maricopa commercial parcels |
| **Inferred** | A model or peer comparison | Office share estimated from peer banks of similar size |

The page shows the tier beside each number. An Inferred number is always a range, never a single figure.

## 4. Inputs

### 4.1 Already collected (FDIC BankFind)
- Balances by category: construction and land, multifamily, nonfarm nonresidential (owner-occupied and other), and CRE not secured by real estate. Also past due 30–89 and 90+, nonaccrual, and charge-offs and recoveries, by category. Built.
- The concentration screen (E3-S7), structure events (E3-S6) and failures (E3-S5). Built.
- The deposit footprint by metro (SOD, annual, as of June 30). Built.

### 4.2 New FDIC fields to add
Checked live on November 14, 2026, on 40 banks with $1–5 billion in assets in our five states, for 2022Q4, 2023Q2, 2025Q2, 2025Q4, 2026Q1 and 2026Q2.

| Fields | What | Live result |
|---|---|---|
| `LNRENR1`–`LNRENR4`, `LNRENR1N`–`LNRENR4N` | Nonfarm nonresidential loans by **original** amount: under $100,000, $100,000–250,000, $250,000–1 million, and all under $1 million. Dollars (thousands) and **number of loans** (Call Report RC-C Part II). | Filled for about 39 of 40 in **June and December**, but only 12 of 40 in March. Treat as semiannual and use the latest June or December. |
| `LNRECNOT`, `LNRECNFM` | Construction split: other construction and land, and 1-to-4 family construction | Every quarter |
| `UCCOMRES`, `UCCOMREU` | Unused commitments for CRE, secured and unsecured: the construction draws still to come | Every quarter (unsecured often zero) |
| `RSMULT`, `RSCONS`, `RSOTHER`, `NARSNRES`, `RSLNLTOT` | Restructured or modified loans, by type, and nonaccrual restructured nonfarm nonresidential | Filled in 2025–26. The 2023 accounting change (ASU 2022-02, from "troubled debt restructurings" to "modifications to borrowers in financial difficulty") likely **breaks the series**. Unconfirmed; mark the break. |
| `LNLSSALE`, `NALNSALE`, `P9LNSALE` | Loans held for sale: total, nonaccrual and 90+ past due | Total for about half the banks; the distressed part is rare. When present, it is the strongest seller signal. |
| `NETGNSLN`, `NTGLLNQ` | Net gains or losses on loan sales: year to date and the quarter | About 25 of 40. **Not CRE-specific**: mostly residential mortgage sales. Use only as "this bank sells loans". |
| `LNOT1T3`, `LNOT3T5`, `LNOT5T15`, `LNOTOV15` (and shorter buckets if present) | Remaining maturity or next repricing of all loans except 1-to-4 family first liens | Every quarter. A **proxy only**: it includes C&I and other loans, not just CRE. |
| `PARTACQU`, `PARTCONV` (participations) and `LNRESRE` (allowance on real estate loans) | — | **Null for all 40 banks.** Not available. Participations go on the tape-request list. |

### 4.3 Other sources
- **CMBS (built).** Market comparables by property type and metro: DSCR, occupancy, valuations, delinquency, special servicing, maturities. Also `originatorName`, item 2(c)(1) in the EX-102 schema (Seen; optional, so the fill rate is Unconfirmed). It shows which banks originate CRE loans in our metros. The adapter does not store it yet.
- **SEC filings.** The listener is built. Public banks often break CRE into office, retail, hotel and industrial. The Financial Statement and Notes data sets keep those breakdowns (data-sources 2.1) but are not built.
- **The county lender map (planned).**
  - Maricopa: the Recorder's bulk feed. Recorded deeds of trust and notices name the lender, the APN and the original principal (A.R.S. 33-808(C) for notices).
  - Los Angeles: ATTOM.
  - These give actual loans, with property type from the assessor's use code and the recording date as the vintage.
- **FRED (planned, E4-S4).** Rates at each vintage and today, for refinancing stress.
- **`buybox.json` and `claims.json`.** What we buy, and what we may say.

## 5. Method, question by question

**Q1. Size and stress (Reported).**
- Investor CRE = construction and land + multifamily + nonfarm nonresidential **other** (not owner-occupied) + CRE not secured by real estate. This is the 2006 guidance's own definition (71 FR 74580).
- Owner-occupied is shown separately.
- **Stages exist only where FDIC reports them.** A missing stage shows as "not reported", never as zero. Checked against FDIC's definitions, November 14, 2026:

  | Category | Balance | 30–89 days | 90+ days | Nonaccrual |
  |---|---|---|---|---|
  | Construction and land | `LNRECONS` | `P3RECONS` | `P9RECONS` | `NARECONS` |
  | Multifamily | `LNREMULT` | `P3REMULT` | `P9REMULT` | `NAREMULT` |
  | Nonfarm nonresidential, other | `LNRENROT` | `P3RENROT` | `P9RENROT` | `NARENROT` |
  | Nonfarm nonresidential, owner-occupied | `LNRENROW` | `P3RENROW` | `P9RENROW` | `NARENROW` |
  | CRE not secured by real estate | `LNCOMRE` | `P3COMRE`? | not reported | not reported |

  - The two construction past-due fields are in FDIC's definitions but **not pulled today** (`src/metrics.mjs`). E14-S1 adds them and checks live that they are filled.
  - `P3COMRE` is titled "30-89 days past due, commercial RE", and whether it is the not-secured line is Unconfirmed. Until that is checked, the not-secured line shows its balance only.
- **Charge-offs are flows, not a stage.** They are shown separately: for the quarter, and for the year to date. They are never added to, or shown as part of, the outstanding balance.
- Each category has eight quarters of trend, and restructured balances by type, with the 2023 break marked.
- **Unused commitments are portfolio-level only.** `UCCOMRES` (secured) and `UCCOMREU` (unsecured) are not split by category, so they are shown once for the whole CRE book, never per category.

**Q2. Property types.** Tried in order:
1. **Reported**: the public bank's own breakdown, from the SEC data sets.
2. **Observed**: lender-map loans by assessor use code. The page states **coverage by count** only: the number of observed loans, with the reported loan count where one exists (Q4).
   - Records give **original** principal, while the Call Report gives the **current** balance. So observed original principal is **never divided by** a reported balance. A $10 million group paid down to $6 million would otherwise show 167% coverage.
   - Original-principal totals are shown on their own, labelled as original.
   - Balance coverage appears only when current balances are known, for example from a tape or from a vendor that carries them.
3. **Inferred**: a peer prior from public banks of similar size and region, shown as a range.

A mix is never inferred from fewer than 5 observed loans: show the loans, not a mix. Multifamily and construction are already separate categories, so only nonfarm nonresidential needs a split.

**Q3. Geography.**
- **Reported proxy:** the deposit share by metro, from SOD. **Caveat:** deposits are not loans, and loan production offices appear in no deposit data.
- **Observed:** lender-map loans by county, where coverage exists.

**Q4. Size.**
- **Reported**, for nonfarm nonresidential only, as of the latest June or December: the count and dollars under $100,000, $100,000–250,000 and $250,000–1 million.
  - The average size of the small loans is `LNRENR4 / LNRENR4N`.
  - The dollars above $1 million are `LNRENRES − LNRENR4`; their count is unknown.
  - **Caveats:** the buckets use *original* amount, and they cover owner-occupied and investor loans together.
- **Observed**, where coverage exists: original principals from the lender map.
- There is no reported size data for multifamily or construction.

**Q5. Maturity and refinancing stress.**
- **Reported proxy:** the maturity and repricing buckets, for all non-1-4-family loans.
- **Inferred:**
  - vintages **only from loan-level dates**: lender-map recording dates and CMBS origination dates.
    - A change in a category's balance is **not** a floor on new loans. It nets new loans against payoffs, charge-offs, loan sales, acquired books and reclassifications.
    - It is shown only as "net change", and never across a quarter with a structure event (E3-S6), whose acquired book would look like new lending.
  - typical terms by property type from CMBS comparables;
  - rate at origination (FRED Treasury yield plus a spread range) against today's rate: a payment-shock band.
- Optional: a DSCR stress test using CMBS comparables' NOI and DSCR for the same type and metro.
- Every output is a band, and always Inferred.

**Q6. Seller evidence.** A list, not a score, each item dated:
- distressed held-for-sale balances;
- loan-sale gains or losses (marked as not CRE-specific);
- SEC held-for-sale, loan-sale and note-sale filings;
- acquisitions, where the acquirer often sells the target's CRE;
- lender-map assignments where this bank is the assignor;
- later, enforcement orders.

**Q7. Fit and edge.**
- **In-box estimate.** Never built by multiplying separate breakdowns. Knowing that half the book is hotels, half is in Phoenix and half is in our size range says nothing about how much is all three: anywhere from none to half the book. So:
  1. **Joint, from observed loans.** Each observed loan carries its own type, county, size and date, so the count and original principal of loans in the box are real. This is shown as observed, with its coverage.
  2. **Bounds, from reported breakdowns.** For each buy-box condition *i*, let *sᵢ* be the share of the book that meets it.
     - **Upper bound:** the smallest *sᵢ*, times the book.
     - **Lower bound:** max(0, Σ *sᵢ* − (k − 1)), times the book, for k conditions. It is often zero, and the page says so.
  3. **No base figure** until a dependence model has been calibrated against real tapes (E14-S6). Until then the page shows the observed figure and the two bounds.
- **Edge statements:** chosen only from approved claims in `claims.json` that match the profile. These are for the principal, not the message.

**Q8. What we don't know, and the tape request.**
- Generated from the gaps. For example: "the property-type split is Inferred from peers; ask for it"; "participations are unknown".
- Then a standard request list for the tape, after the confidentiality agreement:
  - loan ID; property type; address or APN;
  - original and current balance; rate and rate type; origination and maturity dates; amortization;
  - DSCR, with its date; LTV and value date; occupancy;
  - payment status; modification history; guarantors; lien position;
  - participations (who leads, what share).

**Pricing.** By default the page shows **pricing context only**:
- comparable CMBS loans of the same type and metro: valuations, DSCR, occupancy, special-servicing outcomes;
- FDIC loan-sale results, where they are public.

It shows **no bid or price**. See D-P1.

## 6. Output

- **One record per candidate** in the data folder and the platform: `paper/<key>.json`.
- **Every value carries:**
  - the value, or low, base and high;
  - unit (FDIC dollars are in **thousands**);
  - as-of date;
  - tier;
  - sources (fields, files, dates);
  - method id.
- **A page per candidate** in the web app: a summary first, then Q1–Q8, each number with its tier and date. The **unknowns and the tape request** close the page.
- **The briefer** receives it as fenced data context, like the paper profile today.
- **The drafter** receives nothing from it.
- **Servicer mode.** For a special servicer the paper is known loan by loan, from CMBS, so the page lists those loans instead of estimating. The seller is the trust, through the servicer.

## 7. Critical details: the checklist

1. **Units.** FDIC amounts are in thousands of dollars; counts are counts. A test checks that every displayed dollar figure was converted.
2. **Dates.** Each source has its own as-of date, and the page shows each one:
   - Call Report: a quarter, filed about 30–45 days after it ends;
   - loan-size counts: semiannual (Checked);
   - SOD: June 30, annual;
   - CMBS: monthly;
   - counties: daily.
3. **Original versus current size.** The loan-size buckets use original amounts.
4. **Owner-occupied inside the size counts.** They cover all nonfarm nonresidential loans.
5. **Charter versus holding company.** Loans may sit in a sister bank. Estimate per charter, roll up per holding company, and show both.
6. **Participations.** They are not available (Checked). A bank may hold slices of others' loans, or have sold slices of its own. They go on the tape request.
7. **Acquired books.** After a merger, the target's loans sit with the acquirer, at marked values. Structure events flag it.
8. **Series breaks.** Watch three:
   - the 2023 change from troubled debt restructurings to modifications;
   - the CECL adoption date, which changes the allowance;
   - Call Report amendments, so store the date each value was read.
9. **Small banks.** With few loans, ranges must be wide, and one large loan can dominate. Show minimum-sample rules (Q2) and single-loan concentration where observed.
10. **Geography proxies.** Deposits are not loans. Online and national banks, and loan production offices, distort the footprint.
11. **Collateral versus purpose.** Call Report categories are by collateral. CRE not secured by real estate is its own field.
12. **The lender map.**
    - MERS appears as a nominee, not the lender.
    - Assignments change the holder, so follow the chain to the current holder.
    - The servicer is not the owner.
13. **Servicers are a different case.** They are not their own book (see servicer mode in section 6).
14. **Privacy and law.**
    - The lender map holds borrower names, so it stays in the data folder or the database, for principals only.
    - Using Arizona records this way must fall within the commercial-purpose statement filed with the Recorder (playbook D8).
    - A received tape may have to be deleted under its confidentiality agreement.
15. **Calibration.**
    - Backtest the Inferred peer priors on public banks, holding each one out in turn.
    - When a real tape arrives, compare the estimate with it and keep **only the aggregate error by field**, never the tape.
    - Report coverage: Observed dollars as a share of Reported.
16. **Language.** The page says "reported", "observed" or "estimated", and gives ranges. Cards are built from templates, as today. No Inferred number appears as a fact.
17. **Never multiply marginals.** Separate breakdowns give bounds, not a joint figure (Q7).
18. **Stocks versus flows.** Balances and stages are stocks at quarter end. Charge-offs and loan-sale gains are flows over a period. They are never mixed.
19. **Original versus current, again.** Observed records give original principal. Never divide it by a current reported balance (Q2).
20. **Net change is not new lending.** Payoffs, sales, acquisitions and reclassifications all move a balance (Q5).
21. **Report what exists.** A stage FDIC does not report is "not reported", not zero (Q1).

## 8. Build phases (stories)

**E14-S1. The reported layer** (P0; data in hand).
- [ ] Add the fields in 4.2 to the FDIC pull, with field checks. The semiannual fields are allowed to be null in March and September.
- [ ] Add `P3RECONS` and `P9RECONS`, check live that they are filled, and check what `P3COMRE` measures.
- [ ] Compute:
  - Q1, with per-category stages, flows apart, and commitments at portfolio level;
  - the Q3 proxy;
  - Q4 for nonfarm nonresidential;
  - the Q5 proxy;
  - Q6 from FDIC and SEC data;
  - Q7 as bounds only;
  - the unknowns, and the tape request.
- [ ] Store each candidate's record (`paper/<key>.json`), and show it on the candidate page.
- [ ] Tests:
  - units and as-of dates;
  - the 2023 break is marked;
  - nothing reaches the drafter;
  - every value has a tier and sources.

**E14-S2. The CMBS overlay** (P1).
- [ ] Market stress and comparables by property type and metro: delinquency, special servicing, DSCR and occupancy distributions.
- [ ] Store `originatorName` from EX-102, measure how often it is filled, and list the banks that originate in our metros.

**E14-S3. Property types for public banks, priors for the rest** (P1).
- [ ] Public banks' CRE breakdowns from the SEC Financial Statement and Notes data sets, mapping each bank's custom members to our property types. A principal confirms each map.
- [ ] Peer priors for private banks, by size and region, shown as ranges.
- [ ] A hold-out backtest on public banks; its error goes on the page as the range.

**E14-S4. The observed layer** (P1; after the Maricopa bulk account or the ATTOM trial).
- [ ] Lender-map loans, by charter: count, property type, original principal, vintage, county.
- [ ] The chain to the current holder through assignments, and MERS resolved where the document names the lender.
- [ ] Coverage, and the minimum-sample rule.

**E14-S5. Refinancing stress** (P2; needs the FRED key and its terms check).
- [ ] Vintage estimates, the payment-shock band, and the optional DSCR stress, all Inferred, with ranges.

**E14-S6. Calibration** (P2).
- [ ] On each received tape: compare by field, store only the aggregate error, and delete the tape if the agreement requires it.

## 9. Decisions for a principal

| # | Decision | Default |
|---|---|---|
| D-P1 | Show a price range, or pricing context only? | Context only. A range from public data could anchor a bid on weak ground. |
| D-P2 | Ranges as low/high, or low/base/high? | Bounds (low/high), plus the observed figure where loans are seen. A base figure only once a dependence model is calibrated (E14-S6). |
| D-P3 | Which buy-box dimensions decide fit, and how they weigh: sector, metro, size, status, lien | Sector and metro must match; size and status narrow the range |
| D-P4 | What we keep from a received tape | Only the aggregate error by field. The tape itself is handled under its agreement. |
| D-P5 | Show the estimate per charter, per holding company, or both | Both, charter first |
