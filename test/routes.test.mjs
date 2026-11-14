// PRD E22-S3 to S6: routes to the decision-maker. buildRoutes matches the lender side (sourced findings, the sale ledger, county counsel
// records) against the firm's network in code, with no model, and ranks the routes from routes.json. A principal chooses one and gets a
// checklist; nothing is drafted or sent, and the guard is unchanged. All names, firms and pages are invented (test/routes-kit.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { REPO, put } from './kit.mjs';
import { rules, ID, KEY, NOW, BY, FINDINGS, ACCOUNT, finding, world } from './routes-kit.mjs';
import { readJson, readJsonl } from '../src/store.mjs';
import { addPerson, addFirm, addMembership, readNetwork } from '../src/network.mjs';
import { loadContext, checkTouch, touchFromAccount } from '../src/guard.mjs';
import { buildRoutes, readRoutes, chooseRoute, removeNetworkEntry, counselEvent, validateCounselEvent, validateRoutesRules, routesPaths, routesLoads, ROUTE_TYPES } from '../src/routes.mjs';
import { LOADS, withUnitOfWork, snapshotFromDir, applyPlanToDir } from '../src/uow.mjs';

const R = () => structuredClone(rules);
const DAY = NOW.toISOString().slice(0, 10);
const build = (dir, o = {}) => buildRoutes({ dir, id: ID, rules: o.rules ?? rules, now: o.now ?? NOW, env: {}, ...(o.counselFeeders ? { counselFeeders: o.counselFeeders } : {}) });
const byType = (rec, type) => rec.routes.filter((r) => r.type === type);
const audits = (dir) => readJsonl(join(dir, 'audit.jsonl'));
const NETWORK_NAMES = ['Casey Example', 'Avery Invented', 'Invented Loan Advisors', 'CREFC', 'Morgan Unrelated', 'co-investor', 'former colleague', 'Lee Example'];

// ---- The rules file ---------------------------------------------------------------------------------------------------------------
test('the committed routes.json is valid, holds no prospect data, and every section says its values are placeholders', () => {
  const r = rules.routes;
  assert.deepEqual(validateRoutesRules(r), []);
  assert.match(r._note, /PLACEHOLDER/);
  for (const [k, v] of Object.entries(r)) if (v && typeof v === 'object') assert.match(String(v._note ?? ''), /PLACEHOLDER/, `${k} needs a _note saying its values are placeholders`);
  assert.deepEqual([...r.order.types].sort(), [...ROUTE_TYPES].sort());
  assert.doesNotMatch(readFileSync(join(REPO, 'routes.json'), 'utf8'), /fdic:\d|@|\bBank\b/, 'a rule file names no institution, key or address');
  const bad = R().routes; bad.order.types = ['board', 'board']; bad.tiers.finding.press = 'rumored'; bad.consent.required = 'yes'; bad.currency.maxAgeDays.forum = 0; bad.topics['bank.people'] = 'friend';
  const e = validateRoutesRules(bad);
  for (const m of [/order.types/, /tiers.finding.press/, /consent.required/, /currency.maxAgeDays.forum/, /topics.bank.people/]) assert.ok(e.some((x) => m.test(x)), String(m));
  const rr = R(); rr.routes = bad;
  assert.throws(() => build(world(), { rules: rr }), /routes.json has errors/);
});

// ---- No invented facts ----------------------------------------------------------------------------------------------------------
test('with no network, the direct route is the only route: no match means no route', () => {
  const rec = build(world({ network: false }));
  assert.deepEqual(rec.routes.map((r) => r.type), ['direct']);
  assert.equal(rec.routes[0].id, 'r-direct');
});

