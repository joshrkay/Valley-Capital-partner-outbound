// Small server components shared by the pages. Every value is rendered as text; nothing here injects HTML.
import { readFlash } from '../lib/session.mjs';
import { parseMarkdown } from '../lib/markdown.mjs';
import { source } from '../lib/format.mjs';
import { CONTEXT_ONLY } from '../lib/servicers.mjs';

export async function Flash() {
  const f = await readFlash();
  if (!f?.text) return null;
  return <div className={`banner ${f.kind === 'ok' ? 'ok' : 'error'}`} role="status">{f.text}</div>;
}

// Always visible on any page that shows loan or property detail (asset-level facts never go in a message).
export function ContextOnlyBanner() {
  return <div className="banner warn context-only" role="note">{CONTEXT_ONLY}</div>;
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

// A number with its FDIC source next to it (and on hover).
export function Sourced({ children, input }) {
  const s = source(input);
  return <span title={s || undefined}>{children}{s ? <span className="src">{s}</span> : null}</span>;
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
