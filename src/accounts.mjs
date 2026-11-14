// A principal's decisions about an account's person and how to reach them (PRD E7-S1, E7-S3). One module for the command line and the
// web app, so the rules cannot drift:
// - Naming a new person always resets the role to unconfirmed, and clears the last person's address, phone and verification.
// - A role can only be confirmed for a named person.
// - Every person field (name, title, email, phone, mailing address) records where it came from: a source kind, a URL or brief finding
//   id, the date it was seen, and who set it (contact.provenance, one entry per field).
// - A new address starts unverified. It becomes verified only when every check passes AND a principal records how they know it.
//   The checks look up the domain's MX record in DNS and nothing else: no mail server is ever contacted, no mailbox is ever probed.
// - A forgotten or opted-out person or address (suppression.json, plain or hashed) is never named or set again.
// Every change needs a principal's name and leaves an audit line, which holds ids and codes, never a name or an address.
import { join } from 'node:path';
import { promises as dnsPromises } from 'node:dns';
import { readJson, writeJson, listFiles, audit, safeId } from './store.mjs';
import { normName, nameTokens, suppressedEmail, suppressedPerson, emailCheck } from './guard.mjs';
import { vendorPassed, vendorSlug } from './vendors.mjs';

const DAY = 86400000;
const need = (v, what) => { const s = String(v ?? '').trim(); if (!s || s === 'true') throw new Error(`${what} is required.`); return s; };
const str = (v) => (typeof v === 'string' ? v.trim() : '');
const lower = (v) => String(v ?? '').trim().toLowerCase();
const ymd = (d) => new Date(d).toISOString().slice(0, 10);
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const validDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const isWebUrl = (u) => { try { return ['http:', 'https:'].includes(new URL(String(u)).protocol); } catch { return false; } };
const accountPath = (dir, id) => join(dir, 'accounts', `${id}.json`);
const load = (dir, id) => {
  safeId(id);
  const a = readJson(accountPath(dir, id), null);
  if (!a) throw new Error(`No account "${id}".`);
  return a;
};
const save = (dir, a) => writeJson(accountPath(dir, a.id), a);
const suppression = (dir) => readJson(join(dir, 'suppression.json'), { entries: [] }).entries ?? [];
const institutionsOf = (a) => [a.name, ...(a.aliases ?? []), a.institutionKey].filter(Boolean);
const requireNamed = (a) => { if (!String(a.person?.name ?? '').trim()) throw new Error(`${a.name} has no named person. Name them first (set person), then their contact details.`); };

export const FIELDS = Object.freeze(['name', 'title', 'email', 'phone', 'mailingAddress']);
export const PHONE_TYPES = Object.freeze(['landline', 'mobile', 'unknown']);

// Where a field came from.
export const SOURCE_KINDS = Object.freeze({
  brief_finding: 'a finding in the account\'s research brief (--finding F3); its page and date come from the brief',
  institution_site: 'a page on the bank\'s own website (--url)',
  correspondence: 'the person wrote to us, or we hold their signature (--seen YYYY-MM-DD)',
  principal_known: 'a principal knows it first-hand',
  vendor: 'a contact-data vendor with a recorded pass (--vendor NAME; PRD E7-S2)',
});
// How a principal knows an address is the person's (the attestation that verification needs, on top of the checks).
export const ATTEST_METHODS = Object.freeze({
  institution_site: 'seen on the bank\'s own site (--url)',
  correspondence: 'the person wrote from that address (--seen YYYY-MM-DD)',
  principal_known: 'a principal knows it first-hand',
  vendor: 'a contact-data vendor with a recorded pass (--vendor NAME)',
});

// ---- Syntax ------------------------------------------------------------------------------------------------------------------
const LOCAL = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
export const domainOk = (d) => /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/.test(String(d ?? ''));
export function emailSyntaxOk(email) {
  const s = String(email ?? '');
  const m = s.match(/^([^@\s]+)@([^@\s]+)$/);
  if (!m || s.length > 254 || m[1].length > 64) return false;
  return LOCAL.test(m[1]) && domainOk(m[2].toLowerCase());
}
const parts = (email) => { const m = lower(email).match(/^([^@\s]+)@([^@\s]+)$/); return m ? { local: m[1], domain: m[2] } : null; };

// ---- Sources -----------------------------------------------------------------------------------------------------------------
function vendorWithPass(dir, vendor) {
  const v = str(vendor);
  if (!v) throw new Error('A vendor needs its name (--vendor NAME).');
  if (!vendorPassed(dir, v)) throw new Error(`${v} has no recorded pass. A vendor is used only after a principal records one (outbound contacts vendor-test, then vendor-pass).`);
  return vendorSlug(v);
}

