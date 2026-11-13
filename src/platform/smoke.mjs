// The first check against a real Supabase project (PRD E12-S7), using only its URL and its public key. That key is meant to be
// public, so this check proves exactly what anyone on the internet could do: nothing. Each table and function must EXIST (Supabase
// answers "permission denied" for something that exists and "not found" for something that does not) and must REFUSE the public
// key. Sign-ups must be off. Read-only: every request either reads or is refused.
import { isJwt } from './client.mjs';

export const TABLES = ['principals', 'documents', 'log_lines', 'candidates', 'jobs'];
export const FUNCTIONS = { flush_uow: { plan: { docs: [], lines: [] } }, enqueue_job: { kind: 'score.run', params: {} }, claim_job: {}, finish_job: { job_id: 0, ok: false } };

const keyKind = (k) => (String(k).startsWith('sb_secret_') ? 'secret' : String(k).startsWith('sb_publishable_') ? 'publishable' : isJwt(k) ? (() => { try { return JSON.parse(Buffer.from(String(k).split('.')[1], 'base64url').toString('utf8')).role ?? 'jwt'; } catch { return 'jwt'; } })() : 'unknown');

export async function smoke({ url, key, fetchImpl = globalThis.fetch }) {
  const kind = keyKind(key);
  if (kind === 'secret' || kind === 'service_role') throw new Error('That is a service key. This check must use the public anon key: the point is to prove what the public can do.');
  const base = String(url ?? '').replace(/\/$/, '');
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(base)) throw new Error(`Expected a project URL like https://<ref>.supabase.co, got "${url}".`);
  const headers = { apikey: key, ...(isJwt(key) ? { Authorization: `Bearer ${key}` } : {}), Accept: 'application/json', 'Content-Type': 'application/json' };
  const call = async (method, path, body) => {
    const res = await fetchImpl(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, data };
  };
  const checks = [];
  const add = (id, ok, summary) => checks.push({ id, ok, summary });

  // Sign-ups off: the platform only works for principals an operator invites.
  const s = await call('GET', '/auth/v1/settings');
  if (s.status !== 200) add('auth.settings', false, `Could not read the project's auth settings (HTTP ${s.status}). Check the URL and key.`);
  else add('auth.signup_off', s.data?.disable_signup === true, s.data?.disable_signup === true ? 'Sign-ups are off: only invited principals can have an account.' : 'Sign-ups are ON. Turn off "Allow new users to sign up" (Authentication > Sign In / Providers).');

  const verdict = (r, what) => {
    const code = r.data?.code;
    if (r.status >= 200 && r.status < 300) return [false, `${what} answered the public key with data (HTTP ${r.status}). It must refuse it.`];
    if (code === '42501' || /permission denied/i.test(r.data?.message ?? '')) return [true, `${what} exists and refuses the public key.`];
    if (code === 'PGRST205' || code === 'PGRST202' || r.status === 404) return [false, `${what} does not exist. Run the migrations in supabase/migrations/ (SQL Editor), in order.`];
    if (r.status === 401) return [false, `${what}: the key was rejected (HTTP 401${code ? `, ${code}` : ''}). Check that it is this project's anon or publishable key.`];
    return [false, `${what}: unexpected answer (HTTP ${r.status}${code ? `, ${code}` : ''}).`];
  };
  for (const t of TABLES) { const [ok, m] = verdict(await call('GET', `/rest/v1/${t}?select=*&limit=1`), `Table ${t}`); add(`table.${t}`, ok, m); }
  for (const [fn, body] of Object.entries(FUNCTIONS)) { const [ok, m] = verdict(await call('POST', `/rest/v1/rpc/${fn}`, body), `Function ${fn}`); add(`function.${fn}`, ok, m); }
  return { keyKind: kind, checks, ok: checks.every((c) => c.ok) };
}
