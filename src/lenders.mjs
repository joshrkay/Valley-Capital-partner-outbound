// The lender match (docs/county-loans.md; docs/county-data-build-vs-buy.md 5.2, component 5): a lender, beneficiary or holder named on
// a county document, mapped to a bank in the universe (fdic:CERT), or set aside. The rule enforcement orders use (resolveParty in
// src/sources/enforcement.mjs): a principal's alias first (candidates/aliases.json), then the exact normalized name, narrowed by the
// state and then the city the document gives for that party. One bank is a match; two or more are ambiguous; none is unmatched. Both
// go to the review list with their candidates. Nothing fuzzy merges: a similar name is a suggestion for a principal, never a match.
//
// Set aside before any matching, and never matched to a bank, whatever an alias says:
//   - MERS, a nominee and not the lender. "MERS, as nominee for <lender>" is read as <lender>: the document names the lender.
//   - trustees: a trustee or foreclosure-services company, a title company, a public trustee, a reconveyance company, or any party
//     named "as trustee" (a bank acting as a securitization's trustee is not its lender);
//   - servicers: a party "as servicer" or "as attorney-in-fact", or a name with "servicing", "servicer" or "loan services";
//   - law firms: LLP, PLLC, P.C., P.A., Esq., "attorneys", "law firm", "law office", "law group";
//   - people: a lender named as one or more people ("Pat Example and Jordan Example"), with no word an institution's name carries.
//     A private person who financed a sale is not an institution, and no person named in a notice is ever a lead: such a name is never
//     matched, and the review list counts it without naming it.
// Only the lender side is matched (lender, beneficiary, holder, assignor, assignee). A trustee, an attorney, a borrower or a grantor is
// never matched, and a borrower's or grantor's name never reaches the review list.
import { resolveParty } from './sources/enforcement.mjs';
import { matchInstitution } from './candidates.mjs';
import { norm } from './guard.mjs';

export const LENDER_ROLES = Object.freeze(['lender', 'beneficiary', 'holder', 'assignor', 'assignee']);
export const SET_ASIDE = Object.freeze({ mers: 'MERS, a nominee and not the lender', trustee: 'a trustee', servicer: 'a loan servicer', 'law-firm': 'a law firm', person: 'a person, not an institution' });
// The review list's entry for the people set aside: one line, a count, and no name.
export const PERSON_WITHHELD = '(a person named as lender: name withheld)';

