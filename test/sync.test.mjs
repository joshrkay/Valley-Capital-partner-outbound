// The snapshot sync, against an invented website folder and an invented GitHub stand-in. No real site content is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { buildSnapshot, writeSnapshot, compareSnapshot, localSource, githubSource, wantedFiles, FIXED } from '../scripts/sync-site.mjs';
import { pagePaths } from '../src/rules.mjs';
import { makeDir, put, loadJson } from './kit.mjs';

const claims = loadJson('claims.json').claims;
const SOURCES = [...new Set(claims.filter((c) => c.approved && c.source).map((c) => c.source))];
const PAGES = ['src/pages/index.astro', 'src/pages/banks/index.astro', 'src/pages/banks/what-we-buy.astro', 'src/pages/faq.astro', 'src/pages/contact.astro', 'src/pages/firm.astro', 'src/pages/blog/[...slug].astro', 'src/pages/404.astro'];

function fakeSite() {
  const dir = makeDir();
  for (const f of [...FIXED, ...SOURCES, ...PAGES]) put(dir, f, f.endsWith('.json') ? '{"rules":[]}' : `<p>content of ${f}</p>`);
  return dir;
}

test('page addresses are derived from the website source files; dynamic and 404 pages are left out', () => {
  assert.deepEqual([...pagePaths(PAGES)].sort(), ['/', '/banks/', '/banks/what-we-buy/', '/contact/', '/faq/', '/firm/']);
});

test('the wanted list is the fixed rule files plus every page an approved claim quotes, once each', () => {
  const w = wantedFiles(claims);
  for (const f of FIXED) assert.ok(w.includes(f));
  for (const f of SOURCES) assert.ok(w.includes(f));
  assert.equal(new Set(w).size, w.length);
  assert.equal(wantedFiles([{ approved: false, source: 'src/pages/secret.astro' }]).includes('src/pages/secret.astro'), false);   // unapproved claims need nothing
});

test('local sync writes the files, the page list and a record with hashes; a second check finds no difference; a change is reported', async () => {
  const site = fakeSite(); const out = makeDir();
  const snap = await buildSnapshot(localSource(site), claims);
  writeSnapshot(out, snap);
  for (const f of wantedFiles(claims)) assert.ok(existsSync(join(out, f)), f);
  assert.deepEqual(JSON.parse(readFileSync(join(out, 'pages.json'), 'utf8')), ['/', '/banks/', '/banks/what-we-buy/', '/contact/', '/faq/', '/firm/']);
  const meta = JSON.parse(readFileSync(join(out, 'SNAPSHOT.json'), 'utf8'));
  assert.match(meta.files[SOURCES[0]], /^[0-9a-f]{64}$/);
  assert.deepEqual(compareSnapshot(out, await buildSnapshot(localSource(site), claims)), []);
  put(site, SOURCES[0], '<p>the site changed</p>');
  put(site, 'src/pages/new-page.astro', '<p>new</p>');
  const diffs = compareSnapshot(out, await buildSnapshot(localSource(site), claims));
  assert.ok(diffs.includes(`changed: ${SOURCES[0]}`));
  assert.ok(diffs.includes('new page: /new-page/'));
});

test('a missing source file, or a folder that is not the website, fails with a clear message', async () => {
  const site = fakeSite();
  const empty = makeDir();
  await assert.rejects(buildSnapshot(localSource(empty), claims), /not found/);
  const noPages = { label: 'stub', read: async () => 'x', list: async () => [], commit: async () => '' };   // readable files but no pages: not the website
  await assert.rejects(buildSnapshot(noPages, claims), /No pages found/);
  assert.ok(site);
});

test('GitHub mode reads the same files over HTTP from raw and API addresses, and reports the commit', async () => {
  const site = fakeSite();
  const server = http.createServer((req, res) => {
    const u = req.url;
    if (u === '/repos/acme/site/git/trees/main?recursive=1') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ tree: PAGES.map((p) => ({ type: 'blob', path: p })).concat([{ type: 'tree', path: 'src' }]) })); }
    if (u === '/repos/acme/site/commits/main') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ sha: 'abc1234def' })); }
    const m = u.match(/^\/acme\/site\/main\/(.+)$/);
    if (m && existsSync(join(site, m[1]))) return res.end(readFileSync(join(site, m[1]), 'utf8'));
    res.statusCode = 404; res.end('no');
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const src = githubSource('acme/site', { SYNC_RAW_BASE: base, SYNC_API_BASE: base });
    const snap = await buildSnapshot(src, claims);
    assert.equal(snap.meta.commit, 'abc1234def');
    assert.equal(snap.meta.source, 'acme/site@main');
    assert.deepEqual(snap.pages, ['/', '/banks/', '/banks/what-we-buy/', '/contact/', '/faq/', '/firm/']);
    const local = await buildSnapshot(localSource(site), claims);
    assert.deepEqual(snap.meta.files, local.meta.files);                       // identical content either way
    await assert.rejects(buildSnapshot(githubSource('acme/other', { SYNC_RAW_BASE: base, SYNC_API_BASE: base }), claims), /HTTP 404/);
  } finally { server.close(); }
});
