// The candidate list (PRD E6-S1, E6-S3, E6-S4, E6-S8): matching names to institutions, the "why now" card, and a principal's decisions.
// Scores and the paper profile come from score.mjs. The card is built in code from fixed sentence templates filled only with computed
// values, with no model: each sentence carries the ids of the records and signals it states, so a card cannot claim anything the data
// does not show. No code path here creates an account without a principal's name, and a suppressed institution is never listed or promoted.
import { join } from 'node:path';
import { readJson, writeJson, listFiles, exists, audit, safeId } from './store.mjs';
import { norm } from './guard.mjs';
import { METRICS, SIGNAL_TYPES, DENOMINATORS, periodLabel } from './metrics.mjs';

const C = (dir, f) => join(dir, 'candidates', f);
const ymd = (d) => new Date(d).toISOString().slice(0, 10);
const phrase = (hayNorm, needleNorm) => needleNorm.length > 1 && ` ${hayNorm} `.includes(` ${needleNorm} `);
const requireBy = (by) => { if (typeof by !== 'string' || !by.trim() || by === 'true') throw new Error('A principal\'s name is required (--by NAME). Nothing is promoted, dismissed or snoozed without one.'); return by.trim(); };

export const loadLatest = (dir) => { const l = readJson(C(dir, 'latest.json'), null); if (!l) throw new Error('No candidate list yet. Run: outbound score run'); return l; };
export const loadDecisions = (dir) => readJson(C(dir, 'decisions.json'), {});
export const loadAliases = (dir) => readJson(C(dir, 'aliases.json'), {});

// ---- Matching (E6-S1) -----------------------------------------------------------------------------------------------------------
// Exact normalized name or a known alias matches. Anything fuzzier comes back as suggestions for a principal; nothing is merged.
const STOP = new Set(['the', 'of', 'and', 'na', 'n', 'a', 'national', 'association', 'inc', 'co', 'company']);
const tokens = (s) => new Set(norm(s).split(' ').filter((t) => t && !STOP.has(t)));
const jaccard = (a, b) => { const x = tokens(a); const y = tokens(b); if (!x.size || !y.size) return 0; let n = 0; for (const t of x) if (y.has(t)) n++; return n / (x.size + y.size - n); };

export function matchInstitution(name, { institutions = {}, aliases = {} } = {}) {
  const q = norm(name);
  if (!q) return { key: null, how: 'empty', suggestions: [] };
  for (const [cert, inst] of Object.entries(institutions)) if (norm(inst?.NAME) === q) return { key: `fdic:${cert}`, how: 'exact', suggestions: [] };
  for (const [key, list] of Object.entries(aliases)) if ((list ?? []).some((a) => norm(a) === q)) return { key, how: 'alias', suggestions: [] };
  const suggestions = Object.entries(institutions)
    .map(([cert, inst]) => ({ key: `fdic:${cert}`, name: inst?.NAME ?? '', similarity: Math.round(jaccard(name, inst?.NAME) * 100) / 100 }))
    .filter((s) => s.similarity >= 0.5).sort((a, b) => b.similarity - a.similarity || (a.key < b.key ? -1 : 1)).slice(0, 5);
  return { key: null, how: suggestions.length ? 'needs_review' : 'none', suggestions };
}

export function addAlias({ dir, key, alias, by }) {
  by = requireBy(by);
  if (!key || !alias) throw new Error('Both a key (fdic:<CERT>) and an alias are required.');
  const all = loadAliases(dir);
  all[key] = [...new Set([...(all[key] ?? []), String(alias)])];
  writeJson(C(dir, 'aliases.json'), all);
  audit(dir, { type: 'alias_added', key, by });
  return all[key];
}

// ---- Suppression ----------------------------------------------------------------------------------------------------------------
// The same institution rule as the guard: the suppressed name, any of its aliases or affiliates, or the FDIC key.
export function suppressedBy(item, suppression = [], aliasTable = {}) {
  const names = [item.name, ...(aliasTable[item.key] ?? [])].map(norm).filter(Boolean);
  for (const e of suppression) {
    if (e?.type !== 'institution') continue;
    if (e.cert !== undefined && String(e.cert) === String(item.cert)) return e;
    for (const v of [e.value, ...(e.aliases ?? []), ...(e.affiliates ?? [])]) {
      const nv = norm(v);
      if (!nv) continue;
      if (nv === norm(item.key) || names.some((n) => n === nv || (nv.length > 3 && phrase(n, nv)))) return e;
    }
  }
  return null;
}

