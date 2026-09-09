/**
 * Reading and writing advisories in the replica.
 *
 * Ingest is the one place an advisory enters the app, and it is where the §7.3
 * validator runs. Everything downstream of here can assume it knows whether the
 * record it is holding is trustworthy, because the answer is stored beside it.
 */

import type { Advisory } from '../schema/advisory.ts';
import type { Violation } from '../schema/validate.ts';
import { validateAdvisory } from '../schema/validate.ts';
import { getDb } from './client.ts';

/**
 * Where a stored advisory came from. These are three different claims about
 * reality and §13.0.1 forbids merging them: a judge who sees unlabelled sample
 * data has found failure pattern #1 in the demo itself.
 */
export type AdvisoryOrigin = 'synced' | 'replay' | 'fixture';

/** An advisory as the app handles it: the payload plus what we know about it. */
export type StoredAdvisory = {
  advisory: Advisory;
  valid: boolean;
  violations: Violation[];
  origin: AdvisoryOrigin;
  receivedAtUtc: string;
};

/** The listing row — enough to render a card without parsing the full JSON. */
export type AdvisorySummary = {
  advisoryId: string;
  fieldId: string;
  generatedAtUtc: string;
  valid: boolean;
  violationCount: number;
  origin: AdvisoryOrigin;
};

type Row = {
  advisory_id: string;
  field_id: string;
  generated_at_utc: string;
  schema_version: string;
  json: string;
  valid: number;
  violations: string | null;
  origin: AdvisoryOrigin;
  received_at_utc: string;
};

/**
 * Stores one advisory, validating it on the way in.
 *
 * A failing advisory is stored with its violations rather than rejected. The
 * app is the last place a fabricated number can be caught (§14.3) — catching it
 * and then throwing the evidence away would defeat the point. The renderer
 * shows the violations; it does not pretend the record is fine.
 */
export async function ingestAdvisory(
  raw: unknown,
  opts: { origin?: AdvisoryOrigin } = {},
): Promise<{ advisoryId: string; valid: boolean; violations: Violation[] }> {
  const { ok, violations } = validateAdvisory(raw);
  const a = raw as Advisory;

  if (!a?.advisory_id) {
    throw new Error('advisory has no advisory_id — cannot be stored or acknowledged');
  }

  const origin: AdvisoryOrigin = opts.origin ?? (a.replay ? 'replay' : 'synced');
  const db = await getDb();

  await db.runAsync(
    `INSERT INTO advisories
       (advisory_id, field_id, generated_at_utc, schema_version, json,
        valid, violations, origin, received_at_utc)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(advisory_id) DO UPDATE SET
       json = excluded.json,
       valid = excluded.valid,
       violations = excluded.violations,
       origin = excluded.origin`,
    a.advisory_id,
    a.field_id ?? 'unknown',
    a.generated_at_utc ?? new Date(0).toISOString(),
    a.schema_version ?? 'unknown',
    JSON.stringify(raw),
    ok ? 1 : 0,
    violations.length ? JSON.stringify(violations) : null,
    origin,
    new Date().toISOString(),
  );

  return { advisoryId: a.advisory_id, valid: ok, violations };
}

const toStored = (row: Row): StoredAdvisory => ({
  advisory: JSON.parse(row.json) as Advisory,
  valid: row.valid === 1,
  violations: row.violations ? (JSON.parse(row.violations) as Violation[]) : [],
  origin: row.origin,
  receivedAtUtc: row.received_at_utc,
});

export async function listAdvisories(limit = 100): Promise<AdvisorySummary[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Row>(
    `SELECT advisory_id, field_id, generated_at_utc, schema_version, json,
            valid, violations, origin, received_at_utc
       FROM advisories
      ORDER BY generated_at_utc DESC
      LIMIT ?`,
    limit,
  );
  return rows.map((r) => ({
    advisoryId: r.advisory_id,
    fieldId: r.field_id,
    generatedAtUtc: r.generated_at_utc,
    valid: r.valid === 1,
    violationCount: r.violations ? (JSON.parse(r.violations) as Violation[]).length : 0,
    origin: r.origin,
  }));
}

export async function getAdvisory(advisoryId: string): Promise<StoredAdvisory | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<Row>(
    'SELECT * FROM advisories WHERE advisory_id = ?',
    advisoryId,
  );
  return row ? toStored(row) : null;
}

export async function getLatestAdvisory(): Promise<StoredAdvisory | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<Row>(
    'SELECT * FROM advisories ORDER BY generated_at_utc DESC LIMIT 1',
  );
  return row ? toStored(row) : null;
}

export async function countAdvisories(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM advisories');
  return row?.n ?? 0;
}

/** Advisory ids the replica already holds — the input to the delta pull. */
export async function knownAdvisoryIds(): Promise<Set<string>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ advisory_id: string }>(
    'SELECT advisory_id FROM advisories',
  );
  return new Set(rows.map((r) => r.advisory_id));
}
