// PRD E13-S1 and the rule in section 0: filings found by the SEC filings listener are context for a principal only. Their signals
// may travel with an account to the briefer, as research; nothing about a filing reaches the drafter. Invented data; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { account, makeDir, models, SENDER } from './kit.mjs';
import { loadRules } from '../src/rules.mjs';
import { readJson } from '../src/store.mjs';
import { runFdic } from '../src/sources/fdic.mjs';
import { loadFilingRules, runFilings, filingSignals, filingProxies, filingsPaths } from '../src/sources/filings.mjs';
import { confirmFiler } from '../src/sources/filers.mjs';
import { buildDraftPrompt } from '../src/draft.mjs';
import { buildPrompt } from '../src/research.mjs';
import { fakeSearch, FILERS, ACC, SECRET_TEXT, PERSON, withHoldingCompanies } from './edgar-search-fake.mjs';
import { fakeFdic, METROS, TABLES } from './fdic-fake.mjs';

const rules = loadRules();
const FR = loadFilingRules();
const NOW = new Date('2026-11-13T12:00:00Z');
const SEC = { ...rules.config.sec, userAgent: 'Example Firm ops@example.test', minIntervalMs: 0 };

async function listened() {
  const dir = makeDir();
  await runFdic({ dir, metros: METROS, fetchImpl: fakeFdic(withHoldingCompanies(TABLES())).fetchImpl, quarters: 2, sleep: async () => {}, minIntervalMs: 0, now: NOW });
  confirmFiler({ dir, bank: 'fdic:101', cik: '9900101', by: 'Pat Example', now: NOW });
  // The server is told to send document text, which the real one never does, to prove nothing downstream could pass it on.
  const r = await runFilings({ dir, sec: SEC, rules: FR, fetchImpl: fakeSearch({ leakText: true }).fetchImpl, now: NOW, sleep: async () => {} });
  assert.equal(r.outcome, 'ok', JSON.stringify(r));
  return dir;
}

test('the drafter never sees a filing: no accession, link, CIK, filer, document, form, item, search or label, and no filing text', async () => {
  const dir = await listened();
  const signals = filingSignals({ dir, rules: FR })['fdic:101'];
  const proxies = filingProxies({ dir })['fdic:101'];
  assert.ok(signals.length >= 2 && proxies.length === 1);
  // How the coordinator may attach them: as pipeline signals and proxy links on the promoted account.
  const pipeline = { key: 'fdic:101', period: '20260630', tier: 'A', leadSector: 'multifamily', leadSectorOptions: [], signals, proxies, profile: null };
  const a = account({ originSignals: signals.map((s) => s.id), sectors: ['multifamily'], pipeline });
  const { system, user } = buildDraftPrompt({ account: a, channel: 'email', step: 2, sender: SENDER, facts: [], claims: rules.claims, priorTouches: [], rules });
  const drafter = system + user;
  const filings = readJson(filingsPaths(dir).filings);
  const leaks = [
    ...Object.keys(filings), ...signals.flatMap((s) => [s.id, s.link, s.label, ...s.searches]), ...proxies.map((p) => p.link),
    FILERS.hill.cik, String(Number(FILERS.hill.cik)), 'EXAMPLE HILL COUNTRY', 'exhc-', 'EX-99.1', 'DEF 14A', '8-K', 'Item 2.06', '2.06', 'held for sale', 'impairment', 'sec-filing',
    SECRET_TEXT.slice(0, 25), PERSON,
  ];
  for (const leak of leaks) assert.ok(!drafter.includes(leak), `drafter input leaked "${leak}"`);
  assert.match(user, /"sector":"multifamily"/);
});

test('the briefer may read the signals as research context, but never filing text or a person found in a filing', async () => {
  const dir = await listened();
  const signals = filingSignals({ dir, rules: FR })['fdic:101'];
  const a = account({ sectors: ['multifamily'], pipeline: { key: 'fdic:101', period: '20260630', tier: 'A', leadSector: 'multifamily', signals, profile: null } });
  const { user } = buildPrompt({ account: a, playbook: rules.playbooks.types.bank, playbooks: rules.playbooks, models: models(), today: '2026-11-13' });
  assert.match(user, /8-K Item 2\.06: material impairments/, 'the label is context for research');
  assert.ok(!user.includes(SECRET_TEXT.slice(0, 25)) && !user.includes(PERSON));
});

test('no stored record carries filing text, a snippet or a person, and every record says it is context only', async () => {
  const dir = await listened();
  for (const f of ['filings', 'proxies', 'discovery']) {
    const raw = readFileSync(filingsPaths(dir)[f], 'utf8');
    assert.ok(!raw.includes(SECRET_TEXT.slice(0, 25)) && !raw.includes(PERSON), f);
    assert.doesNotMatch(raw, /doc_text|highlight|snippet/, f);
    for (const rec of Object.values(JSON.parse(raw))) assert.equal(rec.contextOnly, true, `${f} ${rec.accession}`);
  }
  assert.ok(readJson(filingsPaths(dir).proxies)[ACC.proxy], 'the proxy is recorded, by form, date and link only');
  assert.deepEqual(Object.keys(readJson(filingsPaths(dir).proxies)[ACC.proxy]).filter((k) => /name|person|officer/i.test(k)), ['filerNames'], 'the only name kept is the filer\'s');
  assert.ok(!readFileSync(join(dir, 'sources', 'runs.jsonl'), 'utf8').includes('EXAMPLE'), 'the run log holds counts and ids only');
});
