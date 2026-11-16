# Outbound agents

The agents in `docs/outbound-plan.md` that exist so far:

- **The guard**, **the briefer** (deep research) and **the drafter** (agents 1 to 3).
- **Release 1 of the signal pipeline** (agents 4 and 5, from `docs/prd-signal-pipeline.md`):
  - FDIC data for the banks in the six target metros;
  - a paper profile and a distress, fit and timing score for each bank;
  - a candidate list a principal works through;
  - a pilot that the briefer must pass before it researches anything the pipeline found.
- **CMBS loan data** from SEC EDGAR: loans in the six metros and buy-box sectors, with workout codes (including "note sale") and each trust's special servicer.
- **The platform** (PRD E12), a private web app for the firm's principals: Supabase (Postgres with row-level security) and Next.js in `web/`, with a worker for long jobs. The same engine runs underneath the command line and the web.

**The goal** (PRD section 0): purposeful outreach to the right person at the right time, backed by research into what paper the institution holds, what those loans look like, and where the firm has an advantage. **Nothing in this folder can send a message.** A principal sends; the guard then records it.

Start with `docs/prd-signal-pipeline.md` for the pipeline, and `docs/research-agenda.md` for the briefer. The next epics (E17 to E21: a backtest of the score, enforcement orders and merger applications, intermediaries, a market note, and credit unions and non-bank lenders) are in `docs/prd-next-five.md`. Of those, the backtest (E17-S1 to S4, from the command line) and the coverage report (E18-S1, `outbound coverage` and the Status page) are built; the backtest's web page (E17-S5) and the rest are not. The briefer's questions (`playbooks.json`) are that agenda turned into data.

## Status: read this first

- **Never run against the live API.** There was no API key in the environment where this was written. The tests use a fake client and, for the wire format, the real SDK pointed at a local stand-in server. They prove the requests the SDK builds (endpoint, fallback header, the two server tools with their caps, effort, resuming a paused turn), every check in the guard and the linter, and that the verification logic drops what it should. They do **not** prove how the model words things, and they do not prove the shape of live search and fetch results. The ledger reads those shapes defensively and trusts nothing it does not recognize, but **the first live run is a test of the briefer, not a result.** Read its first briefs against what you know.
- **Cost is unmeasured.** Deep research is the expensive step. `models.json` caps searches, fetches and turns per account; the brief reports tokens used and an estimate from token prices only. Search fees are not included. Run on a handful of accounts first.
- **Every number in `config.json` is a placeholder** (caps, sequence timing, call hours). They are not researched.
- **Counsel has not reviewed any of it,** including the claims and the channel rules.
- **The FDIC adapter has run live** (2026-11-13): 268 banks, 8 quarters to June 30, 2026, about 7 seconds, public data with no key. The scoring weights, thresholds and tier cuts in `scoring.json` are **placeholders**. The buy box (`buybox.json`) has `[CONFIRM]` fields a principal must fill. Until then `score run` refuses, or with `--draft-buybox` it labels its list PROVISIONAL.
- **The CMBS adapter has run live** on 40 trusts (2026-11-13) with a generic User-Agent. `config.sec.userAgent` stays a `[CONFIRM]` placeholder, and the adapter refuses to run until a principal fills it with the firm's name and contact (PRD Q11).
- **Enforcement orders have run live, from the Federal Reserve only** (2026-11-16): 1,563 orders against organizations, 20 naming a bank in the list. FDIC, OCC and state orders are not built (PRD next-five E18-S2). Orders add no points (D-E1).
- **The platform is built but not deployed.** The migrations and their access rules pass 16 tests on Postgres 16 (`npm run test:db`). The client, worker and web app are tested against a fake of Supabase's REST API; the first run against a real project is E12-S7, which needs a Supabase project and a Vercel team (PRD Q17, Q18).
- **Not built yet:**
  - county records (PRD E5; the spike first);
  - servicers as scored candidates (E4-S3);
  - a contact-data vendor's API (E7-S2 tests a vendor's exported results; no vendor is wired in);
  - deploying the platform (E12-S7);
  - Gmail drafts and reply detection (E9);
  - enforcement orders from the FDIC, the OCC and the states (next-five E18-S2 has the Federal Reserve only), and merger applications (E18-S3);
  - quarterly nurture (E10);
  - the referral mapper's drafted ask to a connector (E22 finds the routes and gives a checklist; it drafts nothing, PRD D-R7), and county records that name a lender's counsel (E22-S3 has the event shape and the seam, no adapter);
  - meeting prep beyond the call brief (event lists, who to meet, and a drafted follow-up email: PRD E15-S3 gives a checklist today);
  - the weekly reporter (the outcomes report, PRD E15-S4, is its first part).

  The briefer reads the open web; it cannot do what needs a data feed.

## The data rule

Prospect data (accounts, people, briefs, drafts, suppression and NDA lists, touch logs) **never goes in this repository.** This repository is private and kept separate from the public website repository for that reason, but Git history still cannot be fully erased and a repository can change hands or visibility. Everything lives in a private folder named by `OUTBOUND_DATA_DIR`. The code refuses a data directory that resolves inside the repo, including through a symlink; `.gitignore` is only a backstop, and a test fails if a data file is ever tracked. This repository holds code and rules only.

## Quick start

```bash
export OUTBOUND_DATA_DIR=~/valley-outbound-data     # outside this repo
export ANTHROPIC_API_KEY=...                        # only for research and drafting
npm install
npm run outbound -- init                            # creates the folder, a sender template, an invented example account
npm run outbound -- status                          # shows what is missing before anything can send
npm run outbound:test                               # no network, no key
```

Fill `senders.json` (a sender with a `[CONFIRM]` placeholder blocks all sending), then add `accounts/<id>.json` for accounts a principal chose. The account shape is in the example `init` creates. Then, for each account:

