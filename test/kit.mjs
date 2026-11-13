// Shared test helpers. Every test works in a throwaway folder OUTSIDE the repository, with invented data only.
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const OUT = REPO;
export const loadJson = (rel) => JSON.parse(readFileSync(join(OUT, rel), 'utf8'));
export const config = () => structuredClone(loadJson('config.json'));
export const models = () => structuredClone(loadJson('models.json'));

export const makeDir = () => mkdtempSync(join(tmpdir(), 'outbound-test-'));
export const put = (dir, rel, data) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), typeof data === 'string' ? data : JSON.stringify(data, null, 2)); };

// Invented sender, account and contact. Nothing here is real.
export const SENDER = { id: 'pat', name: 'Pat Example', title: 'Principal', phone: '555-0100', address: '1 Example Way, Anytown', mailbox: 'pat@example.test' };

export const account = (over = {}) => ({
  id: 'acme-bank', name: 'Acme Community Bank', aliases: ['Acme Bancorp'], type: 'bank', audience: 'bank', sectors: ['hospitality'], tier: 'A',
  person: { name: 'Jordan Sample', title: 'Chief Credit Officer', email: 'jordan@acmebank.test', phone: '555-0199', phoneType: 'landline', timezone: 'America/Chicago', mailingAddress: '10 Main St, Anytown' },
  contact: { emailStatus: 'verified', roleConfirmed: true, provenance: [{ source: 'bank leadership page', date: '2026-11-01' }] },
  ...over,
});

export function ctxWith({ touches = [], suppression = [], senders = [SENDER], cfg = config(), kill = false } = {}) {
  return { config: cfg, suppression, touches, senders, kill };
}

export const touch = (a, over = {}) => ({
  accountId: a.id, institution: a.name, aliases: a.aliases, audience: a.audience, sector: 'hospitality', tier: a.tier, person: a.person, contact: a.contact,
  channel: 'letter', sender: 'pat', step: 1, date: '2026-11-16', ...over,
});

export const sent = (accountId, step, channel, date, sender = 'pat') => ({ type: 'touch', accountId, step, channel, sender, date });

// A fake Anthropic client. `replies` are used in order (the last repeats): a response object, an Error to throw, or a function of the request.
export function fakeClient(replies) {
  const calls = [];
  let i = 0;
  const next = async (params, kind) => {
    calls.push({ kind, params });
    const r = replies[Math.min(i++, replies.length - 1)];
    if (r instanceof Error) throw r;
    return typeof r === 'function' ? r(params) : r;
  };
  return { calls, messages: { create: (p) => next(p, 'messages') }, beta: { messages: { create: (p) => next(p, 'beta') } } };
}

export const textReply = (obj, extra = {}) => ({ content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj) }], stop_reason: 'end_turn', usage: { input_tokens: 1000, output_tokens: 500 }, model: 'fake-model', ...extra });
