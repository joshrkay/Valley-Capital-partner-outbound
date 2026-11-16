'use server';
// The touches panel's actions (working without Gmail). Recording runs the guard's own function in a unit of work as the signed-in
// principal, recorded as `by` (web/lib/touches-ops.mjs). "Check with the guard" records nothing: it keeps the principal's choice (channel,
// date, time, sender id; no name or address) in a short-lived cookie, not the URL, and the panel shows the guard's verdict for it.
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { requirePrincipal, flash } from '../../../lib/session.mjs';
import * as to from '../../../lib/touches-ops.mjs';

const field = (fd, k) => String(fd.get(k) ?? '');
const CHECK = 'send-check';
const back = (id) => redirect(`/accounts/${encodeURIComponent(id)}#touches`);

async function run(fd, fn, ok) {
  const id = field(fd, 'id');
  const ctx = await requirePrincipal();
  if (ctx.denied) redirect('/login');
  try { const r = await fn(ctx, id); await flash('ok', typeof ok === 'function' ? ok(r) : ok); } catch (e) { await flash('error', e.message); }
  back(id);
}

export const checkSendAction = async (fd) => {
  const id = field(fd, 'id');
  const ctx = await requirePrincipal();
  if (ctx.denied) redirect('/login');
  try {
    const v = await to.sendInput({ channel: field(fd, 'channel'), date: field(fd, 'date'), time: field(fd, 'time') });
    const store = await cookies();
    store.set(CHECK, JSON.stringify({ id, channel: v.channel, date: v.date, time: v.time, sender: field(fd, 'sender') }), { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 900, secure: process.env.NODE_ENV === 'production' });
  } catch (e) { await flash('error', e.message); }
  back(id);
};

export const recordSendAction = async (fd) => run(fd, async (ctx, id) => {
  const r = await to.recordSend(ctx.client, { id, channel: field(fd, 'channel'), date: field(fd, 'date'), time: field(fd, 'time'), sender: field(fd, 'sender'), step: field(fd, 'step'), by: ctx.principal.name });
  (await cookies()).delete(CHECK);
  return r;
}, (r) => (r.violations.length
  ? `Recorded step ${r.step} (${r.channel.replace('_', ' ')}, ${r.date}). It broke ${r.violations.length} rule(s), kept on the record; review before the next touch: ${r.violations.map((v) => `${v.code}: ${v.message}`).join(' ')}`
  : `Recorded step ${r.step} (${r.channel.replace('_', ' ')}, ${r.date}). The guard found nothing wrong with it.`));

export const recordEventAction = async (fd) => run(fd, (ctx, id) => to.recordEvent(ctx.client, { id, type: field(fd, 'type'), date: field(fd, 'date'), note: field(fd, 'note'), by: ctx.principal.name }),
  (r) => `Recorded a ${r.type} on ${r.date}.${['reply', 'meeting', 'handoff'].includes(r.type) ? ' The sequence is over for everyone at this bank; a principal takes it from here.' : r.type === 'bounce' ? ' No more email goes to this address.' : ''}`);

export const recordOptOutAction = async (fd) => run(fd, (ctx, id) => to.recordEvent(ctx.client, { id, type: 'opt_out', date: field(fd, 'date'), note: field(fd, 'note'), by: ctx.principal.name, confirmOptOut: field(fd, 'confirm') === 'yes', optOutName: field(fd, 'optOutName'), optOutEmail: field(fd, 'optOutEmail') }),
  (r) => `Opt-out recorded on ${r.date}. ${r.suppressed.person || r.suppressed.email ? `Suppressed at once: ${[r.suppressed.person ? 'the person' : '', r.suppressed.email ? 'their address' : ''].filter(Boolean).join(' and ')}.` : 'No person or address was on the account to suppress.'} Outreach to everyone at this bank has stopped.`);
