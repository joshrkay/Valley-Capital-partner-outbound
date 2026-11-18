// "Loans we can see" on the bank page, and the county rows on System status (docs/county-loans.md), kept pure so they can be tested
// without a server. It reads the bank's file (loans/banks/fdic-<CERT>.json, written by src/loans.mjs) and the watched counties
// (src/counties.mjs), and only picks and formats: every figure shown is one a document states, with its basis. Nothing here adds two
// amounts together, and nothing here holds a borrower or an address: the bank's file has none.
import { moneyDollars } from './format.mjs';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ymd = (s) => /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? '').slice(0, 10));
export const longDate = (s) => { const m = ymd(s); return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : ''; };
export const shortDate = (s) => { const m = ymd(s); return m ? `${SHORT[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : ''; };

export const LOANS_CONTEXT = 'Context for principals only. Never in a message, never given to a model, and never part of the score.';
// How an amount is known, in words. A document that states no amount says so; it is never shown as zero.
export const BASIS_WORDS = Object.freeze({ document: 'as stated on the document', index: 'from the county\'s index', 'not-stated': 'Not stated on the document', 'not-read': 'Not read yet' });
const ROLE_WORDS = Object.freeze({ lender: 'lender', beneficiary: 'lender', holder: 'holder', assignor: 'assigned the loan away', assignee: 'assigned the loan to it' });
// The date a row is known by (src/loans.mjs documentDate): filed, recorded, the date a notice itself states (a Texas notice of sale),
// or, when that could not be read, the sale date the notice gives.
export const DATE_KIND_WORDS = Object.freeze({ filed: 'Filed', recorded: 'Recorded', notice: 'Dated', sale: 'Sale' });

// Only a web address leaves the app: http or https. Anything else (javascript:, a bare path) is dropped.
export const safeLink = (u) => { try { const x = new URL(String(u ?? '')); return ['https:', 'http:'].includes(x.protocol) ? x.toString() : null; } catch { return null; } };

const stated = (a) => a && (a.basis === 'document' || a.basis === 'index') && Number.isFinite(Number(a.value)) && a.value !== null;
// The amounts of one document, each on its own line with its basis: the unpaid balance first when the document states one, then the
// original principal. A document that states neither gets one line saying so.
export function amountLines(amounts = {}) {
  const lines = [];
  for (const [k, label] of [['unpaidBalance', 'Unpaid balance'], ['originalPrincipal', 'Original principal']]) {
    const a = amounts?.[k];
    if (stated(a)) lines.push({ id: k, label, text: moneyDollars(a.value), basis: BASIS_WORDS[a.basis] });
  }
  if (lines.length) return lines;
  const basis = [amounts?.unpaidBalance?.basis, amounts?.originalPrincipal?.basis].includes('not-read') ? 'not-read' : 'not-stated';
  return [{ id: 'none', label: '', text: BASIS_WORDS[basis], basis: '' }];
}

// The basis of a document's amounts said once, when they share it ("As stated on the document"); each with its figure when they differ.
export function basisLine(lines = []) {
  const stated = lines.filter((a) => a.label);
  const bases = [...new Set(stated.map((a) => a.basis))];
  if (!bases.length) return '';
  const s = bases.length === 1 ? bases[0] : stated.map((a) => `${a.label.toLowerCase()} ${a.basis}`).join('; ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const roleText = (roles = []) => { const s = [...new Set(roles.map((r) => ROLE_WORDS[r] ?? r))].join(' and '); return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; };

// One row per document, newest first as the file stores them.
export function loanRows(bank) {
  return (bank?.loans ?? []).map((l) => ({
    id: l.id, type: l.typeLabel ?? l.documentType, documentNumber: l.documentNumber ?? '', county: l.countyLabel ?? `${l.county?.name ?? ''} County, ${l.state ?? ''}`,
    dateKind: DATE_KIND_WORDS[l.dateKind] ?? 'Recorded', date: longDate(l.date), short: shortDate(l.date), stage: l.stageLabel ?? '', saleDate: l.saleDate ? longDate(l.saleDate) : '',
    saleShort: l.saleDate ? shortDate(l.saleDate) : '', amounts: amountLines(l.amounts), basis: basisLine(amountLines(l.amounts)), propertyType: l.propertyTypeLabel ?? 'Not known yet', propertyKnown: !!l.propertyTypeLabel, role: roleText(l.roles),
    via: /through MERS/.test(String(l.how ?? '')) ? 'Named through MERS as nominee' : /alias/.test(String(l.how ?? '')) ? 'Matched by a principal\'s alias' : '',
    link: safeLink(l.link), deedOfTrust: l.deedOfTrust?.documentNumber ? `${l.deedOfTrust.documentNumber}${l.deedOfTrust.recorded ? `, recorded ${longDate(l.deedOfTrust.recorded)}` : ''}` : '',
  }));
}

const listWords = (xs) => (xs.length <= 1 ? xs.join('') : xs.length === 2 ? `${xs[0]} and ${xs[1]}` : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
// The watched counties in one line, each with when it was last read.
export function watchedLine(watched = []) {
  if (!watched.length) return 'No county is watched yet.';
  return `Watched: ${listWords(watched.map((w) => `${w.countyLabel}${w.lastOk?.ranAt ? ` (last read ${longDate(w.lastOk.ranAt)})` : ' (not read yet)'}`))}.`;
}
// What the page says when the bank has no document: that none of the watched counties has one for it yet. The watched counties
// themselves are said once, by watchedLine, beside it.
export function emptyText(watched = []) {
  if (!watched.length) return 'No county is watched yet, so no public record can show this bank\'s loans. A county is watched once its source is built and a principal allows it.';
  return 'None of the watched counties has a document for this bank yet.';
}

// The sidebar card: the count, the newest three, and the watched counties.
export function loansCard(bank, watched = []) {
  const rows = loanRows(bank);
  return { count: rows.length, latest: rows.slice(0, 3), more: Math.max(0, rows.length - 3), empty: rows.length ? '' : emptyText(watched), watched: watchedLine(watched) };
}

// System status: one row per watched county, as countyCoverage (src/counties.mjs) gives it, in words.
const n = (v) => (v === null || v === undefined ? '–' : String(v));
export function countyRows(rows = []) {
  return rows.map((r) => ({
    id: r.id, county: r.countyLabel, label: r.label, example: !!r.example, configured: !!r.configured,
    lastRun: r.lastRun ? `${longDate(r.lastRun.ranAt)}${r.lastRun.outcome === 'ok' ? '' : r.lastRun.outcome === 'failed' ? ', failed' : ', looked wrong'}` : 'Never',
    failed: r.lastRun?.outcome === 'failed', error: r.lastRun?.error ?? '',
    read: n(r.read), newThisWeek: n(r.newThisWeek), matched: n(r.matchedDocuments), stored: n(r.stored), review: n(r.reviewNames),
  }));
}
