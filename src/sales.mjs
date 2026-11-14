// The who-sells-to-whom ledger (PRD E16). A lender that has sold loans before is the warmest prospect there is; the known buyers
// show who the firm competes with; completed sales give price evidence. Every sale event any source shows goes into one ledger,
// sales/ledger.json in the data folder, de-duplicated by a stable event id. `outbound sales build` rebuilds it from stored data only:
//   - CMBS (sources/edgar/dispositions.json): a loan in our metros and sectors liquidated by disposition (code 3) or DPO (6);
//   - SEC filings (sources/edgar/filings.json, through filingSignals): a bank filing that disclosed a completed sale or disposition;
//   - FDIC structure events (sources/fdic/events.json): a whole-bank acquisition of a bank with a presence in our metros;
//   - FDIC loan-sale announcements (sources/fdic/sales.json).
// Two later sources have their event shape here and no adapter yet: a recorded assignment of a deed of trust (county records), and a
// loan-sale listing. A feeder for either plugs into buildLedger's `feeders`.
//
// No invented facts: a buyer no source names is `unknown`. An implied recovery is labelled approximate and is never a price. Property
// names and addresses are kept in the ledger as context for a principal; they never go in a log, and nothing here reaches the drafter.
import { join } from 'node:path';
import { readJson, writeJson, appendJsonl, readJsonl } from './store.mjs';
import { startRun, finishRun, sourceBlock, upsertWithChanges, CHANGES, RUNS, scrub } from './sources/runlog.mjs';
import { edgarPaths } from './sources/edgar.mjs';
import { fdicPaths, FDIC_BASE } from './sources/fdic.mjs';
import { fdicSalesPaths, SELLER as FDIC_SELLER } from './sources/fdicsales.mjs';
import { filingSignals } from './sources/filings.mjs';

export const salesPaths = (dir) => ({ ledger: join(dir, 'sales', 'ledger.json') });

// ---- The event shape -----------------------------------------------------------------------------------------------------------
export const KINDS = Object.freeze({
  note_sale_completed: 'A CMBS loan liquidated after a note-sale workout',
  dpo: 'A CMBS loan resolved by a discounted payoff',
  disposition: 'A CMBS loan liquidated by disposition (an REO sale or a foreclosure, not necessarily a note sale)',
  bank_disclosed_sale: 'A bank disclosed a completed sale or disposition in an SEC filing',
  whole_bank_acquisition: 'A whole bank with a presence in our metros was acquired',
  fdic_sale_announced: 'The FDIC as receiver announced a loan sale',
  assignment: 'A recorded assignment of a deed of trust (county records; no adapter yet)',
  marketed_listing: 'A loan or pool listed for sale (loan-sale listings; no adapter yet)',
});
// `other` is a party a source names that is none of the first four: a fund or an LLC that took an assignment, say.
export const PARTY_KINDS = Object.freeze(['bank', 'servicer', 'trust', 'fdic', 'other', 'unknown']);
export const ASSET_KINDS = Object.freeze(['loan', 'pool', 'bank', 'unknown']);
export const TIERS = Object.freeze(['reported', 'observed']);   // docs/paper-estimate.md, section 3: reported to a regulator or the SEC; observed from records
export const UNKNOWN = Object.freeze({ kind: 'unknown', name: 'unknown' });
// Kinds whose buyer a source can name: the FDIC's record of a whole-bank deal, and a recorded assignment. Every other kind's buyer is unknown.
const BUYER_NAMED = new Set(['whole_bank_acquisition', 'assignment']);
const CMBS_KINDS = new Set(['note_sale_completed', 'dpo', 'disposition']);

