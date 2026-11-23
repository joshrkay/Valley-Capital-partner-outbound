// The "This week" screen's logic (PRD E6-S5), kept pure so it can be tested without a server. The record is the stored triage
// (src/triage.mjs, triage/<date>.json); nothing here adds a fact the record does not hold.
import { bestCeiling } from './candidates-view.mjs';

export const SECTIONS = Object.freeze([
  ['actNow', 'Act now', 'Something new at a bank nobody is talking to yet: a strong event, or a move to Call first.'],
  ['watch', 'Watch', 'Other changes worth knowing about: new signals, moves to or from Worth a look, and signals that turned on or off.'],
]);
export const CONVERSATION_INTRO = 'Shown apart: a principal is already talking to these banks, so nothing here is act now.';

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

// One act-now card (docs/design-redesign.md, 5.4): priority, name, the first reason, and the could-fit ceiling from the bank's candidate
// item when there is one. Picks stored fields only; a bank with no candidate item (a failed bank, a servicer) has no ceiling and no place.
export function cardOf(item, candidate = null) {
  const tier = candidate?.tier ?? item?.tier ?? null;
  return {
    key: item?.key, name: item?.name ?? candidate?.name ?? item?.key, href: primaryHref(item),
    tier, excluded: !!(candidate?.filtersFailed?.length || candidate?.filtered), ranked: !!candidate || !!item?.tier,
    reason: item?.reason ?? '', more: moreFindings(item).map((f) => f.reason),
    place: [candidate?.city, candidate?.state].filter(Boolean).join(', '),
    ceiling: bestCeiling(candidate?.fitCeiling), hasCandidate: !!candidate,
    dates: item?.dates ?? [], ids: item?.ids ?? [], pages: otherPages(item), external: externalLinks(item),
  };
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// "Left out" in one line: who is off this week's list and why, counts only.
export function leftOutLine(counts = {}) {
  const parts = [counts.snoozed ? `${counts.snoozed} snoozed` : '', counts.dismissed ? `${counts.dismissed} dismissed` : '', counts.heldBack ? `${counts.heldBack} held back` : ''].filter(Boolean);
  const never = [counts.optedOut ? `${plural(counts.optedOut, 'opt-out')}` : '', counts.suppressed ? `${counts.suppressed} do not contact` : ''].filter(Boolean);
  if (!parts.length && !never.length) return 'Nobody left off this week.';
  return `Left off this week: ${parts.length ? parts.join(', ') : 'none'}${never.length ? `. Never listed: ${never.join(', ')}` : ''}.`;
}

// System health in one line: "Data is current" or how many issues there are; the detail stays on the Status page.
export function healthLine(t) {
  const n = Number(t?.counts?.healthIssues ?? 0);
  const sc = t?.health?.scoring;
  const scored = !sc || sc.status === 'none' ? 'no candidate list yet' : sc.status === 'fresh' ? `scored ${sc.ageDays === 0 ? 'today' : `${plural(sc.ageDays, 'day')} ago`}` : sc.status === 'behind' ? 'scoring is behind the FDIC data' : 'scoring is stale';
  const failed = (t?.health?.runs ?? []).length;
  return { ok: n === 0, text: n === 0 ? 'Data is current.' : `${plural(n, 'issue')} with the data or the runs.`, detail: [scored, failed ? `${plural(failed, 'failed run')}` : 'no failed runs'].join(' · ') };
}

// CC BY 4.0: the parcel sources the county lines' property types came from (src/triage.mjs `attributions`), said once under the lists.
export const attributionText = (t) => (Array.isArray(t?.attributions) && t.attributions.length ? `Property type: ${t.attributions.filter((a) => typeof a === 'string').join('; ')}.` : '');
