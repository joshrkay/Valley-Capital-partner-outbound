// The CMBS link (docs/county-loans.md, section 9): a county filing in scope whose current holder is a CMBS trust (by the index's
// current-holder rule: the holder or an assignee, or the beneficiary when no one else holds the loan now), linked to that trust's own
// record of the loan in its monthly SEC filing (Form ABS-EE, exhibit 102), so a principal sees the loan's servicing status and the
// special servicer to call next to the county event. These are exactly the documents on which the county index writes no event for the
// originating bank (relation 'originated'): the link is their event.
//
// Three steps, all on stored data (no network here; sources.edgar and the county watchers fetch):
//   1. The name. cmbsTrustOf reads a party's name for a securitization trust and its series ("2020-B21", "2019-C7", "2017-SMP"). A
//      residential or consumer securitization (a "Mortgage Pass-Through Certificates" without "Commercial", Asset-Backed, Home Equity,
//      Alternative Loan Trust...) is refused. The name only picks candidates: the proof that a trust is CMBS is that it is in
//      sources/edgar/trusts.json, which holds only trusts whose EX-102 is in the SEC's CMBS namespace.
//   2. The asset. Among the trust's stored loans (sources/edgar/loans.json), the one whose original amount equals the document's to the
//      dollar, with a property in the document's state, and whose property city or county agrees with the document's, or whose
//      originator is the document's original lender. Two or more candidates, or a missing key, give no link: the document is recorded as
//      "trust named, loan not found", with the reason, for a principal to look up by hand. Nothing is guessed.
//   3. The block. A linked document carries a `cmbs` block: the trust, the asset, the property's name and type, the balance, the
//      paid-through date, the payment status, the special-servicing transfer date, the workout strategy (CREFC codes, decoded), the
//      latest valuation, occupancy, NOI and DSCR, the master and special servicers, and the SEC filing links.
//
// RULES. As for every county document (src/loans.mjs): context for the firm's principals only, never in a message, never given to a
// model, never scored. loans/cmbs.json lives in loans/, which no model-facing action and no scoring run loads (src/uow.mjs). It holds no
// borrower, grantor or owner, no address, APN or legal description, and none of a servicer's free-text commentary (which can name
// borrowers and people): every field of the block is picked by name.
import { join } from 'node:path';
import { readJson, writeJson } from './store.mjs';
import { norm } from './guard.mjs';
import { cleanLenderName, setAsideClass } from './lenders.mjs';
import { allDocuments, loansPaths, documentDate, countyLabel, publicLink, longDate, scopeAll, scopeShown, DOC_TYPES, STAGES, CONTEXT_NOTE } from './loans.mjs';
import { CODES, edgarPaths } from './sources/edgar.mjs';

export const CMBS_LINKS_REL = 'loans/cmbs.json';
export const cmbsLinksPath = (dir) => join(loansPaths(dir).base, 'cmbs.json');
// The roles whose party can be the trust that holds the loan now. The original lender ('lender') is read only as the originator.
export const CMBS_ROLES = Object.freeze(['holder', 'beneficiary', 'assignee']);
// The parties that hold the loan now, by the county index's current-holder rule (src/loans.mjs, docs/county-loans.md 3a): the current
// holder or an assignee; the deed-of-trust beneficiary only when the document names no separate current holder. MERS alone is a nominee,
// not a holder. So a trust named only as an earlier beneficiary, with someone else holding the loan now, is never linked.
export function currentHolders(doc) {
  const ps = (doc?.parties ?? []).filter((p) => CMBS_ROLES.includes(p.role));
  const now = ps.filter((p) => (p.role === 'holder' || p.role === 'assignee') && setAsideClass(p.name) !== 'mers');
  return now.length ? now : ps.filter((p) => p.role === 'beneficiary');
}
export const LINK_NOTE = `${CONTEXT_NOTE} A county document linked to a CMBS trust's own record of the loan (SEC Form ABS-EE, exhibit 102). No borrower, no address, and no servicer commentary.`;
// Why a named trust's loan was not linked, in words. Each is a reason to look the loan up by hand, never a guess.
export const NOT_FOUND = Object.freeze({
  'edgar-not-run': 'no SEC EDGAR pull is stored yet, so the trust\'s loan file cannot be read',
  'trust-not-in-edgar': 'the trust is not among the CMBS trusts in the stored SEC EDGAR pull',
  'trust-ambiguous': 'more than one CMBS trust in the stored SEC EDGAR pull has this series, and the name does not say which',
  'no-original-amount': 'the county document states no original loan amount',
  'no-asset': 'no loan in the trust\'s stored file has the same original amount, state and city, county or originator (the stored file keeps only loans in our metros and sectors)',
  ambiguous: 'more than one loan in the trust\'s stored file has the same original amount, state and city, county or originator',
});

