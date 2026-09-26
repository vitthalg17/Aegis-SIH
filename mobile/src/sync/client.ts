/**
 * The offline gateway client — every endpoint in `docs/APP_TEAM_CHANGES.md` §5.
 *
 * The delta pull is the core of it: cursor -> /manifest -> fetch what is
 * missing -> /ack. Two properties this file is written to guarantee:
 *
 *   Idempotent — re-running must be harmless. Ingest is an upsert keyed on
 *   advisory_id, and the manifest is filtered against what the replica already
 *   holds, so a second run in a row fetches nothing and changes nothing.
 *
 *   Resumable — interruption must not lose progress. Advisories are committed
 *   one at a time as they arrive, and the cursor only advances to the last
 *   record that actually landed in SQLite. A sync killed halfway leaves the
 *   replica holding everything it managed to fetch, and the next run picks up
 *   from exactly there rather than starting over or skipping the gap.
 *
 * ── Why the cursor is an integer ────────────────────────────────────────────
 * `advisory_id` is a timestamp plus a field id, and it does not order safely.
 * The pod has no battery-backed real-time clock: it takes UTC from GPS, and
 * before a fix its clock is whatever the filesystem last recorded. A backwards
 * clock jump is the *expected* behaviour on every cold boot until GPS locks,
 * not a fault to design around.
 *
 * So the cursor is `seq` — the pod's SQLite rowid. Monotonic, assigned at
 * commit, never reused, independent of any clock.
 *
 * ── What is not proven yet ──────────────────────────────────────────────────
 * The hardware team reports every endpoint tested over Ethernet on the Jetson,
 * with two exceptions they named: `POST /api/v1/trap/upload` and
 * `POST /api/v1/sync/trigger`. Both are implemented here, and both are flagged
 * at their call sites so the UI can say "not yet exercised on the device"
 * rather than presenting a failure as the app's fault. The SIH-FIELD access
 * point is also still waiting on a replacement AR9271 dongle, so nothing below
 * has been run over the radio it will ship on.
 */

import { highestSeq, ingestAdvisory, knownAdvisoryIds } from '../db/advisories.ts';
import { getState, setState } from '../db/client.ts';
import { REWIND_TO, podHasRestarted } from './cursor.ts';
import { bindToLocalWifi, explainNetworkFailure } from './network.ts';

/** The pod's SoftAP. The ground mast lives on 192.168.9.1, off this subnet. */
export const DEFAULT_BASE_URL = 'http://192.168.4.1:8080';

/** The network the pod broadcasts while it is switched on. */
export const POD_SSID = 'SIH-FIELD';

const TIMEOUT_MS = 10_000;

/** A trap image is a photograph, and the pod segments it before replying. */
const UPLOAD_TIMEOUT_MS = 60_000;

/** Page size for the manifest. The pod's own maximum is 500. */
const PAGE_LIMIT = 200;

/** Guard against an unbounded loop if `truncated` were ever stuck true. */
const MAX_PAGES = 50;

// ---- Response shapes ------------------------------------------------------

export type ManifestEntry = {
  advisory_id: string;
  /** The pod's commit order. This is what the cursor tracks. */
  seq: number;
  generated_at_utc: string;
  bytes?: number;
  /** Surfaced at manifest level so the app can label before it fetches. */
  replay?: boolean;
  inference_backend?: string;
};

export type Manifest = {
  schema_version?: string;
  count?: number;
  advisories?: ManifestEntry[];
  truncated?: boolean;
};

export type Health = {
  device?: string;
  schema_version?: string;
  server_time_utc?: string;
  gps_time_valid?: boolean;
  /** "filesystem" is the state where every timestamp the pod emits is suspect. */
  clock_source?: 'gps' | 'rtc' | 'filesystem';
  advisory_count?: number;
  latest_seq?: number;
  storage_free_kb?: number;
  /** True while the pod has dropped its AP to talk to the mast as a station. */
  syncing?: boolean;
  sync_state?: 'IDLE' | 'STA_SYNC';
};

/** `GET /api/v1/sync/status` — the pod's pull against the ground mast. */
export type MastSyncStatus = {
  sync_in_progress: boolean;
  last_success_utc: string | null;
  last_attempt_utc: string | null;
  last_result: 'OK' | 'MAST_NOT_FOUND' | 'PARTIAL' | 'ERROR' | null;
  mast_data_age_s: number | null;
  records_pulled: number;
  trap_images_pulled: number;
};

