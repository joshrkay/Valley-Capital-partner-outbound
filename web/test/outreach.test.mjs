// Outreach and Approvals (docs/design-redesign.md, 5.5 and 5.6): each account's stage and one next step, the guard's verdicts as sentences,
// and the linter's findings as plain sentences with the matched words highlighted. Pure helpers, plus the two small reads Outreach adds,
// against the repository's fake Supabase REST API. Invented banks and people only; no network, no browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fakePostgrest } from '../../test/postgrest-fake.mjs';
import { platformClient } from '../../src/platform/client.mjs';
import { restReader } from '../lib/rest.mjs';
import * as ops from '../lib/ops.mjs';
import { OUTREACH_STAGES, stageOfAccount, nextStep, groupAccounts, ruleLabel, guardSentence, GUARD_LABELS } from '../lib/account-view.mjs';
import { findingText, quotedTerm, matchedTerm, highlight, sortDrafts } from '../lib/drafts-view.mjs';

const acct = (over = {}) => ({ id: 'alpha-example-bank', name: 'Alpha Example Bank', person: { name: '' }, contact: {}, ...over });
const named = acct({ person: { name: 'Jane Example', title: 'Chief Credit Officer' } });

test('each account\'s stage, in the order outreach moves', () => {
  assert.deepEqual(OUTREACH_STAGES.map(([, l]) => l), ['Name the person', 'Research', 'Draft', 'Sent', 'In conversation']);
  assert.equal(stageOfAccount({ account: acct() }), 'name');
  assert.equal(stageOfAccount({ account: acct(), research: { date: '2026-11-10', mode: 'institution' } }), 'name', 'institution research finds a person; until one is named, that is the step');
  assert.equal(stageOfAccount({ account: named }), 'research');
  assert.equal(stageOfAccount({ account: named, research: { date: '2026-11-10' } }), 'draft');
  assert.equal(stageOfAccount({ account: named, drafts: [{ status: 'draft' }] }), 'draft');
  assert.equal(stageOfAccount({ account: named, drafts: [{ status: 'approved' }], touches: [{ accountId: named.id, type: 'touch' }] }), 'sent');
  assert.equal(stageOfAccount({ account: named, touches: [{ accountId: named.id, type: 'touch' }, { accountId: named.id, type: 'meeting' }] }), 'conversation');
  assert.equal(stageOfAccount({ account: named, touches: [{ accountId: 'someone-else', type: 'meeting' }] }), 'research', 'another account\'s touches do not count');
  const groups = groupAccounts([{ id: 'a', stage: 'sent' }, { id: 'b', stage: 'name' }, { id: 'c', stage: 'sent' }]);
  assert.deepEqual(groups.map((g) => [g.id, g.rows.map((r) => r.id)]), [['name', ['b']], ['research', []], ['draft', []], ['sent', ['a', 'c']], ['conversation', []]]);
});

test('one next step, hard stops first', () => {
  assert.match(nextStep({ account: acct() }).text, /^Name the person to contact, or queue institution research/);
  assert.match(nextStep({ account: acct(), gate: { allowed: false, reason: 'The pilot has not passed.' } }).text, /Research is not open yet: The pilot has not passed\.$/);
  const confirm = nextStep({ account: named });
  assert.deepEqual([confirm.stage, confirm.anchor], ['research', 'person']);
  assert.equal(confirm.text, 'Confirm Jane Example\'s role from the sources, then queue research.');
  assert.equal(nextStep({ account: { ...named, contact: { roleConfirmed: true } } }).text, 'Queue research on the person.');
  assert.equal(nextStep({ account: named, research: { date: '2026-11-10' } }).text, 'Research is done: queue the first draft.');
  assert.deepEqual([nextStep({ account: named, drafts: [{ status: 'draft' }] }).href, nextStep({ account: named, drafts: [{ status: 'approved' }] }).anchor], ['/drafts', 'touches']);
  assert.match(nextStep({ account: named, touches: [{ type: 'touch' }, { type: 'touch' }] }).text, /^2 sends recorded\./);
  assert.match(nextStep({ account: named, touches: [{ type: 'reply' }] }).text, /^In conversation/);
  // Hard stops come before anything else.
  const opt = nextStep({ account: named, touches: [{ type: 'touch' }, { type: 'opt_out' }] });
  assert.deepEqual([opt.stop, opt.text], [true, 'Stopped: someone at this bank opted out. Nobody here is contacted again.']);
  const stop = nextStep({ account: named, routes: { guard: { hardStops: [{ code: 'SUPPRESSED_INSTITUTION', message: 'The institution is on the suppression list.' }] } } });
  assert.deepEqual([stop.stop, stop.text, stop.anchor], [true, 'Stop first: The institution is on the suppression list.', 'routes']);
  const order = nextStep({ account: named, orders: [{ id: 'o1', confirmation: null }] });
  assert.deepEqual([order.stop, order.anchor], [true, 'orders']);
  assert.equal(nextStep({ account: named, orders: [{ id: 'o1', confirmation: { by: 'Pat Example' } }] }).stop, false);
});

