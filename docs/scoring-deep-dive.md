# Scoring deep dive: every variable, and how to rerun all the scoring

**Status: draft v1, November 17, 2026.** A read of the code as it stands on branch `claude/laughing-franklin-1yqaip` (PR #28, the D-P3 status mapping), and a proposed design. Nothing here changes code or `scoring.json`. **[verify]** marks a claim that was not checked against live data or a primary source. Every bank named in an example is **invented**.

**Readers:** the principals, who decide; whoever builds it, including Claude Code sessions.

**Related:** `scoring.json`, `buybox.json`, `src/score.mjs`, `src/metrics.mjs`, `src/paper.mjs`, `src/candidates.mjs`, `src/platform/worker.mjs`, `.github/workflows/platform-worker.yml`, `src/backtest/`, `docs/prd-signal-pipeline.md` (E3, E6), `docs/prd-next-five.md` (E17, E18, E19), `docs/paper-estimate.md`, `docs/data-sources.md`, `docs/county-playbook.md`.

---

## Summary

1. **The score has 11 variables, all from FDIC data.** 5 measure distress (45 points), 3 measure timing (25 points), 3 measure fit (30 points). Total possible: 100.
2. **Each variable earns points on a straight line.** Points = weight × (value ÷ "full"), capped at the weight. A missing value earns 0.
3. **Tier A** needs a total of 45, distress of 15 **and** fit of 15. **Tier B** needs a total of 20. A bank that fails a hard filter (failed, inactive, over $10 billion, no branch in our metros, no current report) gets no tier, whatever its score.
4. **Three problems inside today's score.**
   - About 30 of the 45 distress points count the same loans three times (noncurrent in the buy-box categories, noncurrent in all CRE, nonaccrual).
   - One fit variable is close to automatic: it is "one minus the construction share", so most banks get full points.
   - Every variable is a ratio. A small bank with $2 million of bad loans can outrank a large one with $80 million, though the firm buys loans of $1 to $25 million.
5. **The buy box's statuses (D-P3) are not in the score yet.** The paper record now measures the 30–89 day (sub-performing) loans and foreclosed property (OREO) the buy box buys. In the score, the buy-box distress variable still counts only noncurrent loans; 30–89 day loans sit in a timing variable, and OREO includes construction, which the buy box does not buy.
6. **The system collects about 25 signals and values that earn no points.** These include enforcement orders, merger applications, SEC filings, past sales, acquisitions, the concentration screen, CMBS servicer data, intermediaries, and most of the paper record. Section 2 gives each one a verdict: a score variable, a hard filter, a card note, or stay out.
7. **County records would add what no other source can:** observed distressed loans, by lender, for private banks too. Examples: notices of default, trustee sales, REO taken back by a lender, assignments (observed sales), and the lender's real map of loans. Section 3 shows how each would be computed per bank and per metro. County data covers some metros before others, so a missing county must not count as zero.
8. **Rerunning today:**
   - Scoring runs every Monday after the FDIC check.
   - It also runs from `outbound score run`, or from the **Queue scoring** button on the Status page. That button waits for the next hourly worker run (weekdays only).
   - Each run recomputes every bank from scratch and overwrites the candidate list. It rewrites only the paper records whose content changed.
9. **Gaps in rerunning:**
   - A change to `buybox.json` or `scoring.json` triggers nothing. The run records the hashes of both files but never compares them, so for up to a week nobody can tell the list was scored with old rules.
   - New signals from the monthly and weekly pulls wait for Monday.
   - The score has no history and nothing explains a change.
   - The rule that a weight change must cite a backtest is followed by convention only. No check enforces it.
10. **Proposed design:**
    - one `score.run` job that is safe any time, does nothing when nothing changed, and records why it ran;
    - a check that queues it automatically when the rules change;
    - a history line per bank per run, and a "what changed" breakdown that splits a score change into the part caused by data and the part caused by rules;
    - a CI gate on weight changes that requires a holdout backtest of the exact new weights;
    - a variables registry, so a new variable is added in one place and starts as a **shadow** (computed, shown and backtested, but earning 0 points).
11. **Plan:** about 3½ to 4 weeks of work for phases 1–4 (safe rescore, history and explanations, the registry, the gate). Then new FDIC-derived variables as shadows, and county variables once the Maricopa bulk account and counsel's answer (D7, D8) are in.
12. **Decisions for a principal** are in section 6. The most important is whether a missing county counts as zero or as unknown (D-V1).

---

## 1. The score today

### 1.1 How a bank becomes a score and a tier

`runScoring` in `src/score.mjs` does this for every bank in the FDIC list, in this order. It uses no model, and it reads no clock except to set the run date.

1. **Check the rule files.** `validateBuybox` and `validateScoring` run first. Any error stops the run. A `[CONFIRM]` placeholder in the buy box also stops it, unless the run is a draft (`--draft-buybox`), whose output is marked PROVISIONAL. The shipped buy box has no placeholders since 2026-11-17.
2. **Compute the metrics** for every quarter on file (`computeMetrics` in `src/metrics.mjs`), with the changes from the prior quarter (QoQ) and from four quarters earlier (YoY).
3. **Build the paper profile** (`buildProfile`): balances and stages by CRE category, the deposit footprint, and the concentration screen.
4. **Compute the 11 components** (`component`). Each gives a value and then points.
5. **Add up the points** by axis and in total, and **apply the hard filters** (`hardFilters`) and **the tier rule** (`tierFor`).
6. **Collect the signals**, state and event, and **build the card** (`buildCard`). Signals add **no points**.

### 1.2 Hard filters

Applied after the score, before the tier. A bank that fails any of them has `tier: null` and a reason. Promotion refuses it.

| Filter | Rule | Source |
|---|---|---|
| Failed | Any failure source says the bank failed | `/failures`, `/institutions`, `/history`, the FDIC CSV (`sources/fdic/failed.json`) |
| Not active | Status is not active, or `ACTIVE` ≠ 1 (`buybox.filters.requireActive`, true) | `/institutions` |
| Left the market list | `inUniverse` is false: the bank no longer has a branch in the metros, and was not added as a headquarters-state bank | FDIC adapter (`leftOn` records when) |
| Over the asset cap | Latest `ASSET` above `buybox.filters.maxAssetsThousands` (10,000,000, i.e. $10 billion) | `/financials` |
| No branch in a buy-box metro | No branch in any `buybox.metros`. **Exception:** a bank added as a headquarters-state bank (`via.hq`) passes. **[verify that the exception is intended]** | `/locations` |
| No financial data | No quarter on file | `/financials` |
| Not current | The bank's latest report is older than the latest quarter any bank has filed | `/financials` |

Suppressed, dismissed, snoozed and promoted banks are filtered later, when the list is shown (`listCandidates`), not in scoring.

### 1.3 The 11 variables

"Full" is the value at which a variable earns all its points. Ratios are fractions: 0.04 is 4%. A change is a difference in that fraction: 0.015 is 1.5 percentage points. All FDIC amounts are in thousands of dollars. "Bought categories" means the CRE categories whose sectors the buy box includes, at a bank that has a branch in a buy-box metro. With today's buy box (hotel, multifamily, retail), that is **multifamily** and **nonfarm nonresidential**. Construction is never bought.

| # | Id | Axis | Weight | Full | What it measures | FDIC fields | What it misses |
|---|---|---|---|---|---|---|---|
| 1 | `buyboxNoncurrentRatio` | distress | 15 | 0.04 (4%) | Noncurrent loans (90+ days past due, plus nonaccrual) as a share of balances, in the bought categories only | `NCREMULT`, `NCRENRES` over `LNREMULT`, `LNRENRES` | Nonfarm nonresidential includes office, industrial and owner-occupied loans, which cannot be separated from hotel and retail. It leaves out the 30–89 day loans and the OREO the buy box now buys (D-P3). It is a ratio, not dollars. It is for the whole bank, not the metros. |
| 2 | `creNoncurrentRatio` | distress | 10 | 0.04 | Noncurrent ratio of all CRE (construction, multifamily, nonfarm nonresidential) | (`NCRENRES` + `NCREMULT` + `NCRECONS`) / (`LNRENRES` + `LNREMULT` + `LNRECONS`) | Mostly the same loans as #1, plus construction, which we do not buy. So the same signal is counted twice. |
| 3 | `creNoncurrentYoY` | distress | 10 | 0.015 (+1.5 pts) | Change in #2 from four quarters earlier | as #2, two quarters | Noisy at small banks, where one loan moves it. A fall earns 0, never less. |
| 4 | `creNonaccrualRatio` | distress | 5 | 0.03 | Nonaccrual share of all CRE | (`NARENRES` + `NAREMULT` + `NARECONS`) / CRE base | Nonaccrual loans are part of noncurrent, so these loans are counted a third time. |
| 5 | `creOreoRatio` | distress | 5 | 0.01 | Foreclosed commercial property (OREO) as a share of CRE loans | (`ORENRES` + `OREMULT` + `ORECONS`) / CRE base | Includes construction OREO. The Call Report does not say where the property is. It is a stock, not new foreclosures. |
| 6 | `creNoncurrentQoQ` | timing | 10 | 0.005 (+0.5 pts) | Change in #2 from the prior quarter | as #2, two quarters | The same metric as #3, one quarter apart, so it is noisy. |
| 7 | `earlyStageDelinquency` | timing | 10 | 0.015 | Loans 30–89 days past due, as a share of multifamily and nonfarm nonresidential | (`P3RENRES` + `P3REMULT`) / (`LNRENRES` + `LNREMULT`) | This is in effect the buy box's "sub-performing" status, but it is filed under timing, not fit. It is a level, not a change. It leaves out construction. |
| 8 | `creNetChargeOffRate` | timing | 5 | 0.0025 per quarter (about 1% a year) | Net CRE charge-offs this quarter, as a share of CRE | (`NTRENRSQ` + `NTREMULQ` + `NTRECONQ`) / CRE base | One quarter only. A charge-off can mean the bank has already cleaned up, so there is less to sell. Net recoveries earn 0. |
| 9 | `buyboxCreShare` | fit | 10 | 0.6 | Bought categories as a share of the CRE book | (`LNREMULT` + `LNRENRES`) / (`LNRENRES` + `LNREMULT` + `LNRECONS`) | With today's buy box this is **1 − the construction share**. Any bank whose construction is under 40% of its CRE gets all 10 points. It ignores loan size, status and owner-occupancy. **[verify on live data how many banks get the full 10]** |
| 10 | `buyboxShareOfLoans` | fit | 10 | 0.5 | Bought categories as a share of all net loans | (`LNREMULT` + `LNRENRES`) / `LNLSNET` | Favours CRE-heavy banks whatever their CRE looks like. It includes owner-occupied nonfarm nonresidential. **[verify with a principal whether owner-occupied loans are in the buy box]** |
| 11 | `metroDepositShare` | fit | 10 | 0.5 | Share of the bank's deposits held in buy-box metros | Σ `DEPSUMBR` in the metros / `DEPSUM` (Summary of Deposits, June 30) | Deposits are not loans, and loan production offices do not show. The data is annual, about three months late. With no Summary of Deposits the value is missing and earns 0. A headquarters-state bank with no metro branch earns 0 here but passes the metro filter. |

**Where each kind is defined in code today.** Metric variables (#2–#8) are in `METRICS`, `src/metrics.mjs`. Profile variables (#1, #9, #10) are in `PROFILE_MEASURES` and `profileMeasure`, `src/score.mjs`. The footprint variable (#11) is a special case inside `component()`. Adding a variable therefore touches three or four files (section 5.3 fixes that).

**Defined but unused.** These metrics in `METRICS` have no component: `creLoans`, `creOreo`, `creNetChargeOffs`, `investorCreShare`, `creShareOfLoans`, `mfNoncurrentRatio`, `mfNonaccrualRatio` and `mfEarlyStageDelinquency`. Some feed signals.

### 1.4 How a value becomes points

```
points = round2( weight × clamp( value ÷ full, 0, 1 ) )        missing value → 0 points, with the reason
axis subtotal = sum of the points of that axis's components
score = distress + timing + fit                                  (at most 45 + 25 + 30 = 100)
```

**Worked example: Saguaro Plains Bank (invented), data as of June 30, 2026.**

| Variable | Value | Calculation | Points |
|---|---|---|---|
| buyboxNoncurrentRatio | 3.0% | 15 × 0.030/0.04 = 15 × 0.75 | 11.25 |
| creNoncurrentRatio | 2.8% | 10 × 0.70 | 7.00 |
| creNoncurrentYoY | +0.9 pts | 10 × 0.009/0.015 = 10 × 0.60 | 6.00 |
| creNonaccrualRatio | 1.8% | 5 × 0.60 | 3.00 |
| creOreoRatio | 0.2% | 5 × 0.20 | 1.00 |
| **Distress** | | | **28.25** |
| creNoncurrentQoQ | +0.2 pts | 10 × 0.40 | 4.00 |
| earlyStageDelinquency | 0.9% | 10 × 0.60 | 6.00 |
| creNetChargeOffRate | 0.05% | 5 × 0.20 | 1.00 |
| **Timing** | | | **11.00** |
| buyboxCreShare | 72% | 10 × min(1.2, 1) | 10.00 |
| buyboxShareOfLoans | 31% | 10 × 0.62 | 6.20 |
| metroDepositShare | 85% | 10 × min(1.7, 1) | 10.00 |
| **Fit** | | | **26.20** |
| **Score** | | | **65.45** |

### 1.5 Tiers

| Tier | Rule (`scoring.json` `tiers`) | Example (invented) |
|---|---|---|
| **A**: outreach candidate | Passes the hard filters, **and** score ≥ 45, **and** distress ≥ 15, **and** fit ≥ 15 | Saguaro Plains Bank: 65.45, distress 28.25, fit 26.20 |
| **B**: watch | Passes the hard filters, and score ≥ 20, but misses at least one A test | Front Range Mercantile Bank: score 48, distress 12, fit 27. The note says "distress 12 is below 15". |
| **Untiered** | Fails a hard filter, or score < 20 | Mojave Thrift & Loan: score 17. Canyon Crest Bank: $14 billion in assets, filtered whatever its score. |

The tier note names every test missed, so the card can say why a bank is not Tier A.

### 1.6 What the score, taken whole, gets wrong

- **One quantity carries most of distress.** Variables #1, #2 and #4 (30 points) measure noncurrent or nonaccrual CRE. Variables #3 and #6 (20 points) are changes in #2. So 50 of the 70 distress and timing points rise and fall with one number. The backtest's per-component table (E17-S4) can show whether each one adds anything.
- **Fit is easy to max out.** Variables #9 and #11 are near-automatic for a community bank with metro branches, so the fit test for Tier A (15) rarely binds. **[verify against the live distribution]** In practice, Tier A is close to "score ≥ 45 and distress ≥ 15".
- **Ratios only.** Nothing measures how many dollars of in-box distressed paper a bank holds. For a buyer of $1 to $25 million loans, a bank with $600,000 of noncurrent multifamily is not a seller of one loan, whatever its ratio.
- **The buy box's statuses are not used.** D-P3 maps non-performing to 90+ days plus nonaccrual, sub-performing to 30–89 days, and foreclosed to OREO. The score covers non-performing in the bought categories (#1). Sub-performing is a timing variable (#7). OREO includes construction (#5). The loan-size range ($1 to $25 million) is used only in the paper record.
- **Missing means zero.** A bank with no Summary of Deposits loses up to 10 fit points for a data gap, not for a fact about the bank. This matters little today. It will matter a great deal once county data covers some metros and not others.

---

## 2. Collected, but not in the score

Each row is a signal or value the system already collects. **Verdicts:**
- **Score variable**: earns points, after a backtest where the data allows.
- **Shadow**: computed and shown, earning 0 points until a backtest and a principal say otherwise.
- **Hard filter**: decides eligibility.
- **Card note**: shown to a principal, no points.
- **Stay out**.

One rule binds them all. **A source that becomes a feature can no longer be a backtest label.** Otherwise the backtest grades the score on its own inputs (E17-S2, the leakage test in `src/backtest/labels.mjs`).

| # | Signal or value | Where it is | Today | Verdict | Why |
|---|---|---|---|---|---|
| 1 | Metric state signals: CRE noncurrent rising two quarters, first CRE charge-off in 8 quarters, OREO up, early-stage rising, noncurrent ≥ 3%, multifamily noncurrent rising or up a point | `scoring.json` `signals`, `detectSignals` | Card and triage | **Card note.** Make "rising two quarters running" a **shadow** timing variable. | Most restate a component. Persistence ("two quarters running") is the one thing a straight-line component cannot express. |
| 2 | Concentration screen: construction ≥ 100% of capital; CRE ≥ 300% of capital and up 50% in 36 months | `concentration.signals`, `computeConcentration` | Card; triage act-now when on Tier A | **Score variable** (distress, "pressure"), shadow first | The 2006 guidance flags a bank for closer supervisory review, and examiners pressing to cut CRE is a direct reason to sell. It is replayable from Call Report fields. **[verify that the backtest panel carries the quarter 12 back that the growth test needs]** |
| 3 | Acquired a bank with a metro presence (structure event) | `structureEvents`, `sources/fdic/events.json` | Card; triage watch | **Score variable** (timing), with a decay over 4 quarters, sized by the target's last CRE | An acquirer often sells the target's CRE. The events are dated, so the backtest already replays them. |
| 4 | Failed banks in the metros | `sources/fdic/failed.json`, `listFailedBanks` | Hard filter, plus its own list with the FDIC as seller | **Keep as is** | The bank is gone and the FDIC sells. Failure is also a backtest label. |
| 5 | SEC filings matching saved searches (8-K 2.01 and 2.06, held for sale, loan or note sale, repositioning) | `sources/edgar/filings.json`, `filingSignals` | Card; triage act-now for sale searches | **Card note**; stay out of points | Only banks with a confirmed SEC filer can earn it, so points would rank public banks above private ones for being visible. `disclosed_sale` is also a backtest label. |
| 6 | Has sold before (sale ledger: a disclosed sale, a whole-bank acquisition, CMBS dispositions, FDIC sales) | `sales/ledger.json`, `saleSignals` | Card (D-S2: no points) | **Card note now.** It becomes a **score variable** (a "seller history" axis) once county assignments give observed sales for private banks (section 3). | Today only SEC filers can show a bank sale, the same bias as #5. The CMBS and FDIC kinds name servicers and the FDIC, not banks. |
| 7 | Enforcement orders (Federal Reserve, FDIC, OCC): an order event, and "under an active order" (state) | `sources/enforcement/*.json`, `enforcementSignals` | Card; the guard needs a principal's confirmation before a touch (D-E3) | **Score variable** for an active consent order, cease-and-desist or written agreement (pressure), after the backtest (D-E1) | An active order often pushes a bank to cut problem assets. The backtest must first replay orders by their dates, and the `enforcement_order` label must stay off while orders are a feature. |
| 8 | Merger applications (Federal Reserve H.2), as acquirer or target | `sources/mergers/applications.json`, `mergerSignals` | Card | **Card note** | The direction is unclear: a pending target may freeze sales, or clean up before closing. The structure event (#3) scores the acquirer once the deal closes. |
| 9 | CMBS loans in our metros: special servicing, note sale, DPO, REO, foreclosure, delinquent, maturing, modified; servicer summary | `sources/edgar/loans.json`, `servicers.json`, `loanSignals` | Servicers page; triage act-now on a note sale | **Stay out of the bank score.** Build a separate **servicer score** (E4-S3), and a **metro stress** value (section 3.4). | These are servicers' loans, not banks'. |
| 10 | CMBS `originatorName` | Stored on each kept loan (`toLoan`) | Not shown | **Card note** at most | It says which bank originated a loan now in a trust, which is weak evidence about that bank's book today. **[verify the fill rate]** |
| 11 | FDIC loan-sale announcements | `sources/fdic/sales.json` | Ledger; intermediaries | **Stay out** of the bank score | The seller is the FDIC. It is a backtest label (`fdic_loan_sale`). |
| 12 | Intermediaries: registry, mandates, ranking, the route to a seller | `intermediaries/`, `rankFirms`, `routeFor` | Candidate page shows the route | **Card note** (the route); keeps its own ranking | The route says how to approach, not whether. An advisor-run sale in progress means "wait" (E6-S7). That could become a soft flag on the card. |
| 13 | Paper: status-eligible loans in the box (D-P3: 30–89, 90+ and nonaccrual on the multifamily and nonfarm nonresidential lines) | `paper/…json` `q7.sectors[].statusLoans` | Paper only | **Score variable**: `buyboxStatusRatio` replaces or sits beside #1 | It is what the buy box actually buys, measured from reported stages. |
| 14 | Paper: in-box dollars (status-eligible amount; Q7 bounds) | `q7.sectors[].statusLoans.amount`, `.bounds` | Paper only | **Score variable**: `buyboxDistressedDollars`, on a log scale (section 3.5) | It adds the "is there enough paper" test that no ratio gives. |
| 15 | Paper: OREO in the bought property types | `q7.sectors[].oreo` (`OREMULT`, `ORENRES`) | Paper only | **Change #5** to the bought categories (`buyboxOreoRatio`) | The buy box buys foreclosed property. Construction OREO is not in the box. |
| 16 | Paper: loan sizes by original amount (nonfarm nonresidential, June and December) | `q4`, `LNRENR1`–`LNRENR4` (with counts) | Paper bounds only | **Score variable** (fit): `largeLoanShare` = share of nonfarm nonresidential in loans of $1 million or more | A bank whose loans are mostly under $1 million holds little the buy box buys. Semiannual, so it uses the latest June or December report. |
| 17 | Paper: loans held for sale, and the distressed part | `q6`, `LNLSSALE`, `NALNSALE`, `P9LNSALE`, `P3LNSALE` | Paper only | **Shadow** (timing): a flag when distressed loans are held for sale | The strongest seller sign in Call Reports when present. It is not CRE-specific, so the card says so. |
| 18 | Paper: gains on loan sales | `NTGLLNQ`, `NETGNSLN` | Paper only | **Card note** | Mostly residential mortgage sales. It shows only that the bank sells loans. |
| 19 | Paper: restructured or modified loans by type | `RSMULT`, `RSNRES`, `NARSNRES`, `RSLNLTOT` | Paper only | **Shadow** (distress): modified multifamily and nonfarm nonresidential as a share of each line | "Extend and pretend" shows up here before it shows as noncurrent. It is semiannual by type, and the 2023 accounting change breaks the series, so the backtest can use it only from 2023 on. |
| 20 | Paper: unused CRE commitments | `UCCOMRES`, `UCCOMREU` | Paper only | **Card note** | Construction draws still to come. Not in the buy box. |
| 21 | Paper: maturity and repricing buckets | `LNOT3LES` … `LNOTOV15` | Paper only | **Stay out** | They cover all loans, not CRE. County and CMBS maturities are better (section 3). |
| 22 | Investor and owner-occupied split of nonfarm nonresidential | `LNRENROT`, `LNRENROW`, with their stages | Paper and concentration screen | **Use to refine #1, #9, #10** if a principal rules owner-occupied loans out of the buy box | It depends on that decision **[verify]**. |
| 23 | Capital and the allowance | `RBC`, `RBCT1J`, `LNATRES`, `CBLRIND`, plus `NCLNLS`, `ORE` | Concentration screen only | **Score variable** (distress): `problemAssetsToCapital` = (noncurrent loans + OREO) / (tier 1 capital + allowance), a "Texas ratio" | The classic test for a forced seller is bad assets against the cushion that absorbs them. It is whole-bank, so it measures pressure, not fit. |
| 24 | Other whole-bank context: `NALNLS`, `P3ASSET`, `P9ASSET`, `NTLNLSQ`, `CB` | `/financials` | Unused | **Stay out** | Covered better by #23 and the CRE variables. |
| 25 | Triage act-now rules | `triage.json` | Triage | **Keep separate** | They decide when to look, not who ranks. |

---

## 3. New variables from new data

### 3.1 County recorder data

How the data arrives is in `docs/county-playbook.md`: the Maricopa bulk account first (D7), Los Angeles through a vendor trial, counsel first (D8). The sale ledger already has the event shapes `assignmentEvent` and `chainToCurrentHolder`, including MERS handling, in `src/sales.mjs`.

**From a recorded document to a bank's number.**

```
recorded document (NOD, NTS, NED, LP, TD, AS, ST, DT, CQ, DR)
  → APN → assessor: commercial? which sector? (use code)            drop residential; tag hotel / multifamily / retail / other
  → the deed of trust it cites → its assignments, oldest first        chainToCurrentHolder (MERS resolved where named)
  → current holder's name → fdic:CERT                                 exact name or alias only (E6-S1); anything fuzzier goes to review
  → county FIPS → metro (CBSA)                                        metros.json county lists
```

Each variable below is **observed** (built from records we can see) unless it says **inferred**. "Window" values are placeholders.

| Variable | Documents | Per bank | Per metro | Axis | Notes |
|---|---|---|---|---|---|
| `noticesRecent` | Notice of default (CA, NV), notice of trustee's sale (AZ, TX, CA), notice of election and demand (CO) | Count, and sum of original principal, of commercial notices in the last 90 days where the bank is the current holder. As a rate: that principal ÷ the bank's observed commercial book in covered counties (`lenderBook`, below). | Count and principal by sector per month; the share by lender type (bank, servicer, fund) | timing and distress | The freshest distress signal there is. Warning periods differ by state (21 days in TX, 110+ in CO). |
| `noticesInBox` | Same, filtered | Notices whose property is in a buy-box sector and metro, with original principal of $1 to $25 million | Same, in-box only | fit and distress | The observed version of the paper's in-box estimate. Lien position: whether the deed of trust is a first lien is not always on record **[verify per county]**. |
| `trusteeSalesScheduled` | Notice of trustee's sale with a sale date | Principal with a sale date 30–90 days out | Count per metro | timing | Urgency: the bank must decide before the sale. |
| `reoTakenBack` | Trustee's deed or sheriff's deed whose grantee is the foreclosing lender (a credit bid) | Count and principal in the last 12 months | Count per metro and sector | distress (and fit: the buy box buys REO) | Where the bank's OREO is, which the Call Report cannot say. It also cross-checks `ORENRES` and `OREMULT`. |
| `cureRate` | Cancellation (CQ), reconveyance (DR) after a notice | Notices cancelled ÷ notices, over 12 months | Same | lowers distress | A bank that works loans out has less to sell. |
| `lisPendens` | Lis pendens; judicial foreclosure and receivership filings (courts) | Count in 90 days, bank as plaintiff | Count per metro | timing | Matters mostly in CA, where judicial foreclosure with a receiver is common. |
| `assignmentsOut` | Assignment of a deed of trust, bank as assignor | Commercial assignments in 24 months, leaving out MERS-only steps and affiliate or servicing transfers **[verify how to tell these apart]** | Who sells, and who buys, per metro | a new "seller history" axis | Observed sales for private banks too. This fixes the bias in section 2, row 6, and feeds the ledger. |
| `assignmentsIn` | Assignment, non-bank as assignee | (no bank score) | Buyers per metro: who we compete with | none | For the buyer list and intermediaries. |
| `substitutionsOfTrustee` | Substitution of trustee | Count in 90 days | Count | timing (weak) | Often recorded just before a notice. |
| `maturingFromOriginations` | Deeds of trust (vintage), less releases | **Inferred**: principal of unreleased commercial deeds of trust whose estimated maturity falls in the next 18 months. Maturity = recording date + an assumed term (for example 5, 7 or 10 years), kept as a range. | The maturity wall per metro and sector | timing | Recorded deeds of trust rarely state maturity **[verify per county]**. Pair with FRED rates at vintage and today (E14-S5) for refinancing stress. |
| `lenderBook` and `lenderMapShare` | Deeds of trust, less releases | The bank's observed commercial principal by metro, and its share in the buy-box metros | Each lender's share of recorded commercial lending | fit | Replaces the deposit proxy (#11) where a county is covered. It is also the denominator for the rates above. |
| `taxDelinquentCollateral` | Treasurer's delinquent list, joined on APN | Commercial parcels behind the bank's deeds of trust with delinquent taxes | Count per metro | timing | Maricopa CD035 and CD055 (D11). |
| `mechanicsLiens` | Mechanics' liens on commercial parcels | (card note only) | Count | none | Points to stalled construction, which the buy box does not buy. |

**How a per-metro value becomes a per-bank value.** A metro-level value `v[m]`, such as a notice rate or a CMBS stress index, enters a bank's score through its weight in each metro:

```
bankValue = Σ over metros m of weight[bank][m] × v[m]
weight[bank][m] = lenderMapShare where the county is covered, else the deposit share (labelled a proxy)
```

### 3.2 Coverage: county data is uneven, so missing must not be zero

County data will cover Maricopa months before Los Angeles. If a missing county counts as zero, every bank in an uncovered metro looks healthier than a Phoenix bank with the same loans. So each county variable reports **coverage** as well as a value:

| Coverage | What the variable returns | What the score does (decision D-V1) |
|---|---|---|
| Covered: at least a set share (placeholder 50%) of the bank's book is in counties with an adapter, and at least 5 observed deeds of trust | A value, observed | Points as usual |
| Not covered | `missing: 'not covered'` | **Option A (default proposed):** 0 points. The card and tier note say "county data not yet available for this metro", and county variables start as shadows until two or more counties are covered. **Option B:** the axis maximum is rescaled to the covered variables, so missing is neutral. That is fairer, but tiers become harder to read. |

### 3.3 Matching quality is a variable's precondition

A county variable is only as good as name matching to `fdic:CERT`. The county "done" test in the playbook already asks for the **share of notices matched to a known bank or servicer**. Each run should carry that share. Below a threshold (placeholder 80%), the county's variables are shadows.

### 3.4 CMBS

| Variable | Scope | Computation | Use |
|---|---|---|---|
| `ssBalanceInBox`, `noteSaleCount`, `dispositions12m`, `maturing18mWeak` (DSCR under 1.0) | Per servicer | From `loans.json` and `dispositions.json`, in buy-box metros and sectors | A **servicer score**, a separate list (E4-S3, not built). Servicers are a different kind of seller. |
| `metroStress[m, sector]` | Per metro and sector | Special-servicing balance ÷ balance; new transfers this quarter; delinquency rate; share maturing in 18 months | The market pack (E20), and a metro modifier |
| `metroStressExposure` | Per bank | Σ over metros m of weight[bank][m] × metroStress[m] (section 3.1) | A **shadow** timing variable. Not backtestable until CMBS history is kept month by month **[verify: today only the latest month and the dispositions are kept]**. |

### 3.5 New variables from FDIC data already pulled (cheapest first)

| Variable | Axis | Formula | Transform | Replayable in the backtest |
|---|---|---|---|---|
| `buyboxStatusRatio` | distress | (P3 + P9 + nonaccrual on the multifamily and nonfarm nonresidential lines) / their balances, the D-P3 loan stages | linear | Yes (Call Report fields) |
| `buyboxDistressedDollars` | fit ("size of the prize") | The same numerator in dollars (`statusEligible` in `src/paper.mjs`) | **log**: points = w × min(log(1 + $/floor) / log(1 + full/floor), 1), with floor $1 million and full $25 million, both placeholders | Yes |
| `buyboxOreoRatio` | distress | (`OREMULT` + `ORENRES`) / bought balances | linear | Yes |
| `largeLoanShare` | fit | (`LNRENRES` − `LNRENR4`) / `LNRENRES`, at the latest June or December report | linear | Yes (semiannual) |
| `problemAssetsToCapital` | distress | (`NCLNLS` + `ORE`) / (`RBCT1J` + `LNATRES`) | linear | Yes **[verify the panel carries these fields]** |
| `concentrationScreen` | distress | 1 if either test is met (section 2, row 2) | flag | Yes **[verify the growth base]** |
| `acquiredMetroBank` | timing | Target's last CRE, decayed by 0.5^(age ÷ 2 quarters) | decay | Yes (dated events) |
| `distressedHeldForSale` | timing | 1 if `NALNSALE` + `P9LNSALE` > 0 | flag | Yes |
| `modifiedCreRatio` | distress | (`RSMULT` + `RSNRES`) / (`LNREMULT` + `LNRENRES`), June or December | linear | From 2023 only (series break) |
| `activeOrder` | distress ("pressure") | 1 while a consent order, cease-and-desist or written agreement is in force | flag | Only once orders are replayed by date (D-E1) |

---

## 4. How rerunning works today

### 4.1 What starts a scoring run

| Trigger | How | Waits for | Notes |
|---|---|---|---|
| **Weekly** | GitHub Actions, Mondays 13:41 UTC: queues `sources.fdic`, then `score.run` (with `--draft-buybox` unless `SCORING_STRICT` is true), then `triage.run`; runs them oldest first; then verifies the FDIC data | Nothing | Runs every Monday, new quarter or not. If the FDIC job fails, scoring still runs on the stored data. |
| **Web app** | Status page, **Queue scoring** button (with a "draft buy box" box) → `enqueue_job('score.run')` | The next hourly worker run: weekdays 12:17 to 23:17 UTC. A button pressed on Friday evening runs on Monday. | There **is** a rescore button. What it lacks is listed in 4.9. |
| **Command line, platform** | `outbound enqueue score.run [--draft-buybox]` | The next hourly worker run, or a manual `workflow_dispatch` | |
| **Command line, local** | `outbound score run [--draft-buybox]` against `OUTBOUND_DATA_DIR` | Runs at once | Writes the local data folder, not the platform (use `platform push`). |
| **Not a trigger** | A merged change to `buybox.json` or `scoring.json`; a CMBS pull (the 20th); enforcement orders (the 3rd); merger applications (Saturdays); SEC filings (daily, if enabled); FDIC loan sales (Wednesdays, if enabled) | The next Monday | The workflow's own comments say so ("Scoring the next Monday shows the new orders"). |

### 4.2 One run, end to end (the platform)

```
worker claims score.run (oldest queued job; one at a time: concurrency group "platform-worker")
  │
  ├─ unitOfWork(LOADS.score = sources/, candidates/, paper/, sales/, regulatory/)
  │     loads every document and log line under those prefixes into memory
  │
  ├─ runScoring({ buybox, scoring, metros from the repo checkout at main, now })
  │     validate rules → score every bank (scoreBank) → list failed banks
  │     → candidates/latest.json                     (always rewritten: new runId and scoredAt)
  │     → paper/fdic-<CERT>.json                     (only where the content changed, ignoring runId and scoredAt)
  │     → regulatory/<key>.json                      (every bank with orders or mergers; stale ones emptied)
  │     → audit.jsonl: scoring_run, with counts
  │
  ├─ plan → flushBatches(4 MB) → flush_uow, one call per batch
  │     paper/ and regulatory/ first; candidates/latest.json and the log lines last
  │     flush_uow → project_candidates() → table public.candidates (what the web list reads)
  │
  └─ finish_job(ok, { banks, tierA, tierB, untiered, provisional, latestRepdte })   counts only, never names
```

### 4.3 What a run reads

| Input | Path | Used for |
|---|---|---|
| Rule files (from the repo) | `buybox.json`, `scoring.json`, `metros.json`, `filings.json` | Everything |
| Bank list | `sources/fdic/institutions.json` | Who is scored; the filters |
| Branches and deposits | `sources/fdic/footprint.json` | Metros, `metroDepositShare`, the metro filter |
| Call Reports | `sources/fdic/financials/<CERT>.json` (every quarter ever pulled, plus a growth base 12 quarters back) | Metrics, profile, paper |
| Structure events | `sources/fdic/events.json` | Acquisition signals; paper Q6 |
| Failures | `sources/fdic/failed.json` | Failed-bank list |
| SEC filings and filers | `sources/edgar/filings.json`, `filers.json` | Filing signals |
| Sale ledger | `sales/ledger.json` | Sale signals |
| Enforcement orders | `sources/enforcement/orders.json`, `fdic-orders.json`, `occ-orders.json`; `candidates/aliases.json` | Enforcement signals; regulatory records |
| Merger applications | `sources/mergers/applications.json` | Merger signals; regulatory records |
| Previous paper records | `paper/` | To skip unchanged ones |

`LOADS.score` loads all of `sources/`, including CMBS loans and the ever-growing `sources/runs.jsonl` and `changes.jsonl`, which scoring does not read. **[verify the size today]**

### 4.4 What a run recomputes

Everything, for every bank, from stored data:
- metrics and changes;
- state signals (recomputed at the latest quarter);
- event signals (kept by date and shown while within their window of today's date);
- the profile, the 11 components, axes, score, filters, tier and card;
- the failed-bank list;
- a paper record per bank;
- a regulatory record per bank with orders or open merger applications.

Nothing is incremental. The work takes seconds: the backtest measured about 0.4 ms per bank. The cost is in loading and saving.

### 4.5 What a run writes

| Output | Size (from code comments, **[verify current]**) | Rewritten when | Read by |
|---|---|---|---|
| `candidates/latest.json` | About 8.7 MB | Every run | Candidates pages (through `public.candidates`), triage, coverage, call prep |
| `paper/fdic-<CERT>.json` | About 140 KB each, 268 banks | Only when the content changed. A rule change rewrites nearly all (about 41 MB in all). | Candidate page, `paper show`, the briefer |
| `regulatory/<key>.json` | Small; about 22 banks | Every run, for banks with orders or mergers | The briefer, call prep, the guard |
| `audit.jsonl` | One line | Every run | Audit |
| `public.candidates` (Postgres) | One row per bank | Every run: rows not in the list are deleted, the rest are upserted | Web Candidates list |
| `triage/<date>.json`, `triage/state.json` | | By `triage.run`, not by scoring | This week page |

### 4.6 Idempotency, versions and safety

| Mechanism | What it does | Limit |
|---|---|---|
| Determinism | `scoreBank` gives the same output for the same inputs and date (tested) | Event-signal windows depend on the run date, so a run a day later can show different signals, but never different points. |
| `runId` | `score-<timestamp>` | Time-based, not content-based. Two identical runs get two ids. |
| `buyboxHash`, `scoringHash` | 16-hex SHA-256 of each file, stored in `candidates/latest.json` | **Never compared** with the current files. Not in the audit line, the job result, the paper record or `public.candidates`. `scoringHash` includes `_note` text, so editing a note changes it. |
| Unchanged paper records | Not rewritten | Their `runId` names the run that last changed them. |
| Validation | Rule errors stop the run; placeholders stop it unless it is a draft | |
| Concurrency | One worker at a time; `claim_job` skips locked rows; a conflicting document makes the run reload and retry once | Two queued `score.run` jobs both run. Nothing removes the duplicate. |
| Batching | `flushBatches`: 4 MB batches, the candidate list and log lines last; `service_role` statement timeout 120 s | If a batch fails, earlier batches stay written, so paper records can be ahead of the list. A rerun recomputes. (This is documented in `src/platform/client.mjs`.) |

### 4.7 When `buybox.json` or `scoring.json` changes

1. A principal's change is merged to `main`. The rule files live in the repository, and the worker checks out `main` on every run.
2. **Nothing happens until the next scoring run**, up to a week later.
3. That run validates the new files, records new hashes, and changes:
   - **Buy box:** fit values, the metro filter, the asset cap, and the paper record's in-box bounds and status (most paper records are rewritten: about 41 MB saved).
   - **Weights, fulls and tiers:** points and tiers only.
4. The old list is overwritten. Nothing keeps the old scores, except triage's snapshot of last week's **tiers and signal ids**.
5. The next triage reports each tier move as a change, **with no way to tell that the rules moved the bank rather than its data**.

### 4.8 Two behaviours to check

- **Dismissed banks come back each quarter.** A dismissed bank returns when a signal id appears that was not there at dismissal. State-signal ids include the quarter (`fdic:<cert>:<rule>:<repdte>`), so a signal still firing in the next quarter has a new id. Triage compares state signals by type and does not have this effect. **[verify which is intended]**
- **A slow filer drops out for a week.** A bank whose report for the newest quarter is not yet on file fails the "not current" filter until it is. **[verify how FDIC staggers publication]**

### 4.9 The gaps

| # | Gap | Effect | Weight |
|---|---|---|---|
| G1 | A rule change triggers nothing, and the hashes are never compared | The list can be scored with an old buy box for up to a week, and nothing says so | High |
| G2 | No score history per bank | The list is overwritten, so there is no trend, and no record of "what was the score when we called" for the outcomes report (E15-S4) | High |
| G3 | No explanation of a change | "Moved to Tier A" without the reason: data or rules, which component, which field | High |
| G4 | No what-if on today's data for a proposed rule change | A principal cannot see the effect of new weights or a new buy box before merging. The backtest leaves out fit. | Medium-high |
| G5 | The backtest gate is a convention | No CI check requires a `_calibration` note when weights change. The test checks the note only if present. No test workflow was found in `.github/workflows` **[verify where tests run]**. Adding the note changes `scoringHash`, so a report cannot cite the file's final hash. | Medium |
| G6 | Source pulls do not rescore | Enforcement, mergers, CMBS, filings and FDIC sales wait for Monday | Medium |
| G7 | A queued rescore waits for the hourly worker | Up to about 60 hours over a weekend | Medium |
| G8 | Variables are defined in 3–4 places | Adding one touches `metrics.mjs`, `score.mjs`, `candidates.mjs` (card) and `backtest/labels.mjs` (leakage) | Medium |
| G9 | Missing counts as zero | A data gap lowers a score. Critical once county coverage is uneven. | Low now, high later |
| G10 | Promoted accounts keep the promotion-time snapshot | `accounts/<id>.json` `pipeline` never updates when the bank is rescored | Medium |
| G11 | No no-op and no dedupe | Every run rewrites 8.7 MB even when nothing changed; duplicate queued jobs both run | Low-medium |
| G12 | Over-broad load | All of `sources/` loads, and it grows | Low-medium |

---

## 5. Proposed design: "rerun all the scoring"

### 5.1 Goals

- One command or job, **safe at any time**: the same inputs give the same output; nothing is saved if nothing changed; every run says why it ran.
- **Rules and data stay in step automatically:** a rule change or a source change queues a rescore, and the list says which rules it was scored with.
- **History and "what changed"** for every bank, in plain sentences from fixed templates, split into the effect of data and the effect of rules.
- **Weight changes cannot merge without evidence:** a holdout backtest of the exact new weights for distress and timing; a dry-run diff and a principal's name for fit and tiers.
- **One place to add a variable**, starting as a shadow.

Unchanged rules: no model in scoring; nothing reaches the drafter; job results hold counts only; prospect data stays out of the repository.

### 5.2 Module map

```
src/scoring/variables.mjs   NEW   the registry: every variable's definition (wraps METRICS, PROFILE_MEASURES, footprint)
src/scoring/transforms.mjs  NEW   linear | log | flag | decay  → points
src/scoring/rescore.mjs     NEW   rescore(): load → score → explain → write; inputsHash; dry run; reasons
src/scoring/history.mjs     NEW   append and read per-bank history; the content-addressed rule archive
src/scoring/explain.mjs     NEW   explainChange(): data effect vs rules effect; template sentences
src/scoring/gate.mjs        NEW   pointsHash(); calibration checks used by CI and by `score propose`
src/score.mjs               CHANGED  component() asks the registry; validateScoring checks against it; runScoring → rescore
src/backtest/labels.mjs     CHANGED  componentFields() reads the registry's field lists (leakage test)
src/backtest/run.mjs        CHANGED  records pointsHash and the registry version in runs.jsonl
src/platform/worker.mjs     CHANGED  checks rule hashes at start; queues score.run after a source run that changed something
supabase/migrations/…       NEW   one queued score.run at a time; (optional) score_history projection; score_delta column
.github/workflows/checks.yml NEW  tests and the calibration gate on pull requests
web: Status (stale-rules banner, preview), Candidates (Δ column), candidate page (History, What changed)
```

### 5.3 The variables registry

One entry per variable. A component in `scoring.json` points at a variable and gives it an axis, a weight and a transform.

```js
// src/scoring/variables.mjs
export const REGISTRY_VERSION = 1;   // bump when any compute() changes meaning; recorded with every run and backtest
export const VARIABLES = defineVariables({
  buyboxNoncurrentRatio: {
    label: 'Noncurrent ratio in the categories the buy box buys',
    unit: 'ratio',                    // ratio | change | usd | count | flag
    scope: 'bank',                    // bank | bank×metro | metro
    reads: { fdic: ['NCREMULT', 'LNREMULT', 'NCRENRES', 'LNRENRES'], rules: ['buybox.sectors', 'buybox.metros'] },
    replay: 'point-in-time',          // point-in-time | dated-events | none   (can the backtest rebuild it on a past date?)
    coverage: () => ({ covered: true }),
    compute: (ctx) => profileMeasure('buyboxNoncurrentRatio', ctx.profile),   // → { value, inputs: [{field, repdte, value}], missing? }
    card: (v) => `Noncurrent loans in the categories the buy box buys: ${pct(v.value)}.`,   // optional fixed template
  },
  noticesRecent: {
    label: 'Commercial foreclosure notices in 90 days, as a share of its recorded book',
    unit: 'ratio', scope: 'bank', reads: { county: ['NS', 'NOD', 'NED'] }, replay: 'dated-events',
    coverage: (ctx) => countyCoverage(ctx.county, ctx.key),          // { covered: false, why: 'no county adapter for Austin' }
    compute: (ctx) => noticeRate(ctx.county, ctx.key, { days: 90 }),
  },
  // … one entry each for today's 11 and every variable in sections 2 and 3
});
```

`scoring.json`, a component in the new form. The old form (`metric`, `source`, `measure`) is still read and mapped to a variable id, so nothing breaks.

```json
{ "id": "buyboxNoncurrentRatio", "variable": "buyboxNoncurrentRatio", "axis": "distress",
  "weight": 15, "full": 0.04, "transform": "linear", "status": "live" }
{ "id": "buyboxDistressedDollars", "variable": "buyboxDistressedDollars", "axis": "fit",
  "weight": 10, "full": 25000000, "floor": 1000000, "transform": "log", "status": "shadow" }
```

- `status: "shadow"`: computed, stored, shown on the card as "not scored yet", and in the backtest's per-component table. It earns 0 points whatever its weight. Turning a shadow live is a weight change, so the gate (5.7) applies.
- `validateScoring` checks: the variable exists; the axis is allowed; the transform fits the unit (log only for usd or count); there are no duplicates.
- The leakage test reads `reads` from the registry, so a new county variable automatically blocks the matching label kinds.
- The backtest's compact panel (E17 follow-up, step 2) pulls exactly the union of `reads.fdic`.
- `outbound score variables` lists the registry: id, label, fields, replayable or not, the components that use it, live or shadow.

### 5.4 One rescore job, safe at any time

```js
// src/scoring/rescore.mjs
export function rescore({ dir, rules, now, reason = 'manual', dryRun = false, force = false }) {
  const inputs = loadInputs(dir, rules);                           // the reads in 4.3, nothing else (narrows LOADS.score)
  const hashes = { scoring: contentHash(rules.scoring), points: pointsHash(rules.scoring),
                   buybox: contentHash(rules.buybox), metros: contentHash(rules.metros), registry: REGISTRY_VERSION };
  const inputsHash = contentHash({ hashes, data: dataHash(inputs), asOf: ymd(now) });
  const prev = readJson(join(dir, 'candidates', 'run.json'), null); // a few KB: the last run's meta and its full rules
  if (!force && !dryRun && prev?.inputsHash === inputsHash) return { outcome: 'unchanged', runId: prev.runId };

  const next = scoreAll(inputs, rules, ymd(now));                   // today's scoreBank for every bank, pure
  const changes = explainAll({ prev, next, rules, inputs });        // 5.6
  if (dryRun) { writeJson(join(dir, 'candidates', 'preview.json'), { hashes, changes }); return { outcome: 'preview', counts: count(changes) }; }

  writeOutputs(dir, next, changes);                                 // latest.json (with each item's `change`), changes.json,
                                                                    // paper/ and regulatory/ only where changed
  appendHistory(dir, next, { runId: next.runId, hashes, inputsHash, reason });   // scores/history/fdic-<CERT>.jsonl
  archiveRules(dir, hashes, rules);                                 // scores/rules/<hash>.json, written once
  writeJson(join(dir, 'candidates', 'run.json'), meta(next, { hashes, inputsHash, reason, rules, previousRunId: prev?.runId }));
  return { outcome: 'written', runId: next.runId, counts: count(changes) };
}
```

- **Reasons:** `schedule`, `manual`, `rules-changed`, `data:<source>`. They are kept in `run.json`, the history line and the job result.
- **The worker job** `score.run` takes `{ reason, dryRun, force, draftBuybox }`. Its result holds counts only: `{ outcome, banks, tierA, tierB, untiered, moved: { upToA, downToB, newA, dropped }, reason }`.
- **One queued at a time.** A migration adds a partial unique index on `jobs(kind) where status = 'queued' and kind = 'score.run'`. `enqueue_job` then returns the id already queued instead of adding a second.
- **Command line:** `outbound score run [--reason R] [--dry-run] [--force]`.
- **Web:** the Status page's button gains **Preview**, which shows `candidates/preview.json`: tier moves and the largest score changes.

### 5.5 Rescoring when the buy box or the weights change

```js
// src/platform/worker.mjs, at the start of work(), before claiming jobs
const meta = (await client.load(['candidates/run.json'])).docs['candidates/run.json'];
const want = currentHashes(rules);                                  // as in rescore()
if (!meta || !sameHashes(meta.hashes, want)) await client.enqueue('score.run', { reason: 'rules-changed' });   // deduped by the index
```

- **Belt and braces.** A workflow step on `push` to `main` touching `buybox.json`, `scoring.json` or `metros.json` runs the worker once, so the rescore lands within minutes, not at the next hourly run.
- **After a source run.** In `runJob`, a source job whose summary shows `changed > 0` or new records (enforcement, mergers, filings, CMBS, FDIC sales) queues `score.run` with `reason: 'data:<source>'`. Decision D-V4 is whether the principals want mid-week list changes. The default proposed is yes, with history explaining them.
- **The web shows staleness.** The Candidates and Status pages compare `run.json` hashes with the deployed rule files, and show "Scored with an earlier buy box (hash 9ab2…); a rescore is queued." Triage health gains the same line.
- **Before merging a change**, `outbound score diff --buybox PATH | --scoring PATH` runs a preview of the proposed rules on today's data and prints the tier moves and the top changes. It writes nothing outside the data folder.

### 5.6 Score history and "what changed"

**One history line per bank per run**, appended (an append needs no load in a unit of work), at `scores/history/fdic-<CERT>.jsonl`. On the platform these are `log_lines` rows, so one bank's history is one path read.

```json
{"runId":"score-20261123T134512Z","at":"2026-11-23T13:45:12Z","reason":"schedule","asOf":"2026-11-23","dataAsOf":"20260930",
 "hashes":{"points":"3f1c…","buybox":"9ab2…","registry":1},"inputs":"77de…",
 "score":52.7,"axes":{"distress":24.1,"timing":7.1,"fit":21.5},"tier":"A","filters":[],
 "c":{"buyboxNoncurrentRatio":[0.026,9.75],"creNoncurrentRatio":[0.024,6.0]},
 "signals":["cre-noncurrent-rising","concentration-cre"]}
```

`c` holds each component's value and points. That is about 600 bytes per bank per run, or about 8 MB a year for 268 banks run weekly.

**What changed: an exact split.** Scoring is deterministic and fast, so today's data can be scored again under the previous run's rules. Those rules are kept in `run.json` and archived by hash.

```
underOldRules = scoreBank(today's data, previous rules)
rules effect  = today's score − underOldRules.score     (the buy box or weights moved it)
data effect   = underOldRules.score − previous score     (a new quarter, an amendment, a new signal moved it)
rules effect + data effect = total change                (exact; any interaction is counted under rules)
```

```js
// src/scoring/explain.mjs
export function explainChange({ prevLine, prevRules, next, bankInputs, rules }) {
  if (!prevLine) return { kind: 'new', sentences: [`New on the list at ${next.score} (Tier ${next.tier ?? 'none'}).`] };
  const old = scoreBank({ ...bankInputs, scoring: prevRules.scoring, buybox: prevRules.buybox });
  return {
    from: pick(prevLine), to: pick(next),
    rules: { delta: next.score - old.score, components: diffPoints(old, next), changed: diffRules(prevRules, rules) },
    data:  { delta: old.score - prevLine.score, components: diffValues(prevLine.c, old),
             why: next.latestRepdte !== prevLine.dataAsOf ? 'new-quarter' : 'amended-or-new-signal' },
    signals: diffByType(prevLine.signals, next.signals),    // by type, as triage does: a new quarter alone changes nothing
    tier: tierReason(prevLine, next, rules.scoring.tiers),  // e.g. 'distress rose past 15'
    sentences: templates(…),                                // fixed templates, no model
  };
}
```

**Example card lines** (Saguaro Plains Bank, invented):
- "Score 41.2 → 52.7 (+11.5) since November 16. Data +8.0: a new quarter (September 30, 2026); noncurrent in the buy-box categories 1.9% → 2.6% (+2.6 points); early-stage delinquency 0.6% → 1.1% (+3.3 points)."
- "Rules +3.5: the weight of OREO in the buy-box categories went from 5 to 8 (scoring.json, PR #31)."
- "Tier B → A: distress rose past 15."

**Where it shows:**
- each item in `candidates/latest.json` gets `change`;
- `public.candidates` gets a `score_delta` column, and the list gets a Δ column;
- the candidate page gets a **History** table and a **What changed** box;
- triage findings carry the reason ("moved to Tier A because the weights changed" versus "because of new data");
- the outcomes report can read the score each bank had on the day it was promoted or called.

**Promoted accounts (G10).** History makes refreshing them safe: the account keeps its promotion snapshot and shows the bank's current score and its change since promotion beside it.

### 5.7 Weight changes gated by the backtest (E17)

The rule in E17: "Any change to a weight cites a holdout report in its `_calibration` note." It needs three code changes to be enforceable.

1. **`pointsHash(scoring)`**: a hash over what changes points or tiers only. That is each component's id, variable (or metric, source, measure), change, axis, weight, full, floor, transform and status, plus `tiers`. It leaves out every `_` key, labels, windows and card limits. So adding the `_calibration` note does not change the hash the report cites.
2. **The backtest records `pointsHash` and `REGISTRY_VERSION`** in each `backtest/runs.jsonl` line, beside today's `scoring` content hash.
3. **A CI gate** on pull requests that change `scoring.json`:

```js
// scripts/scoring-gate.mjs   (run by .github/workflows/checks.yml with the tests)
const base = JSON.parse(git('show', 'origin/main:scoring.json')), head = readJson('scoring.json');
if (pointsHash(base) === pointsHash(head)) pass('no weight, threshold, tier or variable change');
const changed = changedComponents(base, head);                          // ids whose points definition changed
const note = head._calibration ?? fail('weights changed: add a _calibration note naming a holdout report');
check(validateCalibration(note));                                       // the existing form check
const run = await platformRunLine(note.report);                         // backtest/runs.jsonl via the service key: counts only
require(run.pointsHash === pointsHash(head), 'the report scored a different file');
require(run.registry === REGISTRY_VERSION, 'the variables changed since the report');
require(run.mode === 'holdout' || (run.mode === 'rolling' && note.evaluation === 'rolling-origin'));
require(!run.reusedHoldout, 'a reused holdout is no longer an unseen test');
// fit and tiers cannot be backtested (fit has no history): they need a preview hash and a principal instead
if (changed.some(isFitOrTier)) require(note.preview && note.by, 'fit or tier change: cite `score diff` preview hash and who decided');
```

- **Secrets.** CI needs read access to `backtest/runs.jsonl` on the platform (a read-only key). The line holds counts and hashes only, no bank. **[verify that the service key may be used in a pull-request workflow; a separate read-only role is safer]**
- **`outbound score propose --scoring PATH`** does the legwork. It runs `score diff` (today's tiers), then `backtest run --compare` (training banks), then, once the principal chooses, `backtest run --holdout --scoring PATH`. It prints the `_calibration` stanza to paste: `{ report, evaluation, by, on, preview }`.
- **Before the first gated change**, the full 2006–2026 panel and labels must be built, and one training run read. **[verify: the docs record only a one-state live check]**
- **Shadow to live** is a weight change, so every new variable passes the same gate.

### 5.8 Adding a variable, start to finish

1. **Registry:** add an entry to `src/scoring/variables.mjs` (compute, reads, unit, replay, coverage, card template), with a test on invented values.
2. **Shadow:** add a component to `scoring.json` with `status: "shadow"`. It needs no gate, because points are unchanged and `pointsHash` treats a shadow as 0.
3. **Watch:** the next rescore shows it on cards as "not scored yet", and the history records its values.
4. **Backtest:** the per-component table shows whether banks where it is above 0 are labelled more often than the rest. Check the leakage test still passes.
5. **Go live:** a PR sets `status: "live"` and the weight, with a `_calibration` note citing a holdout report. The gate checks it. The merge queues a rescore (`rules-changed`), and every card says "Rules +x: <variable> now scores".

### 5.9 Phased plan

Effort is in working days for one developer with Claude Code. **These are rough estimates.**

| Phase | What | Effort | Depends on |
|---|---|---|---|
| **0** | Build the full backtest panel and labels (2006–2026); run a training backtest; read the per-component table with a principal (are #2, #4, #6 adding anything?) | 1–2 days, mostly running and reading | Nothing |
| **1** | **Safe rescore:** `candidates/run.json`; `inputsHash` and the no-op; reasons; the dedupe migration; the worker's rule-hash check and queueing after source runs; the push trigger; stale-rules banner on Status and Candidates; triage health line; narrow `LOADS.score` | 3–4 days | None |
| **2** | **History and what changed:** per-bank history lines; the rule archive; `explainChange` and its templates; `change` on items; the `score_delta` column; History and What changed on the candidate page; triage reasons; `score diff` and the Preview button | 4–5 days | Phase 1 |
| **3** | **Variables registry:** wrap today's 11 variables with no change in behaviour (a golden test: every score and card identical before and after); `variable`, `transform` and `status` in `scoring.json`; registry-driven validation, leakage test and panel field list; `score variables` | 4–6 days | Can run beside phase 2 |
| **4** | **The gate:** `pointsHash`; the backtest records it and the registry version; `checks.yml` (tests plus the gate); `score propose` | 3–4 days | Phases 0 and 3; a CI secret |
| **5** | **New FDIC variables as shadows:** `buyboxStatusRatio`, `buyboxDistressedDollars` (log), `buyboxOreoRatio`, `largeLoanShare`, `problemAssetsToCapital`, `concentrationScreen`, `acquiredMetroBank`, `distressedHeldForSale`, `modifiedCreRatio`; then backtest and a gated PR | 4–6 days, plus backtest cycles | Phases 3 and 4 |
| **6** | **County variables, Maricopa first:** the adapter against the bulk feed; matching to `fdic:CERT`; `noticesRecent`, `noticesInBox`, `reoTakenBack`, `assignmentsOut`, `lenderBook` and `lenderMapShare`, with coverage; shadows until D-V1 is decided and coverage is enough | Adapter 2–3 weeks after D7 and D8; variables about 1 week | Bulk account, counsel, phase 3 |
| **7** | **CMBS:** the servicer score (E4-S3); monthly CMBS history; `metroStress` and `metroStressExposure` as a shadow | 1–2 weeks | Phase 3 |

Phases 1–4 total about 3½ to 4 weeks, and deliver the rerun machinery. Phase 5 is where the score itself improves.

### 5.10 Risks

- **More rescoring means the list moves mid-week.** History and the What changed box make each move readable. D-V4 can keep Monday-only runs.
- **The CI gate needs platform read access** from a pull-request workflow. Use a narrow read-only role, never the service key, if that can be arranged. **[verify]**
- **Backtest power is thin.** About 20 labelled banks in the holdout is the bar (D-B4). Many shadow variables will read "too few to tune on". The gate then allows rolling-origin evidence, as E17 already does.
- **The rules effect counts interactions as rules.** This is stated on every explanation.
- **County coverage bias.** D-V1 must be decided before any county variable goes live.

---

## 6. Decisions for a principal

| # | Decision | Default proposed |
|---|---|---|
| D-V1 | A county variable where the county has no data yet: 0 points with a note (A), or neutral (B)? | **A**, with county variables kept as shadows until two or more counties are covered |
| D-V2 | Add an absolute-dollars variable (in-box distressed dollars, log scale, $1 to $25 million) | Yes, as a shadow (phase 5) |
| D-V3 | Consolidate the overlapping distress variables (#2, #4, #6) if the backtest shows they add nothing | Decide after phase 0 |
| D-V4 | Rescore mid-week when a source brings something new, or Mondays only | Mid-week, with history explaining it |
| D-V5 | Should a dismissed bank return each quarter while a state signal keeps firing (today's behaviour), or only on a new signal **type** (as triage does)? | By type |
| D-V6 | Are owner-occupied nonfarm nonresidential loans in the buy box? | Ask. If not, refine #1, #9 and #10 with `LNRENROT`. |
| D-V7 | Should a headquarters-state bank with no metro branch pass the metro filter (today's behaviour)? | Ask |
| D-V8 | The gate: block the merge, or warn? | Block for distress and timing weights; for fit and tiers, require a preview and a name |
| D-E1, D-S2 (open) | Points for enforcement orders, and for "has sold before" | Shadows now; live only after the backtest (orders) and county assignments (sales) |
