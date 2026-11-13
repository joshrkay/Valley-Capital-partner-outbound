import './globals.css';
import { Flash } from './ui.jsx';

export const metadata = {
  title: 'Valley Capital outbound',
  description: 'Private. For the firm\'s principals only.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <header className="top">
          <div className="inner">
            <span className="brand">Valley Capital · outbound</span>
            <nav aria-label="Main">
              <a href="/candidates">Candidates</a>
              <a href="/accounts">Accounts</a>
              <a href="/drafts">Approvals</a>
              <a href="/pilot">Pilot</a>
              <a href="/status">Status</a>
            </nav>
            <form method="post" action="/auth/signout"><button className="secondary" type="submit">Sign out</button></form>
          </div>
        </header>
        <main>
          <Flash />
          {children}
        </main>
      </body>
    </html>
  );
}
