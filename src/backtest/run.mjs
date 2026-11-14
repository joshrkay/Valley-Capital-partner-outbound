// The backtest's replay and report (PRD E17-S3, S4). For each as-of quarter in the panel, the SAME scoreBank as the live pipeline
// (imported from src/score.mjs, never copied) runs on the data known on that date, and its ranking is compared with the labels inside
// a horizon after it. Deterministic: no model, no network, no clock but the report's timestamp. It reads the panel, the labels and
// the scoring files, and writes backtest/report-<hash>.json and .md, a line in backtest/runs.jsonl, and for a holdout run a line in
// backtest/holdout.jsonl. It never writes scoring.json: a principal changes weights, in a PR whose _calibration note names a holdout
// report's hash.
//
// The headline leaves out fit: Tier A needs fit, and fit (the buy box) has no history. So every headline figure ranks banks by their
// distress and timing points only. The current all-axis tiers are a separate table, labelled context.
// Labels are incomplete, and the words say so: an observed-label yield, its lift over the base rate, and the share of observed labels
// captured. A bank with no observed label is unlabelled.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readJson, writeJson, writeText, readJsonl, appendJsonl, listFiles, audit } from '../store.mjs';
import { scoreBank, contentHash, validateScoring, validateBuybox } from '../score.mjs';
import { shiftQuarter } from '../metrics.mjs';
import { backtestPaths, readPanel, pointInTime, isoOf, repOf } from './panel.mjs';
import { readLabels } from './labels.mjs';

export const MODES = Object.freeze(['training', 'holdout', 'compare', 'rolling']);
const MODE_LABEL = { training: 'training quarters (the holdout left out)', holdout: 'HOLDOUT quarters', compare: 'two scoring files side by side, training quarters only', rolling: 'rolling origin (train to T, test T+1 to T+4)' };
export const REPORT_HASH = /^[0-9a-f]{16}$/;
export const NOT_IN_TOP = 'not in the top K';

// Stated on every report, word for word.
export const KNOWN_LIMITS = Object.freeze([
  'Amended figures: the FDIC API serves Call Report figures as amended, not as first filed, so each as-of quarter sees a little of what was corrected later. This is a small look-ahead leak.',
  'Labels are forced events: most labels are a failure, an assisted merger or an FDIC loan sale. Being forced to sell is a stronger condition than being willing to sell, so a good result shows that the score finds pressure. It does not show that the score finds sellers; the outcomes report (E15-S4) decides that.',
  'The fit axis is not tested: fit is about the buy box, which has no history. Fit is computed and shown in the context table, and kept out of every headline figure.',
  'Unlabelled banks are not negatives: public sources miss many real sales, so a bank with no observed label is unlabelled, not safe. Every rate here is an observed-label rate, and it understates the true one.',
]);
export const WORDS = Object.freeze([
  'Bank-quarter: one bank in the universe on one as-of date, scored on the data known then. A bank-quarter is labelled when the bank has an observed label within the horizon after that date.',
  'Base rate: the share of bank-quarters in the universe that are labelled.',
  'Observed-label yield: the share of a group\'s bank-quarters that are labelled. Lift: the yield divided by the base rate.',
  'Share of observed labels captured: the labelled bank-quarters that were in the group, out of all labelled bank-quarters.',
  'Lead time: for each labelled bank, how many quarter-ends before its first label it first entered the top K (1 to the horizon), or that it never did.',
]);

const r4 = (x) => Math.round(x * 1e4) / 1e4;
const r2 = (x) => Math.round(x * 100) / 100;
const QE = /^\d{4}-(03-31|06-30|09-30|12-31)$/;
const horizonEnd = (asOf, h) => isoOf(shiftQuarter(repOf(asOf), h));
const quarterEndsBefore = (asOf, date) => { let n = 0; for (let r = repOf(asOf); isoOf(r) < date; r = shiftQuarter(r, 1)) n++; return n; };

