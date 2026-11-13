// The web app's server helpers (web/lib), against the repository's fake Supabase REST API. Invented data only; no network, no browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fakePostgrest } from '../../test/postgrest-fake.mjs';
import { platformClient } from '../../src/platform/client.mjs';
import { engine, engineRoot } from '../lib/engine.mjs';
import { restReader } from '../lib/rest.mjs';
import { visibleCandidates, certOf } from '../lib/candidates-view.mjs';
import { parseMarkdown, parseInline } from '../lib/markdown.mjs';
import { isServiceKey, supabaseEnv } from '../lib/env.mjs';
import { period, moneyThousands, pct, source } from '../lib/format.mjs';
import * as ops from '../lib/ops.mjs';

const URL_ = 'https://example-project.supabase.test';
const PAT = 'user:pat@example.test';
const item = (key, name, tier, score, over = {}) => ({ key, cert: certOf(key), name, tier, score, axes: { distress: 30, fit: 25, timing: 10 }, metros: ['31080'], metroLabels: ['Los Angeles'], sectors: ['multifamily'], filtersFailed: [], signals: [{ id: `${key}:sig:20260630` }], profile: { categories: [{ id: 'multifamily', short: 'Multifamily', sectors: ['multifamily'], noncurrentRatio: 0.04, balance: { value: 1000 }, fit: { buys: true, sectors: ['multifamily'] } }] }, latestRepdte: '20260630', card: { text: `card for ${name}`, sentences: [] }, ...over });

// The fake serves documents, log_lines, candidates and the RPCs; this adds the two tables the web app also reads.
function setup({ principals = [{ email: 'pat@example.test', name: 'Pat Example', active: true }, { email: 'gone@example.test', name: 'Gone', active: false }] } = {}) {
  const fake = fakePostgrest({ principals: principals.filter((p) => p.active).map((p) => p.email) });
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const table = u.pathname.replace(/^\/rest\/v1\//, '');
    const token = String(init.headers?.Authorization ?? '').replace(/^Bearer /, '');
    const isPrincipal = token.startsWith('user:') && principals.some((p) => p.active && p.email === token.slice(5));
    if (init.method === 'GET' && table === 'principals') {
      const email = u.searchParams.get('email')?.replace(/^eq\./, '');
      return new Response(JSON.stringify(isPrincipal ? principals.filter((p) => p.email === email) : []), { status: 200 });
    }
    if (init.method === 'GET' && table === 'jobs') return new Response(JSON.stringify(isPrincipal ? [...fake.jobs].reverse() : []), { status: 200 });
    return fake.fetchImpl(url, init);
  };
  const client = platformClient({ url: URL_, key: 'anon-key', accessToken: PAT, fetchImpl });
  const rest = restReader({ url: URL_, key: 'anon-key', accessToken: PAT, fetchImpl });
  return { fake, client, rest, fetchImpl };
}
const seed = (fake, path, body) => fake.docs.set(path, { path, kind: 'json', body, text: null, version: 1 });
const seedLatest = async (client, items) => client.flush({ docs: [{ path: 'candidates/latest.json', kind: 'json', body: { runId: 'score-1', provisional: true, items }, baseVersion: 0 }], lines: [] });

test('the engine is found in the repository and loaded as real modules', async () => {
  assert.ok(engineRoot().endsWith('Valley-Capital-partner-outbound') || (await import('node:fs')).existsSync(`${engineRoot()}/src/uow.mjs`));
  const { LOADS } = await engine('src/uow.mjs');
  assert.ok(LOADS.candidates.includes('candidates/'));
});

