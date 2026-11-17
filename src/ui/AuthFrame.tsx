import type { ReactNode } from 'react';
import { KeyboardAvoidingView, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Text } from './Text';
import { colors, radius, space } from './theme';

/** The narrow column used by first-run setup and login. */
export function AuthFrame({ title, intro, children }: { title: string; intro: string; children: ReactNode }) {
  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.safe} behavior="height">
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.column}>
            <Text variant="caption" tone="muted" style={styles.brand}>
              AR LAUNDRY · COUNTER
            </Text>
            <Text variant="title">{title}</Text>
            <Text tone="muted">{intro}</Text>
            <View style={styles.form}>{children}</View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: space.lg },
  column: { width: '100%', maxWidth: 440, alignSelf: 'center', gap: space.sm },
  brand: { letterSpacing: 1.2 },
  form: {
    marginTop: space.lg,
    gap: space.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.xl,
  },
});
