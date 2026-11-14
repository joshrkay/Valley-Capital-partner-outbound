// The who-sells-to-whom ledger (PRD E16): every source's events, de-duplication across runs, a liquidated loan kept after it leaves the
// report, the kind rules, the recovery math, the views, the signals, the shapes of the later sources, and the drafter handoff.
// Invented trusts, banks, loans and people only; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeDir, put, account, SENDER } from './kit.mjs';
import { loadRules } from '../src/rules.mjs';
import { readJson, readJsonl } from '../src/store.mjs';
import { runEdgar, edgarPaths, CMBS_NS } from '../src/sources/edgar.mjs';
import { runFdicSales } from '../src/sources/fdicsales.mjs';
import { confirmFiler, rejectFiler } from '../src/sources/filers.mjs';
import { indexUrl } from '../src/sources/filings.mjs';
import { padCik } from '../src/sources/efts.mjs';
import { buildDraftPrompt } from '../src/draft.mjs';
import {
  buildLedger, salesPaths, readLedger, validateEvent, impliedRecovery, RECOVERY_LABEL, salesBySeller, saleSignals, knownBuyers, priceEvidence, salesList,
  FEEDERS, assignmentEvent, listingEvent, resolveParty, chainToCurrentHolder, servicerKey, verifyLedger, UNKNOWN,
} from '../src/sales.mjs';
import { fakeSec, prop } from './edgar-fake.mjs';
import { fakeFdicWww } from './fdicsales-fake.mjs';

const rules = loadRules();
const NOW = new Date('2026-11-13T12:00:00Z');
const SEC_CFG = { ...rules.config.sec, userAgent: 'Example Firm ops@example.test', minIntervalMs: 0, knownSpecialServicers: ['Example Special Servicing LLC'] };
const SS = servicerKey('Example Special Servicing LLC');

// ---- CMBS fixtures: one loan record per asset, in the EX-102 form ----------------------------------------------------------------
const loanXml = (n, p, { period = '10-13-2026', balance = '0.00', begin = null, extra = '' } = {}) => `<assets><assetTypeNumber>Prospectus Loan ID</assetTypeNumber><assetNumber>${n}</assetNumber><reportingPeriodBeginningDate>09-12-2026</reportingPeriodBeginningDate><reportingPeriodEndDate>${period}</reportingPeriodEndDate><originatorName>Example Originating Bank</originatorName><originationDate>10-14-2021</originationDate><originalLoanAmount>25000000.00</originalLoanAmount><originalTermLoanNumber>120</originalTermLoanNumber><maturityDate>11-06-2031</maturityDate>${begin ? `<reportPeriodBeginningScheduleLoanBalanceAmount>${begin}</reportPeriodBeginningScheduleLoanBalanceAmount>` : ''}<reportPeriodEndActualBalanceAmount>${balance}</reportPeriodEndActualBalanceAmount><paymentStatusLoanCode>3</paymentStatusLoanCode><mostRecentSpecialServicerTransferDate>01-05-2026</mostRecentSpecialServicerTransferDate>${extra}${prop(p)}</assets>`;
const ex102 = (...assets) => `<?xml version="1.0"?><assetData xmlns="${CMBS_NS}">${assets.join('\n')}</assetData>`;
const LA_MF = { name: 'Example Garden Apartments', city: 'Los Angeles', state: 'CA', zip: '90012', county: 'Los Angeles', type: 'MF' };
const PHX_LO = { name: 'Example Desert Inn', city: 'Phoenix', state: 'AZ', zip: '85004', county: 'Maricopa', type: 'LO' };
const DEN_RT = { name: 'Example Mesa Center', city: 'Aurora', state: 'CO', zip: '80012', county: 'Arapahoe', type: 'RT' };
const SD_MF = { name: 'Example Bayview Flats', city: 'San Diego', state: 'CA', zip: '92101', county: 'San Diego', type: 'MF' };
const BOS_LO = { name: 'Example Harbor Hotel', city: 'Boston', state: 'MA', zip: '2110', county: 'Suffolk', type: 'LO' };
const liq = (code, date, loss) => `<liquidationPrepaymentCode>${code}</liquidationPrepaymentCode><liquidationPrepaymentDate>${date}</liquidationPrepaymentDate>${loss === undefined ? '' : `<realizedLossToTrustAmount>${loss}</realizedLossToTrustAmount>`}`;
// September: loan 6 coded for a note sale, others in special servicing. October: four liquidations (and one outside the market).
const SEPT = ex102(
  loanXml(1, LA_MF, { period: '09-13-2026', balance: '24100000.00', extra: '<workoutStrategyCode>7</workoutStrategyCode>' }),
  loanXml(6, DEN_RT, { period: '09-13-2026', balance: '9000000.00', extra: '<workoutStrategyCode>5</workoutStrategyCode><workoutStrategyCode>2</workoutStrategyCode>' }),
  loanXml(7, SD_MF, { period: '09-13-2026', balance: '5000000.00', extra: '<workoutStrategyCode>2</workoutStrategyCode>' }),
);
const OCT = ex102(
  loanXml(1, LA_MF, { begin: '24100000.00', extra: `${liq(3, '10-01-2026', '6025000.00')}<workoutStrategyCode>7</workoutStrategyCode>` }),      // disposition, 75% recovery
  loanXml(5, PHX_LO, { begin: '12000000.00', extra: `${liq(6, '10-05-2026', '0.00')}<workoutStrategyCode>6</workoutStrategyCode>` }),             // DPO, zero loss reported
  loanXml(6, DEN_RT, { begin: '9000000.00', extra: `${liq(3, '10-07-2026', '-4500000.00')}<workoutStrategyCode>8</workoutStrategyCode>` }),       // note sale earlier in its history
  loanXml(7, SD_MF, { extra: `${liq(3, '10-09-2026')}<workoutStrategyCode>2</workoutStrategyCode>` }),                                           // no loss reported, no beginning balance
  loanXml(8, LA_MF, { begin: '3000000.00', extra: `${liq(3, '10-10-2026', '600000.00')}<workoutStrategyCode>5</workoutStrategyCode>` }),           // note sale in the current report
  loanXml(9, BOS_LO, { begin: '7000000.00', extra: liq(3, '10-02-2026', '100.00') }),                                                             // outside the metros: never an event
  loanXml(10, LA_MF, { begin: '2000000.00', balance: '1500000.00', extra: liq(1, '10-03-2026') }),                                               // a curtailment: not a sale, loan stays
);
const NOV = ex102(loanXml(10, LA_MF, { period: '11-13-2026', balance: '1500000.00' }));   // the liquidated loans have left the report
const cmbsRun = (dir, xml, now = NOW) => runEdgar({ dir, metros: rules.metros, buybox: rules.buybox, scoring: rules.scoring, sec: SEC_CFG, fetchImpl: fakeSec({ ex102: xml }).fetchImpl, now, sleep: async () => {} });
const build = (dir, over = {}) => buildLedger({ dir, config: rules.config, now: NOW, ...over });

