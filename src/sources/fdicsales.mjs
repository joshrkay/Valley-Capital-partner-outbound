// FDIC loan-sale announcements (PRD E16-S2). When a bank fails, the FDIC as receiver sells its loans in sealed-bid pools, through a
// loan-sale advisor. Each sale is announced on www.fdic.gov: a sale page under /asset-sales/events/, listed on the loan-sales page,
// with an announcement PDF. This adapter reads those pages, gently, and records each SALE ANNOUNCEMENT in sources/fdic/sales.json:
// the sale id and name, the event and key dates (bid deadline, closing), the receiverships (matched to our failed-bank record where
// the name allows), the loan count and unpaid balance, the pool and portfolio description, and the loan-sale advisor's firm name.
//
// What was checked live on 2026-11-14 (robots.txt, the loan-sales page, the events calendar, two sale pages, one announcement PDF):
//   - robots.txt allows /asset-sales/ and sets Crawl-delay: 1. The adapter reads only paths it allows, and never faster than it asks.
//   - A sale page has an "Event Date" field ("October 26–December 2, 2026"), a Key Dates table (MM/DD/YYYY; the row labels vary:
//     "Bidder Due Diligence" or "... Begins", "Closing Date" or "Final Funding/Closing"), a sentence naming the receivership ("in its
//     capacity as Receiver for <Bank>, <City>, <State> (<abbreviation>)") with the loan count and UPB, a portfolio paragraph, and the
//     advisor ("directed to the Loan Sale Advisor (<firm>)") followed by named contacts with phone numbers and email addresses.
//   - The announcement PDF is FlateDecode streams with simple TrueType fonts, so Node's zlib reads its text with no new dependency. Its
//     first lines give the announcement date, which the page does not. A PDF whose text cannot be read is recorded as a link only.
//   - Results: the loan-sales page links "FDIC Closed Loan Sales" (January 2010 to present) on sales.fdic.gov, an application this
//     development environment cannot reach. Whether it names buyers is UNCONFIRMED. No public page on www.fdic.gov was found that
//     names a buyer, so the buyer of every sale here is "unknown".
//
// Rules: the contacts block (people, phone numbers, email addresses) is cut off before anything is parsed, so no person is ever
// stored; only the advisor's firm name is kept. Requests declare config.fdic.userAgent, which must be filled by a principal and may
// not carry a personal email address. Records are context for a principal only.
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { getText, getBytes, realSleep, HttpError } from './http.mjs';
import { startRun, finishRun, sourceBlock, upsertWithChanges, scrub, SOURCE_KEYS } from './runlog.mjs';
import { readJson, writeJson } from '../store.mjs';
import { fdicPaths } from './fdic.mjs';

export const FDIC_WWW = 'https://www.fdic.gov';
export const LISTING_PATH = '/asset-sales/loan-sales';
export const SELLER = Object.freeze({ kind: 'fdic', key: 'fdic-receiver', name: 'FDIC as receiver' });

export const fdicSalesPaths = (dir) => ({ sales: join(dir, 'sources', 'fdic', 'sales.json'), state: join(dir, 'sources', 'fdic', 'sales-state.json') });

// ---- The User-Agent ------------------------------------------------------------------------------------------------------------
const EMAIL = /[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
export function fdicUserAgent(fdic, personalDomains = []) {
  const ua = String(fdic?.userAgent ?? '').trim();
  if (!ua || /\[confirm/i.test(ua)) throw new Error('config.json fdic.userAgent is a placeholder. FDIC requests name the firm and a monitored business contact; a principal fills it (PRD E16-S2).');
  const personal = [...ua.matchAll(EMAIL)].map((m) => m[1].toLowerCase()).filter((d) => personalDomains.map((x) => x.toLowerCase()).includes(d));
  if (personal.length) throw new Error('config.json fdic.userAgent holds an email address at a personal domain. Use a monitored business contact at the firm\'s own domain.');
  return ua;
}

// ---- robots.txt ----------------------------------------------------------------------------------------------------------------
// Groups of user-agent lines with their Allow, Disallow and Crawl-delay lines. An empty Disallow allows everything.
export function parseRobots(text) {
  const groups = [];
  let cur = null, agentLine = false;
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === 'user-agent') {
      if (!cur || !agentLine) { cur = { agents: [], rules: [], crawlDelay: null }; groups.push(cur); }
      cur.agents.push(v.toLowerCase()); agentLine = true; continue;
    }
    agentLine = false;
    if (!cur) continue;
    if ((k === 'allow' || k === 'disallow') && v) cur.rules.push({ allow: k === 'allow', path: v });
    if (k === 'crawl-delay' && Number.isFinite(Number(v)) && Number(v) >= 0) cur.crawlDelay = Number(v);
  }
  return groups;
}

