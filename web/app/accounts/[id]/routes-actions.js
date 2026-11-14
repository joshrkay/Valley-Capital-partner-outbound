'use server';
// The routes section's actions (PRD E17). Building routes and choosing one run the engine in a unit of work as the signed-in principal.
// Nothing is queued, drafted or sent: a chosen route gives a principal a checklist.
import { redirect } from 'next/navigation';
import { requirePrincipal, flash } from '../../../lib/session.mjs';
import * as ro from '../../../lib/routes-ops.mjs';

const field = (fd, k) => String(fd.get(k) ?? '');

async function run(fd, fn, ok) {
  const id = field(fd, 'id');
  const ctx = await requirePrincipal();
  if (ctx.denied) redirect('/login');
  try { const r = await fn(ctx, id); await flash('ok', typeof ok === 'function' ? ok(r) : ok); } catch (e) { await flash('error', e.message); }
  redirect(`/accounts/${encodeURIComponent(id)}`);
}

export const buildRoutesAction = async (fd) => run(fd, (ctx, id) => ro.buildAccountRoutes(ctx.client, { id }), (r) => `Routes built: ${r.routes} listed, ${r.held} held. Matching ran in code; no model saw the network.`);
export const chooseRouteAction = async (fd) => run(fd, (ctx, id) => ro.chooseRoute(ctx.client, { id, route: field(fd, 'route'), by: ctx.principal.name }), 'Route chosen. Its checklist is below. Nothing was drafted or sent.');
