#!/usr/bin/env python3
"""
SAAKSHI dashboard sync.

Runs on the Mac next to the ledger. Every ~30 s it pushes the ledger's verified records, the relay's
anchors and the ledger's alerts into the dashboard database (Supabase).

  python3 saakshi_dashboard_sync.py                 # loop forever
  python3 saakshi_dashboard_sync.py --once          # one pass, then exit
  python3 saakshi_dashboard_sync.py --dry-run       # parse and print what would be sent, no network

Settings come from environment variables or a file called sync/.env (git-ignored):
  SUPABASE_URL          https://<project>.supabase.co
  SUPABASE_SERVICE_KEY  the service_role key. It stays on this Mac. Never put it in the website.
  SAAKSHI_LEDGER_DIR    default ./saakshi_ledger
  SAAKSHI_RELAY_DIR     default ./saakshi_relay

Only stdlib is used. Only records the ledger already verified are ever read, and nothing here touches
a private key.
"""
import argparse
import csv
import hashlib
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
STATE_FILE = HERE / ".sync_state.json"

# Record flags (firmware Record struct)
BOOT, SENSOR_FAIL, NO_TIME, CLOCK_SET = 0x1, 0x2, 0x4, 0x8
MOTION, SHOCK, TEMP_MISMATCH, SENSOR_CHANGED = 0x10, 0x20, 0x40, 0x80
UNSIGNED, RTC_FAIL, MPU_FAIL = 0x100, 0x200, 0x400

FILE_RE = re.compile(r"^(SAAKSHI-[0-9A-F]{8})_([0-9a-f]{8})\.csv$")
NODE_RE = re.compile(r"SAAKSHI-[0-9A-F]{8}")
BATCH = 500


def load_env():
    env_file = HERE / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def iso(unix):
    return datetime.fromtimestamp(unix, tz=timezone.utc).isoformat() if unix else None


# ---- Parsing (same columns as saakshi_relay.py's parse_row) -------------------------------------

def opt_float(s):
    s = (s or "").strip()
    return float(s) if s else None


def parse_row(row):
    flags = int(row["flags"])
    return {
        "seq": int(row["seq"]),
        "boot": int(row["boot"]),
        "uptime_s": int(row["uptime_s"]),
        "unix_time": int(row["unix_time"]),
        "temp_c": opt_float(row["temp_c"]),
        "rh_pct": opt_float(row["rh_pct"]),
        "pressure_hpa": opt_float(row["pressure_hpa"]),
        "gas_kohm": opt_float(row["gas_kohm"]),
        "rtc_temp_c": opt_float(row["rtc_temp_c"]),
        "mpu_temp_c": opt_float(row["mpu_temp_c"]),
        "peak_g": opt_float(row["peak_g"]) or 0,
        "moves": int(row["moves"] or 0),
        "sensor_id": row["sensor_id"],
        "flags": flags,
        "signed": not (flags & UNSIGNED),
        "hash": row["hash"],
    }


def read_new_lines(path, offset):
    """Complete lines after `offset`. A last line without a newline is still being written: skip it."""
    with open(path, "rb") as f:
        f.seek(offset)
        data = f.read()
    end = data.rfind(b"\n")
    if end < 0:
        return [], offset
    return data[: end + 1].decode("utf-8", "replace").splitlines(), offset + end + 1


def parse_csv_lines(lines, header):
    """Returns parsed readings. Bad lines are reported and skipped, never guessed at."""
    out = []
    for raw in csv.DictReader(io.StringIO("\n".join(lines)), fieldnames=header):
        if raw["seq"] == "seq":
            continue
        try:
            out.append(parse_row(raw))
        except (ValueError, KeyError, TypeError) as e:
            print(f"  skipped a malformed line (seq={raw.get('seq')}): {e}", file=sys.stderr)
    return out


# ---- Alert rules. Mirrors src/lib/alerts.ts in the website; keep the two in step. ----------------

def gap_seconds(a, b):
    if a["unix_time"] and b["unix_time"]:
        return max(0, b["unix_time"] - a["unix_time"])
    if a["boot"] == b["boot"]:
        return max(0, b["uptime_s"] - a["uptime_s"])
    return None


