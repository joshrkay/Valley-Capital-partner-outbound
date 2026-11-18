// SEC EDGAR CMBS loan-level data (PRD E4-S2, E4-S3). Every month each CMBS trust files Form ABS-EE with an EX-102 asset data file:
// one record per loan, with each property's location and type, the balance, rate, maturity, payment status, and the special
// servicer's workout strategy. This adapter finds the latest filing per trust through EDGAR's quarterly form index, reads the EX-102
// of every trust whose file is CMBS (by its XML namespace), keeps the loans with a property in a buy-box metro and a buy-box sector,
// and names each trust's special servicer from the cover of its monthly distribution report (10-D, exhibit 99.1), firm name only.
// A kept loan whose report shows a disposition (liquidation code 3) or a DPO (6) is also recorded in sources/edgar/dispositions.json,
// and kept there: the loan drops out of the next report, so the month that carries the code is the only chance (PRD E16-S1).
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
  // Item 2(i)(1), liquidationPrepaymentCode: unscheduled payments or liquidation proceeds received during the reporting period.
  liquidationPrepayment: { 1: 'Partial liquidation (curtailment)', 2: 'Payoff prior to maturity', 3: 'Disposition/liquidation', 4: 'Repurchase/substitution', 5: 'Full payoff at maturity', 6: 'DPO', 7: 'Liquidated before 7/1/2006', 8: 'Payoff with penalty', 9: 'Payoff with yield maintenance', 10: 'Curtailment with penalty', 11: 'Curtailment with yield maintenance' },
});
// Codes after which the loan has left the trust. A curtailment (1, 10, 11) is a partial payment: the loan stays, and so do its signals.
export const LOAN_GONE_CODES = Object.freeze(['2', '3', '4', '5', '6', '7', '8', '9']);
// Codes that make a completed sale event in the ledger (src/sales.mjs): 3 a disposition or liquidation, 6 a discounted payoff.
export const DISPOSITION_CODES = Object.freeze(['3', '6']);
// Elements the schema lets repeat (maxOccurs="unbounded", unique within a loan). Every value is kept, not only the last.
export const REPEATABLE = Object.freeze(['workoutStrategyCode', 'modificationCode']);
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
  for (const [cik, list] of filingsByCik(entries, forms, since)) best.set(cik, list[0]);
  return best;
}

// Every filing per trust in the window, newest first, so an amendment without an EX-102 can fall back to the filing it amends.
// One filing is often listed under two CIKs, the trust and its depositor (seen 2026-11-13: a Benchmark trust's ABS-EE also under its
// depositor). It is kept under one only: the higher CIK, because the issuing trust is always registered after its depositor.
export function filingsByCik(entries, forms, since) {
  const inWindow = entries.filter((e) => forms.includes(e.form) && e.date >= since);
  const owner = new Map();   // accession -> cik that keeps it
  for (const e of inWindow) { const o = owner.get(e.accession); if (!o || Number(e.cik) > Number(o)) owner.set(e.accession, e.cik); }
  const by = new Map();
  for (const e of inWindow) {
    if (owner.get(e.accession) !== e.cik) continue;
    if (!by.has(e.cik)) by.set(e.cik, []);
    by.get(e.cik).push(e);
  }
  for (const list of by.values()) list.sort((a, b) => (a.date !== b.date ? (a.date > b.date ? -1 : 1) : a.accession > b.accession ? -1 : 1));
  return by;
}
export const coFiled = (entries, forms, since) => {
  const owners = new Map();
  for (const e of entries.filter((x) => forms.includes(x.form) && x.date >= since)) owners.set(e.accession, [...(owners.get(e.accession) ?? []), e]);
  return [...owners.values()].filter((l) => l.length > 1);
};

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
// Every value of each repeatable element, in file order. `leaves` keeps only the last one.
function lists(body) {
  const out = {};
  for (const name of REPEATABLE) {
    const vals = [...body.matchAll(new RegExp(`<${P}${name}\\b[^>]*>([^<]*)</${P}${name}>`, 'g'))].map((m) => decodeEntities(m[1]).trim()).filter(Boolean);
    if (vals.length) out[name] = [...new Set(vals)];
  }
  return out;
}
export function parseCmbsAssets(xml) {
  // The root's own namespace: xmlns="..." for an unprefixed <assetData>, xmlns:p="..." for <p:assetData>. Attribute order varies by
  // filing agent (seen 2026-11-13: some put xmlns:xsi first, some last), so the attribute is looked up by name, never by position.
  const root = /<(?:([\w-]+):)?assetData\b([^>]*)>/.exec(xml.slice(0, 4000));
  const attr = root ? (root[1] ? `xmlns:${root[1]}` : 'xmlns') : null;
  const namespace = attr ? new RegExp(`\\s${attr.replace(':', '\\:')}="([^"]+)"`).exec(root[2])?.[1] ?? null : null;
  const assets = [];
  for (const m of xml.matchAll(new RegExp(`<${P}assets\\b[^>]*>([\\s\\S]*?)</${P}assets>`, 'g'))) {
    const properties = [];
    const body = m[1].replace(new RegExp(`<${P}property\\b[^>]*>([\\s\\S]*?)</${P}property>`, 'g'), (_, inner) => { properties.push(leaves(inner)); return ''; });
    assets.push({ fields: leaves(body), lists: lists(body), properties });
  }
  return { namespace, assets };
}

