import { FLAG, has } from "./flags";
import { gapSeconds, hasTime, outsideBand, usable } from "./stats";
import type { Alert, AlertType, Chain, NodeInfo, Reading, Severity } from "./types";
import { fmtDuration } from "./format";

const stamp = (r: Reading, node: NodeInfo) =>
  hasTime(r) ? new Date(r.unix_time * 1000).toISOString() : new Date(Date.parse(node.created_at)).toISOString();

/**
 * Alert rules over one trip. The Python sync script mirrors these rules for live mode
 * (sync/saakshi_dashboard_sync.py), so keep the two in step.
 */
export function deriveAlerts(node: NodeInfo, chain: Chain, rs: Reading[]): Alert[] {
  const out: Alert[] = [];
  const mk = (type: AlertType, severity: Severity, r: Reading, message: string) =>
    out.push({
      id: `${node.node_id}:${chain.chain_id}:${type}:${r.seq}`,
      node_id: node.node_id,
      chain_id: chain.chain_id,
      seq: r.seq,
      type,
      severity,
      message,
      created_at: stamp(r, node),
      acked_at: null,
    });

  // Temperature excursions: a run of out-of-band readings lasting longer than the threshold
  let run: Reading[] = [];
  const flush = () => {
    if (run.length) {
      const first = run[0];
      const last = run[run.length - 1];
      const gap = gapSeconds(first, last) ?? (run.length - 1) * node.log_interval_s;
      const dur = gap + node.log_interval_s;
      if (dur > node.excursion_min * 60) {
        const dir = outsideBand(first, node);
        const worst =
          dir === "high"
            ? Math.max(...run.map((x) => x.temp_c ?? -Infinity))
            : Math.min(...run.map((x) => x.temp_c ?? Infinity));
        const limit = dir === "high" ? node.temp_hi : node.temp_lo;
        mk(
          "excursion",
          "high",
          first,
          `Temperature reached ${worst.toFixed(1)} °C, ${dir === "high" ? "above" : "below"} the ${limit} °C limit, for about ${fmtDuration(dur)}`,
        );
      }
    }
    run = [];
  };
  for (const r of rs) {
    if (!usable(r)) continue;
    if (outsideBand(r, node)) run.push(r);
    else flush();
  }
  flush();

  for (const r of rs) {
    if (has(r.flags, FLAG.SHOCK)) mk("shock", "medium", r, `Jolt of ${r.peak_g.toFixed(2)} g (over 1 g)`);
    if (has(r.flags, FLAG.SENSOR_CHANGED))
      mk("sensor_changed", "high", r, "The temperature sensor fingerprint changed. The sensor may have been swapped.");
    if (has(r.flags, FLAG.TEMP_MISMATCH))
      mk("temp_mismatch", "medium", r, "The main thermometer disagrees with both backup thermometers by more than 6 °C");
  }

  // Security chip trouble: 3 or more unsigned records in a row
  let streak: Reading[] = [];
  const flushUnsigned = () => {
    if (streak.length >= 3)
      mk("unsigned", "medium", streak[0], `${streak.length} records in a row could not be signed by the security chip`);
    streak = [];
  };
  for (const r of rs) {
    if (has(r.flags, FLAG.UNSIGNED)) streak.push(r);
    else flushUnsigned();
  }
  flushUnsigned();

  return out;
}

/** Conditions that depend on the current time. Computed in the browser, never stored. */
export function liveAlerts(
  node: NodeInfo,
  lastChain: Chain | null,
  anchor: { seq: number; anchoredAt: Date | null } | null,
  now = Date.now(),
): Alert[] {
  const out: Alert[] = [];
  const nowIso = new Date(now).toISOString();

  if (node.last_seen) {
    const limitMin = node.offline_min ?? (node.log_interval_s * 3) / 60;
    const silentMin = (now - Date.parse(node.last_seen)) / 60000;
    if (silentMin > limitMin) {
      out.push({
        id: `${node.node_id}:offline`,
        node_id: node.node_id,
        chain_id: lastChain?.chain_id ?? null,
        seq: null,
        type: "offline",
        severity: "medium",
        message: `No record for ${fmtDuration(silentMin * 60)}`,
        created_at: nowIso,
        acked_at: null,
        live: true,
      });
    }
  }

  if (lastChain && lastChain.ended_at) {
    const newest = Date.parse(lastChain.ended_at);
    const anchorAt = anchor?.anchoredAt?.getTime() ?? null;
    const tailUnlocked = !anchor || lastChain.last_seq > anchor.seq;
    const since = anchorAt ?? (lastChain.started_at ? Date.parse(lastChain.started_at) : newest);
    const hours = (newest - since) / 3.6e6;
    if (tailUnlocked && hours > node.unanchored_hours) {
      out.push({
        id: `${node.node_id}:unanchored`,
        node_id: node.node_id,
        chain_id: lastChain.chain_id,
        seq: lastChain.last_seq,
        type: "unanchored",
        severity: "low",
        message: anchor
          ? `Newer records exist, and the last anchor is ${fmtDuration(hours * 3600)} older than the newest record`
          : "This trip has records but no anchor on Polygon yet",
        created_at: nowIso,
        acked_at: null,
        live: true,
      });
    }
  }
  return out;
}

export const ALERT_LABEL: Record<AlertType, string> = {
  excursion: "Temperature excursion",
  shock: "Jolt",
  sensor_changed: "Sensor swapped",
  temp_mismatch: "Thermometer mismatch",
  unsigned: "Unsigned records",
  ledger_refusal: "Record refused by ledger",
  offline: "Node offline",
  unanchored: "Not anchored",
};
