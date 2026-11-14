// The vendor test harness (PRD E7-S2): a contact-data vendor is tested on people we already know before anyone pays for it, and no vendor
// is used until a principal records a pass against the thresholds in contacts.json. There is no vendor API here and no key: a principal
// exports the vendor's results (CSV or JSON) and the harness compares them with the known list, contacts/known.json in the data folder.
// The report holds refs into the known list, counts and rates. Names, addresses and titles stay on the known list only, so a deletion
// request (src/forget.mjs) removes a person from one place. Nothing here contacts anyone.
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { readJson, writeJson, writeText, listFiles, audit } from './store.mjs';
import { norm, normName } from './guard.mjs';

const C = (dir, ...p) => join(dir, 'contacts', ...p);
const need = (v, what) => { const s = String(v ?? '').trim(); if (!s || s === 'true') throw new Error(`${what} is required.`); return s; };
const str = (v) => (typeof v === 'string' ? v.trim() : v === null || v === undefined ? '' : String(v).trim());
const lower = (v) => str(v).toLowerCase();
const ymd = (d) => new Date(d).toISOString().slice(0, 10);
const pct = (v) => (v === null || v === undefined ? 'n/a' : `${(v * 100).toFixed(1)}%`);

export function vendorSlug(vendor) {
  const s = norm(vendor).replace(/ /g, '-').slice(0, 48).replace(/-+$/, '');
  if (!/^[a-z0-9][a-z0-9-]*$/.test(s)) throw new Error(`"${vendor}" is not a vendor name (it needs letters or digits).`);
  return s;
}

// An institution's name for matching: legal suffixes and single letters dropped, so "Acme Community Bank, N.A." is "acme community bank".
const LEGAL = new Set(['the', 'inc', 'incorporated', 'corp', 'corporation', 'co', 'company', 'llc', 'ltd', 'plc', 'fsb', 'ssb', 'na']);
export const instKey = (name) => norm(name).split(' ').filter((t) => t.length > 1 && !LEGAL.has(t)).join(' ');
const ABBR = { ceo: 'chief executive officer', cfo: 'chief financial officer', coo: 'chief operating officer', cco: 'chief credit officer', cro: 'chief risk officer', evp: 'executive vice president', svp: 'senior vice president', vp: 'vice president', avp: 'assistant vice president', sr: 'senior', mgr: 'manager', dir: 'director' };
export const titleKey = (t) => norm(t).split(' ').filter(Boolean).map((w) => ABBR[w] ?? w).join(' ');
const personKey = (name, inst) => `${normName(name)}|${instKey(inst)}`;

// ---- Reading a vendor's export -----------------------------------------------------------------------------------------------
export function parseCsv(text) {
  const s = String(text ?? '').replace(/^﻿/, '');
  const rows = []; let row = []; let f = ''; let q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; continue; }
    if (c === '"') { q = true; continue; }
    if (c === ',') { row.push(f); f = ''; continue; }
    if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; continue; }
    f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}

// The vendor's own column names, compared without case, spaces or punctuation.
const KEY = (k) => norm(k).replace(/ /g, '');
const COLUMNS = {
  name: ['name', 'fullname', 'contactname', 'personname'],
  first: ['firstname', 'givenname', 'first'],
  last: ['lastname', 'surname', 'familyname', 'last'],
  institution: ['institution', 'company', 'companyname', 'organization', 'organisation', 'org', 'account', 'accountname', 'employer', 'bank', 'bankname'],
  email: ['email', 'emailaddress', 'workemail', 'businessemail'],
  title: ['title', 'jobtitle', 'position', 'role'],
};
const fieldOf = (k) => Object.keys(COLUMNS).find((f) => COLUMNS[f].includes(KEY(k))) ?? null;
const toRecord = (get) => ({ name: str(get('name')) || [str(get('first')), str(get('last'))].filter(Boolean).join(' '), institution: str(get('institution')), email: lower(get('email')), title: str(get('title')) });

