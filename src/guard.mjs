// Agent 1: the suppression and cadence guard. Code only, no model. It decides whether a touch may happen, enforces the sequence and the caps,
// stops everything on a reply or an opt-out, and logs every decision. It has no way to send anything: a person sends, then records it here.
import { join } from 'node:path';
import { readJson, readJsonl, writeJson, appendJsonl, exists, audit } from './store.mjs';

const DAY = 86400000;
export const norm = (s) => String(s ?? '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
const dateOf = (d) => new Date(d);
const ymd = (d) => dateOf(d).toISOString().slice(0, 10);
const dayNum = (d) => Math.floor(Date.parse(`${ymd(d)}T00:00:00Z`) / DAY);
const daysBetween = (a, b) => dayNum(a) - dayNum(b);
const addDays = (d, n) => new Date((dayNum(d) + n) * DAY).toISOString().slice(0, 10);
const emailParts = (e) => { const m = String(e ?? '').toLowerCase().match(/^([^@\s]+)@([^@\s]+)$/); return m ? { local: m[1], domain: m[2] } : null; };
const phrase = (haystackNorm, needle) => { const n = norm(needle); return n.length > 1 && ` ${haystackNorm} `.includes(` ${n} `); };

export function loadContext({ dir, config, env = process.env }) {
  return {
    config,
    suppression: readJson(join(dir, 'suppression.json'), { entries: [] }).entries ?? [],
    touches: readJsonl(join(dir, 'touches.jsonl')),
    senders: readJson(join(dir, 'senders.json'), { senders: [] }).senders ?? [],
    kill: exists(join(dir, 'KILL')) || env.OUTBOUND_KILL === '1',
  };
}

// touch: { accountId, institution, aliases?, audience, sector, person: {name,email,phone,phoneType,timezone,mailingAddress},
//          contact: {emailStatus, roleConfirmed, provenance}, channel, sender, step, date, text? }
export function checkTouch(touch, ctx) {
  const { config } = ctx;
  const errors = [];
  const warnings = [];
  const err = (code, message) => errors.push({ code, message });
  const warn = (code, message) => warnings.push({ code, message });
  const person = touch.person ?? {};
  const contact = touch.contact ?? {};
  const em = emailParts(person.email);
  const date = touch.date ?? new Date().toISOString();
  const day = ymd(date);

  // 1. Kill switch.
  if (config.killSwitch || ctx.kill) err('KILL_SWITCH', 'The kill switch is on. Nothing sends until it is turned off.');

  // 2. Channel.
  if (config.channels.banned?.[touch.channel]) err('CHANNEL_BANNED', config.channels.banned[touch.channel]);
  else if (!config.channels.allowed.includes(touch.channel)) err('CHANNEL_UNKNOWN', `"${touch.channel}" is not an allowed channel (${config.channels.allowed.join(', ')}).`);

  // 3. Sender, and a complete sender block for the channel.
  const sender = ctx.senders.find((s) => s.id === touch.sender);
  if (!sender) err('SENDER_UNKNOWN', `Sender "${touch.sender}" is not in senders.json.`);
  else {
    const need = config.senderRequired[touch.channel] ?? [];
    const missing = need.filter((k) => !sender[k] || /\[confirm/i.test(String(sender[k])));
    if (missing.length) err('SENDER_INCOMPLETE', `Sender "${sender.id}" is missing ${missing.join(', ')} for a ${touch.channel}. A message without a name, phone and street address must not go out.`);
  }

  // 4. Suppression.
  const instNorm = norm(touch.institution);
  const textNorm = norm(touch.text ?? '');
  for (const e of ctx.suppression) {
    const names = [e.value, ...(e.aliases ?? [])];
    const why = `${e.reason ?? 'suppressed'}${e.added ? `, added ${e.added}` : ''}`;
    if (e.type === 'email' && em && String(e.value).toLowerCase() === `${em.local}@${em.domain}`) err('SUPPRESSED_EMAIL', `This address is suppressed (${why}).`);
    if (e.type === 'domain' && em && (em.domain === String(e.value).toLowerCase() || em.domain.endsWith(`.${String(e.value).toLowerCase()}`))) err('SUPPRESSED_DOMAIN', `This domain is suppressed (${why}).`);
    if (e.type === 'person' && norm(person.name) === norm(e.value)) err('SUPPRESSED_PERSON', `This person is suppressed (${why}).`);
    if (e.type === 'institution' && names.some((n) => norm(n) === instNorm || norm(n) === norm(touch.accountId) || (norm(n).length > 3 && phrase(instNorm, n)))) err('SUPPRESSED_INSTITUTION', `This institution is suppressed (${why}).`);
    if (e.type === 'asset' && names.some((n) => phrase(textNorm, n))) err('SUPPRESSED_ASSET_NAMED', `The text names an asset or party under NDA, bid or hold (${why}). Remove it.`);
  }

  // 5. History for this account: a reply, opt-out, meeting or handoff stops the sequence for good.
  const mine = ctx.touches.filter((t) => t.accountId === touch.accountId);
  // Institutions are small worlds: a reply or opt-out from anyone at the bank stops outreach to everyone there, and caps count the whole bank.
  const sameInstitution = (t) => instNorm && t.institution && norm(t.institution) === instNorm;
  const related = ctx.touches.filter((t) => t.accountId === touch.accountId || sameInstitution(t));
  const stop = related.find((t) => (config.stopEvents ?? []).includes(t.type));
  if (stop) err('SEQUENCE_STOPPED', `${stop.accountId === touch.accountId ? 'This account has' : `Another contact at ${touch.institution} (${stop.accountId}) has`} a recorded ${stop.type} (${stop.date}). The sequence is over; a principal takes it from here.`);
  const byDate = (a, b) => dateOf(a.date) - dateOf(b.date);
  const sent = mine.filter((t) => t.type === 'touch').sort(byDate);
  const instSent = related.filter((t) => t.type === 'touch').sort(byDate);
  const quiet = config.caps.institutionOneAtATimeDays ?? 0;
  const other = instSent.filter((t) => t.accountId !== touch.accountId && daysBetween(day, t.date) >= 0 && daysBetween(day, t.date) < quiet).pop();
  if (other) err('OTHER_CONTACT_ACTIVE', `Another person at ${touch.institution} (${other.accountId}) was last contacted ${ymd(other.date)}. One person at a bank at a time: wait until ${addDays(other.date, quiet)}, or ask a principal.`);

  // 6. Contact quality.
  if (touch.channel === 'email') {
    if (!em) err('EMAIL_MISSING', 'No valid business email address on the account.');
    else {
      if ((config.personalDomains ?? []).includes(em.domain)) err('PERSONAL_EMAIL', `${em.domain} is a personal email domain. Business addresses only.`);
      if ((config.roleLocalParts ?? []).includes(em.local)) err('ROLE_EMAIL', `"${em.local}@" is a role address, not a person.`);
    }
    if (contact.emailStatus !== 'verified') err('EMAIL_UNVERIFIED', `Email status is "${contact.emailStatus ?? 'unknown'}". Only verified addresses are used.`);
    if (mine.some((t) => t.type === 'bounce')) err('EMAIL_BOUNCED', 'A previous message to this account bounced.');
  }
  if (touch.channel === 'letter' && !person.mailingAddress) err('ADDRESS_MISSING', 'No mailing address on the account for a letter.');
  if (touch.channel === 'call') {
    if (!person.phone) err('PHONE_MISSING', 'No phone number on the account.');
    else if (!(config.calls?.callablePhoneTypes ?? []).includes(person.phoneType)) err('PHONE_NOT_BUSINESS_LINE', `Phone type is "${person.phoneType ?? 'unknown'}". Only business landlines are called, never mobile or unknown numbers.`);
    if (!person.timezone) err('TIMEZONE_MISSING', 'Calls need the recipient\'s time zone.');
    else if (!/T\d\d:\d\d/.test(String(date))) err('CALL_TIME_REQUIRED', 'A call needs a date and time (for example 2026-11-17T14:30:00Z) so local calling hours can be checked.');
    else {
      try {
        const parts = new Intl.DateTimeFormat('en-US', { timeZone: person.timezone, hour: 'numeric', hour12: false, weekday: 'short' }).formatToParts(dateOf(date));
        const hour = Number(parts.find((p) => p.type === 'hour').value) % 24;
        const wd = parts.find((p) => p.type === 'weekday').value;
        const [from, to] = config.calls?.hours ?? [9, 17];
        if (['Sat', 'Sun'].includes(wd) || hour < from || hour >= to) err('OUTSIDE_CALL_HOURS', `That is ${wd} ${hour}:00 in ${person.timezone}. Calls go out on weekdays between ${from}:00 and ${to}:00 local time.`);
      } catch { err('TIMEZONE_INVALID', `"${person.timezone}" is not a valid time zone.`); }
    }
  }
  if (!contact.roleConfirmed) err('ROLE_UNCONFIRMED', 'The named person\'s role has not been confirmed. Run the briefer and read its person check first.');
  if (!(contact.provenance ?? []).length) err('NO_PROVENANCE', 'The contact has no recorded source for where its details came from.');

  // 7. Caps.
  const caps = config.caps;
  if (touch.step === 1 && sender) {
    const n = ctx.touches.filter((t) => t.type === 'touch' && t.step === 1 && t.sender === touch.sender && daysBetween(day, t.date) >= 0 && daysBetween(day, t.date) < 7).length;
    if (n >= caps.firstTouchesPerSenderPerWeek) err('CAP_FIRST_TOUCHES_WEEK', `${n} new accounts already touched by ${touch.sender} in the last 7 days (cap ${caps.firstTouchesPerSenderPerWeek}).`);
  }
  if (touch.channel === 'email') {
    const n = ctx.touches.filter((t) => t.type === 'touch' && t.channel === 'email' && t.sender === touch.sender && ymd(t.date) === day).length;
    if (n >= caps.emailsPerSenderPerDay) err('CAP_EMAIL_DAY', `${n} emails already sent by ${touch.sender} on ${day} (cap ${caps.emailsPerSenderPerDay}).`);
  }
  const recent = instSent.filter((t) => daysBetween(day, t.date) >= 0 && daysBetween(day, t.date) < 90).length;
  if (recent >= caps.touchesPerAccountPer90Days) err('CAP_ACCOUNT_90D', `${recent} touches to this institution in the last 90 days (cap ${caps.touchesPerAccountPer90Days}).`);
  const lastAny = instSent[instSent.length - 1];
  if (lastAny && daysBetween(day, lastAny.date) < caps.minGapDays) err('TOO_SOON', `The last touch to this institution was ${ymd(lastAny.date)}. Wait at least ${caps.minGapDays} days between touches.`);
  const last = sent[sent.length - 1];

  // 8. Sequence: the next step, on the right channel, once it is due.
  const seq = config.sequence;
  const expected = seq[sent.length];
  let next = null;
  if (!expected) err('SEQUENCE_COMPLETE', 'The sequence is complete. Move this account to quarterly nurture; do not send another touch.');
  else {
    const due = last ? addDays(last.date, expected.afterDays) : null;
    next = { step: expected.step, channel: expected.channel, due };
    if (touch.step !== expected.step) err('WRONG_STEP', `The next step is ${expected.step}, not ${touch.step}.`);
    if (touch.channel !== expected.channel) err('WRONG_CHANNEL', `Step ${expected.step} is a ${expected.channel}, not a ${touch.channel}.`);
    if (due && day < due) err('NOT_DUE', `Step ${expected.step} is not due until ${due}.`);
  }

  return { allowed: errors.length === 0, errors, warnings, next };
}

// Called after a person has actually sent the touch. Re-checks, then logs. Message text is never stored here.
export function recordTouch(dir, touch, ctx) {
  const r = checkTouch(touch, ctx);
  audit(dir, { type: 'guard_check', accountId: touch.accountId, channel: touch.channel, step: touch.step, allowed: r.allowed, codes: r.errors.map((e) => e.code) });
  if (!r.allowed) { const e = new Error(`Not recorded: ${r.errors.map((x) => x.code).join(', ')}`); e.result = r; throw e; }
  const rec = { type: 'touch', accountId: touch.accountId, institution: touch.institution, step: touch.step, channel: touch.channel, sender: touch.sender, date: ymd(touch.date ?? new Date()), recordedAt: new Date().toISOString() };
  appendJsonl(join(dir, 'touches.jsonl'), rec);
  ctx.touches.push(rec);
  return rec;
}

// A send that has already happened: a person sent it, or a mailbox sync saw it leave (PRD E9-S2). It is ALWAYS recorded, because the log
// must match reality: refusing to log a real send would leave the caps, the cadence and the one-at-a-time rule counting from a false
// history. Any rule the send broke (a cap filled, a suppression added after the draft was approved) is kept on the record and audited.
export function recordObservedSend(dir, touch, ctx) {
  const r = checkTouch(touch, ctx);
  const codes = r.errors.map((e) => e.code);
  const rec = { type: 'touch', accountId: touch.accountId, institution: touch.institution, step: touch.step, channel: touch.channel, sender: touch.sender, date: ymd(touch.date ?? new Date()), recordedAt: new Date().toISOString(), observed: true, ...(codes.length ? { violations: codes } : {}) };
  appendJsonl(join(dir, 'touches.jsonl'), rec);
  ctx.touches.push(rec);
  audit(dir, { type: codes.length ? 'send_recorded_with_violations' : 'send_recorded', accountId: touch.accountId, channel: touch.channel, step: touch.step, codes });
  return { rec, violations: r.errors };
}

// A reply, opt-out, bounce, meeting or handoff. An opt-out suppresses the person and address at once.
export function recordEvent(dir, { accountId, institution, type, date, note, person }, ctx) {
  const allowed = ['reply', 'opt_out', 'bounce', 'meeting', 'handoff'];
  if (!allowed.includes(type)) throw new Error(`Unknown event "${type}". Use ${allowed.join(', ')}.`);
  const rec = { type, accountId, institution, date: ymd(date ?? new Date()), note: note ? String(note).slice(0, 200) : undefined, recordedAt: new Date().toISOString() };
  appendJsonl(join(dir, 'touches.jsonl'), rec);
  ctx.touches.push(rec);
  if (type === 'opt_out' && person) {
    if (person.email) addSuppression(dir, { type: 'email', value: String(person.email).toLowerCase(), reason: 'opt_out' }, ctx);
    if (person.name) addSuppression(dir, { type: 'person', value: person.name, reason: 'opt_out' }, ctx);
  }
  audit(dir, { type: 'event', accountId, event: type });
  return rec;
}

export function addSuppression(dir, entry, ctx) {
  const allowed = ['email', 'domain', 'person', 'institution', 'asset'];
  if (!allowed.includes(entry.type)) throw new Error(`Unknown suppression type "${entry.type}". Use ${allowed.join(', ')}.`);
  if (!entry.value) throw new Error('A suppression entry needs a value.');
  const file = join(dir, 'suppression.json');
  const all = readJson(file, { entries: [] });
  const e = { ...entry, added: entry.added ?? new Date().toISOString().slice(0, 10) };
  all.entries.push(e);
  writeJson(file, all);
  ctx?.suppression.push(e);
  audit(dir, { type: 'suppress', entryType: e.type, reason: e.reason });
  return e;
}

// Builds the touch to check from an account record and the choices on the command line.
export function touchFromAccount(account, { channel, step, date, sender, text }) {
  return {
    accountId: account.id, institution: account.name, aliases: account.aliases ?? [], audience: account.audience ?? account.type, sector: account.sectors?.[0],
    tier: account.tier, person: account.person ?? {}, contact: account.contact ?? {}, channel, sender, step, date, text,
  };
}

// What is due for each account: the next step, or why it is blocked. Uses the same checks as a real touch.
export function dueList(accounts, ctx, { date, sender }) {
  return accounts.map((a) => {
    const sent = ctx.touches.filter((t) => t.accountId === a.id && t.type === 'touch').length;
    const expected = ctx.config.sequence[sent];
    if (!expected) return { accountId: a.id, state: 'sequence_complete' };
    const probe = checkTouch(touchFromAccount(a, { channel: expected.channel, step: expected.step, date, sender }), ctx);
    return { accountId: a.id, step: expected.step, channel: expected.channel, state: probe.allowed ? 'due' : 'blocked', due: probe.next?.due ?? null, blockedBy: probe.errors.map((e) => e.code) };
  });
}
