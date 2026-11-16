// The Calibration page's logic (PRD next-five E17-S5), kept pure so it can be tested without a server. The record is the backtest's
// stored report (src/backtest/run.mjs, backtest/report-<hash>.json); nothing here computes a figure the report does not hold, and every
// sentence of the report's own (notes, words, the known limits) is shown as the report has it. Every other word the page shows is
// written here, so a test can read all of it. The wording follows S4: an observed-label yield, its lift and the share of observed labels
// captured; "too few to tune on" with the count below minLabels; the current all-axis tiers only in the table labelled context.
import { when } from './format.mjs';

export const PAGE = Object.freeze({
  title: 'Calibration',
  sub: 'The backtest of the score (PRD E17): whether the score, run on the data known at each past quarter-end, ranked banks under pressure before a dated public event. Read from the stored report. Read-only: this page runs nothing and writes nothing; the backtest runs from the command line.',
  loadError: 'The backtest report could not be loaded',
  sections: Object.freeze({ provenance: 'The run and its inputs', labelKinds: 'Label kinds', notes: 'Notes', words: 'Words', limits: 'Known limits', reports: 'Stored reports' }),
  reportsIntro: 'Every report the backtest has stored, newest first, from its run log (backtest/runs.jsonl). Open one to read it here.',
  reportsHead: Object.freeze(['Report', 'Run on', 'Kind of run', 'Scoring file hash', 'Labelled banks']),
  latest: 'latest',
  shown: 'shown above',
  scoringJson: 'scoring.json',
});

export const NO_REPORT = Object.freeze({
  title: 'No backtest report yet',
  intro: 'The backtest runs from the command line, against the data folder, never from this page. To make a report, run these in order:',
  steps: Object.freeze([
    Object.freeze({ command: 'outbound backtest panel', what: 'the point-in-time panel: the FDIC data as it stood at each past quarter-end (public data, no key).' }),
    Object.freeze({ command: 'outbound backtest labels', what: 'the labels: dated failures, assisted mergers and FDIC loan sales, from sources the score does not read.' }),
    Object.freeze({ command: 'outbound backtest run', what: 'the replay, which stores the report. Add --holdout, once, for the scoring file a principal has chosen.' }),
    Object.freeze({ command: 'outbound backtest report', what: 'prints the summary of the latest report.' }),
  ]),
  after: 'This page reads the platform\'s copy of the data folder. outbound platform push copies the folder in, the stored reports with it, and the latest report then shows here.',
});

const HASH = /^[0-9a-f]{16}$/;   // the backtest's REPORT_HASH
const NOT_IN_TOP = 'not in the top K';   // the backtest's key for a labelled bank that never entered the top K
const pct = (x) => (x === null || x === undefined ? '–' : `${(Number(x) * 100).toFixed(1)}%`);
const times = (x) => (x === null || x === undefined ? '–' : `${x}×`);
const num = (x) => (x === null || x === undefined ? '–' : String(x));
const banks = (n) => `${n} labelled bank${n === 1 ? '' : 's'}`;
const ofCount = (x, a, b) => (x === null || x === undefined ? '–' : `${pct(x)} (${a} of ${b})`);
const tooFew = (n, min) => `too few to tune on (${banks(n)}, fewer than minLabels ${min})`;
const readOf = (f, min) => f.note ?? (f.tooFewToTune ? tooFew(f.labelledBanks, min) : `${banks(f.labelledBanks)}: enough to read`);
const splitText = (key) => { const [by, a, ...b] = String(key).split(':'); return by === 'bank' ? `a bank holdout (share ${a}, seed "${b.join(':')}")` : `a quarter holdout from ${a}`; };

// ---- The kind of run ----------------------------------------------------------------------------------------------------------
const KIND = { training: 'Training', holdout: 'Holdout', compare: 'Compare (two scoring files)', rolling: 'Rolling origin' };
export function runKind({ mode, reusedHoldout } = {}) {
  const k = KIND[mode] ?? String(mode ?? 'Unknown');
  if (!reusedHoldout) return k;
  return mode === 'holdout' ? 'Reused holdout' : `${k} (reused holdout)`;
}

