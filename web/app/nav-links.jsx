'use client';
// The tab bar's links and its "More" menu, with the current page marked (aria-current). A client component only to read the path; it
// holds no data. It also closes any open menu (a native <details>) on an outside click, on Escape and when the page changes.
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { PRIMARY, MORE, currentHref, inMore } from '../lib/nav.mjs';
import { Icon, Tile } from './icons.jsx';

export function NavLinks({ approvals = null }) {
  const pathname = usePathname() ?? '/';
  const cur = currentHref(pathname);
  useEffect(() => {
    const menus = () => document.querySelectorAll('details.menu[open]');
    for (const m of menus()) m.open = false;
    const onClick = (e) => { for (const m of menus()) if (!m.contains(e.target) || e.target.closest('.menu-panel a')) m.open = false; };
    const onKey = (e) => { if (e.key === 'Escape') for (const m of menus()) { m.open = false; m.querySelector('summary')?.focus(); } };
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('click', onClick); document.removeEventListener('keydown', onKey); };
  }, [pathname]);
  return (
    <>
      <div className="navtabs">
        {PRIMARY.map((it) => (
          <a key={it.href} href={it.href} aria-current={it.href === cur ? 'page' : undefined}>
            {it.label}
            {it.href === '/drafts' && approvals ? <span className="count" aria-label={`${approvals} waiting`}>{approvals}</span> : null}
          </a>
        ))}
      </div>
      <details className={`menu${inMore(pathname) ? ' is-active' : ''}`} id="more-menu">
        <summary className="more-btn">More <Icon name="down" /></summary>
        <div className="menu-panel">
          {MORE.map((g) => (
            <div key={g.group} className="menu-group">
              <h3>{g.group}</h3>
              {g.items.map((it) => (
                <a key={it.href} href={it.href} aria-current={it.href === cur ? 'page' : undefined}>
                  <Tile icon={it.icon} tone={it.tile} size="sm" />
                  <span>{it.label}<small>{it.blurb}</small></span>
                </a>
              ))}
            </div>
          ))}
        </div>
      </details>
    </>
  );
}
