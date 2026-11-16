// OCC enforcement orders (PRD next-five E18-S2, source 4) against a fake www.occ.gov. Invented banks and people only; no network. The
// releases copy the real layout seen on 2026-11-16: a title "OCC Announces Enforcement Actions for <Month> <Year>", a date, and up to
// three sections (banks, individuals, terminations) opened by fixed paragraphs, with docket numbers in several written forms.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { makeDir, put } from './kit.mjs';
import { loadRules } from '../src/rules.mjs';
import { readJson } from '../src/store.mjs';
import { RUNS, CHANGES } from '../src/sources/runlog.mjs';
import { enforcementPaths, enforcementSignals } from '../src/sources/enforcement.mjs';
import { runOccOrders, verifyOccOrders, readRelease, parseRelease, releasePath, validateOccConfig } from '../src/sources/occorders.mjs';
import { INSTITUTIONS } from './enforcement-fake.mjs';

const rules = loadRules();
const NOW = new Date('2026-11-16T12:00:00Z');
const ENF = { ...rules.config.enforcement, occ: { ...rules.config.enforcement.occ, minIntervalMs: 0, backfillYears: 1, maxMisses: 3 } };
const PEOPLE = ['Pat Person', 'Robin Sample'];

const BANKS_INTRO = '<p>The OCC uses enforcement actions against banks to require the board of directors and management to take timely actions to correct the deficient practices or violations identified. Actions taken against banks are:</p>';
const IAP_INTRO = '<p>The OCC uses enforcement actions against an institution-affiliated party (IAP) to deter, encourage correction of, or prevent violations. Enforcement actions against IAPs reinforce the accountability of individuals.</p>';
const TERM_INTRO = '<p>The OCC terminates enforcement actions when a bank has demonstrated compliance with all articles of an enforcement action.</p>';
const page = (title, date, body) => `<!doctype html><html><head><title>${title} | OCC</title></head><body><nav>menu</nav><main><p>${date}</p><h1>${title}</h1><p>Share This Page:</p>
<p>WASHINGTON—The Office of the Comptroller of the Currency (OCC) today released enforcement actions.</p>${body}
<p>To receive alerts for news releases announcing public OCC enforcement actions, subscribe to OCC Email Updates.</p><p>Media Contact</p><p>Pat Person (202) 555-0100</p></main></body></html>`;
const pdf = (d) => `<a href="https://www.occ.gov/static/enforcement-actions/ea${d}.pdf">${d}</a>`;

const R2025_1 = page('OCC Announces Enforcement Actions for December 2025', 'January 15, 2025', `${BANKS_INTRO}
<p>Formal Agreement with Example Coast Bank, National Association , Harbor, California, for unsafe or unsound credit administration practices. (Docket No. ${pdf('AA-WE-2025-10')})</p>`);
const R2026_1 = page('OCC Announces New Chief Counsel', 'January 5, 2026', '<p>Nothing about enforcement.</p>');
const R2026_3 = page('OCC Announces Enforcement Actions for January 2026', 'January 15, 2026', `${IAP_INTRO}
<p>Order of Prohibition against Pat Person, former Teller at a Harbor, California, branch of Example Coast Bank, National Association, Harbor, California, for embezzling. (Docket No. AA-WE-2026-1.)</p>
${TERM_INTRO}
<p>Order Terminating the Formal Agreement with Example Coast Bank, National Association, Harbor, California, dated January 10, 2025 ( AA-WE-2025-10 ). (Docket No. ${pdf('AA-WE-2026-2')})</p>`);
const R2026_4 = page('OCC Announces Enforcement Actions for February 2026', 'February 19, 2026', `${BANKS_INTRO}
<p>Cease and Desist Order and Civil Money Penalty against Example Desert Bank, Mesa Example, Arizona, for deficiencies in its compliance program. The assessed civil money penalty is $1 million. (Docket No. ${pdf('AA-ENF-2026-46')} and AA-ENF-2026-47).</p>
<p>Consent Order against Example Slovenian S&amp;LA of Somewhere, Somewhere, Ohio, for unsafe practices. (Docket No. AA-CE-2026-5)</p>
${IAP_INTRO}
<p>Order of Prohibition against Robin Sample, former Vice President at Example Desert Bank, Mesa Example, Arizona, for falsifying loan files. (Docket No. AA-ENF-2026-48)</p>`);
const BROKEN = page('OCC Announces Enforcement Actions for March 2026', 'March 19, 2026', '<p>A new layout with no recognizable sections.</p><p>Something (Docket No. AA-ENF-2026-60)</p>');

