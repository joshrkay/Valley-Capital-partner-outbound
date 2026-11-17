import './globals.css';
import { cookies } from 'next/headers';
import { currentUser } from '../lib/session.mjs';
import { supabaseEnv } from '../lib/env.mjs';
import { restReader } from '../lib/rest.mjs';
import { countDrafts } from '../lib/ops.mjs';
import { Flash } from './ui.jsx';
import Shell from './shell.jsx';

export const metadata = {
  title: 'Valley Capital outbound',
  description: 'Private. For the firm\'s principals only.',
  robots: { index: false, follow: false },
};

// What the shell needs: the theme cookie, who is signed in, and the Approvals count (drafts waiting), read with the principal's own
// token so row-level security decides. Any failure leaves the count out; it never stops a page.
async function shellState() {
  const store = await cookies();
  const theme = store.get('theme')?.value ?? null;
  let email = null, approvals = null;
  try {
    const user = await currentUser();
    if (user) {
      email = user.email;
      const { url, key } = supabaseEnv();
      approvals = await countDrafts(restReader({ url, key, accessToken: user.accessToken }));
    }
  } catch { approvals = null; }
  return { theme, email, approvals };
}

export default async function RootLayout({ children }) {
  const { theme, email, approvals } = await shellState();
  return <Shell theme={theme} email={email} approvals={approvals} flash={<Flash />}>{children}</Shell>;
}
