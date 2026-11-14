// PRD E7-S3: a deletion request removes the person from every record that can hold them, keeps a hashed suppression entry so they are
// never contacted or named again, and logs the removal with counts only. Invented people and .test domains only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { makeDir, put, account, config, ctxWith, touch, sent, SENDER } from './kit.mjs';
import { loadRules } from '../src/rules.mjs';
import { readJson, readJsonl, readText } from '../src/store.mjs';
import { snapshotFromDir, applyPlanToDir, withUnitOfWork, LOADS } from '../src/uow.mjs';
import { renderBrief } from '../src/research.mjs';
import { forgetPerson, forgetInFolder } from '../src/forget.mjs';
import { setPerson, setEmail } from '../src/accounts.mjs';
import { checkTouch, loadContext } from '../src/guard.mjs';
import { approveDraft } from '../src/draft.mjs';
import { addPerson, addMembership } from '../src/network.mjs';
import { buildRoutes, chooseRoute, renderRoutes } from '../src/routes.mjs';

const rules = loadRules();
const NOW = new Date('2026-11-14T12:00:00Z');
const ID = 'acme-bank';
const CONFIRM = 'Acme Community Bank';
const finding = (id, kind, claim, quote, url, title = 'Leadership') => ({ id, oldId: id, question_id: `bank.${kind === 'person' ? 'people' : 'intent'}`, kind, claim, quote, source_url: url, source_title: title, publisher: 'Acme Community Bank', published: '2026-09-01', evidence_tier: 'company', requestedUse: 'context', asset_specific: false, corroborated_by: [], status: 'verified', corroborations: 1, stale: false, use: 'context', contextReason: 'x', supportVerdict: 'yes' });
const JORDAN_PAGE = 'https://acmebank.test/team/jordan-sample';

// The research run that named Jordan Sample (F1), with a finding that quotes them (F2) and another candidate (F3).
const RESEARCH = () => ({
  account: ID, date: '2026-11-10', mode: 'institution', model: 'fake',
  personCheck: { status: 'not_named', note: 'Two candidates: Jordan Sample and Robin Lee.', finding_ids: ['F1', 'F3'] },
  riskScreen: { approach: 'ok', reasons: [], finding_ids: [] },
  angle: { text: 'A bank that has said it will reduce office loans.', finding_ids: ['F2'], supported: true },
  gaps: [{ question_id: 'bank.access', why: 'No direct line for Jordan Sample was found.' }],
  contradictions: [{ finding_ids: ['F1', 'F3'], note: 'Two pages differ on who leads special assets.' }],
  findings: [
    finding('F1', 'person', 'Jordan Sample is the chief credit officer.', 'Jordan Sample, Chief Credit Officer', JORDAN_PAGE, 'Jordan Sample | Acme Community Bank'),
    finding('F2', 'intent', 'Chief credit officer Jordan Sample said the bank will reduce office loans.', 'we will reduce our office exposure', 'https://acmebank.test/q3', 'Q3 letter'),
    finding('F3', 'person', 'Robin Lee leads special assets.', 'Robin Lee, Head of Special Assets', 'https://acmebank.test/leadership'),
  ],
  dropped: [],
  run: { queries: ['Jordan Sample Acme Community Bank', 'Acme Community Bank loan sales'], fetches: [JORDAN_PAGE, 'https://acmebank.test/q3'], sources: 3, turns: 1, usage: { input_tokens: 10, output_tokens: 5 }, costUsd: 0.1, errors: [], auditRan: true,
    sourceList: [{ url: JORDAN_PAGE, title: 'Jordan Sample | Acme Community Bank', retrievedAt: '2026-11-10T00:00:00Z', hadText: true }, { url: 'https://acmebank.test/q3', title: 'Q3 letter', retrievedAt: '2026-11-10T00:00:00Z', hadText: true }, { url: 'https://acmebank.test/leadership', title: 'Leadership', retrievedAt: '2026-11-10T00:00:00Z', hadText: true }] },
});

