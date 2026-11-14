// The account page's calls section (PRD E15): the latest call brief and its check result, a form for the notes after a call, the
// pending proposals with confirm and reject, the confirmed outcomes, and the follow-up checklist. A brief that failed a check is shown
// as NOT USABLE above everything else in it. There is no send button: the follow-up is the principal's own message.
import { accountCalls } from '../../../lib/ops.mjs';
import { Markdown, Problem } from '../../ui.jsx';
import { queueCallPrepAction, logCallAction, confirmCallAction, rejectCallAction } from '../actions.js';

const today = () => new Date().toISOString().slice(0, 10);
const WHO = { us: 'We', them: 'They', both: 'Both', unclear: 'Unclear who' };

function Proposal({ p, id }) {
  return (
    <div className="panel">
      <h3 style={{ marginTop: 0 }}>Proposed outcome for the call of {p.date} <span className="pill">pending</span></h3>
      <p className="small muted">Read from the notes by a model. Nothing is recorded until a principal confirms it.</p>
      <dl className="kv small">
        <dt>Outcomes</dt><dd>{p.outcomes.length ? p.outcomes.map((o) => (
          <div key={o.code}><strong>{o.code}</strong>{o.when ? ` (when: ${o.when})` : ''}{o.referral ? ` (referral: ${o.referral})` : ''} <span className="muted">“{o.quote}”</span>{o.quoteFound ? null : <strong> not found in the notes</strong>}</div>
        )) : 'none'}</dd>
        <dt>Objections</dt><dd>{p.objections.length ? p.objections.map((o, i) => <div key={i}>{o.text}</div>) : 'none'}</dd>
        <dt>Commitments</dt><dd>{p.commitments.length ? p.commitments.map((c, i) => <div key={i}>{WHO[c.who] ?? c.who}: {c.what}{c.by ? ` (${c.byDate ? 'by ' : ''}${c.by})` : ''}</div>) : 'none'}</dd>
        <dt>Follow-up</dt><dd>{p.followUpDate || 'none'}</dd>
        <dt>People</dt><dd>{p.people.length ? p.people.map((x, i) => <div key={i}>{x.name}{x.title ? `, ${x.title}` : ''} <span className="muted">({x.status}; add one only through “Set person”, then confirm the role)</span></div>) : 'none'}</dd>
      </dl>
      {p.problems.length ? <div className="banner warn small"><strong>Check before confirming:</strong><ul>{p.problems.map((x, i) => <li key={i}>{x}</li>)}</ul></div> : null}
      <form action={confirmCallAction} className="inline">
        <input type="hidden" name="id" value={id} /><input type="hidden" name="proposal" value={p.id} />
        <button type="submit">Confirm and record</button>
      </form>
      <form action={rejectCallAction} className="inline">
        <input type="hidden" name="id" value={id} /><input type="hidden" name="proposal" value={p.id} />
        <label>Reason<input name="reason" /></label>
        <button className="danger" type="submit">Reject</button>
      </form>
    </div>
  );
}

export async function Calls({ client, id }) {
  let c;
  try { c = await accountCalls(client, id); } catch (e) { return <Problem text={`The calls could not be loaded: ${e.message}`} />; }
  const b = c.latestBrief;
  return (
    <>
      <h2>Calls</h2>
      <div className="grid2">
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Before the call</h3>
          <p className="small">A one-page brief from the account, the research, the signals, the paper estimate if there is one, the touch history and the approved claims. Code checks every citation, number and claim.</p>
          <form action={queueCallPrepAction} className="row">
            <input type="hidden" name="id" value={id} />
            <label>Call date<input type="date" name="date" defaultValue={today()} required /></label>
            <button className="secondary" type="submit">{b ? 'Prepare again' : 'Prepare a call brief'}</button>
          </form>
          {!b ? <p className="muted small">No call brief yet.</p> : b.usable
            ? <div className="banner ok small">Call brief for {b.date}: every check passed.</div>
            : <div className="banner error small" role="alert"><strong>NOT USABLE.</strong> The call brief for {b.date} failed the code checks. Do not rely on it.<ul>{b.problems.map((e, i) => <li key={i}>{e.code}: {e.message}</li>)}</ul></div>}
        </div>
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>After the call</h3>
          <form action={logCallAction}>
            <input type="hidden" name="id" value={id} />
            <label>Call date<input type="date" name="date" defaultValue={today()} max={today()} required /></label>
            <label style={{ marginTop: 8 }}>Your notes<textarea name="notes" required maxLength={50000} rows={8} /></label>
            <p style={{ marginTop: 8 }}><button type="submit">Save notes and propose an outcome</button></p>
          </form>
          <p className="small muted">The notes stay in the private data store, for principals only. A model proposes what to record. Nothing is recorded until a principal confirms it.</p>
        </div>
      </div>

      {c.pending.map((p) => <Proposal key={p.id} p={p} id={id} />)}

      <h3>Confirmed outcomes</h3>
      {c.outcomes.length ? (
        <div className="scroll"><table>
          <thead><tr><th>Call</th><th>Outcomes</th><th>Commitments</th><th>Follow-up</th><th>Confirmed by</th></tr></thead>
          <tbody>{[...c.outcomes].reverse().map((o) => (
            <tr key={o.id}><td>{o.date}</td><td>{o.codes.join(', ')}</td><td className="small">{(o.commitments ?? []).map((x, i) => <div key={i}>{WHO[x.who] ?? x.who}: {x.what}</div>)}</td><td>{o.followUpDate ?? '–'}</td><td>{o.confirmedBy}</td></tr>
          ))}</tbody>
        </table></div>
      ) : <p className="muted small">None yet.</p>}

      {c.latestFollowUp?.md ? <><h3>Follow-up checklist ({c.latestFollowUp.date})</h3><div className="panel"><Markdown text={c.latestFollowUp.md} /></div></> : null}
      {b?.md ? <><h3>Call brief ({b.date}){b.usable ? '' : ': NOT USABLE'}</h3><div className="panel"><Markdown text={b.md} /></div></> : null}
    </>
  );
}
