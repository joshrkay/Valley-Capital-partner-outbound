// The weekly county job (docs/county-loans.md section 2): the worker's loans.watch runs every watched county in its own unit of work and
// stores counts only; the Monday cron queues it, after the FDIC check and before scoring and the triage, once a principal enables it; the
// workflow installs pdftotext. Against the fake Supabase REST API and the fake Caldwell County (invented data only); no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadJson, REPO } from './kit.mjs';
import { CALDWELL_ID } from '../src/sources/counties/caldwell.mjs';
import { hasPdfToText } from '../src/sources/pdftext.mjs';
import { fakeCaldwell, INSTITUTIONS } from './caldwell-fake.mjs';

const PDF = await hasPdfToText();
const needsPdf = PDF ? {} : { skip: 'pdftotext (poppler-utils) is not installed here' };
const T1 = new Date('2026-11-18T14:00:00Z');

test('the worker\'s loans.watch job runs every watched county in its own unit of work, and its result holds counts only', needsPdf, async () => {
  const { fakePostgrest } = await import('./postgrest-fake.mjs');
  const { platformClient } = await import('../src/platform/client.mjs');
  const { work, JOB_KINDS } = await import('../src/platform/worker.mjs');
  const { loadRules } = await import('../src/rules.mjs');
  assert.ok(JOB_KINDS.includes('loans.watch'));
  // This test is about the job and Caldwell; Jefferson and Douglas (enabled as shipped) are paused here and have their own tests.
  const shippedRules = loadRules(), sc = shippedRules.config.counties;
  const rules = { ...shippedRules, config: { ...shippedRules.config, counties: { ...sc, sources: { ...sc.sources, jefferson: { enabled: false, waitingOn: 'paused for this test.' }, douglas: { enabled: false, waitingOn: 'paused for this test.' } } } } };
  const fake = fakePostgrest();
  fake.docs.set('sources/fdic/institutions.json', { path: 'sources/fdic/institutions.json', kind: 'json', body: INSTITUTIONS, text: null, version: 1 });
  const url = 'https://example-project.supabase.test';
  await platformClient({ url, key: 'anon-key', accessToken: 'user:pat@example.test', fetchImpl: fake.fetchImpl }).enqueue('loans.watch');
  const service = platformClient({ url, key: 'service', fetchImpl: fake.fetchImpl });
  await work({ client: service, rules, deps: { fetchImpl: fakeCaldwell().fetchImpl, now: () => T1, sleep: async () => {} } });
  const job = fake.jobs[0];
  assert.equal(job.status, 'done', JSON.stringify(job.result));
  // Two notices stored. Caldwell has no parcel source, so neither property is confirmed by a county parcel record: neither is a lead
  // (docs/county-loans.md 3a), whatever the borrower. Both are stored and on the property-not-confirmed list; no bank's file is written.
  const c0 = job.result.counties[0];
  assert.deepEqual([job.result.watched, c0.source, c0.outcome, c0.added, c0.held, c0.inScope, c0.outOfScope, c0.matchedDocuments, c0.parcels.outcome],
    [1, CALDWELL_ID, 'ok', 2, 1, 0, 2, 0, 'no-source']);
  assert.ok(fake.docs.has(`loans/docs/${CALDWELL_ID}.json`) && fake.docs.has(`loans/lists/${CALDWELL_ID}.json`));
  assert.ok(!fake.docs.has('loans/banks/fdic-9001.json') && !fake.docs.has('loans/banks/fdic-9002.json'), 'no lead, no bank file');
  const un = fake.docs.get('loans/unconfirmed.json').body;
  assert.deepEqual(un.entries.map((e) => [e.reason, e.loanTypeInScope]).sort(), [['no-source', false], ['no-source', true]], 'the LLC\'s notice first among those to check by hand');
  assert.doesNotMatch(JSON.stringify(job.result), /Example|Sample|Placeholder|files\//, 'the job result holds counts, not names or links');
  // After the decision's recheck date the job refuses and fails, which turns the workflow red.
  await platformClient({ url, key: 'anon-key', accessToken: 'user:pat@example.test', fetchImpl: fake.fetchImpl }).enqueue('loans.watch');
  await work({ client: service, rules, deps: { fetchImpl: fakeCaldwell().fetchImpl, now: () => new Date('2026-12-21T14:00:00Z'), sleep: async () => {} } });
  assert.equal(fake.jobs[1].status, 'failed');
  assert.deepEqual([fake.jobs[1].result.counties[0].outcome], ['refused']);
  assert.match(fake.jobs[1].result.counties[0].error, /rechecked by 2026-12-18/);
});

test('the workflow installs pdftotext and queues loans.watch on the Monday cron, before scoring and the triage, once enabled', () => {
  const y = readFileSync(join(REPO, '.github', 'workflows', 'platform-worker.yml'), 'utf8');
  assert.match(y, /apt-get install -y -qq poppler-utils/);
  assert.ok(y.indexOf('poppler-utils') < y.indexOf('Run queued jobs'), 'installed before the worker runs');
  const step = /- name: Queue the weekly county records read\n\s+if: \$\{\{ github\.event\.schedule == '41 13 \* \* 1' && vars\.COUNTIES_ENABLED == 'true' \}\}\n\s+run: node cli\.mjs enqueue loans\.watch/.exec(y);
  assert.ok(step, 'the Monday step, gated on COUNTIES_ENABLED');
  assert.ok(step.index > y.indexOf('enqueue sources.fdic') && step.index < y.indexOf('enqueue triage.run'), 'after the FDIC check, before the triage');
  // The migration that lets the database accept the kind exists, and is the newest to set the kinds.
  assert.ok(existsSync(join(REPO, 'supabase', 'migrations', '20261118120000_jobs_loans_watch.sql')));
  assert.match(loadJson('config.json').counties._note, /loans\.watch/);
});

test('the job reads every enabled county: as shipped Caldwell, Jefferson and Douglas; a county config marks not enabled is skipped and asked nothing', needsPdf, async () => {
  const { fakePostgrest } = await import('./postgrest-fake.mjs');
  const { platformClient } = await import('../src/platform/client.mjs');
  const { watchCounties } = await import('../src/platform/worker.mjs');
  const { defineNoticeSource } = await import('../src/sources/notices.mjs');
  const { caldwellCounty } = await import('../src/sources/counties/caldwell.mjs');
  const { jefferson } = await import('../src/sources/counties/jefferson.mjs');
  const { douglas } = await import('../src/sources/counties/douglas.mjs');
  const { jeffersonSite, douglasSite, layoutOf } = await import('./gts-fake.mjs');
  const { config } = await import('./kit.mjs');
  const world = () => {
    const fake = fakePostgrest();
    fake.docs.set('sources/fdic/institutions.json', { path: 'sources/fdic/institutions.json', kind: 'json', body: INSTITUTIONS, text: null, version: 1 });
    return { fake, client: platformClient({ url: 'https://example-project.supabase.test', key: 'service', fetchImpl: fake.fetchImpl }) };
  };
  // One fetch for the three counties' fake sites, by host.
  const sites = () => {
    const caldwell = fakeCaldwell(), jeff = jeffersonSite(), doug = douglasSite();
    const byHost = (url) => { const h = new URL(url).host; return h === 'caldwellcounty.texas.gov' ? caldwell : /douglas/.test(h) ? doug : jeff; };
    return { jeff, doug, fetchImpl: (url, init) => byHost(url).fetchImpl(url, init) };
  };
  void defineNoticeSource;
  // As shipped: Jefferson and Douglas carry the principal's decision and are enabled, so the one job reads all three counties.
  const s1 = sites();
  const a = await watchCounties({ client: world().client, rules: { config: config() }, deps: { fetchImpl: s1.fetchImpl, now: () => T1, sleep: async () => {}, pdfToText: layoutOf }, registry: { [CALDWELL_ID]: caldwellCounty, jefferson, douglas } });
  assert.deepEqual(a.map((x) => [x.source, x.outcome]), [[CALDWELL_ID, 'ok'], ['jefferson', 'ok'], ['douglas', 'ok']], JSON.stringify(a));
  assert.ok(a[1].read > 0 && s1.jeff.calls.length > 0 && s1.doug.calls.length > 0);
  assert.doesNotMatch(JSON.stringify(a), /Example Holdings|Sample Owner|Pat Example/, 'counts only');
  // A principal pauses Jefferson in config.counties.sources: the same job skips it and asks it nothing.
  const c = config().counties;
  const paused = { config: { ...config(), counties: { ...c, sources: { ...c.sources, jefferson: { enabled: false, waitingOn: 'paused by a principal.' } } } } };
  const s2 = sites();
  const b = await watchCounties({ client: world().client, rules: paused, deps: { fetchImpl: s2.fetchImpl, now: () => T1, sleep: async () => {}, pdfToText: layoutOf }, registry: { [CALDWELL_ID]: caldwellCounty, jefferson, douglas } });
  assert.deepEqual(b.map((x) => [x.source, x.outcome]), [[CALDWELL_ID, 'ok'], ['douglas', 'ok']], JSON.stringify(b));
  assert.equal(s2.jeff.calls.length, 0, 'not one request to Jefferson');
});
