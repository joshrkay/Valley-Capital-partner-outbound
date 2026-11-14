// The account page's contact section (PRD E7-S3), through web/lib/ops.mjs, against the repository's fake Supabase REST API. The engine's
// own functions run in units of work as the signed-in principal. No network: the MX lookup goes to a fake resolver. Invented data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakePostgrest } from '../../test/postgrest-fake.mjs';
import { platformClient } from '../../src/platform/client.mjs';
import * as ops from '../lib/ops.mjs';
import * as ro from '../lib/routes-ops.mjs';

const URL_ = 'https://example-project.supabase.test';
const WEB = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MX = async () => [{ exchange: 'mx1.alphabank.test', priority: 10 }];
const NO_MX = async () => { const e = new Error('queryMx ENOTFOUND'); e.code = 'ENOTFOUND'; throw e; };
const SITE = { kind: 'institution_site', url: 'https://alphabank.test/leadership' };
const seed = (fake, path, body) => fake.docs.set(path, { path, kind: 'json', body, text: null, version: 1 });

function setup() {
  const fake = fakePostgrest();
  const client = platformClient({ url: URL_, key: 'anon-key', accessToken: 'user:pat@example.test', fetchImpl: fake.fetchImpl });
  seed(fake, 'accounts/alpha-bank.json', { id: 'alpha-bank', name: 'Alpha Bank', aliases: [], type: 'bank', person: { name: '', title: '', email: '' }, contact: { emailStatus: 'unverified', roleConfirmed: false, provenance: [] }, domains: [] });
  seed(fake, 'research/alpha-bank.json', { account: 'alpha-bank', date: '2026-11-10', mode: 'institution', findings: [{ id: 'F1', kind: 'person', claim: 'Morgan Example is the chief credit officer.', quote: 'Morgan Example, Chief Credit Officer', source_url: 'https://alphabank.test/leadership', source_title: 'Leadership' }] });
  return { fake, client };
}

test('naming the person, the address and the domain run the engine\'s own functions, each with a source; the section shows them', async () => {
  const { fake, client } = setup();
  await assert.rejects(ops.setPerson(client, { id: 'alpha-bank', name: 'Morgan Example', title: 'Chief Credit Officer', by: 'Pat', source: {} }), /Where the name came from is required/);
  await ops.setPerson(client, { id: 'alpha-bank', name: 'Morgan Example', title: 'Chief Credit Officer', by: 'Pat', source: { findingId: 'F1' } });
  const added = await ops.addDomain(client, { id: 'alpha-bank', domain: 'alphabank.test', by: 'Pat', source: SITE });
  assert.deepEqual(added.sharedWith, []);
  await ops.setEmail(client, { id: 'alpha-bank', email: 'morgan@alphabank.test', by: 'Pat', source: SITE });
  assert.equal((await ops.accountContact(client, 'alpha-bank')).status.email.state, 'unverified');
  const bad = await ops.verifyEmail(client, { id: 'alpha-bank', by: 'Pat', method: 'principal_known', resolveMx: NO_MX });
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.checks.filter((c) => !c.ok).map((c) => c.id), ['mx']);
  const good = await ops.verifyEmail(client, { id: 'alpha-bank', by: 'Pat', method: 'institution_site', url: 'https://alphabank.test/leadership', resolveMx: MX });
  assert.equal(good.ok, true);
  const c = await ops.accountContact(client, 'alpha-bank');
  assert.deepEqual([c.status.email.state, c.status.fields.name.findingId, c.status.fields.email.url, c.status.domains.map((d) => d.domain)], ['verified', 'F1', 'https://alphabank.test/leadership', ['alphabank.test']]);
  assert.deepEqual(c.candidates.map((x) => x.id), ['F1']);
  assert.deepEqual(c.vendors, []);
  assert.ok(['person_set', 'domain_added', 'email_set', 'email_verify_failed', 'email_verified'].every((t) => fake.lines.some((l) => l.path === 'audit.jsonl' && l.line.type === t && l.by === 'pat@example.test')));
  assert.equal(await ops.accountContact(client, 'nobody'), null);
  await assert.rejects(ops.accountContact(client, '../etc'), /Invalid id/);
});

