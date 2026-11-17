// PRD E17-S2: labels. Each label is a dated event from a source the score does not read. Invented banks only; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { makeDir, put, config, PLACEHOLDER_UA } from './kit.mjs';
import { fakeFdic } from './fdic-fake.mjs';
import { readJson, readJsonl, writeJson } from '../src/store.mjs';
import { loadRules } from '../src/rules.mjs';
import { METRICS, CATEGORIES, CONCENTRATION_FIELDS } from '../src/metrics.mjs';
import { runPanel, backtestPaths } from '../src/backtest/panel.mjs';
import { buildLabels, readLabels, LABEL_KINDS, componentFields, disclosedSaleStatus } from '../src/backtest/labels.mjs';
import { btTables, btConfig, METROS, NOW, FROM, TO, SALES } from './backtest-kit.mjs';

const rules = loadRules();
const cfg = (over = {}) => ({ ...config(), backtest: btConfig(over) });

async function world({ tables = btTables() } = {}) {
  const dir = makeDir();
  const f = fakeFdic(tables);
  const r = await runPanel({ dir, metros: METROS, config: btConfig(), lookbackQuarters: 8, from: FROM, to: TO, fetchImpl: f.fetchImpl, now: NOW, clock: () => NOW, sleep: async () => {} });
  assert.equal(r.outcome, 'ok');
  put(dir, 'sources/fdic/sales.json', SALES());
  return dir;
}
const label = (l, key, kind) => l.labels.filter((x) => x.key === key && x.kind === kind);

test('labels: a failure (all three FDIC sources), an assisted merger and an FDIC loan sale, each { key, kind, date, sources }', async () => {
  const dir = await world();
  const r = buildLabels({ dir, config: cfg(), now: NOW, clock: () => NOW });
  assert.equal(r.outcome, 'ok');
  const l = readLabels(dir);
  assert.equal(l.runId, r.runId);
  assert.equal(l.panelRunId, readJson(backtestPaths(dir).state).runId);
  const fail = label(l, 'fdic:202', 'failure');
  assert.equal(fail.length, 1);
  assert.equal(fail[0].date, '2023-05-12');
  assert.deepEqual(fail[0].sources.map((s) => s.source), ['fdic:/failures', 'fdic:/institutions', 'fdic:/history']);
  for (const s of fail[0].sources) { assert.ok(s.ids.length && s.link.startsWith('https://') && /^\d{4}-\d{2}-\d{2}$/.test(s.date), JSON.stringify(s)); }
  const am = label(l, 'fdic:203', 'assisted_merger');
  assert.equal(am.length, 1);
  assert.equal(am[0].date, '2023-09-15');
  assert.deepEqual(am[0].sources[0].ids, ['2023000203']);
  const sale = label(l, 'fdic:202', 'fdic_loan_sale');
  assert.equal(sale.length, 1);
  assert.equal(sale[0].date, '2023-08-01');
  assert.equal(sale[0].sources[0].link, 'https://www.fdic.gov/asset-sales/events/invented-1');
  for (const x of l.labels) assert.deepEqual(Object.keys(x).filter((k) => !['id'].includes(k)).sort(), ['date', 'key', 'kind', 'sources']);
  assert.equal(l.kinds.failure.status, 'on');
  assert.equal(l.kinds.failure.labels, 1);
});

test('labels also come from the live FDIC records (sources/fdic/failed.json and events.json, E3-S5 and S6)', async () => {
  const dir = await world();
  put(dir, 'sources/fdic/failed.json', { 208: { cert: '208', failedOn: '2023-02-03', sources: { failures: { on: '2023-02-03', restype: 'FAILURE' }, institutions: null, history: null }, agree: ['failures'] } });
  put(dir, 'sources/fdic/events.json', { 2023000209: { transnum: '2023000209', code: 213, kind: 'assisted-merger', effective: '2023-04-01', acquirerCert: '201', targetCert: '209' } });
  buildLabels({ dir, config: cfg(), now: NOW, clock: () => NOW });
  const l = readLabels(dir);
  assert.equal(label(l, 'fdic:208', 'failure')[0].date, '2023-02-03');
  assert.equal(label(l, 'fdic:209', 'assisted_merger')[0].date, '2023-04-01');
});

