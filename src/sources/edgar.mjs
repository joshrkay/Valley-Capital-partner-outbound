// SEC EDGAR CMBS loan-level data (PRD E4-S2, E4-S3). Every month each CMBS trust files Form ABS-EE with an EX-102 asset data file:
// one record per loan, with each property's location and type, the balance, rate, maturity, payment status, and the special
// servicer's workout strategy. This adapter finds the latest filing per trust through EDGAR's quarterly form index, reads the EX-102
// of every trust whose file is CMBS (by its XML namespace), keeps the loans with a property in a buy-box metro and a buy-box sector,
// and names each trust's special servicer from the cover of its monthly distribution report (10-D, exhibit 99.1), firm name only.
//
// Every loan is ASSET-LEVEL: property names, addresses and tenants are context for a principal and never reach the drafter. The
// signal attaches to the servicer. Code meanings are from the SEC's ABS XML Technical Specification v3.1 (eis_ABS_CMBSAssetData.xsd).
import { join } from 'node:path';
import { getText, getJson, pacer, realSleep } from './http.mjs';
import { startRun, finishRun, sourceBlock, upsertWithChanges } from './runlog.mjs';
import { readJson, writeJson } from '../store.mjs';

export const SEC = 'https://www.sec.gov';
export const CMBS_NS = 'http://www.sec.gov/edgar/document/absee/cmbs/assetdata';

export const CODES = Object.freeze({
  propertyType: { CH: 'Cooperative housing', HC: 'Health care', IN: 'Industrial', LO: 'Lodging', MF: 'Multifamily', MH: 'Mobile home park', MU: 'Mixed use', OF: 'Office', RT: 'Retail', SE: 'Securities (defeased)', SS: 'Self storage', WH: 'Warehouse', ZZ: 'Missing information', 98: 'Other' },
  paymentStatus: { 0: 'Current', A: 'In grace period or not yet due', B: 'Late, under 30 days', 1: '30 to 59 days delinquent', 2: '60 to 89 days delinquent', 3: '90 or more days delinquent', 4: 'Performing matured balloon', 5: 'Non-performing matured balloon' },
  workout: { 1: 'Modification', 2: 'Foreclosure', 3: 'Bankruptcy', 4: 'Extension', 5: 'Note sale', 6: 'Discounted payoff', 7: 'REO', 8: 'Resolved', 9: 'Pending return to master servicer', 10: 'Deed in lieu of foreclosure', 11: 'Full payoff', 12: 'Reps and warranties', 13: 'To be determined', 98: 'Other' },
  propertyStatus: { 1: 'In foreclosure', 2: 'REO', 3: 'Defeased', 4: 'Partial release', 5: 'Substituted', 6: 'Same as at securitization' },
  modification: { 1: 'Maturity date extension', 2: 'Amortization change', 3: 'Principal write-off', 5: 'Temporary rate reduction', 6: 'Capitalization of interest', 7: 'Capitalization of taxes', 8: 'Combination', 10: 'Forbearance', 98: 'Other' },
});
// Which property types are buy-box sectors. Mixed use may hold retail; it is kept and marked, never counted as a sure fit.
export const SECTOR_OF_TYPE = Object.freeze({ LO: 'hospitality', MF: 'multifamily', RT: 'retail', MU: 'mixed (may include retail)' });
const code = (table, v) => (v === undefined || v === null || v === '' ? null : { code: String(v), label: CODES[table][String(v)] ?? `Unknown code ${v}` });

// ---- EDGAR's quarterly form index ----------------------------------------------------------------------------------------------
// Fixed-width text: Form Type, Company Name, CIK, Date Filed, File Name. Only the forms asked for are parsed.
export function parseFormIndex(text, forms) {
  const want = new Set(forms);
  const out = [];
  for (const line of text.split('\n')) {
    const form = line.slice(0, line.indexOf(' ') > 0 ? line.indexOf(' ') : 0);
    if (!want.has(form)) continue;
    const m = /^(\S+)\s+(.+?)\s+(\d+)\s+(\d{4}-\d{2}-\d{2})\s+(edgar\/data\/\S+\.txt)\s*$/.exec(line);
    if (!m) continue;
    const accession = m[5].split('/').pop().replace(/\.txt$/, '');
    out.push({ form: m[1], company: m[2].trim(), cik: String(Number(m[3])), date: m[4], accession });
  }
  return out;
}

