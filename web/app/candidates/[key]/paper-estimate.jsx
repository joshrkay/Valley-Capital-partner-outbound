// The paper estimate on the candidate page (PRD E14-S1), rendered from the record the scoring run wrote (paper/fdic-<CERT>.json). A server
// component: every value is rendered as text, each with its tier and as-of date, and its sources on hover. Nothing is computed here.
import { Fragment } from 'react';
import { show, at, STAGES, STATUS_LABELS, PAPER_CONTEXT, dateOf, shareText, pointText } from '../../../lib/paper-view.mjs';

// A value: the number with its tier and date beneath, or the gap's status (with its reason beneath when `full`, else on hover).
function V({ v, full = false }) {
  const s = show(v);
  if (s.gap) return <span className="muted" title={s.title}>{s.text}{full && s.reason ? <span className="src">{s.reason}</span> : null}</span>;
  return <span title={s.title}>{s.text}<span className="src">{s.tier} · {s.date}</span></span>;
}

const Notes = ({ items }) => (items?.length ? <ul className="small muted">{items.map((t, i) => <li key={i}>{t}</li>)}</ul> : null);

export default function PaperEstimate({ paper }) {
  if (!paper) return (<><h2>Paper estimate</h2><p className="muted">No paper estimate for this bank yet. The next scoring run writes one.</p></>);
  const { q1, q3, q4, q5, q6, q7, q8 } = paper;
  const trendReps = q1.trend.series[0]?.points.map((p) => p.repdte) ?? [];
  return (
    <>
      <h2 id="paper">Paper estimate</h2>
      <div className="banner warn" role="note">{PAPER_CONTEXT}</div>
      {paper.provisional ? <div className="banner warn">PROVISIONAL: the buy box still has placeholders ({paper.placeholders.join(', ')}), so the in-box bounds are not final.</div> : null}
      <p className="sub">{paper.layer} · charter only · data as of {dateOf(paper.asOf) || 'unknown'} · scoring run {paper.runId ?? 'unknown'} (the last run that changed it). Every number names its tier (reported, observed or inferred) and date; hover for its FDIC fields, file and method.</p>

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Summary</h3>
        <dl className="kv">
          {paper.summary.map((s) => <Fragment key={s.id}><dt>{s.label}</dt><dd><V v={at(paper, s.ref)} full /></dd></Fragment>)}
          <dt>Unknowns</dt><dd>{q8.unknowns.length}, listed at the end with the tape request</dd>
        </dl>
      </div>

      <h3>Q1. How much CRE, of which kinds, and how stressed (reported)</h3>
      <p className="small muted">{q1.definition}</p>
      <dl className="kv">
        <dt>Investor CRE</dt><dd><V v={q1.investorCre} full /></dd>
        <dt>Owner-occupied nonfarm nonresidential</dt><dd><V v={q1.ownerOccupied} full /></dd>
        <dt>CRE book (secured by real estate)</dt><dd><V v={q1.creBook} full /></dd>
      </dl>
      <div className="scroll">
        <table>
          <thead><tr><th>Category</th><th className="num">Balance</th>{STAGES.map(([, l]) => <th key={l} className="num">{l}</th>)}<th className="num">Charge-offs, quarter (flow)</th><th className="num">Charge-offs, year to date (flow)</th></tr></thead>
          <tbody>
            {q1.categories.map((c) => (
              <tr key={c.id}>
                <td>{c.label}{c.investor ? null : <span className="pill">not investor CRE</span>}{c.note ? <span className="src">{c.note}</span> : null}</td>
                <td className="num"><V v={c.balance} /></td>
                {STAGES.map(([k]) => <td key={k} className="num"><V v={c.stages[k]?.amount} />{c.stages[k]?.shareOfBalance?.value !== null && c.stages[k]?.shareOfBalance?.value !== undefined ? <span className="src">{show(c.stages[k].shareOfBalance).text} of balance</span> : null}</td>)}
                <td className="num"><V v={c.chargeOffs.quarter} /></td>
                <td className="num"><V v={c.chargeOffs.yearToDate} /></td>
              </tr>
            ))}
            <tr>
              <td>{q1.nonfarmTotal.label}</td><td className="num"><V v={q1.nonfarmTotal.balance} /></td>
              {STAGES.map(([k]) => <td key={k} className="num muted">see the split above</td>)}
              <td className="num"><V v={q1.nonfarmTotal.chargeOffs.quarter} /></td><td className="num"><V v={q1.nonfarmTotal.chargeOffs.yearToDate} /></td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="small muted">A stage FDIC does not report shows "not reported", never zero. Charge-offs are flows over the period named, shown apart from the balances, which are stocks at the report date.</p>
      <div className="grid2">
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Construction split</h3>
          <dl className="kv">{(q1.categories.find((c) => c.id === 'construction')?.split ?? []).map((s) => <Fragment key={s.id}><dt>{s.label}</dt><dd><V v={s.balance} full /></dd></Fragment>)}</dl>
          <h3>Foreclosed property (OREO)</h3>
          <dl className="kv">{q1.oreo.map((o) => <Fragment key={o.id}><dt>{o.label}</dt><dd><V v={o.value} full /></dd></Fragment>)}</dl>
        </div>
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Unused CRE commitments, portfolio level</h3>
          <dl className="kv"><dt>Secured</dt><dd><V v={q1.commitments.secured} full /></dd><dt>Unsecured</dt><dd><V v={q1.commitments.unsecured} full /></dd></dl>
          <p className="small muted">{q1.commitments.note}</p>
        </div>
      </div>
      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Restructured loans <span className="pill">{q1.restructured.basis ?? 'basis unknown'}</span></h3>
        <dl className="kv">
          {q1.restructured.byType.map((t) => <Fragment key={t.id}><dt>{t.label}</dt><dd><V v={t.value} full /></dd></Fragment>)}
          <dt>Total restructured (all loans)</dt><dd><V v={q1.restructured.total} full /></dd>
        </dl>
        <p className="small muted">{q1.restructured.note}</p>
        <p className={q1.restructured.seriesBreak.spansTotal || q1.restructured.seriesBreak.spansByType ? 'banner warn small' : 'small muted'}>Series break, {dateOf(q1.restructured.seriesBreak.asOf)}: {q1.restructured.seriesBreak.note}{q1.restructured.seriesBreak.spansTotal || q1.restructured.seriesBreak.spansByType ? ' The series on file spans this break.' : ' The series on file does not span it.'}</p>
      </div>
      <h3>Eight quarters: net change in each balance</h3>
      <p className="small muted">{q1.trend.note} A quarter with an acquisition is withheld. Hover a figure for the balance it moved to.</p>
      <div className="scroll">
        <table>
          <thead><tr><th>Series</th>{trendReps.map((r) => <th key={r} className="num">{dateOf(`${r.slice(0, 4)}-${r.slice(4, 6)}-${r.slice(6)}`)}</th>)}</tr></thead>
          <tbody>
            {q1.trend.series.map((s) => (
              <tr key={s.id}>
                <td>{s.label}<span className="src">{s.tier} · {s.fields.join(' + ')}</span></td>
                {s.points.map((p) => <td key={p.repdte} className="num" title={`balance ${pointText(p, 'balance')} at ${dateOf(p.asOf)}${p.netChangeReason ? ` · ${p.netChangeReason}` : ''}`}>{pointText(p, 'netChange')}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3>Q2. Property types</h3>
      <p className="muted">{paper.q2.note}</p>

      <h3>Q3. Where: {q3.label}</h3>
      <Notes items={q3.caveats} />
      <dl className="kv"><dt>Total deposits</dt><dd><V v={q3.totalDeposits} full /></dd><dt>Share in the buy-box metros</dt><dd><V v={q3.buyboxShare} full /></dd></dl>
      {q3.metros.length ? (
        <div className="scroll">
          <table>
            <thead><tr><th>Metro</th><th className="num">Deposits</th><th className="num">Share of deposits</th><th className="num">Branches</th></tr></thead>
            <tbody>{q3.metros.map((m) => <tr key={m.cbsa}><td>{m.label}{m.inBuybox ? null : <span className="pill">not in buy box</span>}</td><td className="num"><V v={m.deposits} /></td><td className="num"><V v={m.share} /></td><td className="num"><V v={m.branches} /></td></tr>)}</tbody>
          </table>
        </div>
      ) : null}

      <h3>Q4. Sizes: nonfarm nonresidential only{q4.asOf ? `, as of ${dateOf(q4.asOf)}` : ''}</h3>
      <p className="small muted">{q4.note}</p>
      <Notes items={q4.caveats} />
      <div className="scroll">
        <table>
          <thead><tr><th>Original amount</th><th className="num">Loans</th><th className="num">Dollars</th><th className="num">Share of nonfarm nonresidential</th></tr></thead>
          <tbody>
            {q4.buckets.map((b) => <tr key={b.id}><td>{b.label}</td><td className="num"><V v={b.count} /></td><td className="num"><V v={b.dollars} /></td><td className="num"><V v={b.shareOfNonfarmNonresidential} /></td></tr>)}
            <tr><td>Under $1 million in all</td><td className="num"><V v={q4.under1m.count} /></td><td className="num"><V v={q4.under1m.dollars} /></td><td className="num"><V v={q4.under1m.shareOfNonfarmNonresidential} /></td></tr>
            <tr><td>$1 million or more</td><td className="num"><V v={q4.over1m.count} /></td><td className="num"><V v={q4.over1m.dollars} /></td><td className="num"><V v={q4.over1m.shareOfNonfarmNonresidential} /></td></tr>
          </tbody>
        </table>
      </div>
      <dl className="kv"><dt>Average loan under $1 million</dt><dd><V v={q4.averageSmallLoan} full /></dd></dl>

      <h3>Q5. Maturity and repricing: {q5.label}</h3>
      <Notes items={q5.caveats} />
      <div className="scroll">
        <table>
          <thead><tr><th>Remaining maturity or next repricing</th><th className="num">Amount</th></tr></thead>
          <tbody>{q5.buckets.map((b) => <tr key={b.id}><td>{b.label}</td><td className="num"><V v={b.value} /></td></tr>)}<tr><td>All six buckets</td><td className="num"><V v={q5.total} /></td></tr></tbody>
        </table>
      </div>
      <p className="small muted">Vintages: <V v={q5.vintages} full /></p>

      <h3>Q6. Is this lender already a seller?</h3>
      <p className="small muted">{q6.note}</p>
      {q6.items.length ? (
        <ul>
          {q6.items.map((i, n) => (
            <li key={n}>
              <strong>{dateOf(i.date)}</strong>: {i.label}{i.link ? <> (<a href={i.link} rel="noopener noreferrer nofollow" target="_blank">filing</a>)</> : null} <span className="pill">{i.tier}</span>
              {i.values ? <dl className="kv small">{Object.entries(i.values).map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd><V v={v} /></dd></Fragment>)}</dl> : null}
              {i.targetCre ? <span className="src">Target's CRE at its last report: {show(i.targetCre).text} ({show(i.targetCre).tier || 'unknown'}, {show(i.targetCre).date || 'no date'})</span> : null}
            </li>
          ))}
        </ul>
      ) : <p className="muted">None on file.</p>}

      <h3>Q7. How much fits the buy box: bounds only{q7.provisional ? ' (provisional)' : ''}</h3>
      <p className="small muted">{q7.note} Method: {q7.formula}.</p>
      {q7.fitRule ? <p className="small">Fit rule, {q7.fitRule}</p> : null}
      {q7.statusRule?.text ? <p className="small">{q7.statusRule.text}</p> : null}
      {q7.sectors.map((s) => (
        <div key={s.sector} className="panel">
          <h3 style={{ marginTop: 0 }}>{s.label} <span className="muted small">inside {s.category}</span></h3>
          <p>In the buy box: <V v={s.bounds} full /></p>
          {s.oreo ? (
            <p>{s.oreo.label}, its own figure (property, not loans; never added to the loan bounds): {s.oreo.figure ? <V v={s.oreo.figure} full /> : <span className="muted">not in the buy box</span>}<span className="src">{s.oreo.note}</span></p>
          ) : null}
          {s.statusLoans ? (
            <>
              <p>{s.statusLoans.label}: <V v={s.statusLoans.amount} full /></p>
              <div className="scroll">
                <table>
                  <thead><tr><th>Line</th>{(s.statusLoans.byLine[0]?.parts ?? []).map((p) => <th key={p.stage} className="num">{p.label}</th>)}</tr></thead>
                  <tbody>{s.statusLoans.byLine.map((l) => <tr key={l.line}><td>{l.label}</td>{l.parts.map((p) => <td key={p.stage} className="num"><V v={at(paper, p.ref)} /></td>)}</tr>)}</tbody>
                </table>
              </div>
              {s.statusLoans.notReported?.length ? <Notes items={s.statusLoans.notReported.map((n) => `${n.stageLabel}, ${n.lineLabel.toLowerCase()}: ${STATUS_LABELS[n.status] ?? 'unknown'}. ${n.reason} It enters as anywhere from none to the rest of the line's balance, never as zero, so the amount is a range.`)} /> : null}
            </>
          ) : null}
          {s.bounds?.lowNote ? <p className="small muted">{s.bounds.lowNote}</p> : null}
          {s.unknownConditions?.length ? <Notes items={s.unknownConditions.map((u) => `Cannot be measured, ${u.label}: ${u.reason}`)} /> : null}
          {s.why ? <p className="small">{s.why}</p> : null}
          <div className="scroll">
            <table>
              <thead><tr><th>Condition used</th><th className="num">Share of the CRE book</th><th>Tier</th><th>Basis</th></tr></thead>
              <tbody>{s.conditions.map((c) => <tr key={c.id}><td>{c.label}</td><td className="num" title={(c.share.sources ?? []).map((x) => `${x.field} ${x.repdte}`).join('; ')}>{shareText(c.share)}</td><td className="small">{c.share.tier ?? 'unknown: 0 to all'}</td><td className="small">{c.basis}</td></tr>)}</tbody>
            </table>
          </div>
          <Notes items={(s.notUsed ?? []).map((n) => `Not used, ${n.id}: ${n.reason}`)} />
        </div>
      ))}

      <h3>Q8. What we do not know</h3>
      <ul>{q8.unknowns.map((u) => <li key={u.id}>{u.text}</li>)}</ul>
      <h3>The tape request <span className="muted small">{q8.tapeRequest.when}</span></h3>
      <ul>{q8.tapeRequest.items.map((t) => <li key={t}>{t}</li>)}</ul>
    </>
  );
}
