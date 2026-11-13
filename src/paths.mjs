// Where prospect data lives. The rule: never inside this repository (Git history cannot be fully erased, and a repo can change hands or visibility).
// The data directory comes from OUTBOUND_DATA_DIR and is refused if it resolves to a place inside the repo, including through a symlink.
import { resolve, join, relative, isAbsolute, dirname } from 'node:path';
import { realpathSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SITE = join(REPO, 'site-snapshot');   // a copy of the few website files the rules depend on (npm run sync-site)

// realpath of the deepest part of the path that exists, plus the rest, so a not-yet-created directory is still judged correctly.
function resolveReal(p) {
  let cur = resolve(p);
  const rest = [];
  while (!existsSync(cur)) {
    const up = dirname(cur);
    if (up === cur) break;
    rest.unshift(cur.slice(up.length).replace(/^[\\/]+/, ''));
    cur = up;
  }
  return join(realpathSync(cur), ...rest);
}

export function insideRepo(p, repo = REPO) {
  const rel = relative(realpathSync(repo), resolveReal(p));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

export function dataDir(env = process.env, repo = REPO) {
  const raw = env.OUTBOUND_DATA_DIR;
  if (!raw) throw new Error('OUTBOUND_DATA_DIR is not set. Point it at a private folder outside this repository (for example ~/valley-outbound-data). Prospect data must not be stored in the repo.');
  if (insideRepo(raw, repo)) throw new Error(`OUTBOUND_DATA_DIR (${raw}) is inside the repository. Prospect data, suppression lists, and briefs must never be committed. Choose a folder outside it.`);
  const dir = resolveReal(raw);
  mkdirSync(dir, { recursive: true });
  return dir;
}
