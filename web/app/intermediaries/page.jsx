import { requirePrincipal } from '../../lib/session.mjs';
import { listIntermediaries } from '../../lib/ops.mjs';
import { when } from '../../lib/format.mjs';
import { NotAuthorized, Problem } from '../ui.jsx';

export const metadata = { title: 'Intermediaries · Valley Capital outbound' };

// PRD next-five E19-S2: the firms that act for sellers in our market, ranked. Replaces the Servicers page in the nav; /servicers still works.
export default async function Intermediaries({ searchParams }) {
  const ctx = await requirePrincipal();
  if (ctx.denied) return <NotAuthorized email={ctx.email} />;
  const { kind: raw } = (await searchParams) ?? {};
  const kind = typeof raw === 'string' && raw ? raw : null;
  let d;
  try { d = await listIntermediaries(ctx.client, { kind }); } catch (e) { return <Problem text={`Intermediaries could not be loaded: ${e.message}`} />; }
  const kinds = Object.entries(d.kinds);
  return (
    <>
      <h1>Intermediaries</h1>
      <p className="sub">Firms a stored source shows acting for a seller in our market: loan-sale advisors and CMBS special servicers, ranked by their mandates (the weights are placeholders){d.builtAt ? `. Rebuilt ${when(d.builtAt)}` : ''}. A seller no source names never counts toward sellers served. Context for principals only.</p>
      <p className="small">Show: <a href="/intermediaries">all</a>{kinds.map(([k, label]) => <span key={k}> · <a href={`/intermediaries?kind=${k}`}>{label}</a></span>)}. The CMBS loan detail is on <a href="/servicers">Servicers</a>.</p>
      {!d.rows.length ? <p className="muted">No intermediaries yet. The registry is built with the sale ledger (outbound sales build), or by: outbound intermediaries build.</p> : (
        <div className="scroll">
          <table>
            <thead><tr><th>#</th><th>Firm</th><th>Kind</th><th className="num">Score</th><th className="num">Mandates</th><th>Latest</th><th>Buyer list</th></tr></thead>
            <tbody>
              {d.rows.map((r, i) => (
                <tr key={r.key}>
                  <td>{i + 1}</td>
                  <td><a href={`/intermediaries/${encodeURIComponent(r.key)}`}>{r.name}</a>{r.referrals ? <span className="src">{r.referrals} referral(s), not ranked</span> : null}</td>
                  <td className="small">{r.kinds.map((k) => d.kinds[k] ?? k).join(', ')}</td>
                  <td className="num">{r.score}</td>
                  <td className="num">{r.mandates}</td>
                  <td>{r.latest ?? '–'}</td>
                  <td className="small">{r.kinds.includes('loan_sale_advisor') ? (r.registration ?? 'not started').replace(/_/g, ' ') : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