// ---- The list of stored reports -----------------------------------------------------------------------------------------------
// One row per report hash, from its latest line in the run log (the same inputs give the same hash, and the file holds the latest run).
export function reportList(runs = [], { shown = null } = {}) {
  const last = new Map();
  (runs ?? []).forEach((l, i) => { if (HASH.test(String(l?.reportHash ?? ''))) last.set(l.reportHash, { ...l, i }); });
  const latest = [...last.values()].sort((a, b) => b.i - a.i)[0]?.reportHash ?? null;
  return [...last.values()].sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? '')) || b.i - a.i).map((l) => ({
    hash: l.reportHash, href: `/calibration?report=${l.reportHash}`, at: l.at ?? null, date: when(l.at), kind: runKind(l),
    scoring: (l.scoring ?? []).join(', '), labelledBanks: num(l.labelledBanks), shown: l.reportHash === shown, latest: l.reportHash === latest,
  }));
}

// ---- One report -----------------------------------------------------------------------------------------------------------------
function holdoutRun(r) {
  const bank = r.split?.by === 'bank';
  const what = bank ? 'held-out banks' : 'holdout quarters';
  const reused = r.reusedHoldout ? `a REUSED HOLDOUT: these ${what} were scored before with a different scoring file (report ${(r.reusedFrom ?? []).join(', ')}). Its figures are no longer an unseen test, and a _calibration note should not cite them.` : null;
  if (r.mode === 'holdout') return reused ? `Yes, ${reused}` : `Yes: the ${what}, scored once for this scoring file. These are the figures a _calibration note may cite.`;
  if (r.mode === 'rolling') return `No: a rolling-origin run${bank ? ' on the training banks' : ''}. A _calibration note may cite one only when the holdout holds too few labelled banks.${reused ? ` It is also ${reused}` : ''}`;
  return `No: the ${bank ? 'training banks' : 'training quarters'} only. A _calibration note may not cite these figures; it cites a holdout report.`;
}

function banners(r) {
  const out = [];
  const bank = r.split?.by === 'bank';
  const i = r.inputs ?? {}, q = r.quarters ?? {};
  if (r.provisional) out.push({ tone: 'warn', text: `PROVISIONAL. The buy box still has placeholders (${(r.placeholders ?? []).join(', ')}). The hard filters ran with it as it stands. The headline figures do not use fit, but the context table does.` });
  if (r.reusedHoldout) out.push({ tone: 'error', text: `REUSED HOLDOUT. These ${bank ? 'held-out banks' : 'holdout quarters'} were scored before with a different scoring file (report ${(r.reusedFrom ?? []).join(', ')}). Its figures are no longer an unseen test, and a _calibration note should not cite them.` });
  if ((r.holdoutMovedFrom ?? []).length) out.push({ tone: 'warn', text: `The holdout moved. Earlier runs used ${r.holdoutMovedFrom.map(splitText).join('; ')}; this one uses ${splitText(i.holdout ?? `quarter:${i.holdoutFrom}`)}. ${bank ? 'Banks' : 'Quarters'} that were in an earlier holdout may have been looked at.` });
  if (r.rollingOffered && r.mode !== 'rolling') out.push({ tone: 'warn', text: `The holdout holds ${banks(r.holdoutLabelledBanks)}, fewer than minLabels (${i.minLabels}): too few to tune on. A rolling-origin split is offered instead (train on quarters up to T, test on T+1 to T+4, for each T): outbound backtest run --rolling` });
  const inc = q.horizonIncomplete ?? [];
  if (inc.length) out.push({ tone: 'warn', text: `${inc.length} as-of quarter(s) have a horizon that ends after ${q.labelsAsOf}, the date the labels are complete through: ${inc.join(', ')}. Their labels are incomplete, so their yields understate.` });
  return out;
}

