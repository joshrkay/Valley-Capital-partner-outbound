// PRD E7-S2, E7-S3: the contact stores are for principals and the guard. None of them reaches the drafter: not the known list, the vendor
// tests or passes (contacts/), not the institution's domains, not where each field came from, not how the address was verified. The
// drafter writes to a name and a title; the address is the guard's business. End to end, inside the drafter's own unit of work.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { account, CONTACT, SENDER, makeDir, put } from './kit.mjs';
import { loadRules } from '../src/rules.mjs';
import { readJson } from '../src/store.mjs';
import { LOADS, withUnitOfWork, snapshotFromDir } from '../src/uow.mjs';
import { loadContext } from '../src/guard.mjs';
import { runDrafter, buildDraftPrompt } from '../src/draft.mjs';

const rules = loadRules();
// Distinctive invented values, so a leak is easy to spot.
const EMAIL = 'quillon.marsh@zebrafinch.test';
const PAGE = 'https://zebrafinch.test/our-leaders-7731';
const seen = { kind: 'institution_site', url: PAGE, seenOn: '2026-11-01', by: 'Pat Example', at: '2026-11-01T12:00:00.000Z' };
const A = account({
  person: { ...account().person, email: EMAIL },
  domains: [{ domain: 'zebrafinch.test', kind: 'institution_site', url: PAGE, seenOn: '2026-11-01', confirmedBy: 'Pat Example', confirmedAt: '2026-11-01T12:00:00.000Z' }],
  contact: CONTACT({
    provenance: [{ field: 'name', value: 'Jordan Sample', ...seen }, { field: 'title', value: 'Chief Credit Officer', ...seen }, { field: 'email', value: EMAIL, ...seen, kind: 'vendor', vendor: 'lemur-data-4417' }],
    verification: { email: EMAIL, method: 'vendor', vendor: 'lemur-data-4417', seenOn: '2026-11-01', by: 'Pat Example', at: '2026-11-01T12:00:00.000Z', verifiedOn: '2026-11-01', checks: { syntax: 'pass', business: 'pass', domain: 'zebrafinch.test', mx: 'pass' } },
  }),
});
const LEAKS = ['zebrafinch', 'quillon', 'our-leaders', '7731', 'lemur', '4417', 'Marigold', 'institution_site', 'verified', 'vendor', 'provenance', 'domain', 'known.json', 'k99'];

test('the contact stores never reach the drafter, and its unit of work cannot load them', async () => {
  // The drafter's load list covers no contacts/ path, and none of the new actions' lists is the drafter's.
  for (const p of ['contacts/known.json', 'contacts/vendors.json', 'contacts/vendor-tests/lemur-data-4417-2026-11-13.json']) assert.ok(!LOADS.draft.some((x) => x === '' || p.startsWith(x)), `LOADS.draft covers ${p}`);
  for (const k of ['person', 'domain', 'verify', 'forget', 'vendors']) assert.ok(Array.isArray(LOADS[k]), `LOADS.${k}`);

  const dir = makeDir();
  put(dir, `accounts/${A.id}.json`, A);
  put(dir, 'senders.json', { senders: [SENDER] });
  put(dir, `facts/${A.id}.json`, [{ id: `${A.id}:F1`, kind: 'intent', claim: 'The bank says it intends to reduce its loan concentrations.', quote: 'intends to reduce', url: 'https://example.test/q3', publisher: 'Example', published: '2026-10-28', tier: 'company', use: 'draft', asset_specific: false }]);
  put(dir, `research/${A.id}.json`, { account: A.id, riskScreen: { approach: 'ok', reasons: [], finding_ids: [] }, personCheck: { status: 'confirmed' } });
  put(dir, 'touches.jsonl', `${JSON.stringify({ type: 'touch', accountId: A.id, step: 1, channel: 'letter', sender: 'pat', date: '2026-11-10' })}\n`);
  put(dir, 'contacts/known.json', { people: [{ id: 'k99', name: 'Marigold Testperson', institution: A.name, email: 'marigold@zebrafinch.test', title: 'President', asOf: '2026-10-01' }] });
  put(dir, 'contacts/vendors.json', { passes: { 'lemur-data-4417': { vendor: 'Lemur Data 4417', passed: true, by: 'Pat Example' } } });
  put(dir, 'contacts/vendor-tests/lemur-data-4417-2026-11-13.json', { vendor: 'lemur-data-4417', rows: [{ ref: 'k99' }] });
  const snap = snapshotFromDir(dir);
  assert.ok(snap.docs['contacts/known.json'], 'the known list is in the data folder');

  const { result: d } = await withUnitOfWork({ load: async () => snap, flush: async () => {} }, LOADS.draft, async (root) => {
    for (const p of ['known.json', 'vendors.json']) assert.throws(() => readJson(join(root, 'contacts', p)), /was not loaded/);
    const ctx = loadContext({ dir: root, config: rules.config, env: {} });
    return runDrafter({ client: null, dir: root, account: A, channel: 'email', step: 2, senderId: 'pat', date: '2026-11-16', ctx, rules, dryRun: true });
  });
  assert.equal(d.dryRun, true, `the guard let the email through, so the drafter ran: ${JSON.stringify(d)}`);
  const both = d.system + d.user;
  for (const leak of [...LEAKS, EMAIL]) assert.ok(!both.includes(leak), `drafter input leaked "${leak}"`);

  // The prompt builder itself, given the whole account: only the name, title, institution, audience and sector.
  const p = buildDraftPrompt({ account: A, channel: 'letter', step: 1, sender: SENDER, facts: [], claims: rules.claims, priorTouches: [], rules });
  for (const leak of [...LEAKS, EMAIL]) assert.ok(!(p.system + p.user).includes(leak), `prompt leaked "${leak}"`);
  assert.match(p.user, /"name":"Jordan Sample"/);
});
