// PRD next-five E20-S1 and S2: the market data pack and its disclosure guard. Every bank, loan and number here is invented.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { makeDir, put, REPO } from './kit.mjs';
import { loadRules } from '../src/rules.mjs';
import { LOADS } from '../src/uow.mjs';
import { buildPack, complementary, primary, writePack, LEFT_OUT } from '../src/market.mjs';

const rules = loadRules();
const METROS = [{ cbsa: '12420', label: 'Austin' }, { cbsa: '19740', label: 'Denver' }, { cbsa: '38060', label: 'Phoenix' }];
const SECTORS = ['hospitality', 'multifamily', 'retail'];
const Q = '2026-06-30';
// A Call Report row (thousands of dollars): CRE in three categories, with noncurrent and nonaccrual amounts.
const row = (bal, ncShare = 0.02) => ({ LNRECONS: bal * 0.2, LNREMULT: bal * 0.3, LNRENRES: bal * 0.5, NCRECONS: bal * 0.2 * ncShare, NCREMULT: bal * 0.3 * ncShare, NCRENRES: bal * 0.5 * ncShare,
  NARECONS: 0, NAREMULT: 0, NARENRES: bal * 0.5 * ncShare / 2 });
const quarters = (bal, nc) => ({ quarters: { 20260630: row(bal, nc), 20260331: row(bal, nc * 0.5), 20250630: row(bal, nc * 0.25) } });
function world() {
  const fin = {}, footprint = {};
  const bank = (cert, bal, nc, deposits, total) => { fin[cert] = quarters(bal, nc); footprint[cert] = { sod: { depositsByMetro: deposits, totalDeposits: total } }; };
  // Austin: six banks of equal size, all their deposits there.
  for (let i = 1; i <= 6; i++) bank(`10${i}`, 100000, 0.02, { 12420: 500 }, 500);
  // Denver: one bank dominates; four small ones.
  bank('201', 5000000, 0.05, { 19740: 1000 }, 1000);
  for (let i = 2; i <= 5; i++) bank(`20${i}`, 10000, 0.01, { 19740: 100 }, 100);
  // Phoenix: five banks with only half their deposits there.
  for (let i = 1; i <= 5; i++) bank(`30${i}`, 200000, 0.04, { 38060: 300 }, 600);
  const loans = {};
  // Austin hospitality: 12 loans, 3 trusts, 2 servicers, none dominant. Austin retail: 12 loans, one huge.
  for (let i = 0; i < 12; i++) loans[`h${i}`] = { key: `h${i}`, cik: `${i % 3}`, specialServicer: i % 2 ? 'Servicer A' : 'Servicer B', metros: ['12420'], sectors: ['hospitality'], balance: 1000000, period: Q, specialServicingSince: i < 4 ? '2026-05-01' : '2025-01-01', signals: [{ type: 'special_servicing' }] };
  for (let i = 0; i < 12; i++) loans[`r${i}`] = { key: `r${i}`, cik: `${i % 3}`, specialServicer: i % 2 ? 'Servicer A' : 'Servicer B', metros: ['12420'], sectors: ['retail'], balance: i === 0 ? 90000000 : 1000000, period: Q, signals: [{ type: 'special_servicing' }] };
  return { fin, footprint, loans, dispositions: {} };
}
const pack = (over = {}) => buildPack({ ...world(), metros: METROS, sectors: SECTORS, quarter: Q, rules: {}, ...over });

test('FDIC: balances split by deposit share, each dollar counted once; ratios by Call Report category and all CRE', () => {
  const p = pack();
  const a = p.fdic.cells['12420'].allCre;
  assert.equal(a.banks, 6);
  assert.equal(a.noncurrentRatio, 0.02);
  assert.equal(p.fdic.cells['38060'].multifamily.noncurrentRatio, 0.04, 'half the deposits there: half the balances, the same ratio');
  assert.match(p.method.fdic, /Deposit-share proxy/);
  assert.equal(a.noncurrentChangeQoQ, 0.01, 'q/q: 2% now, 1% last quarter');
  assert.equal(a.noncurrentChangeYoY, 0.015);
});

test('GUARD (banks): too few banks, or one bank over half, suppresses the figure; the reasons are given, never the bank', () => {
  const p = pack();
  const d = p.fdic.cells['19740'].allCre;
  assert.equal(d.suppressed, true);
  assert.ok(d.reasons.some((r) => /over 50%/.test(r)), JSON.stringify(d.reasons));
  assert.equal(d.noncurrentRatio, undefined, 'a suppressed figure carries no number');
  assert.equal(p.fdic.cells['38060'].allCre.suppressed, undefined, 'five equal banks are enough');
});