```bash
npm run outbound -- research run --account acme-bank --dry-run   # see exactly what would be sent, free
npm run outbound -- research run --account acme-bank             # deep research: costs money
npm run outbound -- research show --account acme-bank            # read the brief
npm run outbound -- account confirm-role --account acme-bank --by "Pat Example"
npm run outbound -- draft run --account acme-bank --channel letter --step 1
npm run outbound -- draft approve --account acme-bank --channel letter --step 1 --by "Pat Example"
# a person sends it, then:
npm run outbound -- guard record --account acme-bank --channel letter --step 1 --sender principal-1
```

`npm run outbound -- help` lists every command.

### The signal pipeline: from public data to a researched account

```bash
npm run outbound -- sources run fdic                     # bank list, deposit footprint, 8 quarters of CRE credit data (free)
npm run outbound -- score run                            # refuses until buybox.json is filled; add --draft-buybox for a PROVISIONAL list
npm run outbound -- candidates list --tier A             # tier, score by axis, and the "why now" card for each bank
npm run outbound -- candidates show --key fdic:12345     # the paper profile and every score component, each with its FDIC field and date
npm run outbound -- coverage                             # PRD E18-S1: how many Tier A, Tier B and all candidates each signal source can see (counts only; --json; also on the Status page)
npm run outbound -- candidates promote --key fdic:12345 --by "Pat Example"
npm run outbound -- research run --account <id>          # institution research: brings back who decides (refused until the pilot passes)
npm run outbound -- account set-person --account <id> --name "..." --title "..." --by "Pat Example" --finding F3   # the candidate's finding in the brief
```

Behind a proxy, Node's built-in `fetch` needs `NODE_USE_ENV_PROXY=1` (Node 22.21 or later).

**The FDIC pull also records three kinds of pressure** (PRD E3-S5 to S7), in the same `sources run fdic` job:

- **Failures.** FDIC's `/failures` index is stale: built August 25, 2026, it lacks two later failures, one of them in the Los Angeles metro. So failure is taken from `/failures`, `/institutions` (closing code `CHANGEC1` and end date `ENDEFYMD`) and `/history`, and from FDIC's failed-bank CSV if a person saves it as `sources/fdic/failed-banks.csv` in the data folder. A bank counts as failed if any source says so, and `sources/fdic/failed.json` records which ones agree. A failed bank with a presence in the metros is listed under `candidates list`, with the FDIC as the seller of its loans and a link to the FDIC loan-sale page.
- **Mergers and acquisitions**, from `/history`, kept in `sources/fdic/events.json`. A bank that acquired a bank with a presence in the metros gets an **event** signal, visible for 4 quarters (a placeholder).
- **The concentration screen**: construction loans and CRE against capital, and 36-month CRE growth, shown in the paper profile and as **state** signals. Its definition, from the 2006 interagency guidance, is **unconfirmed**. A bank on the community bank leverage ratio reports no total risk-based capital, so it is divided by tier 1 capital plus the allowance, and every value says which denominator it used.

Every signal says whether it is a state signal (recomputed while the condition holds) or an event signal (a dated change, kept).

