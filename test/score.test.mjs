// Scoring, axes, tiers, filters and the paper profile (PRD E0-S1, E6-S2, E6-S6). Invented banks and numbers only; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeDir, put, loadJson } from './kit.mjs';
import { validateBuybox, validateScoring, runScoring, scoreBank, tierFor, buildProfile, findPlaceholders, contentHash, AXES } from '../src/score.mjs';

const metros = loadJson('metros.json');
const scoring = () => structuredClone(loadJson('scoring.json'));
const shippedBuybox = () => structuredClone(loadJson('buybox.json'));
const filledBuybox = (over = {}) => ({ ...shippedBuybox(), sectors: { include: ['hospitality', 'multifamily', 'retail'], shortTermRentalPortfolios: 'out' }, loanSize: { minUsd: 1000000, maxUsd: 25000000 }, statuses: ['non-performing'], lien: 'first', exclusions: ['ground-up construction'], ...over });

const REPS = ['20240930', '20241231', '20250331', '20250630', '20250930', '20251231', '20260331', '20260630'];
const Q = (over = {}) => ({
  ASSET: 3000000, LNLSNET: 2000000, LNRECONS: 100000, LNREMULT: 300000, LNRENRES: 600000, LNRENROW: 200000, LNRENROT: 400000,
  NCRECONS: 2000, NCREMULT: 15000, NCRENRES: 12000, NCRENROW: 3000, NCRENROT: 9000, NARECONS: 1000, NAREMULT: 10000, NARENRES: 8000,
  P3RENRES: 6000, P3REMULT: 4000, P9RENRES: 2000, P9REMULT: 1000, ORE: 4000, ORECONS: 500, OREMULT: 1000, ORENRES: 1500,
  NTRECONQ: 0, NTREMULQ: 300, NTRENRSQ: 200, NTLNLSQ: 600, ...over,
});
const src = (period) => ({ source: 'fdic', endpoint: '/test', query: {}, recordId: 'invented', period, fetchedAt: '2026-11-13T00:00:00Z', runId: 'test-run' });
const quarters = (fn = () => ({})) => Object.fromEntries(REPS.map((r, i) => [r, { REPDTE: r, ...Q(fn(i)), _source: src(r) }]));

// Writes an invented world into sources/fdic/ per PRD Appendix C.
function world(banks) {
  const dir = makeDir();
  const inst = {}; const fp = {};
  for (const b of banks) {
    inst[b.cert] = { CERT: b.cert, NAME: b.name, CITY: 'Anytown', STALP: 'AZ', ASSET: b.ASSET ?? 3000000, ACTIVE: b.ACTIVE ?? 1, via: b.via ?? { branch: true, hq: false }, inUniverse: b.inUniverse ?? true, status: b.status ?? 'active', _source: src('') };
    fp[b.cert] = { branchesByMetro: b.branches ?? { 38060: 4 }, sod: b.sod === undefined ? { year: 2026, depositsByMetro: { 38060: 600000 }, totalDeposits: 1000000, metroShare: 0.6 } : b.sod, _source: src('2026') };
    if (b.quarters !== null) put(dir, `sources/fdic/financials/${b.cert}.json`, { CERT: b.cert, quarters: b.quarters ?? quarters() });
  }
  put(dir, 'sources/fdic/institutions.json', inst);
  put(dir, 'sources/fdic/footprint.json', fp);
  return dir;
}
const NOW = new Date('2026-11-13T12:00:00Z');
const score = (dir, opts = {}) => runScoring({ dir, buybox: opts.buybox ?? filledBuybox(), scoring: opts.scoring ?? scoring(), metros, now: NOW, ...opts });
const rising = (i) => ({ NCREMULT: 5000 + i * 2500, NCRENRES: 6000 + i * 1500, P3REMULT: 3000 + i * 200, NTREMULQ: i === 7 ? 300 : 0, NTRENRSQ: 0 });

