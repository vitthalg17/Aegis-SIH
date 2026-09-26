/**
 * Advisory blocks: provenance, verdict, growth stage, actions, inputs, scan.
 *
 * Built on the site's alert-card structure: a mono micro-label, the value, then
 * tinted WHY / CHECK NEXT sub-panels and a chip strip at the foot. Each block
 * exists to satisfy a named requirement from the wire contract, and the comment
 * on each says which.
 *
 * ── The recurring idea ──────────────────────────────────────────────────────
 * The pod is headless and the mast has no screen. This app is the only place a
 * farmer can ever learn that something was withheld, gated, provisional or
 * unmeasured. So every one of those states is rendered as a first-class thing
 * with its own words, not as a blank, a dash, or a zero.
 */

import { StyleSheet, Text, View } from 'react-native';

import {
  Card,
  Chip,
  ChipRow,
  Divider,
  Muted,
  Panel,
  Row,
  StatusChip,
  TONE,
  VerificationBadge,
  humaniseStatus,
} from './components.tsx';
import type { Tone } from './components.tsx';
import { EvidenceBar, Meter, Stat } from './charts.tsx';
import { color, radius, shadow, space, type } from './theme.ts';
import type {
  Advisory,
  AdvisoryInput,
  CropHealth,
  CropHealthState,
  GrowthStage,
  InputStatus,
} from '../schema/advisory.ts';
import { DRIED_LEAF_CAVEAT, DRIED_LEAF_CLASS, describeClass } from '../schema/classes.ts';
import { renderAction } from '../schema/templates.ts';
import type { Language } from '../schema/templates.ts';
import type { AdvisoryOrigin } from '../db/advisories.ts';
import type { Violation } from '../schema/validate.ts';
import { describeViolation } from '../schema/validate.ts';

// ---- Origin and backend ---------------------------------------------------

/**
 * Never present replayed history as live measurement. Sample and replay data
 * get a banner at the top of every screen that shows them, not a subtle
 * footnote.
 *
 * Note this keys on the stored origin, which is resolved with `isReplay` — a
 * missing `replay` field reads as replay, not as live. A bug on either side
 * produces the under-claim rather than the over-claim.
 */
export function OriginBanner({ origin }: { origin: AdvisoryOrigin }) {
  if (origin === 'synced') return null;

  const copy: Record<Exclude<AdvisoryOrigin, 'synced'>, { label: string; body: string; tone: Tone }> = {
    fixture: {
      label: 'SAMPLE DATA · NOT A MEASUREMENT',
      body: 'These values were invented to exercise the app. No sensor produced them.',
      tone: 'warn',
    },
    replay: {
      label: 'REPLAY · NOT A LIVE SCAN',
      body: 'Assembled from a recorded video file rather than captured during this scan. Real model output on real footage, but not a reading taken just now. A live walk reports this as false.',
      tone: 'unknown',
    },
    imported: {
      label: 'IMPORTED FILE · NOT PULLED FROM A POD',
      body: 'Loaded from a file on this phone rather than synced over the field link. Check it came from the pod you think it did.',
      tone: 'unknown',
    },
  };

  const c = copy[origin];
  const t = TONE[c.tone];
  return (
    <View style={[s.banner, { borderColor: t.border, backgroundColor: t.bg }]}>
      <Text style={[type.micro, { color: t.fg }]}>{c.label}</Text>
      <Text style={[type.small, { color: t.fg, marginTop: 5 }]}>{c.body}</Text>
    </View>
  );
}

/**
 * Which engine produced these diagnoses.
 *
 * `trt` is the normal, silent case and gets a chip rather than a banner. The
 * other two are worth interrupting for:
 *
 *   onnx  the CPU fallback ran instead of the GPU. The numbers are the same
 *         model, but the fact that it happened at all means something about the
 *         device is not as expected, and it is the kind of thing that only ever
 *         gets noticed if the app says so.
 *   mock  a synthetic test vector. A production gateway returns 403 rather than
 *         serving one of these, so a `mock` advisory on this phone did not come
 *         from a production pod and nothing in it is a measurement.
 */
