// The backtest's point-in-time panel (PRD E17-S1). For each past quarter-end in a window, the bank data as it stood then, including
// banks that have since failed or merged, so the backtest is not flattered by survivors. Public FDIC data, pulled with the same client
// as the bank list (src/sources/fdic.mjs), and kept in the data folder under backtest/panel/ with the run log, field checks and change
// log of every adapter (E2). Nothing in the repository names a bank.
//
// The universe at an as-of date D (decision D-B3, a placeholder): every bank headquartered in metros.json hqStates, plus every bank with
// a Summary of Deposits branch in the six metros, that was active on D. "Active" is read from FDIC's own dates: established (ESTYMD) on
// or before the end of the latest quarter known on D, and not ended (ENDEFYMD) on or before D. A bank inactive today is therefore in
// the panel for the quarters it was active. HQ state is FDIC's state for the charter today (or when it closed).
//
// Availability (what the pipeline could have known on D):
//   - a quarter's Call Report counts as known from quarter-end plus config.backtest.callReportLagDays;
//   - the Summary of Deposits as of June 30 counts as known from its release date, June 30 plus config.backtest.sodReleaseLagDays
//     (a placeholder: the FDIC API carries no release date), and the footprint at D is the latest SOD released by D;
//   - an event (a merger, a failure) counts from its own date.
// FDIC serves Call Report figures as amended, not as first filed: a small look-ahead leak the report states every time.
import { join } from 'node:path';
import { readJson, writeJson, listFiles } from '../store.mjs';
import { pacer, realSleep } from '../sources/http.mjs';
import { startRun, finishRun, sourceBlock, assertSourced, upsertWithChanges } from '../sources/runlog.mjs';
import { fdicQuery, orFilter, checkFields, checkHistoryRows, OPTIONAL_KEYS, FDIC_FIELDS, STRUCTURE_CODES, FAILURE_CODES, pullSod, pullInstitutions,
  pullFinancials, pullRecentFailures, pullHistory, pullClosed, eventOf, isoDate, quartersBack } from '../sources/fdic.mjs';
import { quarterIndex, shiftQuarter } from '../metrics.mjs';

export const UNIVERSE = 'hq-states-and-metro-footprint';
// /institutions fields for the panel: the bank list's identity fields plus the dates that say when the charter was active. ESTYMD and
// ENDEFYMD come back as MM/DD/YYYY, and ENDEFYMD is 12/31/9999 for an open bank (checked live on 2026-11-14).
export const PANEL_FIELDS = Object.freeze({ institutions: ['CERT', 'NAME', 'CITY', 'STALP', 'ACTIVE', 'ESTYMD', 'ENDEFYMD'] });
const FAILURE_SOURCES = ['failures', 'institutions', 'history'];

export const backtestPaths = (dir) => {
  const base = join(dir, 'backtest');
  const panel = join(base, 'panel');
  return {
    base, panel, state: join(panel, 'state.json'), institutions: join(panel, 'institutions.json'), universe: join(panel, 'universe.json'),
    failed: join(panel, 'failed.json'), events: join(panel, 'events.json'),
    financials: join(panel, 'financials'), financial: (cert) => join(panel, 'financials', `${cert}.json`),
    sod: join(panel, 'sod'), sodYear: (year) => join(panel, 'sod', `${year}.json`),
    labels: join(base, 'labels.json'), runs: join(base, 'runs.jsonl'), holdout: join(base, 'holdout.jsonl'),
    report: (hash, ext) => join(base, `report-${hash}.${ext}`),
  };
};

