'use server';
// The network page's actions (PRD E22-S1). Each runs the engine's own function (src/network.mjs, src/routes.mjs) in a unit of work as the
// signed-in principal, who is recorded as --by. Audit lines carry ids only. Flash messages name ids, never a name from the network.
import { redirect } from 'next/navigation';
import { requirePrincipal, flash } from '../../lib/session.mjs';
import * as ro from '../../lib/routes-ops.mjs';

const field = (fd, k) => String(fd.get(k) ?? '');

async function run(fn, ok) {
  const ctx = await requirePrincipal();
  if (ctx.denied) redirect('/login');
  try { const r = await fn(ctx); await flash('ok', ok(r)); } catch (e) { await flash('error', e.message); }
  redirect('/network');
}

export const addPersonAction = async (fd) => run((ctx) => ro.addNetworkPerson(ctx.client, { name: field(fd, 'name'), organization: field(fd, 'organization'), title: field(fd, 'title'), relationship: field(fd, 'relationship'), knownBy: field(fd, 'knownBy'), introConsent: field(fd, 'introConsent'), aliases: field(fd, 'aliases'), by: ctx.principal.name }), (r) => `Added ${r.id}.`);
export const addFirmAction = async (fd) => run((ctx) => ro.addNetworkFirm(ctx.client, { name: field(fd, 'name'), kind: field(fd, 'kind'), relationship: field(fd, 'relationship'), knownBy: field(fd, 'knownBy'), aliases: field(fd, 'aliases'), by: ctx.principal.name }), (r) => `Added ${r.id}.`);
export const addMembershipAction = async (fd) => run((ctx) => ro.addNetworkMembership(ctx.client, { association: field(fd, 'association'), principal: field(fd, 'principal'), role: field(fd, 'role'), aliases: field(fd, 'aliases'), by: ctx.principal.name }), (r) => `Added ${r.id}.`);
export const removeEntryAction = async (fd) => run((ctx) => ro.removeNetworkEntry(ctx.client, { id: field(fd, 'id'), by: ctx.principal.name }), (r) => `Removed ${r.id}, and ${r.routesRemoved} route(s) that used it from ${r.routeFiles} routes file(s).`);
