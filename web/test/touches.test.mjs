// Working without Gmail: the account page's touches panel (web/lib/touches-ops.mjs) against the repository's fake Supabase REST API. A
// principal sends from their own mailbox, then records the send here, and records a reply, opt-out, bounce, meeting or handoff. Each runs
// the guard's own function (recordObservedSend, recordEvent) in a unit of work as the signed-in principal. Invented data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakePostgrest } from '../../test/postgrest-fake.mjs';
import { platformClient, pathFilter } from '../../src/platform/client.mjs';
import { recordLoads } from '../../src/uow.mjs';
import * as to from '../lib/touches-ops.mjs';

const URL_ = 'https://example-project.supabase.test';
const WEB = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NOW = new Date('2026-11-16T15:00:00Z');
const ID = 'acme-bank';
const SENDER = { id: 'pat', name: 'Pat Example', title: 'Principal', phone: '555-0100', address: '1 Example Way, Anytown, ST 00000', mailbox: 'pat@example.test' };
const SEEN = { kind: 'institution_site', url: 'https://acmebank.test/leadership', seenOn: '2026-11-01', by: 'Pat Example', at: '2026-11-01T12:00:00.000Z' };
const ACCOUNT = {
  id: ID, name: 'Acme Community Bank', aliases: [], type: 'bank', audience: 'bank', sectors: ['hospitality'], tier: 'A',
  person: { name: 'Jordan Sample', title: 'Chief Credit Officer', email: 'jordan@acmebank.test', phone: '555-0199', phoneType: 'landline', timezone: 'America/Chicago', mailingAddress: '10 Main St, Anytown' },
  contact: {
    emailStatus: 'verified', roleConfirmed: true,
    provenance: ['name', 'title', 'email', 'phone', 'mailingAddress'].map((field) => ({ field, value: { name: 'Jordan Sample', title: 'Chief Credit Officer', email: 'jordan@acmebank.test', phone: '555-0199', mailingAddress: '10 Main St, Anytown' }[field], ...SEEN })),
    verification: { email: 'jordan@acmebank.test', method: 'institution_site', url: SEEN.url, seenOn: '2026-11-01', by: 'Pat Example', at: SEEN.at, verifiedOn: '2026-11-01' },
  },
  domains: [{ domain: 'acmebank.test', kind: 'institution_site', url: SEEN.url }],
};
const seed = (fake, path, body) => fake.docs.set(path, { path, kind: 'json', body, text: null, version: 1 });
const touchLines = (fake) => fake.lines.filter((l) => l.path === 'touches.jsonl');
const auditLines = (fake) => fake.lines.filter((l) => l.path === 'audit.jsonl').map((l) => l.line);

function setup({ touches = [] } = {}) {
  const fake = fakePostgrest();
  const client = platformClient({ url: URL_, key: 'anon-key', accessToken: 'user:pat@example.test', fetchImpl: fake.fetchImpl });
  seed(fake, `accounts/${ID}.json`, ACCOUNT);
  seed(fake, 'senders.json', { senders: [SENDER] });
  seed(fake, 'suppression.json', { entries: [] });
  for (const t of touches) fake.lines.push({ id: fake.lines.length + 1, path: 'touches.jsonl', line: t, by: 'pat@example.test' });
  return { fake, client };
}
const letter = { type: 'touch', accountId: ID, institution: ACCOUNT.name, step: 1, channel: 'letter', sender: 'pat', date: '2026-11-10', recordedAt: '2026-11-10T18:00:00.000Z', observed: true };