// The rules for our User-Agent: the groups naming a token it contains, or else the "*" groups.
export function robotsFor(groups, userAgent) {
  const ua = String(userAgent ?? '').toLowerCase();
  const own = groups.filter((g) => g.agents.some((a) => a !== '*' && a && ua.includes(a)));
  const chosen = own.length ? own : groups.filter((g) => g.agents.includes('*'));
  const delays = chosen.map((g) => g.crawlDelay).filter((d) => d !== null);
  return { rules: chosen.flatMap((g) => g.rules), crawlDelay: delays.length ? Math.max(...delays) : null };
}

const esc = (s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
// The longest matching rule decides; Allow wins a tie. "*" matches anything, a final "$" anchors the end.
export function robotsAllows({ rules = [] } = {}, path) {
  let best = null;
  for (const r of rules) {
    const anchored = r.path.endsWith('$');
    const body = anchored ? r.path.slice(0, -1) : r.path;
    const re = new RegExp(`^${body.split('*').map(esc).join('.*')}${anchored ? '$' : ''}`);
    if (!re.test(path)) continue;
    if (!best || r.path.length > best.len || (r.path.length === best.len && r.allow)) best = { len: r.path.length, allow: r.allow };
  }
  return best ? best.allow : true;
}

// ---- HTML ------------------------------------------------------------------------------------------------------------------------
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', hellip: '…' };
const decode = (s) => String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e.toLowerCase()] ?? m));
const flat = (html) => decode(String(html).replace(/<(script|style|svg)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d|tr|td|th)>/gi, '\n').replace(/<[^>]+>/g, ' ')).replace(/[ \t ]+/g, ' ').replace(/ *\n[\s]*/g, '\n').trim();
const mainOf = (html) => { const a = html.search(/<main\b/i); const b = html.search(/<\/main>/i); return a >= 0 ? html.slice(a, b > a ? b : undefined) : html; };

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const pad = (n) => String(n).padStart(2, '0');
export function isoFromWords(s) {   // "October 14, 2026" or "OCTOBER 14, 2026" -> 2026-10-14
  const m = /\b([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})\b/.exec(String(s ?? ''));
  const mi = m ? MONTHS.indexOf(m[1].toLowerCase()) : -1;
  return mi >= 0 ? `${m[3]}-${pad(mi + 1)}-${pad(m[2])}` : null;
}
const isoFromSlashes = (s) => { const m = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/.exec(String(s ?? '')); return m ? `${m[3]}-${pad(m[1])}-${pad(m[2])}` : null; };

// "October 26–December 2, 2026, All Day" -> { start: 2026-10-26, end: 2026-12-02 }. A start without a year takes the end's year, or the
// year before when its month is later (a sale running over the new year).
export function eventRange(text) {
  const toks = [...String(text ?? '').matchAll(/\b([A-Za-z]+)\s+(\d{1,2})(?:,\s*(\d{4}))?/g)].filter((m) => MONTHS.includes(m[1].toLowerCase()));
  if (!toks.length) return { start: null, end: null, text: text ? String(text).trim() : null };
  const last = toks.at(-1);
  const year = last[3] ?? (toks.find((t) => t[3])?.[3] ?? null);
  if (!year) return { start: null, end: null, text: String(text).trim() };
  const at = (t, y) => `${y}-${pad(MONTHS.indexOf(t[1].toLowerCase()) + 1)}-${pad(t[2])}`;
  const end = at(last, last[3] ?? year);
  if (toks.length === 1) return { start: end, end, text: String(text).trim() };
  const first = toks[0];
  let y1 = first[3] ?? year;
  if (!first[3] && MONTHS.indexOf(first[1].toLowerCase()) > MONTHS.indexOf(last[1].toLowerCase())) y1 = String(Number(year) - 1);
  return { start: at(first, y1), end, text: String(text).trim() };
}

