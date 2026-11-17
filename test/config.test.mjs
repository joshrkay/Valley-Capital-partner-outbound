// Checks on the committed rule files for the signal pipeline: buybox.json, scoring.json, metros.json (PRD E0-S1, E0-S2, E6-S2).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadJson, placeholderBuybox } from './kit.mjs';
import { validateBuybox, validateScoring, AXES } from '../src/score.mjs';
import { METRICS } from '../src/metrics.mjs';

const metros = loadJson('metros.json');
const buybox = loadJson('buybox.json');
const scoring = loadJson('scoring.json');
const STATE_FIPS = { TX: '48', CO: '08', CA: '06', AZ: '04', NV: '32' };

test('metros.json: six metros with unique 5-digit codes, labels, and counties in the right state', () => {
  assert.equal(metros.metros.length, 6);
  const codes = metros.metros.map((m) => m.cbsa);
  assert.equal(new Set(codes).size, 6);
  for (const m of metros.metros) {
    assert.match(m.cbsa, /^\d{5}$/, m.cbsa);
    assert.ok(m.label && m.name && m.state, m.cbsa);
    assert.ok(STATE_FIPS[m.state], `${m.cbsa}: unknown state ${m.state}`);
    const counties = Object.keys(m.counties);
    assert.ok(counties.length, `${m.cbsa}: no counties`);
    for (const c of counties) { assert.match(c, /^\d{5}$/, c); assert.equal(c.slice(0, 2), STATE_FIPS[m.state], `${m.cbsa}: county ${c} is not in ${m.state}`); }
    assert.ok(m.counties[m.recordsCounty], `${m.cbsa}: recordsCounty ${m.recordsCounty} is not one of its counties`);
  }
  assert.deepEqual([...metros.hqStates].sort(), Object.keys(STATE_FIPS).sort());
});

test('buybox.json: valid shape, metros all in metros.json, the direct-sale asset cap, and filled by a principal, with no placeholders left', () => {
  const v = validateBuybox(buybox, { metros });
  assert.deepEqual(v.errors, []);
  const known = new Set(metros.metros.map((m) => m.cbsa));
  for (const c of buybox.metros) assert.ok(known.has(c), c);
  assert.equal(buybox.filters.maxAssetsThousands, 10000000);
  assert.deepEqual(v.placeholders, [], 'a principal filled every [CONFIRM] value');
  assert.equal(v.ok, true);
  assert.ok(['in', 'out'].includes(buybox.sectors.shortTermRentalPortfolios), 'a principal decided whether short-term rental portfolios are in (PRD Q1)');
  // Until a principal decides, short-term rental portfolios stay an open question: a placeholder the check names.
  assert.ok(validateBuybox(placeholderBuybox(), { metros }).placeholders.includes('sectors.shortTermRentalPortfolios'), 'an unanswered Q1 is a placeholder');
});

test('scoring.json: valid, every component on an axis, every axis used, every metric known, placeholders declared', () => {
  assert.deepEqual(validateScoring(scoring).errors, []);
  for (const ax of AXES) assert.ok(scoring.components.some((c) => c.axis === ax), ax);
  for (const c of scoring.components) if (c.metric) assert.ok(METRICS[c.metric], c.metric);
  for (const r of scoring.signals) assert.ok(METRICS[r.metric], r.metric);
  assert.match(scoring._note, /PLACEHOLDER/);
  assert.ok(scoring.tiers.A.distress > 0 && scoring.tiers.A.fit > 0, 'Tier A needs both distress and fit');
  assert.equal('requirePilotPass' in scoring, false, 'the pilot gate lives in config.json');
});

// PRD E17: the backtest's settings. Every value is a placeholder a principal sets (D-B1 to D-B5), and the block's _note names each one.
test('config.json backtest: every setting present, sane, a PLACEHOLDER, and named in the block\'s _note', () => {
  const b = loadJson('config.json').backtest;
  assert.ok(b, 'config.backtest is missing');
  assert.match(b._note, /PLACEHOLDER/);
  for (const k of Object.keys(b).filter((x) => !x.startsWith('_'))) assert.ok(b._note.includes(k), `the _note does not explain ${k}`);
  assert.match(b.window._note, /PLACEHOLDER|Decided/);
  assert.match(b.window.from, /^\d{4}-(03-31|06-30|09-30|12-31)$/);
  assert.match(b.window.to, /^\d{4}-(03-31|06-30|09-30|12-31)$/);
  assert.ok(b.window.from < b.window.to);
  assert.equal(b.callReportLagDays, 60);
  assert.equal(b.minCoverage, 0.95);
  assert.equal(b.minLabels, 20);
  assert.equal(b.topK, 25);
  assert.equal(b.horizonQuarters, 4);
  assert.ok(Number.isInteger(b.sodReleaseLagDays) && b.sodReleaseLagDays > 0);
  // The holdout is declared before any comparison (D-B5, decided): a fixed third of banks, chosen by a declared seed.
  assert.equal(b.holdout.by, 'bank');
  assert.ok(b.holdout.share > 0.3 && b.holdout.share < 0.34);
  assert.match(b.holdout.seed, /\S/);
  assert.equal(b.holdoutFrom, undefined, 'one holdout, not two');
  // The window takes in the 2008 crisis, and the eras cover it without gaps or overlaps (Q6, decided).
  assert.equal(b.window.from, '2006-03-31');
  assert.equal(b.eras[0].from, b.window.from);
  assert.equal(b.eras.at(-1).to, b.window.to);
  for (let i = 1; i < b.eras.length; i++) assert.ok(b.eras[i].from > b.eras[i - 1].to, 'eras in order, not overlapping');
  assert.deepEqual(b.horizonsReported, [2, 4, 8]);
  assert.deepEqual(b.labelKinds, ['failure', 'assisted_merger', 'disclosed_sale', 'fdic_loan_sale']);
  assert.ok(!b.labelKinds.includes('merger'), 'ordinary mergers are off by default (D-B2)');
  assert.equal(b.universe, 'hq-states-and-metro-footprint');
  for (const d of ['D-B1', 'D-B2', 'D-B3', 'D-B4', 'D-B5']) assert.match(b._note, new RegExp(d));
});
