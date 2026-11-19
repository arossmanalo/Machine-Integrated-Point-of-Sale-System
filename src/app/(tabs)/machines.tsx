import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { MachineRow } from '@/db/schema';
import { formatShopDateTime } from '@/domain/dates';
import { can } from '@/domain/permissions';
import { MACHINE_TYPE_LABELS, MACHINE_TYPES } from '@/domain/unlockPolicy';
import { lastUnlocks, listMachines, lockMachine, RESULT_MESSAGES, testPulse } from '@/services/machines';
import { createTestOrder, voidOrder } from '@/services/orders';
import { useActor, useApp } from '@/state/AppProvider';
import { useAction, useData } from '@/state/hooks';
import { useToast } from '@/state/toast';
import { Button } from '@/ui/Button';
import { Badge } from '@/ui/controls';
import { EmptyState, Notice, Panel, Row, Screen, Section } from '@/ui/layout';
import { OrderPickerDialog, OverrideDialog } from '@/ui/machines/UnlockDialogs';
import { Text } from '@/ui/Text';
import { colors, MIN_TOUCH, radius, space } from '@/ui/theme';

export default function Machines() {
  const actor = useActor();
  const { controller, controllerState } = useApp();
  const [picking, setPicking] = useState<MachineRow | null>(null);
  const [overriding, setOverriding] = useState<MachineRow | null>(null);
  const [testOrderId, setTestOrderId] = useState<string | null>(null);
  const action = useAction();
  const toast = useToast();
  const owner = can.manageMachines(actor.role);
  const showLockState = controllerState.status === 'ready';

  async function testUnlock(machine: MachineRow) {
    const result = await action.run((c) => testPulse(c, controller, actor, machine.id));
    if (!result.ok) return;
    toast(
      result.value === 'acked'
        ? `${machine.name} unlocked (test). It stays unlocked until you lock it.`
        : `${machine.name}: ${RESULT_MESSAGES[result.value]}`,
      result.value === 'acked' ? 'success' : 'danger',
    );
  }

  async function lockDoor(machine: MachineRow) {
    const result = await action.run((c) => lockMachine(c, controller, machine.id));
    if (!result.ok) return;
    toast(
      result.value === 'acked' ? `${machine.name} locked` : `${machine.name}: ${RESULT_MESSAGES[result.value]}`,
      result.value === 'acked' ? 'success' : 'danger',
    );
  }

  async function makeTestOrder() {
    const result = await action.run((c) => createTestOrder(c, actor));
    if (result.ok) setTestOrderId(result.value.id);
  }

  async function voidTestOrder(orderId: string) {
    const result = await action.run((c) => voidOrder(c, actor, orderId, 'Test order'));
    if (result.ok) {
      setTestOrderId(null);
      toast(`Test order ${orderId} voided`, 'success');
    }
  }
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
            body="Add each washer and dryer with the lock controller channel its lock is wired to."
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
                  const unlocked = controllerState.unlockedChannels.includes(machine.hardwareChannel);
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
                      <Row>
                        <Text variant="bodyStrong" style={styles.name}>
                          {machine.name}
                        </Text>
                        {showLockState && (
                          <Badge label={unlocked ? 'Unlocked' : 'Locked'} tone={unlocked ? 'warning' : 'neutral'} />
                        )}
                      </Row>
                      <Text variant="caption" tone="muted">
                        {!machine.enabled
                          ? 'Switched off'
                          : last
                            ? `Opened ${formatShopDateTime(last.at)} · ${last.orderId ?? (last.kind === 'TEST' ? 'test' : 'override')}`
                            : 'Not opened yet'}
                      </Text>
                      {showLockState && unlocked ? (
                        <Button
                          label="Lock"
                          kind="secondary"
                          icon="lock-outline"
                          onPress={() => void lockDoor(machine)}
                          busy={action.busy}
                          accessibilityHint="Locks this door again."
                        />
                      ) : (
                        owner && (
                          <Button
                            label="Test unlock"
                            kind="quiet"
                            icon="lock-open-variant-outline"
                            onPress={() => void testUnlock(machine)}
                            busy={action.busy}
                            accessibilityHint="Owner only. Unlocks this door without an order and logs it as a test."
                          />
                        )
                      )}
                    </Pressable>
                  );
                })}
              </View>
            </Section>
          );
        })
      )}
      {owner && data.machines.length > 0 && (
        <Section
          title="Testing"
          description="Only the owner sees this. Test unlock on a machine unlocks it without an order; it stays unlocked until someone taps Lock. To try the staff flow instead, create a test order, tap a machine and pick it. Test orders are Pay later and take no supplies; void them when you are done."
        >
          {testOrderId === null ? (
            <Button label="Create test order" kind="secondary" icon="clipboard-plus-outline" onPress={makeTestOrder} busy={action.busy} />
          ) : (
            <Notice
              tone="info"
              action={<Button label="Void test order" kind="secondary" onPress={() => void voidTestOrder(testOrderId)} busy={action.busy} />}
            >
              {`Test order ${testOrderId} is ready. Tap a machine and pick it to unlock.`}
            </Notice>
          )}
          {action.error && <Notice tone="danger">{action.error}</Notice>}
        </Section>
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
  name: { flex: 1 },
});
