// Server only. The Calibration page's read (PRD next-five E17-S5): the backtest's stored reports, through a unit of work as the signed-in
// principal, with the engine's own reader (src/backtest/run.mjs readReport). Read-only: it runs no backtest, queues nothing and writes
// nothing. Two narrow loads: the run log (LOADS.calibration), which names every stored report and the latest, then the one report shown
// (calibrationLoads). Never the panel or the labels.
import { join } from 'node:path';
import { engine } from './engine.mjs';

// hash: a report a principal chose from the list; absent, the latest. A string that is not a report hash never becomes part of a path.
export async function calibrationOverview(client, { hash } = {}) {
  const [uow, run, store] = await Promise.all(['src/uow.mjs', 'src/backtest/run.mjs', 'src/store.mjs'].map(engine));
  const asked = typeof hash === 'string' && hash.trim() ? hash.trim() : null;
  const valid = asked && run.REPORT_HASH.test(asked) ? asked : null;
  const read = (h) => client.unitOfWork(h ? uow.calibrationLoads(h) : uow.LOADS.calibration, (dir) => ({
    runs: store.readJsonl(join(dir, 'backtest', 'runs.jsonl')).filter((l) => run.REPORT_HASH.test(String(l?.reportHash ?? ''))),
    report: h ? run.readReport({ dir, hash: h }) : null,
  }));
  if (asked && !valid) {
    const { result } = await read(null);
    return { runs: result.runs, report: null, notice: `"${asked.slice(0, 40)}" is not a report hash (16 hexadecimal characters). Choose one from the list below.` };
  }
  if (valid) {
    const { result } = await read(valid);
    return { runs: result.runs, report: result.report, notice: result.report ? null : `Report ${valid} is not stored. Choose one from the list below.` };
  }
  // The latest, as `outbound backtest report` finds it: the last line of the run log.
  const { result: first } = await read(null);
  const latest = first.runs.at(-1)?.reportHash ?? null;
  if (!latest) return { runs: first.runs, report: null, notice: null };
  const { result } = await read(latest);
  return { runs: result.runs, report: result.report, notice: result.report ? null : `The run log names report ${latest} as the latest, but it is not stored on the platform. Copy the data folder in again (outbound platform push).` };
}