// ---- The replay -----------------------------------------------------------------------------------------------------------------
// One observation per bank-quarter: the points by axis and component, the all-axis tier (context), and the first label in the horizon.
export function replay({ panel, quarters, scoring, buybox, metros, labelIndex, horizon, k, secFilers = new Set() }) {
  const metroCodes = new Set((metros?.metros ?? []).map((m) => String(m.cbsa)));
  const tierA = scoring.tiers?.A?.distress ?? Infinity;
  const obs = [], byQuarter = [], topByQuarter = {};
  for (const d of quarters) {
    const pit = pointInTime({ panel, asOf: d });
    const end = horizonEnd(d, horizon);
    const rows = pit.banks.map((b) => {
      const item = scoreBank({ ...b, scoring, buybox, metros });
      const label = (labelIndex.get(item.key) ?? []).find((l) => l.date > d && l.date <= end) ?? null;
      return {
        asOf: d, key: item.key, cert: item.cert, distress: item.axes.distress, timing: item.axes.timing, fit: item.axes.fit, dt: r2(item.axes.distress + item.axes.timing),
        score: item.score, tier: item.tier, points: Object.fromEntries(item.components.map((c) => [c.id, c.points])),
        metro: Object.entries(b.footprint.branchesByMetro ?? {}).some(([c, n]) => metroCodes.has(String(c)) && Number(n) > 0), secFiler: secFilers.has(item.key),
        label: label ? { kind: label.kind, date: label.date } : null,
      };
    });
    // The headline rank: distress and timing points only, banks above 0, ties broken by FDIC cert so the group is reproducible.
    const ranked = rows.filter((r) => r.dt > 0).sort((a, b) => (b.dt - a.dt) || (Number(a.cert) - Number(b.cert))).slice(0, k);
    const top = new Set(ranked.map((r) => r.key));
    for (const r of rows) { r.inTopK = top.has(r.key); r.tierADistress = r.distress >= tierA; }
    obs.push(...rows);
    byQuarter.push({ asOf: d, knownQuarter: pit.knownQuarter, sodYear: pit.sodYear, universe: pit.universeSize, scored: rows.length, notScored: pit.notScored.length,
      labelled: rows.filter((r) => r.label).length, topKLabelled: ranked.filter((r) => r.label).length, horizonEnd: end });
    topByQuarter[d] = ranked.map((r) => ({ key: r.key, distress: r.distress, timing: r.timing, label: r.label }));
  }
  return { obs, byQuarter, topByQuarter };
}

// ---- The figures ----------------------------------------------------------------------------------------------------------------
const tooFewNote = (n, min) => `too few to tune on (${n} labelled bank${n === 1 ? '' : 's'}, fewer than minLabels ${min})`;

export function figures(obs, { k, horizon, minLabels, tierADistress }) {
  const lab = obs.filter((o) => o.label);
  const labelledBanks = new Set(lab.map((o) => o.key));
  const base = obs.length ? lab.length / obs.length : null;
  const group = (flag, extra) => {
    const g = obs.filter((o) => o[flag]);
    const gl = g.filter((o) => o.label);
    const y = g.length ? gl.length / g.length : null;
    return { ...extra, observations: g.length, labelled: gl.length, banks: new Set(g.map((o) => o.key)).size, labelledBanks: new Set(gl.map((o) => o.key)).size,
      yield: y === null ? null : r4(y), lift: y === null || !base ? null : r2(y / base), captured: lab.length ? r4(gl.length / lab.length) : null };
  };
  const distribution = Object.fromEntries([...Array.from({ length: horizon }, (_, i) => [String(i + 1), 0]), [NOT_IN_TOP, 0]]);
  const leads = [];
  for (const key of labelledBanks) {
    const mine = lab.filter((o) => o.key === key);
    const first = mine.map((o) => o.label.date).sort()[0];
    const hit = mine.filter((o) => o.label.date === first).sort((a, b) => a.asOf.localeCompare(b.asOf)).find((o) => o.inTopK);
    if (!hit) { distribution[NOT_IN_TOP]++; continue; }
    const lead = quarterEndsBefore(hit.asOf, first);
    distribution[String(lead)]++; leads.push(lead);
  }
  leads.sort((a, b) => a - b);
  const tooFew = labelledBanks.size < minLabels;
  return {
    observations: obs.length, labelled: lab.length, banks: new Set(obs.map((o) => o.key)).size, labelledBanks: labelledBanks.size, baseRate: base === null ? null : r4(base),
    groups: {
      topK: group('inTopK', { k, rule: 'the top K by distress and timing points only (banks with more than 0 points; fewer than K when fewer score)' }),
      tierADistress: group('tierADistress', { threshold: tierADistress, rule: 'distress points at or above the Tier A distress threshold' }),
    },
    leadTime: { unit: 'quarter-ends before the label', banks: labelledBanks.size, distribution, median: leads.length ? leads[Math.floor((leads.length - 1) / 2)] : null },
    tooFewToTune: tooFew, note: tooFew ? tooFewNote(labelledBanks.size, minLabels) : `${labelledBanks.size} labelled banks: enough to read; a principal decides whether any weight changes`,
  };
}

