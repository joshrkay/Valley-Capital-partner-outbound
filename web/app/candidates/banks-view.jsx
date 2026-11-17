// The Banks list (docs/design-redesign.md, 4.1 and 5.2): a CRM-style list view. A list-view picker (Call first, Call first and worth a
// look, All banks, each with its count), a meta line, "Search this list" and filters as GET parameters, and a dense table whose rows
// become cards on a phone. A server component with no data of its own: the page passes the rows and the rule files.
import { moneyThousands, period } from '../../lib/format.mjs';
import { usd } from '../../lib/paper-view.mjs';
import { VIEWS, SORTS, AXES, viewCounts, listRows, listHref, bestCeiling, reasonOf, moreReasons, tierGap, priorityOf } from '../../lib/candidates-view.mjs';
import { Icon, Tile } from '../icons.jsx';
import { Priority, Chip, Term, Note, InternalNotice } from '../ui.jsx';

function ScoreCell({ r, tiers }) {
  const pts = { p: Number(r.distress ?? 0), f: Number(r.fit ?? 0), t: Number(r.timing ?? 0) };
  const near = tierGap(r, tiers);
  const w = (v) => `${Math.max(0, Math.min(100, v)).toFixed(2)}%`;
  return (
    <>
      <div className="score-num">{Number.isFinite(Number(r.score)) && r.score !== null ? Math.round(Number(r.score)) : '–'} <small>of 100</small></div>
      <div className="stack" aria-hidden="true">
        <span className="p" style={{ width: w(pts.p) }} /><span className="f" style={{ width: w(pts.f) }} /><span className="t" style={{ width: w(pts.t) }} />
        {tiers?.B?.score ? <i style={{ left: `${tiers.B.score}%` }} /> : null}
        {tiers?.A?.score ? <i style={{ left: `${tiers.A.score}%` }} /> : null}
      </div>
      <span className="sr">Pressure {pts.p.toFixed(0)}, fit {pts.f.toFixed(0)}, timing {pts.t.toFixed(0)}.</span>
      {near ? <div className="near">{near}</div> : null}
    </>
  );
}

function FitCell({ r, max }) {
  const best = bestCeiling(r.fitCeiling);
  const href = `/candidates/${encodeURIComponent(r.key)}`;
  if (!best) return <a href={`${href}?tab=fit`} className="small">Open the bank</a>;
  const est = best.tier === 'inferred';
  return (
    <>
      <div className="fitval"><span className="upto">up to</span> {usd(best.high)}</div>
      <div className="fitsub">{best.label}{est ? ', estimate' : ''}</div>
      <div className={`minibar${est ? ' est' : ''}`} aria-hidden="true"><span style={{ width: `${max > 0 ? ((best.high / max) * 100).toFixed(1) : 0}%` }} /></div>
    </>
  );
}

function WhyCell({ r }) {
  if (priorityOf(r).id === 'excluded') {
    return <div className="why muted">{r.filtersFailed?.length ? `Excluded: ${r.filtersFailed.join('; ')}.` : 'Excluded by a rule. Open the bank for the reason.'}</div>;
  }
  const reason = reasonOf(r);
  const more = moreReasons(r);
  return (
    <div className="why">
      {reason || <span className="muted">Open the bank for the reasons.</span>}
      {more ? <div className="more">and {more} more reason{more === 1 ? '' : 's'}</div> : null}
      {r.isNew || r.status === 'returned' ? (
        <div className="chips">{r.isNew ? <Chip kind="new">New this week</Chip> : null}{r.status === 'returned' ? <Chip kind="back">Back on the list</Chip> : null}</div>
      ) : null}
    </div>
  );
}

