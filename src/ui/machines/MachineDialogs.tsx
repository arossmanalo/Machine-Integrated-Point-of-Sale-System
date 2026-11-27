import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { MachineCycleRow, MachineRow } from '@/db/schema';
import { needsCyclePick } from '@/domain/cycles';
import { UserFacingError, type ServiceContext } from '@/db/types';
import {
  isRunning,
  MACHINE_TYPE_LABELS,
  machineAllowance,
  minutesLeft,
  minutesRunning,
  type MachineType,
} from '@/domain/machinePolicy';
import type { Earned } from '@/domain/machineEarnings';
import { formatPeso } from '@/domain/money';
import { parseReceiptCode } from '@/domain/receiptCode';
import { can } from '@/domain/permissions';
import { isClosedStatus } from '@/domain/statuses';
import type { StartResult } from '@/machines/MachineController';
import {
  checkReceiptFor,
  listMachines,
  machineEarningsFor,
  machineUsage,
  OVERRIDE_REASONS,
  overrideStart,
  prepaidTopUpForNextDryer,
  readReceiptCode,
  RESULT_MESSAGES,
  startOrderOnMachine,
  type OverrideReason,
} from '@/services/machines';
import { listCycles } from '@/services/cycles';
import { offeredTopUpsOf } from '@/services/topUps';
import { getOrderDetail, listOrderSummaries } from '@/services/orders';
import { getSetting } from '@/services/settings';
import { useActor, useApp } from '@/state/AppProvider';
import { useAction, useData, useNow } from '@/state/hooks';
import { useToast } from '@/state/toast';

import { Button } from '../Button';
import { Choice, Dialog } from '../controls';
import { EmptyState, ListRow, Notice, Panel, Row, Stat } from '../layout';
import { Text } from '../Text';
import { TextField } from '../TextField';
import { colors, MIN_TOUCH, radius, space } from '../theme';

import { ReceiptScanner } from './ReceiptScanner';

/**
 * The cycles staff pick from on a machine: a Multi-cycle washer's cycles that are switched on,
 * or none (the machine then starts with its own pulses and run time).
 */
export function useCyclePicker(): (machine: MachineRow) => MachineCycleRow[] {
  const multiCycle = useData((c) => getSetting(c.db, 'multiCycle'));
  const cycles = useData((c) => listCycles(c));
  return (machine) => {
    const enabled = cycles.filter((cycle) => cycle.machineId === machine.id && cycle.enabled);
    return needsCyclePick(multiCycle, machine.type, enabled.length) ? enabled : [];
  };
}

export function useReportStart() {
  const toast = useToast();
  return (result: StartResult, machineName: string) => {
    if (result === 'acked') toast(`${machineName} started`);
    else toast(`${machineName}: ${RESULT_MESSAGES[result]}`, 'danger');
  };
}

function loadsNote(earned: Earned): string {
  return `${earned.loads} load${earned.loads === 1 ? '' : 's'}`;
}

/**
 * What a machine has earned: half the price per load for each wash or dry it ran for an order.
 * Managers only, like every other money figure.
 */
export function MachineEarningsStats({ machine }: { machine: MachineRow }) {
  const actor = useActor();
  const earnings = useData((c) => machineEarningsFor(c, machine.id), [machine.id]);
  if (!can.seeRevenue(actor.role)) return null;
  return (
    <Row wrap style={{ alignItems: 'flex-start' }}>
      <Stat label="Earned today" value={formatPeso(earnings.today.amount)} note={loadsNote(earnings.today)} />
      <Stat label="This month" value={formatPeso(earnings.month.amount)} note={loadsNote(earnings.month)} />
      <Stat label="All time" value={formatPeso(earnings.allTime.amount)} note={loadsNote(earnings.allTime)} />
    </Row>
  );
}

/** For a machine that cannot take an order right now (in use, waiting, switched off). */
export function MachineEarningsDialog({ machine, onClose }: { machine: MachineRow; onClose: () => void }) {
  return (
    <Dialog
      visible
      title={`${machine.name} earnings`}
      onClose={onClose}
      actions={<Button label="Close" kind="secondary" onPress={onClose} />}
    >
      <MachineEarningsStats machine={machine} />
      <Text tone="muted">
        A rough figure: half the price per load for each order this machine ran. Top-ups, overrides, tests and voided
        orders are not counted.
      </Text>
    </Dialog>
  );
}

