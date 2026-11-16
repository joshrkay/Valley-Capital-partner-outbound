// The Status page's outcomes section (PRD E15-S4), kept pure so it can be tested without a server. The report is the engine's
// (src/outcomes.mjs), the same one `outbound outcomes report` prints. This only lays it out: group labels (signal types, tiers, lead-time
// buckets) and counts. The report holds no name, note or account id, and nothing here adds one.
export const COLUMNS = Object.freeze([
  { key: 'accounts', label: 'Accounts', title: 'Accounts in the group, each counted once' },
  { key: 'calls', label: 'Calls', title: 'Confirmed calls and meetings recorded by hand' },
  { key: 'byHand', label: 'By hand', title: 'Meetings recorded by hand (guard event): held calls with no outcome recorded' },
  { code: 'held', label: 'Held', title: 'Accounts with a held call' },
  { code: 'nda_requested', label: 'NDA asked', title: 'Accounts that asked for a confidentiality agreement' },
  { code: 'nda_signed', label: 'NDA signed', title: 'Accounts that signed a confidentiality agreement' },
  { code: 'tape_promised', label: 'Tape promised', title: 'Accounts that promised a loan tape' },
  { code: 'tape_received', label: 'Tape received', title: 'Accounts that sent a loan tape' },
]);
const SHOWN = new Set(COLUMNS.map((c) => c.code).filter(Boolean));
const cells = (g) => COLUMNS.map((c) => (c.code ? g.reached?.[c.code] ?? 0 : g[c.key] ?? 0));
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function outcomesView(report) {
  const calls = report.totals?.calls ?? 0;
  const table = (title, groups) => ({ title, rows: Object.entries(groups ?? {}).map(([label, g]) => ({ label, cells: cells(g) })) });
  const lt = report.leadTimeDays ?? {};
  return {
    empty: calls === 0,
    headline: calls === 0
      ? 'No call is recorded yet: no confirmed call outcome and no meeting recorded by hand.'
      : `${plural(report.outcomes, 'confirmed call outcome')} and ${plural(report.meetingsByHand ?? 0, 'meeting')} recorded by hand${report.since ? ` since ${report.since}` : ''}.`,
    note: report.note,
    tooFew: !!report.tooFewToTune,
    minToTune: report.minToTune,
    columns: COLUMNS.map(({ label, title }) => ({ label, title })),
    tables: [
      table('By the signal types that started the account', report.bySignalType),
      table('By tier', report.byTier),
      table('By lead time, first signal to first meeting', report.byLeadTime),
    ],
    totals: { label: 'All accounts', cells: cells(report.totals ?? {}) },
    otherOutcomes: Object.entries(report.totals?.reached ?? {}).filter(([c]) => !SHOWN.has(c)).map(([code, n]) => ({ code, n })),
    leadTime: lt.accounts ? `Lead time over ${plural(lt.accounts, 'account')}: min ${lt.min} days, median ${lt.median}, max ${lt.max}.` : 'No account has both a first signal date and a held call yet, so there is no lead time.',
    counting: report.counting,
    weights: report.weights,
  };
}