// ---- The "why now" card (E6-S3) -------------------------------------------------------------------------------------------------
// Fixed templates, in a fixed order: the period, then fit (the paper the buy box buys, and where the bank is), then distress, then
// timing (signals). Inputs are numbers computed in code, labels defined in code, metro labels from metros.json and the FDIC institution
// name. Nothing free-text from a source or a config label reaches a sentence, so no property, borrower or filing can be named.
const pct = (v, d = 2) => `${(v * 100).toFixed(d)}%`;
const pts = (v) => `${Math.abs(v * 100).toFixed(2)} percentage points`;
const money = (k) => { const s = k < 0 ? 'minus ' : ''; const a = Math.abs(k); return a >= 1e6 ? `${s}$${(a / 1e6).toFixed(1)} billion` : a >= 1e3 ? `${s}$${(a / 1e3).toFixed(1)} million` : `${s}$${a} thousand`; };
const fmtMetric = (metric, v) => (METRICS[metric]?.kind === 'amount' ? money(v) : pct(v));

export function buildCard(item, { scoring = {} } = {}) {
  const L = item.latestRepdte;
  if (!L) return null;
  const lim = { maxCategories: 2, maxDistress: 2, maxSignals: 3, maxEvents: 2, ...(scoring.card ?? {}) };
  const rec = (rep) => `fdic:${item.cert}:${rep}`;
  const period = periodLabel(L);
  const S = [];
  const add = (text, evidence) => S.push({ text, evidence: [...new Set(evidence)] });

  add(`${item.name}: Call Report data as of ${period}.`, [rec(L)]);

  // Fit: the categories the buy box buys, the most distressed first (then the larger share of the CRE book).
  const profile = item.profile ?? { categories: [], footprint: { metros: [] } };
  const nc = (c) => (c.noncurrentRatio === null ? -1 : c.noncurrentRatio);
  const cats = profile.categories.filter((c) => c.fit?.buys && c.balance?.value > 0 && c.shareOfCre?.value !== null)
    .sort((a, b) => (nc(b) - nc(a)) || (b.shareOfCre.value - a.shareOfCre.value) || (a.id < b.id ? -1 : 1)).slice(0, lim.maxCategories);
  for (const c of cats) {
    let t = `${c.short} loans are ${pct(c.shareOfCre.value)} of its CRE book (${money(c.balance.value)})`;
    const ev = [rec(L)];
    if (c.noncurrentRatio !== null) {
      const d = c.direction4q;
      t += `; their noncurrent ratio is ${pct(c.noncurrentRatio)}`;
      if (d.direction === 'rising' || d.direction === 'falling') { t += `, ${d.direction === 'rising' ? 'up' : 'down'} from ${pct(d.from.value)} four quarters earlier`; ev.push(rec(d.from.repdte)); }
      else if (d.direction === 'flat') { t += ', about the same as four quarters earlier'; ev.push(rec(d.from.repdte)); }
    }
    t += '.';
    if (c.sectors.length > 1) t += ' This category also holds office and other commercial loans, and the data cannot separate hotel or retail loans.';
    add(t, ev);
  }
  if (!cats.length) add('None of its CRE categories is one the buy box buys in its metros.', [rec(L)]);
  const fm = (profile.footprint?.metros ?? []).filter((m) => m.inBuybox && m.branches?.value > 0);
  if (fm.length) {
    const share = profile.footprint.buyboxDepositShare;
    const yr = profile.footprint.sodYear;
    add(`Branches in the buy-box metros: ${fm.map((m) => `${m.branches.value} in ${m.label}`).join(', ')}${share !== null && share !== undefined ? `; ${pct(share, 0)} of its deposits are there (Summary of Deposits, June 30, ${yr})` : ''}.`,
      [`fdic-locations:${item.cert}`, ...(share !== null && share !== undefined ? [`fdic-sod:${item.cert}:${yr}`] : [])]);
  }

  // Distress: the strongest distress components.
  const dist = (item.components ?? []).filter((c) => c.axis === 'distress' && c.value !== null && c.points > 0)
    .sort((a, b) => (b.points - a.points) || (a.id < b.id ? -1 : 1)).slice(0, lim.maxDistress);
  const statedLevels = new Set();
  for (const c of dist) {
    const change = !!c.change;
    if (!change) statedLevels.add(c.metric);
    add(`${c.label}: ${change ? `${c.value < 0 ? 'down' : 'up'} ${pts(c.value)}` : pct(c.value)}.`, [...new Set(c.inputs.map((x) => x.repdte).filter(Boolean))].map(rec));
  }

  // Pressure: the concentration screen (state signals), each naming the capital figure it divided by. The denominator's words come
  // from code (DENOMINATORS), never from the stored signal.
  const conc = (item.signals ?? []).filter((x) => x.rule === 'concentration' && x.value !== null && x.value !== undefined);
  for (const s of conc) {
    const den = DENOMINATORS[s.denominator?.basis]?.label;
    if (!den) continue;
    if (s.test === 'construction') add(`Construction and land loans are ${pct(s.value, 0)} of ${den}, at or above the ${pct(s.threshold, 0)} concentration screen (${period}).`, [s.id, ...s.evidence]);
    else if (s.test === 'cre' && s.growth !== null && s.growth !== undefined) add(`CRE loans as the 2006 interagency guidance counts them are ${pct(s.value, 0)} of ${den}, at or above ${pct(s.threshold, 0)}, and grew ${pct(s.growth, 0)} from ${periodLabel(s.baseRepdte)} to ${period}, at or above ${pct(s.growthThreshold, 0)}.`, [s.id, ...s.evidence]);
  }
  if (conc.length) add('The concentration screen follows the 2006 interagency guidance as we understand it; its definition is not yet confirmed against the guidance text.', conc.map((s) => s.id));

  // Structure events (event signals): an acquisition of a bank with a presence in the metros, dated, with the target's FDIC cert.
  for (const s of (item.signals ?? []).filter((x) => x.rule === 'acquisition').slice(0, lim.maxEvents)) {
    const where = (s.metros ?? []).filter((m) => m.label).map((m) => (m.branches ? `${m.branches} branch${m.branches === 1 ? '' : 'es'} in ${m.label}` : `its main office in ${m.label}`));
    if (!where.length || !/^\d+$/.test(String(s.targetCert)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(s.effective))) continue;
    const when = periodLabel(s.effective.replace(/-/g, ''));
    const places = where.length > 1 ? `${where.slice(0, -1).join(', ')} and ${where.at(-1)}` : where[0];
    let t = s.eventKind === 'failure'
      ? `It took over a failed bank (FDIC cert ${s.targetCert}) with ${places}, effective ${when}.`
      : `It acquired another bank (FDIC cert ${s.targetCert}) with ${places}, effective ${when}.`;
    const cre = s.targetLastCre;
    if (cre?.value !== null && cre?.value !== undefined && /^\d{8}$/.test(String(cre.repdte))) t += ` That bank held ${money(cre.value)} of CRE loans at its last report (${periodLabel(cre.repdte)}).`;
    add(t, [s.id, ...s.evidence, ...(cre?.repdte ? [`fdic:${s.targetCert}:${cre.repdte}`] : [])]);
  }

  // SEC filings (event signals, E13-S1): which saved searches a filing matched, its form and file date. The label is built from
  // filings.json labels and the filing's metadata only; no filing text is ever stored.
  for (const s of (item.signals ?? []).filter((x) => x.rule === 'filing').slice(0, lim.maxFilings ?? lim.maxEvents ?? 2)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s.fileDate)) || !s.label) continue;
    add(`An SEC filing matched a saved search: ${s.label}.`, [s.id, ...(s.evidence ?? [])]);
  }

  // Timing: the metric signals that fired at this quarter, each from its rule type's template. A threshold signal for a level already stated adds nothing.
  for (const s of (item.signals ?? []).filter((x) => SIGNAL_TYPES.includes(x.rule) && !(x.rule === 'above' && statedLevels.has(x.metric))).slice(0, lim.maxSignals)) {
    const label = METRICS[s.metric]?.label;
    if (!label || s.value === null || s.value === undefined) continue;
    let t;
    if (s.rule === 'rising') t = s.quarters > 1 ? `${label} rose in each of the last ${s.quarters} quarters, to ${fmtMetric(s.metric, s.value)}.` : `${label} rose from the prior quarter, to ${fmtMetric(s.metric, s.value)}.`;
    else if (s.rule === 'firstPositive') t = `${label}: above zero for the first time in ${s.lookback} quarters (${fmtMetric(s.metric, s.value)}).`;
    else if (s.rule === 'above') t = `${label}: ${fmtMetric(s.metric, s.value)}, at or above ${fmtMetric(s.metric, s.threshold)}.`;
    else if (s.rule === 'changeAbove') t = `${label} rose ${pts(s.change)} from ${s.over === 'yoy' ? 'four quarters earlier' : 'the prior quarter'}, to ${fmtMetric(s.metric, s.value)}.`;
    else continue;
    add(t, [s.id, ...s.evidence]);
  }
  return { text: S.map((s) => s.text).join(' '), sentences: S, period };
}

