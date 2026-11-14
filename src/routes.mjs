// Routes to the decision-maker (PRD E17). For one account: who decides on loan sales, and the best way in. Code only, no model, and the
// same inputs always give the same routes, ids and order. Five route types:
//   direct   the named or candidate person (E7-S1). Always listed, with its status from the existing prerequisites.
//   counsel  the lender's own law firm: the briefer's bank.counsel findings, and county foreclosure filings that name the lender's counsel
//            (the event shape and a feeder seam are here; no adapter yet).
//   advisor  a loan-sale advisor or broker the lender has used: bank.advisors findings, and the sale ledger's named parties where the
//            bank sold. The FDIC's loan-sale advisor is the FDIC-as-receiver's, a route into the FDIC's sale of a failed bank's loans,
//            never into a bank, and every line that shows it says so.
//   board    a director or officer who connects to someone in the firm's network: bank.board and bank.people findings.
//   forum    a shared association or forum: bank.memberships findings, against a principal's memberships.
//
// The lender side is matched against the firm's network (src/network.mjs) by normalized names and organizations, equality only. No match
// means no route: nothing is guessed. A lender-side name is used only when it is in a quote that was checked against retrieved text. Each
// route has its type, target, bridge (who in the network connects), evidence (finding ids with URLs, ledger event ids, county record ids,
// network entry ids), a tier (reported, observed or inferred: docs/paper-estimate.md, section 3) and one fixed-template line of reasoning.
// The order comes from routes.json, all placeholders.
//
// A route relaxes no guard rule. Nothing here drafts or sends anything, to a network contact, an intermediary or anyone else. A chosen
// route gives a principal a checklist only (who to ask, what evidence to cite), like the follow-up checklist in src/calls.mjs. Routes
// and the network are prospect data and private data: they live in the data folder (routes/, network/) and never reach a model.
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { readJson, writeJson, readText, writeText, listFiles, audit, safeId } from './store.mjs';
import { LOADS } from './uow.mjs';
import { loadContext, checkTouch, touchFromAccount, norm } from './guard.mjs';
import { eventsOf, actingSeller, resolveParty, isMers } from './sales.mjs';
import { readNetwork, networkPath, entryOf, personKey, firmKey, normName } from './network.mjs';

export const ROUTE_TYPES = Object.freeze(['direct', 'counsel', 'advisor', 'board', 'forum']);
export const TIERS = Object.freeze(['reported', 'observed', 'inferred']);   // strongest first
const TOPICS = ['officer', 'board', 'counsel', 'advisor', 'membership'];
const TYPE_LABEL = { direct: 'Direct', counsel: 'Counsel', advisor: 'Advisor', board: 'Board', forum: 'Forum' };
export const INTERNAL_NOTE = 'Internal: for the firm\'s principals only. Nothing here is sent, and nothing is drafted or sent to a network contact or an intermediary. A route relaxes no guard rule.';
const NOTHING_SENT = 'Nothing here is drafted or sent. The system never writes to a network contact or an intermediary, and a route relaxes no guard rule: the guard still checks every touch to the bank.';

