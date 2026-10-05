# SAAKSHI website and SME dashboard

Team AEGIS_X, Smart India Hackathon 2026, problem statement 26232 (MoFPI).
Built from `SAAKSHI_DASHBOARD_HANDOVER.md` in the repository root.

The site has a public landing page with a "Request nodes" form, and a login-protected dashboard where an
exporter sees their nodes and trips, gets alerts, and shares a QR with the buyer.

**The dashboard is a convenience layer, never proof.** The public verification page (`saakshi_site/verify/`,
built separately) and the Polygon anchor stand on their own. This app holds no private keys.

## Run it

```bash
npm install
npm run dev        # http://localhost:5174
npm run build      # static site in dist/, ready for Netlify
```

With no `.env` it runs in **demo mode**: generated sample readings shaped like the real ledger file, edits saved
only in the browser, and a banner saying so. Nothing in demo mode is real data.

## Go live (Supabase)

1. Create a Supabase project. In the SQL editor, run `supabase/schema.sql`.
2. Copy `.env.example` to `.env` and fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (the anon key is
   public by design; row level security keeps each company to its own rows).
3. Set `VITE_VERIFY_SITE` to the Netlify address of the verification page. Optionally set `VITE_NODE_PRICE_INR`
   once the team confirms the price from the BOM sheet. Until then the landing page says "Price per node shared on request".
4. Sign up in the app. A database trigger creates your organisation.
5. Link a node to the company (the sync script creates the node row the first time it sees the ledger file):

   ```sql
   update nodes set org_id = '<org uuid>', pubkey = '04…130 hex chars…' where node_id = 'SAAKSHI-25D8016E';
   ```

   The public key is optional but lets the trip page read the anchor straight from Polygon. Without it the page
   shows the relay's stored copy and says so.
6. On the Mac, next to the ledger:

   ```bash
   cd sync
   export SUPABASE_URL=https://<project>.supabase.co
   export SUPABASE_SERVICE_KEY=<service_role key>     # stays on the Mac, never in the website
   python3 saakshi_dashboard_sync.py --dry-run         # check what it would send
   python3 saakshi_dashboard_sync.py                   # then leave it running
   ```

   Run it from the folder that holds `saakshi_ledger/` and `saakshi_relay/`, or set `SAAKSHI_LEDGER_DIR` and
   `SAAKSHI_RELAY_DIR`. Put the variables in `sync/.env` if you prefer (it is git-ignored).
7. On a trip page, open "Share with buyer" and paste the node's view key from `saakshi_relay/view_keys.json`.
   The QR then opens the existing verification page.

## What is where

```
src/pages/        Landing, Login, Nodes, NodeDetail (trip view), Alerts, Settings
src/components/   charts (hand-drawn SVG, min/max envelope), QR, shell
src/lib/          alert rules, trip stats, Polygon reads (no web3 library), share link, IST formatting
src/data/         one DataSource interface: demo.ts (sample data) and supabase.ts (live)
supabase/         schema.sql with row level security
sync/             saakshi_dashboard_sync.py (stdlib only), mirrors the alert rules in src/lib/alerts.ts
```

## Things to know

- Times are stored in UTC and shown in IST.
- Readings whose environment sensor failed are never plotted as 0 °C. Trips with no clock time are plotted by record number.
- A trip is one chain. A node can have several trips, and an account can have several nodes.
- Offline and "not anchored" alerts are computed in the browser from the current time. Everything else is raised by the sync script.
- `alerts.log` lines that do not contain a `SAAKSHI-XXXXXXXX` node ID are reported by the sync script and skipped.
- The sync script's reading of `posted.json` follows the handover (`{chain, seq, hash, tx, block, time}`); check it against a real file.
- The demo's sample anchor (record 2126, block 49371015, 5 Oct 2026 15:14 IST) comes from the handover. Its record hashes are generated, not real.

## Secrets

Never put these in this app, its database, or git: the relay wallet key, the broker CA key, broker passwords,
the WiFi password, or the Supabase service key. View keys may be stored per account (`share_links`, protected by
row level security) because the owner already holds them.
