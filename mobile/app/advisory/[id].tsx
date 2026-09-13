/**
 * One advisory, rendered entirely from the schema (§14.2 step 3).
 *
 * The ordering is deliberate and is the argument this screen makes: what the
 * advisory was built from comes *before* the numbers it produced. A farmer
 * should know a reading is two days old before they read it, not after.
 */

import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getAdvisory } from '../../src/db/advisories.ts';
import type { StoredAdvisory } from '../../src/db/advisories.ts';
import {
  ActionsCard,
  DiseaseCard,
  InputsCard,
  OriginBanner,
  PestCard,
  VegetationCard,
  ViolationsCard,
  WaterCard,
} from '../../src/ui/advisory.tsx';
import { Card, Muted, Row } from '../../src/ui/components.tsx';
import { ExplanationCard } from '../../src/ui/explanation.tsx';
import { useStatusBarStyle } from '../../src/ui/status-bar.ts';
import { color, space, type } from '../../src/ui/theme.ts';

export default function AdvisoryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [stored, setStored] = useState<StoredAdvisory | null | 'loading'>('loading');
  const insets = useSafeAreaInsets();
  useStatusBarStyle('dark');

  useEffect(() => {
    if (!id) return;
    void getAdvisory(id).then(setStored);
  }, [id]);

  if (stored === 'loading') return null;

  if (!stored) {
    return (
      <View style={{ flex: 1, padding: space.lg, backgroundColor: color.background }}>
        <Muted>No advisory with that id in the local store.</Muted>
      </View>
    );
  }

  const a = stored.advisory;

  return (
    <ScrollView
      style={{ backgroundColor: color.background }}
      contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xl }}
    >
      <OriginBanner origin={stored.origin} />
      <ViolationsCard violations={stored.violations} />

      <Text style={[type.title, { color: color.foreground }]}>Field {a.field_id}</Text>
      <Text style={[type.valueSmall, { color: color.mutedForeground, marginBottom: space.lg }]}>
        {a.advisory_id}
      </Text>

      {/* Inputs first, on purpose. §14.2 step 3 wants ages visible, not buried,
          and reading them before the numbers is what makes them useful. */}
      <InputsCard inputs={a.inputs} />

      <ActionsCard actions={a.actions} />

      {/* After the Jetson's own actions, never instead of them. The measured
          advice is what a farmer gets with no connection; this explains it. */}
      <ExplanationCard advisory={a} />

      <WaterCard water={a.water} />
      <PestCard pest={a.pest} />
      <DiseaseCard disease={a.disease} />
      <VegetationCard vegetation={a.vegetation} />

      <Card title="Flight">
        <Row>
          <Muted>Started</Muted>
          <Text style={[type.valueSmall, { color: color.foreground }]}>
            {new Date(a.flight.started_utc).toLocaleString()}
          </Text>
        </Row>
        <Row>
          <Muted>Survey images</Muted>
          <Text style={[type.valueSmall, { color: color.foreground }]}>
            {a.flight.survey_images}
          </Text>
        </Row>
        <Row>
          <Muted>Inspection images</Muted>
          <Text style={[type.valueSmall, { color: color.foreground }]}>
            {a.flight.inspection_images}
          </Text>
        </Row>
        <Row>
          <Muted>Jetson GPS time</Muted>
          <Text
            style={[
              type.valueSmall,
              { color: a.generated_by.gps_time_valid ? color.foreground : color.destructive },
            ]}
          >
            {a.generated_by.gps_time_valid ? 'valid' : 'NOT VALID'}
          </Text>
        </Row>
      </Card>

      {a.notes.length > 0 ? (
        <Card title="Notes">
          {a.notes.map((n, i) => (
            <Text
              key={i}
              style={[type.small, { color: color.mutedForeground, marginBottom: space.xs }]}
            >
              • {n}
            </Text>
          ))}
        </Card>
      ) : null}
    </ScrollView>
  );
}
