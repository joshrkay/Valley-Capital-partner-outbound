// Checking the scrapers (PRD E2): does what we stored match the source, and did we miss anything? Read-only: it fetches from FDIC and
// SEC and compares, and writes nothing. Each check passes or fails with a plain sentence. The spot-check list gives a person a few
// records with the exact public URL to compare by eye, because a test can only check what someone thought to test.
import { join } from 'node:path';
import { readJson, listFiles } from '../store.mjs';
import { getJson, getText, pacer, realSleep } from './http.mjs';
import { FDIC_BASE, FDIC_FIELDS, orFilter, fdicPaths, FAILURE_CODES, STRUCTURE_CODES, STRUCTURE_LOOKBACK_MONTHS, eventOf, isoDate, monthsBefore } from './fdic.mjs';
import { parseCmbsAssets, edgarPaths, SEC } from './edgar.mjs';

const check = (id, ok, summary, detail) => ({ id, ok: !!ok, summary, ...(detail ? { detail } : {}) });
// A warning flags a gap in the source itself, which the adapter already works around. It is shown, but it does not fail the run.
const warning = (id, flagged, summary, detail) => ({ ...check(id, true, summary, detail), ...(flagged ? { warn: true } : {}) });
const pick = (arr, n, seed = 1) => {   // a small deterministic shuffle, so a re-run checks the same records unless the seed changes
  const a = [...arr]; let x = seed;
  for (let i = a.length - 1; i > 0; i--) { x = (x * 1103515245 + 12345) % 2147483648; const j = x % (i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, n);
};

// ---- FDIC ---------------------------------------------------------------------------------------------------------------------
export async function verifyFdic({ dir, metros, fetchImpl = globalThis.fetch, sample = 5, seed = 1, sleep = realSleep, minIntervalMs = 200 }) {
  const pace = pacer(minIntervalMs, { sleep });
  const get = async (endpoint, params) => { await pace(); return getJson(`${FDIC_BASE}/${endpoint}`, params, { fetchImpl, sleep }); };
  const all = async (endpoint, filters, fields) => {
    const rows = [];
    for (let offset = 0; ; offset += 10000) {
      const r = await get(endpoint, { filters, fields: fields.join(','), limit: 10000, offset });
      rows.push(...(r.data ?? []).map((d) => d.data));
      if (rows.length >= (r.meta?.total ?? 0) || !(r.data ?? []).length) return rows;
    }
  };
  const p = fdicPaths(dir);
  const state = readJson(p.state, null);
  const institutions = readJson(p.institutions, null);
  if (!state || !institutions) return { source: 'fdic', checks: [check('fdic.present', false, 'No FDIC data yet. Run: outbound sources run fdic')], sample: [] };
  const checks = [];

  // 1. Fresh: the latest quarter we hold is the latest FDIC has published.
  const latest = String((await get('financials', { fields: 'REPDTE', sort_by: 'REPDTE', sort_order: 'DESC', limit: 1 })).data?.[0]?.data?.REPDTE ?? '');
  checks.push(check('fdic.fresh', latest === state.latestRepdte, latest === state.latestRepdte ? `Up to date: the latest quarter, ${latest}, is stored.` : `FDIC has published ${latest}; the data folder holds ${state.latestRepdte}. Run: outbound sources run fdic`));

  // 2. Coverage: every bank with a branch in a metro today is on our list, and nothing on our list has left.
  const codes = (metros.metros ?? metros).map((m) => m.cbsa);
  const live = new Set((await all('locations', orFilter('CBSA_NO', codes), ['CERT'])).map((r) => String(r.CERT)));
  const ours = new Set(Object.entries(institutions).filter(([, i]) => i.via?.branch && i.status === 'active').map(([c]) => c));
  const missing = [...live].filter((c) => !ours.has(c)), extra = [...ours].filter((c) => !live.has(c));
  checks.push(check('fdic.coverage', !missing.length && !extra.length, `${live.size} banks have a branch in the metros at FDIC today; ${ours.size} are on our list.${missing.length ? ` Missing from ours: ${missing.length}.` : ''}${extra.length ? ` On ours but gone at FDIC: ${extra.length}.` : ''}`, missing.length || extra.length ? { missing: missing.slice(0, 20), extra: extra.slice(0, 20) } : undefined));

  // 3. Values: every stored field for the latest quarter equals what FDIC serves now. 4. Ratios: our arithmetic equals FDIC's own.
  const certs = listFiles(join(dir, 'sources', 'fdic', 'financials'), '.json').map((f) => f.replace(/\.json$/, ''));
  const stored = new Map(certs.map((c) => [c, readJson(join(dir, 'sources', 'fdic', 'financials', `${c}.json`))?.quarters?.[state.latestRepdte]]).filter(([, q]) => q));
  const fields = [...new Set(['CERT', ...FDIC_FIELDS.financials, 'NCRECONR', 'NCLNLSR', 'LNLSGR', 'LNCDT1R'])];
  const fresh = new Map();
  const list = [...stored.keys()];
  for (let i = 0; i < list.length; i += 50) for (const r of await all('financials', `${orFilter('CERT', list.slice(i, i + 50))} AND REPDTE:${state.latestRepdte}`, fields)) fresh.set(String(r.CERT), r);
  let compared = 0; const diffs = [];
  for (const [c, q] of stored) {
    const f = fresh.get(c);
    if (!f) { diffs.push({ cert: c, field: '(whole quarter)', ours: 'stored', fdic: 'not served' }); continue; }
    for (const k of FDIC_FIELDS.financials) {
      if (k === 'CERT' || k === 'REPDTE') continue;
      compared++;
      if ((q[k] ?? null) !== (f[k] ?? null)) diffs.push({ cert: c, field: k, ours: q[k] ?? null, fdic: f[k] ?? null });
    }
  }
  checks.push(check('fdic.values', !diffs.length, diffs.length ? `${diffs.length} of ${compared} stored values differ from what FDIC serves for ${state.latestRepdte}. If FDIC amended the filings since the last pull, re-run it; otherwise this is a bug.` : `All ${compared} stored values for ${state.latestRepdte} match FDIC exactly (${stored.size} banks).`, diffs.length ? { first: diffs.slice(0, 10) } : undefined));
  const ratioDiffs = []; let ratios = 0;
  for (const [c, q] of stored) {
    const f = fresh.get(c); if (!f) continue;
    if (q.LNRECONS && f.NCRECONR !== null && f.NCRECONR !== undefined) { ratios++; const ours = (q.NCRECONS ?? 0) / q.LNRECONS * 100; if (Math.abs(ours - f.NCRECONR) > 0.01) ratioDiffs.push({ cert: c, ratio: 'construction noncurrent', ours: Number(ours.toFixed(4)), fdic: f.NCRECONR }); }
    if (f.LNLSGR && f.NCLNLSR !== null && f.NCLNLSR !== undefined) { ratios++; const ours = (q.NCLNLS ?? 0) / f.LNLSGR * 100; if (Math.abs(ours - f.NCLNLSR) > 0.01) ratioDiffs.push({ cert: c, ratio: 'total noncurrent', ours: Number(ours.toFixed(4)), fdic: f.NCLNLSR }); }
    // The concentration screen's tier 1 field: FDIC's own construction-to-tier-1 ratio is LNRECONS / RBCT1J (checked live on 267 banks).
    if (q.RBCT1J > 0 && f.LNCDT1R !== null && f.LNCDT1R !== undefined) { ratios++; const ours = (q.LNRECONS ?? 0) / q.RBCT1J * 100; if (Math.abs(ours - f.LNCDT1R) > 0.01) ratioDiffs.push({ cert: c, ratio: 'construction to tier 1 capital', ours: Number(ours.toFixed(4)), fdic: f.LNCDT1R }); }
  }
  checks.push(check('fdic.ratios', !ratioDiffs.length && ratios > 0, ratioDiffs.length ? `${ratioDiffs.length} of ${ratios} ratios computed from our stored values disagree with FDIC's own (by more than 0.01 points).` : `All ${ratios} ratios computed from our stored values agree with FDIC's own published ratios (construction noncurrent, NCRECONR; total noncurrent, NCLNLSR; construction to tier 1 capital, LNCDT1R).`, ratioDiffs.length ? { first: ratioDiffs.slice(0, 10) } : undefined));

  // 5. The concentration screen (PRD E3-S7). A CBLR bank must send RBC as 0 or null, and any other bank a positive RBC: that is what the
  // choice of denominator rests on. The 12-quarters-back CRE we store for the growth test must equal FDIC's.
  let cblr = 0, standard = 0; const denomOdd = [];
  for (const [c, q] of stored) {
    const flag = q.CBLRIND === null || q.CBLRIND === undefined ? null : Number(q.CBLRIND);
    if (flag === 1) { cblr++; if (Number(q.RBC) > 0) denomOdd.push({ cert: c, CBLRIND: 1, RBC: q.RBC }); }
    else if (flag === 0) { standard++; if (!(Number(q.RBC) > 0)) denomOdd.push({ cert: c, CBLRIND: 0, RBC: q.RBC ?? null }); }
  }
  const baseRep = state.growthBaseRepdte;
  const bases = new Map(baseRep ? certs.map((c) => [c, readJson(join(dir, 'sources', 'fdic', 'financials', `${c}.json`))?.growthBase?.[baseRep]]).filter(([, b]) => b) : []);
  const baseDiffs = []; let baseCompared = 0;
  const bl = [...bases.keys()];
  for (let i = 0; i < bl.length; i += 50) {
    const live = new Map((await all('financials', `${orFilter('CERT', bl.slice(i, i + 50))} AND REPDTE:${baseRep}`, FDIC_FIELDS.growthBase)).map((r) => [String(r.CERT), r]));
    for (const c of bl.slice(i, i + 50)) for (const k of FDIC_FIELDS.growthBase.filter((x) => x !== 'CERT' && x !== 'REPDTE')) { baseCompared++; if ((bases.get(c)[k] ?? null) !== (live.get(c)?.[k] ?? null)) baseDiffs.push({ cert: c, field: k, ours: bases.get(c)[k] ?? null, fdic: live.get(c)?.[k] ?? null }); }
  }
  checks.push(check('fdic.concentration', !denomOdd.length && !baseDiffs.length && bases.size > 0,
    `${standard} banks divide by total risk-based capital (RBC) and ${cblr} CBLR banks by tier 1 capital plus the allowance${denomOdd.length ? `; ${denomOdd.length} report RBC against what their CBLR flag says, so their denominator is in doubt` : '; every CBLR flag matches how RBC is reported'}. ${bases.size ? `${baseCompared - baseDiffs.length} of ${baseCompared} stored values for the growth base quarter, ${baseRep}, equal FDIC's.` : 'No growth base quarter is stored: run outbound sources run fdic.'}`,
    denomOdd.length || baseDiffs.length ? { denominator: denomOdd.slice(0, 10), growthBase: baseDiffs.slice(0, 10) } : undefined));

  // 6. Failures (PRD E3-S5). Every failure any of FDIC's three sources shows since the lookback date is in our record of failed banks.
  // A failure that /institutions or /history shows and /failures does not means FDIC's /failures index is behind: a warning, because
  // the adapter already takes failure from all three.
  const since = state.structureSince ?? monthsBefore(new Date().toISOString().slice(0, 10), STRUCTURE_LOOKBACK_MONTHS);
  const failedStored = readJson(p.failed, null);
  const failuresLive = await get('failures', { filters: `FAILDATE:[${since} TO *]`, fields: 'CERT,FAILDATE,RESTYPE', limit: 10000 });
  const fromFailures = new Map((failuresLive.data ?? []).map((d) => d.data).filter((f) => String(f.RESTYPE ?? '').toUpperCase() === 'FAILURE').map((f) => [String(f.CERT), isoDate(f.FAILDATE)]));
  const fromInst = new Map((await all('institutions', `ACTIVE:0 AND ${orFilter('CHANGEC1', FAILURE_CODES)} AND ENDEFYMD:[${since} TO *]`, ['CERT', 'ENDEFYMD', 'CHANGEC1'])).map((r) => [String(r.CERT), isoDate(r.ENDEFYMD)]));
  const histRows = await all('history', `${orFilter('CHANGECODE', Object.keys(STRUCTURE_CODES))} AND EFFDATE:[${since} TO *]`, FDIC_FIELDS.history);
  const liveEvents = histRows.map(eventOf).filter((e) => e.targetCert && e.effective);
  const fromHist = new Map(liveEvents.filter((e) => e.kind === 'failure').map((e) => [e.targetCert, e.effective]));
  const allFailed = [...new Set([...fromFailures.keys(), ...fromInst.keys(), ...fromHist.keys()])].sort((a, b) => a - b);
  const notOurs = failedStored ? allFailed.filter((c) => !failedStored[c]) : allFailed;
  checks.push(check('fdic.failures', !!failedStored && !notOurs.length,
    !failedStored ? 'No record of failed banks yet (sources/fdic/failed.json). Run: outbound sources run fdic' : notOurs.length ? `${notOurs.length} of ${allFailed.length} failures FDIC shows since ${since} are not in our record of failed banks. Run: outbound sources run fdic` : `All ${allFailed.length} failures FDIC shows since ${since} (/failures, /institutions and /history together) are in our record; ${Object.values(failedStored).filter((f) => f.inMetros).length} had a presence in the six metros.`,
    notOurs.length ? { missing: notOurs.slice(0, 20) } : undefined));
  const behind = [...new Set([...fromInst.keys(), ...fromHist.keys()])].filter((c) => !fromFailures.has(c)).sort((a, b) => a - b);
  const builtAt = failuresLive.meta?.index?.createTimestamp ?? null;
  checks.push(warning('fdic.failures-index', behind.length,
    behind.length ? `${behind.length} failure(s) in /institutions or /history ${behind.length === 1 ? 'is' : 'are'} missing from /failures: FDIC's /failures index is behind${builtAt ? ` (built ${builtAt.slice(0, 10)})` : ''}. Our record takes failure from all three sources.` : `FDIC's /failures index${builtAt ? ` (built ${builtAt.slice(0, 10)})` : ''} lists every failure that /institutions and /history show since ${since}.`,
    behind.length ? { missingFromFailures: behind.map((c) => ({ cert: c, institutions: fromInst.get(c) ?? null, history: fromHist.get(c) ?? null })).slice(0, 20) } : undefined));

  // 7. Structure events (PRD E3-S6). Every deal since the lookback date with a bank on our list on either side is stored, with the same
  // acquirer, target and date.
  const eventsStored = readJson(p.events, null);
  const onList = new Set(Object.entries(institutions).filter(([, i]) => i.inUniverse).map(([c]) => c));
  const knownCerts = new Set(Object.keys(institutions));
  const ourDeals = liveEvents.filter((e) => (e.acquirerCert && onList.has(e.acquirerCert)) || knownCerts.has(e.targetCert));
  const eventDiffs = ourDeals.filter((e) => { const s = eventsStored?.[e.transnum]; return !s || s.acquirerCert !== e.acquirerCert || s.targetCert !== e.targetCert || s.effective !== e.effective; });
  checks.push(check('fdic.events', !!eventsStored && !eventDiffs.length,
    !eventsStored ? 'No structure events stored yet (sources/fdic/events.json). Run: outbound sources run fdic' : eventDiffs.length ? `${eventDiffs.length} of ${ourDeals.length} deals FDIC shows since ${since} involving a bank on our list are missing from our events, or differ. Run: outbound sources run fdic` : `All ${ourDeals.length} deals FDIC shows since ${since} involving a bank on our list are stored with the same acquirer, target and date (${Object.keys(eventsStored).length} events kept in all).`,
    eventDiffs.length ? { first: eventDiffs.slice(0, 10).map((e) => ({ transnum: e.transnum, acquirerCert: e.acquirerCert, targetCert: e.targetCert, effective: e.effective, ours: eventsStored?.[e.transnum] ? { acquirerCert: eventsStored[e.transnum].acquirerCert, targetCert: eventsStored[e.transnum].targetCert, effective: eventsStored[e.transnum].effective } : null })) } : undefined));

  const sampleRows = pick([...stored.keys()], sample, seed).map((c) => {
    const q = stored.get(c);
    const cre = (q.LNRENRES ?? 0) + (q.LNREMULT ?? 0) + (q.LNRECONS ?? 0);
    const nc = (q.NCRENRES ?? 0) + (q.NCREMULT ?? 0) + (q.NCRECONS ?? 0);
    return { cert: c, name: institutions[c]?.NAME ?? null, quarter: state.latestRepdte, assets: q.ASSET, creLoans: cre, creNoncurrent: nc, creNoncurrentRatio: cre ? Number((nc / cre * 100).toFixed(2)) : null,
      check: `${FDIC_BASE}/financials?filters=CERT:${c}%20AND%20REPDTE:${state.latestRepdte}&fields=ASSET,LNRENRES,LNREMULT,LNRECONS,NCRENRES,NCREMULT,NCRECONS` };
  });
  return { source: 'fdic', checks, sample: sampleRows };
}

// ---- SEC EDGAR ----------------------------------------------------------------------------------------------------------------
const CMBS_NAME = /mortgage trust|commercial mortgage|\bcmbs\b|\bbank5?\b 20\d\d|benchmark 20\d\d|bbcms|\bcomm 20\d\d|\bcd 20\d\d|\bmsbam\b|\bwfcm\b|\bcsail\b|\bjpmbb\b|\bjpmcc\b|\bcgcmt\b|\bgsms\b|3650r/i;

export async function verifyEdgar({ dir, sec, fetchImpl = globalThis.fetch, sample = 5, seed = 1, parseTrusts = 3, sleep = realSleep }) {
  const p = edgarPaths(dir);
  const state = readJson(p.state, null), loans = readJson(p.loans, null);
  if (!state || !loans) return { source: 'edgar', checks: [check('edgar.present', false, 'No CMBS data yet. Run: outbound sources run edgar')], sample: [] };
  const checks = [];
  const outcomes = state.outcomes ?? [];

  // 1. Every filer is accounted for, and nothing that looks like CMBS was set aside as something else.
  const doubtful = outcomes.filter((o) => o.outcome !== 'cmbs' && CMBS_NAME.test(o.company ?? '') && o.outcome !== 'no_ex102');
  checks.push(check('edgar.accounted', outcomes.length === state.counts?.filings && !doubtful.length,
    `${outcomes.length} of ${state.counts?.filings} filers have a recorded outcome: ${['cmbs', 'too_large', 'not_cmbs', 'no_ex102', 'bad_records', 'error'].map((k) => `${outcomes.filter((o) => o.outcome === k).length} ${k}`).join(', ')}.${doubtful.length ? ` ${doubtful.length} look like CMBS by name but were not read as CMBS; check them.` : ''}`,
    doubtful.length ? { doubtful: doubtful.slice(0, 20) } : undefined));

  // 2. The parser against plain counting: for a few trusts, fetch the EX-102 again and compare loans and total balance.
  const ua = String(sec?.userAgent ?? '');
  if (!ua || /\[confirm/i.test(ua)) checks.push(check('edgar.parse', false, 'Skipped: config.sec.userAgent is a placeholder, so nothing can be fetched from SEC.'));
  else {
    const pace = pacer(sec.minIntervalMs ?? 150, { sleep });
    const opts = { fetchImpl, userAgent: ua, sleep };
    const results = [];
    for (const o of pick(outcomes.filter((x) => x.outcome === 'cmbs'), parseTrusts, seed)) {
      const base = `${SEC}/Archives/edgar/data/${o.cik}/${o.accession.replace(/-/g, '')}`;
      await pace();
      const items = (await getJson(`${base}/index.json`, {}, opts))?.directory?.item ?? [];
      const ex = items.filter((i) => /102/.test(i.name) && /\.xml$/i.test(i.name)).sort((a, b) => Number(b.size ?? 0) - Number(a.size ?? 0))[0];
      await pace();
      const xml = (await getText(`${base}/${ex.name}`, {}, opts)).text;
      const plainCount = (xml.match(/<(?:[\w-]+:)?assets[\s>]/g) ?? []).length;
      const plainSum = [...xml.matchAll(/<(?:[\w-]+:)?reportPeriodEndActualBalanceAmount>([^<]*)</g)].reduce((s, m) => s + (Number(m[1]) || 0), 0);
      const parsed = parseCmbsAssets(xml);
      const parsedSum = parsed.assets.reduce((s, a) => s + Number(a.fields.reportPeriodEndActualBalanceAmount || 0), 0);
      results.push({ cik: o.cik, recorded: o.records ?? o.loans, parsed: parsed.assets.length, plainCount, balanceParsed: Math.round(parsedSum), balancePlain: Math.round(plainSum) });
    }
    const bad = results.filter((r) => r.parsed !== r.plainCount || r.parsed !== r.recorded || r.balanceParsed !== r.balancePlain);
    checks.push(check('edgar.parse', !bad.length && results.length > 0, bad.length ? `${bad.length} of ${results.length} trusts parse differently from a plain count of the file.` : `${results.length} trusts re-read from SEC: loan counts and total balances from the parser equal a plain count of each file.`, { trusts: results }));
  }

  // 3. Internal consistency: every stored loan belongs to a trust read in the latest run and carries its source.
  const keptTrusts = new Set(outcomes.filter((o) => o.outcome === 'cmbs').map((o) => o.cik));
  const orphans = Object.values(loans).filter((l) => !keptTrusts.has(l.cik) || !l._source?.endpoint);
  checks.push(check('edgar.loans', !orphans.length, orphans.length ? `${orphans.length} stored loans belong to no trust read in the latest run, or have no source. They may be left from an earlier run.` : `All ${Object.keys(loans).length} stored loans belong to a trust read in the latest run and carry their source filing.`));

  const sampleRows = pick(Object.values(loans), sample, seed).map((l) => ({
    key: l.key, trust: l.trust, assetNumber: l.assetNumber, period: l.period, balance: l.balance, maturity: l.maturity,
    paymentStatus: l.paymentStatus?.label ?? null, workout: l.workout?.label ?? null, metros: l.metros, sectors: l.sectors,
    check: `${SEC}/Archives/edgar/data/${l.cik}/${String(l._source?.endpoint ?? '').split(' ')[1]?.replace(/-/g, '') ?? ''}/ (open the EX-102 and find assetNumber ${l.assetNumber})`,
  }));
  return { source: 'edgar', checks, sample: sampleRows };
}
