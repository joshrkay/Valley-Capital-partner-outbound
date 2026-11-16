// PRD E9: the mailbox. Approved email to a Gmail draft (S1), noticing a send (S2), any reply stops outreach (S3), reply sorting (S4).
// A fake Gmail only; invented banks and people. No network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { makeDir, put, account, config, ctxWith, SENDER, fakeClient, textReply, REPO } from './kit.mjs';
import { readJson, readJsonl } from '../src/store.mjs';
import { loadRules } from '../src/rules.mjs';
import { gmailClient, createGmailDraft, syncSends, syncInbox, sortReply, readReview } from '../src/mailbox.mjs';

const rules = loadRules();
const NOW = new Date('2026-11-17T15:00:00Z');
const TEXT = 'Subject: Multifamily loans\n\nHi Jordan,\n\nWe buy multifamily loans for our own account.\n\nPat Example\nPrincipal';
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64url');

function world({ status = 'approved', acct = account() } = {}) {
  const dir = makeDir();
  put(dir, 'senders.json', { senders: [SENDER] });
  put(dir, `accounts/${acct.id}.json`, acct);
  put(dir, 'touches.jsonl', `${JSON.stringify({ type: 'touch', accountId: acct.id, institution: acct.name, step: 1, channel: 'letter', sender: 'pat', date: '2026-11-10' })}\n`);
  put(dir, `drafts/${acct.id}/2-email.json`, { account: acct.id, channel: 'email', step: 2, sender: 'pat', date: '2026-11-17', status, subject: 'Multifamily loans', text: TEXT });
  return dir;
}
const ctxFor = (dir) => ({ ...ctxWith(), touches: readJsonl(join(dir, 'touches.jsonl')), suppression: readJson(join(dir, 'suppression.json'), { entries: [] }).entries });

// A fake Gmail: one mailbox, drafts that a "person" can send, an inbox.
function fakeGmail({ mailbox = SENDER.mailbox } = {}) {
  const g = { created: [], drafts: {}, threads: {}, inbox: [], messages: {}, calls: [] };
  g.client = {
    profile: async () => ({ emailAddress: mailbox }),
    createDraft: async (raw) => { const id = `d${g.created.length + 1}`; g.created.push(raw); g.drafts[id] = { id, message: { threadId: `t${id}` } }; g.threads[`t${id}`] = { id: `t${id}`, messages: [{ id: `m${id}`, labelIds: ['DRAFT'] }] }; return g.drafts[id]; },
    getDraft: async (id) => g.drafts[id] ?? null,
    getThread: async (id) => g.threads[id] ?? null,
    listMessages: async () => ({ messages: g.inbox.map((id) => ({ id })) }),
    getMessage: async (id) => g.messages[id] ?? Object.values(g.threads).flatMap((t) => t.messages).find((m) => m.id === id) ?? null,
  };
  g.sendFromGmail = (threadId, body, when = '2026-11-17T16:00:00Z') => { g.threads[threadId].messages = [{ id: `sent-${threadId}`, labelIds: ['SENT'], internalDate: String(Date.parse(when)), payload: { headers: [{ name: 'Subject', value: 'Multifamily loans' }], mimeType: 'text/plain', body: { data: b64(body) } } }]; };
  g.mail = (id, { from, subject = 'Re: Multifamily loans', snippet = '', threadId = 'tx', labelIds = ['INBOX'], extra = [] }) => { g.messages[id] = { id, threadId, labelIds, snippet, internalDate: String(Date.parse('2026-11-18T09:00:00Z')), payload: { headers: [{ name: 'From', value: from }, { name: 'Subject', value: subject }, ...extra] } }; g.inbox.push(id); };
  return g;
}

