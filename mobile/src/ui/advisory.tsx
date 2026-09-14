/**
 * Advisory-specific blocks, built on the site's alert-card structure: a mono
 * micro-label, the value, then tinted WHY / CHECK NEXT sub-panels and a chip
 * strip at the foot.
 *
 * Each block exists to satisfy a named requirement in §14.2 step 3, and the
 * comment on each says which. The styling changed; the guarantees did not.
 */

import { StyleSheet, Text, View } from 'react-native';

import {
  Card,
  Chip,
  ChipRow,
  ConfidenceBar,
  Divider,
  Measurement,
  Muted,
  Panel,
  Row,
  SourceTag,
  StatusChip,
  TONE,
} from './components.tsx';
import type { Tone } from './components.tsx';
import { color, radius, space, type } from './theme.ts';
import type { Advisory, AdvisoryInput, PestFinding } from '../schema/advisory.ts';
import type { AdvisoryOrigin } from '../db/advisories.ts';
import type { Violation } from '../schema/validate.ts';
import { describeViolation } from '../schema/validate.ts';

// ---- Origin banner --------------------------------------------------------

/**
 * §13.0.1 — "Never present replayed history as live measurement." Sample and
 * replay data get a banner at the top of every screen that shows them, not a
 * subtle footnote. The site does the same thing with its own
 * "SAMPLE ALERT · ILLUSTRATIVE VALUES" line.
 */
export function OriginBanner({ origin }: { origin: AdvisoryOrigin }) {
  if (origin === 'synced') return null;
  const isFixture = origin === 'fixture';
  const t = isFixture ? TONE.warn : TONE.unknown;
  return (
    <View style={[s.banner, { borderColor: t.border, backgroundColor: t.bg }]}>
      <Text style={[type.micro, { color: t.fg }]}>
        {isFixture ? 'SAMPLE DATA · NOT A MEASUREMENT' : 'REPLAY · NOT THIS FLIGHT'}
      </Text>
      <Text style={[type.small, { color: t.fg, marginTop: 5 }]}>
        {isFixture
          ? 'These values were invented to exercise the app. No sensor produced them.'
          : 'Real records from an earlier session, re-rendered through the pipeline.'}
      </Text>
    </View>
  );
}

// ---- Schema violations ----------------------------------------------------

/** An advisory that broke a §7.3 rule is shown as broken, not quietly rendered. */
export function ViolationsCard({ violations }: { violations: Violation[] }) {
  if (violations.length === 0) return null;
  return (
    <View style={s.violations}>
      <Text style={[type.micro, { color: color.destructive }]}>
        {violations.length} SCHEMA VIOLATION{violations.length === 1 ? '' : 'S'}
      </Text>
      <Text style={[type.small, { color: color.destructive, marginTop: 6 }]}>
        This advisory does not satisfy the §7.3 contract. Do not act on it without
        checking the field station.
      </Text>
      {violations.map((v, i) => (
        <Text key={i} style={[type.valueSmall, { color: color.destructive, marginTop: 5 }]}>
          • {describeViolation(v)}
        </Text>
      ))}
    </View>
  );
}

// ---- Inputs ---------------------------------------------------------------

const INPUT_LABEL: Record<string, string> = {
  mast_thermal: 'Mast thermal',
  ambient: 'Air temp / humidity',
  sticky_trap: 'Sticky trap',
};

const STATUS_TONE: Record<AdvisoryInput['status'], Tone> = {
  OK: 'good',
  STALE: 'warn',
  MISSING: 'bad',
};

/**
 * §14.2 step 3: "inputs[].age_hours must be visible per input, not buried in a
 * detail view." So this sits on the main advisory screen, above the numbers it
 * explains, rather than behind a disclosure.
 */
export function InputsCard({ inputs }: { inputs: AdvisoryInput[] }) {
  return (
    <Card eyebrow="Provenance" title="What this was built from">
      {inputs.map((input, i) => (
        <View key={input.name}>
          {i > 0 ? <Divider /> : null}
          <Row>
            <View style={{ flex: 1 }}>
              <Text style={[type.label, { color: color.foreground }]}>
                {INPUT_LABEL[input.name] ?? input.name}
              </Text>
              <Text style={[type.valueSmall, { color: color.fgSubtle, marginTop: 3 }]}>
                node {input.source_node} ·{' '}
                {input.age_hours === null ? 'no data received' : `${formatAge(input.age_hours)} old`}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 5 }}>
              <StatusChip label={input.status} tone={STATUS_TONE[input.status]} />
              {/* §6.3 point 4 — rtc_valid:false must reach the UI, not be
                  absorbed silently in the middle of the pipeline. */}
              {!input.rtc_valid ? <StatusChip label="CLOCK INVALID" tone="bad" /> : null}
            </View>
          </Row>
          {!input.rtc_valid ? (
            <Panel label="Clock" tone="bad">
              This node lost its RTC. Its timestamps cannot be trusted, so nothing
              time-dependent was computed from it.
            </Panel>
          ) : null}
        </View>
      ))}
    </Card>
  );
}

