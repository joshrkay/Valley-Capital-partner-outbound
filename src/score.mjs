// Scoring and the paper profile (PRD E0-S1, E6-S2, E6-S6). Code only, no model: the same inputs always give the same score, and every
// point traces to an FDIC field, a report date and a value. Reads what the FDIC adapter stored under sources/fdic/ and writes
// candidates/latest.json (PRD Appendix C). Three axes: distress (is the bank under pressure), fit (is the paper it likely holds what
// the buy box buys, where we buy it) and timing (why now). Weights, thresholds and tier cuts live in scoring.json (placeholders).
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { readJson, writeJson, listFiles, audit } from './store.mjs';
import { METRICS, CATEGORIES, SIGNAL_TYPES, computeMetrics, detectSignals, periodLabel, shiftQuarter,
  computeConcentration, detectConcentrationSignals, detectStructureSignals, addMonths, CONCENTRATION_TESTS, CONCENTRATION_NOTE, STRUCTURE_SIGNAL_KINDS } from './metrics.mjs';
import { buildCard } from './candidates.mjs';

const PLACEHOLDER = /\[confirm/i;
const SECTORS = ['hospitality', 'multifamily', 'retail'];
export const AXES = ['distress', 'fit', 'timing'];
const PROFILE_MEASURES = ['buyboxCreShare', 'buyboxShareOfLoans', 'buyboxNoncurrentRatio'];
const PROFILE_LABELS = { buyboxCreShare: 'Share of the CRE book in categories the buy box buys', buyboxShareOfLoans: 'Share of net loans in CRE categories the buy box buys', buyboxNoncurrentRatio: 'Noncurrent ratio in the categories the buy box buys' };
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const round = (x, d = 2) => Math.round(x * 10 ** d) / 10 ** d;

// Stable JSON (sorted keys) so a hash changes only when content does.
const stable = (v) => (Array.isArray(v) ? `[${v.map(stable).join(',')}]` : isObj(v) ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}` : JSON.stringify(v));
export const contentHash = (obj) => createHash('sha256').update(stable(obj)).digest('hex').slice(0, 16);

// Paths of every value still holding a [CONFIRM] placeholder ("_note" keys are ignored).
export function findPlaceholders(v, path = '') {
  if (typeof v === 'string') return PLACEHOLDER.test(v) ? [path || '(root)'] : [];
  if (Array.isArray(v)) return v.flatMap((x, i) => findPlaceholders(x, `${path}[${i}]`));
  if (isObj(v)) return Object.entries(v).filter(([k]) => !k.startsWith('_')).flatMap(([k, x]) => findPlaceholders(x, path ? `${path}.${k}` : k));
  return [];
}

// { ok, placeholders: [path], errors: [message] }. ok means no errors and no placeholders.
export function validateBuybox(buybox, { metros } = {}) {
  const errors = [];
  if (!isObj(buybox)) return { ok: false, placeholders: [], errors: ['buybox.json is not an object'] };
  const inc = buybox.sectors?.include;
  if (!Array.isArray(inc) || !inc.length) errors.push('sectors.include must list at least one sector');
  else for (const s of inc) if (!SECTORS.includes(s)) errors.push(`sectors.include: unknown sector "${s}" (known: ${SECTORS.join(', ')})`);
  if (!Array.isArray(buybox.metros) || !buybox.metros.length) errors.push('metros must list at least one CBSA code');
  else {
    const known = new Set((metros?.metros ?? []).map((m) => m.cbsa));
    for (const c of buybox.metros) {
      if (typeof c !== 'string' || !/^\d{5}$/.test(c)) errors.push(`metros: "${c}" is not a 5-digit CBSA code string`);
      else if (metros && !known.has(c)) errors.push(`metros: ${c} is not in metros.json`);
    }
  }
  const cap = buybox.filters?.maxAssetsThousands;
  if (!(typeof cap === 'number' && cap > 0)) errors.push('filters.maxAssetsThousands must be a positive number (thousands of dollars)');
  for (const k of ['loanSize', 'statuses', 'lien', 'exclusions']) if (!(k in buybox)) errors.push(`${k} is missing`);
  const placeholders = findPlaceholders(buybox);
  return { ok: !errors.length && !placeholders.length, placeholders, errors };
}

export function validateScoring(scoring) {
  const errors = [];
  if (!isObj(scoring)) return { ok: false, errors: ['scoring.json is not an object'] };
  const ids = new Set();
  for (const c of scoring.components ?? []) {
    if (!c.id || ids.has(c.id)) errors.push(`component id "${c.id}" is missing or duplicated`);
    ids.add(c.id);
    if (!AXES.includes(c.axis)) errors.push(`component ${c.id}: axis must be one of ${AXES.join(', ')}`);
    if (c.source === 'footprint') { /* deposit share from the Summary of Deposits */ }
    else if (c.source === 'profile') { if (!PROFILE_MEASURES.includes(c.measure)) errors.push(`component ${c.id}: unknown profile measure "${c.measure}" (known: ${PROFILE_MEASURES.join(', ')})`); }
    else if (c.source !== undefined) errors.push(`component ${c.id}: unknown source "${c.source}"`);
    else if (!METRICS[c.metric]) errors.push(`component ${c.id}: unknown metric "${c.metric}"`);
    if (c.change !== undefined && !['qoq', 'yoy'].includes(c.change)) errors.push(`component ${c.id}: change must be qoq or yoy`);
    if (!(typeof c.weight === 'number' && c.weight >= 0)) errors.push(`component ${c.id}: weight must be a number of 0 or more`);
    if (!(typeof c.full === 'number' && c.full > 0)) errors.push(`component ${c.id}: full must be a positive number`);
  }
  if (!(scoring.components ?? []).length) errors.push('no components');
  for (const ax of AXES) if (!(scoring.components ?? []).some((c) => c.axis === ax)) errors.push(`no component on the ${ax} axis`);
  const A = scoring.tiers?.A ?? {}; const B = scoring.tiers?.B ?? {};
  const n = (x) => typeof x === 'number' && x >= 0;
  if (!(n(A.score) && n(B.score) && A.score > B.score)) errors.push('tiers.A.score and tiers.B.score must be numbers with A > B >= 0');
  if (!(n(A.distress) && n(A.fit))) errors.push('tiers.A.distress and tiers.A.fit must be numbers of 0 or more (Tier A needs both)');
  // Every signal type declares its kind (state or event), and the kind must match how the code computes it.
  const sids = new Set();
  const signalId = (r, kind) => {
    if (!r.id || sids.has(r.id)) errors.push(`signal id "${r.id}" is missing or duplicated`);
    sids.add(r.id);
    if (r.kind !== kind) errors.push(`signal ${r.id}: kind must be "${kind}" (got ${r.kind === undefined ? 'none' : `"${r.kind}"`}); every signal type declares whether it is a state or an event signal`);
    if (!r.label) errors.push(`signal ${r.id}: no label`);
  };
  for (const r of scoring.signals ?? []) {
    signalId(r, 'state');
    if (!SIGNAL_TYPES.includes(r.type)) errors.push(`signal ${r.id}: unknown type "${r.type}"`);
    if (!METRICS[r.metric]) errors.push(`signal ${r.id}: unknown metric "${r.metric}"`);
    if (['above', 'changeAbove'].includes(r.type) && typeof r.threshold !== 'number') errors.push(`signal ${r.id}: threshold must be a number`);
  }
  for (const r of scoring.concentration?.signals ?? []) {
    signalId(r, 'state');
    if (!CONCENTRATION_TESTS.includes(r.test)) errors.push(`signal ${r.id}: unknown concentration test "${r.test}" (known: ${CONCENTRATION_TESTS.join(', ')})`);
    if (!(typeof r.threshold === 'number' && r.threshold > 0)) errors.push(`signal ${r.id}: threshold must be a positive number (a fraction: 1 = 100%)`);
    if (r.test === 'cre' && !(typeof r.growthThreshold === 'number' && r.growthThreshold > 0)) errors.push(`signal ${r.id}: growthThreshold must be a positive number`);
  }
  for (const r of scoring.structureEvents?.signals ?? []) {
    signalId(r, 'event');
    if (r.type !== 'acquisition') errors.push(`signal ${r.id}: unknown structure-event type "${r.type}" (known: acquisition)`);
    if (!(Number.isInteger(r.windowQuarters) && r.windowQuarters >= 1)) errors.push(`signal ${r.id}: windowQuarters must be a whole number of 1 or more`);
    if (!Array.isArray(r.kinds) || !r.kinds.length || r.kinds.some((k) => !STRUCTURE_SIGNAL_KINDS.includes(k))) errors.push(`signal ${r.id}: kinds must list one or more of ${STRUCTURE_SIGNAL_KINDS.join(', ')}`);
  }
  const fw = scoring.failedBanks?.windowQuarters;
  if (fw !== undefined && !(Number.isInteger(fw) && fw >= 1)) errors.push('failedBanks.windowQuarters must be a whole number of 1 or more');
  return { ok: !errors.length, errors };
}

const fmtK = (v) => `$${Number(v).toLocaleString('en-US')} thousand`;

// Hard filters, applied before tiering. Returns the reasons a bank fails (empty = passes).
export function hardFilters({ institution, footprint, buybox, assets, latestRepdte, bankLatest }) {
  const out = [];
  const status = institution?.status ?? (Number(institution?.ACTIVE) === 1 ? 'active' : 'inactive');
  // A failed or closed bank is never a candidate, whatever its score (the guard's "do not approach" rule).
  if (status === 'failed') out.push('failed bank');
  else if (status !== 'active' || ((buybox.filters?.requireActive ?? true) && Number(institution?.ACTIVE) !== 1)) out.push(`no longer active (status: ${status})`);
  if (institution?.inUniverse === false) out.push(`no longer in the market bank list${institution.leftOn ? ` (left on ${institution.leftOn})` : ''}`);
  const cap = buybox.filters?.maxAssetsThousands;
  if (cap && assets !== null && assets !== undefined && Number(assets) > cap) out.push(`total assets ${fmtK(assets)} are above the cap of ${fmtK(cap)}`);
  if (!inBuyboxMetros(footprint, buybox, institution)) out.push('no branch in a buy-box metro');
  if (!bankLatest) out.push('no financial data');
  else if (latestRepdte && bankLatest !== latestRepdte) out.push(`no report for the latest quarter (${periodLabel(latestRepdte)}); latest on file is ${periodLabel(bankLatest)}`);
  return out;
}

const inBuyboxMetros = (footprint, buybox, institution) => (buybox.metros ?? []).some((c) => Number(footprint?.branchesByMetro?.[c] ?? 0) > 0) || !!institution?.via?.hq;

// ---- The paper profile (E6-S6) --------------------------------------------------------------------------------------------------
export const PROFILE_LIMITS = [
  'Hotel and retail loans are inside nonfarm nonresidential, together with office, industrial and other commercial property; Call Report data cannot separate them.',
  'Call Report data gives balances and stages of distress by category. It shows no individual loans, loan sizes, maturities or properties.',
  'Branches and deposits show where a bank takes deposits, not exactly where it lends. They are a proxy for its lending footprint.',
  'Construction loans 30 to 89 and 90 or more days past due are not in the fields pulled; noncurrent and nonaccrual are.',
];

const direction = (from, to, threshold) => (from === null || to === null ? 'unknown' : to - from > threshold ? 'rising' : from - to > threshold ? 'falling' : 'flat');

export function buildProfile({ financials, footprint = {}, institution = {}, buybox, metros, scoring = {} }) {
  const reps = Object.keys(financials?.quarters ?? {}).sort();
  const L = reps.at(-1) ?? null;
  const threshold = scoring.profile?.directionThreshold ?? 0.001;
  const labelOf = (c) => metros?.metros?.find((m) => m.cbsa === c)?.label ?? `CBSA ${c}`;
  const footprintOut = profileFootprint({ footprint, buybox, metros, labelOf });
  if (!L) return { period: null, categories: [], footprint: footprintOut, limits: ['No financial data on file for this bank.', ...PROFILE_LIMITS] };
  const q = financials.quarters[L];
  const L4 = shiftQuarter(L, -4);
  const q4 = financials.quarters[L4];
  const v = (rec, f) => num(rec?.[f]);
  const baseFields = CATEGORIES.map((c) => c.balance);
  const baseVals = baseFields.map((f) => v(q, f));
  const creBase = baseVals.some((x) => x === null) ? null : baseVals.reduce((s, x) => s + x, 0);
  const metroOk = inBuyboxMetros(footprint, buybox, institution);
  const include = buybox.sectors?.include ?? [];
  const categories = CATEGORIES.map((cat) => {
    const bal = v(q, cat.balance);
    const stages = {};
    for (const [k, f] of Object.entries(cat.stages)) {
      if (!f) { stages[k] = { field: null, repdte: L, value: null, note: 'no field for this stage in the data pulled' }; continue; }
      const val = v(q, f);
      stages[k] = { field: f, repdte: L, value: val, ratio: val !== null && bal > 0 ? val / bal : null };
    }
    const ratio = stages.noncurrent.ratio;
    const bal4 = v(q4, cat.balance); const nc4 = v(q4, cat.stages.noncurrent);
    const ratio4 = bal4 > 0 && nc4 !== null ? nc4 / bal4 : null;
    const bought = cat.sectors.filter((s) => include.includes(s));
    const buys = bought.length > 0 && metroOk;
    const reason = !cat.sectors.length ? 'not a buy-box sector'
      : !bought.length ? `the buy box does not include ${cat.sectors.join(' or ')}`
      : !metroOk ? 'no branch in a buy-box metro'
      : cat.sectors.length > 1 ? `may hold ${bought.join(' or ')} loans in the bank's metros; the data cannot say how much`
      : `the buy box buys ${bought.join(', ')} loans in the bank's metros`;
    return {
      id: cat.id, label: cat.label, short: cat.short, sectors: cat.sectors,
      balance: { field: cat.balance, repdte: L, value: bal },
      shareOfCre: { value: bal !== null && creBase > 0 ? bal / creBase : null, fields: baseFields, repdte: L },
      stages,
      noncurrentRatio: ratio,
      direction4q: { measure: 'noncurrent ratio', from: { repdte: L4, value: ratio4, fields: [cat.stages.noncurrent, cat.balance] }, to: { repdte: L, value: ratio, fields: [cat.stages.noncurrent, cat.balance] }, direction: direction(ratio4, ratio, threshold) },
      fit: { buys, sectors: bought, reason },
      ...(cat.split ? { split: cat.split.map((s) => { const b = v(q, s.balance); const nc = v(q, s.noncurrent); return { id: s.id, label: s.label, balance: { field: s.balance, repdte: L, value: b }, noncurrent: { field: s.noncurrent, repdte: L, value: nc }, noncurrentRatio: b > 0 && nc !== null ? nc / b : null }; }) } : {}),
    };
  });
  return { period: L, creLoans: { fields: baseFields, repdte: L, value: creBase }, netLoans: { field: 'LNLSNET', repdte: L, value: v(q, 'LNLSNET') }, categories, footprint: footprintOut,
    concentration: concentrationProfile(financials, scoring), limits: [...PROFILE_LIMITS] };
}

