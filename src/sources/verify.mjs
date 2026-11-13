// Checking the scrapers (PRD E2): does what we stored match the source, and did we miss anything? Read-only: it fetches from FDIC and
// SEC and compares, and writes nothing. Each check passes or fails with a plain sentence. The spot-check list gives a person a few
// records with the exact public URL to compare by eye, because a test can only check what someone thought to test.
import { join } from 'node:path';
import { readJson, listFiles } from '../store.mjs';
import { getJson, getText, pacer, realSleep } from './http.mjs';
import { FDIC_BASE, FDIC_FIELDS, orFilter, fdicPaths } from './fdic.mjs';
import { parseCmbsAssets, edgarPaths, SEC } from './edgar.mjs';

const check = (id, ok, summary, detail) => ({ id, ok: !!ok, summary, ...(detail ? { detail } : {}) });
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
  const fields = [...new Set(['CERT', ...FDIC_FIELDS.financials, 'NCRECONR', 'NCLNLSR', 'LNLSGR'])];
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
  }
  checks.push(check('fdic.ratios', !ratioDiffs.length && ratios > 0, ratioDiffs.length ? `${ratioDiffs.length} of ${ratios} ratios computed from our stored values disagree with FDIC's own (by more than 0.01 points).` : `All ${ratios} ratios computed from our stored values agree with FDIC's own published ratios (construction noncurrent, NCRECONR; total noncurrent, NCLNLSR).`, ratioDiffs.length ? { first: ratioDiffs.slice(0, 10) } : undefined));

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
