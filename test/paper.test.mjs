// The paper estimate, reported layer (docs/paper-estimate.md, PRD E14-S1). Invented banks and numbers only; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { statSync } from 'node:fs';
import { makeDir, put, loadJson, placeholderBuybox } from './kit.mjs';
import { buildPaper, frechetBounds, sizeShareInterval, statusEligible, paperValues, paperAt, paperFileId, paperPath, readPaper, renderPaper, formatValue, paperForBriefer, fitCeilingOf,
  TIERS, STATUS, SERIES_BREAK_2023, TAPE_REQUEST, BOUNDS_METHOD, NONFARM_TOTAL_STAGES, STAGE_LABELS } from '../src/paper.mjs';
import { runScoring, validateBuybox } from '../src/score.mjs';
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

// ---- The nonfarm nonresidential total's stages ----------------------------------------------------------------------------------------
test('the nonfarm nonresidential total has its own 30-89, 90+ and nonaccrual stages, in a category\'s shape, from FDIC\'s totals', () => {
  const r = paper();
  const nf = r.q1.nonfarmTotal;
  const mf = r.q1.categories.find((c) => c.id === 'multifamily');
  assert.deepEqual(Object.keys(nf.stages), Object.keys(mf.stages), 'the same stage ids as every category');
  for (const [k, s] of Object.entries(nf.stages)) assert.deepEqual(Object.keys(s), Object.keys(mf.stages[k]), `${k}: { amount, shareOfBalance }`);
  // P3RENRES 6,000, P9RENRES 2,000, NARENRES 8,000 (thousands), each over LNRENRES 600,000.
  assert.deepEqual(Object.values(nf.stages).map((s) => [s.amount.value, s.amount.tier, s.amount.method, s.amount.sources.map((x) => x.field)]),
    [[6000 * 1000, 'reported', 'fdic-field', ['P3RENRES']], [2000 * 1000, 'reported', 'fdic-field', ['P9RENRES']], [8000 * 1000, 'reported', 'fdic-field', ['NARENRES']]]);
  assert.deepEqual(Object.values(nf.stages).map((s) => s.shareOfBalance.value), [6000 / 600000, 2000 / 600000, 8000 / 600000]);
  assert.equal(nf.stages.nonaccrual.amount.asOf, '2026-06-30');
  // The two lines add up to the total here, as on all 360 rows checked: the stage is the same figure either way.
  const lines = r.q1.categories.filter((c) => c.id.startsWith('nonfarmNonresidential'));
  for (const k of Object.keys(nf.stages)) assert.equal(nf.stages[k].amount.value, lines.reduce((s, c) => s + c.stages[k].amount.value, 0), k);
  const t = renderPaper(r);
  assert.match(t, /Nonfarm nonresidential in total \(owner-occupied and other\)\n {4}Balance: \$600\.0 million {2}\[reported, June 30, 2026\]\n {4}30-89 days past due: \$6\.0 million {2}\[reported, June 30, 2026\]\n {4}90 days or more past due: \$2\.0 million {2}\[reported, June 30, 2026\]\n {4}Nonaccrual: \$8\.0 million {2}\[reported, June 30, 2026\]/);
  assert.deepEqual(Object.keys(NONFARM_TOTAL_STAGES), Object.keys(STAGE_LABELS));
});

