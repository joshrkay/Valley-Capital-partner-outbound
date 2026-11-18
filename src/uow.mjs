// A unit of work (PRD E12-S1): the platform's way of running the engine. It loads only the documents an action needs, mounts them in
// memory where the data folder would be, runs the same synchronous engine code, and hands back a plan of what changed: documents to
// write (each with the version it was loaded at, so a concurrent change is caught) and log lines to append. The platform writes that
// plan to Postgres in one transaction (a very large plan, such as a scoring run, in a few: flushBatches in src/platform/client.mjs).
// Reading or writing a path the action did not load fails loudly instead of acting on nothing.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { mount, writeJson, writeText, appendJsonl, redactJsonl, safeId } from './store.mjs';

// What each kind of action reads and writes. A prefix ending in "/" covers a folder; anything else is one exact path; "" is everything.
// audit.jsonl is never listed: the engine only appends to it, and an append needs no load, so no action downloads the whole audit log.
const GUARD = ['senders.json', 'suppression.json', 'touches.jsonl', 'KILL'];
export const LOADS = Object.freeze({
  guard: GUARD,
  candidates: ['candidates/', 'accounts/', 'suppression.json'],
  account: ['accounts/'],
  pilot: ['pilot/', 'research/'],
  // paper/: the briefer reads the bank's paper estimate as data (E14-S1). The drafter's list never includes it.
  // regulatory/: the bank's orders and open merger applications (next-five E18-S4), as data for the briefer. Never in the drafter's list.
  research: ['accounts/', 'research/', 'facts/', 'briefs/', 'pilot/', 'paper/', 'regulatory/'],
  draft: [...GUARD, 'accounts/', 'research/', 'facts/', 'drafts/'],
  // Approving a draft (a person, not a model): the drafter's list plus regulatory/, so the guard can refuse a touch to a bank under an
  // order in force that no principal has confirmed (next-five D-E3). Confirming an order reads the account and its regulatory record.
  approve: [...GUARD, 'accounts/', 'research/', 'facts/', 'drafts/', 'regulatory/'],
  orderConfirm: ['accounts/', 'regulatory/'],
  sources: ['sources/'],
  score: ['sources/', 'candidates/', 'paper/', 'sales/', 'regulatory/'],
  // Call prep and outcomes (PRD E15, src/calls.mjs). calls/, drafts/ and research/ are narrowed to one account by callLoads().
  // A confirmation reads outcomes.jsonl (one short line per confirmed call) to finish an interrupted one without writing a line twice.
  callPrep: [...GUARD, 'accounts/', 'research/', 'drafts/', 'candidates/latest.json', 'paper/', 'regulatory/', 'calls/'],
  callNotes: ['accounts/', 'calls/'],
  callExtract: ['accounts/', 'calls/'],
  callConfirm: [...GUARD, 'accounts/', 'calls/', 'paper/', 'outcomes.jsonl'],
  // The outcomes report also counts meetings recorded by hand: the touch log, and the accounts they name (for their origin signals).
  outcomes: ['outcomes.jsonl', 'reports/', 'touches.jsonl', 'accounts/'],
  // The weekly triage (src/triage.mjs): the candidate list and decisions, accounts, the guard's log and suppression list, the run log, the
  // few source files it reads, and its own snapshot. The day's two output files are added per run (triageLoads), so past triages are
  // never loaded. No research or drafting action loads triage/, so the triage never reaches a brief or a message.
  // It also reads the county loan events (loans/events.json, docs/county-loans.md), as Watch lines for principals; never the documents.
  triage: ['candidates/', 'accounts/', 'suppression.json', 'touches.jsonl', 'sources/runs.jsonl', 'sources/fdic/state.json', 'sources/fdic/failed.json',
    'sources/edgar/loans.json', 'sources/edgar/filings.json', 'sources/edgar/filers.json', 'triage/state.json', 'loans/events.json'],
  // County loan documents (docs/county-loans.md, src/loans.mjs and src/sources/notices.mjs): the watcher's own folder, the bank list and
  // the aliases it matches lenders against, and the run log. Loan and borrower detail is context for principals only: no model-facing
  // action (research, draft, approve, call prep, call notes, the call desk) loads loans/, and neither does scoring, so no county
  // document can change a score, a weight or a tier (test/loans-handoff.test.mjs).
  loans: ['loans/', 'sources/fdic/institutions.json', 'candidates/aliases.json', 'sources/runs.jsonl'],
  sales: ['sources/', 'sales/', 'intermediaries/'],   // next-five E19-S1: the intermediary registry is rebuilt with the ledger
  // Intermediaries (next-five E19): the registry, a principal's records and registrations; the ledger and CMBS loans it is built from;
  // the suppression list (an NDA under an advisor's agreement goes there). No model-facing action loads intermediaries/.
  // The market data pack (next-five E20): the FDIC and CMBS stores it aggregates, and its own folder. Never loaded by a model-facing action.
  market: ['sources/fdic/', 'sources/edgar/loans.json', 'sources/edgar/dispositions.json', 'market/'],
  intermediaries: ['intermediaries/', 'sales/ledger.json', 'sources/edgar/loans.json', 'suppression.json'],   // the CMBS and FDIC loan-sale pulls rebuild the sale ledger (sales/ledger.json) when they finish
  // Signal coverage (PRD next-five E18-S1, src/coverage.mjs): read-only, ten exact files and no folder. The candidate list and its
  // aliases, the bank-to-filer map, the CMBS servicer summary, the sale ledger, and the enforcement orders (E18-S2: the Federal Reserve's, the FDIC's and the OCC's) and the merger applications (E18-S3), with the bank list
  // they are matched against. It writes nothing.
  coverage: ['candidates/latest.json', 'candidates/aliases.json', 'sources/edgar/filers.json', 'sources/edgar/servicers.json', 'sales/ledger.json', 'sources/enforcement/orders.json', 'sources/enforcement/fdic-orders.json', 'sources/enforcement/occ-orders.json', 'sources/mergers/applications.json', 'sources/fdic/institutions.json'],
  // Enforcement orders (PRD next-five E18-S2, src/sources/enforcement.mjs): its own store, the bank list and the aliases it matches
  // against (to choose which order documents to read), and the run log. Matching is redone whenever the orders are read, so it writes
  // no candidate file. No research, drafting or call action loads sources/enforcement/ (E18-S4 decides what the briefer may read).
  enforcement: ['sources/enforcement/', 'sources/fdic/institutions.json', 'candidates/aliases.json', 'sources/runs.jsonl'],
  // Merger applications (PRD next-five E18-S3, src/sources/mergerapps.mjs): its own store, the bank list, FDIC's structure events (an
  // application closes when one shows the merger) and the aliases, and the run log. No model-facing action loads sources/mergers/.
  mergers: ['sources/mergers/', 'sources/fdic/institutions.json', 'sources/fdic/events.json', 'candidates/aliases.json', 'sources/runs.jsonl'],
  // Routes to the decision-maker (PRD E22, src/routes.mjs): the guard's files (for its view: an opt-out or a suppression stops a route),
  // the account, its research, the sale ledger, the firm's network and the account's own routes file. accounts/, research/ and routes/
  // are narrowed to one account by routesLoads(). No model-facing action (research, draft, call prep) loads network/ or routes/.
  routes: [...GUARD, 'accounts/', 'research/', 'sales/ledger.json', 'network/', 'routes/'],
  // The firm's network (src/network.mjs). routes/ is here because removing an entry rewrites every routes file that stored it, and the
  // network page shows how many chosen routes use each entry.
  network: ['network/', 'routes/'],
  // Contact details (PRD E7-S3, src/accounts.mjs). contactLoads() narrows accounts/ and research/ to one account. Naming a person, an
  // address, a phone or a street address reads the account's brief (a source can be one of its findings), the suppression list (a
  // forgotten or opted-out person is never named again) and the vendor passes (a vendor as a source needs one).
  person: ['accounts/', 'research/', 'suppression.json', 'contacts/vendors.json'],
  // A domain: every account, because a domain another institution already holds is flagged for a principal (E9-S3).
  domain: ['accounts/', 'research/'],
  verify: ['accounts/', 'suppression.json', 'contacts/vendors.json'],
  // A deletion request (src/forget.mjs) reads and scrubs every store that can hold a person, for every account. It is the only action
  // that loads calls/, drafts/ and pilot/ whole. The audit log is never loaded or rewritten: it holds ids, codes and counts. routes/ and
  // network/ are here because the routes hold lender-side names and the network can hold the person; a routes file that names them is
  // rebuilt (src/routes.mjs buildRoutes), which also reads the guard's files and the sale ledger.
  forget: ['accounts/', 'research/', 'facts/', 'briefs/', 'drafts/', 'calls/', 'pilot/', 'contacts/', 'routes/', 'network/', 'sales/ledger.json', ...GUARD, 'outcomes.jsonl'],
  // The vendor test harness (PRD E7-S2, src/vendors.mjs): the known list, the test reports and the recorded passes. No drafting or
  // research action loads contacts/, so none of it reaches a brief or a message.
  vendors: ['contacts/'],
  // The backtest of the score (PRD E17, src/backtest/). It runs from the command line against the data folder; there is no worker job
  // kind yet, and a whole panel is too large for one unit of work (see the PRD's size estimate). These lists say what each step reads:
  // the panel pull, its own files and the run log; the labels, the panel, the FDIC records they are dated by, the confirmed filers
  // (for the coverage strata) and the run log; the replay, backtest/ only. No research, drafting or call action loads backtest/.
  backtestPanel: ['backtest/panel/', 'sources/runs.jsonl'],
  backtestLabels: ['backtest/', 'sources/fdic/failed.json', 'sources/fdic/events.json', 'sources/fdic/sales.json', 'sources/fdic/state.json', 'sources/edgar/filers.json', 'sources/runs.jsonl'],
  backtestRun: ['backtest/'],
  // The Calibration page (next-five E17-S5), read-only: the run log, which names every stored report. calibrationLoads() adds the one
  // report the page shows. Never backtest/ whole: the panel is far too large for a page view, and the page needs none of it.
  calibration: ['backtest/runs.jsonl'],
  // Recording what happened, by hand, from the web app (working without Gmail): a send a principal already made from their own mailbox
  // (recordObservedSend), or a reply, opt-out, bounce, meeting or handoff (recordEvent). The guard's files and the one account, narrowed
  // by recordLoads(). An opt-out writes suppression.json, which the guard's list holds; the touch log is only appended to.
  record: [...GUARD, 'accounts/'],
  // The sender settings (src/senders.mjs): senders.json, and the KILL document for the readiness rule. Removing a sender also reads the
  // touch log, because a sender a recorded touch names is never removed.
  senders: ['senders.json', 'KILL'],
  senderRemove: ['senders.json', 'touches.jsonl', 'KILL'],
  // The call desk (web app): what a principal reads aloud on a call. The guard's files, the one account and its drafts, read only. It
  // never holds research/, facts/, paper/, routes/ or regulatory/, so the screen shows only what a person approved, as the drafter does.
  callDesk: [...GUARD, 'accounts/', 'drafts/'],
});

