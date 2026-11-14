// PRD E7-S3 and E17 together: the three private stores, the routes (routes/), the firm's network (network/) and the contact stores
// (contacts/: the known list, the vendor tests and passes), never reach a model. Not the briefer, not the drafter, not call prep, not the
// reading of call notes. Proved by the load lists, and end to end with all three stores in one data folder, each model-facing action run
// (dry) inside a unit of work loaded with exactly its own load list. Every name is invented and distinctive, so a leak is easy to spot.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { models, put } from './kit.mjs';
import { rules, ID, NOW, BY, world } from './routes-kit.mjs';
import { readJson } from '../src/store.mjs';
import { LOADS, withUnitOfWork, snapshotFromDir } from '../src/uow.mjs';
import { loadContext } from '../src/guard.mjs';
import { runDrafter } from '../src/draft.mjs';
import { runBriefer } from '../src/research.mjs';
import { runCallPrep, callLoads } from '../src/calls.mjs';
import { buildRoutes, chooseRoute } from '../src/routes.mjs';

const covers = (prefix, rel) => prefix === '' || rel === prefix || (prefix.endsWith('/') && rel.startsWith(prefix));
const PRIVATE = ['network/network.json', `routes/${ID}.json`, `routes/${ID}.md`, 'contacts/known.json', 'contacts/vendors.json', 'contacts/vendor-tests/lemur-data-4417-2026-11-13.json'];
const MODEL_FACING = { research: LOADS.research, draft: LOADS.draft, callPrep: LOADS.callPrep, callPrepNarrowed: callLoads('callPrep', ID), callExtract: LOADS.callExtract, callExtractNarrowed: callLoads('callExtract', ID) };
// What only the private stores hold. ("CREFC" is left out: the playbook names it as a forum to look for. So is the advisor firm's name:
// the research names it too, as the lender side, and call prep reads the research by design. Its network entry's relationship is here.)
const LEAKS = ['Casey Example', 'Avery Invented', 'Morgan Unrelated', 'we bid on their sales', 'co-investor', 'former colleague', 'neighbor', 'Lee Example', 'Unrelated Holdings', 'np-1', 'np-2', 'nf-3', 'nm-4', 'introConsent', 'knownBy',
  'Marigold Testperson', 'marigold@', 'zebrafinch', 'lemur', '4417', 'k99', 'vendor-tests', 'checklist', 'Who to ask'];

test('no model-facing action loads routes/, network/ or contacts/', () => {
  for (const [kind, list] of Object.entries(MODEL_FACING)) for (const p of PRIVATE) assert.ok(!list.some((x) => covers(x, p)), `${kind} covers ${p}`);
});

async function fullFolder() {
  const dir = world();
  put(dir, `facts/${ID}.json`, [{ id: `${ID}:F0`, kind: 'intent', claim: 'The bank says it intends to reduce its multifamily loans through sales.', quote: 'intends to reduce multifamily loans through sales', url: 'https://acmebank.test/q3', publisher: 'Acme Community Bank', published: '2026-10-28', tier: 'company', use: 'draft', asset_specific: false }]);
  put(dir, 'contacts/known.json', { people: [{ id: 'k99', name: 'Marigold Testperson', institution: 'Acme Community Bank', email: 'marigold@zebrafinch.test', title: 'President', asOf: '2026-10-01' }] });
  put(dir, 'contacts/vendors.json', { passes: { 'lemur-data-4417': { vendor: 'Lemur Data 4417', passed: true, by: BY } } });
  put(dir, 'contacts/vendor-tests/lemur-data-4417-2026-11-13.json', { vendor: 'lemur-data-4417', date: '2026-11-13', rows: [{ ref: 'k99', email: 'correct', title: 'current' }] });
  const rec = buildRoutes({ dir, id: ID, rules, now: NOW, env: {} });
  chooseRoute({ dir, id: ID, routeId: rec.routes.find((r) => r.type === 'board').id, by: BY, rules, now: NOW, env: {} });
  return { dir, rec, snap: snapshotFromDir(dir), account: readJson(join(dir, 'accounts', `${ID}.json`)) };
}

const leaked = (text, rec) => [...LEAKS, ...rec.routes.map((r) => r.id).filter((x) => x !== 'r-direct')].filter((x) => text.includes(x));

test('end to end, with all three stores in the data folder: the briefer, the drafter and call prep cannot load them, and their prompts carry none of them', async () => {
  const { rec, snap, account } = await fullFolder();
  for (const p of PRIVATE) assert.ok(snap.docs[p] || snap.texts[p], `${p} is in the data folder`);
  const blind = (root) => { for (const p of PRIVATE) assert.throws(() => readJson(join(root, p)), /was not loaded/, p); };
  const inUow = async (load, fn) => (await withUnitOfWork({ load: async () => snap, flush: async () => {} }, load, async (root) => { blind(root); return fn(root); })).result;

  const brief = await inUow(LOADS.research, (root) => runBriefer({ client: null, dir: root, account, models: models(), playbooks: rules.playbooks, now: NOW, dryRun: true }));
  assert.equal(brief.dryRun, true);
  assert.deepEqual(leaked(`${brief.system}\n${brief.user}`, rec), [], 'the briefer\'s prompt');

  const draft = await inUow(LOADS.draft, (root) => runDrafter({ client: null, dir: root, account, channel: 'letter', step: 1, senderId: 'pat', date: '2026-11-16', ctx: loadContext({ dir: root, config: rules.config, env: {} }), rules, dryRun: true }));
  assert.equal(draft.dryRun, true, JSON.stringify(draft));
  assert.deepEqual(leaked(`${draft.system}\n${draft.user}`, rec), [], 'the drafter\'s input');

  const prep = await inUow(callLoads('callPrep', ID), (root) => runCallPrep({ client: null, dir: root, account, date: '2026-11-16', rules, ctx: loadContext({ dir: root, config: rules.config, env: {} }), now: NOW, dryRun: true }));
  assert.equal(prep.dryRun, true);
  assert.deepEqual(leaked(`${prep.system}\n${prep.user}`, rec), [], 'the call brief\'s prompt');
});
