// System status and Senders (docs/design-redesign.md, 5.7 and 5.8): the one-line health summary, sending paused or allowed in words, jobs
// as plain labels and one-line results, and readiness first on Senders. Pure helpers and page sources; invented runs only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { healthSummary, sendingLine, jobLabel, jobResultLine, sourceLabel, QUEUE_HELP, JOB_LABELS } from '../lib/status-view.mjs';

const WEB = fileURLToPath(new URL('..', import.meta.url));
const NOW = new Date('2026-11-17T12:00:00Z');
const run = (source, outcome, finishedAt, more = {}) => ({ runId: `${source}-${finishedAt}`, source, outcome, finishedAt, rowsRead: 10, ...more });
const LIMITS = { fdic: 8, edgar: 35, filings: 4, scoring: 8 };

test('one line: data is current, or what is wrong, most serious first', () => {
  const fresh = { recentRuns: [run('filings', 'ok', '2026-11-17T06:00:00Z'), run('fdic', 'ok', '2026-11-16T06:00:00Z'), run('edgar', 'ok', '2026-11-01T06:00:00Z')], jobs: [{ kind: 'score.run', status: 'done' }] };
  assert.deepEqual(healthSummary(fresh, { now: NOW, staleDays: LIMITS }), { ok: true, headline: 'Data is current. Every source\'s last run succeeded, and no job failed.', problems: [] });
  assert.equal(healthSummary({ recentRuns: [], jobs: [] }, { now: NOW }).headline, 'No data has been pulled yet. Queue an FDIC pull, then scoring.');
  const failed = { recentRuns: [run('fdic', 'failed', '2026-11-16T06:00:00Z', { errors: [{ message: 'HTTP 503 from the FDIC API' }] }), run('fdic', 'ok', '2026-11-09T06:00:00Z')], jobs: [] };
  const h = healthSummary(failed, { now: NOW, staleDays: LIMITS });
  assert.deepEqual([h.ok, h.headline], [false, 'The last FDIC data run failed: HTTP 503 from the FDIC API']);
  assert.equal(healthSummary({ ...failed, jobs: [{ kind: 'sources.fdic', status: 'failed' }] }, { now: NOW, staleDays: LIMITS }).problems.length, 1, 'the failed job of a failed run is said once');
  const stale = healthSummary({ recentRuns: [run('fdic', 'ok', '2026-11-01T06:00:00Z')], jobs: [] }, { now: NOW, staleDays: LIMITS });
  assert.equal(stale.headline, 'FDIC data was last pulled 16 days ago (the limit is 8).');
  const many = healthSummary({ recentRuns: [run('edgar', 'suspect', '2026-11-16T06:00:00Z'), run('fdic', 'ok', '2026-11-16T06:00:00Z')], jobs: [{ kind: 'triage.run', status: 'failed' }, { kind: 'triage.run', status: 'done' }, { kind: 'score.run', status: 'done' }, { kind: 'score.run', status: 'failed' }] }, { now: NOW, staleDays: LIMITS });
  assert.equal(many.headline, '2 things need attention.');
  assert.match(many.problems[0], /^The last CMBS loan data \(SEC EDGAR\) run looked wrong/);
  assert.equal(many.problems[1], 'Weekly triage failed in its last run.', 'only the newest job of each kind counts: scoring was redone since it failed');
});

test('sending paused or allowed, in words, and each job as a plain label and one line', () => {
  assert.deepEqual(sendingLine({ config: false, document: false }).text, 'Sending is allowed.');
  const paused = sendingLine({ config: true, document: true });
  assert.deepEqual([paused.paused, paused.text], [true, 'Sending is paused.']);
  assert.match(paused.detail, /the setting in config\.json and the KILL document/);
  assert.equal(jobLabel('sources.fdic'), 'FDIC data pull');
  assert.equal(jobLabel('something.new'), 'something.new');
  assert.equal(sourceLabel('edgar'), 'CMBS loan data (SEC EDGAR)');
  for (const k of ['sources.fdic', 'sources.edgar', 'sources.filings', 'sources.fdicsales', 'sources.enforcement', 'sources.mergerapps', 'score.run', 'triage.run', 'research.run', 'draft.run', 'call.prep', 'call.extract']) assert.ok(JOB_LABELS[k], k);
  assert.equal(jobResultLine({ status: 'queued' }), 'Waiting for the worker.');
  assert.equal(jobResultLine({ status: 'failed', result: { error: 'The SEC contact is a placeholder.' } }), 'Failed: The SEC contact is a placeholder.');
  assert.equal(jobResultLine({ status: 'done', result: { runId: 'x', outcome: 'ok', rowsRead: 120, rowsWritten: 118, rowsChanged: 4, notes: 2 } }), 'Done: 120 rows read, 118 written, 4 changed.');
  assert.equal(jobResultLine({ status: 'done', result: { outcome: 'suspect', loansRead: 0 } }), 'Done, but it looked wrong: 0 loans read.');
  assert.equal(jobResultLine({ status: 'done', result: null }), 'Done.');
  for (const k of ['fdic', 'edgar', 'score']) assert.ok(QUEUE_HELP[k].endsWith('.'), k);
});

test('Status leads with the health line and sending, keeps the raw tables under Technical detail and one link to Score check', () => {
  const page = readFileSync(join(WEB, 'app/status/page.jsx'), 'utf8');
  const src = readFileSync(join(WEB, 'app/status/status-view.jsx'), 'utf8');
  const view = src.slice(src.indexOf('export default function StatusView'));
  assert.equal(page.split('\n').filter((l) => l.includes('href="/calibration"')).length, 1);
  assert.ok(view.indexOf('healthSummary(') < view.indexOf('sendingLine(') && view.indexOf('h-health') < view.indexOf('Technical detail'));
  assert.ok(view.indexOf('Technical detail') < view.indexOf('JSON.stringify(j.result)'), 'raw results only under Technical detail');
  for (const a of ['queueSourcesAction', 'queueEdgarAction', 'queueScoreAction']) assert.match(view, new RegExp(`action=\\{${a}\\}`));
  assert.doesNotMatch(view, /Kill switch ON|Kill switch off/);
});

test('Senders: ready to send first, with the one thing to fix; jargon only in the help line', () => {
  const page = readFileSync(join(WEB, 'app/senders/page.jsx'), 'utf8');
  assert.ok(page.indexOf('Ready to send') < page.indexOf('h-senders'), 'readiness before the senders');
  assert.match(page, /Fix first:/);
  const help = page.indexOf('The rule behind Ready to send');
  for (const jargon of ['CAN-SPAM', '[CONFIRM]', 'OUTBOUND_KILL', 'outbound status']) {
    const at = page.lastIndexOf(jargon);
    assert.ok(at > help, `${jargon} appears only in the help line`);
  }
  assert.doesNotMatch(page.slice(page.indexOf('const FIELDS'), page.indexOf('function Fields')), /CAN-SPAM/, 'plain field labels');
});
