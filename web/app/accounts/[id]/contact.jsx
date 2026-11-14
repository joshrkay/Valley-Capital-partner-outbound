// The account page's contact section (PRD E7-S3): who the person is and how to reach them, each field with where it came from; the
// institution's email domains; verifying the address (the code's checks plus a principal's word for how they know it); and a deletion
// request. The engine's own functions run as the signed-in principal (web/lib/ops.mjs). Nothing here sends anything, and no mail
// server is ever contacted: verifying looks up the domain's MX record in DNS, and that is all.
import { Fragment } from 'react';
import { accountContact } from '../../../lib/ops.mjs';
import { Problem } from '../../ui.jsx';
import { setPersonAction, setEmailAction, addDomainAction, verifyEmailAction, forgetPersonAction } from '../actions.js';

const today = () => new Date().toISOString().slice(0, 10);
const FIELD_LABEL = { name: 'Name', title: 'Title', email: 'Email', phone: 'Phone', mailingAddress: 'Mailing address' };
const KIND_LABEL = { brief_finding: 'brief finding', institution_site: 'the bank\'s own site', correspondence: 'correspondence', principal_known: 'known to a principal', vendor: 'vendor' };
const METHOD_LABEL = { institution_site: 'seen on the bank\'s own site (give the page)', correspondence: 'the person wrote from it', principal_known: 'I know it first-hand', vendor: 'a vendor with a recorded pass' };

function Source({ s }) {
  if (!s) return <span className="muted">no source recorded</span>;
  const what = s.kind === 'brief_finding' ? `brief finding ${s.findingId ?? ''}` : s.kind === 'vendor' ? `vendor ${s.vendor ?? ''}` : KIND_LABEL[s.kind] ?? s.kind ?? s.source ?? 'a source';
  return (
    <span className="small">
      {what}
      {s.url ? <> · <a href={s.url} rel="noopener noreferrer nofollow" target="_blank">page</a></> : null}
      {s.seenOn ? ` · seen ${s.seenOn}` : ''}
      {s.by || s.confirmedBy ? ` · set by ${s.by ?? s.confirmedBy}` : ''}
    </span>
  );
}

// Where a value came from. A brief finding gives its own page and date; a vendor only with a recorded pass.
function SourceFields({ candidates, vendors, defaultKind }) {
  return (
    <>
      <label>Source<select name="source" defaultValue={defaultKind}>
        <option value="brief_finding">a finding in the brief</option>
        <option value="institution_site">the bank's own site</option>
        <option value="correspondence">correspondence</option>
        <option value="principal_known">I know it first-hand</option>
        {vendors.length ? <option value="vendor">a vendor (passed)</option> : null}
      </select></label>
      {candidates.length ? (
        <label>Finding<select name="finding" defaultValue="">
          <option value="">–</option>
          {candidates.map((c) => <option key={c.id} value={c.id}>{c.id}: {c.claim.slice(0, 60)}</option>)}
        </select></label>
      ) : <input type="hidden" name="finding" value="" />}
      <label>Page<input name="url" type="url" placeholder="https://" /></label>
      {vendors.length ? <label>Vendor<select name="vendor" defaultValue="">{['', ...vendors].map((v) => <option key={v} value={v}>{v || '–'}</option>)}</select></label> : <input type="hidden" name="vendor" value="" />}
      <label>Seen<input name="seen" type="date" max={today()} /></label>
    </>
  );
}

const STATE = {
  none: ['warn', 'No address yet.'],
  unverified: ['warn', 'UNVERIFIED. The guard refuses any email to it until a principal verifies it.'],
  verified: ['ok', 'Verified.'],
  expired: ['error', 'EXPIRED. The verification is too old; verify it again before any email.'],
  other_address: ['error', 'UNVERIFIED. The verification on record is for a different address.'],
};

