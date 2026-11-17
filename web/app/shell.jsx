// The CRM-style shell (docs/design-redesign.md, 4.1): a global header (the firm's mark, one search box for banks, Glossary, Theme, the
// Approvals bell with its count, the account menu) and a tab bar (the app launcher, This week, Banks, Outreach, Approvals, More). A server
// component with no data of its own: the layout passes the theme, the count and who is signed in.
import { Icon } from './icons.jsx';
import { NavLinks } from './nav-links.jsx';
import { Launcher } from './launcher.jsx';
import { cycleThemeAction } from './theme-actions.js';
import { THEME_NAMES, nextTheme, themeOf } from '../lib/nav.mjs';

const THEME_ICON = { auto: 'auto', light: 'sun', dark: 'moon' };

export default function Shell({ theme: raw, approvals = null, email = null, flash = null, children }) {
  const theme = themeOf(raw);
  return (
    <html lang="en" data-theme={theme === 'auto' ? undefined : theme}>
      <body>
        <a className="skip" href="#main">Skip to content</a>
        <div className="chrome">
          <header className="gh">
            <div className="wrap">
              <a className="logo" href="/triage" aria-label="Valley Capital: This week"><span className="mark" aria-hidden="true">VC</span></a>
              <form className="gsearch" role="search" action="/candidates" method="get">
                <Icon name="search" />
                <label className="sr" htmlFor="g-search">Search banks</label>
                <input type="search" id="g-search" name="q" placeholder="Search banks by name or city" autoComplete="off" />
                <input type="hidden" name="view" value="all" />
              </form>
              <div className="gh-icons">
                <a className="icon-btn" href="/glossary" aria-label="Glossary" title="Glossary"><Icon name="help" /></a>
                <form action={cycleThemeAction}>
                  <button type="submit" className="icon-btn" aria-label={`Theme: ${THEME_NAMES[theme]}. Switch to ${THEME_NAMES[nextTheme(theme)]}`} title={`Theme: ${THEME_NAMES[theme]}`}><Icon name={THEME_ICON[theme]} /></button>
                </form>
                <a className="icon-btn" href="/drafts" aria-label={approvals ? `Approvals: ${approvals} waiting` : 'Approvals'} title="Approvals">
                  <Icon name="bell" />{approvals ? <span className="dot" aria-hidden="true">{approvals}</span> : null}
                </a>
                <details className="menu" id="user-menu">
                  <summary className="icon-btn" aria-label="Your account"><span className="avatar-btn" aria-hidden="true">{email ? email[0].toUpperCase() : '?'}</span></summary>
                  <div className="menu-panel narrow">
                    <p className="menu-item muted">{email ? <>Signed in as <strong>{email}</strong></> : 'Not signed in'}</p>
                    {email ? <div className="menu-foot"><form method="post" action="/auth/signout"><button className="btn sm" type="submit">Sign out</button></form></div> : null}
                  </div>
                </details>
              </div>
            </div>
          </header>
          <nav className="navbar" aria-label="Main">
            <div className="wrap">
              <Launcher />
              <span className="appname">Valley Capital</span>
              <NavLinks approvals={approvals} />
            </div>
          </nav>
        </div>
        <main className="wrap" id="main" tabIndex={-1}>
          {flash}
          {children}
        </main>
      </body>
    </html>
  );
}