test('where a report lacks a nonfarm total, its two lines stand in and say so; with neither, the stage is a gap, never 0', () => {
  // FDIC sends no value for P9RENRES, and the data was pulled before NARENRES (invented: the lines are then the only basis).
  const qs = quarters(REPS, (rep) => (rep === '20260630' ? { P9RENRES: null } : {}));
  delete qs['20260630'].NARENRES;
  const r = paper({ financials: { CERT: '1', quarters: qs } });
  const nf = r.q1.nonfarmTotal.stages;
  assert.deepEqual([nf.pastDue90.amount.value, nf.pastDue90.amount.tier, nf.pastDue90.amount.sources.map((x) => x.field)], [(1500 + 500) * 1000, 'reported', ['P9RENROT', 'P9RENROW']]);
  assert.match(nf.pastDue90.amount.method, /^sum-of-fields: its two lines, standing in for P9RENRES$/);
  assert.match(nf.pastDue90.amount.note, /FDIC reports no value for P9RENRES at June 30, 2026\. So this is the sum of its two lines, other and owner-occupied \(P9RENROT \+ P9RENROW\)/);
  assert.deepEqual([nf.nonaccrual.amount.value, nf.nonaccrual.amount.sources.map((x) => x.field)], [(6000 + 2000) * 1000, ['NARENROT', 'NARENROW']]);
  assert.match(nf.nonaccrual.amount.note, /NARENRES is not in the stored report/);
  assert.equal(nf.nonaccrual.shareOfBalance.value, 8000 / 600000);
  assert.deepEqual([nf.pastDue30to89.amount.method, nf.pastDue30to89.amount.sources.map((x) => x.field)], ['fdic-field', ['P3RENRES']], 'a stage whose total is reported keeps it');
  everyValue(r);
  // The total and a line both without a value: a gap that names both, never 0 and never half the sum.
  const none = paper({ financials: { CERT: '1', quarters: quarters(REPS, (rep) => (rep === '20260630' ? { P3RENRES: null, P3RENROW: null } : {})) } });
  const g = none.q1.nonfarmTotal.stages.pastDue30to89;
  assert.deepEqual([g.amount.value, g.amount.status, g.amount.tier, g.shareOfBalance.value], [null, 'null', null, null]);
  assert.match(g.amount.reason, /no value for P3RENRES at June 30, 2026\. Its two lines \(P3RENROT \+ P3RENROW\) cannot stand in: FDIC reports no value for P3RENROW/);
  everyValue(none);
  // No financials at all: every stage is "not on file", as every other Q1 figure is.
  const empty = paper({ financials: null });
  for (const s of Object.values(empty.q1.nonfarmTotal.stages)) assert.deepEqual([s.amount.value, s.amount.status], [null, 'not-on-file']);
});

// ---- The seriously-late trend ---------------------------------------------------------------------------------------------------------
const lateOf = (q) => (q.P9RECONS + q.NARECONS + q.P9REMULT + q.NAREMULT + q.P9RENRES + q.NARENRES) / (q.LNRECONS + q.LNREMULT + q.LNRENRES);

test('the seriously-late share of the CRE book, one point per quarter on file, oldest first, from the Q1 stages over the CRE book', () => {
  const qs = quarters(REPS, (rep, i) => ({ NAREMULT: 10000 + i * 1000, NARENROT: 6000 + i * 500, NARENRES: 8000 + i * 500 }));
  const r = paper({ financials: { CERT: '1', quarters: qs } });
  const pts = r.trend.seriouslyLateShare;
  assert.ok(Array.isArray(pts));
  assert.deepEqual(pts.map((p) => p.quarter), ['2024Q3', '2024Q4', '2025Q1', '2025Q2', '2025Q3', '2025Q4', '2026Q1', '2026Q2']);
  assert.deepEqual(pts.map((p) => p.repdte), REPS);
  assert.deepEqual(pts.map((p) => p.asOf), REPS.map((x) => `${x.slice(0, 4)}-${x.slice(4, 6)}-${x.slice(6)}`));
  pts.forEach((p, i) => assert.ok(Math.abs(p.value - lateOf(qs[REPS[i]])) < 1e-15, `${p.quarter}: ${p.value}`));
  assert.ok(Math.abs(pts[0].value - (300 + 1000 + 1000 + 10000 + 2000 + 8000) / 1000000) < 1e-15, '90+ plus nonaccrual, over construction + multifamily + nonfarm nonresidential');
  assert.ok(pts.every((p) => !('fields' in p) && !('valueStatus' in p)));
  // The latest point is the Q1 stages, as shown, over the CRE book: nothing is counted that Q1 does not show.
  const cat = (id) => r.q1.categories.find((c) => c.id === id);
  const late = ['construction', 'multifamily'].flatMap((id) => [cat(id).stages.pastDue90.amount.value, cat(id).stages.nonaccrual.amount.value])
    .concat([r.q1.nonfarmTotal.stages.pastDue90.amount.value, r.q1.nonfarmTotal.stages.nonaccrual.amount.value]).reduce((s, x) => s + x, 0);
  assert.ok(Math.abs(pts.at(-1).value - late / r.q1.creBook.value) < 1e-15);
  const about = r.trend.about.seriouslyLateShare;
  assert.deepEqual([about.unit, about.kind, about.tier, about.file], ['pct', 'stock', 'reported', 'sources/fdic/financials/1.json']);
  assert.deepEqual(about.numerator, ['P9RECONS', 'NARECONS', 'P9REMULT', 'NAREMULT', 'P9RENRES', 'NARENRES']);
  assert.deepEqual(about.denominator, r.q1.creBook.sources.map((s) => s.field));
  assert.match(about.note, /none is filled in/); assert.match(about.note, /never 0/);
  assert.match(renderPaper(r), /Seriously late share of the CRE book: 90 days or more past due plus nonaccrual, over the CRE book \[reported\]: September 30, 2024 2\.2%; .*; June 30, 2026 3\.3%\n/);
  // The series sits beside the record's values, not among them: it is not a value with a unit, and the briefer's copy leaves it out.
  assert.ok(!paperValues(r).some(({ path }) => path.startsWith('trend')));
  assert.ok(!JSON.stringify(paperForBriefer(r)).includes('seriouslyLateShare'));
});

