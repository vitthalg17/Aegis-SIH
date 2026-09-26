/**
 * The classifier's findings, and where in the field they happened.
 *
 * ── The thing this file exists to prevent ───────────────────────────────────
 * The device capture the hardware team sent carries
 * `rice__bacterial_leaf_blight` at **0.9817** confidence with
 * `cross_source_reliability: TESTED_FAILED`. On held-out camera rigs that class
 * recovers **0.00%** of its cases. Those two numbers are both true and they are
 * about different things: confidence is the model's certainty in its own
 * answer, and reliability is whether that certainty has ever been worth
 * anything on a camera it did not train against.
 *
 * A screen that renders "98% — bacterial leaf blight" has told a farmer
 * something almost certainly wrong, in the most persuasive form available, and
 * may well get a field sprayed with streptocycline for nothing.
 *
 * So on this card the tier leads and the confidence follows, with the held-out
 * recall printed beside it wherever the registry gives one. That is not
 * hedging — it is the actual state of the evidence, and it is the difference
 * between a demo and a system.
 *
 * ── Why the map is a plot and not a basemap ─────────────────────────────────
 * The pod tags each detection with a handheld GPS fix at roughly 2.5 m CEP, no
 * RTK. That locates a corner of a field, not a plant. Drawing those points over
 * a street map or a satellite tile would imply a precision the receiver does
 * not have, and zooming in far enough to see individual plants would imply it
 * even harder. There is also no tile provider to call: a map that had to
 * download anything would be the one screen that stopped working in a field, in
 * a system whose entire claim is that it needs no cloud at any point.
 */

import { StyleSheet, Text, View } from 'react-native';

import { Card, Chip, ChipRow, Divider, Muted, Panel, SourceTag, StatusChip } from './components.tsx';
import type { Tone } from './components.tsx';
import { FieldMap, MapLegend, Stat } from './charts.tsx';
import type { MapPoint } from './charts.tsx';
import {
  describeSpread,
  extentMetres,
  pickScaleMetres,
  toMetres,
  toUnitSquare,
} from './field-geometry.ts';
import { color, space, type } from './theme.ts';
import type { Advisory, CrossSourceReliability, Detection } from '../schema/advisory.ts';
import { describeClass } from '../schema/classes.ts';
import {
  CONFIDENCE_CAVEAT,
  MACRO_F1,
  describeReliability,
  needsProminentCaveat,
  recallPercent,
} from '../schema/reliability.ts';

type Located = Detection & { lat: number; lon: number };

const isLocated = (d: Detection): d is Located =>
  typeof d.lat === 'number' && typeof d.lon === 'number';

const TIER_TONE: Record<string, Tone> = {
  TESTED_ROBUST: 'good',
  TESTED_WEAK: 'warn',
  TESTED_FAILED: 'bad',
  UNTESTED: 'unknown',
};

/** The reliability chip and, when it matters, its full panel. */
function Reliability({
  tier,
  className,
  confidence,
}: {
  tier: CrossSourceReliability;
  className: string;
  confidence: number;
}) {
  const info = describeReliability(tier);
  const tone = TIER_TONE[String(tier)] ?? 'bad';
  const recall = recallPercent(className);
  const prominent = needsProminentCaveat(tier, confidence);

  return (
    <View style={{ marginTop: space.sm }}>
      <StatusChip label={info.label} tone={tone} />
      {prominent ? (
        <View style={{ marginTop: -space.sm }}>
          <Panel label="How much to trust this" tone={tone}>
            {info.body}
            {recall
              ? ` On the independent test set this class was recognised correctly ${recall} of the time.`
              : ''}
          </Panel>
        </View>
      ) : null}
    </View>
  );
}

/**
 * Findings across the whole scan.
 *
 * `disease[]` in contract v1.0 is thin — class, confidence, empty media list —
 * so the per-class evidence a reader needs comes from joining it against
 * `detections[]`, which is where the reliability tier and the repeat count
 * actually live. That join happens here rather than being faked with numbers
 * `disease[]` does not carry.
 */
