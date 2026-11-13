// PRD E12-S1: one engine, two storage backends. Each flow runs once on a data folder and once in a unit of work (in memory, then
// flushed), and both must store exactly the same thing. Timestamps and random run ids differ between runs and are normalized away.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { makeDir, put, account, config, touch, SENDER } from './kit.mjs';
import { fakeFdic, METROS, TABLES } from './fdic-fake.mjs';
import { loadRules } from '../src/rules.mjs';
import { memoryBackend, snapshotFromDir, applyPlanToDir, withUnitOfWork, LOADS } from '../src/uow.mjs';
import { mount, readJson, writeJson, readJsonl, listFiles, exists, appendJsonl, readText, writeText } from '../src/store.mjs';
import { runFdic } from '../src/sources/fdic.mjs';
import { runScoring } from '../src/score.mjs';
import { promote, dismiss, snooze } from '../src/candidates.mjs';
import { loadContext, recordObservedSend, recordEvent, checkTouch } from '../src/guard.mjs';
import { writeTruthTemplate, markFinding } from '../src/pilot.mjs';

const rules = loadRules();
const NOW = new Date('2026-11-13T12:00:00Z');
const norm = (v) => JSON.parse(JSON.stringify(v)
  .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, '<ts>')
  .replace(/fdic-\d{8}T\d{6}Z-[a-z0-9]+/g, '<run>'));

// Runs fn on a folder and in a unit of work over an identical copy, then compares everything each stored.
async function parity({ seed = () => {}, prefixes, fn }) {
  const a = makeDir(), b = makeDir();
  seed(a); seed(b);
  const ra = await fn(a);
  const snap = snapshotFromDir(b);
  const { result: rb, plan } = await withUnitOfWork({ load: async () => snap, flush: async (p) => applyPlanToDir(p, b) }, prefixes, fn);
  assert.deepEqual(norm(snapshotFromDir(b)), norm(snapshotFromDir(a)), 'the unit of work stored something different from the data folder');
  assert.deepEqual(norm(rb), norm(ra), 'the flow returned something different');
  return { a, b, plan };
}

const fdicOpts = (dir) => ({ dir, metros: METROS, fetchImpl: fakeFdic(TABLES()).fetchImpl, quarters: 2, sleep: async () => {}, minIntervalMs: 0, now: NOW });
const pullAndScore = async (dir) => { await runFdic(fdicOpts(dir)); return runScoring({ dir, buybox: rules.buybox, scoring: rules.scoring, metros: rules.metros, now: NOW, allowPlaceholders: true }); };
const scoredSeed = async () => { const d = makeDir(); await pullAndScore(d); return snapshotFromDir(d); };
const seedFrom = (snap) => (dir) => applyPlanToDir({ docs: [...Object.entries(snap.docs).map(([path, body]) => ({ path, kind: 'json', body })), ...Object.entries(snap.texts).map(([path, text]) => ({ path, kind: 'text', text }))], lines: Object.entries(snap.logs).flatMap(([path, ls]) => ls.map((line) => ({ path, line }))) }, dir);

test('parity: the FDIC pull and scoring store the same records on both backends', async () => {
  const { plan } = await parity({ prefixes: [...LOADS.sources, ...LOADS.score], fn: pullAndScore });
  assert.ok(plan.docs.some((d) => d.path === 'sources/fdic/institutions.json'));
  assert.ok(plan.docs.some((d) => d.path === 'candidates/latest.json'));
  assert.ok(plan.lines.some((l) => l.path === 'sources/runs.jsonl'));
});

test('parity: promote, dismiss and snooze', async () => {
  const snap = await scoredSeed();
  const keys = snap.docs['candidates/latest.json'].items.filter((i) => !i.filtersFailed.length).map((i) => i.key);
  assert.ok(keys.length >= 1, 'the fixture needs at least one promotable candidate');
  await parity({
    seed: seedFrom(snap), prefixes: LOADS.candidates,
    fn: (dir) => {
      const all = readJson(join(dir, 'candidates', 'latest.json')).items.map((i) => i.key);
      const acct = promote({ dir, key: keys[0], by: 'Pat Example', now: NOW });
      const others = all.filter((k) => k !== keys[0]);
      if (others[0]) dismiss({ dir, key: others[0], by: 'Pat Example', reason: 'not our market', now: NOW });
      if (others[1]) snooze({ dir, key: others[1], by: 'Pat Example', until: '2027-01-15', now: NOW });
      return acct;
    },
  });
});

test('parity: the guard logs an observed send and an opt-out, and the opt-out suppresses the person', async () => {
  const a = account();
  const seed = (dir) => { put(dir, 'senders.json', { senders: [SENDER] }); put(dir, 'suppression.json', { entries: [] }); };
  await parity({
    seed, prefixes: LOADS.guard,
    fn: (dir) => {
      const ctx = loadContext({ dir, config: config(), env: {} });
      const sent = recordObservedSend(dir, touch(a), ctx);
      recordEvent(dir, { accountId: a.id, institution: a.name, type: 'opt_out', date: '2026-11-17', person: a.person }, ctx);
      return { sent: sent.rec, after: checkTouch(touch(a, { channel: 'email', step: 2, date: '2026-11-20' }), ctx).errors.map((e) => e.code) };
    },
  });
});

