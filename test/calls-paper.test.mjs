// The call brief (PRD E15-S1) reads the paper estimate (PRD E14-S1). This test feeds it a record built by the real paper code, so a
// change to either side's shape fails here instead of silently emptying the brief's tape request or unknowns.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPaper, TAPE_REQUEST } from '../src/paper.mjs';
import { paperInputs } from '../src/calls.mjs';
import { loadRules } from '../src/rules.mjs';

const metros = loadRules().metros;
const Q = { LNRECONS: 100000, LNREMULT: 200000, LNRENRES: 300000, LNRENROT: 200000, LNRENROW: 100000, LNCOMRE: 0, RBC: 250000, RBCT1J: 240000, LNATRES: 10000, CBLRIND: 0 };
const quarters = Object.fromEntries(['20251231', '20260331', '20260630'].map((r) => [r, { REPDTE: r, ...Q }]));
const FP = { branchesByMetro: { 38060: 4 }, sod: { year: 2026, depositsByMetro: { 38060: 600000 }, totalDeposits: 1000000 } };

test('the call brief takes the tape request and the unknowns from a real paper record', () => {
  const record = buildPaper({ cert: '1', name: 'Alpha Example Bank', financials: { CERT: '1', quarters }, footprint: FP, buybox: {}, placeholders: [], metros, runId: 'score-test' });
  const pin = paperInputs(record);
  assert.equal(pin.tape.length, TAPE_REQUEST.length, 'every tape-request item reaches the brief');
  assert.ok(pin.tape.length > 0);
  assert.equal(pin.unknowns.length, record.q8.unknowns.length, 'every unknown reaches the brief');
  assert.ok(pin.values.length > 0, 'tiered values reach the brief');
  assert.ok(pin.values.every((v) => ['reported', 'observed', 'inferred'].includes(v.tier)));
});
