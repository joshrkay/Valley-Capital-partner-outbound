// The top of a bank's record page (docs/design-redesign.md, 4.1): the highlights panel (name and chips, the decisions as one button group,
// six key fields) and the stage path with its next step. Server components. Each decision is a native <details> holding the same form and
// server action as before; it says what will happen, and nothing is sent.
import { moneyThousands, period } from '../../../lib/format.mjs';
import { facts, STAGE_PATH } from '../../../lib/bank-view.mjs';
import { Icon, Tile } from '../../icons.jsx';
import { Priority, Chip, Term } from '../../ui.jsx';
import { promoteAction, dismissAction, snoozeAction } from '../actions.js';

function Decide({ label, primary = false, children }) {
  return (
    <details className="menu">
      <summary className={`btn${primary ? ' primary' : ''}`}>{label}</summary>
      <div className="menu-panel">{children}</div>
    </details>
  );
}

export function Highlights({ item, paper, route, decision, suppressed, isNew }) {
  const excluded = (item.filtersFailed ?? []).length > 0;
  const promoted = decision?.status === 'promoted';
  const fields = facts(item, paper, route);
  const place = [item.city, item.state].filter(Boolean).join(', ');
  return (
    <div className="card hl">
      <div className="hl-top">
        <Tile icon="bank" tone="t-bank" size="lg" />
        <div className="hl-titles">
          <p className="eyebrow"><a href="/candidates">Banks</a> › Bank</p>
          <div className="title-row">
            <h1>{item.name}</h1>
            {isNew ? <Chip kind="new">New this week</Chip> : null}
            {suppressed ? <Chip kind="stop">Do not contact</Chip> : null}
            {promoted ? <Chip kind="done">In Outreach</Chip> : null}
            {decision?.status === 'snoozed' ? <Chip>Snoozed until {decision.until}</Chip> : null}
            {decision?.status === 'dismissed' ? <Chip>Not now</Chip> : null}
          </div>
          <p className="hl-sub">{[place, item.assets !== null && item.assets !== undefined ? `${moneyThousands(item.assets)} in total assets` : '', item.latestRepdte ? `FDIC data as of ${period(item.latestRepdte)}` : ''].filter(Boolean).join(' · ')}</p>
        </div>
        <div className="btn-group decide" role="group" aria-label="Decide">
          {promoted && decision.accountId ? <a className="btn primary" href={`/accounts/${encodeURIComponent(decision.accountId)}`}>Open in Outreach</a> : null}
          {!promoted && !excluded && !suppressed ? (
            <Decide label="Start outreach" primary>
              <form action={promoteAction} className="panel-form">
                <input type="hidden" name="key" value={item.key} />
                <p>This opens an outreach account for {item.name}, so you can name the person to contact and queue research. Nothing is sent.</p>
                <button className="btn primary" type="submit">Start outreach</button>
              </form>
            </Decide>
          ) : null}
          <Decide label="Snooze">
            <form action={snoozeAction} className="panel-form">
              <input type="hidden" name="key" value={item.key} />
              <p>Take it off the list until a date. It comes back on that date.</p>
              <label>Until<input type="date" name="until" required /></label>
              <button className="btn primary" type="submit">Snooze</button>
            </form>
          </Decide>
          <Decide label="Not now">
            <form action={dismissAction} className="panel-form">
              <input type="hidden" name="key" value={item.key} />
              <p>Take it off the list. It comes back only if something new happens at the bank, such as a new signal.</p>
              <label>Why not now? (required)<input type="text" name="reason" required placeholder="For example: too small, already sold its book" /></label>
              <button className="btn danger" type="submit">Not now</button>
            </form>
          </Decide>
        </div>
      </div>
      <ul className="hl-fields">
        {fields.map((f) => (
          <li key={f.id}>
            <span className="k">{f.term ? <Term id={f.term}>{f.k}</Term> : f.k}</span>
            <span className="v">
              {f.priority ? <Priority tier={item.tier} excluded={excluded} /> : <><b className="tnum">{f.v}</b>{f.sub ? <span className="muted"> {f.sub}</span> : null}{f.estimate ? <> <span className="basis est">Estimate</span></> : null}</>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Where the bank stands with us. The path records it; nothing on it sends anything.
export function StagePath({ stage }) {
  const cls = (i) => (i < stage.current ? 'done' : i === stage.current ? (stage.parked ? 'parked' : 'cur') : '');
  return (
    <div className="card pathcard">
      <div className="path-row">
        <ol className="path" aria-label="Stage">
          {STAGE_PATH.map((s, i) => (
            <li key={s} className={cls(i)} aria-current={i === stage.current ? 'step' : undefined}>
              <span>{i < stage.current ? <Icon name="check" /> : null}{s}</span>
            </li>
          ))}
        </ol>
      </div>
      <p className="path-guide"><Icon name="info" /><span>{stage.guide}{stage.account ? <> <a href={`/accounts/${encodeURIComponent(stage.account)}`}>Open in Outreach</a></> : null}</span></p>
    </div>
  );
}
