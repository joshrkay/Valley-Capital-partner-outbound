import { requirePrincipal } from '../../lib/session.mjs';
import { pilotOverview } from '../../lib/ops.mjs';
import { pct } from '../../lib/format.mjs';
import { NotAuthorized, Problem } from '../ui.jsx';
import { passAction } from './actions.js';

export const metadata = { title: 'Pilot · Valley Capital outbound' };

export default async function Pilot() {
  const ctx = await requirePrincipal();
  if (ctx.denied) return <NotAuthorized email={ctx.email} />;
  let o;
  try { o = await pilotOverview(ctx.client); } catch (e) { return <Problem text={`The pilot could not be loaded: ${e.message}`} />; }
  const { card: { accounts, totals }, status } = o;
  return (
    <>
      <h1>Pilot</h1>
      <p className="sub">The briefer is checked on accounts the principals already know before it researches any bank from the candidate list (PRD E1). Truth sheets are written with <span className="mono">outbound pilot template</span>.</p>
      <div className={`banner ${status.passed ? 'ok' : 'warn'}`}>{status.passed ? `Passed by ${status.by} on ${String(status.at).slice(0, 10)}.` : 'Not passed yet. Accounts from the candidate list cannot be researched.'}</div>
      <div className="panel">
        <dl className="kv">
          <dt>Accounts</dt><dd>{totals.accounts} with a truth sheet, {totals.researched} researched, {totals.fullyReviewed} fully reviewed</dd>
          <dt>Fabrications</dt><dd><strong>{totals.fabrications}</strong> (must be 0)</dd>
          <dt>Precision</dt><dd>{totals.precision === null ? '–' : pct(totals.precision, 0)}</dd>
          <dt>Recall</dt><dd>{totals.recall === null ? '–' : pct(totals.recall, 0)}</dd>
          <dt>Cost per brief</dt><dd>{totals.costPerBrief === null ? '–' : `$${totals.costPerBrief.toFixed(2)} (tokens only)`}</dd>
        </dl>
        {!status.passed ? <form action={passAction} className="inline" style={{ marginTop: 10 }}><button type="submit">Record a pass</button></form> : null}
      </div>
      {accounts.length ? (
        <div className="scroll">
          <table>
            <thead><tr><th>Account</th><th className="num">Findings</th><th className="num">Unreviewed</th><th className="num">True</th><th className="num">False</th><th className="num">Fabrications</th><th className="num">Truth found / missed</th></tr></thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.account}>
                  <td>{a.researched ? <a href={`/pilot/${encodeURIComponent(a.account)}`}>{a.account}</a> : a.account}{a.staleReview ? <span className="pill">re-researched</span> : null}</td>
                  <td className="num">{a.findings ?? '–'}</td><td className="num">{a.unreviewed ?? '–'}</td><td className="num">{a.true ?? '–'}</td><td className="num">{a.false ?? '–'}</td>
                  <td className="num">{a.fabrications ?? '–'}</td><td className="num">{a.researched ? `${a.truthFound} / ${a.truthMissed}` : 'not researched'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="muted">No truth sheets yet.</p>}
    </>
  );
}
