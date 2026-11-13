import test from 'node:test';
import assert from 'node:assert/strict';
import { symlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { checkTouch, recordTouch, recordEvent, addSuppression, loadContext, dueList, touchFromAccount } from '../src/guard.mjs';
import { dataDir, insideRepo, REPO } from '../src/paths.mjs';
import { readJson, readJsonl } from '../src/store.mjs';
import { makeDir, put, config, account, ctxWith, touch, sent, SENDER } from './kit.mjs';

const A = account();
const codes = (r) => r.errors.map((e) => e.code);
const blocked = (r, code) => assert.ok(codes(r).includes(code), `expected ${code}, got ${JSON.stringify(codes(r))}`);

test('a complete, ordinary first touch is allowed and reports the next step', () => {
  const r = checkTouch(touch(A), ctxWith());
  assert.deepEqual(codes(r), []);
  assert.equal(r.allowed, true);
  assert.deepEqual([r.next.step, r.next.channel], [1, 'letter']);
});

test('banned channels are refused with the reason', () => {
  for (const ch of ['ai_voice', 'ringless_voicemail', 'sms', 'whatsapp', 'auto_dialer']) {
    const r = checkTouch(touch(A, { channel: ch }), ctxWith());
    blocked(r, 'CHANNEL_BANNED');
    assert.ok(r.errors.find((e) => e.code === 'CHANNEL_BANNED').message.length > 20);
  }
  blocked(checkTouch(touch(A, { channel: 'carrier_pigeon' }), ctxWith()), 'CHANNEL_UNKNOWN');
});

test('the kill switch stops everything: config, environment, or a KILL file', () => {
  const cfg = config(); cfg.killSwitch = true;
  blocked(checkTouch(touch(A), ctxWith({ cfg })), 'KILL_SWITCH');
  blocked(checkTouch(touch(A), ctxWith({ kill: true })), 'KILL_SWITCH');
  const dir = makeDir(); put(dir, 'KILL', '');
  blocked(checkTouch(touch(A), loadContext({ dir, config: config(), env: {} })), 'KILL_SWITCH');
  blocked(checkTouch(touch(A), loadContext({ dir: makeDir(), config: config(), env: { OUTBOUND_KILL: '1' } })), 'KILL_SWITCH');
});

test('an incomplete sender block blocks the touch, including a [CONFIRM] placeholder', () => {
  blocked(checkTouch(touch(A), ctxWith({ senders: [] })), 'SENDER_UNKNOWN');
  blocked(checkTouch(touch(A), ctxWith({ senders: [{ ...SENDER, address: '' }] })), 'SENDER_INCOMPLETE');
  blocked(checkTouch(touch(A), ctxWith({ senders: [{ ...SENDER, phone: '[CONFIRM: phone]' }] })), 'SENDER_INCOMPLETE');
  blocked(checkTouch(touch(A, { channel: 'email', step: 2 }), ctxWith({ senders: [{ ...SENDER, mailbox: undefined }] })), 'SENDER_INCOMPLETE');
});

test('suppression: email, domain, person, institution (and its aliases), and an asset named in the text', () => {
  const sup = (e) => ctxWith({ suppression: [e] });
  blocked(checkTouch(touch(A, { channel: 'email', step: 2 }), sup({ type: 'email', value: 'Jordan@AcmeBank.test', reason: 'opt_out' })), 'SUPPRESSED_EMAIL');
  blocked(checkTouch(touch(A, { channel: 'email', step: 2 }), sup({ type: 'domain', value: 'acmebank.test', reason: 'NDA' })), 'SUPPRESSED_DOMAIN');
  blocked(checkTouch(touch(A), sup({ type: 'person', value: 'jordan  sample', reason: 'asked not to be contacted' })), 'SUPPRESSED_PERSON');
  blocked(checkTouch(touch(A), sup({ type: 'institution', value: 'Acme Community Bank', reason: 'active process' })), 'SUPPRESSED_INSTITUTION');
  blocked(checkTouch(touch(A), sup({ type: 'institution', value: 'Parent Holdings', aliases: ['Acme Bancorp', 'Acme Community Bank'], reason: 'affiliate of NDA party' })), 'SUPPRESSED_INSTITUTION');
  blocked(checkTouch(touch(A, { text: 'We looked at the Harbor View Hotel recently.' }), sup({ type: 'asset', value: 'Harbor View Hotel', reason: 'bid' })), 'SUPPRESSED_ASSET_NAMED');
  assert.deepEqual(codes(checkTouch(touch(A, { text: 'No names here.' }), sup({ type: 'asset', value: 'Harbor View Hotel', reason: 'bid' }))), []);
});

test('contact quality: personal domains, role addresses, unverified or bounced email, no provenance, unconfirmed role', () => {
  const em = (email, extra = {}) => touch(A, { channel: 'email', step: 2, person: { ...A.person, email }, ...extra });
  const ctx = ctxWith({ touches: [sent(A.id, 1, 'letter', '2026-11-10')] });
  blocked(checkTouch(em('jordan@gmail.com'), ctx), 'PERSONAL_EMAIL');
  blocked(checkTouch(em('info@acmebank.test'), ctx), 'ROLE_EMAIL');
  blocked(checkTouch(em('not-an-address'), ctx), 'EMAIL_MISSING');
  blocked(checkTouch(em('jordan@acmebank.test', { contact: { ...A.contact, emailStatus: 'unverified' } }), ctx), 'EMAIL_UNVERIFIED');
  blocked(checkTouch(em('jordan@acmebank.test', { contact: { ...A.contact, provenance: [] } }), ctx), 'NO_PROVENANCE');
  blocked(checkTouch(em('jordan@acmebank.test', { contact: { ...A.contact, roleConfirmed: false } }), ctx), 'ROLE_UNCONFIRMED');
  blocked(checkTouch(em('jordan@acmebank.test'), ctxWith({ touches: [sent(A.id, 1, 'letter', '2026-11-10'), { type: 'bounce', accountId: A.id, date: '2026-11-11' }] })), 'EMAIL_BOUNCED');
});

test('calls: business landlines only, in local weekday hours, with the time zone known', () => {
  const ctx = ctxWith({ touches: [sent(A.id, 1, 'letter', '2026-11-02'), sent(A.id, 2, 'email', '2026-11-05'), sent(A.id, 3, 'linkedin_note', '2026-11-09')] });
  const call = (over = {}, personOver = {}) => touch(A, { channel: 'call', step: 4, date: '2026-11-17T20:30:00Z', person: { ...A.person, ...personOver }, ...over });   // 2:30pm Tuesday in Chicago
  assert.deepEqual(codes(checkTouch(call(), ctx)), []);
  blocked(checkTouch(call({}, { phoneType: 'mobile' }), ctx), 'PHONE_NOT_BUSINESS_LINE');
  blocked(checkTouch(call({}, { phoneType: undefined }), ctx), 'PHONE_NOT_BUSINESS_LINE');
  blocked(checkTouch(call({}, { phone: '' }), ctx), 'PHONE_MISSING');
  blocked(checkTouch(call({}, { timezone: '' }), ctx), 'TIMEZONE_MISSING');
  blocked(checkTouch(call({}, { timezone: 'Mars/Olympus' }), ctx), 'TIMEZONE_INVALID');
  blocked(checkTouch(call({ date: '2026-11-17' }), ctx), 'CALL_TIME_REQUIRED');
  blocked(checkTouch(call({ date: '2026-11-17T13:00:00Z' }), ctx), 'OUTSIDE_CALL_HOURS');   // 7am in Chicago
  blocked(checkTouch(call({ date: '2026-11-21T20:30:00Z' }), ctx), 'OUTSIDE_CALL_HOURS');   // Saturday
});

test('caps: first touches per sender per week, emails per day, touches per account per 90 days, minimum gap', () => {
  const cfg = config(); cfg.caps.firstTouchesPerSenderPerWeek = 2;
  const first = [sent('a1', 1, 'letter', '2026-11-14'), sent('a2', 1, 'letter', '2026-11-15')];
  blocked(checkTouch(touch(A), ctxWith({ cfg, touches: first })), 'CAP_FIRST_TOUCHES_WEEK');
  assert.deepEqual(codes(checkTouch(touch(A, { date: '2026-11-23' }), ctxWith({ cfg, touches: first }))), []);   // the week has rolled over

  const cfg2 = config(); cfg2.caps.emailsPerSenderPerDay = 1;
  const ctx2 = ctxWith({ cfg: cfg2, touches: [sent(A.id, 1, 'letter', '2026-11-10'), sent('other', 2, 'email', '2026-11-16')] });
  blocked(checkTouch(touch(A, { channel: 'email', step: 2, date: '2026-11-16' }), ctx2), 'CAP_EMAIL_DAY');

  const cfg3 = config(); cfg3.caps.touchesPerAccountPer90Days = 1;
  blocked(checkTouch(touch(A, { channel: 'email', step: 2, date: '2026-11-20' }), ctxWith({ cfg: cfg3, touches: [sent(A.id, 1, 'letter', '2026-11-10')] })), 'CAP_ACCOUNT_90D');

  blocked(checkTouch(touch(A, { channel: 'email', step: 2, date: '2026-11-11' }), ctxWith({ touches: [sent(A.id, 1, 'letter', '2026-11-10')] })), 'TOO_SOON');
});

test('the sequence: the right step, the right channel, once due; and it ends', () => {
  const one = ctxWith({ touches: [sent(A.id, 1, 'letter', '2026-11-10')] });
  blocked(checkTouch(touch(A, { channel: 'email', step: 2, date: '2026-11-12' }), one), 'NOT_DUE');       // due 11-13
  assert.deepEqual(codes(checkTouch(touch(A, { channel: 'email', step: 2, date: '2026-11-13' }), one)), []);
  blocked(checkTouch(touch(A, { channel: 'email', step: 3, date: '2026-11-20' }), one), 'WRONG_STEP');
  blocked(checkTouch(touch(A, { channel: 'call', step: 2, date: '2026-11-20T20:30:00Z' }), one), 'WRONG_CHANNEL');
  const all = ['letter', 'email', 'linkedin_note', 'call', 'email'].map((c, i) => sent(A.id, i + 1, c, `2026-0${i + 1}-01`));
  blocked(checkTouch(touch(A, { channel: 'email', step: 6, date: '2026-12-01' }), ctxWith({ touches: all })), 'SEQUENCE_COMPLETE');
});

test('a reply, opt-out, meeting or handoff stops the sequence for good', () => {
  for (const type of ['reply', 'opt_out', 'meeting', 'handoff']) {
    const ctx = ctxWith({ touches: [sent(A.id, 1, 'letter', '2026-11-01'), { type, accountId: A.id, date: '2026-11-05' }] });
    blocked(checkTouch(touch(A, { channel: 'email', step: 2, date: '2026-11-20' }), ctx), 'SEQUENCE_STOPPED');
  }
});

test('recording: logs a touch without its text, refuses a blocked one, and writes an audit line either way', () => {
  const dir = makeDir();
  put(dir, 'senders.json', { senders: [SENDER] });
  const ctx = loadContext({ dir, config: config(), env: {} });
  const rec = recordTouch(dir, touch(A, { text: 'SECRET BODY' }), ctx);
  assert.equal(rec.step, 1);
  const log = readJsonl(join(dir, 'touches.jsonl'));
  assert.equal(log.length, 1);
  assert.equal(JSON.stringify(log).includes('SECRET BODY'), false);
  assert.throws(() => recordTouch(dir, touch(A, { channel: 'email', step: 2, date: '2026-11-16' }), ctx), /TOO_SOON|NOT_DUE/);
  const aud = readJsonl(join(dir, 'audit.jsonl'));
  assert.deepEqual(aud.map((a) => a.allowed), [true, false]);
});

test('an opt-out suppresses the person and the address immediately, and persists', () => {
  const dir = makeDir();
  put(dir, 'senders.json', { senders: [SENDER] });
  const ctx = loadContext({ dir, config: config(), env: {} });
  recordEvent(dir, { accountId: A.id, type: 'opt_out', date: '2026-11-18', person: A.person }, ctx);
  const saved = readJson(join(dir, 'suppression.json'), { entries: [] }).entries;
  assert.deepEqual(saved.map((e) => e.type).sort(), ['email', 'person']);
  blocked(checkTouch(touch(A, { channel: 'email', step: 2, date: '2026-12-01' }), ctx), 'SUPPRESSED_EMAIL');
  assert.throws(() => recordEvent(dir, { accountId: A.id, type: 'shrug' }, ctx), /Unknown event/);
  assert.throws(() => addSuppression(dir, { type: 'nonsense', value: 'x' }, ctx), /Unknown suppression type/);
});

test('due list: shows what is due, what is blocked and why, and what is finished', () => {
  const b = account({ id: 'b-bank', name: 'B Bank', contact: { emailStatus: 'verified', roleConfirmed: false, provenance: [{ source: 's' }] } });
  const done = account({ id: 'c-bank', name: 'C Bank' });
  const ctx = ctxWith({ touches: ['letter', 'email', 'linkedin_note', 'call', 'email'].map((c, i) => sent('c-bank', i + 1, c, `2026-0${i + 1}-01`)) });
  const list = dueList([A, b, done], ctx, { date: '2026-11-16', sender: 'pat' });
  assert.equal(list.find((x) => x.accountId === 'acme-bank').state, 'due');
  assert.deepEqual([list.find((x) => x.accountId === 'b-bank').state, list.find((x) => x.accountId === 'b-bank').blockedBy], ['blocked', ['ROLE_UNCONFIRMED']]);
  assert.equal(list.find((x) => x.accountId === 'c-bank').state, 'sequence_complete');
  assert.equal(touchFromAccount(A, { channel: 'letter', step: 1, date: 'd', sender: 'pat' }).institution, 'Acme Community Bank');
});

test('the data rule: the data directory must be set and must be outside the repository, even through a symlink', () => {
  assert.throws(() => dataDir({}), /OUTBOUND_DATA_DIR is not set/);
  assert.throws(() => dataDir({ OUTBOUND_DATA_DIR: join(REPO, 'outbound', 'data') }), /inside the repository/);
  assert.throws(() => dataDir({ OUTBOUND_DATA_DIR: REPO }), /inside the repository/);
  const outside = makeDir();
  const link = join(outside, 'sneaky');
  symlinkSync(join(REPO, 'docs'), link);
  assert.throws(() => dataDir({ OUTBOUND_DATA_DIR: join(link, 'x') }), /inside the repository/);
  assert.equal(insideRepo(outside), false);
  mkdirSync(join(outside, 'ok'));
  assert.ok(dataDir({ OUTBOUND_DATA_DIR: join(outside, 'ok') }).endsWith('ok'));
});

test('institution-wide: a reply from anyone at a bank stops outreach to everyone there; a stop at another bank does not', () => {
  const reply = { type: 'reply', accountId: 'acme-bank-sa', institution: 'Acme Community Bank', date: '2026-11-05' };
  blocked(checkTouch(touch(A, { date: '2026-11-16' }), ctxWith({ touches: [reply] })), 'SEQUENCE_STOPPED');
  assert.deepEqual(codes(checkTouch(touch(A), ctxWith({ touches: [{ ...reply, institution: 'Other Bank' }] }))), []);
});

test('one person at a time per institution: a colleague touched recently blocks a new sequence until the quiet period ends; gaps count the whole bank', () => {
  const other = { type: 'touch', accountId: 'acme-bank-sa', institution: 'Acme Community Bank', step: 1, channel: 'letter', sender: 'pat', date: '2026-10-20' };
  blocked(checkTouch(touch(A, { date: '2026-11-16' }), ctxWith({ touches: [other] })), 'OTHER_CONTACT_ACTIVE');   // 27 days later
  assert.deepEqual(codes(checkTouch(touch(A, { date: '2026-12-05' }), ctxWith({ touches: [other] }))), []);        // 46 days later
  const cfg = config(); cfg.caps.institutionOneAtATimeDays = 0; cfg.caps.minGapDays = 5;
  blocked(checkTouch(touch(A, { date: '2026-10-22' }), ctxWith({ cfg, touches: [other] })), 'TOO_SOON');
});

test('recorded touches and events carry the institution, so the rules above can see them', () => {
  const dir = makeDir(); put(dir, 'senders.json', { senders: [SENDER] });
  const ctx = loadContext({ dir, config: config(), env: {} });
  recordTouch(dir, touch(A, { date: '2026-11-16' }), ctx);
  recordEvent(dir, { accountId: A.id, institution: A.name, type: 'reply', date: '2026-11-18' }, ctx);
  assert.deepEqual(readJsonl(join(dir, 'touches.jsonl')).map((l) => l.institution), [A.name, A.name]);
});