def derive_alerts(node_id, chain_id, rows, node):
    lo, hi = node.get("temp_lo"), node.get("temp_hi")
    interval = node.get("log_interval_s") or 600
    exc_min = node.get("excursion_min") or 10
    out = []

    def add(kind, sev, r, msg):
        out.append({
            "dedupe_key": f"{node_id}:{chain_id}:{kind}:{r['seq']}",
            "node_id": node_id, "chain_id": chain_id, "seq": r["seq"],
            "type": kind, "severity": sev, "message": msg,
            "created_at": iso(r["unix_time"]) or datetime.now(timezone.utc).isoformat(),
        })

    def side(r):
        if r["flags"] & SENSOR_FAIL or r["temp_c"] is None:
            return None
        if lo is not None and r["temp_c"] < float(lo):
            return "low"
        if hi is not None and r["temp_c"] > float(hi):
            return "high"
        return None

    run = []

    def flush():
        nonlocal run
        if run:
            dur = (gap_seconds(run[0], run[-1]) or (len(run) - 1) * interval) + interval
            if dur > exc_min * 60:
                d = side(run[0])
                temps = [x["temp_c"] for x in run]
                worst = max(temps) if d == "high" else min(temps)
                limit = hi if d == "high" else lo
                add("excursion", "high", run[0],
                    f"Temperature reached {worst:.1f} °C, {'above' if d == 'high' else 'below'} the {limit} °C limit, "
                    f"for about {round(dur / 60)} min")
        run = []

    for r in rows:
        if r["flags"] & SENSOR_FAIL:
            continue
        if side(r):
            run.append(r)
        else:
            flush()
    flush()

    for r in rows:
        if r["flags"] & SHOCK:
            add("shock", "medium", r, f"Jolt of {r['peak_g']:.2f} g (over 1 g)")
        if r["flags"] & SENSOR_CHANGED:
            add("sensor_changed", "high", r,
                "The temperature sensor fingerprint changed. The sensor may have been swapped.")
        if r["flags"] & TEMP_MISMATCH:
            add("temp_mismatch", "medium", r,
                "The main thermometer disagrees with both backup thermometers by more than 6 °C")

    streak = []
    for r in rows + [None]:
        if r is not None and r["flags"] & UNSIGNED:
            streak.append(r)
            continue
        if len(streak) >= 3:
            add("unsigned", "medium", streak[0],
                f"{len(streak)} records in a row could not be signed by the security chip")
        streak = []
    return out


# ---- Supabase REST ------------------------------------------------------------------------------

class Api:
    def __init__(self, url, key, dry):
        self.url, self.key, self.dry = url.rstrip("/"), key, dry

    def call(self, method, path, body=None, prefer=None):
        if self.dry:
            n = len(body) if isinstance(body, list) else 1
            print(f"  [dry-run] {method} {path}  ({n} row{'s' if n != 1 else ''})")
            return []
        headers = {"apikey": self.key, "Authorization": f"Bearer {self.key}", "Content-Type": "application/json"}
        if prefer:
            headers["Prefer"] = prefer
        req = urllib.request.Request(f"{self.url}/rest/v1/{path}", method=method, headers=headers,
                                     data=json.dumps(body).encode() if body is not None else None)
        try:
            with urllib.request.urlopen(req, timeout=30) as res:
                text = res.read().decode()
                return json.loads(text) if text else []
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"{method} {path} failed: {e.code} {e.read().decode()[:300]}") from None

    def upsert(self, table, rows, conflict, ignore=False):
        for i in range(0, len(rows), BATCH):
            res = "ignore-duplicates" if ignore else "merge-duplicates"
            self.call("POST", f"{table}?on_conflict={conflict}", rows[i:i + BATCH], prefer=f"resolution={res}")


# ---- One pass -----------------------------------------------------------------------------------

def load_state():
    try:
        return json.loads(STATE_FILE.read_text())
    except (OSError, ValueError):
        return {"files": {}, "alerts_log": 0}


def sync_ledger(api, ledger_dir, state):
    chain_to_node = {}
    for path in sorted(ledger_dir.glob("SAAKSHI-*.csv")):
        m = FILE_RE.match(path.name)
        if not m:
            continue
        node_id, chain_id = m.groups()
        chain_to_node[chain_id] = node_id
        st = state["files"].setdefault(path.name, {"offset": 0, "header": None, "first": None, "last": None})

        if path.stat().st_size <= st["offset"]:
            continue
        lines, new_offset = read_new_lines(path, st["offset"])
        if not lines:
            continue
        if st["header"] is None:
            st["header"] = next(csv.reader([lines[0]]))
            lines = lines[1:]
        rows = parse_csv_lines(lines, st["header"])
        if not rows:
            st["offset"] = new_offset
            continue

        timed = [r for r in rows if r["unix_time"]]
        first = st["first"] or {"seq": rows[0]["seq"], "t": timed[0]["unix_time"] if timed else None}
        if first["t"] is None and timed:
            first["t"] = timed[0]["unix_time"]
        last_t = timed[-1]["unix_time"] if timed else (st["last"] or {}).get("t")
        last = {"seq": rows[-1]["seq"], "t": last_t}
        print(f"{path.name}: {len(rows)} new records (seq {rows[0]['seq']} to {rows[-1]['seq']})")

        # Node row is created only if missing, so an admin's org link, name and key are never overwritten
        api.upsert("nodes", [{"node_id": node_id}], "node_id", ignore=True)
        api.upsert("chains", [{
            "node_id": node_id, "chain_id": chain_id,
            "first_seq": first["seq"], "last_seq": last["seq"],
            "started_at": iso(first["t"]), "ended_at": iso(last["t"]),
        }], "node_id,chain_id")
        api.upsert("readings", [{**r, "node_id": node_id, "chain_id": chain_id} for r in rows],
                   "node_id,chain_id,seq")
        api.call("PATCH", f"nodes?node_id=eq.{node_id}",
                 {"last_seen": datetime.now(timezone.utc).isoformat()})

        # Alerts are derived from the whole file so a run that spans two passes is still caught once
        node = (api.call("GET", f"nodes?node_id=eq.{node_id}&select=*") or [{}])[0]
        with open(path, "rb") as fh:  # only up to the last complete line
            all_lines = fh.read(new_offset).decode("utf-8", "replace").splitlines()
        full = parse_csv_lines(all_lines[1:], st["header"])
        alerts = derive_alerts(node_id, chain_id, full, node)
        if alerts:
            api.upsert("alerts", alerts, "dedupe_key", ignore=True)

        st["offset"], st["first"], st["last"] = new_offset, first, last
    return chain_to_node


