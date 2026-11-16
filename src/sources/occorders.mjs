// OCC enforcement orders (PRD next-five E18-S2, source 4): national banks and federal savings associations. No API key: the adapter
// reads the OCC's monthly news release "OCC Announces Enforcement Actions for <Month> <Year>", a plain page on www.occ.gov.
//
// Checked live on 2026-11-16:
//   - api.occ.gov/EnforcementActions/list answers 403 API_KEY_MISSING without the free key (D-E2, Q21), and apps.occ.gov/EASearch is a
//     script form. The monthly release needs neither: www.occ.gov's robots.txt allows /news-issuances/ and /static/enforcement-actions/.
//   - Releases are numbered in sequence within a year, /news-issuances/news-releases/<year>/nr-occ-<year>-<n>.html, with gaps (a
//     missing number answers 404; the longest run of 404s in 2026's first 100 was 2). The RSS feed (/rss/occ_news.xml) keeps only 10
//     items, so the adapter walks the numbers: from the last number seen, until maxMisses 404s in a row. Ten of 2026's first 93
//     releases were the monthly enforcement release.
//   - The release has up to three sections, each opened by a fixed paragraph: "Actions taken against banks are:" (kept), the actions
//     against institution-affiliated parties (individuals: SKIPPED, nothing of them is kept) and "The OCC terminates enforcement
//     actions when ..." (kept). A bank entry reads "<Type> against <Bank>, <City>, <State>, for <reason> ... (Docket No. AA-...)"; a
//     termination reads "Order Terminating the <Type> (against|with) <Bank>, <City>, <State>, dated <Month D, YYYY> (Docket No. <the
//     order's>). (Docket No. <its own>)", sometimes without the words "Docket No.".
//   - Each docket's order is a PDF at /static/enforcement-actions/ea<docket>.pdf. Read one (2026-11-16): its fonts are not single-byte,
//     so the PDF reader in fdicsales.mjs cannot read it. OCC orders carry no phrase flags; the order is linked.
//   - The release gives no date per action; a new action is dated by the release (dateBasis 'release'). A termination gives the date
//     of the order it ends.
//
// RULES, as for the other enforcement sources: no individual's action and no reason text is stored; type codes only; every party has an
// organization word. Records go to sources/enforcement/occ-orders.json, keyed occ:<docket>, and feed the same signals, review list and
// coverage line (src/sources/enforcement.mjs loadAllOrders).
import { getText, realSleep, HttpError } from './http.mjs';
import { startRun, finishRun, sourceBlock, upsertWithChanges, SOURCE_KEYS } from './runlog.mjs';
import { parseRobots, robotsFor, robotsAllows, STATES } from './fdicsales.mjs';
import { isOrganization } from './fdicorders.mjs';
import { enforcementPaths, classifyType, TYPES } from './enforcement.mjs';
import { readJson, writeJson } from '../store.mjs';

export const OCC_WWW = 'https://www.occ.gov';
export const releasePath = (y, n) => `/news-issuances/news-releases/${y}/nr-occ-${y}-${n}.html`;
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const pad = (n) => String(n).padStart(2, '0');
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', ndash: '–', mdash: '—' };
const decode = (s) => String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e.toLowerCase()] ?? m));
export function parseDate(s) {
  const m = new RegExp(`\\b(${MONTHS.join('|')})\\s+(\\d{1,2}),?\\s+(\\d{4})\\b`, 'i').exec(String(s ?? ''));
  return m ? `${m[3]}-${pad(MONTHS.indexOf(m[1].toLowerCase()) + 1)}-${pad(m[2])}` : null;
}
const STATE_ALT = [...Object.keys(STATES).sort((a, b) => b.length - a.length).map((s) => s.split(' ').map((w) => (w === 'of' ? w : w[0].toUpperCase() + w.slice(1))).join('\\s+')), ...Object.values(STATES)].join('|');
const stateOf = (s) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return /^[A-Z]{2}$/.test(t) ? t : STATES[t.toLowerCase()] ?? null; };

