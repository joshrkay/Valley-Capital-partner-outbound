// Enforcement orders (PRD next-five E18-S2) against a fake www.federalreserve.gov. Invented banks, orders and people only; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { makeDir, put, REPO } from './kit.mjs';
import { loadRules } from '../src/rules.mjs';
import { readJson, readJsonl } from '../src/store.mjs';
import { RUNS, CHANGES } from '../src/sources/runlog.mjs';
import {
  runEnforcement, verifyEnforcement, enforcementPaths, parseParties, classifyType, parseFedFile, resolveParty, orderBanks, enforcementSignals,
  unmatchedOrders, aliasParty, ordersFor, flagsIn, orderPdfLink, validateEnforcementConfig, FED_FILES,
} from '../src/sources/enforcement.mjs';
import { detectEnforcementSignals, scoreBank } from '../src/score.mjs';
import { buildCard } from '../src/candidates.mjs';
import { LOADS } from '../src/uow.mjs';
import { fakeFed, INSTITUTIONS, RECENT, OLD, PEOPLE, file } from './enforcement-fake.mjs';

const rules = loadRules();
const NOW = new Date('2026-11-16T12:00:00Z');
const CFG = { ...rules.config.enforcement, minIntervalMs: 0 };
const HQ = rules.metros.hqStates;

function clock() { let t = 1_000_000; const waits = []; return { waits, nowMs: () => t, sleep: async (ms) => { waits.push(ms); t += ms; } }; }
const world = () => { const dir = makeDir(); put(dir, 'sources/fdic/institutions.json', INSTITUTIONS); return dir; };
const run = (dir, site = fakeFed(), over = {}) => { const c = clock(); return runEnforcement({ dir, enforcement: CFG, fetchImpl: site.fetchImpl, now: NOW, clock: () => NOW, sleep: c.sleep, nowMs: c.nowMs, ...over }); };
const orders = (dir) => readJson(enforcementPaths(dir).orders, {});
const everything = (dir) => [readFileSync(enforcementPaths(dir).orders, 'utf8'), readFileSync(enforcementPaths(dir).state, 'utf8'), readFileSync(RUNS(dir), 'utf8'), existsSync(CHANGES(dir)) ? readFileSync(CHANGES(dir), 'utf8') : ''].join('\n');

// ---- Parsing ---------------------------------------------------------------------------------------------------------------------
test('organizations: one or several, joined by ";", "and" or ",", with names that hold commas; none without a city and state', () => {
  assert.deepEqual(parseParties('Example Holdings, LLC, Harbor, California, Example Financial, Inc., Harbor, California, and Example Banc, Harbor, California'),
    [{ name: 'Example Holdings, LLC', city: 'Harbor', state: 'CA' }, { name: 'Example Financial, Inc.', city: 'Harbor', state: 'CA' }, { name: 'Example Banc', city: 'Harbor', state: 'CA' }]);
  assert.deepEqual(parseParties('Example Card Bank, Provo, Utah and Example Card Corporation, Austin, Texas').map((p) => p.state), ['UT', 'TX']);
  assert.deepEqual(parseParties('Example Bancorp, Sampleton, Texas; and Example Bank, Sampleton, Texas').map((p) => p.name), ['Example Bancorp', 'Example Bank']);
  assert.deepEqual(parseParties('Example &amp; Company, Harbor, California'), [{ name: 'Example & Company', city: 'Harbor', state: 'CA' }]);
  assert.deepEqual(parseParties('Example Farmers Bank, Pine Example, WY'), [{ name: 'Example Farmers Bank', city: 'Pine Example', state: 'WY' }]);
  assert.deepEqual(parseParties('The Example Bank & Trust, S.S.B.'), [{ name: 'The Example Bank & Trust, S.S.B.', city: null, state: null }]);
  assert.deepEqual(parseParties('Example Bank, Co, in'), [{ name: 'Example Bank, Co, in', city: null, state: null }], 'a state is matched case-sensitively');
  assert.deepEqual(parseParties(''), []);
});

