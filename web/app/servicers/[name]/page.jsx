import { requirePrincipal } from '../../../lib/session.mjs';
import { servicerDetail } from '../../../lib/ops.mjs';
import { filingUrl, sourceLine } from '../../../lib/servicers.mjs';
import { moneyDollars, pct, num } from '../../../lib/format.mjs';
import { NotAuthorized, Problem, ContextOnlyBanner } from '../../ui.jsx';

export default async function Servicer({ params }) {
  const ctx = await requirePrincipal();
  if (ctx.denied) return <NotAuthorized email={ctx.email} />;
  const { name: raw } = await params;
  const name = decodeURIComponent(raw);
  let d;
  try { d = await servicerDetail(ctx.client, name); } catch (e) { return <><ContextOnlyBanner /><Problem text={`This servicer could not be loaded: ${e.message}`} /></>; }
  if (!d) return <><ContextOnlyBanner /><Problem text={`No special servicer named ${name} in the latest EDGAR pull.`} /></>;
  const { summary: s, loans } = d;
  return (
    <>
      <ContextOnlyBanner />
      <h1>{s.name}</h1>
      <label className="check codes-toggle" htmlFor="codes"><input type="checkbox" id="codes" /> Show the filing&apos;s field names</label>
      <p className="sub">{s.loans} loans in our metros and sectors · {moneyDollars(s.balance)} · {s.specialServicing} in special servicing · {s.noteSale} coded for a note sale · {s.delinquent} delinquent · {s.maturing} maturing</p>
      {loans.map((l) => {
        const src = sourceLine(l._source);
        const url = filingUrl(l._source, l.cik);
        return (
          <div key={l.key} className="panel">
            <h3>{l.trust} <span className="muted small">loan {l.assetNumber}</span></h3>
            <p className="src">{src}{url ? <> · <a href={url} rel="noopener noreferrer nofollow" target="_blank">filing on sec.gov</a></> : null}</p>
            {l.signals?.length ? <p>{l.signals.map((g) => <span key={g.type} className="pill">{g.label}</span>)}</p> : null}
            <dl className="kv small">
              <dt>Balance</dt><dd>{moneyDollars(l.balance)}<span className="code">reportPeriodEndActualBalanceAmount · {src}</span></dd>
              <dt>Rate</dt><dd>{pct(l.rate, 3)}<span className="code">reportPeriodInterestRatePercentage · {src}</span></dd>
              <dt>Maturity</dt><dd>{l.maturity ?? '–'}{l.postModificationMaturity ? ` (after modification: ${l.postModificationMaturity})` : ''}<span className="code">maturityDate · {src}</span></dd>
              <dt>Payment status</dt><dd>{l.paymentStatus ? `${l.paymentStatus.label} (${l.paymentStatus.code})` : '–'}<span className="code">paymentStatusLoanCode · {src}</span></dd>
              <dt>Workout</dt><dd>{(l.workouts?.length ? l.workouts : l.workout ? [l.workout] : []).map((w) => `${w.label} (${w.code})`).join(', ') || '–'}<span className="code">workoutStrategyCode · {src}</span></dd>
              <dt>Special servicing</dt><dd>{l.specialServicingSince ? `since ${l.specialServicingSince}${l.returnedToMasterOn ? `, returned ${l.returnedToMasterOn}` : ''}` : '–'}<span className="code">mostRecentSpecialServicerTransferDate · {src}</span></dd>
              <dt>Primary servicer</dt><dd>{l.primaryServicer ?? '–'}<span className="code">primaryServicerName · {src}</span></dd>
            </dl>
            <div className="scroll mt8">
              <table>
                <thead><tr><th>City</th><th>Metro</th><th>Type</th><th className="num">Occupancy</th><th className="num">DSCR</th></tr></thead>
                <tbody>
                  {(l.properties ?? []).map((p, i) => (
                    <tr key={i}>
                      <td>{[p.city, p.state].filter(Boolean).join(', ') || '–'}</td>
                      <td>{p.metro?.label ?? <span className="muted">outside our metros</span>}</td>
                      <td>{p.type?.label ?? '–'}{p.type?.code ? <span className="code">propertyTypeCode {p.type.code}</span> : null}</td>
                      <td className="num">{p.occupancy === null || p.occupancy === undefined ? '–' : pct(p.occupancy, 0)}<span className="code">mostRecentPhysicalOccupancyPercentage</span></td>
                      <td className="num">{p.dscr === null || p.dscr === undefined ? '–' : `${num(p.dscr, 2)}x`}<span className="code">mostRecentDebtServiceCoverage (net cash flow, or NOI)</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </>
  );
}
