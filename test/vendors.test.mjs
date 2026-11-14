// PRD E7-S2: a contact-data vendor is tested on people we already know before anyone pays for it. No vendor API, no key: a principal
// exports the vendor's results to a file and the harness compares it with the known list. Invented people and .test domains only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { makeDir, put, loadJson } from './kit.mjs';
import { readJson, readJsonl } from '../src/store.mjs';
import { parseCsv, parseResults, runVendorTest, passVendor, vendorPassed, vendorSlug, listVendors } from '../src/vendors.mjs';

const NOW = new Date('2026-11-14T12:00:00Z');
const CONTACTS = loadJson('contacts.json');
const FIRSTS = ['Avery', 'Blake', 'Casey', 'Dana', 'Emery', 'Finley', 'Gray', 'Harper', 'Indy', 'Jules'];
const LASTS = ['Example', 'Sample', 'Testwell', 'Placeholder', 'Fakely'];
const BANKS = [['Acme Community Bank', 'acmebank.test'], ['Bravo Bank, N.A.', 'bravobank.test']];
// Fifty invented people we "know": name, institution, address, title and the date a principal checked them.
const KNOWN = () => FIRSTS.flatMap((f, i) => LASTS.map((l, j) => {
  const [inst, dom] = BANKS[(i + j) % 2];
  return { id: `k${i * 5 + j + 1}`, name: `${f} ${l}`, institution: inst, email: `${f}.${l}@${dom}`.toLowerCase(), title: j % 2 ? 'Chief Credit Officer' : 'Head of Special Assets', asOf: '2026-10-01' };
}));
const csvOf = (rows) => ['Full Name,Company,Email Address,Job Title', ...rows.map((r) => [r.name, r.institution, r.email, r.title].map((v) => (/[",\n]/.test(v ?? '') ? `"${String(v).replace(/"/g, '""')}"` : v ?? '')).join(','))].join('\r\n');

test('CSV: quoted fields with commas, doubled quotes and line breaks, CRLF, a byte-order mark, blank lines', () => {
  const rows = parseCsv('﻿name,company\r\n"Sample, Avery","Acme ""Community"" Bank"\r\n\r\n"Two\nLines",Bravo\n');
  assert.deepEqual(rows, [['name', 'company'], ['Sample, Avery', 'Acme "Community" Bank'], ['Two\nLines', 'Bravo']]);
});

test('the results file: CSV or JSON, with the vendor\'s own column names mapped; first and last name joined', () => {
  const csv = parseResults('First Name,Last Name,Organization,Work Email,Position\nAvery,Example,Acme Community Bank,avery.example@acmebank.test,CCO\n', 'export.csv');
  assert.deepEqual(csv.records, [{ name: 'Avery Example', institution: 'Acme Community Bank', email: 'avery.example@acmebank.test', title: 'CCO' }]);
  const json = parseResults(JSON.stringify({ results: [{ full_name: 'Blake Sample', company_name: 'Bravo Bank', email: 'blake@bravobank.test', job_title: 'EVP' }] }), 'export.json');
  assert.deepEqual(json.records, [{ name: 'Blake Sample', institution: 'Bravo Bank', email: 'blake@bravobank.test', title: 'EVP' }]);
  assert.equal(json.format, 'json');
  assert.throws(() => parseResults('Colour,Size\nred,9\n', 'x.csv'), /no name column/);
  assert.throws(() => parseResults('{ nope', 'x.json'), /not valid JSON/);
});

test('the harness matches the vendor\'s records to the known list by normalized name and institution, and counts emails, titles and coverage', () => {
  const dir = makeDir();
  const known = KNOWN().slice(0, 6);
  put(dir, 'contacts/known.json', { _note: 'invented', people: known });
  const rows = [
    { ...known[0], name: 'AVERY  EXAMPLE', institution: 'Acme Community Bank, N.A.' },                       // correct email, current title (k1)
    { ...known[1], name: 'Avery J. Sample', email: 'asample@acmebank.test', title: 'Head of Special Assets' }, // wrong email, title the same (k2: CCO -> stale)
    { ...known[2], email: '', title: '' },                                                                    // missing email and title (k3)
    { ...known[3], title: 'CCO' },                                                                            // the abbreviation is the same title (k4)
    { name: 'Nobody Known', institution: 'Acme Community Bank', email: 'nobody@acmebank.test', title: 'VP' },  // not on the list
    { ...known[0] },                                                                                          // a duplicate of k1
  ];
  const { report, paths } = runVendorTest({ dir, vendor: 'Contact Co', text: csvOf(rows), fileName: 'contact-co.csv', contacts: CONTACTS, by: 'Pat Example', now: NOW });
  assert.deepEqual([report.vendor, report.vendorName, report.date, report.format], ['contact-co', 'Contact Co', '2026-11-14', 'csv']);
  assert.deepEqual([report.known, report.vendorRecords, report.matched, report.unmatchedVendorRecords, report.duplicates], [6, 6, 4, 1, 1]);
  assert.deepEqual(report.emails, { correct: 2, wrong: 1, missing: 3, notJudged: 0 });
  assert.deepEqual(report.titles, { current: 2, stale: 1, missing: 3, notJudged: 0 });
  assert.deepEqual(report.rates, { coverage: 4 / 6, correctEmail: 2 / 6, wrongEmail: 1 / 3, titleCurrent: 2 / 6 });
  assert.deepEqual(report.rows.map((r) => [r.ref, r.matched, r.email, r.title]), [['k1', true, 'correct', 'current'], ['k2', true, 'wrong', 'stale'], ['k3', true, 'missing', 'missing'], ['k4', true, 'correct', 'current'], ['k5', false, 'missing', 'missing'], ['k6', false, 'missing', 'missing']]);
  assert.equal(report.meets.ok, false);
  assert.ok(report.meets.failures.some((f) => /sample of 6/.test(f)));
  assert.match(report.resultsFile.sha256, /^[0-9a-f]{64}$/);
  assert.ok(paths.json.endsWith(join('contacts', 'vendor-tests', 'contact-co-2026-11-14.json')) && paths.md.endsWith('contact-co-2026-11-14.md'));
  // The report holds refs and counts. Names, addresses and titles stay on the known list only.
  for (const f of [paths.json, paths.md]) {
    const text = readFileSync(f, 'utf8');
    for (const bad of [/avery/i, /Testwell/, /Nobody/, /@/, /Chief Credit/, /Special Assets/, /Acme/, /Bravo/]) assert.doesNotMatch(text, bad, `${f} holds ${bad}`);
  }
  const line = readJsonl(join(dir, 'audit.jsonl')).find((l) => l.type === 'vendor_test');
  assert.deepEqual([line.vendor, line.known, line.matched, line.by], ['contact-co', 6, 4, 'Pat Example']);
});

test('a pass is recorded only when the latest report meets every threshold in contacts.json; a vendor source needs it', () => {
  const dir = makeDir();
  const known = KNOWN();
  put(dir, 'contacts/known.json', { people: known });
  assert.throws(() => passVendor({ dir, vendor: 'Contact Co', by: 'Pat', contacts: CONTACTS, now: NOW }), /No vendor test for contact-co/);
  // Too many wrong addresses: refused, with the reason.
  const sloppy = known.map((k, i) => (i % 4 === 0 ? { ...k, email: `x${i}@wrong.test` } : k));
  runVendorTest({ dir, vendor: 'Contact Co', text: csvOf(sloppy), fileName: 'a.csv', contacts: CONTACTS, by: 'Pat', now: new Date('2026-11-13T12:00:00Z') });
  const refused = passVendor({ dir, vendor: 'Contact Co', by: 'Pat', contacts: CONTACTS, now: NOW });
  assert.equal(refused.ok, false);
  assert.ok(refused.failures.some((f) => /wrong-email rate/.test(f)), JSON.stringify(refused.failures));
  assert.equal(vendorPassed(dir, 'Contact Co'), null);
  // The latest report is the one that counts.
  runVendorTest({ dir, vendor: 'Contact Co', text: csvOf(known), fileName: 'b.csv', contacts: CONTACTS, by: 'Pat', now: NOW });
  assert.throws(() => passVendor({ dir, vendor: 'Contact Co', contacts: CONTACTS, now: NOW }), /--by/);
  const ok = passVendor({ dir, vendor: 'Contact Co', by: 'Pat Example', contacts: CONTACTS, now: NOW });
  assert.equal(ok.ok, true, JSON.stringify(ok.failures));
  const pass = vendorPassed(dir, 'contact co');
  assert.deepEqual([pass.vendor, pass.passed, pass.by, pass.report], ['Contact Co', true, 'Pat Example', 'contacts/vendor-tests/contact-co-2026-11-14.json']);
  assert.deepEqual(pass.thresholds, CONTACTS.vendorPass ? Object.fromEntries(Object.entries(CONTACTS.vendorPass).filter(([k]) => !k.startsWith('_'))) : null);
  assert.ok(readJsonl(join(dir, 'audit.jsonl')).some((l) => l.type === 'vendor_passed' && l.vendor === 'contact-co' && l.by === 'Pat Example'));
  assert.deepEqual(listVendors({ dir }).map((v) => [v.vendor, v.tests, v.passed]), [['contact-co', 2, true]]);
  assert.equal(readJson(join(dir, 'contacts', 'vendors.json')).passes['contact-co'].passed, true);
});

test('vendor names become safe file names; bad input is refused plainly', () => {
  assert.equal(vendorSlug('  Contact Co., Inc. '), 'contact-co-inc');
  assert.throws(() => vendorSlug('***'), /vendor name/);
  const dir = makeDir();
  assert.throws(() => runVendorTest({ dir, vendor: 'X', text: 'name,company\n', fileName: 'x.csv', contacts: CONTACTS, by: 'Pat', now: NOW }), /No known list/);
  put(dir, 'contacts/known.json', { people: [{ name: 'Avery Example' }] });
  assert.throws(() => runVendorTest({ dir, vendor: 'X', text: 'name,company\n', fileName: 'x.csv', contacts: CONTACTS, by: 'Pat', now: NOW }), /no person with both a name and an institution/);
});

test('contacts.json: every rule is a placeholder with a note, and the thresholds are sane', () => {
  assert.match(CONTACTS._note, /PLACEHOLDER/);
  assert.ok(Number.isInteger(CONTACTS.reverifyDays) && CONTACTS.reverifyDays > 0);
  assert.equal(typeof CONTACTS.requireMx, 'boolean');
  const t = CONTACTS.vendorPass;
  assert.match(t._note, /PLACEHOLDER/);
  assert.equal(t.minSample, 50);
  for (const k of ['minCorrectEmailRate', 'maxWrongEmailRate', 'minTitleCurrentRate']) assert.ok(t[k] > 0 && t[k] < 1, k);
  assert.ok(t.minCorrectEmailRate > t.maxWrongEmailRate);
  assert.doesNotMatch(JSON.stringify(CONTACTS), /@/, 'a rule file holds no address');
});
