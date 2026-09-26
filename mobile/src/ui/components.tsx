/**
 * The renderer primitives, in the site's visual idiom.
 *
 * Ported shapes from `web/components/ui/bits.tsx` and `alert-card.tsx`:
 * Eyebrow (mono label with a dot), Chip (mono key/value), StatCard (big mono
 * figure over a caption), and the bordered sub-panel the alert card uses for
 * its WHY / CHECK NEXT blocks. Same radii, same tracking, same three-level
 * text hierarchy.
 *
 * §14.3 still governs the behaviour underneath the styling: "the app is the
 * last place a fabricated number can be caught, and the easiest place for one
 * to be created." `<Measurement>` takes a value and its status together and
 * has no prop that renders a null as 0, blank, or a dash.
 */

import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { color, radius, shadow, space, type } from './theme.ts';
import type { SourceKind, VerificationStatus } from '../schema/advisory.ts';
import { presentVerification } from '../schema/templates.ts';
import type { Language } from '../schema/templates.ts';

// ---- Tones ----------------------------------------------------------------

export type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'unknown';

/** border / surface / text for each tone, matching the site's chip variants. */
export const TONE: Record<Tone, { border: string; bg: string; fg: string }> = {
  neutral: { border: color.border, bg: color.muted, fg: color.mutedForeground },
  good: { border: color.accent, bg: color.secondary, fg: color.secondaryForeground },
  warn: { border: color.warningBorder, bg: color.warningMuted, fg: color.warningForeground },
  bad: { border: color.destructiveBorder, bg: color.destructiveMuted, fg: color.destructive },
  unknown: { border: color.unknownBorder, bg: color.unknownSurface, fg: color.unknown },
};

// ---- Eyebrow --------------------------------------------------------------

/** The mono label with a leading dot that opens a section on the site. */
export function Eyebrow({
  children,
  tone = 'good',
  onDeep = false,
}: {
  children: ReactNode;
  tone?: Tone;
  onDeep?: boolean;
}) {
  const t = onDeep
    ? { border: color.deepBorder, bg: 'rgba(31,52,32,0.6)', fg: color.deepMuted }
    : TONE[tone];
  return (
    <View style={[s.eyebrow, { borderColor: t.border, backgroundColor: t.bg }]}>
      <View style={[s.dot, { backgroundColor: onDeep ? color.primary : t.fg }]} />
      <Text style={[type.eyebrow, { color: t.fg }]}>{children}</Text>
    </View>
  );
}

// ---- Chip -----------------------------------------------------------------

/** Mono key/value chip. `label` is optional, as on the site. */
export function Chip({
  label,
  value,
  tone = 'neutral',
}: {
  label?: string;
  value: ReactNode;
  tone?: Tone;
}) {
  const t = TONE[tone];
  return (
    <View style={[s.chip, { borderColor: t.border, backgroundColor: t.bg }]}>
      {label ? <Text style={[type.chipLabel, { color: t.fg }]}>{label}</Text> : null}
      <Text style={[type.chipValue, { color: tone === 'neutral' ? color.foreground : t.fg }]}>
        {value}
      </Text>
    </View>
  );
}

/** The compact status pill — the site's SeverityChip. */
export function StatusChip({ label, tone = 'neutral' }: { label: string; tone?: Tone }) {
  const t = TONE[tone];
  return (
    <View style={[s.statusChip, { borderColor: t.border, backgroundColor: t.bg }]}>
      <Text style={[type.chipLabel, { color: t.fg }]}>{label}</Text>
    </View>
  );
}

// ---- Card -----------------------------------------------------------------

export function Card({
  title,
  eyebrow,
  right,
  children,
}: {
  title?: string;
  eyebrow?: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <View style={s.card}>
      {(title || eyebrow || right) && (
        <View style={s.cardHead}>
          <View style={{ flex: 1 }}>
            {eyebrow ? (
              <Text style={[type.micro, { color: color.fgSubtle, marginBottom: 5 }]}>
                {eyebrow.toUpperCase()}
              </Text>
            ) : null}
            {title ? (
              <Text style={[type.cardTitle, { color: color.foreground }]}>{title}</Text>
            ) : null}
          </View>
          {right}
        </View>
      )}
      {children}
    </View>
  );
}

/**
 * The bordered sub-panel the alert card uses for WHY and CHECK NEXT: a mono
 * micro-label over prose, tinted by tone.
 */
