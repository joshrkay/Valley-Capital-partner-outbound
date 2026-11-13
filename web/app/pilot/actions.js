'use server';
import { redirect } from 'next/navigation';
import { requirePrincipal, flash } from '../../lib/session.mjs';
import * as ops from '../../lib/ops.mjs';

export async function verdictAction(fd) {
  const id = String(fd.get('id') ?? '');
  const ctx = await requirePrincipal();
  if (ctx.denied) redirect('/login');
  try { await ops.markVerdict(ctx.client, { id, findingId: String(fd.get('finding') ?? ''), verdict: String(fd.get('verdict') ?? ''), by: ctx.principal.name }); }
  catch (e) { await flash('error', e.message); }
  redirect(`/pilot/${encodeURIComponent(id)}`);
}

export async function passAction() {
  const ctx = await requirePrincipal();
  if (ctx.denied) redirect('/login');
  try {
    const r = await ops.passPilot(ctx.client, { by: ctx.principal.name });
    await flash(r.ok ? 'ok' : 'error', r.ok ? 'Pilot passed. The briefer may now research accounts from the candidate list.' : `Not passed: ${r.reasons.join(' ')}`);
  } catch (e) { await flash('error', e.message); }
  redirect('/pilot');
}
