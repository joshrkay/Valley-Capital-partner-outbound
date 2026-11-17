// A bank's page: the candidate item, its decision and its paper estimate (PRD E14-S1), read as the signed-in principal, shown as a record
// page (docs/design-redesign.md, 5.3). Promote, snooze and dismiss go through the same server actions as before. Nothing here sends.
import { cache } from 'react';
import { requirePrincipal as signedIn } from '../../../lib/session.mjs';
import { loadRules } from '../../../lib/engine.mjs';
import { candidateDetail, routeOf, triageFlags } from '../../../lib/ops.mjs';
import { tabOf } from '../../../lib/bank-view.mjs';
import { NotAuthorized, Problem } from '../../ui.jsx';
import BankRecord from './bank-record.jsx';

// Once per request, shared by the title and the page.
const requirePrincipal = cache(signedIn);
const detail = cache(async (client, key) => candidateDetail(client, key));

// The tab's title is the bank's name, so several open banks can be told apart.
export async function generateMetadata({ params }) {
  const fallback = { title: 'Bank · Valley Capital outbound' };
  try {
    const ctx = await requirePrincipal();
    if (ctx.denied) return fallback;
    const d = await detail(ctx.client, decodeURIComponent((await params).key));
    return d?.item?.name ? { title: `${d.item.name} · Valley Capital outbound` } : fallback;
  } catch { return fallback; }
}

export default async function Bank({ params, searchParams }) {
  const ctx = await requirePrincipal();
  if (ctx.denied) return <NotAuthorized email={ctx.email} />;
  const { key: raw } = await params;
  const key = decodeURIComponent(raw);
  const tab = tabOf(await searchParams);
  let d, rules, flags;
  try { [d, rules, flags] = await Promise.all([detail(ctx.client, key), loadRules(), triageFlags(ctx.client, key)]); }
  catch (e) { return <Problem text={`This bank could not be loaded: ${e.message}`} />; }
  if (!d) return <Problem text={`There is no bank ${key} in the latest scoring run.`} />;
  // How this bank sells (next-five E19-S4): unknown unless a source or a principal shows it. Its own load; a failure hides only this line.
  let route = null;
  try { route = await routeOf(ctx.client, d.item.key); } catch { route = null; }
  return <BankRecord item={d.item} paper={d.paper} decision={d.decision} suppressed={d.suppressed} route={route} tab={tab} scoring={rules.scoring} isNew={flags.isNew} inConversation={flags.inConversation} />;
}