// The concentration screen's ratios for the paper profile (E3-S7). Every number carries its fields and report date, and every ratio
// names the denominator it used. `meets` is null when a value is missing; the thresholds come from scoring.json.
export function concentrationProfile(financials, scoring = {}) {
  const c = computeConcentration(financials);
  if (!c.repdte || !c.denominator) return null;
  const rule = (t) => (scoring.concentration?.signals ?? []).find((r) => r.test === t) ?? null;
  const den = c.denominator;
  const missing = (x) => (x.reason ? { missing: x.reason } : {});
  const at = (x, th) => (x === null || x === undefined || typeof th !== 'number' ? null : x >= th);
  const cons = rule('construction'); const cre = rule('cre');
  // Test (b) needs both parts: it fails if either part fails, and is unknown if either is unknown and neither fails.
  const parts = [at(c.cre.value, cre?.threshold), at(c.growth.value, cre?.growthThreshold)];
  const creMeets = parts.includes(false) ? false : parts.includes(null) ? null : true;
  return {
    period: c.repdte, note: CONCENTRATION_NOTE,
    denominator: { basis: den.basis, label: den.label, value: den.value, inputs: den.inputs, ...missing(den) },
    constructionToCapital: { value: c.construction.value, inputs: c.construction.inputs, denominator: den.label, ...missing(c.construction) },
    creToCapital: { value: c.cre.value, balance: c.cre.balance ?? null, inputs: c.cre.inputs, denominator: den.label, ...missing(c.cre) },
    creGrowth36m: { value: c.growth.value, from: c.growth.from, to: c.growth.to, ...missing(c.growth) },
    screen: {
      construction: cons ? { threshold: cons.threshold, meets: at(c.construction.value, cons.threshold) } : null,
      cre: cre ? { threshold: cre.threshold, growthThreshold: cre.growthThreshold, meets: creMeets } : null,
    },
    creDefinition: 'construction and land development + multifamily + nonfarm nonresidential not owner-occupied + CRE loans not secured by real estate (LNRECONS + LNREMULT + LNRENROT + LNCOMRE)',
  };
}