test('the shipped buy box has placeholders and no errors; a filled one passes; bad metros are errors', () => {
  const v = validateBuybox(shippedBuybox(), { metros });
  assert.deepEqual(v.errors, []);
  for (const p of ['sectors.shortTermRentalPortfolios', 'loanSize.minUsd', 'loanSize.maxUsd', 'statuses', 'lien', 'exclusions[0]']) assert.ok(v.placeholders.includes(p), p);
  assert.equal(v.ok, false);
  assert.equal(validateBuybox(filledBuybox(), { metros }).ok, true);
  assert.match(validateBuybox(filledBuybox({ metros: ['99999'] }), { metros }).errors.join(), /99999 is not in metros.json/);
  assert.match(validateBuybox(filledBuybox({ metros: [38060] }), { metros }).errors.join(), /not a 5-digit CBSA code string/);
  assert.deepEqual(findPlaceholders({ _note: '[CONFIRM: ignored]', a: ['ok', '[CONFIRM]'] }), ['a[1]']);
});

test('the shipped scoring config is valid; every component has an axis; Tier A needs distress and fit thresholds', () => {
  const s = scoring();
  assert.deepEqual(validateScoring(s).errors, []);
  for (const c of s.components) assert.ok(AXES.includes(c.axis), c.id);
  const bad = scoring(); bad.components[0].axis = 'vibes';
  assert.match(validateScoring(bad).errors.join(), /axis must be one of/);
  const noFit = scoring(); delete noFit.tiers.A.fit;
  assert.match(validateScoring(noFit).errors.join(), /Tier A needs both/);
  assert.equal(s.requirePilotPass, undefined, 'the pilot gate lives in config.json, not here');
});

test('scoring refuses a buy box with placeholders; --draft-buybox output is marked provisional and hashed', () => {
  const dir = world([{ cert: '1', name: 'Alpha Example Bank' }]);
  assert.throws(() => score(dir, { buybox: shippedBuybox() }), /\[CONFIRM\] placeholders[\s\S]*loanSize\.minUsd/);
  const out = score(dir, { buybox: shippedBuybox(), allowPlaceholders: true });
  assert.equal(out.provisional, true);
  assert.ok(out.placeholders.includes('lien'));
  const filled = score(dir);
  assert.equal(filled.provisional, false);
  assert.equal(filled.buyboxHash, contentHash(filledBuybox()));
  assert.notEqual(out.buyboxHash, filled.buyboxHash);
  assert.equal(filled.scoringHash, contentHash(scoring()));
  const saved = JSON.parse(readFileSync(join(dir, 'candidates', 'latest.json'), 'utf8'));
  assert.equal(saved.runId, filled.runId);
  assert.throws(() => runScoring({ dir: makeDir(), buybox: filledBuybox(), scoring: scoring(), metros, now: NOW }), /No FDIC data yet/);
});

test('the same inputs always give the same scores, axes, profiles and cards', () => {
  const dir = world([{ cert: '1', name: 'Alpha Example Bank', quarters: quarters(rising) }, { cert: '2', name: 'Beta Example Bank' }]);
  const a = score(dir); const b = score(dir);
  assert.deepEqual(a.items, b.items);
});

test('axes add up to the score, and every component with a value names the fields, dates and values behind it', () => {
  const dir = world([{ cert: '1', name: 'Alpha Example Bank', quarters: quarters(rising) }]);
  const it = score(dir).items[0];
  const sum = AXES.reduce((s, ax) => s + it.axes[ax], 0);
  assert.ok(Math.abs(sum - it.score) < 0.02, `${sum} vs ${it.score}`);
  for (const ax of AXES) assert.ok(Math.abs(it.axes[ax] - it.components.filter((c) => c.axis === ax).reduce((s, c) => s + c.points, 0)) < 0.02, ax);
  for (const c of it.components) {
    assert.ok(AXES.includes(c.axis), c.id);
    if (c.value === null) { assert.ok(c.missing, `${c.id} is null without a reason`); assert.equal(c.points, 0); continue; }
    assert.ok(c.inputs.length, `${c.id} has no inputs`);
    for (const x of c.inputs) assert.ok(x.field && x.repdte && typeof x.value === 'number', `${c.id}: ${JSON.stringify(x)}`);
  }
});

