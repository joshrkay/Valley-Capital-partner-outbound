import { requirePrincipal } from '../../../lib/session.mjs';
import { pilotReview } from '../../../lib/ops.mjs';
import { NotAuthorized, Problem } from '../../ui.jsx';
import { verdictAction } from '../actions.js';

export default async function Review({ params }) {
  const ctx = await requirePrincipal();
  if (ctx.denied) return <NotAuthorized email={ctx.email} />;
  const { id: raw } = await params;
  const id = decodeURIComponent(raw);
  let r;
  try { r = await pilotReview(ctx.client, id); } catch (e) { return <Problem text={e.message} />; }
  return (
    <>
      <h1>Review: {id}</h1>
      <p className="sub">Research of {r.researchDate}. Mark each finding against what you know. A finding cleared for a message that you mark false counts as a fabrication.</p>
      {r.staleReview ? <div className="banner warn">The research was run again since the last review, so verdicts start over.</div> : null}
      {r.findings.map((f) => (
        <div key={f.id} className="panel">
          <p style={{ marginTop: 0 }}><strong>[{f.id}]</strong> {f.claim}</p>
          <p className="small muted">“{f.quote}”</p>
          <p className="small"><a href={f.url} rel="noopener noreferrer nofollow" target="_blank">{f.url}</a> · {f.kind} · {f.use === 'draft' ? 'cleared for a message' : 'context only'}{f.assetSpecific ? ' · asset' : ''}</p>
          <form action={verdictAction} className="inline">
            <input type="hidden" name="id" value={id} /><input type="hidden" name="finding" value={f.id} />
            <span className="small">Verdict: <strong>{f.verdict ?? 'unreviewed'}</strong></span>
            {['true', 'false', 'unknown'].map((v) => <button key={v} name="verdict" value={v} type="submit" className={v === 'false' ? 'danger' : 'secondary'}>{v}</button>)}
          </form>
        </div>
      ))}
    </>
  );
}
