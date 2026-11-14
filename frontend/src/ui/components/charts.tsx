"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Small SVG charts for the dashboards, built to the dataviz rules in
 * docs/design-system.md:
 *
 * - Marks wear chart tokens; every piece of text wears a text token.
 * - Bars are at most 24px wide, square at the baseline, 4px round at the cap.
 * - Lines are 2px with an end dot (r 4) inside a 2px surface ring.
 * - Gridlines are 1px, solid, one step off the surface.
 * - Labels are selective: the latest value is printed, the rest are on hover.
 * - Every chart has a hover tooltip and a screen-reader table of its data.
 */

export type ChartPoint = { label: string; value: number | null; hint?: string };
export type DonutSlice = { label: string; value: number; color: string };

/** Width of the element, kept current as the layout changes. */
function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

function SrTable({ caption, rows }: { caption: string; rows: { label: string; value: string }[] }) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label}>
            <th scope="row">{r.label}</th>
            <td>{r.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Tooltip({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  return (
    <div className="c-chart-tip pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap" style={{ left: x, top: y - 8 }}>
      {children}
    </div>
  );
}

const PAD = { top: 24, right: 12, bottom: 28, left: 40 };

/* ─── Columns over time, one series ──────────────────────────────────── */

/**
 * A percentage per period (attendance rate per day). One series, so no legend
 * box — the card title says what it is.
 */
export function BarTrend({
  data,
  caption,
  height = 200,
  format = (v) => `${Math.round(v)}%`,
  max = 100,
}: {
  data: ChartPoint[];
  caption: string;
  height?: number;
  format?: (v: number) => string;
  max?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);

  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const plotH = height - PAD.top - PAD.bottom;
  const band = data.length ? plotW / data.length : 0;
  const barW = Math.min(24, band * 0.6);
  const y = (v: number) => PAD.top + plotH - (Math.min(v, max) / max) * plotH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  const lastIndex = data.map((d) => d.value !== null).lastIndexOf(true);

  return (
    <div ref={ref} className="relative">
      {width > 0 && (
        <svg className="c-chart" width={width} height={height} role="img" aria-label={caption}>
          {ticks.map((t) => (
            <g key={t}>
              <line className="c-chart-grid" x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} />
              <text x={PAD.left - 8} y={y(t)} textAnchor="end" dominantBaseline="middle">
                {format(t)}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const cx = PAD.left + band * i + band / 2;
            const v = d.value;
            const top = v === null ? y(0) : y(v);
            const h = PAD.top + plotH - top;
            // Square at the baseline, 4px round at the cap.
            const r = Math.min(4, h, barW / 2);
            const x0 = cx - barW / 2;
            const path =
              v === null || h <= 0
                ? ""
                : `M${x0},${PAD.top + plotH} V${top + r} Q${x0},${top} ${x0 + r},${top} H${x0 + barW - r} Q${x0 + barW},${top} ${x0 + barW},${top + r} V${PAD.top + plotH} Z`;
            return (
              <g key={d.label}>
                {path && <path d={path} fill="var(--we-chart-single)" opacity={active === null || active === i ? 1 : 0.55} />}
                {/* Only the latest value is printed; the rest are on hover. */}
                {i === lastIndex && v !== null && (
                  <text className="c-chart-value" x={cx} y={top - 6} textAnchor="middle">
                    {format(v)}
                  </text>
                )}
                <text x={cx} y={height - 8} textAnchor="middle">
                  {d.label}
                </text>
                {/* The whole band is the hover target, bigger than the bar. */}
                <rect
                  x={PAD.left + band * i}
                  y={PAD.top}
                  width={band}
                  height={plotH}
                  fill="transparent"
                  tabIndex={0}
                  aria-label={`${d.label}: ${v === null ? "no working day" : format(v)}`}
                  onMouseEnter={() => setActive(i)}
                  onMouseLeave={() => setActive(null)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                />
              </g>
            );
          })}
        </svg>
      )}
      {active !== null && data[active] && (
        <Tooltip x={PAD.left + band * active + band / 2} y={data[active].value === null ? y(0) : y(data[active].value!)}>
          <p className="text-xs text-secondary">{data[active].label}</p>
          <p className="text-sm font-semibold text-heading">
            {data[active].value === null ? "Not a working day" : format(data[active].value!)}
          </p>
          {data[active].hint && <p className="text-xs text-secondary">{data[active].hint}</p>}
        </Tooltip>
      )}
      <SrTable caption={caption} rows={data.map((d) => ({ label: d.label, value: d.value === null ? "—" : format(d.value) }))} />
    </div>
  );
}

/* ─── A line over time, one series ───────────────────────────────────── */

export function LineTrend({
  data,
  caption,
  height = 220,
  format = (v) => `${Math.round(v)}%`,
  min = 0,
  max = 100,
}: {
  data: ChartPoint[];
  caption: string;
  height?: number;
  format?: (v: number) => string;
  min?: number;
  max?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);

  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const plotH = height - PAD.top - PAD.bottom;
  const step = data.length > 1 ? plotW / (data.length - 1) : 0;
  const x = (i: number) => PAD.left + step * i;
  const y = (v: number) => PAD.top + plotH - ((Math.max(min, Math.min(v, max)) - min) / (max - min)) * plotH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => min + t * (max - min));

  // Only working days carry a value; the line skips the rest rather than
  // dropping to zero, which would misstate a weekend as a bad day.
  const points = data.map((d, i) => (d.value === null ? null : { i, px: x(i), py: y(d.value) }));
  const segments: { px: number; py: number }[][] = [];
  let current: { px: number; py: number }[] = [];
  for (const p of points) {
    if (p) current.push(p);
    else if (current.length) {
      segments.push(current);
      current = [];
    }
  }
  if (current.length) segments.push(current);
  const valid = points.filter(Boolean) as { i: number; px: number; py: number }[];
  const last = valid[valid.length - 1];

  // Label every few days so the axis never crowds.
  const labelEvery = Math.max(1, Math.ceil(data.length / 8));

  function onMove(e: React.MouseEvent<SVGRectElement>) {
    if (!valid.length) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left + PAD.left;
    let best = valid[0];
    for (const p of valid) if (Math.abs(p.px - mx) < Math.abs(best.px - mx)) best = p;
    setActive(best.i);
  }

  const activePoint = active === null ? null : points[active];

  return (
    <div ref={ref} className="relative">
      {width > 0 && (
        <svg className="c-chart" width={width} height={height} role="img" aria-label={caption}>
          {ticks.map((t) => (
            <g key={t}>
              <line className="c-chart-grid" x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} />
              <text x={PAD.left - 8} y={y(t)} textAnchor="end" dominantBaseline="middle">
                {format(t)}
              </text>
            </g>
          ))}
          {data.map((d, i) =>
            (data.length - 1 - i) % labelEvery === 0 ? (
              <text key={d.label} x={x(i)} y={height - 8} textAnchor="middle">
                {d.label}
              </text>
            ) : null,
          )}
          {segments.map((seg, k) => (
            <g key={k}>
              {/* A 10% wash under the line, never a saturated block. */}
              <path
                d={`M${seg[0].px},${PAD.top + plotH} ${seg.map((p) => `L${p.px},${p.py}`).join(" ")} L${seg[seg.length - 1].px},${PAD.top + plotH} Z`}
                fill="var(--we-chart-single)"
                opacity={0.1}
              />
              <path
                d={seg.map((p, j) => `${j ? "L" : "M"}${p.px},${p.py}`).join(" ")}
                fill="none"
                stroke="var(--we-chart-single)"
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </g>
          ))}
          {activePoint && (
            <line className="c-chart-grid" x1={activePoint.px} x2={activePoint.px} y1={PAD.top} y2={PAD.top + plotH} />
          )}
          {(activePoint ? [activePoint] : last ? [last] : []).map((p) => (
            <circle key={p.i} cx={p.px} cy={p.py} r={4} fill="var(--we-chart-single)" stroke="var(--we-surface)" strokeWidth={2} />
          ))}
          {last && !activePoint && (
            <text className="c-chart-value" x={last.px} y={last.py - 10} textAnchor="end">
              {format(data[last.i].value!)}
            </text>
          )}
          <rect
            x={PAD.left}
            y={PAD.top}
            width={plotW}
            height={plotH}
            fill="transparent"
            onMouseMove={onMove}
            onMouseLeave={() => setActive(null)}
          />
        </svg>
      )}
      {activePoint && (
        <Tooltip x={activePoint.px} y={activePoint.py}>
          <p className="text-xs text-secondary">{data[activePoint.i].label}</p>
          <p className="text-sm font-semibold text-heading">{format(data[activePoint.i].value!)}</p>
          {data[activePoint.i].hint && <p className="text-xs text-secondary">{data[activePoint.i].hint}</p>}
        </Tooltip>
      )}
      <SrTable caption={caption} rows={data.map((d) => ({ label: d.label, value: d.value === null ? "—" : format(d.value) }))} />
    </div>
  );
}