test('the list hides suppressed and decided banks, shows A and B by default, and brings back a dismissed bank with a new signal', async () => {
  const { fake, client } = setup();
  await seedLatest(client, [item('fdic:1', 'Alpha Bank', 'A', 90), item('fdic:2', 'Bravo Bank', 'A', 80), item('fdic:3', 'Charlie Bank', 'B', 50), item('fdic:4', 'Delta Bank', null, 10), item('fdic:5', 'Echo Bank', 'B', 40), item('fdic:6', 'Foxtrot Bank', 'B', 30)]);
  seed(fake, 'suppression.json', { entries: [{ type: 'institution', value: 'Bravo Bank', reason: 'under NDA' }] });
  seed(fake, 'candidates/decisions.json', {
    'fdic:3': { status: 'promoted', by: 'Pat', accountId: 'charlie-bank' },
    'fdic:5': { status: 'dismissed', by: 'Pat', reason: 'no', signalIds: ['fdic:5:sig:20260630'] },
    'fdic:6': { status: 'dismissed', by: 'Pat', reason: 'no', signalIds: ['fdic:6:old-signal'] },   // a signal fired since: it returns
  });
  const rows = await ops.listCandidates(client, {});
  assert.deepEqual(rows.map((r) => [r.key, r.status]), [['fdic:1', 'new'], ['fdic:6', 'returned']]);
  assert.deepEqual((await ops.listCandidates(client, { tier: 'all' })).map((r) => r.key), ['fdic:1', 'fdic:6', 'fdic:4']);
});

test('promote, dismiss and snooze run the engine\'s own functions through a unit of work', async () => {
  const { fake, client } = setup();
  await seedLatest(client, [item('fdic:1', 'Alpha Bank', 'A', 90), item('fdic:2', 'Bravo Bank', 'B', 60)]);
  const p = await ops.promote(client, { key: 'fdic:1', by: 'Pat Example' });
  assert.equal(p.accountId, 'alpha-bank');
  assert.equal(p.leadSector, 'multifamily');
  assert.equal(fake.docs.get('accounts/alpha-bank.json').body.pipeline.key, 'fdic:1');
  await assert.rejects(ops.dismiss(client, { key: 'fdic:2', by: 'Pat Example', reason: ' ' }), /A reason is required/);
  await ops.snooze(client, { key: 'fdic:2', by: 'Pat Example', until: '2099-01-01' });
  assert.equal(fake.docs.get('candidates/decisions.json').body['fdic:2'].status, 'snoozed');
  const d = await ops.candidateDetail(client, 'fdic:2');
  assert.equal(d.decision.status, 'snoozed'); assert.equal(d.suppressed, false);
});

test('a suppressed bank cannot be promoted from the web either', async () => {
  const { fake, client } = setup();
  await seedLatest(client, [item('fdic:1', 'Alpha Bank', 'A', 90)]);
  seed(fake, 'suppression.json', { entries: [{ type: 'institution', value: 'Alpha Bank', reason: 'regulator' }] });
  await assert.rejects(ops.promote(client, { key: 'fdic:1', by: 'Pat Example' }), /suppressed/);
  assert.equal((await ops.candidateDetail(client, 'fdic:1')).suppressed, true);
});

test('naming the person resets the role; confirming needs a name first', async () => {
  const { fake, client } = setup();
  seed(fake, 'accounts/alpha-bank.json', { id: 'alpha-bank', name: 'Alpha Bank', type: 'bank', person: { name: '' }, contact: { roleConfirmed: false } });
  await assert.rejects(ops.confirmRole(client, { id: 'alpha-bank', by: 'Pat' }), /Name the person/);
  await ops.setPerson(client, { id: 'alpha-bank', name: 'Jordan Sample', title: 'Chief Credit Officer', by: 'Pat' });
  await ops.confirmRole(client, { id: 'alpha-bank', by: 'Pat' });
  const a = fake.docs.get('accounts/alpha-bank.json').body;
  assert.deepEqual([a.person.name, a.contact.roleConfirmed, a.contact.roleConfirmedBy], ['Jordan Sample', true, 'Pat']);
  assert.ok(fake.lines.some((l) => l.line.type === 'person_set') && fake.lines.some((l) => l.line.type === 'role_confirmed'));
  await assert.rejects(ops.setPerson(client, { id: '../etc', name: 'x', by: 'Pat' }), /Invalid id|was not loaded/);
});

