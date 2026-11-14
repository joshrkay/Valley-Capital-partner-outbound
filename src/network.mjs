// The firm's network (PRD E17-S1): the principals' own relationships. People they know (name, organization, title, relationship, which
// principal knows them, whether they agreed to be asked for introductions), firms they work with (law firms, advisors, brokers) and the
// associations they belong to. A principal enters each one; nothing is imported, looked up or scraped.
//
// It is private data. It lives in the data folder (network/network.json) and the platform only, never in this repository. It never
// reaches a model: the briefer and the drafter load neither network/ nor routes/ (src/uow.mjs, test/routes-handoff.test.mjs), and
// matching against it happens in code (src/routes.mjs). It holds names and relationships only, never an email address or a phone
// number, because nothing here contacts anyone. Audit lines carry ids, kinds and counts, never a name. Removing an entry is in
// src/routes.mjs (removeNetworkEntry), because it also removes the entry from every routes file that stored it.
import { join } from 'node:path';
import { readJson, writeJson, listFiles, audit } from './store.mjs';

export const networkPath = (dir) => join(dir, 'network', 'network.json');
export const CONSENT = Object.freeze(['yes', 'no', 'unknown']);
export const FIRM_KINDS = Object.freeze(['law', 'advisor', 'broker', 'other']);
const EMPTY = () => ({ version: 1, seq: 0, people: {}, firms: {}, memberships: {} });

// ---- Names in a normal form, for matching (src/routes.mjs) -----------------------------------------------------------------------
// Lowercase; apostrophes and periods dropped ("O'Brien" -> "obrien", "N.A." -> "na"); "&" read as "and"; anything else not a letter or
// a digit is a space. Equality only, never a fuzzy match: "Example Law" and "Example Law Group" are different firms.
export const normName = (s) => String(s ?? '').toLowerCase().replace(/[‘’'`.]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
const FIRM_SUFFIX = new Set(['llp', 'llc', 'lp', 'lllp', 'pllc', 'plc', 'pc', 'pa', 'inc', 'incorporated', 'corp', 'corporation', 'co', 'company', 'ltd', 'limited', 'na', 'fsb', 'ssb']);
// A firm, an association or a bank: a leading "the" and trailing legal suffixes dropped.
export function firmKey(s) {
  const t = normName(s).split(' ').filter(Boolean);
  if (t.length > 1 && t[0] === 'the') t.shift();
  while (t.length > 1 && (FIRM_SUFFIX.has(t.at(-1)) || t.at(-1) === 'and')) t.pop();
  return t.join(' ');
}
const HONORIFIC = new Set(['mr', 'mrs', 'ms', 'miss', 'mx', 'dr', 'prof', 'hon', 'sir']);
const PERSON_SUFFIX = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'esq', 'cpa', 'phd', 'md', 'jd', 'cfa', 'mba']);
// A person: honorifics and suffixes dropped, then the first and last words only, so a middle name or initial does not matter. One word
// is too little to match a person on, so it gives an empty key, which matches nothing.
export function personKey(s) {
  const t = normName(s).split(' ').filter(Boolean);
  while (t.length && HONORIFIC.has(t[0])) t.shift();
  while (t.length && PERSON_SUFFIX.has(t.at(-1))) t.pop();
  return t.length >= 2 ? `${t[0]} ${t.at(-1)}` : '';
}

// ---- Checks --------------------------------------------------------------------------------------------------------------------
const needBy = (by) => { const b = String(by ?? '').trim(); if (!b || b === 'true') throw new Error('A name for who made the change is required (--by).'); return b; };
const text = (v, max = 200) => (v === undefined || v === null || v === true ? '' : String(v).replace(/\s+/g, ' ').trim().slice(0, max));
const required = (v, what) => { const s = text(v); if (!s) throw new Error(`${what} is required.`); return s; };
const list = (v) => (Array.isArray(v) ? v : v === undefined || v === null || v === true ? [] : String(v).split(/[,;]/)).map((x) => text(x)).filter(Boolean);
// Names and relationships only: nothing here contacts anyone, so nothing here holds an address or a number to reach someone at.
// An email address; a ten-digit number written any usual way ("555 010 0199", "(555) 010-0199", "+1 555.010.0199"); or a seven-digit
// local one ("555-0100"). A range of years ("2015-2019") is neither.
const EMAIL = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;
const PHONE = /(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\b\d{3})[\s.-]?\d{3}[\s.-]?\d{4}\b|\b\d{3}[\s.-]\d{4}\b/;
const CONTACT_LIKE = (s) => EMAIL.test(s) || PHONE.test(s);
function noContactDetails(entry) {
  for (const v of Object.values(entry).flatMap((x) => (Array.isArray(x) ? x : [x]))) {
    if (typeof v === 'string' && CONTACT_LIKE(v)) throw new Error('The network holds names and relationships only: no email address or phone number. Nothing here contacts anyone.');
  }
}

