/**
 * The vegetation block — canopy cover, the four uncalibrated RGB indices, and
 * the NDVI value that is reserved rather than estimated.
 *
 * ── The mandatory caveat ────────────────────────────────────────────────────
 * VEGETATION_BLOCK_SPEC §1.2 is explicit and this file is the place it lands:
 *
 *   "The app MUST render the following caveat whenever relative vegetation
 *    bands are shown: 'Compares parts of your field against each other. It
 *    cannot tell you whether the whole field is healthy.'
 *    Do not conceal this in a hidden tooltip."
 *
 * So the caveat is a panel at the top of the card, above every band, in the
 * same type as the rest of the card. It is not a tooltip, not a disclosure, not
 * an asterisk, and it is rendered from the exported `VEGETATION_CAVEAT`
 * constant so a well-meaning edit cannot paraphrase away its second sentence —
 * which is the load-bearing half. A uniformly stressed field has a perfectly
 * normal internal distribution and looks entirely healthy here.
 *
 * ── Why relative at all ─────────────────────────────────────────────────────
 * There are no published, crop-specific absolute bands for uncalibrated RGB
 * indices. Their absolute value moves with the illumination spectrum, the
 * camera's white balance and gain, the sun angle and how much soil is in frame
 * — the same healthy canopy at 09:00 and at 14:00 gives materially different
 * VARI. Comparing the field against itself, in one session under one light,
 * cancels every one of those confounds. That is a real measurement of a real
 * thing; it is just a narrower thing than a reader assumes by default.
 */

import { StyleSheet, Text, View } from 'react-native';

import { Card, Divider, Measurement, Panel, StatusChip, humaniseStatus } from './components.tsx';
import type { Tone } from './components.tsx';
import { DistributionStrip, Meter } from './charts.tsx';
import { color, space, type } from './theme.ts';
import type { CanopyCover, Vegetation, VegetationIndex } from '../schema/advisory.ts';
import { VEGETATION_CAVEAT } from '../schema/advisory.ts';

const BAND_TONE: Record<string, Tone> = {
  LOWER_TAIL: 'warn',
  BELOW_TYPICAL: 'warn',
  TYPICAL: 'neutral',
  ABOVE_TYPICAL: 'good',
};

/** The display strings VEGETATION_BLOCK_SPEC §4 prescribes, in both languages. */
const BAND_LABEL: Record<string, string> = {
  LOWER_TAIL: 'Noticeably below field average',
  BELOW_TYPICAL: 'Slightly below field average',
  TYPICAL: 'Typical for this field',
  ABOVE_TYPICAL: 'Above field average',
};

const BAND_COPY: Record<string, string> = {
  LOWER_TAIL:
    'Noticeably less green than the rest of your field. Worth walking over to inspect.',
  BELOW_TYPICAL: 'Slightly below typical field vigour.',
  TYPICAL: 'In line with the rest of the field.',
  ABOVE_TYPICAL: 'Among the greener, denser parts of the field.',
};

/**
 * What each index is, in one line.
 *
 * Four acronyms in a column tell a farmer nothing. These do not explain the
 * arithmetic — they say what each one is sensitive to, which is what makes a
 * disagreement between them readable.
 */
const INDEX_BLURB: Record<string, string> = {
  VARI: 'Overall greenness, with some of the haze and lighting taken out.',
  ExG: 'How strongly green wins over red and blue. Sensitive to how much leaf is in frame.',
  TGI: 'Leans on the chlorophyll signal, so it tracks leaf colour more than leaf quantity.',
  DGCI: 'How deep the green is, rather than how much of it there is.',
};

function IndexRow({
  label,
  index,
  /** Only VARI carries a band today; the rest are shown as bare means. */
  showBand = true,
}: {
  label: string;
  index: VegetationIndex;
  showBand?: boolean;
}) {
  const band = showBand ? index.band : null;
  const tone: Tone = band ? (BAND_TONE[band] ?? 'neutral') : 'neutral';
  const hasSpread = typeof index.p10 === 'number' && typeof index.p90 === 'number';

  return (
    <View style={{ marginBottom: space.lg }}>
      <View style={s.head}>
        <Text style={[type.chipLabel, { color: color.fgSubtle, flex: 1 }]}>
          {label.toUpperCase()}
        </Text>
        {band ? <StatusChip label={BAND_LABEL[band] ?? band.replace(/_/g, ' ')} tone={tone} /> : null}
      </View>

      <Text style={[type.small, { color: color.mutedForeground, marginTop: 2 }]}>
        {INDEX_BLURB[label] ?? ''}
      </Text>

      {index.mean === null ? (
        <Panel label="Withheld" tone="unknown">
          {humaniseStatus(index.reason ?? undefined)}
          {typeof index.out_of_domain_fraction === 'number' && typeof index.threshold === 'number'
            ? ` ${Math.round(index.out_of_domain_fraction * 100)}% of the canopy pixels were outside, against a limit of ${Math.round(index.threshold * 100)}%.`
            : ''}
        </Panel>
      ) : (
        <>
          <View style={s.indexRow}>
            <Text style={[type.value, { color: color.foreground }]}>{index.mean}</Text>
            {band ? (
              <Text
                style={[type.small, { color: color.mutedForeground, flex: 1, textAlign: 'right' }]}
              >
                {BAND_COPY[band] ?? ''}
              </Text>
            ) : null}
          </View>

          {/* Where this sits inside the field's own spread — which is the only
              comparison these indices support. A bare number cannot show it. */}
          {hasSpread ? (
            <DistributionStrip
              value={index.mean}
              p10={index.p10 as number}
              p50={index.p50 ?? undefined}
              p90={index.p90 as number}
              tone={tone}
            />
          ) : null}
        </>
      )}
    </View>
  );
}

