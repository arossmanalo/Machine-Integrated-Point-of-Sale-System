import * as Updates from 'expo-updates';
import { useState } from 'react';

import { formatShopDateTime } from '@/domain/dates';

import { Button } from './Button';
import { Notice, Section } from './layout';
import { Text } from './Text';

type CheckState = { kind: 'idle' } | { kind: 'busy' } | { kind: 'current' } | { kind: 'failed'; message: string };

function describeRunning(): string {
  const version = Updates.runtimeVersion ?? 'development';
  if (!Updates.isEnabled) return `Version ${version} · updates are off in this build`;
  if (Updates.isEmbeddedLaunch || Updates.createdAt === null) return `Version ${version} · as installed`;
  return `Version ${version} · update of ${formatShopDateTime(Updates.createdAt.getTime())}`;
}

/**
 * Shows which app version and update the tablet runs. Updates also download on their own when
 * the app opens and apply on the next start; this button applies one straight away.
 */
export function AppUpdatesSection() {
  const [check, setCheck] = useState<CheckState>({ kind: 'idle' });

  async function checkNow() {
    setCheck({ kind: 'busy' });
    try {
      const found = await Updates.checkForUpdateAsync();
      if (!found.isAvailable) {
        setCheck({ kind: 'current' });
        return;
      }
      await Updates.fetchUpdateAsync();
      await Updates.reloadAsync();
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error);
      setCheck({ kind: 'failed', message: `Could not check for updates. Check the internet connection. (${reason})` });
    }
  }

  return (
    <Section title="About this app">
      <Text tone="muted">{describeRunning()}</Text>
      {Updates.isEnabled && (
        <Button
          label={check.kind === 'busy' ? 'Checking for updates' : 'Check for updates'}
          kind="secondary"
          icon="cloud-download-outline"
          onPress={() => void checkNow()}
          busy={check.kind === 'busy'}
          accessibilityHint="Downloads a newer version if there is one and restarts the app with it."
        />
      )}
      {check.kind === 'current' && <Notice tone="success">This is the newest version.</Notice>}
      {check.kind === 'failed' && <Notice tone="danger">{check.message}</Notice>}
    </Section>
  );
}