function fakeOcc(files = {}) {
  const calls = [];
  const all = { [releasePath(2025, 1)]: R2025_1, [releasePath(2026, 1)]: R2026_1, [releasePath(2026, 3)]: R2026_3, [releasePath(2026, 4)]: R2026_4, ...files };
  const fetchImpl = async (url) => {
    const u = new URL(url);
    calls.push(u.pathname);
    if (u.pathname === '/robots.txt') return new Response('User-agent: *\nDisallow: /static/css/', { status: 200 });
    if (u.origin !== 'https://www.occ.gov' || !all[u.pathname]) return new Response('not found', { status: 404 });
    return new Response(all[u.pathname], { status: 200, headers: { 'content-type': 'text/html' } });
  };
  return { fetchImpl, calls };
}
// The FDIC writes "N.A." where the OCC writes "National Association": the matcher treats them as one.
const BANKS = { ...INSTITUTIONS, 1005: { ...INSTITUTIONS[1005], NAME: 'Example Coast Bank, N.A.' } };
const world = () => { const dir = makeDir(); put(dir, 'sources/fdic/institutions.json', BANKS); return dir; };
const run = (dir, site = fakeOcc(), over = {}) => runOccOrders({ dir, enforcement: ENF, fetchImpl: site.fetchImpl, now: NOW, clock: () => NOW, sleep: async () => {}, nowMs: () => 0, ...over });
const stored = (dir) => readJson(enforcementPaths(dir).occOrders, {});

test('a release: the month, the date, and its bank actions and terminations; individuals skipped; dockets in every written form', () => {
  const rel = readRelease(R2026_4);
  assert.deepEqual([rel.enforcement, rel.month, rel.released], [true, '2026-02', '2026-02-19']);
  const p = parseRelease(rel, { path: releasePath(2026, 4) });
  assert.deepEqual([p.skippedIndividual, p.unparsed], [1, 0]);
  assert.deepEqual(p.orders.map((o) => [o.key, o.type, o.types, o.parties[0].name, o.parties[0].state, o.linkKind]), [
    ['occ:AA-ENF-2026-46', 'cease_and_desist', ['cease_and_desist', 'civil_money_penalty'], 'Example Desert Bank', 'AZ', 'order'],
    ['occ:AA-CE-2026-5', 'consent_order', ['consent_order'], 'Example Slovenian S&LA of Somewhere', 'OH', 'release']]);
  assert.deepEqual(p.orders[0].dockets, ['AA-ENF-2026-46', 'AA-ENF-2026-47']);
  const t = parseRelease(readRelease(R2026_3), { path: releasePath(2026, 3) });
  assert.deepEqual(t.orders.map((o) => [o.key, o.terminates, o.terminatesType, o.terminatesDated, o.parties[0].name]), [['occ:AA-WE-2026-2:termination', 'occ:AA-WE-2025-10', 'written_agreement', '2025-01-10', 'Example Coast Bank, National Association']]);
  assert.equal(t.skippedIndividual, 1);
  assert.equal(readRelease(R2026_1).enforcement, false);
  const amended = parseRelease(readRelease(page('OCC Announces Enforcement Actions for May 2026', 'May 21, 2026', `${TERM_INTRO}<p>Order Terminating the Amended Consent Order against Example Desert Bank, Mesa Example, Arizona, dated May 1, 2023 (Docket No. AA-ENF-2023-1). (Docket No. AA-ENF-2026-80)</p>`)), { path: 'x' });
  assert.equal(amended.orders[0].terminatesType, 'consent_order', 'an amended order ends as its own type');
  assert.deepEqual(validateOccConfig(rules.config.enforcement.occ), []);
});

