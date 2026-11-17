// Charts drawn on the server as SVG: no library, no script, colors from the tokens in globals.css. They plot stored figures only; the
// arithmetic here is geometry (where a point or a bar goes), never a new figure.
import { rangeAxis } from '../lib/bank-view.mjs';

const pctLabel = (v, step) => `${(v * 100).toFixed(step * 100 < 1 ? 1 : 0)}%`;
const pct1 = (v) => `${(v * 100).toFixed(1)}%`;

// A share over the last quarters as a line with a shaded area. A point with no value (a gap the record names) breaks the line; it is
// never drawn as zero. The label at the end is the latest value.
export function TrendChart({ series, label, width = 360, height = 170 }) {
  const values = series.map((p) => p.value).filter((v) => v !== null);
  if (!values.length) return null;
  const padL = 38, padR = 46, padT = 14, padB = 26;
  const { top: rawTop, ticks } = rangeAxis([Math.max(...values) * 1.1 || 0.01]);
  const top = rawTop || 0.01;
  const step = ticks[1] ?? top;
  const n = series.length;
  const x = (i) => padL + (n === 1 ? (width - padL - padR) / 2 : (i * (width - padL - padR)) / (n - 1));
  const y = (v) => padT + (height - padT - padB) * (1 - v / top);
  const runs = [];
  let run = [];
  series.forEach((p, i) => { if (p.value === null) { if (run.length) runs.push(run); run = []; } else run.push([x(i), y(p.value)]); });
  if (run.length) runs.push(run);
  const line = runs.map((r) => `M${r.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join(' L')}`).join(' ');
  const area = runs.filter((r) => r.length > 1).map((r) => `M${r[0][0].toFixed(1)},${y(0).toFixed(1)} L${r.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join(' L')} L${r.at(-1)[0].toFixed(1)},${y(0).toFixed(1)} Z`).join(' ');
  const lastIdx = series.map((p) => p.value !== null).lastIndexOf(true);
  const last = series[lastIdx];
  const xl = [...new Set([0, Math.floor((n - 1) / 2), n - 1])];
  const desc = series.map((p) => `${p.label}: ${p.value === null ? 'no value' : pct1(p.value)}`).join(', ');
  return (
    <svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${label}. ${desc}.`}>
      {ticks.map((v) => (
        <g key={v}>
          <line className="grid" x1={padL} x2={width - padR} y1={y(v)} y2={y(v)} />
          <text x={padL - 6} y={y(v) + 4} textAnchor="end">{pctLabel(v, step)}</text>
        </g>
      ))}
      {area ? <path className="area" d={area} /> : null}
      <path className="ln" d={line} />
      {series.map((p, i) => (p.value === null ? <text key={`gap-${i}`} x={x(i)} y={y(0) - 4} textAnchor="middle" className="gaplabel">no value</text> : null))}
      <circle className="end" cx={x(lastIdx)} cy={y(last.value)} r="4.5" />
      <text className="endlabel" x={x(lastIdx) + 8} y={y(last.value) + 4}>{pct1(last.value)}</text>
      {xl.map((i) => <text key={i} x={x(i)} y={height - 6} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}>{series[i].short}</text>)}
    </svg>
  );
}

// One buy-box range on a shared axis: solid when it rests on reported shares, hatched for an estimate, with the $0 floor drawn as a line.
export function RangeBar({ id, low, high, top, estimate, label }) {
  const lo = Math.max(0, Math.min(100, (low / top) * 100));
  const w = Math.max(0.6, Math.min(100 - lo, ((high - low) / top) * 100));
  return (
    <svg className="rangebar" width="100%" height="22" role="img" aria-label={label}>
      {estimate ? (
        <defs>
          <pattern id={`hatch-${id}`} width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect className="rb-fill" width="5" height="9" /></pattern>
        </defs>
      ) : null}
      <rect className="rb-base" x="0" y="10" width="100%" height="2" />
      <rect className={estimate ? 'rb-est' : 'rb-fill'} x={`${lo}%`} y="4" width={`${w}%`} height="14" rx="3" fill={estimate ? `url(#hatch-${id})` : undefined} />
      {low === 0 ? <rect className="rb-floor" x="0" y="1" width="2" height="20" /> : null}
    </svg>
  );
}