test('forgetting a person from the web: the account\'s name typed to confirm; every store scrubbed; the touch log redacted through the platform', async () => {
  const { fake, client } = setup();
  await ops.setPerson(client, { id: 'alpha-bank', name: 'Morgan Example', by: 'Pat', source: { findingId: 'F1' } });
  await ops.addDomain(client, { id: 'alpha-bank', domain: 'alphabank.test', by: 'Pat', source: SITE });
  await ops.setEmail(client, { id: 'alpha-bank', email: 'morgan@alphabank.test', by: 'Pat', source: SITE });
  await client.flush({ docs: [], lines: [{ path: 'touches.jsonl', line: { type: 'reply', accountId: 'alpha-bank', institution: 'Alpha Bank', date: '2026-11-11', note: 'Morgan Example asked us to call in January' } }] });
  // The firm knows them (the network), and the account's routes name them (the direct route).
  seed(fake, 'network/network.json', { version: 1, seq: 1, people: { 'np-1': { id: 'np-1', name: 'Morgan Example', organization: 'Alpha Bank', title: '', relationship: 'met at a conference', knownBy: ['Pat'], introConsent: 'unknown', aliases: [], addedBy: 'Pat', addedAt: '2026-11-01T00:00:00.000Z' } }, firms: {}, memberships: {} });
  await ro.buildAccountRoutes(client, { id: 'alpha-bank' });
  assert.match(JSON.stringify(fake.docs.get('routes/alpha-bank.json').body), /Morgan Example/);
  await assert.rejects(ops.forgetPerson(client, { id: 'alpha-bank', by: 'Pat', reason: 'asked to be removed', confirm: 'alpha' }), /type the account's name/);
  const r = await ops.forgetPerson(client, { id: 'alpha-bank', by: 'Pat', reason: 'asked to be removed', confirm: 'Alpha Bank' });
  assert.deepEqual([r.counts.touches, r.counts.routes, r.counts.network], [1, 2, 1]);
  assert.deepEqual(fake.docs.get('network/network.json').body.people, {});
  const everything = JSON.stringify([...fake.docs.values(), ...fake.lines]);
  assert.doesNotMatch(everything, /morgan/i, 'no document or log line holds the person');
  assert.equal(fake.lines.find((l) => l.path === 'touches.jsonl').line.type, 'reply', 'the reply still stops the sequence');
  assert.ok(fake.docs.get('suppression.json').body.entries.some((e) => e.type === 'person' && e.reason === 'deletion_request' && e.hashes.length));
  const line = fake.lines.find((l) => l.line.type === 'person_forgotten');
  assert.deepEqual([line.line.accountId, line.line.by, line.by], ['alpha-bank', 'Pat', 'pat@example.test']);
  // Re-adding them is refused by the engine.
  await assert.rejects(ops.setPerson(client, { id: 'alpha-bank', name: 'Morgan Example', by: 'Pat', source: { kind: 'principal_known' } }), /suppressed/);
});

test('the only form that names the person is the contact section\'s, which carries its source fields; the older one is gone', () => {
  const src = (f) => readFileSync(join(WEB, 'app', 'accounts', f), 'utf8');
  const page = src('[id]/page.jsx'), contact = src('[id]/contact.jsx'), actions = src('actions.js');
  assert.doesNotMatch(page, /setPersonAction|Set person/, 'the account page has no form of its own to name the person');
  const forms = [...contact.matchAll(/<form action=\{setPersonAction\}[\s\S]*?<\/form>/g)].map((m) => m[0]);
  assert.equal(forms.length, 1);
  assert.match(forms[0], /<SourceFields /, 'it records where the name came from');
  assert.doesNotMatch(actions, /fd\.has\('source'\)/, 'no special case is left for a form without source fields');
});

test('a database without the redaction migration is refused before anything is scrubbed', async () => {
  const { fake } = setup();
  const legacy = async (url, init) => (String(url).endsWith('rpc/flush_uow') ? new Response(JSON.stringify({ written: 0, appended: 0 }), { status: 200 }) : fake.fetchImpl(url, init));
  const client = platformClient({ url: URL_, key: 'anon-key', accessToken: 'user:pat@example.test', fetchImpl: legacy });
  const before = JSON.stringify([...fake.docs.values()]);
  await assert.rejects(ops.forgetPerson(client, { id: 'alpha-bank', by: 'Pat', reason: 'asked', confirm: 'Alpha Bank' }), /redaction migration/);
  assert.equal(JSON.stringify([...fake.docs.values()]), before);
});
