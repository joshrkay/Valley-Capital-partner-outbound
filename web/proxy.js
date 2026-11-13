// Runs before every request (Next 16 "proxy", formerly middleware). It refreshes the Supabase session cookie and sends anyone who is
// not signed in to /login. Whether a signed-in user is an active principal is checked on the page itself (lib/session.mjs), and the
// database checks again on every read and write.
import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

const OPEN = ['/login', '/auth/'];

export async function proxy(request) {
  const path = request.nextUrl.pathname;
  const open = OPEN.some((p) => path === p || path.startsWith(p));
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return open ? NextResponse.next() : NextResponse.redirect(new URL('/login', request.url));

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list, headers) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
        for (const [k, v] of Object.entries(headers ?? {})) response.headers.set(k, v);
      },
    },
  });
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims && !open) return NextResponse.redirect(new URL('/login', request.url));
  return response;
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt).*)'] };
