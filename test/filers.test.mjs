// The bank-to-filer map for the SEC filings listener (PRD E13-S1): a principal confirms or rejects every mapping, and suggestions
// come from FDIC's holding-company fields and SEC's entity lookup. Against the fake FDIC and the fake full-text search; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { makeDir } from './kit.mjs';
import { loadRules } from '../src/rules.mjs';
import { readJson, readJsonl } from '../src/store.mjs';
import { runFdic } from '../src/sources/fdic.mjs';
import { loadFilingRules } from '../src/sources/filings.mjs';
import { confirmFiler, rejectFiler, filerStatus, suggestFilers, loadFilers, confirmedCiks, normName, filerPaths, parseBank } from '../src/sources/filers.mjs';
import { fakeSearch, withHoldingCompanies } from './edgar-search-fake.mjs';
import { fakeFdic, METROS, TABLES } from './fdic-fake.mjs';

const rules = loadRules();
const FR = loadFilingRules();
const NOW = new Date('2026-11-13T12:00:00Z');
const SEC = { ...rules.config.sec, userAgent: 'Example Firm ops@example.test', minIntervalMs: 0 };
const nosleep = async () => {};

async function bankList(tables = withHoldingCompanies(TABLES())) {
  const dir = makeDir();
  const r = await runFdic({ dir, metros: METROS, fetchImpl: fakeFdic(tables).fetchImpl, quarters: 2, sleep: nosleep, minIntervalMs: 0, now: NOW });
  assert.equal(r.outcome, 'ok', JSON.stringify(r));
  return dir;
}
// One fetch for both sources, as on the real network.
const both = (fdicTables = withHoldingCompanies(TABLES()), sec = fakeSearch()) => {
  const fdic = fakeFdic(fdicTables);
  return { fetchImpl: (url, init) => (url.startsWith('https://api.fdic.gov/') ? fdic.fetchImpl(url, init) : sec.fetchImpl(url, init)), fdic, sec };
};
const suggest = (dir, net = both(), over = {}) => suggestFilers({ dir, sec: SEC, rules: FR, fetchImpl: net.fetchImpl, now: NOW, sleep: nosleep, fdicMinIntervalMs: 0, ...over });

test('a principal confirms and rejects: named, audited, history kept, and only confirmed filers count', async () => {
  const dir = await bankList();
  const c = confirmFiler({ dir, bank: 'fdic:101', cik: '9900101', by: 'Pat Example', now: NOW });
  assert.deepEqual([c.bank, c.cik, c.status, c.by, c.basis, c.bankName], ['fdic:101', '0009900101', 'confirmed', 'Pat Example', 'manual', 'Example Hill Country Bank']);
  rejectFiler({ dir, bank: 'fdic:101', cik: '0009900101', by: 'Sam Example', reason: 'the trust, not the holding company' });
  const pair = loadFilers(dir)['fdic:101'].ciks['0009900101'];
  assert.deepEqual([pair.status, pair.by, pair.reason], ['rejected', 'Sam Example', 'the trust, not the holding company']);
  assert.deepEqual(pair.history.map((h) => [h.status, h.by]), [['confirmed', 'Pat Example']]);
  assert.equal(confirmedCiks(loadFilers(dir)).size, 0, 'a rejected mapping is not searched');
  confirmFiler({ dir, bank: 'fdic:102', cik: '9900102', by: 'Pat Example' });
  const audit = readJsonl(join(dir, 'audit.jsonl')).filter((a) => a.type.startsWith('filer_'));
  assert.deepEqual(audit.map((a) => [a.type, a.bank, a.cik, a.by]), [['filer_confirmed', 'fdic:101', '0009900101', 'Pat Example'], ['filer_rejected', 'fdic:101', '0009900101', 'Sam Example'], ['filer_confirmed', 'fdic:102', '0009900102', 'Pat Example']]);
  const s = filerStatus({ dir });
  assert.deepEqual([s.banks, s.confirmed, s.rejectedOnly, s.unmapped, s.filers], [3, 1, 1, 1, 1]);
  assert.deepEqual(s.rows.map((r) => [r.bank, r.status]), [['fdic:101', 'rejected'], ['fdic:102', 'confirmed'], ['fdic:103', 'unmapped']]);
});

