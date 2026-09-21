/**
 * The history list.
 *
 * This screen renders the full history with no pod present. Everything shown
 * comes from the local replica; nothing here touches the network, and a farmer
 * who never syncs again still sees every advisory the phone has received.
 *
 * Each row leads with the verdict rather than the field id, because "looks
 * healthy" and "something was found" are what someone is scanning the list for.
 *
 * The header band is the site's inverted "deep" section, carrying the same
 * wordmark drawing, so opening the app lands on the same note as the site.
 */

import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Link, useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { listAdvisories } from '../src/db/advisories.ts';
import type { AdvisorySummary } from '../src/db/advisories.ts';
import { DRIED_LEAF_CLASS, describeClass } from '../src/schema/classes.ts';
import { recallPercent } from '../src/schema/reliability.ts';
import { describeAge, useSync } from '../src/sync/state.ts';
import { AegisMark, AegisWordmark } from '../src/ui/brand.tsx';
import { Stat } from '../src/ui/charts.tsx';
import { Chip, ChipRow, Eyebrow, Muted, StatusChip } from '../src/ui/components.tsx';
import type { Tone } from '../src/ui/components.tsx';
import { useStatusBarStyle } from '../src/ui/status-bar.ts';
import { color, radius, shadow, space, type } from '../src/ui/theme.ts';

const CONNECTION = {
  never_synced: {
    label: 'NEVER SYNCED',
    tone: 'unknown' as const,
    note: 'Nothing has been pulled from a pod on this phone.',
  },
  idle: { label: 'SYNCED', tone: 'good' as const, note: null },
  syncing: { label: 'SYNCING', tone: 'neutral' as const, note: 'Pulling from the pod.' },
  failed: {
    label: 'SYNC FAILED',
    tone: 'bad' as const,
    note: 'Last attempt did not complete. Tap for the reason.',
  },
};

/** The one-line verdict for a row. Never "healthy" for a dried-leaf call. */
function rowVerdict(row: AdvisorySummary): { text: string; tone: Tone } {
  if (row.topClass === DRIED_LEAF_CLASS) {
    return { text: 'Dried leaf — worth a look', tone: 'warn' };
  }
  const byState: Record<string, { text: string; tone: Tone }> = {
    HEALTHY: { text: 'Looks healthy', tone: 'good' },
    DISEASE: {
      text: row.topClass ? describeClass(row.topClass).condition : 'Something was found',
      tone: 'bad',
    },
    NOT_CROP: { text: 'Not crop', tone: 'unknown' },
    UNCERTAIN: { text: 'Not clear enough to say', tone: 'warn' },
    NO_DATA: { text: 'Nothing scanned', tone: 'unknown' },
  };
  if (!row.state) {
    return { text: row.fieldId ? `Field ${row.fieldId}` : `Scan ${row.seq ?? ''}`, tone: 'unknown' };
  }
  return byState[row.state] ?? { text: String(row.state), tone: 'unknown' };
}

/**
 * The reliability warning for a row, without opening the advisory.
 *
 * A finding on a class that fails on unseen cameras should not be able to sit
 * in the list looking like a confirmed diagnosis, because the list is where
 * most looking happens. The tier lives on `detections[]` rather than on the
 * summary, so this reads the class table instead — the tier is a property of
 * the class, which is exactly what makes that lookup sound.
 */
function rowReliability(row: AdvisorySummary): string | null {
  if (row.state !== 'DISEASE' || !row.topClass) return null;
  const recall = recallPercent(row.topClass);
  if (recall === null) return null;
  return `${recall} ON UNSEEN CAMERAS`;
}