export function parseListing(html) {
  const main = mainOf(String(html));
  const text = flat(main);
  const heading = /Loan Sales? Event\(s\)/i.test(text);
  const seen = new Map();
  for (const m of main.matchAll(/<a\b[^>]*href="((?:https:\/\/www\.fdic\.gov)?\/asset-sales\/events\/([a-z0-9][a-z0-9-]{0,99}))"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const slug = m[2].toLowerCase();
    if (!seen.has(slug)) seen.set(slug, { slug, path: `/asset-sales/events/${slug}`, title: flat(m[3]) });
  }
  return { heading, empty: /no loan sales? event announcements/i.test(text), events: [...seen.values()] };
}

export const STATES = Object.freeze({ alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO', connecticut: 'CT', delaware: 'DE', 'district of columbia': 'DC', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'puerto rico': 'PR', 'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY' });
const stateCode = (s) => { const t = String(s ?? '').trim(); if (/^[A-Z]{2}$/.test(t)) return t; return STATES[t.toLowerCase()] ?? null; };

// "Example Bank, Anytown, Texas (EXB)" -> { name, city, state, abbr }. Several receiverships are split at each closing
// abbreviation. A clause with no city and state ("various failed institutions") is kept whole, with city and state null.
export function parseReceiverships(clause) {
  const c = String(clause ?? '').replace(/\s+/g, ' ').trim();
  if (!c) return [];
  const parts = c.split(/(?<=\))\s*(?:,|;)?\s*(?:and\s+)?(?:as\s+Receiver\s+for\s+)?(?=\S)/i).map((x) => x.trim()).filter(Boolean);
  return parts.map((p) => {
    const abbr = /\(([^)]{1,20})\)\s*$/.exec(p)?.[1] ?? null;
    const body = p.replace(/\s*\([^)]*\)\s*$/, '').replace(/^and\s+/i, '').trim();
    const bits = body.split(/,\s*/);
    const st = bits.length >= 3 ? stateCode(bits.at(-1)) : null;
    if (st) return { name: bits.slice(0, -2).join(', '), city: bits.at(-2), state: st, abbr };
    return { name: body, city: null, state: null, abbr };
  });
}

const KEY_DATE = [
  [/due diligence/i, 'dueDiligence'], [/calculation/i, 'calculationDate'], [/bid (?:deadline|date)/i, 'bidDeadline'], [/clos|funding|settle/i, 'closing'],
];
export function parseKeyDates(bodyHtml) {
  const out = { dueDiligence: null, calculationDate: null, bidDeadline: null, closing: null, other: [] };
  for (const row of String(bodyHtml).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => flat(m[1]));
    if (cells.length < 2) continue;
    const dates = [...cells[1].matchAll(/\b\d{1,2}\/\d{1,2}\/\d{4}\b/g)].map((m) => isoFromSlashes(m[0]));
    if (!dates.length) continue;
    const hit = KEY_DATE.find(([re]) => re.test(cells[0]));
    if (!hit) { out.other.push({ label: cells[0].slice(0, 60), dates }); continue; }
    out[hit[1]] = hit[1] === 'dueDiligence' ? { start: dates[0], end: dates[1] ?? null } : dates[0];
  }
  return out;
}