// ---- The list and a principal's decisions (E6-S4) ------------------------------------------------------------------------------
// Suppressed institutions never appear, not even with `all`. Promoted ones leave the list. Dismissed ones return only when a signal
// fires that was not present at the dismissal. Snoozed ones return on their date.
export function listCandidates({ dir, suppression = [], now = new Date(), tiers = ['A', 'B'], all = false }) {
  const latest = loadLatest(dir);
  const decisions = loadDecisions(dir);
  const aliases = loadAliases(dir);
  const today = ymd(now);
  const items = [];
  for (const it of latest.items) {
    if (suppressedBy(it, suppression, aliases)) continue;
    if (!all && !tiers.includes(it.tier)) continue;
    const d = decisions[it.key];
    let status = 'new';
    if (d?.status === 'promoted') status = 'promoted';
    else if (d?.status === 'dismissed') status = it.signals.some((s) => !(d.signalIds ?? []).includes(s.id)) ? 'returned' : 'dismissed';
    else if (d?.status === 'snoozed') status = today < d.until ? 'snoozed' : 'new';
    if (!all && ['promoted', 'dismissed', 'snoozed'].includes(status)) continue;
    items.push({ ...it, status, decision: d ?? null });
  }
  const failedBanks = (latest.failedBanks ?? []).filter((f) => !suppressedBy({ key: f.key, cert: f.cert, name: f.name }, suppression, aliases));
  return { runId: latest.runId, latestRepdte: latest.latestRepdte, provisional: !!latest.provisional, placeholders: latest.placeholders ?? [], items, failedBanks };
}

