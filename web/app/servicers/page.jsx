import { requirePrincipal } from '../../lib/session.mjs';
import { loadRules } from '../../lib/engine.mjs';
import { listServicers } from '../../lib/ops.mjs';
import { moneyDollars, when } from '../../lib/format.mjs';
import { NotAuthorized, Problem } from '../ui.jsx';

export const metadata = { title: 'Servicers · Valley Capital outbound' };

export default async function Servicers() {
  const ctx = await requirePrincipal();
  if (ctx.denied) return <NotAuthorized email={ctx.email} />;
  let data, rules;
  try { [data, rules] = await Promise.all([listServicers(ctx.client), loadRules()]); } catch (e) { return <Problem text={`Servicers could not be loaded: ${e.message}`} />; }
  const label = new Map(rules.metros.metros.map((m) => [m.cbsa, m.label]));
  const { servicers, state } = data;
  return (
    <>
      <h1>CMBS special servicers</h1>
      <p className="sub">Special servicers of CMBS loans on properties in our six metros and buy-box sectors, from the trusts' loan-level SEC filings (Form ABS-EE){state?.ranAt ? `, pulled ${when(state.ranAt)}` : ''}. Counts are loans; balances are current, in dollars.</p>
      {!servicers.length ? <p className="muted">No CMBS data yet. Queue an EDGAR pull on the Status page (it needs the firm's SEC contact in config.json first).</p> : (
        <div className="scroll">
          <table>
            <thead><tr><th>Special servicer</th><th className="num">Loans</th><th className="num">Balance</th><th className="num">In special servicing</th><th className="num">Note sale</th><th className="num">Delinquent</th><th className="num">Maturing</th><th>Metros</th><th>Sectors</th></tr></thead>
            <tbody>
              {servicers.map((s) => (
                <tr key={s.name}>
                  <td><a href={`/servicers/${encodeURIComponent(s.name)}`}>{s.name}</a>{s.name === 'Unknown' ? <span className="src">the trust's distribution report did not name one we could read</span> : null}</td>
                  <td className="num">{s.loans}</td>
                  <td className="num" title="Sum of reportPeriodEndActualBalanceAmount, EX-102">{moneyDollars(s.balance)}</td>
                  <td className="num">{s.specialServicing}</td>
                  <td className="num" title="workoutStrategyCode 5: note sale">{s.noteSale}</td>
                  <td className="num">{s.delinquent}</td>
                  <td className="num">{s.maturing}</td>
                  <td className="small">{(s.metros ?? []).map((c) => label.get(c) ?? c).join(', ')}</td>
                  <td className="small">{(s.sectors ?? []).join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
