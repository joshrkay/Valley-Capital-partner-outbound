// PRD E10: quarterly follow-up. A nurture touch is allowed only after the sequence is complete, inside a window, once a quarter, never
// after a reply, opt-out, meeting or handoff; it shares one published page and nothing else. Invented banks only; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { account, config, ctxWith, SENDER, touch } from './kit.mjs';
import { loadRules } from '../src/rules.mjs';
import { checkTouch, dueList, nurtureWindow, quarterOf, touchFromAccount, isNurtureStep } from '../src/guard.mjs';
import { lintOutput, buildDraftPrompt } from '../src/draft.mjs';

const rules = loadRules();
const A = account();
const SEQ = [[1, 'letter', '2026-08-03'], [2, 'email', '2026-08-06'], [3, 'linkedin_note', '2026-08-10'], [4, 'call', '2026-08-14'], [5, 'email', '2026-08-21']];
const done = () => SEQ.map(([step, channel, date]) => ({ type: 'touch', accountId: A.id, institution: A.name, step, channel, sender: 'pat', date }));
const nurtureTouch = (date = '2026-12-10', step = 'nurture-2026Q4', over = {}) => touch(A, { channel: 'email', step, date, ...over });
const codes = (r) => r.errors.map((e) => e.code);
const ctx = (touches = done(), over = {}) => ctxWith({ touches, ...over });

test('windows open on the configured dates and close at quarter end', () => {
  const nu = config().nurture;
  assert.deepEqual(nu.windows, ['03-10', '06-10', '09-10', '12-10']);
  assert.equal(nurtureWindow('2026-03-09', nu), null);
  assert.deepEqual(nurtureWindow('2026-03-10', nu), { quarter: '2026Q1', opens: '2026-03-10', closes: '2026-03-31' });
  assert.equal(nurtureWindow('2026-03-31', nu).quarter, '2026Q1');
  assert.equal(nurtureWindow('2026-04-01', nu), null);
  assert.equal(nurtureWindow('2026-12-31', nu).closes, '2026-12-31');
  assert.equal(nurtureWindow('2026-08-15', nu), null);
  assert.equal(nurtureWindow('2026-06-10', { windows: ['06-10'] }).closes, '2026-06-30');
  assert.equal(quarterOf('2026-11-16'), '2026Q4');
  assert.ok(isNurtureStep('nurture-2026Q4') && !isNurtureStep(5));
});

test('a nurture touch is allowed after the sequence, inside a window; every other case is refused with its own code', () => {
  assert.equal(checkTouch(nurtureTouch(), ctx()).allowed, true, JSON.stringify(checkTouch(nurtureTouch(), ctx()).errors));
  assert.ok(codes(checkTouch(nurtureTouch('2026-11-20'), ctx())).includes('NURTURE_NO_WINDOW'), 'outside a window');
  assert.ok(codes(checkTouch(nurtureTouch(), ctx(done().slice(0, 4)))).includes('NURTURE_TOO_EARLY'), 'sequence not complete');
  assert.ok(codes(checkTouch(nurtureTouch('2026-12-10', 'nurture-2026Q4', { channel: 'letter' }), ctx())).includes('NURTURE_CHANNEL'));
  const off = config(); off.nurture.enabled = false;
  assert.ok(codes(checkTouch(nurtureTouch(), ctxWith({ touches: done(), cfg: off }))).includes('NURTURE_OFF'));
  // One a quarter: a second in the same quarter is refused; the next quarter's window is open again.
  const first = { type: 'touch', accountId: A.id, institution: A.name, step: 'nurture-2026Q4', channel: 'email', sender: 'pat', date: '2026-12-10' };
  assert.ok(codes(checkTouch(nurtureTouch('2026-12-20'), ctx([...done(), first]))).includes('NURTURE_QUARTER_CAP'));
  const raised = config(); raised.nurture.maxPerQuarter = 2;
  assert.equal(checkTouch(nurtureTouch('2026-12-20'), ctxWith({ touches: [...done(), first], cfg: raised })).allowed, true, 'configurable');
});

test('never after a reply, opt-out, meeting or handoff', () => {
  for (const type of ['reply', 'opt_out', 'meeting', 'handoff']) {
    const stopped = [...done(), { type, accountId: A.id, institution: A.name, date: '2026-09-01' }];
    assert.ok(codes(checkTouch(nurtureTouch(), ctx(stopped))).includes('SEQUENCE_STOPPED'), type);
  }
});

test('nurture touches are not sequence steps: a regular sixth step is still refused, and a nurture touch does not move the sequence', () => {
  const touches = [...done(), { type: 'touch', accountId: A.id, institution: A.name, step: 'nurture-2026Q4', channel: 'email', sender: 'pat', date: '2026-12-10' }];
  assert.ok(codes(checkTouch(touch(A, { channel: 'email', step: 6, date: '2027-03-12' }), ctx(touches))).includes('SEQUENCE_COMPLETE'));
  assert.equal(checkTouch(nurtureTouch('2027-03-12', 'nurture-2027Q1'), ctx(touches)).allowed, true, 'the next quarter');
});