test('a run: the release numbers walked past gaps to the end; the termination closes last year\'s order; a past year is not read again', async () => {
  const dir = world();
  const site = fakeOcc();
  const r = await run(dir, site);
  assert.equal(r.outcome, 'ok', JSON.stringify(r));
  assert.deepEqual([r.releasesRead, r.enforcementReleases, r.ordersNew, r.terminationsNew, r.terminationsLinked, r.skippedIndividual], [4, 3, 3, 1, 1, 2]);
  const o = stored(dir);
  assert.equal(o['occ:AA-WE-2025-10'].terminatedOn, '2026-01-15');
  assert.equal(o['occ:AA-ENF-2026-46'].date, '2026-02-19');
  assert.equal(o['occ:AA-ENF-2026-46'].dateBasis, 'release');
  const st = readJson(enforcementPaths(dir).occState);
  assert.deepEqual([st.years[2025].last, st.years[2025].closed, st.years[2026].last, st.years[2026].closed], [1, true, 4, undefined]);
  // The next run: 2025 is closed; 2026 resumes after release 4. A new release 6 (5 is a gap) is found.
  const later = fakeOcc({ [releasePath(2026, 6)]: page('OCC Announces Enforcement Actions for March 2026', 'March 19, 2026', `${TERM_INTRO}<p>Order Terminating the Cease and Desist Order against Example Desert Bank, Mesa Example, Arizona, dated February 1, 2026 (Docket No. AA-ENF-2026-46). (Docket No. AA-ENF-2026-70)</p>`) });
  const again = await run(dir, later);
  assert.equal(again.outcome, 'ok');
  assert.ok(!later.calls.some((c) => c.includes('/2025/')), 'a closed year is not read again');
  assert.equal(later.calls.filter((c) => c.includes('/2026/'))[0], releasePath(2026, 5));
  assert.equal(stored(dir)['occ:AA-ENF-2026-46'].terminatedOn, '2026-03-19');
});

test('no individual\'s name, and no reason text, reaches the store, the state file, the run log or the change log', async () => {
  const dir = world();
  await run(dir);
  const all = [readFileSync(enforcementPaths(dir).occOrders, 'utf8'), readFileSync(enforcementPaths(dir).occState, 'utf8'), readFileSync(RUNS(dir), 'utf8'), existsSync(CHANGES(dir)) ? readFileSync(CHANGES(dir), 'utf8') : ''].join('\n');
  for (const name of PEOPLE) assert.ok(!all.includes(name), `${name} must not be stored`);
  assert.doesNotMatch(all, /embezzl|falsif|credit administration|AA-ENF-2026-48|AA-WE-2026-1"/);
});

test('an enforcement release with nothing readable fails the run and writes nothing', async () => {
  const dir = world();
  const r = await run(dir, fakeOcc({ [releasePath(2026, 5)]: BROKEN }));
  assert.equal(r.outcome, 'failed');
  assert.match(r.errors[0], /yielded no action against a bank, no termination and no action against an individual/);
  assert.ok(!existsSync(enforcementPaths(dir).occOrders));
});

test('signals: OCC orders read "from the OCC"; a terminated order gives no state signal; verify passes and re-reads the latest release', async () => {
  const dir = world();
  await run(dir);
  const s = enforcementSignals({ dir });
  assert.deepEqual(s['fdic:1002'].map((x) => x.label), ['Under a cease-and-desist order from the OCC effective 2026-02-19; no termination is recorded', 'Cease-and-desist order from the OCC, effective 2026-02-19']);
  assert.deepEqual(s['fdic:1005'].map((x) => x.type), ['enforcement_terminated', 'enforcement'], 'terminated: no state signal');
  const v = await verifyOccOrders({ dir, enforcement: ENF, fetchImpl: fakeOcc().fetchImpl, sleep: async () => {}, now: NOW });
  assert.deepEqual(v.checks.map((c) => [c.id, c.ok]), [['occorders.fresh', true], ['occorders.sourced', true], ['occorders.recall', true]], JSON.stringify(v.checks));
  const gone = await verifyOccOrders({ dir, enforcement: ENF, fetchImpl: fakeOcc({ [releasePath(2026, 4)]: R2026_1 }).fetchImpl, sleep: async () => {}, now: NOW });
  assert.equal(gone.checks.find((c) => c.id === 'occorders.recall').ok, false);
});
