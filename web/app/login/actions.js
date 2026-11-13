'use server';
// Sends a one-time sign-in link. Principals are invited by an operator; public sign-up stays off (shouldCreateUser: false). The reply
// is the same whether or not the address belongs to a principal, so the page does not reveal who is one.
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { supabaseServer, flash } from '../../lib/session.mjs';

export async function sendLink(formData) {
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { await flash('error', 'Enter a valid email address.'); redirect('/login'); }
  const h = await headers();
  const origin = `${h.get('x-forwarded-proto') ?? 'https'}://${h.get('x-forwarded-host') ?? h.get('host')}`;
  try {
    const sb = await supabaseServer();
    await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: `${origin}/auth/callback` } });
  } catch { /* deliberately the same message either way */ }
  await flash('ok', 'If that address belongs to a principal, a sign-in link is on its way. Open it in this browser.');
  redirect('/login');
}