test('recording a send: the guard\'s recordObservedSend in a unit of work; the step is the command line\'s; the line reaches the touch log with who recorded it', async () => {
  const { fake, client } = setup();
  const r = await to.recordSend(client, { id: ID, channel: 'letter', date: '2026-11-16', sender: 'pat', by: 'Pat Example', now: NOW });
  assert.deepEqual([r.step, r.channel, r.date, r.violations], [1, 'letter', '2026-11-16', []]);
  const [line] = touchLines(fake);
  assert.deepEqual([line.line.type, line.line.step, line.line.channel, line.line.sender, line.line.date, line.line.observed, line.line.by, line.by], ['touch', 1, 'letter', 'pat', '2026-11-16', true, 'Pat Example', 'pat@example.test']);
  assert.deepEqual(auditLines(fake).map((a) => [a.type, a.by, a.step]), [['send_recorded', 'Pat Example', 1]]);
  // The next send is step 2, counted from the log, as `outbound guard record` counts it. It breaks rules (too soon, not due) and is
  // recorded all the same: the send already happened. The broken rules come back to be shown, and stay on the record.
  const again = await to.recordSend(client, { id: ID, channel: 'email', date: '2026-11-16', sender: 'pat', by: 'Pat Example', now: NOW });
  assert.equal(again.step, 2);
  assert.ok(again.violations.some((v) => v.code === 'NOT_DUE') && again.violations.every((v) => v.message));
  assert.equal(touchLines(fake).length, 2);
  assert.deepEqual(touchLines(fake)[1].line.violations, again.violations.map((v) => v.code));
  assert.equal(auditLines(fake)[1].type, 'send_recorded_with_violations');
  // Only the guard's files and this one account were loaded.
  const loads = fake.calls.filter((c) => c.method === 'GET' && c.path === 'documents').map((c) => c.query.or);
  assert.ok(loads.length && loads.every((or) => or === pathFilter(recordLoads(ID))));
});

test('a send is refused, and nothing is written, for a date after today, a channel the guard does not know, or a step that moved since the check', async () => {
  const { fake, client } = setup({ touches: [letter] });
  await assert.rejects(to.recordSend(client, { id: ID, channel: 'email', date: '2026-11-17', sender: 'pat', by: 'Pat', now: NOW }), /2026-11-17 is later than today \(2026-11-16\)/);
  await assert.rejects(to.recordSend(client, { id: ID, channel: 'email', date: '16/11/2026', sender: 'pat', by: 'Pat', now: NOW }), /YYYY-MM-DD/);
  await assert.rejects(to.recordSend(client, { id: ID, channel: 'sms', date: '2026-11-16', sender: 'pat', by: 'Pat', now: NOW }), /not a channel the guard allows/);
  await assert.rejects(to.recordSend(client, { id: ID, channel: 'email', date: '2026-11-16', sender: '', by: 'Pat', now: NOW }), /A sender is required/);
  await assert.rejects(to.recordSend(client, { id: ID, channel: 'email', date: '2026-11-16', sender: 'pat', step: '1', by: 'Pat', now: NOW }), /touch log changed since you checked: the next step is now 2/);
  await assert.rejects(to.recordSend(client, { id: ID, channel: 'email', date: '2026-11-16', sender: 'pat', by: ' ', now: NOW }), /who recorded it/);
  await assert.rejects(to.recordSend(client, { id: 'nobody', channel: 'email', date: '2026-11-16', sender: 'pat', by: 'Pat', now: NOW }), /There is no account nobody/);
  assert.equal(touchLines(fake).length, 1, 'only the seeded letter');
  // A call can carry its time, in the recipient's time zone, so the guard can check calling hours; a time later than now is refused.
  const call = await to.sendInput({ channel: 'call', date: '2026-11-16', time: '08:30' }, { timezone: 'America/Chicago', now: NOW });
  assert.equal(call.when, '2026-11-16T14:30:00.000Z');
  await assert.rejects(to.sendInput({ channel: 'call', date: '2026-11-16', time: '11:00' }, { timezone: 'America/Chicago', now: NOW }), /later than now/);
  assert.equal((await to.sendInput({ channel: 'letter', date: '2026-11-16', time: '08:30' }, { timezone: 'America/Chicago', now: NOW })).when, '2026-11-16', 'only a call keeps a time');
});

