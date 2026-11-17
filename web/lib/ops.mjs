// Server only. Every read and action the screens offer, written against the engine and a platform client (src/platform/client.mjs),
// with no framework code, so each can be tested against a fake Supabase REST API. Quick actions run the engine's own function in a
// unit of work; long work (research, drafting, data pulls, scoring) is queued for the worker, never run here (PRD E12-S4, E12-S5).
import { join } from 'node:path';
import { engine, loadRules } from './engine.mjs';
import { visibleCandidates } from './candidates-view.mjs';
import { sortServicers, loansFor, edgarStatus } from './servicers.mjs';
import { partyLink, sellerRow } from './sales-view.mjs';

const today = () => new Date().toISOString().slice(0, 10);
const need = (v, what) => { const s = typeof v === 'string' ? v.trim() : ''; if (!s) throw new Error(`${what} is required.`); return s; };
const mods = async () => {
  const [uow, store, candidates, pilot, guard, draft, paper] = await Promise.all(['src/uow.mjs', 'src/store.mjs', 'src/candidates.mjs', 'src/pilot.mjs', 'src/guard.mjs', 'src/draft.mjs', 'src/paper.mjs'].map(engine));
  return { LOADS: uow.LOADS, store, candidates, pilot, guard, draft, paper };
};
const suppressionIn = (store, dir) => store.readJson(join(dir, 'suppression.json'), { entries: [] }).entries ?? [];

// ---- Candidates ---------------------------------------------------------------------------------------------------------------
// tier: 'A' | 'B' | 'all'; anything else means A and B, like the command line's default.
export async function listCandidates(client, { tier, metro } = {}) {
  const { candidates } = await mods();
  const one = tier === 'A' || tier === 'B' ? tier : undefined;
  let rows = await client.candidates({ tier: one, metro: metro || undefined, limit: 1000 });
  if (!one && tier !== 'all') rows = rows.filter((r) => r.tier === 'A' || r.tier === 'B');
  const snap = await client.load(['suppression.json', 'candidates/decisions.json', 'candidates/aliases.json']);
  const decisions = snap.docs['candidates/decisions.json'] ?? {};
  const signals = new Map();
  for (const r of rows.filter((x) => decisions[x.key]?.status === 'dismissed')) signals.set(r.key, (await client.candidate(r.key))?.signals ?? []);
  return visibleCandidates({
    rows, suppression: snap.docs['suppression.json']?.entries ?? [], decisions, aliases: snap.docs['candidates/aliases.json'] ?? {},
    suppressedBy: candidates.suppressedBy, signalsFor: (k) => signals.get(k) ?? [], today: today(),
  });
}

// The candidate, its decision, and its paper estimate (PRD E14-S1): one document, paper/fdic-<CERT>.json, read with the principal's own
// token like every other document, so row-level security decides. Only that one record is loaded, never the whole paper/ folder.
export async function candidateDetail(client, key) {
  const item = await client.candidate(need(key, 'A candidate key'));
  if (!item) return null;
  const { candidates, paper } = await mods();
  let rel = null;
  try { rel = paper.paperRel(key); } catch { rel = null; }   // not a bank key: no record
  const snap = await client.load(['suppression.json', 'candidates/decisions.json', 'candidates/aliases.json', ...(rel ? [rel] : [])]);
  const suppressed = !!candidates.suppressedBy(item, snap.docs['suppression.json']?.entries ?? [], snap.docs['candidates/aliases.json'] ?? {});
  return { item, decision: (snap.docs['candidates/decisions.json'] ?? {})[key] ?? null, suppressed, paper: rel ? snap.docs[rel] ?? null : null };
}

export async function promote(client, { key, by }) {
  const { LOADS, store, candidates } = await mods();
  const { result } = await client.unitOfWork(LOADS.candidates, (dir) => candidates.promote({ dir, key: need(key, 'A candidate key'), by, suppression: suppressionIn(store, dir) }));
  return { accountId: result.id, name: result.name, leadSector: result.pipeline?.leadSector ?? null, note: result.pipeline?.leadSectorNote ?? '' };
}

