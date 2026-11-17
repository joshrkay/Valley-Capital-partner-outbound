// The paper estimate, reported layer (docs/paper-estimate.md, PRD E14-S1). Invented banks and numbers only; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { statSync } from 'node:fs';
import { makeDir, put, loadJson, placeholderBuybox } from './kit.mjs';
import { buildPaper, frechetBounds, sizeShareInterval, paperValues, paperAt, paperFileId, paperPath, readPaper, renderPaper, formatValue, paperForBriefer,
  TIERS, STATUS, SERIES_BREAK_2023, TAPE_REQUEST, BOUNDS_METHOD } from '../src/paper.mjs';
import { runScoring } from '../src/score.mjs';
import { SEMIANNUAL_FIELDS, FDIC_FIELDS } from '../src/sources/fdic.mjs';
import { confirmFiler } from '../src/sources/filers.mjs';
import { readJsonl } from '../src/store.mjs';

const metros = loadJson('metros.json');
const scoring = () => structuredClone(loadJson('scoring.json'));
const shippedBuybox = () => structuredClone(loadJson('buybox.json'));
const filledBuybox = (over = {}) => ({ ...shippedBuybox(), sectors: { include: ['hospitality', 'multifamily', 'retail'], shortTermRentalPortfolios: 'out' }, loanSize: { minUsd: 1000000, maxUsd: 25000000 }, statuses: ['non-performing'], lien: 'first', exclusions: ['ground-up construction'], ...over });
const NOW = new Date('2026-11-13T12:00:00Z');
const FLOW_FIELDS = new Set(['NTRECONQ', 'NTREMULQ', 'NTRENRSQ', 'NTGLLNQ', 'NETGNSLN']);

// One invented quarter, in thousands of dollars as FDIC reports them. Every field the paper reads, with distinct values.
const Q = (over = {}) => ({
  ASSET: 3000000, LNLSNET: 2000000,
  LNRECONS: 100000, LNRECNOT: 70000, LNRECNFM: 30000, LNREMULT: 300000, LNRENRES: 600000, LNRENROW: 200000, LNRENROT: 400000, LNCOMRE: 20000,
  P3RECONS: 1500, P9RECONS: 300, NARECONS: 1000, P3REMULT: 4000, P9REMULT: 1000, NAREMULT: 10000,
  P3RENROT: 4000, P9RENROT: 1500, NARENROT: 6000, P3RENROW: 2000, P9RENROW: 500, NARENROW: 2000, P3COMRE: 0,
  P3RENRES: 6000, P9RENRES: 2000, NARENRES: 8000, NCRECONS: 1300, NCREMULT: 11000, NCRENRES: 10000, NCRENROW: 2500, NCRENROT: 7500,
  ORECONS: 500, OREMULT: 1000, ORENRES: 1500, NTRECONQ: 10, NTREMULQ: 300, NTRENRSQ: 200,
  LNRENR1: 5000, LNRENR2: 15000, LNRENR3: 80000, LNRENR4: 100000, LNRENR1N: 90, LNRENR2N: 100, LNRENR3N: 150, LNRENR4N: 340,
  UCCOMRES: 45000, UCCOMREU: 500, RSCONS: 700, RSMULT: 900, RSNRES: 1100, RSOTHER: 300, NARSNRES: 400, RSLNLTOT: 3500,
  LNLSSALE: 2500, NALNSALE: 0, P9LNSALE: 0, P3LNSALE: 0, NETGNSLN: 75, NTGLLNQ: 40,
  LNOT3LES: 400000, LNOT3T12: 300000, LNOT1T3: 500000, LNOT3T5: 350000, LNOT5T15: 250000, LNOTOV15: 50000,
  ...over,
});
const REPS = ['20240930', '20241231', '20250331', '20250630', '20250930', '20251231', '20260331', '20260630'];
const quarters = (reps = REPS, fn = () => ({})) => Object.fromEntries(reps.map((r, i) => [r, { REPDTE: r, ...Q(fn(r, i)) }]));
const FP = { branchesByMetro: { 38060: 4 }, sod: { year: 2026, depositsByMetro: { 38060: 600000 }, totalDeposits: 1000000 }, _source: { fetchedAt: '2026-11-13T12:00:00Z' } };
const paper = (over = {}) => buildPaper({ cert: '1', name: 'Alpha Example Bank', financials: { CERT: '1', quarters: quarters() }, footprint: FP, buybox: filledBuybox(), placeholders: [], metros, runId: 'score-test', ...over });

