import { requirePrincipal } from '../../lib/session.mjs';
import { listIntermediaries } from '../../lib/ops.mjs';
import { when } from '../../lib/format.mjs';
import { NotAuthorized, Problem, PageHead } from '../ui.jsx';

export const metadata = { title: 'Advisors and servicers · Valley Capital outbound' };

// Advisors and servicers (was Intermediaries; docs/design-redesign.md 5.9, PRD next-five E19-S2): the firms that act for sellers in our
// market, ranked, with a filter for each kind. The CMBS special servicers' loan detail is one click away on /servicers, which the menu
// marks as this same page.
export default async function Intermediaries({ searchParams }) {
  const ctx = await requirePrincipal();
  if (ctx.denied) return <NotAuthorized email={ctx.email} />;
  const { kind: raw } = (await searchParams) ?? {};
  let d;
  try { d = await listIntermediaries(ctx.client); } catch (e) { return <Problem text={`Advisors and servicers could not be loaded: ${e.message}`} />; }
  const kinds = Object.entries(d.kinds);
  const kind = typeof raw === 'string' && d.kinds[raw] ? raw : null;
  const rows = kind ? d.rows.filter((r) => r.kinds.includes(kind)) : d.rows;
  const count = (k) => d.rows.filter((r) => r.kinds.includes(k)).length;
  return (
    <div className="page">
      <PageHead icon="people" tone="t-net" eyebrow="Market · was Intermediaries and Servicers" title="Advisors and servicers"
        lede={`Firms a stored source shows acting for a seller in our market: loan-sale advisors and CMBS special servicers, ranked by their mandates (the weights are placeholders)${d.builtAt ? `. Rebuilt ${when(d.builtAt)}` : ''}. A seller no source names never counts toward sellers served. Context for principals only.`}
        actions={<a className="btn" href="/servicers">CMBS loans by servicer</a>} />
      <nav className="card onpage" aria-label="Kind of firm">
        <span className="muted">Show:</span>
        <a href="/intermediaries" aria-current={!kind ? 'page' : undefined}>All ({d.rows.length})</a>
        {kinds.map(([k, label]) => <a key={k} href={`/intermediaries?kind=${k}`} aria-current={kind === k ? 'page' : undefined}>{label} ({count(k)})</a>)}
      </nav>
      {!rows.length ? <p className="muted">No firms yet. The registry is built with the sale ledger (outbound sales build), or by: outbound intermediaries build.</p> : (
        <div className="card tablebox">
          <table className="dt">
            <thead><tr><th className="c-num" scope="col"><span className="sr">Rank</span></th><th scope="col">Firm</th><th scope="col">Kind</th><th className="num" scope="col">Score</th><th className="num" scope="col">Mandates</th><th scope="col">Latest</th><th scope="col">Our place on its buyer list</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.key}>
                  <td className="c-num">{i + 1}</td>
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
    </div>
  );
}
