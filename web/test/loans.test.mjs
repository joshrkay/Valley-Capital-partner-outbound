// Loans we can see on the bank page, and the county rows on System status (docs/county-loans.md): the bank's file is read through the
// PostgREST document reads with the principal's token, one document like the paper record, and every row shows its type, county, date,
// stage, amount with its basis, property type and source link. Built by the engine from the invented county fake; no network, no browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fakePostgrest } from '../../test/postgrest-fake.mjs';
import { platformClient } from '../../src/platform/client.mjs';
import { makeDir, put, config } from '../../test/kit.mjs';
import { fakeCounty, WEEK1, WEEK2, INSTITUTIONS, BORROWERS, ADDRESSES } from '../../test/county-notices-fake.mjs';
import { runNoticeSource } from '../../src/sources/notices.mjs';
import { exampleCounty } from '../../src/sources/counties/example.mjs';
import { readBankLoans, readLoanState, loanBankRel } from '../../src/loans.mjs';
import { watchedCounties, countyCoverage } from '../../src/counties.mjs';
import { readJson } from '../../src/store.mjs';
import { loanRows, amountLines, basisLine, loansCard, emptyText, watchedLine, countyRows, safeLink, BASIS_WORDS, LOANS_CONTEXT } from '../lib/loans-view.mjs';
import { sourceLabel } from '../lib/status-view.mjs';
import { glossaryEntry } from '../lib/glossary.mjs';
import * as ops from '../lib/ops.mjs';

const URL_ = 'https://example-project.supabase.test';
const counties = config().counties;
async function folder() {
  const dir = makeDir();
  put(dir, 'sources/fdic/institutions.json', INSTITUTIONS);
  const go = (rows, now) => runNoticeSource({ dir, source: exampleCounty, counties, fetchImpl: fakeCounty({ rows }).fetchImpl, sleep: async () => {}, now, clock: () => now, allowExample: true });
  await go(WEEK1(), new Date('2026-11-16T12:00:00Z'));
  await go(WEEK2(), new Date('2026-11-23T12:00:00Z'));
  return dir;
}

test('each loan\'s document type, county, date, stage, amount with its basis, property type and a link to the source document', async () => {
  const dir = await folder();
  const rows = loanRows(readBankLoans({ dir, key: 'fdic:9001' }));
  assert.deepEqual(rows.map((r) => r.type), ['Notice of election and demand', 'Release', 'Notice of trustee\'s sale', 'Notice of election and demand'], 'newest first');
  const nts = rows[2];
  assert.deepEqual([nts.county, nts.dateKind, nts.date, nts.stage, nts.saleDate, nts.propertyType, nts.propertyKnown, nts.role],
    ['Example County, CO', 'Recorded', 'November 11, 2026', 'Sale scheduled', 'December 9, 2026', 'Not known yet', false, 'Lender']);
  assert.deepEqual(nts.amounts, [{ id: 'unpaidBalance', label: 'Unpaid balance', text: '$7.2M', basis: 'as stated on the document' }, { id: 'originalPrincipal', label: 'Original principal', text: '$7.8M', basis: 'as stated on the document' }]);
  assert.deepEqual([nts.basis, nts.short, nts.saleShort], ['As stated on the document', 'Nov 11, 2026', 'Dec 9, 2026'], 'the basis said once for the row');
  assert.equal(basisLine([{ label: 'Unpaid balance', basis: 'from the county\'s index' }, { label: 'Original principal', basis: 'as stated on the document' }]), 'Unpaid balance from the county\'s index; original principal as stated on the document');
  assert.equal(basisLine([{ id: 'none', label: '', text: 'Not stated on the document', basis: '' }]), '', 'no figure, no basis line: the row already says it is not stated');
  assert.equal(nts.link, 'https://publictrustee.example/documents/2026-004105');
  assert.equal(nts.deedOfTrust, '2018-0333222, recorded April 27, 2018');
  assert.deepEqual([rows[0].propertyType, rows[0].propertyKnown, rows[0].stage], ['Mixed use', true, 'Foreclosure started']);
  // A release states no amount: it says so, never $0.
  assert.deepEqual(rows[1].amounts, [{ id: 'none', label: '', text: 'Not stated on the document', basis: '' }]);
  assert.deepEqual(amountLines({}), [{ id: 'none', label: '', text: 'Not stated on the document', basis: '' }]);
  assert.equal(amountLines({ unpaidBalance: { value: null, basis: 'not-read' } })[0].text, 'Not read yet');
  // Through MERS as nominee, and an assignment away, in words.
  assert.equal(loanRows(readBankLoans({ dir, key: 'fdic:9002' }))[0].via, 'Named through MERS as nominee');
  assert.equal(loanRows(readBankLoans({ dir, key: 'fdic:9002' }))[0].role, 'Lender and holder');
  assert.equal(loanRows(readBankLoans({ dir, key: 'fdic:9005' })).find((r) => r.type === 'Assignment').role, 'Assigned the loan away');
  // Nothing about a borrower or a property's address reaches a row.
  const all = JSON.stringify(['fdic:9001', 'fdic:9002', 'fdic:9005'].map((k) => loanRows(readBankLoans({ dir, key: k }))));
  for (const leak of [...BORROWERS, ...ADDRESSES, '0000-00-0-00-001']) assert.ok(!all.includes(leak), leak);
  assert.deepEqual([safeLink('javascript:alert(1)'), safeLink('/documents/1'), safeLink('https://publictrustee.example/documents/1')], [null, null, 'https://publictrustee.example/documents/1']);
  assert.deepEqual(Object.keys(BASIS_WORDS), ['document', 'index', 'not-stated', 'not-read']);
});

