/**
 * The field station screen — §14.2 step 4, plus the demo controls.
 *
 * All four connection states are reachable from here, and the failure state
 * shows the actual reason rather than "something went wrong". On Android that
 * reason is usually the §14.1 routing default, which looks exactly like a dead
 * server, so naming it is the difference between a two-minute fix and a lost
 * day.
 */

import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { countAdvisories } from '../src/db/advisories.ts';
import { resetReplica } from '../src/db/client.ts';
import { reseedFixtures } from '../src/db/seed.ts';
import { DEFAULT_BASE_URL, getBaseUrl, setBaseUrl } from '../src/sync/client.ts';
import { bindToLocalWifi } from '../src/sync/network.ts';
import { describeAge, useSync } from '../src/sync/state.ts';
import {
  Card,
  Chip,
  ChipRow,
  Divider,
  Muted,
  Panel,
  Row,
  StatCard,
  StatusChip,
} from '../src/ui/components.tsx';
import { useStatusBarStyle } from '../src/ui/status-bar.ts';
import { color, radius, space, type } from '../src/ui/theme.ts';

export default function SyncScreen() {
  const { state, lastSyncUtc, error, progress, lastOutcome, run, refresh } = useSync();
  const [url, setUrl] = useState(DEFAULT_BASE_URL);
  const [count, setCount] = useState(0);
  const [bindNote, setBindNote] = useState<string | null>(null);
  const insets = useSafeAreaInsets();
  useStatusBarStyle('dark');

  useEffect(() => {
    void getBaseUrl().then(setUrl);
    void countAdvisories().then(setCount);
    void bindToLocalWifi().then((r) => setBindNote(r.bound ? null : (r.reason ?? null)));
  }, []);

  const busy = state === 'syncing';

  return (
    <ScrollView
      style={{ backgroundColor: color.background }}
      contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xl }}
    >
      <View style={s.statRow}>
        <StatCard value={String(count)} caption="Advisories held locally" highlight />
        <StatCard value={describeAge(lastSyncUtc)} caption="Last successful pull" />
      </View>

      <Card eyebrow="Connection" title="State">
        <Row>
          <Muted>Right now</Muted>
          <StatusChip
            label={state.replace('_', ' ').toUpperCase()}
            tone={state === 'idle' ? 'good' : state === 'failed' ? 'bad' : 'unknown'}
          />
        </Row>

        {progress ? (
          <>
            <Divider />
            <Row>
              <Muted>{progress.phase}</Muted>
              <Text style={[type.chipValue, { color: color.foreground }]}>
                {progress.total > 0 ? `${progress.fetched} / ${progress.total}` : '—'}
              </Text>
            </Row>
          </>
        ) : null}

        {error ? <Panel label="Why it failed" tone="bad">{error}</Panel> : null}

        {lastOutcome?.ok ? (
          <ChipRow>
            <Chip label="NEW" value={String(lastOutcome.fetched)} tone="good" />
            <Chip label="ALREADY HELD" value={String(lastOutcome.skipped)} />
            {lastOutcome.invalid > 0 ? (
              <Chip label="VIOLATIONS" value={String(lastOutcome.invalid)} tone="bad" />
            ) : null}
          </ChipRow>
        ) : null}
      </Card>

      <Card eyebrow="Field station" title="Jetson SoftAP">
        <Muted>Address from §7.1. Join SIH-FIELD before pulling.</Muted>
        <TextInput
          value={url}
          onChangeText={setUrl}
          onEndEditing={() => void setBaseUrl(url)}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          style={s.input}
          placeholder={DEFAULT_BASE_URL}
          placeholderTextColor={color.fgSubtle}
        />

        {bindNote ? (
          <Panel label="Network binding unavailable" tone="warn">
            {bindNote}
          </Panel>
        ) : null}

        <Pressable
          onPress={() => void run()}
          disabled={busy}
          style={({ pressed }) => [s.button, (busy || pressed) && { opacity: 0.6 }]}
        >
          <Text style={[type.label, { color: color.primaryForeground }]}>
            {busy ? 'Pulling…' : 'Pull from field station'}
          </Text>
        </Pressable>
      </Card>

      <Card eyebrow="Demo" title="Replica controls">
        <Muted>
          The replica is seeded with five sample advisories so the app renders a full
          history with no drone present. They are labelled SAMPLE DATA everywhere they
          appear and are never presented as measurements.
        </Muted>

        <Pressable
          onPress={async () => {
            await reseedFixtures();
            setCount(await countAdvisories());
          }}
          style={({ pressed }) => [s.button, s.buttonSecondary, pressed && { opacity: 0.6 }]}
        >
          <Text style={[type.label, { color: color.secondaryForeground }]}>
            Reload sample advisories
          </Text>
        </Pressable>

        <Pressable
          onPress={async () => {
            await resetReplica();
            setCount(await countAdvisories());
            await refresh();
          }}
          style={({ pressed }) => [s.button, s.buttonDanger, pressed && { opacity: 0.6 }]}
        >
          <Text style={[type.label, { color: color.destructive }]}>
            Clear replica (back to never synced)
          </Text>
        </Pressable>
      </Card>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  statRow: { flexDirection: 'row', gap: space.md, marginBottom: space.md },
  input: {
    marginTop: space.md,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: 10,
    fontFamily: 'SourceCodePro_400Regular',
    fontSize: 12.5,
    color: color.foreground,
    backgroundColor: color.background,
  },
  button: {
    marginTop: space.md,
    backgroundColor: color.primary,
    borderRadius: radius.md,
    paddingVertical: 13,
    alignItems: 'center',
  },
  buttonSecondary: { backgroundColor: color.secondary, borderWidth: 1, borderColor: color.accent },
  buttonDanger: {
    backgroundColor: color.destructiveMuted,
    borderWidth: 1,
    borderColor: color.destructiveBorder,
  },
});