export async function dismiss(client, { key, by, reason }) {
  const { LOADS, candidates } = await mods();
  await client.unitOfWork(LOADS.candidates, (dir) => candidates.dismiss({ dir, key: need(key, 'A candidate key'), by, reason: need(reason, 'A reason') }));
}

export async function snooze(client, { key, by, until }) {
  const { LOADS, candidates } = await mods();
  await client.unitOfWork(LOADS.candidates, (dir) => candidates.snooze({ dir, key: need(key, 'A candidate key'), by, until: need(until, 'A date') }));
}

// ---- Accounts ---------------------------------------------------------------------------------------------------------------------
export async function listAccounts(client, rest) {
  const snap = await client.load(['accounts/']);
  const researched = new Map((await rest.get('documents', { select: 'path,updated_at', path: 'like.research/*', limit: 1000 })).map((d) => [d.path, d.updated_at]));
  return Object.values(snap.docs).filter((a) => a && a.id).sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id))
    .map((a) => ({ id: a.id, name: a.name, tier: a.tier ?? null, person: a.person?.name || null, roleConfirmed: !!a.contact?.roleConfirmed, fromPipeline: Array.isArray(a.originSignals) && a.originSignals.length > 0, researchedAt: researched.get(`research/${a.id}.json`) ?? null }));
}

// The account's name alone, for the page title: one document, read as the principal.
export async function accountName(client, id) {
  const { store } = await mods();
  store.safeId(need(id, 'An account id'));
  const a = (await client.load([`accounts/${id}.json`])).docs[`accounts/${id}.json`];
  return a ? (a.name ?? a.id ?? null) : null;
}

export async function accountDetail(client, id) {
  const { LOADS, store, pilot } = await mods();
  const rules = await loadRules();
  store.safeId(need(id, 'An account id'));   // checked before it becomes part of a path
  const own = [`accounts/${id}.json`, `briefs/${id}.md`, `research/${id}.json`, `drafts/${id}/`, 'pilot/status.json', 'regulatory/'];
  const regulatory = await engine('src/regulatory.mjs');
  const { result } = await client.unitOfWork(own, (dir) => {
    const account = store.readJson(join(dir, 'accounts', `${id}.json`), null);
    if (!account) return null;
    const research = store.readJson(join(dir, 'research', `${id}.json`), null);
    const drafts = store.listFiles(join(dir, 'drafts', id), '.json').map((f) => store.readJson(join(dir, 'drafts', id, f))).map((d) => ({ channel: d.channel, step: d.step, status: d.status, approvedBy: d.approvedBy }));
    return {
      account, brief: store.readText(join(dir, 'briefs', `${id}.md`), null),
      research: research ? { date: research.date, mode: research.mode ?? 'person', findings: research.findings?.length ?? 0, risk: research.riskScreen?.approach ?? null, person: research.personCheck?.status ?? null } : null,
      gate: pilot.researchGate({ dir, account, config: rules.config }), drafts,
      // Orders in force against the bank, each with whether a principal has confirmed seeing it (D-E3). For principals only.
      orders: regulatory.ordersInForce(dir, account.institutionKey).map((o) => ({ ...o, confirmation: (account.orderConfirmations ?? []).find((c) => c.order === o.id) ?? null })),
    };
  });
  return result;
}

// The engine's own functions (src/accounts.mjs), the same ones `outbound account set-person` and `confirm-role` call. Naming a person
// needs a source (PRD E7-S3): usually the brief's candidate finding. It reads that brief, the suppression list and the vendor passes.
export async function setPerson(client, { id, name, title, by, source }) {
  const [uow, accounts] = await Promise.all([engine('src/uow.mjs'), engine('src/accounts.mjs')]);
  await client.unitOfWork(uow.contactLoads('person', need(id, 'An account id')), (dir) => accounts.setPerson({ dir, id, name, title: typeof title === 'string' ? title : '', by, source: sourceOf(source) }));
}

// Confirming an enforcement order in force (D-E3): the same function `outbound account confirm-order` calls.
export async function confirmOrder(client, { id, order, by }) {
  const [{ LOADS }, accounts] = await Promise.all([engine('src/uow.mjs'), engine('src/accounts.mjs')]);
  const { result } = await client.unitOfWork(LOADS.orderConfirm, (dir) => accounts.confirmOrder({ dir, id: need(id, 'An account id'), order: need(order, 'An order'), by }));
  return { already: result.already, order: result.order };
}