// ---- Units, dates, tiers and sources ------------------------------------------------------------------------------------------------
test('every number has a tier and sources; every gap says why; nothing is a bare zero for a missing value', () => {
  for (const r of [paper(), paper({ footprint: {} }), paper({ financials: null })]) everyValue(r);
});
function everyValue(r) {
  const vals = paperValues(r);
  assert.ok(vals.length > 40, `only ${vals.length} values`);
  for (const { path, v } of vals) {
    // A value without a status is a number, with its tier and sources. One with a status is a gap, or an unknown share (0 to all).
    if (!('status' in v)) {
      assert.ok(v.value !== null && v.value !== undefined || ('low' in v && v.low !== null), `${path}: a number`);
      assert.ok(TIERS.includes(v.tier), `${path}: tier ${v.tier}`);
      assert.ok(['usd', 'count', 'pct'].includes(v.unit), `${path}: unit ${v.unit}`);
      assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(String(v.asOf)), `${path}: asOf ${v.asOf}`);
      assert.ok(typeof v.method === 'string' && v.method !== 'none', `${path}: method`);
      assert.ok(Array.isArray(v.sources) && v.sources.length, `${path}: no sources`);
      for (const s of v.sources) assert.ok(s.field && s.file && /^\d{8}$/.test(String(s.repdte)), `${path}: source ${JSON.stringify(s)}`);
    } else {
      assert.ok(STATUS[v.status], `${path}: a null value needs a status (got ${v.status})`);
      assert.ok(v.reason, `${path}: a gap needs a reason`);
      assert.equal(v.tier, null, `${path}: a gap has no tier`);
      if ('low' in v) assert.deepEqual([v.low, v.high], [0, 1], `${path}: an unknown share is 0 to all`); else assert.equal(v.value, null, path);
    }
  }
  // Series name their tier, fields and file once; each point carries its report date.
  for (const s of [...r.q1.trend.series, ...r.q1.restructured.series]) {
    assert.ok(TIERS.includes(s.tier) && s.fields.length && s.file, s.id);
    for (const p of s.points) assert.ok(/^\d{8}$/.test(p.repdte) && p.asOf === `${p.repdte.slice(0, 4)}-${p.repdte.slice(4, 6)}-${p.repdte.slice(6)}`, `${s.id} point`);
  }
}

test('units: FDIC thousands become dollars, once; counts stay counts; shares are fractions', () => {
  const r = paper();
  const q = quarters()['20260630'];
  for (const { path, v } of paperValues(r)) {
    if (v.value === null || v.value === undefined || !['fdic-field', 'sum-of-fields'].includes(v.method.split(':')[0]) || !v.sources.every((x) => x.file === 'sources/fdic/financials/1.json')) continue;
    const raw = v.sources.reduce((s, x) => s + quarters()[x.repdte][x.field], 0);
    assert.equal(v.value, v.unit === 'usd' ? raw * 1000 : raw, `${path}`);
  }
  assert.equal(r.q1.categories.find((c) => c.id === 'multifamily').balance.value, 300000000);
  assert.equal(r.q1.investorCre.value, (100000 + 300000 + 400000 + 20000) * 1000);
  assert.equal(r.q4.under1m.count.value, 340); assert.equal(r.q4.under1m.count.unit, 'count');
  assert.equal(r.q4.averageSmallLoan.value, (100000 * 1000) / 340);
  assert.equal(r.q3.metros.find((m) => m.cbsa === '38060').deposits.value, 600000 * 1000);
  assert.equal(r.q3.buyboxShare.value, 0.6); assert.equal(r.q3.buyboxShare.unit, 'pct');
  assert.equal(r.q1.categories.find((c) => c.id === 'multifamily').stages.nonaccrual.shareOfBalance.value, q.NAREMULT / q.LNREMULT);
  assert.match(formatValue(r.q1.investorCre), /^\$820\.0 million {2}\[reported, June 30, 2026\]$/);
});

test('as-of dates: every FDIC value is dated by its own report, and each source has its own date', () => {
  const r = paper({ financials: { CERT: '1', quarters: quarters([...REPS.slice(1), '20260930']) } });   // latest is September
  assert.equal(r.asOf, '2026-09-30');
  assert.equal(r.q1.investorCre.asOf, '2026-09-30');
  assert.equal(r.q4.asOf, '2026-06-30', 'sizes come from the June report');
  assert.equal(r.q4.under1m.count.asOf, '2026-06-30');
  assert.equal(r.q1.restructured.asOfByType, '2026-06-30');
  assert.equal(r.q1.restructured.total.asOf, '2026-09-30', 'the restructured total is quarterly');
  assert.equal(r.q3.asOf, '2026-06-30', 'the Summary of Deposits is as of June 30');
  for (const { path, v } of paperValues(r)) {
    if (v.value === null || v.value === undefined || v.method === BOUNDS_METHOD) continue;
    const fdicSources = v.sources.filter((s) => s.file.startsWith('sources/fdic/financials/'));
    if (fdicSources.length && !v.period) assert.equal(v.asOf.replace(/-/g, ''), fdicSources[0].repdte, path);
  }
  const ytd = r.q1.categories[0].chargeOffs.yearToDate;
  assert.deepEqual(ytd.period, { from: '2026-01-01', to: '2026-09-30', basis: 'year-to-date' });
});