function seed() {
  const dir = makeDir();
  const a = account({
    institutionKey: 'fdic:99999', notes: 'Jordan prefers a letter first.',
    contact: { ...account().contact, provenance: account().contact.provenance.map((p) => (p.field === 'name' || p.field === 'title' ? { ...p, kind: 'brief_finding', findingId: 'F1', url: JORDAN_PAGE } : p)) },
    outcomes: [{ id: '2026-11-12-abc123', date: '2026-11-12', codes: ['held', 'tape_promised'], commitments: [{ who: 'them', what: 'Jordan to send the loan list', by: '', byDate: null }], objections: [], peopleMentioned: [{ name: 'Jordan Sample', title: 'CCO', context: 'on the call', status: 'unconfirmed, from call notes' }, { name: 'Robin Lee', title: 'Special assets', context: 'joined late', status: 'unconfirmed, from call notes' }], confirmedBy: 'Pat Example' }],
  });
  put(dir, `accounts/${ID}.json`, a);
  put(dir, 'accounts/acme-bank-sa.json', account({ id: 'acme-bank-sa', person: { name: 'Robin Lee', title: 'Head of Special Assets', email: 'robin.lee@acmebank.test' }, contact: { emailStatus: 'unverified', roleConfirmed: false, provenance: [{ field: 'name', value: 'Robin Lee', kind: 'principal_known', seenOn: '2026-11-01', by: 'Pat Example' }] }, outcomes: [{ id: 'o2', date: '2026-11-13', codes: ['held'], commitments: [], objections: [], peopleMentioned: [{ name: 'Jordan Sample', title: '', context: 'handles hotels', status: 'unconfirmed, from call notes' }] }] }));
  const r = RESEARCH();
  put(dir, `research/${ID}.json`, r);
  put(dir, `facts/${ID}.json`, r.findings.map((f) => ({ id: `${ID}:${f.id}`, kind: f.kind, claim: f.claim, quote: f.quote, url: f.source_url, publisher: f.publisher, published: f.published, tier: 'company', use: f.kind === 'intent' ? 'draft' : 'context', asset_specific: false })));
  put(dir, `briefs/${ID}.md`, renderBrief({ account: a, today: r.date, result: r, run: r.run }));
  put(dir, `drafts/${ID}/1-letter.json`, { account: ID, channel: 'letter', step: 1, sender: 'pat', date: '2026-11-10', status: 'approved', subject: null, text: 'November 10, 2026\n\nJordan Sample\nChief Credit Officer\nAcme Community Bank\n10 Main St, Anytown\n\nDear Jordan Sample,\n\nBody.', bodyRaw: 'Body.', output: { body: 'Body.', personalization: [] }, factsUsed: [], claimsUsed: ['confidential-no-borrower-contact'], lint: { errors: [], warnings: [] }, createdAt: '2026-11-09T00:00:00Z', approvedBy: 'Pat Example', approvedAt: '2026-11-09T01:00:00Z' });
  put(dir, `drafts/${ID}/1-letter.md`, '---\naccount: acme-bank\n---\n\nDear Jordan Sample,\n');
  put(dir, `drafts/${ID}/2-email.json`, { account: ID, channel: 'email', step: 2, sender: 'pat', date: '2026-11-13', status: 'draft', subject: 'A question', text: 'Subject: A question\n\nHi Jordan,\n\nBody.', bodyRaw: 'Body.', output: { subject: 'A question', body: 'Body.', personalization: [] }, factsUsed: [], claimsUsed: [], lint: { errors: [], warnings: [] }, createdAt: '2026-11-12T00:00:00Z', approvedBy: null, approvedAt: null });
  put(dir, `drafts/${ID}/2-email.md`, 'Hi Jordan,\n');
  put(dir, `calls/${ID}/2026-11-12-notes.md`, 'Call with Jordan Sample. Jordan said the bank may sell in Q1. Robin Lee joined late. Call back on 555-0199.\n');
  put(dir, `calls/${ID}/proposals/2026-11-12-abc123.json`, { id: '2026-11-12-abc123', account: ID, date: '2026-11-12', status: 'confirmed', outcomes: [{ code: 'held', when: '', referral: '', quote: 'Jordan said the bank may sell', quoteFound: true }], objections: [], commitments: [], followUpDate: '', people: [{ name: 'Jordan Sample', title: 'CCO', context: 'on the call', status: 'unconfirmed, from call notes' }, { name: 'Robin Lee', title: 'Special assets', context: 'joined late', status: 'unconfirmed, from call notes' }], problems: [], notesDigest: 'x', confirmedBy: 'Pat Example' });
  put(dir, `calls/${ID}/2026-11-12-prep.json`, { account: ID, date: '2026-11-12', status: 'usable', output: { who: [{ text: 'Jordan Sample, Chief Credit Officer.', cites: ['account:person'] }] } });
  put(dir, `calls/${ID}/2026-11-12-prep.md`, '# Call brief: Jordan Sample, Chief Credit Officer, Acme Community Bank\n');
  put(dir, 'calls/acme-bank-sa/2026-11-13-notes.md', 'Robin said Jordan Sample handles hotel loans.\n');
  put(dir, 'outcomes.jsonl', `${JSON.stringify({ type: 'call_outcome', id: '2026-11-12-abc123', accountId: ID, codes: ['held', 'tape_promised'], counts: { people: 2 }, confirmedBy: 'Pat Example' })}\n`);
  put(dir, 'touches.jsonl', [
    { type: 'touch', accountId: ID, institution: 'Acme Community Bank', step: 1, channel: 'letter', sender: 'pat', date: '2026-11-10', recordedAt: '2026-11-10T00:00:00Z' },
    { type: 'reply', accountId: ID, institution: 'Acme Community Bank', date: '2026-11-11', note: 'Jordan Sample replied: call in January', recordedAt: '2026-11-11T00:00:00Z' },
    { type: 'meeting', accountId: ID, institution: 'Acme Community Bank', date: '2026-11-12', ref: 'call:2026-11-12-abc123', recordedAt: '2026-11-12T00:00:00Z' },
  ].map((l) => JSON.stringify(l)).join('\n') + '\n');
  put(dir, `pilot/${ID}.truth.json`, { account: ID, sections: [{ questionId: 'bank.people', truth: 'Jordan Sample (jordan@acmebank.test) decides on loan sales.', sources: [JORDAN_PAGE], foundInBrief: true }, { questionId: 'bank.intent', truth: 'Reducing office loans.', sources: [], foundInBrief: true }] });
  put(dir, `pilot/${ID}.review.json`, { account: ID, researchDate: '2026-11-10', verdicts: { F1: { verdict: 'true', by: 'Pat Example', note: 'Jordan is on the site' }, F2: { verdict: 'true', by: 'Pat Example' }, F3: { verdict: 'unknown', by: 'Pat Example' } } });
  put(dir, 'suppression.json', { entries: [{ type: 'email', value: 'jordan@acmebank.test', reason: 'opt_out', added: '2026-11-11' }, { type: 'institution', value: 'Some Other Bank', reason: 'nda', added: '2026-10-01' }] });
  put(dir, 'contacts/known.json', { people: [
    { id: 'k1', name: 'Jordan Sample', institution: 'Acme Community Bank, N.A.', email: 'jordan@acmebank.test', title: 'Chief Credit Officer', asOf: '2026-10-01' },
    { id: 'k3', name: 'Robin Lee', institution: 'Acme Community Bank', email: 'robin.lee@acmebank.test', title: 'Head of Special Assets', asOf: '2026-10-01' },
  ] });
  put(dir, 'contacts/vendor-tests/contact-co-2026-11-13.json', { vendor: 'contact-co', date: '2026-11-13', rows: [{ ref: 'k1', matched: true, email: 'correct', title: 'current' }] });
  put(dir, 'senders.json', { senders: [SENDER] });
  return dir;
}

