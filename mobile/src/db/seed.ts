/**
 * Loads the shipped fixtures into the replica on first launch.
 *
 * §14.2 step 1: "The app must render a full history with no drone present. Get
 * this working before any networking." These five advisories are that history.
 * They are invented — no sensor produced them — so they go in with
 * origin 'fixture' and every screen that shows one says so.
 *
 * The fixtures are chosen for their failure states, not their happy path. Four
 * of the five are degraded in some way, because the degraded rendering is the
 * part that gets skipped when a demo is built happy-path-first.
 */

import { ingestAdvisory, countAdvisories } from './advisories.ts';
import { getState, setState } from './client.ts';

import clean from '../../fixtures/advisory-clean.json';
import baselineInit from '../../fixtures/advisory-baseline-init.json';
import staleTrap from '../../fixtures/advisory-stale-trap.json';
import rtcInvalid from '../../fixtures/advisory-rtc-invalid.json';
import provisional from '../../fixtures/advisory-provisional-threshold.json';

const FIXTURES: unknown[] = [clean, baselineInit, staleTrap, rtcInvalid, provisional];

/**
 * Seeds fixtures once. Safe to call on every launch: it no-ops as soon as the
 * replica holds anything, so a real synced advisory is never overwritten by
 * sample data.
 */
export async function seedFixturesIfEmpty(): Promise<number> {
  if ((await countAdvisories()) > 0) return 0;
  if ((await getState('cursor')) !== null) return 0; // synced before, then cleared

  let n = 0;
  for (const f of FIXTURES) {
    await ingestAdvisory(f, { origin: 'fixture' });
    n++;
  }
  await setState('last_sync_error', null);
  return n;
}

/** Demo affordance: force the fixtures back in after a reset. */
export async function reseedFixtures(): Promise<number> {
  for (const f of FIXTURES) await ingestAdvisory(f, { origin: 'fixture' });
  return FIXTURES.length;
}