test('ORDINARY MERGERS are not labels by default; a principal can turn the kind on (D-B2)', async () => {
  const dir = await world();
  buildLabels({ dir, config: cfg(), now: NOW, clock: () => NOW });
  assert.equal(readLabels(dir).labels.filter((x) => x.key === 'fdic:206').length, 0, 'the 2022 merger of 206 is not a label');
  assert.equal(readLabels(dir).kinds.merger.status, 'off');
  buildLabels({ dir, config: cfg({ labelKinds: ['failure', 'merger'] }), now: NOW, clock: () => NOW });
  assert.deepEqual(readLabels(dir).labels.filter((x) => x.key === 'fdic:206').map((x) => x.kind), ['merger']);
});

test('DISCLOSED SALE stays off and is listed as unavailable: it needs the SEC contact (Q11) and confirmed filers; an 8-K 2.01 hit is never a label', async () => {
  const dir = await world();
  // A bank-disclosed sale in the sale ledger (from an 8-K Item 2.01 hit) is context, never a label.
  put(dir, 'sales/ledger.json', { builtAt: '2026-11-14T00:00:00Z', events: { 'sec-sale:x:fdic:201': { id: 'sec-sale:x:fdic:201', kind: 'bank_disclosed_sale', date: '2023-01-10', seller: { kind: 'bank', key: 'fdic:201', name: 'x' } } } });
  // While the SEC contact is a placeholder, that is one of the reasons.
  const placeholder = cfg(); placeholder.sec.userAgent = PLACEHOLDER_UA.sec;
  buildLabels({ dir, config: placeholder, now: NOW, clock: () => NOW });
  const l = readLabels(dir);
  assert.equal(l.kinds.disclosed_sale.status, 'unavailable');
  assert.match(l.kinds.disclosed_sale.reasons.join(' '), /Q11/);
  assert.match(l.kinds.disclosed_sale.reasons.join(' '), /confirmed filer/);
  assert.match(l.kinds.disclosed_sale.reasons.join(' '), /principal has read the filing/);
  assert.equal(l.labels.filter((x) => x.kind === 'disclosed_sale').length, 0);
  assert.throws(() => buildLabels({ dir, config: placeholder, filings: true, now: NOW }), /unavailable[\s\S]*Q11/);
  // With the SEC contact filled and no confirmed filer, the kind is still unavailable: it needs confirmed filers.
  const filled = cfg(); filled.sec.userAgent = 'Invented Firm ops@invented-firm.test';
  const noFiler = disclosedSaleStatus({ dir, config: filled });
  assert.equal(noFiler.available, false);
  assert.doesNotMatch(noFiler.reasons.join(' '), /Q11/);
  assert.match(noFiler.reasons.join(' '), /confirmed filer/);
  assert.throws(() => buildLabels({ dir, config: filled, filings: true, now: NOW }), /unavailable[\s\S]*confirmed filer/);
  // Even with the SEC contact filled and a confirmed filer, the kind stays unavailable in this pass.
  put(dir, 'sources/edgar/filers.json', { 'fdic:201': { bank: 'fdic:201', ciks: { '0000990001': { status: 'confirmed', by: 'Pat Example', at: '2026-11-01T00:00:00Z' } } } });
  const st = disclosedSaleStatus({ dir, config: filled });
  assert.equal(st.available, false);
  assert.doesNotMatch(st.reasons.join(' '), /Q11/);
  assert.match(st.reasons.join(' '), /principal has read the filing/);
});