function provenance(r) {
  const i = r.inputs ?? {}, q = r.quarters ?? {}, s = r.split ?? {};
  const ev = q.evaluated ?? [];
  return [
    { label: 'Report', value: r.hash },
    { label: 'Generated', value: when(r.generatedAt) },
    { label: 'Kind of run', value: `${runKind(r)}: ${r.modeLabel}` },
    { label: 'Holdout run', value: holdoutRun(r) },
    { label: 'PROVISIONAL', value: r.provisional ? `Yes: the buy box still has placeholders (${(r.placeholders ?? []).join(', ')}).` : 'No: the buy box has no placeholders.' },
    { label: 'Scoring file', value: (i.scoring ?? []).map((x) => `${x.path} (hash ${x.hash})`).join('; ') },
    { label: 'Buy box hash', value: num(i.buyboxHash) },
    { label: 'Panel run', value: num(i.panelRunId) },
    { label: 'Labels run', value: `${i.labelsRunId}, complete through ${q.labelsAsOf}` },
    { label: 'Holdout', value: s.by === 'bank'
      ? `by bank, a share of ${s.share} chosen by the seed "${s.seed}" (${s.heldOutBanks} bank(s)), across every as-of quarter. It holds ${banks(r.holdoutLabelledBanks)}.`
      : `by quarter, declared from ${i.holdoutFrom} (${(q.holdout ?? []).length} quarter(s)). It holds ${banks(r.holdoutLabelledBanks)}.` },
    { label: 'Horizon', value: `${i.horizonQuarters} quarters for the headline${(i.horizonsReported ?? []).length > 1 ? `; also reported at ${i.horizonsReported.join(', ')}` : ''}. K ${i.topK}. minLabels ${i.minLabels}.` },
    { label: 'As-of quarters evaluated', value: ev.length ? `${ev.length}, ${ev[0]} to ${ev.at(-1)}` : 'none' },
    { label: 'Data known on each date', value: `a Call Report from quarter-end plus ${i.callReportLagDays} days; the Summary of Deposits from June 30 plus ${i.sodReleaseLagDays} days.` },
  ];
}

const groupCells = (f) => {
  const t = f.groups.topK, d = f.groups.tierADistress;
  return [String(f.observations), `${f.labelledBanks} of ${f.banks}`, ofCount(f.baseRate, f.labelled, f.observations),
    ofCount(t.yield, t.labelled, t.observations), times(t.lift), ofCount(t.captured, t.labelled, f.labelled),
    ofCount(d.yield, d.labelled, d.observations), times(d.lift), ofCount(d.captured, d.labelled, f.labelled), num(f.leadTime?.median)];
};
const topKCells = (f) => [ofCount(f.baseRate, f.labelled, f.observations), ofCount(f.groups.topK.yield, f.groups.topK.labelled, f.groups.topK.observations), times(f.groups.topK.lift), ofCount(f.groups.topK.captured, f.groups.topK.labelled, f.labelled)];
// A table cell's rate and counts. Below minLabels it says so with its count; the table's intro names minLabels once.
const cellOf = (c) => [String(c.observations), String(c.labelled), { text: pct(c.rate), note: c.tooFewToTune ? `too few to tune on (${banks(c.labelledBanks)})` : null }];

