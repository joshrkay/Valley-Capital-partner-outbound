// The glossary: every plain label the app uses, with the old term it replaced and what it means (docs/design-redesign.md, section 6).
// Static, from lib/glossary.mjs; a dotted term on any page links here at its entry.
import { GLOSSARY } from '../../lib/glossary.mjs';
import { PageHead } from '../ui.jsx';

export const metadata = { title: 'Glossary · Valley Capital outbound' };

export default function Glossary() {
  return (
    <div className="page">
      <PageHead icon="book" tone="t-set" eyebrow="Help" title="Glossary" lede="Plain names used across the app. Where a name changed, the old one is shown beside it." />
      <section className="card gloss" aria-label="Terms">
        <div className="card-body">
          <dl>
            {GLOSSARY.map((e) => (
              <div key={e.id}>
                <dt id={e.id}>{e.term}{e.was && e.was !== e.term ? <span className="was">was: {e.was}</span> : null}</dt>
                <dd>{e.meaning}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>
    </div>
  );
}
