// PRD next-five E19, S1 to S4: the intermediary registry, the ranking, buyer-list registration and the route to a seller. Every firm,
// bank, trust and number here is invented. No network, no model.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { makeDir, put, config, REPO } from './kit.mjs';
import { readJson, readJsonl } from '../src/store.mjs';
import { loadRules } from '../src/rules.mjs';
import { LOADS } from '../src/uow.mjs';
import {
  buildRegistry, writeRegistry, readRegistry, rankFirms, addMandate, addReferral, addDirectSale, addFirmAlias, setRegistration,
  approveCredibilityPackage, ndaUnder, registrationReminders, readRegistrations, routeForDir, firmKey, intermediaryPaths,
} from '../src/intermediaries.mjs';

const rules = loadRules();
const cfg = () => ({ ...config() });
const src = (id) => [{ source: 'test', ids: [id], link: `https://example.test/${id}`, date: '2026-01-01' }];
// An invented ledger: two FDIC sales by one advisor (one with an in-metro receivership), a CMBS liquidation through a special servicer,
// and two listings by a listing advisor: one names no seller, one names a bank in the list.
const LEDGER = {
  events: {
    'fdic-sale:A1': { id: 'fdic-sale:A1', kind: 'fdic_sale_announced', date: '2026-03-01', seller: { kind: 'fdic', key: 'fdic-receiver', name: 'FDIC as receiver', receiverships: [{ name: 'Gone Bank', inMetros: true, metros: [{ cbsa: '38060' }] }] }, buyer: { kind: 'unknown', name: 'unknown' }, asset: { kind: 'pool', balance: 40000000, loans: 30 }, sale: { saleId: 'A1', advisor: 'Example Sale Advisors, LLC' }, sources: src('A1') },
    'fdic-sale:A2': { id: 'fdic-sale:A2', kind: 'fdic_sale_announced', date: '2024-03-01', seller: { kind: 'fdic', key: 'fdic-receiver', name: 'FDIC as receiver', receiverships: [] }, buyer: { kind: 'unknown', name: 'unknown' }, asset: { kind: 'pool', balance: 10000000 }, sale: { saleId: 'A2', advisor: 'Example Sale Advisors LLC' }, sources: src('A2') },
    'cmbs-liquidation:1:9': { id: 'cmbs-liquidation:1:9', kind: 'note_sale_completed', date: '2026-05-01', seller: { kind: 'trust', key: 'cmbs-trust:1', name: 'Example Trust 2019-C1', via: { kind: 'servicer', key: 'servicer:example-special', name: 'Example Special Servicing' } }, buyer: { kind: 'unknown', name: 'unknown' }, asset: { kind: 'loan', metro: '12420', sector: 'hospitality', balance: 18000000 }, sources: src('L1') },
    'listing:x1': { id: 'listing:x1', kind: 'marketed_listing', date: '2026-06-01', seller: { kind: 'unknown', name: 'unknown', description: 'regional bank' }, buyer: { kind: 'unknown', name: 'unknown' }, asset: { kind: 'pool', metro: '31080', propertyType: 'multifamily', balance: 5000000 }, listing: { site: 'example', listingId: 'x1', advisor: 'Example Listing Desk' }, sources: src('x1') },
    'listing:x2': { id: 'listing:x2', kind: 'marketed_listing', date: '2026-07-01', seller: { kind: 'unknown', name: 'unknown' }, buyer: { kind: 'unknown', name: 'unknown' }, asset: { kind: 'pool', metro: '31080', balance: 6000000 }, listing: { site: 'example', listingId: 'x2', advisor: 'Example Listing Desk' }, sources: src('x2') },
    'listing:x3': { id: 'listing:x3', kind: 'marketed_listing', date: '2026-08-01', seller: { kind: 'bank', key: 'fdic:101', name: 'Example Hill Bank' }, buyer: { kind: 'unknown', name: 'unknown' }, asset: { kind: 'loan', metro: '12420', sector: 'retail', balance: 3000000 }, listing: { site: 'example', listingId: 'x3', advisor: 'Example Listing Desk' }, sources: src('x3') },
  },
};
const LOANS = {
  a: { key: 'a', cik: '1', trust: 'Example Trust 2019-C1', specialServicer: 'Example Special Servicing', period: '2026-09-30', balance: 20000000, metros: ['12420'], sectors: ['hospitality'], signals: [{ type: 'special_servicing' }], _source: {} },
  b: { key: 'b', cik: '1', trust: 'Example Trust 2019-C1', specialServicer: 'Example Special Servicing', period: '2026-09-30', balance: 5000000, metros: ['38060'], sectors: ['retail'], signals: [{ type: 'note_sale' }], _source: {} },
  c: { key: 'c', cik: '2', trust: 'Example Trust 2021-C2', specialServicer: 'Example Special Servicing', period: '2026-09-30', balance: 1000000, metros: ['12420'], sectors: ['retail'], signals: [{ type: 'maturing' }], _source: {} },   // not in special servicing
  d: { key: 'd', cik: '3', trust: 'Example Trust 2022-C3', specialServicer: 'Unknown', period: '2026-09-30', balance: 1, metros: [], sectors: [], signals: [{ type: 'special_servicing' }], _source: {} },
};
function world() {
  const dir = makeDir();
  put(dir, 'sales/ledger.json', LEDGER);
  put(dir, 'sources/edgar/loans.json', LOANS);
  writeRegistry({ dir, config: cfg(), now: new Date('2026-11-16T12:00:00Z') });
  return dir;
}
const ADV = firmKey('Example Sale Advisors'), SS = firmKey('Example Special Servicing'), LIST = firmKey('Example Listing Desk');

