import { useState, type FormEvent } from "react";
import { source } from "../data/source";
import { resetDemo } from "../data/demo";
import { useAsync } from "../hooks";
import type { NodeInfo } from "../lib/types";
import { Card, ErrorNote, Spinner } from "../components/ui";

const numOrNull = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim();
  return s === "" ? null : Number(s);
};

export function Settings() {
  const nodes = useAsync(() => source.listNodes(), []);
  if (nodes.loading) return <Spinner label="Loading settings" />;
  if (nodes.error) return <ErrorNote error={nodes.error} />;

  return (
    <>
      <div className="page-head">
        <h1>Settings</h1>
        <p className="muted">Names, allowed temperature and when to raise alerts, for each node.</p>
      </div>
      {(nodes.data ?? []).map((n) => <NodeSettings key={n.node_id} node={n} />)}
      {source.mode === "demo" && (
        <Card title="Demo data">
          <p className="muted">Clears the names, thresholds, acknowledgements and keys you changed in this browser.</p>
          <button className="btn" onClick={() => { resetDemo(); nodes.reload(); }}>Reset demo changes</button>
        </Card>
      )}
    </>
  );
}

function NodeSettings({ node }: { node: NodeInfo }) {
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const lo = numOrNull(f.get("lo"));
    const hi = numOrNull(f.get("hi"));
    if (lo != null && hi != null && lo >= hi) { setError("The lowest allowed temperature must be below the highest."); return; }
    setBusy(true); setError(null); setSaved(false);
    try {
      await source.updateNode(node.node_id, {
        name: String(f.get("name")).trim() || null,
        product: String(f.get("product")).trim() || null,
        temp_lo: lo,
        temp_hi: hi,
        excursion_min: numOrNull(f.get("exc")) ?? 10,
        offline_min: numOrNull(f.get("off")),
        unanchored_hours: numOrNull(f.get("anc")) ?? 6,
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally { setBusy(false); }
  }

  return (
    <Card title={node.name || node.node_id} aside={<code className="id">{node.node_id}</code>}>
      <form className="form" onSubmit={submit} onChange={() => setSaved(false)}>
        <div className="form-row">
          <label>Name<input name="name" defaultValue={node.name ?? ""} placeholder="Mango crate 1" /></label>
          <label>Product<input name="product" defaultValue={node.product ?? ""} placeholder="Mango, banana, dairy" /></label>
        </div>
        <div className="form-row">
          <label>Lowest allowed temperature (°C)<input name="lo" type="number" step="0.1" defaultValue={node.temp_lo ?? ""} /></label>
          <label>Highest allowed temperature (°C)<input name="hi" type="number" step="0.1" defaultValue={node.temp_hi ?? ""} /></label>
        </div>
        <div className="form-row three">
          <label>Excursion alert after (minutes)<input name="exc" type="number" min={1} defaultValue={node.excursion_min} /></label>
          <label>Offline alert after (minutes)<input name="off" type="number" min={1} defaultValue={node.offline_min ?? ""} placeholder={`${Math.max(1, Math.round((node.log_interval_s * 3) / 60))} (3 x interval)`} /></label>
          <label>Not anchored alert after (hours)<input name="anc" type="number" min={1} defaultValue={node.unanchored_hours} /></label>
        </div>
        <p className="muted small">Cold chain is usually 2 to 8 °C. Leave a limit empty for no limit on that side.</p>
        {error && <div className="notice notice-bad" role="alert">{error}</div>}
        <div className="row">
          <button className="btn btn-primary" disabled={busy}>{busy ? "Saving" : "Save"}</button>
          {saved && <span className="saved" role="status">Saved</span>}
        </div>
      </form>
    </Card>
  );
}