function profileFootprint({ footprint, buybox, metros, labelOf }) {
  const raw = footprint?.sod ?? null;
  // A Summary of Deposits record whose total is 0, missing, or smaller than its metro deposits cannot give a share; fit then rests on branches only.
  const metroSum = Object.values(raw?.depositsByMetro ?? {}).reduce((s, x) => s + (num(x) ?? 0), 0);
  const usable = raw && num(raw.totalDeposits) > 0 && metroSum <= num(raw.totalDeposits);
  const sod = usable ? raw : null;
  const sodNote = !raw ? 'No Summary of Deposits on file; fit rests on branches only.' : !usable ? `The Summary of Deposits record for ${raw.year} is incomplete (total deposits ${num(raw.totalDeposits) ?? 'missing'}, metro deposits ${metroSum}); fit rests on branches only.` : null;
  const total = num(sod?.totalDeposits);
  const rep = sod?.year ? `${sod.year}0630` : null;
  const order = (metros?.metros ?? []).map((m) => m.cbsa);
  const codes = [...new Set([...order, ...Object.keys(footprint?.branchesByMetro ?? {}), ...Object.keys(sod?.depositsByMetro ?? {})])]
    .filter((c) => (buybox.metros ?? []).includes(c) || num(footprint?.branchesByMetro?.[c]) > 0);
  const list = codes.map((c) => {
    const dep = num(sod?.depositsByMetro?.[c]);
    return { cbsa: c, label: labelOf(c), inBuybox: (buybox.metros ?? []).includes(c),
      branches: { value: num(footprint?.branchesByMetro?.[c]) ?? 0, source: 'FDIC /locations, count of branch records', fetchedAt: footprint?._source?.fetchedAt ?? null },
      deposits: sod ? { field: 'DEPSUMBR', repdte: rep, value: dep ?? 0 } : null,
      depositShare: sod && total > 0 ? (dep ?? 0) / total : null };
  });
  const inBox = list.filter((m) => m.inBuybox).reduce((s, m) => s + (m.deposits?.value ?? 0), 0);
  return { metros: list, sodYear: sod?.year ?? null, totalDeposits: sod ? { field: 'DEPSUMBR', repdte: rep, value: total, note: 'all branches' } : null, buyboxDepositShare: sod && total > 0 ? inBox / total : null, ...(sodNote ? { note: sodNote } : {}) };
}

