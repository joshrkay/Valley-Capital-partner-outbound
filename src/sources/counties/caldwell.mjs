// Caldwell County, Texas: the clerk's posted notices of trustee's sale (docs/county-watchers-recon.md, Caldwell; sources.json
// tx-caldwell-notices-of-sale). The first real county reader. Texas law (Prop. Code 51.002) has every notice of a non-judicial sale
// filed with the clerk at least 21 days before the first-Tuesday sale, and the county must post it online without charge or
// registration, so this is a public list meant to be read (channel b).
//
// THE GATE. The source runs only on the principal's decision recorded in sources.json (principalDecision): read weekly, lender-level use
// only, no borrower or individual named in a notice ever contacted from this data, and the county's disclaimer rechecked monthly while
// the District Attorney reviews it. The decision's recheck date is part of the gate (runnable in src/sources/notices.mjs): once it
// passes, nothing is read until a principal rechecks the disclaimer and records the next date.
//
// THE LIST, https://caldwellcounty.texas.gov/foreclosures: every notice, newest sale month first, one li.doc-item each:
//   a.doc-link            the notice's PDF, /files/public-documents/foreclosures/<folder>/<file>.pdf. The file is named for the
//                         sale date and the debtor, so the record's number is a hash of the link (noticeNumber) and the bank's file and
//                         the events carry a link to the list's month instead (listLink)
//   span.doc-link__label  the clerk's label: a sale date and the debtor's name. Never read
//   time[datetime]        the list's sale date. Unreliable before 2025 (a default date fills January), so the record's sale date comes
//                         from the notice; the list's date only chooses the first run's backfill and corroborates a notice's own reading
// grouped in section.fc-month (fc-m-YYYY-MM, or fc-m-undated: "Notices without a listed sale date").
//
// THE NOTICES. Each is a scanned PDF (2-4 pages, 200 dpi) with an OCR text layer, read by pdftotext (src/sources/pdftext.mjs). Only new
// notices are fetched, 21 seconds apart. Two layouts (the recon's):
//   servicer   a servicer's or trustee firm's form: one long recital ("WHEREAS, on <date>, <grantor>, as Grantor/Borrower, executed ...
//              in favor of <trustee>, as Trustee, <beneficiary>, as Beneficiary ... original amount of $X ... Recorded ... as Volume
//              2024-NNNNNN ... Commonly known as: <address> ... appointed <names> ... as Substitute Trustee ... <servicer> ... is acting
//              as the mortgage servicer for <mortgagee>, which is the mortgagee ... NOTICE IS HEREBY GIVEN, that on <date> ...
//              WITNESS, my hand this <date>")
//   attorney   an attorney's form for a private or commercial lender: labelled blocks (DATE:, NOTE: with Date, Maker, Payee and Original
//              Principal Amount; DEED OF TRUST: with Date, Grantor, Trustee, Beneficiary and Recorded; LENDER:; BORROWER:; PROPERTY:,
//              often a metes-and-bounds tract with no street address; SUBSTITUTE TRUSTEE:; DATE AND TIME OF ... SALE; PLACE OF ... SALE)
//
// OCR ERRORS. The text layer misreads digits and slashes ("12/1/2026" as "121112026", "3/14/2023" as "3/14l2023"), month names
// ("Jaruary"), commas in amounts ("$250.000.00") and labels ("I,F],NDER:"). Every value is validated, and one that fails is NOT READ,
// never guessed: listed in the record's `unread`, an amount with the basis "not-read".
//   - An amount must read as dollars: $N,NNN.NN, or with periods for its thousands commas when that reading is the only one; no
//     spaces inside; from $1,000 to $1,000,000,000.
//   - A date must be a real date in a plausible range. A numeric date whose separators may be misread is tried every way its ambiguous
//     characters allow, and is read only when exactly one way gives a valid date. A month name is read when one month is clearly
//     nearest.
//   - The sale date must be a Texas sale day (the first Tuesday of a month, or the first Wednesday when that Tuesday is January 1 or
//     July 4) and fall 21 to 180 days after the notice date, as the law's 21 days' notice requires. When the two disagree, the sale
//     date is kept only if the list gives the same date; otherwise neither is read.
//   - A name must look like a name: letters, no OCR debris. "MERS as nominee for X" is read through to X (src/lenders.mjs).
// The raw text never leaves the reader: not stored, not logged, not returned.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { REPO } from '../../paths.mjs';
import { defineNoticeSource } from '../notices.mjs';
import { pdfToText } from '../pdftext.mjs';
import { validYmd } from '../../loans.mjs';
import { isEntityName } from '../../lenders.mjs';

export const CALDWELL_ID = 'tx-caldwell-notices-of-sale';
export const CALDWELL_HOST = 'caldwellcounty.texas.gov';
export const CALDWELL_LIST = `https://${CALDWELL_HOST}/foreclosures`;
export const NOTICE_PATH = '/files/public-documents/foreclosures/';
// Raised when the reader improves, so a notice held as unreadable is fetched once more.
export const CALDWELL_PARSER_VERSION = 1;

// ---- The gate: the registry entry and the principal's decision ------------------------------------------------------------------
export const loadRegistry = (root = REPO) => JSON.parse(readFileSync(join(root, 'sources.json'), 'utf8'));
export const registryEntry = (reg = loadRegistry()) => (reg.sources ?? []).find((s) => s.id === CALDWELL_ID) ?? null;

// The terms the decision gate (runnable) reads, from the registry entry: allowed only while the entry is enabled, its verdict is allowed
// and a principal's decision allows it, with the dates of the robots.txt and terms reads, who decided, and the next recheck date.
export function termsFrom(entry) {
  const d = entry?.principalDecision ?? null;
  const allowed = !!entry?.enabled && entry?.verdict === 'allowed' && d?.decision === 'allowed';
  return {
    decision: allowed ? 'allowed' : d?.decision ? `${d.decision} (source ${entry?.enabled ? 'enabled' : 'not enabled'}, verdict ${entry?.verdict ?? 'none'})` : 'none recorded',
    robotsCheckedOn: d?.robotsCheckedOn ?? null, termsCheckedOn: d?.termsCheckedOn ?? null, by: d?.by ?? null,
    decidedOn: d?.decidedOn ?? null, nextRecheckOn: d?.nextRecheckOn ?? null, conditions: [...(d?.conditions ?? [])],
  };
}
// The source's own spacing between requests (sources.json pacing: 21 seconds), never less than 21 seconds.
export const intervalFrom = (entry) => Math.max(21000, Math.round(Number(entry?.pacing?.minIntervalSeconds ?? 21) * 1000));

// ---- The list ---------------------------------------------------------------------------------------------------------------------
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
const unescape = (s) => String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, x) => (x[0] === '#' ? String.fromCodePoint(x[1].toLowerCase() === 'x' ? parseInt(x.slice(2), 16) : parseInt(x.slice(1), 10)) : ENT[x.toLowerCase()] ?? m));

// The record's number for a notice: a hash of its link's path, so a weekly re-read lands on the same id and no name is in the id.
export function noticeNumber(pathname) {
  let p = String(pathname ?? '');
  try { p = decodeURIComponent(p); } catch { /* keep it as given */ }
  return createHash('sha256').update(p.normalize('NFC')).digest('hex').slice(0, 16).toUpperCase();
}

