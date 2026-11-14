// Shared fixtures for the routes to the decision-maker (PRD E22): one bank account with research on its people, board, counsel, advisors
// and memberships; a sale ledger; and the firm's network. Every name, firm, association and page is invented. Distinctive names make a
// leak easy to spot.
import { join } from 'node:path';
import { makeDir, put, SENDER, CONTACT } from './kit.mjs';
import { loadRules } from '../src/rules.mjs';
import { addPerson, addFirm, addMembership } from '../src/network.mjs';
import { listingEvent, assignmentEvent } from '../src/sales.mjs';

export const rules = loadRules();
export const ID = 'acme-bank';
export const KEY = 'fdic:99999';
export const NOW = new Date('2026-11-14T12:00:00Z');
export const BY = 'Pat Example';

// A finding as runBriefer stores it in research/<id>.json, after the code checks (src/research.mjs).
export const finding = (o) => ({
  id: 'F1', question_id: 'bank.people', kind: 'person', claim: 'Jordan Sample is Chief Credit Officer.', quote: 'Jordan Sample joined Acme Community Bank in 2019 and serves as Chief Credit Officer',
  source_url: 'https://acmebank.test/about/leadership', source_title: 'Leadership', publisher: 'Acme Community Bank', published: '2026-09', evidence_tier: 'company',
  requestedUse: 'context', asset_specific: false, corroborated_by: [], status: 'verified', corroborations: 1, stale: false, use: 'context', contextReason: 'x', supportVerdict: 'yes',
  entities: [{ type: 'person', name: 'Jordan Sample', affiliation: '', role: 'Chief Credit Officer' }], entitiesDropped: 0, affiliationsDropped: 0, contextOnlyTopic: false, ...o,
});

export const FINDINGS = [
  finding(),
  finding({ id: 'F2', question_id: 'bank.board', claim: 'Casey Q. Example is a director and a partner at Example Grove Partners LLP.', quote: 'Casey Q. Example, Director, is a partner at Example Grove Partners LLP',
    source_url: 'https://acmebank.test/about/board', published: '2026-08-01', contextOnlyTopic: true,
    entities: [{ type: 'person', name: 'Casey Q. Example', affiliation: 'Example Grove Partners LLP', role: 'Director' }] }),
  finding({ id: 'F3', question_id: 'bank.counsel', kind: 'relationship', claim: 'Sample & Sample LLP represents the bank as lender.', quote: 'represented by Riley Counsel of Sample & Sample LLP, attorneys for the lender',
    source_url: 'https://court.example.test/docket/2026-0042', publisher: 'Example County Superior Court', published: '2026-07-15', evidence_tier: 'government', asset_specific: true, contextOnlyTopic: true,
    entities: [{ type: 'firm', name: 'Sample & Sample LLP', affiliation: '', role: 'attorneys for the lender' }, { type: 'person', name: 'Riley Counsel', affiliation: 'Sample & Sample LLP', role: 'attorney' }] }),
  finding({ id: 'F4', question_id: 'bank.advisors', kind: 'relationship', claim: 'Invented Loan Advisors LLC advised the bank on a loan sale.', quote: 'Invented Loan Advisors LLC advised Acme Community Bank on the sale of a commercial loan pool',
    source_url: 'https://news.example.test/2026/advisor-closes-sale', publisher: 'Example Trade News', published: '2026-06-02', evidence_tier: 'press', contextOnlyTopic: true,
    entities: [{ type: 'firm', name: 'Invented Loan Advisors LLC', affiliation: '', role: 'loan sale advisor' }] }),
  finding({ id: 'F5', question_id: 'bank.memberships', kind: 'relationship', claim: 'Jordan Sample spoke at the CRE Finance Council annual conference.', quote: 'Speakers: Jordan Sample, Acme Community Bank. CRE Finance Council Annual Conference',
    source_url: 'https://events.example.test/crefc-annual/speakers', publisher: 'Example Events', published: '', evidence_tier: 'company', contextOnlyTopic: true,
    entities: [{ type: 'person', name: 'Jordan Sample', affiliation: 'Acme Community Bank', role: 'speaker' }, { type: 'association', name: 'CRE Finance Council', affiliation: '', role: '' }] }),
  finding({ id: 'F6', question_id: 'bank.memberships', kind: 'relationship', claim: 'The bank is a member of the Example State Bankers Association.', quote: 'Acme Community Bank is a member of the Example State Bankers Association',
    source_url: 'https://esba.example.test/members', publisher: 'Example State Bankers Association', published: '2026-10', contextOnlyTopic: true,
    entities: [{ type: 'association', name: 'Example State Bankers Association', affiliation: '', role: 'member' }] }),
  // A finding whose quote could not be checked against retrieved text, with no second source: it must not become a route.
  finding({ id: 'F7', question_id: 'bank.board', claim: 'Taylor Invented is a director.', quote: 'Taylor Invented, Director', status: 'unchecked', corroborations: 1, contextOnlyTopic: true,
    entities: [{ type: 'person', name: 'Taylor Invented', affiliation: '', role: 'Director' }] }),
];