// The latest filing per trust among the given forms (an amendment counts), filed on or after `since`.
export function latestByCik(entries, forms, since) {
  const best = new Map();
  for (const e of entries) {
    if (!forms.includes(e.form) || e.date < since) continue;
    const b = best.get(e.cik);
    if (!b || e.date > b.date || (e.date === b.date && e.accession > b.accession)) best.set(e.cik, e);
  }
  return best;
}

export function quartersFor(now, sinceDays) {
  const qs = new Set();
  for (const d of [new Date(now.getTime() - sinceDays * 86400000), now]) qs.add(`${d.getUTCFullYear()}/QTR${Math.floor(d.getUTCMonth() / 3) + 1}`);
  return [...qs].sort();
}

// ---- The EX-102 asset data file -------------------------------------------------------------------------------------------------
// A small parser for this flat, published schema: <assetData> holds <assets>, each with leaf elements and <property> blocks of leaf
// elements. Namespace prefixes are tolerated. No new dependency.
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };
export const decodeEntities = (s) => String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e.toLowerCase()] ?? m));
const P = '(?:[\\w-]+:)?';
function leaves(body) {
  const out = {};
  const re = new RegExp(`<${P}([A-Za-z][\\w]*)\\b[^>]*?(?:/>|>([^<]*)</${P}\\1>)`, 'g');
  for (const m of body.matchAll(re)) out[m[1]] = m[2] === undefined ? '' : decodeEntities(m[2]).trim();
  return out;
}
export function parseCmbsAssets(xml) {
  const head = xml.slice(0, 2000);
  const namespace = /<(?:[\w-]+:)?assetData\b[^>]*\sxmlns(?::[\w-]+)?="([^"]+)"/.exec(head)?.[1] ?? null;
  const assets = [];
  for (const m of xml.matchAll(new RegExp(`<${P}assets\\b[^>]*>([\\s\\S]*?)</${P}assets>`, 'g'))) {
    const properties = [];
    const body = m[1].replace(new RegExp(`<${P}property\\b[^>]*>([\\s\\S]*?)</${P}property>`, 'g'), (_, inner) => { properties.push(leaves(inner)); return ''; });
    assets.push({ fields: leaves(body), properties });
  }
  return { namespace, assets };
}

// ---- Where a property is -------------------------------------------------------------------------------------------------------
const countyKey = (state, county) => `${String(state ?? '').trim().toUpperCase()}|${String(county ?? '').toLowerCase().replace(/\b(county|parish|city and county of)\b/g, '').replace(/[^a-z]/g, '')}`;
export function metroIndex(metros) {
  const idx = new Map();
  for (const m of metros.metros ?? metros) for (const name of Object.values(m.counties ?? {})) idx.set(countyKey(m.state, name), { cbsa: m.cbsa, label: m.label });
  return idx;
}

const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v));
const mdy = (v) => { const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(String(v ?? '')); return m ? `${m[3]}-${m[1]}-${m[2]}` : null; };   // EDGAR writes MM-DD-YYYY