const findingText = (f) => [f.claim, f.quote, f.source_title].map((x) => String(x ?? '')).join(' ');

// Turns what a principal gave (CLI flags or a web form) into a source record, or refuses plainly. `mustName`: a brief finding must be a
// person finding that names this person. `mustContain`: a brief finding must contain this value (an address, a phone number).
function resolveSource({ dir, account, source, what, now, mustName = null, mustContain = null }) {
  const s = source && typeof source === 'object' ? source : {};
  const findingId = str(s.findingId);
  const url = str(s.url);
  const kind = str(s.kind) || (findingId ? 'brief_finding' : url ? 'institution_site' : '');
  if (!kind) throw new Error(`Where ${what} came from is required: a finding in the brief (--finding F3), a page on the bank's own site (--url URL), or --source correspondence|principal_known|vendor.`);
  if (!Object.hasOwn(SOURCE_KINDS, kind)) throw new Error(`Unknown source "${kind}". Use ${Object.keys(SOURCE_KINDS).join(', ')}.`);
  const today = ymd(now);
  const seenOn = str(s.seenOn);
  if (seenOn && !validDate(seenOn)) throw new Error(`"${seenOn}" is not a date (YYYY-MM-DD).`);
  if (seenOn && seenOn > today) throw new Error(`The date it was seen, ${seenOn}, is in the future.`);
  if (kind === 'brief_finding') {
    if (!findingId) throw new Error('A finding as the source needs its id (--finding F3).');
    const r = readJson(join(dir, 'research', `${account.id}.json`), null);
    if (!r) throw new Error(`${account.name} has no research brief, so a finding cannot be the source. Give the page (--url) or another source.`);
    const f = (r.findings ?? []).find((x) => x.id === findingId);
    if (!f) throw new Error(`No finding "${findingId}" in the research brief for ${account.id}${r.date ? ` (${r.date})` : ''}.`);
    if (mustName) {
      if (f.kind !== 'person') throw new Error(`Finding ${findingId} is not a person finding (it is "${f.kind}"). Choose the candidate's own finding.`);
      const have = new Set(nameTokens(findingText(f)));
      if (!nameTokens(mustName).every((t) => have.has(t))) throw new Error(`Finding ${findingId} does not name ${mustName}. Choose the candidate's own finding.`);
    }
    if (mustContain && !lower(findingText(f)).includes(lower(mustContain))) throw new Error(`Finding ${findingId} does not contain that value. Give the page where you saw it (--url) instead.`);
    return { kind, findingId, url: f.source_url ?? '', seenOn: r.date && validDate(r.date) ? r.date : today };
  }
  if (kind === 'institution_site') {
    if (!isWebUrl(url)) throw new Error('A page on the bank\'s own site as the source needs the page\'s web address (--url https://...).');
    return { kind, url, seenOn: seenOn || today };
  }
  if (kind === 'vendor') return { kind, vendor: vendorWithPass(dir, s.vendor), seenOn: seenOn || today };
  return { kind, ...(isWebUrl(url) ? { url } : {}), seenOn: seenOn || today };   // correspondence, principal_known
}

// One provenance entry per field: setting a field replaces its entry.
function setSource(a, field, value, src, by, at) {
  const rest = (a.contact?.provenance ?? []).filter((p) => p?.field !== field);
  a.contact = { ...(a.contact ?? {}), provenance: [...rest, { field, value, ...src, by, at }] };
}
const dropSource = (a, field) => { a.contact = { ...(a.contact ?? {}), provenance: (a.contact?.provenance ?? []).filter((p) => p?.field !== field) }; };

// ---- The person ----------------------------------------------------------------------------------------------------------------
export function setPerson({ dir, id, name, title = '', by, source, now = new Date() }) {
  const who = need(by, 'A name for who made the change (--by)');
  const a = load(dir, id);
  const nm = need(name, 'The person\'s name');
  const ttl = title === true ? '' : String(title ?? '').trim();
  const sup = suppressedPerson(suppression(dir), nm, institutionsOf(a));
  if (sup) throw new Error(`That person is suppressed at ${a.name} (${sup.reason ?? 'suppressed'}). They cannot be named on an account.`);
  const src = resolveSource({ dir, account: a, source, what: 'the name', now, mustName: nm });
  const at = now.toISOString();
  const same = !!normName(a.person?.name) && normName(a.person?.name) === normName(nm);
  a.person = same ? { ...a.person, name: nm, title: ttl } : { name: nm, title: ttl, email: '', phone: '', phoneType: '', timezone: '', mailingAddress: '' };
  // A new person: nothing of the last one carries over. Either way, the role is unconfirmed until a principal confirms it.
  if (!same) a.contact = { ...(a.contact ?? {}), emailStatus: 'unverified', verification: null, provenance: [] };
  a.contact = { ...a.contact, roleConfirmed: false, roleConfirmedBy: undefined, roleConfirmedAt: undefined };
  setSource(a, 'name', nm, src, who, at);
  if (ttl) setSource(a, 'title', ttl, src, who, at); else dropSource(a, 'title');
  save(dir, a);
  audit(dir, { type: 'person_set', accountId: id, by: who, at, source: src.kind, ...(src.findingId ? { findingId: src.findingId } : {}), newPerson: !same });
  return a;
}

