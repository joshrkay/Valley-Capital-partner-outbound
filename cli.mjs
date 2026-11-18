#!/usr/bin/env node
// Command line for the three outbound agents. Prospect data lives in $OUTBOUND_DATA_DIR (outside the repo); nothing here can send a message.
import { join } from 'node:path';
import { dataDir } from './src/paths.mjs';
import { loadRules } from './src/rules.mjs';
import { readJson, readJsonl, writeJson, readText, listFiles, exists, safeId, audit } from './src/store.mjs';
import { runFdic } from './src/sources/fdic.mjs';
import { runEdgar } from './src/sources/edgar.mjs';
import { verifyFdic, verifyEdgar } from './src/sources/verify.mjs';
import { runFilings, verifyFilings, loadFilingRules, discoveredFilers } from './src/sources/filings.mjs';
import { runFdicSales, verifyFdicSales } from './src/sources/fdicsales.mjs';
import { runFdicOrders, verifyFdicOrders } from './src/sources/fdicorders.mjs';
import { runOccOrders, verifyOccOrders } from './src/sources/occorders.mjs';
import { runMergerApps, verifyMergerApps, mergerPaths, KINDS as MERGER_KINDS } from './src/sources/mergerapps.mjs';
import { runEnforcement, verifyEnforcement, unmatchedOrders, aliasParty, ordersFor, ordersByBank, TYPES as ORDER_TYPES } from './src/sources/enforcement.mjs';
import { buildLedger, readLedger, listSales, groupBySeller, groupBuyers, pricing, verifyLedger } from './src/sales.mjs';
import { writeRegistry } from './src/intermediaries.mjs';
import { suggestFilers, confirmFiler, rejectFiler, filerStatus } from './src/sources/filers.mjs';
import { LOADS } from './src/uow.mjs';
import { runScoring } from './src/score.mjs';
import { listCandidates, getCandidate, promote, dismiss, snooze } from './src/candidates.mjs';
import { readPaper, renderPaper, paperPath } from './src/paper.mjs';
import { runTriage, readTriage, renderTriage, triagePaths } from './src/triage.mjs';
import { coverageReport, renderCoverage } from './src/coverage.mjs';
import { loadContext, checkTouch, recordObservedSend, recordEvent, addSuppression, dueList, touchFromAccount } from './src/guard.mjs';
import { runBriefer } from './src/research.mjs';
import { loadEvents } from './src/events.mjs';
import { runDrafter, approveDraft } from './src/draft.mjs';
import { makeClient } from './src/model.mjs';
import { gmailClient, createGmailDraft, syncSends, syncInbox, readReview } from './src/mailbox.mjs';
import { writeTruthTemplate, reviewList, markFinding, scorecard, passPilot, researchGate } from './src/pilot.mjs';
import { platformClient } from './src/platform/client.mjs';
import { setPerson, confirmRole, confirmOrder, setEmail, setPhone, setAddress, addDomain, verifyEmail, contactStatus, sourceLabel, FIELDS, ATTEST_METHODS } from './src/accounts.mjs';
import { forgetInFolder } from './src/forget.mjs';
import { runVendorTest, passVendor, listVendors } from './src/vendors.mjs';
import { work, JOB_KINDS } from './src/platform/worker.mjs';
import { push, pull } from './src/platform/move.mjs';
import { smoke } from './src/platform/smoke.mjs';
import { runCallPrep, saveNotes, runCallExtract, buildExtractPrompt, confirmInFolder, rejectProposal, editProposal, listCalls, renderProposal, needDate, MAX_NOTES } from './src/calls.mjs';
import { runOutcomesReport, renderOutcomesReport } from './src/outcomes.mjs';
import { addPerson, addFirm, addMembership, listNetwork } from './src/network.mjs';
import { buildRoutes, readRoutes, chooseRoute, removeNetworkEntry } from './src/routes.mjs';
import { runPanel, verifyPanel } from './src/backtest/panel.mjs';
import { buildLabels } from './src/backtest/labels.mjs';
import { runBacktest, readReport, summarize } from './src/backtest/run.mjs';
import { readSenders, setSender, removeSender, sendingReadiness, validateSender } from './src/senders.mjs';
import { runNoticeSource, verifyNoticeSource, clearBlock } from './src/sources/notices.mjs';
import { buildLoanIndex, readBankLoans, readLoanState, loanEvents, loansPaths, DOC_TYPES, STAGES, AMOUNT_BASES, PROPERTY_TYPES } from './src/loans.mjs';
import { countySource, countyCoverage } from './src/counties.mjs';
import { readFileSync } from 'node:fs';

