// The CMBS servicer screens (PRD E4-S3): sorting, a servicer's loans, sources, the EDGAR status line, and the context-only banner.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fakePostgrest } from '../../test/postgrest-fake.mjs';
import { platformClient } from '../../src/platform/client.mjs';
import { sortServicers, loansFor, filingUrl, sourceLine, edgarStatus, CONTEXT_ONLY } from '../lib/servicers.mjs';
import { moneyDollars } from '../lib/format.mjs';
import * as ops from '../lib/ops.mjs';

const svc = (name, over = {}) => ({ name, loans: 1, balance: 0, specialServicing: 0, noteSale: 0, delinquent: 0, maturing: 0, metros: ['31080'], sectors: ['retail'], ...over });
const src = { source: 'edgar', endpoint: 'ABS-EE 0001888524-26-019853 exh_102.xml', period: '2026-10-13', fetchedAt: '2026-11-13T12:00:00Z' };
const loan = (key, specialServicer, signals = [], balance = 1e6) => ({ key, cik: '1790441', trust: 'Example Trust 2019-C5', assetNumber: key.split(':')[2], specialServicer, balance, signals, properties: [], assetLevel: true, _source: src });

test('servicers sort by loans in special servicing, then note-sale coded, then balance, then name', () => {
  const order = sortServicers({
    a: svc('Alpha Servicing', { specialServicing: 1, noteSale: 0, balance: 9e9 }),
    b: svc('Bravo Servicing', { specialServicing: 3, noteSale: 0, balance: 1e6 }),
    c: svc('Charlie Servicing', { specialServicing: 3, noteSale: 2, balance: 1e5 }),
    d: svc('Delta Servicing', { specialServicing: 0, noteSale: 0, balance: 5e8 }),
    e: svc('Echo Servicing', { specialServicing: 0, noteSale: 0, balance: 5e8 }),
  }).map((s) => s.name);
  assert.deepEqual(order, ['Charlie Servicing', 'Bravo Servicing', 'Alpha Servicing', 'Delta Servicing', 'Echo Servicing']);
  assert.deepEqual(sortServicers(null), []);
});

test('a servicer\'s loans: note sales and special servicing first, and unreadable servicers grouped under Unknown', () => {
  const loans = {
    'cmbs:1:1': loan('cmbs:1:1', 'Alpha Servicing', [], 9e7),
    'cmbs:1:2': loan('cmbs:1:2', 'Alpha Servicing', [{ type: 'special_servicing', label: 'x' }], 1e6),
    'cmbs:1:3': loan('cmbs:1:3', 'Alpha Servicing', [{ type: 'note_sale', label: 'x' }], 1e5),
    'cmbs:1:4': loan('cmbs:1:4', null, [], 1e6),
    'cmbs:1:5': loan('cmbs:1:5', 'Bravo Servicing', [], 1e6),
  };
  assert.deepEqual(loansFor(loans, 'Alpha Servicing').map((l) => l.key), ['cmbs:1:3', 'cmbs:1:2', 'cmbs:1:1']);
  assert.deepEqual(loansFor(loans, 'Unknown').map((l) => l.key), ['cmbs:1:4']);
});

test('every loan shows its filing and period, and links to the filing on sec.gov', () => {
  assert.equal(sourceLine(src), 'ABS-EE 0001888524-26-019853 exh_102.xml, reporting period 2026-10-13');
  assert.equal(filingUrl(src, '1790441'), 'https://www.sec.gov/Archives/edgar/data/1790441/000188852426019853/exh_102.xml');
  assert.equal(filingUrl({ endpoint: 'something else' }, '1'), null);
  assert.equal(filingUrl(src, '../x'), null);
  assert.equal(moneyDollars(77900000), '$77.9M'); assert.equal(moneyDollars(2.5e9), '$2.50B');
});

