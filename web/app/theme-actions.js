'use server';
// The theme switch in the global header: automatic, light, dark. A cookie read on the server, so the page is drawn in the chosen theme
// with no script and no flash. It records a display preference only; nothing about a bank or a person.
import { cookies } from 'next/headers';
import { nextTheme } from '../lib/nav.mjs';

export async function cycleThemeAction() {
  const store = await cookies();
  const next = nextTheme(store.get('theme')?.value);
  if (next === 'auto') store.delete('theme');
  else store.set('theme', next, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 365, secure: process.env.NODE_ENV === 'production' });
}