// ---- Components and the score (E6-S2) -------------------------------------------------------------------------------------------
function profileMeasure(measure, profile) {
  const bought = profile.categories.filter((c) => c.fit.buys);
  const L = profile.period;
  if (!L) return { value: null, reason: 'no financial data', inputs: [] };
  const balIn = (c) => ({ field: c.balance.field, repdte: L, value: c.balance.value });
  if (measure === 'buyboxCreShare') {
    const inputs = profile.categories.map(balIn);
    if (profile.creLoans.value === null) return { value: null, reason: `missing ${profile.creLoans.fields.join(' or ')}`, inputs };
    if (profile.creLoans.value === 0) return { value: null, reason: `zero denominator: ${profile.creLoans.fields.join(' + ')} is 0`, inputs };
    return { value: bought.reduce((s, c) => s + (c.balance.value ?? 0), 0) / profile.creLoans.value, inputs };
  }
  if (measure === 'buyboxShareOfLoans') {
    const nl = profile.netLoans;
    const inputs = [...bought.map(balIn), nl];
    if (nl.value === null) return { value: null, reason: 'missing LNLSNET', inputs };
    if (!(nl.value > 0)) return { value: null, reason: 'zero denominator: LNLSNET is 0', inputs };
    return { value: bought.reduce((s, c) => s + (c.balance.value ?? 0), 0) / nl.value, inputs };
  }
  // buyboxNoncurrentRatio: noncurrent loans over balances, in the categories the buy box buys only.
  const inputs = bought.flatMap((c) => [balIn(c), { field: c.stages.noncurrent.field, repdte: L, value: c.stages.noncurrent.value }]);
  if (!bought.length) return { value: null, reason: 'the buy box buys none of this bank\'s CRE categories in its metros', inputs };
  if (inputs.some((x) => x.value === null)) return { value: null, reason: `missing ${inputs.filter((x) => x.value === null).map((x) => x.field).join(', ')}`, inputs };
  const den = bought.reduce((s, c) => s + c.balance.value, 0);
  if (den === 0) return { value: null, reason: 'zero denominator: no balance in the categories the buy box buys', inputs };
  return { value: bought.reduce((s, c) => s + c.stages.noncurrent.value, 0) / den, inputs };
}

