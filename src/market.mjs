// The market data pack (PRD next-five E20-S1 and S2). Aggregate figures by metro, for the principals now and, once counsel answers
// (Q25), for a data section in the news desk's monthly Hotel loan watch, widened to multifamily and retail (decided 2026-11-16, D-M1).
// Deterministic, from stored data only: no network, no model. It names no bank, servicer, trust, property or person.
//
// FDIC: Call Reports are whole-bank figures, and branches show where a bank takes deposits, not where it lends. So each bank's
//   balances are split across the metros by its share of deposits there (the Summary of Deposits), the rest going to "elsewhere":
//   each dollar is counted once. Labelled a deposit-share proxy beside every figure. By Call Report category, since Call Reports do
//   not separate hotel or retail from other commercial property.
// CMBS: loans in our metros and buy-box sectors now in special servicing, new transfers in the quarter, and dispositions in the
//   quarter, by metro and buy-box sector. Counts and balances only.
// Left out by default (D-M2, decided): failures, FDIC loan sales and implied recoveries.
//
// The disclosure guard (S2, D-M3 decided: the strict defaults): a cell from too few contributors, or dominated by one, is suppressed;
// then complementary suppression, so no suppressed cell can be rebuilt from its row's or column's published total; a change is shown
// only when the cell is published in both quarters.
import { join } from 'node:path';
import { readJson, writeJson, writeText, listFiles, audit } from './store.mjs';
import { CATEGORIES, shiftQuarter } from './metrics.mjs';
import { fdicPaths } from './sources/fdic.mjs';
import { edgarPaths } from './sources/edgar.mjs';

export const marketPaths = (dir) => { const base = join(dir, 'market'); return { base, pack: (q, ext) => join(base, `${q}.${ext}`) }; };
export const LEFT_OUT = Object.freeze([
  'Failures and FDIC loan sales: the voice guide forbids riding a closure or a failure (D-M2).',
  'Implied recoveries from CMBS liquidations: not a price, and they could anchor a bid (D-S5, D-M2).',
]);
export const METHOD = Object.freeze({
  fdic: "Deposit-share proxy: each bank's Call Report balances are split across the metros by its share of deposits there (FDIC Summary of Deposits), the rest to elsewhere, so each dollar is counted once. Branches show where a bank takes deposits, not exactly where it lends. Call Reports do not separate hotel or retail loans from other commercial property.",
  cmbs: "CMBS loans in our metros and buy-box sectors, from the trusts' loan-level SEC filings (Form ABS-EE). A loan counts in its first metro. Balances are current, in dollars.",
});
const QE = /^\d{4}-(03-31|06-30|09-30|12-31)$/;
const rep = (iso) => iso.replace(/-/g, '');
const iso = (r) => `${r.slice(0, 4)}-${r.slice(4, 6)}-${r.slice(6, 8)}`;
const qStart = (q) => { const r = shiftQuarter(rep(q), -1); return iso(r); };   // exclusive lower bound: the previous quarter-end
const r4 = (x) => Math.round(x * 1e4) / 1e4;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// ---- The guard ---------------------------------------------------------------------------------------------------------------------
// A cell: { contributors: [{ id, size, groups? }] }. FDIC: contributors are banks; CMBS: loans, with groups { trust, servicer }.
export function primary(cell, rule) {
  const c = cell.contributors ?? [];
  const total = c.reduce((s, x) => s + x.size, 0);
  const why = [];
  if (c.length < rule.min) why.push(`fewer than ${rule.min} ${rule.unit}`);
  for (const [g, min] of Object.entries(rule.minGroups ?? {})) { const n = new Set(c.map((x) => x.groups?.[g]).filter(Boolean)).size; if (n < min) why.push(`fewer than ${min} ${g}s`); }
  if (total > 0 && c.some((x) => x.size / total > rule.maxShare)) why.push(`one ${rule.unit.replace(/s$/, '')} is over ${rule.maxShare * 100}% of it`);
  return why;
}

