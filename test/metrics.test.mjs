// Metric formulas and signals (PRD E3-S3, E3-S4, Appendix A), against hand-computed values. Invented numbers only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeQuarterMetrics, computeMetrics, detectSignals, shiftQuarter, periodLabel, quarterIndex, METRICS, METRIC_FIELDS, CATEGORIES,
  computeConcentration, concentrationDenominator, detectConcentrationSignals, detectStructureSignals, addMonths, CONCENTRATION, CONCENTRATION_FIELDS, DENOMINATORS } from '../src/metrics.mjs';
import { FDIC_FIELDS } from '../src/sources/fdic.mjs';

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-12, `${msg ?? ''} ${a} != ${b}`);

// An invented quarter, in thousands of dollars.
const Q = (over = {}) => ({
  ASSET: 3000000, LNLSNET: 2000000, LNRECONS: 100000, LNREMULT: 300000, LNRENRES: 600000, LNRENROW: 200000, LNRENROT: 400000,
  NCRECONS: 2000, NCREMULT: 15000, NCRENRES: 12000, NCRENROW: 3000, NCRENROT: 9000,
  NARECONS: 1000, NAREMULT: 10000, NARENRES: 8000, P3RENRES: 6000, P3REMULT: 4000, P9RENRES: 2000, P9REMULT: 1000,
  ORE: 4000, ORECONS: 500, OREMULT: 1000, ORENRES: 1500, NTRECONQ: 0, NTREMULQ: 300, NTRENRSQ: 200, NTLNLSQ: 600, ...over,
});

test('each formula matches a hand computation', () => {
  const m = computeQuarterMetrics(Q(), '20260630');
  close(m.values.creLoans, 1000000, 'CRE loans');
  close(m.values.creNoncurrentRatio, 29000 / 1000000, 'noncurrent');          // (12000 + 15000 + 2000) / (600000 + 300000 + 100000)
  close(m.values.creNonaccrualRatio, 19000 / 1000000, 'nonaccrual');          // (8000 + 10000 + 1000) / 1,000,000
  close(m.values.earlyStageDelinquency, 10000 / 900000, 'early stage');       // (6000 + 4000) / (600000 + 300000)
  close(m.values.creOreo, 3000, 'OREO');                                      // 1500 + 1000 + 500
  close(m.values.creOreoRatio, 3000 / 1000000, 'OREO ratio');
  close(m.values.creNetChargeOffs, 500, 'charge-offs');                       // 200 + 300 + 0, quarterly fields
  close(m.values.creNetChargeOffRate, 500 / 1000000, 'charge-off rate');
  close(m.values.investorCreShare, 400000 / 600000, 'investor share');
  close(m.values.creShareOfLoans, 0.5, 'CRE share of loans');
  close(m.values.mfNoncurrentRatio, 15000 / 300000, 'multifamily noncurrent');
  close(m.values.mfNonaccrualRatio, 10000 / 300000, 'multifamily nonaccrual');
  close(m.values.mfEarlyStageDelinquency, 4000 / 300000, 'multifamily early stage');
});

test('a zero denominator gives null with a reason, never 0; a missing field gives null with a reason', () => {
  const m = computeQuarterMetrics(Q({ LNREMULT: 0 }), '20260630');
  assert.equal(m.values.mfNoncurrentRatio, null);
  assert.match(m.reasons.mfNoncurrentRatio, /zero denominator: LNREMULT is 0/);
  const z = computeQuarterMetrics(Q({ LNRECONS: 0, LNREMULT: 0, LNRENRES: 0 }), '20260630');
  assert.equal(z.values.creNoncurrentRatio, null);
  assert.match(z.reasons.creNoncurrentRatio, /zero denominator/);
  const miss = computeQuarterMetrics(Q({ NCREMULT: null }), '20260630');
  assert.equal(miss.values.creNoncurrentRatio, null);
  assert.match(miss.reasons.creNoncurrentRatio, /missing NCREMULT/);
});

