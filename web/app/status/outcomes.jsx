// The Status page's section on what led to conversations (PRD E15-S4): the engine's own outcomes report, rendered on the server, the one
// `outbound outcomes report` prints. Counts only, by signal type, tier and lead time: no name, no note, no account. It changes no weight.
// If it cannot be loaded, only this section says so; the rest of the page still shows.
import { outcomesOverview } from '../../lib/ops.mjs';
import { outcomesView } from '../../lib/outcomes-view.mjs';

function Table({ title, rows, columns, totals }) {
  return (
    <>
      <h3>{title}</h3>
      <div className="scroll"><table>
        <thead><tr><th>Group</th>{columns.map((c) => <th key={c.label} className="num">{c.label}{c.title ? <span className="src">{c.title}</span> : null}</th>)}</tr></thead>
        <tbody>
          {rows.length ? rows.map((r) => <tr key={r.label}><td className="mono">{r.label}</td>{r.cells.map((n, i) => <td key={i} className="num">{n}</td>)}</tr>)
            : <tr><td colSpan={columns.length + 1} className="muted">None yet.</td></tr>}
          {totals ? <tr><td><strong>{totals.label}</strong></td>{totals.cells.map((n, i) => <td key={i} className="num"><strong>{n}</strong></td>)}</tr> : null}
        </tbody>
      </table></div>
    </>
  );
}

export async function Outcomes({ client }) {
  let v = null;
  let error = null;
  try { v = outcomesView(await outcomesOverview(client)); } catch (e) { error = e.message; }
  return (
    <>
      <h2>What led to conversations</h2>
      <p className="sub">Confirmed call outcomes and meetings recorded by hand, counted by the signals that started each account, by tier and by lead time. The same report as <span className="mono">outbound outcomes report</span>. Counts only: no names and no notes. It never changes the scoring weights.</p>
      {error ? <div className="banner error">The outcomes could not be counted: {error}</div> : null}
      {v ? (
        <>
          <p>{v.headline}</p>
          <div className={`banner ${v.tooFew ? 'warn' : 'ok'}`}>{v.note}</div>
          {v.empty ? null : (
            <>
              <Table title={v.tables[0].title} rows={v.tables[0].rows} columns={v.columns} totals={v.totals} />
              <Table title={v.tables[1].title} rows={v.tables[1].rows} columns={v.columns} />
              <Table title={v.tables[2].title} rows={v.tables[2].rows} columns={v.columns} />
              <p className="small">{v.leadTime}{v.otherOutcomes.length ? ` Other outcomes, in accounts: ${v.otherOutcomes.map((o) => `${o.code} ${o.n}`).join(', ')}.` : ''}</p>
            </>
          )}
          <p className="muted small">{v.counting} Scoring weights: {v.weights}.</p>
        </>
      ) : null}
    </>
  );
}
