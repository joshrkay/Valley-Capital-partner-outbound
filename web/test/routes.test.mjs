// The account page's routes section and the network page (PRD E22-S7), through web/lib/routes-ops.mjs, against the repository's fake
// Supabase REST API. Building routes is code, so it runs in a unit of work as the signed-in principal: no job is queued, nothing is
// drafted or sent. Invented data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fakePostgrest } from '../../test/postgrest-fake.mjs';
import { platformClient } from '../../src/platform/client.mjs';
import { snapshotFromDir } from '../../src/uow.mjs';
import { world, ID, BY } from '../../test/routes-kit.mjs';
import * as ro from '../lib/routes-ops.mjs';
import { routeRow, evidenceLinks } from '../lib/routes-view.mjs';

const URL_ = 'https://example-project.supabase.test';
const NAMES = ['Casey Example', 'Avery Invented', 'Invented Loan Advisors', 'CREFC', 'Morgan Unrelated', 'Robin Invented', 'Quinn Invented'];

async function seeded({ network = false } = {}) {
  const fake = fakePostgrest();
  const client = platformClient({ url: URL_, key: 'anon-key', accessToken: 'user:pat@example.test', fetchImpl: fake.fetchImpl });
  const snap = snapshotFromDir(world({ network }));
  await client.flush({ docs: [...Object.entries(snap.docs).map(([p, body]) => ({ path: p, kind: 'json', body, baseVersion: 0 })), ...Object.entries(snap.texts).map(([p, text]) => ({ path: p, kind: 'text', text, baseVersion: 0 }))], lines: Object.entries(snap.logs).flatMap(([p, ls]) => ls.map((l) => ({ path: p, line: l }))) });
  fake.calls.length = 0;
  return { fake, client };
}
const auditLines = (fake) => fake.lines.filter((l) => l.path === 'audit.jsonl').map((l) => l.line);

test('the network page: a principal adds people, firms and memberships, sees them with their uses, and every audit line carries ids only', async () => {
  const { fake, client } = await seeded();
  assert.deepEqual((await ro.networkOverview(client, { by: BY })).people, []);
  const p = await ro.addNetworkPerson(client, { name: 'Casey Example', organization: 'Example Grove Partners', relationship: 'co-investor', knownBy: BY, introConsent: 'yes', by: BY });
  await ro.addNetworkFirm(client, { name: 'Invented Loan Advisors', kind: 'advisor', knownBy: BY, by: BY });
  await ro.addNetworkMembership(client, { association: 'CREFC', aliases: 'CRE Finance Council', principal: BY, by: BY });
  await assert.rejects(ro.addNetworkPerson(client, { name: 'Quinn Invented', knownBy: BY, relationship: 'quinn@example.test', by: BY }), /no email address or phone number/);
  await assert.rejects(ro.addNetworkPerson(client, { name: 'Quinn Invented', knownBy: BY, by: '' }), /--by/);
  assert.equal(p.id, 'np-1');
  assert.equal(fake.docs.get('network/network.json').updated_by, 'pat@example.test', 'written as the signed-in principal');
  const n = await ro.networkOverview(client, { by: BY });
  assert.deepEqual([n.people.length, n.firms.length, n.memberships.length], [1, 1, 1]);
  assert.deepEqual(auditLines(fake).map((l) => l.type), ['network_viewed', 'network_added', 'network_added', 'network_added', 'network_viewed']);
  for (const leak of NAMES) assert.ok(!JSON.stringify(auditLines(fake)).includes(leak), `audit leaked "${leak}"`);
  assert.equal(fake.jobs.length, 0, 'nothing is queued');
});

test('the routes section: nothing until built; building runs in a unit of work narrowed to the account; then the ranked routes', async () => {
  const { fake, client } = await seeded({ network: true });
  assert.equal(await ro.accountRoutes(client, ID), null);
  await assert.rejects(ro.accountRoutes(client, '../x'), /Invalid id/);
  const summary = await ro.buildAccountRoutes(client, { id: ID });
  assert.deepEqual([summary.routes, summary.held], [5, 0]);
  assert.equal(fake.jobs.length, 0, 'building routes is code: it is not a job');
  const loads = fake.calls.filter((c) => c.method === 'GET' && c.path === 'documents').map((c) => c.query.or).join(' ');
  for (const leak of ['drafts', 'facts', 'briefs', 'beta-bank', 'calls/']) assert.ok(!loads.includes(leak), `the build loaded ${leak}`);
  assert.match(loads, /routes\/acme-bank\.json/);
  const rec = await ro.accountRoutes(client, ID);
  assert.deepEqual(rec.routes.map((r) => r.type), ['board', 'counsel', 'advisor', 'forum', 'direct']);
  const row = routeRow(rec.routes[0]);
  assert.deepEqual([row.type, row.target, row.bridge, row.tier, row.current], ['Board', 'Casey Q. Example', 'Casey Example (np-1)', 'reported', true]);
  assert.deepEqual(evidenceLinks(rec.routes[0]).map((e) => [e.label, e.href]), [['F2', 'https://acmebank.test/about/board'], ['network np-1', null]]);
  assert.equal(routeRow(rec.routes.at(-1)).bridge, '–');
});

test('choosing from the page records the choice and its checklist; nothing is drafted, queued or recorded as a touch', async () => {
  const { fake, client } = await seeded({ network: true });
  await ro.buildAccountRoutes(client, { id: ID });
  const rec = await ro.accountRoutes(client, ID);
  const counsel = rec.routes.find((r) => r.type === 'counsel');
  const r = await ro.chooseRoute(client, { id: ID, route: counsel.id, by: BY });
  assert.deepEqual([r.routeId, r.type], [counsel.id, 'counsel']);
  const after = await ro.accountRoutes(client, ID);
  assert.deepEqual([after.chosen.routeId, after.chosen.by, after.chosen.checklist.drafted], [counsel.id, BY, false]);
  assert.match(after.chosen.checklist.ask[0], /^Ask Avery Invented/);
  await assert.rejects(ro.chooseRoute(client, { id: ID, route: 'r-0000000000', by: BY }), /No route r-0000000000/);
  assert.equal(fake.jobs.length, 0);
  assert.ok(!fake.lines.some((l) => l.path === 'touches.jsonl'), 'no touch is recorded');
  assert.ok(![...fake.docs.keys()].some((k) => k.startsWith('drafts/')), 'nothing is drafted');
  assert.deepEqual(fake.docs.get(`accounts/${ID}.json`).version, 1, 'the account is unchanged');
});

test('removing a network entry from the page removes it from every routes file, and the page shows how many chosen routes used it', async () => {
  const { fake, client } = await seeded({ network: true });
  await ro.buildAccountRoutes(client, { id: ID });
  const board = (await ro.accountRoutes(client, ID)).routes.find((r) => r.type === 'board');
  await ro.chooseRoute(client, { id: ID, route: board.id, by: BY });
  assert.deepEqual((await ro.networkOverview(client, { by: BY })).uses, { 'np-1': 1 });
  const r = await ro.removeNetworkEntry(client, { id: 'np-1', by: BY });
  assert.deepEqual([r.routeFiles, r.routesRemoved], [1, 1]);
  const doc = fake.docs.get(`routes/${ID}.json`).body;
  assert.ok(!JSON.stringify(doc).includes('Casey Example'));
  assert.ok(!fake.docs.get(`routes/${ID}.md`).text.includes('Casey Example'));
  assert.equal(doc.chosen, null);
  assert.deepEqual((await ro.networkOverview(client, { by: BY })).uses, {});
});
