'use server';
// The Senders page's actions. Each runs the engine's own function (src/senders.mjs, the same as `outbound senders`) in a unit of work as
// the signed-in principal, who is recorded as `by`. Audit lines carry the sender's id and the names of the fields that changed; flash
// messages name the id only.
import { redirect } from 'next/navigation';
import { requirePrincipal, flash } from '../../lib/session.mjs';
import * as so from '../../lib/senders-ops.mjs';

const field = (fd, k) => String(fd.get(k) ?? '');
const senderOf = (fd) => ({ id: field(fd, 'id'), name: field(fd, 'name'), title: field(fd, 'title'), phone: field(fd, 'phone'), address: field(fd, 'address'), mailbox: field(fd, 'mailbox') });

async function run(fn, ok) {
  const ctx = await requirePrincipal();
  if (ctx.denied) redirect('/login');
  try { const r = await fn(ctx); await flash('ok', ok(r)); } catch (e) { await flash('error', e.message); }
  redirect('/senders');
}

export const addSenderAction = async (fd) => run((ctx) => so.saveSender(ctx.client, { mode: 'add', sender: senderOf(fd), by: ctx.principal.name }), (r) => `Added sender ${r.id}.`);
export const editSenderAction = async (fd) => run((ctx) => so.saveSender(ctx.client, { mode: 'edit', sender: senderOf(fd), by: ctx.principal.name }), (r) => (r.changed.length ? `Saved sender ${r.id}: ${r.changed.join(', ')} changed.` : `Sender ${r.id}: nothing changed.`));
export const removeSenderAction = async (fd) => run((ctx) => so.removeSender(ctx.client, { id: field(fd, 'id'), by: ctx.principal.name }), (r) => `Removed sender ${r.id}.`);