function component(c, { series, latestQ, profile }) {
  let value = null; let reason; let inputs = []; let label;
  if (c.source === 'footprint') {
    label = 'Share of deposits in the buy-box metros';
    const fp = profile.footprint;
    value = fp.buyboxDepositShare;
    reason = value === null ? (fp.note ?? 'total deposits are 0') : undefined;
    inputs = fp.totalDeposits ? [...fp.metros.filter((m) => m.inBuybox && m.deposits?.value > 0).map((m) => ({ ...m.deposits, note: `branches in ${m.label}` })), fp.totalDeposits] : [];
  } else if (c.source === 'profile') {
    label = PROFILE_LABELS[c.measure];
    const pm = profileMeasure(c.measure, profile);
    ({ value, inputs, reason } = pm);
  } else {
    const m = METRICS[c.metric];
    label = c.change ? `${m.label}, change from ${c.change === 'qoq' ? 'the prior quarter' : 'four quarters earlier'}` : m.label;
    if (!latestQ) reason = 'no financial data';
    else if (c.change) {
      value = latestQ.changes?.[c.metric]?.[c.change] ?? null;
      reason = value === null ? latestQ.changeReasons?.[`${c.metric}.${c.change}`] : undefined;
      const prevQ = series.quarters.find((q) => q.repdte === shiftQuarter(latestQ.repdte, c.change === 'qoq' ? -1 : -4));
      inputs = [...(prevQ ? prevQ.inputs[c.metric].map((x) => ({ ...x, repdte: prevQ.repdte })) : []), ...latestQ.inputs[c.metric].map((x) => ({ ...x, repdte: latestQ.repdte }))];
    } else {
      value = latestQ.values[c.metric];
      reason = value === null ? latestQ.reasons[c.metric] : undefined;
      inputs = latestQ.inputs[c.metric].map((x) => ({ ...x, repdte: latestQ.repdte }));
    }
  }
  const points = value === null ? 0 : round(c.weight * Math.min(Math.max(value / c.full, 0), 1));
  return { id: c.id, axis: c.axis, metric: c.metric ?? c.measure ?? c.source ?? null, change: c.change ?? null, label, value, weight: c.weight, points, inputs, ...(reason ? { missing: reason } : {}) };
}

