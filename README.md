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
