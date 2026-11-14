# PRD: the next five — a backtest, pressure at private banks, intermediaries, a market note, new sellers

**Status: draft v1, November 14, 2026.** A companion to `docs/prd-signal-pipeline.md`. It adds epics E17 to E21 and open questions Q19 to Q27, and keeps every rule in that PRD and in `docs/outbound-plan.md`. Where this document and either of them disagree, they win. Nothing here has been checked with a principal or with counsel. **[verify]** marks a claim not yet checked against a primary source. Every weight, threshold, window and count below is a **placeholder** unless it says otherwise.

**Readers:** the principals, who decide, and whoever builds it, including Claude Code sessions.

## 0. Why these five

The pipeline answers "which banks in our metros are under pressure" well. It is weaker on five other points, and each one weakens a link in the chain in section 0 of the main PRD:

| # | Gap today | Link it weakens | Epic |
|---|---|---|---|
| 1 | Every weight and tier cut in `scoring.json` is a placeholder. Tuning waits for 30 confirmed call outcomes (`config.outcomes.minToTune`). Those take quarters to collect, they will be few, and they only cover banks the firm chose to call. | 4. The institution | **E17** A backtest |
| 2 | The strongest "will sell" signal, the SEC filings listener (E13-S1), only sees SEC filers. Most banks under the $10 billion cap have no SEC filer **[verify: E18-S1 measures it]**. Enforcement orders and merger applications cover them, are free, and are rated **High** in `docs/data-sources.md`. Neither is built. | 3. The time | **E18** Pressure at banks the SEC never sees |
| 3 | The plan says intermediaries "hear first and control who is invited", and that mid-size banks sell through an advisor's buyer list. The pipeline only scores institutions, and the referral mapper (agent 7) is not built. | 2. The advantage, 5. The person | **E19** Intermediaries |
| 4 | Section 0 rightly bars a message from mentioning the recipient's numbers. That leaves a first touch with little to offer beyond "we buy multifamily loans in Phoenix". Nurture (E10) can only link to pages the firm has published, and the site names no principal. | 6. The message | **E20** A give-first market note |
| 5 | Credit unions and non-bank lenders hold CRE in our metros and are not covered. `docs/data-sources.md` calls NCUA "a seller class we do not cover yet", and decision D2 is open. | 1. The paper | **E21** New sellers |

**What does not change.**
- Nothing in this repository sends a message. A principal sends, and the guard records it.
- Prospect data never goes in the repository (README, "The data rule"). Every new store below lives in `OUTBOUND_DATA_DIR`.
- Research, signals and estimates shape **who** and **when**, never the text of a message. The drafter receives none of what these epics produce, and a handoff test proves it for each one.
- Every new adapter keeps the E2 contract: a recorded fake, the run log, field checks, the change log, a verify check, a worker job kind and a line in the schedule.

## 1. Epics

**Priority** and **release** mean what they mean in the main PRD (section 8). "Now" means it has no outside blocker and can start before R2 ships.

| Epic | Release | Priority | Depends on | Outside blockers |
|---|---|---|---|---|
| E17 A backtest of the score | Now | P0 | E3, E6, E13, E16 (built) | None for the FDIC labels. The SEC-derived label (`disclosed_sale`) waits for the SEC contact (Q11) and confirmed filers |
| E18 Pressure at banks the SEC never sees | Now (S1 to S3), R2 (S4) | P0 (S1, S2), P1 (S3, S4) | E2, E3, E6 | OCC API key (D3), for one source only |
| E19 Intermediaries | R2 | P1 (S1 to S4), P2 (S5, S6) | E4, E16, E15 | Approved claims for intermediaries; the credibility package (research agenda D9) |
| E20 A give-first market note | R3 | P1 | E3, E4, E16, E10, the website's news desk | Q24, Q25; the site live with a named principal |
| E21 New sellers | Now (S1, S3 spikes), later (S2, S4) | P1 (spikes), P2 (builds) | E2, E3, E6, E14 | D2 (credit unions in or out) |

**Suggested order:** E17-S1 to S4 and E18-S1 first. They need nothing from anyone (E17 starts with the FDIC labels only; see E17-S2), and E17 tells the principals whether the score is worth acting on before the first send. Then E18-S2 and S3, then the E21 spikes, then E19, then E20 once the site is live.

---

### E17. A backtest of the score

**Why.** Today the principals have no evidence about whether the score ranks banks well. The outcomes report (E15-S4) is the right final judge, but it is slow, small and biased. Public data already holds a usable answer. Some banks in the last few years failed, were sold in an assisted deal, disclosed a CRE loan sale, or had the FDIC sell their loans. If the score, run on the data that existed at the time, ranked those banks highly a few quarters before the event, the score is earning its place. If it did not, the weights are wrong, and it is cheaper to learn that before a principal spends time on the list.