test('S1: an approved email becomes a plain-text Gmail draft from the sender; only approved drafts, once, and only if the guard allows', async () => {
  const dir = world(); const g = fakeGmail();
  const a = readJson(join(dir, 'accounts', 'acme-bank.json'));
  const r = await createGmailDraft({ dir, account: a, step: 2, ctx: ctxFor(dir), client: g.client, by: 'Pat Example', now: NOW });
  assert.equal(r.ok, true, JSON.stringify(r));
  const mime = Buffer.from(g.created[0], 'base64url').toString('utf8');
  assert.match(mime, /^From: Pat Example <pat@example\.test>\r\nTo: jordan@acmebank\.test\r\nSubject: Multifamily loans\r\n/);
  assert.match(mime, /Content-Type: text\/plain; charset=UTF-8/);
  assert.ok(!/<img|<a |text\/html|pixel/i.test(mime), 'no tracking, no HTML');
  assert.ok(mime.includes('We buy multifamily loans for our own account.'));
  assert.equal(readJson(join(dir, 'drafts', a.id, '2-email.json')).gmail.draftId, 'd1');
  assert.equal((await createGmailDraft({ dir, account: a, step: 2, ctx: ctxFor(dir), client: g.client, by: 'Pat', now: NOW })).blocked, 'already_drafted');
  assert.equal(g.created.length, 1);
  // Not approved: nothing is created.
  const d2 = world({ status: 'draft' }); const g2 = fakeGmail();
  assert.equal((await createGmailDraft({ dir: d2, account: a, step: 2, ctx: ctxFor(d2), client: g2.client, by: 'Pat', now: NOW })).blocked, 'not_approved');
  // The guard runs again: a suppression added after approval, or the kill switch, stops it.
  const d3 = world(); const g3 = fakeGmail();
  const ctx3 = ctxFor(d3); ctx3.suppression.push({ type: 'email', value: 'jordan@acmebank.test', reason: 'opt_out' });
  const refused = await createGmailDraft({ dir: d3, account: a, step: 2, ctx: ctx3, client: g3.client, by: 'Pat', now: NOW });
  assert.equal(refused.blocked, 'guard'); assert.equal(g3.created.length, 0);
  const d4 = world(); const g4 = fakeGmail(); const ctx4 = ctxFor(d4); ctx4.kill = true;
  assert.equal((await createGmailDraft({ dir: d4, account: a, step: 2, ctx: ctx4, client: g4.client, by: 'Pat', now: NOW })).blocked, 'guard');
  // The wrong mailbox is refused: the draft belongs in the sender's own Gmail.
  const d5 = world(); const g5 = fakeGmail({ mailbox: 'someone.else@example.test' });
  assert.equal((await createGmailDraft({ dir: d5, account: a, step: 2, ctx: ctxFor(d5), client: g5.client, by: 'Pat', now: NOW })).blocked, 'wrong_mailbox');
  assert.equal(g5.created.length, 0);
});

test('the Gmail client has five calls, none of which delivers mail, and the source names no delivery endpoint', async () => {
  const src = readFileSync(join(REPO, 'src', 'mailbox.mjs'), 'utf8');
  assert.ok(!/\/send\b|\.send\(|drafts\.send|messages\.send/i.test(src), 'a delivery endpoint is named in src/mailbox.mjs');
  assert.throws(() => gmailClient({ env: {} }), /GMAIL_CLIENT_ID/);
  const seen = [];
  const fetchImpl = async (url, init = {}) => { seen.push(`${init.method ?? 'GET'} ${String(url).replace('https://gmail.googleapis.com/gmail/v1/users/me', '').split('?')[0]}`); if (String(url).includes('oauth2')) return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 })); return new Response(JSON.stringify({ id: 'x', messages: [] })); };
  const c = gmailClient({ env: { GMAIL_CLIENT_ID: 'a', GMAIL_CLIENT_SECRET: 'b', GMAIL_REFRESH_TOKEN: 'c' }, fetchImpl });
  assert.deepEqual(Object.keys(c).sort(), ['createDraft', 'getDraft', 'getMessage', 'getThread', 'listMessages', 'profile']);
  await c.profile(); await c.createDraft('raw'); await c.getDraft('d1'); await c.getThread('t1'); await c.listMessages('q'); await c.getMessage('m1');
  assert.deepEqual(seen.filter((s) => !s.includes('oauth2')), ['GET /profile', 'POST /drafts', 'GET /drafts/d1', 'GET /threads/t1', 'GET /messages', 'GET /messages/m1']);
});