test('the guard\'s verdicts read as sentences; the codes stay for a disclosure', () => {
  assert.equal(ruleLabel('TOO_SOON'), 'Too soon after the last touch.');
  assert.equal(ruleLabel('SOMETHING_NEW'), 'something new', 'an unknown code still reads as words');
  assert.equal(guardSentence({ code: 'CAP_EMAIL_DAY', message: 'Already sent the daily maximum of email.' }), 'Already sent the daily maximum of email.');
  assert.equal(guardSentence({ code: 'KILL_SWITCH' }), 'Sending is paused.');
  const guard = readFileSync(new URL('../../src/guard.mjs', import.meta.url), 'utf8');
  const codes = [...new Set([...guard.matchAll(/code: '([A-Z_]+)'|'([A-Z][A-Z_]{3,})'/g)].map((m) => m[1] ?? m[2]))].filter((c) => /_|^KILL$/.test(c) && !/^[A-Z]+_[A-Z]+\.[a-z]/.test(c));
  for (const c of codes.filter((x) => /^(ADDRESS|CALL|CAP|CHANNEL|EMAIL|KILL|NOT|NO|ORDER|OTHER|OUTSIDE|PERSONAL|PERSON|PHONE|ROLE|SENDER|SEQUENCE|SUPPRESSED|TIMEZONE|TOO|WRONG)/.test(x))) assert.ok(GUARD_LABELS[c], `${c} has a plain label`);
  // The account sections show sentences and keep the codes in a disclosure.
  for (const f of ['touches.jsx', 'routes.jsx', 'calls.jsx']) {
    const src = readFileSync(new URL(`../app/accounts/[id]/${f}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /\{e\.code\}: \{e\.message\}|\{h\.code\}: \{h\.message\}/, `${f}: a code before its message`);
    assert.match(src, /<RuleCodes /, f);
  }
});

test('Approvals: plain findings, the matched words highlighted, blocked drafts last', () => {
  const banned = { code: 'BANNED_WORD', message: '"bargain" is not used in outreach.' };
  assert.equal(quotedTerm(banned), 'bargain');
  assert.deepEqual([matchedTerm({ code: 'EM_DASH', message: 'An em dash.' }), matchedTerm({ code: 'LENGTH', message: 'Too long.' })], ['\u2014', null]);
  assert.equal(findingText(banned), 'Uses the word "bargain"; remove it.');
  assert.equal(findingText({ code: 'EM_DASH', message: 'An em dash reads as machine-written in an email. Use a period or a comma.' }), 'Uses an em dash, which reads as machine-written; use a period or a comma.');
  assert.equal(findingText({ code: 'LENGTH', message: '212 words; the most is 150.' }), '212 words; the most is 150.', 'the linter\'s own sentence when there is no plainer one');
  assert.deepEqual(highlight('A Bargain, not a bargaining chip. bargain.', ['bargain']), [
    { t: 'A ', mark: false }, { t: 'Bargain', mark: true }, { t: ', not a bargaining chip. ', mark: false }, { t: 'bargain', mark: true }, { t: '.', mark: false }]);
  assert.deepEqual(highlight('plain text', []), [{ t: 'plain text', mark: false }]);
  assert.deepEqual(highlight('a (b) c', ['(b)']).filter((p) => p.mark).map((p) => p.t), ['(b)'], 'no regular-expression surprises');
  const rows = [{ id: 1, status: 'blocked', errors: [banned], createdAt: '2026-11-16' }, { id: 2, status: 'draft', errors: [], createdAt: '2026-11-14' }, { id: 3, status: 'draft', errors: [], createdAt: '2026-11-15' }];
  assert.deepEqual(sortDrafts(rows).map((r) => r.id), [3, 2, 1]);
  const page = readFileSync(new URL('../app/drafts/approvals-view.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(page, />\s*Send\b/, 'no send button');
  assert.match(page, /action=\{approveAction\}/);
});

test('Outreach reads each account\'s draft statuses and the touch log, paths and small fields only', async () => {
  const fake = fakePostgrest();
  const url = 'https://example-project.supabase.test';
  const client = platformClient({ url, key: 'anon-key', accessToken: 'user:pat@example.test', fetchImpl: fake.fetchImpl });
  const rest = restReader({ url, key: 'anon-key', accessToken: 'user:pat@example.test', fetchImpl: fake.fetchImpl });
  await client.flush({ docs: [
    { path: 'drafts/alpha-example-bank/1-email.json', kind: 'json', body: { status: 'draft', text: 'x' }, baseVersion: 0 },
    { path: 'drafts/alpha-example-bank/2-call.json', kind: 'json', body: { status: 'approved', text: 'y' }, baseVersion: 0 },
    { path: 'drafts/bravo-example-bank/1-email.json', kind: 'json', body: { status: 'blocked' }, baseVersion: 0 },
    { path: 'accounts/alpha-example-bank.json', kind: 'json', body: { id: 'alpha-example-bank' }, baseVersion: 0 },
  ], lines: [
    { path: 'touches.jsonl', line: { type: 'touch', accountId: 'alpha-example-bank', date: '2026-11-12', step: 1 } },
    { path: 'touches.jsonl', line: { type: 'reply', accountId: 'alpha-example-bank', date: '2026-11-14', note: 'internal' } },
  ] });
  fake.calls.length = 0;
  const s = await ops.outreachSignals(rest);
  assert.deepEqual(s.drafts.get('alpha-example-bank').map((d) => d.status).sort(), ['approved', 'draft']);
  assert.deepEqual(s.drafts.get('bravo-example-bank'), [{ status: 'blocked' }]);
  assert.deepEqual(s.touches, [{ accountId: 'alpha-example-bank', type: 'touch', date: '2026-11-12' }, { accountId: 'alpha-example-bank', type: 'reply', date: '2026-11-14' }], 'no note, no step: type, date and account only');
  assert.ok(fake.calls.every((c) => c.caller === 'principal'));
  assert.match(String(fake.calls.find((c) => c.path === 'documents').query.select), /^path,status:body->>status$/, 'never the draft text');
  // A failed read leaves them empty; the page still shows each account's own record.
  const broken = { get: async () => { throw new Error('down'); } };
  assert.deepEqual(await ops.outreachSignals(broken), { drafts: new Map(), touches: [] });
});