// Complementary suppression along each line (row, and column if asked) whose total is published or can be read from it: wherever a
// line has exactly one suppressed cell, the smallest other published cell in it is suppressed too, until nothing changes. The pack
// publishes no total across metros, so by default only rows (a metro's figures, whose all-CRE figure is their total) are lines.
export function complementary(grid, { axes = ['rows'] } = {}) {
  const rows = Object.keys(grid), cols = [...new Set(rows.flatMap((r) => Object.keys(grid[r])))];
  const lines = [...(axes.includes('rows') ? rows.map((r) => cols.filter((c) => grid[r][c]).map((c) => grid[r][c])) : []),
    ...(axes.includes('columns') ? cols.map((c) => rows.filter((r) => grid[r][c]).map((r) => grid[r][c])) : [])];
  let changed = true;
  while (changed) {
    changed = false;
    for (const line of lines) {
      const sup = line.filter((x) => x.suppressed);
      const open = line.filter((x) => !x.suppressed && x.size > 0).sort((a, b) => a.size - b.size);
      if (sup.length === 1 && open.length) { open[0].suppressed = true; open[0].reasons = [...(open[0].reasons ?? []), 'complementary: so a suppressed figure cannot be rebuilt from the total']; changed = true; }
    }
  }
  return grid;
}

// ---- FDIC by metro and category -------------------------------------------------------------------------------------------------
function fdicGrid({ fin, footprint, metros, repdte }) {
  const grid = {};
  for (const m of metros) {
    grid[m.cbsa] = {};
    for (const cat of [...CATEGORIES, { id: 'allCre', all: true }]) {
      const contributors = []; let bal = 0, nc = 0, na = 0;
      for (const [cert, f] of Object.entries(footprint)) {
        const s = f?.sod; const row = fin[cert]?.quarters?.[repdte];
        const dep = num(s?.depositsByMetro?.[m.cbsa]), tot = num(s?.totalDeposits);
        if (!row || !dep || !tot) continue;
        const share = Math.min(dep / tot, 1);
        const cats = cat.all ? CATEGORIES : [cat];
        const b = cats.reduce((x, c) => x + num(row[c.balance]), 0) * 1000 * share;
        if (b <= 0) continue;
        contributors.push({ id: cert, size: b });
        bal += b; nc += cats.reduce((x, c) => x + num(row[c.stages.noncurrent]), 0) * 1000 * share; na += cats.reduce((x, c) => x + num(row[c.stages.nonaccrual]), 0) * 1000 * share;
      }
      grid[m.cbsa][cat.id] = { contributors, size: bal, noncurrentRatio: bal ? r4(nc / bal) : null, nonaccrualRatio: bal ? r4(na / bal) : null, banks: contributors.length };
    }
  }
  return grid;
}

// ---- CMBS by metro and sector ---------------------------------------------------------------------------------------------------
function cmbsGrid({ items, metros, sectors, measure }) {
  const grid = Object.fromEntries(metros.map((m) => [m.cbsa, Object.fromEntries(sectors.map((s) => [s, { contributors: [], size: 0, count: 0, balance: 0 }]))]));
  for (const l of items) {
    const m = (l.metros ?? [])[0], s = (l.sectors ?? [])[0];
    const cell = grid[m]?.[s]; if (!cell) continue;
    const b = num(measure(l));
    cell.contributors.push({ id: l.key, size: Math.max(b, 1), groups: { trust: l.cik ?? l.trust, servicer: l.specialServicer } });
    cell.count++; cell.balance += b; cell.size += Math.max(b, 1);
  }
  return grid;
}

const guardGrid = (grid, rule) => { for (const r of Object.values(grid)) for (const c of Object.values(r)) { c.reasons = primary(c, rule); c.suppressed = c.reasons.length > 0; } return complementary(grid); };
const strip = (grid, pick) => Object.fromEntries(Object.entries(grid).map(([r, cols]) => [r, Object.fromEntries(Object.entries(cols).map(([k, c]) => [k, c.suppressed ? { suppressed: true, reasons: c.reasons } : pick(c)]))]));

