// The Banks list (docs/design-redesign.md, 5.2): the pure helpers in lib/candidates-view.mjs and the list read in lib/ops.mjs, against the
// repository's fake Supabase REST API. Invented banks and numbers only; no network, no browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fakePostgrest } from '../../test/postgrest-fake.mjs';
import { platformClient } from '../../src/platform/client.mjs';
import { restReader } from '../lib/rest.mjs';
import * as ops from '../lib/ops.mjs';
import {
  priorityOf, axisMax, axesOf, tierGap, tierRule, bestCeiling, reasonOf, moreReasons, listParams, listHref, inView, viewCounts, matchesQuery,
  sortRows, listRows, isFresh, sectorWord,
} from '../lib/candidates-view.mjs';

const scoring = JSON.parse(readFileSync(new URL('../../scoring.json', import.meta.url), 'utf8'));
const ceiling = (sector, category, high, tier = 'inferred') => ({ sector, label: sector, category, high, low: 0, tier, asOf: '2026-06-30' });

test('priority, axis maximums from scoring.json, and why a bank is short of Call first', () => {
  assert.deepEqual(axisMax(scoring), { distress: 45, fit: 30, timing: 25 });
  assert.deepEqual(axesOf({ distress: 12.94, fit: '20', timing: null }), { distress: 12.94, fit: 20, timing: 0 });
  assert.deepEqual(axesOf({ axes: { distress: 1, fit: 2, timing: 3 } }), { distress: 1, fit: 2, timing: 3 });
  assert.equal(tierGap({ tier: 'B', score: 52.3, distress: 12.94, fit: 25, timing: 14.4 }, scoring.tiers), 'Short of Call first: pressure 12.9 (needs 15)');
  assert.equal(tierGap({ tier: 'B', score: 47, distress: 10, fit: 14 }, scoring.tiers), 'Short of Call first: pressure 10.0 (needs 15), fit 14.0 (needs 15)');
  assert.equal(tierGap({ tier: 'B', score: 44, distress: 10, fit: 10 }, scoring.tiers), '', 'below the Call first score: nothing to explain');
  assert.equal(tierGap({ tier: 'A', score: 60, distress: 20, fit: 20 }, scoring.tiers), '');
  assert.match(tierRule(scoring.tiers), /^Call first needs 45 points or more, with at least 15 for pressure and 15 for fit\. Worth a look needs 20 or more\.$/);
  assert.equal(priorityOf({ tier: 'B' }).label, 'Worth a look');
});

test('the could-fit ceiling: the largest single type, never a sum; hotel and retail share one; absent when not stored', () => {
  const both = bestCeiling([ceiling('hospitality', 'nonfarmNonresidential', 16000000), ceiling('multifamily', 'multifamily', 15400000, 'reported'), ceiling('retail', 'nonfarmNonresidential', 16000000)]);
  assert.deepEqual([both.high, both.label, both.tier], [16000000, 'hotel or retail', 'inferred']);
  const mf = bestCeiling([ceiling('hospitality', 'nonfarmNonresidential', 1000000), ceiling('multifamily', 'multifamily', 15400000, 'reported')]);
  assert.deepEqual([mf.high, mf.label, mf.tier], [15400000, 'apartments', 'reported']);
  assert.notEqual(both.high, 16000000 * 2 + 15400000, 'never added across types');
  assert.equal(bestCeiling(null), null);
  assert.equal(bestCeiling([]), null, 'every sector a gap');
  assert.equal(bestCeiling([{ sector: 'retail', high: null }]), null);
  assert.equal(sectorWord({ sector: 'office', label: 'Office' }), 'office');
});