test('the panel: the history newest first, what the due list says, and the guard\'s verdict for the touch about to be recorded', async () => {
  const { client } = setup({ touches: [letter, { type: 'touch', accountId: 'someone-else', institution: 'Other Bank', step: 1, channel: 'letter', sender: 'pat', date: '2026-11-12' }] });
  const t = await to.accountTouches(client, ID, { now: NOW });
  assert.deepEqual([t.sent, t.next], [1, { step: 2, channel: 'email' }]);
  assert.deepEqual(t.history.map((h) => [h.type, h.step, h.date]), [['touch', 1, '2026-11-10']], 'this account only');
  assert.deepEqual([t.due.state, t.due.step, t.due.channel], ['due', 2, 'email']);
  assert.deepEqual(t.proposal, { channel: 'email', date: '2026-11-16', time: '', sender: 'pat', step: 2, checked: false });
  assert.deepEqual([t.verdict.allowed, t.verdict.errors], [true, []]);
  assert.deepEqual(t.senders, [{ id: 'pat', name: 'Pat Example', ok: true }]);
  assert.deepEqual(t.optOut, { name: 'Jordan Sample', email: 'jordan@acmebank.test' });
  assert.ok(t.channels.includes('email') && !t.channels.includes('sms'));
  // A principal checks another choice first: the verdict is for exactly that touch, and shows the problem before recording.
  const checked = await to.accountTouches(client, ID, { now: NOW, check: { id: ID, channel: 'letter', date: '2026-11-15', sender: 'pat' } });
  assert.deepEqual([checked.proposal.channel, checked.proposal.date, checked.proposal.checked], ['letter', '2026-11-15', true]);
  assert.ok(checked.verdict.errors.some((e) => e.code === 'WRONG_CHANNEL'));
  // A check for another account, or one with a date after today, is not used.
  assert.equal((await to.accountTouches(client, ID, { now: NOW, check: { id: 'other', channel: 'letter', date: '2026-11-15', sender: 'pat' } })).proposal.checked, false);
  const stale = await to.accountTouches(client, ID, { now: NOW, check: { id: ID, channel: 'letter', date: '2026-11-30', sender: 'pat' } });
  assert.equal(stale.proposal.checked, false);
  assert.match(stale.checkProblem, /later than today/, 'the panel says why the check was not used');
  assert.equal(t.checkProblem, null);
  // After recording, the history shows it first.
  await to.recordSend(client, { id: ID, channel: 'email', date: '2026-11-16', sender: 'pat', step: '2', by: 'Pat Example', now: NOW });
  const after = await to.accountTouches(client, ID, { now: NOW });
  assert.deepEqual(after.history.map((h) => [h.step, h.channel, h.by ?? null]), [[2, 'email', 'Pat Example'], [1, 'letter', null]]);
  assert.equal(await to.accountTouches(client, 'nobody', { now: NOW }), null);
});

test('each event type is recorded with its date and who recorded it; replies, meetings and handoffs stop the sequence, a bounce stops email', async () => {
  for (const type of ['reply', 'bounce', 'meeting', 'handoff']) {
    const { fake, client } = setup({ touches: [letter] });
    const r = await to.recordEvent(client, { id: ID, type, date: '2026-11-15', note: 'asked for a call in January', by: 'Pat Example', now: NOW });
    assert.deepEqual([r.type, r.date, r.suppressed], [type, '2026-11-15', null]);
    const line = touchLines(fake).at(-1);
    assert.deepEqual([line.line.type, line.line.date, line.line.by, line.line.note, line.line.institution, line.by], [type, '2026-11-15', 'Pat Example', 'asked for a call in January', ACCOUNT.name, 'pat@example.test']);
    assert.deepEqual(auditLines(fake).map((a) => [a.type, a.event, a.by]), [['event', type, 'Pat Example']]);
    assert.equal(fake.docs.get('suppression.json').body.entries.length, 0, `a ${type} suppresses no one`);
    const t = await to.accountTouches(client, ID, { now: NOW });
    assert.ok(t.due.blockedBy.includes(type === 'bounce' ? 'EMAIL_BOUNCED' : 'SEQUENCE_STOPPED'), `${type}: ${t.due.blockedBy}`);
    assert.equal(t.history[0].type, type);
  }
});