test('types: codes only, the strongest first; a penalty amount or a person in the type text is never kept', () => {
  assert.deepEqual(classifyType('Cease and Desist Order, Civil Money Penalty'), { type: 'cease_and_desist', types: ['cease_and_desist', 'civil_money_penalty'] });
  assert.deepEqual(classifyType('Civil Money Penalty $100,000 (collectively with Robin Sample)'), { type: 'civil_money_penalty', types: ['civil_money_penalty'] });
  assert.deepEqual(classifyType('Amendment to 4/13/2011 Order to Cease and Desist'), { type: 'modification', types: ['modification'] });
  assert.equal(classifyType('Prompt Corrective Action').type, 'pca_directive');
  assert.equal(classifyType('Written Agreement').type, 'written_agreement');
  assert.equal(classifyType('Consent Order').type, 'consent_order');
  assert.equal(classifyType('Order to Terminate Activities').type, 'other');
});

test('a file: individuals skipped before the field check; an organization record missing a field is counted; tdt may be empty on a few', () => {
  const r = parseFedFile(file(OLD()), { file: 'old' });
  assert.equal(r.read, 3);
  assert.equal(r.skippedIndividual, 1, 'the record with no url is an individual\'s: skipped, not a missing field');
  assert.deepEqual(r.missing, {});
  assert.deepEqual(r.orders.map((o) => [o.key, o.type, o.date, o.terminatedOn]), [['frb:2001', 'cease_and_desist', '2012-05-01', null], ['frb:2003', 'written_agreement', '2010-03-01', '2014-04-01']]);
  assert.ok(r.orders.every((o) => !('note' in o) && !('person' in o)), 'the note and the type text are never kept');
  const bad = parseFedFile(file([{ id: 1, edt: '2026-01-01', tdt: '1950-01-01', type: 'Written Agreement', bkorg: 'Example Bank, Sampleton, Texas' }, { id: 2, edt: '01/02/2026', tdt: '', type: 'Written Agreement', bkorg: 'Example Bank, Sampleton, Texas', url: '/x.htm' }]));
  assert.deepEqual(bad.missing, { url: 1, edt: 1 });
  const noTdt = parseFedFile(file([1, 2, 3].map((id) => ({ id, edt: '2026-01-01', type: 'Written Agreement', bkorg: 'Example Bank, Sampleton, Texas', url: '/x.htm' }))));
  assert.deepEqual(noTdt.missing, { tdt: 3 }, 'tdt absent from most records is a format change');
  assert.throws(() => parseFedFile('{"items":[]}'), /no "eaitems" list/);
  assert.throws(() => parseFedFile('<html>'), /not JSON/);
});

test('matching: an alias first, then the exact name narrowed by state and city; two banks are ambiguous, none is none; nothing fuzzier', () => {
  const ctx = { institutions: INSTITUTIONS, aliases: {} };
  assert.deepEqual(resolveParty({ name: 'EXAMPLE DESERT BANK', city: 'Mesa Example', state: 'AZ' }, ctx), { key: 'fdic:1002', how: 'name and state', candidates: ['fdic:1002'] });
  assert.equal(resolveParty({ name: 'Example Desert Bank', city: 'Mesa Example', state: 'NV' }, ctx).how, 'none', 'the same name in another state is not the bank');
  assert.deepEqual(resolveParty({ name: 'First Example Bank', city: null, state: null }, ctx), { key: null, how: 'ambiguous', candidates: ['fdic:1003', 'fdic:1004'] });
  assert.equal(resolveParty({ name: 'First Example Bank', city: 'Sampleton', state: 'TX' }, ctx).key, 'fdic:1003');
  assert.equal(resolveParty({ name: 'Example Valley Bancorp, Inc.', city: 'Sampleton', state: 'TX' }, ctx).how, 'none', 'a holding company matches only through an alias');
  assert.equal(resolveParty({ name: 'Example Valley Bancorp, Inc.', city: 'Sampleton', state: 'TX' }, { ...ctx, aliases: { 'fdic:1001': ['Example Valley Bancorp, Inc.'] } }).key, 'fdic:1001');
  assert.deepEqual(orderBanks({ parties: [{ name: 'Example Coast Bancorp', city: 'Harbor', state: 'CA' }, { name: 'Example Coast Bank', city: 'Harbor', state: 'CA' }] }, ctx), ['fdic:1005']);
});