test('Tier A needs the score AND distress AND fit; either alone gives Tier B at most', () => {
  const tiers = scoring().tiers;
  assert.equal(tierFor({ score: 80, axes: { distress: 40, fit: 30, timing: 10 }, filtersFailed: [], tiers }).tier, 'A');
  const distressOnly = tierFor({ score: 60, axes: { distress: 45, fit: 5, timing: 10 }, filtersFailed: [], tiers });
  assert.equal(distressOnly.tier, 'B'); assert.match(distressOnly.note, /fit 5 is below 15/);
  const fitOnly = tierFor({ score: 50, axes: { distress: 5, fit: 30, timing: 15 }, filtersFailed: [], tiers });
  assert.equal(fitOnly.tier, 'B'); assert.match(fitOnly.note, /distress 5 is below 15/);
  assert.equal(tierFor({ score: 10, axes: { distress: 5, fit: 5, timing: 0 }, filtersFailed: [], tiers }).tier, null);
  assert.equal(tierFor({ score: 99, axes: { distress: 45, fit: 30, timing: 24 }, filtersFailed: ['failed bank'], tiers }).tier, null);
});

test('end to end: a distressed bank whose paper the buy box does not buy is not Tier A', () => {
  // Same distressed data. The second buy box buys multifamily only (30% of this book) and only in Austin, where the bank has no
  // branches or deposits; a principal opted it in by headquarters state.
  const dir = world([{ cert: '1', name: 'Alpha Example Bank', quarters: quarters(rising) }]);
  const fits = score(dir).items[0];
  assert.equal(fits.tier, 'A', fits.tierNote);
  const noFitBox = filledBuybox({ sectors: { include: ['multifamily'], shortTermRentalPortfolios: 'out' }, metros: ['12420'] });
  const dir2 = world([{ cert: '1', name: 'Alpha Example Bank', quarters: quarters(rising), via: { branch: false, hq: true }, sod: { year: 2026, depositsByMetro: { 38060: 600000 }, totalDeposits: 1000000 } }]);
  const noFit = score(dir2, { buybox: noFitBox }).items[0];
  assert.ok(noFit.axes.distress >= scoring().tiers.A.distress, 'still distressed');
  assert.ok(noFit.axes.fit < scoring().tiers.A.fit, `fit ${noFit.axes.fit}`);
  assert.notEqual(noFit.tier, 'A');
});

test('hard filters: failed, inactive, left the list, over the asset cap, outside the metros, no latest report', () => {
  const dir = world([
    { cert: '1', name: 'Failed Example Bank', status: 'failed', ACTIVE: 0, quarters: quarters(rising) },
    { cert: '2', name: 'Closed Example Bank', status: 'inactive', ACTIVE: 0 },
    { cert: '3', name: 'Gone Example Bank', inUniverse: false },
    { cert: '4', name: 'Big Example Bank', ASSET: 50000000, quarters: quarters(() => ({ ASSET: 50000000 })) },
    { cert: '5', name: 'Elsewhere Example Bank', branches: { 99999: 3 } },
    { cert: '6', name: 'Opted In Example Bank', branches: {}, via: { branch: false, hq: true } },
    { cert: '7', name: 'Late Example Bank', quarters: Object.fromEntries(Object.entries(quarters()).filter(([r]) => r !== '20260630')) },
    { cert: '8', name: 'Empty Example Bank', quarters: null },
  ]);
  const by = Object.fromEntries(score(dir).items.map((i) => [i.cert, i]));
  assert.deepEqual(by['1'].filtersFailed.slice(0, 1), ['failed bank']);
  assert.equal(by['1'].tier, null, 'a failed bank is never a candidate tier, however distressed');
  assert.match(by['2'].filtersFailed.join(), /no longer active \(status: inactive\)/);
  assert.match(by['3'].filtersFailed.join(), /no longer in the market bank list/);
  assert.match(by['4'].filtersFailed.join(), /above the cap/);
  assert.match(by['5'].filtersFailed.join(), /no branch in a buy-box metro/);
  assert.deepEqual(by['6'].filtersFailed, [], 'a principal opted this headquarters-state bank in');
  assert.match(by['7'].filtersFailed.join(), /no report for the latest quarter \(June 30, 2026\)/);
  assert.match(by['8'].filtersFailed.join(), /no financial data/);
  for (const c of ['1', '2', '3', '4', '5', '7', '8']) assert.equal(by[c].tier, null, c);
});

