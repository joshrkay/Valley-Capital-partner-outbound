// The property behind a county filing, from the county's parcel record (docs/county-loans.md section 3a, src/parcels.mjs): the
// Jefferson adapter against a fake ArcGIS layer (test/parcels-fake.mjs), the address matching, the assessor's codes, the scope rule (by
// the principal's ruling of 2026-11-23: a lead only when the parcel confirms a commercial property, a multifamily one of 5 or more units,
// or commercial land), the property-not-confirmed list, the weekly job, the rebuild with no network, the triage's order and the load
// lists. Invented addresses, names and parcels only; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { makeDir, put, config, loadJson, REPO } from './kit.mjs';
import { readJson, writeJson } from '../src/store.mjs';
import { buildDocument, diffDocuments, writeDiff, buildLoanIndex, rebuildLoanIndex, scopeAll, scopeShown, eventShown, decideScope, readParcelMatches, loanEvents, loansPaths,
  readBankLoans, readUnconfirmed, commercialFromLoanType, SECTORS, PROPERTY_TYPES } from '../src/loans.mjs';
import { lookupParcels, parseAddress, streetKey, compareStreets, decideMatch, parcelReport, parcelReportText, PARCEL_SOURCES } from '../src/parcels.mjs';
import { classifyColorado } from '../src/sources/parcels/colorado.mjs';
import { jeffersonParcels, OUT_FIELDS, ATTRIBUTION } from '../src/sources/parcels/jefferson.mjs';
import { jefferson } from '../src/sources/counties/jefferson.mjs';
import { runNoticeSource } from '../src/sources/notices.mjs';
import { LOADS, withUnitOfWork, snapshotFromDir, callDeskLoads } from '../src/uow.mjs';
import { callLoads } from '../src/calls.mjs';
import { runTriage } from '../src/triage.mjs';
import { buildCmbsLinks } from '../src/cmbslinks.mjs';
import { INSTITUTIONS } from './county-notices-fake.mjs';
import { fakeArcgis, parcel, OWNER, MAILING } from './parcels-fake.mjs';
import { jeffersonSite, layoutOf, ADDRESSES as GTS_ADDRESSES } from './gts-fake.mjs';

const AT = '2026-11-16T12:00:00.000Z';
const counties = () => config().counties;
const party = (role, name) => ({ role, name });
const LEND = [party('holder', 'Example Bank, N.A.'), party('grantor', 'Sample Holdings LLC')];
// A Jefferson NED at an invented address, with its loan type and the flag the adapter reads.
const ned = (n, address, type = 'Commercial', { parties = LEND, recorded = '2026-11-12' } = {}) => {
  const b = buildDocument({
    documentType: 'election_and_demand', documentNumber: `${n}/NED`, dates: { recorded, filed: null, listed: null, sale: '2027-03-10' }, parties,
    property: { address, apn: null }, amounts: { originalPrincipal: { value: 2000000, basis: 'index' }, unpaidBalance: { value: 1900000, basis: 'index' } },
    ...(type ? { loan: { type, commercial: commercialFromLoanType(type) } } : {}), foreclosure: { number: n }, url: 'https://gts.co.jefferson.co.us/Report_Files/NED%2011-12-2026.pdf',
  }, { source: jefferson, fetchedAt: AT, runId: 'r1' });
  assert.deepEqual(b.errors, []);
  return b.record;
};
function world(docs) {
  const dir = makeDir();
  put(dir, 'sources/fdic/institutions.json', INSTITUTIONS);
  writeDiff(dir, 'jefferson', diffDocuments({}, docs, { now: new Date(AT), runId: 'r1' }), { runId: 'r1', now: new Date(AT) });
  return dir;
}
// The lookup against a fake, with a clock that only moves when the lookup waits.
function looker(fake) {
  const waits = [];
  let clock = 0;
  const run = (dir, over = {}) => lookupParcels({ dir, sourceId: 'jefferson', counties: counties(), fetchImpl: fake.fetchImpl, sleep: async (ms) => { waits.push(ms); clock += ms; }, nowMs: () => clock, now: new Date(AT), ...over });
  return { run, waits };
}
const scopeOf = (dir, id) => scopeAll(Object.values(readJson(loansPaths(dir).docs('jefferson'))), { parcels: readParcelMatches(dir) }).get(id);

// ---- The requests ----------------------------------------------------------------------------------------------------------------
test('the layer is asked in OR batches of at most 40 (number AND ZIP) clauses, returnGeometry false, no owner field, 1.5 seconds apart, robots.txt first', async () => {
  const docs = Array.from({ length: 41 }, (_, i) => ned(`J26${String(i).padStart(5, '0')}`, `${711 + i} Sample Street, Anytown, CO 80000`));
  const dir = world(docs);
  const fake = fakeArcgis({ parcels: [parcel({ num: 711, name: 'SAMPLE', type: 'ST', codes: [['2115', 500000], ['2215', 4000000]], uses: ['Hotel - Limited Service'], units: 60 })] });
  const { run, waits } = looker(fake);
  const r = await run(dir);
  // robots.txt, the two batches by ZIP code, and one by city for the 40 the ZIP code found no parcel for.
  assert.deepEqual([r.outcome, r.looked, r.matched, r.unmatched, r.requests], ['ok', 41, 1, 40, 4]);
  assert.deepEqual(fake.calls.map((c) => c.path), ['/robots.txt', ...Array(3).fill('/server2/rest/services/Parcel/FeatureServer/20/query')]);
  const q = fake.queries();
  assert.deepEqual(q.map((c) => c.clauses), [40, 1, 40]);
  assert.match(q[2].where, /^\(PRPSTRNUM='00712' AND UPPER\(PRPCTYNAM\)='ANYTOWN'\) OR /);
  assert.match(q[0].where, /^\(PRPSTRNUM='00711' AND PRPZIP5='80000'\) OR \(PRPSTRNUM='00712' AND PRPZIP5='80000'\)/, 'the number zero-padded to five digits');
  assert.ok(q.every((c) => c.returnGeometry === 'false' && c.f === 'json'));
  assert.deepEqual(q[0].outFields, [...OUT_FIELDS]);
  assert.ok(!OUT_FIELDS.some((f) => /^(OWN|MAIL|DBA)/.test(f)), 'no owner or mailing field is ever asked for');
  assert.ok(fake.calls.every((c) => c.ua === counties().userAgent), 'every request names the firm');
  assert.deepEqual(waits, [1500, 1500, 1500], 'at least 1.5 seconds between requests');
  // The stored match: identifiers, codes, use, units, sector, how, confidence and when; no owner, no mailing address, no site address.
  const file = readJson(loansPaths(dir).parcels('jefferson'));
  const m = file.matches['jefferson:J2600000/NED'];
  assert.deepEqual([m.status, m.kind, m.sector, m.decidedBy, m.how, m.confidence, m.checkedAt, m.parcels[0].uses, m.parcels[0].units, typeof m.parcels[0].sch, typeof m.parcels[0].pin],
    ['matched', 'commercial', 'hospitality', '2115', { street: 'exact', place: 'zip', unit: false }, 'high', AT, ['Hotel - Limited Service'], 60, 'string', 'string']);
  assert.deepEqual([file.attribution, file.licence.short], [ATTRIBUTION, 'CC BY 4.0']);
  const text = JSON.stringify(file);
  for (const leak of [OWNER, MAILING, 'Sample Street', 'SAMPLE ST', '711 ', 'Sample Holdings']) assert.ok(!text.includes(leak), `the parcel file holds "${leak}"`);
  // The stored documents and their content hash are untouched.
  assert.equal(readJson(loansPaths(dir).docs('jefferson'))['jefferson:J2600000/NED'].contentHash, docs[0].contentHash);
  // Run again: nothing to look up, nothing asked.
  const again = await run(dir);
  assert.deepEqual([again.looked, again.requests, fake.calls.length], [0, 0, 4]);
});