const files = (dir, rel = '') => readdirSync(join(dir, rel)).flatMap((n) => (statSync(join(dir, rel, n)).isDirectory() ? files(dir, join(rel, n)) : [join(rel, n)]));
const everything = (dir) => files(dir).map((f) => [f, readFileSync(join(dir, f), 'utf8')]);
const forget = (dir, over = {}) => forgetPerson({ dir, id: ID, by: 'Pat Example', reason: 'Jordan Sample asked by email to be removed.', confirm: CONFIRM, now: NOW, ...over });

test('forgetting a person removes them from every store that can hold them', () => {
  const dir = seed();
  const r = forget(dir);
  // Nothing anywhere in the data folder names Jordan, their address, their phone, their street or their page.
  for (const [f, text] of everything(dir)) for (const bad of [/jordan/i, /555-0199/, /10 Main St/]) assert.doesNotMatch(text, bad, `${f} still holds ${bad}`);

  const a = readJson(join(dir, 'accounts', `${ID}.json`));
  assert.deepEqual(a.person, { name: '', title: '', email: '', phone: '', phoneType: '', timezone: '', mailingAddress: '' });
  assert.deepEqual([a.contact.emailStatus, a.contact.roleConfirmed, a.contact.provenance, a.contact.verification], ['unverified', false, [], null]);
  assert.deepEqual(a.forgotten.map((x) => [x.by, x.at, x.reason]), [['Pat Example', NOW.toISOString(), '[removed] asked by email to be removed.']]);
  assert.deepEqual(a.outcomes[0].codes, ['held', 'tape_promised'], 'the outcome codes stay: they describe the bank, not the person');
  assert.deepEqual(a.outcomes[0].peopleMentioned.map((p) => p.name), ['Robin Lee']);
  assert.deepEqual(a.domains.map((d) => d.domain), ['acmebank.test'], 'the institution\'s domains stay');
  assert.equal(readJson(join(dir, 'accounts', 'acme-bank-sa.json')).person.name, 'Robin Lee', 'a colleague on another account stays');
  assert.deepEqual(readJson(join(dir, 'accounts', 'acme-bank-sa.json')).outcomes[0].peopleMentioned, []);

  // Research: the finding that named them is gone, a finding that quotes them keeps its fact, the other candidate stays.
  const res = readJson(join(dir, 'research', `${ID}.json`));
  assert.deepEqual(res.findings.map((f) => f.id), ['F2', 'F3']);
  assert.equal(res.findings[0].claim, 'Chief credit officer [removed] said the bank will reduce office loans.');
  assert.deepEqual(res.personCheck.finding_ids, ['F3']);
  assert.deepEqual(res.contradictions[0].finding_ids, ['F3']);
  assert.deepEqual(res.run.sourceList.map((s) => s.url), ['https://acmebank.test/q3', 'https://acmebank.test/leadership']);
  assert.deepEqual(readJson(join(dir, 'facts', `${ID}.json`)).map((f) => f.id), [`${ID}:F2`, `${ID}:F3`]);
  const brief = readText(join(dir, 'briefs', `${ID}.md`));
  assert.ok(!brief.includes('[F1]') && brief.includes('[F3]') && brief.includes('Robin Lee'), 'the brief is rebuilt from the scrubbed research');

  // Drafts addressed to them are emptied, and can no longer be approved.
  for (const f of ['1-letter', '2-email']) {
    const d = readJson(join(dir, 'drafts', ID, `${f}.json`));
    assert.equal(d.status, 'forgotten');
    for (const k of ['text', 'subject', 'bodyRaw', 'output', 'lint']) assert.equal(d[k], undefined, `${f}.${k}`);
    assert.match(readText(join(dir, 'drafts', ID, `${f}.md`)), /Removed on a deletion request/);
  }
  assert.throws(() => approveDraft({ dir, account: a, channel: 'email', step: 2, by: 'Pat', ctx: loadContext({ dir, config: config(), env: {} }), rules }), /removed on a deletion request/);

  // Calls: their name, first name and phone are removed from the notes; they leave the people lists; Robin stays.
  assert.equal(readText(join(dir, 'calls', ID, '2026-11-12-notes.md')), 'Call with [removed]. [removed] said the bank may sell in Q1. Robin Lee joined late. Call back on [removed].\n');
  const prop = readJson(join(dir, 'calls', ID, 'proposals', '2026-11-12-abc123.json'));
  assert.deepEqual(prop.people.map((p) => p.name), ['Robin Lee']);
  assert.equal(prop.outcomes[0].quote, '[removed] said the bank may sell');
  assert.equal(readText(join(dir, 'calls', 'acme-bank-sa', '2026-11-13-notes.md')), 'Robin said [removed] handles hotel loans.\n');

  // The logs: the reply's note is blanked; the reply itself (which stops the sequence), its date and account stay.
  const t = readJsonl(join(dir, 'touches.jsonl'));
  assert.deepEqual(t.map((l) => [l.type, l.accountId, l.date]), [['touch', ID, '2026-11-10'], ['reply', ID, '2026-11-11'], ['meeting', ID, '2026-11-12']]);
  assert.equal(t[1].note, '[removed]');
  assert.deepEqual(readJsonl(join(dir, 'outcomes.jsonl'))[0].codes, ['held', 'tape_promised']);

  // The pilot: the truth sheet's mention is removed, the verdict on the removed finding is dropped.
  assert.match(readJson(join(dir, 'pilot', `${ID}.truth.json`)).sections[0].truth, /^\[removed\] \(\[removed\]\) decides on loan sales\.$/);
  assert.deepEqual(Object.keys(readJson(join(dir, 'pilot', `${ID}.review.json`)).verdicts), ['F2', 'F3']);

  // The known list for vendor tests loses them; Robin stays.
  assert.deepEqual(readJson(join(dir, 'contacts', 'known.json')).people.map((p) => p.id), ['k3']);

  // Suppression: hashes only, never the name or address; the earlier opt-out keeps its reason and date.
  const sup = readJson(join(dir, 'suppression.json')).entries;
  assert.deepEqual(sup.map((e) => [e.type, e.reason]), [['email', 'opt_out'], ['institution', 'nda'], ['person', 'deletion_request']]);
  assert.equal(sup[0].added, '2026-11-11');
  for (const e of sup.filter((x) => x.type !== 'institution')) { assert.equal(e.value, undefined); assert.ok(e.hashes.length && e.hashes.every((h) => /^sha256:[0-9a-f]{64}$/.test(h))); }

  // One audit line: the account, who, when and counts per store. No name, no address.
  const line = readJsonl(join(dir, 'audit.jsonl')).filter((l) => l.type === 'person_forgotten');
  assert.equal(line.length, 1);
  assert.deepEqual([line[0].accountId, line[0].by, line[0].at], [ID, 'Pat Example', NOW.toISOString()]);
  assert.deepEqual(Object.keys(line[0].counts).sort(), ['accounts', 'briefs', 'calls', 'contacts', 'drafts', 'facts', 'network', 'outcomes', 'pilot', 'research', 'routes', 'suppression', 'touches']);
  assert.deepEqual(line[0].counts, { accounts: 2, research: 1, facts: 1, briefs: 1, drafts: 4, calls: 5, pilot: 2, touches: 1, outcomes: 0, suppression: 1, contacts: 1, routes: 0, network: 0 });
  assert.deepEqual(r.counts, line[0].counts);
  assert.doesNotMatch(JSON.stringify(line[0]), /jordan|sample|acmebank|removed\./i);
});