// The list page to one item per notice. Format checks: no li.doc-item at all, or no sale dates at all, is a format change (missing).
export function parseCaldwellList(html, { url = CALDWELL_LIST } = {}) {
  const s = String(html ?? '');
  const items = [], skipped = [];
  let rows = 0, dated = 0;
  // Each month section, then its items. An item outside any section (none today) still counts, with no section.
  const parts = s.split(/(<section\b[^>]*\bclass="[^"]*\bfc-month\b[^"]*"[^>]*>)/i);
  const chunks = [{ section: null, body: parts[0] }];
  for (let i = 1; i < parts.length; i += 2) chunks.push({ section: /aria-labelledby="fc-m-([a-z0-9-]+)"/i.exec(parts[i])?.[1] ?? null, body: parts[i + 1] ?? '' });
  for (const { section, body } of chunks) {
    for (const m of body.matchAll(/<li\b[^>]*\bclass="[^"]*\bdoc-item\b[^"]*"[^>]*>([\s\S]*?)<\/li>/gi)) {
      rows++;
      const li = m[1];
      const href = /<a\b[^>]*\bclass="[^"]*\bdoc-link\b[^"]*"[^>]*\bhref="([^"]+)"|<a\b[^>]*\bhref="([^"]+)"[^>]*\bclass="[^"]*\bdoc-link\b/i.exec(li);
      const raw = href ? unescape(href[1] ?? href[2]) : null;
      if (!raw) { skipped.push({ reason: 'a listed notice with no link' }); continue; }
      let u;
      try { u = new URL(raw.replace(/ /g, '%20'), url); } catch { skipped.push({ reason: 'a listed notice whose link is not a web address' }); continue; }
      if (u.host !== CALDWELL_HOST || !u.pathname.startsWith(NOTICE_PATH)) { skipped.push({ reason: 'a link outside the county\'s notice files' }); continue; }
      if (!/\.pdf$/i.test(u.pathname)) { skipped.push({ reason: 'an image, not a PDF with a text layer' }); continue; }
      const listedDate = /<time\b[^>]*\bdatetime="(\d{4}-\d{2}-\d{2})"/i.exec(li)?.[1] ?? null;
      if (listedDate) dated++;
      items.push({ documentNumber: noticeNumber(u.pathname), url: u.toString(), listedDate: validYmd(listedDate) ? listedDate : null,
        listLink: `${CALDWELL_LIST}${section ? `#fc-m-${section}` : ''}` });
    }
  }
  const missing = {};
  if (!rows) missing['li.doc-item'] = 1;
  else if (!dated) missing['time[datetime]'] = 1;
  return { items, rows, skipped, missing };
}

// ---- Reading values out of OCR text -----------------------------------------------------------------------------------------------
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const ABBR = { jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
// A month word, as OCR gives it, to its number: exact, an abbreviation, or the one month nearest by at most one misread letter (two for
// a name of seven letters or more). Two months equally near, or none near enough: not read.
export function monthOf(word) {
  const w = String(word ?? '').toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return null;
  const exact = MONTHS.indexOf(w);
  if (exact >= 0) return exact + 1;
  if (ABBR[w]) return ABBR[w];
  if (w.length < 4) return null;
  const scored = MONTHS.map((m, i) => ({ i: i + 1, d: editDistance(w, m), max: m.length >= 7 ? 2 : 1 })).filter((x) => x.d <= x.max).sort((a, b) => a.d - b.d);
  if (!scored.length || (scored[1] && scored[1].d === scored[0].d)) return null;
  return scored[0].i;
}
const pad = (n) => String(n).padStart(2, '0');
const ymdOf = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const realDate = (y, m, d) => { const s = ymdOf(y, m, d); return Number(y) >= 1900 && validYmd(s) ? s : null; };
export const addDays = (ymd, n) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
export const dayDiff = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
// Digits as OCR may give them inside a number: l, I, | for 1 and O, o for 0, only where the token already holds a digit.
const digitsOf = (t) => (/\d/.test(t) ? t.replace(/[lI|]/g, '1').replace(/[Oo]/g, '0') : t);

// Every reading of a numeric date token (M/D/YYYY or M/D/YY): each character that may be a misread separator (l, I, |, !, 1, \) is
// tried as both a digit and a slash. Returns the distinct real dates `ok` accepts.
export function numericDateReadings(token, ok = () => true) {
  // An O is always a zero in a number; t , ' . - between two digits are always a separator.
  const t = String(token ?? '').replace(/[.,;:'-]+$/, '').replace(/[Oo]/g, '0').replace(/(?<=[0-9lI|])[t,'.-](?=[0-9lI|])/g, '/');
  if (!/^[0-9lI|!\\/]{5,12}$/.test(t) || (t.match(/\d/g) ?? []).length < 4) return [];
  const amb = [...t].map((c, i) => (/[lI|!\\1]/.test(c) ? i : -1)).filter((i) => i >= 0);
  if (amb.length > 10) return [];
  const out = new Set();
  // Eight digits with no separator: MMDDYYYY, one more reading among the others.
  const bare = /^(\d{2})(\d{2})(\d{4})$/.exec(t);
  if (bare) { const s = realDate(Number(bare[3]), Number(bare[1]), Number(bare[2])); if (s && ok(s)) out.add(s); }
  for (let mask = 0; mask < 1 << amb.length; mask++) {
    const chars = [...t];
    amb.forEach((pos, k) => { chars[pos] = mask & (1 << k) ? '/' : chars[pos] === '1' || /[lI|!]/.test(chars[pos]) ? '1' : '/'; });
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})$/.exec(chars.join(''));
    if (!m) continue;
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const s = realDate(y, Number(m[1]), Number(m[2]));
    if (s && ok(s)) out.add(s);
  }
  return [...out];
}

