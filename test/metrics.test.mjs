// Metric formulas and signals (PRD E3-S3, E3-S4, Appendix A), against hand-computed values. Invented numbers only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeQuarterMetrics, computeMetrics, detectSignals, shiftQuarter, periodLabel, quarterIndex, METRICS, METRIC_FIELDS, CATEGORIES } from '../src/metrics.mjs';

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
