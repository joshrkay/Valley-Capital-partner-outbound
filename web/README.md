# The principals' web app

PRD E12-S5. It is a private Next.js app where the firm's principals can:

- work the candidate list;
- read each bank's paper profile and how its score was built;
- promote, dismiss or snooze candidates;
- manage accounts and read briefs;
- run the pilot;
- approve drafts;
- watch jobs and data runs.

**It cannot send anything.** Approving a draft checks it again; a principal sends it from their own mailbox.

## How it works

- **The same engine as the command line.** Server code loads `../src` at runtime (`lib/engine.mjs`, with `webpackIgnore`/`turbopackIgnore` dynamic imports) rather than bundling it. The engine finds its rule files from its own location, as it does on the command line.
- **Every quick action runs the engine's own function in a unit of work** (`lib/ops.mjs`): promote, dismiss, snooze, set person, confirm role, approve, pilot verdicts. The action loads only what it needs from Postgres and writes back in one transaction as the signed-in principal (PRD E12-S1 to S3).
- **Long work is queued, never run in a request.** That covers research, drafting, the FDIC pull and scoring; the worker runs them (PRD E12-S4).
- **Access is checked three times:**
  - the proxy (`proxy.js`) sends anyone without a session to `/login`;
  - every page and action checks the user is an active principal (`lib/session.mjs`);
  - row-level security in the database decides what every request can read or write.
- **The service-role key is never used here.** The app refuses to start with one (`lib/env.mjs`).
- **Privacy:**
  - every response sends `X-Robots-Tag: noindex, nofollow`, and `robots.txt` disallows everything;
  - there are no third-party scripts, fonts or analytics (the system font, inline SVG icons and charts drawn on the server);
  - one-time messages travel in a short-lived cookie, not the URL;
  - briefs are rendered as text (`lib/markdown.mjs`), so nothing quoted from a web page can inject markup.

## Screens

Every page sits in one shell (`app/shell.jsx`, design in `docs/design-redesign.md` 4.1): a global header with the firm's mark, a bank search, the glossary, a theme switch (automatic, light, dark; a cookie, no script), the Approvals bell with its count and the account menu; then a tab bar with the app launcher (every page, grouped and searchable), This week, Banks, Outreach, Approvals and a "More" menu (Market; Setup and checks). The current page is marked. Only the tab bar's links and menus (`app/nav-links.jsx`) and the launcher (`app/launcher.jsx`) are client components, and they hold no data. Labels are plain words; `/glossary` lists each with the old term it replaced.

