import { requirePrincipal } from '../../lib/session.mjs';
import { latestMarketPack } from '../../lib/ops.mjs';
import { moneyDollars } from '../../lib/format.mjs';
import { NotAuthorized, Problem, PageHead } from '../ui.jsx';

export const metadata = { title: 'Market · Valley Capital outbound' };

const pct = (x) => (x === null || x === undefined ? '–' : `${(x * 100).toFixed(2)}%`);
const pp = (x) => (x === null || x === undefined ? '–' : `${x >= 0 ? '+' : ''}${(x * 100).toFixed(2)} pts`);
const Hidden = () => <span className="muted small">not shown: too few sources</span>;

// PRD next-five E20: the market data pack, aggregates by metro. No institution is named. Publishing waits for counsel (Q25).
export default async function Market() {
  const ctx = await requirePrincipal();
  if (ctx.denied) return <NotAuthorized email={ctx.email} />;
  let p;
  try { p = await latestMarketPack(ctx.client); } catch (e) { return <Problem text={`The market pack could not be loaded: ${e.message}`} />; }
  if (!p) return <><PageHead icon="chart" tone="t-mkt" eyebrow="Market" title="Market by quarter" /><p className="muted">No market pack yet. Run: outbound market pack --quarter YYYY-MM-DD</p></>;
  const cmbs = (title, t, bal) => (
    <>
      <h2>{title}</h2>
      <div className="scroll"><table>
        <thead><tr><th>Metro</th>{p.sectors.map((s) => <th key={s}>{s}</th>)}</tr></thead>
        <tbody>{p.metros.map((m) => <tr key={m.cbsa}><td>{m.label}</td>{p.sectors.map((s) => { const x = t[m.cbsa][s]; return <td key={s}>{x.suppressed ? <Hidden /> : `${x.loans} loan(s)${bal ? `, ${moneyDollars(x.balance)}` : ''}`}</td>; })}</tr>)}</tbody>
      </table></div>
    </>
  );
  return (
    <>
      <PageHead icon="chart" tone="t-mkt" eyebrow="Market by quarter" title={`Market, quarter ending ${p.quarter}`} lede={<>Aggregates only: no bank, servicer, trust, property or person is named. For principals now; it becomes a data section in the Hotel loan watch only after counsel answers.</>} />
      <h2>Banks: CRE noncurrent ratio</h2>
      <p className="small muted">{p.method.fdic}</p>
      <div className="scroll"><table>
        <thead><tr><th>Metro</th>{p.categories.map((c) => <th key={c.id}>{c.label}</th>)}</tr></thead>
        <tbody>{p.metros.map((m) => <tr key={m.cbsa}><td>{m.label}</td>{p.categories.map((c) => { const x = p.fdic.cells[m.cbsa][c.id]; return <td key={c.id}>{x.suppressed ? <Hidden /> : <>{pct(x.noncurrentRatio)} <span className="src">{x.banks} banks · q/q {pp(x.noncurrentChangeQoQ)} · y/y {pp(x.noncurrentChangeYoY)}</span></>}</td>; })}</tr>)}</tbody>
      </table></div>
      <p className="small muted">{p.method.cmbs}{p.cmbs.note ? ` ${p.cmbs.note}` : ''}</p>
      {cmbs(`CMBS loans in special servicing (as of ${p.cmbs.asOf ?? '–'})`, p.cmbs.inSpecialServicing, true)}
      {cmbs('New transfers to special servicing in the quarter', p.cmbs.newTransfers, true)}
      {cmbs('Dispositions in the quarter', p.cmbs.dispositions, false)}
      <h2>Left out</h2>
      <ul className="small">{p.leftOut.map((x) => <li key={x}>{x}</li>)}</ul>
    </>
  );
}
