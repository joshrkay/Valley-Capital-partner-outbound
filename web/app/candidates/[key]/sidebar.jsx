// The record page's sidebar of related lists (docs/design-redesign.md, 4.1): Score, Signals, Where it lends, Loan sales and filings.
// Server components; each shows stored figures and links into the tab that has the detail.
import { period } from '../../../lib/format.mjs';
import { scoreParts, soldItems } from '../../../lib/bank-view.mjs';
import { Tile } from '../../icons.jsx';
import { Term } from '../../ui.jsx';
import { Where } from './where.jsx';

export function ScoreCard({ item, scoring, href }) {
  const { axes, rule } = scoreParts(item, scoring);
  return (
    <section className="card side-card" aria-labelledby="h-score">
      <div className="card-head"><Tile icon="gauge" tone="t-score" size="sm" /><h2 id="h-score"><Term id="score">Score</Term></h2><span className="card-head-r"><b className="tnum">{Math.round(Number(item.score ?? 0))}</b> of 100</span></div>
      <div className="card-body">
        {axes.map((a) => (
          <div key={a.id} className="axis">
            <div className="row1"><b><Term id={a.id === 'distress' ? 'pressure' : a.id}>{a.label}</Term></b><span className="tnum">{a.points.toFixed(1)} of {a.max}</span></div>
            <div className="q">{a.q}</div>
            <div className="bar" aria-hidden="true"><span className={a.cls} style={{ width: `${a.max ? Math.min(100, (a.points / a.max) * 100).toFixed(0) : 0}%` }} /></div>
          </div>
        ))}
        <p className="rule">{rule}</p>
      </div>
      <div className="card-foot"><a href={`${href}?tab=details#score`}>How the score was built</a></div>
    </section>
  );
}

export function SignalsCard({ item, href }) {
  const signals = item.signals ?? [];
  return (
    <section className="card side-card" aria-labelledby="h-sig">
      <div className="card-head"><Tile icon="bolt" tone="t-sig" size="sm" /><h2 id="h-sig">Signals ({signals.length})</h2></div>
      {signals.length ? (
        <ul className="rel-list">{signals.map((s) => <li key={s.id}><span>{s.label}</span><span className="rel-m">{s.period ? `Quarter ending ${period(s.period)}` : s.date ?? s.fileDate ?? ''}</span></li>)}</ul>
      ) : <p className="card-body muted">No signal fired in the latest quarter.</p>}
      <div className="card-foot"><a href={`${href}?tab=overview`}>Why now</a></div>
    </section>
  );
}

export function SalesCard({ paper, route }) {
  const items = soldItems(paper);
  const advisors = route?.advisors ?? [];
  return (
    <section className="card side-card" aria-labelledby="h-sales">
      <div className="card-head"><Tile icon="dollar" tone="t-sale" size="sm" /><h2 id="h-sales">Loan sales and filings ({items.length + advisors.length})</h2></div>
      {items.length || advisors.length ? (
        <ul className="rel-list">
          {advisors.map((a) => <li key={a.key}><span>Sold through <a href={`/intermediaries/${encodeURIComponent(a.key)}`}>{a.name}</a></span><span className="rel-m">Last {a.last}{a.notRegistered ? ' · we are not on its buyer list' : ' · we are on its buyer list'}</span></li>)}
          {(route?.direct ?? []).map((d, i) => <li key={`d-${i}`}><span>A direct sale on record</span><span className="rel-m">{d.date}</span></li>)}
          {items.map((s, i) => <li key={i}><span>{s.label}</span><span className="rel-m">{[s.date, s.basis].filter(Boolean).join(' · ')}</span></li>)}
        </ul>
      ) : <p className="card-body muted">No held-for-sale loans, loan sales, filings or acquisitions on record.</p>}
    </section>
  );
}

export function Sidebar({ item, paper, route, scoring, href }) {
  return (
    <aside className="rec-side" aria-label="Related">
      <ScoreCard item={item} scoring={scoring} href={href} />
      <SignalsCard item={item} href={href} />
      <Where item={item} paper={paper} />
      <SalesCard paper={paper} route={route} />
    </aside>
  );
}
