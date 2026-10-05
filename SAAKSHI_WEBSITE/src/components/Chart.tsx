import { useEffect, useRef, useState } from "react";
import type { Point, Series } from "../lib/stats";
import { fmtDay, fmtTime } from "../lib/format";

const M = { l: 46, r: 12, t: 10, b: 24 };

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(640);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(260, Math.floor(el.clientWidth))));
    ro.observe(el);
    setW(Math.max(260, Math.floor(el.clientWidth)));
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

function niceTicks(lo: number, hi: number, count = 5): number[] {
  if (hi <= lo) return [lo];
  const raw = (hi - lo) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-6; v += step) out.push(Math.round(v / step) * step);
  return out;
}

function xTicks(x0: number, x1: number, n: number): number[] {
  return Array.from({ length: n }, (_v, i) => x0 + ((x1 - x0) * i) / (n - 1));
}

function xLabel(x: number, timed: boolean, spanMs: number) {
  if (!timed) return String(Math.round(x));
  return spanMs > 36 * 3.6e6 ? fmtDay(x) : fmtTime(x);
}

interface Common {
  series: Series;
  color: string;
  unit: string;
  label: string;
  decimals?: number;
  height?: number;
}

function useGeometry(series: Series, yLo: number, yHi: number, width: number, height: number) {
  const pts = series.points;
  const x0 = pts[0]?.x ?? 0;
  const x1 = pts[pts.length - 1]?.x ?? 1;
  const iw = width - M.l - M.r;
  const ih = height - M.t - M.b;
  const sx = (x: number) => M.l + (x1 === x0 ? iw / 2 : ((x - x0) / (x1 - x0)) * iw);
  const sy = (y: number) => M.t + ih - ((y - yLo) / (yHi - yLo || 1)) * ih;
  return { x0, x1, iw, ih, sx, sy };
}

function Frame({
  width, height, ticksY, ticksX, sx, sy, timed, spanMs, children,
}: {
  width: number; height: number; ticksY: number[]; ticksX: number[];
  sx: (x: number) => number; sy: (y: number) => number; timed: boolean; spanMs: number;
  children: React.ReactNode;
}) {
  return (
    <>
      {ticksY.map((t) => (
        <g key={t}>
          <line x1={M.l} x2={width - M.r} y1={sy(t)} y2={sy(t)} className="chart-grid" />
          <text x={M.l - 6} y={sy(t) + 3.5} textAnchor="end" className="chart-axis">{+t.toFixed(2)}</text>
        </g>
      ))}
      {ticksX.map((t, i) => (
        <text key={i} x={sx(t)} y={height - 6} textAnchor={i === 0 ? "start" : i === ticksX.length - 1 ? "end" : "middle"} className="chart-axis">
          {xLabel(t, timed, spanMs)}
        </text>
      ))}
      {children}
    </>
  );
}

function useHover(points: Point[], sx: (x: number) => number) {
  const [idx, setIdx] = useState<number | null>(null);
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < points.length; i++) {
      const d = Math.abs(sx(points[i].x) - px);
      if (d < bestD) { bestD = d; best = i; }
    }
    setIdx(best);
  };
  return { idx, onMove, onLeave: () => setIdx(null) };
}

function Tip({ p, timed, left, children }: { p: Point; timed: boolean; left: number; children: React.ReactNode }) {
  const when = timed ? `${fmtDay(p.x)}, ${fmtTime(p.x)} IST` : `Record ${Math.round(p.x)}`;
  return (
    <div className="chart-tip" style={{ left }}>
      <div className="chart-tip-when">{when}</div>
      {children}
    </div>
  );
}