// ---- The semiannual trap ----------------------------------------------------------------------------------------------------------
test('THE SEMIANNUAL TRAP: a March zero in the loan-size fields is never shown as "no small loans"', () => {
  // As FDIC really sends it for most banks: the loan-size fields are 0 in March, and filled in December.
  const marchZeros = Object.fromEntries(SEMIANNUAL_FIELDS.loanSizes.map((f) => [f, 0]));
  const qs = quarters(REPS.slice(0, 7), (rep) => (rep.endsWith('0331') || rep.endsWith('0930') ? { ...marchZeros, RSNRES: 0, RSCONS: 0, RSMULT: 0, RSOTHER: 0, NARSNRES: 0 } : {}));
  const r = paper({ financials: { CERT: '1', quarters: qs } });
  assert.equal(r.latestRepdte, '20260331');
  assert.equal(r.q4.asOf, '2025-12-31', 'the latest June or December report, with its date');
  assert.equal(r.q4.under1m.count.value, 340, 'the December count, not the March zero');
  assert.equal(r.q4.under1m.dollars.value, 100000 * 1000);
  assert.match(r.q4.note, /December 31, 2025 report/);
  assert.match(r.q4.note, /March 31, 2026 values are not used/);
  // No value anywhere in the record reads a semiannual field from a March or September report.
  const semi = new Set([...SEMIANNUAL_FIELDS.loanSizes, ...SEMIANNUAL_FIELDS.restructuredByType]);
  for (const { path, v } of paperValues(r)) for (const s of v.sources ?? []) if (semi.has(s.field)) assert.ok(/(0630|1231)$/.test(s.repdte), `${path} reads ${s.field} from ${s.repdte}`);
  assert.equal(r.q1.restructured.byType.find((t) => t.id === 'nonfarmNonresidential').value.value, 1100 * 1000, 'the restructured split also comes from December');
  assert.equal(r.q1.restructured.asOfByType, '2025-12-31');
  assert.doesNotMatch(renderPaper(r), /Under \$1 million, number of loans: 0 /);

  // With no June or December report on file at all, sizes are "not reported this quarter (semiannual)", never 0.
  const onlyMarch = paper({ financials: { CERT: '1', quarters: { 20260331: { REPDTE: '20260331', ...Q(marchZeros) } } } });
  for (const v of [onlyMarch.q4.under1m.count, onlyMarch.q4.under1m.dollars, onlyMarch.q4.averageSmallLoan, onlyMarch.q4.over1m.dollars]) {
    assert.equal(v.value, null); assert.equal(v.status, 'semiannual');
  }
  assert.ok(onlyMarch.q8.unknowns.some((u) => u.id === 'semiannual'));
  assert.match(onlyMarch.q7.sectors.find((s) => s.sector === 'hospitality').unknownConditions.find((u) => u.id === 'size').reason, /June or December/, 'the size range still restricts, so its share is unknown');
});

test('a June report with every size bucket at 0 while the bank holds nonfarm nonresidential loans is "unclear", not zero', () => {
  const zeros = Object.fromEntries(SEMIANNUAL_FIELDS.loanSizes.map((f) => [f, 0]));
  const r = paper({ financials: { CERT: '1', quarters: quarters(REPS, (rep) => (rep === '20260630' ? zeros : {})) } });
  assert.equal(r.q4.under1m.count.value, null); assert.equal(r.q4.under1m.count.status, 'unclear');
  assert.equal(r.q4.over1m.dollars.status, 'unclear', 'nor is all of nonfarm nonresidential shown as loans over $1 million');
});

// ---- Not reported versus zero, stocks versus flows ------------------------------------------------------------------------------------
test('"not reported" is never zero, and a reported zero is a zero', () => {
  const r = paper();
  const ns = r.q1.categories.find((c) => c.id === 'notSecuredByRealEstate');
  for (const k of ['pastDue90', 'nonaccrual']) {
    assert.equal(ns.stages[k].amount.value, null); assert.equal(ns.stages[k].amount.status, 'not-reported'); assert.match(ns.stages[k].amount.reason, /FDIC reports no/);
  }
  assert.deepEqual([ns.stages.pastDue30to89.amount.value, ns.stages.pastDue30to89.amount.tier, ns.stages.pastDue30to89.amount.sources[0].field], [0, 'reported', 'P3COMRE'], 'P3COMRE is the 30-89 stage, and its 0 is reported');
  const cons = r.q1.categories.find((c) => c.id === 'construction');
  assert.equal(cons.stages.pastDue30to89.amount.value, 1500 * 1000); assert.equal(cons.stages.pastDue90.amount.sources[0].field, 'P9RECONS');
  assert.match(renderPaper(r), /90 days or more past due: not reported: FDIC reports no 90\+ days past due field for CRE loans not secured by real estate\./);
  assert.ok(r.q8.unknowns.some((u) => u.id === 'stages-not-reported'));
  // A field FDIC sent as null is "no value from FDIC", not 0.
  const nul = paper({ financials: { CERT: '1', quarters: quarters(REPS, (rep) => (rep === '20260630' ? { P3REMULT: null } : {})) } });
  const mf = nul.q1.categories.find((c) => c.id === 'multifamily').stages.pastDue30to89.amount;
  assert.deepEqual([mf.value, mf.status], [null, 'null']);
  // Data pulled before E14-S1 lacks the new fields: "not on file", and the unknowns say to pull again.
  const oldQs = quarters(); for (const q of Object.values(oldQs)) delete q.UCCOMRES;
  const stale = paper({ financials: { CERT: '1', quarters: oldQs } });
  assert.equal(stale.q1.commitments.secured.status, 'not-on-file');
  assert.ok(stale.q8.unknowns.some((u) => u.id === 'refresh'));
});

test('flows are kept apart from stocks: charge-offs and loan-sale gains are flows over a period, never part of a balance', () => {
  const r = paper();
  for (const { path, v } of paperValues(r)) {
    if (v.value === null || v.value === undefined || !v.sources) continue;
    const flowSrc = v.sources.some((s) => FLOW_FIELDS.has(s.field));
    if (flowSrc) { assert.equal(v.kind, 'flow', `${path} reads a flow field but is a ${v.kind}`); assert.ok(v.period?.from && v.period?.to, `${path}: a flow needs its period`); }
    if (v.kind === 'stock') assert.ok(!flowSrc, `${path}: a stock mixes in a flow`);
  }
  const mf = r.q1.categories.find((c) => c.id === 'multifamily');
  assert.equal(mf.balance.kind, 'stock');
  assert.deepEqual([mf.chargeOffs.quarter.value, mf.chargeOffs.quarter.period.basis], [300 * 1000, 'quarter']);
  assert.equal(mf.chargeOffs.yearToDate.value, (300 + 300) * 1000, 'the year to date is the sum of 2026\'s quarterly fields');
  assert.equal(mf.chargeOffs.yearToDate.method, 'sum-of-quarterly-fields');
  assert.ok(!FDIC_FIELDS.financials.includes('NTREMULT'), 'FDIC\'s own year-to-date charge-off field is never requested');
  const gl = r.q6.items.find((i) => i.type === 'loan-sale-gains');
  assert.equal(gl.notCreSpecific, true); assert.match(gl.label, /not CRE-specific/);
  assert.deepEqual([gl.values.quarter.kind, gl.values.yearToDate.kind, gl.values.yearToDate.period.basis], ['flow', 'flow', 'year-to-date']);
  // The investor and owner-occupied split of nonfarm nonresidential charge-offs is not pulled (FDIC has it only year to date).
  assert.equal(r.q1.categories.find((c) => c.id === 'nonfarmNonresidentialOther').chargeOffs.quarter.status, 'not-pulled');
  assert.equal(r.q1.nonfarmTotal.chargeOffs.quarter.value, 200 * 1000);
});

