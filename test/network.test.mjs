// PRD E22-S1: the firm's network. The principals' own relationships, kept in the data folder only, entered by a principal, with audit
// lines that carry ids and never a name. All names are invented.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { makeDir } from './kit.mjs';
import { readJson } from '../src/store.mjs';
import { addPerson, addFirm, addMembership, listNetwork, readNetwork, networkPath, personKey, firmKey, entryOf } from '../src/network.mjs';

const NOW = new Date('2026-11-14T12:00:00Z');
const auditText = (dir) => (existsSync(join(dir, 'audit.jsonl')) ? readFileSync(join(dir, 'audit.jsonl'), 'utf8') : '');

test('names are compared in a normal form: case, punctuation, "&", legal suffixes, honorifics and middle initials do not matter', () => {
  assert.equal(firmKey('Sample & Sample, L.L.P.'), firmKey('sample and sample llp'));
  assert.equal(firmKey('The Example Grove Partners LLP'), 'example grove partners');
  assert.equal(firmKey('Acme Community Bank, N.A.'), firmKey('Acme Community Bank'));
  assert.equal(firmKey('Example & Co.'), 'example');
  assert.notEqual(firmKey('Example Law'), firmKey('Example Law Group'), 'no fuzzy matching: a different name is a different firm');
  assert.equal(personKey('Dr. Casey Q. Example, Jr.'), personKey('casey example'));
  assert.equal(personKey("Riley O'Counsel"), 'riley ocounsel');
  assert.equal(personKey('Casey'), '', 'one word is too little to match a person on');
});

test('a principal adds people, firms and memberships; each gets an id with no name in it, and the file lives in the data folder', () => {
  const dir = makeDir();
  const p = addPerson({ dir, name: 'Avery Invented', organization: 'Sample & Sample LLP', title: 'Partner', relationship: 'former colleague', knownBy: 'Pat Example, Lee Example', by: 'Pat Example', now: NOW });
  const f = addFirm({ dir, name: 'Example Grove Partners LLP', kind: 'law', relationship: 'our counsel on two deals', knownBy: 'Lee Example', aliases: ['EGP'], by: 'Lee Example', now: NOW });
  const m = addMembership({ dir, association: 'CRE Finance Council', principal: 'Pat Example', aliases: ['CREFC'], by: 'Pat Example', now: NOW });
  assert.deepEqual([p.id, f.id, m.id], ['np-1', 'nf-2', 'nm-3']);
  assert.deepEqual(p.knownBy, ['Pat Example', 'Lee Example']);
  assert.equal(p.introConsent, 'unknown', 'consent is unknown until a principal records it');
  assert.equal(f.kind, 'law');
  assert.equal(m.role, 'member');
  assert.ok(existsSync(networkPath(dir)));
  assert.equal(networkPath(dir), join(dir, 'network', 'network.json'));
  const net = readNetwork(dir);
  assert.deepEqual(Object.keys(net.people), ['np-1']);
  assert.deepEqual(entryOf(net, 'nf-2'), { kind: 'firm', entry: net.firms['nf-2'] });
  assert.equal(entryOf(net, 'np-9'), null);
});

