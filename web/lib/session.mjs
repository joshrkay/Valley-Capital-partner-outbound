// Server only, Next-specific. Who is signed in, whether they are an active principal, and the clients that act as them.
// Identity is verified with getClaims() (it checks the JWT), not taken from the cookie on trust; the database checks the token again.
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createServerClient } from '@supabase/ssr';
import { supabaseEnv } from './env.mjs';
import { restReader } from './rest.mjs';
import { engine } from './engine.mjs';

export async function supabaseServer() {
  const { url, key } = supabaseEnv();
  const store = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try { for (const { name, value, options } of list) store.set(name, value, options); }
        catch { /* a server component cannot set cookies; the proxy refreshes the session on the next request */ }
      },
    },
  });
}

export async function currentUser() {
  const sb = await supabaseServer();
  const { data } = await sb.auth.getClaims();
  const email = data?.claims?.email ? String(data.claims.email).toLowerCase() : null;
  if (!email) return null;
  const { data: s } = await sb.auth.getSession();
  return s?.session?.access_token ? { email, accessToken: s.session.access_token } : null;
}

// For pages and actions. Not signed in: to /login. Signed in but not an active principal: { denied }. Otherwise the clients.
export async function requirePrincipal() {
  const user = await currentUser();
  if (!user) redirect('/login');
  const { url, key } = supabaseEnv();
  const rest = restReader({ url, key, accessToken: user.accessToken });
  const principal = await rest.principal(user.email);
  if (!principal) return { denied: true, email: user.email };
  const { platformClient } = await engine('src/platform/client.mjs');
  return { denied: false, principal, rest, client: platformClient({ url, key, accessToken: user.accessToken }) };
}

// A one-time message for the next page, kept in a short-lived cookie rather than the URL, so no bank name lands in a request log.
export async function flash(kind, text) {
  const store = await cookies();
  store.set('flash', JSON.stringify({ kind, text: String(text).slice(0, 600) }), { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 20, secure: process.env.NODE_ENV === 'production' });
}

export async function readFlash() {
  const store = await cookies();
  const raw = store.get('flash')?.value;
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
