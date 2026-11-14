// Pure display helpers for the routes section (PRD E17). Every value comes from the stored record; nothing here adds a fact.
export const TYPE_LABEL = Object.freeze({ direct: 'Direct', counsel: 'Counsel', advisor: 'Advisor', board: 'Board', forum: 'Forum' });

const bridgeText = (b) => (!b ? '–' : b.kind === 'membership' ? `${b.association} (${b.id})` : `${b.name} (${b.id})`);
const targetText = (t) => (t?.kind === 'candidates' ? (t.names?.length ? `Candidates: ${t.names.join(', ')}` : 'No one named yet') : t?.name ?? '–');

export function routeRow(r) {
  return { id: r.id, rank: r.rank ?? null, type: TYPE_LABEL[r.type] ?? r.type, target: targetText(r.target), bridge: bridgeText(r.bridge), tier: r.tier, current: !!r.current, asOf: r.asOf ?? null, reasoning: r.reasoning };
}

// Each piece of evidence, with its link when it has one: findings (their URL), ledger events and county records (their link), and the
// network entries (no link: they are the firm's own records).
export function evidenceLinks(r) {
  const e = r.evidence ?? {};
  return [
    ...(e.findings ?? []).map((f) => ({ label: f.id, href: f.url ?? null, note: `${f.question}, ${f.sourceTier}${f.published ? `, ${f.published}` : ''}` })),
    ...(e.ledger ?? []).map((x) => ({ label: x.id, href: x.link ?? null, note: String(x.eventKind ?? '').replace(/_/g, ' ') })),
    ...(e.county ?? []).map((x) => ({ label: x.id, href: x.link ?? null, note: String(x.documentType ?? '').replace(/_/g, ' ') })),
    ...(e.network ?? []).map((id) => ({ label: `network ${id}`, href: null })),
  ].map(({ note, ...rest }) => (note ? { ...rest, note } : rest));
}
