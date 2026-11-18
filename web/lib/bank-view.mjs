// The bank page (docs/design-redesign.md, 4.1 and 5.3), kept pure so it can be tested without a server. It reads the candidate item
// (src/score.mjs, src/candidates.mjs) and the paper record (src/paper.mjs) and only picks, joins by id, formats and compares with the
// rule files: every figure shown is one the engine stored. Nothing here adds two figures together.
import { period, pct as pctOf, moneyThousands } from './format.mjs';
import { show, fieldCodes, dateOf, STAGES, basisLabel, usd } from './paper-view.mjs';
import { priorityOf, bestCeiling, sectorWord, AXES, axesOf, axisMax, tierGap, tierRule } from './candidates-view.mjs';

// ---- Layout ---------------------------------------------------------------------------------------------------------------------
// Tabs are links rendered on the server (?tab=...), so the page needs no client script.
// "Loans we can see" (docs/county-loans.md) is its own tab: individual loans from county records, a different kind of evidence from
// the reported figures on the tabs before it.
export const TABS = Object.freeze([['overview', 'Overview'], ['holdings', 'What it holds'], ['fit', 'How much could fit'], ['loans', 'Loans we can see'], ['details', 'Details']]);
export const tabOf = (sp) => { const t = Array.isArray(sp?.tab) ? sp.tab[0] : sp?.tab; return TABS.some(([k]) => k === t) ? t : 'overview'; };
// The page's sections top to bottom across the tabs: the short answer first, What to ask for last.
export const SECTIONS = Object.freeze([
  ['answer', 'The short answer', 'overview'], ['why', 'Why now', 'overview'], ['holdings', 'What it holds', 'holdings'],
  ['fit', 'How much could we buy?', 'fit'], ['loans', 'Loans we can see', 'loans'], ['more', 'More detail', 'details'], ['ask', 'What to ask for', 'details'],
]);

// ---- Names --------------------------------------------------------------------------------------------------------------------
// The Call Report's categories in plain words, with the old name kept as a secondary label (the glossary explains both).
export const CATEGORY = Object.freeze({
  multifamily: { label: 'Apartments', lower: 'apartment loans', fdic: 'Multifamily (5+ units)', term: 'apartments' },
  nonfarmNonresidential: { label: 'Commercial property', lower: 'commercial-property loans', fdic: 'Nonfarm nonresidential', term: 'commercial' },
  nonfarmNonresidentialOther: { label: 'Investor-owned', lower: 'investor-owned commercial-property loans', fdic: 'Nonfarm nonresidential, other', term: 'investor-owned' },
  nonfarmNonresidentialOwnerOccupied: { label: 'Owner-occupied', lower: 'owner-occupied commercial-property loans', fdic: 'Nonfarm nonresidential, owner-occupied', term: 'owner-occupied' },
  construction: { label: 'Construction and land', lower: 'construction and land loans', fdic: 'Construction and land development', term: 'construction' },
  notSecuredByRealEstate: { label: 'CRE loans without a property lien', lower: 'CRE loans without a property lien', fdic: 'CRE not secured by real estate', term: 'no-lien' },
});
export const SECTOR = Object.freeze({ multifamily: 'Apartments', hospitality: 'Hotels', retail: 'Retail' });
const sectorTitle = (s) => SECTOR[s?.sector] ?? s?.label ?? s?.sector ?? '';
const ROUTE_WORDS = Object.freeze({ unknown: 'Not known yet', advisor: 'Through an advisor', direct: 'Directly', both: 'Directly and through an advisor' });
export const routeWords = (route) => ROUTE_WORDS[route?.route] ?? 'Not known yet';

// Plain names for the score's measures, by component id; an unknown id keeps the engine's own label.
export const COMPONENT_LABELS = Object.freeze({
  buyboxNoncurrentRatio: 'Seriously late loans, in the types we buy',
  creNoncurrentRatio: 'Seriously late loans, whole CRE book',
  creNoncurrentYoY: 'Change in seriously late loans over a year',
  creNonaccrualRatio: 'Loans not accruing interest',
  creOreoRatio: 'Foreclosed property, against the CRE book',
  buyboxCreShare: 'Share of the CRE book in types we buy',
  buyboxShareOfLoans: 'Share of all loans in types we buy',
  metroDepositShare: 'Share of deposits in our six metros',
  creNoncurrentQoQ: 'Change in seriously late loans since last quarter',
  earlyStageDelinquency: 'Loans 30 to 89 days late (early warning)',
  creNetChargeOffRate: 'Losses written off this quarter',
});