**The paper estimate** (PRD E14-S1, `docs/paper-estimate.md`): what CRE each bank likely holds, from its Call Reports. Each scoring run writes one record per bank, `paper/fdic-<CERT>.json` in the data folder. Every number carries its unit (dollars, converted from FDIC's thousands; a count; or a share), as-of date, tier (reported, observed or inferred), sources (field, file, report date) and method.

```bash
npm run outbound -- paper show --key fdic:12345          # summary, then Q1 to Q8, each number with its tier and date; --json for the record
```

- **Q1:** investor CRE (the 2006 guidance definition) and owner-occupied, by category, with the stages FDIC reports for each. A stage it does not report says "not reported", never zero. Charge-offs are flows, for the quarter and the year to date. Restructured loans by type carry the 2023 series break (ASU 2022-02). Unused commitments are shown once, for the whole book. The eight-quarter trend is net change, never "new lending", and a quarter with an acquisition is withheld.
- **Q3:** the deposit share by metro, labelled a proxy, not loans. **Q5:** maturity and repricing buckets, for all loans, not CRE-specific.
- **Q4:** nonfarm nonresidential loan sizes. **These fields are semiannual:** most banks fill them only in June and December and send 0 in March and September. A March or September value is never used, whatever it holds; the latest June or December report is used, and its date is shown. The restructured split by type behaves the same way (checked live, November 14, 2026).
- **Q6:** seller evidence, as a dated list: held-for-sale balances, loan-sale gains (not CRE-specific), SEC filing signals and acquisitions.
- **Q7: bounds only.** For each buy-box sector, an upper bound of min(sᵢ) × book and a lower bound of max(0, Σsᵢ − (k − 1)) × book, from the category, metro and size shares. Never a product of shares, and no base figure. Hotel and retail sit inside nonfarm nonresidential, so their share runs from 0 to all of it. While the buy box has placeholders, the record is marked provisional.
- **Q8:** the unknowns, generated from the gaps, and the standard tape request.

The web app shows it on the candidate page. The briefer receives it as fenced data; **the drafter receives nothing from it**, and its unit of work cannot load `paper/` (`test/handoff.test.mjs`).

**Before the briefer researches any bank the pipeline found, it passes a pilot** on 10 accounts the principals already know (PRD E1):

```bash
npm run outbound -- pilot template --account acme-bank   # write what you know is true
npm run outbound -- research run --account acme-bank
npm run outbound -- pilot review --account acme-bank
npm run outbound -- pilot mark --account acme-bank --finding F1 --verdict true --by "Pat Example"
npm run outbound -- pilot scorecard                      # precision, recall, fabrications, cost per brief
npm run outbound -- pilot pass --by "Pat Example"        # needs 10 fully reviewed accounts and zero fabrications
```

**CMBS loans** (needs `config.sec.userAgent` filled in):

```bash
npm run outbound -- sources run edgar                    # each CMBS trust's latest SEC filing: loans in the metros, workout codes, servicer
```

It writes `sources/edgar/loans.json`, `trusts.json` and `servicers.json`, plus `dispositions.json`: every loan liquidated by disposition or DPO, kept after it leaves the reports (see "Who sells to whom" below). Every loan and property detail is **context for a principal, never for a message**.

### The SEC filings listener (PRD E13-S1)

A daily watch of banks' SEC filings for signs they are selling CRE loans. It needs `config.sec.userAgent` filled in, like the CMBS adapter.

Most banks file through a holding company, so each bank is first mapped to the SEC filer (CIK) that files for it. A principal decides every mapping. Only confirmed filers are searched:

```bash
npm run outbound -- filers suggest                       # proposes filers for unmapped banks: FDIC's holding-company name, SEC's entity list,
                                                         # and each candidate's latest 10-K or 10-Q (its SIC code shows whether it is a bank)
npm run outbound -- filers confirm --bank fdic:12345 --cik 9900101 --by "Pat Example"
npm run outbound -- filers reject  --bank fdic:12345 --cik 9900301 --by "Pat Example" --reason "a capital trust"
npm run outbound -- filers list                          # every bank: confirmed, rejected, or not mapped yet
```

Then the listener runs the saved searches in `filings.json` on EDGAR full-text search:

```bash
npm run outbound -- sources run filings                  # each filer since its own last search; a new filer is searched back a year
npm run outbound -- sources run filings --since 2026-06-01
npm run outbound -- filers discovered                    # bank filers in our five states that are not in the bank list: for review
npm run outbound -- sources verify filings               # searches again for a few stored filings; each must come back
```

- **Saved searches:** 8-K Items 2.01 and 2.06; "transferred to held for sale", "loans held for sale", "loan sale" and "note sale", each with "commercial real estate"; and "balance sheet repositioning". All are placeholders for a principal to tune.
- **Phrases:** they must all appear in one document. The endpoint has no "near".
- **8-K items:** matched on each hit. They are never sent to the server, because its cache ignores them.
- **Signals:** every hit on a confirmed filer becomes an **event**: a dated change, kept even when a later run no longer sees it. It is stored once per filing, in `sources/edgar/filings.json`. `filingSignals({ dir })` in `src/sources/filings.mjs` returns the signals by bank key, `fdic:CERT`.
- **Proxy statements** (DEF 14A) of confirmed filers are recorded in `sources/edgar/proxies.json`, by form, date and link only, for the briefer. No names are extracted.
- **The discovery search** runs by business-address state and bank SIC code. Its hits go to `sources/edgar/discovery.json` and never become signals.

The full-text search returns no filing text and no snippets, and nothing here stores any. Even so, filings are context for a principal only, and a test proves none of it reaches the drafter.

What was checked live on 2026-11-13 is written at the top of `src/sources/efts.mjs`:
- CIKs must be zero-padded, or nothing matches.
- A query the server cannot run comes back as HTTP 200 with an error body.
- A cache serves answers keyed without 8-K items or SIC codes.

So every response is matched to its request before it is used. A response with no echo, a search that returns fewer hits than it reports, or a hit that does not match its request fails the run: nothing is written, and the next run covers the same days.

On the platform, the job is `sources.filings`. The worker workflow queues it on weekdays at 23:37 UTC, then verifies it. A `suspect` run fails the job, because the listener's window has moved past it. That schedule stays off until a principal has filled `config.sec.userAgent`, confirmed at least one filer, and set the repository variable `FILINGS_ENABLED` to `true`. Until then the run would fail its own checks every day and hide real failures.

### Calls: the brief before, the outcome after (PRD E15)

When the person who decides on loan sales agrees to talk:

```bash
npm run outbound -- call prep --account acme-bank --date 2026-11-17     # a one-page call brief, checked in code
npm run outbound -- call log --account acme-bank --date 2026-11-17 --by "Pat Example" --notes notes.txt   # or --notes - for stdin
npm run outbound -- call confirm --account acme-bank --proposal <PID> --by "Pat Example"
npm run outbound -- outcomes report                                     # which signals led to conversations
```

- **The brief** (`calls/<id>/<date>-prep.md`) is written by one model call from fixed inputs, each with an id: the account, the research, the signals and card, the paper estimate if there is one, the touch history, the approved claims and the playbook. Code checks that every cited id exists, every number is in the inputs, every claim is approved and quoted word for word, and no estimate is stated as a fact. A brief that fails says **NOT USABLE** first. An unconfirmed role is a warning at the top.
- **The notes** stay in `calls/<id>/`, for principals only. A model turns them into a proposal: outcome codes from a fixed list, objections, commitments, a follow-up date, and the people mentioned. **Nothing is recorded until a principal confirms it.** Confirming records a guard `meeting` event (which ends the sequence), a line in `outcomes.jsonl` linked to the account's origin signals, and the outcome on the account. People named in the notes are never added; a principal uses `account set-person`.
- **The follow-up** is a checklist of what was agreed (`calls/<id>/<date>-followup.md`). No email is drafted: after a meeting the guard refuses every touch, and the drafter only writes from the briefer's facts. PRD E15-S3 says why.
- **The report** (`reports/outcomes-<date>.json`) counts confirmed outcomes by signal type, tier and lead time. It uses no model and never changes the weights.

On the platform, the account page does the same: queue a brief, paste notes, confirm or reject.

### Contact details and deletion requests (PRD E7)

Every person field records where it came from, and an address is used only once a principal has verified it:

```bash
npm run outbound -- account set-person --account acme-bank --name "..." --title "..." --by "Pat Example" --finding F3   # or --url, or --source principal_known
npm run outbound -- account add-domain --account acme-bank --domain acmebank.example --url https://acmebank.example/contact --by "Pat Example"
npm run outbound -- account set-email --account acme-bank --email name@acmebank.example --url https://acmebank.example/leadership --by "Pat Example"
npm run outbound -- account verify-email --account acme-bank --by "Pat Example" --method institution_site --url https://acmebank.example/leadership
npm run outbound -- account contact --account acme-bank     # each field and its source; the address's state; the domains
```

- **Verifying** runs checks that must all pass: the syntax, a recorded source, a business address, a domain the account has confirmed, and an MX record for the domain, which is one DNS lookup. It also checks the address is not suppressed. Then it records how you know the address: seen on the bank's own site, they wrote from it, you know it, or a vendor with a recorded pass. **No mail server is ever contacted.** A verification lasts `contacts.json` `reverifyDays` (a placeholder, 180). After that, or for a different address, the guard refuses the email (`EMAIL_UNVERIFIED`). An address with no source of its own is refused too (`EMAIL_UNSOURCED`).
- **A deletion request**, `account forget-person --account ID --by NAME --reason TEXT --confirm "ACCOUNT NAME"`, removes the person from every record in the data folder: accounts, research, briefs, facts, drafts, calls, the pilot sheets, the known list, the firm's network (their entry, and every route and choice that used it), the routes (a routes file that names them is rebuilt from the scrubbed research), and any note in the touch log. The touch log keeps its events. The person stays suppressed as hashes, never as plain text, so they are never contacted or named again. One audit line records the account, who, when and counts. PRD E7-S3 lists each store and how it is handled.
- **Vendors** are tested before anyone pays (E7-S2). Write `contacts/known.json` in the data folder (people we know: name, institution, email, title, asOf). Then run `contacts vendor-test --vendor NAME --results export.csv`, and `contacts vendor-pass --vendor NAME --by NAME`, which records a pass only if the latest test meets the thresholds in `contacts.json` (placeholders). Without a pass, a vendor cannot be a source.

On the platform, the account page's contact section does the same. The deletion needs the account's name typed, and migration `20261114200000_log_redaction.sql` lets it reach the touch log.

### The weekly triage (PRD E6-S5)

Every Monday, one page of what changed since the last triage, across every source, for the firm's principals only. It is never sent to anyone and never given to the drafter.

```bash
npm run outbound -- triage run                           # compare with the last triage; writes triage/<date>.json and .md in the data folder
npm run outbound -- triage run --since 2026-11-01        # start the window on a day instead
npm run outbound -- triage show                          # print the latest; --date YYYY-MM-DD for an earlier one
```

- **Grouped by institution**, each with one line of reasoning from a fixed template. No model is used, and the same inputs give the same triage.
  - **Act now:** a CMBS note sale, a failure in our metros (the FDIC sells), an SEC loan-sale or held-for-sale filing, a move to Tier A, or a Tier A bank crossing the concentration screen.
  - **Watch:** every other new signal, Tier B movements, state signals that turned on or off, and drop-outs.
  - **Already in conversation:** a reply, meeting or handoff in `touches.jsonl`. Shown apart, with the latest touch date.
- **Left out, and counted:** opted-out and suppressed institutions (never listed), and snoozed or dismissed candidates until they come back.
- **It compares with a snapshot,** `triage/state.json`: each candidate's tier and signals, and every event seen. The first run has none and says "first triage, no comparison".
- **Also shown:** where we are in the calendar (the next quarter-end, the review window, the next FDIC quarter and CMBS cycle), and source health (failed or suspect runs, stale sources, stale scoring).
- **The rules** are in `triage.json`, every value a placeholder for a principal to review.

On the platform, the job is `triage.run`. The worker workflow queues it every Monday after the FDIC check and a scoring run, and the web app shows the latest on its **This week** page.

### Who sells to whom (PRD E16)

A lender that has sold loans before is the warmest prospect there is. One ledger, `sales/ledger.json` in the data folder, holds every sale event the stored data shows:

| Kind | From | Seller | Buyer |
|---|---|---|---|
| `note_sale_completed`, `dpo`, `disposition` | A CMBS loan in our metros and sectors liquidated (code 3 or 6). Note sale if workout code 5 is in its history | The trust, through its special servicer | unknown |
| `bank_disclosed_sale` | A confirmed bank filer's 8-K Item 2.01, loan-sale or note-sale hit (the filings listener) | The bank, `fdic:CERT` | unknown |
| `whole_bank_acquisition` | An FDIC structure event: a bank with a presence in our metros acquired | The target (the FDIC, if it failed) | The acquirer, `fdic:CERT` |
| `fdic_sale_announced` | An FDIC loan-sale announcement on www.fdic.gov | The FDIC as receiver | unknown |

```bash
npm run outbound -- sources run fdicsales               # FDIC loan-sale announcements (needs config.fdic.userAgent filled in)
npm run outbound -- sales build                         # rebuild the ledger from stored data; the edgar and fdicsales runs do it too
npm run outbound -- sales sellers                       # who has sold before, by the institution that acted
npm run outbound -- sales buyers                        # known buyers: by kind, property type, metro and quarter
npm run outbound -- sales pricing                       # CMBS liquidations by property type and metro: APPROXIMATE implied recovery
npm run outbound -- sales list --seller fdic:12345      # or --kind disposition
```

- **Nothing is invented.** A buyer no source names is `unknown`. The implied recovery (1 − realized loss ÷ balance before liquidation) is labelled approximate: the loss includes liquidation expenses and advances, so it is never the price.
- **Gentle on the FDIC.** `robots.txt` first, only the paths it allows, and at most a few requests a minute. The FDIC publishes no buyers on the pages read; its closed-sales application is on `sales.fdic.gov`, which is not read (PRD E16, D-S1).
- **Kept.** Events are de-duplicated by a stable id and never dropped. One no stored record supports any more (a filer mapping rejected since, say) is marked `supported: false` and left out of the views.
- `saleSignals({ dir })` in `src/sales.mjs` returns event signals by `fdic:CERT` or `servicer:<slug>`, shaped like `filingSignals`. They are not in scoring yet.
- Two later sources have their event shape and no adapter: a recorded **assignment** of a deed of trust (with MERS treated as a nominee, and the chain to the current holder), and a **marketed listing**.
- The web app's **Sales** page shows the same: recent events, sellers who have sold, known buyers, and price evidence.

Property names and addresses are kept in the ledger for a principal. They never go in a log, and a test proves no event reaches the drafter.

### Enforcement orders (PRD next-five E18-S2)

An enforcement order is a dated sign that an examiner has told a bank to clean up its problem assets, and it reaches banks the SEC never sees. Only the Federal Reserve's orders are built. The FDIC's, which cover most banks in our list, the OCC's and the states' are not.

```bash
npm run outbound -- sources run enforcement             # the Fed's action files (no key), then each new matched order's document, for fixed phrases only
npm run outbound -- sources verify enforcement          # fresh, sourced, every stored order found again, every order matched or on the review list
npm run outbound -- enforcement list [--key fdic:CERT]  # orders and terminations on banks in the candidate list
npm run outbound -- enforcement unmatched               # the review list: orders naming a party in our states (or like a listed bank) that match no bank, or two
npm run outbound -- enforcement alias --key fdic:CERT --name "Example Bancorp, Inc." --by NAME   # the order's name becomes the bank's alias
```

- **No people.** Actions against individuals (prohibitions, Section 19 letters, a person's penalty) are skipped while the file is read. The Fed's type text and notes are never stored, because they can name a person. Only type codes are kept.
- **No order text.** For an order naming a bank in the list, the order PDF is read once, and only which phrases of `config.enforcement.flags` appear is stored. Page numbers are not recorded yet.
- **Matching by name.** The Fed gives no cert. An order matches a bank by exact name and state, or by an alias a principal added. A holding company matches only through an alias. Nothing is guessed.
- **Signals, no points.** An order is an event signal on the candidate. An order in force with no termination recorded is a state signal, which ends at its termination. The card states each from a fixed template. The windows are placeholders in `scoring.json` `enforcement`.
- The worker runs it monthly (`sources.enforcement`). It is context for the principals only: no research, drafting or call action loads `sources/enforcement/`.

### Routes to the decision-maker (PRD E22)

For each target: who actually decides on loan sales, then the best way in. A warm route gets a much better reply rate than a cold email.

| Route | What it is | Where the lender side comes from |
|---|---|---|
| **direct** | The named or candidate person | The account, and the briefer's `bank.people` findings (E7-S1) |
| **counsel** | The lender's own law firm | `bank.counsel` findings; county foreclosure filings naming the lender's counsel (event shape and seam only) |
| **advisor** | A loan-sale advisor or broker the lender has used | `bank.advisors` findings; a listing's advisor in the sale ledger where the bank sold |
| **board** | A director or officer someone in the firm's network knows | `bank.board` and `bank.people` findings |
| **forum** | A shared association or forum (CREFC, state bankers' associations, RMA, speaker lists) | `bank.memberships` findings |

```bash
npm run outbound -- network add-person --name "..." --organization "..." --known-by "Pat Example" --consent unknown --by "Pat Example"
npm run outbound -- network add-firm --name "..." --kind law --known-by "Pat Example" --by "Pat Example"
npm run outbound -- network add-membership --association "CREFC" --alias "CRE Finance Council" --principal "Pat Example" --by "Pat Example"
npm run outbound -- network list --by "Pat Example"          # every entry, and how many chosen routes use each (audited)
npm run outbound -- routes build --account acme-bank         # code only: writes routes/acme-bank.json and .md in the data folder
npm run outbound -- routes show --account acme-bank
npm run outbound -- routes choose --account acme-bank --route r-... --by "Pat Example"   # a checklist; nothing is drafted or sent
npm run outbound -- network remove --id np-1 --by "Pat Example"   # also removes every route and choice that used it
```

- **The firm's network** (`network/network.json` in the data folder) holds the principals' own relationships: people (name, organization, title, relationship, which principal knows them, whether they agreed to be asked for introductions), firms and memberships. Names and relationships only: an entry with an email address or a phone number is refused. Entry ids carry no name (`np-1`, `nf-2`, `nm-3`), and audit lines carry ids only.
- **The lender side** is researched by four new playbook topics (`bank.board`, `bank.counsel`, `bank.advisors`, `bank.memberships`; they replace `bank.access`). Each finding lists the people, firms and associations its quote names, and code keeps a name only if the quote holds it. These topics are context only: never cleared for a message.
- **Matching** (`src/routes.mjs`, `buildRoutes`) is code with no model, so no model ever sees the network. Names are compared in a normal form (case, punctuation, "&", legal suffixes, honorifics and middle initials do not matter) and must be equal: no fuzzy matching. No match means no route. A finding whose quote could not be checked is not used. A person a membership finding names is only ever a forum route's target, never a board route; a membership finding that names more than one association gives no forum route, because nothing says who appears with which.
- **The direct route** reads the address by the guard's own rule (`src/guard.mjs` `emailCheck`): verified only with a verification record for the current address, no older than `contacts.json` `reverifyDays`, and a source of the address's own. Its evidence is `bank.people` findings only. Choosing it rebuilds it from the account as it is now.
- **Tiers** as in `docs/paper-estimate.md`: a government, regulator or company source is reported, press observed, anything else inferred. A same-name match without a shared organization, a colleague, and a support check that did not say yes are inferred.
- **The FDIC's loan-sale advisor** is the FDIC-as-receiver's: listed only for a failed bank whose loans the FDIC sells, as a route into the FDIC's sale, never into a bank.
- **The order**, what counts as current, whether consent is required, and same-name matches are all placeholders in `routes.json` (PRD E22, D-R1 to D-R9).
- **A route relaxes no guard rule.** A route through a suppressed party is held. Choosing is refused after an opt-out or a suppression of the bank. Choosing changes no account, drafts nothing, records no touch; the checklist says who to ask, what to cite (with links), what never to mention, and what comes after an introduction.
- On the platform, the account page has a routes section and `/network` is its own page. Both run in units of work as the principal; there is no new job kind. Neither `network/` nor `routes/` is ever loaded by the briefer, the drafter or call prep (`test/routes-handoff.test.mjs`), and neither is `contacts/` (`test/private-stores-handoff.test.mjs`).

### A backtest of the score (PRD E17)

Every weight in `scoring.json` is a placeholder. The backtest asks whether the score, run on the data that existed at the time, ranked banks under pressure a few quarters before the event. Every setting is a placeholder in `config.json` `backtest` (decisions D-B1 to D-B5).

```bash
npm run outbound -- backtest panel                       # the point-in-time panel (free, no key): window and lookback in config.json
npm run outbound -- backtest panel --from 2021-03-31 --to 2026-06-30
npm run outbound -- backtest verify                      # coverage: rows for at least minCoverage of each quarter's universe
npm run outbound -- backtest labels                      # failures, assisted mergers, FDIC loan sales, from sources the score does not read
npm run outbound -- backtest run                         # the training quarters; writes backtest/report-<hash>.json and .md
npm run outbound -- backtest run --scoring alt.json      # another scoring file; the committed one is untouched
npm run outbound -- backtest run --compare a.json b.json # two side by side, training quarters only
npm run outbound -- backtest run --holdout               # the declared holdout, once, for the scoring file a principal chose
npm run outbound -- backtest run --rolling               # rolling origin, when the holdout holds too few labelled banks
npm run outbound -- backtest report                      # the latest report's summary (--hash H for another)
```

- **The panel** (`backtest/panel/` in the data folder) is the FDIC data as it stood at each past quarter-end. It covers every bank headquartered in our five states or with a Summary of Deposits branch in the six metros, **including banks that have since failed or merged**. A Call Report counts as known from quarter-end plus 60 days, the Summary of Deposits from its release date, and an event from its own date. The panel run has a run-log line, field checks and the change log, like every adapter. It is suspect when a quarter has rows for less than 95% of its universe.
- **Labels** (`backtest/labels.json`) are dated events from sources the score never reads: a failure (all three FDIC sources), an assisted merger, and an FDIC loan sale. Ordinary mergers are off. `disclosed_sale` is listed as unavailable until the SEC contact (Q11) and confirmed filers exist; an 8-K Item 2.01 hit is never a label on its own. A test proves that no label derives from a scored field. A bank with no label is unlabelled, not safe.
- **The replay** imports `scoreBank` from `src/score.mjs` (a test changes a weight and sees the output move). It uses no model and no network. Each run records the scoring and buy-box hashes and the panel and labels run ids. While the buy box has placeholders, every report is marked **PROVISIONAL**.
- **The report's headline leaves out fit.** Its groups are the top K by distress and timing points, and the banks at or above the Tier A distress threshold.
  - It gives the base rate, then for each group the observed-label yield, its lift and the share of observed labels captured, and the lead time. Each figure is split by whether the bank has a confirmed SEC filer, and repeated for the metro subset.
  - It adds a table per component, and the all-axis tiers as context.
  - It never says "precision" or "recall". Below `minLabels` labelled banks, a figure says "too few to tune on".
  - Every report states its known limits.
- **It never writes `scoring.json`.** A PR that changes weights adds a `_calibration` note, `{ report, evaluation, by, on }`, naming a holdout report's 16-character hash. A test checks its form.
- It runs from the command line only, with no worker job kind. The full panel is about 45 to 50 MB; the PRD (E17) has the estimate and the platform follow-up.

### Checking the scrapers

Tests use fakes, so they prove the code does what we meant, not that the sources say what we think. `sources verify` checks the stored data against the live sources. It is read-only and exits 1 on any failure:

```bash
npm run outbound -- sources verify fdic        # fresh, complete, every stored value and ratio equal to FDIC's own, every failure and deal stored
npm run outbound -- sources verify edgar       # every filer accounted for, the parser equal to a plain count of the file
```

| Check | What it proves | Live result, 2026-11-13 |
|---|---|---|
| `fdic.fresh` | We hold the latest quarter FDIC has published | Pass (June 30, 2026) |
| `fdic.coverage` | Every bank with a branch in the metros is on our list, and none has left | Pass (268 of 268) |
| `fdic.values` | Every stored field for that quarter equals what FDIC serves now | Pass (8,576 of 8,576; 9,916 with the capital fields) |
| `fdic.ratios` | Ratios computed from our stored values equal FDIC's own published ratios, construction to tier 1 capital included | Pass (500 of 500; 767 with `LNCDT1R`) |
| `fdic.concentration` | Each bank's CBLR flag matches how it reports total risk-based capital; the 36-month base quarter equals FDIC's | Pass (195 and 72 banks; 1,064 of 1,064) |
| `fdic.failures` | Every failure any of `/failures`, `/institutions` and `/history` shows in 36 months is in our record | Pass (10) |
| `fdic.failures-index` | A **warning**, not a failure: `/failures` lacks a failure the other two show | Warn (2 missing; index built 2026-08-25) |
| `fdic.events` | Every deal with a bank on our list is stored, with the same acquirer, target and date | Pass (60) |
| `edgar.accounted` | Every filer has a recorded outcome, and nothing that looks like CMBS was set aside | Pass (60 of 60) |
| `edgar.parse` | Re-reading a few trusts from SEC, our loan counts and total balances equal a plain count of each file | Pass (4 of 4) |
| `edgar.loans` | Every stored loan belongs to a trust read in the latest run, and carries its source filing | Pass (192) |

It also prints a few records, each with the exact public URL, for a person to compare by eye. A `WARN` line flags a gap in FDIC's own data; it does not change the exit code.

The first runs of these checks found real defects, all now fixed and tested:
- loan files that declare their namespace in the other order were rejected;
- a filing co-filed by a depositor was hidden (and would have been counted twice);
- an amendment without a loan file hid its trust;
- per-property records of a portfolio loan were counted as loans: 2,594 records in 60 trusts;
- servicer names were cut short.

**Scheduled:** the worker workflow verifies FDIC weekly after its pull, and CMBS monthly after its pull. There, `platform verify` prints check results only (no bank names), and a failure turns the run red.

**What the research does and does not do.** The paper profile, the fit and the signals decide who a principal approaches, when, and which sector to lead with. They never appear in a message. The drafter sees only the sector, and a test proves no FDIC figure reaches it.

## The platform (PRD E12)

**How it fits together.** The command line works on a data folder. The platform works on Postgres, through the same engine: every action loads the documents it needs, runs the engine in memory, and writes the changes back in one transaction with version checks (`src/uow.mjs`). The web app (`web/`) runs quick actions this way as the signed-in principal. Long jobs (FDIC pull, CMBS pull, scoring, research, drafting) are queued for the worker. Row-level security lets only active principals read. Nobody writes to a table directly. There is no send button anywhere.

```bash
# The database: apply supabase/migrations/ to the project (Supabase CLI or the SQL editor), then add principals with the service role.
OUTBOUND_TEST_PG="host=/tmp/pg port=5432 user=postgres" npm run test:db    # the migration's tests, against a DISPOSABLE Postgres only

# Operators and the worker use the service key (never in the web app):
export SUPABASE_URL=https://<project>.supabase.co SUPABASE_SERVICE_ROLE_KEY=...
npm run outbound -- platform push --from ~/valley-outbound-data           # copy a data folder in (safe to re-run)
npm run outbound -- enqueue sources.fdic                                  # or sources.edgar, score.run --draft-buybox, triage.run, research.run --account ID
npm run outbound -- worker --max 20                                       # run queued jobs; prints ids and outcomes only
npm run outbound -- platform pull --to ~/valley-outbound-backup           # a full copy back out, to a new folder
```

- **Worker schedule:** `.github/workflows/platform-worker.yml` runs the worker hourly on weekdays and queues the weekly FDIC check, then scoring and the weekly triage. The Monday scoring uses `--draft-buybox` unless the repository variable `SCORING_STRICT` is `true`. It is off until the repository variable `PLATFORM_ENABLED` is `true`. It needs the Actions secrets `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `ANTHROPIC_API_KEY`.
- **The web app:** see `web/README.md` for local development, the Supabase Auth settings (sign-ups off, invite principals) and Vercel.

## What each agent does, and how

### Agent 1: the guard (`src/guard.mjs`). Code only, no model.

**What:** decides whether a touch may happen at all, and keeps the record.
**How:** every proposed touch passes through one function, `checkTouch`, which returns the list of reasons it is refused:

- the kill switch (a config setting, an environment variable, or a `KILL` file in the data folder);
- the channel: AI-voiced calls, ringless voicemail, texts, WhatsApp and auto-dialing are refused outright, with the reason;
- a complete sender block (name, title, phone, street address) for the channel;
- suppression: an address, a domain, a person, an institution and its aliases and affiliates, or an asset or party under NDA that the text names;
- the contact: business addresses only (no personal domains, no role addresses like `info@`), a verified address, a confirmed role, a recorded source, calls only to business landlines in local weekday hours;
- the caps: new accounts per sender per week, emails per sender per day, touches in 90 days and a minimum gap (both counted across the whole bank, not per person);
- one person at a bank at a time: a second contact at the same bank waits out a quiet period (45 days, a placeholder);
- the sequence: the right step, on the right channel, once it is due; and it ends;
- a reply, opt-out, meeting or handoff from anyone at a bank stops outreach to everyone there for good. An opt-out suppresses the person and address immediately.

It stores no message text, and writes an audit line for every decision.

### Agent 2: the briefer (`src/research.mjs`). Deep research, Sonnet at high effort.

**What:** for one account and one named person, finds out who they are, how exposed the institution is, whether it has said it will sell, who the decision-maker is, who is around them, and whether there is any reason not to approach now. Produces a brief a principal can read in a few minutes, with every claim sourced.
**How:**

1. **Plan.** It is given the playbook for the account type (`playbooks.json`: banks, servicers, funds, counsel, receivers, brokers): the questions, where to look, and the evidence standard for each.
2. **Research.** It runs web searches and fetches pages on Anthropic's servers (search up to 25, fetch up to 20, up to 6 continuation turns), reading primary sources rather than stopping at search results. It has no tool that acts in the world, so a hostile page cannot make it do anything. LinkedIn and similar sites are blocked from fetching.
3. **Record.** Each finding is a record: the claim, a verbatim quote, URL, publisher, date, evidence tier and kind. It also reports gaps, contradictions, a risk screen ("approach / wait / do not approach"), a check of the named person's role, and an angle at the level of the pattern.
4. **Verify, in code, against a ledger of what was really retrieved.** A finding whose URL the agent never retrieved is dropped. A finding whose quote is not in the retrieved text is dropped. A role is "confirmed" only with two independent verified sources.
5. **Check support.** A cheaper model reads each claim next to its quote and says yes, partly or no. "No" drops it; "partly" makes it context only.
6. **Earn draft use.** A finding is cleared for a message only if it is verified, from an acceptable source, not about a particular asset, not a risk or regulatory fact, not stale, and the support check said yes. Everything else is context for the principal and never reaches the drafter.

**Output** (in the data folder): `briefs/<id>.md` to read, `facts/<id>.json` for the drafter, `research/<id>.json` with the full record and run report. Full page text is not stored; only quotes.

### Agent 3: the drafter (`src/draft.mjs`, `src/lint.mjs`). Sonnet at high effort, no tools.

**What:** writes one email, letter, LinkedIn note or call sheet for a principal to send under their own name.
**How:**

1. **Refuses early,** before spending anything: no research, a risk screen that says wait or do not approach, or a guard refusal.
2. **Sees only what is cleared:** the facts the briefer cleared for a message, and the claims people approved for this sector and audience. It never sees context-only facts, so it cannot leak them.
3. **Writes markers, not promises.** The model writes `{{claim:id}}` and `{{page:/path/}}`; the script inserts the approved wording word for word and the real link. It also adds the greeting and the sender's signature. So the model cannot promise, link or sign anything on its own. Each approved claim is a sentence that appears on the site, and a test fails if the site's wording drifts.
4. **Is linted** (`lint.mjs`) for: banned and cliché language, broker language and blunt asks (what is for sale, a list of loans, quarter-end pressure), the wrong word for the audience (banks say "loan sale"; servicers say "note sale"), any firm promise not made through a claim, figures and names not in a cleared fact, "I read your..." with no fact behind it, context-only facts leaking, bad links, subject and length. One repair round is allowed; a draft that still fails is saved as **blocked**.
5. **Is checked by the guard again** with its text, so a draft that names a suppressed asset is blocked.
6. **Waits for a person.** `draft approve` re-runs the linter and the guard on the saved draft, so an edited or stale draft cannot slip through, and records who approved it. Approving is not sending and records no touch.

## Files

| Path | What |
|---|---|
| `config.json` | Caps, sequence, channels, call hours, sender requirements, link targets (placeholders) |
| `models.json` | Which model does which job, caps for research, prices |
| `claims.json` | The only statements about the firm a message may make |
| `terminology.json` | Per-audience word rules, banned and cliché language, claim phrases |
| `playbooks.json` | The briefer's questions by account type |
| `metros.json` | The six target metros by CBSA code, with counties from the Census 2023 delineation |
| `buybox.json` | What the firm buys. `[CONFIRM]` fields block scoring until a principal fills them |
| `scoring.json` | Score components (distress, fit, timing), signal rules, tier cuts and the CMBS maturity window; every number a placeholder |
| `triage.json` | The weekly triage: the window, what counts as act now and watch, the calendar settings and staleness limits; every value a placeholder |
| `routes.json` | Routes to the decision-maker: which playbook topics feed which route, the route order, tiers, matching, consent and currency; every value a placeholder |
| `supabase/migrations/` | The platform's tables, access rules and functions. Structure only, no data |
| `web/` | The principals' web app (Next.js) |
| `.github/workflows/` | The platform worker's schedule (off until enabled) |
| `src/` | `guard`, `research`, `draft`, `lint`, `model` (the only file that calls the Anthropic API), `rules`, `store`, `paths`, plus the pipeline: `sources/` (`http`, `runlog`, `fdic`, `edgar`, `fdicsales`, `filings`, `enforcement`), `metrics`, `score`, `paper` (the paper estimate), `candidates`, `triage`, `sales`, `pilot`, call prep and outcomes: `calls`, `outcomes`, routes to the decision-maker: `network`, `routes`, the backtest: `backtest/` (`panel`, `labels`, `run`), and the platform: `uow`, `platform/` (`client`, `worker`, `move`) |
| `scripts/sync-site.mjs` | Refreshes `site-snapshot/` from the website repository (see below) |
| `site-snapshot/` | A copy of the 7 website files the rules depend on, a list of the site's pages, and a record of the commit it came from. Committed. Refresh it; do not edit it. |
| `docs/` | The plan, the research agenda, and the PRD for the signal pipeline |
| `test/` | 190 tests, no network, invented data only. `npm test`; `npm run test:db` against a disposable Postgres |

In `$OUTBOUND_DATA_DIR`:

- `senders.json`, `suppression.json`, `accounts/`, `research/`, `facts/`, `briefs/`, `drafts/<account>/`, `touches.jsonl`, `audit.jsonl`;
- for the pipeline: `sources/` (FDIC data, the CMBS and SEC pulls, enforcement orders, the run log and the change log), `candidates/` (the latest list and principals' decisions), `paper/` (one paper estimate per bank), `sales/` (the sale ledger), `triage/` (each week's triage and its snapshot), and `pilot/` (truth sheets, verdicts, the pass).
- for calls: `calls/<account>/` (call briefs, notes, proposals and follow-ups), `outcomes.jsonl` (confirmed outcomes) and `reports/`.
- for routes (PRD E22): `network/` (the firm's own relationships: private, never given to a model) and `routes/` (each account's routes and the chosen route's checklist).
- for the backtest (PRD E17): `backtest/panel/` (the point-in-time panel), `backtest/labels.json`, `backtest/report-<hash>.json` and `.md`, and the logs `backtest/runs.jsonl` and `backtest/holdout.jsonl`.

## Changing it

- **A firm claim:** add it to `claims.json` only if it already appears on the site, and cite the page. The test then keeps it honest. Counsel should read anything that promises something (`needsCounsel`).
- **What the briefer researches:** edit `playbooks.json` and `docs/research-agenda.md` together.
- **A new audience's wording:** add rules to `terminology.json`. Until then the linter warns instead of guessing.
- **Model or effort:** `models.json`. Raise effort before raising the model. The research step is the one place `claude-opus-5-5` may pay for itself.

## The website repository, and the snapshot

The public website (`joshrkay/Valley-Capital-partner`) and this repository are separate. Three things here depend on the website, so a few of its files are copied into `site-snapshot/`:

- **The claims.** Every approved claim in `claims.json` is a sentence that appears word for word on a website page. A test checks each against the snapshot. If the website's wording changes, the snapshot goes stale and a claim could quietly stop matching what the site says.
- **The word rules.** The banned-word list (`desk/lint.json`) and the bank terminology rules (`scripts/terminology.json`) are the website's, so the outreach and the site never disagree. The terminology guide (`docs/terminology.md`) is copied too, for the test that checks the preferred terms.
- **The page list,** so a message can only link to a page that exists.

```bash
npm run sync-site -- --github joshrkay/Valley-Capital-partner    # refresh from the public repo
npm run sync-site -- --from ../Valley-Capital-partner            # or from a local checkout
npm run sync-site:check -- --github joshrkay/Valley-Capital-partner   # exits 1 if the snapshot is stale
```

**Run the check before relying on the claims, and whenever the website's copy changes.** Then run `npm test`: a claim that no longer matches the site fails there, and has to be updated or re-approved by a person.

This repository was split out of the website repository on November 13, 2026 (its PR #9, merge commit `8865c88`). History before that point is in the website repository.
