// FDIC enforcement orders (PRD next-five E18-S2, source 2). The FDIC supervises most banks in our list (state nonmember banks), so this
// is the enforcement source that matters most. It RUNS ON A PRINCIPAL'S MACHINE, not in the platform worker: the order lists are on
// orders.fdic.gov, a Salesforce site that draws them in the browser, so a headless Chromium (Playwright) opens the public page and
// reads the table a person would see. Nothing calls the site's internal API.
//
// What was checked on 2026-11-16, from the development environment:
//   - Each month the FDIC publishes "FDIC Publishes <Month> Enforcement Actions" on www.fdic.gov (older ones: "FDIC Makes Public
//     <Month> Enforcement Actions"), usually on the last Friday of the next month. The year pages /news/press-releases/<year> list
//     them; www.fdic.gov's robots.txt allows /news/ and sets Crawl-delay: 1. The release gives counts only (no bank names) and links
//     https://orders.fdic.gov/s/press-release-orders?prYear=YYYY&prDate=D&prMonth=M, the orders that release published.
//   - orders.fdic.gov: robots.txt allows everything but a password page. Its server does not send its intermediate certificate
//     (DigiCert EV RSA CA G2), so Node's fetch and curl fail TLS verification unless given it; desktop browsers fetch it
//     themselves. That is one more reason the page is read in a browser. The orders' PDFs are not fetched (Node cannot verify the
//     host), so FDIC orders carry no phrase flags yet.
//   - NOT SEEN: the rendered page. The development environment's proxy cannot reach orders.fdic.gov from a browser, so the table's
//     columns are not known. The parser below maps columns by their header words and refuses to guess: a page it cannot map fails
//     the run, names the headers it found, and `--debug-capture FILE` writes the table's SHAPE (headers, and each cell with every
//     word outside a fixed vocabulary masked) for a developer to fix the mapping. The first run on a principal's machine is the spike.
//
// RULES, as for the Federal Reserve (src/sources/enforcement.mjs). An action against an individual is skipped while the table is
// parsed: a prohibition, removal, suspension or Section 19 action, or a row whose respondent is not an organization (its name has no
// organization word: bank, bancorp, trust, savings, financial, company, inc, ...). No person's name is stored or logged. Only type
// codes are stored, never the type text. The rendered page is held in memory only; the debug shape masks every word that is not an
// enforcement term, an organization word, a state or a month.
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { getText, realSleep, HttpError } from './http.mjs';
import { startRun, finishRun, sourceBlock, upsertWithChanges, SOURCE_KEYS } from './runlog.mjs';
import { parseRobots, robotsFor, robotsAllows, STATES } from './fdicsales.mjs';
import { readJson, writeJson } from '../store.mjs';
import { norm } from '../guard.mjs';
import { insideRepo } from '../paths.mjs';
import { enforcementPaths, TYPES } from './enforcement.mjs';

export const FDIC_WWW = 'https://www.fdic.gov';
export const ORDERS_HOST = 'orders.fdic.gov';
export const yearPage = (y) => `/news/press-releases/${y}`;

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const pad = (n) => String(n).padStart(2, '0');
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// ---- The press releases ----------------------------------------------------------------------------------------------------------
// The monthly enforcement releases a year page links, as paths, newest first by the page's order.
export function releaseLinks(html) {
  const seen = new Set();
  for (const m of String(html ?? '').matchAll(/href="(\/news\/press-releases\/\d{4}\/[a-z0-9-]*enforcement-actions[a-z0-9-]*)"/gi)) seen.add(m[1].toLowerCase());
  return [...seen];
}

