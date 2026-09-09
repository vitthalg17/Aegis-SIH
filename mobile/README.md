# AEGIS — farmer's phone app

Tier 3 of the connectivity architecture (`data_flow_architecture.md` §7, §14).
The app holds a local replica of the Jetson's advisory database and pulls a
delta from the field station whenever the two happen to be near each other.

It is built **fixture-first**: it runs with no drone, no Jetson, no network and
no ML model. Everything below works today.

## Running it

```bash
cd mobile
npm install
npm start          # Expo dev server
npm test           # schema validator, 14 tests, no test framework needed
npm run typecheck
npm run station    # fake Jetson serving the §7.4 API from the fixtures
```

`npm start` runs in Expo Go, which is enough for all UI work. Syncing against a
real field station needs a dev build — see **Android** below.

### Testing the sync without a drone

§12 item 1 says no connectivity demo is possible until the Jetson WiFi hardware
is ordered. That blocks the *radio*, not the protocol — localhost is a link.

```bash
npm run station                    # then point the app at http://<LAN-IP>:8080
npm run station -- --flaky         # fails ~1 fetch in 3, to exercise resumability
npm run station -- --slow 800      # 800 ms per response
```

Every advisory it serves carries `x-aegis-simulated: true`, and the app stores
anything with that header as `origin: 'fixture'`. A simulator that let invented
numbers arrive looking measured would build failure pattern #1 into the test
rig, so the header decides the origin rather than the app's optimism about what
it just connected to.

## What is here

| Path | What it does |
|---|---|
| `src/schema/advisory.ts` | §7.3 advisory as TypeScript. Written to be vendored to the Jetson side unchanged. |
| `src/schema/validate.ts` | The four §7.3 rules, mechanically enforced. |
| `src/schema/validate.test.ts` | 14 tests: every fixture passes, and every rule actually fires when broken. |
| `fixtures/` | Five advisories. One clean, four degraded. |
| `src/db/` | SQLite replica, migrations, ingest, sync cursor. |
| `src/sync/client.ts` | The delta pull: cursor → manifest → fetch → ack. |
| `src/sync/network.ts` | The §14.1 platform boundary. All of it, in one file. |
| `src/ui/` | Renderer primitives and advisory blocks. |
| `app/` | Three screens: history, advisory, field station. |
| `tools/fake-field-station.mjs` | A fake Jetson, so the delta pull is testable with no hardware. |

## The schema is the contract

`validateAdvisory()` runs on every advisory at ingest and enforces §7.3:

1. **Absence is `null` plus a machine-readable reason** — never a default, never
   zero, never an interpolated guess.
2. **Every threshold carries `threshold_source` and `threshold_confirmed`** — a
   `PROVISIONAL_*` figure must not render like an ICAR-sourced one.
3. **`inputs[]` is mandatory and complete** — a section that produced a number
   must declare the input it came from.
4. **`source` on every numeric field** — `measured` | `derived` | `provisional`.

An advisory that fails is **stored with its violations and rendered as broken**,
not dropped and not quietly displayed. Catching a fabricated number and then
throwing away the evidence would defeat the point of catching it.

The renderer is built so the honest rendering is the only one reachable:
`<Measurement>` takes a value and its status together and has no prop that makes
a `null` render as `0`, blank, or a dash.

## Fixtures

Four of the five are degraded on purpose — the degraded rendering is what gets
skipped when a demo is built happy-path-first.

| Fixture | Exercises |
|---|---|
| `advisory-clean` | Everything healthy. NDVI still pending, as it always is. |
| `advisory-baseline-init` | CWSI mid-baseline with a countdown; FAO-56 unseeded; trap rate withheld under a 1-day window. |
| `advisory-stale-trap` | Node power pulled. Inputs STALE then MISSING, CWSI unavailable, the gap declared. |
| `advisory-rtc-invalid` | Dead RTC. `rtc_valid:false` propagates to the UI and thermal is excluded from CWSI. |
| `advisory-provisional-threshold` | An uncited threshold that is over its limit, plus a 54 h old trap image and invalid Jetson GPS time. |

All five load with `origin: 'fixture'` and are labelled **SAMPLE DATA · NOT A
MEASUREMENT** wherever they appear. `origin` is a three-way distinction —
`synced` / `replay` / `fixture` — because §13.0.1 forbids presenting replayed or
invented history as live measurement, and those are three different claims.

## Two platform gotchas (§14.1)

**Android.** Joined to a WiFi network with no internet, Android keeps the
default route on mobile data, so a request to `192.168.4.1` leaves over cellular
and times out. It looks exactly like a dead server.

The fix is `ConnectivityManager.requestNetwork()` with `TRANSPORT_WIFI` and
*without* `NET_CAPABILITY_INTERNET`, then binding to the returned `Network`.
That is native code — it cannot run in Expo Go.

**That native module is not written yet.** `src/sync/network.ts` exposes the
interface, ships a no-op, and reports `bound: false`, so the sync screen says
plainly that binding is unavailable instead of failing mysteriously later.
`explainNetworkFailure()` names the cause when a local-address request times
out. Turning mobile data off is the workaround until the module lands.

`app.json` already sets `usesCleartextTraffic` (§11 chose HTTP over HTTPS
deliberately) and the three network permissions the binding will need.

**iOS.** `NSLocalNetworkUsageDescription` and `NSAllowsLocalNetworking` are set
in `app.json`. iOS prompts on first local connection; a denied prompt is
reported as a permissions problem rather than an unreachable server.

## Not built yet

- The Android network-binding native module and its config plugin.
- `GET /api/v1/media/<id>` — inspection crops, trap images, index maps.
- Opportunistic Supabase upstream. The field path stays fully offline; if the
  phone later reaches internet, it pushes a copy up as a fourth, purely additive
  tier. Nothing in the field path may depend on it.
- Multi-field and multi-node UI. Single node, single field, per §13.

## Stack

Expo SDK 57 · React Native 0.86 · expo-router · expo-sqlite · TypeScript strict.
Palette converted from the tweakcn **nature** oklch tokens in
`web/app/globals.css` so the app and the project site read as one system. Light
only — a screen that has to stay legible in direct sun is not the place for a
dark mode.

Tests run on Node's built-in runner with native type stripping: no jest, no
babel, no transform step.
