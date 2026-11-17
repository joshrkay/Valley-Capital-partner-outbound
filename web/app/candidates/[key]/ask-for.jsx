// The last section of a bank page: what public reports cannot tell us (Q8's unknowns) and what to ask for once a confidentiality
// agreement is signed, the loan tape. A server component.
import { Term } from '../../ui.jsx';

export function AskFor({ paper }) {
  const q8 = paper?.q8;
  return (
    <section aria-labelledby="h-ask" className="page">
      <div>
        <h2 id="h-ask" className="sec-h">What to ask for</h2>
        <p className="sec-intro small">The gaps in public data, and what to request once a confidentiality agreement is signed.</p>
      </div>
      <div className="ask-grid">
        <div className="card">
          <h3><Term id="unknowns">What public reports cannot tell us</Term></h3>
          {q8?.unknowns?.length ? <ul>{q8.unknowns.map((u) => <li key={u.id}>{u.text}</li>)}</ul> : <p className="muted">The record lists no gaps yet; the next scoring run writes them.</p>}
        </div>
        <div className="card">
          <h3>Ask for, after an NDA: <Term id="tape">the loan tape</Term></h3>
          {q8?.tapeRequest?.items?.length ? <ul>{q8.tapeRequest.items.map((t) => <li key={t}>{t}</li>)}</ul> : <p className="muted">The request list comes with the paper estimate.</p>}
          {q8?.tapeRequest?.when ? <p className="small muted">{q8.tapeRequest.when}</p> : null}
        </div>
      </div>
    </section>
  );
}