// One sale page. Everything from the contacts heading on is cut off before parsing, so no person, phone or email is ever read.
export function parseSalePage(html, { url } = {}) {
  const main = mainOf(String(html));
  const title = flat(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] ?? /<title>([^<]*)<\/title>/i.exec(html)?.[1] ?? '').replace(/\s*\|\s*FDIC\.gov\s*$/i, '').trim() || null;
  const slug = /\/asset-sales\/events\/([a-z0-9-]+)/i.exec(url ?? '')?.[1]?.toLowerCase() ?? null;
  const saleId = (/^([A-Z0-9][A-Z0-9-]{1,30}?)\s+(?:Loan\s+)?Sale\b/i.exec(title ?? '')?.[1] ?? (slug ? slug.replace(/-(?:loan-)?sale-announcement$/, '') : null))?.toUpperCase() ?? null;
  const field = (name) => { const m = new RegExp(`field--name-field-${name}\\b[\\s\\S]*?<div class="field__item">([\\s\\S]*?)</div>`, 'i').exec(main); return m ? flat(m[1]) : null; };
  const eventText = field('event-smartdate');
  const bodyStart = main.search(/field--name-body\b/i);
  let body = bodyStart >= 0 ? main.slice(bodyStart) : main;
  const contacts = body.search(/Prospective Bidder Inquiries|please contact|href="(?:mailto|tel):/i);
  const advisorRaw = /Loan Sale Advisor\s*\(([^)]{2,80})\)/i.exec(flat(body))?.[1] ?? null;
  if (contacts > 0) body = body.slice(0, contacts);
  const text = flat(body);
  // Prose only: a short line with no closing punctuation is a heading or a table cell ("Portfolio Composition", "Calculation Date").
  const prose = text.split('\n').map((l) => l.trim()).filter((l) => /[.;:]$/.test(l) || l.length > 80).join(' ');
  const sentences = prose.split(/(?<=\.)\s+(?=[A-Z])/);
  const clause = /in its capacity as Receivers? for\s+([\s\S]+?),?\s+(?:is|are)\s+(?:conducting|offering|selling)/i.exec(text.replace(/\n+/g, ' '))?.[1] ?? null;
  const size = /comprised of ([\d,]+) loans? having an unpaid principal balance(?: \(UPB\))? of \$([\d,]+(?:\.\d+)?)/i.exec(text.replace(/\n+/g, ' '));
  const pdf = /<a\b[^>]*href="((?:https:\/\/www\.fdic\.gov)?\/[^"]+\.pdf)"/i.exec(body)?.[1] ?? null;
  const headline = text.split('\n').map((l) => l.trim()).find((l) => /\$[\d.,]+\s*(?:Million|Billion|Thousand)?\b.*\bSale\b/i.test(l) && l.length < 120) ?? null;
  const advisor = advisorRaw && !/[@\d]/.test(advisorRaw) ? advisorRaw.trim() : null;
  return {
    saleId, slug, title, headline, eventDates: eventRange(eventText), location: field('where'),
    keyDates: parseKeyDates(body), receivershipClause: clause, receiverships: parseReceiverships(clause),
    loans: size ? Number(size[1].replace(/,/g, '')) : null, upb: size ? Number(size[2].replace(/,/g, '')) : null,
    portfolio: scrub(sentences.filter((s) => /portfolio consists|pools?\b|performing|% of (?:the )?(?:total )?UPB/i.test(s)).map((s) => s.trim()).slice(0, 12)),
    dataAsOf: isoFromWords(/loan data as of ([A-Za-z]+ \d{1,2}, \d{4})/i.exec(text)?.[1]),
    pageUpdatedOn: isoFromWords(/Last Updated:\s*([A-Za-z]+ \d{1,2}, \d{4})/i.exec(String(html).replace(/<[^>]+>/g, ' '))?.[1]),
    pdf: pdf ? new URL(pdf, FDIC_WWW).toString() : null, advisor,
  };
}

