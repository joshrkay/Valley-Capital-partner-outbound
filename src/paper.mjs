// The paper estimate, reported layer (docs/paper-estimate.md, PRD E14-S1): one record per scored bank, paper/<file>.json in the data
// folder, estimating what CRE the bank holds from what it reported to the FDIC. Code only, no model, no clock: the same inputs always give
// the same record. It is an estimate, not the loan tape. It is for the principals and the briefer only: it never appears in a message,
// and the drafter never receives it (test/handoff.test.mjs).
//
// Every value carries: `value` (or `low` and `high`, for bounds), `unit` (usd, count or pct), `kind` (stock, flow or net-change), `asOf`
// (ISO date), `tier` (reported, observed or inferred), `sources` ([{ field, file, repdte }]) and `method`. FDIC dollars are in thousands
// and are converted to dollars here, once. A value with no basis is a gap: `value: null` with a `status` ("not reported", "not pulled",
// "semiannual" and so on) and a `reason`, never 0. Four rules from the spec are enforced here:
//   - A stage FDIC does not report is "not reported", never zero (5.Q1).
//   - Charge-offs and loan-sale gains are flows over a period, kept apart from balances, which are stocks (checklist 18).
//   - The loan-size fields, and the restructured split by type, are semiannual: a March or September value is never used, whatever it
//     holds. The latest June or December report is used, and its date is shown (SEMIANNUAL_FIELDS in src/sources/fdic.mjs).
//   - The in-box estimate is bounds only: never a product of separate breakdowns, and no base figure (5.Q7, D-P2).
import { join } from 'node:path';
import { readJson, safeId } from './store.mjs';
import { periodLabel, shiftQuarter, quarterIndex } from './metrics.mjs';
import { SEMIANNUAL_FIELDS, isSemiannualReport } from './sources/fdic.mjs';

export const PAPER_SCHEMA = 'paper-estimate/1';
export const TIERS = Object.freeze(['reported', 'observed', 'inferred']);
export const UNITS = Object.freeze({ usd: 'US dollars (FDIC reports thousands; converted)', count: 'a number of loans', pct: 'a share, as a fraction of 1 (0.25 is 25%)' });
export const KINDS = Object.freeze({ stock: 'a balance at the report date', flow: 'an amount over a period (quarter or year to date)', 'net-change': 'the change in a balance from the prior quarter' });
// The 2023 accounting change (ASU 2022-02) replaced troubled debt restructurings with modifications to borrowers in financial difficulty.
// Reports from 2023Q1 on are on the new basis, so a restructured series that spans this date is broken there (checklist 8).
export const SERIES_BREAK_2023 = Object.freeze({ repdte: '20230331', asOf: '2023-03-31', standard: 'ASU 2022-02',
  before: 'troubled debt restructurings (before 2023)', after: 'modifications to borrowers in financial difficulty (2023 onward)' });

const THOUSANDS = 1000;
const FILES = { footprint: 'sources/fdic/footprint.json', events: 'sources/fdic/events.json', filings: 'sources/edgar/filings.json' };
const finFile = (cert) => `sources/fdic/financials/${cert}.json`;
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const iso = (rep) => `${rep.slice(0, 4)}-${rep.slice(4, 6)}-${rep.slice(6, 8)}`;
const compact = (ymd) => String(ymd ?? '').replace(/-/g, '');
const quarterStart = (rep) => `${rep.slice(0, 4)}-${String(Number(rep.slice(4, 6)) - 2).padStart(2, '0')}-01`;
const validRep = (r) => { try { quarterIndex(r); return true; } catch { return false; } };
const has = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);

// ---- Where a record lives ------------------------------------------------------------------------------------------------------
// A key is fdic:<CERT>. A colon is not a safe file name everywhere, so the file is paper/fdic-<CERT>.json (checked by store.safeId).
export function paperFileId(key) {
  const m = /^fdic:(\d{1,10})$/.exec(String(key ?? ''));
  if (!m) throw new Error(`"${key}" is not a bank key. Keys look like fdic:<CERT>.`);
  return safeId(`fdic-${m[1]}`);
}
export const paperRel = (key) => `paper/${paperFileId(key)}.json`;
export const paperPath = (dir, key) => join(dir, 'paper', `${paperFileId(key)}.json`);
export const readPaper = ({ dir, key }) => readJson(paperPath(dir, key), null);

// ---- Values ----------------------------------------------------------------------------------------------------------------------
// A gap: no basis for a number. Its status says why, in words a principal reads ("not reported" is not "zero").
export const STATUS = Object.freeze({
  'not-reported': 'not reported', 'not-pulled': 'not pulled', semiannual: 'not reported this quarter (semiannual)', 'not-on-file': 'not on file',
  null: 'no value from FDIC', unknown: 'unknown', 'structure-event': 'withheld (structure event)', 'zero-denominator': 'no ratio (zero base)', unclear: 'unclear',
});
function gap(status, reason, { unit = 'usd', kind = 'stock', asOf = null, sources = [] } = {}) {
  if (!STATUS[status]) throw new Error(`Unknown gap status "${status}".`);
  return { value: null, status, reason, unit, kind, asOf, tier: null, sources, method: 'none' };
}
const isGap = (v) => !v || v.value === null || v.value === undefined;

// One FDIC field, or the sum of several, from one report of this bank. Dollars are converted from thousands here.
function fromFields(ctx, rep, fields, { unit = 'usd', kind = 'stock', method, note, period } = {}) {
  const sources = fields.map((field) => ({ field, file: ctx.file, repdte: rep }));
  const base = { unit, kind, asOf: rep ? iso(rep) : null, sources };
  const q = rep ? ctx.quarters[rep] : null;
  if (!q) return gap('not-on-file', `No report${rep ? ` for ${periodLabel(rep)}` : ''} is on file.`, base);
  const absent = fields.filter((f) => !has(q, f));
  if (absent.length) return gap('not-on-file', `${absent.join(', ')} ${absent.length > 1 ? 'are' : 'is'} not in the stored report: the FDIC data was pulled before ${absent.length > 1 ? 'these fields were' : 'this field was'} added. Run the FDIC pull again (outbound sources run fdic).`, base);
  const vals = fields.map((f) => num(q[f]));
  const nulls = fields.filter((f, i) => vals[i] === null);
  if (nulls.length) return gap('null', `FDIC reports no value for ${nulls.join(', ')} at ${periodLabel(rep)}.`, base);
  const raw = vals.reduce((s, v) => s + v, 0);
  return { value: unit === 'usd' ? raw * THOUSANDS : raw, unit, kind, asOf: base.asOf, ...(period ? { period } : {}), tier: 'reported', sources, method: method ?? (fields.length > 1 ? 'sum-of-fields' : 'fdic-field'), ...(note ? { note } : {}) };
}

// a − b, or a / b, of two values. A gap in either input gives a gap; a zero base gives a gap, never 0.
function derive(op, a, b, { unit, kind = 'stock', method, note }) {
  const sources = [...(a?.sources ?? []), ...(b?.sources ?? [])];
  const asOf = a?.asOf ?? b?.asOf ?? null;
  if (isGap(a) || isGap(b)) return gap('unknown', [...new Set([a, b].filter(isGap).map((x) => x?.reason ?? 'An input is missing.'))].join(' '), { unit, kind, asOf, sources });
  if (op === 'ratio' && b.value === 0) return gap('zero-denominator', `The base (${b.sources.map((s) => s.field).join(' + ')}) is 0.`, { unit, kind, asOf, sources });
  const value = op === 'ratio' ? a.value / b.value : a.value - b.value;
  const tier = [a.tier, b.tier].includes('inferred') ? 'inferred' : [a.tier, b.tier].includes('observed') ? 'observed' : 'reported';
  return { value, unit, kind, asOf, tier, sources, method, ...(note ? { note } : {}) };
}
const share = (a, b, method = 'share') => derive('ratio', a, b, { unit: 'pct', method });

