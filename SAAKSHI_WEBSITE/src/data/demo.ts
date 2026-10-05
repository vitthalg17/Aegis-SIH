import type { DataSource } from "./source";
import type { Alert, Anchor, Chain, NodeInfo, Reading } from "../lib/types";
import { FLAG } from "../lib/flags";
import { deriveAlerts } from "../lib/alerts";

/**
 * Sample data for demo mode. It has the shape of the real ledger file
 * SAAKSHI-25D8016E_0674cefd.csv (2,127 records, 10 s apart) but the readings are generated, not real.
 * The anchor facts (seq 2126, block 49371015, 5 Oct 2026 15:14 IST) come from the team's handover.
 */

const NODE_A = "SAAKSHI-25D8016E";
const CHAIN_A = "0674cefd";
const NODE_B = "SAAKSHI-00000000";
const START = Date.UTC(2026, 9, 5, 3, 0, 0) / 1000;
const COUNT = 2127;
const INTERVAL = 10;

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fakeHash(seq: number): string {
  const r = rng(seq * 7919 + 13);
  let s = "0x";
  for (let i = 0; i < 64; i++) s += Math.floor(r() * 16).toString(16);
  return s;
}

function generate(): Reading[] {
  const r = rng(2127);
  const out: Reading[] = [];
  for (let seq = 0; seq < COUNT; seq++) {
    const rebooted = seq >= 1300;
    const boot = rebooted ? 2 : 1;
    const uptime = rebooted ? (seq - 1300) * INTERVAL : seq * INTERVAL;
    let flags = 0;
    if (seq === 0) flags |= FLAG.BOOT | FLAG.CLOCK_SET;
    if (seq === 1300) flags |= FLAG.BOOT;

    // A chilled box around 5 C with a slow swing, plus a door left open for about 25 minutes
    let temp = 5.0 + 0.7 * Math.sin(seq / 160) + (r() - 0.5) * 0.18;
    if (seq >= 880 && seq <= 1040) {
      const k = Math.sin(((seq - 880) / 160) * Math.PI);
      temp += k * 5.6;
    }
    const rh = 84 + 3 * Math.sin(seq / 230) + (r() - 0.5) * 0.8;
    const pressure = 1008.4 + 0.6 * Math.sin(seq / 700) + (r() - 0.5) * 0.12;
    const gas = 52 - seq * 0.0035 + (r() - 0.5) * 1.2;

    let peak = 0.02 + r() * 0.05;
    let moves = 0;
    if ((seq >= 600 && seq <= 660) || (seq >= 1480 && seq <= 1520)) {
      peak = 0.1 + r() * 0.3;
      moves = Math.floor(r() * 40);
      flags |= FLAG.MOTION;
    }
    if (seq === 640) { peak = 1.42; flags |= FLAG.SHOCK | FLAG.MOTION; moves = 120; }
    if (seq === 1500) { peak = 1.12; flags |= FLAG.SHOCK | FLAG.MOTION; moves = 85; }

    let t = temp, h = rh, p = pressure, g = gas;
    if (seq >= 1750 && seq <= 1752) {
      flags |= FLAG.SENSOR_FAIL;
      t = h = p = g = 0;
    }
    if (seq === 1900) flags |= FLAG.UNSIGNED;

    out.push({
      seq,
      boot,
      uptime_s: uptime,
      unix_time: START + seq * INTERVAL,
      temp_c: Math.round(t * 1000) / 1000,
      rh_pct: Math.round(h * 100) / 100,
      pressure_hpa: Math.round(p * 100) / 100,
      gas_kohm: Math.round(g * 1000) / 1000,
      rtc_temp_c: Math.round((temp + 0.4) * 100) / 100,
      mpu_temp_c: Math.round((temp + 0.9) * 100) / 100,
      peak_g: Math.round(peak * 1000) / 1000,
      moves,
      sensor_id: "0x6f3a91c2",
      flags,
      signed: !(flags & FLAG.UNSIGNED),
      hash: fakeHash(seq),
    });
  }
  return out;
}