// One release: the orders link, the release date (from the link's prYear, prMonth and prDate) and the month its orders were issued
// (from the slug's month name: the month before or in the release's year).
export function parseRelease(html, { path } = {}) {
  const href = /href="(https:\/\/orders\.fdic\.gov\/s\/press-release-orders\?[^"]+)"/i.exec(String(html ?? ''))?.[1]?.replace(/&amp;/g, '&') ?? null;
  if (!href) return { path, ordersUrl: null, releaseDate: null, ordersMonth: null };
  const u = new URL(href);
  const y = Number(u.searchParams.get('prYear')), m = Number(u.searchParams.get('prMonth')), d = Number(u.searchParams.get('prDate'));
  const releaseDate = y && m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${pad(m)}-${pad(d)}` : null;
  const word = MONTHS.find((x) => new RegExp(`-${x}-`).test(`-${String(path ?? '').split('/').pop()}-`));
  let ordersMonth = null;
  if (word && releaseDate) { const mi = MONTHS.indexOf(word) + 1; ordersMonth = `${mi > m ? y - 1 : y}-${pad(mi)}`; }
  return { path, ordersUrl: u.toString(), releaseDate, ordersMonth };
}
export const releaseKey = (r) => r.releaseDate;

// ---- The rendered table -------------------------------------------------------------------------------------------------------------
// A capture is what the browser read: { url, pages, tables: [{ headers: [string], rows: [{ cells: [string], links: [{ text, href }] }] }] }.
// The column a header means, by its words. Order matters: the first rule a header meets wins.
const COLUMN_RULES = [
  ['docket', /docket|order (no|number|#)|case (no|number)/i],
  ['respondent', /respondent|individual|party|parties/i],
  ['location', /location|city\s*(,|and|\/)\s*state/i],
  ['city', /^city$|\bcity\b/i],
  ['state', /^state$|^st$|\bstate\b/i],
  ['date', /date|issued|effective|signed/i],
  ['type', /type|action|order|document|description|title/i],
  ['institution', /institution|bank|name|entity|company|charter/i],
];
export function mapColumns(headers) {
  const map = {};
  (headers ?? []).forEach((h, i) => {
    const hit = COLUMN_RULES.find(([k, re]) => re.test(String(h ?? '')) && map[k] === undefined);
    if (hit) map[hit[0]] = i;
  });
  return map;
}
// The table to read: the one with the most rows among those that map a name (institution or respondent) and a type.
export function chooseTable(capture) {
  const ok = (capture?.tables ?? []).map((t) => ({ t, map: mapColumns(t.headers) })).filter(({ map }) => (map.institution !== undefined || map.respondent !== undefined) && map.type !== undefined);
  return ok.sort((a, b) => (b.t.rows?.length ?? 0) - (a.t.rows?.length ?? 0))[0] ?? null;
}

// Organization words. A respondent without one is a person, and the row is skipped.
export const ORG_WORDS = Object.freeze(['bank', 'banc', 'bancorp', 'bancorporation', 'bancshares', 'bankshares', 'banking', 'trust', 'savings', 'financial', 'finance', 'national',
  'association', 'company', 'co', 'corp', 'corporation', 'incorporated', 'inc', 'llc', 'ltd', 'lp', 'plc', 'fsb', 'ssb', 'sb', 'na', 'credit', 'federal', 'holding', 'holdings',
  'group', 'capital', 'industrial', 'thrift', 'cooperative', 'mutual', 'mhc']);
const ORG = new Set(ORG_WORDS);
// "N.A." and "Co." count: dots are dropped before the words are compared.
export const isOrganization = (name) => String(name ?? '').toLowerCase().replace(/\.(?=[a-z]\.)/g, '').replace(/[^a-z0-9]+/g, ' ').split(' ').some((w) => ORG.has(w));
const INDIVIDUAL = /prohibition|removal|suspension|section\s*19|institution[- ]affiliated|\biap\b|individual/i;
// Orders that say nothing about a bank's condition: deposit-insurance terminations (usually a bank merged away), waiver orders on
// brokered deposits, and Section 19 consents. Counted, not stored.
const NOT_DISTRESS = /termination of (deposit )?insurance|terminat\w* (of )?insured status|waiver/i;

export function classifyFdicType(text) {
  const t = String(text ?? '');
  const base = (x) => (/consent order/i.test(x) ? 'consent_order' : /cease and desist|cease-and-desist/i.test(x) ? 'cease_and_desist' : /written agreement/i.test(x) ? 'written_agreement'
    : /prompt corrective action|\bpca\b/i.test(x) ? 'pca_directive' : /civil money penalt/i.test(x) ? 'civil_money_penalty' : null);
  if (/terminat/i.test(t) && base(t)) return { type: 'termination', terminatesType: base(t) };
  if (/amend|modif/i.test(t)) return { type: 'modification', terminatesType: null };
  return { type: base(t) ?? 'other', terminatesType: null };
}

const stateOf = (s) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return /^[A-Z]{2}$/.test(t) ? t : STATES[t.toLowerCase()] ?? null; };
const MONTH_RE = new RegExp(`\\b(${MONTHS.join('|')})\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})\\b`, 'i');
export function parseDate(s) {
  const t = String(s ?? '').trim();
  let m;
  if ((m = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(t))) return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/.exec(t))) return `${m[3]}-${pad(m[1])}-${pad(m[2])}`;
  if ((m = MONTH_RE.exec(t))) return `${m[3]}-${pad(MONTHS.indexOf(m[1].toLowerCase()) + 1)}-${pad(m[2])}`;
  return null;
}
// "Example Bank, Sampleton, Texas" or "Sampleton, TX" -> pieces. A cell with only a name keeps city and state null.
function splitPlace(text) {
  const bits = String(text ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  const st = bits.length >= 2 ? stateOf(bits.at(-1)) : null;
  return st ? { rest: bits.slice(0, -1), state: st } : { rest: bits, state: null };
}

// Rows of a capture to orders. Pure. Returns { orders, rows, skippedIndividual, skippedNotDistress, skippedBlank, map, headers } or
// { error, headers } when no table can be mapped.
export function parseCapture(capture, { release, fetchedAt = null } = {}) {
  const chosen = chooseTable(capture);
  const headers = (capture?.tables ?? []).map((t) => t.headers ?? []);
  if (!chosen) return { error: 'no table with a name column and a type column', headers };
  const { t, map } = chosen;
  const cell = (row, k) => (map[k] === undefined ? '' : String(row.cells?.[map[k]] ?? '').replace(/\s+/g, ' ').trim());
  const out = { orders: [], rows: t.rows?.length ?? 0, skippedIndividual: 0, skippedNotDistress: 0, skippedBlank: 0, map, headers: t.headers };
  const seen = new Set();
  for (const row of t.rows ?? []) {
    const typeText = cell(row, 'type');
    const respondent = cell(row, 'respondent');
    let name = cell(row, 'institution');
    if (!name && !respondent) { out.skippedBlank++; continue; }
    // An individual: by the action, or by a respondent (or, with no institution column, a name) that is not an organization.
    if (INDIVIDUAL.test(typeText) || (respondent && !isOrganization(respondent)) || (!name && !isOrganization(respondent))) { out.skippedIndividual++; continue; }
    if (!name) name = respondent;
    if (!isOrganization(name)) { out.skippedIndividual++; continue; }
    if (NOT_DISTRESS.test(typeText)) { out.skippedNotDistress++; continue; }
    // The place: separate city and state columns, a location column, or "Name, City, State" in the name cell.
    let city = cell(row, 'city') || null, state = stateOf(cell(row, 'state'));
    if (map.location !== undefined && (!city || !state)) { const p = splitPlace(cell(row, 'location')); state = state ?? p.state; city = city ?? (p.rest.join(', ') || null); }
    const inName = splitPlace(name);
    if (inName.state && inName.rest.length >= 2) { state = state ?? inName.state; city = city ?? inName.rest.at(-1); name = inName.rest.slice(0, -1).join(', '); }
    const date = parseDate(cell(row, 'date'));
    const { type, terminatesType } = classifyFdicType(typeText);
    const docket = cell(row, 'docket') || null;
    const doc = (row.links ?? []).map((l) => l.href).find((h) => /^https:\/\/[^/]*fdic\.gov\//i.test(String(h ?? ''))) ?? null;
    const id = docket ? docket.replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-|-$/g, '') : createHash('sha256').update([release?.releaseDate, norm(name), state, type, date, doc].join('|')).digest('hex').slice(0, 16);
    const key = `fdicorder:${id}${type === 'termination' ? ':termination' : ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.orders.push({
      key, regulator: 'fdic', sourceId: docket ?? id, type, types: [type], ...(type === 'termination' ? { terminatesType, terminates: null } : {}),
      date: date ?? release?.releaseDate ?? null, dateBasis: date ? 'order' : 'release', terminatedOn: null,
      parties: [{ name, city, state }], link: doc ?? release?.ordersUrl ?? null, linkKind: doc ? 'order' : 'release list',
      kind: type === 'termination' ? 'termination' : 'order', release: release?.releaseDate ?? null, ordersMonth: release?.ordersMonth ?? null,
    });
  }
  return out;
}

