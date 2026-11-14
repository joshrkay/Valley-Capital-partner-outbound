// The paper estimate on the candidate page (PRD E14-S1): the record is read through the PostgREST document reads with the principal's
// token, and every value is displayed with its tier and date. Invented banks and numbers only; no network, no browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fakePostgrest } from '../../test/postgrest-fake.mjs';
import { platformClient } from '../../src/platform/client.mjs';
import { buildPaper, paperRel, paperValues } from '../../src/paper.mjs';
import { show, at, usd, inUnit, shareText, pointText, sourcesText, dateOf, STATUS_LABELS, PAPER_CONTEXT } from '../lib/paper-view.mjs';
import * as ops from '../lib/ops.mjs';

const URL_ = 'https://example-project.supabase.test';
const Q = (over = {}) => ({
  LNRECONS: 100000, LNRECNOT: 70000, LNRECNFM: 30000, LNREMULT: 300000, LNRENRES: 600000, LNRENROW: 200000, LNRENROT: 400000, LNCOMRE: 20000,
  P3RECONS: 1500, P9RECONS: 300, NARECONS: 1000, P3REMULT: 4000, P9REMULT: 1000, NAREMULT: 10000, P3RENROT: 4000, P9RENROT: 1500, NARENROT: 6000,
  P3RENROW: 2000, P9RENROW: 500, NARENROW: 2000, P3COMRE: 0, ORECONS: 500, OREMULT: 1000, ORENRES: 1500, NTRECONQ: 10, NTREMULQ: 300, NTRENRSQ: 200,
  LNRENR1: 5000, LNRENR2: 15000, LNRENR3: 80000, LNRENR4: 100000, LNRENR1N: 90, LNRENR2N: 100, LNRENR3N: 150, LNRENR4N: 340,
  UCCOMRES: 45000, UCCOMREU: 500, RSCONS: 700, RSMULT: 900, RSNRES: 1100, RSOTHER: 300, NARSNRES: 400, RSLNLTOT: 3500,
  LNLSSALE: 2500, NALNSALE: 0, P9LNSALE: 0, P3LNSALE: 0, NETGNSLN: 75, NTGLLNQ: 40,
  LNOT3LES: 400000, LNOT3T12: 300000, LNOT1T3: 500000, LNOT3T5: 350000, LNOT5T15: 250000, LNOTOV15: 50000, ...over,
});
const record = () => buildPaper({ cert: '1', name: 'Alpha Example Bank', financials: { CERT: '1', quarters: { 20260331: { REPDTE: '20260331', ...Q() }, 20260630: { REPDTE: '20260630', ...Q() } } },
  footprint: { branchesByMetro: { 38060: 4 }, sod: { year: 2026, depositsByMetro: { 38060: 600000 }, totalDeposits: 1000000 }, _source: { fetchedAt: '2026-11-13T12:00:00Z' } },
  buybox: { sectors: { include: ['hospitality', 'multifamily', 'retail'] }, metros: ['38060'], loanSize: { minUsd: '[CONFIRM]', maxUsd: '[CONFIRM]' } }, placeholders: ['loanSize.minUsd', 'loanSize.maxUsd'],
  metros: { metros: [{ cbsa: '38060', label: 'Phoenix' }] }, runId: 'score-1' });

