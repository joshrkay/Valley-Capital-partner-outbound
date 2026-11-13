// Server only. Small reads the engine's platform client does not offer (principals, jobs, run log lines), made the same way: Supabase's
// REST API with the anon key and the signed-in principal's token, so row-level security decides what comes back.
export function restReader({ url, key, accessToken, fetchImpl = globalThis.fetch }) {
  const base = `${String(url).replace(/\/$/, '')}/rest/v1`;
  const headers = { apikey: key, Authorization: `Bearer ${accessToken ?? key}`, Accept: 'application/json' };
  async function get(table, query = {}) {
    const u = new URL(`${base}/${table}`);
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
    const res = await fetchImpl(u.toString(), { method: 'GET', headers });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) throw new Error(data?.message ?? `Reading ${table} failed (HTTP ${res.status}).`);
    return data ?? [];
  }
  return {
    get,
    // The signed-in user's principal row, or null. Row-level security returns no row to anyone who is not an active principal.
    async principal(email) {
      if (!email) return null;
      const rows = await get('principals', { select: 'email,name,active', email: `eq.${String(email).toLowerCase()}`, limit: 1 });
      const p = rows[0];
      return p && p.active ? p : null;
    },
    jobs: (limit = 25) => get('jobs', { select: 'id,kind,params,status,requested_by,created_at,started_at,finished_at,result', order: 'id.desc', limit }),
    runs: (limit = 20) => get('log_lines', { select: 'line,at', path: 'eq.sources/runs.jsonl', order: 'id.desc', limit }),
    killDocument: async () => (await get('documents', { select: 'path', path: 'eq.KILL', limit: 1 })).length > 0,
  };
}