// ---- The debug shape: headers and cells with every word outside a fixed vocabulary masked ----------------------------------------
const VOCAB = new Set([...MONTHS, ...Object.keys(STATES).flatMap((s) => s.split(' ')), ...Object.values(STATES).map((s) => s.toLowerCase()),
  'order', 'orders', 'consent', 'cease', 'desist', 'and', 'to', 'of', 'the', 'for', 'in', 'a', 'an', 'on', 'by', 'with', 'written', 'agreement', 'terminating', 'termination',
  'terminate', 'civil', 'money', 'penalty', 'penalties', 'pay', 'prompt', 'corrective', 'action', 'directive', 'supervisory', 'amended', 'amending', 'modification', 'modifying',
  'prohibition', 'removal', 'suspension', 'section', 'notice', 'charges', 'decision', 'adjudicated', 'dismissal', 'assessment', 'waiver', 'insurance', 'deposit', 'insured',
  'status', 'stipulation', 'consenting', 'issuance', 'pdf', 'view', 'download', 'docket', 'no', 'number', 'fdic', 'date', 'type', 'name', 'institution', 'respondent', 'city', 'state',
  ...ORG_WORDS]);
export const maskWord = (w) => (VOCAB.has(w.toLowerCase()) ? w : w.replace(/[A-Z]/g, 'A').replace(/[a-z]/g, 'a').replace(/[0-9]/g, '9'));
export const maskText = (s) => String(s ?? '').replace(/[A-Za-z0-9]+/g, maskWord);
export function captureShape(capture) {
  return { url: capture?.url ?? null, pages: capture?.pages ?? null, note: 'Headers as found; every cell word outside a fixed vocabulary of enforcement terms, organization words, states and months is masked (A, a, 9). No name can be read from it.',
    tables: (capture?.tables ?? []).map((t) => ({ headers: t.headers, map: mapColumns(t.headers), rows: t.rows?.length ?? 0, sample: (t.rows ?? []).slice(0, 15).map((r) => ({ cells: (r.cells ?? []).map(maskText), links: (r.links ?? []).map((l) => maskText(String(l.href ?? '').replace(/^https?:\/\/[^/]+/, ''))) })) })) };
}