test('research on a pipeline account is refused until the pilot passes, then queued as a job', async () => {
  const { fake, client } = setup();
  seed(fake, 'accounts/alpha-bank.json', { id: 'alpha-bank', name: 'Alpha Bank', type: 'bank', originSignals: ['s1'], person: {} });
  await assert.rejects(ops.queueResearch(client, { id: 'alpha-bank' }), /has not passed its pilot/);
  assert.equal(fake.jobs.length, 0);
  seed(fake, 'pilot/status.json', { passed: true, by: 'Pat' });
  await ops.queueResearch(client, { id: 'alpha-bank' });
  assert.deepEqual([fake.jobs[0].kind, fake.jobs[0].params], ['research.run', { account: 'alpha-bank' }]);
  const detail = await ops.accountDetail(client, 'alpha-bank');
  assert.equal(detail.gate.allowed, true); assert.equal(detail.brief, null); assert.equal(detail.research, null);
});

test('drafts are queued only for allowed channels and steps, and approval needs a saved draft', async () => {
  const { fake, client } = setup();
  await assert.rejects(ops.queueDraft(client, { id: 'alpha-bank', channel: 'sms', step: 1 }), /not an allowed channel/);
  await assert.rejects(ops.queueDraft(client, { id: 'alpha-bank', channel: 'email', step: 0 }), /whole number/);
  await ops.queueDraft(client, { id: 'alpha-bank', channel: 'email', step: 2 });
  assert.deepEqual(fake.jobs[0].params, { account: 'alpha-bank', channel: 'email', step: 2 });
  seed(fake, 'accounts/alpha-bank.json', { id: 'alpha-bank', name: 'Alpha Bank', type: 'bank', person: { name: 'Jordan Sample' } });
  await assert.rejects(ops.approve(client, { id: 'alpha-bank', channel: 'email', step: 2, by: 'Pat' }), /No draft at/);
  seed(fake, 'drafts/alpha-bank/2-email.json', { account: 'alpha-bank', channel: 'email', step: 2, status: 'blocked', subject: 's', text: 't', lint: { errors: [{ code: 'X', message: 'm' }], warnings: [] }, createdAt: '2026-11-13T00:00:00Z' });
  const list = await ops.listDrafts(client);
  assert.deepEqual(list.map((d) => [d.account, d.status, d.errors.length]), [['alpha-bank', 'blocked', 1]]);
});

test('pilot verdicts and the scorecard go through the engine', async () => {
  const { fake, client } = setup();
  seed(fake, 'research/acme-bank.json', { account: 'acme-bank', date: '2026-11-10', findings: [{ id: 'F1', kind: 'structure', use: 'draft', claim: 'c', quote: 'q', source_url: 'https://example.test/1' }], dropped: [], run: { costUsd: 1 } });
  seed(fake, 'pilot/acme-bank.truth.json', { account: 'acme-bank', sections: [] });
  await ops.markVerdict(client, { id: 'acme-bank', findingId: 'F1', verdict: 'false', by: 'Pat' });
  const { card, status } = await ops.pilotOverview(client);
  assert.equal(card.totals.fabrications, 1); assert.equal(status.passed, false);
  const r = await ops.passPilot(client, { by: 'Pat' });
  assert.equal(r.ok, false); assert.match(r.reasons.join(' '), /marked false/);
  assert.equal((await ops.pilotReview(client, 'acme-bank')).findings[0].verdict, 'false');
});

test('status reads runs and jobs with the principal\'s token, and long work is queued, not run', async () => {
  const { fake, client, rest } = setup();
  fake.lines.push({ id: 1, path: 'sources/runs.jsonl', line: { source: 'fdic', outcome: 'ok', rowsRead: 5 }, by: 'service' });
  await ops.queueSources(client); await ops.queueScore(client, { draftBuybox: true });
  const s = await ops.statusOverview(rest);
  assert.equal(s.runs[0].outcome, 'ok');
  assert.deepEqual(s.jobs.map((j) => [j.kind, j.params]), [['score.run', { draftBuybox: true }], ['sources.fdic', {}]]);
  assert.deepEqual(s.kill, { config: false, document: false });
});

