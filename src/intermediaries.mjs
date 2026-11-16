// Intermediaries (PRD next-five E19, S1 to S4). The firms that act for sellers in our market: loan-sale advisors and CMBS special
// servicers first (D-I1, decided 2026-11-16). An intermediary is a FIRM, never a person: no name, phone or email of a person is stored.
//
// S1  The registry: every firm a stored source shows acting for a seller, with its MANDATES (dated records, each with its source).
//     Feeders, from stored data only (no network): the FDIC loan-sale announcements' advisor and CMBS liquidations (both in the sale
//     ledger), CMBS loans now in special servicing (sources/edgar/loans.json), loan-sale listings (the ledger, once a listing feeder
//     exists), and mandates a principal enters by hand. A seller no source names stays `unknown`: it counts toward a firm's volume,
//     never toward distinct sellers served, and never makes a route. A REFERRAL (a call's "wrong person: ask X") is kept apart and never
//     counts toward the ranking.
// S2  The ranking: deterministic, weights in config.json intermediaries.weights (placeholders, D-I3), each component with its mandates.
// S3  Buyer-list registration for loan-sale advisors: a state per firm, recorded by a principal (Josh owns them, D-I2). Moving to
//     proof_of_funds_sent is refused until a principal records that the credibility package (research agenda D9) is approved. The
//     agreement itself is never stored. Anything learned under an agreement goes on the existing NDA list (suppression.json).
// S4  The route to a seller: unknown (the default: no advisor seen is not evidence of a direct sale), advisor, direct (only on a
//     principal's recorded evidence), or both. Context for a principal only: no model-facing action loads intermediaries/.
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { readJson, writeJson, audit } from './store.mjs';
import { readLedger, eventsOf, actingSeller } from './sales.mjs';
import { edgarPaths } from './sources/edgar.mjs';
import { addSuppression } from './guard.mjs';

export const KINDS = Object.freeze({
  loan_sale_advisor: 'Loan-sale advisor', special_servicer: 'CMBS special servicer', receiver: 'Receiver', lender_counsel: "Lender's counsel", trustee_counsel: "Trustee's counsel",
});
export const REG_STATES = Object.freeze(['not_started', 'requested', 'agreement_in_review', 'agreement_signed', 'proof_of_funds_sent', 'registered', 'declined']);
const UNDER_AGREEMENT = ['agreement_signed', 'proof_of_funds_sent', 'registered'];
export const ROUTES = Object.freeze({ unknown: 'unknown: no advisor seen, which is not evidence of a direct sale', advisor: 'through an advisor', direct: 'direct', both: 'both direct and through an advisor' });
export const intermediaryPaths = (dir) => {
  const base = join(dir, 'intermediaries');
  return { base, registry: join(base, 'registry.json'), manual: join(base, 'manual.json'), registrations: join(base, 'registrations.json') };
};

export const slug = (name) => String(name ?? '').toLowerCase().replace(/&/g, ' and ').replace(/\b(llc|l\.l\.c|inc|incorporated|corp|corporation|co|company|lp|l\.p|llp|ltd)\b\.?/g, ' ')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
export const firmKey = (name) => `intermediary:${slug(name)}`;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const need = (v, what) => { const s = String(v ?? '').trim(); if (!s) throw new Error(`${what} is required.`); return s; };
const needDate = (v, what) => { const s = need(v, what); if (!DATE.test(s)) throw new Error(`${what} must be a date, YYYY-MM-DD.`); return s; };
const hashId = (...parts) => createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 16);
const named = (s) => !!(s && s.kind !== 'unknown' && (s.key || s.name));
const sellerId = (s) => (named(s) ? s.key ?? `name:${String(s.name).toLowerCase()}` : null);

