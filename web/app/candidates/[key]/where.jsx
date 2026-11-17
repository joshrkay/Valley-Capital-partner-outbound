// Where it lends, in the record page's sidebar: deposit share by metro as bars (Q3), standing in for where the bank lends. Only stored
// shares are drawn; the share in our six metros is the record's own figure. A server component.
import { whereRows } from '../../../lib/bank-view.mjs';
import { show, dateOf } from '../../../lib/paper-view.mjs';
import { Tile } from '../../icons.jsx';
import { Term } from '../../ui.jsx';

const pct0 = (x) => `${Math.round(x * 100)}%`;

export function Where({ item, paper }) {
  const rows = whereRows(item, paper);
  const share = paper?.q3?.buyboxShare;
  const when = paper?.q3?.asOf ? dateOf(paper.q3.asOf) : item.profile?.footprint?.sodYear ? `June 30, ${item.profile.footprint.sodYear}` : '';
  return (
    <section className="card side-card" aria-labelledby="h-where">
      <div className="card-head"><Tile icon="pin" tone="t-mkt" size="sm" /><h2 id="h-where"><Term id="where">Where it lends</Term></h2>{when ? <span className="card-head-r xs">Deposits, {when}</span> : null}</div>
      <div className="card-body">
        {rows.length ? rows.map((m) => (
          <div key={m.cbsa} className="srow">
            <div className="srow-top"><b>{m.label}{m.inBuybox ? '' : ' (not ours)'}</b><span className="tnum muted">{m.share !== null ? pct0(m.share) : '–'}{m.branches !== null ? ` · ${m.branches} branch${m.branches === 1 ? '' : 'es'}` : ''}</span></div>
            <div className="strack" aria-hidden="true"><span style={{ width: `${((m.share ?? 0) * 100).toFixed(1)}%` }} /></div>
            {m.codes ? <span className="code">{m.codes}</span> : null}
          </div>
        )) : <p className="muted">No branches or deposits in our metros on record.</p>}
        {share && !show(share).gap ? <p className="small mt8">In our six metros: <strong>{show(share).text}</strong> of its deposits. The rest is elsewhere.</p> : null}
        <p className="small muted mt8">Deposits stand in for loans: banks mostly lend near their branches, but not always.</p>
      </div>
    </section>
  );
}
