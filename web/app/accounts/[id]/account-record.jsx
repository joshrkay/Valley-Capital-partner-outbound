// An account's page in Outreach (docs/design-redesign.md, 5.5). It opens with one Next step box over the outreach path; hard stops and
// enforcement orders stay at the top as red notes; then the page's sections: Person and contact, Routes, Touches, Calls, Brief. The
// sections and their forms are the same as before, and run the same server actions. Nothing here sends.
import { period, num } from '../../../lib/format.mjs';
import { OUTREACH_STAGES } from '../../../lib/account-view.mjs';
import { Icon, Tile } from '../../icons.jsx';
import { Priority, Note, InternalNotice, Markdown, Disclosure } from '../../ui.jsx';
import { confirmRoleAction, confirmOrderAction, queueResearchAction, queueDraftAction } from '../actions.js';
import { Calls } from './calls.jsx';
import { Routes } from './routes.jsx';
import { Contact } from './contact.jsx';
import { Touches } from './touches.jsx';

const SECTIONS = [['person', 'Person and contact'], ['routes', 'Routes'], ['touches', 'Touches'], ['calls', 'Calls'], ['brief', 'Brief']];
const SECTOR_WORDS = { multifamily: 'apartments', hospitality: 'hotels', retail: 'retail' };

function NextStep({ next }) {
  const at = OUTREACH_STAGES.findIndex(([id]) => id === next.stage);
  const href = next.href ?? (next.anchor ? `#${next.anchor}` : null);
  return (
    <section className="card pathcard" aria-labelledby="h-next">
      <div className="path-row">
        <ol className="path" aria-label="Outreach stage">
          {OUTREACH_STAGES.map(([id, label], i) => (
            <li key={id} className={i < at ? 'done' : i === at ? (next.stop ? 'parked' : 'cur') : ''} aria-current={i === at ? 'step' : undefined}><span>{i < at ? <Icon name="check" /> : null}{label}</span></li>
          ))}
        </ol>
      </div>
      <div className={`nextbox${next.stop ? ' stop' : ''}`}>
        <h2 id="h-next">{next.stop ? 'Stop first' : 'Next step'}</h2>
        <p>{next.text.replace(/^Stop first: /, '')} {href ? <a href={href}>{next.href ? 'Open' : 'Go there'}</a> : null}</p>
      </div>
    </section>
  );
}

