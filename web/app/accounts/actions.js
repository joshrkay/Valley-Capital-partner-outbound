'use server';
// Account actions. Naming the person and confirming the role run in a unit of work; research and drafting are queued for the worker.
import { redirect } from 'next/navigation';
import { requirePrincipal, flash } from '../../lib/session.mjs';
import * as ops from '../../lib/ops.mjs';

const field = (fd, k) => String(fd.get(k) ?? '');

// `ok` is the message, or a function of the action's result that returns it.
async function run(fd, fn, ok) {
  const id = field(fd, 'id');
  const ctx = await requirePrincipal();
  if (ctx.denied) redirect('/login');
  try { const r = await fn(ctx, id); await flash('ok', typeof ok === 'function' ? ok(r) : ok); } catch (e) { await flash('error', e.message); }
  redirect(`/accounts/${encodeURIComponent(id)}`);
}
// Where a contact detail came from (PRD E7-S3): the form's source kind, brief finding, page, vendor and date seen.
const sourceOf = (fd) => ({ kind: field(fd, 'source'), findingId: field(fd, 'finding'), url: field(fd, 'url'), vendor: field(fd, 'vendor'), seenOn: field(fd, 'seen') });

// A form with no source fields at all (the older one in "The person" panel) is told where to go, rather than given command-line flags.
export const setPersonAction = async (fd) => run(fd, (ctx, id) => {
  if (!fd.has('source')) throw new Error('Naming the person needs a source (PRD E7-S3): where the name came from. Use the "Name the person" form under Contact details.');
  return ops.setPerson(ctx.client, { id, name: field(fd, 'name'), title: field(fd, 'title'), by: ctx.principal.name, source: sourceOf(fd) });
}, 'Person recorded with its source. Their role is unconfirmed until a principal confirms it.');
export const confirmRoleAction = async (fd) => run(fd, (ctx, id) => ops.confirmRole(ctx.client, { id, by: ctx.principal.name }), 'Role confirmed.');
export const queueResearchAction = async (fd) => run(fd, (ctx, id) => ops.queueResearch(ctx.client, { id }), 'Research queued. The worker runs it; the brief appears here when it is done.');
// Calls (PRD E15). Saving notes and confirming run as the signed-in principal; the brief and the reading of the notes are queued.
export const queueCallPrepAction = async (fd) => run(fd, (ctx, id) => ops.queueCallPrep(ctx.client, { id, date: field(fd, 'date') }), 'Call brief queued. The worker writes it; it appears here, with its check result, when it is done.');
export const logCallAction = async (fd) => run(fd, (ctx, id) => ops.logCallNotes(ctx.client, { id, date: field(fd, 'date'), notes: field(fd, 'notes'), by: ctx.principal.name }), 'Notes saved. A proposal of what to record is queued; nothing is recorded until a principal confirms it.');
export const confirmCallAction = async (fd) => run(fd, (ctx, id) => ops.confirmCall(ctx.client, { id, proposal: field(fd, 'proposal'), by: ctx.principal.name }), 'Call recorded: a meeting in the touch log (the sequence is over), the outcome on the account, and a follow-up checklist. People named in the notes stay unconfirmed.');
export const rejectCallAction = async (fd) => run(fd, (ctx, id) => ops.rejectCall(ctx.client, { id, proposal: field(fd, 'proposal'), by: ctx.principal.name, reason: field(fd, 'reason') }), 'Proposal rejected. Nothing was recorded.');
export const queueDraftAction = async (fd) => run(fd, (ctx, id) => ops.queueDraft(ctx.client, { id, channel: field(fd, 'channel'), step: field(fd, 'step') }), 'Draft queued. It appears in Approvals when it is ready.');
// Contact details (PRD E7-S3). Each runs the engine's own function in a unit of work as the signed-in principal. Nothing here sends.
export const setEmailAction = async (fd) => run(fd, (ctx, id) => ops.setEmail(ctx.client, { id, email: field(fd, 'email'), by: ctx.principal.name, source: sourceOf(fd) }), 'Address recorded with its source. It is unverified until a principal verifies it.');
export const addDomainAction = async (fd) => run(fd, (ctx, id) => ops.addDomain(ctx.client, { id, domain: field(fd, 'domain'), by: ctx.principal.name, source: sourceOf(fd) }),
  (r) => (r.sharedWith.length ? `Domain confirmed. Another account already holds it (${r.sharedWith.join(', ')}): a reply from it goes to a principal for review.` : 'Domain confirmed.'));
export const verifyEmailAction = async (fd) => run(fd, async (ctx, id) => {
  const r = await ops.verifyEmail(ctx.client, { id, by: ctx.principal.name, method: field(fd, 'method'), url: field(fd, 'url'), vendor: field(fd, 'vendor'), seen: field(fd, 'seen') });
  if (!r.ok) throw new Error(`Not verified. The address stays unverified. ${r.checks.filter((c) => !c.ok).map((c) => `${c.id}: ${c.message}`).join(' ')}`);
  return r;
}, 'Verified: every check passed and your attestation is recorded.');
export const forgetPersonAction = async (fd) => run(fd, (ctx, id) => ops.forgetPerson(ctx.client, { id, by: ctx.principal.name, reason: field(fd, 'reason'), confirm: field(fd, 'confirm') }),
  (r) => `The person was removed from every record (${Object.values(r.counts).reduce((a, b) => a + b, 0)} files or lines changed). A hashed suppression entry keeps them from being contacted or named again.`);
