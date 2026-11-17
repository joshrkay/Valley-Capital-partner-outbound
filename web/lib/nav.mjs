// The app's pages, for the tab bar, the "More" menu and the app launcher (docs/design-redesign.md, 4 and 4.1). Pure and static, so the
// small client components that mark the current page and filter the launcher hold no data of their own.
export const NAV = Object.freeze([
  { group: 'Daily work', items: [
    { href: '/triage', label: 'This week', blurb: 'What changed, and whom to call first', icon: 'home', tile: 't-home' },
    { href: '/candidates', label: 'Banks', blurb: 'Every bank the scoring run ranks', icon: 'bank', tile: 't-bank' },
    { href: '/accounts', label: 'Outreach', blurb: 'Banks a principal chose to work', icon: 'people', tile: 't-out' },
    { href: '/drafts', label: 'Approvals', blurb: 'Drafts waiting for a principal', icon: 'approve', tile: 't-appr' },
  ] },
  { group: 'Market', items: [
    { href: '/sales', label: 'Who sells to whom', blurb: 'Past loan sales, by seller and buyer', icon: 'dollar', tile: 't-sale' },
    { href: '/intermediaries', label: 'Advisors and servicers', blurb: 'Who runs sales for banks and CMBS trusts', icon: 'people', tile: 't-net', also: ['/servicers'] },
    { href: '/market', label: 'Market by quarter', blurb: 'Totals for our six metros, no names', icon: 'chart', tile: 't-mkt' },
    { href: '/network', label: 'Our network', blurb: 'People and firms we know, for introductions', icon: 'people', tile: 't-out' },
  ] },
  { group: 'Setup and checks', items: [
    { href: '/status', label: 'System status', blurb: 'Is the data current? Run a refresh', icon: 'setup', tile: 't-set' },
    { href: '/senders', label: 'Senders', blurb: 'Whose name and address messages go out under', icon: 'doc', tile: 't-set' },
    { href: '/calibration', label: 'Score check', blurb: 'How well the score picked banks in the past', icon: 'gauge', tile: 't-score' },
    { href: '/pilot', label: 'Briefer pilot', blurb: 'Checking research on banks we already know', icon: 'doc', tile: 't-set' },
  ] },
]);

// The launcher lists every page, so it also names pages the menus reach another way.
export const LAUNCHER_EXTRA = Object.freeze([
  { group: 'Market', item: { href: '/servicers', label: 'CMBS special servicers', blurb: 'Servicers of loans in our metros, from SEC filings', icon: 'people', tile: 't-net' } },
  { group: 'Help', item: { href: '/glossary', label: 'Glossary', blurb: 'Plain names used across the app, and the old ones', icon: 'book', tile: 't-set' } },
]);

export const PRIMARY = NAV[0].items;
export const MORE = NAV.slice(1);

const under = (path, href) => path === href || path.startsWith(`${href}/`);

// The menu item a path belongs to: its own page, a record under it (/candidates/fdic:1), or a page it stands for (/servicers).
export function currentHref(pathname) {
  const path = String(pathname ?? '/').split(/[?#]/)[0] || '/';
  if (path === '/') return '/triage';
  for (const g of NAV) for (const it of g.items) if (under(path, it.href) || (it.also ?? []).some((h) => under(path, h))) return it.href;
  return null;
}

// Is the current page one of the "More" menu's?
export const inMore = (pathname) => MORE.some((g) => g.items.some((it) => it.href === currentHref(pathname)));

// Every page, grouped, for the launcher; with a query, only the pages whose name or purpose contains it.
export function launcherGroups(q = '') {
  const groups = NAV.map((g) => ({ group: g.group, items: [...g.items] }));
  for (const { group, item } of LAUNCHER_EXTRA) {
    const g = groups.find((x) => x.group === group);
    if (g) g.items.push(item); else groups.push({ group, items: [item] });
  }
  const needle = String(q ?? '').trim().toLowerCase();
  if (!needle) return groups;
  return groups.map((g) => ({ ...g, items: g.items.filter((it) => `${it.label} ${it.blurb}`.toLowerCase().includes(needle)) })).filter((g) => g.items.length);
}

// The theme switch in the global header: automatic (follow the device), light, dark, in that order. Kept in a cookie, read on the server,
// so the page is drawn in the right theme with no script.
export const THEMES = Object.freeze(['auto', 'light', 'dark']);
export const THEME_NAMES = Object.freeze({ auto: 'automatic', light: 'light', dark: 'dark' });
export const themeOf = (cookie) => (THEMES.includes(cookie) ? cookie : 'auto');
export const nextTheme = (cookie) => THEMES[(THEMES.indexOf(themeOf(cookie)) + 1) % THEMES.length];
