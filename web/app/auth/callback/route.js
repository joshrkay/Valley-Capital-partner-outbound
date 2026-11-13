// Where the sign-in link lands. Handles both link styles Supabase sends: a PKCE `code`, or a `token_hash` with its `type`.
import { NextResponse } from 'next/server';
import { supabaseServer, flash } from '../../../lib/session.mjs';

export async function GET(request) {
  const u = new URL(request.url);
  const sb = await supabaseServer();
  let ok = false;
  try {
    const code = u.searchParams.get('code');
    const tokenHash = u.searchParams.get('token_hash');
    if (code) ok = !(await sb.auth.exchangeCodeForSession(code)).error;
    else if (tokenHash) ok = !(await sb.auth.verifyOtp({ token_hash: tokenHash, type: u.searchParams.get('type') || 'email' })).error;
  } catch { ok = false; }
  if (!ok) await flash('error', 'That sign-in link did not work. It may have expired or been opened in a different browser. Ask for a new one.');
  return NextResponse.redirect(new URL(ok ? '/candidates' : '/login', u.origin));
}