export function BackendBanner({ advisory }: { advisory: Advisory }) {
  const backend = advisory.inference_backend;
  if (backend === 'trt') return null;

  const mock = backend === 'mock';
  const t = mock ? TONE.bad : TONE.warn;
  return (
    <View style={[s.banner, { borderColor: t.border, backgroundColor: t.bg }]}>
      <Text style={[type.micro, { color: t.fg }]}>
        {mock ? 'SIMULATED MODEL OUTPUT · NOT A MEASUREMENT' : 'RAN ON THE FALLBACK ENGINE'}
      </Text>
      <Text style={[type.small, { color: t.fg, marginTop: 5 }]}>
        {mock
          ? 'This advisory was produced by the simulated inference backend, not by the model running on the device. A pod in normal operation refuses to hand these out at all. Nothing here is a reading of a real plant.'
          : 'The classifier ran on the processor rather than the graphics engine it is meant to use. The findings are from the same model, but the pod did not start up the way it should have — worth mentioning to whoever maintains it.'}
      </Text>
    </View>
  );
}

// ---- Schema violations ----------------------------------------------------

/** An advisory that broke a schema rule is shown as broken, not quietly rendered. */
export function ViolationsCard({ violations }: { violations: Violation[] }) {
  if (violations.length === 0) return null;
  return (
    <View style={s.violations}>
      <Text style={[type.micro, { color: color.destructive }]}>
        {violations.length} SCHEMA VIOLATION{violations.length === 1 ? '' : 'S'}
      </Text>
      <Text style={[type.small, { color: color.destructive, marginTop: 6 }]}>
        This advisory does not satisfy the contract the pod and this app share. Do
        not act on it without checking the pod.
      </Text>
      {violations.map((v, i) => (
        <Text key={i} style={[type.valueSmall, { color: color.destructive, marginTop: 5 }]}>
          • {describeViolation(v)}
        </Text>
      ))}
    </View>
  );
}

// ---- Crop health ----------------------------------------------------------

const HEALTH_TONE: Record<string, Tone> = {
  HEALTHY: 'good',
  DISEASE: 'bad',
  NOT_CROP: 'unknown',
  UNCERTAIN: 'warn',
  NO_DATA: 'unknown',
};

const HEALTH_HEADLINE: Record<string, string> = {
  HEALTHY: 'Looks healthy',
  DISEASE: 'Something was found',
  NOT_CROP: 'This was not crop',
  UNCERTAIN: 'Not clear enough to say',
  NO_DATA: 'Nothing was scanned',
};

const HEALTH_BODY: Record<string, string> = {
  HEALTHY:
    'The classifier made a positive, confident call that this is a healthy crop. That is a stronger statement than "we found nothing wrong".',
  DISEASE: 'The classifier found a condition it recognises. Confirm it by eye before treating anything.',
  NOT_CROP:
    'Most of what the camera saw was not crop — soil, a hand, a path. Nothing was diagnosed because there was nothing to diagnose.',
  UNCERTAIN:
    'The frames disagreed with each other. Rather than pick a winner from a weak field, the pod declined to call it.',
  NO_DATA: 'No frames were evaluated in this scan.',
};

/** The reasons the aggregator gives for declining to call a verdict. */
const HEALTH_REASON_COPY: Record<string, string> = {
  MULTIPLE_CROPS_DETECTED:
    'The camera saw more than one kind of crop and no single one reached the four-in-five majority the pod needs before it will name a crop. Check whether you walked across a boundary or through an intercropped strip — and treat the findings below as belonging to several different crops, not one.',
  HIGH_UNCERTAINTY:
    'The frames disagreed with each other too much for any one answer to stand out.',
  UNCONFIRMED_DETECTIONS:
    'Something was seen, but never twice in a row. The pod needs at least two agreeing frames before it will call a finding, so this was left uncalled.',
};

