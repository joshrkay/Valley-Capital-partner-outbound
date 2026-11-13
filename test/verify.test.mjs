// Checking the scrapers (src/sources/verify.mjs) against the fake FDIC and fake SEC. Each check must pass on clean data and fail,
// naming what is wrong, when the stored data is wrong. No network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { makeDir } from './kit.mjs';
import { loadRules } from '../src/rules.mjs';
import { readJson, writeJson } from '../src/store.mjs';
import { runFdic, fdicPaths } from '../src/sources/fdic.mjs';
import { runEdgar } from '../src/sources/edgar.mjs';
import { verifyFdic, verifyEdgar } from '../src/sources/verify.mjs';
import { fakeFdic, METROS, TABLES } from './fdic-fake.mjs';
import { fakeSec } from './edgar-fake.mjs';

const rules = loadRules();
const NOW = new Date('2026-11-13T12:00:00Z');
// FDIC's own ratio fields, consistent with the fake's values, so the ratio check has something to agree with.
const tables = () => {
  const t = TABLES();
  for (const r of t.financials) { r.NCRECONR = (r.NCRECONS / r.LNRECONS) * 100; r.LNLSGR = 50000; r.NCLNLSR = (r.NCLNLS / 50000) * 100; }
  return t;
};
const pulled = async () => {
  const dir = makeDir();
  await runFdic({ dir, metros: METROS, fetchImpl: fakeFdic(tables()).fetchImpl, quarters: 2, sleep: async () => {}, minIntervalMs: 0, now: NOW });
  return dir;
};
const vf = (dir, t = tables()) => verifyFdic({ dir, metros: METROS, fetchImpl: fakeFdic(t).fetchImpl, sample: 2, sleep: async () => {}, minIntervalMs: 0 });
const byId = (r) => Object.fromEntries(r.checks.map((c) => [c.id, c]));

test('FDIC: on clean data every check passes, and the spot checks carry a URL to the exact record', async () => {
  const r = await vf(await pulled());
  for (const c of r.checks) assert.equal(c.ok, true, `${c.id}: ${c.summary}`);
  assert.match(byId(r)['fdic.values'].summary, /match FDIC exactly/);
  assert.match(byId(r)['fdic.ratios'].summary, /agree with FDIC's own/);
  assert.equal(r.sample.length, 2);
  assert.match(r.sample[0].check, /^https:\/\/api\.fdic\.gov\/banks\/financials\?filters=CERT:\d+%20AND%20REPDTE:\d{8}/);
});

test('FDIC: a stored value that differs from the source fails, naming the bank and field', async () => {
  const dir = await pulled();
  const f = join(fdicPaths(dir).financialsDir ?? join(dir, 'sources', 'fdic', 'financials'), '101.json');
  const fin = readJson(f); const q = Object.keys(fin.quarters).sort().at(-1);
  fin.quarters[q].NCRENRES += 1; writeJson(f, fin);
  const c = byId(await vf(dir))['fdic.values'];
  assert.equal(c.ok, false);
  assert.deepEqual([c.detail.first[0].cert, c.detail.first[0].field], ['101', 'NCRENRES']);
});

test('FDIC: a newer quarter at the source, or a bank missing from our list, fails with what to do', async () => {
  const dir = await pulled();
  const t = tables(); t.financials.push({ ...t.financials[1], REPDTE: '20260930' });
  assert.match(byId(await vf(dir, t))['fdic.fresh'].summary, /FDIC has published 20260930.*Run: outbound sources run fdic/);
  const inst = readJson(fdicPaths(dir).institutions); delete inst['101']; writeJson(fdicPaths(dir).institutions, inst);
  const c = byId(await vf(dir))['fdic.coverage'];
  assert.equal(c.ok, false); assert.deepEqual(c.detail.missing, ['101']);
});

test('FDIC: nothing pulled yet is a failure that says what to run', async () => {
  const r = await vf(makeDir());
  assert.equal(r.checks[0].ok, false); assert.match(r.checks[0].summary, /Run: outbound sources run fdic/);
});

const SEC_CFG = { ...rules.config.sec, userAgent: 'Example Firm ops@example.test', minIntervalMs: 0, knownSpecialServicers: ['Example Special Servicing LLC'] };
const edgarDir = async () => { const dir = makeDir(); await runEdgar({ dir, metros: rules.metros, buybox: rules.buybox, scoring: rules.scoring, sec: SEC_CFG, fetchImpl: fakeSec().fetchImpl, now: NOW, sleep: async () => {} }); return dir; };

test('EDGAR: on clean data every check passes; the parser equals a plain count of the file', async () => {
  const r = await verifyEdgar({ dir: await edgarDir(), sec: SEC_CFG, fetchImpl: fakeSec().fetchImpl, sleep: async () => {} });
  for (const c of r.checks) assert.equal(c.ok, true, `${c.id}: ${c.summary}`);
  const t = byId(r)['edgar.parse'].detail.trusts[0];
  assert.deepEqual([t.recorded, t.parsed, t.plainCount], [4, 4, 4]);
  assert.equal(t.balanceParsed, t.balancePlain);
  assert.match(r.sample[0].check, /^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\/1000001\/000999999926000102\/ \(open the EX-102/);
});

test('EDGAR: a CMBS-looking filer set aside as something else is flagged; a placeholder contact skips the re-read', async () => {
  const dir = await edgarDir();
  const p = join(dir, 'sources', 'edgar', 'state.json');
  const st = readJson(p); st.outcomes.push({ cik: '1000009', company: 'Example 2021-C9 Commercial Mortgage Trust', outcome: 'not_cmbs' }); st.counts.filings++; writeJson(p, st);
  const r = byId(await verifyEdgar({ dir, sec: { ...SEC_CFG, userAgent: rules.config.sec.userAgent }, fetchImpl: fakeSec().fetchImpl }));
  assert.equal(r['edgar.accounted'].ok, false);
  assert.equal(r['edgar.accounted'].detail.doubtful[0].cik, '1000009');
  assert.equal(r['edgar.parse'].ok, false); assert.match(r['edgar.parse'].summary, /placeholder/);
});
