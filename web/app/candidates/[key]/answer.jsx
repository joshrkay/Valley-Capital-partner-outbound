// The Overview tab: the short answer (one sentence from a template), then why now (the card's sentences without its first, signals marked
// with their dates) beside an eight-quarter chart of the seriously-late share when the record has that series. Server components.
import { answerSentence, whyLines, trendSeries } from '../../../lib/bank-view.mjs';
import { TrendChart } from '../../charts.jsx';
import { Term } from '../../ui.jsx';

export function Answer({ item, paper }) {
  const parts = answerSentence(item, paper);
  return (
    <section className="callout" aria-labelledby="h-answer">
      <h2 id="h-answer" className="eyebrow"><Term id="short-answer">The short answer</Term></h2>
      <p className="answer-text">{parts.map((p, i) => (p.b ? <strong key={i}>{p.t}</strong> : <span key={i}>{p.t}</span>))}</p>
    </section>
  );
}

export function WhyNow({ item, paper }) {
  const lines = whyLines(item);
  const trend = trendSeries(paper);
  const about = paper?.trend?.about?.seriouslyLateShare;
  const gaps = (trend ?? []).filter((p) => p.value === null);
  return (
    <div className={`why-grid${trend ? '' : ' solo'}`}>
      <section aria-labelledby="h-why">
        <h2 id="h-why" className="sec-h">Why now</h2>
        <p className="sec-intro small">What changed, and why it matters. Each line is built from the numbers by a fixed template, never by a model.</p>
        {lines.length ? (
          <ul className="why-list">
            {lines.map((l, i) => (
              <li key={i}>
                <span className={`dot${l.signal ? ' sig' : ''}`} aria-hidden="true" />
                <div>{l.text}{l.signal ? <div className="when"><strong>New signal</strong>{l.when ? ` · ${l.when}` : ''}</div> : null}</div>
              </li>
            ))}
          </ul>
        ) : <p className="muted">No card for this bank yet: the score&apos;s measures under Details are the record.</p>}
      </section>
      {trend ? (
        <div className="chartbox">
          <h3><Term id="serious">Seriously late</Term> loans</h3>
          <p className="sub">Share of the CRE book, last {trend.length} quarter{trend.length === 1 ? '' : 's'}</p>
          <TrendChart series={trend} label="Seriously late share of the CRE book" />
          {gaps.length ? <ul className="small muted">{gaps.map((g) => <li key={g.label}>{g.label}: no value. {g.reason}</li>)}</ul> : null}
          {about?.method ? <span className="code">{about.method}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