test('the paper profile: categories with balances, shares, every stage, direction, split and fit, each number with its field and date', () => {
  const fin = { CERT: '1', quarters: quarters(rising) };
  const p = buildProfile({ financials: fin, footprint: { branchesByMetro: { 38060: 12, 29820: 3 }, sod: { year: 2026, depositsByMetro: { 38060: 600000, 29820: 100000 }, totalDeposits: 1000000 } }, institution: { via: { branch: true } }, buybox: filledBuybox(), metros, scoring: scoring() });
  assert.equal(p.period, '20260630');
  assert.deepEqual(p.categories.map((c) => c.id), ['construction', 'multifamily', 'nonfarmNonresidential']);
  const mf = p.categories.find((c) => c.id === 'multifamily');
  assert.deepEqual(mf.balance, { field: 'LNREMULT', repdte: '20260630', value: 300000 });
  assert.equal(mf.shareOfCre.value, 0.3);
  assert.deepEqual(Object.keys(mf.stages), ['pastDue30to89', 'pastDue90', 'nonaccrual', 'noncurrent', 'oreo', 'chargeOffsQuarter']);
  assert.deepEqual(mf.stages.noncurrent, { field: 'NCREMULT', repdte: '20260630', value: 22500, ratio: 22500 / 300000 });
  assert.equal(mf.direction4q.direction, 'rising');
  assert.equal(mf.direction4q.from.repdte, '20250630');
  assert.deepEqual(mf.fit, { buys: true, sectors: ['multifamily'], reason: 'the buy box buys multifamily loans in the bank\'s metros' });
  const nf = p.categories.find((c) => c.id === 'nonfarmNonresidential');
  assert.deepEqual(nf.fit.sectors, ['hospitality', 'retail']);
  assert.match(nf.fit.reason, /cannot say how much/);
  assert.deepEqual(nf.split.map((s) => [s.id, s.balance.field, s.noncurrent.field]), [['ownerOccupied', 'LNRENROW', 'NCRENROW'], ['other', 'LNRENROT', 'NCRENROT']]);
  const cons = p.categories.find((c) => c.id === 'construction');
  assert.equal(cons.fit.buys, false); assert.equal(cons.fit.reason, 'not a buy-box sector');
  assert.equal(cons.stages.pastDue30to89.field, null); assert.match(cons.stages.pastDue30to89.note, /no field/);
  for (const c of p.categories) for (const [k, s] of Object.entries(c.stages)) if (s.field) assert.ok(s.repdte === '20260630' && typeof s.value === 'number', `${c.id}.${k}`);
  assert.ok(p.limits.some((l) => /hotel and retail/i.test(l) && /cannot separate/.test(l)), 'says hotel and retail cannot be separated');
  assert.ok(p.limits.some((l) => /no individual loans, loan sizes, maturities/.test(l)));
  const phx = p.footprint.metros.find((m) => m.cbsa === '38060');
  assert.equal(phx.label, 'Phoenix'); assert.equal(phx.branches.value, 12); assert.equal(phx.depositShare, 0.6);
  assert.deepEqual(phx.deposits, { field: 'DEPSUMBR', repdte: '20260630', value: 600000 });
  assert.equal(p.footprint.buyboxDepositShare, 0.7);
  const noMf = buildProfile({ financials: fin, footprint: { branchesByMetro: { 38060: 1 } }, buybox: filledBuybox({ sectors: { include: ['hospitality'], shortTermRentalPortfolios: 'out' } }), metros });
  assert.deepEqual(noMf.categories.find((c) => c.id === 'multifamily').fit, { buys: false, sectors: [], reason: 'the buy box does not include multifamily' });
});

