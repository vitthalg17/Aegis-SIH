/**
 * The history list.
 *
 * §14.2 step 1 — this screen renders the full history with no drone present.
 * Everything shown comes from the local replica; nothing here touches the
 * network, and a farmer who never syncs again still sees every advisory the
 * phone has ever received.
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
import { describeAge, useSync } from '../src/sync/state.ts';
import { AegisMark, AegisWordmark } from '../src/ui/brand.tsx';
import { Chip, ChipRow, Eyebrow, Muted, StatusChip } from '../src/ui/components.tsx';
import { useStatusBarStyle } from '../src/ui/status-bar.ts';
import { color, radius, shadow, space, type } from '../src/ui/theme.ts';

const CONNECTION = {
  never_synced: {
    label: 'NEVER SYNCED',
    tone: 'unknown' as const,
    note: 'Nothing has been pulled from a field station on this phone.',
  },
  idle: { label: 'SYNCED', tone: 'good' as const, note: null },
  syncing: { label: 'SYNCING', tone: 'neutral' as const, note: 'Pulling from the field station.' },
  failed: {
    label: 'SYNC FAILED',
    tone: 'bad' as const,
    note: 'Last attempt did not complete. Tap for the reason.',
  },
};

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
        {rows.length === 0 ? (
          <View style={s.empty}>
            <Muted>
              No advisories yet. Join the SIH-FIELD network after a flight and pull from
              the field station.
            </Muted>
          </View>
        ) : null}

        {/* href takes the object form rather than a template literal: it stays
            valid once expo-router generates its typed-route definitions, and it
            escapes the id (advisory ids contain ':') without doing it by hand. */}
        {rows.map((row) => (
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
                  </Text>

                  <View style={s.rowHead}>
                    <Text style={[type.title, { color: color.foreground }]}>
                      Field {row.fieldId}
                    </Text>
                    <Text style={[type.chipValue, { color: color.fgSubtle }]}>›</Text>
                  </View>

                  <ChipRow>
                    {row.origin === 'fixture' ? (
                      <StatusChip label="SAMPLE DATA" tone="warn" />
                    ) : null}
                    {row.origin === 'replay' ? (
                      <StatusChip label="REPLAY" tone="unknown" />
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
        ))}
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