test('EDGAR status: a failed job (the SEC contact placeholder) is shown; a later success clears it', () => {
  const state = { ranAt: '2026-11-10T00:00:00Z', lastRun: 'edgar-1', since: '2026-09-26', counts: { cmbsTrusts: 290, loansRead: 18000, loansKept: 1600, trustErrors: 2 } };
  const placeholder = { kind: 'sources.edgar', status: 'failed', finished_at: '2026-11-13T10:00:00Z', result: { error: 'config.json sec.userAgent is a placeholder.' } };
  const s1 = edgarStatus({ state, runs: [{ source: 'edgar', outcome: 'ok', finishedAt: '2026-11-10T00:05:00Z' }], jobs: [placeholder] });
  assert.match(s1.failure.text, /sec\.userAgent is a placeholder/);
  assert.deepEqual([s1.trusts, s1.loansRead, s1.loansKept], [290, 18000, 1600]);
  const s2 = edgarStatus({ state, runs: [{ source: 'edgar', outcome: 'ok', finishedAt: '2026-11-13T11:00:00Z' }], jobs: [{ kind: 'sources.edgar', status: 'done', finished_at: '2026-11-13T11:00:01Z' }, placeholder] });
  assert.equal(s2.failure, null);
  const s3 = edgarStatus({ state: null, runs: [{ source: 'fdic', outcome: 'failed' }, { source: 'edgar', outcome: 'failed', finishedAt: '2026-11-13T09:00:00Z', errors: ['SEC returned 403'] }], jobs: [] });
  assert.equal(s3.failure.text, 'SEC returned 403'); assert.equal(s3.ranAt, null);
});

test('the servicer list loads only the summary; one servicer\'s page loads the loans', async () => {
  const fake = fakePostgrest({ principals: ['pat@example.test'] });
  const client = platformClient({ url: 'https://example-project.supabase.test', key: 'anon-key', accessToken: 'user:pat@example.test', fetchImpl: fake.fetchImpl });
  const put = (path, body) => fake.docs.set(path, { path, kind: 'json', body, text: null, version: 1 });
  put('sources/edgar/servicers.json', { 'Alpha Servicing': svc('Alpha Servicing', { specialServicing: 1 }), 'Bravo Servicing': svc('Bravo Servicing') });
  put('sources/edgar/loans.json', { 'cmbs:1:1': loan('cmbs:1:1', 'Alpha Servicing'), 'cmbs:1:2': loan('cmbs:1:2', 'Bravo Servicing') });
  put('sources/edgar/state.json', { ranAt: '2026-11-13T00:00:00Z', counts: {} });
  const list = await ops.listServicers(client);
  assert.deepEqual(list.servicers.map((s) => s.name), ['Alpha Servicing', 'Bravo Servicing']);
  const docQueries = fake.calls.filter((c) => c.path === 'documents').map((c) => c.query.or ?? '');
  assert.ok(docQueries.length && docQueries.every((q) => !q.includes('loans.json')), 'the list never loads loans.json');
  const d = await ops.servicerDetail(client, 'Alpha Servicing');
  assert.deepEqual(d.loans.map((l) => l.key), ['cmbs:1:1']);
  assert.equal(await ops.servicerDetail(client, 'Nobody'), null);
  await ops.queueEdgar(client);
  assert.equal(fake.jobs.at(-1).kind, 'sources.edgar');
});

test('the servicer page shows the context-only banner on every path it renders, with the exact words', () => {
  assert.equal(CONTEXT_ONLY, 'Loan and property detail is context for a principal only. It never goes in a message.');
  const page = readFileSync(fileURLToPath(new URL('../app/servicers/[name]/page.jsx', import.meta.url)), 'utf8');
  const returns = page.split('\n').filter((l) => /\breturn\b/.test(l) && !/NotAuthorized/.test(l));
  assert.ok(returns.length >= 3);
  for (const r of returns.filter((l) => !/^\s*return \($/.test(l))) assert.match(r, /<ContextOnlyBanner \/>/, `a return without the banner: ${r.trim()}`);
  assert.match(page, /return \(\s*<>\s*<ContextOnlyBanner \/>/, 'the main view starts with the banner');
  const ui = readFileSync(fileURLToPath(new URL('../app/ui.jsx', import.meta.url)), 'utf8');
  assert.match(ui, /export function ContextOnlyBanner\(\) \{\s*return <div className="banner warn context-only" role="note">\{CONTEXT_ONLY\}<\/div>;/);
});
