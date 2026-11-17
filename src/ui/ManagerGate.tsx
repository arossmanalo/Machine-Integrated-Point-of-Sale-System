import { Stack } from 'expo-router';
import type { ReactNode } from 'react';

import type { Role } from '@/domain/permissions';
import { useActor } from '@/state/AppProvider';

import { EmptyState, Screen } from './layout';

/** Header plus a role check for screens under Manage. */
export function ManageScreen({
  title,
  allowed,
  children,
}: {
  title: string;
  allowed: (role: Role) => boolean;
  children: ReactNode;
}) {
  const actor = useActor();
  return (
    <>
      <Stack.Screen options={{ headerShown: true, title }} />
      {allowed(actor.role) ? (
        children
      ) : (
        <Screen>
          <EmptyState icon="lock-outline" title="Not available" body="Ask the owner if you need this screen." />
        </Screen>
      )}
    </>
  );
}
