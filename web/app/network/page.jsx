// The firm's network (PRD E22-S1): the people the principals know, the firms they work with and the associations they belong to, with
// forms to add each, a button to remove each, and how many chosen routes use each entry (D-R8: no cap on asks in code; this count instead).
// Private: names and relationships only, kept in the data store, never sent to a model. Viewing it is audited.
import { requirePrincipal } from '../../lib/session.mjs';
import { networkOverview } from '../../lib/routes-ops.mjs';
import { NotAuthorized, Problem, PageHead } from '../ui.jsx';
import { addPersonAction, addFirmAction, addMembershipAction, removeEntryAction } from './actions.js';

export const metadata = { title: 'Network · Valley Capital outbound' };

function Remove({ id }) {
  return <form action={removeEntryAction} className="inline"><input type="hidden" name="id" value={id} /><button className="danger" type="submit">Remove</button></form>;
}
const used = (uses, id) => (uses[id] ? `${uses[id]}` : '–');

export default async function Network() {
  const ctx = await requirePrincipal();
  if (ctx.denied) return <NotAuthorized email={ctx.email} />;
  let n;
  try { n = await networkOverview(ctx.client, { by: ctx.principal.name }); } catch (e) { return <Problem text={`The network could not be loaded: ${e.message}`} />; }
  return (
    <>
      <PageHead icon="people" tone="t-out" eyebrow="Market · Our network" title="The firm's network" lede={<>The principals' own relationships, for finding warm routes to the person who decides on loan sales (PRD E22). Routes are built on each account's page.</>} />
      <div className="banner warn small" role="note">Private. Names and relationships only: never an email address or a phone number, because nothing here contacts anyone. It is matched in code; no model ever sees it, and nothing is drafted or sent to anyone in it. Removing an entry removes it from every route that used it.</div>

      <h2>People ({n.people.length})</h2>
      {n.people.length ? (
        <div className="scroll"><table>
          <thead><tr><th>Id</th><th>Name</th><th>Organization</th><th>Title</th><th>Relationship</th><th>Known to</th><th>Agreed to be asked</th><th className="num">Chosen routes</th><th></th></tr></thead>
          <tbody>{n.people.map((p) => (
            <tr key={p.id}><td className="mono">{p.id}</td><td>{p.name}</td><td>{p.organization || '–'}</td><td>{p.title || '–'}</td><td>{p.relationship || '–'}</td><td>{p.knownBy.join(', ')}</td><td>{p.introConsent}</td><td className="num">{used(n.uses, p.id)}</td><td><Remove id={p.id} /></td></tr>
          ))}</tbody>
        </table></div>
      ) : <p className="muted small">None yet.</p>}
      <form action={addPersonAction} className="panel row">
        <label>Name<input name="name" required /></label>
        <label>Organization<input name="organization" /></label>
        <label>Title<input name="title" /></label>
        <label>Relationship<input name="relationship" /></label>
        <label>Known to (principals, comma-separated)<input name="knownBy" required defaultValue={ctx.principal.name} /></label>
        <label>Agreed to be asked for introductions<select name="introConsent" defaultValue="unknown"><option value="unknown">unknown</option><option value="yes">yes</option><option value="no">no</option></select></label>
        <label>Other names (comma-separated)<input name="aliases" /></label>
        <button type="submit">Add person</button>
      </form>

      <h2>Firms ({n.firms.length})</h2>
      {n.firms.length ? (
        <div className="scroll"><table>
          <thead><tr><th>Id</th><th>Name</th><th>Kind</th><th>Relationship</th><th>Known to</th><th className="num">Chosen routes</th><th></th></tr></thead>
          <tbody>{n.firms.map((f) => (
            <tr key={f.id}><td className="mono">{f.id}</td><td>{f.name}{f.aliases.length ? <span className="src">{f.aliases.join(', ')}</span> : null}</td><td>{f.kind}</td><td>{f.relationship || '–'}</td><td>{f.knownBy.join(', ')}</td><td className="num">{used(n.uses, f.id)}</td><td><Remove id={f.id} /></td></tr>
          ))}</tbody>
        </table></div>
      ) : <p className="muted small">None yet.</p>}
      <form action={addFirmAction} className="panel row">
        <label>Name<input name="name" required /></label>
        <label>Kind<select name="kind" defaultValue="law"><option value="law">law</option><option value="advisor">advisor</option><option value="broker">broker</option><option value="other">other</option></select></label>
        <label>Relationship<input name="relationship" /></label>
        <label>Known to (principals, comma-separated)<input name="knownBy" required defaultValue={ctx.principal.name} /></label>
        <label>Other names (comma-separated)<input name="aliases" /></label>
        <button type="submit">Add firm</button>
      </form>

      <h2>Memberships ({n.memberships.length})</h2>
      {n.memberships.length ? (
        <div className="scroll"><table>
          <thead><tr><th>Id</th><th>Association or forum</th><th>Principal</th><th>Role</th><th className="num">Chosen routes</th><th></th></tr></thead>
          <tbody>{n.memberships.map((m) => (
            <tr key={m.id}><td className="mono">{m.id}</td><td>{m.association}{m.aliases.length ? <span className="src">{m.aliases.join(', ')}</span> : null}</td><td>{m.principal}</td><td>{m.role}</td><td className="num">{used(n.uses, m.id)}</td><td><Remove id={m.id} /></td></tr>
          ))}</tbody>
        </table></div>
      ) : <p className="muted small">None yet.</p>}
      <form action={addMembershipAction} className="panel row">
        <label>Association or forum<input name="association" required /></label>
        <label>Principal<input name="principal" required defaultValue={ctx.principal.name} /></label>
        <label>Role<input name="role" defaultValue="member" /></label>
        <label>Other names (comma-separated)<input name="aliases" /></label>
        <button type="submit">Add membership</button>
      </form>
    </>
  );
}