export async function confirmRole(client, { id, by }) {
  const [{ LOADS }, accounts] = await Promise.all([engine('src/uow.mjs'), engine('src/accounts.mjs')]);
  await client.unitOfWork(LOADS.account, (dir) => accounts.confirmRole({ dir, id: need(id, 'An account id'), by }));
}

// ---- Contact details (PRD E7-S3) ------------------------------------------------------------------------------------------------
// Where a field came from, as a form gives it: a source kind, a brief finding id, a URL, a vendor, the date it was seen.
const str = (v) => (typeof v === 'string' ? v.trim() : '');
const sourceOf = (s) => (s && typeof s === 'object' ? { kind: str(s.kind), findingId: str(s.findingId), url: str(s.url), vendor: str(s.vendor), seenOn: str(s.seenOn) } : {});

// The account's contact view (each field's source, the address's state, the domains), the brief's candidate findings to name a person
// from, and the vendors with a recorded pass. Three documents, read as the principal.
export async function accountContact(client, id) {
  const [{ store }, accounts] = await Promise.all([mods(), engine('src/accounts.mjs')]);
  const rules = await loadRules();
  store.safeId(need(id, 'An account id'));
  const { result } = await client.unitOfWork([`accounts/${id}.json`, `research/${id}.json`, 'contacts/vendors.json'], (dir) => {
    const account = store.readJson(join(dir, 'accounts', `${id}.json`), null);
    if (!account) return null;
    const research = store.readJson(join(dir, 'research', `${id}.json`), null);
    const passes = store.readJson(join(dir, 'contacts', 'vendors.json'), { passes: {} }).passes ?? {};
    return {
      account: { id: account.id, name: account.name, person: account.person ?? {} },
      status: accounts.contactStatus(account, { config: rules.config }),
      candidates: (research?.findings ?? []).filter((f) => f.kind === 'person').map((f) => ({ id: f.id, claim: f.claim, url: f.source_url ?? '' })),
      vendors: Object.values(passes).filter((p) => p?.passed).map((p) => p.vendor),
      reverifyDays: rules.config.contacts?.reverifyDays ?? null,
    };
  });
  return result;
}

export async function setEmail(client, { id, email, by, source }) {
  const [uow, accounts] = await Promise.all([engine('src/uow.mjs'), engine('src/accounts.mjs')]);
  const rules = await loadRules();
  await client.unitOfWork(uow.contactLoads('person', need(id, 'An account id')), (dir) => accounts.setEmail({ dir, id, email, by, source: sourceOf(source), config: rules.config }));
}

export async function addDomain(client, { id, domain, by, source }) {
  const [uow, accounts] = await Promise.all([engine('src/uow.mjs'), engine('src/accounts.mjs')]);
  const rules = await loadRules();
  const { result } = await client.unitOfWork(uow.contactLoads('domain', need(id, 'An account id')), (dir) => accounts.addDomain({ dir, id, domain, by, source: sourceOf(source), config: rules.config }));
  return { sharedWith: result.sharedWith };
}

// The checks include one DNS lookup of the domain's MX record (no mail server is contacted). `resolveMx` is for tests.
export async function verifyEmail(client, { id, by, method, url, vendor, seen, resolveMx }) {
  const [uow, accounts] = await Promise.all([engine('src/uow.mjs'), engine('src/accounts.mjs')]);
  const rules = await loadRules();
  const { result } = await client.unitOfWork(uow.contactLoads('verify', need(id, 'An account id')), (dir) => accounts.verifyEmail({ dir, id, by, method: str(method), url: str(url), vendor: str(vendor), seen: str(seen), config: rules.config, ...(resolveMx ? { resolveMx } : {}) }));
  return { ok: result.ok, checks: result.checks };
}

