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
  const filings = must(as('authenticated', PAT, `select enqueue_job('sources.filings')`));
  assert.match(filings, /^\d+$/, 'the third migration adds the SEC filings listener');
  must(as('service_role', SERVICE, `update jobs set status = 'done' where id = ${filings}`));
  const claimed = must(as('service_role', SERVICE, 'select id || \' \' || kind || \' \' || status || \' \' || requested_by from claim_job()'));
  assert.equal(claimed, `${id} score.run running pat@example.test`);
  assert.equal(must(as('service_role', SERVICE, 'select count(*) from claim_job()')), '0', 'nothing else is queued');
  must(as('service_role', SERVICE, `select finish_job(${id}, true, '{"banks": 268}')`));
  assert.equal(must(as('authenticated', PAT, `select status || ' ' || (result->>'banks') from jobs where id = ${id}`)), 'done 268');
});

test('the fourth migration adds call prep and call notes (PRD E15) and keeps every earlier kind; still no kind sends', { skip }, () => {
  const constraint = must(psql(`select pg_get_constraintdef(oid) from pg_constraint where conname = 'jobs_kind_check'`));
  for (const kind of ['sources.fdic', 'sources.edgar', 'sources.filings', 'score.run', 'research.run', 'draft.run', 'call.prep', 'call.extract']) assert.ok(constraint.includes(`'${kind}'`), `${kind} is missing from ${constraint}`);
  for (const kind of ['call.prep', 'call.extract']) {
    const j = must(as('authenticated', PAT, `select enqueue_job('${kind}', '{"account": "acme", "date": "2026-11-17"}')`));
    assert.match(j, /^\d+$/, `${kind} is a job kind`);
    assert.equal(must(as('authenticated', PAT, `select kind || ' ' || status || ' ' || requested_by from jobs where id = ${j}`)), `${kind} queued pat@example.test`);
    must(as('service_role', SERVICE, `update jobs set status = 'done' where id = ${j}`));
  }
  assert.equal(as('authenticated', PAT, `select enqueue_job('call.send')`).ok, false, 'no kind that sends');
  assert.equal(as('anon', {}, `select enqueue_job('call.prep')`).ok, false, 'the anonymous key cannot queue a call brief');
});

test('no caller can run an internal function directly, even with Supabase\'s default grants on new functions', { skip }, () => {
  const item = { key: 'fdic:9', name: 'Sneaky', tier: 'A', score: 99, axes: {}, metros: [], sectors: [], filtersFailed: [] };
  for (const [role, who] of [['authenticated', PAT], ['authenticated', STRANGER], ['anon', {}]]) {
    const r = as(role, who, `select project_candidates(${lit(JSON.stringify({ runId: 'x', items: [item] }))})`);
    assert.equal(r.ok, false, `${role} ${who.email ?? ''} ran project_candidates`);
    assert.match(r.err, /permission denied/);
  }
  assert.equal(must(as('authenticated', PAT, `select count(*) from candidates where key = 'fdic:9'`)), '0');
  assert.equal(as('anon', {}, 'select * from claim_job()').ok, false);
});

test('only the reading grants Supabase gives by default survive: no API role can write a table directly', { skip }, () => {
  const out = must(psql(`select string_agg(grantee || ':' || privilege_type, ',' order by grantee, privilege_type) from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'documents' and grantee in ('anon', 'authenticated')`));
  assert.equal(out, 'authenticated:SELECT');
});

test('the fifth migration adds the weekly triage (PRD E6-S5) and keeps every earlier kind', { skip }, () => {
  const constraint = must(psql(`select pg_get_constraintdef(oid) from pg_constraint where conname = 'jobs_kind_check'`));
  for (const kind of ['sources.fdic', 'sources.edgar', 'sources.filings', 'score.run', 'triage.run', 'research.run', 'draft.run', 'call.prep', 'call.extract']) assert.ok(constraint.includes(`'${kind}'`), `${kind} is missing from ${constraint}`);
  const j = must(as('authenticated', PAT, `select enqueue_job('triage.run')`));
  assert.match(j, /^\d+$/);
  must(as('service_role', SERVICE, `update jobs set status = 'done' where id = ${j}`));
});

test('the sixth migration adds the FDIC loan-sale pull (PRD E16) and keeps every earlier kind', { skip }, () => {
  const constraint = must(psql(`select pg_get_constraintdef(oid) from pg_constraint where conname = 'jobs_kind_check'`));
  for (const kind of ['sources.fdic', 'sources.edgar', 'sources.filings', 'sources.fdicsales', 'score.run', 'triage.run', 'research.run', 'draft.run', 'call.prep', 'call.extract']) assert.ok(constraint.includes(`'${kind}'`), `${kind} is missing from ${constraint}`);
  const j = must(as('authenticated', PAT, `select enqueue_job('sources.fdicsales')`));
  assert.match(j, /^\d+$/);
  must(as('service_role', SERVICE, `update jobs set status = 'done' where id = ${j}`));
});