const HELP = `Outbound agents. Set OUTBOUND_DATA_DIR to a private folder OUTSIDE this repository first.

  outbound init                                   create the data folder, a sender template and an invented example account
  outbound status                                 what exists, and what is missing before anything can send

  outbound research run --account ID [--dry-run]  Agent 2: deep web research and a verified brief (costs money; --dry-run shows the request)
  outbound research show --account ID             print the brief
  outbound account set-person --account ID --name N [--title T] --by NAME SOURCE   a principal names the person, usually one of an institution
                                                  brief's candidates (--finding F3); a new person starts with an unconfirmed role and no address
  outbound account confirm-role --account ID --by NAME    a principal confirms the named person's role after reading the brief
  outbound account confirm-order --account ID --order ORDER --by NAME
                                                  a principal confirms seeing an enforcement order in force against the bank;
                                                  no touch is approved until each order in force is confirmed, once (D-E3)

  Contact details (PRD E7-S3). Every field records where it came from. SOURCE is one of:
    --finding F3                                  a finding in the account's brief (its page and date come from the brief)
    --url URL                                     a page on the bank's own site
    --source correspondence|principal_known [--seen YYYY-MM-DD]     they wrote to us; or a principal knows it first-hand
    --source vendor --vendor NAME                 a contact-data vendor, only after a recorded pass (contacts vendor-pass)
  outbound account contact --account ID           each field with its source, the address's state, the domains
  outbound account set-email --account ID --email E --by NAME SOURCE      a new address starts unverified
  outbound account set-phone --account ID --phone P --type landline|mobile|unknown [--timezone TZ] --by NAME SOURCE
  outbound account set-address --account ID --address A --by NAME SOURCE  the mailing address, for letters
  outbound account add-domain --account ID --domain D --by NAME SOURCE    a principal confirms one of the institution's email domains
  outbound account verify-email --account ID --by NAME --method institution_site --url URL | correspondence [--seen D] | principal_known
                                                  | vendor --vendor NAME     every check must pass (syntax, a source, a business
                                                  address, a confirmed domain, an MX record in DNS, no suppression) and you record
                                                  how you know it. No mail server is contacted. It lasts contacts.json reverifyDays
  outbound account forget-person --account ID --by NAME --reason TEXT --confirm "ACCOUNT NAME" [--name N --email E]
                                                  a deletion request: removes the person from every record in the data folder (the
                                                  routes and the firm's network included: a routes file that names them is rebuilt), keeps
                                                  a hashed suppression entry so they are never contacted or named again, and logs counts
                                                  only. --name/--email: a person no longer on the account

  Contact-data vendors (PRD E7-S2). No vendor API and no key: a principal exports the vendor's results to a file.
  outbound contacts vendor-test --vendor NAME --results FILE [--by NAME]   compare a vendor's CSV or JSON export with contacts/known.json
                                                  (people we know: name, institution, email, title, asOf); writes
                                                  contacts/vendor-tests/<vendor>-<date>.json and .md: refs, counts and rates only
  outbound contacts vendor-pass --vendor NAME --by NAME   record a pass, only if the latest test meets every threshold in contacts.json
  outbound contacts vendors                       each vendor's tests and pass

  outbound draft run --account ID --channel email|letter|linkedin_note|call [--step N] [--sender ID] [--date YYYY-MM-DD] [--ack-risk] [--dry-run]
  outbound draft approve --account ID --channel C --step N --by NAME
  outbound draft show --account ID --channel C --step N

  outbound guard check  --account ID --channel C [--step N] [--sender ID] [--date D]
  outbound guard due    [--sender ID] [--date D]
  outbound mailbox draft --account ID --step N --by NAME   an approved email into the sender's own Gmail as a DRAFT (PRD E9-S1). It never delivers mail:
                                                   a person presses the button. Needs GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN
  outbound mailbox sync [--days N] [--sort]       notices drafts that were sent (records the touch with its real date) and reads the inbox: any reply
                                                   stops outreach at the bank; bounces and opt-outs are handled; --sort asks a model to sort replies
  outbound mailbox review                          mail that matched no account (message id, date, reason, sender domain only)
  outbound guard record --account ID --channel C --step N --sender ID [--date D] [--by NAME]   after a person has actually sent it (always logged; broken rules are shown)
  outbound guard event  --account ID --type reply|opt_out|bounce|meeting|handoff [--date D] [--note TEXT] [--by NAME]
                                                  --note is a short internal note, never the reply's text. An opt-out suppresses the person and the address

  Senders (senders.json): who a message goes out under. The same rule as the web app's Senders page.
  outbound senders list                           each sender, whether it is complete, and whether sending is ready (as status says)
  outbound senders set --id ID [--name N] [--title T] [--phone P] [--address A] [--mailbox M] --by NAME
                                                  add a sender, or change the fields given. Every field the guard requires, no [CONFIRM],
                                                  a business mailbox for a person, and a full street address (CAN-SPAM)
  outbound senders remove --id ID --by NAME       only a sender no recorded touch names; one that has sent stays
  outbound suppress add --type email|domain|person|institution|asset --value V --reason R [--alias A]...
  outbound suppress list

  Signals (PRD E2, E3): public data only. Nothing here contacts anyone.
  outbound sources run fdic [--include-hq]       bank list for the six metros, deposit footprint, 8 quarters of CRE credit data (free, no key),
                                                  plus failures (from /failures, /institutions and /history), mergers and acquisitions,
                                                  and the concentration screen's capital fields. FDIC's failed-bank list CSV is read too,
                                                  if a person saved it as sources/fdic/failed-banks.csv in the data folder (optional)
  outbound sources run edgar                      CMBS loans in the six metros and buy-box sectors, from each trust's monthly SEC filing,
                                                  with workout codes and the special servicer (needs config.sec.userAgent filled in)
  outbound sources run filings [--since YYYY-MM-DD]   the SEC filings listener (PRD E13-S1): the saved searches in filings.json on
                                                  EDGAR full-text search, for every bank filer a principal confirmed, plus a discovery
                                                  search by state and bank SIC code (needs config.sec.userAgent filled in)
  outbound sources run fdicsales                  FDIC loan-sale announcements from www.fdic.gov (PRD E16-S2): sale id, dates, receiverships,
                                                  pools, the FDIC's own loan-sale advisor (a route into FDIC sales, never into a bank);
                                                  the buyer is unknown. Gentle: robots.txt and a few requests a minute
                                                  (needs config.fdic.userAgent filled in). Then rebuilds the sale ledger, as the edgar run does
  outbound sources run enforcement                enforcement orders (PRD next-five E18-S2): the Federal Reserve's actions against organizations,
                                                  with their type, dates and terminations; actions against individuals are skipped. Reads
                                                  the order document of orders naming a bank in the list, for fixed phrases only
  outbound sources run mergerapps                 merger applications (PRD next-five E18-S3): the Federal Reserve's weekly H.2, every district;
                                                  merger and acquisition filings kept, approvals and withdrawals applied, closes linked to FDIC
  outbound sources run occorders                  OCC orders (E18-S2): the OCC's monthly enforcement news releases on www.occ.gov, no key;
                                                  actions against banks and terminations kept, actions against individuals skipped
  outbound sources run fdicorders [--since YYYY-MM-DD] [--debug-capture FILE]   FDIC orders (E18-S2), ON A PRINCIPAL'S MACHINE: the monthly
                                                  releases on www.fdic.gov, then each one's order list on orders.fdic.gov in a headless
                                                  browser (first: npm run fdic-orders:setup). Individuals skipped. --debug-capture writes
                                                  the table's shape with every name masked, if the columns cannot be mapped
  outbound sources status                         the last run of each source, and the latest FDIC quarter seen
  outbound sources verify [fdic|edgar|filings|fdicsales|enforcement|fdicorders|occorders|mergerapps] [--sample N]   check the stored data against the live sources (read-only): fresh, complete,
                                                  values and ratios equal FDIC's own, every failure and deal stored, the CMBS parser equal
                                                  to a plain count, stored filings found again; plus a short list of records with their
                                                  public URL to compare by eye. Exits 1 on any failure. WARN flags a gap in FDIC's own data
                                                  (a stale /failures index). With no source named: fdic and edgar.

  Who sells to whom (PRD E16): one ledger of sale events from stored data. Context for a principal only; never in a message.
  outbound sales build                            rebuild sales/ledger.json: CMBS dispositions and DPOs, bank filings disclosing a sale,
                                                  whole-bank acquisitions in the metros, FDIC loan-sale announcements
  outbound sales list [--seller KEY] [--kind K]   the events, newest first (KEY: fdic:CERT, servicer:<slug>, cmbs-trust:CIK, fdic-receiver)
  outbound sales sellers                          who has sold before: count by kind and the latest date, per seller
  outbound sales buyers                           the known buyers, by kind, property type, metro and quarter
  outbound sales pricing                          CMBS liquidations by property type and metro, with an APPROXIMATE implied recovery
  outbound sales verify                           check the ledger itself (no network): every event valid, no buyer or price invented

  Merger applications (PRD next-five E18-S3): signals only, no points. Never in a message.
  outbound mergers list [--all]                   open applications naming a bank in the list (--all: every stored one), newest first
  outbound market pack --quarter YYYY-MM-DD       the market data pack (next-five E20): aggregates by metro, no institution named,
                                                  with the disclosure guard; writes market/<quarter>.json and .md (principals only)
  outbound market show [--quarter YYYY-MM-DD]     print a stored pack (the latest by default)
  outbound intermediaries build                   the registry (next-five E19): firms acting for sellers, from stored data only; also
                                                  rebuilt whenever the sale ledger is
  outbound intermediaries list [--kind K]         ranked, with each firm's score, mandates and registration state
  outbound intermediaries show --key KEY          one firm: its score by component, every mandate with its source, its referrals
  outbound intermediaries mandate --firm NAME --kind K --seller S --date D --how TEXT --by NAME
                                                  a principal's record that a firm acted for a named seller (S: fdic:CERT, ...)
  outbound intermediaries referral --firm NAME --seller S --date D --by NAME
                                                  a call named this firm as the way in: kept apart, never ranked
  outbound intermediaries direct --seller S --date D --how TEXT --by NAME
                                                  evidence the seller sold WITHOUT an advisor (the only way a route is "direct")
  outbound intermediaries promote --key KEY --by NAME   a firm to an account (audience intermediary); no draft until claims.json approves claims for it
  outbound intermediaries alias --key KEY --alias NAME --by NAME
  outbound intermediaries register --key KEY --state STATE --by NAME [--recertify-by YYYY-MM-DD]
                                                  buyer-list registration with a loan-sale advisor (owner: Josh, D-I2)
  outbound intermediaries credibility-approved --by NAME
                                                  the credibility package (D9) is approved: only then may proof of funds be sent
  outbound intermediaries nda --key KEY --type asset|institution --value V --by NAME
                                                  something learned under an advisor's agreement: onto the NDA list
  outbound intermediaries route --seller fdic:CERT
                                                  how a seller sells: unknown, advisor, direct or both
  outbound intermediaries reminders               buyer-list re-certifications due soon
  outbound mergers gap                            mergers seen only at their close (no H.2 application named them): the count
                                                  that decides whether an OCC applications reader is worth building (Q5)

  Enforcement orders (PRD next-five E18-S2): signals only, no points. Never in a message.
  outbound enforcement list [--key fdic:CERT]      orders matched to a bank in the list (or one bank's), newest first, with terminations
  outbound enforcement unmatched                  the review list: recent orders naming a party in the universe's states that match no
                                                  bank, or more than one, with suggestions. Nothing is guessed
  outbound enforcement alias --key fdic:CERT --name "ORG NAME" --by NAME   a principal resolves one: the order's name becomes the bank's alias

  County loan documents (docs/county-loans.md): public-records documents about loans, matched to banks. Context for principals only:
  never in a message, never given to a model, never scored.
  outbound loans run --source ID                  one county source's weekly read: new documents written, changed ones updated, unchanged
                                                  ones left alone, lenders matched to banks, a dated event per document newly matched.
                                                  Caldwell County, TX (tx-caldwell-notices-of-sale) reads each new notice's PDF with
                                                  pdftotext (poppler-utils); the worker runs every watched county each Monday (loans.watch)
  outbound loans verify --source ID [--sample N]  fresh, sourced, complete against the live list, every lender name accounted for (read-only)
  outbound loans status                           each watched county: the last run, documents read, new this week, matched to a bank
  outbound loans show --key fdic:CERT             the documents matched to one bank, newest first (no borrower, no address)
  outbound loans review                           lender names that matched no bank or several, with their candidates; names set aside
  outbound loans alias --key fdic:CERT --name "NAME" --by NAME   a principal resolves one: the name becomes the bank's alias, then a re-match
  outbound loans match                            match every stored document again (after an alias), without reading any county
  outbound loans events [--key fdic:CERT]         the dated events, newest first
  outbound loans unblock --source ID --by NAME    a principal clears a recorded block (a refusal or challenge page stopped the source),
                                                  after deciding the source may be read again

  Bank filers (PRD E13-S1): which SEC filer (CIK) files for each bank, usually its holding company. Only confirmed ones are searched.
  outbound filers list                            every bank in the list: confirmed, rejected or not mapped yet
  outbound filers suggest [--limit N]             propose filers for unmapped banks, from FDIC's holding-company name and SEC's entity list
  outbound filers confirm --bank fdic:CERT --cik N --by NAME     a principal confirms a bank's filer
  outbound filers reject  --bank fdic:CERT --cik N --by NAME [--reason TEXT]   a principal rejects a proposed filer
  outbound filers discovered                      bank filers the discovery search found that are not in the bank list: for review only

  Candidates (PRD E6): which banks, why now, and what paper they likely hold. A principal decides; nothing is contacted.
  outbound score run [--draft-buybox]             score every bank on distress, fit and timing (refuses while buybox.json has [CONFIRM]
                                                  placeholders; --draft-buybox runs anyway and labels the list PROVISIONAL)
  outbound candidates list [--tier A|B] [--all]   the list: tier, score by axis, metros, and the "why now" card; then failed banks
                                                  in the metros, whose loans the FDIC sells (with the FDIC loan-sale page)
  outbound candidates show --key fdic:CERT        one bank: paper profile (with the concentration ratios and their denominator),
                                                  score components with their sources, signals (state or event)
  outbound candidates promote --key K --by NAME   create the account with the pipeline's research attached; then research it
  outbound candidates dismiss --key K --by NAME --reason TEXT      it returns only if a new signal fires
  outbound candidates snooze  --key K --by NAME --until YYYY-MM-DD
  outbound paper show --key fdic:CERT [--json]    the paper estimate (PRD E14-S1): what CRE the bank likely holds, from its Call Reports,
                                                  each number with its tier and date, then the unknowns and the tape request. Written by
                                                  score run. For principals only: never in a message. --json prints the record itself

  Weekly triage (PRD E6-S5): what changed since the last triage, for the firm's principals only. It is never sent to anyone.
  outbound triage run [--since YYYY-MM-DD]       compare with the last triage: act now, watch, already in conversation (shown apart),
                                                  who was left out (snoozed, dismissed, opted out, suppressed), the calendar and source
                                                  health. Writes triage/<date>.json and .md and the snapshot triage/state.json
  outbound triage show [--date YYYY-MM-DD]       print a stored triage (default: the latest)

  Signal coverage (PRD next-five E18-S1): how many candidates each signal source can see. Stored data only: no network, no model.
  outbound coverage [--json]                      for Tier A, Tier B and all candidates, the count and share (of the group) with a
                                                  confirmed SEC filer, a rejected or unmapped one, a CMBS link (as a special servicer),
                                                  a sale-ledger event, and an enforcement order (Federal Reserve). Counts only; it names
                                                  no bank and writes nothing. --json prints the record

  Pilot (PRD E1): check the briefer on accounts you already know before it researches any account the pipeline found.
  outbound pilot template --account ID            write a "what is true" sheet to fill in (pilot/ID.truth.json)
  outbound pilot review   --account ID            list the brief's findings and the verdicts recorded so far
  outbound pilot mark     --account ID --finding F --verdict true|false|unknown --by NAME [--note TEXT]
  outbound pilot scorecard                        precision, recall, fabrications and cost across the pilot
  outbound pilot pass     --by NAME               record a pass (needs enough fully reviewed accounts and zero fabrications)

  Calls (PRD E15): a brief before the call, and the outcome after it, linked to the signals that started the account. Nothing sends.
  outbound call prep --account ID [--date YYYY-MM-DD] [--dry-run]   a one-page call brief from the account, the research, the signals
                                                  and card, the paper estimate (if any), the touch history and the approved claims;
                                                  checked in code; a failed check marks it NOT USABLE (calls/ID/DATE-prep.md)
  outbound call show --account ID [--date D]      print the latest call brief (or the one for that date)
  outbound call log --account ID --date D --by NAME --notes FILE|- [--dry-run]   save your notes (calls/ID/DATE-notes.md, principals
                                                  only), and a model proposes the outcome. Nothing is recorded until a principal confirms it.
                                                  D may not be later than today. New notes for a date supersede its pending proposals
  outbound call edit --account ID --proposal PID --by NAME [--codes C1,C2|none] [--when TEXT] [--referral TEXT]
                     [--objection TEXT ...|--objections none] [--commitment "who|what|by" ...|--commitments none] [--follow-up D|none]
                                                  correct a pending proposal before confirming it: only the fields given change, each
                                                  replaced whole, with the same checks as the model's proposal (codes from the list, real
                                                  dates, nothing before the call). People named in the notes are not edited here. The
                                                  audit names who and which fields; the confirmed outcome says a principal corrected it
  outbound call confirm --account ID --proposal PID --by NAME      record it: a guard meeting event (it stops the sequence), the
                                                  outcome on the account and in outcomes.jsonl, and a follow-up checklist. If it stops
                                                  partway, run it again: it finishes what is missing and writes nothing twice
  outbound call reject  --account ID --proposal PID --by NAME [--reason TEXT]
  outbound call list --account ID                 briefs, proposals and confirmed outcomes for an account
  outbound outcomes report [--since YYYY-MM-DD]   confirmed outcomes by signal type, tier and lead time (no model; never changes
                                                  weights), written to reports/outcomes-DATE.json. A meeting recorded by hand (guard
                                                  event --type meeting) counts as a held call with no other outcome, never twice

  A backtest of the score (PRD E17): would the score, run on the data known at the time, have ranked banks under pressure? Every
  setting is a placeholder in config.json backtest. It never changes scoring.json; a principal does, citing a holdout report.
  outbound backtest panel [--from YYYY-MM-DD] [--to YYYY-MM-DD]   the point-in-time panel (free, no key): Call Reports for every
                                                  quarter in the window plus scoring.json lookbackQuarters before it, the Summary of
                                                  Deposits for each June 30, failures and structure events, for every bank in our
                                                  states or with a branch in the metros, including banks that have since failed or
                                                  merged. Written to backtest/panel/; suspect if coverage is below minCoverage
  outbound backtest labels [--filings]            dated labels from sources the score does not read: failure, assisted merger, FDIC
                                                  loan sale. disclosed_sale is unavailable until the SEC contact (Q11) and confirmed
                                                  filers exist; --filings says why. Written to backtest/labels.json
  outbound backtest run [--scoring PATH] [--compare A B] [--holdout] [--rolling] [--horizon N] [--k N]
                                                  replay scoreBank on each as-of quarter (no model, no network) and write
                                                  backtest/report-<hash>.json and .md, by era and at each reported horizon. The
                                                  training banks by default; --holdout scores the held-out banks once (a second
                                                  scoring file on them is marked reused holdout); --rolling trains to T and tests
                                                  T+1 to T+4. Marked PROVISIONAL while the buy box has placeholders
  outbound backtest report [--hash H]             print the summary of the latest report (or of report H)
  outbound backtest verify                        the coverage check on the stored panel (no network)

  The firm's network (PRD E22-S1): the principals' own relationships. Private: the data folder only, never a model, never the repo.
  outbound network add-person --name N --known-by PRINCIPAL [--organization O] [--title T] [--relationship R]
                              [--consent yes|no|unknown] [--alias A]... --by NAME     someone a principal knows (no email or phone)
  outbound network add-firm --name N --known-by PRINCIPAL [--kind law|advisor|broker|other] [--relationship R] [--alias A]... --by NAME
  outbound network add-membership --association A --principal PRINCIPAL [--role R] [--alias A]... --by NAME
  outbound network list --by NAME [--json]       every entry, and how many chosen routes use each (the listing is audited)
  outbound network remove --id ID --by NAME      removes the entry, and every route and choice that used it, from every routes file

  Routes to the decision-maker (PRD E22): who decides, and the best way in. Code only, no model. Nothing is drafted or sent.
  outbound routes build --account ID             match the research (board, counsel, advisors, memberships, people), the sale ledger
                                                  and the network; rank by routes.json (placeholders); write routes/ID.json and .md
  outbound routes show --account ID [--json]     print the routes: the direct route's status, each warm route's bridge and evidence
  outbound routes choose --account ID --route RID --by NAME     record the choice and print its checklist: who to ask, what to
                                                  cite. A route relaxes no guard rule; it is refused after an opt-out or a suppression

  Platform (PRD E12): needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (the worker's key; never put it in the web app).
  outbound platform smoke                         check a new project with SUPABASE_URL and SUPABASE_ANON_KEY (the PUBLIC key only):
                                                  sign-ups off, every table and function present and refusing the public key
  outbound worker [--max N]                       run queued jobs until the queue is empty (or N have run); prints ids and outcomes only
  outbound enqueue sources.fdic|sources.edgar|sources.filings|sources.fdicsales|sources.enforcement|sources.mergerapps|loans.watch|score.run|triage.run|research.run|draft.run|call.prep|call.extract [--account ID] [--channel C] [--step N] [--date D] [--by NAME] [--draft-buybox] [--include-hq] [--since YYYY-MM-DD]
  outbound platform push [--from DIR]             copy a data folder into the platform (default: OUTBOUND_DATA_DIR); safe to re-run
  outbound platform pull --to DIR                 write everything back to a new or empty folder outside this repository
  outbound platform verify [fdic|edgar|filings|fdicsales|enforcement|occorders|mergerapps|sales] [--sample N]   the same checks on the platform's data (read-only); no spot-check list unless asked
`;