const DAY = 86400000;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const ymd = (d) => new Date(d).toISOString().slice(0, 10);
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const uniq = (a) => [...new Set(a)];
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const listWords = (xs) => (xs.length <= 1 ? xs.join('') : xs.length === 2 ? `${xs[0]} and ${xs[1]}` : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
const needBy = (by) => { const b = String(by ?? '').trim(); if (!b || b === 'true') throw new Error('A name for who made the choice is required (--by).'); return b; };
const weakest = (...ts) => ts.filter(Boolean).reduce((w, t) => (TIERS.indexOf(t) > TIERS.indexOf(w) ? t : w), 'reported');
const strongest = (ts) => ts.filter(Boolean).reduce((s, t) => (TIERS.indexOf(t) < TIERS.indexOf(s) ? t : s), 'inferred');
// A page's date as YYYY-MM-DD for its age: a year alone counts from January 1, a month from its first day, so a date is never made newer.
const pageDate = (p) => { const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(String(p ?? '').trim()); return m ? `${m[1]}-${m[2] ?? '01'}-${m[3] ?? '01'}` : null; };
const ageDays = (date, now) => Math.floor((now.getTime() - Date.parse(`${date}T00:00:00Z`)) / DAY);

export const routesPaths = (dir, id) => ({ json: join(dir, 'routes', `${safeId(id)}.json`), md: join(dir, 'routes', `${safeId(id)}.md`) });
// What a routes action loads in a unit of work: LOADS.routes, narrowed to one account. A county counsel feeder, once one exists, adds its
// own stored file here.
export function routesLoads(id) {
  safeId(id);
  const narrow = { 'accounts/': [`accounts/${id}.json`], 'research/': [`research/${id}.json`], 'routes/': [`routes/${id}.json`, `routes/${id}.md`] };
  return LOADS.routes.flatMap((p) => narrow[p] ?? [p]);
}

// ---- The rules file (routes.json) -----------------------------------------------------------------------------------------------
export function validateRoutesRules(r) {
  if (!isObj(r)) return ['routes.json is not an object'];
  const e = [];
  for (const [q, t] of Object.entries(r.topics ?? {})) if (q !== '_note' && !TOPICS.includes(t)) e.push(`topics.${q} must be one of ${TOPICS.join(', ')}`);
  if (!isObj(r.topics) || !Object.keys(r.topics).some((k) => k !== '_note')) e.push('topics must map at least one playbook question');
  const order = r.order?.types;
  if (!Array.isArray(order) || order.length !== ROUTE_TYPES.length || [...order].sort().join() !== [...ROUTE_TYPES].sort().join()) e.push(`order.types must list each of ${ROUTE_TYPES.join(', ')} once`);
  for (const s of ['government', 'regulator', 'company', 'press', 'other']) if (!TIERS.includes(r.tiers?.finding?.[s])) e.push(`tiers.finding.${s} must be one of ${TIERS.join(', ')}`);
  for (const k of ['supportNotYes', 'nameOnly', 'colleague']) if (!TIERS.includes(r.tiers?.[k])) e.push(`tiers.${k} must be one of ${TIERS.join(', ')}`);
  for (const k of ['personNameOnly', 'colleagues']) if (typeof r.matching?.[k] !== 'boolean') e.push(`matching.${k} must be true or false`);
  if (typeof r.consent?.required !== 'boolean') e.push('consent.required must be true or false');
  for (const t of ROUTE_TYPES) if (!(Number.isInteger(r.currency?.maxAgeDays?.[t]) && r.currency.maxAgeDays[t] >= 1)) e.push(`currency.maxAgeDays.${t} must be a whole number of 1 or more`);
  return e;
}

// ---- County counsel records: the event shape and the feeder seam (no adapter yet) ------------------------------------------------
// A recorded foreclosure filing (a notice of default or of trustee's sale, a lis pendens, a complaint) names the lender and, often, the
// lender's counsel. That is the lender's own law firm: a counsel route. Each feeder is { source, build({ dir, account }) -> { events,
// missing } }, as sales.mjs feeders are; none is wired in until the E5 spike picks a county feed or a vendor. A filing names a
// particular property and borrower, so it is asset-specific: a route cites its document number and link only, never the property.
export const COUNSEL_FEEDERS = Object.freeze([]);
export const COUNSEL_DOCUMENT_TYPES = Object.freeze(['notice_of_default', 'notice_of_trustee_sale', 'lis_pendens', 'complaint', 'substitution_of_trustee', 'other']);

export function counselEvent({ county, documentNumber, documentType = 'other', recordedOn, lender, lenderCounsel, attorneys = [], trustee = null, apn = null, source, link = null, kindOf }) {
  return {
    id: `county-counsel:${county}:${documentNumber}`, kind: 'lender_counsel', date: recordedOn,
    lender: resolveParty(lender, { kindOf }),   // MERS is a nominee, never the lender (src/sales.mjs)
    counsel: { firm: String(lenderCounsel ?? '').replace(/\s+/g, ' ').trim(), attorneys: (attorneys ?? []).map((a) => String(a).replace(/\s+/g, ' ').trim()).filter(Boolean) },
    document: { county: String(county ?? ''), documentNumber: String(documentNumber ?? ''), documentType, apn, trustee },
    tier: 'observed', sources: [{ source, ids: [String(documentNumber)], link, date: recordedOn }],
    assetSpecific: true, contextOnly: true,
  };
}

export function validateCounselEvent(ev) {
  const e = [];
  if (!isObj(ev)) return ['not an object'];
  if (typeof ev.id !== 'string' || !ev.id.startsWith('county-counsel:')) e.push('id must be county-counsel:<county>:<document number>');
  if (ev.kind !== 'lender_counsel') e.push('kind must be lender_counsel');
  if (!ISO.test(String(ev.date ?? ''))) e.push('date must be YYYY-MM-DD');
  if (!isObj(ev.lender) || typeof ev.lender.name !== 'string') e.push('lender is required ({ kind, key?, name })');
  else if (isMers(ev.lender.name)) e.push('lender: MERS is a nominee, not the lender (resolveParty)');
  if (!String(ev.counsel?.firm ?? '').trim()) e.push('counsel.firm is required: the law firm the record names for the lender');
  if (!Array.isArray(ev.counsel?.attorneys)) e.push('counsel.attorneys must be a list (empty when none is named)');
  if (!ev.document?.county || !ev.document?.documentNumber) e.push('document.county and document.documentNumber are required');
  if (!COUNSEL_DOCUMENT_TYPES.includes(ev.document?.documentType)) e.push(`document.documentType must be one of ${COUNSEL_DOCUMENT_TYPES.join(', ')}`);
  if (ev.tier !== 'observed') e.push('tier must be observed: it is built from a recorded document');
  if (!Array.isArray(ev.sources) || !ev.sources.length || ev.sources.some((s) => !s?.source || !Array.isArray(s.ids) || !s.ids.length)) e.push('sources: at least one, each with source and ids');
  if (ev.assetSpecific !== true) e.push('a county filing is asset-specific');
  return e;
}

// ---- The account's own prerequisites, read defensively -------------------------------------------------------------------------
// The guard reads contact.emailStatus today. Email verification (E7-S3) is being built beside this, so a nested status is read too,
// and anything else is "unknown". Verified means a status of exactly "verified" and an address to verify.
export function emailState(account) {
  const c = isObj(account?.contact) ? account.contact : {};
  const p = isObj(account?.person) ? account.person : {};
  const status = [c.emailStatus, isObj(c.email) ? c.email.status : null, isObj(c.emailVerification) ? c.emailVerification.status : null, isObj(c.verification?.email) ? c.verification.email.status : null]
    .find((s) => typeof s === 'string' && s.trim()) ?? 'unknown';
  const present = [p.email, isObj(c.email) ? c.email.address : null].some((x) => typeof x === 'string' && /^[^\s@]+@[^\s@]+$/.test(x.trim()));
  return { present, status, verified: present && status === 'verified' };
}

// The guard's view, as the follow-up checklist shows it (src/calls.mjs): the hard stops and whether the bank is already in conversation.
// Shown, never overridden. An opt-out or a suppression of the institution also stops a choice: an introduction must not go around either.
const HARD = (code) => code === 'KILL_SWITCH' || code.startsWith('SUPPRESSED_') || code === 'EMAIL_BOUNCED';
const BLOCKS_CHOICE = new Set(['OPT_OUT', 'SUPPRESSED_INSTITUTION']);
const CONTACT_CODES = new Set(['EMAIL_MISSING', 'EMAIL_UNVERIFIED', 'PERSONAL_EMAIL', 'ROLE_EMAIL', 'ROLE_UNCONFIRMED', 'NO_PROVENANCE', 'SUPPRESSED_PERSON', 'SUPPRESSED_EMAIL', 'SUPPRESSED_DOMAIN', 'EMAIL_BOUNCED']);
export function guardView({ account, ctx, now }) {
  const sent = ctx.touches.filter((t) => t.accountId === account.id && t.type === 'touch').length;
  const probe = checkTouch(touchFromAccount(account, { channel: 'email', step: sent + 1, date: ymd(now), sender: ctx.senders?.[0]?.id }), ctx);
  const hardStops = probe.errors.filter((e) => HARD(e.code)).map((e) => ({ code: e.code, message: e.message }));
  const inst = norm(account.name);
  const related = ctx.touches.filter((t) => t.accountId === account.id || (inst && norm(t.institution) === inst));
  const optOut = related.filter((t) => t.type === 'opt_out').sort((a, b) => cmp(String(b.date), String(a.date)))[0];
  if (optOut) hardStops.unshift({ code: 'OPT_OUT', message: `An opt-out is recorded at this bank (${optOut.date}). Do not seek a way in.` });
  const conv = related.filter((t) => ['reply', 'meeting', 'handoff'].includes(t.type)).sort((a, b) => cmp(String(b.date), String(a.date)))[0];
  return { hardStops, inConversation: conv ? { type: conv.type, date: conv.date } : null, blocksChoice: hardStops.some((h) => BLOCKS_CHOICE.has(h.code)), contactCodes: probe.errors.filter((e) => CONTACT_CODES.has(e.code)).map((e) => e.code) };
}

// ---- The lender side: who and what the sources name ------------------------------------------------------------------------------
// Each mention is one person, firm or association a source names, with the topic it came from, its evidence and any tier cap.
function lenderSide({ account, research, ledger, county, R }) {
  const mentions = [];
  const leftOut = { uncheckedFindings: 0, findingsWithoutNames: 0, ledgerBuyers: 0 };
  const researchDate = ISO.test(String(research?.date ?? '')) ? research.date : null;
  for (const f of Array.isArray(research?.findings) ? research.findings : []) {
    const topic = R.topics[f.question_id];
    if (!TOPICS.includes(topic)) continue;
    // Only checked evidence: the quote was found in text retrieved from that URL (or the run's pool), or a second source corroborates it.
    if (!(['verified', 'verified_pool'].includes(f.status) || (f.corroborations ?? 0) >= 2)) { leftOut.uncheckedFindings++; continue; }
    const entities = (Array.isArray(f.entities) ? f.entities : []).filter((e) => isObj(e) && typeof e.name === 'string' && e.name.trim());
    if (!entities.length) { leftOut.findingsWithoutNames++; continue; }
    const dated = pageDate(f.published);
    const date = dated ?? researchDate;
    const ev = { kind: 'finding', id: f.id, question: f.question_id, url: f.source_url, publisher: f.publisher ?? '', published: f.published ?? '', date, dateBasis: dated ? 'published' : 'research run',
      sourceTier: f.evidence_tier, tier: R.tiers.finding[f.evidence_tier] ?? 'inferred', status: f.status, support: f.supportVerdict ?? 'not run', assetSpecific: f.asset_specific === true };
    const cap = f.supportVerdict === 'yes' ? null : R.tiers.supportNotYes;
    const people = entities.filter((e) => e.type === 'person');
    for (const e of entities) mentions.push({ type: e.type, name: e.name.trim(), affiliation: String(e.affiliation ?? '').trim(), role: String(e.role ?? '').trim(), topic, ev, cap, people });
  }
  const key = account.institutionKey ?? null;
  for (const e of eventsOf(ledger)) {
    const seller = actingSeller(e);
    const ev = { kind: 'ledger', id: e.id, eventKind: e.kind, link: e.sources?.[0]?.link ?? null, date: e.date, tier: TIERS.includes(e.tier) ? e.tier : 'observed' };
    if (key && seller?.key === key) {
      if (e.listing?.advisor) mentions.push({ type: 'firm', name: String(e.listing.advisor).trim(), affiliation: '', role: 'listing advisor', topic: 'advisor', ev, cap: null, people: [] });
      if (e.buyer && e.buyer.kind !== 'unknown') leftOut.ledgerBuyers++;   // a known buyer of the bank's loans is not a route (D-R6)
    }
    // The FDIC as receiver sells a failed bank's loans through its own advisor: a route into the FDIC's sale, not into a bank.
    if (key && e.kind === 'fdic_sale_announced' && e.sale?.advisor && (e.seller?.receiverships ?? []).some((r) => r?.key === key)) {
      mentions.push({ type: 'firm', name: String(e.sale.advisor).trim(), affiliation: '', role: 'the FDIC\'s loan-sale advisor', topic: 'advisor', ev, cap: null, people: [], fdicReceiver: true });
    }
  }
  const bankKeys = new Set([account.name, ...(account.aliases ?? [])].map(firmKey).filter(Boolean));
  for (const c of county) {
    if (!((key && c.lender?.key === key) || bankKeys.has(firmKey(c.lender?.name)))) continue;
    const ev = { kind: 'county', id: c.id, documentType: c.document.documentType, link: c.sources?.[0]?.link ?? null, date: c.date, tier: 'observed', assetSpecific: true };
    mentions.push({ type: 'firm', name: c.counsel.firm, affiliation: '', role: 'counsel for the lender', topic: 'counsel', ev, cap: null, people: [] });
    for (const a of c.counsel.attorneys) mentions.push({ type: 'person', name: a, affiliation: c.counsel.firm, role: 'attorney for the lender', topic: 'counsel', ev, cap: null, people: [] });
  }
  return { mentions, leftOut };
}

// ---- Matching -----------------------------------------------------------------------------------------------------------------
const bridgeOf = (kind, x) => (kind === 'person'
  ? { kind, id: x.id, name: x.name, organization: x.organization ?? '', title: x.title ?? '', relationship: x.relationship ?? '', knownBy: x.knownBy ?? [], introConsent: x.introConsent ?? 'unknown' }
  : kind === 'firm' ? { kind, id: x.id, name: x.name, firmKind: x.kind ?? 'other', relationship: x.relationship ?? '', knownBy: x.knownBy ?? [] }
    : { kind, id: x.id, association: x.association, principal: x.principal, role: x.role ?? 'member' });
const index = (entries, keysOf) => {
  const m = new Map();
  for (const x of Object.values(entries ?? {}).sort((a, b) => cmp(a.id, b.id))) for (const k of uniq(keysOf(x).filter(Boolean))) m.set(k, [...(m.get(k) ?? []), x]);
  return m;
};
const targetKey = (t) => (t.kind === 'person' ? `p:${personKey(t.name)}` : t.kind === 'institution' ? `i:${t.id}` : `f:${firmKey(t.name)}`);
export const routeId = (type, tKey, bridgeId) => `r-${createHash('sha256').update(`${type}|${tKey}|${bridgeId ?? ''}`).digest('hex').slice(0, 10)}`;
const BOARD_TOPICS = new Set(['officer', 'board', 'membership']);

function matchRoutes({ account, mentions, net, R }) {
  const people = index(net.people, (p) => [p.name, ...(p.aliases ?? [])].map(personKey));
  const peopleAt = index(net.people, (p) => [firmKey(p.organization)]);
  const firms = index(net.firms, (f) => [f.name, ...(f.aliases ?? [])].map(firmKey));
  const memberships = index(net.memberships, (m) => [m.association, ...(m.aliases ?? [])].map(firmKey));
  const bankKeys = new Set([account.name, ...(account.aliases ?? [])].map(firmKey).filter(Boolean));
  const found = new Map();
  const declined = new Set(), nameOnly = new Set();
  const add = ({ type, target, bridge, m, match, cap = null, extra = {} }) => {
    const id = routeId(type, targetKey(target), bridge.id);
    const tier = weakest(m.ev.tier, m.cap, cap);
    const r = found.get(id) ?? { id, type, target, bridge, match, tier, contributions: [], ...extra };
    if (TIERS.indexOf(tier) < TIERS.indexOf(r.tier)) Object.assign(r, { tier, match, target });   // the strongest evidence names it
    r.contributions.push({ ev: m.ev, network: bridge.id, mention: { name: m.name, affiliation: m.affiliation } });
    if (m.fdicReceiver) r.fdicReceiver = true;
    found.set(id, r);
  };
  const consentOk = (p) => { if (p.introConsent === 'no') { declined.add(p.id); return false; } return true; };
  for (const m of mentions) {
    const asType = m.topic === 'counsel' ? 'counsel' : m.topic === 'advisor' ? 'advisor' : 'board';
    if (m.type === 'person') {
      const person = { kind: 'person', name: m.name, affiliation: m.affiliation, role: m.role };
      const firm = m.affiliation ? { kind: 'firm', name: m.affiliation } : null;
      // The network knows this person by name.
      for (const p of people.get(personKey(m.name)) ?? []) {
        if (!consentOk(p, m)) continue;
        const org = firmKey(p.organization);
        const corroborated = !!org && ((m.affiliation && org === firmKey(m.affiliation)) || bankKeys.has(org));
        if (!corroborated && !R.matching.personNameOnly) { nameOnly.add(`${p.id}|${m.ev.id}`); continue; }
        const target = asType === 'board' ? person : (firm ?? person);
        add({ type: asType, target, bridge: bridgeOf('person', p), m, match: corroborated ? 'name-and-organization' : 'name-only', cap: corroborated ? null : R.tiers.nameOnly, extra: { personBridgeIsTarget: asType === 'board' } });
      }
      // Through the person's firm: a network person who works there, or the firm itself in the network.
      if (m.affiliation && !bankKeys.has(firmKey(m.affiliation))) {
        const fk = firmKey(m.affiliation);
        for (const p of peopleAt.get(fk) ?? []) {
          if (personKey(p.name) === personKey(m.name)) continue;   // the same person: matched above
          if (asType === 'board' && !R.matching.colleagues) continue;
          if (!consentOk(p, m)) continue;
          if (asType === 'board') add({ type: 'board', target: person, bridge: bridgeOf('person', p), m, match: 'colleague', cap: R.tiers.colleague });
          else add({ type: asType, target: firm, bridge: bridgeOf('person', p), m, match: 'works-at-the-firm' });
        }
        for (const f of firms.get(fk) ?? []) {
          if (asType === 'board' && !R.matching.colleagues) continue;
          if (asType === 'board') add({ type: 'board', target: person, bridge: bridgeOf('firm', f), m, match: 'their-firm', cap: R.tiers.colleague });
          else add({ type: asType, target: firm, bridge: bridgeOf('firm', f), m, match: 'firm-name' });
        }
      }
    } else if (m.type === 'firm' && (m.topic === 'counsel' || m.topic === 'advisor')) {
      const firm = { kind: 'firm', name: m.name, role: m.role };
      for (const f of firms.get(firmKey(m.name)) ?? []) add({ type: asType, target: firm, bridge: bridgeOf('firm', f), m, match: 'firm-name' });
      for (const p of peopleAt.get(firmKey(m.name)) ?? []) { if (consentOk(p, m)) add({ type: asType, target: firm, bridge: bridgeOf('person', p), m, match: 'works-at-the-firm' }); }
    } else if (m.type === 'association' && m.topic === 'membership') {
      const targets = m.people.length ? m.people.map((p) => ({ kind: 'person', name: p.name.trim(), affiliation: String(p.affiliation ?? '').trim(), role: String(p.role ?? '').trim() })) : [{ kind: 'institution', id: account.id, name: account.name }];
      for (const ms of memberships.get(firmKey(m.name)) ?? []) for (const t of targets) add({ type: 'forum', target: t, bridge: bridgeOf('membership', ms), m, match: 'association', extra: { association: m.name } });
    }
  }
  return { found: [...found.values()], declined: declined.size, nameOnly: nameOnly.size };
}

// ---- One line of reasoning per route, from fixed templates ----------------------------------------------------------------------
const evWords = (e) => (e.kind === 'finding' ? `finding ${e.id}: ${e.question}, ${e.sourceTier} source, ${e.published || 'undated'}`
  : e.kind === 'ledger' ? `ledger event ${e.id}: ${String(e.eventKind).replace(/_/g, ' ')}, ${e.date}`
    : `county record ${e.id}: ${String(e.documentType).replace(/_/g, ' ')}, ${e.date}`);
const bridgeWords = (b) => (b.kind === 'person' ? `${b.name}${b.organization ? ` of ${b.organization}` : ''} (${b.id}), known to ${listWords(b.knownBy)}`
  : b.kind === 'firm' ? `${b.name} (${b.id}), known to ${listWords(b.knownBy)}` : `${b.association} (${b.id}), where ${b.principal} is a ${b.role}`);
const ROLE_AT = { officer: 'is an officer of', board: 'is a director or senior officer of', membership: 'appears for' };
const HOW = { 'works-at-the-firm': 'works there', 'name-and-organization': 'is the person the record names, at the same organization', 'name-only': 'has the same name as the person the record names: same name only: confirm it is the same person' };
function reasoning(r, account, R) {
  const first = r.evidence.findings[0] ?? r.evidence.ledger[0] ?? r.evidence.county[0];
  const ev = evWords(first), B = bridgeWords(r.bridge), T = r.target.name, bank = account.name;
  if (r.type === 'board') {
    const on = `${T} ${ROLE_AT[R.topics[first.question]] ?? 'is named for'} ${bank} (${ev})`;
    if (r.match === 'name-and-organization') return `${on}, and is in the firm's network as ${B}: same name and organization.`;
    if (r.match === 'name-only') return `${on}; ${B}, has the same name only: confirm it is the same person.`;
    if (r.match === 'colleague') return `${on} and is with ${r.target.affiliation}; ${B}, works at the same firm.`;
    return `${on} and is with ${r.target.affiliation}, a firm in the network: ${B}.`;
  }
  const via = r.bridge.kind === 'firm' ? `The firm is in the network: ${B}.` : `In the network: ${B}, who ${HOW[r.match] ?? 'connects'}.`;
  if (r.type === 'counsel') return `${T} represents ${bank} as lender (${ev}). ${via}`;
  if (r.type === 'advisor') {
    if (r.fdicReceiver) return `${T} is the FDIC's loan-sale advisor for the sale of ${bank}'s loans as receiver (${ev}): a route into the FDIC's sale, not into the bank. ${via}`;
    return `${T} has acted for ${bank} on a loan sale (${ev}). ${via}`;
  }
  if (r.type === 'forum') {
    const m = `${r.bridge.principal} is a ${r.bridge.role} there (${r.bridge.association}, ${r.bridge.id}).`;
    return r.target.kind === 'institution' ? `${bank} is listed with ${r.association} (${ev}). ${m}` : `${T} appears for ${bank} with ${r.association} (${ev}). ${m}`;
  }
  return '';
}

const MISSING_WORDS = { PERSON_NOT_NAMED: 'a named person', ROLE_UNCONFIRMED: 'a confirmed role', EMAIL_UNVERIFIED: 'a verified address' };
function directRoute({ account, research, R, guard, now }) {
  const named = String(account.person?.name ?? '').trim();
  const pk = personKey(named);
  const researchDate = ISO.test(String(research?.date ?? '')) ? research.date : null;
  const checked = (Array.isArray(research?.findings) ? research.findings : []).filter((f) => ['verified', 'verified_pool'].includes(f.status) || (f.corroborations ?? 0) >= 2);
  const persons = (f) => (Array.isArray(f.entities) ? f.entities : []).filter((e) => e?.type === 'person' && typeof e.name === 'string');
  const evOf = (f) => { const d = pageDate(f.published); return { kind: 'finding', id: f.id, question: f.question_id, url: f.source_url, publisher: f.publisher ?? '', published: f.published ?? '', date: d ?? researchDate, dateBasis: d ? 'published' : 'research run', sourceTier: f.evidence_tier, tier: weakest(R.tiers.finding[f.evidence_tier] ?? 'inferred', f.supportVerdict === 'yes' ? null : R.tiers.supportNotYes), status: f.status, support: f.supportVerdict ?? 'not run', assetSpecific: f.asset_specific === true }; };
  let target, findings;
  if (named) {
    findings = checked.filter((f) => R.topics[f.question_id] && persons(f).some((e) => personKey(e.name) === pk));
    target = { kind: 'person', name: named, title: account.person?.title ?? '' };
  } else {
    findings = checked.filter((f) => R.topics[f.question_id] === 'officer' && persons(f).length);
    target = { kind: 'candidates', names: uniq(findings.flatMap((f) => persons(f).map((e) => e.name.trim()))) };
  }
  const email = emailState(account);
  const missing = [...(named ? [] : ['PERSON_NOT_NAMED']), ...(account.contact?.roleConfirmed && named ? [] : ['ROLE_UNCONFIRMED']), ...(email.verified ? [] : ['EMAIL_UNVERIFIED'])];
  const status = { personNamed: !!named, roleConfirmed: !!(named && account.contact?.roleConfirmed), roleConfirmedBy: named && account.contact?.roleConfirmed ? account.contact.roleConfirmedBy ?? null : null, email, missing, ready: !missing.length, guardCodes: guard.contactCodes };
  const evidence = { findings: findings.map(evOf), ledger: [], county: [], network: [] };
  const line = named
    ? (status.ready ? `${named} is named for this account, the role is confirmed${status.roleConfirmedBy ? ` by ${status.roleConfirmedBy}` : ''} and the address is verified: the drafter and the guard take it from here.` : `${named} is named for this account; still needed: ${listWords(missing.map((c) => MISSING_WORDS[c]))}.`)
    : target.names.length ? `No person is named yet; the research names ${target.names.length} candidate${target.names.length === 1 ? '' : 's'} (${listWords(target.names)}). A principal chooses one.` : 'No person is named yet, and no research names a candidate: research the institution first.';
  return finish({ id: 'r-direct', type: 'direct', target, bridge: null, match: null, tier: findings.length ? strongest(evidence.findings.map((e) => e.tier)) : 'inferred', evidence, status, reasoning: line }, R, now);
}

function finish(r, R, now) {
  const dates = [...r.evidence.findings, ...r.evidence.ledger, ...r.evidence.county].map((e) => e.date).filter((d) => ISO.test(String(d))).sort();
  const asOf = dates.at(-1) ?? null;
  const limit = R.currency.maxAgeDays[r.type];
  return { ...r, asOf, current: asOf ? ageDays(asOf, now) <= limit : false, maxAgeDays: limit };
}

// A suppressed person or institution (suppression.json) is never a route's bridge or target: a route relaxes no guard rule.
function suppressedParty(r, suppression) {
  const names = [r.target?.name, r.bridge?.name, r.bridge?.association].filter(Boolean);
  for (const e of suppression) {
    if (!['person', 'institution'].includes(e?.type)) continue;
    const keyOf = e.type === 'person' ? personKey : firmKey;
    const vals = [e.value, ...(e.aliases ?? [])].map(keyOf).filter(Boolean);
    if (names.some((n) => vals.includes(keyOf(n)))) return true;
  }
  return false;
}

// ---- Building ----------------------------------------------------------------------------------------------------------------
const rulesHash = (r) => createHash('sha256').update(JSON.stringify(r)).digest('hex').slice(0, 16);
const loadAccount = (dir, id) => { const a = readJson(join(dir, 'accounts', `${safeId(id)}.json`), null); if (!a) throw new Error(`No account "${id}".`); return a; };

export function buildRoutes({ dir, id, rules, counselFeeders = COUNSEL_FEEDERS, now = new Date(), env = process.env }) {
  const R = rules.routes;
  const errs = validateRoutesRules(R);
  if (errs.length) throw new Error(`routes.json has errors:\n  ${errs.join('\n  ')}`);
  const account = loadAccount(dir, id);
  const research = readJson(join(dir, 'research', `${id}.json`), null);
  const ledgerDoc = readJson(join(dir, 'sales', 'ledger.json'), null);
  const net = readNetwork(dir);
  const ctx = loadContext({ dir, config: rules.config, env });
  // County counsel records, through the seam. A feeder input missing a field, or an event that fails its check, fails the build.
  const county = [], invalid = [], missing = [];
  for (const f of counselFeeders) {
    const r = f.build({ dir, account });
    missing.push(...(r.missing ?? []).map((m) => `${f.source} ${m}`));
    for (const ev of r.events ?? []) { const e = validateCounselEvent(ev); if (e.length) invalid.push(`${ev?.id ?? '(no id)'}: ${e.join('; ')}`); else county.push(ev); }
  }
  if (missing.length || invalid.length) throw new Error(`The county counsel records fail their checks (${missing.length} missing a field, ${invalid.length} invalid${invalid.length ? `: ${invalid.slice(0, 3).join(' | ')}` : ''}). Nothing was written.`);

  const guard = guardView({ account, ctx, now });
  const { mentions, leftOut } = lenderSide({ account, research, ledger: ledgerDoc ?? { events: {} }, county, R });
  const matched = matchRoutes({ account, mentions, net, R });
  const all = matched.found.map((r) => {
    const evidence = { findings: [], ledger: [], county: [], network: [] };
    const seen = new Set();
    for (const c of r.contributions) {
      const k = `${c.ev.kind}:${c.ev.id}`;
      if (!seen.has(k)) { seen.add(k); evidence[c.ev.kind === 'finding' ? 'findings' : c.ev.kind].push(c.ev); }
      if (!evidence.network.includes(c.network)) evidence.network.push(c.network);
    }
    const { contributions, personBridgeIsTarget, ...rest } = r;
    const out = { ...rest, evidence, ...(evidence.findings.concat(evidence.county).some((e) => e.assetSpecific) ? { assetSpecific: true } : {}) };
    return finish({ ...out, reasoning: reasoning(out, account, R) }, R, now);
  });
  const held = [], ranked = [];
  for (const r of all) {
    if (suppressedParty(r, ctx.suppression)) held.push({ ...r, heldBecause: 'SUPPRESSED_PARTY', heldWhy: 'Its bridge or its target is on the suppression list.' });
    else if (R.consent.required && r.bridge?.kind === 'person' && r.bridge.introConsent !== 'yes') held.push({ ...r, heldBecause: 'CONSENT_NEEDED', heldWhy: 'They have not agreed to be asked for introductions, and routes.json requires it (D-R2).' });
    else ranked.push(r);
  }
  ranked.push(directRoute({ account, research, R, guard, now }));
  const order = (a, b) => (R.order.types.indexOf(a.type) - R.order.types.indexOf(b.type)) || (TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier)) || ((a.current ? 0 : 1) - (b.current ? 0 : 1))
    || (count(b) - count(a)) || cmp(a.id, b.id);
  ranked.sort(order);
  held.sort(order);
  ranked.forEach((r, i) => { r.rank = i + 1; });

  const p = routesPaths(dir, id);
  const prev = readJson(p.json, null);
  const record = {
    version: 1, account: account.id, name: account.name, institutionKey: account.institutionKey ?? null, builtAt: now.toISOString(), internal: INTERNAL_NOTE, rulesHash: rulesHash(R),
    inputs: {
      research: research ? { date: research.date ?? null, mode: research.mode ?? null, findings: Array.isArray(research.findings) ? research.findings.length : 0 } : null,
      ledger: ledgerDoc ? { builtAt: ledgerDoc.builtAt ?? null, events: Object.keys(ledgerDoc.events ?? {}).length } : null,
      network: { people: Object.keys(net.people).length, firms: Object.keys(net.firms).length, memberships: Object.keys(net.memberships).length },
      county: { feeders: counselFeeders.length, events: county.length },
    },
    guard, routes: ranked, held,
    leftOut: { declined: matched.declined, nameOnly: matched.nameOnly, ...leftOut },
    chosen: null, choices: prev?.choices ?? [],
    ...(prev?.choiceRemoved ? { choiceRemoved: prev.choiceRemoved } : {}),
  };
  // A choice survives a rebuild while its route exists; once its evidence is gone it is marked, not silently dropped.
  if (prev?.chosen) {
    const still = ranked.find((r) => r.id === prev.chosen.routeId);
    record.chosen = still ? { ...prev.chosen, supported: true, checklist: buildChecklist({ record, route: still, guard }) }
      : { routeId: prev.chosen.routeId, type: prev.chosen.type, by: prev.chosen.by, at: prev.chosen.at, supported: false, checklist: null };
  }
  write(dir, record);
  audit(dir, { type: 'routes_built', accountId: account.id, routes: ranked.length, held: held.length });
  return record;
}
const count = (r) => r.evidence.findings.length + r.evidence.ledger.length + r.evidence.county.length;
const write = (dir, record) => { const p = routesPaths(dir, record.account); writeJson(p.json, record); writeText(p.md, renderRoutes(record)); };