const COVERAGE_NOTE = 'Banks with a confirmed SEC filer could show every label kind; the others only the FDIC kinds. A difference between the two is a coverage effect, not a scoring effect.';
const METRO_NOTE = 'The banks with a Summary of Deposits branch in the six metros on the as-of date: a small sample. The groups are the universe\'s; this counts which of these banks were in them.';
const CONTEXT_LABEL = 'Context only: the current all-axis tiers, which need fit, and fit has no history to test. A _calibration note may never cite these.';

function block(obs, opts) {
  return { all: figures(obs, opts), bySecFiler: { withFiler: figures(obs.filter((o) => o.secFiler), opts), withoutFiler: figures(obs.filter((o) => !o.secFiler), opts), note: COVERAGE_NOTE } };
}
function cell(g, minLabels) {
  const gl = g.filter((o) => o.label);
  const n = new Set(gl.map((o) => o.key)).size;
  return { observations: g.length, labelled: gl.length, rate: g.length ? r4(gl.length / g.length) : null, labelledBanks: n, ...(n < minLabels ? { tooFewToTune: true } : {}) };
}

function results({ obs, byQuarter, topByQuarter, scoring, file, opts }) {
  const metroObs = obs.filter((o) => o.metro);
  const headline = { ...block(obs, opts), metro: { ...block(metroObs, opts), size: { observations: metroObs.length, banks: new Set(metroObs.map((o) => o.key)).size }, note: METRO_NOTE } };
  const components = (scoring.components ?? []).map((c) => {
    const pos = (o) => (o.points[c.id] ?? 0) > 0;
    const split = (sub) => ({ scored: cell(sub.filter(pos), opts.minLabels), rest: cell(sub.filter((o) => !pos(o)), opts.minLabels) });
    return { id: c.id, axis: c.axis, weight: c.weight, ...split(obs), bySecFiler: { withFiler: split(obs.filter((o) => o.secFiler)), withoutFiler: split(obs.filter((o) => !o.secFiler)) },
      ...(c.axis === 'fit' ? { note: 'a fit component: not tested, since fit has no history' } : {}) };
  });
  const context = { label: CONTEXT_LABEL, tiers: { A: cell(obs.filter((o) => o.tier === 'A'), opts.minLabels), B: cell(obs.filter((o) => o.tier === 'B'), opts.minLabels), untiered: cell(obs.filter((o) => !o.tier), opts.minLabels) } };
  return { scoring: { path: file.path, hash: file.hash }, headline, components, context, byQuarter, topByQuarter };
}

