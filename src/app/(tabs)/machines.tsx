import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { MachineRow } from '@/db/schema';
import type { ServiceContext } from '@/db/types';
import { formatShopTime } from '@/domain/dates';
import {
  isRunning,
  isTopUpMinutes,
  MACHINE_TYPE_LABELS,
  TOP_UP_CHOICES,
  topUpOptions,
  topUpPulseCountFor,
  type MachineType,
  type TopUpMinutes,
} from '@/domain/machinePolicy';
import { formatPeso } from '@/domain/money';
import { can } from '@/domain/permissions';
import { isClosedStatus } from '@/domain/statuses';
import type { StartResult } from '@/machines/MachineController';
import {
  lastStarts,
  listMachines,
  markRunDone,
  startMachine,
  testStart,
  testTopUp,
  topUpDryer,
  unassignMachine,
} from '@/services/machines';
import { createTestOrder, listOrderSummaries, voidOrder } from '@/services/orders';
import { useActor, useApp } from '@/state/AppProvider';
import { useAction, useData, useNow } from '@/state/hooks';
import { useToast } from '@/state/toast';
import { Button } from '@/ui/Button';
import { Badge, Choice, Dialog, Toggle } from '@/ui/controls';
import { EmptyState, Notice, Panel, Row, Screen, Section } from '@/ui/layout';
import {
  MachineEarningsDialog,
  OrderPickerDialog,
  OverrideDialog,
  useCyclePicker,
  useReportStart,
} from '@/ui/machines/MachineDialogs';
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
  const [testingCycles, setTestingCycles] = useState<MachineRow | null>(null);
  const cyclesFor = useCyclePicker();
  const [viewingEarnings, setViewingEarnings] = useState<MachineRow | null>(null);
  const [testOrderId, setTestOrderId] = useState<string | null>(null);
  const action = useAction();
  const toast = useToast();
  const report = useReportStart();
  const now = useNow();
  const owner = can.manageMachines(actor.role);
  const seesEarnings = can.seeRevenue(actor.role);
  // Off by default so the owner sees the same screen as staff. Tied to the user who turned it on,
  // so it is off again for the next login on this tablet.
  const [testingBy, setTestingBy] = useState<string | null>(null);
  const testing = owner && testingBy === actor.id;
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
    // Dryers (start or a top-up) and multi-cycle washers ask what to send first.
    if (machine.type === 'DRYER' || cyclesFor(machine).length > 0) {
      setTestingCycles(machine);
      return;
    }
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

  // Only while the dryer still runs: once its timer ends or it is marked as done, the top-up goes.
  const canTopUp = (machine: MachineRow) =>
    machine.type === 'DRYER' &&
    machine.enabled &&
    isRunning(machine, now) &&
    topUpOptions(machine).length > 0 &&
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
                      label="Top up"
                      kind="secondary"
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
                      accessibilityHint={
                        tappable
                          ? 'Picks an order and starts this machine.'
                          : seesEarnings
                            ? "Shows this machine's earnings."
                            : undefined
                      }
                      disabled={!tappable && !seesEarnings}
                      onPress={() => (tappable ? setPicking(machine) : setViewingEarnings(machine))}
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
                            {`${waiting} · ${data.customers.get(waiting) ?? ''}. It did not run; tap Run machine to try again.`}
                          </Text>
                          <Row wrap>
                            <Button label="Run machine" icon="play" onPress={() => void start(machine)} busy={action.busy} />
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
                            {testing && machine.enabled && (
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
        <Section title="Testing">
          <Toggle
            label="Testing mode"
            description={
              testing
                ? "Test start sends a machine's pulses without an order and sets no timer. To try the staff flow instead, create a test order and start a machine with it. Test orders are Pay later and take no supplies; void them when you are done."
                : 'Only the owner sees this. Turn it on to show Test start on each machine and to make test orders.'
            }
            value={testing}
            onChange={(on) => setTestingBy(on ? actor.id : null)}
          />
          {testing && testOrderId === null && (
            <Button label="Create test order" kind="secondary" icon="clipboard-plus-outline" onPress={makeTestOrder} busy={action.busy} />
          )}
          {testOrderId !== null && (
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
      {viewingEarnings && <MachineEarningsDialog machine={viewingEarnings} onClose={() => setViewingEarnings(null)} />}
      {overriding && <OverrideDialog machine={overriding} onClose={() => setOverriding(null)} />}
      {testingCycles && (
        <TestMachineDialog machine={testingCycles} onClose={() => setTestingCycles(null)} />
      )}
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
/**
 * Testing mode: pick what to send. Washers with Multi-cycle test each cycle; dryers test their
 * start and each top-up length. Nothing is charged and no countdown is set, so tests can follow
 * one another straight away.
 */
function TestMachineDialog({
  machine,
  onClose,
}: {
  machine: MachineRow;
  onClose: () => void;
}) {
  const actor = useActor();
  const { controller } = useApp();
  const action = useAction();
  const report = useReportStart();
  const cycles = useCyclePicker()(machine);
  const plural = (count: number) => `${count} pulse${count === 1 ? '' : 's'}`;
  const options: { value: string; label: string; send: (c: ServiceContext) => Promise<StartResult> }[] =
    machine.type === 'DRYER'
      ? [
          {
            value: 'start',
            label: `Start · ${plural(machine.pulseCount)}`,
            send: (c) => testStart(c, controller, actor, machine.id),
          },
          ...TOP_UP_CHOICES.map((minutes) => ({
            value: String(minutes),
            label: `Top-up ${minutes} min · ${plural(topUpPulseCountFor(machine, minutes))}`,
            send: (c: ServiceContext) => testTopUp(c, controller, actor, machine.id, minutes),
          })),
        ]
      : cycles.length > 0
        ? cycles.map((cycle) => ({
            value: String(cycle.id),
            label: `${cycle.name} · ${plural(cycle.pulses)}`,
            send: (c: ServiceContext) => testStart(c, controller, actor, machine.id, cycle.id),
          }))
        : [
            {
              value: 'start',
              label: `Start · ${plural(machine.pulseCount)}`,
              send: (c: ServiceContext) => testStart(c, controller, actor, machine.id),
            },
          ];
  const [chosen, setChosen] = useState(options[0]?.value ?? 'start');
  const option = options.find((o) => o.value === chosen) ?? options[0];

  async function send() {
    if (!option) return;
    const result = await action.run((c) => option.send(c));
    if (result.ok) report(result.value, `${machine.name} ${option.label.split(' · ')[0]} (test)`);
  }

  return (
    <Dialog
      visible
      title={`Test ${machine.name}`}
      onClose={onClose}
      actions={
        <>
          <Button label="Close" kind="secondary" onPress={onClose} />
          <Button
            label={`Send ${option?.label.split(' · ')[0] ?? 'test'}`}
            icon="play-outline"
            onPress={() => void send()}
            busy={action.busy}
          />
        </>
      }
    >
      <Choice
        label={machine.type === 'DRYER' ? 'What to test' : 'Cycle'}
        value={chosen}
        onChange={setChosen}
        options={options.map((o) => ({ value: o.value, label: o.label }))}
      />
      <Text tone="muted">
        Sends these pulses without an order and logs it as a test. Nothing is charged and no countdown is set, so you can
        send the next test straight away.
      </Text>
      {action.error && <Notice tone="danger">{action.error}</Notice>}
    </Dialog>
  );
}

function TopUpDialog({ machine, customerName, onClose }: { machine: MachineRow; customerName: string; onClose: () => void }) {
  const actor = useActor();
  const { controller } = useApp();
  const action = useAction();
  const report = useReportStart();
  const options = topUpOptions(machine);
  const [minutes, setMinutes] = useState<TopUpMinutes>(options[0]?.minutes ?? 5);
  const price = options.find((option) => option.minutes === minutes)?.price ?? 0;

  async function topUp() {
    const result = await action.run((c) => topUpDryer(c, controller, actor, machine.id, minutes));
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
            label={`Add ${minutes} min · ${formatPeso(price)}`}
            icon="timer-plus-outline"
            onPress={() => void topUp()}
            busy={action.busy}
            disabled={price <= 0}
          />
        </>
      }
    >
      <Text>{`${machine.runOrderId ?? ''} · ${customerName}`}</Text>
      <Choice
        label="Extra drying time"
        value={String(minutes)}
        onChange={(value) => {
          const chosen = Number(value);
          if (isTopUpMinutes(chosen)) setMinutes(chosen);
        }}
        options={options.map((option) => ({
          value: String(option.minutes),
          label: `${option.minutes} min · ${formatPeso(option.price)}`,
        }))}
      />
      <Text tone="muted">
        {`Adds ${minutes} minutes to the countdown and ${formatPeso(price)} to this order's bill. ` +
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
