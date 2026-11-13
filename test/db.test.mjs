// PRD E12-S2: the platform migration, run against a real Postgres. It needs a disposable server, given as libpq connection settings:
//   OUTBOUND_TEST_PG="host=/tmp/vcpg port=54329 user=postgres" npm test
// Without OUTBOUND_TEST_PG these tests are skipped. Each run creates and drops its own database. Never point it at a real project.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { readdirSync } from 'node:fs';
import { REPO } from './kit.mjs';

const PG = process.env.OUTBOUND_TEST_PG;
const skip = PG ? false : 'set OUTBOUND_TEST_PG to a disposable Postgres to run the database tests';
const DB = `outbound_test_${process.pid}`;

function psql(sql, { db = DB, file } = {}) {
  const args = [`${PG} dbname=${db}`, '-v', 'ON_ERROR_STOP=1', '-X', '-tAq', ...(file ? ['-f', file] : ['-f', '-'])];
  const r = spawnSync('psql', args, { input: file ? undefined : sql, encoding: 'utf8' });
  return { ok: r.status === 0, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}
const must = (r) => { assert.ok(r.ok, r.err); return r.out; };
const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;
// Runs SQL as a role with JWT claims, the way PostgREST does for each request.
const as = (role, claims, sql) => psql(`begin;\nset local role ${role};\nset local "request.jwt.claims" = ${lit(JSON.stringify(claims))};\n${sql};\ncommit;`);
const PAT = { role: 'authenticated', email: 'pat@example.test' };
const STRANGER = { role: 'authenticated', email: 'someone@example.test' };
const SERVICE = { role: 'service_role' };
const plan = (docs = [], lines = []) => lit(JSON.stringify({ docs, lines }));

test.before(() => {
  if (skip) return;
  must(psql(`drop database if exists ${DB}; create database ${DB};`, { db: 'postgres' }));
  must(psql('', { file: join(REPO, 'test', 'sql', 'supabase-shim.sql') }));
  for (const f of readdirSync(join(REPO, 'supabase', 'migrations')).sort()) must(psql('', { file: join(REPO, 'supabase', 'migrations', f) }));
  must(psql(`insert into principals (email, name) values ('pat@example.test', 'Pat Example'), ('gone@example.test', 'Former Principal');
             update principals set active = false where email = 'gone@example.test';`));
});
test.after(() => { if (!skip) psql(`drop database if exists ${DB};`, { db: 'postgres' }); });

test('a principal writes a new document, then a newer version of it', { skip }, () => {
  must(as('authenticated', PAT, `select flush_uow(${plan([{ path: 'accounts/acme.json', kind: 'json', body: { id: 'acme' }, baseVersion: 0 }])})`));
  must(as('authenticated', PAT, `select flush_uow(${plan([{ path: 'accounts/acme.json', kind: 'json', body: { id: 'acme', tier: 'A' }, baseVersion: 1 }])})`));
  assert.equal(must(as('authenticated', PAT, `select version || ' ' || (body->>'tier') || ' ' || updated_by from documents where path = 'accounts/acme.json'`)), '2 A pat@example.test');
});

test('a stale version undoes the whole flush and names the path', { skip }, () => {
  const r = as('authenticated', PAT, `select flush_uow(${plan([
    { path: 'accounts/new-one.json', kind: 'json', body: { id: 'new-one' }, baseVersion: 0 },
    { path: 'accounts/acme.json', kind: 'json', body: { id: 'acme', tier: 'B' }, baseVersion: 1 },   // it is at version 2 now
  ], [{ path: 'audit.jsonl', line: { type: 'should_not_land' } }])})`);
  assert.equal(r.ok, false);
  assert.match(r.err, /Conflict: accounts\/acme\.json changed since it was loaded/);
  assert.equal(must(as('authenticated', PAT, `select count(*) from documents where path = 'accounts/new-one.json'`)), '0', 'nothing in the plan was written');
  assert.equal(must(as('authenticated', PAT, `select count(*) from log_lines where line->>'type' = 'should_not_land'`)), '0');
});

test('creating a document someone else already created is a conflict, not an overwrite', { skip }, () => {
  const r = as('authenticated', PAT, `select flush_uow(${plan([{ path: 'accounts/acme.json', kind: 'json', body: { id: 'other' }, baseVersion: 0 }])})`);
  assert.equal(r.ok, false);
  assert.match(r.err, /Conflict: accounts\/acme\.json was created by someone else/);
});

test('text documents and log lines are stored, and log lines record who wrote them', { skip }, () => {
  must(as('authenticated', PAT, `select flush_uow(${plan([{ path: 'briefs/acme.md', kind: 'text', text: '# Brief', baseVersion: 0 }], [{ path: 'audit.jsonl', line: { type: 'research_done' } }])})`));
  assert.equal(must(as('authenticated', PAT, `select text from documents where path = 'briefs/acme.md'`)), '# Brief');
  assert.equal(must(as('authenticated', PAT, `select by from log_lines where line->>'type' = 'research_done'`)), 'pat@example.test');
});

test('someone who is not an active principal can read nothing and write nothing', { skip }, () => {
  for (const who of [STRANGER, { role: 'authenticated', email: 'gone@example.test' }]) {
    assert.equal(must(as('authenticated', who, 'select count(*) from documents')), '0');
    assert.equal(must(as('authenticated', who, 'select count(*) from principals')), '0');
    const w = as('authenticated', who, `select flush_uow(${plan([{ path: 'x.json', kind: 'json', body: {}, baseVersion: 0 }])})`);
    assert.equal(w.ok, false); assert.match(w.err, /Not allowed/);
  }
});

test('the anonymous key can do nothing at all', { skip }, () => {
  assert.equal(as('anon', {}, 'select count(*) from documents').ok, false);
  assert.equal(as('anon', {}, `select flush_uow(${plan()})`).ok, false);
  assert.equal(as('anon', {}, `select enqueue_job('score.run')`).ok, false);
});

test('a principal cannot write to a table directly: every write goes through the checked function', { skip }, () => {
  const r = as('authenticated', PAT, `insert into documents (path, kind, body, updated_by) values ('sneak.json', 'json', '{}', 'pat@example.test')`);
  assert.equal(r.ok, false); assert.match(r.err, /permission denied/);
  assert.equal(as('authenticated', PAT, `update documents set body = '{}' where path = 'accounts/acme.json'`).ok, false);
  assert.equal(as('authenticated', PAT, `delete from log_lines`).ok, false);
});

test('paths are checked: no climbing out with "..", and logs only in log_lines', { skip }, () => {
  assert.equal(as('authenticated', PAT, `select flush_uow(${plan([{ path: '../etc/x.json', kind: 'json', body: {}, baseVersion: 0 }])})`).ok, false);
  assert.equal(as('authenticated', PAT, `select flush_uow(${plan([{ path: 'touches.jsonl', kind: 'text', text: 'x', baseVersion: 0 }])})`).ok, false);
});

test('writing candidates/latest.json keeps the candidate table in step, removing banks no longer listed', { skip }, () => {
  const item = (key, tier, score) => ({ key, name: `Bank ${key}`, tier, score, axes: { distress: 10, fit: 20, timing: 5 }, metros: ['31080'], sectors: ['multifamily'], filtersFailed: [], card: { text: `card ${key}` }, latestRepdte: '20260630' });
  must(as('authenticated', PAT, `select flush_uow(${plan([{ path: 'candidates/latest.json', kind: 'json', body: { runId: 'score-1', provisional: true, items: [item('fdic:1', 'A', 70), item('fdic:2', 'B', 30)] }, baseVersion: 0 }])})`));
  assert.equal(must(as('authenticated', PAT, `select string_agg(key || ':' || tier || ':' || provisional || ':' || array_to_string(metros, ','), ' ' order by key) from candidates`)), 'fdic:1:A:true:31080 fdic:2:B:true:31080');
  must(as('authenticated', PAT, `select flush_uow(${plan([{ path: 'candidates/latest.json', kind: 'json', body: { runId: 'score-2', items: [item('fdic:2', 'A', 80)] }, baseVersion: 1 }])})`));
  assert.equal(must(as('authenticated', PAT, `select string_agg(key || ':' || tier || ':' || score || ':' || run_id, ' ') from candidates`)), 'fdic:2:A:80:score-2');
});

test('the job queue: principals queue, only the worker claims and finishes, and two claims never take the same job', { skip }, () => {
  const id = must(as('authenticated', PAT, `select enqueue_job('score.run', '{"draftBuybox": true}')`));
  assert.match(id, /^\d+$/);
  assert.equal(as('authenticated', PAT, 'select * from claim_job()').ok, false, 'a principal cannot claim');
  assert.equal(as('authenticated', PAT, `select enqueue_job('send.email')`).ok, false, 'unknown kinds are refused');
  const edgar = must(as('authenticated', PAT, `select enqueue_job('sources.edgar')`));
  assert.match(edgar, /^\d+$/, 'the second migration adds the CMBS pull');
  must(as('service_role', SERVICE, `update jobs set status = 'done' where id = ${edgar}`));
  const claimed = must(as('service_role', SERVICE, 'select id || \' \' || kind || \' \' || status || \' \' || requested_by from claim_job()'));
  assert.equal(claimed, `${id} score.run running pat@example.test`);
  assert.equal(must(as('service_role', SERVICE, 'select count(*) from claim_job()')), '0', 'nothing else is queued');
  must(as('service_role', SERVICE, `select finish_job(${id}, true, '{"banks": 268}')`));
  assert.equal(must(as('authenticated', PAT, `select status || ' ' || (result->>'banks') from jobs where id = ${id}`)), 'done 268');
});
