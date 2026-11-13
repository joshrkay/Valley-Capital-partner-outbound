import { requirePrincipal } from '../../lib/session.mjs';
import { statusOverview } from '../../lib/ops.mjs';
import { when } from '../../lib/format.mjs';
import { NotAuthorized, Problem } from '../ui.jsx';
import { queueSourcesAction, queueScoreAction } from './actions.js';

export const metadata = { title: 'Status · Valley Capital outbound' };

export default async function Status() {
  const ctx = await requirePrincipal();
  if (ctx.denied) return <NotAuthorized email={ctx.email} />;
  let s;
  try { s = await statusOverview(ctx.rest); } catch (e) { return <Problem text={`Status could not be loaded: ${e.message}`} />; }
  const killed = s.kill.config || s.kill.document;
  return (
    <>
      <h1>Status</h1>
      <div className={`banner ${killed ? 'error' : 'ok'}`}>{killed ? `Kill switch ON (${[s.kill.config ? 'config.json' : null, s.kill.document ? 'KILL document' : null].filter(Boolean).join(' and ')}): no draft is created and no mailbox is touched.` : 'Kill switch off.'}</div>
      <div className="panel row">
        <form action={queueSourcesAction} className="inline"><button type="submit">Queue FDIC pull</button></form>
        <form action={queueScoreAction} className="inline"><label className="row" style={{ flexDirection: 'row', alignItems: 'center' }}><input type="checkbox" name="draftBuybox" /> draft buy box (PROVISIONAL list)</label><button type="submit">Queue scoring</button></form>
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
