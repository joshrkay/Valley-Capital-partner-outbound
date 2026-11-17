import { requirePrincipal } from '../../lib/session.mjs';
import { calibrationOverview } from '../../lib/calibration-ops.mjs';
import { calibrationPage, PAGE } from '../../lib/calibration-view.mjs';
import { NotAuthorized, Problem, PageHead } from '../ui.jsx';

export const metadata = { title: 'Score check · Valley Capital outbound' };

// PRD next-five E17-S5: the latest backtest of the score, server-rendered from its stored report, and the list of stored reports. Named
// Score check (was Calibration; docs/design-redesign.md 5.9), with the headline sentence first.
// Read-only. Every word shown comes from the view (lib/calibration-view.mjs) or the report itself; this file only lays it out.

// A table from the view: head is one row of labels or several rows of { label, span }; a cell is text or { text, note }.
function Table({ t }) {
  const heads = Array.isArray(t.head[0]) ? t.head : [t.head];
  return (
    <div className="scroll"><table>
      <thead>{heads.map((row, i) => (
        <tr key={i}>{row.map((h, j) => (typeof h === 'object' ? <th key={j} colSpan={h.span}>{h.label}</th> : <th key={j}>{h}</th>))}</tr>
      ))}</thead>
      <tbody>{t.rows.map((r, i) => (
        <tr key={i}>
          <td className={r.sub ? 'indent' : undefined}>{r.label}{r.labelNote ? <span className="src">{r.labelNote}</span> : null}</td>
          {r.cells.map((c, j) => (c && typeof c === 'object'
            ? <td key={j} className="num">{c.text}{c.note ? <span className="src">{c.note}</span> : null}</td>
            : <td key={j} className="num">{c}</td>))}
          {'read' in r ? <td className="small">{r.read}</td> : null}
        </tr>
      ))}</tbody>
    </table></div>
  );
}

function Section({ t }) {
  if (!t) return null;
  return (
    <>
      <h3>{t.title}</h3>
      {t.label ? <div className="banner warn" role="note">{t.label}</div> : null}
      {t.intro ? <p className="sub">{t.intro}</p> : null}
      {t.rows.length ? <Table t={t} /> : null}
    </>
  );
}

function List({ title, items }) {
  if (!items?.length) return null;
  return <><h3>{title}</h3><ul className="small">{items.map((x, i) => <li key={i}>{x}</li>)}</ul></>;
}

function Result({ res }) {
  return (
    <>
      <h2>{res.title}</h2>
      <p className="sub">{res.headline.intro}</p>
      <Table t={res.headline} />
      {res.headline.notes.map((n, i) => <p key={i} className="muted small">{n}</p>)}
      <p className="small">{res.metroSize}</p>
      <Section t={res.byEra} />
      <Section t={res.leadTime} />
      <Section t={res.byHorizon} />
      <Section t={res.components} />
      <Section t={res.context} />
    </>
  );
}

function Report({ r }) {
  return (
    <>
      <h2>{r.title}</h2>
      <p className="sub">{r.sub}</p>
      {r.banners.map((b, i) => <div key={i} className={`banner ${b.tone}`} role="note">{b.text}</div>)}
      <h3>{PAGE.sections.provenance}</h3>
      <div className="scroll"><table>
        <tbody>{r.provenance.map((p) => <tr key={p.label}><th>{p.label}</th><td>{p.value}</td></tr>)}</tbody>
      </table></div>
      <List title={PAGE.sections.labelKinds} items={r.labelKinds} />
      {r.results.map((res, i) => <Result key={i} res={res} />)}
      <Section t={r.folds} />
      <List title={PAGE.sections.notes} items={r.notes} />
      <List title={PAGE.sections.words} items={r.words} />
      <List title={PAGE.sections.limits} items={r.limits} />
      {r.scoringJson ? <p className="muted small">{PAGE.scoringJson}: {r.scoringJson}</p> : null}
    </>
  );
}

export default async function Calibration({ searchParams }) {
  const ctx = await requirePrincipal();
  if (ctx.denied) return <NotAuthorized email={ctx.email} />;
  const sp = await searchParams;
  let v;
  try { v = calibrationPage(await calibrationOverview(ctx.client, { hash: typeof sp?.report === 'string' ? sp.report : undefined })); }
  catch (e) { return <Problem text={`${PAGE.loadError}: ${e.message}`} />; }
  const lead = v.report?.results?.[0]?.sentence;
  return (
    <>
      <div className="page">
        <PageHead icon="gauge" tone="t-score" eyebrow={`Setup and checks · was ${PAGE.was}`} title={PAGE.title} lede={PAGE.sub} />
        {lead ? <section className="callout" aria-label="The headline"><p className="answer-text">{lead}</p></section> : null}
      </div>
      {v.notice ? <div className="banner warn" role="status">{v.notice}</div> : null}
      {v.noReport ? (
        <div className="panel">
          <h2>{v.noReport.title}</h2>
          <p>{v.noReport.intro}</p>
          <ol>{v.noReport.steps.map((s) => <li key={s.command}><code>{s.command}</code>: {s.what}</li>)}</ol>
          <p className="muted small">{v.noReport.after}</p>
        </div>
      ) : null}
      {v.report ? <Report r={v.report} /> : null}
      {v.reports.length ? (
        <>
          <h2>{PAGE.sections.reports}</h2>
          <p className="sub">{PAGE.reportsIntro}</p>
          <div className="scroll"><table>
            <thead><tr>{PAGE.reportsHead.map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>{v.reports.map((x) => (
              <tr key={x.hash}>
                <td className="mono">{x.shown ? <strong>{x.hash}</strong> : <a href={x.href}>{x.hash}</a>}{x.latest || x.shown ? <span className="src">{[x.latest ? PAGE.latest : null, x.shown ? PAGE.shown : null].filter(Boolean).join(', ')}</span> : null}</td>
                <td className="small">{x.date}</td>
                <td>{x.kind}</td>
                <td className="mono small">{x.scoring}</td>
                <td className="num">{x.labelledBanks}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </>
      ) : null}
    </>
  );
}