// One loan, if any of its properties is in a buy-box metro and its type maps to a buy-box sector. Otherwise null.
export function toLoan({ asset, trust, idx, sectors, src }) {
  const f = asset.fields;
  const props = asset.properties.map((p) => {
    const metro = idx.get(countyKey(p.propertyState, p.propertyCounty)) ?? null;
    const type = String(p.propertyTypeCode ?? '').trim();
    return {
      name: p.propertyName ?? null, city: p.propertyCity ?? null, state: p.propertyState ?? null, county: p.propertyCounty ?? null,
      zip: p.propertyZip ? String(p.propertyZip).padStart(5, '0') : null,   // EDGAR drops leading zeros
      metro, type: code('propertyType', type), sector: SECTOR_OF_TYPE[type] ?? null, status: code('propertyStatus', p.propertyStatusCode),
      units: num(p.unitsBedsRoomsNumber), squareFeet: num(p.netRentableSquareFeetNumber), yearBuilt: num(p.yearBuiltNumber),
      occupancy: num(p.mostRecentPhysicalOccupancyPercentage), dscr: num(p.mostRecentDebtServiceCoverageNetCashFlowpercentage ?? p.mostRecentDebtServiceCoverageNetOperatingIncomePercentage),
      noi: num(p.mostRecentNetOperatingIncomeAmount), valuation: num(p.mostRecentValuationAmount), valuationDate: mdy(p.mostRecentValuationDate),
    };
  });
  const inMarket = props.filter((p) => p.metro && p.sector && (sectors.includes(p.sector) || p.sector.startsWith('mixed')));
  if (!inMarket.length) return null;
  return {
    key: `cmbs:${trust.cik}:${f.assetNumber}`, cik: trust.cik, trust: trust.name, assetNumber: f.assetNumber,
    period: mdy(f.reportingPeriodEndDate), originated: mdy(f.originationDate), originalBalance: num(f.originalLoanAmount),
    balance: num(f.reportPeriodEndActualBalanceAmount), rate: num(f.reportPeriodInterestRatePercentage ?? f.originalInterestRatePercentage),
    maturity: mdy(f.maturityDate), postModificationMaturity: mdy(f.postModificationMaturityDate),
    paymentStatus: code('paymentStatus', f.paymentStatusLoanCode), workout: code('workout', f.workoutStrategyCode),
    specialServicingSince: mdy(f.mostRecentSpecialServicerTransferDate), returnedToMasterOn: mdy(f.mostRecentMasterServicerReturnDate),
    modification: code('modification', f.modificationCode), lastModified: mdy(f.lastModificationDate),
    paidOff: f.liquidationPrepaymentCode ? true : false, primaryServicer: f.primaryServicerName ?? null,
    metros: [...new Set(inMarket.map((p) => p.metro.cbsa))], sectors: [...new Set(inMarket.map((p) => p.sector))],
    properties: props, assetLevel: true, _source: src,
  };
}

// What makes a loan worth a principal's attention. Workout code 5 (note sale) is the most direct signal there is.
export function loanSignals(loan, { now = new Date(), maturityMonths = 18 } = {}) {
  const s = [];
  const add = (type, label) => s.push({ type, label });
  if (loan.paidOff) return s;
  const inSS = loan.specialServicingSince && !(loan.returnedToMasterOn && loan.returnedToMasterOn >= loan.specialServicingSince);
  if (inSS) add('special_servicing', `In special servicing since ${loan.specialServicingSince}`);
  const w = loan.workout?.code;
  if (w === '5') add('note_sale', 'Workout strategy: note sale');
  if (w === '6') add('dpo', 'Workout strategy: discounted payoff');
  if (w === '7' || loan.properties.some((p) => p.status?.code === '2')) add('reo', 'REO');
  if (w === '2' || loan.properties.some((p) => p.status?.code === '1')) add('foreclosure', 'In foreclosure');
  if (['1', '2', '3'].includes(loan.paymentStatus?.code)) add('delinquent', loan.paymentStatus.label);
  if (loan.paymentStatus?.code === '5') add('matured_nonperforming', loan.paymentStatus.label);
  const mat = loan.postModificationMaturity ?? loan.maturity;
  if (mat) {
    const horizon = new Date(now); horizon.setUTCMonth(horizon.getUTCMonth() + maturityMonths);
    if (mat >= now.toISOString().slice(0, 10) && mat <= horizon.toISOString().slice(0, 10)) add('maturing', `Matures ${mat}`);
  }
  if (loan.modification) add('modified', `Modified: ${loan.modification.label}`);
  return s;
}

