// The person on an account (PRD E7-S1) and their contact details (PRD E7-S3): one module for the command line and the web app.
// Invented names and .test domains only. No network: every MX lookup goes to a fake resolver.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { makeDir, put, account, config, REPO } from './kit.mjs';
import { readJson, readJsonl } from '../src/store.mjs';
import { setPerson, confirmRole, setEmail, setPhone, setAddress, addDomain, verifyEmail, contactStatus, emailSyntaxOk } from '../src/accounts.mjs';
import { emailHashes, personHashes } from '../src/guard.mjs';

const NOW = new Date('2026-11-14T12:00:00Z');
const RESEARCH = {
  account: 'acme-bank', date: '2026-11-10', mode: 'institution',
  findings: [
    { id: 'F1', kind: 'person', claim: 'Robin Sample leads special assets at the bank.', quote: 'Robin Sample, Head of Special Assets', source_url: 'https://acmebank.test/leadership', source_title: 'Leadership', publisher: 'Acme Community Bank', published: '2026-09-01' },
    { id: 'F2', kind: 'intent', claim: 'The bank plans to reduce its office loans.', quote: 'we intend to reduce office exposure', source_url: 'https://acmebank.test/q3', source_title: 'Q3 letter', publisher: 'Acme Community Bank', published: '2026-10-20' },
    { id: 'F3', kind: 'person', claim: 'Casey Example is the chief credit officer.', quote: 'Casey Example, Chief Credit Officer', source_url: 'https://acmebank.test/leadership', source_title: 'Leadership', publisher: 'Acme Community Bank', published: '2026-09-01' },
  ],
};
const MX = async () => [{ exchange: 'mx1.acmebank.test', priority: 10 }];
const NO_MX = async () => { const e = new Error('queryMx ENOTFOUND'); e.code = 'ENOTFOUND'; throw e; };
const SITE = { kind: 'institution_site', url: 'https://acmebank.test/leadership' };

// A promoted account with no person yet, its institution brief, and the bank's own domain confirmed.
function fresh({ domains = true } = {}) {
  const dir = makeDir();
  put(dir, 'accounts/acme-bank.json', account({ person: { name: '', title: '', email: '', phone: '', phoneType: '', timezone: '', mailingAddress: '' }, contact: { emailStatus: 'unverified', roleConfirmed: false, provenance: [] }, domains: [] }));
  put(dir, 'research/acme-bank.json', RESEARCH);
  if (domains) addDomain({ dir, id: 'acme-bank', domain: 'acmebank.test', by: 'Pat Example', source: SITE, config: config(), now: NOW });
  return dir;
}
const acct = (dir) => readJson(join(dir, 'accounts', 'acme-bank.json'));
const named = (dir) => { setPerson({ dir, id: 'acme-bank', name: 'Robin Sample', title: 'Head of Special Assets', by: 'Pat Example', source: { findingId: 'F1' }, now: NOW }); return dir; };
const withEmail = (dir, email = 'robin.sample@acmebank.test') => { setEmail({ dir, id: 'acme-bank', email, by: 'Pat Example', source: SITE, config: config(), now: NOW }); return dir; };

test('naming a person needs a source: a brief finding gives the URL and date; every field set records it; the role resets; audited without the name', () => {
  const dir = fresh();
  const a = setPerson({ dir, id: 'acme-bank', name: 'Robin Sample', title: 'Head of Special Assets', by: 'Pat Example', source: { findingId: 'F1' }, now: NOW });
  assert.deepEqual([a.person.name, a.person.title, a.contact.roleConfirmed], ['Robin Sample', 'Head of Special Assets', false]);
  const p = acct(dir).contact.provenance;
  assert.deepEqual(p.map((x) => x.field).sort(), ['name', 'title']);
  for (const x of p) assert.deepEqual([x.kind, x.findingId, x.url, x.seenOn, x.by], ['brief_finding', 'F1', 'https://acmebank.test/leadership', '2026-11-10', 'Pat Example']);
  const line = readJsonl(join(dir, 'audit.jsonl')).find((l) => l.type === 'person_set');
  assert.deepEqual([line.accountId, line.by, line.source], ['acme-bank', 'Pat Example', 'brief_finding']);
  assert.ok(!JSON.stringify(line).includes('Robin'), 'the audit line holds no name');
});