export async function Contact({ client, id }) {
  let c;
  try { c = await accountContact(client, id); } catch (e) { return <Problem text={`The contact details could not be loaded: ${e.message}`} />; }
  if (!c) return null;
  const { account: a, status: st, candidates, vendors } = c;
  const named = !!a.person?.name;
  const v = st.email.verification;
  const [tone, says] = STATE[st.email.state] ?? STATE.unverified;
  return (
    <>
      <h2>Contact details</h2>
      <p className="small muted">Every field records where it came from. An address is used only once it is verified, and only a principal sends. A forgotten person is never named again.</p>
      {st.forgotten.length ? <div className="banner warn small">A person was removed from this account on a deletion request ({st.forgotten.map((x) => `${String(x.at).slice(0, 10)} by ${x.by}`).join('; ')}).</div> : null}

      <div className="grid2">
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Each field and its source</h3>
          <dl className="kv">
            {Object.keys(FIELD_LABEL).map((f) => (
              <Fragment key={f}><dt>{FIELD_LABEL[f]}</dt><dd>{a.person?.[f] ? <>{a.person[f]}<br /><Source s={st.fields[f]} /></> : <span className="muted">–</span>}</dd></Fragment>
            ))}
          </dl>
          {st.unsourced.length ? <div className="banner warn small">No source recorded for: {st.unsourced.join(', ')}. Set each again with its source.</div> : null}
          <h3>Name the person</h3>
          <p className="small muted">Usually one of the brief's candidates: choose its finding. A new person starts with an unconfirmed role and no address.</p>
          <form action={setPersonAction} className="row">
            <input type="hidden" name="id" value={a.id} />
            <label>Name<input name="name" required defaultValue={a.person?.name ?? ''} /></label>
            <label>Title<input name="title" defaultValue={a.person?.title ?? ''} /></label>
            <SourceFields candidates={candidates} vendors={vendors} defaultKind="brief_finding" />
            <button className="secondary" type="submit">Name, with this source</button>
          </form>
        </div>

        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Email</h3>
          <div className={`banner ${tone} small`}>
            {st.email.address ? <strong>{st.email.address}: </strong> : null}{says}
            {st.email.state === 'verified' ? ` ${v.method.replace(/_/g, ' ')}, by ${v.by} on ${v.verifiedOn}; verify again by ${st.email.reverifyBy}.` : ''}
          </div>
          {named ? (
            <form action={setEmailAction} className="row">
              <input type="hidden" name="id" value={a.id} />
              <label>Address<input name="email" type="email" required /></label>
              <SourceFields candidates={[]} vendors={vendors} defaultKind="institution_site" />
              <button className="secondary" type="submit">Set address</button>
            </form>
          ) : <p className="small muted">Name the person first.</p>}

          <h3>Domains</h3>
          {st.domains.length ? <ul className="small">{st.domains.map((d) => <li key={d.domain}><strong>{d.domain}</strong> <Source s={d} /></li>)}</ul> : <p className="small muted">None confirmed yet. An address is verified only at a confirmed domain.</p>}
          <form action={addDomainAction} className="row">
            <input type="hidden" name="id" value={a.id} />
            <label>Domain<input name="domain" required placeholder="example.com" /></label>
            <SourceFields candidates={[]} vendors={[]} defaultKind="institution_site" />
            <button className="secondary" type="submit">Confirm domain</button>
          </form>

          <h3>Verify the address</h3>
          {st.email.address ? (
            <>
              <p className="small muted">Every check must pass: well formed, a recorded source, a business address, a confirmed domain, an MX record in DNS (no mail server is contacted), and no suppression. Then say how you know it.</p>
              <form action={verifyEmailAction} className="row">
                <input type="hidden" name="id" value={a.id} />
                <label>How you know it<select name="method" required defaultValue="institution_site">
                  {Object.entries(METHOD_LABEL).filter(([k]) => k !== 'vendor' || vendors.length).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                </select></label>
                <label>Page<input name="url" type="url" placeholder="https://" /></label>
                {vendors.length ? <label>Vendor<select name="vendor" defaultValue="">{['', ...vendors].map((x) => <option key={x} value={x}>{x || '–'}</option>)}</select></label> : null}
                <label>Seen<input name="seen" type="date" max={today()} /></label>
                <button type="submit">Run the checks and verify</button>
              </form>
            </>
          ) : <p className="small muted">Set an address first.</p>}
        </div>
      </div>

      {named || st.email.address ? (
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Forget this person (a deletion request)</h3>
          <p className="small">Removes them from every record: this account and any other that holds them, the research and the brief, drafts addressed to them, call notes and proposals, the pilot sheets, the known list, and any note in the touch log. The touch log keeps its events, so a reply or an opt-out still stops outreach. A hashed suppression entry keeps them from being contacted or named again. This cannot be undone.</p>
          <form action={forgetPersonAction}>
            <input type="hidden" name="id" value={a.id} />
            <label>Reason<input name="reason" required maxLength={300} /></label>
            <label style={{ marginTop: 8 }}>Type the account's name to confirm: <strong>{a.name}</strong><input name="confirm" required autoComplete="off" /></label>
            <p style={{ marginTop: 8 }}><button className="danger" type="submit">Forget this person</button></p>
          </form>
        </div>
      ) : null}
    </>
  );
}