// A deletion request (src/forget.mjs) loads every store that can hold a person and writes the scrubbed records, the log redactions and
// the suppression entry in one transaction. First it asks the database whether it can redact log lines at all: a database without the
// redaction migration would write the documents and silently leave the person in the touch log.
export async function forgetPerson(client, { id, by, reason, confirm }) {
  const [{ LOADS }, forget] = await Promise.all([engine('src/uow.mjs'), engine('src/forget.mjs')]);
  const rules = await loadRules();   // a routes file that names them is rebuilt with routes.json (PRD E22)
  need(id, 'An account id');
  const probe = await client.flush({ docs: [], lines: [] });
  if (typeof probe?.redacted !== 'number') throw new Error('The platform database has not run the redaction migration (20261114200000_log_redaction.sql), so a deletion request cannot reach the touch log. Nothing was changed. An operator runs the migration first.');
  const { result } = await client.unitOfWork(LOADS.forget, (dir) => forget.forgetPerson({ dir, id, by, reason, confirm, rules }));
  return result;
}

// Research is queued only if the pilot gate would let it run, so a principal hears "not yet" now rather than from a failed job.
export async function queueResearch(client, { id }) {
  const { LOADS, store, pilot } = await mods();
  const rules = await loadRules();
  const { result: gate } = await client.unitOfWork([...LOADS.account, 'pilot/'], (dir) => {
    const account = store.readJson(join(dir, 'accounts', `${need(id, 'An account id')}.json`), null);
    if (!account) throw new Error(`There is no account ${id}.`);
    return pilot.researchGate({ dir, account, config: rules.config });
  });
  if (!gate.allowed) throw new Error(gate.reason);
  return client.enqueue('research.run', { account: id });
}

export async function queueDraft(client, { id, channel, step }) {
  const rules = await loadRules();
  const ch = need(channel, 'A channel');
  if (!rules.config.channels.allowed.includes(ch)) throw new Error(`"${ch}" is not an allowed channel (${rules.config.channels.allowed.join(', ')}).`);
  const n = Number(step);
  if (!Number.isInteger(n) || n < 1) throw new Error('The step must be a whole number, 1 or more.');
  return client.enqueue('draft.run', { account: need(id, 'An account id'), channel: ch, step: n });
}

// ---- Calls (PRD E15) ------------------------------------------------------------------------------------------------------------
// The call brief and reading the notes are model work, so they are queued. Saving the notes, confirming and rejecting are quick, and run
// the engine's own functions (src/calls.mjs) in a unit of work as the signed-in principal. A job's parameters never hold note text.
export async function accountCalls(client, id) {
  const [{ store }, calls] = await Promise.all([mods(), engine('src/calls.mjs')]);
  store.safeId(need(id, 'An account id'));
  const { result } = await client.unitOfWork([`accounts/${id}.json`, `calls/${id}/`], (dir) => calls.listCalls({ dir, id }));
  return {
    ...result, latestBrief: result.briefs[0] ?? null, pending: result.proposals.filter((p) => p.status === 'pending'), latestFollowUp: result.followUps[0] ?? null,
    // What the correction form offers: the fixed list of outcome codes, and who a commitment can be for.
    codes: Object.entries(calls.OUTCOME_CODES).map(([code, help]) => ({ code, help })), who: [...calls.COMMITMENT_WHO],
  };
}

// The correction form, as the account page posts it (web/app/accounts/[id]/calls.jsx), turned into the engine's correction: a checkbox per
// outcome code, the "when" of not_selling_now and the "referral" of wrong_person, one objection per line, and numbered commitment rows
// (who.N, what.N, by.N; a row with no "what" is dropped). Every field is sent, so each is replaced whole. The engine checks the result.
export function proposalEditsFromForm(fd) {
  const get = (k) => str(fd.get(k) ?? '');
  const rows = Math.min(Math.max(Number.parseInt(get('commitmentRows'), 10) || 0, 0), 50);
  return {
    outcomes: fd.getAll('code').map((c) => str(c)).filter(Boolean).map((code) => ({ code, when: code === 'not_selling_now' ? get('when') : '', referral: code === 'wrong_person' ? get('referral') : '' })),
    objections: get('objections').split(/\r?\n/).map((s) => s.trim()).filter(Boolean),
    commitments: Array.from({ length: rows }, (_, i) => ({ who: get(`who.${i}`), what: get(`what.${i}`), by: get(`by.${i}`) })).filter((c) => c.what),
    followUpDate: get('followUpDate'),
  };
}

