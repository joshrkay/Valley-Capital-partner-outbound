// GTS, the foreclosure software Colorado's Denver, Jefferson and Douglas public trustees run (docs/county-watchers-recon.md, section 3):
// what its reports share, for every county adapter that reads them (src/sources/counties/jefferson.mjs, douglas.mjs).
//   - The reports page ({base}/reports) lists "Available Report Types", each a GET link {base}/report?t=N. The type numbers differ by
//     county, so a report is found by its link's text, never its number.
//   - Each report's index is plain HTML: a month heading (<h2>November, 2026</h2>), then one <li> per file: a <span> with the posted date
//     (M/D/YYYY), an <a href="Report_Files/{file}.pdf"> and a <span> with a description.
//   - File names are typed by staff and some repeat every week ("Preliminary bid report-Tuesday.pdf"), so a file is known by its
//     server's ETag or Last-Modified and the report's own dates, never its name alone (planFiles, fileKey).
//   - The files are text-based PDFs, read by `pdftotext -layout` from poppler-utils, run as a child process (pdfToText). No npm package.
//   - The pre-sale list is one template in every GTS county ("<County> County Pre Sale Foreclosure List"): parsePreSaleText.
// Nothing here fetches: the shared run (src/sources/notices.mjs) does, with robots.txt, the firm's User-Agent and the pacing.
//
// THE CHECKS. Every amount and date is checked. A field that fails is left empty and named in the record's `unread` (an amount says
// 'not-read' in its basis); a label a record lacks leaves its field empty; a label no record has, a missing title or a count that does
// not match the list's own total is a format change, which fails the run before anything is written.
import { spawn, execFileSync } from 'node:child_process';
import { cellText, parseUsd } from '../notices.mjs';
import { validYmd } from '../../loans.mjs';