export function Panel({
  label,
  tone = 'neutral',
  children,
}: {
  label: string;
  tone?: Tone;
  children: ReactNode;
}) {
  const t = TONE[tone];
  return (
    <View style={[s.panel, { borderColor: t.border, backgroundColor: t.bg }]}>
      <Text style={[type.micro, { color: t.fg }]}>{label.toUpperCase()}</Text>
      <Text style={[type.small, { color: t.fg, marginTop: 6 }]}>{children}</Text>
    </View>
  );
}

/** Big mono figure over a caption — the site's StatCard. */
export function StatCard({
  value,
  caption,
  highlight = false,
}: {
  value: string;
  caption: string;
  highlight?: boolean;
}) {
  return (
    <View
      style={[
        s.stat,
        highlight
          ? { borderColor: color.accent, backgroundColor: color.secondary }
          : { borderColor: color.border, backgroundColor: color.card },
      ]}
    >
      <Text style={[type.stat, { color: highlight ? color.primary : color.foreground }]}>
        {value}
      </Text>
      <Text
        style={[
          type.small,
          { color: highlight ? color.secondaryForeground : color.mutedForeground, marginTop: 5 },
        ]}
      >
        {caption}
      </Text>
    </View>
  );
}

// ---- Confidence bar -------------------------------------------------------

/** The alert card's confidence meter: a 6px track with a mono figure beside it. */
export function ConfidenceBar({ value, label = 'CONF' }: { value: number; label?: string }) {
  const pct = Math.max(0, Math.min(1, value));
  return (
    <View style={s.confRow}>
      <Text style={[type.micro, { color: color.fgSubtle }]}>{label}</Text>
      <View style={s.confTrack}>
        <View style={[s.confFill, { width: `${pct * 100}%` }]} />
      </View>
      <Text style={[type.chipValue, { color: color.foreground }]}>{pct.toFixed(2)}</Text>
    </View>
  );
}

// ---- Measurement ----------------------------------------------------------

/**
 * The one way this app renders a quantity.
 *
 * Pass the value and the reason it might be absent in the same breath. A null
 * with no status is a programming error, not a display state, and it renders
 * as a loud one rather than as an innocuous blank.
 */
export function Measurement({
  label,
  value,
  unit,
  status,
  reason,
  source,
  note,
  size = 'default',
}: {
  label: string;
  value: number | string | null;
  unit?: string;
  /** Machine-readable status. Required when value is null (§7.3 rule 1). */
  status?: string;
  /** Human-readable reason. Shown verbatim when the value is absent. */
  reason?: string;
  source?: SourceKind;
  note?: string;
  size?: 'default' | 'compact';
}) {
  const absent = value === null || value === undefined;

  return (
    <View style={s.measurement}>
      <View style={s.measurementHead}>
        <Text style={[type.chipLabel, { color: color.fgSubtle }]}>{label.toUpperCase()}</Text>
        {source ? <SourceTag source={source} /> : null}
      </View>

      {absent ? (
        <NotMeasured status={status} reason={reason} />
      ) : (
        <View style={s.valueRow}>
          <Text
            style={[
              size === 'compact' ? type.value : type.stat,
              { color: color.foreground },
            ]}
          >
            {String(value)}
          </Text>
          {unit ? (
            <Text style={[type.chipValue, { color: color.fgSubtle, marginLeft: 5 }]}>{unit}</Text>
          ) : null}
        </View>
      )}

      {note ? (
        <Text style={[type.small, { color: color.mutedForeground, marginTop: 6 }]}>{note}</Text>
      ) : null}
    </View>
  );
}

/**
 * The explicit not-measured state. Never blank, never zero, never a dash.
 *
 * A missing status is itself rendered as a fault, because a null the app
 * cannot explain is exactly what §7.3 rule 1 exists to make impossible.
 */
export function NotMeasured({ status, reason }: { status?: string; reason?: string }) {
  const unexplained = !status && !reason;
  const t = unexplained ? TONE.bad : TONE.unknown;
  // The code without its parenthesised engineering detail, so a 90-character
  // reason string does not wrap across the header it is meant to label.
  const code = (status ?? reason ?? '').split(' (')[0];
  // The pod's own words, kept underneath ours. Its `*_reason` strings are
  // written for whoever is holding the device — "Optical path and calib_matrix
  // in progress" — so they belong below the farmer-facing sentence, not
  // instead of it, and they must not be thrown away either.
  const detail =
    statusDetail(status) ??
    statusDetail(reason) ??
    (reason && reason !== status ? reason : null);

  return (
    <View style={[s.notMeasured, { borderColor: t.border, backgroundColor: t.bg }]}>
      <View style={s.notMeasuredHead}>
        <Text style={[type.micro, { color: t.fg }]}>NOT MEASURED</Text>
        {code ? <Text style={[type.micro, { color: t.fg, opacity: 0.75 }]}>{code}</Text> : null}
      </View>
      <Text style={[type.small, { color: t.fg, marginTop: 6 }]}>
        {unexplained
          ? 'No status given. The advisory does not say why this is missing — treat this record as untrustworthy.'
          : humaniseStatus(status ?? reason)}
      </Text>
      {detail ? (
        <Text style={[type.valueSmall, { color: t.fg, opacity: 0.7, marginTop: 6 }]}>{detail}</Text>
      ) : null}
    </View>
  );
}

