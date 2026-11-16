// The call desk (the account's /call page), through web/lib/calldesk-ops.mjs, against the repository's fake Supabase REST API.
// A principal reads the approved call sheet while they dial and leave any voicemail themselves. These tests hold the rules that keep it
// that way: the sheet shows only when a person approved it AND the guard allows the call now; a refusal returns the reasons and never the
// words; the unit of work holds only the guard's files, the account and its drafts; and nothing on the page can make or record audio.
// The model is never called. Invented data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakePostgrest } from '../../test/postgrest-fake.mjs';
import { platformClient } from '../../src/platform/client.mjs';
import { snapshotFromDir } from '../../src/uow.mjs';
import { LOADS, callDeskLoads } from '../../src/uow.mjs';
import { setup, ID, ACCOUNT } from '../../test/calls-kit.mjs';
import { put } from '../../test/kit.mjs';
import { callDesk } from '../lib/calldesk-ops.mjs';
import { readTime, localClock, telHref, wordCount, TARGET_SECONDS, LONG_SECONDS } from '../lib/calldesk-view.mjs';

const URL_ = 'https://example-project.supabase.test';
const NAME = 'Acme Community Bank';
const READY = new Date('2026-11-16T16:30:00Z');    // a Monday, 10:30 in Chicago: inside the calling hours
const SUNDAY = new Date('2026-11-15T17:00:00Z');   // a Sunday, 11:00 in Chicago: outside them

const VOICEMAIL = 'Hello Jordan, this is Pat Example at Valley Capital Partners. We buy loans from banks that have decided to sell, in confidence. If it is useful, call me back.';
const OPENING = 'Hi Jordan, it is Pat Example at Valley Capital Partners. Is now a bad time for a short call?';
const SHEET = (over = {}) => ({
  account: ID, channel: 'call', step: 4, sender: 'pat', date: '2026-11-16', status: 'approved', approvedBy: 'Pat Example', approvedAt: '2026-11-15T12:00:00.000Z',
  text: `# Call sheet: Jordan Sample\n\n**Open with:** ${OPENING}\n\n**Voicemail (20 seconds):** ${VOICEMAIL}`,
  output: {
    why_now: 'The bank has said it plans to reduce multifamily exposure.', opening_line: OPENING,
    talking_points: [{ text: 'We buy loans in confidence, with no borrower contact.', fact_ids: ['acme-bank:F1'] }],
    questions_to_ask: ['How does your team vet buyers?'],
    likely_objections: [{ objection: 'We do not sell loans.', response: 'Understood. Some banks prefer to know who to call first.' }],
    voicemail_script: VOICEMAIL, best_time_note: 'Mornings, their time.',
  },
  ...over,
});
const tch = (step, channel, date) => ({ type: 'touch', accountId: ID, institution: NAME, step, channel, sender: 'pat', date });
const THREE = [tch(1, 'letter', '2026-11-02'), tch(2, 'email', '2026-11-06'), tch(3, 'linkedin_note', '2026-11-10')];   // so step 4, the call, is next

async function seeded({ touches = THREE, draft = SHEET(), suppression = [], acct } = {}) {
  const fake = fakePostgrest();
  const client = platformClient({ url: URL_, key: 'anon-key', accessToken: 'user:pat@example.test', fetchImpl: fake.fetchImpl });
  const dir = setup({ touches, suppression, ...(acct ? { acct } : {}) });
  if (draft) put(dir, `drafts/${ID}/${draft.step}-call.json`, draft);
  const snap = snapshotFromDir(dir);
  await client.flush({ docs: [...Object.entries(snap.docs).map(([p, body]) => ({ path: p, kind: 'json', body, baseVersion: 0 })), ...Object.entries(snap.texts).map(([p, text]) => ({ path: p, kind: 'text', text, baseVersion: 0 }))], lines: Object.entries(snap.logs).flatMap(([p, ls]) => ls.map((l) => ({ path: p, line: l }))) });
  return { fake, client };
}

test('an approved call sheet for the next step shows, with the sender\'s own number and a local clock', async () => {
  const { client } = await seeded();
  const d = await callDesk(client, ID, { now: READY });
  assert.equal(d.state, 'ready');
  assert.equal(d.step, 4);
  assert.equal(d.sheet.voicemail, VOICEMAIL);
  assert.equal(d.sheet.openingLine, OPENING);
  assert.deepEqual(d.sheet.talkingPoints, ['We buy loans in confidence, with no borrower contact.']);
  assert.equal(d.sheet.objections[0].objection, 'We do not sell loans.');
  assert.deepEqual(d.sender, { name: 'Pat Example', title: 'Principal', phone: '555-0100' }, 'the callback number is senders.json\'s, not the model\'s');
  assert.equal(d.approvedBy, 'Pat Example');
  assert.deepEqual(d.hours, [9, 17]);
  assert.match(d.localTime, /Mon.*10:30 AM.*America\/Chicago/);
  assert.ok(!JSON.stringify(d).includes('acme-bank:F1'), 'internal fact ids are not passed to the page');
});