// ---- The run --------------------------------------------------------------------------------------------------------------------
function loadScoringFiles({ rules, scoringPaths }) {
  const files = scoringPaths.length
    ? scoringPaths.map((path) => { let s; try { s = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { throw new Error(`Cannot read the scoring file ${path}: ${e.message}`); } return { path, scoring: s }; })
    : [{ path: 'scoring.json', scoring: rules.scoring }];
  for (const f of files) {
    const v = validateScoring(f.scoring);
    if (!v.ok) throw new Error(`${f.path} has errors:\n  ${v.errors.join('\n  ')}`);
    f.hash = contentHash(f.scoring);
  }
  return files;
}

export function runBacktest({ dir, rules, mode = 'training', scoringPaths = [], horizon, k, now = new Date() }) {
  if (!MODES.includes(mode)) throw new Error(`Unknown mode "${mode}" (${MODES.join(', ')}).`);
  const cfg = rules.config?.backtest ?? {};
  if (!QE.test(String(cfg.holdoutFrom ?? ''))) throw new Error('config.backtest.holdoutFrom must be declared before any backtest runs: the first as-of quarter of the holdout, a quarter-end date (YYYY-MM-DD). Decision D-B5.');
  const panel = readPanel(dir);
  if (!panel) throw new Error('No backtest panel yet. Run: outbound backtest panel');
  const labels = readLabels(dir);
  if (!labels) throw new Error('No labels yet. Run: outbound backtest labels');
  const files = loadScoringFiles({ rules, scoringPaths });
  if (mode === 'compare' && files.length !== 2) throw new Error('--compare needs two scoring files: outbound backtest run --compare A B');
  if (mode === 'holdout' && files.length !== 1) throw new Error('The holdout is scored for one scoring file only, the one a principal has chosen (--holdout [--scoring PATH]).');
  if (mode !== 'compare' && mode !== 'holdout' && files.length !== 1) throw new Error('Give one scoring file with --scoring PATH, or two with --compare A B.');
  const H = horizon ?? cfg.horizonQuarters ?? 4, K = k ?? cfg.topK ?? 25, minLabels = cfg.minLabels ?? 20;
  for (const [name, v] of [['the horizon', H], ['K', K]]) if (!(Number.isInteger(v) && v >= 1)) throw new Error(`${name} must be a whole number of 1 or more.`);
  const vb = validateBuybox(rules.buybox, { metros: rules.metros });
  if (vb.errors.length) throw new Error(`buybox.json has errors:\n  ${vb.errors.join('\n  ')}`);

  const bp = backtestPaths(dir);
  const all = panel.state.asOf;
  const training = all.filter((d) => d < cfg.holdoutFrom), holdout = all.filter((d) => d >= cfg.holdoutFrom);
  const evaluated = mode === 'holdout' ? holdout : mode === 'rolling' ? all : training;
  if (!evaluated.length) throw new Error(`No ${mode === 'holdout' ? 'holdout' : 'training'} quarters: the panel runs ${all[0]} to ${all.at(-1)} and config.backtest.holdoutFrom is ${cfg.holdoutFrom}.`);
  if (mode === 'rolling' && all.length < 5) throw new Error('A rolling-origin split needs at least 5 as-of quarters (train to T, test T+1 to T+4).');

  // The labels that count, by bank, oldest first.
  const on = Object.entries(labels.kinds ?? {}).filter(([, x]) => x.status === 'on').map(([kind]) => kind);
  const labelIndex = new Map();
  for (const l of labels.labels ?? []) if (on.includes(l.kind)) { if (!labelIndex.has(l.key)) labelIndex.set(l.key, []); labelIndex.get(l.key).push(l); }
  for (const list of labelIndex.values()) list.sort((a, b) => a.date.localeCompare(b.date));
  const secFilers = new Set(labels.coverage?.secFilers ?? []);

  // How many labelled banks the holdout holds: labels and the universe only, no score, so counting them reveals nothing about a ranking.
  const holdoutLabelled = new Set();
  for (const d of holdout) {
    const u = panel.universe[d]; const end = horizonEnd(d, H);
    for (const [cert, m] of Object.entries(u?.members ?? {})) if (m.rows && (labelIndex.get(`fdic:${cert}`) ?? []).some((l) => l.date > d && l.date <= end)) holdoutLabelled.add(cert);
  }

  const inputs = {
    scoring: files.map((f) => ({ path: f.path, hash: f.hash })), buyboxHash: contentHash(rules.buybox), panelRunId: panel.state.runId, labelsRunId: labels.runId,
    holdoutFrom: cfg.holdoutFrom, horizonQuarters: H, topK: K, minLabels, labelKinds: on, callReportLagDays: panel.state.callReportLagDays, sodReleaseLagDays: panel.state.sodReleaseLagDays,
  };
  // The report's name: a hash of what it was computed from. A scoring file counts by its content, not by where it is.
  const hash = contentHash({ mode, inputs: { ...inputs, scoring: files.map((f) => f.hash) }, evaluated, metros: (rules.metros?.metros ?? []).map((m) => m.cbsa) });

  const out = files.map((file) => {
    const opts = { k: K, horizon: H, minLabels, tierADistress: file.scoring.tiers?.A?.distress ?? null };
    const r = replay({ panel, quarters: evaluated, scoring: file.scoring, buybox: rules.buybox, metros: rules.metros, labelIndex, horizon: H, k: K, secFilers });
    for (const q of r.byQuarter) q.horizonComplete = q.horizonEnd <= labels.labelsAsOf;
    const res = results({ ...r, scoring: file.scoring, file, opts });
    if (mode === 'rolling') {
      res.folds = [];
      for (let i = 0; i + 4 < all.length; i++) {
        const test = all.slice(i + 1, i + 5);
        const f = figures(r.obs.filter((o) => test.includes(o.asOf)), opts);
        res.folds.push({ trainTo: all[i], train: all.slice(0, i + 1), test, ...f });
      }
    }
    return res;
  });

  // The holdout is scored once. A later holdout run on the same quarters with a different scoring file has seen them: reused.
  const holdoutLog = readJsonl(bp.holdout);
  const touchesHoldout = mode === 'holdout' || mode === 'rolling';
  const prior = holdoutLog.filter((l) => (l.quarters ?? []).some((q) => holdout.includes(q)) && l.scoringHash !== files[0].hash);
  const reusedHoldout = touchesHoldout && prior.length > 0;
  const earlierRuns = readJsonl(bp.runs);
  const movedFrom = [...new Set(earlierRuns.map((l) => l.holdoutFrom).filter((h) => h && h !== cfg.holdoutFrom))];

  const notes = [
    'Groups are ranked over the whole universe each quarter; the strata and the metro subset count which of their banks were in each group.',
    'Branches and deposits come from the Summary of Deposits released by each as-of date (the live list counts branches from FDIC /locations today). Headquarters state is FDIC\'s state for the charter today, or when it closed.',
    'Event signals from SEC filings and the sale ledger are not replayed; they add no points, so no figure here would change. Structure events are, from their own dates.',
    'The SEC filer strata use the filers confirmed today (sources/edgar/filers.json), not as they stood on each as-of date.',
    ...(panel.state.suspect ? [`The panel run ${panel.state.runId} was suspect: coverage below minCoverage on ${panel.state.coverageBelow.join(', ')}. Read the figures for those quarters with care (outbound backtest verify).`] : []),
    ...(labels.panelRunId && labels.panelRunId !== panel.state.runId ? [`The labels were built against an earlier panel (run ${labels.panelRunId}). Rebuild them: outbound backtest labels`] : []),
    ...(cfg.callReportLagDays !== undefined && cfg.callReportLagDays !== panel.state.callReportLagDays ? [`config.backtest.callReportLagDays is ${cfg.callReportLagDays}, but the panel was built with ${panel.state.callReportLagDays}, which the replay uses. Re-pull the panel to change it.`] : []),
    ...(cfg.sodReleaseLagDays !== undefined && cfg.sodReleaseLagDays !== panel.state.sodReleaseLagDays ? [`config.backtest.sodReleaseLagDays is ${cfg.sodReleaseLagDays}, but the panel was built with ${panel.state.sodReleaseLagDays}, which the replay uses. Re-pull the panel to change it.`] : []),
  ];
  const report = {
    kind: 'backtest-report', hash, generatedAt: now.toISOString(), provisional: vb.placeholders.length > 0, placeholders: vb.placeholders,
    mode, modeLabel: MODE_LABEL[mode], reusedHoldout, reusedFrom: [...new Set(prior.map((l) => l.reportHash))], holdoutMovedFrom: movedFrom, inputs,
    quarters: { all, training, holdout, evaluated, horizonIncomplete: evaluated.filter((d) => horizonEnd(d, H) > labels.labelsAsOf), labelsAsOf: labels.labelsAsOf },
    labelKinds: labels.kinds, holdoutLabelledBanks: holdoutLabelled.size, rollingOffered: holdoutLabelled.size < minLabels,
    results: out, ...(mode === 'rolling' ? { folds: out[0].folds } : {}),
    notes, words: [...WORDS], limits: [...KNOWN_LIMITS],
    scoringJson: 'unchanged: the backtest never writes scoring.json. A principal changes weights in a PR whose _calibration note names a holdout report hash.',
  };
  const paths = { json: bp.report(hash, 'json'), md: bp.report(hash, 'md') };
  writeJson(paths.json, report);
  writeText(paths.md, renderReport(report));
  const head = out[0].headline.all;
  const counts = { quarters: evaluated.length, observations: head.observations, labelledBanks: head.labelledBanks };
  appendJsonl(bp.runs, { at: now.toISOString(), mode, reportHash: hash, scoring: files.map((f) => f.hash), buyboxHash: inputs.buyboxHash, panelRunId: inputs.panelRunId, labelsRunId: inputs.labelsRunId,
    holdoutFrom: cfg.holdoutFrom, horizonQuarters: H, topK: K, reusedHoldout, ...counts });
  if (touchesHoldout) appendJsonl(bp.holdout, { at: now.toISOString(), mode, reportHash: hash, scoringHash: files[0].hash, quarters: evaluated.filter((d) => holdout.includes(d)), holdoutFrom: cfg.holdoutFrom, panelRunId: inputs.panelRunId, labelsRunId: inputs.labelsRunId });
  audit(dir, { type: 'backtest_run', mode, reportHash: hash, reusedHoldout, ...counts });
  return { hash, report, paths };
}

export function readReport({ dir, hash } = {}) {
  const bp = backtestPaths(dir);
  if (hash) { if (!REPORT_HASH.test(String(hash))) throw new Error(`"${hash}" is not a report hash (16 hexadecimal characters).`); return readJson(bp.report(hash, 'json'), null); }
  const last = readJsonl(bp.runs).at(-1)?.reportHash;
  if (last) return readJson(bp.report(last, 'json'), null);
  const files = listFiles(bp.base, '.json').filter((f) => /^report-[0-9a-f]{16}\.json$/.test(f)).map((f) => readJson(join(bp.base, f)));
  return files.sort((a, b) => String(a.generatedAt).localeCompare(String(b.generatedAt))).at(-1) ?? null;
}

// The note a PR adds to scoring.json when it changes weights on the strength of a backtest: { report, evaluation, by, on }.
export function validateCalibration(note) {
  if (!note || typeof note !== 'object' || Array.isArray(note)) return ['_calibration must be an object: { report, evaluation, by, on }'];
  const e = [];
  if (!REPORT_HASH.test(String(note.report ?? ''))) e.push('_calibration.report must name a backtest report by its hash: 16 hexadecimal characters, as in backtest/report-<hash>.json');
  if (!['holdout', 'rolling-origin'].includes(note.evaluation)) e.push('_calibration.evaluation must be "holdout" (or "rolling-origin" when the holdout holds too few labelled banks): a note may cite holdout figures only');
  if (!String(note.by ?? '').trim()) e.push('_calibration.by must name the principal who read the report');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(note.on ?? ''))) e.push('_calibration.on must be a date, YYYY-MM-DD');
  return e;
}

