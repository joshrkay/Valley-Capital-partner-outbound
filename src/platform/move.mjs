// Moving data between a data folder and the platform (PRD E12-S6). `push` copies a folder in and can be run again safely: a document
// whose content is already there is skipped, and only log lines the database does not have yet are appended. `pull` writes everything
// back out to an empty folder outside the repository, so the firm always holds a copy it can read without the platform.
import { existsSync, readdirSync } from 'node:fs';
import { snapshotFromDir, applyPlanToDir } from '../uow.mjs';
import { insideRepo } from '../paths.mjs';

// JSON with keys sorted, so a document read back from Postgres (which reorders keys) compares equal to the same document from a file.
const stable = (v) => (Array.isArray(v) ? `[${v.map(stable).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}` : JSON.stringify(v));

export async function push({ client, dir, chunkBytes = 2_000_000 }) {
  if (!existsSync(dir)) throw new Error(`No data folder at ${dir}.`);
  const snap = snapshotFromDir(dir);
  const current = await client.load(['']);
  const docs = [];
  let skipped = 0;
  for (const [path, body] of Object.entries(snap.docs)) {
    if (path in current.docs && stable(current.docs[path]) === stable(body)) { skipped++; continue; }
    docs.push({ path, kind: 'json', body, baseVersion: current.versions[path] ?? 0 });
  }
  for (const [path, text] of Object.entries(snap.texts)) {
    if (current.texts[path] === text) { skipped++; continue; }
    docs.push({ path, kind: 'text', text, baseVersion: current.versions[path] ?? 0 });
  }
  // A log is append-only: the database is assumed to hold a prefix of the folder's log, and only the rest is sent.
  const lines = Object.entries(snap.logs).flatMap(([path, ls]) => ls.slice(current.logs[path]?.length ?? 0).map((line) => ({ path, line })));

  // Sent in chunks so no single request is huge. Each chunk is atomic; the push as a whole is not, which is why it is safe to re-run.
  const chunks = [];
  let cur = { docs: [], lines: [] }, size = 0;
  for (const d of docs) {
    const n = JSON.stringify(d).length;
    if (size + n > chunkBytes && cur.docs.length) { chunks.push(cur); cur = { docs: [], lines: [] }; size = 0; }
    cur.docs.push(d); size += n;
  }
  cur.lines = lines;
  if (cur.docs.length || cur.lines.length) chunks.push(cur);
  for (const c of chunks) await client.flush(c);
  return { written: docs.length, skipped, appended: lines.length, requests: chunks.length };
}

export async function pull({ client, to }) {
  if (!to) throw new Error('Say where to write: --to DIR (a new or empty folder outside this repository).');
  if (insideRepo(to)) throw new Error(`${to} is inside the repository. Prospect data must never be written there.`);
  if (existsSync(to) && readdirSync(to).length) throw new Error(`${to} is not empty. Pull writes only to a new or empty folder.`);
  const snap = await client.load(['']);
  applyPlanToDir({
    docs: [...Object.entries(snap.docs).map(([path, body]) => ({ path, kind: 'json', body })), ...Object.entries(snap.texts).map(([path, text]) => ({ path, kind: 'text', text }))],
    lines: Object.entries(snap.logs).flatMap(([path, ls]) => ls.map((line) => ({ path, line }))),
  }, to);
  return { documents: Object.keys(snap.docs).length + Object.keys(snap.texts).length, logLines: Object.values(snap.logs).reduce((n, l) => n + l.length, 0) };
}