export function parseResults(text, fileName = '') {
  const body = String(text ?? '').replace(/^﻿/, '');
  const json = /\.json$/i.test(fileName) || /^\s*[[{]/.test(body);
  if (json) {
    let data;
    try { data = JSON.parse(body); } catch { throw new Error('The results file is not valid JSON.'); }
    const list = Array.isArray(data) ? data : [data?.results, data?.people, data?.records, data?.contacts, data?.data].find(Array.isArray);
    if (!list) throw new Error('The results file holds no list of people (an array, or "results", "people", "records", "contacts" or "data").');
    const records = list.filter((o) => o && typeof o === 'object').map((o) => {
      const by = {};
      for (const [k, v] of Object.entries(o)) { const f = fieldOf(k); if (f && by[f] === undefined) by[f] = v; }
      return toRecord((f) => by[f]);
    }).filter((r) => r.name);
    return { format: 'json', records };
  }
  const rows = parseCsv(body);
  if (!rows.length) return { format: 'csv', records: [] };
  const cols = rows[0].map(fieldOf);
  const has = (f) => cols.includes(f);
  if (!has('name') && !(has('first') && has('last'))) throw new Error('The results file has no name column (name, or first and last name).');
  if (!has('institution')) throw new Error('The results file has no institution column (institution, company or organization).');
  const records = rows.slice(1).map((r) => toRecord((f) => r[cols.indexOf(f)] ?? '')).filter((r) => r.name);
  return { format: 'csv', records };
}

// ---- The test -----------------------------------------------------------------------------------------------------------------
function knownList(dir) {
  const doc = readJson(C(dir, 'known.json'), null);
  if (!doc) throw new Error('No known list. A principal writes contacts/known.json in the data folder: the people we already know, each with name, institution, email, title and asOf (the date it was checked).');
  const list = Array.isArray(doc) ? doc : Array.isArray(doc.people) ? doc.people : [];
  const known = list.map((k, i) => ({ k, ref: /^[A-Za-z0-9_-]{1,32}$/.test(str(k?.id)) ? str(k.id) : `#${i + 1}` })).filter(({ k }) => str(k?.name) && str(k?.institution));
  if (!known.length) throw new Error('The known list has no person with both a name and an institution.');
  return known;
}

// Whether a report meets the thresholds (contacts.json vendorPass). Each failure is a plain sentence.
export function checkThresholds(report, t = {}) {
  const failures = [];
  const num = (k) => (typeof t?.[k] === 'number' ? t[k] : null);
  const rule = (k, test, sentence) => { if (num(k) === null) failures.push(`contacts.json vendorPass has no ${k}.`); else if (test(num(k))) failures.push(sentence(num(k))); };
  rule('minSample', (m) => report.known < m, (m) => `The sample of ${report.known} known people is below the minimum of ${m}.`);
  rule('minCorrectEmailRate', (m) => report.rates.correctEmail === null || report.rates.correctEmail < m, (m) => `The correct-email rate ${pct(report.rates.correctEmail)} is below the minimum ${pct(m)}.`);
  rule('maxWrongEmailRate', (m) => report.rates.wrongEmail === null || report.rates.wrongEmail > m, (m) => (report.rates.wrongEmail === null ? 'The vendor gave no address for any known person, so the wrong-email rate cannot be judged.' : `The wrong-email rate ${pct(report.rates.wrongEmail)} is above the maximum ${pct(m)}.`));
  rule('minTitleCurrentRate', (m) => report.rates.titleCurrent === null || report.rates.titleCurrent < m, (m) => `The title-current rate ${pct(report.rates.titleCurrent)} is below the minimum ${pct(m)}.`);
  return { ok: failures.length === 0, failures };
}
const thresholdsOf = (t = {}) => Object.fromEntries(Object.entries(t ?? {}).filter(([k]) => !k.startsWith('_')));

// Compares a vendor's export with the known list, by normalized name and institution. For each known person: the email is correct, wrong
// or missing (not judged when we hold none), and the title current, stale or missing (not judged when we hold none). Writes
// contacts/vendor-tests/<vendor>-<date>.json and .md.
export function runVendorTest({ dir, vendor, text, fileName = '', contacts = {}, by = null, now = new Date() }) {
  const who = str(by) && by !== true ? str(by) : null;
  const slug = vendorSlug(need(vendor, 'The vendor (--vendor)'));
  const known = knownList(dir);
  const { format, records } = parseResults(text, fileName);
  const knownKeys = new Set(known.map(({ k }) => personKey(k.name, k.institution)));
  const byKey = new Map();
  let duplicates = 0; let unmatched = 0;
  for (const r of records) {
    const key = personKey(r.name, r.institution);
    if (byKey.has(key)) { duplicates++; continue; }
    byKey.set(key, r);
    if (!knownKeys.has(key)) unmatched++;
  }
  const emails = { correct: 0, wrong: 0, missing: 0, notJudged: 0 };
  const titles = { current: 0, stale: 0, missing: 0, notJudged: 0 };
  const rows = known.map(({ k, ref }) => {
    const v = byKey.get(personKey(k.name, k.institution)) ?? null;
    const email = !lower(k.email) ? 'not_judged' : !v?.email ? 'missing' : v.email === lower(k.email) ? 'correct' : 'wrong';
    const title = !str(k.title) ? 'not_judged' : !str(v?.title) ? 'missing' : titleKey(v.title) === titleKey(k.title) ? 'current' : 'stale';
    emails[email === 'not_judged' ? 'notJudged' : email]++;
    titles[title === 'not_judged' ? 'notJudged' : title]++;
    return { ref, matched: !!v, email, title };
  });
  const matched = rows.filter((r) => r.matched).length;
  const withEmail = known.length - emails.notJudged;
  const withTitle = known.length - titles.notJudged;
  const rates = {
    coverage: matched / known.length,
    correctEmail: withEmail ? emails.correct / withEmail : null,
    wrongEmail: emails.correct + emails.wrong ? emails.wrong / (emails.correct + emails.wrong) : null,
    titleCurrent: withTitle ? titles.current / withTitle : null,
  };
  const date = ymd(now);
  const base = { vendor: slug, vendorName: str(vendor), date, ranAt: now.toISOString(), by: who, format, resultsFile: { format, records: records.length, sha256: createHash('sha256').update(String(text ?? '')).digest('hex') }, known: known.length, vendorRecords: records.length, matched, unmatchedVendorRecords: unmatched, duplicates, emails, titles, rates };
  const thresholds = thresholdsOf(contacts.vendorPass);
  const report = { ...base, thresholds, meets: checkThresholds(base, contacts.vendorPass), rows };
  const paths = { json: C(dir, 'vendor-tests', `${slug}-${date}.json`), md: C(dir, 'vendor-tests', `${slug}-${date}.md`) };
  writeJson(paths.json, report);
  writeText(paths.md, renderVendorReport(report));
  audit(dir, { type: 'vendor_test', vendor: slug, date, known: known.length, matched, vendorRecords: records.length, meets: report.meets.ok, by: who });
  return { report, paths };
}

export function renderVendorReport(r) {
  const L = [`# Vendor test: ${r.vendor}, ${r.date}`, '', `For principals only.${r.by ? ` Run by ${r.by}.` : ''} The vendor's export (${r.format}, ${r.vendorRecords} record(s), sha256 ${r.resultsFile.sha256.slice(0, 12)}) compared with the known list (${r.known} people), by name and institution. Rows name the known list's refs only.`, ''];
  L.push(`**${r.meets.ok ? 'Meets every threshold' : 'Does not meet the thresholds'}** (contacts.json, placeholders a principal sets).${r.meets.ok ? ' A principal may record a pass: outbound contacts vendor-pass.' : ''}`, '');
  if (!r.meets.ok) L.push(...r.meets.failures.map((f) => `- ${f}`), '');
  L.push('| Measure | Value | Threshold |', '|---|---|---|');
  L.push(`| Known people | ${r.known} | at least ${r.thresholds.minSample ?? 'unset'} |`);
  L.push(`| Coverage (found by the vendor) | ${pct(r.rates.coverage)} (${r.matched}) | |`);
  L.push(`| Correct email, of those we hold | ${pct(r.rates.correctEmail)} (${r.emails.correct}) | at least ${pct(r.thresholds.minCorrectEmailRate)} |`);
  L.push(`| Wrong email, of those the vendor gave | ${pct(r.rates.wrongEmail)} (${r.emails.wrong}) | at most ${pct(r.thresholds.maxWrongEmailRate)} |`);
  L.push(`| Title current, of those we hold | ${pct(r.rates.titleCurrent)} (${r.titles.current}) | at least ${pct(r.thresholds.minTitleCurrentRate)} |`, '');
  L.push(`Emails: ${r.emails.correct} correct, ${r.emails.wrong} wrong, ${r.emails.missing} missing, ${r.emails.notJudged} not judged. Titles: ${r.titles.current} current, ${r.titles.stale} stale, ${r.titles.missing} missing, ${r.titles.notJudged} not judged. Vendor records not on the known list: ${r.unmatchedVendorRecords}. Duplicates: ${r.duplicates}.`, '');
  L.push('| Ref | Found | Email | Title |', '|---|---|---|---|', ...r.rows.map((x) => `| ${x.ref} | ${x.matched ? 'yes' : 'no'} | ${x.email.replace('_', ' ')} | ${x.title.replace('_', ' ')} |`));
  return `${L.join('\n')}\n`;
}

// ---- Passes ---------------------------------------------------------------------------------------------------------------------
function latestReport(dir, slug) {
  const re = new RegExp(`^${slug}-(\\d{4}-\\d{2}-\\d{2})\\.json$`);
  const f = listFiles(C(dir, 'vendor-tests'), '.json').filter((x) => re.test(x)).sort().at(-1);
  return f ? { rel: `contacts/vendor-tests/${f}`, report: readJson(C(dir, 'vendor-tests', f)) } : null;
}

// A pass, only when the latest report meets every threshold as they stand now. Recorded in contacts/vendors.json.
export function passVendor({ dir, vendor, by, contacts = {}, now = new Date() }) {
  const who = need(by, 'A name for who records the pass (--by)');
  const slug = vendorSlug(need(vendor, 'The vendor (--vendor)'));
  const latest = latestReport(dir, slug);
  if (!latest) throw new Error(`No vendor test for ${slug}. Run one first: outbound contacts vendor-test --vendor "${str(vendor)}" --results FILE`);
  const meets = checkThresholds(latest.report, contacts.vendorPass);
  if (!meets.ok) {
    audit(dir, { type: 'vendor_pass_refused', vendor: slug, by: who, report: latest.rel, failures: meets.failures.length });
    return { ok: false, failures: meets.failures, report: latest.rel };
  }
  const all = readJson(C(dir, 'vendors.json'), { passes: {} });
  const pass = { vendor: latest.report.vendorName || str(vendor), slug, passed: true, by: who, at: now.toISOString(), report: latest.rel, reportDate: latest.report.date, known: latest.report.known, rates: latest.report.rates, thresholds: thresholdsOf(contacts.vendorPass) };
  writeJson(C(dir, 'vendors.json'), { ...all, passes: { ...(all.passes ?? {}), [slug]: pass } });
  audit(dir, { type: 'vendor_passed', vendor: slug, by: who, report: latest.rel });
  return { ok: true, failures: [], pass };
}

// The recorded pass for a vendor, or null. A vendor as a source of a field, or as how an address is known, needs one.
export function vendorPassed(dir, vendor) {
  let slug;
  try { slug = vendorSlug(vendor); } catch { return null; }
  const p = readJson(C(dir, 'vendors.json'), null)?.passes?.[slug];
  return p?.passed ? p : null;
}

export function listVendors({ dir }) {
  const passes = readJson(C(dir, 'vendors.json'), { passes: {} }).passes ?? {};
  const tests = new Map();
  for (const f of listFiles(C(dir, 'vendor-tests'), '.json')) {
    const m = f.match(/^(.+)-(\d{4}-\d{2}-\d{2})\.json$/);
    if (!m) continue;
    const t = tests.get(m[1]) ?? { vendor: m[1], tests: 0, latest: null };
    t.tests++; if (!t.latest || m[2] > t.latest) t.latest = m[2];
    tests.set(m[1], t);
  }
  for (const k of Object.keys(passes)) if (!tests.has(k)) tests.set(k, { vendor: k, tests: 0, latest: null });
  return [...tests.values()].sort((a, b) => (a.vendor < b.vendor ? -1 : 1)).map((t) => ({ ...t, passed: !!passes[t.vendor]?.passed, passedBy: passes[t.vendor]?.by ?? null, passedAt: passes[t.vendor]?.at ?? null }));
}
