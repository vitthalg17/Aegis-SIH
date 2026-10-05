import type { NodeInfo } from "./types";

export type NodeStatus = "online" | "offline" | "never";

export function nodeStatus(node: NodeInfo, now = Date.now()): NodeStatus {
  if (!node.last_seen) return "never";
  const limitMs = (node.offline_min != null ? node.offline_min * 60 : node.log_interval_s * 3) * 1000;
  return now - Date.parse(node.last_seen) > limitMs ? "offline" : "online";
}

export const STATUS_LABEL: Record<NodeStatus, string> = {
  online: "Online",
  offline: "Offline",
  never: "Never seen",
};