// ---- Rendering ------------------------------------------------------------------------------------------------------------------
const pct = (x) => (x === null || x === undefined ? '–' : `${(x * 100).toFixed(1)}%`);
const lift = (x) => (x === null || x === undefined ? '–' : `${x}×`);
const groupRow = (name, g) => `| ${name} | ${g.observations} | ${g.labelled} | ${pct(g.yield)} | ${lift(g.lift)} | ${pct(g.captured)} |`;
const GROUP_HEAD = ['| Group | Bank-quarters | Labelled | Observed-label yield | Lift over the base rate | Share of observed labels captured |', '|---|---|---|---|---|---|'];
const groupName = (f, which) => (which === 'topK' ? `Top ${f.groups.topK.k} by distress and timing` : `Distress at or above ${f.groups.tierADistress.threshold} (the Tier A distress threshold)`);

function figureLines(f, title) {
  return [
    `${title}Base rate: ${pct(f.baseRate)} of ${f.observations} bank-quarters (${f.labelled} labelled; ${f.labelledBanks} labelled bank(s) of ${f.banks}).${f.tooFewToTune ? ` **${f.note}.**` : ''}`, '',
    ...GROUP_HEAD, groupRow(groupName(f, 'topK'), f.groups.topK), groupRow(groupName(f, 'tierADistress'), f.groups.tierADistress), '',
    `Lead time over ${f.leadTime.banks} labelled bank(s), quarter-ends from first entering the top K to the label: ${Object.entries(f.leadTime.distribution).map(([q, n]) => `${q === NOT_IN_TOP ? `${NOT_IN_TOP} within the horizon` : `${q} quarter${q === '1' ? '' : 's'}`}: ${n}`).join('; ')}. Median ${f.leadTime.median ?? '–'}.`, '',
  ];
}
const strataRow = (name, f) => `| ${name} | ${f.observations} | ${f.labelledBanks} | ${pct(f.baseRate)} | ${pct(f.groups.topK.yield)} | ${lift(f.groups.topK.lift)} | ${pct(f.groups.topK.captured)} | ${pct(f.groups.tierADistress.yield)} | ${lift(f.groups.tierADistress.lift)} | ${f.tooFewToTune ? f.note : 'enough to read'} |`;
const STRATA_HEAD = ['| | Bank-quarters | Labelled banks | Base rate | Top K yield | Top K lift | Top K captured | Tier A distress yield | Tier A distress lift | |', '|---|---|---|---|---|---|---|---|---|---|'];
const cellText = (c) => `${c.observations} | ${c.labelled} | ${pct(c.rate)}${c.tooFewToTune ? ' (too few to tune on)' : ''}`;