test('the principal check: active principals only', async () => {
  const { rest, fetchImpl } = setup();
  assert.equal((await rest.principal('PAT@example.test')).name, 'Pat Example');
  const gone = restReader({ url: URL_, key: 'anon-key', accessToken: 'user:gone@example.test', fetchImpl });
  assert.equal(await gone.principal('gone@example.test'), null);
  assert.equal(await rest.principal(''), null);
});

test('visibleCandidates is pure and treats a snooze as over on its date', () => {
  const never = () => null;
  const rows = [{ key: 'fdic:1', name: 'A' }, { key: 'fdic:2', name: 'B' }];
  const decisions = { 'fdic:1': { status: 'snoozed', until: '2026-12-01' }, 'fdic:2': { status: 'snoozed', until: '2026-11-20' } };
  assert.deepEqual(visibleCandidates({ rows, decisions, suppressedBy: never, today: '2026-11-20' }).map((r) => r.key), ['fdic:2']);
});

test('briefs render as text: markup, scripts and unsafe links stay inert', () => {
  const blocks = parseMarkdown('# Brief: <script>alert(1)</script>\n\n- **[F1]** claim — [link](https://example.test/a) · [bad](javascript:alert(1))\n- second\n\nA paragraph\nthat wraps.');
  assert.equal(blocks[0].t, 'h2');
  assert.deepEqual(blocks[0].spans, [{ t: 'text', v: 'Brief: <script>alert(1)</script>' }]);
  const li = blocks[1].items[0];
  assert.deepEqual(li.filter((s) => s.t === 'link').map((s) => s.href), ['https://example.test/a']);
  assert.ok(li.filter((s) => s.t === 'text').map((s) => s.v).join('').includes('[bad](javascript:alert(1))'), 'the unsafe link stays plain text');
  assert.equal(blocks[2].spans[0].v, 'A paragraph that wraps.');
  assert.deepEqual(parseInline('`code` and **bold**').map((s) => s.t), ['code', 'text', 'bold']);
});

test('the app refuses a service-role key and needs its settings', () => {
  const jwt = (claims) => `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.y`;
  assert.equal(isServiceKey(jwt({ role: 'service_role' })), true);
  assert.equal(isServiceKey(jwt({ role: 'anon' })), false);
  assert.equal(isServiceKey('sb_secret_abc'), true);
  assert.equal(isServiceKey('sb_publishable_abc'), false);
  assert.throws(() => supabaseEnv({}), /not configured/);
  assert.throws(() => supabaseEnv({ SUPABASE_URL: URL_, SUPABASE_ANON_KEY: jwt({ role: 'service_role' }) }), /service-role key/);
  assert.deepEqual(supabaseEnv({ SUPABASE_URL: URL_, SUPABASE_ANON_KEY: 'sb_publishable_abc' }), { url: URL_, key: 'sb_publishable_abc' });
});

test('formatting: periods, thousands of dollars, ratios and source lines', () => {
  assert.equal(period('20260630'), 'June 30, 2026');
  assert.equal(moneyThousands(981766), '$981.8M'); assert.equal(moneyThousands(1600000), '$1.6B'); assert.equal(moneyThousands(466), '$466K');
  assert.equal(pct(0.0476), '4.76%'); assert.equal(pct(null), '–');
  assert.equal(source({ field: 'LNREMULT', repdte: '20260630' }), 'LNREMULT, June 30, 2026');
  assert.equal(source({ fields: ['LNRECONS', 'LNREMULT'], repdte: '20260630' }), 'LNRECONS + LNREMULT, June 30, 2026');
});
