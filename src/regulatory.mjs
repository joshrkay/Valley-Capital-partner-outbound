// The regulatory record (PRD next-five E18-S4): for one bank, its enforcement orders (E18-S2: the Federal Reserve's, the FDIC's and the
// OCC's) and the open merger applications that name it (E18-S3), so the briefer and the call brief know of them and a principal does not
// walk into a call unaware. One file per bank, regulatory/<key>.json in the data folder, rebuilt by every scoring run (as the paper
// estimate is), from the stores alone: no network, no model.
//
// Where it goes, and where it never goes: the briefer reads it as fenced data with ids (src/research.mjs), the call brief cites it by id
// (src/calls.mjs). The drafter never receives it: LOADS.draft holds no regulatory/ or sources/ path, and a handoff test proves it. A
// message never mentions an order, a regulator or a pending merger; the linter rejects the words (terminology.json, banned).
import { join } from 'node:path';
import { readJson, writeJson, listFiles } from './store.mjs';
import { paperFileId } from './paper.mjs';
import { ordersByBank, TYPES, REGULATORS, ACTIVE_TYPES } from './sources/enforcement.mjs';
import { mergerSignals, mergerPaths, KINDS } from './sources/mergerapps.mjs';

export const regulatoryRel = (key) => `regulatory/${paperFileId(key)}.json`;
export const regulatoryPath = (dir, key) => join(dir, regulatoryRel(key));
// A key like fdic:CERT, with the colon as written, as "-" or as "_" (a platform document path cannot hold a colon), as for paper/.
const regulatoryPaths = (key) => {
  const k = String(key ?? '');
  if (!k || k.includes('/') || k.includes('..')) return [];
  return [...new Set([paperFileId(k), k, k.replace(/:/g, '-'), k.replace(/[^A-Za-z0-9_.-]/g, '_')])].map((f) => `regulatory/${f}.json`);
};
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

// The record for every bank with an order or an open application, keyed by bank key. Each order and application keeps its own id
// (the store's key), so a brief can cite it. Fixed labels from code: no order text, no reason, no person.
export function buildRegulatory({ dir, institutions, asOf, activeWithinDays = 3650, maxOrders = 20 }) {
  const out = {};
  const ensure = (k) => (out[k] ??= { key: k, asOf, orders: [], mergers: [] });
  for (const [k, list] of ordersByBank({ dir })) {
    const terminated = new Map(list.filter((r) => r.kind === 'termination' && r.terminates).map((r) => [r.terminates, r.date]));
    for (const r of list.slice(0, maxOrders)) {
      const reg = REGULATORS[r.regulator] ?? r.regulator;
      const endedOn = r.terminatedOn ?? terminated.get(r.key) ?? null;
      const inForce = r.kind === 'order' && ACTIVE_TYPES.includes(r.type) && !endedOn && (!asOf || r.date >= addDays(asOf, -activeWithinDays));
      ensure(k).orders.push({
        id: r.key, regulator: reg, kind: r.kind, type: r.kind === 'termination' ? `termination of a ${TYPES[r.terminatesType] ?? TYPES.other}` : TYPES[r.type] ?? TYPES.other,
        date: r.date, dateBasis: r.dateBasis ?? 'order', terminatedOn: endedOn, inForce, phrasesInTheOrder: r.flags?.found ?? [], link: r.link ?? null,
      });
    }
  }
  const apps = readJson(mergerPaths(dir).applications, {});
  for (const [k, list] of Object.entries(mergerSignals({ dir, institutions }))) {
    for (const s of list) {
      const a = apps[s.evidence[0]];
      ensure(k).mergers.push({
        id: s.evidence[0], kind: KINDS[s.applicationKind] ?? s.applicationKind, role: s.role === 'acquirer' ? 'acquirer' : 'bank acquired', filedWeekEnding: s.date,
        commentPeriodEnds: s.commentEnds ?? null, approvedOn: s.approvedOn ?? null, otherParties: (a?.parties ?? []).filter((p) => p.role !== s.role).map((p) => `${p.name}${p.state ? `, ${p.state}` : ''}`), link: s.link,
      });
    }
  }
  return out;
}

// Writes one file per bank with a record, and empties the file of a bank whose record is gone, so no stale order outlives its store.
// Returns the count written. Called by runScoring.
export function writeRegulatory({ dir, records }) {
  let written = 0;
  const keep = new Set();
  for (const [k, rec] of Object.entries(records)) { writeJson(regulatoryPath(dir, k), rec); keep.add(`${paperFileId(k)}.json`); written++; }
  for (const f of listFiles(join(dir, 'regulatory'), '.json')) {
    if (keep.has(f)) continue;
    const old = readJson(join(dir, 'regulatory', f), null);
    if (old && (old.orders?.length || old.mergers?.length)) writeJson(join(dir, 'regulatory', f), { ...old, orders: [], mergers: [] });
  }
  return written;
}

export function readRegulatory(dir, key) {
  for (const rel of regulatoryPaths(key)) {
    const r = readJson(join(dir, rel), null);
    if (r && typeof r === 'object' && (r.orders?.length || r.mergers?.length)) return { path: rel, record: r };
  }
  return null;
}
