// The source registry, sources.json (docs/data-sources.md section 4; the county watcher recon, docs/county-watchers-recon.md): every
// source carries its dated robots.txt and terms checks and a verdict under the watcher rule (docs/county-data-build-vs-buy.md 3.4), and
// only an allowed source is enabled. A rule file: no prospect data. No network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadJson, config } from './kit.mjs';
import { COUNTY_SOURCES } from '../src/counties.mjs';

const reg = loadJson('sources.json');
const VERDICTS = ['allowed', 'not_allowed', 'unclear'];
const WHERE = ['list', 'document', 'absent', 'not_seen'];
const FIELDS = ['lender', 'trusteeOrAttorney', 'borrower', 'propertyAddress', 'apn', 'amount', 'recordingRef', 'saleDate', 'documentDate'];
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

test('sources.json: unique ids, a known verdict and channel, and a place for every notice field', () => {
  assert.ok(Array.isArray(reg.sources) && reg.sources.length > 0);
  const ids = reg.sources.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate source ids');
  for (const s of reg.sources) {
    assert.match(s.id, /^[a-z0-9-]+$/, s.id);
    assert.ok(VERDICTS.includes(s.verdict), `${s.id}: verdict ${s.verdict}`);
    assert.ok(['a', 'b', 'c'].includes(s.channel), `${s.id}: channel is a, b or c (3.4)`);
    assert.ok(Array.isArray(s.hosts) && s.hosts.length, `${s.id}: hosts`);
    assert.equal(typeof s.enabled, 'boolean', `${s.id}: enabled`);
    assert.ok(s.verdictBasis, `${s.id}: verdictBasis`);
    for (const f of FIELDS) assert.ok(WHERE.includes(s.fields?.[f]), `${s.id}: fields.${f}`);
  }
});

test('sources.json: every robots.txt check is dated; a terms check is dated whenever terms were read', () => {
  for (const s of reg.sources) {
    assert.ok(isDate(s.robots?.checkedOn), `${s.id}: robots.checkedOn is YYYY-MM-DD`);
    assert.ok(s.robots.url?.endsWith('/robots.txt'), `${s.id}: robots.url`);
    if (s.terms?.quote) assert.ok(isDate(s.terms.checkedOn) && s.terms.url, `${s.id}: quoted terms need their URL and date`);
  }
});

test('sources.json: only an allowed source is enabled, and only after robots.txt allows us and its terms were read', () => {
  for (const s of reg.sources) {
    if (s.verdict !== 'allowed') { assert.equal(s.enabled, false, `${s.id}: ${s.verdict} must not be enabled`); continue; }
    assert.equal(s.robots.allowsUs, true, `${s.id}: allowed but robots.txt not shown to allow us`);
    assert.ok(isDate(s.terms?.checkedOn), `${s.id}: allowed without a dated terms check`);
    assert.deepEqual(s.hostsNotReachableHere ?? [], [], `${s.id}: allowed while a host was never read`);
  }
});

test('sources.json: a source with an adapter names one that is registered, for its county, and stays not enabled until a principal decides', () => {
  const withAdapter = reg.sources.filter((s) => s.adapter);
  assert.deepEqual(withAdapter.map((s) => [s.id, s.adapter]), [['co-jefferson-ned-report', 'jefferson'], ['co-jefferson-presale-list', 'jefferson'], ['co-douglas-presale-list', 'douglas']]);
  for (const s of withAdapter) {
    const a = COUNTY_SOURCES[s.adapter];
    assert.ok(a && !a.example, `${s.id}: adapter ${s.adapter} is registered in src/counties.mjs`);
    assert.deepEqual([a.county.fips, a.state, a.channel], [s.countyFips, s.state, s.channel], `${s.id}: the adapter is for this county and channel`);
    for (const h of a.hosts) assert.ok(s.hosts.includes(h), `${s.id}: the adapter reads only the source's hosts (${h})`);
    assert.equal(a.terms.robotsCheckedOn, s.robots.checkedOn, `${s.id}: the adapter carries the dated robots.txt check`);
    assert.equal(a.terms.termsCheckedOn, s.terms.checkedOn, `${s.id}: and the dated terms check`);
    // Not enabled anywhere until the decision is recorded: the registry, the adapter's terms and config.counties.sources agree.
    const decided = s.principalDecision !== null && s.principalDecision !== undefined;
    assert.equal(s.enabled, decided, `${s.id}: enabled only with a principal's decision`);
    assert.equal(a.terms.decision === 'allowed', decided, `${s.id}: the adapter's terms decision matches`);
    assert.equal(config().counties.sources[s.adapter].enabled, decided, `${s.id}: config.counties.sources.${s.adapter} matches`);
    if (!decided) assert.ok(s.waitingOn && a.terms.waitingOn, `${s.id}: says what it waits on`);
  }
});

test('sources.json: a rule file, never prospect data: no email address, and nothing reads as a notice row', () => {
  const text = JSON.stringify(reg);
  assert.doesNotMatch(text, /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, 'no email addresses');
  assert.doesNotMatch(text, /\$\s?\d[\d,]*\.\d{2}/, 'no loan amounts');
});