/**
 * The block that exists because an empty disease list is ambiguous.
 *
 * "Healthy", "nothing scanned", "everything was rejected as not-crop" and "the
 * model could not decide" are four different things to tell a farmer, and
 * before this block they all rendered as the same empty list.
 */
export function CropHealthCard({
  health,
  topClass,
}: {
  health: CropHealth;
  /** The strongest entry in `disease[]`. v1.0 dropped `crop_health.class`. */
  topClass: string | null;
}) {
  const tone = HEALTH_TONE[health.state] ?? 'unknown';
  const t = TONE[tone];
  const isDriedLeaf = topClass === DRIED_LEAF_CLASS;
  const described = topClass ? describeClass(topClass) : null;

  const total = health.frames_evaluated;
  const rejected = health.frames_rejected_ood + health.frames_rejected_not_crop;
  const other = Math.max(0, total - health.frames_agreeing - health.frames_uncertain);

  return (
    <View style={[s.verdictCard, { borderColor: t.border }]}>
      {/* The band carries the state colour; the words carry the state. Never
          one without the other — this has to read in sun and in grayscale. */}
      <View style={[s.verdictBand, { backgroundColor: t.bg, borderBottomColor: t.border }]}>
        <Text style={[type.micro, { color: t.fg }]}>VERDICT</Text>
        <Text style={[type.title, { color: t.fg, marginTop: 6 }]}>
          {HEALTH_HEADLINE[health.state] ?? String(health.state)}
        </Text>
        {described ? (
          <Text style={[type.small, { color: t.fg, marginTop: 4, opacity: 0.9 }]}>
            {described.label}
          </Text>
        ) : health.crop ? (
          <Text style={[type.small, { color: t.fg, marginTop: 4, opacity: 0.9 }]}>
            {health.crop.charAt(0).toUpperCase() + health.crop.slice(1)}
          </Text>
        ) : null}
      </View>

      <View style={{ padding: space.lg }}>
        {/* The hero figure: how much of the evidence agreed. One per screen.
            This leads rather than the confidence because held-out accuracy is
            far below in-distribution accuracy — agreement across frames is the
            more honest signal of the two. */}
        {total > 0 ? (
          <View style={s.heroRow}>
            <Text style={[type.hero, { color: t.fg }]}>{health.frames_agreeing}</Text>
            <View style={{ flex: 1, paddingBottom: 6 }}>
              <Text style={[type.label, { color: color.foreground }]}>
                of {total} frames agreed
              </Text>
              <Text style={[type.small, { color: color.mutedForeground, marginTop: 2 }]}>
                Each frame is judged on its own, then they vote.
              </Text>
            </View>
          </View>
        ) : null}

        {total > 0 ? (
          <EvidenceBar
            segments={[
              { count: health.frames_agreeing, label: 'agreed', tone },
              { count: other, label: 'disagreed', tone: 'neutral' },
              { count: health.frames_uncertain, label: 'unsure', tone: 'warn' },
            ]}
          />
        ) : null}

        <Text style={[type.small, { color: color.mutedForeground, marginTop: space.md }]}>
          {HEALTH_BODY[health.state] ?? ''}
        </Text>

        {/* The model groups dried leaf with the healthy classes, which is right
            for the model and wrong for the farmer. Never "your sugarcane is
            healthy" when what was detected is dried leaves. */}
        {isDriedLeaf ? (
          <Panel label="What this actually means" tone="warn">
            {DRIED_LEAF_CAVEAT}
          </Panel>
        ) : null}

        {health.reason ? (
          <Panel label="Why it could not be called" tone="warn">
            {HEALTH_REASON_COPY[health.reason] ?? humaniseStatus(health.reason)}
          </Panel>
        ) : null}

        {/* Thrown-away frames are a separate count from the vote, because they
            never entered it. Reporting them inside the bar would make the
            denominator mean two things at once. */}
        {rejected > 0 ? (
          <Text style={[type.small, { color: color.mutedForeground, marginTop: space.sm }]}>
            Separately, {health.frames_rejected_not_crop} frame
            {health.frames_rejected_not_crop === 1 ? ' was' : 's were'} not crop and{' '}
            {health.frames_rejected_ood} did not look like anything the model was trained
            on. Both were thrown away before the vote rather than forced into a class.
          </Text>
        ) : null}
      </View>
    </View>
  );
}

