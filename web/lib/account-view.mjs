// Outreach (was Accounts), kept pure so it can be tested without a server (docs/design-redesign.md, 5.5): where each account stands, its
// one next step, and the guard's verdicts as sentences. It reads the stored account, its drafts' statuses, its touch log and the research
// gate; it adds no fact and decides nothing the engine has not. Nothing here sends.

// Where an account stands, in the order outreach moves: name the person, research, draft, sent, in conversation.
export const OUTREACH_STAGES = Object.freeze([
  ['name', 'Name the person'], ['research', 'Research'], ['draft', 'Draft'], ['sent', 'Sent'], ['conversation', 'In conversation'],
]);
const CONVERSATION = new Set(['reply', 'meeting', 'handoff']);

// The guard's rules in plain words, by code. The code itself stays on the page as a hidden line or in a disclosure.
export const GUARD_LABELS = Object.freeze({
  ADDRESS_MISSING: 'The sender has no street address.',
  CALL_TIME_REQUIRED: 'A call needs its time, to check calling hours.',
  CAP_EMAIL_DAY: 'Over the daily email limit.',
  CAP_FIRST_TOUCHES_WEEK: 'Over the weekly limit on first touches.',
  CHANNEL_BANNED: 'That channel is not allowed.',
  CHANNEL_UNKNOWN: 'That channel is not one the sequence knows.',
  EMAIL_BOUNCED: 'The address bounced.',
  EMAIL_MISSING: 'No email address on the account.',
  EMAIL_UNSOURCED: 'The address has no recorded source.',
  EMAIL_UNVERIFIED: 'The address is not verified.',
  KILL: 'Sending is paused.',
  KILL_SWITCH: 'Sending is paused.',
  NOT_DUE: 'This step is not due yet.',
  NO_PROVENANCE: 'The person has no recorded source.',
  ORDER_NOT_CONFIRMED: 'An enforcement order in force has not been confirmed as read.',
  OTHER_CONTACT_ACTIVE: 'Someone else at this bank is already being contacted.',
  OUTSIDE_CALL_HOURS: 'Outside calling hours in the person\'s time zone.',
  PERSONAL_EMAIL: 'A personal address, not a work one.',
  PERSON_MISSING: 'No person named on the account.',
  PHONE_MISSING: 'No phone number on the account.',
  PHONE_NOT_BUSINESS_LINE: 'The number is not a business line.',
  ROLE_EMAIL: 'A shared mailbox (such as info@), not a person.',
  ROLE_UNCONFIRMED: 'The person\'s role is not confirmed.',
  SENDER_INCOMPLETE: 'The sender\'s details are incomplete.',
  SENDER_UNKNOWN: 'No such sender.',
  SEQUENCE_COMPLETE: 'The sequence is complete.',
  SEQUENCE_STOPPED: 'Outreach to this bank has stopped (a reply, opt-out or handoff).',
  SUPPRESSED_ASSET_NAMED: 'It names a property or borrower on the do-not-contact list.',
  SUPPRESSED_DOMAIN: 'The address\'s domain is on the do-not-contact list.',
  SUPPRESSED_EMAIL: 'The address is on the do-not-contact list.',
  SUPPRESSED_INSTITUTION: 'The bank is on the do-not-contact list.',
  SUPPRESSED_PERSON: 'The person is on the do-not-contact list.',
  TIMEZONE_INVALID: 'The person\'s time zone is not valid.',
  TIMEZONE_MISSING: 'The person has no time zone, so calling hours cannot be checked.',
  TOO_SOON: 'Too soon after the last touch.',
  WRONG_CHANNEL: 'Not the channel the sequence expects at this step.',
  WRONG_STEP: 'Not the step the sequence expects next.',
});
export const ruleLabel = (code) => GUARD_LABELS[code] ?? String(code ?? '').toLowerCase().replace(/_/g, ' ');
// A verdict line as a sentence: the guard's own message when it gave one, else the plain label of its code.
export const guardSentence = (e) => { const m = String(e?.message ?? '').trim(); return m || ruleLabel(e?.code); };