test('NO LEAKAGE: no label kind derives from a Call Report field in scoring.json components, and labels never read the financials', async () => {
  const fields = componentFields(rules.scoring);
  // Every component field, checked against what the code reads: the metrics' fields, the profile's balances and stages, deposits.
  for (const c of rules.scoring.components) if (c.metric) for (const f of [...METRICS[c.metric].num, ...(METRICS[c.metric].den ?? [])]) assert.ok(fields.has(f), f);
  for (const cat of CATEGORIES) { assert.ok(fields.has(cat.balance)); assert.ok(fields.has(cat.stages.noncurrent)); }
  assert.ok(fields.has('LNLSNET') && fields.has('DEPSUMBR'));
  for (const [kind, def] of Object.entries(LABEL_KINDS)) {
    assert.deepEqual(def.fields.filter((f) => fields.has(f) || CONCENTRATION_FIELDS.includes(f)), [], `${kind} derives from a scored field`);
    assert.ok(!def.reads.some((p) => /financials/.test(p)), `${kind} reads Call Report financials`);
  }
  // End to end: every Call Report value in the panel replaced, and the labels are the same.
  const a = await world();
  buildLabels({ dir: a, config: cfg(), now: NOW, clock: () => NOW });
  const p = backtestPaths(a);
  for (const cert of ['201', '202', '203']) {
    const file = readJson(p.financial(cert));
    for (const q of Object.values(file.quarters)) for (const k of Object.keys(q)) if (!['CERT', 'REPDTE', '_source'].includes(k)) q[k] = 123456;
    writeJson(p.financial(cert), file);
  }
  const before = readLabels(a).labels;
  buildLabels({ dir: a, config: cfg(), now: NOW, clock: () => NOW });
  assert.deepEqual(readLabels(a).labels, before);
});

test('a bank with no label is unlabelled, never "safe" or a negative; banks with a confirmed SEC filer are recorded for the coverage strata', async () => {
  const dir = await world();
  put(dir, 'sources/edgar/filers.json', { 'fdic:201': { bank: 'fdic:201', ciks: { '0000990001': { status: 'confirmed', by: 'Pat Example', at: '2026-11-01T00:00:00Z' } } }, 'fdic:204': { bank: 'fdic:204', ciks: { '0000990002': { status: 'rejected', by: 'Pat Example', at: '2026-11-01T00:00:00Z' } } } });
  buildLabels({ dir, config: cfg(), now: NOW, clock: () => NOW });
  const l = readLabels(dir);
  assert.match(l.unlabelled, /unlabelled, not safe/);
  assert.doesNotMatch(JSON.stringify(l), /negative/i);
  assert.deepEqual(l.coverage.secFilers, ['fdic:201']);
  assert.equal(l.labelsAsOf, '2026-11-14');
});

test('the labels run keeps the E2 contract: one run-log line with counts only; a malformed source record fails the run and writes nothing', async () => {
  const dir = await world();
  const r = buildLabels({ dir, config: cfg(), now: NOW, clock: () => NOW });
  const line = readJsonl(join(dir, 'sources', 'runs.jsonl')).at(-1);
  assert.equal(line.source, 'backtest-labels');
  assert.equal(line.runId, r.runId);
  assert.equal(line.rowsWritten, readLabels(dir).labels.length);
  assert.doesNotMatch(JSON.stringify(line), /Example/);
  const before = readJson(backtestPaths(dir).labels);
  put(dir, 'sources/fdic/sales.json', { bad: { saleId: 'bad', page: 'https://www.fdic.gov/x', receiverships: [{ key: 'fdic:202' }] } });
  const bad = buildLabels({ dir, config: cfg(), now: NOW, clock: () => NOW });
  assert.equal(bad.outcome, 'failed');
  assert.match(bad.errors.join(' '), /date/);
  assert.deepEqual(readJson(backtestPaths(dir).labels), before, 'nothing written');
  // A label that changes between builds is in the change log.
  put(dir, 'sources/fdic/sales.json', SALES());
  const sales = SALES(); sales['2023-SALE-INVENTED-1'].announcedOn = '2023-08-15';
  put(dir, 'sources/fdic/sales.json', sales);
  buildLabels({ dir, config: cfg(), now: NOW, clock: () => NOW });
  const ch = readJsonl(join(dir, 'sources', 'changes.jsonl')).filter((c) => c.key === 'fdic:202' && /fdic_loan_sale/.test(c.field));
  assert.equal(ch.length, 1);
  assert.deepEqual([ch[0].old, ch[0].new], ['2023-08-01', '2023-08-15']);
});