test('the due list shows an account due a follow-up only inside a window, once a quarter, for a person to approve', () => {
  const inWin = dueList([A], ctx(), { date: '2026-12-12', sender: 'pat' })[0];
  assert.deepEqual([inWin.state, inWin.step, inWin.channel, inWin.window.closes], ['nurture_due', 'nurture-2026Q4', 'email', '2026-12-31']);
  assert.equal(dueList([A], ctx(), { date: '2026-11-20', sender: 'pat' })[0].state, 'sequence_complete');
  const have = [...done(), { type: 'touch', accountId: A.id, institution: A.name, step: 'nurture-2026Q4', channel: 'email', sender: 'pat', date: '2026-12-10' }];
  assert.equal(dueList([A], ctx(have), { date: '2026-12-20', sender: 'pat' })[0].state, 'sequence_complete');
  const replied = [...done(), { type: 'reply', accountId: A.id, institution: A.name, date: '2026-09-01' }];
  assert.equal(dueList([A], ctx(replied), { date: '2026-12-12', sender: 'pat' })[0].state, 'sequence_complete');
  // A sequence still under way is unchanged.
  assert.equal(dueList([A], ctx(done().slice(0, 2)), { date: '2026-12-12', sender: 'pat' })[0].step, 3);
});

const BODY = 'Hello again. Our team keeps a short library of plain notes for people who work with commercial real estate loans, and I thought the page below might be worth a few minutes of your time. It needs no answer from you, and there is nothing to send us. If it is not useful, please set it aside. {{page:/blog/}} Thank you for reading, and I hope the week treats you well.';
const lint = (body, step = 'nurture-2026Q4', subject = 'A note you may find useful') => lintOutput({ channel: 'email', account: A, out: { subject, body, personalization: [] }, facts: [], allFacts: [], rules, sender: SENDER, step }).errors.map((e) => e.code);

test('a nurture draft shares one published page: no claim, no other page, no quarter-end, no required claim; a normal email still needs its claim', () => {
  assert.deepEqual(lint(BODY), []);
  assert.ok(lint(BODY.replace('{{page:/blog/}}', '{{page:/banks/what-we-buy/}}')).includes('LINK_NOT_ALLOWED'), 'a page the nurture list does not hold');
  assert.ok(lint(BODY.replace('{{page:/blog/}}', '{{page:/no-such-page/}}')).includes('LINK_NOT_ALLOWED'), 'a page not on the site');
  assert.ok(lint(BODY.replace('{{page:/blog/}}', '')).includes('NURTURE_NO_LINK'));
  assert.ok(lint(`${BODY} {{claim:confidential-no-borrower-contact}}`).includes('NURTURE_CLAIM'));
  assert.ok(lint(BODY.replace('Thank you', 'Please read it before quarter-end. Thank you')).includes('BLUNT_ASK'), 'the existing rule against pressing with quarter-end still holds');
  assert.ok(lint(BODY.replace('Thank you', 'It is a busy time at quarter-end. Thank you')).includes('NURTURE_QUARTER_END'), 'and a nurture draft never mentions it at all');
  assert.ok(lint(BODY.replace('Thank you', 'It is a busy time at year-end. Thank you')).includes('NURTURE_QUARTER_END'));
  assert.ok(!lint(BODY).includes('CLAIM_REQUIRED'));
  // The same body as a numbered step still needs the bank email's required claim.
  assert.ok(lint(BODY, undefined).includes('CLAIM_REQUIRED') || lint(BODY, 5).includes('CLAIM_REQUIRED'));
});

test('the nurture prompt tells the drafter to ask for nothing, names only live nurture pages, and carries no claim list', () => {
  const sender = SENDER;
  const { system, user } = buildDraftPrompt({ account: A, channel: 'email', step: 'nurture-2026Q4', sender, facts: [], claims: rules.claims, priorTouches: [], rules });
  assert.match(system, /QUARTERLY FOLLOW-UP/);
  assert.match(system, /Never mention a deadline, a quarter-end/);
  assert.match(system, /never recommend or name any other firm or person/);
  assert.deepEqual(JSON.parse(user.match(/<pages>(.*)<\/pages>/)[1]), ['/blog/', '/library/']);
  assert.deepEqual(JSON.parse(user.match(/<required_claims>(.*)<\/required_claims>/)[1]), []);
  const normal = buildDraftPrompt({ account: A, channel: 'email', step: 5, sender, facts: [], claims: rules.claims, priorTouches: [], rules });
  assert.ok(!/QUARTERLY FOLLOW-UP/.test(normal.system));
  assert.ok(JSON.parse(normal.user.match(/<required_claims>(.*)<\/required_claims>/)[1]).length > 0);
});

test('the configured nurture pages are live pages on the site', () => {
  for (const p of rules.config.nurture.linkTargets) assert.ok(rules.pages.has(p), `${p} is not on the site`);
  assert.equal(touchFromAccount(A, { channel: 'email', step: 'nurture-2026Q4', date: '2026-12-10', sender: 'pat' }).step, 'nurture-2026Q4');
});
