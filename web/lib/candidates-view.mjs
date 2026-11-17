// Which candidates a principal sees in the list, decided the same way the engine's listCandidates decides it on the full file
// (src/candidates.mjs), but applied to the database projection: a suppressed institution never appears; a promoted one has left the
// list; a dismissed one returns only when a signal fires that was not present at the dismissal; a snoozed one returns on its date.
// Pure: the engine's suppressedBy and each dismissed candidate's signals are passed in.
export const certOf = (key) => String(key ?? '').split(':')[1] ?? '';

// A bank's priority, in place of its tier (D-UI2): Call first keeps a small "A", Worth a look a small "B". A bank that fails a hard filter
// is Excluded, whatever its score; below Worth a look it is Not ranked.
export const PRIORITIES = Object.freeze({
  A: Object.freeze({ id: 'A', label: 'Call first', letter: 'A', cls: 'a' }),
  B: Object.freeze({ id: 'B', label: 'Worth a look', letter: 'B', cls: 'b' }),
  none: Object.freeze({ id: 'none', label: 'Not ranked', letter: '', cls: 'none' }),
  excluded: Object.freeze({ id: 'excluded', label: 'Excluded', letter: '', cls: 'ex' }),
});
export function priorityOf(row) {
  if (row?.filtered || (Array.isArray(row?.filtersFailed) && row.filtersFailed.length)) return PRIORITIES.excluded;
  return PRIORITIES[row?.tier] ?? PRIORITIES.none;
}

export function visibleCandidates({ rows, suppression = [], decisions = {}, aliases = {}, suppressedBy, signalsFor = () => [], today }) {
  const out = [];
  for (const r of rows) {
    if (suppressedBy({ key: r.key, cert: certOf(r.key), name: r.name }, suppression, aliases)) continue;
    const d = decisions[r.key];
    let status = 'new';
    if (d?.status === 'promoted') status = 'promoted';
    else if (d?.status === 'dismissed') status = signalsFor(r.key).some((s) => !(d.signalIds ?? []).includes(s.id)) ? 'returned' : 'dismissed';
    else if (d?.status === 'snoozed') status = today < d.until ? 'snoozed' : 'new';
    if (['promoted', 'dismissed', 'snoozed'].includes(status)) continue;
    out.push({ ...r, status });
  }
  return out;
}

// ---- The Banks list (docs/design-redesign.md, 5.2) ---------------------------------------------------------------------------------
// Everything below picks, formats and compares stored figures with the rule files; it adds no figure the engine did not store.

// The three parts of the score, in plain words. The engine calls the first axis "distress"; the page calls it Pressure.
export const AXES = Object.freeze([
  Object.freeze({ id: 'distress', label: 'Pressure', q: 'Is the bank under strain?', cls: 'p' }),
  Object.freeze({ id: 'fit', label: 'Fit', q: 'Does it hold what we buy, where we buy?', cls: 'f' }),
  Object.freeze({ id: 'timing', label: 'Timing', q: 'Did something just change?', cls: 't' }),
]);

// Each axis's maximum: the sum of its components' weights in scoring.json (45, 30 and 25 as shipped).
export function axisMax(scoring) {
  const out = Object.fromEntries(AXES.map((a) => [a.id, 0]));
  for (const c of scoring?.components ?? []) if (c.axis in out) out[c.axis] += Number(c.weight) || 0;
  return out;
}

// A row's points by axis: the list row carries them flat, the full item under axes.
export const axesOf = (row) => Object.fromEntries(AXES.map((a) => [a.id, Number(row?.axes?.[a.id] ?? row?.[a.id] ?? 0) || 0]));

// Why a bank that scores enough for Call first is only Worth a look: "Short of Call first: pressure 12.9 (needs 15)". Compares the stored
// points with scoring.json's tier cuts; '' when it does not apply.
export function tierGap(row, tiers) {
  const A = tiers?.A;
  if (!A || row?.tier !== 'B' || !(Number(row?.score) >= A.score)) return '';
  const pts = axesOf(row);
  const gaps = [];
  if (A.distress !== undefined && pts.distress < A.distress) gaps.push(`pressure ${pts.distress.toFixed(1)} (needs ${A.distress})`);
  if (A.fit !== undefined && pts.fit < A.fit) gaps.push(`fit ${pts.fit.toFixed(1)} (needs ${A.fit})`);
  return gaps.length ? `Short of Call first: ${gaps.join(', ')}` : '';
}

// The rule a Call first bank meets, in words, from scoring.json's tier cuts.
export function tierRule(tiers) {
  const A = tiers?.A ?? {};
  return `Call first needs ${A.score} points or more, with at least ${A.distress} for pressure and ${A.fit} for fit. Worth a look needs ${tiers?.B?.score} or more.`;
}