// ---- 1. The name ---------------------------------------------------------------------------------------------------------------
// A series token: a year, a hyphen and up to ten letters and digits. Never part of a date ("2018-06-08").
const SERIES = /(?<![\w-])((?:19|20)\d{2})-([A-Za-z0-9]{1,10})(?![\w-]|\/\d)/g;
const seriesTokens = (s) => [...String(s ?? '').matchAll(SERIES)].map((m) => `${m[1]}-${m[2].toUpperCase()}`);
// What a residential or consumer securitization's name says. Any one of these and the name is not read as CMBS.
const RESIDENTIAL = [
  /(?<!commercial\s+)mortgage\s+pass[-\s]?through/i,          // "Mortgage Pass-Through Certificates" without "Commercial"
  /(?<!commercial\s+)mortgage[-\s]backed/i,
  /(?<!commercial\s+)mortgage\s+loan\s+trust/i,
  /\basset[-\s]backed\b/i, /\bhome\s+equity\b/i, /\balternative\s+loan\b/i, /\balt[-\s]a\b/i, /\bresidential\b/i, /\bhome\s+loans?\b/i,
  /\bmanufactured\s+housing\b/i, /\b(?:arm|adjustable\s+rate(?:\s+mortgage)?)\s+trust\b/i, /\bstructured\s+asset\b/i,
  /\bstudent\s+loan/i, /\bauto\b/i, /\bcredit\s+card/i, /\breceivables\b/i, /\bequipment\b/i,
];
export const residentialSecuritization = (name) => RESIDENTIAL.some((re) => re.test(String(name ?? '')));
// A securitization names itself a trust, a certificate or a commercial mortgage. A bank, a fund or a person does not.
const SECURITIZATION = /\btrust\b|\bcertificates?\b|\bcommercial\s+mortgage\b|\bpass[-\s]?through\b/i;
// Words every shelf's trust name carries, which say nothing about which shelf it is.
const GENERIC = new Set(['commercial', 'mortgage', 'mortgages', 'securities', 'security', 'trust', 'pass', 'through', 'passthrough', 'certificates', 'certificate',
  'series', 'the', 'of', 'and', 'for', 'inc', 'incorporated', 'corp', 'corporation', 'co', 'company', 'llc', 'lp', 'ltd', 'limited', 'notes', 'registered', 'holders']);
// The shelf's own words: the name without its series, its generic words and its punctuation; initials run together ("J.P." is "jp").
export const shelfTokens = (s) => {
  const series = new Set(seriesTokens(s).map((t) => norm(t)));
  let n = norm(String(s ?? '').replace(SERIES, ' '));
  for (const t of series) n = n.replace(t, ' ');
  return n.replace(/\b([a-z]) (?=[a-z]\b)/g, '$1').split(' ').filter((w) => w && !GENERIC.has(w) && !/^(?:19|20)\d{2}$/.test(w));
};
// The words that join a trustee to the trust it acts for: "as Trustee for the registered holders of <trust>".
const CONNECTOR = /\b(?:certificate\s*holders|holders|benefit|behalf)\s+of\s+(?:the\s+)?|\btrustee\s+(?:for|of)\s+(?:the\s+)?|\bin\s+trust\s+for\s+(?:the\s+)?/gi;
const CERTS_TAIL = /\s*(?:commercial\s+)?mortgage\s+pass[-\s]?through\s+certificates?\b.*$/i;
const SERIES_TAIL = /\s*\bseries\s+(?:19|20)\d{2}-.*$/i;
function trustPart(segment) {
  let s = String(segment ?? '').trim();
  let last = null;
  for (const m of s.matchAll(CONNECTOR)) last = m;
  if (last) s = s.slice(last.index + last[0].length);
  return s.replace(CERTS_TAIL, '').replace(SERIES_TAIL, '').replace(/^(?:as\s+)?(?:successor\s+)?trustee\b\s*/i, '').replace(/[\s,;.]+$/, '').trim();
}