test('flags: fixed phrases only, by word boundary, counted; the press release\'s order link', () => {
  assert.deepEqual(flagsIn('Reduce classified assets and commercial real-estate... Commercial Real Estate concentrations', ['commercial real estate', 'classified assets', 'special assets', 'concentration']),
    { found: ['classified assets', 'commercial real estate'], counts: { 'commercial real estate': 2, 'classified assets': 1 } });
  assert.equal(orderPdfLink('<a href="https://other.example/x.pdf">x</a><a href="/newsevents/pressreleases/files/enf1.pdf">Order</a>'), 'https://www.federalreserve.gov/newsevents/pressreleases/files/enf1.pdf');
  assert.equal(orderPdfLink('<a href="/files/other.pdf">x</a>'), null);
  assert.deepEqual(validateEnforcementConfig(rules.config.enforcement), [], 'the shipped config is valid');
  assert.match(validateEnforcementConfig({ ...CFG, flags: ['Bad Phrase!'] }).join(), /flags/);
});

// ---- The run -----------------------------------------------------------------------------------------------------------------------
test('a run: orders against organizations stored with codes, dates, parties and links; terminations linked to their orders', async () => {
  const dir = world();
  const site = fakeFed();
  const r = await run(dir, site);
  assert.equal(r.outcome, 'ok', JSON.stringify(r));
  assert.deepEqual([r.actionsRead, r.skippedIndividual, r.orders, r.ordersNew, r.terminations, r.inUniverse], [10, 3, 7, 7, 2, 4]);
  const o = orders(dir);
  assert.deepEqual(Object.keys(o).sort(), ['frb:2001', 'frb:2003', 'frb:2003:termination', 'frb:50001', 'frb:50002', 'frb:50004', 'frb:50004:termination', 'frb:50005', 'frb:50006']);
  const c = o['frb:50002'];
  assert.deepEqual([c.regulator, c.type, c.types, c.date, c.terminatedOn, c.link, c.kind, c.contextOnly], ['frb', 'cease_and_desist', ['cease_and_desist', 'civil_money_penalty'], '2026-08-14', null, 'https://www.federalreserve.gov/newsevents/pressreleases/enforcement20260820b.htm', 'order', true]);
  assert.deepEqual(c.parties, [{ name: 'Example Desert Bank', city: 'Mesa Example', state: 'AZ' }]);
  assert.deepEqual([c._source.source, c._source.endpoint, c._source.recordId, c._source.period], ['enforcement', FED_FILES.recent, '50002', '2026-08-14']);
  const t = o['frb:50004:termination'];
  assert.deepEqual([t.kind, t.type, t.terminates, t.terminatesType, t.date, t.link], ['termination', 'termination', 'frb:50004', 'cease_and_desist', '2026-06-30', 'https://www.federalreserve.gov/newsevents/pressreleases/files/enf20250301a1.pdf']);
  assert.equal(o['frb:50004'].terminatedOn, '2026-06-30');
  assert.equal(o['frb:50001'].link, 'https://www.federalreserve.gov/newsevents/pressreleases/enforcement20261002a.htm', 'a relative url is made absolute');
  assert.ok(site.calls.every((x) => x.ua === undefined), 'while the userAgent is a placeholder, no custom User-Agent is sent');
  const line = readJsonl(RUNS(dir)).at(-1);
  assert.equal(line.source, 'enforcement');
  assert.match(line.notes.join(' '), /3 against individuals skipped/);
});

