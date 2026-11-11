/** Small, dependency-free SVG charts following the GMS chart rules:
 *  thin marks with rounded data ends, one axis, recessive grid, hover tooltips,
 *  legend for ≥2 series, and a table fallback via aria labels.
 *  Colour: rubber ink leads, chalk grey supports, and the gym's brand marks the one
 *  bar or point that matters (the current month, today). Charts draw at their real
 *  width so axis labels stay at 11px instead of shrinking with the SVG. */
import React, { useEffect, useRef, useState } from "react";
import { money } from "./i18n.ts";

type Tip = { x: number; y: number; text: string } | null;

function Tooltip({ tip }: { tip: Tip }) {
  if (!tip) return null;
  return <div className="chart-tip" style={{ left: tip.x + 12, top: tip.y - 30 }}>{tip.text}</div>;
}

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

/** Width of the chart's box in CSS pixels, so the SVG is drawn 1:1. */
function useWidth(fallback = 640) {
  const ref = useRef<HTMLElement>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** Grouped bars (1–2 series) on one axis, e.g. revenue vs expenses per month.
 *  `highlight` is the index whose first-series bar takes the accent (e.g. this month). */
export function Bars({ labels, series, height = 220, format = (n: number) => money(n), title, highlight }: {
  labels: string[];
  series: { name: string; values: number[]; color: string }[];
  height?: number;
  format?: (n: number) => string;
  title: string;
  highlight?: number;
}) {
  const [tip, setTip] = useState<Tip>(null);
  const [ref, W] = useWidth();
  const H = height, padL = 56, padB = 28, padT = 8;
  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values)));
  const band = (W - padL) / labels.length;
  const gap = 3;
  const barW = Math.max(3, Math.min(20, (band * 0.6 - gap * (series.length - 1)) / series.length));
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / max);
  const ticks = [0, 0.5, 1].map((f) => f * max);
  const every = band < 28 ? Math.ceil(28 / band) : 1;
  return (
    <figure ref={ref as React.RefObject<HTMLElement & HTMLDivElement>} style={{ margin: 0 }}>
      {series.length > 1 && (
        <div className="legend" style={{ marginBottom: 12 }}>
          {series.map((s, si) => <span key={s.name}><i style={{ background: s.color }} />{s.name}</span>)}
          {highlight != null && <span><i style={{ background: "var(--series-accent)" }} />{labels[highlight]} so far</span>}
        </div>
      )}
      <svg className="chart" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}: ${labels.map((l, i) => `${l} ${series.map((s) => `${s.name} ${format(s.values[i])}`).join(", ")}`).join("; ")}`} onMouseLeave={() => setTip(null)}>
        {ticks.map((tk) => (
          <g key={tk}>
            <line className="grid" x1={padL} x2={W} y1={y(tk)} y2={y(tk)} />
            <text x={padL - 12} y={y(tk) + 4} textAnchor="end">{format(tk)}</text>
          </g>
        ))}
        {labels.map((l, i) => {
          const x0 = padL + band * i + (band - (barW * series.length + gap * (series.length - 1))) / 2;
          return (
            <g key={l + i}>
              {series.map((s, si) => {
                const v = s.values[i] ?? 0;
                const h = Math.max(0, H - padB - y(v));
                const x = x0 + si * (barW + gap);
                const r = Math.min(3, barW / 2, h);
                const fill = highlight === i && si === 0 ? "var(--series-accent)" : s.color;
                return (
                  <path key={s.name}
                    d={h > 0 ? `M${x},${H - padB} V${y(v) + r} Q${x},${y(v)} ${x + r},${y(v)} H${x + barW - r} Q${x + barW},${y(v)} ${x + barW},${y(v) + r} V${H - padB} Z` : ""}
                    fill={fill} />
                );
              })}
              <rect x={padL + band * i} y={padT} width={band} height={H - padT - padB} fill="transparent"
                onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, text: `${l} · ${series.map((s) => `${s.name} ${format(s.values[i] ?? 0)}`).join(" · ")}` })} />
              {i % every === 0 && <text x={padL + band * i + band / 2} y={H - 8} textAnchor="middle" style={highlight === i ? { fill: "var(--ink)" } : undefined}>{l}</text>}
            </g>
          );
        })}
        <line className="axis" x1={padL} x2={W} y1={H - padB} y2={H - padB} />
      </svg>
      <Tooltip tip={tip} />
    </figure>
  );
}

/** Single-series line with crosshair, e.g. daily check-ins. The last point (today) is marked. */
export function Line({ labels, values, color = "var(--series-1)", height = 160, title, format = (n: number) => String(n), markLast = true }: {
  labels: string[]; values: number[]; color?: string; height?: number; title: string; format?: (n: number) => string; markLast?: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [tip, setTip] = useState<Tip>(null);
  const [ref, W] = useWidth();
  const H = height, padL = 32, padR = 8, padB = 24, padT = 8;
  const max = niceMax(Math.max(1, ...values));
  const x = (i: number) => padL + ((W - padL - padR) * i) / Math.max(1, values.length - 1);
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / max);
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`).join(" ");
  const last = values.length - 1;
  return (
    <figure ref={ref as React.RefObject<HTMLElement & HTMLDivElement>} style={{ margin: 0 }}>
      <svg className="chart" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}: ${values.map((v, i) => `${labels[i]} ${format(v)}`).join(", ")}`}
        onMouseLeave={() => { setHover(null); setTip(null); }}
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          const i = Math.max(0, Math.min(last, Math.round(((px - padL) / (W - padL - padR)) * last)));
          setHover(i);
          setTip({ x: e.clientX, y: e.clientY, text: `${labels[i]} · ${format(values[i])}` });
        }}>
        {[0, max / 2, max].map((tk) => (
          <g key={tk}>
            <line className="grid" x1={padL} x2={W} y1={y(tk)} y2={y(tk)} />
            <text x={padL - 8} y={y(tk) + 4} textAnchor="end">{format(Math.round(tk))}</text>
          </g>
        ))}
        <path d={d} fill="none" stroke={color} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
        {markLast && last >= 0 && hover !== last && (
          <circle cx={x(last)} cy={y(values[last])} r={4} fill="var(--series-accent)" stroke="var(--surface)" strokeWidth={2} />
        )}
        {hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={padT} y2={H - padB} stroke="var(--line)" />
            <circle cx={x(hover)} cy={y(values[hover])} r={4} fill={hover === last && markLast ? "var(--series-accent)" : color} stroke="var(--surface)" strokeWidth={2} />
          </g>
        )}
        {[0, Math.floor(values.length / 2), last].map((i) => (
          <text key={i} x={x(i)} y={H - 6} textAnchor={i === 0 ? "start" : i === last ? "end" : "middle"}>{labels[i]}</text>
        ))}
      </svg>
      <Tooltip tip={tip} />
    </figure>
  );
}

/** Weekday × hour check-in heatmap (sequential, rubber ink). Shows only the hours the gym
 *  actually sees members, so closed night hours don't take a third of the grid. */
export function Heatmap({ cells, days }: { cells: { dow: number; hour: number; n: number }[]; days: string[] }) {
  const [tip, setTip] = useState<Tip>(null);
  const grid = Array.from({ length: 7 }, () => new Array(24).fill(0));
  cells.forEach((c) => (grid[c.dow][c.hour] = c.n));
  const max = Math.max(1, ...cells.map((c) => c.n));
  const busy = cells.filter((c) => c.n > 0).map((c) => c.hour);
  const from = busy.length ? Math.min(...busy) : 6;
  const to = busy.length ? Math.max(...busy) : 22;
  const hours = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  const order = [1, 2, 3, 4, 5, 6, 0];
  const shade = (n: number) => `color-mix(in srgb, var(--series-1) ${Math.round(8 + (n / max) * 92)}%, var(--surface))`;
  return (
    <div>
      <div className="heat" role="img" aria-label="Check-ins by weekday and hour, last 8 weeks" style={{ gridTemplateColumns: `32px repeat(${hours.length}, minmax(8px, 1fr))` }}>
        <span className="hl" />
        {hours.map((h) => <span key={h} className="hl">{h % 3 === 0 ? `${String(h).padStart(2, "0")}h` : ""}</span>)}
        {order.map((d) => (
          <React.Fragment key={d}>
            <span className="dl">{days[d]}</span>
            {hours.map((h) => {
              const n = grid[d][h];
              return (
                <span key={h}
                  style={{ background: n ? shade(n) : "var(--line-2)" }}
                  onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, text: `${days[d]} ${String(h).padStart(2, "0")}:00 · ${n} check-ins` })}
                  onMouseLeave={() => setTip(null)} />
              );
            })}
          </React.Fragment>
        ))}
      </div>
      <div className="legend" style={{ marginTop: 12, gap: 4 }}>
        <span style={{ marginInlineEnd: 4 }}>Quiet</span>
        {[0.15, 0.4, 0.7, 1].map((p) => <i key={p} style={{ background: shade(p * max), margin: 0, width: 12, height: 12 }} />)}
        <span style={{ marginInlineStart: 4 }}>Busy</span>
      </div>
      <Tooltip tip={tip} />
    </div>
  );
}
