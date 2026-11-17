# Redesign of the principals' web app: proposal

A design proposal, November 17, 2026. Nothing in `web/` has changed yet. The founder's brief: the app should "look much better and be much more understandable".

The prototype (one HTML file, invented banks and numbers only) shows the new navigation, the bank list and the bank page. It is not in the repository; it is a private link, https://claude.ai/artifact/X2AenCNjqBTYzoENKLZFFv, shared from its Share menu.

## 1. Who uses it, and what they need to answer

The users are the firm's one to three principals. They buy distressed commercial real estate loans from banks. They are not engineers, and they use the app between calls, often on a laptop and sometimes on a phone.

Their core flow is: the bank list → one bank's page → outreach. Along the way they need to answer, quickly:

1. **Which banks should I call this week, and why?**
2. **How much of this bank's book could we buy?**
3. **What is going wrong at this bank, and is it getting worse?**
4. **What do I do next with this bank?**
5. **Can I trust this number, and where did it come from?** (Sometimes. Not on every number, every time.)

Today the app is careful and correct. It answers question 5 on every number, and it makes questions 1 to 4 hard to answer.

## 2. Problems found

Ordered by how much they get in the way. File paths are relative to `web/`.

### Navigation and structure

1. **Twelve navigation items of equal weight.** `app/layout.jsx` (lines 17–30) lists This week, Candidates, Intermediaries, Sales, Market, Accounts, Network, Approvals, Senders, Pilot, Calibration and Status in one flat row. Daily work, research and administration look the same. No link marks the current page (no `aria-current`). `/servicers` is in no menu; it is reachable only from a sentence on the Intermediaries page.
2. **Home goes to the wrong place.** `app/page.jsx` redirects `/` to `/candidates`, while the first navigation item is This week (`/triage`), the page built to answer "what changed and whom to call".
3. **Every bank tab has the same title.** `app/candidates/[key]/page.jsx` and `app/accounts/[id]/page.jsx` export no metadata, so every bank opened in a tab is "Valley Capital outbound".

### Language

4. **Internal and regulatory jargon on principal screens.**
   - Bank list (`app/candidates/page.jsx`): the column "D / F / T" (line 43), the engine key `fdic:12345` under every bank name (line 50), "Fails a hard filter" (line 52).
   - Bank page (`app/candidates/[key]/paper-estimate.jsx`): headings "Q1." to "Q8." (lines 34–191), "Paper estimate", "reported (E14-S1) · charter only", "scoring run {runId}", "Investor CRE (2006 guidance definition)", "Nonfarm nonresidential", "OREO", "noncurrent", "bounds", "tier".
   - Senders (`app/senders/page.jsx`): "CAN-SPAM" in a field label (line 15), "`outbound status`", "[CONFIRM]", "OUTBOUND_KILL" (line 38).
   - Status (`app/status/page.jsx`): job kinds in code font and raw JSON results (line 76).
   - Approvals and routes: rule codes such as `CODE: message` (`app/drafts/page.jsx`, `app/accounts/[id]/routes.jsx`).
5. **"Tier" means three different things.** A bank's tier (A, B), a number's tier (reported, observed, inferred, from `show()` in `lib/paper-view.mjs`), and a route's tier (`app/accounts/[id]/routes.jsx`). On the bank page the first two appear side by side.

### Hierarchy and density

6. **The answer comes last.** The bank page opens with a key-value panel (tier, a score formula, hard filters) and three forms. The answer to "how much could we buy?" is Q7, near the bottom of `paper-estimate.jsx`, after about ten sections. The paper estimate's own summary sits halfway down, with labels such as "Hotel loans in the buy box: bounds (provisional)".
7. **The bank page shows the same facts two or three times.**
   - Balances and stages by category: in "The paper: what this bank likely holds" (`page.jsx` line 57) and again in the Q1 table.
   - Deposits by metro: in "Where it operates" (`page.jsx` line 77) and again in Q3.
   - Signals: in the "Why now" card (line 51) and again in "Signals" (line 117).
