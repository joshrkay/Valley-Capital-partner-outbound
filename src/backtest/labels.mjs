// The backtest's labels (PRD E17-S2): dated events from sources the score does not read as features, so the backtest never grades the
// score on its own inputs. Written to backtest/labels.json in the data folder, with a run-log line and the change log (E2).
//
// Label kinds (decision D-B2, placeholders in config.backtest.labelKinds):
//   failure          the bank failed: sources/fdic/failed.json (E3-S5) and the panel's own window pull, from all three FDIC sources;
//   assisted_merger  the bank was sold in an FDIC-assisted merger (code 213): sources/fdic/events.json and the panel's events;
//   fdic_loan_sale   an FDIC loan-sale announcement whose receivership matched the bank (E16-S2, sources/fdic/sales.json);
//   disclosed_sale   a CRE loan sale the bank disclosed in an SEC filing. OFF, and reported as unavailable: it needs the SEC contact
//                    (Q11) and confirmed filers, and a hit counts only once a principal has read the filing and recorded that the bank
//                    sold. An 8-K Item 2.01 hit is never a label on its own: the bank may have bought (E16-S3);
//   merger           an ordinary merger: off unless a principal lists it, since counting every merger would reward size;
//   enforcement_order  a formal order against the bank (consent order, cease and desist, written agreement, PCA directive) from the Federal
//                    Reserve's, the FDIC's or the OCC's published lists (E18-S2). Off by default (D-B2 lists the default kinds); a principal adds it
//                    to config.backtest.labelKinds. Scoring gives enforcement signals but no points (D-E1), so the label does not grade the score
//                    on its own inputs. An order matches a bank only by name, in today's institution list, so a bank that failed or closed
//                    is usually not matched: this kind under-counts the banks that went under.
// A bank with no label is unlabelled, not safe. Nothing here calls it a negative.
import { readJson, writeJson, appendJsonl } from '../store.mjs';
import { startRun, finishRun, CHANGES, scrub } from '../sources/runlog.mjs';
import { fdicPaths, FDIC_BASE } from '../sources/fdic.mjs';
import { fdicSalesPaths } from '../sources/fdicsales.mjs';
import { loadFilers, confirmedCiks } from '../sources/filers.mjs';
import { METRICS, CATEGORIES } from '../metrics.mjs';
import { backtestPaths } from './panel.mjs';
import { ordersByBank, ACTIVE_TYPES } from '../sources/enforcement.mjs';

// What each kind is read from: the stored files and the source fields its date and bank come from. The leakage test checks these
// against every field a scoring.json component reads (componentFields).
export const LABEL_KINDS = Object.freeze({
  failure: { title: 'Failure', reads: ['sources/fdic/failed.json', 'backtest/panel/failed.json'], fields: ['FAILDATE', 'RESTYPE', 'CHANGEC1', 'ENDEFYMD', 'CHANGECODE', 'EFFDATE', 'OUT_CERT', 'TRANSNUM'], built: true },
  assisted_merger: { title: 'Assisted merger', reads: ['sources/fdic/events.json', 'backtest/panel/events.json'], fields: ['CHANGECODE', 'EFFDATE', 'OUT_CERT', 'ACQ_CERT', 'TRANSNUM'], built: true },
  fdic_loan_sale: { title: 'FDIC loan sale', reads: ['sources/fdic/sales.json'], fields: ['saleId', 'announcedOn', 'eventDates', 'keyDates', 'receiverships'], built: true },
  disclosed_sale: { title: 'Disclosed sale', reads: ['sources/edgar/filings.json'], fields: ['fileDate', 'form', 'items', 'searches'], built: false },
  merger: { title: 'Ordinary merger', reads: ['sources/fdic/events.json', 'backtest/panel/events.json'], fields: ['CHANGECODE', 'EFFDATE', 'OUT_CERT', 'ACQ_CERT', 'TRANSNUM'], built: true },
  enforcement_order: { title: 'Enforcement order', reads: ['sources/enforcement/orders.json', 'sources/enforcement/fdic-orders.json', 'sources/enforcement/occ-orders.json'], fields: ['date', 'type', 'regulator', 'sourceId', 'link', 'parties'], built: true },
});
export const DEFAULT_KINDS = Object.freeze(['failure', 'assisted_merger', 'disclosed_sale', 'fdic_loan_sale']);
export const UNLABELLED = 'A bank with no label is unlabelled, not safe: public sources miss many real sales and much real pressure, so an unlabelled bank may have sold, or been under pressure, without a public record.';
const EVENT_KIND = { 'assisted-merger': 'assisted_merger', merger: 'merger' };
const FAILURE_LINKS = {
  failures: (cert) => ({ source: 'fdic:/failures', ids: [cert], link: `${FDIC_BASE}/failures?filters=CERT:${cert}` }),
  institutions: (cert) => ({ source: 'fdic:/institutions', ids: [cert], link: `${FDIC_BASE}/institutions?filters=CERT:${cert}` }),
  history: (cert, s) => ({ source: 'fdic:/history', ids: [String(s.transnum ?? cert)], link: s.transnum ? `${FDIC_BASE}/history?filters=TRANSNUM:${s.transnum}` : `${FDIC_BASE}/history?filters=OUT_CERT:${cert}` }),
  csv: (cert) => ({ source: 'fdic:failed-bank-csv', ids: [cert], link: 'https://www.fdic.gov/bank-failures/download-data.csv' }),
};
const ISO = /^\d{4}-\d{2}-\d{2}$/;
// Where an order with no document of its own is listed, so every label's source has a link.
const ORDER_LISTS = { frb: 'https://www.federalreserve.gov/supervisionreg/enforcementactions.htm', fdic: 'https://orders.fdic.gov/s/', occ: 'https://apps.occ.gov/EASearch' };

