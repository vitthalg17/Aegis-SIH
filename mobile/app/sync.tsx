/**
 * The pod screen — connection state, the ground mast, and the recovery controls.
 *
 * All four connection states are reachable from here, and the failure state
 * shows the actual reason rather than "something went wrong". On Android that
 * reason is usually the routing default, which looks exactly like a dead
 * server, so naming it is the difference between a two-minute fix and a lost
 * day.
 *
 * ── Why there is no "wait for landing" state ─────────────────────────────────
 * The pod is handheld and its access point comes up at boot as a systemd unit,
 * stays up for the whole session and survives a reboot. There is no landing
 * event to wait on and no button to press. The instruction is a standing one.
 *
 * ── What has not been proven ────────────────────────────────────────────────
 * The hardware team named two endpoints as untested on the real Jetson —
 * `sync/trigger` and `trap/upload` — and the SIH-FIELD access point itself is
 * waiting on a replacement WiFi dongle, so nothing here has run over the radio
 * it will ship on. Both facts are on the screen rather than in a commit
 * message, because when one of them fails in front of a judge the useful thing
 * is for the app to have said so first.
 */

import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { countAdvisories, importAdvisoryFromText } from '../src/db/advisories.ts';
import { resetReplica } from '../src/db/client.ts';
import { removeFixtures, reseedFixtures } from '../src/db/seed.ts';
import {
  DEFAULT_BASE_URL,
  POD_SSID,
  clockSkewSeconds,
  getAllowMock,
  getBaseUrl,
  getCachedMastSyncStatus,
  getMastSyncStatus,
  probeHealth,
  pullLatest,
  setAllowMock,
  setBaseUrl,
  triggerMastSync,
} from '../src/sync/client.ts';
import type { Health, MastSyncStatus } from '../src/sync/client.ts';
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
  const [health, setHealth] = useState<Health | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [mast, setMast] = useState<MastSyncStatus | null>(null);
  /** True while `mast` is the remembered reading rather than a fresh one. */
  const [mastStale, setMastStale] = useState(false);
  const [mastNote, setMastNote] = useState<{ text: string; bad: boolean } | null>(null);
  const [allowMock, setAllowMockState] = useState(false);
  const [paste, setPaste] = useState('');
  const [importNote, setImportNote] = useState<{ text: string; bad: boolean } | null>(null);
  const insets = useSafeAreaInsets();
  useStatusBarStyle('dark');

  useEffect(() => {
    void getBaseUrl().then(setUrl);
    void countAdvisories().then(setCount);
    void getAllowMock().then(setAllowMockState);
    // Render the remembered mast state immediately. The most common reason to
    // open this screen is that the pod is not reachable, and a panel that stays
    // blank until a round trip succeeds teaches nothing in exactly that case.
    void getCachedMastSyncStatus().then((cached) => {
      if (!cached) return;
      setMast(cached);
      setMastStale(true);
    });
    void bindToLocalWifi().then((r) => setBindNote(r.bound ? null : (r.reason ?? null)));
  }, []);

  const checkHealth = useCallback(async () => {
    setHealthError(null);
    try {
      setHealth(await probeHealth());
    } catch (e) {
      setHealth(null);
      setHealthError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const checkMast = useCallback(async () => {
    setMastNote(null);
    try {
      setMast(await getMastSyncStatus());
      setMastStale(false);
    } catch (e) {
      // Keep whatever was on screen. Replacing a remembered reading with
      // nothing because the pod is out of range loses information for no gain.
      setMastStale(true);
      setMastNote({ text: e instanceof Error ? e.message : String(e), bad: true });
    }
  }, []);

  const busy = state === 'syncing';
  const skew = health ? clockSkewSeconds(health) : null;
  const podSyncing = health?.syncing === true || health?.sync_state === 'STA_SYNC';

  return (
    <ScrollView
      style={{ backgroundColor: color.background }}
      contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xl }}
    >
      <View style={s.statRow}>
        <StatCard value={String(count)} caption="Advisories held on this phone" highlight />
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
                {progress.total > 0 ? `${progress.fetched} / ${progress.total}` : 'starting'}
              </Text>
            </Row>
          </>
        ) : null}

        {error ? (
          <Panel label="Why it failed" tone="bad">
            {error}
          </Panel>
        ) : null}

        {/* The pod's database restarted and the phone rebuilt from scratch.
            Reported rather than handled quietly: it means the numbering the
            phone had been tracking is gone, and the phone may now be the only
            place some of those earlier scans still exist. */}
        {lastOutcome?.podReset ? (
          <Panel label="The pod had been reset" tone="warn">
            The pod&apos;s stored scans had been cleared since this phone last spoke to
            it, so its numbering had started again from the beginning. Everything was
            re-collected from scratch. Nothing on this phone was deleted. Any scan the
            pod no longer has is still here, and this phone may now be the only copy.
          </Panel>
        ) : null}

        {/* Shown for a partial pull too, so "2 new, 1 failed" is visible
            rather than hidden behind the failure panel. */}
        {lastOutcome && (lastOutcome.ok || lastOutcome.failed.length > 0) ? (
          <ChipRow>
            <Chip label="NEW" value={String(lastOutcome.fetched)} tone="good" />
            <Chip label="ALREADY HELD" value={String(lastOutcome.skipped)} />
            {lastOutcome.failed.length > 0 ? (
              <Chip label="FAILED" value={String(lastOutcome.failed.length)} tone="bad" />
            ) : null}
            {lastOutcome.invalid > 0 ? (
              <Chip label="VIOLATIONS" value={String(lastOutcome.invalid)} tone="bad" />
            ) : null}
          </ChipRow>
        ) : null}
      </Card>

      <Card eyebrow="Pod" title="How to connect">
        <Muted>
          Put this phone and the pod on the same WiFi network, then pull. Once the
          pod&apos;s own network ({POD_SSID}) is set up, joining it will be all it takes.
          Android will say &quot;connected, no internet&quot; on that network, which is
          correct: the pod is not a route to the internet.
        </Muted>

        {/* The access point itself does not exist yet. Better said here, once,
            than discovered by three people separately. */}
        <Panel label="Not yet broadcasting" tone="warn">
          The pod&apos;s own WiFi network ({POD_SSID}) isn&apos;t set up yet. For now the
          phone and pod share a phone hotspot; enter the pod&apos;s address below.
        </Panel>

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
            {busy ? 'Pulling…' : 'Pull from pod'}
          </Text>
        </Pressable>

        <Pressable
          onPress={async () => {
            try {
              const r = await pullLatest();
              setCount(await countAdvisories());
              setImportNote({
                text: `Pulled ${r.advisoryId}.${r.valid ? '' : ' It breaks the schema. Open it to see how.'}`,
                bad: !r.valid,
              });
            } catch (e) {
              setImportNote({ text: e instanceof Error ? e.message : String(e), bad: true });
            }
          }}
          style={({ pressed }) => [s.button, s.buttonSecondary, pressed && { opacity: 0.6 }]}
        >
          <Text style={[type.label, { color: color.secondaryForeground }]}>
            Just get the newest scan
          </Text>
        </Pressable>

        <Pressable
          onPress={() => void checkHealth()}
          style={({ pressed }) => [s.button, s.buttonSecondary, pressed && { opacity: 0.6 }]}
        >
          <Text style={[type.label, { color: color.secondaryForeground }]}>
            Check the pod is reachable
          </Text>
        </Pressable>

        {healthError ? (
          <Panel label="Not reachable" tone="bad">
            {healthError}
          </Panel>
        ) : null}

        {health ? (
          <>
            <Divider />
            <Row>
              <Muted>Device</Muted>
              <Text style={[type.valueSmall, { color: color.foreground }]}>
                {health.device ?? 'unnamed'}
              </Text>
            </Row>
            <Row>
              <Muted>Advisories stored</Muted>
              <Text style={[type.valueSmall, { color: color.foreground }]}>
                {health.advisory_count ?? 'unknown'}
              </Text>
            </Row>
            <Row>
              <Muted>Newest on the pod</Muted>
              <Text style={[type.valueSmall, { color: color.foreground }]}>
                {health.latest_seq !== undefined ? `#${health.latest_seq}` : 'unknown'}
              </Text>
            </Row>
            {health.storage_free_kb !== undefined ? (
              <Row>
                <Muted>Storage free</Muted>
                <Text style={[type.valueSmall, { color: color.foreground }]}>
                  {Math.round(health.storage_free_kb / 1024)} MB
                </Text>
              </Row>
            ) : null}
            <Row>
              <Muted>Wire contract</Muted>
              <StatusChip
                label={health.schema_version ?? 'UNKNOWN'}
                tone={health.schema_version === '1.0' ? 'good' : 'bad'}
              />
            </Row>

            {/* A pod speaking a version this build does not know is a
                compatibility problem, and it is far cheaper to learn about it
                here than one advisory at a time on the history screen. */}
            {health.schema_version && health.schema_version !== '1.0' ? (
              <Panel label="Contract mismatch" tone="bad">
                {`This pod is speaking schema version ${health.schema_version}; this app was built against 1.0. Some blocks may be missing or may mean something different. Update one of the two before trusting what comes across.`}
              </Panel>
            ) : null}

            {/* The clock is worth its own line. Until GPS locks, the pod's time
                is whatever the filesystem last recorded, and every timestamp it
                emits inherits that. */}
            <Row>
              <Muted>Pod clock</Muted>
              <StatusChip
                label={(health.clock_source ?? 'unknown').toUpperCase()}
                tone={
                  health.clock_source === 'gps'
                    ? 'good'
                    : health.clock_source === 'rtc'
                      ? 'neutral'
                      : 'warn'
                }
              />
            </Row>

            {health.clock_source === 'filesystem' ? (
              <Panel label="Clock not set" tone="warn">
                The pod has not set its clock from satellite or from its battery-backed
                clock, so it is using whatever time the last file write recorded. Every
                timestamp on anything it sends now is wrong by an unknown amount. Leaving
                it in open sky for a minute usually fixes it.
              </Panel>
            ) : null}

            {skew !== null && Math.abs(skew) > 120 ? (
              <Panel label="Clocks disagree" tone="warn">
                This phone and the pod are about {Math.abs(Math.round(skew / 60))} minutes
                apart. Times shown against pod timestamps will be off by roughly that much.
              </Panel>
            ) : null}

            {podSyncing ? (
              <Panel label="Pod is away" tone="unknown">
                The pod has dropped its own Wi-Fi to go and collect from the field station.
                It will be back in about half a minute. Nothing is wrong.
              </Panel>
            ) : null}
          </>
        ) : null}
      </Card>

      {/*
        The ground mast. The pod has one radio, so collecting from the station
        means leaving its own access point — which looks exactly like the pod
        dying if the app has not said so first.
      */}
      <Card eyebrow="Field station" title="Weather, soil and trap data">
        <Muted>
          The station standing in your field does not talk to this phone. The pod fetches
          from it, and everything the station measures reaches you through an advisory.
          Air temperature and soil readings come from here; so does the sticky trap photo.
        </Muted>

        <Panel label="Not yet exercised on the device" tone="warn">
          The hardware team have not yet run this against the real Jetson. It is built to
          the contract and may work first time. If it fails, that is where to look
          before suspecting the phone.
        </Panel>

        <Pressable
          onPress={() => void checkMast()}
          style={({ pressed }) => [s.button, s.buttonSecondary, pressed && { opacity: 0.6 }]}
        >
          <Text style={[type.label, { color: color.secondaryForeground }]}>
            Check the field station
          </Text>
        </Pressable>

        <Pressable
          onPress={async () => {
            setMastNote(null);
            try {
              const r = await triggerMastSync();
              setMastNote({
                text: `The pod is going to collect from the field station now. It will drop its own Wi-Fi for about ${r.expected_ap_downtime_s} seconds and this phone will lose it. That is expected. Wait, then pull again.`,
                bad: false,
              });
            } catch (e) {
              setMastNote({ text: e instanceof Error ? e.message : String(e), bad: true });
            }
          }}
          style={({ pressed }) => [s.button, s.buttonSecondary, pressed && { opacity: 0.6 }]}
        >
          <Text style={[type.label, { color: color.secondaryForeground }]}>
            Collect from the field station now
          </Text>
        </Pressable>

        {mastNote ? (
          <Panel label={mastNote.bad ? 'Could not do that' : 'Pod is going offline briefly'} tone={mastNote.bad ? 'bad' : 'warn'}>
            {mastNote.text}
          </Panel>
        ) : null}

        {mast ? (
          <>
            <Divider />
            {mastStale ? (
              <Panel label="Remembered, not current" tone="unknown">
                This is the last thing the pod told us about the field station, not a
                reading taken just now. Tap above to check it again.
              </Panel>
            ) : null}
            <Row>
              <Muted>Collecting right now</Muted>
              <StatusChip
                label={mast.sync_in_progress ? 'YES' : 'NO'}
                tone={mast.sync_in_progress ? 'warn' : 'neutral'}
              />
            </Row>
            <Row>
              <Muted>Last attempt</Muted>
              <StatusChip
                label={mast.last_result ?? 'NEVER'}
                tone={
                  mast.last_result === 'OK'
                    ? 'good'
                    : mast.last_result === 'PARTIAL'
                      ? 'warn'
                      : mast.last_result === null
                        ? 'unknown'
                        : 'bad'
                }
              />
            </Row>
            <Row>
              <Muted>Last success</Muted>
              <Text style={[type.valueSmall, { color: color.foreground }]}>
                {mast.last_success_utc ? describeAge(mast.last_success_utc) : 'never'}
              </Text>
            </Row>

            <ChipRow>
              <Chip label="READINGS" value={String(mast.records_pulled)} />
              <Chip label="TRAP PHOTOS" value={String(mast.trap_images_pulled)} />
              {mast.mast_data_age_s !== null ? (
                <Chip
                  label="DATA AGE"
                  value={formatSeconds(mast.mast_data_age_s)}
                  tone={mast.mast_data_age_s > 7200 ? 'warn' : 'neutral'}
                />
              ) : null}
            </ChipRow>

            {/* Stale station data is the quiet failure here: the pod keeps
                serving advisories, the irrigation figures keep appearing, and
                nothing says they were computed from yesterday's weather. */}
            {mast.mast_data_age_s !== null && mast.mast_data_age_s > 7200 ? (
              <Panel label="Station data is old" tone="warn">
                {`The newest reading from the field station is ${formatSeconds(mast.mast_data_age_s)} old. Water-use figures worked out from it describe that weather, not today's. Check the station has power and is in range of the pod.`}
              </Panel>
            ) : null}

            {mast.last_result === 'MAST_NOT_FOUND' ? (
              <Panel label="Station not found" tone="bad">
                The pod could not see the field station&apos;s network at all. Check it is
                powered, and that the pod was within range when it tried.
              </Panel>
            ) : null}
          </>
        ) : null}
      </Card>

      {/*
        Insurance against the access point not landing in time. The pod can
        write every advisory to disk as plain JSON; this gets one into the app
        without a socket ever reaching the pod. It is not the demo anyone wants,
        but it means "the app renders a real advisory" is never blocked on a
        WiFi dongle in the post.
      */}
      <Card eyebrow="Recovery" title="Import an advisory file">
        <Muted>
          Paste the contents of an advisory JSON file. It is validated and stored exactly
          as a pulled one would be, and labelled as imported everywhere it appears,
          because a file someone put on this phone is a weaker claim than a record the
          phone collected itself.
        </Muted>

        <TextInput
          value={paste}
          onChangeText={setPaste}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          style={[s.input, s.paste]}
          placeholder={'{ "schema_version": "1.0", "advisory_id": "…", "seq": 1, … }'}
          placeholderTextColor={color.fgSubtle}
        />

        <Pressable
          onPress={async () => {
            if (!paste.trim()) return;
            try {
              const r = await importAdvisoryFromText(paste);
              setPaste('');
              setCount(await countAdvisories());
              setImportNote({
                text: r.valid
                  ? `Imported ${r.advisoryId}. It satisfies the schema.`
                  : `Imported ${r.advisoryId}, but it breaks ${r.violations.length} schema rule${r.violations.length === 1 ? '' : 's'}. It is stored and flagged. Open it to see which.`,
                bad: !r.valid,
              });
            } catch (e) {
              setImportNote({ text: e instanceof Error ? e.message : String(e), bad: true });
            }
          }}
          style={({ pressed }) => [s.button, s.buttonSecondary, pressed && { opacity: 0.6 }]}
        >
          <Text style={[type.label, { color: color.secondaryForeground }]}>
            Import pasted advisory
          </Text>
        </Pressable>

        {importNote ? (
          <Panel
            label={importNote.bad ? 'Check this' : 'Done'}
            tone={importNote.bad ? 'warn' : 'good'}
          >
            {importNote.text}
          </Panel>
        ) : null}
      </Card>

      <Card eyebrow="Demo" title="Replica controls">
        <Muted>
          The replica is seeded with six sample advisories so the app renders a full
          history with no pod present. Five are invented and are labelled SAMPLE DATA
          everywhere they appear. The sixth is the advisory the hardware team captured
          from the real device on 19 September, kept byte for byte.
        </Muted>

        {/* The production guard, and the switch that turns it off. On the
            screen rather than in a build flag, because a reader needs to be
            able to see that it is currently off. */}
        <Divider />
        <Row>
          <View style={{ flex: 1 }}>
            <Text style={[type.label, { color: color.foreground }]}>
              Accept simulated advisories
            </Text>
            <Text style={[type.small, { color: color.mutedForeground, marginTop: 2 }]}>
              Asks the pod for advisories produced by the simulated model backend, which it
              normally refuses to serve. For integration testing only.
            </Text>
          </View>
          <Switch
            value={allowMock}
            onValueChange={async (on) => {
              await setAllowMock(on);
              setAllowMockState(on);
            }}
            trackColor={{ true: color.warning, false: color.border }}
          />
        </Row>
        {allowMock ? (
          <Panel label="Guard is off" tone="bad">
            This phone is currently asking the pod for simulated advisories. Anything
            pulled while this is on may be synthetic. Turn it off before showing the app
            to anyone.
          </Panel>
        ) : null}

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
            await removeFixtures();
            setCount(await countAdvisories());
          }}
          style={({ pressed }) => [s.button, s.buttonSecondary, pressed && { opacity: 0.6 }]}
        >
          <Text style={[type.label, { color: color.secondaryForeground }]}>
            Remove sample advisories (keeps real ones)
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

/** Coarse on purpose — a precise-looking age this app cannot verify is a small
 *  fabrication of its own. */
function formatSeconds(s: number): string {
  if (s < 90) return `${s} s`;
  if (s < 5400) return `${Math.round(s / 60)} min`;
  if (s < 172800) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86400)} days`;
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
  paste: { minHeight: 96, textAlignVertical: 'top' },
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