// The recording actions' load list, narrowed to the one account they record against.
export function recordLoads(id) {
  safeId(id);
  return LOADS.record.map((p) => (p === 'accounts/' ? `accounts/${id}.json` : p));
}

// The Calibration page's load list with the one stored report it shows. The hash is checked before it becomes part of a path; its form
// is the backtest's REPORT_HASH (src/backtest/run.mjs).
export function calibrationLoads(hash) {
  if (!/^[0-9a-f]{16}$/.test(String(hash ?? ''))) throw new Error(`"${hash}" is not a report hash (16 hexadecimal characters).`);
  return [...LOADS.calibration, `backtest/report-${hash}.json`];
}

// The call desk's load list, narrowed to one account and its own drafts folder.
export function callDeskLoads(id) {
  safeId(id);
  return LOADS.callDesk.map((p) => (p === 'accounts/' ? `accounts/${id}.json` : p === 'drafts/' ? `drafts/${id}/` : p));
}

// The contact actions' load lists, narrowed to one account where the action touches only that account.
export function contactLoads(kind, id) {
  safeId(id);
  if (!['person', 'domain', 'verify'].includes(kind)) throw new Error(`Unknown contact action "${kind}".`);
  const narrow = { 'research/': `research/${id}.json`, ...(kind === 'domain' ? {} : { 'accounts/': `accounts/${id}.json` }) };
  return LOADS[kind].map((p) => narrow[p] ?? p);
}

