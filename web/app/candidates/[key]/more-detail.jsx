// The Details tab's disclosures: how the score was built; has it sold loans before (Q6); loan sizes (Q4); when loans mature or reprice
// (Q5); modified loans and unused credit lines; net change by quarter (the Q1 trend); technical detail. Native <details>, server-rendered.
import { Fragment } from 'react';
import { AXES } from '../../../lib/candidates-view.mjs';
import { COMPONENT_LABELS, componentValue, soldItems, CATEGORY } from '../../../lib/bank-view.mjs';
import { pointText, dateOf, show } from '../../../lib/paper-view.mjs';
import { period } from '../../../lib/format.mjs';
import { Disclosure, Value } from '../../ui.jsx';

function ScoreBuilt({ item, max }) {
  return (
    <>
      <p className="small muted">Each measure earns points up to its weight, in proportion to how far it is toward a set level. The weights are placeholders the principals tune.</p>
      {AXES.map((a) => (
        <Fragment key={a.id}>
          <div className="axis-title"><b>{a.label}: {a.q}</b><span className="muted small">{Number(item.axes?.[a.id] ?? 0).toFixed(1)} of {max[a.id]} points</span></div>
          <div className="tablebox">
            <table className="plain">
              <thead><tr><th>What we measure</th><th className="r">Value</th><th className="r">Points</th></tr></thead>
              <tbody>
                {(item.components ?? []).filter((c) => c.axis === a.id).map((c) => (
                  <tr key={c.id}>
                    <td>{COMPONENT_LABELS[c.id] ?? c.label}{c.missing ? <div className="small muted">{c.missing}</div> : null}<span className="code">{(c.inputs ?? []).map((x) => `${x.field ?? 'branches'}${x.repdte ? ` (${period(x.repdte)})` : ''}`).join(', ')}</span></td>
                    <td className="r">{componentValue(c)}</td>
                    <td className="r"><div className="pts"><span>{Number(c.points ?? 0).toFixed(1)} of {c.weight}</span><div className="bar"><span className={a.cls} style={{ width: `${c.weight ? Math.min(100, (c.points / c.weight) * 100).toFixed(0) : 0}%` }} /></div></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Fragment>
      ))}
    </>
  );
}

const gapless = (v) => v && !show(v).gap;

export function MoreDetail({ item, paper, max }) {
  const q1 = paper?.q1, q4 = paper?.q4, q5 = paper?.q5, sold = soldItems(paper);
  const reps = q1?.trend?.series?.[0]?.points?.map((p) => p.asOf) ?? [];
  return (
    <section aria-labelledby="h-more" className="page">
      <h2 id="h-more" className="sec-h">More detail</h2>
      <div className="card more">
        <Disclosure id="score" title="How the score was built" desc={`${Math.round(Number(item.score ?? 0))} of 100 · ${(item.components ?? []).length} measures`}>
          <ScoreBuilt item={item} max={max} />
        </Disclosure>
        {paper ? (
          <>
            <Disclosure title="Has it sold loans before?" desc={sold.length ? `${sold.length} item${sold.length === 1 ? '' : 's'} on record` : 'Nothing on record'}>
              {paper.q6?.note ? <p className="small muted">{paper.q6.note}</p> : null}
              {sold.length ? (
                <div className="tablebox"><table className="plain"><tbody>{sold.map((s, i) => (
                  <tr key={i}><td className="muted">{s.date}</td><td>{s.label}{s.link ? <> (<a href={s.link} rel="noopener noreferrer nofollow" target="_blank">filing</a>)</> : null}
                    {s.values ? <dl className="kv small">{Object.entries(s.values).map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd><Value v={v} pageDate={paper.asOf} /></dd></Fragment>)}</dl> : null}</td></tr>
                ))}</tbody></table></div>
              ) : <p className="muted">No held-for-sale loans, loan sales, filings or acquisitions on record.</p>}
            </Disclosure>
            <Disclosure title="Loan sizes, commercial property" desc={`${q4?.asOf ? `${dateOf(q4.asOf)} · ` : ''}by original amount`}>
              <div className="tablebox">
                <table className="plain">
                  <thead><tr><th>Original amount</th><th className="r">Loans</th><th className="r">Dollars</th><th className="r">Share</th></tr></thead>
                  <tbody>
                    {(q4?.buckets ?? []).map((b) => <tr key={b.id}><td>{b.label}</td><td className="r"><Value v={b.count} pageDate={paper.asOf} /></td><td className="r"><Value v={b.dollars} pageDate={paper.asOf} /></td><td className="r"><Value v={b.shareOfNonfarmNonresidential} pageDate={paper.asOf} /></td></tr>)}
                    {q4?.under1m ? <tr><td>Under $1 million in all</td><td className="r"><Value v={q4.under1m.count} pageDate={paper.asOf} /></td><td className="r"><Value v={q4.under1m.dollars} pageDate={paper.asOf} /></td><td className="r"><Value v={q4.under1m.shareOfNonfarmNonresidential} pageDate={paper.asOf} /></td></tr> : null}
                    {q4?.over1m ? <tr><td>$1 million and over</td><td className="r"><Value v={q4.over1m.count} pageDate={paper.asOf} /></td><td className="r"><Value v={q4.over1m.dollars} pageDate={paper.asOf} /></td><td className="r"><Value v={q4.over1m.shareOfNonfarmNonresidential} pageDate={paper.asOf} /></td></tr> : null}
                  </tbody>
                </table>
              </div>
              <p className="small muted">Average loan under $1 million: <Value v={q4?.averageSmallLoan} pageDate={paper.asOf} />. {(q4?.caveats ?? []).join(' ')}</p>
            </Disclosure>
            <Disclosure title="When loans mature or reprice" desc="All loans except home mortgages">
              <div className="tablebox">
                <table className="plain">
                  <thead><tr><th>Matures or reprices in</th><th className="r">Amount</th></tr></thead>
                  <tbody>{(q5?.buckets ?? []).map((b) => <tr key={b.id}><td>{b.label}</td><td className="r"><Value v={b.value} pageDate={paper.asOf} /></td></tr>)}<tr><td>All six</td><td className="r"><Value v={q5?.total} pageDate={paper.asOf} /></td></tr></tbody>
                </table>
              </div>
              <p className="small muted">A stand-in only. {(q5?.caveats ?? []).join(' ')}</p>
            </Disclosure>
            <Disclosure title="Modified loans and unused credit lines" desc={gapless(q1?.restructured?.total) ? `${show(q1.restructured.total).text} modified` : 'Modified loans, unused lines, series break'}>
              <div className="tablebox">
                <table className="plain">
                  <tbody>
                    {(q1?.restructured?.byType ?? []).map((t) => <tr key={t.id}><td>Modified, {(CATEGORY[t.id]?.lower ?? t.label.toLowerCase())}</td><td className="r"><Value v={t.value} pageDate={paper.asOf} /></td></tr>)}
                    <tr><td>Modified for borrowers in difficulty, all loans</td><td className="r"><Value v={q1?.restructured?.total} pageDate={paper.asOf} /></td></tr>
                    <tr><td>Unused CRE credit lines, secured (construction draws still to come)</td><td className="r"><Value v={q1?.commitments?.secured} pageDate={paper.asOf} /></td></tr>
                    <tr><td>Unused CRE credit lines, unsecured</td><td className="r"><Value v={q1?.commitments?.unsecured} pageDate={paper.asOf} /></td></tr>
                  </tbody>
                </table>
              </div>
              {q1?.restructured?.seriesBreak ? <p className="small muted">The accounting rules for modified loans changed on {dateOf(q1.restructured.seriesBreak.asOf)}, so figures before and after are not comparable.{q1.restructured.seriesBreak.spansTotal || q1.restructured.seriesBreak.spansByType ? ' The figures on file span that change.' : ''}</p> : null}
              {q1?.commitments?.note ? <p className="small muted">{q1.commitments.note}</p> : null}
            </Disclosure>
            <Disclosure title="Net change by quarter" desc="Balances, quarter on quarter">
              <p className="small muted">{q1?.trend?.note} A quarter with an acquisition is withheld.</p>
              <div className="tablebox">
                <table className="plain">
                  <thead><tr><th>Loan type</th>{reps.map((r) => <th key={r} className="r">{dateOf(r)}</th>)}</tr></thead>
                  <tbody>{(q1?.trend?.series ?? []).map((s) => (
                    <tr key={s.id}><td>{CATEGORY[s.id]?.label ?? (s.id === 'investorCre' ? 'CRE book (investor)' : s.label)}<span className="code">{s.fields.join(' + ')}</span></td>
                      {s.points.map((p) => <td key={p.repdte} className="r">{pointText(p, 'netChange')}</td>)}</tr>
                  ))}</tbody>
                </table>
              </div>
            </Disclosure>
          </>
        ) : null}
        <Disclosure title="Technical detail" desc="Key, scoring run, record">
          <dl className="kv small">
            <dt>Bank key</dt><dd className="mono">{item.key}</dd>
            <dt>Tier note</dt><dd>{item.tierNote ?? '–'}</dd>
            {paper ? <><dt>Scoring run</dt><dd className="mono">{paper.runId ?? 'unknown'} (the last run that changed this record)</dd>
              <dt>Record</dt><dd>{paper.layer} · {paper.scope === 'charter' ? 'charter only (not the holding company)' : paper.scope} · data as of {dateOf(paper.asOf)}</dd>
              <dt>Placeholders</dt><dd>{(paper.placeholders ?? []).length ? paper.placeholders.join(', ') : 'none'}</dd></> : <><dt>Record</dt><dd>No paper estimate yet. The next scoring run writes one.</dd></>}
          </dl>
          {(item.profile?.limits ?? []).length ? <ul className="small muted">{item.profile.limits.map((l, i) => <li key={i}>{l}</li>)}</ul> : null}
        </Disclosure>
      </div>
    </section>
  );
}
