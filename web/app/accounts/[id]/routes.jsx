// The account page's routes section (PRD E22-S7): who decides, and the best way in. The direct route's status, the ranked warm routes with
// their tier, bridge, reasoning and evidence, the held routes, a build button, a choose button, and the chosen route's checklist. Matching
// runs in code; no model sees the firm's network. There is no send button: a chosen route gives a principal a checklist only.
import { accountRoutes } from '../../../lib/routes-ops.mjs';
import { routeRow, evidenceLinks, TYPE_LABEL } from '../../../lib/routes-view.mjs';
import { Problem, RuleCodes } from '../../ui.jsx';
import { guardSentence } from '../../../lib/account-view.mjs';
import { buildRoutesAction, chooseRouteAction } from './routes-actions.js';

function Evidence({ r }) {
  return evidenceLinks(r).map((e, i) => (
    <span key={i}>{i ? ' · ' : ''}{e.href ? <a href={e.href} rel="noopener noreferrer nofollow" target="_blank">{e.label}</a> : e.label}{e.note ? <span className="src">{e.note}</span> : null}</span>
  ));
}

function Direct({ r }) {
  const s = r.status;
  return (
    <dl className="kv small">
      <dt>Person</dt><dd>{s.personNamed ? r.target.name : <span className="muted">not named yet{r.target.names?.length ? ` (candidates: ${r.target.names.join(', ')})` : ''}</span>}</dd>
      <dt>Role</dt><dd>{s.roleConfirmed ? `confirmed${s.roleConfirmedBy ? ` by ${s.roleConfirmedBy}` : ''}` : 'unconfirmed'}</dd>
      <dt>Address</dt><dd>{s.email.present ? (s.email.verified ? 'verified' : `not verified (${s.email.label ?? s.email.status})`) : 'none on the account'}</dd>
      <dt>Ready</dt><dd>{s.ready ? 'yes' : 'no'}</dd>
    </dl>
  );
}

function Checklist({ chosen }) {
  const c = chosen.checklist;
  return (
    <div className="panel small">
      <h3>Chosen: {TYPE_LABEL[c.type]} route <span className="mono">{c.routeId}</span>, by {chosen.by} on {String(chosen.at).slice(0, 10)}</h3>
      <div className="banner warn small">{c.note}</div>
      {c.stops.length ? <div className="banner error small" role="alert"><strong>Stop first:</strong><ul>{c.stops.map((s, i) => <li key={i}>{s}</li>)}</ul></div> : null}
      {c.inConversation ? <p><strong>Already in conversation:</strong> a {c.inConversation.type} was recorded on {c.inConversation.date}.</p> : null}
      <h4>{c.type === 'direct' ? 'Still needed' : 'Who to ask'}</h4>
      {c.ask.length ? <ul>{c.ask.map((x, i) => <li key={i}>{x}</li>)}</ul> : <p className="muted">Nothing: every prerequisite is met.</p>}
      {c.cite.length ? <><h4>What to cite (sourced; cite only these)</h4><ul>{c.cite.map((x, i) => <li key={i}>{x}</li>)}</ul></> : null}
      {c.never.length ? <><h4>Never</h4><ul>{c.never.map((x, i) => <li key={i}>{x}</li>)}</ul></> : null}
      <h4>{c.type === 'direct' ? 'Then' : 'After an introduction'}</h4>
      <ul>{c.after.map((x, i) => <li key={i}>{x}</li>)}</ul>
    </div>
  );
}

