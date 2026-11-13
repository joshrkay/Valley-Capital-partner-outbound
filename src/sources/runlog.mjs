// The run log, the source block on every record, and amend-aware updates (PRD E2-S1, S3, S4).
// One line per run in sources/runs.jsonl, so a quiet quarter can be told from a broken feed.
// Logs hold counts and ids only: any string that looks like an email address or a phone number is redacted before writing.
import { join } from 'node:path';
import { appendJsonl, readJsonl } from '../store.mjs';

export const RUNS = (dir) => join(dir, 'sources', 'runs.jsonl');
export const CHANGES = (dir) => join(dir, 'sources', 'changes.jsonl');

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE = /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g;
export const scrub = (v) => {
  if (typeof v === 'string') return v.replace(EMAIL, '[redacted]').replace(PHONE, '[redacted]');
  if (Array.isArray(v)) return v.map(scrub);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrub(x)]));
  return v;
};

export const newRunId = (source, now = new Date()) => `${source}-${now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}-${Math.random().toString(36).slice(2, 6)}`;

// The query is part of the identity of a run: "suspect" compares only runs of the same source with the same query.
const queryKey = (q) => JSON.stringify(q ?? {});

export function startRun({ source, query, now = new Date(), runId }) {
  return { runId: runId ?? newRunId(source, now), source, query: query ?? {}, startedAt: now.toISOString() };
}

// Appends the run's single line. Outcome is "failed" if told so; otherwise "suspect" when this run read nothing but the previous
// run of the same source and query did, or when `suspect` is passed (for example a paging count mismatch); otherwise "ok".
// `nullCounts` records how many returned values were explicit nulls per field (allowed, but worth seeing).
export function finishRun(dir, run, { rowsRead = 0, rowsWritten = 0, rowsChanged = 0, outcome, missingFields = [], errors = [], notes = [], nullCounts = {}, suspect = false, now = new Date() } = {}) {
  let final = outcome;
  if (final !== 'failed') {
    const prev = readJsonl(RUNS(dir)).filter((r) => r.source === run.source && queryKey(r.query) === queryKey(run.query)).at(-1);
    final = suspect || (rowsRead === 0 && prev && prev.rowsRead > 0) ? 'suspect' : 'ok';
  }
  const line = scrub({ ...run, finishedAt: now.toISOString(), rowsRead, rowsWritten, rowsChanged, outcome: final, missingFields, errors, notes, nullCounts });
  appendJsonl(RUNS(dir), line);
  return line;
}

export const SOURCE_KEYS = ['source', 'endpoint', 'query', 'recordId', 'period', 'fetchedAt', 'runId'];

export function sourceBlock({ source, endpoint, query, recordId, period, fetchedAt, runId }) {
  const b = { source, endpoint, query, recordId: recordId === undefined || recordId === null ? recordId : String(recordId), period: period === undefined || period === null ? period : String(period), fetchedAt, runId };
  assertSourced({ _source: b });
  return b;
}

// Every stored record must say where it came from. The writer calls this on each record; a gap is a bug, not a warning.
export function assertSourced(record) {
  const s = record?._source;
  if (!s || typeof s !== 'object') throw new Error('Record has no _source block; every stored record must carry its provenance.');
  const missing = SOURCE_KEYS.filter((k) => s[k] === undefined || s[k] === null || s[k] === '');
  if (missing.length) throw new Error(`Record _source is missing: ${missing.join(', ')}.`);
  return record;
}

// Merges `incoming` over `existing`. A field that already had a different value is an amendment: it is logged with the old and new
// value so nothing silently changes under a score. New fields are inserts, not changes. `_source` is replaced, never diffed.
export function upsertWithChanges(existing, incoming, { key, runId, dir, now = new Date() }) {
  assertSourced(incoming);
  if (!existing) return { record: { ...incoming }, changed: 0 };
  let changed = 0;
  for (const [field, value] of Object.entries(incoming)) {
    if (field === '_source') continue;
    const old = existing[field];
    if (old === undefined || JSON.stringify(old) === JSON.stringify(value)) continue;
    appendJsonl(CHANGES(dir), scrub({ runId, key, field, old, new: value, at: now.toISOString() }));
    changed++;
  }
  return { record: { ...existing, ...incoming }, changed };
}