// ---- Small formatters ---------------------------------------------------------------------------------------------------------
const fin = (x) => x !== null && x !== undefined && Number.isFinite(Number(x));
const pct1 = (x) => (fin(x) ? `${(Number(x) * 100).toFixed(1)}%` : '–');
const points = (x) => `${(Math.abs(Number(x)) * 100).toFixed(1)} points`;
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const sentenceOf = (s) => { const t = String(s ?? '').trim(); return !t ? '' : /[.!?)]$/.test(t) ? t : `${t}.`; };
const listWords = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} or ${xs.at(-1)}`);

// A component's value as the score card shows it: a share, or a change in points.
export function componentValue(c) {
  if (!fin(c?.value)) return 'Not available';
  if (c.change) return `${Number(c.value) < 0 ? '−' : '+'}${(Math.abs(Number(c.value)) * 100).toFixed(2)} pts`;
  return pctOf(c.value, /Share$|metroDepositShare/.test(c.id) ? 0 : 2);
}

// ---- The card's sentences -----------------------------------------------------------------------------------------------------
// The card's sentences without its first, which is always "<Bank>: Call Report data as of <date>." and says nothing a row needs.
export const withoutBoilerplate = (sentences) => (Array.isArray(sentences) ? sentences : []).filter((s, i) => !(i === 0 && /: Call Report data as of /.test(String(s?.text ?? ''))));

// Why now: each remaining sentence, marked "New signal" with the signal's date when it states one the scoring run fired.
export function whyLines(item) {
  const signals = item?.signals ?? [];
  return withoutBoilerplate(item?.card?.sentences).map((s) => {
    const sig = signals.find((g) => (s.evidence ?? []).includes(g.id));
    return { text: s.text, signal: !!sig, when: sig ? (sig.period ? period(sig.period) : dateOf(sig.date ?? sig.fileDate)) : '' };
  });
}

// ---- How much could fit (Q7) --------------------------------------------------------------------------------------------------
// One row per buy-box type, straight from the record's bounds. A gap stays a gap.
export function fitRanges(q7) {
  return (q7?.sectors ?? []).map((s) => {
    const b = s.bounds;
    const known = b && !b.status && fin(b.low) && fin(b.high);
    return {
      sector: s.sector, label: sectorTitle(s), word: sectorWord(s), category: s.category, known,
      low: known ? Number(b.low) : null, high: known ? Number(b.high) : null, tier: b?.tier ?? null, estimate: basisLabel(b?.tier) === 'Estimate',
      bounds: b, why: s.why ?? '', lowNote: b?.lowNote ?? '', unknown: s.unknownConditions ?? [], conditions: s.conditions ?? [], oreo: s.oreo ?? null,
      statusLoans: s.statusLoans ?? null, codes: fieldCodes(b),
    };
  });
}

// The largest single-type ceiling on the page, from the record when there is one, else from the item's stored fitCeiling. Never a sum.
export function bestFit(item, paper) {
  if (paper?.q7) {
    const known = fitRanges(paper.q7).filter((r) => r.known);
    if (!known.length) return null;
    return bestCeiling(known.map((r) => ({ sector: r.sector, label: r.label, category: r.category, high: r.high, low: r.low, tier: r.tier })));
  }
  return bestCeiling(item?.fitCeiling);
}

// Tick values for one axis shared by every range bar: 0 and round steps up to at least the largest ceiling. It only picks marks.
export function rangeAxis(highs) {
  const max = Math.max(0, ...(highs ?? []).filter(fin).map(Number));
  if (!(max > 0)) return { top: 1, ticks: [0] };
  const raw = max / 4, p = 10 ** Math.floor(Math.log10(raw)), m = raw / p;
  const step = (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
  const top = Math.ceil(max / step - 1e-9) * step;
  const ticks = [];
  for (let v = 0; v <= top + step / 1e6; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return { top, ticks };
}

// ---- The short answer ---------------------------------------------------------------------------------------------------------
// One sentence built from a template, as parts so the page can set the lead and the figures in bold. Example: "Call first. Late apartment
// loans up two quarters running. Up to $11.6M of its late apartment loans could fit our buy box, and up to $17.9M of its late
// commercial-property loans if they are hotels or retail."
export function answerSentence(item, paper) {
  const p = priorityOf(item);
  const lead = p.id === 'excluded' ? 'Excluded from the list.' : p.id === 'A' ? 'Call first.' : p.id === 'B' ? 'Worth a look.' : 'Not ranked.';
  const parts = [{ b: true, t: lead }];
  const reason = item?.card?.headline || withoutBoilerplate(item?.card?.sentences)[0]?.text;
  if (reason) parts.push({ t: ` ${sentenceOf(reason)}` });
  const late = paper?.q7?.statusRule?.state === 'mapped' && (paper.q7.statusRule.loanStages ?? []).length > 0 ? 'late ' : '';
  const groups = [];
  for (const r of fitRanges(paper?.q7).filter((x) => x.known)) {
    const g = groups.find((x) => x.category === r.category && x.high === r.high);
    if (g) g.words.push(r.word); else groups.push({ category: r.category, high: r.high, words: [r.word] });
  }
  groups.sort((a, b) => (a.category === 'multifamily' ? -1 : b.category === 'multifamily' ? 1 : 0));
  groups.forEach((g, i) => {
    const what = CATEGORY[g.category]?.lower ?? `${listWords(g.words)} loans`;
    const shared = g.words.length > 1 || g.category === 'nonfarmNonresidential';
    parts.push({ t: i === 0 ? ' Up to ' : ', and up to ' }, { b: true, t: usd(g.high) });
    parts.push({ t: ` of its ${late}${what}${i === 0 ? ' could fit our buy box' : ''}${shared && g.category !== 'multifamily' ? ` if they are ${listWords(g.words.map((w) => (w === 'hotel' ? 'hotels' : w)))}` : ''}` });
  });
  if (groups.length) parts.push({ t: '.' });
  return parts;
}
export const answerText = (parts) => parts.map((p) => p.t).join('');

// ---- The highlights panel -------------------------------------------------------------------------------------------------------
// The six key fields under the bank's name: priority, score, could fit, seriously late, deposits in our metros, how it sells.
export function facts(item, paper, route) {
  const comp = (id) => (item?.components ?? []).find((c) => c.id === id);
  const late = comp('creNoncurrentRatio'), yoy = comp('creNoncurrentYoY');
  const best = bestFit(item, paper);
  const share = paper?.q3?.buyboxShare && !paper.q3.buyboxShare.status ? paper.q3.buyboxShare.value : item?.profile?.footprint?.buyboxDepositShare;
  const metros = whereRows(item, paper).filter((m) => m.inBuybox && fin(m.share) && m.share > 0).map((m) => m.label);
  return [
    { id: 'priority', k: 'Priority', term: 'priority', priority: true },
    { id: 'score', k: 'Score', term: 'score', v: fin(item?.score) ? String(Math.round(Number(item.score))) : '–', sub: 'of 100' },
    { id: 'fit', k: 'Could fit our buy box', term: 'could-fit', v: best ? `up to ${usd(best.high)}` : 'Not estimated yet', sub: best ? best.label : 'the next scoring run estimates it', estimate: best?.tier === 'inferred' },
    { id: 'late', k: 'Seriously late', term: 'serious', v: fin(late?.value) ? pct1(late.value) : 'Not available', sub: fin(late?.value) ? `of CRE${fin(yoy?.value) ? `, ${Number(yoy.value) >= 0 ? 'up' : 'down'} ${points(yoy.value)} in a year` : ''}` : '' },
    { id: 'deposits', k: 'Deposits in our metros', term: 'where', v: fin(share) ? pctOf(share, 0) : 'Not available', sub: metros.join(', ') },
    { id: 'sells', k: 'How it sells', v: routeWords(route), sub: '' },
  ];
}

// ---- The stage path ---------------------------------------------------------------------------------------------------------------
// Where a bank stands with us, derived from the records there are (D-UI7): its decision (promoted is Outreach), and whether the latest
// triage lists it as in conversation. No record holds NDA signed, Loan tape or Bid yet, so the path never reaches them on its own.
export const STAGE_PATH = Object.freeze(['Ranked', 'Outreach', 'In conversation', 'NDA signed', 'Loan tape', 'Bid']);
export function stageOf({ decision = null, excluded = [], suppressed = false, inConversation = false } = {}) {
  if (suppressed) return { current: 0, parked: true, guide: 'Do not contact: this bank is on the suppression list. It cannot be promoted, and nothing about it is sent.' };
  if (decision?.status === 'promoted') {
    const since = decision.at ? ` since ${dateOf(String(decision.at).slice(0, 10))}` : '';
    if (inConversation) return { current: 2, parked: false, guide: `In conversation: a reply, meeting or handoff is on record. Outreach started${since}${decision.by ? ` by ${decision.by}` : ''}.`, account: decision.accountId ?? null };
    return { current: 1, parked: false, guide: `In Outreach${since}${decision.by ? `, started by ${decision.by}` : ''}. Next: name the person to contact, or queue institution research. Nothing is sent.`, account: decision.accountId ?? null };
  }
  if (excluded?.length) return { current: 0, parked: true, guide: `Excluded from the list: ${excluded.join('; ')}.` };
  if (decision?.status === 'snoozed') return { current: 0, parked: true, guide: `Snoozed until ${decision.until}${decision.by ? ` by ${decision.by}` : ''}. It comes back on that date.` };
  if (decision?.status === 'dismissed') return { current: 0, parked: true, guide: `Not now${decision.by ? `, by ${decision.by}` : ''}${decision.reason ? `: ${decision.reason}` : ''}. It comes back only if a new signal fires.` };
  return { current: 0, parked: false, guide: 'Next step: start outreach to name the person to contact and queue research. Nothing is sent.' };
}

// ---- What it holds ----------------------------------------------------------------------------------------------------------------
// A cell of the holdings table, ready to show: the figure, its share of the line's balance, its basis, its field codes; or a gap.
function paperCell(v, share = null) {
  if (!v) return null;
  const s = show(v);
  if (s.gap) return { gap: true, text: cap(s.text), reason: s.reason ?? '' };
  const sh = share && !share.status && fin(share.value) ? Number(share.value) : null;
  return { gap: false, text: s.text, value: fin(v.value) ? Number(v.value) : null, ratio: sh, share: sh !== null ? pct1(sh) : '', estimate: basisLabel(v.tier) === 'Estimate', codes: fieldCodes(v), method: v.method ?? '', note: v.note ?? '' };
}
function profileCell(x) {
  if (!x) return null;
  if (x.field === null || !fin(x.value)) return { gap: true, text: 'Not reported', reason: x.note ?? '' };
  return { gap: false, text: moneyThousands(x.value), value: Number(x.value) * 1000, ratio: fin(x.ratio) ? Number(x.ratio) : null, share: fin(x.ratio) ? pct1(x.ratio) : '', estimate: false, codes: `${x.field}${x.repdte ? ` · ${period(x.repdte)}` : ''}` };
}
const note = (text) => ({ gap: true, text, reason: '' });

// One row per loan type: apartments; commercial property with its two lines inside; construction and land; CRE loans without a property
// lien. Joined from the item's profile and the record's Q1, Q7 and foreclosed property by category id; never summed.
export function holdingRows(profile, q1, q7) {
  const prof = (id) => (profile?.categories ?? []).find((c) => c.id === id);
  const cat = (id) => (q1?.categories ?? []).find((c) => c.id === id);
  const oreoOf = (id) => (q1?.oreo ?? []).find((o) => o.id === id);
  const ranges = fitRanges(q7).filter((r) => r.known);
  const stagesOf = (paperStages, profStages) => Object.fromEntries(STAGES.map(([k]) => {
    const p = paperStages?.[k];
    if (p?.amount) return [k, paperCell(p.amount, p.shareOfBalance)];
    return [k, profStages?.[k] ? profileCell(profStages[k]) : null];
  }));
  const fitCell = (id, buys) => {
    const mine = ranges.filter((r) => r.category === id);
    if (mine.length) {
      const top = mine.reduce((a, r) => (r.high > a.high ? r : a), mine[0]);
      const words = [...new Set(mine.filter((r) => r.high === top.high).map((r) => r.word))];
      return { gap: false, text: `up to ${usd(top.high)}`, sub: id === 'multifamily' ? 'apartments' : `if ${listWords(words)}`, estimate: mine.some((r) => r.estimate), codes: top.codes, low: top.low, high: top.high, why: top.why, lowNote: top.lowNote };
    }
    return note(buys === 'no' ? 'Not a type we buy' : q7 ? 'Not measured' : 'Not estimated yet');
  };
  const row = (id, paperId = id) => {
    const p = prof(id), c = cat(paperId), meta = CATEGORY[id];
    const buys = p?.fit?.buys ? ((p.fit.sectors ?? []).length > 1 ? 'partly' : 'yes') : 'no';
    const balance = c?.balance ? paperCell(c.balance) : profileCell(p?.balance);
    const oreo = oreoOf(paperId);
    return {
      id, label: meta.label, fdic: meta.fdic, term: meta.term, lower: meta.lower, buys,
      balance, shareOfCre: p?.shareOfCre && fin(p.shareOfCre.value) ? pctOf(p.shareOfCre.value, 0) : '',
      stages: stagesOf(c?.stages, p?.stages),
      oreo: oreo ? paperCell(oreo.value) : p?.stages?.oreo ? profileCell(p.stages.oreo) : note('Not reported'),
      fit: fitCell(id, buys), fitReason: p?.fit?.reason ?? '',
      writtenOff: c?.chargeOffs ? { quarter: paperCell(c.chargeOffs.quarter), ytd: paperCell(c.chargeOffs.yearToDate) } : null,
      note: c?.note ?? '', children: [],
    };
  };
  const rows = [];
  if (prof('multifamily') || cat('multifamily')) rows.push(row('multifamily'));
  if (prof('nonfarmNonresidential') || q1?.nonfarmTotal) {
    const p = prof('nonfarmNonresidential');
    const t = q1?.nonfarmTotal;
    const r = row('nonfarmNonresidential');
    r.balance = t?.balance ? paperCell(t.balance) : profileCell(p?.balance);
    // The total's own stages from the record (q1.nonfarmTotal.stages; a gap stays a gap), else a figure the profile stored, else, until a
    // scoring run stores them, the row says where they are: in its two lines.
    r.stages = Object.fromEntries(STAGES.map(([k]) => {
      if (t?.stages?.[k]?.amount) return [k, paperCell(t.stages[k].amount, t.stages[k].shareOfBalance)];
      const pc = p?.stages?.[k] ? profileCell(p.stages[k]) : null;
      return [k, pc && !pc.gap ? pc : note('In the two lines below')];
    }));
    r.writtenOff = t?.chargeOffs ? { quarter: paperCell(t.chargeOffs.quarter), ytd: paperCell(t.chargeOffs.yearToDate) } : null;
    r.children = ['nonfarmNonresidentialOther', 'nonfarmNonresidentialOwnerOccupied'].filter((id) => cat(id)).map((id) => {
      const c = cat(id);
      return { id, label: CATEGORY[id].label, fdic: CATEGORY[id].fdic, term: CATEGORY[id].term, balance: paperCell(c.balance),
        stages: Object.fromEntries(STAGES.map(([k]) => [k, c.stages?.[k] ? paperCell(c.stages[k].amount, c.stages[k].shareOfBalance) : note('Not reported')])),
        oreo: note('In the total above'), fit: note('In the total above'), writtenOff: { quarter: paperCell(c.chargeOffs?.quarter), ytd: paperCell(c.chargeOffs?.yearToDate) }, note: c.note ?? '' };
    });
    rows.push(r);
  }
  if (prof('construction') || cat('construction')) rows.push(row('construction'));
  if (cat('notSecuredByRealEstate')) {
    const r = row('notSecuredByRealEstate');
    r.shareOfCre = '';
    r.oreo = note('Not reported');
    rows.push(r);
  }
  return rows;
}

// The scale of a row's late-stage bars: the largest stage share in the table, rounded up to a whole percent (at least 5%), so every
// row's bars share one scale. It only picks the scale.
export function ladderScale(rows) {
  const shares = rows.flatMap((r) => [r, ...(r.children ?? [])]).flatMap((r) => Object.values(r.stages ?? {})).map((c) => c?.ratio).filter(fin);
  const top = Math.max(0.05, ...shares);
  return Math.ceil(top * 100) / 100;
}

// ---- The sidebar's related lists ----------------------------------------------------------------------------------------------
// Where it lends: deposit share by metro from the record (Q3), else from the item's profile; metros with no deposits and no branches
// left out. Deposits stand in for loans.
export function whereRows(item, paper) {
  if (paper?.q3?.metros) {
    return paper.q3.metros.map((m) => ({ cbsa: m.cbsa, label: m.label, inBuybox: m.inBuybox !== false, share: m.share && !m.share.status && fin(m.share.value) ? Number(m.share.value) : null,
      branches: m.branches && fin(m.branches.value) ? Number(m.branches.value) : null, codes: fieldCodes(m.share) }))
      .filter((m) => (m.share ?? 0) > 0 || (m.branches ?? 0) > 0);
  }
  return (item?.profile?.footprint?.metros ?? []).map((m) => ({ cbsa: m.cbsa, label: m.label, inBuybox: m.inBuybox !== false, share: fin(m.depositShare) ? Number(m.depositShare) : null,
    branches: fin(m.branches?.value) ? Number(m.branches.value) : null, codes: m.deposits?.field ? `${m.deposits.field} · ${period(m.deposits.repdte)}` : '' }))
    .filter((m) => (m.share ?? 0) > 0 || (m.branches ?? 0) > 0);
}

// The score's three parts against their maximums, and the rule line under them.
export function scoreParts(item, scoring) {
  const max = axisMax(scoring), pts = axesOf(item);
  const gap = tierGap(item, scoring?.tiers);
  const p = priorityOf(item);
  const rule = p.id === 'excluded' ? `Excluded: ${(item?.filtersFailed ?? []).join('; ') || 'a hard filter failed'}.` : gap ? `${gap}.` : tierRule(scoring?.tiers);
  return { axes: AXES.map((a) => ({ ...a, points: pts[a.id], max: max[a.id] })), rule };
}

// Has it sold loans before (Q6), for the sidebar: each dated item, its plain label and basis.
export const soldItems = (paper) => (paper?.q6?.items ?? []).map((i) => ({ date: dateOf(i.date) || String(i.date ?? ''), label: i.label, basis: basisLabel(i.tier) || (i.tier ? 'Reported' : ''), link: typeof i.link === 'string' && /^https:\/\//.test(i.link) ? i.link : null, values: i.values ?? null }));

// The seriously-late share trend (newest engine field): the points as stored, a null kept as a break. null when the record has none.
export function trendSeries(paper) {
  const pts = paper?.trend?.seriouslyLateShare;
  if (!Array.isArray(pts) || !pts.length) return null;
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const short = (iso, q) => { const m = /^(\d{4})-(\d{2})/.exec(String(iso ?? '')); return m ? `${MON[Number(m[2]) - 1]} ${m[1]}` : String(q ?? ''); };
  return pts.map((p) => ({ label: dateOf(p.asOf) || p.quarter, short: short(p.asOf, p.quarter), value: fin(p.value) ? Number(p.value) : null, status: p.valueStatus ?? null, reason: p.valueReason ?? '' }));
}

// About these numbers: the page's date, said once (D-UI1): the record's as-of date, else the item's latest report.
export const aboutDate = (paper, item) => (paper?.asOf ? dateOf(paper.asOf) : item?.latestRepdte ? period(item.latestRepdte) : '');
