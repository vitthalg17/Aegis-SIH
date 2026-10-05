import { FLAG, has } from "./flags";
import type { Chain, NodeInfo, Reading } from "./types";

export const usable = (r: Reading) => !has(r.flags, FLAG.SENSOR_FAIL);
export const hasTime = (r: Reading) => r.unix_time > 0;

/** Seconds between two readings: real clock if both have it, else uptime inside one boot, else null */
export function gapSeconds(a: Reading, b: Reading): number | null {
  if (hasTime(a) && hasTime(b)) return Math.max(0, b.unix_time - a.unix_time);
  if (a.boot === b.boot) return Math.max(0, b.uptime_s - a.uptime_s);
  return null;
}

export function outsideBand(r: Reading, node: Pick<NodeInfo, "temp_lo" | "temp_hi">): "low" | "high" | null {
  if (!usable(r) || r.temp_c == null) return null;
  if (node.temp_lo != null && r.temp_c < node.temp_lo) return "low";
  if (node.temp_hi != null && r.temp_c > node.temp_hi) return "high";
  return null;
}

export interface TripStats {
  count: number;
  firstTime: number | null;
  lastTime: number | null;
  durationS: number | null;
  tempMin: number | null;
  tempAvg: number | null;
  tempMax: number | null;
  outsideS: number;
  jolts: number;
  peakG: number;
  restarts: number;
  sensorFails: number;
  unsigned: number;
  rtcFails: number;
  mpuFails: number;
  sensorChanges: number;
  mpuSeen: boolean;
  timedFraction: number;
}

export function tripStats(rs: Reading[], node: Pick<NodeInfo, "temp_lo" | "temp_hi" | "log_interval_s">): TripStats {
  const timed = rs.filter(hasTime);
  const temps = rs.filter(usable).map((r) => r.temp_c).filter((t): t is number => t != null);

  let outsideS = 0;
  for (let i = 1; i < rs.length; i++) {
    const prev = rs[i - 1];
    if (!outsideBand(prev, node)) continue;
    const gap = gapSeconds(prev, rs[i]);
    // A gap this long means the node was off, not that the produce was out of range
    if (gap != null && gap <= node.log_interval_s * 6) outsideS += gap;
  }

  const first = timed[0]?.unix_time ?? null;
  const last = timed[timed.length - 1]?.unix_time ?? null;
  return {
    count: rs.length,
    firstTime: first,
    lastTime: last,
    durationS: first != null && last != null ? last - first : null,
    tempMin: temps.length ? Math.min(...temps) : null,
    tempAvg: temps.length ? temps.reduce((a, b) => a + b, 0) / temps.length : null,
    tempMax: temps.length ? Math.max(...temps) : null,
    outsideS,
    jolts: rs.filter((r) => has(r.flags, FLAG.SHOCK)).length,
    peakG: rs.reduce((m, r) => Math.max(m, r.peak_g), 0),
    restarts: rs.filter((r) => has(r.flags, FLAG.BOOT) && r.seq > 0).length,
    sensorFails: rs.filter((r) => has(r.flags, FLAG.SENSOR_FAIL)).length,
    unsigned: rs.filter((r) => has(r.flags, FLAG.UNSIGNED)).length,
    rtcFails: rs.filter((r) => has(r.flags, FLAG.RTC_FAIL)).length,
    mpuFails: rs.filter((r) => has(r.flags, FLAG.MPU_FAIL)).length,
    sensorChanges: rs.filter((r) => has(r.flags, FLAG.SENSOR_CHANGED)).length,
    mpuSeen: rs.some((r) => !has(r.flags, FLAG.MPU_FAIL) && r.mpu_temp_c != null),
    timedFraction: rs.length ? timed.length / rs.length : 0,
  };
}

export interface Point {
  x: number;
  min: number;
  max: number;
  avg: number;
  sum: number;
  seq0: number;
}

export interface Series {
  points: Point[];
  timed: boolean;
}

/**
 * Bucket readings into at most `n` points, keeping the min and max of each bucket so short spikes
 * survive downsampling. Plots by time when most records have a clock, otherwise by seq.
 * Readings whose sensor failed are skipped unless `needsSensor` is false.
 */
export function buildSeries(
  rs: Reading[],
  pick: (r: Reading) => number | null,
  opts: { n?: number; needsSensor?: boolean } = {},
): Series {
  const n = opts.n ?? 320;
  const needsSensor = opts.needsSensor ?? true;
  const timed = rs.length > 0 && rs.filter(hasTime).length >= rs.length * 0.5;
  const rows = rs.filter((r) => (timed ? hasTime(r) : true) && (!needsSensor || usable(r)));
  const xOf = (r: Reading) => (timed ? r.unix_time * 1000 : r.seq);
  const size = Math.max(1, Math.ceil(rows.length / n));
  const points: Point[] = [];
  for (let i = 0; i < rows.length; i += size) {
    const chunk = rows.slice(i, i + size);
    const vals = chunk.map(pick).filter((v): v is number => v != null && Number.isFinite(v));
    if (!vals.length) continue;
    const sum = vals.reduce((a, b) => a + b, 0);
    points.push({
      x: chunk.reduce((a, r) => a + xOf(r), 0) / chunk.length,
      min: Math.min(...vals),
      max: Math.max(...vals),
      avg: sum / vals.length,
      sum,
      seq0: chunk[0].seq,
    });
  }
  return { points, timed };
}

/** The most recent chain: the one that started last */
export function latestChain(chains: Chain[]): Chain | null {
  if (!chains.length) return null;
  return [...chains].sort((a, b) => (b.started_at ?? "").localeCompare(a.started_at ?? ""))[0];
}

export function readingsToCsv(rs: Reading[]): string {
  const head =
    "seq,boot,uptime_s,unix_time,utc_time,temp_c,rh_pct,pressure_hpa,gas_kohm,rtc_temp_c,mpu_temp_c,peak_g,moves,sensor_id,flags,signed,hash";
  const cell = (v: number | string | boolean | null) => (v == null ? "" : String(v));
  const lines = rs.map((r) =>
    [
      r.seq,
      r.boot,
      r.uptime_s,
      r.unix_time,
      r.unix_time > 0 ? new Date(r.unix_time * 1000).toISOString() : "",
      usable(r) ? r.temp_c : null,
      usable(r) ? r.rh_pct : null,
      usable(r) ? r.pressure_hpa : null,
      usable(r) ? r.gas_kohm : null,
      r.rtc_temp_c,
      r.mpu_temp_c,
      r.peak_g,
      r.moves,
      r.sensor_id,
      r.flags,
      r.signed,
      r.hash,
    ]
      .map(cell)
      .join(","),
  );
  return [head, ...lines].join("\n") + "\n";
}