// Every Call Report or Summary of Deposits field a scoring.json component reads: a label kind may derive from none of them.
export function componentFields(scoring) {
  const out = new Set();
  for (const c of scoring?.components ?? []) {
    if (c.source === 'footprint') { out.add('DEPSUMBR'); out.add('DEPSUM'); continue; }
    if (c.source === 'profile') { for (const cat of CATEGORIES) { out.add(cat.balance); out.add(cat.stages.noncurrent); } out.add('LNLSNET'); continue; }
    for (const f of [...(METRICS[c.metric]?.num ?? []), ...(METRICS[c.metric]?.den ?? [])]) out.add(f);
  }
  return out;
}

// disclosed_sale is unavailable in this pass. The reasons say what it waits for, so the report lists it rather than leaving it out.
export function disclosedSaleStatus({ dir, config }) {
  const reasons = [];
  const ua = String(config?.sec?.userAgent ?? '');
  if (!ua.trim() || /\[confirm/i.test(ua)) reasons.push('It needs the SEC contact: config.sec.userAgent is a [CONFIRM] placeholder until a principal fills it (PRD Q11).');
  if (!confirmedCiks(loadFilers(dir)).size) reasons.push('It needs confirmed filers: no bank has a confirmed SEC filer yet (outbound filers confirm).');
  reasons.push('A filing hit becomes a label only once a principal has read the filing and recorded that the bank sold; an 8-K Item 2.01 hit is never a label on its own, since the bank may have bought. That review, and the search over the window (outbound backtest labels --filings), are not built in this pass.');
  return { available: false, reasons };
}

export const secFilerKeys = (dir) => [...new Set([...confirmedCiks(loadFilers(dir)).values()].flatMap((s) => [...s]))].sort();

function validate(l) {
  const e = [];
  if (!/^fdic:\d+$/.test(String(l.key ?? ''))) e.push('key must be fdic:CERT');
  if (!LABEL_KINDS[l.kind]) e.push(`unknown kind ${l.kind}`);
  if (!ISO.test(String(l.date ?? ''))) e.push('date must be YYYY-MM-DD');
  if (!Array.isArray(l.sources) || !l.sources.length) e.push('at least one source');
  for (const s of l.sources ?? []) if (!s?.source || !Array.isArray(s.ids) || !s.ids.length || typeof s.link !== 'string' || !ISO.test(String(s.date ?? ''))) e.push('each source needs source, ids, link and a YYYY-MM-DD date');
  return e;
}

export function buildLabels({ dir, config, filings = false, now = new Date(), clock = () => new Date() }) {
  const cfg = config?.backtest ?? {};
  const wanted = cfg.labelKinds ?? DEFAULT_KINDS;
  const unknown = wanted.filter((k) => !LABEL_KINDS[k]);
  if (unknown.length) throw new Error(`config.backtest.labelKinds: unknown kind(s) ${unknown.join(', ')} (known: ${Object.keys(LABEL_KINDS).join(', ')}).`);
  const ds = disclosedSaleStatus({ dir, config });
  if (filings) throw new Error(`disclosed_sale is unavailable, so outbound backtest labels --filings does not run:\n  ${ds.reasons.join('\n  ')}`);
  const on = new Set(wanted.filter((k) => LABEL_KINDS[k].built));
  const bp = backtestPaths(dir), fp = fdicPaths(dir);
  const run = startRun({ source: 'backtest-labels', query: { kinds: [...on].sort() }, now });
  const notes = [];
  let rowsRead = 0;
  try {
    const panelState = readJson(bp.state, null);
    const labels = [];
    if (on.has('failure')) {
      const live = readJson(fp.failed, {}), panel = readJson(bp.failed, {});
      rowsRead += Object.keys(live).length + Object.keys(panel).length;
      for (const cert of [...new Set([...Object.keys(live), ...Object.keys(panel)])].sort((a, b) => a - b)) {
        const a = panel[cert], b = live[cert];
        const date = a?.failedOn ?? b?.failedOn ?? null;
        const srcs = (k) => a?.sources?.[k] ?? b?.sources?.[k] ?? null;
        const sources = ['failures', 'institutions', 'history', 'csv'].filter((k) => srcs(k)).map((k) => ({ ...FAILURE_LINKS[k](String(cert), srcs(k)), date: srcs(k).on ?? date }));
        labels.push({ id: `failure:fdic:${cert}`, key: `fdic:${cert}`, kind: 'failure', date, sources });
      }
    }
    if (on.has('assisted_merger') || on.has('merger')) {
      const events = { ...readJson(fp.events, {}), ...readJson(bp.events, {}) };
      rowsRead += Object.keys(events).length;
      for (const e of Object.values(events).sort((x, y) => String(x.transnum).localeCompare(String(y.transnum)))) {
        const kind = EVENT_KIND[e?.kind];
        if (!kind || !on.has(kind)) continue;
        labels.push({ id: `${kind}:fdic:${e.targetCert}:${e.transnum}`, key: `fdic:${e.targetCert}`, kind, date: e.effective ?? null,
          sources: [{ source: 'fdic:/history', ids: [String(e.transnum)], link: `${FDIC_BASE}/history?filters=TRANSNUM:${e.transnum}`, date: e.effective ?? null }] });
      }
    }
    if (on.has('fdic_loan_sale')) {
      const sales = readJson(fdicSalesPaths(dir).sales, {});
      rowsRead += Object.keys(sales).length;
      for (const s of Object.values(sales)) {
        const date = s?.announcedOn ?? s?.eventDates?.start ?? s?.keyDates?.bidDeadline ?? null;
        for (const r of s?.receiverships ?? []) {
          if (!r?.key) continue;
          labels.push({ id: `fdic_loan_sale:${r.key}:${s.saleId}`, key: r.key, kind: 'fdic_loan_sale', date, sources: [{ source: 'fdicsales', ids: [String(s.saleId)], link: s.page, date }] });
        }
      }
    }
    if (on.has('enforcement_order')) {
      for (const [bank, list] of [...ordersByBank({ dir })].sort(([x], [y]) => x.localeCompare(y))) {
        if (!/^fdic:\d+$/.test(bank)) continue;
        for (const r of list) {
          if (r.kind !== 'order' || !ACTIVE_TYPES.includes(r.type) || !ISO.test(String(r.date ?? ''))) continue;
          rowsRead++;
          labels.push({ id: `enforcement_order:${bank}:${r.key}`, key: bank, kind: 'enforcement_order', date: r.date,
            sources: [{ source: `enforcement:${r.regulator}`, ids: [String(r.sourceId ?? r.key)], link: r.link ?? ORDER_LISTS[r.regulator] ?? ORDER_LISTS.frb, date: r.date }] });
        }
      }
    }
    const invalid = labels.map((l) => [l.id, validate(l)]).filter(([, e]) => e.length);
    if (invalid.length) {
      const errors = [`${invalid.length} label(s) failed the field check; nothing was written: ${invalid.slice(0, 10).map(([id, e]) => `${id}: ${e.join('; ')}`).join(' | ')}`];
      const line = finishRun(dir, run, { rowsRead, outcome: 'failed', errors, notes, now: clock() });
      return { runId: run.runId, outcome: line.outcome, errors: line.errors, labels: 0 };
    }
    labels.sort((x, y) => x.date.localeCompare(y.date) || x.id.localeCompare(y.id));

    // The change log: a label whose date moved, or that is gone, since the last build. A new label is an insert, as in E2.
    const prev = readJson(bp.labels, null);
    let changed = 0;
    if (prev) {
      const nowById = new Map(labels.map((l) => [l.id, l]));
      for (const o of prev.labels ?? []) {
        const n = nowById.get(o.id);
        if (n && n.date === o.date) continue;
        appendJsonl(CHANGES(dir), scrub({ runId: run.runId, key: o.key, field: `label:${o.kind}`, old: o.date, new: n?.date ?? null, at: now.toISOString() }));
        changed++;
      }
    }

    // The date through which the label sources are complete: their latest pull, never after this build.
    const pulled = [panelState?.pulledAt, readJson(fp.state, null)?.checkedAt].filter(Boolean).map((t) => String(t).slice(0, 10)).sort().at(-1);
    const today = now.toISOString().slice(0, 10);
    const labelsAsOf = pulled && pulled < today ? pulled : today;
    const count = (k) => labels.filter((l) => l.kind === k).length;
    const kinds = Object.fromEntries(Object.entries(LABEL_KINDS).map(([k, def]) => {
      if (k === 'disclosed_sale') return [k, { status: 'unavailable', listed: wanted.includes(k), labels: 0, reasons: ds.reasons }];
      if (!def.built) return [k, { status: 'unavailable', listed: wanted.includes(k), labels: 0, reasons: ['Not built.'] }];
      return [k, on.has(k) ? { status: 'on', labels: count(k) } : { status: 'off', labels: 0, reasons: [k === 'merger' ? 'Ordinary mergers are not labels by default: a merger may follow pressure or may not, and counting every one would reward size (D-B2).' : k === 'enforcement_order' ? 'Built, and off until a principal adds enforcement_order to config.backtest.labelKinds: the default kinds were decided on 2026-11-14 without it. It matches orders to banks in today\'s list by name, so it under-counts banks that failed.' : 'Not listed in config.backtest.labelKinds.'] }];
    }));
    const secFilers = secFilerKeys(dir);
    writeJson(bp.labels, {
      runId: run.runId, builtAt: now.toISOString(), labelsAsOf, panelRunId: panelState?.runId ?? null, kinds, labels,
      coverage: { secFilers, note: 'Banks with a confirmed SEC filer today (sources/edgar/filers.json): every label kind could be observed for them. For the others only the FDIC kinds can. The report shows the two apart.' },
      unlabelled: UNLABELLED,
    });
    notes.push(`labels: ${labels.length} (${[...on].map((k) => `${k} ${count(k)}`).join(', ')}); ${secFilers.length} bank(s) with a confirmed SEC filer; complete through ${labelsAsOf}`);
    const line = finishRun(dir, run, { rowsRead, rowsWritten: labels.length, rowsChanged: changed, outcome: 'ok', notes, now: clock() });
    return { runId: run.runId, outcome: line.outcome, labels: labels.length, byKind: Object.fromEntries([...on].map((k) => [k, count(k)])), labelsAsOf, changed, notes };
  } catch (e) {
    const line = finishRun(dir, run, { rowsRead, outcome: 'failed', errors: [e.message], notes, now: clock() });
    return { runId: run.runId, outcome: line.outcome, errors: line.errors, labels: 0 };
  }
}

export const readLabels = (dir) => readJson(backtestPaths(dir).labels, null);