**The design, in one paragraph.** For each past quarter-end in a window, rebuild what the pipeline would have known on that date, run the **same** `scoreBank` from `src/score.mjs` on it, and compare the ranking with **labels**: dated events from sources the score does not read as features, inside a horizon after the as-of date. The output is a report a principal reads. **Nothing in this epic changes `scoring.json`.** A principal changes it, in a PR that cites the report.

**What the backtest can and cannot tell us.**
- It tests the **distress** and **timing** axes. It cannot test **fit**, because fit is about our buy box, which has no history. Fit is computed and shown, but kept out of the headline figures.
- Most labels are forced events (failure, assisted merger). "Forced to sell" is a stronger condition than "willing to sell", which is what outreach needs. So a good backtest result means the score finds pressure. It does not prove the score finds sellers. E15-S4 still decides that.
- Failures in six metros are few. The backtest therefore runs on a **wider universe** (section E17-S1) and reports the metro subset separately, marked as a small sample.
- The FDIC API serves Call Report figures as amended, not as first filed **[verify how often amendments move the fields we score]**. That is a small look-ahead leak, and the report states it.

**E17-S1. A point-in-time panel.** *As a principal, I want the bank data as it stood at each past quarter-end, including banks that have since failed or merged, so that the backtest is not flattered by survivors.* P0, Now.
- [ ] `outbound backtest panel --from 2021-03-31 --to 2026-06-30` pulls financials for every quarter in the window plus `scoring.json` `lookbackQuarters` before it, reusing `pullFinancials` and the FDIC client. The window is a placeholder.
- [ ] **Universe** (placeholder, decision D-B3): every bank active at any as-of date that was headquartered in our five states (`metros.json` `hqStates`), plus every bank with a Summary of Deposits branch in the six metros in the June before that date. Banks that later failed, merged or closed are **included**. A test with a fixture proves that a bank inactive today is in the panel for the quarters it was active.
- [ ] **Availability dates.** A quarter's Call Report counts as known only from quarter-end plus `config.backtest.callReportLagDays` (placeholder 60). Summary of Deposits counts as known from its release date, not from June 30. An event signal counts from its own date.
- [ ] Stored in `backtest/panel/` in the data folder, with the run log, field checks and the change log (E2). The panel is public data, but it is kept in the data folder with everything else, so no backtest file names a bank in the repository.
- [ ] A verify check: every as-of quarter has rows for at least `config.backtest.minCoverage` (placeholder 0.95) of its universe, or the run is `suspect`.

**E17-S2. Labels.** *As a principal, I want each label to be a dated event from a source the score does not read, so that the backtest is not grading the score on its own inputs.* P0, Now.
- [ ] A label is `{ key: 'fdic:CERT', kind, date, sources: [{ source, ids, link, date }] }`, written to `backtest/labels.json`.
- [ ] **Label kinds** (placeholders, decision D-B2):
  - `failure`, from `sources/fdic/failed.json` (all three failure sources, E3-S5);
  - `assisted_merger`, from `sources/fdic/events.json`;
  - `disclosed_sale`, from the filings listener's held-for-sale, loan-sale and note-sale searches only (E13-S1). EDGAR full-text search reaches back to 2001, so `outbound backtest labels --filings` runs those saved searches over the window for **confirmed filers only**. An 8-K Item 2.01 hit is **never** a label on its own: it reports an acquisition or a disposition, so the bank may have bought (E16-S3). It becomes a label only when a principal has read the filing and recorded that the bank sold. **This label kind needs the SEC contact (Q11) and confirmed filers.** Until both exist it is off, and the report lists it as unavailable rather than leaving it out silently;
  - `fdic_loan_sale`, an FDIC loan-sale announcement whose receivership matched the bank (E16-S2);
  - `enforcement_order`, once E18-S2 is built.
- [ ] Ordinary mergers are **not** labels by default. A merger may follow pressure or may not, and counting every merger would reward size.
- [ ] **No leakage.** A test checks that no label kind is derived from a Call Report field in `scoring.json` `components`. A charge-off spike, for example, is a feature, never a label.
- [ ] A bank with no label is **unlabelled**, not "safe". The report never calls it a true negative.