function resultView(res, r) {
  const i = r.inputs ?? {}, min = i.minLabels;
  const h = res.headline;
  const bank = r.split?.by === 'bank';
  const K = h.all.groups.topK.k ?? i.topK, thr = h.all.groups.tierADistress.threshold;
  const whole = bank ? (r.mode === 'holdout' ? 'The held-out banks' : 'The training banks') : 'Every bank in the universe';
  const strata = [
    [whole, h.all, false], ['With a confirmed SEC filer', h.bySecFiler.withFiler, true], ['Without one', h.bySecFiler.withoutFiler, true],
    ['The metro subset', h.metro.all, false], ['With a confirmed SEC filer', h.metro.bySecFiler.withFiler, true], ['Without one', h.metro.bySecFiler.withoutFiler, true],
  ];
  const leadKeys = Object.keys(h.all.leadTime?.distribution ?? {});
  const hs = res.horizonSample ?? {};
  const rolling = r.mode === 'rolling' ? (bank ? ' Pooled over every as-of quarter, training banks only; the folds below are the test windows.' : ' Pooled over every as-of quarter, the holdout included; the folds below are the test windows.') : '';
  const yieldHead = `Top ${K}: observed-label yield`;
  return {
    title: `Headline: ${res.scoring.path} (hash ${res.scoring.hash})`, scoringPath: res.scoring.path, scoringHash: res.scoring.hash,
    headline: {
      intro: `Banks ranked by their distress and timing points only: fit is left out, since the buy box has no history to test. The groups are the top ${K} by that rank and the banks at or above the Tier A distress threshold (${thr} distress points). Each figure is split by whether the bank has a confirmed SEC filer, and repeated for the metro subset.${rolling}`,
      head: [
        [{ label: '', span: 4 }, { label: `Top ${K} by distress and timing`, span: 3 }, { label: `Distress at or above ${thr} (the Tier A distress threshold)`, span: 3 }, { label: '', span: 2 }],
        ['', 'Bank-quarters', 'Labelled banks', 'Base rate', 'Observed-label yield', 'Lift over the base rate', 'Share of observed labels captured', 'Observed-label yield', 'Lift over the base rate', 'Share of observed labels captured', 'Median lead time (quarters)', 'Read'],
      ],
      rows: strata.map(([label, f, sub]) => ({ label, sub, cells: groupCells(f), read: readOf(f, min) })),
      notes: [h.bySecFiler.note, h.metro.note].filter(Boolean),
    },
    metroSize: `The metro subset: ${h.metro.size.observations} bank-quarters, ${h.metro.size.banks} banks (a small sample).`,
    byEra: (res.byEra ?? []).length ? {
      title: 'By era (the headline horizon)',
      intro: 'The pooled figure above mixes eras. Read it with this table: a score that ranked distress in one era may not in another.',
      head: ['Era', 'As-of quarters', 'Bank-quarters', 'Labelled banks', 'Base rate', yieldHead, 'Lift over the base rate', 'Share of observed labels captured', 'Median lead time (quarters)', 'Read'],
      rows: res.byEra.map((e) => ({ label: `${e.label} (${e.from} to ${e.to})`, cells: [String(e.quarters), String(e.observations), `${e.labelledBanks} of ${e.banks}`, ...topKCells(e), num(e.leadTime?.median)], read: readOf(e, min) })),
    } : null,
    leadTime: {
      title: 'Lead time',
      intro: `For each labelled bank, how many quarter-ends before its first label it first entered the top ${K}, or that it never did within the headline horizon of ${i.horizonQuarters} quarters.`,
      head: ['', ...leadKeys.map((k) => (k === NOT_IN_TOP ? `Not in the top ${K} within the horizon` : `${k} quarter${k === '1' ? '' : 's'}`)), 'Labelled banks', 'Median'],
      rows: strata.map(([label, f, sub]) => ({ label, sub, cells: [...leadKeys.map((k) => String(f.leadTime?.distribution?.[k] ?? 0)), String(f.leadTime?.banks ?? 0), num(f.leadTime?.median)] })),
    },
    byHorizon: (res.byHorizon ?? []).length > 1 ? {
      title: 'By horizon',
      intro: hs.quarters
        ? `The same ranking, with a label counted when it falls within each horizon. Every horizon is computed on the same ${hs.quarters} as-of quarter(s), ${hs.from} to ${hs.to}: those whose longest horizon (${hs.longest} quarters) ends by the labels' date.${hs.left ? ` The ${hs.left} later quarter(s) are left out here, so this table does not match the headline exactly.` : ''} On this common sample, strong at long horizons and weak at short ones means the score is early; the reverse, late.`
        : `No as-of quarter has a complete ${hs.longest}-quarter horizon yet, so the horizons cannot be compared on a common sample.`,
      head: ['Horizon (quarters)', 'Base rate', yieldHead, 'Lift over the base rate', 'Share of observed labels captured', 'Median lead time (quarters)', 'Labelled banks', 'Read'],
      rows: hs.quarters ? res.byHorizon.map((b) => ({ label: `${b.horizon}${b.headline ? ' (headline)' : ''}`, cells: [...topKCells(b), num(b.leadTime?.median), `${b.labelledBanks} of ${b.banks}`], read: readOf(b, min) })) : [],
    } : null,
    components: {
      title: 'Per component',
      intro: `For each component of the scoring file, the labelled rate among bank-quarters where it scored more than 0, against the rest, with their counts. It shows which components carry the score and which add nothing. Below minLabels (${min}) labelled banks, a rate says "too few to tune on", with its count.`,
      head: [
        [{ label: '', span: 3 }, { label: 'Scored more than 0', span: 3 }, { label: 'The rest', span: 3 }],
        ['Component', 'Axis', 'Weight', 'Bank-quarters', 'Labelled', 'Labelled rate', 'Bank-quarters', 'Labelled', 'Labelled rate'],
      ],
      rows: (res.components ?? []).map((c) => ({ label: c.id, labelNote: c.note ?? null, cells: [c.axis, String(c.weight), ...cellOf(c.scored), ...cellOf(c.rest)] })),
    },
    context: {
      title: 'Context: the current all-axis tiers',
      label: res.context?.label ?? null,
      head: ['Tier', 'Bank-quarters', 'Labelled', 'Labelled rate'],
      rows: [['A', 'Tier A'], ['B', 'Tier B'], ['untiered', 'Untiered']].filter(([k]) => res.context?.tiers?.[k]).map(([k, label]) => ({ label, cells: cellOf(res.context.tiers[k]) })),
    },
  };
}

