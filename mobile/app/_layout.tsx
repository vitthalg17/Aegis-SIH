import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  useFonts,
  Montserrat_400Regular,
  Montserrat_500Medium,
  Montserrat_700Bold,
} from '@expo-google-fonts/montserrat';
import {
  SourceCodePro_400Regular,
  SourceCodePro_600SemiBold,
} from '@expo-google-fonts/source-code-pro';

import { revalidateAll } from '../src/db/advisories.ts';
import { getDb } from '../src/db/client.ts';
import { seedFixturesIfEmpty } from '../src/db/seed.ts';
import { color, type } from '../src/ui/theme.ts';

export default function RootLayout() {
  const [fontsReady] = useFonts({
    Montserrat_400Regular,
    Montserrat_500Medium,
    Montserrat_700Bold,
    SourceCodePro_400Regular,
    SourceCodePro_600SemiBold,
  });
  const [dbReady, setDbReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // §14.2 step 1 — the store comes up before anything else. The app is fully
    // usable from here on with no pod, no field station and no network.
    (async () => {
      try {
        await getDb();
        // Order matters. Replace stale sample data first, then re-check what is
        // left against the current validator — a record that was valid when it
        // was stored can fail the contract as it stands today, and its stored
        // verdict has to say so before any screen reads it.
        await seedFixturesIfEmpty();
        await revalidateAll();
        setDbReady(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  if (error) {
    return (
      <View style={{ flex: 1, backgroundColor: color.background, padding: 24, justifyContent: 'center' }}>
        <Text style={[type.title, { color: color.destructive, marginBottom: 8 }]}>
          Local store failed to open
        </Text>
        <Text style={[type.body, { color: color.foreground }]}>{error}</Text>
      </View>
    );
  }

  if (!fontsReady || !dbReady) {
    return (
      <View style={{ flex: 1, backgroundColor: color.background, justifyContent: 'center' }}>
        <ActivityIndicator color={color.primary} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: color.background },
          headerShadowVisible: false,
          headerTintColor: color.foreground,
          // The stack header only accepts fontFamily/fontSize/fontWeight/color,
          // so the tracking from the type ramp cannot be applied here.
          headerTitleStyle: { fontFamily: 'Montserrat_700Bold', fontSize: 16.5 },
          contentStyle: { backgroundColor: color.background },
        }}
      >
        {/* The history screen draws its own inverted header band, matching
            the site's deep sections, so the stack header is turned off there. */}
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="advisory/[id]" options={{ title: 'Advisory' }} />
        <Stack.Screen name="sync" options={{ title: 'Field station', presentation: 'modal' }} />
      </Stack>
    </SafeAreaProvider>
  );
}