// A principal corrects a pending proposal (src/calls.mjs editProposal) before confirming it. `seenEdits` is how many corrections the
// form was made from, so a stale form never overwrites another principal's correction. Nothing is recorded until a principal confirms.
export async function editCall(client, { id, proposal, by, edits, seenEdits }) {
  const calls = await engine('src/calls.mjs');
  const { result } = await client.unitOfWork(calls.callLoads('callExtract', need(id, 'An account id')), (dir) => calls.editProposal({ dir, id, proposalId: need(proposal, 'A proposal'), by, edits, seenEdits }));
  return { proposalId: result.proposalId, fields: result.fields };
}

export async function queueCallPrep(client, { id, date }) {
  const [{ store }, calls] = await Promise.all([mods(), engine('src/calls.mjs')]);
  store.safeId(need(id, 'An account id'));
  return client.enqueue('call.prep', { account: id, date: calls.needDate(typeof date === 'string' && date.trim() ? date.trim() : today()) });
}

export async function logCallNotes(client, { id, date, notes, by }) {
  const calls = await engine('src/calls.mjs');
  const day = calls.needDate(need(date, 'The call date'));
  await client.unitOfWork(calls.callLoads('callNotes', need(id, 'An account id')), (dir) => calls.saveNotes({ dir, id, date: day, notes, by }));
  return client.enqueue('call.extract', { account: id, date: day, by });
}

// `seenEdits`: how many corrections the page showed when the principal pressed confirm. A proposal corrected since is not confirmed.
export async function confirmCall(client, { id, proposal, by, seenEdits }) {
  const calls = await engine('src/calls.mjs');
  const rules = await loadRules();
  const { result } = await client.unitOfWork(calls.callLoads('callConfirm', need(id, 'An account id')), (dir) => calls.confirmProposal({ dir, id, proposalId: need(proposal, 'A proposal'), by, rules, seenEdits }));
  return result;
}

export async function rejectCall(client, { id, proposal, by, reason }) {
  const calls = await engine('src/calls.mjs');
  const { result } = await client.unitOfWork(calls.callLoads('callExtract', need(id, 'An account id')), (dir) => calls.rejectProposal({ dir, id, proposalId: need(proposal, 'A proposal'), by, reason: typeof reason === 'string' ? reason : '' }));
  return result;
}

// ---- Drafts -------------------------------------------------------------------------------------------------------------------
export async function listDrafts(client) {
  const { store } = await mods();
  const { result } = await client.unitOfWork(['drafts/', 'accounts/'], (dir) => {
    const out = [];
    for (const acct of store.listFiles(join(dir, 'drafts'), '')) {
      const account = store.readJson(join(dir, 'accounts', `${acct}.json`), null);
      for (const f of store.listFiles(join(dir, 'drafts', acct), '.json')) {
        const d = store.readJson(join(dir, 'drafts', acct, f));
        if (d.status === 'draft' || d.status === 'blocked') out.push({ account: acct, accountName: account?.name ?? acct, person: account?.person?.name ?? '', channel: d.channel, step: d.step, status: d.status, subject: d.subject, text: d.text, errors: d.lint?.errors ?? [], warnings: d.lint?.warnings ?? [], createdAt: d.createdAt });
      }
    }
    return out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  });
  return result;
}

// The Approvals count in the navigation: drafts with status "draft". One read of the paths only, filtered on the server by the draft's
// status, so no draft text leaves the database for it. Read with the principal's token; anyone else counts nothing.
export async function countDrafts(rest) {
  const rows = await rest.get('documents', { select: 'path', path: 'like.drafts/*', 'body->>status': 'eq.draft', limit: 1000 });
  return Array.isArray(rows) ? rows.length : 0;
}

