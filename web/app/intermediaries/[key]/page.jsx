import { requirePrincipal } from '../../../lib/session.mjs';
import { intermediaryDetail } from '../../../lib/ops.mjs';
import { moneyDollars } from '../../../lib/format.mjs';
import { NotAuthorized, Problem } from '../../ui.jsx';
import { setRegistrationAction } from '../actions.js';

// PRD next-five E19: one firm, its score by component, every mandate with its source, its referrals, and (for an advisor) its buyer list.
export default async function Intermediary({ params }) {
  const ctx = await requirePrincipal();
  if (ctx.denied) return <NotAuthorized email={ctx.email} />;
  const { key: raw } = await params;
  const key = decodeURIComponent(raw);
  let d;
  try { d = await intermediaryDetail(ctx.client, key); } catch (e) { return <Problem text={`This firm could not be loaded: ${e.message}`} />; }
  if (!d) return <Problem text={`No intermediary ${key} in the registry.`} />;
  const { firm, row, mandates, registration: reg } = d;
  const advisor = firm.kinds.includes('loan_sale_advisor');
  return (
    <>
      <h1>{firm.name}</h1>
      <p className="sub">{firm.kinds.map((k) => d.kinds[k] ?? k).join(', ')} · score {row?.score ?? '–'} · {mandates.length} mandate(s){firm.kinds.includes('special_servicer') ? <> · <a href={`/servicers/${encodeURIComponent(firm.name)}`}>its CMBS loans</a></> : null}</p>
      <p className="muted small">Context for principals only. It never appears in a message.</p>

      {advisor ? (
        <div className="panel small">
          <h3 style={{ marginTop: 0 }}>Buyer list</h3>
          <p>State: <strong>{(reg?.state ?? 'not_started').replace(/_/g, ' ')}</strong>{reg?.recertifyBy ? `, re-certify by ${reg.recertifyBy}` : ''}. Only the state is kept here, never the agreement. {d.credibilityPackage ? `Credibility package approved by ${d.credibilityPackage.approvedBy}.` : 'Proof of funds waits for the credibility package to be approved (outbound intermediaries credibility-approved).'}</p>
          <form action={setRegistrationAction} className="row">
            <input type="hidden" name="key" value={firm.key} />
            <label>State<select name="state" defaultValue={reg?.state ?? 'not_started'}>{d.states.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}</select></label>
            <label>Re-certify by<input type="date" name="recertifyBy" defaultValue={reg?.recertifyBy ?? ''} /></label>
            <button type="submit">Record</button>
          </form>
          {reg?.history?.length ? <ul>{reg.history.map((h, i) => <li key={i}>{String(h.at).slice(0, 10)}: {h.state.replace(/_/g, ' ')} ({h.by})</li>)}</ul> : null}
        </div>
      ) : null}

      <h2>Score</h2>
      <div className="scroll"><table>
        <thead><tr><th>Component</th><th className="num">Value</th><th className="num">Points</th><th className="num">Weight</th><th>Note</th></tr></thead>
        <tbody>{(row?.components ?? []).map((c) => <tr key={c.id}><td>{c.id}</td><td className="num">{c.value}</td><td className="num">{c.points}</td><td className="num">{c.weight}</td><td className="small">{c.note ?? ''}</td></tr>)}</tbody>
      </table></div>

      <h2>Mandates</h2>
      <div className="scroll"><table>
        <thead><tr><th>Date</th><th>For</th><th>Kind</th><th>Metro</th><th className="num">Balance</th><th>Source</th></tr></thead>
        <tbody>{mandates.map((m) => (
          <tr key={m.id}>
            <td>{m.date ?? '–'}</td>
            <td>{m.seller?.name ?? 'unknown'}{m.sellerDescription ? <span className="src">{m.sellerDescription}; never matched to a bank</span> : null}</td>
            <td className="small">{d.kinds[m.kind] ?? m.kind}{m.loans ? `, ${m.loans} loan(s)` : ''}</td>
            <td>{(m.metros ?? [m.metro]).filter(Boolean).join(', ') || '–'}</td>
            <td className="num">{m.balance ? moneyDollars(m.balance) : '–'}</td>
            <td className="small">{m.feeder === 'principal' ? `${m.by}: ${m.how}` : (m.sources ?? []).map((s, i) => s.link ? <a key={i} href={s.link} rel="noopener noreferrer nofollow" target="_blank">{s.source} </a> : <span key={i}>{s.source} </span>)}</td>
          </tr>))}</tbody>
      </table></div>

      {firm.referrals.length ? (<><h2>Referrals</h2><p className="small muted">A call named this firm as the way in. Kept apart from mandates; never ranked.</p><ul className="small">{firm.referrals.map((r) => <li key={r.id}>{r.date}: for {r.seller?.name} ({r.by})</li>)}</ul></>) : null}
    </>
  );
}