export const servicerKey = (name) => `servicer:${String(name ?? '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const num = (v) => (v === undefined || v === null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

function partyErrors(p, role) {
  const e = [];
  if (!p || typeof p !== 'object') return [`${role} is missing`];
  if (!PARTY_KINDS.includes(p.kind)) e.push(`${role}.kind must be one of ${PARTY_KINDS.join(', ')}`);
  if (typeof p.name !== 'string' || !p.name.trim()) e.push(`${role}.name is required`);
  if (p.kind === 'unknown' && (p.name !== 'unknown' || p.key)) e.push(`${role}: an unknown party is { kind: "unknown", name: "unknown" }, with no key`);
  if (p.key !== undefined && p.key !== null && typeof p.key !== 'string') e.push(`${role}.key must be a string`);
  if (p.kind === 'bank' && p.key && !/^fdic:\d+$/.test(p.key)) e.push(`${role}.key of a bank is fdic:CERT`);
  if (p.kind === 'servicer' && p.key && !/^servicer:[a-z0-9-]+$/.test(p.key)) e.push(`${role}.key of a servicer is servicer:<slug>`);
  if (isMers(p.name)) e.push(`${role}: MERS is a nominee, not a party (resolveParty)`);
  if (p.via) e.push(...partyErrors(p.via, `${role}.via`));
  return e;
}

// The checks every event passes before it enters the ledger. Returns a list of plain sentences; empty means accepted.
export function validateEvent(ev) {
  const e = [];
  if (!ev || typeof ev !== 'object') return ['not an object'];
  if (typeof ev.id !== 'string' || !ev.id.trim()) e.push('id is required');
  if (!KINDS[ev.kind]) e.push(`kind must be one of ${Object.keys(KINDS).join(', ')}`);
  if (!ISO.test(String(ev.date ?? ''))) e.push('date must be YYYY-MM-DD');
  e.push(...partyErrors(ev.seller, 'seller'), ...partyErrors(ev.buyer, 'buyer'));
  if (ev.buyer && ev.buyer.kind !== 'unknown' && !BUYER_NAMED.has(ev.kind)) e.push(`buyer: no ${ev.kind} source names a buyer, so it must be unknown`);
  const a = ev.asset;
  if (!a || typeof a !== 'object') e.push('asset is required');
  else {
    if (!ASSET_KINDS.includes(a.kind)) e.push(`asset.kind must be one of ${ASSET_KINDS.join(', ')}`);
    for (const k of ['propertyType', 'balance']) if (!(k in a)) e.push(`asset.${k} is required (null when unknown)`);
    if (!('metro' in a) && !('county' in a)) e.push('asset.metro or asset.county is required (null when unknown)');
    if (a.balance !== null && a.balance !== undefined && !Number.isFinite(a.balance)) e.push('asset.balance must be a number or null');
  }
  if (!TIERS.includes(ev.tier)) e.push(`tier must be one of ${TIERS.join(', ')}`);
  if (!Array.isArray(ev.sources) || !ev.sources.length) e.push('sources: at least one');
  for (const s of ev.sources ?? []) {
    if (!s?.source || !Array.isArray(s.ids) || !s.ids.length) e.push('each source needs source and ids');
    if (s && s.date !== null && s.date !== undefined && !ISO.test(String(s.date))) e.push('a source date must be YYYY-MM-DD or null');
  }
  if (ev.priceEvidence) {
    const r = ev.priceEvidence.impliedRecovery;
    if (ev.priceEvidence.isPrice !== false || !r || r.approximate !== true || !r.label) e.push('priceEvidence: the implied recovery must be labelled approximate, and it is never the price');
  }
  if (ev.kind && CMBS_KINDS.has(ev.kind) && ev.seller?.kind !== 'trust') e.push('a CMBS liquidation is sold by its trust');
  if (ev.kind === 'whole_bank_acquisition' && (ev.buyer?.kind !== 'bank' || !ev.buyer?.key)) e.push('a whole-bank acquisition names its acquirer by FDIC cert');
  if (ev.kind === 'assignment') {
    const x = ev.assignment;
    if (!x?.recordingNumber || !x?.county || !Array.isArray(x?.chain)) e.push('assignment needs recordingNumber, county and chain');
    if (!x?.deedOfTrust || (!x.deedOfTrust.recordingNumber && !x.apn)) e.push('assignment needs the original deed of trust (its recording number) or the APN');
  }
  if (ev.kind === 'marketed_listing' && (!ev.listing?.site || !ev.listing?.listingId)) e.push('a listing needs listing.site and listing.listingId');
  return e;
}

// ---- Price evidence --------------------------------------------------------------------------------------------------------------
export const RECOVERY_LABEL = 'Approximate implied recovery: 1 − realized loss ÷ balance before liquidation. The realized loss to the trust is net of liquidation expenses and can include unreimbursed advances, so this is NOT the sale price.';
const round4 = (x) => Math.round(x * 10000) / 10000;

// 1 − loss ÷ balance, labelled approximate. A missing balance or loss gives no value and says why; a zero loss gives 1 and says so.
// Filers differ on the sign of realizedLossToTrustAmount (the schema defines it as a difference); the magnitude is used, and a
// negative figure is flagged.
export function impliedRecovery({ balance, loss }) {
  const b = num(balance), l = num(loss);
  const base = { approximate: true, label: RECOVERY_LABEL };
  if (b === null || b <= 0) return { value: null, ...base, reason: 'no balance before liquidation' };
  if (l === null) return { value: null, ...base, reason: 'no realized loss reported' };
  const L = Math.abs(l);
  return { value: round4(1 - L / b), ...base, ...(l === 0 ? { note: 'a zero loss as reported: proceeds covered the balance' } : {}), ...(l < 0 ? { lossReportedNegative: true } : {}), ...(L > b ? { lossExceedsBalance: true, note: 'the loss exceeds the balance: expenses and advances are in it' } : {}) };
}

export function cmbsPriceEvidence(d) {
  const begin = num(d.beginningScheduledBalance), prior = num(d.previousBalance);
  const balance = begin !== null && begin > 0 ? { value: begin, field: 'reportPeriodBeginningScheduleLoanBalanceAmount', period: d.period }
    : prior !== null && prior > 0 ? { value: prior, field: 'reportPeriodEndActualBalanceAmount, previous report', period: d.previousPeriod } : { value: null, field: null, period: null };
  return { balanceBeforeLiquidation: balance, realizedLoss: { value: num(d.realizedLossToTrust), field: 'realizedLossToTrustAmount' }, impliedRecovery: impliedRecovery({ balance: balance.value, loss: d.realizedLossToTrust }), isPrice: false };
}

// ---- Feeders: stored data -> events ----------------------------------------------------------------------------------------------
const instName = (institutions, failed, cert) => institutions?.[cert]?.NAME ?? failed?.[cert]?.name ?? `FDIC cert ${cert}`;
const typeLabel = (props, sectors) => {
  const inMarket = (props ?? []).filter((p) => p.metro && p.sector);
  const labels = [...new Set(inMarket.map((p) => p.type?.label).filter(Boolean))];
  return { propertyType: labels.length === 1 ? labels[0] : labels.length ? `Several: ${labels.join(', ')}` : null, sector: (sectors ?? []).length === 1 ? sectors[0] : (sectors ?? []).join(', ') || null };
};
const filingLink = (src, cik) => {
  const m = /^ABS-EE\s+(\d{10}-\d{2}-\d{6})(?:\s+(\S+))?$/.exec(String(src?.endpoint ?? ''));
  return m ? `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${m[1].replace(/-/g, '')}/${m[2] ?? ''}` : null;
};

export const cmbsFeeder = {
  source: 'edgar',
  build({ dir }) {
    const events = [], missing = [];
    for (const d of Object.values(readJson(edgarPaths(dir).dispositions, {}))) {
      const gaps = ['cik', 'assetNumber', 'trust'].filter((k) => !d?.[k]);
      if (!d?.liquidation?.code) gaps.push('liquidation.code');
      if (!d?.liquidationDate && !d?.period) gaps.push('liquidationDate or period');
      if (gaps.length) { missing.push(`${d?.key ?? '(no key)'}: ${gaps.join(', ')}`); continue; }
      const kind = d.noteSaleSeen ? 'note_sale_completed' : d.liquidation.code === '6' ? 'dpo' : 'disposition';
      const ss = d.specialServicer ? { kind: 'servicer', key: servicerKey(d.specialServicer), name: d.specialServicer, matched: d.specialServicerMatched ?? null } : null;
      const { propertyType, sector } = typeLabel(d.properties, d.sectors);
      const pe = cmbsPriceEvidence(d);
      const inMarket = (d.properties ?? []).filter((p) => p.metro && p.sector);
      const accession = /ABS-EE\s+(\S+)/.exec(String(d._source?.endpoint ?? ''))?.[1] ?? null;
      events.push({
        id: d.key, kind, date: d.liquidationDate ?? d.period, dateBasis: d.liquidationDate ? 'liquidationPrepaymentDate' : 'reporting period end (no liquidation date reported)',
        seller: { kind: 'trust', key: `cmbs-trust:${d.cik}`, name: d.trust, via: ss },
        buyer: { ...UNKNOWN },
        asset: { kind: 'loan', key: d.loanKey, propertyType, sector, metro: d.metros?.[0] ?? null, metros: d.metros ?? [], county: inMarket[0]?.county ?? null, balance: pe.balanceBeforeLiquidation.value,
          balanceBasis: pe.balanceBeforeLiquidation.field, properties: d.properties ?? [], contextOnly: true },
        priceEvidence: pe, tier: 'reported',
        sources: [{ source: 'edgar', ids: [accession, `${d.cik}:${d.assetNumber}`].filter(Boolean), link: filingLink(d._source, d.cik), date: d.period }],
        basis: `liquidationPrepaymentCode ${d.liquidation.code} (${d.liquidation.label})${d.noteSaleSeen ? ', after workoutStrategyCode 5 (note sale) in its history' : ''}`,
        ...(kind === 'disposition' ? { note: 'A disposition or liquidation: it may be a sale of the REO property or a foreclosure, not a note sale. The buyer is not reported.' } : {}),
        ...(kind === 'note_sale_completed' && d.liquidation.code === '6' ? { note: 'Reported as a DPO after a note-sale workout: check the servicer commentary before treating it as a note sale.' } : {}),
        contextOnly: true,
      });
    }
    return { events, missing };
  },
};

export const filingsFeeder = {
  source: 'filings',
  build({ dir, config }) {
    const want = new Set(config?.sales?.filingSearches ?? ['8k-acquisition', 'loan-sale-cre', 'note-sale-cre']);
    const institutions = readJson(fdicPaths(dir).institutions, {});
    const events = [], missing = [];
    for (const [key, list] of Object.entries(filingSignals({ dir }))) {
      for (const s of list) {
        const hit = (s.searches ?? []).filter((x) => want.has(x));
        if (!hit.length) continue;
        const gaps = ['accession', 'fileDate', 'link'].filter((k) => !s[k]);
        if (gaps.length) { missing.push(`${s.id ?? '(no id)'}: ${gaps.join(', ')}`); continue; }
        const cert = key.replace(/^fdic:/, '');
        const onlyItem = hit.every((x) => x === '8k-acquisition');
        events.push({
          id: `sec-sale:${s.accession}:${key}`, kind: 'bank_disclosed_sale', date: s.fileDate,
          seller: { kind: 'bank', key, name: instName(institutions, null, cert) }, buyer: { ...UNKNOWN },
          asset: { kind: 'unknown', propertyType: null, metro: null, balance: null }, tier: 'reported',
          sources: [{ source: 'filings', ids: [s.accession], link: s.link, date: s.fileDate }],
          filing: { form: s.form, items: s.items ?? [], searches: hit, cik: s.cik },
          note: onlyItem ? '8-K Item 2.01 reports a completed acquisition OR disposition of assets: the bank may have bought, not sold. A principal reads the filing.' : 'The filing mentions a loan or note sale and commercial real estate. What was sold, and to whom, is in the filing, which is not stored: a principal reads it.',
          contextOnly: true,
        });
      }
    }
    return { events, missing };
  },
};

export const fdicEventsFeeder = {
  source: 'fdic',
  build({ dir, config }) {
    const kinds = new Set(config?.sales?.acquisitionKinds ?? ['merger', 'assisted-merger', 'failure']);
    const p = fdicPaths(dir);
    const institutions = readJson(p.institutions, {}), failed = readJson(p.failed, {});
    const events = [], missing = [];
    for (const e of Object.values(readJson(p.events, {}))) {
      if (!kinds.has(e?.kind) || !e.targetInMetros || !e.acquirerCert) continue;
      const gaps = ['transnum', 'effective', 'targetCert'].filter((k) => !e[k]);
      if (gaps.length) { missing.push(`${e.transnum ?? '(no transnum)'}: ${gaps.join(', ')}`); continue; }
      const target = { kind: 'bank', key: `fdic:${e.targetCert}`, name: instName(institutions, failed, e.targetCert) };
      const cre = e.targetLastCre?.value;
      events.push({
        id: `fdic-deal:${e.transnum}`, kind: 'whole_bank_acquisition', date: e.effective,
        // A failed bank is sold by the FDIC as its receiver; any other target sold itself.
        seller: e.kind === 'failure' ? { ...FDIC_SELLER, receivershipOf: target } : target,
        buyer: { kind: 'bank', key: `fdic:${e.acquirerCert}`, name: instName(institutions, failed, e.acquirerCert) },
        asset: { kind: 'bank', key: target.key, propertyType: null, metro: (e.targetMetros ?? [])[0]?.cbsa ?? null, metros: (e.targetMetros ?? []).map((m) => m.cbsa),
          balance: cre === null || cre === undefined ? null : Number(cre) * 1000, balanceBasis: cre === null || cre === undefined ? null : `CRE at its last report (${e.targetLastCre.repdte}): LNRECONS + LNREMULT + LNRENRES, FDIC thousands × 1,000` },
        tier: 'reported', sources: [{ source: 'fdic', ids: [String(e.transnum)], link: `${FDIC_BASE}/history?filters=TRANSNUM:${e.transnum}`, date: e.effective }],
        deal: { code: e.code, label: e.label, kind: e.kind }, contextOnly: true,
      });
    }
    return { events, missing };
  },
};

export const fdicSalesFeeder = {
  source: 'fdicsales',
  build({ dir }) {
    const events = [], missing = [];
    for (const s of Object.values(readJson(fdicSalesPaths(dir).sales, {}))) {
      const date = s?.announcedOn ?? s?.eventDates?.start ?? s?.keyDates?.bidDeadline ?? null;
      const gaps = ['saleId', 'page'].filter((k) => !s?.[k]);
      if (!date) gaps.push('announcedOn, eventDates.start or keyDates.bidDeadline');
      if (gaps.length) { missing.push(`${s?.key ?? '(no key)'}: ${gaps.join(', ')}`); continue; }
      events.push({
        id: `fdic-sale:${s.saleId}`, kind: 'fdic_sale_announced', date,
        dateBasis: s.announcedOn ? 'announcement date (the announcement PDF)' : s.eventDates?.start ? 'start of the sale event (the sale page)' : 'bid deadline (the sale page)',
        seller: { ...FDIC_SELLER, receiverships: (s.receiverships ?? []).map((r) => ({ name: r.name, city: r.city, state: r.state, key: r.key ?? null, matchedBy: r.matchedBy ?? null, failedOn: r.failedOn ?? null, inMetros: r.inMetros ?? null, metros: r.metros ?? [] })) },
        buyer: { ...UNKNOWN },
        asset: { kind: 'pool', propertyType: null, metro: null, balance: num(s.upb), balanceBasis: num(s.upb) === null ? null : 'unpaid principal balance, as announced', loans: num(s.loans), description: s.portfolio ?? [] },
        tier: 'reported',
        sources: [{ source: 'fdicsales', ids: [s.saleId], link: s.page, date: s.pageUpdatedOn ?? null }, ...(s.pdf?.link ? [{ source: 'fdicsales', ids: [s.saleId, 'pdf'], link: s.pdf.link, date: s.announcedOn ?? null }] : [])],
        sale: { saleId: s.saleId, title: s.title, headline: s.headline, eventDates: s.eventDates, keyDates: s.keyDates, advisor: s.advisor ?? null, dataAsOf: s.dataAsOf ?? null },
        note: 'An announcement, not a result: the FDIC publishes no buyer on the pages read, so the buyer is unknown.', contextOnly: true,
      });
    }
    return { events, missing };
  },
};

export const FEEDERS = Object.freeze([cmbsFeeder, filingsFeeder, fdicEventsFeeder, fdicSalesFeeder]);

// ---- The later sources: shapes only, no adapter --------------------------------------------------------------------------------
// MERS (Mortgage Electronic Registration Systems) is named on many deeds of trust and assignments as nominee for the lender and its
// assigns. It holds legal title of record only; it is never the seller or the buyer. When the document names the lender MERS acts
// for ("as nominee for X"), X is the party; when it does not, the party is unknown.
const MERS_RE = /\bmortgage electronic registration systems?\b|\bm\.?\s?e\.?\s?r\.?\s?s\.?(?=\s|,|$)/i;
export const isMers = (name) => MERS_RE.test(String(name ?? ''));
// A party as recorded -> a ledger party. `kindOf(name)` is the feeder's match to an institution (E6-S1): { kind, key, name } or null.
// An unmatched name stays a named party of kind `other`; matching is never guessed here.
export function resolveParty(raw, { kindOf } = {}) {
  let name = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!name) return { ...UNKNOWN };
  let nominee = null;
  if (isMers(name)) {
    const forWhom = /\bas (?:a |the )?nominee for\s+(.+?)(?:,?\s+(?:its|and its|their) successors\b.*)?$/i.exec(name)?.[1]?.replace(/[.,;]+$/, '').trim();
    if (!forWhom || isMers(forWhom)) return { ...UNKNOWN, nominee: 'MERS', note: 'MERS is a nominee, not a party, and the document does not name the lender it acts for' };
    name = forWhom; nominee = 'MERS';
  }
  const m = kindOf?.(name) ?? null;
  return { kind: m?.kind ?? 'other', ...(m?.key ? { key: m.key } : {}), name: m?.name ?? name, ...(nominee ? { nominee } : {}) };
}
const partyFrom = (raw, kindOf) => resolveParty(raw, { kindOf });
const sameParty = (a, b) => !!a && !!b && a.kind !== 'unknown' && b.kind !== 'unknown' && (a.key && b.key ? a.key === b.key : a.name.toLowerCase() === b.name.toLowerCase());

// The chain from the original deed of trust to the current holder. Each step is one recorded assignment, oldest first. A step to
// MERS with no named lender leaves the holder as it was, marked uncertain; a step whose assignor is not the holder so far shows an
// unrecorded transfer (a gap). The current holder is certain only when every step is known and there is no gap.
export function chainToCurrentHolder({ deedOfTrust = {}, assignments = [], kindOf } = {}) {
  let holder = deedOfTrust.beneficiary ? partyFrom(deedOfTrust.beneficiary, kindOf) : { ...UNKNOWN };
  let certain = holder.kind !== 'unknown';
  const chain = [];
  const steps = [...assignments].sort((a, b) => String(a.date ?? '').localeCompare(String(b.date ?? '')) || String(a.recordingNumber ?? '').localeCompare(String(b.recordingNumber ?? '')));
  for (const s of steps) {
    const from = partyFrom(s.assignor, kindOf), to = partyFrom(s.assignee, kindOf);
    const gap = holder.kind !== 'unknown' && from.kind !== 'unknown' && !sameParty(holder, from);
    const nomineeOnly = to.kind === 'unknown' && to.nominee === 'MERS';
    chain.push({ recordingNumber: s.recordingNumber ?? null, date: s.date ?? null, from, to, ...(gap ? { gap: true } : {}), ...(nomineeOnly ? { nomineeOnly: true } : {}) });
    if (gap || from.kind === 'unknown') certain = false;
    if (nomineeOnly) { certain = false; continue; }
    holder = to;
    if (to.kind === 'unknown') certain = false;
  }
  return { chain, currentHolder: holder, certain };
}

// The `assignment` event, to be fed by the Maricopa Recorder's bulk feed or ATTOM (docs/county-playbook.md). Observed, not reported:
// it is built from a recorded document we can see. The assignor sold the loan and the assignee bought it, through MERS where named.
export function assignmentEvent({ county, recordingNumber, recordedOn, apn = null, deedOfTrust = {}, assignor, assignee, priorAssignments = [], source, link = null, propertyType = null, metro = null, kindOf }) {
  const seller = partyFrom(assignor, kindOf), buyer = partyFrom(assignee, kindOf);
  const c = chainToCurrentHolder({ deedOfTrust, assignments: [...priorAssignments, { recordingNumber, date: recordedOn, assignor, assignee }], kindOf });
  return {
    id: `assignment:${county}:${recordingNumber}`, kind: 'assignment', date: recordedOn, seller, buyer,
    asset: { kind: 'loan', propertyType, county, metro, balance: num(deedOfTrust.originalPrincipal), balanceBasis: num(deedOfTrust.originalPrincipal) === null ? null : 'original principal on the deed of trust' },
    tier: 'observed', sources: [{ source, ids: [String(recordingNumber)], link, date: recordedOn }],
    assignment: { county, recordingNumber: String(recordingNumber), apn, deedOfTrust: { recordingNumber: deedOfTrust.recordingNumber ?? null, recordedOn: deedOfTrust.recordedOn ?? null, originalPrincipal: num(deedOfTrust.originalPrincipal), beneficiaryAsRecorded: deedOfTrust.beneficiary ?? null },
      assignorAsRecorded: assignor ?? null, assigneeAsRecorded: assignee ?? null, chain: c.chain, currentHolder: c.currentHolder, chainCertain: c.certain },
    contextOnly: true,
  };
}

// The `marketed_listing` event, for loan-sale listings (a listing site or a loan-sale advisor's sale notices). The seller is usually
// not named; the buyer is unknown, since a listing is an offer, not a sale.
export function listingEvent({ site, listingId, listedOn, title = null, link = null, seller = null, advisor = null, propertyType = null, metro = null, county = null, balance = null, loans = null, status = null, lien = null, bidDate = null }) {
  return {
    id: `listing:${site}:${listingId}`, kind: 'marketed_listing', date: listedOn, seller: seller ?? { ...UNKNOWN }, buyer: { ...UNKNOWN },
    asset: { kind: num(loans) > 1 ? 'pool' : 'loan', propertyType, metro, county, balance: num(balance), loans: num(loans) },
    tier: 'observed', sources: [{ source: `listing:${site}`, ids: [String(listingId)], link, date: listedOn }],
    listing: { site, listingId: String(listingId), title, advisor, status, lien, bidDate }, contextOnly: true,
  };
}

// ---- Building the ledger -----------------------------------------------------------------------------------------------------
const mergeSources = (a, b) => ({ ...a, sources: [...new Map([...a.sources, ...b.sources].map((s) => [`${s.source}|${s.link}|${s.ids.join(',')}`, s])).values()] });
const byDateDesc = (a, b) => (String(b.date).localeCompare(String(a.date)) || String(a.id).localeCompare(String(b.id)));

// Rebuilds sales/ledger.json from stored data. Every event is checked first; a feeder input missing a required field, or an event
// that fails validateEvent, fails the build and writes nothing but the run-log line. An event already in the ledger keeps its
// firstSeenAt. One that no stored record supports any more (a filer mapping rejected since, say) is kept, marked supported: false,
// and left out of every view and signal until a later build supports it again.
export function buildLedger({ dir, config = {}, feeders = FEEDERS, now = new Date(), clock = () => new Date() }) {
  const run = startRun({ source: 'sales', query: { feeders: feeders.map((f) => f.source).sort() }, now });
  const at = now.toISOString();
  const built = new Map(), missing = [], invalid = [], bySource = {};
  try {
    for (const f of feeders) {
      const r = f.build({ dir, config });
      bySource[f.source] = r.events.length;
      missing.push(...(r.missing ?? []).map((m) => `${f.source} ${m}`));
      for (const ev of r.events) {
        const errs = validateEvent(ev);
        if (errs.length) { invalid.push(`${ev?.id ?? '(no id)'}: ${errs.join('; ')}`); continue; }
        built.set(ev.id, built.has(ev.id) ? mergeSources(built.get(ev.id), ev) : ev);
      }
    }
  } catch (e) {
    const line = finishRun(dir, run, { outcome: 'failed', errors: [String(e.message).slice(0, 300)], now: clock() });
    return { runId: run.runId, outcome: line.outcome, errors: line.errors };
  }
  if (missing.length || invalid.length) {
    const line = finishRun(dir, run, { rowsRead: built.size, outcome: 'failed', missingFields: missing.slice(0, 50), errors: [`${missing.length} stored record(s) lack a required field and ${invalid.length} event(s) failed the event checks${invalid.length ? `: ${invalid.slice(0, 5).join(' | ')}` : ''}. Nothing was written.`], now: clock() });
    return { runId: run.runId, outcome: line.outcome, missingFields: missing, invalid, errors: line.errors };
  }
  const p = salesPaths(dir);
  const prev = readJson(p.ledger, null)?.events ?? {};
  const next = {};
  let changed = 0, added = 0, unsupported = 0;
  for (const [id, ev] of built) {
    const old = prev[id];
    const rec = { ...ev, supported: true, firstSeenAt: old?.firstSeenAt ?? at, firstRunId: old?.firstRunId ?? run.runId,
      _source: sourceBlock({ source: 'sales', endpoint: 'sales build', query: { from: [...new Set(ev.sources.map((s) => s.source))] }, recordId: id, period: ev.date, fetchedAt: at, runId: run.runId }) };
    const u = upsertWithChanges(old, rec, { key: id, runId: run.runId, dir, now, contextFields: ['asset'] });
    delete u.record.unsupportedSince;
    next[id] = u.record; changed += u.changed;
    if (!old) added++;
  }
  for (const [id, old] of Object.entries(prev)) {
    if (built.has(id)) continue;
    unsupported++;
    if (old.supported === false) { next[id] = old; continue; }
    next[id] = { ...old, supported: false, unsupportedSince: at };
    appendJsonl(CHANGES(dir), scrub({ runId: run.runId, key: id, field: 'supported', old: true, new: false, at }));
    changed++;
  }
  const events = Object.fromEntries(Object.values(next).sort(byDateDesc).map((e) => [e.id, e]));
  const byKind = {};
  for (const e of Object.values(events)) if (e.supported !== false) byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
  const counts = { events: Object.keys(events).length, supported: Object.keys(events).length - unsupported, added, changed, unsupported, bySource, byKind };
  writeJson(p.ledger, { builtAt: at, runId: run.runId, counts, events });
  const line = finishRun(dir, run, { rowsRead: built.size, rowsWritten: added, rowsChanged: changed, outcome: 'ok', notes: [`${built.size} event(s) built (${Object.entries(bySource).map(([k, v]) => `${k} ${v}`).join(', ')}); ${added} new; ${unsupported} no longer supported by stored data`], now: clock() });
  return { runId: run.runId, outcome: line.outcome, ...counts };
}

// ---- Views (pure, over a ledger) ----------------------------------------------------------------------------------------------
export const readLedger = (dir) => readJson(salesPaths(dir).ledger, { events: {} });
export const eventsOf = (ledger, { all = false } = {}) => Object.values(ledger?.events ?? {}).filter((e) => all || e.supported !== false).sort(byDateDesc);
// The institution that acted for the seller: a CMBS trust sells through its special servicer.
export const actingSeller = (e) => e?.seller?.via ?? e?.seller ?? null;

export function listSales(ledger, { seller, kind } = {}) {
  return eventsOf(ledger).filter((e) => (!kind || e.kind === kind) && (!seller || [e.seller?.key, e.seller?.via?.key, e.seller?.receivershipOf?.key].includes(seller)));
}

// "Has sold before": for each seller, by the institution that acted, the count by kind, the latest date and the events.
export function groupBySeller(ledger) {
  const by = new Map();
  for (const e of eventsOf(ledger)) {
    const s = actingSeller(e);
    if (!s || s.kind === 'unknown') continue;
    const k = s.key ?? `name:${s.name}`;
    const g = by.get(k) ?? { key: s.key ?? null, kind: s.kind, name: s.name, ...(s.kind === 'servicer' ? { matched: s.matched ?? null } : {}), counts: {}, total: 0, latest: null, events: [] };
    g.counts[e.kind] = (g.counts[e.kind] ?? 0) + 1; g.total++;
    if (!g.latest || e.date > g.latest) g.latest = e.date;
    g.events.push(e);
    by.set(k, g);
  }
  return [...by.values()].sort((a, b) => String(b.latest).localeCompare(String(a.latest)) || b.total - a.total || a.name.localeCompare(b.name));
}

const quarterOf = (d) => { const m = /^(\d{4})-(\d{2})/.exec(String(d ?? '')); return m ? `${m[1]}-Q${Math.ceil(Number(m[2]) / 3)}` : 'unknown'; };
const bump = (o, k) => { o[k] = (o[k] ?? 0) + 1; };

// Known buyers: every event whose buyer a source names, by buyer, with counts by kind, property type, metro and quarter.
export function groupBuyers(ledger) {
  const by = new Map();
  for (const e of eventsOf(ledger)) {
    const b = e.buyer;
    if (!b || b.kind === 'unknown') continue;
    const k = b.key ?? `name:${b.name}`;
    const g = by.get(k) ?? { key: b.key ?? null, kind: b.kind, name: b.name, total: 0, byKind: {}, byPropertyType: {}, byMetro: {}, byPeriod: {}, latest: null, events: [] };
    g.total++; bump(g.byKind, e.kind); bump(g.byPropertyType, e.asset?.propertyType ?? 'not stated'); bump(g.byPeriod, quarterOf(e.date));
    for (const m of (e.asset?.metros?.length ? e.asset.metros : [e.asset?.metro ?? e.asset?.county ?? 'not stated'])) bump(g.byMetro, m ?? 'not stated');
    if (!g.latest || e.date > g.latest) g.latest = e.date;
    g.events.push(e.id);
    by.set(k, g);
  }
  return [...by.values()].sort((a, b) => b.total - a.total || String(b.latest).localeCompare(String(a.latest)) || a.name.localeCompare(b.name));
}

// Price evidence: CMBS liquidations by property type and metro, with the approximate implied recovery. The group figure is
// 1 − Σ loss ÷ Σ balance over the events that have both. Labelled approximate; never a price.
export function pricing(ledger) {
  const rows = eventsOf(ledger).filter((e) => e.priceEvidence).map((e) => ({
    id: e.id, kind: e.kind, date: e.date, propertyType: e.asset?.propertyType ?? 'not stated', sector: e.asset?.sector ?? null, metro: e.asset?.metro ?? null,
    seller: actingSeller(e)?.name ?? null, balance: e.priceEvidence.balanceBeforeLiquidation?.value ?? null, loss: e.priceEvidence.realizedLoss?.value ?? null,
    impliedRecovery: e.priceEvidence.impliedRecovery,
  }));
  const groups = new Map();
  for (const r of rows) {
    const k = `${r.propertyType}|${r.metro ?? ''}`;
    const g = groups.get(k) ?? { propertyType: r.propertyType, metro: r.metro, events: 0, withRecovery: 0, balance: 0, loss: 0, min: null, max: null, kinds: {} };
    g.events++; bump(g.kinds, r.kind);
    if (r.impliedRecovery?.value !== null && r.impliedRecovery?.value !== undefined) {
      g.withRecovery++; g.balance += r.balance; g.loss += Math.abs(r.loss);
      g.min = g.min === null ? r.impliedRecovery.value : Math.min(g.min, r.impliedRecovery.value);
      g.max = g.max === null ? r.impliedRecovery.value : Math.max(g.max, r.impliedRecovery.value);
    }
    groups.set(k, g);
  }
  return {
    label: RECOVERY_LABEL,
    groups: [...groups.values()].map((g) => ({ ...g, impliedRecovery: g.withRecovery ? { value: round4(1 - g.loss / g.balance), approximate: true, label: RECOVERY_LABEL } : { value: null, approximate: true, label: RECOVERY_LABEL, reason: 'no event here has both a balance and a loss' } }))
      .sort((a, b) => b.events - a.events || a.propertyType.localeCompare(b.propertyType) || String(a.metro).localeCompare(String(b.metro))),
    rows,
  };
}

// ---- Signals for scoring ---------------------------------------------------------------------------------------------------------
// Event signals by institution key (fdic:CERT, or servicer:<slug>), shaped like filingSignals in src/sources/filings.mjs: each one
// is recorded once, dated, and kept. Labels come from fixed templates, never from a document; no name, property or address is in
// one. Only sellers get a signal ("has sold before"); an FDIC receivership is not an institution we approach, so it gets none.
// The coordinator wires these into scoring; nothing here adds points.
const SIGNAL_LABEL = {
  note_sale_completed: (e) => `A CMBS loan it special-services was liquidated after a note-sale workout (reported ${e.date})`,
  dpo: (e) => `A CMBS loan it special-services was resolved by a discounted payoff (reported ${e.date})`,
  disposition: (e) => `A CMBS loan it special-services was liquidated: a disposition, which may be an REO sale or a foreclosure (reported ${e.date})`,
  bank_disclosed_sale: (e) => `An SEC filing disclosed a completed sale or disposition (${e.filing?.form ?? 'filing'}, filed ${e.date})`,
  whole_bank_acquisition: (e) => `Was acquired by FDIC cert ${String(e.buyer?.key ?? '').replace(/^fdic:/, '')}, effective ${e.date}`,
  assignment: (e) => `Assigned a deed of trust of record (recorded ${e.date})`,
  marketed_listing: (e) => `Listed a loan or pool for sale (listed ${e.date})`,
};
export const SIGNAL_KEY = /^(?:fdic:\d+|servicer:[a-z0-9-]+)$/;

export function signalsFromLedger(ledger) {
  const out = {};
  for (const e of eventsOf(ledger)) {
    const s = actingSeller(e);
    if (!s?.key || !SIGNAL_KEY.test(s.key) || !SIGNAL_LABEL[e.kind]) continue;
    (out[s.key] ??= []).push({
      id: `sale:${e.id}`, kind: 'event', type: 'sale', source: 'sales', key: s.key, role: 'seller', saleKind: e.kind, tier: e.tier,
      date: e.date, period: e.date, label: SIGNAL_LABEL[e.kind](e), link: e.sources?.[0]?.link ?? null, evidence: [e.id], firstSeenAt: e.firstSeenAt ?? null,
    });
  }
  for (const list of Object.values(out)) list.sort((a, b) => String(b.date).localeCompare(String(a.date)) || a.id.localeCompare(b.id));
  return out;
}

// ---- The same views, from a data folder ------------------------------------------------------------------------------------------
export const saleSignals = ({ dir }) => signalsFromLedger(readLedger(dir));
export const salesBySeller = ({ dir }) => groupBySeller(readLedger(dir));
export const knownBuyers = ({ dir }) => groupBuyers(readLedger(dir));
export const priceEvidence = ({ dir }) => pricing(readLedger(dir));
export const salesList = ({ dir, seller, kind }) => listSales(readLedger(dir), { seller, kind });

// ---- Checking the ledger (read-only, no network) ---------------------------------------------------------------------------------
const check = (id, ok, summary, detail) => ({ id, ok: !!ok, summary, ...(detail ? { detail } : {}) });
export function verifyLedger({ dir, sample = 5 }) {
  const ledger = readJson(salesPaths(dir).ledger, null);
  if (!ledger) return { source: 'sales', checks: [check('sales.present', false, 'No ledger yet. Run: outbound sales build')], sample: [] };
  const all = Object.entries(ledger.events ?? {});
  const checks = [];
  const badId = all.filter(([k, e]) => k !== e.id);
  const invalid = all.map(([, e]) => [e.id, validateEvent(e)]).filter(([, errs]) => errs.length);
  checks.push(check('sales.events', !badId.length && !invalid.length, invalid.length || badId.length ? `${invalid.length + badId.length} of ${all.length} events fail the event checks.` : `All ${all.length} events pass the event checks: stable id, kind, date, seller, buyer, asset, tier and sources.`, invalid.length || badId.length ? { invalid: invalid.slice(0, 10), badId: badId.map(([k]) => k).slice(0, 10) } : undefined));
  const named = all.filter(([, e]) => e.buyer?.kind !== 'unknown' && !BUYER_NAMED.has(e.kind));
  const priced = all.filter(([, e]) => e.priceEvidence && (e.priceEvidence.isPrice !== false || e.priceEvidence.impliedRecovery?.approximate !== true));
  checks.push(check('sales.no-invention', !named.length && !priced.length, `${all.filter(([, e]) => e.buyer?.kind !== 'unknown').length} event(s) name a buyer, all from a source that names one; every implied recovery (${all.filter(([, e]) => e.priceEvidence).length}) is labelled approximate and none is a price.${named.length || priced.length ? ` Failing: ${[...named, ...priced].map(([k]) => k).slice(0, 10).join(', ')}` : ''}`));
  // Property names are kept in the ledger for a principal, and must never reach a log.
  const names = [...new Set(all.flatMap(([, e]) => (e.asset?.properties ?? []).map((pp) => pp.name).filter((n) => n && n.length >= 6)))];
  const logs = JSON.stringify(readJsonl(RUNS(dir))) + JSON.stringify(readJsonl(CHANGES(dir)));
  const leaked = names.filter((n) => logs.includes(n));
  checks.push(check('sales.context', all.every(([, e]) => e.contextOnly === true) && !leaked.length, `${all.filter(([, e]) => e.contextOnly === true).length} of ${all.length} events are marked context only. ${names.length} property name(s) are kept for a principal; ${leaked.length ? `${leaked.length} appear in the run or change log, which they must not.` : 'none appears in the run or change log.'}`));
  const unsupported = all.filter(([, e]) => e.supported === false).length;
  const rows = eventsOf(ledger).slice(0, sample).map((e) => ({ id: e.id, kind: e.kind, date: e.date, seller: actingSeller(e)?.key ?? actingSeller(e)?.name, buyer: e.buyer?.key ?? e.buyer?.name, check: e.sources?.[0]?.link ?? null }));
  if (unsupported) checks.push({ ...check('sales.supported', true, `${unsupported} event(s) are no longer supported by stored data and are left out of views and signals.`), warn: true });
  return { source: 'sales', checks, sample: rows };
}
