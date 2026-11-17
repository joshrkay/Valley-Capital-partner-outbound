// The shell (docs/design-redesign.md, 4.1 and 5.1): the navigation's page list, the current-page rule, the launcher's search, the theme
// switch, the glossary, and the rules every page keeps: server components by default, no runtime third-party request, no send button.
// Pure modules and page sources only; no network, no browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NAV, PRIMARY, MORE, currentHref, inMore, launcherGroups, themeOf, nextTheme, THEMES } from '../lib/nav.mjs';
import { GLOSSARY, glossaryEntry, glossaryHref } from '../lib/glossary.mjs';
import { priorityOf } from '../lib/candidates-view.mjs';
import { basisLabel, tierName, fieldCodes, STAGES } from '../lib/paper-view.mjs';

const WEB = fileURLToPath(new URL('..', import.meta.url));
const files = (dir) => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? files(p) : [p]; });
const APP = files(join(WEB, 'app')).filter((f) => /\.(jsx|js)$/.test(f));
const src = (f) => readFileSync(f, 'utf8');

test('four primary items, then "More" with Market and Setup and checks, every page reachable once', () => {
  assert.deepEqual(PRIMARY.map((i) => i.label), ['This week', 'Banks', 'Outreach', 'Approvals']);
  assert.deepEqual(MORE.map((g) => g.group), ['Market', 'Setup and checks']);
  assert.deepEqual(MORE[0].items.map((i) => i.label), ['Who sells to whom', 'Advisors and servicers', 'Market by quarter', 'Our network']);
  assert.deepEqual(MORE[1].items.map((i) => i.label), ['System status', 'Senders', 'Score check', 'Briefer pilot']);
  const hrefs = NAV.flatMap((g) => g.items.map((i) => i.href));
  assert.equal(new Set(hrefs).size, hrefs.length);
  for (const h of hrefs) assert.ok(APP.some((f) => f.endsWith(join('app', h.slice(1), 'page.jsx'))), `${h} has a page`);
});

test('the current page: its own path, a record under it, or the page it stands for; home is This week', () => {
  assert.equal(currentHref('/'), '/triage');
  assert.equal(currentHref('/triage?date=2026-11-09'), '/triage');
  assert.equal(currentHref('/candidates/fdic%3A1'), '/candidates');
  assert.equal(currentHref('/accounts/alpha-bank/call'), '/accounts');
  assert.equal(currentHref('/servicers/Example%20Servicer'), '/intermediaries');
  assert.equal(currentHref('/candidatesx'), null, 'a prefix is not a match');
  assert.equal(currentHref('/glossary'), null);
  assert.equal(inMore('/status'), true);
  assert.equal(inMore('/drafts'), false);
});

test('the launcher lists every page, the servicers and the glossary too, and filters by name or purpose', () => {
  const all = launcherGroups('').flatMap((g) => g.items.map((i) => i.href));
  for (const h of ['/triage', '/servicers', '/glossary', '/calibration']) assert.ok(all.includes(h), h);
  assert.deepEqual(launcherGroups('score').flatMap((g) => g.items.map((i) => i.label)), ['Score check']);
  assert.deepEqual(launcherGroups('  CMBS ').flatMap((g) => g.items.map((i) => i.href)), ['/intermediaries', '/servicers']);
  assert.deepEqual(launcherGroups('nothing like this'), []);
});

test('the theme switch cycles automatic, light, dark, and ignores anything else in the cookie', () => {
  assert.deepEqual(THEMES, ['auto', 'light', 'dark']);
  assert.deepEqual([nextTheme(undefined), nextTheme('light'), nextTheme('dark'), nextTheme('purple')], ['light', 'dark', 'auto', 'light']);
  assert.equal(themeOf('"><script>'), 'auto');
});

