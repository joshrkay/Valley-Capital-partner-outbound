// The sender settings: who a message goes out under (senders.json). Each sender with its check, a form to add one and to edit each, and
// whether sending is ready, by the rule `outbound status` uses (src/senders.mjs): at least one sender, every one complete, the kill switch
// off. A sender a recorded touch names cannot be removed. Nothing here sends anything.
import { requirePrincipal } from '../../lib/session.mjs';
import { sendersOverview } from '../../lib/senders-ops.mjs';
import { NotAuthorized, Problem } from '../ui.jsx';
import { addSenderAction, editSenderAction, removeSenderAction } from './actions.js';

export const metadata = { title: 'Senders · Valley Capital outbound' };

const FIELDS = [
  ['name', 'Name', 'text'],
  ['title', 'Title', 'text'],
  ['phone', 'Phone', 'tel'],
  ['address', 'Street address (CAN-SPAM: a number and a street or registered box, city, state, ZIP)', 'text'],
  ['mailbox', 'Mailbox you send from (a business address for a person)', 'email'],
];

function Fields({ s }) {
  return FIELDS.map(([k, label, type]) => <label key={k}>{label}<input name={k} type={type} required maxLength={200} defaultValue={s?.[k] ?? ''} /></label>);
}

export default async function Senders() {
  const ctx = await requirePrincipal();
  if (ctx.denied) return <NotAuthorized email={ctx.email} />;
  let o;
  try { o = await sendersOverview(ctx.client); } catch (e) { return <Problem text={`The senders could not be loaded: ${e.message}`} />; }
  const r = o.readiness;
  return (
    <>
      <h1>Senders</h1>
      <p className="sub">Who a message goes out under. The drafter signs with these details, and the guard refuses a touch from a sender missing any of them. Principals send from their own mailboxes; nothing here sends anything.</p>

      <div className={`banner ${r.ready ? 'ok' : 'error'}`} role="status">
        <strong>Ready to send: {r.ready ? 'yes' : 'no'}.</strong>{r.ready ? ' Every sender is complete and the kill switch is off.' : null}
        {r.reasons.length ? <ul className="small">{r.reasons.map((x, i) => <li key={i}>{x}</li>)}</ul> : null}
      </div>
      <p className="small muted">The same rule as <code>outbound status</code>: at least one sender, every field the guard requires filled with no [CONFIRM] placeholder, a business mailbox, a street address, and the kill switch off (config, the KILL document, or OUTBOUND_KILL).</p>

      <h2>Senders ({o.senders.length})</h2>
      {o.senders.length ? o.senders.map((s) => (
        <div className="panel" key={s.id}>
          <h3 style={{ marginTop: 0 }}><span className="mono">{s.id}</span> {s.ok ? <span className="pill">complete</span> : <span className="pill">incomplete</span>}</h3>
          {s.ok ? null : <div className="banner warn small"><ul>{s.errors.map((e, i) => <li key={i}>{e.message}</li>)}</ul></div>}
          <form action={editSenderAction} className="row">
            <input type="hidden" name="id" value={s.id} />
            <Fields s={s} />
            <button type="submit">Save</button>
          </form>
          <form action={removeSenderAction} className="inline">
            <input type="hidden" name="id" value={s.id} />
            <button className="danger" type="submit">Remove</button>
            <span className="small muted"> Only a sender no recorded touch names. One that has sent stays, so the touch log and the caps keep their meaning.</span>
          </form>
        </div>
      )) : <p className="muted small">None yet.</p>}

      <h2>Add a sender</h2>
      <form action={addSenderAction} className="panel row">
        <label>Id (lowercase, for example pat)<input name="id" required pattern="[a-z0-9][a-z0-9_\-]{0,63}" maxLength={64} /></label>
        <Fields s={null} />
        <button type="submit">Add sender</button>
      </form>
    </>
  );
}
