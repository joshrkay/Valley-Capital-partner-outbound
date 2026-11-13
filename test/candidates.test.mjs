// The candidate list, the deterministic "why now" card, matching, and a principal's decisions (PRD E6-S1, S3, S4, S8). Invented data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { makeDir, put, loadJson } from './kit.mjs';
import { runScoring } from '../src/score.mjs';
import { buildCard, listCandidates, promote, dismiss, snooze, matchInstitution, addAlias, suppressedBy, leadSectorFor, getCandidate } from '../src/candidates.mjs';
import { MONTH_NAMES } from '../src/metrics.mjs';

const metros = loadJson('metros.json');
const scoring = () => structuredClone(loadJson('scoring.json'));
const buybox = (over = {}) => ({ ...structuredClone(loadJson('buybox.json')), sectors: { include: ['hospitality', 'multifamily', 'retail'], shortTermRentalPortfolios: 'out' }, loanSize: { minUsd: 1000000, maxUsd: 25000000 }, statuses: ['non-performing'], lien: 'first', exclusions: ['ground-up construction'], ...over });
const REPS = ['20240930', '20241231', '20250331', '20250630', '20250930', '20251231', '20260331', '20260630'];
const Q = (over = {}) => ({
  ASSET: 3000000, LNLSNET: 2000000, LNRECONS: 100000, LNREMULT: 300000, LNRENRES: 600000, LNRENROW: 200000, LNRENROT: 400000,
  NCRECONS: 2000, NCREMULT: 15000, NCRENRES: 12000, NCRENROW: 3000, NCRENROT: 9000, NARECONS: 1000, NAREMULT: 10000, NARENRES: 8000,
  P3RENRES: 6000, P3REMULT: 4000, P9RENRES: 2000, P9REMULT: 1000, ORE: 4000, ORECONS: 500, OREMULT: 1000, ORENRES: 1500,
  NTRECONQ: 0, NTREMULQ: 300, NTRENRSQ: 200, NTLNLSQ: 600, ...over,
});
const src = { source: 'fdic', endpoint: '/test', query: {}, recordId: 'invented', period: '', fetchedAt: '2026-11-13T00:00:00Z', runId: 'test-run' };
const quarters = (fn = () => ({})) => Object.fromEntries(REPS.map((r, i) => [r, { REPDTE: r, ...Q(fn(i)), _source: src }]));
const mfDistress = (i) => ({ NCREMULT: 5000 + i * 2500, NCRENRES: 4000, P3REMULT: 3000 + i * 200, NTREMULQ: i === 7 ? 300 : 0, NTRENRSQ: 0 });
const nfDistress = (i) => ({ NCREMULT: 0, NCRENRES: 4000 + i * 3000, P3RENRES: 3000 + i * 300, NTREMULQ: 0, NTRENRSQ: i === 7 ? 400 : 0 });