export function DiseaseCard({ advisory }: { advisory: Advisory }) {
  const disease = advisory.disease ?? [];
  const detections = advisory.detections ?? [];

  if (disease.length === 0) {
    return (
      <Card eyebrow="Findings" title="What the camera called">
        <Muted>
          Nothing was flagged in this scan. See the verdict above for what that means — an
          empty list here is not the same as a clean bill of health.
        </Muted>
      </Card>
    );
  }

  // Strongest first. The pod orders these, but not by contract, and the
  // reliability caveats read worst when the order is arbitrary.
  const ordered = [...disease].sort((a, b) => b.confidence - a.confidence);

  return (
    <Card eyebrow="Findings" title="What the camera called">
      {/* One standing caveat for the whole card, above every figure on it. */}
      <Panel label="Before you read the numbers" tone="warn">
        {CONFIDENCE_CAVEAT}
      </Panel>

      {ordered.map((d, i) => {
        const described = describeClass(d.class);
        const hits = detections.filter((x) => x.class === d.class);
        // The tier is a property of the class, so any detection of it carries
        // the same one. Taking the first is not a sample, it is a lookup.
        const tier = hits[0]?.cross_source_reliability;
        const recall = recallPercent(d.class);

        return (
          <View key={`${d.class}-${i}`} style={{ marginTop: space.lg }}>
            {i > 0 ? <Divider /> : null}

            <View style={s.head}>
              <View style={{ flex: 1 }}>
                <Text style={[type.cardTitle, { color: color.foreground }]}>
                  {described.condition}
                </Text>
                <Text style={[type.valueSmall, { color: color.fgSubtle, marginTop: 3 }]}>
                  {described.crop ?? d.class}
                  {i === 0 && ordered.length > 1 ? ' · strongest' : ''}
                </Text>
              </View>
              <SourceTag source={d.source} />
            </View>

            {/* Tier first, deliberately. It is the thing that decides what the
                confidence underneath it is worth. */}
            {tier ? (
              <Reliability tier={tier} className={d.class} confidence={d.confidence} />
            ) : (
              <Panel label="No reliability stated" tone="bad">
                This finding did not say how well its class holds up on cameras the model
                has not seen, so there is no way to judge the figure below.
              </Panel>
            )}

            <View style={s.statRow}>
              <Stat
                value={String(hits.length)}
                caption={hits.length === 1 ? 'Frame it appeared in' : 'Frames it appeared in'}
                tone={hits.length > 2 ? 'bad' : 'neutral'}
              />
              <Stat value={d.confidence.toFixed(2)} caption="Model certainty" />
              <Stat
                value={recall ?? 'untested'}
                caption="Correct on unseen cameras"
                tone={recall ? 'warn' : 'unknown'}
              />
            </View>

            <ChipRow>
              <Chip value="CONFIRM BY EYE" tone="warn" />
              {/* Contract: media_ids is always present and always empty, because
                  the pod prunes images to save storage. Saying so beats a
                  broken thumbnail or a silent absence. */}
              {Array.isArray(d.media_ids) && d.media_ids.length === 0 ? (
                <Chip label="PHOTO" value="NOT KEPT" tone="unknown" />
              ) : null}
            </ChipRow>

            {/* Seen once and never again is the weakest shape this evidence
                takes, and it is worth naming rather than leaving the reader to
                infer it from a count of one. */}
            {hits.length === 1 ? (
              <Text style={[type.small, { color: color.mutedForeground, marginTop: space.sm }]}>
                Seen in a single frame. A real lesion usually shows up in several as you
                walk past it, so this one is worth a second look before acting.
              </Text>
            ) : null}
          </View>
        );
      })}

      <Panel label="How this model was measured" tone="unknown">
        {`Across all classes the model gets about ${Math.round(MACRO_F1.heldOut * 100)}% right on photographs from cameras it never trained on, against about ${Math.round(MACRO_F1.inDistribution * 100)}% on the ones it did. It partly learned which dataset a photo came from rather than what is wrong with the plant. That gap is why every finding here says to confirm by eye.`}
      </Panel>
    </Card>
  );
}

/**
 * The clustering verdict in words a farmer can act on.
 *
 * "Clustered" on its own is a statistic. "Start where they are densest" is the
 * thing to go and do, which is what a map of a field is for.
 */
const SPREAD_COPY: Record<string, (m: number) => string> = {
  Clustered: (m) =>
    `The findings sit close together — about ${m} m apart on average. Start where they are densest.`,
  'Loosely grouped': (m) => `The findings are somewhat grouped, about ${m} m apart on average.`,
  'Spread out': (m) =>
    `The findings are scattered across the area you scanned, roughly ${m} m apart on average, rather than concentrated in one place.`,
};

