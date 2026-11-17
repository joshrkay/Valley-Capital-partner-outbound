// Approvals (docs/design-redesign.md, 5.6), kept pure so it can be tested without a server: the linter's and the guard's findings as plain
// sentences, the words they matched highlighted in the draft, and blocked drafts last. The finding's code stays as a hidden line.

// The first quoted word or phrase in a finding's message: what the linter matched.
export const quotedTerm = (f) => { const m = /"([^"]{1,80})"/.exec(String(f?.message ?? '')); return m ? m[1] : null; };
// What to highlight for a finding: the quoted words, or the character a rule names (an em dash, an exclamation mark).
export const matchedTerm = (f) => quotedTerm(f) ?? { EM_DASH: '\u2014', EXCLAMATION: '!' }[f?.code] ?? null;

const TEMPLATES = Object.freeze({
  BANNED_WORD: (t) => `Uses the word "${t}"; remove it.`,
  BRITISH_SPELLING: (t) => `"${t}" is British spelling; use the American one.`,
  CLICHE: (t) => `"${t}" is a stock outreach phrase; say the specific thing instead.`,
  FILLER: (t) => `"${t}" is filler; cut it.`,
  BROKER_LANGUAGE: (t) => `"${t}" reads like a broker; state the firm's role plainly through its approved claim, or leave it out.`,
  BLUNT_ASK: (t) => `"${t}" asks too bluntly; ask how they handle buyers and confidentiality agreements instead.`,
  CLAIM_NOT_APPROVED: (t) => `"${t}" is a statement about the firm with no approved claim behind it; use the approved claim or remove it.`,
  FIGURE_NOT_IN_FACTS: (t) => `"${t}" is not in any cleared fact; remove it.`,
  NAME_NOT_IN_FACTS: (t) => `"${t}" is not in the recipient's details or a cleared fact; remove it.`,
  CONTEXT_LEAK: (t) => `"${t}" comes from context-only detail and must never be in a message; remove it.`,
});
const FIXED = Object.freeze({
  EM_DASH: 'Uses an em dash, which reads as machine-written; use a period or a comma.',
  EXCLAMATION: 'Uses an exclamation mark; remove it.',
  EMOJI: 'Uses an emoji; remove it.',
  HTML: 'Contains HTML; plain text only.',
  RAW_URL: 'Contains a raw link or email address; links go in as approved page markers.',
  SUBJECT_MISSING: 'The email has no subject.',
  SUBJECT_CAPS: 'The subject is in capitals.',
  SUBJECT_FAKE_REPLY: 'The subject pretends to be a reply ("Re:" or "Fwd:").',
});

// A finding as a sentence a principal acts on; the linter's own message when there is no plainer one.
export function findingText(f) {
  const t = quotedTerm(f);
  if (t && TEMPLATES[f?.code]) return TEMPLATES[f.code](t);
  return FIXED[f?.code] ?? String(f?.message ?? '').trim() ?? '';
}

// The draft's text cut into parts, the matched words marked, case-insensitively and whole-word where the term is a word.
export function highlight(text, terms) {
  const src = String(text ?? '');
  const list = [...new Set((terms ?? []).filter((t) => typeof t === 'string' && t.trim()))].sort((a, b) => b.length - a.length);
  if (!list.length || !src) return [{ t: src, mark: false }];
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rx = new RegExp(list.map((t) => (/^\w/.test(t) ? `\\b${esc(t)}` : esc(t)) + (/\w$/.test(t) ? '\\b' : '')).join('|'), 'gi');
  const out = [];
  let last = 0;
  for (const m of src.matchAll(rx)) {
    if (m.index > last) out.push({ t: src.slice(last, m.index), mark: false });
    out.push({ t: m[0], mark: true });
    last = m.index + m[0].length;
  }
  if (last < src.length) out.push({ t: src.slice(last), mark: false });
  return out;
}

// Drafts ready to approve first, blocked ones last; newest first within each.
export function sortDrafts(rows) {
  const blocked = (d) => (d.status === 'blocked' || (d.errors ?? []).length ? 1 : 0);
  return [...rows].sort((a, b) => blocked(a) - blocked(b) || String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
}