// ---- Inputs ------------------------------------------------------------------------------------------------------------------------
function finCtx(cert, financials) {
  const quarters = financials?.quarters ?? {};
  const reps = Object.keys(quarters).filter(validRep).sort();
  return { cert: String(cert), file: finFile(cert), quarters, reps, latest: reps.at(-1) ?? null };
}
// The latest June or December report on file, at or before `rep`.
const latestSemiannual = (ctx, rep = ctx.latest) => [...ctx.reps].reverse().find((r) => r <= rep && isSemiannualReport(r)) ?? null;
const skippedReports = (ctx, S) => ctx.reps.filter((r) => (!S || r > S) && !isSemiannualReport(r));
function semiannualNote(ctx, S, what) {
  const skipped = skippedReports(ctx, S);
  return `${what} come from the ${S ? periodLabel(S) : 'latest June or December'} report. Most banks report them only in June and December and send 0 in March and September, so ${skipped.length ? `the ${skipped.map(periodLabel).join(' and ')} values are not used` : 'March and September values are never used'}.`;
}

// ---- Q1: size and stress ---------------------------------------------------------------------------------------------------------
const NOT_REPORTED = (reason) => ({ status: 'not-reported', reason });
const NOT_PULLED = (reason) => ({ status: 'not-pulled', reason });
const CO_SPLIT = 'Charge-offs are reported each quarter for nonfarm nonresidential as a whole (see its total); the owner-occupied and other split exists only year to date (NTRENROW, NTRENROT), not pulled.';
// The categories of Q1, with the stages FDIC reports for each (docs/paper-estimate.md 5.Q1, checked against FDIC's definitions).
export const Q1_CATEGORIES = Object.freeze([
  { id: 'construction', label: 'Construction and land development', investor: true, balance: 'LNRECONS',
    stages: { pastDue30to89: 'P3RECONS', pastDue90: 'P9RECONS', nonaccrual: 'NARECONS' }, chargeOffs: 'NTRECONQ',
    split: [{ id: 'otherConstruction', label: 'Other construction and land', balance: 'LNRECNOT' }, { id: 'oneToFourFamilyConstruction', label: '1-4 family construction', balance: 'LNRECNFM' }] },
  { id: 'multifamily', label: 'Multifamily', investor: true, balance: 'LNREMULT', stages: { pastDue30to89: 'P3REMULT', pastDue90: 'P9REMULT', nonaccrual: 'NAREMULT' }, chargeOffs: 'NTREMULQ' },
  { id: 'nonfarmNonresidentialOther', label: 'Nonfarm nonresidential, other (not owner-occupied)', investor: true, balance: 'LNRENROT',
    stages: { pastDue30to89: 'P3RENROT', pastDue90: 'P9RENROT', nonaccrual: 'NARENROT' }, chargeOffs: NOT_PULLED(CO_SPLIT) },
  { id: 'nonfarmNonresidentialOwnerOccupied', label: 'Nonfarm nonresidential, owner-occupied', investor: false, balance: 'LNRENROW',
    stages: { pastDue30to89: 'P3RENROW', pastDue90: 'P9RENROW', nonaccrual: 'NARENROW' }, chargeOffs: NOT_PULLED(CO_SPLIT) },
  { id: 'notSecuredByRealEstate', label: 'CRE loans not secured by real estate', investor: true, balance: 'LNCOMRE',
    stages: { pastDue30to89: 'P3COMRE', pastDue90: NOT_REPORTED('FDIC reports no 90+ days past due field for CRE loans not secured by real estate.'), nonaccrual: NOT_REPORTED('FDIC reports no nonaccrual field for CRE loans not secured by real estate.') },
    chargeOffs: NOT_PULLED('FDIC reports charge-offs on this line only year to date (NTCOMRE), which is not pulled.'),
    note: 'P3COMRE is titled only "30-89 days past due, commercial RE" by FDIC. It is taken as this line\'s 30-89 stage because, checked live on every bank on November 14, 2026, it was never above LNCOMRE and never above 0 where LNCOMRE is 0.' },
]);
export const STAGE_LABELS = Object.freeze({ pastDue30to89: '30-89 days past due', pastDue90: '90 days or more past due', nonaccrual: 'Nonaccrual' });
const INVESTOR_FIELDS = Q1_CATEGORIES.filter((c) => c.investor).map((c) => c.balance);   // LNRECONS + LNREMULT + LNRENROT + LNCOMRE
const CRE_BOOK_FIELDS = ['LNRECONS', 'LNREMULT', 'LNRENRES'];

function stageValue(ctx, L, spec, balance, unit = 'usd') {
  if (typeof spec === 'string') { const amount = fromFields(ctx, L, [spec]); return { amount, shareOfBalance: share(amount, balance) }; }
  const g = gap(spec.status, spec.reason, { unit, asOf: L ? iso(L) : null });
  return { amount: g, shareOfBalance: gap(spec.status, spec.reason, { unit: 'pct', asOf: g.asOf }) };
}

// A flow for the quarter, and for the year to date as the sum of the year's quarterly fields. FDIC's own year-to-date fields are never
// requested (src/sources/fdic.mjs, YTD_FLOW_FIELDS); every quarter of the year up to L must be on file, or the year to date is a gap.
function chargeOffs(ctx, L, spec) {
  if (typeof spec !== 'string') { const g = gap(spec.status, spec.reason, { kind: 'flow', asOf: L ? iso(L) : null }); return { quarter: g, yearToDate: g }; }
  if (!L) { const g = gap('not-on-file', 'No report is on file.', { kind: 'flow' }); return { quarter: g, yearToDate: g }; }
  const quarter = fromFields(ctx, L, [spec], { kind: 'flow', period: { from: quarterStart(L), to: iso(L), basis: 'quarter' } });
  const yearReps = []; for (let r = L; r.slice(0, 4) === L.slice(0, 4); r = shiftQuarter(r, -1)) yearReps.unshift(r);
  const lacking = yearReps.filter((r) => !ctx.quarters[r]);
  const period = { from: `${L.slice(0, 4)}-01-01`, to: iso(L), basis: 'year-to-date' };
  if (lacking.length) return { quarter, yearToDate: gap('not-on-file', `The year to date needs every quarter of ${L.slice(0, 4)} up to ${periodLabel(L)}; ${lacking.map(periodLabel).join(', ')} ${lacking.length > 1 ? 'are' : 'is'} not on file.`, { kind: 'flow', asOf: iso(L), sources: yearReps.map((r) => ({ field: spec, file: ctx.file, repdte: r })) }) };
  const parts = yearReps.map((r) => fromFields(ctx, r, [spec], { kind: 'flow' }));
  const bad = parts.find(isGap);
  if (bad) return { quarter, yearToDate: gap(bad.status, bad.reason, { kind: 'flow', asOf: iso(L), sources: parts.flatMap((p) => p.sources) }) };
  return { quarter, yearToDate: { value: parts.reduce((s, p) => s + p.value, 0), unit: 'usd', kind: 'flow', asOf: iso(L), period, tier: 'reported', sources: parts.flatMap((p) => p.sources), method: 'sum-of-quarterly-fields' } };
}

// Net change only, never "new lending", and never across a quarter in which the bank acquired another bank (E3-S6).
const NET_CHANGE_NOTE = 'Net change is not new lending: it nets new loans against payoffs, charge-offs, loan sales, acquired books and reclassifications.';
// A series is kept compact: it names its unit, tier, fields and file once, and each point carries its report date (its as-of date) and
// its value, or a status and reason when there is none. Sources of a point = the series' fields, in its file, at the point's repdte.
const point = (rep, v, key = 'value') => ({ repdte: rep, asOf: iso(rep), [key]: isGap(v) ? null : v.value, ...(isGap(v) ? { [`${key}Status`]: v.status, [`${key}Reason`]: v.reason } : {}) });
function trend(ctx, id, label, fields, events) {
  const points = ctx.reps.map((r) => {
    const balance = fromFields(ctx, r, fields);
    const prevRep = shiftQuarter(r, -1);
    let netChange;
    if (!ctx.quarters[prevRep]) netChange = gap('not-on-file', `No report for ${periodLabel(prevRep)} is on file.`, { kind: 'net-change' });
    else {
      const ev = events.find((e) => e.effective && e.effective > iso(prevRep) && e.effective <= iso(r));
      netChange = ev
        ? gap('structure-event', `The bank ${ev.kind === 'failure' ? 'took over a failed bank' : 'acquired another bank'} (FDIC cert ${ev.targetCert}, structure event ${ev.transnum ?? 'unknown'} in ${FILES.events}) effective ${periodLabel(compact(ev.effective))}, so the change includes the acquired book and is not shown.`, { kind: 'net-change' })
        : derive('diff', balance, fromFields(ctx, prevRep, fields), { unit: 'usd', kind: 'net-change', method: 'net-change' });
    }
    return { ...point(r, balance, 'balance'), ...point(r, netChange, 'netChange') };
  });
  return { id, label, unit: 'usd', kinds: { balance: 'stock', netChange: 'net-change' }, tier: 'reported', fields, file: ctx.file, method: 'net-change: the balance at each report date minus the balance a quarter earlier', points };
}