test('the forgotten person is never contacted or named again', () => {
  const dir = seed();
  forget(dir);
  // Re-added by hand, they are still refused by the guard: the address and the person at this bank are suppressed.
  const ctx = loadContext({ dir, config: config(), env: {} });
  const back = account({ institutionKey: 'fdic:99999' });
  const codes = checkTouch(touch(back, { channel: 'email', step: 2, institutionKey: 'fdic:99999' }), ctx).errors.map((e) => e.code);
  assert.ok(codes.includes('SUPPRESSED_EMAIL') && codes.includes('SUPPRESSED_PERSON'), JSON.stringify(codes));
  assert.throws(() => setPerson({ dir, id: ID, name: 'Jordan  Sample', by: 'Pat', source: { kind: 'principal_known' }, now: NOW }), /suppressed/);
  setPerson({ dir, id: ID, name: 'Robin Lee', by: 'Pat', source: { kind: 'principal_known' }, now: NOW });
  assert.throws(() => setEmail({ dir, id: ID, email: 'JORDAN@acmebank.test', by: 'Pat', source: { kind: 'principal_known' }, config: config(), now: NOW }), /suppressed/);
  // The same name at another bank is someone else.
  assert.deepEqual(checkTouch(touch(account({ id: 'other', name: 'Other Bank', aliases: [], person: { ...account().person, email: 'jordan@otherbank.test' }, contact: { ...account().contact, provenance: account().contact.provenance.map((p) => (p.field === 'email' ? { ...p, value: 'jordan@otherbank.test' } : p)), verification: { ...account().contact.verification, email: 'jordan@otherbank.test' } } }), { channel: 'letter' }), ctx).errors.map((e) => e.code), []);
});