const lastTime = new Date((START + (COUNT - 1) * INTERVAL) * 1000).toISOString();
const baseNodes: NodeInfo[] = [
  {
    node_id: NODE_A,
    org_id: "demo-org",
    pubkey: null,
    name: "Mango crate 1",
    product: "Mango, cold chain",
    log_interval_s: INTERVAL,
    temp_lo: 2,
    temp_hi: 8,
    excursion_min: 10,
    unanchored_hours: 6,
    offline_min: null,
    last_seen: lastTime,
    created_at: new Date(START * 1000).toISOString(),
  },
  {
    node_id: NODE_B,
    org_id: "demo-org",
    pubkey: null,
    name: "Banana crate (new node)",
    product: "Banana, ripening room",
    log_interval_s: 600,
    temp_lo: 13,
    temp_hi: 15,
    excursion_min: 30,
    unanchored_hours: 12,
    offline_min: null,
    last_seen: null,
    created_at: new Date(START * 1000).toISOString(),
  },
];

const chainA: Chain = {
  node_id: NODE_A,
  chain_id: CHAIN_A,
  first_seq: 0,
  last_seq: COUNT - 1,
  started_at: new Date(START * 1000).toISOString(),
  ended_at: lastTime,
  label: "Bench trip, 5 Oct 2026",
};

let readingsCache: Reading[] | null = null;
const readings = () => (readingsCache ??= generate());

const anchorA: Anchor = {
  node_id: NODE_A,
  chain_id: CHAIN_A,
  seq: COUNT - 1,
  record_hash: fakeHash(COUNT - 1),
  tx: null,
  block: 49371015,
  anchored_at: new Date(Date.UTC(2026, 9, 5, 9, 44, 0)).toISOString(),
};

const sampleLedgerAlert: Alert = {
  id: "demo:ledger:1",
  node_id: NODE_A,
  chain_id: CHAIN_A,
  seq: null,
  type: "ledger_refusal",
  severity: "high",
  message: "Sample entry: the ledger refused a record because its signature did not verify. A real one means tampering was attempted.",
  created_at: new Date(Date.UTC(2026, 9, 5, 6, 12, 0)).toISOString(),
  acked_at: null,
};

// Small local store so edits and acknowledgements survive a refresh in demo mode
const KEY = "saakshi.demo.v1";
interface Store {
  nodeEdits: Record<string, Partial<NodeInfo>>;
  acks: Record<string, string>;
  shareKeys: Record<string, string>;
  orders: unknown[];
}
function load(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { nodeEdits: {}, acks: {}, shareKeys: {}, orders: [], ...JSON.parse(raw) };
  } catch { /* storage blocked: demo still works for this session */ }
  return { nodeEdits: {}, acks: {}, shareKeys: {}, orders: [] };
}
let store = load();
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { /* ignore */ }
}

const nodes = () => baseNodes.map((n) => ({ ...n, ...store.nodeEdits[n.node_id] }));

export const demoSource: DataSource = {
  mode: "demo",
  async listNodes() {
    return nodes();
  },
  async updateNode(id, patch) {
    store.nodeEdits[id] = { ...store.nodeEdits[id], ...patch };
    save();
  },
  async listChains(nodeId) {
    return nodeId === NODE_A ? [chainA] : [];
  },
  async getReadings(nodeId) {
    return nodeId === NODE_A ? readings() : [];
  },
  async latestReading(nodeId) {
    if (nodeId !== NODE_A) return null;
    const rs = readings();
    return rs[rs.length - 1];
  },
  async listAnchors(nodeId) {
    return nodeId === NODE_A ? [anchorA] : [];
  },
  async listAlerts() {
    const node = nodes().find((n) => n.node_id === NODE_A)!;
    const all = [...deriveAlerts(node, chainA, readings()), sampleLedgerAlert];
    return all
      .map((a) => ({ ...a, acked_at: store.acks[a.id] ?? null }))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  },
  async ackAlert(id) {
    store.acks[id] = new Date().toISOString();
    save();
  },
  async getShareKey(nodeId) {
    return store.shareKeys[nodeId] ?? null;
  },
  async setShareKey(nodeId, key) {
    store.shareKeys[nodeId] = key;
    save();
  },
  async submitOrder(order) {
    store.orders.push({ ...order, at: new Date().toISOString() });
    save();
  },
};

export const DEMO_ANCHOR_DATE = anchorA.anchored_at;
export function resetDemo() {
  store = { nodeEdits: {}, acks: {}, shareKeys: {}, orders: [] };
  save();
}
