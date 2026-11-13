// Loads every committed rule file in one place: config, models, claims, terminology, playbooks, plus the few website files the rules depend on.
// Those website files are a SNAPSHOT in site-snapshot/ (the website is a separate repository). Refresh it with `npm run sync-site`.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { REPO, SITE } from './paths.mjs';

const json = (p) => JSON.parse(readFileSync(p, 'utf8'));

// Turns a list of website source files (relative paths) into the site's page addresses: src/pages/banks/index.astro -> /banks/
export function pagePaths(relFiles) {
  const out = new Set();
  for (const f of relFiles) {
    if (!f.startsWith('src/pages/') || !f.endsWith('.astro') || f.includes('[') || f.endsWith('/404.astro')) continue;
    let rel = '/' + f.slice('src/pages/'.length).replace(/\.astro$/, '');
    rel = rel.replace(/\/index$/, '') + '/';
    out.add(rel.replace(/\/\/+/g, '/'));
  }
  return out;
}

export function sitePages(siteRoot = SITE) {
  const p = join(siteRoot, 'pages.json');
  if (!existsSync(p)) throw new Error('site-snapshot/pages.json is missing. Run: npm run sync-site -- --from <path to the website repo>  (or --github owner/repo)');
  return new Set(json(p));
}

export function loadRules(root = REPO) {
  const o = (f) => json(join(root, f));
  const site = join(root, 'site-snapshot');
  const terminology = o('terminology.json');
  const siteRules = json(join(site, terminology.bankRulesFrom));
  return {
    config: o('config.json'),
    models: o('models.json'),
    claims: o('claims.json').claims,
    terminology,
    playbooks: o('playbooks.json'),
    metros: o('metros.json'),
    desk: json(join(site, 'desk/lint.json')),
    bankAvoid: siteRules.rules.find((r) => r.scope === '/banks/')?.avoid ?? [],
    pages: sitePages(site),
  };
}