async function cmbsLedger() {
  const dir = makeDir();
  assert.equal((await cmbsRun(dir, SEPT, new Date('2026-10-20T12:00:00Z'))).outcome, 'ok');
  const oct = await cmbsRun(dir, OCT);
  assert.equal(oct.outcome, 'ok', JSON.stringify(oct));
  return { dir, oct };
}

test('the CMBS adapter stores the liquidation fields, the full workout list and the originator, and checks them as optional', async () => {
  const { dir, oct } = await cmbsLedger();
  const loans = readJson(edgarPaths(dir).loans);
  const l = loans['cmbs:1000001:6'];
  assert.deepEqual([l.liquidationPrepayment, l.liquidationPrepaymentDate, l.realizedLossToTrust, l.beginningScheduledBalance], [{ code: '3', label: 'Disposition/liquidation' }, '2026-10-07', -4500000, 9000000]);
  assert.deepEqual([l.originator, l.originated, l.originalBalance, l.originalTermMonths], ['Example Originating Bank', '2021-10-14', 25000000, 120]);
  assert.deepEqual(l.workoutHistory.map((w) => [w.code, w.firstSeen]), [['2', '2026-09-13'], ['5', '2026-09-13'], ['8', '2026-10-13']], 'the note-sale code seen in September is remembered');
  assert.deepEqual(readJson(edgarPaths(dir).state).fieldCoverage.absent.realizedLossToTrustAmount, 2, 'the loan with no loss reported, and the curtailment');
  assert.equal(oct.dispositions, 5); assert.equal(oct.dispositionsNew, 5);
  assert.deepEqual([loans['cmbs:1000001:10'].paidOff, loans['cmbs:1000001:1'].paidOff], [false, true], 'a curtailment is not a payoff');
  const runLog = readFileSync(join(dir, 'sources', 'runs.jsonl'), 'utf8');
  for (const name of ['Example Garden Apartments', 'Example Desert Inn', 'Example Mesa Center']) assert.ok(!runLog.includes(name), `run log names ${name}`);
});