// One account's stage, from its record, its drafts and its touches.
export function stageOfAccount({ account, drafts = [], touches = [], research = null } = {}) {
  const mine = touches.filter((t) => !t.accountId || t.accountId === account?.id);
  if (mine.some((t) => CONVERSATION.has(t.type))) return 'conversation';
  if (mine.some((t) => t.type === 'touch')) return 'sent';
  if (drafts.length) return 'draft';
  if (!account?.person?.name) return 'name';
  return research || account?.researchedAt ? 'draft' : 'research';
}

// The account's one next step: what a principal does now, where on the page, and why. Hard stops come first: an opt-out, a do-not-contact
// entry, an enforcement order not yet confirmed as read. `gate` is the research gate (pilot.researchGate); `routes` the stored routes
// record, when there is one.
export function nextStep({ account, gate = null, drafts = [], routes = null, touches = [], orders = [], research = null } = {}) {
  const mine = touches.filter((t) => !t.accountId || t.accountId === account?.id);
  const stage = stageOfAccount({ account, drafts, touches: mine, research });
  const person = account?.person?.name ?? '';
  if (mine.some((t) => t.type === 'opt_out')) return { stage, stop: true, text: 'Stopped: someone at this bank opted out. Nobody here is contacted again.', anchor: 'touches' };
  if (routes?.guard?.hardStops?.length) return { stage, stop: true, text: `Stop first: ${guardSentence(routes.guard.hardStops[0])}`, anchor: 'routes' };
  const unconfirmed = orders.filter((o) => !o.confirmation);
  if (unconfirmed.length) return { stage, stop: true, text: `Read and confirm the enforcement order${unconfirmed.length === 1 ? '' : 's'} in force before any touch.`, anchor: 'orders' };
  if (stage === 'conversation') return { stage, stop: false, text: 'In conversation: a principal takes it from here. Prepare the call, or record the meeting.', anchor: 'calls' };
  if (stage === 'sent') {
    const sent = mine.filter((t) => t.type === 'touch').length;
    return { stage, stop: false, text: `${sent} send${sent === 1 ? '' : 's'} recorded. Record a reply when it comes, or the next step when it is due.`, anchor: 'touches' };
  }
  if (stage === 'draft') {
    if (drafts.some((d) => d.status === 'approved')) return { stage, stop: false, text: 'Send the approved draft from your own mailbox, then record the send here.', anchor: 'touches' };
    if (drafts.some((d) => d.status === 'draft')) return { stage, stop: false, text: 'A draft is waiting: check it and approve it in Approvals.', href: '/drafts' };
    if (drafts.some((d) => d.status === 'blocked')) return { stage, stop: false, text: 'The draft is blocked by a rule: see Approvals, then queue it again.', href: '/drafts' };
    return { stage, stop: false, text: 'Research is done: queue the first draft.', anchor: 'person' };
  }
  if (stage === 'research') {
    if (person && !account?.contact?.roleConfirmed) return { stage, stop: false, text: `Confirm ${person}'s role from the sources, then queue research.`, anchor: 'person' };
    if (gate && !gate.allowed) return { stage, stop: false, text: `Research is not open yet: ${gate.reason}`, anchor: 'person' };
    return { stage, stop: false, text: 'Queue research on the person.', anchor: 'person' };
  }
  if (research || account?.researchedAt) return { stage, stop: false, text: 'Research is done: name the person to contact from the brief\'s findings, with its source.', anchor: 'person' };
  if (gate && !gate.allowed) return { stage, stop: false, text: `Name the person to contact from the sources. Research is not open yet: ${gate.reason}`, anchor: 'person' };
  return { stage, stop: false, text: 'Name the person to contact, or queue institution research to find them.', anchor: 'person' };
}

// The Outreach list grouped by stage, each group in the stages' order, empty groups kept so the page shows the whole path.
export function groupAccounts(rows) {
  return OUTREACH_STAGES.map(([id, label]) => ({ id, label, rows: rows.filter((r) => r.stage === id) }));
}