export function DetectionsCard({ advisory }: { advisory: Advisory }) {
  const detections = advisory.detections ?? [];
  const gps = advisory.gps;
  const located = detections.filter(isLocated);
  const unlocated = detections.length - located.length;

  if (detections.length === 0) {
    return (
      <Card eyebrow="Where" title="Field map">
        <Muted>
          {gps?.status === 'ABSENT'
            ? 'No satellite fix during this scan, and nothing was flagged to place on a map.'
            : 'Nothing was flagged in this scan, so there is nothing to place on a map.'}
        </Muted>
      </Card>
    );
  }

  if (located.length === 0) {
    return (
      <Card eyebrow="Where" title="Field map">
        <Panel label="No positions" tone="unknown">
          {detections.length} detection{detections.length === 1 ? '' : 's'} were made but none
          could be positioned
          {gps?.status === 'ABSENT' ? ' — the pod never got a satellite fix' : ''}. The findings
          are still real; only their locations are missing.
        </Panel>
        <Muted>
          Leaving the pod in open sky for a minute before a scan usually gets a fix. Without
          one, you get the findings but not a map of where they are.
        </Muted>
      </Card>
    );
  }

  // ---- Project to metres, then to the unit square -------------------------
  // The geometry lives in field-geometry.ts and is unit-tested there: a mark in
  // the wrong place still looks like a map, so this is not a thing to eyeball.

  const { metres } = toMetres(located);
  const span = extentMetres(metres);

  const classes = [...new Set(located.map((d) => d.class))];
  // Severity is the job here, not identity — every one of these is something to
  // walk over and look at. Confidence sizes the mark; the count carries the rest.
  const points: MapPoint[] = metres.map((m, i) => ({
    ...toUnitSquare(m, span),
    weight: located[i].confidence,
    tone: 'bad' as const,
  }));

  const scaleM = pickScaleMetres(span);
  const spread = describeSpread(metres, span);
  const best = located.reduce((a, b) => (b.confidence > a.confidence ? b : a));
  // Worst-case tier across everything on this map, so the plot cannot look
  // more authoritative than its least reliable mark.
  const worstTier = located
    .map((d) => describeReliability(d.cross_source_reliability))
    .reduce((a, b) => (b.severity > a.severity ? b : a));

  const fixes = located.filter((d) => typeof d.fix_quality === 'number');
  const dgps = fixes.filter((d) => d.fix_quality === 2).length;
  const worstHdop = located.reduce<number | null>(
    (acc, d) => (typeof d.hdop === 'number' && (acc === null || d.hdop > acc) ? d.hdop : acc),
    null,
  );

  return (
    <Card eyebrow="Where" title="Field map">
      {/* The reading, in words, above the plot. */}
      {spread ? (
        <View style={s.verdictRow}>
          <Text style={[type.cardTitle, { color: color.foreground }]}>{spread.verdict}</Text>
          <Text style={[type.small, { color: color.mutedForeground, marginTop: 4 }]}>
            {SPREAD_COPY[spread.verdict](Math.round(spread.meanSeparationM))}
          </Text>
        </View>
      ) : null}

      <View style={s.plotWrap}>
        <FieldMap points={points} scaleLabel={`${scaleM} m`} scaleFraction={scaleM / span} />
      </View>

      <MapLegend
        items={[
          {
            label: `${describeClass(classes[0]).condition} · larger = more confident`,
            tone: 'bad',
          },
        ]}
      />

      <View style={s.statRow}>
        <Stat value={String(located.length)} caption="Placed on the map" tone="bad" />
        <Stat value={`${Math.round(span)} m`} caption="Across the scanned area" />
        <Stat value={best.confidence.toFixed(2)} caption="Strongest mark" />
      </View>

      {/* A map is persuasive in a way a list is not, so the reliability of what
          is on it travels with it rather than living only on the card above. */}
      <Panel label="How much to trust the marks" tone={TIER_TONE[String(worstTier.tier)] ?? 'bad'}>
        {worstTier.body}
      </Panel>

      <ChipRow>
        {classes.slice(1).map((c) => (
          <Chip key={c} label="ALSO" value={describeClass(c).condition} tone="warn" />
        ))}
        {unlocated > 0 ? <Chip label="NO POSITION" value={String(unlocated)} tone="warn" /> : null}
        {gps?.point_count !== undefined ? (
          <Chip label="GPS FIXES" value={String(gps.point_count)} />
        ) : null}
        {dgps > 0 ? <Chip label="DIFFERENTIAL" value={`${dgps}/${fixes.length}`} tone="good" /> : null}
        {worstHdop !== null ? (
          <Chip
            label="WORST SPREAD"
            value={worstHdop.toFixed(1)}
            tone={worstHdop > 2 ? 'warn' : 'neutral'}
          />
        ) : null}
      </ChipRow>

      {/* The caveat is the point. Without it this plot over-promises. */}
      <Panel label="How precise this is" tone="warn">
        {gps?.accuracy_note ??
          'Point tagging only, roughly 2.5 m. This locates a corner of a field, not a plant.'}{' '}
        Use it to see whether findings cluster in one part of the field, not to walk to an
        exact spot. There is no background map because nothing here is accurate enough to
        sit on one.
      </Panel>

      {unlocated > 0 ? (
        <Panel label="Missing positions" tone="unknown">
          {unlocated} detection{unlocated === 1 ? '' : 's'} could not be positioned and
          {unlocated === 1 ? ' is' : ' are'} not on this plot. The finding is real even where
          the position is not.
        </Panel>
      ) : null}
    </Card>
  );
}

const s = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  verdictRow: { marginBottom: space.md },
  plotWrap: { alignItems: 'center', paddingVertical: space.sm },
  statRow: { flexDirection: 'row', gap: space.md, marginTop: space.lg },
});