const covers = (prefix, rel) => prefix === '' || rel === prefix || (prefix.endsWith('/') && rel.startsWith(prefix)) || rel.startsWith(`${prefix}/`);
const kindOf = (rel) => (rel.endsWith('.jsonl') ? 'log' : rel.endsWith('.json') ? 'json' : 'text');

// docs: { path: JSON text }, texts: { path: string }, logs: { path: [line objects] }, versions: { path: number } (0 or absent = new).
export function memoryBackend({ docs = {}, texts = {}, logs = {}, versions = {}, loaded = [''] } = {}) {
  const D = new Map(Object.entries(docs).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
  const T = new Map(Object.entries(texts));
  const L = new Map(Object.entries(logs).map(([k, v]) => [k, v.map((x) => JSON.stringify(x))]));
  const appended = new Map();
  const dirty = new Set();
  const loadedLines = new Map();   // path -> its lines as loaded, kept once a redaction touches the path, so the plan can say what changed
  const need = (rel, what) => {
    if (!loaded.some((p) => covers(p, rel))) throw new Error(`Unit of work: "${rel}" was not loaded, so it cannot be ${what}. Add it to the action's load list (src/uow.mjs, LOADS).`);
  };
  const under = (dir) => (dir === '' ? '' : `${dir.replace(/\/$/, '')}/`);
  return {
    readJson(rel, fallback) { need(rel, 'read'); return D.has(rel) ? JSON.parse(D.get(rel)) : fallback; },
    writeJson(rel, data) { need(rel, 'written'); D.set(rel, JSON.stringify(data)); dirty.add(rel); },
    readText(rel, fallback = null) { need(rel, 'read'); return T.has(rel) ? T.get(rel) : fallback; },
    writeText(rel, text) { need(rel, 'written'); T.set(rel, String(text)); dirty.add(rel); },
    appendJsonl(rel, obj) {   // an append needs no load: it adds, it never overwrites
      const line = JSON.stringify(obj);
      if (!appended.has(rel)) appended.set(rel, []);
      appended.get(rel).push(line);
    },
    readJsonl(rel) { need(rel, 'read'); return [...(L.get(rel) ?? []), ...(appended.get(rel) ?? [])].map((l) => JSON.parse(l)); },
    // A loaded line that changes becomes a redaction in the plan; a line appended in this unit of work is simply appended as changed.
    redactJsonl(rel, fn) {
      need(rel, 'redacted');
      let n = 0;
      const apply = (lines) => lines.map((l) => { const next = JSON.stringify(fn(JSON.parse(l))); if (next !== l) n++; return next; });
      if (L.has(rel)) { if (!loadedLines.has(rel)) loadedLines.set(rel, L.get(rel)); L.set(rel, apply(L.get(rel))); }
      if (appended.has(rel)) appended.set(rel, apply(appended.get(rel)));
      return n;
    },
    listFiles(dir, ext) {
      const pre = under(dir);
      need(pre || '', 'listed');
      const names = new Set();
      for (const k of [...D.keys(), ...T.keys(), ...L.keys(), ...appended.keys()]) {
        if (!k.startsWith(pre)) continue;
        const rest = k.slice(pre.length);
        const name = rest.split('/')[0];
        if (name.endsWith(ext)) names.add(name);
      }
      return [...names].sort();
    },
    exists(rel) {
      need(rel, 'checked');
      if (D.has(rel) || T.has(rel) || (L.get(rel)?.length ?? 0) > 0 || appended.has(rel)) return true;
      const pre = under(rel);
      return [...D.keys(), ...T.keys(), ...L.keys(), ...appended.keys()].some((k) => k.startsWith(pre));
    },
    // What changed, for the platform to write in one transaction.
    plan() {
      const docsOut = [...dirty].sort().map((path) => (D.has(path) ? { path, kind: 'json', body: JSON.parse(D.get(path)) } : { path, kind: 'text', text: T.get(path) }))
        .map((d) => ({ ...d, baseVersion: versions[d.path] ?? 0 }));
      const lines = [...appended.entries()].flatMap(([path, ls]) => ls.map((l) => ({ path, line: JSON.parse(l) })));
      // One redaction per distinct line as loaded: the database rewrites every identical line at once.
      const red = new Map();
      for (const [path, before] of loadedLines) before.forEach((orig, i) => { const cur = L.get(path)[i]; if (cur !== orig && !red.has(`${path}\n${orig}`)) red.set(`${path}\n${orig}`, { path, old: JSON.parse(orig), new: JSON.parse(cur) }); });
      return { docs: docsOut, lines, ...(red.size ? { redactions: [...red.values()] } : {}) };
    },
  };
}

// Reads a data folder into a snapshot: for tests, for copying a folder into the platform (E12-S6), and for running an action on a folder
// as a unit of work (the command line's call confirmation). `prefixes` (as in LOADS) limits it to what the action loads; the default is
// everything. Every file starts at version 0.
export function snapshotFromDir(dir, prefixes = ['']) {
  const snap = { docs: {}, texts: {}, logs: {}, versions: {} };
  if (!existsSync(dir)) return snap;
  const into = (r) => prefixes.some((p) => covers(p, r) || p.startsWith(`${r}/`));   // a folder that holds, or is inside, a prefix
  const walk = (abs, rel) => {
    for (const name of readdirSync(abs).sort()) {
      const a = join(abs, name), r = rel ? `${rel}/${name}` : name;
      if (statSync(a).isDirectory()) { if (into(r)) walk(a, r); continue; }
      if (/\.tmp-\d+$/.test(name) || !prefixes.some((p) => covers(p, r))) continue;   // a write in progress, or not loaded
      const raw = readFileSync(a, 'utf8');
      const k = kindOf(r);
      if (k === 'json') snap.docs[r] = JSON.parse(raw);
      else if (k === 'log') snap.logs[r] = raw.split('\n').filter(Boolean).map((l) => JSON.parse(l));
      else snap.texts[r] = raw;
    }
  };
  walk(resolve(dir), '');
  return snap;
}

// Writes a plan to a data folder: the file-backed equivalent of the platform's flush, used by tests and by `platform pull`.
export function applyPlanToDir(plan, dir) {
  for (const d of plan.docs) d.kind === 'json' ? writeJson(join(dir, d.path), d.body) : writeText(join(dir, d.path), d.text);
  for (const r of plan.redactions ?? []) { const old = JSON.stringify(r.old); redactJsonl(join(dir, r.path), (l) => (JSON.stringify(l) === old ? r.new : l)); }
  for (const l of plan.lines) appendJsonl(join(dir, l.path), l.line);
}

const VIRTUAL = resolve('/__valley_outbound_unit_of_work__');   // never exists on disk; every path under it is routed to memory

// Runs fn(root) against a snapshot. `load(prefixes)` returns a snapshot; `flush(plan)` writes it (skipped when nothing changed).
export async function withUnitOfWork({ load, flush }, prefixes, fn) {
  const snap = await load(prefixes);
  const backend = memoryBackend({ ...snap, loaded: prefixes });
  const root = join(VIRTUAL, `${process.pid}-${randomBytes(6).toString('hex')}`);
  const unmount = mount(root, backend);
  try {
    const result = await fn(root);
    const plan = backend.plan();
    if (plan.docs.length || plan.lines.length || plan.redactions?.length) await flush(plan);
    return { result, plan };
  } finally {
    unmount();
  }
}