test('S2: a sync notices the draft was sent, records the touch with its real date, and flags an edit with banned words; text is never stored', async () => {
  const dir = world(); const g = fakeGmail();
  const a = readJson(join(dir, 'accounts', 'acme-bank.json'));
  await createGmailDraft({ dir, account: a, step: 2, ctx: ctxFor(dir), client: g.client, by: 'Pat Example', now: NOW });
  // Not sent yet: nothing happens.
  let r = await syncSends({ dir, accounts: [a], ctx: ctxFor(dir), client: g.client, rules, now: NOW });
  assert.deepEqual([r.checked, r.sent.length], [1, 0]);
  // Sent, with an edit that adds a banned word.
  g.sendFromGmail('td1', 'Hi Jordan,\n\nGiven the consent order, we buy multifamily loans.\n\nPat Example');
  r = await syncSends({ dir, accounts: [a], ctx: ctxFor(dir), client: g.client, rules, now: NOW });
  assert.deepEqual(r.sent.map((s) => [s.accountId, s.step, s.date]), [['acme-bank', 2, '2026-11-17']]);
  assert.equal(r.edited.length, 1); assert.ok(r.edited[0].codes.includes('BANNED_WORD'));
  const touches = readJsonl(join(dir, 'touches.jsonl')).filter((t) => t.type === 'touch' && t.step === 2);
  assert.deepEqual(touches.map((t) => [t.accountId, t.step, t.channel, t.date]), [['acme-bank', 2, 'email', '2026-11-17']]);
  const audits = readJsonl(join(dir, 'audit.jsonl'));
  assert.ok(audits.some((e) => e.type === 'sent_text_edited' && e.flagged));
  assert.ok(!JSON.stringify([touches, audits]).includes('consent order'), 'message text is not stored');
  // A second sync records nothing more.
  r = await syncSends({ dir, accounts: [a], ctx: ctxFor(dir), client: g.client, rules, now: NOW });
  assert.equal(r.sent.length, 0);
  assert.equal(readJsonl(join(dir, 'touches.jsonl')).filter((t) => t.type === 'touch').length, 2);
});

test('S2: a send that broke a rule is still recorded, with the violation kept', async () => {
  const dir = world(); const g = fakeGmail();
  const a = readJson(join(dir, 'accounts', 'acme-bank.json'));
  await createGmailDraft({ dir, account: a, step: 2, ctx: ctxFor(dir), client: g.client, by: 'Pat', now: NOW });
  g.sendFromGmail('td1', TEXT.split('\n\n').slice(1).join('\n\n'));
  const ctx = ctxFor(dir); ctx.suppression.push({ type: 'email', value: 'jordan@acmebank.test', reason: 'opt_out' });   // added after approval
  const r = await syncSends({ dir, accounts: [a], ctx, client: g.client, rules, now: NOW });
  assert.equal(r.sent.length, 1); assert.equal(r.violations.length, 1);
  assert.ok(readJsonl(join(dir, 'audit.jsonl')).some((e) => e.type === 'send_recorded_with_violations'));
  assert.equal(readJsonl(join(dir, 'touches.jsonl')).filter((t) => t.type === 'touch').length, 2);
});

