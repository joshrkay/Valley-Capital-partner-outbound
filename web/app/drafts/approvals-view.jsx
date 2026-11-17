// Approvals (docs/design-redesign.md, 5.6): drafts waiting for a principal. Each finding of the linter and the guard as a plain sentence, the
// words it matched highlighted in the draft, blocked drafts last, and each rule's code on a hidden line ("Show rule codes"). Approving runs
// the same server action as before: it checks the draft again and never sends. There is no send button here by design.
import { findingText, matchedTerm, highlight, sortDrafts } from '../../lib/drafts-view.mjs';
import { PageHead, Note, Chip } from '../ui.jsx';
import { approveAction } from './actions.js';

const STATUS = { draft: ['', 'Waiting for approval'], blocked: ['stop', 'Blocked'] };

function Findings({ list, tone, title }) {
  if (!list.length) return null;
  return (
    <Note tone={tone} role={tone === 'bad' ? 'alert' : 'note'}>
      <div>
        <strong>{title}</strong>
        <ul>{list.map((f, i) => <li key={i}>{findingText(f)}<span className="code">{f.code}</span></li>)}</ul>
      </div>
    </Note>
  );
}

export default function ApprovalsView({ rows }) {
  const sorted = sortDrafts(rows);
  const waiting = rows.filter((d) => d.status === 'draft').length;
  return (
    <div className="page">
      <PageHead icon="approve" tone="t-appr" eyebrow="Approvals" title={`Drafts waiting (${waiting})`} lede="Approving checks a draft again against every rule; it does not send. A principal sends an approved draft from their own mailbox, then records the send on the account." />
      {!rows.length ? <p className="muted">Nothing waiting.</p> : (
        <>
          <label className="check codes-toggle" htmlFor="codes"><input type="checkbox" id="codes" /> Show rule codes</label>
          {sorted.map((d) => {
            const terms = [...d.errors, ...d.warnings].map(matchedTerm).filter(Boolean);
            const [cls, label] = STATUS[d.status] ?? ['', d.status];
            return (
              <article key={`${d.account}-${d.step}-${d.channel}`} className="card draft">
                <div className="card-head">
                  <h2><a href={`/accounts/${encodeURIComponent(d.account)}`}>{d.accountName}</a></h2>
                  <span className="muted">step {d.step}, {d.channel.replace(/_/g, ' ')}{d.person ? ` to ${d.person}` : ''}</span>
                  <span className="card-head-r"><Chip kind={cls}>{label}</Chip></span>
                </div>
                <div className="card-body">
                  {d.subject ? <p><strong>Subject:</strong> {highlight(d.subject, terms).map((p, i) => (p.mark ? <mark key={i}>{p.t}</mark> : <span key={i}>{p.t}</span>))}</p> : null}
                  <pre className="text">{highlight(d.text, terms).map((p, i) => (p.mark ? <mark key={i}>{p.t}</mark> : <span key={i}>{p.t}</span>))}</pre>
                  <div className="page">
                    <Findings list={d.errors} tone="bad" title="Fix before approving:" />
                    <Findings list={d.warnings} tone="warn" title="Worth a second look:" />
                  </div>
                </div>
                {d.status === 'draft' ? (
                  <div className="card-foot left">
                    <form action={approveAction} className="inline">
                      <input type="hidden" name="id" value={d.account} /><input type="hidden" name="channel" value={d.channel} /><input type="hidden" name="step" value={d.step} />
                      <button type="submit" className="btn primary">Approve</button>
                    </form>
                    <span className="small muted">Checks it again. Nothing is sent.</span>
                  </div>
                ) : null}
              </article>
            );
          })}
        </>
      )}
    </div>
  );
}
