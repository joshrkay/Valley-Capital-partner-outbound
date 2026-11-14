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
import { buildLedger, readLedger, listSales, groupBySeller, groupBuyers, pricing, verifyLedger } from './src/sales.mjs';
import { suggestFilers, confirmFiler, rejectFiler, filerStatus } from './src/sources/filers.mjs';
import { LOADS } from './src/uow.mjs';
import { runScoring } from './src/score.mjs';
import { listCandidates, getCandidate, promote, dismiss, snooze } from './src/candidates.mjs';
import { readPaper, renderPaper, paperPath } from './src/paper.mjs';
import { runTriage, readTriage, renderTriage, triagePaths } from './src/triage.mjs';
import { loadContext, checkTouch, recordObservedSend, recordEvent, addSuppression, dueList, touchFromAccount } from './src/guard.mjs';
import { runBriefer } from './src/research.mjs';
import { runDrafter, approveDraft } from './src/draft.mjs';
import { makeClient } from './src/model.mjs';
import { writeTruthTemplate, reviewList, markFinding, scorecard, passPilot, researchGate } from './src/pilot.mjs';
import { platformClient } from './src/platform/client.mjs';
import { setPerson, confirmRole } from './src/accounts.mjs';
import { work, JOB_KINDS } from './src/platform/worker.mjs';
import { push, pull } from './src/platform/move.mjs';
import { smoke } from './src/platform/smoke.mjs';
import { runCallPrep, saveNotes, runCallExtract, buildExtractPrompt, confirmInFolder, rejectProposal, listCalls, renderProposal, needDate, MAX_NOTES } from './src/calls.mjs';
import { runOutcomesReport, renderOutcomesReport } from './src/outcomes.mjs';
import { readFileSync } from 'node:fs';

const HELP = `Outbound agents. Set OUTBOUND_DATA_DIR to a private folder OUTSIDE this repository first.

  outbound init                                   create the data folder, a sender template and an invented example account
  outbound status                                 what exists, and what is missing before anything can send

  outbound research run --account ID [--dry-run]  Agent 2: deep web research and a verified brief (costs money; --dry-run shows the request)
  outbound research show --account ID             print the brief
  outbound account set-person --account ID --name N [--title T] --by NAME   a principal names the person (e.g. from an institution brief's candidates)
  outbound account confirm-role --account ID --by NAME    a principal confirms the named person's role after reading the brief

  outbound draft run --account ID --channel email|letter|linkedin_note|call [--step N] [--sender ID] [--date YYYY-MM-DD] [--ack-risk] [--dry-run]
  outbound draft approve --account ID --channel C --step N --by NAME
  outbound draft show --account ID --channel C --step N

  outbound guard check  --account ID --channel C [--step N] [--sender ID] [--date D]
  outbound guard due    [--sender ID] [--date D]
  outbound guard record --account ID --channel C --step N --sender ID [--date D]     after a person has actually sent it (always logged; broken rules are shown)
  outbound guard event  --account ID --type reply|opt_out|bounce|meeting|handoff [--date D] [--note TEXT]
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
                                                  pools, advisor; the buyer is unknown. Gentle: robots.txt and a few requests a minute
                                                  (needs config.fdic.userAgent filled in). Then rebuilds the sale ledger, as the edgar run does
  outbound sources status                         the last run of each source, and the latest FDIC quarter seen
  outbound sources verify [fdic|edgar|filings|fdicsales] [--sample N]   check the stored data against the live sources (read-only): fresh, complete,
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
  outbound call confirm --account ID --proposal PID --by NAME      record it: a guard meeting event (it stops the sequence), the
                                                  outcome on the account and in outcomes.jsonl, and a follow-up checklist. If it stops
                                                  partway, run it again: it finishes what is missing and writes nothing twice
  outbound call reject  --account ID --proposal PID --by NAME [--reason TEXT]
  outbound call list --account ID                 briefs, proposals and confirmed outcomes for an account
  outbound outcomes report [--since YYYY-MM-DD]   confirmed outcomes by signal type, tier and lead time (no model; never changes
                                                  weights), written to reports/outcomes-DATE.json

  Platform (PRD E12): needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (the worker's key; never put it in the web app).
  outbound platform smoke                         check a new project with SUPABASE_URL and SUPABASE_ANON_KEY (the PUBLIC key only):
                                                  sign-ups off, every table and function present and refusing the public key
  outbound worker [--max N]                       run queued jobs until the queue is empty (or N have run); prints ids and outcomes only
  outbound enqueue sources.fdic|sources.edgar|sources.filings|sources.fdicsales|score.run|triage.run|research.run|draft.run|call.prep|call.extract [--account ID] [--channel C] [--step N] [--date D] [--by NAME] [--draft-buybox] [--include-hq] [--since YYYY-MM-DD]
  outbound platform push [--from DIR]             copy a data folder into the platform (default: OUTBOUND_DATA_DIR); safe to re-run
  outbound platform pull --to DIR                 write everything back to a new or empty folder outside this repository
  outbound platform verify [fdic|edgar|filings|fdicsales|sales] [--sample N]   the same checks on the platform's data (read-only); no spot-check list unless asked
`;