test('a page of more than the layer gives at once is read to its end with resultOffset; an error answer, a refusal or robots.txt saying no is counted, never thrown', async () => {
  const many = Array.from({ length: 5 }, (_, i) => parcel({ num: 250, name: 'EXAMPLE', type: 'AVE', unit: String(101 + i), codes: [['1230', 200000]], uses: ['Condo, Res: Low Rise (3-)'] }));
  const dir = world([ned('J2600501', '250 Example Avenue, Anytown, CO 80000')]);
  const paged = fakeArcgis({ parcels: many, maxRecordCount: 2 });
  const r = await looker(paged).run(dir);
  assert.deepEqual([r.outcome, r.matched, paged.queries().map((c) => c.resultOffset)], ['ok', 1, [null, '2', '4']]);
  assert.equal(readParcelMatches(dir).get('jefferson:J2600501/NED').parcelCount, 5, 'every unit of the building seen');
  // An ArcGIS error body, a refusal, robots.txt disallowing the layer: the outcome says so, nothing is stored, nothing throws.
  for (const [fake, why] of [[fakeArcgis({ error: { code: 400, message: 'Invalid query' } }), /answered with an error/], [fakeArcgis({ fail: 403 }), /HTTP 403/],
    [fakeArcgis({ robots: 'User-agent: *\nDisallow: /server2/\n' }), /robots\.txt on gisportal\.jeffco\.us disallows/]]) {
    const d = world([ned('J2600502', '251 Example Avenue, Anytown, CO 80000')]);
    const x = await looker(fake).run(d);
    assert.deepEqual([x.outcome, x.failed, x.matched], ['failed', 1, 0], JSON.stringify(x));
    assert.match(x.error, why);
    assert.ok(!readParcelMatches(d).has('jefferson:J2600502/NED'), 'nothing stored: looked up again next time');
  }
  // A refusal stops the run: the second batch is not asked.
  const docs = Array.from({ length: 45 }, (_, i) => ned(`J27${String(i).padStart(5, '0')}`, `${100 + i} Sample Street, Anytown, CO 80000`));
  const refused = fakeArcgis({ fail: 403 });
  const y = await looker(refused).run(world(docs));
  assert.deepEqual([y.outcome, y.failed, refused.queries().length], ['failed', 45, 1]);
  // A server error is retried (src/sources/http.mjs), then counted; a later batch is still asked.
  const flaky = fakeArcgis({ fail: (n) => (n <= 3 ? 503 : null) });
  const z = await looker(flaky).run(world(docs));
  assert.deepEqual([z.outcome, z.failed, z.unmatched], ['partial', 40, 5]);
  // A placeholder User-Agent: refused before any request.
  const quiet = fakeArcgis();
  const p = await lookupParcels({ dir: world([ned('J2600503', '252 Example Avenue, Anytown, CO 80000')]), sourceId: 'jefferson', counties: { ...counties(), userAgent: '[CONFIRM: firm name]' }, fetchImpl: quiet.fetchImpl });
  assert.deepEqual([p.outcome, quiet.calls.length], ['failed', 0]);
  // A county with no parcel source, or the switch off: no request.
  assert.equal((await lookupParcels({ dir: makeDir(), sourceId: 'douglas', counties: counties(), fetchImpl: quiet.fetchImpl })).outcome, 'no-source');
  assert.equal((await lookupParcels({ dir: makeDir(), sourceId: 'jefferson', counties: { ...counties(), parcels: { enabled: false } }, fetchImpl: quiet.fetchImpl })).outcome, 'off');
  assert.equal(quiet.calls.length, 0);
});