test('the desk holds nothing but the sheet: no research, facts, findings or pipeline data ever reach it', async () => {
  const { client } = await seeded();   // setup() also stores research, facts, candidates and a paper estimate for this account
  const all = JSON.stringify(await callDesk(client, ID, { now: READY }));
  for (const leak of ['27,182,818', 'Example Grove', 'receiver was appointed', '812345', '43.21', 'Multifamily noncurrent']) assert.ok(!all.includes(leak), `must not hold: ${leak}`);
});

test('a draft that is not approved never shows its words', async () => {
  for (const status of ['draft', 'blocked', 'forgotten']) {
    const { client } = await seeded({ draft: SHEET({ status }) });
    const d = await callDesk(client, ID, { now: READY });
    assert.equal(d.state, 'not_approved', status);
    assert.equal(d.draftStatus, status);
    assert.ok(!JSON.stringify(d).includes('call me back'), `${status}: the script must not be returned`);
    assert.equal(d.sheet, undefined);
  }
});

test('no call sheet for the next step, a next step that is not a call, and a finished sequence each say so', async () => {
  let { client } = await seeded({ draft: null });
  assert.equal((await callDesk(client, ID, { now: READY })).state, 'no_draft');

  ({ client } = await seeded({ draft: SHEET({ step: 4 }), touches: [tch(1, 'letter', '2026-11-02')] }));   // next is step 2, an email
  const notCall = await callDesk(client, ID, { now: READY });
  assert.equal(notCall.state, 'not_a_call_step');
  assert.deepEqual(notCall.expected, { step: 2, channel: 'email' });
  assert.equal(notCall.sheet, undefined);

  ({ client } = await seeded({ touches: [...THREE, tch(4, 'call', '2026-11-14'), tch(5, 'email', '2026-11-16')] }));
  assert.equal((await callDesk(client, ID, { now: READY })).state, 'sequence_complete');

  // a draft for a step that is no longer next (the log moved on) is not shown for the new step
  ({ client } = await seeded({ draft: SHEET({ step: 3 }) }));
  assert.equal((await callDesk(client, ID, { now: READY })).state, 'no_draft');
});

test('when the guard refuses the call the reasons come back and the sheet does not, whatever was approved', async () => {
  const hidden = (d) => { const all = JSON.stringify(d); assert.ok(!all.includes('call me back') && !all.includes(OPENING) && !all.includes('555-0100'), 'no part of the sheet or the sender number'); assert.equal(d.sheet, undefined); };

  // outside the calling hours, in their time zone
  let { client } = await seeded();
  let d = await callDesk(client, ID, { now: SUNDAY });
  assert.equal(d.state, 'blocked');
  assert.ok(d.errors.some((e) => e.code === 'OUTSIDE_CALL_HOURS'));
  hidden(d);

  // someone else at the bank replied: the whole bank is closed
  ({ client } = await seeded({ touches: [...THREE, { type: 'reply', accountId: 'other-contact', institution: NAME, date: '2026-11-12' }] }));
  d = await callDesk(client, ID, { now: READY });
  assert.equal(d.state, 'blocked');
  assert.ok(d.errors.some((e) => e.code === 'SEQUENCE_STOPPED'));
  hidden(d);

  // the institution was suppressed after the sheet was approved
  ({ client } = await seeded({ suppression: [{ type: 'institution', value: NAME, reason: 'asked not to be contacted', added: '2026-11-15' }] }));
  d = await callDesk(client, ID, { now: READY });
  assert.ok(d.errors.some((e) => e.code === 'SUPPRESSED_INSTITUTION'));
  hidden(d);

  // the sheet's own text names an asset under NDA
  ({ client } = await seeded({ draft: SHEET({ text: 'Open with: ask about the Harbor View Hotel loan.' }), suppression: [{ type: 'asset', value: 'Harbor View Hotel', reason: 'under NDA', added: '2026-11-01' }] }));
  d = await callDesk(client, ID, { now: READY });
  assert.ok(d.errors.some((e) => e.code === 'SUPPRESSED_ASSET_NAMED'));
  hidden(d);
});

