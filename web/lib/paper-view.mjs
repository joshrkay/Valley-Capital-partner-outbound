// The paper estimate's display (PRD E14-S1), kept pure so it can be tested without a server. The record comes from the engine's scoring
// run (src/paper.mjs), read as the document paper/fdic-<CERT>.json. Every value in it already carries its unit (dollars, a count or a
// share), as-of date, tier and sources; this file only turns those into text. Labels are fixed here or come from the record, which
// builds them from templates in code. Nothing is computed here: a number shown is a number stored.
import { period } from './format.mjs';

export const STATUS_LABELS = Object.freeze({
  'not-reported': 'not reported', 'not-pulled': 'not pulled', semiannual: 'not reported this quarter (semiannual)', 'not-on-file': 'not on file',
  null: 'no value from FDIC', unknown: 'unknown', 'structure-event': 'withheld (structure event)', 'zero-denominator': 'no ratio (zero base)', unclear: 'unclear',
});
// The three loan stages, in plain words (the glossary's labels), in the order a loan moves through them.
export const STAGES = Object.freeze([['pastDue30to89', '30 to 89 days late'], ['pastDue90', '90+ days late'], ['nonaccrual', 'Not accruing']]);
export const PAPER_CONTEXT = 'The paper estimate is for principals and the briefer only. It is an estimate from public reports, not the loan tape, and it never goes in a message.';

// A figure's basis, as the page marks it (D-UI1): reported figures carry no mark (the page says so once), observed ones are "Seen loan by
// loan", inferred ones are "Estimate". The record keeps every tier; this is only the label.
export function basisLabel(tier) {
  const t = String(tier ?? '').replace(/ bounds$/, '');
  return t === 'observed' ? 'Seen loan by loan' : t === 'inferred' ? 'Estimate' : '';
}
// The tier of a condition in the buy-box table, in plain words; a condition with no tier could not be measured.
export const tierName = (tier) => ({ reported: 'Reported', observed: 'Seen loan by loan', inferred: 'Estimate' }[tier] ?? 'Not measured: anywhere from none to all');

// The FDIC field codes behind a value, and its report date: "P3REMULT + P9REMULT · June 30, 2026". Shown only when the codes switch is on.
export function fieldCodes(v) {
  const src = v?.sources ?? [];
  const fields = [...new Set(src.map((s) => s.field).filter(Boolean))];
  if (!fields.length) return '';
  const reps = src.map((s) => String(s.repdte ?? '')).filter((r) => /^\d{8}$/.test(r)).sort();
  return [fields.join(' + '), reps.length ? period(reps.at(-1)) : ''].filter(Boolean).join(' · ');
}

// A gap's status as a short phrase that starts a sentence: "Not reported", "Not on file".
export const gapText = (v) => { const t = show(v).text; return t.charAt(0).toUpperCase() + t.slice(1); };

const isoToRep = (d) => String(d ?? '').replace(/-/g, '');
export const dateOf = (isoDate) => (/^\d{4}-\d{2}-\d{2}$/.test(String(isoDate ?? '')) ? period(isoToRep(isoDate)) : '');

// Whole dollars, short: $812.3M, $1.25B, $42,000.
export function usd(v) {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return '–';
  const n = Number(v), s = n < 0 ? '−' : '', a = Math.abs(n);
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1)}M`;
  return `${s}$${Math.round(a).toLocaleString('en-US')}`;
}
export function inUnit(x, unit) {
  if (x === null || x === undefined || !Number.isFinite(Number(x))) return '–';
  if (unit === 'usd') return usd(x);
  if (unit === 'pct') return `${(Number(x) * 100).toFixed(1)}%`;
  return Number(x).toLocaleString('en-US');
}

// "LNREMULT, June 30, 2026 (sources/fdic/financials/1.json)": the hover text for a value.
export function sourcesText(v) {
  return (v?.sources ?? []).map((s) => `${s.field}${/^\d{8}$/.test(String(s.repdte)) ? `, ${period(s.repdte)}` : ''} (${s.file})`).join('; ');
}

// One value as display parts: the number (or the gap's status), its tier and date, and its sources and method for hovering.
export function show(v) {
  if (!v || typeof v !== 'object') return { text: 'unknown', gap: true, tier: null, date: '', title: '' };
  if (v.status) return { text: STATUS_LABELS[v.status] ?? 'unknown', gap: true, tier: null, date: '', title: v.reason ?? '', reason: v.reason ?? '' };
  const bounds = 'low' in v && 'high' in v && v.low !== null && v.low !== undefined && v.high !== null && v.high !== undefined;
  if (!bounds && (v.value === null || v.value === undefined)) return { text: STATUS_LABELS[v.status] ?? 'unknown', gap: true, tier: null, date: '', title: v.reason ?? '', reason: v.reason ?? '' };
  const text = bounds ? `${inUnit(v.low, v.unit)} to ${inUnit(v.high, v.unit)}` : inUnit(v.value, v.unit);
  const date = v.period ? `${v.period.basis === 'year-to-date' ? 'year to date' : 'quarter'} to ${dateOf(v.period.to)}` : dateOf(v.asOf);
  return { text, gap: false, tier: bounds ? `${v.tier} bounds` : v.tier, date, title: [sourcesText(v), v.method ? `method: ${v.method}` : '', v.note ?? ''].filter(Boolean).join(' · ') };
}

// The value at a path such as "q7.sectors[0].bounds" (the summary's refs), or undefined. The same rule as the engine's paperAt.
export function at(record, ref) {
  let v = record;
  for (const part of String(ref ?? '').split(/[.[\]]+/).filter(Boolean)) { if (v === null || v === undefined) return undefined; v = v[/^\d+$/.test(part) ? Number(part) : part]; }
  return v;
}

// A share known as an interval: "0.0% to 60.0%", or one figure when it is exact.
export const shareText = (s) => (!s ? '–' : s.low === s.high ? inUnit(s.low, 'pct') : `${inUnit(s.low, 'pct')} to ${inUnit(s.high, 'pct')}`);

// A trend point's net change: the number, or its status (never "new lending").
export const pointText = (p, key) => (p?.[key] === null || p?.[key] === undefined ? (STATUS_LABELS[p?.[`${key}Status`]] ?? 'unknown') : usd(p[key]));
