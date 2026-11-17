// System status (docs/design-redesign.md, 5.7), kept pure so it can be tested without a server: one line that says whether the data is
// current or what is wrong, sending paused or allowed in words, and each job as a plain label and a one-line result. It reads the stored
// run log, the jobs table and the kill switch; it adds no fact.

export const JOB_LABELS = Object.freeze({
  'sources.fdic': 'FDIC data pull', 'sources.edgar': 'CMBS loan pull (SEC EDGAR)', 'sources.filings': 'SEC filings check', 'sources.fdicsales': 'FDIC loan-sale pages',
  'sources.enforcement': 'Enforcement orders', 'sources.mergerapps': 'Merger applications', 'score.run': 'Scoring', 'triage.run': 'Weekly triage',
  'research.run': 'Research', 'draft.run': 'Draft', 'call.prep': 'Call brief', 'call.extract': 'Reading call notes',
});
export const SOURCE_LABELS = Object.freeze({
  fdic: 'FDIC data', edgar: 'CMBS loan data (SEC EDGAR)', filings: 'SEC filings', fdicsales: 'FDIC loan-sale pages', enforcement: 'Enforcement orders', mergerapps: 'Merger applications',
});
export const jobLabel = (kind) => JOB_LABELS[kind] ?? String(kind ?? 'job');
export const sourceLabel = (s) => SOURCE_LABELS[s] ?? String(s ?? 'a source');
const sourceOf = (run) => run?.source ?? String(run?.runId ?? '').split(/[-:]/)[0];
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const days = (ms) => Math.floor(ms / 86400000);

// What each queue button does, and roughly how long the work is, in words: the worker runs it at its next pass.
export const QUEUE_HELP = Object.freeze({
  fdic: 'Pulls the latest Call Reports, branches and deposits for every bank in our metros. The longest job: it reads every bank.',
  edgar: 'Reads the CMBS trusts\' loan filings on SEC EDGAR since the last pull, for special servicers and loans in our metros.',
  score: 'Scores every bank again from the stored data and rewrites the bank list and the paper estimates. Quick: it reads nothing new.',
});

// Whether the data is current, or what is wrong. Runs are the run log's lines, newest first; jobs the jobs table, newest first; staleDays
// the limits in triage.json (health.staleDays). Problems are listed most serious first.
export function healthSummary(overview, { now = new Date(), staleDays = {} } = {}) {
  const runs = overview?.recentRuns ?? overview?.runs ?? [];
  const jobs = overview?.jobs ?? [];
  const problems = [];
  if (!runs.length) problems.push('No data has been pulled yet. Queue an FDIC pull, then scoring.');
  const latest = new Map();
  for (const r of runs) { const s = sourceOf(r); if (s && !latest.has(s)) latest.set(s, r); }
  for (const [s, r] of latest) {
    if (r.outcome === 'failed') problems.push(`The last ${sourceLabel(s)} run failed${r.errors?.length ? `: ${String(r.errors[0]?.message ?? r.errors[0]).slice(0, 140)}` : '.'}`);
    else if (r.outcome === 'suspect') problems.push(`The last ${sourceLabel(s)} run looked wrong (it read nothing where the one before read data). Check its notes.`);
  }
  for (const [s, limit] of Object.entries(staleDays)) {
    if (s === 'scoring' || !latest.has(s) || latest.get(s).outcome !== 'ok') continue;   // a failed or suspect last run is reported above
    const ok = runs.find((r) => sourceOf(r) === s && r.outcome === 'ok');
    const at = Date.parse(ok?.finishedAt ?? '');
    if (!ok) problems.push(`${sourceLabel(s)} has no successful run on record.`);
    else if (Number.isFinite(at) && days(now - at) > limit) problems.push(`${sourceLabel(s)} was last pulled ${plural(days(now - at), 'day')} ago (the limit is ${limit}).`);
  }
  if (overview?.edgar?.failure && !problems.some((p) => p.includes(sourceLabel('edgar')))) problems.push(`The last CMBS pull failed: ${overview.edgar.failure.text}`);
  const seen = new Set();
  for (const j of jobs) {
    if (seen.has(j.kind)) continue;
    seen.add(j.kind);
    const src = String(j.kind ?? '').startsWith('sources.') ? j.kind.slice(8) : null;
    if (src && latest.has(src) && latest.get(src).outcome !== 'ok') continue;   // its run's failure is already said
    if (j.status === 'failed') problems.push(`${jobLabel(j.kind)} failed in its last run.`);
  }
  return {
    ok: problems.length === 0,
    headline: problems.length === 0 ? 'Data is current. Every source\'s last run succeeded, and no job failed.' : problems.length === 1 ? problems[0] : `${plural(problems.length, 'thing')} need attention.`,
    problems,
  };
}

// The kill switch as a sentence: sending paused (and why), or allowed.
export function sendingLine(kill) {
  const where = [kill?.config ? 'the setting in config.json' : null, kill?.document ? 'the KILL document' : null].filter(Boolean);
  return where.length
    ? { paused: true, text: 'Sending is paused.', detail: `No draft is created and no mailbox is touched until it is turned off (${where.join(' and ')}).` }
    : { paused: false, text: 'Sending is allowed.', detail: 'Drafts can be created. Nothing is ever sent from this app: a principal sends from their own mailbox.' };
}

// A job's result in one line instead of its raw JSON.
export function jobResultLine(job) {
  if (job?.status === 'queued') return 'Waiting for the worker.';
  if (job?.status === 'running') return 'Running now.';
  const r = job?.result;
  if (job?.status === 'failed') {
    const why = typeof r === 'string' ? r : r?.error ?? r?.message ?? '';
    return `Failed${why ? `: ${String(why).slice(0, 160)}` : '.'}`;
  }
  if (!r || typeof r !== 'object') return job?.status === 'done' ? 'Done.' : '';
  const COUNTS = [['rowsRead', 'rows read'], ['rowsWritten', 'written'], ['rowsChanged', 'changed'], ['scored', 'banks scored'], ['items', 'banks listed'], ['loansRead', 'loans read'], ['loansKept', 'loans kept'], ['trusts', 'trusts read'], ['actNow', 'act now'], ['watch', 'watch'], ['findings', 'findings']];
  const parts = COUNTS.filter(([k]) => Number.isFinite(Number(r[k])) && r[k] !== null && typeof r[k] !== 'boolean').map(([k, w]) => `${r[k]} ${w}`);
  const outcome = r.outcome === 'suspect' ? 'Done, but it looked wrong' : r.outcome === 'failed' ? 'Failed' : 'Done';
  return `${outcome}${parts.length ? `: ${parts.slice(0, 4).join(', ')}` : ''}.`;
}