// { record, markdown } or null.
export function readRoutes({ dir, id }) {
  const p = routesPaths(dir, id);
  const record = readJson(p.json, null);
  if (!record) return null;
  return { record, markdown: readText(p.md, null) ?? renderRoutes(record) };
}
// Counts only, for a job result or a log line: no name, no route target.
export const routesSummary = (r) => ({ account: r.account, routes: r.routes.length, held: r.held.length, byType: Object.fromEntries(ROUTE_TYPES.map((t) => [t, r.routes.filter((x) => x.type === t).length])), chosen: r.chosen?.routeId ?? null });

// ---- Choosing a route, and its checklist -------------------------------------------------------------------------------------
const evCite = (e) => (e.kind === 'finding' ? `${e.id}: ${e.publisher || 'source'}${e.published ? `, ${e.published}` : ''} (${e.sourceTier} source): ${e.url}`
  : e.kind === 'ledger' ? `${e.id}: ${String(e.eventKind).replace(/_/g, ' ')}, ${e.date}${e.link ? `: ${e.link}` : ''}` : `${e.id}: ${String(e.documentType).replace(/_/g, ' ')}, recorded ${e.date}${e.link ? `: ${e.link}` : ''}`);
const DECIDER = (bank) => `the person at ${bank} who decides on loan sales`;
const personAt = (t, bank) => `${t.name}${t.affiliation && firmKey(t.affiliation) !== firmKey(bank) ? ` (${t.affiliation})` : ''} at ${bank}`;
// Whom the bridge is asked to introduce you to. On a board route matched by name, the bridge is the target: they are asked who decides.
const askFor = (r, bank) => (r.type === 'board' ? personAt(r.target, bank) : r.type === 'forum' && r.target.kind === 'person' ? personAt(r.target, bank) : DECIDER(bank));
const SELF = new Set(['name-and-organization', 'name-only']);