/** `POST /api/v1/sync/trigger` — 202, or 409 when one is already running. */
export type MastSyncTrigger = {
  status: 'accepted';
  timestamp: string;
  /**
   * The pod must leave its own access point to reach the mast. For this many
   * seconds the phone loses the pod entirely, which is not a failure and must
   * not be rendered as one.
   */
  expected_ap_downtime_s: number;
};

/** `POST /api/v1/trap/upload` — Model B segmentation of a sticky card. */
export type TrapUploadResult = {
  status: 'ok';
  job_id: string;
  trap_id: string;
  record_id: number;
  advisory_id: string | null;
  total_blobs_counted: number;
  scale_status: 'CALIBRATED' | 'PROVISIONAL' | 'UNMEASURED';
  scale_mm_per_pixel: number | null;
  etl_status: string;
  pest: unknown[];
};

export type SyncOutcome = {
  ok: boolean;
  fetched: number;
  /** Advisories that arrived but broke a schema rule. Stored, flagged, surfaced. */
  invalid: number;
  skipped: number;
  /** Records the pod no longer has. Not an error — it will never have them again. */
  gone: number;
  /** Advisories the gateway refused because they were produced by a mock backend. */
  refusedMock: number;
  /**
   * The pod's `seq` numbering restarted — it was wiped or reflashed — so the
   * cursor was rewound and everything re-pulled. Reported rather than handled
   * silently: the phone may now hold advisories the pod no longer has, and
   * that is worth a line on screen.
   */
  podReset: boolean;
  cursor: number | null;
  error?: string;
};

export type SyncProgress = {
  phase: 'binding' | 'manifest' | 'fetching' | 'acking' | 'done';
  fetched: number;
  total: number;
};

// ---- Errors ---------------------------------------------------------------

type ErrorBody = { error?: string; reason?: string; detail?: string; path?: string };

/**
 * An HTTP status the gateway uses deliberately (contract §6).
 *
 * The distinction that matters is retry-safety. A 404 will still be a 404 in
 * five seconds; a 503 is the few-second window at boot before the database is
 * open and will succeed on the next attempt. Collapsing them into one message
 * leaves a farmer tapping "Try again" at something only a developer can fix.
 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: ErrorBody | null,
    readonly url: string,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(`HTTP ${status} from ${url}`);
  }

  get retryable(): boolean {
    return this.status === 503 || this.status >= 500;
  }

  /** True for the production guard against simulated advisories. */
  get isMockRejection(): boolean {
    return this.status === 403 && this.body?.error === 'mock_advisory_rejected';
  }

  /** What to tell the farmer. Not the status line. */
  describe(): string {
    switch (this.status) {
      case 400:
        if (this.body?.error === 'scale_uncalibrated') {
          return (
            'The pod could not work out the scale of that trap photo, so it will not ' +
            'turn blobs into a count. Include the printed scale marker on the card in ' +
            `the frame, or send it again allowing a provisional scale.${this.body.detail ? ` (${this.body.detail})` : ''}`
          );
        }
        return `The pod rejected the request as malformed${this.body?.detail ? `: ${this.body.detail}` : ''}. This is an app bug, not something you can fix in the field.`;
      case 403:
        return this.isMockRejection
          ? 'The pod refused that advisory because it was produced by the simulated model backend, not by the real one. A production pod never serves those. Nothing is wrong with your phone.'
          : 'The pod refused that request.';
      case 404:
        return 'The pod does not have that advisory. It never did — nothing was deleted.';
      case 409:
        return 'The pod is already syncing with the ground mast. Wait for that to finish and try again.';
      case 410:
        return 'The pod deleted that image to save space. The advisory itself is still there; only the picture is gone.';
      case 503:
        return `The pod is awake but still starting up. Wait ${this.retryAfterSeconds ?? 5} seconds and pull again.`;
      default:
        return this.status >= 500
          ? 'Something went wrong on the pod. Try once more.'
          : `The pod answered with an error (${this.status}).`;
    }
  }
}

// ---- Configuration --------------------------------------------------------

export async function getBaseUrl(): Promise<string> {
  return (await getState('base_url')) ?? DEFAULT_BASE_URL;
}

export async function setBaseUrl(url: string): Promise<void> {
  await setState('base_url', url.replace(/\/+$/, ''));
}

