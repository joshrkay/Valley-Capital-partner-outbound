// A polite JSON client for public data sources (PRD E2-S5). Every adapter calls the network through here, so timeouts,
// retries and pacing are decided once. `fetchImpl` and `sleep` are injectable so tests never touch the network or wait.
// Retries only what a retry can fix: 429 (rate limited), 5xx and network errors. Any other 4xx is our mistake and fails at once.

export class HttpError extends Error {
  constructor(message, { status, url, attempts }) { super(message); this.name = 'HttpError'; this.status = status; this.url = url; this.attempts = attempts; }
}

export const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RETRYABLE = (status) => status === 429 || status >= 500;

export function buildUrl(url, params = {}) {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v));
  return u.toString();
}

// Retry-After may be seconds or an HTTP date; anything unreadable falls back to our own backoff.
function retryAfterMs(res, now = Date.now()) {
  const h = res?.headers?.get?.('retry-after');
  if (!h) return null;
  if (/^\d+$/.test(h.trim())) return Number(h) * 1000;
  const t = Date.parse(h);
  return Number.isNaN(t) ? null : Math.max(0, t - now);
}

export async function getJson(url, params = {}, { fetchImpl = globalThis.fetch, timeoutMs = 60000, retries = 3, backoffMs = 1000, maxBackoffMs = 30000, userAgent, sleep = realSleep } = {}) {
  const full = buildUrl(url, params);
  const headers = { accept: 'application/json' };
  if (userAgent) headers['user-agent'] = userAgent;
  let lastErr;
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    let res;
    try {
      res = await fetchImpl(full, { headers, signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      // Network failure or timeout: retryable.
      lastErr = new HttpError(`Network error calling ${url}: ${e.message}`, { status: 0, url, attempts: attempt });
      if (attempt > retries) throw lastErr;
      await sleep(Math.min(backoffMs * 2 ** (attempt - 1), maxBackoffMs));
      continue;
    }
    if (res.ok) {
      try { return await res.json(); } catch (e) { throw new HttpError(`Response from ${url} was not JSON: ${e.message}`, { status: res.status, url, attempts: attempt }); }
    }
    lastErr = new HttpError(`HTTP ${res.status} from ${url}`, { status: res.status, url, attempts: attempt });
    if (!RETRYABLE(res.status) || attempt > retries) throw lastErr;
    const wait = retryAfterMs(res) ?? backoffMs * 2 ** (attempt - 1);
    await sleep(Math.min(wait, maxBackoffMs));
  }
  throw lastErr;
}

// Spaces calls at least `minIntervalMs` apart. Sources are read sequentially, so this is the whole rate limit.
export function pacer(minIntervalMs = 0, { sleep = realSleep, now = () => Date.now() } = {}) {
  let last = -Infinity;
  return async () => {
    const wait = last + minIntervalMs - now();
    if (wait > 0) await sleep(wait);
    last = now();
  };
}