test('the same name at another bank is another person: their account and known-list entry stay', () => {
  const dir = seed();
  put(dir, 'accounts/other-bank.json', account({ id: 'other-bank', name: 'Other Bank', aliases: [], institutionKey: 'fdic:11111', domains: [], notes: 'Jordan Sample here is the president.', person: { name: 'Jordan Sample', title: 'President', email: 'jsample@otherbank.test' }, contact: { emailStatus: 'unverified', roleConfirmed: false, provenance: [{ field: 'name', value: 'Jordan Sample', kind: 'principal_known', seenOn: '2026-11-01', by: 'Pat Example' }] } }));
  put(dir, 'calls/other-bank/2026-11-05-notes.md', 'Met Jordan Sample, the president.\n');
  const known = readJson(join(dir, 'contacts', 'known.json'));
  known.people.push({ id: 'k2', name: 'Jordan Sample', institution: 'Other Bank', email: 'jsample@otherbank.test', title: 'President', asOf: '2026-10-01' });
  put(dir, 'contacts/known.json', known);
  forget(dir);
  const other = readJson(join(dir, 'accounts', 'other-bank.json'));
  assert.deepEqual([other.person.name, other.notes, other.contact.provenance[0].value], ['Jordan Sample', 'Jordan Sample here is the president.', 'Jordan Sample'], 'a name alone does not reach across institutions');
  assert.equal(readText(join(dir, 'calls', 'other-bank', '2026-11-05-notes.md')), 'Met Jordan Sample, the president.\n');
  assert.deepEqual(readJson(join(dir, 'contacts', 'known.json')).people.map((p) => p.id), ['k3', 'k2']);
});