// ---- The browser (Playwright, on a principal's machine) ---------------------------------------------------------------------------
export const SETUP = 'Playwright is needed on this machine: npm run fdic-orders:setup (installs the playwright package without saving it, and Chromium).';
export function loadPlaywright() {
  try { return createRequire(import.meta.url)('playwright'); } catch { throw new Error(SETUP); }
}

// Opens a page, waits for its table, reads every table (header and body cells, and each row's links), clicks "Next" while there is
// one, and returns the capture. Reads only what renders; sends nothing but the page's own requests. Runs in memory.
export async function browserSession({ playwright = loadPlaywright(), userAgent, timeoutMs = 60000, maxPages = 20, headless = true } = {}) {
  const browser = await playwright.chromium.launch({ headless });
  const context = await browser.newContext(userAgent ? { userAgent } : {});
  const page = await context.newPage();
  const readTables = () => page.locator('table').evaluateAll((tables) => tables.map((t) => {
    const text = (el) => (el.innerText ?? el.textContent ?? '').replace(/\s+/g, ' ').trim();
    const rows = [...t.rows];
    const headRow = t.tHead?.rows?.[0] ?? rows.find((r) => [...r.cells].some((c) => c.tagName === 'TH')) ?? null;
    const headers = headRow ? [...headRow.cells].map(text) : [];
    const body = rows.filter((r) => r !== headRow && !(t.tHead && t.tHead.contains(r)));
    return { headers, rows: body.map((r) => ({ cells: [...r.cells].map(text), links: [...r.getElementsByTagName('a')].map((a) => ({ text: text(a), href: a.href })) })) };
  }));
  return {
    async text(url) { const r = await page.goto(url, { timeout: timeoutMs }); return { status: r?.status() ?? 0, text: await page.evaluate(() => document.body?.innerText ?? '') }; },
    async capture(url) {
      const r = await page.goto(url, { waitUntil: 'networkidle', timeout: timeoutMs });
      if (r && r.status() >= 400) throw new Error(`HTTP ${r.status()} from ${new URL(url).host}`);
      await page.locator('table').first().waitFor({ timeout: timeoutMs }).catch(() => {});
      const tables = await readTables();
      let pages = 1;
      for (; pages < maxPages; pages++) {
        const next = page.getByRole('button', { name: /^next/i }).or(page.getByRole('link', { name: /^next/i })).first();
        if (!(await next.count()) || !(await next.isEnabled().catch(() => false)) || (await next.getAttribute('aria-disabled')) === 'true') break;
        const before = JSON.stringify(tables.map((x) => x.rows.slice(0, 2)));
        await next.click();
        await page.waitForLoadState('networkidle', { timeout: timeoutMs }).catch(() => {});
        await page.waitForTimeout(500);
        const more = await readTables();
        if (JSON.stringify(more.map((x) => x.rows.slice(0, 2))) === before) break;
        more.forEach((m, i) => { if (tables[i] && JSON.stringify(m.headers) === JSON.stringify(tables[i].headers)) tables[i].rows.push(...m.rows); else tables.push(m); });
      }
      return { url, pages, tables };
    },
    close: () => browser.close(),
  };
}