export default function HistoryScreen() {
  const [rows, setRows] = useState<AdvisorySummary[]>([]);
  const { state, lastSyncUtc, refresh } = useSync();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  // The band behind the status bar is dark on this screen only.
  useStatusBarStyle('light');

  useFocusEffect(
    useCallback(() => {
      void listAdvisories().then(setRows);
      void refresh();
    }, [refresh]),
  );

  const conn = CONNECTION[state];

  // Dried leaf counts as needing a look even though the model files it under
  // healthy — see rowVerdict. The two must not disagree.
  const needAttention = rows.filter(
    (r) => r.state === 'DISEASE' || r.topClass === DRIED_LEAF_CLASS,
  ).length;
  const healthy = rows.filter(
    (r) => r.state === 'HEALTHY' && r.topClass !== DRIED_LEAF_CLASS,
  ).length;
  const unclear = rows.filter((r) => r.state === 'UNCERTAIN' || r.state === 'NO_DATA').length;

  return (
    <ScrollView
      style={{ backgroundColor: color.background }}
      contentContainerStyle={{ paddingBottom: insets.bottom + space.xl }}
      stickyHeaderIndices={[0]}
    >
      {/* The inverted band, matching the site's deep sections. */}
      <View style={[s.band, { paddingTop: insets.top + space.lg }]}>
        <View style={s.brand}>
          <AegisMark size={24} color={color.primary} />
          <AegisWordmark height={17} color={color.deepForeground} />
        </View>

        <Text style={[type.micro, { color: color.deepMuted, marginTop: 10 }]}>
          AUTONOMOUS EDGE GUIDANCE &amp; INTELLIGENT SURVEILLANCE
        </Text>

        <Pressable onPress={() => router.push('/sync')} style={s.connRow}>
          <Eyebrow onDeep>
            {conn.label}
            {state === 'idle' ? ` · ${describeAge(lastSyncUtc).toUpperCase()}` : ''}
          </Eyebrow>
          <Text style={[type.chipValue, { color: color.deepMuted }]}>
            {rows.length} held ›
          </Text>
        </Pressable>

        {conn.note ? (
          <Text style={[type.small, { color: color.deepMuted, marginTop: space.sm }]}>
            {conn.note}
          </Text>
        ) : null}
      </View>

      <View style={{ padding: space.lg }}>
        {/* What the farmer needs off the top of the list: how many of these are
            asking for something. Counted rather than estimated, and zero is a
            real answer rather than an empty state. */}
        {rows.length > 0 ? (
          <View style={s.summary}>
            <Stat
              value={String(needAttention)}
              caption={needAttention === 1 ? 'Scan needs a look' : 'Scans need a look'}
              tone={needAttention > 0 ? 'bad' : 'good'}
              hero
            />
            <View style={s.summarySide}>
              <Text style={[type.valueSmall, { color: color.mutedForeground }]}>
                {rows.length} scan{rows.length === 1 ? '' : 's'} held on this phone
              </Text>
              <Text style={[type.valueSmall, { color: color.mutedForeground, marginTop: 4 }]}>
                {healthy} looked healthy
              </Text>
              {unclear > 0 ? (
                <Text style={[type.valueSmall, { color: color.mutedForeground, marginTop: 4 }]}>
                  {unclear} not clear enough to call
                </Text>
              ) : null}
            </View>
          </View>
        ) : null}

        {rows.length === 0 ? (
          <View style={s.empty}>
            <Muted>
              No advisories yet. Join the SIH-FIELD network — the pod broadcasts it
              whenever it is switched on — then pull from the pod.
            </Muted>
          </View>
        ) : null}

        {/* href takes the object form rather than a template literal: it stays
            valid once expo-router generates its typed-route definitions, and it
            escapes the id (advisory ids contain ':') without doing it by hand. */}
        {rows.map((row) => {
          const verdict = rowVerdict(row);
          const reliability = rowReliability(row);
          return (
            <Link
              key={row.advisoryId}
              href={{ pathname: '/advisory/[id]', params: { id: row.advisoryId } }}
              asChild
            >
              <Pressable>
                {({ pressed }) => (
                  <View
                    style={[
                      s.row,
                      !row.valid && { borderColor: color.destructiveBorder },
                      pressed && { opacity: 0.7 },
                    ]}
                  >
                    <Text style={[type.micro, { color: color.fgSubtle }]}>
                      {formatWhen(row.generatedAtUtc).toUpperCase()}
                      {row.fieldId ? ` · FIELD ${row.fieldId.toUpperCase()}` : ''}
                    </Text>

                    <View style={s.rowHead}>
                      <Text style={[type.title, { color: color.foreground, flex: 1 }]}>
                        {verdict.text}
                      </Text>
                      <Text style={[type.chipValue, { color: color.fgSubtle }]}>›</Text>
                    </View>

                    <ChipRow>
                      <StatusChip
                        label={(row.state ?? 'NO VERDICT').replace(/_/g, ' ')}
                        tone={verdict.tone}
                      />
                      {/* How often this class is right on a camera the model
                          never trained on. In the list because the list is
                          where most looking happens, and a 0.00% class must
                          not sit here looking like a confirmed diagnosis. */}
                      {reliability ? (
                        <Chip label="CORRECT" value={reliability} tone="warn" />
                      ) : null}
                      {row.origin === 'fixture' ? (
                        <StatusChip label="SAMPLE DATA" tone="warn" />
                      ) : null}
                      {row.origin === 'replay' ? (
                        <StatusChip label="REPLAY" tone="unknown" />
                      ) : null}
                      {row.origin === 'imported' ? (
                        <StatusChip label="IMPORTED FILE" tone="unknown" />
                      ) : null}
                      {/* A production gateway never serves one of these, so a
                          mock advisory on this phone is worth flagging in the
                          list rather than only on the record. */}
                      {row.inferenceBackend === 'mock' ? (
                        <StatusChip label="SIMULATED MODEL" tone="bad" />
                      ) : null}
                      {row.inferenceBackend === 'onnx' ? (
                        <StatusChip label="FALLBACK ENGINE" tone="warn" />
                      ) : null}
                      {!row.valid ? (
                        <Chip
                          label="SCHEMA"
                          value={`${row.violationCount} violation${row.violationCount === 1 ? '' : 's'}`}
                          tone="bad"
                        />
                      ) : null}
                    </ChipRow>
                  </View>
                )}
              </Pressable>
            </Link>
          );
        })}
      </View>
    </ScrollView>
  );
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const s = StyleSheet.create({
  band: {
    backgroundColor: color.deep,
    paddingHorizontal: space.lg,
    paddingBottom: space.lg,
    borderBottomWidth: 1,
    borderBottomColor: color.deepBorder,
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  connRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: space.lg,
    gap: space.sm,
  },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    backgroundColor: color.card,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: color.border,
    padding: space.lg,
    marginBottom: space.md,
    ...shadow.card,
  },
  summarySide: { flex: 1 },
  empty: {
    backgroundColor: color.card,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: color.border,
    padding: space.lg,
  },
  row: {
    backgroundColor: color.card,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: color.border,
    padding: space.lg,
    marginBottom: space.md,
    gap: space.sm,
    ...shadow.card,
  },
  rowHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