export const ACCOUNT = (over = {}) => ({
  id: ID, name: 'Acme Community Bank', aliases: ['Acme Bancorp'], type: 'bank', audience: 'bank', sectors: ['multifamily'], tier: 'A', institutionKey: KEY,
  person: { name: 'Jordan Sample', title: 'Chief Credit Officer', email: 'jordan@acmebank.test', phone: '555-0199', phoneType: 'landline', timezone: 'America/Phoenix', mailingAddress: '10 Main St, Anytown' },
  // A complete contact, as the guard reads it (E7-S3): every field sourced, the address verified on 2026-11-01, the role confirmed.
  contact: CONTACT({ roleConfirmedBy: BY }),
  ...over,
});

export const LEDGER = () => {
  const listing = listingEvent({ site: 'example-listings', listingId: 'L-77', listedOn: '2026-10-01', link: 'https://listings.example.test/l-77', seller: { kind: 'bank', key: KEY, name: 'Acme Community Bank' }, advisor: 'Invented Note Brokers', propertyType: 'Multifamily', balance: 4200000, loans: 3 });
  const assigned = assignmentEvent({ county: '04013', recordingNumber: '20260900042', recordedOn: '2026-09-12', deedOfTrust: { recordingNumber: '20190001', beneficiary: 'Acme Community Bank', originalPrincipal: 3100000 }, assignor: 'Acme Community Bank', assignee: 'Invented Buyer Fund LLC', source: 'county:04013', kindOf: (n) => (/acme/i.test(n) ? { kind: 'bank', key: KEY, name: 'Acme Community Bank' } : null) });
  const fdicSale = { id: 'fdic-sale:S-9', kind: 'fdic_sale_announced', date: '2026-10-15', seller: { kind: 'fdic', key: 'fdic-receiver', name: 'FDIC as receiver', receiverships: [{ name: 'Failed Example Bank', city: 'Anytown', state: 'AZ', key: 'fdic:88888' }] },
    buyer: { kind: 'unknown', name: 'unknown' }, asset: { kind: 'pool', propertyType: null, metro: null, balance: 9000000 }, tier: 'reported',
    sources: [{ source: 'fdicsales', ids: ['S-9'], link: 'https://www.fdic.gov/asset-sales/events/s-9', date: null }], sale: { saleId: 'S-9', advisor: 'Invented Sale Advisors LLC' }, contextOnly: true };
  const events = Object.fromEntries([listing, assigned, fdicSale].map((e) => [e.id, { ...e, supported: true, firstSeenAt: '2026-10-20T00:00:00.000Z' }]));
  return { builtAt: '2026-10-20T00:00:00.000Z', runId: 'sales-1', events };
};

// The firm's network: np-1 knows a director (same name and firm); np-2 works at the bank's counsel; nf-3 is the advisor the bank used;
// nm-4 is a membership in the association where the bank's officer spoke; np-5 connects to nothing.
export function addNetwork(dir) {
  addPerson({ dir, name: 'Casey Example', organization: 'Example Grove Partners', title: 'Partner', relationship: 'co-investor on two deals', knownBy: BY, introConsent: 'yes', by: BY, now: NOW });
  addPerson({ dir, name: 'Avery Invented', organization: 'Sample and Sample', title: 'Partner', relationship: 'former colleague', knownBy: 'Lee Example', by: BY, now: NOW });
  addFirm({ dir, name: 'Invented Loan Advisors', kind: 'advisor', relationship: 'we bid on their sales', knownBy: BY, by: BY, now: NOW });
  addMembership({ dir, association: 'CREFC', principal: BY, aliases: ['CRE Finance Council'], by: BY, now: NOW });
  addPerson({ dir, name: 'Morgan Unrelated', organization: 'Unrelated Holdings', relationship: 'neighbor', knownBy: BY, by: BY, now: NOW });
}

export function world({ account = ACCOUNT(), findings = FINDINGS, research = true, ledger = true, network = true, touches = [], suppression = [] } = {}) {
  const dir = makeDir();
  put(dir, `accounts/${account.id}.json`, account);
  if (research) put(dir, `research/${account.id}.json`, { account: account.id, date: '2026-11-13', mode: 'institution', findings, riskScreen: { approach: 'ok', reasons: [], finding_ids: [] }, personCheck: { status: 'not_named', note: '', finding_ids: [] } });
  if (ledger) put(dir, 'sales/ledger.json', LEDGER());
  put(dir, 'senders.json', { senders: [SENDER] });
  put(dir, 'suppression.json', { entries: suppression });
  if (touches.length) put(dir, 'touches.jsonl', touches.map((t) => JSON.stringify(t)).join('\n') + '\n');
  if (network) addNetwork(dir);
  return dir;
}

export const at = (dir, rel) => join(dir, rel);
