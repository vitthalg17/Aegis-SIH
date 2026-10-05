/**
 * Buyer link for the public verification page:
 *   https://<site>/verify/?n=<NODE>[&c=<chain>]#k=<view key>
 * The #k= part is the decryption key. Browsers never send it to a server.
 */
export function buildShareLink(site: string, nodeId: string, chainId: string | null, viewKey: string): string {
  const base = site.replace(/\/+$/, "");
  const chain = chainId ? `&c=${encodeURIComponent(chainId)}` : "";
  return `${base}/verify/?n=${encodeURIComponent(nodeId)}${chain}#k=${viewKey.trim()}`;
}