test('the enforcement migration adds the enforcement-orders pull (PRD next-five E18-S2) and keeps every earlier kind', { skip }, () => {
  const constraint = must(psql(`select pg_get_constraintdef(oid) from pg_constraint where conname = 'jobs_kind_check'`));
  for (const kind of ['sources.fdic', 'sources.edgar', 'sources.filings', 'sources.fdicsales', 'sources.enforcement', 'score.run', 'triage.run', 'research.run', 'draft.run', 'call.prep', 'call.extract']) assert.ok(constraint.includes(`'${kind}'`), `${kind} is missing from ${constraint}`);
  const j = must(as('authenticated', PAT, `select enqueue_job('sources.enforcement')`));
  assert.match(j, /^\d+$/);
  must(as('service_role', SERVICE, `update jobs set status = 'done' where id = ${j}`));
});

test('the merger-applications migration adds sources.mergerapps (PRD next-five E18-S3) and keeps every earlier kind', { skip }, () => {
  const constraint = must(psql(`select pg_get_constraintdef(oid) from pg_constraint where conname = 'jobs_kind_check'`));
  for (const kind of ['sources.fdic', 'sources.edgar', 'sources.filings', 'sources.fdicsales', 'sources.enforcement', 'sources.mergerapps', 'score.run', 'triage.run', 'research.run', 'draft.run', 'call.prep', 'call.extract']) assert.ok(constraint.includes(`'${kind}'`), `${kind} is missing from ${constraint}`);
  const j = must(as('authenticated', PAT, `select enqueue_job('sources.mergerapps')`));
  assert.match(j, /^\d+$/);
  must(as('service_role', SERVICE, `update jobs set status = 'done' where id = ${j}`));
});

// PRD E7-S3: a deletion request blanks values in a log line that mentions the person. flush_uow takes `redactions` from the seventh
// migration on, for touches.jsonl and outcomes.jsonl only, and only as a redaction: a value becomes "[removed]", no key is added or
// dropped, and the keys the guard and the outcomes report rely on (type, accountId, institution, date, id, ref) never change.
test('the seventh migration: a principal redacts a value in touches.jsonl, and nothing else can be changed that way', { skip }, () => {
  const line = { type: 'reply', accountId: 'acme', institution: 'Acme Community Bank', date: '2026-11-11', note: 'Jordan Sample replied' };
  must(as('authenticated', PAT, `select flush_uow(${plan([], [{ path: 'touches.jsonl', line }, { path: 'audit.jsonl', line: { type: 'note', note: 'Jordan Sample' } }])})`));
  const id = must(psql(`select id from log_lines where path = 'touches.jsonl' and line->>'note' = 'Jordan Sample replied'`));
  const red = (r, docs = []) => lit(JSON.stringify({ docs, lines: [], redactions: [r] }));
  const refused = (r, why) => { const x = as('authenticated', PAT, `select flush_uow(${red(r)})`); assert.equal(x.ok, false, why); assert.match(x.err, /Not allowed/, why); };
  refused({ path: 'touches.jsonl', old: line, new: { ...line, type: '[removed]' } }, 'the event type is protected');
  refused({ path: 'touches.jsonl', old: line, new: { ...line, date: '[removed]' } }, 'the date is protected');
  refused({ path: 'touches.jsonl', old: line, new: { ...line, note: 'someone else' } }, 'only "[removed]" may replace a value');
  refused({ path: 'touches.jsonl', old: line, new: { ...line, note: '[removed]', extra: 1 } }, 'no key is added');
  const { note, ...withoutNote } = line;
  refused({ path: 'touches.jsonl', old: line, new: withoutNote }, 'no key is dropped');
  refused({ path: 'audit.jsonl', old: { type: 'note', note: 'Jordan Sample' }, new: { type: 'note', note: '[removed]' } }, 'the audit log is never rewritten');
  assert.equal(as('authenticated', STRANGER, `select flush_uow(${red({ path: 'touches.jsonl', old: line, new: { ...line, note: '[removed]' } })})`).ok, false, 'a stranger cannot');
  // A line that is not there (changed since it was loaded) is a conflict, and nothing else in the plan lands.
  const gone = as('authenticated', PAT, `select flush_uow(${red({ path: 'touches.jsonl', old: { ...line, note: 'not this' }, new: { ...line, note: '[removed]' } }, [{ path: 'accounts/forget-me.json', kind: 'json', body: { id: 'x' }, baseVersion: 0 }])})`);
  assert.equal(gone.ok, false); assert.match(gone.err, /Conflict: a line of touches\.jsonl changed since it was loaded/);
  assert.equal(must(as('authenticated', PAT, `select count(*) from documents where path = 'accounts/forget-me.json'`)), '0');
  // The redaction itself.
  const r = must(as('authenticated', PAT, `select flush_uow(${red({ path: 'touches.jsonl', old: line, new: { ...line, note: '[removed]' } })})`));
  assert.equal(JSON.parse(r).redacted, 1);
  assert.equal(must(psql(`select id || ' ' || (line->>'type') || ' ' || (line->>'note') || ' ' || (line->>'date') from log_lines where id = ${id}`)), `${id} reply [removed] 2026-11-11`);
  assert.equal(must(psql(`select count(*) from log_lines where line::text like '%Jordan Sample replied%'`)), '0');
  assert.equal(JSON.parse(must(as('authenticated', PAT, `select flush_uow(${plan()})`))).redacted, 0, 'a plan with no redaction answers 0, so the client knows the migration ran');
});
