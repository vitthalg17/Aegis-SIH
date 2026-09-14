/**
 * The delta pull against the Jetson's §7.4 API.
 *
 * cursor -> /manifest -> fetch what is missing -> /ack. Two properties the doc
 * calls out in §14.2 and this file is written to guarantee:
 *
 *   Idempotent — re-running must be harmless. Ingest is an upsert keyed on
 *   advisory_id, and the manifest is filtered against what the replica already
 *   holds, so a second run in a row fetches nothing and changes nothing.
 *
 *   Resumable — interruption must not lose progress. Advisories are committed
 *   one at a time as they arrive, and the cursor is only advanced to the last
 *   id that actually landed in SQLite. A sync killed halfway leaves the replica
 *   holding everything it managed to fetch, and the next run picks up from
 *   exactly there rather than starting over or skipping the gap.
 *
 * §7.4 is deliberately the same shape as the node's §5.4 API, so this algorithm
 * is the one written once and used at both hops.
 */

import { ingestAdvisory, knownAdvisoryIds } from '../db/advisories.ts';
import { getState, setState } from '../db/client.ts';
import { bindToLocalWifi, explainNetworkFailure } from './network.ts';

/** Jetson SoftAP default from §7.1. */
export const DEFAULT_BASE_URL = 'http://192.168.4.1:8080';

const TIMEOUT_MS = 10_000;

export type ManifestEntry = {
  advisory_id: string;
  generated_at_utc: string;
  bytes?: number;
};

export type Health = {
  device?: string;
  advisory_count?: number;
  storage_free_kb?: number;
  gps_time_valid?: boolean;
};

export type SyncOutcome = {
  ok: boolean;
  fetched: number;
  /** Advisories that arrived but broke a §7.3 rule. Stored, flagged, surfaced. */
  invalid: number;
  skipped: number;
  cursor: string | null;
  error?: string;
};

export type SyncProgress = {
  phase: 'binding' | 'manifest' | 'fetching' | 'acking' | 'done';
  fetched: number;
  total: number;
};

export async function getBaseUrl(): Promise<string> {
  return (await getState('base_url')) ?? DEFAULT_BASE_URL;
}

export async function setBaseUrl(url: string): Promise<void> {
  await setState('base_url', url.replace(/\/+$/, ''));
}

/** fetch with a hard timeout — a hung socket on a field link must not hang the UI. */
async function request(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
    return res;
  } finally {
    clearTimeout(timer);
  }
}

export async function probeHealth(baseUrl?: string): Promise<Health> {
  const base = baseUrl ?? (await getBaseUrl());
  const url = `${base}/api/v1/health`;
  try {
    const res = await request(url);
    return (await res.json()) as Health;
  } catch (err) {
    throw new Error(explainNetworkFailure(err, url));
  }
}

/**
 * Pulls everything the Jetson has that the replica does not.
 *
 * Errors are returned, not thrown: a failed sync is an ordinary state of this
 * app (§7.2 — the phone is out of range far more often than it is in range),
 * and the sync screen renders it as one of four normal states rather than as a
 * crash.
 */
export async function syncNow(
  onProgress?: (p: SyncProgress) => void,
): Promise<SyncOutcome> {
  const base = await getBaseUrl();
  const cursor = await getState('cursor');
  let fetched = 0;
  let invalid = 0;
  let skipped = 0;
  let lastLanded: string | null = cursor;

  const fail = async (error: string): Promise<SyncOutcome> => {
    await setState('last_sync_error', error);
    return { ok: false, fetched, invalid, skipped, cursor: lastLanded, error };
  };

  onProgress?.({ phase: 'binding', fetched: 0, total: 0 });
  const bind = await bindToLocalWifi();
  // A failed bind is not fatal — on a phone with mobile data off, or on a
  // dev build with the module present, the request may well succeed anyway.
  // We attempt the sync and let the failure explain itself if it comes.

  const manifestUrl =
    `${base}/api/v1/manifest` + (cursor ? `?since=${encodeURIComponent(cursor)}` : '');

  let entries: ManifestEntry[];
  try {
    onProgress?.({ phase: 'manifest', fetched: 0, total: 0 });
    const res = await request(manifestUrl);
    const body = (await res.json()) as { advisories?: ManifestEntry[] };
    entries = body.advisories ?? [];
  } catch (err) {
    const why = explainNetworkFailure(err, manifestUrl);
    return fail(bind.bound ? why : `${why}\n\n${bind.reason ?? ''}`.trim());
  }

  // Idempotence: never re-fetch something already in the replica, even if the
  // Jetson re-lists it (a cursor can legitimately be behind after a reinstall).
  const known = await knownAdvisoryIds();
  const wanted = entries.filter((e) => {
    if (known.has(e.advisory_id)) {
      skipped++;
      return false;
    }
    return true;
  });

  for (const entry of wanted) {
    const url = `${base}/api/v1/advisory/${encodeURIComponent(entry.advisory_id)}`;
    onProgress?.({ phase: 'fetching', fetched, total: wanted.length });
    try {
      const res = await request(url);
      const payload = await res.json();
      // A station that declares itself simulated cannot launder invented data
      // into looking measured — the header decides the origin, not the app's
      // optimism about where it just connected. tools/fake-field-station.mjs
      // sets it; a real Jetson does not.
      const simulated = res.headers.get('x-aegis-simulated') === 'true';
      const result = await ingestAdvisory(payload, {
        origin: simulated ? 'fixture' : 'synced',
      });
      fetched++;
      if (!result.valid) invalid++;
      // Resumability: the cursor follows what committed, not what was listed.
      lastLanded = entry.advisory_id;
    } catch (err) {
      // Stop at the first gap rather than skipping past it. Advancing the
      // cursor over a record we failed to fetch would lose it permanently.
      await setState('cursor', lastLanded);
      return fail(explainNetworkFailure(err, url));
    }
  }

  if (lastLanded && lastLanded !== cursor) {
    onProgress?.({ phase: 'acking', fetched, total: wanted.length });
    try {
      await request(`${base}/api/v1/ack`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ upto: lastLanded }),
      });
    } catch {
      // A failed ack is harmless: the Jetson keeps serving records we already
      // hold, and the next manifest gets filtered against the replica anyway.
      // Not worth failing a sync that actually delivered its data.
    }
    await setState('cursor', lastLanded);
  }

  await setState('last_sync_utc', new Date().toISOString());
  await setState('last_sync_error', null);
  onProgress?.({ phase: 'done', fetched, total: wanted.length });

  return { ok: true, fetched, invalid, skipped, cursor: lastLanded };
}