/**
 * How much of the frame was crop at all.
 *
 * This gates everything below it, so it is rendered first and with its own
 * threshold read out of the payload. The contract's table says 0.10 and the
 * block spec says 0.15; the device sends 0.15. Neither number is hardcoded
 * here — a renderer that assumed one would quietly mislabel the other.
 */
function CanopyRow({ canopy }: { canopy: CanopyCover }) {
  const low = canopy.status === 'INSUFFICIENT_CANOPY';
  const floor = canopy.min_fraction_threshold;
  return (
    <View style={{ marginBottom: space.lg }}>
      <View style={s.head}>
        <Text style={[type.chipLabel, { color: color.fgSubtle, flex: 1 }]}>GROUND COVERED</Text>
        <StatusChip
          label={low ? 'TOO LITTLE CROP' : 'ENOUGH TO MEASURE'}
          tone={low ? 'warn' : 'good'}
        />
      </View>

      <Meter
        value={canopy.mean}
        min={0}
        max={1}
        tone={low ? 'warn' : 'good'}
        bands={[
          { upTo: floor, label: 'too little', tone: 'warn' },
          { upTo: 1, label: 'measurable', tone: 'good' },
        ]}
        markerLabel={`${Math.round(canopy.mean * 100)}% covered`}
        caption={`The indices below need at least ${Math.round(floor * 100)}% of the frame to be canopy. Under that, soil colour dominates and the reading describes the ground instead of the crop.`}
      />

      {low ? (
        <Panel label="Indices withheld" tone="warn">
          {`Canopy cover too low to measure vegetation indices (under ${Math.round(floor * 100)}%). Nothing was computed in their place — a number here would be about the soil, not the crop.`}
        </Panel>
      ) : null}

      {typeof canopy.p10 === 'number' && typeof canopy.p90 === 'number' ? (
        <Text style={[type.valueSmall, { color: color.fgSubtle, marginTop: space.sm }]}>
          {`Across the scan: ${Math.round(canopy.p10 * 100)}% at the thinnest, ${Math.round(canopy.p90 * 100)}% at the densest.`}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * The vegetation card.
 *
 * Order is deliberate: the caveat, then the gate, then the indices, then the
 * gated NDVI. A reader who stops after the first panel has still been told the
 * one thing they most need to know about everything underneath it.
 */
export function VegetationCard({ vegetation }: { vegetation: Vegetation }) {
  const relative = vegetation.interpretation_mode === 'relative';
  const canopy = vegetation.canopy_cover;
  const provisional = [canopy, vegetation.vari, vegetation.exg, vegetation.tgi, vegetation.dgci]
    .some((b) => b && b.threshold_confirmed === false);

  return (
    <Card eyebrow="Vegetation" title="How green, compared to itself">
      {/* VEGETATION_BLOCK_SPEC §1.2, verbatim, on the screen, first. */}
      {relative ? (
        <Panel label="How to read this" tone="warn">
          {VEGETATION_CAVEAT} A field that is evenly stressed still looks perfectly normal
          here.
        </Panel>
      ) : null}

      <View style={{ marginTop: space.md }}>
        {canopy ? <CanopyRow canopy={canopy} /> : null}

        <Divider />

        {/* VARI is the one the pod bands, because it is the one the relative
            percentile machinery runs on. The other three are reported as means
            with no band, and showing an invented band for them would be
            manufacturing a comparison the pod did not make. */}
        <IndexRow label="VARI" index={vegetation.vari} />
        <IndexRow label="ExG" index={vegetation.exg} showBand={false} />
        <IndexRow label="TGI" index={vegetation.tgi} showBand={false} />
        <IndexRow label="DGCI" index={vegetation.dgci} showBand={false} />
      </View>

      {/* Rule 2. Every one of these thresholds is engineering judgement on an
          uncalibrated camera, and none has been confirmed against a published
          source. Rendering them like cited figures would be citation drift
          happening in the presentation layer. */}
      {provisional ? (
        <Panel label="Thresholds · provisional" tone="warn">
          None of the cut-offs on this card has been confirmed against a published source.
          They are our own working values for an uncalibrated camera. The measurements are
          real; where the lines sit between them is not yet settled.
        </Panel>
      ) : null}

      <Divider />

      {/* Carried as a first-class field from day one so nothing downstream
          changes when the optics land. It shows as reserved, never as
          estimated — and this is the *value*, not the camera probe, which is a
          different block on a different card. */}
      <Measurement
        label="NDVI (infrared)"
        value={vegetation.ndvi}
        status={vegetation.ndvi_status}
        reason={vegetation.ndvi_reason ?? undefined}
        note="NDVI needs a second camera that sees infrared. Until that camera and its bench calibration are finished, this is left empty rather than guessed at from the colour image."
      />
    </Card>
  );
}

const s = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  indexRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: space.sm,
    marginTop: space.sm,
  },
});
