// The account page's touches panel: working without Gmail. A principal approves a draft, sends it from their own mailbox, then records the
// send here, and records a reply, opt-out, bounce, meeting or handoff. The guard's touch log drives the caps, the follow-up timing and the
// opt-out stops, so it must match what happened. Every action runs the guard's own function as the signed-in principal
// (web/lib/touches-ops.mjs). Nothing here sends anything, and no message text is stored.
import { cookies } from 'next/headers';
import { accountTouches } from '../../../lib/touches-ops.mjs';
import { Problem } from '../../ui.jsx';
import { checkSendAction, recordSendAction, recordEventAction, recordOptOutAction } from './touches-actions.js';

const LABEL = { touch: 'Send', reply: 'Reply', opt_out: 'Opt-out', bounce: 'Bounce', meeting: 'Meeting', handoff: 'Handoff' };
const channel = (c) => String(c ?? '').replace(/_/g, ' ');

// The principal's last "Check with the guard" (channel, date, time, sender id), kept in a short-lived cookie by checkSendAction.
async function lastCheck() {
  try { const raw = (await cookies()).get('send-check')?.value; return raw ? JSON.parse(raw) : null; } catch { return null; }
}

function Due({ due, next }) {
  if (!due) return null;
  if (due.state === 'sequence_complete') return <div className="banner ok small">The sequence is complete. No further step: the account moves to quarterly nurture.</div>;
  if (due.state === 'due') return <div className="banner ok small">Step {due.step} ({channel(due.channel)}) is due now.</div>;
  return (
    <div className="banner warn small">
      Step {due.step ?? next?.step} ({channel(due.channel ?? next?.channel)}) is not allowed today{due.due ? `; it is due ${due.due}` : ''}. The guard says: {due.blockedBy.join(', ')}.
    </div>
  );
}

function History({ rows }) {
  if (!rows.length) return <p className="muted small">Nothing recorded yet.</p>;
  return (
    <div className="scroll"><table>
      <thead><tr><th>Date</th><th>What</th><th>Step</th><th>Channel</th><th>Sender</th><th>Recorded by</th><th>Note, or rules it broke</th></tr></thead>
      <tbody>{rows.map((h, i) => (
        <tr key={i}>
          <td className="mono">{h.date}</td>
          <td>{LABEL[h.type] ?? h.type}</td>
          <td>{h.step ?? '–'}</td>
          <td>{h.channel ? channel(h.channel) : '–'}</td>
          <td className="mono">{h.sender ?? '–'}</td>
          <td>{h.by ?? <span className="muted">–</span>}</td>
          <td className="small">{h.violations.length ? h.violations.map((v) => <span key={v} className="pill">{v}</span>) : null}{h.note ? <span className="muted">{h.note}</span> : null}{h.ref ? <span className="src">{h.ref}</span> : null}</td>
        </tr>
      ))}</tbody>
    </table></div>
  );
}

function Verdict({ t }) {
  const p = t.proposal;
  const what = `step ${p.step}, ${channel(p.channel)}, ${p.date}${p.time ? ` ${p.time}` : ''}, from ${p.sender}`;
  const head = p.checked ? `The guard's verdict for ${what}` : `The guard's verdict for the next step today (${what}). Choose and check another above`;
  if (t.verdict.allowed) return <div className="banner ok small">{head}: nothing wrong.</div>;
  return (
    <div className="banner error small" role="alert">
      <strong>{head}: it breaks {t.verdict.errors.length} rule{t.verdict.errors.length === 1 ? '' : 's'}.</strong>
      <ul>{t.verdict.errors.map((e) => <li key={e.code}>{e.code}: {e.message}</li>)}</ul>
      If the send already went out, record it all the same: the log must match what happened.
    </div>
  );
}