export default function AccountRecord({ client, d, rules, next }) {
  const { account: a, brief, research, gate, drafts, orders = [] } = d;
  const pipe = a.pipeline;
  const unconfirmed = orders.filter((o) => !o.confirmation);
  return (
    <>
      <InternalNotice who={a.name ?? a.id} />
      <div className="page">
        <div className="card hl">
          <div className="hl-top">
            <Tile icon="people" tone="t-out" size="lg" />
            <div className="hl-titles">
              <p className="eyebrow"><a href="/accounts">Outreach</a> › Account</p>
              <div className="title-row"><h1>{a.name ?? a.id}</h1>{a.tier ? <Priority tier={a.tier} /> : null}</div>
              <p className="hl-sub">{[a.type, (a.sectors ?? []).map((s) => SECTOR_WORDS[s] ?? s).join(', '), a.person?.name ? `contact: ${a.person.name}${a.person.title ? `, ${a.person.title}` : ''}` : 'no person named yet'].filter(Boolean).join(' · ')}</p>
              <span className="code">{a.id}</span>
            </div>
            {pipe?.key ? <div className="btn-group"><a className="btn" href={`/candidates/${encodeURIComponent(pipe.key)}`}>Open the bank page</a></div> : null}
          </div>
        </div>

        {orders.length ? (
          <section id="orders" aria-labelledby="h-orders">
            <Note tone={unconfirmed.length ? 'bad' : 'info'} role={unconfirmed.length ? 'alert' : 'note'}>
              <div>
                <h2 id="h-orders">Enforcement orders in force</h2>
                <p>No touch to this bank is approved until a principal has confirmed seeing each order below, once. Read the order first. Never mention it in a message.</p>
                <ul>{orders.map((o) => (
                  <li key={o.id}>{o.type} from the {o.regulator}, {o.date} {o.link ? <a href={o.link} rel="noopener noreferrer nofollow" target="_blank">(the order)</a> : null}{' '}
                    {o.confirmation ? <span>confirmed by {o.confirmation.by}, {String(o.confirmation.at).slice(0, 10)}</span> : (
                      <form action={confirmOrderAction} className="inline"><input type="hidden" name="id" value={a.id} /><input type="hidden" name="order" value={o.id} /><button type="submit">I have read this order</button></form>
                    )}
                  </li>))}</ul>
              </div>
            </Note>
          </section>
        ) : null}

        <NextStep next={next} />

        <nav className="card onpage" aria-label="On this page">
          <span className="muted">On this page:</span>
          {SECTIONS.map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}
        </nav>

        <section id="person" className="sec" aria-labelledby="h-person">
          <h2 id="h-person">Person and contact</h2>
          <div className="grid2">
            <div className="panel">
              <h3>The person</h3>
              <dl className="kv">
                <dt>Name</dt><dd>{a.person?.name || <span className="muted">not named yet</span>}</dd>
                <dt>Title</dt><dd>{a.person?.title || '–'}</dd>
                <dt>Role</dt><dd>{a.contact?.roleConfirmed ? `confirmed by ${a.contact.roleConfirmedBy}` : 'unconfirmed'}</dd>
              </dl>
              <p className="small muted">Name the person under Contact details, below, with where the name came from: usually the brief&apos;s candidate finding.</p>
              {a.person?.name && !a.contact?.roleConfirmed ? (
                <form action={confirmRoleAction} className="inline"><input type="hidden" name="id" value={a.id} /><button type="submit">Confirm role (after reading the sources)</button></form>
              ) : null}
            </div>
            <div className="panel">
              <h3>Research and drafts</h3>
              <p className="small">{research ? `Last research ${research.date} (${research.mode === 'institution' ? 'institution research: no person named' : 'person research'}), ${research.findings} findings, risk screen ${String(research.risk ?? '–').replace(/_/g, ' ')}.` : 'Not researched yet.'}</p>
              {gate.allowed ? (
                <form action={queueResearchAction} className="inline"><input type="hidden" name="id" value={a.id} /><button type="submit">{research ? 'Research again' : 'Queue research'}</button></form>
              ) : <div className="banner warn small">{gate.reason}</div>}
              <form action={queueDraftAction} className="row mt8">
                <input type="hidden" name="id" value={a.id} />
                <label>Channel<select name="channel">{rules.config.channels.allowed.map((c) => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}</select></label>
                <label>Step<input type="number" name="step" min="1" defaultValue={drafts.length + 1} className="narrow" /></label>
                <button className="secondary" type="submit">Queue draft</button>
              </form>
              {drafts.length ? <ul className="small">{drafts.map((x) => <li key={`${x.step}-${x.channel}`}>Step {x.step}, {x.channel.replace('_', ' ')}: {x.status}{x.approvedBy ? ` by ${x.approvedBy}` : ''}{x.channel === 'call' && x.status === 'approved' ? <> · <a href={`/accounts/${encodeURIComponent(a.id)}/call`}>open the call desk</a></> : null}</li>)}</ul> : null}
            </div>
          </div>
          <Contact client={client} id={a.id} />
        </section>

        <section id="routes" className="sec"><Routes client={client} id={a.id} /></section>
        <section className="sec"><Touches client={client} id={a.id} /></section>
        <section id="calls" className="sec"><Calls client={client} id={a.id} /></section>

        {pipe ? (
          <div className="card more">
            <Disclosure title="What the scoring run found" desc={`Scoring run ${pipe.runId}, data as of ${period(pipe.period)}`}>
              <p>Priority {pipe.tier ? <Priority tier={pipe.tier} /> : 'none'}, score {num(pipe.score, 1)} of 100 (pressure {num(pipe.axes?.distress, 1)}, fit {num(pipe.axes?.fit, 1)}, timing {num(pipe.axes?.timing, 1)}).</p>
              <p>{pipe.leadSector ? `Lead with ${SECTOR_WORDS[pipe.leadSector] ?? pipe.leadSector}.` : pipe.leadSectorNote}</p>
              {pipe.signals?.length ? <ul>{pipe.signals.map((s, i) => <li key={s.id ?? i}>{s.label} <span className="muted small">{period(s.period)}</span></li>)}</ul> : null}
              <p className="muted">Context for research and for choosing who and when. It never appears in a message.</p>
            </Disclosure>
          </div>
        ) : null}

        <section id="brief" className="sec" aria-labelledby="h-brief">
          <h2 id="h-brief">Brief</h2>
          {brief ? <div className="panel"><Markdown text={brief} /></div> : <p className="muted">No brief yet.</p>}
        </section>
      </div>
    </>
  );
}
