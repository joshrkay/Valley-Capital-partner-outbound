// A unit of work (PRD E12-S1): the platform's way of running the engine. It loads only the documents an action needs, mounts them in
// memory where the data folder would be, runs the same synchronous engine code, and hands back a plan of what changed: documents to
// write (each with the version it was loaded at, so a concurrent change is caught) and log lines to append. The platform writes that
// plan to Postgres in one transaction. Reading or writing a path the action did not load fails loudly instead of acting on nothing.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { mount, writeJson, writeText, appendJsonl } from './store.mjs';

// What each kind of action reads and writes. A prefix ending in "/" covers a folder; anything else is one exact path; "" is everything.
const GUARD = ['senders.json', 'suppression.json', 'touches.jsonl', 'KILL'];
export const LOADS = Object.freeze({
  guard: GUARD,
  candidates: ['candidates/', 'accounts/', 'suppression.json', 'audit.jsonl'],
  account: ['accounts/', 'audit.jsonl'],
  pilot: ['pilot/', 'research/', 'audit.jsonl'],
  research: ['accounts/', 'research/', 'facts/', 'briefs/', 'pilot/', 'audit.jsonl'],
  draft: [...GUARD, 'accounts/', 'research/', 'facts/', 'drafts/', 'audit.jsonl'],
  sources: ['sources/', 'audit.jsonl'],
  score: ['sources/', 'candidates/', 'audit.jsonl'],
});

const covers = (prefix, rel) => prefix === '' || rel === prefix || (prefix.endsWith('/') && rel.startsWith(prefix)) || rel.startsWith(`${prefix}/`);
const kindOf = (rel) => (rel.endsWith('.jsonl') ? 'log' : rel.endsWith('.json') ? 'json' : 'text');

// docs: { path: JSON text }, texts: { path: string }, logs: { path: [line objects] }, versions: { path: number } (0 or absent = new).
export function memoryBackend({ docs = {}, texts = {}, logs = {}, versions = {}, loaded = [''] } = {}) {
  const D = new Map(Object.entries(docs).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
  const T = new Map(Object.entries(texts));
  const L = new Map(Object.entries(logs).map(([k, v]) => [k, v.map((x) => JSON.stringify(x))]));
  const appended = new Map();
  const dirty = new Set();
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
      return { docs: docsOut, lines };
    },
  };
}

// Reads a data folder into a snapshot: for tests, and for copying a folder into the platform (E12-S6). Every file starts at version 0.
export function snapshotFromDir(dir) {
  const snap = { docs: {}, texts: {}, logs: {}, versions: {} };
  if (!existsSync(dir)) return snap;
  const walk = (abs, rel) => {
    for (const name of readdirSync(abs).sort()) {
      const a = join(abs, name), r = rel ? `${rel}/${name}` : name;
      if (statSync(a).isDirectory()) { walk(a, r); continue; }
      if (/\.tmp-\d+$/.test(name)) continue;   // a write in progress
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
    if (plan.docs.length || plan.lines.length) await flush(plan);
    return { result, plan };
  } finally {
    unmount();
  }
}