// Words an institution's name carries and a person's does not: a bank's, a fund's, a company's, a government's.
const INSTITUTION_WORDS = /\b(?:bank|bancorp|banc|bancshares|n\.?\s?a\.?|national|association|savings|credit|union|trust|fsb|f\.s\.b\.?|ssb|mortgage|mtg|lending|lender|loans?|financ\w*|funding|capital|fund|investments?|investors|holdings?|properties|partners(?:hip)?|group|company|co\.|corp\.?|corporation|inc\.?|incorporated|l\.?\s?l\.?\s?c\.?|l\.?\s?p\.?|l\.?\s?l\.?\s?p\.?|ltd\.?|limited|series|services?|servicing|united|states|america|department|secretary|housing|veterans|administration|authority|agency|county|city|state|federal|church|ministries|foundation|enterprises?|ventures?|realty|homes|development|estate|equity|acceptance|commercial|residential|parts|management|solutions|systems|ranch|farms?|land|title|plc|usa)\b/i;
// Whether a lender's name reads as one or more people: two or more plain words, and no word an institution's name carries.
export function personName(name) {
  const s = String(name ?? '').replace(/\s+/g, ' ').trim();
  if (!s || INSTITUTION_WORDS.test(s) || /\d/.test(s)) return false;
  const words = s.replace(/\b(?:a\/k\/a|a\.k\.a\.?|aka|f\/k\/a|and|or|jr\.?|sr\.?|ii|iii|iv|mr\.?|mrs\.?|ms\.?|dr\.?)(?=\s|,|$)/gi, ' ').replace(/&/g, ' ').split(/[\s,]+/).filter(Boolean);
  return words.length >= 2 && words.every((w) => /^[A-Za-z][A-Za-z.'-]*$/.test(w));
}

// MERS by its full name (any case) or its initials (capitals only, so "Mers" in a surname is not MERS).
const MERS_INITIALS = /\bMERS\b/;
const MERS_NAME = /\bmortgage\s+electronic\s+registration\s+systems?\b/i;
const NOMINEE = /\bas\s+(?:a\s+)?nominee\s+for\s+(.+)$/i;
const CAPACITY = [
  [/\bas\s+(?:successor\s+|substitute\s+)?trustee\b/i, 'trustee'],
  [/\bas\s+(?:master\s+|special\s+|sub-?)?servicer\b/i, 'servicer'],
  [/\bas\s+attorney[-\s]in[-\s]fact\b/i, 'servicer'],
];
const NAMES = [
  [/\btrustees?\b|\bforeclosure\s+services?\b|\breconveyance\b|\btitle\s+(?:insurance\s+|guaranty\s+)?(?:company|co\.?|agency|corporation)(?=\W|$)/i, 'trustee'],
  [/\bservicing\b|\bservicer\b|\bloan\s+services?\b/i, 'servicer'],
  [/(?:^|[\s,])(?:LLP|L\.L\.P\.|PLLC|P\.L\.L\.C\.|P\.C\.|P\.A\.|Esq\.?)(?=\W|$)|\battorneys?(?:\s+at\s+law)?\b|\blaw\s+(?:firm|offices?|group|center|corporation)\b/i, 'law-firm'],
];
const isMers = (s) => MERS_NAME.test(s) || MERS_INITIALS.test(s);

// The set-aside class of a name, or null. MERS is checked by the caller first, because "MERS, as nominee for <lender>" is the lender.
export function setAsideClass(name) {
  const s = String(name ?? '');
  if (isMers(s) && !NOMINEE.test(s)) return 'mers';
  for (const [re, cls] of CAPACITY) if (re.test(s)) return cls;
  for (const [re, cls] of NAMES) if (re.test(s)) return cls;
  return null;
}

// The legal phrases a document adds after a lender's name, which are not part of the name: "its successors and assigns", "successor by
// merger to ...", "as beneficiary", "a national banking association". Each is cut at its first word, so only what follows the name goes.
const SUFFIXES = [
  /,?\s+(?:and\s+)?its\s+successors\b.*$/i,
  /,?\s+(?:as\s+)?successor\s+(?:by\s+merger\s+|in\s+interest\s+)?to\s+.*$/i,
  /,?\s+as\s+(?:lender|beneficiary|holder|assignee|assignor|mortgagee|payee)\b.*$/i,
  /,\s+an?\s+(?:[a-z.-]+\s+){0,4}?(?:national\s+banking\s+association|banking\s+(?:association|corporation)|state[-\s]chartered\s+bank|state\s+bank|savings\s+bank|corporation|limited\s+liability\s+company)\b.*$/i,
];
export function cleanLenderName(name) {
  let s = String(name ?? '').replace(/\s+/g, ' ').trim();
  for (const re of SUFFIXES) s = s.replace(re, '');
  return s.replace(/[\s,;]+$/, '').trim();
}

const BANK_WORDS = /\b(?:bank|bancorp|banc|national\s+association|savings|credit\s+union|trust\s+company)\b|\bN\.?\s?A\.?(?=\W|$)/i;
export const bankLike = (name) => BANK_WORDS.test(String(name ?? ''));

const candidateOf = (key, institutions, documentState) => {
  const i = institutions?.[String(key).slice(5)] ?? {};
  return { key, name: i.NAME ?? null, city: i.CITY ?? null, state: i.STALP ?? null, inDocumentState: !!documentState && i.STALP === documentState };
};

// One party, matched. `institutions` is sources/fdic/institutions.json (CERT -> { NAME, CITY, STALP }); `aliases` candidates/aliases.json.
// `documentState` is the state of the county the document was recorded in: it is never used to choose a bank (banks lend across state
// lines), only shown beside each candidate so a principal can decide. Returns one of:
//   { status: 'matched', key, how, name, matchedName }
//   { status: 'ambiguous', name, matchedName, candidates }            two or more banks share the name
//   { status: 'unmatched', name, matchedName, candidates, suggestions } no bank: candidates share the name in another state;
//                                                                       suggestions are similar names, for a principal only
//   { status: 'set-aside', class, name }                              MERS, a trustee, a servicer or a law firm
//   { status: 'not-a-lender', role, name }                            a trustee, attorney, borrower or grantor role
export function matchLender(party, { institutions = {}, aliases = {}, documentState = null } = {}) {
  const role = party?.role;
  const raw = String(party?.name ?? '').replace(/\s+/g, ' ').trim();
  if (!LENDER_ROLES.includes(role)) return { status: 'not-a-lender', role: role ?? null, name: raw };
  let name = raw, via = null;
  if (isMers(raw)) {
    const nom = NOMINEE.exec(raw);
    if (!nom) return { status: 'set-aside', class: 'mers', name: raw };
    name = nom[1].trim(); via = 'MERS as nominee';
  }
  const cls = setAsideClass(name);
  if (cls) return { status: 'set-aside', class: cls, name: raw };
  if (personName(cleanLenderName(name))) return { status: 'set-aside', class: 'person', name: raw };
  if (!name) return { status: 'unmatched', name: raw, matchedName: '', candidates: [], suggestions: [] };
  const how = (h) => (via ? `${h}, named through ${via}` : h);
  // A principal's alias, on the name exactly as the document gives it, then on the name without its legal phrases.
  const clean = cleanLenderName(name);
  for (const n of [...new Set([name, clean])]) {
    const a = resolveParty({ name: n }, { institutions: {}, aliases });
    if (a.key) return { status: 'matched', key: a.key, how: how('alias'), name: raw, matchedName: n };
  }
  const p = { name: clean, city: party.city ?? null, state: party.state ?? null };
  const m = resolveParty(p, { institutions, aliases: {} });
  if (m.key) return { status: 'matched', key: m.key, how: how(m.how), name: raw, matchedName: clean };
  if (m.how === 'ambiguous') return { status: 'ambiguous', name: raw, matchedName: clean, candidates: m.candidates.map((k) => candidateOf(k, institutions, documentState)) };
  // None. When the party's own address ruled the name out, the banks of that name elsewhere are its candidates.
  const wide = p.state || p.city ? resolveParty({ name: clean }, { institutions, aliases: {} }) : { candidates: [] };
  const candidates = (wide.candidates ?? []).map((k) => candidateOf(k, institutions, documentState));
  const suggestions = candidates.length ? [] : matchInstitution(clean, { institutions }).suggestions;
  return { status: 'unmatched', name: raw, matchedName: clean, candidates, suggestions };
}

// The review list's key for a name: its normalized form, with initials run together, so "Sample Capital Fund, L.P." and "SAMPLE
// CAPITAL FUND LP" are one entry.
export const reviewKey = (name) => norm(cleanLenderName(name)).replace(/\b([a-z]) (?=[a-z]\b)/g, '$1');
