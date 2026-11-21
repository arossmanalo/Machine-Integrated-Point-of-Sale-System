import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { MachineRow } from '@/db/schema';
import { formatShopTime } from '@/domain/dates';
import { isRunning, MACHINE_TYPE_LABELS, TOP_UP_MINUTES, type MachineType } from '@/domain/machinePolicy';
import { formatPeso } from '@/domain/money';
import { can } from '@/domain/permissions';
import { isClosedStatus } from '@/domain/statuses';
import { lastStarts, listMachines, markRunDone, startMachine, testStart, topUpDryer, unassignMachine } from '@/services/machines';
import { createTestOrder, listOrderSummaries, voidOrder } from '@/services/orders';
import { useActor, useApp } from '@/state/AppProvider';
import { useAction, useData, useNow } from '@/state/hooks';
import { useToast } from '@/state/toast';
import { Button } from '@/ui/Button';
import { Badge, Dialog } from '@/ui/controls';
import { EmptyState, Notice, Panel, Row, Screen, Section } from '@/ui/layout';
import { OrderPickerDialog, OverrideDialog, useReportStart } from '@/ui/machines/MachineDialogs';
import { Text } from '@/ui/Text';
import { colors, MIN_TOUCH, radius, space } from '@/ui/theme';

/** Same order as in the shop, where dryers are stacked on top of washers. */
const SHOP_ROWS: readonly MachineType[] = ['DRYER', 'WASHER'];