test('a missing or incomplete Summary of Deposits leaves fit on branches only, and says so', () => {
  const fin = { CERT: '1', quarters: quarters() };
  const none = buildProfile({ financials: fin, footprint: { branchesByMetro: { 38060: 2 }, sod: null }, buybox: filledBuybox(), metros });
  assert.equal(none.footprint.buyboxDepositShare, null);
  assert.match(none.footprint.note, /No Summary of Deposits on file; fit rests on branches only/);
  const broken = buildProfile({ financials: fin, footprint: { branchesByMetro: { 38060: 2 }, sod: { year: 2026, depositsByMetro: { 38060: 400 }, totalDeposits: 0 } }, buybox: filledBuybox(), metros });
  assert.equal(broken.footprint.buyboxDepositShare, null);
  assert.match(broken.footprint.note, /incomplete/);
  assert.equal(broken.categories.find((c) => c.id === 'multifamily').fit.buys, true, 'branches still establish the metro');
  const dir = world([{ cert: '1', name: 'Alpha Example Bank', sod: null }]);
  const c = score(dir).items[0].components.find((x) => x.id === 'metroDepositShare');
  assert.equal(c.value, null); assert.equal(c.points, 0); assert.match(c.missing, /branches only/);
});

test('scoreBank never names a model and does not read the clock', () => {
  const args = { cert: '1', institution: { NAME: 'Alpha Example Bank', ACTIVE: 1, status: 'active' }, footprint: { branchesByMetro: { 38060: 1 } }, financials: { CERT: '1', quarters: quarters(rising) }, scoring: scoring(), buybox: filledBuybox(), metros, latestRepdte: '20260630' };
  assert.deepEqual(scoreBank(args), scoreBank(structuredClone(args)));
});

// ---- Signal kinds, the concentration screen and structure events (PRD E3-S5 to S7) -----------------------------------------------
test('every signal type in the shipped config declares its kind, and the kind must match how it is computed', () => {
  const s = scoring();
  for (const r of s.signals) assert.equal(r.kind, 'state', r.id);
  assert.deepEqual(s.concentration.signals.map((r) => [r.id, r.kind]), [['concentration-construction', 'state'], ['concentration-cre', 'state']]);
  assert.deepEqual(s.structureEvents.signals.map((r) => [r.id, r.kind, r.windowQuarters]), [['acquired-metro-bank', 'event', 4]]);
  assert.match(s.structureEvents._note, /PLACEHOLDER/);
  assert.match(s.concentration._note, /UNCONFIRMED/);
  const noKind = scoring(); delete noKind.signals[0].kind;
  assert.match(validateScoring(noKind).errors.join(), /cre-noncurrent-rising: kind must be "state" \(got none\)/);
  const wrong = scoring(); wrong.concentration.signals[0].kind = 'event';
  assert.match(validateScoring(wrong).errors.join(), /concentration-construction: kind must be "state"/);
  const asState = scoring(); asState.structureEvents.signals[0].kind = 'state';
  assert.match(validateScoring(asState).errors.join(), /acquired-metro-bank: kind must be "event"/);
  const dup = scoring(); dup.concentration.signals[0].id = 'cre-noncurrent-rising';
  assert.match(validateScoring(dup).errors.join(), /duplicated/);
  const bad = scoring(); bad.structureEvents.signals[0].windowQuarters = 0; bad.structureEvents.signals[0].kinds = ['takeover']; bad.concentration.signals[1].growthThreshold = undefined;
  assert.equal(validateScoring(bad).errors.length, 3);
});

