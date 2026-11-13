import { requirePrincipal } from '../../lib/session.mjs';
import { statusOverview } from '../../lib/ops.mjs';
import { when } from '../../lib/format.mjs';
import { NotAuthorized, Problem } from '../ui.jsx';
import { queueSourcesAction, queueScoreAction, queueEdgarAction } from './actions.js';

export const metadata = { title: 'Status · Valley Capital outbound' };

export default async function Status() {
  const ctx = await requirePrincipal();
  if (ctx.denied) return <NotAuthorized email={ctx.email} />;
  let s;
  try { s = await statusOverview(ctx.rest, ctx.client); } catch (e) { return <Problem text={`Status could not be loaded: ${e.message}`} />; }
  const killed = s.kill.config || s.kill.document;
  const edgar = s.edgar;
  return (
    <>
      <h1>Status</h1>
      <div className={`banner ${killed ? 'error' : 'ok'}`}>{killed ? `Kill switch ON (${[s.kill.config ? 'config.json' : null, s.kill.document ? 'KILL document' : null].filter(Boolean).join(' and ')}): no draft is created and no mailbox is touched.` : 'Kill switch off.'}</div>
      <div className="panel row">
        <form action={queueSourcesAction} className="inline"><button type="submit">Queue FDIC pull</button></form>
        <form action={queueEdgarAction} className="inline"><button type="submit">Queue CMBS pull (SEC EDGAR)</button></form>
        <form action={queueScoreAction} className="inline"><label className="row" style={{ flexDirection: 'row', alignItems: 'center' }}><input type="checkbox" name="draftBuybox" /> draft buy box (PROVISIONAL list)</label><button type="submit">Queue scoring</button></form>
      </div>
      <h2>CMBS loan data (SEC EDGAR)</h2>
      {edgar.failure ? <div className="banner error">The last EDGAR pull failed: {edgar.failure.text}</div> : null}
      <div className="panel">
        {edgar.ranAt ? (
          <dl className="kv">
            <dt>Last run</dt><dd>{when(edgar.ranAt)} <span className="src">{edgar.lastRun}</span></dd>
            <dt>Filings since</dt><dd>{edgar.since ?? '–'}</dd>
            <dt>CMBS trusts read</dt><dd>{edgar.trusts ?? '–'}{edgar.trustErrors ? <span className="muted"> ({edgar.trustErrors} could not be read)</span> : null}</dd>
            <dt>Loans read</dt><dd>{edgar.loansRead ?? '–'}</dd>
            <dt>Loans kept</dt><dd>{edgar.loansKept ?? '–'} <span className="muted small">in our metros and sectors</span></dd>
            {edgar.suspect ? <><dt>Note</dt><dd>The run was marked suspect; check its notes below.</dd></> : null}
          </dl>
        ) : <p className="muted" style={{ margin: 0 }}>No EDGAR pull has finished yet.</p>}
      </div>

      <h2>Jobs</h2>
      {!s.jobs.length ? <p className="muted">No jobs yet.</p> : (
        <div className="scroll"><table>
          <thead><tr><th className="num">Id</th><th>Kind</th><th>Status</th><th>By</th><th>Queued</th><th>Finished</th><th>Result</th></tr></thead>
          <tbody>{s.jobs.map((j) => (
            <tr key={j.id}><td className="num">{j.id}</td><td className="mono">{j.kind}</td><td>{j.status}</td><td className="small">{j.requested_by}</td><td className="small">{when(j.created_at)}</td><td className="small">{when(j.finished_at)}</td><td className="small mono">{j.result ? JSON.stringify(j.result).slice(0, 160) : ''}</td></tr>
          ))}</tbody>
        </table></div>
      )}
      <h2>Source runs</h2>
      {!s.runs.length ? <p className="muted">No runs yet.</p> : (
        <div className="scroll"><table>
          <thead><tr><th>Run</th><th>Outcome</th><th className="num">Rows read</th><th className="num">Written</th><th className="num">Changed</th><th>Notes</th></tr></thead>
          <tbody>{s.runs.map((r, i) => (
            <tr key={r.runId ?? i}><td className="small mono">{r.runId}</td><td>{r.outcome}</td><td className="num">{r.rowsRead ?? '–'}</td><td className="num">{r.rowsWritten ?? '–'}</td><td className="num">{r.rowsChanged ?? '–'}</td><td className="small">{[...(r.missingFields ?? []).map((f) => `missing ${f}`), ...(r.notes ?? [])].join(' · ')}</td></tr>
          ))}</tbody>
        </table></div>
      )}
    </>
  );
}