test('parity: a pilot truth sheet and a verdict', async () => {
  const seed = (dir) => put(dir, 'research/acme-bank.json', { account: 'acme-bank', date: '2026-11-10', findings: [{ id: 'F1', kind: 'structure', use: 'draft', claim: 'c', quote: 'q', source_url: 'https://example.test/1' }], dropped: [], run: {} });
  await parity({
    seed, prefixes: LOADS.pilot,
    fn: (dir) => { writeTruthTemplate({ dir, account: account(), playbooks: rules.playbooks }); return markFinding({ dir, accountId: 'acme-bank', findingId: 'F1', verdict: 'true', by: 'Pat', now: NOW }); },
  });
});

test('an action that reads something it did not load fails loudly, naming the path', async () => {
  await assert.rejects(
    withUnitOfWork({ load: async () => ({}), flush: async () => {} }, LOADS.account, (dir) => loadContext({ dir, config: config(), env: {} })),
    /"(senders|suppression)\.json" was not loaded/,
  );
  const b = memoryBackend({ loaded: ['accounts/'] });
  assert.throws(() => b.writeJson('suppression.json', {}), /not loaded, so it cannot be written/);
  assert.throws(() => b.listFiles('research', '.json'), /not loaded/);
  b.appendJsonl('audit.jsonl', { type: 'x' });   // appends need no load: they add, never overwrite
  assert.equal(b.plan().lines.length, 1);
});

test('the plan carries each document\'s loaded version, and 0 for a new one', () => {
  const b = memoryBackend({ docs: { 'accounts/a.json': { id: 'a' } }, versions: { 'accounts/a.json': 3 }, loaded: ['accounts/'] });
  b.writeJson('accounts/a.json', { id: 'a', tier: 'A' });
  b.writeJson('accounts/b.json', { id: 'b' });
  assert.deepEqual(b.plan().docs.map((d) => [d.path, d.baseVersion]), [['accounts/a.json', 3], ['accounts/b.json', 0]]);
});

test('reads return copies, as files do, so a caller mutating a result cannot change what is stored', () => {
  const b = memoryBackend({ docs: { 'x.json': { n: 1 } } });
  const r = b.readJson('x.json'); r.n = 99;
  assert.equal(b.readJson('x.json').n, 1);
  assert.equal(b.plan().docs.length, 0, 'reading is not a change');
});

test('listing and existence behave like a folder: direct children only, folders exist when something is in them', () => {
  const b = memoryBackend({ docs: { 'accounts/a.json': {}, 'drafts/a/1-email.json': {}, 'top.json': {} }, texts: { 'drafts/a/1-email.md': 'hi' }, logs: { 'touches.jsonl': [{ t: 1 }] } });
  assert.deepEqual(b.listFiles('accounts', '.json'), ['a.json']);
  assert.deepEqual(b.listFiles('drafts/a', '.md'), ['1-email.md']);
  assert.deepEqual(b.listFiles('', '.json'), ['top.json']);
  assert.equal(b.exists('drafts'), true); assert.equal(b.exists('drafts/a/1-email.md'), true); assert.equal(b.exists('nope.json'), false);
  assert.deepEqual(b.readJsonl('touches.jsonl'), [{ t: 1 }]);
});

test('the store routes a mounted root to its backend and leaves every other path on disk', () => {
  const disk = makeDir();
  const root = join(disk, 'virtual');   // a path that is never created on disk
  const unmount = mount(root, memoryBackend());
  try {
    writeJson(join(root, 'a.json'), { v: 1 }); writeText(join(root, 'b.md'), 'text'); appendJsonl(join(root, 'log.jsonl'), { n: 1 });
    assert.deepEqual(readJson(join(root, 'a.json')), { v: 1 });
    assert.equal(readText(join(root, 'b.md')), 'text');
    assert.deepEqual(readJsonl(join(root, 'log.jsonl')), [{ n: 1 }]);
    assert.deepEqual(listFiles(root, '.json'), ['a.json']);
    assert.equal(exists(join(disk, 'virtual')), true);
    writeJson(join(disk, 'real.json'), { v: 2 });
  } finally { unmount(); }
  assert.equal(exists(join(disk, 'virtual', 'a.json')), false, 'nothing under the mounted root reached the disk');
  assert.deepEqual(readJson(join(disk, 'real.json')), { v: 2 });
  assert.throws(() => { const u = mount(root, memoryBackend()); try { mount(root, memoryBackend()); } finally { u(); } }, /already mounted/);
});

test('a unit of work that changes nothing writes nothing', async () => {
  let flushed = 0;
  await withUnitOfWork({ load: async () => ({ docs: { 'accounts/a.json': { id: 'a' } } }), flush: async () => { flushed++; } }, LOADS.account, (dir) => readJson(join(dir, 'accounts', 'a.json')));
  assert.equal(flushed, 0);
});