8. **A source line under every number.** `Sourced` in `app/ui.jsx` prints the FDIC field and date as a block under each value (`.src { display: block }`, `globals.css` line 51). `V` in `paper-estimate.jsx` prints "tier · date" under each value. An eleven-column table becomes two lines per cell. The eye cannot find the numbers.
9. **The bank list cannot answer "which, and why" at a glance.**
   - "Why now" prints the whole card paragraph, which starts with "<Bank>: Call Report data as of <date>." in every row (`card` is the full `buildCard` text, `src/candidates.mjs`).
   - The score shows as "52.3", with no scale. "D / F / T" shows points with no maximums.
   - Nothing says how much of the bank's book could fit the buy box.
10. **Tables too wide for the screen.** The bank page's category table has eleven columns (category, balance, share, six stages, four quarters, buy box), and the Q1 table eight. Both scroll sideways on a laptop and are unusable on a phone.
11. **Banners everywhere, all the same weight.** Provisional, context-only, the paper-estimate rule, decisions, suppression and series breaks all use the same amber `.banner.warn`. A principal learns to skip them, including the one that matters.

### Other pages

12. **The account page has no "what next".** `app/accounts/[id]/page.jsx` stacks nine sections (person, research and drafts, orders, contact, touches, pipeline, routes, calls, brief). The next step is spread across them.
13. **Status does not say whether things are fine.** `app/status/page.jsx` opens with the kill switch, three queue buttons and a coverage matrix. "Is the data current? Is anything broken?" has no one-line answer.

### Access and look

14. **Information only on hover.** `title` attributes carry the evidence for each "why now" sentence, the reason for each gap, the meaning of "back", and "D / F / T". Touch and keyboard users cannot reach them. `[title] { text-decoration-style: dotted }` (line 52) does nothing, because no underline is set.
15. **Little visual hierarchy.** System font at 15px, three heading sizes close together (1.45, 1.15 and 1rem), uppercase grey table headers on every table, inline `style={{ marginTop: 0 }}` fixes, and tiers shown only as a colored letter. Contrast is fine (muted text is 5.9:1); hierarchy is not.

What already works and stays: dark mode, no third-party scripts, server components with no client data, every action going through the engine, and the rules that keep asset detail out of messages.

## 3. Design principles

1. **Answer first, then evidence, then sources.** Every page has three layers: a one-line answer, the drill-down, and the raw FDIC field codes one click away.
2. **Plain words, one meaning each.** Every label is a word a principal uses. The old regulatory term stays as a secondary label where a principal might know it (for example "Foreclosed property", with "OREO" in the glossary). One glossary page explains them all.
3. **Honest numbers, marked once.** Estimates always carry an "Estimate" tag and show as ranges. Unmarked figures are reported, and the page says so once. A date appears beside a figure only when it differs from the page's date. The view never computes a figure the engine did not store.
4. **Each fact once.** One table per subject.
5. **Disclosure with native elements.** `<details>` and links, so pages stay server components. `paper-estimate.jsx` keeps its test-enforced rule: no `'use client'`.
6. **Nothing important on hover only.** Evidence and reasons move into the drill-down.
7. **Hierarchy from type and space, not boxes and banners.** One slim internal-only notice per page. Colored notes only where a principal must act.
8. **Works on a phone.** Core pages have no table wider than the screen; rows become cards.
9. **Accessible by default.** WCAG AA contrast in both themes (checked: the lowest text pair in the new tokens is 4.6:1), `aria-current` on navigation, visible focus, and color never the only signal.
10. **Guardrails unchanged.** No send button anywhere. The context-only notice stays sticky on any page with loan or property detail. No runtime third-party requests.

## 4. Key design decisions in the prototype

