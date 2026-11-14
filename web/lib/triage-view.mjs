// The "This week" screen's logic (PRD E6-S5), kept pure so it can be tested without a server. The record is the stored triage
// (src/triage.mjs, triage/<date>.json); nothing here adds a fact the record does not hold.
export const SECTIONS = Object.freeze([
  ['actNow', 'Act now', 'A strong event, or a move to Tier A, at an institution nobody is talking to yet.'],
  ['watch', 'Watch', 'Other new signals, Tier B movements, and state signals that turned on or off.'],
]);
export const CONVERSATION_INTRO = 'Shown apart: a principal is already talking to these institutions. Nothing here is act now.';

// Where an item's name links: its account if a principal promoted it, else its candidate page, else its servicer's page.
export const primaryHref = (item) => [item?.links?.account, item?.links?.candidate, item?.links?.servicer].find((h) => typeof h === 'string' && h.startsWith('/')) ?? null;

// The app's other pages for an item, besides the one its name links to.
export const otherPages = (item) => [['account', 'account'], ['candidate', 'candidate page'], ['servicer', 'servicer']]
  .map(([k, label]) => ({ href: item?.links?.[k] ?? null, label }))
  .filter((l) => typeof l.href === 'string' && l.href.startsWith('/') && l.href !== primaryHref(item));

// Links that leave the app: SEC filing indexes and the FDIC loan-sale page, on those two sites only.
export const externalLinks = (item) => [
  ...(item?.links?.filings ?? []).map((href) => ({ href, label: 'SEC filing' })),
  ...(item?.links?.fdicLoanSales ? [{ href: item.links.fdicLoanSales, label: 'FDIC loan sales' }] : []),
].filter((l) => typeof l.href === 'string' && /^https:\/\/(www\.)?(sec|fdic)\.gov\//.test(l.href));

// The record's own findings after the first, which the item's reason already states (in conversation, every finding is new).
export const moreFindings = (item) => (item?.category === 'inConversation' ? item.findings ?? [] : (item?.findings ?? []).slice(1));
