import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { MachineRow } from '@/db/schema';
import { formatShopDateTime } from '@/domain/dates';
import { can } from '@/domain/permissions';
import { MACHINE_TYPE_LABELS, MACHINE_TYPES } from '@/domain/unlockPolicy';
import { lastUnlocks, listMachines } from '@/services/machines';
import { useActor, useApp } from '@/state/AppProvider';
import { useData } from '@/state/hooks';
import { Button } from '@/ui/Button';
import { EmptyState, Notice, Panel, Screen, Section } from '@/ui/layout';
import { OrderPickerDialog, OverrideDialog } from '@/ui/machines/UnlockDialogs';
import { Text } from '@/ui/Text';
import { colors, MIN_TOUCH, radius, space } from '@/ui/theme';

export default function Machines() {
  const actor = useActor();
  const { controller, controllerState } = useApp();
  const [picking, setPicking] = useState<MachineRow | null>(null);
  const [overriding, setOverriding] = useState<MachineRow | null>(null);
  const data = useData((c) => {
    const machines = listMachines(c);
    return { machines, last: lastUnlocks(c, machines.map((m) => m.id)) };
  });

  return (
    <Screen>
      {controllerState.status !== 'ready' && (
        <Notice
          tone="warning"
          action={<Button label="Reconnect" kind="secondary" onPress={() => void controller.connect()} />}
        >
          {controllerState.detail ?? 'The door-lock controller is not connected.'}
        </Notice>
      )}
      {controller.kind === 'mock' && (
        <Notice tone="info">Locks are simulated. No real doors open. The owner can change this in Manage.</Notice>
      )}

      {data.machines.length === 0 ? (
        <Panel>
          <EmptyState
            icon="washing-machine"
            title="No machines set up"
            body="Add each washer and dryer with the Arduino channel its lock is wired to."
            action={
              can.manageMachines(actor.role) ? (
                <Button label="Set up machines" onPress={() => router.push('/manage/machines')} />
              ) : undefined
            }
          />
        </Panel>
      ) : (
        MACHINE_TYPES.map((type) => {
          const list = data.machines.filter((m) => m.type === type);
          if (list.length === 0) return null;
          return (
            <Section key={type} title={`${MACHINE_TYPE_LABELS[type]}s`}>
              <View style={styles.grid}>
                {list.map((machine) => {
                  const last = data.last.get(machine.id);
                  return (
                    <Pressable
                      key={machine.id}
                      accessibilityRole="button"
                      accessibilityLabel={`${machine.name}${machine.enabled ? '' : ', switched off'}`}
                      disabled={!machine.enabled}
                      onPress={() => setPicking(machine)}
                      style={({ pressed }) => [
                        styles.tile,
                        pressed && { backgroundColor: colors.surfaceSunken },
                        !machine.enabled && styles.off,
                      ]}
                    >
                      <MaterialCommunityIcons
                        name={type === 'WASHER' ? 'washing-machine' : 'tumble-dryer'}
                        size={28}
                        color={machine.enabled ? colors.accent : colors.textMuted}
                      />
                      <Text variant="bodyStrong">{machine.name}</Text>
                      <Text variant="caption" tone="muted">
                        {!machine.enabled
                          ? 'Switched off'
                          : last
                            ? `Opened ${formatShopDateTime(last.at)}${last.orderId ? ` · ${last.orderId}` : ' · override'}`
                            : 'Not opened yet'}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </Section>
          );
        })
      )}
      {can.viewUnlockLog(actor.role) && data.machines.length > 0 && (
        <Button label="View unlock log" kind="quiet" icon="history" onPress={() => router.push('/manage/unlock-log')} />
      )}

      {picking && (
        <OrderPickerDialog
          machine={picking}
          onClose={() => setPicking(null)}
          onOverride={() => {
            setOverriding(picking);
            setPicking(null);
          }}
        />
      )}
      {overriding && <OverrideDialog machine={overriding} onClose={() => setOverriding(null)} />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  tile: {
    minHeight: MIN_TOUCH * 2.5,
    flexGrow: 1,
    flexBasis: 200,
    maxWidth: 300,
    padding: space.lg,
    gap: space.xs,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  off: { opacity: 0.55 },
});
