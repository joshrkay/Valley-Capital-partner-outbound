// Server only. Every read and action the screens offer, written against the engine and a platform client (src/platform/client.mjs),
// with no framework code, so each can be tested against a fake Supabase REST API. Quick actions run the engine's own function in a
// unit of work; long work (research, drafting, data pulls, scoring) is queued for the worker, never run here (PRD E12-S4, E12-S5).
import { join } from 'node:path';
import { engine, loadRules } from './engine.mjs';
import { visibleCandidates } from './candidates-view.mjs';

const today = () => new Date().toISOString().slice(0, 10);
const need = (v, what) => { const s = typeof v === 'string' ? v.trim() : ''; if (!s) throw new Error(`${what} is required.`); return s; };
const mods = async () => {
  const [uow, store, candidates, pilot, guard, draft] = await Promise.all(['src/uow.mjs', 'src/store.mjs', 'src/candidates.mjs', 'src/pilot.mjs', 'src/guard.mjs', 'src/draft.mjs'].map(engine));
  return { LOADS: uow.LOADS, store, candidates, pilot, guard, draft };
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

export async function candidateDetail(client, key) {
  const item = await client.candidate(need(key, 'A candidate key'));
  if (!item) return null;
  const snap = await client.load(['suppression.json', 'candidates/decisions.json', 'candidates/aliases.json']);
  const { candidates } = await mods();
  const suppressed = !!candidates.suppressedBy(item, snap.docs['suppression.json']?.entries ?? [], snap.docs['candidates/aliases.json'] ?? {});
  return { item, decision: (snap.docs['candidates/decisions.json'] ?? {})[key] ?? null, suppressed };
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

export async function accountDetail(client, id) {
  const { LOADS, store, pilot } = await mods();
  const rules = await loadRules();
  store.safeId(need(id, 'An account id'));   // checked before it becomes part of a path
  const own = [`accounts/${id}.json`, `briefs/${id}.md`, `research/${id}.json`, `drafts/${id}/`, 'pilot/status.json'];
  const { result } = await client.unitOfWork(own, (dir) => {
    const account = store.readJson(join(dir, 'accounts', `${id}.json`), null);
    if (!account) return null;
    const research = store.readJson(join(dir, 'research', `${id}.json`), null);
    const drafts = store.listFiles(join(dir, 'drafts', id), '.json').map((f) => store.readJson(join(dir, 'drafts', id, f))).map((d) => ({ channel: d.channel, step: d.step, status: d.status, approvedBy: d.approvedBy }));
    return {
      account, brief: store.readText(join(dir, 'briefs', `${id}.md`), null),
      research: research ? { date: research.date, mode: research.mode ?? 'person', findings: research.findings?.length ?? 0, risk: research.riskScreen?.approach ?? null, person: research.personCheck?.status ?? null } : null,
      gate: pilot.researchGate({ dir, account, config: rules.config }), drafts,
    };
  });
  return result;
}

export async function setPerson(client, { id, name, title, by }) {
  const { LOADS, store } = await mods();
  await client.unitOfWork(LOADS.account, (dir) => {   // the same change as `outbound account set-person`
    const p = join(dir, 'accounts', `${need(id, 'An account id')}.json`);
    const a = store.readJson(p, null);
    if (!a) throw new Error(`There is no account ${id}.`);
    a.person = { ...(a.person ?? {}), name: need(name, 'The person\'s name'), title: typeof title === 'string' ? title.trim() : '' };
    a.contact = { ...(a.contact ?? {}), roleConfirmed: false, roleConfirmedBy: undefined, roleConfirmedAt: undefined };
    store.writeJson(p, a);
    store.audit(dir, { type: 'person_set', accountId: id, by });
  });
}

export async function confirmRole(client, { id, by }) {
  const { LOADS, store } = await mods();
  await client.unitOfWork(LOADS.account, (dir) => {   // the same change as `outbound account confirm-role`
    const p = join(dir, 'accounts', `${need(id, 'An account id')}.json`);
    const a = store.readJson(p, null);
    if (!a) throw new Error(`There is no account ${id}.`);
    if (!a.person?.name) throw new Error('Name the person before confirming their role.');
    a.contact = { ...(a.contact ?? {}), roleConfirmed: true, roleConfirmedBy: by, roleConfirmedAt: new Date().toISOString() };
    store.writeJson(p, a);
    store.audit(dir, { type: 'role_confirmed', accountId: id, by });
  });
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

// Approving re-runs the linter and the guard on the saved draft (src/draft.mjs). It never sends: a principal sends from their mailbox.
export async function approve(client, { id, channel, step, by }) {
  const { LOADS, store, guard, draft } = await mods();
  const rules = await loadRules();
  const { result } = await client.unitOfWork(LOADS.draft, (dir) => {
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
export async function statusOverview(rest) {
  const rules = await loadRules();
  const [runs, jobs, killDoc] = await Promise.all([rest.runs(20), rest.jobs(25), rest.killDocument()]);
  return { runs: runs.map((r) => r.line), jobs, kill: { config: !!rules.config.killSwitch, document: killDoc } };
}

export const queueSources = (client) => client.enqueue('sources.fdic', {});
export const queueScore = (client, { draftBuybox }) => client.enqueue('score.run', { draftBuybox: !!draftBuybox });