// ---- Rules ---------------------------------------------------------------------------------------------------------------------
export function validateFdicOrdersConfig(c) {
  const errors = [];
  const posInt = (v, k, max) => { if (!Number.isInteger(v) || v < 0 || v > max) errors.push(`enforcement.fdic.${k} must be a whole number from 0 to ${max}`); };
  if (!c || typeof c !== 'object') return ['config.enforcement.fdic is missing'];
  posInt(c.minIntervalMs, 'minIntervalMs', 600000); posInt(c.backfillMonths, 'backfillMonths', 120); posInt(c.maxReleasesPerRun, 'maxReleasesPerRun', 120);
  posInt(c.maxPages, 'maxPages', 200); posInt(c.timeoutMs, 'timeoutMs', 600000);
  return errors;
}
const placeholder = (v) => !String(v ?? '').trim() || /\[confirm/i.test(String(v));
const addMonths = (ymd, n) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); };

// A termination closes the latest stored order of the type it ends, for the same bank (normalized name and state), dated before it
// and not yet terminated. Returns the key it closed, or null.
export function linkTermination(term, orders) {
  const p = term.parties?.[0] ?? {};
  const same = Object.values(orders).filter((o) => o.kind === 'order' && o.type === term.terminatesType && !o.terminatedOn && (o.date ?? '') <= (term.date ?? '')
    && (o.parties ?? []).some((q) => norm(q.name) === norm(p.name) && (!q.state || !p.state || q.state === p.state)));
  return same.sort((a, b) => (a.date < b.date ? 1 : -1))[0]?.key ?? null;
}

