// Server only. Loads the engine (the repository's src/) at runtime instead of bundling it. The engine finds its rule files from its own
// location (import.meta.url), which only works if Node loads the real files, so the import is marked for both bundlers to leave alone.
// The same engine code runs here as on the command line; that is the point of the platform design (PRD E12-S1).
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

let root;
export function engineRoot() {
  if (root) return root;
  const tries = [process.env.ENGINE_ROOT, resolve(process.cwd(), '..'), process.cwd()].filter(Boolean);
  root = tries.find((p) => existsSync(join(p, 'src', 'uow.mjs')));
  if (!root) throw new Error(`The engine was not found (looked for src/uow.mjs in ${tries.join(', ')}). Set ENGINE_ROOT to the repository root.`);
  return root;
}

const cache = new Map();
// engine('src/candidates.mjs') -> that module's exports.
export function engine(rel) {
  if (!cache.has(rel)) {
    const href = pathToFileURL(join(engineRoot(), rel)).href;
    cache.set(rel, import(/* webpackIgnore: true */ /* turbopackIgnore: true */ href));
  }
  return cache.get(rel);
}

// The committed rule files, loaded once per server process.
let rules;
export async function loadRules() {
  if (!rules) rules = (await engine('src/rules.mjs')).loadRules();
  return rules;
}