test('an event is refused, and nothing is written, for a date after today, an unknown type, or a note that holds personal data', async () => {
  const { fake, client } = setup();
  await assert.rejects(to.recordEvent(client, { id: ID, type: 'reply', date: '2026-11-17', by: 'Pat', now: NOW }), /later than today/);
  await assert.rejects(to.recordEvent(client, { id: ID, type: 'shrug', date: '2026-11-16', by: 'Pat', now: NOW }), /Unknown event "shrug"/);
  await assert.rejects(to.recordEvent(client, { id: ID, type: 'reply', date: '2026-11-16', note: 'write to jordan@acmebank.test', by: 'Pat', now: NOW }), /personal data/);
  await assert.rejects(to.recordEvent(client, { id: ID, type: 'reply', date: '2026-11-16', note: 'call 555-010-0199', by: 'Pat', now: NOW }), /personal data/);
  await assert.rejects(to.recordEvent(client, { id: ID, type: 'reply', date: '2026-11-16', note: 'x'.repeat(201), by: 'Pat', now: NOW }), /200 characters/);
  await assert.rejects(to.recordEvent(client, { id: ID, type: 'reply', date: '2026-11-16', by: '', now: NOW }), /who recorded it/);
  assert.equal(touchLines(fake).length, 0);
  assert.equal(fake.lines.length, 0);
});

test('an opt-out needs a confirmation, then suppresses the person and the address at once; the guard refuses every later touch', async () => {
  const { fake, client } = setup({ touches: [letter] });
  await assert.rejects(to.recordEvent(client, { id: ID, type: 'opt_out', date: '2026-11-16', by: 'Pat Example', now: NOW }), /confirm/i);
  await assert.rejects(to.recordEvent(client, { id: ID, type: 'opt_out', date: '2026-11-16', by: 'Pat Example', confirmOptOut: 'yes', now: NOW }), /confirm/i);
  assert.equal(touchLines(fake).length, 1, 'nothing recorded without the confirmation');
  const r = await to.recordEvent(client, { id: ID, type: 'opt_out', date: '2026-11-16', by: 'Pat Example', confirmOptOut: true, now: NOW });
  assert.deepEqual(r.suppressed, { person: true, email: true });
  const entries = fake.docs.get('suppression.json').body.entries;
  assert.deepEqual(entries.map((e) => [e.type, e.value, e.reason, e.by]), [['email', 'jordan@acmebank.test', 'opt_out', 'Pat Example'], ['person', 'Jordan Sample', 'opt_out', 'Pat Example']]);
  assert.deepEqual(auditLines(fake).map((a) => [a.type, a.by]), [['suppress', 'Pat Example'], ['suppress', 'Pat Example'], ['event', 'Pat Example']]);
  const t = await to.accountTouches(client, ID, { now: NOW });
  for (const code of ['SEQUENCE_STOPPED', 'SUPPRESSED_EMAIL', 'SUPPRESSED_PERSON']) assert.ok(t.verdict.errors.some((e) => e.code === code), code);
  // A send recorded after the opt-out is still recorded (it happened), with the rules it broke; the suppression stays.
  const late = await to.recordSend(client, { id: ID, channel: 'email', date: '2026-11-16', sender: 'pat', by: 'Pat Example', now: NOW });
  assert.ok(late.violations.some((v) => v.code === 'SUPPRESSED_EMAIL'));
  assert.equal(fake.docs.get('suppression.json').body.entries.length, 2);
});

