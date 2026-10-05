import type { Alert, Anchor, Chain, NodeInfo, OrderRequest, Reading } from "../lib/types";
import { liveMode } from "../lib/config";
import { demoSource } from "./demo";
import { supabaseSource } from "./supabase";

export interface DataSource {
  mode: "demo" | "live";
  listNodes(): Promise<NodeInfo[]>;
  updateNode(nodeId: string, patch: Partial<NodeInfo>): Promise<void>;
  listChains(nodeId: string): Promise<Chain[]>;
  getReadings(nodeId: string, chainId: string): Promise<Reading[]>;
  latestReading(nodeId: string, chainId: string): Promise<Reading | null>;
  listAnchors(nodeId: string): Promise<Anchor[]>;
  /** Stored alerts (from the sync script in live mode) for every node the user can see */
  listAlerts(): Promise<Alert[]>;
  ackAlert(id: string): Promise<void>;
  getShareKey(nodeId: string): Promise<string | null>;
  setShareKey(nodeId: string, key: string): Promise<void>;
  submitOrder(order: OrderRequest): Promise<void>;
}

export const source: DataSource = liveMode ? supabaseSource : demoSource;