test('note sale, DPO and disposition: the kind follows the code and the loan\'s workout history', async () => {
  const { dir } = await cmbsLedger();
  const r = build(dir);
  assert.equal(r.outcome, 'ok', JSON.stringify(r));
  const ev = readLedger(dir).events;
  assert.equal(ev['cmbs-liquidation:1000001:1'].kind, 'disposition');
  assert.match(ev['cmbs-liquidation:1000001:1'].note, /REO property or a foreclosure, not a note sale/);
  assert.equal(ev['cmbs-liquidation:1000001:5'].kind, 'dpo');
  assert.equal(ev['cmbs-liquidation:1000001:6'].kind, 'note_sale_completed', 'workout 5 in an earlier report');
  assert.equal(ev['cmbs-liquidation:1000001:8'].kind, 'note_sale_completed', 'workout 5 in the same report');
  assert.equal(ev['cmbs-liquidation:1000001:7'].kind, 'disposition');
  assert.equal(ev['cmbs-liquidation:1000001:9'], undefined, 'Boston is not a buy-box metro');
  assert.equal(ev['cmbs-liquidation:1000001:10'], undefined, 'a curtailment is not a sale');
  const e = ev['cmbs-liquidation:1000001:1'];
  assert.deepEqual([e.date, e.seller.kind, e.seller.key, e.seller.via.key, e.seller.via.name, e.buyer, e.tier], ['2026-10-01', 'trust', 'cmbs-trust:1000001', SS, 'Example Special Servicing LLC', { kind: 'unknown', name: 'unknown' }, 'reported']);
  assert.deepEqual([e.asset.kind, e.asset.propertyType, e.asset.metro, e.asset.balance, e.asset.county], ['loan', 'Multifamily', '31080', 24100000, 'Los Angeles']);
  assert.equal(e.asset.properties[0].name, 'Example Garden Apartments', 'the property name is kept in the ledger, for a principal');
  assert.equal(e.sources[0].link, 'https://www.sec.gov/Archives/edgar/data/1000001/000999999926000102/exh_102.xml');
  assert.deepEqual(r.byKind, { disposition: 2, dpo: 1, note_sale_completed: 2 });
});

test('the recovery math: 1 − loss ÷ balance, labelled approximate, with zero, missing, negative and oversized losses', async () => {
  assert.deepEqual(impliedRecovery({ balance: 24100000, loss: 6025000 }), { value: 0.75, approximate: true, label: RECOVERY_LABEL });
  assert.equal(impliedRecovery({ balance: 1000, loss: 0 }).value, 1);
  assert.match(impliedRecovery({ balance: 1000, loss: 0 }).note, /zero loss/);
  assert.deepEqual(impliedRecovery({ balance: 1000, loss: null }), { value: null, approximate: true, label: RECOVERY_LABEL, reason: 'no realized loss reported' });
  assert.equal(impliedRecovery({ balance: 1000, loss: undefined }).reason, 'no realized loss reported');
  assert.equal(impliedRecovery({ balance: 0, loss: 10 }).reason, 'no balance before liquidation');
  assert.equal(impliedRecovery({ balance: null, loss: 10 }).value, null);
  assert.deepEqual([impliedRecovery({ balance: 1000, loss: -250 }).value, impliedRecovery({ balance: 1000, loss: -250 }).lossReportedNegative], [0.75, true]);
  assert.deepEqual([impliedRecovery({ balance: 1000, loss: 1200 }).value, impliedRecovery({ balance: 1000, loss: 1200 }).lossExceedsBalance], [-0.2, true]);
  assert.match(RECOVERY_LABEL, /Approximate.*NOT the sale price/);

  const { dir } = await cmbsLedger();
  build(dir);
  const ev = readLedger(dir).events;
  const pe = (n) => ev[`cmbs-liquidation:1000001:${n}`].priceEvidence;
  assert.deepEqual([pe(1).impliedRecovery.value, pe(1).balanceBeforeLiquidation.field, pe(1).isPrice], [0.75, 'reportPeriodBeginningScheduleLoanBalanceAmount', false]);
  assert.equal(pe(5).impliedRecovery.value, 1, 'a DPO with zero loss reported');
  assert.deepEqual([pe(6).impliedRecovery.value, pe(6).impliedRecovery.lossReportedNegative], [0.5, true]);
  assert.deepEqual([pe(7).balanceBeforeLiquidation.value, pe(7).balanceBeforeLiquidation.field, pe(7).impliedRecovery.value, pe(7).impliedRecovery.reason], [5000000, 'reportPeriodEndActualBalanceAmount, previous report', null, 'no realized loss reported'], 'no beginning balance: the previous report\'s balance, and no loss: no recovery');
  const pr = priceEvidence({ dir });
  assert.equal(pr.label, RECOVERY_LABEL);
  const laMf = pr.groups.find((g) => g.propertyType === 'Multifamily' && g.metro === '31080');
  assert.deepEqual([laMf.events, laMf.withRecovery, laMf.impliedRecovery.value, laMf.impliedRecovery.approximate, laMf.min, laMf.max], [2, 2, round(1 - 6625000 / 27100000), true, 0.75, 0.8]);
  const sd = pr.groups.find((g) => g.metro === '41740');
  assert.deepEqual([sd.events, sd.withRecovery, sd.impliedRecovery.value], [1, 0, null]);
});
const round = (x) => Math.round(x * 10000) / 10000;

