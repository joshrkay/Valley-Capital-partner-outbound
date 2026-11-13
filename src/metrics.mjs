// Bank distress metrics from FDIC Call Report data (PRD E3-S3, E3-S4, Appendix A). Pure functions: no files, no network, no model.
// Inputs are the per-quarter records the FDIC adapter stores (sources/fdic/financials/<CERT>.json), amounts in thousands of dollars as reported.
// Every ratio is computed here, in code. A missing input or a zero denominator gives null with a reason, never 0.
// Flows (charge-offs) come only from FDIC's quarterly *Q fields; the year-to-date fields are never compared quarter to quarter.

const QEND = ['0331', '0630', '0930', '1231'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const CRE_BASE = ['LNRENRES', 'LNREMULT', 'LNRECONS'];
const CRE_OREO = ['ORENRES', 'OREMULT', 'ORECONS'];
const CRE_NCO_Q = ['NTRENRSQ', 'NTREMULQ', 'NTRECONQ'];

// "CRE" = construction and land development + multifamily + nonfarm nonresidential. Hotel and retail loans sit inside nonfarm
// nonresidential and cannot be separated in Call Report data; multifamily has its own line and is also shown on its own.
export const METRICS = {
  creLoans: { label: 'CRE loans', kind: 'amount', num: CRE_BASE },
  creNoncurrentRatio: { label: 'CRE noncurrent ratio', kind: 'ratio', num: ['NCRENRES', 'NCREMULT', 'NCRECONS'], den: CRE_BASE },
  creNonaccrualRatio: { label: 'CRE nonaccrual ratio', kind: 'ratio', num: ['NARENRES', 'NAREMULT', 'NARECONS'], den: CRE_BASE },
  earlyStageDelinquency: { label: 'Early-stage CRE delinquency (30 to 89 days past due)', kind: 'ratio', num: ['P3RENRES', 'P3REMULT'], den: ['LNRENRES', 'LNREMULT'] },
  creOreo: { label: 'Commercial foreclosed property (OREO)', kind: 'amount', num: CRE_OREO },
  creOreoRatio: { label: 'Commercial OREO to CRE loans', kind: 'ratio', num: CRE_OREO, den: CRE_BASE },
  creNetChargeOffs: { label: 'CRE net charge-offs this quarter', kind: 'amount', num: CRE_NCO_Q },
  creNetChargeOffRate: { label: 'CRE net charge-offs this quarter to CRE loans', kind: 'ratio', num: CRE_NCO_Q, den: CRE_BASE },
  investorCreShare: { label: 'Investor share of nonfarm nonresidential loans', kind: 'ratio', num: ['LNRENROT'], den: ['LNRENRES'] },
  creShareOfLoans: { label: 'CRE loans as a share of net loans', kind: 'ratio', num: CRE_BASE, den: ['LNLSNET'] },
  mfNoncurrentRatio: { label: 'Multifamily noncurrent ratio', kind: 'ratio', num: ['NCREMULT'], den: ['LNREMULT'], sector: 'multifamily' },
  mfNonaccrualRatio: { label: 'Multifamily nonaccrual ratio', kind: 'ratio', num: ['NAREMULT'], den: ['LNREMULT'], sector: 'multifamily' },
  mfEarlyStageDelinquency: { label: 'Multifamily early-stage delinquency (30 to 89 days past due)', kind: 'ratio', num: ['P3REMULT'], den: ['LNREMULT'], sector: 'multifamily' },
};

// The CRE categories of the paper profile (PRD E6-S6), with the Call Report field for each balance and stage of distress.
// `null` = no field for that stage in the set pulled (PRD Appendix A). `sectors` = the buy-box sectors that category can contain:
// nonfarm nonresidential holds hotel AND retail (and office, industrial and other commercial property), which the data cannot separate.
export const CATEGORIES = [
  { id: 'construction', label: 'Construction and land development', short: 'Construction and land', balance: 'LNRECONS', sectors: [],
    stages: { pastDue30to89: null, pastDue90: null, nonaccrual: 'NARECONS', noncurrent: 'NCRECONS', oreo: 'ORECONS', chargeOffsQuarter: 'NTRECONQ' } },
  { id: 'multifamily', label: 'Multifamily', short: 'Multifamily', balance: 'LNREMULT', sectors: ['multifamily'],
    stages: { pastDue30to89: 'P3REMULT', pastDue90: 'P9REMULT', nonaccrual: 'NAREMULT', noncurrent: 'NCREMULT', oreo: 'OREMULT', chargeOffsQuarter: 'NTREMULQ' } },
  { id: 'nonfarmNonresidential', label: 'Nonfarm nonresidential (hotel, retail, office and other commercial property, not separable)', short: 'Nonfarm nonresidential', balance: 'LNRENRES', sectors: ['hospitality', 'retail'],
    stages: { pastDue30to89: 'P3RENRES', pastDue90: 'P9RENRES', nonaccrual: 'NARENRES', noncurrent: 'NCRENRES', oreo: 'ORENRES', chargeOffsQuarter: 'NTRENRSQ' },
    split: [{ id: 'ownerOccupied', label: 'Owner-occupied', balance: 'LNRENROW', noncurrent: 'NCRENROW' }, { id: 'other', label: 'Other (non-owner-occupied)', balance: 'LNRENROT', noncurrent: 'NCRENROT' }] },
];

// Every FDIC field a metric reads. The adapter must request at least these (plus the context fields in PRD Appendix A).
export const METRIC_FIELDS = [...new Set(Object.values(METRICS).flatMap((m) => [...m.num, ...(m.den ?? [])]))];

// ---- Quarter arithmetic on FDIC report dates (YYYYMMDD, always a calendar quarter end) ------------------------------------------
export function quarterIndex(repdte) {
  const s = String(repdte);
  const qi = QEND.indexOf(s.slice(4));
  if (!/^\d{8}$/.test(s) || qi < 0) throw new Error(`"${repdte}" is not a quarter-end report date (YYYY0331, 0630, 0930 or 1231).`);
  return Number(s.slice(0, 4)) * 4 + qi;
}
export const shiftQuarter = (repdte, n) => { const t = quarterIndex(repdte) + n; return `${Math.floor(t / 4)}${QEND[t % 4]}`; };
export const periodLabel = (repdte) => { const s = String(repdte); return `${MONTHS[Number(s.slice(4, 6)) - 1]} ${Number(s.slice(6, 8))}, ${s.slice(0, 4)}`; };
export const MONTH_NAMES = MONTHS;

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

// One quarter: { repdte, values: {metric: number|null}, reasons: {metric: why null}, inputs: {metric: [{field, value}]} }
export function computeQuarterMetrics(q, repdte = q?.REPDTE) {
  const values = {}; const reasons = {}; const inputs = {};
  for (const [id, m] of Object.entries(METRICS)) {
    const fields = [...m.num, ...(m.den ?? [])];
    inputs[id] = fields.map((f) => ({ field: f, value: num(q?.[f]) }));
    const missing = inputs[id].filter((x) => x.value === null || !Number.isFinite(x.value)).map((x) => x.field);
    if (missing.length) { values[id] = null; reasons[id] = `missing ${missing.join(', ')}`; continue; }
    const top = m.num.reduce((s, f) => s + num(q[f]), 0);
    if (m.kind === 'amount') { values[id] = top; continue; }
    const bottom = m.den.reduce((s, f) => s + num(q[f]), 0);
    if (bottom === 0) { values[id] = null; reasons[id] = `zero denominator: ${m.den.join(' + ')} is 0`; continue; }
    values[id] = top / bottom;
  }
  return { repdte: String(repdte), values, reasons, inputs };
}

// All quarters of one bank, oldest first, each with the change from the prior quarter and from four quarters earlier.
// A change needs both quarters present and both values non-null; otherwise it is null with a reason.
export function computeMetrics(file) {
  const cert = String(file?.CERT ?? '');
  const reps = Object.keys(file?.quarters ?? {}).filter((r) => { try { quarterIndex(r); return true; } catch { return false; } }).sort();
  const byRep = new Map(reps.map((r) => [r, computeQuarterMetrics(file.quarters[r], r)]));
  const quarters = reps.map((r) => {
    const cur = byRep.get(r);
    const changes = {}; const changeReasons = {};
    for (const id of Object.keys(METRICS)) {
      changes[id] = {};
      for (const [k, back] of [['qoq', 1], ['yoy', 4]]) {
        const prev = byRep.get(shiftQuarter(r, -back));
        if (!prev) { changes[id][k] = null; changeReasons[`${id}.${k}`] = `no data for ${shiftQuarter(r, -back)}`; continue; }
        if (cur.values[id] === null || prev.values[id] === null) { changes[id][k] = null; changeReasons[`${id}.${k}`] = `a value is missing (${cur.values[id] === null ? r : shiftQuarter(r, -back)})`; continue; }
        changes[id][k] = cur.values[id] - prev.values[id];
      }
    }
    return { ...cur, changes, changeReasons };
  });
  return { cert, quarters, latest: reps.at(-1) ?? null };
}

// ---- Signals --------------------------------------------------------------------------------------------------------------------
// Every signal type declares its kind (docs/data-sources.md, section 1):
//   state: holds while a condition holds, and is recomputed from each pull; it drops away when the condition ends.
//   event: records a dated change once and keeps it; it stays visible for a set window, whatever later pulls say.
// Every signal these functions return carries its `kind`.
export const SIGNAL_KINDS = ['state', 'event'];

// Rules live in scoring.json. Each is evaluated at the bank's latest quarter. A signal points to the quarter records behind it.
// These metric rules are all state signals.
//   rising:        the metric rose in each of the last `quarters` quarter-over-quarter steps
//   firstPositive: the metric is above 0 now and was 0 or below in each of the previous `lookback - 1` quarters (all must be known)
//   above:         the metric is at or above `threshold`
//   changeAbove:   the metric's change (`over`: qoq or yoy) is at or above `threshold`
export const SIGNAL_TYPES = ['rising', 'firstPositive', 'above', 'changeAbove'];

export function detectSignals(series, rules = []) {
  const out = [];
  const L = series?.latest;
  if (!L) return out;
  const byRep = new Map(series.quarters.map((q) => [q.repdte, q]));
  const val = (rep, metric) => byRep.get(rep)?.values?.[metric] ?? null;
  const ev = (reps) => reps.map((r) => `fdic:${series.cert}:${r}`);
  for (const rule of rules) {
    if (!METRICS[rule.metric]) throw new Error(`Signal rule "${rule.id}" uses unknown metric "${rule.metric}".`);
    let fired = null; let extra = {};
    if (rule.type === 'rising') {
      const n = rule.quarters ?? 1;
      const reps = Array.from({ length: n + 1 }, (_, i) => shiftQuarter(L, -(n - i)));
      const vs = reps.map((r) => val(r, rule.metric));
      if (vs.every((v) => v !== null) && vs.slice(1).every((v, i) => v > vs[i])) { fired = reps; extra = { quarters: n }; }
    } else if (rule.type === 'firstPositive') {
      const k = rule.lookback ?? 8;
      const reps = Array.from({ length: k }, (_, i) => shiftQuarter(L, -(k - 1 - i)));
      const vs = reps.map((r) => val(r, rule.metric));
      if (vs.every((v) => v !== null) && vs.at(-1) > 0 && vs.slice(0, -1).every((v) => v <= 0)) { fired = reps; extra = { lookback: k }; }
    } else if (rule.type === 'above') {
      const v = val(L, rule.metric);
      if (v !== null && v >= rule.threshold) { fired = [L]; extra = { threshold: rule.threshold }; }
    } else if (rule.type === 'changeAbove') {
      const over = rule.over === 'yoy' ? 'yoy' : 'qoq';
      const c = byRep.get(L)?.changes?.[rule.metric]?.[over];
      if (c !== null && c !== undefined && c >= rule.threshold) { fired = [shiftQuarter(L, over === 'yoy' ? -4 : -1), L]; extra = { over, change: c, threshold: rule.threshold }; }
    } else throw new Error(`Signal rule "${rule.id}" has unknown type "${rule.type}". Types: ${SIGNAL_TYPES.join(', ')}.`);
    // `rule`, `metric`, `value` and the extras let the card state the signal from a fixed template, without the rule's free-text label.
    if (fired) out.push({ id: `fdic:${series.cert}:${rule.id}:${L}`, type: rule.id, kind: 'state', label: rule.label, period: L, evidence: ev(fired), rule: rule.type, metric: rule.metric, value: val(L, rule.metric), ...extra });
  }
  return out;
}

// ---- The CRE concentration screen (PRD E3-S7) -----------------------------------------------------------------------------------
// The 2006 interagency guidance on concentrations in commercial real estate lending, AS WE UNDERSTAND IT. UNCONFIRMED: no primary source
// (the guidance text, an FDIC or OCC page, or the Federal Register) could be reached from the development environment on 2026-11-13, so
// this is from memory and docs/data-sources.md. Either test flags a bank:
//   (a) construction and land development loans at or above 100% of total risk-based capital; or
//   (b) CRE at or above 300% of total risk-based capital, AND CRE grown 50% or more over the prior 36 months.
// The guidance's CRE = construction and land development + multifamily + nonfarm nonresidential NOT owner-occupied + loans to finance CRE
// not secured by real estate. Owner-occupied nonfarm nonresidential is left out. The thresholds live in scoring.json.
// The fields, from FDIC's own definitions ("All Financial Reports", api.fdic.gov/banks/docs) and checked live on all 268 metro banks for
// June 30, 2026 and June 30, 2023: LNRECONS construction and land development; LNREMULT multifamily; LNRENROT other (non-owner-occupied)
// nonfarm nonresidential; LNCOMRE CRE loans not secured by real estate; RBC total risk-based capital (it equals RBCT1J + RBCT2, and
// RBC / risk-weighted assets equals FDIC's own total capital ratio, on every bank checked); RBCT1J tier 1 capital; LNATRES the allowance
// for credit losses on loans and leases; CBLRIND 1 for a bank that elected the community bank leverage ratio (CBLR).
// CBLR banks do not report total risk-based capital: FDIC sends RBC as 0 for them (all 72 such banks at June 30, 2026). For them the
// denominator is tier 1 capital plus the allowance, UBPR's approach. Every computed value says which denominator it used.
export const CONCENTRATION = Object.freeze({
  construction: ['LNRECONS'],
  cre: ['LNRECONS', 'LNREMULT', 'LNRENROT', 'LNCOMRE'],
  growthQuarters: 12,   // the guidance's 36 months; the FDIC adapter fetches exactly this one extra quarter
});
export const DENOMINATORS = Object.freeze({
  totalRiskBasedCapital: { label: 'total risk-based capital', fields: ['RBC'] },
  tier1PlusAllowance: { label: 'tier 1 capital plus the allowance for credit losses (the bank uses the community bank leverage ratio, so it reports no total risk-based capital)', fields: ['RBCT1J', 'LNATRES'] },
});
export const CONCENTRATION_FIELDS = [...new Set([...CONCENTRATION.cre, 'RBC', 'RBCT1J', 'LNATRES', 'CBLRIND'])];
export const CONCENTRATION_TESTS = ['construction', 'cre'];
export const CONCENTRATION_NOTE = 'The concentration screen follows the 2006 interagency guidance as we understand it. Its definition is unconfirmed: it has not been checked against the guidance text.';

// Which capital figure divides, for one quarter: total risk-based capital, or for a CBLR bank tier 1 capital plus the allowance.
export function concentrationDenominator(q, repdte) {
  const inp = (fields) => fields.map((f) => ({ field: f, repdte: String(repdte), value: num(q?.[f]) }));
  const flag = inp(['CBLRIND']);
  const cblr = flag[0].value;
  if (cblr === null) return { value: null, basis: null, label: null, inputs: flag, reason: 'missing CBLRIND, so the denominator cannot be chosen' };
  if (cblr !== 0 && cblr !== 1) return { value: null, basis: null, label: null, inputs: flag, reason: `CBLRIND is ${cblr}, not 0 or 1` };
  const basis = cblr === 1 ? 'tier1PlusAllowance' : 'totalRiskBasedCapital';
  const d = DENOMINATORS[basis];
  const inputs = [...flag, ...inp(d.fields)];
  const parts = inputs.slice(1);
  const missing = parts.filter((x) => x.value === null || !Number.isFinite(x.value)).map((x) => x.field);
  const out = { basis, label: d.label, inputs };
  if (missing.length) return { ...out, value: null, reason: `missing ${missing.join(', ')}` };
  const value = parts.reduce((s, x) => s + x.value, 0);
  if (!(value > 0)) return { ...out, value: null, reason: basis === 'totalRiskBasedCapital' ? 'RBC (total risk-based capital) is 0, though CBLRIND says the bank is not a CBLR bank; the denominator is unknown' : 'zero denominator: RBCT1J + LNATRES is not above 0' };
  return { ...out, value };
}

// The screen's ratios for one bank at `repdte` (default: its latest quarter). Fractions: 1 = 100%. Null with a reason, never 0.
export function computeConcentration(file, repdte) {
  const reps = Object.keys(file?.quarters ?? {}).sort();
  const L = repdte ? String(repdte) : reps.at(-1) ?? null;
  if (!L || !file?.quarters?.[L]) return { repdte: L, baseRepdte: null, denominator: null, reason: 'no financial data', construction: { value: null, reason: 'no financial data', inputs: [] }, cre: { value: null, reason: 'no financial data', inputs: [] }, growth: { value: null, reason: 'no financial data' } };
  const q = file.quarters[L];
  const B = shiftQuarter(L, -CONCENTRATION.growthQuarters);
  const qb = file.growthBase?.[B] ?? file.quarters?.[B] ?? null;
  const den = concentrationDenominator(q, L);
  const sum = (rec, fields, rep) => {
    const inputs = fields.map((f) => ({ field: f, repdte: rep, value: num(rec?.[f]) }));
    const missing = inputs.filter((x) => x.value === null || !Number.isFinite(x.value)).map((x) => x.field);
    return { inputs, value: missing.length ? null : inputs.reduce((s, x) => s + x.value, 0), reason: missing.length ? `missing ${missing.join(', ')}` : undefined };
  };
  const ratio = (s) => {
    if (s.value === null) return { value: null, reason: s.reason, inputs: s.inputs, denominator: den.basis };
    if (den.value === null) return { value: null, reason: `no denominator: ${den.reason}`, inputs: s.inputs, denominator: den.basis };
    return { value: s.value / den.value, balance: s.value, inputs: s.inputs, denominator: den.basis };
  };
  const cons = sum(q, CONCENTRATION.construction, L);
  const cre = sum(q, CONCENTRATION.cre, L);
  const base = qb ? sum(qb, CONCENTRATION.cre, B) : { inputs: [], value: null, reason: `no report for ${B} on file` };
  let growth;
  if (cre.value === null) growth = { value: null, reason: cre.reason };
  else if (base.value === null) growth = { value: null, reason: base.reason };
  else if (base.value === 0) growth = { value: null, reason: `zero base: CRE was 0 on ${B}` };
  else growth = { value: (cre.value - base.value) / base.value };
  return { repdte: L, baseRepdte: B, denominator: den, construction: ratio(cons), cre: ratio(cre),
    growth: { ...growth, from: { repdte: B, value: base.value, inputs: base.inputs }, to: { repdte: L, value: cre.value } } };
}

// State signals from scoring.json `concentration.signals`. Recomputed from the latest quarter on every scoring run: when a bank's ratio
// falls below the threshold, the signal is gone. Each carries the denominator it used.
//   test "construction": construction and land loans to capital at or above `threshold`
//   test "cre":          CRE to capital at or above `threshold`, AND 36-month CRE growth at or above `growthThreshold`
export function detectConcentrationSignals(conc, rules = [], cert) {
  const out = [];
  const L = conc?.repdte;
  if (!L || !conc.denominator) return out;
  const rec = (r) => `fdic:${cert}:${r}`;
  for (const rule of rules) {
    if (!CONCENTRATION_TESTS.includes(rule.test)) throw new Error(`Concentration rule "${rule.id}" has unknown test "${rule.test}". Tests: ${CONCENTRATION_TESTS.join(', ')}.`);
    const r = conc[rule.test];
    let fired = false; let extra = {}; let evidence = [rec(L)];
    if (rule.test === 'construction') fired = r.value !== null && r.value >= rule.threshold;
    else {
      const g = conc.growth.value;
      fired = r.value !== null && g !== null && r.value >= rule.threshold && g >= rule.growthThreshold;
      extra = { growth: g, growthThreshold: rule.growthThreshold, baseRepdte: conc.baseRepdte };
      evidence = [rec(conc.baseRepdte), rec(L)];
    }
    if (fired) out.push({ id: `fdic:${cert}:${rule.id}:${L}`, type: rule.id, kind: 'state', label: rule.label, period: L, evidence, rule: 'concentration', test: rule.test,
      value: r.value, threshold: rule.threshold, denominator: { basis: conc.denominator.basis, label: conc.denominator.label }, ...extra });
  }
  return out;
}

// ---- Structure events (PRD E3-S6) -----------------------------------------------------------------------------------------------
export const addMonths = (ymd, n) => {
  const [y, m, d] = String(ymd).split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
};
export const STRUCTURE_SIGNAL_KINDS = ['merger', 'assisted-merger', 'affiliate-reorganization', 'failure'];

// Event signals from scoring.json `structureEvents.signals`, from the stored events (sources/fdic/events.json). A signal attaches to the
// acquirer, carries the date the deal took effect and the target's FDIC cert, and stays visible for `windowQuarters` from that date,
// whatever the acquirer's numbers do. Its id is the deal's, so it is the same signal on every run. Only a target with a presence in
// the six metros counts. `asOf` is the scoring date (YYYY-MM-DD), passed in, so the result never depends on the clock.
export function detectStructureSignals({ cert, events = [], rules = [], asOf }) {
  const out = [];
  if (!asOf) return out;
  for (const rule of rules) {
    const months = Number(rule.windowQuarters) * 3;
    const from = addMonths(asOf, -months);
    for (const e of Array.isArray(events) ? events : Object.values(events)) {
      if (String(e.acquirerCert) !== String(cert) || !(rule.kinds ?? []).includes(e.kind) || !e.targetInMetros || !e.effective) continue;
      if (!(e.effective > from && e.effective <= asOf)) continue;
      out.push({ id: `fdic:${cert}:${rule.id}:${e.transnum}`, type: rule.id, kind: 'event', label: rule.label, period: e.effective, evidence: [`fdic-history:${e.transnum}`, `fdic:${e.targetCert}`],
        rule: 'acquisition', eventKind: e.kind, code: e.code, transnum: e.transnum, effective: e.effective, targetCert: e.targetCert,
        metros: (e.targetMetros ?? []).map((m) => ({ cbsa: m.cbsa, branches: m.branches ?? null, basis: m.basis ?? [] })), targetLastCre: e.targetLastCre ?? null,
        windowQuarters: Number(rule.windowQuarters), visibleUntil: addMonths(e.effective, months) });
    }
  }
  return out.sort((a, b) => (a.effective < b.effective ? 1 : a.effective > b.effective ? -1 : a.id < b.id ? -1 : 1));
}
