// The only file that talks to the Anthropic API, through the official SDK. Everything else takes a `client`, so tests pass a fake.
// Self-contained on purpose (the website repository's news desk has a similar file).

export async function makeClient({ timeout = 180000 } = {}) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set. Export it to run the model stages, or use --dry-run to see the request without sending it.');
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  return new Anthropic({ maxRetries: 3, timeout });
}

// Untrusted data goes into a prompt as JSON with "<" escaped, so it cannot close the tag that wraps it.
export const neutralize = (value) => JSON.stringify(value).replace(/</g, '\\u003c');

export function estimateCost(usage, price) {
  if (!price || !usage) return null;
  const input = (usage.input_tokens ?? 0) + 1.25 * (usage.cache_creation_input_tokens ?? 0) + 0.1 * (usage.cache_read_input_tokens ?? 0);
  return (input * price.in + (usage.output_tokens ?? 0) * price.out) / 1e6;
}

export const addUsage = (a, b) => {
  const out = { ...a };
  for (const k of ['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens']) out[k] = (a?.[k] ?? 0) + (b?.[k] ?? 0);
  return out;
};

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

function request(client, params, cfg) {
  return cfg.fallbacks
    ? client.beta.messages.create({ ...params, betas: [FALLBACK_BETA], fallbacks: cfg.fallbacks })
    : client.messages.create(params);
}

// One structured request with no tools. Never throws: returns { ok: false, reason } for an API error, a refusal, a cut-off reply, or bad JSON.
export async function callJson({ client, cfg, system, messages, schema }) {
  const params = {
    model: cfg.model,
    max_tokens: cfg.maxTokens,
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages,
    output_config: { effort: cfg.effort, format: { type: 'json_schema', schema } },
  };
  let res;
  try { res = await request(client, params, cfg); }
  catch (e) { return { ok: false, reason: 'api_error', detail: `${e?.status ?? ''} ${String(e?.message ?? e).slice(0, 200)}`.trim() }; }
  const usage = res?.usage ?? {};
  if (res?.stop_reason === 'refusal') return { ok: false, reason: 'refusal', detail: res.stop_details?.category ?? '', usage };
  if (res?.stop_reason === 'max_tokens') return { ok: false, reason: 'max_tokens', usage };
  const text = (res?.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  try { return { ok: true, data: JSON.parse(text), text, usage, model: res.model ?? cfg.model }; }
  catch { return { ok: false, reason: 'invalid_json', usage }; }
}

// ---- The source ledger ------------------------------------------------------------------------------------------------------------
// Everything the research agent actually retrieved: the queries it ran, the URLs it was given, and the text it could read.
// Claims are checked against this, never against the model's say-so. The block shapes are read defensively because the exact
// layout of server-tool results was not available to check offline: anything not recognized is simply not trusted.

export const canonUrl = (u) => {
  try {
    const x = new URL(String(u).trim());
    return `${x.hostname.toLowerCase().replace(/^www\./, '')}${x.pathname.replace(/\/+$/, '')}${x.search}`.toLowerCase();
  } catch { return String(u ?? '').trim().toLowerCase(); }
};

export function newLedger() { return { queries: [], fetches: [], sources: new Map(), pool: [], errors: [] }; }

function addSource(ledger, url, patch = {}) {
  const k = canonUrl(url);
  const s = ledger.sources.get(k) ?? { url, title: '', retrievedAt: '', pageAge: '', texts: [] };
  if (patch.title && !s.title) s.title = String(patch.title);
  if (patch.retrievedAt && !s.retrievedAt) s.retrievedAt = String(patch.retrievedAt);
  if (patch.pageAge && !s.pageAge) s.pageAge = String(patch.pageAge);
  ledger.sources.set(k, s);
  return s;
}

const TEXT_KEYS = new Set(['data', 'text', 'stdout', 'content', 'cited_text', 'snippet']);

function walk(node, url, ledger) {
  if (Array.isArray(node)) { node.forEach((n) => walk(n, url, ledger)); return; }
  if (!node || typeof node !== 'object') return;
  if (node.error_code) ledger.errors.push(String(node.error_code));
  if (node.type === 'base64') return;                                    // binary documents are not text we can quote
  let here = url;
  if (typeof node.url === 'string') here = addSource(ledger, node.url, { title: node.title, retrievedAt: node.retrieved_at, pageAge: node.page_age }).url;
  for (const [k, v] of Object.entries(node)) {
    if (k === 'url' || k === 'encrypted_content' || k === 'encrypted_index') continue;
    if (typeof v === 'string' && TEXT_KEYS.has(k)) {
      if (here) addSource(ledger, here).texts.push(v); else ledger.pool.push(v);
    } else if (v && typeof v === 'object') walk(v, here, ledger);
  }
}

export function absorb(ledger, content) {
  for (const b of content ?? []) {
    if (b?.type === 'server_tool_use') {
      const input = b.input ?? {};
      if (b.name === 'web_search' && input.query) ledger.queries.push(String(input.query));
      if (b.name === 'web_fetch' && input.url) ledger.fetches.push(String(input.url));
    } else if (typeof b?.type === 'string' && b.type.endsWith('_tool_result')) {
      walk(b.content ?? b, null, ledger);
    } else if (b?.type === 'text' && Array.isArray(b.citations)) {
      for (const c of b.citations) if (c?.url) { const s = addSource(ledger, c.url, { title: c.title }); if (c.cited_text) s.texts.push(c.cited_text); }
    }
  }
}

export const normText = (s) => String(s ?? '').toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/&amp;/g, '&').replace(/[^a-z0-9$%]+/g, ' ').replace(/\s+/g, ' ').trim();

