// Server only. Working without Gmail: the account page's touches panel. A principal approves a draft, sends it from their own mailbox, then
// records here what happened. Each action runs the guard's own function, the one `outbound guard record` and `outbound guard event` call
// (src/guard.mjs recordObservedSend, recordEvent), in a unit of work as the signed-in principal, loading the guard's files and the one
// account (src/uow.mjs recordLoads). No framework code, so each can be tested against a fake Supabase REST API.
// - A recorded send is ALWAYS recorded: it already happened. The rules it broke come back to be shown, and stay on the record.
// - The step is the command line's: one more than the touches already recorded for the account.
// - Dates are never later than today, the rule for call dates (src/calls.mjs). A call may carry its time, so calling hours are checked.
// - An opt-out needs the principal's confirmation, then suppresses the person and the address at once.
// - No message text is stored. A note is a short internal one, and one that looks like it holds an address or a number is refused.
import { join } from 'node:path';
import { engine, loadRules } from './engine.mjs';

const ymd = (d) => new Date(d).toISOString().slice(0, 10);
const str = (v) => (typeof v === 'string' ? v.trim() : '');
const need = (v, what) => { const s = str(v); if (!s) throw new Error(`${what} is required.`); return s; };
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const PHONE = /\d{3}[\s.)-]*\d{3}[\s.-]*\d{4}/;
const NOTE_MAX = 200;
const EVENT_LABEL = { reply: 'a reply', opt_out: 'an opt-out', bounce: 'a bounce', meeting: 'a meeting', handoff: 'a handoff' };
const mods = async () => {
  const [uow, store, guard, calls, senders] = await Promise.all(['src/uow.mjs', 'src/store.mjs', 'src/guard.mjs', 'src/calls.mjs', 'src/senders.mjs'].map(engine));
  return { uow, store, guard, calls, senders };
};

// A date as a form gives it, checked as a call's date is: a real date, and not later than today. "Today" is the UTC date, which is never
// earlier than the date in a US time zone, so something recorded the same evening is never refused.
function heldDate(calls, date, what, now) {
  const d = calls.needDate(str(date), 'The date');
  const today = ymd(now);
  if (d > today) throw new Error(`The date ${d} is later than today (${today}). Record ${what} after it has happened.`);
  return d;
}

// A wall-clock time in an IANA time zone, as an instant (ISO, UTC). Two passes settle the offset, daylight saving included.
function zonedIso(day, time, tz) {
  const [y, mo, d] = day.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const local = Date.UTC(y, mo - 1, d, h, mi);
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const offset = (t) => { const p = Object.fromEntries(fmt.formatToParts(new Date(t)).map((x) => [x.type, x.value])); return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute) - t; };
  let t = local - offset(local);
  t = local - offset(t);
  return new Date(t).toISOString();
}

// The channel, date and (for a call) time of a send. `when` is what the guard checks: the date, or for a call with a time in the
// recipient's time zone, the instant. With no zone the time cannot be placed, so only the date is kept (the guard reports the missing zone).
function sendFields({ calls, rules }, { channel, date, time }, { timezone, now }) {
  const ch = need(channel, 'A channel');
  const allowed = rules.config.channels.allowed;
  if (!allowed.includes(ch)) throw new Error(`"${ch}" is not a channel the guard allows (${allowed.join(', ')}).`);
  const day = heldDate(calls, date, 'a send', now);
  const t = ch === 'call' ? str(time) : '';
  if (t && !TIME.test(t)) throw new Error('The time must be HH:MM.');
  let when = day;
  if (t && timezone) {
    try { when = zonedIso(day, t, timezone); } catch { when = `${day}T${t}:00.000Z`; }   // not a real zone: the guard says so (TIMEZONE_INVALID)
    if (Date.parse(when) > now.getTime()) throw new Error('That time is later than now. Record a call after it has taken place.');
  }
  return { channel: ch, date: day, time: t, when };
}

// The same checks for a form's choice before it is recorded (the account page's "Check with the guard"). Throws on bad input.
export async function sendInput(input, { timezone = '', now = new Date() } = {}) {
  const [{ calls }, rules] = await Promise.all([mods(), loadRules()]);
  return sendFields({ calls, rules }, input ?? {}, { timezone, now });
}

function noteOf(note) {
  const n = str(note);
  if (n.length > NOTE_MAX) throw new Error(`The note is too long: ${NOTE_MAX} characters at most. It is a short internal note, never the reply's text.`);
  if (EMAIL.test(n) || PHONE.test(n)) throw new Error('The note looks like it holds an email address or a phone number. Keep it to a short internal note with no personal data, and never the reply\'s text.');
  return n;
}

const historyRow = (t) => ({ type: t.type, step: t.step ?? null, channel: t.channel ?? null, sender: t.sender ?? null, date: t.date, by: t.by, note: t.note ?? null, observed: !!t.observed, violations: t.violations ?? [], ref: t.ref ?? null, recordedAt: t.recordedAt ?? null });