export async function Touches({ client, id }) {
  let t;
  try { t = await accountTouches(client, id, { check: await lastCheck() }); } catch (e) { return <Problem text={`The touch history could not be loaded: ${e.message}`} />; }
  if (!t) return null;
  const p = t.proposal;
  const named = [t.optOut.name, t.optOut.email].filter(Boolean);
  return (
    <>
      <h2 id="touches">Outreach: what happened</h2>
      <p className="small muted">Working without Gmail: approve a draft, send it from your own mailbox, then record the send here. Record a reply, opt-out, bounce, meeting or handoff the same way, the day it happens. The guard counts its caps, follow-up timing and opt-out stops from this log. No message text is stored.</p>

      <div className="grid2">
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Where the sequence stands</h3>
          <p className="small">{t.sent} send{t.sent === 1 ? '' : 's'} recorded.{t.next ? ` Next in the sequence: step ${t.next.step}, ${channel(t.next.channel)}.` : ''}</p>
          <Due due={t.due} next={t.next} />
          <h4>History, newest first</h4>
          <History rows={t.history} />
        </div>

        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Record a send</h3>
          {t.senders.length ? (
            <>
              <p className="small">After you have sent it. This records step {p.step}: one more than the sends already recorded, as the command line counts it. Check first: the guard's verdict for exactly that send shows below.</p>
              <form action={checkSendAction} className="row">
                <input type="hidden" name="id" value={id} />
                <label>Channel<select name="channel" defaultValue={p.channel}>{t.channels.map((c) => <option key={c} value={c}>{channel(c)}</option>)}</select></label>
                <label>Date sent<input type="date" name="date" defaultValue={p.date} max={t.today} required /></label>
                <label>Time, for a call ({t.timezone || 'no time zone on the account'})<input type="time" name="time" defaultValue={p.time} /></label>
                <label>Sender<select name="sender" defaultValue={p.sender}>{t.senders.map((s) => <option key={s.id} value={s.id}>{s.id}{s.name ? ` (${s.name})` : ''}{s.ok ? '' : ', incomplete'}</option>)}</select></label>
                <button className="secondary" type="submit">Check with the guard</button>
              </form>
              {t.checkProblem ? <div className="banner warn small">Your last check was not used: {t.checkProblem}</div> : null}
              <Verdict t={t} />
              <form action={recordSendAction} className="inline">
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="channel" value={p.channel} />
                <input type="hidden" name="date" value={p.date} />
                <input type="hidden" name="time" value={p.time} />
                <input type="hidden" name="sender" value={p.sender} />
                <input type="hidden" name="step" value={String(p.step)} />
                <button type="submit">Record this send: step {p.step}, {channel(p.channel)}, {p.date}</button>
              </form>
              <p className="small muted">The send already happened, so it is recorded whatever the verdict. Any rule it broke is kept on the record and shown to you. The guard still checks every later touch in full.</p>
            </>
          ) : <div className="banner warn small">No sender yet. Add one on the <a href="/senders">Senders page</a>, then record the send.</div>}
        </div>
      </div>

      <div className="grid2">
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Record a reply, bounce, meeting or handoff</h3>
          <p className="small">A reply, a meeting or a handoff ends the sequence for everyone at this bank: a principal takes it from there. A bounce stops email to this account.</p>
          <form action={recordEventAction} className="row">
            <input type="hidden" name="id" value={id} />
            <label>What happened<select name="type" defaultValue="reply">{t.eventTypes.map((x) => <option key={x} value={x}>{LABEL[x] ?? x}</option>)}</select></label>
            <label>Date<input type="date" name="date" defaultValue={t.today} max={t.today} required /></label>
            <label>Short internal note (optional: never the reply's text, no personal data)<input name="note" maxLength={200} /></label>
            <button type="submit">Record</button>
          </form>
        </div>

        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Record an opt-out</h3>
          <div className="banner warn small">
            An opt-out suppresses the person and their address at once.{' '}
            {named.length ? <>From now on they are on the suppression list and never contacted again: <strong>{named.join(', ')}</strong>.</> : 'No person or address is on the account yet, so the log alone records it.'}{' '}
            Outreach to everyone at {t.account.name} stops for good. It cannot be undone here.
          </div>
          <form action={recordOptOutAction}>
            <input type="hidden" name="id" value={id} />
            <label>Date<input type="date" name="date" defaultValue={t.today} max={t.today} required /></label>
            <label style={{ marginTop: 8 }}>Short internal note (optional: never the reply's text, no personal data)<input name="note" maxLength={200} /></label>
            <label style={{ marginTop: 8 }}><input type="checkbox" name="confirm" value="yes" required /> They asked not to be contacted. I understand this suppresses the person and the address at once.</label>
            <p style={{ marginTop: 8 }}><button className="danger" type="submit">Record the opt-out</button></p>
          </form>
        </div>
      </div>
    </>
  );
}