// ---- Dates ----------------------------------------------------------------------------------------------------------------------
const QE = /^(\d{4})-(03-31|06-30|09-30|12-31)$/;
export const repOf = (iso) => String(iso).replace(/-/g, '');
export const isoOf = (rep) => { const s = String(rep); return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`; };
export const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

export function asOfQuarters(from, to) {
  for (const [k, v] of [['--from', from], ['--to', to]]) if (!QE.test(String(v ?? ''))) throw new Error(`${k} ${v ?? '(missing)'} is not a quarter-end date (YYYY-03-31, 06-30, 09-30 or 12-31).`);
  if (to < from) throw new Error(`--to ${to} must be on or after --from ${from}.`);
  const out = [];
  for (let r = repOf(from); r <= repOf(to); r = shiftQuarter(r, 1)) out.push(isoOf(r));
  return out;
}

// The latest quarter whose Call Report was known on `asOf`: its quarter-end plus lagDays is on or before asOf.
export function knownQuarter(asOf, lagDays) {
  const y = Number(asOf.slice(0, 4)), m = Number(asOf.slice(5, 7));
  const qm = Math.ceil(m / 3) * 3;
  let rep = `${y}${String(qm).padStart(2, '0')}${qm === 3 || qm === 12 ? '31' : '30'}`;
  if (isoOf(rep) > asOf) rep = shiftQuarter(rep, -1);
  while (addDays(isoOf(rep), lagDays) > asOf) rep = shiftQuarter(rep, -1);
  return rep;
}

export const sodReleasedOn = (year, lagDays) => addDays(`${year}-06-30`, lagDays);
// The Summary of Deposits year released by `date`: this year's June 30 survey once its release date has passed, else last year's.
export const sodYearFor = (date, lagDays) => { const y = Number(String(date).slice(0, 4)); return date >= sodReleasedOn(y, lagDays) ? y : y - 1; };

const byNum = (a, b) => Number(a) - Number(b);
const round = (x, d = 4) => Math.round(x * 10 ** d) / 10 ** d;

// ---- The pull -------------------------------------------------------------------------------------------------------------------
export async function runPanel({ dir, metros, config: cfg = {}, lookbackQuarters = 8, from, to, fetchImpl = globalThis.fetch, now = new Date(), clock = () => new Date(),
  sleep = realSleep, minIntervalMs = 200, retries = 3, timeoutMs = 60000, pageSize = 10000, chunkSize = 50 }) {
  const list = metros?.metros ?? [];
  const states = metros?.hqStates ?? [];
  if (!list.length || !states.length) throw new Error('runPanel: metros.json with metros and hqStates is required.');
  if ((cfg.universe ?? UNIVERSE) !== UNIVERSE) throw new Error(`config.backtest.universe "${cfg.universe}" is not built. Only "${UNIVERSE}" is (decision D-B3).`);
  const lag = cfg.callReportLagDays, sodLag = cfg.sodReleaseLagDays;
  for (const [k, v] of [['callReportLagDays', lag], ['sodReleaseLagDays', sodLag]]) if (!(Number.isInteger(v) && v >= 0)) throw new Error(`config.backtest.${k} must be a whole number of days.`);
  if (!(Number.isInteger(lookbackQuarters) && lookbackQuarters >= 1)) throw new Error('lookbackQuarters (scoring.json) must be a whole number of 1 or more: the scorer needs at least the quarter known on each as-of date.');
  const asOf = asOfQuarters(from ?? cfg.window?.from, to ?? cfg.window?.to);
  const minCoverage = cfg.minCoverage ?? 0.95;
  const query = { from: asOf[0], to: asOf.at(-1), states: [...states].sort(), metros: list.map((m) => String(m.cbsa)).sort(), lookbackQuarters };
  const run = startRun({ source: 'backtest-panel', query, now });
  const http = { fetchImpl, sleep, retries, timeoutMs, pace: pacer(minIntervalMs, { sleep }) };
  const fetchedAt = now.toISOString();
  const today = fetchedAt.slice(0, 10);
  const p = backtestPaths(dir);

  let rowsRead = 0, suspect = false;
  const missing = [], notes = [], nullCounts = {};
  const take = (step, res, fields, check) => {
    rowsRead += res.rowsRead ?? res.rows.length;
    if (res.mismatch) { suspect = true; notes.push(`${step}: received ${res.rows.length} rows of ${res.total} reported`); }
    if (fields || check) {
      const c = check ? check(res.rows) : checkFields(res.rows, fields, { optional: OPTIONAL_KEYS[step] ?? [] });
      for (const m of c.missing) missing.push({ step, ...m });
      for (const [f, n] of Object.entries(c.nulls)) nullCounts[`${step}.${f}`] = (nullCounts[`${step}.${f}`] ?? 0) + n;
    }
    return res;
  };
  const fail = (errors) => {
    const line = finishRun(dir, run, { rowsRead, outcome: 'failed', missingFields: missing.map((m) => `${m.step}.${m.field}`), errors, notes, nullCounts, now: clock() });
    return { runId: run.runId, outcome: line.outcome, errors: line.errors, notes, rowsRead, rowsWritten: 0 };
  };

  try {
    // 1. Fetch and check everything: banks headquartered in our states, open or closed during the window.
    const F = PANEL_FIELDS.institutions;
    const stalp = orFilter('STALP', states, { quote: true });
    const open = take('institutions-hq-open', await fdicQuery({ endpoint: 'institutions', filters: `${stalp} AND ACTIVE:1`, fields: F, limit: pageSize, http }), F);
    const shut = take('institutions-hq-closed', await fdicQuery({ endpoint: 'institutions', filters: `${stalp} AND ACTIVE:0 AND ENDEFYMD:[${asOf[0]} TO *]`, fields: F, limit: pageSize, http }), F);
    const instRows = new Map([...open.rows, ...shut.rows].map((r) => [String(r.CERT), r]));
    const hqCerts = new Set(instRows.keys());

    // The Summary of Deposits for every June 30 released during the window: who had a branch in the metros, and the deposits there.
    const years = [];
    for (let y = sodYearFor(asOf[0], sodLag); y <= sodYearFor(asOf.at(-1), sodLag); y++) years.push(y);
    const sodBy = new Map();
    for (const y of years) {
      const s = take(`sod-${y}`, await pullSod({ metros: list, http, pageSize, chunkSize, year: y }), FDIC_FIELDS.sod);
      if (s.totals) take(`sod-${y}-totals`, s.totals, ['CERT', 'DEPSUM']);
      if (s.noTotal) notes.push(`sod ${y}: ${s.noTotal} bank(s) with metro deposits but no main-office total; their deposit share is unknown`);
      sodBy.set(y, s);
    }
    const sodCerts = new Set([...sodBy.values()].flatMap((s) => [...s.byCert.keys()]));
    const others = [...sodCerts].filter((c) => !instRows.has(c)).sort(byNum);
    if (others.length) for (const r of take('institutions-sod', await pullInstitutions({ certs: others, http, pageSize, chunkSize, fields: F }), F).rows) instRows.set(String(r.CERT), r);
    const certs = [...new Set([...hqCerts, ...sodCerts])].filter((c) => instRows.has(c)).sort(byNum);
    const uni = new Set(certs);

    // Call Reports for every quarter in the window plus lookbackQuarters before it, for every bank in any as-of universe. With a lag of
    // more than a quarter, the quarter known on the first as-of date is earlier still: the pull starts early enough for its lookback too.
    const lastRep = repOf(asOf.at(-1));
    const firstRep = [shiftQuarter(repOf(asOf[0]), -lookbackQuarters), shiftQuarter(knownQuarter(asOf[0], lag), -(lookbackQuarters - 1))].sort()[0];
    const nQuarters = quarterIndex(lastRep) - quarterIndex(firstRep) + 1;
    const fin = certs.length ? take('financials', await pullFinancials({ certs, latestRepdte: lastRep, quarters: nQuarters, http, pageSize, chunkSize }), FDIC_FIELDS.financials) : { rows: [] };

    // Failures from all three FDIC sources, and every structure event, from the start of the window: the backtest's labels need the past.
    const fails = take('failures', await pullRecentFailures({ since: asOf[0], http, pageSize }), FDIC_FIELDS.failures);
    const closed = take('institutions-closed', await pullClosed({ certs: [], since: asOf[0], http, pageSize, chunkSize }), FDIC_FIELDS.closed);
    const hist = take('history', await pullHistory({ since: asOf[0], http, pageSize }), null, checkHistoryRows);
    if (missing.length) return fail([`FDIC did not return requested field(s): ${missing.map((m) => `${m.step}.${m.field} (absent from ${m.rowsLacking} of ${m.rows} rows)`).join(', ')}. A field name may have changed; nothing was written.`]);

    // 2. Build records. Every record carries its source, and an amended value is logged (E2-S4).
    let changed = 0, rowsWritten = 0;
    const src = (endpoint, filters, recordId, period) => sourceBlock({ source: 'fdic', endpoint, query: { filters }, recordId, period, fetchedAt, runId: run.runId });
    const upsert = (prev, rec, key) => { const u = upsertWithChanges(prev, rec, { key, runId: run.runId, dir, now }); changed += u.changed; rowsWritten++; return u.record; };

    const prevInst = readJson(p.institutions, {});
    const institutions = { ...prevInst };
    for (const cert of certs) {
      const r = instRows.get(cert);
      institutions[cert] = upsert(prevInst[cert], {
        CERT: cert, NAME: r.NAME ?? null, CITY: r.CITY ?? null, STALP: r.STALP ?? null, ACTIVE: r.ACTIVE ?? null, ESTYMD: r.ESTYMD ?? null, ENDEFYMD: r.ENDEFYMD ?? null,
        establishedOn: isoDate(r.ESTYMD), endedOn: isoDate(r.ENDEFYMD), hq: states.includes(String(r.STALP ?? '')),
        _source: src('/institutions', `CERT:${cert}`, cert, today),
      }, `backtest:fdic:${cert}`);
    }

    const sodFiles = new Map();
    for (const y of years) {
      const s = sodBy.get(y);
      const prev = readJson(p.sodYear(y), null);
      const byCert = {};
      for (const [cert, x] of [...s.byCert].sort(([a], [b]) => byNum(a, b))) {
        byCert[cert] = upsert(prev?.byCert?.[cert], { branchesByMetro: x.branchesByMetro, depositsByMetro: x.depositsByMetro, totalDeposits: x.totalDeposits,
          _source: src('/sod', `YEAR:${y} AND CERT:${cert}`, `${y}_${cert}`, String(y)) }, `fdic-sod:${y}:${cert}`);
      }
      const releasedOn = sodReleasedOn(y, sodLag);
      sodFiles.set(y, { year: y, releasedOn, releaseBasis: `June 30 plus config.backtest.sodReleaseLagDays (${sodLag}, a placeholder): the FDIC API carries no release date`,
        indexBuiltAt: y === years.at(-1) ? s.index?.builtAt ?? null : null, byCert, _source: src('/sod', s.filters, `sod-${y}`, String(y)) });
    }
    const sodYearAt = (date) => { const want = sodYearFor(date, sodLag); return years.filter((y) => y <= want).at(-1) ?? null; };

    const finByCert = new Map();
    for (const row of fin.rows) {
      const cert = String(row.CERT), rep = String(row.REPDTE);
      if (!uni.has(cert)) continue;
      if (!finByCert.has(cert)) finByCert.set(cert, {});
      finByCert.get(cert)[rep] = { ...Object.fromEntries(FDIC_FIELDS.financials.filter((f) => f in row).map((f) => [f, row[f]])), CERT: cert, REPDTE: rep,
        _source: src('/financials', `CERT:${cert} AND REPDTE:${rep}`, row.ID ?? `${cert}_${rep}`, rep) };
    }
    const finFiles = new Map();
    for (const [cert, qs] of finByCert) {
      const existing = readJson(p.financial(cert), { CERT: cert, quarters: {} });
      const next = { CERT: cert, quarters: { ...existing.quarters } };
      for (const [rep, rec] of Object.entries(qs)) next.quarters[rep] = upsert(existing.quarters?.[rep], rec, `fdic:${cert}:${rep}`);
      finFiles.set(cert, next);
    }

    // Failures: a bank counts as failed if any of the three sources says so; each source's own date is kept (as in E3-S5).
    const say = new Map();
    const put = (cert, k, v) => { if (!uni.has(cert)) return; if (!say.has(cert)) say.set(cert, {}); say.get(cert)[k] ??= v; };
    for (const f of fails.rows) if (String(f.RESTYPE ?? '').toUpperCase() === 'FAILURE') put(String(f.CERT), 'failures', { on: isoDate(f.FAILDATE), restype: 'FAILURE' });
    for (const r of closed.rows) { const code = Number(r.CHANGEC1); if (FAILURE_CODES.includes(code)) put(String(r.CERT), 'institutions', { on: isoDate(r.ENDEFYMD), code, label: STRUCTURE_CODES[code].label }); }
    const events = hist.rows.map(eventOf).filter((e) => e.targetCert && e.effective && e.kind !== 'other');
    for (const e of events.filter((x) => x.kind === 'failure')) put(e.targetCert, 'history', { on: e.effective, code: e.code, label: e.label, transnum: e.transnum, acquirerCert: e.acquirerCert });
    const prevFailed = readJson(p.failed, {});
    const failed = { ...prevFailed };
    for (const [cert, s] of [...say].sort(([a], [b]) => byNum(a, b))) {
      const agree = FAILURE_SOURCES.filter((k) => s[k]);
      const failedOn = s.history?.on ?? s.institutions?.on ?? s.failures?.on ?? null;
      failed[cert] = upsert(prevFailed[cert], { cert, failedOn, sources: Object.fromEntries(FAILURE_SOURCES.map((k) => [k, s[k] ?? null])), agree, missingFrom: FAILURE_SOURCES.filter((k) => !s[k]),
        _source: sourceBlock({ source: 'fdic', endpoint: agree.map((k) => `/${k}`).join(' + '), query: { filters: `CERT:${cert}` }, recordId: cert, period: failedOn ?? today, fetchedAt, runId: run.runId }) }, `backtest:fdic-failed:${cert}`);
    }

    // Structure events with a bank of the universe on either side, placed in the metros by the target's Summary of Deposits branches in
    // the latest June 30 released before the deal took effect.
    const prevEvents = readJson(p.events, {});
    const eventsOut = { ...prevEvents };
    for (const e of events.filter((x) => uni.has(x.targetCert) || (x.acquirerCert && uni.has(x.acquirerCert)))) {
      const y = sodYearAt(e.effective);
      const br = (y && sodBy.get(y)?.byCert.get(e.targetCert)?.branchesByMetro) ?? {};
      const targetMetros = Object.entries(br).filter(([, n]) => n > 0).sort(([a], [b]) => (a < b ? -1 : 1)).map(([cbsa, n]) => ({ cbsa, branches: n, basis: [`branches in the Summary of Deposits, June ${y}`] }));
      eventsOut[e.transnum] = upsert(prevEvents[e.transnum], { transnum: e.transnum, code: e.code, kind: e.kind, label: e.label, effective: e.effective, acquirerCert: e.acquirerCert, targetCert: e.targetCert,
        targetMetros, targetInMetros: targetMetros.length > 0, _source: src('/history', `TRANSNUM:${e.transnum}`, e.transnum, e.effective) }, `backtest:fdic-event:${e.transnum}`);
    }

    // 3. The universe at each as-of date, and the coverage check: rows for at least minCoverage of it, or the run is suspect.
    const universe = {};
    const below = [];
    for (const d of asOf) {
      const K = knownQuarter(d, lag);
      const sy = sodYearAt(d);
      const members = {};
      for (const cert of certs) {
        const i = institutions[cert];
        if ((i.establishedOn && i.establishedOn > isoOf(K)) || (i.endedOn && i.endedOn <= d)) continue;
        const branch = Object.values(sodFiles.get(sy)?.byCert?.[cert]?.branchesByMetro ?? {}).some((n) => n > 0);
        if (!i.hq && !branch) continue;
        members[cert] = { hq: i.hq, branch, rows: !!finFiles.get(cert)?.quarters?.[K] };
      }
      const size = Object.keys(members).length;
      const withRows = Object.values(members).filter((m) => m.rows).length;
      const coverage = size ? round(withRows / size) : null;
      if (coverage === null || coverage < minCoverage) { below.push(d); notes.push(`coverage ${d}: ${withRows} of ${size} banks in the universe have a Call Report for ${isoOf(K)}, below minCoverage ${minCoverage}`); }
      universe[d] = { knownQuarter: K, sodYear: sy, size, withRows, coverage, members };
    }
    if (below.length) suspect = true;
    for (const [y, f] of sodFiles) notes.push(`sod ${y}: ${Object.keys(f.byCert).length} bank(s) with a branch in the metros; known from ${f.releasedOn} (${f.releaseBasis})${f.indexBuiltAt ? `; FDIC's search index holding it was built ${f.indexBuiltAt}` : ''}`);
    notes.push(`universe: ${certs.length} bank(s) across ${asOf.length} as-of quarters (${hqCerts.size} headquartered in ${states.join(', ')}, ${others.length} through a branch only); ${Object.keys(failed).length} failure(s) and ${Object.keys(eventsOut).length} structure event(s) kept`);

    // 4. Write. Atomic per file.
    for (const r of [...Object.values(institutions), ...Object.values(failed), ...Object.values(eventsOut), ...[...sodFiles.values()]]) assertSourced(r);
    writeJson(p.institutions, institutions);
    for (const [y, f] of sodFiles) writeJson(p.sodYear(y), f);
    for (const [cert, f] of finFiles) writeJson(p.financial(cert), f);
    writeJson(p.failed, failed);
    writeJson(p.events, eventsOut);
    writeJson(p.universe, universe);
    writeJson(p.state, { runId: run.runId, pulledAt: fetchedAt, from: asOf[0], to: asOf.at(-1), asOf, lookbackQuarters, callReportLagDays: lag, sodReleaseLagDays: sodLag, minCoverage,
      financialQuarters: { from: quartersBack(lastRep, nQuarters)[0], to: lastRep }, universeRule: UNIVERSE, hqStates: [...states],
      sod: [...sodFiles.values()].map((f) => ({ year: f.year, releasedOn: f.releasedOn, releaseBasis: f.releaseBasis, indexBuiltAt: f.indexBuiltAt })),
      banks: certs.length, coverageBelow: below, suspect });
    rowsWritten += Object.keys(universe).length;
    const line = finishRun(dir, run, { rowsRead, rowsWritten, rowsChanged: changed, outcome: 'ok', suspect, notes, nullCounts, now: clock() });
    return { runId: run.runId, outcome: line.outcome, banks: certs.length, asOf, coverage: Object.fromEntries(asOf.map((d) => [d, universe[d].coverage])), sodYears: years, rowsRead, rowsWritten, changed, notes };
  } catch (e) {
    return fail([e.message]);
  }
}

// ---- Reading the panel, and the view of it on one as-of date ---------------------------------------------------------------------
export function readPanel(dir) {
  const p = backtestPaths(dir);
  const state = readJson(p.state, null);
  if (!state) return null;
  const financials = new Map(listFiles(p.financials, '.json').map((f) => [f.replace(/\.json$/, ''), readJson(join(p.financials, f))]));
  const sod = Object.fromEntries(listFiles(p.sod, '.json').map((f) => [Number(f.replace(/\.json$/, '')), readJson(join(p.sod, f))]));
  return { state, institutions: readJson(p.institutions, {}), universe: readJson(p.universe, {}), failed: readJson(p.failed, {}), events: readJson(p.events, {}), financials, sod };
}

// What the pipeline would have known on `asOf`, as scoreBank's arguments for every bank in that date's universe that has a Call Report
// for the quarter known then. Lag defaults are the panel's own, so the view matches the universe the coverage check verified.
export function pointInTime({ panel, asOf, lagDays = panel.state.callReportLagDays, lookbackQuarters = panel.state.lookbackQuarters, sodReleaseLagDays = panel.state.sodReleaseLagDays }) {
  const u = panel.universe[asOf];
  if (!u) throw new Error(`The panel has no universe for ${asOf}. Its as-of dates: ${panel.state.asOf.join(', ')}.`);
  const K = knownQuarter(asOf, lagDays);
  const want = sodYearFor(asOf, sodReleaseLagDays);
  const sodYear = Object.keys(panel.sod).map(Number).filter((y) => y <= want).sort().at(-1) ?? null;
  const reps = quartersBack(K, lookbackQuarters);
  const base = shiftQuarter(K, -12);   // the concentration screen's 36-month growth base, kept apart as in the live pull
  const events = Object.values(panel.events);
  const banks = [], notScored = [];
  for (const cert of Object.keys(u.members).sort(byNum)) {
    const m = u.members[cert];
    const file = panel.financials.get(cert);
    if (!file?.quarters?.[K]) { notScored.push(cert); continue; }
    const i = panel.institutions[cert] ?? {};
    const s = sodYear === null ? null : panel.sod[sodYear]?.byCert?.[cert] ?? null;
    banks.push({
      cert, asOf, latestRepdte: K,
      institution: { CERT: cert, NAME: i.NAME ?? '', CITY: i.CITY ?? '', STALP: i.STALP ?? '', ACTIVE: 1, status: 'active', via: { hq: !!m.hq, branch: !!m.branch }, inUniverse: true },
      footprint: { branchesByMetro: s?.branchesByMetro ?? {}, sod: s ? { year: sodYear, depositsByMetro: s.depositsByMetro, totalDeposits: s.totalDeposits } : null },
      financials: { CERT: cert, quarters: Object.fromEntries(reps.filter((r) => file.quarters[r]).map((r) => [r, file.quarters[r]])), ...(file.quarters[base] ? { growthBase: { [base]: file.quarters[base] } } : {}) },
      events: events.filter((e) => String(e.acquirerCert) === cert && e.effective <= asOf),
    });
  }
  return { asOf, knownQuarter: K, sodYear, banks, notScored, universeSize: u.size };
}

// ---- The verify check (read-only, no network) -----------------------------------------------------------------------------------
const check = (id, ok, summary, detail) => ({ id, ok: !!ok, summary, ...(detail ? { detail } : {}) });
export function verifyPanel({ dir, config: cfg = {} }) {
  const panel = readPanel(dir);
  if (!panel) return { source: 'backtest', checks: [check('backtest.present', false, 'No backtest panel yet. Run: outbound backtest panel')], sample: [] };
  const min = cfg.minCoverage ?? panel.state.minCoverage ?? 0.95;
  const checks = [check('backtest.present', true, `Panel ${panel.state.runId}: ${panel.state.asOf.length} as-of quarters, ${panel.state.from} to ${panel.state.to}, ${panel.state.banks} banks.`)];
  const low = panel.state.asOf.filter((d) => !(panel.universe[d]?.coverage >= min));
  checks.push(check('backtest.coverage', !low.length, low.length
    ? `${low.length} as-of quarter(s) have Call Report rows for less than ${min} of their universe: ${low.map((d) => `${d} (${panel.universe[d]?.withRows ?? 0} of ${panel.universe[d]?.size ?? 0})`).join(', ')}. The panel is suspect.`
    : `Every as-of quarter has Call Report rows for at least ${min} of its universe (lowest ${Math.min(...panel.state.asOf.map((d) => panel.universe[d].coverage))}).`));
  const gaps = [];
  for (const d of panel.state.asOf) for (const [cert, m] of Object.entries(panel.universe[d]?.members ?? {})) if (m.rows && !panel.financials.get(cert)?.quarters?.[panel.universe[d].knownQuarter]) gaps.push(`${d}:${cert}`);
  checks.push(check('backtest.rows', !gaps.length, gaps.length ? `${gaps.length} bank-quarter(s) marked as having a Call Report have none stored. Re-pull: outbound backtest panel` : 'Every bank-quarter marked as having a Call Report has one stored.'));
  return { source: 'backtest', checks, sample: [] };
}

