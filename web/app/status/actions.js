'use server';
import { redirect } from 'next/navigation';
import { requirePrincipal, flash } from '../../lib/session.mjs';
import * as ops from '../../lib/ops.mjs';

async function queue(fn, ok) {
  const ctx = await requirePrincipal();
  if (ctx.denied) redirect('/login');
  try { await fn(ctx); await flash('ok', ok); } catch (e) { await flash('error', e.message); }
  redirect('/status');
}
export const queueSourcesAction = async () => queue((ctx) => ops.queueSources(ctx.client), 'FDIC pull queued.');
export const queueScoreAction = async (fd) => queue((ctx) => ops.queueScore(ctx.client, { draftBuybox: fd.get('draftBuybox') === 'on' }), 'Scoring queued.');