test('unused commitments are shown once, for the whole CRE book, never per category', () => {
  const r = paper();
  assert.equal(r.q1.commitments.level, 'portfolio');
  assert.equal(r.q1.commitments.total.value, (45000 + 500) * 1000);
  for (const c of r.q1.categories) {
    assert.ok(!JSON.stringify(c).includes('UCCOMRE'), `${c.id} carries a commitment`);
    assert.ok(!Object.keys(c).some((k) => /commit/i.test(k)), c.id);
  }
  const uses = paperValues(r).filter(({ v }) => (v.sources ?? []).some((s) => /^UCCOMRE/.test(s.field))).map(({ path }) => path);
  assert.ok(uses.every((p) => p.startsWith('q1.commitments.')), uses.join(', '));
});

// ---- The 2023 series break ----------------------------------------------------------------------------------------------------------
test('the 2023 series break (ASU 2022-02) is marked on any restructured series that spans it', () => {
  const spanning = paper({ financials: { CERT: '1', quarters: quarters(['20220930', '20221231', '20230331', '20230630', '20230930', '20231231', '20240331', '20240630']) } });
  const b = spanning.q1.restructured.seriesBreak;
  assert.equal(b.asOf, '2023-03-31'); assert.equal(b.standard, 'ASU 2022-02');
  assert.equal(b.spansTotal, true); assert.equal(b.spansByType, true);
  const total = spanning.q1.restructured.series.find((s) => s.id === 'total');
  assert.equal(total.spansBreak, true); assert.equal(total.breakAt, '2023-03-31');
  assert.deepEqual(total.points.map((p) => p.basis), [SERIES_BREAK_2023.before, SERIES_BREAK_2023.before, ...Array(6).fill(SERIES_BREAK_2023.after)]);
  assert.ok(spanning.q8.unknowns.some((u) => u.id === 'series-break'));
  assert.match(renderPaper(spanning), /THE SERIES ON FILE SPANS THIS BREAK/);
  // A window entirely after the change: no break in the series, and every value names the new basis.
  const after = paper();
  assert.equal(after.q1.restructured.seriesBreak.spansTotal, false);
  assert.ok(after.q1.restructured.series.every((s) => !s.spansBreak));
  assert.equal(after.q1.restructured.total.basis, SERIES_BREAK_2023.after);
  assert.ok(!after.q8.unknowns.some((u) => u.id === 'series-break'));
});

