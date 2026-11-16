// The Status page's coverage card (PRD next-five E18-S1): the engine's report read through the platform client, and the pure card
// helper. Against the repository's fake Supabase REST API, with invented banks only. No network, no browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fakePostgrest } from '../../test/postgrest-fake.mjs';
import { makeDir, put } from '../../test/kit.mjs';
import { platformClient } from '../../src/platform/client.mjs';
import { coverageReport, buildCoverage, COVERAGE_PATHS } from '../../src/coverage.mjs';
import { coverageCard } from '../lib/coverage-view.mjs';
import * as ops from '../lib/ops.mjs';

const URL_ = 'https://example-project.supabase.test';
const client = (fake) => platformClient({ url: URL_, key: 'anon-key', accessToken: 'user:pat@example.test', fetchImpl: fake.fetchImpl });
const seed = (fake, path, body) => fake.docs.set(path, { path, kind: 'json', body, text: null, version: 1 });

const cand = (cert, name, tier) => ({ key: `fdic:${cert}`, cert: String(cert), name, tier, score: tier === 'A' ? 60 : tier === 'B' ? 30 : 5, axes: { distress: 20, fit: 20, timing: 10 }, filtersFailed: [], signals: [], latestRepdte: '20260630' });
const LATEST = { runId: 'score-1', scoredAt: '2026-11-16T13:00:00.000Z', asOf: '2026-11-16', latestRepdte: '20260630', provisional: true, failedBanks: [],
  items: [cand(1, 'Alder Example Bank', 'A'), cand(2, 'Birch Example Bank', 'A'), cand(3, 'Cedar Example Bank', 'B'), cand(4, 'Dogwood Example Bank', null)] };
const STORES = {
  [COVERAGE_PATHS.filers]: { 'fdic:1': { ciks: { '0009900001': { status: 'confirmed', by: 'Pat Example', at: '2026-11-01T00:00:00.000Z' } } }, 'fdic:3': { ciks: { '0009900003': { status: 'rejected', by: 'Pat Example', at: '2026-11-01T00:00:00.000Z' } } } },
  [COVERAGE_PATHS.servicers]: { 'Cedar Example Bank': { name: 'Cedar Example Bank', loans: 1 }, Unknown: { name: 'Unknown', loans: 2 } },
  [COVERAGE_PATHS.aliases]: {},
  // One Federal Reserve order naming Alder by its exact name (PRD next-five E18-S2); org names only.
  [COVERAGE_PATHS.enforcement]: { 'frb:1': { key: 'frb:1', regulator: 'frb', sourceId: '1', type: 'written_agreement', types: ['written_agreement'], date: '2026-06-01', terminatedOn: null,
    parties: [{ name: 'Alder Example Bank', city: 'Sampleton', state: 'TX' }], link: 'https://www.federalreserve.gov/newsevents/pressreleases/enforcement20260601a.htm', linkKind: 'press release', kind: 'order' } },
};

test('the card: a column per group with its total, every source with its cells, enforcement counted, and what has not run', () => {
  const dir = makeDir();
  put(dir, COVERAGE_PATHS.latest, LATEST);
  for (const [p, b] of Object.entries(STORES)) put(dir, p, b);
  const card = coverageCard(coverageReport({ dir }));
  assert.deepEqual(card.columns.map((c) => c.label), ['Tier A (2)', 'Tier B (1)', 'All candidates (4)']);
  const byId = Object.fromEntries(card.rows.map((r) => [r.id, r]));
  assert.deepEqual(byId['sec-confirmed'].cells, ['1 of 2 (50.0%)', '0 of 1 (0.0%)', '1 of 4 (25.0%)']);
  assert.deepEqual(byId.cmbs.cells, ['0 of 2 (0.0%)', '1 of 1 (100.0%)', '1 of 4 (25.0%)']);
  assert.deepEqual(byId.enforcement.cells, ['1 of 2 (50.0%)', '0 of 1 (0.0%)', '1 of 4 (25.0%)']);
  assert.equal(byId.cmbs.detail, '1 special servicer name in the stored CMBS data; 1 matches a candidate. Nothing fuzzier is counted.');
  assert.equal(byId['sec-confirmed'].detail, null);
  assert.equal(byId.enforcement.built, true);
  assert.deepEqual(card.rows.filter((r) => r.sub).map((r) => r.id), ['sec-rejected', 'sec-unmapped']);
  assert.ok(card.rows.every((r) => typeof r.basis === 'string' && r.basis.length > 10), 'each line says what it counts');
  assert.equal(card.notRunNote, 'Not run yet: the sale ledger (sales/ledger.json; outbound sales build) and the merger applications (sources/mergers/applications.json; outbound sources run mergerapps). A 0 on their lines means the source has not run, not that it sees nothing.');
  assert.equal(card.provisional, true);
  assert.equal(card.asOf, '20260630');
  assert.equal(card.note, null);
});

test('the card with no candidates says so and shows 0 of 0, never a share', () => {
  const card = coverageCard(buildCoverage({}));
  assert.match(card.note, /^No candidates yet/);
  assert.deepEqual(card.columns.map((c) => c.label), ['Tier A (0)', 'Tier B (0)', 'All candidates (0)']);
  for (const r of card.rows) assert.deepEqual(r.cells, r.built ? ['0 of 0', '0 of 0', '0 of 0'] : ['not built', 'not built', 'not built']);
  assert.match(card.notRunNote, /^Not run yet: the bank-to-filer map .*, the sale ledger .*, the enforcement orders .* and the merger applications .*\. A 0 on their lines/);
  assert.equal(coverageCard(null), null);
});

test('the page computes coverage with the engine from stored data, the same as the command line, without loading the whole candidate list', async () => {
  const fake = fakePostgrest();
  const c = client(fake);
  const empty = await ops.coverageOverview(c);
  assert.equal(empty.empty, true);
  assert.match(empty.note, /^No candidates yet/);
  // The candidate list goes in the way the worker writes it, so the candidates table holds its projection.
  await c.flush({ docs: [{ path: COVERAGE_PATHS.latest, kind: 'json', body: LATEST, baseVersion: 0 }], lines: [] });
  for (const [p, b] of Object.entries(STORES)) seed(fake, p, b);
  fake.calls.length = 0;
  const web = await ops.coverageOverview(c);
  const dir = makeDir();
  put(dir, COVERAGE_PATHS.latest, LATEST);
  for (const [p, b] of Object.entries(STORES)) put(dir, p, b);
  const cli = coverageReport({ dir });
  assert.deepEqual({ ...web, candidates: null }, { ...cli, candidates: null }, 'the same counts, rows and notes');
  assert.deepEqual(web.candidates, { runId: null, scoredAt: null, latestRepdte: '20260630', provisional: true });
  assert.deepEqual(await ops.coverageOverview(c, { pageSize: 2 }), web, 'every page of the projection is read');
  const docCalls = fake.calls.filter((x) => x.path === 'documents');
  assert.ok(docCalls.length > 0 && docCalls.every((x) => !String(x.query.or ?? '').includes('candidates/latest.json')), 'the full candidate list is never loaded');
  assert.ok(docCalls.every((x) => x.query.or && !/\*/.test(x.query.or)), 'exact files only, never a folder');
  assert.ok(fake.calls.some((x) => x.path === 'candidates' && !/item/.test(x.query.select ?? '')), 'the projection\'s summary columns only');
});