export function buildChecklist({ record, route: r, guard }) {
  const bank = record.name;
  const stops = guard.hardStops.map((h) => `${h.code}: ${h.message}`);
  const ask = [], cite = [], never = [], after = [];
  if (r.type === 'direct') {
    const s = r.status;
    if (!s.personNamed) ask.push(`Name the person, from the candidates in the brief: outbound account set-person --account ${record.account} --name NAME --by NAME.`);
    if (!s.roleConfirmed) ask.push(`Confirm the role after reading the sources: outbound account confirm-role --account ${record.account} --by NAME.`);
    if (!s.email.verified) ask.push(`Verify the address (E7-S3): the guard refuses any email to an address that is not verified (status: ${s.email.status}).`);
    after.push(`Then draft and approve as for any account: outbound draft run --account ${record.account} --channel letter; the guard checks every touch.`);
  } else {
    const b = r.bridge;
    if (b.kind === 'person') {
      const who = `${b.name}${b.organization ? ` of ${b.organization}` : ''}${b.relationship ? ` (${b.relationship})` : ''}, known to ${listWords(b.knownBy)}`;
      ask.push(r.type === 'board' && SELF.has(r.match) ? `Ask ${who}, who at ${bank} decides on loan sales, and whether they would introduce you.` : `Ask ${who}, whether they would introduce you to ${askFor(r, bank)}.`);
      ask.push(b.introConsent === 'yes' ? `${b.name} has agreed to be asked for introductions.` : `${b.name} has not said whether they agree to be asked for introductions: ask whether they are willing first.`);
    } else if (b.kind === 'firm') {
      ask.push(`Ask your contact at ${b.name}${b.relationship ? ` (${b.relationship})` : ''}, known to ${listWords(b.knownBy)}, whether they would introduce you to ${askFor(r, bank)}.`);
    } else {
      ask.push(`At ${b.association}, where ${b.principal} is a ${b.role}, look for ${r.target.kind === 'person' ? personAt(r.target, bank) : `the people at ${bank} who decide on loan sales`} at a public event, a chapter meeting or on a speaker list. Never use a members-only directory to reach anyone.`);
    }
    if (r.type !== 'board' && r.type !== 'forum') ask.push(`Why them: ${r.target.name} ${r.type === 'counsel' ? 'represents the bank as lender' : r.fdicReceiver ? 'is the FDIC\'s loan-sale advisor for the bank\'s loans' : 'has acted for the bank on a loan sale'}; the evidence is below.`);
    if (r.match === 'name-only') ask.push('The match is on the name only: confirm it is the same person before you ask.');
    if (r.fdicReceiver) ask.push(`This advisor works for the FDIC as receiver: it leads into the FDIC's sale of ${bank}'s loans, not to anyone at a bank.`);
    never.push('Ask for an introduction only. Do not ask them to forward a message or to pitch for us.');
    never.push('Never name a property, loan or borrower, or what we see in the bank\'s numbers.');
    after.push(`If they introduce you: name the person (outbound account set-person --account ${record.account} --name NAME --by NAME), confirm the role after reading the sources (outbound account confirm-role), and verify the address. The drafter and the guard then work as for any account.`);
    after.push('A message you write yourself to anyone at the bank is still a touch for the guard: record it (outbound guard record), and record any reply or meeting (outbound guard event), so the caps and the stop rules count it.');
  }
  for (const e of [...r.evidence.findings, ...r.evidence.ledger, ...r.evidence.county]) cite.push(e.assetSpecific ? `${evCite(e)}. For your own context only: never mention its property, loan or borrower.` : evCite(e));
  return { routeId: r.id, type: r.type, stops, inConversation: guard.inConversation, ask, cite, never, after, drafted: false, note: NOTHING_SENT };
}