test('the seriously-late trend never invents a quarter: N quarters on file give N points, a missing quarter has none, and the window is eight', () => {
  // Three quarters on file: three points.
  assert.deepEqual(paper({ financials: { CERT: '1', quarters: quarters(REPS.slice(-3)) } }).trend.seriouslyLateShare.map((p) => p.quarter), ['2025Q4', '2026Q1', '2026Q2']);
  // One quarter, and none.
  assert.equal(paper({ financials: { CERT: '1', quarters: quarters(['20260630']) } }).trend.seriouslyLateShare.length, 1);
  assert.deepEqual(paper({ financials: null }).trend.seriouslyLateShare, []);
  // A quarter missing from the file in the middle of the window: no point for it, and nothing between its neighbours.
  const holed = quarters(REPS.filter((x) => x !== '20250930'));
  const pts = paper({ financials: { CERT: '1', quarters: holed } }).trend.seriouslyLateShare;
  assert.deepEqual(pts.map((p) => p.repdte), REPS.filter((x) => x !== '20250930'));
  assert.equal(pts.length, 7);
  // Twelve quarters on file: the latest eight, as every other series.
  const twelve = quarters(['20230930', '20231231', '20240331', '20240630', ...REPS]);
  assert.deepEqual(paper({ financials: { CERT: '1', quarters: twelve } }).trend.seriouslyLateShare.map((p) => p.repdte), REPS);
});

test('a quarter with no basis is null with its status and reason, never 0; a quarter on the nonfarm lines lists its own fields', () => {
  const qs = quarters(REPS, (rep) => ({ ...(rep === '20250331' ? { NARECONS: null } : {}), ...(rep === '20250630' ? { LNRECONS: 0, LNREMULT: 0, LNRENRES: 0 } : {}), ...(rep === '20251231' ? { P9RENRES: null } : {}) }));
  const r = paper({ financials: { CERT: '1', quarters: qs } });
  const at = (rep) => r.trend.seriouslyLateShare.find((p) => p.repdte === rep);
  assert.deepEqual([at('20250331').value, at('20250331').valueStatus], [null, 'unknown']);
  assert.match(at('20250331').valueReason, /FDIC reports no value for NARECONS at March 31, 2025/);
  assert.deepEqual([at('20250630').value, at('20250630').valueStatus], [null, 'zero-denominator'], 'no CRE book: no share, not 0');
  // P9RENRES has no value: its lines, P9RENROT + P9RENROW (1,500 + 500), stand in, the same 2,000, and the point names its fields.
  const fb = at('20251231');
  assert.ok(Math.abs(fb.value - lateOf(Q())) < 1e-15);
  assert.deepEqual(fb.fields, ['P9RECONS', 'NARECONS', 'P9REMULT', 'NAREMULT', 'P9RENROT', 'P9RENROW', 'NARENRES', 'LNRECONS', 'LNREMULT', 'LNRENRES']);
  assert.ok(r.trend.seriouslyLateShare.filter((p) => p !== fb).every((p) => !('fields' in p)));
  assert.equal(r.trend.seriouslyLateShare.length, 8, 'a quarter on file with a gap keeps its point; it is not dropped or filled in');
  assert.match(renderPaper(r), /March 31, 2025 unknown; June 30, 2025 no ratio \(zero base\);/);
});