/**
 * Fallback prose for a status code that arrived without a written reason.
 *
 * The pod normally sends its own sentence, and that is preferred — this is the
 * safety net for a code it did not narrate. Every branch is written for a
 * farmer rather than for a developer: a screen that prints NOT_SOLAR_NOON at
 * someone standing in a field has told them nothing.
 */
export function humaniseStatus(status?: string): string {
  // Several reasons arrive as a code with a parenthesised engineering detail
  // appended — "HARDWARE_NOT_CONNECTED (Target CSI camera /dev/video1 not
  // found...)". Match on the code and keep the detail for the developer view.
  const code = (status ?? '').split(' (')[0];

  switch (code) {
    // -- Thermal / CWSI ------------------------------------------------------
    case 'THERMAL_REFS_NOT_CONFIGURED':
      return 'The thermal camera is working, but the wet and dry reference pads it measures against have not been set up. Canopy temperature is real; the stress index needs those pads and was not estimated without them.';
    case 'INSUFFICIENT_REFERENCE_GAP':
      return 'The wet and dry reference pads were too close in temperature for the stress index to mean anything.';
    case 'WET_REF_VARIANCE_HIGH':
    case 'DRY_REF_VARIANCE_HIGH':
      return 'One of the reference pads gave an unsteady reading, so the stress index was not worked out from it.';
    case 'HARDWARE_NOT_CONNECTED':
      return 'The sensor this needs was not connected during the scan.';

    // -- NDVI ----------------------------------------------------------------
    case 'GATED_HARDWARE_CALIBRATION':
    case 'PENDING_HARDWARE_FINALIZATION':
      return 'The second camera and its bench calibration have not landed yet. Nothing is estimated in their place.';
    case 'NOIR_CAMERA_NOT_DETECTED_ON_CSI_1':
      return 'The infrared camera was not found on the pod.';

    // -- Satellite -----------------------------------------------------------
    case 'NO_SATELLITE_DATA_RECORDED':
      return 'No satellite image has been downloaded for this field yet. That step needs an internet connection, which the pod does not have in the field.';
    case 'NO_CLEAR_SCENE':
      return 'Every recent satellite pass over this field was under cloud.';
    case 'CREDENTIALS_MISSING':
      return 'The satellite service login is not set up on the pod.';
    case 'FIELD_CONFIG_MISSING':
    case 'FIELD_NOT_CONFIGURED':
      return 'The boundary of this field has not been entered, so there is no area to read a satellite image over.';

    // -- Irrigation ----------------------------------------------------------
    case 'INSUFFICIENT_TEMPERATURE_HISTORY':
      return 'Not enough temperature readings came back from the field station in the last day to work out water use.';

    // -- Vegetation ----------------------------------------------------------
    case 'INSUFFICIENT_CANOPY_FRACTION':
      return 'Too little of the frame was canopy. Below that point soil colour dominates and the reading would be about the ground, not the crop.';
    case 'OUT_OF_DOMAIN_FRACTION_EXCEEDED':
      return 'Too much of the frame fell outside the range of greens this measure is defined for, so the average would have described a minority of the pixels.';
    case 'NO_FRAMES_ACCEPTED':
      return 'No frame in this scan passed the checks needed to compute it.';

    // -- Growth stage --------------------------------------------------------
    case 'DAYS_SINCE_PLANTING_REQUIRED':
    case 'AWAITING_PLANTING_DATE':
      return 'The planting date has not been entered, so the crop stage cannot be worked out.';
    case 'CROP_NOT_SPECIFIED':
      return 'The scan did not settle on one crop, so there is no crop calendar to place it against.';
    case 'UNSUPPORTED_CROP':
      return 'There is no growth-stage table for this crop in the system.';

    // -- Scan ----------------------------------------------------------------
    case 'GPS_TRACK_NOT_RECORDED':
      return 'No satellite track was recorded during the walk, so the distance covered is not known.';

    default:
      return status ?? 'Not available.';
  }
}

