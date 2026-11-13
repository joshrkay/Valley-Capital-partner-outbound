#!/usr/bin/env node
// Refreshes site-snapshot/: a copy of the few website files this repository's rules depend on. The website is a separate repository.
//   node scripts/sync-site.mjs --from ../Valley-Capital-partner          from a local checkout of the website
//   node scripts/sync-site.mjs --github joshrkay/Valley-Capital-partner  from the public website repo on GitHub (default branch: main; add @ref for another)
//   add --check to compare without writing; exits 1 if the snapshot is stale (use it before relying on the claims)
// What it copies: the rule files the linter reads, the website pages that approved claims quote word for word, and the list of page addresses.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { REPO } from '../src/paths.mjs';
import { pagePaths } from '../src/rules.mjs';

export const FIXED = ['desk/lint.json', 'scripts/terminology.json', 'docs/terminology.md'];
const sha = (s) => createHash('sha256').update(s).digest('hex');

export const wantedFiles = (claims) => [...new Set([...FIXED, ...claims.filter((c) => c.approved && c.source).map((c) => c.source)])].sort();

export function localSource(dir) {
  const root = resolve(dir);
  const walk = (d, out = []) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p, out); else out.push(p); } return out; };
  return {
    label: root,
    read: async (p) => { const f = join(root, p); if (!existsSync(f)) throw new Error(`${p} not found in ${root}`); return readFileSync(f, 'utf8'); },
    list: async () => (existsSync(join(root, 'src/pages')) ? walk(join(root, 'src/pages')).map((f) => f.slice(root.length + 1).replace(/\\/g, '/')) : []),
    commit: async () => { try { return execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { return ''; } },
  };
}

export function githubSource(spec, env = process.env) {
  const [repo, ref = 'main'] = spec.split('@');
  const raw = env.SYNC_RAW_BASE ?? 'https://raw.githubusercontent.com';
  const api = env.SYNC_API_BASE ?? 'https://api.github.com';
  const get = async (url, json) => {
    const res = await fetch(url, { headers: { 'User-Agent': 'valley-outbound-sync', Accept: json ? 'application/vnd.github+json' : '*/*' } });
    if (!res.ok) throw new Error(`${url} answered HTTP ${res.status}`);
    return json ? res.json() : res.text();
  };
  return {
    label: `${repo}@${ref}`,
    read: (p) => get(`${raw}/${repo}/${ref}/${p}`, false),
    list: async () => ((await get(`${api}/repos/${repo}/git/trees/${ref}?recursive=1`, true)).tree ?? []).filter((t) => t.type === 'blob' && t.path.startsWith('src/pages/')).map((t) => t.path),
    commit: async () => (await get(`${api}/repos/${repo}/commits/${ref}`, true)).sha ?? '',
  };
}

export async function buildSnapshot(source, claims) {
  const files = new Map();
  for (const p of wantedFiles(claims)) files.set(p, await source.read(p));
  const pages = [...pagePaths(await source.list())].sort();
  if (!pages.length) throw new Error('No pages found under src/pages in the website source. Is it the right repository?');
  return { files, pages, meta: { source: source.label, commit: await source.commit(), fetchedAt: new Date().toISOString(), files: Object.fromEntries([...files].map(([k, v]) => [k, sha(v)])) } };
}

export function writeSnapshot(outDir, snap) {
  for (const [p, text] of snap.files) { const f = join(outDir, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, text); }
  writeFileSync(join(outDir, 'pages.json'), JSON.stringify(snap.pages, null, 2) + '\n');
  writeFileSync(join(outDir, 'SNAPSHOT.json'), JSON.stringify(snap.meta, null, 2) + '\n');
}

// Differences between what is on disk and a fresh snapshot (ignores the fetch time and commit).
export function compareSnapshot(outDir, snap) {
  const diffs = [];
  for (const [p, text] of snap.files) {
    const f = join(outDir, p);
    if (!existsSync(f)) diffs.push(`missing: ${p}`);
    else if (readFileSync(f, 'utf8') !== text) diffs.push(`changed: ${p}`);
  }
  const pj = join(outDir, 'pages.json');
  const have = existsSync(pj) ? JSON.parse(readFileSync(pj, 'utf8')) : [];
  for (const p of snap.pages.filter((x) => !have.includes(x))) diffs.push(`new page: ${p}`);
  for (const p of have.filter((x) => !snap.pages.includes(x))) diffs.push(`page removed: ${p}`);
  return diffs;
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (k) => { const i = args.indexOf(`--${k}`); return i < 0 ? undefined : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true); };
  const from = flag('from'); const gh = flag('github');
  if (!from && !gh) { console.error('Say where the website is: --from <path to a checkout> or --github owner/repo[@ref]'); process.exit(2); }
  const out = resolve(flag('out') && flag('out') !== true ? flag('out') : join(REPO, 'site-snapshot'));
  const claims = JSON.parse(readFileSync(join(REPO, 'claims.json'), 'utf8')).claims;
  const snap = await buildSnapshot(from ? localSource(from) : githubSource(gh), claims);
  if (flag('check')) {
    const diffs = compareSnapshot(out, snap);
    if (diffs.length) { console.error(`The snapshot is stale (${diffs.length} difference${diffs.length > 1 ? 's' : ''}):\n  ${diffs.join('\n  ')}\nRun: npm run sync-site -- ${from ? `--from ${from}` : `--github ${gh}`}`); process.exit(1); }
    console.log(`Snapshot matches ${snap.meta.source}${snap.meta.commit ? ` at ${snap.meta.commit.slice(0, 7)}` : ''}.`);
    return;
  }
  writeSnapshot(out, snap);
  console.log(`Snapshot written to ${out} from ${snap.meta.source}${snap.meta.commit ? ` at ${snap.meta.commit.slice(0, 7)}` : ''}: ${snap.files.size} files, ${snap.pages.length} pages.\nRun the tests: npm test. If a claim no longer matches the site, update or re-approve it.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((e) => { console.error(`Error: ${e.message}`); process.exit(1); });