// ---- The pack ---------------------------------------------------------------------------------------------------------------------
export function buildPack({ fin, footprint, loans, dispositions, metros, sectors, quarter, rules = {} }) {
  if (!QE.test(String(quarter ?? ''))) throw new Error('--quarter must be a quarter-end date (YYYY-03-31, 06-30, 09-30 or 12-31).');
  const r = rep(quarter);
  const fdicRule = { min: rules.minInstitutions ?? 5, maxShare: rules.maxShare ?? 0.5, unit: 'banks' };
  const cmbsRule = { min: rules.minLoans ?? 10, maxShare: rules.maxShare ?? 0.5, unit: 'loans', minGroups: { trust: rules.minTrusts ?? 3, servicer: rules.minServicers ?? 2 } };
  const at = (repdte) => guardGrid(fdicGrid({ fin, footprint, metros, repdte }), fdicRule);
  const now = at(r), prev = at(shiftQuarter(r, -1)), yago = at(shiftQuarter(r, -4));
  const chg = (a, b) => (a === null || b === null ? null : r4(a - b));
  const fdic = {};
  for (const [m, cols] of Object.entries(now)) {
    fdic[m] = {};
    for (const [k, c] of Object.entries(cols)) {
      if (c.suppressed) { fdic[m][k] = { suppressed: true, reasons: c.reasons }; continue; }
      const p = prev[m][k], y = yago[m][k];
      fdic[m][k] = { banks: c.banks, noncurrentRatio: c.noncurrentRatio, nonaccrualRatio: c.nonaccrualRatio,
        noncurrentChangeQoQ: p.suppressed ? null : chg(c.noncurrentRatio, p.noncurrentRatio), noncurrentChangeYoY: y.suppressed ? null : chg(c.noncurrentRatio, y.noncurrentRatio),
        ...(p.suppressed || y.suppressed ? { changeNote: 'a change is shown only when the figure is published in both quarters' } : {}) };
    }
  }
  const all = Object.values(loans ?? {});
  const inSS = all.filter((l) => (l.signals ?? []).some((s) => s.type === 'special_servicing' || s.type === 'note_sale'));
  const newT = all.filter((l) => l.specialServicingSince && l.specialServicingSince > qStart(quarter) && l.specialServicingSince <= quarter);
  const disp = Object.values(dispositions ?? {}).filter((d) => { const dt = d.liquidationDate ?? d.period; return dt && dt > qStart(quarter) && dt <= quarter; })
    .map((d) => ({ ...d, key: d.key, balance: d.beginningScheduledBalance ?? d.previousBalance ?? 1 }));
  const cm = (items, measure, withBalance) => strip(guardGrid(cmbsGrid({ items, metros, sectors, measure }), cmbsRule), (c) => ({ loans: c.count, ...(withBalance ? { balance: Math.round(c.balance) } : {}) }));
  const cmbsPeriod = all.map((l) => l.period).filter(Boolean).sort().at(-1) ?? null;
  return {
    kind: 'market-pack', quarter, method: METHOD, leftOut: [...LEFT_OUT], rules: { fdic: fdicRule, cmbs: cmbsRule },
    metros: metros.map((m) => ({ cbsa: m.cbsa, label: m.label })), categories: [...CATEGORIES.map((c) => ({ id: c.id, label: c.short })), { id: 'allCre', label: 'All CRE' }], sectors,
    fdic: { asOf: quarter, cells: fdic, source: { source: 'fdic', endpoint: '/financials and /sod', period: r } },
    cmbs: {
      asOf: cmbsPeriod, inSpecialServicing: cm(inSS, (l) => l.balance, true), newTransfers: cm(newT, (l) => l.balance, true),
      dispositions: cm(disp, (d) => d.balance, false), source: { source: 'edgar', endpoint: 'ABS-EE EX-102', period: cmbsPeriod },
      note: cmbsPeriod && cmbsPeriod < quarter ? `The CMBS data is as of ${cmbsPeriod}, before the quarter's end.` : null,
    },
  };
}

