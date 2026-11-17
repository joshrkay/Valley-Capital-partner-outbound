// Server only. Which Supabase project the app talks to, and a refusal to run with a key that would bypass row-level security.
//
// The firm's own project is committed here. Both values are public by design: the publishable key can only act as the signed-in
// principal, and row-level security plus the principals check guard every read and write. Committing them means the deployed app
// always reaches the right project, whatever is or is not set in the hosting dashboard: a stale SUPABASE_URL / SUPABASE_ANON_KEY on
// one Vercel project once sent every sign-in to the wrong place. Those old names are therefore no longer read.
// To point a copy at another project (a test one), set WEB_SUPABASE_URL and WEB_SUPABASE_ANON_KEY together.
export const FIRM_PROJECT = Object.freeze({ url: 'https://fsjpxiyjxnrygmfnqpto.supabase.co', key: 'sb_publishable_AlvlZCGc52RrWIglUZR5cA_6F7WYsDG' });

export function supabaseEnv(env = process.env) {
  const url = env.WEB_SUPABASE_URL, key = env.WEB_SUPABASE_ANON_KEY;
  if (Boolean(url) !== Boolean(key)) throw new Error('Set WEB_SUPABASE_URL and WEB_SUPABASE_ANON_KEY together, or neither to use the firm\'s project.');
  const chosen = url ? { url, key } : { url: FIRM_PROJECT.url, key: FIRM_PROJECT.key };
  if (isServiceKey(chosen.key)) throw new Error('WEB_SUPABASE_ANON_KEY holds a service-role key. The web app must act only as the signed-in principal; use the publishable (anon) key.');
  return chosen;
}

// A service-role key bypasses row-level security. Supabase issues it as a JWT with role "service_role", or as an "sb_secret_" key.
export function isServiceKey(key) {
  const k = String(key ?? '');
  if (k.startsWith('sb_secret_')) return true;
  const parts = k.split('.');
  if (parts.length !== 3) return false;
  try { return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))?.role === 'service_role'; } catch { return false; }
}