function parse(argv) {
  const pos = []; const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { pos.push(a); continue; }
    const k = a.slice(2); const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) { flags[k] = true; continue; }
    flags[k] = k === 'alias' ? [...(flags[k] ?? []), v] : v; i++;
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
  if (which === 'sales') reports.push(verifyLedger({ dir, sample }));
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
      const { result } = await client.unitOfWork(LOADS.sales, (dir) => runVerify(dir, pos[2], rules, { ...flags, sample: flags.sample ?? 0 }), { retries: 0 });
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
    if (!exists(join(dir, 'accounts', 'example-bank.json'))) writeJson(join(dir, 'accounts', 'example-bank.json'), { id: 'example-bank', name: 'Example Community Bank', aliases: [], type: 'bank', sectors: ['hospitality'], tier: 'A', person: { name: 'Jordan Sample', title: 'Chief Credit Officer', email: '', phone: '', phoneType: '', timezone: 'America/Chicago', mailingAddress: '' }, contact: { emailStatus: 'unverified', roleConfirmed: false, provenance: [] }, notes: 'INVENTED EXAMPLE. Replace with a real account chosen by a principal.', knownFacts: [] });
    return out(`Data folder ready: ${dir}\nNext: fill senders.json, add accounts/<id>.json for the accounts a principal chose, then: outbound status`);
  }

  if (cmd === 'status') {
    const c = ctx();
    const accts = listFiles(join(dir, 'accounts'), '.json').map((f) => f.replace(/\.json$/, ''));
    const incomplete = c.senders.filter((s) => Object.values(s).some((v) => /\[confirm/i.test(String(v))));
    return out({ dataDir: dir, killSwitch: !!(rules.config.killSwitch || c.kill), senders: c.senders.length, sendersIncomplete: incomplete.map((s) => s.id), accounts: accts.length,
      researched: accts.filter((a) => exists(join(dir, 'research', `${a}.json`))), touchesLogged: c.touches.filter((t) => t.type === 'touch').length, suppressionEntries: c.suppression.length,
      readyToSend: !incomplete.length && c.senders.length > 0 && !rules.config.killSwitch && !c.kill });
  }

  if (cmd === 'research' && (sub === 'run' || sub === 'show')) {
    const id = need(flags, 'account');
    if (sub === 'show') { const p = join(dir, 'briefs', `${id}.md`); return out(readText(p) ?? `No brief yet for ${id}.`); }
    const account = loadAccount(dir, id);
    if (!flags['dry-run']) { const g = researchGate({ dir, account, config: rules.config }); if (!g.allowed) throw new Error(g.reason); }
    const client = flags['dry-run'] ? null : await makeClient({ timeout: rules.models.research.timeoutMs });
    const r = await runBriefer({ client, dir, account, models: rules.models, playbooks: rules.playbooks, dryRun: !!flags['dry-run'] });
    if (r.dryRun) return out(`--- SYSTEM ---\n${r.system}\n\n--- USER ---\n${r.user}\n\n--- TOOLS ---\nweb_search (max ${r.cfg.maxSearches}), web_fetch (max ${r.cfg.maxFetches}), model ${r.cfg.model}, effort ${r.cfg.effort}`);
    return out(r);
  }

  if (cmd === 'account' && sub === 'set-person') {   // a principal picks the person, usually from an institution brief's candidates
    const a = setPerson({ dir, id: need(flags, 'account'), name: need(flags, 'name'), title: flags.title, by: need(flags, 'by') });
    return out(`Person set for ${a.name}: ${a.person.name}. Their role is unconfirmed. Read the sources in the brief, or run the briefer again for person research, then: outbound account confirm-role --account ${a.id} --by NAME`);
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

  if (cmd === 'guard') {
    const c = ctx();
    if (sub === 'due') {
      const accts = listFiles(join(dir, 'accounts'), '.json').map((f) => readJson(join(dir, 'accounts', f)));
      return out(dueList(accts, c, { date: flags.date ?? today(), sender: flags.sender ?? c.senders[0]?.id }));
    }
    if (sub === 'event') { return out(recordEvent(dir, { accountId: need(flags, 'account'), institution: loadAccount(dir, flags.account).name, type: need(flags, 'type'), date: flags.date, note: flags.note === true ? undefined : flags.note, person: loadAccount(dir, flags.account).person }, c)); }
    const account = loadAccount(dir, need(flags, 'account'));
    const sentCount = c.touches.filter((t) => t.accountId === account.id && t.type === 'touch').length;
    const t = touchFromAccount(account, { channel: need(flags, 'channel'), step: Number(flags.step ?? sentCount + 1), date: flags.date ?? today(), sender: flags.sender ?? c.senders[0]?.id });
    if (sub === 'check') return out(checkTouch(t, c));
    if (sub === 'record') {   // the send already happened, so it is always logged; a rule it broke is shown, not used to drop the record
      const r = recordObservedSend(dir, t, c);
      return out(r.violations.length ? `RECORDED, but this send broke ${r.violations.length} rule(s). Review before the next touch:\n${r.violations.map((e) => `- ${e.code}: ${e.message}`).join('\n')}` : r.rec);
    }
  }

  if (cmd === 'sources') {
    if (sub === 'run' && pos[2] === 'filings') {   // the SEC filings listener (PRD E13-S1)
      const r = await runFilings({ dir, sec: rules.config.sec, rules: loadFilingRules(), since: flags.since });
      if (r.outcome === 'failed') process.exitCode = 1;
      return out(r);
    }
    if (sub === 'run') {
      if (!['fdic', 'edgar', 'fdicsales'].includes(pos[2])) throw new Error('Usage: outbound sources run fdic [--include-hq] | outbound sources run edgar | outbound sources run fdicsales | outbound sources run filings [--since YYYY-MM-DD]');
      const r = pos[2] === 'fdic' ? await runFdic({ dir, metros: rules.metros, includeHq: !!flags['include-hq'] })
        : pos[2] === 'fdicsales' ? await runFdicSales({ dir, fdic: rules.config.fdic, personalDomains: rules.config.personalDomains })
        : await runEdgar({ dir, metros: rules.metros, buybox: rules.buybox, scoring: rules.scoring, sec: rules.config.sec });
      // The CMBS and FDIC loan-sale runs end by rebuilding the sale ledger (PRD E16), so a liquidation reported this month is kept.
      if (pos[2] !== 'fdic' && r.outcome !== 'failed') r.ledger = buildLedger({ dir, config: rules.config });
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
    if (sub === 'build') { const r = buildLedger({ dir, config: rules.config }); if (r.outcome === 'failed') process.exitCode = 1; return out(r); }
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
    if (sub === 'confirm') {
      const r = await confirmInFolder({ dir, id, proposalId: need(flags, 'proposal'), by: need(flags, 'by'), rules });
      return out(`${r.resumed ? 'Finished a confirmation that had stopped partway; nothing was written twice.\n' : ''}Recorded the call of ${r.outcome.date} for ${id}: ${r.outcome.codes.join(', ') || 'no outcome codes'}.\n- A meeting event is in the touch log. The automated sequence for this bank is over; any follow-up is a principal's own message.\n- The outcome is on the account and in outcomes.jsonl, linked to ${r.outcome.originSignals.length} origin signal(s).\n- People named in the notes stay unconfirmed. Add one only with: outbound account set-person, then confirm-role.\n${r.followUp.hardStops.length ? `STOP before any follow-up: ${r.followUp.hardStops.join(', ')}.\n` : ''}Follow-up checklist (no email is drafted): ${r.followUp.path}`);
    }
    if (sub === 'reject') return out(rejectProposal({ dir, id, proposalId: need(flags, 'proposal'), by: need(flags, 'by'), reason: flags.reason === true ? '' : flags.reason }));
    if (sub === 'list') {
      const l = listCalls({ dir, id });
      return out([
        `${l.account.name}: ${l.briefs.length} call brief(s), ${l.proposals.filter((p) => p.status === 'pending').length} pending proposal(s), ${l.outcomes.length} confirmed outcome(s).`,
        ...l.briefs.map((b) => `brief    ${b.date}  ${b.usable ? 'usable' : 'NOT USABLE'}${b.problems.length ? ` (${b.problems.map((e) => e.code).join(', ')})` : ''}`),
        ...l.proposals.map((p) => `proposal ${p.id}  ${p.status}${p.unfinished ? ' (confirmation unfinished: run call confirm again)' : ''}  ${p.outcomes.map((o) => o.code).join(', ')}`),
        ...l.outcomes.map((o) => `outcome  ${o.date}  ${o.codes.join(', ')}  confirmed by ${o.confirmedBy}`),
      ].join('\n'));
    }
  }

  if (cmd === 'outcomes' && sub === 'report') {
    const { report, path } = runOutcomesReport({ dir, config: rules.config, since: flags.since && flags.since !== true ? flags.since : null });
    return out(`${renderOutcomesReport(report)}\n\nWritten: ${path}`);
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