test('the glossary: unique ids, every old term from the design doc, and every term a page links to exists', () => {
  const ids = GLOSSARY.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const e of GLOSSARY) { assert.match(e.id, /^[a-z0-9-]+$/); assert.ok(e.term && e.meaning.endsWith('.'), e.id); }
  const was = GLOSSARY.map((e) => e.was).join(' | ');
  for (const old of ['Candidates', 'Tier A', 'Tier B', 'Distress', 'Nonfarm nonresidential', 'Multifamily', 'Noncurrent', 'OREO', 'Nonaccrual', 'Inferred tier', 'Observed tier', 'Calibration', 'Suppressed', 'Kill switch', 'Promote to an account', 'Dismiss', 'Q7']) assert.ok(was.includes(old), old);
  assert.equal(glossaryEntry('oreo').term, 'Foreclosed property');
  assert.equal(glossaryHref('serious'), '/glossary#serious');
  assert.equal(glossaryHref('no-such-term'), '/glossary');
  const used = APP.flatMap((f) => [...src(f).matchAll(/<Term id="([^"]+)"/g)].map((m) => m[1]));
  for (const id of used) assert.ok(glossaryEntry(id), `a page links to the glossary entry "${id}", which does not exist`);
});

test('plain words for priority, a figure\'s basis and the loan stages', () => {
  assert.deepEqual([priorityOf({ tier: 'A' }).label, priorityOf({ tier: 'B' }).letter, priorityOf({ tier: null }).label], ['Call first', 'B', 'Not ranked']);
  assert.equal(priorityOf({ tier: 'A', filtered: true }).label, 'Excluded');
  assert.equal(priorityOf({ tier: null, filtersFailed: ['failed bank'] }).label, 'Excluded');
  assert.deepEqual([basisLabel('reported'), basisLabel('observed'), basisLabel('inferred bounds'), basisLabel(null)], ['', 'Seen loan by loan', 'Estimate', '']);
  assert.equal(tierName(null), 'Not measured: anywhere from none to all');
  assert.deepEqual(STAGES.map(([, l]) => l), ['30 to 89 days late', '90+ days late', 'Not accruing']);
  assert.equal(fieldCodes({ sources: [{ field: 'P3REMULT', repdte: '20260331' }, { field: 'P9REMULT', repdte: '20260630' }, { field: 'P3REMULT', repdte: '20260630' }] }), 'P3REMULT + P9REMULT · June 30, 2026');
  assert.equal(fieldCodes({}), '');
});

test('server components by default: only the navigation, the launcher, the menus and the call desk\'s stopwatch are client components, and they hold no data', () => {
  const client = APP.filter((f) => /^\s*['"]use client['"]/.test(src(f))).map((f) => f.slice(WEB.length));
  assert.deepEqual(client.sort(), ['app/accounts/[id]/call/prompter.jsx', 'app/launcher.jsx', 'app/nav-links.jsx'].map((f) => join(f)).sort());
  for (const f of client) assert.doesNotMatch(src(join(WEB, f)), /lib\/(ops|session|engine|rest|env)\.mjs|fetch\(|process\.env/, f);
});

test('no runtime third-party request, no send button, and the shell keeps the internal-only rule', () => {
  for (const f of [...APP, join(WEB, 'app/globals.css')]) {
    const s = src(f);
    assert.doesNotMatch(s, /fonts\.googleapis|fonts\.gstatic|next\/font|cdn\.|unpkg|jsdelivr|<script\s+src/i, f);
    assert.doesNotMatch(s, />\s*Send( it| now| email)?\s*</, `${f}: a send button`);
  }
  assert.match(src(join(WEB, 'app/layout.jsx')), /countDrafts/);
  assert.match(src(join(WEB, 'app/ui.jsx')), /export function InternalNotice[\s\S]*PAPER_CONTEXT[\s\S]*CONTEXT_ONLY/);
  assert.match(src(join(WEB, 'app/globals.css')), /body:has\(#codes:checked\) \.code \{ display: block; \}/, 'the codes switch is one CSS rule');
  assert.doesNotMatch(src(join(WEB, 'app/globals.css')), /\[title\]/);
  assert.match(src(join(WEB, 'app/page.jsx')), /redirect\('\/triage'\)/, 'home is This week');
});
