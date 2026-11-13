import { requirePrincipal } from '../../lib/session.mjs';
import { loadRules } from '../../lib/engine.mjs';
import { listCandidates } from '../../lib/ops.mjs';
import { period, num } from '../../lib/format.mjs';
import { NotAuthorized, Problem } from '../ui.jsx';

export const metadata = { title: 'Candidates · Valley Capital outbound' };

export default async function Candidates({ searchParams }) {
  const ctx = await requirePrincipal();
  if (ctx.denied) return <NotAuthorized email={ctx.email} />;
  const sp = await searchParams;
  const tier = ['A', 'B', 'all'].includes(sp?.tier) ? sp.tier : '';
  const metro = typeof sp?.metro === 'string' ? sp.metro : '';
  let rows, metros;
  try {
    [rows, { metros }] = await Promise.all([listCandidates(ctx.client, { tier, metro }), loadRules().then((r) => r.metros)]);
  } catch (e) { return <Problem text={`The candidate list could not be loaded: ${e.message}`} />; }
  const label = new Map(metros.map((m) => [m.cbsa, m.label]));
  const asOf = rows.find((r) => r.period)?.period;
  return (
    <>
      <h1>Candidates</h1>
      <p className="sub">Banks scored on distress, fit with the buy box, and timing, from FDIC Call Report data{asOf ? ` as of ${period(asOf)}` : ''}. A principal decides; nothing here contacts anyone.</p>
      {rows.some((r) => r.provisional) ? <div className="banner warn">PROVISIONAL: the buy box still has placeholders, so this ranking is not final.</div> : null}
      <form method="get" className="row panel">
        <label>Tier
          <select name="tier" defaultValue={tier}>
            <option value="">A and B</option><option value="A">A only</option><option value="B">B only</option><option value="all">All, including untiered</option>
          </select>
        </label>
        <label>Metro
          <select name="metro" defaultValue={metro}>
            <option value="">All six</option>
            {metros.map((m) => <option key={m.cbsa} value={m.cbsa}>{m.label}</option>)}
          </select>
        </label>
        <button type="submit">Filter</button>
      </form>
      {!rows.length ? <p className="muted">No candidates match. If this is a new platform, queue an FDIC pull and a scoring run on the Status page.</p> : (
        <div className="scroll">
          <table>
            <thead><tr><th>Tier</th><th className="num">Score</th><th className="num" title="Distress, fit and timing points">D / F / T</th><th>Bank</th><th>Metros</th><th>Why now</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td><span className={`tier ${r.tier ?? ''}`}>{r.tier ?? '–'}</span>{r.status === 'returned' ? <span className="pill" title="Dismissed earlier; a new signal has fired since">back</span> : null}</td>
                  <td className="num">{num(r.score, 1)}</td>
                  <td className="num" title="Score points by axis, computed in code from scoring.json">{num(r.distress, 0)} / {num(r.fit, 0)} / {num(r.timing, 0)}</td>
                  <td><a href={`/candidates/${encodeURIComponent(r.key)}`}>{r.name}</a><span className="src">{r.key}</span></td>
                  <td className="small">{(r.metros ?? []).map((c) => label.get(c) ?? c).join(', ')}</td>
                  <td className="small">{r.filtered ? <span className="muted">Fails a hard filter</span> : r.card}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
