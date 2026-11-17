// Small server components shared by the pages. Every value is rendered as text; nothing here injects HTML.
import { readFlash } from '../lib/session.mjs';
import { parseMarkdown } from '../lib/markdown.mjs';
import { source } from '../lib/format.mjs';
import { CONTEXT_ONLY } from '../lib/servicers.mjs';
import { PAPER_CONTEXT, show, basisLabel, fieldCodes, dateOf } from '../lib/paper-view.mjs';
import { priorityOf } from '../lib/candidates-view.mjs';
import { glossaryHref } from '../lib/glossary.mjs';
import { Icon, Tile } from './icons.jsx';

export async function Flash() {
  const f = await readFlash();
  if (!f?.text) return null;
  return <div className={`banner ${f.kind === 'ok' ? 'ok' : 'error'}`} role="status">{f.text}</div>;
}

// Always visible on any page that shows loan or property detail (asset-level facts never go in a message).
export function ContextOnlyBanner() {
  return <div className="banner warn context-only" role="note">{CONTEXT_ONLY}</div>;
}

// The same rule as one slim bar that stays under the header while the page scrolls: CONTEXT_ONLY always, and PAPER_CONTEXT on pages that
// show the paper estimate. `who` names the bank the page is about.
export function InternalNotice({ paper = false, who = null }) {
  return (
    <div className="internal" role="note">
      <div className="wrap">
        <span><Icon name="warn" /><strong>Internal.</strong> {paper ? `${PAPER_CONTEXT} ` : ''}{CONTEXT_ONLY}</span>
        {who ? <span className="who">{who}</span> : null}
      </div>
    </div>
  );
}

export function Problem({ text }) {
  return <div className="banner error" role="alert">{text}</div>;
}

export function NotAuthorized({ email }) {
  return (
    <div className="panel">
      <h1>Not authorized</h1>
      <p>{email} is signed in but is not an active principal of the firm, so the platform shows nothing. An operator adds principals.</p>
      <form method="post" action="/auth/signout"><button type="submit">Sign out</button></form>
    </div>
  );
}

// A number with its FDIC source as a hidden code line, shown by the "Show FDIC field codes" switch.
export function Sourced({ children, input }) {
  const s = source(input);
  return <span>{children}{s ? <span className="code">{s}</span> : null}</span>;
}

// A chip: priority, status, "New this week".
export function Chip({ kind = '', children }) {
  return <span className={`chip${kind ? ` ${kind}` : ''}`}>{children}</span>;
}

// A bank's priority (was its tier): Call first (A), Worth a look (B), Not ranked, or Excluded.
export function Priority({ tier, excluded = false }) {
  const p = priorityOf({ tier, filtered: excluded });
  return <span className={`chip ${p.cls}`}>{p.letter ? <span className="letter" aria-hidden="true">{p.letter}</span> : null}{p.label}</span>;
}

// A colored note, only where a principal must act or should know: info, good, warn, bad.
export function Note({ tone = 'info', role, children }) {
  return <div className={`note ${tone}`} role={role}>{children}</div>;
}

// A dotted term that opens the glossary at its entry.
export function Term({ id, children }) {
  return <a className="term" href={glossaryHref(id)}>{children}</a>;
}

// The basis mark beside a figure: nothing for reported, "Seen loan by loan" for observed, "Estimate" for inferred.
export function Basis({ tier }) {
  const b = basisLabel(tier);
  return b ? <span className={`basis${b === 'Estimate' ? ' est' : ''}`}>{b}</span> : null;
}

// A paper-estimate value: the figure (or its gap, never a zero), an Estimate mark when inferred, its date only when it differs from the
// page's date, and its FDIC field codes as a hidden line.
export function Value({ v, pageDate = null }) {
  const s = show(v);
  if (s.gap) return <span className="muted">{s.text.charAt(0).toUpperCase() + s.text.slice(1)}</span>;
  const own = v?.asOf && pageDate && v.asOf !== pageDate && !v.period ? dateOf(v.asOf) : '';
  const codes = fieldCodes(v);
  return <span>{s.text} <Basis tier={v?.tier} />{own ? <span className="muted small"> ({own})</span> : null}{codes ? <span className="code">{codes}</span> : null}</span>;
}

// A disclosure in the house style: a native <details>, so pages stay server components.
export function Disclosure({ title, desc = null, id, open = false, children }) {
  return (
    <details className="acc" id={id} open={open || undefined}>
      <summary><span className="t">{title}</span>{desc ? <span className="d">{desc}</span> : null}</summary>
      <div className="acc-body">{children}</div>
    </details>
  );
}

// A page's header card: its tile, eyebrow, title, one line of purpose, and its actions.
export function PageHead({ icon, tone, eyebrow, title, lede = null, actions = null }) {
  return (
    <div className="card page-hd">
      <Tile icon={icon} tone={tone} />
      <div className="page-hd-t">
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
        {lede ? <p className="lede">{lede}</p> : null}
      </div>
      {actions ? <div className="btn-group">{actions}</div> : null}
    </div>
  );
}

function Spans({ spans }) {
  return spans.map((s, i) => {
    if (s.t === 'bold') return <strong key={i}>{s.v}</strong>;
    if (s.t === 'code') return <code key={i}>{s.v}</code>;
    if (s.t === 'link') return <a key={i} href={s.href} rel="noopener noreferrer nofollow" target="_blank">{s.v}</a>;
    return <span key={i}>{s.v}</span>;
  });
}

export function Markdown({ text }) {
  return (
    <div className="brief">
      {parseMarkdown(text).map((b, i) => {
        if (b.t === 'ul') return <ul key={i}>{b.items.map((spans, j) => <li key={j}><Spans spans={spans} /></li>)}</ul>;
        if (b.t === 'p') return <p key={i}><Spans spans={b.spans} /></p>;
        const H = b.t;
        return <H key={i}><Spans spans={b.spans} /></H>;
      })}
    </div>
  );
}
