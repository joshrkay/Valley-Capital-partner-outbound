import { requirePrincipal } from '../../lib/session.mjs';
import { engine } from '../../lib/engine.mjs';
import { latestTriage } from '../../lib/ops.mjs';
import { SECTIONS, CONVERSATION_INTRO, primaryHref, otherPages, externalLinks, moreFindings } from '../../lib/triage-view.mjs';
import { period, when } from '../../lib/format.mjs';
import { NotAuthorized, Problem } from '../ui.jsx';
import { queueTriageAction } from './actions.js';

export const metadata = { title: 'This week · Valley Capital outbound' };

// The weekly triage (PRD E6-S5), rendered from the stored record. Internal: for the firm's principals only, never sent anywhere.
function Name({ item }) {
  const href = primaryHref(item);
  return (
    <>
      {href ? <a href={href}>{item.name}</a> : item.name}
      {item.tier ? <span className={`tier ${item.tier}`}> {item.tier}</span> : null}
      <span className="src">{item.key}</span>
    </>
  );
}

function Links({ item }) {
  const pages = otherPages(item), ext = externalLinks(item);
  if (!pages.length && !ext.length) return null;
  return (
    <span className="small">
      {pages.map((l) => <span key={l.href}><a href={l.href}>{l.label}</a> · </span>)}
      {ext.map((l) => <span key={l.href}><a href={l.href} rel="noopener noreferrer nofollow" target="_blank">{l.label}</a> · </span>)}
    </span>
  );
}

function Why({ item }) {
  const more = moreFindings(item);
  return (
    <>
      {item.reason}
      {more.length ? <ul className="small" style={{ margin: '4px 0 0', paddingLeft: 18 }}>{more.map((f, i) => <li key={i}>{f.reason}</li>)}</ul> : null}
      {(item.notes ?? []).map((n, i) => <span key={i} className="src">{n}</span>)}
      {item.ids?.length ? <span className="src mono" title="Signal and event ids">{item.ids.join(', ')}</span> : null}
    </>
  );
}

function Section({ items, title, intro }) {
  return (
    <>
      <h2>{title} ({items.length})</h2>
      <p className="sub">{intro}</p>
      {!items.length ? <p className="muted">Nothing this window.</p> : (
        <div className="scroll"><table>
          <thead><tr><th>Institution</th><th>Why</th><th>Dates</th><th>Links</th></tr></thead>
          <tbody>{items.map((it) => (
            <tr key={it.key}>
              <td><Name item={it} /></td>
              <td><Why item={it} /></td>
              <td className="small">{(it.dates ?? []).join(', ')}</td>
              <td><Links item={it} /></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </>
  );
}

export default async function ThisWeek({ searchParams }) {
  const ctx = await requirePrincipal();
  if (ctx.denied) return <NotAuthorized email={ctx.email} />;
  const sp = await searchParams;
  const date = typeof sp?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : undefined;
  let t, tri;
  try { [t, tri] = await Promise.all([latestTriage(ctx.client, { date }), engine('src/triage.mjs')]); }
  catch (e) { return <Problem text={`The triage could not be loaded: ${e.message}`} />; }
  const queue = <form action={queueTriageAction} className="inline"><button type="submit" className="secondary">Queue a triage run</button></form>;
  if (!t) {
    return (
      <>
        <h1>This week</h1>
        <p className="sub">The weekly triage: what changed since the last one, across every source. The worker writes it every Monday, after the FDIC check and scoring.</p>
        <p className="muted">No triage yet{date ? ` for ${date}` : ''}.</p>
        {queue}
      </>
    );
  }
  const c = t.counts;
  return (
    <>
      <h1>This week</h1>
      <p className="sub">Weekly triage of {tri.longDate(t.date)} · window {tri.longDate(t.window.fromDate)} to {tri.longDate(t.window.toDate)}{t.comparedWith ? `, since the triage of ${tri.longDate(t.comparedWith.date)}` : ''} · written {when(t.generatedAt)}</p>
      <div className="banner warn" role="note">{t.internal}</div>
      {t.firstRun ? <div className="banner warn">{t.note}</div> : null}
      {t.candidates?.provisional ? <div className="banner warn">PROVISIONAL: the buy box still has placeholders, so the candidate list behind this triage is not final.</div> : null}
      <p>{t.fdicQuarter.line} {t.candidates ? <span className="muted small">Candidate list: scoring run {t.candidates.runId}, data as of {period(t.candidates.latestRepdte)}.</span> : <span className="muted small">No candidate list yet.</span>}</p>

      {SECTIONS.map(([k, title, intro]) => <Section key={k} items={t[k]} title={title} intro={intro} />)}

      <h2>Already in conversation ({t.inConversation.length})</h2>
      <p className="sub">{CONVERSATION_INTRO}</p>
      {!t.inConversation.length ? <p className="muted">No institution is in conversation.</p> : (
        <div className="scroll"><table>
          <thead><tr><th>Institution</th><th>Latest touch</th><th>Conversation</th><th>New this window</th></tr></thead>
          <tbody>{t.inConversation.map((it) => (
            <tr key={it.key}>
              <td><Name item={it} /></td>
              <td className="small">{it.latestTouch?.date ?? '–'}{it.latestTouch?.type ? <span className="src">{it.latestTouch.type.replace('_', ' ')}</span> : null}</td>
              <td className="small">{(it.conversation ?? []).map((e) => `${e.type.replace('_', ' ')} ${e.date}`).join(' · ')}</td>
              <td className="small">{moreFindings(it).length ? <ul style={{ margin: 0, paddingLeft: 18 }}>{moreFindings(it).map((f, i) => <li key={i}>{f.reason}</li>)}</ul> : <span className="muted">nothing new</span>}<Links item={it} /></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}

      <h2>Left out</h2>
      <div className="panel">
        <dl className="kv">
          <dt>Snoozed</dt><dd>{c.snoozed} <span className="muted small">back when the snooze ends</span></dd>
          <dt>Dismissed</dt><dd>{c.dismissed} <span className="muted small">back when a new signal fires after the dismissal</span></dd>
          <dt>Held back this window</dt><dd>{c.heldBack}</dd>
          <dt>Opted out</dt><dd>{c.optedOut} <span className="muted small">({c.optOutsInWindow} in this window; never listed)</span></dd>
          <dt>Suppressed</dt><dd>{c.suppressed} <span className="muted small">never listed</span></dd>
        </dl>
      </div>

      <h2>Calendar</h2>
      <p className="sub">Internal: it decides when a principal looks, never what a message says. The settings are placeholders in triage.json.</p>
      <div className="panel"><ul style={{ margin: 0, paddingLeft: 18 }}>{tri.calendarLines(t.calendar).map((l, i) => <li key={i}>{l}</li>)}</ul></div>

      <h2>System health</h2>
      <div className="panel">
        {c.healthIssues ? <div className="banner error" style={{ marginTop: 0 }}>{c.healthIssues} issue{c.healthIssues === 1 ? '' : 's'}: see below and the Status page.</div> : null}
        <ul style={{ margin: 0, paddingLeft: 18 }}>{tri.healthLines(t.health).map((l, i) => <li key={i} className={l.startsWith('  ') ? 'small mono' : undefined}>{l.trim()}</li>)}</ul>
      </div>
      <div className="row" style={{ marginTop: 16 }}>{queue}</div>
    </>
  );
}
