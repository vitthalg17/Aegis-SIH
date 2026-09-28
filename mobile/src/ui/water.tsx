/**
 * The four availability blocks: thermal, the NoIR camera probe, satellite NDVI
 * and FAO-56 irrigation.
 *
 * They share one shape on the wire — `available` plus a `reason` — and one job
 * on screen: say what is missing, say why, and never fill the hole with an
 * estimate. Three of the four are unavailable on the device as it stands, which
 * makes this the card set that proves the system is honest rather than the one
 * that shows off. A screen that renders those absences well is a better
 * demonstration than one showing numbers it should not have.
 *
 * ── The state worth getting right ───────────────────────────────────────────
 * `thermal.available: false` with a populated `tc_c` is not a broken sensor. The
 * MLX90640 is connected and returning a real canopy temperature. What is missing
 * is `configs/thermal_refs.json` — the wet and dry reference pads that give the
 * Jones (1999) ratio its denominator. So the temperature is shown as the
 * measurement it is, and the stress index is shown as unavailable, on the same
 * card, without either contaminating the other.
 */

import { StyleSheet, Text, View } from 'react-native';

import {
  Card,
  Chip,
  ChipRow,
  Divider,
  Measurement,
  Panel,
  Row,
  SourceTag,
  StatusChip,
  TONE,
  humaniseStatus,
  shortStatus,
} from './components.tsx';
import type { TileSpec, Tone } from './components.tsx';
import {
  ArcGauge,
  DropIcon,
  GradientScale,
  ProgressBar,
  SatelliteIcon,
  ThermometerIcon,
} from './tiles.tsx';
import { Meter, Stat } from './charts.tsx';
import { color, space, type } from './theme.ts';
import type { Irrigation, NdviProbe, NdviSatellite, Thermal } from '../schema/advisory.ts';

// ---- Thermal --------------------------------------------------------------

/**
 * Provisional band boundaries — engineering judgement informed by the general
 * literature, not a published threshold for wheat, rice or sugarcane. The card
 * says so wherever it draws them.
 */
const CWSI_BANDS = [
  { upTo: 0.2, label: 'none', tone: 'good' as Tone },
  { upTo: 0.4, label: 'mild', tone: 'neutral' as Tone },
  { upTo: 0.6, label: 'moderate', tone: 'warn' as Tone },
  { upTo: 1.0, label: 'severe', tone: 'bad' as Tone },
];

function cwsiBand(cwsi: number): { label: string; tone: Tone; copy: string } {
  if (cwsi < 0.2) return { label: 'NO STRESS', tone: 'good', copy: 'transpiring freely' };
  if (cwsi < 0.4) return { label: 'MILD', tone: 'neutral', copy: 'early stress, keep watching' };
  if (cwsi < 0.6) return { label: 'MODERATE', tone: 'warn', copy: 'irrigation advisable' };
  return { label: 'SEVERE', tone: 'bad', copy: 'irrigate' };
}

const FLAG_COPY: Record<string, string> = {
  CWSI_BELOW_ZERO:
    'The canopy came out cooler than the wet reference pad, which should not happen. The value is shown exactly as measured rather than being clipped to zero, because a clipped value would hide that something is off with the pads or the shade on them.',
  CWSI_ABOVE_ONE:
    'The canopy came out hotter than the dry reference pad. The value is shown exactly as measured rather than being clipped to one. Either the crop is under severe stress, or the dry pad was shaded.',
};