export function chooseRoute({ dir, id, routeId: rid, by, rules, now = new Date(), env = process.env }) {
  const who = needBy(by);
  const rec = readJson(routesPaths(dir, id).json, null);
  if (!rec) throw new Error(`No routes yet for ${id}. Run: outbound routes build --account ${id}`);
  const route = (rec.routes ?? []).find((r) => r.id === rid);
  if (!route) {
    const h = (rec.held ?? []).find((r) => r.id === rid);
    throw new Error(h ? `Route ${rid} is held: ${h.heldBecause}. ${h.heldWhy}` : `No route ${rid} for ${id}. Run outbound routes show --account ${id} for the list.`);
  }
  const account = loadAccount(dir, id);
  const ctx = loadContext({ dir, config: rules.config, env });
  const guard = guardView({ account, ctx, now });
  if (guard.blocksChoice) throw new Error(`Not chosen: ${guard.hardStops.filter((h) => BLOCKS_CHOICE.has(h.code)).map((h) => h.code).join(', ')}. An introduction must not go around an opt-out or a suppression.`);
  // The stored route is checked again against the network and the suppression list as they are now: a contact may have said no, an
  // entry may be gone, or a party may have been suppressed since the build.
  if (route.bridge) {
    const entry = entryOf(readNetwork(dir), route.bridge.id);
    if (!entry) throw new Error(`Not chosen: its network entry ${route.bridge.id} is no longer in the network: build the routes again.`);
    if (entry.kind === 'person' && entry.entry.introConsent === 'no') throw new Error(`Not chosen: ${route.bridge.id} has since said no to being asked for introductions. Build the routes again.`);
    if (rules.routes.consent.required && entry.kind === 'person' && entry.entry.introConsent !== 'yes') throw new Error(`Not chosen: ${route.bridge.id} has not agreed to be asked for introductions, and routes.json requires it (D-R2).`);
  }
  if (suppressedParty(route, ctx.suppression)) throw new Error('Not chosen: its bridge or its target is on the suppression list. A route relaxes no guard rule.');
  const checklist = buildChecklist({ record: rec, route, guard });
  const at = now.toISOString();
  rec.guard = guard;
  rec.chosen = { routeId: rid, type: route.type, by: who, at, supported: true, checklist };
  rec.choices = [...(rec.choices ?? []), { routeId: rid, type: route.type, by: who, at }];
  delete rec.choiceRemoved;
  write(dir, rec);
  audit(dir, { type: 'route_chosen', accountId: rec.account, routeId: rid, routeType: route.type, by: who });
  return { route, checklist };
}

