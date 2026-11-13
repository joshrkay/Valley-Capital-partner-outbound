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
  - there are no third-party scripts, fonts or analytics;
  - one-time messages travel in a short-lived cookie, not the URL;
  - briefs are rendered as text (`lib/markdown.mjs`), so nothing quoted from a web page can inject markup.

## Screens

| Path | What |
|---|---|
| `/candidates` | The candidate list, filtered by tier and metro, with the PROVISIONAL banner. Suppressed, promoted, dismissed and snoozed banks are hidden exactly as `outbound candidates list` hides them. |
| `/candidates/[key]` | The paper profile: each CRE category's balance, share and stages of distress, each with its FDIC field and report date. Also the footprint by metro, components by axis with their inputs, signals, and the "why now" sentences with their evidence. Promote, dismiss (reason required), snooze (date required). |
| `/servicers` | CMBS special servicers of loans on properties in our metros and buy-box sectors, from the trusts' SEC loan-level filings (PRD E4-S3). Each shows loans, balance, how many are in special servicing, coded for a note sale, delinquent or maturing, and its metros and sectors. Sorted by special servicing, then note sale, then balance. Reads only the per-servicer summary. |
| `/servicers/[name]` | That servicer's loans: trust, balance, rate, maturity, payment status, workout, signals, and each property's city, metro, type, occupancy and DSCR. Every value names its filing and reporting period, with a link to the filing on sec.gov. A banner that stays visible while scrolling says the detail is context for a principal only and never goes in a message. Property names and addresses are not shown. |
| `/accounts`, `/accounts/[id]` | Accounts with person, role, research status and origin. The pipeline block, the brief, set person, confirm role, and queue research (refused with the pilot message until it passes) or a draft. |
| `/drafts` | Drafts waiting for approval, with their lint result. Approve re-runs the linter and the guard. There is no send button. |
| `/pilot`, `/pilot/[id]` | The scorecard, finding-by-finding verdicts, and recording a pass. |
| `/status` | Jobs, source runs and the kill switch. Queue an FDIC pull, a CMBS pull (SEC EDGAR) or scoring (optionally with the draft buy box). The last EDGAR run's counts (trusts read, loans read and kept), and its error if the last pull failed. A placeholder SEC contact fails before the run log is written, so the failed job's own error is shown too. |

## Run it

```bash
cd web
cp .env.example .env.local      # fill SUPABASE_URL and SUPABASE_ANON_KEY
npm install
npm run dev                     # http://localhost:3000
npm test                        # server helpers against a fake Supabase REST API, no network
npm run build
```

## Supabase setup (once, by an operator)

1. Apply `../supabase/migrations/`.
2. **Auth → turn off public sign-ups.** Invite each principal as a user, and add a row for each to `public.principals` (email, name, active) with the service role. Someone signed in who is not an active principal sees "Not authorized" and the database returns nothing.
3. **Auth → URL configuration.** Set the site URL to the app's address, and allow `https://<app>/auth/callback` as a redirect URL. The callback accepts both a PKCE `code` and a `token_hash` link.

## Deploy (Vercel)

- Root directory `web`, with "include files outside the root directory" on. `next.config.mjs` traces `../src`, the rule files, `../site-snapshot` and `../node_modules/@anthropic-ai/sdk`.
- Environment variables: `SUPABASE_URL` and `SUPABASE_ANON_KEY` (plus the `NEXT_PUBLIC_` copies if a client component ever needs them). `ENGINE_ROOT` is only needed if the repository layout differs at runtime.
- Turn preview deployments off or protect them (PRD E12-S7).
- **On the first deploy, check that a page loads data.** The engine is loaded at runtime from the traced files, which was verified with `next start` but not yet on Vercel.

## Dependencies

All pinned exactly, each release at least two weeks old when chosen: next 16.4.3, react 19.3.1, react-dom 19.3.1, @supabase/supabase-js 2.118.0, @supabase/ssr 0.12.7. Nothing else.
