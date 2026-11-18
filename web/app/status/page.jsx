import { requirePrincipal } from '../../lib/session.mjs';
import { statusOverview, coverageOverview, registrationReminders, countyCoverage } from '../../lib/ops.mjs';
import { coverageCard } from '../../lib/coverage-view.mjs';
import { countyRows } from '../../lib/loans-view.mjs';
import { NotAuthorized, Problem } from '../ui.jsx';
import { Outcomes } from './outcomes.jsx';
import StatusView from './status-view.jsx';

export const metadata = { title: 'System status · Valley Capital outbound' };

// The health line, sending paused or allowed, the refresh buttons, coverage, jobs, and the raw tables under Technical detail.
export default async function Status() {
  const ctx = await requirePrincipal();
  if (ctx.denied) return <NotAuthorized email={ctx.email} />;
  let s;
  try { s = await statusOverview(ctx.rest, ctx.client); } catch (e) { return <Problem text={`Status could not be loaded: ${e.message}`} />; }
  // The coverage card reads its own documents; if it cannot, the rest of the page still shows.
  let cov = null, covError = null;
  try { cov = coverageCard(await coverageOverview(ctx.client)); } catch (e) { covError = e.message; }
  // Buyer-list re-certifications due soon (next-five E19-S3); a failure hides only this card.
  let reminders = [];
  try { reminders = await registrationReminders(ctx.client); } catch { reminders = []; }
  // A row per watched county (docs/county-loans.md), from one small document; a failure hides only this table.
  let counties = [], countiesError = null;
  try { counties = countyRows(await countyCoverage(ctx.client)); } catch (e) { countiesError = e.message; }
  return <StatusView s={s} cov={cov} covError={covError} reminders={reminders} counties={counties} countiesError={countiesError} outcomes={<Outcomes client={ctx.client} />}
    scoreCheck={<a href="/calibration">Score check</a>} />;
}
