// Signal coverage (PRD next-five E18-S1). For Tier A, Tier B and all candidates: how many each signal source can see, so the principals
// build the sources that close the biggest gap. The SEC filings listener sees only banks with a confirmed filer; CMBS data sees
// servicers, not banks; the sale ledger sees banks that have sold. Enforcement orders (E18-S2) are not built yet, and say so.
//
// Code only, no model and no network: every count comes from stored files, and every sentence is a fixed template. The same stored data
// always gives the same report. The report holds counts only and names no bank, so it can be shown on the Status page and carried in a
// log. A share always states its denominator; a group with no bank has no share, never a division by zero.
import { join } from 'node:path';
import { readJson } from './store.mjs';
import { norm } from './guard.mjs';
import { matchInstitution } from './candidates.mjs';
import { periodLabel } from './metrics.mjs';
import { groupBySeller } from './sales.mjs';
import { mappingStatus } from './sources/filers.mjs';

// The stored files the report reads, and nothing else (LOADS.coverage in src/uow.mjs lists the same paths).
export const COVERAGE_PATHS = Object.freeze({
  latest: 'candidates/latest.json',
  aliases: 'candidates/aliases.json',
  filers: 'sources/edgar/filers.json',
  servicers: 'sources/edgar/servicers.json',
  ledger: 'sales/ledger.json',
});

export const INTRO = 'Which candidates each signal source can see, from stored data only: no network, no model. Counts only; no bank is named.';
export const GROUPS = Object.freeze([['A', 'Tier A'], ['B', 'Tier B'], ['all', 'All candidates']]);

// The stores a source writes. One that is absent has never run, so a zero on its lines is not a measurement.
const STORES = Object.freeze([
  { id: 'filers', path: COVERAGE_PATHS.filers, label: 'the bank-to-filer map', how: 'outbound filers suggest, then confirm or reject' },
  { id: 'servicers', path: COVERAGE_PATHS.servicers, label: 'the CMBS pull', how: 'outbound sources run edgar' },
  { id: 'ledger', path: COVERAGE_PATHS.ledger, label: 'the sale ledger', how: 'outbound sales build' },
]);

// One line per source, in a fixed order. `test` reads the facts worked out for one candidate below. A source that is not built has no
// test: its cells say "not built", with no count.
const ROWS = Object.freeze([
  { id: 'sec-confirmed', label: 'Confirmed SEC filer', store: 'filers', test: (f) => f.filer === 'confirmed',
    basis: 'A principal confirmed an SEC filer that files for the bank, usually its holding company (outbound filers confirm). The filings listener searches these only.' },
  { id: 'sec-not-confirmed', label: 'Rejected or unmapped filer', store: 'filers', test: (f) => f.filer !== 'confirmed',
    basis: 'No confirmed filer, so the filings listener cannot see the bank.' },
  { id: 'sec-rejected', parent: 'sec-not-confirmed', label: 'rejected only', store: 'filers', test: (f) => f.filer === 'rejected',
    basis: 'Every filer recorded for the bank was rejected by a principal.' },
  { id: 'sec-unmapped', parent: 'sec-not-confirmed', label: 'not mapped yet', store: 'filers', test: (f) => f.filer === 'unmapped',
    basis: 'No filer is recorded for the bank: outbound filers suggest found none, or a principal has not decided on its suggestions yet.' },
  { id: 'cmbs', label: 'CMBS link (special servicer)', store: 'servicers', test: (f) => f.cmbs,
    basis: 'The bank is named as the special servicer of a CMBS loan in our metros and sectors, or of a CMBS liquidation in the sale ledger, by its exact name or an alias a principal added (candidates/aliases.json). CMBS data describes servicers\' loans, not banks\' own.' },
  { id: 'sale', label: 'Sale-ledger event (as the seller)', store: 'ledger', test: (f) => f.sale,
    basis: 'The sale ledger holds a supported event with the bank as the seller that acted, as outbound sales sellers shows; a special servicer is matched by its name as above. An acquirer is not counted.' },
  { id: 'enforcement', label: 'Enforcement record', built: false,
    basis: 'Not built yet (PRD next-five E18-S2). Shown as not built, never as zero.' },
]);
export const COVERAGE_ROWS = Object.freeze(ROWS.map((r) => r.id));