/* ─── A whole split into parts ───────────────────────────────────────── */

/**
 * A donut with its total in the middle and a legend that names every part with
 * its count, so identity never rests on colour. Segments are separated by a 2px
 * surface gap, not an outline.
 */
export function Donut({
  slices,
  caption,
  centerLabel,
  centerValue,
  size = 168,
  thickness = 22,
}: {
  slices: DonutSlice[];
  caption: string;
  centerLabel: string;
  centerValue?: ReactNode;
  size?: number;
  thickness?: number;
}) {
  const [active, setActive] = useState<number | null>(null);
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const gap = slices.filter((s) => s.value > 0).length > 1 ? 2 : 0;

  // Each arc starts where the ones before it end.
  const lengths = slices.map((s) => (total ? (s.value / total) * c : 0));
  const arcs = slices.map((s, i) => ({
    i,
    s,
    len: lengths[i],
    start: lengths.slice(0, i).reduce((a, b) => a + b, 0),
  }));

  const pct = (v: number) => (total ? Math.round((v / total) * 100) : 0);

  return (
    <div className="flex flex-wrap items-center gap-6">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={caption} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--we-surface-muted)" strokeWidth={thickness} />
          {arcs.map(({ i, s, start, len }) =>
            len > 0 ? (
              <circle
                key={s.label}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={s.color}
                strokeWidth={active === i ? thickness + 4 : thickness}
                strokeDasharray={`${Math.max(0, len - gap)} ${c - Math.max(0, len - gap)}`}
                strokeDashoffset={-start}
                tabIndex={0}
                aria-label={`${s.label}: ${s.value} (${pct(s.value)}%)`}
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                style={{ transition: "stroke-width 150ms" }}
              />
            ) : null,
          )}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          {active !== null ? (
            <>
              <span className="text-2xl font-semibold text-heading">{slices[active].value}</span>
              <span className="text-xs text-secondary">{slices[active].label}</span>
            </>
          ) : (
            <>
              <span className="text-3xl font-semibold text-heading">{centerValue ?? total}</span>
              <span className="text-xs text-secondary">{centerLabel}</span>
            </>
          )}
        </div>
      </div>
      <ul className="c-legend min-w-40 flex-1">
        {slices.map((s, i) => (
          <li key={s.label} onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)}>
            <span className="c-legend-swatch" style={{ backgroundColor: s.color }} aria-hidden />
            <span className="flex-1">{s.label}</span>
            <span className="font-semibold text-heading tabular-nums">
              {s.value}
              <span className="ml-1 font-normal text-secondary">({pct(s.value)}%)</span>
            </span>
          </li>
        ))}
      </ul>
      <SrTable caption={caption} rows={slices.map((s) => ({ label: s.label, value: `${s.value} (${pct(s.value)}%)` }))} />
    </div>
  );
}
