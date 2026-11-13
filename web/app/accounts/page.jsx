import { requirePrincipal } from '../../lib/session.mjs';
import { listAccounts } from '../../lib/ops.mjs';
import { when } from '../../lib/format.mjs';
import { NotAuthorized, Problem } from '../ui.jsx';

export const metadata = { title: 'Accounts · Valley Capital outbound' };

export default async function Accounts() {
  const ctx = await requirePrincipal();
  if (ctx.denied) return <NotAuthorized email={ctx.email} />;
  let rows;
  try { rows = await listAccounts(ctx.client, ctx.rest); } catch (e) { return <Problem text={`Accounts could not be loaded: ${e.message}`} />; }
  return (
    <>
      <h1>Accounts</h1>
      <p className="sub">Institutions a principal chose, from the candidate list or by hand.</p>
      {!rows.length ? <p className="muted">No accounts yet. Promote a candidate to start one.</p> : (
        <div className="scroll">
          <table>
            <thead><tr><th>Account</th><th>Tier</th><th>Person</th><th>Role</th><th>Research</th><th>Origin</th></tr></thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td><a href={`/accounts/${encodeURIComponent(a.id)}`}>{a.name ?? a.id}</a><span className="src">{a.id}</span></td>
                  <td><span className={`tier ${a.tier ?? ''}`}>{a.tier ?? '–'}</span></td>
                  <td>{a.person ?? <span className="muted">not named yet</span>}</td>
                  <td>{a.roleConfirmed ? 'confirmed' : <span className="muted">unconfirmed</span>}</td>
                  <td className="small">{a.researchedAt ? when(a.researchedAt) : <span className="muted">none</span>}</td>
                  <td className="small">{a.fromPipeline ? 'candidate list' : 'by hand'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
