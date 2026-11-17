import { requirePrincipal } from '../../lib/session.mjs';
import { engine } from '../../lib/engine.mjs';
import { latestTriage, candidateItems, countDrafts } from '../../lib/ops.mjs';
import { NotAuthorized, Problem, PageHead } from '../ui.jsx';
import { queueTriageAction } from './actions.js';
import WeekView from './week-view.jsx';

export const metadata = { title: 'This week · Valley Capital outbound' };

// The weekly triage (PRD E6-S5), rendered from the stored record as the home page. Internal: for the firm's principals only, never sent
// anywhere. The act-now and watch banks' candidate items are read for their priority, place and could-fit ceiling.
export default async function ThisWeek({ searchParams }) {
  const ctx = await requirePrincipal();
  if (ctx.denied) return <NotAuthorized email={ctx.email} />;
  const sp = await searchParams;
  const date = typeof sp?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : undefined;
  let t, tri;
  try { [t, tri] = await Promise.all([latestTriage(ctx.client, { date }), engine('src/triage.mjs')]); }
  catch (e) { return <Problem text={`The triage could not be loaded: ${e.message}`} />; }
  const queue = <form action={queueTriageAction}><button type="submit" className="btn">Queue a triage run</button></form>;
  if (!t) {
    return (
      <div className="page">
        <PageHead icon="home" tone="t-home" eyebrow="Home" title="This week" lede="What changed since last week, across every source. The worker writes it every Monday, after the FDIC check and scoring." actions={queue} />
        <p className="muted">No triage yet{date ? ` for ${date}` : ''}.</p>
      </div>
    );
  }
  const keys = [...(t.actNow ?? []), ...(t.watch ?? []), ...(t.inConversation ?? [])].map((i) => i.key);
  const [candidates, approvals] = await Promise.all([
    candidateItems(ctx.client, keys).catch(() => new Map()),
    countDrafts(ctx.rest).catch(() => null),
  ]);
  const cal = tri.calendarLines(t.calendar);
  const dates = { date: tri.longDate(t.date), comparedWith: t.comparedWith ? tri.longDate(t.comparedWith.date) : null, calendar: cal[2] ?? cal[0] ?? '' };
  return <WeekView t={t} candidates={candidates} approvals={approvals} dates={dates} queue={queue} />;
}
