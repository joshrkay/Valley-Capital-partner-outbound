// The engine's way into the platform database (PRD E12-S3): Supabase's REST API (PostgREST) over plain fetch, so the engine gains no
// dependency. It loads what a unit of work needs, writes the plan back through flush_uow() in one transaction, and runs the job queue.
// Who the caller is comes from the key and token it sends: a principal's session token in the web app, the service key in the worker.
// The database enforces every rule (supabase/migrations); this client only speaks the protocol.
import { withUnitOfWork } from '../uow.mjs';

export class PlatformError extends Error {
  constructor(message, { status, code, details } = {}) { super(message); this.name = 'PlatformError'; this.status = status; this.code = code; this.details = details; }
}
export class ConflictError extends PlatformError {
  constructor(message, opts) { super(message, opts); this.name = 'ConflictError'; }
}

// A PostgREST filter value in double quotes, so commas, dots and parentheses in a path are taken literally.
const q = (v) => `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
// In LIKE, % and _ are wildcards; PostgREST writes % as *. Escape what is literal in a path prefix.
const likePrefix = (p) => `${p.replace(/\\/g, '\\\\').replace(/[%_*]/g, (c) => `\\${c}`)}*`;

// One PostgREST `or` filter covering every prefix: a folder ("accounts/") by LIKE, an exact path by equality. Empty covers everything.
export function pathFilter(prefixes) {
  if (!prefixes.length || prefixes.includes('')) return null;
  const parts = prefixes.map((p) => (p.endsWith('/') ? `path.like.${q(likePrefix(p))}` : `path.eq.${q(p)}`));
  return `(${parts.join(',')})`;
}

export function platformClient({ url, key, accessToken, fetchImpl = globalThis.fetch, pageSize = 1000 } = {}) {
  if (!url || !key) throw new Error('platformClient needs the project URL and a key (SUPABASE_URL, and the anon key with a user session or the service key).');
  const base = `${String(url).replace(/\/$/, '')}/rest/v1`;
  const headers = { apikey: key, Authorization: `Bearer ${accessToken ?? key}`, 'Content-Type': 'application/json', Accept: 'application/json' };

  async function call(method, path, { query = {}, body } = {}) {
    const u = new URL(`${base}/${path}`);
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
    const res = await fetchImpl(u.toString(), { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const msg = data?.message ?? `${method} ${path} failed with HTTP ${res.status}`;
      const Err = data?.code === '40001' ? ConflictError : PlatformError;
      throw new Err(msg, { status: res.status, code: data?.code, details: data?.details });
    }
    return data;
  }

  // Every row a filter matches, page by page (Supabase caps a response at 1,000 rows by default).
  async function all(table, query) {
    const rows = [];
    for (let offset = 0; ; offset += pageSize) {
      const page = await call('GET', table, { query: { ...query, limit: pageSize, offset } });
      rows.push(...page);
      if (page.length < pageSize) return rows;
    }
  }

  async function load(prefixes) {
    const or = pathFilter(prefixes);
    const docs = await all('documents', { select: 'path,kind,body,text,version', order: 'path', or });
    const lines = await all('log_lines', { select: 'path,line', order: 'id', or });
    const snap = { docs: {}, texts: {}, logs: {}, versions: {} };
    for (const d of docs) { if (d.kind === 'json') snap.docs[d.path] = d.body; else snap.texts[d.path] = d.text; snap.versions[d.path] = d.version; }
    for (const l of lines) (snap.logs[l.path] ??= []).push(l.line);
    return snap;
  }

  const flush = (plan) => call('POST', 'rpc/flush_uow', { body: { plan } });

  return {
    load, flush,
    // Runs fn(dir) in a unit of work. A conflict (someone changed a document meanwhile) reloads and runs again up to `retries` times.
    // Pass retries: 0 for anything that spends money or acts in the world (a model call): it is reported, not repeated.
    async unitOfWork(prefixes, fn, { retries = 1 } = {}) {
      for (let attempt = 0; ; attempt++) {
        try { return await withUnitOfWork({ load, flush }, prefixes, fn); }
        catch (e) { if (!(e instanceof ConflictError) || attempt >= retries) throw e; }
      }
    },
    enqueue: (kind, params = {}) => call('POST', 'rpc/enqueue_job', { body: { kind, params } }),
    async claimJob() { const rows = await call('POST', 'rpc/claim_job', { body: {} }); return rows?.[0] ?? null; },
    finishJob: (id, ok, result = null) => call('POST', 'rpc/finish_job', { body: { job_id: id, ok, result } }),
    // The candidate list for the web app: the projection's summary columns only, best first.
    candidates({ tier, metro, limit = 200, offset = 0 } = {}) {
      return call('GET', 'candidates', { query: {
        select: 'key,tier,score,distress,fit,timing,name,metros,sectors,filtered,card,period,provisional',
        order: 'score.desc.nullslast,key', tier: tier ? `eq.${tier}` : undefined, metros: metro ? `cs.{${metro}}` : undefined, limit, offset,
      } });
    },
    candidate: async (key) => (await call('GET', 'candidates', { query: { select: 'item', key: `eq.${key}` } }))?.[0]?.item ?? null,
  };
}