test('S1 FEEDERS: FDIC sale advisors, CMBS liquidations and loans in special servicing, and listings become mandates; one firm per name', () => {
  const dir = world();
  const R = readRegistry(dir);
  assert.equal(firmKey('Example Sale Advisors, LLC'), firmKey('Example Sale Advisors LLC'), 'legal suffixes and punctuation do not split a firm');
  assert.deepEqual(R.firms[ADV].mandates.sort(), ['fdic-sale:A1', 'fdic-sale:A2']);
  assert.deepEqual(R.firms[ADV].kinds, ['loan_sale_advisor']);
  assert.equal(R.mandates['fdic-sale:A1'].metro, '38060', 'the in-metro receivership places the sale');
  assert.deepEqual(R.firms[SS].mandates.sort(), ['cmbs-liquidation:cmbs-liquidation:1:9', 'cmbs-servicing:1:example-special-servicing'], 'the liquidation and trust 1 now in special servicing; trust 2 is only maturing');
  const sv = R.mandates['cmbs-servicing:1:example-special-servicing'];
  assert.deepEqual([sv.loans, sv.balance, sv.metros, sv.seller.key], [2, 25000000, ['12420', '38060'], 'cmbs-trust:1']);
  assert.ok(!Object.values(R.firms).some((f) => /unknown/i.test(f.name)), 'an unread servicer is never a firm');
  assert.equal(R.firms[LIST].mandates.length, 3);
  assert.equal(R.mandates['listing:listing:x1'].seller.kind, 'unknown');
  assert.equal(R.mandates['listing:listing:x1'].sellerDescription, 'regional bank', 'a described seller is shown, never matched to a bank');
  // A rebuild never counts a mandate twice.
  writeRegistry({ dir, config: cfg() });
  assert.equal(readRegistry(dir).firms[ADV].mandates.length, 2);
});

test('S1 SCOPE (D-I1): only the kinds in config are kept: loan-sale advisors and special servicers first', () => {
  const dir = world();
  assert.deepEqual(config().intermediaries.kinds, ['loan_sale_advisor', 'special_servicer']);
  addMandate({ dir, firmName: 'Example Receivership Group', kind: 'receiver', seller: 'fdic:101', date: '2026-02-01', how: 'court docket', by: 'Josh' });
  writeRegistry({ dir, config: cfg() });
  assert.equal(readRegistry(dir).firms[firmKey('Example Receivership Group')], undefined, 'a receiver waits for county records');
  const all = buildRegistry({ ledger: LEDGER, loans: LOANS, manual: readJson(intermediaryPaths(dir).manual) });
  assert.ok(all.firms[firmKey('Example Receivership Group')], 'it is kept, and appears once the kind is in scope');
});

