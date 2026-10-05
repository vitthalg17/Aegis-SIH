import { useEffect, useRef, type ReactNode } from "react";
import QRCode from "qrcode";
import type { Severity } from "../lib/types";
import { STATUS_LABEL, type NodeStatus } from "../lib/status";

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <span className="logo">
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="8" fill="var(--accent)" />
        <path d="M9 17.5l5 5 9-12" fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="logo-word">SAAKSHI</span>
    </span>
  );
}

export function StatusBadge({ status }: { status: NodeStatus }) {
  return (
    <span className={`badge status-${status}`}>
      <span className="dot" />
      {STATUS_LABEL[status]}
    </span>
  );
}

const SEV_LABEL: Record<Severity, string> = { high: "High", medium: "Medium", low: "Low" };
export function SeverityBadge({ severity }: { severity: Severity }) {
  return <span className={`badge sev-${severity}`}>{SEV_LABEL[severity]}</span>;
}

export function Tile({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "warn" | "bad" | "good" }) {
  return (
    <div className={`tile${tone ? ` tone-${tone}` : ""}`}>
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
      {sub && <div className="tile-sub">{sub}</div>}
    </div>
  );
}

export function Card({ title, aside, children, id }: { title?: string; aside?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section className="card" id={id}>
      {(title || aside) && (
        <header className="card-head">
          {title && <h2>{title}</h2>}
          {aside}
        </header>
      )}
      {children}
    </section>
  );
}

export function Qr({ text, size = 200 }: { text: string; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    QRCode.toCanvas(ref.current, text, { width: size, margin: 2, errorCorrectionLevel: "M" }).catch(() => {});
  }, [text, size]);
  return <canvas ref={ref} width={size} height={size} className="qr" aria-label="QR code for the buyer link" role="img" />;
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return <div className="spinner" role="status">{label}</div>;
}

export function ErrorNote({ error }: { error: unknown }) {
  return <div className="notice notice-bad" role="alert">{error instanceof Error ? error.message : String(error)}</div>;
}