test('charge-offs come only from the quarterly fields; year-to-date fields are never read', () => {
  const ytdOnly = Q({ NTRECONQ: undefined, NTREMULQ: undefined, NTRENRSQ: undefined, NTRECONS: 900, NTREMULT: 900, NTRENRES: 900 });
  const m = computeQuarterMetrics(ytdOnly, '20260630');
  assert.equal(m.values.creNetChargeOffs, null);
  for (const f of METRIC_FIELDS) assert.ok(!/^NT/.test(f) || /Q$/.test(f), `${f} is a year-to-date flow`);
});

test('quarter arithmetic and labels', () => {
  assert.equal(shiftQuarter('20260630', -1), '20260331');
  assert.equal(shiftQuarter('20260331', -1), '20251231');
  assert.equal(shiftQuarter('20260630', -4), '20250630');
  assert.equal(shiftQuarter('20251231', 1), '20260331');
  assert.equal(periodLabel('20260630'), 'June 30, 2026');
  assert.throws(() => quarterIndex('20260615'));
});

const file = (cert, map) => ({ CERT: cert, quarters: Object.fromEntries(Object.entries(map).map(([r, o]) => [r, Q(o)])) });

test('changes from the prior quarter and four quarters earlier; a gap gives null with a reason', () => {
  const s = computeMetrics(file('77', { '20250630': { NCRENRES: 2000 }, '20260331': { NCRENRES: 7000 }, '20260630': { NCRENRES: 12000 } }));
  assert.equal(s.latest, '20260630');
  assert.deepEqual(s.quarters.map((q) => q.repdte), ['20250630', '20260331', '20260630']);
  const L = s.quarters.at(-1);
  close(L.changes.creNoncurrentRatio.qoq, 5000 / 1000000, 'qoq');            // 29000 vs 24000 noncurrent on the same 1,000,000 base
  close(L.changes.creNoncurrentRatio.yoy, 10000 / 1000000, 'yoy');           // 29000 vs 19000
  const mid = s.quarters[1];                                                   // 20260331: no 20251231 on file
  assert.equal(mid.changes.creNoncurrentRatio.qoq, null);
  assert.match(mid.changeReasons['creNoncurrentRatio.qoq'], /no data for 20251231/);
});

const eight = (fn) => Object.fromEntries(['20240930', '20241231', '20250331', '20250630', '20250930', '20251231', '20260331', '20260630'].map((r, i) => [r, fn(i)]));

test('signals: rising, first positive, above, change above; evidence points to the quarter records', () => {
  const s = computeMetrics(file('42', eight((i) => ({ NCREMULT: 5000 + i * 1500, NTREMULQ: i === 7 ? 300 : 0, NTRENRSQ: 0, NTRECONQ: 0 }))));
  const rules = [
    { id: 'rise2', type: 'rising', metric: 'creNoncurrentRatio', quarters: 2, label: 'x' },
    { id: 'first', type: 'firstPositive', metric: 'creNetChargeOffs', lookback: 8, label: 'x' },
    { id: 'high', type: 'above', metric: 'mfNoncurrentRatio', threshold: 0.05, label: 'x' },
    { id: 'jump', type: 'changeAbove', metric: 'mfNoncurrentRatio', over: 'yoy', threshold: 0.01, label: 'x' },
    { id: 'never', type: 'above', metric: 'creNoncurrentRatio', threshold: 0.5, label: 'x' },
  ];
  const sig = detectSignals(s, rules);
  assert.deepEqual(sig.map((x) => x.type), ['rise2', 'first', 'high', 'jump']);
  const r = sig.find((x) => x.type === 'rise2');
  assert.equal(r.id, 'fdic:42:rise2:20260630');
  assert.equal(r.period, '20260630');
  assert.deepEqual(r.evidence, ['fdic:42:20251231', 'fdic:42:20260331', 'fdic:42:20260630']);
  assert.equal(sig.find((x) => x.type === 'first').evidence.length, 8);
  assert.deepEqual(sig.find((x) => x.type === 'jump').evidence, ['fdic:42:20250630', 'fdic:42:20260630']);
  close(sig.find((x) => x.type === 'high').value, (5000 + 7 * 1500) / 300000, 'signal value');
});

