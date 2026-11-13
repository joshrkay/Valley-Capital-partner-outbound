import { requirePrincipal } from '../../../lib/session.mjs';
import { candidateDetail } from '../../../lib/ops.mjs';
import { period, moneyThousands, pct, num, source } from '../../../lib/format.mjs';
import { NotAuthorized, Problem, Sourced } from '../../ui.jsx';
import { promoteAction, dismissAction, snoozeAction } from '../actions.js';

const STAGES = [['pastDue30to89', '30–89 days'], ['pastDue90', '90+ days'], ['nonaccrual', 'Nonaccrual'], ['noncurrent', 'Noncurrent'], ['oreo', 'OREO'], ['chargeOffsQuarter', 'Charge-offs (qtr)']];
const AXES = [['distress', 'Distress: is the bank under pressure?'], ['fit', 'Fit: is its paper what we buy, where we buy it?'], ['timing', 'Timing: why now?']];
const fmtValue = (c) => (c.value === null || c.value === undefined ? '–' : /share|ratio|rate|delinquency/i.test(`${c.metric ?? ''} ${c.id}`) ? pct(c.value) : Math.abs(c.value) >= 1 ? moneyThousands(c.value) : pct(c.value));

export default async function Candidate({ params }) {
  const ctx = await requirePrincipal();
  if (ctx.denied) return <NotAuthorized email={ctx.email} />;
  const { key: raw } = await params;
  const key = decodeURIComponent(raw);
  let d;
  try { d = await candidateDetail(ctx.client, key); } catch (e) { return <Problem text={`This candidate could not be loaded: ${e.message}`} />; }
  if (!d) return <Problem text={`There is no candidate ${key} in the latest scoring run.`} />;
  const { item, decision, suppressed } = d;
  const p = item.profile ?? {};
  return (
    <>
      <h1>{item.name}</h1>
      <p className="sub">{item.key} · {[item.city, item.state].filter(Boolean).join(', ')} · total assets <Sourced input={{ field: 'ASSET', repdte: item.latestRepdte }}>{moneyThousands(item.assets)}</Sourced> · data as of {period(item.latestRepdte)}</p>
      {suppressed ? <div className="banner error">This institution is on the suppression list. It cannot be promoted.</div> : null}
      {decision ? <div className="banner warn">Decision on record: {decision.status} by {decision.by}{decision.until ? ` until ${decision.until}` : ''}{decision.reason ? ` (${decision.reason})` : ''}.</div> : null}

      <div className="grid2">
        <div className="panel">
          <dl className="kv">
            <dt>Tier</dt><dd><span className={`tier ${item.tier ?? ''}`}>{item.tier ?? 'none'}</span> <span className="muted small">{item.tierNote}</span></dd>
            <dt>Score</dt><dd>{num(item.score, 2)} = distress {num(item.axes?.distress, 2)} + fit {num(item.axes?.fit, 2)} + timing {num(item.axes?.timing, 2)}</dd>
            <dt>Hard filters</dt><dd>{item.filtersFailed?.length ? item.filtersFailed.join('; ') : 'passed'}</dd>
          </dl>
        </div>
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Decide</h3>
          {item.filtersFailed?.length || suppressed ? <p className="muted small">Promotion is not available for this bank.</p> : (
            <form action={promoteAction} className="inline"><input type="hidden" name="key" value={item.key} /><button type="submit">Promote to an account</button></form>
          )}
          <form action={dismissAction} className="inline"><input type="hidden" name="key" value={item.key} /><label>Reason<input name="reason" required placeholder="why not now" /></label><button className="danger" type="submit">Dismiss</button></form>
          <form action={snoozeAction} className="inline"><input type="hidden" name="key" value={item.key} /><label>Until<input type="date" name="until" required /></label><button className="secondary" type="submit">Snooze</button></form>
        </div>
      </div>

      <h2>Why now</h2>
      <div className="panel">
        {(item.card?.sentences ?? []).map((s, i) => <p key={i} style={{ margin: '4px 0' }} title={`Evidence: ${(s.evidence ?? []).join(', ')}`}>{s.text}</p>)}
        {!item.card ? <p className="muted">No card: the components below are the record.</p> : <p className="src">Built from templates in code from the records cited (hover a sentence). Never written by a model.</p>}
      </div>

      <h2>The paper: what this bank likely holds</h2>
      <div className="scroll">
        <table>
          <thead><tr><th>Category</th><th className="num">Balance</th><th className="num">Share of CRE</th>{STAGES.map(([, l]) => <th key={l} className="num">{l}</th>)}<th>4 quarters</th><th>Buy box</th></tr></thead>
          <tbody>
            {(p.categories ?? []).map((c) => (
              <tr key={c.id}>
                <td>{c.label}</td>
                <td className="num"><Sourced input={c.balance}>{moneyThousands(c.balance?.value)}</Sourced></td>
                <td className="num"><Sourced input={c.shareOfCre}>{pct(c.shareOfCre?.value, 1)}</Sourced></td>
                {STAGES.map(([k]) => { const s = c.stages?.[k]; return <td key={k} className="num">{!s || s.field === null ? <span className="muted" title={s?.note}>no field</span> : <Sourced input={s}>{moneyThousands(s.value)}{s.ratio !== undefined && s.ratio !== null ? ` · ${pct(s.ratio)}` : ''}</Sourced>}</td>; })}
                <td className="small" title={c.direction4q ? `${source(c.direction4q.from)} → ${source(c.direction4q.to)}` : undefined}>{c.direction4q ? `${c.direction4q.measure}: ${pct(c.direction4q.from?.value)} → ${pct(c.direction4q.to?.value)} (${c.direction4q.direction})` : '–'}</td>
                <td className="small">{c.fit?.buys ? 'buys' : 'does not buy'}<span className="src">{c.fit?.reason}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="small muted">{(p.limits ?? []).map((l, i) => <li key={i}>{l}</li>)}</ul>

      <h2>Where it operates</h2>
      <div className="scroll">
        <table>
          <thead><tr><th>Metro</th><th className="num">Branches</th><th className="num">Deposits</th><th className="num">Share of deposits</th></tr></thead>
          <tbody>
            {(p.footprint?.metros ?? []).filter((m) => (m.branches?.value ?? 0) > 0 || (m.deposits?.value ?? 0) > 0).map((m) => (
              <tr key={m.cbsa}>
                <td>{m.label}{m.inBuybox ? '' : <span className="pill">not in buy box</span>}</td>
                <td className="num" title={m.branches?.source}>{m.branches?.value ?? '–'}</td>
                <td className="num">{m.deposits ? <Sourced input={m.deposits}>{moneyThousands(m.deposits.value)}</Sourced> : '–'}</td>
                <td className="num">{pct(m.depositShare, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {p.footprint?.note ? <p className="small muted">{p.footprint.note}</p> : null}

      <h2>How the score was built</h2>
      {AXES.map(([axis, title]) => (
        <div key={axis} className="panel">
          <h3 style={{ marginTop: 0 }}>{title} <span className="muted">{num(item.axes?.[axis], 2)} points</span></h3>
          <div className="scroll">
            <table>
              <thead><tr><th>Component</th><th className="num">Value</th><th className="num">Points</th><th>From</th></tr></thead>
              <tbody>
                {(item.components ?? []).filter((c) => c.axis === axis).map((c) => (
                  <tr key={c.id}>
                    <td>{c.label}{c.missing ? <span className="src">{c.missing}</span> : null}</td>
                    <td className="num">{fmtValue(c)}</td>
                    <td className="num">{num(c.points, 2)} / {c.weight}</td>
                    <td className="small mono">{(c.inputs ?? []).map((x, i) => <span key={i} className="src" title={x.note}>{x.field ?? 'branches'} = {x.value ?? '–'}{x.repdte ? ` (${period(x.repdte)})` : ''}</span>)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      <h2>Signals</h2>
      {item.signals?.length ? (
        <ul>{item.signals.map((s) => <li key={s.id}>{s.label} <span className="src">{period(s.period)} · evidence {(s.evidence ?? []).join(', ')}</span></li>)}</ul>
      ) : <p className="muted">No signal fired in the latest quarter.</p>}
    </>
  );
}
