import { requirePrincipal } from '../../../lib/session.mjs';
import { accountDetail } from '../../../lib/ops.mjs';
import { loadRules } from '../../../lib/engine.mjs';
import { period, num } from '../../../lib/format.mjs';
import { NotAuthorized, Problem, Markdown } from '../../ui.jsx';
import { setPersonAction, confirmRoleAction, queueResearchAction, queueDraftAction } from '../actions.js';

export default async function Account({ params }) {
  const ctx = await requirePrincipal();
  if (ctx.denied) return <NotAuthorized email={ctx.email} />;
  const { id: raw } = await params;
  const id = decodeURIComponent(raw);
  let d, rules;
  try { [d, rules] = await Promise.all([accountDetail(ctx.client, id), loadRules()]); } catch (e) { return <Problem text={`This account could not be loaded: ${e.message}`} />; }
  if (!d) return <Problem text={`There is no account ${id}.`} />;
  const { account: a, brief, research, gate, drafts } = d;
  const pipe = a.pipeline;
  return (
    <>
      <h1>{a.name ?? a.id}</h1>
      <p className="sub">{a.id} · {a.type} · tier {a.tier ?? '–'} · sectors {(a.sectors ?? []).join(', ') || '–'}</p>

      <div className="grid2">
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>The person</h3>
          <dl className="kv">
            <dt>Name</dt><dd>{a.person?.name || <span className="muted">not named yet</span>}</dd>
            <dt>Title</dt><dd>{a.person?.title || '–'}</dd>
            <dt>Role</dt><dd>{a.contact?.roleConfirmed ? `confirmed by ${a.contact.roleConfirmedBy}` : 'unconfirmed'}</dd>
          </dl>
          <form action={setPersonAction} className="row" style={{ marginTop: 10 }}>
            <input type="hidden" name="id" value={a.id} />
            <label>Name<input name="name" required defaultValue={a.person?.name ?? ''} /></label>
            <label>Title<input name="title" defaultValue={a.person?.title ?? ''} /></label>
            <button className="secondary" type="submit">Set person</button>
          </form>
          {a.person?.name && !a.contact?.roleConfirmed ? (
            <form action={confirmRoleAction} className="inline"><input type="hidden" name="id" value={a.id} /><button type="submit">Confirm role (after reading the sources)</button></form>
          ) : null}
        </div>

        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Research and drafts</h3>
          <p className="small">{research ? `Last research ${research.date} (${research.mode === 'institution' ? 'institution research: no person named' : 'person research'}), ${research.findings} findings, risk screen ${String(research.risk ?? '–').replace(/_/g, ' ')}.` : 'Not researched yet.'}</p>
          {gate.allowed ? (
            <form action={queueResearchAction} className="inline"><input type="hidden" name="id" value={a.id} /><button type="submit">{research ? 'Research again' : 'Queue research'}</button></form>
          ) : <div className="banner warn small">{gate.reason}</div>}
          <form action={queueDraftAction} className="row" style={{ marginTop: 10 }}>
            <input type="hidden" name="id" value={a.id} />
            <label>Channel<select name="channel">{rules.config.channels.allowed.map((c) => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}</select></label>
            <label>Step<input type="number" name="step" min="1" defaultValue={drafts.length + 1} style={{ width: 70 }} /></label>
            <button className="secondary" type="submit">Queue draft</button>
          </form>
          {drafts.length ? <ul className="small">{drafts.map((x) => <li key={`${x.step}-${x.channel}`}>Step {x.step}, {x.channel}: {x.status}{x.approvedBy ? ` by ${x.approvedBy}` : ''}</li>)}</ul> : null}
        </div>
      </div>

      {pipe ? (
        <>
          <h2>What the pipeline found</h2>
          <div className="panel small">
            <p style={{ marginTop: 0 }}>From scoring run {pipe.runId}, Call Report data as of {period(pipe.period)}. Tier {pipe.tier}, score {num(pipe.score, 1)} (distress {num(pipe.axes?.distress, 1)}, fit {num(pipe.axes?.fit, 1)}, timing {num(pipe.axes?.timing, 1)}).</p>
            <p>{pipe.leadSector ? `Lead sector: ${pipe.leadSector}.` : pipe.leadSectorNote}</p>
            {pipe.signals?.length ? <ul>{pipe.signals.map((s) => <li key={s.id}>{s.label} <span className="src">{period(s.period)}</span></li>)}</ul> : null}
            <p className="muted">Context for research and for choosing who and when. It never appears in a message.</p>
          </div>
        </>
      ) : null}

      <h2>Brief</h2>
      {brief ? <div className="panel"><Markdown text={brief} /></div> : <p className="muted">No brief yet.</p>}
    </>
  );
}
