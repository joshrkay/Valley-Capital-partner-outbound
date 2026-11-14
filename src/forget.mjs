// A deletion request (PRD E7-S3). A principal, with --by and a reason, removes a person from every record in the data folder that can
// hold them, keeps a suppression entry as hashes (never the name or the address) so they are never contacted or named again, and logs
// the removal with counts only. Every store that can hold a person, and how it is handled:
//
//   accounts/       the person's fields, sources, verification and role are cleared on every account that holds them (the same address,
//                   or the same name at the same institution); their name leaves people lists; other text is redacted. The account keeps
//                   the institution's own data and a `forgotten` record (who, when, the reason redacted).
//   research/       person findings about them, and the findings their fields were sourced from, are removed with their pages; ids
//                   that pointed at them are dropped; other text is redacted. briefs/ is rebuilt from the scrubbed research.
//   facts/          the same findings are removed; other text is redacted.
//   drafts/         a draft that names them is emptied to a record of its step, channel, dates and approval, and cannot be approved.
//   calls/          notes, call briefs, proposals and follow-ups are redacted; they leave every people list.
//   pilot/          truth sheets are redacted; review verdicts on removed findings are dropped.
//   contacts/       they leave the known list (contacts/known.json); vendor reports hold refs only, and are redacted all the same.
//   network/        the firm's network can hold them if the firm knows them: their entry (their name at their institution, or their address
//                   or phone anywhere) is removed, with every route and choice that used it (src/routes.mjs dropNetworkEntries).
//   routes/         a routes file that names them (a target, the direct route's person or candidates, a reasoning line, a checklist) is
//                   rebuilt from the scrubbed research and network (src/routes.mjs buildRoutes); a choice whose route named them goes.
//   touches.jsonl   a value that mentions them becomes "[removed]". The event itself (type, account, institution, date) stays: a reply or
//                   an opt-out must keep stopping the sequence. outcomes.jsonl the same (it holds no names by design).
//   suppression.json  plain entries for their address or name become hashes; hashed entries for the address and for the name at this
//                   institution are added.
//   audit.jsonl     never rewritten: it holds ids, codes and counts. One line records the removal: the account, who, when, counts.
//
// How a mention is found. Their address, phone and street address identify them anywhere. Their full name identifies them in the records
// of their own institution (any account there). A first or last name alone is redacted only in their own account's file, drafts and call
// records, where it can only mean them. A name in another institution's records may be someone else, and is left alone.
import { join } from 'node:path';
import { readJson, writeJson, readText, writeText, listFiles, audit, safeId, redactJsonl, REDACTED } from './store.mjs';
import { norm, normName, nameTokens, emailHashes, nameHashes, personHashes, suppressedEmail, suppressedPerson } from './guard.mjs';
import { renderBrief } from './research.mjs';
import { instKey } from './vendors.mjs';
import { LOADS, withUnitOfWork, snapshotFromDir, applyPlanToDir } from './uow.mjs';
import { buildRoutes, dropNetworkEntries, renderRoutes, writeRoutes, validateRoutesRules } from './routes.mjs';
import { networkPath } from './network.mjs';
import { loadRules } from './rules.mjs';

const need = (v, what) => { const s = String(v ?? '').trim(); if (!s || s === 'true') throw new Error(`${what} is required.`); return s; };
const str = (v) => (typeof v === 'string' ? v.trim() : '');
const lower = (v) => str(v).toLowerCase();
const ymd = (d) => new Date(d).toISOString().slice(0, 10);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const EMPTY_PERSON = Object.freeze({ name: '', title: '', email: '', phone: '', phoneType: '', timezone: '', mailingAddress: '' });