/** Dryers sit on top of washers in the shop, so the window shows them in that order. */
const SHOP_ROWS: readonly MachineType[] = ['DRYER', 'WASHER'];

function machineIcon(type: MachineType) {
  return type === 'WASHER' ? 'washing-machine' : 'tumble-dryer';
}

/** The one question before pulses go out (after the receipt scan), so a stray tap cannot start the wrong machine. */
/** With Multi-cycle on, a washer's cycle is picked here; null until staff pick one. */
function ConfirmStart({
  machine,
  orderId,
  customerName,
  cycles,
  cycleId,
  onCycle,
  topUp,
  onTopUp,
}: {
  machine: MachineRow;
  orderId: string;
  customerName: string;
  cycles: readonly MachineCycleRow[];
  cycleId: number | null;
  onCycle: (cycleId: number) => void;
  topUp: number | null;
  onTopUp: (topUpId: number | null) => void;
}) {
  // Dryers: a top-up paid with the order goes out with this start; otherwise staff may add one.
  const prepaid = useData((c) => prepaidTopUpForNextDryer(c, orderId), [orderId]);
  const dryer = machine.type === 'DRYER';
  const offered = useData((c) => (dryer ? offeredTopUpsOf(c.db, machine.id) : []), [machine.id, dryer]);
  const options = dryer && prepaid === null ? offered.filter((option) => option.price > 0) : [];
  const chosenTopUp = options.find((option) => option.id === topUp) ?? null;
  const extra = dryer ? (prepaid ?? chosenTopUp?.minutes ?? 0) : 0;
  const cycle = cycles.find((option) => option.id === cycleId) ?? null;
  const base = cycles.length > 0 ? (cycle?.minutes ?? null) : machine.runMinutes;
  const minutes = base === null ? null : base + extra;
  return (
    <View style={styles.confirm}>
      <MaterialCommunityIcons name={machineIcon(machine.type)} size={40} color={colors.accent} />
      <Text variant="heading">{`Run ${machine.name} for ${orderId}?`}</Text>
      <Text>{customerName}</Text>
      {cycles.length > 0 && (
        <Choice
          label="Cycle"
          value={cycleId === null ? '' : String(cycleId)}
          onChange={(value) => onCycle(Number(value))}
          options={cycles.map((option) => ({ value: String(option.id), label: `${option.name} · ${option.minutes} min` }))}
        />
      )}
      {dryer && prepaid !== null && (
        <Text tone="success">{`Top-up paid ahead: ${prepaid} extra minutes go out with this start.`}</Text>
      )}
      {options.length > 0 && (
        <Choice
          label="Top-up"
          value={topUp === null ? 'none' : String(topUp)}
          onChange={(value) => onTopUp(value === 'none' ? null : Number(value))}
          options={[
            { value: 'none', label: 'None' },
            ...options.map((option) => ({
              value: String(option.id),
              label: `${option.name} · ${option.minutes} min · ${formatPeso(option.price)}`,
            })),
          ]}
        />
      )}
      <Text tone="muted">
        {minutes === null
          ? 'Pick the cycle for this load, then tap Run machine.'
          : `Load the laundry and close the door first. ${machine.name} starts as soon as you tap Run machine and runs for ` +
            `${minutes} minutes.`}
      </Text>
    </View>
  );
}

/**
 * From an order: pick a machine and start it. Shows the registered dryers on top and washers
 * below, the way they are stacked in the shop.
 */
