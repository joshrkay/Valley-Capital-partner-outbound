// The sender settings (src/senders.mjs): one rule, for the command line and the web app, for what a complete sender is and when sending
// is ready. Invented senders only; every folder is a throwaway one outside the repository.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { readSenders, validateSender, sendingReadiness, readinessIn, setSender, removeSender, SENDER_FIELDS } from '../src/senders.mjs';
import { LOADS, withUnitOfWork, snapshotFromDir } from '../src/uow.mjs';
import { readJson, readJsonl } from '../src/store.mjs';
import { makeDir, put, config, SENDER, REPO } from './kit.mjs';

const cfg = config();
const codes = (r) => r.errors.map((e) => e.code);
const TEMPLATE = { id: 'principal-1', name: '[CONFIRM: name]', title: '[CONFIRM: title]', phone: '[CONFIRM: phone]', address: '[CONFIRM: street address]', mailbox: '[CONFIRM: mailbox]' };

test('a complete sender passes; its values are trimmed and the mailbox lower-cased', () => {
  const r = validateSender({ ...SENDER, name: '  Pat Example ', mailbox: 'Pat@Example.TEST' }, { config: cfg });
  assert.deepEqual(r.errors, []);
  assert.equal(r.ok, true);
  assert.deepEqual([r.sender.name, r.sender.mailbox], ['Pat Example', 'pat@example.test']);
  assert.deepEqual(Object.keys(r.sender).sort(), [...SENDER_FIELDS].sort());
});

test('every field the guard requires must be filled, with no [CONFIRM] placeholder left', () => {
  const missing = validateSender({ id: 'pat', name: 'Pat Example' }, { config: cfg });
  assert.equal(missing.ok, false);
  assert.deepEqual(missing.errors.filter((e) => e.code === 'SENDER_FIELD_MISSING').map((e) => e.field).sort(), ['address', 'mailbox', 'phone', 'title']);
  const tmpl = validateSender(TEMPLATE, { config: cfg });
  assert.deepEqual(tmpl.errors.filter((e) => e.code === 'SENDER_PLACEHOLDER').map((e) => e.field).sort(), ['address', 'mailbox', 'name', 'phone', 'title']);
  assert.match(tmpl.errors[0].message, /\[CONFIRM\]/);
  assert.deepEqual(codes(validateSender({ ...SENDER, phone: 'call [confirm]' }, { config: cfg })), ['SENDER_PLACEHOLDER']);
  // The required fields are the guard's own (config.senderRequired), so a new required field is checked here too.
  const more = config(); more.senderRequired.letter.push('signature');
  assert.deepEqual(validateSender(SENDER, { config: more }).errors.map((e) => e.field), ['signature']);
});

test('the id is a safe id, and the mailbox a business address for a person: the guard\'s personal-domain and role checks', () => {
  assert.deepEqual(codes(validateSender({ ...SENDER, id: 'Pat Example' }, { config: cfg })), ['SENDER_ID_INVALID']);
  assert.deepEqual(codes(validateSender({ ...SENDER, id: '' }, { config: cfg })), ['SENDER_ID_INVALID']);
  assert.deepEqual(codes(validateSender({ ...SENDER, mailbox: 'not-an-address' }, { config: cfg })), ['SENDER_MAILBOX_INVALID']);
  const personal = validateSender({ ...SENDER, mailbox: 'pat@gmail.com' }, { config: cfg });
  assert.deepEqual(codes(personal), ['SENDER_MAILBOX_PERSONAL']);
  assert.match(personal.errors[0].message, /personal email domain/);
  assert.deepEqual(codes(validateSender({ ...SENDER, mailbox: 'info@example.test' }, { config: cfg })), ['SENDER_MAILBOX_ROLE']);
});

test('a street address is required (CAN-SPAM), and a phone number needs its digits', () => {
  const noAddr = validateSender({ ...SENDER, address: '' }, { config: cfg });
  assert.deepEqual(codes(noAddr), ['SENDER_FIELD_MISSING']);
  const vague = validateSender({ ...SENDER, address: 'Anytown' }, { config: cfg });
  assert.deepEqual(codes(vague), ['SENDER_ADDRESS_INVALID']);
  assert.match(vague.errors[0].message, /CAN-SPAM/);
  assert.equal(validateSender({ ...SENDER, address: 'PO Box 12, Anytown, ST 00000' }, { config: cfg }).ok, true);
  assert.deepEqual(codes(validateSender({ ...SENDER, phone: 'ask the office' }, { config: cfg })), ['SENDER_PHONE_INVALID']);
  assert.deepEqual(codes(validateSender({ ...SENDER, title: 'x'.repeat(201) }, { config: cfg })), ['SENDER_FIELD_TOO_LONG']);
});