- **Navigation: four primary items and a "More" menu.** This week, Banks, Outreach, Approvals (with a count). "More" holds two labelled groups: Market (Who sells to whom, Advisors and servicers, Market by quarter, Our network) and Setup and checks (System status, Senders, Score check, Briefer pilot). Glossary and Sign out sit at the right. The current page is marked.
- **Priority instead of tier.** "Call first" (A) and "Worth a look" (B), each a labelled chip that keeps a small "A" or "B" for continuity. "Not ranked" and "Excluded" (with the reason) replace untiered and hard filter.
- **Score out of 100, split into three named parts.** Pressure (up to 45), Fit (up to 30), Timing (up to 25), drawn as one stacked bar with marks at 20 and 45. A bank that scores 45 or more but misses Call first says why: "Short of Call first: pressure 12.9 (needs 15)".
- **The list shows how much could fit.** Each row shows the largest single-type buy-box ceiling ("up to $17.9M, hotel or retail, estimate"), with a bar on one scale for the whole list. Ceilings are never added across types.
- **Bank page: the short answer first.** One sentence, built from a template ("Call first. Seriously late apartment loans rose two quarters running… Up to $11.6M of its late apartment loans could fit our buy box, and up to $17.9M of late commercial-property loans if they are hotels or retail."), then four facts and the score card.
- **One drill-down by loan type.** Balance → 30 to 89 days late → 90+ days late → not accruing → foreclosed property → could fit our buy box. Commercial property is one row with its two lines (investor-owned and owner-occupied) inside it. Each row opens to a scaled bar of the late stages, an eight-quarter trend, losses written off and the buy-box explanation. "Not reported" is never shown as zero.
- **"How much could we buy?" as range bars on one axis.** Solid for ranges from reported shares, hatched for estimates, the $0 floor drawn as a line. Foreclosed property is shown apart. "Why is the floor $0?" and "How the ceiling is worked out" are disclosures.
- **Field codes off by default, one switch away.** "Show FDIC field codes" reveals the codes under every figure. In the app this is a checkbox and one CSS rule (`body:has(#codes:checked) .code { display: block }`): no client script.
- **Decisions without clutter.** Start outreach, Snooze and Not now are buttons. Each opens its small form in place, says what will happen ("Nothing is sent"; "It comes back only if something new happens"), and offers Undo.
- **A persistent glossary.** Dotted-underlined terms open it at the right entry.

## 5. Page-by-page changes, mapped to the code

### 5.1 The shell: `app/layout.jsx`, `app/globals.css`, `app/ui.jsx`

| Change | Where |
|---|---|
| Four primary links, a "More" menu as `<details>`, Glossary, Sign out inside "More". | `app/layout.jsx` |
| Mark the current page: a small client component `NavLinks` using `usePathname()` to set `aria-current`. It holds no data. | new `app/nav-links.jsx` |
| Approvals count in the navigation (drafts with status `draft`). One cheap query in the layout; skip it if it slows pages. | `app/layout.jsx`, `lib/ops.mjs` (`countDrafts`) |
| `/` redirects to `/triage`. | `app/page.jsx` |
| New tokens: cool neutrals, the accent, semantic colors, four stage colors (30–89, 90+, not accruing, foreclosed), three score colors, and a type scale. Light and dark, as today. Delete `.src { display: block }` and `[title]`. Add `.chip`, `.basis`, `.code` (hidden), `.note`, `.card`. | `app/globals.css` |
| Fonts: Public Sans for text, IBM Plex Mono for field codes, through `next/font/google`, which self-hosts them at build time (no runtime request to Google, so the README privacy rule holds). The fallback is the current system stack. | `app/layout.jsx` |
| New primitives: `Priority` (tier → chip), `Chip`, `Note` (replaces most `.banner` uses), `InternalNotice` (the sticky context-only bar, same `CONTEXT_ONLY` and `PAPER_CONTEXT` text), `Term` (link to `/glossary#id`), `Value` (a number, an Estimate tag when inferred, a hidden code line), `Disclosure` (`<details>` with house style), `PageHead`. `Sourced` keeps its signature; its source becomes a hidden `.code` line. | `app/ui.jsx` |
| Glossary page, static, from a pure module. | new `app/glossary/page.jsx`, new `lib/glossary.mjs` |
| Titles per page: `generateMetadata` returning the bank's or account's name. | `app/candidates/[key]/page.jsx`, `app/accounts/[id]/page.jsx` |