test('actions against individuals are not stored: no person\'s name reaches the store, the run log or the change log', async () => {
  const dir = world();
  await run(dir);
  // A second run with a changed order, so the change log is written too.
  const recent = RECENT().map((x) => (x.id === '50002' ? { ...x, tdt: '2026-11-01' } : x));
  await run(dir, fakeFed({ recent }));
  assert.ok(readJsonl(CHANGES(dir)).length > 0, 'the change log was written');
  const all = everything(dir);
  for (const name of PEOPLE) assert.ok(!all.includes(name), `${name} must not be stored or logged`);
  assert.ok(!all.includes('50003') && !all.includes('50007') && !all.includes('2002'), 'not even the id of an action against an individual');
  assert.doesNotMatch(all, /collectively|Prohibition|Section 19|\$100,000/);
});

test('the order document: read once for an order naming a bank in the universe, for flags only; never its text; a fetch error is retried', async () => {
  const dir = world();
  const site = fakeFed();
  const r = await run(dir, site);
  assert.deepEqual([r.docsRead, r.docsUnreadable, r.docsKept, r.docsDeferred], [2, 2, 0, 0]);
  const f = orders(dir)['frb:50002'].flags;
  assert.deepEqual([f.readable, f.found, f.counts, f.pages, f.document], [true, ['classified assets', 'commercial real estate'], { 'classified assets': 1, 'commercial real estate': 2 }, null, 'https://www.federalreserve.gov/newsevents/pressreleases/files/enf20260820b1.pdf']);
  assert.deepEqual(orders(dir)['frb:50004'].flags.found, [], 'read, and none of the phrases');
  assert.equal(orders(dir)['frb:50001'].flags, null, 'a holding company not yet matched: its document is not read');
  assert.equal(orders(dir)['frb:2001'].flags.retry, true);
  assert.doesNotMatch(readFileSync(enforcementPaths(dir).orders, 'utf8'), /plan to reduce|liquidity|BOARD OF GOVERNORS/, 'no order text is stored');
  site.calls.length = 0;
  const again = await run(dir, site);
  assert.deepEqual([again.docsKept, again.docsUnreadable], [2, 2], 'read documents are kept; the two that could not be fetched are tried again');
  assert.ok(!site.calls.some((x) => /enf2026|enf2025/.test(x.path)), 'no PDF is fetched twice');
  const capped = await run(world(), fakeFed(), { enforcement: { ...CFG, maxDocsPerRun: 1 } });
  assert.deepEqual([capped.docsRead + capped.docsUnreadable, capped.docsDeferred], [1, 3]);
});

test('"DNE" for a link: the source publishes no document; the order is kept with no link, and no document is fetched', async () => {
  const dir = world();
  const old = [...OLD(), { id: 2004, edt: '1998-05-20', tdt: '2000-12-12', bkorg: 'Example Desert Bank, Mesa Example, Arizona', type: 'Cease and Desist Order', url: 'DNE' }];
  const site = fakeFed({ old });
  const r = await run(dir, site);
  assert.equal(r.outcome, 'ok');
  const o = orders(dir)['frb:2004'];
  assert.deepEqual([o.link, o.linkKind, o.flags.reason, o.flags.retry], [null, 'none', 'the source publishes no document for this order', undefined]);
  assert.ok(!site.calls.some((x) => /DNE/.test(x.url)));
  const v = await verifyEnforcement({ dir, enforcement: CFG, hqStates: HQ, fetchImpl: site.fetchImpl, sleep: async () => {}, now: NOW });
  assert.ok(v.checks.find((c) => c.id === 'enforcement.sourced').ok);
});

