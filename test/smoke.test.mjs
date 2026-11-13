// The first check of a real Supabase project (src/platform/smoke.mjs), against a fake that answers the way Supabase does.
import test from 'node:test';
import assert from 'node:assert/strict';
import { smoke, TABLES, FUNCTIONS } from '../src/platform/smoke.mjs';

const URL_ = 'https://abcdefghijklmnop.supabase.co';
const json = (status, body) => new Response(JSON.stringify(body), { status });
// A project as the migrations leave it: every table and function exists and refuses the public key; sign-ups are off.
function fakeProject({ signup = false, missing = [], open = [] } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const u = new URL(url); calls.push({ path: u.pathname, headers: init.headers });
    if (u.pathname === '/auth/v1/settings') return json(200, { disable_signup: !signup, external: { email: true } });
    const name = u.pathname.replace('/rest/v1/rpc/', '').replace('/rest/v1/', '');
    if (missing.includes(name)) return json(404, u.pathname.includes('/rpc/') ? { code: 'PGRST202', message: `Could not find the function public.${name}` } : { code: 'PGRST205', message: `Could not find the table 'public.${name}'` });
    if (open.includes(name)) return json(200, []);
    return json(401, { code: '42501', message: `permission denied for ${u.pathname.includes('/rpc/') ? 'function' : 'table'} ${name}` });
  };
  return { fetchImpl, calls };
}

test('a project set up as the migrations say passes every check', async () => {
  const f = fakeProject();
  const r = await smoke({ url: URL_, key: 'sb_publishable_abc', fetchImpl: f.fetchImpl });
  assert.equal(r.ok, true, JSON.stringify(r.checks.filter((c) => !c.ok)));
  assert.equal(r.checks.length, 1 + TABLES.length + Object.keys(FUNCTIONS).length);
  assert.equal(r.keyKind, 'publishable');
  assert.equal(f.calls[0].headers.Authorization, undefined, 'a publishable key is sent in apikey only');
});

test('sign-ups left on, a missing table, or a table the public can read each fail with what to do', async () => {
  const r = await smoke({ url: URL_, key: 'sb_publishable_abc', fetchImpl: fakeProject({ signup: true, missing: ['jobs', 'flush_uow'], open: ['documents'] }).fetchImpl });
  const by = Object.fromEntries(r.checks.map((c) => [c.id, c]));
  assert.equal(r.ok, false);
  assert.match(by['auth.signup_off'].summary, /Sign-ups are ON/);
  assert.match(by['table.jobs'].summary, /does not exist\. Run the migrations/);
  assert.match(by['function.flush_uow'].summary, /does not exist/);
  assert.match(by['table.documents'].summary, /answered the public key with data/);
  assert.equal(by['table.principals'].ok, true);
});

test('it refuses a service key and a URL that is not a project URL', async () => {
  const f = fakeProject();
  await assert.rejects(smoke({ url: URL_, key: 'sb_secret_abc', fetchImpl: f.fetchImpl }), /service key/);
  const serviceJwt = `x.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.y`;
  await assert.rejects(smoke({ url: URL_, key: serviceJwt, fetchImpl: f.fetchImpl }), /service key/);
  await assert.rejects(smoke({ url: 'https://evil.example.com', key: 'sb_publishable_abc', fetchImpl: f.fetchImpl }), /project URL/);
  assert.equal(f.calls.length, 0, 'nothing was sent anywhere');
});
