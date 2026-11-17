// The "What it holds" tab: one disclosure row per loan type, from the balance to foreclosed property to what could fit our buy box. Each
// row opens to a scaled bar of its late stages, what was written off, and the buy-box explanation; commercial property holds its two
// lines inside it. "Not reported" is never shown as zero. A server component; rows come from lib/bank-view.mjs (joined, never summed).
import { holdingRows, ladderScale } from '../../../lib/bank-view.mjs';
import { STAGES, show } from '../../../lib/paper-view.mjs';
import { moneyThousands } from '../../../lib/format.mjs';
import { Term, Basis } from '../../ui.jsx';

const KEYS = { pastDue30to89: 'k-s30', pastDue90: 'k-s90', nonaccrual: 'k-sna' };
const BUY = { yes: ['buy-yes', 'We buy'], partly: ['buy-partly', 'Partly ours'], no: ['buy-no', 'Not a type we buy'] };

function Cell({ label, c, sub = null, fit = false }) {
  if (!c || c.gap) return <div className="cat-cell"><span className="lbl">{label}</span><span className="gap">{c?.text ?? 'Not reported'}</span></div>;
  return (
    <div className={`cat-cell${fit ? ' fitcell' : ''}`}>
      <span className="lbl">{label}</span>
      <div className="amt">{c.text}</div>
      {sub ?? c.sub ?? c.share ? <div className="pc">{sub ?? c.sub ?? c.share}{c.estimate ? <> <Basis tier="inferred" /></> : null}</div> : null}
      {c.codes ? <span className="code">{c.codes}</span> : null}
    </div>
  );
}

function Cells({ r, child = false }) {
  return (
    <>
      <Cell label="Balance" c={r.balance} sub={!child && r.shareOfCre ? `${r.shareOfCre} of CRE` : ''} />
      {STAGES.map(([k, label]) => <Cell key={k} label={label} c={r.stages[k]} />)}
      <Cell label="Foreclosed property" c={r.oreo} sub="property owned" />
      <Cell label="Could fit our buy box" c={r.fit} fit />
    </>
  );
}

function Ladder({ r, scale }) {
  if (!r.balance || r.balance.gap || !r.balance.value) return <p className="muted">No loans of this type on its books.</p>;
  const stages = STAGES.map(([k]) => r.stages[k]);
  if (stages.every((c) => !c || c.gap) && new Set(stages.map((c) => c?.text)).size === 1) return <p className="muted">Late stages: {(stages[0]?.text ?? 'Not reported').toLowerCase()}.</p>;
  return (
    <div className="ladder">
      {STAGES.map(([k, label]) => {
        const c = r.stages[k];
        if (!c || c.gap) return <div key={k} className="ladder-row"><span>{label}</span><div className="track" /><span className="v muted">{c?.text ?? 'Not reported'}</span></div>;
        const w = c.ratio !== null && c.ratio !== undefined ? Math.min(1, c.ratio / scale) * 100 : 0;
        return <div key={k} className="ladder-row"><span>{label}</span><div className="track"><span className={KEYS[k]} style={{ width: `${w.toFixed(1)}%` }} /></div><span className="v">{c.text}{c.share ? ` · ${c.share}` : ''}</span></div>;
      })}
      <div className="ladder-scale" aria-hidden="true"><span /><div><span>0%</span><span>{(scale * 50).toFixed(scale * 50 < 1 ? 1 : 0)}%</span><span>{(scale * 100).toFixed(0)}% of balance</span></div><span /></div>
    </div>
  );
}

const flow = (c) => (!c ? 'not reported' : c.gap ? c.text.toLowerCase() : c.text);

