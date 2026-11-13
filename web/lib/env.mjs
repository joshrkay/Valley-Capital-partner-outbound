// Server only. The Supabase settings the app needs, and a refusal to run with a key that would bypass row-level security.
export function supabaseEnv(env = process.env) {
  const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('The app is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY (see web/.env.example).');
  if (isServiceKey(key)) throw new Error('SUPABASE_ANON_KEY holds a service-role key. The web app must act only as the signed-in principal; use the anon (publishable) key.');
  return { url, key };
}

// A service-role key bypasses row-level security. Supabase issues it as a JWT with role "service_role", or as an "sb_secret_" key.
export function isServiceKey(key) {
  const k = String(key ?? '');
  if (k.startsWith('sb_secret_')) return true;
  const parts = k.split('.');
  if (parts.length !== 3) return false;
  try { return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))?.role === 'service_role'; } catch { return false; }
}