def sync_anchors(api, relay_dir, chain_to_node):
    """saakshi_relay/posted.json: every head the relay posted: {chain, seq, hash, tx, block, time}"""
    posted = relay_dir / "posted.json"
    if not posted.exists():
        return
    try:
        data = json.loads(posted.read_text())
    except ValueError:
        return
    if isinstance(data, dict):
        data = data.get("posted") or [x for v in data.values() if isinstance(v, list) for x in v]
    rows = []
    for p in data:
        node_id = chain_to_node.get(p.get("chain"))
        if not node_id:
            continue
        t = p.get("time")
        rows.append({
            "node_id": node_id, "chain_id": p["chain"], "seq": int(p["seq"]),
            "record_hash": p["hash"], "tx": p.get("tx"), "block": p.get("block"),
            "anchored_at": iso(t) if isinstance(t, (int, float)) else t,
        })
    if rows:
        print(f"anchors: {len(rows)} posted heads")
        api.upsert("anchors", rows, "node_id,chain_id,seq")


def sync_alerts_log(api, ledger_dir, state):
    """Every line in alerts.log is a refused or suspicious record: tampering was attempted"""
    log = ledger_dir / "alerts.log"
    if not log.exists():
        return
    lines, new_offset = read_new_lines(log, state.get("alerts_log", 0))
    rows = []
    for line in lines:
        line = line.strip()
        node = NODE_RE.search(line)
        if not line or not node:
            if line:
                print(f"  alerts.log line has no node id, not synced: {line[:80]}", file=sys.stderr)
            continue
        rows.append({
            "dedupe_key": "ledger:" + hashlib.sha1(line.encode()).hexdigest(),
            "node_id": node.group(0), "type": "ledger_refusal", "severity": "high",
            "message": f"The ledger refused or flagged a record: {line[:300]}",
        })
    if rows:
        print(f"alerts.log: {len(rows)} new entries")
        # Alerts need an existing node row
        api.upsert("nodes", [{"node_id": n} for n in {r["node_id"] for r in rows}], "node_id", ignore=True)
        api.upsert("alerts", rows, "dedupe_key", ignore=True)
    state["alerts_log"] = new_offset


def run_once(api, ledger_dir, relay_dir, dry):
    state = load_state()
    chain_to_node = sync_ledger(api, ledger_dir, state)
    sync_anchors(api, relay_dir, chain_to_node)
    sync_alerts_log(api, ledger_dir, state)
    if not dry:
        STATE_FILE.write_text(json.dumps(state))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--once", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--every", type=int, default=30, help="seconds between passes")
    args = ap.parse_args()

    load_env()
    ledger_dir = Path(os.environ.get("SAAKSHI_LEDGER_DIR", "saakshi_ledger"))
    relay_dir = Path(os.environ.get("SAAKSHI_RELAY_DIR", "saakshi_relay"))
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_KEY")
    if not args.dry_run and not (url and key):
        sys.exit("Set SUPABASE_URL and SUPABASE_SERVICE_KEY (environment or sync/.env), or use --dry-run.")
    if not ledger_dir.is_dir():
        sys.exit(f"Ledger folder not found: {ledger_dir}")

    api = Api(url or "http://dry-run", key or "", args.dry_run)
    while True:
        try:
            run_once(api, ledger_dir, relay_dir, args.dry_run)
        except Exception as e:  # keep the loop alive through network drops
            print(f"pass failed: {e}", file=sys.stderr)
            if args.once:
                sys.exit(1)
        if args.once or args.dry_run:
            break
        time.sleep(args.every)


if __name__ == "__main__":
    main()