test('the reason: the headline when stored, else the card\'s second sentence; and how many more', () => {
  const sentences = [{ text: 'Alpha Example Bank: Call Report data as of June 30, 2026.' }, { text: 'Apartment loans are 30% of its CRE book.' }, { text: 'b' }, { text: 'c' }];
  assert.equal(reasonOf({ headline: 'Late apartment loans up two quarters running', sentences }), 'Late apartment loans up two quarters running');
  assert.equal(reasonOf({ headline: null, sentences }), 'Apartment loans are 30% of its CRE book.');
  assert.equal(reasonOf({ headline: '  ', sentences: [sentences[0]] }), '');
  assert.equal(reasonOf({}), '');
  assert.equal(moreReasons({ sentences }), 2);
  assert.equal(moreReasons({ sentences: null }), 0);
});

test('views, filters and sorts from the query string, with defaults left out of links', () => {
  assert.deepEqual(listParams({}), { view: 'AB', sort: 'score', metro: '', q: '', fresh: false });
  assert.deepEqual(listParams({ view: 'all', sort: 'fit', metro: '38060', q: '  Example  ', fresh: '1' }), { view: 'all', sort: 'fit', metro: '38060', q: 'Example', fresh: true });
  assert.deepEqual(listParams({ view: 'Z', sort: 'drop table', metro: '../x', q: ['a', 'b'] }), { view: 'AB', sort: 'score', metro: '', q: 'a', fresh: false });
  assert.equal(listHref(listParams({})), '/candidates');
  assert.equal(listHref(listParams({ metro: '38060' }), { view: 'A' }), '/candidates?view=A&metro=38060');
  assert.equal(listHref({ view: 'all', q: 'a&b' }), '/candidates?view=all&q=a%26b');
});

test('which rows a view shows, in what order; excluded banks last', () => {
  const rows = [
    { key: 'fdic:1', name: 'Alpha Example Bank', city: 'Phoenix', state: 'AZ', tier: 'B', score: 30, fitCeiling: [ceiling('multifamily', 'multifamily', 5e6)] },
    { key: 'fdic:2', name: 'Bravo Example Bank', city: 'Mesa', state: 'AZ', tier: 'A', score: 60, fitCeiling: null, isNew: true },
    { key: 'fdic:3', name: 'Charlie Example Bank', tier: null, score: 10, status: 'returned' },
    { key: 'fdic:4', name: 'Delta Example Bank', tier: null, score: 70, filtered: true },
    { key: 'fdic:5', name: 'Echo Example Bank', tier: 'B', score: 30, fitCeiling: [ceiling('retail', 'nonfarmNonresidential', 9e6)] },
  ];
  assert.deepEqual(viewCounts(rows), { A: 1, AB: 3, all: 5 });
  assert.equal(inView(rows[3], 'AB'), false, 'an excluded bank is never in a priority view');
  assert.deepEqual(sortRows(rows).map((r) => r.key), ['fdic:2', 'fdic:1', 'fdic:5', 'fdic:3', 'fdic:4'], 'score, then name; excluded last despite its score');
  assert.deepEqual(sortRows(rows, 'fit').map((r) => r.key), ['fdic:5', 'fdic:1', 'fdic:2', 'fdic:3', 'fdic:4'], 'largest ceiling first, none after');
  assert.deepEqual(sortRows(rows, 'new').map((r) => r.key), ['fdic:2', 'fdic:3', 'fdic:1', 'fdic:5', 'fdic:4']);
  assert.deepEqual([isFresh(rows[1]), isFresh(rows[2]), isFresh(rows[0])], [true, true, false]);
  assert.equal(matchesQuery(rows[0], 'phoenix, az'), true);
  assert.equal(matchesQuery(rows[0], 'bravo'), false);
  assert.equal(matchesQuery(rows[0], ''), true);
  assert.deepEqual(listRows(rows, listParams({ view: 'all', fresh: '1' })).map((r) => r.key), ['fdic:2', 'fdic:3']);
  assert.deepEqual(listRows(rows, listParams({ q: 'example' })).map((r) => r.key), ['fdic:2', 'fdic:1', 'fdic:5']);
});

