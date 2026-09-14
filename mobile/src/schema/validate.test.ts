/**
 * Runs on Node's built-in test runner with native type stripping — no jest,
 * no babel, no transform step:  npm test
 *
 * Two jobs. First, every fixture we ship must satisfy all four rules, so a
 * fixture cannot quietly become the thing that teaches the renderer bad habits.
 * Second, each rule must actually fire when broken — a validator that never
 * rejects anything is the guard-defaulted-off failure pattern wearing a test
 * suite as a disguise.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { validateAdvisory, describeViolation } from './validate.ts';
import type { RuleId } from './validate.ts';

// .href keeps this a string: the app's tsconfig pulls in the DOM lib, whose URL
// type is not assignable to node:url's. Passing the href sidesteps the clash.
const FIXTURE_DIR = fileURLToPath(new URL('../../fixtures/', import.meta.url).href);

const loadFixture = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(FIXTURE_DIR + name, 'utf8'));

const fixtureNames = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.json'));

/** Deep clone so each mutation test starts from a pristine advisory. */
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

const rulesFired = (advisory: unknown): RuleId[] => {
  const { violations } = validateAdvisory(advisory);
  return [...new Set(violations.map((v) => v.rule))].sort();
};

test('every shipped fixture satisfies all four rules', () => {
  assert.ok(fixtureNames.length >= 5, 'expected at least five fixtures');
  for (const name of fixtureNames) {
    const result = validateAdvisory(loadFixture(name));
    assert.ok(
      result.ok,
      `${name} violates the schema:\n  ${result.violations.map(describeViolation).join('\n  ')}`,
    );
  }
});

test('rule 1 fires when a null carries no reason', () => {
  const a = clone(loadFixture('advisory-clean.json')) as any;
  a.water.cwsi = null;
  // cwsi_status stays "OK", which is the exact lie the rule exists to catch.
  assert.deepEqual(rulesFired(a), [1]);
});

test('rule 1 fires when BASELINE_INITIALIZING gives no countdown', () => {
  const a = clone(loadFixture('advisory-baseline-init.json')) as any;
  delete a.water.cwsi_days_remaining;
  assert.deepEqual(rulesFired(a), [1]);
});

test('rule 1 fires when an action does not declare itself advisory-only', () => {
  const a = clone(loadFixture('advisory-clean.json')) as any;
  a.actions[0].advisory_only = false;
  assert.deepEqual(rulesFired(a), [1]);
});

test('rule 2 fires when a threshold arrives with no citation', () => {
  const a = clone(loadFixture('advisory-clean.json')) as any;
  delete a.pest[0].threshold_source;
  assert.deepEqual(rulesFired(a), [2]);
});

test('rule 2 fires when a threshold arrives with no confirmation flag', () => {
  const a = clone(loadFixture('advisory-clean.json')) as any;
  delete a.pest[0].threshold_confirmed;
  assert.deepEqual(rulesFired(a), [2]);
});

test('rule 3 fires when a populated section uses an undeclared input', () => {
  const a = clone(loadFixture('advisory-clean.json')) as any;
  a.inputs = a.inputs.filter((i: { name: string }) => i.name !== 'sticky_trap');
  // pest[] is still populated, so the trap it came from must still be declared.
  assert.deepEqual(rulesFired(a), [3]);
});

test('rule 3 fires when inputs[] is absent entirely', () => {
  const a = clone(loadFixture('advisory-clean.json')) as any;
  delete a.inputs;
  assert.ok(rulesFired(a).includes(3));
});

test('rule 3 fires when a present input declares no age', () => {
  const a = clone(loadFixture('advisory-clean.json')) as any;
  delete a.inputs[0].age_hours;
  assert.deepEqual(rulesFired(a), [3]);
});

test('rule 4 fires when a numeric block does not declare its source', () => {
  const a = clone(loadFixture('advisory-clean.json')) as any;
  delete a.vegetation.vari.source;
  assert.deepEqual(rulesFired(a), [4]);
});

test('rule 4 fires on a source value outside the allowed vocabulary', () => {
  const a = clone(loadFixture('advisory-clean.json')) as any;
  a.water.fao56.source = 'estimated';
  assert.deepEqual(rulesFired(a), [4]);
});

test('a MISSING input is allowed to have no age or timestamp', () => {
  // §9: a dead node produces a declared gap, not a violation.
  const result = validateAdvisory(loadFixture('advisory-stale-trap.json'));
  assert.ok(result.ok, result.violations.map(describeViolation).join('\n'));
});

test('an unconfirmed threshold is valid, but stays visibly unconfirmed', () => {
  const a = loadFixture('advisory-provisional-threshold.json') as any;
  assert.ok(validateAdvisory(a).ok);
  assert.equal(a.pest[0].threshold_confirmed, false);
  assert.match(a.pest[0].threshold_source, /^PROVISIONAL_/);
});

test('a non-object is rejected rather than crashing the renderer', () => {
  for (const bad of [null, undefined, 42, 'advisory', []]) {
    assert.equal(validateAdvisory(bad).ok, false);
  }
});