// A party's name read for a CMBS trust: { trust, series, shelfTokens, commercial }, or null when it names no securitization with a
// series, or names a residential or consumer one. `trust` is the trust's name as the document gives it (null when the document names
// only the certificates' series); `commercial` says the name itself reads "Commercial". Example (invented): "Example Bank, N.A., as
// Trustee for the registered holders of Example 2019-X1 Mortgage Trust, Commercial Mortgage Pass-Through Certificates, Series 2019-X1"
// gives { trust: 'Example 2019-X1 Mortgage Trust', series: '2019-X1', shelfTokens: ['example'], commercial: true }.
export function cmbsTrustOf(name) {
  const s = String(name ?? '').replace(/\s+/g, ' ').trim();
  if (!s || residentialSecuritization(s) || !SECURITIZATION.test(s)) return null;
  const all = seriesTokens(s);
  if (!all.length) return null;
  const series = all[0];
  const segments = s.split(/\s*[,;]\s*/);
  let trust = null, shelf = null;
  for (const seg of segments) {
    if (!seriesTokens(seg).includes(series)) continue;
    const t = trustPart(seg);
    if (t && shelfTokens(t).length) { trust = t; break; }
  }
  if (!trust) {
    // Only the certificates carry the series ("... holders of Example Commercial Mortgage Securities Inc., Commercial Mortgage
    // Pass-Through Certificates, Series 2007-X1"): the shelf is the name before them, past any bare legal form ("Inc.", "LLC").
    const at = segments.findIndex((seg) => seriesTokens(seg).includes(series));
    for (let i = at - 1; i >= 0 && !shelf; i--) {
      const t = trustPart(segments[i]);
      if (/^(?:the\s+)?certificates?\b|pass[-\s]?through/i.test(segments[i]) && !shelfTokens(t).length) continue;
      if (shelfTokens(t).length) shelf = t;
      else if (!/^(?:inc|incorporated|llc|l\.?l\.?c|lp|l\.?p|corp|corporation|co|company|ltd|limited|n\.?\s?a)\.?$/i.test(segments[i].trim())) break;
    }
  }
  return { trust, series, shelfTokens: shelfTokens(trust ?? shelf ?? ''), commercial: /\bcommercial\b/i.test(s) };
}

// The stored CMBS trusts (sources/edgar/trusts.json) that a name can be: the same series, and the same shelf when the name gives one.
// { trusts, by } with by 'series and shelf' or 'series' (a name that gives only the certificates' series).
export function trustCandidates(named, trusts = {}) {
  const sameSeries = Object.values(trusts ?? {}).filter((t) => t && t.cik && seriesTokens(t.name).includes(named.series));
  if (!named.shelfTokens.length) return { trusts: sameSeries, by: 'series' };
  const agrees = (a, b) => a.length > 0 && b.length > 0 && (a.every((x) => b.includes(x)) || b.every((x) => a.includes(x)));
  return { trusts: sameSeries.filter((t) => agrees(named.shelfTokens, shelfTokens(t.name))), by: 'series and shelf' };
}