test('every number shows its tier and as-of date; a gap shows its status, never a zero', () => {
  const r = record();
  let numbers = 0;
  for (const { path, v } of paperValues(r)) {
    const s = show(v);
    if (s.gap) { assert.ok(Object.values(STATUS_LABELS).includes(s.text), `${path}: ${s.text}`); assert.doesNotMatch(s.text, /\d/, path); continue; }
    numbers++;
    assert.ok(/^(reported|observed|inferred)( bounds)?$/.test(s.tier), `${path}: tier ${s.tier}`);
    assert.match(s.date, /(January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, \d{4}/, `${path}: date`);
    assert.ok(s.title.length > 0, `${path}: no sources to hover`);
  }
  assert.ok(numbers > 60, `${numbers}`);
  assert.deepEqual(show(r.q1.investorCre), { text: '$820.0M', gap: false, tier: 'reported', date: 'June 30, 2026', title: show(r.q1.investorCre).title });
  assert.match(show(r.q1.investorCre).title, /LNRECONS, June 30, 2026 \(sources\/fdic\/financials\/1\.json\)/);
  const ns = r.q1.categories.find((c) => c.id === 'notSecuredByRealEstate').stages.nonaccrual.amount;
  assert.deepEqual([show(ns).text, show(ns).gap], ['not reported', true]);
  const mf = r.q7.sectors.find((s) => s.sector === 'multifamily').bounds;
  assert.deepEqual([show(mf).text, show(mf).tier], ['$0 to $300.0M', 'inferred bounds']);
  const ytd = r.q1.categories[1].chargeOffs.yearToDate;
  assert.equal(show(ytd).date, 'year to date to June 30, 2026');
});

test('formatting: dollars, counts, shares, intervals, dates and trend points', () => {
  assert.equal(usd(1234567890), '$1.23B'); assert.equal(usd(812345678), '$812.3M'); assert.equal(usd(42000.4), '$42,000'); assert.equal(usd(-2500000), '−$2.5M'); assert.equal(usd(null), '–');
  assert.equal(inUnit(340, 'count'), '340'); assert.equal(inUnit(0.6, 'pct'), '60.0%');
  assert.equal(shareText({ low: 0, high: 0.6 }), '0.0% to 60.0%'); assert.equal(shareText({ low: 0.3, high: 0.3 }), '30.0%');
  assert.equal(dateOf('2025-12-31'), 'December 31, 2025'); assert.equal(dateOf(null), '');
  assert.equal(pointText({ netChange: null, netChangeStatus: 'structure-event' }, 'netChange'), 'withheld (structure event)');
  assert.equal(pointText({ netChange: 10000000 }, 'netChange'), '$10.0M');
  assert.equal(sourcesText({ sources: [{ field: 'LNREMULT', file: 'sources/fdic/financials/1.json', repdte: '20260630' }] }), 'LNREMULT, June 30, 2026 (sources/fdic/financials/1.json)');
  const r = record();
  for (const s of r.summary) assert.ok(at(r, s.ref)?.unit, s.ref);
  assert.match(PAPER_CONTEXT, /never goes in a message/);
});

test('the candidate page reads its paper record through the PostgREST document reads, as the signed-in principal', async () => {
  const fake = fakePostgrest();
  const pat = platformClient({ url: URL_, key: 'anon-key', accessToken: 'user:pat@example.test', fetchImpl: fake.fetchImpl });
  const item = { key: 'fdic:1', cert: '1', name: 'Alpha Example Bank', tier: 'A', score: 90, axes: { distress: 30, fit: 25, timing: 10 }, metros: ['38060'], sectors: ['multifamily'], filtersFailed: [], signals: [], profile: { categories: [] }, latestRepdte: '20260630', card: null };
  await pat.flush({ docs: [{ path: 'candidates/latest.json', kind: 'json', body: { runId: 'score-1', provisional: true, items: [item] }, baseVersion: 0 },
    { path: paperRel('fdic:1'), kind: 'json', body: record(), baseVersion: 0 }, { path: 'paper/fdic-2.json', kind: 'json', body: { key: 'fdic:2' }, baseVersion: 0 }], lines: [] });
  fake.calls.length = 0;
  const d = await ops.candidateDetail(pat, 'fdic:1');
  assert.equal(d.paper.key, 'fdic:1');
  assert.equal(d.paper.q4.under1m.count.value, 340);
  const docReads = fake.calls.filter((c) => c.path === 'documents');
  assert.ok(docReads.length && docReads.every((c) => c.caller === 'principal'), 'read with the principal\'s token, never a service key');
  assert.ok(docReads.every((c) => !String(c.query.or).includes('paper/fdic-2') && !String(c.query.or).includes('"paper/*"')), 'only this bank\'s record is loaded');
  // A bank scored before E14-S1 has no record yet: the page says so instead of failing.
  await pat.flush({ docs: [{ path: 'candidates/latest.json', kind: 'json', body: { runId: 'score-2', items: [item, { ...item, key: 'fdic:3', cert: '3' }] }, baseVersion: 1 }], lines: [] });
  assert.equal((await ops.candidateDetail(pat, 'fdic:3')).paper, null);
  // Someone signed in who is not a principal reads nothing.
  const stranger = platformClient({ url: URL_, key: 'anon-key', accessToken: 'user:stranger@example.test', fetchImpl: fake.fetchImpl });
  assert.equal(await ops.candidateDetail(stranger, 'fdic:1'), null);
});

test('the page component renders from the record only, keeps the house style and carries no secret', () => {
  const src = readFileSync(new URL('../app/candidates/[key]/paper-estimate.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /'use client'|process\.env|SERVICE|fetch\(|dangerouslySetInnerHTML/, 'a server component with no secrets, fetches or raw HTML');
  for (const h of ['Summary', 'Q1.', 'Q2.', 'Q3.', 'Q4.', 'Q5.', 'Q6.', 'Q7.', 'Q8.', 'The tape request']) assert.ok(src.includes(h), h);
  assert.ok(src.indexOf('Summary') < src.indexOf('Q1.') && src.indexOf('Q8.') < src.indexOf('The tape request'), 'summary first; unknowns and the tape request last');
  assert.ok(src.includes('c.share.tier') && src.includes('s.unknownConditions'), 'Q7 shows each condition\'s tier, and the conditions that cannot be measured');
  const mf = record().q7.sectors.find((s) => s.sector === 'multifamily');
  assert.deepEqual(mf.unknownConditions.map((u) => u.id), ['size', 'status', 'lien', 'exclusions'], 'what the page lists to say why the floor is 0');
  const page = readFileSync(new URL('../app/candidates/[key]/page.jsx', import.meta.url), 'utf8');
  assert.match(page, /<PaperEstimate paper=\{paper\} \/>/);
});
