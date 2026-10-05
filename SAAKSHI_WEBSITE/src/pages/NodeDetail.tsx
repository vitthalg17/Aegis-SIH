import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { source } from "../data/source";
import { resolveAnchor } from "../data/anchor";
import { useAsync, useNow } from "../hooks";
import { deriveAlerts, ALERT_LABEL } from "../lib/alerts";
import { config } from "../lib/config";
import { explorerAddress, explorerBlock, explorerTx } from "../lib/chain";
import { fmtAgo, fmtDateTime, fmtDuration, fmtNum } from "../lib/format";
import { buildSeries, latestChain, readingsToCsv, tripStats } from "../lib/stats";
import { buildShareLink } from "../lib/share";
import { nodeStatus } from "../lib/status";
import type { Alert, Chain, NodeInfo } from "../lib/types";
import { BarChart, LineChart } from "../components/Chart";
import { Card, ErrorNote, Qr, SeverityBadge, Spinner, StatusBadge, Tile } from "../components/ui";
import { Lock } from "./Nodes";

const C = { temp: "var(--c-temp)", rh: "var(--c-rh)", press: "var(--c-press)", gas: "var(--c-gas)", jolt: "var(--c-jolt)", move: "var(--c-move)" };

export function NodeDetail() {
  const { nodeId = "" } = useParams();
  const now = useNow();
  const base = useAsync(async () => {
    const nodes = await source.listNodes();
    const node = nodes.find((n) => n.node_id === nodeId) ?? null;
    const chains = node ? await source.listChains(nodeId) : [];
    return { node, chains };
  }, [nodeId]);
  const [chainId, setChainId] = useState<string | null>(null);

  const chains = base.data?.chains ?? [];
  const chain = chains.find((c) => c.chain_id === chainId) ?? latestChain(chains);

  if (base.loading) return <Spinner label="Loading node" />;
  if (base.error) return <ErrorNote error={base.error} />;
  const node = base.data?.node;
  if (!node) {
    return (
      <div className="empty">
        <h2>Node not found</h2>
        <p>This node is not on your account.</p>
        <Link className="btn" to="/app">Back to nodes</Link>
      </div>
    );
  }

  const status = nodeStatus(node, now);
  return (
    <>
      <Link to="/app" className="back">All nodes</Link>
      <div className="page-head">
        <div>
          <h1>{node.name || node.node_id}</h1>
          <code className="id">{node.node_id}</code>
        </div>
        <div className="head-right">
          <StatusBadge status={status} />
          <span className="muted">Last seen {node.last_seen ? fmtAgo(node.last_seen, now) : "never"}</span>
        </div>
      </div>

      {!chain ? (
        <div className="empty">
          <h2>No trips yet</h2>
          <p>This node has not sent any verified records. Switch it on near the same WiFi as the ledger and its first trip will appear here.</p>
        </div>
      ) : (
        <Trip node={node} chain={chain} chains={chains} onChain={setChainId} />
      )}
    </>
  );
}

