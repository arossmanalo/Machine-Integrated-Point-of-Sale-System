import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { MachineRow } from '@/db/schema';
import { formatShopDateTime } from '@/domain/dates';
import { MACHINE_TYPE_LABELS, type MachineType } from '@/domain/machinePolicy';
import { can } from '@/domain/permissions';
import { lastStarts, listMachines, startMachine, testStart, unassignMachine } from '@/services/machines';
import { createTestOrder, listOrderSummaries, voidOrder } from '@/services/orders';
import { useActor, useApp } from '@/state/AppProvider';
import { useAction, useData } from '@/state/hooks';
import { useToast } from '@/state/toast';
import { Button } from '@/ui/Button';
import { Badge } from '@/ui/controls';
import { EmptyState, Notice, Panel, Row, Screen, Section } from '@/ui/layout';
import { OrderPickerDialog, OverrideDialog, useReportStart } from '@/ui/machines/MachineDialogs';
import { Text } from '@/ui/Text';
import { colors, MIN_TOUCH, radius, space } from '@/ui/theme';

/** Same order as in the shop, where dryers are stacked on top of washers. */
const SHOP_ROWS: readonly MachineType[] = ['DRYER', 'WASHER'];

export default function Machines() {
  const actor = useActor();
  const { controller, controllerState } = useApp();
  const [picking, setPicking] = useState<MachineRow | null>(null);
  const [overriding, setOverriding] = useState<MachineRow | null>(null);
  const [testOrderId, setTestOrderId] = useState<string | null>(null);
  const action = useAction();
  const toast = useToast();
  const report = useReportStart();
  const owner = can.manageMachines(actor.role);
  const data = useData((c) => {
    const machines = listMachines(c);
    const customers = new Map(listOrderSummaries(c).map((s) => [s.order.id, s.customerName]));
    return { machines, customers, last: lastStarts(c, machines.map((m) => m.id)) };
  });

  async function start(machine: MachineRow) {
    const result = await action.run((c) => startMachine(c, controller, actor, machine.id));
    if (result.ok) report(result.value, machine.name);
  }

  async function test(machine: MachineRow) {
    const result = await action.run((c) => testStart(c, controller, actor, machine.id));
    if (result.ok) report(result.value, `${machine.name} (test)`);
  }

  async function remove(machine: MachineRow) {
    const result = await action.run((c) => unassignMachine(c, machine.id));
    if (result.ok) toast(`${machine.assignedOrderId ?? 'Order'} taken off ${machine.name}`);
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

  return (
    <Screen>
      {controllerState.status !== 'ready' && (
        <Notice
          tone="warning"
          action={<Button label="Reconnect" kind="secondary" onPress={() => void controller.connect()} />}
        >
          {controllerState.detail ?? 'The machine controller is not connected.'}
        </Notice>
      )}
      {controller.kind === 'mock' && (
        <Notice tone="info">Machines are simulated. No pulses go out. The owner can change this in Manage.</Notice>
      )}

      {data.machines.length === 0 ? (
        <Panel>
          <EmptyState
            icon="washing-machine"
            title="No machines set up"
            body="Add each washer and dryer with the machine controller channel it is wired to."
            action={owner ? <Button label="Set up machines" onPress={() => router.push('/manage/machines')} /> : undefined}
          />
        </Panel>
      ) : (
        SHOP_ROWS.map((type) => {
          const list = data.machines.filter((m) => m.type === type);
          if (list.length === 0) return null;
          return (
            <Section key={type} title={`${MACHINE_TYPE_LABELS[type]}s`}>
              <View style={styles.grid}>
                {list.map((machine) => {
                  const last = data.last.get(machine.id);
                  const assigned = machine.assignedOrderId;
                  return (
                    <Pressable
                      key={machine.id}
                      accessibilityRole="button"
                      accessibilityLabel={`${machine.name}${machine.enabled ? '' : ', switched off'}${assigned ? `, has ${assigned}` : ''}`}
                      accessibilityHint={assigned ? undefined : 'Assigns an order to this machine.'}
                      disabled={!machine.enabled || assigned !== null}
                      onPress={() => setPicking(machine)}
                      style={({ pressed }) => [
                        styles.tile,
                        assigned !== null && styles.tileAssigned,
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
                        {assigned !== null && <Badge label="Ready to start" tone="accent" />}
                      </Row>
                      <Text variant="caption" tone="muted">
                        {!machine.enabled
                          ? 'Switched off'
                          : assigned !== null
                            ? `${assigned} · ${data.customers.get(assigned) ?? ''}`
                            : last
                              ? `Last started ${formatShopDateTime(last.at)} · ${last.orderId ?? (last.kind === 'TEST' ? 'test' : 'override')}`
                              : 'Free. Tap to assign an order.'}
                      </Text>
                      {assigned !== null ? (
                        <Row wrap>
                          <Button label="Start machine" icon="play" onPress={() => void start(machine)} busy={action.busy} />
                          <Button label="Remove" kind="quiet" onPress={() => void remove(machine)} busy={action.busy} />
                        </Row>
                      ) : (
                        owner &&
                        machine.enabled && (
                          <Button
                            label="Test start"
                            kind="quiet"
                            icon="play-outline"
                            onPress={() => void test(machine)}
                            busy={action.busy}
                            accessibilityHint="Owner only. Sends this machine's pulses without an order and logs it as a test."
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
      {action.error && <Notice tone="danger">{action.error}</Notice>}
      {owner && data.machines.length > 0 && (
        <Section
          title="Testing"
          description="Only the owner sees this. Test start sends a machine's pulses without an order. To try the staff flow instead, create a test order, assign it to a machine and start it. Test orders are Pay later and take no supplies; void them when you are done."
        >
          {testOrderId === null ? (
            <Button label="Create test order" kind="secondary" icon="clipboard-plus-outline" onPress={makeTestOrder} busy={action.busy} />
          ) : (
            <Notice
              tone="info"
              action={<Button label="Void test order" kind="secondary" onPress={() => void voidTestOrder(testOrderId)} busy={action.busy} />}
            >
              {`Test order ${testOrderId} is ready. Tap a free machine and pick it, then Start machine.`}
            </Notice>
          )}
        </Section>
      )}
      {can.viewUnlockLog(actor.role) && data.machines.length > 0 && (
        <Button label="View machine log" kind="quiet" icon="history" onPress={() => router.push('/manage/unlock-log')} />
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
  tileAssigned: { borderColor: colors.accent },
  off: { opacity: 0.55 },
  name: { flex: 1 },
});