| Path | What |
|---|---|
| `/` | Goes to This week. |
| `/triage` | **This week**, the home page: the latest weekly triage (PRD E6-S5), from the stored record. **Act now** as cards: priority, name, the first reason (more in a disclosure), place and the could-fit ceiling from the bank's candidate item. **Watch** as rows. **Already talking to** kept apart, with the latest touch. Approvals waiting, and one line each for system health, the FDIC quarter, who was left off (counts only) and the calendar, with a link to Status. Signal and event ids in a disclosure. Each item links to its account, bank page or servicer, and to the SEC filing or the FDIC loan-sale page. `?date=YYYY-MM-DD` shows an earlier one. Queue a triage run. Internal: nothing on it is ever sent. |
| `/candidates` | **Banks to call**, a list view. A picker for Call first, Call first and worth a look, or All banks (each with its count); search this list, metro, sort (score, could fit, new first) and "new or back" as GET parameters. Each row: name, place and assets; priority (Call first, Worth a look, Not ranked, Excluded with its reason); one reason (the card's headline, else its second sentence) and how many more; New this week (the latest triage's act now and watch) and Back on the list; the largest single-type could-fit ceiling with a bar (never a sum; "Open the bank" until a scoring run stores `fitCeiling`); the score out of 100 as pressure, fit and timing, and why a bank is short of Call first. Rows become cards on a phone. Suppressed, promoted, dismissed and snoozed banks are hidden exactly as `outbound candidates list` hides them. The list reads the item's headline, fit ceilings, place and assets by JSON path (`itemFields`), plus the card's sentences and failed filters. |
| `/candidates/[key]` | **A bank's record page**, titled with its name. A sticky internal notice; a highlights panel with Start outreach, Snooze and Not now (each opens its form in place and says what will happen; nothing is sent) and six key fields; a stage path (Ranked, Outreach, In conversation, NDA signed, Loan tape, Bid) from the decision and the latest triage, with the next step. Tabs as links (`?tab=`): **Overview** (the short answer, why now with signals dated, and the seriously-late trend when the record has it), **What it holds** (one drill-down row per loan type from the balance to foreclosed property to could-fit; commercial property holds its investor-owned and owner-occupied lines), **How much could fit** (range bars per buy-box type on one axis, foreclosed property apart, why the floor is $0, how the ceiling is worked out with each rule's share and basis), **Loans we can see** (each public-records document a watched county holds that names the bank as lender, beneficiary or holder: type, county, date, stage, amounts with their basis, property type and a link to the document; no borrower or address; or which counties are watched and that none has one yet; `loans/banks/fdic-<CERT>.json`, one document, docs/county-loans.md), **Details** (how the score was built, past sales, loan sizes, maturities, modified loans and unused lines, net change by quarter, technical detail, and what to ask for). A sidebar lists the score, signals, the loans we can see (the newest three), where it lends and loan sales. All from the item and the paper record (PRD E14-S1, `paper/fdic-<CERT>.json`, one document read with the principal's token). Reported figures are unmarked; estimates carry an Estimate mark and show as ranges; "Show FDIC field codes" reveals each figure's Call Report fields (a checkbox and one CSS rule; no script). |
| `/sales`, `/market`, `/network` | Who sells to whom, Market by quarter and Our network, in the new page header and tokens; their content is unchanged. |
| `/glossary` | Every plain label, the old term it replaced, and what it means. Dotted terms on other pages link to their entry. |
| `/intermediaries`, `/intermediaries/[key]` | **Advisors and servicers** (was Intermediaries; one menu item with `/servicers`): firms a stored source shows acting for a seller in our market, loan-sale advisors and CMBS special servicers, ranked by their mandates, with a filter for each kind and its count. Each firm's page shows its mandates and our place on its buyer list. |
| `/servicers` | Part of **Advisors and servicers**: CMBS special servicers of loans on properties in our metros and buy-box sectors, from the trusts' SEC loan-level filings (PRD E4-S3). Each shows loans, balance, how many are in special servicing, coded for a note sale, delinquent or maturing, and its metros and sectors. Sorted by special servicing, then note sale, then balance. Reads only the per-servicer summary. |
| `/servicers/[name]` | That servicer's loans: trust, balance, rate, maturity, payment status, workout, signals, and each property's city, metro, type, occupancy and DSCR. Every value names its filing and reporting period, with a link to the filing on sec.gov; "Show the filing's field names" reveals each value's EX-102 field. A banner that stays visible while scrolling says the detail is context for a principal only and never goes in a message. Property names and addresses are not shown. |
| `/accounts`, `/accounts/[id]` | **Outreach** (was Accounts): the accounts grouped by stage (name the person, research, draft, sent, in conversation), each with its one next step (`lib/account-view.mjs` `nextStep`), from the account records, their drafts' statuses (path and status only) and the touch log (type, date and account only). An account page, titled with its name, opens with the next step over the outreach path; hard stops and enforcement orders in force stay at the top as red notes; then Person and contact (person, role, research and drafts, contact details), Routes, Touches, Calls, what the scoring run found, and the Brief. Set person, confirm role, queue research (refused with the pilot message until it passes) or a draft, as before. The guard's verdicts read as sentences, with the rule codes in a disclosure. |
| `/accounts/[id]`, routes | **Routes to the decision-maker** (PRD E22, `app/accounts/[id]/routes.jsx`): the direct route's status (person named, role confirmed, address verified), the ranked warm routes (board, counsel, advisor, forum) with their tier, bridge, one line of reasoning and evidence links, the held routes, and the chosen route's checklist. Build and choose run the engine in a unit of work as the principal; nothing is queued, drafted or sent. |
| `/accounts/[id]`, outreach | **Working without Gmail** (PRD E8-S5, `app/accounts/[id]/touches.jsx`): the touch history, newest first, and what `guard due` says. Record a send made from your own mailbox: channel, date (never later than today) and sender. The step is counted as `guard record` counts it, and the guard's verdict for that send shows first. It is always recorded, with any rule it broke shown. Record a reply, bounce, meeting or handoff, and an opt-out behind a confirmation, which suppresses the person and the address at once. No message text is stored. |
| `/senders` | **Senders**: who a message goes out under. "Ready to send: yes or no" first, with the one thing to fix, by the rule `outbound status` uses (kill switch included). Add and edit, checked by the rule `outbound senders` uses (`src/senders.mjs`): every required field, no placeholder, a business mailbox, a street address. Field labels are plain; the rule's terms (CAN-SPAM, `[CONFIRM]`, `OUTBOUND_KILL`) are in a help line. A sender that a recorded touch names cannot be removed. Audited with ids only. |
| `/network` | **The firm's network** (PRD E22-S1): people the principals know, firms they work with, associations they belong to. Add and remove each; see how many chosen routes use each entry. Names and relationships only, never an email address or a phone number. Viewing it is audited. No model sees it. |
| `/drafts` | **Approvals**: drafts waiting, ready ones first and blocked ones last. Each lint or guard finding as a plain sentence ("Uses the word "bargain"; remove it"), with the words it matched highlighted in the draft and its rule code on a hidden line ("Show rule codes"). Approve re-runs the linter and the guard. There is no send button. |
| `/pilot`, `/pilot/[id]` | **Briefer pilot** (was Pilot): the scorecard, finding-by-finding verdicts, and recording a pass. |
| `/calibration` | **Score check** (was Calibration; PRD next-five E17-S5): one headline sentence first (the top K's observed-label yield, its lift over the base rate and the share of observed labels it held, with how far it can be read), then the latest backtest of the score, from its stored report (`backtest/report-<hash>.json`). It shows the headline by SEC-filer coverage and the metro subset, the eras and horizons, lead times, the per-component table with counts, and the all-axis tiers in a table labelled context. It also shows the run's provenance (hashes, run ids, holdout or reused holdout, PROVISIONAL) and the known limits. `?report=<hash>` opens any stored report from the list. Read-only: it loads the run log and that one report, never the panel. With no report, it says which commands make one. Linked from Status. |
| `/status` | **System status**. First, one line: "Data is current" or what is wrong (`lib/status-view.mjs` `healthSummary`: a failed or suspect last run, a source older than its limit in triage.json, a job that failed). Then sending, paused or allowed, in a sentence; the refresh buttons (FDIC pull, CMBS pull from SEC EDGAR, scoring, optionally with the draft buy box), each saying what it does; buyer-list re-certifications due; signal coverage; **County records**, a row per watched county with its last run, documents read, new this week, matched to a bank and names to review (`loans/state.json`, counts only); the last EDGAR run's counts; the recent jobs as plain labels with a one-line result. The raw jobs and source-run tables sit under "Technical detail". **What led to conversations** (PRD E15-S4): the engine's outcomes report, counts by signal type, tier and lead time, meetings recorded by hand included; counts only, never a name or a note. Queue an FDIC pull, a CMBS pull (SEC EDGAR) or scoring (optionally with the draft buy box). The last EDGAR run's counts (trusts read, loans read and kept), and its error if the last pull failed. A placeholder SEC contact fails before the run log is written, so the failed job's own error is shown too. |

## Run it

```bash
cd web
cp .env.example .env.local      # optional: only to point at a test project (WEB_SUPABASE_URL, WEB_SUPABASE_ANON_KEY)
npm install
npm run dev                     # http://localhost:3000
npm test                        # server helpers against a fake Supabase REST API, no network
npm run build
```

## Deploying: run the wizard

`bash scripts/deploy-wizard.sh` (from the repository root) walks you through every step below, in order. It opens each page, says what to click, saves the public URL and key to `web/.env.local`, sets the worker's GitHub secrets (with `gh`), and runs the smoke test. Secret keys are typed hidden and never written to a file. Decided 2026-11-16: a new Supabase organization and project for Valley Capital (Q17); the existing Vercel project `web` on the cartboost team, with previews protected (Q18).

## Supabase setup (once, by an operator)

1. Apply `../supabase/migrations/`.
2. **Auth → turn off public sign-ups.** Invite each principal as a user, and add a row for each to `public.principals` (email, name, active) with the service role. Someone signed in who is not an active principal sees "Not authorized" and the database returns nothing.
3. **Auth → URL configuration.** Set the site URL to the app's address, and allow `https://<app>/auth/callback` as a redirect URL. The callback accepts both a PKCE `code` and a `token_hash` link.

## Deploy (Vercel)

- Root directory `web`, with "include files outside the root directory" on. `next.config.mjs` traces `../src`, the rule files, `../site-snapshot` and `../node_modules/@anthropic-ai/sdk`.
- Environment variables: none are required. The firm's Supabase URL and publishable key are committed in `lib/env.mjs`, so the deployed app cannot be pointed at the wrong project by a stale dashboard value; `SUPABASE_URL`, `SUPABASE_ANON_KEY` and the `NEXT_PUBLIC_` copies are no longer read. `WEB_SUPABASE_URL` with `WEB_SUPABASE_ANON_KEY` overrides both for a test project. `ENGINE_ROOT` is only needed if the repository layout differs at runtime.
- Turn preview deployments off or protect them (PRD E12-S7).
- **On the first deploy, check that a page loads data.** The engine is loaded at runtime from the traced files, which was verified with `next start` but not yet on Vercel.

## Dependencies

All pinned exactly, each release at least two weeks old when chosen: next 16.4.3, react 19.3.1, react-dom 19.3.1, @supabase/supabase-js 2.118.0, @supabase/ssr 0.12.7. Nothing else.
