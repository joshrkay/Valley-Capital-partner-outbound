'use server';
// Approving re-runs the linter and the guard on the saved draft (src/draft.mjs approveDraft). It never sends anything.
import { redirect } from 'next/navigation';
import { requirePrincipal, flash } from '../../lib/session.mjs';
import * as ops from '../../lib/ops.mjs';

export async function approveAction(fd) {
  const ctx = await requirePrincipal();
  if (ctx.denied) redirect('/login');
  try {
    const r = await ops.approve(ctx.client, { id: String(fd.get('id') ?? ''), channel: String(fd.get('channel') ?? ''), step: String(fd.get('step') ?? ''), by: ctx.principal.name });
    if (r?.ok) await flash('ok', 'Approved. A principal sends it from their own mailbox; then record the send with `outbound guard record`.');
    else await flash('error', `Not approved: ${(r?.errors ?? []).map((e) => `${e.code}: ${e.message}`).join(' ')}`);
  } catch (e) { await flash('error', e.message); }
  redirect('/drafts');
}