// ---- Removing a network entry, everywhere routes stored it ---------------------------------------------------------------------
export function removeNetworkEntry({ dir, id, by, now = new Date() }) {
  const who = needBy(by);
  const net = readNetwork(dir);
  const found = entryOf(net, id);
  if (!found) throw new Error(`No network entry ${id}.`);
  const bucket = { person: 'people', firm: 'firms', membership: 'memberships' }[found.kind];
  const { [id]: _gone, ...rest } = net[bucket];
  writeJson(networkPath(dir), { ...net, [bucket]: rest });
  let routeFiles = 0, routesRemoved = 0;
  const uses = (r) => r?.bridge?.id === id || (r?.evidence?.network ?? []).includes(id);
  for (const f of listFiles(join(dir, 'routes'), '.json')) {
    const rec = readJson(join(dir, 'routes', f), null);
    if (!rec || !Array.isArray(rec.routes)) continue;
    const dropped = [...rec.routes, ...(rec.held ?? [])].filter(uses).map((r) => r.id);
    if (!dropped.length) continue;
    routeFiles++; routesRemoved += dropped.length;
    rec.routes = rec.routes.filter((r) => !uses(r)).map((r, i) => ({ ...r, rank: i + 1 }));
    rec.held = (rec.held ?? []).filter((r) => !uses(r));
    rec.choices = (rec.choices ?? []).filter((c) => !dropped.includes(c.routeId));
    if (rec.chosen && dropped.includes(rec.chosen.routeId)) { rec.chosen = null; rec.choiceRemoved = { at: now.toISOString(), reason: 'A network entry it used was removed, so the choice was removed with it.' }; }
    rec.inputs = { ...rec.inputs, network: { ...rec.inputs?.network, [bucket]: Math.max(0, (rec.inputs?.network?.[bucket] ?? 1) - 1) } };
    write(dir, rec);
  }
  audit(dir, { type: 'network_removed', id, entry: found.kind, routeFiles, routesRemoved, by: who });
  return { id, kind: found.kind, routeFiles, routesRemoved };
}