test('the field check: a missing field fails the run and writes nothing; so does a file that shrank, or robots.txt that disallows it', async () => {
  const dir = world();
  const broken = RECENT().map((x) => (x.id === '50002' ? { ...x, edt: undefined } : x));
  const r = await run(dir, fakeFed({ recent: broken }));
  assert.equal(r.outcome, 'failed');
  assert.deepEqual(r.missingFields, ['edt']);
  assert.ok(!existsSync(enforcementPaths(dir).orders), 'nothing was written');
  assert.equal(readJsonl(RUNS(dir)).at(-1).outcome, 'failed');

  assert.equal((await run(dir)).outcome, 'ok');
  const shrunk = await run(dir, fakeFed({ recent: RECENT().slice(0, 2) }));
  assert.equal(shrunk.outcome, 'failed');
  assert.match(shrunk.errors[0], /down from 7/);

  const blocked = await run(world(), fakeFed({ robots: 'User-agent: *\nDisallow: /supervisionreg/' }));
  assert.equal(blocked.outcome, 'failed');
  assert.match(blocked.errors[0], /robots\.txt disallows/);
  const down = await run(world(), fakeFed({ status: { '/supervisionreg/files/ea-old.json': 500 } }));
  assert.equal(down.outcome, 'failed');
});

test('a termination removed at the source is removed here, with a change-log line; an order is kept after it leaves the file', async () => {
  const dir = world();
  await run(dir);
  const recent = RECENT().filter((x) => x.id !== '50006').map((x) => (x.id === '50004' ? { ...x, tdt: '1950-01-01' } : x));
  const r = await run(dir, fakeFed({ recent }), { enforcement: { ...CFG, minShare: 0.5 } });
  assert.equal(r.outcome, 'ok');
  assert.equal(r.terminationsRemoved, 1);
  const o = orders(dir);
  assert.ok(!o['frb:50004:termination'] && o['frb:50004'].terminatedOn === null);
  assert.ok(o['frb:50006'], 'an order that left the file is kept');
  assert.ok(readJsonl(CHANGES(dir)).some((l) => l.key === 'frb:50004:termination' && l.field === 'removed'));
});