export function confirmRole({ dir, id, by, now = new Date() }) {
  const who = need(by, 'A name for who confirmed it (--by)');
  const a = load(dir, id);
  if (!String(a.person?.name ?? '').trim()) throw new Error(`${a.name} has no named person yet. Name one first (set person), then confirm their role.`);
  a.contact = { ...(a.contact ?? {}), roleConfirmed: true, roleConfirmedBy: who, roleConfirmedAt: now.toISOString() };
  save(dir, a);
  audit(dir, { type: 'role_confirmed', accountId: id, by: who });
  return a;
}

// ---- Contact details -----------------------------------------------------------------------------------------------------------
// A new address starts unverified, whatever it replaces.
export function setEmail({ dir, id, email, by, source, config = {}, now = new Date() }) {
  const who = need(by, 'A name for who made the change (--by)');
  const a = load(dir, id);
  requireNamed(a);
  const addr = lower(need(email, 'The email address'));
  if (!emailSyntaxOk(addr)) throw new Error(`"${addr}" is not a valid email address.`);
  const p = parts(addr);
  if ((config.personalDomains ?? []).includes(p.domain)) throw new Error(`${p.domain} is a personal email domain. Business addresses only.`);
  if ((config.roleLocalParts ?? []).includes(p.local)) throw new Error(`"${p.local}@" is a role address, not a person.`);
  const sup = suppressedEmail(suppression(dir), addr);
  if (sup) throw new Error(`This address is suppressed (${sup.reason ?? 'suppressed'}). It cannot be set.`);
  const src = resolveSource({ dir, account: a, source, what: 'the address', now, mustContain: addr });
  const at = now.toISOString();
  a.person = { ...a.person, email: addr };
  a.contact = { ...(a.contact ?? {}), emailStatus: 'unverified', verification: null };
  setSource(a, 'email', addr, src, who, at);
  save(dir, a);
  audit(dir, { type: 'email_set', accountId: id, by: who, at, source: src.kind });
  return a;
}

export function setPhone({ dir, id, phone, phoneType, timezone = '', by, source, now = new Date() }) {
  const who = need(by, 'A name for who made the change (--by)');
  const a = load(dir, id);
  requireNamed(a);
  const ph = need(phone, 'The phone number').replace(/\s+/g, ' ');
  if ((ph.match(/\d/g) ?? []).length < 7) throw new Error(`"${ph}" is not a phone number.`);
  const type = str(phoneType) || 'unknown';
  if (!PHONE_TYPES.includes(type)) throw new Error(`"${type}" is not a phone type. Use ${PHONE_TYPES.join(', ')}. Only business landlines are called.`);
  const tz = timezone === true ? '' : str(timezone);
  if (tz) { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); } catch { throw new Error(`"${tz}" is not a valid time zone (for example America/Chicago).`); } }
  const src = resolveSource({ dir, account: a, source, what: 'the phone number', now, mustContain: ph });
  const at = now.toISOString();
  a.person = { ...a.person, phone: ph, phoneType: type, ...(tz ? { timezone: tz } : {}) };
  setSource(a, 'phone', ph, src, who, at);
  save(dir, a);
  audit(dir, { type: 'phone_set', accountId: id, by: who, at, source: src.kind, phoneType: type });
  return a;
}

export function setAddress({ dir, id, address, by, source, now = new Date() }) {
  const who = need(by, 'A name for who made the change (--by)');
  const a = load(dir, id);
  requireNamed(a);
  const addr = need(address, 'The mailing address').replace(/\s+/g, ' ');
  const src = resolveSource({ dir, account: a, source, what: 'the mailing address', now, mustContain: addr });
  const at = now.toISOString();
  a.person = { ...a.person, mailingAddress: addr };
  setSource(a, 'mailingAddress', addr, src, who, at);
  save(dir, a);
  audit(dir, { type: 'address_set', accountId: id, by: who, at, source: src.kind });
  return a;
}