// Tier A needs the total AND meaningful distress AND meaningful fit; either alone is not enough. Tier B needs the total only.
export function tierFor({ score, axes, filtersFailed, tiers }) {
  if (filtersFailed.length) return { tier: null, note: `fails hard filters: ${filtersFailed.join('; ')}` };
  const A = tiers.A; const B = tiers.B;
  const missA = [];
  if (score < A.score) missA.push(`score ${score} is below ${A.score}`);
  if (axes.distress < A.distress) missA.push(`distress ${axes.distress} is below ${A.distress}`);
  if (axes.fit < A.fit) missA.push(`fit ${axes.fit} is below ${A.fit}`);
  if (!missA.length) return { tier: 'A', note: 'meets the Tier A score, distress and fit thresholds' };
  if (score >= B.score) return { tier: 'B', note: `not Tier A: ${missA.join('; ')}` };
  return { tier: null, note: `score ${score} is below the Tier B threshold of ${B.score}` };
}

// Scores one bank. Deterministic: no clock, no randomness, no model. `events` are the stored structure events where this bank is the
// acquirer; `asOf` (YYYY-MM-DD) is the scoring date that decides which event signals are still in their window.
export function scoreBank({ cert, institution = {}, footprint = {}, financials, scoring, buybox, metros, latestRepdte, events = [], asOf = null }) {
  const fin = financials ?? { CERT: cert, quarters: {} };
  const series = computeMetrics(fin);
  const latestQ = series.quarters.at(-1) ?? null;
  // State signals from the metrics and the concentration screen, recomputed from the latest quarter; then event signals, kept by date.
  const signals = [
    ...detectSignals(series, scoring.signals ?? []),
    ...detectConcentrationSignals(computeConcentration(fin), scoring.concentration?.signals ?? [], String(cert)),
    ...detectStructureSignals({ cert: String(cert), events, rules: scoring.structureEvents?.signals ?? [], asOf }),
  ];
  const profile = buildProfile({ financials: fin, footprint, institution, buybox, metros, scoring });
  const components = (scoring.components ?? []).map((c) => component(c, { series, latestQ, profile }));
  const score = round(components.reduce((s, c) => s + c.points, 0));
  const axes = Object.fromEntries(AXES.map((ax) => [ax, round(components.filter((c) => c.axis === ax).reduce((s, c) => s + c.points, 0))]));
  const assets = num(latestQ ? (fin.quarters[latestQ.repdte]?.ASSET ?? institution.ASSET) : institution.ASSET);
  const filtersFailed = hardFilters({ institution, footprint, buybox, assets, latestRepdte, bankLatest: series.latest });
  const { tier, note } = tierFor({ score, axes, filtersFailed, tiers: scoring.tiers });
  const labelOf = (c) => metros?.metros?.find((m) => m.cbsa === c)?.label ?? `CBSA ${c}`;
  const metroCodes = (buybox.metros ?? []).filter((c) => Number(footprint?.branchesByMetro?.[c] ?? 0) > 0);
  const labeled = signals.map((s) => (s.rule === 'acquisition' ? { ...s, metros: s.metros.map((m) => ({ ...m, label: labelOf(m.cbsa) })) } : s));
  const item = {
    key: `fdic:${cert}`, cert: String(cert), name: institution.NAME ?? '', city: institution.CITY ?? '', state: institution.STALP ?? '', via: institution.via ?? {},
    metros: metroCodes, metroLabels: metroCodes.map(labelOf), assets, tier, tierNote: note, score, axes, filtersFailed,
    profile, components, signals: labeled, card: null, latestRepdte: series.latest, sectors: [...(buybox.sectors?.include ?? [])],
    metricsLatest: latestQ ? { ...latestQ.values } : {},
  };
  item.card = buildCard(item, { scoring });
  return item;
}

