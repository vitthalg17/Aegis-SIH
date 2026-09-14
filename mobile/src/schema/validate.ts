/**
 * Mechanical enforcement of the four schema rules in §7.3.
 *
 * §14.3: "The app is the last place a fabricated number can be caught, and the
 * easiest place for one to be created." A rule that only exists in prose gets
 * violated by the third person to touch the renderer. These are the same four
 * rules, written so a test can fail on them.
 *
 * This runs on every advisory at ingest, before it reaches SQLite. An advisory
 * that violates a rule is stored flagged and rendered with the violation shown —
 * never silently dropped, and never silently trusted.
 */

import type { Advisory, SourceKind } from './advisory.ts';
import { INPUT_NAMES, SUPPORTED_SCHEMA_VERSIONS } from './advisory.ts';

/** Which of the four §7.3 rules a violation belongs to. */
export type RuleId = 1 | 2 | 3 | 4;

export const RULE_NAMES: Record<RuleId, string> = {
  1: 'absence is null plus a machine-readable reason',
  2: 'every threshold carries its source and confirmation',
  3: 'inputs[] is mandatory and complete',
  4: 'source on every numeric field',
};

export type Violation = {
  rule: RuleId;
  path: string;
  message: string;
};

export type ValidationResult = {
  ok: boolean;
  violations: Violation[];
};

const SOURCE_KINDS: readonly SourceKind[] = ['measured', 'derived', 'provisional'];

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Rule 3 — which declared inputs each populated section is built from.
 * A section that produced a number without declaring where the number came
 * from is a guard the app cannot honour.
 */
const SECTION_INPUTS: Record<string, readonly string[]> = {
  'water.cwsi': ['mast_thermal', 'ambient'],
  'water.fao56': ['ambient'],
  pest: ['sticky_trap'],
};