**E17-S3. The replay.** *As a principal, I want the current score run as it would have run at each past quarter-end so that I see what it would have told us.* P0, Now.
- [ ] `outbound backtest run [--scoring PATH] [--horizon 4]` runs, for each as-of quarter in the panel, `scoreBank` from `src/score.mjs` with only the data available on that date (S1), and an `asOf` set to that date.
- [ ] **One scorer.** The backtest imports `scoreBank`. It never copies or forks it. A test proves it, by checking that a change to a component's weight changes the backtest's output.
- [ ] Hard filters that depend on the buy box run with the buy box as it stands. Placeholders are allowed here, because the output is an analysis, not a list. Every output is marked `PROVISIONAL` while the buy box has placeholders, as `--draft-buybox` does today.
- [ ] `--scoring PATH` runs an alternative scoring file without touching the committed one. `--compare A B` runs two and reports them side by side.
- [ ] **A holdout, declared first.** `config.backtest.holdoutFrom` (placeholder: the last 4 as-of quarters in the window) is set before any comparison is run, and each run records it. `--compare` reports the training quarters only. The holdout quarters are scored once, for the scoring file a principal has chosen, with `--holdout`. A run with `--holdout` is recorded, and a second holdout run on the same quarters with a different scoring file is marked `reused holdout` in its report. A `_calibration` note may cite holdout figures only. If the holdout has fewer than `minLabels` labelled banks, the report says so and a rolling-origin split (train on quarters up to T, test on T+1 to T+4, for each T) is offered instead.
- [ ] Each run records the hash of each scoring file, the buy box hash, the panel's run id and the labels' run id, so a report can always be traced to its inputs.
- [ ] Cost: deterministic, with no model and no network after S1 and S2.

**E17-S4. The report.** *As a principal, I want one report that says whether the score ranks pressure well, which components carry it, and how early, so that I can choose weights from evidence.* P0, Now.
- [ ] Written to `backtest/report-<hash>.json` and `.md` in the data folder. `outbound backtest report` prints the summary.
- [ ] **The headline rank leaves out fit.** Tier A needs a fit threshold (`tierFor` in `src/score.mjs`), and fit has no history to test. So every headline figure ranks banks by their **distress and timing points only**. The backtest's groups are the top K by that rank (K placeholder 25) and the banks at or above the Tier A distress threshold. The current all-axis tiers are shown in a separate table, labelled context, and a `_calibration` note may never cite them.
- [ ] **Labels are incomplete, and the words say so.** Public sources miss many real sales, so the report never says "precision" or "recall". It reports:
  - the base rate: the share of banks in the universe with an observed label inside the horizon;
  - per group: the **observed-label yield** (the share of the group with an observed label), its lift over the base rate, and the **share of observed labels captured** (labelled banks that were in the group, out of all labelled banks);
  - **lead time**: for each labelled bank, how many quarters before its label it first entered the top K, as a distribution;
  - each figure **stratified by label coverage**: banks with a confirmed SEC filer (every label kind can be observed) apart from banks without one (only the FDIC kinds can). A difference between the strata is shown as a coverage effect, not a scoring effect;
  - the same figures for the metro subset, with its sample size.
- [ ] **Per component:** for each component in `scoring.json`, the labelled rate among banks where it scored more than zero against the rest, with counts. This shows which components carry the score and which add nothing.
- [ ] **Small numbers.** Below `config.backtest.minLabels` labelled banks (placeholder 20), a figure is shown with its count and the words "too few to tune on". The metro subset will usually say this.
- [ ] The report states its known limits every time, in fixed text: amended figures, labels that are forced events, the fit axis not tested, and unlabelled banks not being negatives.
- [ ] **It never writes `scoring.json`.** A PR that changes weights adds a `_calibration` note to `scoring.json` naming the report hash it relied on, and that report must be a holdout run. A test checks that the note, when present, names a hash of the right form.
- [ ] Job logs carry counts and run ids only (E11-S1).

**E17-S5. Calibration page.** *As a principal, I want to read the latest backtest in the web app so that I don't need the command line to see whether the score works.* P2, R2.
- [ ] A Calibration page, server-rendered from the stored report, linked from Status. It shows the headline table and the per-component table, with their counts.

**Decisions for a principal.**

| # | Decision | Default |
|---|---|---|
| D-B1 | The horizon: how many quarters after the as-of date a label counts | 4 quarters |
| D-B2 | Which label kinds count. Should ordinary mergers count at all? | Failure, assisted merger, disclosed sale, FDIC loan sale; mergers off |
| D-B3 | The universe: five states plus the metros' footprint, or every US bank | Five states plus footprint |
| D-B4 | How many labelled banks a backtest needs before a weight change may cite it | 20, in the holdout |
| D-B5 | The holdout: the last 4 quarters, or rolling-origin from the start | The last 4 quarters; rolling-origin if they hold too few labels |

---

### E18. Pressure at banks the SEC never sees

**Why.** The direct-sale route in the plan is for banks under about $10 billion in assets. Many of those banks are privately held and file nothing with the SEC, so the filings listener (E13-S1) cannot see them. For those banks, the score has only quarterly Call Report data, which arrives one to two months after quarter-end. Three free sources add dated events for them: enforcement orders, merger applications, and order terminations.