/** "12:05" minutes and seconds left, rounded up so it never shows 0:00 while still running. */
function countdown(endsAt: number, now: number): string {
  const seconds = Math.max(0, Math.ceil((endsAt - now) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export default function Machines() {
  const actor = useActor();
  const { controller, controllerState } = useApp();
  const [picking, setPicking] = useState<MachineRow | null>(null);
  const [overriding, setOverriding] = useState<MachineRow | null>(null);
  const [toppingUp, setToppingUp] = useState<MachineRow | null>(null);
  const [testOrderId, setTestOrderId] = useState<string | null>(null);
  const action = useAction();
  const toast = useToast();
  const report = useReportStart();
  const now = useNow();
  const owner = can.manageMachines(actor.role);
  const data = useData((c) => {
    const machines = listMachines(c);
    const summaries = listOrderSummaries(c);
    const customers = new Map(summaries.map((s) => [s.order.id, s.customerName]));
    const openOrders = new Set(
      summaries.filter((s) => s.order.voidedAt === null && !isClosedStatus(s.order.status)).map((s) => s.order.id),
    );
    return { machines, customers, openOrders, last: lastStarts(c, machines.map((m) => m.id)) };
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

  async function finish(machine: MachineRow) {
    const result = await action.run((c) => markRunDone(c, machine.id));
    if (result.ok) toast(`${machine.name} marked as done`);
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

  const canTopUp = (machine: MachineRow) =>
    machine.type === 'DRYER' &&
    machine.enabled &&
    machine.topUpPrice > 0 &&
    machine.runOrderId !== null &&
    data.openOrders.has(machine.runOrderId);

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
                  const running = isRunning(machine, now);
                  const waiting = machine.assignedOrderId;
                  const runOrder = machine.runOrderId;
                  const last = data.last.get(machine.id);
                  const tappable = machine.enabled && !running && waiting === null;
                  const topUp = canTopUp(machine) && (
                    <Button
                      label={`Top up ${TOP_UP_MINUTES} min · ${formatPeso(machine.topUpPrice)}`}
                      kind={running ? 'secondary' : 'quiet'}
                      icon="timer-plus-outline"
                      onPress={() => setToppingUp(machine)}
                      busy={action.busy}
                    />
                  );
                  return (
                    <Pressable
                      key={machine.id}
                      accessibilityRole="button"
                      accessibilityLabel={`${machine.name}${machine.enabled ? '' : ', switched off'}${
                        running ? `, in use, ${countdown(machine.runEndsAt ?? now, now)} left` : ''
                      }`}
                      accessibilityHint={tappable ? 'Picks an order and starts this machine.' : undefined}
                      disabled={!tappable}
                      onPress={() => setPicking(machine)}
                      style={({ pressed }) => [
                        styles.tile,
                        running && styles.tileRunning,
                        waiting !== null && styles.tileWaiting,
                        pressed && { backgroundColor: colors.surfaceSunken },
                        !machine.enabled && styles.off,
                      ]}
                    >
                      <Row>
                        <MaterialCommunityIcons
                          name={type === 'WASHER' ? 'washing-machine' : 'tumble-dryer'}
                          size={28}
                          color={!machine.enabled ? colors.textMuted : running ? colors.warning : colors.accent}
                        />
                        <Text variant="bodyStrong" style={styles.name}>
                          {machine.name}
                        </Text>
                        {running ? (
                          <Badge label="In use" tone="warning" />
                        ) : waiting !== null ? (
                          <Badge label="Did not start" tone="danger" />
                        ) : machine.enabled ? (
                          <Badge label="Free" tone="success" />
                        ) : null}
                      </Row>
                      {running && machine.runEndsAt !== null && (
                        <>
                          <Text variant="figure" numeric>
                            {countdown(machine.runEndsAt, now)}
                          </Text>
                          <Text variant="caption" tone="muted">
                            {`${runOrder ? `${runOrder} · ${data.customers.get(runOrder) ?? ''} · ` : 'Override · '}done at ${formatShopTime(machine.runEndsAt)}`}
                          </Text>
                          <Row wrap>
                            {topUp}
                            <Button label="Mark as done" kind="quiet" onPress={() => void finish(machine)} busy={action.busy} />
                          </Row>
                        </>
                      )}
                      {!running && waiting !== null && (
                        <>
                          <Text variant="caption" tone="muted">
                            {`${waiting} · ${data.customers.get(waiting) ?? ''}. The start did not go out; try again.`}
                          </Text>
                          <Row wrap>
                            <Button label="Start machine" icon="play" onPress={() => void start(machine)} busy={action.busy} />
                            <Button label="Remove" kind="quiet" onPress={() => void remove(machine)} busy={action.busy} />
                          </Row>
                        </>
                      )}
                      {!running && waiting === null && (
                        <>
                          <Text variant="caption" tone="muted">
                            {!machine.enabled
                              ? 'Switched off'
                              : last
                                ? `Last run ${formatShopTime(last.at)} · ${last.orderId ?? (last.kind === 'TEST' ? 'test' : 'override')}. Tap to start an order.`
                                : 'Tap to start an order.'}
                          </Text>
                          <Row wrap>
                            {topUp}
                            {owner && machine.enabled && (
                              <Button
                                label="Test start"
                                kind="quiet"
                                icon="play-outline"
                                onPress={() => void test(machine)}
                                busy={action.busy}
                                accessibilityHint="Owner only. Sends this machine's pulses without an order and logs it as a test."
                              />
                            )}
                          </Row>
                        </>
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
          description="Only the owner sees this. Test start sends a machine's pulses without an order and sets no timer. To try the staff flow instead, create a test order and start a machine with it. Test orders are Pay later and take no supplies; void them when you are done."
        >
          {testOrderId === null ? (
            <Button label="Create test order" kind="secondary" icon="clipboard-plus-outline" onPress={makeTestOrder} busy={action.busy} />
          ) : (
            <Notice
              tone="info"
              action={<Button label="Void test order" kind="secondary" onPress={() => void voidTestOrder(testOrderId)} busy={action.busy} />}
            >
              {`Test order ${testOrderId} is ready. Tap a free machine and pick it to start that machine.`}
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
      {toppingUp && (
        <TopUpDialog
          machine={toppingUp}
          customerName={toppingUp.runOrderId ? (data.customers.get(toppingUp.runOrderId) ?? '') : ''}
          onClose={() => setToppingUp(null)}
        />
      )}
    </Screen>
  );
}

/** Top-ups cost money, so the charge is shown and confirmed before the pulses go out. */
function TopUpDialog({ machine, customerName, onClose }: { machine: MachineRow; customerName: string; onClose: () => void }) {
  const actor = useActor();
  const { controller } = useApp();
  const action = useAction();
  const report = useReportStart();

  async function topUp() {
    const result = await action.run((c) => topUpDryer(c, controller, actor, machine.id));
    if (!result.ok) return;
    report(result.value, `${machine.name} top-up`);
    if (result.value === 'acked' || result.value === 'timeout') onClose();
  }

  return (
    <Dialog
      visible
      title={`Top up ${machine.name}?`}
      onClose={onClose}
      actions={
        <>
          <Button label="Cancel" kind="secondary" onPress={onClose} />
          <Button
            label={`Add ${TOP_UP_MINUTES} min · ${formatPeso(machine.topUpPrice)}`}
            icon="timer-plus-outline"
            onPress={() => void topUp()}
            busy={action.busy}
          />
        </>
      }
    >
      <Text>{`${machine.runOrderId ?? ''} · ${customerName}`}</Text>
      <Text tone="muted">
        {`Adds ${TOP_UP_MINUTES} minutes of drying and ${formatPeso(machine.topUpPrice)} to this order's bill. ` +
          'The charge comes off again if the top-up does not reach the dryer.'}
      </Text>
      {action.error && <Notice tone="danger">{action.error}</Notice>}
    </Dialog>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  tile: {
    minHeight: MIN_TOUCH * 2.5,
    flexGrow: 1,
    flexBasis: 220,
    maxWidth: 320,
    padding: space.lg,
    gap: space.xs,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tileRunning: { borderColor: colors.warning, backgroundColor: colors.warningSoft },
  tileWaiting: { borderColor: colors.danger },
  off: { opacity: 0.55 },
  name: { flex: 1 },
});
