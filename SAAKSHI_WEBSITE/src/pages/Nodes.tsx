import { Link } from "react-router-dom";
import { source } from "../data/source";
import { useAsync, useNow } from "../hooks";
import { fmtAgo, fmtDateTime, fmtNum } from "../lib/format";
import { latestChain } from "../lib/stats";
import { FLAG, has } from "../lib/flags";
import { nodeStatus } from "../lib/status";
import type { Alert, NodeInfo } from "../lib/types";
import { ErrorNote, Spinner, StatusBadge } from "../components/ui";

export function Lock() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" className="icon-lock">
      <path d="M4.5 7V5a3.5 3.5 0 017 0v2M3.5 7h9v6.5h-9z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

export function Nodes() {
  const nodes = useAsync(() => source.listNodes(), []);
  const alerts = useAsync(() => source.listAlerts(), []);

  if (nodes.loading) return <Spinner label="Loading your nodes" />;
  if (nodes.error) return <ErrorNote error={nodes.error} />;
  const list = nodes.data ?? [];

  return (
    <>
      <div className="page-head">
        <h1>My nodes</h1>
        <p className="muted">{list.length} {list.length === 1 ? "node" : "nodes"}</p>
      </div>
      {list.length === 0 ? (
        <div className="empty">
          <h2>No nodes on this account yet</h2>
          <p>
            Once a node is linked to your company it appears here with its readings. If you have just ordered one,
            we will link it for you.
          </p>
        </div>
      ) : (
        <div className="grid">
          {list.map((n) => (
            <NodeCard key={n.node_id} node={n} alerts={(alerts.data ?? []).filter((a) => a.node_id === n.node_id && !a.acked_at)} />
          ))}
        </div>
      )}
    </>
  );
}

function NodeCard({ node, alerts }: { node: NodeInfo; alerts: Alert[] }) {
  const now = useNow();
  const info = useAsync(async () => {
    const chains = await source.listChains(node.node_id);
    const chain = latestChain(chains);
    const [reading, anchors] = await Promise.all([
      chain ? source.latestReading(node.node_id, chain.chain_id) : Promise.resolve(null),
      source.listAnchors(node.node_id),
    ]);
    return { chain, chains: chains.length, reading, anchor: anchors[0] ?? null };
  }, [node.node_id]);

  const status = nodeStatus(node, now);
  const { chain, chains, reading, anchor } = info.data ?? { chain: null, chains: 0, reading: null, anchor: null };
  const failed = reading ? has(reading.flags, FLAG.SENSOR_FAIL) : false;
  const high = alerts.filter((a) => a.severity === "high").length;

  return (
    <Link to={`/app/nodes/${node.node_id}`} className="node-card">
      <div className="node-card-top">
        <div>
          <h2>{node.name || node.node_id}</h2>
          <code className="id">{node.node_id}</code>
        </div>
        <StatusBadge status={status} />
      </div>

      {reading ? (
        <div className="node-reading">
          <div><span className="big">{failed ? "n/a" : fmtNum(reading.temp_c, 1)}</span><span className="unit"> °C</span></div>
          <div><span className="big">{failed ? "n/a" : fmtNum(reading.rh_pct, 0)}</span><span className="unit"> % RH</span></div>
        </div>
      ) : (
        <p className="muted node-none">{info.loading ? "Loading" : "No readings received yet"}</p>
      )}

      <dl className="node-meta">
        <div><dt>Last seen</dt><dd>{node.last_seen ? `${fmtAgo(node.last_seen, now)} (${fmtDateTime(node.last_seen)})` : "never"}</dd></div>
        <div>
          <dt>Current trip</dt>
          <dd>{chain ? <>{chain.label || <code>{chain.chain_id}</code>}{chains > 1 && <span className="muted"> · {chains} trips</span>}</> : "none"}</dd>
        </div>
      </dl>

      <div className="node-badges">
        {anchor ? (
          <span className="badge badge-good"><Lock /> Anchored up to record {anchor.seq}{anchor.anchored_at ? `, ${fmtDateTime(anchor.anchored_at)}` : ""}</span>
        ) : (
          <span className="badge badge-muted">Not anchored yet</span>
        )}
        {alerts.length > 0 && (
          <span className={`badge ${high ? "sev-high" : "sev-medium"}`}>{alerts.length} open {alerts.length === 1 ? "alert" : "alerts"}</span>
        )}
      </div>
    </Link>
  );
}