// Some filers list a portfolio loan as one parent record (asset "10", with the loan's terms) and one record per property
// ("10-001" ... "10-065", property only: no balance, rate or maturity). Seen 2026-11-13: 93 of 157 records in one trust. Folded into
// the parent, so a portfolio is one loan with all its properties, never 65 loans with no balance. Others nest every <property>
// inside the one record; both forms end up the same.
export function mergePropertyRecords(assets) {
  const byNum = new Map(assets.map((a) => [a.fields.assetNumber, a]));
  const out = []; let merged = 0;
  for (const a of assets) {
    const m = /^(.+)-(\d+)$/.exec(a.fields.assetNumber ?? '');
    const propertyOnly = !a.fields.originalLoanAmount && !a.fields.maturityDate && !a.fields.reportPeriodEndActualBalanceAmount;
    const parent = m && propertyOnly ? byNum.get(m[1]) : null;
    if (parent && parent !== a) { parent.properties.push(...a.properties); merged++; continue; }
    out.push(a);
  }
  return { assets: out, merged };
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
  const liquidation = code('liquidationPrepayment', f.liquidationPrepaymentCode);
  const workoutList = asset.lists?.workoutStrategyCode ?? (f.workoutStrategyCode ? [f.workoutStrategyCode] : []);
  return {
    key: `cmbs:${trust.cik}:${f.assetNumber}`, cik: trust.cik, trust: trust.name, assetNumber: f.assetNumber,
    period: mdy(f.reportingPeriodEndDate), originated: mdy(f.originationDate), originalBalance: num(f.originalLoanAmount),
    balance: num(f.reportPeriodEndActualBalanceAmount), paidThrough: mdy(f.paidThroughDate),   // the CMBS link's block (src/cmbslinks.mjs)
    rate: num(f.reportPeriodInterestRatePercentage ?? f.originalInterestRatePercentage),
    maturity: mdy(f.maturityDate), postModificationMaturity: mdy(f.postModificationMaturityDate),
    paymentStatus: code('paymentStatus', f.paymentStatusLoanCode), workout: code('workout', f.workoutStrategyCode),
    workouts: workoutList.map((w) => code('workout', w)),   // the full list: the schema lets the code repeat
    specialServicingSince: mdy(f.mostRecentSpecialServicerTransferDate), returnedToMasterOn: mdy(f.mostRecentMasterServicerReturnDate),
    modification: code('modification', f.modificationCode), lastModified: mdy(f.lastModificationDate),
    paidOff: !!liquidation && LOAN_GONE_CODES.includes(liquidation.code), primaryServicer: f.primaryServicerName ?? null,
    // Completed dispositions (PRD E16-S1). All optional in the schema and often absent; null when the filing leaves them out.
    liquidationPrepayment: liquidation, liquidationPrepaymentDate: mdy(f.liquidationPrepaymentDate),
    realizedLossToTrust: num(f.realizedLossToTrustAmount), beginningScheduledBalance: num(f.reportPeriodBeginningScheduleLoanBalanceAmount),
    originator: f.originatorName ?? null, originalTermMonths: num(f.originalTermLoanNumber),
    metros: [...new Set(inMarket.map((p) => p.metro.cbsa))], sectors: [...new Set(inMarket.map((p) => p.sector))],
    properties: props, assetLevel: true, _source: src,
  };
}