// ---- The could-fit ceilings the candidate list shows ------------------------------------------------------------------------------------
test('fitCeilingOf: one entry per buy-box sector with measured Q7 bounds, as stored, in dollars; a gap is left out; nothing is added up', () => {
  const r = paper();
  const fc = fitCeilingOf(r);
  assert.deepEqual(fc, r.q7.sectors.map((s) => ({ sector: s.sector, label: s.label, category: s.category, high: s.bounds.high, low: s.bounds.low, tier: s.bounds.tier, asOf: s.bounds.asOf })));
  assert.deepEqual(fc.map((x) => x.sector), ['hospitality', 'multifamily', 'retail']);
  assert.deepEqual(fc.find((x) => x.sector === 'multifamily'), { sector: 'multifamily', label: 'Multifamily', category: 'multifamily', high: 11000 * 1000, low: 0, tier: 'inferred', asOf: '2026-06-30' });
  // Hotel and retail are the same nonfarm nonresidential loans, so their ceilings are equal and must never be added.
  assert.equal(fc.find((x) => x.sector === 'hospitality').high, fc.find((x) => x.sector === 'retail').high);
  for (const x of fc) assert.deepEqual(Object.keys(x), ['sector', 'label', 'category', 'high', 'low', 'tier', 'asOf']);
  // A sector whose bounds are a gap is left out; no financials leave nothing to show.
  const mixed = { q7: { sectors: [r.q7.sectors[1], { ...r.q7.sectors[0], bounds: { value: null, status: 'unknown', reason: 'No condition could be measured.', unit: 'usd', tier: null } }] } };
  assert.deepEqual(fitCeilingOf(mixed).map((x) => x.sector), ['multifamily']);
  assert.deepEqual(fitCeilingOf(paper({ financials: null })), []);
  assert.deepEqual(fitCeilingOf(null), []);
  // Only the sectors the buy box includes.
  assert.deepEqual(fitCeilingOf(paper({ buybox: filledBuybox({ sectors: { include: ['multifamily'], shortTermRentalPortfolios: 'out' } }) })).map((x) => x.sector), ['multifamily']);
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

test('Q7 in the record: multifamily from its own line, the metro proxy and its status stages; hotel and retail unknown inside nonfarm nonresidential; no base figure', () => {
  const r = paper();
  const book = (100000 + 300000 + 600000) * 1000;
  assert.equal(r.q1.creBook.value, book);
  const mf = r.q7.sectors.find((s) => s.sector === 'multifamily');
  // The filled buy box buys non-performing loans: by D-P3, 90+ days past due + nonaccrual, 1,000 + 10,000 of multifamily (thousands).
  assert.deepEqual(mf.conditions.map((c) => [c.id, c.share.low, c.share.high]), [['category', 0.3, 0.3], ['metro', 0.6, 0.6], ['size', 0, 1], ['status', 0.011, 0.011], ['lien', 0, 1], ['exclusions', 0, 1]]);
  assert.deepEqual([mf.bounds.low, mf.bounds.high, mf.bounds.k, mf.bounds.tier, mf.bounds.method], [0, 11000 * 1000, 6, 'inferred', BOUNDS_METHOD], '0.3 + 0.6 - 1 < 0, three conditions are unknown, and the status share is the smallest');
  assert.match(mf.bounds.lowNote, /lower bound is 0/);
  assert.match(mf.unknownConditions.find((u) => u.id === 'size').reason, /no loan-size data for multifamily/);
  // Hotel: the category's share is unknown, so it enters as [0, nonfarm nonresidential share]: the lower bound is 0.
  const h = r.q7.sectors.find((s) => s.sector === 'hospitality');
  assert.deepEqual(h.conditions.map((c) => c.id), ['category', 'metro', 'size', 'status', 'lien', 'exclusions']);
  assert.deepEqual([h.conditions[0].share.low, h.conditions[0].share.high], [0, 0.6]);
  assert.equal(h.bounds.low, 0);
  // Size: over $1 million by original amount = LNRENRES - LNRENR4 = 500,000 of 600,000 nonfarm nonresidential: 0.5 of the book at most.
  assert.deepEqual([h.conditions[2].share.low, h.conditions[2].share.high], [0, 0.5]);
  // Status: non-performing nonfarm nonresidential loans, both lines = 1,500 + 6,000 + 500 + 2,000 = 10,000: 0.01 of the book.
  assert.deepEqual([h.conditions[3].share.low, h.conditions[3].share.high], [0.01, 0.01]);
  assert.equal(h.bounds.high, 10000 * 1000, 'upper = min(0.6, 0.6, 0.5, 0.01) x book: the status share is the smallest');
  assert.match(h.why, /cannot split them/); assert.match(h.why, /lower bound is 0/);
  assert.equal(r.q7.sectors.find((s) => s.sector === 'retail').bounds.high, h.bounds.high);
  // With no deposit data and no usable size, the upper bound for hotel is its non-performing nonfarm nonresidential loans, and the lower is 0.
  const bare = paper({ footprint: {}, buybox: filledBuybox({ loanSize: { minUsd: '[CONFIRM]', maxUsd: '[CONFIRM]' } }), placeholders: ['loanSize.minUsd', 'loanSize.maxUsd'] });
  const hb = bare.q7.sectors.find((s) => s.sector === 'hospitality');
  assert.deepEqual([hb.bounds.low, hb.bounds.high], [0, 10000 * 1000]);
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
  // The review's case: 30% multifamily, 100% of deposits in buy-box metros. The buy box restricts size, lien and exclusions, and nothing
  // measures them for multifamily, so the floor is 0, not 30% of the book. Status is measured (D-P3), so it is not among them.
  const r = paper({ footprint: ALL_IN_BOX });
  const mf = r.q7.sectors.find((s) => s.sector === 'multifamily');
  assert.deepEqual(mf.unknownConditions.map((u) => u.id), ['size', 'lien', 'exclusions']);
  assert.deepEqual([mf.bounds.low, mf.bounds.high, mf.bounds.k], [0, 11000 * 1000, 6]);
  for (const u of mf.unknownConditions) {
    const c = mf.conditions.find((x) => x.id === u.id);
    assert.deepEqual([c.share.low, c.share.high, c.share.status, c.share.tier], [0, 1, 'unknown', null], u.id);
    assert.ok(u.label && u.reason, u.id);
  }
  assert.match(mf.bounds.lowNote, /The lower bound is 0 because these buy-box conditions cannot be measured: loan size, lien position, exclusions\./);
  const h = r.q7.sectors.find((s) => s.sector === 'hospitality');
  assert.deepEqual(h.unknownConditions.map((u) => u.id), ['lien', 'exclusions'], 'hotel\'s size is measured from the size buckets, and its status from the stages');
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
  assert.deepEqual(tiers(mf), { category: 'reported', metro: 'inferred', status: 'reported' }, 'multifamily has its own Call Report line and stages; the metro share is a deposit proxy');
  const h = r.q7.sectors.find((s) => s.sector === 'hospitality');
  assert.deepEqual(tiers(h), { category: 'inferred', metro: 'inferred', size: 'reported', status: 'reported' }, 'the hotel share only lies in [0, NFNR share]; the June size mix on the June balance, and the June stages, are reported');
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

// ---- Q7 status, by D-P3 (decided 2026-11-17) -----------------------------------------------------------------------------------------
const bySector = (r, id) => r.q7.sectors.find((s) => s.sector === id);
const statusShare = (s) => s.conditions.find((c) => c.id === 'status').share;

test('D-P3: the status condition is the loans on each sector\'s own lines in the stages the buy box buys, with exact amounts', () => {
  // The shipped buy box: non-performing (90+ days past due and nonaccrual), sub-performing (30-89) and foreclosed (OREO, not loans).
  const r = paper({ buybox: shippedBuybox() });
  assert.deepEqual(r.q7.statusRule.statuses, [{ status: 'non-performing', stages: ['pastDue90', 'nonaccrual'] }, { status: 'sub-performing', stages: ['pastDue30to89'] }, { status: 'foreclosed (REO/OREO)', stages: ['oreo'] }]);
  assert.deepEqual([r.q7.statusRule.state, r.q7.statusRule.loanStages, r.q7.statusRule.oreo], ['mapped', ['pastDue30to89', 'pastDue90', 'nonaccrual'], true]);
  const mf = bySector(r, 'multifamily'), h = bySector(r, 'hospitality'), rt = bySector(r, 'retail');
  // Multifamily: P3REMULT + P9REMULT + NAREMULT = 4,000 + 1,000 + 10,000 (thousands), a reported sum.
  assert.deepEqual([mf.statusLoans.amount.value, mf.statusLoans.amount.tier, mf.statusLoans.amount.kind, mf.statusLoans.amount.asOf], [15000 * 1000, 'reported', 'stock', '2026-06-30']);
  assert.deepEqual(mf.statusLoans.amount.sources.map((s) => s.field), ['P3REMULT', 'P9REMULT', 'NAREMULT']);
  // Hotel and retail: both nonfarm nonresidential lines, other (4,000 + 1,500 + 6,000) and owner-occupied (2,000 + 500 + 2,000).
  assert.equal(h.statusLoans.amount.value, 16000 * 1000);
  assert.deepEqual(h.statusLoans.byLine.map((l) => l.line), ['nonfarmNonresidentialOther', 'nonfarmNonresidentialOwnerOccupied']);
  assert.deepEqual(rt.statusLoans.amount, h.statusLoans.amount);
  for (const s of r.q7.sectors) {
    assert.ok(!s.statusLoans.byLine.some((l) => l.line === 'notSecuredByRealEstate'), 'CRE not secured by real estate is outside the book Q7 measures');
    for (const l of s.statusLoans.byLine) for (const p of l.parts) assert.equal(paperAt(r, p.ref), r.q1.categories.find((c) => c.id === l.line).stages[p.stage].amount, `${s.sector} ${p.ref}: each stage is stored once, in Q1`);
  }
  // As a condition: a direct share of the book, reported, combined with the others as bounds (upper = the smallest share), never multiplied.
  assert.deepEqual([statusShare(mf).low, statusShare(mf).high, statusShare(mf).tier], [0.015, 0.015, 'reported']);
  assert.deepEqual([statusShare(h).low, statusShare(h).high, statusShare(h).tier], [0.016, 0.016, 'reported']);
  for (const s of [mf, h]) assert.deepEqual(frechetBounds(s.conditions.map((c) => c.share)), { k: s.bounds.k, low: s.bounds.lowShare, high: s.bounds.highShare }, s.sector);
  assert.deepEqual([mf.bounds.low, mf.bounds.high, mf.bounds.k], [0, 15000 * 1000, 5], 'category 0.3, metro 0.6, size 0 to 1, status 0.015, lien 0 to 1');
  assert.deepEqual([h.bounds.low, h.bounds.high, h.bounds.k], [0, 16000 * 1000, 5], 'category 0 to 0.6, metro 0.6, size 0 to 0.5, status 0.016, lien 0 to 1');
  // A buy box of non-performing loans only: 30-89 days past due is sub-performing, so it does not count.
  const np = paper();
  assert.deepEqual(np.q7.statusRule.loanStages, ['pastDue90', 'nonaccrual']);
  assert.equal(bySector(np, 'multifamily').statusLoans.amount.value, (1000 + 10000) * 1000);
  assert.equal(bySector(np, 'hospitality').statusLoans.amount.value, (1500 + 6000 + 500 + 2000) * 1000);
  // A bank with no multifamily loans in a stage the buy box buys has none in the box: a reported 0, and an upper bound of 0.
  const clean = paper({ buybox: shippedBuybox(), financials: { CERT: '1', quarters: quarters(REPS, () => ({ P3REMULT: 0, P9REMULT: 0, NAREMULT: 0 })) } });
  const cm = bySector(clean, 'multifamily');
  assert.deepEqual([cm.statusLoans.amount.value, cm.statusLoans.amount.tier, cm.bounds.low, cm.bounds.high], [0, 'reported', 0, 0]);
  // The text says which stages count as each status, citing D-P3, and states the fit rule.
  const t = renderPaper(r);
  assert.match(t, /Status, by D-P3 \(buybox\.json statusStages\): non-performing = 90 days or more past due \(still accruing\) \+ nonaccrual; sub-performing = 30-89 days past due; foreclosed \(REO\/OREO\) = foreclosed property the bank owns \(OREO\)\./);
  assert.match(t, /Fit rule, D-P3: sector and metro must match; size and status narrow the range\./);
  assert.match(t, /Multifamily loans in a stage the buy box buys \(30-89 days past due, 90 days or more past due \(still accruing\), nonaccrual\): \$15\.0 million {2}\[reported, June 30, 2026\]/);
  assert.match(t, /Condition status: Multifamily loans in a stage the buy box buys .*\[reported\]: 1\.5%/);
});

test('a stage FDIC does not report is "not reported" in the status sum, never zero: it widens the range, and the bound, instead of zeroing them', () => {
  const r = paper({ buybox: shippedBuybox() });
  // CRE not secured by real estate: FDIC reports its 30-89 stage (P3COMRE, a reported 0 here) and no 90+ or nonaccrual field.
  const ns = r.q1.categories.find((c) => c.id === 'notSecuredByRealEstate');
  const e = statusEligible([ns], ['pastDue30to89', 'pastDue90', 'nonaccrual']);
  assert.deepEqual(e.notReported.map((n) => [n.line, n.stage, n.status]), [['notSecuredByRealEstate', 'pastDue90', 'not-reported'], ['notSecuredByRealEstate', 'nonaccrual', 'not-reported']]);
  assert.ok(e.notReported.every((n) => /^FDIC reports no (90\+ days past due|nonaccrual) field/.test(n.reason)), 'it says so');
  assert.deepEqual(e.byLine[0].parts.map((p) => [p.stage, p.reported]), [['pastDue30to89', true], ['pastDue90', false], ['nonaccrual', false]]);
  // The stages not reported hold anywhere from none to the rest of the line: LNCOMRE 20,000 less the 0 reported. A range, not a gap, not 0.
  assert.deepEqual([e.amount.low, e.amount.high, e.amount.tier, 'value' in e.amount, 'status' in e.amount], [0, 20000 * 1000, 'inferred', false, false]);
  // With 500 past due 30-89 days on the line, the range runs from 500 to the whole line; zeroing the missing stages would stop it at 500.
  const r2 = paper({ buybox: shippedBuybox(), financials: { CERT: '1', quarters: quarters(REPS, () => ({ P3COMRE: 500 })) } });
  const e2 = statusEligible([r2.q1.categories.find((c) => c.id === 'notSecuredByRealEstate')], ['pastDue30to89', 'pastDue90', 'nonaccrual']);
  assert.deepEqual([e2.low, e2.high], [500 * 1000, 20000 * 1000]);
  // In the record: FDIC sends no value for multifamily's 90+ stage. It is "no value from FDIC", never 0. The status share becomes a range
  // from the stages reported (30-89 and nonaccrual) to the whole line, so the upper bound widens to the category share instead of shrinking.
  const nul = paper({ buybox: shippedBuybox(), financials: { CERT: '1', quarters: quarters(REPS, (rep) => (rep === '20260630' ? { P9REMULT: null } : {})) } });
  const mf = bySector(nul, 'multifamily');
  assert.deepEqual(mf.statusLoans.notReported.map((n) => [n.line, n.stage, n.status]), [['multifamily', 'pastDue90', 'null']]);
  assert.deepEqual([mf.statusLoans.amount.low, mf.statusLoans.amount.high, mf.statusLoans.amount.tier], [(4000 + 10000) * 1000, 300000 * 1000, 'inferred']);
  const s = statusShare(mf);
  assert.deepEqual([s.low, s.high, s.tier, s.method], [0.014, 0.3, 'inferred', 'share-interval']);
  assert.equal(mf.bounds.high, 300000 * 1000, 'min(0.3, 0.6, 1, 0.3, 1): the category share, not the 1.4% the reported stages alone would give');
  assert.equal(mf.bounds.tier, 'inferred');
  assert.match(mf.conditions.find((c) => c.id === 'status').basis, /Not reported: 90 days or more past due \(still accruing\), multifamily \(no value from FDIC\)\..*never as zero/);
  assert.match(renderPaper(nul), /Multifamily: 30-89 days past due: \$4\.0 million {2}\[reported, June 30, 2026\]; 90 days or more past due \(still accruing\): no value from FDIC: /);
  everyValue(nul);
});

test('foreclosed property (OREO) is its own in-box figure, a stock beside the loan bounds, never added to a loan share', () => {
  const r = paper({ buybox: shippedBuybox() });
  const mf = bySector(r, 'multifamily'), h = bySector(r, 'hospitality');
  assert.deepEqual([mf.oreo.inBox, mf.oreo.figure.value, mf.oreo.figure.kind, mf.oreo.figure.tier, mf.oreo.figure.sources.map((s) => s.field)], [true, 1000 * 1000, 'stock', 'reported', ['OREMULT']]);
  // Hotel and retail OREO is an unknown part of nonfarm nonresidential OREO: from none to all of it, as the loans are.
  assert.deepEqual([h.oreo.figure.low, h.oreo.figure.high, h.oreo.figure.kind, h.oreo.figure.tier, h.oreo.figure.sources.map((s) => s.field)], [0, 1500 * 1000, 'stock', 'inferred', ['ORENRES']]);
  assert.match(h.oreo.note, /cannot split it/); assert.match(mf.oreo.note, /not loans/); assert.match(mf.oreo.note, /does not say where the property is/);
  // Never in the loans: no OREO field behind any condition, status sum or bound, and the multifamily sum is its loan stages only.
  for (const s of r.q7.sectors) {
    const fields = [...s.conditions.flatMap((c) => c.share.sources), ...s.bounds.sources, ...s.statusLoans.amount.sources].map((x) => x.field);
    assert.ok(!fields.some((f) => /^ORE/.test(f)), `${s.sector}: ${fields.join(', ')}`);
  }
  assert.equal(mf.statusLoans.amount.value, 15000 * 1000, 'not 15,000 + 1,000 of OREO');
  // Beside the loan bounds: in the summary right after them, and in the text.
  const ids = r.summary.map((s) => s.id);
  assert.equal(ids.indexOf('inBoxOreo:multifamily'), ids.indexOf('inBox:multifamily') + 1);
  assert.equal(paperAt(r, r.summary.find((s) => s.id === 'inBoxOreo:multifamily').ref), mf.oreo.figure);
  const t = renderPaper(r);
  assert.match(t, /In the buy box: \$0 to \$15\.0 million {2}\[inferred bounds, June 30, 2026\]\n {4}Multifamily foreclosed property \(OREO\), its own figure \(property, not loans; never added to the loan bounds\): \$1\.0 million {2}\[reported, June 30, 2026\]/);
  // A buy box that does not buy foreclosed property has no OREO in the box, and no OREO line in the summary.
  const np = paper();
  assert.deepEqual([bySector(np, 'multifamily').oreo.inBox, bySector(np, 'multifamily').oreo.figure], [false, undefined]);
  assert.ok(!np.summary.some((s) => s.id.startsWith('inBoxOreo:')));
});

test('with the shipped buy box, lien position stays an unknown condition, and its empty exclusions restrict nothing', () => {
  const r = paper({ buybox: shippedBuybox() });
  for (const s of r.q7.sectors) {
    const lien = s.unknownConditions.find((u) => u.id === 'lien');
    assert.deepEqual([lien.label, lien.reason], ['lien position', 'The Call Report does not report lien position for these loans.'], s.sector);
    const c = s.conditions.find((x) => x.id === 'lien').share;
    assert.deepEqual([c.low, c.high, c.status, c.tier], [0, 1, 'unknown', null]);
    assert.ok(!s.conditions.some((x) => x.id === 'exclusions'));
    assert.match(s.notUsed.find((n) => n.id === 'exclusions').reason, /excludes nothing/);
    assert.ok(!s.unknownConditions.some((u) => u.id === 'status'), 'status is measured');
  }
  assert.deepEqual(bySector(r, 'multifamily').unknownConditions.map((u) => u.id), ['size', 'lien']);
  assert.deepEqual(bySector(r, 'hospitality').unknownConditions.map((u) => u.id), ['lien']);
  assert.match(bySector(r, 'hospitality').bounds.lowNote, /cannot be measured: lien position\./);
  assert.ok(!r.q8.unknowns.some((u) => u.id === 'status-mapping'));
  assert.match(r.q8.unknowns.find((u) => u.id === 'in-box-floor').text, /lien position/);
});

test('the placeholder buy box behaves as before: status unknown (0 to all), and the record provisional; an unmapped status is unknown too', () => {
  const pb = placeholderBuybox();
  const r = paper({ buybox: pb, placeholders: validateBuybox(pb, { metros }).placeholders });
  assert.equal(r.provisional, true); assert.equal(r.q7.provisional, true);
  assert.equal(r.q7.statusRule.state, 'unknown');
  for (const s of r.q7.sectors) {
    const u = s.unknownConditions.find((x) => x.id === 'status');
    assert.match(u.reason, /placeholder/);
    const c = statusShare(s);
    assert.deepEqual([c.low, c.high, c.status, c.tier], [0, 1, 'unknown', null]);
    assert.equal(s.statusLoans, undefined, 'no stages are summed while the statuses are a placeholder');
    assert.deepEqual([s.oreo.inBox, s.oreo.figure.value, s.oreo.figure.status], [null, null, 'unknown'], 'nor is OREO claimed for the box');
    assert.equal(s.bounds.low, 0);
  }
  for (const id of ['status-mapping', 'buy-box-placeholders']) assert.ok(r.q8.unknowns.some((u) => u.id === id), id);
  // A status the mapping does not cover (validateBuybox calls it an error) is unknown too, never guessed.
  const unmapped = paper({ buybox: filledBuybox({ statuses: ['non-performing', 'distressed'] }) });
  assert.match(bySector(unmapped, 'multifamily').unknownConditions.find((u) => u.id === 'status').reason, /lists "distressed", which buybox\.json statusStages does not map/);
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
  assert.match(t, /Multifamily loans in the buy box: bounds: \$0 to \$11\.0 million {2}\[inferred bounds, June 30, 2026\]/);
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