// ---- S1: the feeders --------------------------------------------------------------------------------------------------------------
// Each returns mandates: { id, firmName, kind, seller, sellerDescription?, date, metro, sector, balance, loans?, sources, feeder }.
export function ledgerMandates(ledger) {
  const out = [];
  for (const e of eventsOf(ledger)) {
    if (e.kind === 'fdic_sale_announced' && String(e.sale?.advisor ?? '').trim()) {
      const inMetros = (e.seller?.receiverships ?? []).find((r) => r.inMetros && r.metros?.length);
      out.push({ id: `fdic-sale:${e.sale.saleId}`, firmName: e.sale.advisor.trim(), kind: 'loan_sale_advisor', feeder: 'fdicsales',
        seller: { kind: 'fdic', key: e.seller?.key ?? 'fdic-receiver', name: e.seller?.name ?? 'the FDIC as receiver' }, date: e.date,
        metro: inMetros ? String(inMetros.metros[0]?.cbsa ?? inMetros.metros[0]) : null, sector: null, balance: e.asset?.balance ?? null, loans: e.asset?.loans ?? null, sources: e.sources ?? [] });
    }
    const via = e.seller?.via;
    if (e.seller?.kind === 'trust' && via?.kind === 'servicer' && via.name && via.name !== 'Unknown') {
      out.push({ id: `cmbs-liquidation:${e.id}`, firmName: via.name, kind: 'special_servicer', feeder: 'edgar-dispositions',
        seller: { kind: 'trust', key: e.seller.key, name: e.seller.name }, date: e.date, metro: e.asset?.metro ?? null, sector: e.asset?.sector ?? null,
        balance: e.asset?.balance ?? null, sources: e.sources ?? [] });
    }
    if (e.kind === 'marketed_listing' && String(e.listing?.advisor ?? '').trim()) {
      const seller = named(actingSeller(e)) ? actingSeller(e) : { kind: 'unknown', name: 'unknown' };
      out.push({ id: `listing:${e.id}`, firmName: e.listing.advisor.trim(), kind: 'loan_sale_advisor', feeder: 'listings', seller,
        ...(e.seller?.description ? { sellerDescription: e.seller.description } : {}), date: e.date, metro: e.asset?.metro ?? null, sector: e.asset?.sector ?? e.asset?.propertyType ?? null,
        balance: e.asset?.balance ?? null, loans: e.asset?.loans ?? null, sources: e.sources ?? [] });
    }
  }
  return out;
}

// CMBS loans now in special servicing (or coded for a note sale), grouped by special servicer and trust: the servicer acts for the trust.
export function servicingMandates(loans) {
  const by = new Map();
  for (const l of Object.values(loans ?? {})) {
    if (!l?.specialServicer || l.specialServicer === 'Unknown' || !l.cik) continue;
    if (!(l.signals ?? []).some((s) => s.type === 'special_servicing' || s.type === 'note_sale')) continue;
    const id = `cmbs-servicing:${l.cik}:${slug(l.specialServicer)}`;
    const m = by.get(id) ?? { id, firmName: l.specialServicer, kind: 'special_servicer', feeder: 'edgar-loans', seller: { kind: 'trust', key: `cmbs-trust:${l.cik}`, name: l.trust ?? `CMBS trust ${l.cik}` },
      date: null, metro: null, metros: new Set(), sector: null, sectors: new Set(), balance: 0, loans: 0, sources: [] };
    m.loans++; m.balance += Number(l.balance) || 0;
    for (const c of l.metros ?? []) m.metros.add(String(c));
    for (const s of l.sectors ?? []) m.sectors.add(s);
    if (l.period && (!m.date || l.period > m.date)) m.date = l.period;
    if (l._source && m.sources.length < 3) m.sources.push({ source: 'edgar', ids: [l.key], link: null, date: l.period ?? null });
    by.set(id, m);
  }
  return [...by.values()].filter((m) => m.date).map((m) => ({ ...m, metros: [...m.metros].sort(), metro: [...m.metros].sort()[0] ?? null, sectors: [...m.sectors].sort(), sector: [...m.sectors].sort()[0] ?? null }));
}

const manualOf = (dir) => readJson(intermediaryPaths(dir).manual, { mandates: [], referrals: [], directSales: [], aliases: {} });

// ---- S1: the registry ---------------------------------------------------------------------------------------------------------------
// Pure: the mandates by firm. A firm's key comes from its name, or from an alias a principal added. The same mandate id never counts twice.
export function buildRegistry({ ledger, loans, manual = {}, kinds = Object.keys(KINDS) }) {
  const aliases = manual.aliases ?? {};
  const keyOf = (name) => aliases[slug(name)] ?? firmKey(name);
  const all = [...ledgerMandates(ledger), ...servicingMandates(loans),
    ...(manual.mandates ?? []).map((m) => ({ ...m, feeder: 'principal', firmName: m.firmName }))];
  const firms = {}, mandates = {};
  for (const m of all) {
    if (!kinds.includes(m.kind) || mandates[m.id]) continue;
    const key = m.firm ?? keyOf(m.firmName);
    mandates[m.id] = { ...m, intermediary: key };
    const f = (firms[key] ??= { key, name: m.firmName, kinds: [], mandates: [], referrals: [] });
    if (!f.kinds.includes(m.kind)) f.kinds.push(m.kind);
    f.mandates.push(m.id);
  }
  for (const r of manual.referrals ?? []) {
    const f = firms[r.firm] ?? (firms[r.firm] = { key: r.firm, name: r.firmName, kinds: [], mandates: [], referrals: [] });
    f.referrals.push(r);
  }
  return { firms, mandates };
}