/**
 * Whether to ask the gateway for mock advisories as well as real ones.
 *
 * Off by default and off in the field. The gateway's production guard exists to
 * stop synthetic data being presented as measurement, and this switch turns it
 * off — so it lives behind an explicit toggle on the pod screen, is stored so a
 * reader can see it is on, and everything pulled while it is on is labelled.
 */
export async function getAllowMock(): Promise<boolean> {
  return (await getState('allow_mock')) === 'true';
}

export async function setAllowMock(on: boolean): Promise<void> {
  await setState('allow_mock', on ? 'true' : null);
}

// ---- Transport ------------------------------------------------------------

/** fetch with a hard timeout — a hung socket on a field link must not hang the UI. */
async function request(
  url: string,
  init: RequestInit = {},
  timeoutMs = TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) {
      let body: ErrorBody | null = null;
      try {
        body = (await res.json()) as ErrorBody;
      } catch {
        // An error body is a courtesy. Its absence must not mask the status.
      }
      const retryAfter = Number(res.headers.get('retry-after'));
      throw new HttpError(
        res.status,
        body,
        url,
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
      );
    }
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One retry for a 503, because that status has a specific and expected cause:
 * the access point comes up as a systemd unit at boot and the API server needs
 * the database open behind it. There is a window of a few seconds where a fast
 * phone connects and gets nothing, and failing the whole sync for it would be
 * an own goal. The gateway names the window itself in `Retry-After`.
 */
async function requestWithRetry(
  url: string,
  init: RequestInit = {},
  timeoutMs = TIMEOUT_MS,
): Promise<Response> {
  try {
    return await request(url, init, timeoutMs);
  } catch (err) {
    if (err instanceof HttpError && err.retryable) {
      const after = (err.retryAfterSeconds ?? 5) * 1000;
      await new Promise((r) => setTimeout(r, after));
      return request(url, init, timeoutMs);
    }
    throw err;
  }
}

/** Turns any thrown error into the sentence that goes on screen. */
function explain(err: unknown, url: string): string {
  if (err instanceof HttpError) return err.describe();
  return explainNetworkFailure(err, url);
}

async function withMock(base: string, path: string, params?: URLSearchParams): Promise<string> {
  const q = params ?? new URLSearchParams();
  if (await getAllowMock()) q.set('allow_mock', 'true');
  const query = q.toString();
  return `${base}${path}${query ? `?${query}` : ''}`;
}

// ---- Endpoints ------------------------------------------------------------

export async function probeHealth(baseUrl?: string): Promise<Health> {
  const base = baseUrl ?? (await getBaseUrl());
  const url = `${base}/api/v1/health`;
  try {
    const res = await requestWithRetry(url);
    const health = (await res.json()) as Health;
    await setState('last_health', JSON.stringify(health));
    return health;
  } catch (err) {
    throw new Error(explain(err, url));
  }
}

/** The ground mast collector's state, as the pod reports it. */
export async function getMastSyncStatus(baseUrl?: string): Promise<MastSyncStatus> {
  const base = baseUrl ?? (await getBaseUrl());
  const url = `${base}/api/v1/sync/status`;
  try {
    const res = await requestWithRetry(url);
    const status = (await res.json()) as MastSyncStatus;
    await setState('last_mast_sync', JSON.stringify(status));
    return status;
  } catch (err) {
    throw new Error(explain(err, url));
  }
}

/**
 * The last mast status this phone saw, from the replica.
 *
 * Lets the pod screen render the panel on open rather than after a round trip
 * — which matters because the most common reason to open that screen is that
 * the pod is *not* reachable, and a permanently empty panel teaches nothing.
 * The screen labels it as remembered rather than current.
 */
export async function getCachedMastSyncStatus(): Promise<MastSyncStatus | null> {
  const raw = await getState('last_mast_sync');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as MastSyncStatus;
  } catch {
    return null;
  }
}

/**
 * Asks the pod to go and pull from the ground mast.
 *
 * Costly in a way worth naming on screen: the pod has one radio, so it drops
 * its own access point and joins the mast's as a station. The phone loses the
 * pod for `expected_ap_downtime_s` seconds. That is the protocol working, not a
 * crash, and the UI must say so before the link goes quiet rather than after.
 *
 * Not yet exercised on the real Jetson — see the file header.
 */
