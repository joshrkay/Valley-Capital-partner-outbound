// Shared fixtures for the call prep and outcome tests (PRD E15). Every bank, person, number and note here is invented.
import { join } from 'node:path';
import { makeDir, put, account, SENDER, textReply } from './kit.mjs';
import { loadRules } from '../src/rules.mjs';

export const rules = loadRules();
export const ID = 'acme-bank';
export const KEY = 'fdic:99999';
export const SIG1 = 'fdic:99999:mf-noncurrent-rising:20260630';
export const SIG2 = 'fdic:99999:acquired-metro-bank:7001';
const claim = (id) => rules.claims.find((c) => c.id === id).text;

// Distinctive invented figures, so a leak is easy to spot.
export const CARD = [
  'Acme Community Bank: Call Report data as of June 30, 2026.',
  'Multifamily loans are 43.21% of its CRE book ($812.3 million); their noncurrent ratio is 6.17%, up from 2.04% four quarters earlier.',
];
export const PIPELINE = {
  key: KEY, period: '20260630', tier: 'A', axes: { distress: 41.7, fit: 23.9, timing: 8.3 }, leadSector: 'multifamily',
  signals: [
    { id: SIG1, type: 'mf-noncurrent-rising', kind: 'state', label: 'Multifamily noncurrent ratio up 2 quarters running', period: '20260630', evidence: ['fdic:99999:20260630'] },
    { id: SIG2, type: 'acquired-metro-bank', kind: 'event', label: 'Acquired a bank with branches in our metros', period: '2026-05-01', effective: '2026-05-01', evidence: ['fdic-history:7001'] },
  ],
  profile: {
    categories: [{ id: 'multifamily', label: 'Multifamily', short: 'Multifamily', sectors: ['multifamily'], balance: { field: 'LNREMULT', repdte: '20260630', value: 812345 }, shareOfCre: { value: 0.4321 }, noncurrentRatio: 0.0617, direction4q: { direction: 'rising', from: { repdte: '20250630', value: 0.0204 } }, fit: { buys: true, sectors: ['multifamily'] } }],
    footprint: { metros: [{ label: 'Phoenix', branches: { value: 12 }, inBuybox: true }], buyboxDepositShare: 0.58, sodYear: 2026 },
    limits: ['Hotel and retail loans are inside nonfarm nonresidential and cannot be separated.'],
  },
};
export const PAPER = {
  key: KEY,
  q1: { multifamily: { balance: { label: 'Multifamily balance', value: 812345, unit: 'thousands', asOf: '2026-06-30', tier: 'reported', sources: [{ field: 'LNREMULT', repdte: '20260630' }], method: 'callreport' } } },
  q2: { officeShare: { label: 'Office share of nonfarm nonresidential', low: 0.1517, high: 0.3529, unit: 'share', asOf: '2026-06-30', tier: 'inferred', method: 'peer-prior' } },
  tapeRequest: ['Loan ID, property type and address', 'Original and current balance', 'Participations: who leads, what share'],
  unknowns: ['Participations are unknown.'],
};
export const FINDINGS = [
  { id: 'F1', question_id: 'bank.intent', kind: 'intent', claim: 'The bank says it intends to reduce multifamily loans through sales.', quote: 'intends to reduce multifamily loans through sales', source_url: 'https://acmebank.test/q2', publisher: 'Acme Community Bank', published: '2026-07-28', evidence_tier: 'company', use: 'draft', asset_specific: false },
  { id: 'F2', question_id: 'bank.people', kind: 'person', claim: 'Jordan Sample is Chief Credit Officer.', quote: 'serves as Chief Credit Officer', source_url: 'https://acmebank.test/leadership', publisher: 'Acme Community Bank', published: '2026-09', evidence_tier: 'company', use: 'draft', asset_specific: false },
  { id: 'F3', question_id: 'bank.assets', kind: 'asset', claim: 'A receiver was appointed for the Example Grove Apartments on a $27,182,818 loan.', quote: 'receiver appointed Example Grove Apartments', source_url: 'https://court.test/1', publisher: 'County court', published: '2026-08-02', evidence_tier: 'government', use: 'context', asset_specific: true },
];
export const ACCOUNT = (over = {}) => account({
  sectors: ['multifamily'], institutionKey: KEY, originSignals: [SIG1, SIG2], tier: 'A', pipeline: PIPELINE,
  contact: { emailStatus: 'verified', roleConfirmed: true, roleConfirmedBy: 'Pat Example', roleConfirmedAt: '2026-11-10T12:00:00Z', provenance: [{ source: 'bank leadership page', date: '2026-11-01' }] },
  ...over,
});
export const NOTES = `Call with Jordan Sample, 30 minutes.
They are open to a loan sale of two multifamily loans but want a confidentiality agreement first.
Jordan asked us to send our NDA by 2026-11-21. Jordan will send the tape after the NDA is signed.
Concern: they worry a buyer will contact borrowers.
Riley Example in special assets runs the workout side and may join the next call.
Follow up on 2026-12-01.`;
export const PROPOSAL_REPLY = {
  outcomes: [
    { code: 'held', when: '', referral: '', quote: 'Call with Jordan Sample, 30 minutes' },
    { code: 'nda_requested', when: '', referral: '', quote: 'want a confidentiality agreement first' },
    { code: 'tape_promised', when: '', referral: '', quote: 'Jordan will send the tape after the NDA is signed' },
  ],
  objections: [{ text: 'A buyer may contact borrowers.', quote: 'they worry a buyer will contact borrowers' }],
  commitments: [
    { who: 'us', what: 'Send our confidentiality agreement', by: '2026-11-21', quote: 'send our NDA by 2026-11-21' },
    { who: 'them', what: 'Send the loan tape after the agreement is signed', by: 'after the NDA is signed', quote: 'Jordan will send the tape after the NDA is signed' },
  ],
  follow_up_date: '2026-12-01',
  people: [{ name: 'Riley Example', title: 'special assets', context: 'runs the workout side' }],
};