function q1Block(ctx, events) {
  const L = ctx.latest;
  const categories = Q1_CATEGORIES.map((c) => {
    const balance = fromFields(ctx, L, [c.balance]);
    const stages = Object.fromEntries(Object.entries(c.stages).map(([k, spec]) => [k, stageValue(ctx, L, spec, balance)]));
    return { id: c.id, label: c.label, investor: c.investor, balance, stages, chargeOffs: chargeOffs(ctx, L, c.chargeOffs),
      ...(c.split ? { split: c.split.map((s) => ({ id: s.id, label: s.label, balance: fromFields(ctx, L, [s.balance]) })) } : {}), ...(c.note ? { note: c.note } : {}) };
  });
  const nonfarmTotal = { label: 'Nonfarm nonresidential in total (owner-occupied and other)', balance: fromFields(ctx, L, ['LNRENRES']), chargeOffs: chargeOffs(ctx, L, 'NTRENRSQ') };
  const S = latestSemiannual(ctx);
  const rsBasis = (rep) => (rep >= SERIES_BREAK_2023.repdte ? SERIES_BREAK_2023.after : SERIES_BREAK_2023.before);
  const semiannualOnly = (rep, field) => (S ? fromFields(ctx, rep, [field]) : gap('semiannual', 'No June or December report is on file, and most banks report the restructured split only then.', { asOf: rep ? iso(rep) : null }));
  const byTypeAt = (rep) => [
    { id: 'construction', label: 'Construction and land development', field: 'RSCONS' }, { id: 'multifamily', label: 'Multifamily', field: 'RSMULT' },
    { id: 'nonfarmNonresidential', label: 'Nonfarm nonresidential (owner-occupied and other together)', field: 'RSNRES' },
    { id: 'nonaccrualNonfarmNonresidential', label: 'Of which nonaccrual, nonfarm nonresidential', field: 'NARSNRES' },
    { id: 'allOther', label: 'All other loans (not CRE)', field: 'RSOTHER' },
  ].map((t) => ({ ...t, value: { ...semiannualOnly(rep, t.field), basis: rep ? rsBasis(rep) : null } }));
  const semiReps = ctx.reps.filter(isSemiannualReport);
  const spans = (reps) => reps.some((r) => r < SERIES_BREAK_2023.repdte) && reps.some((r) => r >= SERIES_BREAK_2023.repdte);
  const restructured = {
    basis: L ? rsBasis(L) : null,
    note: `The split by type is reported by most banks only in June and December. ${semiannualNote(ctx, S, 'The figures by type')} The total (RSLNLTOT) is filled every quarter.`,
    asOfByType: S ? iso(S) : null,
    byType: byTypeAt(S),
    total: { ...fromFields(ctx, L, ['RSLNLTOT']), basis: L ? rsBasis(L) : null },
    seriesBreak: { ...SERIES_BREAK_2023, spansTotal: spans(ctx.reps), spansByType: spans(semiReps),
      note: `The ${SERIES_BREAK_2023.standard} accounting change moved restructured loans from ${SERIES_BREAK_2023.before} to ${SERIES_BREAK_2023.after}. Values on either side of ${periodLabel(SERIES_BREAK_2023.repdte)} are not comparable; each value names its basis.` },
    series: [
      { id: 'total', label: 'Total restructured (all loans), every quarter', unit: 'usd', kind: 'stock', tier: 'reported', fields: ['RSLNLTOT'], file: ctx.file, method: 'fdic-field',
        points: ctx.reps.map((r) => ({ ...point(r, fromFields(ctx, r, ['RSLNLTOT'])), basis: rsBasis(r) })) },
      ...byTypeAt(S).map((t) => ({ id: t.id, label: `${t.label}, June and December reports only`, unit: 'usd', kind: 'stock', tier: 'reported', fields: [t.field], file: ctx.file, method: 'fdic-field',
        points: semiReps.map((r) => ({ ...point(r, fromFields(ctx, r, [t.field])), basis: rsBasis(r) })) })),
    ].map((x) => ({ ...x, spansBreak: spans(x.points.map((p) => p.repdte)), ...(spans(x.points.map((p) => p.repdte)) ? { breakAt: SERIES_BREAK_2023.asOf } : {}) })),
  };
  const commitments = {
    level: 'portfolio', note: 'Unused commitments are reported for the whole CRE book only (secured and unsecured), not by category, so they are never shown per category. They include construction draws still to come.',
    secured: fromFields(ctx, L, ['UCCOMRES']), unsecured: fromFields(ctx, L, ['UCCOMREU']), total: fromFields(ctx, L, ['UCCOMRES', 'UCCOMREU']),
  };
  const oreo = [
    { id: 'construction', label: 'Construction and land development', value: fromFields(ctx, L, ['ORECONS']) },
    { id: 'multifamily', label: 'Multifamily', value: fromFields(ctx, L, ['OREMULT']) },
    { id: 'nonfarmNonresidential', label: 'Nonfarm nonresidential', value: fromFields(ctx, L, ['ORENRES']) },
  ];
  const trendSeries = [
    { id: 'investorCre', label: 'Investor CRE', fields: INVESTOR_FIELDS },
    ...Q1_CATEGORIES.map((c) => ({ id: c.id, label: c.label, fields: [c.balance] })),
  ].map((x) => trend(ctx, x.id, x.label, x.fields, events));
  return {
    asOf: L ? iso(L) : null,
    definition: 'Investor CRE = construction and land development + multifamily + nonfarm nonresidential not owner-occupied + CRE loans not secured by real estate (LNRECONS + LNREMULT + LNRENROT + LNCOMRE), the 2006 interagency guidance\'s definition (71 FR 74580). Owner-occupied nonfarm nonresidential is shown on its own.',
    investorCre: fromFields(ctx, L, INVESTOR_FIELDS, { method: 'sum-of-fields: investor CRE (2006 guidance)' }),
    ownerOccupied: fromFields(ctx, L, ['LNRENROW']),
    creBook: fromFields(ctx, L, CRE_BOOK_FIELDS, { method: 'sum-of-fields: CRE secured by real estate', note: 'Construction + multifamily + all nonfarm nonresidential: the book Q7 measures shares against.' }),
    categories, nonfarmTotal, oreo, restructured, commitments,
    trend: { method: 'net-change', note: NET_CHANGE_NOTE, series: trendSeries },
  };
}