// Capital and CRE for the screen. Q() gives construction 100,000, multifamily 300,000, other nonfarm nonresidential 400,000.
const capital = (over = {}) => ({ RBC: 250000, RBCT1J: 230000, LNATRES: 20000, CBLRIND: 0, LNCOMRE: 50000, ...over });
const withBase = (qs, base = { LNRECONS: 60000, LNREMULT: 200000, LNRENROT: 250000, LNCOMRE: 20000 }) => ({ CERT: '1', quarters: qs, growthBase: { 20230630: { REPDTE: '20230630', ...base, _source: src('20230630') } } });

test('the paper profile shows the screen\'s ratios, each with its fields, dates and the denominator it used', () => {
  const fin = withBase(quarters(() => capital()));
  const p = buildProfile({ financials: fin, footprint: { branchesByMetro: { 38060: 1 } }, institution: { via: { branch: true } }, buybox: filledBuybox(), metros, scoring: scoring() });
  const c = p.concentration;
  assert.equal(c.period, '20260630');
  assert.match(c.note, /unconfirmed/);
  assert.deepEqual([c.denominator.basis, c.denominator.label, c.denominator.value], ['totalRiskBasedCapital', 'total risk-based capital', 250000]);
  assert.equal(c.constructionToCapital.value, 0.4);
  assert.equal(c.constructionToCapital.denominator, 'total risk-based capital');
  assert.equal(c.creToCapital.value, 850000 / 250000);
  assert.equal(c.creToCapital.denominator, 'total risk-based capital');
  assert.ok(Math.abs(c.creGrowth36m.value - (850000 - 530000) / 530000) < 1e-12);
  assert.deepEqual([c.creGrowth36m.from.repdte, c.creGrowth36m.to.repdte], ['20230630', '20260630']);
  for (const x of [...c.denominator.inputs, ...c.constructionToCapital.inputs, ...c.creToCapital.inputs, ...c.creGrowth36m.from.inputs]) assert.ok(x.field && /^\d{8}$/.test(x.repdte) && typeof x.value === 'number', JSON.stringify(x));
  assert.deepEqual(c.screen, { construction: { threshold: 1, meets: false }, cre: { threshold: 3, growthThreshold: 0.5, meets: true } });
  const cblr = buildProfile({ financials: withBase(quarters(() => capital({ CBLRIND: 1, RBC: 0 }))), footprint: {}, buybox: filledBuybox(), metros, scoring: scoring() }).concentration;
  assert.equal(cblr.denominator.basis, 'tier1PlusAllowance');
  assert.match(cblr.constructionToCapital.denominator, /^tier 1 capital plus the allowance for credit losses/);
  assert.equal(cblr.constructionToCapital.value, 100000 / 250000);
});

