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
      <p className="sub">{s.loans} loans in our metros and sectors · {moneyDollars(s.balance)} · {s.specialServicing} in special servicing · {s.noteSale} coded for a note sale · {s.delinquent} delinquent · {s.maturing} maturing</p>
      {loans.map((l) => {
        const src = sourceLine(l._source);
        const url = filingUrl(l._source, l.cik);
        return (
          <div key={l.key} className="panel">
            <h3 style={{ marginTop: 0 }}>{l.trust} <span className="muted small">loan {l.assetNumber}</span></h3>
            <p className="src">{src}{url ? <> · <a href={url} rel="noopener noreferrer nofollow" target="_blank">filing on sec.gov</a></> : null}</p>
            {l.signals?.length ? <p>{l.signals.map((g) => <span key={g.type} className="pill" style={{ marginRight: 6 }}>{g.label}</span>)}</p> : null}
            <dl className="kv small" title={src}>
              <dt>Balance</dt><dd title={`reportPeriodEndActualBalanceAmount · ${src}`}>{moneyDollars(l.balance)}</dd>
              <dt>Rate</dt><dd title={`reportPeriodInterestRatePercentage · ${src}`}>{pct(l.rate, 3)}</dd>
              <dt>Maturity</dt><dd title={`maturityDate · ${src}`}>{l.maturity ?? '–'}{l.postModificationMaturity ? ` (after modification: ${l.postModificationMaturity})` : ''}</dd>
              <dt>Payment status</dt><dd title={`paymentStatusLoanCode · ${src}`}>{l.paymentStatus ? `${l.paymentStatus.label} (${l.paymentStatus.code})` : '–'}</dd>
              <dt>Workout</dt><dd title={`workoutStrategyCode · ${src}`}>{l.workout ? `${l.workout.label} (${l.workout.code})` : '–'}</dd>
              <dt>Special servicing</dt><dd title={`mostRecentSpecialServicerTransferDate · ${src}`}>{l.specialServicingSince ? `since ${l.specialServicingSince}${l.returnedToMasterOn ? `, returned ${l.returnedToMasterOn}` : ''}` : '–'}</dd>
              <dt>Primary servicer</dt><dd title={`primaryServicerName · ${src}`}>{l.primaryServicer ?? '–'}</dd>
            </dl>
            <div className="scroll" style={{ marginTop: 8 }}>
              <table>
                <thead><tr><th>City</th><th>Metro</th><th>Type</th><th className="num">Occupancy</th><th className="num">DSCR</th></tr></thead>
                <tbody>
                  {(l.properties ?? []).map((p, i) => (
                    <tr key={i} title={src}>
                      <td>{[p.city, p.state].filter(Boolean).join(', ') || '–'}</td>
                      <td>{p.metro?.label ?? <span className="muted">outside our metros</span>}</td>
                      <td title={p.type?.code ? `propertyTypeCode ${p.type.code}` : undefined}>{p.type?.label ?? '–'}</td>
                      <td className="num" title={`mostRecentPhysicalOccupancyPercentage · ${src}`}>{p.occupancy === null || p.occupancy === undefined ? '–' : pct(p.occupancy, 0)}</td>
                      <td className="num" title={`mostRecentDebtServiceCoverage (net cash flow, or NOI) · ${src}`}>{p.dscr === null || p.dscr === undefined ? '–' : `${num(p.dscr, 2)}x`}</td>
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
