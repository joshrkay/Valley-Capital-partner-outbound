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
// Calls (PRD E15). Saving notes and confirming run as the signed-in principal; the brief and the reading of the notes are queued.
export const queueCallPrepAction = async (fd) => run(fd, (ctx, id) => ops.queueCallPrep(ctx.client, { id, date: field(fd, 'date') }), 'Call brief queued. The worker writes it; it appears here, with its check result, when it is done.');
export const logCallAction = async (fd) => run(fd, (ctx, id) => ops.logCallNotes(ctx.client, { id, date: field(fd, 'date'), notes: field(fd, 'notes'), by: ctx.principal.name }), 'Notes saved. A proposal of what to record is queued; nothing is recorded until a principal confirms it.');
export const confirmCallAction = async (fd) => run(fd, (ctx, id) => ops.confirmCall(ctx.client, { id, proposal: field(fd, 'proposal'), by: ctx.principal.name }), 'Call recorded: a meeting in the touch log (the sequence is over), the outcome on the account, and a follow-up checklist. People named in the notes stay unconfirmed.');
export const rejectCallAction = async (fd) => run(fd, (ctx, id) => ops.rejectCall(ctx.client, { id, proposal: field(fd, 'proposal'), by: ctx.principal.name, reason: field(fd, 'reason') }), 'Proposal rejected. Nothing was recorded.');
export const queueDraftAction = async (fd) => run(fd, (ctx, id) => ops.queueDraft(ctx.client, { id, channel: field(fd, 'channel'), step: field(fd, 'step') }), 'Draft queued. It appears in Approvals when it is ready.');