export function StartMachineDialog({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const actor = useActor();
  const { controller, ctx } = useApp();
  const action = useAction();
  const report = useReportStart();
  const now = useNow(15000);
  const [chosen, setChosen] = useState<MachineRow | null>(null);
  const [receiptCode, setReceiptCode] = useState<string | null>(null);
  const scanOn = useData((c) => getSetting(c.db, 'requireReceiptScan'));
  const cyclesFor = useCyclePicker();
  const [cycleId, setCycleId] = useState<number | null>(null);
  const [topUp, setTopUp] = useState<number | null>(null);
  const [overriding, setOverriding] = useState<{ machine: MachineRow; code: string | null } | null>(null);
  const chosenCycles = chosen ? cyclesFor(chosen) : [];
  const usesCycles = chosenCycles.length > 0;
  const needScan = scanOn && receiptCode === null;
  const data = useData(
    (c) => {
      const detail = getOrderDetail(c, orderId);
      return {
        machines: listMachines(c),
        usage: machineUsage(c, orderId),
        allowance: {
          WASHER: detail ? machineAllowance(detail.order, 'WASHER') : 0,
          DRYER: detail ? machineAllowance(detail.order, 'DRYER') : 0,
        },
        customerName: detail?.customerName ?? '',
      };
    },
    [orderId],
  );

  function back() {
    action.clearError();
    setCycleId(null);
    setTopUp(null);
    setChosen(null);
    setReceiptCode(null);
  }

  async function start(machine: MachineRow) {
    const result = await action.run((c) =>
      startOrderOnMachine(c, controller, actor, orderId, machine.id, receiptCode, usesCycles ? cycleId : null, topUp),
    );
    if (!result.ok) return;
    report(result.value, machine.name);
    back();
    if (result.value === 'acked' || result.value === 'timeout') onClose();
  }

  /** The order's own receipt runs it; its override receipt goes to the override instead. */
  function checkScan(c: ServiceContext, scanned: string) {
    const receipt = readReceiptCode(c, scanned);
    if (receipt.kind === 'override' && receipt.orderId === orderId) return;
    checkReceiptFor(c, scanned, orderId);
  }

  function scanned(code: string) {
    if (chosen && readReceiptCode(ctx, code).kind === 'override') {
      setOverriding({ machine: chosen, code });
      return;
    }
    setReceiptCode(code);
  }

  function choose(machine: MachineRow) {
    action.clearError();
    // An order whose runs of this type are used up can only run it by override.
    if (data.usage[machine.type] >= data.allowance[machine.type]) setOverriding({ machine, code: null });
    else setChosen(machine);
  }

  const actions = chosen ? (
    <>
      <Button label="Back" kind="secondary" onPress={back} />
      <Button
        label="Owner override"
        kind="secondary"
        icon="shield-key-outline"
        onPress={() => setOverriding({ machine: chosen, code: null })}
      />
      {!needScan && (
        <Button
          label="Run machine"
          icon="play"
          onPress={() => void start(chosen)}
          busy={action.busy}
          disabled={usesCycles && cycleId === null}
        />
      )}
    </>
  ) : (
    <Button label="Close" kind="secondary" onPress={onClose} />
  );

  return (
    <Dialog visible title={`Assign a machine to ${orderId}`} onClose={onClose} actions={actions}>
      {chosen && needScan ? (
        <ReceiptScanner
          prompt={`Scan the receipt for ${orderId} to run ${chosen.name}.`}
          check={checkScan}
          onAccepted={scanned}
        />
      ) : chosen ? (
        <ConfirmStart
          machine={chosen}
          orderId={orderId}
          customerName={data.customerName}
          cycles={chosenCycles}
          cycleId={cycleId}
          onCycle={setCycleId}
          topUp={topUp}
          onTopUp={setTopUp}
        />
      ) : (
        <>
          <Text tone="muted">
            {data.allowance.WASHER === 0
              ? `Dry only: each load allows one dryer. Used: ${data.usage.DRYER} of ${data.allowance.DRYER} dryers.`
              : `Each load allows one washer and one dryer. Used: ${data.usage.WASHER} of ${data.allowance.WASHER} washers, ` +
                `${data.usage.DRYER} of ${data.allowance.DRYER} dryers.`}
          </Text>
          {data.machines.length === 0 ? (
            <EmptyState
              icon="washing-machine-off"
              title="No machines set up"
              body="The owner adds machines in Manage, Machines."
            />
          ) : (
            SHOP_ROWS.map((type) => {
              const row = data.machines.filter((m) => m.type === type);
              if (row.length === 0) return null;
              return (
                <View key={type} style={styles.shopRow}>
                  <Text variant="label" tone="muted">{`${MACHINE_TYPE_LABELS[type]}s`}</Text>
                  <View style={styles.tiles}>
                    {row.map((machine) => (
                      <MachineTile
                        key={machine.id}
                        machine={machine}
                        orderId={orderId}
                        now={now}
                        busy={action.busy}
                        onChoose={() => choose(machine)}
                      />
                    ))}
                  </View>
                </View>
              );
            })
          )}
        </>
      )}
      {action.error && <Notice tone="danger">{action.error}</Notice>}
      {overriding && (
        <OverrideDialog
          machine={overriding.machine}
          orderId={orderId}
          scannedCode={overriding.code}
          onClose={() => {
            setOverriding(null);
            back();
          }}
        />
      )}
    </Dialog>
  );
}

function MachineTile({
  machine,
  orderId,
  now,
  busy,
  onChoose,
}: {
  machine: MachineRow;
  orderId: string;
  now: number;
  busy: boolean;
  onChoose: () => void;
}) {
  const running = isRunning(machine, now);
  const waitingOther = machine.assignedOrderId !== null && machine.assignedOrderId !== orderId;
  const mine = machine.assignedOrderId === orderId;
  const free = machine.enabled && !running && !waitingOther;
  const state = !machine.enabled
    ? 'Switched off'
    : running
      ? `In use, ${
          machine.signalSince !== null
            ? `running ${minutesRunning(machine, now)} min`
            : `${minutesLeft(machine, now)} min left`
        }${machine.runOrderId ? ` · ${machine.runOrderId}` : ''}`
      : waitingOther
        ? `Waiting to start ${machine.assignedOrderId}`
        : mine
          ? 'Did not start yet. Tap to try again.'
          : 'Free';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${machine.name}, ${state}`}
      disabled={!free || busy}
      onPress={onChoose}
      style={({ pressed }) => [
        styles.tile,
        mine && styles.tileMine,
        !free && styles.tileOff,
        pressed && { backgroundColor: colors.surfaceSunken },
      ]}
    >
      <MaterialCommunityIcons
        name={machineIcon(machine.type)}
        size={28}
        color={free ? colors.accent : colors.textMuted}
      />
      <Text variant="bodyStrong">{machine.name}</Text>
      <Text variant="caption" tone={running ? 'warning' : mine ? 'accent' : 'muted'}>
        {state}
      </Text>
    </Pressable>
  );
}

/**
 * From the machine grid: scan the order's receipt, which picks the order, confirm, and start.
 * The temporary test code names no order, so after it staff pick the order from the list.
 */
export function OrderPickerDialog({
  machine,
  onClose,
  onOverride,
}: {
  machine: MachineRow;
  onClose: () => void;
  /** The order and override receipt, when the scan named them. */
  onOverride: (orderId: string | null, code: string | null) => void;
}) {
  const actor = useActor();
  const { controller, ctx } = useApp();
  const action = useAction();
  const report = useReportStart();
  const [chosen, setChosen] = useState<{ orderId: string; customerName: string } | null>(null);
  const [receiptCode, setReceiptCode] = useState<string | null>(null);
  const scanOn = useData((c) => getSetting(c.db, 'requireReceiptScan'));
  const cyclesFor = useCyclePicker();
  const [cycleId, setCycleId] = useState<number | null>(null);
  const [topUp, setTopUp] = useState<number | null>(null);
  const machineCycles = cyclesFor(machine);
  const usesCycles = machineCycles.length > 0;
  const candidates = useData(
    (c) =>
      listOrderSummaries(c)
        .filter((s) => s.order.voidedAt === null && !isClosedStatus(s.order.status))
        .map((s) => ({
          summary: s,
          allowance: machineAllowance(s.order, machine.type),
          used: machineUsage(c, s.order.id)[machine.type],
        }))
        .filter((row) => row.used < row.allowance),
    [machine.type],
  );

  const label = MACHINE_TYPE_LABELS[machine.type].toLowerCase();

  function back() {
    action.clearError();
    setCycleId(null);
    setTopUp(null);
    setChosen(null);
    setReceiptCode(null);
  }

  /**
   * A receipt picks its order straight away; it must be an open order with this machine type left.
   * An override receipt, or the receipt of an open order whose runs are used up, goes to the override.
   */
  function checkScan(c: ServiceContext, scanned: string) {
    const receipt = readReceiptCode(c, scanned);
    if (receipt.kind === 'test' || receipt.kind === 'override') return;
    const row = candidates.find((r) => r.summary.order.id === receipt.orderId);
    if (!row && usedUp(c, receipt.orderId)) return;
    if (!row) {
      throw new UserFacingError(
        `${receipt.orderId} cannot use a ${label}: it is voided or closed, or it has used all its ${label}s.`,
      );
    }
  }

  /** An open order that has used all its runs of this machine type. */
  function usedUp(c: ServiceContext, orderId: string): boolean {
    const detail = getOrderDetail(c, orderId);
    if (!detail || detail.order.voidedAt !== null || isClosedStatus(detail.order.status)) return false;
    return machineUsage(c, orderId)[machine.type] >= machineAllowance(detail.order, machine.type);
  }

  function accepted(scanned: string) {
    const receipt = readReceiptCode(ctx, scanned);
    if (receipt.kind === 'override') {
      onOverride(receipt.orderId, scanned);
      return;
    }
    if (receipt.kind === 'order' && usedUp(ctx, receipt.orderId)) {
      onOverride(receipt.orderId, null);
      return;
    }
    setReceiptCode(scanned);
    if (receipt.kind === 'order') {
      const row = candidates.find((r) => r.summary.order.id === receipt.orderId);
      setChosen({ orderId: receipt.orderId, customerName: row?.summary.customerName ?? '' });
    }
  }

  async function start(orderId: string) {
    const result = await action.run((c) =>
      startOrderOnMachine(c, controller, actor, orderId, machine.id, receiptCode, usesCycles ? cycleId : null, topUp),
    );
    if (!result.ok) return;
    report(result.value, machine.name);
    if (result.value === 'acked' || result.value === 'timeout') onClose();
    else back();
  }

  const actions = chosen ? (
    <>
      <Button label="Back" kind="secondary" onPress={back} />
      <Button
        label="Run machine"
        icon="play"
        onPress={() => void start(chosen.orderId)}
        busy={action.busy}
        disabled={usesCycles && cycleId === null}
      />
    </>
  ) : (
    <>
      <Button label="Owner override" kind="secondary" icon="shield-key-outline" onPress={() => onOverride(null, null)} />
      <Button label="Close" kind="secondary" onPress={onClose} />
    </>
  );
  return (
    <Dialog visible title={`Assign an order to ${machine.name}`} onClose={onClose} actions={actions}>
      {!chosen && <MachineEarningsStats machine={machine} />}
      {chosen ? (
        <ConfirmStart
          machine={machine}
          orderId={chosen.orderId}
          customerName={chosen.customerName}
          cycles={machineCycles}
          cycleId={cycleId}
          onCycle={setCycleId}
          topUp={topUp}
          onTopUp={setTopUp}
        />
      ) : scanOn && receiptCode === null ? (
        <ReceiptScanner
          prompt={`Scan the order receipt to run ${machine.name}. No receipt, no start.`}
          check={checkScan}
          onAccepted={accepted}
        />
      ) : (
        <>
          <Text tone="muted">
            {scanOn
              ? 'Test code scanned. Pick the order this load belongs to.'
              : 'Pick the order this load belongs to. No order, no start.'}
          </Text>
          {candidates.length === 0 ? (
            <EmptyState
              icon="receipt-text-outline"
              title={`No open orders need a ${label}`}
              body="Take the order first with New order. For a rewash or a machine that did not start, use the owner override."
            />
          ) : (
            <Panel>
              {candidates.slice(0, 12).map(({ summary, allowance, used }, index, list) => (
                <ListRow
                  key={summary.order.id}
                  title={summary.customerName}
                  subtitle={`${summary.order.id} · ${used} of ${allowance} ${label}s used`}
                  meta={
                    summary.balance > 0 ? (
                      <Text variant="caption" tone="warning">
                        Not fully paid
                      </Text>
                    ) : undefined
                  }
                  onPress={() => {
                    action.clearError();
                    setChosen({ orderId: summary.order.id, customerName: summary.customerName });
                  }}
                  last={index === list.length - 1}
                />
              ))}
            </Panel>
          )}
        </>
      )}
      {action.error && <Notice tone="danger">{action.error}</Notice>}
    </Dialog>
  );
}

type OverrideMethod = 'pin' | 'receipt';

/** The order an override receipt is for; null for any other code. Throws for a spent override receipt. */
function readOverrideOrder(c: ServiceContext, scanned: string): string | null {
  const receipt = readReceiptCode(c, scanned);
  return receipt.kind === 'override' ? receipt.orderId : null;
}

/**
 * Override start for rewashes, a machine that did not start, an order whose runs are used up, and
 * maintenance. Allowed by the owner PIN or by scanning the order's one-time override receipt.
 * Always logged.
 */
export function OverrideDialog({
  machine,
  orderId = null,
  scannedCode = null,
  onClose,
}: {
  machine: MachineRow;
  /** The order the start is for, when known. */
  orderId?: string | null;
  /** An override receipt already scanned elsewhere. */
  scannedCode?: string | null;
  onClose: () => void;
}) {
  const actor = useActor();
  const { controller } = useApp();
  const action = useAction();
  const report = useReportStart();
  const [method, setMethod] = useState<OverrideMethod>(scannedCode ? 'receipt' : 'pin');
  const [code, setCode] = useState<string | null>(scannedCode);
  const [reason, setReason] = useState<OverrideReason>('Rewash');
  const [note, setNote] = useState('');
  const [pin, setPin] = useState('');
  const cycles = useCyclePicker()(machine);
  const [cycleId, setCycleId] = useState<number | null>(cycles[0]?.id ?? null);
  // Parsed without the database: once the start uses the code up, reading it there would fail.
  const parsedCode = code ? parseReceiptCode(code) : null;
  const codeOrder = parsedCode?.kind === 'override' ? parsedCode.orderId : null;
  const forOrder = codeOrder ?? orderId;

  /** The scanner accepts only an override receipt, and only the one for this order when known. */
  function checkCode(c: ServiceContext, scanned: string) {
    const scannedOrder = readOverrideOrder(c, scanned);
    if (scannedOrder === null) {
      throw new UserFacingError("That is not an override receipt. Scan the owner's override receipt or use the PIN.");
    }
    if (orderId !== null && scannedOrder !== orderId) {
      throw new UserFacingError(`This override receipt is for ${scannedOrder}, not ${orderId}.`);
    }
  }

  async function submit() {
    const overrideCode = method === 'receipt' ? code : null;
    const result = await action.run((c) =>
      overrideStart(c, controller, actor, { machineId: machine.id, pin, overrideCode, reason, note, orderId, cycleId }),
    );
    setPin('');
    if (!result.ok) {
      setCode(null);
      return;
    }
    report(result.value, machine.name);
    if (result.value === 'acked' || result.value === 'timeout') onClose();
  }

  const ready = method === 'pin' ? pin.length >= 4 : code !== null;

  return (
    <Dialog
      visible
      title={`Owner override: ${machine.name}`}
      onClose={onClose}
      actions={
        <>
          <Button label="Cancel" kind="secondary" onPress={onClose} />
          <Button
            label={method === 'pin' ? 'Start with PIN' : 'Start machine'}
            icon="play"
            onPress={submit}
            busy={action.busy}
            disabled={!ready}
          />
        </>
      }
    >
      <Text tone="muted">
        {forOrder
          ? `Starts ${machine.name} for ${forOrder} outside its runs, even while it is in use. This start is recorded with your name.`
          : 'Starts the machine without an order, even while it is in use. This start and any wrong PIN are recorded with your name.'}
      </Text>
      <Choice
        label="Allow it with"
        value={method}
        onChange={(value) => {
          action.clearError();
          setMethod(value);
        }}
        options={[
          { value: 'pin', label: 'Owner PIN' },
          { value: 'receipt', label: 'Override receipt' },
        ]}
      />
      {method === 'receipt' &&
        (code ? (
          <Notice tone="success">{`Override receipt for ${codeOrder ?? 'the order'} scanned. It allows this one start.`}</Notice>
        ) : (
          <ReceiptScanner
            prompt="Scan the override receipt the owner printed for this order."
            check={checkCode}
            onAccepted={setCode}
          />
        ))}
      <Choice
        label="Reason"
        value={reason}
        onChange={setReason}
        options={OVERRIDE_REASONS.map((r) => ({ value: r, label: r }))}
      />
      {cycles.length > 0 && (
        <Choice
          label="Cycle"
          value={cycleId === null ? '' : String(cycleId)}
          onChange={(value) => setCycleId(Number(value))}
          options={cycles.map((cycle) => ({ value: String(cycle.id), label: `${cycle.name} · ${cycle.minutes} min` }))}
        />
      )}
      <TextField
        label={reason === 'Other' ? 'What happened?' : 'Note (optional)'}
        value={note}
        onChangeText={setNote}
        multiline
      />
      {method === 'pin' && (
        <TextField
          label="Owner PIN"
          value={pin}
          onChangeText={(text) => setPin(text.replace(/\D/g, ''))}
          keyboardType="number-pad"
          secureTextEntry
          maxLength={6}
        />
      )}
      {action.error && <Notice tone="danger">{action.error}</Notice>}
    </Dialog>
  );
}

const styles = StyleSheet.create({
  shopRow: { gap: space.sm },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tile: {
    minHeight: MIN_TOUCH * 2,
    flexBasis: 150,
    flexGrow: 1,
    maxWidth: 220,
    padding: space.md,
    gap: space.xs,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tileMine: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  tileOff: { opacity: 0.55 },
  confirm: { gap: space.sm, paddingVertical: space.sm },
});