const pct = (x) => (x === null || x === undefined ? '–' : `${(x * 100).toFixed(2)}%`);
const pp = (x) => (x === null || x === undefined ? '–' : `${x >= 0 ? '+' : ''}${(x * 100).toFixed(2)} pts`);
const money = (x) => (x === null || x === undefined ? '–' : `$${Math.round(x).toLocaleString('en-US')}`);
const NS = 'not shown: too few sources';
export function renderPack(p) {
  const L = [`# Market data pack, quarter ending ${p.quarter}`, '', 'Aggregates only: no bank, servicer, trust, property or person is named. For the principals; publishing waits for counsel (Q25).', ''];
  L.push('## Banks: CRE noncurrent ratio by metro and Call Report category', '', p.method.fdic, '', `| Metro | ${p.categories.map((c) => c.label).join(' | ')} |`, `|---|${p.categories.map(() => '---').join('|')}|`);
  for (const m of p.metros) L.push(`| ${m.label} | ${p.categories.map((c) => { const x = p.fdic.cells[m.cbsa][c.id]; return x.suppressed ? NS : `${pct(x.noncurrentRatio)} (${x.banks} banks; q/q ${pp(x.noncurrentChangeQoQ)}, y/y ${pp(x.noncurrentChangeYoY)})`; }).join(' | ')} |`);
  const cmbsTable = (title, t, bal) => { L.push('', `## CMBS: ${title}`, '', `| Metro | ${p.sectors.join(' | ')} |`, `|---|${p.sectors.map(() => '---').join('|')}|`); for (const m of p.metros) L.push(`| ${m.label} | ${p.sectors.map((s) => { const x = t[m.cbsa][s]; return x.suppressed ? NS : `${x.loans} loan(s)${bal ? `, ${money(x.balance)}` : ''}`; }).join(' | ')} |`); };
  L.push('', p.method.cmbs, ...(p.cmbs.note ? ['', p.cmbs.note] : []));
  cmbsTable(`loans in special servicing (as of ${p.cmbs.asOf ?? '–'})`, p.cmbs.inSpecialServicing, true);
  cmbsTable('new transfers to special servicing in the quarter', p.cmbs.newTransfers, true);
  cmbsTable('dispositions in the quarter (count only)', p.cmbs.dispositions, false);
  L.push('', '## Left out', '', ...p.leftOut.map((x) => `- ${x}`), '', '## The disclosure rule', '',
    `- Banks: at least ${p.rules.fdic.min} banks in a figure, and no one bank over ${p.rules.fdic.maxShare * 100}% of it.`,
    `- CMBS: at least ${p.rules.cmbs.min} loans, ${p.rules.cmbs.minGroups.trust} trusts and ${p.rules.cmbs.minGroups.servicer} special servicers, and no one loan over ${p.rules.cmbs.maxShare * 100}% of the balance.`,
    "- Complementary suppression: where one of a metro's figures is hidden, another of that metro's is too, so it cannot be worked out from the metro's total. No total across metros is published; one must not be added by summing these figures. A change is shown only when the figure is published in both quarters.", '');
  return L.join('\n');
}

// Reads the stores, builds the pack and writes market/<quarter>.json and .md.
export function writePack({ dir, quarter, metros, buybox, config = {}, now = new Date() }) {
  const fp = fdicPaths(dir);
  const fin = Object.fromEntries(listFiles(join(fp.base, 'financials'), '.json').map((f) => [f.replace(/\.json$/, ''), readJson(join(fp.base, 'financials', f))]));
  const pack = buildPack({ fin, footprint: readJson(fp.footprint, {}), loans: readJson(edgarPaths(dir).loans, {}), dispositions: readJson(edgarPaths(dir).dispositions, {}),
    metros: metros.metros, sectors: buybox?.sectors?.include ?? ['hospitality', 'multifamily', 'retail'], quarter, rules: config.market ?? {} });
  pack.generatedAt = now.toISOString();
  const mp = marketPaths(dir);
  writeJson(mp.pack(quarter, 'json'), pack);
  writeText(mp.pack(quarter, 'md'), renderPack(pack));
  const cells = Object.values(pack.fdic.cells).flatMap((r) => Object.values(r));
  const counts = { fdicCells: cells.length, fdicSuppressed: cells.filter((c) => c.suppressed).length };
  audit(dir, { type: 'market_pack', quarter, ...counts });
  return { pack, paths: { json: mp.pack(quarter, 'json'), md: mp.pack(quarter, 'md') }, counts };
}
export const latestPack = (dir) => { const f = listFiles(marketPaths(dir).base, '.json').sort().at(-1); return f ? readJson(join(marketPaths(dir).base, f)) : null; };
