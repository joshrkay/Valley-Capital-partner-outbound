// The CMBS servicer screens' logic (PRD E4-S3), kept pure so it can be tested without a server. The data comes from the EDGAR adapter
// (src/sources/edgar.mjs): sources/edgar/servicers.json (one summary per special servicer) and sources/edgar/loans.json (the loans).
// Loan and property detail is asset-level: context for a principal, never for a message. The screens say so on every loan page.
export const CONTEXT_ONLY = 'Loan and property detail is context for a principal only. It never goes in a message.';

// Most actionable first: loans in special servicing, then loans coded for a note sale, then the balance at stake.
export function sortServicers(map) {
  return Object.values(map ?? {}).filter((s) => s && s.name)
    .sort((a, b) => (b.specialServicing ?? 0) - (a.specialServicing ?? 0) || (b.noteSale ?? 0) - (a.noteSale ?? 0) || (b.balance ?? 0) - (a.balance ?? 0) || String(a.name).localeCompare(String(b.name)));
}

// The loans whose trust names this special servicer. Loans whose servicer could not be read are grouped under "Unknown", as the adapter does.
export function loansFor(loans, name) {
  const want = String(name ?? '');
  return Object.values(loans ?? {}).filter((l) => (l.specialServicer ?? 'Unknown') === want)
    .sort((a, b) => rank(b) - rank(a) || (b.balance ?? 0) - (a.balance ?? 0) || String(a.key).localeCompare(String(b.key)));
}
const rank = (l) => (l.signals ?? []).reduce((n, s) => n + ({ note_sale: 8, special_servicing: 4, delinquent: 2, foreclosure: 2, reo: 2, matured_nonperforming: 2, dpo: 2, maturing: 1 }[s.type] ?? 0), 0);

// "ABS-EE 0001888524-26-019853 exh_102.xml" -> the filing's address on sec.gov, or null if the endpoint is not in that shape.
export function filingUrl(source, cik) {
  const m = /^ABS-EE\s+(\d{10}-\d{2}-\d{6})(?:\s+(\S+))?$/.exec(String(source?.endpoint ?? ''));
  if (!m || !/^\d+$/.test(String(cik ?? ''))) return null;
  const acc = m[1].replace(/-/g, '');
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${acc}/${m[2] ?? ''}`;
}

export const sourceLine = (src) => [src?.endpoint, src?.period ? `reporting period ${src.period}` : null].filter(Boolean).join(', ');

// What the status page says about the last EDGAR pull. A placeholder SEC contact stops the run before it writes a run-log line, so the
// failed job's own error is read too; the newer of the two failures is shown.
export function edgarStatus({ state, runs = [], jobs = [] }) {
  const run = runs.find((r) => r?.source === 'edgar') ?? null;           // runs and jobs arrive newest first
  const job = jobs.find((j) => j?.kind === 'sources.edgar') ?? null;
  const t = (v) => String(v ?? '');
  const failures = [], successes = [];
  if (job?.status === 'failed') failures.push({ text: job.result?.error ?? 'The last EDGAR job failed without a message.', at: t(job.finished_at ?? job.created_at) });
  if (job?.status === 'done') successes.push(t(job.finished_at));
  if (run?.outcome === 'failed') failures.push({ text: run.errors?.[0] ?? 'The last EDGAR run failed without a message.', at: t(run.finishedAt) });
  if (run && run.outcome !== 'failed') successes.push(t(run.finishedAt));
  const newestFailure = failures.sort((a, b) => b.at.localeCompare(a.at))[0] ?? null;
  const newestSuccess = successes.sort().at(-1) ?? '';
  const failure = newestFailure && newestFailure.at >= newestSuccess ? newestFailure : null;   // a later success clears it
  return {
    ranAt: state?.ranAt ?? null, since: state?.since ?? null, lastRun: state?.lastRun ?? null,
    trusts: state?.counts?.cmbsTrusts ?? null, loansRead: state?.counts?.loansRead ?? null, loansKept: state?.counts?.loansKept ?? null, trustErrors: state?.counts?.trustErrors ?? null,
    lastOutcome: run?.outcome ?? null, suspect: run?.outcome === 'suspect', failure,
  };
}
