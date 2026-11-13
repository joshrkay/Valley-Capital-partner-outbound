// The SEC EDGAR CMBS adapter (PRD E4-S2, E4-S3) against a fake EDGAR. Invented trusts, loans and people only; no network.
// The fixtures copy the real formats seen on 2026-11-13: the fixed-width form index, a filing's index.json, an EX-102 in the CMBS
// namespace (MM-DD-YYYY dates, ZIPs without leading zeros), and a distribution report whose cover splits phrases across tags.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { makeDir } from './kit.mjs';
import { loadRules } from '../src/rules.mjs';
import { readJson, readJsonl } from '../src/store.mjs';
import { parseFormIndex, latestByCik, quartersFor, parseCmbsAssets, decodeEntities, metroIndex, toLoan, loanSignals, specialServicerFromReport, runEdgar, edgarPaths, CMBS_NS } from '../src/sources/edgar.mjs';
import { getText } from '../src/sources/http.mjs';
import { fakeSec, FORM_IDX, EX102, NOT_CMBS, REPORT } from './edgar-fake.mjs';

const rules = loadRules();
const NOW = new Date('2026-11-13T12:00:00Z');
const UA = 'Example Firm ops@example.test';
const SEC_CFG = { ...rules.config.sec, userAgent: UA, minIntervalMs: 0, knownSpecialServicers: ['Example Special Servicing LLC'] };

const run = (dir, sec, over = {}) => runEdgar({ dir, metros: rules.metros, buybox: rules.buybox, scoring: rules.scoring, sec, fetchImpl: sec.fetchImpl, now: NOW, sleep: async () => {}, ...over });

test('the form index: our forms only, the latest filing per trust in the window, and the quarters the window spans', () => {
  const e = parseFormIndex(FORM_IDX, ['ABS-EE', 'ABS-EE/A', '10-D']);
  assert.deepEqual(e.map((x) => x.form).sort(), ['10-D', 'ABS-EE', 'ABS-EE', 'ABS-EE', 'ABS-EE']);
  assert.equal(e[0].cik, '1000001'); assert.equal(e[0].accession, '0009999999-26-000101');
  const latest = latestByCik(e, ['ABS-EE', 'ABS-EE/A'], '2026-09-29');
  assert.deepEqual([...latest.keys()].sort(), ['1000001', '1000002', '1000003']);
  assert.deepEqual(quartersFor(NOW, 45), ['2026/QTR3', '2026/QTR4']);
  assert.deepEqual(quartersFor(new Date('2026-08-20T00:00:00Z'), 30), ['2026/QTR3']);
  const amended = latestByCik([...e, { form: 'ABS-EE/A', company: 'x', cik: '1000001', date: '2026-10-30', accession: '0009999999-26-000999' }], ['ABS-EE', 'ABS-EE/A'], '2026-09-29');
  assert.equal(amended.get('1000001').accession, '0009999999-26-000999', 'a later amendment replaces the original');
});

test('the EX-102 parser: namespace, one record per loan, properties nested, entities decoded, prefixes tolerated', () => {
  const p = parseCmbsAssets(EX102);
  assert.equal(p.namespace, CMBS_NS);
  assert.equal(p.assets.length, 4);
  assert.equal(p.assets[0].fields.workoutStrategyCode, '5');
  assert.equal(p.assets[0].properties[0].propertyName, 'Example Apartments & Lofts');
  assert.equal(p.assets[3].properties.length, 2);
  assert.equal(p.assets[0].fields.propertyName, undefined, 'a property field does not leak into the loan');
  const prefixed = parseCmbsAssets(`<ns1:assetData xmlns:ns1="${CMBS_NS}"><ns1:assets><ns1:assetNumber>7</ns1:assetNumber><ns1:property><ns1:propertyState>CA</ns1:propertyState></ns1:property><ns1:emptyField/></ns1:assets></ns1:assetData>`);
  assert.equal(prefixed.namespace, CMBS_NS);
  assert.deepEqual(prefixed.assets[0].fields, { assetNumber: '7', emptyField: '' });
  assert.equal(decodeEntities('A &amp; B &#39;C&#x27; &nbsp;'), "A & B 'C'  ");
  assert.equal(parseCmbsAssets(NOT_CMBS).namespace, 'http://www.sec.gov/edgar/document/absee/autoloan/assetdata');
});

test('a loan is kept only with a property in a buy-box metro and a buy-box sector, with codes in words and ZIPs repaired', () => {
  const idx = metroIndex(rules.metros);
  const sectors = rules.buybox.sectors.include;
  const src = { source: 'edgar' };
  const [mf, office, hotelBoston, retailDenver] = parseCmbsAssets(EX102).assets.map((asset) => toLoan({ asset, trust: { cik: '1000001', name: 'T' }, idx, sectors, src }));
  assert.equal(office, null, 'office is not a buy-box sector');
  assert.equal(hotelBoston, null, 'Boston is not a buy-box metro');
  assert.equal(mf.key, 'cmbs:1000001:1');
  assert.deepEqual(mf.metros, ['31080']); assert.deepEqual(mf.sectors, ['multifamily']);
  assert.deepEqual([mf.paymentStatus.label, mf.workout.label], ['90 or more days delinquent', 'Note sale']);
  assert.equal(mf.maturity, '2027-11-06');
  assert.equal(mf.assetLevel, true);
  assert.deepEqual(retailDenver.metros, ['19740'], 'a multi-property loan is kept when one property is in the market');
  assert.equal(retailDenver.properties.find((p) => p.city === 'Boston').zip, '02110');
});

