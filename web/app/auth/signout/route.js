import { NextResponse } from 'next/server';
import { supabaseServer } from '../../../lib/session.mjs';

export async function POST(request) {
  try { await (await supabaseServer()).auth.signOut(); } catch { /* signed out either way */ }
  return NextResponse.redirect(new URL('/login', request.url), { status: 303 });
}
