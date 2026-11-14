// The Sales screen's server helper and display logic (PRD E16), against the repository's fake Supabase REST API and a ledger the
// engine builds. Invented data only; no network, no browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fakePostgrest } from '../../test/postgrest-fake.mjs';
import { platformClient } from '../../src/platform/client.mjs';
import { buildLedger, assignmentEvent, listingEvent, RECOVERY_LABEL, UNKNOWN } from '../../src/sales.mjs';
import * as ops from '../lib/ops.mjs';
import { partyLink, assetLine, countsLine, kindLabel, recoveryText } from '../lib/sales-view.mjs';

const URL_ = 'https://example-project.supabase.test';
const src = (id, date) => [{ source: 'test', ids: [id], link: `https://example.test/${id}`, date }];
const EVENTS = [
  { id: 'cmbs-liquidation:1:1', kind: 'disposition', date: '2026-10-01', seller: { kind: 'trust', key: 'cmbs-trust:1', name: 'Example Mortgage Trust 2021-C1', via: { kind: 'servicer', key: 'servicer:example-special-servicing-llc', name: 'Example Special Servicing LLC', matched: true } }, buyer: { ...UNKNOWN },
    asset: { kind: 'loan', propertyType: 'Multifamily', metro: '31080', metros: ['31080'], balance: 24100000, properties: [{ name: 'Example Garden Apartments' }] }, tier: 'reported', sources: src('a', '2026-10-13'),
    priceEvidence: { balanceBeforeLiquidation: { value: 24100000 }, realizedLoss: { value: 6025000 }, impliedRecovery: { value: 0.75, approximate: true, label: RECOVERY_LABEL }, isPrice: false } },
  { id: 'fdic-deal:7001', kind: 'whole_bank_acquisition', date: '2026-06-01', seller: { kind: 'bank', key: 'fdic:202', name: 'Example Target Bank' }, buyer: { kind: 'bank', key: 'fdic:201', name: 'Example Buyer Bank' },
    asset: { kind: 'bank', propertyType: null, metro: '38060', metros: ['38060'], balance: 150000000 }, tier: 'reported', sources: src('b', '2026-06-01') },
];

async function seeded() {
  const dir = mkdtempSync(join(tmpdir(), 'outbound-web-sales-'));
  const assignment = assignmentEvent({ county: '04013', recordingNumber: '1', recordedOn: '2026-09-15', apn: '1-2-3', source: 'county:test', deedOfTrust: { recordingNumber: '0', originalPrincipal: 1000000, beneficiary: 'Example Lender Bank' }, assignor: 'Example Lender Bank', assignee: 'Example Note Fund LLC', kindOf: (n) => (n === 'Example Lender Bank' ? { kind: 'bank', key: 'fdic:301' } : null) });
  const listing = listingEvent({ site: 'example-exchange', listingId: '9', listedOn: '2026-11-01', propertyType: 'Retail', metro: '38060', balance: 3000000, loans: 1 });
  const r = buildLedger({ dir, feeders: [{ source: 'test', build: () => ({ events: [...EVENTS, assignment, listing] }) }], now: new Date('2026-11-14T00:00:00Z') });
  assert.equal(r.outcome, 'ok', JSON.stringify(r));
  const fake = fakePostgrest();
  fake.docs.set('sales/ledger.json', { path: 'sales/ledger.json', kind: 'json', body: JSON.parse(readFileSync(join(dir, 'sales', 'ledger.json'), 'utf8')), text: null, version: 1 });
  return platformClient({ url: URL_, key: 'anon-key', accessToken: 'user:pat@example.test', fetchImpl: fake.fetchImpl });
}

test('the Sales screen: recent events newest first, sellers by the institution that acted with links, known buyers, and labelled price evidence', async () => {
  const d = await ops.salesOverview(await seeded());
  assert.ok(d.builtAt);
  assert.deepEqual(d.recent.map((e) => e.id), ['listing:example-exchange:9', 'cmbs-liquidation:1:1', 'assignment:04013:1', 'fdic-deal:7001']);
  assert.deepEqual(d.sellers.map((s) => [s.key, s.link, s.total, s.latest]), [
    ['servicer:example-special-servicing-llc', '/servicers/Example%20Special%20Servicing%20LLC', 1, '2026-10-01'],
    ['fdic:301', '/candidates/fdic%3A301', 1, '2026-09-15'],
    ['fdic:202', '/candidates/fdic%3A202', 1, '2026-06-01'],
  ]);
  assert.ok(d.sellers.every((s) => !('events' in s)), 'the seller table carries counts, not every event');
  assert.deepEqual(d.buyers.map((b) => [b.name, b.link, b.total, b.latest]), [['Example Note Fund LLC', null, 1, '2026-09-15'], ['Example Buyer Bank', '/candidates/fdic%3A201', 1, '2026-06-01']], 'most events first, then the newest');
  assert.equal(d.pricing.label, RECOVERY_LABEL);
  assert.deepEqual(d.pricing.groups.map((g) => [g.propertyType, g.metro, g.impliedRecovery.value, g.impliedRecovery.approximate]), [['Multifamily', '31080', 0.75, true]]);
});

test('with no ledger yet, the screen says so instead of failing', async () => {
  const client = platformClient({ url: URL_, key: 'anon-key', accessToken: 'user:pat@example.test', fetchImpl: fakePostgrest().fetchImpl });
  const d = await ops.salesOverview(client);
  assert.deepEqual([d.builtAt, d.recent, d.sellers, d.buyers, d.pricing], [null, [], [], [], null]);
});

test('display helpers: links only to our own pages, assets in words, counts sorted, and a recovery always approximate', () => {
  assert.equal(partyLink({ kind: 'bank', key: 'fdic:12', name: 'X' }), '/candidates/fdic%3A12');
  assert.equal(partyLink({ kind: 'servicer', key: 'servicer:x', name: 'Example Servicing' }), '/servicers/Example%20Servicing');
  assert.equal(partyLink({ kind: 'fdic', key: 'fdic-receiver', name: 'FDIC as receiver' }), null);
  assert.equal(partyLink(UNKNOWN), null);
  assert.equal(assetLine({ kind: 'loan', propertyType: 'Lodging', metros: ['38060'] }, (c) => (c === '38060' ? 'Phoenix' : c)), 'loan · Lodging · Phoenix');
  assert.equal(assetLine({ kind: 'pool', loans: 312, propertyType: null, metro: null }), 'pool of 312 loans');
  assert.equal(countsLine({ dpo: 1, disposition: 3 }, kindLabel), 'Disposition (CMBS) 3, Discounted payoff (CMBS) 1');
  assert.equal(recoveryText({ value: 0.7512 }), '≈ 75.1%');
  assert.equal(recoveryText({ value: null, reason: 'no realized loss reported' }), '– (no realized loss reported)');
});
