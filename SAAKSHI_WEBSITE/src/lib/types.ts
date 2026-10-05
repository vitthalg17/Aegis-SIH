export interface NodeInfo {
  node_id: string;
  org_id: string | null;
  pubkey: string | null;
  name: string | null;
  product: string | null;
  log_interval_s: number;
  temp_lo: number | null;
  temp_hi: number | null;
  /** Minutes outside the band before an excursion alert is raised */
  excursion_min: number;
  /** Hours without a new anchor (while newer records exist) before an alert is raised */
  unanchored_hours: number;
  /** Minutes without a record before the node counts as offline. Null means 3 x log interval. */
  offline_min: number | null;
  last_seen: string | null;
  created_at: string;
}

export interface Chain {
  node_id: string;
  chain_id: string;
  first_seq: number;
  last_seq: number;
  started_at: string | null;
  ended_at: string | null;
  label: string | null;
}

export interface Reading {
  seq: number;
  boot: number;
  uptime_s: number;
  /** UTC seconds, 0 when the clock was not set */
  unix_time: number;
  temp_c: number | null;
  rh_pct: number | null;
  pressure_hpa: number | null;
  gas_kohm: number | null;
  rtc_temp_c: number | null;
  mpu_temp_c: number | null;
  peak_g: number;
  moves: number;
  sensor_id: string;
  flags: number;
  signed: boolean;
  hash: string;
}

export interface Anchor {
  node_id: string;
  chain_id: string;
  seq: number;
  record_hash: string;
  tx: string | null;
  block: number | null;
  anchored_at: string | null;
}

export type Severity = "high" | "medium" | "low";

export type AlertType =
  | "excursion"
  | "shock"
  | "sensor_changed"
  | "temp_mismatch"
  | "unsigned"
  | "ledger_refusal"
  | "offline"
  | "unanchored";

export interface Alert {
  id: string;
  node_id: string;
  chain_id: string | null;
  seq: number | null;
  type: AlertType;
  severity: Severity;
  message: string;
  created_at: string;
  acked_at: string | null;
  /** Live conditions (offline, unanchored) are computed in the browser and cannot be acknowledged */
  live?: boolean;
}

export interface OrderRequest {
  name: string;
  company: string;
  phone: string;
  email: string;
  nodes: number;
  product: string;
}

export interface AnchorStatus {
  seq: number;
  hash: string | null;
  anchoredAt: Date | null;
  block: number | null;
  tx: string | null;
  source: "polygon" | "database" | "demo";
}