// ---- Q3: geography, a proxy ------------------------------------------------------------------------------------------------------
function q3Block(footprint, buybox, metros) {
  const sod = footprint?.sod ?? null;
  const metroSum = Object.values(sod?.depositsByMetro ?? {}).reduce((s, x) => s + (num(x) ?? 0), 0);
  const usable = !!sod && num(sod.totalDeposits) > 0 && metroSum <= num(sod.totalDeposits) && /^\d{4}$/.test(String(sod.year));
  const rep = usable ? `${sod.year}0630` : null;
  const labelOf = (c) => metros?.metros?.find((m) => m.cbsa === c)?.label ?? `CBSA ${c}`;
  const inBox = new Set(buybox?.metros ?? []);
  const fetched = String(footprint?._source?.fetchedAt ?? '').slice(0, 10);
  const depValue = (k, field = 'DEPSUMBR') => ({ value: k * THOUSANDS, unit: 'usd', kind: 'stock', asOf: iso(rep), tier: 'reported', sources: [{ field, file: FILES.footprint, repdte: rep }], method: 'sum-of-branch-deposits' });
  const total = usable ? { ...depValue(num(sod.totalDeposits), 'DEPSUM'), method: 'fdic-field' } : gap('unknown', !sod ? 'No Summary of Deposits record is on file for this bank.' : 'The Summary of Deposits record is incomplete (no total, or metro deposits above the total).');
  const codes = [...new Set([...(metros?.metros ?? []).map((m) => m.cbsa), ...Object.keys(footprint?.branchesByMetro ?? {}), ...Object.keys(sod?.depositsByMetro ?? {})])]
    .filter((c) => inBox.has(c) || num(footprint?.branchesByMetro?.[c]) > 0 || num(sod?.depositsByMetro?.[c]) > 0);
  const list = codes.map((c) => {
    const deposits = usable ? depValue(num(sod.depositsByMetro?.[c]) ?? 0) : gap('unknown', total.reason);
    // A bank in the footprint file with no branch in a metro has 0 there (its branch list was read); with no footprint, it is unknown.
    const n = footprint?.branchesByMetro ? (num(footprint.branchesByMetro[c]) ?? 0) : null;
    return { cbsa: c, label: labelOf(c), inBuybox: inBox.has(c), deposits, share: share(deposits, total, 'share-of-deposits'),
      branches: n === null || !fetched ? gap('unknown', n === null ? 'No branch list is on file for this bank.' : 'The branch list on file has no date.', { unit: 'count' })
        : { value: n, unit: 'count', kind: 'stock', asOf: fetched, tier: 'reported', sources: [{ field: 'branch records', file: FILES.footprint, repdte: compact(fetched) }], method: 'count-of-branch-records' } };
  });
  const inBoxDeposits = usable ? depValue(list.filter((m) => m.inBuybox).reduce((s, m) => s + m.deposits.value / THOUSANDS, 0)) : gap('unknown', total.reason);
  // With no deposits in a buy-box metro the sum is a reported 0, sourced to the bank's Summary of Deposits record.
  if (usable) inBoxDeposits.sources = list.some((m) => m.inBuybox) ? list.filter((m) => m.inBuybox).flatMap((m) => m.deposits.sources) : [{ field: 'DEPSUMBR', file: FILES.footprint, repdte: rep }];
  return {
    proxy: true, label: 'Deposit share by metro: a proxy for where the bank lends, not loans',
    caveats: ['Deposits are not loans: a bank can lend where it takes no deposits.', 'Loan production offices appear in no deposit data, and online and national banks distort the footprint.'],
    asOf: usable ? iso(rep) : null, sodYear: usable ? Number(sod.year) : null, totalDeposits: total, metros: list,
    buyboxDeposits: inBoxDeposits, buyboxShare: share(inBoxDeposits, total, 'share-of-deposits-in-buy-box-metros'),
  };
}

// ---- Q4: loan sizes, nonfarm nonresidential only ---------------------------------------------------------------------------------
// Buckets by ORIGINAL amount. Dollars are current balances of the loans in each bucket; a current balance is at most its original amount.
export const SIZE_BUCKETS = Object.freeze([
  { id: 'under100k', label: 'Under $100,000', lo: 0, hi: 100000, dollars: 'LNRENR1', count: 'LNRENR1N' },
  { id: 'from100kTo250k', label: '$100,000 to $250,000', lo: 100000, hi: 250000, dollars: 'LNRENR2', count: 'LNRENR2N' },
  { id: 'from250kTo1m', label: '$250,000 to $1 million', lo: 250000, hi: 1000000, dollars: 'LNRENR3', count: 'LNRENR3N' },
]);
export const OVER_1M = Object.freeze({ id: 'over1m', label: '$1 million or more', lo: 1000000, hi: Infinity });
if (SEMIANNUAL_FIELDS.loanSizes.some((f) => !['LNRENR4', 'LNRENR4N', ...SIZE_BUCKETS.flatMap((b) => [b.dollars, b.count])].includes(f))) throw new Error('paper.mjs: a semiannual loan-size field has no bucket.');

function q4Block(ctx) {
  const S = latestSemiannual(ctx);
  const caveats = [
    'The buckets use each loan\'s original amount, not its current balance.',
    'They cover all nonfarm nonresidential loans: owner-occupied and investor together.',
    'Multifamily and construction loans have no size data in the Call Report.',
  ];
  const note = semiannualNote(ctx, S, 'Loan sizes');
  if (!S) {
    const g = gap('semiannual', 'No June or December report is on file. Loan sizes are reported by most banks only in June and December, and a March or September value is never used.', { asOf: null });
    return { asOf: null, note, caveats, buckets: [], under1m: { dollars: g, count: { ...g, unit: 'count' } }, over1m: { dollars: g, count: { ...g, unit: 'count' } }, averageSmallLoan: g, nonfarmNonresidential: g };
  }
  const nfnr = fromFields(ctx, S, ['LNRENRES']);
  const buckets = SIZE_BUCKETS.map((b) => {
    const dollars = fromFields(ctx, S, [b.dollars]);
    return { id: b.id, label: b.label, dollars, count: fromFields(ctx, S, [b.count], { unit: 'count' }), shareOfNonfarmNonresidential: share(dollars, nfnr) };
  });
  const u1 = { dollars: fromFields(ctx, S, ['LNRENR4']), count: fromFields(ctx, S, ['LNRENR4N'], { unit: 'count' }) };
  // Every bucket at 0 while the bank holds nonfarm nonresidential loans is ambiguous (none under $1 million, or not reported): unknown.
  const allZero = [u1.dollars, u1.count, ...buckets.flatMap((b) => [b.dollars, b.count])].every((v) => v.value === 0) && nfnr.value > 0;
  if (allZero) {
    const g = (unit) => gap('unclear', `FDIC shows 0 in every size bucket at ${periodLabel(S)} while the bank holds nonfarm nonresidential loans. That may mean none under $1 million, or that the sizes were not reported; it is not shown as zero.`, { unit, asOf: iso(S), sources: u1.dollars.sources });
    return { asOf: iso(S), note, caveats, buckets: buckets.map((b) => ({ ...b, dollars: g('usd'), count: g('count'), shareOfNonfarmNonresidential: g('pct') })), under1m: { dollars: g('usd'), count: g('count') }, over1m: { dollars: g('usd'), count: g('count') }, averageSmallLoan: g('usd'), nonfarmNonresidential: nfnr };
  }
  let over = derive('diff', nfnr, u1.dollars, { unit: 'usd', method: 'difference: LNRENRES - LNRENR4' });
  if (!isGap(over) && over.value < 0) over = gap('unclear', `LNRENR4 is above LNRENRES at ${periodLabel(S)}; the size data is inconsistent.`, { asOf: iso(S), sources: over.sources });
  return {
    asOf: iso(S), note, caveats, nonfarmNonresidential: nfnr, buckets,
    under1m: { ...u1, shareOfNonfarmNonresidential: share(u1.dollars, nfnr) },
    over1m: { dollars: over, count: gap('unknown', 'FDIC reports no count of loans of $1 million or more.', { unit: 'count', asOf: iso(S) }), shareOfNonfarmNonresidential: share(over, nfnr) },
    averageSmallLoan: derive('ratio', u1.dollars, u1.count, { unit: 'usd', method: 'average: LNRENR4 / LNRENR4N' }),
  };
}

// ---- Q5: maturity and repricing, a proxy ------------------------------------------------------------------------------------------
export const MATURITY_BUCKETS = Object.freeze([
  { id: 'upTo3m', label: '3 months or less', field: 'LNOT3LES' }, { id: 'from3mTo12m', label: '3 to 12 months', field: 'LNOT3T12' },
  { id: 'from1yTo3y', label: '1 to 3 years', field: 'LNOT1T3' }, { id: 'from3yTo5y', label: '3 to 5 years', field: 'LNOT3T5' },
  { id: 'from5yTo15y', label: '5 to 15 years', field: 'LNOT5T15' }, { id: 'over15y', label: 'Over 15 years', field: 'LNOTOV15' },
]);
function q5Block(ctx) {
  const L = ctx.latest;
  const total = fromFields(ctx, L, MATURITY_BUCKETS.map((b) => b.field), { method: 'sum-of-fields' });
  return {
    proxy: true, label: 'Remaining maturity or next repricing of all loans except closed-end 1-4 family first liens: not CRE-specific',
    caveats: ['These buckets include commercial and industrial, consumer and other loans, not just CRE.', 'Fixed-rate loans are bucketed by remaining maturity and floating-rate loans by their next repricing date.'],
    vintages: gap('unknown', 'No vintages: this layer has no loan-level dates. Vintages come only from loan-level records (E14-S4, E14-S5).', { asOf: null }),
    asOf: L ? iso(L) : null, total,
    buckets: MATURITY_BUCKETS.map((b) => ({ id: b.id, label: b.label, value: fromFields(ctx, L, [b.field]) })),
  };
}