// ---- The run -------------------------------------------------------------------------------------------------------------------
// 1. www.fdic.gov (Node, robots.txt and its Crawl-delay): the year pages back to backfillMonths, and each enforcement release on them
//    not read before. 2. The browser: orders.fdic.gov's robots.txt, then each release's order list not captured before, oldest first,
//    at most maxReleasesPerRun. A list that cannot be mapped fails the run and writes nothing; `debugCapture` (a path outside the
//    repository) then receives the masked shape. Releases are recorded once captured; a run with nothing new reads only the year pages.
export async function runFdicOrders({ dir, enforcement = {}, fetchImpl = globalThis.fetch, session, now = new Date(), clock = () => new Date(), sleep = realSleep, nowMs = () => Date.now(), debugCapture = null, since = null }) {
  const cfg = enforcement.fdic ?? {};
  const errs = validateFdicOrdersConfig(cfg);
  if (errs.length) throw new Error(`config.json: ${errs.join('; ')}`);
  if (debugCapture && insideRepo(debugCapture)) throw new Error('--debug-capture must be a path outside the repository.');
  const ua = placeholder(enforcement.userAgent) ? undefined : String(enforcement.userAgent).trim();
  const p = enforcementPaths(dir);
  const run = startRun({ source: 'fdicorders', query: { host: ORDERS_HOST, via: 'press releases' }, now });
  const fetchedAt = now.toISOString();
  const notes = [];
  const counts = { requests: 0, releasesListed: 0, releasesNew: 0, captured: 0, rows: 0, orders: 0, ordersNew: 0, terminations: 0, terminationsLinked: 0, skippedIndividual: 0, skippedNotDistress: 0, skippedBlank: 0, pages: 0 };
  let interval = Math.max(0, Number(cfg.minIntervalMs ?? 2000)), last = -Infinity;
  const pace = async () => { const wait = last + interval - nowMs(); if (wait > 0) await sleep(wait); last = nowMs(); };
  const www = async (path) => { await pace(); counts.requests++; return (await getText(new URL(path, FDIC_WWW).toString(), {}, { fetchImpl, userAgent: ua, sleep, retries: 2, maxBytes: 3_000_000 })).text; };
  const state = readJson(p.fdicState, { releases: {} });
  let own = null;
  try {
    // 1. The releases.
    let robots = { rules: [], crawlDelay: null };
    try { robots = robotsFor(parseRobots(await www('/robots.txt')), ua ?? ''); } catch (e) { if (!(e instanceof HttpError && e.status === 404)) throw e; }
    if (robots.crawlDelay !== null && robots.crawlDelay * 1000 > interval) interval = robots.crawlDelay * 1000;
    const from = since ?? addMonths(now.toISOString().slice(0, 10), -cfg.backfillMonths);
    const years = []; for (let y = Number(from.slice(0, 4)); y <= now.getUTCFullYear(); y++) years.push(y);
    const releases = { ...(state.releases ?? {}) };
    for (const y of years) {
      if (!robotsAllows(robots, yearPage(y))) throw new Error(`robots.txt on www.fdic.gov disallows ${yearPage(y)}; nothing was read.`);
      // A year with no release yet (early January) may have no page: a 404 there lists nothing.
      const page = await www(yearPage(y)).catch((e) => { if (e instanceof HttpError && e.status === 404 && y === now.getUTCFullYear()) return ''; throw e; });
      for (const path of releaseLinks(page)) {
        counts.releasesListed++;
        if (Object.values(releases).some((r) => r.path === path)) continue;
        const r = parseRelease(await www(path), { path });
        if (!r.releaseDate || !r.ordersUrl) { notes.push(`${path}: no orders link found; skipped`); continue; }
        releases[releaseKey(r)] = { ...r, foundAt: fetchedAt, capturedAt: null };
        counts.releasesNew++;
      }
    }
    const todo = Object.values(releases).filter((r) => !r.capturedAt && r.releaseDate >= from).sort((a, b) => (a.releaseDate < b.releaseDate ? -1 : 1));
    const batch = todo.slice(0, cfg.maxReleasesPerRun);
    if (todo.length > batch.length) notes.push(`${todo.length - batch.length} release(s) left for the next run (config.enforcement.fdic.maxReleasesPerRun)`);

    // 2. The order lists, in the browser.
    const prev = readJson(p.fdicOrders, {});
    const next = { ...prev };
    let changed = 0;
    if (batch.length) {
      own = session ? null : await browserSession({ userAgent: ua, timeoutMs: cfg.timeoutMs, maxPages: cfg.maxPages });
      const s = session ?? own;
      const rb = await s.text(`https://${ORDERS_HOST}/robots.txt`).catch(() => ({ status: 0, text: '' }));
      const ordersRobots = rb.status === 200 ? robotsFor(parseRobots(rb.text), ua ?? '') : { rules: [] };
      for (const rel of batch) {
        if (!robotsAllows(ordersRobots, new URL(rel.ordersUrl).pathname)) throw new Error(`robots.txt on ${ORDERS_HOST} disallows ${new URL(rel.ordersUrl).pathname}; nothing was written.`);
        await pace();
        const cap = await s.capture(rel.ordersUrl);
        counts.pages += cap.pages ?? 1;
        const parsed = parseCapture(cap, { release: rel, fetchedAt });
        if (parsed.error || !parsed.rows) {
          if (debugCapture) writeFileSync(debugCapture, `${JSON.stringify(captureShape(cap), null, 2)}\n`);
          const what = parsed.error ?? 'the table has no rows';
          const line = finishRun(dir, run, { rowsRead: counts.rows, outcome: 'failed', missingFields: ['orders table'], errors: [`${rel.releaseDate}: ${what}. Tables found: ${parsed.headers.length}; headers: ${JSON.stringify(parsed.headers).slice(0, 400)}. Nothing was written.${debugCapture ? ` The masked shape is in ${debugCapture}.` : ' Run again with --debug-capture FILE (outside the repository) for the masked shape.'}`], notes, now: clock() });
          return { runId: run.runId, outcome: line.outcome, ...counts, errors: line.errors };
        }
        counts.captured++; counts.rows += parsed.rows;
        for (const k of ['skippedIndividual', 'skippedNotDistress', 'skippedBlank']) counts[k] += parsed[k];
        for (const o of parsed.orders) {
          const old = next[o.key];
          const rec = { ...o, contextOnly: true, firstSeenAt: old?.firstSeenAt ?? fetchedAt, firstRunId: old?.firstRunId ?? run.runId,
            _source: sourceBlock({ source: 'fdicorders', endpoint: rel.ordersUrl, query: { release: rel.releaseDate, page: rel.path }, recordId: o.sourceId, period: o.date ?? rel.releaseDate, fetchedAt, runId: run.runId }) };
          if (rec.kind === 'termination') {
            const ended = old?.terminates ?? linkTermination(rec, next);
            rec.terminates = ended;
            if (ended && next[ended] && !next[ended].terminatedOn) { const u = upsertWithChanges(next[ended], { ...next[ended], terminatedOn: rec.date }, { key: ended, runId: run.runId, dir, now }); next[ended] = u.record; changed += u.changed; counts.terminationsLinked++; }
          }
          const u = upsertWithChanges(old, rec, { key: rec.key, runId: run.runId, dir, now });
          next[rec.key] = u.record; changed += u.changed;
          if (!old) counts.ordersNew++;
        }
        releases[releaseKey(rel)] = { ...rel, capturedAt: fetchedAt, rows: parsed.rows, kept: parsed.orders.length, skippedIndividual: parsed.skippedIndividual, map: parsed.map };
        if (debugCapture) writeFileSync(debugCapture, `${JSON.stringify(captureShape(cap), null, 2)}\n`);
      }
    }
    counts.orders = Object.values(next).filter((r) => r.kind === 'order').length;
    counts.terminations = Object.values(next).filter((r) => r.kind === 'termination').length;
    writeJson(p.fdicOrders, next);
    writeJson(p.fdicState, { lastRun: run.runId, ranAt: fetchedAt, from, releases, counts });
    notes.push(`${counts.captured} release list(s) read: ${counts.rows} rows, ${counts.ordersNew} new order record(s); ${counts.skippedIndividual} against individuals and ${counts.skippedNotDistress} not about condition skipped`);
    const suspect = counts.captured > 0 && counts.rows > 0 && counts.ordersNew === 0 && counts.skippedIndividual === counts.rows;
    if (suspect) notes.push('every row read was skipped as an individual: the name column may be mapped wrong. Run with --debug-capture FILE');
    // rowsRead is the releases the year pages list: a run with no new release still reads them, and a 0 there means the pages changed.
    const line = finishRun(dir, run, { rowsRead: counts.releasesListed, rowsWritten: counts.ordersNew, rowsChanged: changed, outcome: 'ok', suspect, notes, now: clock() });
    return { runId: run.runId, outcome: line.outcome, ...counts, changed };
  } catch (e) {
    const msg = String(e.message);
    const line = finishRun(dir, run, { rowsRead: counts.rows, outcome: 'failed', errors: [msg.slice(0, 300)], notes, now: clock() });
    return { runId: run.runId, outcome: line.outcome, ...counts, errors: line.errors };
  } finally {
    if (own) await own.close().catch(() => {});
  }
}