export function readNetwork(dir) {
  const n = readJson(networkPath(dir), null);
  return n && typeof n === 'object' ? { ...EMPTY(), ...n } : EMPTY();
}
export function entryOf(net, id) {
  for (const kind of ['people', 'firms', 'memberships']) if (net[kind]?.[id]) return { kind: { people: 'person', firms: 'firm', memberships: 'membership' }[kind], entry: net[kind][id] };
  return null;
}

function save(dir, net, kind, prefix, entry, by, now) {
  noContactDetails(entry);
  const id = `${prefix}-${net.seq + 1}`;
  const rec = { id, ...entry, addedBy: by, addedAt: now.toISOString() };
  writeJson(networkPath(dir), { ...net, seq: net.seq + 1, [kind]: { ...net[kind], [id]: rec } });
  audit(dir, { type: 'network_added', entry: { people: 'person', firms: 'firm', memberships: 'membership' }[kind], id, by });
  return rec;
}
const dupe = (id) => { throw new Error(`That entry is already in the network as ${id}.`); };

export function addPerson({ dir, name, organization = '', title = '', relationship = '', knownBy, introConsent = 'unknown', aliases = [], by, now = new Date() }) {
  const who = needBy(by);
  const entry = { name: required(name, 'The person\'s name'), organization: text(organization), title: text(title), relationship: text(relationship, 300), knownBy: list(knownBy), introConsent: text(introConsent) || 'unknown', aliases: list(aliases) };
  if (!entry.knownBy.length) throw new Error('Say which principal knows them (--known-by).');
  if (!CONSENT.includes(entry.introConsent)) throw new Error('Whether they agreed to be asked for introductions is yes, no or unknown (--consent).');
  if (!personKey(entry.name)) throw new Error('A person needs a first and a last name, so they can be matched.');
  const net = readNetwork(dir);
  const same = Object.values(net.people).find((p) => personKey(p.name) === personKey(entry.name) && firmKey(p.organization) === firmKey(entry.organization));
  if (same) dupe(same.id);
  return save(dir, net, 'people', 'np', entry, who, now);
}

export function addFirm({ dir, name, kind = 'other', relationship = '', knownBy, aliases = [], by, now = new Date() }) {
  const who = needBy(by);
  const entry = { name: required(name, 'The firm\'s name'), kind: text(kind) || 'other', relationship: text(relationship, 300), knownBy: list(knownBy), aliases: list(aliases) };
  if (!FIRM_KINDS.includes(entry.kind)) throw new Error('A firm\'s kind is law, advisor, broker or other (--kind).');
  if (!entry.knownBy.length) throw new Error('Say which principal knows them (--known-by).');
  const net = readNetwork(dir);
  const same = Object.values(net.firms).find((f) => firmKey(f.name) === firmKey(entry.name));
  if (same) dupe(same.id);
  return save(dir, net, 'firms', 'nf', entry, who, now);
}

export function addMembership({ dir, association, principal, role = 'member', aliases = [], by, now = new Date() }) {
  const who = needBy(by);
  const entry = { association: required(association, 'The association\'s name'), principal: text(principal), role: text(role) || 'member', aliases: list(aliases) };
  if (!entry.principal) throw new Error('Say which principal belongs (--principal).');
  const net = readNetwork(dir);
  const same = Object.values(net.memberships).find((m) => firmKey(m.association) === firmKey(entry.association) && normName(m.principal) === normName(entry.principal));
  if (same) dupe(same.id);
  return save(dir, net, 'memberships', 'nm', entry, who, now);
}

// How many chosen routes use each entry as their bridge, across every account's routes file (PRD E17, D-R8: no cap on asks per
// connector in code; this count is what a principal sees instead).
export function bridgeUses(dir) {
  const uses = {};
  for (const f of listFiles(join(dir, 'routes'), '.json')) {
    const r = readJson(join(dir, 'routes', f), null);
    const chosen = r?.chosen && r.chosen.supported !== false ? (r.routes ?? []).find((x) => x.id === r.chosen.routeId) : null;
    const id = chosen?.bridge?.id;
    if (id) uses[id] = (uses[id] ?? 0) + 1;
  }
  return uses;
}

// The whole network, for a principal. Reading it is audited too (who looked, and counts), since it is the firm's most private list.
export function listNetwork({ dir, by, now = new Date() }) {
  const who = needBy(by);
  const net = readNetwork(dir);
  const sort = (xs, k) => Object.values(xs).sort((a, b) => String(a[k]).localeCompare(String(b[k])) || a.id.localeCompare(b.id));
  const out = { people: sort(net.people, 'name'), firms: sort(net.firms, 'name'), memberships: sort(net.memberships, 'association'), uses: bridgeUses(dir) };
  audit(dir, { type: 'network_viewed', people: out.people.length, firms: out.firms.length, memberships: out.memberships.length, by: who, at: now.toISOString() });
  return out;
}
