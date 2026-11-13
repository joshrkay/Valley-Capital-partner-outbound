// Small file helpers for the data directory. JSON is written atomically; JSONL files are append-only logs.
import { readFileSync, writeFileSync, appendFileSync, renameSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const readJson = (p, fallback) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : fallback);

export function writeJson(p, data) {
  mkdirSync(dirname(p), { recursive: true });
  const tmp = `${p}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  renameSync(tmp, p);
}

export function writeText(p, text) {
  mkdirSync(dirname(p), { recursive: true });
  const tmp = `${p}.tmp-${process.pid}`;
  writeFileSync(tmp, text);
  renameSync(tmp, p);
}

export function appendJsonl(p, obj) {
  mkdirSync(dirname(p), { recursive: true });
  appendFileSync(p, JSON.stringify(obj) + '\n');
}

export const readJsonl = (p) => (existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

export const listFiles = (dir, ext) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(ext)).sort() : []);

// Every decision and action is logged here: who, what, when. Never holds message text.
export const audit = (dir, event) => appendJsonl(join(dir, 'audit.jsonl'), { ts: new Date().toISOString(), ...event });

// Account ids become file names, so they are restricted to a safe shape.
export function safeId(id) {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(String(id ?? ''))) throw new Error(`Invalid id "${id}". Use lowercase letters, digits, hyphens and underscores (up to 64 characters).`);
  return id;
}