test('readiness: at least one sender, every sender complete and valid, and the kill switch off (config, KILL file or environment)', () => {
  const ok = sendingReadiness({ senders: [SENDER], config: cfg, kill: false });
  assert.deepEqual([ok.ready, ok.killSwitch, ok.incomplete, ok.reasons], [true, false, [], []]);
  const none = sendingReadiness({ senders: [], config: cfg, kill: false });
  assert.equal(none.ready, false); assert.match(none.reasons.join(' '), /No sender/);
  const tmpl = sendingReadiness({ senders: [SENDER, TEMPLATE], config: cfg, kill: false });
  assert.deepEqual([tmpl.ready, tmpl.incomplete], [false, ['principal-1']]);
  assert.match(tmpl.reasons.join(' '), /principal-1/);
  const killed = sendingReadiness({ senders: [SENDER], config: cfg, kill: true });
  assert.deepEqual([killed.ready, killed.killSwitch], [false, true]);
  const c = config(); c.killSwitch = true;
  assert.equal(sendingReadiness({ senders: [SENDER], config: c, kill: false }).ready, false);
  // From a data folder: the KILL file and OUTBOUND_KILL count, as they do for the guard.
  const dir = makeDir(); put(dir, 'senders.json', { senders: [SENDER] });
  assert.equal(readinessIn({ dir, config: cfg, env: {} }).ready, true);
  assert.equal(readinessIn({ dir, config: cfg, env: { OUTBOUND_KILL: '1' } }).ready, false);
  put(dir, 'KILL', '');
  assert.equal(readinessIn({ dir, config: cfg, env: {} }).killSwitch, true);
});

test('adding and editing a sender: validated, written to senders.json, other keys kept, and audited with ids and field names only', () => {
  const dir = makeDir();
  put(dir, 'senders.json', { _note: 'Fill every field.', senders: [TEMPLATE] });
  assert.throws(() => setSender({ dir, sender: SENDER, by: ' ', config: cfg }), /who made the change/);
  assert.throws(() => setSender({ dir, sender: { ...SENDER, mailbox: 'pat@gmail.com' }, by: 'Pat Example', config: cfg }), /personal email domain/);
  const added = setSender({ dir, sender: SENDER, by: 'Pat Example', config: cfg, mode: 'add' });
  assert.deepEqual([added.created, added.sender.id], [true, 'pat']);
  assert.throws(() => setSender({ dir, sender: SENDER, by: 'Pat Example', config: cfg, mode: 'add' }), /already exists/);
  assert.throws(() => setSender({ dir, sender: { ...SENDER, id: 'nobody' }, by: 'Pat Example', config: cfg, mode: 'edit' }), /No sender "nobody"/);
  // Editing the template replaces its placeholders; a partial edit (the command line's) keeps the other fields.
  setSender({ dir, sender: { ...SENDER, id: 'principal-1', name: 'Sam Example', mailbox: 'sam@example.test' }, by: 'Pat Example', config: cfg, mode: 'edit' });
  const edited = setSender({ dir, sender: { id: 'pat', phone: '555-0101' }, by: 'Pat Example', config: cfg });
  assert.deepEqual([edited.created, edited.changed], [false, ['phone']]);
  const file = readJson(join(dir, 'senders.json'));
  assert.equal(file._note, 'Fill every field.');
  assert.deepEqual(file.senders.map((s) => s.id), ['principal-1', 'pat']);
  assert.deepEqual([file.senders[1].phone, file.senders[1].address], ['555-0101', SENDER.address]);
  assert.deepEqual(readSenders(dir).map((s) => s.id), ['principal-1', 'pat']);
  const aud = readJsonl(join(dir, 'audit.jsonl'));
  assert.deepEqual(aud.map((a) => [a.type, a.senderId, a.by]), [['sender_added', 'pat', 'Pat Example'], ['sender_updated', 'principal-1', 'Pat Example'], ['sender_updated', 'pat', 'Pat Example']]);
  assert.deepEqual(aud[2].fields, ['phone']);
  const text = readFileSync(join(dir, 'audit.jsonl'), 'utf8');
  for (const v of ['Sam Example', 'sam@example.test', SENDER.address, SENDER.mailbox, '555-0101']) assert.equal(text.includes(v), false, `the audit log holds ${v}`);
});

