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

Start with `docs/prd-signal-pipeline.md` for the pipeline, and `docs/research-agenda.md` for the briefer. The briefer's questions (`playbooks.json`) are that agenda turned into data.

## Status: read this first

- **Never run against the live API.** There was no API key in the environment where this was written. The tests use a fake client and, for the wire format, the real SDK pointed at a local stand-in server. They prove the requests the SDK builds (endpoint, fallback header, the two server tools with their caps, effort, resuming a paused turn), every check in the guard and the linter, and that the verification logic drops what it should. They do **not** prove how the model words things, and they do not prove the shape of live search and fetch results. The ledger reads those shapes defensively and trusts nothing it does not recognize, but **the first live run is a test of the briefer, not a result.** Read its first briefs against what you know.
- **Cost is unmeasured.** Deep research is the expensive step. `models.json` caps searches, fetches and turns per account; the brief reports tokens used and an estimate from token prices only. Search fees are not included. Run on a handful of accounts first.
- **Every number in `config.json` is a placeholder** (caps, sequence timing, call hours). They are not researched.
- **Counsel has not reviewed any of it,** including the claims and the channel rules.
- **The FDIC adapter has run live** (2026-11-13): 268 banks, 8 quarters to June 30, 2026, about 7 seconds, public data with no key. The scoring weights, thresholds and tier cuts in `scoring.json` are **placeholders**. The buy box (`buybox.json`) has `[CONFIRM]` fields a principal must fill. Until then `score run` refuses, or with `--draft-buybox` it labels its list PROVISIONAL.
- **The CMBS adapter has run live** on 40 trusts (2026-11-13) with a generic User-Agent. `config.sec.userAgent` stays a `[CONFIRM]` placeholder, and the adapter refuses to run until a principal fills it with the firm's name and contact (PRD Q11).
- **The platform is built but not deployed.** The migration and its access rules pass 10 tests on Postgres 16 (`npm run test:db`). The client, worker and web app are tested against a fake of Supabase's REST API; the first run against a real project is E12-S7, which needs a Supabase project and a Vercel team (PRD Q17, Q18).
- **Not built yet:**
  - county records (PRD E5; the spike first);
  - servicers as scored candidates (E4-S3), and contact details (E7);
  - deploying the platform (E12-S7);
  - Gmail drafts and reply detection (E9);
  - quarterly nurture (E10);
  - the referral mapper, meeting prep and the reporter.

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
npm run outbound -- candidates promote --key fdic:12345 --by "Pat Example"
npm run outbound -- research run --account <id>          # institution research: brings back who decides (refused until the pilot passes)
npm run outbound -- account set-person --account <id> --name "..." --title "..." --by "Pat Example"
```

Behind a proxy, Node's built-in `fetch` needs `NODE_USE_ENV_PROXY=1` (Node 22.21 or later).

**The FDIC pull also records three kinds of pressure** (PRD E3-S5 to S7), in the same `sources run fdic` job:

- **Failures.** FDIC's `/failures` index is stale: built August 25, 2026, it lacks two later failures, one of them in the Los Angeles metro. So failure is taken from `/failures`, `/institutions` (closing code `CHANGEC1` and end date `ENDEFYMD`) and `/history`, and from FDIC's failed-bank CSV if a person saves it as `sources/fdic/failed-banks.csv` in the data folder. A bank counts as failed if any source says so, and `sources/fdic/failed.json` records which ones agree. A failed bank with a presence in the metros is listed under `candidates list`, with the FDIC as the seller of its loans and a link to the FDIC loan-sale page.
- **Mergers and acquisitions**, from `/history`, kept in `sources/fdic/events.json`. A bank that acquired a bank with a presence in the metros gets an **event** signal, visible for 4 quarters (a placeholder).
- **The concentration screen**: construction loans and CRE against capital, and 36-month CRE growth, shown in the paper profile and as **state** signals. Its definition, from the 2006 interagency guidance, is **unconfirmed**. A bank on the community bank leverage ratio reports no total risk-based capital, so it is divided by tier 1 capital plus the allowance, and every value says which denominator it used.

Every signal says whether it is a state signal (recomputed while the condition holds) or an event signal (a dated change, kept).

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

It writes `sources/edgar/loans.json`, `trusts.json` and `servicers.json`. Every loan and property detail is **context for a principal, never for a message**.

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
npm run outbound -- sources run filings                  # since the last run; a new filer is searched back a year
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

So every response is matched to its request before it is used.

On the platform, the job is `sources.filings`. The worker workflow queues it on weekdays at 23:37 UTC, then verifies it. That schedule stays off until a principal has filled `config.sec.userAgent`, confirmed at least one filer, and set the repository variable `FILINGS_ENABLED` to `true`. Until then the run would fail its own checks every day and hide real failures.

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
npm run outbound -- enqueue sources.fdic                                  # or sources.edgar, score.run --draft-buybox, research.run --account ID
npm run outbound -- worker --max 20                                       # run queued jobs; prints ids and outcomes only
npm run outbound -- platform pull --to ~/valley-outbound-backup           # a full copy back out, to a new folder
```

- **Worker schedule:** `.github/workflows/platform-worker.yml` runs the worker hourly on weekdays and queues the weekly FDIC check. It is off until the repository variable `PLATFORM_ENABLED` is `true`. It needs the Actions secrets `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `ANTHROPIC_API_KEY`.
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
| `supabase/migrations/` | The platform's tables, access rules and functions. Structure only, no data |
| `web/` | The principals' web app (Next.js) |
| `.github/workflows/` | The platform worker's schedule (off until enabled) |
| `src/` | `guard`, `research`, `draft`, `lint`, `model` (the only file that calls the Anthropic API), `rules`, `store`, `paths`, plus the pipeline: `sources/` (`http`, `runlog`, `fdic`, `edgar`), `metrics`, `score`, `candidates`, `pilot`, and the platform: `uow`, `platform/` (`client`, `worker`, `move`) |
| `scripts/sync-site.mjs` | Refreshes `site-snapshot/` from the website repository (see below) |
| `site-snapshot/` | A copy of the 7 website files the rules depend on, a list of the site's pages, and a record of the commit it came from. Committed. Refresh it; do not edit it. |
| `docs/` | The plan, the research agenda, and the PRD for the signal pipeline |
| `test/` | 190 tests, no network, invented data only. `npm test`; `npm run test:db` against a disposable Postgres |

In `$OUTBOUND_DATA_DIR`:

- `senders.json`, `suppression.json`, `accounts/`, `research/`, `facts/`, `briefs/`, `drafts/<account>/`, `touches.jsonl`, `audit.jsonl`;
- for the pipeline: `sources/` (FDIC data, the run log and the change log), `candidates/` (the latest list and principals' decisions), and `pilot/` (truth sheets, verdicts, the pass).

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