// ---- The mapping: one test per row of the rule --------------------------------------------------------------------------------------
// Each: the parcel's codes ([code, value]), its building uses and units, the filing's loan type, and what the rule makes of it.
const ROWS = [
  ['a house (1112/1212)', [['1112', 150000], ['1212', 400000]], ['1 Story/Ranch'], 0, 'Commercial', 'out', 'residential-parcel'],
  ['a duplex or triplex (1115/1215)', [['1115', 150000], ['1215', 400000]], ['Mixed Design'], 2, 'BPL Commercial', 'out', 'residential-parcel'],
  ['a house on farm-residence land (1177/1277)', [['1177', 150000], ['1277', 300000]], ['2 Story'], 0, 'Business', 'out', 'residential-parcel'],
  ['a house by its improvements only (1212)', [['1212', 350000]], ['1 Story/Ranch'], 0, 'Commercial', 'out', 'residential-parcel'],
  ['a condo (1230)', [['1230', 300000]], ['Condo, Res: Low Rise (3-)'], 0, 'Commercial', 'out', 'residential-parcel'],
  ['a 4-unit building (1120 with 4 units)', [['1120', 200000], ['1220', 600000]], ['Apartments with GL Units'], 4, 'Commercial', 'out', 'residential-parcel'],
  ['an apartment building of 8 units (1120 with 8)', [['1120', 300000], ['1220', 1200000]], ['Apartments with GL Units'], 8, 'FHA', 'lead', 'multifamily'],
  ['apartments of 9 or more units (1125)', [['1125', 900000], ['1225', 5000000]], ['Apartments Above Grade Units Only'], 40, 'FNMA', 'lead', 'multifamily'],
  ['a 4 to 8 unit apartment code with no unit count (1120)', [['1120', 300000], ['1220', 700000]], ['1 Story/Ranch'], 0, 'Commercial', 'review', 'units-unknown'],
  ['a retail store (2112/2212)', [['2112', 400000], ['2212', 600000]], ['Store, Retail'], 0, 'Conventional', 'lead', 'retail'],
  ['a hotel (2115/2215)', [['2115', 900000], ['2215', 5000000]], ['Hotel - Limited Service'], 64, 'VA', 'lead', 'hospitality'],
  ['an office building (2120/2220)', [['2120', 500000], ['2220', 900000]], ['Office Building'], 0, 'FHA', 'lead', 'office'],
  ['a special-purpose building (2130/2230)', [['2130', 600000], ['2230', 900000]], ['Restaurant'], 0, 'CONV', 'lead', 'other-commercial'],
  ['a storage warehouse (2135/2235)', [['2135', 300000], ['2235', 900000]], ['Storage Warehouse'], 0, 'HELOC', 'lead', 'industrial'],
  ['an industrial building (3115/3215)', [['3115', 300000], ['3215', 900000]], ['Industrial, Light Manufacturing'], 0, 'Conventional Residential', 'lead', 'industrial'],
  ['an office condominium (2245, its building use an office)', [['2245', 400000]], ['Office Building'], 0, 'Unknown', 'lead', 'office'],
  ['a retail condominium (2245, its building use a store)', [['2245', 400000]], ['Store, Retail'], 0, 'Unknown', 'lead', 'retail'],
  ['commercial vacant land (0200)', [['0200', 900000]], [], 0, 'FHA', 'lead', 'commercial-land'],
  ['industrial vacant land (0300)', [['0300', 900000]], [], 0, 'Conventional', 'lead', 'commercial-land'],
  ['residential vacant land (0100)', [['0100', 300000]], [], 0, 'Commercial', 'out', 'residential-land'],
  ['other vacant land (0550)', [['0550', 300000]], [], 0, 'Commercial', 'review', 'other-land'],
  ['an exempt property (9149/9249)', [['9149', 300000], ['9249', 900000]], ['Office Building'], 0, 'Commercial', 'review', 'exempt'],
  ['an agricultural property (4147/4277)', [['4147', 30000], ['4277', 400000]], ['1 Story/Ranch'], 0, 'Commercial', 'review', 'agricultural'],
];
for (const [what, codes, uses, units, loanType, verdict, kind] of ROWS) {
  test(`the rule: ${what} with a "${loanType}" loan type is ${verdict === 'lead' ? `a lead (${kind})` : verdict === 'out' ? 'out' : `not a lead, on the property-not-confirmed list (${kind})`}`, async () => {
    const dir = world([ned('J2600601', '4417 Sample Street, Anytown, CO 80000', loanType)]);
    await looker(fakeArcgis({ parcels: [parcel({ num: 4417, name: 'SAMPLE', type: 'ST', codes, uses, units })] })).run(dir);
    const s = scopeOf(dir, 'jefferson:J2600601/NED');
    buildLoanIndex({ dir, now: new Date(AT), runId: 'r1' });
    const rows = readBankLoans({ dir, key: 'fdic:9001' })?.loans ?? [];
    const ev = loanEvents({ dir });
    const un = readUnconfirmed(dir)?.entries ?? [];
    if (verdict === 'lead') {
      assert.deepEqual([s.inScope, s.review], [true, false]);
      const label = kind === 'commercial-land' ? 'Commercial land' : SECTORS[kind].label;
      const words = kind === 'commercial-land' ? 'commercial land' : SECTORS[kind].words;
      assert.deepEqual(rows.map((l) => [l.propertyTypeLabel, l.propertySector, l.propertyConfirmed, l.propertySource, l.loanType]), [[label, kind === 'commercial-land' ? null : kind, true, ATTRIBUTION, loanType]]);
      assert.ok(PROPERTY_TYPES[rows[0].propertyType], 'a PROPERTY_TYPES key');
      assert.equal(ev.length, 1);
      assert.equal(ev[0].label, `A notice of election and demand was recorded on November 12, 2026 for a loan this bank holds on ${words} in Jefferson County, CO; property type confirmed from the county's parcel record.`);
      assert.ok(eventShown(ev[0]) && scopeShown(rows[0]));
      assert.deepEqual(un, []);
    } else {
      assert.deepEqual([s.inScope, rows.length, ev.length], [false, 0, 0], 'no bank row, no event, whatever the loan type');
      if (verdict === 'out') { assert.deepEqual([s.why, s.review, un.length], [kind, false, 0]); return; }
      assert.deepEqual([s.why, s.review, un.map((e) => e.reason)], ['not-confirmed', true, [kind]]);
    }
  });
}