// The account's touch history (newest first), what `outbound guard due` says for it, and the guard's verdict for the send about to be
// recorded: the principal's last check (`check`, if it is for this account and still valid), or else the next step, today, the first
// sender. Read-only: the unit of work changes nothing, so nothing is written back. Null when there is no such account.
export async function accountTouches(client, id, { check = null, now = new Date() } = {}) {
  const m = await mods();
  const rules = await loadRules();
  m.store.safeId(need(id, 'An account id'));   // checked before it becomes part of a path
  const today = ymd(now);
  const { result } = await client.unitOfWork(m.uow.recordLoads(id), (dir) => {
    const account = m.store.readJson(join(dir, 'accounts', `${id}.json`), null);
    if (!account) return null;
    const ctx = m.guard.loadContext({ dir, config: rules.config });
    const mine = ctx.touches.map((t, i) => ({ t, i })).filter(({ t }) => t.accountId === id);
    const sent = mine.filter(({ t }) => t.type === 'touch').length;
    const expected = rules.config.sequence[sent] ?? null;
    const firstSender = ctx.senders[0]?.id ?? '';
    const timezone = account.person?.timezone ?? '';
    let chosen = null;
    let checkProblem = null;
    if (check && typeof check === 'object' && check.id === id) {
      try { chosen = { ...sendFields({ calls: m.calls, rules }, check, { timezone, now }), sender: need(check.sender, 'A sender') }; } catch (e) { checkProblem = e.message; }
    }
    const fields = chosen ?? { ...sendFields({ calls: m.calls, rules }, { channel: expected?.channel ?? rules.config.channels.allowed[0], date: today }, { timezone, now }), sender: firstSender };
    const step = sent + 1;
    const verdict = m.guard.checkTouch(m.guard.touchFromAccount(account, { channel: fields.channel, step, date: fields.when, sender: fields.sender }), ctx);
    const byNewest = (a, b) => String(b.t.date).localeCompare(String(a.t.date)) || String(b.t.recordedAt ?? '').localeCompare(String(a.t.recordedAt ?? '')) || b.i - a.i;
    return {
      account: { id: account.id, name: account.name },
      today, sent, next: expected ? { step: expected.step, channel: expected.channel } : null,
      history: [...mine].sort(byNewest).map(({ t }) => historyRow(t)),
      due: m.guard.dueList([account], ctx, { date: today, sender: firstSender })[0],
      senders: ctx.senders.map((s) => ({ id: s.id, name: s.name ?? '', ok: m.senders.validateSender(s, { config: rules.config }).ok })),
      channels: rules.config.channels.allowed,
      proposal: { channel: fields.channel, date: fields.date, time: fields.time, sender: fields.sender, step, checked: !!chosen },
      checkProblem,
      verdict: { allowed: verdict.allowed, errors: verdict.errors, warnings: verdict.warnings },
      eventTypes: m.guard.EVENT_TYPES.filter((x) => x !== 'opt_out'),
      stopEvents: rules.config.stopEvents ?? [],
      timezone,
      optOut: { name: account.person?.name ?? '', email: account.person?.email ?? '' },
    };
  });
  return result;
}

// A send a principal already made from their own mailbox. `step` is the step the principal checked: if the log moved on since, nothing is
// recorded and they check again. The send is recorded whatever the guard says now; the rules it broke are returned to be shown.
export async function recordSend(client, { id, channel, date, time, sender, step, by, now = new Date() }) {
  const m = await mods();
  const rules = await loadRules();
  const who = need(by, 'A name for who recorded it');
  m.store.safeId(need(id, 'An account id'));
  const from = need(sender, 'A sender');
  sendFields({ calls: m.calls, rules }, { channel, date }, { timezone: '', now });   // refuse bad input before loading anything
  const checked = String(step ?? '').trim();
  const { result } = await client.unitOfWork(m.uow.recordLoads(id), (dir) => {
    const account = m.store.readJson(join(dir, 'accounts', `${id}.json`), null);
    if (!account) throw new Error(`There is no account ${id}.`);
    const f = sendFields({ calls: m.calls, rules }, { channel, date, time }, { timezone: account.person?.timezone ?? '', now });
    const ctx = m.guard.loadContext({ dir, config: rules.config });
    const next = ctx.touches.filter((t) => t.accountId === id && t.type === 'touch').length + 1;   // as `outbound guard record` counts it
    if (checked && Number(checked) !== next) throw new Error(`The touch log changed since you checked: the next step is now ${next}, not ${checked}. Check again, then record.`);
    const r = m.guard.recordObservedSend(dir, m.guard.touchFromAccount(account, { channel: f.channel, step: next, date: f.when, sender: from }), ctx, { by: who });
    return { step: next, channel: f.channel, date: r.rec.date, violations: r.violations.map((v) => ({ code: v.code, message: v.message })) };
  });
  return result;
}

// A reply, opt-out, bounce, meeting or handoff, with its date. An opt-out needs confirmOptOut === true: it suppresses the person and the
// address at once (the guard's own rule), and stops outreach to everyone at the bank.
export async function recordEvent(client, { id, type, date, note, by, confirmOptOut, now = new Date() }) {
  const m = await mods();
  const who = need(by, 'A name for who recorded it');
  m.store.safeId(need(id, 'An account id'));
  const kind = str(type);
  if (!m.guard.EVENT_TYPES.includes(kind)) throw new Error(`Unknown event "${kind}". Use ${m.guard.EVENT_TYPES.join(', ')}.`);
  if (kind === 'opt_out' && confirmOptOut !== true) throw new Error('An opt-out needs your confirmation. It suppresses the person and the address at once, and stops outreach to everyone at the bank.');
  const day = heldDate(m.calls, date, EVENT_LABEL[kind], now);
  const n = noteOf(note);
  const rules = await loadRules();
  const { result } = await client.unitOfWork(m.uow.recordLoads(id), (dir) => {
    const account = m.store.readJson(join(dir, 'accounts', `${id}.json`), null);
    if (!account) throw new Error(`There is no account ${id}.`);
    const ctx = m.guard.loadContext({ dir, config: rules.config });
    const rec = m.guard.recordEvent(dir, { accountId: id, institution: account.name, type: kind, date: day, note: n || undefined, person: account.person, by: who }, ctx);
    return { type: kind, date: rec.date, suppressed: kind === 'opt_out' ? { person: !!str(account.person?.name), email: !!str(account.person?.email) } : null };
  });
  return result;
}