const byScore = (a, b) => (b.score - a.score) || (a.cert < b.cert ? -1 : a.cert > b.cert ? 1 : 0);

// Failed banks with a presence in the six metros (E3-S5), listed beside the candidates. They are never candidates: the bank is gone,
// and the FDIC sells its loans. Listed for `failedBanks.windowQuarters` after the failure. Each says which FDIC sources agree.
export function listFailedBanks({ failed = {}, scoring = {}, metros, asOf }) {
  const months = (scoring.failedBanks?.windowQuarters ?? 8) * 3;
  const from = asOf ? addMonths(asOf, -months) : null;
  const labelOf = (c) => metros?.metros?.find((m) => m.cbsa === c)?.label ?? `CBSA ${c}`;
  return Object.values(failed).filter((f) => f?.inMetros && f.failedOn && (!from || (f.failedOn > from && f.failedOn <= asOf)))
    .sort((a, b) => (a.failedOn < b.failedOn ? 1 : a.failedOn > b.failedOn ? -1 : Number(a.cert) - Number(b.cert)))
    .map((f) => ({ key: `fdic:${f.cert}`, cert: f.cert, name: f.name ?? '', failedOn: f.failedOn, agree: f.agree ?? [], missingFrom: f.missingFrom ?? [], acquirerCert: f.acquirerCert ?? null,
      metros: (f.metros ?? []).map((m) => ({ ...m, label: labelOf(m.cbsa) })), lastCre: f.lastCre ?? null, seller: 'FDIC', loanSales: f.loanSales,
      note: 'The bank failed, so the FDIC is the seller of its loans, usually in sealed-bid pools. See the FDIC loan-sale page.' }));
}