test('the assessor\'s codes, read by value: land gives way to the building on it; a mixed parcel goes to the kind holding most of its value; a tie is not guessed', () => {
  const k = (codes, uses = [], units = null) => { const c = classifyColorado({ codes: codes.map(([code, value]) => ({ code, value })), uses, units }); return [c.kind, c.sector, c.landUse ?? null, c.code]; };
  assert.deepEqual(k([['0100', 200000], ['1212', 300000]]), ['residential', null, null, '1212'], 'vacant-land code with a house on it: a house');
  assert.deepEqual(k([['0200', 200000], ['2230', 100000]]), ['commercial', 'other-commercial', null, '2230'], 'commercial land with a building: the building');
  assert.deepEqual(k([['1112', 60000], ['1212', 250000], ['2120', 400000], ['2220', 480000]]), ['commercial', 'office', null, '2120'], 'a house and an office, the office worth more');
  assert.deepEqual(k([['1112', 240000], ['1212', 330000], ['2120', 24000]]), ['residential', null, null, '1112'], 'a house with a small office portion: a house');
  assert.deepEqual(k([['1112', 20000], ['1212', 140000], ['2135', 2000000], ['2235', 6000000]], ['Warehouse, Mini', 'Apartment Unit in Commercial Bldg']), ['commercial', 'industrial', null, '2135'], 'a mini-warehouse with a manager\'s apartment');
  assert.deepEqual(k([['1112', 100000], ['2112', 100000]]), ['other', null, null, null], 'equal value: not guessed');
  assert.deepEqual(k([['1112', 0], ['2112', 0]]), ['other', null, null, null], 'no value to choose by');
  assert.deepEqual(k([['0200', 100000]]), ['land', null, 'commercial', '0200']);
  assert.deepEqual(k([]), ['other', null, null, null]);
  assert.deepEqual(k([['1120', 1], ['1220', 1]], [], 5), ['commercial', 'multifamily', null, '1120'], '5 units: multifamily');
  // Commercial codes of more than one sector and equal value (values left blank): the building use decides, else other-commercial.
  assert.deepEqual(k([['2112', 0], ['2215', 0]], ['Hotel - Limited Service']), ['commercial', 'hospitality', null, '2215'], 'tie: the building use names the hotel');
  assert.deepEqual(k([['2112', 0], ['2215', 0]]), ['commercial', 'other-commercial', null, '2112'], 'tie and no building use: not guessed, still commercial');
  assert.deepEqual(k([['2112', 0], ['2215', 0]], ['Office Building']), ['commercial', 'other-commercial', null, '2112'], 'tie and a use naming neither tied sector');
  assert.deepEqual(k([['2112', 500000], ['2215', 100000]], ['Hotel - Limited Service']), ['commercial', 'retail', null, '2112'], 'no tie: value decides, not the use');
  // The sectors align with the buy box and the property types.
  assert.ok(loadJson('buybox.json').sectors.include.every((s) => SECTORS[s]), 'every buy-box sector is a sector');
  assert.ok(Object.values(SECTORS).every((s) => PROPERTY_TYPES[s.propertyType]));
});

// ---- Matching an address --------------------------------------------------------------------------------------------------------
test('(a) a frontage road: "12345 S. Frontage Rd" matches the parcel "12345 I-70 FRONTAGE RD S" by its core words, and is a hotel', async () => {
  const dir = world([ned('J2600701', '12345 S. Frontage Rd., Sampleton, CO 80999', 'Commercial Loan')]);
  const fake = fakeArcgis({ parcels: [parcel({ num: 12345, name: 'I-70 FRONTAGE', type: 'RD', sfx: 'S', city: 'SAMPLETON', zip: '80999', codes: [['2115', 900000], ['2215', 5000000]], uses: ['Hotel - Limited Service'], units: 64 })] });
  await looker(fake).run(dir);
  const m = readParcelMatches(dir).get('jefferson:J2600701/NED');
  assert.deepEqual([m.status, m.how, m.confidence, m.kind, m.sector], ['matched', { street: 'core-words', place: 'zip', unit: false }, 'medium', 'commercial', 'hospitality']);
  // The same with the highway written other ways, a direction before the name, and the county's own "1-70".
  for (const [a, b] of [['S Frontage Road', 'I 70 FRONTAGE RD S'], ['South Frontage Rd', 'W I-70 FRONTAGE RD S'], ['Frontage Rd S', '1-70 FRONTAGE RD S']]) assert.equal(compareStreets(streetKey(a), streetKey(b)), 'core-words', `${a} | ${b}`);
  // But a contradicting direction or suffix is another street.
  assert.equal(compareStreets(streetKey('N Frontage Rd'), streetKey('I-70 FRONTAGE RD S')), null);
  assert.equal(compareStreets(streetKey('Frontage Ct'), streetKey('I-70 FRONTAGE RD S')), null);
});

test('(b) the number and ZIP code return two parcels on different streets: only the one on the filing\'s street matches', async () => {
  const dir = world([ned('J2600801', '4321 N. Miller Street, Anytown, CO 80000', 'FHA')]);
  const fake = fakeArcgis({ parcels: [
    parcel({ num: 4321, dir: 'N', name: 'MILLER', type: 'ST', codes: [['2112', 300000], ['2212', 600000]], uses: ['Store, Retail'] }),
    parcel({ num: 4321, dir: 'N', name: 'HOLLAND', type: 'ST', codes: [['1112', 100000], ['1212', 300000]] }),
  ] });
  await looker(fake).run(dir);
  const m = readParcelMatches(dir).get('jefferson:J2600801/NED');
  assert.deepEqual([m.status, m.how.street, m.candidates, m.parcelCount, m.kind, m.sector, m.confidence], ['matched', 'exact', 2, 1, 'commercial', 'retail', 'high']);
  assert.equal(scopeOf(dir, 'jefferson:J2600801/NED').inScope, true, 'a lead, whatever its FHA loan type');
});

test('the normalisation: suffixes, directions before or after, punctuation, ordinals and highways; never two different suffixes', () => {
  const same = [['West 26th Avenue', 'W 26TH AVE'], ['N. Miller Street', 'N MILLER ST'], ['S.Sample Way', 'S SAMPLE WAY'], ['Highway 73', 'STATE HIGHWAY 73'],
    ['US Hwy 285', 'US HIGHWAY 285'], ['Sample Boulevard', 'SAMPLE BLVD'], ['First Street', '1ST ST']];
  for (const [a, b] of same) assert.equal(compareStreets(streetKey(a), streetKey(b)), 'exact', `${a} | ${b}`);
  const core = [['Example', 'EXAMPLE ST'], ['Sample Ridge', 'SAMPLE RIDGE DR'], ['26th Ave', 'W 26TH AVE'], ['Highway 285', 'S US HWY 285'], ['Sample Way S', 'S SAMPLE WAY']];
  for (const [a, b] of core) assert.equal(compareStreets(streetKey(a), streetKey(b)), 'core-words', `${a} | ${b}`);
  for (const [a, b] of [['Miller St', 'MILLER CT'], ['E 26th Ave', 'W 26TH AVE'], ['Samples Way', 'SAMPLE WAY'], ['Overlook Rd', 'OVERLOOK DR']]) assert.equal(compareStreets(streetKey(a), streetKey(b)), null, `${a} | ${b}`);
  // The address's shapes: units with or without a comma, two numbers, no ZIP code, text before a colon, no street number.
  const p = (a) => { const x = parseAddress(a); return x.error ? x.error : [x.numbers, x.unit, x.city, x.zip]; };
  assert.deepEqual(p('4417 Sample Way #206, Anytown, CO 80000-1234'), [['4417'], '206', 'ANYTOWN', '80000']);
  assert.deepEqual(p('201 SAMPLE, UNIT 3-102, ANYTOWN, CO 80000'), [['201'], '3-102', 'ANYTOWN', '80000']);
  assert.deepEqual(p('8311 S Sample Way Condo 104, Anytown, CO 80000'), [['8311'], '104', 'ANYTOWN', '80000']);
  assert.deepEqual(p('7000 W 20TH AVENUE 106, ANYTOWN, CO 80000'), [['7000'], '106', 'ANYTOWN', '80000']);
  assert.deepEqual(p('965 & 975 N Sample Street, Anytown, CO 80000'), [['965', '975'], null, 'ANYTOWN', '80000']);
  assert.deepEqual(p('2220-22 Sample Drive, Anytown, CO 80000'), [['2220', '2222'], null, 'ANYTOWN', '80000']);
  assert.deepEqual(p('9723 9727 West 17th Avenue, Anytown, CO 80000'), [['9723', '9727'], null, 'ANYTOWN', '80000']);
  assert.deepEqual(p('123 W 26th Ave Apt 4-207, Wheatridge, CO'), [['123'], '4-207', 'WHEATRIDGE', null]);
  assert.deepEqual(p('Not listed. For informational purposes only: 6049 Sample Ct,, Anytown, CO 80000'), [['6049'], null, 'ANYTOWN', '80000']);
  assert.deepEqual([p('Sample Lane, Anytown, CO 80000'), p(''), p(null)], ['no-address', 'no-address', 'no-address']);
});

