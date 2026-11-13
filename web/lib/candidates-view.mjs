// Which candidates a principal sees in the list, decided the same way the engine's listCandidates decides it on the full file
// (src/candidates.mjs), but applied to the database projection: a suppressed institution never appears; a promoted one has left the
// list; a dismissed one returns only when a signal fires that was not present at the dismissal; a snoozed one returns on its date.
// Pure: the engine's suppressedBy and each dismissed candidate's signals are passed in.
export const certOf = (key) => String(key ?? '').split(':')[1] ?? '';

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