export async function Routes({ client, id }) {
  let rec;
  try { rec = await accountRoutes(client, id); } catch (e) { return <Problem text={`The routes could not be loaded: ${e.message}`} />; }
  const direct = rec?.routes?.find((r) => r.type === 'direct');
  return (
    <>
      <h2>Routes to the decision-maker</h2>
      <p className="small muted">Who decides, and the best way in: the lender's own counsel, an advisor it has used, a director or officer someone in the firm's network knows, a shared association, or the direct route. Matched in code against the firm's network; no model sees it. Nothing here is drafted or sent, and a route relaxes no guard rule. The order and limits are placeholders in routes.json.</p>
      <form action={buildRoutesAction} className="inline">
        <input type="hidden" name="id" value={id} />
        <button className="secondary" type="submit">{rec ? 'Build again' : 'Build routes'}</button>
      </form>
      {!rec ? <p className="muted small">No routes yet. Build them after the research has run and the firm's network is entered on the Network page.</p> : (
        <>
          <p className="small">Built {String(rec.builtAt).slice(0, 10)} from {rec.inputs.research ? `the research of ${rec.inputs.research.date}` : 'no research yet'}, {rec.inputs.ledger ? 'the sale ledger' : 'no sale ledger'}, and a network of {rec.inputs.network.people} people, {rec.inputs.network.firms} firms and {rec.inputs.network.memberships} memberships.</p>
          {rec.guard.hardStops.length ? <div className="banner error small" role="alert"><strong>Stop.</strong>{rec.guard.blocksChoice ? ' No route can be chosen: an introduction must not go around an opt-out or a suppression.' : ''}<ul>{rec.guard.hardStops.map((h) => <li key={h.code}>{guardSentence(h)}</li>)}</ul><RuleCodes codes={rec.guard.hardStops.map((h) => h.code)} /></div> : null}
          {rec.guard.inConversation ? <div className="banner ok small">Already in conversation: a {rec.guard.inConversation.type} was recorded on {rec.guard.inConversation.date}.</div> : null}
          {direct ? <div className="panel"><h3>The direct route</h3><Direct r={direct} /><p className="small">{direct.reasoning}</p></div> : null}
          <div className="scroll"><table>
            <thead><tr><th>#</th><th>Route</th><th>Target</th><th>Bridge</th><th>Tier</th><th>Reasoning and evidence</th><th></th></tr></thead>
            <tbody>{rec.routes.map((r) => {
              const row = routeRow(r);
              return (
                <tr key={r.id}>
                  <td>{row.rank}</td><td>{row.type}</td><td>{row.target}</td><td>{row.bridge}</td>
                  <td>{row.tier}{row.current || !row.asOf ? null : <span className="pill">not current</span>}</td>
                  <td className="small">{row.reasoning}{r.assetSpecific ? <div className="muted">Its evidence names a particular property or borrower: for your own context only.</div> : null}<div><Evidence r={r} /></div></td>
                  <td>{rec.guard.blocksChoice ? null : (
                    <form action={chooseRouteAction} className="inline"><input type="hidden" name="id" value={id} /><input type="hidden" name="route" value={r.id} />
                      <button className={rec.chosen?.routeId === r.id ? '' : 'secondary'} type="submit">{rec.chosen?.routeId === r.id ? 'Chosen' : 'Choose'}</button></form>
                  )}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
          {rec.held.length ? <><h3>Held: not choosable</h3><ul className="small">{rec.held.map((r) => <li key={r.id}>{TYPE_LABEL[r.type]}: {routeRow(r).target} via {routeRow(r).bridge}. {r.heldBecause}: {r.heldWhy}</li>)}</ul></> : null}
          <p className="small muted">Left out: {rec.leftOut.declined} contact(s) who said no to introductions, {rec.leftOut.uncheckedFindings} finding(s) whose quote could not be checked, {rec.leftOut.nameOnly} same-name match(es) dropped, {rec.leftOut.ledgerBuyers} known buyer(s) of the bank's loans (not a route), {rec.leftOut.multiAssociation ?? 0} membership finding(s) naming more than one association, {rec.leftOut.peopleElsewhere ?? 0} person(s) a membership finding names from another organization.</p>
          {rec.chosen?.supported && rec.chosen.checklist ? <Checklist chosen={rec.chosen} /> : null}
          {rec.chosen && !rec.chosen.supported ? <div className="banner warn small">The chosen route <span className="mono">{rec.chosen.routeId}</span> is no longer supported by the evidence. Build again, or choose another.</div> : null}
          {rec.choiceRemoved ? <p className="small muted">A choice was removed on {String(rec.choiceRemoved.at).slice(0, 10)}: {rec.choiceRemoved.reason}</p> : null}
        </>
      )}
    </>
  );
}