test('several parcels at one address: the filing\'s unit picks its own; with no unit, parcels that disagree on the property type are ambiguous, never a pick', async () => {
  const building = [
    parcel({ num: 250, name: 'EXAMPLE', type: 'AVE', unit: 'A', codes: [['2245', 400000]], uses: ['Store, Retail'] }),
    parcel({ num: 250, name: 'EXAMPLE', type: 'AVE', unit: '101', codes: [['1230', 250000]], uses: ['Condo, Res: Low Rise (3-)'] }),
    parcel({ num: 250, name: 'EXAMPLE', type: 'AVE', unit: '102', codes: [['1230', 250000]], uses: ['Condo, Res: Low Rise (3-)'] }),
  ];
  const dir = world([ned('J2600901', '250 Example Avenue #A, Anytown, CO 80000'), ned('J2600902', '250 Example Ave, Unit 101, Anytown, CO 80000'), ned('J2600903', '250 Example Avenue, Anytown, CO 80000', 'Commercial')]);
  await looker(fakeArcgis({ parcels: building })).run(dir);
  const m = readParcelMatches(dir);
  assert.deepEqual([m.get('jefferson:J2600901/NED').how.unit, m.get('jefferson:J2600901/NED').sector, m.get('jefferson:J2600901/NED').parcelCount], [true, 'retail', 1]);
  assert.deepEqual([m.get('jefferson:J2600902/NED').how.unit, m.get('jefferson:J2600902/NED').kind], [true, 'residential']);
  const amb = m.get('jefferson:J2600903/NED');
  assert.deepEqual([amb.status, amb.classes.map((c) => c.kind).sort(), amb.parcelCount], ['ambiguous', ['commercial', 'residential'], 3]);
  // Condos all of one kind agree with no unit: matched, as residential.
  const dir2 = world([ned('J2600904', '260 Example Avenue, Anytown, CO 80000')]);
  await looker(fakeArcgis({ parcels: [101, 102, 103].map((u) => parcel({ num: 260, name: 'EXAMPLE', type: 'AVE', unit: String(u), codes: [['1230', 250000]] })) })).run(dir2);
  assert.deepEqual([readParcelMatches(dir2).get('jefferson:J2600904/NED').status, readParcelMatches(dir2).get('jefferson:J2600904/NED').kind], ['matched', 'residential']);
  // The ambiguous one is not a lead: it is on the property-not-confirmed list, whatever its "Commercial" loan type.
  buildLoanIndex({ dir, now: new Date(AT), runId: 'r1' });
  assert.deepEqual(readUnconfirmed(dir).entries.map((e) => [e.id, e.reason, e.loanTypeInScope]), [['jefferson:J2600903/NED', 'ambiguous', true]]);
  assert.deepEqual(loanEvents({ dir }).map((e) => e.documentId), ['jefferson:J2600901/NED']);
});

test('no ZIP code: looked up by number and city (the layer\'s spelling); a ZIP code that finds nothing is tried by city, an exact street only', async () => {
  const fake = fakeArcgis({ parcels: [
    parcel({ num: 500, name: 'SAMPLE', type: 'AVE', city: 'Wheat Ridge', zip: '80003', codes: [['2112', 300000], ['2212', 700000]], uses: ['Store, Retail'] }),
    parcel({ num: 600, name: 'EXAMPLE', type: 'CT', city: 'ANYTOWN', zip: '80000', codes: [['2120', 300000], ['2220', 700000]], uses: ['Office Building'] }),
    parcel({ num: 610, name: 'EXAMPLE', type: 'CT', city: 'ANYTOWN', zip: '80000', codes: [['2120', 300000], ['2220', 700000]], uses: ['Office Building'] }),
  ] });
  const dir = world([
    ned('J2601001', '500 Sample Avenue, Wheatridge, CO'),            // no ZIP: by city, its alias the layer's spelling
    ned('J2601002', '600 Example Court, Anytown, CO 80001'),          // the ZIP code finds nothing; the city does, exact
    ned('J2601003', '610 Example, Anytown, CO 80001'),                // the city finds it only by core words: not taken
    ned('J2601004', '700 Sample Avenue, CO'),                         // neither a ZIP code nor a city
  ]);
  const r = await looker(fake).run(dir);
  assert.deepEqual([r.matched, r.byCity, r.noZip, r.noPlace, r.unmatched], [2, 2, 2, 1, 1]);
  assert.ok(fake.queries().some((c) => c.where.includes("UPPER(PRPCTYNAM)='WHEAT RIDGE'")));
  const m = readParcelMatches(dir);
  assert.deepEqual([m.get('jefferson:J2601001/NED').how, m.get('jefferson:J2601001/NED').confidence, m.get('jefferson:J2601001/NED').sector], [{ street: 'exact', place: 'city', unit: false }, 'medium', 'retail']);
  assert.deepEqual([m.get('jefferson:J2601002/NED').how.place, m.get('jefferson:J2601002/NED').sector], ['city', 'office']);
  assert.deepEqual([m.get('jefferson:J2601003/NED').status, m.get('jefferson:J2601003/NED').query], ['unmatched', 'zip']);
  assert.equal(m.get('jefferson:J2601004/NED').status, 'no-place');
});

