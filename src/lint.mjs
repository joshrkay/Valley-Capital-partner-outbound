// The outbound linter. Pure code, no model. It checks a draft against the house rules and against the facts and claims the drafter was given.
// What it catches: banned and cliche language, the wrong word for the audience, figures and names that are not in a cleared fact, "I read your..."
// statements with no source, firm promises that are not an approved claim, an asset leaking from a context-only fact, bad links, wrong length.
// What it cannot do: judge whether a message is good or kind. A principal reads every draft.
import { normText } from './model.mjs';

const MARK = /\{\{\s*(claim|page)\s*:\s*([^}\s]+)\s*\}\}/g;
const ANY_MARK = /\{\{[^}]*\}\}/g;
export const BANK_AUDIENCE = 'bank';

export function splitMarkers(body) {
  const claimIds = []; const pageIds = [];
  for (const m of String(body).matchAll(MARK)) (m[1] === 'claim' ? claimIds : pageIds).push(m[2]);
  const known = [...String(body).matchAll(MARK)].length;
  const opens = (String(body).match(/\{\{/g) ?? []).length;          // counts unterminated markers too
  const closes = (String(body).match(/\}\}/g) ?? []).length;
  return { free: String(body).replace(ANY_MARK, ' ').replace(/[ \t]+/g, ' '), claimIds, pageIds, malformed: Math.max(opens, closes) - known };
}

export function expandBody(body, claims, siteUrl) {
  return String(body).replace(MARK, (_, kind, id) => (kind === 'claim' ? (claims.find((c) => c.id === id)?.text ?? `[UNKNOWN CLAIM ${id}]`) : `${siteUrl}${id}`));
}

const re = (p, flags = 'i') => new RegExp(`\\b(?:${p})\\b`, flags);
const words = (s) => (String(s).trim() ? String(s).trim().split(/\s+/).length : 0);
const sentences = (s) => String(s).split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter(Boolean);
const FIG = /\$?\d[\d,]*(?:\.\d+)?%?/g;
const digits = (s) => String(s).replace(/[$,%]/g, '');