const REPEATABLE = new Set(['alias', 'objection', 'commitment']);   // flags that may be given more than once, collected in a list
function parse(argv) {
  const pos = []; const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { pos.push(a); continue; }
    const k = a.slice(2); const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) { flags[k] = true; continue; }
    flags[k] = REPEATABLE.has(k) ? [...(flags[k] ?? []), v] : v; i++;
  }
  return { pos, flags };
}

const loadAccount = (dir, id) => { safeId(id); const a = readJson(join(dir, 'accounts', `${id}.json`), null); if (!a) throw new Error(`No account file: ${join(dir, 'accounts', `${id}.json`)}`); return a; };
const today = () => new Date().toISOString().slice(0, 10);
const out = (x) => console.log(typeof x === 'string' ? x : JSON.stringify(x, null, 2));
// Runs the scraper checks and prints them: PASS or FAIL per check, then the records to compare by eye. Returns true when all pass.
async function runVerify(dir, which, rules, flags) {
  const sample = Number(flags.sample ?? 5);
  const reports = [];
  if (!which || which === 'fdic') reports.push(await verifyFdic({ dir, metros: rules.metros, sample }));
  if (!which || which === 'edgar') reports.push(await verifyEdgar({ dir, sec: rules.config.sec, sample }));
  if (which === 'filings') reports.push(await verifyFilings({ dir, sec: rules.config.sec, rules: loadFilingRules(), sample }));
  if (which === 'fdicsales') reports.push(await verifyFdicSales({ dir, fdic: rules.config.fdic, personalDomains: rules.config.personalDomains, sample }));
  if (which === 'occorders') reports.push(await verifyOccOrders({ dir, enforcement: rules.config.enforcement, sample }));
  if (which === 'mergerapps') reports.push(await verifyMergerApps({ dir, mergers: rules.config.mergers, sample }));
  if (which === 'fdicorders') reports.push(await verifyFdicOrders({ dir, enforcement: rules.config.enforcement, sample }));
  if (which === 'enforcement') reports.push(await verifyEnforcement({ dir, enforcement: rules.config.enforcement, hqStates: rules.metros.hqStates, sample }));
  if (which === 'sales') reports.push(verifyLedger({ dir, sample }));
  if (which === 'backtest') reports.push(verifyPanel({ dir, config: rules.config.backtest }));
  const lines = [];
  for (const r of reports) {
    lines.push(`== ${r.source.toUpperCase()}`);
    for (const c of r.checks) lines.push(`${c.ok ? (c.warn ? 'WARN' : 'PASS') : 'FAIL'}  ${c.id}: ${c.summary}`);
    if (r.sample.length) { lines.push('', `Compare by eye (${r.sample.length} records, each with the public URL to check against):`); for (const s of r.sample) lines.push(`- ${JSON.stringify(s)}`); }
    lines.push('');
  }
  console.log(lines.join('\n'));
  return reports.every((r) => r.checks.every((c) => c.ok));
}

const need = (flags, k) => { if (!flags[k] || flags[k] === true) throw new Error(`--${k} is required.`); return flags[k]; };
const opt = (flags, k) => (flags[k] && flags[k] !== true ? String(flags[k]) : undefined);
// Where a contact detail came from (PRD E7-S3), from --finding, --url, --source, --vendor and --seen.
const sourceFrom = (flags) => ({ kind: opt(flags, 'source'), findingId: opt(flags, 'finding'), url: opt(flags, 'url'), vendor: opt(flags, 'vendor'), seenOn: opt(flags, 'seen') });