// ---- Q6: seller evidence, a dated list -------------------------------------------------------------------------------------------
const money = (usd) => { const a = Math.abs(usd), s = usd < 0 ? 'minus ' : ''; return a >= 1e9 ? `${s}$${(a / 1e9).toFixed(2)} billion` : a >= 1e6 ? `${s}$${(a / 1e6).toFixed(1)} million` : `${s}$${Math.round(a).toLocaleString('en-US')}`; };
function q6Block(ctx, events, filings) {
  const L = ctx.latest;
  const items = [];
  if (L) {
    const hfs = { total: fromFields(ctx, L, ['LNLSSALE']), nonaccrual: fromFields(ctx, L, ['NALNSALE']), pastDue90: fromFields(ctx, L, ['P9LNSALE']), pastDue30to89: fromFields(ctx, L, ['P3LNSALE']) };
    items.push({ type: 'held-for-sale', date: iso(L), label: 'Loans held for sale, with the distressed part (all loan types)', values: hfs, tier: 'reported', sources: Object.values(hfs).flatMap((v) => v.sources), method: 'fdic-field' });
    const gl = { quarter: fromFields(ctx, L, ['NTGLLNQ'], { kind: 'flow', period: { from: quarterStart(L), to: iso(L), basis: 'quarter' } }), yearToDate: fromFields(ctx, L, ['NETGNSLN'], { kind: 'flow', period: { from: `${L.slice(0, 4)}-01-01`, to: iso(L), basis: 'year-to-date' } }) };
    items.push({ type: 'loan-sale-gains', date: iso(L), label: 'Net gains or losses on loan sales: not CRE-specific (mostly residential mortgage sales); read only as "this bank sells loans"', notCreSpecific: true, values: gl, tier: 'reported', sources: Object.values(gl).flatMap((v) => v.sources), method: 'fdic-field' });
  }
  // Earlier quarters in the window with distressed loans held for sale: the strongest seller signal when present.
  for (const r of ctx.reps.filter((x) => x !== L)) {
    const na = fromFields(ctx, r, ['NALNSALE']), p9 = fromFields(ctx, r, ['P9LNSALE']);
    if ((na.value ?? 0) > 0 || (p9.value ?? 0) > 0) items.push({ type: 'distressed-held-for-sale', date: iso(r), label: 'Distressed loans held for sale (nonaccrual or 90+ days past due)', values: { nonaccrual: na, pastDue90: p9 }, tier: 'reported', sources: [...na.sources, ...p9.sources], method: 'fdic-field' });
  }
  for (const f of filings ?? []) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(f.fileDate))) continue;
    items.push({ type: 'sec-filing', date: f.fileDate, label: `An SEC filing matched a saved search: ${f.label}`, form: f.form ?? null, link: f.link ?? null, tier: 'reported',
      sources: [{ field: 'accession', file: FILES.filings, repdte: compact(f.fileDate), id: f.accession ?? null }], method: 'sec-full-text-search' });
  }
  for (const e of events ?? []) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(e.effective)) || !/^\d+$/.test(String(e.targetCert))) continue;
    const cre = e.targetLastCre;
    const creValue = cre && num(cre.value) !== null && /^\d{8}$/.test(String(cre.repdte))
      ? { value: num(cre.value) * THOUSANDS, unit: 'usd', kind: 'stock', asOf: iso(String(cre.repdte)), tier: 'reported', sources: ['LNRECONS', 'LNREMULT', 'LNRENRES'].map((field) => ({ field, file: FILES.events, repdte: String(cre.repdte) })), method: 'sum-of-fields: target CRE at its last report' }
      : gap('unknown', 'The target\'s CRE at its last report is not on file.');
    items.push({ type: 'acquisition', date: e.effective, label: e.kind === 'failure' ? `Took over a failed bank (FDIC cert ${e.targetCert}); an acquirer often sells the target's CRE` : `Acquired another bank (FDIC cert ${e.targetCert}); an acquirer often sells the target's CRE`,
      targetCert: String(e.targetCert), eventKind: e.kind ?? null, targetCre: creValue, tier: 'reported', sources: [{ field: 'TRANSNUM', file: FILES.events, repdte: compact(e.effective), id: e.transnum ?? null }], method: 'fdic-structure-event' });
  }
  items.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.type < b.type ? -1 : 1));
  return { note: 'A list, not a score. Each item is dated. Lender-map assignments and enforcement orders come in later layers.', items };
}

// ---- Q7: fit, as bounds only -----------------------------------------------------------------------------------------------------
// For k buy-box conditions, each meeting a share s of the same book: upper = min(s) x book; lower = max(0, sum(s) - (k - 1)) x book.
// A share known only as an interval [low, high] enters the upper bound at its high end and the lower bound at its low end, which keeps
// both bounds true. Never a product of shares, and no base figure until a dependence model is calibrated (E14-S6).
export const BOUNDS_METHOD = 'frechet-bounds';
export const BOUNDS_FORMULA = 'upper = min(s_i) x book; lower = max(0, sum(s_i) - (k - 1)) x book, for k conditions with shares s_i of the same book';
export function frechetBounds(shares) {
  const k = shares.length;
  if (!k) return null;
  for (const s of shares) if (!(Number.isFinite(s.low) && Number.isFinite(s.high) && s.low >= 0 && s.high <= 1 + 1e-12 && s.low <= s.high + 1e-12)) throw new Error(`frechetBounds: a share must be within [0, 1] with low <= high (got ${JSON.stringify(s)}).`);
  const high = Math.min(...shares.map((s) => s.high));
  const low = Math.max(0, shares.reduce((a, s) => a + s.low, 0) - (k - 1));
  return { k, low: Math.min(low, high), high };
}

// Which part of the book can hold loans whose CURRENT balance is in [min, max], from buckets by ORIGINAL amount. A current balance is at
// most its original amount, so a bucket whose original amounts are all below `min` holds no loan in range; any other bucket may. A bucket
// is wholly in range only when no loan can be below `min` (min is 0) and none above `max` (its original amounts are all at or below max).
export function sizeShareInterval({ minUsd, maxUsd }, buckets) {
  const min = minUsd ?? 0, max = maxUsd ?? Infinity;
  const may = buckets.filter((b) => b.hi > min);
  const surely = buckets.filter((b) => min <= 0 && b.hi <= max);
  const sum = (bs) => bs.reduce((s, b) => s + b.dollars, 0);
  return { lowDollars: sum(surely), highDollars: sum(may), may: may.map((b) => b.id), surely: surely.map((b) => b.id) };
}

const SECTOR_CATEGORY = { multifamily: 'multifamily', hospitality: 'nonfarmNonresidential', retail: 'nonfarmNonresidential' };
const SECTOR_LABEL = { multifamily: 'Multifamily', hospitality: 'Hotel (hospitality)', retail: 'Retail' };
const clamp01 = (x) => Math.min(1, Math.max(0, x));

