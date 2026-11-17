'use client';
// The call desk's only client code: a text size control for the script and a stopwatch to time a read. Neither makes, plays or records
// any sound, and neither stores anything: a principal reads the script aloud on their own call and times themselves.
import { useEffect, useRef, useState } from 'react';

const SIZES = [1.1, 1.4, 1.8, 2.3];   // rem

export function Prompter({ children }) {
  const [i, setI] = useState(1);
  return (
    <div>
      <div className="row small mb8">
        <button type="button" className="secondary" disabled={i === 0} onClick={() => setI((n) => Math.max(0, n - 1))} aria-label="Smaller text">A−</button>
        <button type="button" className="secondary" disabled={i === SIZES.length - 1} onClick={() => setI((n) => Math.min(SIZES.length - 1, n + 1))} aria-label="Larger text">A+</button>
      </div>
      <div className="prompter" style={{ fontSize: `${SIZES[i]}rem` }}>{children}</div>
    </div>
  );
}

export function Stopwatch({ target, limit }) {
  const [ms, setMs] = useState(0);
  const [running, setRunning] = useState(false);
  const began = useRef(0);   // the clock time the current run would have started at, so a stop and a restart carry on
  useEffect(() => {
    if (!running) return undefined;
    const t = setInterval(() => setMs(Date.now() - began.current), 100);
    return () => clearInterval(t);
  }, [running]);
  const toggle = () => {
    if (running) { setMs(Date.now() - began.current); setRunning(false); } else { began.current = Date.now() - ms; setRunning(true); }
  };
  const reset = () => { setRunning(false); setMs(0); };
  const s = ms / 1000;
  const state = s > limit ? 'error' : s > target ? 'warn' : 'ok';
  return (
    <div className={`banner ${state} stopwatch`} role="timer" aria-live="off">
      <span className="mono clock">{s.toFixed(1)}s</span>
      <span className="small"> of about {target}s. {s > limit ? 'Too long to leave on a voicemail.' : s > target ? 'A little long.' : 'Within the target.'}</span>
      <span className="row mt6">
        <button type="button" onClick={toggle}>{running ? 'Stop' : ms ? 'Resume' : 'Start'}</button>
        <button type="button" className="secondary" onClick={reset} disabled={!ms && !running}>Reset</button>
      </span>
    </div>
  );
}