function formatAge(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  if (hours < 48) return `${hours.toFixed(1)} h`;
  return `${Math.round(hours / 24)} days`;
}

// ---- Pest / thresholds ----------------------------------------------------

const PEST_TONE: Record<PestFinding['status'], Tone> = {
  BELOW_THRESHOLD: 'good',
  AT_THRESHOLD: 'warn',
  ABOVE_THRESHOLD: 'bad',
  UNKNOWN: 'unknown',
};

/**
 * §14.2 step 3: "threshold_confirmed: false must be visually distinct from
 * confirmed." An unconfirmed number rendered identically to an ICAR-sourced
 * one is citation drift happening in the presentation layer (§7.3 rule 2), so
 * the whole panel changes colour, not just a word inside it.
 */
export function PestCard({ pest }: { pest: PestFinding[] }) {
  if (pest.length === 0) {
    return (
      <Card eyebrow="Pest" title="Trap count">
        <Muted>No trap reading in this advisory.</Muted>
      </Card>
    );
  }

  return (
    <Card eyebrow="Pest" title="Trap count">
      {pest.map((p, i) => (
        <View key={`${p.taxon}-${i}`}>
          {i > 0 ? <Divider /> : null}
          <View style={s.head}>
            <Text style={[type.cardTitle, { color: color.foreground, flex: 1 }]}>
              {p.taxon.replace(/_/g, ' ')}
            </Text>
            <StatusChip label={p.status.replace(/_/g, ' ')} tone={PEST_TONE[p.status]} />
          </View>

          <View style={{ marginTop: space.md }}>
            <Measurement
              label="Count per trap per day"
              value={p.count_per_trap_per_day}
              status={p.count_status}
              reason={
                p.count_status === 'INSUFFICIENT_WINDOW' && p.count_raw !== undefined
                  ? `Monitoring window is under one day, so no rate can be stated. Raw count from the last image: ${p.count_raw}.`
                  : undefined
              }
              source={p.source}
            />
          </View>

          <Panel
            label={p.threshold_confirmed ? 'Threshold · confirmed' : 'Threshold · provisional'}
            tone={p.threshold_confirmed ? 'neutral' : 'warn'}
          >
            {p.threshold_confirmed
              ? `${p.threshold} — ${p.threshold_source}`
              : `${p.threshold} — uncited estimate, do not treat as an ICAR figure. ${p.threshold_source}`}
          </Panel>

          <ChipRow>
            {p.trend ? <Chip label="TREND" value={p.trend.replace(/_/g, ' ')} /> : null}
            <Chip
              label="TRAP AGE"
              value={p.input_age_hours === null ? 'none' : formatAge(p.input_age_hours)}
              tone={p.input_age_hours !== null && p.input_age_hours > 24 ? 'warn' : 'neutral'}
            />
          </ChipRow>
        </View>
      ))}
    </Card>
  );
}

// ---- Actions --------------------------------------------------------------

const CONFIDENCE_TONE: Record<string, Tone> = { high: 'good', medium: 'neutral', low: 'warn' };

/**
 * §14.2 step 3: "advisory_only: true must appear on every action. We dropped
 * actuation; the UI must not imply otherwise." Per-action rather than one
 * disclaimer at the bottom, so it cannot scroll out of view.
 *
 * Laid out like the site's CHECK NEXT panel: the action as the headline, the
 * rationale as the tinted block under it.
 */
export function ActionsCard({ actions }: { actions: Advisory['actions'] }) {
  if (actions.length === 0) {
    return (
      <Card eyebrow="Advisory" title="Recommended actions">
        <Muted>No actions in this advisory.</Muted>
      </Card>
    );
  }
  return (
    <Card eyebrow="Advisory" title="Recommended actions">
      {actions.map((a, i) => (
        <View key={a.rank} style={{ marginTop: i === 0 ? 0 : space.lg }}>
          <View style={s.head}>
            <View style={s.rank}>
              <Text style={[type.chipLabel, { color: color.primaryForeground }]}>{a.rank}</Text>
            </View>
            <Text style={[type.label, { color: color.foreground, flex: 1 }]}>{a.action}</Text>
          </View>

          <Panel label="Why" tone="neutral">
            {a.rationale}
          </Panel>

          <ChipRow>
            <Chip
              label="CONFIDENCE"
              value={a.confidence}
              tone={CONFIDENCE_TONE[a.confidence] ?? 'neutral'}
            />
            <Chip value={a.advisory_only ? 'ADVISORY ONLY' : 'UNLABELLED'} tone={a.advisory_only ? 'good' : 'bad'} />
          </ChipRow>
        </View>
      ))}
    </Card>
  );
}