// The field check for the optional fields above (PRD E16-S1). Absent is allowed and counted; a value that is present but not in the
// schema's form (an unknown code, a date that is not MM-DD-YYYY, an amount that is not a number) is an issue for the run notes.
export const OPTIONAL_LOAN_FIELDS = Object.freeze(['liquidationPrepaymentCode', 'liquidationPrepaymentDate', 'realizedLossToTrustAmount', 'workoutStrategyCode', 'originatorName', 'originationDate', 'originalLoanAmount', 'originalTermLoanNumber', 'reportPeriodBeginningScheduleLoanBalanceAmount']);
export function checkLoanFields(asset) {
  const f = asset.fields ?? {};
  const absent = OPTIONAL_LOAN_FIELDS.filter((k) => f[k] === undefined || f[k] === '');
  const issues = [];
  const isNum = (v) => v !== undefined && v !== '' && Number.isFinite(Number(v));
  if (f.liquidationPrepaymentCode && !CODES.liquidationPrepayment[f.liquidationPrepaymentCode]) issues.push({ field: 'liquidationPrepaymentCode', problem: 'unknown code' });
  for (const w of asset.lists?.workoutStrategyCode ?? []) if (!CODES.workout[w]) issues.push({ field: 'workoutStrategyCode', problem: 'unknown code' });
  for (const k of ['liquidationPrepaymentDate', 'originationDate']) if (f[k] && !mdy(f[k])) issues.push({ field: k, problem: 'not MM-DD-YYYY' });
  for (const k of ['realizedLossToTrustAmount', 'originalLoanAmount', 'originalTermLoanNumber', 'reportPeriodBeginningScheduleLoanBalanceAmount']) if (f[k] && !isNum(f[k])) issues.push({ field: k, problem: 'not a number' });
  return { absent, issues };
}

// Every workout code a loan has shown, with the first reporting period it was seen in. Carried from run to run, so a note-sale
// workout coded months before a loan was liquidated is still known when the liquidation is reported.
export function workoutHistory(previous = [], loan) {
  const out = new Map((previous ?? []).map((w) => [w.code, w]));
  for (const w of loan.workouts ?? []) if (w && !out.has(w.code)) out.set(w.code, { code: w.code, label: w.label, firstSeen: loan.period });
  return [...out.values()].sort((a, b) => (a.firstSeen ?? '').localeCompare(b.firstSeen ?? '') || a.code.localeCompare(b.code));
}
// Two histories as one: every code either has seen, each with the earlier first sighting.
export function mergeWorkoutHistory(a = [], b = []) {
  const out = new Map();
  for (const w of [...(a ?? []), ...(b ?? [])]) {
    const o = out.get(w.code);
    if (!o || (w.firstSeen && (!o.firstSeen || w.firstSeen < o.firstSeen))) out.set(w.code, { code: w.code, label: w.label, firstSeen: w.firstSeen ?? o?.firstSeen ?? null });
  }
  return [...out.values()].sort((x, y) => (x.firstSeen ?? '').localeCompare(y.firstSeen ?? '') || x.code.localeCompare(y.code));
}

