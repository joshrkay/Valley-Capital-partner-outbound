// The Status page's coverage card (PRD next-five E18-S1), kept pure so it can be tested without a server. The report is the engine's
// (src/coverage.mjs): counts only, every cell's text already written by the engine's fixed template, so the card and the command line
// say the same thing. Nothing here adds a fact the report does not hold.
export function coverageCard(report) {
  if (!report) return null;
  return {
    intro: report.intro,
    note: report.note ?? null,
    asOf: report.candidates?.latestRepdte ?? null,
    provisional: !!report.candidates?.provisional,
    columns: report.groups.map((g) => ({ id: g.id, label: `${g.label} (${g.total})` })),
    rows: report.rows.map((r) => ({ id: r.id, label: r.label, sub: !!r.parent, built: r.built, basis: r.basis, detail: r.detail?.text ?? null, cells: report.groups.map((g) => r.cells[g.id].text) })),
    notRunNote: report.notRunNote ?? null,
  };
}
