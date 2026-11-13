'use server';
// Account actions. Naming the person and confirming the role run in a unit of work; research and drafting are queued for the worker.
import { redirect } from 'next/navigation';
import { requirePrincipal, flash } from '../../lib/session.mjs';
import * as ops from '../../lib/ops.mjs';

const field = (fd, k) => String(fd.get(k) ?? '');

async function run(fd, fn, ok) {
  const id = field(fd, 'id');
  const ctx = await requirePrincipal();
  if (ctx.denied) redirect('/login');
  try { await fn(ctx, id); await flash('ok', ok); } catch (e) { await flash('error', e.message); }
  redirect(`/accounts/${encodeURIComponent(id)}`);
}

export const setPersonAction = async (fd) => run(fd, (ctx, id) => ops.setPerson(ctx.client, { id, name: field(fd, 'name'), title: field(fd, 'title'), by: ctx.principal.name }), 'Person recorded. Their role is unconfirmed until a principal confirms it.');
export const confirmRoleAction = async (fd) => run(fd, (ctx, id) => ops.confirmRole(ctx.client, { id, by: ctx.principal.name }), 'Role confirmed.');
export const queueResearchAction = async (fd) => run(fd, (ctx, id) => ops.queueResearch(ctx.client, { id }), 'Research queued. The worker runs it; the brief appears here when it is done.');
export const queueDraftAction = async (fd) => run(fd, (ctx, id) => ops.queueDraft(ctx.client, { id, channel: field(fd, 'channel'), step: field(fd, 'step') }), 'Draft queued. It appears in Approvals when it is ready.');