// Approving re-runs the linter and the guard on the saved draft (src/draft.mjs). It never sends: a principal sends from their mailbox.
export async function approve(client, { id, channel, step, by }) {
  const { LOADS, store, guard, draft } = await mods();
  const rules = await loadRules();
  // LOADS.approve: the drafter's list plus regulatory/, so an order in force that no principal has confirmed refuses the approval (D-E3).
  const { result } = await client.unitOfWork(LOADS.approve, (dir) => {
    const account = store.readJson(join(dir, 'accounts', `${need(id, 'An account id')}.json`), null);
    if (!account) throw new Error(`There is no account ${id}.`);
    const ctx = guard.loadContext({ dir, config: rules.config });
    return draft.approveDraft({ dir, account, channel: need(channel, 'A channel'), step: Number(step), by, ctx, rules });
  });
  return result;
}

// ---- Pilot ----------------------------------------------------------------------------------------------------------------------
export async function pilotOverview(client) {
  const { LOADS, pilot } = await mods();
  const { result } = await client.unitOfWork(LOADS.pilot, (dir) => ({ card: pilot.scorecard({ dir }), status: pilot.pilotStatus(dir) }));
  return result;
}

export async function pilotReview(client, id) {
  const { LOADS, pilot } = await mods();
  const { result } = await client.unitOfWork(LOADS.pilot, (dir) => pilot.reviewList({ dir, accountId: need(id, 'An account id') }));
  return result;
}

export async function markVerdict(client, { id, findingId, verdict, by }) {
  const { LOADS, pilot } = await mods();
  await client.unitOfWork(LOADS.pilot, (dir) => pilot.markFinding({ dir, accountId: need(id, 'An account id'), findingId: need(findingId, 'A finding'), verdict, by }));
}

export async function passPilot(client, { by }) {
  const { LOADS, pilot } = await mods();
  const rules = await loadRules();
  const { result } = await client.unitOfWork(LOADS.pilot, (dir) => pilot.passPilot({ dir, by, minAccounts: rules.config.pilot.minAccounts }));
  return result;
}

// ---- Status ---------------------------------------------------------------------------------------------------------------------
export async function statusOverview(rest, client) {
  const rules = await loadRules();
  const [runs, jobs, killDoc, snap] = await Promise.all([rest.runs(50), rest.jobs(25), rest.killDocument(), client ? client.load(['sources/edgar/state.json']) : { docs: {} }]);
  const lines = runs.map((r) => r.line);
  return { runs: lines.slice(0, 20), jobs, kill: { config: !!rules.config.killSwitch, document: killDoc }, edgar: edgarStatus({ state: snap.docs['sources/edgar/state.json'] ?? null, runs: lines, jobs }) };
}

// Signal coverage (PRD next-five E18-S1): the engine's own report (src/coverage.mjs), from stored data. The candidates come from their
// projection (the candidates table, summary columns only), as on the Candidates page, so the whole candidate list is not loaded on
// every Status view; the other files are LOADS.coverage's exact paths. The projection carries no run id, so the card shows none.
export async function coverageOverview(client, { pageSize = 1000 } = {}) {
  const [{ LOADS }, coverage] = await Promise.all([engine('src/uow.mjs'), engine('src/coverage.mjs')]);
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await client.candidates({ limit: pageSize, offset });
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  const P = coverage.COVERAGE_PATHS;
  const snap = await client.load(LOADS.coverage.filter((p) => p !== P.latest));
  const doc = (p) => snap.docs[p] ?? null;
  const latest = rows.length ? {
    runId: null, scoredAt: null, provisional: rows.some((r) => r.provisional),
    latestRepdte: rows.map((r) => r.period).filter((p) => /^\d{8}$/.test(String(p ?? ''))).sort().at(-1) ?? null,
    items: rows.map((r) => ({ key: r.key, tier: r.tier ?? null, name: r.name ?? '' })),
  } : null;
  return coverage.buildCoverage({ latest, aliases: doc(P.aliases), filers: doc(P.filers), servicers: doc(P.servicers), ledger: doc(P.ledger), enforcement: doc(P.enforcement), fdicOrders: doc(P.fdicOrders), occOrders: doc(P.occOrders), mergers: doc(P.mergers), institutions: doc(P.institutions) });
}

