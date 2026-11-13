// A fake Supabase REST API (PostgREST), in memory, for testing src/platform/client.mjs without a server. It speaks only what the client
// uses: GET on documents, log_lines and candidates with `or`, `eq`, `cs`, `order`, `limit`, `offset`; and the RPCs flush_uow,
// enqueue_job, claim_job and finish_job. Their rules (versions, roles) mirror the SQL in supabase/migrations, which test/db.test.mjs
// checks against a real Postgres. Keys and tokens are plain strings here: "service" is the worker's key; "user:<email>" is a signed-in
// user's session token; any other key is the public anon key.
export function fakePostgrest({ principals = ['pat@example.test'] } = {}) {
  const docs = new Map();      // path -> { path, kind, body, text, version }
  const lines = [];            // { id, path, line, by }
  const jobs = [];
  const candidates = new Map();
  const calls = [];
  let lineId = 0, jobId = 0;
  const hooks = { beforeFlush: null };

  const who = (h) => {
    // Like Supabase's gateway: a session token in Authorization identifies the caller; without one, the apikey itself does.
    if (!h.apikey) return { kind: 'none' };
    const token = h.Authorization ? String(h.Authorization).replace(/^Bearer /, '') : String(h.apikey);
    if (token === 'service') return { kind: 'service', name: 'service' };
    if (token.startsWith('user:')) { const email = token.slice(5); return principals.includes(email) ? { kind: 'principal', name: email } : { kind: 'user', name: email }; }
    return { kind: 'anon' };
  };
  const json = (status, data) => new Response(data === undefined ? '' : JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  const pgError = (status, code, message) => json(status, { code, message, details: null, hint: null });

  // `(path.eq."a",path.like."b/*")` -> predicate on a row's path
  function orPredicate(or) {
    if (!or) return () => true;
    const inner = or.replace(/^\(|\)$/g, '');
    const terms = []; let cur = '', inQ = false;
    for (let i = 0; i < inner.length; i++) {
      const c = inner[i];
      if (c === '\\' && inQ) { cur += c + inner[++i]; continue; }
      if (c === '"') inQ = !inQ;
      if (c === ',' && !inQ) { terms.push(cur); cur = ''; continue; }
      cur += c;
    }
    if (cur) terms.push(cur);
    const preds = terms.map((t) => {
      const m = /^path\.(eq|like)\."((?:\\.|[^"\\])*)"$/.exec(t);
      if (!m) throw new Error(`fake PostgREST: cannot parse filter term ${t}`);
      const raw = m[2].replace(/\\(.)/g, '\\$1');   // keep LIKE escapes; unescape quotes handled below
      if (m[1] === 'eq') { const v = m[2].replace(/\\(.)/g, '$1'); return (p) => p === v; }
      let re = '^';   // LIKE pattern with \ as the escape character; PostgREST's * is %
      for (let i = 0; i < raw.length; i++) {
        const c = raw[i];
        if (c === '\\') { re += raw[i + 1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); i++; continue; }
        if (c === '*' || c === '%') re += '.*'; else if (c === '_') re += '.'; else re += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }
      const rx = new RegExp(`${re}$`);
      return (p) => rx.test(p);
    });
    return (p) => preds.some((f) => f(p));
  }
  const page = (rows, s) => rows.slice(Number(s.get('offset') ?? 0), Number(s.get('offset') ?? 0) + Number(s.get('limit') ?? 1000));

  function flush(plan, actor) {
    if (hooks.beforeFlush) { const h = hooks.beforeFlush; hooks.beforeFlush = null; h(); }
    for (const d of plan.docs ?? []) {   // check every version first: all or nothing, like the SQL transaction
      const cur = docs.get(d.path)?.version ?? 0;
      if ((d.baseVersion ?? 0) !== cur) return pgError(409, '40001', `Conflict: ${d.path} ${cur ? 'changed' : 'was created by someone else'} since it was loaded.`);
    }
    for (const d of plan.docs ?? []) {
      const prev = docs.get(d.path);
      docs.set(d.path, { path: d.path, kind: d.kind, body: d.kind === 'json' ? d.body : null, text: d.kind === 'text' ? d.text : null, version: (prev?.version ?? 0) + 1, updated_by: actor });
      if (d.path === 'candidates/latest.json') {
        candidates.clear();
        for (const i of d.body.items ?? []) candidates.set(i.key, { key: i.key, tier: i.tier ?? null, score: i.score, distress: i.axes?.distress, fit: i.axes?.fit, timing: i.axes?.timing, name: i.name, metros: i.metros ?? [], sectors: i.sectors ?? [], filtered: (i.filtersFailed ?? []).length > 0, card: i.card?.text ?? null, period: i.latestRepdte ?? null, provisional: !!d.body.provisional, item: i });
      }
    }
    for (const l of plan.lines ?? []) lines.push({ id: ++lineId, path: l.path, line: l.line, by: actor });
    return json(200, { written: plan.docs?.length ?? 0, appended: plan.lines?.length ?? 0 });
  }

  async function fetchImpl(url, init = {}) {
    const u = new URL(url);
    const path = u.pathname.replace(/^\/rest\/v1\//, '');
    const s = u.searchParams;
    const caller = who(init.headers ?? {});
    calls.push({ method: init.method, path, query: Object.fromEntries(s), caller: caller.kind });
    const body = init.body ? JSON.parse(init.body) : {};
    const reader = caller.kind === 'service' || caller.kind === 'principal';
    if (caller.kind === 'none') return pgError(401, 'PGRST301', 'No API key found in request');

    if (init.method === 'GET') {
      if (caller.kind === 'anon') return pgError(401, '42501', 'permission denied');
      if (!reader) return json(200, []);   // row-level security: a signed-in non-principal sees no rows
      const pred = orPredicate(s.get('or'));
      if (path === 'documents') return json(200, page([...docs.values()].filter((d) => pred(d.path)).sort((a, b) => (a.path < b.path ? -1 : 1)).map(({ path: p, kind, body: b, text, version }) => ({ path: p, kind, body: b, text, version })), s));
      if (path === 'log_lines') return json(200, page(lines.filter((l) => pred(l.path)).map(({ path: p, line }) => ({ path: p, line })), s));
      if (path === 'candidates') {
        let rows = [...candidates.values()];
        const eq = (k) => s.get(k)?.replace(/^eq\./, '');
        if (s.get('key')) rows = rows.filter((r) => r.key === eq('key'));
        if (s.get('tier')) rows = rows.filter((r) => r.tier === eq('tier'));
        if (s.get('metros')) { const m = s.get('metros').replace(/^cs\.\{|\}$/g, ''); rows = rows.filter((r) => r.metros.includes(m)); }
        rows.sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity) || (a.key < b.key ? -1 : 1));
        const cols = (s.get('select') ?? '*').split(',');
        return json(200, page(rows, s).map((r) => (cols[0] === '*' ? r : Object.fromEntries(cols.map((c) => [c, r[c]])))));
      }
      return pgError(404, 'PGRST205', `Could not find the table public.${path}`);
    }

    if (init.method === 'POST' && path.startsWith('rpc/')) {
      const fn = path.slice(4);
      if (fn === 'flush_uow' || fn === 'enqueue_job') {
        if (!reader) return pgError(403, '42501', 'Not allowed: only an active principal or the service role may write.');
        if (fn === 'flush_uow') return flush(body.plan ?? {}, caller.name);
        if (!['sources.fdic', 'sources.edgar', 'sources.filings', 'score.run', 'research.run', 'draft.run'].includes(body.kind)) return pgError(400, '23514', 'new row for relation "jobs" violates check constraint "jobs_kind_check"');
        jobs.push({ id: ++jobId, kind: body.kind, params: body.params ?? {}, status: 'queued', requested_by: caller.name, result: null });
        return json(200, jobId);
      }
      if (fn === 'claim_job' || fn === 'finish_job') {
        if (caller.kind !== 'service') return pgError(403, '42501', 'Not allowed: only the worker may claim jobs.');
        if (fn === 'claim_job') { const j = jobs.find((x) => x.status === 'queued'); if (!j) return json(200, []); j.status = 'running'; return json(200, [{ ...j }]); }
        const j = jobs.find((x) => x.id === body.job_id && x.status === 'running');
        if (j) { j.status = body.ok ? 'done' : 'failed'; j.result = body.result ?? null; }
        return json(200, null);
      }
      return pgError(404, 'PGRST202', `Could not find the function public.${fn}`);
    }
    return pgError(405, 'PGRST100', 'method not allowed');
  }

  return { fetchImpl, docs, lines, jobs, candidates, calls, hooks };
}