// The first date at the start of `text`: "September 17, 2026", "Sept. 17,2026", "17th day of September, 2026", or a numeric token.
// Returns { date, how } with date null when the text holds a date that cannot be read once and only once.
export function readDateAt(text, ok = () => true) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim().replace(/^['"`,.:;\s]+/, '').replace(/^(?:on\s+)?(?:Tuesday|Tues\.?|Wednesday)\s*,?\s*(?:the\s+)?/i, '').slice(0, 60);
  let m = /^([A-Za-z][A-Za-z.]{2,11})\s*\.?\s*([0-9lIOo|]{1,2})(?:st|nd|rd|th)?\s*[,.]?\s*([0-9lIOo|]{4})\b/.exec(s);
  if (m) {
    const mo = monthOf(m[1]); const d = Number(digitsOf(m[2])); const y = Number(digitsOf(m[3]));
    if (!mo || !/^\d+$/.test(digitsOf(m[2])) || !/^\d{4}$/.test(digitsOf(m[3]))) return { date: null, how: 'words' };
    const r = realDate(y, mo, d);
    return { date: r && ok(r) ? r : null, how: 'words' };
  }
  m = /^([0-9lIOo|]{1,2})(?:st|nd|rd|th)?\s+day\s+of\s+([A-Za-z]{3,11})\s*,?\s*([0-9lIOo|]{4})\b/i.exec(s);
  if (m) {
    const mo = monthOf(m[2]); const r = mo ? realDate(Number(digitsOf(m[3])), mo, Number(digitsOf(m[1]))) : null;
    return { date: r && ok(r) ? r : null, how: 'words' };
  }
  m = /^([0-9lIO][0-9lIOo|!\\/t,'.-]{4,11})(?![A-Za-z0-9])/.exec(s);
  if (m && /\d/.test(m[1])) {
    const all = numericDateReadings(m[1], ok);
    return { date: all.length === 1 ? all[0] : null, how: 'numeric', readings: all.length };
  }
  return { date: null, how: null };
}

// A Texas sale day: the first Tuesday of a month, or the first Wednesday when that Tuesday is January 1 or July 4 (Prop. Code 51.002(a)).
export function texasSaleDay(ymd) {
  if (!validYmd(ymd)) return false;
  const d = new Date(`${ymd}T00:00:00Z`);
  const day = d.getUTCDate(), dow = d.getUTCDay();
  if (dow === 2 && day <= 7) return !(ymd.slice(5) === '01-01' || ymd.slice(5) === '07-04');
  if (dow === 3 && day <= 8) { const tue = addDays(ymd, -1).slice(5); return tue === '01-01' || tue === '07-04'; }
  return false;
}

// Dollars, as OCR gives them: "$123,456.00", "$250.000.00" (periods for the commas, read only when the grouping allows no other
// reading), "$1,500,000". Anything else (a space inside, a letter, a single group with a period) is not read.
export function readDollars(text) {
  const m = /^\s*\$\s?([0-9][0-9,.]*[0-9])/.exec(String(text ?? ''));
  if (!m) return null;
  const t = m[1];
  let v = null;
  if (/^\d{1,3}(,\d{3})*(\.\d{2})?$/.test(t)) v = Number(t.replace(/,/g, ''));
  else if (/^\d{1,3}(\.\d{3})+\.\d{2}$/.test(t)) v = Number(t.slice(0, -3).replace(/\./g, '') + t.slice(-3));
  else if (/^\d{1,3}(\.\d{3})+,\d{2}$/.test(t)) v = Number(t.slice(0, -3).replace(/\./g, '') + '.' + t.slice(-2));
  else if (/^\d{4,10}(\.\d{2})?$/.test(t)) v = Number(t);
  return v !== null && Number.isFinite(v) && v >= 1000 && v <= 1_000_000_000 ? v : null;
}

// A party's name, cleaned and checked. OCR debris (brackets, pipes, braces, a question mark or colon inside a name, a run of symbols) or
// too few letters: not a name.
const DEBRIS = /[{}[\]|\\^~<>@#*=+_$]|[^\x20-\x7EÀ-ſ’‘“”–—]/;
const NAME_DEBRIS = /[?:;!"]|\.\.|,,/;
const SHORT_OK = /^(?:&|of|de|del|la|el|y|a|an|and|or|jr\.?|sr\.?|ii|iii|iv|llc|lp|l\.p\.|co\.?|na|n\.a\.|inc\.?|ltd\.?|us|u\.s\.|fsb|pc|p\.c\.|b|[a-z]\.)$/i;
export function cleanName(raw) {
  let s = String(raw ?? '').replace(/\s+/g, ' ').trim().replace(/^[,;:.\s]+|[,;:\s]+$/g, '');
  s = s.replace(/^(?:and|or|a[lnru]d)\s+/i, '').replace(/,?\s*\d{2,6}\s+[A-Za-z].*$/, '').replace(/[,;:\s]+$/, '');
  if (s.length < 3 || s.length > 160 || DEBRIS.test(s) || NAME_DEBRIS.test(s)) return null;
  const letters = (s.match(/[A-Za-z]/g) ?? []).length;
  if (letters < 3 || letters / s.replace(/\s/g, '').length < 0.6) return null;
  const words = s.split(' ');
  const fragments = words.filter((w) => w.replace(/[^A-Za-z]/g, '').length <= 2 && !SHORT_OK.test(w)).length;
  if (words.length >= 4 && fragments / words.length > 0.3) return null;
  return s;
}
// The description an entity's name carries after it: ", a Texas limited liability company", ", a Delaware corporation".
const DESCRIPTION = /,?\s+an?\s+(?:[A-Za-z.-]+\s+){0,4}?(?:limited\s+liability\s+\w+|corporation|limited\s+partnership|general\s+partnership|partnership|national\s+(?:banking\s+)?association|banking\s+(?:association|corporation)|state\s+(?:chartered\s+)?bank|savings\s+bank|federal\s+savings\s+bank|trust\s+company|company|series\s+llc)\b.*$/i;
// The description alone, without what follows it.
const DESCRIPTION_KIND = new RegExp(DESCRIPTION.source.replace(/\.\*\$$/, ''), 'i');
// A grantor's or borrower's name without the words on marriage or capacity that follow it.
export function borrowerName(raw) {
  const s = String(raw ?? '').replace(/\s+/g, ' ')
    .replace(/,?\s+(?:as\s+)?(?:husband\s+and\s+wife|wife\s+and\s+husband|a\s+married\s+(?:couple|man|woman|person)|an?\s+(?:un)?married\s+(?:man|woman|person)|a\s+single\s+(?:man|woman|person)|spouses?|joined\s+herein\b.*|individually\b.*|not\s+individually\b.*|both\s+individually\b.*)(?=,|$|\s+and\s)/gi, '')
    .replace(/,?\s+as\s+(?:grantors?|borrowers?|mortgagors?)\b.*$/i, '').replace(/,?\s+(?:its|his|her|their)\s+successors?\b.*$/i, '');
  // The entity's description is cut, and what follows it. Where the name alone would not say it is an entity, the description itself
  // is kept (", a Texas limited liability company"), never what follows: the scope rule (src/loans.mjs, loanScope) reads the stored
  // name, and an entity taken for a person would leave its loan out.
  const kind = DESCRIPTION_KIND.exec(s);
  const cut = s.replace(DESCRIPTION, '');
  return cleanName(kind && !isEntityName(cut) ? `${cut}${kind[0]}` : cut);
}
// Whether a borrower is an entity (an LLC, a corporation, a partnership, a trust, a church) rather than one or more people: the shared
// test (src/lenders.mjs), which the scope rule also uses.
export { isEntityName };

// MERS, read through: "Mortgage Electronic Registration Systems, Inc. (MERS), as beneficiary, as nominee for X, its successors and
// assigns" becomes the canonical "Mortgage Electronic Registration Systems, Inc., as nominee for X", which the lender match reads as X.
// MERS with no lender named stays MERS (set aside, never a lender). OCR may misspell MERS's long name; its last three words carry it.
const MERS = /\b(?:[A-Z][a-z]{3,9}\s+)?E[il1]ectron[il1]c\s+Reg[il1]strat[il1]on\s+Systems?\b|\bMERS\b/i;
export function lenderName(raw) {
  const s = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (MERS.test(s)) {
    const nom = /\bnominee\s+for\s+(.+)$/i.exec(s);
    if (!nom) return { name: 'Mortgage Electronic Registration Systems, Inc.', mers: true, through: null };
    const x = cleanName(nom[1].replace(/,?\s+(?:its|and\s+its|his|her|their)\s+successors?\b.*$/i, '').replace(/,?\s+as\s+(?:beneficiary|lender|mortgagee)\b.*$/i, '').replace(DESCRIPTION, ''));
    return x ? { name: `Mortgage Electronic Registration Systems, Inc., as nominee for ${x}`, mers: true, through: x } : null;
  }
  const n = cleanName(s.replace(/,?\s+(?:its|and\s+its)\s+successors?\b.*$/i, '').replace(/,?\s+as\s+(?:beneficiary|lender|mortgagee|holder|payee)\b.*$/i, '').replace(DESCRIPTION, ''));
  return n ? { name: n, mers: false, through: n } : null;
}

// A list of names ("A, B, LLC, C or D, or any one of them") split into each. Only a comma or "or" separates two names: "and" is part
// of a firm's name ("Sample Sales and Posting LLC"), and an entity's suffix ("LLC") or a piece that starts in lower case (OCR's
// "Example,com") rejoins the name before it.
const SUFFIX = /^(?:L\.?L\.?C\.?|Inc\.?|LP|L\.P\.|LLP|L\.L\.P\.|PLLC|P\.L\.L\.C\.|P\.C\.|N\.A\.|Corp\.?|Ltd\.?|Co\.|Jr\.?|Sr\.?|II|III|IV|Esq\.?)$/i;
export function splitNames(list) {
  const s = String(list ?? '').replace(/\s+/g, ' ').replace(/,?\s*(?:or|and)\s+any\s+(?:one|1)\s+of\s+them\b.*$/i, '').replace(/,?\s*(?:each|any)\s+(?:being|of\s+whom)\b.*$/i, '');
  const parts = s.split(/\s*,\s*(?:or\s+)?|\s+or\s+/).map((x) => x.trim()).filter(Boolean);
  const out = [];
  for (let p of parts) {
    const lead = /^(L\.?L\.?C\.?|Inc\.?|LP|L\.P\.|LLP|PLLC|P\.C\.|N\.A\.)\s+and\s+(.+)$/i.exec(p);
    if (lead && out.length) { out[out.length - 1] = `${out[out.length - 1]}, ${lead[1]}`; p = lead[2]; }
    if (out.length && SUFFIX.test(p)) out[out.length - 1] = `${out[out.length - 1]}, ${p}`;
    else if (out.length && /^[a-z]/.test(p)) out[out.length - 1] = `${out[out.length - 1]}.${p}`;
    else out.push(p);
  }
  return out.map(cleanName).filter(Boolean);
}

// An address: a house number, a street, then a Texas ZIP. "Not stated" when the notice gives none (a metes-and-bounds tract).
export function readAddress(raw) {
  const s = String(raw ?? '').replace(/\s+/g, ' ').trim();
  const m = /^(\d{1,6}[A-Z]?\s+[A-Za-z0-9 .,'#&/-]{3,90}?,?\s+(?:TX|Tx|TEXAS|Texas)\.?(?:,?\s+7[5-9]\d{3}(?:-\d{4})?\b)?)(?=[\s,.;]|$)/.exec(s);
  if (!m) return null;
  const a = m[1].replace(/\s+,/g, ',');
  return DEBRIS.test(a) ? null : a;
}
// A deed of trust's recording reference: a document (instrument, clerk's file) number such as 2023-004321 (Caldwell's clerk also
// prints it as "Volume 2023-004321"), or an older volume and page.
export function readRecording(text, { notBefore = 1950, notAfter = 2100 } = {}) {
  // A number token's O, o, I, l are its zeros and ones ("2O2I-OO12O3"); only inside a token that already has digits and a dash.
  const s = String(text ?? '').replace(/\s+/g, ' ').replace(/\b[0-9OoIl]{4}\s*-\s*[0-9OoIl]{3,7}\b/g, (t) => (/\d/.test(t) ? t.replace(/[Oo]/g, '0').replace(/[Il]/g, '1') : t));
  const num = /(?:Document|Instrument|Clerk'?s?\s+File|File|Doc\.?|Inst\.?)\s*(?:No\.?|Number|#)?\s*:?\s*((?:19|20)\d{2})\s*[-.]\s*(\d{3,7})\b|\bVolume\s+((?:19|20)\d{2})\s*-\s*(\d{3,7})\b|\b((?:19|20)\d{2})[-.](\d{5,7})\b/i.exec(s);
  if (num) {
    const y = Number(num[1] ?? num[3] ?? num[5]), n = num[2] ?? num[4] ?? num[6];
    if (y >= notBefore && y <= notAfter) return { documentNumber: `${y}-${n}`, book: null, page: null };
    return null;
  }
  const vp = /\b(?:Volume|Vol\.?)\s+(\d{1,5}),?\s+(?:Page|Pg\.?)\s+(\d{1,5})\b/i.exec(s);
  if (vp) return { documentNumber: null, book: vp[1], page: vp[2] };
  return null;
}

// Free text such as the sale place: whitespace collapsed, no OCR debris, a sensible length.
export function readPlace(raw) {
  const s = String(raw ?? '').replace(/\s+/g, ' ').trim().replace(/[,;:.\s]+$/, '');
  if (s.length < 10 || s.length > 300 || DEBRIS.test(s)) return null;
  return (s.match(/[A-Za-z0-9 ,.'&()-]/g) ?? []).length / s.length >= 0.95 ? s : null;
}

// ---- The two readers --------------------------------------------------------------------------------------------------------------
// Texas notices come from many trustee firms, each with its own template, but every template is built from the two kinds the recon
// saw: labelled blocks (the attorney's form; also the two-column tables and the numbered forms' "Date:" / "Place:" lines) and recital
// phrases (the servicer's form; also the numbered forms' paragraphs). Both readers run on every notice. Each field collects its
// candidates in order, labels first; the first that passes its check is read, and two that pass and disagree leave the field unread.
// A notice's layout is the reader that gave its lender: "attorney" (labelled blocks) or "servicer" (the recital).

// The text as one flowing string (every line joined), for the recital, and as lines, for the labelled blocks.
const flowOf = (text) => String(text ?? '').replace(/\f/g, '\n').replace(/[’‘`]/g, "'").replace(/[“”]/g, '"').replace(/€/g, 'e').replace(/\s+/g, ' ');
const linesOf = (text) => String(text ?? '').replace(/\f/g, '\n').replace(/[’‘`]/g, "'").replace(/[“”]/g, '"').replace(/€/g, 'e').split('\n').map((l) => l.replace(/\s+$/, ''));
const lettersOnly = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z]/g, '');

// A label, as OCR gives it, matched to the field it names: exact, or the one label nearest by a few misread letters.
const LABELS = Object.freeze({
  DATE: 'date', NOTE: 'note', NOTEINFORMATION: 'note', DEEDOFTRUST: 'deedOfTrust', DEEDOFTRUSTINFORMATION: 'deedOfTrust', INSTRUMENTTOBEFORECLOSED: 'deedOfTrust',
  DEEDOFTRUSTINFORMATIONINSTRUMENTTOBEFORECLOSED: 'deedOfTrust', SECURITYINSTRUMENT: 'deedOfTrust', DEEDOFTRUSTDATE: 'dotDate',
  LENDER: 'lender', ORIGINALLENDER: 'payee', CURRENTLENDER: 'lender', PAYEE: 'payee', BENEFICIARY: 'beneficiary', ORIGINALBENEFICIARY: 'beneficiary',
  ORIGINALMORTGAGEE: 'beneficiary', ORIGINALBENEFICIARYMORTGAGEE: 'beneficiary', CURRENTBENEFICIARY: 'holder', CURRENTMORTGAGEE: 'holder',
  CURRENTBENEFICIARYMORTGAGEE: 'holder', CURRENTMORTGAGEEBENEFICIARY: 'holder', ORIGINALMORTGAGEEBENEFICIARY: 'beneficiary', MORTGAGEE: 'holder', HOLDER: 'holder', NOTEHOLDER: 'holder', OWNERANDHOLDER: 'holder', SECUREDPARTY: 'beneficiary',
  BORROWER: 'borrower', BORROWERS: 'borrower', DEBTOR: 'borrower', DEBTORS: 'borrower', MAKER: 'borrower', MAKERS: 'borrower', OBLIGOR: 'borrower', OBLIGORS: 'borrower',
  GRANTOR: 'grantor', GRANTORS: 'grantor', MORTGAGOR: 'grantor', MORTGAGORS: 'grantor', GRANTORSMORTGAGORS: 'grantor', GRANTORMORTGAGOR: 'grantor', GUARANTOR: 'guarantor',
  PROPERTY: 'property', PROPERTYADDRESS: 'address', ADDRESSOFPROPERTY: 'address', STREETADDRESS: 'address', COMMONLYKNOWNAS: 'address', LEGALDESCRIPTION: 'legal',
  SUBSTITUTETRUSTEE: 'trustees', SUBSTITUTETRUSTEES: 'trustees', TRUSTEE: 'trustee', TRUSTEES: 'trustees', SUCCESSORTRUSTEE: 'trustees',
  MORTGAGESERVICER: 'servicer', SERVICER: 'servicer', LOANSERVICER: 'servicer',
  ORIGINALPRINCIPAL: 'principal', ORIGINALPRINCIPALAMOUNT: 'principal', PRINCIPALAMOUNT: 'principal', ORIGINALAMOUNT: 'principal', ORIGINALLOANAMOUNT: 'principal',
  ORIGINALPRINCIPALBALANCE: 'principal', AMOUNT: 'amount', FACEAMOUNT: 'principal',
  RECORDED: 'recording', RECORDEDIN: 'recording', RECORDINGINFORMATION: 'recording', RECORDINGINFO: 'recording', INSTRUMENTNO: 'recording', INSTRUMENTNUMBER: 'recording',
  DOCUMENTNO: 'recording', DOCUMENTNUMBER: 'recording', CLERKSFILENO: 'recording',
  DATEOFSALE: 'saleDate', SALEDATE: 'saleDate', DATEOFSALEOFPROPERTY: 'saleDate', DATEANDTIMEOFSALE: 'saleDate', DATEANDTIMEOFSUBSTITUTETRUSTEESSALEOFPROPERTY: 'saleDate',
  DATETIMEPLACEOFSALE: 'saleSection', DATETIMEANDPLACEOFSALE: 'saleSection', DATETIMEANDPLACEOFSALEOFPROPERTY: 'saleSection',
  PLACE: 'place', PLACEOFSALE: 'salePlace', PLACEOFSALEOFPROPERTY: 'salePlace', LOCATIONOFSALE: 'salePlace', PLACEOFSUBSTITUTETRUSTEESSALEOFPROPERTY: 'salePlace',
  TIME: 'time', TIMEOFSALE: 'time', EARLIESTTIMESALEWILLBEGIN: 'time',
  TRUSTEESADDRESS: 'other', SUBSTITUTETRUSTEESADDRESS: 'other', SUBSTITUTETRUSTEESMAILINGADDRESS: 'other', BENEFICIARYSMAILINGADDRESS: 'other', MORTGAGESERVICERSADDRESS: 'other',
  ADDRESS: 'other', TELEPHONE: 'other', PHONE: 'other', TERMSOFSALE: 'other', DESIGNATEDAREA: 'other',
});
export function labelOf(raw) {
  const w = lettersOnly(raw);
  if (!w || w.length > 50) return null;
  if (LABELS[w]) return LABELS[w];
  let best = null;
  for (const [k, v] of Object.entries(LABELS)) {
    const max = k.length <= 5 ? 1 : k.length <= 10 ? 2 : 3;
    if (Math.abs(k.length - w.length) > max) continue;
    const d = editDistance(w, k);
    if (d > max) continue;
    if (!best || d < best.d) best = { v, d, tie: false };
    else if (d === best.d && v !== best.v) best.tie = true;
  }
  return best && !best.tie ? best.v : null;
}
// Section headings: a labelled field's meaning depends on the heading above it ("Date:" under the sale is the sale date, under the deed
// of trust its date, and before any heading the notice's own date).
const SECTION_OF = { saleSection: 'sale', saleDate: 'sale', salePlace: 'sale', deedOfTrust: 'deedOfTrust', note: 'note', property: 'property' };
const HEADINGS = [
  [/\bdate[.,]?\s*time[.,]?\s*(?:a\w{1,2}d\s+)?place\s*of\s*(?:the\s+)?sale\b|\bsale\s+information\b/i, 'sale'],
  [/\binstrument\s+to\s+be\s+foreclosed\b|\bdeed\s+of\s+trust\s+information\b|\bsecurity\s+instrument\b/i, 'deedOfTrust'],
  [/\bobligations?\s+secured\b|\bnote\s+information\b/i, 'note'],
  [/\bproperty\s+to\s+be\s+sold\b/i, 'property'],
  [/\bmortgage\s+servicer\s+information\b/i, 'servicer'],
];
const LABEL_LINE = /^([A-Za-z][A-Za-z ,.'\]\[|()1&/\\$]{0,70}?)\s*[:;]\s*/;
const mainSegment = (s) => String(s ?? '').trim().split(/\s{4,}/)[0].trim();

// The labelled blocks: each label line's value and its continuation lines, until the next label. A label may be split across lines
// ("Original / Principal / Amount:", "SUBSTITUTE / TRUSTEE:"): up to three short lines with no colon are read with the label line that
// follows when together they make a known label. A value stops at a wide gap, where the clerk's stamp or a second column begins, and a
// continuation line counts only when it starts at the value's own column: the stamp's lines (which name a deputy clerk) never join it.
// Which section a label belongs to: the one the last heading or section label opened. A section a label opened ("DEED OF TRUST:")
// closes at a later label at its own indent that only stands at the top ("LENDER:", "BORROWER:", "PROPERTY:"); a section a heading
// opened ("DEED OF TRUST INFORMATION", "1. Date, Time and Place of Sale") holds until the next heading, whatever the indent.
const TOP_ONLY = new Set(['lender', 'borrower', 'trustees', 'property', 'saleDate', 'salePlace', 'note', 'deedOfTrust', 'saleSection', 'other']);
export function labelledBlocks(text) {
  const lines = linesOf(text);
  const blocks = [];
  let cur = null, section = null, sectionIndent = -1, byHeading = false;
  const open = (sec, indent, heading) => { section = sec; sectionIndent = indent; byHeading = heading; };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const indent = line.length - line.trimStart().length;
    const t = line.trim();
    if (!t) { cur = null; continue; }
    const main = mainSegment(t);
    let m = LABEL_LINE.exec(t);
    if (!m) {
      const gap = /^([A-Z][A-Z .,'&/()]{2,40}?)(\s{4,})\S/.exec(t);
      const l = gap ? labelOf(gap[1]) : null;
      if (l && !SECTION_OF[l] && lettersOnly(gap[1]).length >= 4) m = Object.assign([`${gap[1]}${gap[2]}`, gap[1]], { index: 0 });
    }
    // A heading in prose ("3. Instrument to be Foreclosed.", "DEED OF TRUST INFORMATION") or alone on its line ("Deed of Trust").
    const heading = HEADINGS.find(([re]) => re.test(main.slice(0, 70)));
    if (heading && !(m && labelOf(m[1]))) { open(heading[1], indent, true); cur = null; }
    if (!m && main.length <= 60) { const h = labelOf(main); if (h && SECTION_OF[h] && !['saleDate', 'salePlace'].includes(h)) { open(SECTION_OF[h], indent, false); cur = null; continue; } }
    if (m) {
      // The label, with any short lines just above it that belong to it.
      let label = labelOf(m[1]), took = [];
      const above = [];
      for (let k = 1; k <= 3 && i - k >= 0; k++) {
        const prev = mainSegment(lines[i - k]);
        if (!prev || !/^[A-Za-z' ]{2,30}$/.test(prev) || prev.split(' ').length > 3) break;
        above.unshift(prev);
        const joined = labelOf(`${above.join(' ')} ${m[1]}`);
        if (joined) { label = joined; took = [...above]; }
      }
      if (label) {
        if (took.length && blocks.length) { const last = blocks[blocks.length - 1]; for (const w of took) { const at = last.value.lastIndexOf(w); if (at >= 0) last.value.splice(at, 1); } }
        // Section labels open their section; a top-only label at the section's own indent closes a section a label opened.
        if (section && !byHeading && indent <= sectionIndent && TOP_ONLY.has(label)) open(null, -1, false);
        const opens = SECTION_OF[label];
        const mine = opens && !['saleDate', 'salePlace'].includes(label) ? null : opens === 'sale' ? 'sale' : section;
        if (opens && !['saleDate', 'salePlace'].includes(label)) open(opens, indent, false);
        const valueCol = indent + m[0].length;
        const rest = mainSegment(t.slice(m[0].length));
        cur = { label, value: rest ? [rest] : [], indent, valueCol: rest ? valueCol : null, section: mine, line: i };
        blocks.push(cur);
        continue;
      }
    }
    // A continuation line: at the value's column (or, when the label line had no value, anywhere right of the label).
    if (cur) {
      const col = cur.valueCol;
      const aligned = col === null ? indent >= cur.indent && !LABEL_LINE.test(t) : Math.abs(indent - col) <= 3;
      if (aligned && !heading && !/^\d\s*[.,']\s+[A-Z]/.test(t)) { cur.value.push(mainSegment(t)); if (col === null) cur.valueCol = indent; continue; }
      if (col !== null && indent > col + 3) continue;   // a stamp or a second column to the right: skipped
    }
    cur = null;
  }
  return blocks.map((b) => ({ label: b.label, section: b.section, indent: b.indent, line: b.line, text: b.value.join(' ').replace(/\s+/g, ' ').trim() }));
}

// The attorney's form, by its labelled blocks: three or more of its own top-level labels.
export const detectLayout = (text) => {
  const top = new Set(labelledBlocks(text).filter((b) => b.indent < 4).map((b) => b.label));
  if (['date', 'note', 'deedOfTrust', 'lender', 'borrower', 'property', 'trustees'].filter((l) => top.has(l)).length >= 3) return 'attorney';
  return /Deed\s*of\s*Trust|Contract\s*Lien/i.test(flowOf(text)) ? 'servicer' : null;
};

// ---- Candidates for each field ------------------------------------------------------------------------------------------------------
// OCR's forms of the words the recital turns on: "mortgagee" as "mongagee" or "modgagee", "the" as "lhe" or "tbe".
const MTG = 'mo\\w{2,4}a?gee';
const THE = '(?:the|lhe|tbe|thc|tlie|ihe)';
const cands = () => ({ sale: [], notice: [], dotDated: [], dotRecorded: [], dotRef: [], principal: [], address: [], place: [], payee: [], beneficiary: [], holder: [], servicer: [], trustees: [], borrower: [], grantor: [] });
const push = (c, k, v, how) => { if (v !== undefined && v !== null && String(v).trim()) c[k].push({ v: String(v).replace(/\s+/g, ' ').trim(), how }); };
const after = (flow, re, n = 200) => { const m = re.exec(flow); return m ? flow.slice(m.index + m[0].length, m.index + m[0].length + n) : null; };
const allAfter = (flow, re, n = 200) => [...flow.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`))].map((m) => flow.slice(m.index + m[0].length, m.index + m[0].length + n));

// The name just before a phrase, back to the start of its sentence. A period inside an abbreviation (N.A., Inc., L.L.C., Mr.) is not
// a sentence's end.
const ABBREV = /(?:\b(?:N\.A|Inc|Co|Corp|Ltd|L\.L\.C|L\.P|L\.L\.P|P\.C|P\.A|Jr|Sr|Mr|Mrs|Ms|Dr|St|U\.S|F\.S\.B|No|Nos|Assn|Natl|Bros)|\b[A-Z])$/;
export function nameBefore(flow, index, max = 160) {
  const start = Math.max(0, index - max);
  const s = flow.slice(start, index);
  let cut = 0;
  for (const m of s.matchAll(/[.;:!?)]\s+(?=[A-Z0-9"'(])|\bWHEREAS,?\s+|\b(?:and|ald|ard)\s+(?=[A-Z][A-Za-z]+\s)/g)) {
    const before = s.slice(0, m.index);
    if (m[0][0] === '.' && ABBREV.test(before)) continue;
    cut = m.index + m[0].length;
  }
  return s.slice(cut).replace(/^[,\s]+|[,\s]+$/g, '');
}
// Words a name never holds: a phrase caught instead of a name.
const NOT_A_NAME = /\b(?:pursuant|whereas|indebtedness|securing|deed\s+of\s+trust|hereby|authorized|property\s+code|section|notice|agreement|undersigned|the\s+mortgagee|said|default|request|is\s+the|has\s+been|will\s+be)\b/i;
const asName = (s) => { const n = cleanName(s); return n && !NOT_A_NAME.test(n) && n.length <= 120 ? n : null; };

// The labelled reader (the attorney's form, and every form's labelled lines).
export function parseAttorneyNotice(text) {
  const c = cands();
  const blocks = labelledBlocks(text);
  const firstSection = blocks.findIndex((b) => b.section);
  for (const [i, b] of blocks.entries()) {
    const v = b.text;
    switch (b.label) {
      case 'date':
        // "Date:" then "Time:" and "Place:" is the sale's, whatever heading the OCR lost above it.
        if (b.section === 'sale' || blocks.slice(i + 1, i + 3).some((n) => n.label === 'time' || n.label === 'place')) push(c, 'sale', v, 'label');
        else if (b.section === 'deedOfTrust') push(c, 'dotDated', v, 'label');
        else if (b.section === 'note') push(c, 'dotDated', v, 'label-note');
        else if (!b.section && (firstSection < 0 || i < firstSection) && b.line < 40) push(c, 'notice', v, 'label');
        break;
      case 'saleDate': push(c, 'sale', v, 'label'); break;
      case 'dotDate': push(c, 'dotDated', v, 'label'); break;
      case 'place': if (b.section === 'sale') push(c, 'place', v, 'label'); break;
      case 'salePlace': push(c, 'place', (/\bas\s+follows\s*:\s*(.+)$/i.exec(v)?.[1] ?? v).replace(/\s+(?:OR\s+IF\s+THE\s+PRECEDING|or\s+if\s+the\s+preceding)\b.*$/i, ''), 'label'); break;
      case 'payee': push(c, 'payee', v, 'label'); break;
      case 'lender': push(c, b.section === 'deedOfTrust' && b.indent >= 4 ? 'beneficiary' : 'holder', v, 'label'); break;
      case 'beneficiary': push(c, 'beneficiary', v, 'label'); break;
      case 'holder': push(c, 'holder', v, 'label'); break;
      case 'servicer': push(c, 'servicer', v.replace(/\s+(?:is\s+representing|is\s+acting)\b.*$/i, ''), 'label'); break;
      case 'trustees': push(c, 'trustees', v.replace(/,?\s+(?:as\s+)?Substitute\s+Trustees?\b.*$/i, ''), 'label'); break;
      case 'trustee': if (b.indent < 4 && !b.section) push(c, 'trustees', v.replace(/,?\s+(?:as\s+)?(?:Substitute\s+)?Trustees?\b.*$/i, ''), 'label'); break;
      case 'borrower': push(c, 'borrower', v, 'label'); break;
      case 'grantor': push(c, 'grantor', v, 'label'); break;
      case 'principal': push(c, 'principal', v, 'label'); break;
      case 'amount': if (b.section === 'note' || !b.section) push(c, 'principal', v, 'label'); break;
      case 'note': { const a = /\(\s*(\$[0-9][0-9,.]*[0-9])/.exec(v) ?? /(\$[0-9][0-9,.]*[0-9])/.exec(v); if (a && (v.match(/\$/g) ?? []).length === 1) push(c, 'principal', a[1], 'label-note'); break; }
      case 'recording': c.dotRefSeen = true; push(c, 'dotRef', v, 'label'); break;
      case 'address': push(c, 'address', v, 'label'); break;
      case 'property': { const k = /\b(?:more\s+)?(?:commonly\s+)?known\s+as\s*:?\s*(.+)$/i.exec(v); if (k) push(c, 'address', k[1], 'label-property'); else if (/^\d{1,6}\s+[A-Za-z]/.test(v)) push(c, 'address', v, 'label-property'); break; }
      default: break;
    }
  }
  return c;
}

// The recital reader (the servicer's form, and every form's recital paragraphs).
export function parseServicerNotice(text) {
  const flow = flowOf(text);
  const c = cands();
  const D = '([0-9lIOo|!\\\\/]{5,12}|[A-Za-z$]{3,10}\\.?\\s*[0-9lIOo]{1,2}(?:st|nd|rd|th)?\\s*[,.]?\\s*[0-9lIOo]{4})';
  // Deed of trust: "WHEREAS, on 7/15/2024, <grantor>, as Grantor/Borrower, executed"; "on <date>, <names> executed a Deed of Trust";
  // "Deed of Trust (or Contract Lien) dated <date> and recorded (on <date>) in/under Document <ref>".
  let m = new RegExp(`W\\w{0,3}EREAS,?\\s+on\\s+${D},?\\s*(.{3,200}?),?\\s+(?:as\\s+(?:the\\s+)?(?:Grantors?|Mortgagors?|Borrowers?)(?:\\s*\\/\\s*(?:Borrowers?|Grantors?|Mortgagors?))?\\b|executed\\s+a\\s+Deed)`, 'i').exec(flow);
  if (m) { push(c, 'dotDated', m[1], 'recital'); push(c, 'grantor', m[2], 'recital'); }
  for (const s of allAfter(flow, /\bDeed\s+of\s+Trust\s*(?:or\s+Contract\s+Lien\s+)?(?:dated|executed\s+on)\s+/i, 200)) {
    const d = new RegExp(`^${D}`, 'i').exec(s);
    if (d) push(c, 'dotDated', d[1], 'recital');
    const r = new RegExp(`^${D}?,?\\s*(?:and\\s+)?recorded\\s+(?:on\\s+${D}\\s+)?(?:as|under|in)\\s+(.{0,90})`, 'i').exec(s.replace(new RegExp(`^${D}`, 'i'), (x) => `${x}`));
    const r2 = /\brecorded\s+(?:on\s+(\S{5,14})\s+)?(?:as|under|in)\s+(.{0,90})/i.exec(s);
    if (r2) { if (r2[1]) push(c, 'dotRecorded', r2[1], 'recital'); c.dotRefSeen = true; push(c, 'dotRef', r2[2], 'recital'); }
    else if (r) { c.dotRefSeen = true; push(c, 'dotRef', r[3], 'recital'); }
  }
  m = new RegExp(`\\bRecorded\\s+(?:on\\s*)?${D},?\\s+(?:as|under|in)\\s+(.{0,90})`, 'i').exec(flow);
  if (m) { push(c, 'dotRecorded', m[1], 'recital'); c.dotRefSeen = true; push(c, 'dotRef', m[2], 'recital'); }
  for (const s of allAfter(flow, /\brecorded\s+(?:under|in|as)\s+(?=(?:Clerk'?s?\s+)?(?:File|Document|Instrument|Volume|Doc))/i, 90)) { c.dotRefSeen = true; push(c, 'dotRef', s, 'recital'); }
  // Parties. MERS, wherever it is named as nominee, gives the original lender; "<X>, its successors and assigns as (Original) Mortgagee".
  for (const x of flow.matchAll(new RegExp(`(?:Mortgage|Mo\\w{3,6})?\\s*E[il1]ectron[il1]c\\s+Reg[il1]strat[il1]on\\s+Systems?.{0,90}?\\bnominee\\s+for\\s+(.{3,140}?)(?=,?\\s+(?:its|and\\s+its)\\s+successors\\b|,?\\s+as\\s+(?:the\\s+)?(?:Original\\s+)?(?:${MTG}|Beneficiary|Lender)\\b|,\\s+which\\b|[;"]|\\.\\s)`, 'gi')))
    push(c, 'beneficiary', `Mortgage Electronic Registration Systems, Inc., as nominee for ${x[1]}`, 'recital');
  m = /\bin\s+favor\s+of\s+.{2,120}?,?\s+as\s+(?:original\s+)?Trustee,?\s+(?:for\s+the\s+benefit\s+of\s+)?(.{3,260}?),?\s+as\s+(?:the\s+)?Beneficiary\b(?!\s*,?\s*as\s+nominee)/i.exec(flow)
    ?? /\bfor\s+the\s+benefit\s+of\s+(.{3,260}?)(?:,?\s+as\s+(?:the\s+)?Beneficiary\b(?!\s*,?\s*as\s+nominee)|,?\s+(?:its|and\s+its)\s+successors\b|,\s+securing|\s+which\s+deed)/i.exec(flow);
  if (m) push(c, 'beneficiary', m[1], 'recital');
  m = /\bpayable\s+to\s+the\s+order\s+of\s+(.{3,260}?)(?:,?\s+which\s+Deed|,?\s+(?:its|and\s+its)\s+successors\b|;|\.\s)/i.exec(flow);
  if (m) push(c, 'payee', m[1], 'recital');
  // "with <grantor>, grantor(s) and <beneficiary>, mortgagee"; "... as Lender, <beneficiary> as Beneficiary".
  m = new RegExp(`\\bwith\\s+(.{3,200}?),?\\s+(?:as\\s+)?(?:grantor|mortgagor|[A-Za-z]{4,9}\\s*\\(\\s*s\\s*\\))\\s*\\(?s?\\)?\\s*,?\\s+and\\s+(.{3,300}?),?\\s+(?:as\\s+)?(?:${MTG}|beneficiary|lender)\\b`, 'i').exec(flow);
  if (m) { push(c, 'grantor', m[1], 'recital'); if (!/nominee/i.test(m[2])) push(c, 'beneficiary', m[2], 'recital'); }
  m = /\bas\s+Lender,\s+(.{3,200}?),?\s+as\s+Beneficiary\b/i.exec(flow);
  if (m) push(c, 'holder', m[1], 'recital');
  // The current holder: "<X> is the current mortgagee", "<X>, which is the mortgagee", "The current mortgagee is <X>".
  for (const x of flow.matchAll(new RegExp(`,?\\s+(?:is|which\\s+is|who\\s+is)\\s+${THE}\\s+(?:[A-Za-z'’]{3,9}\\s+)?(?:${MTG}|beneficiary|holder|owner\\s+and\\s+holder)\\b(?!'s)`, 'gi'))) {
    const n = nameBefore(flow, x.index);
    const sv = /\bmortgage\s+servicer\s+for\s+(.{3,160})$/i.exec(n);
    push(c, 'holder', sv ? sv[1] : n, 'recital');
  }
  m = /\b(?:The\s+)?(?:current\s+)?Mortgagee\s*(?:is|:)\s*(.{3,120}?)(?:,?\s+(?:whose|with\s+an?)\s+address\b|,?\s+which\b|\.\s)/i.exec(flow);
  if (m) push(c, 'holder', m[1], 'recital');
  // The servicer: "<X> whose address is ..., is acting as the mortgage servicer for"; "<X> is acting as the Mortgage Servicer";
  // "<X>, as Mortgage Servicer, is representing"; "<X> is representing the Current Mortgagee"; "The Mortgage Servicer is <X>".
  m = /(?:,|\band\b|\ba[lnr]d\b)\s+([A-Z][^,]{2,80}(?:,\s*(?:LLC|L\.L\.C\.|Inc\.?|N\.A\.|LP|L\.P\.|FSB|F\.S\.B\.|Corp\.?))?),?\s+whose\s+address\s+is\b.{0,200}?\bis\s+acting\s+as\s+the\s+(?:mortgage\s+)?servicer\s+for\s+(.{3,160}?),?\s+which\s+is\s+the\s+(?:current\s+)?mortgagee\b/i.exec(flow);
  if (m) { push(c, 'servicer', m[1], 'recital'); push(c, 'holder', m[2], 'recital'); }
  for (const x of flow.matchAll(/,?\s+(?:is\s+acting\s+as\s+the\s+Mortgage\s+Servicer\b|as\s+(?:the\s+)?Mortgage\s+Servicer,?\s+is\s+represent|is\s+representing\s+the\s+(?:\w{3,9}\s+)?(?:Beneficiary\s*\/\s*)?Mortgagee\b)/gi)) push(c, 'servicer', nameBefore(flow, x.index), 'recital');
  m = /\bThe\s+Mortgage\s+Servicer\s+is\s+(?!authorized)(.{3,120}?)(?:,?\s+(?:whose|with\s+an?)\s+address\b|,?\s+which\b|\.\s)/i.exec(flow);
  if (m) push(c, 'servicer', m[1], 'recital');
  // The substitute trustees: "appointed <names>, or any one of them, as Substitute Trustee"; "does name and appoint <names>, Substitute
  // Trustee"; "appoints in their stead: <names>, ... as Substitute Trustee". An address after a name ends the list.
  m = /\b(?:name\s+and\s+appoint|appoints?\s+in\s+(?:their|its|his)\s+stead:?|appointed|appoints?)\s+(.{3,600}?),?\s+(?:or\s+any\s+(?:one|1)\s+of\s+them,?\s+)?(?:as\s+)?Substitute\s+Trustees?\b/i.exec(flow);
  if (m) push(c, 'trustees', m[1].replace(/^in\s+\S+\s+\S+:?\s+(?=[A-Z])/, '').replace(/,?\s+(?:located\s+at|whose\s+address|c\/o)\b.*?(?=,\s+or\s+any|$)/i, ''), 'recital');
  // The borrower: "executed by <names>, securing"; "executed by <names>, as Grantor".
  for (const x of flow.matchAll(/\b(?:Lien|Trust)\s+executed\s+by\s+(.{3,200}?)(?=,?\s+(?:securing|as\s+(?:Grantors?|Mortgagors?)|to\s+[A-Z]|and\s+delivered|in\s+favor|recorded)\b)/gi)) push(c, 'borrower', x[1], 'recital');
  // The original principal: "original (principal) amount of $X", "original principal sum of $X", with OCR's misreadings of the words.
  for (const s of allAfter(flow, /\boriginal\s+(?:pr\w{4,8}\s+)?(?:a\w{4,6}|sum|balance)\s+o[fl1]\s*/i, 30)) push(c, 'principal', s, 'recital');
  for (const s of allAfter(flow, /\boriginal\s+(?:\S{3,12}\s+){1,2}o[fl1]\s*(?=\$)/i, 30)) push(c, 'principal', s, 'recital');
  for (const s of allAfter(flow, /\boriginal\s+principal\s+(?:amount|balance)?\s*:\s*/i, 30)) push(c, 'principal', s, 'recital');
  // The address: "Commonly known as", "Property Address:", "known as" in a property description.
  for (const s of allAfter(flow, /\b(?:more\s+)?commonly\s+known\s+as\s*:?\s*|\bProp\w{2,6}\s+Address\s*:?\s*|\bstreet\s+address\s+(?:is\s+)?:?\s*/i, 160)) push(c, 'address', s, 'recital');
  for (const s of allAfter(flow, /\bknown\s+as\s*:?\s*(?=\d{1,6}\s+[A-Za-z])/i, 160)) push(c, 'address', s, 'recital');
  // The sale: "NOTICE IS HEREBY GIVEN, that on <date>"; "Date of Sale: <date>"; the place "as follows: <place>".
  for (const s of allAfter(flow, /\bNOTICE\s+IS\s+HEREBY\s+G\w{1,4}N,?\s+(?:that\s+)?on\s+/i, 40)) push(c, 'sale', s, 'recital');
  for (const s of allAfter(flow, /\bDate\s+of\s*Sale\s*:?\s*/i, 40)) push(c, 'sale', s, 'recital');
  m = /\bas\s+follows\s*:\s*(.{10,400}?)(?=\s*(?:,?\s+OR\s+IF\s+THE\s+PRECEDING|,?\s+or\s+if\s+the\s+preceding|NOTICE\s+IS\s+FURTHER|\bIf\s+the\s+|\bTerms\s+of\s+Sale\b|$))/i.exec(after(flow, /\barea\s+designated\s+by\s+the\s+Commissioner'?s?'?\s+Court\b/i, 600) ?? '');
  if (m) push(c, 'place', m[1], 'recital');
  m = /\bThe\s+place\s+of\s+the\s+sale\s+shall\s+be\s*:\s*(.{10,300}?)(?=\s+(?:or\s+if\s+the\s+preceding|NOTICE|The\s+Sale\b)|$)/i.exec(flow);
  if (m) push(c, 'place', m[1], 'recital');
  // The notice's own date: "WITNESS, my hand this <date>"; "Executed on <date>"; "Dated: <date>"; "this 14th day of September, 2026".
  for (const s of allAfter(flow, /\bWITNESS,?\s+my\s+hand\s+(?:this|on)\s+(?:the\s+)?/i, 40)) push(c, 'notice', s, 'recital');
  for (const s of allAfter(flow, /\b(?:Executed|EXECUTED|Dated|DATED|Signed|SIGNED)\s+(?:on|this|as\s+of|:)\s*(?:the\s+)?/g, 40)) push(c, 'notice', s, 'recital');
  return c;
}

// ---- One notice to a record ---------------------------------------------------------------------------------------------------------
// Each field's candidates through its check, in order. Returns { value, state }: 'read', 'not-read' (a candidate failed its check,
// or two passed and disagree) or 'not-stated' (no candidate at all).
function pick(list, read, { agree = true } = {}) {
  if (!list.length) return { value: null, state: 'not-stated' };
  const ok = [];
  for (const x of list) { const v = read(x.v); if (v !== null && v !== undefined) ok.push({ v, how: x.how }); }
  if (!ok.length) return { value: null, state: 'not-read' };
  if (agree && new Set(ok.map((o) => JSON.stringify(o.v))).size > 1) return { value: null, state: 'not-read' };
  return { value: ok[0].v, state: 'read', how: ok[0].how };
}

// Every Texas sale day the notice names near its fetch, for the sale date when no labelled or recital reading gave one: read only
// when there is exactly one.
function saleDaysIn(flow, today) {
  const out = new Set();
  for (const m of flow.matchAll(/\b([A-Za-z]{3,10})\.?\s*([0-9lIOo]{1,2})(?:st|nd|rd|th)?\s*[,.]?\s*([0-9lIOo]{4})\b/g)) {
    const r = readDateAt(m[0]).date;
    if (r && texasSaleDay(r) && dayDiff(today, r) >= -90 && dayDiff(today, r) <= 150) out.add(r);
  }
  for (const m of flow.matchAll(/(?<![0-9A-Za-z$])([0-9lIO][0-9lIOo|!\\/t,'.-]{5,11})(?![0-9A-Za-z])/g)) {
    const all = numericDateReadings(m[1], (r) => texasSaleDay(r) && dayDiff(today, r) >= -90 && dayDiff(today, r) <= 150);
    if (all.length === 1) out.add(all[0]);
  }
  return [...out];
}

function finish({ c, layout, fetchedAt, listedDate, flow }) {
  const today = String(fetchedAt ?? new Date().toISOString()).slice(0, 10);
  const fields = {};
  const unread = [];
  const mark = (field, state, unreadKey) => { fields[field] = state; if (state === 'not-read' && unreadKey) unread.push(unreadKey); };
  const dateWith = (ok) => (s) => readDateAt(s, ok).date;

  // Dates. The sale date: a Texas sale day within 400 days of the fetch. The notice date: within the 400 days before the fetch.
  let saleP = pick(c.sale, dateWith((d) => texasSaleDay(d) && Math.abs(dayDiff(today, d)) <= 400));
  if (saleP.state !== 'read') {
    const days = saleDaysIn(flow, today);
    if (days.length === 1) saleP = { value: days[0], state: 'read', how: 'sale-day' };
    else if (days.length > 1 && saleP.state === 'not-stated') saleP = { value: null, state: 'not-read' };
  }
  const noticeP = pick(c.notice, dateWith((d) => d <= addDays(today, 1) && dayDiff(d, today) <= 400), { agree: false });
  let sale = saleP.value, notice = noticeP.value;
  let saleState = saleP.state, noticeState = noticeP.state;
  if (sale && notice && sale === notice) { notice = null; noticeState = 'not-read'; }   // one date read twice is the sale's
  if (sale && notice) {
    const gap = dayDiff(notice, sale);
    if (gap < 21 || gap > 180) {
      if (listedDate && listedDate === sale) { notice = null; noticeState = 'not-read'; }   // the list corroborates the sale date
      else { sale = null; notice = null; saleState = 'not-read'; noticeState = 'not-read'; }
    }
  }
  mark('saleDate', saleState, 'dates.sale');
  mark('noticeDate', noticeState, 'dates.notice');

  // The deed of trust: its date, its recording date and its reference.
  const latest = notice ?? today;
  const datedP = pick(c.dotDated, dateWith((d) => d >= '1950-01-01' && d <= latest), { agree: false });
  const dated = datedP.value;
  const recordedP = pick(c.dotRecorded, dateWith((d) => d <= latest && (!dated || (d >= dated && dayDiff(dated, d) <= 400))));
  const lo = dated ? Number(dated.slice(0, 4)) : 1950, hi = dated ? Number(dated.slice(0, 4)) + 1 : Number(latest.slice(0, 4));
  const refP = pick(c.dotRef, (s) => { const r = readRecording(s); return r && (!r.documentNumber || (Number(r.documentNumber.slice(0, 4)) >= lo && Number(r.documentNumber.slice(0, 4)) <= hi)) ? r : null; }, { agree: false });
  mark('deedOfTrust.reference', refP.state === 'not-stated' && c.dotRefSeen ? 'not-read' : refP.state, 'deedOfTrust.reference');
  mark('deedOfTrust.dated', datedP.state, 'deedOfTrust.dated');
  mark('deedOfTrust.recorded', recordedP.state, 'deedOfTrust.recorded');

  // The original principal, the address and the sale place.
  const opP = pick(c.principal, readDollars);
  mark('originalPrincipal', opP.state, 'amounts.originalPrincipal');
  const addrP = pick(c.address, readAddress, { agree: false });
  mark('address', addrP.state, 'property.address');
  const placeP = pick(c.place, readPlace, { agree: false });
  mark('salePlace', placeP.state, 'salePlace');

  // The parties, each in its own role. The lender side: the note's payee (lender), the deed of trust's beneficiary, the current holder.
  const parties = [];
  const add = (role, name) => { if (name && !parties.some((p) => p.role === role && p.name === name)) parties.push({ role, name }); };
  const lenders = [], from = new Set();
  let lenderSeen = false;
  for (const [role, key] of [['lender', 'payee'], ['beneficiary', 'beneficiary'], ['holder', 'holder']]) {
    for (const x of c[key]) {
      lenderSeen = true;
      const l = lenderName(x.v);
      if (!l || (l.name && NOT_A_NAME.test(l.through ?? l.name)) || (l.name.length > 160)) continue;
      add(role, l.name);
      if (l.through) { lenders.push(l.through); from.add(x.how); }
      break;   // the first readable name for each role
    }
  }
  mark('lender', lenders.length ? 'read' : lenderSeen ? 'not-read' : 'not-stated', 'lender');
  const servicerP = pick(c.servicer, (s) => asName(String(s).replace(/,?\s+(?:whose|with\s+an?)\s+address\b.*$/i, '').replace(DESCRIPTION, '')), { agree: false });
  add('servicer', servicerP.value);
  mark('servicer', servicerP.state, 'servicer');
  const trustees = [];
  for (const x of c.trustees) { const t = splitNames(x.v).filter((n) => !NOT_A_NAME.test(n) && !/\b(?:trustees?|address|sale)\b/i.test(n) && (n.includes(' ') || /\.(?:com|net)\b/i.test(n))); if (t.length) { trustees.push(...t); break; } }
  for (const t of trustees) add('trustee', t);
  mark('trustee', trustees.length ? 'read' : c.trustees.length ? 'not-read' : 'not-stated', 'trustee');
  // A borrower or grantor that repeats a lender-side name is a misread (a table's columns crossed), never the borrower.
  const key20 = (x) => String(x ?? '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 20);
  const lenderKeys = lenders.map(key20).filter((k) => k.length >= 8);
  const sameAsLender = (n) => { const k = String(n).toUpperCase().replace(/[^A-Z]/g, ''); return lenderKeys.some((l) => k.includes(l) || l.includes(k.slice(0, 20))); };
  const person = (s) => { const n = borrowerName(s); return n && !NOT_A_NAME.test(n) && !sameAsLender(n) ? n : null; };
  const borrowerP = pick(c.borrower, person, { agree: false });
  const grantorP = pick(c.grantor, person, { agree: false });
  add('borrower', borrowerP.value);
  add('grantor', grantorP.value);
  const who = borrowerP.value ?? grantorP.value;
  const whoRaw = borrowerP.value ? c.borrower[0]?.v : c.grantor[0]?.v;
  mark('borrower', who ? 'read' : (c.borrower.length || c.grantor.length) ? 'not-read' : 'not-stated', 'borrower');
  fields.borrowerKind = who ? (isEntityName(whoRaw) || isEntityName(who) ? 'entity' : 'individual') : 'unknown';

  const amounts = {
    originalPrincipal: opP.state === 'read' ? { value: opP.value, basis: 'document' } : { value: null, basis: opP.state === 'not-read' ? 'not-read' : 'not-stated' },
    unpaidBalance: { value: null, basis: 'not-stated' },   // a Texas notice of sale does not state the balance
  };
  const ref = refP.value, recorded = recordedP.value;
  const document = {
    documentType: 'notice_of_trustee_sale',
    dates: { recorded: null, filed: null, sale, notice },
    parties, property: { address: addrP.value, apn: null, useCode: null, propertyType: null }, amounts,
    deedOfTrust: ref || dated || recorded ? { documentNumber: ref?.documentNumber ?? null, book: ref?.book ?? null, page: ref?.page ?? null, dated, recorded } : null,
    salePlace: placeP.value, unread: [...new Set(unread)].sort(),
  };
  // The layout: the reader that gave the lender.
  // `draft` is the record as far as it was read, for a live check's counts; the run stores only a complete `document`.
  const by = from.has('label') || from.has('label-note') ? 'attorney' : from.size ? 'servicer' : layout;
  if (!lenders.length) return { document: null, draft: document, layout: by, fields, reason: 'no lender, beneficiary or mortgagee could be read' };
  if (!sale && !notice) return { document: null, draft: document, layout: by, fields, reason: 'neither the sale date nor the notice date could be read' };
  return { document, draft: document, layout: by, fields, reason: null };
}

// Both readers' candidates, the labelled ones first for each field.
function merge(a, b) {
  const out = cands();
  for (const k of Object.keys(out)) out[k] = [...(a[k] ?? []), ...(b[k] ?? [])];
  out.dotRefSeen = !!(a.dotRefSeen || b.dotRefSeen);
  return out;
}

// One notice's text to { document, layout, fields, reason }.
export function readCaldwellNotice(text, { fetchedAt, listedDate = null } = {}) {
  const layout = detectLayout(text);
  if (!layout) return { document: null, layout: null, fields: {}, reason: 'neither known layout' };
  return finish({ c: merge(parseAttorneyNotice(text), parseServicerNotice(text)), layout, fetchedAt, listedDate, flow: flowOf(text) });
}

export async function readCaldwellDocument(bytes, { fetchedAt, item } = {}) {
  const t = await pdfToText(bytes);
  if (!t.readable) return { document: null, layout: null, reason: t.reason };
  const r = readCaldwellNotice(t.text, { fetchedAt, listedDate: item?.listedDate ?? null });
  return { document: r.document, layout: r.layout, reason: r.reason, fields: r.fields };
}

// ---- The source -----------------------------------------------------------------------------------------------------------------
export function caldwellSource(entry = registryEntry()) {
  return defineNoticeSource({
    id: CALDWELL_ID,
    label: 'Caldwell County Clerk, posted notices of trustee\'s sale',
    county: { fips: '48055', name: 'Caldwell' },
    state: 'TX',
    channel: 'b',
    cadence: 'weekly',
    hosts: [CALDWELL_HOST],
    minIntervalMs: intervalFrom(entry),
    terms: termsFrom(entry),
    parserVersion: CALDWELL_PARSER_VERSION,
    requests: () => [{ url: CALDWELL_LIST }],
    parse: parseCaldwellList,
    readDocument: readCaldwellDocument,
  });
}
export const caldwellCounty = caldwellSource();
