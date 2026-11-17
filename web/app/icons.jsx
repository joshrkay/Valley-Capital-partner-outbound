// Line icons drawn inline as SVG: no icon font, no request. Decorative only (aria-hidden); every control that shows one also has a label.
// Shared by server and client components, so it imports nothing.
const PATHS = {
  waffle: <>{[5, 12, 19].flatMap((y) => [5, 12, 19].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="2" fill="currentColor" stroke="none" />))}</>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></>,
  help: <><circle cx="12" cy="12" r="9" /><path d="M9.6 9.2a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.2.9-1.2 1.7v.4" /><circle cx="12" cy="17" r="1" fill="currentColor" stroke="none" /></>,
  bell: <><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></>,
  moon: <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2.5V5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8" /></>,
  auto: <><circle cx="12" cy="12" r="8.5" /><path d="M12 3.5v17a8.5 8.5 0 0 0 0-17z" fill="currentColor" stroke="none" /></>,
  down: <path d="M6.5 9.5l5.5 5.5 5.5-5.5" />,
  bank: <><path d="M3 9.5L12 4l9 5.5z" /><path d="M5.5 11v7M10 11v7M14 11v7M18.5 11v7M3 20.5h18" /></>,
  home: <><path d="M3.5 11.5L12 4l8.5 7.5" /><path d="M6 10v10h4.5v-5.5h3V20H18V10" /></>,
  bolt: <path d="M13 2.5L5 13.5h6.2l-.7 8 8-11h-6.2z" />,
  dollar: <><path d="M12 3v18" /><path d="M16.5 7.8c-.4-1.7-2.2-2.8-4.5-2.8-2.6 0-4.5 1.3-4.5 3.3 0 4.6 9.2 2.3 9.2 7 0 2.1-2 3.5-4.7 3.5-2.4 0-4.3-1.1-4.7-3" /></>,
  gauge: <><path d="M3.5 17.5a8.5 8.5 0 1 1 17 0" /><path d="M12 17.5l4.5-5.5" /><circle cx="12" cy="17.5" r="1.4" fill="currentColor" stroke="none" /></>,
  pin: <><path d="M12 21.5s-6.5-6.4-6.5-11.5a6.5 6.5 0 0 1 13 0c0 5.1-6.5 11.5-6.5 11.5z" /><circle cx="12" cy="10" r="2.3" /></>,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  warn: <><path d="M12 3.5l9.5 17h-19z" /><path d="M12 10v4.5" /><circle cx="12" cy="17.3" r="1" fill="currentColor" stroke="none" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5.5" /><circle cx="12" cy="7.8" r="1" fill="currentColor" stroke="none" /></>,
  close: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  people: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M15.5 4.6a3.5 3.5 0 0 1 0 6.8M17.5 14.2A6.5 6.5 0 0 1 21.5 20" /></>,
  approve: <><path d="M6 3h9l4 4v14H6z" /><path d="M14.5 3v4.5H19" /><path d="M9 14l2.2 2.2 4.3-4.4" /></>,
  chart: <><path d="M4 20.5h16" /><path d="M7 17v-6M12 17V5M17 17V9" /></>,
  setup: <><circle cx="12" cy="12" r="3.2" /><path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.5 5.5l1.9 1.9M16.6 16.6l1.9 1.9M5.5 18.5l1.9-1.9M16.6 7.4l1.9-1.9" /></>,
  doc: <><path d="M6 3h9l4 4v14H6z" /><path d="M14.5 3v4.5H19M9 12h6M9 16h6" /></>,
  book: <><path d="M5 4.5h10.5a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3z" /><path d="M5 17a3 3 0 0 1 3-3h10.5" /></>,
};

export function Icon({ name, className = '' }) {
  return <svg className={`ic${className ? ` ${className}` : ''}`} viewBox="0 0 24 24" aria-hidden="true" focusable="false">{PATHS[name] ?? null}</svg>;
}

// A square colored tile with an icon, as CRM tools mark each kind of page and record.
export function Tile({ icon, tone, size = '' }) {
  return <span className={`tile ${tone}${size ? ` ${size}` : ''}`} aria-hidden="true"><Icon name={icon} /></span>;
}
