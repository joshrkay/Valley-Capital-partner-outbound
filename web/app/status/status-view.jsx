// System status (docs/design-redesign.md, 5.7): first, one line that says whether the data is current or what is wrong; sending paused or
// allowed, in words; the refresh buttons with what each does; then coverage, the CMBS pull, the jobs as plain lines, and the raw tables
// under "Technical detail". A server component with no data of its own; the buttons run the same server actions as before.
import { when, period } from '../../lib/format.mjs';
import { healthSummary, sendingLine, jobLabel, jobResultLine, sourceLabel, QUEUE_HELP } from '../../lib/status-view.mjs';
import { Icon, Tile } from '../icons.jsx';
import { PageHead, Note, Chip, Disclosure } from '../ui.jsx';
import { queueSourcesAction, queueScoreAction, queueEdgarAction } from './actions.js';

const STATUS_CHIP = { done: ['done', 'Done'], failed: ['stop', 'Failed'], running: ['back', 'Running'], queued: ['', 'Waiting'] };

export default function StatusView({ s, cov, covError, reminders = [], counties = [], countiesError = null, now = new Date(), outcomes = null, scoreCheck = 'Score check' }) {
  const health = healthSummary(s, { now, staleDays: s.staleDays ?? {} });
  const sending = sendingLine(s.kill);
  const edgar = s.edgar;
  return (
    <div className="page">
      <PageHead icon="setup" tone="t-set" eyebrow="Setup and checks" title="System status" lede={<>Is the data current, and is anything broken? Whether the score picks banks under pressure well is on the {scoreCheck} page.</>} />
      <section className={`card statusline ${health.ok ? 'good' : 'bad'}`} aria-labelledby="h-health">
        <h2 id="h-health" className={health.ok ? 'ok-line' : 'bad-line'}><Icon name={health.ok ? 'check' : 'warn'} /> {health.headline}</h2>
        {health.problems.length > 1 ? <ul>{health.problems.map((p, i) => <li key={i}>{p}</li>)}</ul> : null}
      </section>
      <div className="grid2">
        <section className={`card statusline ${sending.paused ? 'bad' : ''}`} aria-labelledby="h-sending">
          <h2 id="h-sending" className={sending.paused ? 'bad-line' : 'ok-line'}><Icon name={sending.paused ? 'warn' : 'check'} /> {sending.text}</h2>
          <p className="muted">{sending.detail}</p>
        </section>
        <section className="card" aria-labelledby="h-refresh">
          <div className="card-head"><Tile icon="setup" tone="t-set" size="sm" /><h2 id="h-refresh">Refresh the data</h2><span className="card-head-r xs">Each runs at the worker&apos;s next pass</span></div>
          <div className="card-body refresh">
            <form action={queueSourcesAction}><button type="submit" className="btn">Queue FDIC pull</button><p className="small muted">{QUEUE_HELP.fdic}</p></form>
            <form action={queueEdgarAction}><button type="submit" className="btn">Queue CMBS pull (SEC EDGAR)</button><p className="small muted">{QUEUE_HELP.edgar}</p></form>
            <form action={queueScoreAction}><button type="submit" className="btn">Queue scoring</button><label className="check small"><input type="checkbox" name="draftBuybox" /> With the draft buy box (the list is then marked not final)</label><p className="small muted">{QUEUE_HELP.score}</p></form>
          </div>
        </section>
      </div>
      {reminders.length ? (
        <Note tone="warn" role="note"><span>Buyer-list re-certification due: {reminders.map((r, i) => <span key={r.key}>{i ? '; ' : ''}<a href={`/intermediaries/${encodeURIComponent(r.key)}`}>{r.name}</a> by {r.recertifyBy}{r.overdue ? ' (overdue)' : ''}</span>)}.</span></Note>
      ) : null}

      <section className="sec" aria-labelledby="h-cov">
        <h2 id="h-cov">Signal coverage</h2>
        <p className="sub">{cov?.intro ?? 'Which candidates each signal source can see, from stored data only.'}{cov?.asOf && !cov.note ? ` Banks from the latest scoring run, data as of ${period(cov.asOf)}.` : ''}{cov?.provisional && !cov.note ? ' Not final: the buy box still has placeholders.' : ''}</p>
        {covError ? <div className="banner error">Coverage could not be computed: {covError}</div> : null}
        {cov ? (
          <>
            {cov.note ? <div className="banner warn">{cov.note}</div> : null}
            <div className="scroll card"><table>
              <thead><tr><th>Source</th>{cov.columns.map((c) => <th key={c.id} className="num">{c.label}</th>)}</tr></thead>
              <tbody>{cov.rows.map((r) => (
                <tr key={r.id}>
                  <td className={r.sub ? 'small indent' : undefined}>{r.label}<span className="src">{r.basis}{r.detail ? ` ${r.detail}` : ''}</span></td>
                  {r.cells.map((t, i) => <td key={i} className={`num${r.built ? '' : ' muted'}`}>{t}</td>)}
                </tr>
              ))}</tbody>
            </table></div>
            {cov.notRunNote ? <p className="muted small">{cov.notRunNote}</p> : null}
          </>
        ) : null}
      </section>

      <section className="sec" aria-labelledby="h-county">
        <h2 id="h-county">County records</h2>
        <p className="sub">Each watched county&apos;s weekly read of public-records documents about loans, which feeds Loans we can see on each bank page. Counts only.</p>
        {countiesError ? <div className="banner error">County coverage could not be read: {countiesError}</div> : null}
        {counties.length ? (
          <div className="scroll card"><table>
            <thead><tr><th>County</th><th>Last run</th><th className="num">Documents read</th><th className="num">New this week</th><th className="num">Matched to a bank</th><th className="num">Names to review</th></tr></thead>
            <tbody>{counties.map((c) => (
              <tr key={c.id}>
                <td>{c.county}<span className="src">{c.label}{c.configured ? '' : ' · not in the watch list'}</span></td>
                <td>{c.lastRun}{c.error ? <span className="src">{c.error}</span> : null}</td>
                <td className="num">{c.read}</td>
                <td className="num">{c.newThisWeek}</td>
                <td className="num">{c.stored === '–' ? '–' : `${c.matched} of ${c.stored}`}</td>
                <td className="num">{c.review}</td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : countiesError ? null : <p className="muted">No county is watched yet. A county&apos;s watcher starts once its source is built, its robots.txt and terms are read and dated, and a principal lists it.</p>}
      </section>

      <section className="sec" aria-labelledby="h-edgar">
        <h2 id="h-edgar">CMBS loan data (SEC EDGAR)</h2>
        {edgar.failure ? <div className="banner error">The last EDGAR pull failed: {edgar.failure.text}</div> : null}
        <div className="panel">
          {edgar.ranAt ? (
            <dl className="kv">
              <dt>Last run</dt><dd>{when(edgar.ranAt)}</dd>
              <dt>Filings since</dt><dd>{edgar.since ?? '–'}</dd>
              <dt>CMBS trusts read</dt><dd>{edgar.trusts ?? '–'}{edgar.trustErrors ? <span className="muted"> ({edgar.trustErrors} could not be read)</span> : null}</dd>
              <dt>Loans read</dt><dd>{edgar.loansRead ?? '–'}</dd>
              <dt>Loans kept</dt><dd>{edgar.loansKept ?? '–'} <span className="muted small">in our metros and sectors</span></dd>
              {edgar.suspect ? <><dt>Note</dt><dd>The run looked wrong; check its notes under Technical detail.</dd></> : null}
            </dl>
          ) : <p className="muted">No EDGAR pull has finished yet.</p>}
        </div>
      </section>

      <section className="card" aria-labelledby="h-jobs">
        <div className="card-head"><Tile icon="chart" tone="t-set" size="sm" /><h2 id="h-jobs">Recent jobs</h2></div>
        {s.jobs.length ? (
          <ul className="rel-list">
            {s.jobs.slice(0, 12).map((j) => (
              <li key={j.id}>
                <span className="one-line"><strong>{jobLabel(j.kind)}</strong><Chip kind={(STATUS_CHIP[j.status] ?? ['', j.status])[0]}>{(STATUS_CHIP[j.status] ?? ['', j.status])[1]}</Chip></span>
                <span className="rel-m">{jobResultLine(j)} Queued {when(j.created_at)}{j.requested_by ? ` by ${j.requested_by}` : ''}.</span>
              </li>
            ))}
          </ul>
        ) : <p className="card-body muted">No jobs yet.</p>}
      </section>

      <div className="card more">
        <Disclosure title="Technical detail" desc="Jobs and source runs, as stored">
          <h3>Jobs</h3>
          {!s.jobs.length ? <p className="muted">No jobs yet.</p> : (
            <div className="scroll"><table>
              <thead><tr><th className="num">Id</th><th>Kind</th><th>Status</th><th>By</th><th>Queued</th><th>Finished</th><th>Result</th></tr></thead>
              <tbody>{s.jobs.map((j) => (
                <tr key={j.id}><td className="num">{j.id}</td><td className="mono">{j.kind}</td><td>{j.status}</td><td className="small">{j.requested_by}</td><td className="small">{when(j.created_at)}</td><td className="small">{when(j.finished_at)}</td><td className="small mono">{j.result ? JSON.stringify(j.result).slice(0, 160) : ''}</td></tr>
              ))}</tbody>
            </table></div>
          )}
          <h3>Source runs</h3>
          {!s.runs.length ? <p className="muted">No runs yet.</p> : (
            <div className="scroll"><table>
              <thead><tr><th>Run</th><th>Source</th><th>Outcome</th><th className="num">Rows read</th><th className="num">Written</th><th className="num">Changed</th><th>Notes</th></tr></thead>
              <tbody>{s.runs.map((r, i) => (
                <tr key={r.runId ?? i}><td className="small mono">{r.runId}</td><td className="small">{sourceLabel(r.source)}</td><td>{r.outcome}</td><td className="num">{r.rowsRead ?? '–'}</td><td className="num">{r.rowsWritten ?? '–'}</td><td className="num">{r.rowsChanged ?? '–'}</td><td className="small">{[...(r.missingFields ?? []).map((f) => `missing ${f}`), ...(r.notes ?? [])].join(' · ')}</td></tr>
              ))}</tbody>
            </table></div>
          )}
          {edgar.lastRun ? <p className="small muted">Last EDGAR run: <span className="mono">{edgar.lastRun}</span></p> : null}
        </Disclosure>
      </div>
      {outcomes}
    </div>
  );
}