// A loan whose report carries a disposition code (3) or a DPO (6) becomes a disposition record, kept in sources/edgar/dispositions.json
// for good: the loan leaves the next month's report, so this is the only time the event can be recorded. Names and addresses of the
// properties are kept here as context for a principal; they never go in a log or reach the drafter. `previous` is the loan as the last
// run stored it, for the balance before liquidation when the report has no beginning balance.
export function dispositionOf(loan, previous = null) {
  const c = loan.liquidationPrepayment?.code;
  if (!DISPOSITION_CODES.includes(c)) return null;
  const history = loan.workoutHistory ?? workoutHistory(previous?.workoutHistory, loan);
  return {
    key: `cmbs-liquidation:${loan.cik}:${loan.assetNumber}`, loanKey: loan.key, cik: loan.cik, trust: loan.trust, assetNumber: loan.assetNumber,
    period: loan.period, liquidation: loan.liquidationPrepayment, liquidationDate: loan.liquidationPrepaymentDate,
    realizedLossToTrust: loan.realizedLossToTrust, beginningScheduledBalance: loan.beginningScheduledBalance,
    previousBalance: previous?.balance ?? null, previousPeriod: previous?.period ?? null,
    workoutsNow: loan.workouts ?? [], workoutHistory: history, noteSaleSeen: history.some((w) => w.code === '5') || (loan.workouts ?? []).some((w) => w?.code === '5'),
    specialServicer: loan.specialServicer ?? null, specialServicerMatched: loan.specialServicerMatched ?? null, primaryServicer: loan.primaryServicer,
    originator: loan.originator, originated: loan.originated, originalBalance: loan.originalBalance, originalTermMonths: loan.originalTermMonths,
    metros: loan.metros, sectors: loan.sectors,
    properties: (loan.properties ?? []).map((p) => ({ name: p.name, city: p.city, state: p.state, county: p.county, metro: p.metro?.cbsa ?? null, type: p.type, sector: p.sector })),
    assetLevel: true, contextOnly: true, _source: loan._source,
  };
}