export function renderReport(r) {
  const L = [];
  L.push(r.provisional ? `# PROVISIONAL: backtest of the score, report ${r.hash}` : `# Backtest of the score, report ${r.hash}`, '');
  if (r.provisional) L.push(`**PROVISIONAL.** The buy box still has placeholders (${r.placeholders.join(', ')}). The hard filters ran with it as it stands. The headline figures do not use fit, but the context table does.`, '');
  L.push(`Mode: ${r.modeLabel}. Generated ${r.generatedAt}. The known limits at the end apply to every figure.`, '');
  if (r.reusedHoldout) L.push(`**REUSED HOLDOUT.** These holdout quarters were scored before with a different scoring file (report ${r.reusedFrom.join(', ')}). Its figures are no longer an unseen test, and a _calibration note should not cite them.`, '');
  if (r.holdoutMovedFrom.length) L.push(`**The holdout moved.** Earlier runs used holdoutFrom ${r.holdoutMovedFrom.join(', ')}; this one uses ${r.inputs.holdoutFrom}. Quarters that were in an earlier holdout may have been looked at.`, '');
  const i = r.inputs;
  L.push('## Inputs', '',
    ...i.scoring.map((s) => `- Scoring file: ${s.path} (hash ${s.hash})`),
    `- Buy box: hash ${i.buyboxHash}`, `- Panel run: ${i.panelRunId}. Labels run: ${i.labelsRunId}, complete through ${r.quarters.labelsAsOf}.`,
    `- Holdout: declared from ${i.holdoutFrom} (${r.quarters.holdout.length} quarter(s): ${r.quarters.holdout.join(', ') || 'none'}). It holds ${r.holdoutLabelledBanks} labelled bank(s).`,
    `- Horizon: ${i.horizonQuarters} quarter(s). K: ${i.topK}. minLabels: ${i.minLabels}. A Call Report counts from quarter-end plus ${i.callReportLagDays} days; the Summary of Deposits from June 30 plus ${i.sodReleaseLagDays} days.`,
    `- As-of quarters evaluated: ${r.quarters.evaluated.join(', ')}.`, '');
  if (r.rollingOffered && r.mode !== 'rolling') L.push(`The holdout holds ${r.holdoutLabelledBanks} labelled bank(s), fewer than minLabels (${i.minLabels}): too few to tune on. A rolling-origin split is offered instead (train on quarters up to T, test on T+1 to T+4, for each T): outbound backtest run --rolling`, '');
  if (r.quarters.horizonIncomplete.length) L.push(`${r.quarters.horizonIncomplete.length} as-of quarter(s) have a horizon that ends after ${r.quarters.labelsAsOf}, the date the labels are complete through: ${r.quarters.horizonIncomplete.join(', ')}. Their horizon runs past the labels, so their labels are incomplete and their yields understate.`, '');
  L.push('## Label kinds', '', ...Object.entries(r.labelKinds).map(([k, x]) => `- ${k}: ${x.status}${x.status === 'on' ? `, ${x.labels} label(s)` : ''}${x.reasons?.length ? `. ${x.reasons.join(' ')}` : ''}`), '');

  if (r.mode === 'compare') {
    const [a, b] = r.results;
    const row = (name, fa, fb) => `| ${name} | ${fa} | ${fb} |`;
    const ha = a.headline.all, hb = b.headline.all;
    L.push('## Side by side (training quarters only)', '', `| | ${a.scoring.path} | ${b.scoring.path} |`, '|---|---|---|',
      row('Scoring hash', a.scoring.hash, b.scoring.hash), row('Base rate', pct(ha.baseRate), pct(hb.baseRate)),
      row('Top K yield', pct(ha.groups.topK.yield), pct(hb.groups.topK.yield)), row('Top K lift', lift(ha.groups.topK.lift), lift(hb.groups.topK.lift)),
      row('Top K share captured', pct(ha.groups.topK.captured), pct(hb.groups.topK.captured)),
      row('Tier A distress yield', pct(ha.groups.tierADistress.yield), pct(hb.groups.tierADistress.yield)), row('Tier A distress lift', lift(ha.groups.tierADistress.lift), lift(hb.groups.tierADistress.lift)),
      row('Median lead time (quarters)', ha.leadTime.median ?? '–', hb.leadTime.median ?? '–'), row('Labelled banks', `${ha.labelledBanks}${ha.tooFewToTune ? ' (too few to tune on)' : ''}`, `${hb.labelledBanks}${hb.tooFewToTune ? ' (too few to tune on)' : ''}`), '');
  }
  for (const res of r.results) {
    const h = res.headline;
    L.push(`## Headline: ${res.scoring.path} (distress and timing points only; fit left out)`, '', ...(r.mode === 'rolling' ? ['Pooled over every as-of quarter, the holdout included; the folds below are the test windows.', ''] : []), ...figureLines(h.all, ''));
    L.push('### By label coverage', '', ...STRATA_HEAD, strataRow('With a confirmed SEC filer', h.bySecFiler.withFiler), strataRow('Without one', h.bySecFiler.withoutFiler), '', h.bySecFiler.note, '');
    L.push(`### The metro subset: ${h.metro.size.observations} bank-quarters, ${h.metro.size.banks} banks (a small sample)`, '', ...STRATA_HEAD, strataRow('All in the subset', h.metro.all), strataRow('With a confirmed SEC filer', h.metro.bySecFiler.withFiler), strataRow('Without one', h.metro.bySecFiler.withoutFiler), '', h.metro.note, '');
    L.push('### Per component', '', 'For each component, the labelled rate among bank-quarters where it scored more than 0, against the rest.', '',
      '| Component | Axis | Weight | Scored above 0: bank-quarters | Labelled | Rate | The rest: bank-quarters | Labelled | Rate |', '|---|---|---|---|---|---|---|---|---|',
      ...res.components.map((c) => `| ${c.id}${c.note ? ' (fit: not tested)' : ''} | ${c.axis} | ${c.weight} | ${cellText(c.scored)} | ${cellText(c.rest)} |`), '');
    L.push('### Context: the current all-axis tiers', '', res.context.label, '', '| Tier | Bank-quarters | Labelled | Rate |', '|---|---|---|---|',
      ...Object.entries(res.context.tiers).map(([t, c]) => `| ${t} | ${cellText(c)} |`), '');
    L.push('### By as-of quarter', '', '| As-of | Known quarter | SOD year | Universe | Scored | Labelled | Labelled and in the top K | Horizon complete |', '|---|---|---|---|---|---|---|---|',
      ...res.byQuarter.map((q) => `| ${q.asOf} | ${isoOf(q.knownQuarter)} | ${q.sodYear ?? '–'} | ${q.universe} | ${q.scored} | ${q.labelled} | ${q.topKLabelled} | ${q.horizonComplete ? 'yes' : 'no'} |`), '');
  }
  if (r.folds) {
    L.push('## Rolling origin', '', 'Each fold tests the quarters after T; the scoring file is fixed, so "train" names the quarters a principal may tune on for that fold.', '',
      '| Train to | Test quarters | Bank-quarters | Labelled banks | Base rate | Top K yield | Top K lift | Top K captured | |', '|---|---|---|---|---|---|---|---|---|',
      ...r.folds.map((f) => `| ${f.trainTo} | ${f.test[0]} to ${f.test.at(-1)} | ${f.observations} | ${f.labelledBanks} | ${pct(f.baseRate)} | ${pct(f.groups.topK.yield)} | ${lift(f.groups.topK.lift)} | ${pct(f.groups.topK.captured)} | ${f.tooFewToTune ? f.note : ''} |`), '');
  }
  L.push('## Notes', '', ...r.notes.map((n) => `- ${n}`), '', '## Words', '', ...r.words.map((w) => `- ${w}`), '', '## Known limits', '', ...r.limits.map((l) => `- ${l}`), '', `scoring.json: ${r.scoringJson}`, '');
  return L.join('\n');
}