test('a mobile or unknown number is refused: only business landlines are called', async () => {
  for (const phoneType of ['mobile', undefined]) {
    const { client } = await seeded({ acct: ACCOUNT({ person: { ...ACCOUNT().person, phoneType } }) });
    const d = await callDesk(client, ID, { now: READY });
    assert.equal(d.state, 'blocked', String(phoneType));
    assert.ok(d.errors.some((e) => e.code === 'PHONE_NOT_BUSINESS_LINE'));
    assert.equal(d.sheet, undefined);
  }
});

test('no account gives null, and an unsafe id is refused before it becomes a path', async () => {
  const { client } = await seeded();
  assert.equal(await callDesk(client, 'no-such-bank', { now: READY }), null);
  await assert.rejects(callDesk(client, '../secrets', { now: READY }));
  await assert.rejects(callDesk(client, '', { now: READY }), /required/);
});

test('the unit of work is narrow: the guard\'s files, one account, its own drafts, and never research or any pipeline data', () => {
  assert.deepEqual(callDeskLoads(ID), ['senders.json', 'suppression.json', 'touches.jsonl', 'KILL', `accounts/${ID}.json`, `drafts/${ID}/`]);
  for (const p of LOADS.callDesk) for (const bad of ['research/', 'facts/', 'briefs/', 'paper/', 'routes/', 'network/', 'regulatory/', 'sources/', 'candidates/', 'pilot/', 'backtest/', 'sales/', 'calls/']) assert.ok(!p.startsWith(bad), `${p} must not be loaded`);
  assert.throws(() => callDeskLoads('../x'));
});

test('the read-aloud estimate: 2.5 words a second, with a target and a limit', () => {
  assert.equal(wordCount('  one two\nthree  '), 3);
  assert.equal(wordCount(null), 0);
  const fifty = Array(50).fill('word').join(' ');
  assert.deepEqual(readTime(fifty), { words: 50, seconds: 20, verdict: 'ok' });
  assert.equal(readTime(Array(60).fill('w').join(' ')).verdict, 'long');
  assert.equal(readTime(Array(80).fill('w').join(' ')).verdict, 'too_long');
  assert.equal(readTime('').seconds, 0);
  assert.equal(readTime(fifty, 5).seconds, 10, 'the pace can be changed');
  assert.ok(TARGET_SECONDS < LONG_SECONDS);
  assert.equal(readTime(VOICEMAIL).verdict, 'ok', 'the sample voicemail fits in the target');
});

test('the local clock and the tel: link are safe with bad input', () => {
  assert.match(localClock(READY, 'America/Chicago'), /^Mon 10:30 AM \(America\/Chicago\)$/);
  assert.match(localClock(READY, 'America/Los_Angeles'), /8:30 AM/);
  assert.equal(localClock(READY, ''), null);
  assert.equal(localClock(READY, 'Not/A_Zone'), null);
  assert.equal(telHref('(555) 019-9000'), 'tel:5550199000');
  assert.equal(telHref('+1 555 019 9000'), 'tel:+15550199000');
  assert.equal(telHref('555-0199'), 'tel:5550199', 'seven digits is enough to dial locally');
  assert.equal(telHref('12345'), null);
  assert.equal(telHref('555-0199"><script>'), 'tel:5550199', 'only digits survive');
  assert.equal(telHref(undefined), null);
});

test('the call desk cannot make, play or record audio, and cannot write or send anything', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const files = [join(here, '..', 'app', 'accounts', '[id]', 'call', 'page.jsx'), join(here, '..', 'app', 'accounts', '[id]', 'call', 'prompter.jsx'), join(here, '..', 'lib', 'calldesk-ops.mjs'), join(here, '..', 'lib', 'calldesk-view.mjs')];
  const AUDIO = /getUserMedia|mediaDevices|MediaRecorder|AudioContext|webkitAudioContext|new Audio\b|<audio|<video|speechSynthesis|SpeechSynthesis|SpeechRecognition|webkitSpeech|\.play\(\)|createMediaStream|captureStream|RTCPeerConnection/;
  const WRITES = /'use server'|<form\b|\baction=|unitOfWork\([^)]*\)[^]*\bflush\(|\.flush\(|recordObservedSend|recordEvent|addSuppression|fetch\(/;
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    assert.ok(!AUDIO.test(src), `${f} must not use any audio API`);
    assert.ok(!WRITES.test(src), `${f} must not write, send or fetch`);
  }
  const page = readFileSync(files[0], 'utf8');
  assert.ok(!/\.\.\/actions/.test(page), 'the page imports no server actions');
});
