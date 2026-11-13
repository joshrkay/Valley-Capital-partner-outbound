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
  for (const r of t.financials) { r.NCRECONR = (r.NCRECONS / r.LNRECONS) * 100; r.LNLSGR = 50000; r.NCLNLSR = (r.NCLNLS / 50000) * 100; r.LNCDT1R = Math.round((r.LNRECONS / r.RBCT1J) * 10000) / 100; }
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
  assert.match(byId(r)['fdic.ratios'].summary, /agree with FDIC's own .*construction to tier 1 capital, LNCDT1R/);
  for (const id of ['fdic.concentration', 'fdic.failures', 'fdic.failures-index', 'fdic.events']) assert.ok(byId(r)[id], id);
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

test('FDIC: a failure missing from /failures is a WARNING that FDIC\'s index is behind, not a failure of ours', async () => {
  const dir = await pulled();
  const r = byId(await vf(dir));
  const w = r['fdic.failures-index'];
  assert.equal(w.ok, true);
  assert.equal(w.warn, true);
  assert.match(w.summary, /^1 failure\(s\) in \/institutions or \/history is missing from \/failures: FDIC's \/failures index is behind \(built 2026-08-25\)/);
  assert.deepEqual(w.detail.missingFromFailures, [{ cert: '99999', institutions: '2026-09-25', history: '2026-09-25' }]);
  assert.equal(r['fdic.failures'].ok, true, r['fdic.failures'].summary);
  assert.match(r['fdic.failures'].summary, /All 2 failures FDIC shows since 2023-11-13 .* are in our record; 2 had a presence in the six metros/);
  // Once FDIC rebuilds /failures, the warning goes.
  const t = tables(); t.failures.push({ CERT: 99999, NAME: 'EXAMPLE BANK', FAILDATE: '9/25/2026', RESTYPE: 'FAILURE' });
  const caughtUp = byId(await vf(dir, t))['fdic.failures-index'];
  assert.equal(caughtUp.warn, undefined);
  assert.match(caughtUp.summary, /lists every failure that \/institutions and \/history show/);
});

test('FDIC: a failure or a deal FDIC shows that our records lack fails, naming it', async () => {
  const dir = await pulled();
  const failed = readJson(fdicPaths(dir).failed); delete failed['99999']; writeJson(fdicPaths(dir).failed, failed);
  const events = readJson(fdicPaths(dir).events); events['2026000998'].effective = '2026-07-01'; writeJson(fdicPaths(dir).events, events);
  const r = byId(await vf(dir));
  assert.equal(r['fdic.failures'].ok, false);
  assert.deepEqual(r['fdic.failures'].detail.missing, ['99999']);
  assert.equal(r['fdic.events'].ok, false);
  assert.deepEqual(r['fdic.events'].detail.first[0], { transnum: '2026000998', acquirerCert: '101', targetCert: '998', effective: '2026-06-01', ours: { acquirerCert: '101', targetCert: '998', effective: '2026-07-01' } });
});

test('FDIC: the concentration screen\'s fields: a CBLR flag that contradicts RBC, a wrong growth base, or a wrong tier 1 field fails', async () => {
  const dir = await pulled();
  assert.equal(byId(await vf(dir))['fdic.concentration'].ok, true);
  const f = join(dir, 'sources', 'fdic', 'financials', '101.json');
  const fin = readJson(f);
  fin.quarters['20260630'].CBLRIND = 1;   // a CBLR bank that reports total risk-based capital: the denominator rule would be wrong
  fin.growthBase['20230630'].LNCOMRE += 1;
  fin.quarters['20260630'].RBCT1J += 50;
  writeJson(f, fin);
  const r = byId(await vf(dir));
  assert.equal(r['fdic.concentration'].ok, false);
  assert.deepEqual(r['fdic.concentration'].detail.denominator, [{ cert: '101', CBLRIND: 1, RBC: 135 }]);
  assert.deepEqual(r['fdic.concentration'].detail.growthBase.map((d) => d.field), ['LNCOMRE']);
  assert.ok(r['fdic.ratios'].detail.first.some((d) => d.cert === '101' && d.ratio === 'construction to tier 1 capital'));
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