export function getCandidate({ dir, key }) {
  const it = loadLatest(dir).items.find((i) => i.key === key);
  if (!it) throw new Error(`No candidate "${key}" in the latest list. Keys look like fdic:<CERT>.`);
  return it;
}

function decide(dir, key, record) {
  const all = loadDecisions(dir);
  all[key] = record;
  writeJson(C(dir, 'decisions.json'), all);
}

// Which buy-box sector a first message should lead with (E6-S8). Set only when the most distressed category the buy box buys maps to
// exactly one sector: multifamily does. Nonfarm nonresidential holds hotel, retail, office and more, which the data cannot separate,
// so it never sets a lead sector on its own; a principal chooses from the options. Construction is not a buy-box sector.
export function leadSectorFor(profile) {
  const bought = (profile?.categories ?? []).filter((c) => c.fit?.buys);
  const options = (cats) => [...new Set(cats.flatMap((c) => c.fit.sectors))];
  const distressed = bought.filter((c) => c.noncurrentRatio !== null && c.noncurrentRatio > 0)
    .sort((a, b) => (b.noncurrentRatio - a.noncurrentRatio) || ((b.balance.value ?? 0) - (a.balance.value ?? 0)) || (a.id < b.id ? -1 : 1));
  if (!distressed.length) return { leadSector: null, leadSectorOptions: options(bought), basis: null, note: 'No category the buy box buys shows noncurrent loans. A principal chooses the sector to lead with.' };
  const best = distressed[0];
  if (best.sectors.length === 1 && best.fit.sectors.length === 1) return { leadSector: best.fit.sectors[0], leadSectorOptions: [best.fit.sectors[0]], basis: best.id, note: `${best.short} is the most distressed category the buy box buys.` };
  return { leadSector: null, leadSectorOptions: best.fit.sectors, basis: best.id, note: `The most distressed category the buy box buys is ${best.short.toLowerCase()}, which holds hotel, retail, office and other commercial loans that Call Report data cannot separate. A principal chooses which sector to lead with${best.fit.sectors.length ? ` (${best.fit.sectors.join(' or ')})` : ''}.` };
}

const slug = (s) => norm(s).replace(/ /g, '-').slice(0, 64).replace(/-+$/, '');

