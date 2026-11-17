// This week, the home page (docs/design-redesign.md, 5.4): act now as cards (priority, name, the first reason, the could-fit ceiling),
// watch as rows, banks already in conversation kept apart, and the left-out counts, the calendar and system health as one line each with a
// link to Status. Signal and event ids sit in a disclosure. A server component with no data of its own: the page passes the stored triage.
import { SECTIONS, CONVERSATION_INTRO, cardOf, moreFindings, leftOutLine, healthLine } from '../../lib/triage-view.mjs';
import { usd, dateOf } from '../../lib/paper-view.mjs';
import { Icon, Tile } from '../icons.jsx';
import { PageHead, Priority, Chip, Note, InternalNotice, Term } from '../ui.jsx';

function Links({ c }) {
  if (!c.pages.length && !c.external.length) return null;
  return (
    <span className="links">
      {c.pages.map((l) => <a key={l.href} href={l.href}>{l.label}</a>)}
      {c.external.map((l) => <a key={l.href} href={l.href} rel="noopener noreferrer nofollow" target="_blank">{l.label}</a>)}
    </span>
  );
}

function Name({ c }) {
  return c.href ? <a className="bankname" href={c.href}>{c.name}</a> : <span>{c.name}</span>;
}

function Fit({ c }) {
  if (c.ceiling) return <span>Could fit: <strong className="tnum">up to {usd(c.ceiling.high)}</strong>{c.ceiling.tier === 'inferred' ? ', estimate' : ''}</span>;
  if (c.hasCandidate && c.href) return <a href={c.href}>Open the bank</a>;
  return null;
}

function More({ c }) {
  if (!c.more.length) return null;
  return (
    <details className="explain">
      <summary>{c.more.length} more reason{c.more.length === 1 ? '' : 's'}</summary>
      <div><ul>{c.more.map((m, i) => <li key={i}>{m}</li>)}</ul></div>
    </details>
  );
}

