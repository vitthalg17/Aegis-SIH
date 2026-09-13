/**
 * The phone's SQLite replica (§6.2, §14.2 step 1).
 *
 * The Jetson's database is the system of record; this is a read-only replica of
 * it plus the phone's own sync cursor. Nothing here ever computes an advisory —
 * if a number is not in the JSON the Jetson sent, this app does not have it.
 *
 * The full advisory JSON is stored verbatim in one column, with a handful of
 * fields lifted out for listing and ordering. Storing the original means a
 * schema change on the Jetson never silently drops data the app did not know to
 * destructure, and it keeps the replica byte-comparable with its source.
 */

import * as SQLite from 'expo-sqlite';

const DB_NAME = 'aegis.db';

let handle: SQLite.SQLiteDatabase | null = null;

const MIGRATIONS: string[] = [
  // v1 — advisories and sync state.
  `
  CREATE TABLE IF NOT EXISTS advisories (
    advisory_id      TEXT PRIMARY KEY NOT NULL,
    field_id         TEXT NOT NULL,
    generated_at_utc TEXT NOT NULL,
    schema_version   TEXT NOT NULL,
    json             TEXT NOT NULL,
    -- 0 when the advisory broke one of the four §7.3 rules. Kept, not dropped:
    -- a malformed advisory is evidence, and hiding it would be its own failure.
    valid            INTEGER NOT NULL DEFAULT 1,
    violations       TEXT,
    -- §13.0.1 — where this record came from, kept all the way to the screen.
    -- 'synced'  pulled from a Jetson, live measurement
    -- 'replay'  real records re-rendered through the pipeline, not this flight
    -- 'fixture' invented sample data that never touched a sensor
    -- These are three different claims and the UI must never merge them.
    origin           TEXT NOT NULL DEFAULT 'synced',
    received_at_utc  TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_advisories_generated
    ON advisories (generated_at_utc DESC);
  CREATE INDEX IF NOT EXISTS idx_advisories_field
    ON advisories (field_id, generated_at_utc DESC);

  CREATE TABLE IF NOT EXISTS sync_state (
    key   TEXT PRIMARY KEY NOT NULL,
    value TEXT
  );
  `,
  // v2 — cached LLM explanations (F1). Separate table on purpose: this is the
  // fourth, additive tier, and it must be droppable without touching a single
  // measured value. Nothing in `advisories` references it.
  `
  CREATE TABLE IF NOT EXISTS explanations (
    advisory_id      TEXT NOT NULL,
    language         TEXT NOT NULL,
    text             TEXT NOT NULL,
    model            TEXT NOT NULL,
    generated_at_utc TEXT NOT NULL,
    PRIMARY KEY (advisory_id, language),
    FOREIGN KEY (advisory_id) REFERENCES advisories (advisory_id) ON DELETE CASCADE
  );
  `,
];

/** Opens the replica and brings it up to the current schema version. */
export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (handle) return handle;

  const db = await SQLite.openDatabaseAsync(DB_NAME);
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;

  for (let v = current; v < MIGRATIONS.length; v++) {
    await db.withTransactionAsync(async () => {
      await db.execAsync(MIGRATIONS[v]);
    });
    // PRAGMA does not accept a bound parameter, and v is a loop index we own.
    await db.execAsync(`PRAGMA user_version = ${v + 1}`);
  }

  handle = db;
  return db;
}

// ---- sync_state -----------------------------------------------------------

export type SyncKey =
  /** Last advisory_id acknowledged to the Jetson. Drives the delta pull. */
  | 'cursor'
  | 'last_sync_utc'
  | 'last_sync_error'
  | 'base_url';

export async function getState(key: SyncKey): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string | null }>(
    'SELECT value FROM sync_state WHERE key = ?',
    key,
  );
  return row?.value ?? null;
}

export async function setState(key: SyncKey, value: string | null): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'INSERT INTO sync_state (key, value) VALUES (?, ?) ' +
      'ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key,
    value,
  );
}

/** Test/demo affordance: wipe the replica and start from nothing synced. */
export async function resetReplica(): Promise<void> {
  const db = await getDb();
  await db.execAsync(
    'DELETE FROM explanations; DELETE FROM advisories; DELETE FROM sync_state;',
  );
}
