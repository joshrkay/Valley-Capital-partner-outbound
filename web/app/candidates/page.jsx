import { requirePrincipal } from '../../lib/session.mjs';
import { loadRules } from '../../lib/engine.mjs';
import { listCandidates } from '../../lib/ops.mjs';
import { listParams } from '../../lib/candidates-view.mjs';
import { NotAuthorized, Problem } from '../ui.jsx';
import BanksView from './banks-view.jsx';

export const metadata = { title: 'Banks · Valley Capital outbound' };

// Banks to call. Every bank the scoring run ranks (suppressed, promoted, dismissed and snoozed ones hidden exactly as `outbound candidates
// list` hides them), with the view, filters and sort read from the query string. Nothing here contacts anyone.
export default async function Banks({ searchParams }) {
  const ctx = await requirePrincipal();
  if (ctx.denied) return <NotAuthorized email={ctx.email} />;
  const p = listParams(await searchParams);
  let rows, rules;
  try {
    [rows, rules] = await Promise.all([listCandidates(ctx.client, { tier: 'all', metro: p.metro }, { rest: ctx.rest }), loadRules()]);
  } catch (e) { return <Problem text={`The bank list could not be loaded: ${e.message}`} />; }
  return <BanksView rows={rows} params={p} metros={rules.metros.metros ?? []} tiers={rules.scoring.tiers} />;
}