test('not leads: unmatched, ambiguous, no address and no ZIP or city go on the property-not-confirmed list, never a bank row, an event or a triage line', async () => {
  const dir = world([
    ned('J2601101', '1 Nowhere Street, Anytown, CO 80000', 'Commercial', { recorded: '2026-11-10' }),
    ned('J2601102', null, 'BPL Commercial', { recorded: '2026-11-11' }),
    ned('J2601103', '2 Nowhere Street, Anytown, CO 80000', 'FHA', { recorded: '2026-11-12' }),
    ned('J2601104', '3 Sample Street, CO', 'Commercial', { recorded: '2026-11-13' }),
  ]);
  const r = await looker(fakeArcgis({ parcels: [parcel({ num: 1, name: 'ELSEWHERE', type: 'ST', codes: [['2112', 1], ['2212', 9]] })] })).run(dir);
  assert.deepEqual([r.matched, r.unmatched, r.noAddress, r.noPlace], [0, 2, 1, 1]);
  const c = buildLoanIndex({ dir, now: new Date(AT), runId: 'r1' });
  assert.deepEqual([c.inScope, c.outOfScopeWhy, c.parcels.unconfirmed, c.parcels.unconfirmedLoanTypeWouldKeep], [0, { 'not-confirmed': 4 }, 4, 3]);
  assert.equal(readBankLoans({ dir, key: 'fdic:9001' }), null);
  assert.deepEqual(loanEvents({ dir }), []);
  const un = readUnconfirmed(dir);
  assert.deepEqual(un.entries.map((e) => [e.id.slice(10), e.reason, e.loanTypeInScope, e.loanType]), [
    ['J2601104/NED', 'no-place', true, 'Commercial'], ['J2601102/NED', 'no-address', true, 'BPL Commercial'], ['J2601101/NED', 'unmatched', true, 'Commercial'], ['J2601103/NED', 'unmatched', false, 'FHA']]);
  assert.deepEqual([un.entries[2].reasonText, un.entries[2].banks, un.entries[2].link], ['property not matched to a county parcel', ['fdic:9001'], 'https://gts.co.jefferson.co.us/Report_Files/NED%2011-12-2026.pdf']);
  assert.ok(!JSON.stringify(un).match(/Nowhere|Sample Street|Sample Holdings/), 'no address, no name');
  const t = runTriage({ dir, rules: loadJson('triage.json'), now: new Date('2026-11-16T14:00:00Z'), metros: loadJson('metros.json'), scoring: loadJson('scoring.json'), buybox: loadJson('buybox.json') });
  assert.ok(![...t.actNow, ...t.watch].some((i) => i.findings.some((f) => f.type === 'county-document')), 'no Watch line');
  // The report says the same, and lists the ones to check by hand by id.
  const rep = parcelReport({ dir, sourceId: 'jefferson' });
  assert.deepEqual([rep.leads, rep.leadsBefore, rep.unconfirmed, rep.unconfirmedLoanTypeWouldKeep, rep.review.map((e) => e.id.slice(10))], [0, 3, 4, 3, ['J2601104/NED', 'J2601102/NED', 'J2601101/NED']]);
  const text = parcelReportText(rep, { attribution: ATTRIBUTION });
  assert.match(text, /property not confirmed, not leads: 4 \(unmatched 2, no-address 1, no-place 1\); the loan type alone would keep 3\. To check by hand/);
  assert.match(text, /jefferson:J2601101\/NED  Notice of election and demand, Jefferson County, CO; loan type: Commercial; property not matched to a county parcel; banks: fdic:9001; https:\/\/gts/);
  assert.doesNotMatch(text, /Nowhere|Sample Street/);
});

// ---- The weekly job ---------------------------------------------------------------------------------------------------------------
// One fetch for the fake county site and the fake parcel layer, by host. The GTS fake's first four addresses are a retail store, a hotel,
// a house and an office.
const PARCELS_FOR_GTS = () => {
  const cls = [[['2112', 300000], ['2212', 700000], 'Store, Retail'], [['2115', 900000], ['2215', 4000000], 'Hotel - Limited Service'], [['1112', 100000], ['1212', 300000], '2 Story'], [['2120', 300000], ['2220', 700000], 'Office Building']];
  return GTS_ADDRESSES.slice(0, 4).map((a, i) => { const p = parseAddress(a); const [name, type] = p.street.split(' '); return parcel({ num: Number(p.numbers[0]), name, type: streetKey(type).tokens[0], city: p.city, zip: p.zip, codes: [cls[i][0], cls[i][1]], uses: [cls[i][2]] }); });
};
const site = (arcgis) => { const gts = jeffersonSite(); return { gts, fetchImpl: (url, init) => (new URL(url).host === 'gisportal.jeffco.us' ? arcgis.fetchImpl(url, init) : gts.fetchImpl(url, init)) }; };

test('the weekly job: after reading Jefferson, the run looks up each new filing\'s parcel before the index; the result holds counts only', async () => {
  const { fakePostgrest } = await import('./postgrest-fake.mjs');
  const { platformClient } = await import('../src/platform/client.mjs');
  const { watchCounties } = await import('../src/platform/worker.mjs');
  const fake = fakePostgrest();
  fake.docs.set('sources/fdic/institutions.json', { path: 'sources/fdic/institutions.json', kind: 'json', body: INSTITUTIONS, text: null, version: 1 });
  const client = platformClient({ url: 'https://example-project.supabase.test', key: 'service', fetchImpl: fake.fetchImpl });
  const c = config().counties;
  const rules = { config: { ...config(), counties: { ...c, watch: [], sources: { jefferson: { enabled: true }, douglas: { enabled: false, waitingOn: 'paused for this test.' }, 'tx-caldwell-notices-of-sale': { enabled: false, waitingOn: 'paused for this test.' } } } } };
  const arcgis = fakeArcgis({ parcels: PARCELS_FOR_GTS() });
  const s = site(arcgis);
  const T1 = new Date('2026-11-18T12:00:00Z');
  const out = await watchCounties({ client, rules, deps: { fetchImpl: s.fetchImpl, now: () => T1, sleep: async () => {}, pdfToText: layoutOf }, registry: { jefferson } });
  assert.deepEqual(out.map((x) => [x.source, x.outcome]), [['jefferson', 'ok']], JSON.stringify(out));
  const p = out[0].parcels;
  assert.equal(p.outcome, 'ok');
  assert.ok(p.looked === out[0].added && p.matched >= 4 && p.requests >= 2, JSON.stringify(p));
  assert.ok(arcgis.calls.length >= 2 && s.gts.calls.length > 0);
  assert.ok(fake.docs.has('loans/parcels/jefferson.json'), 'stored in the same unit of work');
  // The leads: the filings on the retail store, the hotel and the office; those on the house are out, and the rest are not confirmed.
  const stored = Object.values(fake.docs.get('loans/parcels/jefferson.json').body.matches);
  assert.ok(stored.some((m) => m.sector === 'hospitality') && stored.some((m) => m.kind === 'residential'));
  assert.equal(out[0].inScope, stored.filter((m) => m.kind === 'commercial').length);
  assert.ok(out[0].inScope >= 3);
  assert.doesNotMatch(JSON.stringify(out), /Example Way|Invented Road|Example Avenue|Sample Boulevard|Zephyrine|Quillon/, 'counts only');
});

