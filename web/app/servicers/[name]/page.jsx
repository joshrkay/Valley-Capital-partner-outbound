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
  const { summary: s, loans, filings = [] } = d;
  return (
    <>
      <ContextOnlyBanner />
      <h1>{s.name}</h1>
      <label className="check codes-toggle" htmlFor="codes"><input type="checkbox" id="codes" /> Show the filing&apos;s field names</label>
      <p className="sub">{s.loans} loans in our metros and sectors · {moneyDollars(s.balance)} · {s.specialServicing} in special servicing · {s.noteSale} coded for a note sale · {s.delinquent} delinquent · {s.maturing} maturing</p>
      {filings.length ? (
        <div className="panel">
          <h3>County filings on its loans <span className="muted small">{filings.length}</span></h3>
          <p className="src">Foreclosure filings in the counties we watch whose current holder is a CMBS trust, linked to the trust&apos;s own record of the loan (SEC Form ABS-EE, exhibit 102) by the original amount, the state, and the city, county or originator. Context only: never scored, never in a message.</p>
          {filings.map((f) => (
            <div key={f.id} className="mt8">
              <p>{f.label}</p>
              <dl className="kv small">
                <dt>County filing</dt><dd>{f.type}, {f.county} · {f.dateKind} {f.date ?? '–'}{f.originalPrincipal !== null ? ` · original amount ${moneyDollars(f.originalPrincipal)}` : ''}{f.link ? <> · <a href={f.link} rel="noopener noreferrer nofollow" target="_blank">county record</a></> : null}</dd>
                <dt>Trust&apos;s loan</dt><dd>{f.trust} · loan {f.assetNumber}{f.property ? ` · ${f.property}` : ''}{f.place ? ` · ${f.place}` : ''}<span className="code">matched on {f.matchedOn.join(', ')}{f.disagreed.length ? `; differs on ${f.disagreed.join(', ')}` : ''}</span></dd>
                <dt>Balance</dt><dd>{moneyDollars(f.balance)}{f.paidThrough ? ` · paid through ${f.paidThrough}` : ''}<span className="code">reportPeriodEndActualBalanceAmount, paidThroughDate · period {f.reportingPeriod ?? '–'}</span></dd>
                <dt>Payment status</dt><dd>{f.paymentStatus ?? '–'}<span className="code">paymentStatusLoanCode</span></dd>
                <dt>Special servicing</dt><dd>{f.specialServicing ?? 'not in special servicing'}<span className="code">mostRecentSpecialServicerTransferDate</span></dd>
                <dt>Workout</dt><dd>{f.workout ?? '–'}<span className="code">workoutStrategyCode</span></dd>
                <dt>Valuation</dt><dd>{moneyDollars(f.valuation)}{f.valuationDate ? ` as of ${f.valuationDate}` : ''}<span className="code">mostRecentValuationAmount, mostRecentValuationDate</span></dd>
                <dt>Occupancy · NOI · DSCR</dt><dd>{f.occupancy === null ? '–' : pct(f.occupancy, 0)} · {moneyDollars(f.noi)} · {f.dscr === null ? '–' : `${num(f.dscr, 2)}x`}<span className="code">mostRecentPhysicalOccupancyPercentage, mostRecentNetOperatingIncomeAmount, mostRecentDebtServiceCoverage</span></dd>
                <dt>Servicers</dt><dd>master {f.masterServicer ?? '–'} · special {f.specialServicer ?? '–'}<span className="code">primaryServicerName; the trust&apos;s distribution report</span></dd>
                <dt>SEC filings</dt><dd>{[[f.ex102, 'EX-102'], [f.absEe, 'ABS-EE filing'], [f.distributionReport, 'distribution report (10-D)']].filter(([u]) => u).map(([u, t], i) => <span key={t}>{i ? ' · ' : ''}<a href={u} rel="noopener noreferrer nofollow" target="_blank">{t}</a></span>)}</dd>
              </dl>
            </div>
          ))}
        </div>
      ) : null}
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