export function ThermalCard({ thermal }: { thermal: Thermal }) {
  const cwsi = typeof thermal.cwsi === 'number' ? thermal.cwsi : null;
  const band = cwsi !== null ? cwsiBand(cwsi) : null;
  const mock = thermal.thermal_source === 'mock';
  const tc = typeof thermal.tc_c === 'number' ? thermal.tc_c : null;

  // Folded reading: the stress band when there is one, else the leaf
  // temperature with the index's gap named beside it — never the temperature
  // alone, which would read as "no stress".
  const summary = mock
    ? 'Simulated, not a measurement'
    : band
      ? `Stress ${band.label.toLowerCase()} (${cwsi}) · leaf ${tc ?? '?'} °C`
      : tc !== null
        ? `Leaf ${tc.toFixed(1)} °C · stress not measured`
        : shortStatus(thermal.reason);
  const summaryTone: Tone = mock ? 'bad' : band ? band.tone : 'unknown';

  // The tile leads with the stress index when there is one, on its dial. With
  // no index it shows the leaf temperature on a cool-to-hot scale, and says in
  // the caption that stress was not measured, so a mild-looking temperature
  // cannot be read as "no stress".
  const tile: TileSpec = mock
    ? { icon: <ThermometerIcon color={color.destructive} />, label: 'WATER STRESS', value: 'Simulated', muted: true, caption: 'Not a measurement of your crop' }
    : band && cwsi !== null
      ? {
          icon: <ThermometerIcon color={TONE[band.tone].fg} />,
          label: 'WATER STRESS',
          value: cwsi.toFixed(2),
          tone: band.tone,
          visual: <ArcGauge value={cwsi} bands={CWSI_BANDS} width={110} />,
          caption: `${band.label.charAt(0)}${band.label.slice(1).toLowerCase()}${tc !== null ? ` · leaf ${tc.toFixed(1)} °C` : ''}`,
        }
      : tc !== null
        ? {
            icon: <ThermometerIcon color={color.foreground} />,
            label: 'LEAF TEMP',
            value: tc.toFixed(1),
            unit: '°C',
            visual: <GradientScale value={tc} min={10} max={45} kind="temperature" />,
            caption: 'Water stress not measured',
          }
        : {
            icon: <ThermometerIcon color={color.unknown} />,
            label: 'WATER STRESS',
            value: 'Not measured',
            muted: true,
            caption: shortStatus(thermal.reason),
          };

  return (
    <Card
      eyebrow="Water stress"
      title="Water stress"
      right={mock ? <StatusChip label="SIMULATED" tone="bad" /> : undefined}
      summary={summary}
      summaryTone={summaryTone}
      tile={tile}
    >
      {mock ? (
        <Panel label="Simulated sensor" tone="bad">
          These thermal figures came from a simulator, not from the camera. Nothing on this
          card is a measurement of your crop.
        </Panel>
      ) : null}

      {/* The direct measurement first. It exists whenever a valid frame was
          captured, independently of whether the stress index could be formed. */}
      <Measurement
        label="Canopy temperature"
        value={typeof thermal.tc_c === 'number' ? thermal.tc_c : null}
        unit="°C"
        status={typeof thermal.tc_c === 'number' ? undefined : (thermal.reason ?? undefined)}
        source="measured"
        note={
          typeof thermal.tc_c === 'number'
            ? 'Read straight off the thermal camera: the middle temperature of the leaf surface it was pointed at.'
            : undefined
        }
      />

      <Divider />

      {cwsi === null ? (
        // `humaniseStatus` already explains the common case — reference pads
        // not set up, temperature still real — in the panel's own words.
        <Measurement
          label="Water stress index"
          value={null}
          status={thermal.reason ?? 'UNAVAILABLE'}
        />
      ) : (
        <>
          <View style={s.head}>
            <View style={{ flex: 1 }}>
              <Text style={[type.chipLabel, { color: color.fgSubtle }]}>WATER STRESS INDEX</Text>
              <Text style={[type.stat, { color: color.foreground, marginTop: 4 }]}>{cwsi}</Text>
            </View>
            {band ? <StatusChip label={band.label} tone={band.tone} /> : null}
          </View>

          <Meter
            value={Math.max(0, Math.min(1, cwsi))}
            min={0}
            max={1}
            tone={band?.tone ?? 'neutral'}
            bands={CWSI_BANDS}
            markerLabel={band?.copy}
            caption="0 means the crop is transpiring freely. 1 means it has stopped."
          />

          {thermal.flag && thermal.flag !== 'NORMAL' ? (
            <Panel label="Outside the expected range" tone="warn">
              {FLAG_COPY[thermal.flag] ?? String(thermal.flag).replace(/_/g, ' ').toLowerCase()}
            </Panel>
          ) : null}

          <Panel label="Bands · provisional" tone="warn">
            The measurement is real; where the boundaries between none, mild, moderate and
            severe sit is our own engineering judgement, informed by the general literature
            but not a published threshold for wheat, rice or sugarcane.
          </Panel>

          <ChipRow>
            {typeof thermal.twet_c === 'number' ? (
              <Chip label="WET PAD" value={`${thermal.twet_c} °C`} />
            ) : null}
            {typeof thermal.tdry_c === 'number' ? (
              <Chip label="DRY PAD" value={`${thermal.tdry_c} °C`} />
            ) : null}
          </ChipRow>
        </>
      )}

      {thermal.frame_utc ? (
        <Text style={[type.valueSmall, { color: color.fgSubtle, marginTop: space.sm }]}>
          {`Thermal frame taken ${new Date(thermal.frame_utc).toLocaleString()}`}
        </Text>
      ) : null}
    </Card>
  );
}