// ---- Matching, the review list and aliases -----------------------------------------------------------------------------------------
test('the review list: recent orders in the universe\'s states matching no bank or two; a principal\'s alias resolves one', async () => {
  const dir = world();
  await run(dir);
  const l = unmatchedOrders({ dir, enforcement: CFG, hqStates: HQ, now: NOW });
  assert.deepEqual(l.map((x) => x.key), ['frb:50001', 'frb:50006'], 'Ohio is outside the metros\' states and like no bank; 2001 and 2003 matched; old orders are outside the window');
  assert.deepEqual(l[0].parties[0].suggestions.map((s) => s.key), ['fdic:1001']);
  assert.deepEqual([l[1].parties[0].how, l[1].parties[0].candidates], ['ambiguous', ['fdic:1003', 'fdic:1004']]);

  assert.throws(() => aliasParty({ dir, key: 'fdic:9999', name: 'Example Valley Bancorp, Inc.', by: 'Pat Example' }), /not in the bank list/);
  assert.throws(() => aliasParty({ dir, key: 'fdic:1001', name: 'Example Valley Bancorp, Inc.' }), /principal's name/);
  const a = aliasParty({ dir, key: 'fdic:1001', name: 'Example Valley Bancorp, Inc.', by: 'Pat Example' });
  assert.deepEqual(a.aliases, ['Example Valley Bancorp, Inc.']);
  assert.deepEqual(unmatchedOrders({ dir, enforcement: CFG, hqStates: HQ, now: NOW }).map((x) => x.key), ['frb:50006']);
  assert.deepEqual(unmatchedOrders({ dir, enforcement: CFG, hqStates: ['OH'], now: NOW }).map((x) => x.key), ['frb:50005', 'frb:50006'], 'the states come from metros.json');
  assert.deepEqual(ordersFor({ dir, key: 'fdic:1001' }).map((o) => o.key), ['frb:50001', 'frb:2001']);
  // The next run reads the newly matched order's document.
  const r = await run(dir);
  assert.equal(orders(dir)['frb:50001'].flags.found.join(), 'problem assets');
  assert.equal(r.inUniverse, 5);
});

// ---- Signals, scoring and the card ---------------------------------------------------------------------------------------------------
test('signals: an event per order, a state signal while an order in force has no termination, an event per termination; fixed labels', async () => {
  const dir = world();
  await run(dir);
  const s = enforcementSignals({ dir });
  assert.deepEqual(s['fdic:1002'].map((x) => [x.id, x.kind, x.type]), [['enforcement-active:frb:50002', 'state', 'enforcement_active'], ['enforcement:frb:50002', 'event', 'enforcement']]);
  assert.equal(s['fdic:1002'][0].label, 'Under a cease-and-desist order from the Federal Reserve effective 2026-08-14; no termination is recorded');
  assert.equal(s['fdic:1002'][1].label, 'Cease-and-desist order from the Federal Reserve, effective 2026-08-14');
  assert.deepEqual(s['fdic:1002'][1].flags, ['classified assets', 'commercial real estate']);
  assert.deepEqual(s['fdic:1005'].map((x) => x.id), ['enforcement:frb:50004:termination', 'enforcement:frb:50004', 'enforcement:frb:2003:termination', 'enforcement:frb:2003'], 'terminated: no state signal');
  assert.equal(s['fdic:1005'][0].label, 'Cease-and-desist order from the Federal Reserve terminated, effective 2026-06-30');
  assert.equal(s['fdic:1003'], undefined, 'an ambiguous order gives no bank a signal');
  // Windows, at the scoring date: events within windowDays, the state signal while the order is within activeWithinDays.
  const kept = (key) => detectEnforcementSignals({ signals: s[key], windowDays: 365, activeWithinDays: 3650, asOf: '2026-11-16' }).map((x) => x.id);
  assert.deepEqual(kept('fdic:1002'), ['enforcement-active:frb:50002', 'enforcement:frb:50002']);
  assert.deepEqual(kept('fdic:1005'), ['enforcement:frb:50004:termination']);
  assert.deepEqual(kept('fdic:1001'), [], 'a 2012 order with no termination recorded is too old to be called in force');
  assert.ok(detectEnforcementSignals({ signals: s['fdic:1002'] }).every((x) => x.rule === 'enforcement'));
});

test('scoring: signals only, no points (D-E1); the card states an order in force once, from fixed templates', async () => {
  const dir = world();
  await run(dir);
  const enforcement = enforcementSignals({ dir })['fdic:1002'];
  const base = { cert: '1002', institution: INSTITUTIONS[1002], footprint: {}, financials: null, scoring: rules.scoring, buybox: rules.buybox, metros: rules.metros, latestRepdte: '20260630', asOf: '2026-11-16' };
  const without = scoreBank(base);
  const withOrders = scoreBank({ ...base, enforcement });
  assert.equal(withOrders.score, without.score);
  assert.deepEqual(withOrders.axes, without.axes);
  assert.deepEqual(withOrders.signals.filter((x) => x.rule === 'enforcement').map((x) => x.id), ['enforcement-active:frb:50002', 'enforcement:frb:50002']);
  const card = buildCard({ ...withOrders, latestRepdte: '20260630' }, { scoring: rules.scoring });
  const sentences = card.sentences.filter((x) => x.evidence.includes('frb:50002'));
  assert.deepEqual(sentences.map((x) => x.text), ['Under a cease-and-desist order from the Federal Reserve effective 2026-08-14; no termination is recorded.']);
  const term = buildCard({ ...scoreBank({ ...base, enforcement: enforcementSignals({ dir })['fdic:1005'] }), latestRepdte: '20260630' }, { scoring: rules.scoring });
  assert.ok(term.sentences.some((x) => x.text === 'An enforcement action: Cease-and-desist order from the Federal Reserve terminated, effective 2026-06-30.'));
});

// ---- Checking it against the source ------------------------------------------------------------------------------------------------
test('verify: fresh, sourced, every stored order found again with the same termination, and every order matched or on the review list', async () => {
  const dir = world();
  await run(dir);
  const ok = await verifyEnforcement({ dir, enforcement: CFG, hqStates: HQ, fetchImpl: fakeFed().fetchImpl, sleep: async () => {}, now: NOW });
  assert.ok(ok.checks.every((c) => c.ok), JSON.stringify(ok.checks));
  assert.deepEqual(ok.checks.map((c) => c.id), ['enforcement.fresh', 'enforcement.sourced', 'enforcement.recall', 'enforcement.matched']);
  assert.match(ok.checks[3].summary, /5 order\(s\) in the review window: 2 matched to a bank in the list, 2 on the review list \(outbound enforcement unmatched\), and 1 naming no party/);
  assert.ok(ok.sample.length && ok.sample.every((x) => x.check.startsWith('https://www.federalreserve.gov/')));
  const changed = RECENT().filter((x) => x.id !== '50005').map((x) => (x.id === '50002' ? { ...x, tdt: '2026-11-10' } : x));
  const bad = await verifyEnforcement({ dir, enforcement: CFG, hqStates: HQ, fetchImpl: fakeFed({ recent: changed }).fetchImpl, sleep: async () => {}, now: new Date('2027-02-01T00:00:00Z') });
  const by = Object.fromEntries(bad.checks.map((c) => [c.id, c]));
  assert.equal(by['enforcement.fresh'].ok, false);
  assert.equal(by['enforcement.recall'].ok, false);
  assert.deepEqual(by['enforcement.recall'].detail, { gone: ['frb:50005'], notStored: [], termination: ['frb:50002'] });
  const none = await verifyEnforcement({ dir: makeDir(), enforcement: CFG });
  assert.match(none.checks[0].summary, /No enforcement orders yet/);
});

// ---- Where the orders go, and where they do not ----------------------------------------------------------------------------------
test('no drafting, research or call action loads the enforcement store; the job\'s own load list is narrow', () => {
  for (const k of ['draft', 'research', 'callPrep', 'callConfirm', 'pilot', 'routes']) assert.ok(!LOADS[k].some((p) => 'sources/enforcement/orders.json'.startsWith(p) || p.startsWith('sources/')), `${k} must not load sources/enforcement/`);
  assert.deepEqual(LOADS.enforcement, ['sources/enforcement/', 'sources/fdic/institutions.json', 'candidates/aliases.json', 'sources/runs.jsonl']);
  const code = readFileSync(join(REPO, 'src', 'draft.mjs'), 'utf8') + readFileSync(join(REPO, 'src', 'lint.mjs'), 'utf8');
  assert.doesNotMatch(code, /enforcement/);
});

test('the command line: the review list and an alias, from stored data with no network', async () => {
  const dir = world();
  await run(dir);
  const env = { ...process.env, OUTBOUND_DATA_DIR: dir };
  const cli = (...args) => execFileSync(process.execPath, [join(REPO, 'cli.mjs'), ...args], { env, encoding: 'utf8' });
  assert.match(cli('enforcement', 'unmatched'), /order\(s\) on the review list[\s\S]*frb:50001[\s\S]*similar: fdic:1001 Example Valley Bank[\s\S]*more than one bank has this name: fdic:1003, fdic:1004/);
  assert.match(cli('enforcement', 'alias', '--key', 'fdic:1001', '--name', 'Example Valley Bancorp, Inc.', '--by', 'Pat Example'), /fdic:1001 \(Example Valley Bank\) now also matches: Example Valley Bancorp, Inc\./);
  assert.match(cli('enforcement', 'list', '--key', 'fdic:1002'), /2026-08-14 {2}cease-and-desist order, no termination recorded {2}\[frb:50002\] {2}phrases: classified assets, commercial real estate/);
  assert.match(cli('help'), /outbound sources run enforcement/);
});