### 5.2 Banks (the candidate list): `app/candidates/page.jsx`

| Change | Where |
|---|---|
| Heading "Banks to call" and one sentence on how the list is ranked. The route stays `/candidates`. | `page.jsx` |
| Filters: priority as three links with counts (Call first, Call first and worth a look, All), metro, sort (score, could-fit, new first), "new or back this week", find by name. GET parameters, as today. | `page.jsx` |
| Row: priority chip; name, city, state and total assets; one-line reason with "and N more"; "New this week" and "Back on the list" chips; could-fit ceiling with a bar; score out of 100 with the stacked bar. Remove the `fdic:` key and the "D / F / T" column. | `page.jsx` |
| Pure helpers: `priorityOf(row)`, `axisMax(scoring)` (45, 30, 25 from `scoring.json` weights), `tierGap(row, scoring.tiers)`, `sortRows`, `matchesQuery`. Tests in a new `test/candidates.test.mjs`. | `lib/candidates-view.mjs` |
| The list reads three more things from the candidate item. PostgREST can select JSON paths, so no migration is needed: `item->city`, `item->state`, `item->assets`, `item->card->headline`, `item->fitCeiling`. | `src/platform/client.mjs` (`candidates()` select) |
| Engine: `buildCard` adds `headline`, a short template line from the first signal, falling back to the strongest distress sentence. | `src/candidates.mjs` |
| Engine: the scoring run stores `fitCeiling` on each candidate: for each buy-box type, the high bound and tier from the paper record's Q7. The view picks the largest; it adds nothing up. | `src/score.mjs`, `src/paper.mjs` |
| "New this week": the keys in the latest triage's `actNow` and `watch`, read once per page. | `lib/ops.mjs` (`listCandidates`) |
| Phones: rows become cards (CSS only). | `app/globals.css` |

### 5.3 The bank page: `app/candidates/[key]/page.jsx` and `paper-estimate.jsx`

The new order, top to bottom. Each line names what it replaces.