// ---- The written routes (routes/<id>.md) -----------------------------------------------------------------------------------------
// Fixed templates over the record; nothing here adds a fact the record does not hold.
const bridgeShort = (b) => (!b ? '' : b.kind === 'membership' ? ` via ${b.association} (${b.id})` : ` via ${b.name} (${b.id})`);
const targetShort = (t) => (t.kind === 'candidates' ? (t.names.length ? `candidates: ${t.names.join(', ')}` : 'no one named yet') : t.name);
const evLink = (e) => (e.kind === 'finding' ? `[${e.id}](${e.url}) (${e.question}, ${e.sourceTier}, ${e.published || `undated, seen ${e.date ?? 'on an unknown date'}`})`
  : e.link ? `[${e.id}](${e.link}) (${String(e.eventKind ?? e.documentType).replace(/_/g, ' ')}, ${e.date})` : `${e.id} (${String(e.eventKind ?? e.documentType).replace(/_/g, ' ')}, ${e.date})`);
function routeLines(r, prefix) {
  const L = [`${prefix}**${TYPE_LABEL[r.type]}**: ${targetShort(r.target)}${bridgeShort(r.bridge)} · ${r.tier}${r.current || !r.asOf ? '' : ' · NOT CURRENT'} · id \`${r.id}\``];
  L.push(`   - ${r.reasoning}`);
  if (r.status) L.push(`   - Status: person named: ${r.status.personNamed ? 'yes' : 'no'}; role confirmed: ${r.status.roleConfirmed ? `yes${r.status.roleConfirmedBy ? ` (by ${r.status.roleConfirmedBy})` : ''}` : 'no'}; address: ${r.status.email.present ? r.status.email.status : 'none on the account'}${r.status.ready ? '. Ready.' : '.'}`);
  const ev = [...r.evidence.findings, ...r.evidence.ledger, ...r.evidence.county].map(evLink);
  if (ev.length || r.evidence.network.length) L.push(`   - Evidence: ${[...ev, ...(r.evidence.network.length ? [`network ${r.evidence.network.join(', ')}`] : [])].join(' · ')}`);
  if (!r.current) L.push(r.asOf ? `   - Not current: the newest evidence is from ${r.asOf} (limit ${r.maxAgeDays} days, routes.json). Check it is still true.` : '   - No dated evidence: no finding names this target yet.');
  if (r.assetSpecific) L.push('   - Its evidence names a particular property or borrower: for your own context only, never to mention.');
  if (r.heldBecause) L.push(`   - Held: ${r.heldBecause}. ${r.heldWhy}`);
  return L;
}
export function renderChecklist(c, chosen) {
  const L = [`### ${TYPE_LABEL[c.type]}: \`${c.routeId}\`, chosen by ${chosen.by} on ${String(chosen.at).slice(0, 10)}`, '', c.note, ''];
  if (c.stops.length) L.push('**Stop first:**', ...c.stops.map((s) => `- ${s}`), '');
  if (c.inConversation) L.push(`**Already in conversation:** a ${c.inConversation.type} was recorded on ${c.inConversation.date}. A principal is already talking to the bank.`, '');
  L.push(c.type === 'direct' ? '**Still needed**' : '**Who to ask**', '', ...(c.ask.length ? c.ask.map((x) => `- [ ] ${x}`) : ['- Nothing: every prerequisite is met.']), '');
  if (c.cite.length) L.push('**What to cite** (sourced; cite only these)', '', ...c.cite.map((x) => `- ${x}`), '');
  if (c.never.length) L.push('**Never**', '', ...c.never.map((x) => `- ${x}`), '');
  L.push(c.type === 'direct' ? '**Then**' : '**After an introduction**', '', ...c.after.map((x) => `- [ ] ${x}`), '');
  return L;
}
export function renderRoutes(r) {
  const L = [`# Routes to the decision-maker: ${r.name}`, '', r.internal, ''];
  const i = r.inputs ?? {};
  L.push(`- Built ${String(r.builtAt).slice(0, 10)}. Research: ${i.research ? `${i.research.date} (${i.research.findings} findings)` : 'none yet'}. Sale ledger: ${i.ledger ? `built ${String(i.ledger.builtAt ?? '').slice(0, 10)}` : 'none yet'}. Network: ${plural(i.network?.people ?? 0, 'person', 'people')}, ${plural(i.network?.firms ?? 0, 'firm')}, ${plural(i.network?.memberships ?? 0, 'membership')}. County counsel records: ${i.county?.events ?? 0} (no adapter yet).`);
  L.push(`- The order and every limit are placeholders in routes.json (rules ${r.rulesHash}).`);
  if (r.guard?.hardStops?.length) L.push('', '## Stop', '', ...r.guard.hardStops.map((h) => `- **${h.code}:** ${h.message}`), ...(r.guard.blocksChoice ? ['', 'No route can be chosen: an introduction must not go around an opt-out or a suppression.'] : []));
  if (r.guard?.inConversation) L.push('', `**Already in conversation:** a ${r.guard.inConversation.type} was recorded on ${r.guard.inConversation.date}.`);
  L.push('', `## Routes (${r.routes.length})`, '');
  r.routes.forEach((x) => L.push(...routeLines(x, `${x.rank}. `)));
  if (r.held?.length) { L.push('', `## Held: not choosable (${r.held.length})`, ''); r.held.forEach((x) => L.push(...routeLines(x, '- '))); }
  const lo = r.leftOut ?? {};
  L.push('', '## Left out', '', `- Network contacts who said no to introductions: ${lo.declined ?? 0}. Same-name matches dropped (routes.json): ${lo.nameOnly ?? 0}.`,
    `- Findings whose quote could not be checked: ${lo.uncheckedFindings ?? 0}. Findings that name no one: ${lo.findingsWithoutNames ?? 0}. Known buyers of the bank's loans in the ledger (not a route, D-R6): ${lo.ledgerBuyers ?? 0}.`);
  L.push('', '## Chosen route', '');
  if (r.chosen?.supported && r.chosen.checklist) L.push(...renderChecklist(r.chosen.checklist, r.chosen));
  else if (r.chosen) L.push(`The chosen route \`${r.chosen.routeId}\` (${r.chosen.type}, by ${r.chosen.by}) is no longer supported by the evidence. Build again, or choose another.`, '');
  else L.push(`None chosen. Choose one: outbound routes choose --account ${r.account} --route ID --by NAME`, '');
  if (r.choiceRemoved) L.push(`A choice was removed on ${String(r.choiceRemoved.at).slice(0, 10)}: ${r.choiceRemoved.reason}`, '');
  return `${L.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

// Names in a normal form, re-exported for the screens.
export { personKey, firmKey, normName };
