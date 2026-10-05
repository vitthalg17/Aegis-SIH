import { config } from "./config";
import type { AnchorStatus } from "./types";

/**
 * Read-only calls to SaakshiRegistry on Polygon Amoy. No web3 library: selectors and ABI words by hand,
 * the same approach as the public verification page.
 */
const SEL = {
  node: "0x7c97e6ec", // node(bytes32) -> x, y, registered
  headCount: "0xd9701e33", // headCount(bytes32) -> uint256
  headAt: "0x7b751af0", // headAt(bytes32, uint256) -> bytes32
  isAnchored: "0x4f0b5801", // isAnchored(bytes32) -> anchored, keyHash, seq, nodeTime, blockTime, relayer
};

const hex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");

const word = (n: number | bigint) => BigInt(n).toString(16).padStart(64, "0");
const strip = (h: string) => h.replace(/^0x/i, "").toLowerCase();

/** keyHash = sha256 of the 65-byte public key (04 || x || y) */
export async function keyHashOf(pubkeyHex: string): Promise<string> {
  const clean = strip(pubkeyHex);
  const bytes = new Uint8Array(clean.match(/../g)!.map((h) => parseInt(h, 16)));
  return hex(await crypto.subtle.digest("SHA-256", bytes));
}

type Call = { to: string; data: string };

async function rpcBatch(calls: Call[]): Promise<string[]> {
  const body = calls.map((c, i) => ({
    jsonrpc: "2.0",
    id: i,
    method: "eth_call",
    params: [{ to: c.to, data: c.data }, "latest"],
  }));
  let lastErr: unknown;
  for (const url of [config.rpcUrl, config.rpcFallback]) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`RPC ${res.status}`);
      const json = (await res.json()) as { id: number; result?: string; error?: { message: string } }[];
      const sorted = [...json].sort((a, b) => a.id - b.id);
      return sorted.map((r) => {
        if (r.error || r.result == null) throw new Error(r.error?.message ?? "empty RPC result");
        return r.result;
      });
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Could not reach Polygon");
}

const words = (result: string) => strip(result).match(/.{64}/g) ?? [];

export interface ChainRead {
  registered: boolean;
  headCount: number;
  /** Newest anchored head that is also a record in the trip. Null if none of the trip's records are anchored. */
  anchor: AnchorStatus | null;
}

/**
 * Finds how far a trip is locked: the newest record of the trip that is among the node's anchored heads.
 * `hashToSeq` maps record hash (any case, with or without 0x) to its seq.
 */
export async function readAnchor(pubkey: string, hashToSeq: Map<string, number>): Promise<ChainRead> {
  const keyHash = await keyHashOf(pubkey);
  const to = config.registry;

  const [nodeRes, countRes] = await rpcBatch([
    { to, data: SEL.node + keyHash },
    { to, data: SEL.headCount + keyHash },
  ]);
  const registered = BigInt("0x" + (words(nodeRes)[2] ?? "0")) > 0n;
  const headCount = Number(BigInt(countRes));
  if (!registered || headCount === 0) return { registered, headCount, anchor: null };

  // Newest heads first; 200 covers a long trip without hammering the public RPC
  const from = Math.max(0, headCount - 200);
  const idx: number[] = [];
  for (let i = headCount - 1; i >= from; i--) idx.push(i);
  const heads = await rpcBatch(idx.map((i) => ({ to, data: SEL.headAt + keyHash + word(i) })));

  const known = new Map<string, number>();
  for (const [h, s] of hashToSeq) known.set(strip(h), s);
  const hit = heads.map((h) => strip(h).slice(0, 64)).find((h) => known.has(h));
  if (!hit) return { registered, headCount, anchor: null };

  const [info] = await rpcBatch([{ to, data: SEL.isAnchored + hit }]);
  const w = words(info);
  const anchored = BigInt("0x" + w[0]) === 1n;
  if (!anchored) return { registered, headCount, anchor: null };
  const blockTime = Number(BigInt("0x" + w[4]));
  return {
    registered,
    headCount,
    anchor: {
      seq: Number(BigInt("0x" + w[2])),
      hash: "0x" + hit,
      anchoredAt: blockTime ? new Date(blockTime * 1000) : null,
      block: null,
      tx: null,
      source: "polygon",
    },
  };
}

export const explorerAddress = (a: string) => `${config.explorer}/address/${a}`;
export const explorerTx = (tx: string) => `${config.explorer}/tx/${tx}`;
export const explorerBlock = (b: number) => `${config.explorer}/block/${b}`;