// ---- Growth stage ---------------------------------------------------------

const STAGE_LABEL: Record<string, string> = {
  initial: 'Just established',
  development: 'Growing out',
  mid_season: 'Full canopy',
  late_season: 'Ripening',
};

/**
 * Where the crop is in its season, and what that is worth.
 *
 * Two provenance fields, and the card renders them separately because they mean
 * different things (registry §1.3). The stage boundaries come from FAO-56. The
 * *cycle length* — how long this variety takes — is either the farmer's own
 * answer, which is authoritative for their field, or a regional default the app
 * should be inviting them to correct.
 */
export function GrowthStageCard({ stage }: { stage: GrowthStage }) {
  const known = Boolean(stage.stage);
  const cycleFromFarmer =
    stage.cycle_verification_status === 'VERIFIED' ||
    stage.cycle_source === 'user_override' ||
    stage.cycle_source === 'farmer_override';

  const days = stage.days_since_planting;
  const cycle = stage.total_cycle_days;
  const canopy = stage.canopy_cover_measured;
  const expected = stage.canopy_cover_expected_range;

  return (
    <Card eyebrow="Season" title="Where the crop is">
      {!known ? (
        <Panel label="Stage not worked out" tone="unknown">
          {humaniseStatus(stage.reason ?? stage.status)}
        </Panel>
      ) : (
        <>
          <View style={s.head}>
            <View style={{ flex: 1 }}>
              <Text style={[type.cardTitle, { color: color.foreground }]}>
                {STAGE_LABEL[stage.stage ?? ''] ?? String(stage.stage)}
              </Text>
              <Text style={[type.valueSmall, { color: color.fgSubtle, marginTop: 3 }]}>
                {stage.crop ? `${stage.crop} · ` : ''}
                {stage.stage_code ?? ''}
              </Text>
            </View>
            {typeof stage.kc === 'number' ? (
              <Chip label="WATER FACTOR" value={stage.kc.toFixed(2)} />
            ) : null}
          </View>

          {typeof days === 'number' && typeof cycle === 'number' && cycle > 0 ? (
            <Meter
              value={Math.min(days, cycle)}
              min={0}
              max={cycle}
              tone="good"
              markerLabel={`day ${days}`}
              caption={`Day ${days} of an assumed ${cycle}-day cycle.`}
            />
          ) : null}

          {/* Measured canopy against what this stage should look like. When
              they disagree, the planting date is usually the thing that is
              wrong, not the crop — which is a useful thing to be told. */}
          {typeof canopy === 'number' && expected ? (
            <Panel
              label="Canopy against the stage"
              tone={canopy >= expected[0] && canopy <= expected[1] ? 'good' : 'warn'}
            >
              {`The scan measured ${Math.round(canopy * 100)}% ground cover. A crop at this stage is usually between ${Math.round(
                expected[0] * 100,
              )}% and ${Math.round(expected[1] * 100)}%.`}
              {canopy < expected[0]
                ? ' Less cover than expected can mean the planting date entered is too early, or that the crop is behind.'
                : canopy > expected[1]
                  ? ' More cover than expected usually means the planting date entered is too late.'
                  : ''}
            </Panel>
          ) : null}
        </>
      )}

      <Divider />

      {/* The variety cycle, and whose claim it is. */}
      <Panel
        label={cycleFromFarmer ? 'Variety · confirmed by you' : 'Variety · assumed'}
        tone={cycleFromFarmer ? 'good' : 'warn'}
      >
        {cycleFromFarmer
          ? `Worked out using the ${cycle ?? 'stated'}-day cycle you entered for your own seed variety.`
          : `No seed variety has been entered, so a regional default of ${cycle ?? 'the standard'} days was assumed. If you know your variety, the stage above will get noticeably better once you enter it.`}
      </Panel>

      {stage.document_reference ? (
        <Text style={[type.valueSmall, { color: color.fgSubtle, marginTop: space.sm }]}>
          {stage.document_reference}
        </Text>
      ) : null}
    </Card>
  );
}

