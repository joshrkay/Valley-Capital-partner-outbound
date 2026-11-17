// Outreach, was Accounts (docs/design-redesign.md, 5.5): the banks a principal chose to work, grouped by where they stand (name the person,
// research, draft, sent, in conversation), each with its one next step. A server component with no data of its own.
import { when } from '../../lib/format.mjs';
import { groupAccounts, OUTREACH_STAGES } from '../../lib/account-view.mjs';
import { PageHead, Priority, Term } from '../ui.jsx';

export default function OutreachView({ rows }) {
  const groups = groupAccounts(rows);
  return (
    <div className="page">
      <PageHead icon="people" tone="t-out" eyebrow="Outreach" title="Banks we are working" lede="Every bank a principal chose, from the bank list or by hand, grouped by where it stands, with the one thing to do next. Nothing here sends anything." actions={<a className="btn" href="/candidates">Find a bank to start</a>} />
      <div className="card pathcard">
        <div className="path-row">
          <ol className="path" aria-label="Accounts by stage">
            {OUTREACH_STAGES.map(([id, label]) => {
              const n = groups.find((g) => g.id === id).rows.length;
              return <li key={id} className={n ? 'cur' : ''}><span><a className="pathlink" href={`#stage-${id}`}>{label} ({n})</a></span></li>;
            })}
          </ol>
        </div>
      </div>
      {!rows.length ? <p className="muted">No accounts yet. Start outreach from a bank&apos;s page.</p> : groups.filter((g) => g.rows.length).map((g) => (
        <section key={g.id} id={`stage-${g.id}`} className="card" aria-labelledby={`h-${g.id}`}>
          <div className="card-head"><h2 id={`h-${g.id}`}>{g.label} ({g.rows.length})</h2></div>
          <ul className="rel-list acct-list">
            {g.rows.map((a) => (
              <li key={a.id}>
                <span className="one-line"><a className="bankname" href={`/accounts/${encodeURIComponent(a.id)}`}>{a.name ?? a.id}</a>{a.tier ? <Priority tier={a.tier} /> : null}</span>
                <span className="rel-m">
                  {a.person ? <>{a.person}, role {a.roleConfirmed ? 'confirmed' : 'not confirmed yet'}</> : 'No person named yet'}
                  {' · '}{a.researchedAt ? `researched ${when(a.researchedAt).slice(0, 10)}` : 'not researched'}
                  {' · '}{a.fromPipeline ? 'from the bank list' : 'added by hand'}
                </span>
                <span className={`next${a.next.stop ? ' stop' : ''}`}><strong>{a.next.stop ? 'Stop: ' : 'Next: '}</strong>{a.next.text.replace(/^Stop first: /, '')}</span>
                <span className="code">{a.id}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <p className="small muted">The stages are where each account stands in the records: a person named, research, a draft, a send recorded, a reply, meeting or handoff. See the <Term id="outreach-list">glossary</Term>.</p>
    </div>
  );
}
