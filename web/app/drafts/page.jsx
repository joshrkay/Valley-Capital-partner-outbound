import { requirePrincipal } from '../../lib/session.mjs';
import { listDrafts } from '../../lib/ops.mjs';
import { NotAuthorized, Problem } from '../ui.jsx';
import { approveAction } from './actions.js';

export const metadata = { title: 'Approvals · Valley Capital outbound' };

export default async function Drafts() {
  const ctx = await requirePrincipal();
  if (ctx.denied) return <NotAuthorized email={ctx.email} />;
  let rows;
  try { rows = await listDrafts(ctx.client); } catch (e) { return <Problem text={`Drafts could not be loaded: ${e.message}`} />; }
  return (
    <>
      <h1>Approvals</h1>
      <p className="sub">Drafts waiting for a principal. Approving checks the draft again; it does not send. There is no send button here by design.</p>
      {!rows.length ? <p className="muted">Nothing waiting.</p> : rows.map((d) => (
        <div key={`${d.account}-${d.step}-${d.channel}`} className="panel">
          <h3 style={{ marginTop: 0 }}>{d.accountName} · step {d.step}, {d.channel.replace('_', ' ')} {d.person ? <span className="muted">to {d.person}</span> : null} <span className="pill">{d.status}</span></h3>
          {d.subject ? <p><strong>Subject:</strong> {d.subject}</p> : null}
          <pre className="text">{d.text}</pre>
          {d.errors.length ? <div className="banner error small"><strong>Blocked. Fix before approval:</strong><ul>{d.errors.map((e, i) => <li key={i}>{e.code}: {e.message}</li>)}</ul></div> : null}
          {d.warnings.length ? <div className="banner warn small"><ul>{d.warnings.map((e, i) => <li key={i}>{e.code}: {e.message}</li>)}</ul></div> : null}
          {d.status === 'draft' ? (
            <form action={approveAction} className="inline">
              <input type="hidden" name="id" value={d.account} /><input type="hidden" name="channel" value={d.channel} /><input type="hidden" name="step" value={d.step} />
              <button type="submit">Approve</button>
            </form>
          ) : null}
        </div>
      ))}
    </>
  );
}