// ---- Inputs ---------------------------------------------------------------

const INPUT_LABEL: Record<string, string> = {
  pod_thermal: 'Pod thermal camera',
  pod_gps: 'Pod GPS',
  pod_camera_rgb: 'Pod colour camera',
  pod_ndvi: 'Pod infrared camera',
  mast_ambient: 'Air temp / humidity',
  mast_soil: 'Soil probes',
  mast_trap: 'Sticky trap camera',
};

const INPUT_STATUS_TONE: Record<string, Tone> = {
  OK: 'good',
  PENDING_CALIBRATION: 'warn',
  MOCK_PROVISIONAL: 'bad',
  ABSENT: 'unknown',
};

const INPUT_STATUS_LABEL: Record<string, string> = {
  OK: 'WORKING',
  PENDING_CALIBRATION: 'NEEDS CALIBRATION',
  MOCK_PROVISIONAL: 'SIMULATED',
  ABSENT: 'NOT CONNECTED',
};

/**
 * What each status actually means for the numbers on this screen.
 *
 * `PENDING_CALIBRATION` is the one worth getting right and the one an
 * inattentive UI renders as a fault. The sensor is present, connected and
 * returning real data. What is missing is a calibration step, and the derived
 * figure that needs it was withheld rather than estimated. That is the system
 * behaving correctly, and it should not be painted red.
 */
const INPUT_STATUS_BODY: Record<string, string> = {
  PENDING_CALIBRATION:
    'This sensor is connected and working. What it measures directly is real and is shown. A second figure worked out from it needs a calibration step that has not been done, so that figure was left out rather than guessed.',
  MOCK_PROVISIONAL:
    'This sensor is being simulated. Nothing that depends on it is a measurement of your field.',
  ABSENT:
    'This sensor was not connected during the scan. Anything that needed it is missing rather than estimated.',
};

/**
 * What the advisory was built from.
 *
 * Contract v1.0 trimmed this block to name, node and status — there are no
 * per-input ages or RTC flags on the wire any more. The status enum carries
 * the whole story now, and the four values are genuinely different claims.
 */
export function InputsCard({ inputs }: { inputs: AdvisoryInput[] }) {
  if (!inputs || inputs.length === 0) {
    return (
      <Card eyebrow="Provenance" title="What this was built from">
        <Panel label="Nothing declared" tone="bad">
          This advisory does not list the sensors it came from, so there is no way to
          tell which of its numbers were measured and which were not.
        </Panel>
      </Card>
    );
  }

  return (
    <Card eyebrow="Provenance" title="What this was built from">
      {inputs.map((input, i) => {
        const status = input.status as InputStatus;
        const body = INPUT_STATUS_BODY[status];
        return (
          <View key={`${input.name}-${i}`}>
            {i > 0 ? <Divider /> : null}
            <Row>
              <View style={{ flex: 1 }}>
                <Text style={[type.label, { color: color.foreground }]}>
                  {INPUT_LABEL[input.name] ?? input.name.replace(/_/g, ' ')}
                </Text>
                <Text style={[type.valueSmall, { color: color.fgSubtle, marginTop: 3 }]}>
                  {input.source_node === 'POD' ? 'on the pod you carry' : 'on the field station'}
                </Text>
              </View>
              <StatusChip
                label={INPUT_STATUS_LABEL[status] ?? String(status).replace(/_/g, ' ')}
                tone={INPUT_STATUS_TONE[status] ?? 'bad'}
              />
            </Row>
            {body ? (
              <Panel
                label={INPUT_STATUS_LABEL[status] ?? 'Note'}
                tone={INPUT_STATUS_TONE[status] ?? 'bad'}
              >
                {body}
              </Panel>
            ) : null}
          </View>
        );
      })}
    </Card>
  );
}

