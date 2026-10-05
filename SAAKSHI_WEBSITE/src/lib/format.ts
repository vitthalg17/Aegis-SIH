const TZ = "Asia/Kolkata";

const dateTime = new Intl.DateTimeFormat("en-IN", {
  timeZone: TZ, day: "numeric", month: "short", year: "numeric",
  hour: "2-digit", minute: "2-digit", hour12: false,
});
const timeOnly = new Intl.DateTimeFormat("en-IN", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
const dayOnly = new Intl.DateTimeFormat("en-IN", { timeZone: TZ, day: "numeric", month: "short" });
const dayYear = new Intl.DateTimeFormat("en-IN", { timeZone: TZ, day: "numeric", month: "short", year: "numeric" });

const toDate = (v: Date | string | number) => (v instanceof Date ? v : new Date(v));

/** "5 Oct 2026, 15:14 IST" */
export function fmtDateTime(v: Date | string | number | null | undefined): string {
  if (v == null) return "never";
  const d = toDate(v);
  if (Number.isNaN(d.getTime())) return "unknown";
  return `${dateTime.format(d).replace(/\bam\b|\bpm\b/gi, "").replace(/\s+,/, ",")} IST`;
}
export const fmtTime = (ms: number) => timeOnly.format(new Date(ms));
export const fmtDay = (ms: number) => dayOnly.format(new Date(ms));
export const fmtDate = (v: Date | string | number) => dayYear.format(toDate(v));

export function fmtDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "n/a";
  const s = Math.round(seconds);
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (h < 48) return rm ? `${h} h ${rm} min` : `${h} h`;
  const d = Math.floor(h / 24);
  return `${d} d ${h % 24} h`;
}

export function fmtAgo(v: Date | string | number | null, now = Date.now()): string {
  if (v == null) return "never";
  const diff = Math.max(0, (now - toDate(v).getTime()) / 1000);
  if (diff < 45) return "just now";
  return `${fmtDuration(diff)} ago`;
}

export const fmtNum = (v: number | null | undefined, digits = 1) =>
  v == null || !Number.isFinite(v) ? "n/a" : v.toFixed(digits);

export const shortHash = (h: string | null, n = 8) => (h ? `${h.replace(/^0x/, "").slice(0, n)}` : "n/a");
