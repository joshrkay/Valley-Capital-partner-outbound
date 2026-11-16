// The call desk: a principal dials and leaves any voicemail themselves, reading from this page. It shows the approved call sheet for the
// next step, and only while the guard allows that call now. It makes, plays and records no audio, writes nothing and sends nothing: the
// outcome is recorded afterwards, by hand, on the account page (the touches and calls sections).
import { requirePrincipal } from '../../../../lib/session.mjs';
import { callDesk } from '../../../../lib/calldesk-ops.mjs';
import { readTime, telHref, TARGET_SECONDS, LONG_SECONDS } from '../../../../lib/calldesk-view.mjs';
import { NotAuthorized, Problem } from '../../../ui.jsx';
import { Prompter, Stopwatch } from './prompter.jsx';

export const metadata = { title: 'Call desk · Valley Capital outbound' };

const channel = (c) => String(c ?? '').replace(/_/g, ' ');

function Head({ d }) {
  const p = d.person;
  const href = d.state === 'ready' ? telHref(p.phone) : null;
  return (
    <>
      <h1>Call desk: {d.account.name}</h1>
      <p className="sub">
        {p.name || 'No person named'}{p.title ? `, ${p.title}` : ''}
        {p.phone ? <> · {href ? <a href={href}>{p.phone}</a> : p.phone}{p.phoneType ? ` (${p.phoneType})` : ''}</> : null}
        {d.localTime ? <> · their time now: {d.localTime}</> : null}
        {' '}· calls go out on weekdays, {d.hours[0]}:00 to {d.hours[1]}:00 their time
      </p>
    </>
  );
}

function Waiting({ d, id }) {
  const back = <p><a href={`/accounts/${encodeURIComponent(id)}`}>Back to the account</a></p>;
  if (d.state === 'sequence_complete') return <><div className="banner ok">The sequence is complete. There is no further call for this account.</div>{back}</>;
  if (d.state === 'not_a_call_step') return <><div className="banner warn">The next step is step {d.expected.step}, a {channel(d.expected.channel)}, not a call. The call desk opens when the next step is a call.</div>{back}</>;
  if (d.state === 'no_draft') return <><div className="banner warn">There is no call sheet for step {d.step} yet. Queue a call draft from the account page. A principal approves it before it appears here.</div>{back}</>;
  if (d.state === 'not_approved') return <><div className="banner warn">The call sheet for step {d.step} is <strong>{d.draftStatus}</strong>, not approved. A principal approves it on the <a href="/drafts">Approvals</a> page first.</div>{back}</>;
  return (
    <>
      <div className="banner error" role="alert">
        <strong>Do not call. The guard refuses this call now, so the call sheet is hidden.</strong>
        <ul>{d.errors.map((e) => <li key={e.code}>{e.code}: {e.message}</li>)}</ul>
        <span className="small">Come back when the reason no longer holds. Nothing on this page changes the guard.</span>
      </div>
      {back}
    </>
  );
}

function Sheet({ d }) {
  const s = d.sheet;
  const t = readTime(s.voicemail);
  return (
    <>
      {d.warnings.length ? <div className="banner warn small"><ul>{d.warnings.map((w) => <li key={w.code}>{w.code}: {w.message}</li>)}</ul></div> : null}
      <div className="banner ok small">The guard allows this call now. The sheet was approved by {d.approvedBy || 'a principal'}{d.approvedAt ? ` on ${d.approvedAt.slice(0, 10)}` : ''}.</div>

      <div className="grid2">
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>If you get voicemail</h3>
          <p className="small muted">About {t.seconds} seconds at a placeholder pace ({t.words} words). The target is {TARGET_SECONDS}. {t.verdict === 'too_long' ? `Over ${LONG_SECONDS}: shorten it before you leave it.` : t.verdict === 'long' ? 'A little long.' : ''}</p>
          <Prompter>
            {s.voicemail ? <p style={{ margin: 0 }}>{s.voicemail}</p> : <p className="muted" style={{ margin: 0 }}>This sheet has no voicemail script.</p>}
          </Prompter>
          <p className="small">Say your name and number clearly: <strong>{d.sender.name}{d.sender.title ? `, ${d.sender.title}` : ''}</strong>, <strong className="mono">{d.sender.phone}</strong>. This number comes from the sender settings, not from the draft.</p>
          <Stopwatch target={TARGET_SECONDS} limit={LONG_SECONDS} />
        </div>
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>If they answer</h3>
          <p className="small muted">The first ten seconds.</p>
          <Prompter>{s.openingLine ? <p style={{ margin: 0 }}>{s.openingLine}</p> : <p className="muted" style={{ margin: 0 }}>No opening line.</p>}</Prompter>
        </div>
      </div>

      <details className="panel">
        <summary><strong>Why now, talking points, questions and objections</strong></summary>
        {s.whyNow ? <p><strong>Why now:</strong> {s.whyNow}</p> : null}
        {s.talkingPoints.length ? <><h3>Talking points</h3><ul>{s.talkingPoints.map((x, i) => <li key={i}>{x}</li>)}</ul></> : null}
        {s.questions.length ? <><h3>Ask</h3><ul>{s.questions.map((x, i) => <li key={i}>{x}</li>)}</ul></> : null}
        {s.objections.length ? <><h3>Likely objections</h3><ul>{s.objections.map((x, i) => <li key={i}><em>{x.objection}</em> → {x.response}</li>)}</ul></> : null}
        {s.timingNote ? <p className="small"><strong>Timing:</strong> {s.timingNote}</p> : null}
      </details>
    </>
  );
}

export default async function CallDesk({ params }) {
  const ctx = await requirePrincipal();
  if (ctx.denied) return <NotAuthorized email={ctx.email} />;
  const { id: raw } = await params;
  const id = decodeURIComponent(raw);
  let d;
  try { d = await callDesk(ctx.client, id); } catch (e) { return <Problem text={`The call desk could not be loaded: ${e.message}`} />; }
  if (!d) return <Problem text={`There is no account ${id}.`} />;
  return (
    <>
      <Head d={d} />
      {d.state === 'ready' ? <Sheet d={d} /> : <Waiting d={d} id={id} />}

      <div className="panel small">
        <strong>After the call</strong>, record what happened on the account page: a voicemail you left is a send on the <em>call</em> channel (<a href={`/accounts/${encodeURIComponent(id)}#touches`}>Outreach</a>); a reply, meeting or opt-out is an event there too; and your notes go in <a href={`/accounts/${encodeURIComponent(id)}#calls`}>Calls</a>.
        <br />This page plays and records no audio, and nothing here is saved. You dial and you speak.
      </div>
    </>
  );
}