function q7Block(ctx, q1, q3, q4, buybox, placeholders) {
  const L = ctx.latest;
  const book = q1.creBook;
  const nfnr = fromFields(ctx, L, ['LNRENRES']);
  const sectors = (buybox?.sectors?.include ?? []).filter((s) => SECTOR_CATEGORY[s]);
  const loanSize = buybox?.loanSize ?? {};
  const sizeUsable = typeof loanSize.minUsd === 'number' && typeof loanSize.maxUsd === 'number' && loanSize.minUsd <= loanSize.maxUsd;
  const out = sectors.map((sector) => {
    const cat = SECTOR_CATEGORY[sector];
    const conditions = [], notUsed = [];
    const cond = (id, label, low, high, basis, sources, asOf) => conditions.push({ id, label, share: { low: clamp01(low), high: clamp01(high), unit: 'pct', kind: 'stock', asOf, tier: 'reported', sources, method: low === high ? 'share' : 'share-interval' }, basis });
    // A condition whose share is unknown still counts: it enters as 0 to all (0 for the lower bound, 1 for the upper), since possibly none of
    // the book meets it. It is not a measurement, so it carries a status instead of a tier.
    const unknownCond = (id, label, reason) => conditions.push({ id, label, share: { low: 0, high: 1, unit: 'pct', kind: 'stock', asOf: null, tier: null, status: 'unknown', reason, sources: [], method: 'unknown-share: 0 to all' }, basis: reason });
    let why = null;
    if (isGap(book) || book.value === 0) {
      return { sector, label: SECTOR_LABEL[sector], category: cat, book, conditions, notUsed, bounds: gap(isGap(book) ? 'unknown' : 'zero-denominator', isGap(book) ? book.reason : 'The CRE book is 0.', { asOf: book.asOf, sources: book.sources }) };
    }
    // 1. The category.
    if (cat === 'multifamily') {
      const s = share(fromFields(ctx, L, ['LNREMULT']), book);
      if (isGap(s)) notUsed.push({ id: 'category', reason: s.reason });
      else cond('category', 'Multifamily share of the CRE book', s.value, s.value, 'Multifamily has its own Call Report line.', s.sources, s.asOf);
    } else {
      const s = share(nfnr, book);
      why = `${SECTOR_LABEL[sector]} loans are inside nonfarm nonresidential, together with office, industrial and other commercial property, and Call Report data cannot split them. Their share is unknown: anywhere from none to all of nonfarm nonresidential. So the upper bound takes all of nonfarm nonresidential as the category's share, and the lower bound is 0.`;
      if (isGap(s)) notUsed.push({ id: 'category', reason: s.reason });
      else cond('category', `${SECTOR_LABEL[sector]} share of the CRE book: unknown, between 0 and the nonfarm nonresidential share`, 0, s.value, why, s.sources, s.asOf);
    }
    // 2. The metro, by the deposit proxy.
    const m = q3.buyboxShare;
    if (isGap(m)) unknownCond('metro', 'Share in the buy-box metros: unknown (no usable deposit data), so between 0 and all', `${m.reason} A loan's location is unknown without it.`);
    else cond('metro', 'Share in the buy-box metros, by the deposit proxy', m.value, m.value, 'Deposits in the buy-box metros as a share of all deposits (Summary of Deposits), applied to the CRE book: a proxy, not loans.', m.sources, m.asOf);
    // 3. Size, for nonfarm nonresidential only.
    if (cat !== 'nonfarmNonresidential') notUsed.push({ id: 'size', reason: 'The Call Report has no loan-size data for multifamily.' });
    else if (!sizeUsable) notUsed.push({ id: 'size', reason: placeholders.some((p) => p.startsWith('loanSize')) ? 'The buy box\'s loan size is still a placeholder.' : 'The buy box has no usable loan size (minUsd and maxUsd).' });
    else if (isGap(q4.under1m.dollars) || isGap(q4.over1m.dollars) || isGap(q4.nonfarmNonresidential) || !(q4.nonfarmNonresidential.value > 0)) notUsed.push({ id: 'size', reason: q4.under1m.dollars.reason ?? q4.over1m.dollars.reason ?? 'No usable size data.' });
    else {
      const bks = [...q4.buckets.map((b, i) => ({ id: b.id, lo: SIZE_BUCKETS[i].lo, hi: SIZE_BUCKETS[i].hi, dollars: b.dollars.value })), { id: OVER_1M.id, lo: OVER_1M.lo, hi: OVER_1M.hi, dollars: q4.over1m.dollars.value }];
      const iv = sizeShareInterval(loanSize, bks);
      const S = q4.nonfarmNonresidential;
      // The size mix of nonfarm nonresidential at the June or December report, applied to its latest balance, as a share of the book.
      const scale = nfnr.value / S.value / book.value;
      const sameDate = S.asOf === nfnr.asOf;
      cond('size', `Nonfarm nonresidential loans that can be in the buy box's size range ($${loanSize.minUsd.toLocaleString('en-US')} to $${loanSize.maxUsd.toLocaleString('en-US')})`, iv.lowDollars * scale, iv.highDollars * scale,
        `From the size buckets (original amounts; a current balance is at most its original amount). Buckets that may hold loans in range: ${iv.may.join(', ') || 'none'}; wholly in range: ${iv.surely.join(', ') || 'none'}.${sameDate ? '' : ` The ${periodLabel(compact(S.asOf))} size mix is applied to the ${periodLabel(compact(nfnr.asOf))} balance.`}`,
        [...q4.buckets.flatMap((b) => b.dollars.sources), ...q4.over1m.dollars.sources, ...nfnr.sources, ...book.sources], q4.asOf);
    }
    notUsed.push({ id: 'status', reason: 'Which Call Report stages count as the buy box\'s statuses is a principal\'s decision (D-P3); not used yet.' },
      { id: 'lien', reason: 'The Call Report does not report lien position for these loans.' }, { id: 'exclusions', reason: 'The Call Report cannot tell which loans the buy box excludes.' });
    const b = frechetBounds(conditions.map((c) => c.share));
    const bounds = b ? { low: Math.round(b.low * book.value), high: Math.round(b.high * book.value), lowShare: b.low, highShare: b.high, k: b.k, unit: 'usd', kind: 'stock', asOf: book.asOf, tier: 'inferred',
      sources: [...new Map(conditions.flatMap((c) => c.share.sources).concat(book.sources).map((s) => [`${s.field}|${s.file}|${s.repdte}`, s])).values()], method: BOUNDS_METHOD,
      ...(b.low === 0 ? { lowNote: 'The lower bound is 0: the reported shares are consistent with none of the book meeting every condition at once.' } : {}) } : gap('unknown', 'No condition could be measured.');
    return { sector, label: SECTOR_LABEL[sector], category: cat, book, conditions, notUsed, bounds, ...(why ? { why } : {}) };
  });
  return {
    provisional: placeholders.length > 0, placeholders: [...placeholders],
    method: BOUNDS_METHOD, formula: BOUNDS_FORMULA,
    note: 'Bounds only, from reported shares and the deposit proxy. Separate breakdowns are never multiplied: knowing half the book is in one metro and half is in one category says nothing about how much is both. No base figure until a dependence model is calibrated against real tapes (E14-S6).',
    observed: gap('unknown', 'The observed layer (loans seen one by one) is not built yet (E14-S4).', { asOf: null }),
    sectors: out,
  };
}

// ---- Q8: what we do not know, and the tape request -------------------------------------------------------------------------------
export const TAPE_REQUEST = Object.freeze([
  'Loan ID', 'Property type', 'Address or APN', 'Original and current balance', 'Rate and rate type', 'Origination and maturity dates', 'Amortization',
  'DSCR, with its date', 'LTV, with its value date', 'Occupancy', 'Payment status', 'Modification history', 'Guarantors', 'Lien position',
  'Participations (who leads, what share)',
]);

function walk(v, fn, path = '') {
  if (Array.isArray(v)) v.forEach((x, i) => walk(x, fn, `${path}[${i}]`));
  else if (v && typeof v === 'object') { fn(v, path); for (const [k, x] of Object.entries(v)) walk(x, fn, path ? `${path}.${k}` : k); }
}