test('the sidebar card and the empty state: which counties are watched, and that none has a document for this bank yet', async () => {
  const dir = await folder();
  const watched = watchedCounties({ config: counties, state: readLoanState(dir) });
  const card = loansCard(readBankLoans({ dir, key: 'fdic:9001' }), watched);
  assert.deepEqual([card.count, card.latest.length, card.more, card.empty], [4, 3, 1, '']);
  assert.equal(card.watched, 'Watched: Example County, CO (last read November 23, 2026).');
  const none = loansCard(null, watched);
  assert.deepEqual([none.count, none.empty, none.watched], [0, 'None of the watched counties has a document for this bank yet.', 'Watched: Example County, CO (last read November 23, 2026).'], 'none yet, and which counties are watched');
  assert.equal(emptyText([]), 'No county is watched yet, so no public record can show this bank\'s loans. A county is watched once its source is built and a principal allows it.');
  assert.equal(watchedLine([]), 'No county is watched yet.');
  assert.match(LOANS_CONTEXT, /never in a message/i);
  assert.ok(glossaryEntry('loans-we-can-see'), 'the section\'s term is in the glossary');
});

test('the bank page reads its loans the way it reads the paper record: one document for this bank, and the watch state, as the principal', async () => {
  const dir = await folder();
  const fake = fakePostgrest();
  const pat = platformClient({ url: URL_, key: 'anon-key', accessToken: 'user:pat@example.test', fetchImpl: fake.fetchImpl });
  const item = { key: 'fdic:9001', cert: '9001', name: 'Example Bank, National Association', tier: 'A', score: 60, axes: { distress: 30, fit: 20, timing: 10 }, metros: ['19740'], sectors: ['multifamily'], filtersFailed: [], signals: [], profile: { categories: [] }, latestRepdte: '20260630', card: null };
  const docs = ['loans/banks/fdic-9001.json', 'loans/banks/fdic-9002.json', 'loans/state.json', 'loans/docs/example-county.json', 'loans/review.json', 'loans/events.json']
    .map((path) => ({ path, kind: 'json', body: readJson(`${dir}/${path}`), baseVersion: 0 }));
  await pat.flush({ docs: [{ path: 'candidates/latest.json', kind: 'json', body: { runId: 'score-1', items: [item, { ...item, key: 'fdic:9002', cert: '9002' }] }, baseVersion: 0 }, ...docs], lines: [] });
  fake.calls.length = 0;
  const d = await ops.candidateDetail(pat, 'fdic:9001');
  assert.equal(d.loans.key, 'fdic:9001');
  assert.equal(d.loans.loans.length, 4);
  assert.deepEqual(d.watched.map((w) => [w.id, w.countyLabel, w.configured]), [['example-county', 'Example County, CO', false]]);
  const reads = fake.calls.filter((c) => c.path === 'documents');
  assert.ok(reads.length && reads.every((c) => c.caller === 'principal'), 'read with the principal\'s token, never a service key');
  const or = reads.map((c) => String(c.query.or)).join(' ');
  assert.ok(or.includes(`"${loanBankRel('fdic:9001')}"`) && or.includes('"loans/state.json"'), or);
  for (const never of ['fdic-9002', 'loans/docs', 'loans/review', 'loans/events', '"loans/*"', 'loans/banks/*']) assert.ok(!or.includes(never), `the page loaded ${never}`);
  // A bank no county document names: no file, and the page has the watched counties for its empty state.
  const other = await ops.candidateDetail(pat, 'fdic:9002');
  assert.ok(other.loans.loans.length >= 1);
  await pat.flush({ docs: [{ path: 'candidates/latest.json', kind: 'json', body: { runId: 'score-2', items: [item, { ...item, key: 'fdic:9003', cert: '9003' }] }, baseVersion: 1 }], lines: [] });
  const none = await ops.candidateDetail(pat, 'fdic:9003');
  assert.deepEqual([none.loans, none.watched.length], [null, 1]);
  // Someone signed in who is not a principal reads nothing.
  const stranger = platformClient({ url: URL_, key: 'anon-key', accessToken: 'user:stranger@example.test', fetchImpl: fake.fetchImpl });
  assert.equal(await ops.candidateDetail(stranger, 'fdic:9001'), null);
});