// The buy-box sectors in plain words, as the list and the bank page name them.
export const SECTOR_WORDS = Object.freeze({ hospitality: 'hotel', retail: 'retail', multifamily: 'apartments' });
export const sectorWord = (s) => SECTOR_WORDS[s?.sector] ?? String(s?.label ?? s?.sector ?? '').toLowerCase();
const listWords = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} or ${xs.at(-1)}`);

// The largest single-type ceiling from the engine's fitCeiling (D-UI5): never a sum. Types that share one ceiling because the reports put
// them in the same line (hotel and retail, inside commercial property) are named together: "hotel or retail". null when the engine has
// not stored one yet.
export function bestCeiling(fitCeiling) {
  const list = (Array.isArray(fitCeiling) ? fitCeiling : []).filter((f) => f && f.high !== null && f.high !== undefined && Number.isFinite(Number(f.high)));
  if (!list.length) return null;
  const top = list.reduce((a, f) => (Number(f.high) > Number(a.high) ? f : a), list[0]);
  const same = list.filter((f) => Number(f.high) === Number(top.high) && (f.category ?? null) === (top.category ?? null));
  const tier = same.some((f) => f.tier === 'inferred') ? 'inferred' : top.tier ?? null;
  return { high: Number(top.high), low: top.low ?? null, label: listWords([...new Set(same.map(sectorWord))]), tier, asOf: top.asOf ?? null, sectors: same.map((f) => f.sector) };
}

// The one-line reason: the card's headline when the engine stores one, else the card's second sentence (its first is always "<Bank>: Call
// Report data as of <date>."). The count of further reasons is the card's other sentences.
export function reasonOf(row) {
  if (typeof row?.headline === 'string' && row.headline.trim()) return row.headline.trim();
  const s = Array.isArray(row?.sentences) ? row.sentences : [];
  return typeof s[1]?.text === 'string' ? s[1].text : '';
}
export const moreReasons = (row) => Math.max(0, (Array.isArray(row?.sentences) ? row.sentences.length : 0) - 2);

// The list views, sorts and filters, read from the query string (GET parameters, as before).
export const VIEWS = Object.freeze([['A', 'Call first'], ['AB', 'Call first and worth a look'], ['all', 'All banks']]);
export const SORTS = Object.freeze([['score', 'score'], ['fit', 'could fit our buy box'], ['new', 'new first']]);
const one = (v) => (Array.isArray(v) ? v[0] : v);
export function listParams(sp = {}) {
  const view = VIEWS.some(([k]) => k === one(sp?.view)) ? one(sp.view) : 'AB';
  const sort = SORTS.some(([k]) => k === one(sp?.sort)) ? one(sp.sort) : 'score';
  const metro = /^\d{5}$/.test(String(one(sp?.metro) ?? '')) ? one(sp.metro) : '';
  const q = typeof one(sp?.q) === 'string' ? one(sp.q).trim().slice(0, 80) : '';
  return { view, sort, metro, q, fresh: one(sp?.fresh) === '1' };
}
// A link to the list with some parameters changed; defaults are left out.
export function listHref(p, change = {}) {
  const n = { ...p, ...change };
  const qs = new URLSearchParams();
  if (n.view && n.view !== 'AB') qs.set('view', n.view);
  if (n.metro) qs.set('metro', n.metro);
  if (n.sort && n.sort !== 'score') qs.set('sort', n.sort);
  if (n.fresh) qs.set('fresh', '1');
  if (n.q) qs.set('q', n.q);
  const s = qs.toString();
  return s ? `/candidates?${s}` : '/candidates';
}

export const isFresh = (row) => !!row?.isNew || row?.status === 'returned';
export function inView(row, view) {
  const p = priorityOf(row).id;
  if (view === 'A') return p === 'A';
  if (view === 'AB') return p === 'A' || p === 'B';
  return true;
}
export const viewCounts = (rows) => Object.fromEntries(VIEWS.map(([k]) => [k, rows.filter((r) => inView(r, k)).length]));

export function matchesQuery(row, q) {
  const needle = String(q ?? '').trim().toLowerCase();
  if (!needle) return true;
  return [row?.name, [row?.city, row?.state].filter(Boolean).join(', ')].some((x) => String(x ?? '').toLowerCase().includes(needle));
}

// Best first by the chosen sort; excluded banks always last; ties by score, then name, so the order is stable.
export function sortRows(rows, sort = 'score') {
  const score = (r) => (Number.isFinite(Number(r?.score)) && r?.score !== null ? Number(r.score) : -Infinity);
  const fit = (r) => bestCeiling(r?.fitCeiling)?.high ?? -Infinity;
  const fresh = (r) => (r?.isNew ? 2 : 0) + (r?.status === 'returned' ? 1 : 0);
  const key = sort === 'fit' ? (r) => [fit(r), score(r)] : sort === 'new' ? (r) => [fresh(r), score(r)] : (r) => [score(r), 0];
  const ex = (r) => (priorityOf(r).id === 'excluded' ? 1 : 0);
  const cmp = (x, y) => (x === y ? 0 : x > y ? -1 : 1);
  return [...rows].sort((a, b) => {
    if (ex(a) !== ex(b)) return ex(a) - ex(b);
    const [a1, a2] = key(a), [b1, b2] = key(b);
    return cmp(a1, b1) || cmp(a2, b2) || String(a?.name ?? '').localeCompare(String(b?.name ?? ''));
  });
}

// The rows a view shows, in order.
export const listRows = (rows, p) => sortRows(rows.filter((r) => inView(r, p.view) && (!p.fresh || isFresh(r)) && matchesQuery(r, p.q)), p.sort);