// ---- NDVI: the camera probe and the satellite fallback --------------------

/**
 * The two NDVI paths, on one card, because a farmer asking "how green is my
 * field from above" does not care which instrument answers.
 *
 * They are kept visually distinct because they are wildly different
 * measurements: the pod's infrared camera would see individual leaves, and a
 * Sentinel-2 pixel is ten metres across and possibly days old. Merging them
 * into one figure would be the most flattering thing this screen could do and
 * the least honest.
 */
export function NdviCard({
  probe,
  satellite,
}: {
  probe: NdviProbe;
  satellite: NdviSatellite;
}) {
  const sat = satellite ?? { available: false };
  const smallField = Boolean(sat.reliability_note);

  const summary = sat.available
    ? `Satellite ${typeof sat.ndvi_mean === 'number' ? sat.ndvi_mean.toFixed(2) : 'n/a'}${
        typeof sat.age_days === 'number' ? ` · ${Math.round(sat.age_days)} days old` : ''
      }${smallField ? ' · rough' : ''}`
    : probe?.available
      ? 'Infrared camera connected · no satellite image'
      : `Not available: ${shortStatus(probe?.reason).toLowerCase()}`;

  const tile: TileSpec =
    sat.available && typeof sat.ndvi_mean === 'number'
      ? {
          icon: <SatelliteIcon color={smallField ? color.warningForeground : color.foreground} />,
          label: 'SATELLITE',
          value: sat.ndvi_mean.toFixed(2),
          tone: smallField ? 'warn' : 'neutral',
          visual: <GradientScale value={sat.ndvi_mean} min={0} max={0.9} kind="green" />,
          caption: `Greenness from space${typeof sat.age_days === 'number' ? ` · ${Math.round(sat.age_days)} days old` : ''}${smallField ? ' · rough' : ''}`,
        }
      : {
          icon: <SatelliteIcon color={color.unknown} />,
          label: 'SATELLITE',
          value: 'No image',
          muted: true,
          caption: sat.available ? 'Image had no usable pixels' : shortStatus(sat.reason),
        };

  return (
    <Card
      eyebrow="From above"
      title="Infrared & satellite"
      summary={summary}
      summaryTone={sat.available ? (smallField ? 'warn' : 'neutral') : 'unknown'}
      tile={tile}
    >
      {/* The on-pod camera. */}
      <Text style={[type.chipLabel, { color: color.fgSubtle }]}>POD INFRARED CAMERA</Text>
      {probe?.available ? (
        <Panel label="Connected" tone="good">
          The infrared camera is attached and responding.
        </Panel>
      ) : (
        <Panel label="Not available" tone="unknown">
          {humaniseStatus(probe?.reason ?? undefined)}
        </Panel>
      )}

      <Divider />

      {/* The satellite fallback. */}
      <Text style={[type.chipLabel, { color: color.fgSubtle }]}>SATELLITE</Text>

      {!sat.available ? (
        <Panel label="No satellite reading" tone="unknown">
          {humaniseStatus(sat.reason ?? undefined)}
          {' '}Satellite images have to be downloaded while the pod has internet; it cannot
          fetch one from the field.
        </Panel>
      ) : (
        <>
          <View style={s.statRow}>
            <Stat
              value={typeof sat.ndvi_mean === 'number' ? sat.ndvi_mean.toFixed(3) : 'n/a'}
              caption="Average greenness"
              tone={
                typeof sat.ndvi_mean === 'number' && sat.ndvi_mean < 0.3 ? 'warn' : 'good'
              }
            />
            <Stat
              value={typeof sat.age_days === 'number' ? `${Math.round(sat.age_days)} d` : 'n/a'}
              caption="Image age"
              tone={typeof sat.age_days === 'number' && sat.age_days > 7 ? 'warn' : 'neutral'}
            />
            <Stat
              value={typeof sat.valid_pixel_count === 'number' ? String(sat.valid_pixel_count) : 'n/a'}
              caption="Clear pixels used"
              tone={smallField ? 'warn' : 'neutral'}
            />
          </View>

          {/* Ten metres per pixel. On a smallholding that is a handful of
              pixels covering the whole plot, and the edges of every one of them
              include the path, the bund and the neighbour's field. */}
          {smallField ? (
            <Panel label="Too few pixels to trust" tone="warn">
              {`Each satellite pixel covers ten metres of ground. This field is small enough that only ${sat.valid_pixel_count ?? 'a few'} of them fell inside it, and each one also picks up the paths and edges around the crop. Read this as a rough impression of the area, not as a measurement of your field.`}
            </Panel>
          ) : null}

          {typeof sat.cloud_masked_fraction === 'number' && sat.cloud_masked_fraction > 0.15 ? (
            <Panel label="Partly under cloud" tone="warn">
              {`About ${Math.round(sat.cloud_masked_fraction * 100)}% of the scene was covered by cloud or its shadow and was thrown out. What is left is a reading of the clear part only.`}
            </Panel>
          ) : null}

          <ChipRow>
            {sat.scene_date ? <Chip label="TAKEN" value={sat.scene_date} /> : null}
            {typeof sat.pixel_size_m === 'number' ? (
              <Chip label="PIXEL" value={`${sat.pixel_size_m} m`} />
            ) : null}
            {typeof sat.ndvi_std === 'number' ? (
              <Chip label="SPREAD" value={sat.ndvi_std.toFixed(3)} />
            ) : null}
            {sat.source ? <Chip label="SOURCE" value={sat.source} /> : null}
          </ChipRow>
        </>
      )}
    </Card>
  );
}

