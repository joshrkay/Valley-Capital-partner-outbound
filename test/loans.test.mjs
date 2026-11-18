// County loan documents (docs/county-loans.md, src/loans.mjs): the record, its stable id and content hash, the weekly diff (new written,
// changed updated, unchanged left alone), the index (each bank's file, the review list) and the dated events. Invented data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { makeDir, put } from './kit.mjs';
import { readJson, readJsonl } from '../src/store.mjs';
import { buildDocument, documentId, hashDocument, diffDocuments, writeDiff, buildLoanIndex, eventLabel, loanEvents, loansPaths, loanBankRel, readBankLoans,
  DOC_TYPES, STAGES, ROLES, AMOUNT_BASES, RECORD_KEYS, CONTEXT_NOTE } from '../src/loans.mjs';
import { exampleCounty } from '../src/sources/counties/example.mjs';
import { INSTITUTIONS, BORROWERS, ADDRESSES } from './county-notices-fake.mjs';

const SRC = exampleCounty;
const AT = '2026-11-16T12:00:00.000Z';
const doc = (over = {}) => ({
  documentType: 'notice_of_trustee_sale', documentNumber: '2026-004105', dates: { recorded: '2026-11-11', filed: null, sale: '2026-12-09' },
  parties: [{ role: 'beneficiary', name: 'Example Bank, N.A.' }, { role: 'trustee', name: 'Sample Trustee Services LLC' }, { role: 'grantor', name: 'Sample Office Owner LLC' }],
  property: { address: '500 Sample Boulevard, Anytown, CO 80000', apn: '0000-00-0-00-005', useCode: null, propertyType: 'office' },
  amounts: { originalPrincipal: { value: 7800000, basis: 'document' }, unpaidBalance: { value: 7215000, basis: 'document' } },
  deedOfTrust: { documentNumber: '2018-0333222', recorded: '2018-04-27' },
  url: 'https://publictrustee.example/documents/2026-004105', ...over,
});
const build = (over = {}, at = AT, runId = 'county:example-county-1') => buildDocument(doc(over), { source: SRC, fetchedAt: at, runId });

test('the record: every field the brief names, with its basis, its sources and a content hash; nothing else', () => {
  const { record: r, errors } = build();
  assert.deepEqual(errors, []);
  assert.deepEqual(Object.keys(r).sort(), RECORD_KEYS.filter((k) => !['firstSeenAt', 'firstRunId', 'updatedAt', 'updatedRunId'].includes(k)).sort());
  assert.equal(r.id, 'example-county:2026-004105');
  assert.deepEqual([r.sourceId, r.county, r.state], ['example-county', { fips: '99001', name: 'Example' }, 'CO']);
  assert.deepEqual(r.dates, { recorded: '2026-11-11', filed: null, sale: '2026-12-09', notice: null });
  assert.deepEqual(r.parties.map((p) => p.role), ['beneficiary', 'trustee', 'grantor']);
  assert.deepEqual([r.salePlace, r.unread], [null, []], 'no sale place stated; every field read');
  assert.deepEqual(r.amounts.unpaidBalance, { value: 7215000, unit: 'dollars', basis: 'document' });
  assert.deepEqual(r.amounts.originalPrincipal.unit, 'dollars');
  assert.deepEqual(r.deedOfTrust, { documentNumber: '2018-0333222', recorded: '2018-04-27', dated: null, book: null, page: null });
  assert.deepEqual(r.sources, [{ url: 'https://publictrustee.example/documents/2026-004105', fetchedAt: AT }]);
  assert.match(r.contentHash, /^[0-9a-f]{16}$/);
  assert.equal(r.contextOnly, true);
  assert.equal(r._source.source, 'county:example-county');
  // Every type the brief lists, each with a stage; every role; every amount basis.
  assert.deepEqual(Object.keys(DOC_TYPES).sort(), ['assignment', 'deed_of_trust', 'election_and_demand', 'lis_pendens', 'notice_of_default', 'notice_of_trustee_sale', 'release', 'rule_120_notice', 'trustees_deed']);
  for (const t of Object.values(DOC_TYPES)) assert.ok(STAGES[t.stage], t.label);
  assert.deepEqual([...ROLES], ['lender', 'beneficiary', 'holder', 'assignor', 'assignee', 'trustee', 'attorney', 'borrower', 'grantor', 'servicer']);
  assert.deepEqual(Object.keys(AMOUNT_BASES), ['document', 'index', 'not-stated', 'not-read']);
});