// ---- Vegetation / water ---------------------------------------------------

export function VegetationCard({ vegetation }: { vegetation: Advisory['vegetation'] }) {
  const { vari, exg, tgi, dgci } = vegetation;
  return (
    <Card eyebrow="Vegetation" title="Canopy indices">
      <View style={s.grid}>
        <View style={s.gridCell}>
          <Measurement label="VARI" value={vari.mean} source={vari.source} size="compact" />
        </View>
        <View style={s.gridCell}>
          <Measurement label="ExG" value={exg.mean} source={exg.source} size="compact" />
        </View>
        <View style={s.gridCell}>
          <Measurement label="TGI" value={tgi.mean} source={tgi.source} size="compact" />
        </View>
        <View style={s.gridCell}>
          <Measurement label="DGCI" value={dgci.mean} source={dgci.source} size="compact" />
        </View>
      </View>

      <ChipRow>
        {vari.p10 !== undefined ? <Chip label="VARI p10/p90" value={`${vari.p10} / ${vari.p90}`} /> : null}
        {dgci.out_of_domain_fraction !== undefined ? (
          <Chip
            label="DGCI OUT OF DOMAIN"
            value={`${(dgci.out_of_domain_fraction * 100).toFixed(0)}%`}
            tone={dgci.out_of_domain_fraction > 0.1 ? 'warn' : 'neutral'}
          />
        ) : null}
      </ChipRow>

      <Divider />
      {/* §1 — NDVI is carried as a first-class field so nothing downstream
          changes when the optics land. It shows as pending, never estimated. */}
      <Measurement
        label="NDVI"
        value={vegetation.ndvi}
        status={vegetation.ndvi_status}
        reason={vegetation.ndvi_reason}
      />
    </Card>
  );
}

export function WaterCard({ water }: { water: Advisory['water'] }) {
  return (
    <Card eyebrow="Water" title="Stress and balance">
      <Measurement
        label="CWSI"
        value={water.cwsi}
        status={water.cwsi_status}
        reason={
          water.cwsi_reason ??
          (water.cwsi_status === 'BASELINE_INITIALIZING' && water.cwsi_days_remaining !== undefined
            ? `Baseline is ${water.cwsi_days_remaining} days from complete. No value is emitted until it is.`
            : undefined)
        }
        source={water.cwsi === null ? undefined : 'derived'}
      />
      {water.cwsi_status === 'BASELINE_INITIALIZING' && water.cwsi_days_remaining !== undefined ? (
        <ChipRow>
          <Chip label="BASELINE" value={`${water.cwsi_days_remaining} days remaining`} tone="warn" />
        </ChipRow>
      ) : null}

      <Divider />

      <View style={s.grid}>
        <View style={s.gridCell}>
          <Measurement
            label="FAO-56 depletion"
            value={water.fao56.depletion_mm}
            unit="mm"
            status={water.fao56.status}
            source={water.fao56.source}
            size="compact"
          />
        </View>
        <View style={s.gridCell}>
          <Measurement
            label="FAO-56 Ks"
            value={water.fao56.ks}
            status={water.fao56.status}
            source={water.fao56.source}
            size="compact"
          />
        </View>
      </View>
    </Card>
  );
}

export function DiseaseCard({ disease }: { disease: Advisory['disease'] }) {
  if (disease.length === 0) {
    return (
      <Card eyebrow="Disease" title="Classifier findings">
        <Muted>Nothing flagged in this flight&apos;s inspection crops.</Muted>
      </Card>
    );
  }
  return (
    <Card eyebrow="Disease" title="Classifier findings">
      {disease.map((d, i) => (
        <View key={`${d.class}-${i}`} style={{ marginTop: i === 0 ? 0 : space.lg }}>
          {i > 0 ? <Divider /> : null}
          <View style={s.head}>
            <Text style={[type.cardTitle, { color: color.foreground, flex: 1 }]}>
              {d.class.replace(/_/g, ' ')}
            </Text>
            <SourceTag source={d.source} />
          </View>

          <ConfidenceBar value={d.confidence} />

          <ChipRow>
            <Chip label="CROPS" value={String(d.n_inspection_crops)} />
            <Chip value="NEEDS INSPECTION" tone="warn" />
          </ChipRow>
        </View>
      ))}
    </Card>
  );
}

const s = StyleSheet.create({
  banner: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: 10,
    marginBottom: space.md,
  },
  violations: {
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: color.destructiveBorder,
    backgroundColor: color.destructiveMuted,
    padding: space.lg,
    marginBottom: space.md,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  rank: {
    width: 20,
    height: 20,
    borderRadius: radius.sm,
    backgroundColor: color.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -space.sm },
  gridCell: { width: '50%', paddingHorizontal: space.sm },
});