test('removing a sender is refused once a recorded touch names it; an unused one is removed, and audited', () => {
  const dir = makeDir();
  put(dir, 'senders.json', { senders: [SENDER, { ...SENDER, id: 'sam', name: 'Sam Example', mailbox: 'sam@example.test' }] });
  put(dir, 'touches.jsonl', `${JSON.stringify({ type: 'touch', accountId: 'acme-bank', step: 1, channel: 'letter', sender: 'pat', date: '2026-11-10' })}\n`);
  assert.throws(() => removeSender({ dir, id: 'pat', by: 'Pat Example' }), /1 recorded touch.*names this sender/);
  assert.throws(() => removeSender({ dir, id: 'nobody', by: 'Pat Example' }), /No sender "nobody"/);
  assert.throws(() => removeSender({ dir, id: 'sam', by: '' }), /who made the change/);
  assert.deepEqual(removeSender({ dir, id: 'sam', by: 'Pat Example' }), { id: 'sam' });
  assert.deepEqual(readSenders(dir).map((s) => s.id), ['pat']);
  const aud = readJsonl(join(dir, 'audit.jsonl'));
  assert.deepEqual(aud.map((a) => [a.type, a.senderId, a.by]), [['sender_removed', 'sam', 'Pat Example']]);
});

test('the load lists are narrow: settings read senders.json and the KILL document; removal also reads the touch log', async () => {
  assert.deepEqual([...LOADS.senders].sort(), ['KILL', 'senders.json']);
  assert.deepEqual([...LOADS.senderRemove].sort(), ['KILL', 'senders.json', 'touches.jsonl']);
  const dir = makeDir();
  put(dir, 'senders.json', { senders: [SENDER] });
  put(dir, 'accounts/acme-bank.json', { id: 'acme-bank' });
  let plan;
  const flush = async (p) => { plan = p; };
  const r = await withUnitOfWork({ load: async (pre) => snapshotFromDir(dir, pre), flush }, LOADS.senders, (root) => {
    setSender({ dir: root, sender: { ...SENDER, id: 'sam', mailbox: 'sam@example.test' }, by: 'Pat Example', config: cfg });
    return readinessIn({ dir: root, config: cfg, env: {} });
  });
  assert.equal(r.result.ready, true);
  assert.deepEqual(plan.docs.map((d) => d.path), ['senders.json']);
  await assert.rejects(withUnitOfWork({ load: async (pre) => snapshotFromDir(dir, pre), flush }, LOADS.senders, (root) => removeSender({ dir: root, id: 'pat', by: 'Pat' })), /"touches.jsonl" was not loaded/);
});

test('the command line: senders list, set and remove share the rule; status reports readiness the same way', () => {
  const data = makeDir();
  const env = { ...process.env, OUTBOUND_DATA_DIR: data, OUTBOUND_KILL: '' };
  const cli = (...args) => execFileSync(process.execPath, [join(REPO, 'cli.mjs'), ...args], { env, encoding: 'utf8', stdio: 'pipe' });
  const fails = (args, re) => assert.throws(() => cli(...args), (e) => re.test(String(e.stderr)));
  cli('init');
  let status = JSON.parse(cli('status'));
  assert.deepEqual([status.readyToSend, status.sendersIncomplete], [false, ['principal-1']]);
  assert.ok(status.notReadyBecause.some((r) => /principal-1/.test(r)));
  fails(['senders', 'set', '--id', 'principal-1', '--mailbox', 'pat@gmail.com', '--by', 'Pat Example'], /personal email domain/);
  cli('senders', 'set', '--id', 'principal-1', '--name', 'Pat Example', '--title', 'Principal', '--phone', '555-0100', '--address', '1 Example Way, Anytown, ST 00000', '--mailbox', 'pat@example.test', '--by', 'Pat Example');
  status = JSON.parse(cli('status'));
  assert.deepEqual([status.readyToSend, status.sendersIncomplete, status.notReadyBecause], [true, [], undefined]);
  assert.match(cli('senders', 'list'), /principal-1[\s\S]*complete[\s\S]*Ready to send: yes/);
  fails(['senders', 'remove', '--id', 'principal-1'], /--by is required/);
  cli('senders', 'remove', '--id', 'principal-1', '--by', 'Pat Example');
  assert.match(cli('senders', 'list'), /No sender yet[\s\S]*Ready to send: no/);
});