function foldsView(r) {
  const K = r.inputs?.topK;
  return {
    title: 'Rolling origin',
    intro: 'Each fold tests the quarters after T; the scoring file is fixed, so "train" names the quarters a principal may tune on for that fold.',
    head: ['Train to', 'Test quarters', 'Bank-quarters', 'Labelled banks', 'Base rate', `Top ${K}: observed-label yield`, 'Lift over the base rate', 'Share of observed labels captured', 'Read'],
    rows: r.folds.map((f) => ({ label: f.trainTo, cells: [`${f.test[0]} to ${f.test.at(-1)}`, String(f.observations), `${f.labelledBanks} of ${f.banks}`, ...topKCells(f)], read: readOf(f, r.inputs?.minLabels) })),
  };
}

export function reportView(r) {
  const kind = runKind(r);
  return {
    hash: r.hash, kind,
    title: `${r.provisional ? 'PROVISIONAL: ' : ''}Backtest report ${r.hash}`,
    sub: `${kind}: ${r.modeLabel}. Generated ${when(r.generatedAt)}. The known limits at the end apply to every figure.`,
    banners: banners(r),
    provenance: provenance(r),
    labelKinds: Object.entries(r.labelKinds ?? {}).map(([k, x]) => `${k}: ${x.status}${x.status === 'on' ? `, ${x.labels} label(s)` : ''}${x.reasons?.length ? `. ${x.reasons.join(' ')}` : ''}`),
    results: (r.results ?? []).map((res) => resultView(res, r)),
    folds: Array.isArray(r.folds) ? foldsView(r) : null,
    notes: [...(r.notes ?? [])],
    words: [...(r.words ?? [])],
    limits: [...(r.limits ?? [])],
    scoringJson: r.scoringJson ?? null,
  };
}

// The whole page: the report shown (or how to make one), and the list of stored reports.
export function calibrationPage({ report = null, runs = [], notice = null } = {}) {
  return {
    page: PAGE,
    notice: notice ?? null,
    report: report ? reportView(report) : null,
    noReport: !report && !(runs ?? []).length ? NO_REPORT : null,
    reports: reportList(runs, { shown: report?.hash ?? null }),
  };
}
