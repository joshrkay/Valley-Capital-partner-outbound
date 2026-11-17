import { requirePrincipal } from '../../lib/session.mjs';
import { listDrafts } from '../../lib/ops.mjs';
import { NotAuthorized, Problem } from '../ui.jsx';
import ApprovalsView from './approvals-view.jsx';

export const metadata = { title: 'Approvals · Valley Capital outbound' };

export default async function Drafts() {
  const ctx = await requirePrincipal();
  if (ctx.denied) return <NotAuthorized email={ctx.email} />;
  let rows;
  try { rows = await listDrafts(ctx.client); } catch (e) { return <Problem text={`Drafts could not be loaded: ${e.message}`} />; }
  return <ApprovalsView rows={rows} />;
}