// ---- 2. The asset --------------------------------------------------------------------------------------------------------------
const placeKey = (s) => norm(s).replace(/\s+/g, '');
const countyKey = (s) => norm(s).replace(/\b(?:county|parish|city and county of)\b/g, '').replace(/[^a-z]/g, '');
// The lender's name for comparing with the trust's originator: its legal phrases cut (src/lenders.mjs), a leading "The" and its legal
// form dropped, so "Example Bank, N.A." and "Example Bank, National Association" are one name. Exact after that: nothing fuzzy.
const NOMINEE = /\bas\s+(?:a\s+)?nominee\s+for\s+(.+)$/i;
const LEGAL_FORM = / (?:national association|n a|na|fsb|f s b|llc|l l c|lp|l p|inc|incorporated|corp|corporation|co|company|ltd|limited)$/;
export function originatorKey(name) {
  const raw = String(name ?? '');
  let s = norm(cleanLenderName(NOMINEE.exec(raw)?.[1] ?? raw)).replace(/^the /, '');
  for (let i = 0; i < 3 && LEGAL_FORM.test(s); i++) s = s.replace(LEGAL_FORM, '');
  return s;
}
// The city in a document's property address, "<street>, <city>, <ST> <ZIP>", only when the state is the document's. Used to match and
// never stored: the address stays in the county document.
export function cityOf(address, state) {
  const m = /,\s*([A-Za-z][A-Za-z .'-]*?)\s*,?\s+([A-Z]{2})\s+\d{5}(?:-\d{4})?\s*$/.exec(String(address ?? '').replace(/\s+/g, ' ').trim());
  return m && (!state || m[2] === state) ? m[1].trim() : null;
}
const statedAmount = (a) => (a && (a.basis === 'document' || a.basis === 'index') && Number.isFinite(Number(a.value)) && a.value !== null ? Number(a.value) : null);

// One county document against the stored EDGAR data, for one named trust. Pure. Returns:
//   { status: 'linked', trust, loan, property, matchedOn, disagreed, trustBy }
//   { status: 'not-found', reason, candidates?, trust? }     a reason from NOT_FOUND
//   { status: 'unconfirmed' }                                 the name is not shown to be CMBS: not in the EDGAR pull, and it does not
//                                                             say "Commercial" (it could be residential); not recorded
export function matchCmbsAsset(doc, named, { trusts = null, loans = {} } = {}) {
  if (!trusts) return named.commercial ? { status: 'not-found', reason: 'edgar-not-run' } : { status: 'unconfirmed' };
  const c = trustCandidates(named, trusts);
  if (!c.trusts.length) return named.commercial ? { status: 'not-found', reason: 'trust-not-in-edgar' } : { status: 'unconfirmed' };
  if (c.trusts.length > 1) return { status: 'not-found', reason: 'trust-ambiguous', candidates: c.trusts.length };
  const trust = c.trusts[0];
  const amount = statedAmount(doc?.amounts?.originalPrincipal);
  if (amount === null) return { status: 'not-found', reason: 'no-original-amount', trust };
  const state = doc?.state ?? null;
  const city = cityOf(doc?.property?.address, state);
  const county = doc?.county?.name ?? null;
  const lenders = new Set((doc?.parties ?? []).filter((p) => p.role === 'lender').map((p) => originatorKey(p.name)).filter(Boolean));
  const hits = [];
  for (const loan of Object.values(loans ?? {}).filter((l) => l && String(l.cik) === String(trust.cik)).sort((a, b) => String(a.key).localeCompare(String(b.key)))) {
    if (!Number.isFinite(Number(loan.originalBalance)) || loan.originalBalance === null || Math.round(Number(loan.originalBalance)) !== Math.round(amount)) continue;
    const originator = loan.originator ? originatorKey(loan.originator) : '';
    const originatorOk = !!originator && lenders.has(originator);
    let best = null;
    for (const p of loan.properties ?? []) {
      if (!state || p?.state !== state) continue;
      const cityOk = !!city && !!p.city && placeKey(p.city) === placeKey(city);
      const countyOk = !!county && !!p.county && countyKey(p.county) === countyKey(county);
      if (!cityOk && !countyOk && !originatorOk) continue;
      const matchedOn = ['originalAmount', 'state', ...(cityOk ? ['city'] : []), ...(countyOk ? ['county'] : []), ...(originatorOk ? ['originator'] : []),
        ...(doc?.deedOfTrust?.dated && doc.deedOfTrust.dated === loan.originated ? ['originationDate'] : [])];
      const disagreed = [...(city && p.city && !cityOk ? ['city'] : []), ...(county && p.county && !countyOk ? ['county'] : []), ...(lenders.size && originator && !originatorOk ? ['originator'] : [])];
      if (!best || matchedOn.length > best.matchedOn.length) best = { property: p, matchedOn, disagreed };
    }
    if (best) hits.push({ loan, ...best });
  }
  if (!hits.length) return { status: 'not-found', reason: 'no-asset', trust };
  if (hits.length > 1) return { status: 'not-found', reason: 'ambiguous', candidates: hits.length, trust };
  return { status: 'linked', trust, trustBy: c.by, ...hits[0] };
}

// ---- 3. The block --------------------------------------------------------------------------------------------------------------
const decode = (table, c) => (c === undefined || c === null || c === '' ? null : { code: String(c), label: CODES[table][String(c)] ?? `Unknown code ${c}` });
// The CREFC workout strategy code, decoded (1 Modification ... 13 To be determined, 98 Other).
export const workoutOf = (c) => decode('workout', c);
const n = (v) => (v === undefined || v === null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const inSpecialServicing = (l) => !!l.specialServicingSince && !(l.returnedToMasterOn && l.returnedToMasterOn >= l.specialServicingSince);
const SEC = 'https://www.sec.gov/Archives/edgar/data';
// The filing's folder on sec.gov, and its EX-102, from the loan's source block ("ABS-EE <accession> <file>").
export function secLinks(loan, trust) {
  const cik = /^\d+$/.test(String(loan?.cik ?? '')) ? Number(loan.cik) : null;
  const m = /^ABS-EE\s+(\d{10}-\d{2}-\d{6})(?:\s+(\S+\.xml))?$/i.exec(String(loan?._source?.endpoint ?? ''));
  const folder = (acc) => (cik && /^\d{10}-\d{2}-\d{6}$/.test(String(acc ?? '')) ? `${SEC}/${cik}/${String(acc).replace(/-/g, '')}/` : null);
  return {
    absEe: m ? folder(m[1]) : null,
    ex102: m && m[2] && folder(m[1]) ? `${folder(m[1])}${m[2]}` : null,
    distributionReport: folder(trust?.distributionReport),
  };
}

// The block a linked document carries. Every field is picked by name from the stored loan, the matched property and the trust, so
// nothing else a record may hold (a servicer's commentary, a borrower) can come along.
export function cmbsBlock(loan, trust = null, property = null) {
  const p = property ?? loan.properties?.[0] ?? {};
  const workouts = [...new Set([...(loan.workouts ?? []), loan.workout].filter(Boolean).map((w) => String(w.code)))];
  return {
    trust: loan.trust ?? trust?.name ?? null, cik: String(loan.cik), assetNumber: String(loan.assetNumber), loanKey: loan.key, reportingPeriod: loan.period ?? null,
    property: { name: p.name ?? null, type: p.type ? { code: String(p.type.code), label: p.type.label } : null, city: p.city ?? null, state: p.state ?? null, county: p.county ?? null },
    properties: (loan.properties ?? []).length,
    originalBalance: n(loan.originalBalance), originated: loan.originated ?? null, originator: loan.originator ?? null,
    balance: n(loan.balance), paidThrough: loan.paidThrough ?? null,
    paymentStatus: decode('paymentStatus', loan.paymentStatus?.code),
    inSpecialServicing: inSpecialServicing(loan), specialServicingSince: loan.specialServicingSince ?? null, returnedToMasterOn: loan.returnedToMasterOn ?? null,
    workout: workoutOf(loan.workout?.code ?? workouts[0]), workouts: workouts.map(workoutOf),
    valuation: n(p.valuation), valuationDate: p.valuationDate ?? null, occupancy: n(p.occupancy), noi: n(p.noi), dscr: n(p.dscr),
    masterServicer: loan.primaryServicer ?? null, specialServicer: loan.specialServicer ?? trust?.specialServicer ?? null,
    specialServicerMatched: loan.specialServicerMatched ?? trust?.specialServicerMatched ?? null,
    paidOff: !!loan.paidOff, liquidation: loan.liquidationPrepayment ? decode('liquidationPrepayment', loan.liquidationPrepayment.code) : null,
    signals: (loan.signals ?? []).map((s) => ({ type: s.type, label: s.label })),
    filings: secLinks(loan, trust),
  };
}
export const BLOCK_KEYS = Object.freeze(Object.keys(cmbsBlock({ cik: '1', assetNumber: '1', key: 'cmbs:1:1', properties: [] })));

// ---- The sentence ---------------------------------------------------------------------------------------------------------------
// "$9.7M", as the web app writes EDGAR amounts.
export function moneyShort(v) {
  const a = Number(v);
  if (!Number.isFinite(a)) return '';
  if (a >= 1e9) return `$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `$${(a / 1e3).toFixed(0)}K`;
  return `$${a.toFixed(0)}`;
}
// The property type in a sentence, from the EX-102 code: "a $9.7M hotel loan".
const TYPE_WORDS = Object.freeze({ LO: 'hotel', MF: 'apartment', RT: 'retail', OF: 'office', MU: 'mixed-use', IN: 'industrial', WH: 'warehouse', SS: 'self-storage', MH: 'mobile home park', HC: 'health care', CH: 'co-op housing' });
const article = (w) => (/^[aeiou]/i.test(w) ? 'An' : 'A');
// How the document is known, as the county event says it: "A notice of election and demand was recorded on November 3, 2026".
function lead(entry) {
  const t = DOC_TYPES[entry.documentType]?.lower ?? 'county document';
  const A = article(t);
  if (entry.dateKind === 'notice') return `${A} ${t} dated ${longDate(entry.date)} was posted`;
  if (entry.dateKind === 'sale') return `${A} ${t} for a sale on ${longDate(entry.date)} was posted`;
  return `${A} ${t} was ${entry.dateKind ?? 'recorded'} on ${longDate(entry.date)}`;
}
// The line for a principal, a fixed template in the style of the county event (src/loans.mjs eventLabel). Example (invented): "A notice
// of election and demand was recorded on November 3, 2026 in Example County, CO on a $9.7M hotel loan held by a CMBS trust (Example
// 2019-X1 Mortgage Trust, loan 37); it has been with special servicer Sample Special Servicing LLC since March 4, 2026."
export function cmbsLinkLabel(entry) {
  const where = entry.countyLabel;
  if (entry.status !== 'linked') {
    const named = entry.named?.trust ? ` (${entry.named.trust})` : entry.named?.series ? ` (series ${entry.named.series})` : '';
    return `${lead(entry)} in ${where} on a loan held by a CMBS trust${named}; its loan was not found in the trust's SEC loan file: ${NOT_FOUND[entry.reason] ?? entry.reason}. Look it up by hand.`;
  }
  const b = entry.cmbs;
  const kind = TYPE_WORDS[b.property?.type?.code] ?? '';
  const loanWords = `${b.originalBalance !== null ? `${moneyShort(b.originalBalance)} ` : ''}${kind ? `${kind} ` : ''}loan`;
  const ss = b.specialServicer;
  const period = b.reportingPeriod ? ` for ${longDate(b.reportingPeriod)}` : '';
  const status = b.paidOff ? `the trust reports it ${b.liquidation ? `left the trust (${b.liquidation.label.toLowerCase()})` : 'paid off'}`
    : b.inSpecialServicing ? (ss ? `it has been with special servicer ${ss} since ${longDate(b.specialServicingSince)}` : `it has been in special servicing since ${longDate(b.specialServicingSince)}; the trust's report did not name a special servicer we could read`)
      : `it is not in special servicing in the trust's report${period}; ${ss ? `the trust's special servicer is ${ss}` : 'the trust\'s special servicer could not be read'}`;
  return `${lead(entry)} in ${where} on ${article(loanWords).toLowerCase()} ${loanWords} held by a CMBS trust (${b.trust}, loan ${b.assetNumber}); ${status}.`;
}

// ---- The rebuild --------------------------------------------------------------------------------------------------------------
const stable = (v) => (Array.isArray(v) ? `[${v.map(stable).join(',')}]` : v && typeof v === 'object'
  ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}` : JSON.stringify(v ?? null));
const sansStamp = ({ builtAt, ...rest }) => stable(rest);

// One document's entry: what the county document says (type, county, date, link, the stated original amount; no party but the trust's
// name as the document gives it), the outcome, and the block when linked.
function entryFor(doc, named, role, m, prev, at, scope) {
  const { date, kind } = documentDate(doc);
  const stage = DOC_TYPES[doc.documentType]?.stage ?? null;
  const e = {
    id: `cmbs:${doc.id}`, documentId: doc.id, sourceId: doc.sourceId, documentType: doc.documentType, typeLabel: DOC_TYPES[doc.documentType]?.label ?? doc.documentType,
    stage, stageLabel: STAGES[stage] ?? null, county: doc.county, countyLabel: countyLabel(doc), state: doc.state, date, dateKind: kind, link: publicLink(doc),
    // The scope the county index's rule read (src/loans.mjs loanScope), as its events carry it: the triage and the servicer page check
    // it again (scopeShown). No name.
    scope: { commercial: scope?.commercial ?? null, borrowers: scope?.borrowers ?? null },
    originalPrincipal: statedAmount(doc.amounts?.originalPrincipal),
    named: { role, trust: named.trust, series: named.series },
    status: m.status, reason: m.status === 'linked' ? null : m.reason, reasonText: m.status === 'linked' ? null : NOT_FOUND[m.reason] ?? null,
    ...(m.candidates ? { candidates: m.candidates } : {}),
    ...(m.trust && m.status !== 'linked' ? { trust: { name: m.trust.name, cik: String(m.trust.cik) } } : {}),
    ...(m.status === 'linked' ? { matchedOn: m.matchedOn, disagreed: m.disagreed, trustBy: m.trustBy, cmbs: cmbsBlock(m.loan, m.trust, m.property) } : {}),
    contextOnly: true, scored: false,
  };
  e.label = cmbsLinkLabel(e);
  // When the link was first made (or the loan first looked for), kept while it stays the same, so the triage lists it once.
  const same = prev && prev.status === e.status && (e.status !== 'linked' || prev.cmbs?.loanKey === e.cmbs.loanKey);
  e.firstSeenAt = same ? prev.firstSeenAt ?? at : at;
  return e;
}

// Reads every stored county document (loans/docs/) and the stored EDGAR pull (sources/edgar/trusts.json and loans.json), and writes
// loans/cmbs.json: one entry per document in scope whose current holder names a CMBS trust, linked or not found. A document the county
// index's scope rule puts out of scope (a residential loan type, or only people as borrowers: src/loans.mjs loanScope) is never linked.
// Rewritten only when an entry changed. Run after the county index is rebuilt (loans.watch) and after the EDGAR pull (sources.edgar),
// each in its own unit of work (LOADS.cmbs). Returns counts only.
export function buildCmbsLinks({ dir, now = new Date() } = {}) {
  const at = now.toISOString();
  const E = edgarPaths(dir);
  const trusts = readJson(E.trusts, null);
  const loans = readJson(E.loans, {}) ?? {};
  const edgarState = readJson(E.state, null);
  const path = cmbsLinksPath(dir);
  const old = readJson(path, null);
  const prevLinks = old?.links ?? {};
  const links = {};
  const counts = { documents: 0, outOfScope: 0, named: 0, linked: 0, notFound: 0, unconfirmed: 0, byReason: {} };
  const docs = allDocuments(dir).sort((a, b) => (a.id < b.id ? -1 : 1));
  const scopes = scopeAll(docs);
  for (const doc of docs) {
    counts.documents++;
    const scope = scopes.get(doc.id);
    if (!scope?.inScope) { counts.outOfScope++; continue; }
    const seen = new Set();
    let chosen = null;
    for (const party of currentHolders(doc)) {
      const named = cmbsTrustOf(party.name);
      if (!named) continue;
      const k = `${named.series}|${named.shelfTokens.join(' ')}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const m = matchCmbsAsset(doc, named, { trusts, loans });
      if (m.status === 'unconfirmed') continue;
      if (!chosen || (m.status === 'linked' && chosen.m.status !== 'linked')) chosen = { named, role: party.role, m };
      if (m.status === 'linked') break;
    }
    if (!chosen) { if (seen.size) counts.unconfirmed++; continue; }
    counts.named++;
    const e = entryFor(doc, chosen.named, chosen.role, chosen.m, prevLinks[doc.id] ?? null, at, scope);
    links[doc.id] = e;
    if (e.status === 'linked') counts.linked++;
    else { counts.notFound++; counts.byReason[e.reason] = (counts.byReason[e.reason] ?? 0) + 1; }
  }
  const rec = { builtAt: at, contextOnly: true, note: LINK_NOTE, edgar: edgarState ? { lastRun: edgarState.lastRun ?? null, ranAt: edgarState.ranAt ?? null } : null, counts, links };
  const written = !old || sansStamp(old) !== sansStamp(rec);
  if (written) writeJson(path, rec);
  return { ...counts, written };
}

export const readCmbsLinks = (dir) => readJson(cmbsLinksPath(dir), null);
// The linked documents in scope (scopeShown) on one special servicer's loans, newest first. A loan whose servicer could not be read is under "Unknown", as
// the EDGAR adapter groups it (src/sources/edgar.mjs).
export function cmbsLinksForServicer(file, name) {
  const want = String(name ?? '');
  return Object.values(file?.links ?? {}).filter((e) => e?.status === 'linked' && scopeShown(e) && (e.cmbs?.specialServicer || 'Unknown') === want)
    .sort((a, b) => (a.date !== b.date ? (String(a.date) < String(b.date) ? 1 : -1) : a.id < b.id ? -1 : 1));
}