test('a liquidated loan is kept after it leaves the report, and rebuilding twice changes nothing', async () => {
  const { dir } = await cmbsLedger();
  const first = build(dir);
  const ids = Object.keys(readLedger(dir).events).sort();
  const firstSeen = readLedger(dir).events['cmbs-liquidation:1000001:1'].firstSeenAt;
  const nov = await cmbsRun(dir, NOV, new Date('2026-11-20T12:00:00Z'));   // the fake's filing (2026-10-28) is still in the window
  assert.equal(nov.outcome, 'ok');
  assert.equal(readJson(edgarPaths(dir).loans)['cmbs:1000001:1'], undefined, 'the loan is gone from the loans');
  assert.ok(readJson(edgarPaths(dir).dispositions)['cmbs-liquidation:1000001:1'], 'its disposition is kept');
  const second = build(dir, { now: new Date('2026-12-14T00:00:00Z') });
  assert.deepEqual(Object.keys(readLedger(dir).events).sort(), ids);
  assert.deepEqual([first.added, second.added, second.changed, second.unsupported], [5, 0, 0, 0]);
  assert.equal(readLedger(dir).events['cmbs-liquidation:1000001:1'].firstSeenAt, firstSeen, 'first seen stays the first build');
  assert.equal(readLedger(dir).events['cmbs-liquidation:1000001:1'].supported, true);
  // The same report read twice is one event, not two.
  await cmbsRun(dir, OCT); build(dir);
  assert.equal(Object.keys(readLedger(dir).events).length, 5);
});

// ---- SEC, FDIC structure events, FDIC announcements ------------------------------------------------------------------------------
const filing = (acc, { form = '8-K', fileDate = '2026-10-02', items = [], searches, cik = '9900101' }) => ({ key: `sec:${acc}`, accession: acc, form, rootForm: form, fileDate, items, searches, filerCiks: [padCik(cik)], filerNames: ['EXAMPLE HOLDING CORP'], cik: padCik(cik), link: indexUrl(cik, acc), documents: [], kind: 'event', contextOnly: true, firstSeenAt: '2026-10-03T00:00:00.000Z', _source: { source: 'filings', endpoint: 'x', query: {}, recordId: acc, period: fileDate, fetchedAt: '2026-10-03T00:00:00.000Z', runId: 'r1' } });
function otherSources(dir) {
  put(dir, 'sources/fdic/institutions.json', { 101: { NAME: 'Example Hill Bank' }, 201: { NAME: 'Example Buyer Bank' }, 202: { NAME: 'Example Target Bank' }, 204: { NAME: 'Example Sister Bank' } });
  put(dir, 'sources/fdic/failed.json', { 203: { cert: '203', name: 'Example Failed Bank', state: 'AZ', city: 'Sampleton', failedOn: '2026-09-25', inMetros: true, metros: [{ cbsa: '38060' }] } });
  const ev = (transnum, kind, over) => ({ transnum, code: { merger: 223, failure: 211, 'affiliate-reorganization': 224 }[kind], kind, label: kind, effective: '2026-06-01', acquirerCert: '201', targetCert: '202', targetMetros: [{ cbsa: '38060', branches: 4, basis: ['branches in our last footprint'] }], targetInMetros: true, targetLastCre: { repdte: '20260331', value: 150000, fields: {} }, ...over });
  put(dir, 'sources/fdic/events.json', {
    7001: ev('7001', 'merger', {}),
    7002: ev('7002', 'affiliate-reorganization', { targetCert: '204' }),                     // inside one holding company: left out
    7003: ev('7003', 'merger', { targetCert: '205', targetInMetros: false, targetMetros: [] }),   // no presence in our metros: left out
    7004: ev('7004', 'failure', { targetCert: '203', effective: '2026-09-25', targetLastCre: null }),
  });
  confirmFiler({ dir, bank: 'fdic:101', cik: '9900101', by: 'Pat Example', now: NOW });
  put(dir, 'sources/edgar/filings.json', {
    '0009900101-26-000001': filing('0009900101-26-000001', { items: ['2.01'], searches: ['8k-acquisition'] }),
    '0009900101-26-000002': filing('0009900101-26-000002', { form: '10-Q', fileDate: '2026-11-05', searches: ['loan-sale-cre', 'transferred-held-for-sale-cre'] }),
    '0009900101-26-000003': filing('0009900101-26-000003', { items: ['2.06'], searches: ['8k-impairment'] }),                        // not a sale
  });
}