test('a parcel lookup that fails never fails the county run: the run is ok, the failure counted, and those filings are looked up next time', async () => {
  const dir = makeDir();
  put(dir, 'sources/fdic/institutions.json', INSTITUTIONS);
  const run = (arcgis, now) => {
    const s = site(arcgis);
    return runNoticeSource({ dir, source: jefferson, counties: { ...counties(), sources: { ...counties().sources, jefferson: { enabled: true } } }, fetchImpl: s.fetchImpl, sleep: async () => {}, now, clock: () => now, pdfToText: layoutOf,
      parcels: (args) => lookupParcels({ ...args, counties: counties(), fetchImpl: s.fetchImpl, sleep: async () => {} }) });
  };
  const down = fakeArcgis({ fail: 503 });
  const r1 = await run(down, new Date('2026-11-18T12:00:00Z'));
  assert.deepEqual([r1.outcome, r1.parcels.outcome, r1.parcels.failed > 0, r1.inScope], ['ok', 'failed', true, 0], JSON.stringify(r1.parcels));
  // Nothing that needed the layer is stored: only a filing with no street address, decided without a request.
  assert.ok(Object.values(readJson(loansPaths(dir).parcels('jefferson'), { matches: {} }).matches).every((m) => m.status === 'no-address'), 'nothing looked up is stored');
  assert.ok(readUnconfirmed(dir).entries.every((e) => ['none', 'no-address'].includes(e.reason)), 'not looked up yet: not leads');
  // The next run, with the layer back: no new filing, but the ones not looked up are.
  const up = fakeArcgis({ parcels: PARCELS_FOR_GTS() });
  const r2 = await run(up, new Date('2026-11-18T18:00:00Z'));
  assert.deepEqual([r2.outcome, r2.added, r2.parcels.outcome, r2.parcels.looked > 0], ['ok', 0, 'ok', true]);
  assert.equal(r2.inScope, Object.values(readJson(loansPaths(dir).parcels('jefferson')).matches).filter((m) => m.kind === 'commercial').length);
  assert.ok(r2.inScope >= 3);
});

