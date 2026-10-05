import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { source } from "../data/source";
import { useAsync } from "../hooks";
import { ALERT_LABEL, liveAlerts } from "../lib/alerts";
import { fmtDateTime } from "../lib/format";
import { latestChain } from "../lib/stats";
import type { Alert, Severity } from "../lib/types";
import { ErrorNote, SeverityBadge, Spinner } from "../components/ui";

const ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

export function Alerts() {
  const data = useAsync(async () => {
    const [stored, nodes] = await Promise.all([source.listAlerts(), source.listNodes()]);
    const live: Alert[] = [];
    for (const n of nodes) {
      const chain = latestChain(await source.listChains(n.node_id));
      const a = (await source.listAnchors(n.node_id)).find((x) => x.chain_id === chain?.chain_id) ?? null;
      live.push(...liveAlerts(n, chain, a ? { seq: a.seq, anchoredAt: a.anchored_at ? new Date(a.anchored_at) : null } : null));
    }
    return { alerts: [...live, ...stored], names: Object.fromEntries(nodes.map((n) => [n.node_id, n.name || n.node_id])) };
  }, []);

  const [show, setShow] = useState<"open" | "acked" | "all">("open");
  const [sev, setSev] = useState<"all" | Severity>("all");
  const [node, setNode] = useState("all");
  const [busy, setBusy] = useState<string | null>(null);

  const alerts = data.data?.alerts ?? [];
  const names = data.data?.names ?? {};
  const rows = useMemo(
    () =>
      alerts
        .filter((a) => (show === "all" ? true : show === "open" ? !a.acked_at : Boolean(a.acked_at)))
        .filter((a) => sev === "all" || a.severity === sev)
        .filter((a) => node === "all" || a.node_id === node)
        .sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || b.created_at.localeCompare(a.created_at)),
    [alerts, show, sev, node],
  );

  async function ack(id: string) {
    setBusy(id);
    try { await source.ackAlert(id); data.reload(); } finally { setBusy(null); }
  }

  if (data.loading && !data.data) return <Spinner label="Loading alerts" />;
  if (data.error) return <ErrorNote error={data.error} />;

  return (
    <>
      <div className="page-head">
        <h1>Alerts</h1>
        <p className="muted">{alerts.filter((a) => !a.acked_at).length} open</p>
      </div>

      <div className="filters">
        <label>Show
          <select value={show} onChange={(e) => setShow(e.target.value as typeof show)}>
            <option value="open">Open</option><option value="acked">Acknowledged</option><option value="all">All</option>
          </select>
        </label>
        <label>Severity
          <select value={sev} onChange={(e) => setSev(e.target.value as typeof sev)}>
            <option value="all">All</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
          </select>
        </label>
        <label>Node
          <select value={node} onChange={(e) => setNode(e.target.value)}>
            <option value="all">All nodes</option>
            {Object.entries(names).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </label>
      </div>

      {rows.length === 0 ? (
        <div className="empty"><h2>Nothing here</h2><p>No alerts match these filters.</p></div>
      ) : (
        <ul className="alert-list">
          {rows.map((a) => (
            <li key={a.id} className={a.acked_at ? "acked" : undefined}>
              <SeverityBadge severity={a.severity} />
              <div>
                <strong>{ALERT_LABEL[a.type]}</strong>
                <p>{a.message}</p>
                <p className="muted small">
                  <Link to={`/app/nodes/${a.node_id}`}>{names[a.node_id] ?? a.node_id}</Link>
                  {a.seq != null && <> · record {a.seq}</>}
                  {a.live && <> · live condition</>}
                </p>
              </div>
              <div className="alert-side">
                <time>{fmtDateTime(a.created_at)}</time>
                {a.live ? null : a.acked_at ? (
                  <span className="muted small">Acknowledged {fmtDateTime(a.acked_at)}</span>
                ) : (
                  <button className="btn" disabled={busy === a.id} onClick={() => ack(a.id)}>Acknowledge</button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
