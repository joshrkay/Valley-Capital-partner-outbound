// A bank's record page (docs/design-redesign.md, 4.1 and 5.3): the sticky internal notice, the highlights panel, the stage path, the tabbed
// main column and the sidebar of related lists, then one note on what the numbers are. A server component with no data of its own.
import { stageOf, aboutDate } from '../../../lib/bank-view.mjs';
import { axisMax } from '../../../lib/candidates-view.mjs';
import { InternalNotice, Basis } from '../../ui.jsx';
import { Highlights, StagePath } from './highlights.jsx';
import PaperEstimate from './paper-estimate.jsx';
import { Sidebar } from './sidebar.jsx';

export default function BankRecord({ item, paper, decision, suppressed, route, tab, scoring, isNew = false, inConversation = false }) {
  const href = `/candidates/${encodeURIComponent(item.key)}`;
  const stage = stageOf({ decision, excluded: item.filtersFailed ?? [], suppressed, inConversation });
  return (
    <>
      <InternalNotice paper who={item.name} />
      <div className="page">
        <Highlights item={item} paper={paper} route={route} decision={decision} suppressed={suppressed} isNew={isNew} />
        <StagePath stage={stage} />
        <div className="rec-grid">
          <PaperEstimate item={item} paper={paper} tab={tab} href={href} max={axisMax(scoring)} />
          <Sidebar item={item} paper={paper} route={route} scoring={scoring} href={href} />
        </div>
        <div className="card about">
          <p>Figures without a mark are what the bank reported to the FDIC{aboutDate(paper, item) ? ` for the quarter ending ${aboutDate(paper, item)}` : ''}. Figures marked <Basis tier="inferred" /> are ranges built from reported shares or a stand-in. A date appears beside a figure only when it differs. This is an estimate from public reports, not the loan tape.</p>
          <span className="xs">{paper?.runId ? `From the scoring run ${paper.runId}` : 'No paper estimate yet: the next scoring run writes one'}</span>
        </div>
      </div>
    </>
  );
}