test('forgetting needs a principal, a reason, and the account\'s name typed to confirm', () => {
  const dir = seed();
  assert.throws(() => forget(dir, { by: '' }), /--by/);
  assert.throws(() => forget(dir, { reason: ' ' }), /reason is required/);
  assert.throws(() => forget(dir, { confirm: 'acme' }), /type the account's name/);
  assert.throws(() => forget(dir, { confirm: undefined }), /type the account's name/);
  assert.equal(readJson(join(dir, 'accounts', `${ID}.json`)).person.name, 'Jordan Sample', 'nothing changed');
  assert.doesNotThrow(() => forget(dir, { confirm: ' acme community bank ' }));
  assert.throws(() => forget(dir), /has no named person to forget/);
});

test('a person no longer on the account is forgotten by name and address, and the current person stays', () => {
  const dir = seed();
  const a = readJson(join(dir, 'accounts', `${ID}.json`));
  put(dir, `accounts/${ID}.json`, { ...a, person: { ...a.person, name: 'Robin Lee', email: 'robin.lee@acmebank.test' } });
  forget(dir, { name: 'Jordan Sample', email: 'jordan@acmebank.test' });
  for (const [f, text] of everything(dir)) assert.doesNotMatch(text, /jordan/i, f);
  assert.equal(readJson(join(dir, 'accounts', `${ID}.json`)).person.name, 'Robin Lee');
});

// The routes (PRD E22) hold lender-side names, and the firm's network can hold the same person if the firm knows them. A second bank's
// director is the same Jordan Sample, of Acme, so a route there goes through the network entry; both banks have a chosen route.
function seedRoutes() {
  const dir = seed();
  const res = readJson(join(dir, 'research', `${ID}.json`));
  const named = (f, entities) => ({ ...f, entities });
  res.findings = [named(res.findings[0], [{ type: 'person', name: 'Jordan Sample', affiliation: '', role: 'Chief Credit Officer' }]), named(res.findings[1], []), named(res.findings[2], [{ type: 'person', name: 'Robin Lee', affiliation: '', role: 'Head of Special Assets' }]),
    { ...finding('F4', 'relationship', 'Jordan Sample spoke at the Example Lenders Forum.', 'Speakers: Jordan Sample, Acme Community Bank. Example Lenders Forum spring meeting', 'https://forum.example.test/speakers'), question_id: 'bank.memberships',
      entities: [{ type: 'person', name: 'Jordan Sample', affiliation: 'Acme Community Bank', role: 'speaker' }, { type: 'association', name: 'Example Lenders Forum', affiliation: '', role: '' }] }];
  put(dir, `research/${ID}.json`, res);
  put(dir, 'accounts/beta-bank.json', account({ id: 'beta-bank', name: 'Beta Example Bank', aliases: [], institutionKey: 'fdic:77777', domains: [], person: { name: '', title: '', email: '' }, contact: { emailStatus: 'unverified', roleConfirmed: false, provenance: [] } }));
  put(dir, 'research/beta-bank.json', { account: 'beta-bank', date: '2026-11-10', mode: 'institution', findings: [{ ...finding('F1', 'person', 'Jordan Sample of Acme Community Bank is a director.', 'Jordan Sample, Director; Chief Credit Officer of Acme Community Bank', 'https://betabank.test/board'), question_id: 'bank.board',
    entities: [{ type: 'person', name: 'Jordan Sample', affiliation: 'Acme Community Bank', role: 'Director' }] }] });
  addPerson({ dir, name: 'Jordan Sample', organization: 'Acme Community Bank, N.A.', relationship: 'met at a conference', knownBy: 'Pat Example', introConsent: 'yes', by: 'Pat Example', now: NOW });   // np-1: them
  addPerson({ dir, name: 'Casey Example', organization: 'Example Grove Partners', relationship: 'co-investor', knownBy: 'Pat Example', by: 'Pat Example', now: NOW });   // np-2: someone else
  addMembership({ dir, association: 'Example Lenders Forum', principal: 'Pat Example', by: 'Pat Example', now: NOW });   // nm-3
  const acme = buildRoutes({ dir, id: ID, rules, now: NOW, env: {} });
  const beta = buildRoutes({ dir, id: 'beta-bank', rules, now: NOW, env: {} });
  assert.deepEqual(acme.routes.map((r) => [r.type, r.bridge?.id ?? null]), [['board', 'np-1'], ['forum', 'nm-3'], ['direct', null]]);
  chooseRoute({ dir, id: ID, routeId: acme.routes[0].id, by: 'Pat Example', rules, now: NOW, env: {} });
  chooseRoute({ dir, id: 'beta-bank', routeId: beta.routes.find((r) => r.bridge?.id === 'np-1').id, by: 'Pat Example', rules, now: NOW, env: {} });
  return dir;
}

test('a deletion request reaches routes/ and network/: the person leaves every routes file and the network, and a choice that used them goes', async () => {
  const a = seedRoutes(), b = seedRoutes();
  const r = await forgetInFolder({ dir: a, id: ID, by: 'Pat Example', reason: 'Jordan Sample asked by email to be removed.', confirm: CONFIRM, now: NOW });
  const stored = everything(a).filter(([f]) => /^(routes|network)\//.test(f));
  assert.deepEqual(stored.map(([f]) => f).sort(), ['network/network.json', 'routes/acme-bank.json', 'routes/acme-bank.md', 'routes/beta-bank.json', 'routes/beta-bank.md']);
  for (const [f, text] of stored) assert.doesNotMatch(text, /jordan|acmebank\.test\/team/i, `${f} still holds them`);
  const net = readJson(join(a, 'network', 'network.json'));
  assert.deepEqual([Object.keys(net.people), Object.keys(net.memberships)], [['np-2'], ['nm-3']], 'their entry goes; someone else\'s and the membership stay');
  const acme = readJson(join(a, 'routes', `${ID}.json`));
  assert.equal(acme.chosen, null);
  assert.match(acme.choiceRemoved.reason, /deletion request|network entry it used was removed/);
  assert.deepEqual(acme.routes.map((x) => [x.type, x.target.kind]), [['forum', 'institution'], ['direct', 'candidates']], 'rebuilt from the scrubbed research');
  assert.deepEqual(acme.routes.at(-1).target.names, ['Robin Lee'], 'the other candidate stays');
  const beta = readJson(join(a, 'routes', 'beta-bank.json'));
  assert.deepEqual([beta.chosen, beta.routes.some((x) => x.bridge?.id === 'np-1'), !!beta.choiceRemoved], [null, false, true]);
  // One audit line with the counts per store, routes and network included. No name, no address.
  const line = readJsonl(join(a, 'audit.jsonl')).filter((l) => l.type === 'person_forgotten');
  assert.equal(line.length, 1);
  assert.deepEqual([line[0].counts.routes, line[0].counts.network], [4, 1], 'two routes files, json and md each; the network document');
  assert.deepEqual(r.counts, line[0].counts);
  assert.doesNotMatch(JSON.stringify(readJsonl(join(a, 'audit.jsonl'))), /jordan|sample|acmebank/i, 'no audit line names them');
  // The unit of work above loaded only LOADS.forget; run straight on a data folder, the deletion stores the same thing.
  forgetPerson({ dir: b, id: ID, by: 'Pat Example', reason: 'Jordan Sample asked by email to be removed.', confirm: CONFIRM, now: NOW });
  assert.deepEqual(snapshotFromDir(b, ['routes/', 'network/']), snapshotFromDir(a, ['routes/', 'network/']));
});

test('a routes file whose account is gone is redacted, not rebuilt; an error in routes.json stops the deletion before anything changes', () => {
  const bad = structuredClone(rules); bad.routes.order.types = ['board'];
  const before = seedRoutes();
  assert.throws(() => forget(before, { rules: bad }), /routes.json has errors.*Nothing was changed/s);
  assert.equal(readJson(join(before, 'accounts', `${ID}.json`)).person.name, 'Jordan Sample', 'nothing changed');
  const dir = seedRoutes();
  const rec = readJson(join(dir, 'routes', `${ID}.json`));
  put(dir, 'routes/gone-bank.json', { ...rec, account: 'gone-bank' });
  put(dir, 'routes/gone-bank.md', renderRoutes({ ...rec, account: 'gone-bank' }));
  forget(dir);
  for (const f of ['gone-bank.json', 'gone-bank.md']) assert.doesNotMatch(readFileSync(join(dir, 'routes', f), 'utf8'), /jordan/i, f);
  assert.match(readFileSync(join(dir, 'routes', 'gone-bank.md'), 'utf8'), /^# Routes to the decision-maker: Acme Community Bank/);
});

test('the command line\'s run (a unit of work over the folder) and the platform\'s (LOADS.forget) store the same thing', async () => {
  const a = seed(), b = seed();
  const ra = await forgetInFolder({ dir: a, id: ID, by: 'Pat Example', reason: 'asked', confirm: CONFIRM, now: NOW });
  let plan;
  const { result: rb } = await withUnitOfWork({ load: async (prefixes) => snapshotFromDir(b, prefixes), flush: async (p) => { plan = p; applyPlanToDir(p, b); } }, LOADS.forget,
    (root) => forgetPerson({ dir: root, id: ID, by: 'Pat Example', reason: 'asked', confirm: CONFIRM, now: NOW }));
  const norm = (s) => JSON.parse(JSON.stringify(s).replace(/"ts":"[^"]+"/g, '"ts":"<ts>"'));
  assert.deepEqual(norm(snapshotFromDir(b)), norm(snapshotFromDir(a)));
  assert.deepEqual(rb.counts, ra.counts);
  // The log redactions are what the database accepts: the same keys, protected keys unchanged, every changed value "[removed]".
  assert.ok(plan.redactions?.length === 1, JSON.stringify(plan.redactions));
  for (const x of plan.redactions) {
    assert.equal(x.path, 'touches.jsonl');
    assert.deepEqual(Object.keys(x.new).sort(), Object.keys(x.old).sort());
    for (const k of Object.keys(x.old)) if (x.new[k] !== x.old[k]) { assert.equal(x.new[k], '[removed]'); assert.ok(!['type', 'accountId', 'institution', 'date', 'id', 'ref'].includes(k), k); }
  }
  for (const p of ['accounts/', 'research/', 'facts/', 'briefs/', 'drafts/', 'calls/', 'pilot/', 'contacts/', 'routes/', 'network/', 'suppression.json', 'touches.jsonl', 'outcomes.jsonl']) assert.ok(LOADS.forget.includes(p), p);
});
