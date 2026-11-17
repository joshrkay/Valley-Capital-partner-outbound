// Shared test helpers. Every test works in a throwaway folder OUTSIDE the repository, with invented data only.
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const OUT = REPO;
export const loadJson = (rel) => JSON.parse(readFileSync(join(OUT, rel), 'utf8'));
// As loadRules() gives it: config.json, with the contact rules (contacts.json) as config.contacts, which the guard reads.
export const config = () => structuredClone({ ...loadJson('config.json'), contacts: loadJson('contacts.json') });
export const models = () => structuredClone(loadJson('models.json'));
// The [CONFIRM] contacts config.json shipped with until a principal filled them (PRD Q11, E16-S2, next-five E18), one per section that
// sends a User-Agent. A test of the placeholder behaviour sets one on its own copy of the config, so it holds whatever config.json ships.
export const PLACEHOLDER_UA = Object.freeze({
  sec: '[CONFIRM: firm name and contact email for SEC fair access]',
  fdic: '[CONFIRM: firm name and a monitored business contact for FDIC requests; no personal email]',
  enforcement: '[CONFIRM: optional; firm name and a monitored business contact for Federal Reserve requests]',
  mergers: '[CONFIRM: optional; firm name and a monitored business contact for Federal Reserve requests]',
});
// The shipped buy box with the [CONFIRM] values buybox.json shipped with put back, until a principal filled them (PRD E0-S1, Q1). A test of
// the placeholder behaviour (the refusal, PROVISIONAL output, conditions the data cannot measure, a failed job) uses this, so it holds
// whatever buybox.json ships.
export const placeholderBuybox = () => {
  const b = structuredClone(loadJson('buybox.json'));
  return {
    ...b,
    sectors: { ...b.sectors, shortTermRentalPortfolios: '[CONFIRM: in or out of the buy box? PRD Q1]' },
    loanSize: { ...b.loanSize, minUsd: '[CONFIRM: smallest loan balance we buy]', maxUsd: '[CONFIRM: largest loan balance we buy]' },
    statuses: '[CONFIRM: which of performing, sub-performing, non-performing, foreclosed (REO)]',
    lien: '[CONFIRM: first lien only, or also junior liens]',
    exclusions: ['[CONFIRM: what the firm will not touch (property types, loan types, situations)]'],
  };
};

export const makeDir = () => mkdtempSync(join(tmpdir(), 'outbound-test-'));
export const put = (dir, rel, data) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), typeof data === 'string' ? data : JSON.stringify(data, null, 2)); };

// Invented sender, account and contact. Nothing here is real.
export const SENDER = { id: 'pat', name: 'Pat Example', title: 'Principal', phone: '555-0100', address: '1 Example Way, Anytown', mailbox: 'pat@example.test' };

// A complete contact (PRD E7-S3): every field sourced, the address verified by a principal on 2026-11-01, the role confirmed.
const SEEN = { kind: 'institution_site', url: 'https://acmebank.test/leadership', seenOn: '2026-11-01', by: 'Pat Example', at: '2026-11-01T12:00:00.000Z' };
export const CONTACT = (over = {}) => ({
  emailStatus: 'verified', roleConfirmed: true,
  provenance: [{ field: 'name', value: 'Jordan Sample', ...SEEN }, { field: 'title', value: 'Chief Credit Officer', ...SEEN }, { field: 'email', value: 'jordan@acmebank.test', ...SEEN }, { field: 'phone', value: '555-0199', ...SEEN }, { field: 'mailingAddress', value: '10 Main St, Anytown', ...SEEN }],
  verification: { email: 'jordan@acmebank.test', method: 'institution_site', url: 'https://acmebank.test/leadership', seenOn: '2026-11-01', by: 'Pat Example', at: '2026-11-01T12:00:00.000Z', verifiedOn: '2026-11-01', checks: { syntax: 'pass', business: 'pass', domain: 'acmebank.test', mx: 'pass' } },
  ...over,
});

export const account = (over = {}) => ({
  id: 'acme-bank', name: 'Acme Community Bank', aliases: ['Acme Bancorp'], type: 'bank', audience: 'bank', sectors: ['hospitality'], tier: 'A',
  person: { name: 'Jordan Sample', title: 'Chief Credit Officer', email: 'jordan@acmebank.test', phone: '555-0199', phoneType: 'landline', timezone: 'America/Chicago', mailingAddress: '10 Main St, Anytown' },
  contact: CONTACT(),
  domains: [{ domain: 'acmebank.test', kind: 'institution_site', url: 'https://acmebank.test/leadership', seenOn: '2026-11-01', confirmedBy: 'Pat Example', confirmedAt: '2026-11-01T12:00:00.000Z' }],
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