export function validateAdvisory(raw: unknown): ValidationResult {
  const v: Violation[] = [];
  const add = (rule: RuleId, path: string, message: string) => v.push({ rule, path, message });

  if (!isObject(raw)) {
    add(1, '$', 'advisory is not an object');
    return { ok: false, violations: v };
  }
  const a = raw as unknown as Advisory;

  if (!SUPPORTED_SCHEMA_VERSIONS.includes(a.schema_version as '1.0')) {
    add(1, 'schema_version', `unsupported schema_version ${JSON.stringify(a.schema_version)}`);
  }

  // ---- Rule 1: absence is null plus a machine-readable reason ---------------
  // A null with no status beside it is indistinguishable from a field somebody
  // forgot to fill in, which is exactly the ambiguity this rule removes.

  const veg = a.vegetation;
  if (isObject(veg)) {
    if (veg.ndvi === null && (veg.ndvi_status === undefined || veg.ndvi_status === 'OK')) {
      add(1, 'vegetation.ndvi', 'ndvi is null but ndvi_status does not say why');
    }
    if (veg.ndvi === null && !veg.ndvi_reason) {
      add(1, 'vegetation.ndvi_reason', 'ndvi is null with no human-readable reason');
    }
    if (typeof veg.ndvi === 'number' && veg.ndvi_status !== 'OK') {
      add(1, 'vegetation.ndvi', 'ndvi has a value but ndvi_status is not OK');
    }
    for (const key of ['vari', 'exg', 'tgi', 'dgci'] as const) {
      const idx = veg[key];
      if (isObject(idx) && idx.mean === null) {
        add(1, `vegetation.${key}.mean`, `${key} is null with no status field to explain it`);
      }
    }
  } else {
    add(1, 'vegetation', 'vegetation block missing');
  }

  const water = a.water;
  if (isObject(water)) {
    if (water.cwsi === null && (!water.cwsi_status || water.cwsi_status === 'OK')) {
      add(1, 'water.cwsi', 'cwsi is null but cwsi_status does not say why');
    }
    if (
      water.cwsi === null &&
      water.cwsi_status === 'BASELINE_INITIALIZING' &&
      typeof water.cwsi_days_remaining !== 'number'
    ) {
      add(1, 'water.cwsi_days_remaining', 'baseline is initialising but no countdown is given');
    }
    if (typeof water.cwsi === 'number' && water.cwsi_status !== 'OK') {
      add(1, 'water.cwsi', 'cwsi has a value but cwsi_status is not OK');
    }
    const f = water.fao56;
    if (isObject(f)) {
      const missing = f.depletion_mm === null || f.ks === null;
      if (missing && (!f.status || f.status === 'OK')) {
        add(1, 'water.fao56', 'fao56 has a null value but status does not say why');
      }
    } else {
      add(1, 'water.fao56', 'fao56 block missing');
    }
  } else {
    add(1, 'water', 'water block missing');
  }

  const pests = Array.isArray(a.pest) ? a.pest : [];
  pests.forEach((p, i) => {
    if (p.count_per_trap_per_day === null && (!p.count_status || p.count_status === 'OK')) {
      add(1, `pest[${i}].count_per_trap_per_day`, 'rate withheld but count_status does not say why');
    }
  });

  // ---- Rule 2: every threshold carries source and confirmation --------------
  // PROVISIONAL_* has to survive the trip to the UI. An unconfirmed number
  // rendered identically to an ICAR-sourced one is citation drift happening in
  // the presentation layer.

  pests.forEach((p, i) => {
    if (typeof p.threshold !== 'number') return;
    if (!p.threshold_source) {
      add(2, `pest[${i}].threshold_source`, 'threshold given with no citation');
    }
    if (typeof p.threshold_confirmed !== 'boolean') {
      add(2, `pest[${i}].threshold_confirmed`, 'threshold given with no confirmation flag');
    }
  });

  // ---- Rule 3: inputs[] mandatory and complete ------------------------------

  const inputs = Array.isArray(a.inputs) ? a.inputs : null;
  if (!inputs) {
    add(3, 'inputs', 'inputs[] is missing — the advisory does not declare what it was built from');
  } else {
    if (inputs.length === 0) {
      add(3, 'inputs', 'inputs[] is empty');
    }
    const declared = new Set<string>(inputs.map((i) => i.name));
    inputs.forEach((input, i) => {
      if (!(INPUT_NAMES as readonly string[]).includes(input.name)) {
        add(3, `inputs[${i}].name`, `unknown input name ${JSON.stringify(input.name)}`);
      }
      if (typeof input.rtc_valid !== 'boolean') {
        add(3, `inputs[${i}].rtc_valid`, 'rtc_valid missing — clock integrity cannot be shown');
      }
      if (input.status !== 'MISSING' && typeof input.age_hours !== 'number') {
        add(3, `inputs[${i}].age_hours`, 'input is present but declares no age');
      }
    });

    const populated: string[] = [];
    if (isObject(water) && typeof water.cwsi === 'number') populated.push('water.cwsi');
    if (isObject(water) && isObject(water.fao56) && typeof water.fao56.depletion_mm === 'number') {
      populated.push('water.fao56');
    }
    if (pests.length > 0) populated.push('pest');

    for (const section of populated) {
      for (const need of SECTION_INPUTS[section] ?? []) {
        if (!declared.has(need)) {
          add(3, section, `produced a value from "${need}" but does not declare it in inputs[]`);
        }
      }
    }
  }

  // ---- Rule 4: source on every numeric field --------------------------------
  // Walked rather than spot-checked, so a field added to one of these blocks
  // next month cannot quietly ship without declaring itself.

  const valueBlocks: Array<[string, unknown]> = [];
  if (isObject(veg)) {
    for (const key of ['vari', 'exg', 'tgi', 'dgci'] as const) {
      valueBlocks.push([`vegetation.${key}`, veg[key]]);
    }
  }
  if (Array.isArray(a.disease)) {
    a.disease.forEach((d, i) => valueBlocks.push([`disease[${i}]`, d]));
  }
  pests.forEach((p, i) => valueBlocks.push([`pest[${i}]`, p]));
  if (isObject(water)) valueBlocks.push(['water.fao56', water.fao56]);

  for (const [path, block] of valueBlocks) {
    if (!isObject(block)) {
      add(4, path, 'value block missing');
      continue;
    }
    const carriesNumber = Object.values(block).some((x) => typeof x === 'number');
    if (!carriesNumber) continue;
    if (!SOURCE_KINDS.includes(block.source as SourceKind)) {
      add(4, `${path}.source`, 'numeric block does not declare measured | derived | provisional');
    }
  }

  // ---- Actions are advisory only (§14.2) ------------------------------------

  if (Array.isArray(a.actions)) {
    a.actions.forEach((act, i) => {
      if (act.advisory_only !== true) {
        add(1, `actions[${i}].advisory_only`, 'action does not declare itself advisory-only');
      }
    });
  }

  return { ok: v.length === 0, violations: v };
}

/** Human-readable one-liner for logs and the debug screen. */
export function describeViolation(x: Violation): string {
  return `rule ${x.rule} (${RULE_NAMES[x.rule]}) at ${x.path}: ${x.message}`;
}
