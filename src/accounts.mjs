// A principal's decisions about an account's person (PRD E7-S1): who the person is, and that their role is confirmed. One module for
// the command line and the web app, so the rules cannot drift: naming a new person always resets the role to unconfirmed, a role can
// only be confirmed for a named person, and every change needs a name and leaves an audit line.
import { join } from 'node:path';
import { readJson, writeJson, audit, safeId } from './store.mjs';

const need = (v, what) => { const s = String(v ?? '').trim(); if (!s || s === 'true') throw new Error(`${what} is required.`); return s; };
const load = (dir, id) => {
  safeId(id);
  const a = readJson(join(dir, 'accounts', `${id}.json`), null);
  if (!a) throw new Error(`No account "${id}".`);
  return a;
};

export function setPerson({ dir, id, name, title = '', by, now = new Date() }) {
  const who = need(by, 'A name for who made the change (--by)');
  const a = load(dir, id);
  a.person = { ...(a.person ?? {}), name: need(name, 'The person\'s name'), title: title === true ? '' : String(title ?? '').trim() };
  a.contact = { ...(a.contact ?? {}), roleConfirmed: false, roleConfirmedBy: undefined, roleConfirmedAt: undefined };   // a new person's role is unconfirmed
  writeJson(join(dir, 'accounts', `${id}.json`), a);
  audit(dir, { type: 'person_set', accountId: id, by: who, at: now.toISOString() });
  return a;
}

export function confirmRole({ dir, id, by, now = new Date() }) {
  const who = need(by, 'A name for who confirmed it (--by)');
  const a = load(dir, id);
  if (!String(a.person?.name ?? '').trim()) throw new Error(`${a.name} has no named person yet. Name one first (set person), then confirm their role.`);
  a.contact = { ...(a.contact ?? {}), roleConfirmed: true, roleConfirmedBy: who, roleConfirmedAt: now.toISOString() };
  writeJson(join(dir, 'accounts', `${id}.json`), a);
  audit(dir, { type: 'role_confirmed', accountId: id, by: who });
  return a;
}