test('a decision needs a name, a known bank and a real CIK; nothing is guessed', async () => {
  const dir = await bankList();
  assert.throws(() => confirmFiler({ dir, bank: 'fdic:101', cik: '9900101', by: '' }), /--by NAME is required/);
  assert.throws(() => confirmFiler({ dir, bank: 'fdic:101', cik: '9900101', by: true }), /--by NAME is required/);
  assert.throws(() => confirmFiler({ dir, bank: 'fdic:4242', cik: '9900101', by: 'Pat Example' }), /not in the FDIC bank list/);
  assert.throws(() => confirmFiler({ dir, bank: '101', cik: '9900101', by: 'Pat Example' }), /Bank keys look like fdic:<CERT>/);
  assert.throws(() => confirmFiler({ dir, bank: 'fdic:101', cik: 'CIK-1', by: 'Pat Example' }), /Not a CIK/);
  assert.throws(() => confirmFiler({ dir: makeDir(), bank: 'fdic:101', cik: '1', by: 'Pat Example' }), /Run: outbound sources run fdic/);
  assert.equal(parseBank('fdic:0101').key, 'fdic:101');
  assert.equal(existsSync(filerPaths(dir).map), false, 'a refused decision writes nothing');
});

test('suggestions: by the holding company\'s name from FDIC, ranked by name, SIC code and recent filings; nothing confirmed', async () => {
  const dir = await bankList();
  const net = both();
  const r = await suggest(dir, net);
  assert.equal(r.outcome, 'ok', JSON.stringify(r));
  assert.deepEqual([r.unmapped, r.lookups], [3, 2], 'banks 101 and 103 share a holding company, so one lookup serves both');
  const b = r.banks['fdic:101'];
  assert.deepEqual([b.holdingCompany, b.rssdHcr, b.query], ['EXAMPLE HILL COUNTRY BANCSHARES, INC.', '9100101', 'EXAMPLE HILL COUNTRY BANCSHARES']);
  assert.deepEqual(b.candidates.map((c) => [c.cik, c.match, c.bankSic, c.lastFiling?.form, c.lastFiling?.fileDate]), [
    ['0009900101', 'exact', true, '10-Q', '2026-11-04'],
    ['0009900301', 'words', false, '10-K', '2026-03-01'],
  ]);
  assert.deepEqual(r.banks['fdic:102'].candidates.map((c) => [c.cik, c.match, c.sics.join()]), [['0009900102', 'exact', '6021']]);
  assert.equal(existsSync(filerPaths(dir).map), false, 'suggesting decides nothing');
  assert.deepEqual(readJson(filerPaths(dir).suggestions).banks['fdic:103'].candidates.map((c) => c.cik), ['0009900101', '0009900301']);
  const fields = net.fdic.calls.find((c) => c.endpoint === 'institutions' && /NAMEHCR/.test(c.fields ?? ''))?.fields;
  assert.equal(fields, 'CERT,NAME,NAMEHCR,RSSDHCR,FED_RSSD,CITYHCR,STALPHCR');
  assert.equal(readJsonl(join(dir, 'sources', 'runs.jsonl')).at(-1).source, 'filers');
  assert.ok(net.sec.calls.every((c) => c.ua === SEC.userAgent));
});