export const GOOD_BRIEF = {
  who: [{ text: 'Jordan Sample, Chief Credit Officer. A principal confirmed the role.', cites: ['account:person', 'research:F2'] }],
  why_now: [{ text: 'Multifamily loans are 43.21% of its CRE book, and their noncurrent ratio is 6.17%, up from 2.04% four quarters earlier.', cites: ['card:2', SIG1] }],
  holdings: [
    { text: 'Multifamily loans of $812.3 million, as reported.', tier: 'reported', cites: ['paper:q1.multifamily.balance'] },
    { text: 'An estimated 15.17% to 35.29% of nonfarm nonresidential loans may be office.', tier: 'inferred', cites: ['paper:q2.officeShare'] },
  ],
  wants: [{ text: 'A buyer that handles confidentiality carefully, since the bank has said it intends to reduce multifamily loans through sales.', cites: ['research:F1'] }],
  objections: [{ objection: 'We are not ready to share anything.', response: 'Understood. We sign a confidentiality agreement first.', cites: ['claim:nda-first'] }],
  questions: [{ text: 'How does your team decide when a loan is better sold than worked out?', cites: ['playbook:bank.intent'] }],
  can_say: [
    { claim_id: 'nda-first', quote: claim('nda-first'), when: 'If they ask how we handle confidentiality.' },
    { claim_id: 'no-obligation', quote: claim('no-obligation'), when: 'If they worry about committing.' },
  ],
  not_say: [{ text: 'Do not mention the apartments named in the court record.', cites: ['research:F3'] }],
  next_steps: [{ text: 'Offer to sign a confidentiality agreement before anything loan-level is shared.', cites: ['claim:nda-first'] }],
};

// A data folder with one account at a call-ready stage: researched, two touches sent, a reply, and (optionally) a paper estimate.
export function setup({ paper = true, acct = ACCOUNT(), touches = null, suppression = [] } = {}) {
  const dir = makeDir();
  put(dir, 'senders.json', { senders: [SENDER] });
  put(dir, 'suppression.json', { entries: suppression });
  put(dir, `accounts/${ID}.json`, acct);
  put(dir, `research/${ID}.json`, { account: ID, date: '2026-11-05', findings: FINDINGS, riskScreen: { approach: 'ok', reasons: [], finding_ids: [] }, personCheck: { status: 'confirmed', note: 'Two pages agree.', finding_ids: ['F2'] }, angle: { text: 'A bank that has said it will reduce multifamily loans.', finding_ids: ['F1'], supported: true }, gaps: [] });
  put(dir, `facts/${ID}.json`, FINDINGS.map((f) => ({ id: `${ID}:${f.id}`, kind: f.kind, claim: f.claim, quote: f.quote, url: f.source_url, publisher: f.publisher, published: f.published, tier: f.evidence_tier, use: f.use, asset_specific: f.asset_specific })));
  put(dir, 'candidates/latest.json', { runId: 'score-1', latestRepdte: '20260630', items: [{ key: KEY, cert: '99999', name: acct.name, tier: 'A', signals: PIPELINE.signals, profile: PIPELINE.profile, latestRepdte: '20260630', card: { text: CARD.join(' '), sentences: CARD.map((text) => ({ text, evidence: ['fdic:99999:20260630'] })) } }] });
  if (paper) put(dir, 'paper/fdic-99999.json', PAPER);
  put(dir, `drafts/${ID}/2-email.json`, { account: ID, channel: 'email', step: 2, status: 'approved', subject: 'Introduction from a multifamily loan buyer', claimsUsed: ['confidential-no-borrower-contact'], text: 'x', output: {} });
  const t = touches ?? [
    { type: 'touch', accountId: ID, institution: acct.name, step: 1, channel: 'letter', sender: 'pat', date: '2026-11-02' },
    { type: 'touch', accountId: ID, institution: acct.name, step: 2, channel: 'email', sender: 'pat', date: '2026-11-06' },
    { type: 'reply', accountId: ID, institution: acct.name, date: '2026-11-09' },
  ];
  put(dir, 'touches.jsonl', t.map((x) => JSON.stringify(x)).join('\n') + (t.length ? '\n' : ''));
  return dir;
}
export const reply = (obj) => textReply(obj);
export const path = (dir, ...p) => join(dir, ...p);