async function main() {
  const { pos, flags } = parse(process.argv.slice(2));
  const [cmd, sub] = pos;
  if (!cmd || cmd === 'help' || flags.help) return out(HELP);
  const rules = loadRules();

  if (cmd === 'platform' && sub === 'smoke') {   // the first check of a real project: URL and PUBLIC key only (PRD E12-S7)
    const r = await smoke({ url: process.env.SUPABASE_URL, key: process.env.SUPABASE_ANON_KEY });
    console.log(`Key: ${r.keyKind}\n${r.checks.map((c) => `${c.ok ? 'PASS' : 'FAIL'}  ${c.id}: ${c.summary}`).join('\n')}`);
    if (!r.ok) process.exitCode = 1;
    return;
  }

  if (['worker', 'enqueue', 'platform'].includes(cmd)) {   // the platform's commands use the database, not a local data folder
    const env = process.env;
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (the service key, for the worker and operators only).');
    const client = platformClient({ url: env.SUPABASE_URL, key: env.SUPABASE_SERVICE_ROLE_KEY });
    if (cmd === 'worker') {
      const done = await work({ client, rules, max: Number(flags.max ?? 10), log: (l) => console.log(l), deps: { makeModelClient: env.ANTHROPIC_API_KEY ? makeClient : null } });
      if (done.some((d) => d.outcome === 'failed')) process.exitCode = 1;
      return out(`${done.length} job(s) run.`);
    }
    if (cmd === 'enqueue') {
      if (!JOB_KINDS.includes(sub)) throw new Error(`Usage: outbound enqueue ${JOB_KINDS.join('|')}`);
      const params = { ...(flags.account ? { account: flags.account } : {}), ...(flags.channel ? { channel: flags.channel } : {}), ...(flags.step ? { step: Number(flags.step) } : {}), ...(flags.date && flags.date !== true ? { date: needDate(flags.date) } : {}), ...(flags.by && flags.by !== true ? { by: flags.by } : {}), ...(flags['draft-buybox'] ? { draftBuybox: true } : {}), ...(flags['include-hq'] ? { includeHq: true } : {}), ...(flags.since && flags.since !== true ? { since: flags.since } : {}) };
      if (sub === 'call.extract' && (!params.account || !params.date || !params.by)) throw new Error('call.extract needs --account, --date and --by. The notes must already be saved in the platform.');
      return out(`Queued job ${await client.enqueue(sub, params)} (${sub}).`);
    }
    if (cmd === 'platform' && sub === 'push') return out(await push({ client, dir: flags.from && flags.from !== true ? flags.from : dataDir() }));
    if (cmd === 'platform' && sub === 'pull') return out(await pull({ client, to: need(flags, 'to') }));
    if (cmd === 'platform' && sub === 'verify') {   // read-only: the unit of work changes nothing, so nothing is written back
      // No spot-check list unless asked: this command runs in scheduled-job logs, which carry check results only, never bank names.
      const { result } = await client.unitOfWork(pos[2] === 'enforcement' || pos[2] === 'occorders' ? LOADS.enforcement : pos[2] === 'mergerapps' ? LOADS.mergers : LOADS.sales, (dir) => runVerify(dir, pos[2], rules, { ...flags, sample: flags.sample ?? 0 }), { retries: 0 });
      if (!result) process.exitCode = 1;
      return;
    }
    out(HELP); process.exitCode = 1; return;
  }

  const dir = dataDir();
  const ctx = () => loadContext({ dir, config: rules.config });

  if (cmd === 'init') {
    if (!exists(join(dir, 'senders.json'))) writeJson(join(dir, 'senders.json'), { _note: 'Fill every field. A sender with a [CONFIRM] placeholder blocks all sending.', senders: [{ id: 'principal-1', name: '[CONFIRM: name]', title: '[CONFIRM: title]', phone: '[CONFIRM: phone]', address: '[CONFIRM: street address]', mailbox: '[CONFIRM: mailbox]' }] });
    if (!exists(join(dir, 'suppression.json'))) writeJson(join(dir, 'suppression.json'), { entries: [] });
    if (!exists(join(dir, 'accounts', 'example-bank.json'))) writeJson(join(dir, 'accounts', 'example-bank.json'), { id: 'example-bank', name: 'Example Community Bank', aliases: [], type: 'bank', sectors: ['hospitality'], tier: 'A', person: { name: 'Jordan Sample', title: 'Chief Credit Officer', email: '', phone: '', phoneType: '', timezone: 'America/Chicago', mailingAddress: '' }, contact: { emailStatus: 'unverified', roleConfirmed: false, provenance: [], verification: null }, domains: [], notes: 'INVENTED EXAMPLE. Replace with a real account chosen by a principal. Set each contact detail with its source: outbound account set-person, set-email, add-domain, verify-email.', knownFacts: [] });
    return out(`Data folder ready: ${dir}\nNext: fill senders.json, add accounts/<id>.json for the accounts a principal chose, then: outbound status`);
  }

  if (cmd === 'status') {   // readiness is src/senders.mjs's rule, the same one the web app's Senders page shows
    const c = ctx();
    const accts = listFiles(join(dir, 'accounts'), '.json').map((f) => f.replace(/\.json$/, ''));
    const ready = sendingReadiness({ senders: c.senders, config: rules.config, kill: c.kill });
    return out({ dataDir: dir, killSwitch: ready.killSwitch, senders: c.senders.length, sendersIncomplete: ready.incomplete, accounts: accts.length,
      researched: accts.filter((a) => exists(join(dir, 'research', `${a}.json`))), touchesLogged: c.touches.filter((t) => t.type === 'touch').length, suppressionEntries: c.suppression.length,
      readyToSend: ready.ready, ...(ready.ready ? {} : { notReadyBecause: ready.reasons }) });
  }

  if (cmd === 'senders') {   // src/senders.mjs: the same rule as the web app's Senders page. Audit lines carry the sender's id only
    if (sub === 'list') {
      const list = readSenders(dir);
      const ready = sendingReadiness({ senders: list, config: rules.config, kill: ctx().kill });
      return out([
        ...(list.length ? list.map((s) => { const v = validateSender(s, { config: rules.config }); return `${String(s.id).padEnd(16)} ${String(s.name ?? '').padEnd(24)} ${v.ok ? 'complete' : `INCOMPLETE: ${v.errors.map((e) => e.message).join(' ')}`}`; }) : ['No sender yet. Add one: outbound senders set --id ID --name N --title T --phone P --address A --mailbox M --by NAME']),
        '', `Ready to send: ${ready.ready ? 'yes' : 'no'}`, ...ready.reasons.map((r) => `- ${r}`),
      ].join('\n'));
    }
    if (sub === 'set') {
      const r = setSender({ dir, sender: { id: need(flags, 'id'), ...Object.fromEntries(['name', 'title', 'phone', 'address', 'mailbox'].filter((k) => opt(flags, k) !== undefined).map((k) => [k, opt(flags, k)])) }, by: need(flags, 'by'), config: rules.config });
      return out(`${r.created ? 'Added' : 'Updated'} sender ${r.sender.id}${r.changed.length ? ` (${r.changed.join(', ')})` : ''}. Check readiness: outbound senders list`);
    }
    if (sub === 'remove') { const r = removeSender({ dir, id: need(flags, 'id'), by: need(flags, 'by') }); return out(`Removed sender ${r.id}.`); }
  }

  if (cmd === 'research' && (sub === 'run' || sub === 'show')) {
    const id = need(flags, 'account');
    if (sub === 'show') { const p = join(dir, 'briefs', `${id}.md`); return out(readText(p) ?? `No brief yet for ${id}.`); }
    const account = loadAccount(dir, id);
    if (!flags['dry-run']) { const g = researchGate({ dir, account, config: rules.config }); if (!g.allowed) throw new Error(g.reason); }
    const client = flags['dry-run'] ? null : await makeClient({ timeout: rules.models.research.timeoutMs });
    const r = await runBriefer({ client, dir, account, models: rules.models, playbooks: rules.playbooks, events: loadEvents(), dryRun: !!flags['dry-run'] });   // events.json: the forum event list (E22-S2)
    if (r.dryRun) return out(`--- SYSTEM ---\n${r.system}\n\n--- USER ---\n${r.user}\n\n--- TOOLS ---\nweb_search (max ${r.cfg.maxSearches}), web_fetch (max ${r.cfg.maxFetches}), model ${r.cfg.model}, effort ${r.cfg.effort}`);
    return out(r);
  }

  if (cmd === 'account' && sub === 'set-person') {   // a principal picks the person, usually from an institution brief's candidates
    const a = setPerson({ dir, id: need(flags, 'account'), name: need(flags, 'name'), title: flags.title, by: need(flags, 'by'), source: sourceFrom(flags) });
    return out(`Person set for ${a.name}: ${a.person.name} (source: ${sourceLabel(a.contact.provenance.find((p) => p.field === 'name'))}). Their role is unconfirmed. Read the sources in the brief, or run the briefer again for person research, then: outbound account confirm-role --account ${a.id} --by NAME`);
  }

  // Contact details (PRD E7-S3): each with its source; an address verified by checks and a principal's word; a deletion request.
  if (cmd === 'account' && sub === 'contact') {
    const a = loadAccount(dir, need(flags, 'account'));
    const st = contactStatus(a, { config: rules.config });
    const label = { name: 'Name', title: 'Title', email: 'Email', phone: 'Phone', mailingAddress: 'Mailing address' };
    const state = { none: 'none', unverified: 'UNVERIFIED', verified: 'VERIFIED', expired: 'EXPIRED: verify it again', other_address: 'UNVERIFIED: the verification on record is for another address', unsourced: 'UNSOURCED: verified, but the address has no source of its own, so the guard refuses it' }[st.email.state];
    const v = st.email.verification;
    return out([
      `${a.name} (${a.id}). Role: ${st.role.confirmed ? `confirmed by ${st.role.by}` : 'unconfirmed'}.`,
      ...FIELDS.map((f) => `  ${label[f].padEnd(16)} ${String(a.person?.[f] || '-').padEnd(32)} ${a.person?.[f] ? sourceLabel(st.fields[f]) : ''}`),
      `  Address state:   ${state}${st.email.state === 'verified' ? ` (${v.method}, by ${v.by} on ${v.verifiedOn}; verify again by ${st.email.reverifyBy})` : st.email.reason && st.email.state !== 'none' ? `. ${st.email.reason}` : ''}`,
      `Domains: ${st.domains.length ? st.domains.map((d) => `${d.domain} (${sourceLabel(d)})`).join('; ') : 'none confirmed yet (outbound account add-domain)'}`,
      ...(st.unsourced.length ? [`No source recorded for: ${st.unsourced.join(', ')}. Set each again with its source.`] : []),
      ...(st.forgotten.length ? [`A person was removed from this account on a deletion request: ${st.forgotten.map((x) => `${String(x.at).slice(0, 10)} by ${x.by}`).join('; ')}.`] : []),
    ].join('\n'));
  }
  if (cmd === 'account' && sub === 'set-email') {
    const a = setEmail({ dir, id: need(flags, 'account'), email: need(flags, 'email'), by: need(flags, 'by'), source: sourceFrom(flags), config: rules.config });
    return out(`Address set for ${a.person.name} at ${a.name}. It is UNVERIFIED until a principal verifies it: outbound account verify-email --account ${a.id} --by NAME --method ${Object.keys(ATTEST_METHODS).join('|')}`);
  }
  if (cmd === 'account' && sub === 'set-phone') {
    const a = setPhone({ dir, id: need(flags, 'account'), phone: need(flags, 'phone'), phoneType: opt(flags, 'type'), timezone: opt(flags, 'timezone'), by: need(flags, 'by'), source: sourceFrom(flags) });
    return out(`Phone set for ${a.person.name} at ${a.name} (${a.person.phoneType}${a.person.timezone ? `, ${a.person.timezone}` : ''}).${a.person.phoneType === 'landline' ? '' : ' Only business landlines are called.'}`);
  }
  if (cmd === 'account' && sub === 'set-address') {
    const a = setAddress({ dir, id: need(flags, 'account'), address: need(flags, 'address'), by: need(flags, 'by'), source: sourceFrom(flags) });
    return out(`Mailing address set for ${a.person.name} at ${a.name}.`);
  }
  if (cmd === 'account' && sub === 'add-domain') {
    const r = addDomain({ dir, id: need(flags, 'account'), domain: need(flags, 'domain'), by: need(flags, 'by'), source: sourceFrom(flags), config: rules.config });
    return out(`Domain confirmed for ${r.account.name}: ${r.account.domains.at(-1).domain}.${r.sharedWith.length ? `\nSHARED: ${r.sharedWith.join(', ')} already hold this domain. A reply from it cannot say which institution it came from; a principal reviews it (PRD E9-S3).` : ''}`);
  }
  if (cmd === 'account' && sub === 'verify-email') {
    const r = await verifyEmail({ dir, id: need(flags, 'account'), by: need(flags, 'by'), method: opt(flags, 'method'), url: opt(flags, 'url'), vendor: opt(flags, 'vendor'), seen: opt(flags, 'seen'), config: rules.config });
    const lines = r.checks.map((c) => `${c.ok ? (c.skipped ? 'SKIP' : 'PASS') : 'FAIL'}  ${c.id}: ${c.message}`).join('\n');
    if (!r.ok) { process.exitCode = 1; return out(`NOT VERIFIED. The address stays unverified, and the guard refuses any email to it.\n${lines}`); }
    return out(`VERIFIED for ${r.account.person.name} at ${r.account.name}, by ${r.account.contact.verification.by} (${r.account.contact.verification.method}). It lasts ${rules.config.contacts?.reverifyDays} days.\n${lines}`);
  }
  if (cmd === 'account' && sub === 'forget-person') {   // a deletion request (PRD E7-S3); the output names no one
    const r = await forgetInFolder({ dir, id: need(flags, 'account'), by: need(flags, 'by'), reason: need(flags, 'reason'), confirm: opt(flags, 'confirm'), name: opt(flags, 'name'), email: opt(flags, 'email'), rules });
    return out(`Removed from account ${r.accountId} and every record that held them. A hashed suppression entry keeps them from being contacted or named again.\nFiles or lines changed, by store: ${Object.entries(r.counts).map(([k, n]) => `${k} ${n}`).join(', ')}.\nCopies outside the data folder (a vendor export you saved, your mailbox, notes on paper) are yours to remove.`);
  }

  if (cmd === 'account' && sub === 'confirm-order') {   // next-five D-E3: once per order in force, before any touch is approved
    const r = confirmOrder({ dir, id: need(flags, 'account'), order: need(flags, 'order'), by: need(flags, 'by') });
    return out(r.already ? `${r.order.id} was already confirmed for ${r.account.name}. Nothing changed.` : `Confirmed: ${need(flags, 'by')} has seen ${r.order.type} from the ${r.order.regulator}, ${r.order.date} [${r.order.id}], against ${r.account.name}. Touches to it can now be approved. Never mention the order in a message.`);
  }

  if (cmd === 'account' && sub === 'confirm-role') {
    const by = need(flags, 'by');
    const a = confirmRole({ dir, id: need(flags, 'account'), by });
    return out(`Role confirmed for ${a.person?.name} at ${a.name} by ${by}.`);
  }

  if (cmd === 'draft') {
    const id = need(flags, 'account'); const channel = need(flags, 'channel');
    const account = loadAccount(dir, id);
    const c = ctx();
    const sentCount = c.touches.filter((t) => t.accountId === id && t.type === 'touch').length;
    const step = Number(flags.step ?? sentCount + 1);
    if (sub === 'show') { const p = join(dir, 'drafts', id, `${step}-${channel}.md`); return out(readText(p) ?? 'No such draft.'); }
    if (sub === 'approve') { const r = approveDraft({ dir, account, channel, step, by: need(flags, 'by'), ctx: c, rules }); return out(r.ok ? `Approved. A person may now send it.\n\n${r.text}` : { refused: r.errors }); }
    if (sub === 'run') {
      const client = flags['dry-run'] ? null : await makeClient();
      const r = await runDrafter({ client, dir, account, channel, step, senderId: flags.sender ?? c.senders[0]?.id, date: flags.date ?? today(), ctx: c, rules, ackRisk: !!flags['ack-risk'], dryRun: !!flags['dry-run'] });
      if (r.dryRun) return out(`--- SYSTEM ---\n${r.system}\n\n--- USER ---\n${r.user}\n(cleared facts available: ${r.facts})`);
      return out(r);
    }
  }

  if (cmd === 'mailbox') {   // PRD E9: Gmail drafts, noticed sends, replies. Principal's own mailbox; drafts only
    if (sub === 'review') return out(readReview(dir));
    const c = ctx();
    const gmail = gmailClient();
    if (sub === 'draft') return out(await createGmailDraft({ dir, account: loadAccount(dir, need(flags, 'account')), step: Number(need(flags, 'step')), ctx: c, client: gmail, by: need(flags, 'by') }));
    if (sub === 'sync') {
      const accts = listFiles(join(dir, 'accounts'), '.json').map((f) => readJson(join(dir, 'accounts', f)));
      const sends = await syncSends({ dir, accounts: accts, ctx: c, client: gmail, rules });
      const modelClient = flags.sort ? await makeClient() : null;
      const inbox = await syncInbox({ dir, accounts: accts, ctx: c, client: gmail, config: rules.config, models: rules.models, modelClient, windowDays: Number(flags.days ?? 14) });
      return out({ sends, inbox });
    }
    throw new Error('Usage: outbound mailbox draft|sync|review (outbound help)');
  }
  if (cmd === 'guard') {
    const c = ctx();
    if (sub === 'due') {
      const accts = listFiles(join(dir, 'accounts'), '.json').map((f) => readJson(join(dir, 'accounts', f)));
      return out(dueList(accts, c, { date: flags.date ?? today(), sender: flags.sender ?? c.senders[0]?.id }));
    }
    if (sub === 'event') { return out(recordEvent(dir, { accountId: need(flags, 'account'), institution: loadAccount(dir, flags.account).name, type: need(flags, 'type'), date: flags.date, note: flags.note === true ? undefined : flags.note, person: loadAccount(dir, flags.account).person, by: opt(flags, 'by') }, c)); }
    const account = loadAccount(dir, need(flags, 'account'));
    const sentCount = c.touches.filter((t) => t.accountId === account.id && t.type === 'touch').length;
    const t = touchFromAccount(account, { channel: need(flags, 'channel'), step: Number(flags.step ?? sentCount + 1), date: flags.date ?? today(), sender: flags.sender ?? c.senders[0]?.id });
    if (sub === 'check') return out(checkTouch(t, c));
    if (sub === 'record') {   // the send already happened, so it is always logged; a rule it broke is shown, not used to drop the record
      const r = recordObservedSend(dir, t, c, { by: opt(flags, 'by') });
      return out(r.violations.length ? `RECORDED, but this send broke ${r.violations.length} rule(s). Review before the next touch:\n${r.violations.map((e) => `- ${e.code}: ${e.message}`).join('\n')}` : r.rec);
    }
  }

  if (cmd === 'sources') {
    if (sub === 'run' && pos[2] === 'filings') {   // the SEC filings listener (PRD E13-S1)
      const r = await runFilings({ dir, sec: rules.config.sec, rules: loadFilingRules(), since: flags.since });
      if (r.outcome === 'failed') process.exitCode = 1;
      return out(r);
    }
    if (sub === 'run' && pos[2] === 'occorders') {   // OCC orders (PRD next-five E18-S2, source 4)
      const r = await runOccOrders({ dir, enforcement: rules.config.enforcement });
      if (r.outcome === 'failed') process.exitCode = 1;
      return out(r);
    }
    if (sub === 'run' && pos[2] === 'mergerapps') {   // merger applications (PRD next-five E18-S3)
      const r = await runMergerApps({ dir, mergers: rules.config.mergers });
      if (r.outcome === 'failed') process.exitCode = 1;
      return out(r);
    }
    if (sub === 'run' && pos[2] === 'fdicorders') {   // FDIC orders (PRD next-five E18-S2), on a principal's machine with Playwright
      const r = await runFdicOrders({ dir, enforcement: rules.config.enforcement, since: opt(flags, 'since') ?? null, debugCapture: opt(flags, 'debug-capture') ?? null });
      if (r.outcome === 'failed') process.exitCode = 1;
      return out(r);
    }
    if (sub === 'run' && pos[2] === 'enforcement') {   // enforcement orders (PRD next-five E18-S2)
      const r = await runEnforcement({ dir, enforcement: rules.config.enforcement });
      if (r.outcome === 'failed') process.exitCode = 1;
      return out(r);
    }
    if (sub === 'run') {
      if (!['fdic', 'edgar', 'fdicsales'].includes(pos[2])) throw new Error('Usage: outbound sources run fdic [--include-hq] | outbound sources run edgar | outbound sources run fdicsales | outbound sources run enforcement | outbound sources run fdicorders | outbound sources run mergerapps | outbound sources run occorders | outbound sources run filings [--since YYYY-MM-DD]');
      const r = pos[2] === 'fdic' ? await runFdic({ dir, metros: rules.metros, includeHq: !!flags['include-hq'] })
        : pos[2] === 'fdicsales' ? await runFdicSales({ dir, fdic: rules.config.fdic, personalDomains: rules.config.personalDomains })
        : await runEdgar({ dir, metros: rules.metros, buybox: rules.buybox, scoring: rules.scoring, sec: rules.config.sec });
      // The CMBS and FDIC loan-sale runs end by rebuilding the sale ledger (PRD E16), so a liquidation reported this month is kept.
      if (pos[2] !== 'fdic' && r.outcome !== 'failed') r.ledger = buildLedger({ dir, config: rules.config });
      if (r.ledger && r.ledger.outcome !== 'failed') r.intermediaries = writeRegistry({ dir, config: rules.config });   // next-five E19-S1
      if (r.outcome === 'failed' || r.ledger?.outcome === 'failed') process.exitCode = 1;
      return out(r);
    }
    if (sub === 'verify') { if (!(await runVerify(dir, pos[2], rules, flags))) process.exitCode = 1; return; }
    if (sub === 'status') {
      const last = {};
      for (const r of readJsonl(join(dir, 'sources', 'runs.jsonl'))) last[r.source] = r;
      return out({ lastRuns: last, fdic: readJson(join(dir, 'sources', 'fdic', 'state.json'), null) });
    }
  }

  if (cmd === 'sales') {   // the who-sells-to-whom ledger (PRD E16); built from stored data only, so nothing here fetches
    if (sub === 'build') { const r = buildLedger({ dir, config: rules.config }); if (r.outcome === 'failed') process.exitCode = 1; else r.intermediaries = writeRegistry({ dir, config: rules.config }); return out(r); }
    if (sub === 'verify') { if (!(await runVerify(dir, 'sales', rules, flags))) process.exitCode = 1; return; }
    const ledger = readLedger(dir);
    const label = new Map(rules.metros.metros.map((m) => [m.cbsa, m.label]));
    const where = (a) => (a?.metros?.length ? a.metros : a?.metro ? [a.metro] : []).map((c) => label.get(c) ?? c).join(', ') || a?.county || '';
    const party = (p) => (p ? `${p.name}${p.key ? ` (${p.key})` : ''}` : '');
    const money = (v) => (v === null || v === undefined ? '–' : `$${Math.round(v).toLocaleString('en-US')}`);
    const pctOf = (r) => (r?.value === null || r?.value === undefined ? `– (${r?.reason ?? 'n/a'})` : `${(r.value * 100).toFixed(1)}% (approximate)`);
    if (!ledger.builtAt) return out('No ledger yet. Run: outbound sales build');
    const head = `Ledger built ${ledger.builtAt} (run ${ledger.runId}). Context for a principal only: never in a message.`;
    if (sub === 'list') {
      const rows = listSales(ledger, { seller: flags.seller === true ? undefined : flags.seller, kind: flags.kind === true ? undefined : flags.kind });
      return out(`${head} ${rows.length} event(s).\n\n${rows.map((e) => `${e.date}  ${e.kind.padEnd(22)} ${e.id}\n    seller: ${party(e.seller)}${e.seller.via ? `, through ${party(e.seller.via)}` : ''}\n    buyer:  ${party(e.buyer)}\n    asset:  ${e.asset.kind}${e.asset.propertyType ? `, ${e.asset.propertyType}` : ''}${where(e.asset) ? `, ${where(e.asset)}` : ''}, balance ${money(e.asset.balance)}${e.priceEvidence ? `\n    implied recovery: ${pctOf(e.priceEvidence.impliedRecovery)}` : ''}${e.note ? `\n    note: ${e.note}` : ''}\n    source: ${e.sources.map((s) => s.link ?? `${s.source} ${s.ids.join(' ')}`).join(' · ')}`).join('\n\n')}`);
    }
    if (sub === 'sellers') {
      const g = groupBySeller(ledger);
      return out(`${head}\nWho has sold before: ${g.length} seller(s).\n\n${g.map((s) => `${s.latest}  ${party(s)} [${s.kind}]: ${s.total} event(s): ${Object.entries(s.counts).map(([k, n]) => `${k} ${n}`).join(', ')}`).join('\n')}`);
    }
    if (sub === 'buyers') {
      const g = groupBuyers(ledger);
      const kv = (o) => Object.entries(o).map(([k, n]) => `${label.get(k) ?? k} ${n}`).join(', ');
      return out(`${head}\nKnown buyers: ${g.length}. Every other event's buyer is unknown.\n\n${g.map((b) => `${party(b)} [${b.kind}]: ${b.total} event(s), latest ${b.latest}\n    by kind: ${kv(b.byKind)}\n    by property type: ${kv(b.byPropertyType)}\n    by metro: ${kv(b.byMetro)}\n    by quarter: ${kv(b.byPeriod)}`).join('\n')}`);
    }
    if (sub === 'pricing') {
      const pr = pricing(ledger);
      return out(`${head}\n${pr.label}\n\n${pr.groups.map((g) => `${g.propertyType} · ${label.get(g.metro) ?? g.metro ?? 'metro not stated'}: ${g.events} liquidation(s), ${g.withRecovery} with balance and loss; implied recovery ${pctOf(g.impliedRecovery)}${g.withRecovery > 1 ? `, range ${(g.min * 100).toFixed(1)}–${(g.max * 100).toFixed(1)}%` : ''}`).join('\n')}${pr.rows.length ? `\n\n${pr.rows.map((r) => `${r.date}  ${r.kind.padEnd(20)} ${r.propertyType} · ${label.get(r.metro) ?? r.metro ?? ''}  balance ${money(r.balance)}  loss ${money(r.loss)}  ${pctOf(r.impliedRecovery)}  (${r.seller ?? ''}; ${r.id})`).join('\n')}` : '\nNo CMBS liquidation recorded yet.'}`);
    }
  }

  if (cmd === 'market') {   // next-five E20: aggregates only; publishing waits for counsel (Q25)
    const M = await import('./src/market.mjs');
    if (sub === 'pack') { const r = M.writePack({ dir, quarter: need(flags, 'quarter'), metros: rules.metros, buybox: rules.buybox, config: rules.config }); return out(`Market pack for ${r.pack.quarter}: ${r.counts.fdicSuppressed} of ${r.counts.fdicCells} bank figures suppressed by the disclosure guard.\nWritten: ${r.paths.md}`); }
    if (sub === 'show') { const p = flags.quarter ? readJson(M.marketPaths(dir).pack(flags.quarter, 'json'), null) : M.latestPack(dir); if (!p) throw new Error('No market pack yet. Run: outbound market pack --quarter YYYY-MM-DD'); return out(M.renderPack(p)); }
    throw new Error('Usage: outbound market pack --quarter YYYY-MM-DD | outbound market show [--quarter YYYY-MM-DD]');
  }

  if (cmd === 'intermediaries') {   // next-five E19: firms that act for sellers. For the principals; never in a message
    const I = await import('./src/intermediaries.mjs');
    const ic = rules.config.intermediaries ?? {};
    const today = new Date().toISOString().slice(0, 10);
    const reg = () => I.readRegistry(dir) ?? (I.writeRegistry({ dir, config: rules.config }), I.readRegistry(dir));
    const regState = (k) => I.readRegistrations(dir).firms?.[k]?.state ?? null;
    const usd = (v) => `$${Math.round(v).toLocaleString('en-US')}`;
    if (sub === 'build') return out(I.writeRegistry({ dir, config: rules.config }));
    if (sub === 'promote') { const a = I.promoteIntermediary({ dir, key: need(flags, 'key'), by: need(flags, 'by') }); return out(`Account ${a.id} created for ${a.name} (research playbook: ${a.type}, audience: intermediary). Name the person, then research. Nothing is drafted until claims.json holds approved claims for the intermediary audience.`); }
    if (sub === 'list') {
      const rows = I.rankFirms({ registry: reg(), config: rules.config, buybox: rules.buybox, asOf: today }).filter((r) => !flags.kind || r.kinds.includes(flags.kind));
      const line = (r, i) => `${String(i + 1).padStart(3)}. ${r.name}  [${r.key}]  score ${r.score}  ${r.kinds.map((k) => I.KINDS[k]).join(', ')}\n     ${r.mandates} mandate(s), latest ${r.latest ?? '-'}${r.referrals ? `, ${r.referrals} referral(s) (not ranked)` : ''}${regState(r.key) ? `; buyer list: ${regState(r.key)}` : ''}`;
      return out(`${rows.length} firm(s)${flags.kind ? ` of kind ${flags.kind}` : ''}, ranked (weights are placeholders, D-I3).\n\n${rows.map(line).join('\n')}`);
    }
    if (sub === 'show') {
      const key = need(flags, 'key'); const R = reg();
      const row = I.rankFirms({ registry: R, config: rules.config, buybox: rules.buybox, asOf: today }).find((r) => r.key === key);
      if (!row) throw new Error(`${key} is not in the registry.`);
      const ms = R.firms[key].mandates.map((id) => R.mandates[id]);
      const comp = row.components.map((c) => `  ${c.id}: ${c.value} -> ${c.points} of ${c.weight}${c.note ? ` (${c.note})` : ''}`).join('\n');
      const mand = ms.map((m) => `  ${m.date ?? '-'}  ${m.kind}  for ${m.seller?.name ?? 'unknown'}${m.sellerDescription ? ` (${m.sellerDescription})` : ''}${m.metro ? `  metro ${m.metro}` : ''}${m.balance ? `  ${usd(m.balance)}` : ''}  [${m.id}, ${m.feeder}]${m.how ? `\n      how: ${m.how} (${m.by})` : ''}`).join('\n');
      const refs = R.firms[key].referrals.length ? `\n\nReferrals (not ranked):\n${R.firms[key].referrals.map((x) => `  ${x.date}  for ${x.seller?.name}  (${x.by})`).join('\n')}` : '';
      return out(`${row.name} [${key}]: ${row.kinds.map((k) => I.KINDS[k]).join(', ')}. Score ${row.score}.\n${comp}\nBuyer list: ${regState(key) ?? 'not_started'}\n\nMandates:\n${mand}${refs}`);
    }
    if (sub === 'mandate') { const r = I.addMandate({ dir, firmName: flags.firm, kind: flags.kind, seller: flags.seller, date: flags.date, how: flags.how, by: flags.by }); I.writeRegistry({ dir, config: rules.config }); return out(r.already ? `Already recorded (${r.id}).` : `Mandate recorded (${r.id}); the registry is rebuilt.`); }
    if (sub === 'referral') { const r = I.addReferral({ dir, firmName: flags.firm, seller: flags.seller, date: flags.date, by: flags.by }); I.writeRegistry({ dir, config: rules.config }); return out(r.already ? 'Already recorded.' : `Referral recorded for ${r.firmName}. It is shown on the firm, and never counts toward the ranking.`); }
    if (sub === 'direct') { const r = I.addDirectSale({ dir, seller: flags.seller, date: flags.date, how: flags.how, by: flags.by }); return out(r.already ? 'Already recorded.' : `Recorded: ${r.seller.name} sold without an advisor on ${r.date}.`); }
    if (sub === 'alias') { const r = I.addFirmAlias({ dir, key: flags.key, alias: flags.alias, by: flags.by }); I.writeRegistry({ dir, config: rules.config }); return out(`"${r.alias}" now means ${r.key}; the registry is rebuilt.`); }
    if (sub === 'credibility-approved') { const r = I.approveCredibilityPackage({ dir, by: flags.by }); return out(`Recorded: the credibility package is approved by ${r.approvedBy}. Proof of funds may now be sent to an advisor.`); }
    if (sub === 'register') { const r = I.setRegistration({ dir, key: flags.key, state: flags.state, by: flags.by, recertifyBy: flags['recertify-by'] ?? null }); return out(`${r.name}: ${r.state}${r.recertifyBy ? `, re-certify by ${r.recertifyBy}` : ''}. Only the state is kept; the agreement itself is not stored here.`); }
    if (sub === 'nda') { const e = I.ndaUnder({ dir, key: flags.key, type: flags.type, value: flags.value, by: flags.by }); return out(`On the NDA list: ${e.type} (${e.reason}). The guard now blocks touches about it.`); }
    if (sub === 'route') {
      const r = I.routeForDir(dir, need(flags, 'seller'));
      const adv = r.advisors.map((a) => `\n  advisor ${a.name} [${a.key}], last ${a.last}; buyer list: ${a.registration}${a.notRegistered ? ' (NOT registered)' : ''}`).join('');
      const dir2 = r.direct.map((d) => `\n  direct sale ${d.date}: ${d.how} (${d.by})`).join('');
      return out(`${flags.seller}: ${r.label}.${adv}${dir2}`);
    }
    if (sub === 'reminders') {
      const r = I.registrationReminders({ registrations: I.readRegistrations(dir), asOf: today, withinDays: ic.reminderDays ?? 30 });
      return out(r.length ? r.map((x) => `${x.recertifyBy}  ${x.name} [${x.key}]${x.overdue ? '  OVERDUE' : ''}`).join('\n') : 'No buyer-list re-certification due.');
    }
    throw new Error('Usage: outbound intermediaries build|list|show|mandate|referral|direct|promote|alias|register|credibility-approved|nda|route|reminders (outbound help)');
  }

  if (cmd === 'mergers' && sub === 'gap') {   // next-five Q5 (decided 2026-11-16): accept the gap, and count it
    const { mergerGap } = await import('./src/sources/mergerapps.mjs');
    const g = mergerGap({ dir, leadDays: rules.config.mergers?.gapLeadDays ?? 180 });
    if (!g.ran) return out(g.note);
    return out(`Mergers that closed from ${g.since} (the first H.2 week read, ${g.firstWeek}, plus ${g.leadDays} days): ${g.closes}.\n- Seen first as an H.2 application: ${g.seenAsApplication}.\n- Seen only at their close: ${g.notSeen}${g.share === null ? '' : ` (${(g.share * 100).toFixed(1)}%)`}. These are the FDIC- or OCC-only mergers the H.2 cannot show.\n${g.rows.map((r) => `  ${r.effective}  ${r.kind}  target fdic:${r.targetCert ?? '?'}  acquirer fdic:${r.acquirerCert ?? '?'}  [fdic-event:${r.transnum}]`).join('\n')}\nIf the share is large, a principal decides whether to build the OCC applications reader (PRD next-five E18-S3, Q5).`);
  }

  if (cmd === 'mergers' && sub === 'list') {   // merger applications (PRD next-five E18-S3): for the principals; never in a message
    const { mergerSignals } = await import('./src/sources/mergerapps.mjs');
    const apps = Object.values(readJson(mergerPaths(dir).applications, {}));
    const sig = mergerSignals({ dir });
    const named = new Map(); for (const [k, l] of Object.entries(sig)) for (const x of l) named.set(x.evidence[0], [...(named.get(x.evidence[0]) ?? []), `${k} (${x.role})`]);
    const show = apps.filter((a) => flags.all || named.has(a.key)).sort((a, b) => (a.filedWeek < b.filedWeek ? 1 : -1));
    const line = (a) => `${a.filedWeek}  ${MERGER_KINDS[a.kind] ?? a.kind}  [${a.key}]${a.approvedOn ? `  approved ${a.approvedOn}` : ''}${a.withdrawnOn ? `  withdrawn ${a.withdrawnOn}` : ''}${a.deniedOn ? `  denied ${a.deniedOn}` : ''}${a.closedBy ? `  closed ${a.closedOn} (${a.closedBy})` : ''}\n    ${a.parties.map((p) => `${p.role}: ${p.name}${p.city ? `, ${p.city}` : ''}${p.state ? `, ${p.state}` : ''}`).join('; ')}${named.has(a.key) ? `\n    in the list: ${named.get(a.key).join(', ')}` : ''}\n    ${a.link}`;
    return out(`${show.length} application(s)${flags.all ? ' stored' : ' open and naming a bank in the list'}.\n\n${show.map(line).join('\n\n')}`);
  }

  if (cmd === 'enforcement') {   // enforcement orders (PRD next-five E18-S2): for the principals; never in a message
    const line = (o) => `${o.date}  ${o.kind === 'termination' ? `termination of ${o.terminates ?? 'an earlier order not stored'} (${ORDER_TYPES[o.terminatesType] ?? ORDER_TYPES.other})` : `${ORDER_TYPES[o.type] ?? o.type}${o.terminatedOn ? `, terminated ${o.terminatedOn}` : ', no termination recorded'}`}  [${o.key}]${o.flags?.found?.length ? `  phrases: ${o.flags.found.join(', ')}` : ''}\n    ${o.link ?? '(no document link)'}`;
    if (sub === 'list') {
      if (flags.key) { const key = need(flags, 'key'); const l = ordersFor({ dir, key }); return out(`${key}: ${l.length} order record(s).\n\n${l.map(line).join('\n')}`); }
      const latest = readJson(join(dir, 'candidates', 'latest.json'), null);
      const by = ordersByBank({ dir });
      const rows = (latest?.items ?? []).map((i) => [i.key, by.get(i.key) ?? []]).filter(([, l]) => l.length);
      return out(`${rows.length} bank(s) in the latest candidate list with an enforcement order on record.\n\n${rows.map(([k, l]) => `${k}  ${latest.items.find((i) => i.key === k)?.name ?? ''}\n${l.map((o) => `  ${line(o).replace(/\n/g, '\n  ')}`).join('\n')}`).join('\n\n')}`);
    }
    if (sub === 'unmatched') {
      const l = unmatchedOrders({ dir, enforcement: rules.config.enforcement, hqStates: rules.metros.hqStates });
      const party = (p) => `  ${p.name}${p.city ? `, ${p.city}` : ''}${p.state ? `, ${p.state}` : ''}: ${p.how === 'ambiguous' ? `more than one bank has this name: ${p.candidates.join(', ')}` : p.suggestions.length ? `similar: ${p.suggestions.map((x) => `${x.key} ${x.name} (${x.similarity})`).join('; ')}` : 'no bank in the list has this name'}`;
      return out(`${l.length} order(s) on the review list. Each matches no bank, or more than one, and names a party in the metros' states or one like a bank in the list. If the party is a bank in the list (or its holding company), add its alias:\n  outbound enforcement alias --key fdic:CERT --name "NAME AS THE ORDER GIVES IT" --by NAME\n\n${l.map((o) => `${o.date}  ${ORDER_TYPES[o.type] ?? o.type}${o.terminatedOn ? `, terminated ${o.terminatedOn}` : ''}  [${o.key}]  ${o.link ?? '(no document link)'}\n${o.parties.map(party).join('\n')}`).join('\n\n')}`);
    }
    if (sub === 'alias') {
      const r = aliasParty({ dir, key: need(flags, 'key'), name: need(flags, 'name'), by: need(flags, 'by') });
      return out(`${r.key} (${r.bank ?? ''}) now also matches: ${r.aliases.join('; ')}. The next score run shows its orders: outbound score run`);
    }
  }

  if (cmd === 'loans') {   // county loan documents (docs/county-loans.md): for the principals; never in a message
    const counties = rules.config.counties;
    const money = (a) => (a?.value === null || a?.value === undefined ? AMOUNT_BASES[a?.basis] ?? 'not read yet' : `$${Number(a.value).toLocaleString('en-US')} (${AMOUNT_BASES[a.basis]})`);
    if (sub === 'run') {   // an invented example source is refused here: it runs only against its fake, in the tests
      const r = await runNoticeSource({ dir, source: countySource(need(flags, 'source')), counties });
      if (r.outcome === 'failed') process.exitCode = 1;
      return out(r);
    }
    if (sub === 'verify') {
      const r = await verifyNoticeSource({ dir, source: countySource(need(flags, 'source')), counties, sample: Number(flags.sample ?? 5) });
      const lines = [`== ${r.source.toUpperCase()}`, ...r.checks.map((c) => `${c.ok ? 'PASS' : 'FAIL'}  ${c.id}: ${c.summary}`)];
      if (r.sample.length) lines.push('', `Compare by eye (${r.sample.length} documents, each with the public URL to check against):`, ...r.sample.map((x) => `- ${JSON.stringify(x)}`));
      console.log(lines.join('\n'));
      if (!r.checks.every((c) => c.ok)) process.exitCode = 1;
      return;
    }
    if (sub === 'status') {
      const rows = countyCoverage({ config: counties, state: readLoanState(dir) });
      if (!rows.length) return out('No county is watched yet. A county is watched once its source is built and a principal lists it in config.counties.watch.');
      const last = (r) => (r.lastRun ? `${r.lastRun.ranAt.slice(0, 10)}, ${r.lastRun.outcome}${r.lastRun.error ? `: ${r.lastRun.error}` : ''}` : 'never');
      return out(rows.map((r) => `${r.countyLabel}  [${r.id}]${r.configured ? '' : '  (not in config.counties.watch)'}\n  last run: ${last(r)}\n  documents read: ${r.read ?? '-'}; new this week: ${r.newThisWeek ?? '-'}; changed this week: ${r.changedThisWeek ?? '-'}\n  stored: ${r.stored ?? '-'}; matched to a bank: ${r.matchedDocuments ?? '-'}; names on the review list: ${r.reviewNames ?? '-'}`).join('\n\n'));
    }
    if (sub === 'show') {
      const key = need(flags, 'key');
      const b = readBankLoans({ dir, key });
      if (!b?.loans?.length) return out(`${key}: no document in a watched county names this bank as lender, beneficiary or holder.`);
      const row = (l) => `${l.date}  ${DOC_TYPES[l.documentType].label} (${l.dateKind}), ${l.county.name} County, ${l.state}: ${STAGES[l.stage]}${l.saleDate ? `, sale ${l.saleDate}` : ''}\n    as ${l.roles.join(' and ')} (${l.how}); property type: ${PROPERTY_TYPES[l.propertyType] ?? 'not known yet'}\n    original principal: ${money(l.amounts.originalPrincipal)}; unpaid balance: ${money(l.amounts.unpaidBalance)}\n    ${l.link}`;
      return out(`${key}: ${b.loans.length} document(s). ${b.note}\n\n${b.loans.map(row).join('\n')}`);
    }
    if (sub === 'review') {
      const r = readJson(loansPaths(dir).review, { entries: [], setAside: [] });
      const cand = (c) => `${c.key} ${c.name ?? ''}, ${c.city ?? ''}, ${c.state ?? ''}${c.inDocumentState ? ' (the document\'s state)' : ''}`;
      const entry = (e) => `${e.name}  (${e.status}; ${e.roles.join(', ')}; ${e.count} time(s) in ${e.counties.join(', ')})${e.candidates.length ? `\n  candidates: ${e.candidates.map(cand).join('; ')}` : ''}${e.suggestions.length ? `\n  similar: ${e.suggestions.map((x) => `${x.key} ${x.name} (${x.similarity})`).join('; ')}` : ''}`;
      return out(`${r.entries.length} name(s) to review: each matched no bank in the list, or more than one. Nothing is guessed. If one is a bank in the list (or its holding company), add its alias:\n  outbound loans alias --key fdic:CERT --name "NAME AS THE DOCUMENT GIVES IT" --by NAME\n\n${r.entries.map(entry).join('\n')}\n\nSet aside, never matched to a bank (${r.setAside.length}):\n${r.setAside.map((x) => `  ${x.name}: ${x.why} (${x.count})`).join('\n')}`);
    }
    if (sub === 'alias') {
      const r = aliasParty({ dir, key: need(flags, 'key'), name: need(flags, 'name'), by: need(flags, 'by') });
      const idx = buildLoanIndex({ dir });
      return out(`${r.key} (${r.bank ?? ''}) now also matches: ${r.aliases.join('; ')}. Matched again: ${idx.matchedDocuments} document(s) name a bank in the list; ${idx.eventsNew} new event(s).`);
    }
    if (sub === 'match') return out(buildLoanIndex({ dir }));
    if (sub === 'unblock') {
      const r = clearBlock({ dir, sourceId: countySource(need(flags, 'source')).id, by: need(flags, 'by') });
      return out(r.cleared ? `${r.sourceId}: the block of ${String(r.blockedAt).slice(0, 10)} is cleared. The next run reads the source again.` : `${r.sourceId}: no block is recorded.`);
    }
    if (sub === 'events') return out(loanEvents({ dir, key: flags.key && flags.key !== true ? flags.key : null }).map((e) => `${e.date}  ${e.key}  ${e.label}`).join('\n') || 'No events yet.');
  }

  if (cmd === 'filers') {   // the bank-to-filer map for the SEC filings listener (PRD E13-S1); a principal decides every mapping
    const fr = loadFilingRules();
    if (sub === 'list') {
      const s = filerStatus({ dir });
      const row = (r) => `${r.status.padEnd(9)}  ${r.bank.padEnd(11)} ${r.name ?? ''}${r.ciks.length ? `\n${r.ciks.map((c) => `             ${c.status === 'confirmed' ? '->' : 'x '} CIK ${c.cik} ${c.filer ?? ''} (${c.status} by ${c.by}, ${String(c.at).slice(0, 10)})`).join('\n')}` : ''}`;
      return out(`${s.banks} banks in the list: ${s.confirmed} with a confirmed filer, ${s.rejectedOnly} with only rejected ones, ${s.unmapped} not mapped. ${s.filers} filer(s) are searched.${s.mappedOutsideList.length ? `\n${s.mappedOutsideList.length} bank(s) no longer in the list still have a confirmed filer, and are still searched: ${s.mappedOutsideList.join(', ')}.` : ''}\n\n${s.rows.map(row).join('\n')}`);
    }
    if (sub === 'suggest') {
      const r = await suggestFilers({ dir, sec: rules.config.sec, rules: fr, limit: flags.limit && flags.limit !== true ? Number(flags.limit) : Infinity });
      if (r.outcome === 'failed') { process.exitCode = 1; return out(r); }
      const cand = (c, i) => `  ${i + 1}. CIK ${c.cik}  ${c.entity ?? c.name ?? ''}: ${c.basis}; ${c.sics.length ? `SIC ${c.sics.join(', ')} (${c.bankSic ? 'a bank code' : 'NOT a bank code'})` : 'no 10-K or 10-Q in the last year'}${c.states.length ? `; ${c.states.join(', ')}` : ''}${c.lastFiling ? `; last ${c.lastFiling.form} filed ${c.lastFiling.fileDate}` : ''}`;
      const bank = (b) => [`${b.bank}  ${b.name ?? ''}`, `  ${b.holdingCompany ? `holding company: ${b.holdingCompany}${b.rssdHcr ? ` (RSSD ${b.rssdHcr}${b.holdingCompanyPlace ? `, ${b.holdingCompanyPlace}` : ''})` : ''}` : 'no holding company on its FDIC record'}; looked up as "${b.query}"`,
        ...(b.candidates.length ? [...b.candidates.map(cand), `  confirm: outbound filers confirm --bank ${b.bank} --cik ${b.candidates[0].cik} --by NAME   (or reject: outbound filers reject --bank ${b.bank} --cik N --by NAME)`] : ['  no SEC filer found. Most banks whose holding company is private have none.'])].join('\n');
      return out(`Suggestions for ${r.unmapped} unmapped bank(s), from ${r.lookups} name lookup(s): ${r.candidates} candidate(s). Nothing is searched until a principal confirms it.\n\n${Object.values(r.banks).map(bank).join('\n\n')}`);
    }
    if (sub === 'confirm' || sub === 'reject') {
      const args = { dir, bank: need(flags, 'bank'), cik: need(flags, 'cik'), by: need(flags, 'by') };
      const r = sub === 'confirm' ? confirmFiler(args) : rejectFiler({ ...args, reason: flags.reason === true ? undefined : flags.reason });
      return out(`${sub === 'confirm' ? 'Confirmed' : 'Rejected'}: ${r.bank} (${r.bankName ?? ''}) ${sub === 'confirm' ? 'is filed for by' : 'is not filed for by'} CIK ${r.cik}${r.filer ? ` (${r.filer})` : ''}, by ${r.by}.${sub === 'confirm' ? '\nThe next run of the listener searches this filer, back a year the first time: outbound sources run filings' : ''}`);
    }
    if (sub === 'discovered') {
      const l = discoveredFilers({ dir });
      return out(`${l.length} bank filer(s) found by the discovery search and not mapped to any bank in the list. For review only: they are never scored.\n\n${l.map((e) => `CIK ${e.cik}  ${e.name ?? ''}  (${e.states.join(', ')}; SIC ${e.sics.join(', ')})\n${e.filings.map((f) => `  ${f.form} ${f.fileDate}${f.items.length ? ` items ${f.items.join(', ')}` : ''}: ${f.searches.join(', ')}  ${f.link}`).join('\n')}`).join('\n\n')}`);
    }
  }

  if (cmd === 'score' && sub === 'run') {
    const r = runScoring({ dir, buybox: rules.buybox, scoring: rules.scoring, metros: rules.metros, allowPlaceholders: !!flags['draft-buybox'] });
    const n = (t) => r.items.filter((i) => i.tier === t).length;
    return out(`${r.provisional ? 'PROVISIONAL (the buy box still has placeholders; the ranking is not final)\n' : ''}Scored ${r.items.length} banks on data as of ${r.latestRepdte}: Tier A ${n('A')}, Tier B ${n('B')}, untiered ${n(null)}.\nNext: outbound candidates list`);
  }

  if (cmd === 'candidates') {
    const sup = ctx().suppression;
    if (sub === 'list') {
      const tiers = flags.tier && flags.tier !== true ? [String(flags.tier).toUpperCase()] : ['A', 'B'];
      const l = listCandidates({ dir, suppression: sup, tiers, all: !!flags.all });
      const row = (i) => `${i.tier ?? '-'}  ${String(i.score).padStart(6)}  d${i.axes.distress} f${i.axes.fit} t${i.axes.timing}  ${i.key.padEnd(11)} ${i.name} (${i.metroLabels?.join(', ') ?? ''})${i.status !== 'new' ? ` [${i.status}]` : ''}\n     ${i.card?.text ?? (i.filtersFailed?.length ? `filtered: ${i.filtersFailed.join('; ')}` : '')}`;
      // Failed banks are never candidates: the bank is gone and the FDIC sells its loans. They are listed so a principal sees them.
      const failed = (f) => `-  ${f.key.padEnd(11)} ${f.name} failed on ${f.failedOn} (${f.metros.map((m) => m.label).join(', ')}). Sources agreeing: ${f.agree.join(', ')}${f.missingFrom.length ? `; not yet in: ${f.missingFrom.join(', ')}` : ''}.`;
      const failedBlock = l.failedBanks.length ? `\n\nFailed banks with a presence in the metros. The FDIC is the seller of their loans: ${l.failedBanks[0].loanSales}\n${l.failedBanks.map(failed).join('\n')}` : '';
      return out(`${l.provisional ? 'PROVISIONAL: the buy box still has placeholders.\n' : ''}Data as of ${l.latestRepdte} (run ${l.runId}). ${l.items.length} candidate(s). Columns: tier, score, distress/fit/timing, key, bank.\n\n${l.items.map(row).join('\n\n')}${failedBlock}`);
    }
    if (sub === 'show') return out(getCandidate({ dir, key: need(flags, 'key') }));
    if (sub === 'promote') {
      const a = promote({ dir, key: need(flags, 'key'), by: need(flags, 'by'), suppression: sup });
      return out(`Promoted ${a.name} to account ${a.id}${a.pipeline.leadSector ? `, leading with ${a.pipeline.leadSector}` : ''}.\n${a.pipeline.leadSector ? '' : `${a.pipeline.leadSectorNote}\n`}Next: research the bank (no person needed yet): outbound research run --account ${a.id}`);
    }
    if (sub === 'dismiss') return out(dismiss({ dir, key: need(flags, 'key'), by: need(flags, 'by'), reason: need(flags, 'reason') }));
    if (sub === 'snooze') return out(snooze({ dir, key: need(flags, 'key'), by: need(flags, 'by'), until: need(flags, 'until') }));
  }

  if (cmd === 'paper' && sub === 'show') {   // the paper estimate (PRD E14-S1), written by `score run`
    const key = need(flags, 'key');
    const rec = readPaper({ dir, key });
    if (!rec) throw new Error(`No paper estimate for ${key} (${paperPath(dir, key)}). Run: outbound score run`);
    return out(flags.json ? rec : renderPaper(rec));
  }
  if (cmd === 'triage') {   // internal, for the principals only: written to the data folder, never sent (PRD E6-S5, Q13)
    if (sub === 'run') {
      const r = runTriage({ dir, rules: rules.triage, metros: rules.metros, scoring: rules.scoring, since: flags.since, now: new Date() });
      const p = triagePaths(dir, r.date);
      return out(`${renderTriage(r)}\nWritten: ${p.json}, ${p.md} and the snapshot ${p.state}.`);
    }
    if (sub === 'show') {
      if (flags.date === true) throw new Error('--date needs a date: YYYY-MM-DD.');
      const t = readTriage({ dir, date: flags.date });
      return out(t?.markdown ?? `No triage${flags.date ? ` for ${flags.date}` : ''} yet. Run: outbound triage run`);
    }
  }

  if (cmd === 'coverage') {   // PRD next-five E18-S1: read-only, from stored data; counts only
    const r = coverageReport({ dir });
    return out(flags.json ? r : renderCoverage(r));
  }

  if (cmd === 'pilot') {
    if (sub === 'template') { const id = need(flags, 'account'); return out(`Truth sheet written: ${writeTruthTemplate({ dir, account: loadAccount(dir, id), playbooks: rules.playbooks })}\nFill it in, then run the briefer on ${id} and review its findings.`); }
    if (sub === 'review') {
      const r = reviewList({ dir, accountId: need(flags, 'account') });
      const lines = r.findings.map((f) => `[${f.id}] ${f.verdict ?? 'UNREVIEWED'} · ${f.use === 'draft' ? 'cleared for a message' : 'context only'}${f.assetSpecific ? ' · asset' : ''} · ${f.kind}\n    ${f.claim}\n    "${f.quote}"\n    ${f.url}`);
      return out(`Research of ${r.researchDate}${r.staleReview ? ' (re-run since the last review: verdicts start over)' : ''}\n\n${lines.join('\n\n') || 'No findings.'}`);
    }
    if (sub === 'mark') return out(markFinding({ dir, accountId: need(flags, 'account'), findingId: need(flags, 'finding'), verdict: need(flags, 'verdict'), by: need(flags, 'by'), note: flags.note }));
    if (sub === 'scorecard') return out(scorecard({ dir }));
    if (sub === 'pass') { const r = passPilot({ dir, by: need(flags, 'by'), minAccounts: rules.config.pilot.minAccounts }); if (!r.ok) process.exitCode = 1; return out(r.ok ? { passed: r.status } : { refused: r.reasons, totals: r.totals }); }
  }

  if (cmd === 'call') {   // PRD E15: call prep and outcome capture. Nothing here sends; nothing is recorded until a principal confirms
    const id = need(flags, 'account');
    if (sub === 'prep') {
      const account = loadAccount(dir, id);
      const client = flags['dry-run'] ? null : await makeClient();
      const r = await runCallPrep({ client, dir, account, date: flags.date && flags.date !== true ? flags.date : today(), rules, dryRun: !!flags['dry-run'] });
      if (r.dryRun) return out(`--- SYSTEM ---\n${r.system}\n\n--- USER ---\n${r.user}\n(inputs: ${r.inputs})`);
      if (!r.ok) { process.exitCode = 1; return out(r); }
      if (!r.usable) process.exitCode = 1;
      return out(`${r.usable ? 'Call brief ready: every check passed.' : `NOT USABLE: ${r.problems.length} check(s) failed. Do not rely on it.\n${r.problems.map((e) => `- ${e.code}: ${e.message}`).join('\n')}`}${r.warnings.length ? `\nRead first: ${r.warnings.map((w) => w.code).join(', ')}` : ''}\nWritten: ${r.path} (estimated cost $${r.costUsd})`);
    }
    if (sub === 'show') {
      const l = listCalls({ dir, id });
      const b = flags.date && flags.date !== true ? l.briefs.find((x) => x.date === flags.date) : l.briefs[0];
      return out(b?.md ?? `No call brief for ${id}${flags.date && flags.date !== true ? ` on ${flags.date}` : ''}. Run: outbound call prep --account ${id}`);
    }
    if (sub === 'log') {
      const date = needDate(need(flags, 'date'));
      const by = need(flags, 'by');
      const src = need(flags, 'notes');
      let notes;
      if (src === '-') { const chunks = []; for await (const c of process.stdin) chunks.push(c); notes = Buffer.concat(chunks).toString('utf8'); }
      else notes = readFileSync(src, 'utf8');
      if (notes.length > MAX_NOTES) throw new Error(`The notes are ${notes.length} characters; the limit is ${MAX_NOTES}.`);
      if (flags['dry-run']) { const p = buildExtractPrompt({ account: loadAccount(dir, id), date, notes }); return out(`--- SYSTEM ---\n${p.system}\n\n--- USER ---\n${p.user}\n(nothing saved)`); }
      const saved = saveNotes({ dir, id, date, notes, by });
      const replaced = saved.superseded.length ? `The new notes supersede ${saved.superseded.length} pending proposal(s) for ${date}: ${saved.superseded.join(', ')}.\n\n` : '';
      let client;
      try { client = await makeClient(); } catch (e) { throw new Error(`The notes are saved (calls/${id}/${date}-notes.md), but reading them needs a model: ${e.message} Or queue it on the platform: outbound enqueue call.extract --account ${id} --date ${date} --by NAME`); }
      const r = await runCallExtract({ client, dir, id, date, by, models: rules.models });
      if (!r.ok) { process.exitCode = 1; return out(`${replaced}The notes are saved, but the model call failed: ${r.reason}${r.detail ? ` (${r.detail})` : ''}. Nothing was recorded.`); }
      return out(`${replaced}${renderProposal(r.proposal, id)}`);
    }
    if (sub === 'edit') {   // a principal corrects a pending proposal: only the fields given change, each replaced whole
      const pid = need(flags, 'proposal');
      const edits = {};
      const given = (k) => flags[k] !== undefined;
      const noneOnly = (k, one) => { if (flags[k] !== 'none') throw new Error(`--${k} takes only "none", to clear them. Give each with --${one}.`); return []; };
      if (given('codes') || given('when') || given('referral')) {
        if (flags.codes === true) throw new Error('--codes takes a list: --codes held,nda_requested (or none).');
        const current = listCalls({ dir, id }).proposals.find((p) => p.id === pid);
        if (!current) throw new Error(`No proposal "${pid}" for ${id}.`);
        const was = new Map(current.outcomes.map((o) => [o.code, o]));
        const codes = !given('codes') ? current.outcomes.map((o) => o.code) : flags.codes === 'none' ? [] : String(flags.codes).split(',').map((s) => s.trim()).filter(Boolean);
        edits.outcomes = codes.map((code) => ({ code, when: code === 'not_selling_now' ? opt(flags, 'when') ?? was.get(code)?.when ?? '' : '', referral: code === 'wrong_person' ? opt(flags, 'referral') ?? was.get(code)?.referral ?? '' : '' }));
      }
      if (given('objections')) edits.objections = noneOnly('objections', 'objection TEXT');
      if (given('objection')) edits.objections = [].concat(flags.objection).filter((x) => x !== true).map(String);
      if (given('commitments')) edits.commitments = noneOnly('commitments', 'commitment "who|what|by"');
      if (given('commitment')) {
        edits.commitments = [].concat(flags.commitment).map((s) => {
          const parts = String(s === true ? '' : s).split('|').map((x) => x.trim());
          if (parts.length < 2 || parts.length > 3 || !parts[1]) throw new Error(`A commitment is "who|what|by", for example "us|Send our confidentiality agreement|2026-11-21". "by" may be left out.`);
          return { who: parts[0], what: parts[1], by: parts[2] ?? '' };
        });
      }
      if (given('follow-up')) edits.followUpDate = flags['follow-up'] === 'none' ? '' : need(flags, 'follow-up');
      const r = editProposal({ dir, id, proposalId: pid, by: need(flags, 'by'), edits });
      return out(`Corrected proposal ${r.proposalId}: ${r.fields.join(', ')}. Nothing is recorded until a principal confirms it.\n\n${renderProposal(r.proposal, id)}`);
    }
    if (sub === 'confirm') {
      const r = await confirmInFolder({ dir, id, proposalId: need(flags, 'proposal'), by: need(flags, 'by'), rules });
      return out(`${r.resumed ? 'Finished a confirmation that had stopped partway; nothing was written twice.\n' : ''}Recorded the call of ${r.outcome.date} for ${id}: ${r.outcome.codes.join(', ') || 'no outcome codes'}.\n${r.outcome.edited ? `- Corrected by ${r.outcome.edited.by.join(', ')} before confirming (${r.outcome.edited.fields.join(', ')}); the outcome records it.\n` : ''}- A meeting event is in the touch log. The automated sequence for this bank is over; any follow-up is a principal's own message.\n- The outcome is on the account and in outcomes.jsonl, linked to ${r.outcome.originSignals.length} origin signal(s).\n- People named in the notes stay unconfirmed. Add one only with: outbound account set-person, then confirm-role.\n${r.followUp.hardStops.length ? `STOP before any follow-up: ${r.followUp.hardStops.join(', ')}.\n` : ''}Follow-up checklist (no email is drafted): ${r.followUp.path}`);
    }
    if (sub === 'reject') return out(rejectProposal({ dir, id, proposalId: need(flags, 'proposal'), by: need(flags, 'by'), reason: flags.reason === true ? '' : flags.reason }));
    if (sub === 'list') {
      const l = listCalls({ dir, id });
      return out([
        `${l.account.name}: ${l.briefs.length} call brief(s), ${l.proposals.filter((p) => p.status === 'pending').length} pending proposal(s), ${l.outcomes.length} confirmed outcome(s).`,
        ...l.briefs.map((b) => `brief    ${b.date}  ${b.usable ? 'usable' : 'NOT USABLE'}${b.problems.length ? ` (${b.problems.map((e) => e.code).join(', ')})` : ''}`),
        ...l.proposals.map((p) => `proposal ${p.id}  ${p.status}${p.edits.length ? ` (corrected by ${[...new Set(p.edits.map((e) => e.by))].join(', ')})` : ''}${p.unfinished ? ' (confirmation unfinished: run call confirm again)' : ''}  ${p.outcomes.map((o) => o.code).join(', ')}`),
        ...l.outcomes.map((o) => `outcome  ${o.date}  ${o.codes.join(', ')}  confirmed by ${o.confirmedBy}`),
      ].join('\n'));
    }
  }

  if (cmd === 'network') {   // PRD E22-S1: names and relationships only; audit lines carry ids
    const opt = (k) => (flags[k] && flags[k] !== true ? flags[k] : undefined);
    if (sub === 'add-person') { const p = addPerson({ dir, name: need(flags, 'name'), organization: opt('organization'), title: opt('title'), relationship: opt('relationship'), knownBy: need(flags, 'known-by'), introConsent: opt('consent'), aliases: flags.alias, by: need(flags, 'by') }); return out(`Added ${p.id}: ${p.name}${p.organization ? ` of ${p.organization}` : ''}, known to ${p.knownBy.join(', ')}. Agreed to be asked for introductions: ${p.introConsent}.`); }
    if (sub === 'add-firm') { const f = addFirm({ dir, name: need(flags, 'name'), kind: opt('kind'), relationship: opt('relationship'), knownBy: need(flags, 'known-by'), aliases: flags.alias, by: need(flags, 'by') }); return out(`Added ${f.id}: ${f.name} (${f.kind}), known to ${f.knownBy.join(', ')}.`); }
    if (sub === 'add-membership') { const m = addMembership({ dir, association: need(flags, 'association'), principal: need(flags, 'principal'), role: opt('role'), aliases: flags.alias, by: need(flags, 'by') }); return out(`Added ${m.id}: ${m.principal} is a ${m.role} of ${m.association}.`); }
    if (sub === 'list') {
      const l = listNetwork({ dir, by: need(flags, 'by') });
      if (flags.json) return out(l);
      const used = (id) => (l.uses[id] ? `  (bridge of ${l.uses[id]} chosen route${l.uses[id] === 1 ? '' : 's'})` : '');
      return out([`People (${l.people.length}):`, ...l.people.map((p) => `  ${p.id}  ${p.name}${p.organization ? `, ${p.organization}` : ''}${p.title ? `, ${p.title}` : ''}  known to ${p.knownBy.join(', ')}  consent ${p.introConsent}${p.relationship ? `  (${p.relationship})` : ''}${used(p.id)}`),
        `Firms (${l.firms.length}):`, ...l.firms.map((f) => `  ${f.id}  ${f.name} (${f.kind})  known to ${f.knownBy.join(', ')}${f.relationship ? `  (${f.relationship})` : ''}${used(f.id)}`),
        `Memberships (${l.memberships.length}):`, ...l.memberships.map((m) => `  ${m.id}  ${m.association}${m.aliases.length ? ` (${m.aliases.join(', ')})` : ''}: ${m.principal}, ${m.role}${used(m.id)}`)].join('\n'));
    }
    if (sub === 'remove') { const r = removeNetworkEntry({ dir, id: need(flags, 'id'), by: need(flags, 'by') }); return out(`Removed ${r.id} (${r.kind}). It was removed from ${r.routeFiles} routes file(s), with ${r.routesRemoved} route(s) that used it.`); }
  }

  if (cmd === 'routes') {   // PRD E22: code only; nothing is drafted or sent
    const id = need(flags, 'account');
    if (sub === 'build') {
      const r = buildRoutes({ dir, id, rules });
      const types = r.routes.map((x) => x.type);
      return out(`Routes for ${r.name}: ${r.routes.length} routes (${types.join(', ')}), ${r.held.length} held.${r.guard.hardStops.length ? ` STOP: ${r.guard.hardStops.map((h) => h.code).join(', ')}.` : ''}\nWritten: ${join(dir, 'routes', `${id}.md`)}. Read it with: outbound routes show --account ${id}`);
    }
    if (sub === 'show') { const r = readRoutes({ dir, id }); if (!r) return out(`No routes yet for ${id}. Run: outbound routes build --account ${id}`); return out(flags.json ? r.record : r.markdown); }
    if (sub === 'choose') {
      const { route } = chooseRoute({ dir, id, routeId: need(flags, 'route'), by: need(flags, 'by'), rules });
      const md = readRoutes({ dir, id }).markdown;
      return out(`Chosen: ${route.type} route ${route.id}. Nothing is drafted or sent; the checklist is below and in routes/${id}.md.\n\n${md.slice(md.indexOf('## Chosen route'))}`);
    }
  }

  if (cmd === 'backtest') {   // PRD E17: run from the command line against the data folder; never writes scoring.json
    const bt = rules.config.backtest ?? {};
    const int = (k) => { if (flags[k] === undefined) return undefined; const n = Number(flags[k]); if (!Number.isInteger(n) || n < 1) throw new Error(`--${k} must be a whole number of 1 or more (the ${k === 'k' ? 'size of the top group' : 'horizon in quarters'}).`); return n; };
    if (sub === 'panel') {
      const r = await runPanel({ dir, metros: rules.metros, config: bt, lookbackQuarters: rules.scoring.lookbackQuarters ?? 8, from: opt(flags, 'from'), to: opt(flags, 'to') });
      if (r.outcome === 'failed') { process.exitCode = 1; return out(r); }
      return out(`Panel ${r.runId}: ${r.outcome.toUpperCase()}. ${r.banks} bank(s), ${r.asOf.length} as-of quarters from ${r.asOf[0]} to ${r.asOf.at(-1)}, Summary of Deposits ${r.sodYears.join(', ')}.\nCoverage: ${Object.entries(r.coverage).map(([d, c]) => `${d} ${c}`).join(', ')}.\n${r.notes.map((n) => `- ${n}`).join('\n')}\nNext: outbound backtest labels`);
    }
    if (sub === 'labels') {
      const r = buildLabels({ dir, config: rules.config, filings: !!flags.filings });
      if (r.outcome === 'failed') { process.exitCode = 1; return out(r); }
      return out(`Labels ${r.runId}: ${r.labels} (${Object.entries(r.byKind).map(([k, n]) => `${k} ${n}`).join(', ')}), complete through ${r.labelsAsOf}. disclosed_sale is unavailable: outbound backtest labels --filings says why.\nNext: outbound backtest run`);
    }
    if (sub === 'run') {
      const compare = flags.compare !== undefined;
      if (compare && (flags.compare === true || !pos[2])) throw new Error('--compare needs two scoring files: outbound backtest run --compare A B');
      const mode = compare ? 'compare' : flags.holdout ? 'holdout' : flags.rolling ? 'rolling' : 'training';
      if ([compare, !!flags.holdout, !!flags.rolling].filter(Boolean).length > 1) throw new Error('Choose one of --compare, --holdout and --rolling.');
      const scoringPaths = compare ? [flags.compare, pos[2]] : opt(flags, 'scoring') ? [opt(flags, 'scoring')] : [];
      const r = runBacktest({ dir, rules, mode, scoringPaths, horizon: int('horizon'), k: int('k') });
      return out(`${summarize(r.report)}\nWritten: ${r.paths.json} and ${r.paths.md}.`);
    }
    if (sub === 'report') {
      const r = readReport({ dir, hash: opt(flags, 'hash') });
      if (!r) throw new Error(`No backtest report${opt(flags, 'hash') ? ` ${opt(flags, 'hash')}` : ''} yet. Run: outbound backtest run`);
      return out(summarize(r));
    }
    if (sub === 'verify') { if (!(await runVerify(dir, 'backtest', rules, flags))) process.exitCode = 1; return; }
  }

  if (cmd === 'outcomes' && sub === 'report') {
    const { report, path } = runOutcomesReport({ dir, config: rules.config, since: flags.since && flags.since !== true ? flags.since : null });
    return out(`${renderOutcomesReport(report)}\n\nWritten: ${path}`);
  }

  if (cmd === 'contacts') {   // the vendor test harness (PRD E7-S2); nothing here calls a vendor
    const contacts = rules.contacts;
    if (sub === 'vendor-test') {
      const file = need(flags, 'results');
      const { report, paths } = runVendorTest({ dir, vendor: need(flags, 'vendor'), text: readFileSync(file, 'utf8'), fileName: file, contacts, by: opt(flags, 'by') });
      return out(`${readText(paths.md)}\nWritten: ${paths.json} and ${paths.md}.${report.meets.ok ? `\nIt meets every threshold. A principal may record a pass: outbound contacts vendor-pass --vendor "${report.vendorName}" --by NAME` : ''}`);
    }
    if (sub === 'vendor-pass') {
      const r = passVendor({ dir, vendor: need(flags, 'vendor'), by: need(flags, 'by'), contacts });
      if (!r.ok) { process.exitCode = 1; return out(`No pass recorded. The latest test (${r.report}) does not meet the thresholds in contacts.json:\n${r.failures.map((f) => `- ${f}`).join('\n')}`); }
      return out(`Pass recorded for ${r.pass.vendor} by ${r.pass.by}, on the test of ${r.pass.reportDate}. It may now be a source (--source vendor --vendor "${r.pass.vendor}") and a way of knowing an address (--method vendor).`);
    }
    if (sub === 'vendors') {
      const l = listVendors({ dir });
      return out(l.length ? l.map((v) => `${v.vendor.padEnd(24)} ${v.tests} test(s), latest ${v.latest ?? '-'}; ${v.passed ? `PASSED (${v.passedBy}, ${String(v.passedAt).slice(0, 10)})` : 'no pass'}`).join('\n') : 'No vendor tested yet. Write contacts/known.json, then: outbound contacts vendor-test --vendor NAME --results FILE');
    }
  }

  if (cmd === 'suppress') {
    const c = ctx();
    if (sub === 'list') return out(c.suppression);
    if (sub === 'add') return out(addSuppression(dir, { type: need(flags, 'type'), value: need(flags, 'value'), reason: need(flags, 'reason'), aliases: flags.alias }, c));
  }

  out(HELP);
  process.exitCode = 1;
}

main().catch((e) => { console.error(`Error: ${e.message}`); process.exitCode = 1; });
