// The person on an account (PRD E7-S1): one module for the command line and the web app.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { makeDir, put, account } from './kit.mjs';
import { readJson } from '../src/store.mjs';
import { setPerson, confirmRole } from '../src/accounts.mjs';

test('naming a person resets their role to unconfirmed, and is audited', () => {
  const dir = makeDir();
  put(dir, 'accounts/acme-bank.json', account());   // the kit account has a confirmed role
  const a = setPerson({ dir, id: 'acme-bank', name: 'Robin Sample', title: 'Head of Special Assets', by: 'Pat Example' });
  assert.deepEqual([a.person.name, a.person.title, a.contact.roleConfirmed], ['Robin Sample', 'Head of Special Assets', false]);
  assert.equal(readJson(join(dir, 'accounts', 'acme-bank.json')).contact.roleConfirmed, false);
  assert.match(readFileSync(join(dir, 'audit.jsonl'), 'utf8'), /"type":"person_set","accountId":"acme-bank","by":"Pat Example"/);
});

test('a role is confirmed only for a named person, by a named principal', () => {
  const dir = makeDir();
  put(dir, 'accounts/acme-bank.json', account({ person: { name: '' }, contact: { roleConfirmed: false } }));
  assert.throws(() => confirmRole({ dir, id: 'acme-bank', by: 'Pat' }), /no named person yet/);
  setPerson({ dir, id: 'acme-bank', name: 'Robin Sample', by: 'Pat' });
  assert.throws(() => confirmRole({ dir, id: 'acme-bank' }), /is required/);
  const a = confirmRole({ dir, id: 'acme-bank', by: 'Pat', now: new Date('2026-11-13T12:00:00Z') });
  assert.deepEqual([a.contact.roleConfirmed, a.contact.roleConfirmedBy, a.contact.roleConfirmedAt], [true, 'Pat', '2026-11-13T12:00:00.000Z']);
});

test('bad input is refused plainly', () => {
  const dir = makeDir();
  assert.throws(() => setPerson({ dir, id: '../x', name: 'A', by: 'B' }), /Invalid id/);
  assert.throws(() => setPerson({ dir, id: 'nobody', name: 'A', by: 'B' }), /No account "nobody"/);
  put(dir, 'accounts/acme-bank.json', account());
  assert.throws(() => setPerson({ dir, id: 'acme-bank', name: '  ', by: 'B' }), /name is required/);
});
