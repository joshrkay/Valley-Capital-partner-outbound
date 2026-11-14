import { requirePrincipal } from '../../lib/session.mjs';
import { loadRules } from '../../lib/engine.mjs';
import { salesOverview } from '../../lib/ops.mjs';
import { moneyDollars, when } from '../../lib/format.mjs';
import { kindLabel, partyLink, assetLine, countsLine, recoveryText } from '../../lib/sales-view.mjs';
import { NotAuthorized, Problem, ContextOnlyBanner } from '../ui.jsx';

export const metadata = { title: 'Sales · Valley Capital outbound' };

function Party({ p }) {
  if (!p) return null;
  const href = partyLink(p);
  const name = href ? <a href={href}>{p.name}</a> : <span className={p.kind === 'unknown' ? 'muted' : undefined}>{p.name}</span>;
  return <>{name}{p.key ? <span className="src">{p.key}</span> : null}</>;
}

export default async function Sales() {
  const ctx = await requirePrincipal();
  if (ctx.denied) return <NotAuthorized email={ctx.email} />;
  let d, rules;
  try { [d, rules] = await Promise.all([salesOverview(ctx.client), loadRules()]); } catch (e) { return <Problem text={`The sale ledger could not be loaded: ${e.message}`} />; }
  const label = new Map(rules.metros.metros.map((m) => [m.cbsa, m.label]));
  const metro = (c) => label.get(c) ?? c;
  return (
    <>
      <ContextOnlyBanner />
      <h1>Who sells to whom</h1>
      <p className="sub">Every sale event the stored data shows: CMBS liquidations, sales banks disclosed to the SEC, whole-bank acquisitions in our metros, and FDIC loan-sale announcements{d.builtAt ? `. Ledger built ${when(d.builtAt)}` : ''}. A buyer no source names is shown as unknown. Balances are in dollars.</p>
      {!d.builtAt ? <p className="muted">No ledger yet. It is rebuilt after each CMBS or FDIC loan-sale pull; queue one on the Status page, or run <code>outbound sales build</code>.</p> : (
        <>
          <h2>Recent sale events</h2>
          {!d.recent.length ? <p className="muted">No sale events yet.</p> : (
            <div className="scroll"><table>
              <thead><tr><th>Date</th><th>Kind</th><th>Seller</th><th>Buyer</th><th>Asset</th><th className="num">Balance</th><th>Source</th></tr></thead>
              <tbody>{d.recent.map((e) => (
                <tr key={e.id}>
                  <td className="small">{e.date}</td>
                  <td className="small">{kindLabel(e.kind)}{e.note ? <span className="src">{e.note}</span> : null}</td>
                  <td><Party p={e.seller} />{e.seller?.via ? <span className="src">through {partyLink(e.seller.via) ? <a href={partyLink(e.seller.via)}>{e.seller.via.name}</a> : e.seller.via.name}</span> : null}</td>
                  <td><Party p={e.buyer} /></td>
                  <td className="small">{assetLine(e.asset, metro)}</td>
                  <td className="num" title={e.asset?.balanceBasis ?? undefined}>{moneyDollars(e.asset?.balance)}</td>
                  <td className="small">{(e.sources ?? []).filter((s) => s.link).map((s, i) => <a key={i} href={s.link} rel="noopener noreferrer nofollow" target="_blank" style={{ marginRight: 6 }}>{s.source}</a>)}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}

          <h2>Sellers who have sold</h2>
          <p className="sub">By the institution that acted: a CMBS trust sells through its special servicer. A seller who has sold before is the warmest prospect there is.</p>
          {!d.sellers.length ? <p className="muted">No seller yet.</p> : (
            <div className="scroll"><table>
              <thead><tr><th>Seller</th><th>Kind</th><th className="num">Events</th><th>By kind</th><th>Latest</th></tr></thead>
              <tbody>{d.sellers.map((s) => (
                <tr key={s.key ?? s.name}>
                  <td>{s.link ? <a href={s.link}>{s.name}</a> : s.name}{s.key ? <span className="src">{s.key}</span> : null}{s.kind === 'servicer' && s.matched === false ? <span className="src">not on the reviewed servicer list</span> : null}</td>
                  <td className="small">{s.kind}</td><td className="num">{s.total}</td>
                  <td className="small">{countsLine(s.counts, kindLabel)}</td><td className="small">{s.latest}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}

          <h2>Known buyers</h2>
          <p className="sub">Only buyers a source names: today, the acquirer in an FDIC whole-bank deal. Who they are shows who the firm competes with.</p>
          {!d.buyers.length ? <p className="muted">No buyer is named in the stored data.</p> : (
            <div className="scroll"><table>
              <thead><tr><th>Buyer</th><th className="num">Events</th><th>By kind</th><th>By property type</th><th>By metro</th><th>By quarter</th></tr></thead>
              <tbody>{d.buyers.map((b) => (
                <tr key={b.key ?? b.name}>
                  <td>{b.link ? <a href={b.link}>{b.name}</a> : b.name}{b.key ? <span className="src">{b.key}</span> : null}</td>
                  <td className="num">{b.total}</td><td className="small">{countsLine(b.byKind, kindLabel)}</td><td className="small">{countsLine(b.byPropertyType)}</td>
                  <td className="small">{countsLine(b.byMetro, metro)}</td><td className="small">{countsLine(b.byPeriod)}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}

          <h2>Price evidence</h2>
          <div className="banner warn" role="note">{d.pricing?.label}</div>
          {!d.pricing?.groups?.length ? <p className="muted">No CMBS liquidation recorded yet.</p> : (
            <div className="scroll"><table>
              <thead><tr><th>Property type</th><th>Metro</th><th className="num">Liquidations</th><th className="num">With balance and loss</th><th className="num">Implied recovery (approximate)</th><th className="num">Range (approximate)</th></tr></thead>
              <tbody>{d.pricing.groups.map((g) => (
                <tr key={`${g.propertyType}|${g.metro}`}>
                  <td>{g.propertyType}</td><td>{g.metro ? metro(g.metro) : '–'}</td><td className="num">{g.events}</td><td className="num">{g.withRecovery}</td>
                  <td className="num" title={g.impliedRecovery?.label}>{recoveryText(g.impliedRecovery)}</td>
                  <td className="num">{g.withRecovery > 1 ? `${(g.min * 100).toFixed(1)}–${(g.max * 100).toFixed(1)}%` : '–'}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </>
      )}
    </>
  );
}