// ---- One release -------------------------------------------------------------------------------------------------------------------
// { title, enforcement: bool, month: 'YYYY-MM' | null, released: 'YYYY-MM-DD' | null, lines: [string], links: [href] }
export function readRelease(html) {
  const s = String(html ?? '');
  const title = decode(/<title>([^<|]*)/i.exec(s)?.[1] ?? '').trim();
  const m = /Enforcement Actions for ([A-Za-z]+)\s+(\d{4})/i.exec(title);
  const main = s.slice(Math.max(0, s.search(/<main\b/i)));
  const lines = decode(main.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<\/(p|div|li|h\d|tr)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' '))
    .split('\n').map((l) => l.replace(/\s+/g, ' ').replace(/\s+([,.)])/g, '$1').replace(/\(\s+/g, '(').trim()).filter(Boolean);
  const titleAt = lines.findIndex((l) => /Enforcement Actions for/i.test(l));
  const released = parseDate(lines.slice(Math.max(0, titleAt - 3), titleAt + 3).join(' ')) ?? parseDate(lines.slice(0, 30).join(' '));
  return { title, enforcement: !!m && MONTHS.includes(m[1].toLowerCase()), month: m && MONTHS.includes(m[1].toLowerCase()) ? `${m[2]}-${pad(MONTHS.indexOf(m[1].toLowerCase()) + 1)}` : null,
    released, lines, links: [...s.matchAll(/href="([^"]*\/static\/enforcement-actions\/[^"]+\.pdf)"/gi)].map((x) => new URL(x[1], OCC_WWW).toString()) };
}

// Docket numbers, wherever the parentheses put them: "(Docket No. X)", "( X )", "(Docket No. X.)", "(Docket No. X and Y)".
const DOCKET = /\bAA-[A-Z]{2,4}-\d{4}-\d+\b/gi;
const ENTRY = new RegExp(`^(.+?)\\s+(?:against|with)\\s+(.+?),\\s*([^,]+?),\\s*(${STATE_ALT})\\b`);
// OCC's "Formal Agreement" is a formal written agreement; the rest is the shared classifier.
const occType = (t) => (/formal agreement/i.test(t) && !/cease|consent|penalt/i.test(t) ? { type: 'written_agreement', types: ['written_agreement'] } : classifyType(t));

// The bank actions and terminations of a release, as order records. Pure. Individuals' actions are never returned.
export function parseRelease(rel, { path } = {}) {
  const out = { orders: [], skippedIndividual: 0, unparsed: 0 };
  let section = null;
  const pdf = (d) => rel.links.find((l) => l.endsWith(`/ea${d}.pdf`)) ?? null;
  for (const line of rel.lines) {
    if (/Actions taken against banks are:/i.test(line)) { section = 'banks'; continue; }
    if (/institution-affiliated part(?:y|ies)|\bIAPs?\b/.test(line) && !/Docket/i.test(line)) { section = 'individuals'; continue; }
    if (/The OCC terminates enforcement actions/i.test(line)) { section = 'terminations'; continue; }
    if (/^To receive alerts|^All OCC public enforcement actions/i.test(line)) { section = null; continue; }
    const dockets = [...line.matchAll(DOCKET)].map((m) => m[0].toUpperCase());
    if (!section || !dockets.length) continue;
    if (section === 'individuals') { out.skippedIndividual++; continue; }
    const m = ENTRY.exec(line);
    const name = m?.[2]?.trim();
    if (!m || !isOrganization(name)) { out.unparsed++; continue; }
    const party = { name, city: m[3].trim(), state: stateOf(m[4]) };
    const own = dockets.at(-1);
    if (section === 'terminations' || /^Order Terminating/i.test(m[1])) {
      const ended = /^Order Terminating (?:the )?(.+)$/i.exec(m[1])?.[1] ?? m[1];
      // "Order Terminating the Amended Consent Order": what ends is the consent order, not a modification.
      const t = occType(ended.replace(/\b(?:amended|amendment to(?: the)?)\s+/i, ''));
      const ends = dockets.length > 1 ? dockets[0] : null;
      out.orders.push({ key: `occ:${own}:termination`, regulator: 'occ', sourceId: own, type: 'termination', types: ['termination'], terminates: ends ? `occ:${ends}` : null, terminatesType: t.type,
        terminatesDated: parseDate(line), date: rel.released, dateBasis: 'release', terminatedOn: null, parties: [party], link: pdf(own) ?? (path ? new URL(path, OCC_WWW).toString() : null), linkKind: pdf(own) ? 'order' : 'release', kind: 'termination', month: rel.month });
      continue;
    }
    const t = occType(m[1]);
    out.orders.push({ key: `occ:${dockets[0]}`, regulator: 'occ', sourceId: dockets[0], type: t.type, types: t.types, dockets, date: rel.released, dateBasis: 'release', terminatedOn: null, parties: [party],
      link: pdf(dockets[0]) ?? (path ? new URL(path, OCC_WWW).toString() : null), linkKind: pdf(dockets[0]) ? 'order' : 'release', kind: 'order', month: rel.month });
  }
  return out;
}

