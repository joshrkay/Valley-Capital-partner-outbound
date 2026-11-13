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
// Rules live in scoring.json. Each is evaluated at the bank's latest quarter. A signal points to the quarter records behind it.
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
    if (fired) out.push({ id: `fdic:${series.cert}:${rule.id}:${L}`, type: rule.id, label: rule.label, period: L, evidence: ev(fired), rule: rule.type, metric: rule.metric, value: val(L, rule.metric), ...extra });
  }
  return out;
}
