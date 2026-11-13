// Checks on the committed files themselves: the claims match the site, the config is coherent, and no prospect data is tracked in git.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadRules } from '../src/rules.mjs';
import { REPO } from './kit.mjs';

const rules = loadRules();
const flat = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#39;|&apos;/g, ' ').replace(/\s+/g, ' ').toLowerCase();
const strip = (s) => s.replace(/[.\s]+$/, '').replace(/\s+/g, ' ').toLowerCase();

test('every approved claim is a sentence that appears word for word on the page it cites', () => {
  for (const c of rules.claims.filter((x) => x.approved)) {
    assert.ok(c.source, `${c.id} has no source`);
    const page = flat(readFileSync(join(REPO, 'site-snapshot', c.source), 'utf8'));
    assert.ok(page.includes(strip(c.text)), `Claim "${c.id}" no longer matches ${c.source}. The website changed (or the snapshot is stale): run npm run sync-site, then update the claim or re-approve it.\n  claim: ${c.text}`);
  }
});

test('claims that are not approved say so, have no source, and are never usable', () => {
  for (const c of rules.claims.filter((x) => !x.approved)) assert.equal(c.source, '', `${c.id} is unapproved but cites a source`);
  const ids = rules.claims.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate claim ids');
  for (const a of Object.values(rules.config.requiredClaims)) for (const list of Object.values(a)) for (const id of list) assert.ok(rules.claims.find((c) => c.id === id && c.approved), `required claim ${id} is not approved`);
});

test('every link target exists on the site', () => {
  for (const [aud, paths] of Object.entries(rules.config.linkTargets)) for (const p of paths) assert.ok(rules.pages.has(p), `${aud}: ${p} is not a page on the site`);
});

test('the sequence is coherent: steps count up from 1, every channel is allowed, none is banned', () => {
  const seq = rules.config.sequence;
  seq.forEach((s, i) => { assert.equal(s.step, i + 1); assert.ok(rules.config.channels.allowed.includes(s.channel)); assert.ok(!rules.config.channels.banned[s.channel]); });
  assert.equal(seq[0].afterDays, 0);
  for (const ch of rules.config.channels.allowed) assert.ok(rules.config.senderRequired[ch], `no sender requirements for ${ch}`);
  for (const banned of ['ai_voice', 'ringless_voicemail', 'sms']) assert.ok(rules.config.channels.banned[banned], `${banned} must stay banned`);
});

test('playbooks: unique question ids, known kinds, every type has a person question and a risk screen, and every account type has terminology', () => {
  const { types, kinds } = rules.playbooks;
  for (const [type, pb] of Object.entries(types)) {
    const ids = pb.questions.map((q) => q.id);
    assert.equal(new Set(ids).size, ids.length, `${type}: duplicate ids`);
    pb.questions.forEach((q) => { assert.ok(q.id.startsWith(`${type}.`), q.id); assert.ok(['government', 'regulator', 'company', 'press'].includes(q.standard)); assert.ok(q.where.length, q.id); });
    assert.ok(pb.questions.some((q) => q.required && /people|identity|record/.test(q.id)), `${type}: no required identity or people question`);
    assert.ok(type === 'bank' || rules.terminology.audiences[type], `${type}: no terminology entry`);
  }
  for (const k of ['asset', 'risk', 'person', 'regulatory']) assert.ok(kinds.includes(k));
});

test('every regular expression in the rule files compiles', () => {
  const t = rules.terminology;
  for (const p of [...t.banned, ...t.cliches, ...t.observational, ...t.brokerPhrases, ...t.bluntAsks, ...t.claimPhrases.map((c) => c.pattern), ...Object.values(t.audiences).flatMap((a) => a.avoid.map((x) => x.pattern)), ...rules.bankAvoid.map((x) => x.pattern)]) assert.doesNotThrow(() => new RegExp(p, 'i'), p);
});

test('every configured model has a price, so cost is always reported', () => {
  const m = rules.models;
  for (const k of ['research', 'structure', 'audit', 'draft']) assert.ok(m.prices[m[k].model], `${k}: no price for ${m[k].model}`);
});

test('DATA RULE: no prospect data file is tracked in git in this repository', () => {
  let files;
  try { files = execFileSync('git', ['ls-files'], { cwd: REPO, encoding: 'utf8' }).split('\n').filter(Boolean); } catch { return; }   // no git: skip
  // `sources/` is anchored to the root because src/sources/ is code; the data folder's sources/ would sit at the root of a misplaced data dir.
  // The data-folder names are checked for data formats only: web/app/accounts/page.jsx is a route, not an account.
  const dataFormat = (f) => /(\.(json|jsonl|md|txt)|\/[^/.]+)$/.test(f);
  const bad = files.filter((f) => /(^|\/)(suppression\.json|touches\.jsonl|audit\.jsonl|senders\.json|runs\.jsonl|changes\.jsonl|KILL|\.env)$/.test(f)
    || (dataFormat(f) && /(^|\/)(accounts|research|briefs|drafts|facts|data|candidates|pilot)\//.test(f))
    || /^sources\//.test(f));
  // Database dumps and spreadsheet exports are how prospect data most often leaks. Invented test fixtures may use them under test/fixtures/.
  // Schema SQL is allowed in supabase/migrations/ and test/sql/; a seed file, or SQL anywhere else, is not.
  const schemaSql = (f) => /^supabase\/migrations\/[^/]+\.sql$/.test(f) || /^test\/sql\/[^/]+\.sql$/.test(f);
  bad.push(...files.filter((f) => /\.(sql|csv|tsv|xlsx|dump)$/i.test(f) && !f.startsWith('test/fixtures/') && !schemaSql(f)));
  bad.push(...files.filter((f) => /(^|\/)seed[^/]*\.sql$/i.test(f)));
  // Migrations hold structure only: no email address (a principal's or a prospect's) may appear in them.
  for (const f of files.filter((x) => x.startsWith('supabase/'))) if (/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(readFileSync(join(REPO, f), 'utf8'))) bad.push(`${f} (contains an email address)`);
  assert.deepEqual(bad, [], 'prospect data must never be committed; it lives in OUTBOUND_DATA_DIR outside the repo');
});

test('preferred terms exist for the audiences that have researched vocabulary, and match the terminology guide', () => {
  assert.ok(rules.terminology.prefer.bank.includes('loan sale'));
  assert.ok(rules.terminology.prefer.servicer.includes('note sale'));
  const guide = readFileSync(join(REPO, 'site-snapshot', 'docs/terminology.md'), 'utf8').toLowerCase();
  for (const w of rules.terminology.prefer.bank) assert.ok(guide.includes(w.toLowerCase()), `"${w}" is not in the website's docs/terminology.md (snapshot)`);
});
