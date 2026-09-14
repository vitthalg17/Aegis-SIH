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
import type { SourceKind } from '../schema/advisory.ts';

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
  const unexplained = !status;
  const t = unexplained ? TONE.bad : TONE.unknown;

  return (
    <View style={[s.notMeasured, { borderColor: t.border, backgroundColor: t.bg }]}>
      <View style={s.notMeasuredHead}>
        <Text style={[type.micro, { color: t.fg }]}>NOT MEASURED</Text>
        {status ? (
          <Text style={[type.micro, { color: t.fg, opacity: 0.75 }]}>{status}</Text>
        ) : null}
      </View>
      <Text style={[type.small, { color: t.fg, marginTop: 6 }]}>
        {unexplained
          ? 'No status given. The advisory does not say why this is missing — treat this record as untrustworthy.'
          : (reason ?? humaniseStatus(status))}
      </Text>
    </View>
  );
}

/** Fallback prose for a status code that arrived without a written reason. */
function humaniseStatus(status?: string): string {
  switch (status) {
    case 'BASELINE_INITIALIZING':
      return 'The non-water-stressed baseline is still being collected.';
    case 'PENDING_HARDWARE_FINALIZATION':
      return 'The sensor for this measurement is not finished yet.';
    case 'INPUT_MISSING':
      return 'The input this is computed from did not arrive.';
    case 'EXCLUDED_RTC_INVALID':
      return 'The source node lost its clock, so these readings were excluded.';
    case 'BALANCE_NOT_SEEDED':
      return 'The running water balance has not been started.';
    case 'INSUFFICIENT_WINDOW':
      return 'The monitoring window is too short to state a rate.';
    default:
      return status ?? 'Not available.';
  }
}

// ---- Source tag -----------------------------------------------------------

/**
 * §7.3 rule 4 made visible. A derived quantity must not be able to pass itself
 * off as an observation, so the distinction sits on the face of every value.
 */
export function SourceTag({ source }: { source: SourceKind }) {
  const tone: Tone = source === 'measured' ? 'good' : source === 'derived' ? 'neutral' : 'warn';
  return <StatusChip label={source.toUpperCase()} tone={tone} />;
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