test('the list reads the item fields by JSON path, the card\'s sentences and failed filters, and which banks are new this week', async () => {
  const fake = fakePostgrest();
  const url = 'https://example-project.supabase.test';
  const client = platformClient({ url, key: 'anon-key', accessToken: 'user:pat@example.test', fetchImpl: fake.fetchImpl });
  const rest = restReader({ url, key: 'anon-key', accessToken: 'user:pat@example.test', fetchImpl: fake.fetchImpl });
  const sentences = [{ text: 'Alpha Example Bank: Call Report data as of June 30, 2026.', evidence: [] }, { text: 'A second sentence.', evidence: [] }];
  const item = (key, name, tier, score, more = {}) => ({ key, cert: key.slice(5), name, tier, score, axes: { distress: 20, fit: 20, timing: 10 }, metros: ['38060'], sectors: ['multifamily'], filtersFailed: [], signals: [], latestRepdte: '20260630', card: { text: sentences.map((s) => s.text).join(' '), sentences, headline: null }, ...more });
  await client.flush({ docs: [
    { path: 'candidates/latest.json', kind: 'json', body: { runId: 'score-1', items: [
      item('fdic:1', 'Alpha Example Bank', 'A', 60, { city: 'Phoenix', state: 'AZ', assets: 2410000, card: { text: 'x', sentences, headline: 'Late apartment loans up two quarters running' }, fitCeiling: [ceiling('multifamily', 'multifamily', 15400000, 'reported')] }),
      item('fdic:2', 'Bravo Example Bank', null, 70, { filtersFailed: ['total assets $12.4B are above the cap of $10.0B'] }),
      item('fdic:3', 'Charlie Example Bank', 'B', 30),
    ] }, baseVersion: 0 },
    { path: 'triage/state.json', kind: 'json', body: { date: '2026-11-16' }, baseVersion: 0 },
    { path: 'triage/2026-11-16.json', kind: 'json', body: { date: '2026-11-16', actNow: [{ key: 'fdic:3' }], watch: [], inConversation: [] }, baseVersion: 0 },
  ], lines: [] });
  fake.calls.length = 0;
  const rows = await ops.listCandidates(client, { tier: 'all' }, { rest });
  const by = Object.fromEntries(rows.map((r) => [r.key, r]));
  assert.deepEqual([by['fdic:1'].headline, by['fdic:1'].city, by['fdic:1'].assets, by['fdic:1'].fitCeiling[0].high], ['Late apartment loans up two quarters running', 'Phoenix', 2410000, 15400000]);
  assert.deepEqual([by['fdic:3'].headline, by['fdic:3'].fitCeiling, reasonOf(by['fdic:3'])], [null, null, 'A second sentence.'], 'scored before the fields existed: the fallbacks');
  assert.deepEqual(by['fdic:2'].filtersFailed, ['total assets $12.4B are above the cap of $10.0B']);
  assert.equal(priorityOf(by['fdic:2']).label, 'Excluded');
  assert.deepEqual(rows.map((r) => [r.key, r.isNew]), [['fdic:2', false], ['fdic:1', false], ['fdic:3', true]]);
  const reads = fake.calls.filter((c) => c.path === 'candidates');
  assert.ok(reads.length >= 2 && reads.every((c) => c.caller === 'principal'), 'read with the principal\'s token');
  assert.ok(reads.every((c) => !/(^|,)item(,|$)/.test(String(c.query.select))), 'never the whole item');
  // Without the REST reader (the command-line view), the rows are as before.
  assert.deepEqual((await ops.listCandidates(client, {})).map((r) => [r.key, r.status]), [['fdic:1', 'new'], ['fdic:3', 'new']]);
});

test('This week reads the act-now banks\' items one by one, bank keys only', async () => {
  const seen = [];
  const client = { candidate: async (k) => { seen.push(k); return k === 'fdic:9' ? null : { key: k, name: 'Alpha Example Bank' }; } };
  const m = await ops.candidateItems(client, ['fdic:1', 'servicer:x', 'fdic:1', 'fdic:9']);
  assert.deepEqual(seen, ['fdic:1', 'fdic:9']);
  assert.deepEqual([...m.keys()], ['fdic:1']);
});