export default function BanksView({ rows, params: p, metros = [], tiers }) {
  const counts = viewCounts(rows);
  const shown = listRows(rows, p);
  const max = Math.max(0, ...rows.map((r) => bestCeiling(r.fitCeiling)?.high ?? 0));
  const asOf = rows.find((r) => r.period)?.period;
  const viewName = VIEWS.find(([k]) => k === p.view)[1];
  const sortName = SORTS.find(([k]) => k === p.sort)[1];
  const metroName = metros.find((m) => m.cbsa === p.metro)?.label;
  const filters = [p.view !== 'all' && 'priority', metroName && `metro (${metroName})`, p.fresh && 'new or back this week', p.q && `"${p.q}"`].filter(Boolean);
  const filtered = Boolean(p.metro || p.fresh || p.q);
  return (
    <>
      <InternalNotice paper />
      <div className="page">
        {rows.some((r) => r.provisional) ? <Note tone="warn" role="note"><span><strong>Not final:</strong> the buy box still has placeholders, so this ranking is not final.</span></Note> : null}
        <div className="card lv">
          <div className="lv-head">
            <div className="lv-title">
              <Tile icon="bank" tone="t-bank" />
              <div className="lv-names">
                <p className="eyebrow">Banks to call</p>
                <details className="menu lv-picker">
                  <summary><h1>{viewName} ({counts[p.view]})</h1><Icon name="down" /><span className="sr">Choose a list view</span></summary>
                  <div className="menu-panel left">
                    <ul className="menu-list">
                      {VIEWS.map(([k, label]) => <li key={k}><a href={listHref(p, { view: k })} aria-current={k === p.view ? 'page' : undefined}>{label} <span className="n">{counts[k]}</span></a></li>)}
                    </ul>
                  </div>
                </details>
              </div>
            </div>
            <div className="btn-group"><a className="btn" href="/glossary#score">How the score works</a><a className="btn" href="/calibration">Score check</a></div>
          </div>
          <div className="lv-bar">
            <div>
              <p className="lv-meta">{shown.length} item{shown.length === 1 ? '' : 's'} · Sorted by {sortName}{filters.length ? ` · Filtered by ${filters.join(', ')}` : ''}{asOf ? ` · FDIC data as of ${period(asOf)}` : ''} · Nothing here contacts anyone</p>
              <p className="lv-meta">Ranked by score: pressure on the bank, fit with what we buy, and timing. A principal decides.</p>
            </div>
            <form className="lv-controls" method="get" action="/candidates">
              {p.view !== 'AB' ? <input type="hidden" name="view" value={p.view} /> : null}
              <span className="lv-search"><Icon name="search" /><label className="sr" htmlFor="f-q">Search this list</label><input type="search" id="f-q" name="q" placeholder="Search this list" defaultValue={p.q} /></span>
              <label className="sr" htmlFor="f-metro">Metro</label>
              <select id="f-metro" name="metro" className="ctl" defaultValue={p.metro}>
                <option value="">All six metros</option>
                {metros.map((m) => <option key={m.cbsa} value={m.cbsa}>{m.label}</option>)}
              </select>
              <label className="sr" htmlFor="f-sort">Sort by</label>
              <select id="f-sort" name="sort" className="ctl" defaultValue={p.sort}>
                {SORTS.map(([k, label]) => <option key={k} value={k}>Sort: {label}</option>)}
              </select>
              <label className="check" htmlFor="f-new"><input type="checkbox" id="f-new" name="fresh" value="1" defaultChecked={p.fresh} /> New or back</label>
              <button type="submit" className="btn">Apply</button>
              {filtered ? <a className="btn quiet" href={listHref({ view: p.view, sort: p.sort })}>Clear</a> : null}
            </form>
          </div>
          <div className="tablebox">
            <table className="dt banks">
              <caption className="sr">Banks ranked by score. Open a bank by its name.</caption>
              <thead>
                <tr>
                  <th className="c-num" scope="col"><span className="sr">Row</span></th>
                  <th scope="col">Bank name</th>
                  <th className="col-prio" scope="col"><Term id="priority">Priority</Term></th>
                  <th scope="col">Why now</th>
                  <th className="col-fit" scope="col"><Term id="could-fit">Could fit our buy box</Term><div className="legend">largest single type, never a sum</div></th>
                  <th className="col-score" scope="col"><Term id="score">Score</Term><div className="legend">{AXES.map((a) => <span key={a.id}><b className={`k-${a.cls}`} />{a.label}</span>)}</div></th>
                </tr>
              </thead>
              <tbody>
                {shown.length ? shown.map((r, i) => (
                  <tr key={r.key}>
                    <td className="c-num">{i + 1}</td>
                    <td className="c-bank">
                      <a className="bankname" href={`/candidates/${encodeURIComponent(r.key)}`}>{r.name}</a>
                      <div className="where">{[[r.city, r.state].filter(Boolean).join(', '), r.assets !== null && r.assets !== undefined ? `${moneyThousands(r.assets)} in assets` : ''].filter(Boolean).join(' · ')}</div>
                    </td>
                    <td className="c-prio"><Priority tier={r.tier} excluded={priorityOf(r).id === 'excluded'} /></td>
                    <td className="c-why"><WhyCell r={r} /></td>
                    <td className="c-fit"><FitCell r={r} max={max} /></td>
                    <td className="c-score"><ScoreCell r={r} tiers={tiers} /></td>
                  </tr>
                )) : (
                  <tr><td colSpan={6}><div className="empty">
                    {rows.length ? <>No banks match these filters. <a className="btn sm" href={listHref({})}>Clear filters</a></> : 'No banks yet. If this is a new platform, queue an FDIC pull and a scoring run on the System status page.'}
                  </div></td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="lv-foot">
            <span>Marks on the score bar: {tiers?.B?.score} points (worth a look) and {tiers?.A?.score} (call first).</span>
            <span>Snoozed, dismissed, promoted and do-not-contact banks stay off this list.</span>
          </div>
        </div>
      </div>
    </>
  );
}