test('signals do not fire on flat data, or on history they cannot see', () => {
  const flat = computeMetrics(file('9', eight(() => ({}))));
  assert.deepEqual(detectSignals(flat, [{ id: 'r', type: 'rising', metric: 'creNoncurrentRatio', quarters: 1, label: 'x' }]), []);
  const short = computeMetrics(file('9', { '20260331': { NTREMULQ: 0 }, '20260630': { NTREMULQ: 300 } }));
  assert.deepEqual(detectSignals(short, [{ id: 'f', type: 'firstPositive', metric: 'creNetChargeOffs', lookback: 8, label: 'x' }]), [], 'cannot claim "first in 8 quarters" from 2 quarters');
  assert.throws(() => detectSignals(flat, [{ id: 'bad', type: 'rising', metric: 'nope', label: 'x' }]), /unknown metric/);
  assert.throws(() => detectSignals(flat, [{ id: 'bad', type: 'sideways', metric: 'creOreo', label: 'x' }]), /unknown type/);
});

test('every metric and category reads only fields listed in PRD Appendix A', () => {
  const appendixA = new Set(['ASSET', 'CB', 'LNLSNET', 'NCLNLS', 'NALNLS', 'P3ASSET', 'P9ASSET', 'LNRECONS', 'LNRENRES', 'LNRENROW', 'LNRENROT', 'LNREMULT', 'NCRECONS', 'NCRENRES', 'NCRENROW', 'NCRENROT', 'NCREMULT', 'NARECONS', 'NARENRES', 'NAREMULT', 'P3RENRES', 'P3REMULT', 'P9RENRES', 'P9REMULT', 'ORE', 'ORECONS', 'ORENRES', 'OREMULT', 'NTLNLSQ', 'NTRECONQ', 'NTRENRSQ', 'NTREMULQ']);
  for (const f of METRIC_FIELDS) assert.ok(appendixA.has(f), `${f} is not in Appendix A`);
  for (const c of CATEGORIES) for (const f of [c.balance, ...Object.values(c.stages).filter(Boolean), ...(c.split ?? []).flatMap((s) => [s.balance, s.noncurrent])]) assert.ok(appendixA.has(f), `${c.id}: ${f} is not in Appendix A`);
  assert.ok(Object.keys(METRICS).includes('mfNoncurrentRatio'), 'multifamily is shown on its own');
});

test('every metric rule signal declares itself a state signal', () => {
  const s = computeMetrics(file('42', eight((i) => ({ NCREMULT: 5000 + i * 1500 }))));
  const sig = detectSignals(s, [{ id: 'rise2', type: 'rising', metric: 'creNoncurrentRatio', quarters: 2, label: 'x' }]);
  assert.equal(sig[0].kind, 'state');
});

// ---- The concentration screen (PRD E3-S7) ---------------------------------------------------------------------------------------
// Invented capital: total risk-based capital 120,000; tier 1 100,000; allowance 10,000. CRE as the guidance counts it =
// LNRECONS + LNREMULT + LNRENROT + LNCOMRE (owner-occupied nonfarm nonresidential, LNRENROW, is left out).
const CAP = (over = {}) => Q({ RBC: 120000, RBCT1J: 100000, LNATRES: 10000, CBLRIND: 0, LNCOMRE: 20000, ...over });
const screenFile = (latest, base = { LNRECONS: 80000, LNREMULT: 200000, LNRENROT: 250000, LNCOMRE: 10000 }, rep = '20260630') => ({
  CERT: '55', quarters: { [rep]: { REPDTE: rep, ...latest } }, growthBase: base ? { [shiftQuarter(rep, -12)]: { REPDTE: shiftQuarter(rep, -12), ...base } } : {},
});
const RULES = [
  { id: 'concentration-construction', kind: 'state', test: 'construction', threshold: 1, label: 'x' },
  { id: 'concentration-cre', kind: 'state', test: 'cre', threshold: 3, growthThreshold: 0.5, label: 'x' },
];

