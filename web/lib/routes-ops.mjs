// Server only. The reads and actions of the account page's routes section and of the network page (PRD E22), written against the
// engine and a platform client like ops.mjs (kept in its own file beside it), so each can be tested against a fake Supabase REST API.
// Building routes is code with no model, so it runs in a unit of work as the signed-in principal, never as a job. Nothing here drafts,
// queues or sends anything: a chosen route gives a principal a checklist. Every load is narrowed to what the engine's load lists name
// (src/uow.mjs LOADS.routes via routesLoads, and LOADS.network).
import { engine, loadRules } from './engine.mjs';

const need = (v, what) => { const s = typeof v === 'string' ? v.trim() : ''; if (!s) throw new Error(`${what} is required.`); return s; };
const opt = (v) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const mods = async () => {
  const [uow, store, network, routes] = await Promise.all(['src/uow.mjs', 'src/store.mjs', 'src/network.mjs', 'src/routes.mjs'].map(engine));
  return { LOADS: uow.LOADS, store, network, routes };
};

// ---- The account page -----------------------------------------------------------------------------------------------------------
// The stored routes record for one account, or null before the first build. Only that one document is loaded.
export async function accountRoutes(client, id) {
  const { store } = await mods();
  store.safeId(need(id, 'An account id'));   // checked before it becomes part of a path
  const snap = await client.load([`routes/${id}.json`]);
  return snap.docs[`routes/${id}.json`] ?? null;
}

export async function buildAccountRoutes(client, { id }) {
  const { routes } = await mods();
  const rules = await loadRules();
  const { result } = await client.unitOfWork(routes.routesLoads(need(id, 'An account id')), (dir) => routes.routesSummary(routes.buildRoutes({ dir, id, rules })));
  return result;
}

export async function chooseRoute(client, { id, route, by }) {
  const { routes } = await mods();
  const rules = await loadRules();
  const { result } = await client.unitOfWork(routes.routesLoads(need(id, 'An account id')), (dir) => routes.chooseRoute({ dir, id, routeId: need(route, 'A route'), by, rules }));
  return { routeId: result.route.id, type: result.route.type };
}

// ---- The network page ---------------------------------------------------------------------------------------------------------
// Viewing the network writes an audit line (who looked, and counts), so it runs in a unit of work rather than a plain read.
export async function networkOverview(client, { by }) {
  const { LOADS, network } = await mods();
  const { result } = await client.unitOfWork(LOADS.network, (dir) => network.listNetwork({ dir, by }));
  return result;
}

export async function addNetworkPerson(client, { name, organization, title, relationship, knownBy, introConsent, aliases, by }) {
  const { LOADS, network } = await mods();
  const { result } = await client.unitOfWork(LOADS.network, (dir) => network.addPerson({ dir, name, organization: opt(organization), title: opt(title), relationship: opt(relationship), knownBy, introConsent: opt(introConsent), aliases: opt(aliases), by }));
  return result;
}

export async function addNetworkFirm(client, { name, kind, relationship, knownBy, aliases, by }) {
  const { LOADS, network } = await mods();
  const { result } = await client.unitOfWork(LOADS.network, (dir) => network.addFirm({ dir, name, kind: opt(kind), relationship: opt(relationship), knownBy, aliases: opt(aliases), by }));
  return result;
}

export async function addNetworkMembership(client, { association, principal, role, aliases, by }) {
  const { LOADS, network } = await mods();
  const { result } = await client.unitOfWork(LOADS.network, (dir) => network.addMembership({ dir, association, principal, role: opt(role), aliases: opt(aliases), by }));
  return result;
}

// Removes the entry and every route and choice that used it, in every account's routes file (src/routes.mjs removeNetworkEntry).
export async function removeNetworkEntry(client, { id, by }) {
  const { LOADS, routes } = await mods();
  const { result } = await client.unitOfWork(LOADS.network, (dir) => routes.removeNetworkEntry({ dir, id: need(id, 'An entry id'), by }));
  return result;
}