export function LineChart({
  series, color, unit, label, decimals = 1, height = 220, band,
}: Common & { band?: [number | null, number | null] | null }) {
  const [ref, width] = useWidth();
  const pts = series.points;
  const lo = band?.[0] ?? null;
  const hi = band?.[1] ?? null;

  let yMin = Math.min(...pts.map((p) => p.min), lo ?? Infinity);
  let yMax = Math.max(...pts.map((p) => p.max), hi ?? -Infinity);
  if (!Number.isFinite(yMin)) { yMin = 0; yMax = 1; }
  const pad = (yMax - yMin) * 0.12 || 1;
  yMin -= pad; yMax += pad;

  const { x0, x1, sx, sy } = useGeometry(series, yMin, yMax, width, height);
  const hover = useHover(pts, sx);
  const ticksY = niceTicks(yMin, yMax, 4);
  const ticksX = xTicks(x0, x1, width < 480 ? 3 : 5);

  if (!pts.length) return <div className="chart-empty" ref={ref}>No readings to plot</div>;

  const env =
    pts.map((p, i) => `${i ? "L" : "M"}${sx(p.x).toFixed(1)},${sy(p.max).toFixed(1)}`).join("") +
    [...pts].reverse().map((p) => `L${sx(p.x).toFixed(1)},${sy(p.min).toFixed(1)}`).join("") + "Z";
  const line = pts.map((p, i) => `${i ? "L" : "M"}${sx(p.x).toFixed(1)},${sy(p.avg).toFixed(1)}`).join("");
  const hp = hover.idx != null ? pts[hover.idx] : null;
  const outside = pts.filter((p) => (hi != null && p.max > hi) || (lo != null && p.min < lo));

  return (
    <div className="chart" ref={ref}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}
        onPointerMove={hover.onMove} onPointerLeave={hover.onLeave}>
        <Frame width={width} height={height} ticksY={ticksY} ticksX={ticksX} sx={sx} sy={sy} timed={series.timed} spanMs={x1 - x0}>
          {band && (lo != null || hi != null) && (
            <g>
              <rect x={M.l} width={width - M.l - M.r} y={sy(hi ?? yMax)} height={Math.max(0, sy(lo ?? yMin) - sy(hi ?? yMax))} className="chart-band" />
              <text x={width - M.r - 4} y={sy(hi ?? yMax) + 12} textAnchor="end" className="chart-band-label">
                allowed {lo ?? "any"} to {hi ?? "any"} {unit}
              </text>
            </g>
          )}
          <path d={env} fill={color} opacity={0.16} />
          <path d={line} fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round" />
          {outside.slice(0, 200).map((p) => (
            <circle key={p.seq0} cx={sx(p.x)} cy={sy(hi != null && p.max > hi ? p.max : p.min)} r={2.6} className="chart-out" />
          ))}
          {hp && (
            <g>
              <line x1={sx(hp.x)} x2={sx(hp.x)} y1={M.t} y2={height - M.b} className="chart-cross" />
              <circle cx={sx(hp.x)} cy={sy(hp.avg)} r={3.6} fill={color} stroke="var(--card)" strokeWidth={1.5} />
            </g>
          )}
        </Frame>
      </svg>
      {hp && (
        <Tip p={hp} timed={series.timed} left={Math.min(Math.max(sx(hp.x), 80), width - 80)}>
          <strong>{hp.avg.toFixed(decimals)} {unit}</strong>
          {hp.max - hp.min > 10 ** -decimals && (
            <span className="chart-tip-range">range {hp.min.toFixed(decimals)} to {hp.max.toFixed(decimals)}</span>
          )}
        </Tip>
      )}
    </div>
  );
}

export function BarChart({
  series, color, unit, label, decimals = 2, height = 150, threshold, value = "max",
}: Common & { threshold?: number; value?: "max" | "sum" }) {
  const [ref, width] = useWidth();
  const pts = series.points;
  const v = (p: Point) => (value === "sum" ? p.sum : p.max);
  const yMax = Math.max(...pts.map(v), threshold ?? 0, 0.1) * 1.15;
  const { x0, x1, sx, sy } = useGeometry(series, 0, yMax, width, height);
  const hover = useHover(pts, sx);
  const ticksY = niceTicks(0, yMax, 3);
  const ticksX = xTicks(x0, x1, width < 480 ? 3 : 5);

  if (!pts.length) return <div className="chart-empty" ref={ref}>No readings to plot</div>;

  const bw = Math.max(1.5, Math.min(8, ((width - M.l - M.r) / pts.length) * 0.8));
  const hp = hover.idx != null ? pts[hover.idx] : null;

  return (
    <div className="chart" ref={ref}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}
        onPointerMove={hover.onMove} onPointerLeave={hover.onLeave}>
        <Frame width={width} height={height} ticksY={ticksY} ticksX={ticksX} sx={sx} sy={sy} timed={series.timed} spanMs={x1 - x0}>
          {threshold != null && (
            <g>
              <line x1={M.l} x2={width - M.r} y1={sy(threshold)} y2={sy(threshold)} className="chart-threshold" />
              <text x={width - M.r - 4} y={sy(threshold) - 4} textAnchor="end" className="chart-band-label">jolt limit {threshold} {unit}</text>
            </g>
          )}
          {pts.map((p) => {
            const over = threshold != null && v(p) > threshold;
            const y = sy(v(p));
            return <rect key={p.seq0} x={sx(p.x) - bw / 2} y={y} width={bw} height={Math.max(0, sy(0) - y)} className={over ? "chart-out-bar" : undefined} fill={over ? undefined : color} opacity={hp === p ? 1 : 0.85} />;
          })}
          {hp && <line x1={sx(hp.x)} x2={sx(hp.x)} y1={M.t} y2={height - M.b} className="chart-cross" />}
        </Frame>
      </svg>
      {hp && (
        <Tip p={hp} timed={series.timed} left={Math.min(Math.max(sx(hp.x), 80), width - 80)}>
          <strong>{v(hp).toFixed(decimals)} {unit}</strong>
        </Tip>
      )}
    </div>
  );
}
