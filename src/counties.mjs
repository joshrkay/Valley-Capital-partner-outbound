// The county sources (docs/county-loans.md): every adapter the pipeline knows, which counties are watched, and each one's coverage for
// the Status page and `outbound loans status`. Each real county's adapter is registered here once its spike has read and dated its
// robots.txt and terms (county-data-build-vs-buy 3.4, D-B8); it runs only after a principal records the decision its terms carry and
// config.counties.sources enables it. Registered: the invented example (for the tests; it never runs against the network); Caldwell
// County, TX, enabled on a principal's decision of 2026-11-18; and Jefferson and Douglas (GTS), both not enabled.
import { exampleCounty } from './sources/counties/example.mjs';
import { caldwellCounty } from './sources/counties/caldwell.mjs';
import { jefferson } from './sources/counties/jefferson.mjs';
import { douglas } from './sources/counties/douglas.mjs';

export const COUNTY_SOURCES = Object.freeze({ [exampleCounty.id]: exampleCounty, [caldwellCounty.id]: caldwellCounty, [jefferson.id]: jefferson, [douglas.id]: douglas });

export function countySource(id, registry = COUNTY_SOURCES) {
  const s = registry[id];
  if (!s) throw new Error(`No county source "${id}". Known: ${Object.keys(registry).join(', ') || 'none'}.`);
  return s;
}

const countyWords = (w) => (w.county?.name ? `${w.county.name} County${w.state ? `, ${w.state}` : ''}` : w.label);

// The watched counties: the sources config.counties.watch lists, and any source that has run (it has a state in loans/state.json).
// An example source is never in the shipped config and cannot run against the network, so it appears only in test data.
export function watchedCounties({ config = {}, state = {}, registry = COUNTY_SOURCES } = {}) {
  const listed = config?.watch ?? [];
  const ids = [...new Set([...listed, ...Object.keys(state?.sources ?? {})])];
  return ids.map((id) => {
    const src = registry[id], st = state?.sources?.[id] ?? null;
    const w = { id, label: src?.label ?? st?.label ?? id, county: src?.county ?? st?.county ?? null, state: src?.state ?? st?.state ?? null, channel: src?.channel ?? st?.channel ?? null,
      cadence: src?.cadence ?? st?.cadence ?? null, example: !!src?.example, configured: listed.includes(id), known: !!src, lastRun: st?.lastRun ?? null, lastOk: st?.lastOk ?? null };
    return { ...w, countyLabel: countyWords(w) };
  }).sort((a, b) => (a.countyLabel < b.countyLabel ? -1 : a.countyLabel > b.countyLabel ? 1 : a.id < b.id ? -1 : 1));
}

// One coverage row per watched county: the last run and its outcome, documents read in it, new and changed in the last `weekDays`
// days (from the runs in that window), and from the index, documents stored, those matched to a bank, and names on the review list.
export function countyCoverage({ config = {}, state = {}, now = new Date(), registry = COUNTY_SOURCES, weekDays = 7 } = {}) {
  const from = now.getTime() - weekDays * 86400000, to = now.getTime();
  return watchedCounties({ config, state, registry }).map((w) => {
    const st = state?.sources?.[w.id] ?? null;
    const recent = (st?.runs ?? []).filter((r) => { const t = Date.parse(r?.ranAt ?? ''); return Number.isFinite(t) && t >= from && t <= to && r.outcome !== 'failed'; });
    const idx = state?.index?.bySource?.[w.id] ?? null;
    return {
      ...w, read: w.lastRun && w.lastRun.outcome !== 'failed' ? w.lastRun.read ?? null : null,
      newThisWeek: st ? recent.reduce((n, r) => n + (r.added ?? 0), 0) : null, changedThisWeek: st ? recent.reduce((n, r) => n + (r.changed ?? 0), 0) : null,
      stored: idx?.documents ?? null, matchedDocuments: idx?.matchedDocuments ?? null, reviewNames: idx?.reviewNames ?? null,
    };
  });
}
