// PRD E22: the firm's network (network/) and the routes (routes/) never reach the drafter or the briefer. Matching happens in code, so no
// model sees the network. Proved three ways: the load lists, the code, and end to end with a network, research, routes and a chosen
// route in the data folder. Every name is invented, and the network's names are distinctive so a leak is easy to spot.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';
import { REPO, models, put } from './kit.mjs';
import { rules, ID, NOW, BY, FINDINGS, world } from './routes-kit.mjs';
import { readJson } from '../src/store.mjs';
import { LOADS, withUnitOfWork, snapshotFromDir } from '../src/uow.mjs';
import { loadContext } from '../src/guard.mjs';
import { runDrafter } from '../src/draft.mjs';
import { runBriefer } from '../src/research.mjs';
import { buildRoutes, chooseRoute } from '../src/routes.mjs';

const covers = (prefix, rel) => prefix === '' || rel === prefix || (prefix.endsWith('/') && rel.startsWith(prefix));
const PRIVATE = ['network/network.json', `routes/${ID}.json`, `routes/${ID}.md`];
// What only the network holds: names, relationships, who knows whom, and the entry ids. ("CREFC", the membership's name, is left out:
// the playbook itself names CREFC as a forum to look for, so the briefer is meant to see that word.)
const NETWORK_LEAKS = ['Casey Example', 'Avery Invented', 'Morgan Unrelated', 'Invented Loan Advisors', 'co-investor', 'former colleague', 'neighbor', 'Lee Example', 'Unrelated Holdings', 'np-1', 'np-2', 'nf-3', 'nm-4', 'introConsent', 'knownBy'];

test('no model-facing action loads network/ or routes/: not the drafter, not the briefer, not call prep', () => {
  for (const kind of ['draft', 'research', 'pilot', 'callPrep', 'callNotes', 'callExtract', 'callConfirm', 'outcomes', 'triage', 'candidates', 'score']) {
    for (const p of PRIVATE) assert.ok(!LOADS[kind].some((x) => covers(x, p)), `LOADS.${kind} covers ${p}`);
  }
  assert.ok(LOADS.routes.includes('network/') && LOADS.network.includes('network/'), 'only the routes and network actions load it');
});

test('no drafter or briefer code reads network/ or routes/, or imports the modules that do', () => {
  for (const f of ['src/draft.mjs', 'src/lint.mjs', 'src/research.mjs', 'src/model.mjs', 'src/calls.mjs', 'src/pilot.mjs']) {
    const code = readFileSync(join(REPO, f), 'utf8');
    assert.doesNotMatch(code, /from\s+['"]\.\/(network|routes)\.mjs['"]/, `${f} imports the network or routes module`);
    assert.doesNotMatch(code, /['"`](network|routes)\/|join\([^)]*['"](network|routes)['"]/, `${f} names the network/ or routes/ folder`);
  }
  const worker = readFileSync(join(REPO, 'src', 'platform', 'worker.mjs'), 'utf8');
  assert.doesNotMatch(worker, /routes\.mjs|network\.mjs/, 'no job runs the routes or the network; both run in units of work from the command line and the web');
});

async function fullFolder() {
  const dir = world();
  // The facts file the briefer would write: the route topics are context only (src/research.mjs decideUse); one draftable fact.
  put(dir, `facts/${ID}.json`, [
    { id: `${ID}:F0`, kind: 'intent', claim: 'The bank says it intends to reduce its multifamily loans through sales.', quote: 'intends to reduce multifamily loans through sales', url: 'https://acmebank.test/q3', publisher: 'Acme Community Bank', published: '2026-10-28', tier: 'company', use: 'draft', asset_specific: false },
    ...FINDINGS.map((f) => ({ id: `${ID}:${f.id}`, kind: f.kind, claim: f.claim, quote: f.quote, url: f.source_url, publisher: f.publisher, published: f.published, tier: f.evidence_tier, use: 'context', asset_specific: f.asset_specific })),
  ]);
  const rec = buildRoutes({ dir, id: ID, rules, now: NOW, env: {} });
  chooseRoute({ dir, id: ID, routeId: rec.routes.find((r) => r.type === 'counsel').id, by: BY, rules, now: NOW, env: {} });
  return { dir, rec };
}

test('end to end: with a network, routes and a chosen route in the data folder, the drafter cannot load them and its input carries none of them', async () => {
  const { dir, rec } = await fullFolder();
  const account = readJson(join(dir, 'accounts', `${ID}.json`));
  assert.ok(!JSON.stringify(account).match(/routes|network|np-\d/), 'choosing a route writes nothing to the account');
  const snap = snapshotFromDir(dir);
  for (const p of PRIVATE) assert.ok(snap.docs[p] || snap.texts[p], `${p} is in the data folder`);
  const { result: d } = await withUnitOfWork({ load: async () => snap, flush: async () => {} }, LOADS.draft, async (root) => {
    for (const p of PRIVATE) assert.throws(() => readJson(join(root, p)), /was not loaded/, p);
    const ctx = loadContext({ dir: root, config: rules.config, env: {} });
    return runDrafter({ client: null, dir: root, account, channel: 'letter', step: 1, senderId: 'pat', date: '2026-11-16', ctx, rules, dryRun: true });
  });
  assert.equal(d.dryRun, true, JSON.stringify(d));
  const both = `${d.system}\n${d.user}`;
  for (const leak of [...NETWORK_LEAKS, 'CREFC', ...rec.routes.map((r) => r.id), 'Sample & Sample', 'Casey Q. Example', 'Riley Counsel', 'Example State Bankers', 'CRE Finance Council', 'bank.board', 'bank.counsel'])
    assert.ok(!both.includes(leak), `drafter input leaked "${leak}"`);
  assert.match(d.user, /intends to reduce its multifamily loans through sales/, 'the drafter still gets its one cleared fact');
});

test('end to end: the briefer\'s prompt carries nothing from the network or the routes, and its unit of work cannot load them', async () => {
  const { dir, rec } = await fullFolder();
  const account = readJson(join(dir, 'accounts', `${ID}.json`));
  const snap = snapshotFromDir(dir);
  const { result: b } = await withUnitOfWork({ load: async () => snap, flush: async () => {} }, LOADS.research, async (root) => {
    for (const p of PRIVATE) assert.throws(() => readJson(join(root, p)), /was not loaded/, p);
    return runBriefer({ client: null, dir: root, account, models: models(), playbooks: rules.playbooks, now: NOW, dryRun: true });
  });
  assert.equal(b.dryRun, true);
  const both = `${b.system}\n${b.user}`;
  for (const leak of [...NETWORK_LEAKS, ...rec.routes.map((r) => r.id), 'Sample & Sample', 'Casey Q. Example', 'Riley Counsel']) assert.ok(!both.includes(leak), `briefer prompt leaked "${leak}"`);
  assert.match(b.user, /bank\.counsel/, 'the briefer is asked the route questions, with no answer from the network');
});

test('the files the network and the routes write all live in the data folder; none is in the repository', async () => {
  const { dir } = await fullFolder();
  assert.deepEqual(readdirSync(join(dir, 'routes')).sort(), [`${ID}.json`, `${ID}.md`]);
  assert.deepEqual(readdirSync(join(dir, 'network')), ['network.json']);
  for (const name of ['network', 'routes']) assert.ok(!readdirSync(REPO).includes(name), `a ${name}/ folder in the repository`);
});