test('a stable id per source and document: case and spaces do not matter, and another source never collides', () => {
  assert.equal(documentId('example-county', ' 2026-004105 '), 'example-county:2026-004105');
  assert.equal(documentId('example-county', 'fc-2026-0001/ned'), 'example-county:FC-2026-0001/NED');
  assert.notEqual(documentId('example-county', '1'), documentId('other-county', '1'));
  assert.throws(() => documentId('example-county', ''), /empty/);
  assert.throws(() => documentId('example-county', '2026;drop'), /characters/);
  assert.throws(() => documentId('../x', '1'), /Invalid id/);
});

test('the content hash ignores when and by which run a document was read, and changes with its content', () => {
  const a = build().record, b = build({}, '2026-11-23T12:00:00.000Z', 'county:example-county-2').record;
  assert.equal(a.contentHash, b.contentHash);
  assert.equal(hashDocument(a), a.contentHash);
  assert.notEqual(build({ amounts: { ...doc().amounts, unpaidBalance: { value: 7100000, basis: 'document' } } }).record.contentHash, a.contentHash);
  assert.notEqual(build({ dates: { ...doc().dates, sale: '2026-12-16' } }).record.contentHash, a.contentHash);
});

test('a document is refused, field by field, before it is a record: type, number, dates, roles, amounts and their basis, link, unknown fields', () => {
  const errs = (over) => build(over).errors.join(' | ');
  assert.match(errs({ documentType: 'mortgage' }), /document type "mortgage"/);
  assert.match(errs({ documentNumber: '' }), /document number/);
  assert.match(errs({ dates: { recorded: '11/11/2026' } }), /dates.recorded/);
  assert.match(errs({ dates: { recorded: null, filed: null } }), /no recording, filing or notice date/);
  assert.deepEqual(errs({ dates: { recorded: null, filed: null, notice: '2026-11-10', sale: '2026-12-01' } }), '', 'a notice known by its own date');
  assert.match(errs({ deedOfTrust: { documentNumber: '2018-0333222', dated: '2018-02-30' } }), /deedOfTrust.dated "2018-02-30"/);
  assert.match(errs({ unread: ['borrower', 'phone'] }), /unread: "phone"/);
  assert.match(errs({ parties: [{ role: 'mortgagor', name: 'X' }, { role: 'beneficiary', name: 'Example Bank, N.A.' }] }), /party role "mortgagor"/);
  assert.match(errs({ parties: [{ role: 'grantor', name: 'Sample Holdings LLC' }] }), /names no lender/);
  assert.match(errs({ amounts: { originalPrincipal: { value: 5, basis: 'not-stated' } } }), /has no value/);
  assert.match(errs({ amounts: { originalPrincipal: { value: null, basis: 'document' } } }), /needs a value/);
  assert.match(errs({ amounts: { originalPrincipal: { value: Number.NaN, basis: 'document' } } }), /needs a value/);
  assert.match(errs({ amounts: { originalPrincipal: { value: 5, basis: 'guess' } } }), /basis "guess"/);
  assert.match(errs({ url: 'https://elsewhere.example/doc' }), /not one of the source's hosts/);
  assert.match(errs({ url: 'javascript:alert(1)' }), /not a web address/);
  assert.match(errs({ borrowerPhone: '555-0100' }), /"borrowerPhone" is not a field/);
  assert.match(errs({ property: { propertyType: 'castle' } }), /property type "castle"/);
  // An amount the adapter did not give is "not read yet", never zero.
  assert.deepEqual(build({ amounts: {} }).record.amounts.unpaidBalance, { value: null, unit: 'dollars', basis: 'not-read' });
});

test('the weekly diff: a new document is written, a changed one updated keeping when it was first seen, an unchanged one left alone', () => {
  const week1 = [build().record, build({ documentNumber: '2026-004101', documentType: 'election_and_demand' }).record];
  const d1 = diffDocuments({}, week1, { now: new Date(AT), runId: 'r1' });
  assert.deepEqual([d1.added.sort(), d1.changed, d1.unchanged], [['example-county:2026-004101', 'example-county:2026-004105'], [], []]);
  assert.equal(d1.next['example-county:2026-004105'].firstSeenAt, AT);
  assert.equal(d1.next['example-county:2026-004105'].firstRunId, 'r1');

  const later = '2026-11-23T12:00:00.000Z';
  const changed = build({ amounts: { ...doc().amounts, unpaidBalance: { value: 7100000, basis: 'document' } } }, later, 'r2').record;
  const same = build({ documentNumber: '2026-004101', documentType: 'election_and_demand' }, later, 'r2').record;
  const fresh = build({ documentNumber: '2026-004120' }, later, 'r2').record;
  const d2 = diffDocuments(d1.next, [changed, same, fresh, fresh], { now: new Date(later), runId: 'r2' });
  assert.deepEqual(d2.added, ['example-county:2026-004120'], 'a new document is detectable as new');
  assert.deepEqual(d2.changed, [{ id: 'example-county:2026-004105', fields: ['amounts'] }]);
  assert.deepEqual(d2.unchanged, ['example-county:2026-004101']);
  assert.equal(d2.duplicates, 1);
  const upd = d2.next['example-county:2026-004105'];
  assert.deepEqual([upd.firstSeenAt, upd.firstRunId, upd.updatedAt, upd.updatedRunId, upd.amounts.unpaidBalance.value], [AT, 'r1', later, 'r2', 7100000]);
  assert.equal(d2.next['example-county:2026-004101'], d1.next['example-county:2026-004101'], 'an unchanged document is the same object: not rewritten, its fetch date kept');
  assert.equal(d2.next['example-county:2026-004101'].sources[0].fetchedAt, AT);
  // A document no longer listed stays as history.
  const d3 = diffDocuments(d2.next, [fresh], { now: new Date(later), runId: 'r3' });
  assert.equal(Object.keys(d3.next).length, 3);
});

test('writing a diff: nothing when nothing changed; a changed field is logged by name, never its value', () => {
  const dir = makeDir();
  const r1 = build().record;
  const d1 = diffDocuments({}, [r1], { now: new Date(AT), runId: 'r1' });
  assert.equal(writeDiff(dir, 'example-county', d1, { runId: 'r1', now: new Date(AT) }), true);
  const again = diffDocuments(readJson(loansPaths(dir).docs('example-county')), [build({}, '2026-11-23T12:00:00.000Z', 'r2').record], { runId: 'r2' });
  assert.equal(writeDiff(dir, 'example-county', again, { runId: 'r2' }), false, 'a re-read of the same week writes nothing');
  const changed = diffDocuments(readJson(loansPaths(dir).docs('example-county')), [build({ parties: [{ role: 'beneficiary', name: 'Example Bank, N.A.' }, { role: 'grantor', name: 'Sample Plaza LLC' }] }).record], { runId: 'r3' });
  writeDiff(dir, 'example-county', changed, { runId: 'r3' });
  const log = readJsonl(join(dir, 'sources', 'changes.jsonl'));
  assert.deepEqual(log.map((l) => l.field), ['parties']);
  assert.ok(!JSON.stringify(log).includes('Sample'), 'no party name in the change log');
});

function seeded() {
  const dir = makeDir();
  put(dir, 'sources/fdic/institutions.json', INSTITUTIONS);
  const docs = [
    build().record,
    build({ documentNumber: '2026-004102', documentType: 'election_and_demand', parties: [{ role: 'beneficiary', name: 'MERS, as nominee for Sample Community Bank' }, { role: 'holder', name: 'Sample Community Bank' }, { role: 'grantor', name: 'Sample Retail Partners LLC' }] }).record,
    build({ documentNumber: '2026-004103', documentType: 'rule_120_notice', dates: { recorded: '2026-11-12', filed: '2026-11-13', sale: null }, parties: [{ role: 'holder', name: 'First Example Bank' }, { role: 'attorney', name: 'Sample & Example LLP' }, { role: 'grantor', name: 'Sample Storage LLC' }] }).record,
    build({ documentNumber: '2026-004104', documentType: 'assignment', parties: [{ role: 'assignor', name: 'Example Mountain Bank' }, { role: 'assignee', name: 'Sample Capital Fund LP' }, { role: 'grantor', name: 'Sample Hotel Group LLC' }] }).record,
    build({ documentNumber: '2026-004109', documentType: 'lis_pendens', parties: [{ role: 'beneficiary', name: 'Sample Bancorp' }, { role: 'grantor', name: 'Sample Plaza LLC' }] }).record,
    build({ documentNumber: '2026-004108', documentType: 'election_and_demand', parties: [{ role: 'beneficiary', name: 'Mortgage Electronic Registration Systems, Inc.' }, { role: 'holder', name: 'Example Loan Servicing LLC' }, { role: 'grantor', name: 'Sample Land Trust' }] }).record,
  ];
  const d = diffDocuments({}, docs, { now: new Date(AT), runId: 'r1' });
  writeDiff(dir, 'example-county', d, { runId: 'r1', now: new Date(AT) });
  return dir;
}

test('the index: one file per bank (no borrower, no address), the review list with candidates, names set aside apart', () => {
  const dir = seeded();
  const c = buildLoanIndex({ dir, now: new Date(AT), runId: 'r1' });
  assert.deepEqual([c.documents, c.banks, c.matchedDocuments, c.review, c.eventsNew], [6, 3, 3, 3, 3]);
  const b = readBankLoans({ dir, key: 'fdic:9001' });
  assert.deepEqual([b.key, b.contextOnly, b.note, b.counts.documents], ['fdic:9001', true, CONTEXT_NOTE, 1]);
  const l = b.loans[0];
  assert.deepEqual([l.documentType, l.stage, l.date, l.dateKind, l.saleDate, l.roles, l.propertyType, l.link], ['notice_of_trustee_sale', 'sale', '2026-11-11', 'recorded', '2026-12-09', ['beneficiary'], 'office', 'https://publictrustee.example/documents/2026-004105']);
  assert.deepEqual(l.amounts.unpaidBalance, { value: 7215000, unit: 'dollars', basis: 'document' });
  assert.deepEqual(readBankLoans({ dir, key: 'fdic:9002' }).loans[0].roles, ['beneficiary', 'holder']);
  assert.deepEqual(readBankLoans({ dir, key: 'fdic:9005' }).loans[0].roles, ['assignor']);
  assert.equal(readBankLoans({ dir, key: 'fdic:9003' }), null, 'an ambiguous name matches neither bank');
  // No borrower, grantor, address or APN in any bank's file.
  for (const k of ['fdic:9001', 'fdic:9002', 'fdic:9005']) {
    const s = JSON.stringify(readBankLoans({ dir, key: k }));
    for (const leak of [...BORROWERS, ...ADDRESSES, '0000-00-0-00-005', 'Sample Trustee']) assert.ok(!s.includes(leak), `${k} holds "${leak}"`);
  }
  const rv = readJson(loansPaths(dir).review);
  assert.deepEqual(rv.entries.map((e) => [e.name, e.status]), [['First Example Bank', 'ambiguous'], ['Sample Bancorp', 'unmatched'], ['Sample Capital Fund LP', 'unmatched']]);
  assert.deepEqual(rv.entries[0].candidates.map((x) => x.key), ['fdic:9003', 'fdic:9004']);
  assert.deepEqual(rv.setAside.map((x) => x.class).sort(), ['mers', 'servicer']);
  assert.ok(!BORROWERS.some((n) => JSON.stringify(rv).includes(n)), 'no borrower or grantor name on the review list');
  assert.equal(loanBankRel('fdic:9001'), 'loans/banks/fdic-9001.json');
});

test('events: one dated event per document newly matched to a bank, in a fixed sentence; a re-run adds none', () => {
  const dir = seeded();
  buildLoanIndex({ dir, now: new Date(AT), runId: 'r1' });
  const ev = loanEvents({ dir });
  assert.deepEqual(ev.map((e) => e.key).sort(), ['fdic:9001', 'fdic:9002', 'fdic:9005']);
  const nts = ev.find((e) => e.key === 'fdic:9001');
  assert.equal(nts.label, 'A notice of trustee\'s sale was recorded on November 11, 2026 for a loan from this bank on a property in Example County, CO.');
  assert.deepEqual([nts.kind, nts.type, nts.date, nts.basis, nts.scored, nts.contextOnly], ['event', 'county_document', '2026-11-11', 'new-document', false, true]);
  assert.match(ev.find((e) => e.key === 'fdic:9005').label, /^An assignment was recorded on .* moving a loan on a property in Example County, CO from this bank to another holder\.$/);
  const before = readFileSync(loansPaths(dir).events, 'utf8'), bankBefore = readFileSync(loansPaths(dir).bank('fdic:9001'), 'utf8');
  const again = buildLoanIndex({ dir, now: new Date('2026-11-23T12:00:00Z'), runId: 'r2' });
  assert.deepEqual([again.eventsNew, again.bankFilesWritten], [0, 0], 'idempotent: no new event, no bank file rewritten');
  assert.equal(readFileSync(loansPaths(dir).events, 'utf8'), before);
  assert.equal(readFileSync(loansPaths(dir).bank('fdic:9001'), 'utf8'), bankBefore);
  // A principal's alias later makes the lis pendens match: a "new-match" event, dated by the document.
  put(dir, 'candidates/aliases.json', { 'fdic:9002': ['Sample Bancorp'] });
  const c = buildLoanIndex({ dir, now: new Date('2026-11-24T12:00:00Z'), runId: 'loans-match-1' });
  assert.equal(c.eventsNew, 1);
  const late = loanEvents({ dir, key: 'fdic:9002' }).find((e) => e.documentType === 'lis_pendens');
  assert.deepEqual([late.basis, late.date], ['new-match', '2026-11-11']);
  assert.ok(!readJson(loansPaths(dir).review).entries.some((e) => e.name === 'Sample Bancorp'), 'it leaves the review list');
});

test('the event sentence for each role and date kind', () => {
  const r = build({ documentType: 'rule_120_notice', dates: { recorded: '2026-11-12', filed: '2026-11-13', sale: null } }).record;
  assert.equal(eventLabel(r, ['holder']), 'A Rule 120 notice was filed on November 13, 2026 for a loan this bank holds on a property in Example County, CO.');
  assert.equal(eventLabel(build({ documentType: 'assignment' }).record, ['assignee']), 'An assignment was recorded on November 11, 2026 moving a loan on a property in Example County, CO to this bank.');
  assert.equal(eventLabel(build({ documentType: 'election_and_demand' }).record, ['beneficiary', 'holder']), 'A notice of election and demand was recorded on November 11, 2026 for a loan from this bank on a property in Example County, CO.');
  // A Texas notice of sale known only by the date it states (the clerk's filed stamp not read).
  const dated = build({ dates: { recorded: null, filed: null, sale: '2026-12-01', notice: '2026-11-10' } }).record;
  assert.equal(eventLabel(dated, ['beneficiary']), 'A notice of trustee\'s sale dated November 10, 2026 was posted for a loan from this bank on a property in Example County, CO.');
});

test('platform storage: every path the pipeline writes fits the existing document store, so no migration is needed', () => {
  // The rule from supabase/migrations/20261113180000_platform_foundation.sql: documents.path, and log_lines.path for a .jsonl.
  const sql = readFileSync(new URL('../supabase/migrations/20261113180000_platform_foundation.sql', import.meta.url), 'utf8');
  assert.match(sql, /path text primary key check \(path ~ '\^\[A-Za-z0-9_\]\[A-Za-z0-9_\.\/-\]\*\$' and path !~ '\\\.\\\.' and path !~ '\\\.jsonl\$'\)/);
  const doc = /^[A-Za-z0-9_][A-Za-z0-9_./-]*$/;
  const dir = seeded();
  buildLoanIndex({ dir, now: new Date(AT), runId: 'r1' });
  const rel = (p) => p.slice(dir.length + 1);
  const P = loansPaths(dir);
  for (const p of [P.docs('example-county'), P.docs('tx-caldwell-notices-of-sale'), P.list('tx-caldwell-notices-of-sale'), P.bank('fdic:9001'), P.review, P.events, P.state].map(rel)) {
    assert.match(p, doc, p);
    assert.ok(!p.includes('..') && !p.endsWith('.jsonl'), p);
    assert.ok(p.startsWith('loans/'), p);
  }
});
