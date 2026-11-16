'use server';
// Buyer-list registration (PRD next-five E19-S3): the engine's own setRegistration, as the signed-in principal. The agreement itself is
// never stored; proof of funds is refused until the credibility package is recorded as approved (outbound intermediaries credibility-approved).
import { redirect } from 'next/navigation';
import { requirePrincipal, flash } from '../../lib/session.mjs';
import * as ops from '../../lib/ops.mjs';

export async function setRegistrationAction(fd) {
  const key = String(fd.get('key') ?? '');
  const ctx = await requirePrincipal();
  if (ctx.denied) redirect('/login');
  try {
    const r = await ops.setRegistration(ctx.client, { key, state: String(fd.get('state') ?? ''), by: ctx.principal.name, recertifyBy: String(fd.get('recertifyBy') ?? '') });
    await flash('ok', `Buyer list: ${String(r.state).replace(/_/g, ' ')}${r.recertifyBy ? `, re-certify by ${r.recertifyBy}` : ''}.`);
  } catch (e) { await flash('error', e.message); }
  redirect(`/intermediaries/${encodeURIComponent(key)}`);
}