// ---- The institution's email domains (account.domains) -------------------------------------------------------------------------
// Verification requires the address to be at one of them, and E9 matches replies by them. A domain another account already holds is
// flagged, because a domain shared by several institutions goes to a principal for review (E9-S3).
export function addDomain({ dir, id, domain, by, source, config = {}, now = new Date() }) {
  const who = need(by, 'A name for who confirmed it (--by)');
  const d = lower(need(domain, 'The domain')).replace(/^@/, '').replace(/\.$/, '');
  if (!domainOk(d)) throw new Error(`"${d}" is not a valid domain (for example acmebank.com).`);
  if ((config.personalDomains ?? []).includes(d)) throw new Error(`${d} is a personal email domain. It is never an institution's domain.`);
  const a = load(dir, id);
  if ((a.domains ?? []).some((x) => lower(x?.domain) === d)) throw new Error(`${d} is already one of ${a.name}'s domains.`);
  const src = resolveSource({ dir, account: a, source, what: 'the domain', now });
  const sharedWith = listFiles(join(dir, 'accounts'), '.json').map((f) => readJson(join(dir, 'accounts', f), null))
    .filter((o) => o && o.id !== a.id && (o.domains ?? []).some((x) => lower(x?.domain) === d)).map((o) => o.id).sort();
  a.domains = [...(a.domains ?? []), { domain: d, ...src, confirmedBy: who, confirmedAt: now.toISOString() }];
  save(dir, a);
  audit(dir, { type: 'domain_added', accountId: id, by: who, source: src.kind, shared: sharedWith.length });
  return { account: a, sharedWith };
}

// ---- Verification --------------------------------------------------------------------------------------------------------------
// Every check is required: the syntax; a recorded source for this address; a business address (no personal domain, no role address);
// a domain the account has confirmed (or a subdomain of one); an MX record for the domain (one DNS lookup, contacts.json requireMx);
// and no suppression. Then the principal's attestation is recorded with it. A check that fails leaves the address unverified, and
// revokes an earlier verification: what was true then is not known to be true now. `resolveMx` is injectable so tests never touch DNS.
const defaultResolveMx = (domain) => dnsPromises.resolveMx(domain);
export async function verifyEmail({ dir, id, by, method, url, vendor, seen, config = {}, resolveMx = defaultResolveMx, now = new Date() }) {
  const who = need(by, 'A name for who verified it (--by)');
  const m = str(method);
  if (!m) throw new Error(`How you know the address is required (--method ${Object.keys(ATTEST_METHODS).join('|')}).`);
  if (!Object.hasOwn(ATTEST_METHODS, m)) throw new Error(`Unknown method "${m}". Use ${Object.keys(ATTEST_METHODS).join(', ')}.`);
  const a = load(dir, id);
  const addr = lower(a.person?.email);
  if (!addr) throw new Error(`${a.name} has no address to verify. Set it with its source first (set email).`);
  const today = ymd(now);
  const seenOn = str(seen);
  if (seenOn && !validDate(seenOn)) throw new Error(`"${seenOn}" is not a date (YYYY-MM-DD).`);
  if (seenOn && seenOn > today) throw new Error(`The date it was seen, ${seenOn}, is in the future.`);
  const attest = { method: m, seenOn: seenOn || today };
  if (m === 'institution_site') {
    if (!isWebUrl(url)) throw new Error('Seen on the bank\'s own site: the method needs the page\'s web address (--url https://...).');
    attest.url = str(url);
  }
  if (m === 'vendor') attest.vendor = vendorWithPass(dir, vendor);

  const checks = [];
  const add = (cid, ok, pass, fail) => checks.push({ id: cid, ok: !!ok, message: ok ? pass : fail });
  const p = parts(addr);
  add('syntax', emailSyntaxOk(addr), 'The address is well formed.', 'The address is not well formed.');
  add('sourced', (a.contact?.provenance ?? []).some((x) => x?.field === 'email' && lower(x.value) === addr), 'The address has a recorded source.', 'The address has no recorded source. Set it with its source (set email).');
  add('business', p && !(config.personalDomains ?? []).includes(p.domain) && !(config.roleLocalParts ?? []).includes(p.local), 'A business address for a person.', 'A personal domain or a role address. Business addresses for a person only.');
  const confirmed = (a.domains ?? []).map((x) => lower(x?.domain)).filter(Boolean);
  const matched = p ? confirmed.find((d) => p.domain === d || p.domain.endsWith(`.${d}`)) ?? null : null;
  add('domain', matched, 'The domain is one the account has confirmed.', `The domain is not one of the account's confirmed domains${confirmed.length ? '' : ' (it has none yet)'}. A principal confirms it first (add domain).`);
  let mx;
  if (config.contacts?.requireMx === false) { mx = 'skipped'; checks.push({ id: 'mx', ok: true, skipped: true, message: 'Skipped: contacts.json requireMx is false.' }); }
  else if (!p) add('mx', false, '', 'No domain to look up.');
  else {
    try {
      const recs = await resolveMx(p.domain);
      const usable = (Array.isArray(recs) ? recs : []).filter((r) => r && typeof r.exchange === 'string' && r.exchange && r.exchange !== '.');
      add('mx', usable.length > 0, `The domain publishes ${usable.length} mail server record(s) (MX).`, 'The domain publishes no usable MX record (or a null MX), so it takes no mail.');
    } catch (e) { add('mx', false, '', `No MX record could be found for the domain (${e?.code ?? 'lookup failed'}).`); }
    if (checks.at(-1).ok) mx = 'pass';
  }
  add('suppression', !suppressedEmail(suppression(dir), addr), 'The address is not suppressed.', 'The address is suppressed.');

  const failed = checks.filter((c) => !c.ok).map((c) => c.id);
  if (failed.length) {
    if (a.contact?.emailStatus === 'verified' || a.contact?.verification) { a.contact = { ...a.contact, emailStatus: 'unverified', verification: null }; save(dir, a); }
    audit(dir, { type: 'email_verify_failed', accountId: id, by: who, method: m, failed });
    return { ok: false, checks, account: a };
  }
  a.contact = { ...(a.contact ?? {}), emailStatus: 'verified', verification: { email: addr, ...attest, by: who, at: now.toISOString(), verifiedOn: today, checks: { syntax: 'pass', sourced: 'pass', business: 'pass', domain: matched, mx, suppression: 'pass' } } };
  save(dir, a);
  audit(dir, { type: 'email_verified', accountId: id, by: who, method: m });
  return { ok: true, checks, account: a };
}