// ---- Irrigation -----------------------------------------------------------

/**
 * Crop water requirement, FAO-56 Hargreaves-Samani.
 *
 * Every figure here traces back to the ground mast's temperature history, so
 * with the mast absent the whole block is two keys and a reason — which is what
 * the device emits today. That is rendered as the absence it is.
 *
 * When it *is* available, the number that matters to a farmer is `crop_et_mm_day`
 * — how much water the crop will use tomorrow. ET0 and Ra are the working, and
 * they are shown underneath as working rather than as findings.
 */
export function IrrigationCard({ irrigation }: { irrigation: Irrigation }) {
  const ir = irrigation ?? { available: false };

  if (!ir.available) {
    return (
      <Card
        eyebrow="Water"
        title="Water the crop will use"
        summary={`Not worked out: ${shortStatus(ir.reason).toLowerCase()}`}
        summaryTone="unknown"
        tile={{
          icon: <DropIcon color={color.unknown} />,
          label: 'WATER USE',
          value: 'Not worked out',
          muted: true,
          caption: shortStatus(ir.reason),
        }}
      >
        {/* The raw reason string ("need >=6 readings spanning >=6h …") used to
            be printed under this panel as well. It is the developer's copy of
            the same sentence; the humanised one says what matters. */}
        <Panel label="Not worked out" tone="unknown">
          {humaniseStatus(ir.reason ?? undefined)}
        </Panel>
        <Text style={[type.small, { color: color.mutedForeground, marginTop: space.sm }]}>
          This is worked out from air temperatures recorded by the field station in your
          plot. Nothing was estimated in its place.
        </Text>
      </Card>
    );
  }

  const etc = typeof ir.crop_et_mm_day === 'number' ? ir.crop_et_mm_day : null;

  return (
    <Card
      eyebrow="Water"
      title="Water the crop will use"
      right={ir.source ? <SourceTag source={ir.source} /> : undefined}
      summary={etc !== null ? `${etc} mm per day` : 'Not worked out'}
      summaryTone={etc !== null ? 'neutral' : 'unknown'}
      tile={
        etc !== null
          ? {
              icon: <DropIcon color="#1E6FB8" />,
              label: 'WATER USE',
              value: String(etc),
              unit: 'mm/day',
              // Against 10 mm/day, near the top of what a field crop draws.
              visual: <ProgressBar fraction={etc / 10} tone="neutral" fill="#1E6FB8" track="#D6E6F5" />,
              caption: ir.soil1_v == null && ir.soil2_v == null
                ? 'Expected use. Soil moisture not measured'
                : 'Expected use today',
            }
          : { icon: <DropIcon color={color.unknown} />, label: 'WATER USE', value: 'Not worked out', muted: true }
      }
    >
      {etc !== null ? (
        <View style={s.heroRow}>
          <Text style={[type.hero, { color: color.primary }]}>{etc}</Text>
          <View style={{ flex: 1, paddingBottom: 6 }}>
            <Text style={[type.label, { color: color.foreground }]}>mm of water per day</Text>
            <Text style={[type.small, { color: color.mutedForeground, marginTop: 2 }]}>
              What a crop at this stage is expected to draw in a day like today.
            </Text>
          </View>
        </View>
      ) : (
        <Measurement label="Crop water use" value={null} status="NOT_COMPUTED" />
      )}

      <View style={s.statRow}>
        {typeof ir.et0_mm_day === 'number' ? (
          <Stat value={String(ir.et0_mm_day)} caption="Open-water rate (mm/day)" />
        ) : null}
        {typeof ir.kc === 'number' ? (
          <Stat value={String(ir.kc)} caption="Crop factor for this stage" />
        ) : null}
        {typeof ir.air_temp_c === 'number' ? (
          <Stat value={`${ir.air_temp_c}°`} caption="Air temperature" />
        ) : null}
      </View>

      <Divider />

      {typeof ir.t_min_24h_c === 'number' && typeof ir.t_max_24h_c === 'number' ? (
        <Row>
          <Text style={[type.small, { color: color.mutedForeground }]}>Last 24 hours</Text>
          <Text style={[type.valueSmall, { color: color.foreground }]}>
            {`${ir.t_min_24h_c}° to ${ir.t_max_24h_c}°`}
          </Text>
        </Row>
      ) : null}
      {typeof ir.rh_pct === 'number' ? (
        <Row>
          <Text style={[type.small, { color: color.mutedForeground }]}>Humidity</Text>
          <Text style={[type.valueSmall, { color: color.foreground }]}>{`${ir.rh_pct}%`}</Text>
        </Row>
      ) : null}
      {typeof ir.samples_24h === 'number' ? (
        <Row>
          <Text style={[type.small, { color: color.mutedForeground }]}>Readings used</Text>
          <Text style={[type.valueSmall, { color: color.foreground }]}>{ir.samples_24h}</Text>
        </Row>
      ) : null}

      {/* Which latitude the sun-angle term used. GPS means the pod's own fix;
          CONFIG_LATITUDE means whatever was typed into the pod's config, which
          may be a different district entirely. */}
      {ir.ra_source ? (
        <Panel
          label="Position used for the sun calculation"
          tone={ir.ra_source === 'GPS' ? 'neutral' : 'warn'}
        >
          {ir.ra_source === 'GPS'
            ? `Taken from the pod's own satellite fix${typeof ir.ra_latitude_deg === 'number' ? ` at ${ir.ra_latitude_deg}° north` : ''}.`
            : `The pod had no satellite fix, so it used the latitude set in its configuration${typeof ir.ra_latitude_deg === 'number' ? ` (${ir.ra_latitude_deg}°)` : ''}. If that was set for a different place, this figure is off.`}
        </Panel>
      ) : null}

      {/* The soil probes are on the mast and are frequently unattached. Their
          absence is stated rather than left as a gap in the row list. */}
      {ir.soil1_v == null && ir.soil2_v == null ? (
        <Panel label="Soil moisture not included" tone="unknown">
          No soil probe reading came through, so this figure is what the crop is expected
          to use rather than what is left in the ground for it. Check the soil by hand
          before irrigating on this number alone.
        </Panel>
      ) : (
        <ChipRow>
          {typeof ir.soil1_v === 'number' ? <Chip label="SOIL 1" value={`${ir.soil1_v} V`} /> : null}
          {typeof ir.soil2_v === 'number' ? <Chip label="SOIL 2" value={`${ir.soil2_v} V`} /> : null}
          {typeof ir.battery_v === 'number' ? (
            <Chip
              label="STATION BATTERY"
              value={`${ir.battery_v} V`}
              tone={ir.battery_v < 3.0 ? 'warn' : 'neutral'}
            />
          ) : null}
        </ChipRow>
      )}

      <Text style={[type.valueSmall, { color: color.fgSubtle, marginTop: space.sm }]}>
        {ir.method === 'fao56_hargreaves_samani'
          ? 'FAO-56 Hargreaves-Samani (Allen et al. 1998, Eq. 52)'
          : String(ir.method ?? '')}
      </Text>
    </Card>
  );
}

const s = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  statRow: { flexDirection: 'row', gap: space.md, marginTop: space.lg },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.md,
    marginBottom: space.sm,
  },
});
