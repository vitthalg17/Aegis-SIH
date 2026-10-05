import { readAnchor } from "../lib/chain";
import type { Anchor, AnchorStatus, NodeInfo, Reading } from "../lib/types";
import { source } from "./source";

export interface AnchorResult {
  status: AnchorStatus | null;
  /** Set when the live read from Polygon failed and the stored copy was used instead */
  chainError: string | null;
}

const fromDb = (a: Anchor, src: AnchorStatus["source"]): AnchorStatus => ({
  seq: a.seq,
  hash: a.record_hash,
  anchoredAt: a.anchored_at ? new Date(a.anchored_at) : null,
  block: a.block,
  tx: a.tx,
  source: src,
});

/**
 * How far is this trip locked? In live mode the answer is read straight from Polygon (the stored copy in
 * the database is only a fallback). Demo mode uses the sample anchor.
 */
export async function resolveAnchor(node: NodeInfo, chainId: string, readings: Reading[]): Promise<AnchorResult> {
  const stored = (await source.listAnchors(node.node_id)).filter((a) => a.chain_id === chainId);
  const newest = stored[0] ?? null;

  if (source.mode === "demo") return { status: newest ? fromDb(newest, "demo") : null, chainError: null };

  if (node.pubkey) {
    try {
      const hashToSeq = new Map(readings.filter((r) => r.hash).map((r) => [r.hash, r.seq]));
      const read = await readAnchor(node.pubkey, hashToSeq);
      if (!read.anchor) return { status: null, chainError: null };
      const match = stored.find((a) => a.record_hash.toLowerCase() === read.anchor!.hash!.toLowerCase());
      return {
        status: { ...read.anchor, tx: match?.tx ?? null, block: match?.block ?? null },
        chainError: null,
      };
    } catch (e) {
      return {
        status: newest ? fromDb(newest, "database") : null,
        chainError: e instanceof Error ? e.message : "Could not read Polygon",
      };
    }
  }
  return { status: newest ? fromDb(newest, "database") : null, chainError: null };
}
