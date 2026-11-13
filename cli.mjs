#!/usr/bin/env node
// Command line for the three outbound agents. Prospect data lives in $OUTBOUND_DATA_DIR (outside the repo); nothing here can send a message.
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { dataDir } from './src/paths.mjs';
import { loadRules } from './src/rules.mjs';
import { readJson, writeJson, listFiles, safeId, audit } from './src/store.mjs';
import { loadContext, checkTouch, recordTouch, recordEvent, addSuppression, dueList, touchFromAccount } from './src/guard.mjs';
import { runBriefer } from './src/research.mjs';
import { runDrafter, approveDraft } from './src/draft.mjs';
import { makeClient } from './src/model.mjs';

const HELP = `Outbound agents. Set OUTBOUND_DATA_DIR to a private folder OUTSIDE this repository first.

  outbound init                                   create the data folder, a sender template and an invented example account
  outbound status                                 what exists, and what is missing before anything can send

  outbound research run --account ID [--dry-run]  Agent 2: deep web research and a verified brief (costs money; --dry-run shows the request)
  outbound research show --account ID             print the brief
  outbound account confirm-role --account ID --by NAME    a principal confirms the named person's role after reading the brief

  outbound draft run --account ID --channel email|letter|linkedin_note|call [--step N] [--sender ID] [--date YYYY-MM-DD] [--ack-risk] [--dry-run]
  outbound draft approve --account ID --channel C --step N --by NAME
  outbound draft show --account ID --channel C --step N

  outbound guard check  --account ID --channel C [--step N] [--sender ID] [--date D]
  outbound guard due    [--sender ID] [--date D]
  outbound guard record --account ID --channel C --step N --sender ID [--date D]     after a person has actually sent it
  outbound guard event  --account ID --type reply|opt_out|bounce|meeting|handoff [--date D] [--note TEXT]
  outbound suppress add --type email|domain|person|institution|asset --value V --reason R [--alias A]...
  outbound suppress list
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
const need = (flags, k) => { if (!flags[k] || flags[k] === true) throw new Error(`--${k} is required.`); return flags[k]; };

async function main() {
  const { pos, flags } = parse(process.argv.slice(2));
  const [cmd, sub] = pos;
  if (!cmd || cmd === 'help' || flags.help) return out(HELP);
  const dir = dataDir();
  const rules = loadRules();
  const ctx = () => loadContext({ dir, config: rules.config });

  if (cmd === 'init') {
    if (!existsSync(join(dir, 'senders.json'))) writeJson(join(dir, 'senders.json'), { _note: 'Fill every field. A sender with a [CONFIRM] placeholder blocks all sending.', senders: [{ id: 'principal-1', name: '[CONFIRM: name]', title: '[CONFIRM: title]', phone: '[CONFIRM: phone]', address: '[CONFIRM: street address]', mailbox: '[CONFIRM: mailbox]' }] });
    if (!existsSync(join(dir, 'suppression.json'))) writeJson(join(dir, 'suppression.json'), { entries: [] });
    if (!existsSync(join(dir, 'accounts', 'example-bank.json'))) writeJson(join(dir, 'accounts', 'example-bank.json'), { id: 'example-bank', name: 'Example Community Bank', aliases: [], type: 'bank', sectors: ['hospitality'], tier: 'A', person: { name: 'Jordan Sample', title: 'Chief Credit Officer', email: '', phone: '', phoneType: '', timezone: 'America/Chicago', mailingAddress: '' }, contact: { emailStatus: 'unverified', roleConfirmed: false, provenance: [] }, notes: 'INVENTED EXAMPLE. Replace with a real account chosen by a principal.', knownFacts: [] });
    return out(`Data folder ready: ${dir}\nNext: fill senders.json, add accounts/<id>.json for the accounts a principal chose, then: outbound status`);
  }

  if (cmd === 'status') {
    const c = ctx();
    const accts = listFiles(join(dir, 'accounts'), '.json').map((f) => f.replace(/\.json$/, ''));
    const incomplete = c.senders.filter((s) => Object.values(s).some((v) => /\[confirm/i.test(String(v))));
    return out({ dataDir: dir, killSwitch: !!(rules.config.killSwitch || c.kill), senders: c.senders.length, sendersIncomplete: incomplete.map((s) => s.id), accounts: accts.length,
      researched: accts.filter((a) => existsSync(join(dir, 'research', `${a}.json`))), touchesLogged: c.touches.filter((t) => t.type === 'touch').length, suppressionEntries: c.suppression.length,
      readyToSend: !incomplete.length && c.senders.length > 0 && !rules.config.killSwitch && !c.kill });
  }

  if (cmd === 'research' && (sub === 'run' || sub === 'show')) {
    const id = need(flags, 'account');
    if (sub === 'show') { const p = join(dir, 'briefs', `${id}.md`); return out(existsSync(p) ? readFileSync(p, 'utf8') : `No brief yet for ${id}.`); }
    const account = loadAccount(dir, id);
    const client = flags['dry-run'] ? null : await makeClient({ timeout: rules.models.research.timeoutMs });
    const r = await runBriefer({ client, dir, account, models: rules.models, playbooks: rules.playbooks, dryRun: !!flags['dry-run'] });
    if (r.dryRun) return out(`--- SYSTEM ---\n${r.system}\n\n--- USER ---\n${r.user}\n\n--- TOOLS ---\nweb_search (max ${r.cfg.maxSearches}), web_fetch (max ${r.cfg.maxFetches}), model ${r.cfg.model}, effort ${r.cfg.effort}`);
    return out(r);
  }

  if (cmd === 'account' && sub === 'confirm-role') {
    const id = need(flags, 'account'); const by = need(flags, 'by');
    const a = loadAccount(dir, id);
    a.contact = { ...(a.contact ?? {}), roleConfirmed: true, roleConfirmedBy: by, roleConfirmedAt: new Date().toISOString() };
    writeJson(join(dir, 'accounts', `${id}.json`), a);
    audit(dir, { type: 'role_confirmed', accountId: id, by });
    return out(`Role confirmed for ${a.person?.name} at ${a.name} by ${by}.`);
  }

  if (cmd === 'draft') {
    const id = need(flags, 'account'); const channel = need(flags, 'channel');
    const account = loadAccount(dir, id);
    const c = ctx();
    const sentCount = c.touches.filter((t) => t.accountId === id && t.type === 'touch').length;
    const step = Number(flags.step ?? sentCount + 1);
    if (sub === 'show') { const p = join(dir, 'drafts', id, `${step}-${channel}.md`); return out(existsSync(p) ? readFileSync(p, 'utf8') : 'No such draft.'); }
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
    if (sub === 'record') return out(recordTouch(dir, t, c));
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