function q8Block(record, ctx) {
  const unknowns = [];
  const add = (id, text, ask = []) => { if (!unknowns.some((u) => u.id === id)) unknowns.push({ id, text, ask }); };
  add('property-types', 'Q2, property types: hotel, retail, office and industrial loans are inside nonfarm nonresidential and are not reported apart. The public-bank breakdowns and peer priors come in E14-S3; ask for the split.', ['Property type']);
  add('participations', 'Participations are not available: FDIC\'s participation fields are null for every bank checked. The bank may hold slices of others\' loans, or have sold slices of its own.', ['Participations (who leads, what share)']);
  add('vintages', 'Vintages and maturity dates of the CRE loans are unknown: this layer has no loan-level dates, and the maturity buckets are not CRE-specific.', ['Origination and maturity dates', 'Rate and rate type', 'Amortization']);
  add('current-sizes', 'Loan sizes are by original amount and for nonfarm nonresidential only; current balances by size, and any size data for multifamily and construction, are unknown.', ['Original and current balance']);
  add('locations', 'Where the loans are is unknown: the metro split is a deposit proxy, not loans.', ['Address or APN']);
  add('credit-detail', 'Credit detail by loan (DSCR, LTV, occupancy, guarantors, lien position) is not in any public report.', ['DSCR, with its date', 'LTV, with its value date', 'Occupancy', 'Guarantors', 'Lien position']);
  add('holding-company', 'This record is for the charter only. Loans may sit in a sister bank; the holding-company roll-up is not built (D-P5).');
  const seen = new Set(), notReported = [], notPulled = [];
  walk(record, (v) => {
    if (!('status' in v) || v.value !== null || !STATUS[v.status] || seen.has(v.status + v.reason)) return;
    seen.add(v.status + v.reason);
    if (v.status === 'not-on-file' && /pulled before/.test(v.reason)) add('refresh', 'Some fields are not in the stored FDIC data because it was pulled before they were added. Run the FDIC pull again (outbound sources run fdic), then score.');
    else if (v.status === 'not-reported') notReported.push(v.reason);
    else if (v.status === 'not-pulled') notPulled.push(v.reason);
    else if (v.status === 'semiannual') add('semiannual', 'No June or December report is on file, so loan sizes and the restructured split are unknown.', ['Original and current balance', 'Modification history']);
    else if (v.status === 'unclear') add('sizes-unclear', v.reason, ['Original and current balance']);
    else if (v.status === 'structure-event') add('structure-event', 'A quarter\'s net change is withheld because the bank acquired another bank then; the acquired book would look like new lending.', ['Origination and maturity dates']);
    else if (v.status === 'unknown' && /Summary of Deposits/.test(v.reason)) add('no-sod', 'The bank\'s deposit footprint is unknown, so the metro share is unknown.', ['Address or APN']);
  });
  if (notReported.length) add('stages-not-reported', `Stages FDIC does not report (shown as "not reported", never as zero): ${notReported.join(' ')}`, ['Payment status']);
  if (notPulled.length) add('not-pulled', `Figures FDIC has but this layer does not pull: ${notPulled.join(' ')}`);
  if (record.q1.restructured.seriesBreak.spansTotal || record.q1.restructured.seriesBreak.spansByType) add('series-break', `The restructured series spans the 2023 accounting change (${SERIES_BREAK_2023.standard}); values before and after are not comparable.`, ['Modification history']);
  if (record.q7.provisional) add('buy-box-placeholders', `The in-box bounds are provisional: the buy box still has placeholders (${record.q7.placeholders.join(', ')}).`);
  for (const s of record.q7.sectors) for (const n of s.notUsed ?? []) if (n.id === 'status') add('status-mapping', `In-box bounds do not use the buy box's statuses: ${n.reason}`, ['Payment status', 'Modification history']);
  if (!ctx.latest) add('no-financials', 'No FDIC financial data is on file for this bank.');
  return { unknowns, tapeRequest: { when: 'After the confidentiality agreement.', items: [...TAPE_REQUEST] } };
}

// ---- The record ----------------------------------------------------------------------------------------------------------------
// `events` are the stored structure events where this bank is the acquirer; `filings` its SEC filing signals (filingSignals). Pure.
export function buildPaper({ cert, name = '', financials, footprint = {}, events = [], filings = [], buybox = {}, placeholders = [], metros, runId = null, scoredAt = null }) {
  const ctx = finCtx(cert, financials);
  const mine = (Array.isArray(events) ? events : Object.values(events)).filter((e) => String(e?.acquirerCert) === String(cert));
  const q1 = q1Block(ctx, mine);
  const q3 = q3Block(footprint, buybox, metros);
  const q4 = q4Block(ctx);
  const q5 = q5Block(ctx);
  const q6 = q6Block(ctx, mine, filings);
  const q7 = q7Block(ctx, q1, q3, q4, buybox, placeholders);
  const record = {
    schema: PAPER_SCHEMA, key: `fdic:${ctx.cert}`, cert: ctx.cert, name, scope: 'charter', layer: 'reported (E14-S1)', runId, scoredAt,
    latestRepdte: ctx.latest, asOf: ctx.latest ? iso(ctx.latest) : null, provisional: placeholders.length > 0, placeholders: [...placeholders],
    rules: ['An estimate from public reports, not the loan tape.', 'For the principals and the briefer only: it never appears in a message, and the drafter never sees it.', 'Every number names its fields, file, report date, tier and method; "unknown" is never a guess.'],
    units: UNITS, kinds: KINDS, tiers: { reported: 'reported to a regulator or the SEC', observed: 'built from individual loans we can see', inferred: 'a model, a proxy or bounds; always a range' },
    summary: [], q1, q2: { built: false, note: 'Property types inside nonfarm nonresidential are not reported apart. This layer does not estimate them; see the unknowns (E14-S3 adds public-bank breakdowns and peer priors).' }, q3, q4, q5, q6, q7,
  };
  record.q8 = q8Block(record, ctx);
  // The summary points at values elsewhere in the record (paths for paperAt), so each number is stored once.
  const hfsAt = q6.items.findIndex((i) => i.type === 'held-for-sale');
  record.summary = [
    { id: 'investorCre', label: 'Investor CRE (2006 guidance definition)', ref: 'q1.investorCre' },
    { id: 'ownerOccupied', label: 'Owner-occupied nonfarm nonresidential', ref: 'q1.ownerOccupied' },
    ...q7.sectors.map((s, i) => ({ id: `inBox:${s.sector}`, label: `${s.label} loans in the buy box: bounds${q7.provisional ? ' (provisional)' : ''}`, ref: `q7.sectors[${i}].bounds` })),
    { id: 'smallLoans', label: 'Nonfarm nonresidential loans under $1 million (number of loans)', ref: 'q4.under1m.count' },
    ...(hfsAt >= 0 ? [{ id: 'heldForSale', label: 'Loans held for sale (all types)', ref: `q6.items[${hfsAt}].values.total` }] : []),
    { id: 'buyboxDepositShare', label: 'Deposits in the buy-box metros (a proxy, not loans)', ref: 'q3.buyboxShare' },
  ];
  return record;
}

// Every value in a record (anything with a unit), with its path. For tests and for the page's checks.
export function paperValues(record) {
  const out = [];
  walk(record, (v, path) => { if (typeof v.unit === 'string' && (('value' in v) || ('low' in v && 'high' in v))) out.push({ path, v }); });
  return out;
}

// The value at a path such as "q7.sectors[0].bounds" (the summary's refs), or undefined.
export function paperAt(record, ref) {
  let v = record;
  for (const part of String(ref ?? '').split(/[.[\]]+/).filter(Boolean)) { if (v === null || v === undefined) return undefined; v = v[/^\d+$/.test(part) ? Number(part) : part]; }
  return v;
}

// What the briefer receives (fenced as data in src/research.mjs): the values, units, dates, tiers and gap statuses, without source lists,
// series, methods or the longer notes, to keep the prompt short. The unknowns carry what the gaps say.
const BRIEFER_DROPS = new Set(['sources', 'series', 'rules', 'units', 'kinds', 'tiers', 'trend', 'method', 'kind', 'reason', 'caveats', 'definition', 'formula', 'note', 'lowNote', 'basis', 'why', 'notUsed', 'link']);
export function paperForBriefer(record) {
  if (!record) return null;
  const strip = (v) => {
    if (Array.isArray(v)) return v.map(strip);
    if (!v || typeof v !== 'object') return v;
    const o = {};
    for (const [k, x] of Object.entries(v)) if (!BRIEFER_DROPS.has(k)) o[k] = strip(x);
    return o;
  };
  return strip({ key: record.key, asOf: record.asOf, provisional: record.provisional, summary: record.summary.map((s) => ({ label: s.label, value: paperAt(record, s.ref) })), q1: record.q1, q3: record.q3, q4: record.q4, q5: record.q5, q6: record.q6, q7: record.q7, unknowns: record.q8.unknowns.map((u) => u.text) });
}