// What makes a loan worth a principal's attention. Workout code 5 (note sale) is the most direct signal there is.
export function loanSignals(loan, { now = new Date(), maturityMonths = 18 } = {}) {
  const s = [];
  const add = (type, label) => s.push({ type, label });
  if (loan.paidOff) return s;
  const inSS = loan.specialServicingSince && !(loan.returnedToMasterOn && loan.returnedToMasterOn >= loan.specialServicingSince);
  if (inSS) add('special_servicing', `In special servicing since ${loan.specialServicingSince}`);
  // The workout code repeats in the schema; every listed code counts.
  const ws = new Set([...(loan.workouts ?? []), loan.workout].filter(Boolean).map((x) => x.code));
  if (ws.has('5')) add('note_sale', 'Workout strategy: note sale');
  if (ws.has('6')) add('dpo', 'Workout strategy: discounted payoff');
  if (ws.has('7') || loan.properties.some((p) => p.status?.code === '2')) add('reo', 'REO');
  if (ws.has('2') || loan.properties.some((p) => p.status?.code === '1')) add('foreclosure', 'In foreclosure');
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
const squash = (t) => String(t).toLowerCase().replace(/[^a-z0-9]/g, '');

// Returns { name, matched, all }: the first special servicer named on the cover, whether it is on the reviewed list, and every one the
// cover names (a trust can have two: seen 2026-11-13, one for its co-op loans). A reviewed name counts only when it directly follows
// the label, compared without case or punctuation ("LNR Partners,LLC" and "LNR Partners, Inc." both match "LNR Partners"). Every
// occurrence of the label is tried, because covers also use it in a table of contents.
export function specialServicerFromReport(html, known = []) {
  // `flat` joins everything with single spaces (a phrase is often split across tags); `cells` keeps tag boundaries as " | " and is
  // used only to cut an unrecognized name at the end of its own cell.
  const decoded = decodeEntities(String(html).replace(/<[^>]+>/g, '\u0000'));
  const flat = decoded.replace(/[\s\u00a0\u0000]+/g, ' ');
  const cells = decoded.replace(/[\s\u00a0]*\u0000[\s\u00a0\u0000]*|[\s\u00a0]{2,}/g, ' | ').replace(/[\s\u00a0]/g, ' ');
  const all = [];
  for (const m of [...flat.matchAll(/Special Servicer\b/gi)].slice(0, 25)) {
    const next = squash(flat.slice(m.index + m[0].length, m.index + m[0].length + 120));
    const hit = known.find((k) => next.startsWith(squash(k)));
    if (hit && !all.includes(hit)) all.push(hit);
  }
  if (all.length) return { name: all[0], matched: true, all };
  // Unrecognized: the first cell after a label that is not another heading, cut at a cover label or a contact-looking token, so a
  // person's name or details are never captured. Flagged for a principal to review; never treated as known.
  const heading = new RegExp(`^(?:${COVER_LABELS.join('|')}|Table of Contents|Principal Prepayment|\\d)`, 'i');
  for (const m of [...cells.matchAll(/Special(?: \| | )Servicer\b/gi)].slice(0, 25)) {
    const cell = cells.slice(m.index + m[0].length).replace(/^[\s:|-]+/, '').split(' | ')[0];
    if (!/[A-Za-z]/.test(cell) || heading.test(cell)) continue;
    const firm = cell.split(new RegExp(`\\s(?:${COVER_LABELS.join('|')}|Attention|Attn|Contact|Phone|Tel|Email|E-mail|Fax|www\\.|\\(\\d{3}\\)|\\d{3}[-.]\\d{3})`, 'i'))[0].trim().slice(0, 80);
    if (firm) return { name: firm, matched: false, all: [firm] };
  }
  return { name: null, matched: false, all: [] };
}

// ---- The run ----------------------------------------------------------------------------------------------------------------------
export const edgarPaths = (dir) => ({
  loans: join(dir, 'sources', 'edgar', 'loans.json'), trusts: join(dir, 'sources', 'edgar', 'trusts.json'),
  servicers: join(dir, 'sources', 'edgar', 'servicers.json'), state: join(dir, 'sources', 'edgar', 'state.json'),
  dispositions: join(dir, 'sources', 'edgar', 'dispositions.json'),
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
  const counts = { filings: 0, notCmbsSized: 0, notCmbs: 0, noEx102: 0, cmbsTrusts: 0, loansRead: 0, loansKept: 0, trustErrors: 0, reports: 0, dispositions: 0, dispositionsNew: 0, fieldIssues: 0 };
  // The optional-field check (E16-S1), over the loans kept: how many lack each field, and values that are present but malformed.
  const absent = Object.fromEntries(OPTIONAL_LOAN_FIELDS.map((k) => [k, 0]));

  try {
    // 1. Which trusts filed lately.
    const entries = [];
    for (const q of quartersFor(now, sinceDays)) entries.push(...parseFormIndex(await text(`${SEC}/Archives/edgar/full-index/${q}/form.idx`), ['ABS-EE', 'ABS-EE/A', '10-D', '10-D/A']));
    const byCik = filingsByCik(entries, ['ABS-EE', 'ABS-EE/A'], since);
    const ciks = [...byCik.keys()].sort().slice(0, maxTrusts);
    const tenD = latestByCik(entries, ['10-D', '10-D/A'], since);
    counts.filings = ciks.length;
    counts.coFiled = coFiled(entries, ['ABS-EE', 'ABS-EE/A'], since).length;
    const outcomes = [];   // one line per trust: what happened to it, so a verification can account for every filer

    // 2. Each trust's EX-102: CMBS only, metro and sector loans only.
    const loans = {}, trusts = {};
    for (const cik of ciks) {
      let f, base, ex;
      const tried = [];
      try {
        // Newest first; an amendment that carries no EX-102 falls back to the filing it amends (at most three filings are tried).
        for (const cand of byCik.get(cik).slice(0, 3)) {
          const b = `${SEC}/Archives/edgar/data/${cand.cik}/${cand.accession.replace(/-/g, '')}`;
          const items = (await json(`${b}/index.json`))?.directory?.item ?? [];
          const x = items.filter((i) => /102/.test(i.name) && /\.xml$/i.test(i.name)).sort((p, q) => Number(q.size ?? 0) - Number(p.size ?? 0))[0];
          tried.push(cand.accession);
          if (x) { f = cand; base = b; ex = x; break; }
        }
        const company = byCik.get(cik)[0].company;
        if (!ex) { counts.noEx102++; outcomes.push({ cik, company, outcome: 'no_ex102', tried }); continue; }
        if (Number(ex.size ?? 0) > (sec.maxEx102Bytes ?? 5_000_000)) { counts.notCmbsSized++; outcomes.push({ cik, company, outcome: 'too_large', bytes: Number(ex.size) }); continue; }   // auto and card pools run to 100+ MB
        const parsed = parseCmbsAssets(await text(`${base}/${ex.name}`));
        const records = parsed.assets.length;
        if (parsed.namespace !== CMBS_NS) { counts.notCmbs++; outcomes.push({ cik, company, outcome: 'not_cmbs', namespace: parsed.namespace }); continue; }
        counts.cmbsTrusts++;
        const bad = parsed.assets.filter((a) => !a.fields.assetNumber || !a.fields.reportingPeriodEndDate);
        if (bad.length) { counts.trustErrors++; outcomes.push({ cik, company, outcome: 'bad_records', count: bad.length }); notes.push(`trust ${f.cik}: ${bad.length} asset(s) without assetNumber or reporting period; trust skipped`); continue; }
        const folded = mergePropertyRecords(parsed.assets);
        parsed.assets = folded.assets;
        counts.propertyRecordsMerged = (counts.propertyRecordsMerged ?? 0) + folded.merged;
        const trust = { cik: f.cik, name: f.company, accession: f.accession, filed: f.date };
        const src = (asset) => sourceBlock({ source: 'edgar', endpoint: `ABS-EE ${f.accession} ${ex.name}`, query: { cik: f.cik }, recordId: `${f.cik}:${asset.fields.assetNumber}`, period: asset.fields.reportingPeriodEndDate, fetchedAt, runId: run.runId });
        let kept = 0;
        for (const a of parsed.assets) {
          counts.loansRead++;
          const loan = toLoan({ asset: a, trust, idx, sectors, src: src(a) });
          if (loan) {
            loan.signals = loanSignals(loan, { now, maturityMonths: scoring?.cmbs?.maturityMonths ?? 18 }); loans[loan.key] = loan; kept++;
            const fc = checkLoanFields(a);
            for (const k of fc.absent) absent[k]++;
            for (const i of fc.issues) { counts.fieldIssues++; if (counts.fieldIssues <= 20) notes.push(`trust ${f.cik} asset ${a.fields.assetNumber}: ${i.field} ${i.problem}`); }
          }
        }
        counts.loansKept += kept;
        outcomes.push({ cik, company, outcome: 'cmbs', accession: f.accession, records, loans: parsed.assets.length, propertyRecordsMerged: folded.merged, kept, ...(f.form === 'ABS-EE/A' ? { amendment: true } : {}), ...(tried.length > 1 ? { fellBackFrom: tried.slice(0, -1) } : {}) });
        trusts[f.cik] = { ...trust, period: parsed.assets[0] ? mdy(parsed.assets[0].fields.reportingPeriodEndDate) : null, loans: parsed.assets.length, loansInMarket: kept, specialServicer: null,
          _source: sourceBlock({ source: 'edgar', endpoint: `ABS-EE ${f.accession}`, query: { cik: f.cik }, recordId: f.cik, period: f.date, fetchedAt, runId: run.runId }) };
      } catch (e) { counts.trustErrors++; outcomes.push({ cik, outcome: 'error', error: String(e.message).slice(0, 120) }); notes.push(`trust ${cik}: ${String(e.message).slice(0, 120)}`); }
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
        t.specialServicer = ss.name; t.specialServicers = ss.all; t.specialServicerMatched = ss.matched; t.distributionReport = d.accession;
        if (ss.name && !ss.matched) notes.push(`trust ${t.cik}: special servicer "${ss.name}" is not on the reviewed list (config.sec.knownSpecialServicers)`);
      } catch (e) { notes.push(`trust ${t.cik} 10-D: ${String(e.message).slice(0, 120)}`); }
    }

    // 4. Write: loans (with every changed status logged), trusts, a summary per special servicer, state.
    const p = edgarPaths(dir);
    const prev = readJson(p.loans, {});
    let changed = 0;
    for (const [k, loan] of Object.entries(loans)) {
      loan.specialServicer = trusts[loan.cik]?.specialServicer ?? null;
      loan.specialServicerMatched = trusts[loan.cik]?.specialServicerMatched ?? null;
      // Loans stored before the workout list was kept carry one code; it seeds the history.
      const before = prev[k]?.workoutHistory ?? (prev[k]?.workout ? [{ code: prev[k].workout.code, label: prev[k].workout.label, firstSeen: prev[k].period }] : []);
      loan.workoutHistory = workoutHistory(before, loan);
      const r = upsertWithChanges(prev[k], loan, { key: k, runId: run.runId, dir, now });
      loans[k] = r.record; changed += r.changed;
    }
    // Completed dispositions (E16-S1): recorded from the report that carries the code, and kept after the loan leaves the reports.
    const prevDisp = readJson(p.dispositions, {});
    const dispositions = { ...prevDisp };
    for (const [k, loan] of Object.entries(loans)) {
      const d = dispositionOf(loan, prev[k] ?? null);
      if (!d) continue;
      const old = prevDisp[d.key];
      // The balance before liquidation is fixed once known: a later report of the same liquidation shows the loan already paid down.
      const rec = { ...d, previousBalance: old?.previousBalance ?? d.previousBalance, previousPeriod: old?.previousPeriod ?? d.previousPeriod,
        workoutHistory: mergeWorkoutHistory(old?.workoutHistory, d.workoutHistory),
        noteSaleSeen: !!(d.noteSaleSeen || old?.noteSaleSeen), firstSeenAt: old?.firstSeenAt ?? fetchedAt, firstRunId: old?.firstRunId ?? run.runId };
      const u = upsertWithChanges(old, rec, { key: d.key, runId: run.runId, dir, now, contextFields: ['properties'] });
      dispositions[d.key] = u.record; changed += u.changed;
      if (!old) counts.dispositionsNew++;
    }
    counts.dispositions = Object.keys(dispositions).length;
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
    writeJson(p.dispositions, dispositions);
    writeJson(p.state, { lastRun: run.runId, ranAt: fetchedAt, since, counts, outcomes, fieldCoverage: { loansKept: counts.loansKept, absent } });
    if (counts.dispositionsNew) notes.push(`${counts.dispositionsNew} new completed disposition(s) or DPO(s) recorded (sources/edgar/dispositions.json)`);
    const suspect = counts.cmbsTrusts === 0 || counts.trustErrors > Math.max(3, counts.cmbsTrusts * 0.1);
    const line = finishRun(dir, run, { rowsRead: counts.loansRead, rowsWritten: Object.keys(loans).length, rowsChanged: changed, outcome: 'ok', suspect, notes: notes.slice(0, 50), errors, nullCounts: absent, now: clock() });
    return { runId: run.runId, outcome: line.outcome, ...counts, changed, servicers: Object.keys(servicers).length, notes: notes.length };
  } catch (e) {
    const line = finishRun(dir, run, { rowsRead: counts.loansRead, outcome: 'failed', errors: [String(e.message).slice(0, 300)], notes: notes.slice(0, 50), now: clock() });
    return { runId: run.runId, outcome: line.outcome, ...counts, errors: line.errors };
  }
}
