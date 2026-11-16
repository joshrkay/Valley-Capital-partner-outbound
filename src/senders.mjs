// The senders (senders.json in the data folder): who a message goes out under. One module for the command line (`outbound senders`,
// `outbound status`) and the web app's Senders page, so the rule for a complete sender and for "ready to send" cannot drift:
// - Every field the guard requires for any channel (config.json senderRequired) is filled, and no [CONFIRM] placeholder is left. The guard
//   refuses a touch from an incomplete sender (SENDER_INCOMPLETE); this refuses to save one.
// - The mailbox is a business address for a person: the guard's personal-domain and role checks (config.personalDomains, roleLocalParts).
// - The street address is a real postal address: CAN-SPAM requires one in every commercial email.
// - Sending is ready when there is at least one sender, every sender passes, and the kill switch is off (config, a KILL file or document,
//   or OUTBOUND_KILL=1).
// - A sender a recorded touch names is never removed: the touch log, the caps and the history keep their meaning. An unused one may be.
// Every change needs a principal's name and leaves an audit line that holds the sender's id and the names of the fields that changed,
// never a value: no name, phone, address or mailbox.
import { join } from 'node:path';
import { readJson, writeJson, readJsonl, audit, safeId } from './store.mjs';
import { killFileOn } from './guard.mjs';
import { emailSyntaxOk } from './accounts.mjs';

export const SENDER_FIELDS = Object.freeze(['id', 'name', 'title', 'phone', 'address', 'mailbox']);
const LABEL = { id: 'The sender id', name: 'The name', title: 'The title', phone: 'The phone number', address: 'The street address', mailbox: 'The mailbox (the address you send from)' };
const MAX = 200;
const PLACEHOLDER = /\[confirm/i;
const sendersPath = (dir) => join(dir, 'senders.json');
const need = (v, what) => { const s = String(v ?? '').trim(); if (!s || s === 'true') throw new Error(`${what} is required.`); return s; };
const str = (v) => (v === undefined || v === null || v === true ? '' : String(v).trim());

export const readSenders = (dir) => readJson(sendersPath(dir), { senders: [] }).senders ?? [];

// The fields the guard requires for some channel, in a fixed order, then any others config.json adds.
function requiredFields(config) {
  const all = new Set(Object.values(config?.senderRequired ?? {}).flat());
  return [...SENDER_FIELDS.filter((f) => all.has(f)), ...[...all].filter((f) => !SENDER_FIELDS.includes(f))];
}

// { ok, sender, errors: [{ field, code, message }] }. `sender` holds the known fields, trimmed, with the mailbox in lower case.
export function validateSender(input, { config = {} } = {}) {
  const src = input && typeof input === 'object' ? input : {};
  const errors = [];
  const err = (field, code, message) => errors.push({ field, code, message });
  const sender = Object.fromEntries(SENDER_FIELDS.map((f) => [f, str(src[f])]));
  sender.mailbox = sender.mailbox.toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(sender.id)) err('id', 'SENDER_ID_INVALID', `${LABEL.id} must be lowercase letters, digits, hyphens and underscores (up to 64 characters), for example "pat".`);
  for (const f of requiredFields(config)) {
    const v = str(src[f]);
    const label = LABEL[f] ?? `The ${f}`;
    if (!v) err(f, 'SENDER_FIELD_MISSING', `${label} is required.`);
    else if (PLACEHOLDER.test(v)) err(f, 'SENDER_PLACEHOLDER', `${label} is still a [CONFIRM] placeholder. A sender with a placeholder blocks all sending.`);
  }
  for (const f of SENDER_FIELDS) if (sender[f].length > MAX) err(f, 'SENDER_FIELD_TOO_LONG', `${LABEL[f]} is too long (${MAX} characters at most).`);
  const bad = (f) => errors.some((e) => e.field === f);
  if (sender.mailbox && !bad('mailbox')) {
    if (!emailSyntaxOk(sender.mailbox)) err('mailbox', 'SENDER_MAILBOX_INVALID', `"${sender.mailbox}" is not a valid email address.`);
    else {
      const [local, domain] = sender.mailbox.split('@');
      if ((config.personalDomains ?? []).includes(domain)) err('mailbox', 'SENDER_MAILBOX_PERSONAL', `${domain} is a personal email domain. Send from your business mailbox.`);
      if ((config.roleLocalParts ?? []).includes(local)) err('mailbox', 'SENDER_MAILBOX_ROLE', `"${local}@" is a role address, not a person. Send from your own mailbox.`);
    }
  }
  if (sender.phone && !bad('phone') && (sender.phone.match(/\d/g) ?? []).length < 7) err('phone', 'SENDER_PHONE_INVALID', `${LABEL.phone} needs at least 7 digits.`);
  if (sender.address && !bad('address') && !(/\d/.test(sender.address) && /[A-Za-z]{2,}/.test(sender.address))) {
    err('address', 'SENDER_ADDRESS_INVALID', `${LABEL.address} must be a full postal address: a number and a street (or a registered post office box), city, state and ZIP. CAN-SPAM requires one in every commercial email.`);
  }
  return { ok: errors.length === 0, sender, errors };
}