// What led to conversations (PRD E15-S4), for the Status page: the engine's own report (src/outcomes.mjs), the one `outbound outcomes
// report` prints, built from the confirmed outcome lines, the touch log (meetings recorded by hand) and only the accounts those meetings
// name. Read as the principal; it writes nothing (the command line's run writes reports/). The page shows its counts, never a name.
export async function outcomesOverview(client, { now = new Date() } = {}) {
  const [outcomes, rules] = await Promise.all([engine('src/outcomes.mjs'), loadRules()]);
  const snap = await client.load(['outcomes.jsonl', 'touches.jsonl']);
  const lines = snap.logs['outcomes.jsonl'] ?? [];
  const touches = snap.logs['touches.jsonl'] ?? [];
  const ids = outcomes.accountsNeeded({ touches, lines });
  const docs = ids.length ? (await client.load(ids.map((id) => `accounts/${id}.json`))).docs : {};
  const accounts = Object.fromEntries(ids.map((id) => [id, docs[`accounts/${id}.json`] ?? null]));
  return outcomes.buildOutcomesReport({ lines, touches, accounts, ...outcomes.reportSettings(rules.config), now });
}

export const queueSources = (client) => client.enqueue('sources.fdic', {});
export const queueEdgar = (client) => client.enqueue('sources.edgar', {});

// ---- CMBS servicers (PRD E4-S3) ----------------------------------------------------------------------------------------------------
// The list needs only the per-servicer summary; loans.json is loaded only for one servicer's page.
export async function listServicers(client) {
  const snap = await client.load(['sources/edgar/servicers.json', 'sources/edgar/state.json']);
  return { servicers: sortServicers(snap.docs['sources/edgar/servicers.json'] ?? {}), state: snap.docs['sources/edgar/state.json'] ?? null };
}

export async function servicerDetail(client, name) {
  const n = need(name, 'A servicer name');
  const snap = await client.load(['sources/edgar/servicers.json', 'sources/edgar/loans.json']);
  const summary = (snap.docs['sources/edgar/servicers.json'] ?? {})[n] ?? null;
  if (!summary) return null;
  return { summary, loans: loansFor(snap.docs['sources/edgar/loans.json'] ?? {}, n) };
}
export const queueScore = (client, { draftBuybox }) => client.enqueue('score.run', { draftBuybox: !!draftBuybox });

// ---- The weekly triage (PRD E6-S5) -------------------------------------------------------------------------------------------------
// The stored triage for `date`, or the latest: the snapshot (triage/state.json) names the latest date, and only that day's record is
// loaded. Internal, for the principals; the worker's triage.run job writes it, and it is never sent anywhere.
const DATE = /^\d{4}-\d{2}-\d{2}$/;
export async function latestTriage(client, { date } = {}) {
  let d = typeof date === 'string' && DATE.test(date) ? date : null;
  if (!d) d = (await client.load(['triage/state.json'])).docs['triage/state.json']?.date ?? null;
  if (typeof d !== 'string' || !DATE.test(d)) return null;
  return (await client.load([`triage/${d}.json`])).docs[`triage/${d}.json`] ?? null;
}
export const queueTriage = (client) => client.enqueue('triage.run', {});

// ---- Who sells to whom (PRD E16) ---------------------------------------------------------------------------------------------------
// One document, the ledger the engine builds; the views are the engine's own (src/sales.mjs). The events of each seller are left out
// of the seller table: it shows counts, the latest date, and a link to the bank's candidate page or the servicer's page.
export async function salesOverview(client, { recent = 50 } = {}) {
  const sales = await engine('src/sales.mjs');
  const snap = await client.load(['sales/ledger.json']);
  const ledger = snap.docs['sales/ledger.json'] ?? null;
  if (!ledger) return { builtAt: null, counts: null, recent: [], sellers: [], buyers: [], pricing: null };
  return {
    builtAt: ledger.builtAt ?? null, runId: ledger.runId ?? null, counts: ledger.counts ?? null,
    recent: sales.eventsOf(ledger).slice(0, recent),
    sellers: sales.groupBySeller(ledger).map(sellerRow),
    buyers: sales.groupBuyers(ledger).map((b) => ({ ...b, link: partyLink(b) })),
    pricing: sales.pricing(ledger),
  };
}

