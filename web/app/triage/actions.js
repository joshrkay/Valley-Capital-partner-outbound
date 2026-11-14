'use server';
import { redirect } from 'next/navigation';
import { requirePrincipal, flash } from '../../lib/session.mjs';
import * as ops from '../../lib/ops.mjs';

// Queues the weekly triage for the worker. The schedule also queues it every Monday, after the FDIC check and scoring.
export async function queueTriageAction() {
  const ctx = await requirePrincipal();
  if (ctx.denied) redirect('/login');
  try { await ops.queueTriage(ctx.client); await flash('ok', 'Triage queued. It runs at the next worker run.'); } catch (e) { await flash('error', e.message); }
  redirect('/triage');
}