// The readiness rule (`outbound status` readyToSend, and the Senders page). `kill` is the KILL file or document, or OUTBOUND_KILL.
export function sendingReadiness({ senders = [], config = {}, kill = false }) {
  const reasons = [];
  const incomplete = [];
  if (!senders.length) reasons.push('No sender in senders.json. Add one: every message needs a sender\'s name, title, phone, street address and mailbox.');
  for (const s of senders) {
    const v = validateSender(s, { config });
    // Any [CONFIRM] placeholder anywhere on the sender, even in a field this rule does not know, blocks sending (as it always has).
    const stray = Object.entries(s ?? {}).filter(([k, x]) => !SENDER_FIELDS.includes(k) && PLACEHOLDER.test(String(x))).map(([k]) => `${k} is still a [CONFIRM] placeholder.`);
    if (v.ok && !stray.length) continue;
    incomplete.push(String(s?.id ?? '?'));
    reasons.push(`Sender "${s?.id ?? '?'}": ${[...v.errors.map((e) => e.message), ...stray].join(' ')}`);
  }
  const killSwitch = !!(config.killSwitch || kill);
  if (killSwitch) reasons.push('The kill switch is on (config.json killSwitch, a KILL file or document, or OUTBOUND_KILL=1). Nothing sends until it is turned off.');
  return { ready: reasons.length === 0, killSwitch, senders: senders.length, incomplete, reasons };
}

export const readinessIn = ({ dir, config, env = process.env }) => sendingReadiness({ senders: readSenders(dir), config, kill: killFileOn(dir, env) });

// Adds or edits one sender. mode "add" refuses an id that exists, "edit" one that does not; with no mode (the command line) it does
// either, and a field left out keeps its value. Other keys in senders.json (its _note) and on the sender are kept.
export function setSender({ dir, sender, by, config = {}, mode }) {
  const who = need(by, 'A name for who made the change (--by)');
  const input = sender && typeof sender === 'object' ? sender : {};
  const id = str(input.id);
  const file = readJson(sendersPath(dir), { senders: [] });
  const list = Array.isArray(file.senders) ? file.senders : [];
  const i = list.findIndex((s) => s?.id === id);
  if (mode === 'add' && i >= 0) throw new Error(`A sender "${id}" already exists. Edit it instead.`);
  if (mode === 'edit' && i < 0) throw new Error(`No sender "${id}" in senders.json.`);
  const before = i >= 0 ? list[i] : {};
  const given = Object.fromEntries(SENDER_FIELDS.filter((f) => input[f] !== undefined && input[f] !== true).map((f) => [f, input[f]]));
  const v = validateSender({ ...before, ...given, id }, { config });
  if (!v.ok) { const e = new Error(`Not saved. ${v.errors.map((x) => x.message).join(' ')}`); e.errors = v.errors; throw e; }
  const changed = SENDER_FIELDS.filter((f) => f !== 'id' && str(before[f]) !== v.sender[f]);
  const next = { ...before, ...v.sender };
  writeJson(sendersPath(dir), { ...file, senders: i >= 0 ? list.map((s, j) => (j === i ? next : s)) : [...list, next] });
  audit(dir, { type: i >= 0 ? 'sender_updated' : 'sender_added', senderId: id, fields: changed, by: who });
  return { sender: next, created: i < 0, changed };
}

// Removes a sender no recorded touch names. One that has sent stays, so the touch log's sender ids keep pointing at a real sender.
export function removeSender({ dir, id, by }) {
  const who = need(by, 'A name for who made the change (--by)');
  const sid = safeId(str(id));
  const file = readJson(sendersPath(dir), { senders: [] });
  const list = Array.isArray(file.senders) ? file.senders : [];
  if (!list.some((s) => s?.id === sid)) throw new Error(`No sender "${sid}" in senders.json.`);
  const used = readJsonl(join(dir, 'touches.jsonl')).filter((t) => t.type === 'touch' && t.sender === sid).length;
  if (used) throw new Error(`${used} recorded touch${used === 1 ? '' : 'es'} name${used === 1 ? 's' : ''} this sender, so it stays: the touch log, the caps and the history count by sender. Edit it instead.`);
  writeJson(sendersPath(dir), { ...file, senders: list.filter((s) => s?.id !== sid) });
  audit(dir, { type: 'sender_removed', senderId: sid, by: who });
  return { id: sid };
}