| Section | Built from | Replaces |
|---|---|---|
| Sticky internal notice | `PAPER_CONTEXT`, `CONTEXT_ONLY` | The mid-page `PAPER_CONTEXT` banner |
| Breadcrumb, name, priority and status chips; city, assets, data date; Start outreach, Snooze, Not now (each a `<details>` holding today's form and action) | `item`, `decision`, `promoteAction`, `snoozeAction`, `dismissAction` | The key-value panel and the "Decide" panel |
| **The short answer**: one sentence, four facts (could fit, by type; seriously late and its change in a year; deposits in our metros; how it sells), and the score card | `item.card`, `paper.q7.sectors[].bounds`, `item.components`, `paper.q3.buyboxShare`, `routeOf()` | The paper-estimate "Summary" |
| On this page; "Show FDIC field codes" | (static) | `<a href="#paper">` |
| **Why now**: the card's sentences without its first ("Call Report data as of…"), signals marked "New signal" with their dates, and an eight-quarter chart of the seriously-late share | `item.card.sentences`, `item.signals`, a new trend series | "Why now" and "Signals" |
| **What it holds**: one disclosure row per loan type (apartments; commercial property with its two lines inside; construction and land; CRE loans without a property lien), from balance to foreclosed property to could-fit | `item.profile.categories`, `paper.q1.categories`, `paper.q1.oreo`, `paper.q7` | "The paper: what this bank likely holds" and the Q1 table |
| **How much could we buy?** Range bars on one axis per buy-box type, foreclosed property apart, and two disclosures: why the floor is $0 (`unknownConditions`) and how the ceiling is worked out (the `conditions` table, with plain tier names) | `paper.q7` | Q7 |
| **Where it lends**: deposit share by metro as bars, outside-our-metros included | `paper.q3` | "Where it operates" and Q3 |
| **More detail** (disclosures): How the score was built; Has it sold loans before? (Q6); Loan sizes (Q4); When loans mature or reprice (Q5); Modified loans and unused credit lines (Q1 restructured, commitments, series break); Net change by quarter (the Q1 trend table); Technical detail (key, scoring run, layer, scope, placeholders) | `item.components`, `paper.q4`, `q5`, `q6`, `q1` | The score tables and Q4, Q5, Q6 |
| **What to ask for**: what public reports cannot tell us, and the loan tape request | `paper.q8` | Q8 and the tape request |
| About these numbers: unmarked is reported, Estimate is a range, not the loan tape | `paper.tiers`, `paper.asOf` | The paper-estimate sub-line |

Code changes:

- Split `paper-estimate.jsx` into section components in `app/candidates/[key]/`: `answer.jsx`, `holdings.jsx`, `fit-ranges.jsx`, `where.jsx`, `more-detail.jsx`, `ask-for.jsx`. All server components.
- New pure module `lib/bank-view.mjs`, with tests:
  - `answerSentence(item, paper)`;
  - `facts(item, paper, route)`;
  - `holdingRows(profile, q1, q7)`, which joins the two sources by category id and never sums;
  - `rangeAxis(highs)` for the tick values;
  - `withoutBoilerplate(sentences)`.
- `lib/paper-view.mjs`:
  - add `basisLabel(tier)`, which returns '' for reported, "Seen loan by loan" for observed and "Estimate" for inferred;
  - give `STAGES` plain labels;
  - `show()` keeps its fields, so its tests still pass.
- Server SVG components, `TrendChart` and `RangeBar`, in `app/charts.jsx`: no library, colors from tokens.
- Engine additions (small):
  - stages on `q1.nonfarmTotal`, so the commercial-property row has its own late figures. Pull `P3RENRES`, `P9RENRES` and `NARENRES`, or add up the two lines, which were checked to add up on 360 rows;
  - an eight-quarter series of the seriously-late share, in `src/paper.mjs`.
  - Until these ship, the row shows its two lines and the chart is left out.
- Tests: `test/paper.test.mjs`, "the page component renders from the record only…" (line 98), asserts the headings "Q1." to "Q8." and their order. Rewrite it to assert the new section order: the short answer first, "What to ask for" last. Keep the checks that the page shows each condition's tier and the `unknownConditions`, and still uses no `'use client'`.

### 5.4 This week, the new home: `app/triage/page.jsx`

- **Act now** as cards: priority, name, the first reason, and the could-fit ceiling. **Watch** as rows. **Already talking to** kept apart, as today.
- "Left out", the calendar and system health collapse into one line each, with a link to Status. Signal ids move into a disclosure.
- `lib/triage-view.mjs`: plain intros in `SECTIONS`, and a `cardOf(item, candidate)` helper.

### 5.5 Outreach (was Accounts): `app/accounts/page.jsx`, `app/accounts/[id]/*`

- The list is grouped by stage: name the person, research, draft, sent, in conversation. Each row shows its next step.
- The account page opens with one **Next step** box, for example "Confirm the role of the person named, then queue research". Below it come in-page sections: Person and contact, Routes, Touches, Calls, Brief.
- The guard's verdicts read as sentences. Rule codes move into a disclosure.
- Hard stops and enforcement orders stay at the top, as red notes. They are the one place where amber or red belongs.
- New pure module `lib/account-view.mjs` with `nextStep({ account, gate, drafts, routes, touches })`, tested.

### 5.6 Approvals: `app/drafts/page.jsx`

- Lint and guard findings as plain sentences ("Uses the word 'bargain'; remove it"), with the matched words highlighted in the draft. Blocked drafts sort last. The code stays in a hidden line.

### 5.7 System status: `app/status/page.jsx`

- First line: "Data is current" or what is wrong, from a new `lib/status-view.mjs` `healthSummary(overview)`.
- Kill switch shown as "Sending is paused" or "Sending is allowed", with one sentence on what that means.
- Queue buttons say what they do and roughly how long it takes.
- Jobs: a plain label per kind, and a one-line result instead of JSON. The raw table moves under "Technical detail".

### 5.8 Senders: `app/senders/page.jsx`

- "Ready to send: yes or no" first, with the one thing to fix.
- Field labels in plain words. "CAN-SPAM", `[CONFIRM]`, `OUTBOUND_KILL` and `outbound status` move into a help line.

### 5.9 The rest

- Intermediaries and Servicers become one menu item, "Advisors and servicers", with a filter for each kind.
- Calibration is renamed "Score check", with its headline sentence first.
- Sales, Market, Network and Pilot get the new tokens and components with no change of content.

## 6. Glossary: old term → new label

| Old (in the app today) | New label | Plain meaning |
|---|---|---|
| Candidates | Banks to call (menu: Banks) | Banks the scoring run ranks. |
| Tier A | Call first | Score 45 or more, with at least 15 points of pressure and 15 of fit. |
| Tier B | Worth a look | Score 20 or more. |
| Untiered | Not ranked | Below 20. |
| Fails a hard filter | Excluded (with the reason) | Off the list by rule, for example over $10 billion in assets. |
| Score, D / F / T | Score out of 100: Pressure, Fit, Timing | Pressure up to 45, fit up to 30, timing up to 25. |
| Distress | Pressure | How much strain the bank is under. |
| Promote to an account | Start outreach | Move the bank to Outreach. Nothing is sent. |
| Dismiss | Not now | Off the list with a reason; it returns only if a new signal fires. |
| Accounts | Outreach | Banks a principal chose to work. |
| Triage | This week | What changed since last week. |
| Paper estimate, paper profile, Q1 to Q8 | The bank page's named sections | See section 5.3. |
| Summary | The short answer | One sentence and four facts. |
| Investor CRE (2006 guidance) | Commercial real estate book (CRE book) | Construction and land, apartments, investor-owned commercial property, CRE loans without a property lien. |
| Nonfarm nonresidential | Commercial property | Offices, hotels, retail, warehouses and other non-housing property. |
| Nonfarm nonresidential, other / owner-occupied | Investor-owned / Owner-occupied | Who uses the property. |
| Multifamily | Apartments | Five or more units. |
| CRE not secured by real estate | CRE loans without a property lien | Real estate lending with no mortgage on the property. |
| Noncurrent | Seriously late | 90+ days late plus not accruing. |
| Past due 30–89 | 30 to 89 days late | The early warning stage. |
| Past due 90+ | 90+ days late | Still accruing interest. |
| Nonaccrual | Not accruing | The bank has stopped booking interest. |
| OREO | Foreclosed property | Property the bank owns after foreclosure. Never added to loan figures. |
| Charge-offs (net) | Written off | Losses recognized, less recoveries; a flow over a period. |
| Q7, in the buy box: bounds | Could fit our buy box | A range per loan type; the floor is $0 while any rule cannot be measured. |
| Reported tier | (unmarked) | The bank reported it. The page says so once. |
| Observed tier | Seen loan by loan | Built from individual loans we can see. |
| Inferred tier | Estimate | Built from shares or a stand-in; always a range. |
| Q3, footprint | Where it lends | Deposits by metro, standing in for loans. |
| Q4 | Loan sizes | Commercial property only, by original amount. |
| Q5 | When loans mature or reprice | All loans except home mortgages; a stand-in. |
| Q6 | Has it sold loans before? | Sales, held-for-sale loans, filings, acquisitions. |
| Restructured loans | Modified loans | Modified for borrowers in difficulty. |
| Unused commitments | Unused credit lines | Construction draws still to come. |
| Q8, unknowns | What public reports cannot tell us | The gaps. |
| Tape request | What to ask for: the loan tape | The loan-by-loan file, under a confidentiality agreement. |
| PROVISIONAL | Not final: the buy box has placeholders | Shown only while it is true. |
| Suppressed | Do not contact | Never listed. |
| Route tier | Route strength | How warm an introduction is. |
| Kill switch ON / off | Sending paused / allowed | Whether any draft can be created. |
| Calibration | Score check | How well the score picked banks in the past. |
| Pilot | Briefer pilot | Checking research on banks the principals know. |
| Intermediaries, Servicers | Advisors and servicers | Firms that run sales. |
| Field codes (LNREMULT…) | FDIC field codes (hidden by default) | The Call Report lines a figure comes from. |

## 7. Decisions for a principal

| # | Decision | Proposed default |
|---|---|---|
| D-UI1 | Mark only estimates, leave reported figures unmarked with one page-level note, and date a figure only where its date differs from the page's. This changes the wording of `docs/paper-estimate.md` section 6 ("each number with its tier and date"); the record keeps every tier and date. | Yes |
| D-UI2 | Rename Tier A and B to "Call first" and "Worth a look", keeping the small letter. | Yes |
| D-UI3 | A self-hosted web font (`next/font`, no runtime third-party request), or the system font. | Self-hosted Public Sans |
| D-UI4 | Home is This week. | Yes |
| D-UI5 | The list's "could fit" shows the largest single-type ceiling. A combined figure appears only if the engine adds one (apartments and commercial property are separate lines, so their ceilings could be added there, with its own tier). | Largest single type |

## 8. Phased plan

Effort is for one engineer who knows the codebase, in working days. Each phase ships on its own and keeps `npm test` green.

| Phase | What | Files | Effort |
|---|---|---|---|
| 0. Foundation | Tokens, type, components; navigation with "More" and `aria-current`; home redirect; glossary page; page titles. | `app/globals.css`, `app/layout.jsx`, new `app/nav-links.jsx`, `app/ui.jsx`, `app/page.jsx`, new `app/glossary/page.jsx`, new `lib/glossary.mjs`, `generateMetadata` in two pages; test for `glossary.mjs` | 2–3 |
| 1. Banks list | The new list, filters and rows; `headline` and `fitCeiling` from the engine; JSON-path selects. | `app/candidates/page.jsx`, `lib/candidates-view.mjs`, `lib/ops.mjs`, `src/platform/client.mjs`, `src/candidates.mjs`, `src/score.mjs`; new `test/candidates.test.mjs`, engine tests in `../test/` | 2–3 |
| 2. Bank page | The new order; one holdings table; range bars; the answer; disclosures; the codes switch; SVG charts. | `app/candidates/[key]/page.jsx`, split of `paper-estimate.jsx`, new `lib/bank-view.mjs`, `lib/paper-view.mjs`, new `app/charts.jsx`; `test/paper.test.mjs` updated; engine: `q1.nonfarmTotal` stages and the trend series in `src/paper.mjs` | 4–6 |
| 3. This week as home | Cards and rows; collapsed counts and health. | `app/triage/page.jsx`, `lib/triage-view.mjs`, `test/triage.test.mjs` | 1–2 |
| 4. Outreach and approvals | Grouped list, "Next step", plain verdicts, plain lint findings. | `app/accounts/page.jsx`, `app/accounts/[id]/*.jsx`, new `lib/account-view.mjs` with tests, `app/drafts/page.jsx` | 3–4 |
| 5. Status and senders | Health line, plain job results, sending paused or allowed; senders' readiness first. | `app/status/page.jsx`, new `lib/status-view.mjs` with tests, `app/senders/page.jsx` | 1–2 |
| 6. The rest, and a check | Advisors and servicers merged; restyle Sales, Market, Network, Pilot, Score check. Then a pass on a phone, in dark mode, with the keyboard and with an automated accessibility checker. | `app/intermediaries/*`, `app/servicers/*`, `app/sales`, `app/market`, `app/network`, `app/pilot`, `app/calibration`; `web/README.md` screens table | 2 |

**Total: about 15 to 22 working days.** Phases 0 to 2 (8 to 12 days) deliver most of what the founder asked for: the navigation, the list and the bank page.

Notes for whoever builds it:

- **No new figures in the views.** Every number shown is one the engine stored. The view only picks, formats and compares with the rule files: `tierGap` compares stored points with `scoring.json`, and `rangeAxis` picks tick marks.
- **The two engine fields need a scoring run to fill.** Until one runs, the list shows "Open the bank" in the could-fit column and the card's second sentence as the reason.
- **Keep the copy rules.** Nothing on these pages goes in a message. The drafter still receives nothing from the paper record.
- **Update `web/README.md`.** Its Screens table describes the old pages and labels.