test('a brief finding as the source must exist, be a person finding, and name the person', () => {
  const dir = fresh();
  const set = (name, source) => setPerson({ dir, id: 'acme-bank', name, by: 'Pat', source, now: NOW });
  assert.throws(() => set('Robin Sample', { findingId: 'F9' }), /No finding "F9"/);
  assert.throws(() => set('Robin Sample', { findingId: 'F2' }), /not a person finding/);
  assert.throws(() => set('Robin Sample', { findingId: 'F3' }), /does not name Robin Sample/);
  const bare = makeDir(); put(bare, 'accounts/acme-bank.json', account());
  assert.throws(() => setPerson({ dir: bare, id: 'acme-bank', name: 'Robin Sample', by: 'Pat', source: { findingId: 'F1' } }), /no research brief/);
  assert.equal(set('Casey Example', { findingId: 'F3' }).person.name, 'Casey Example');
});

test('other sources: the bank\'s own site needs a web address; known to a principal needs nothing; a vendor needs a recorded pass', () => {
  const dir = fresh();
  const set = (source) => setPerson({ dir, id: 'acme-bank', name: 'Robin Sample', by: 'Pat', source, now: NOW });
  assert.throws(() => set(undefined), /Where the name came from is required/);
  assert.throws(() => set({ kind: 'institution_site' }), /needs the page's web address/);
  assert.throws(() => set({ kind: 'institution_site', url: 'ftp://acmebank.test/x' }), /web address/);
  assert.throws(() => set({ kind: 'rumour' }), /Unknown source "rumour"/);
  assert.throws(() => set({ kind: 'vendor', vendor: 'Contact Co' }), /has no recorded pass/);
  assert.throws(() => set({ kind: 'principal_known', seenOn: '2027-01-01' }), /in the future/);
  assert.equal(set({ kind: 'principal_known' }).contact.provenance[0].kind, 'principal_known');
  put(dir, 'contacts/vendors.json', { passes: { 'contact-co': { vendor: 'Contact Co', passed: true, by: 'Pat', at: '2026-11-13T00:00:00Z' } } });
  const v = set({ kind: 'vendor', vendor: 'Contact Co' });
  assert.deepEqual([v.contact.provenance[0].kind, v.contact.provenance[0].vendor], ['vendor', 'contact-co']);
  assert.equal(set({ url: 'https://acmebank.test/team' }).contact.provenance[0].kind, 'institution_site', 'a web address alone means the bank\'s own site');
});

test('naming a different person clears the old one\'s address, phone and verification; renaming the same person keeps them', async () => {
  const dir = withEmail(named(fresh()));
  setPhone({ dir, id: 'acme-bank', phone: '555-0142', phoneType: 'landline', timezone: 'America/Chicago', by: 'Pat', source: SITE, now: NOW });
  await verifyEmail({ dir, id: 'acme-bank', by: 'Pat', method: 'institution_site', url: 'https://acmebank.test/leadership', config: config(), resolveMx: MX, now: NOW });
  let a = setPerson({ dir, id: 'acme-bank', name: 'Robin  Sample', title: 'EVP, Special Assets', by: 'Pat', source: { findingId: 'F1' }, now: NOW });
  assert.deepEqual([a.person.email, a.person.phone, a.contact.emailStatus], ['robin.sample@acmebank.test', '555-0142', 'verified'], 'the same person: details kept');
  a = setPerson({ dir, id: 'acme-bank', name: 'Casey Example', by: 'Pat', source: { findingId: 'F3' }, now: NOW });
  assert.deepEqual([a.person.email, a.person.phone, a.person.phoneType, a.contact.emailStatus, a.contact.verification], ['', '', '', 'unverified', null]);
  assert.deepEqual(a.contact.provenance.map((x) => x.field), ['name']);
});

test('a role is confirmed only for a named person, by a named principal', () => {
  const dir = fresh();
  assert.throws(() => confirmRole({ dir, id: 'acme-bank', by: 'Pat' }), /no named person yet/);
  named(dir);
  assert.throws(() => confirmRole({ dir, id: 'acme-bank' }), /is required/);
  const a = confirmRole({ dir, id: 'acme-bank', by: 'Pat', now: new Date('2026-11-13T12:00:00Z') });
  assert.deepEqual([a.contact.roleConfirmed, a.contact.roleConfirmedBy, a.contact.roleConfirmedAt], [true, 'Pat', '2026-11-13T12:00:00.000Z']);
});

test('bad input is refused plainly', () => {
  const dir = makeDir();
  assert.throws(() => setPerson({ dir, id: '../x', name: 'A', by: 'B', source: SITE }), /Invalid id/);
  assert.throws(() => setPerson({ dir, id: 'nobody', name: 'A', by: 'B', source: SITE }), /No account "nobody"/);
  put(dir, 'accounts/acme-bank.json', account());
  assert.throws(() => setPerson({ dir, id: 'acme-bank', name: '  ', by: 'B', source: SITE }), /name is required/);
  assert.throws(() => setPerson({ dir, id: 'acme-bank', name: 'Robin Sample', source: SITE }), /--by/);
});

test('setting an address records its source and resets it to unverified; a personal, role or malformed address is refused', async () => {
  const dir = named(fresh());
  assert.throws(() => setEmail({ dir, id: 'acme-bank', email: 'robin@gmail.com', by: 'Pat', source: SITE, config: config() }), /personal email domain/);
  assert.throws(() => setEmail({ dir, id: 'acme-bank', email: 'info@acmebank.test', by: 'Pat', source: SITE, config: config() }), /role address/);
  assert.throws(() => setEmail({ dir, id: 'acme-bank', email: 'robin@@acmebank', by: 'Pat', source: SITE, config: config() }), /not a valid email address/);
  assert.throws(() => setEmail({ dir, id: 'acme-bank', email: 'robin@acmebank.test', by: 'Pat', config: config() }), /Where the address came from is required/);
  withEmail(dir, 'Robin.Sample@AcmeBank.test');
  await verifyEmail({ dir, id: 'acme-bank', by: 'Pat', method: 'principal_known', config: config(), resolveMx: MX, now: NOW });
  assert.equal(acct(dir).contact.emailStatus, 'verified');
  const a = withEmail(dir, 'rsample@acmebank.test') && acct(dir);
  assert.deepEqual([a.person.email, a.contact.emailStatus, a.contact.verification], ['rsample@acmebank.test', 'unverified', null], 'a new address starts unverified');
  const src = a.contact.provenance.find((x) => x.field === 'email');
  assert.deepEqual([src.value, src.kind, src.url], ['rsample@acmebank.test', 'institution_site', 'https://acmebank.test/leadership']);
  const empty = fresh();
  assert.throws(() => setEmail({ dir: empty, id: 'acme-bank', email: 'robin@acmebank.test', by: 'Pat', source: SITE, config: config() }), /no named person/);
});

test('a phone and a mailing address are set with their sources too', () => {
  const dir = named(fresh());
  assert.throws(() => setPhone({ dir, id: 'acme-bank', phone: '555-0142', phoneType: 'cell', by: 'Pat', source: SITE }), /phone type/);
  assert.throws(() => setPhone({ dir, id: 'acme-bank', phone: '555-0142', phoneType: 'landline', timezone: 'Mars/Olympus', by: 'Pat', source: SITE }), /not a valid time zone/);
  setPhone({ dir, id: 'acme-bank', phone: '555-0142', phoneType: 'landline', timezone: 'America/Chicago', by: 'Pat', source: SITE, now: NOW });
  setAddress({ dir, id: 'acme-bank', address: '10 Main St, Anytown', by: 'Pat', source: { kind: 'correspondence', seenOn: '2026-11-01' }, now: NOW });
  const a = acct(dir);
  assert.deepEqual([a.person.phone, a.person.phoneType, a.person.timezone, a.person.mailingAddress], ['555-0142', 'landline', 'America/Chicago', '10 Main St, Anytown']);
  assert.deepEqual(a.contact.provenance.map((x) => `${x.field}:${x.kind}`).sort(), ['mailingAddress:correspondence', 'name:brief_finding', 'phone:institution_site', 'title:brief_finding']);
});

test('domains: a principal confirms each with a source; a personal or malformed domain is refused; one another account holds is flagged', () => {
  const dir = fresh({ domains: false });
  assert.throws(() => addDomain({ dir, id: 'acme-bank', domain: 'gmail.com', by: 'Pat', source: SITE, config: config() }), /personal email domain/);
  assert.throws(() => addDomain({ dir, id: 'acme-bank', domain: 'not a domain', by: 'Pat', source: SITE, config: config() }), /not a valid domain/);
  assert.throws(() => addDomain({ dir, id: 'acme-bank', domain: 'acmebank.test', by: 'Pat', config: config() }), /Where the domain came from is required/);
  const r = addDomain({ dir, id: 'acme-bank', domain: 'AcmeBank.TEST', by: 'Pat Example', source: SITE, config: config(), now: NOW });
  assert.deepEqual(r.account.domains.map((d) => [d.domain, d.kind, d.url, d.confirmedBy]), [['acmebank.test', 'institution_site', 'https://acmebank.test/leadership', 'Pat Example']]);
  assert.deepEqual(r.sharedWith, []);
  assert.throws(() => addDomain({ dir, id: 'acme-bank', domain: 'acmebank.test', by: 'Pat', source: SITE, config: config() }), /already/);
  put(dir, 'accounts/acme-holdings.json', account({ id: 'acme-holdings', name: 'Acme Holdings', domains: [{ domain: 'acmeholdings.test' }] }));
  const shared = addDomain({ dir, id: 'acme-bank', domain: 'acmeholdings.test', by: 'Pat', source: { kind: 'principal_known' }, config: config(), now: NOW });
  assert.deepEqual(shared.sharedWith, ['acme-holdings'], 'a shared domain is flagged for a principal (E9-S3)');
  assert.ok(readJsonl(join(dir, 'audit.jsonl')).some((l) => l.type === 'domain_added' && l.accountId === 'acme-bank' && l.shared === 1));
});

test('verifying an address: every check passes and a principal attests how they know it', async () => {
  const dir = withEmail(named(fresh()));
  const lookups = [];
  const r = await verifyEmail({ dir, id: 'acme-bank', by: 'Pat Example', method: 'institution_site', url: 'https://acmebank.test/leadership', config: config(), resolveMx: async (d) => { lookups.push(d); return MX(d); }, now: NOW });
  assert.equal(r.ok, true, JSON.stringify(r.checks));
  assert.deepEqual(r.checks.map((c) => [c.id, c.ok]), [['syntax', true], ['sourced', true], ['business', true], ['domain', true], ['mx', true], ['suppression', true]]);
  assert.deepEqual(lookups, ['acmebank.test'], 'one DNS lookup, of the domain only');
  const v = acct(dir).contact;
  assert.equal(v.emailStatus, 'verified');
  assert.deepEqual([v.verification.email, v.verification.method, v.verification.url, v.verification.by, v.verification.verifiedOn], ['robin.sample@acmebank.test', 'institution_site', 'https://acmebank.test/leadership', 'Pat Example', '2026-11-14']);
  const line = readJsonl(join(dir, 'audit.jsonl')).find((l) => l.type === 'email_verified');
  assert.deepEqual([line.accountId, line.method, line.by], ['acme-bank', 'institution_site', 'Pat Example']);
  assert.ok(!JSON.stringify(line).includes('robin'), 'the audit line holds no address');
});

test('verifying fails on any check, leaves the address unverified, and says which check failed', async () => {
  const attempt = async (dir, over = {}) => verifyEmail({ dir, id: 'acme-bank', by: 'Pat', method: 'principal_known', config: config(), resolveMx: MX, now: NOW, ...over });
  const failed = (r) => r.checks.filter((c) => !c.ok).map((c) => c.id);
  const handEdited = (email) => { const dir = withEmail(named(fresh())); const a = acct(dir); a.person.email = email; a.contact.provenance.find((x) => x.field === 'email').value = email; put(dir, 'accounts/acme-bank.json', a); return dir; };
  assert.deepEqual(failed(await attempt(handEdited('robin..sample@acmebank.test'))), ['syntax']);
  assert.deepEqual(failed(await attempt(handEdited('robin@gmail.com'))), ['business', 'domain']);
  assert.deepEqual(failed(await attempt(handEdited('sales@acmebank.test'))), ['business']);
  assert.deepEqual(failed(await attempt(withEmail(named(fresh({ domains: false }))))), ['domain']);
  assert.deepEqual(failed(await attempt(withEmail(named(fresh())), { resolveMx: NO_MX })), ['mx']);
  assert.deepEqual(failed(await attempt(withEmail(named(fresh())), { resolveMx: async () => [{ exchange: '', priority: 0 }] })), ['mx'], 'a null MX record says the domain takes no mail');
  const unsourced = withEmail(named(fresh())); const u = acct(unsourced); u.contact.provenance = u.contact.provenance.filter((x) => x.field !== 'email'); put(unsourced, 'accounts/acme-bank.json', u);
  assert.deepEqual(failed(await attempt(unsourced)), ['sourced']);
  // A failed re-check revokes an earlier verification.
  const dir = withEmail(named(fresh()));
  assert.equal((await attempt(dir)).ok, true);
  const again = await attempt(dir, { resolveMx: NO_MX });
  assert.equal(again.ok, false);
  assert.deepEqual([acct(dir).contact.emailStatus, acct(dir).contact.verification], ['unverified', null]);
  assert.ok(readJsonl(join(dir, 'audit.jsonl')).some((l) => l.type === 'email_verify_failed' && l.failed.includes('mx')));
  const subdomain = withEmail(named(fresh()), 'robin@mail.acmebank.test');
  assert.equal((await attempt(subdomain)).ok, true, 'a subdomain of a confirmed domain counts');
});

test('the attestation: the bank\'s own site needs its URL; a vendor needs a recorded pass; correspondence and known need no URL', async () => {
  const dir = withEmail(named(fresh()));
  const go = (over) => verifyEmail({ dir, id: 'acme-bank', by: 'Pat', config: config(), resolveMx: MX, now: NOW, ...over });
  await assert.rejects(go({ method: 'institution_site' }), /needs the page's web address/);
  await assert.rejects(go({ method: 'guess' }), /Unknown method "guess"/);
  await assert.rejects(go({ method: undefined }), /How you know the address is required/);
  await assert.rejects(go({ method: 'vendor', vendor: 'Contact Co' }), /has no recorded pass/);
  await assert.rejects(go({ method: 'principal_known', by: '' }), /--by/);
  put(dir, 'contacts/vendors.json', { passes: { 'contact-co': { vendor: 'Contact Co', passed: true, by: 'Pat', at: '2026-11-13T00:00:00Z' } } });
  assert.equal((await go({ method: 'vendor', vendor: 'Contact Co' })).ok, true);
  assert.equal((await go({ method: 'correspondence', seen: '2026-11-02' })).ok, true);
  assert.equal(acct(dir).contact.verification.seenOn, '2026-11-02');
});

test('with requireMx off, the lookup is skipped and recorded as skipped (decision D-C3)', async () => {
  const dir = withEmail(named(fresh()));
  const cfg = config(); cfg.contacts.requireMx = false;
  const r = await verifyEmail({ dir, id: 'acme-bank', by: 'Pat', method: 'principal_known', config: cfg, resolveMx: () => { throw new Error('should not be called'); }, now: NOW });
  assert.equal(r.ok, true);
  assert.equal(acct(dir).contact.verification.checks.mx, 'skipped');
});

test('no mail server is ever contacted: the contact modules use a DNS MX lookup and nothing else', () => {
  for (const f of ['src/accounts.mjs', 'src/forget.mjs', 'src/vendors.mjs']) {
    const src = readFileSync(join(REPO, f), 'utf8');
    for (const bad of [/node:net/, /node:tls/, /\bsmtp\b/i, /\bRCPT\b/, /createConnection/, /\bfetch\(/, /node:http/]) assert.doesNotMatch(src, bad, `${f} must not ${bad}`);
  }
  assert.match(readFileSync(join(REPO, 'src/accounts.mjs'), 'utf8'), /from 'node:dns'/);
});

test('a suppressed person or address cannot be named or verified again', async () => {
  const dir = fresh();
  put(dir, 'suppression.json', { entries: [
    { type: 'person', hashes: personHashes('Robin Sample', ['Acme Community Bank']), reason: 'deletion_request' },
    { type: 'email', hashes: emailHashes('casey@acmebank.test'), reason: 'deletion_request' },
  ] });
  assert.throws(() => setPerson({ dir, id: 'acme-bank', name: 'Robin Sample', by: 'Pat', source: { findingId: 'F1' } }), /suppressed/);
  setPerson({ dir, id: 'acme-bank', name: 'Casey Example', by: 'Pat', source: { findingId: 'F3' }, now: NOW });
  assert.throws(() => setEmail({ dir, id: 'acme-bank', email: 'Casey@AcmeBank.test', by: 'Pat', source: SITE, config: config() }), /suppressed/);
  put(dir, 'suppression.json', { entries: [{ type: 'email', value: 'casey@acmebank.test', reason: 'opt_out' }] });
  assert.throws(() => setEmail({ dir, id: 'acme-bank', email: 'casey@acmebank.test', by: 'Pat', source: SITE, config: config() }), /suppressed/);
});

test('the contact view: verified, expired, verified for another address, unverified, and each field\'s source', async () => {
  const dir = withEmail(named(fresh()));
  await verifyEmail({ dir, id: 'acme-bank', by: 'Pat', method: 'principal_known', config: config(), resolveMx: MX, now: NOW });
  const a = acct(dir);
  const days = config().contacts.reverifyDays;
  assert.equal(contactStatus(a, { config: config(), now: NOW }).email.state, 'verified');
  assert.equal(contactStatus(a, { config: config(), now: new Date(NOW.getTime() + (days + 1) * 86400000) }).email.state, 'expired');
  const other = structuredClone(a); other.person.email = 'robin2@acmebank.test';
  assert.equal(contactStatus(other, { config: config(), now: NOW }).email.state, 'other_address');
  // Verified, but the address lost its own source (an account edited by hand): the guard refuses it (EMAIL_UNSOURCED), so the view does too.
  const bare = structuredClone(a); bare.contact.provenance = bare.contact.provenance.filter((p) => p.field !== 'email');
  assert.deepEqual([contactStatus(bare, { config: config(), now: NOW }).email.state, /no recorded source/.test(contactStatus(bare, { config: config(), now: NOW }).email.reason)], ['unsourced', true]);
  const s = contactStatus(a, { config: config(), now: NOW });
  assert.match(s.email.reverifyBy, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(s.fields.name.findingId, 'F1');
  assert.equal(s.fields.email.kind, 'institution_site');
  assert.deepEqual(s.domains.map((d) => d.domain), ['acmebank.test']);
  assert.equal(contactStatus({ person: {} }, { config: config(), now: NOW }).email.state, 'none');
  assert.equal(emailSyntaxOk('a.b-c+d@x-y.example.test'), true);
  for (const bad of ['a@b', '@x.test', 'a b@x.test', 'a@x..test', 'a@-x.test', `${'a'.repeat(65)}@x.test`]) assert.equal(emailSyntaxOk(bad), false, bad);
});