test('COMPLEMENTARY SUPPRESSION: one hidden figure in a row or column takes another with it, so a total cannot rebuild it', () => {
  const cell = (size, suppressed = false) => ({ size, suppressed });
  const g = complementary({ a: { x: cell(10, true), y: cell(20), z: cell(30) }, b: { x: cell(5), y: cell(40), z: cell(50) } }, { axes: ['rows', 'columns'] });
  assert.equal(g.a.y.suppressed, true, 'the smallest other cell in row a');
  assert.equal(g.b.x.suppressed, true, 'column x then has one hidden: its smallest other is hidden too');
  for (const line of [['a', 'b'].map((r) => g[r].x), ['a', 'b'].map((r) => g[r].y), Object.values(g.a), Object.values(g.b)])
    assert.notEqual(line.filter((c) => c.suppressed).length, 1, 'no row or column is left with exactly one hidden figure');
});

test('COMPLEMENTARY by default works along rows only: the pack publishes no total across metros, so no column is a line', () => {
  const cell = (size, suppressed = false) => ({ size, suppressed });
  const g = complementary({ a: { x: cell(10, true), y: cell(20) }, b: { x: cell(5), y: cell(40) } });
  assert.deepEqual([g.a.y.suppressed, g.b.x.suppressed], [true, false]);
  assert.equal(pack().fdic.cells['38060'].allCre.suppressed, undefined, "Denver's hidden row does not hide Phoenix");
});

test('CHANGES: shown only when the figure is published in both quarters', () => {
  const w = world();
  // Last quarter, Phoenix had only two banks reporting.
  for (const c of ['303', '304', '305']) delete w.fin[c].quarters['20260331'];
  const p = buildPack({ ...w, metros: METROS, sectors: SECTORS, quarter: Q });
  const x = p.fdic.cells['38060'].allCre;
  assert.equal(x.suppressed, undefined);
  assert.equal(x.noncurrentChangeQoQ, null);
  assert.match(x.changeNote, /both quarters/);
});

test('GUARD (CMBS): at least 10 loans, 3 trusts, 2 servicers, and no one loan over half the balance', () => {
  const p = pack();
  const h = p.cmbs.inSpecialServicing['12420'].hospitality;
  assert.deepEqual(h, { loans: 12, balance: 12000000 });
  const r = p.cmbs.inSpecialServicing['12420'].retail;
  assert.equal(r.suppressed, true);
  assert.ok(r.reasons.some((x) => /over 50%/.test(x)));
  assert.equal(p.cmbs.newTransfers['12420'].hospitality.suppressed, true, 'four new transfers are too few');
  assert.deepEqual(primary({ contributors: Array.from({ length: 10 }, (_, i) => ({ id: i, size: 1, groups: { trust: 't1', servicer: 's1' } })) }, { min: 10, maxShare: 0.5, unit: 'loans', minGroups: { trust: 3, servicer: 2 } }),
    ['fewer than 3 trusts', 'fewer than 2 servicers']);
});

test('NAMES NOTHING, LEAVES OUT failures, FDIC sales and recoveries', () => {
  const text = JSON.stringify(pack());
  for (const leak of ['Servicer A', 'Servicer B', '"cik"', '"201"', 'recovery":', 'impliedRecovery', 'failure"']) assert.ok(!text.includes(leak), `the pack leaked ${leak}`);
  assert.equal(LEFT_OUT.length, 2);
  assert.throws(() => pack({ quarter: '2026-06-15' }), /quarter-end/);
});

test('WRITTEN to market/<quarter>.json and .md from the stores; the command line; principals only', () => {
  const dir = makeDir(); const w = world();
  for (const [c, f] of Object.entries(w.fin)) put(dir, `sources/fdic/financials/${c}.json`, f);
  put(dir, 'sources/fdic/footprint.json', w.footprint);
  put(dir, 'sources/edgar/loans.json', w.loans);
  const r = writePack({ dir, quarter: Q, metros: { metros: METROS }, buybox: rules.buybox, config: rules.config });
  assert.match(readFileSync(r.paths.md, 'utf8'), /not shown: too few sources/);
  const out = execFileSync('node', [join(REPO, 'cli.mjs'), 'market', 'show'], { env: { ...process.env, OUTBOUND_DATA_DIR: dir }, encoding: 'utf8' });
  assert.match(out, /Market data pack, quarter ending 2026-06-30/);
  for (const k of ['draft', 'research', 'callPrep']) assert.ok(!LOADS[k].some((p) => p === '' || 'market/2026-06-30.json'.startsWith(p)), `LOADS.${k} must not load market/`);
  assert.deepEqual(rules.config.market && [rules.config.market.minInstitutions, rules.config.market.maxShare, rules.config.market.minLoans, rules.config.market.minTrusts, rules.config.market.minServicers], [5, 0.5, 10, 3, 2]);
});