export default function WeekView({ t, candidates = new Map(), approvals = null, dates, queue = null }) {
  const [act, watch] = SECTIONS.map(([k, title, intro]) => ({ k, title, intro, cards: (t[k] ?? []).map((i) => cardOf(i, candidates.get(i.key) ?? null)) }));
  const health = healthLine(t);
  const ids = [...(t.actNow ?? []), ...(t.watch ?? []), ...(t.inConversation ?? [])].filter((i) => i.ids?.length);
  return (
    <>
      <InternalNotice paper />
      <div className="page">
        <PageHead icon="home" tone="t-home" eyebrow="Home" title="This week"
          lede={`Weekly triage of ${dates.date}${dates.comparedWith ? `, compared with ${dates.comparedWith}` : ''}. What changed, and which banks to call first.`}
          actions={<><a className="btn" href="/candidates">See all banks</a>{queue}</>} />
        {t.firstRun ? <Note tone="info" role="note"><span>{t.note}</span></Note> : null}
        {t.candidates?.provisional ? <Note tone="warn" role="note"><span><strong>Not final:</strong> the buy box still has placeholders, so the bank list behind this week is not final.</span></Note> : null}
        <div className="home-grid">
          <div className="home-main">
            <section className="card" aria-labelledby="h-act">
              <div className="card-head"><Tile icon="bolt" tone="t-sig" size="sm" /><h2 id="h-act">{act.title} ({act.cards.length})</h2><span className="card-head-r xs">{act.intro}</span></div>
              <div className="card-body">
                {act.cards.length ? (
                  <div className="week-cards">
                    {act.cards.map((c) => (
                      <article key={c.key} className="week-card">
                        <div className="top">{c.ranked ? <Priority tier={c.tier} excluded={c.excluded} /> : null}<Chip kind="new">New this week</Chip></div>
                        <h3><Name c={c} /></h3>
                        <p>{c.reason}</p>
                        <More c={c} />
                        <div className="foot"><span>{c.place || c.dates.map((d) => dateOf(d) || d).join(', ')}</span><Fit c={c} /></div>
                        <Links c={c} />
                      </article>
                    ))}
                  </div>
                ) : <p className="muted">Nothing to act on this week.</p>}
              </div>
            </section>
            <section className="card" aria-labelledby="h-watch">
              <div className="card-head"><Tile icon="bank" tone="t-bank" size="sm" /><h2 id="h-watch">{watch.title} ({watch.cards.length})</h2><span className="card-head-r xs">{watch.intro}</span></div>
              {watch.cards.length ? (
                <ul className="rel-list">
                  {watch.cards.map((c) => (
                    <li key={c.key}>
                      <span className="one-line"><Name c={c} />{c.ranked ? <Priority tier={c.tier} excluded={c.excluded} /> : null}</span>
                      <span className="rel-m">{c.reason}</span>
                      <More c={c} />
                      <Links c={c} />
                    </li>
                  ))}
                </ul>
              ) : <p className="card-body muted">Nothing else changed this week.</p>}
              <div className="card-foot"><a href="/candidates">View all banks</a></div>
            </section>
          </div>
          <aside className="home-side" aria-label="Related">
            <section className="card" aria-labelledby="h-appr">
              <div className="card-head"><Tile icon="approve" tone="t-appr" size="sm" /><h2 id="h-appr">Approvals waiting{approvals !== null ? ` (${approvals})` : ''}</h2></div>
              <div className="card-body"><p className="muted">{approvals ? `${approvals} draft${approvals === 1 ? ' is' : 's are'} waiting for a principal.` : 'No draft is waiting.'} Approving checks a draft again; it never sends.</p></div>
              <div className="card-foot"><a href="/drafts">Open Approvals</a></div>
            </section>
            <section className="card" aria-labelledby="h-conv">
              <div className="card-head"><Tile icon="people" tone="t-out" size="sm" /><h2 id="h-conv">Already talking to ({(t.inConversation ?? []).length})</h2></div>
              {(t.inConversation ?? []).length ? (
                <ul className="rel-list">
                  {t.inConversation.map((it) => {
                    const c = cardOf(it, candidates.get(it.key) ?? null);
                    const fresh = moreFindings(it);
                    return (
                      <li key={it.key}>
                        <span><Name c={c} /></span>
                        <span className="rel-m">{it.latestTouch ? `Latest: ${String(it.latestTouch.type ?? '').replace(/_/g, ' ')} on ${dateOf(it.latestTouch.date) || it.latestTouch.date}. ` : ''}{fresh.length ? `New this week: ${fresh.map((f) => f.reason).join(' ')}` : 'Nothing new this week.'}</span>
                      </li>
                    );
                  })}
                </ul>
              ) : <p className="card-body muted">No bank is in conversation.</p>}
              <p className="card-body small muted">{CONVERSATION_INTRO}</p>
              <div className="card-foot"><a href="/accounts">Open Outreach</a></div>
            </section>
            <section className="card" aria-labelledby="h-health">
              <div className="card-head"><Tile icon="setup" tone="t-set" size="sm" /><h2 id="h-health">System health</h2></div>
              <div className="card-body">
                <p className={health.ok ? 'ok-line' : 'bad-line'}><Icon name={health.ok ? 'check' : 'warn'} /> {health.text}</p>
                <p className="muted small">{health.detail}</p>
                <p className="muted small">{t.fdicQuarter?.line}</p>
                <p className="muted small">{leftOutLine(t.counts)}</p>
                {dates.calendar ? <p className="muted small">{dates.calendar}</p> : null}
              </div>
              <div className="card-foot"><a href="/status">System status</a></div>
            </section>
          </aside>
        </div>
        {ids.length ? (
          <details className="card acc">
            <summary><span className="t">Signal and event ids</span><span className="d">For checking a line against its record</span></summary>
            <div className="acc-body"><dl className="kv small">{ids.map((i) => <div key={i.key} className="contents"><dt>{i.name}</dt><dd className="ids">{i.ids.join(', ')}</dd></div>)}</dl></div>
          </details>
        ) : null}
        <p className="small muted">{t.internal} See the <Term id="this-week">glossary</Term> for the words used here.</p>
      </div>
    </>
  );
}