// Reads sources/fdic/*, scores every bank, writes candidates/latest.json. Refuses on a buy box with [CONFIRM] placeholders unless
// allowPlaceholders is set, in which case the output is marked provisional and lists the unfilled fields.
export function runScoring({ dir, buybox, scoring, metros, now = new Date(), allowPlaceholders = false }) {
  const vb = validateBuybox(buybox, { metros });
  if (vb.errors.length) throw new Error(`buybox.json has errors:\n  ${vb.errors.join('\n  ')}`);
  if (vb.placeholders.length && !allowPlaceholders) throw new Error(`buybox.json still has [CONFIRM] placeholders, so scoring will not run. A principal must fill:\n  ${vb.placeholders.join('\n  ')}\n(To see a provisional list anyway, use --draft-buybox; it is labeled PROVISIONAL.)`);
  const vs = validateScoring(scoring);
  if (!vs.ok) throw new Error(`scoring.json has errors:\n  ${vs.errors.join('\n  ')}`);
  const base = join(dir, 'sources', 'fdic');
  const institutions = readJson(join(base, 'institutions.json'), null);
  if (!institutions) throw new Error('No FDIC data yet (sources/fdic/institutions.json is missing). Run the FDIC adapter first: outbound sources run fdic');
  const footprints = readJson(join(base, 'footprint.json'), {});
  const finDir = join(base, 'financials');
  const fin = new Map(listFiles(finDir, '.json').map((f) => [f.replace(/\.json$/, ''), readJson(join(finDir, f))]));
  const latestRepdte = [...fin.values()].flatMap((f) => Object.keys(f?.quarters ?? {})).sort().at(-1) ?? null;
  const certs = [...new Set([...Object.keys(institutions), ...fin.keys()])].sort();
  const asOf = now.toISOString().slice(0, 10);
  const eventsBy = new Map();
  for (const e of Object.values(readJson(join(base, 'events.json'), {}))) if (e?.acquirerCert) { const k = String(e.acquirerCert); if (!eventsBy.has(k)) eventsBy.set(k, []); eventsBy.get(k).push(e); }
  const items = certs.map((cert) => scoreBank({ cert, institution: institutions[cert] ?? {}, footprint: footprints[cert] ?? {}, financials: fin.get(cert) ?? null, scoring, buybox, metros, latestRepdte, events: eventsBy.get(cert) ?? [], asOf })).sort(byScore);
  const failedBanks = listFailedBanks({ failed: readJson(join(base, 'failed.json'), {}), scoring, metros, asOf });
  const runId = `score-${now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}`;
  const out = { runId, scoredAt: now.toISOString(), asOf, latestRepdte, buyboxHash: contentHash(buybox), scoringHash: contentHash(scoring), provisional: vb.placeholders.length > 0, placeholders: vb.placeholders, items, failedBanks };
  writeJson(join(dir, 'candidates', 'latest.json'), out);
  audit(dir, { type: 'scoring_run', runId, banks: items.length, tierA: items.filter((i) => i.tier === 'A').length, tierB: items.filter((i) => i.tier === 'B').length, provisional: out.provisional, latestRepdte });
  return out;
}