// ---- The view, for the command line and the web ----------------------------------------------------------------------------------
// One line for where a field came from: "brief finding F1 (https://...), seen 2026-11-10, set by Pat Example".
export function sourceLabel(src) {
  if (!src) return 'no source recorded';
  const what = { brief_finding: `brief finding ${src.findingId ?? ''}`.trim(), institution_site: 'the bank\'s own site', correspondence: 'correspondence', principal_known: 'known to a principal', vendor: `vendor ${src.vendor ?? ''}`.trim() }[src.kind] ?? (src.kind || src.source || 'a source');
  return `${what}${src.url ? ` (${src.url})` : ''}${src.seenOn || src.date ? `, seen ${src.seenOn ?? src.date}` : ''}${src.by || src.confirmedBy ? `, set by ${src.by ?? src.confirmedBy}` : ''}`;
}

// The address's state, by the guard's own rule (src/guard.mjs emailCheck): none, unverified, verified, expired, other_address (the
// verification on record is for another address) or unsourced (verified, but the address has no source of its own, so the guard refuses
// it all the same).
export function contactStatus(account, { config = {}, now = new Date() } = {}) {
  const p = account?.person ?? {};
  const c = account?.contact ?? {};
  const address = lower(p.email);
  const days = config.contacts?.reverifyDays;
  const v = c.verification ?? null;
  const reverifyBy = v?.verifiedOn && Number.isInteger(days) ? addDays(v.verifiedOn, days) : null;
  let state = 'none'; let reason = null;
  if (address) {
    const check = emailCheck({ address, contact: c, day: ymd(now), reverifyDays: days });
    state = check.state === 'none' ? 'unverified' : check.state;   // an address that is not well formed is never verified
    reason = check.problems[0]?.message ?? (check.verified ? null : 'The address is not a valid email address.');
  }
  const src = (f) => (c.provenance ?? []).filter((x) => x?.field === f).at(-1) ?? null;
  return {
    email: { address: address || null, state, reason, verification: v, reverifyBy, source: src('email') },
    fields: Object.fromEntries(FIELDS.map((f) => [f, src(f)])),
    unsourced: FIELDS.filter((f) => String(p[f] ?? '').trim() && !src(f)),
    domains: account?.domains ?? [],
    role: { confirmed: !!c.roleConfirmed, by: c.roleConfirmedBy ?? null, at: c.roleConfirmedAt ?? null },
    forgotten: (account?.forgotten ?? []).map((x) => ({ at: x.at, by: x.by })),
  };
}

