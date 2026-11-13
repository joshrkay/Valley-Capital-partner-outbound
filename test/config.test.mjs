// Checks on the committed rule files for the signal pipeline: buybox.json, scoring.json, metros.json (PRD E0-S1, E0-S2, E6-S2).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadJson } from './kit.mjs';
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

test('buybox.json: valid shape, metros all in metros.json, the direct-sale asset cap, and placeholders a principal must fill', () => {
  const v = validateBuybox(buybox, { metros });
  assert.deepEqual(v.errors, []);
  const known = new Set(metros.metros.map((m) => m.cbsa));
  for (const c of buybox.metros) assert.ok(known.has(c), c);
  assert.equal(buybox.filters.maxAssetsThousands, 10000000);
  assert.ok(v.placeholders.includes('sectors.shortTermRentalPortfolios'), 'short-term rental portfolios stay an open question until a principal decides');
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