**E18-S1. Measure the gap.** *As a principal, I want to see how many candidates each signal source can see so that we build the sources that close the biggest gap.* P0, Now. **Built** (`src/coverage.mjs`, `outbound coverage [--json]`, the coverage card on the Status page). Its first result is not in yet: it needs real data.
- [x] `outbound coverage` reports, for Tier A, Tier B and all candidates: the count and share with a confirmed SEC filer, a rejected or unmapped one, any CMBS link (servicers), a sale-ledger event, and, once built, an enforcement record.
  - Each share states its denominator ("3 of 12 (25.0%)"). A group with no bank shows "0 of 0" and no share. With no candidate list, every count is 0 and the report says there are no candidates yet.
  - "All candidates" is every bank in the latest scoring run, untiered ones included. Suppressed banks, and banks a principal has snoozed, dismissed or promoted, are counted too.
  - A CMBS link is the bank named as a special servicer, in `sources/edgar/servicers.json` or as the servicer of a CMBS liquidation in the sale ledger. The match is by exact name or by an alias a principal added. Primary servicers and originators are not counted.
  - A sale-ledger event is the bank as the seller that acted, as `outbound sales sellers` shows. An acquirer is not counted.
  - The enforcement line says "not built", never 0, until E18-S2 is built.
  - A store that does not exist yet (the filer map, the CMBS pull, the sale ledger) is named as "not run yet", so a 0 on its lines is not read as a measurement.
- [x] Deterministic, from stored data, with no network. Shown on the Status page. The report has counts only and names no bank. The load list is `LOADS.coverage`: five exact files and no folder.
- [ ] Its first result goes in this PRD, replacing the **[verify]** in section 0.
  - A principal fills this in from the first `outbound coverage` run on the real data folder. The tests use invented banks only, so they cannot fill it. The Tier A share with a confirmed SEC filer from that run is also the baseline for the "Coverage of private banks" metric in section 3.

**E18-S2. Enforcement orders.** *As a principal, I want every public enforcement order against a bank in our universe recorded, with its type and date, so that I know when an examiner has told a bank to cut its problem assets.* P0, Now (no-key sources), R2 (OCC).
- [ ] **Sources**, from `docs/data-sources.md` 2.2, built in this order:
  1. the Federal Reserve's enforcement search and RSS (no key);
  2. FDIC's monthly orders at orders.fdic.gov (no API: HTML and PDF);
  3. the Texas Department of Banking and California DFPI list pages;
  4. the OCC API (`api.occ.gov/EnforcementActions/list`), once the free key is opened in the firm's name (D3). The key lives in the worker's secret store.
- [ ] **A spike first** for each source (the E2 pattern): `robots.txt` and terms read and dated; the fields a record carries; whether it gives an FDIC cert, an RSSD ID or only a name; and how a termination is published. The findings are written at the top of the adapter, as in `src/sources/efts.mjs`.
- [ ] **One record per order:** regulator, type (consent order, cease and desist, formal written agreement, prompt corrective action directive, civil money penalty against the bank, termination), the order date, the bank, a link, and for a termination, a link to the order it ends. Stored in `sources/enforcement/orders.json`.
- [ ] **Matching a bank.** By FDIC cert or RSSD ID where the source gives one. Otherwise by name, state and city through `matchInstitution` in `src/candidates.mjs`. Two candidates, or none, go to a for-review list (`outbound enforcement unmatched`). A principal resolves each by adding an alias (`addAlias` in `src/candidates.mjs`; a CLI command for it is part of this story). Nothing is guessed.
- [ ] **Actions against individuals are not stored.** Prohibitions, removals, and penalties against a named person are skipped when the record is parsed. A test with a fixture proves that no person's name from an order reaches the store, the run log or the change log. The briefer's risk screen already looks for "an adverse action against the named person" on the open web (`src/research.mjs`).
- [ ] **Flags, not text.** Where the order's text can be read, the adapter records which fixed phrases appear in it: "commercial real estate", "concentration", "classified assets", "special assets", "problem assets". It stores the flags and the page numbers, not the text. The phrase list is a placeholder in `config.enforcement.flags`.
- [ ] **Signals.** A new order is an **event** signal, `type: 'enforcement'`, on the bank's candidate. An order with no recorded termination also gives a **state** signal, "under an active order", which ends when its termination is recorded. Both are stated on the card from fixed templates.
- [ ] **Into scoring:** signals only, with no points, until a principal decides (D-E1). That is the rule the filings listener follows.
- [ ] E2: a fake per source shaped like the real pages, field checks, the change log, and `outbound sources verify enforcement` (fresh, every stored order found again, every order matched or on the review list).
- [ ] Worker job `sources.enforcement`, monthly, with its migration and a line in the schedule.

**E18-S3. Merger applications.** *As a principal, I want to hear about a bank merger when it is applied for, not when it closes, so that I can be in front of the acquirer before it decides what to do with the target's CRE book.* P1, Now.
- [ ] Sources: the Federal Reserve's press-orders RSS (`federalreserve.gov/feeds/press_orders.xml`), the H.2 weekly release, and the OCC Weekly Bulletin. A spike first, as in S2.
- [ ] Each application becomes an event signal, `type: 'merger_pending'`, on the target and on the acquirer, with the filing, approval and, later, close dates.
- [ ] When the merger closes and appears in `/history` (E3-S6), the existing structure event takes over, and the pending signal links to it. A test proves the merger is never counted twice.
- [ ] A withdrawn or denied application ends the signal, with its date.
- [ ] Worker job `sources.mergerapps`, weekly.

