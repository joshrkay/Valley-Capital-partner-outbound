#!/usr/bin/env node
// Command line for the three outbound agents. Prospect data lives in $OUTBOUND_DATA_DIR (outside the repo); nothing here can send a message.
import { join } from 'node:path';
import { dataDir } from './src/paths.mjs';
import { loadRules } from './src/rules.mjs';
import { readJson, readJsonl, writeJson, readText, listFiles, exists, safeId, audit } from './src/store.mjs';
import { runFdic } from './src/sources/fdic.mjs';
import { runEdgar } from './src/sources/edgar.mjs';
import { verifyFdic, verifyEdgar } from './src/sources/verify.mjs';
import { LOADS } from './src/uow.mjs';
import { runScoring } from './src/score.mjs';
import { listCandidates, getCandidate, promote, dismiss, snooze } from './src/candidates.mjs';
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
  outbound sources run fdic [--include-hq]       bank list for the six metros, deposit footprint, 8 quarters of CRE credit data (free, no key)
  outbound sources run edgar                      CMBS loans in the six metros and buy-box sectors, from each trust's monthly SEC filing,
                                                  with workout codes and the special servicer (needs config.sec.userAgent filled in)
  outbound sources status                         the last run of each source, and the latest FDIC quarter seen
  outbound sources verify [fdic|edgar] [--sample N]   check the stored data against the live sources (read-only): fresh, complete,
                                                  values and ratios equal FDIC's own, the CMBS parser equal to a plain count; plus a
                                                  short list of records with their public URL to compare by eye. Exits 1 on any failure.

  Candidates (PRD E6): which banks, why now, and what paper they likely hold. A principal decides; nothing is contacted.
  outbound score run [--draft-buybox]             score every bank on distress, fit and timing (refuses while buybox.json has [CONFIRM]
                                                  placeholders; --draft-buybox runs anyway and labels the list PROVISIONAL)
  outbound candidates list [--tier A|B] [--all]   the list: tier, score by axis, metros, and the "why now" card
  outbound candidates show --key fdic:CERT        one bank: paper profile, score components with their sources, signals
  outbound candidates promote --key K --by NAME   create the account with the pipeline's research attached; then research it
  outbound candidates dismiss --key K --by NAME --reason TEXT      it returns only if a new signal fires
  outbound candidates snooze  --key K --by NAME --until YYYY-MM-DD

  Pilot (PRD E1): check the briefer on accounts you already know before it researches any account the pipeline found.
  outbound pilot template --account ID            write a "what is true" sheet to fill in (pilot/ID.truth.json)
  outbound pilot review   --account ID            list the brief's findings and the verdicts recorded so far
  outbound pilot mark     --account ID --finding F --verdict true|false|unknown --by NAME [--note TEXT]
  outbound pilot scorecard                        precision, recall, fabrications and cost across the pilot
  outbound pilot pass     --by NAME               record a pass (needs enough fully reviewed accounts and zero fabrications)

  Platform (PRD E12): needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (the worker's key; never put it in the web app).
  outbound platform smoke                         check a new project with SUPABASE_URL and SUPABASE_ANON_KEY (the PUBLIC key only):
                                                  sign-ups off, every table and function present and refusing the public key
  outbound worker [--max N]                       run queued jobs until the queue is empty (or N have run); prints ids and outcomes only
  outbound enqueue sources.fdic|sources.edgar|score.run|research.run|draft.run [--account ID] [--channel C] [--step N] [--draft-buybox] [--include-hq]
  outbound platform push [--from DIR]             copy a data folder into the platform (default: OUTBOUND_DATA_DIR); safe to re-run
  outbound platform pull --to DIR                 write everything back to a new or empty folder outside this repository
  outbound platform verify [fdic|edgar] [--sample N]   the same checks on the platform's data (read-only); no spot-check list unless asked
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
  const lines = [];
  for (const r of reports) {
    lines.push(`== ${r.source.toUpperCase()}`);
    for (const c of r.checks) lines.push(`${c.ok ? 'PASS' : 'FAIL'}  ${c.id}: ${c.summary}`);
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
      const params = { ...(flags.account ? { account: flags.account } : {}), ...(flags.channel ? { channel: flags.channel } : {}), ...(flags.step ? { step: Number(flags.step) } : {}), ...(flags['draft-buybox'] ? { draftBuybox: true } : {}), ...(flags['include-hq'] ? { includeHq: true } : {}) };
      return out(`Queued job ${await client.enqueue(sub, params)} (${sub}).`);
    }
    if (cmd === 'platform' && sub === 'push') return out(await push({ client, dir: flags.from && flags.from !== true ? flags.from : dataDir() }));
    if (cmd === 'platform' && sub === 'pull') return out(await pull({ client, to: need(flags, 'to') }));
    if (cmd === 'platform' && sub === 'verify') {   // read-only: the unit of work changes nothing, so nothing is written back
      // No spot-check list unless asked: this command runs in scheduled-job logs, which carry check results only, never bank names.
      const { result } = await client.unitOfWork(LOADS.sources, (dir) => runVerify(dir, pos[2], rules, { ...flags, sample: flags.sample ?? 0 }), { retries: 0 });
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
    if (sub === 'run') {
      if (!['fdic', 'edgar'].includes(pos[2])) throw new Error('Usage: outbound sources run fdic [--include-hq] | outbound sources run edgar');
      const r = pos[2] === 'fdic' ? await runFdic({ dir, metros: rules.metros, includeHq: !!flags['include-hq'] }) : await runEdgar({ dir, metros: rules.metros, buybox: rules.buybox, scoring: rules.scoring, sec: rules.config.sec });
      if (r.outcome === 'failed') process.exitCode = 1;
      return out(r);
    }
    if (sub === 'verify') { if (!(await runVerify(dir, pos[2], rules, flags))) process.exitCode = 1; return; }
    if (sub === 'status') {
      const last = {};
      for (const r of readJsonl(join(dir, 'sources', 'runs.jsonl'))) last[r.source] = r;
      return out({ lastRuns: last, fdic: readJson(join(dir, 'sources', 'fdic', 'state.json'), null) });
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
      return out(`${l.provisional ? 'PROVISIONAL: the buy box still has placeholders.\n' : ''}Data as of ${l.latestRepdte} (run ${l.runId}). ${l.items.length} candidate(s). Columns: tier, score, distress/fit/timing, key, bank.\n\n${l.items.map(row).join('\n\n')}`);
    }
    if (sub === 'show') return out(getCandidate({ dir, key: need(flags, 'key') }));
    if (sub === 'promote') {
      const a = promote({ dir, key: need(flags, 'key'), by: need(flags, 'by'), suppression: sup });
      return out(`Promoted ${a.name} to account ${a.id}${a.pipeline.leadSector ? `, leading with ${a.pipeline.leadSector}` : ''}.\n${a.pipeline.leadSector ? '' : `${a.pipeline.leadSectorNote}\n`}Next: research the bank (no person needed yet): outbound research run --account ${a.id}`);
    }
    if (sub === 'dismiss') return out(dismiss({ dir, key: need(flags, 'key'), by: need(flags, 'by'), reason: need(flags, 'reason') }));
    if (sub === 'snooze') return out(snooze({ dir, key: need(flags, 'key'), by: need(flags, 'by'), until: need(flags, 'until') }));
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

  if (cmd === 'suppress') {
    const c = ctx();
    if (sub === 'list') return out(c.suppression);
    if (sub === 'add') return out(addSuppression(dir, { type: need(flags, 'type'), value: need(flags, 'value'), reason: need(flags, 'reason'), aliases: flags.alias }, c));
  }

  out(HELP);
  process.exitCode = 1;
}

main().catch((e) => { console.error(`Error: ${e.message}`); process.exitCode = 1; });