function Body({ r, scale }) {
  const balance = r.balance && !r.balance.gap ? r.balance.text : '';
  return (
    <div className="cat-body">
      <div>
        <h4>Of its {balance ? `${balance} in ` : ''}{r.lower}</h4>
        <Ladder r={r} scale={scale} />
        {r.oreo && !r.oreo.gap ? <p>The bank also owns <strong>{r.oreo.text}</strong> of foreclosed {r.id === 'multifamily' ? 'apartment' : r.id === 'construction' ? 'construction or land' : 'commercial'} property, counted apart from the loans.</p> : null}
        {r.note ? <p className="small muted">{r.note}</p> : null}
      </div>
      <div>
        <h4><Term id="writeoff">Written off</Term></h4>
        <p>{r.writtenOff ? `${flow(r.writtenOff.quarter)} this quarter, ${flow(r.writtenOff.ytd)} so far this year.` : 'Not in the record.'}</p>
        <p className="small muted">Losses less recoveries: a flow over the period, never part of the balance.</p>
      </div>
      <div className="full">
        {r.fit && !r.fit.gap ? (
          <p><strong>Could fit our buy box: $0 to {r.fit.text.replace(/^up to /, '')}{r.id === 'multifamily' ? '' : `, ${r.fit.sub}`}.</strong>{r.fit.estimate ? <> <Basis tier="inferred" /></> : null} {r.fit.lowNote}</p>
        ) : r.buys === 'no' ? <p>We do not buy {r.lower}, so none of this counts toward the buy box.</p> : <p className="muted">{r.fit?.text}. {r.fitReason}</p>}
        {r.id === 'nonfarmNonresidential' ? <p className="small muted">Hotels and retail sit here, mixed with offices, warehouses and other property. Public reports do not split them, so the real figure is lower than the ceiling.</p> : null}
      </div>
      {r.children?.length ? (
        <div className="children">
          <h4>The two lines inside commercial property</h4>
          {r.children.map((c) => (
            <div key={c.id} className="cat-grid">
              <div className="cat-name"><span /><div><b><Term id={c.term}>{c.label}</Term></b><span className="fdic">{c.fdic}</span></div></div>
              <Cells r={c} child />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function Holdings({ item, paper }) {
  const rows = holdingRows(item.profile, paper?.q1, paper?.q7);
  const scale = ladderScale(rows);
  const book = paper?.q1?.creBook && !show(paper.q1.creBook).gap ? show(paper.q1.creBook).text : item.profile?.creLoans?.value ? moneyThousands(item.profile.creLoans.value) : '';
  return (
    <section aria-labelledby="h-holds" className="page">
      <h2 id="h-holds" className="sr">What it holds</h2>
      <p className="sec-intro">Its {book ? `${book} ` : ''}<Term id="cre">commercial real estate book</Term> by type, from the balance down to foreclosed property. Open a row for the late stages, losses and the buy-box detail.</p>
      {rows.length ? (
        <div className="cats">
          <div className="cat-grid cat-headrow" aria-hidden="true">
            <div>Type of loan</div><div>Balance</div>
            {STAGES.map(([k, label]) => <div key={k}><span className={`stage-key ${KEYS[k]}`} />{label}</div>)}
            <div><span className="stage-key k-oreo" />Foreclosed property</div><div>Could fit our buy box</div>
          </div>
          {rows.map((r) => (
            <details key={r.id} className="cat">
              <summary className="cat-grid">
                <div className="cat-name"><span className="twisty" aria-hidden="true" /><div><b>{r.label}</b><span className="fdic">{r.fdic}</span><div className="buy"><span className={`chip ${BUY[r.buys][0]}`}>{BUY[r.buys][1]}</span></div></div></div>
                <Cells r={r} />
              </summary>
              <Body r={r} scale={scale} />
            </details>
          ))}
        </div>
      ) : <p className="muted">No category breakdown in the record.</p>}
      <p className="small muted">A stage the FDIC does not report shows as &quot;Not reported&quot;, never as zero. Percentages are of each type&apos;s balance. <Term id="oreo">Foreclosed property</Term> is property the bank owns and is never added to the loans.</p>
    </section>
  );
}