// 'no_source': the URL was never retrieved. 'verified': the quote is in text retrieved from that URL. 'verified_pool': the quote is in
// retrieved text we could not tie to a URL. 'unchecked': the URL was retrieved but we hold none of its text. 'failed': we hold its text and the quote is not in it.
export function checkQuote(ledger, url, quote) {
  const src = ledger.sources.get(canonUrl(url));
  if (!src) return 'no_source';
  const frags = String(quote ?? '').split(/\.{3}|…/).map(normText).filter((f) => f.length >= 12);
  if (!frags.length) return 'failed';
  const inText = (hay) => frags.every((f) => hay.includes(f));
  const own = normText(src.texts.join(' '));
  if (own && inText(own)) return 'verified';
  if (inText(normText(ledger.pool.join(' ')))) return 'verified_pool';
  return own ? 'failed' : 'unchecked';
}

export function extractJson(text) {
  const t = String(text ?? '').trim();
  const tries = [t, (t.match(/```(?:json)?\s*([\s\S]*?)```/) ?? [])[1], t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)];
  for (const c of tries) { if (!c) continue; try { const v = JSON.parse(c); if (v && typeof v === 'object') return v; } catch { /* next */ } }
  return null;
}

// A research run: web search and fetch run on Anthropic's servers; a long turn can pause and is sent back until it finishes.
// The model has no tool that acts in the world, so a hostile page cannot make it do anything. Never throws.
export async function callResearch({ client, cfg, system, user, ledger = newLedger() }) {
  const tools = [
    { type: 'web_search_20260209', name: 'web_search', max_uses: cfg.maxSearches },
    { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: cfg.maxFetches, ...(cfg.fetchBlockedDomains?.length ? { blocked_domains: cfg.fetchBlockedDomains } : {}) },
  ];
  const params = { model: cfg.model, max_tokens: cfg.maxTokens, system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }], tools, output_config: { effort: cfg.effort } };
  const messages = [{ role: 'user', content: user }];
  let usage = {};
  for (let turn = 1; turn <= cfg.maxTurns; turn++) {
    let res;
    try { res = await request(client, { ...params, messages }, cfg); }
    catch (e) { return { ok: false, reason: 'api_error', detail: `${e?.status ?? ''} ${String(e?.message ?? e).slice(0, 200)}`.trim(), ledger, usage, turns: turn }; }
    usage = addUsage(usage, res?.usage ?? {});
    absorb(ledger, res?.content);
    if (res?.stop_reason === 'refusal') return { ok: false, reason: 'refusal', detail: res.stop_details?.category ?? '', ledger, usage, turns: turn };
    if (res?.stop_reason === 'max_tokens') return { ok: false, reason: 'max_tokens', ledger, usage, turns: turn };
    if (res?.stop_reason === 'pause_turn') { messages.push({ role: 'assistant', content: res.content }); continue; }   // resume: no extra user message
    const text = (res?.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    return { ok: true, text, ledger, usage, turns: turn, model: res.model ?? cfg.model };
  }
  return { ok: false, reason: 'turn_limit', ledger, usage, turns: cfg.maxTurns };
}