// ---- Net change ----------------------------------------------------------------------------------------------------------------------
test('the eight-quarter trend is net change, never new lending, and is withheld across a quarter with an acquisition', () => {
  const qs = quarters(REPS, (rep, i) => ({ LNREMULT: 300000 + i * 10000 }));
  const events = [{ transnum: '2026000777', kind: 'merger', acquirerCert: '1', targetCert: '777', effective: '2026-02-15', targetInMetros: true, targetLastCre: { repdte: '20251231', value: 55000 } }];
  const r = paper({ financials: { CERT: '1', quarters: qs }, events });
  assert.equal(r.q1.trend.method, 'net-change'); assert.match(r.q1.trend.note, /not new lending/);
  const mf = r.q1.trend.series.find((s) => s.id === 'multifamily');
  assert.equal(mf.points.length, 8);
  assert.equal(mf.points[0].netChange, null); assert.equal(mf.points[0].netChangeStatus, 'not-on-file');
  assert.equal(mf.points[1].netChange, 10000 * 1000);
  const march = mf.points.find((p) => p.repdte === '20260331');
  assert.deepEqual([march.netChange, march.netChangeStatus], [null, 'structure-event']);
  assert.match(march.netChangeReason, /acquired another bank \(FDIC cert 777/);
  assert.equal(mf.points.find((p) => p.repdte === '20260630').netChange, 10000 * 1000, 'the next quarter is shown again');
  assert.ok(!/new lending/.test(JSON.stringify(r.summary)), 'no summary line claims new lending');
  const acq = r.q6.items.find((i) => i.type === 'acquisition');
  assert.deepEqual([acq.date, acq.targetCert, acq.targetCre.value], ['2026-02-15', '777', 55000 * 1000]);
  // Another bank's deal is not this bank's.
  assert.ok(!paper({ events: [{ ...events[0], acquirerCert: '2' }] }).q6.items.some((i) => i.type === 'acquisition'));
});

test('the sections cover the latest eight quarters, however many quarters the financials file has kept', () => {
  // The FDIC adapter adds each new quarter to the file and never drops one, so a year on it holds twelve.
  const twelve = ['20230930', '20231231', '20240331', '20240630', ...REPS];
  const qs = quarters(twelve, (rep, i) => ({ LNREMULT: 300000 + i * 10000, ...(rep === '20231231' ? { NALNSALE: 900 } : {}) }));
  const r = paper({ financials: { CERT: '1', quarters: qs } });
  for (const s of r.q1.trend.series) assert.deepEqual(s.points.map((p) => p.repdte), REPS, s.id);
  assert.deepEqual(r.q1.restructured.series.find((s) => s.id === 'total').points.map((p) => p.repdte), REPS);
  for (const s of r.q1.restructured.series.filter((x) => x.id !== 'total')) assert.deepEqual(s.points.map((p) => p.repdte), ['20241231', '20250630', '20251231', '20260630'], s.id);
  assert.ok(!r.q6.items.some((i) => i.date < '2024-09-30'), 'no seller evidence from before the window');
  // The quarter before the window is read on its own, for the first point's net change, as the growth base would be.
  assert.equal(r.q1.trend.series.find((s) => s.id === 'multifamily').points[0].netChange, 10000 * 1000);
  assert.deepEqual(r, paper({ financials: { CERT: '1', quarters: Object.fromEntries(Object.entries(qs).filter(([k]) => k >= '20240630')) } }), 'older quarters change nothing');
});

// ---- Q7: bounds only ------------------------------------------------------------------------------------------------------------------
test('bounds math: k=1, k=3, a lower bound that hits zero, and intervals', () => {
  assert.deepEqual(frechetBounds([{ low: 0.4, high: 0.4 }]), { k: 1, low: 0.4, high: 0.4 }, 'one condition: both bounds are its share');
  const k3 = frechetBounds([{ low: 0.7, high: 0.7 }, { low: 0.8, high: 0.8 }, { low: 0.9, high: 0.9 }]);
  assert.equal(k3.k, 3); assert.equal(k3.high, 0.7); assert.ok(Math.abs(k3.low - 0.4) < 1e-12, `${k3.low}`);   // 0.7 + 0.8 + 0.9 - 2
  assert.deepEqual(frechetBounds([{ low: 0.3, high: 0.3 }, { low: 0.4, high: 0.4 }]), { k: 2, low: 0, high: 0.3 }, '0.3 + 0.4 - 1 < 0: the lower bound is 0');
  assert.deepEqual(frechetBounds([{ low: 0, high: 0.6 }, { low: 0.9, high: 0.9 }]), { k: 2, low: 0, high: 0.6 }, 'an unknown share enters at 0 for the lower bound and at its top for the upper');
  assert.equal(frechetBounds([]), null);
  assert.throws(() => frechetBounds([{ low: 0.5, high: 1.2 }]), /within \[0, 1\]/);
  // Size buckets by original amount: a current balance is at most its original amount.
  const b = [{ id: 'under100k', hi: 100000, dollars: 5 }, { id: 'from100kTo250k', hi: 250000, dollars: 15 }, { id: 'from250kTo1m', hi: 1000000, dollars: 80 }, { id: 'over1m', hi: Infinity, dollars: 500 }];
  assert.deepEqual(sizeShareInterval({ minUsd: 1000000, maxUsd: 25000000 }, b), { lowDollars: 0, highDollars: 500, may: ['over1m'], surely: [] });
  assert.deepEqual(sizeShareInterval({ minUsd: 0, maxUsd: 1000000 }, b), { lowDollars: 100, highDollars: 600, may: ['under100k', 'from100kTo250k', 'from250kTo1m', 'over1m'], surely: ['under100k', 'from100kTo250k', 'from250kTo1m'] });
  assert.deepEqual(sizeShareInterval({ minUsd: 250000, maxUsd: 5000000 }, b).may, ['from250kTo1m', 'over1m']);
});

test('Q7 in the record: multifamily from its own line and the metro proxy; hotel and retail unknown inside nonfarm nonresidential; no base figure', () => {
  const r = paper();
  const book = (100000 + 300000 + 600000) * 1000;
  assert.equal(r.q1.creBook.value, book);
  const mf = r.q7.sectors.find((s) => s.sector === 'multifamily');
  assert.deepEqual(mf.conditions.map((c) => [c.id, c.share.low, c.share.high]), [['category', 0.3, 0.3], ['metro', 0.6, 0.6], ['size', 0, 1], ['status', 0, 1], ['lien', 0, 1], ['exclusions', 0, 1]]);
  assert.deepEqual([mf.bounds.low, mf.bounds.high, mf.bounds.k, mf.bounds.tier, mf.bounds.method], [0, 0.3 * book, 6, 'inferred', BOUNDS_METHOD], '0.3 + 0.6 - 1 < 0, and four conditions are unknown');
  assert.match(mf.bounds.lowNote, /lower bound is 0/);
  assert.match(mf.unknownConditions.find((u) => u.id === 'size').reason, /no loan-size data for multifamily/);
  // Hotel: the category's share is unknown, so it enters as [0, nonfarm nonresidential share]: the lower bound is 0.
  const h = r.q7.sectors.find((s) => s.sector === 'hospitality');
  assert.deepEqual(h.conditions.map((c) => c.id), ['category', 'metro', 'size', 'status', 'lien', 'exclusions']);
  assert.deepEqual([h.conditions[0].share.low, h.conditions[0].share.high], [0, 0.6]);
  assert.equal(h.bounds.low, 0);
  // Size: over $1 million by original amount = LNRENRES - LNRENR4 = 500,000 of 600,000 nonfarm nonresidential: 0.5 of the book at most.
  assert.deepEqual([h.conditions[2].share.low, h.conditions[2].share.high], [0, 0.5]);
  assert.equal(h.bounds.high, Math.round(0.5 * book), 'upper = min(0.6, 0.6, 0.5) x book');
  assert.match(h.why, /cannot split them/); assert.match(h.why, /lower bound is 0/);
  assert.equal(r.q7.sectors.find((s) => s.sector === 'retail').bounds.high, h.bounds.high);
  // With no deposit data and no usable size, the upper bound for hotel is all of nonfarm nonresidential, and the lower is 0.
  const bare = paper({ footprint: {}, buybox: filledBuybox({ loanSize: { minUsd: '[CONFIRM]', maxUsd: '[CONFIRM]' } }), placeholders: ['loanSize.minUsd', 'loanSize.maxUsd'] });
  const hb = bare.q7.sectors.find((s) => s.sector === 'hospitality');
  assert.deepEqual([hb.bounds.low, hb.bounds.high], [0, 600000 * 1000]);
  assert.match(hb.unknownConditions.find((u) => u.id === 'size').reason, /placeholder/);
  assert.equal(bare.q7.provisional, true); assert.equal(bare.provisional, true);
  // Bounds only: no value, no base, anywhere in Q7.
  for (const s of [...r.q7.sectors, ...bare.q7.sectors]) { assert.ok(!('value' in s.bounds) || s.bounds.value === null); assert.ok(!('base' in s.bounds)); }
  assert.ok(!JSON.stringify(r.q7).includes('"base"'));
  assert.match(r.q7.formula, /min\(s_i\)/); assert.match(r.q7.note, /never multiplied/);
});

// A buy box whose status, lien and exclusions allow everything: those dimensions are then not conditions.
const ANY_STATUS = { statuses: ['performing', 'sub-performing', 'non-performing', 'foreclosed'], lien: 'any', exclusions: [] };
const ALL_IN_BOX = { ...FP, sod: { year: 2026, depositsByMetro: { 38060: 1000000 }, totalDeposits: 1000000 } };

test('k=3 in the record for hotel (its lower bound stays 0), and a lower bound above zero for multifamily when nothing it needs is unmeasured', () => {
  // Deposits all in the buy-box metros (share 1) and every nonfarm nonresidential loan possibly in the size range (min 0): for hotel, a
  // sector inside nonfarm nonresidential, the category's unknown share alone then sets the bounds, [0, NFNR share].
  const r = paper({ footprint: ALL_IN_BOX, buybox: filledBuybox({ loanSize: { minUsd: 0, maxUsd: 100000000 }, ...ANY_STATUS }) });
  const h = r.q7.sectors.find((s) => s.sector === 'hospitality');
  assert.equal(h.bounds.k, 3);
  assert.deepEqual([h.bounds.low, h.bounds.high], [0, 600000 * 1000]);
  const mf = r.q7.sectors.find((s) => s.sector === 'multifamily');
  assert.deepEqual([mf.bounds.low, mf.bounds.high, mf.unknownConditions.map((u) => u.id)], [0, 300000 * 1000, ['size']], 'a size cap restricts, and multifamily has no size data');
  const open = paper({ footprint: ALL_IN_BOX, buybox: filledBuybox({ loanSize: { minUsd: 0, maxUsd: null }, ...ANY_STATUS }) }).q7.sectors.find((s) => s.sector === 'multifamily');
  assert.deepEqual([open.bounds.low, open.bounds.high, open.bounds.k], [300000 * 1000, 300000 * 1000, 2], 'all deposits in the box and nothing unmeasured: multifamily lower = 0.3 + 1 - 1');
  assert.deepEqual(open.unknownConditions, []);
  for (const id of ['size', 'status', 'lien', 'exclusions']) assert.match(open.notUsed.find((n) => n.id === id)?.reason ?? '', /allows every/, id);
});

test('every buy-box condition the data cannot measure enters as 0 to all, so the lower bound is 0, and the record lists them', () => {
  // The review's case: 30% multifamily, 100% of deposits in buy-box metros. The buy box restricts size, status, lien and exclusions, and
  // nothing measures them for multifamily, so the floor is 0, not 30% of the book.
  const r = paper({ footprint: ALL_IN_BOX });
  const mf = r.q7.sectors.find((s) => s.sector === 'multifamily');
  assert.deepEqual(mf.unknownConditions.map((u) => u.id), ['size', 'status', 'lien', 'exclusions']);
  assert.deepEqual([mf.bounds.low, mf.bounds.high, mf.bounds.k], [0, 300000 * 1000, 6]);
  for (const u of mf.unknownConditions) {
    const c = mf.conditions.find((x) => x.id === u.id);
    assert.deepEqual([c.share.low, c.share.high, c.share.status, c.share.tier], [0, 1, 'unknown', null], u.id);
    assert.ok(u.label && u.reason, u.id);
  }
  assert.match(mf.bounds.lowNote, /The lower bound is 0 because these buy-box conditions cannot be measured: loan size, status, lien position, exclusions\./);
  const h = r.q7.sectors.find((s) => s.sector === 'hospitality');
  assert.deepEqual(h.unknownConditions.map((u) => u.id), ['status', 'lien', 'exclusions'], 'hotel\'s size is measured from the size buckets');
  assert.equal(h.bounds.low, 0);
  assert.match(r.q8.unknowns.find((u) => u.id === 'in-box-floor').text, /lien position/);
  assert.match(renderPaper(r), /Unknown condition lien: .*0\.0% to 100\.0%/);
  // A buy box's placeholders may restrict anything, so each counts as an unknown condition until a principal fills it.
  const unfilled = paper({ footprint: ALL_IN_BOX, buybox: placeholderBuybox(), placeholders: ['loanSize.minUsd', 'loanSize.maxUsd', 'statuses', 'lien', 'exclusions[0]'] });
  const sm = unfilled.q7.sectors.find((s) => s.sector === 'multifamily');
  assert.deepEqual(sm.unknownConditions.map((u) => u.id), ['size', 'status', 'lien', 'exclusions']);
  assert.ok(sm.unknownConditions.every((u) => /placeholder/.test(u.reason)));
  assert.equal(sm.bounds.low, 0);
});

test('each Q7 condition carries its own tier: the deposit proxy, the hotel and retail interval and an earlier size mix are inferred', () => {
  const r = paper();
  const tiers = (s) => Object.fromEntries(s.conditions.filter((c) => c.share.tier).map((c) => [c.id, c.share.tier]));
  const mf = r.q7.sectors.find((s) => s.sector === 'multifamily');
  assert.deepEqual(tiers(mf), { category: 'reported', metro: 'inferred' }, 'multifamily has its own Call Report line; the metro share is a deposit proxy');
  const h = r.q7.sectors.find((s) => s.sector === 'hospitality');
  assert.deepEqual(tiers(h), { category: 'inferred', metro: 'inferred', size: 'reported' }, 'the hotel share only lies in [0, NFNR share]; the June size mix on the June balance is reported');
  assert.deepEqual(tiers(r.q7.sectors.find((s) => s.sector === 'retail')), tiers(h));
  // With a September report, the June size mix is applied to the September balance: an inference.
  const sep = paper({ financials: { CERT: '1', quarters: quarters([...REPS.slice(1), '20260930']) } });
  assert.equal(sep.q7.sectors.find((s) => s.sector === 'hospitality').conditions.find((c) => c.id === 'size').share.tier, 'inferred');
  // The bounds take the weakest tier of the conditions measured. With no deposit data, multifamily rests on its own line alone.
  assert.equal(mf.bounds.tier, 'inferred');
  assert.equal(h.bounds.tier, 'inferred');
  assert.equal(paper({ footprint: {} }).q7.sectors.find((s) => s.sector === 'multifamily').bounds.tier, 'reported');
  assert.match(renderPaper(r), /Condition metro: Share in the buy-box metros, by the deposit proxy \[inferred\]: 60\.0%/);
});

// ---- Q3, Q5, Q6, Q8 and the summary -----------------------------------------------------------------------------------------------
test('Q3 is labelled a proxy, Q5 not CRE-specific with no vintages, Q6 a dated list, Q8 the unknowns and the tape request', () => {
  const r = paper({ filings: [{ id: 'sec-filing:0009900101-26-000001', accession: '0009900101-26-000001', form: '10-Q', fileDate: '2026-10-01', label: 'Loans transferred to held for sale (10-Q, filed 2026-10-01)', link: 'https://www.sec.gov/Archives/edgar/data/9900101/000990010126000001/' }] });
  assert.equal(r.q3.proxy, true); assert.match(r.q3.label, /a proxy/); assert.match(r.q3.label, /not loans/);
  assert.equal(r.q5.proxy, true); assert.match(r.q5.label, /not CRE-specific/); assert.equal(r.q5.vintages.status, 'unknown');
  assert.equal(r.q5.total.value, (400000 + 300000 + 500000 + 350000 + 250000 + 50000) * 1000);
  const dates = r.q6.items.map((i) => i.date);
  assert.deepEqual(dates, [...dates].sort().reverse(), 'newest first');
  assert.ok(r.q6.items.every((i) => /^\d{4}-\d{2}-\d{2}$/.test(i.date) && TIERS.includes(i.tier) && i.sources.length));
  assert.equal(r.q6.items[0].type, 'sec-filing');
  assert.equal(r.q6.items.find((i) => i.type === 'held-for-sale').values.total.value, 2500 * 1000);
  assert.deepEqual(r.q8.tapeRequest.items, [...TAPE_REQUEST]);
  for (const id of ['property-types', 'participations', 'vintages', 'locations', 'holding-company']) assert.ok(r.q8.unknowns.some((u) => u.id === id), id);
  assert.equal(r.q2.built, false);
  for (const s of r.summary) assert.ok(paperAt(r, s.ref) && 'unit' in paperAt(r, s.ref), s.id);
  assert.deepEqual(r.summary.map((s) => s.id).slice(0, 2), ['investorCre', 'ownerOccupied']);
});

test('the record is deterministic, and its file name is safe', () => {
  assert.deepEqual(paper(), paper());
  assert.equal(paperFileId('fdic:12345'), 'fdic-12345');
  assert.throws(() => paperFileId('../etc'), /not a bank key/);
  assert.throws(() => paperFileId('fdic:12/3'), /not a bank key/);
  assert.equal(paperPath('/data', 'fdic:7'), join('/data', 'paper', 'fdic-7.json'));
});

test('the text for `outbound paper show` gives each number its tier and date, and closes with the unknowns and the tape request', () => {
  const r = paper();
  const t = renderPaper(r);
  assert.match(t, /^PAPER ESTIMATE: Alpha Example Bank \(fdic:1\)/);
  assert.match(t, /Investor CRE \(2006 guidance definition\): \$820\.0 million {2}\[reported, June 30, 2026\]/);
  assert.match(t, /Multifamily loans in the buy box: bounds: \$0 to \$300\.0 million {2}\[inferred bounds, June 30, 2026\]/);
  assert.match(t, /Under \$1 million, number of loans: 340 {2}\[reported, June 30, 2026\]/);
  assert.match(t, /Charge-offs, net, year to date \(a flow\): \$20,000 {2}\[reported, year to date to June 30, 2026\]/);
  const gapLine = new RegExp(`: (${Object.values(STATUS).map((x) => x.replace(/[()]/g, '\\$&')).join('|')}): `);
  const lines = t.split('\n').filter((l) => /\$\d/.test(l) && !/^\s*(Condition|Not used)/.test(l) && !gapLine.test(l) && !/^\s{4}\S.*: .*(September|December|March|June) \d+, \d{4} \$/.test(l));
  for (const l of lines) assert.ok(/\[(reported|observed|inferred)[ ,]/.test(l) || /\(original amount\)|buy box's size range/.test(l), `a dollar figure without its tier: ${l}`);
  assert.ok(t.indexOf('Q8. WHAT WE DO NOT KNOW') < t.indexOf('THE TAPE REQUEST'));
  assert.ok(t.trimEnd().endsWith('- Participations (who leads, what share)'));
});

test('the briefer\'s copy drops source lists and series but keeps the values and the unknowns', () => {
  const b = paperForBriefer(paper());
  const s = JSON.stringify(b);
  assert.ok(!s.includes('"sources"') && !s.includes('"series"'));
  assert.ok(s.includes('820000000')); assert.ok(b.unknowns.length > 3);
  assert.equal(paperForBriefer(null), null);
});

// ---- The scoring run writes the records ------------------------------------------------------------------------------------------
function world() {
  const dir = makeDir();
  const src = (period) => ({ source: 'fdic', endpoint: '/test', query: {}, recordId: 'invented', period, fetchedAt: '2026-11-13T00:00:00Z', runId: 'test-run' });
  put(dir, 'sources/fdic/institutions.json', {
    1: { CERT: '1', NAME: 'Alpha Example Bank', CITY: 'Anytown', STALP: 'AZ', ASSET: 3000000, ACTIVE: 1, via: { branch: true, hq: false }, inUniverse: true, status: 'active', _source: src('') },
    2: { CERT: '2', NAME: 'Beta Example Bank', CITY: 'Anytown', STALP: 'AZ', ASSET: 3000000, ACTIVE: 1, via: { branch: true, hq: false }, inUniverse: true, status: 'active', _source: src('') },
  });
  put(dir, 'sources/fdic/footprint.json', { 1: FP, 2: FP });
  put(dir, 'sources/fdic/financials/1.json', { CERT: '1', quarters: quarters() });
  put(dir, 'sources/fdic/financials/2.json', { CERT: '2', quarters: quarters() });
  put(dir, 'sources/fdic/events.json', { 2026000777: { transnum: '2026000777', kind: 'merger', acquirerCert: '1', targetCert: '777', effective: '2026-02-15', targetInMetros: true, targetMetros: [{ cbsa: '38060', branches: 2, basis: ['main office'] }] } });
  return dir;
}

test('the scoring run writes one record per scored bank to paper/, provisional while the buy box has placeholders, and skips unchanged ones', () => {
  const dir = world();
  confirmFiler({ dir, bank: 'fdic:1', cik: '9900101', by: 'Pat Example', now: NOW });
  put(dir, 'sources/edgar/filings.json', { a: { key: 'sec:a', accession: '0009900101-26-000001', cik: '0009900101', filerCiks: ['0009900101'], form: '10-Q', items: [], fileDate: '2026-10-01', searches: ['loan-sale-cre'], link: 'https://www.sec.gov/Archives/edgar/data/9900101/000990010126000001/', firstSeenAt: '2026-11-13T12:00:00Z' } });
  const out = runScoring({ dir, buybox: placeholderBuybox(), scoring: scoring(), metros, now: NOW, allowPlaceholders: true });
  for (const it of out.items) {
    const rec = readPaper({ dir, key: it.key });
    assert.ok(rec, it.key);
    assert.equal(rec.key, it.key); assert.equal(rec.runId, out.runId); assert.equal(rec.provisional, true);
    assert.ok(rec.placeholders.includes('loanSize.minUsd'));
  }
  const one = readPaper({ dir, key: 'fdic:1' });
  assert.ok(one.q6.items.some((i) => i.type === 'sec-filing' && i.date === '2026-10-01'), 'SEC filing signals reach Q6');
  assert.ok(one.q6.items.some((i) => i.type === 'acquisition' && i.targetCert === '777'), 'acquisitions reach Q6');
  assert.ok(!readPaper({ dir, key: 'fdic:2' }).q6.items.some((i) => i.type === 'acquisition'));
  const p = paperPath(dir, 'fdic:1');
  const before = statSync(p).mtimeMs;
  const again = runScoring({ dir, buybox: placeholderBuybox(), scoring: scoring(), metros, now: new Date('2026-11-14T12:00:00Z'), allowPlaceholders: true });
  assert.equal(statSync(p).mtimeMs, before, 'an unchanged record is not rewritten');
  assert.equal(readPaper({ dir, key: 'fdic:1' }).runId, out.runId, 'its runId names the run that last changed it');
  const audits = readJsonl(join(dir, 'audit.jsonl')).filter((a) => a.type === 'scoring_run');
  assert.deepEqual(audits.map((a) => [a.paperRecords, a.paperWritten]), [[2, 2], [2, 0]]);
  assert.notEqual(again.runId, out.runId);
  // A changed input rewrites it.
  runScoring({ dir, buybox: filledBuybox(), scoring: scoring(), metros, now: NOW });
  assert.equal(readPaper({ dir, key: 'fdic:1' }).provisional, false);
});