// ---- Checking it (read-only) ------------------------------------------------------------------------------------------------------
// No browser: fresh; sourced and person-free; and every release listed on www.fdic.gov in the window captured.
const check = (id, ok, summary, detail) => ({ id, ok: !!ok, summary, ...(detail ? { detail } : {}) });
export async function verifyFdicOrders({ dir, enforcement = {}, fetchImpl = globalThis.fetch, sleep = realSleep, now = new Date(), sample = 5, freshDays = 40 }) {
  const p = enforcementPaths(dir);
  const state = readJson(p.fdicState, null), orders = readJson(p.fdicOrders, null);
  if (!state || !orders) return { source: 'fdicorders', checks: [check('fdicorders.present', false, 'No FDIC orders yet. Run on a principal\'s machine: outbound sources run fdicorders')], sample: [] };
  const checks = [];
  const age = Math.floor((now.getTime() - Date.parse(state.ranAt)) / 86400000);
  checks.push(check('fdicorders.fresh', age <= freshDays, age <= freshDays ? `The last run was ${age} day(s) ago.` : `The last run was ${age} days ago (more than ${freshDays}). Run on a principal's machine: outbound sources run fdicorders`));
  const recs = Object.values(orders);
  const bad = recs.filter((r) => !r?._source || SOURCE_KEYS.some((k) => r._source[k] === undefined || r._source[k] === null || r._source[k] === '') || r.regulator !== 'fdic' || !String(r.key).startsWith('fdicorder:') || !TYPES[r.type] || !DATE.test(String(r.date)));
  const people = recs.filter((r) => (r.parties ?? []).some((x) => !isOrganization(x.name)));
  checks.push(check('fdicorders.sourced', !bad.length && !people.length, `${recs.length - bad.length} of ${recs.length} stored records carry their source, a type code and a date.${people.length ? ` ${people.length} name a party with no organization word: it may be a person, and must not be stored.` : ' Every party is an organization.'}`, bad.length || people.length ? { bad: bad.slice(0, 10).map((r) => r?.key), people: people.slice(0, 10).map((r) => r.key) } : undefined));
  try {
    const ua = placeholder(enforcement.userAgent) ? undefined : String(enforcement.userAgent).trim();
    const listed = [];
    for (let y = Number(state.from.slice(0, 4)); y <= now.getUTCFullYear(); y++) {
      await sleep(Math.max(1000, enforcement.fdic?.minIntervalMs ?? 2000));
      const page = await getText(`${FDIC_WWW}${yearPage(y)}`, {}, { fetchImpl, userAgent: ua, sleep, maxBytes: 3_000_000 }).then((r) => r.text)
        .catch((e) => { if (e instanceof HttpError && e.status === 404 && y === now.getUTCFullYear()) return ''; throw e; });
      listed.push(...releaseLinks(page));
    }
    const known = new Map(Object.values(state.releases ?? {}).map((r) => [r.path, r]));
    const missing = listed.filter((x) => !known.has(x));
    const uncaptured = [...known.values()].filter((r) => r.releaseDate >= state.from && !r.capturedAt).map((r) => r.releaseDate);
    checks.push(check('fdicorders.complete', !missing.length && !uncaptured.length, !missing.length && !uncaptured.length ? `All ${listed.length} enforcement release(s) on www.fdic.gov since ${state.from} were read and their order lists captured.` : `${missing.length} release(s) on www.fdic.gov not recorded; ${uncaptured.length} recorded but not captured. Run: outbound sources run fdicorders`, missing.length || uncaptured.length ? { missing: missing.slice(0, 10), uncaptured: uncaptured.slice(0, 10) } : undefined));
  } catch (e) { checks.push(check('fdicorders.complete', false, `www.fdic.gov could not be read: ${String(e.message).slice(0, 120)}`)); }
  const rows = recs.filter((r) => r.kind === 'order').sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, sample).map((r) => ({ key: r.key, type: r.type, date: r.date, release: r.release, check: r.link }));
  return { source: 'fdicorders', checks, sample: rows };
}