// ---- The rebuild, with no network ------------------------------------------------------------------------------------------------
test('the rebuild reads the stored parcel matches and never the network', async () => {
  const dir = world([ned('J2601201', '4417 Sample Street, Anytown, CO 80000', 'Conventional'), ned('J2601202', '4419 Sample Street, Anytown, CO 80000', 'Commercial')]);
  await looker(fakeArcgis({ parcels: [parcel({ num: 4417, name: 'SAMPLE', type: 'ST', codes: [['1125', 500000], ['1225', 3000000]], units: 24 }), parcel({ num: 4419, name: 'SAMPLE', type: 'ST' })] })).run(dir);
  const real = globalThis.fetch;
  let asked = 0;
  globalThis.fetch = async () => { asked++; throw new Error('no network in a rebuild'); };
  try {
    const r = rebuildLoanIndex({ dir, now: new Date('2026-11-18T15:00:00Z') });
    const links = buildCmbsLinks({ dir, now: new Date('2026-11-18T15:00:00Z') });
    assert.deepEqual([r.inScope, r.outOfScopeWhy, r.parcels.leadsBySector, links.outOfScope], [1, { 'residential-parcel': 1 }, { multifamily: 1 }, 1]);
  } finally { globalThis.fetch = real; }
  assert.equal(asked, 0);
  assert.deepEqual(loanEvents({ dir }).map((e) => [e.documentId, e.sector]), [['jefferson:J2601201/NED', 'multifamily']]);
  // The command line: the same, and `loans parcels` with every filing looked up asks nothing and prints counts and ids only.
  const env = { ...process.env, OUTBOUND_DATA_DIR: dir, HTTPS_PROXY: 'http://127.0.0.1:9', https_proxy: 'http://127.0.0.1:9', NODE_USE_ENV_PROXY: '1' };
  const out = execFileSync(process.execPath, [join(REPO, 'cli.mjs'), 'loans', 'rebuild'], { env, encoding: 'utf8' });
  assert.match(out, /1 lead\(s\), 1 not leads \(1 a home by the county's parcel record\)/);
  const parcels = execFileSync(process.execPath, [join(REPO, 'cli.mjs'), 'loans', 'parcels', '--source', 'jefferson'], { env, encoding: 'utf8' });
  assert.match(parcels, /jefferson: looked up 0 document\(s\) now in 0 request\(s\), outcome ok\./);
  assert.match(parcels, /matched: 2 \(street exact 2, by core words 0; by ZIP code 2/);
  assert.match(parcels, /leads: 1 by the loan type alone \(the rule before the parcel record\); 1 by the parcel record \(1 moved in, 1 moved out\)/);
  assert.match(parcels, /Property type: Jefferson County Assessor parcel data \(CC BY 4\.0\)\./);
  assert.doesNotMatch(parcels, /Sample Street|SAMPLE ST|Sample Holdings/);
  const none = execFileSync(process.execPath, [join(REPO, 'cli.mjs'), 'loans', 'parcels', '--source', 'douglas'], { env, encoding: 'utf8' });
  assert.match(none, /^douglas: no parcel source for this county yet/);
});

// ---- The triage: buy-box sectors first among the county lines ---------------------------------------------------------------------
test('the triage: county lines name the property, buy-box sectors first (within a bank and across banks), other commercial still shown, attributed once', async () => {
  const bank = (holder) => [party('holder', holder), party('grantor', 'Sample Holdings LLC')];
  const dir = world([
    ned('J2601301', '101 Sample Street, Anytown, CO 80000', 'Commercial', { parties: bank('Example Bank, N.A.'), recorded: '2026-11-14' }),          // office
    ned('J2601302', '102 Sample Street, Anytown, CO 80000', 'Commercial', { parties: bank('Example Bank, N.A.'), recorded: '2026-11-10' }),          // hotel
    ned('J2601303', '103 Sample Street, Anytown, CO 80000', 'Commercial', { parties: bank('Sample Community Bank'), recorded: '2026-11-15' }),       // commercial land
    ned('J2601304', '104 Sample Street, Anytown, CO 80000', 'Commercial', { parties: bank('Example Mountain Bank'), recorded: '2026-11-11' }),       // retail
  ]);
  const at = (num, codes, uses = []) => parcel({ num, name: 'SAMPLE', type: 'ST', codes, uses });
  await looker(fakeArcgis({ parcels: [at(101, [['2120', 1], ['2220', 9]], ['Office Building']), at(102, [['2115', 1], ['2215', 9]], ['Motel']), at(103, [['0200', 9]]), at(104, [['2112', 1], ['2212', 9]], ['Store, Retail'])] })).run(dir);
  buildLoanIndex({ dir, now: new Date(AT), runId: 'r1' });
  const t = runTriage({ dir, rules: loadJson('triage.json'), now: new Date('2026-11-16T14:00:00Z'), metros: loadJson('metros.json'), scoring: loadJson('scoring.json'), buybox: loadJson('buybox.json') });
  const county = t.watch.filter((i) => i.findings.some((f) => f.type === 'county-document'));
  // Across banks: the two with a buy-box lead (newest first), then the one whose only line is commercial land, though it is newest.
  assert.deepEqual(county.map((i) => i.key), ['fdic:9001', 'fdic:9005', 'fdic:9002']);
  // Within a bank: the hotel before the office, though the office is newer.
  assert.deepEqual(county[0].findings.map((f) => f.sector), ['hospitality', 'office']);
  assert.match(county[0].reason, /for a loan this bank holds on a hotel in Jefferson County, CO; property type confirmed from the county's parcel record\.$/);
  assert.match(county[2].reason, /on commercial land in Jefferson County, CO; property type confirmed/);
  assert.deepEqual(t.attributions, [ATTRIBUTION]);
  const md = readFileSync(join(dir, 'triage', '2026-11-16.md'), 'utf8');
  assert.match(md, /^Property type: Jefferson County Assessor parcel data \(CC BY 4\.0\)\.$/m);
  // Without the buy box the order is the date's alone, as before.
  const plain = runTriage({ dir: world([]), rules: loadJson('triage.json'), now: new Date('2026-11-16T14:00:00Z'), metros: loadJson('metros.json'), scoring: loadJson('scoring.json') });
  assert.deepEqual(plain.watch, []);
});

// ---- The load lists -------------------------------------------------------------------------------------------------------------
const covers = (prefix, rel) => prefix === '' || rel === prefix || (prefix.endsWith('/') && rel.startsWith(prefix));
test('load lists: the watcher\'s and the CMBS link\'s include the parcel matches; no model-facing action, scoring or the triage loads them', async () => {
  const P = ['loans/parcels/jefferson.json', 'loans/unconfirmed.json'];
  for (const p of P) assert.ok(LOADS.loans.some((x) => covers(x, p)), `LOADS.loans covers ${p}`);
  assert.ok(LOADS.cmbs.some((x) => covers(x, P[0])), 'the CMBS link applies the same scope, so it loads the parcel matches');
  const modelFacing = { research: LOADS.research, draft: LOADS.draft, approve: LOADS.approve, callDesk: LOADS.callDesk, callDeskNarrowed: callDeskLoads('acme-bank'), score: LOADS.score, triage: LOADS.triage,
    ...Object.fromEntries(['callPrep', 'callNotes', 'callExtract', 'callConfirm'].flatMap((k) => [[k, LOADS[k]], [`${k}Narrowed`, callLoads(k, 'acme-bank')]])) };
  for (const [kind, list] of Object.entries(modelFacing)) for (const p of P) assert.ok(!list.some((x) => covers(x, p)), `${kind} covers ${p}`);
  // Inside scoring's own unit of work, the parcel file cannot be read.
  const dir = world([ned('J2601401', '4417 Sample Street, Anytown, CO 80000')]);
  await looker(fakeArcgis({ parcels: [parcel({ num: 4417, name: 'SAMPLE', type: 'ST' })] })).run(dir);
  const snap = snapshotFromDir(dir);
  assert.ok(snap.docs['loans/parcels/jefferson.json']);
  await withUnitOfWork({ load: async () => snap, flush: async () => {} }, LOADS.score, async (root) => {
    assert.throws(() => readJson(join(root, 'loans/parcels/jefferson.json')), /was not loaded/);
  });
  // The registry: only Jefferson has a parcel source; its host and licence are named.
  assert.deepEqual(Object.keys(PARCEL_SOURCES), ['jefferson']);
  assert.deepEqual([jeffersonParcels.host, jeffersonParcels.maxClauses, jeffersonParcels.minIntervalMs, jeffersonParcels.licence.url], ['gisportal.jeffco.us', 40, 1500, 'https://creativecommons.org/licenses/by/4.0/']);
});

test('the guard decides from the stored facts alone: a lead only with a confirmed commercial property; a scope written before the parcel rule is not one', () => {
  const d = (property) => decideScope({ commercial: true, borrowers: 'entity', property }).inScope;
  assert.deepEqual([d({ status: 'matched', kind: 'commercial', sector: 'retail' }), d({ status: 'matched', kind: 'land', landUse: 'commercial' }), d({ status: 'matched', kind: 'land', landUse: 'industrial' })], [true, true, true]);
  assert.deepEqual([d({ status: 'matched', kind: 'residential' }), d({ status: 'matched', kind: 'land', landUse: 'residential' }), d({ status: 'matched', kind: 'land', landUse: 'other' }),
    d({ status: 'matched', kind: 'exempt' }), d({ status: 'matched', kind: 'units-unknown' }), d({ status: 'unmatched' }), d({ status: 'ambiguous' }), d({ status: 'no-source' }), d(undefined)],
  [false, false, false, false, false, false, false, false, false]);
  assert.equal(scopeShown({ scope: { commercial: true, borrowers: null } }), false, 'written before the parcel rule');
  // decideMatch is pure: a parcel list with no number of the filing's is unmatched.
  assert.equal(decideMatch(parseAddress('1 Sample Street, Anytown, CO 80000'), [], { classify: classifyColorado }).status, 'unmatched');
});