const round4 = (x) => Math.round(x * 10000) / 10000;
const listWords = (xs) => (xs.length <= 1 ? xs.join('') : xs.length === 2 ? `${xs[0]} and ${xs[1]}` : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
const cell = (count, of) => (of > 0
  ? { count, of, share: round4(count / of), text: `${count} of ${of} (${((count / of) * 100).toFixed(1)}%)` }
  : { count, of, share: null, text: `${count} of ${of}` });
const notBuilt = (of) => ({ count: null, of, share: null, text: 'not built' });

// The report, from the stored documents themselves (each one null when it is not in the data folder). Pure: no clock, no I/O.
// latest: candidates/latest.json; aliases: candidates/aliases.json; filers: sources/edgar/filers.json; servicers:
// sources/edgar/servicers.json; ledger: sales/ledger.json.
export function buildCoverage({ latest = null, aliases = null, filers = null, servicers = null, ledger = null } = {}) {
  const items = (Array.isArray(latest?.items) ? latest.items : []).filter((i) => i && typeof i.key === 'string');
  const keys = new Set(items.map((i) => i.key));

  // A name in the CMBS data or the ledger is a candidate only by its exact name or a principal's alias (matchInstitution); never fuzzier.
  const institutions = Object.fromEntries(items.filter((i) => /^fdic:\d+$/.test(i.key)).map((i) => [i.key.slice(5), { NAME: i.name ?? '' }]));
  const candidateFor = (name) => { const m = matchInstitution(name, { institutions, aliases: aliases ?? {} }); return m.key && keys.has(m.key) ? m.key : null; };

  // Sellers that acted (a CMBS trust sells through its special servicer), from the ledger's supported events.
  const sellers = groupBySeller(ledger ?? { events: {} });
  const sold = new Set();
  for (const s of sellers) {
    const k = s.key && keys.has(s.key) ? s.key : s.kind === 'servicer' ? candidateFor(s.name) : null;
    if (k) sold.add(k);
  }

  // Special servicers: every one the CMBS pull summarised, and every one that acted for a CMBS liquidation in the ledger.
  const names = new Map();
  for (const n of [...Object.entries(servicers ?? {}).map(([k, v]) => v?.name ?? k), ...sellers.filter((s) => s.kind === 'servicer').map((s) => s.name)]) {
    const k = norm(n);
    if (k && k !== 'unknown' && !names.has(k)) names.set(k, n);
  }
  const linked = new Set();
  let matched = 0;
  for (const n of names.values()) { const k = candidateFor(n); if (k) { linked.add(k); matched++; } }

  const facts = new Map(items.map((i) => [i.key, { filer: mappingStatus(filers?.[i.key]), cmbs: linked.has(i.key), sale: sold.has(i.key) }]));
  const groups = GROUPS.map(([id, label]) => ({ id, label, members: items.filter((i) => id === 'all' || i.tier === id) }));
  const present = { filers: filers !== null, servicers: servicers !== null, ledger: ledger !== null };

  const rows = ROWS.map((r) => {
    const built = r.built !== false;
    const cells = Object.fromEntries(groups.map((g) => [g.id, built ? cell(g.members.filter((i) => r.test(facts.get(i.key))).length, g.members.length) : notBuilt(g.members.length)]));
    return { id: r.id, label: r.label, parent: r.parent ?? null, built, basis: r.basis, notRun: built ? !present[r.store] : false,
      ...(r.id === 'cmbs' ? { detail: { servicerNames: names.size, matched, text: `${names.size} special servicer name${names.size === 1 ? '' : 's'} in the stored CMBS data; ${matched} ${matched === 1 ? 'matches' : 'match'} a candidate. Nothing fuzzier is counted.` } } : {}), cells };
  });

  const empty = items.length === 0;
  const missing = STORES.filter((s) => !present[s.id]);
  return {
    version: 1,
    intro: INTRO,
    candidates: latest ? { runId: latest.runId ?? null, scoredAt: latest.scoredAt ?? null, latestRepdte: latest.latestRepdte ?? null, provisional: !!latest.provisional } : null,
    empty,
    note: !empty ? null : latest ? 'No candidates yet: the latest scoring run scored no bank.' : 'No candidates yet: no scoring run has stored a candidate list. Run: outbound score run',
    groups: groups.map((g) => ({ id: g.id, label: g.label, total: g.members.length, note: g.members.length ? null : `No ${g.id === 'all' ? '' : `${g.label} `}candidates.` })),
    rows,
    stores: STORES.map((s) => ({ id: s.id, path: s.path, label: s.label, how: s.how, present: present[s.id] })),
    notRunNote: missing.length ? `Not run yet: ${listWords(missing.map((s) => `${s.label} (${s.path}; ${s.how})`))}. A 0 on ${missing.length === 1 ? 'its lines' : 'their lines'} means the source has not run, not that it sees nothing.` : null,
  };
}

// The same report from a data folder (or a unit of work's mount): reads only COVERAGE_PATHS.
export function coverageReport({ dir }) {
  const read = (rel) => readJson(join(dir, rel), null);
  return buildCoverage(Object.fromEntries(Object.entries(COVERAGE_PATHS).map(([k, rel]) => [k, read(rel)])));
}

// ---- The written report ----------------------------------------------------------------------------------------------------------
// Fixed templates over the report; nothing here adds a fact the report does not hold.
export function renderCoverage(r) {
  const L = [`# Signal coverage`, '', r.intro, ''];
  const c = r.candidates;
  if (c && !r.empty) {
    const asOf = /^\d{8}$/.test(String(c.latestRepdte ?? '')) ? `, data as of ${periodLabel(c.latestRepdte)}` : '';
    L.push(`- Candidates: ${c.runId ? `scoring run ${c.runId}` : 'the latest scoring run'}${asOf}. Every bank the run scored is counted, including any a principal has snoozed, dismissed or promoted, and any that is suppressed.`);
    if (c.provisional) L.push('- PROVISIONAL: the buy box still has placeholders, so the tiers are not final.');
  }
  if (r.note) L.push(`- ${r.note}`);
  for (const g of r.groups) if (g.note && !r.empty) L.push(`- ${g.note}`);
  L.push('');

  const header = ['Source', ...r.groups.map((g) => `${g.label} (${g.total})`)];
  const body = r.rows.map((x) => [`${x.parent ? '  ' : ''}${x.label}`, ...r.groups.map((g) => x.cells[g.id].text)]);
  const widths = header.map((_, i) => Math.max(...[header, ...body].map((row) => row[i].length)));
  const line = (row) => row.map((v, i) => (i === row.length - 1 ? v : v.padEnd(widths[i] + 2))).join('');
  L.push(line(header), ...body.map(line), '', '## What each line counts', '');
  for (const x of r.rows) {
    let t = `- ${x.parent ? `${x.label[0].toUpperCase()}${x.label.slice(1)}` : x.label}: ${x.basis}`;
    if (x.detail) t += ` ${x.detail.text}`;
    L.push(x.parent ? `  ${t}` : t);
  }
  if (r.notRunNote) L.push('', r.notRunNote);
  return `${L.join('\n')}\n`;
}
