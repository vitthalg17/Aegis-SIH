/**
 * One advisory, rendered entirely from the schema.
 *
 * The ordering is deliberate and is the argument this screen makes:
 *
 *   1. what you cannot trust about this record   origin, backend, violations
 *   2. the verdict, in one sentence              crop_health
 *   3. what to do                                actions, then the explanation
 *   4. what it was built from                    inputs and their states
 *   5. the findings and how much they are worth  disease, detections
 *   6. the numbers themselves                    pest, water, vegetation, season
 *   7. how it was collected                      scan
 *
 * Provenance before verdict, verdict before advice, advice before evidence. A
 * farmer should know a finding is from a class that fails on unseen cameras
 * before they read its confidence, not after.
 */

import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getAdvisory, topFinding } from '../../src/db/advisories.ts';
import type { StoredAdvisory } from '../../src/db/advisories.ts';
import {
  ActionsCard,
  BackendBanner,
  CropHealthCard,
  GrowthStageCard,
  InputsCard,
  OriginBanner,
  ScanCard,
  ViolationsCard,
} from '../../src/ui/advisory.tsx';
import { DetectionsCard, DiseaseCard } from '../../src/ui/detections.tsx';
import { PestCard } from '../../src/ui/pest.tsx';
import { VegetationCard } from '../../src/ui/vegetation.tsx';
import { IrrigationCard, NdviCard, ThermalCard } from '../../src/ui/water.tsx';
import { Card, Muted } from '../../src/ui/components.tsx';
import { ExplanationCard } from '../../src/ui/explanation.tsx';
import { missingBlocks } from '../../src/schema/validate.ts';
import { LANGUAGES } from '../../src/llm/prompt.ts';
import type { Language } from '../../src/schema/templates.ts';
import { fieldIdFromAdvisoryId } from '../../src/schema/advisory.ts';
import { useStatusBarStyle } from '../../src/ui/status-bar.ts';
import { color, radius, space, type } from '../../src/ui/theme.ts';

export default function AdvisoryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [stored, setStored] = useState<StoredAdvisory | null | 'loading'>('loading');
  /**
   * The language the *template* actions render in.
   *
   * Deliberately separate from the explanation card's own picker. This one
   * switches deterministic offline text that ships in the app; that one asks a
   * model over the internet. Sharing one control would suggest the two have the
   * same availability, and in a field they emphatically do not.
   */
  const [language, setLanguage] = useState<Language>('en');
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

  /**
   * A record this build cannot walk.
   *
   * Almost always a record stored under an older schema — it was valid when it
   * arrived, and the contract moved underneath it. Contract v1.0 did exactly
   * that: it replaced the old `water` block with `thermal`, `ndvi`,
   * `ndvi_satellite` and `irrigation`, so every record written before it lands
   * here. The renderer reads these blocks without checking, so rather than
   * scatter optional chaining through every card and hope, the screen stops and
   * says what is wrong.
   *
   * This is the only user interface the system has. A white screen tells a
   * farmer nothing; this at least tells them the record is old and their other
   * advisories are fine.
   */
  const missing = missingBlocks(a);
  if (missing.length > 0) {
    return (
      <ScrollView
        style={{ backgroundColor: color.background }}
        contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xl }}
      >
        <OriginBanner origin={stored.origin} />
        <Text style={[type.title, { color: color.foreground }]}>This advisory cannot be shown</Text>
        <Text style={[type.valueSmall, { color: color.mutedForeground, marginBottom: space.lg }]}>
          {a?.advisory_id ?? id}
        </Text>
        <Card eyebrow="Older format" title="What is missing">
          <Muted>
            This record was stored before the app moved to the current advisory format, so
            it does not carry everything the screen now reads. It is kept rather than
            deleted, but it cannot be rendered.
          </Muted>
          <View style={{ marginTop: space.md }}>
            {missing.map((m) => (
              <Text key={m} style={[type.valueSmall, { color: color.destructive, marginBottom: 2 }]}>
                • missing “{m}”
              </Text>
            ))}
          </View>
          <Muted>
            Pull again from the pod, or clear the replica on the pod screen, to replace it.
          </Muted>
        </Card>
        <ViolationsCard violations={stored.violations} />
      </ScrollView>
    );
  }

  const fieldId = fieldIdFromAdvisoryId(a.advisory_id);

  return (
    <ScrollView
      style={{ backgroundColor: color.background }}
      contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xl }}
    >
      {/* Everything that qualifies the record comes before the record. */}
      <OriginBanner origin={stored.origin} />
      <BackendBanner advisory={a} />
      <ViolationsCard violations={stored.violations} />

      <Text style={[type.title, { color: color.foreground }]}>
        {fieldId ? `Field ${fieldId}` : `Scan ${a.seq}`}
      </Text>
      <Text style={[type.valueSmall, { color: color.mutedForeground, marginBottom: space.lg }]}>
        {a.advisory_id}
      </Text>

      {/* The one sentence a farmer came for. */}
      <CropHealthCard health={a.crop_health} topClass={topFinding(a)} />

      {/* The offline language switch. It sits above the actions because it
          changes them, and because a farmer who cannot read the English needs
          to find it before they give up on the screen rather than after. */}
      <LanguageSwitch value={language} onChange={setLanguage} />

      <ActionsCard actions={a.actions} language={language} />

      {/* After the pod's own actions, never instead of them. The template
          advice is what a farmer gets with no connection; this explains it. */}
      <ExplanationCard advisory={a} />

      {/* States of the sensors, above the numbers they qualify. */}
      <InputsCard inputs={a.inputs} thermalReason={a.thermal?.reason} />

      {/* Findings, with their reliability tier ahead of their confidence. */}
      <DiseaseCard advisory={a} />
      <DetectionsCard advisory={a} />

      <PestCard pest={a.pest} />

      <ThermalCard thermal={a.thermal} />
      <IrrigationCard irrigation={a.irrigation} />
      <VegetationCard vegetation={a.vegetation} />
      <NdviCard probe={a.ndvi} satellite={a.ndvi_satellite} />

      <GrowthStageCard stage={a.growth_stage} />

      <ScanCard advisory={a} />
    </ScrollView>
  );
}

/**
 * The offline language switch for the template actions.
 *
 * This is the whole point of the pod shipping `template_id` and `params` rather
 * than only a rendered sentence: the Hindi comes out of a table compiled into
 * the app, deterministically, with no model and no network. In a field with no
 * signal this control still works, and that is the difference between a
 * localised product and a localisable one.
 */
function LanguageSwitch({
  value,
  onChange,
}: {
  value: Language;
  onChange: (l: Language) => void;
}) {
  return (
    <View style={{ marginBottom: space.md }}>
      <Text style={[type.micro, { color: color.fgSubtle, marginBottom: space.sm }]}>
        ADVICE LANGUAGE · WORKS OFFLINE
      </Text>
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        {LANGUAGES.map((l) => {
          const active = l.code === value;
          return (
            <Pressable
              key={l.code}
              onPress={() => onChange(l.code)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={{
                paddingVertical: 6,
                paddingHorizontal: space.md,
                borderRadius: radius.pill,
                borderWidth: 1,
                borderColor: active ? color.primary : color.border,
                backgroundColor: active ? color.secondary : 'transparent',
              }}
            >
              <Text
                style={[
                  type.chipValue,
                  { color: active ? color.secondaryForeground : color.mutedForeground },
                ]}
              >
                {l.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