test('S1 NO PEOPLE: the registry holds firm names, never a person, phone or email', () => {
  const dir = world();
  const text = readFileSync(intermediaryPaths(dir).registry, 'utf8');
  assert.doesNotMatch(text, /@|\(\d{3}\)|\d{3}-\d{3}-\d{4}/);
});

test('S1 REFERRALS ARE NOT MANDATES: shown on the firm, never ranked', () => {
  const dir = world();
  const before = rankFirms({ registry: readRegistry(dir), config: cfg(), buybox: rules.buybox, asOf: '2026-11-16' }).find((r) => r.key === ADV);
  addReferral({ dir, firmName: 'Example Sale Advisors', seller: 'fdic:101', date: '2026-10-01', by: 'Josh' });
  writeRegistry({ dir, config: cfg() });
  const R = readRegistry(dir);
  assert.equal(R.firms[ADV].referrals.length, 1);
  const after = rankFirms({ registry: R, config: cfg(), buybox: rules.buybox, asOf: '2026-11-16' }).find((r) => r.key === ADV);
  assert.deepEqual([after.score, after.mandates, after.referrals], [before.score, before.mandates, 1]);
});

test('S2 RANKING: components by mandates in our metros and sectors, named sellers, recency and balance; an unknown seller never counts', () => {
  const dir = world();
  const rows = rankFirms({ registry: readRegistry(dir), config: cfg(), buybox: { ...rules.buybox, sectors: { include: ['hospitality', 'multifamily', 'retail'] } }, asOf: '2026-11-16' });
  const list = rows.find((r) => r.key === LIST);
  const c = Object.fromEntries(list.components.map((x) => [x.id, x]));
  assert.equal(c.namedSellers.value, 1, 'two sellerless listings are never merged into a seller; only fdic:101 counts');
  assert.equal(c.metroMandates.value, 3);
  assert.equal(c.sectorMandates.value, 2, 'x2 has no sector');
  assert.equal(c.balance.value, 14000000);
  assert.ok(c.recentMandates.value > 0 && c.recentMandates.value < 3, 'older mandates are worth less');
  for (const comp of list.components) assert.ok(comp.points <= comp.weight && comp.mandates.every((id) => readRegistry(dir).mandates[id]), `${comp.id} lists real mandates`);
  assert.deepEqual(rows.map((r) => r.score), [...rows.map((r) => r.score)].sort((a, b) => b - a), 'highest first');
});

test('S3 REGISTRATION: advisors only; proof of funds waits for the credibility package; the agreement is never stored', () => {
  const dir = world();
  assert.throws(() => setRegistration({ dir, key: SS, state: 'requested', by: 'Josh' }), /for advisors only/);
  assert.throws(() => setRegistration({ dir, key: ADV, state: 'invented', by: 'Josh' }), /--state/);
  assert.throws(() => setRegistration({ dir, key: firmKey('Nobody'), state: 'requested', by: 'Josh' }), /not in the registry/);
  setRegistration({ dir, key: ADV, state: 'requested', by: 'Josh' });
  setRegistration({ dir, key: ADV, state: 'agreement_signed', by: 'Josh', recertifyBy: '2026-12-01' });
  assert.throws(() => setRegistration({ dir, key: ADV, state: 'proof_of_funds_sent', by: 'Josh' }), /credibility package/);
  approveCredibilityPackage({ dir, by: 'Josh' });
  const r = setRegistration({ dir, key: ADV, state: 'proof_of_funds_sent', by: 'Josh' });
  assert.deepEqual(r.history.map((h) => h.state), ['requested', 'agreement_signed', 'proof_of_funds_sent']);
  assert.equal(r.recertifyBy, '2026-12-01', 'kept until changed');
  const stored = readFileSync(intermediaryPaths(dir).registrations, 'utf8');
  assert.doesNotMatch(stored, /agreement text|pdf|attachment/i);
  assert.ok(readJsonl(join(dir, 'audit.jsonl')).some((l) => l.type === 'registration_state' && l.state === 'proof_of_funds_sent'));
  assert.deepEqual(registrationReminders({ registrations: readRegistrations(dir), asOf: '2026-11-16', withinDays: 30 }).map((x) => [x.key, x.overdue]), [[ADV, false]]);
  assert.deepEqual(registrationReminders({ registrations: readRegistrations(dir), asOf: '2026-12-02', withinDays: 30 }).map((x) => x.overdue), [true]);
  assert.deepEqual(registrationReminders({ registrations: readRegistrations(dir), asOf: '2026-10-01', withinDays: 30 }), []);
});