// input: { channel, audience, sector, step, subject, body, personalization, spokenOnly?, internalText?, recipient, sender, facts, contextFacts, claims, rules, pages }
export function lintDraft(input) {
  const { channel, audience, sector, subject = '', body = '', personalization = [], recipient, sender, facts = [], contextFacts = [], claims, rules, pages } = input;
  const errors = []; const warnings = [];
  const err = (code, message) => errors.push({ code, message });
  const warn = (code, message) => warnings.push({ code, message });
  const { config, desk, terminology, bankAvoid } = rules;
  const { free, claimIds, pageIds, malformed } = splitMarkers(body);
  const expanded = expandBody(body, claims, config.siteUrl);
  const checked = `${subject}\n${free}`;                                   // everything the model wrote itself
  const looseText = `${checked}\n${input.internalText ?? ''}`;            // plus internal-only text, checked for language but not for facts
  const factById = new Map(facts.map((f) => [f.id, f]));
  const factsHay = normText(digits(`${facts.map((f) => `${f.claim} ${f.quote} ${f.publisher}`).join(' ')} ${sender?.phone ?? ''}`));   // the sender's own callback number is allowed

  if (malformed) err('MALFORMED_MARKER', 'A {{...}} marker is malformed. Use {{claim:id}} or {{page:/path/}}.');
  if (/<[a-z][^>]*>/i.test(looseText)) err('HTML', 'Plain text only: no HTML.');
  if (/\p{Extended_Pictographic}/u.test(looseText)) err('EMOJI', 'No emoji.');
  if (/!/.test(looseText)) err('EXCLAMATION', 'No exclamation marks.');

  // Language.
  for (const p of desk.banned ?? []) { const m = looseText.match(re(p)); if (m) err('BANNED_WORD', `"${m[0]}" is on the banned list (the website's docs/voice.md).`); }
  for (const p of terminology.banned ?? []) { const m = looseText.match(re(p)); if (m) err('BANNED_WORD', `"${m[0]}" is not used in outreach.`); }
  for (const p of desk.british ?? []) { const m = looseText.match(new RegExp(`\\b(?:${p})`, 'i')); if (m) err('BRITISH_SPELLING', `"${m[0]}": use American spelling.`); }
  for (const p of terminology.cliches ?? []) { const m = looseText.match(re(p)); if (m) err('CLICHE', `"${m[0]}" is a stock outreach phrase. Say the specific thing instead.`); }
  for (const p of terminology.brokerPhrases ?? []) { const m = looseText.match(re(p)); if (m) err('BROKER_LANGUAGE', `"${m[0]}" reads as a broker or a daisy chain. State the role plainly through {{claim:principal-buyer}} where it is approved, or say nothing about it.`); }
  for (const p of terminology.bluntAsks ?? []) { const m = looseText.match(re(p)); if (m) err('BLUNT_ASK', `"${m[0]}": do not ask what the bank has for sale, ask for a list, or press with a deadline. Ask how they handle buyers and confidentiality agreements, or invite a one-page summary through an approved claim.`); }
  if (/\u2014/.test(looseText)) warn('EM_DASH', 'An em dash reads as machine-written in an email. Use a period or a comma.');
  for (const p of desk.fillerPhrases ?? []) { const m = looseText.match(re(p)); if (m) warn('FILLER', `"${m[0]}" is filler.`); }
  const avoid = audience === BANK_AUDIENCE ? bankAvoid : (terminology.audiences?.[audience]?.avoid ?? []);
  for (const a of avoid) { const m = looseText.match(new RegExp(a.pattern, 'i')); if (m) err('WRONG_TERM', `"${m[0]}": say "${a.say}" for a ${audience}.`); }
  if (!avoid.length && audience !== BANK_AUDIENCE) warn('NO_TERMINOLOGY', `No terminology rules exist for the ${audience} audience yet (research agenda D2). Check the wording by hand.`);

  // Claims: the firm speaks only through approved markers.
  for (const id of claimIds) {
    const c = claims.find((x) => x.id === id);
    if (!c) err('CLAIM_UNKNOWN', `Claim "${id}" does not exist.`);
    else if (!c.approved) err('CLAIM_UNAPPROVED', `Claim "${id}" is not approved for use.`);
    else if (!c.sectors.includes(sector)) err('CLAIM_WRONG_SECTOR', `Claim "${id}" is not approved for ${sector}.`);
    else if (!c.audiences.includes(audience)) err('CLAIM_WRONG_AUDIENCE', `Claim "${id}" is not approved for a ${audience}.`);
  }
  for (const id of config.requiredClaims?.[audience]?.[channel] ?? []) if (!claimIds.includes(id)) err('CLAIM_REQUIRED', `A ${audience} ${channel} must include {{claim:${id}}}.`);
  for (const cp of terminology.claimPhrases ?? []) {
    const m = checked.match(re(cp.pattern));
    if (m) err('CLAIM_NOT_APPROVED', `"${m[0]}" is a statement about the firm. ${cp.claim ? `Use {{claim:${cp.claim}}} or remove it.` : 'There is no approved claim for it. Remove it.'}`);
  }

  // Links, addresses, attachments.
  if (pageIds.length > 1) err('TOO_MANY_LINKS', 'At most one link.');
  for (const p of pageIds) if (!(config.linkTargets?.[audience] ?? []).includes(p) || !pages.has(p)) err('LINK_NOT_ALLOWED', `"${p}" is not an allowed page for a ${audience}.`);
  if (/https?:\/\/|www\.|[\w.+-]+@[\w-]+\.\w+/i.test(looseText)) err('RAW_URL', 'No raw URLs or email addresses. Links go in as {{page:/path/}}; the signature is added by the system.');
  if (channel === 'email' && /\battach\w*/i.test(checked)) err('ATTACHMENT', 'No attachments on a first email.');
  if (channel === 'linkedin_note' && (claimIds.length || pageIds.length)) err('LINKEDIN_CLAIM', 'A LinkedIn note carries no claims and no link.');

  // Figures and names must come from a cleared fact.
  for (const m of free.matchAll(FIG)) { const d = digits(m[0]); if (d && !factsHay.includes(normText(d))) err('FIGURE_NOT_IN_FACTS', `"${m[0]}" is not in any cleared fact.`); }
  const allowed = new Set();
  const addWords = (s) => String(s ?? '').split(/[^A-Za-z]+/).filter(Boolean).forEach((w) => allowed.add(w.toLowerCase()));
  [recipient.name, recipient.title, recipient.institution, ...(recipient.aliases ?? []), sender?.name, 'Valley Capital Partners', ...(desk.allowedEntities ?? [])].forEach(addWords);
  (config.allowedAcronyms ?? []).forEach((a) => allowed.add(a.toLowerCase()));
  facts.forEach((f) => addWords(`${f.claim} ${f.quote} ${f.publisher}`));
  const unknown = new Set();
  for (const s of sentences(free)) {
    const toks = s.match(/[A-Za-z][A-Za-z'’-]*/g) ?? [];
    toks.slice(1).forEach((t) => { if (/^(?:[A-Z][a-z]+|[A-Z]{2,})$/.test(t) && !allowed.has(t.toLowerCase())) unknown.add(t); });
  }
  for (const u of unknown) err('NAME_NOT_IN_FACTS', `"${u}" is a name or term that is not in the recipient details or a cleared fact.`);

  // Anything that sounds like "I know something about you" must be a listed, sourced statement.
  const pers = personalization.map((p) => ({ text: String(p.text ?? ''), ids: Array.isArray(p.fact_ids) ? p.fact_ids : [] }));
  for (const p of pers) {
    if (!p.ids.length || p.ids.some((i) => !factById.has(i))) err('PERSONALIZATION_BAD_FACT', `Personalization "${p.text.slice(0, 60)}" cites a missing or uncleared fact. Cleared facts only.`);
    if (!normText(free).includes(normText(p.text))) warn('ORPHAN_PERSONALIZATION', `Listed personalization "${p.text.slice(0, 60)}" does not appear in the message.`);
    const cited = normText(p.ids.map((i) => `${factById.get(i)?.claim ?? ''} ${factById.get(i)?.quote ?? ''}`).join(' ')).split(' ').filter((w) => w.length > 4);
    const overlap = normText(p.text).split(' ').filter((w) => w.length > 4 && cited.includes(w)).length;
    if (p.ids.every((i) => factById.has(i)) && overlap < 2) warn('PERSONALIZATION_THIN_SUPPORT', `Personalization "${p.text.slice(0, 60)}" shares little with the fact it cites. Check it says only what the fact says.`);
  }
  for (const s of sentences(free)) {
    if ((terminology.observational ?? []).some((p) => new RegExp(p, 'i').test(s)) && !pers.some((p) => p.ids.length && (normText(s).includes(normText(p.text)) || normText(p.text).includes(normText(s))))) {
      err('PERSONALIZATION_UNSOURCED', `"${s.slice(0, 80)}" claims knowledge of the recipient with no cleared fact behind it. Remove it or cite a fact.`);
    }
  }

  // A context-only fact (an asset, a risk, an unverified item) must not leak into the message.
  const phrases = new Set(); const nums = new Set();
  for (const f of contextFacts) {
    for (const m of `${f.claim} ${f.quote}`.matchAll(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g)) phrases.add(m[0].toLowerCase());
    for (const m of `${f.claim} ${f.quote}`.matchAll(FIG)) if (digits(m[0]).replace(/\D/g, '').length >= 3) nums.add(digits(m[0]));
  }
  const freeNorm = normText(free);
  for (const p of phrases) if (!allowed.has(p.split(' ')[0]) && freeNorm.includes(normText(p))) err('CONTEXT_LEAK', `"${p}" comes from a context-only fact and must not appear in a message.`);
  for (const n of nums) if (!factsHay.includes(normText(n)) && free.replace(/,/g, '').includes(n)) err('CONTEXT_LEAK', `"${n}" comes from a context-only fact and must not appear in a message.`);

  // Length and shape.
  const wc = words(expanded);
  const lim = config.limits?.[channel];
  if (lim?.words && (wc < lim.words[0] || wc > lim.words[1])) err('LENGTH', `${wc} words; a ${channel} is ${lim.words[0]} to ${lim.words[1]}.`);
  if (lim?.chars && expanded.length > lim.chars) err('LENGTH', `${expanded.length} characters; the limit is ${lim.chars}.`);
  if (channel === 'email') {
    if (!subject.trim()) err('SUBJECT_MISSING', 'An email needs a subject.');
    if (subject.length > (lim?.subject ?? 60)) err('SUBJECT_LENGTH', `Subject is ${subject.length} characters; the limit is ${lim?.subject ?? 60}.`);
    if (/^(re|fwd?)\s*:/i.test(subject.trim())) err('SUBJECT_FAKE_REPLY', 'No "Re:" or "Fwd:" in a subject that is not a reply.');
    if (/[A-Z]{4,}/.test(subject) && subject === subject.toUpperCase()) err('SUBJECT_CAPS', 'No all-caps subject.');
  }
  if (!pers.length && facts.length) warn('NO_PERSONALIZATION', 'Cleared facts were available but the message uses none. That is allowed; check it is not generic.');
  if (!facts.length) warn('NO_FACTS', 'No cleared facts were available, so the message is generic. Run the briefer or choose another account.');
  return { errors, warnings, words: wc };
}