function newAccountId(dir, item) {
  const base = slug(item.name) || `bank-${item.cert}`;
  const free = (id) => !exists(join(dir, 'accounts', `${id}.json`));
  if (free(base)) return safeId(base);
  const alt = `${base.slice(0, 63 - item.cert.length).replace(/-+$/, '')}-${item.cert}`;
  if (free(alt)) return safeId(alt);
  throw new Error(`An account file already exists for both ${base} and ${alt}. Resolve it by hand.`);
}

// Creates accounts/<id>.json for a principal's chosen bank, carrying the pipeline's research as the `pipeline` block (E6-S8).
// The named person is left empty: a principal names them before research.
export function promote({ dir, key, by, suppression = [], now = new Date() }) {
  by = requireBy(by);
  const latest = loadLatest(dir);
  const it = latest.items.find((i) => i.key === key);
  if (!it) throw new Error(`No candidate "${key}" in the latest list. Keys look like fdic:<CERT>.`);
  if (suppressedBy(it, suppression, loadAliases(dir))) throw new Error(`${it.name} is suppressed. It cannot be promoted.`);
  if (it.filtersFailed?.length) throw new Error(`${it.name} fails the hard filters (${it.filtersFailed.join('; ')}). It cannot be promoted.`);
  const d = loadDecisions(dir)[key];
  if (d?.status === 'promoted') throw new Error(`${it.name} was already promoted by ${d.by} on ${ymd(d.at)} (account ${d.accountId}).`);
  const existing = listFiles(join(dir, 'accounts'), '.json').map((f) => readJson(join(dir, 'accounts', f))).find((a) => a?.institutionKey === key);
  if (existing) throw new Error(`Account ${existing.id} already holds ${key}.`);
  const id = newAccountId(dir, it);
  const at = now.toISOString();
  const lead = leadSectorFor(it.profile);
  const account = {
    id, name: it.name, aliases: loadAliases(dir)[key] ?? [], type: 'bank', audience: 'bank',
    sectors: lead.leadSector ? [lead.leadSector] : (lead.leadSectorOptions.length ? lead.leadSectorOptions : it.sectors ?? []), tier: it.tier,
    institutionKey: key, originSignals: it.signals.map((s) => s.id),
    pipeline: {
      key, period: it.latestRepdte, tier: it.tier, score: it.score, axes: it.axes, profile: it.profile, signals: it.signals,
      leadSector: lead.leadSector, leadSectorOptions: lead.leadSectorOptions, leadSectorBasis: lead.basis, leadSectorNote: lead.note, runId: latest.runId,
    },
    person: { name: '', title: '', email: '', phone: '', phoneType: '', timezone: '', mailingAddress: '' },
    contact: { emailStatus: 'unverified', roleConfirmed: false, provenance: [] },
    notes: `Promoted from the candidate list by ${by} on ${ymd(at)} (scoring run ${latest.runId}, data as of ${it.latestRepdte ? periodLabel(it.latestRepdte) : 'unknown'}). Name the person (person.name) before running research.${lead.leadSector ? '' : ` ${lead.note}`}`,
    knownFacts: [],
    promoted: { by, at, runId: latest.runId },
  };
  writeJson(join(dir, 'accounts', `${id}.json`), account);
  decide(dir, key, { status: 'promoted', by, at, accountId: id, signalIds: it.signals.map((s) => s.id) });
  audit(dir, { type: 'candidate_promoted', key, accountId: id, by });
  return account;
}

export function dismiss({ dir, key, by, reason, now = new Date() }) {
  by = requireBy(by);
  if (typeof reason !== 'string' || !reason.trim() || reason === 'true') throw new Error('A reason is required to dismiss a candidate (--reason TEXT).');
  const it = getCandidate({ dir, key });
  const rec = { status: 'dismissed', by, at: now.toISOString(), reason: reason.trim().slice(0, 300), signalIds: it.signals.map((s) => s.id) };
  decide(dir, key, rec);
  audit(dir, { type: 'candidate_dismissed', key, by });
  return rec;
}

export function snooze({ dir, key, by, until, now = new Date() }) {
  by = requireBy(by);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(until ?? '')) || Number.isNaN(Date.parse(`${until}T00:00:00Z`))) throw new Error('Snoozing needs a date: --until YYYY-MM-DD.');
  if (until <= ymd(now)) throw new Error(`--until ${until} is not in the future.`);
  getCandidate({ dir, key });
  const rec = { status: 'snoozed', by, at: now.toISOString(), until };
  decide(dir, key, rec);
  audit(dir, { type: 'candidate_snoozed', key, by, until });
  return rec;
}