test('S3 NDA: something learned under an advisor\'s agreement goes on the existing NDA list, once an agreement is signed', () => {
  const dir = world();
  assert.throws(() => ndaUnder({ dir, key: ADV, type: 'asset', value: 'Example Plaza', by: 'Josh' }), /no signed agreement/);
  setRegistration({ dir, key: ADV, state: 'agreement_signed', by: 'Josh' });
  assert.throws(() => ndaUnder({ dir, key: ADV, type: 'email', value: 'x', by: 'Josh' }), /asset or institution/);
  ndaUnder({ dir, key: ADV, type: 'asset', value: 'Example Plaza', by: 'Josh' });
  const s = readJson(join(dir, 'suppression.json'));
  assert.deepEqual(s.entries.map((e) => [e.type, e.value]), [['asset', 'Example Plaza']]);
  assert.match(s.entries[0].reason, /NDA/);
});

test('S4 ROUTE: unknown by default; advisor only from a mandate that names the seller; direct only from a principal\'s evidence; both', () => {
  const dir = world();
  assert.equal(routeForDir(dir, 'fdic:202').route, 'unknown', 'no advisor seen is not evidence of a direct sale');
  const r = routeForDir(dir, 'fdic:101');
  assert.equal(r.route, 'advisor', 'listing x3 names the bank');
  assert.deepEqual(r.advisors.map((a) => [a.key, a.last, a.registration, a.notRegistered]), [[LIST, '2026-08-01', 'not_started', true]]);
  assert.equal(routeForDir(dir, 'fdic-receiver').route, 'advisor', 'the FDIC as receiver does sell through its advisor');
  addDirectSale({ dir, seller: 'fdic:202', date: '2026-04-01', how: 'the CFO said so on a call', by: 'Josh' });
  assert.equal(routeForDir(dir, 'fdic:202').route, 'direct');
  addDirectSale({ dir, seller: 'fdic:101', date: '2026-04-01', how: 'a principal was the buyer', by: 'Josh' });
  assert.equal(routeForDir(dir, 'fdic:101').route, 'both');
  assert.throws(() => addDirectSale({ dir, seller: 'fdic:202', date: '2026-04-01', by: 'Josh' }), /How you know/);
});

test('ALIASES: a principal joins two names of one firm', () => {
  const dir = world();
  addFirmAlias({ dir, key: ADV, alias: 'ESA Partners', by: 'Josh' });
  addMandate({ dir, firmName: 'ESA Partners', kind: 'loan_sale_advisor', seller: 'fdic:303', date: '2026-09-01', how: 'their sale notice', by: 'Josh' });
  writeRegistry({ dir, config: cfg() });
  assert.equal(readRegistry(dir).firms[ADV].mandates.length, 3);
  assert.equal(routeForDir(dir, 'fdic:303').route, 'advisor');
});

test('PRINCIPALS ONLY: no model-facing action loads intermediaries/; the ledger rebuild also rebuilds the registry', () => {
  for (const k of ['draft', 'research', 'callPrep']) assert.ok(!LOADS[k].some((p) => p === '' || 'intermediaries/registry.json'.startsWith(p)), `LOADS.${k} must not load intermediaries/`);
  assert.ok(LOADS.sales.includes('intermediaries/'));
  const dir = makeDir();
  put(dir, 'sources/edgar/loans.json', LOANS);
  execFileSync('node', [join(REPO, 'cli.mjs'), 'sales', 'build'], { env: { ...process.env, OUTBOUND_DATA_DIR: dir }, encoding: 'utf8' });
  assert.ok(readRegistry(dir)?.firms?.[SS], 'sales build rebuilt the registry from the CMBS loans');
  const out = execFileSync('node', [join(REPO, 'cli.mjs'), 'intermediaries', 'list'], { env: { ...process.env, OUTBOUND_DATA_DIR: dir }, encoding: 'utf8' });
  assert.match(out, /Example Special Servicing/);
});