test('SEC: a bank filing with Item 2.01 or a loan-sale hit is a disclosed sale, seller by fdic:CERT, buyer unknown, the link kept', () => {
  const dir = makeDir(); otherSources(dir);
  assert.equal(build(dir).outcome, 'ok');
  const sec = salesList({ dir, kind: 'bank_disclosed_sale' });
  assert.deepEqual(sec.map((e) => e.id), ['sec-sale:0009900101-26-000002:fdic:101', 'sec-sale:0009900101-26-000001:fdic:101']);
  const e = sec[1];
  assert.deepEqual([e.seller, e.buyer, e.asset.kind, e.tier, e.date], [{ kind: 'bank', key: 'fdic:101', name: 'Example Hill Bank' }, { kind: 'unknown', name: 'unknown' }, 'unknown', 'reported', '2026-10-02']);
  assert.equal(e.sources[0].link, 'https://www.sec.gov/Archives/edgar/data/9900101/000990010126000001/0009900101-26-000001-index.htm');
  assert.match(e.note, /may have bought, not sold/);
  assert.deepEqual(sec[0].filing.searches, ['loan-sale-cre'], 'only the searches that count as a sale');
  assert.ok(!JSON.stringify(readLedger(dir)).includes('impairment'));
});

test('a mapping rejected since keeps the event in the ledger, marked unsupported, and out of every view and signal', () => {
  const dir = makeDir(); otherSources(dir);
  build(dir);
  rejectFiler({ dir, bank: 'fdic:101', cik: '9900101', by: 'Pat Example', reason: 'a different company', now: NOW });
  const r = build(dir);
  assert.equal(r.unsupported, 2);
  const e = readLedger(dir).events['sec-sale:0009900101-26-000001:fdic:101'];
  assert.deepEqual([e.supported, typeof e.unsupportedSince], [false, 'string']);
  assert.equal(salesList({ dir, kind: 'bank_disclosed_sale' }).length, 0);
  assert.equal(saleSignals({ dir })['fdic:101'], undefined);
  confirmFiler({ dir, bank: 'fdic:101', cik: '9900101', by: 'Pat Example', now: NOW });
  build(dir);
  assert.deepEqual([readLedger(dir).events['sec-sale:0009900101-26-000001:fdic:101'].supported, readLedger(dir).events['sec-sale:0009900101-26-000001:fdic:101'].unsupportedSince], [true, undefined]);
});

test('whole-bank acquisitions: the acquirer is a known buyer by FDIC cert; a failed bank is sold by the FDIC as receiver', () => {
  const dir = makeDir(); otherSources(dir);
  build(dir);
  const ev = readLedger(dir).events;
  const m = ev['fdic-deal:7001'];
  assert.deepEqual([m.kind, m.date, m.seller, m.buyer], ['whole_bank_acquisition', '2026-06-01', { kind: 'bank', key: 'fdic:202', name: 'Example Target Bank' }, { kind: 'bank', key: 'fdic:201', name: 'Example Buyer Bank' }]);
  assert.deepEqual([m.asset.kind, m.asset.metro, m.asset.balance], ['bank', '38060', 150000000]);
  assert.match(m.asset.balanceBasis, /thousands × 1,000/);
  assert.equal(ev['fdic-deal:7002'], undefined, 'an affiliate reorganization is not a sale');
  assert.equal(ev['fdic-deal:7003'], undefined, 'no presence in our metros');
  const f = ev['fdic-deal:7004'];
  assert.deepEqual([f.seller.kind, f.seller.key, f.seller.receivershipOf.key, f.buyer.key, f.asset.balance], ['fdic', 'fdic-receiver', 'fdic:203', 'fdic:201', null]);
  const buyers = knownBuyers({ dir });
  assert.deepEqual(buyers.map((b) => [b.key, b.total, b.byKind, b.byMetro, b.byPeriod]), [['fdic:201', 2, { whole_bank_acquisition: 2 }, { 38060: 2 }, { '2026-Q2': 1, '2026-Q3': 1 }]]);
});

test('FDIC announcements: the sale enters the ledger with the receivership matched, the pool, the PDF date, and the buyer unknown', async () => {
  const dir = makeDir(); otherSources(dir);
  put(dir, 'sources/fdic/failed.json', { 9001: { cert: '9001', name: 'Example Prairie Bank', city: 'Sampleton', state: 'AZ', failedOn: '2026-09-25', inMetros: true, metros: [{ cbsa: '38060' }] } });
  const r = await runFdicSales({ dir, fdic: { ...rules.config.fdic, userAgent: 'Example Firm ops@example.test', minIntervalMs: 0 }, personalDomains: [], fetchImpl: fakeFdicWww().fetchImpl, now: NOW, sleep: async () => {} });
  assert.equal(r.outcome, 'ok');
  build(dir);
  const e = readLedger(dir).events['fdic-sale:EXB2-26'];
  assert.deepEqual([e.kind, e.date, e.dateBasis, e.seller.key, e.seller.receiverships[0].key, e.buyer.kind], ['fdic_sale_announced', '2026-10-14', 'announcement date (the announcement PDF)', 'fdic-receiver', 'fdic:9001', 'unknown']);
  assert.deepEqual([e.asset.kind, e.asset.balance, e.asset.loans, e.sale.keyDates.bidDeadline, e.sale.advisor], ['pool', 41512300, 312, '2026-12-02', 'Example Loan Advisors']);
  assert.deepEqual(e.sources.map((s) => s.link), ['https://www.fdic.gov/asset-sales/events/exb2-26-sale-announcement', 'https://www.fdic.gov/asset-sales/exb2-26-loan-sale-announcement.pdf']);
  assert.ok(!JSON.stringify(e).includes('Pat Person'));
});