test('every field is checked: a name, who knows them, a known consent and firm kind; no email address or phone number anywhere', () => {
  const dir = makeDir();
  const base = { dir, name: 'Avery Invented', organization: 'Sample & Sample LLP', knownBy: 'Pat Example', by: 'Pat Example', now: NOW };
  assert.throws(() => addPerson({ ...base, name: ' ' }), /name is required/);
  assert.throws(() => addPerson({ ...base, knownBy: '' }), /which principal knows them/);
  assert.throws(() => addPerson({ ...base, by: '' }), /--by/);
  assert.throws(() => addPerson({ ...base, introConsent: 'maybe' }), /yes, no or unknown/);
  assert.throws(() => addPerson({ ...base, relationship: 'reach at avery@example.test' }), /no email address or phone number/);
  assert.throws(() => addPerson({ ...base, title: 'cell 555 010 0199' }), /no email address or phone number/);
  assert.throws(() => addPerson({ ...base, relationship: 'desk 555-0100' }), /no email address or phone number/);
  assert.throws(() => addPerson({ ...base, aliases: ['(555) 010-0199'] }), /no email address or phone number/);
  // Years are not phone numbers.
  assert.equal(addPerson({ ...base, name: 'Jamie Invented', relationship: 'worked together 2015-2019, then 2021 to 2024' }).id, 'np-1');
  assert.throws(() => addFirm({ dir, name: 'Example Grove Partners LLP', kind: 'bakery', knownBy: 'Pat Example', by: 'Pat Example' }), /law, advisor, broker or other/);
  assert.throws(() => addMembership({ dir, association: 'CRE Finance Council', principal: '', by: 'Pat Example' }), /which principal belongs/);
  assert.deepEqual(Object.keys(readNetwork(dir).people), ['np-1'], 'only the valid entry was written');
});

test('a duplicate is refused, naming the entry that already holds it', () => {
  const dir = makeDir();
  addPerson({ dir, name: 'Avery Invented', organization: 'Sample & Sample LLP', knownBy: 'Pat Example', by: 'Pat Example', now: NOW });
  assert.throws(() => addPerson({ dir, name: 'avery  invented', organization: 'Sample and Sample, L.L.P.', knownBy: 'Lee Example', by: 'Lee Example', now: NOW }), /already in the network as np-1/);
  addPerson({ dir, name: 'Avery Invented', organization: 'Another Invented Firm', knownBy: 'Lee Example', by: 'Lee Example', now: NOW });   // same name, another firm: a different person
  addFirm({ dir, name: 'Example Grove Partners LLP', knownBy: 'Pat Example', by: 'Pat Example', now: NOW });
  assert.throws(() => addFirm({ dir, name: 'The Example Grove Partners', knownBy: 'Pat Example', by: 'Pat Example', now: NOW }), /already in the network as nf-3/);
  addMembership({ dir, association: 'CRE Finance Council', principal: 'Pat Example', by: 'Pat Example', now: NOW });
  assert.throws(() => addMembership({ dir, association: 'CRE Finance Council', principal: 'Pat Example', by: 'Lee Example', now: NOW }), /already in the network as nm-4/);
});

test('audit lines carry ids, kinds and counts only, never a name from the network; listing is audited too', () => {
  const dir = makeDir();
  addPerson({ dir, name: 'Avery Invented', organization: 'Sample & Sample LLP', title: 'Partner', relationship: 'former colleague', knownBy: 'Pat Example', by: 'Pat Example', now: NOW });
  addFirm({ dir, name: 'Example Grove Partners LLP', knownBy: 'Pat Example', by: 'Pat Example', now: NOW });
  addMembership({ dir, association: 'CRE Finance Council', principal: 'Pat Example', by: 'Pat Example', now: NOW });
  const l = listNetwork({ dir, by: 'Lee Example', now: NOW });
  assert.deepEqual([l.people.length, l.firms.length, l.memberships.length], [1, 1, 1]);
  assert.deepEqual(l.uses, {}, 'no chosen route uses any entry yet');
  assert.throws(() => listNetwork({ dir, by: '' }), /--by/);
  const lines = auditText(dir).split('\n').filter(Boolean).map((x) => JSON.parse(x));
  assert.deepEqual(lines.map((x) => x.type), ['network_added', 'network_added', 'network_added', 'network_viewed']);
  assert.deepEqual(lines.map((x) => x.id ?? null), ['np-1', 'nf-2', 'nm-3', null]);
  for (const leak of ['Avery', 'Invented', 'Sample', 'Grove', 'Finance', 'colleague', 'Partner']) assert.ok(!auditText(dir).includes(leak), `audit leaked "${leak}"`);
  assert.equal(readJson(networkPath(dir)).people['np-1'].addedBy, 'Pat Example');
});