function Trip({ node, chain, chains, onChain }: { node: NodeInfo; chain: Chain; chains: Chain[]; onChain: (id: string) => void }) {
  const data = useAsync(async () => {
    const readings = await source.getReadings(node.node_id, chain.chain_id);
    const anchor = await resolveAnchor(node, chain.chain_id, readings);
    return { readings, anchor };
  }, [node.node_id, chain.chain_id]);

  const readings = data.data?.readings ?? [];
  const stats = useMemo(() => tripStats(readings, node), [readings, node]);
  const alerts = useMemo(() => deriveAlerts(node, chain, readings), [node, chain, readings]);
  const band: [number | null, number | null] | null = node.temp_lo != null || node.temp_hi != null ? [node.temp_lo, node.temp_hi] : null;

  const temp = useMemo(() => buildSeries(readings, (r) => r.temp_c), [readings]);
  const rh = useMemo(() => buildSeries(readings, (r) => r.rh_pct), [readings]);
  const press = useMemo(() => buildSeries(readings, (r) => r.pressure_hpa), [readings]);
  const gas = useMemo(() => buildSeries(readings, (r) => r.gas_kohm), [readings]);
  const jolts = useMemo(() => buildSeries(readings, (r) => r.peak_g, { needsSensor: false }), [readings]);
  const moves = useMemo(() => buildSeries(readings, (r) => r.moves, { needsSensor: false }), [readings]);

  const select = chains.length > 1 && (
    <label className="trip-select">
      Trip
      <select value={chain.chain_id} onChange={(e) => onChain(e.target.value)}>
        {chains.map((c) => (
          <option key={c.chain_id} value={c.chain_id}>
            {c.label ? `${c.label} (${c.chain_id})` : c.chain_id}{c.started_at ? `, ${fmtDateTime(c.started_at)}` : ""}
          </option>
        ))}
      </select>
    </label>
  );

  if (data.loading) return <Spinner label="Loading readings" />;
  if (data.error) return <ErrorNote error={data.error} />;

  const download = () => {
    const blob = new Blob([readingsToCsv(readings)], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${node.node_id}_${chain.chain_id}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const anchor = data.data!.anchor;
  const swapped = stats.sensorChanges > 0;

  return (
    <>
      <div className="trip-bar">
        <div>
          <h2 className="trip-title">{chain.label || "Trip"} <code className="id">{chain.chain_id}</code></h2>
          <p className="muted">
            {stats.firstTime ? `${fmtDateTime(stats.firstTime * 1000)} to ${fmtDateTime((stats.lastTime ?? 0) * 1000)}` : "No clock time recorded for this trip"}
          </p>
        </div>
        <div className="trip-actions">
          {select}
          <button className="btn" onClick={download}>Export CSV</button>
        </div>
      </div>

      {swapped && (
        <div className="notice notice-bad" role="alert">
          <strong>Sensor swapped.</strong> The temperature sensor's fingerprint changed {stats.sensorChanges} {stats.sensorChanges === 1 ? "time" : "times"} during this trip. Treat the readings after the change with caution.
        </div>
      )}
      {stats.timedFraction < 0.5 && (
        <div className="notice" role="note">The clock was not set for most of this trip, so the charts are plotted by record number instead of time.</div>
      )}

      <div className="tiles">
        <Tile label="Duration" value={stats.durationS != null ? fmtDuration(stats.durationS) : "n/a"} sub={`${stats.count.toLocaleString("en-IN")} records`} />
        <Tile label="Lowest" value={<>{fmtNum(stats.tempMin)}<small> °C</small></>} />
        <Tile label="Average" value={<>{fmtNum(stats.tempAvg)}<small> °C</small></>} />
        <Tile label="Highest" value={<>{fmtNum(stats.tempMax)}<small> °C</small></>} tone={band?.[1] != null && stats.tempMax != null && stats.tempMax > band[1] ? "bad" : undefined} />
        {band && (
          <Tile
            label="Outside allowed band"
            value={stats.outsideS > 0 ? fmtDuration(stats.outsideS) : "None"}
            sub={`${band[0] ?? "any"} to ${band[1] ?? "any"} °C`}
            tone={stats.outsideS > 0 ? "bad" : "good"}
          />
        )}
        <Tile label="Jolts over 1 g" value={stats.jolts} sub={`peak ${fmtNum(stats.peakG, 2)} g`} tone={stats.jolts ? "warn" : undefined} />
        <Tile label="Restarts" value={stats.restarts} sub="power-ons after the first" tone={stats.restarts ? "warn" : undefined} />
      </div>

      <div className="two">
        <IntegrityCard node={node} chain={chain} stats={stats} anchor={anchor} />
        <SharePanel node={node} chainId={chain.chain_id} />
      </div>

      <Card title="Temperature" aside={<span className="legend">line is the average, shading is min to max</span>}>
        <LineChart series={temp} color={C.temp} unit="°C" label="Temperature over the trip" band={band} />
      </Card>
      <div className="two">
        <Card title="Humidity"><LineChart series={rh} color={C.rh} unit="%" label="Relative humidity" decimals={0} height={180} /></Card>
        <Card title="Pressure"><LineChart series={press} color={C.press} unit="hPa" label="Air pressure" decimals={1} height={180} /></Card>
      </div>
      <Card title="Gas (VOC indicator)" aside={<span className="legend">gas resistance in kΩ; it drops as more volatile compounds build up</span>}>
        <LineChart series={gas} color={C.gas} unit="kΩ" label="Gas resistance" decimals={1} height={180} />
      </Card>

      <div className="two">
        <Card title="Jolts">
          {!stats.mpuSeen && <p className="muted small">The motion sensor is not reporting on this node, so jolts and movement are not recorded.</p>}
          <BarChart series={jolts} color={C.jolt} unit="g" label="Biggest jolt per period" threshold={1} height={160} />
        </Card>
        <Card title="Movement">
          <BarChart series={moves} color={C.move} unit="moments" label="Movement per period" value="sum" decimals={0} height={160} />
        </Card>
      </div>

      <Card title="Alerts on this trip" aside={<Link to="/app/alerts" className="link">All alerts</Link>}>
        <TripAlerts alerts={alerts} />
      </Card>

      <Card title="Data quality">
        <ul className="quality">
          <li><strong>{stats.sensorFails}</strong> records with a failed environment sensor (left out of the charts)</li>
          <li><strong>{stats.unsigned}</strong> unsigned records (each is covered by the next signed one)</li>
          <li><strong>{stats.rtcFails}</strong> records where the clock chip did not answer</li>
          <li><strong>{stats.mpuFails}</strong> records where the motion sensor did not answer</li>
        </ul>
      </Card>
    </>
  );
}

function TripAlerts({ alerts }: { alerts: Alert[] }) {
  if (!alerts.length) return <p className="muted">No alerts on this trip.</p>;
  return (
    <ul className="alert-list compact">
      {alerts.slice(0, 8).map((a) => (
        <li key={a.id}>
          <SeverityBadge severity={a.severity} />
          <div>
            <strong>{ALERT_LABEL[a.type]}</strong>
            <p>{a.message}</p>
          </div>
          <time>{fmtDateTime(a.created_at)}</time>
        </li>
      ))}
      {alerts.length > 8 && <li className="muted">and {alerts.length - 8} more in the alerts list</li>}
    </ul>
  );
}

function IntegrityCard({ node, chain, stats, anchor }: {
  node: NodeInfo; chain: Chain; stats: ReturnType<typeof tripStats>;
  anchor: Awaited<ReturnType<typeof resolveAnchor>>;
}) {
  const a = anchor.status;
  const sourceLabel = a?.source === "polygon" ? "Read live from Polygon just now" : a?.source === "demo" ? "Sample anchor from the team's test run" : "Stored copy from the relay";
  return (
    <Card title="Integrity">
      <div className="integrity">
        {a ? (
          <p className="anchor-line">
            <Lock /> Anchored up to record <strong>{a.seq}</strong>
            {a.anchoredAt && <> on <strong>{fmtDateTime(a.anchoredAt)}</strong></>}
          </p>
        ) : (
          <p className="anchor-line none">Not anchored on Polygon yet</p>
        )}
        {a && <p className="muted small">Every record up to that one is locked. {sourceLabel}.</p>}
        {anchor.chainError && (
          <div className="notice" role="note">Could not read Polygon ({anchor.chainError}). Showing the stored copy instead.</div>
        )}
        <dl className="kv">
          <div><dt>Records checked by the ledger</dt><dd>{stats.count.toLocaleString("en-IN")} of {(chain.last_seq - chain.first_seq + 1).toLocaleString("en-IN")}</dd></div>
          <div><dt>Unsigned records</dt><dd>{stats.unsigned}</dd></div>
          <div><dt>Trip (chain) ID</dt><dd><code>{chain.chain_id}</code></dd></div>
          <div><dt>Registry contract</dt><dd><a href={explorerAddress(config.registry)} target="_blank" rel="noreferrer"><code>{config.registry.slice(0, 10)}…{config.registry.slice(-6)}</code></a></dd></div>
          {a?.tx && <div><dt>Transaction</dt><dd><a href={explorerTx(a.tx)} target="_blank" rel="noreferrer">View on PolygonScan</a></dd></div>}
          {a?.block != null && !a.tx && <div><dt>Block</dt><dd><a href={explorerBlock(a.block)} target="_blank" rel="noreferrer">{a.block}</a></dd></div>}
        </dl>
        <p className="muted small">
          This page is a convenience copy. To prove a record is genuine, open the buyer link, which re-checks every signature in the browser.
          {node.pubkey == null && source.mode === "live" && " This node has no public key stored, so the anchor shown comes from the relay's log rather than a live chain read."}
        </p>
      </div>
    </Card>
  );
}

function SharePanel({ node, chainId }: { node: NodeInfo; chainId: string }) {
  const SITE_KEY = "saakshi.verifySite";
  const stored = (() => { try { return localStorage.getItem(SITE_KEY) ?? ""; } catch { return ""; } })();
  const [site, setSite] = useState(config.verifySite || stored);
  const keyState = useAsync(() => source.getShareKey(node.node_id), [node.node_id]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const qrWrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!config.verifySite) { try { localStorage.setItem(SITE_KEY, site); } catch { /* ignore */ } }
  }, [site]);

  const key = keyState.data;
  const link = key && site ? buildShareLink(site, node.node_id, chainId, key) : null;

  async function saveKey() {
    setBusy(true); setErr(null);
    try { await source.setShareKey(node.node_id, draft.trim()); setDraft(""); keyState.reload(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not save the key"); }
    finally { setBusy(false); }
  }

  const copy = async () => {
    if (!link) return;
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* clipboard blocked */ }
  };
  const downloadQr = () => {
    const canvas = qrWrap.current?.querySelector("canvas");
    if (!canvas) return;
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `${node.node_id}_${chainId}_qr.png`;
    a.click();
  };

  return (
    <Card title="Share with buyer">
      {!config.verifySite && (
        <label className="field">Verification site address
          <input value={site} onChange={(e) => setSite(e.target.value)} placeholder="https://your-site.netlify.app" inputMode="url" />
        </label>
      )}
      {keyState.loading ? <Spinner /> : !key ? (
        <div className="field">
          <label>View key for this node
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Paste the key from view_keys.json" autoComplete="off" spellCheck={false} />
          </label>
          <p className="muted small">The view key decrypts the readings on the buyer page. It is kept private to your account and goes only into the link after the # sign, which browsers never send to a server.</p>
          {err && <div className="notice notice-bad" role="alert">{err}</div>}
          <button className="btn btn-primary" onClick={saveKey} disabled={!draft.trim() || busy}>Save key</button>
        </div>
      ) : !link ? (
        <p className="muted">Enter the verification site address above to build the link.</p>
      ) : (
        <div className="share">
          <div ref={qrWrap}><Qr text={link} size={200} /></div>
          <div className="share-side">
            <p className="muted small">Anyone with this link can read this trip's data and check that it is genuine.</p>
            <input className="link-box" readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Buyer link" />
            <div className="row">
              <button className="btn btn-primary" onClick={copy}>{copied ? "Copied" : "Copy link"}</button>
              <button className="btn" onClick={downloadQr}>Download QR</button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