**E18-S4. To the briefer and the call brief, never to the drafter.** *As a principal, I want the briefer and the call brief to know about an order or a pending merger so that I do not walk into a call unaware.* P1, R2.
- [ ] Orders and pending mergers go to the briefer and the call brief (E15-S1) as fenced data, with ids, the way the paper estimate does.
- [ ] **The drafter receives none of it.** A handoff test, like `test/handoff.test.mjs`, proves no order, flag, link, type or date reaches it.
- [ ] The linter rejects any draft that contains "consent order", "enforcement", "regulator" or "cease and desist", by adding them to `terminology.json` `banned` (read by `src/lint.mjs`). The list is a placeholder.

**Decisions for a principal.**

| # | Decision | Default |
|---|---|---|
| D-E1 | Does an order add points, on which axis, and does an active order count more than a new one? | Signals only, no points |
| D-E2 | Open the OCC API key in the firm's name (data-sources D3) | Not opened; the OCC source waits |
| D-E3 | Does a bank under an active order get a different first-touch rule (for example, letters only, or no touch until a principal reviews)? | No change, but the card shows it |

---

### E19. Intermediaries

**Why.** Group B in the plan: loan-sale advisors, special servicers' asset managers, receivers, creditors' rights counsel. They hear about sales first and control who is invited to bid. One relationship can bring deals from many sellers. The plan also says mid-size and larger banks often sell through an advisor's process, where the way in is to be on the advisor's buyer list. Today the pipeline records some of these firms (the FDIC sale pages name the advisor; the CMBS data names the special servicer) and does nothing with them.

**The design, in one paragraph.** An **intermediary** is a firm, never a person: people wait for the contact rules of E7. Each time a stored source shows a firm acting for a seller, that is a **mandate**: a dated record with its source. A deterministic ranking orders firms by their mandates in our metros and buy-box sectors. For loan-sale advisors, a **registration tracker** follows the firm's steps onto each advisor's buyer list. A bank candidate that has sold through an advisor is shown with that route, so a principal knows whether to approach the bank directly or through the advisor.

**E19-S1. The registry and its mandates.** *As a principal, I want every firm that has acted for a seller in our market listed, with the mandates that show it, so that I know who runs the sales here.* P1, R2.
- [ ] `intermediaries/registry.json` in the data folder, keyed `intermediary:<slug>`, with a kind (`loan_sale_advisor`, `special_servicer`, `receiver`, `lender_counsel`, `trustee_counsel`), a display name and aliases. Aliases are added by a principal, as for candidates.
- [ ] `outbound intermediaries build` rebuilds it from stored data only, with no fetching. **Feeders**, each a function from stored records to mandates:
  - the FDIC loan-sale announcements' advisor (E16-S2), as `loan_sale_advisor` for the FDIC as seller;
  - the CMBS special servicers (`sources/edgar/servicers.json`), as `special_servicer` for each trust, with the loans in our metros and sectors;
  - listing advisors (E16-S8), when that feeder exists;
  - county records (E5), when they exist: the lender's counsel on a Colorado election and demand, and receivers in court filings (plan 3.2, step 2);
  - a principal's confirmation that a firm acted for a named seller, with the date and how they know it, audited with their name.
- [ ] **Referrals are not mandates.** A `wrong_person` call outcome (E15-S2) says only that the person does not decide, and may say who does. When a principal enters the firm it names, it is stored as a **referral**: evidence of a route to that seller, kept apart from mandates. Referrals are shown on the firm's page and never count toward the ranking (S2). The model's free-text referral is never parsed into the registry.
- [ ] A mandate is `{ intermediary, kind, seller, date, metro?, propertyType?, balance?, sources }`, and each one has a stable id, so a rebuild never counts one twice.
- [ ] No person's name, phone number or email address is stored. The FDIC adapter already cuts the contacts block off before parsing (E16-S2), and a test proves the registry holds none.

**E19-S2. The ranking.** *As a principal, I want intermediaries ranked by how much of our market's selling they handle so that I spend relationship time where the flow is.* P1, R2.
- [ ] Deterministic, with no model. The weights live in `intermediaries.json`, all placeholders: mandates in our metros, in buy-box sectors, distinct sellers served, recency (a half-life in months), and total balance where known.
- [ ] Each firm shows its score by component, and each component lists its mandates with sources, as the candidate card does.
- [ ] `outbound intermediaries list [--kind K]` and `intermediaries show --key KEY`.
- [ ] The Servicers page in the web app becomes an Intermediaries page, with a filter by kind. Existing servicer links keep working.