test('end to end: an acquisition is an EVENT signal kept for its window; the screen is a STATE signal recomputed each quarter', () => {
  const dir = world([{ cert: '1', name: 'Alpha Example Bank', quarters: withBase(quarters(() => capital({ LNRECONS: 300000 }))).quarters }]);
  put(dir, 'sources/fdic/financials/1.json', withBase(quarters(() => capital({ LNRECONS: 300000 }))));
  put(dir, 'sources/fdic/events.json', { 2026000777: { transnum: '2026000777', code: 223, kind: 'merger', label: 'Merger - Without Assistance', effective: '2026-06-01', acquirerCert: '1', targetCert: '777', acquirerOnOurList: true, targetOnOurList: false, targetInMetros: true, targetMetros: [{ cbsa: '38060', branches: 4, basis: ['branches in the FDIC structure event'] }], targetLastCre: { repdte: '20260331', value: 64000, fields: {} }, _source: src('2026-06-01') } });
  const it = score(dir).items[0];
  const byType = Object.fromEntries(it.signals.map((s) => [s.type, s]));
  assert.equal(byType['acquired-metro-bank'].kind, 'event');
  assert.deepEqual(byType['acquired-metro-bank'].metros, [{ cbsa: '38060', branches: 4, basis: ['branches in the FDIC structure event'], label: 'Phoenix' }]);
  assert.equal(byType['concentration-construction'].kind, 'state');
  assert.equal(byType['concentration-construction'].value, 300000 / 250000);
  // The card states both from its templates.
  const text = it.card.text;
  assert.match(text, /Construction and land loans are 120% of total risk-based capital, at or above the 100% concentration screen \(June 30, 2026\)\./);
  assert.match(text, /The concentration screen follows the 2006 interagency guidance as we understand it; its definition is not yet confirmed/);
  assert.match(text, /It acquired another bank \(FDIC cert 777\) with 4 branches in Phoenix, effective June 1, 2026\. That bank held \$64\.0 million of CRE loans at its last report \(March 31, 2026\)\./);
  // A new quarter below the screen: the state signal is gone. The acquisition is still shown: its window has not ended.
  const f = readFileSync(join(dir, 'sources', 'fdic', 'financials', '1.json'), 'utf8');
  const next = JSON.parse(f); next.quarters['20260930'] = { ...next.quarters['20260630'], REPDTE: '20260930', LNRECONS: 50000, _source: src('20260930') };
  put(dir, 'sources/fdic/financials/1.json', next);
  const later = runScoring({ dir, buybox: filledBuybox(), scoring: scoring(), metros, now: new Date('2027-02-15T12:00:00Z') }).items[0];
  assert.ok(!later.signals.some((s) => s.type === 'concentration-construction'), 'a state signal drops away when its condition ends');
  assert.ok(later.signals.some((s) => s.id === byType['acquired-metro-bank'].id), 'an event signal keeps its id and stays within its window');
  const after = runScoring({ dir, buybox: filledBuybox(), scoring: scoring(), metros, now: new Date('2027-06-02T12:00:00Z') }).items[0];
  assert.ok(!after.signals.some((s) => s.type === 'acquired-metro-bank'), 'after 4 quarters the event is no longer a signal');
});

test('failed banks in the metros are listed beside the candidates, never as candidates, with the FDIC as seller', () => {
  const dir = world([{ cert: '1', name: 'Alpha Example Bank' }]);
  const rec = (cert, failedOn, inMetros) => ({ cert, name: 'Example Bank', failedOn, agree: ['institutions', 'history'], missingFrom: ['failures'], acquirerCert: '555', inMetros, metros: inMetros ? [{ cbsa: '31080', branches: 1, basis: ['main office'] }] : [], lastCre: null, seller: 'FDIC', loanSales: 'https://www.fdic.gov/resources/resolutions/asset-sales/loan-sales', _source: src(failedOn) });
  put(dir, 'sources/fdic/failed.json', { 99999: rec('99999', '2026-09-25', true), 88888: rec('88888', '2026-08-01', false), 77777: rec('77777', '2023-01-10', true) });
  const out = score(dir);
  assert.deepEqual(out.failedBanks.map((f) => f.cert), ['99999'], 'only those with a presence in the metros, within the window');
  const f = out.failedBanks[0];
  assert.deepEqual([f.key, f.seller, f.loanSales, f.metros[0].label, f.missingFrom[0]], ['fdic:99999', 'FDIC', 'https://www.fdic.gov/resources/resolutions/asset-sales/loan-sales', 'Los Angeles', 'failures']);
  assert.ok(!out.items.some((i) => i.cert === '99999'));
});