// ---- Finding a person in text ---------------------------------------------------------------------------------------------------
// Levels: 'contact' (address, phone, street address), 'strong' (those and the full name, as written, reversed, or as a page slug), and
// 'weak' (those and a first or last name alone, capitalized, unless the word is part of the institution's own name).
export function personMatcher({ name = '', email = '', phone = '', mailingAddress = '' }, { institutionNames = [] } = {}) {
  const toks = nameTokens(name);
  const instToks = new Set(institutionNames.flatMap((n) => norm(n).split(' ')).filter(Boolean));
  const contact = [];
  if (lower(email)) contact.push(`(?<![A-Za-z0-9._%+-])${esc(lower(email))}(?![A-Za-z0-9-])`);
  const digits = String(phone ?? '').replace(/\D/g, '');
  if (digits.length >= 7) contact.push(`(?<!\\d)${digits.split('').join('[\\s().+-]{0,3}')}(?!\\d)`);
  const addr = String(mailingAddress ?? '').trim().replace(/\s+/g, ' ');
  if (addr.length >= 8) contact.push(addr.split(' ').map(esc).join('\\s+'));
  const names = [];
  const gap = '(?:[\\W_]{1,3}[a-z]\\.?)?[\\W_]{0,3}';   // a space, a hyphen, an underscore, nothing ("jordansample"), or a middle initial
  if (toks.length >= 2) {
    names.push(`(?<![a-z0-9])${toks.map(esc).join(gap)}(?![a-z0-9])`);
    names.push(`(?<![a-z0-9])${esc(toks.at(-1))},?\\s+${toks.slice(0, -1).map(esc).join(gap)}(?![a-z0-9])`);   // "Sample, Jordan"
  } else if (toks.length === 1) names.push(`(?<![a-z0-9])${esc(toks[0])}(?![a-z0-9])`);
  const single = toks.filter((t) => !instToks.has(t)).map((t) => `(?<![A-Za-z0-9])(?:${esc(t[0].toUpperCase() + t.slice(1))}|${esc(t.toUpperCase())})(?![A-Za-z0-9])`);
  const mk = (srcs, flags) => srcs.map((s) => new RegExp(s, flags));
  const sets = {
    contact: mk(contact, 'gi'),
    strong: [...mk(contact, 'gi'), ...mk(names, 'gi')],
    weak: [...mk(contact, 'gi'), ...mk(names, 'gi'), ...mk(single, 'g')],
  };
  const tests = Object.fromEntries(Object.entries(sets).map(([k, rs]) => [k, rs.map((r) => new RegExp(r.source, r.flags.replace('g', '')))]));
  const full = normName(name);
  return {
    redact: (text, level) => sets[level].reduce((t, re) => t.replace(re, REDACTED), String(text)),
    mentions: (text, level) => tests[level].some((re) => re.test(String(text))),
    // A person record (a people list entry, a known-list row) is about them: their address, or their name (by level).
    isName(s, level) {
      if (level === 'contact' || !full) return false;
      if (normName(s) === full) return true;
      if (level !== 'weak') return false;
      const ts = nameTokens(s);
      return ts.length > 0 && ts.every((t) => toks.includes(t) && !instToks.has(t));
    },
    isEmail: (s) => !!lower(email) && lower(s) === lower(email),
  };
}

// Keys whose values are codes, ids, dates or a principal's name: never redacted.
const SKIP = /^(by|id|accountId|account|institutionKey|key|date|ts|status|type|kind|channel|sender|code|codes|verdict|method|field|step|source|ref|notesDigest)$|By$|At$|On$/;
const about = (o, m, level) => !!o && typeof o === 'object' && !Array.isArray(o) && ((typeof o.email === 'string' && m.isEmail(o.email)) || (typeof o.name === 'string' && m.isName(o.name, level)));