// ---- Views and signals -----------------------------------------------------------------------------------------------------------
async function everything() {
  const { dir } = await cmbsLedger();
  otherSources(dir);
  assert.equal(build(dir).outcome, 'ok');
  return dir;
}

test('salesBySeller: who has sold before, by the institution that acted, with counts by kind and the latest date', async () => {
  const dir = await everything();
  const s = salesBySeller({ dir });
  const ss = s.find((x) => x.key === SS);
  assert.deepEqual([ss.kind, ss.name, ss.total, ss.counts, ss.latest], ['servicer', 'Example Special Servicing LLC', 5, { disposition: 2, dpo: 1, note_sale_completed: 2 }, '2026-10-10']);
  assert.equal(ss.events.length, 5);
  const bank = s.find((x) => x.key === 'fdic:101');
  assert.deepEqual([bank.counts, bank.latest], [{ bank_disclosed_sale: 2 }, '2026-11-05']);
  assert.deepEqual(s.find((x) => x.key === 'fdic-receiver').counts, { whole_bank_acquisition: 1 });
  assert.ok(!s.some((x) => x.kind === 'unknown'), 'an unnamed seller is not a seller anyone can approach');
  assert.deepEqual(s.map((x) => x.latest), [...s.map((x) => x.latest)].sort().reverse(), 'newest first');
  assert.equal(salesList({ dir, seller: SS }).length, 5);
  assert.equal(salesList({ dir, seller: 'cmbs-trust:1000001' }).length, 5);
});

test('saleSignals: event signals by fdic:CERT or servicer key, shaped like filingSignals, from fixed templates with no names', async () => {
  const dir = await everything();
  const sig = saleSignals({ dir });
  assert.deepEqual(Object.keys(sig).sort(), ['fdic:101', 'fdic:202', SS].sort(), 'the FDIC as receiver and a CMBS trust are not institutions we approach');
  for (const list of Object.values(sig)) for (const s of list) {
    assert.deepEqual(Object.keys(s).sort(), ['date', 'evidence', 'firstSeenAt', 'id', 'key', 'kind', 'label', 'link', 'period', 'role', 'saleKind', 'source', 'tier', 'type']);
    assert.deepEqual([s.kind, s.type, s.source, s.role], ['event', 'sale', 'sales', 'seller']);
    assert.match(s.id, /^sale:/); assert.match(s.date, /^\d{4}-\d{2}-\d{2}$/); assert.equal(s.period, s.date);
    assert.ok(!/Example|Apartments|Inn|Center|Flats|Trust/.test(s.label), s.label);
  }
  assert.deepEqual(sig[SS].map((s) => s.saleKind), ['note_sale_completed', 'disposition', 'note_sale_completed', 'dpo', 'disposition']);
  assert.equal(sig[SS][0].label, 'A CMBS loan it special-services was liquidated after a note-sale workout (reported 2026-10-10)');
  assert.equal(sig['fdic:202'][0].label, 'Was acquired by FDIC cert 201, effective 2026-06-01');
  assert.equal(sig['fdic:101'][0].label, 'An SEC filing disclosed a completed sale or disposition (10-Q, filed 2026-11-05)');
  assert.deepEqual(sig['fdic:101'][1].evidence, ['sec-sale:0009900101-26-000001:fdic:101']);
});

