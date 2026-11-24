// Loans we can see (docs/county-loans.md): individual loans named in public county records and matched to this bank, as a card in the
// sidebar and a tab of their own. Server components with no data of their own: the bank's file (loans/banks/fdic-<CERT>.json) and the
// watched counties come from the page, read as the signed-in principal. The file holds no borrower and no address, so neither can show.
import { loanRows, loansCard, watchedLine, emptyText, attributionLine, LOANS_CONTEXT } from '../../../lib/loans-view.mjs';
import { Tile } from '../../icons.jsx';
import { Term, Basis, Note } from '../../ui.jsx';

const EXT = { rel: 'noopener noreferrer nofollow', target: '_blank' };

// Each figure with what it is, then its basis once: "As stated on the document". A document that states none says so.
function Amounts({ lines, basis }) {
  return (
    <>
      {lines.map((a) => (a.label ? <div key={a.id}><b className="tnum">{a.text}</b> <span className="small">{a.label.toLowerCase()}</span></div> : <div key={a.id} className="muted">{a.text}</div>))}
      {basis ? <div className="small muted">{basis}</div> : null}
    </>
  );
}

export function LoansCard({ loans, watched = [], href }) {
  const c = loansCard(loans, watched);
  return (
    <section className="card side-card" aria-labelledby="h-loans">
      <div className="card-head"><Tile icon="doc" tone="t-bank" size="sm" /><h2 id="h-loans"><Term id="loans-we-can-see">Loans we can see</Term> ({c.count})</h2></div>
      {c.count ? (
        <ul className="rel-list">
          {c.latest.map((l) => (
            <li key={l.id}>
              <span>{l.type}</span>
              <span className="rel-m">{l.propertyKnown ? `${l.propertyType} · ` : ''}{l.stage} · {l.county}</span>
              <span className="rel-m">{l.dateKind} {l.short}{l.amounts[0].label ? ` · ${l.amounts[0].text} ${l.amounts[0].label.toLowerCase()}` : ''}</span>
              {l.relation ? <span className="rel-m">{l.relation}</span> : null}
            </li>
          ))}
        </ul>
      ) : <p className="card-body muted">{c.empty}</p>}
      <p className="card-body xs muted">{c.watched}{c.attribution ? ` ${c.attribution}` : ''}</p>
      <div className="card-foot"><a href={`${href}?tab=loans`}>{c.count > 3 ? `All ${c.count} loans we can see` : c.count ? 'Each loan, with its source' : 'How loans are found'}</a></div>
    </section>
  );
}

export function LoansSection({ loans, watched = [] }) {
  const rows = loanRows(loans);
  return (
    <section aria-labelledby="h-loans-tab" className="page">
      <div>
        <h2 id="h-loans-tab" className="sec-h"><Term id="loans-we-can-see">Loans we can see</Term> <Basis tier="observed" /></h2>
        <p className="sec-intro">Each row is one public-records document that names this bank as the lender, the beneficiary or the holder of a loan on a commercial property, in a county we watch. The property type comes from the county&apos;s own parcel record: only a property it confirms as commercial, apartments of 5 or more units, or commercial land is shown. Homes, and filings whose property the parcel record does not confirm, are left out. Amounts are as the document states them: an original principal is the loan&apos;s size when it was made, never today&apos;s balance.</p>
      </div>
      {rows.length ? (
        <div className="tablebox">
          <table className="plain loans">
            <thead><tr><th>Document</th><th>County</th><th>Date</th><th>Stage</th><th>Amount</th><th>Property type</th><th>Source</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td data-label="Document"><b>{r.type}</b><div className="small muted">{r.role}{r.via ? ` · ${r.via}` : ''}</div>{r.relation ? <div className="small">{r.relation}</div> : null}</td>
                  <td data-label="County">{r.county}</td>
                  <td data-label={r.dateKind} className="nowrap">{r.short}<div className="small muted kind">{r.dateKind}</div></td>
                  <td data-label="Stage">{r.stage}{r.saleShort ? <div className="small muted">Sale set for {r.saleShort}</div> : null}</td>
                  <td data-label="Amount" className="amount"><Amounts lines={r.amounts} basis={r.basis} /></td>
                  <td data-label="Property type" className={r.propertyKnown ? undefined : 'muted'}>{r.propertyType}{r.propertyDetail ? <div className="small muted">{r.propertyDetail}</div> : null}{r.propertyNote ? <div className="small muted">{r.propertyNote}</div> : null}</td>
                  <td data-label="Source">{r.link ? <a href={r.link} {...EXT}>Document {r.documentNumber}</a> : <span className="muted">No link</span>}{r.deedOfTrust ? <div className="small muted">Deed of trust {r.deedOfTrust}</div> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <Note tone="info" role="note"><span>{emptyText(watched)}{watched.length ? ` ${watchedLine(watched)}` : ''}</span></Note>}
      {attributionLine(rows) ? <p className="small muted">{attributionLine(rows)}</p> : null}
      <p className="small muted">{rows.length ? `${watchedLine(watched)} ` : ''}A name is matched to this bank&apos;s FDIC record exactly, or through a principal&apos;s alias. A name that matches more than one bank, or none, waits for a principal&apos;s review; MERS, trustees, servicers and law firms are never matched. {LOANS_CONTEXT}</p>
    </section>
  );
}
