// The bank page's main column (docs/design-redesign.md, 5.3), rendered from the candidate item and the paper record the scoring run wrote
// (paper/fdic-<CERT>.json). A server component with no client script: the tabs are links (?tab=...) rendered on the server, and "Show FDIC
// field codes" is a checkbox that one CSS rule reads. Nothing is computed here; the sections come from lib/bank-view.mjs.
// Section order, top to bottom across the tabs: the short answer, why now, what it holds, how much could we buy, more detail, what to ask for.
import { TABS } from '../../../lib/bank-view.mjs';
import { Answer, WhyNow } from './answer.jsx';
import { Holdings } from './holdings.jsx';
import { FitRanges } from './fit-ranges.jsx';
import { MoreDetail } from './more-detail.jsx';
import { AskFor } from './ask-for.jsx';

export default function PaperEstimate({ item, paper, tab, href, max }) {
  return (
    <div className="card rec-main">
      <div className="tabs-row">
        <nav className="tabs" aria-label="Bank sections">
          {TABS.map(([k, label]) => <a key={k} href={k === 'overview' ? href : `${href}?tab=${k}`} aria-current={k === tab ? 'page' : undefined}>{label}</a>)}
        </nav>
        <label className="check codes-toggle" htmlFor="codes"><input type="checkbox" id="codes" /> Show FDIC field codes</label>
      </div>
      <div className="tab-panel">
        {tab === 'overview' ? <><Answer item={item} paper={paper} /><WhyNow item={item} paper={paper} /></> : null}
        {tab === 'holdings' ? <Holdings item={item} paper={paper} /> : null}
        {tab === 'fit' ? <FitRanges paper={paper} /> : null}
        {tab === 'details' ? <><MoreDetail item={item} paper={paper} max={max} /><AskFor paper={paper} /></> : null}
      </div>
    </div>
  );
}