// ---- The announcement PDF ----------------------------------------------------------------------------------------------------------
// A small text reader for simple PDFs, with no dependency: FlateDecode content streams (Node's zlib), text-showing operators (Tj, TJ,
// ', "), literal strings in a single-byte encoding. Hex strings and composite (two-byte) fonts are not decoded; a PDF that only has
// those reads as unreadable, and is then recorded as a link only.
const WIN = { 0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—', 0x85: '…', 0x80: '€', 0x99: '™', 0xa0: ' ' };
const lit = (s) => s.replace(/\\(\r?\n|[nrtbf()\\]|[0-7]{1,3})/g, (_, e) => (/^\r?\n$/.test(e) ? '' : { n: '\n', r: '\r', t: '\t', b: '', f: '', '(': '(', ')': ')', '\\': '\\' }[e] ?? String.fromCharCode(parseInt(e, 8) & 0xff)));
const winAnsi = (s) => [...s].map((ch) => WIN[ch.charCodeAt(0)] ?? ch).join('');

export function pdfText(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes ?? []);
  const s = buf.toString('latin1');
  if (!s.startsWith('%PDF-')) return { text: '', readable: false, reason: 'not a PDF' };
  const lines = [];
  let streams = 0, textStreams = 0;
  const re = /<<((?:[^<>]|<(?!<)|>(?!>)|<<(?:[^<>]|<(?!<)|>(?!>))*>>)*)>>\s*stream\r?\n/g;
  let m;
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length;
    const end = s.indexOf('endstream', start);
    if (end < 0) break;
    re.lastIndex = end;
    streams++;
    let data;
    if (/\/FlateDecode/.test(m[1])) { try { data = inflateSync(buf.subarray(start, end)); } catch { continue; } }
    else if (!/\/Filter/.test(m[1])) data = buf.subarray(start, end);
    else continue;
    const t = data.toString('latin1');
    if (!/\bBT\b/.test(t)) continue;
    textStreams++;
    let line = '', lastY = null;
    const push = () => { if (line.trim()) lines.push(line); line = ''; };
    const tok = /\[((?:\\.|[^\]\\])*)\]\s*TJ|\(((?:\\.|[^\\)])*)\)\s*(?:Tj|'|")|(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+Tm|(-?[\d.]+)\s+(-?[\d.]+)\s+T[dD]|T\*|\bET\b/g;
    let k;
    while ((k = tok.exec(t))) {
      if (k[1] !== undefined) { for (const p of k[1].matchAll(/\(((?:\\.|[^\\)])*)\)|(-?[\d.]+)/g)) { if (p[1] !== undefined) line += lit(p[1]); else if (Number(p[2]) < -200) line += ' '; } }
      else if (k[2] !== undefined) line += lit(k[2]);
      else if (k[3] !== undefined) { const y = Number(k[8]); if (lastY !== null && Math.abs(y - lastY) > 2) push(); lastY = y; }
      else if (k[9] !== undefined) { if (Math.abs(Number(k[10])) > 0.5) push(); }
      else push();
    }
    push();
  }
  const text = winAnsi(lines.map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n'));
  const letters = (text.match(/[A-Za-z0-9 .,;:$%()&'’\-–/\n]/g) ?? []).length;
  const readable = text.length >= 40 && letters / text.length >= 0.9;
  return { text: readable ? text : '', readable, reason: readable ? null : textStreams ? 'text not in a single-byte encoding' : 'no text streams', streams, textStreams };
}

// What the announcement PDF adds: its date (the page has none), and a cross-check of the balance.
export function parseAnnouncementPdf(text) {
  const lines = String(text ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  const dateLine = lines.slice(0, 12).find((l) => /^[A-Za-z]+\s+\d{1,2},\s*\d{4}$/.test(l) && MONTHS.includes(l.split(/\s+/)[0].toLowerCase()));
  const joined = lines.join(' ');
  const size = /comprised of ([\d,]+) loans? having an unpaid principal balance(?: \(UPB\))? of \$([\d,]+(?:\.\d+)?)/i.exec(joined);
  return { announcedOn: dateLine ? isoFromWords(dateLine) : null, loans: size ? Number(size[1].replace(/,/g, '')) : null, upb: size ? Number(size[2].replace(/,/g, '')) : null };
}

// ---- Matching a receivership to our record of failed banks (sources/fdic/failed.json) ---------------------------------------------
const norm = (s) => String(s ?? '').toLowerCase().replace(/&/g, ' and ').replace(/\bn\.?\s?a\.?(?=\s|$)/g, ' ').replace(/\b(national association|the|inc|incorporated|corp|corporation)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
export function matchReceivership(r, failed = {}) {
  const all = Object.values(failed ?? {}).filter((f) => f?.cert);
  if (r.cert) { const f = all.find((x) => String(x.cert) === String(r.cert)); if (f) return { cert: String(f.cert), matchedBy: 'cert', record: f }; }
  const byName = all.filter((f) => norm(f.name) && norm(f.name) === norm(r.name));
  const narrowed = r.state ? byName.filter((f) => !f.state || f.state === r.state) : byName;
  const city = r.city ? narrowed.filter((f) => !f.city || norm(f.city) === norm(r.city)) : narrowed;
  const pool = city.length ? city : narrowed;
  if (pool.length === 1) return { cert: String(pool[0].cert), matchedBy: r.state ? 'name and state' : 'name', record: pool[0] };
  return { cert: null, matchedBy: null, ambiguous: pool.length > 1 ? pool.map((f) => String(f.cert)).sort() : undefined };
}

// ---- The run -----------------------------------------------------------------------------------------------------------------------
const REQUIRED = ['saleId', 'eventDates.start', 'receiverships'];
const missingOf = (p) => REQUIRED.filter((k) => (k === 'eventDates.start' ? !p.eventDates?.start && !p.keyDates?.bidDeadline : k === 'receiverships' ? !p.receiverships?.length : !p[k]));

export async function runFdicSales({ dir, fdic = {}, personalDomains = [], fetchImpl = globalThis.fetch, now = new Date(), clock = () => new Date(), sleep = realSleep, nowMs = () => Date.now() }) {
  const ua = fdicUserAgent(fdic, personalDomains);
  const run = startRun({ source: 'fdicsales', query: { listing: LISTING_PATH }, now });
  const fetchedAt = now.toISOString();
  const notes = [], missing = [];
  const counts = { requests: 0, listed: 0, pagesRead: 0, salesNew: 0, pdfsRead: 0, pdfsUnreadable: 0, pdfsKept: 0, robotsSkipped: 0, receiverships: 0, matched: 0 };
  let interval = Math.max(0, Number(fdic.minIntervalMs ?? 20000)), last = -Infinity;
  const pace = async () => { const wait = last + interval - nowMs(); if (wait > 0) await sleep(wait); last = nowMs(); };
  const opts = { fetchImpl, userAgent: ua, sleep, retries: 2, timeoutMs: 60000 };
  const text = async (path) => { await pace(); counts.requests++; return (await getText(new URL(path, FDIC_WWW).toString(), {}, { ...opts, maxBytes: 2_000_000 })).text; };
  const p = fdicSalesPaths(dir);
  try {
    // 1. robots.txt first. A missing file (404) allows everything; any other failure stops the run, since we would not know the rules.
    let robots = { rules: [], crawlDelay: null };
    try { robots = robotsFor(parseRobots(await text('/robots.txt')), ua); }
    catch (e) { if (!(e instanceof HttpError && e.status === 404)) throw e; notes.push('robots.txt: none (404), so every path is allowed'); }
    if (robots.crawlDelay !== null && robots.crawlDelay * 1000 > interval) interval = robots.crawlDelay * 1000;
    const allowed = (path) => { const ok = robotsAllows(robots, new URL(path, FDIC_WWW).pathname); if (!ok) counts.robotsSkipped++; return ok; };
    if (!allowed(LISTING_PATH)) throw new Error(`robots.txt disallows ${LISTING_PATH}; nothing was read.`);

    // 2. The list of current sales.
    const listing = parseListing(await text(LISTING_PATH));
    counts.pagesRead++;
    if (!listing.heading) {
      const line = finishRun(dir, run, { rowsRead: counts.pagesRead, outcome: 'failed', missingFields: ['listing: Loan Sales Event(s)'], errors: [`The loan-sales page (${LISTING_PATH}) has no "Loan Sales Event(s)" section: the page may have changed. Nothing was written.`], notes, now: clock() });
      return { runId: run.runId, outcome: line.outcome, ...counts, errors: line.errors };
    }
    const maxEvents = Number(fdic.maxEvents ?? 12);
    if (listing.events.length > maxEvents) notes.push(`${listing.events.length} sales listed; only the first ${maxEvents} were read (config.fdic.maxEvents)`);
    const events = listing.events.slice(0, maxEvents);
    counts.listed = listing.events.length;

    // 3. Each sale page, then its PDF when it is new or its link changed.
    const prev = readJson(p.sales, {});
    const failed = readJson(fdicPaths(dir).failed, {});
    const built = [];
    for (const ev of events) {
      if (!allowed(ev.path)) { notes.push(`robots.txt disallows ${ev.path}; skipped`); continue; }
      const url = new URL(ev.path, FDIC_WWW).toString();
      const page = parseSalePage(await text(ev.path), { url });
      counts.pagesRead++;
      const gaps = missingOf(page);
      if (gaps.length) { missing.push(...gaps.map((g) => `${ev.slug}: ${g}`)); continue; }
      const old = prev[page.saleId];
      let pdf = old?.pdf && old.pdf.link === page.pdf ? old.pdf : null;
      if (pdf) counts.pdfsKept++;
      const ownHost = page.pdf ? new URL(page.pdf).host === new URL(FDIC_WWW).host : false;
      if (!pdf && page.pdf && !ownHost) pdf = { link: page.pdf, readable: false, reason: 'not on www.fdic.gov, so not fetched', readAt: null };
      if (!pdf && page.pdf && allowed(page.pdf)) {
        try {
          await pace(); counts.requests++;
          const got = await getBytes(page.pdf, {}, { ...opts, maxBytes: Number(fdic.maxPdfBytes ?? 5_000_000) });
          const t = got.truncated ? { readable: false, reason: 'larger than config.fdic.maxPdfBytes' } : pdfText(got.bytes);
          if (t.readable) {
            const a = parseAnnouncementPdf(t.text);
            const differs = ['upb', 'loans'].filter((k) => a[k] !== null && page[k] !== null && a[k] !== page[k]);
            pdf = { link: page.pdf, readable: true, announcedOn: a.announcedOn, upb: a.upb, loans: a.loans, ...(differs.length ? { differsFromPage: differs } : {}), readAt: fetchedAt };
            counts.pdfsRead++;
            if (differs.length) notes.push(`${page.saleId}: the PDF and the page differ on ${differs.join(', ')}`);
          } else { pdf = { link: page.pdf, readable: false, reason: t.reason, readAt: fetchedAt }; counts.pdfsUnreadable++; }
        } catch (e) { pdf = { link: page.pdf, readable: false, reason: `not fetched: ${String(e.message).slice(0, 80)}`, readAt: null }; counts.pdfsUnreadable++; }
      } else if (!pdf && page.pdf) pdf = { link: page.pdf, readable: false, reason: 'robots.txt disallows it', readAt: null };
      const receiverships = page.receiverships.map((r) => {
        const mt = matchReceivership(r, failed);
        counts.receiverships++; if (mt.cert) counts.matched++;
        const f = mt.record;
        return { ...r, failedCert: mt.cert, key: mt.cert ? `fdic:${mt.cert}` : null, matchedBy: mt.matchedBy, ...(mt.ambiguous ? { ambiguous: mt.ambiguous } : {}),
          failedOn: f?.failedOn ?? null, inMetros: f ? !!f.inMetros : null, metros: f ? (f.metros ?? []).map((x) => x.cbsa) : [] };
      });
      const { receivershipClause, ...rest } = page;
      built.push({
        key: `fdic-sale:${page.saleId}`, ...rest, page: url, receiverships, pdf, announcedOn: pdf?.announcedOn ?? null,
        seller: SELLER.name, buyer: 'unknown', contextOnly: true,
        firstSeenAt: old?.firstSeenAt ?? fetchedAt, firstRunId: old?.firstRunId ?? run.runId,
        _source: sourceBlock({ source: 'fdicsales', endpoint: ev.path, query: { listing: LISTING_PATH }, recordId: page.saleId, period: page.eventDates.start ?? page.keyDates.bidDeadline, fetchedAt, runId: run.runId }),
      });
    }

    // 4. The field check, before anything is written: a sale page without its id, dates or receivership fails the run.
    if (missing.length) {
      const line = finishRun(dir, run, { rowsRead: counts.pagesRead, outcome: 'failed', missingFields: missing, errors: [`${missing.length} required field(s) could not be read from the FDIC sale pages: ${missing.slice(0, 10).join('; ')}. The page layout may have changed; nothing was written.`], notes, now: clock() });
      return { runId: run.runId, outcome: line.outcome, ...counts, missingFields: missing, errors: line.errors };
    }

    // 5. Merge: a sale is kept once seen, also after it leaves the list.
    let changed = 0;
    const next = { ...prev };
    for (const rec of built) {
      const u = upsertWithChanges(prev[rec.saleId], rec, { key: rec.key, runId: run.runId, dir, now });
      next[rec.saleId] = u.record; changed += u.changed;
      if (!prev[rec.saleId]) counts.salesNew++;
    }
    writeJson(p.sales, next);
    writeJson(p.state, { lastRun: run.runId, ranAt: fetchedAt, listed: listing.events.map((e) => e.slug), empty: listing.empty, crawlDelay: robots.crawlDelay, intervalMs: interval, counts });
    notes.push(`${counts.listed} sale(s) listed, ${counts.salesNew} new; ${counts.matched} of ${counts.receiverships} receivership(s) matched to the failed-bank record`);
    const line = finishRun(dir, run, { rowsRead: counts.pagesRead, rowsWritten: built.length, rowsChanged: changed, outcome: 'ok', notes, now: clock() });
    return { runId: run.runId, outcome: line.outcome, ...counts, sales: Object.keys(next).length, changed };
  } catch (e) {
    const line = finishRun(dir, run, { rowsRead: counts.pagesRead, outcome: 'failed', errors: [String(e.message).slice(0, 300)], notes, now: clock() });
    return { runId: run.runId, outcome: line.outcome, ...counts, errors: line.errors };
  }
}

// ---- Checking it against the source (read-only) ------------------------------------------------------------------------------------
const check = (id, ok, summary, detail) => ({ id, ok: !!ok, summary, ...(detail ? { detail } : {}) });
const CONTACT = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b|tel:|mailto:/;

export async function verifyFdicSales({ dir, fdic = {}, personalDomains = [], fetchImpl = globalThis.fetch, sleep = realSleep, now = new Date(), sample = 5, freshDays = 8 }) {
  const p = fdicSalesPaths(dir);
  const state = readJson(p.state, null), sales = readJson(p.sales, null);
  if (!state || !sales) return { source: 'fdicsales', checks: [check('fdicsales.present', false, 'No FDIC loan-sale data yet. Run: outbound sources run fdicsales')], sample: [] };
  const checks = [];
  const age = Math.floor((now.getTime() - Date.parse(state.ranAt)) / 86400000);
  checks.push(check('fdicsales.fresh', age <= freshDays, age <= freshDays ? `The last run was ${age} day(s) ago.` : `The last run was ${age} days ago (more than ${freshDays}). Run: outbound sources run fdicsales`));
  const recs = Object.values(sales);
  const bad = recs.filter((r) => !r.saleId || !String(r.page ?? '').startsWith(`${FDIC_WWW}/asset-sales/events/`) || !r._source || SOURCE_KEYS.some((k) => r._source[k] === undefined || r._source[k] === null || r._source[k] === '') || r.buyer !== 'unknown');
  const contacts = recs.filter((r) => CONTACT.test(JSON.stringify({ ...r, page: undefined, pdf: undefined, _source: undefined })));
  checks.push(check('fdicsales.sourced', !bad.length && !contacts.length, `${recs.length - bad.length} of ${recs.length} stored sales carry their id, sale page and source, with the buyer unknown.${contacts.length ? ` ${contacts.length} hold what looks like a phone number or email address: they must not.` : ' None holds a phone number or email address.'}`, bad.length || contacts.length ? { bad: bad.map((r) => r.saleId), contacts: contacts.map((r) => r.saleId) } : undefined));
  let ua;
  try { ua = fdicUserAgent(fdic, personalDomains); } catch (e) { checks.push(check('fdicsales.listed', false, `Skipped: ${e.message}`)); }
  if (ua) {
    let last = -Infinity; const interval = Math.max(Number(fdic.minIntervalMs ?? 20000), (state.crawlDelay ?? 0) * 1000);
    const pace = async () => { const wait = last + interval - Date.now(); if (wait > 0) await sleep(wait); last = Date.now(); };
    try {
      await pace();
      const robots = robotsFor(parseRobots((await getText(`${FDIC_WWW}/robots.txt`, {}, { fetchImpl, userAgent: ua, sleep })).text), ua);
      if (!robotsAllows(robots, LISTING_PATH)) checks.push(check('fdicsales.listed', false, `robots.txt now disallows ${LISTING_PATH}.`));
      else {
        await pace();
        const listing = parseListing((await getText(`${FDIC_WWW}${LISTING_PATH}`, {}, { fetchImpl, userAgent: ua, sleep })).text);
        const storedSlugs = new Set(recs.map((r) => r.slug));
        const notStored = listing.events.filter((e) => !storedSlugs.has(e.slug)).map((e) => e.slug);
        checks.push(check('fdicsales.listed', listing.heading && !notStored.length, !listing.heading ? 'The loan-sales page has no "Loan Sales Event(s)" section: it may have changed.' : notStored.length ? `${notStored.length} of ${listing.events.length} sales listed now are not stored. Run: outbound sources run fdicsales` : `All ${listing.events.length} sale(s) listed on the FDIC loan-sales page are stored.`, notStored.length ? { notStored } : undefined));
      }
    } catch (e) { checks.push(check('fdicsales.listed', false, `The FDIC loan-sales page could not be read: ${String(e.message).slice(0, 120)}`)); }
  }
  const rows = recs.sort((a, b) => String(b.eventDates?.start ?? '').localeCompare(String(a.eventDates?.start ?? ''))).slice(0, sample)
    .map((r) => ({ saleId: r.saleId, bidDeadline: r.keyDates?.bidDeadline ?? null, upb: r.upb, loans: r.loans, receiverships: (r.receiverships ?? []).map((x) => x.failedCert ? `fdic:${x.failedCert}` : 'unmatched'), check: r.page }));
  return { source: 'fdicsales', checks, sample: rows };
}