**E19-S3. Buyer-list registration.** *As a principal, I want to track where we are on each advisor's buyer list so that we are invited to the sales they run.* P1, R2.
- [ ] For each `loan_sale_advisor`, a state recorded by a principal and audited with their name and date: `not_started`, `requested`, `agreement_in_review`, `agreement_signed`, `proof_of_funds_sent`, `registered`, `declined`. The re-certification date, if the advisor sets one, raises a reminder on the Status page before it passes.
- [ ] **The agreement itself is never stored here.** Only the state, the date and who recorded it.
- [ ] Any asset or seller learned under an advisor's agreement is added to the existing NDA list, so the guard blocks touches about it, by the rule in plan section 7.
- [ ] Moving to `proof_of_funds_sent` is refused until a principal records that the credibility package (research agenda D9) is approved.

**E19-S4. The route to a seller.** *As a principal, I want a bank candidate that has sold through an advisor to say so, so that I approach it the way it sells.* P1, R2.
- [ ] When a sale-ledger event names both a seller and an advisor, the seller is linked to the advisor.
- [ ] The candidate card and the paper estimate's Q6 (seller evidence) show a **route**:
  - `unknown`, the default. No advisor seen is not evidence of a direct sale: the listing feeders are not built and SEC-disclosed sales name no advisor;
  - `advisor`, when a mandate shows an advisor acting for this seller, with the firm and the date of its last mandate;
  - `direct`, only when a principal records evidence that the seller sold without an advisor, with the date and how they know it;
  - `both`, only when both kinds of evidence are present.
- [ ] Where the route is `advisor` and the firm is not `registered` (S3), the card says so.
- [ ] The route is principal context only. The drafter receives nothing from it, and a handoff test proves it.

**E19-S5. Intermediaries as accounts.** *As a principal, I want to approach an intermediary through the same guard, drafter and caps as a bank, so that the discipline is the same for every touch.* P2, R2.
- [ ] An intermediary can be promoted to an account with audience `intermediary`. It then goes through research, the role check, drafting, the guard and the caps unchanged.
- [ ] The drafter refuses an `intermediary` draft until `claims.json` holds approved claims for that audience.
- [ ] The intermediary's mandates are research context. Like every signal, they never appear in the message.

**E19-S6. Warm paths (the referral mapper, plan agent 7).** *As a principal, I want to see which of my own contacts work at or with a ranked intermediary so that I can ask for an introduction.* P2, R3.
- [ ] Reads a principal's contact export only with their written consent, recorded with a date, and only from the data folder. It matches on company name and email domain against the registry.
- [ ] It drafts the request **to the connector**, never a pitch to the target, and caps asks per connector (placeholder: one a quarter).
- [ ] Design only in this PRD. A separate story will set its data rules before it is built.
- **Built in part as E22** (`docs/prd-signal-pipeline.md`, routes to the decision-maker): the firm's network, matching and a checklist, with its data rules. Differences from this story are open decisions there: nothing is drafted to the connector (D-R7), there is no cap per connector in code (D-R8), and the network is entered by hand rather than read from a contact export (D-R9).

**Decisions for a principal.**

| # | Decision | Default |
|---|---|---|
| D-I1 | Which intermediary kinds are in scope first | Loan-sale advisors and special servicers |
| D-I2 | Who owns buyer-list registrations and proof of funds | A named principal; nothing until D9 is approved |
| D-I3 | The ranking's weights and recency half-life | Placeholders |

---

### E20. A give-first market note

**Why.** The firm already gathers data a bank credit officer would find useful in aggregate: CRE delinquency by metro, CMBS special-servicing transfers by property type, and dispositions. A short quarterly note, made only from aggregates and naming no institution, gives a principal a reason to be in touch that asks for nothing. It also gives the site something a bank officer can check on their first visit, which the plan (section 9) says is missing. The rule from section 0 holds: a message never says anything about the recipient's own numbers. A note about a metro is not about the recipient.

**The boundary.** This repository computes the **data pack**. The website repository's news desk writes and publishes the note, under its own voice guide, linter and review gate. This repository never publishes anything. A nurture touch links to the note once it is live and in `site-snapshot/pages.json` (E10-S2).

**E20-S1. The data pack.** *As a principal, I want a quarterly pack of aggregate figures by metro and sector, each sourced, so that the news desk can write the note from facts we can stand behind.* P1, R3.
- [ ] `outbound market pack --quarter 2026-06-30` writes `market/<quarter>.json` and a `.md` table to the data folder.
- [ ] Per metro, and per buy-box sector where the data allows:
  - FDIC: CRE noncurrent and nonaccrual ratios, with the bank count and the change on the quarter and the year. Call Reports are whole-bank figures, and branches show where a bank takes deposits, not where it lends (`PROFILE_LIMITS` in `src/score.mjs`). So a bank's balances are **never summed whole into each metro it has a branch in**. One method is used, labelled a deposit-share proxy: each bank's balances are split across the metros by its share of deposits there, with the rest going to "elsewhere". The shares sum to 1, so each dollar is counted once. The pack states the method and its limit beside every FDIC figure;
  - CMBS: balances and loan counts in special servicing by property type, and new transfers in the quarter;
  - CMBS dispositions in the quarter, by count only (see S2).
