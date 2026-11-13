'use server';
// Promote, dismiss and snooze: the engine's own functions (src/candidates.mjs), run in a unit of work as the signed-in principal.
import { redirect } from 'next/navigation';
import { requirePrincipal, flash } from '../../lib/session.mjs';
import * as ops from '../../lib/ops.mjs';

const back = (key) => `/candidates/${encodeURIComponent(key)}`;
const field = (fd, k) => String(fd.get(k) ?? '');

export async function promoteAction(fd) {
  const key = field(fd, 'key');
  const ctx = await requirePrincipal();
  if (ctx.denied) redirect('/login');
  let to = back(key);
  try {
    const r = await ops.promote(ctx.client, { key, by: ctx.principal.name });
    await flash('ok', `Promoted ${r.name}.${r.leadSector ? ` It leads with ${r.leadSector}.` : ` ${r.note}`} Next: name the person or queue institution research.`);
    to = `/accounts/${encodeURIComponent(r.accountId)}`;
  } catch (e) { await flash('error', e.message); }
  redirect(to);
}

export async function dismissAction(fd) {
  const key = field(fd, 'key');
  const ctx = await requirePrincipal();
  if (ctx.denied) redirect('/login');
  let to = back(key);
  try { await ops.dismiss(ctx.client, { key, by: ctx.principal.name, reason: field(fd, 'reason') }); await flash('ok', 'Dismissed. It returns only if a new signal fires.'); to = '/candidates'; }
  catch (e) { await flash('error', e.message); }
  redirect(to);
}

export async function snoozeAction(fd) {
  const key = field(fd, 'key');
  const ctx = await requirePrincipal();
  if (ctx.denied) redirect('/login');
  let to = back(key);
  try { await ops.snooze(ctx.client, { key, by: ctx.principal.name, until: field(fd, 'until') }); await flash('ok', `Snoozed until ${field(fd, 'until')}.`); to = '/candidates'; }
  catch (e) { await flash('error', e.message); }
  redirect(to);
}
