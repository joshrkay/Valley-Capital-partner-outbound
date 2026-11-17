// The bank page's logic (docs/design-redesign.md, 5.3), lib/bank-view.mjs, against a candidate item and a paper record the engine itself
// builds from invented figures. Checks that the page picks and joins stored figures and never adds one. No network, no browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scoreBank } from '../../src/score.mjs';
import { buildPaper } from '../../src/paper.mjs';
import {
  TABS, tabOf, answerSentence, answerText, facts, holdingRows, ladderScale, rangeAxis, withoutBoilerplate, whyLines, stageOf, fitRanges, bestFit,
  trendSeries, whereRows, scoreParts, componentValue, soldItems, aboutDate, routeWords, STAGE_PATH,
} from '../lib/bank-view.mjs';

const load = (f) => JSON.parse(readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8'));
const metros = load('metros.json'), scoring = load('scoring.json'), buybox = load('buybox.json');
const REPS = ['20240930', '20241231', '20250331', '20250630', '20250930', '20251231', '20260331', '20260630'];
const Q = (i) => ({
  ASSET: 3000000, LNLSNET: 2000000, LNRECONS: 100000, LNRECNOT: 70000, LNRECNFM: 30000, LNREMULT: 300000, LNRENRES: 600000, LNRENROW: 200000, LNRENROT: 400000, LNCOMRE: 20000,
  NCRECONS: 2000, NCREMULT: 5000 + i * 2500, NCRENRES: 6000 + i * 1500, NCRENROW: 3000, NCRENROT: 9000, NARECONS: 1000, NAREMULT: 10000, NARENRES: 8000, NARENROT: 6000, NARENROW: 2000,
  P3RENRES: 6000, P3REMULT: 3000 + i * 200, P9RENRES: 2000, P9REMULT: 1000, P3RECONS: 1500, P9RECONS: 300, P3RENROT: 4000, P9RENROT: 1500, P3RENROW: 2000, P9RENROW: 500,
  ORE: 4000, ORECONS: 500, OREMULT: 1000, ORENRES: 1500, NTRECONQ: 0, NTREMULQ: i === 7 ? 300 : 0, NTRENRSQ: 0, NTLNLSQ: 600,
});
const financials = { CERT: '1', quarters: Object.fromEntries(REPS.map((r, i) => [r, { REPDTE: r, ...Q(i) }])) };
const footprint = { branchesByMetro: { 38060: 4 }, sod: { year: 2026, depositsByMetro: { 38060: 600000 }, totalDeposits: 1000000 }, _source: { fetchedAt: '2026-11-13T12:00:00Z' } };
const item = scoreBank({ cert: '1', institution: { NAME: 'Alpha Example Bank', CITY: 'Anytown', STALP: 'AZ', ACTIVE: 1, status: 'active', via: { branch: true } }, footprint, financials, scoring, buybox, metros, latestRepdte: '20260630' });
const paper = buildPaper({ cert: '1', name: 'Alpha Example Bank', financials, footprint, buybox, placeholders: [], metros, runId: 'score-1' });
const usdOf = (s) => Number(String(s).replace(/[^0-9.]/g, '')) * (/B/.test(s) ? 1e9 : /M/.test(s) ? 1e6 : 1);

test('tabs are links read from the query string; the stage path never sends and parks a bank that is off the list', () => {
  assert.deepEqual(TABS.map(([, l]) => l), ['Overview', 'What it holds', 'How much could fit', 'Details']);
  assert.deepEqual([tabOf({ tab: 'fit' }), tabOf({ tab: ['holdings'] }), tabOf({ tab: '<x>' }), tabOf(undefined)], ['fit', 'holdings', 'overview', 'overview']);
  assert.deepEqual(STAGE_PATH, ['Ranked', 'Outreach', 'In conversation', 'NDA signed', 'Loan tape', 'Bid']);
  assert.deepEqual(stageOf({}), { current: 0, parked: false, guide: 'Next step: start outreach to name the person to contact and queue research. Nothing is sent.' });
  const promoted = stageOf({ decision: { status: 'promoted', by: 'Pat Example', at: '2026-11-12T10:00:00Z', accountId: 'alpha-example-bank' } });
  assert.deepEqual([promoted.current, promoted.parked, promoted.account], [1, false, 'alpha-example-bank']);
  assert.match(promoted.guide, /^In Outreach since November 12, 2026, started by Pat Example\. .*Nothing is sent\.$/);
  assert.equal(stageOf({ decision: { status: 'promoted' }, inConversation: true }).current, 2);
  assert.match(stageOf({ decision: { status: 'snoozed', until: '2026-12-17', by: 'Pat Example' } }).guide, /^Snoozed until 2026-12-17 by Pat Example\. It comes back on that date\.$/);
  assert.match(stageOf({ decision: { status: 'dismissed', reason: 'too small' } }).guide, /^Not now: too small\. It comes back only if a new signal fires\.$/);
  assert.deepEqual([stageOf({ excluded: ['failed bank'] }).parked, stageOf({ suppressed: true, decision: { status: 'promoted' } }).current], [true, 0]);
});

test('the short answer: priority, the headline, and each type\'s ceiling from the record, hotel and retail together', () => {
  const parts = answerSentence({ ...item, card: { ...item.card, headline: 'Late apartment loans up two quarters running' } }, paper);
  assert.deepEqual(parts[0], { b: true, t: 'Call first.' });
  const text = answerText(parts);
  assert.match(text, /^Call first\. Late apartment loans up two quarters running\. Up to \$15\.4M of its late apartment loans could fit our buy box, and up to \$16\.0M of its late commercial-property loans if they are hotels or retail\.$/);
  assert.ok(parts.filter((p) => p.b).map((p) => p.t).includes('$16.0M'), 'the figures are set in bold');
  // Before the engine stored a headline: the card's first real sentence. With no record: no ceiling sentence.
  assert.match(answerText(answerSentence({ ...item, card: { ...item.card, headline: null } }, null)), /^Call first\. Multifamily loans are 30\.00% of its CRE book/);
  assert.match(answerText(answerSentence({ ...item, tier: 'B', filtersFailed: ['failed bank'] }, paper)), /^Excluded from the list\./);
  assert.match(answerText(answerSentence({ ...item, tier: null, card: null }, null)), /^Not ranked\.$/);
});

test('the six key fields come from stored figures: the largest single ceiling, the seriously-late share and its yearly change', () => {
  const f = Object.fromEntries(facts(item, paper, { route: 'advisor' }).map((x) => [x.id, x]));
  assert.deepEqual(Object.keys(f), ['priority', 'score', 'fit', 'late', 'deposits', 'sells']);
  assert.deepEqual([f.score.v, f.score.sub], [String(Math.round(item.score)), 'of 100']);
  assert.deepEqual([f.fit.v, f.fit.sub, f.fit.estimate], ['up to $16.0M', 'hotel or retail', true]);
  assert.notEqual(usdOf(f.fit.v), 16e6 * 2 + 15.4e6, 'never a sum of ceilings');
  const late = item.components.find((c) => c.id === 'creNoncurrentRatio').value;
  assert.equal(f.late.v, `${(late * 100).toFixed(1)}%`);
  assert.match(f.late.sub, /^of CRE, up \d+\.\d points in a year$/);
  assert.deepEqual([f.deposits.v, f.deposits.sub], ['60%', 'Phoenix']);
  assert.deepEqual([f.sells.v, routeWords(null), routeWords({ route: 'both' })], ['Through an advisor', 'Not known yet', 'Directly and through an advisor']);
  // No record yet: the item's stored fitCeiling, else "Not estimated yet".
  const withCeiling = { ...item, fitCeiling: [{ sector: 'multifamily', category: 'multifamily', high: 2900000, low: 0, tier: 'reported' }] };
  assert.equal(facts(withCeiling, null, null).find((x) => x.id === 'fit').v, 'up to $2.9M');
  assert.equal(facts(item, null, null).find((x) => x.id === 'fit').v, 'Not estimated yet');
  assert.equal(bestFit(item, { ...paper, q7: { sectors: [] } }), null);
});

test('what it holds: one row per type, joined by category id, commercial property with its two lines inside, never summed', () => {
  const rows = holdingRows(item.profile, paper.q1, paper.q7);
  assert.deepEqual(rows.map((r) => r.label), ['Apartments', 'Commercial property', 'Construction and land', 'CRE loans without a property lien']);
  const [mf, nf, cons, ns] = rows;
  assert.deepEqual([mf.balance.text, mf.shareOfCre, mf.buys, mf.stages.nonaccrual.text, mf.stages.nonaccrual.share, mf.oreo.text], ['$300.0M', '30%', 'yes', '$10.0M', '3.3%', '$1.0M']);
  assert.equal(mf.stages.pastDue30to89.codes, 'P3REMULT · June 30, 2026', 'the FDIC field code, hidden until the switch');
  assert.deepEqual([mf.fit.text, mf.fit.sub, mf.fit.estimate], ['up to $15.4M', 'apartments', true]);
  assert.deepEqual([nf.buys, nf.fit.text, nf.fit.sub], ['partly', 'up to $16.0M', 'if hotel or retail']);
  assert.deepEqual(nf.children.map((c) => c.label), ['Investor-owned', 'Owner-occupied']);
  assert.deepEqual([nf.children[0].oreo.text, nf.children[0].fit.text], ['In the total above', 'In the total above']);
  // The engine's own nonfarm total stages (q1.nonfarmTotal.stages) are shown as stored: P3RENRES is $6.0M, not the two lines added.
  assert.equal(nf.stages.pastDue30to89.text, '$6.0M');
  assert.notEqual(nf.stages.pastDue30to89.text, '$6.0M + $2.0M');
  // A record without them (scored before the change) and no profile figure: the row says where they are.
  const old = { ...paper.q1, nonfarmTotal: { ...paper.q1.nonfarmTotal, stages: undefined } };
  const prof = { ...item.profile, categories: item.profile.categories.map((c) => (c.id === 'nonfarmNonresidential' ? { ...c, stages: { ...c.stages, pastDue30to89: { field: 'P3RENRES', repdte: '20260630', value: null } } } : c)) };
  assert.equal(holdingRows(prof, old, paper.q7)[1].stages.pastDue30to89.text, 'In the two lines below');
  assert.equal(holdingRows(item.profile, old, paper.q7)[1].stages.pastDue90.text, '$2.0M', 'else the figure the profile stored');
  assert.deepEqual([cons.buys, cons.fit.text], ['no', 'Not a type we buy']);
  assert.deepEqual([ns.stages.nonaccrual.gap, ns.stages.nonaccrual.text], [true, 'Not reported'], 'a stage FDIC does not report is never 0');
  // Without a paper record, the item's profile alone (in thousands, formatted as dollars).
  const bare = holdingRows(item.profile, null, null);
  assert.deepEqual([bare[0].balance.text, bare[0].stages.pastDue90.text, bare[0].fit.text], ['$300.0M', '$1.0M', 'Not estimated yet']);
  assert.ok(ladderScale(rows) >= 0.05 && ladderScale(rows) <= 1);
});

test('how much could fit: each type\'s range as stored, one shared axis, gaps kept, estimates marked', () => {
  const r = fitRanges(paper.q7);
  assert.deepEqual(r.map((x) => [x.label, x.low, x.high, x.estimate]), [['Hotels', 0, 16000000, true], ['Apartments', 0, 15400000, true], ['Retail', 0, 16000000, true]]);
  assert.ok(r[1].unknown.some((u) => u.id === 'lien'), 'why the floor is $0');
  assert.deepEqual(rangeAxis([16000000, 15400000]), { top: 20000000, ticks: [0, 5000000, 10000000, 15000000, 20000000] });
  assert.deepEqual(rangeAxis([]), { top: 1, ticks: [0] });
  assert.deepEqual(rangeAxis([0.041]), { top: 0.06, ticks: [0, 0.02, 0.04, 0.06] }, 'round steps, at least the largest value');
  const gap = fitRanges({ sectors: [{ sector: 'retail', category: 'nonfarmNonresidential', bounds: { status: 'unknown', reason: 'x' } }] })[0];
  assert.deepEqual([gap.known, gap.high], [false, null]);
});

test('why now drops the boilerplate first sentence and marks signal sentences with their dates; the trend keeps gaps as breaks', () => {
  assert.deepEqual(withoutBoilerplate([{ text: 'Alpha Example Bank: Call Report data as of June 30, 2026.' }, { text: 'b' }]).map((s) => s.text), ['b']);
  assert.deepEqual(withoutBoilerplate([{ text: 'a' }]).map((s) => s.text), ['a']);
  const lines = whyLines(item);
  assert.equal(lines.length, item.card.sentences.length - 1);
  const sig = lines.find((l) => /rose in each of the last 2 quarters/.test(l.text));
  assert.deepEqual([sig.signal, sig.when], [true, 'June 30, 2026']);
  assert.equal(lines[0].signal, false);
  const t = trendSeries(paper);
  assert.equal(t.length, 8);
  assert.deepEqual([t[0].short, t.at(-1).label], ['Sep 2024', 'June 30, 2026']);
  const broken = trendSeries({ trend: { seriouslyLateShare: [{ quarter: '2026Q1', asOf: '2026-03-31', value: null, valueStatus: 'not-on-file', valueReason: 'not pulled' }, { quarter: '2026Q2', asOf: '2026-06-30', value: 0.02 }] } });
  assert.deepEqual(broken.map((p) => p.value), [null, 0.02], 'a missing point stays null, never 0');
  assert.equal(trendSeries({}), null, 'no series: no chart');
});

test('the sidebar: where it lends, the score against its maximums, sales on record; dates said once', () => {
  assert.deepEqual(whereRows(item, paper).map((m) => [m.label, m.share, m.branches]), [['Phoenix', 0.6, 4]]);
  assert.deepEqual(whereRows(item, null).map((m) => [m.label, m.share]), [['Phoenix', 0.6]], 'from the profile when there is no record');
  const sp = scoreParts(item, scoring);
  assert.deepEqual(sp.axes.map((a) => [a.label, a.max]), [['Pressure', 45], ['Fit', 30], ['Timing', 25]]);
  assert.match(sp.rule, /^Call first needs 45 points or more/);
  assert.match(scoreParts({ ...item, tier: 'B', score: 50, axes: { distress: 10, fit: 25, timing: 15 } }, scoring).rule, /^Short of Call first: pressure 10\.0 \(needs 15\)\.$/);
  assert.equal(componentValue({ id: 'creNoncurrentYoY', change: 'yoy', value: 0.0125 }), '+1.25 pts');
  assert.equal(componentValue({ id: 'metroDepositShare', value: 0.6 }), '60%');
  assert.equal(componentValue({ id: 'x', value: null }), 'Not available');
  assert.ok(Array.isArray(soldItems(paper)) && soldItems(null).length === 0);
  assert.equal(aboutDate(paper, item), 'June 30, 2026');
});