// ---- The special servicer, from the distribution report's cover ------------------------------------------------------------------
// The labels that start the next cell on a distribution report's cover, seen in October 2026 filings.
const COVER_LABELS = ['Asset Representations Reviewer', 'Certificate Administrator', 'Trustee', 'Operating Advisor', 'Master Servicer', 'Directing Certificateholder', 'Depositor', 'Underwriter', 'Current Mortgage Loan', 'Mortgage Loan Detail', 'Bond / Collateral', 'Certificate Distribution', 'Table of Contents'].map((l) => l.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&').replace(/ /g, '\\s+'));
// Only the firm's name is taken. A named person and their contact details appear next to it; they are never read into storage.
export function specialServicerFromReport(html, known = []) {
  // Two views of the cover. `flat` joins everything with single spaces, because a phrase is often split across tags
  // (<span>Special</span> <span>Servicer</span>); the label and the reviewed names are searched there. `cells` keeps tag boundaries and
  // runs of spaces as " | ", and is used only to cut an unrecognized name at the end of its own cell.
  const decoded = decodeEntities(String(html).replace(/<[^>]+>/g, '\u0000'));
  const flat = decoded.replace(/[\s\u00a0\u0000]+/g, ' ');
  const cells = decoded.replace(/[\s\u00a0]*\u0000[\s\u00a0\u0000]*|[\s\u00a0]{2,}/g, ' | ').replace(/[\s\u00a0]/g, ' ');
  const i = flat.search(/Special Servicer\b/i);
  if (i < 0) return { name: null, matched: false };
  const after = flat.slice(i + 'Special Servicer'.length, i + 'Special Servicer'.length + 160);
  const hit = known.find((k) => after.toLowerCase().includes(k.toLowerCase()));
  if (hit) return { name: hit, matched: true };
  // Unrecognized: keep only the first cell after the label, cut at a cover label or a contact-looking token, so a person's name or
  // details are never captured. The result is flagged for a principal to review; it is never treated as known.
  const j = cells.search(/Special(?: \| | )Servicer\b/i);
  const tail = j < 0 ? after : cells.slice(j).replace(/^Special(?: \| | )Servicer/i, '');
  const firm = tail.replace(/^[\s:|-]+/, '').split(' | ')[0]
    .split(new RegExp(`\\s(?:${COVER_LABELS.join('|')}|Attention|Attn|Contact|Phone|Tel|Email|E-mail|Fax|www\\.|\\(\\d{3}\\)|\\d{3}[-.]\\d{3})`, 'i'))[0]
    .trim().slice(0, 80);
  return { name: firm || null, matched: false };
}

// ---- The run ----------------------------------------------------------------------------------------------------------------------
export const edgarPaths = (dir) => ({
  loans: join(dir, 'sources', 'edgar', 'loans.json'), trusts: join(dir, 'sources', 'edgar', 'trusts.json'),
  servicers: join(dir, 'sources', 'edgar', 'servicers.json'), state: join(dir, 'sources', 'edgar', 'state.json'),
});

export async function runEdgar({ dir, metros, buybox, sec, scoring = {}, fetchImpl = globalThis.fetch, now = new Date(), clock = () => new Date(), sleep = realSleep, maxTrusts = Infinity }) {
  const ua = String(sec?.userAgent ?? '');
  if (!ua || /\[confirm/i.test(ua)) throw new Error('config.json sec.userAgent is a placeholder. The SEC asks automated clients to name themselves with a contact; a principal fills it (PRD Q11).');
  const sinceDays = sec.sinceDays ?? 45;
  const since = new Date(now.getTime() - sinceDays * 86400000).toISOString().slice(0, 10);
  const pace = pacer(sec.minIntervalMs ?? 150, { sleep });
  const opts = { fetchImpl, userAgent: ua, sleep, retries: 3, timeoutMs: 120000 };
  const text = async (url, maxBytes) => { await pace(); return (await getText(url, {}, { ...opts, maxBytes })).text; };
  const json = async (url) => { await pace(); return getJson(url, {}, opts); };
  const run = startRun({ source: 'edgar', query: { sinceDays, metros: (metros.metros ?? metros).map((m) => m.cbsa).sort() }, now });
  const fetchedAt = now.toISOString();
  const sectors = buybox?.sectors?.include ?? [];
  const idx = metroIndex(metros);
  const notes = [], errors = [];
  const counts = { filings: 0, notCmbsSized: 0, notCmbs: 0, noEx102: 0, cmbsTrusts: 0, loansRead: 0, loansKept: 0, trustErrors: 0, reports: 0 };

  try {
    // 1. Which trusts filed lately.
    const entries = [];
    for (const q of quartersFor(now, sinceDays)) entries.push(...parseFormIndex(await text(`${SEC}/Archives/edgar/full-index/${q}/form.idx`), ['ABS-EE', 'ABS-EE/A', '10-D', '10-D/A']));
    const absee = [...latestByCik(entries, ['ABS-EE', 'ABS-EE/A'], since).values()].sort((a, b) => (a.cik < b.cik ? -1 : 1)).slice(0, maxTrusts);
    const tenD = latestByCik(entries, ['10-D', '10-D/A'], since);
    counts.filings = absee.length;

    // 2. Each trust's EX-102: CMBS only, metro and sector loans only.
    const loans = {}, trusts = {};
    for (const f of absee) {
      const base = `${SEC}/Archives/edgar/data/${f.cik}/${f.accession.replace(/-/g, '')}`;
      try {
        const items = (await json(`${base}/index.json`))?.directory?.item ?? [];
        const ex = items.filter((i) => /102/.test(i.name) && /\.xml$/i.test(i.name)).sort((a, b) => Number(b.size ?? 0) - Number(a.size ?? 0))[0];
        if (!ex) { counts.noEx102++; continue; }
        if (Number(ex.size ?? 0) > (sec.maxEx102Bytes ?? 5_000_000)) { counts.notCmbsSized++; continue; }   // auto and card pools run to 100+ MB
        const parsed = parseCmbsAssets(await text(`${base}/${ex.name}`));
        if (parsed.namespace !== CMBS_NS) { counts.notCmbs++; continue; }
        counts.cmbsTrusts++;
        const bad = parsed.assets.filter((a) => !a.fields.assetNumber || !a.fields.reportingPeriodEndDate);
        if (bad.length) { counts.trustErrors++; notes.push(`trust ${f.cik}: ${bad.length} asset(s) without assetNumber or reporting period; trust skipped`); continue; }
        const trust = { cik: f.cik, name: f.company, accession: f.accession, filed: f.date };
        const src = (asset) => sourceBlock({ source: 'edgar', endpoint: `ABS-EE ${f.accession} ${ex.name}`, query: { cik: f.cik }, recordId: `${f.cik}:${asset.fields.assetNumber}`, period: asset.fields.reportingPeriodEndDate, fetchedAt, runId: run.runId });
        let kept = 0;
        for (const a of parsed.assets) {
          counts.loansRead++;
          const loan = toLoan({ asset: a, trust, idx, sectors, src: src(a) });
          if (loan) { loan.signals = loanSignals(loan, { now, maturityMonths: scoring?.cmbs?.maturityMonths ?? 18 }); loans[loan.key] = loan; kept++; }
        }
        counts.loansKept += kept;
        trusts[f.cik] = { ...trust, period: parsed.assets[0] ? mdy(parsed.assets[0].fields.reportingPeriodEndDate) : null, loans: parsed.assets.length, loansInMarket: kept, specialServicer: null,
          _source: sourceBlock({ source: 'edgar', endpoint: `ABS-EE ${f.accession}`, query: { cik: f.cik }, recordId: f.cik, period: f.date, fetchedAt, runId: run.runId }) };
      } catch (e) { counts.trustErrors++; notes.push(`trust ${f.cik}: ${String(e.message).slice(0, 120)}`); }
    }

    // 3. The special servicer, for trusts with a loan in the market only (each report runs to megabytes; only the cover is read).
    for (const t of Object.values(trusts).filter((x) => x.loansInMarket > 0)) {
      const d = tenD.get(t.cik);
      if (!d) { notes.push(`trust ${t.cik}: no recent 10-D`); continue; }
      try {
        const base = `${SEC}/Archives/edgar/data/${t.cik}/${d.accession.replace(/-/g, '')}`;
        const items = (await json(`${base}/index.json`))?.directory?.item ?? [];
        const ex = items.find((i) => /ex[-_]?99[-_.]?1|991/i.test(i.name) && /\.html?$/i.test(i.name));
        if (!ex) continue;
        const ss = specialServicerFromReport(await text(`${base}/${ex.name}`, sec.reportHeadBytes ?? 131072), sec.knownSpecialServicers ?? []);
        counts.reports++;
        t.specialServicer = ss.name; t.specialServicerMatched = ss.matched; t.distributionReport = d.accession;
        if (ss.name && !ss.matched) notes.push(`trust ${t.cik}: special servicer "${ss.name}" is not on the reviewed list (config.sec.knownSpecialServicers)`);
      } catch (e) { notes.push(`trust ${t.cik} 10-D: ${String(e.message).slice(0, 120)}`); }
    }

    // 4. Write: loans (with every changed status logged), trusts, a summary per special servicer, state.
    const p = edgarPaths(dir);
    const prev = readJson(p.loans, {});
    let changed = 0;
    for (const [k, loan] of Object.entries(loans)) {
      loan.specialServicer = trusts[loan.cik]?.specialServicer ?? null;
      const r = upsertWithChanges(prev[k], loan, { key: k, runId: run.runId, dir, now });
      loans[k] = r.record; changed += r.changed;
    }
    const servicers = {};
    for (const l of Object.values(loans)) {
      const name = l.specialServicer ?? 'Unknown';
      const s = (servicers[name] ??= { name, loans: 0, balance: 0, specialServicing: 0, noteSale: 0, delinquent: 0, maturing: 0, metros: [], sectors: [] });
      s.loans++; s.balance += l.balance ?? 0;
      for (const sig of l.signals) { if (sig.type === 'special_servicing') s.specialServicing++; if (sig.type === 'note_sale') s.noteSale++; if (sig.type === 'delinquent') s.delinquent++; if (sig.type === 'maturing') s.maturing++; }
      s.metros = [...new Set([...s.metros, ...l.metros])].sort(); s.sectors = [...new Set([...s.sectors, ...l.sectors])].sort();
    }
    writeJson(p.loans, loans);
    writeJson(p.trusts, trusts);
    writeJson(p.servicers, servicers);
    writeJson(p.state, { lastRun: run.runId, ranAt: fetchedAt, since, counts });
    const suspect = counts.cmbsTrusts === 0 || counts.trustErrors > Math.max(3, counts.cmbsTrusts * 0.1);
    const line = finishRun(dir, run, { rowsRead: counts.loansRead, rowsWritten: Object.keys(loans).length, rowsChanged: changed, outcome: 'ok', suspect, notes: notes.slice(0, 50), errors, now: clock() });
    return { runId: run.runId, outcome: line.outcome, ...counts, changed, servicers: Object.keys(servicers).length, notes: notes.length };
  } catch (e) {
    const line = finishRun(dir, run, { rowsRead: counts.loansRead, outcome: 'failed', errors: [String(e.message).slice(0, 300)], notes: notes.slice(0, 50), now: clock() });
    return { runId: run.runId, outcome: line.outcome, ...counts, errors: line.errors };
  }
}