// ---- Plain text, for `outbound paper show` ---------------------------------------------------------------------------------------
const dateLabel = (isoDate) => (/^\d{4}-\d{2}-\d{2}$/.test(String(isoDate)) ? periodLabel(compact(isoDate)) : 'no date');
export function formatValue(v) {
  if (!v) return 'unknown';
  if (v.status) return `${STATUS[v.status] ?? 'unknown'}: ${v.reason ?? ''}`.trim();
  if ('low' in v && 'high' in v && v.low !== null && v.high !== null && v.low !== undefined) return `${fmtUnit(v.low, v.unit)} to ${fmtUnit(v.high, v.unit)}  [${v.tier} bounds, ${dateLabel(v.asOf)}]`;
  if (v.value === null || v.value === undefined) return `${STATUS[v.status] ?? 'unknown'}: ${v.reason ?? ''}`.trim();
  const per = v.period ? `, ${v.period.basis === 'year-to-date' ? 'year to date' : 'quarter'} to ${dateLabel(v.period.to)}` : '';
  return `${fmtUnit(v.value, v.unit)}  [${v.tier}, ${per ? per.slice(2) : dateLabel(v.asOf)}]`;
}
function fmtUnit(x, unit) {
  if (unit === 'usd') return money(x);
  if (unit === 'pct') return `${(x * 100).toFixed(1)}%`;
  return Number(x).toLocaleString('en-US');
}

export function renderPaper(record) {
  const L = [];
  const line = (label, v, indent = '  ') => L.push(`${indent}${label}: ${formatValue(v)}`);
  L.push(`PAPER ESTIMATE: ${record.name || record.key} (${record.key}), ${record.layer}, as of ${dateLabel(record.asOf)}. Scoring run ${record.runId ?? 'unknown'}.`);
  L.push('An estimate from public reports, not the loan tape. For principals and the briefer only; never in a message.');
  if (record.provisional) L.push(`PROVISIONAL: the buy box still has placeholders (${record.placeholders.join(', ')}).`);
  L.push('', 'SUMMARY'); for (const s of record.summary) line(s.label, paperAt(record, s.ref));
  const q1 = record.q1;
  L.push('', `Q1. SIZE AND STRESS (reported). ${q1.definition}`); line('Investor CRE', q1.investorCre); line('Owner-occupied nonfarm nonresidential', q1.ownerOccupied); line('CRE book (secured by real estate)', q1.creBook);
  for (const c of q1.categories) {
    L.push(`  ${c.label}${c.investor ? '' : ' (not investor CRE)'}`); line('Balance', c.balance, '    ');
    for (const [k, s] of Object.entries(c.stages)) line(STAGE_LABELS[k], s.amount, '    ');
    line('Charge-offs, net, this quarter (a flow)', c.chargeOffs.quarter, '    '); line('Charge-offs, net, year to date (a flow)', c.chargeOffs.yearToDate, '    ');
    for (const s of c.split ?? []) line(s.label, s.balance, '    ');
    if (c.note) L.push(`    Note: ${c.note}`);
  }
  L.push(`  ${q1.nonfarmTotal.label}`); line('Balance', q1.nonfarmTotal.balance, '    '); line('Charge-offs, net, this quarter (a flow)', q1.nonfarmTotal.chargeOffs.quarter, '    '); line('Charge-offs, net, year to date (a flow)', q1.nonfarmTotal.chargeOffs.yearToDate, '    ');
  L.push('  Foreclosed property (OREO)'); for (const o of q1.oreo) line(o.label, o.value, '    ');
  L.push(`  Restructured loans, basis: ${q1.restructured.basis ?? 'unknown'}. ${q1.restructured.note}`); for (const t of q1.restructured.byType) line(t.label, t.value, '    '); line('Total restructured (all loans)', q1.restructured.total, '    ');
  L.push(`    Series break: ${q1.restructured.seriesBreak.note}${q1.restructured.seriesBreak.spansTotal || q1.restructured.seriesBreak.spansByType ? ' THE SERIES ON FILE SPANS THIS BREAK.' : ' The series on file does not span it.'}`);
  L.push(`  Unused CRE commitments (${q1.commitments.level} level). ${q1.commitments.note}`); line('Secured', q1.commitments.secured, '    '); line('Unsecured', q1.commitments.unsecured, '    ');
  L.push(`  Trend: ${q1.trend.note}`);
  for (const s of q1.trend.series) L.push(`    ${s.label} [${s.tier}; ${s.fields.join(' + ')}]: ${s.points.map((p) => `${dateLabel(p.asOf)} ${p.balance === null ? STATUS[p.balanceStatus] : money(p.balance)} (net change ${p.netChange === null ? STATUS[p.netChangeStatus] : money(p.netChange)})`).join('; ')}`);
  L.push('', `Q2. PROPERTY TYPES. ${record.q2.note}`);
  const q3 = record.q3;
  L.push('', `Q3. ${q3.label.toUpperCase()}. ${q3.caveats.join(' ')}`); line('Total deposits', q3.totalDeposits); line('Share in the buy-box metros', q3.buyboxShare);
  for (const m of q3.metros) L.push(`    ${m.label}${m.inBuybox ? '' : ' (not in the buy box)'}: deposits ${formatValue(m.deposits)}; share ${formatValue(m.share)}; branches ${formatValue(m.branches)}`);
  const q4 = record.q4;
  L.push('', `Q4. LOAN SIZES, NONFARM NONRESIDENTIAL ONLY (reported, as of ${dateLabel(q4.asOf)}). ${q4.note} ${q4.caveats.join(' ')}`);
  for (const b of q4.buckets) L.push(`    ${b.label} (original amount): ${formatValue(b.count)} loans; ${formatValue(b.dollars)}`);
  line('Under $1 million, number of loans', q4.under1m.count, '    '); line('Under $1 million, dollars', q4.under1m.dollars, '    '); line('Average loan under $1 million', q4.averageSmallLoan, '    ');
  line('$1 million or more, dollars', q4.over1m.dollars, '    '); line('$1 million or more, number of loans', q4.over1m.count, '    ');
  const q5 = record.q5;
  L.push('', `Q5. ${q5.label.toUpperCase()}. ${q5.caveats.join(' ')}`); for (const b of q5.buckets) line(b.label, b.value, '    '); line('Vintages', q5.vintages, '    ');
  L.push('', `Q6. SELLER EVIDENCE. ${record.q6.note}`);
  if (!record.q6.items.length) L.push('    None on file.');
  for (const i of record.q6.items) {
    L.push(`    ${dateLabel(i.date)}: ${i.label}${i.link ? ` (${i.link})` : ''}`);
    for (const [k, v] of Object.entries(i.values ?? {})) line(k, v, '      ');
    if (i.targetCre) line('Target CRE at its last report', i.targetCre, '      ');
  }
  const q7 = record.q7;
  L.push('', `Q7. FIT: BOUNDS ONLY${q7.provisional ? ' (PROVISIONAL)' : ''}. ${q7.note} Method: ${q7.formula}.`);
  for (const s of q7.sectors) {
    L.push(`  ${s.label} (inside ${s.category})`); line('In the buy box', s.bounds, '    ');
    for (const c of s.conditions) L.push(`    Condition ${c.id}: ${c.label}: ${c.share.low === c.share.high ? fmtUnit(c.share.low, 'pct') : `${fmtUnit(c.share.low, 'pct')} to ${fmtUnit(c.share.high, 'pct')}`}. ${c.basis}`);
    for (const n of s.notUsed) L.push(`    Not used, ${n.id}: ${n.reason}`);
    if (s.bounds.lowNote) L.push(`    ${s.bounds.lowNote}`);
  }
  L.push('', 'Q8. WHAT WE DO NOT KNOW'); for (const u of record.q8.unknowns) L.push(`  - ${u.text}`);
  L.push('', `THE TAPE REQUEST (${record.q8.tapeRequest.when})`); for (const t of record.q8.tapeRequest.items) L.push(`  - ${t}`);
  return `${L.join('\n')}\n`;
}