test('signals: note sale, special servicing until the loan goes back to the master servicer, maturity window, nothing for a paid-off loan', () => {
  const idx = metroIndex(rules.metros);
  const [mf, , , retail] = parseCmbsAssets(EX102).assets.map((asset) => toLoan({ asset, trust: { cik: '1', name: 'T' }, idx, sectors: rules.buybox.sectors.include, src: {} }));
  const types = (l, o) => loanSignals(l, { now: NOW, ...o }).map((s) => s.type);
  assert.deepEqual(types(mf), ['special_servicing', 'note_sale', 'delinquent', 'maturing']);
  assert.deepEqual(types(retail), ['maturing'], 'returned to the master servicer after its transfer, so not in special servicing');
  assert.deepEqual(types(mf, { maturityMonths: 6 }).includes('maturing'), false);
  assert.deepEqual(types({ ...mf, paidOff: true }), []);
});

test('the special servicer: the reviewed name when it matches, otherwise only the first cell, never a person or their details', () => {
  assert.deepEqual(specialServicerFromReport(REPORT('Example Special Servicing LLC'), ['Example Special Servicing LLC']), { name: 'Example Special Servicing LLC', matched: true });
  const unknown = specialServicerFromReport(REPORT('Other Asset Management LLC'), ['Example Special Servicing LLC']);
  assert.deepEqual(unknown, { name: 'Other Asset Management LLC', matched: false });
  assert.doesNotMatch(JSON.stringify(unknown), /Pat Person|555|@/);
  assert.equal(specialServicerFromReport('<p>No such label here</p>').name, null);
});

test('a full run: CMBS trusts only, metro loans only, servicer named, every request identified, big non-CMBS files never fetched', async () => {
  const dir = makeDir();
  const sec = { ...SEC_CFG, ...fakeSec() };
  const r = await run(dir, sec);
  assert.equal(r.outcome, 'ok', JSON.stringify(r));
  assert.deepEqual([r.filings, r.cmbsTrusts, r.notCmbsSized, r.notCmbs, r.loansRead, r.loansKept, r.reports], [3, 1, 1, 1, 4, 2, 1]);
  assert.ok(sec.calls.every((c) => c.ua === UA), 'every request names the firm, as the SEC asks');
  assert.ok(!sec.calls.some((c) => c.url.endsWith('ex102auto.xml')), 'the 126 MB auto-loan file was skipped by its size, never downloaded');
  const p = edgarPaths(dir);
  const loans = readJson(p.loans);
  assert.deepEqual(Object.keys(loans).sort(), ['cmbs:1000001:1', 'cmbs:1000001:4']);
  assert.equal(loans['cmbs:1000001:1'].specialServicer, 'Example Special Servicing LLC');
  assert.equal(loans['cmbs:1000001:1']._source.endpoint, 'ABS-EE 0009999999-26-000102 exh_102.xml');
  const s = readJson(p.servicers)['Example Special Servicing LLC'];
  assert.deepEqual([s.loans, s.specialServicing, s.noteSale, s.delinquent, s.balance], [2, 1, 1, 1, 48200000]);
  assert.deepEqual(s.metros, ['19740', '31080']);
  assert.equal(readJson(p.trusts)['1000001'].loansInMarket, 2);
  assert.doesNotMatch(JSON.stringify(readJson(p.trusts)), /Pat Person|555-?010|pat\.person/, 'no contact from the report is stored');
  assert.equal(readJsonl(join(dir, 'sources', 'runs.jsonl')).at(-1).source, 'edgar');
});

test('an unrecognized special servicer is flagged in the run notes for review', async () => {
  const dir = makeDir();
  const r = await run(dir, { ...SEC_CFG, ...fakeSec({ firm: 'Other Asset Management LLC' }) });
  assert.equal(r.notes, 1);
  assert.match(readJsonl(join(dir, 'sources', 'runs.jsonl')).at(-1).notes[0], /"Other Asset Management LLC" is not on the reviewed list/);
});

test('a change in a loan\'s status between runs is logged with the old and new value', async () => {
  const dir = makeDir();
  await run(dir, { ...SEC_CFG, ...fakeSec() });
  await run(dir, { ...SEC_CFG, ...fakeSec({ ex102: EX102.replace('<paymentStatusLoanCode>3</paymentStatusLoanCode>', '<paymentStatusLoanCode>5</paymentStatusLoanCode>') }) });
  const ch = readJsonl(join(dir, 'sources', 'changes.jsonl')).filter((c) => c.key === 'cmbs:1000001:1' && c.field === 'paymentStatus');
  assert.equal(ch.length, 1);
  assert.deepEqual([ch[0].old.code, ch[0].new.code], ['3', '5']);
});

test('the run refuses a placeholder User-Agent, because the SEC asks for a real contact', async () => {
  await assert.rejects(run(makeDir(), { ...SEC_CFG, userAgent: rules.config.sec.userAgent, ...fakeSec() }), /sec\.userAgent is a placeholder/);
  assert.match(rules.config.sec.userAgent, /\[CONFIRM/, 'the shipped config keeps the placeholder until a principal fills it');
});

test('a capped text read stops downloading once it has enough', async () => {
  let pulled = 0;
  const big = new ReadableStream({ pull(c) { pulled++; if (pulled > 1000) { c.close(); return; } c.enqueue(new Uint8Array(1024).fill(65)); } });
  const r = await getText('https://example.test/big', {}, { fetchImpl: async () => new Response(big, { status: 200 }), maxBytes: 4096 });
  assert.equal(r.truncated, true);
  assert.equal(r.text.length, 4096);
  assert.ok(pulled < 20, `read ${pulled} chunks of a 1000-chunk body`);
});
