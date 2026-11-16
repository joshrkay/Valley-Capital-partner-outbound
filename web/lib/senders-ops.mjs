// Server only. The Senders page's reads and actions, written against the engine (src/senders.mjs, the same module `outbound senders` and
// `outbound status` use) and a platform client, with no framework code, so each can be tested against a fake Supabase REST API. Each runs
// in a unit of work as the signed-in principal, loading LOADS.senders (senders.json and the KILL document) or LOADS.senderRemove (those
// and the touch log). Audit lines carry the sender's id and the names of the fields that changed, never a value.
import { engine, loadRules } from './engine.mjs';

const mods = async () => {
  const [uow, senders] = await Promise.all(['src/uow.mjs', 'src/senders.mjs'].map(engine));
  return { LOADS: uow.LOADS, senders };
};
const str = (v) => (typeof v === 'string' ? v : '');

// Each sender with its check, and whether sending is ready (the kill switch included: config.json, the KILL document, OUTBOUND_KILL).
export async function sendersOverview(client) {
  const { LOADS, senders } = await mods();
  const rules = await loadRules();
  const { result } = await client.unitOfWork(LOADS.senders, (dir) => ({
    senders: senders.readSenders(dir).map((s) => { const v = senders.validateSender(s, { config: rules.config }); return { ...s, ok: v.ok, errors: v.errors }; }),
    readiness: senders.readinessIn({ dir, config: rules.config }),
    fields: senders.SENDER_FIELDS,
  }));
  return result;
}

// mode: "add" (a new id) or "edit" (an existing one). The form sends every field; a blank one is refused, never kept from before.
export async function saveSender(client, { mode, sender, by }) {
  if (!['add', 'edit'].includes(mode)) throw new Error('Choose add or edit.');
  const { LOADS, senders } = await mods();
  const rules = await loadRules();
  const input = Object.fromEntries(senders.SENDER_FIELDS.map((f) => [f, str(sender?.[f])]));
  const { result } = await client.unitOfWork(LOADS.senders, (dir) => senders.setSender({ dir, sender: input, by, config: rules.config, mode }));
  return { id: result.sender.id, created: result.created, changed: result.changed };
}

export async function removeSender(client, { id, by }) {
  const { LOADS, senders } = await mods();
  const { result } = await client.unitOfWork(LOADS.senderRemove, (dir) => senders.removeSender({ dir, id: str(id), by }));
  return result;
}
