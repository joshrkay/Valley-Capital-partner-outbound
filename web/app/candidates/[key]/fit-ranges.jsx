// The "How much could fit" tab (Q7 of the paper record): one range bar per buy-box type on one axis, solid for ranges from reported shares
// and hatched for estimates, the $0 floor drawn as a line, foreclosed property shown apart (property, never added to loans), and two
// disclosures: why the floor is $0 (the conditions that cannot be measured) and how the ceiling is worked out (each condition with its
// share and tier, the status rule and the sector's late loans by line). A server component; every figure is the record's.
import { fitRanges, rangeAxis } from '../../../lib/bank-view.mjs';
import { show, at, usd, tierName, STATUS_LABELS, STAGES, shareText } from '../../../lib/paper-view.mjs';
import { RangeBar } from '../../charts.jsx';
import { Term, Note, Value, Basis } from '../../ui.jsx';

const plainStage = Object.fromEntries(STAGES);

export function FitRanges({ paper }) {
  const q7 = paper?.q7;
  if (!q7) return <p className="muted">No estimate for this bank yet. The next scoring run writes one.</p>;
  const rows = fitRanges(q7);
  const { top, ticks } = rangeAxis(rows.filter((r) => r.known).map((r) => r.high));
  const oreo = q7.sectors.filter((s) => s.oreo?.figure);
  return (
    <section aria-labelledby="h-fit" className="page">
      <h2 id="h-fit" className="sec-h">How much could we buy?</h2>
      <p className="sec-intro">Loans of each type that could meet every rule in our <Term id="buybox">buy box</Term>. Ranges, because public reports cannot confirm every rule. Ceilings are per type and never added together.</p>
      {q7.provisional ? <Note tone="warn" role="note"><span><strong>Not final:</strong> the buy box still has placeholders ({(paper.placeholders ?? []).join(', ')}), so these ranges are not final.</span></Note> : null}
      <div className="card ranges">
        <div className="axis-row" aria-hidden="true">
          <div />
          <div className="axis-ticks">{ticks.map((v) => <span key={v} style={{ left: `${((v / top) * 100).toFixed(1)}%` }}>{v === 0 ? '$0' : usd(v)}</span>)}</div>
          <div />
        </div>
        {rows.map((r) => (
          <div key={r.sector} className="range-row">
            <div className="nm"><b>{r.label}</b>{r.estimate ? <Basis tier="inferred" /> : <span className="muted xs">From reported shares</span>}</div>
            <div className="range-track">{r.known ? <RangeBar id={r.sector} low={r.low} high={r.high} top={top} estimate={r.estimate} label={`${r.label}: ${usd(r.low)} to ${usd(r.high)}`} /> : null}</div>
            <div className="range-val">
              {r.known ? <b>{usd(r.low)} to {usd(r.high)}</b> : <span className="muted">{show(r.bounds).text}</span>}
              <div className="why">{r.category === 'nonfarmNonresidential' ? 'Shares one ceiling with the other types in commercial property.' : 'The most that could meet every rule we can measure.'}</div>
              {r.codes ? <span className="code">{r.codes}</span> : null}
            </div>
          </div>
        ))}
        {oreo.length ? (
          <div className="oreo-line">
            <span className="sw" aria-hidden="true" />
            <p><Term id="oreo">Foreclosed property</Term> it already owns, shown apart because it is property, not loans: {oreo.map((s, i) => (
              <span key={s.sector}>{i ? '; ' : ''}{fitRanges({ sectors: [s] })[0].label.toLowerCase()} <Value v={s.oreo.figure} pageDate={paper.asOf} /></span>
            ))}. The reports do not say where it is.</p>
          </div>
        ) : null}
        <details className="explain">
          <summary>Why is the floor $0?</summary>
          <div>
            <p>A loan counts only if it meets every rule in our buy box. While any rule cannot be measured, the honest floor is $0. The loan tape closes the gap.</p>
            {q7.sectors.map((s) => (s.unknownConditions?.length || s.statusLoans?.notReported?.length ? (
              <div key={s.sector}>
                <p className="mt8"><strong>{fitRanges({ sectors: [s] })[0].label}</strong></p>
                <ul>
                  {(s.unknownConditions ?? []).map((u) => <li key={u.id}>Cannot be measured, {u.label}: {u.reason}</li>)}
                  {(s.statusLoans?.notReported ?? []).map((n, i) => <li key={`nr-${i}`}>{n.stageLabel}, {String(n.lineLabel ?? '').toLowerCase()}: {STATUS_LABELS[n.status] ?? 'unknown'}. {n.reason} It enters as anywhere from none to the rest of the line&apos;s balance, never as zero.</li>)}
                </ul>
              </div>
            ) : null))}
          </div>
        </details>
        <details className="explain">
          <summary>How the ceiling is worked out</summary>
          <div>
            <p>For each rule we know the share of the bank&apos;s CRE book that passes it. A loan must pass all of them, so the most that can fit is the smallest of those shares. Multiplying shares together would assume the rules are unrelated, which nothing shows, so it is never done.</p>
            {q7.fitRule ? <p className="small mt8">{q7.fitRule}</p> : null}
            {q7.statusRule?.text ? <p className="small mt8">{q7.statusRule.text}</p> : null}
            {q7.sectors.map((s) => (
              <div key={s.sector} className="mt12">
                <p><strong>{fitRanges({ sectors: [s] })[0].label}</strong>{s.statusLoans ? <> · late loans of this type: <Value v={s.statusLoans.amount} pageDate={paper.asOf} /></> : null}</p>
                <div className="tablebox">
                  <table className="plain">
                    <thead><tr><th>Rule</th><th className="r">Share of the CRE book</th><th>Basis</th></tr></thead>
                    <tbody>{s.conditions.map((c) => <tr key={c.id}><td>{c.label}<span className="code">{c.basis}</span></td><td className="r">{shareText(c.share)}</td><td>{tierName(c.share.tier)}</td></tr>)}</tbody>
                  </table>
                </div>
                {s.statusLoans?.byLine?.length ? (
                  <div className="tablebox">
                    <table className="plain">
                      <thead><tr><th>Line</th>{s.statusLoans.byLine[0].parts.map((p) => <th key={p.stage} className="r">{plainStage[p.stage] ?? p.label}</th>)}</tr></thead>
                      <tbody>{s.statusLoans.byLine.map((l) => <tr key={l.line}><td>{l.label}</td>{l.parts.map((p) => <td key={p.stage} className="r"><Value v={at(paper, p.ref)} pageDate={paper.asOf} /></td>)}</tr>)}</tbody>
                    </table>
                  </div>
                ) : null}
                {s.oreo?.note ? <p className="small muted">{s.oreo.note}</p> : null}
                {(s.notUsed ?? []).length ? <p className="small muted">{s.notUsed.map((n) => `Not used, ${n.id}: ${n.reason}`).join(' ')}</p> : null}
              </div>
            ))}
            <span className="code">Method: {q7.formula}</span>
          </div>
        </details>
      </div>
    </section>
  );
}