// ---- S5: a firm as an account -------------------------------------------------------------------------------------------------
test('S5: a ranked firm is promoted to an account with audience intermediary; its mandates are research context, and the drafter refuses until claims exist', async () => {
  const dir = world();
  const { promoteIntermediary } = await import('../src/intermediaries.mjs');
  const { runDrafter } = await import('../src/draft.mjs');
  const { runBriefer } = await import('../src/research.mjs');
  const { loadContext } = await import('../src/guard.mjs');
  const { models } = await import('./kit.mjs');
  const key = firmKey('Example Special Servicing');
  assert.throws(() => promoteIntermediary({ dir, key: 'intermediary:nope', by: 'Pat Example' }), /No firm/);
  assert.throws(() => promoteIntermediary({ dir, key, by: '' }), /required/);
  const a = promoteIntermediary({ dir, key, by: 'Pat Example', now: new Date('2026-11-17T12:00:00Z') });
  assert.equal(a.audience, 'intermediary'); assert.equal(a.type, 'servicer'); assert.equal(a.intermediaryKey, key);
  assert.ok(a.pipeline.signals.length && a.pipeline.signals.every((s) => s.type === 'mandate' && /^CMBS special servicer acting for /.test(s.label)));
  assert.equal(a.person.name, '');
  assert.throws(() => promoteIntermediary({ dir, key, by: 'Pat Example' }), /already holds/);
  assert.ok(readJson(join(dir, 'accounts', `${a.id}.json`)).promoted.by === 'Pat Example');
  assert.ok(readJsonl(join(dir, 'audit.jsonl')).some((e) => e.type === 'intermediary_promoted' && e.accountId === a.id));
  // The briefer sees the mandates as pipeline context.
  const withPerson = { ...a, person: { ...a.person, name: 'Robin Example', title: 'Head of asset management' } };
  const b = await runBriefer({ client: null, dir, account: withPerson, models: models(), playbooks: rules.playbooks, now: new Date('2026-11-17T12:00:00Z'), dryRun: true });
  assert.match(b.user, /CMBS special servicer acting for Example Trust 2019-C1/);
  // The drafter refuses: no approved claim holds the intermediary audience.
  put(dir, `research/${a.id}.json`, { account: a.id, riskScreen: { approach: 'ok', reasons: [], finding_ids: [] }, personCheck: { status: 'confirmed' } });
  put(dir, `facts/${a.id}.json`, []);
  const ctx = loadContext({ dir, config: rules.config, env: {} });
  const d = await runDrafter({ client: null, dir, account: withPerson, channel: 'email', step: 1, senderId: 'pat', date: '2026-11-17', ctx, rules, dryRun: true });
  assert.equal(d.blocked, 'no_claims', JSON.stringify(d));
  // With an approved claim for the audience, the refusal lifts (the next check, the guard, may still say no, but not for claims).
  const claimed = { ...rules, claims: [...rules.claims, { id: 'x', text: 'Example.', sectors: ['hospitality'], audiences: ['intermediary'], approved: true }] };
  const d2 = await runDrafter({ client: null, dir, account: withPerson, channel: 'email', step: 1, senderId: 'pat', date: '2026-11-17', ctx, rules: claimed, dryRun: true });
  assert.notEqual(d2.blocked, 'no_claims');
  if (d2.dryRun) for (const leak of ['acting for', 'Example Trust', 'mandate', 'special servicer']) assert.ok(!(d2.system + d2.user).toLowerCase().includes(leak.toLowerCase()), `drafter input leaked "${leak}"`);
  assert.ok(!LOADS.draft.some((p) => p.startsWith('intermediaries')), 'the drafter loads no intermediaries/ path');
});