// ---- Actions --------------------------------------------------------------

const CONFIDENCE_TONE: Record<string, Tone> = { high: 'good', medium: 'neutral', low: 'warn' };

/**
 * The pod's recommended actions — the product.
 *
 * These are what a farmer gets with no connection, in their own language,
 * complete. The generated explanation elsewhere on the screen is a nicer
 * rendering of them, never a substitute.
 *
 * Three things are non-negotiable here and all three come from the registry:
 *
 *   advisory_only appears on every action, per-action rather than once at the
 *   bottom, so it cannot scroll out of view. Actuation was dropped from scope
 *   and the UI must not imply otherwise.
 *
 *   The verification badge renders from the structural enum, so switching to
 *   Hindi cannot drop it — which is the failure mode §1.2 exists to prevent.
 *
 *   RECALLED_UNVERIFIED carries its caution panel unconditionally. There is no
 *   prop on `VerificationBadge` that suppresses it.
 */
export function ActionsCard({
  actions,
  language = 'en',
}: {
  actions: Advisory['actions'];
  language?: Language;
}) {
  if (!actions || actions.length === 0) {
    return (
      <Card eyebrow="Advisory" title="What to do">
        <Muted>No actions in this advisory.</Muted>
      </Card>
    );
  }

  return (
    <Card eyebrow="Advisory" title={language === 'hi' ? 'क्या करें' : 'What to do'}>
      {actions.map((a, i) => {
        const r = renderAction(a, language);
        return (
          <View key={`${a.rank}-${a.template_id}`} style={{ marginTop: i === 0 ? 0 : space.lg }}>
            {i > 0 ? <Divider /> : null}
            <View style={s.head}>
              <View style={s.rank}>
                <Text style={[type.chipLabel, { color: color.primaryForeground }]}>{a.rank}</Text>
              </View>
              <Text style={[type.label, { color: color.foreground, flex: 1 }]}>{r.action}</Text>
            </View>

            {/* Mandatory, structural, and above the reasoning rather than
                below it — a caution a reader reaches after the dose is a
                caution they read after deciding. */}
            <VerificationBadge status={a.verification_status} language={language} />

            {r.rationale ? (
              <Panel label={language === 'hi' ? 'क्यों' : 'Why'} tone="neutral">
                {r.rationale}
              </Panel>
            ) : null}

            {/* The retrievable source, for anyone who wants to check. Shown as
                text rather than a link: this phone is offline in the field and
                a dead tap is worse than plain text you can type out later. */}
            {a.url ? (
              <Text style={[type.valueSmall, { color: color.fgSubtle, marginTop: space.sm }]}>
                {a.url}
              </Text>
            ) : null}

            {!r.localised ? (
              <Panel label="Not translated" tone="warn">
                This app has no Hindi wording for this instruction, so the pod&apos;s English
                is shown instead. Nothing has been left out — but ask someone to read it
                with you rather than guessing at it.
              </Panel>
            ) : null}

            {/* The pod and this app disagree about how well-sourced this
                advice is. Not fatal, and the pod wins — but one of the two is
                out of date and a silent disagreement is how a caution goes
                missing. */}
            {r.verificationMismatch ? (
              <Panel label="Source marking disagrees" tone="warn">
                The pod marked this advice differently from the registry this app ships
                with. The pod&apos;s marking is the one shown above. Worth reporting — it
                means one of the two is out of date.
              </Panel>
            ) : null}

            <ChipRow>
              <Chip
                label="CONFIDENCE"
                value={String(a.confidence)}
                tone={CONFIDENCE_TONE[a.confidence] ?? 'neutral'}
              />
              <Chip
                value={a.advisory_only ? 'ADVISORY ONLY' : 'UNLABELLED'}
                tone={a.advisory_only ? 'good' : 'bad'}
              />
              {/* Provenance of the words themselves. The pod has no generative
                  layer, so anything not stamped "template" did not come from it. */}
              <Chip
                label="WORDING"
                value={a.generated_by === 'template' ? 'FIXED TEMPLATE' : String(a.generated_by)}
                tone={a.generated_by === 'template' ? 'neutral' : 'warn'}
              />
            </ChipRow>
          </View>
        );
      })}

      {/* One standing note at the foot, in addition to the per-action chip.
          Nothing in this system operates a pump, a valve or a sprayer. */}
      <Panel label="Advisory only" tone="neutral">
        This system recommends; it does not act. It is not connected to any pump, valve
        or sprayer, and nothing above happens on its own.
      </Panel>
    </Card>
  );
}

