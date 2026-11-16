// Server only. The call desk (the account's /call page): what a principal reads from while they place a call and leave a voicemail
// themselves. Read only: the unit of work changes nothing, so nothing is written back.
// - It shows the account's APPROVED call sheet for the next step, and only when the guard allows that call now (src/guard.mjs
//   checkTouch, with the sheet's text, so an asset under NDA is caught). When the guard refuses, the sheet is not returned at all, so the
//   words never reach the page. The reasons do.
// - It loads the guard's files, the one account and its drafts (src/uow.mjs callDeskLoads). Never research, facts, paper, routes or
//   regulatory data: the screen holds what the drafter was allowed to say and nothing more.
// - No audio of any kind is made, played or stored here. A principal dials and reads it. See PRD plan section 4.1.
import { join } from 'node:path';
import { engine, loadRules } from './engine.mjs';
import { localClock } from './calldesk-view.mjs';

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const need = (v, what) => { const s = str(v); if (!s) throw new Error(`${what} is required.`); return s; };
const list = (v) => (Array.isArray(v) ? v : []);
const mods = async () => {
  const [uow, store, guard] = await Promise.all(['src/uow.mjs', 'src/store.mjs', 'src/guard.mjs'].map(engine));
  return { uow, store, guard };
};

// The sheet as the page shows it: only the fields it needs, as plain text. Fact ids stay behind: they are internal references.
function sheetOf(output) {
  const o = output && typeof output === 'object' ? output : {};
  return {
    whyNow: str(o.why_now),
    openingLine: str(o.opening_line),
    voicemail: str(o.voicemail_script),
    talkingPoints: list(o.talking_points).map((p) => str(p?.text)).filter(Boolean),
    questions: list(o.questions_to_ask).map(str).filter(Boolean),
    objections: list(o.likely_objections).map((x) => ({ objection: str(x?.objection), response: str(x?.response) })).filter((x) => x.objection || x.response),
    timingNote: str(o.best_time_note),
  };
}

// state: 'ready' | 'blocked' | 'no_draft' | 'not_approved' | 'not_a_call_step' | 'sequence_complete'. Null when there is no such account.
export async function callDesk(client, id, { now = new Date() } = {}) {
  const m = await mods();
  const rules = await loadRules();
  m.store.safeId(need(id, 'An account id'));   // checked before it becomes part of a path
  const { result } = await client.unitOfWork(m.uow.callDeskLoads(id), (dir) => {
    const account = m.store.readJson(join(dir, 'accounts', `${id}.json`), null);
    if (!account) return null;
    const ctx = m.guard.loadContext({ dir, config: rules.config });
    const sent = ctx.touches.filter((t) => t.accountId === id && t.type === 'touch').length;
    const step = sent + 1;
    const expected = rules.config.sequence[sent] ?? null;
    const person = account.person ?? {};
    const base = {
      account: { id: account.id ?? id, name: account.name ?? id },
      person: { name: str(person.name), title: str(person.title), phone: str(person.phone), phoneType: str(person.phoneType), timezone: str(person.timezone) },
      step, expected: expected ? { step: expected.step, channel: expected.channel } : null,
      hours: rules.config.calls?.hours ?? [9, 17],
      localTime: localClock(now, person.timezone),
    };
    if (!expected) return { ...base, state: 'sequence_complete' };
    if (expected.channel !== 'call') return { ...base, state: 'not_a_call_step' };
    const draft = m.store.listFiles(join(dir, 'drafts', id), '.json').map((f) => m.store.readJson(join(dir, 'drafts', id, f), null))
      .find((d) => d && d.channel === 'call' && Number(d.step) === step) ?? null;
    if (!draft) return { ...base, state: 'no_draft' };
    if (draft.status !== 'approved') return { ...base, state: 'not_approved', draftStatus: String(draft.status ?? 'unknown') };
    // The call, now, from the approved sender, with the sheet's own text: the same check `draft approve` ran, run again today.
    const verdict = m.guard.checkTouch(m.guard.touchFromAccount(account, { channel: 'call', step, date: now.toISOString(), sender: draft.sender, text: draft.text }), ctx);
    const warnings = verdict.warnings.map(({ code, message }) => ({ code, message }));
    if (!verdict.allowed) return { ...base, state: 'blocked', errors: verdict.errors.map(({ code, message }) => ({ code, message })), warnings };
    const sender = ctx.senders.find((s) => s.id === draft.sender) ?? {};
    return {
      ...base, state: 'ready', warnings,
      approvedBy: str(draft.approvedBy), approvedAt: str(draft.approvedAt),
      // The callback number comes from senders.json, never from the model's text.
      sender: { name: str(sender.name), title: str(sender.title), phone: str(sender.phone) },
      sheet: sheetOf(draft.output),
    };
  });
  return result;
}