test('ENFORCEMENT ORDER (E17-S2, from E18-S2): built, off by default; on, one label per formal order against a listed bank, by name; terminations, penalties and individuals give none', async () => {
  const dir = await world();
  const bank = { CERT: '201', NAME: 'Example Hill Bank', CITY: 'Sampleton', STALP: 'TX' };
  put(dir, 'sources/fdic/institutions.json', { 201: bank });
  const party = { name: bank.NAME, city: bank.CITY, state: bank.STALP };
  const src = { source: 'test', endpoint: 'test', query: {}, recordId: 'x', period: '2023-01-01', fetchedAt: NOW.toISOString(), runId: 'test' };
  const rec = (key, over) => ({ key, regulator: 'frb', sourceId: key.split(':')[1], type: 'cease_and_desist', types: ['cease_and_desist'], date: '2023-03-17', terminatedOn: null, parties: [party], link: null, linkKind: null, kind: 'order', _source: src, ...over });
  put(dir, 'sources/enforcement/orders.json', {
    'frb:1': rec('frb:1', {}),
    'frb:2': rec('frb:2', { type: 'civil_money_penalty', types: ['civil_money_penalty'], date: '2023-04-01' }),
    'frb:3': rec('frb:3', { kind: 'termination', terminates: 'frb:1', date: '2023-12-01' }),
  });
  put(dir, 'sources/enforcement/occ-orders.json', { 'occ:AA-WE-2023-9': rec('occ:AA-WE-2023-9', { regulator: 'occ', sourceId: 'AA-WE-2023-9', type: 'written_agreement', types: ['written_agreement'], date: '2023-06-30', link: 'https://www.occ.gov/static/enforcement-actions/eaAA-WE-2023-9.pdf' }) });
  // Off by default: built, listed as off, no labels.
  const off = buildLabels({ dir, config: cfg(), now: NOW, clock: () => NOW });
  assert.equal(off.outcome, 'ok');
  assert.equal(readLabels(dir).kinds.enforcement_order.status, 'off');
  assert.match(readLabels(dir).kinds.enforcement_order.reasons.join(' '), /labelKinds/);
  assert.equal(readLabels(dir).labels.filter((x) => x.kind === 'enforcement_order').length, 0);
  // On: the Fed's cease and desist and the OCC's written agreement; not the penalty, not the termination.
  const r = buildLabels({ dir, config: cfg({ labelKinds: ['failure', 'enforcement_order'] }), now: NOW, clock: () => NOW });
  assert.equal(r.outcome, 'ok', JSON.stringify(r));
  const l = readLabels(dir);
  const eo = l.labels.filter((x) => x.kind === 'enforcement_order');
  assert.deepEqual(eo.map((x) => [x.key, x.date, x.sources[0].source, x.sources[0].ids[0]]), [[`fdic:${bank.CERT}`, '2023-03-17', 'enforcement:frb', '1'], [`fdic:${bank.CERT}`, '2023-06-30', 'enforcement:occ', 'AA-WE-2023-9']]);
  assert.match(eo[0].sources[0].link, /^https:\/\//, 'an order with no document is linked to its regulator\'s list');
  assert.equal(eo[1].sources[0].link, 'https://www.occ.gov/static/enforcement-actions/eaAA-WE-2023-9.pdf');
  assert.equal(l.kinds.enforcement_order.status, 'on');
  assert.equal(l.kinds.enforcement_order.labels, 2);
  // No leakage: the kind reads no Call Report field a scoring component reads.
  const comp = componentFields(rules.scoring);
  assert.ok(!LABEL_KINDS.enforcement_order.fields.some((f) => comp.has(f)));
});