test('the ledger refuses an invented buyer, a recovery without its label, and MERS as a party; a bad input field fails the build', () => {
  const ok = { id: 'x:1', kind: 'bank_disclosed_sale', date: '2026-10-01', seller: { kind: 'bank', key: 'fdic:1', name: 'Example Bank' }, buyer: { ...UNKNOWN }, asset: { kind: 'unknown', propertyType: null, metro: null, balance: null }, tier: 'reported', sources: [{ source: 'filings', ids: ['a'], link: null, date: '2026-10-01' }] };
  assert.deepEqual(validateEvent(ok), []);
  assert.match(validateEvent({ ...ok, buyer: { kind: 'bank', key: 'fdic:2', name: 'Example Buyer' } }).join(), /must be unknown/);
  assert.match(validateEvent({ ...ok, priceEvidence: { isPrice: false, impliedRecovery: { value: 0.7 } } }).join(), /approximate/);
  assert.match(validateEvent({ ...ok, seller: { kind: 'other', name: 'Mortgage Electronic Registration Systems, Inc.' } }).join(), /MERS is a nominee/);
  assert.match(validateEvent({ ...ok, date: '10/01/2026', tier: 'guessed', sources: [] }).join(), /date must be YYYY-MM-DD.*tier must be.*sources: at least one/);
  const dir = makeDir();
  put(dir, 'sources/edgar/dispositions.json', { bad: { key: 'cmbs-liquidation:1:1', cik: '1', trust: 'T', liquidation: { code: '3' } } });
  const r = build(dir);
  assert.equal(r.outcome, 'failed');
  assert.match(r.missingFields[0], /assetNumber/);
  assert.equal(readJson(salesPaths(dir).ledger, null), null, 'nothing written');
  const bad = build(dir, { feeders: [{ source: 'test', build: () => ({ events: [{ ...ok, buyer: { kind: 'bank', name: 'Invented Buyer' } }] }) }] });
  assert.equal(bad.outcome, 'failed'); assert.equal(bad.invalid.length, 1);
});

// ---- The later sources: shapes only --------------------------------------------------------------------------------------------
test('MERS is a nominee, never a party; the chain runs from the deed of trust to the current holder, gaps and nominees marked', () => {
  assert.deepEqual(resolveParty('Mortgage Electronic Registration Systems, Inc., as nominee for Example Lender Bank, its successors and assigns'), { kind: 'other', name: 'Example Lender Bank', nominee: 'MERS' });
  assert.deepEqual(resolveParty('MERS'), { kind: 'unknown', name: 'unknown', nominee: 'MERS', note: 'MERS is a nominee, not a party, and the document does not name the lender it acts for' });
  const kindOf = (n) => (n === 'Example Lender Bank' ? { kind: 'bank', key: 'fdic:301' } : null);
  assert.deepEqual(resolveParty('Example Lender Bank', { kindOf }), { kind: 'bank', key: 'fdic:301', name: 'Example Lender Bank' });
  assert.deepEqual(resolveParty('Example Note Fund LLC'), { kind: 'other', name: 'Example Note Fund LLC' });

  const dot = { recordingNumber: '2021-0001', beneficiary: 'MERS as nominee for Example Lender Bank' };
  const clean = chainToCurrentHolder({ deedOfTrust: dot, kindOf, assignments: [
    { recordingNumber: '2026-0200', date: '2026-08-01', assignor: 'Example Note Fund LLC', assignee: 'Example Credit Partners LP' },
    { recordingNumber: '2026-0100', date: '2026-05-01', assignor: 'MERS as nominee for Example Lender Bank', assignee: 'Example Note Fund LLC' },
  ] });
  assert.deepEqual([clean.certain, clean.currentHolder.name, clean.chain.map((s) => s.recordingNumber)], [true, 'Example Credit Partners LP', ['2026-0100', '2026-0200']], 'oldest first');
  const gap = chainToCurrentHolder({ deedOfTrust: dot, kindOf, assignments: [{ recordingNumber: '2026-0300', date: '2026-09-01', assignor: 'Example Other Holder LLC', assignee: 'Example Note Fund LLC' }] });
  assert.deepEqual([gap.certain, gap.chain[0].gap], [false, true], 'the assignor is not the holder of record: an unrecorded transfer');
  const nominee = chainToCurrentHolder({ deedOfTrust: dot, kindOf, assignments: [{ recordingNumber: '2026-0400', date: '2026-09-01', assignor: 'Example Lender Bank', assignee: 'MERS' }] });
  assert.deepEqual([nominee.certain, nominee.currentHolder.key, nominee.chain[0].nomineeOnly], [false, 'fdic:301', true], 'to MERS with no lender named: the holder stays, uncertain');
});