export function writeRegistry({ dir, config = {}, now = new Date() }) {
  const ic = config.intermediaries ?? {};
  const reg = buildRegistry({ ledger: readLedger(dir), loans: readJson(edgarPaths(dir).loans, {}), manual: manualOf(dir), kinds: ic.kinds ?? Object.keys(KINDS) });
  writeJson(intermediaryPaths(dir).registry, { builtAt: now.toISOString(), kinds: ic.kinds ?? Object.keys(KINDS), ...reg });
  const counts = { firms: Object.keys(reg.firms).length, mandates: Object.keys(reg.mandates).length };
  audit(dir, { type: 'intermediaries_built', ...counts });
  return counts;
}
export const readRegistry = (dir) => readJson(intermediaryPaths(dir).registry, null);

// ---- S2: the ranking ------------------------------------------------------------------------------------------------------------
// A component earns weight x min(value / full, 1). Values: mandates in our metros, mandates in buy-box sectors, distinct NAMED sellers
// (unknown never counts), recent mandates (each worth 0.5^(age in months / half-life)), and the balance where known.
const monthsBetween = (from, to) => (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / (86400000 * 30.44);
export function rankFirms({ registry, config = {}, buybox = {}, asOf }) {
  const w = config.intermediaries?.weights ?? {};
  const metros = new Set((buybox.metros ?? []).map(String));
  const sectors = new Set(buybox.sectors?.include ?? []);
  const day = asOf ?? new Date().toISOString().slice(0, 10);
  const comp = (id, value, ids, note) => { const c = w[id] ?? { weight: 0, full: 1 }; return { id, value: Math.round(value * 100) / 100, weight: c.weight, full: c.full, points: Math.round(c.weight * Math.min(value / (c.full || 1), 1) * 100) / 100, mandates: ids, ...(note ? { note } : {}) }; };
  const rows = Object.values(registry?.firms ?? {}).map((f) => {
    const ms = f.mandates.map((id) => registry.mandates[id]).filter(Boolean);
    const inMetro = ms.filter((m) => (m.metros ?? [m.metro]).some((c) => c && metros.has(String(c))));
    const inSector = ms.filter((m) => (m.sectors ?? [m.sector]).some((s) => s && sectors.has(s)));
    const sellers = new Map(); for (const m of ms) { const k = sellerId(m.seller); if (k && !sellers.has(k)) sellers.set(k, m.id); }
    const half = w.recentMandates?.halfLifeMonths ?? 12;
    const recent = ms.filter((m) => DATE.test(String(m.date))).reduce((s, m) => s + 0.5 ** (Math.max(0, monthsBetween(m.date, day)) / half), 0);
    const bal = ms.reduce((s, m) => s + (Number(m.balance) || 0), 0);
    const components = [
      comp('metroMandates', inMetro.length, inMetro.map((m) => m.id)),
      comp('sectorMandates', inSector.length, inSector.map((m) => m.id)),
      comp('namedSellers', sellers.size, [...sellers.values()], 'distinct sellers a source names; an unknown seller never counts'),
      comp('recentMandates', recent, ms.map((m) => m.id), `each mandate worth 0.5^(age in months / ${half})`),
      comp('balance', bal, ms.filter((m) => Number(m.balance) > 0).map((m) => m.id), 'dollars, where a source gives a balance'),
    ];
    return { key: f.key, name: f.name, kinds: f.kinds, mandates: ms.length, referrals: f.referrals.length, latest: ms.map((m) => m.date).filter(Boolean).sort().at(-1) ?? null,
      score: Math.round(components.reduce((s, c) => s + c.points, 0) * 100) / 100, components };
  });
  return rows.sort((a, b) => b.score - a.score || b.mandates - a.mandates || a.name.localeCompare(b.name));
}

// ---- Principal-entered records (S1, S4) -----------------------------------------------------------------------------------------
function saveManual(dir, m) { writeJson(intermediaryPaths(dir).manual, m); }
const sellerArg = (seller) => {
  const s = need(seller, 'The seller (--seller fdic:CERT, servicer:..., or a name)');
  return /^(fdic:\d+|servicer:[a-z0-9-]+|cmbs-trust:\d+)$/.test(s) ? { kind: s.split(':')[0] === 'fdic' ? 'bank' : s.split(':')[0], key: s, name: s } : { kind: 'other', name: s };
};

// A principal's confirmation that a firm acted for a named seller: the date and how they know it, audited with their name.
export function addMandate({ dir, firmName, kind, seller, date, how, by, metro = null, sector = null, now = new Date() }) {
  const who = need(by, 'A name for who recorded it (--by)');
  const name = need(firmName, 'The firm (--firm)');
  if (!KINDS[kind]) throw new Error(`--kind must be one of ${Object.keys(KINDS).join(', ')}.`);
  const s = sellerArg(seller); const d = needDate(date, 'The date it acted (--date)'); const h = need(how, 'How you know (--how)');
  const m = manualOf(dir);
  const id = `principal:${hashId(slug(name), s.key ?? s.name, d)}`;
  if ((m.mandates ?? []).some((x) => x.id === id)) return { id, already: true };
  m.mandates = [...(m.mandates ?? []), { id, firmName: name, kind, seller: s, date: d, metro, sector, balance: null, how: h, by: who, at: now.toISOString(), sources: [{ source: 'principal', ids: [id], link: null, date: d }] }];
  saveManual(dir, m);
  audit(dir, { type: 'intermediary_mandate_added', id, kind, by: who });
  return { id, already: false };
}

// A call's "wrong person: ask X" names a firm, entered by a principal. Evidence of a route; never a mandate, never ranked.
export function addReferral({ dir, firmName, seller, date, by, now = new Date() }) {
  const who = need(by, 'A name for who recorded it (--by)');
  const name = need(firmName, 'The firm (--firm)');
  const s = sellerArg(seller); const d = needDate(date, 'The date of the call (--date)');
  const m = manualOf(dir);
  const firm = (m.aliases ?? {})[slug(name)] ?? firmKey(name);
  const r = { id: `referral:${hashId(firm, s.key ?? s.name, d)}`, firm, firmName: name, seller: s, date: d, by: who, at: now.toISOString() };
  if ((m.referrals ?? []).some((x) => x.id === r.id)) return { ...r, already: true };
  m.referrals = [...(m.referrals ?? []), r]; saveManual(dir, m);
  audit(dir, { type: 'intermediary_referral_added', id: r.id, by: who });
  return { ...r, already: false };
}

// Evidence that a seller sold WITHOUT an advisor (S4: the only way a route becomes `direct`).
export function addDirectSale({ dir, seller, date, how, by, now = new Date() }) {
  const who = need(by, 'A name for who recorded it (--by)');
  const s = sellerArg(seller); const d = needDate(date, 'The date of the sale (--date)'); const h = need(how, 'How you know (--how)');
  const m = manualOf(dir);
  const r = { id: `direct:${hashId(s.key ?? s.name, d)}`, seller: s, date: d, how: h, by: who, at: now.toISOString() };
  if ((m.directSales ?? []).some((x) => x.id === r.id)) return { ...r, already: true };
  m.directSales = [...(m.directSales ?? []), r]; saveManual(dir, m);
  audit(dir, { type: 'direct_sale_recorded', id: r.id, by: who });
  return { ...r, already: false };
}

export function addFirmAlias({ dir, key, alias, by }) {
  const who = need(by, 'A name for who added it (--by)');
  const k = need(key, 'The firm (--key intermediary:...)');
  if (!/^intermediary:[a-z0-9-]+$/.test(k)) throw new Error('--key must be an intermediary key, like intermediary:example-advisors.');
  const a = slug(need(alias, 'The other name (--alias)'));
  const m = manualOf(dir);
  m.aliases = { ...(m.aliases ?? {}), [a]: k }; saveManual(dir, m);
  audit(dir, { type: 'intermediary_alias_added', key: k, by: who });
  return { key: k, alias: a };
}

// ---- S3: buyer-list registration --------------------------------------------------------------------------------------------------
const regsOf = (dir) => readJson(intermediaryPaths(dir).registrations, { credibilityPackage: null, firms: {} });
export function approveCredibilityPackage({ dir, by, now = new Date() }) {
  const who = need(by, 'A name for who approved it (--by)');
  const r = regsOf(dir);
  r.credibilityPackage = { approvedBy: who, at: now.toISOString() };
  writeJson(intermediaryPaths(dir).registrations, r);
  audit(dir, { type: 'credibility_package_approved', by: who });
  return r.credibilityPackage;
}

export function setRegistration({ dir, key, state, by, recertifyBy = null, now = new Date() }) {
  const who = need(by, 'A name for who recorded it (--by)');
  const k = need(key, 'The firm (--key)');
  if (!REG_STATES.includes(state)) throw new Error(`--state must be one of ${REG_STATES.join(', ')}.`);
  if (recertifyBy !== null) needDate(recertifyBy, '--recertify-by');
  const reg = readRegistry(dir);
  const firm = reg?.firms?.[k];
  if (!firm) throw new Error(`${k} is not in the registry. Run: outbound intermediaries build (or record a mandate for it first).`);
  if (!firm.kinds.includes('loan_sale_advisor')) throw new Error(`${firm.name} is not a loan-sale advisor; buyer-list registration is for advisors only.`);
  const r = regsOf(dir);
  if (state === 'proof_of_funds_sent' && !r.credibilityPackage) throw new Error('Proof of funds is not sent until a principal records that the credibility package (research agenda D9) is approved: outbound intermediaries credibility-approved --by NAME.');
  const cur = r.firms[k] ?? { key: k, name: firm.name, state: 'not_started', history: [] };
  cur.state = state; cur.recertifyBy = recertifyBy ?? cur.recertifyBy ?? null;
  cur.history = [...cur.history, { state, by: who, at: now.toISOString(), ...(recertifyBy ? { recertifyBy } : {}) }];
  r.firms[k] = cur;
  writeJson(intermediaryPaths(dir).registrations, r);
  audit(dir, { type: 'registration_state', key: k, state, by: who });
  return cur;
}
export const readRegistrations = (dir) => regsOf(dir);

// A re-certification due within `withinDays` (or past): a reminder for the Status page.
export function registrationReminders({ registrations, asOf, withinDays = 30 }) {
  const lim = new Date(Date.parse(`${asOf}T00:00:00Z`) + withinDays * 86400000).toISOString().slice(0, 10);
  return Object.values(registrations?.firms ?? {}).filter((f) => f.recertifyBy && f.recertifyBy <= lim && f.state !== 'declined')
    .map((f) => ({ key: f.key, name: f.name, recertifyBy: f.recertifyBy, overdue: f.recertifyBy < asOf })).sort((a, b) => a.recertifyBy.localeCompare(b.recertifyBy));
}

// An asset or seller learned under an advisor's agreement goes on the existing NDA list, so the guard blocks touches about it.
export function ndaUnder({ dir, key, type, value, by, ctx = null }) {
  const who = need(by, 'A name for who recorded it (--by)');
  if (!['asset', 'institution'].includes(type)) throw new Error('--type must be asset or institution.');
  const r = regsOf(dir).firms[need(key, 'The firm (--key)')];
  if (!r || !UNDER_AGREEMENT.includes(r.state)) throw new Error(`${key} has no signed agreement recorded (state ${r?.state ?? 'not_started'}). Record it first: outbound intermediaries register --key ${key} --state agreement_signed --by NAME.`);
  const e = addSuppression(dir, { type, value: need(value, 'What to put on the NDA list (--value)'), reason: `NDA: learned under ${r.name}'s buyer-list agreement` }, ctx);
  audit(dir, { type: 'nda_under_advisor', key, entryType: type, by: who });
  return e;
}

// ---- S4: the route to a seller ----------------------------------------------------------------------------------------------------
export function routeFor({ registry, manual = {}, registrations = {}, sellerKey }) {
  const adv = Object.values(registry?.mandates ?? {}).filter((m) => m.kind === 'loan_sale_advisor' && named(m.seller) && m.seller.key === sellerKey);
  const direct = (manual.directSales ?? []).filter((d) => d.seller?.key === sellerKey);
  const route = adv.length && direct.length ? 'both' : adv.length ? 'advisor' : direct.length ? 'direct' : 'unknown';
  const firms = new Map();
  for (const m of adv) { const f = firms.get(m.intermediary) ?? { key: m.intermediary, name: registry.firms[m.intermediary]?.name ?? m.firmName, last: null, registration: registrations.firms?.[m.intermediary]?.state ?? 'not_started' }; if (!f.last || m.date > f.last) f.last = m.date; firms.set(m.intermediary, f); }
  const advisors = [...firms.values()].map((f) => ({ ...f, notRegistered: f.registration !== 'registered' }));
  return { route, label: ROUTES[route], advisors, direct: direct.map((d) => ({ date: d.date, how: d.how, by: d.by })) };
}
export const routeForDir = (dir, sellerKey) => routeFor({ registry: readRegistry(dir), manual: manualOf(dir), registrations: regsOf(dir), sellerKey });