test('every route found is backed by a sourced finding, a ledger event or a county record, and by a network entry', () => {
  const rec = build(world());
  assert.deepEqual(rec.routes.map((r) => [r.type, r.target.name, r.bridge?.id ?? null]), [
    ['board', 'Casey Q. Example', 'np-1'],
    ['counsel', 'Sample & Sample LLP', 'np-2'],
    ['advisor', 'Invented Loan Advisors LLC', 'nf-3'],
    ['forum', 'Jordan Sample', 'nm-4'],
    ['direct', 'Jordan Sample', null],
  ]);
  for (const r of rec.routes.filter((x) => x.type !== 'direct')) {
    assert.ok(r.evidence.findings.length + r.evidence.ledger.length + r.evidence.county.length > 0, `${r.id} has no lender-side evidence`);
    assert.ok(r.evidence.network.length > 0, `${r.id} has no network entry`);
    for (const f of r.evidence.findings) assert.match(f.url, /^https:\/\//);
    assert.match(r.reasoning, /\S/);
    assert.equal(r.reasoning.split('\n').length, 1, 'one line of reasoning');
  }
  // The network person who connects to nothing, the unrelated association and the unmatched ledger advisor give no route.
  assert.ok(!JSON.stringify(rec.routes).includes('Morgan Unrelated'));
  assert.ok(!JSON.stringify(rec.routes).includes('Example State Bankers Association'));
  assert.ok(!JSON.stringify(rec.routes).includes('Invented Note Brokers'));
});

test('a finding whose quote could not be checked is not used; a known buyer in the ledger is not a route (D-R6); both are counted', () => {
  const dir = world();
  addPerson({ dir, name: 'Taylor Invented', organization: 'Acme Community Bank', knownBy: BY, by: BY, now: NOW });
  addFirm({ dir, name: 'Invented Buyer Fund', kind: 'other', knownBy: BY, by: BY, now: NOW });
  const rec = build(dir);
  assert.ok(!rec.routes.some((r) => r.target.name === 'Taylor Invented'), 'F7 was never checked against retrieved text');
  assert.ok(!rec.routes.some((r) => /Invented Buyer Fund/.test(JSON.stringify(r))));
  assert.equal(rec.leftOut.uncheckedFindings, 1);
  assert.equal(rec.leftOut.ledgerBuyers, 1);
});

// ---- Matching and tiers ---------------------------------------------------------------------------------------------------------
test('a person matched on name and organization keeps the evidence tier; a same-name match is inferred and says so, or is dropped (D-R5)', () => {
  const rec = build(world());
  const board = byType(rec, 'board')[0];
  assert.deepEqual([board.tier, board.match], ['reported', 'name-and-organization']);
  assert.deepEqual(board.evidence.findings.map((f) => [f.id, f.question, f.sourceTier]), [['F2', 'bank.board', 'company']]);
  assert.deepEqual(board.evidence.network, ['np-1']);
  assert.match(board.reasoning, /Casey Q\. Example/);
  assert.match(board.reasoning, /np-1/);
  assert.match(board.reasoning, /Pat Example/);

  const dir = world();
  addPerson({ dir, name: 'Jordan Sample', organization: 'A Different Invented Firm', knownBy: 'Lee Example', by: BY, now: NOW });   // np-6
  const named = build(dir);
  const same = named.routes.find((r) => r.bridge?.id === 'np-6');
  assert.deepEqual([same.type, same.tier, same.match], ['board', 'inferred', 'name-only']);
  assert.match(same.reasoning, /same name only: confirm it is the same person/);
  const off = R(); off.routes.matching.personNameOnly = false;
  const dropped = build(dir, { rules: off });
  assert.ok(!dropped.routes.some((r) => r.bridge?.id === 'np-6'));
  assert.equal(dropped.leftOut.nameOnly, 1, 'one officer finding names Jordan Sample; the speaker list (F5) gives a forum target, never a board route');
});

test('a firm matches a network firm or a network person\'s organization; a colleague at a director\'s firm is inferred', () => {
  const rec = build(world());
  const counsel = byType(rec, 'counsel')[0];
  assert.deepEqual([counsel.tier, counsel.match, counsel.bridge.kind], ['reported', 'works-at-the-firm', 'person']);
  assert.deepEqual(counsel.evidence.findings.map((f) => f.id), ['F3']);
  assert.equal(counsel.assetSpecific, true, 'a court filing names a particular asset');
  const advisor = byType(rec, 'advisor')[0];
  assert.deepEqual([advisor.tier, advisor.match, advisor.bridge.kind], ['observed', 'firm-name', 'firm']);   // a press source is observed

  const dir = world();
  addPerson({ dir, name: 'Robin Invented', organization: 'Example Grove Partners LLP', knownBy: 'Lee Example', by: BY, now: NOW });   // np-6, the director's colleague
  const col = build(dir).routes.find((r) => r.bridge?.id === 'np-6');
  assert.deepEqual([col.type, col.target.name, col.tier, col.match], ['board', 'Casey Q. Example', 'inferred', 'colleague']);
  const off = R(); off.routes.matching.colleagues = false;
  assert.ok(!build(dir, { rules: off }).routes.some((r) => r.bridge?.id === 'np-6'));
});

test('a forum route reaches the people the roster names, or the bank when it names none; an alias matches', () => {
  const rec = build(world());
  const forum = byType(rec, 'forum');
  assert.deepEqual(forum.map((r) => [r.target.kind, r.target.name, r.bridge.id]), [['person', 'Jordan Sample', 'nm-4']]);
  assert.match(forum[0].reasoning, /CRE Finance Council/);
  const dir = world({ findings: [...FINDINGS.filter((f) => f.id !== 'F5'), finding({ id: 'F5', question_id: 'bank.memberships', quote: 'Acme Community Bank is a sustaining member of CREFC', source_url: 'https://crefc.example.test/members', published: '2026-10', contextOnlyTopic: true, entities: [{ type: 'association', name: 'CREFC', affiliation: '', role: 'member' }] })] });
  const inst = byType(build(dir), 'forum');
  assert.deepEqual(inst.map((r) => [r.target.kind, r.target.name]), [['institution', 'Acme Community Bank']]);
});

test('a support check that did not say yes makes the route inferred', () => {
  const dir = world({ findings: FINDINGS.map((f) => (f.id === 'F2' ? { ...f, supportVerdict: 'partly' } : f)) });
  assert.equal(byType(build(dir), 'board')[0].tier, 'inferred');
});

// ---- The sale ledger and county records -------------------------------------------------------------------------------------------
test('the ledger: an advisor named on a listing the bank sold through is an advisor route', () => {
  const dir = world();
  addFirm({ dir, name: 'Invented Note Brokers Inc.', kind: 'broker', knownBy: BY, by: BY, now: NOW });   // nf-6
  const r = build(dir).routes.find((x) => x.bridge?.id === 'nf-6');
  assert.deepEqual([r.type, r.target.name, r.tier], ['advisor', 'Invented Note Brokers', 'observed']);
  assert.deepEqual(r.evidence.ledger.map((e) => e.id), ['listing:example-listings:L-77']);
  assert.equal(r.evidence.ledger[0].link, 'https://listings.example.test/l-77');
});

test('the FDIC\'s loan-sale advisor is a route into the FDIC\'s sale of a failed bank\'s loans, never into a bank, and says so', () => {
  const dir = world({ account: ACCOUNT({ id: 'failed-example', name: 'Failed Example Bank', aliases: [], institutionKey: 'fdic:88888' }), research: false });
  addFirm({ dir, name: 'Invented Sale Advisors', kind: 'advisor', knownBy: BY, by: BY, now: NOW });   // nf-6
  const rec = buildRoutes({ dir, id: 'failed-example', rules, now: NOW, env: {} });
  const r = rec.routes.find((x) => x.type === 'advisor');
  assert.equal(r.fdicReceiver, true);
  assert.match(r.reasoning, /the FDIC's loan-sale advisor/);
  assert.match(r.reasoning, /a route into the FDIC's sale, not into the bank/);
  assert.deepEqual(r.evidence.ledger.map((e) => e.id), ['fdic-sale:S-9']);
  // For any other bank, the FDIC's advisor is no route at all.
  const other = world();
  addFirm({ dir: other, name: 'Invented Sale Advisors', kind: 'advisor', knownBy: BY, by: BY, now: NOW });
  assert.ok(!build(other).routes.some((x) => x.fdicReceiver || /Invented Sale Advisors/.test(x.target.name)));
});

test('county counsel: the event shape resolves MERS and is checked; a feeder\'s event becomes a counsel route; a bad one writes nothing', () => {
  const ev = counselEvent({ county: '04013', documentNumber: '20261000777', documentType: 'notice_of_trustee_sale', recordedOn: '2026-10-07', lender: 'Mortgage Electronic Registration Systems, Inc., as nominee for Acme Community Bank, its successors and assigns',
    lenderCounsel: 'Invented Trustee Law Group, P.C.', attorneys: ['Jamie Invented'], trustee: 'Invented Trustee Services', apn: '123-45-678', source: 'county:04013', link: 'https://recorder.example.test/doc/20261000777',
    kindOf: (n) => (/acme/i.test(n) ? { kind: 'bank', key: KEY, name: 'Acme Community Bank' } : null) });
  assert.deepEqual(validateCounselEvent(ev), []);
  assert.deepEqual([ev.id, ev.tier, ev.lender.key, ev.lender.nominee, ev.assetSpecific], ['county-counsel:04013:20261000777', 'observed', KEY, 'MERS', true]);
  assert.ok(validateCounselEvent({ ...ev, counsel: { firm: '' } }).some((x) => /counsel.firm/.test(x)));
  assert.ok(validateCounselEvent({ ...ev, lender: { kind: 'other', name: 'MERS' } }).some((x) => /MERS/.test(x)));
  assert.ok(validateCounselEvent({ ...ev, date: '10/07/2026' }).some((x) => /date/.test(x)));

  const dir = world();
  addFirm({ dir, name: 'Invented Trustee Law Group', kind: 'law', knownBy: BY, by: BY, now: NOW });   // nf-6
  const feeder = { source: 'county-fake', build: () => ({ events: [ev], missing: [] }) };
  const r = build(dir, { counselFeeders: [feeder] }).routes.find((x) => x.bridge?.id === 'nf-6');
  assert.deepEqual([r.type, r.target.name, r.tier, r.assetSpecific], ['counsel', 'Invented Trustee Law Group, P.C.', 'observed', true]);
  assert.deepEqual(r.evidence.county.map((c) => [c.id, c.link]), [['county-counsel:04013:20261000777', 'https://recorder.example.test/doc/20261000777']]);

  const clean = world();
  const bad = { source: 'county-fake', build: () => ({ events: [{ ...ev, counsel: { firm: '' } }], missing: [] }) };
  assert.throws(() => build(clean, { counselFeeders: [bad] }), /Nothing was written/);
  assert.equal(existsSync(routesPaths(clean, ID).json), false);
});

// ---- Currency, consent, suppression -------------------------------------------------------------------------------------------
test('evidence older than routes.json allows makes a route not current; an undated page counts from the research run (D-R3)', () => {
  const rec = build(world(), { now: new Date('2027-09-01T12:00:00Z') });
  const board = byType(rec, 'board')[0];
  assert.equal(board.current, false, 'F2 is from August 2026, more than 365 days before');
  assert.equal(board.asOf, '2026-08-01');
  assert.equal(byType(rec, 'counsel')[0].current, true, 'counsel stays current for 730 days');
  const forum = byType(build(world()), 'forum')[0];
  assert.deepEqual([forum.current, forum.asOf, forum.evidence.findings[0].dateBasis], [true, '2026-11-13', 'research run']);
  assert.equal(existsSync(routesPaths(world(), ID).md), false, 'nothing is written until a build');
});

test('a contact who said no is never a route; when consent is required, a route through someone who has not agreed is held (D-R2)', () => {
  const dir = world();
  const net = readNetwork(dir);
  net.people['np-2'].introConsent = 'no';
  put(dir, 'network/network.json', net);
  const rec = build(dir);
  assert.ok(!rec.routes.concat(rec.held).some((r) => r.bridge?.id === 'np-2'));
  assert.equal(rec.leftOut.declined, 1);
  const req = R(); req.routes.consent.required = true;
  const held = build(world(), { rules: req });
  assert.deepEqual(held.held.map((r) => [r.bridge.id, r.heldBecause]), [['np-2', 'CONSENT_NEEDED']]);
  assert.ok(held.routes.some((r) => r.bridge?.id === 'np-1'), 'np-1 agreed to be asked');
  assert.ok(held.routes.some((r) => r.bridge?.kind === 'firm'), 'a firm entry is not a person to ask for consent');
});

test('a route whose bridge or target is suppressed is held, never ranked: a route relaxes no guard rule', () => {
  const rec = build(world({ suppression: [{ type: 'institution', value: 'Invented Loan Advisors LLC', reason: 'nda', added: '2026-11-01' }] }));
  assert.ok(!rec.routes.some((r) => r.type === 'advisor'));
  assert.deepEqual(rec.held.map((r) => [r.type, r.heldBecause]), [['advisor', 'SUPPRESSED_PARTY']]);
});

// ---- Ranking -------------------------------------------------------------------------------------------------------------------
test('the order comes from routes.json, and the same inputs give the same routes, ids and order', () => {
  const dir = world();
  const a = build(dir), b = build(dir);
  const strip = (r) => JSON.stringify({ ...r, builtAt: null });
  assert.equal(strip(a), strip(b));
  assert.deepEqual(a.routes.map((r) => r.rank), [1, 2, 3, 4, 5]);
  assert.ok(a.routes.every((r) => /^r-(direct|[0-9a-f]{10})$/.test(r.id)), 'route ids carry no name');
  const flipped = R(); flipped.routes.order.types = ['direct', 'forum', 'advisor', 'counsel', 'board'];
  assert.deepEqual(build(dir, { rules: flipped }).routes.map((r) => r.type), ['direct', 'forum', 'advisor', 'counsel', 'board']);
  assert.deepEqual(build(dir, { rules: flipped }).routes.map((r) => r.id), [...a.routes.map((r) => r.id)].reverse(), 'ids do not depend on the order');
  // Within a type: the stronger tier first, then current before not.
  const d2 = world();
  addPerson({ dir: d2, name: 'Jordan Sample', organization: 'A Different Invented Firm', knownBy: 'Lee Example', by: BY, now: NOW });
  assert.deepEqual(byType(build(d2), 'board').map((r) => r.tier), ['reported', 'inferred']);
});

// ---- The direct route ---------------------------------------------------------------------------------------------------------
test('the direct route is always listed, with its status from the existing prerequisites', () => {
  const ready = build(world()).routes.find((r) => r.type === 'direct');
  assert.deepEqual([ready.status.personNamed, ready.status.roleConfirmed, ready.status.email.verified, ready.status.ready], [true, true, true, true]);
  assert.deepEqual(ready.evidence.findings.map((f) => f.id), ['F1'], 'bank.people only: the speaker list (F5) is a forum route\'s evidence');
  assert.equal(ready.tier, 'reported');

  const none = build(world({ account: ACCOUNT({ person: { name: '', title: '' }, contact: { roleConfirmed: false } }) })).routes.find((r) => r.type === 'direct');
  assert.equal(none.target.kind, 'candidates');
  assert.deepEqual(none.target.names, ['Jordan Sample']);
  assert.deepEqual(none.status.missing, ['PERSON_NOT_NAMED', 'ROLE_UNCONFIRMED', 'EMAIL_UNVERIFIED']);
  assert.match(none.reasoning, /No person is named yet/);

  const bare = build(world({ research: false, network: false, account: ACCOUNT({ person: {}, contact: {} }) })).routes;
  assert.deepEqual(bare.map((r) => [r.type, r.target.kind, r.target.names.length, r.tier]), [['direct', 'candidates', 0, 'inferred']]);
});

test('the direct route calls an address verified only when the guard would (E7-S3): expired, verified for an old address, or unsourced is not', () => {
  const guardCodes = (dir) => checkTouch(touchFromAccount(readJson(join(dir, 'accounts', `${ID}.json`)), { channel: 'email', step: 1, date: DAY, sender: 'pat' }), loadContext({ dir, config: rules.config, env: {} })).errors.map((e) => e.code);
  const c = ACCOUNT().contact;
  const cases = [
    ['expired', { verification: { ...c.verification, verifiedOn: '2026-03-01' } }, 'EMAIL_UNVERIFIED'],   // 258 days before; contacts.json reverifyDays is 180
    ['other_address', { verification: { ...c.verification, email: 'jordan.old@acmebank.test' } }, 'EMAIL_UNVERIFIED'],
    ['unsourced', { provenance: c.provenance.filter((p) => p.field !== 'email') }, 'EMAIL_UNSOURCED'],
    ['unverified', { verification: null }, 'EMAIL_UNVERIFIED'],   // "verified", with no record of who checked it, how or when
    ['unverified', { emailStatus: undefined, email: { status: 'verified', address: 'jordan@acmebank.test' }, verification: null }, 'EMAIL_UNVERIFIED'],   // a status the guard does not read
  ];
  for (const [state, over, code] of cases) {
    const dir = world({ account: ACCOUNT({ contact: { ...c, ...over } }) });
    assert.ok(guardCodes(dir).includes(code), `${state}: the guard refuses it with ${code}`);
    const direct = build(dir).routes.find((r) => r.type === 'direct');
    assert.deepEqual([direct.status.email.verified, direct.status.email.status, direct.status.ready], [false, state, false], state);
    assert.ok(direct.status.missing.includes(code), `${state}: ${direct.status.missing}`);
    assert.doesNotMatch(direct.reasoning, /address is verified/);
    const { checklist } = chooseRoute({ dir, id: ID, routeId: 'r-direct', by: BY, rules, now: NOW, env: {} });
    assert.ok(checklist.ask.some((x) => /outbound account (verify-email|set-email) --account/.test(x)), `${state}: ${checklist.ask.join(' | ')}`);
    assert.doesNotMatch(readFileSync(routesPaths(dir, ID).md, 'utf8'), /Ready\./, state);
  }
  // When the guard lets an email to the address through, and only then, the direct route says it is verified.
  const ok = world();
  assert.ok(!guardCodes(ok).some((x) => x.startsWith('EMAIL_')), guardCodes(ok).join());
  const direct = build(ok).routes.find((r) => r.type === 'direct');
  assert.deepEqual([direct.status.email.verified, direct.status.email.status, direct.status.ready], [true, 'verified', true]);
});

// ---- Review findings on the matching (PR #8) ------------------------------------------------------------------------------------
test('a person a membership finding names is a forum target, never a board route: a speaker list is no evidence of a director or officer', () => {
  const dir = world({ findings: FINDINGS.filter((f) => f.id !== 'F1') });   // only F5, a speaker list, names Jordan Sample
  addPerson({ dir, name: 'Jordan Sample', organization: 'Acme Community Bank', knownBy: 'Lee Example', by: BY, now: NOW });   // np-6
  const rec = build(dir);
  assert.ok(!rec.routes.concat(rec.held).some((r) => r.type === 'board' && r.bridge?.id === 'np-6'), 'a board route from a speaker list');
  for (const r of byType(rec, 'board')) for (const f of r.evidence.findings) assert.ok(['bank.people', 'bank.board'].includes(f.question), `${r.id} cites ${f.question}`);
  assert.deepEqual(byType(rec, 'forum').map((r) => [r.target.name, r.bridge.id]), [['Jordan Sample', 'nm-4']], 'the speaker is still the forum route\'s target');
});

test('a forum route pairs an association only with people its finding ties to it: one association per finding, and the bank\'s own people', () => {
  // "The bank belongs to one association; its officer spoke at another": nothing says which association the officer appears with.
  const two = finding({ id: 'F5', question_id: 'bank.memberships', kind: 'relationship', claim: 'The bank is a member of one association, and its officer spoke at another\'s conference.',
    quote: 'Acme Community Bank is a member of the Example State Bankers Association. Jordan Sample spoke at the CRE Finance Council Annual Conference', source_url: 'https://esba.example.test/news', published: '2026-10', contextOnlyTopic: true,
    entities: [{ type: 'association', name: 'Example State Bankers Association', affiliation: '', role: 'member' }, { type: 'person', name: 'Jordan Sample', affiliation: '', role: 'speaker' }, { type: 'association', name: 'CRE Finance Council', affiliation: '', role: '' }] });
  const dir = world({ findings: [...FINDINGS.filter((f) => !['F5', 'F6'].includes(f.id)), two] });
  addMembership({ dir, association: 'Example State Bankers Association', principal: BY, by: BY, now: NOW });   // nm-6
  const rec = build(dir);
  assert.deepEqual(byType(rec, 'forum').map((r) => [r.target.name, r.bridge.id]), [], 'a finding that names two associations cannot say who belongs to which');
  assert.equal(rec.leftOut.multiAssociation, 1);
  assert.match(readFileSync(routesPaths(dir, ID).md, 'utf8'), /name more than one association: 1/);
  // One association, and a speaker list that also names someone from another bank: only the bank's own people are its targets.
  const mixed = finding({ id: 'F5', question_id: 'bank.memberships', kind: 'relationship', claim: 'Two bankers spoke at the CRE Finance Council annual conference.',
    quote: 'Speakers: Jordan Sample, Acme Community Bank; Drew Otherperson, Other Example Bank. CRE Finance Council Annual Conference', source_url: 'https://events.example.test/crefc-annual/speakers', published: '', contextOnlyTopic: true,
    entities: [{ type: 'person', name: 'Jordan Sample', affiliation: 'Acme Community Bank', role: 'speaker' }, { type: 'person', name: 'Drew Otherperson', affiliation: 'Other Example Bank', role: 'speaker' }, { type: 'association', name: 'CRE Finance Council', affiliation: '', role: '' }] });
  const d2 = world({ findings: [...FINDINGS.filter((f) => f.id !== 'F5'), mixed] });
  const r2 = build(d2);
  assert.deepEqual(byType(r2, 'forum').map((r) => r.target.name), ['Jordan Sample']);
  assert.equal(r2.leftOut.peopleElsewhere, 1);
});

test('the direct route\'s evidence for a named person is the bank\'s own people findings only, never a speaker list or a court filing', () => {
  const dir = world({ findings: FINDINGS.filter((f) => f.id !== 'F1') });   // F5, a speaker list, still names Jordan Sample
  const direct = build(dir).routes.find((r) => r.type === 'direct');
  assert.deepEqual([direct.evidence.findings, direct.tier, direct.current, direct.asOf], [[], 'inferred', false, null]);
  const d2 = world({ account: ACCOUNT({ person: { ...ACCOUNT().person, name: 'Riley Counsel' } }) });   // F3, a court filing, names Riley Counsel as the lender's attorney
  assert.deepEqual(build(d2).routes.find((r) => r.type === 'direct').evidence.findings, []);
});

test('choosing the direct route rebuilds it from the account as it is now, not as the build stored it', () => {
  const dir = world();
  assert.equal(build(dir).routes.find((r) => r.type === 'direct').status.ready, true);
  // A principal names someone else: their role is unconfirmed and they have no address yet.
  put(dir, `accounts/${ID}.json`, ACCOUNT({ person: { name: 'Robin Newperson', title: 'Head of Special Assets', email: '', phone: '', phoneType: '', timezone: '', mailingAddress: '' },
    contact: { emailStatus: 'unverified', roleConfirmed: false, provenance: [{ field: 'name', value: 'Robin Newperson', kind: 'principal_known', seenOn: '2026-11-13', by: BY, at: '2026-11-13T12:00:00.000Z' }], verification: null } }));
  const { route, checklist } = chooseRoute({ dir, id: ID, routeId: 'r-direct', by: BY, rules, now: NOW, env: {} });
  assert.deepEqual([route.target.name, route.status.roleConfirmed, route.status.ready], ['Robin Newperson', false, false]);
  assert.ok(checklist.ask.some((x) => /confirm-role/.test(x)) && checklist.ask.some((x) => /set-email/.test(x)), checklist.ask.join(' | '));
  const stored = readJson(routesPaths(dir, ID).json);
  assert.deepEqual([stored.routes.find((r) => r.type === 'direct').target.name, stored.chosen.routeId], ['Robin Newperson', 'r-direct'], 'the stored direct route is the one the checklist was made from');
  assert.doesNotMatch(readFileSync(routesPaths(dir, ID).md, 'utf8'), /Jordan Sample is named for this account/);
});

test('every set-person command a checklist names works on the command line: it carries a source, as E7-S3 requires', () => {
  const dir = world({ account: ACCOUNT({ person: { name: '', title: '' }, contact: { roleConfirmed: false, provenance: [] } }) });
  const rec = build(dir);
  const env = { ...process.env, OUTBOUND_DATA_DIR: dir };
  const fill = { '--name': null, '--by': BY, '--finding': 'F1' };
  const run = (text, name) => {
    const m = /outbound account set-person ((?:--[a-z-]+ \S+ ?)+)/.exec(text ?? '');
    assert.ok(m, `no set-person command in: ${text}`);
    const pairs = m[1].trim().split(/\s+/);
    const args = pairs.map((v, i) => { const flag = pairs[i - 1]; const val = v.replace(/[,.)]+$/, ''); return i % 2 && Object.hasOwn(fill, flag) && /^[A-Z]+$/.test(val) ? (fill[flag] ?? name) : val; });
    return execFileSync(process.execPath, [join(REPO, 'cli.mjs'), 'account', 'set-person', ...args], { env, encoding: 'utf8', stdio: 'pipe' });
  };
  const direct = chooseRoute({ dir, id: ID, routeId: 'r-direct', by: BY, rules, now: NOW, env: {} }).checklist;
  assert.match(run(direct.ask.find((x) => /set-person/.test(x)), 'Jordan Sample'), /Person set for Acme Community Bank: Jordan Sample/);
  const warm = chooseRoute({ dir, id: ID, routeId: byType(rec, 'board')[0].id, by: BY, rules, now: NOW, env: {} }).checklist;
  assert.match(run(warm.after.find((x) => /set-person/.test(x)), 'Robin Newperson'), /Person set for Acme Community Bank: Robin Newperson/);
});

test('the guard\'s view is shown: an opt-out at the bank, and a conversation already under way', () => {
  const opted = build(world({ touches: [{ type: 'opt_out', accountId: 'acme-other', institution: 'Acme Community Bank', date: '2026-11-01' }] }));
  assert.deepEqual(opted.guard.hardStops.map((h) => h.code), ['OPT_OUT']);
  assert.equal(opted.guard.blocksChoice, true);
  const talking = build(world({ touches: [{ type: 'reply', accountId: ID, institution: 'Acme Community Bank', date: '2026-11-03' }] }));
  assert.deepEqual(talking.guard.inConversation, { type: 'reply', date: '2026-11-03' });
  assert.equal(talking.guard.blocksChoice, false);
});

// ---- Files and the command line ------------------------------------------------------------------------------------------------
test('the routes are written to the data folder, json and md; the md says it is internal and that nothing is sent', () => {
  const dir = world();
  build(dir);
  const p = routesPaths(dir, ID);
  assert.deepEqual([p.json, p.md], [join(dir, 'routes', `${ID}.json`), join(dir, 'routes', `${ID}.md`)]);
  const md = readFileSync(p.md, 'utf8');
  assert.match(md, /^# Routes to the decision-maker: Acme Community Bank/);
  assert.match(md, /Internal: for the firm's principals only/);
  assert.match(md, /nothing is drafted or sent to a network contact or an intermediary/);
  assert.match(md, /1\. \*\*Board\*\*/);
  assert.equal(readRoutes({ dir, id: ID }).record.routes.length, 5);
  assert.deepEqual(routesLoads(ID).filter((x) => /^(accounts|research|routes)\//.test(x)), [`accounts/${ID}.json`, `research/${ID}.json`, `routes/${ID}.json`, `routes/${ID}.md`]);
  for (const p2 of ['network/', 'sales/ledger.json', 'touches.jsonl', 'suppression.json']) assert.ok(routesLoads(ID).includes(p2), p2);
  assert.ok(!LOADS.routes.includes(''), 'never everything');
});

test('the command line: network add and list, routes build, show and choose, network remove', () => {
  const dir = world({ network: false });
  const env = { ...process.env, OUTBOUND_DATA_DIR: dir };
  const cli = (...args) => execFileSync(process.execPath, [join(REPO, 'cli.mjs'), ...args], { env, encoding: 'utf8', stdio: 'pipe' });
  assert.match(cli('network', 'add-person', '--name', 'Casey Example', '--organization', 'Example Grove Partners', '--known-by', BY, '--consent', 'yes', '--relationship', 'co-investor', '--by', BY), /np-1/);
  assert.match(cli('network', 'add-firm', '--name', 'Invented Loan Advisors', '--kind', 'advisor', '--known-by', BY, '--by', BY), /nf-2/);
  assert.match(cli('network', 'add-membership', '--association', 'CREFC', '--alias', 'CRE Finance Council', '--principal', BY, '--by', BY), /nm-3/);
  assert.match(cli('network', 'list', '--by', BY), /Casey Example/);
  assert.throws(() => cli('network', 'list'), /--by is required/);
  assert.match(cli('routes', 'build', '--account', ID), /4 routes/);
  const rec = readJson(routesPaths(dir, ID).json);
  const board = rec.routes.find((r) => r.type === 'board');
  assert.match(cli('routes', 'show', '--account', ID), /# Routes to the decision-maker/);
  assert.equal(JSON.parse(cli('routes', 'show', '--account', ID, '--json')).routes.length, 4);
  assert.match(cli('routes', 'choose', '--account', ID, '--route', board.id, '--by', BY), /Nothing is drafted or sent/);
  assert.throws(() => cli('routes', 'choose', '--account', ID, '--route', 'r-0000000000', '--by', BY), /No route r-0000000000/);
  assert.match(cli('network', 'remove', '--id', 'np-1', '--by', BY), /removed from 1 routes file/);
  assert.ok(!readFileSync(routesPaths(dir, ID).md, 'utf8').includes('Casey Example'));
});

// ---- Choosing a route ---------------------------------------------------------------------------------------------------------
test('choosing a warm route records who chose it and gives a checklist: who to ask, what to cite, what never to say', () => {
  const dir = world();
  const rec = build(dir);
  const counsel = byType(rec, 'counsel')[0];
  const { checklist } = chooseRoute({ dir, id: ID, routeId: counsel.id, by: BY, rules, now: NOW, env: {} });
  const stored = readJson(routesPaths(dir, ID).json);
  assert.deepEqual([stored.chosen.routeId, stored.chosen.by, stored.chosen.supported], [counsel.id, BY, true]);
  assert.equal(checklist.drafted, false);
  const md = readFileSync(routesPaths(dir, ID).md, 'utf8');
  assert.match(md, /## Chosen route/);
  assert.match(md, /Ask Avery Invented/);
  assert.match(md, /has not said whether they agree to be asked for introductions: ask whether they are willing first/);
  assert.match(md, /https:\/\/court\.example\.test\/docket\/2026-0042/);
  assert.match(md, /never mention its property, loan or borrower/);
  assert.match(md, /outbound account set-person/);
  assert.match(md, /Nothing here is drafted or sent/);
  const line = audits(dir).find((a) => a.type === 'route_chosen');
  assert.deepEqual([line.accountId, line.routeId, line.routeType, line.by], [ID, counsel.id, 'counsel', BY]);
  for (const leak of NETWORK_NAMES) assert.ok(!JSON.stringify(audits(dir)).includes(leak), `audit leaked "${leak}"`);
});

test('the checklist asks the right person the right thing: the director themself, a colleague, a firm, or a forum', () => {
  const dir = world();
  addPerson({ dir, name: 'Robin Invented', organization: 'Example Grove Partners LLP', knownBy: 'Lee Example', by: BY, now: NOW });   // np-6, the director's colleague
  const rec = build(dir);
  const ask = (pred) => chooseRoute({ dir, id: ID, routeId: rec.routes.find(pred).id, by: BY, rules, now: NOW, env: {} }).checklist.ask[0];
  const self = ask((r) => r.type === 'board' && r.bridge.id === 'np-1');
  assert.match(self, /^Ask Casey Example .*who at Acme Community Bank decides on loan sales/);
  assert.doesNotMatch(self, /introduce you to Casey/, 'a director is not asked to introduce you to themself');
  assert.match(ask((r) => r.bridge?.id === 'np-6'), /^Ask Robin Invented .*introduce you to Casey Q\. Example/);
  assert.match(ask((r) => r.type === 'advisor'), /^Ask your contact at Invented Loan Advisors .*the person at Acme Community Bank who decides on loan sales/);
  assert.match(ask((r) => r.type === 'forum'), /^At CREFC, where Pat Example is a member, look for Jordan Sample/);
  const { checklist } = chooseRoute({ dir, id: ID, routeId: rec.routes[0].id, by: BY, rules, now: NOW, env: {} });
  assert.ok(checklist.after.some((x) => /still a touch for the guard/.test(x)), 'a message a principal writes themself is still a touch');
});

test('choosing changes no account, drafts nothing, records no touch, and leaves the guard\'s verdict exactly as it was', () => {
  const dir = world({ account: ACCOUNT({ contact: { emailStatus: 'unverified', roleConfirmed: false, provenance: [] } }) });
  const ctx = () => loadContext({ dir, config: rules.config, env: {} });
  const verdict = () => checkTouch(touchFromAccount(readJson(join(dir, 'accounts', `${ID}.json`)), { channel: 'email', step: 1, date: '2026-11-16', sender: 'pat' }), ctx());
  const before = { account: readFileSync(join(dir, 'accounts', `${ID}.json`), 'utf8'), verdict: verdict() };
  const rec = build(dir);
  for (const r of rec.routes) chooseRoute({ dir, id: ID, routeId: r.id, by: BY, rules, now: NOW, env: {} });
  assert.equal(readFileSync(join(dir, 'accounts', `${ID}.json`), 'utf8'), before.account);
  assert.deepEqual(verdict(), before.verdict);
  assert.equal(before.verdict.allowed, false);
  assert.equal(existsSync(join(dir, 'drafts')), false);
  assert.equal(existsSync(join(dir, 'touches.jsonl')), false);
  assert.deepEqual(readdirSync(dir).sort(), ['accounts', 'audit.jsonl', 'network', 'research', 'routes', 'sales', 'senders.json', 'suppression.json']);
});

test('choosing is refused for a route that is held or unknown, and when the bank opted out or is suppressed', () => {
  const req = R(); req.routes.consent.required = true;
  const dir = world();
  const rec = build(dir, { rules: req });
  assert.throws(() => chooseRoute({ dir, id: ID, routeId: rec.held[0].id, by: BY, rules: req, now: NOW, env: {} }), /held: CONSENT_NEEDED/);
  assert.throws(() => chooseRoute({ dir, id: ID, routeId: 'r-0000000000', by: BY, rules, now: NOW, env: {} }), /No route r-0000000000/);
  assert.throws(() => chooseRoute({ dir, id: ID, routeId: rec.routes[0].id, by: '', rules, now: NOW, env: {} }), /--by/);
  assert.throws(() => chooseRoute({ dir: world(), id: ID, routeId: 'r-direct', by: BY, rules, now: NOW, env: {} }), /No routes yet/);
  for (const w of [world({ touches: [{ type: 'opt_out', accountId: ID, institution: 'Acme Community Bank', date: '2026-11-01' }] }), world({ suppression: [{ type: 'institution', value: 'Acme Community Bank', reason: 'nda' }] })]) {
    const r = build(w);
    assert.throws(() => chooseRoute({ dir: w, id: ID, routeId: r.routes[0].id, by: BY, rules, now: NOW, env: {} }), /must not go around an opt-out or a suppression/);
    assert.equal(readJson(routesPaths(w, ID).json).chosen, null);
  }
});

test('choosing checks the route again against the network and the suppression list as they are now, not as they were at the build', () => {
  const dir = world();
  const rec = build(dir);
  const counsel = byType(rec, 'counsel')[0], advisor = byType(rec, 'advisor')[0];
  const net = readNetwork(dir);
  net.people['np-2'].introConsent = 'no';
  delete net.firms['nf-3'];
  put(dir, 'network/network.json', net);
  assert.throws(() => chooseRoute({ dir, id: ID, routeId: counsel.id, by: BY, rules, now: NOW, env: {} }), /said no to being asked for introductions/);
  assert.throws(() => chooseRoute({ dir, id: ID, routeId: advisor.id, by: BY, rules, now: NOW, env: {} }), /no longer in the network: build the routes again/);
  put(dir, 'suppression.json', { entries: [{ type: 'person', value: 'Casey Example', reason: 'asked not to be contacted' }] });
  assert.throws(() => chooseRoute({ dir, id: ID, routeId: byType(rec, 'board')[0].id, by: BY, rules, now: NOW, env: {} }), /on the suppression list/);
  assert.equal(readJson(routesPaths(dir, ID).json).chosen, null);
});

test('a rebuild keeps a choice whose route still exists, and marks one whose evidence is gone', () => {
  const dir = world();
  const forum = byType(build(dir), 'forum')[0];
  chooseRoute({ dir, id: ID, routeId: forum.id, by: BY, rules, now: NOW, env: {} });
  assert.equal(build(dir).chosen.routeId, forum.id);
  assert.equal(build(dir).chosen.supported, true);
  put(dir, `research/${ID}.json`, { ...readJson(join(dir, 'research', `${ID}.json`)), findings: FINDINGS.filter((f) => f.id !== 'F5') });
  const after = build(dir);
  assert.deepEqual([after.chosen.routeId, after.chosen.supported, after.chosen.checklist], [forum.id, false, null]);
  assert.match(readFileSync(routesPaths(dir, ID).md, 'utf8'), /no longer supported by the evidence/);
});

// ---- Removing a network entry ------------------------------------------------------------------------------------------------
test('removing a network entry removes it everywhere routes stored it, including a choice that used it', () => {
  const dir = world();
  put(dir, 'accounts/beta-bank.json', ACCOUNT({ id: 'beta-bank', name: 'Beta Example Bank', aliases: [], institutionKey: 'fdic:77777' }));
  put(dir, 'research/beta-bank.json', { account: 'beta-bank', date: '2026-11-13', findings: [FINDINGS[2]] });   // the same counsel
  const counsel = byType(build(dir), 'counsel')[0];
  buildRoutes({ dir, id: 'beta-bank', rules, now: NOW, env: {} });
  chooseRoute({ dir, id: ID, routeId: counsel.id, by: BY, rules, now: NOW, env: {} });
  const r = removeNetworkEntry({ dir, id: 'np-2', by: BY, now: NOW });
  assert.deepEqual([r.kind, r.routeFiles, r.routesRemoved], ['person', 2, 2]);
  assert.equal(readNetwork(dir).people['np-2'], undefined);
  for (const f of readdirSync(join(dir, 'routes'))) {
    const t = readFileSync(join(dir, 'routes', f), 'utf8');
    for (const leak of ['Avery Invented', 'former colleague', 'Lee Example', 'np-2']) assert.ok(!t.includes(leak), `${f} still holds "${leak}"`);
  }
  const rec = readJson(routesPaths(dir, ID).json);
  assert.equal(rec.chosen, null);
  assert.match(rec.choiceRemoved.reason, /network entry it used was removed/);
  assert.deepEqual(rec.routes.map((x) => x.rank), rec.routes.map((_, i) => i + 1), 'ranks are renumbered');
  const line = audits(dir).find((a) => a.type === 'network_removed');
  assert.deepEqual([line.id, line.entry, line.routeFiles, line.routesRemoved, line.by], ['np-2', 'person', 2, 2, BY]);
  for (const leak of NETWORK_NAMES) assert.ok(!JSON.stringify(audits(dir)).includes(leak), `audit leaked "${leak}"`);
  assert.throws(() => removeNetworkEntry({ dir, id: 'np-2', by: BY }), /No network entry np-2/);
});

// ---- One engine, two backends (PRD E12-S1) ---------------------------------------------------------------------------------------
test('parity: building, choosing and removing store the same thing on a data folder and in a unit of work loaded with only their load lists', async () => {
  const scrub = (v) => JSON.parse(JSON.stringify(v).replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, '<ts>'));
  const a = world(), b = world();
  const steps = [
    [routesLoads(ID), (dir) => buildRoutes({ dir, id: ID, rules, now: NOW, env: {} })],
    [routesLoads(ID), (dir) => chooseRoute({ dir, id: ID, routeId: readJson(join(dir, 'routes', `${ID}.json`)).routes[0].id, by: BY, rules, now: NOW, env: {} })],
    [LOADS.network, (dir) => removeNetworkEntry({ dir, id: 'np-2', by: BY, now: NOW })],
  ];
  for (const [prefixes, fn] of steps) {
    const ra = fn(a);
    const snap = snapshotFromDir(b, prefixes);
    const { result: rb } = await withUnitOfWork({ load: async () => snap, flush: async (plan) => applyPlanToDir(plan, b) }, prefixes, async (root) => fn(root));
    assert.deepEqual(scrub(rb), scrub(ra));
  }
  const files = (d) => scrub(snapshotFromDir(d, ['routes/', 'network/']));
  assert.deepEqual(files(b), files(a));
});
