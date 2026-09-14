/**
 * AEGIS advisory schema — schema_version "1.0".
 *
 * This is the phone-side half of a contract shared with the Jetson
 * (see docs/data_flow_architecture.md §7.3). It is deliberately a faithful
 * mirror of the JSON rather than a prettier reinterpretation: the sibling
 * `<field>_status` / `<field>_reason` keys are modelled exactly as the Jetson
 * emits them, so this file can be vendored to the Jetson side unchanged.
 *
 * If this file and §7.3 ever disagree, §7.3 wins and this file is the bug.
 */

/** §7.3 rule 4 — every numeric field declares how it came to exist. */
export type SourceKind = 'measured' | 'derived' | 'provisional';

/** §9 — a node input degrades OK -> STALE -> MISSING as its age grows. */
export type InputStatus = 'OK' | 'STALE' | 'MISSING';

/** Names the Jetson uses for the node-derived inputs an advisory consumes. */
export const INPUT_NAMES = ['mast_thermal', 'ambient', 'sticky_trap'] as const;
export type InputName = (typeof INPUT_NAMES)[number];

/**
 * §7.3 rule 3 — every advisory declares what it was built from and how old
 * each piece was. An input this app can see is a guard the app can honour;
 * one it cannot see is a guard defaulted off at the boundary.
 */
export type AdvisoryInput = {
  name: InputName;
  source_node: string;
  latest_sample_utc: string | null;
  age_hours: number | null;
  status: InputStatus;
  /** §6.3 — false means the node lost its RTC and its timestamps are fiction. */
  rtc_valid: boolean;
};

/** A single vegetation index. `mean` is null only when the index was not computed. */
export type VegetationIndex = {
  mean: number | null;
  p10?: number;
  p90?: number;
  /** DGCI only — the fraction of pixels outside the index's valid domain. */
  out_of_domain_fraction?: number;
  source: SourceKind;
};

export type Vegetation = {
  vari: VegetationIndex;
  exg: VegetationIndex;
  tgi: VegetationIndex;
  dgci: VegetationIndex;
  /**
   * §1 — NDVI is a first-class field from day one. The optics are unfinished,
   * so the Jetson emits null with a reason rather than an uncalibrated number.
   * This is an input still being finished, not a cancelled feature.
   */
  ndvi: number | null;
  ndvi_status: 'OK' | 'PENDING_HARDWARE_FINALIZATION';
  ndvi_reason?: string;
};

export type DiseaseFinding = {
  class: string;
  confidence: number;
  n_inspection_crops: number;
  source: SourceKind;
};

export type PestFinding = {
  taxon: string;
  /** Null until the monitoring window reaches 1.0 day (§13.0). */
  count_per_trap_per_day: number | null;
  /** Present even when the rate is withheld — one image gives one count. */
  count_raw?: number;
  count_status?: 'OK' | 'INSUFFICIENT_WINDOW';
  threshold: number;
  /** §7.3 rule 2 — an unconfirmed threshold must not look like an ICAR one. */
  threshold_source: string;
  threshold_confirmed: boolean;
  status: 'BELOW_THRESHOLD' | 'AT_THRESHOLD' | 'ABOVE_THRESHOLD' | 'UNKNOWN';
  trend?: 'RISING' | 'FALLING' | 'FLAT' | 'INSUFFICIENT_HISTORY';
  input_age_hours: number | null;
  source: SourceKind;
};

export type Fao56 = {
  depletion_mm: number | null;
  ks: number | null;
  status?: 'OK' | 'BALANCE_NOT_SEEDED';
  source: SourceKind;
};

export type Water = {
  /**
   * §13.0 — CWSI needs a ~2-week non-water-stressed baseline. No number is
   * ever emitted during that window; the app shows the countdown instead.
   */
  cwsi: number | null;
  cwsi_status: 'OK' | 'BASELINE_INITIALIZING' | 'EXCLUDED_RTC_INVALID' | 'INPUT_MISSING';
  cwsi_days_remaining?: number;
  cwsi_reason?: string;
  fao56: Fao56;
};

export type Action = {
  rank: number;
  action: string;
  rationale: string;
  confidence: 'low' | 'medium' | 'high';
  /** §14.2 — actuation is out of scope; this must be true and must be shown. */
  advisory_only: true;
};

export type Advisory = {
  advisory_id: string;
  schema_version: string;
  field_id: string;
  generated_at_utc: string;
  generated_by: { device: string; gps_time_valid: boolean };
  flight: {
    started_utc: string;
    survey_images: number;
    inspection_images: number;
  };
  inputs: AdvisoryInput[];
  vegetation: Vegetation;
  disease: DiseaseFinding[];
  pest: PestFinding[];
  water: Water;
  actions: Action[];
  notes: string[];
  /**
   * §13.0.1 — a seeded replay must be labelled as replay in the UI. Absent or
   * false means live. Never present replayed history as live measurement.
   */
  replay?: boolean;
};

export const SUPPORTED_SCHEMA_VERSIONS = ['1.0'] as const;