test('the screen\'s ratios match a hand computation, on total risk-based capital, with the guidance\'s CRE', () => {
  const c = computeConcentration(screenFile(CAP()));
  assert.equal(c.repdte, '20260630');
  assert.equal(c.baseRepdte, '20230630', '12 quarters, 36 months, before the latest');
  assert.equal(c.denominator.basis, 'totalRiskBasedCapital');
  assert.equal(c.denominator.label, 'total risk-based capital');
  assert.equal(c.denominator.value, 120000);
  close(c.construction.value, 100000 / 120000, 'construction');
  close(c.cre.value, (100000 + 300000 + 400000 + 20000) / 120000, 'CRE');            // 820,000: LNRENROT, not LNRENRES
  assert.equal(c.cre.balance, 820000);
  close(c.growth.value, (820000 - 540000) / 540000, 'growth');                        // base 80,000 + 200,000 + 250,000 + 10,000
  assert.deepEqual(c.cre.inputs.map((x) => x.field), ['LNRECONS', 'LNREMULT', 'LNRENROT', 'LNCOMRE']);
  for (const r of [c.construction, c.cre]) assert.equal(r.denominator, 'totalRiskBasedCapital', 'every ratio names its denominator');
  assert.deepEqual(CONCENTRATION.cre, ['LNRECONS', 'LNREMULT', 'LNRENROT', 'LNCOMRE']);
  assert.ok(!CONCENTRATION.cre.includes('LNRENROW') && !CONCENTRATION.cre.includes('LNRENRES'));
});

