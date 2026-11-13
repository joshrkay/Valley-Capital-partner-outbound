// A send that already happened is always logged, even if the guard would refuse it now (PR review finding; PRD E9-S2).
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { makeDir, account, ctxWith, touch, sent } from './kit.mjs';
import { recordObservedSend, recordTouch, checkTouch } from '../src/guard.mjs';
import { readJsonl } from '../src/store.mjs';

test('a send the guard would refuse now is still recorded, with its violations audited', () => {
  const dir = makeDir();
  const a = account();
  const ctx = ctxWith({ kill: true });   // the kill switch went on after the principal pressed send
  const t = touch(a);
  assert.equal(checkTouch(t, ctx).allowed, false);
  assert.throws(() => recordTouch(dir, t, ctx), /Not recorded/);   // the pre-send check still refuses, as before

  const { rec, violations } = recordObservedSend(dir, t, ctx);
  assert.equal(rec.type, 'touch'); assert.equal(rec.observed, true);
  assert.ok(violations.length > 0);
  assert.deepEqual(rec.violations, violations.map((v) => v.code));
  const logged = readJsonl(join(dir, 'touches.jsonl'));
  assert.equal(logged.length, 1);
  assert.equal(ctx.touches.length, 1, 'the in-memory history counts it too, so the caps see it');
  assert.match(readFileSync(join(dir, 'audit.jsonl'), 'utf8'), /"type":"send_recorded_with_violations"/);
});

test('a clean observed send is recorded without a violations field', () => {
  const dir = makeDir();
  const { rec, violations } = recordObservedSend(dir, touch(account()), ctxWith());
  assert.equal(violations.length, 0);
  assert.equal(rec.violations, undefined);
  assert.match(readFileSync(join(dir, 'audit.jsonl'), 'utf8'), /"type":"send_recorded"/);
});

test('once recorded, the observed send counts toward the next check, so a duplicate step is refused', () => {
  const dir = makeDir();
  const a = account();
  const ctx = ctxWith({ touches: [sent(a.id, 1, 'letter', '2026-11-13')] });
  recordObservedSend(dir, touch(a, { channel: 'email', step: 2, date: '2026-11-16' }), ctx);
  const again = checkTouch(touch(a, { channel: 'email', step: 2, date: '2026-11-17' }), ctx);
  assert.equal(again.allowed, false);
});