test('S3: any reply stops outreach: by thread first, then by a verified domain; personal and unknown domains and shared domains go to review; bounces and opt-outs are handled', async () => {
  const dir = world(); const g = fakeGmail();
  const a = readJson(join(dir, 'accounts', 'acme-bank.json'));
  const b = account({ id: 'other-bank', name: 'Other Bank', domains: [{ domain: 'acmebank.test' }, { domain: 'otherbank.test' }], person: { ...account().person, email: 'kim@otherbank.test' } });
  put(dir, 'accounts/other-bank.json', b);
  await createGmailDraft({ dir, account: a, step: 2, ctx: ctxFor(dir), client: g.client, by: 'Pat', now: NOW });
  g.mail('m1', { from: 'Jordan Sample <jordan@acmebank.test>', threadId: 'td1', snippet: 'Thanks, let us talk next week.' });                 // by thread
  g.mail('m2', { from: 'Kim <kim@otherbank.test>', snippet: 'Interesting.' });                                                                  // by domain
  g.mail('m3', { from: 'Sam <sam@acmebank.test>' });                                                                                          // shared by two accounts
  g.mail('m4', { from: 'Lee <lee@gmail.com>' });                                                                                              // personal domain
  g.mail('m5', { from: 'Lee <lee@unknown-bank.test>' });                                                                                      // unknown domain
  g.mail('m6', { from: 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>', subject: 'Delivery Status Notification (Failure)', extra: [{ name: 'X-Failed-Recipients', value: 'kim@otherbank.test' }] });
  g.mail('m7', { from: 'Kim <kim@otherbank.test>', subject: 'Please unsubscribe me', snippet: 'Remove me from your list.' });
  g.mail('m8', { from: 'Kim <kim@otherbank.test>', subject: 'Automatic reply: out of office' });
  const r = await syncInbox({ dir, accounts: [a, b], ctx: ctxFor(dir), client: g.client, config: config(), now: NOW });
  assert.deepEqual(r.recorded.map((x) => [x.accountId, x.category]), [['acme-bank', 'reply'], ['other-bank', 'reply'], ['other-bank', 'bounce'], ['other-bank', 'opt_out'], ['other-bank', 'out_of_office']]);
  assert.deepEqual(readReview(dir).map((x) => [x.id, x.reason, x.domain]), [['m3', 'shared_domain', 'acmebank.test'], ['m4', 'personal_domain', 'gmail.com'], ['m5', 'unknown_domain', 'unknown-bank.test']]);
  const log = readJsonl(join(dir, 'touches.jsonl')).filter((e) => e.type !== 'touch');
  assert.deepEqual(log.map((e) => [e.accountId, e.type, e.note]), [['acme-bank', 'reply', 'reply'], ['other-bank', 'reply', 'reply'], ['other-bank', 'bounce', 'bounce'], ['other-bank', 'opt_out', 'opt_out'], ['other-bank', 'reply', 'out_of_office']]);
  const supp = readJson(join(dir, 'suppression.json')).entries;
  assert.ok(supp.some((e) => e.type === 'email' && e.value === 'kim@otherbank.test'), 'an opt-out suppresses the address at once');
  // Only a category and a date: no message text anywhere.
  const stored = JSON.stringify([log, readReview(dir), readJson(join(dir, 'mailbox', 'state.json'))]);
  for (const text of ['let us talk next week', 'Remove me from your list', 'Interesting']) assert.ok(!stored.includes(text), `stored "${text}"`);
  // A second sync reads nothing again.
  assert.equal((await syncInbox({ dir, accounts: [a, b], ctx: ctxFor(dir), client: g.client, config: config(), now: NOW })).read, 0);
});

test('S4: a model sorts replies into interested, not now, wrong person, out of office; opt-outs never reach it; an alert for interested; a failed model call is a plain reply', async () => {
  const dir = world(); const g = fakeGmail();
  const a = readJson(join(dir, 'accounts', 'acme-bank.json'));
  await createGmailDraft({ dir, account: a, step: 2, ctx: ctxFor(dir), client: g.client, by: 'Pat', now: NOW });
  g.mail('m1', { from: 'Jordan <jordan@acmebank.test>', threadId: 'td1', snippet: 'Yes, please send the one-page summary.' });
  g.mail('m2', { from: 'Jordan <jordan@acmebank.test>', threadId: 'td1', snippet: 'Not a fit this year.' });
  g.mail('m3', { from: 'Jordan <jordan@acmebank.test>', threadId: 'td1', subject: 'Re: stop emailing me', snippet: 'Stop emailing me.' });
  const asked = [];
  const modelClient = fakeClient([(req) => { asked.push(JSON.stringify(req)); return textReply({ category: 'interested' }); }, textReply({ category: 'not_now' })]);
  const models = { replySort: { model: 'claude-haiku-5-5', effort: 'low', maxTokens: 200 }, prices: { 'claude-haiku-5-5': { in: 0.1, out: 0.5 } } };
  const r = await syncInbox({ dir, accounts: [a], ctx: ctxFor(dir), client: g.client, config: config(), models, modelClient, now: NOW });
  assert.deepEqual(r.recorded.map((x) => x.category), ['interested', 'not_now', 'opt_out']);
  assert.equal(asked.length, 1, 'the opt-out was decided in code and never sent to the model');
  assert.deepEqual(r.alerts.map((x) => x.accountId), ['acme-bank']);
  assert.ok(asked[0].includes('<reply>') && !asked[0].includes('jordan@acmebank.test'), 'the address is not sent to the model');
  assert.deepEqual(readJsonl(join(dir, 'touches.jsonl')).filter((e) => e.type !== 'touch').map((e) => [e.type, e.note]), [['reply', 'interested'], ['reply', 'not_now'], ['opt_out', 'opt_out']]);
  // sortReply on its own: an invalid answer falls back to "reply".
  const bad = await sortReply({ client: fakeClient([textReply({ category: 'nonsense' })]), cfg: models.replySort, snippet: 'x' });
  assert.equal(bad.category, 'reply');
});
