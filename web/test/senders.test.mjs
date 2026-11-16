// The Senders page (web/lib/senders-ops.mjs) against the repository's fake Supabase REST API: the engine's own rule (src/senders.mjs), run
// in a unit of work as the signed-in principal. Invented senders only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakePostgrest } from '../../test/postgrest-fake.mjs';
import { platformClient, pathFilter } from '../../src/platform/client.mjs';
import { LOADS } from '../../src/uow.mjs';
import * as so from '../lib/senders-ops.mjs';

const URL_ = 'https://example-project.supabase.test';
const WEB = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SENDER = { id: 'pat', name: 'Pat Example', title: 'Principal', phone: '555-0100', address: '1 Example Way, Anytown, ST 00000', mailbox: 'pat@example.test' };
const TEMPLATE = { id: 'principal-1', name: '[CONFIRM: name]', title: '[CONFIRM: title]', phone: '[CONFIRM: phone]', address: '[CONFIRM: street address]', mailbox: '[CONFIRM: mailbox]' };
const seed = (fake, path, body) => fake.docs.set(path, { path, kind: 'json', body, text: null, version: 1 });

function setup() {
  const fake = fakePostgrest();
  const client = platformClient({ url: URL_, key: 'anon-key', accessToken: 'user:pat@example.test', fetchImpl: fake.fetchImpl });
  return { fake, client };
}

test('the page lists each sender with its check, and readiness by the rule `outbound status` uses, the kill switch included', async () => {
  const { fake, client } = setup();
  let o = await so.sendersOverview(client);
  assert.deepEqual([o.senders, o.readiness.ready], [[], false]);
  assert.match(o.readiness.reasons.join(' '), /No sender/);
  seed(fake, 'senders.json', { _note: 'Fill every field.', senders: [TEMPLATE] });
  o = await so.sendersOverview(client);
  assert.deepEqual(o.senders.map((s) => [s.id, s.ok]), [['principal-1', false]]);
  assert.ok(o.senders[0].errors.every((e) => e.code === 'SENDER_PLACEHOLDER'));
  assert.deepEqual([o.readiness.ready, o.readiness.incomplete], [false, ['principal-1']]);
  // Editing the template with real values makes sending ready; the KILL document stops it again.
  await so.saveSender(client, { mode: 'edit', sender: { ...SENDER, id: 'principal-1' }, by: 'Pat Example' });
  o = await so.sendersOverview(client);
  assert.deepEqual([o.senders[0].ok, o.readiness.ready, o.readiness.killSwitch], [true, true, false]);
  assert.equal(fake.docs.get('senders.json').body._note, 'Fill every field.');
  fake.docs.set('KILL', { path: 'KILL', kind: 'text', body: null, text: '', version: 1 });
  o = await so.sendersOverview(client);
  assert.deepEqual([o.readiness.ready, o.readiness.killSwitch], [false, true]);
  assert.match(o.readiness.reasons.join(' '), /kill switch is on/);
  // Only senders.json and the KILL document were read.
  const loads = fake.calls.filter((c) => c.method === 'GET' && c.path === 'documents').map((c) => c.query.or);
  assert.ok(loads.every((or) => or === pathFilter(LOADS.senders)));
});

test('adding and editing: every required field, no [CONFIRM], a business mailbox for a person, a street address; audited with ids only', async () => {
  const { fake, client } = setup();
  await assert.rejects(so.saveSender(client, { mode: 'add', sender: { ...SENDER, mailbox: 'pat@yahoo.com' }, by: 'Pat Example' }), /personal email domain/);
  await assert.rejects(so.saveSender(client, { mode: 'add', sender: { ...SENDER, mailbox: 'office@example.test' }, by: 'Pat Example' }), /role address/);
  await assert.rejects(so.saveSender(client, { mode: 'add', sender: { ...SENDER, address: '' }, by: 'Pat Example' }), /street address is required/);
  await assert.rejects(so.saveSender(client, { mode: 'add', sender: { ...SENDER, address: 'Downtown' }, by: 'Pat Example' }), /CAN-SPAM/);
  await assert.rejects(so.saveSender(client, { mode: 'add', sender: { ...SENDER, title: '[CONFIRM: title]' }, by: 'Pat Example' }), /\[CONFIRM\] placeholder/);
  await assert.rejects(so.saveSender(client, { mode: 'add', sender: SENDER, by: '' }), /who made the change/);
  await assert.rejects(so.saveSender(client, { mode: 'rename', sender: SENDER, by: 'Pat' }), /add or edit/);
  assert.equal(fake.docs.has('senders.json'), false, 'nothing written');
  const r = await so.saveSender(client, { mode: 'add', sender: SENDER, by: 'Pat Example' });
  assert.deepEqual([r.id, r.created], ['pat', true]);
  await assert.rejects(so.saveSender(client, { mode: 'add', sender: SENDER, by: 'Pat Example' }), /already exists/);
  const e = await so.saveSender(client, { mode: 'edit', sender: { ...SENDER, title: 'Managing Principal' }, by: 'Pat Example' });
  assert.deepEqual([e.created, e.changed], [false, ['title']]);
  assert.equal(fake.docs.get('senders.json').body.senders[0].title, 'Managing Principal');
  const audit = fake.lines.filter((l) => l.path === 'audit.jsonl');
  assert.deepEqual(audit.map((l) => [l.line.type, l.line.senderId, l.line.by, l.by]), [['sender_added', 'pat', 'Pat Example', 'pat@example.test'], ['sender_updated', 'pat', 'Pat Example', 'pat@example.test']]);
  const text = JSON.stringify(audit.map((l) => l.line));   // the lines themselves; the row's own `by` column is the session's email
  for (const v of [SENDER.mailbox, SENDER.address, SENDER.phone, 'Managing Principal']) assert.equal(text.includes(v), false, `an audit line holds ${v}`);
});

test('removing: refused while a recorded touch names the sender; an unused sender is removed and audited', async () => {
  const { fake, client } = setup();
  seed(fake, 'senders.json', { senders: [SENDER, { ...SENDER, id: 'sam', name: 'Sam Example', mailbox: 'sam@example.test' }] });
  fake.lines.push({ id: 1, path: 'touches.jsonl', line: { type: 'touch', accountId: 'acme-bank', step: 1, channel: 'letter', sender: 'pat', date: '2026-11-10' }, by: 'pat@example.test' });
  await assert.rejects(so.removeSender(client, { id: 'pat', by: 'Pat Example' }), /1 recorded touch names this sender/);
  assert.deepEqual(await so.removeSender(client, { id: 'sam', by: 'Pat Example' }), { id: 'sam' });
  assert.deepEqual(fake.docs.get('senders.json').body.senders.map((s) => s.id), ['pat']);
  assert.deepEqual(fake.lines.filter((l) => l.path === 'audit.jsonl').map((l) => [l.line.type, l.line.senderId, l.line.by]), [['sender_removed', 'sam', 'Pat Example']]);
  await assert.rejects(so.removeSender(client, { id: '../x', by: 'Pat' }), /Invalid id/);
});

test('the nav links the Senders page; the page has add, edit and remove forms and states the readiness', () => {
  const layout = readFileSync(join(WEB, 'app', 'layout.jsx'), 'utf8');
  assert.match(layout, /<a href="\/senders">Senders<\/a>/);
  const page = readFileSync(join(WEB, 'app', 'senders', 'page.jsx'), 'utf8');
  for (const a of ['addSenderAction', 'editSenderAction', 'removeSenderAction']) assert.match(page, new RegExp(`action=\\{${a}\\}`));
  assert.match(page, /Ready to send/);
});
