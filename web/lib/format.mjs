// Formatting for display. Pure functions; nothing here touches data sources.
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// FDIC report dates are YYYYMMDD strings.
export function period(repdte) {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(repdte ?? ''));
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : (repdte ? String(repdte) : '');
}

// FDIC amounts are in thousands of dollars.
export function moneyThousands(k) {
  if (k === null || k === undefined || Number.isNaN(Number(k))) return '–';
  const v = Number(k), s = v < 0 ? '−' : '', a = Math.abs(v);
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1)}B`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(1)}M`;
  return `${s}$${a.toFixed(0)}K`;
}

export function pct(v, digits = 2) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '–';
  return `${(Number(v) * 100).toFixed(digits)}%`;
}

// EDGAR amounts are in whole dollars.
export function moneyDollars(v) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '–';
  const n = Number(v), s = n < 0 ? '−' : '', a = Math.abs(n);
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(0)}K`;
  return `${s}$${a.toFixed(0)}`;
}

export const num =(v, digits = 1) => (v === null || v === undefined || Number.isNaN(Number(v)) ? '–' : Number(v).toFixed(digits));

// "LNREMULT, June 30, 2026": the source line shown next to (or on hover over) every FDIC number.
export function source(input) {
  if (!input) return '';
  const fields = input.fields ?? (input.field ? [input.field] : []);
  const when = input.repdte ? period(input.repdte) : '';
  return [fields.join(' + '), when].filter(Boolean).join(', ');
}

export const when = (iso) => (iso ? new Date(iso).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '');
