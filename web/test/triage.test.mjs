// The "This week" screen (PRD E6-S5): reading the stored triage through the platform client, and the pure view helpers. Against the
// repository's fake Supabase REST API, with a triage the engine itself wrote from invented data. No network, no browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fakePostgrest } from '../../test/postgrest-fake.mjs';
import { makeDir, put, loadJson } from '../../test/kit.mjs';
import { platformClient } from '../../src/platform/client.mjs';
import { runTriage } from '../../src/triage.mjs';
import { primaryHref, otherPages, externalLinks, moreFindings, SECTIONS } from '../lib/triage-view.mjs';
import * as ops from '../lib/ops.mjs';

const URL_ = 'https://example-project.supabase.test';
const client = (fake) => platformClient({ url: URL_, key: 'anon-key', accessToken: 'user:pat@example.test', fetchImpl: fake.fetchImpl });
const seed = (fake, path, body) => fake.docs.set(path, { path, kind: 'json', body, text: null, version: 1 });

// A real triage, written by the engine from an invented data folder.
function triageOf(now) {
  const dir = makeDir();
  put(dir, 'candidates/latest.json', { runId: 'score-1', scoredAt: now.toISOString(), asOf: now.toISOString().slice(0, 10), latestRepdte: '20260630', provisional: true, items: [{ key: 'fdic:1', cert: '1', name: 'Alpha Example Bank', tier: 'A', score: 60, axes: { distress: 20, fit: 20, timing: 20 }, filtersFailed: [], signals: [], latestRepdte: '20260630' }] });
  put(dir, 'sources/fdic/failed.json', { 77: { cert: '77', name: 'Golf Example Bank', failedOn: now.toISOString().slice(0, 10), inMetros: true, metros: [{ cbsa: '31080' }], loanSales: 'https://www.fdic.gov/resources/resolutions/asset-sales/loan-sales' } });
  const t = runTriage({ dir, rules: loadJson('triage.json'), metros: loadJson('metros.json'), scoring: loadJson('scoring.json'), now });
  return { t, state: JSON.parse(readFileSync(join(dir, 'triage', 'state.json'), 'utf8')) };
}

test('the page reads the latest triage, or one by date, and loads only that day\'s record', async () => {
  const fake = fakePostgrest();
  const c = client(fake);
  assert.equal(await ops.latestTriage(c), null, 'nothing yet');
  const a = triageOf(new Date('2026-11-09T14:00:00Z'));
  const b = triageOf(new Date('2026-11-16T14:00:00Z'));
  seed(fake, 'triage/2026-11-09.json', a.t);
  seed(fake, 'triage/2026-11-16.json', b.t);
  seed(fake, 'triage/state.json', b.state);
  assert.equal((await ops.latestTriage(c)).date, '2026-11-16');
  assert.equal((await ops.latestTriage(c, { date: '2026-11-09' })).date, '2026-11-09');
  assert.equal((await ops.latestTriage(c, { date: '../../etc' })).date, '2026-11-16', 'a bad date is ignored, never put in a path');
  assert.equal(await ops.latestTriage(c, { date: '2026-11-02' }), null);
  const loaded = fake.calls.filter((x) => x.path === 'documents').map((x) => x.query.or);
  assert.ok(loaded.every((or) => !/triage\/\*|like/.test(or ?? '')), 'no call loads the whole triage folder');
  await ops.queueTriage(c);
  assert.deepEqual([fake.jobs[0].kind, fake.jobs[0].params], ['triage.run', {}]);
});

test('each item links to its account, else its candidate page, else its servicer; outside links go to SEC and FDIC only', () => {
  const { t } = triageOf(new Date('2026-11-16T14:00:00Z'));
  const failed = t.actNow.find((i) => i.key === 'fdic:77');
  assert.equal(primaryHref(failed), null, 'a failed bank has no candidate page');
  assert.deepEqual(externalLinks(failed), [{ href: 'https://www.fdic.gov/resources/resolutions/asset-sales/loan-sales', label: 'FDIC loan sales' }]);
  const item = { key: 'fdic:1', category: 'actNow', findings: [{ reason: 'a' }, { reason: 'b' }], links: { account: '/accounts/alpha', candidate: '/candidates/fdic%3A1', servicer: null, filings: ['https://www.sec.gov/Archives/edgar/data/1/x-index.htm', 'javascript:alert(1)'], fdicLoanSales: null } };
  assert.equal(primaryHref(item), '/accounts/alpha');
  assert.deepEqual(otherPages(item), [{ href: '/candidates/fdic%3A1', label: 'candidate page' }]);
  assert.deepEqual(externalLinks(item).map((l) => l.href), ['https://www.sec.gov/Archives/edgar/data/1/x-index.htm']);
  assert.deepEqual(moreFindings(item).map((f) => f.reason), ['b']);
  assert.deepEqual(moreFindings({ ...item, category: 'inConversation' }).map((f) => f.reason), ['a', 'b']);
  assert.equal(primaryHref({ links: { candidate: 'https://elsewhere.test/' } }), null);
  assert.deepEqual(SECTIONS.map(([k]) => k), ['actNow', 'watch'], 'act now first, then watch; in conversation is shown apart');
});
