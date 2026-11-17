// The sender settings: who a message goes out under (senders.json). Whether sending is ready comes first, with the one thing to fix, by the
// rule `outbound status` uses (src/senders.mjs): at least one sender, every one complete, sending not paused. Then each sender with its
// check and its form, and a form to add one. A sender a recorded touch names cannot be removed. Nothing here sends anything.
import { requirePrincipal } from '../../lib/session.mjs';
import { sendersOverview } from '../../lib/senders-ops.mjs';
import { NotAuthorized, Problem, PageHead, Chip, Disclosure } from '../ui.jsx';
import { Icon } from '../icons.jsx';
import { addSenderAction, editSenderAction, removeSenderAction } from './actions.js';

export const metadata = { title: 'Senders · Valley Capital outbound' };

const FIELDS = [
  ['name', 'Name', 'text'],
  ['title', 'Title', 'text'],
  ['phone', 'Phone', 'tel'],
  ['address', 'Street address: a number and a street or a registered box, then city, state and ZIP', 'text'],
  ['mailbox', 'Work email you send from (a person\'s business address)', 'email'],
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
    <div className="page">
      <PageHead icon="doc" tone="t-set" eyebrow="Setup and checks" title="Senders" lede="Who a message goes out under. The drafter signs with these details, and the guard refuses a touch from a sender missing any of them. Principals send from their own mailboxes; nothing here sends anything." />

      <section className={`card statusline ${r.ready ? 'good' : 'bad'}`} role="status" aria-labelledby="h-ready">
        <h2 id="h-ready" className={r.ready ? 'ok-line' : 'bad-line'}><Icon name={r.ready ? 'check' : 'warn'} /> Ready to send: {r.ready ? 'yes' : 'no'}.</h2>
        {r.ready ? <p className="muted">Every sender is complete and sending is not paused.</p> : r.reasons.length ? <p><strong>Fix first:</strong> {r.reasons[0]}</p> : null}
        {r.reasons.length > 1 ? <ul className="small">{r.reasons.slice(1).map((x, i) => <li key={i}>{x}</li>)}</ul> : null}
      </section>

      <section className="sec" aria-labelledby="h-senders">
        <h2 id="h-senders">Senders ({o.senders.length})</h2>
        {o.senders.length ? o.senders.map((s) => (
          <div className="panel" key={s.id}>
            <h3>{s.name || s.id} <Chip kind={s.ok ? 'done' : 'new'}>{s.ok ? 'Complete' : 'Incomplete'}</Chip> <span className="code">{s.id}</span></h3>
            {s.ok ? null : <div className="banner warn small"><ul>{s.errors.map((e, i) => <li key={i}>{e.message}</li>)}</ul></div>}
            <form action={editSenderAction} className="row">
              <input type="hidden" name="id" value={s.id} />
              <Fields s={s} />
              <button type="submit">Save</button>
            </form>
            <form action={removeSenderAction} className="inline">
              <input type="hidden" name="id" value={s.id} />
              <button className="danger" type="submit">Remove</button>
              <span className="small muted"> Only a sender no recorded touch names. One that has sent stays, so the touch log and the limits keep their meaning.</span>
            </form>
          </div>
        )) : <p className="muted small">None yet.</p>}
      </section>

      <section className="sec" aria-labelledby="h-add">
        <h2 id="h-add">Add a sender</h2>
        <form action={addSenderAction} className="panel row">
          <label>Short id, lowercase (for example pat)<input name="id" required pattern="[a-z0-9][a-z0-9_\-]{0,63}" maxLength={64} /></label>
          <Fields s={null} />
          <button type="submit">Add sender</button>
        </form>
      </section>

      <div className="card more">
        <Disclosure title="The rule behind Ready to send" desc="For checking against the command line">
          <p className="small">The same rule as <code>outbound status</code>: at least one sender; every field the guard requires filled, with no <code>[CONFIRM]</code> placeholder left in; a business mailbox; a street address, as the CAN-SPAM Act requires in every commercial email; and sending not paused, by the setting in config.json, the KILL document, or the <code>OUTBOUND_KILL</code> environment variable.</p>
        </Disclosure>
      </div>
    </div>
  );
}
