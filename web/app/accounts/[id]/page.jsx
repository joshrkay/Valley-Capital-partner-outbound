import { cache } from 'react';
import { requirePrincipal as signedIn } from '../../../lib/session.mjs';
import { accountDetail, accountName, outreachSignals } from '../../../lib/ops.mjs';
import { accountRoutes } from '../../../lib/routes-ops.mjs';
import { loadRules } from '../../../lib/engine.mjs';
import { nextStep } from '../../../lib/account-view.mjs';
import { NotAuthorized, Problem } from '../../ui.jsx';
import AccountRecord from './account-record.jsx';

// Once per request, shared by the title and the page.
const requirePrincipal = cache(signedIn);

// The tab's title is the account's name, so several open accounts can be told apart.
export async function generateMetadata({ params }) {
  const fallback = { title: 'Account · Valley Capital outbound' };
  try {
    const ctx = await requirePrincipal();
    if (ctx.denied) return fallback;
    const name = await accountName(ctx.client, decodeURIComponent((await params).id));
    return name ? { title: `${name} · Valley Capital outbound` } : fallback;
  } catch { return fallback; }
}

// The account, its next step (from its drafts, its routes' hard stops, the touch log and the orders in force), and its sections.
export default async function Account({ params }) {
  const ctx = await requirePrincipal();
  if (ctx.denied) return <NotAuthorized email={ctx.email} />;
  const { id: raw } = await params;
  const id = decodeURIComponent(raw);
  let d, rules;
  try { [d, rules] = await Promise.all([accountDetail(ctx.client, id), loadRules()]); } catch (e) { return <Problem text={`This account could not be loaded: ${e.message}`} />; }
  if (!d) return <Problem text={`There is no account ${id}.`} />;
  const [routes, signals] = await Promise.all([accountRoutes(ctx.client, id).catch(() => null), outreachSignals(ctx.rest)]);
  const next = nextStep({ account: d.account, gate: d.gate, drafts: d.drafts, routes, touches: signals.touches.filter((t) => t.accountId === id), orders: d.orders ?? [], research: d.research });
  return <AccountRecord client={ctx.client} d={d} rules={rules} next={next} />;
}
