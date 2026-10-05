import { createClient } from "@supabase/supabase-js";
import type { DataSource } from "./source";
import type { Alert, Anchor, Chain, NodeInfo, Reading } from "../lib/types";
import { config } from "../lib/config";

export const supabase = createClient(config.supabaseUrl || "http://localhost", config.supabaseKey || "anon");

const PAGE = 1000;

function fail(error: { message: string } | null): asserts error is null {
  if (error) throw new Error(error.message);
}

/** Postgres numeric and bigint can arrive as strings; make them numbers once, here */
const num = (v: unknown): number | null => (v == null ? null : Number(v));

function toReading(row: Record<string, unknown>): Reading {
  return {
    seq: Number(row.seq),
    boot: Number(row.boot ?? 0),
    uptime_s: Number(row.uptime_s ?? 0),
    unix_time: Number(row.unix_time ?? 0),
    temp_c: num(row.temp_c),
    rh_pct: num(row.rh_pct),
    pressure_hpa: num(row.pressure_hpa),
    gas_kohm: num(row.gas_kohm),
    rtc_temp_c: num(row.rtc_temp_c),
    mpu_temp_c: num(row.mpu_temp_c),
    peak_g: Number(row.peak_g ?? 0),
    moves: Number(row.moves ?? 0),
    sensor_id: String(row.sensor_id ?? ""),
    flags: Number(row.flags ?? 0),
    signed: Boolean(row.signed),
    hash: String(row.hash ?? ""),
  };
}

function toNode(row: Record<string, unknown>): NodeInfo {
  return {
    node_id: String(row.node_id),
    org_id: (row.org_id as string | null) ?? null,
    pubkey: (row.pubkey as string | null) ?? null,
    name: (row.name as string | null) ?? null,
    product: (row.product as string | null) ?? null,
    log_interval_s: Number(row.log_interval_s ?? 600),
    temp_lo: num(row.temp_lo),
    temp_hi: num(row.temp_hi),
    excursion_min: Number(row.excursion_min ?? 10),
    unanchored_hours: Number(row.unanchored_hours ?? 6),
    offline_min: num(row.offline_min),
    last_seen: (row.last_seen as string | null) ?? null,
    created_at: String(row.created_at),
  };
}

export const supabaseSource: DataSource = {
  mode: "live",

  async listNodes() {
    const { data, error } = await supabase.from("nodes").select("*").order("created_at");
    fail(error);
    return (data ?? []).map(toNode);
  },

  async updateNode(nodeId, patch) {
    const { node_id: _id, org_id: _org, created_at: _c, last_seen: _l, ...editable } = patch;
    const { error } = await supabase.from("nodes").update(editable).eq("node_id", nodeId);
    fail(error);
  },

  async listChains(nodeId) {
    const { data, error } = await supabase.from("chains").select("*").eq("node_id", nodeId).order("started_at", { ascending: false });
    fail(error);
    return (data ?? []) as Chain[];
  },

  async getReadings(nodeId, chainId) {
    const out: Reading[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("readings")
        .select("*")
        .eq("node_id", nodeId)
        .eq("chain_id", chainId)
        .order("seq")
        .range(from, from + PAGE - 1);
      fail(error);
      out.push(...(data ?? []).map(toReading));
      if (!data || data.length < PAGE) break;
    }
    return out;
  },

  async latestReading(nodeId, chainId) {
    const { data, error } = await supabase
      .from("readings")
      .select("*")
      .eq("node_id", nodeId)
      .eq("chain_id", chainId)
      .order("seq", { ascending: false })
      .limit(1);
    fail(error);
    return data && data.length ? toReading(data[0]) : null;
  },

  async listAnchors(nodeId) {
    const { data, error } = await supabase.from("anchors").select("*").eq("node_id", nodeId).order("seq", { ascending: false });
    fail(error);
    return (data ?? []).map((r) => ({ ...r, seq: Number(r.seq), block: num(r.block) })) as Anchor[];
  },

  async listAlerts() {
    const { data, error } = await supabase.from("alerts").select("*").order("created_at", { ascending: false }).limit(500);
    fail(error);
    return (data ?? []).map(
      (r): Alert => ({
        id: String(r.id),
        node_id: r.node_id,
        chain_id: r.chain_id ?? null,
        seq: r.seq ?? null,
        type: r.type,
        severity: r.severity,
        message: r.message,
        created_at: r.created_at,
        acked_at: r.acked_at ?? null,
      }),
    );
  },

  async ackAlert(id) {
    const { data: auth } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("alerts")
      .update({ acked_at: new Date().toISOString(), acked_by: auth.user?.id ?? null })
      .eq("id", id);
    fail(error);
  },

  async getShareKey(nodeId) {
    const { data, error } = await supabase.from("share_links").select("view_key").eq("node_id", nodeId).maybeSingle();
    fail(error);
    return data?.view_key ?? null;
  },

  async setShareKey(nodeId, key) {
    const { error } = await supabase.from("share_links").upsert({ node_id: nodeId, view_key: key });
    fail(error);
  },

  async submitOrder(o) {
    const { error } = await supabase.from("order_requests").insert(o);
    fail(error);
  },
};