// ---- The reports page and a report's index -------------------------------------------------------------------------------------
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const hrefOf = (attrs) => /\bhref\s*=\s*"([^"]*)"/i.exec(attrs)?.[1] ?? /\bhref\s*=\s*'([^']*)'/i.exec(attrs)?.[1] ?? null;
// An href's entities decoded, its spaces kept as they are: a file name typed by staff can hold two in a row.
const decodeHref = (h) => String(h).replace(/&(amp|quot|apos|lt|gt|#39|#\d+);/gi, (m, x) => ({ amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', '#39': "'" })[x.toLowerCase()] ?? String.fromCodePoint(Number(x.slice(1))));

// Every report link on a GTS reports page: { text, url }, the address resolved against the page's.
export function reportLinks(html, { url }) {
  const out = [];
  for (const m of String(html ?? '').matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = hrefOf(m[1]);
    if (!href || !/(^|\/)report\?t=\d+$/i.test(decodeHref(href))) continue;
    out.push({ text: cellText(m[2]), url: new URL(decodeHref(href), url).toString() });
  }
  return out;
}
// The one link whose text is one of `texts` (case and spacing ignored), or null.
export function findReport(links, texts) {
  const want = texts.map((t) => norm(t).toLowerCase());
  return links.find((l) => want.includes(norm(l.text).toLowerCase())) ?? null;
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const ymd = (y, m, d) => { const s = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`; return validYmd(s) ? s : null; };
// "1/7/2026" -> "2026-01-07". Only a four-digit year is read: "1/7/26" is not, since its century would be a guess.
export const mdy = (s) => { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(norm(s)); return m ? ymd(m[3], m[1], m[2]) : null; };
// "November 12, 2026" (or "Tuesday, November 17, 2026") -> "2026-11-12".
export const longYmd = (s) => {
  const m = /^(?:[A-Za-z]+,\s*)?([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/.exec(norm(s));
  const mo = m ? MONTHS.indexOf(m[1].toLowerCase()) : -1;
  return mo >= 0 ? ymd(m[3], mo + 1, m[2]) : null;
};

// A report's index: its title (the <h1>) and every file it links, oldest first (GTS lists the newest first), each with its month
// heading, posted date (null when it is not a date), address, link text and description.
export function parseReportIndex(html, { url }) {
  const h = String(html ?? '');
  const title = cellText(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(h)?.[1] ?? '') || null;
  const files = [];
  // Each month heading, then the list that follows it.
  const parts = h.split(/<h2\b[^>]*>/i).slice(1);
  for (const part of parts) {
    const heading = cellText(part.split(/<\/h2>/i)[0]);
    const hm = /^([A-Za-z]+),?\s+(\d{4})$/.exec(heading);
    const month = hm && MONTHS.includes(hm[1].toLowerCase()) ? `${hm[2]}-${String(MONTHS.indexOf(hm[1].toLowerCase()) + 1).padStart(2, '0')}` : null;
    const list = /<ol\b[^>]*>([\s\S]*?)<\/ol>/i.exec(part)?.[1] ?? '';
    for (const li of list.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
      const a = /<a\b([^>]*)>([\s\S]*?)<\/a>/i.exec(li[1]);
      const href = a ? hrefOf(a[1]) : null;
      if (!href || !/(^|\/)Report_Files\/[^/]+\.pdf$/i.test(decodeHref(href))) continue;
      const before = li[1].slice(0, a.index), after = li[1].slice(a.index + a[0].length);
      const postedText = cellText(/<span\b[^>]*>([\s\S]*?)<\/span>/i.exec(before)?.[1] ?? '');
      files.push({
        month, posted: mdy(postedText), postedText, url: new URL(decodeHref(href), url).toString(),
        label: cellText(a[2]) || null, description: cellText(/<span\b[^>]*>([\s\S]*?)<\/span>/i.exec(after)?.[1] ?? '') || null,
      });
    }
  }
  const order = files.map((f, i) => ({ f, i })).sort((x, y) => {
    const a = x.f.posted ?? '9999-12-31', b = y.f.posted ?? '9999-12-31';
    return a !== b ? (a < b ? -1 : 1) : y.i - x.i;
  });
  return { title, files: order.map((o) => o.f) };
}

// Which of an index's files this run reads. A file read before with the same posted date is left alone, with no request; a file whose
// address was read before under another posted date (a name that repeats every week) is asked for with the earlier ETag and
// Last-Modified, so an unchanged one answers 304; any other is read. `since` keeps only files posted (or, undated, in a month) from that
// date on. `state` is the source's last run (loans/state.json); null reads every file, as the verify check does.
export function planFiles(files, state, { kind, since = null } = {}) {
  const prior = Array.isArray(state?.files) ? state.files : [];
  const follow = [];
  let known = 0;
  for (const f of files) {
    const when = f.posted ?? (f.month ? `${f.month}-01` : null);
    if (since && when && when < since) continue;
    const prev = prior.find((p) => p.url === f.url);
    if (prev && prev.posted === f.posted && f.posted) { known++; continue; }
    const conditional = prev && (prev.etag || prev.lastModified) ? { etag: prev.etag ?? null, lastModified: prev.lastModified ?? null } : null;
    follow.push({ url: f.url, kind, binary: true, posted: f.posted, label: f.label, ...(conditional ? { conditional } : {}) });
  }
  return { follow, known };
}

// A file's key: its server's validator and the report's own dates. Never its name, which repeats.
export function fileKey({ etag = null, lastModified = null } = {}, { from = null, through = null } = {}) {
  const v = etag ? `etag:${etag}` : lastModified ? `modified:${lastModified}` : 'unversioned';
  return `${v}|${from ?? ''}..${through ?? ''}`;
}

// ---- The text of a PDF --------------------------------------------------------------------------------------------------------
// `pdftotext -layout` keeps each label beside its value, as the report prints them. The PDF goes in on stdin and the text comes out on
// stdout: no temporary file, no shell. A file that is not a PDF is refused before poppler sees it.
export function pdfToText(bytes, { bin = 'pdftotext', timeoutMs = 60000, maxChars = 20_000_000 } = {}) {
  return new Promise((resolve, reject) => {
    const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes ?? []);
    if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') { reject(new Error('the file is not a PDF')); return; }
    let child;
    try { child = spawn(bin, ['-layout', '-enc', 'UTF-8', '-', '-'], { stdio: ['pipe', 'pipe', 'pipe'] }); } catch (e) { reject(e); return; }
    const out = [];
    let n = 0, err = '', done = false;
    const finish = (e, v) => { if (done) return; done = true; clearTimeout(timer); if (e) reject(e); else resolve(v); };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(new Error(`pdftotext took longer than ${timeoutMs} ms`)); }, timeoutMs);
    child.stdout.on('data', (c) => { n += c.length; if (n > maxChars) { child.kill('SIGKILL'); finish(new Error('pdftotext gave more text than a report holds')); } else out.push(c); });
    child.stderr.on('data', (c) => { if (err.length < 400) err += c; });
    child.on('error', (e) => finish(e.code === 'ENOENT' ? new Error('pdftotext is not installed (poppler-utils): the GTS reports are PDFs and cannot be read without it.') : e));
    child.on('close', (code) => (code === 0 ? finish(null, Buffer.concat(out).toString('utf8')) : finish(new Error(`pdftotext could not read the file (exit ${code}): ${norm(err).slice(0, 160)}`))));
    child.stdin.on('error', () => {});
    child.stdin.end(buf);
  });
}
export function hasPdftotext(bin = 'pdftotext') {
  try { execFileSync(bin, ['-v'], { stdio: 'ignore' }); return true; } catch { return false; }
}

// ---- Reading a layout report ---------------------------------------------------------------------------------------------------
// The text's lines, without form feeds and without the page furniture (`furniture`: patterns for each page's header and footer lines),
// with typographic apostrophes made plain so a label reads the same whatever font printed it.
export function layoutLines(text, furniture = []) {
  return String(text ?? '').replace(/\r/g, '').replace(/\f/g, '\n').replace(/[‘’]/g, "'").split('\n').map((l) => l.replace(/\s+$/, ''))
    .filter((l) => !furniture.some((re) => re.test(l)));
}

// Splits the lines into records and reads each one's labels. `schema` lists the labels that start a line, in the report's order; the
// first starts a record. Each may carry `inline` labels that follow it on the same line (a later column), and `multiline` when its value
// wraps onto the indented lines below. `end` is a label after the last record (a total). Returns { records, preamble, end, stray }:
// each record { fields: { id: text }, present: Set of ids }; a label present with no value reads ''.
export function readLayout(lines, schema, { end = null } = {}) {
  const leads = [...schema].sort((a, b) => b.label.length - a.label.length);
  const records = [], preamble = [];
  let cur = null, open = null, stray = 0, endValue = null;
  const clean = (v) => norm(String(v ?? '').replace(/^\s*:/, ''));
  for (const line of lines) {
    const t = line.trimStart();
    if (end && t.startsWith(end)) { endValue = clean(t.slice(end.length)); cur = null; open = null; continue; }
    const lead = leads.find((s) => t.startsWith(s.label));
    if (lead) {
      if (lead === schema[0]) { cur = { fields: {}, present: new Set() }; records.push(cur); }
      if (!cur) { preamble.push(line); open = null; continue; }
      let rest = t.slice(lead.label.length);
      const cuts = [];
      let from = 0;
      for (const inl of lead.inline ?? []) {
        const re = new RegExp(`(^|\\s)${inl.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g');
        re.lastIndex = from;
        const m = re.exec(rest);
        if (!m) continue;
        const at = m.index + m[1].length;
        cuts.push({ inl, at });
        from = at + inl.label.length;
      }
      const set = (id, v) => { if (cur.present.has(id)) { stray++; return; } cur.present.add(id); cur.fields[id] = clean(v); };
      set(lead.id, rest.slice(0, cuts[0]?.at ?? rest.length));
      cuts.forEach((c, i) => set(c.inl.id, rest.slice(c.at + c.inl.label.length, cuts[i + 1]?.at ?? rest.length)));
      open = lead.multiline ? lead.id : null;
      continue;
    }
    if (!t) continue;
    if (cur && open && /^\s/.test(line)) { cur.fields[open] = norm(`${cur.fields[open]} ${t}`); continue; }
    if (!cur) preamble.push(line); else stray++;
  }
  return { records, preamble, end: endValue, stray };
}

// ---- Checked fields ------------------------------------------------------------------------------------------------------------
// One record's reader: each field read through its check, the outcome counted per label in `stats` ({ parsed, notRead, empty, absent })
// and a field that failed named in `unread` by its place in the record.
const AMOUNT = /^\$?\d{1,3}(,\d{3})*(\.\d{1,2})?$|^\$?\d+(\.\d{1,2})?$/;
export function fieldReader(rec, stats) {
  const unread = [];
  const count = (label, k) => { const s = (stats[label] ??= { parsed: 0, notRead: 0, empty: 0, absent: 0 }); s[k]++; };
  const get = (id, label) => {
    if (!rec.present.has(id)) { count(label, 'absent'); return null; }
    const v = rec.fields[id] ?? '';
    if (!v) { count(label, 'empty'); return null; }
    return v;
  };
  const checked = (id, label, path, test) => {
    const v = get(id, label);
    if (v === null) return null;
    const out = test(v);
    if (out === null || out === undefined) { count(label, 'notRead'); if (path) unread.push(path); return null; }
    count(label, 'parsed');
    return out;
  };
  return {
    unread,
    has: (id) => rec.present.has(id),
    raw: (id) => rec.fields[id] ?? '',
    date: (id, label, path) => checked(id, label, path, mdy),
    // An amount: absent or blank is not stated; one that is not money is not read, and says so in its basis.
    amount: (id, label, path, extra = {}) => {
      const v = get(id, label);
      if (v === null) return { value: null, basis: 'not-stated' };
      const t = v.replace(/^\$\s+/, '$');
      const n = AMOUNT.test(t) ? parseUsd(t) : Number.NaN;
      if (!Number.isFinite(n)) { count(label, 'notRead'); unread.push(path); return { value: null, basis: 'not-read' }; }
      count(label, 'parsed');
      return { value: n, basis: 'index', ...extra };
    },
    text: (id, label, path, { max = 400, re = /[A-Za-z0-9]/ } = {}) => checked(id, label, path, (v) => (v.length <= max && re.test(v) ? v : null)),
    count,
  };
}
// A public trustee's foreclosure number (a letter or two and digits, or digits alone) and a recording reception number (digits).
export const FORECLOSURE_NUMBER = /^[A-Z]{0,3}\d{4,10}(-[A-Z0-9]{1,4})?$/i;
export const RECEPTION_NUMBER = /^[A-Z]{0,2}\d{5,12}$/i;
// A party's name: letters somewhere in it, no longer than a name with its capacity ("..., not in its individual capacity but solely as
// trustee for ...") runs.
export const NAME = /[A-Za-z]{2}/;

// The parcel number inside a legal description, where the county labels it: "APN:", "APN #:", "PARCEL:", "PARCEL ID:" or "PARCEL NO.:".
// A legal description that says "PARCEL 1, SECTION 30" has no label, so it gives no number. Returns { apn, labelled }: labelled with a
// value that is not a parcel number gives apn null, which is a field not read.
const APN_LABEL = /\b(?:APN\s*#?|PARCEL(?:\s+(?:ID|NO\.?|NUMBER))?\s*#?)\s*:\s*([^\s,;]*)/i;
export function apnIn(legal) {
  const m = APN_LABEL.exec(String(legal ?? ''));
  if (!m) return { apn: null, labelled: false };
  const v = m[1].replace(/\.$/, '');
  return { apn: /^[0-9][0-9A-Z.-]{4,30}$/i.test(v) && (v.match(/\d/g) ?? []).length >= 5 ? v : null, labelled: true };
}
export function readApn(r, legal, label = 'APN or PARCEL (in the legal description)') {
  const { apn, labelled } = apnIn(legal);
  if (!labelled) { r.count(label, 'absent'); return null; }
  if (!apn) { r.count(label, 'notRead'); r.unread.push('property.apn'); return null; }
  r.count(label, 'parsed');
  return apn;
}

// The totals of one file's fields: { label: { parsed, notRead, empty, absent } }, summed over files for a run's report.
export function addStats(into, from) {
  for (const [k, v] of Object.entries(from ?? {})) { const s = (into[k] ??= { parsed: 0, notRead: 0, empty: 0, absent: 0 }); for (const x of Object.keys(s)) s[x] += v[x] ?? 0; }
  return into;
}

// ---- The pre-sale list (one template in every GTS county) ------------------------------------------------------------------------
// Header (first page): "<County> County Pre Sale Foreclosure List   <run date>   <run time>", then "Sale Date: <Month D, YYYY>".
// Each record: "Foreclosure: #:", "The Grantor:", "Legal Description:" (a parcel number inside it, sometimes), "Street Address:",
// "Current Beneficiary Name:", "First Publication:", "Last Publication:", sometimes "Amended First Publication:" and "Amended Last
// Publication:", "Publication Newspaper:", "Lender's Bid Amount:", "Deficiency:", "Total Indebtedness:". After the last record, "Total
// Foreclosures: N". Each page ends "<Weekday>, <Month D, YYYY>   Page N of M".
export const PRESALE_SCHEMA = Object.freeze([
  { label: 'Foreclosure: #:', id: 'number' },
  { label: 'The Grantor:', id: 'grantor', multiline: true },
  { label: 'Legal Description:', id: 'legal', multiline: true },
  { label: 'Street Address:', id: 'address', multiline: true },
  { label: 'Current Beneficiary Name:', id: 'beneficiary', multiline: true },
  { label: 'First Publication:', id: 'firstPublication' },
  { label: 'Last Publication:', id: 'lastPublication' },
  { label: 'Amended First Publication:', id: 'amendedFirst', inline: [{ label: 'Amended Last Publication:', id: 'amendedLast' }] },
  { label: 'Amended Last Publication:', id: 'amendedLast' },
  { label: 'Publication Newspaper:', id: 'newspaper' },
  { label: "Lender's Bid Amount:", id: 'bid' },
  { label: 'Deficiency:', id: 'deficiency' },
  { label: 'Total Indebtedness:', id: 'total' },
]);
// The labels every list has; one no record carries is a format change.
export const PRESALE_REQUIRED = Object.freeze(['number', 'grantor', 'legal', 'address', 'beneficiary', 'bid', 'deficiency', 'total']);
const PRESALE_TITLE = /^\s*(.+?) County Pre Sale Foreclosure List\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d{1,2}:\d{2}:\d{2}\s*[AP]M)\s*$/;
const PRESALE_FURNITURE = [PRESALE_TITLE, /^\s*Sale Date:/, /^\s*(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s+[A-Za-z]+\s+\d{1,2},\s+\d{4}\s+Page\s+\d+\s+of\s+\d+\s*$/];
const labelOf = (schema, id) => schema.find((s) => s.id === id)?.label ?? schema.flatMap((s) => s.inline ?? []).find((s) => s.id === id)?.label ?? id;

// One pre-sale list's text to documents: each record a scheduled trustee's sale, its id the foreclosure number with "/SALE", its date
// the list's run date (it is not itself a recorded document) and its sale date the header's. `county` is the adapter's county name: a
// list titled for another county is refused. Returns { documents, rows, skipped, missing, stats, reportDates }.
export function parsePreSaleText(text, { url, county }) {
  const raw = layoutLines(text);
  const lines = layoutLines(text, PRESALE_FURNITURE);
  const missing = {}, stats = {}, skipped = [], documents = [];
  const miss = (k) => { missing[k] = (missing[k] ?? 0) + 1; };
  const title = raw.map((l) => PRESALE_TITLE.exec(l)).find(Boolean);
  if (!title) miss('the list\'s title ("<County> County Pre Sale Foreclosure List" and its run date)');
  else if (norm(title[1]).toLowerCase() !== norm(county).toLowerCase()) miss(`a list titled for ${county} County`);
  const runDate = title ? mdy(title[2]) : null;
  if (title && !runDate) miss('the list\'s run date');
  const saleLine = raw.map((l) => /^\s*Sale Date:\s*(.*?)\s*$/.exec(l)).find(Boolean);
  if (!saleLine) miss('Sale Date:');
  const saleDate = saleLine ? longYmd(saleLine[1]) : null;
  if (saleLine) { const s = (stats['Sale Date (header)'] ??= { parsed: 0, notRead: 0, empty: 0, absent: 0 }); s[saleDate ? 'parsed' : saleLine[1] ? 'notRead' : 'empty']++; }

  const { records, end } = readLayout(lines, PRESALE_SCHEMA, { end: 'Total Foreclosures:' });
  if (end === null) miss('Total Foreclosures:');
  else if (!/^\d+$/.test(end) || Number(end) !== records.length) miss(`Total Foreclosures: (${end || 'blank'} listed, ${records.length} read)`);
  if (records.length) for (const id of PRESALE_REQUIRED) if (!records.some((r) => r.present.has(id))) miss(labelOf(PRESALE_SCHEMA, id));

  for (const rec of records) {
    const r = fieldReader(rec, stats);
    const number = r.text('number', 'Foreclosure: #:', null, { max: 20, re: FORECLOSURE_NUMBER });
    const holder = r.text('beneficiary', 'Current Beneficiary Name:', 'parties.holder', { re: NAME });
    const grantor = r.text('grantor', 'The Grantor:', 'parties.grantor', { re: NAME });
    const legal = r.text('legal', 'Legal Description:', 'property.legal', { max: 8000 });
    const apn = readApn(r, legal);
    const address = r.text('address', 'Street Address:', 'property.address', { max: 200 });
    const first = r.date('firstPublication', 'First Publication:', 'foreclosure.publication.first');
    const last = r.date('lastPublication', 'Last Publication:', 'foreclosure.publication.last');
    const amendedFirst = r.date('amendedFirst', 'Amended First Publication:', 'foreclosure.amendedPublication.first');
    const amendedLast = r.date('amendedLast', 'Amended Last Publication:', 'foreclosure.amendedPublication.last');
    const bid = r.amount('bid', "Lender's Bid Amount:", 'foreclosure.bid', { label: "Lender's Bid Amount" });
    const deficiency = r.amount('deficiency', 'Deficiency:', 'foreclosure.deficiency', { label: 'Deficiency' });
    const total = r.amount('total', 'Total Indebtedness:', 'amounts.unpaidBalance', { label: 'Total Indebtedness' });
    if (!number) { skipped.push({ reason: 'the foreclosure number could not be read' }); continue; }
    if (!holder) { skipped.push({ reason: 'no current beneficiary named' }); continue; }
    documents.push({
      documentType: 'notice_of_trustee_sale', documentNumber: `${number}/SALE`,
      dates: { recorded: null, filed: null, listed: runDate, sale: saleDate },
      parties: [{ role: 'holder', name: holder }, ...(grantor ? [{ role: 'grantor', name: grantor }] : [])],
      property: { address, apn, legal, useCode: null, propertyType: null },
      amounts: { originalPrincipal: { value: null, basis: 'not-stated' }, unpaidBalance: total },
      deedOfTrust: null,
      loan: null,
      foreclosure: { number, reception: null, attorneyFileNumber: null, publication: { first, last }, amendedPublication: { first: amendedFirst, last: amendedLast }, bid, deficiency },
      unread: [...new Set([...r.unread, ...(saleLine && !saleDate && saleLine[1] ? ['dates.sale'] : [])])],
      url,
    });
  }
  return { documents, rows: records.length, skipped, missing, stats, reportDates: { from: runDate, through: saleDate } };
}

// ---- One GTS county's pages ------------------------------------------------------------------------------------------------------
// The parse an adapter gives the shared run for its HTML pages. `reports` names, for each kind of index this county's reports page
// links, the link texts that find it and the kind of file it lists: { 'ned-index': { texts: [...], file: 'ned', title: [...] } }.
// `weekly` and `backfill` name the index kinds each mode follows. A link not found, or an index whose title is not the report's, is a
// format change.
export function gtsPageParser({ reports, weekly, backfill = [] }) {
  return function parse(html, { url, kind, state = null, since = null }) {
    if (kind === 'reports' || kind === 'archive-reports') {
      const links = reportLinks(html, { url });
      const follow = [], missing = {};
      for (const k of kind === 'archive-reports' ? backfill : weekly) {
        const link = findReport(links, reports[k].texts);
        if (link) follow.push({ url: link.url, kind: k }); else missing[`the reports page's link "${reports[k].texts[0]}"`] = 1;
      }
      return { documents: [], rows: 0, skipped: [], missing, follow };
    }
    const spec = reports[kind];
    if (!spec) return { documents: [], rows: 0, skipped: [], missing: { [`a page of kind ${kind}`]: 1 } };
    const idx = parseReportIndex(html, { url });
    const titled = spec.texts.some((t) => norm(t).toLowerCase() === norm(idx.title).toLowerCase());
    if (!titled) return { documents: [], rows: 0, skipped: [], missing: { [`the index's title "${spec.texts[0]}"`]: 1 } };
    const plan = planFiles(idx.files, state, { kind: spec.file, since });
    return { documents: [], rows: 0, skipped: [], missing: {}, follow: plan.follow, known: plan.known };
  };
}