test('the account page shows the panel with one import and one element; the opt-out form needs its confirmation; the note says what it is not', () => {
  // The account page's sections are composed in account-record.jsx (docs/design-redesign.md, 5.5).
  const page = readFileSync(join(WEB, 'app', 'accounts', '[id]', 'account-record.jsx'), 'utf8');
  assert.match(page, /^import \{ Touches \} from '\.\/touches\.jsx';$/m);
  assert.equal((page.match(/<Touches /g) ?? []).length, 1);
  const panel = readFileSync(join(WEB, 'app', 'accounts', '[id]', 'touches.jsx'), 'utf8');
  const optOut = [...panel.matchAll(/<form action=\{recordOptOutAction\}[\s\S]*?<\/form>/g)].map((m) => m[0]);
  assert.equal(optOut.length, 1);
  assert.match(optOut[0], /name="confirm"[^>]*required/);
  assert.match(optOut[0], /suppresses/);
  assert.match(panel, /internal note/i);
  assert.match(panel, /never the reply's text/i);
  assert.doesNotMatch(panel, /<textarea/, 'no room for message text');
  assert.match(panel, /max=\{t\.today\}/, 'the date inputs stop at today');
});

test('review fix 1: a send is never recorded under a sender that is not in senders.json', async () => {
  const { fake, client } = setup();
  await assert.rejects(to.recordSend(client, { id: ID, channel: 'letter', date: '2026-11-16', sender: 'ghost', by: 'Pat Example', now: NOW }), /No sender "ghost"/);
  assert.equal(touchLines(fake).length, 0, 'nothing reaches the touch log');
});

test('review fix 2: an opt-out suppresses the address that opted out, which a principal confirms, not only the account\'s current person', async () => {
  const { fake, client } = setup();
  const r = await to.recordEvent(client, { id: ID, type: 'opt_out', date: '2026-11-16', by: 'Pat Example', confirmOptOut: true, optOutName: 'Riley Other', optOutEmail: 'Riley@AcmeBank.test', now: NOW });
  assert.deepEqual(r.suppressed, { person: true, email: true });
  const entries = fake.docs.get('suppression.json').body.entries;
  assert.ok(entries.some((e) => e.type === 'email' && e.value === 'riley@acmebank.test'), 'the address that opted out is suppressed');
  assert.ok(entries.some((e) => e.type === 'person' && e.value === 'Riley Other'), 'the person who opted out is suppressed');
  assert.ok(!entries.some((e) => e.value === 'jordan@acmebank.test' || e.value === 'Jordan Sample'), 'the account\'s current person is not suppressed for someone else\'s opt-out');
  await assert.rejects(to.recordEvent(client, { id: ID, type: 'opt_out', date: '2026-11-16', by: 'Pat Example', confirmOptOut: true, optOutEmail: 'not-an-address', now: NOW }), /not a valid email address/);
  // With nothing entered, the account's person is suppressed, as before.
  const { fake: f2, client: c2 } = setup();
  await to.recordEvent(c2, { id: ID, type: 'opt_out', date: '2026-11-16', by: 'Pat Example', confirmOptOut: true, now: NOW });
  assert.ok(f2.docs.get('suppression.json').body.entries.some((e) => e.value === 'jordan@acmebank.test'));
});

test('review fix 3: with an invalid time zone, a call keeps its date and drops the time, instead of reading the time as UTC', async () => {
  const { fake, client } = setup();
  seed(fake, `accounts/${ID}.json`, { ...ACCOUNT, person: { ...ACCOUNT.person, timezone: 'Mountain' } });
  // 14:55 local, five minutes before NOW (15:00Z): read as UTC it would be fine, but 16:30 read as UTC is later than now and was refused.
  const r = await to.recordSend(client, { id: ID, channel: 'call', date: '2026-11-16', time: '16:30', sender: 'pat', by: 'Pat Example', now: NOW });
  assert.equal(r.date, '2026-11-16');
  assert.ok(r.violations.some((v) => v.code === 'TIMEZONE_INVALID' || /zone/i.test(v.message)), 'the guard still reports the bad time zone');
});