test('the ledger accepts the assignment and listing shapes (fixtures for the later county and listing feeds)', () => {
  const kindOf = (n) => (n === 'Example Lender Bank' ? { kind: 'bank', key: 'fdic:301' } : null);
  const assignment = assignmentEvent({
    county: '04013', recordingNumber: '20260512345', recordedOn: '2026-09-15', apn: '123-45-678', source: 'county:maricopa', link: null, propertyType: 'Retail', metro: '38060', kindOf,
    deedOfTrust: { recordingNumber: '20210000123', recordedOn: '2021-03-01', originalPrincipal: 4200000, beneficiary: 'Mortgage Electronic Registration Systems, Inc., as nominee for Example Lender Bank' },
    assignor: 'Mortgage Electronic Registration Systems, Inc., as nominee for Example Lender Bank', assignee: 'Example Note Fund LLC',
  });
  const listing = listingEvent({ site: 'example-loan-exchange', listingId: 'L-778', listedOn: '2026-11-02', title: 'Example retail note, Phoenix', link: 'https://loans.example.test/l/778', advisor: 'Example Loan Advisors', propertyType: 'Retail', metro: '38060', balance: 3100000, loans: 1, status: 'non-performing', bidDate: '2026-12-01' });
  assert.deepEqual(validateEvent(assignment), []); assert.deepEqual(validateEvent(listing), []);
  assert.deepEqual([assignment.seller, assignment.buyer, assignment.tier, assignment.assignment.chainCertain], [{ kind: 'bank', key: 'fdic:301', name: 'Example Lender Bank', nominee: 'MERS' }, { kind: 'other', name: 'Example Note Fund LLC' }, 'observed', true]);
  assert.deepEqual([listing.seller, listing.buyer, listing.asset.kind, listing.tier], [{ kind: 'unknown', name: 'unknown' }, { kind: 'unknown', name: 'unknown' }, 'loan', 'observed']);
  const dir = makeDir();
  const r = build(dir, { feeders: [...FEEDERS, { source: 'later', build: () => ({ events: [assignment, listing] }) }] });
  assert.equal(r.outcome, 'ok', JSON.stringify(r));
  assert.deepEqual(r.byKind, { assignment: 1, marketed_listing: 1 });
  assert.deepEqual(salesBySeller({ dir }).map((s) => [s.key, s.counts]), [['fdic:301', { assignment: 1 }]], 'the listing has no named seller');
  assert.deepEqual(knownBuyers({ dir }).map((b) => [b.kind, b.name, b.byPropertyType, b.byMetro]), [['other', 'Example Note Fund LLC', { Retail: 1 }, { 38060: 1 }]]);
  assert.equal(saleSignals({ dir })['fdic:301'][0].saleKind, 'assignment');
  assert.deepEqual(verifyLedger({ dir }).checks.map((c) => [c.id, c.ok]), [['sales.events', true], ['sales.no-invention', true], ['sales.context', true]]);
});

test('verify: every event valid, no invented buyer or price, and no property name in the run or change log', async () => {
  const dir = await everything();
  const v = verifyLedger({ dir });
  assert.ok(v.checks.every((c) => c.ok), JSON.stringify(v.checks));
  assert.match(v.checks.find((c) => c.id === 'sales.context').summary, /none appears in the run or change log/);
  // A changed property name is logged as changed, without its value.
  const p = edgarPaths(dir).dispositions;
  const d = readJson(p);
  d['cmbs-liquidation:1000001:1'].properties[0].name = 'Example Renamed Apartments';
  put(dir, 'sources/edgar/dispositions.json', d);
  build(dir);
  const changes = readFileSync(join(dir, 'sources', 'changes.jsonl'), 'utf8');
  assert.ok(!changes.includes('Example Renamed Apartments') && !changes.includes('Example Garden Apartments'), 'no property name in the change log');
  assert.ok(readJsonl(join(dir, 'sources', 'changes.jsonl')).some((c) => c.key === 'cmbs-liquidation:1000001:1' && c.field === 'asset'));
});

test('the drafter never sees a sale: no event, signal, label, seller, buyer, property, price or source reaches it', async () => {
  const dir = await everything();
  const signals = [...(saleSignals({ dir })['fdic:101'] ?? [])];
  const sellers = salesBySeller({ dir });
  const pipeline = { key: 'fdic:101', period: '20260630', tier: 'A', leadSector: 'multifamily', leadSectorOptions: [], signals, sales: sellers.find((s) => s.key === 'fdic:101'), profile: null };
  const a = account({ originSignals: signals.map((s) => s.id), sectors: ['multifamily'], pipeline });
  const { system, user } = buildDraftPrompt({ account: a, channel: 'email', step: 2, sender: SENDER, facts: [], claims: rules.claims, priorTouches: [], rules });
  const drafter = system + user;
  const ledger = readLedger(dir);
  const leaks = [
    ...Object.keys(ledger.events), ...signals.flatMap((s) => [s.id, s.label, s.link]),
    'Example Garden Apartments', 'Example Desert Inn', 'Example Mesa Center', 'Example Special Servicing', 'Example Commercial Mortgage Trust', 'Example Buyer Bank', 'Example Target Bank',
    'note sale', 'note-sale', 'DPO', 'disposition', 'liquidat', 'recovery', 'sec-sale', 'fdic-deal', '0009900101-26',
  ];
  for (const leak of leaks) assert.ok(!drafter.includes(leak), `drafter input leaked "${leak}"`);
  assert.match(user, /"sector":"multifamily"/);
});