- [ ] Every figure carries its source, its as-of date and its method, as in the paper estimate (`docs/paper-estimate.md`).
- [ ] Deterministic, with no model.

**E20-S2. The disclosure guard.** *As a principal, I want the pack to refuse any figure that could point to one bank or one loan so that the note never names a distressed party by arithmetic.* P1, R3.
- [ ] **FDIC cells:** a cell built from fewer than `config.market.minInstitutions` banks (placeholder 5), or in which one bank is more than `config.market.maxShare` of the total (placeholder 0.5), is suppressed and shown as "not shown: too few sources".
- [ ] **CMBS cells** have their own guard, because their records are single loans: a cell needs at least `config.market.minLoans` loans (placeholder 10), `minTrusts` trusts (placeholder 3) and `minServicers` special servicers (placeholder 2), and no one loan may be more than `maxShare` of its balance.
- [ ] **Complementary suppression.** When a cell is suppressed, enough other cells in the same row or column are suppressed that no total or difference can rebuild it. A change on the quarter or the year is suppressed when the cell is suppressed in either period. A test proves that no suppressed cell can be recovered from the published totals and changes.
- [ ] No bank, servicer, trust, property, address or person appears in the pack. Tests with fixtures prove that a metro where one bank dominates, and a property-type cell holding one large loan, are both suppressed.
- [ ] **Left out by default:** failures, FDIC loan sales and implied recoveries. The voice guide forbids riding a closure or a failure, and D-S5 has not settled whether recoveries can be shown even to principals. Each can be turned on only by a principal's decision (D-M2).

**E20-S3. The handoff to the news desk.** *As a principal, I want the pack in the form the desk uses so that the note is written there, under the desk's review.* P1, R3.
- [ ] `outbound market export --quarter Q` writes the pack's tables in the desk's input format **[verify the format in the website repository]**, to a path a principal chooses outside this repository.
- [ ] The export includes the source list and the suppression notes, so the desk's review can check every figure.

**E20-S4. Nurture links to it.** *As a principal, I want a nurture touch to share the latest note so that a follow-up is worth reading.* P1, R3.
- [ ] Once the note's page is in `site-snapshot/pages.json`, E10-S2 nurture drafts may link to it.
- [ ] A nurture draft links to the note and quotes no figure from it. The linter already rejects a figure that is not in a cleared fact (`src/lint.mjs`); a test confirms it does so for a nurture draft that quotes the note.
- [ ] The same note can go to Group B intermediaries (E19-S5) under the same rules.

**Decisions for a principal.**

| # | Decision | Default |
|---|---|---|
| D-M1 | Publish a market note at all, and under whose name | Not published; the pack can still be built for principals |
| D-M2 | Which sections the note may carry beyond the defaults (failures, FDIC sales, recoveries) | Defaults only |
| D-M3 | The disclosure thresholds | 5 institutions; no one over half |

---

### E21. New sellers: credit unions and non-bank lenders

**Why.** Credit unions hold commercial real estate in our metros, report it quarterly to the NCUA, and are not covered. The plan also says much of the multifamily stress sits with bridge lenders, their CLOs and debt funds, which the pipeline does not see. Both are cheap to **measure** before anyone decides whether to build. Decision D2 in `docs/data-sources.md` (credit unions in or out) defaults to "not in scope". This epic's spikes give the principals the numbers to decide it.