test('a confirmed filer is proposed for its holding company\'s other banks, and a rejected one is never proposed again', async () => {
  const dir = await bankList();
  await suggest(dir);
  const c = confirmFiler({ dir, bank: 'fdic:101', cik: '9900101', by: 'Pat Example' });
  assert.equal(c.basis, 'suggested');
  assert.deepEqual([c.filer, c.evidence.match, c.evidence.rssdHcr, c.evidence.lastFiling.form], ['EXAMPLE HILL COUNTRY BANCSHARES, INC.', 'exact', '9100101', '10-Q']);
  rejectFiler({ dir, bank: 'fdic:103', cik: '9900301', by: 'Pat Example' });
  const r = await suggest(dir);
  assert.deepEqual(Object.keys(r.banks).sort(), ['fdic:102', 'fdic:103'], 'a mapped bank is not suggested again');
  const sib = r.banks['fdic:103'].candidates;
  assert.deepEqual(sib.map((x) => [x.cik, x.match]), [['0009900101', 'sibling']]);
  assert.match(sib[0].basis, /the same holding company \(RSSD 9100101\) as fdic:101, whose filer Pat Example confirmed/);
});

test('a bank with no holding company is looked up by its own name, and an empty answer stays empty', async () => {
  const t = withHoldingCompanies(TABLES());
  Object.assign(t.institutions.find((i) => i.CERT === 102), { NAMEHCR: '', RSSDHCR: '', CITYHCR: '', STALPHCR: '' });
  const dir = await bankList(t);
  const r = await suggest(dir, both(t));
  const b = r.banks['fdic:102'];
  assert.deepEqual([b.holdingCompany, b.query, b.candidates], [null, 'EXAMPLE NATIONAL BANK', []]);
});

test('suggestions fail plainly when FDIC drops a holding-company field, and refuse a placeholder User-Agent', async () => {
  const t = withHoldingCompanies(TABLES());
  for (const i of t.institutions) delete i.RSSDHCR;   // FDIC drops a field name it does not know, silently
  const dir = await bankList(t);
  const r = await suggest(dir, both(t));
  assert.equal(r.outcome, 'failed');
  assert.match(r.errors[0], /FDIC did not return requested field\(s\): RSSDHCR/);
  assert.equal(existsSync(filerPaths(dir).suggestions), false);
  await assert.rejects(suggestFilers({ dir, sec: rules.config.sec, rules: FR, fetchImpl: both().fetchImpl, now: NOW, sleep: nosleep }), /sec\.userAgent is a placeholder/);
});

test('names compare without case, punctuation or legal-form words', () => {
  assert.equal(normName('Example Bancorp, Inc.'), 'EXAMPLE BANCORP');
  assert.equal(normName('EXAMPLE BANCORP'), 'EXAMPLE BANCORP');
  assert.equal(normName('The Example Bank, N.A.'), 'EXAMPLE BANK');
  assert.equal(normName('Example & Sample Holding Co'), 'EXAMPLE AND SAMPLE HOLDING');
  for (const tagged of ['EXAMPLE BANCORP INC /TX/', 'Example Bancorp /TX', 'EXAMPLE BANCORP, INC. /MD/']) assert.equal(normName(tagged), 'EXAMPLE BANCORP', tagged);
});

test('a candidate that files 10-Ks with a bank SIC code ranks above a same-named entity that files nothing', async () => {
  const sec = fakeSearch({
    filers: { ...(await import('./edgar-search-fake.mjs')).FILERS,
      // Same name, no periodic reports: an entity in SEC's list that can never produce a hit.
      shell: { cik: '0009900501', display: 'EXAMPLE HILL COUNTRY BANCSHARES, INC.  (CIK 0009900501)', entity: 'EXAMPLE HILL COUNTRY BANCSHARES, INC.', tickers: '', state: 'TX', sic: '6022', place: 'Exampleville, TX' } },
  });
  const dir = await bankList();
  const r = await suggest(dir, both(undefined, sec));
  assert.deepEqual(r.banks['fdic:101'].candidates.map((c) => [c.cik, c.match, !!c.lastFiling]), [['0009900101', 'exact', true], ['0009900301', 'words', true], ['0009900501', 'exact', false]]);
});