test('a CBLR bank reports no total risk-based capital (FDIC sends 0): it is divided by tier 1 plus the allowance, and says so', () => {
  const c = computeConcentration(screenFile(CAP({ CBLRIND: 1, RBC: 0 })));
  assert.equal(c.denominator.basis, 'tier1PlusAllowance');
  assert.equal(c.denominator.value, 110000);
  assert.match(c.denominator.label, /^tier 1 capital plus the allowance for credit losses \(the bank uses the community bank leverage ratio/);
  assert.deepEqual(c.denominator.inputs.map((x) => [x.field, x.value]), [['CBLRIND', 1], ['RBCT1J', 100000], ['LNATRES', 10000]]);
  close(c.construction.value, 100000 / 110000, 'construction');
  assert.equal(c.construction.denominator, 'tier1PlusAllowance');
  assert.deepEqual(DENOMINATORS.tier1PlusAllowance.fields, ['RBCT1J', 'LNATRES']);
});

test('no denominator is guessed: RBC of 0 on a non-CBLR bank, a missing flag or a missing field give null with a reason', () => {
  const zero = computeConcentration(screenFile(CAP({ RBC: 0 })));
  assert.equal(zero.denominator.value, null);
  assert.match(zero.denominator.reason, /RBC \(total risk-based capital\) is 0, though CBLRIND says the bank is not a CBLR bank/);
  assert.equal(zero.construction.value, null);
  assert.match(zero.construction.reason, /^no denominator: /);
  assert.match(concentrationDenominator(CAP({ CBLRIND: null }), '20260630').reason, /missing CBLRIND/);
  assert.match(concentrationDenominator(CAP({ CBLRIND: 1, LNATRES: null }), '20260630').reason, /missing LNATRES/);
  assert.match(computeConcentration(screenFile(CAP({ LNCOMRE: null }))).cre.reason, /missing LNCOMRE/);
  const noBase = computeConcentration(screenFile(CAP(), null));
  assert.equal(noBase.growth.value, null);
  assert.match(noBase.growth.reason, /no report for 20230630 on file/);
  assert.match(computeConcentration(screenFile(CAP(), { LNRECONS: 0, LNREMULT: 0, LNRENROT: 0, LNCOMRE: 0 })).growth.reason, /zero base/);
});

test('STATE signals: the screen fires while the condition holds and is gone once a new quarter is below it', () => {
  const hot = CAP({ LNRECONS: 150000, LNREMULT: 300000, LNRENROT: 400000, LNCOMRE: 20000 });   // construction 125%; CRE 725%, up 61%
  const s = detectConcentrationSignals(computeConcentration(screenFile(hot)), RULES, '55');
  assert.deepEqual(s.map((x) => [x.type, x.kind]), [['concentration-construction', 'state'], ['concentration-cre', 'state']]);
  assert.equal(s[0].id, 'fdic:55:concentration-construction:20260630');
  assert.deepEqual(s[0].denominator, { basis: 'totalRiskBasedCapital', label: 'total risk-based capital' });
  assert.deepEqual(s[1].evidence, ['fdic:55:20230630', 'fdic:55:20260630']);
  close(s[1].growth, (870000 - 540000) / 540000, 'growth on the signal');
  // The next quarter: construction falls below 100% of capital, and CRE grew less than 50% over 36 months. Recomputed: both are gone.
  const next = { ...screenFile(hot), quarters: { ...screenFile(hot).quarters, 20260930: { REPDTE: '20260930', ...CAP({ LNRECONS: 90000, LNREMULT: 300000, LNRENROT: 300000 }) } }, growthBase: { 20230930: { REPDTE: '20230930', LNRECONS: 80000, LNREMULT: 300000, LNRENROT: 300000, LNCOMRE: 20000 } } };
  assert.deepEqual(detectConcentrationSignals(computeConcentration(next), RULES, '55'), []);
  // Test (b) needs both parts: CRE far above 300% but grown under 50% does not fire.
  const slow = screenFile(hot, { LNRECONS: 150000, LNREMULT: 300000, LNRENROT: 300000, LNCOMRE: 20000 });
  assert.deepEqual(detectConcentrationSignals(computeConcentration(slow), RULES, '55').map((x) => x.type), ['concentration-construction']);
  assert.throws(() => detectConcentrationSignals(computeConcentration(screenFile(hot)), [{ id: 'x', test: 'vibes' }], '55'), /unknown test/);
});

const EVENT_RULE = { id: 'acquired-metro-bank', kind: 'event', type: 'acquisition', kinds: ['merger', 'assisted-merger', 'failure'], windowQuarters: 4, label: 'x' };
const ev = (over = {}) => ({ transnum: '2026000777', code: 223, kind: 'merger', effective: '2026-06-01', acquirerCert: '55', targetCert: '777', targetInMetros: true, targetMetros: [{ cbsa: '38060', branches: 4, basis: ['main office'] }], targetLastCre: { repdte: '20260331', value: 5000 }, ...over });

test('EVENT signals: an acquisition stays visible for its window with the same id, whatever later data says, then drops away', () => {
  const at = (asOf, events = [ev()]) => detectStructureSignals({ cert: '55', events, rules: [EVENT_RULE], asOf });
  const first = at('2026-11-13');
  assert.equal(first.length, 1);
  assert.deepEqual([first[0].kind, first[0].type, first[0].period, first[0].targetCert, first[0].visibleUntil], ['event', 'acquired-metro-bank', '2026-06-01', '777', '2027-06-01']);
  assert.equal(first[0].id, 'fdic:55:acquired-metro-bank:2026000777');
  assert.deepEqual(first[0].evidence, ['fdic-history:2026000777', 'fdic:777']);
  assert.deepEqual(at('2027-05-31'), first, 'later, the same signal: it is a dated change, not recomputed from the numbers');
  assert.deepEqual(at('2027-06-01'), [], 'after 4 quarters it is no longer shown (the event itself stays stored)');
  assert.deepEqual(at('2026-05-31'), [], 'not before it took effect');
  assert.deepEqual(at('2026-11-13', [ev({ kind: 'affiliate-reorganization', code: 224 })]), [], 'a merger inside one holding company is not counted by default');
  assert.deepEqual(at('2026-11-13', [ev({ targetInMetros: false, targetMetros: [] })]), [], 'only a target with a presence in the metros counts');
  assert.deepEqual(at('2026-11-13', [ev({ acquirerCert: '56' })]), [], 'it attaches to the acquirer only');
  assert.deepEqual(detectStructureSignals({ cert: '55', events: [ev()], rules: [EVENT_RULE] }), [], 'no scoring date, no event signals: the clock is never read');
  assert.equal(addMonths('2026-11-30', 3), '2027-02-28');
});

test('every concentration field is one the FDIC adapter requests', () => {
  for (const f of CONCENTRATION_FIELDS) assert.ok(FDIC_FIELDS.financials.includes(f), `${f} is not in the 8-quarter pull`);
  for (const f of CONCENTRATION.cre) assert.ok(FDIC_FIELDS.growthBase.includes(f), `${f} is not in the growth-base pull`);
});
