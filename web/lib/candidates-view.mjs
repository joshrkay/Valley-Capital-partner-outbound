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
