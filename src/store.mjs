// Storage for the data folder. Every read and write in the engine goes through these helpers, so the same engine runs on two backends
// (PRD E12-S1): a data folder on disk (the default, and what the command line uses), or a unit of work held in memory, which the
// platform loads from Postgres, runs the engine against, then writes back in one transaction (src/uow.mjs). A backend is mounted at a
// root path; every path under that root goes to it, and every other path goes to the disk. The engine never knows which it is using.
// On disk, JSON is written atomically and JSONL files are append-only logs.
import { readFileSync, writeFileSync, appendFileSync, renameSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

const mounts = new Map();   // absolute root -> backend

export function mount(root, backend) {
  const r = resolve(root);
  if (mounts.has(r)) throw new Error(`A storage backend is already mounted at ${r}.`);
  mounts.set(r, backend);
  return () => mounts.delete(r);
}

function route(p) {
  if (!mounts.size) return null;
  const abs = resolve(p);
  for (const [root, backend] of mounts) {
    if (abs === root) return { backend, rel: '' };
    if (abs.startsWith(root + sep)) return { backend, rel: abs.slice(root.length + 1).split(sep).join('/') };
  }
  return null;
}

export const readJson = (p, fallback) => {
  const r = route(p);
  if (r) return r.backend.readJson(r.rel, fallback);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : fallback;
};

export function writeJson(p, data) {
  const r = route(p);
  if (r) return r.backend.writeJson(r.rel, data);
  mkdirSync(dirname(p), { recursive: true });
  const tmp = `${p}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  renameSync(tmp, p);
}

export const readText = (p, fallback = null) => {
  const r = route(p);
  if (r) return r.backend.readText(r.rel, fallback);
  return existsSync(p) ? readFileSync(p, 'utf8') : fallback;
};

export function writeText(p, text) {
  const r = route(p);
  if (r) return r.backend.writeText(r.rel, text);
  mkdirSync(dirname(p), { recursive: true });
  const tmp = `${p}.tmp-${process.pid}`;
  writeFileSync(tmp, text);
  renameSync(tmp, p);
}

export function appendJsonl(p, obj) {
  const r = route(p);
  if (r) return r.backend.appendJsonl(r.rel, obj);
  mkdirSync(dirname(p), { recursive: true });
  appendFileSync(p, JSON.stringify(obj) + '\n');
}

export const readJsonl = (p) => {
  const r = route(p);
  if (r) return r.backend.readJsonl(r.rel);
  return existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
};

export const listFiles = (dir, ext) => {
  const r = route(dir);
  if (r) return r.backend.listFiles(r.rel, ext);
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(ext)).sort() : [];
};

export const exists = (p) => {
  const r = route(p);
  if (r) return r.backend.exists(r.rel);
  return existsSync(p);
};

// Every decision and action is logged here: who, what, when. Never holds message text.
export const audit = (dir, event) => appendJsonl(join(dir, 'audit.jsonl'), { ts: new Date().toISOString(), ...event });

// Account ids become file names, so they are restricted to a safe shape.
export function safeId(id) {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(String(id ?? ''))) throw new Error(`Invalid id "${id}". Use lowercase letters, digits, hyphens and underscores (up to 64 characters).`);
  return id;
}
