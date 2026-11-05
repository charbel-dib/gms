/** Small, dependency-free SVG charts following the GMS chart rules:
 *  thin marks with rounded data ends, one axis, recessive grid, hover tooltips,
 *  legend for ≥2 series, and a table fallback via aria labels. */
import React, { useState } from "react";
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

/** Grouped bars (1–2 series) on one axis, e.g. revenue vs expenses per month. */
export function Bars({ labels, series, height = 220, format = (n: number) => money(n), title }: {
  labels: string[];
  series: { name: string; values: number[]; color: string }[];
  height?: number;
  format?: (n: number) => string;
  title: string;
}) {
  const [tip, setTip] = useState<Tip>(null);
  const W = 640, H = height, padL = 46, padB = 24, padT = 10;
  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values)));
  const band = (W - padL) / labels.length;
  const gap = 2;
  const barW = Math.min(26, (band * 0.62 - gap * (series.length - 1)) / series.length);
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / max);
  const ticks = [0, 0.5, 1].map((f) => f * max);
  return (
    <figure style={{ margin: 0 }}>
      {series.length > 1 && (
        <div className="legend" style={{ marginBottom: 8 }}>
          {series.map((s) => <span key={s.name}><i style={{ background: s.color }} />{s.name}</span>)}
        </div>
      )}
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}: ${labels.map((l, i) => `${l} ${series.map((s) => `${s.name} ${format(s.values[i])}`).join(", ")}`).join("; ")}`} onMouseLeave={() => setTip(null)}>
        {ticks.map((tk) => (
          <g key={tk}>
            <line className="grid" x1={padL} x2={W} y1={y(tk)} y2={y(tk)} />
            <text x={padL - 8} y={y(tk) + 4} textAnchor="end">{format(tk)}</text>
          </g>
        ))}
        {labels.map((l, i) => {
          const x0 = padL + band * i + (band - (barW * series.length + gap * (series.length - 1))) / 2;
          return (
            <g key={l}>
              {series.map((s, si) => {
                const v = s.values[i] ?? 0;
                const h = Math.max(0, H - padB - y(v));
                const x = x0 + si * (barW + gap);
                const r = Math.min(4, barW / 2, h);
                return (
                  <path key={s.name}
                    d={h > 0 ? `M${x},${H - padB} V${y(v) + r} Q${x},${y(v)} ${x + r},${y(v)} H${x + barW - r} Q${x + barW},${y(v)} ${x + barW},${y(v) + r} V${H - padB} Z` : ""}
                    fill={s.color} />
                );
              })}
              <rect x={padL + band * i} y={padT} width={band} height={H - padT - padB} fill="transparent"
                onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, text: `${l} · ${series.map((s) => `${s.name} ${format(s.values[i] ?? 0)}`).join(" · ")}` })} />
              {(labels.length <= 12 || i % 2 === 0) && <text x={padL + band * i + band / 2} y={H - 6} textAnchor="middle">{l}</text>}
            </g>
          );
        })}
        <line className="axis" x1={padL} x2={W} y1={H - padB} y2={H - padB} />
      </svg>
      <Tooltip tip={tip} />
    </figure>
  );
}

/** Single-series line with crosshair, e.g. daily check-ins. */
export function Line({ labels, values, color = "var(--series-1)", height = 160, title, format = (n: number) => String(n) }: {
  labels: string[]; values: number[]; color?: string; height?: number; title: string; format?: (n: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [tip, setTip] = useState<Tip>(null);
  const W = 640, H = height, padL = 34, padB = 22, padT = 10;
  const max = niceMax(Math.max(1, ...values));
  const x = (i: number) => padL + ((W - padL - 6) * i) / Math.max(1, values.length - 1);
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / max);
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`).join(" ");
  return (
    <figure style={{ margin: 0 }}>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}: ${values.map((v, i) => `${labels[i]} ${format(v)}`).join(", ")}`}
        onMouseLeave={() => { setHover(null); setTip(null); }}
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          const i = Math.max(0, Math.min(values.length - 1, Math.round(((px - padL) / (W - padL - 6)) * (values.length - 1))));
          setHover(i);
          setTip({ x: e.clientX, y: e.clientY, text: `${labels[i]} · ${format(values[i])}` });
        }}>
        {[0, max / 2, max].map((tk) => (
          <g key={tk}>
            <line className="grid" x1={padL} x2={W} y1={y(tk)} y2={y(tk)} />
            <text x={padL - 6} y={y(tk) + 4} textAnchor="end">{format(Math.round(tk))}</text>
          </g>
        ))}
        <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={padT} y2={H - padB} stroke="var(--line)" />
            <circle cx={x(hover)} cy={y(values[hover])} r={4.5} fill={color} stroke="var(--surface)" strokeWidth={2} />
          </g>
        )}
        {[0, Math.floor(values.length / 2), values.length - 1].map((i) => (
          <text key={i} x={x(i)} y={H - 4} textAnchor={i === 0 ? "start" : i === values.length - 1 ? "end" : "middle"}>{labels[i]}</text>
        ))}
      </svg>
      <Tooltip tip={tip} />
    </figure>
  );
}

/** Weekday × hour check-in heatmap (sequential, one hue). */
export function Heatmap({ cells, days }: { cells: { dow: number; hour: number; n: number }[]; days: string[] }) {
  const [tip, setTip] = useState<Tip>(null);
  const grid = Array.from({ length: 7 }, () => new Array(24).fill(0));
  cells.forEach((c) => (grid[c.dow][c.hour] = c.n));
  const max = Math.max(1, ...cells.map((c) => c.n));
  const order = [1, 2, 3, 4, 5, 6, 0];
  return (
    <div>
      <div className="heat" role="img" aria-label="Check-ins by weekday and hour, last 8 weeks">
        <span />
        {Array.from({ length: 24 }, (_, h) => <span key={h} style={{ aspectRatio: "auto", textAlign: "center" }}>{h % 3 === 0 ? h : ""}</span>)}
        {order.map((d) => (
          <React.Fragment key={d}>
            <span style={{ aspectRatio: "auto", alignSelf: "center" }}>{days[d]}</span>
            {grid[d].map((n, h) => (
              <span key={h}
                style={{ background: n ? `color-mix(in srgb, var(--series-1) ${Math.round(12 + (n / max) * 88)}%, var(--surface))` : "var(--line-2)" }}
                onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, text: `${days[d]} ${String(h).padStart(2, "0")}:00 · ${n} check-ins` })}
                onMouseLeave={() => setTip(null)} />
            ))}
          </React.Fragment>
        ))}
      </div>
      <div className="legend" style={{ marginTop: 10 }}>
        <span>Fewer</span>
        {[15, 40, 70, 100].map((p) => <i key={p} style={{ background: `color-mix(in srgb, var(--series-1) ${p}%, var(--surface))`, margin: 0 }} />)}
        <span>More check-ins</span>
      </div>
      <Tooltip tip={tip} />
    </div>
  );
}
