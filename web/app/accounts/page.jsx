import { requirePrincipal } from '../../lib/session.mjs';
import { listAccounts, outreachSignals } from '../../lib/ops.mjs';
import { stageOfAccount, nextStep } from '../../lib/account-view.mjs';
import { NotAuthorized, Problem } from '../ui.jsx';
import OutreachView from './outreach-view.jsx';

export const metadata = { title: 'Outreach · Valley Capital outbound' };

// Outreach: the accounts, each with its stage and next step, from the account records, their drafts' statuses and the touch log.
export default async function Accounts() {
  const ctx = await requirePrincipal();
  if (ctx.denied) return <NotAuthorized email={ctx.email} />;
  let rows, signals;
  try { [rows, signals] = await Promise.all([listAccounts(ctx.client, ctx.rest), outreachSignals(ctx.rest)]); } catch (e) { return <Problem text={`Outreach could not be loaded: ${e.message}`} />; }
  const shaped = rows.map((a) => {
    const account = { id: a.id, person: { name: a.person ?? '' }, contact: { roleConfirmed: a.roleConfirmed }, researchedAt: a.researchedAt };
    const input = { account, drafts: signals.drafts.get(a.id) ?? [], touches: signals.touches.filter((t) => t.accountId === a.id) };
    return { ...a, stage: stageOfAccount(input), next: nextStep(input) };
  });
  return <OutreachView rows={shaped} />;
}