export async function triggerMastSync(baseUrl?: string): Promise<MastSyncTrigger> {
  const base = baseUrl ?? (await getBaseUrl());
  const url = `${base}/api/v1/sync/trigger`;
  try {
    const res = await request(url, { method: 'POST' });
    return (await res.json()) as MastSyncTrigger;
  } catch (err) {
    throw new Error(explain(err, url));
  }
}

export type TrapUploadOptions = {
  trapId: string;
  /** Days the card has been out. The contract's valid window is 1–7. */
  daysMonitored: number;
  /** mm per pixel, when the card was photographed against a known marker. */
  scale?: number | null;
  /**
   * Let the pod count against an assumed scale rather than refusing.
   *
   * Off by default, deliberately. Without it an uncalibrated photo returns 400
   * `scale_uncalibrated` and nothing is counted — which is the honest outcome,
   * because a blob count with no scale cannot be turned into insects per trap.
   */
  allowProvisional?: boolean;
};

/**
 * Sends a photograph of a sticky trap card for Model B segmentation.
 *
 * The count that comes back is the deterministic watershed blob count, not the
 * CNN's classification — the unverified cross-domain CNN is not the gate on
 * whether a farmer sprays. See `TRAP_COUNT_DISCLAIMER`.
 *
 * Not yet exercised on the real Jetson — see the file header.
 */
export async function uploadTrapImage(
  image: Blob | ArrayBuffer,
  opts: TrapUploadOptions,
  baseUrl?: string,
): Promise<TrapUploadResult> {
  const base = baseUrl ?? (await getBaseUrl());
  const params = new URLSearchParams({
    trap_id: opts.trapId,
    days: String(opts.daysMonitored),
  });
  if (typeof opts.scale === 'number') params.set('scale', String(opts.scale));
  if (opts.allowProvisional) params.set('allow_provisional', 'true');

  const url = `${base}/api/v1/trap/upload?${params.toString()}`;

  // The contract accepts the same values as query parameters or as headers.
  // Both are sent: a proxy that strips a query string and one that strips
  // custom headers are both things that happen, and the request is small.
  const headers: Record<string, string> = {
    'Content-Type': 'image/jpeg',
    'X-Trap-Id': opts.trapId,
    'X-Days-Monitored': String(opts.daysMonitored),
    'X-Allow-Provisional': opts.allowProvisional ? 'true' : 'false',
  };
  if (typeof opts.scale === 'number') headers['X-Scale'] = String(opts.scale);

  try {
    const res = await request(
      url,
      { method: 'POST', headers, body: image as BodyInit },
      UPLOAD_TIMEOUT_MS,
    );
    return (await res.json()) as TrapUploadResult;
  } catch (err) {
    throw new Error(explain(err, url));
  }
}

/**
 * Fetches one advisory by id or by sequence number, without storing it.
 *
 * Used by the "pull just the latest" affordance and by the diagnostics on the
 * pod screen. The normal path is `syncNow`, which stores what it fetches.
 */
export async function fetchAdvisory(idOrSeq: string | number, baseUrl?: string): Promise<unknown> {
  const base = baseUrl ?? (await getBaseUrl());
  const url = await withMock(base, `/api/v1/advisory/${encodeURIComponent(String(idOrSeq))}`);
  try {
    const res = await requestWithRetry(url);
    return await res.json();
  } catch (err) {
    throw new Error(explain(err, url));
  }
}

/**
 * Pulls the newest advisory and stores it, without walking the manifest.
 *
 * The quick path for "I just finished a scan, show me". A full `syncNow`
 * afterwards is still cheap and still idempotent.
 */
export async function pullLatest(): Promise<{ advisoryId: string; valid: boolean }> {
  const base = await getBaseUrl();
  const url = await withMock(base, '/api/v1/advisory/latest');
  let payload: unknown;
  let simulated = false;
  try {
    const res = await requestWithRetry(url);
    payload = await res.json();
    simulated = res.headers.get('x-aegis-simulated') === 'true';
  } catch (err) {
    throw new Error(explain(err, url));
  }
  const result = await ingestAdvisory(payload, simulated ? { origin: 'fixture' } : {});
  return { advisoryId: result.advisoryId, valid: result.valid };
}

/**
 * How far apart the two clocks are, in seconds.
 *
 * Worth surfacing rather than silently doing age arithmetic across it: if the
 * pod has not had a GPS fix, every timestamp it emits is off by however long
 * the board sat unplugged, and an age computed against it is not a measurement.
 */
