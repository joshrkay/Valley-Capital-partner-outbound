// The Sales screen's display logic (PRD E16), kept pure so it can be tested without a server. The data is the sale ledger the engine
// builds (src/sales.mjs, sales/ledger.json). Every event is context for a principal; nothing on this screen goes in a message.
export const KIND_LABEL = Object.freeze({
  note_sale_completed: 'Note sale (CMBS)',
  dpo: 'Discounted payoff (CMBS)',
  disposition: 'Disposition (CMBS)',
  bank_disclosed_sale: 'Sale disclosed in an SEC filing',
  whole_bank_acquisition: 'Whole-bank acquisition',
  fdic_sale_announced: 'FDIC loan sale announced',
  assignment: 'Recorded assignment',
  marketed_listing: 'Listed for sale',
});
export const kindLabel = (k) => KIND_LABEL[k] ?? k;

// Where a party's own page is: a bank's candidate page, or a special servicer's page. Anything else has none.
export function partyLink(p) {
  if (!p?.key) return null;
  if (/^fdic:\d+$/.test(p.key)) return `/candidates/${encodeURIComponent(p.key)}`;
  if (p.kind === 'servicer' && p.name) return `/servicers/${encodeURIComponent(p.name)}`;
  return null;
}

// "Multifamily · Los Angeles" from an event's asset, with metro codes in words.
export function assetLine(asset, metroLabel = (c) => c) {
  if (!asset) return '';
  const where = (asset.metros?.length ? asset.metros : asset.metro ? [asset.metro] : []).map(metroLabel).join(', ') || asset.county || '';
  const what = asset.kind === 'bank' ? 'whole bank' : asset.kind === 'pool' ? `pool${asset.loans ? ` of ${asset.loans} loans` : ''}` : asset.kind === 'loan' ? 'loan' : 'not stated';
  return [what, asset.propertyType, where].filter(Boolean).join(' · ');
}

export const countsLine = (o, label = (k) => k) => Object.entries(o ?? {}).sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).map(([k, n]) => `${label(k)} ${n}`).join(', ');

// A seller without its events, for the table: the page shows counts and the latest date, and links to the institution.
export const sellerRow = (s) => ({ key: s.key, kind: s.kind, name: s.name, matched: s.matched ?? null, counts: s.counts, total: s.total, latest: s.latest, link: partyLink(s) });

export function recoveryText(r) {
  if (!r) return '–';
  if (r.value === null || r.value === undefined) return `– (${r.reason ?? 'not computable'})`;
  return `≈ ${(r.value * 100).toFixed(1)}%`;
}