// What `outbound backtest run` and `outbound backtest report` print.
export function summarize(r) {
  const lines = [];
  if (r.provisional) lines.push('PROVISIONAL: the buy box still has placeholders.');
  lines.push(`Backtest report ${r.hash}: ${r.modeLabel}, ${r.quarters.evaluated.length} as-of quarter(s) from ${r.quarters.evaluated[0]} to ${r.quarters.evaluated.at(-1)}, horizon ${r.inputs.horizonQuarters}, K ${r.inputs.topK}.`);
  if (r.reusedHoldout) lines.push('REUSED HOLDOUT: these holdout quarters were scored before with a different scoring file.');
  for (const res of r.results) {
    const h = res.headline.all;
    lines.push(`${res.scoring.path} (${res.scoring.hash}): Base rate ${pct(h.baseRate)} of ${h.observations} bank-quarters, ${h.labelledBanks} labelled bank(s).${h.tooFewToTune ? ` ${h.note}.` : ''}`,
      `  top ${h.groups.topK.k} by distress and timing: observed-label yield ${pct(h.groups.topK.yield)}, lift ${lift(h.groups.topK.lift)}, share of observed labels captured ${pct(h.groups.topK.captured)}; median lead time ${h.leadTime.median ?? '–'} quarter(s)`,
      `  distress at or above ${h.groups.tierADistress.threshold}: yield ${pct(h.groups.tierADistress.yield)}, lift ${lift(h.groups.tierADistress.lift)}, captured ${pct(h.groups.tierADistress.captured)}`);
  }
  const off = Object.entries(r.labelKinds).filter(([, x]) => x.status === 'unavailable').map(([k]) => k);
  if (off.length) lines.push(`Unavailable label kinds: ${off.join(', ')} (see the report).`);
  if (r.rollingOffered && r.mode !== 'rolling') lines.push(`The holdout holds ${r.holdoutLabelledBanks} labelled bank(s), fewer than minLabels: a rolling-origin split is offered (outbound backtest run --rolling).`);
  if (r.quarters.horizonIncomplete.length) lines.push(`${r.quarters.horizonIncomplete.length} as-of quarter(s) have a horizon past ${r.quarters.labelsAsOf}: their labels are incomplete.`);
  return lines.join('\n');
}