/**
 * The engineering detail some reason codes carry in parentheses.
 *
 * Shown small and last. It is genuinely useful — "`/dev/video1` not found;
 * available: `['/dev/video0']`" is the fix — but it is for whoever is holding
 * the pod, not for the farmer, so it must not be the sentence they read first.
 */
export function statusDetail(status?: string): string | null {
  const m = /^[A-Z0-9_]+ \((.*)\)$/s.exec(status ?? '');
  return m ? m[1] : null;
}

// ---- Source tag -----------------------------------------------------------

/**
 * Rule 4 made visible. A derived quantity must not be able to pass itself off
 * as an observation, so the distinction sits on the face of every value.
 *
 * `derived_fao56` is spelled out rather than shortened: a farmer reading
 * "DERIVED FAO56" beside a water figure learns it came from a standard table
 * and a formula, which is exactly the claim the block is making.
 */
export function SourceTag({ source }: { source: SourceKind }) {
  const tone: Tone =
    source === 'measured' ? 'good' : source === 'provisional' ? 'warn' : 'neutral';
  return <StatusChip label={String(source).replace(/_/g, ' ').toUpperCase()} tone={tone} />;
}

// ---- Verification ---------------------------------------------------------

/**
 * The citation-provenance badge that TEMPLATE_ID_REGISTRY §1.2 makes mandatory.
 *
 * Renders from the structural `verification_status` enum by way of
 * `presentVerification`, never by pattern-matching the prose — which is the
 * whole reason the edge carries the status twice. A `RECALLED_UNVERIFIED` dose
 * gets the destructive tone and a full-width note, not a quiet grey chip, and
 * the note cannot be collapsed: `mandatory` is decided in the schema layer and
 * this component has no prop to override it.
 */
export function VerificationBadge({
  status,
  language = 'en',
  /** Set false on a dense list where the full note would repeat every row. */
  showNote = true,
}: {
  status: VerificationStatus;
  language?: Language;
  showNote?: boolean;
}) {
  const p = presentVerification(status, language);
  const tone = p.tone as Tone;
  return (
    <View style={{ marginTop: space.sm }}>
      <StatusChip label={p.badge} tone={tone} />
      {showNote || p.mandatory ? (
        <View style={{ marginTop: -space.sm }}>
          <Panel label={p.mandatory ? 'Read this first' : 'Where this comes from'} tone={tone}>
            {p.note}
          </Panel>
        </View>
      ) : null}
    </View>
  );
}

// ---- Rows and text --------------------------------------------------------

export function Row({ children }: { children: ReactNode }) {
  return <View style={s.row}>{children}</View>;
}

export function Divider() {
  return <View style={s.divider} />;
}

export function Muted({ children }: { children: ReactNode }) {
  return <Text style={[type.small, { color: color.mutedForeground }]}>{children}</Text>;
}

export function Body({ children }: { children: ReactNode }) {
  return <Text style={[type.body, { color: color.foreground }]}>{children}</Text>;
}

/** Horizontally wrapping chip strip, as at the foot of the alert card. */
export function ChipRow({ children }: { children: ReactNode }) {
  return <View style={s.chipRow}>{children}</View>;
}

const s = StyleSheet.create({
  eyebrow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    alignSelf: 'flex-start',
    height: 29,
    paddingHorizontal: 11,
    borderWidth: 1,
    borderRadius: radius.md,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },

  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 30,
    paddingHorizontal: 11,
    borderWidth: 1,
    borderRadius: radius.md,
  },
  statusChip: {
    alignSelf: 'flex-start',
    height: 22,
    justifyContent: 'center',
    paddingHorizontal: 8,
    borderWidth: 1,
    borderRadius: radius.sm,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },

  card: {
    backgroundColor: color.card,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: color.border,
    padding: space.lg,
    marginBottom: space.md,
    ...shadow.card,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: space.md,
    gap: space.sm,
  },

  panel: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: 11,
    marginTop: space.sm,
  },

  stat: { flex: 1, borderWidth: 1, borderRadius: radius.xl, padding: space.lg },

  confRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: space.md },
  confTrack: {
    flex: 1,
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: color.border,
    overflow: 'hidden',
  },
  confFill: { height: 6, borderRadius: radius.pill, backgroundColor: color.primary },

  measurement: { marginBottom: space.md },
  measurementHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
    gap: space.sm,
  },
  valueRow: { flexDirection: 'row', alignItems: 'baseline' },

  notMeasured: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: 10,
  },
  notMeasuredHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 7,
    gap: space.sm,
  },
  divider: { height: 1, backgroundColor: color.border, marginVertical: space.sm },
});
