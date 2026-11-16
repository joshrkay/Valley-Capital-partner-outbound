// The Status page's outcomes section (PRD E15-S4 on the web): the engine's own report (src/outcomes.mjs), read as the principal from the
// fake Supabase REST API, shaped for the page by web/lib/outcomes-view.mjs. Counts only: never a name or a note. Invented data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakePostgrest } from '../../test/postgrest-fake.mjs';
import { platformClient } from '../../src/platform/client.mjs';
import { buildOutcomesReport, reportSettings } from '../../src/outcomes.mjs';
import { loadRules } from '../../src/rules.mjs';
import * as ops from '../lib/ops.mjs';
import * as to from '../lib/touches-ops.mjs';
import { outcomesView } from '../lib/outcomes-view.mjs';

const URL_ = 'https://example-project.supabase.test';
const WEB = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NOW = new Date('2026-11-16T15:00:00Z');
const rules = loadRules();
const seed = (fake, path, body) => fake.docs.set(path, { path, kind: 'json', body, text: null, version: 1 });
const log = (fake, path, line) => fake.lines.push({ id: fake.lines.length + 1, path, line, by: 'pat@example.test' });
const ACCT = (id, name, over = {}) => ({ id, name, type: 'bank', audience: 'bank', sectors: ['multifamily'], tier: 'A', person: { name: `${name} Contact` }, originSignals: [], ...over });
const outcomeLine = (over) => ({ type: 'call_outcome', id: 'p1', accountId: 'bank-one', institutionKey: 'fdic:11111', originSignals: ['fdic:11111:mf-noncurrent-rising:20260630'], originSignalTypes: ['mf-noncurrent-rising'], firstSignalDate: '2026-06-30', tier: 'A', date: '2026-09-10', codes: ['held', 'nda_requested'], followUpDate: null, counts: { objections: 1, commitments: 1, people: 1 }, confirmedBy: 'Pat Example', confirmedAt: '2026-09-11T12:00:00Z', ...over });

function setup() {
  const fake = fakePostgrest();
  const client = platformClient({ url: URL_, key: 'anon-key', accessToken: 'user:pat@example.test', fetchImpl: fake.fetchImpl });
  seed(fake, 'accounts/bank-one.json', ACCT('bank-one', 'Bank One Example', { originSignals: ['fdic:11111:mf-noncurrent-rising:20260630'], pipeline: { signals: [{ id: 'fdic:11111:mf-noncurrent-rising:20260630', type: 'mf-noncurrent-rising', period: '20260630' }] } }));
  seed(fake, 'accounts/bank-two.json', ACCT('bank-two', 'Bank Two Example', { tier: 'B', originSignals: ['fdic:22222:cre-rising:20260331'], pipeline: { signals: [{ id: 'fdic:22222:cre-rising:20260331', type: 'cre-rising', period: '20260331' }] } }));
  seed(fake, 'senders.json', { senders: [] });
  seed(fake, 'suppression.json', { entries: [] });
  log(fake, 'outcomes.jsonl', outcomeLine());
  log(fake, 'touches.jsonl', { type: 'meeting', accountId: 'bank-one', institution: 'Bank One Example', date: '2026-09-10', ref: 'call:p1', recordedAt: '2026-09-11T12:00:00Z' });
  return { fake, client };
}

test('the section is the engine\'s own report, with a meeting recorded by hand on the account page counted as a held call', async () => {
  const { fake, client } = setup();
  // A principal records a meeting by hand on the account page (the touches panel): it has no outcome, and the report still counts it.
  await to.recordEvent(client, { id: 'bank-two', type: 'meeting', date: '2026-10-05', note: 'lunch downtown', by: 'Pat Example', now: NOW });
  const r = await ops.outcomesOverview(client, { now: NOW });
  const lines = fake.lines.filter((l) => l.path === 'outcomes.jsonl').map((l) => l.line);
  const touches = fake.lines.filter((l) => l.path === 'touches.jsonl').map((l) => l.line);
  const accounts = { 'bank-two': fake.docs.get('accounts/bank-two.json').body };
  assert.deepEqual(r, buildOutcomesReport({ lines, touches, accounts, ...reportSettings(rules.config), now: NOW }), 'the same deterministic report the command line prints');
  assert.deepEqual([r.outcomes, r.meetingsByHand, r.totals.accounts, r.totals.calls, r.totals.byHand], [1, 1, 2, 2, 1]);
  assert.deepEqual(Object.keys(r.bySignalType).sort(), ['cre-rising', 'mf-noncurrent-rising']);
  assert.equal([...fake.docs.keys()].filter((k) => k.startsWith('reports/')).length, 0, 'viewing writes no report');
  const v = outcomesView(r);
  assert.equal(v.tooFew, true);
  assert.match(v.note, /too few to tune scoring weights on/);
  assert.deepEqual(v.tables.map((t) => t.title), ['By the signal types that started the account', 'By tier', 'By lead time, first signal to first meeting']);
  assert.deepEqual(v.columns.map((c) => c.label), ['Accounts', 'Calls', 'By hand', 'Held', 'NDA asked', 'NDA signed', 'Tape promised', 'Tape received']);
  assert.deepEqual(v.tables[0].rows.find((x) => x.label === 'cre-rising').cells, [1, 1, 1, 1, 0, 0, 0, 0]);
  assert.deepEqual(v.totals.cells, [2, 2, 1, 2, 1, 0, 0, 0]);
  assert.match(v.headline, /1 confirmed call outcome and 1 meeting recorded by hand/);
  // Counts only: no name, no note, no account id, no principal.
  const shown = JSON.stringify(v);
  for (const leak of ['Bank One', 'Bank Two', 'Contact', 'lunch', 'downtown', 'Pat Example', 'bank-one', 'bank-two', 'fdic:11111']) assert.ok(!shown.includes(leak), `the section shows "${leak}"`);
});

test('at minToTune confirmed outcomes the "too few to tune on" wording goes; with none, the section says so', async () => {
  const { fake, client } = setup();
  const n = rules.config.outcomes.minToTune;
  for (let i = 2; i <= n; i++) log(fake, 'outcomes.jsonl', outcomeLine({ id: `p${i}`, accountId: `bank-${i}`, date: '2026-10-01' }));
  const v = outcomesView(await ops.outcomesOverview(client, { now: NOW }));
  assert.equal(v.tooFew, false);
  assert.doesNotMatch(v.note, /too few/);
  assert.match(v.note, /a principal decides whether any weight changes/);
  const empty = fakePostgrest();
  const none = outcomesView(await ops.outcomesOverview(platformClient({ url: URL_, key: 'anon-key', accessToken: 'user:pat@example.test', fetchImpl: empty.fetchImpl }), { now: NOW }));
  assert.deepEqual([none.empty, none.tooFew], [true, true]);
  assert.match(none.headline, /No call is recorded yet/);
});

test('the Status page adds one section and its import, rendered on the server from the engine', () => {
  const page = readFileSync(join(WEB, 'app', 'status', 'page.jsx'), 'utf8');
  assert.match(page, /import \{ Outcomes \} from '\.\/outcomes\.jsx';/);
  assert.match(page, /<Outcomes client=\{ctx\.client\} \/>/);
  const section = readFileSync(join(WEB, 'app', 'status', 'outcomes.jsx'), 'utf8');
  assert.doesNotMatch(section, /'use client'/, 'a server component');
  assert.match(section, /outcomesOverview/);
  assert.match(section, /outcomesView/);
});