// ---- Scan -----------------------------------------------------------------

/** What the walk itself consisted of. Never labelled a flight. */
export function ScanCard({ advisory }: { advisory: Advisory }) {
  const scan = advisory.scan;
  return (
    <Card eyebrow="Scan" title="How this was collected">
      <Row>
        <Muted>Started</Muted>
        <Text style={[type.valueSmall, { color: color.foreground }]}>
          {formatStamp(scan.started_utc)}
        </Text>
      </Row>
      {scan.ended_utc ? (
        <Row>
          <Muted>Finished</Muted>
          <Text style={[type.valueSmall, { color: color.foreground }]}>
            {formatStamp(scan.ended_utc)}
          </Text>
        </Row>
      ) : null}

      <View style={s.statRow}>
        <Stat value={String(scan.frames_captured)} caption="Frames taken" />
        <Stat value={String(scan.frames_evaluated)} caption="Good enough to use" />
        <Stat value={String(scan.tiles_classified)} caption="Patches examined" />
      </View>

      {/* Frames are thrown away by quality gates before anything is classified.
          A scan that kept a third of its frames is a scan worth repeating, and
          nothing else on the screen says so. */}
      {scan.frames_captured > 0 && scan.frames_evaluated / scan.frames_captured < 0.6 ? (
        <Panel label="Most frames were discarded" tone="warn">
          {`Only ${scan.frames_evaluated} of ${scan.frames_captured} frames were sharp and well-lit enough to use. Walking more slowly, holding the pod steadier, or scanning out of hard direct sun will keep more of them.`}
        </Panel>
      ) : null}

      <Divider />

      <Row>
        <Muted>Distance walked</Muted>
        <Text style={[type.valueSmall, { color: color.foreground }]}>
          {scan.distance_walked_m === null ? 'not recorded' : `${scan.distance_walked_m} m`}
        </Text>
      </Row>
      {scan.distance_walked_m === null && scan.distance_reason ? (
        <Panel label="Distance walked" tone="unknown">
          {humaniseStatus(scan.distance_reason)}
        </Panel>
      ) : null}

      <ChipRow>
        <Chip label="MODE" value={String(scan.mode).replace(/_/g, ' ')} />
        <Chip label="ENGINE" value={String(advisory.inference_backend).toUpperCase()} />
        <Chip
          label="SOURCE"
          value={advisory.replay ? 'RECORDED' : 'LIVE'}
          tone={advisory.replay ? 'unknown' : 'good'}
        />
        <Chip label="SEQ" value={String(advisory.seq)} />
      </ChipRow>
    </Card>
  );
}

export function formatStamp(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
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

  verdictCard: {
    backgroundColor: color.card,
    borderRadius: radius.xl,
    borderWidth: 1,
    overflow: 'hidden',
    marginBottom: space.md,
    ...shadow.card,
  },
  verdictBand: {
    paddingHorizontal: space.lg,
    paddingVertical: space.lg,
    borderBottomWidth: 1,
  },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.md,
    marginBottom: space.sm,
  },
  statRow: { flexDirection: 'row', gap: space.md, marginTop: space.lg },
  rank: {
    width: 20,
    height: 20,
    borderRadius: radius.sm,
    backgroundColor: color.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
