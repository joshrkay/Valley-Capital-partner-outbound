// The platform's worker (PRD E12-S4): takes queued jobs one at a time and runs the same engine functions the command line runs, each
// inside a unit of work, so a ten-minute research run never sits inside a web request. A job's stored result holds counts and
// statuses, never names or message text, because the worker's output also lands in scheduled-job logs.
import { join } from 'node:path';
import { LOADS } from '../uow.mjs';
import { readJson } from '../store.mjs';
import { runFdic } from '../sources/fdic.mjs';
import { runEdgar } from '../sources/edgar.mjs';
import { runFilings, loadFilingRules } from '../sources/filings.mjs';
import { runScoring } from '../score.mjs';
import { runBriefer } from '../research.mjs';
import { runDrafter } from '../draft.mjs';
import { loadContext } from '../guard.mjs';
import { researchGate } from '../pilot.mjs';

export const JOB_KINDS = ['sources.fdic', 'sources.edgar', 'sources.filings', 'score.run', 'research.run', 'draft.run'];
const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const CHANNELS = ['email', 'letter', 'call', 'linkedin_note'];

function account(dir, id) {
  if (!ID.test(String(id ?? ''))) throw new Error('The job needs a valid account id (params.account).');
  const a = readJson(join(dir, 'accounts', `${id}.json`), null);
  if (!a) throw new Error(`No account "${id}".`);
  return a;
}

// Runs one job. `deps` holds what reaches outside: fetch for public data, a factory for the model client. Retries are 0 for anything
// that spends money: a conflict is reported, never repeated.
export async function runJob({ client, job, rules, deps = {} }) {
  const p = job.params ?? {};
  switch (job.kind) {
    case 'sources.fdic': {
      const { result } = await client.unitOfWork(LOADS.sources, (dir) => runFdic({ dir, metros: rules.metros, includeHq: !!p.includeHq, fetchImpl: deps.fetchImpl ?? globalThis.fetch }), { retries: 0 });
      return { ok: result.outcome !== 'failed', summary: { outcome: result.outcome, banks: result.banks, latestRepdte: result.latestRepdte, newQuarter: result.newQuarter, missingFields: result.missingFields, changed: result.changed } };
    }
    case 'sources.edgar': {
      const { result } = await client.unitOfWork(LOADS.sources, (dir) => runEdgar({ dir, metros: rules.metros, buybox: rules.buybox, scoring: rules.scoring, sec: rules.config.sec, fetchImpl: deps.fetchImpl ?? globalThis.fetch, now: deps.now?.() ?? new Date() }), { retries: 0 });
      return { ok: result.outcome !== 'failed', summary: { outcome: result.outcome, cmbsTrusts: result.cmbsTrusts, loansRead: result.loansRead, loansKept: result.loansKept, servicers: result.servicers, notes: result.notes, changed: result.changed } };
    }
    case 'sources.filings': {   // the SEC filings listener (PRD E13-S1); refused while config.sec.userAgent is a placeholder
      const { result } = await client.unitOfWork(LOADS.sources, (dir) => runFilings({ dir, sec: rules.config.sec, rules: rules.filings ?? loadFilingRules(), since: p.since, fetchImpl: deps.fetchImpl ?? globalThis.fetch, now: deps.now?.() ?? new Date(), ...(deps.sleep ? { sleep: deps.sleep } : {}) }), { retries: 0 });
      return { ok: result.outcome !== 'failed', summary: { outcome: result.outcome, filers: result.filers, requests: result.requests, hitsRead: result.hitsRead, filings: result.filings, filingsNew: result.filingsNew, proxies: result.proxies, discovered: result.discovered, changed: result.changed, notes: result.notes, missingFields: result.missingFields } };
    }
    case 'score.run': {
      const { result } = await client.unitOfWork(LOADS.score, (dir) => runScoring({ dir, buybox: rules.buybox, scoring: rules.scoring, metros: rules.metros, allowPlaceholders: !!p.draftBuybox, now: deps.now?.() ?? new Date() }));
      const n = (t) => result.items.filter((i) => i.tier === t).length;
      return { ok: true, summary: { banks: result.items.length, tierA: n('A'), tierB: n('B'), untiered: n(null), provisional: result.provisional, latestRepdte: result.latestRepdte } };
    }
    case 'research.run': {
      const model = deps.makeModelClient ? await deps.makeModelClient({ timeout: rules.models.research.timeoutMs }) : null;
      if (!model) throw new Error('No model client: research needs ANTHROPIC_API_KEY on the worker.');
      const { result } = await client.unitOfWork(LOADS.research, async (dir) => {
        const a = account(dir, p.account);
        const g = researchGate({ dir, account: a, config: rules.config });
        if (!g.allowed) return { ok: false, reason: 'pilot_gate', detail: g.reason };
        return runBriefer({ client: model, dir, account: a, models: rules.models, playbooks: rules.playbooks, now: deps.now?.() ?? new Date() });
      }, { retries: 0 });
      return { ok: !!result.ok, summary: { mode: result.mode, findings: result.findings, draftReady: result.draftReady, dropped: result.dropped, risk: result.risk, person: result.person, costUsd: result.costUsd, reason: result.reason } };
    }
    case 'draft.run': {
      if (!CHANNELS.includes(p.channel)) throw new Error(`The job needs a channel: ${CHANNELS.join(', ')}.`);
      const model = deps.makeModelClient ? await deps.makeModelClient({}) : null;
      if (!model) throw new Error('No model client: drafting needs ANTHROPIC_API_KEY on the worker.');
      const { result } = await client.unitOfWork(LOADS.draft, async (dir) => {
        const a = account(dir, p.account);
        const ctx = loadContext({ dir, config: rules.config });
        const sent = ctx.touches.filter((t) => t.accountId === a.id && t.type === 'touch').length;
        return runDrafter({ client: model, dir, account: a, channel: p.channel, step: Number(p.step ?? sent + 1), senderId: p.sender ?? ctx.senders[0]?.id, date: p.date ?? (deps.now?.() ?? new Date()).toISOString().slice(0, 10), ctx, rules, ackRisk: !!p.ackRisk });
      }, { retries: 0 });
      return { ok: !!result.ok, summary: { status: result.status ?? null, blocked: result.blocked ?? null, errors: (result.errors ?? []).map((e) => e.code), costUsd: result.costUsd ?? null } };
    }
    default:
      throw new Error(`Unknown job kind "${job.kind}".`);
  }
}

// Claims and runs jobs until the queue is empty or `max` have run. Returns one line per job: id, kind, outcome. No data.
export async function work({ client, rules, deps = {}, max = 10, log = () => {} }) {
  const done = [];
  for (let i = 0; i < max; i++) {
    const job = await client.claimJob();
    if (!job) break;
    let ok = false, summary;
    try { ({ ok, summary } = await runJob({ client, job, rules, deps })); }
    catch (e) { summary = { error: String(e.message ?? e).slice(0, 500) }; }
    await client.finishJob(job.id, ok, summary);
    const line = { id: job.id, kind: job.kind, outcome: ok ? 'done' : 'failed' };
    log(`job ${line.id} ${line.kind} ${line.outcome}`);
    done.push(line);
  }
  return done;
}