const NOW = new Date('2026-11-13T12:00:00Z');
function world(banks, bb = buybox()) {
  const dir = makeDir();
  const inst = {}; const fp = {};
  for (const b of banks) {
    inst[b.cert] = { CERT: b.cert, NAME: b.name, CITY: 'Anytown', STALP: 'AZ', ASSET: 3000000, ACTIVE: 1, via: { branch: true, hq: false }, inUniverse: true, status: 'active', _source: src };
    fp[b.cert] = { branchesByMetro: { 38060: 12, 29820: 3 }, sod: { year: 2026, depositsByMetro: { 38060: 500000, 29820: 100000 }, totalDeposits: 1000000 }, _source: src };
    put(dir, `sources/fdic/financials/${b.cert}.json`, { CERT: b.cert, quarters: quarters(b.fn) });
  }
  put(dir, 'sources/fdic/institutions.json', inst);
  put(dir, 'sources/fdic/footprint.json', fp);
  const out = runScoring({ dir, buybox: bb, scoring: scoring(), metros, now: NOW });
  return { dir, out };
}
const editLatest = (dir, fn) => { const p = join(dir, 'candidates', 'latest.json'); const l = JSON.parse(readFileSync(p, 'utf8')); fn(l); put(dir, 'candidates/latest.json', l); };
const auditLines = (dir) => readFileSync(join(dir, 'audit.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

test('the card: every sentence carries evidence, it states the period, it leads with fit, and it is identical for identical input', () => {
  const { out } = world([{ cert: '1', name: 'Alpha Example Bank', fn: mfDistress }]);
  const it = out.items[0];
  const card = it.card;
  assert.ok(card && card.sentences.length >= 4);
  for (const s of card.sentences) assert.ok(s.evidence.length > 0, `no evidence: ${s.text}`);
  assert.equal(card.period, 'June 30, 2026');
  assert.match(card.sentences[0].text, /as of June 30, 2026/);
  assert.match(card.sentences[1].text, /^Multifamily loans are 30\.00% of its CRE book \(\$300\.0 million\); their noncurrent ratio is 7\.50%, up from 4\.17% four quarters earlier\.$/, 'leads with the most distressed category the buy box buys');
  assert.ok(card.sentences.some((s) => /^Branches in the buy-box metros: 12 in Phoenix, 3 in Las Vegas; 60% of its deposits are there/.test(s.text)));
  assert.ok(card.sentences[1].evidence.includes('fdic:1:20260630') && card.sentences[1].evidence.includes('fdic:1:20250630'));
  const sig = card.sentences.find((s) => s.evidence.some((e) => /:cre-noncurrent-rising:/.test(e)));
  assert.ok(sig, 'a signal sentence cites its signal id');
  assert.equal(card.text, card.sentences.map((s) => s.text).join(' '));
  assert.deepEqual(buildCard(structuredClone(it), { scoring: scoring() }), buildCard(structuredClone(it), { scoring: scoring() }));
  assert.deepEqual(buildCard(it, { scoring: scoring() }), card);
});

test('the card for nonfarm nonresidential paper says hotel and retail cannot be separated', () => {
  const { out } = world([{ cert: '1', name: 'Alpha Example Bank', fn: nfDistress }]);
  const first = out.items[0].card.sentences[1].text;
  assert.match(first, /^Nonfarm nonresidential loans are 60\.00% of its CRE book/);
  assert.match(first, /cannot separate hotel or retail loans/);
});

test('no template can emit a property, borrower, filing or free-text label: only code-defined words, numbers, the bank and metro names', () => {
  const { out } = world([{ cert: '1', name: 'Alpha Example Bank', fn: mfDistress }]);
  const it = structuredClone(out.items[0]);
  // Plant hostile text everywhere a careless template might read it.
  it.borrower = 'Sunset Motor Inn LLC'; it.property = 'Harbor View Plaza'; it.filing = 'Case 2026-CV-1234 Smith v Jones';
  it.signals.forEach((s) => { s.label = 'Sunset Motor Inn foreclosure filed by Harbor View Plaza'; });
  it.components.forEach((c) => { c.note = 'Harbor View Plaza'; c.inputs.forEach((x) => { x.note = 'Sunset Motor Inn'; }); });
  it.profile.categories.forEach((c) => { c.fit.reason = 'Sunset Motor Inn LLC'; });
  const card = buildCard(it, { scoring: scoring() });
  for (const bad of ['Sunset', 'Harbor', 'Motor', 'Smith', 'Jones', 'CV', 'foreclosure', 'filed']) assert.ok(!card.text.includes(bad), `"${bad}" leaked into the card`);
  const allowed = new Set(['Alpha', 'Example', 'Bank', 'Call', 'Report', 'CRE', 'OREO', 'Multifamily', 'Nonfarm', 'Construction', 'Branches', 'Summary', 'Deposits', 'June', 'None', 'This', 'Noncurrent', 'Early-stage', 'Commercial', 'Share', 'Phoenix', 'Las', 'Vegas', ...MONTH_NAMES, ...metros.metros.flatMap((m) => m.label.split(' '))]);
  for (const w of card.text.match(/\b[A-Z][A-Za-z-]*\b/g) ?? []) assert.ok(allowed.has(w), `unexpected capitalized word "${w}"`);
});

test('matching: exact name or alias matches; anything fuzzier is only a suggestion', () => {
  const institutions = { 10: { NAME: 'First Example Bank' }, 20: { NAME: 'First Example Bank of Mesa' }, 30: { NAME: 'Unrelated Trust' } };
  assert.deepEqual(matchInstitution('FIRST EXAMPLE BANK', { institutions }), { key: 'fdic:10', how: 'exact', suggestions: [] });
  assert.deepEqual(matchInstitution('FEB Holdings', { institutions, aliases: { 'fdic:10': ['FEB Holdings'] } }), { key: 'fdic:10', how: 'alias', suggestions: [] });
  const fuzzy = matchInstitution('First Example Bank, N.A., Mesa branch', { institutions });
  assert.equal(fuzzy.key, null);
  assert.equal(fuzzy.how, 'needs_review');
  assert.ok(fuzzy.suggestions.length >= 1 && fuzzy.suggestions.every((s) => s.key !== 'fdic:30'));
  assert.equal(matchInstitution('Nothing Like It', { institutions }).how, 'none');
  const dir = makeDir();
  assert.throws(() => addAlias({ dir, key: 'fdic:10', alias: 'FEB' }), /name is required/);
  assert.deepEqual(addAlias({ dir, key: 'fdic:10', alias: 'FEB', by: 'Pat Example' }), ['FEB']);
});

test('suppressed institutions never appear, by name, suppression alias, alias table or certificate, not even with --all', () => {
  const { dir } = world([{ cert: '1', name: 'Alpha Example Bank', fn: mfDistress }, { cert: '2', name: 'Beta Example Bank', fn: mfDistress }, { cert: '3', name: 'Gamma Example Bank', fn: mfDistress }, { cert: '4', name: 'Delta Example Bank', fn: mfDistress }]);
  addAlias({ dir, key: 'fdic:3', alias: 'Gamma Holdings', by: 'Pat Example' });
  const suppression = [
    { type: 'institution', value: 'Alpha Example Bank', reason: 'nda' },
    { type: 'institution', value: 'Beta Bancorp', aliases: ['Beta Example Bank'], reason: 'in a process' },
    { type: 'institution', value: 'Gamma Holdings', reason: 'opt_out' },
    { type: 'institution', value: 'Delta Parent Co', cert: '4', reason: 'regulator' },
  ];
  assert.deepEqual(listCandidates({ dir, suppression, now: NOW, all: true }).items.map((i) => i.key), []);
  assert.equal(listCandidates({ dir, now: NOW }).items.length, 4);
  assert.ok(suppressedBy({ key: 'fdic:9', cert: '9', name: 'Alpha Example Bank of Mesa' }, [{ type: 'institution', value: 'Alpha Example Bank' }]), 'the suppressed name inside a longer name');
  assert.throws(() => promote({ dir, key: 'fdic:1', by: 'Pat Example', suppression }), /suppressed/);
});

test('dismiss needs a name and a reason; a dismissed candidate returns only when a new signal fires', () => {
  const { dir } = world([{ cert: '1', name: 'Alpha Example Bank', fn: mfDistress }]);
  assert.throws(() => dismiss({ dir, key: 'fdic:1', reason: 'no' }), /name is required/);
  assert.throws(() => dismiss({ dir, key: 'fdic:1', by: 'Pat Example' }), /reason is required/);
  dismiss({ dir, key: 'fdic:1', by: 'Pat Example', reason: 'known relationship elsewhere', now: NOW });
  assert.equal(listCandidates({ dir, now: NOW }).items.length, 0);
  runScoring({ dir, buybox: buybox(), scoring: scoring(), metros, now: NOW });   // same data, same signals: stays dismissed
  assert.equal(listCandidates({ dir, now: NOW }).items.length, 0);
  editLatest(dir, (l) => { l.items[0].signals.push({ id: 'fdic:1:cre-oreo-up:20260930', type: 'cre-oreo-up', label: 'x', period: '20260930', evidence: ['fdic:1:20260930'], rule: 'rising', metric: 'creOreo', value: 9000, quarters: 1 }); });
  const back = listCandidates({ dir, now: NOW }).items;
  assert.equal(back.length, 1); assert.equal(back[0].status, 'returned');
  assert.ok(auditLines(dir).some((a) => a.type === 'candidate_dismissed' && a.by === 'Pat Example'));
});

test('snooze needs a future date and hides the candidate until then', () => {
  const { dir } = world([{ cert: '1', name: 'Alpha Example Bank', fn: mfDistress }]);
  assert.throws(() => snooze({ dir, key: 'fdic:1', by: 'Pat Example' }), /--until YYYY-MM-DD/);
  assert.throws(() => snooze({ dir, key: 'fdic:1', by: 'Pat Example', until: '2026-11-01', now: NOW }), /not in the future/);
  snooze({ dir, key: 'fdic:1', by: 'Pat Example', until: '2026-12-10', now: NOW });
  assert.equal(listCandidates({ dir, now: NOW }).items.length, 0);
  assert.equal(listCandidates({ dir, now: new Date('2026-12-10T09:00:00Z') }).items.length, 1);
});

test('promote needs a name, writes the account with its pipeline block and an audit line, and cannot run twice', () => {
  const { dir } = world([{ cert: '1', name: 'Alpha Example Bank', fn: mfDistress }]);
  assert.throws(() => promote({ dir, key: 'fdic:1' }), /name is required/);
  assert.throws(() => promote({ dir, key: 'fdic:1', by: '   ' }), /name is required/);
  assert.equal(existsSync(join(dir, 'accounts')), false, 'no account file without a name');
  const a = promote({ dir, key: 'fdic:1', by: 'Pat Example', now: NOW });
  const saved = JSON.parse(readFileSync(join(dir, 'accounts', `${a.id}.json`), 'utf8'));
  assert.equal(saved.id, 'alpha-example-bank');
  assert.equal(saved.type, 'bank'); assert.equal(saved.institutionKey, 'fdic:1');
  assert.equal(saved.person.name, ''); assert.match(saved.notes, /Name the person/);
  assert.deepEqual(saved.originSignals, getCandidate({ dir, key: 'fdic:1' }).signals.map((s) => s.id));
  const p = saved.pipeline;
  for (const k of ['key', 'period', 'tier', 'axes', 'profile', 'signals', 'leadSector', 'leadSectorOptions']) assert.ok(k in p, `pipeline.${k}`);
  assert.equal(p.period, '20260630'); assert.equal(p.tier, saved.tier);
  assert.ok(auditLines(dir).some((x) => x.type === 'candidate_promoted' && x.key === 'fdic:1' && x.by === 'Pat Example'));
  assert.throws(() => promote({ dir, key: 'fdic:1', by: 'Pat Example' }), /already promoted/);
  assert.equal(listCandidates({ dir, now: NOW }).items.length, 0, 'promoted candidates leave the list');
});

test('lead sector: multifamily distress sets it; nonfarm nonresidential distress leaves it to a principal', () => {
  const mf = world([{ cert: '1', name: 'Alpha Example Bank', fn: mfDistress }]);
  const a = promote({ dir: mf.dir, key: 'fdic:1', by: 'Pat Example', now: NOW });
  assert.equal(a.pipeline.leadSector, 'multifamily');
  assert.deepEqual(a.pipeline.leadSectorOptions, ['multifamily']);
  assert.deepEqual(a.sectors, ['multifamily']);
  const nf = world([{ cert: '2', name: 'Beta Example Bank', fn: nfDistress }]);
  const b = promote({ dir: nf.dir, key: 'fdic:2', by: 'Pat Example', now: NOW });
  assert.equal(b.pipeline.leadSector, null);
  assert.deepEqual(b.pipeline.leadSectorOptions, ['hospitality', 'retail']);
  assert.match(b.pipeline.leadSectorNote, /cannot separate. A principal chooses/);
  assert.deepEqual(b.sectors, ['hospitality', 'retail']);
  // Even a buy box with only one of the two does not let nonfarm nonresidential set a lead sector: it also holds office and more.
  const one = world([{ cert: '3', name: 'Gamma Example Bank', fn: nfDistress }], buybox({ sectors: { include: ['hospitality', 'multifamily'], shortTermRentalPortfolios: 'out' } }));
  const lead = leadSectorFor(getCandidate({ dir: one.dir, key: 'fdic:3' }).profile);
  assert.equal(lead.leadSector, null); assert.deepEqual(lead.leadSectorOptions, ['hospitality']);
  assert.deepEqual(leadSectorFor({ categories: [] }), { leadSector: null, leadSectorOptions: [], basis: null, note: 'No category the buy box buys shows noncurrent loans. A principal chooses the sector to lead with.' });
});

test('promote refuses a bank that fails the hard filters', () => {
  const { dir } = world([{ cert: '1', name: 'Alpha Example Bank', fn: mfDistress }]);
  editLatest(dir, (l) => { l.items[0].filtersFailed = ['failed bank']; l.items[0].tier = null; });
  assert.throws(() => promote({ dir, key: 'fdic:1', by: 'Pat Example' }), /fails the hard filters \(failed bank\)/);
});