// ---- Rules ---------------------------------------------------------------------------------------------------------------------
export function validateOccConfig(c) {
  const errors = [];
  if (!c || typeof c !== 'object') return ['config.enforcement.occ is missing'];
  const posInt = (v, k, max) => { if (!Number.isInteger(v) || v < 0 || v > max) errors.push(`enforcement.occ.${k} must be a whole number from 0 to ${max}`); };
  posInt(c.minIntervalMs, 'minIntervalMs', 600000); posInt(c.backfillYears, 'backfillYears', 20); posInt(c.maxMisses, 'maxMisses', 100); posInt(c.maxRequestsPerRun, 'maxRequestsPerRun', 5000);
  return errors;
}
const placeholder = (v) => !String(v ?? '').trim() || /\[confirm/i.test(String(v));

// ---- The run -------------------------------------------------------------------------------------------------------------------
// For each year from (this year - backfillYears) to this year: release numbers from the one after the last seen, until maxMisses 404s
// in a row. Enforcement releases are parsed; the rest are passed over. A release that says "Enforcement Actions for" but yields
// neither an action, a termination nor a skipped individual fails the run (the layout changed) and nothing is written.
export async function runOccOrders({ dir, enforcement = {}, fetchImpl = globalThis.fetch, now = new Date(), clock = () => new Date(), sleep = realSleep, nowMs = () => Date.now() }) {
  const cfg = enforcement.occ ?? {};
  const errs = validateOccConfig(cfg);
  if (errs.length) throw new Error(`config.json: ${errs.join('; ')}`);
  const ua = placeholder(enforcement.userAgent) ? undefined : String(enforcement.userAgent).trim();
  const p = enforcementPaths(dir);
  const run = startRun({ source: 'occorders', query: { host: 'www.occ.gov', via: 'monthly news releases' }, now });
  const fetchedAt = now.toISOString();
  const notes = [];
  const counts = { requests: 0, releasesRead: 0, enforcementReleases: 0, orders: 0, ordersNew: 0, terminations: 0, terminationsNew: 0, terminationsLinked: 0, skippedIndividual: 0, unparsed: 0 };
  const interval = Math.max(0, Number(cfg.minIntervalMs ?? 1000));
  let last = -Infinity;
  const pace = async () => { const wait = last + interval - nowMs(); if (wait > 0) await sleep(wait); last = nowMs(); };
  const get = async (path) => { await pace(); counts.requests++; return (await getText(new URL(path, OCC_WWW).toString(), {}, { fetchImpl, userAgent: ua, sleep, retries: 2, maxBytes: 3_000_000 })).text; };
  const state = readJson(p.occState, { years: {} });
  try {
    let robots = { rules: [], crawlDelay: null };
    try { robots = robotsFor(parseRobots(await get('/robots.txt')), ua ?? ''); } catch (e) { if (!(e instanceof HttpError && e.status === 404)) throw e; }
    const thisYear = now.getUTCFullYear();
    const years = state.years ?? {};
    const prev = readJson(p.occOrders, {});
    const next = { ...prev };
    const built = [];
    for (let y = thisYear - cfg.backfillYears; y <= thisYear; y++) {
      const ys = { last: 0, ...(years[y] ?? {}) };
      if (ys.closed) continue;   // a past year read to its end is not read again
      let n = ys.last, misses = 0;
      while (misses < cfg.maxMisses) {
        if (counts.requests >= cfg.maxRequestsPerRun) { notes.push(`stopped at ${y} release ${n} (config.enforcement.occ.maxRequestsPerRun); the next run continues`); break; }
        n++;
        const path = releasePath(y, n);
        if (!robotsAllows(robots, path)) throw new Error(`robots.txt on www.occ.gov disallows ${path}; nothing was written.`);
        let html;
        try { html = await get(path); } catch (e) { if (e instanceof HttpError && e.status === 404) { misses++; continue; } throw e; }
        misses = 0; ys.last = n; counts.releasesRead++;
        const rel = readRelease(html);
        if (!rel.enforcement) continue;
        counts.enforcementReleases++;
        const parsed = parseRelease(rel, { path });
        counts.skippedIndividual += parsed.skippedIndividual; counts.unparsed += parsed.unparsed;
        if (!parsed.orders.length && !parsed.skippedIndividual) {
          const line = finishRun(dir, run, { rowsRead: counts.releasesRead, outcome: 'failed', missingFields: [`${path}: actions`], errors: [`${path} ("${rel.title}") yielded no action against a bank, no termination and no action against an individual: the release's layout may have changed. Nothing was written.`], notes, now: clock() });
          return { runId: run.runId, outcome: line.outcome, ...counts, errors: line.errors };
        }
        if (!rel.released) notes.push(`${path}: no release date found; its actions are dated by the month (${rel.month})`);
        for (const o of parsed.orders) built.push({ ...o, date: o.date ?? `${rel.month}-01`, release: path, _path: path });
      }
      if (y < thisYear && misses >= cfg.maxMisses) ys.closed = true;
      years[y] = ys;
    }
    if (counts.unparsed) notes.push(`${counts.unparsed} entr(y/ies) in the bank or termination sections could not be read as "<type> against <bank>, <city>, <state>"; not stored`);

    let changed = 0;
    for (const { _path, ...o } of built) {
      const old = next[o.key];
      const rec = { ...o, contextOnly: true, firstSeenAt: old?.firstSeenAt ?? fetchedAt, firstRunId: old?.firstRunId ?? run.runId,
        _source: sourceBlock({ source: 'occorders', endpoint: new URL(_path, OCC_WWW).toString(), query: { release: _path }, recordId: o.sourceId, period: o.date, fetchedAt, runId: run.runId }) };
      const u = upsertWithChanges(old, rec, { key: o.key, runId: run.runId, dir, now });
      next[o.key] = u.record; changed += u.changed;
      if (!old) counts[o.kind === 'termination' ? 'terminationsNew' : 'ordersNew']++;
    }
    // A termination closes the order it names, when that order is stored.
    for (const t of Object.values(next).filter((r) => r.kind === 'termination' && r.terminates)) {
      const o = next[t.terminates];
      if (o && o.terminatedOn !== t.date) { const u = upsertWithChanges(o, { ...o, terminatedOn: t.date }, { key: o.key, runId: run.runId, dir, now }); next[o.key] = u.record; changed += u.changed; counts.terminationsLinked++; }
    }
    counts.orders = Object.values(next).filter((r) => r.kind === 'order').length;
    counts.terminations = Object.values(next).filter((r) => r.kind === 'termination').length;
    writeJson(p.occOrders, next);
    writeJson(p.occState, { lastRun: run.runId, ranAt: fetchedAt, years, counts });
    notes.push(`${counts.releasesRead} release(s) read, ${counts.enforcementReleases} monthly enforcement release(s): ${counts.ordersNew} new action(s) against banks, ${counts.terminationsNew} new termination(s); ${counts.skippedIndividual} action(s) against individuals skipped`);
    const line = finishRun(dir, run, { rowsRead: counts.releasesRead + Object.keys(prev).length, rowsWritten: counts.ordersNew + counts.terminationsNew, rowsChanged: changed, outcome: 'ok', notes, now: clock() });
    return { runId: run.runId, outcome: line.outcome, ...counts, changed };
  } catch (e) {
    const line = finishRun(dir, run, { rowsRead: counts.releasesRead, outcome: 'failed', errors: [String(e.message).slice(0, 300)], notes, now: clock() });
    return { runId: run.runId, outcome: line.outcome, ...counts, errors: line.errors };
  }
}

// ---- Checking it (read-only) ---------------------------------------------------------------------------------------------------------
const check = (id, ok, summary, detail) => ({ id, ok: !!ok, summary, ...(detail ? { detail } : {}) });
const KEYS = new Set(['key', 'regulator', 'sourceId', 'type', 'types', 'dockets', 'terminates', 'terminatesType', 'terminatesDated', 'date', 'dateBasis', 'terminatedOn', 'parties', 'link', 'linkKind', 'kind', 'month', 'release', 'contextOnly', 'firstSeenAt', 'firstRunId', '_source']);
export async function verifyOccOrders({ dir, enforcement = {}, fetchImpl = globalThis.fetch, sleep = realSleep, now = new Date(), sample = 5, freshDays = 40 }) {
  const p = enforcementPaths(dir);
  const state = readJson(p.occState, null), orders = readJson(p.occOrders, null);
  if (!state || !orders) return { source: 'occorders', checks: [check('occorders.present', false, 'No OCC orders yet. Run: outbound sources run occorders')], sample: [] };
  const checks = [];
  const age = Math.floor((now.getTime() - Date.parse(state.ranAt)) / 86400000);
  checks.push(check('occorders.fresh', age <= freshDays, age <= freshDays ? `The last run was ${age} day(s) ago.` : `The last run was ${age} days ago (more than ${freshDays}). Run: outbound sources run occorders`));
  const recs = Object.values(orders);
  const bad = recs.filter((r) => !r?._source || SOURCE_KEYS.some((k) => r._source[k] === undefined || r._source[k] === null || r._source[k] === '') || r.regulator !== 'occ' || !TYPES[r.type] || !DATE.test(String(r.date)) || Object.keys(r).some((k) => !KEYS.has(k)));
  const people = recs.filter((r) => (r.parties ?? []).some((x) => !isOrganization(x.name)));
  checks.push(check('occorders.sourced', !bad.length && !people.length, `${recs.length - bad.length} of ${recs.length} stored records carry their source, a type code and a date, and no reason text.${people.length ? ` ${people.length} name a party with no organization word: it may be a person, and must not be stored.` : ' Every party is an organization.'}`, bad.length || people.length ? { bad: bad.slice(0, 10).map((r) => r?.key), people: people.slice(0, 10).map((r) => r.key) } : undefined));
  // Recall: the latest enforcement release stored, read again; every record from it must come back.
  const latest = recs.map((r) => r.release).filter(Boolean).sort((a, b) => { const k = (x) => x.match(/(\d{4})-(\d+)\.html$/).slice(1).map(Number); const [ay, an] = k(a), [by, bn] = k(b); return ay - by || an - bn; }).at(-1);
  if (latest) {
    try {
      await sleep(Math.max(0, enforcement.occ?.minIntervalMs ?? 1000));
      const ua = placeholder(enforcement.userAgent) ? undefined : String(enforcement.userAgent).trim();
      const live = new Set(parseRelease(readRelease((await getText(`${OCC_WWW}${latest}`, {}, { fetchImpl, userAgent: ua, sleep, maxBytes: 3_000_000 })).text), { path: latest }).orders.map((o) => o.key));
      const expected = recs.filter((r) => r.release === latest).map((r) => r.key);
      const lost = expected.filter((k) => !live.has(k));
      checks.push(check('occorders.recall', !lost.length, !lost.length ? `${latest} read again: all ${expected.length} record(s) stored from it came back.` : `${latest}: ${lost.length} stored record(s) not found again.`, lost.length ? { lost } : undefined));
    } catch (e) { checks.push(check('occorders.recall', false, `www.occ.gov could not be read: ${String(e.message).slice(0, 120)}`)); }
  }
  const rows = recs.filter((r) => r.kind === 'order').sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, sample).map((r) => ({ key: r.key, type: r.type, date: r.date, check: r.link }));
  return { source: 'occorders', checks, sample: rows };
}