// ---- Intermediaries (PRD next-five E19) -------------------------------------------------------------------------------------------
// The engine's own functions (src/intermediaries.mjs), on the stored registry. For the principals only; never in a message.
const INTERMEDIARY_DOCS = ['intermediaries/registry.json', 'intermediaries/manual.json', 'intermediaries/registrations.json'];
export async function listIntermediaries(client, { kind = null } = {}) {
  const [I, rules] = await Promise.all([engine('src/intermediaries.mjs'), loadRules()]);
  const snap = await client.load(INTERMEDIARY_DOCS);
  const registry = snap.docs['intermediaries/registry.json'] ?? null;
  const regs = snap.docs['intermediaries/registrations.json'] ?? { firms: {} };
  const today = new Date().toISOString().slice(0, 10);
  const rows = registry ? I.rankFirms({ registry, config: rules.config, buybox: rules.buybox, asOf: today }).filter((r) => !kind || r.kinds.includes(kind)) : [];
  return { builtAt: registry?.builtAt ?? null, kinds: I.KINDS, rows: rows.map((r) => ({ ...r, registration: regs.firms?.[r.key]?.state ?? null })) };
}

export async function intermediaryDetail(client, key) {
  const [I, rules] = await Promise.all([engine('src/intermediaries.mjs'), loadRules()]);
  const snap = await client.load(INTERMEDIARY_DOCS);
  const registry = snap.docs['intermediaries/registry.json'] ?? null;
  const firm = registry?.firms?.[need(key, 'A firm key')];
  if (!firm) return null;
  const regs = snap.docs['intermediaries/registrations.json'] ?? { firms: {}, credibilityPackage: null };
  const row = I.rankFirms({ registry, config: rules.config, buybox: rules.buybox, asOf: new Date().toISOString().slice(0, 10) }).find((r) => r.key === key);
  return { firm, row, kinds: I.KINDS, states: I.REG_STATES, mandates: firm.mandates.map((id) => registry.mandates[id]).filter(Boolean).sort((a, b) => String(b.date).localeCompare(String(a.date))),
    registration: regs.firms?.[key] ?? null, credibilityPackage: regs.credibilityPackage ?? null };
}

export async function setRegistration(client, { key, state, by, recertifyBy }) {
  const [{ LOADS }, I] = await Promise.all([engine('src/uow.mjs'), engine('src/intermediaries.mjs')]);
  const { result } = await client.unitOfWork(LOADS.intermediaries, (dir) => I.setRegistration({ dir, key: need(key, 'A firm key'), state, by, recertifyBy: recertifyBy || null }));
  return result;
}

// The route to a seller (E19-S4), for the candidate page.
export async function routeOf(client, sellerKey) {
  const I = await engine('src/intermediaries.mjs');
  const snap = await client.load(INTERMEDIARY_DOCS);
  if (!snap.docs['intermediaries/registry.json']) return null;
  return I.routeFor({ registry: snap.docs['intermediaries/registry.json'], manual: snap.docs['intermediaries/manual.json'] ?? {}, registrations: snap.docs['intermediaries/registrations.json'] ?? {}, sellerKey });
}

// Buyer-list re-certifications due soon (E19-S3), for the Status page.
export async function registrationReminders(client) {
  const [I, rules] = await Promise.all([engine('src/intermediaries.mjs'), loadRules()]);
  const snap = await client.load(['intermediaries/registrations.json']);
  return I.registrationReminders({ registrations: snap.docs['intermediaries/registrations.json'] ?? {}, asOf: new Date().toISOString().slice(0, 10), withinDays: rules.config.intermediaries?.reminderDays ?? 30 });
}

// ---- The market data pack (PRD next-five E20) -----------------------------------------------------------------------------------
// The latest stored pack (market/<quarter>.json), aggregates only. For the principals; publishing waits for counsel (Q25).
export async function latestMarketPack(client) {
  const snap = await client.load(['market/']);
  const keys = Object.keys(snap.docs).filter((k) => /^market\/\d{4}-\d{2}-\d{2}\.json$/.test(k)).sort();
  return keys.length ? snap.docs[keys.at(-1)] : null;
}