// Redacts every string in a JSON value, and drops any array element that is a record of the person (or that `drop` names).
function scrub(value, m, level, drop = () => false) {
  const walk = (x, key) => {
    if (typeof x === 'string') return key && SKIP.test(key) ? x : m.redact(x, level);
    if (Array.isArray(x)) return x.filter((e) => !about(e, m, level) && !drop(e)).map((e) => walk(e, key));
    if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, walk(v, k)]));
    return x;
  };
  return walk(value, null);
}
const mentionsDeep = (value, m, level) => {
  const walk = (x, key) => (typeof x === 'string' ? !(key && SKIP.test(key)) && m.mentions(x, level) : Array.isArray(x) ? x.some((e) => about(e, m, level) || walk(e, key)) : x && typeof x === 'object' ? Object.entries(x).some(([k, v]) => walk(v, k)) : false);
  return walk(value, null);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const subfolders = (dir, rel) => listFiles(join(dir, rel), '').filter((n) => /^[a-z0-9][a-z0-9_-]{0,63}$/.test(n));
const findingText = (f) => [f.claim, f.quote, f.source_title, f.source_url].map((x) => String(x ?? '')).join(' \n ');

// A log line: a top-level value that mentions them becomes "[removed]", whole. The keys the guard and the outcomes report rely on never
// change; the database refuses a redaction that touches them (supabase/migrations/20261114200000_log_redaction.sql).
export const PROTECTED_LOG_KEYS = Object.freeze(['type', 'accountId', 'institution', 'date', 'id', 'ref']);
const redactLine = (line, m, level) => (line && typeof line === 'object' && !Array.isArray(line)
  ? Object.fromEntries(Object.entries(line).map(([k, v]) => [k, PROTECTED_LOG_KEYS.includes(k) || !mentionsDeep({ [k]: v }, m, level) ? v : REDACTED]))
  : line);

// ---- The deletion -----------------------------------------------------------------------------------------------------------------
// `confirm` is the account's name, typed by the principal. `name` and `email` name a person who is no longer on the account; by default
// it is the account's own person.
// `rules` (loadRules()) rebuilds the routes; it is loaded here when not given.
export function forgetPerson({ dir, id, by, reason, confirm, name, email, rules, now = new Date() }) {
  const who = need(by, 'A name for who made the request (--by)');
  const why = need(reason, 'A reason');
  safeId(id);
  const acct = readJson(join(dir, 'accounts', `${id}.json`), null);
  if (!acct) throw new Error(`No account "${id}".`);
  if (!str(confirm) || norm(confirm) !== norm(acct.name)) throw new Error(`To forget a person, type the account's name exactly as it is (${acct.name}) to confirm.`);
  // The routes are rebuilt with the committed rules (routes.json). They are checked before anything is written, so an error in the rule
  // file stops the deletion before it starts, never halfway.
  let ruleSet = rules ?? null;
  const routeRules = () => (ruleSet ??= loadRules());
  if (listFiles(join(dir, 'routes'), '.json').length) {
    const errs = validateRoutesRules(routeRules().routes);
    if (errs.length) throw new Error(`routes.json has errors, and the routes must be rebuilt without the person. Nothing was changed:\n  ${errs.join('\n  ')}`);
  }
  const cur = acct.person ?? {};
  const explicit = !!(str(name) || str(email));
  const isCurrent = !explicit || (!!str(name) && normName(name) === normName(cur.name)) || (!!lower(email) && lower(email) === lower(cur.email));
  const target = {
    name: explicit ? str(name) || (isCurrent ? str(cur.name) : '') : str(cur.name),
    email: explicit ? lower(email) || (isCurrent ? lower(cur.email) : '') : lower(cur.email),
    phone: isCurrent ? str(cur.phone) : '',
    mailingAddress: isCurrent ? str(cur.mailingAddress) : '',
  };
  if (!target.name && !target.email) throw new Error(`${acct.name} has no named person to forget. To forget someone no longer on the account, give their name and address (--name, --email).`);

  const instNames = [acct.name, ...(acct.aliases ?? []), acct.institutionKey].filter(Boolean);
  const instSet = new Set(instNames.map(norm));
  const m = personMatcher(target, { institutionNames: instNames });
  const at = now.toISOString();
  const accounts = listFiles(join(dir, 'accounts'), '.json').map((f) => readJson(join(dir, 'accounts', f), null)).filter((a) => a && typeof a.id === 'string');
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const sameInst = (a) => a.id === id || (!!acct.institutionKey && a.institutionKey === acct.institutionKey) || [a.name, ...(a.aliases ?? [])].some((n) => instSet.has(norm(n)));
  const isPersonOf = (a) => { const p = a.person ?? {}; return (!!target.email && lower(p.email) === target.email) || (!!target.name && normName(p.name) === normName(target.name) && sameInst(a)); };
  // How hard to look in a store of one account: its own file, drafts and calls (weak); its institution (strong); elsewhere (contact).
  const level = (aid, own = false) => (aid === id && own ? 'weak' : !byId.has(aid) ? 'strong' : sameInst(byId.get(aid)) ? 'strong' : 'contact');
  const counts = { accounts: 0, research: 0, facts: 0, briefs: 0, drafts: 0, calls: 0, pilot: 0, touches: 0, outcomes: 0, suppression: 0, contacts: 0, routes: 0, network: 0 };
  const write = (store, path, before, after, text = false) => { if (text ? before === after : same(before, after)) return; text ? writeText(path, after) : writeJson(path, after); counts[store]++; };

  // Accounts, computed first: the briefs are rebuilt from them. Written last.
  const nextAccounts = new Map();
  for (const a of accounts) {
    let next = structuredClone(a);
    if (isPersonOf(a)) { next.person = { ...EMPTY_PERSON }; next.contact = { emailStatus: 'unverified', roleConfirmed: false, provenance: [], verification: null }; }
    next = scrub(next, m, level(a.id, true));
    if (a.id === id) next.forgotten = [...(a.forgotten ?? []), { at, by: who, reason: m.redact(why, 'weak').slice(0, 300) }];
    nextAccounts.set(a.id, next);
  }

  // Research, facts and briefs. The findings to remove: person findings that mention them, and the findings their fields came from.
  const removed = new Map();   // account id -> finding ids removed
  for (const f of listFiles(join(dir, 'research'), '.json')) {
    const aid = f.replace(/\.json$/, '');
    const rec = readJson(join(dir, 'research', f), null);
    if (!rec || typeof rec !== 'object') continue;
    const lv = level(aid);
    const owner = byId.get(aid);
    const sources = new Set((owner && isPersonOf(owner) ? owner.contact?.provenance ?? [] : []).filter((p) => p?.kind === 'brief_finding' && p.findingId).map((p) => `${p.findingId}|${p.url ?? ''}`));
    const findings = Array.isArray(rec.findings) ? rec.findings : [];
    const drop = new Set(findings.filter((x) => sources.has(`${x.id}|${x.source_url ?? ''}`) || (x.kind === 'person' && m.mentions(findingText(x), lv))).map((x) => x.id));
    removed.set(aid, drop);
    const kept = findings.filter((x) => !drop.has(x.id));
    const cited = new Set(kept.flatMap((x) => [x.source_url, ...(x.corroborated_by ?? [])]));
    const gone = new Set(findings.filter((x) => drop.has(x.id)).map((x) => x.source_url).filter((u) => u && !cited.has(u)));
    const ids = (v) => (Array.isArray(v) ? v.filter((i) => !drop.has(i)) : v);
    const pre = structuredClone({ ...rec, findings: kept });
    for (const k of ['personCheck', 'riskScreen', 'angle']) if (pre[k] && typeof pre[k] === 'object') pre[k].finding_ids = ids(pre[k].finding_ids);
    if (pre.angle && Array.isArray(pre.angle.finding_ids) && drop.size) pre.angle.supported = pre.angle.finding_ids.length > 0;
    if (Array.isArray(pre.contradictions)) pre.contradictions = pre.contradictions.map((c) => ({ ...c, finding_ids: ids(c.finding_ids) }));
    if (pre.run && typeof pre.run === 'object') {
      if (Array.isArray(pre.run.sourceList)) pre.run.sourceList = pre.run.sourceList.filter((s) => !gone.has(s?.url));
      if (Array.isArray(pre.run.fetches)) pre.run.fetches = pre.run.fetches.filter((u) => !gone.has(u));
    }
    const clean = scrub(pre, m, lv);
    write('research', join(dir, 'research', f), rec, clean);

    const factsPath = join(dir, 'facts', `${aid}.json`);
    const facts = readJson(factsPath, null);
    if (Array.isArray(facts)) write('facts', factsPath, facts, scrub(facts.filter((x) => !drop.has(String(x?.id ?? '').split(':').pop()) && !(x?.kind === 'person' && m.mentions(findingText({ ...x, source_url: x.url }), lv))), m, lv));

    const briefPath = join(dir, 'briefs', `${aid}.md`);
    const brief = readText(briefPath, null);
    if (brief !== null) {
      let next = m.redact(brief, lv);
      if (!same(rec, clean) && Array.isArray(clean.findings) && clean.run) {
        try { next = m.redact(renderBrief({ account: nextAccounts.get(aid) ?? { name: aid, person: {}, type: '' }, today: clean.date ?? '', result: clean, run: clean.run }), lv); } catch { /* an older record shape: the redacted brief stands */ }
      }
      write('briefs', briefPath, brief, next, true);
    }
  }
  // A brief with no research record.
  for (const f of listFiles(join(dir, 'briefs'), '.md')) {
    const aid = f.replace(/\.md$/, '');
    if (removed.has(aid)) continue;
    const p = join(dir, 'briefs', f); const t = readText(p, null);
    if (t !== null) write('briefs', p, t, m.redact(t, level(aid)), true);
  }

  // Drafts: a draft that names them is emptied. It kept the message to them; what stays is which step went out, and who approved it.
  for (const aid of subfolders(dir, 'drafts')) {
    const lv = level(aid, true);
    const base = join(dir, 'drafts', aid);
    const done = new Set();
    for (const f of listFiles(base, '.json')) {
      const rec = readJson(join(base, f), null);
      if (!rec || rec.status === 'forgotten') continue;
      const md = f.replace(/\.json$/, '.md');
      const mdText = readText(join(base, md), null);
      if (!mentionsDeep(rec, m, lv) && !(mdText !== null && m.mentions(mdText, lv))) continue;
      write('drafts', join(base, f), rec, { account: rec.account, channel: rec.channel, step: rec.step, sender: rec.sender, date: rec.date, status: 'forgotten', statusBefore: rec.status ?? null, claimsUsed: rec.claimsUsed ?? [], factsUsed: rec.factsUsed ?? [], createdAt: rec.createdAt ?? null, approvedBy: rec.approvedBy ?? null, approvedAt: rec.approvedAt ?? null, forgottenAt: at, forgottenBy: who });
      if (mdText !== null) write('drafts', join(base, md), mdText, tombstone(aid, rec.channel, rec.step, at), true);
      done.add(md);
    }
    for (const md of listFiles(base, '.md')) {
      if (done.has(md)) continue;
      const t = readText(join(base, md), null);
      if (t !== null && m.mentions(t, lv)) { const [, step, channel] = md.match(/^(\d+)-(.+)\.md$/) ?? []; write('drafts', join(base, md), t, tombstone(aid, channel ?? '', step ?? '', at), true); }
    }
  }

  // Calls: notes, briefs, proposals and follow-ups of every account.
  for (const aid of subfolders(dir, 'calls')) {
    const lv = level(aid, true);
    for (const rel of [join('calls', aid), join('calls', aid, 'proposals')]) {
      for (const f of listFiles(join(dir, rel), '.json')) { const p = join(dir, rel, f); const v = readJson(p, null); if (v !== null) write('calls', p, v, scrub(v, m, lv)); }
      for (const f of listFiles(join(dir, rel), '.md')) { const p = join(dir, rel, f); const t = readText(p, null); if (t !== null) write('calls', p, t, m.redact(t, lv), true); }
    }
  }

  // The pilot: truth sheets and reviews. A verdict on a removed finding goes with it.
  for (const f of listFiles(join(dir, 'pilot'), '.json')) {
    const p = join(dir, 'pilot', f);
    const v = readJson(p, null);
    if (!v || typeof v !== 'object') continue;
    const aid = (f.match(/^(.+)\.(truth|review)\.json$/) ?? [])[1] ?? null;
    let next = structuredClone(v);
    if (aid && next.verdicts && typeof next.verdicts === 'object') for (const fid of removed.get(aid) ?? []) delete next.verdicts[fid];
    next = scrub(next, m, aid ? level(aid) : 'strong');
    write('pilot', p, v, next);
  }

  // The known list for vendor tests: their row goes (their address, or their name at this institution). Reports hold refs only.
  const knownPath = join(dir, 'contacts', 'known.json');
  const known = readJson(knownPath, null);
  if (known && typeof known === 'object') {
    const ours = new Set(instNames.map(instKey).filter(Boolean));
    const keep = (k) => !(k && typeof k === 'object' && ((!!target.email && lower(k.email) === target.email) || (!!target.name && normName(k.name) === normName(target.name) && ours.has(instKey(k.institution)))));
    const list = Array.isArray(known) ? known : known.people;
    if (Array.isArray(list)) {
      const kept = scrub(list.filter(keep), m, 'contact');
      write('contacts', knownPath, known, Array.isArray(known) ? kept : { ...known, people: kept });
    }
  }
  for (const f of listFiles(join(dir, 'contacts', 'vendor-tests'), '.json')) { const p = join(dir, 'contacts', 'vendor-tests', f); const v = readJson(p, null); if (v !== null) write('contacts', p, v, scrub(v, m, 'strong')); }
  for (const f of listFiles(join(dir, 'contacts', 'vendor-tests'), '.md')) { const p = join(dir, 'contacts', 'vendor-tests', f); const t = readText(p, null); if (t !== null) write('contacts', p, t, m.redact(t, 'strong'), true); }

  // The logs. A line of their own account: weak; their institution: strong; elsewhere: contact details only.
  const lineLevel = (l) => (l?.accountId === id ? 'weak' : byId.has(l?.accountId) ? level(l.accountId) : l && instSet.has(norm(l.institution)) ? 'strong' : 'contact');
  counts.touches = redactJsonl(join(dir, 'touches.jsonl'), (l) => redactLine(l, m, lineLevel(l)));
  counts.outcomes = redactJsonl(join(dir, 'outcomes.jsonl'), (l) => redactLine(l, m, lineLevel(l)));

  // Suppression: hashes only. A plain entry for their address or name becomes the same entry as hashes, keeping its reason and date.
  const supPath = join(dir, 'suppression.json');
  const sup = readJson(supPath, { entries: [] });
  const entries = (sup.entries ?? []).map((e) => {
    if (e?.type === 'email' && e.value && target.email && lower(e.value) === target.email) { const { value, ...rest } = e; return { ...rest, reason: m.redact(rest.reason ?? '', 'strong'), hashes: emailHashes(target.email), hashedAt: at }; }
    if (e?.type === 'person' && e.value && target.name && normName(e.value) === normName(target.name)) { const { value, ...rest } = e; return { ...rest, reason: m.redact(rest.reason ?? '', 'strong'), hashes: nameHashes(target.name), hashedAt: at }; }
    return e;
  });
  if (target.email && !suppressedEmail(entries, target.email)) entries.push({ type: 'email', hashes: emailHashes(target.email), reason: 'deletion_request', added: ymd(at) });
  if (target.name && !suppressedPerson(entries, target.name, instNames)) entries.push({ type: 'person', hashes: personHashes(target.name, instNames), reason: 'deletion_request', added: ymd(at) });
  write('suppression', supPath, sup, { ...sup, entries });

  for (const a of accounts) write('accounts', join(dir, 'accounts', `${a.id}.json`), a, nextAccounts.get(a.id));

  // The firm's network and the routes (PRD E22), after the accounts: a routes file is rebuilt from the accounts, research and network
  // as they now stand. Counted per file changed, the json and the md each.
  const routesBefore = routesFiles(dir);
  const ours = new Set(instNames.map(instKey).filter(Boolean));
  const atInst = (org) => !!str(org) && (instSet.has(norm(org)) || ours.has(instKey(org)));
  // The network (network/network.json) can hold them if the firm knows them: their entry (their name at their institution, or their
  // address or phone anywhere) is removed, and every route and choice that used it goes with it, as when a principal removes an entry.
  // Every other entry is redacted like any record: strongly at their institution, for their contact details elsewhere.
  const netPath = networkPath(dir);
  const net = readJson(netPath, null);
  if (net && typeof net === 'object') {
    const people = net.people && typeof net.people === 'object' ? net.people : {};
    const isThem = (p) => !!p && typeof p === 'object' && (mentionsDeep(p, m, 'contact') || (atInst(p.organization) && [p.name, ...(Array.isArray(p.aliases) ? p.aliases : [])].some((n) => typeof n === 'string' && m.isName(n, 'strong'))));
    const gone = Object.keys(people).filter((k) => isThem(people[k]));
    const keep = Object.fromEntries(Object.entries(people).filter(([k]) => !gone.includes(k)).map(([k, p]) => [k, scrub(p, m, atInst(p?.organization) ? 'strong' : 'contact')]));
    write('network', netPath, net, { ...net, people: keep, ...(net.firms ? { firms: scrub(net.firms, m, 'contact') } : {}), ...(net.memberships ? { memberships: scrub(net.memberships, m, 'contact') } : {}) });
    if (gone.length) dropNetworkEntries({ dir, removed: gone.map((k) => ({ id: k, bucket: 'people' })), now, reason: CHOICE_REMOVED });
  }
  // The routes (routes/<account>.json and .md) hold lender-side names: targets, the direct route's person and candidates, reasoning
  // lines, checklists. A file that still mentions them (at its account's level, as for research) is rebuilt from the scrubbed research
  // and network by the routes' own code (buildRoutes: code only, no model), so it says only what the records now say. A choice whose
  // route named them is removed, saying so. A routes file whose account is gone is redacted instead.
  for (const f of listFiles(join(dir, 'routes'), '.json')) {
    const aid = f.replace(/\.json$/, '');
    const p = join(dir, 'routes', f), mdPath = join(dir, 'routes', `${aid}.md`);
    const rec = readJson(p, null);
    if (!rec || typeof rec !== 'object') continue;
    const lv = level(aid);
    const md = readText(mdPath, null);
    if (!mentionsDeep(rec, m, lv) && !(md !== null && m.mentions(md, lv))) continue;
    const rebuildable = /^[a-z0-9][a-z0-9_-]{0,63}$/.test(aid) && byId.has(aid) && readJson(join(dir, 'accounts', `${aid}.json`), null)?.id === aid;
    if (!rebuildable) { const next = scrub(rec, m, lv); writeJson(p, next); writeText(mdPath, renderRoutes(next)); continue; }
    const named = new Set([...(rec.routes ?? []), ...(rec.held ?? [])].filter((r) => r?.type !== 'direct' && mentionsDeep(r, m, lv)).map((r) => r.id));
    const built = buildRoutes({ dir, id: aid, rules: routeRules(), now, auditLine: false });
    const live = new Set([...built.routes, ...built.held].map((r) => r.id));
    if (built.chosen && !live.has(built.chosen.routeId) && named.has(built.chosen.routeId)) {
      built.chosen = null;
      built.choiceRemoved = { at, reason: CHOICE_REMOVED };
    }
    built.choices = (built.choices ?? []).filter((c) => live.has(c.routeId) || !named.has(c.routeId));
    writeRoutes(dir, built);
  }
  const routesAfter = routesFiles(dir);
  counts.routes = [...new Set([...Object.keys(routesBefore), ...Object.keys(routesAfter)])].filter((k) => routesBefore[k] !== routesAfter[k]).length;

  audit(dir, { type: 'person_forgotten', accountId: id, by: who, at, counts });
  return { accountId: id, counts };
}

const CHOICE_REMOVED = 'A deletion request removed a person it used, so the choice was removed with it.';
// Every routes file, json and md, as text: to count what a deletion changed there.
const routesFiles = (dir) => Object.fromEntries(listFiles(join(dir, 'routes'), '').filter((n) => /\.(json|md)$/.test(n))
  .map((n) => [n, n.endsWith('.json') ? JSON.stringify(readJson(join(dir, 'routes', n), null)) : readText(join(dir, 'routes', n), null)]));

function tombstone(aid, channel, step, at) {
  return `---\naccount: ${aid}\nchannel: ${channel}\nstep: ${step}\nstatus: forgotten\n---\n\nRemoved on a deletion request on ${ymd(at)}. Nothing of the message is kept. Draft it again for another person.\n`;
}

// The command line's run: a unit of work over the folder, so every store is scrubbed in memory first and nothing is written if any step
// fails. The platform runs forgetPerson in a unit of work with the same load list (LOADS.forget) and writes it in one transaction.
export async function forgetInFolder({ dir, ...args }) {
  const { result } = await withUnitOfWork({ load: async (prefixes) => snapshotFromDir(dir, prefixes), flush: async (plan) => applyPlanToDir(plan, dir) }, LOADS.forget, (root) => forgetPerson({ dir: root, ...args }));
  return result;
}