export function clockSkewSeconds(health: Health, now: Date = new Date()): number | null {
  if (!health.server_time_utc) return null;
  const t = Date.parse(health.server_time_utc);
  if (Number.isNaN(t)) return null;
  return Math.round((now.getTime() - t) / 1000);
}

/** The cursor, recovered from the replica when sync_state has lost it. */
async function readCursor(): Promise<number | null> {
  const raw = await getState('cursor');
  if (raw !== null) {
    const n = Number(raw);
    // A cursor written by an older build is an advisory_id string. It cannot be
    // compared or incremented, so fall back to the replica's own high-water
    // mark rather than sending it and hoping the pod resolves it.
    if (Number.isFinite(n)) return n;
  }
  return highestSeq();
}

// ---- The delta pull -------------------------------------------------------

/**
 * Pulls everything the pod has that the replica does not.
 *
 * Errors are returned, not thrown: a failed sync is an ordinary state of this
 * app — the phone is out of range far more often than it is in range — and the
 * sync screen renders it as one of four normal states rather than as a crash.
 */
export async function syncNow(onProgress?: (p: SyncProgress) => void): Promise<SyncOutcome> {
  const base = await getBaseUrl();
  let startCursor = await readCursor();
  let fetched = 0;
  let invalid = 0;
  let skipped = 0;
  let gone = 0;
  let refusedMock = 0;
  let podReset = false;
  let lastLanded: number | null = startCursor;

  const fail = async (error: string): Promise<SyncOutcome> => {
    await setState('last_sync_error', error);
    if (lastLanded !== null) await setState('cursor', String(lastLanded));
    return {
      ok: false,
      fetched,
      invalid,
      skipped,
      gone,
      refusedMock,
      podReset,
      cursor: lastLanded,
      error,
    };
  };

  onProgress?.({ phase: 'binding', fetched: 0, total: 0 });
  const bind = await bindToLocalWifi();
  // A failed bind is not fatal — on a phone with mobile data off, or on a dev
  // build with the module present, the request may well succeed anyway. Attempt
  // the sync and let the failure explain itself if it comes.

  // Health first: it is cheap, it confirms the pod is actually there rather
  // than something else answering on that address, and it gives the connection
  // screen a clock source to display.
  let health: Health | null = null;
  try {
    onProgress?.({ phase: 'manifest', fetched: 0, total: 0 });
    health = await probeHealth(base);
  } catch {
    // Not fatal on its own. The manifest call below produces the real error.
  }

  // The pod has one radio. While it is talking to the ground mast as a station
  // its own access point is down, so a failure here is expected rather than
  // interesting — say which it is instead of blaming the link.
  if (health?.sync_state === 'STA_SYNC' || health?.syncing === true) {
    return fail(
      'The pod is currently syncing with the ground mast, which takes its Wi-Fi ' +
        'down for about half a minute. Wait for it to come back and pull again.',
    );
  }

  // ---- Has the pod's database restarted? ----------------------------------
  // See `podHasRestarted` for why this exists. Briefly: `seq` restarts at 1 on
  // a wipe or a reflash, the phone's cursor does not, and without this check
  // every subsequent sync succeeds while fetching nothing — forever, silently.
  //
  // The rewind is written to the replica immediately rather than at the end of
  // the sync, so an attempt interrupted halfway cannot leave the stale cursor
  // in place to wedge the next one.
  if (podHasRestarted(health, startCursor)) {
    podReset = true;
    startCursor = REWIND_TO;
    lastLanded = REWIND_TO;
    await setState('cursor', String(REWIND_TO));
  }

  // ---- Manifest, paged ----------------------------------------------------
  // The pod's honest sizing is "unbounded, it's tiny" — an advisory is a few
  // kilobytes and a realistic backlog is a few dozen. Paging is implemented
  // anyway because the pod implements it, and one sync algorithm that works at
  // both hops is worth more than ten saved lines.

  const entries: ManifestEntry[] = [];
  let cursor = startCursor;

  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({ limit: String(PAGE_LIMIT) });
    if (cursor !== null) params.set('since', String(cursor));
    const manifestUrl = await withMock(base, '/api/v1/manifest', params);

    let body: Manifest;
    try {
      const res = await requestWithRetry(manifestUrl);
      body = (await res.json()) as Manifest;
    } catch (err) {
      if (err instanceof HttpError) return fail(err.describe());
      const why = explainNetworkFailure(err, manifestUrl);
      return fail(bind.bound ? why : `${why}\n\n${bind.reason ?? ''}`.trim());
    }

    const pageEntries = body.advisories ?? [];
    entries.push(...pageEntries);
    if (!body.truncated || pageEntries.length === 0) break;

    // Continue from the last seq seen, which is what `truncated` means.
    const lastSeq = pageEntries[pageEntries.length - 1]?.seq;
    if (typeof lastSeq !== 'number') break;
    cursor = lastSeq;
  }

  // The manifest is ascending and exclusive of `since`, so it arrives in the
  // order we want to commit in. Sorting defensively costs nothing and means a
  // pod that ever pages out of order cannot corrupt the cursor.
  entries.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));

  // Idempotence: never re-fetch something already in the replica, even if the
  // pod re-lists it (a cursor can legitimately be behind after a reinstall).
  const known = await knownAdvisoryIds();
  const wanted = entries.filter((e) => {
    if (known.has(e.advisory_id)) {
      skipped++;
      // Already held, so the cursor may still advance past it.
      if (typeof e.seq === 'number' && (lastLanded === null || e.seq > lastLanded)) {
        lastLanded = e.seq;
      }
      return false;
    }
    return true;
  });

  // ---- Fetch --------------------------------------------------------------

  for (const entry of wanted) {
    const url = await withMock(base, `/api/v1/advisory/${encodeURIComponent(entry.advisory_id)}`);
    onProgress?.({ phase: 'fetching', fetched, total: wanted.length });
    try {
      const res = await requestWithRetry(url);
      const payload = await res.json();
      // A station that declares itself simulated cannot launder invented data
      // into looking measured — the header decides the origin, not the app's
      // optimism about where it just connected. tools/fake-field-station.mjs
      // sets it; a real pod does not.
      const simulated = res.headers.get('x-aegis-simulated') === 'true';
      const result = await ingestAdvisory(payload, simulated ? { origin: 'fixture' } : {});
      fetched++;
      if (!result.valid) invalid++;
      // Resumability: the cursor follows what committed, not what was listed.
      if (typeof entry.seq === 'number') lastLanded = entry.seq;
    } catch (err) {
      // A 404 or 410 is final — the record will not appear later, so stopping
      // here would wedge the sync on it forever. Step over it and keep going.
      if (err instanceof HttpError && (err.status === 404 || err.status === 410)) {
        gone++;
        if (typeof entry.seq === 'number') lastLanded = entry.seq;
        continue;
      }
      // The production guard refusing a mock advisory is also final, and it is
      // the gateway working: it will never serve that record while it is in
      // production mode. Counted separately so the screen can say "three were
      // refused as simulated" rather than "three are missing".
      if (err instanceof HttpError && err.isMockRejection) {
        refusedMock++;
        if (typeof entry.seq === 'number') lastLanded = entry.seq;
        continue;
      }
      // Anything else is a gap we might recover from. Stop rather than skip
      // past it: advancing the cursor over a record we failed to fetch would
      // lose it permanently.
      return fail(explain(err, url));
    }
  }

  // ---- Ack ----------------------------------------------------------------
  // A courtesy, not a contract. The pod keeps serving records it has already
  // acked and never deletes an advisory on ack; this only advances the count it
  // reports on /health so the connection screen can say how many are waiting.

  if (lastLanded !== null && lastLanded !== startCursor) {
    onProgress?.({ phase: 'acking', fetched, total: wanted.length });
    try {
      // The contract's 400 for this endpoint names both accepted keys —
      // "Missing 'upto' or 'advisory_id' field in payload" — so send the cursor
      // form, which is what a range acknowledgement means.
      await request(`${base}/api/v1/ack`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ upto: lastLanded }),
      });
    } catch {
      // A failed ack is harmless: the pod keeps serving records we already
      // hold, and the next manifest gets filtered against the replica anyway.
      // Not worth failing a sync that actually delivered its data.
    }
    await setState('cursor', String(lastLanded));
  }

  await setState('last_sync_utc', new Date().toISOString());
  await setState('last_sync_error', null);
  onProgress?.({ phase: 'done', fetched, total: wanted.length });

  return { ok: true, fetched, invalid, skipped, gone, refusedMock, podReset, cursor: lastLanded };
}