test('System status: a row per watched county with the last run, documents read and new this week, from one document', async () => {
  const dir = await folder();
  const fake = fakePostgrest();
  const pat = platformClient({ url: URL_, key: 'anon-key', accessToken: 'user:pat@example.test', fetchImpl: fake.fetchImpl });
  await pat.flush({ docs: [{ path: 'loans/state.json', kind: 'json', body: readJson(`${dir}/loans/state.json`), baseVersion: 0 }], lines: [] });
  fake.calls.length = 0;
  const rows = countyRows(await ops.countyCoverage(pat, { now: new Date('2026-11-24T12:00:00Z') }));
  assert.deepEqual(rows.map((r) => [r.county, r.lastRun, r.read, r.newThisWeek, r.matched, r.stored, r.review]), [['Example County, CO', 'November 23, 2026', '8', '2', '7', '10', '3']]);
  assert.deepEqual(fake.calls.filter((c) => c.path === 'documents').map((c) => String(c.query.or)), ['(path.eq."loans/state.json")'], 'one document');
  // Before any county runs: no row, and the page says no county is watched yet.
  assert.deepEqual(countyRows(countyCoverage({ config: counties, state: {} })), []);
  // A failed run says so, with its error.
  const failed = countyRows([{ id: 'x', countyLabel: 'X County, CO', lastRun: { ranAt: '2026-11-20T00:00:00Z', outcome: 'failed', error: 'robots.txt disallows the list' }, read: null, newThisWeek: 0, matchedDocuments: null, stored: null, reviewNames: null }]);
  assert.deepEqual([failed[0].lastRun, failed[0].failed, failed[0].error, failed[0].read], ['November 20, 2026, failed', true, 'robots.txt disallows the list', '–']);
  assert.equal(sourceLabel('county:example-county'), 'county records (example-county)');
});

const src = (f) => readFileSync(new URL(`../app/${f}`, import.meta.url), 'utf8');
test('the section is server-rendered: no client script, a card in the sidebar, its own tab, and no borrower or address field anywhere', () => {
  const loans = src('candidates/[key]/loans.jsx');
  assert.doesNotMatch(loans, /'use client'|"use client"|process\.env|fetch\(|dangerouslySetInnerHTML/);
  assert.match(loans, /export function LoansCard/);
  assert.match(loans, /export function LoansSection/);
  assert.match(loans, /<Basis tier="observed" \/>/, 'marked as seen loan by loan');
  assert.match(loans, /rel: 'noopener noreferrer nofollow'/, 'the source link leaves the app safely');
  for (const field of ['grantor', 'borrower', 'address', 'apn', 'parties']) assert.doesNotMatch(loans, new RegExp(`\\.${field}\\b`), `loans.jsx reads ${field}`);
  assert.match(src('candidates/[key]/sidebar.jsx'), /<LoansCard loans=\{loans\} watched=\{watched\} href=\{href\} \/>/);
  assert.match(src('candidates/[key]/paper-estimate.jsx'), /tab === 'loans' \? <LoansSection loans=\{loans\} watched=\{watched\} \/>/);
  assert.match(src('candidates/[key]/page.jsx'), /<BankRecord [^>]*loans=\{d\.loans\} watched=\{d\.watched\}/);
  assert.match(src('status/status-view.jsx'), /County records[\s\S]*New this week[\s\S]*No county is watched yet/);
  assert.doesNotMatch(src('status/status-view.jsx'), /'use client'/);
});