**E21-S1. NCUA spike.** *As a principal, I want to know how much CRE the credit unions in our metros hold, and how distressed it is, so that I can decide whether they are sellers we want.* P1, Now.
- [ ] Download one quarter of NCUA 5300 data (ncua.gov quarterly ZIP of CSVs) and record, with dates:
  - the files and the account codes for non-owner-occupied CRE, construction and development, member business loans, delinquency buckets and charge-offs **[verify each code against NCUA's account definitions]**;
  - whether branch locations are published, and in which file **[verify]**, since metro presence depends on it;
  - the publication lag (70–76 days was seen) and whether figures are amended.
- [ ] Count the credit unions with a branch or headquarters in the six metros, their total CRE, and their noncurrent CRE. Put these beside the same totals for banks under the asset cap.
- [ ] Check the member business lending cap **[verify: 12.25% of assets under the Federal Credit Union Act, with exceptions]**. A credit union near its cap has a reason to shed loans, which could be a fit signal of its own.
- [ ] Findings go in `docs/data-sources.md`, with a recommendation on D2. No adapter is built in the spike. Spike data stays in the data folder.

**E21-S2. The NCUA adapter and scoring.** *As a principal, I want credit unions scored and listed beside banks so that I can work them the same way.* P2, after D2 says yes.
- [ ] `outbound sources run ncua`, keyed `ncua:<charter>`, with the full E2 contract.
- [ ] A `creditUnions` section in `scoring.json`, because the fields differ from the FDIC's. Credit unions are listed beside banks but labelled, and are never ranked on a component they do not report.
- [ ] A paper estimate (E14) for credit unions, tiered as reported, observed or inferred.
- [ ] The drafter refuses a `credit_union` audience until `claims.json` has approved claims for it. The site speaks to banks today.

**E21-S3. Non-bank lenders spike.** *As a principal, I want to know which non-bank lenders' CRE books can be seen in public data so that we know whether a paper profile is even possible for them.* P1, Now.
- [ ] For each class, record what public data shows, with dates and links:
  - **commercial mortgage REITs**: 10-K and 10-Q loan tables (property type, location, risk rating, maturity), and whether the SEC Financial Statement and Notes data sets carry them (`docs/data-sources.md` 2.1);
  - **CRE CLOs**: whether any loan-level reporting is public, or only offered privately under Rule 144A **[verify]**;
  - **debt funds**: what Form ADV and Form D show (existence and size, not the book) **[verify]**.
- [ ] A recommendation per class: build, watch, or drop. No adapter is built in the spike.

**E21-S4. Non-bank adapters.** P2. Stories written after S3, for the classes it recommends.

**Decisions for a principal.**

| # | Decision | Default |
|---|---|---|
| D2 | (From `docs/data-sources.md`.) Are credit unions sellers we want? | Not in scope until E21-S1 reports |
| D-N1 | Which non-bank classes, if any, after E21-S3 | None |

---

## 2. Definition of done

As in the main PRD, section 9, for every story. Also:
- Every new store is in `OUTBOUND_DATA_DIR`. The data-rule test covers each new path (`backtest/`, `sources/enforcement/`, `intermediaries/`, `market/`).
- Every new source of research has a handoff test proving the drafter receives none of it.
- Every new placeholder is marked as one in its file's `_note`.

## 3. Success metrics

| Metric | Target | How measured |
|---|---|---|
| A calibrated score before the first send | `scoring.json` carries a `_calibration` note naming a backtest report that a principal read | E17-S4 |
| Lift in the holdout | The top K by distress and timing has an observed-label yield at least 3 times the base rate, in the holdout quarters (placeholder, set after the first report) | E17-S4 |
| Lead time | The median labelled bank enters the top K at least 2 quarters before its label (placeholder) | E17-S4 |
| Coverage of private banks | The share of Tier A candidates with a dated event source (SEC filer, enforcement, merger application) at least doubles from the E18-S1 baseline | E18-S1 |
| Advisor registrations | Registered on the buyer lists of the top 5 ranked advisors within two quarters of D9 being approved | E19-S3 |
| Disclosure | 0 published cells that fail the disclosure guard | E20-S2, and the desk's review |
| A decision on D2 | Made within one quarter of E21-S1 reporting | Section 4 of this PRD |

## 4. Open questions

Numbered after the main PRD's Q18.

| # | Question | Who answers | Blocks | Default meanwhile |
|---|---|---|---|---|
| Q19 | The backtest's horizon, label kinds and universe (D-B1 to D-B3) | Principals | E17-S2, S3 | The defaults in E17 |
| Q20 | May weights change on the backtest alone, before 30 outcomes? (D-B4, D-B5) | Principals | Weight changes | Yes, with at least 20 labelled banks in the holdout and a `_calibration` note citing a holdout run |
| Q21 | Open the OCC API key in the firm's name (D-E2, data-sources D3) | Principals | E18-S2, OCC part | The no-key sources first |
| Q22 | Does an active enforcement order change how, or whether, a bank is approached? (D-E3) | Principals, then counsel | E18-S4 | No change; the card shows it |
| Q23 | Who owns the advisor registrations and the proof of funds? (D-I2) | Principals | E19-S3 | Nothing is sent to an advisor |
| Q24 | Publish a market note, and under whose name? (D-M1) | Principals | E20-S3, S4 | The pack for principals only |
| Q25 | Counsel's view on publishing aggregates of regulatory data, and on FRED if it is used | Counsel | E20 publication | Not published |
| Q26 | Are credit unions in? (data-sources D2) | Principals | E21-S2 | Not until E21-S1 reports |
| Q27 | Which non-bank classes, if any? (D-N1) | Principals | E21-S4 | None |

## 5. Hosts

Added to `docs/data-sources.md` section 7 when each adapter is built:

| Adapter | Hosts |
|---|---|
| Backtest | the FDIC and SEC hosts already listed |
| Enforcement | www.federalreserve.gov, orders.fdic.gov, api.occ.gov, apps.occ.gov, dob.texas.gov **[verify]**, dfpi.ca.gov **[verify]** |
| Merger applications | www.federalreserve.gov, www.occ.gov **[verify]** |
| NCUA | ncua.gov |
| Non-bank spike | www.sec.gov, efts.sec.gov |
