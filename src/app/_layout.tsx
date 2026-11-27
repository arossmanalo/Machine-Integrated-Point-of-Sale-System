import {
  IBMPlexSans_400Regular,
  IBMPlexSans_500Medium,
  IBMPlexSans_600SemiBold,
  useFonts,
} from '@expo-google-fonts/ibm-plex-sans';
import { useMigrations } from 'drizzle-orm/expo-sqlite/migrator';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import migrations from '../../drizzle/migrations';
import { appContext, appDb } from '@/db/client';
import { bluetoothReceiptPrinter } from '@/printing/BluetoothReceiptPrinter';
import { AppProvider } from '@/state/AppProvider';
import { StartWatchProvider } from '@/state/startWatch';
import { ToastProvider } from '@/state/toast';
import { Text } from '@/ui/Text';
import { colors, space } from '@/ui/theme';

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    IBMPlexSans_400Regular,
    IBMPlexSans_500Medium,
    IBMPlexSans_600SemiBold,
  });
  const migration = useMigrations(appDb, migrations);

  if (migration.error) {
    return (
      <View style={styles.center}>
        <Text variant="heading">The shop database could not be opened</Text>
        <Text tone="muted">{migration.error.message}</Text>
        <Text tone="muted">Restart the app. If this keeps happening, restore the latest backup.</Text>
      </View>
    );
  }
  // Without the font the app still works in the system font, so a font error does not block.
  if (!migration.success || (!fontsLoaded && !fontError)) {
    return <View style={styles.center} />;
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <AppProvider ctx={appContext} printer={bluetoothReceiptPrinter}>
        <ToastProvider>
          <StartWatchProvider>
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: colors.background },
              }}
            />
          </StartWatchProvider>
        </ToastProvider>
      </AppProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: 'center',
    padding: space.xl,
    gap: space.sm,
    backgroundColor: colors.background,
  },
});
