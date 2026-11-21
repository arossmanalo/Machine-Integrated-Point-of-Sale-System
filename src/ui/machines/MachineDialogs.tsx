import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { MachineRow } from '@/db/schema';
import { isRunning, MACHINE_TYPE_LABELS, machineAllowance, minutesLeft, type MachineType } from '@/domain/machinePolicy';
import { isClosedStatus } from '@/domain/statuses';
import type { StartResult } from '@/machines/MachineController';
import {
  listMachines,
  machineUsage,
  OVERRIDE_REASONS,
  overrideStart,
  RESULT_MESSAGES,
  startOrderOnMachine,
  type OverrideReason,
} from '@/services/machines';
import { getOrderDetail, listOrderSummaries } from '@/services/orders';
import { useActor, useApp } from '@/state/AppProvider';
import { useAction, useData, useNow } from '@/state/hooks';
import { useToast } from '@/state/toast';

import { Button } from '../Button';
import { Choice, Dialog } from '../controls';
import { EmptyState, ListRow, Notice, Panel } from '../layout';
import { Text } from '../Text';
import { TextField } from '../TextField';
import { colors, MIN_TOUCH, radius, space } from '../theme';

export function useReportStart() {
  const toast = useToast();
  return (result: StartResult, machineName: string) => {
    if (result === 'acked') toast(`${machineName} started`);
    else toast(`${machineName}: ${RESULT_MESSAGES[result]}`, 'danger');
  };
}

/** Dryers sit on top of washers in the shop, so the window shows them in that order. */
const SHOP_ROWS: readonly MachineType[] = ['DRYER', 'WASHER'];

function machineIcon(type: MachineType) {
  return type === 'WASHER' ? 'washing-machine' : 'tumble-dryer';
}

/** The one question before pulses go out, so a stray tap cannot start the wrong machine. */
function ConfirmStart({ machine, orderId, customerName }: { machine: MachineRow; orderId: string; customerName: string }) {
  return (
    <View style={styles.confirm}>
      <MaterialCommunityIcons name={machineIcon(machine.type)} size={40} color={colors.accent} />
      <Text variant="heading">{`Start ${machine.name} for ${orderId}?`}</Text>
      <Text>{customerName}</Text>
      <Text tone="muted">
        {`Load the laundry and close the door first. ${machine.name} starts as soon as you tap Start and runs for ` +
          `${machine.runMinutes} minutes.`}
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
  const { controller } = useApp();
  const action = useAction();
  const report = useReportStart();
  const now = useNow(15000);
  const [chosen, setChosen] = useState<MachineRow | null>(null);
  const data = useData(
    (c) => {
      const detail = getOrderDetail(c, orderId);
      return {
        machines: listMachines(c),
        usage: machineUsage(c, orderId),
        allowance: detail ? machineAllowance(detail.order) : 0,
        customerName: detail?.customerName ?? '',
      };
    },
    [orderId],
  );

  async function start(machine: MachineRow) {
    const result = await action.run((c) => startOrderOnMachine(c, controller, actor, orderId, machine.id));
    if (!result.ok) return;
    report(result.value, machine.name);
    setChosen(null);
    if (result.value === 'acked' || result.value === 'timeout') onClose();
  }

  const actions = chosen ? (
    <>
      <Button label="Back" kind="secondary" onPress={() => setChosen(null)} />
      <Button label={`Start ${chosen.name}`} icon="play" onPress={() => void start(chosen)} busy={action.busy} />
    </>
  ) : (
    <Button label="Close" kind="secondary" onPress={onClose} />
  );

  return (
    <Dialog visible title={`Start a machine for ${orderId}`} onClose={onClose} actions={actions}>
      {chosen ? (
        <ConfirmStart machine={chosen} orderId={orderId} customerName={data.customerName} />
      ) : (
        <>
          <Text tone="muted">
            {`Each load allows one washer and one dryer. Used: ${data.usage.WASHER} of ${data.allowance} washers, ` +
              `${data.usage.DRYER} of ${data.allowance} dryers.`}
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
                        onChoose={() => {
                          action.clearError();
                          setChosen(machine);
                        }}
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
      ? `In use, ${minutesLeft(machine, now)} min left${machine.runOrderId ? ` · ${machine.runOrderId}` : ''}`
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

/** From the machine grid: pick the order this machine runs, confirm, and start it. */
export function OrderPickerDialog({
  machine,
  onClose,
  onOverride,
}: {
  machine: MachineRow;
  onClose: () => void;
  onOverride: () => void;
}) {
  const actor = useActor();
  const { controller } = useApp();
  const action = useAction();
  const report = useReportStart();
  const [chosen, setChosen] = useState<{ orderId: string; customerName: string } | null>(null);
  const candidates = useData(
    (c) =>
      listOrderSummaries(c)
        .filter((s) => s.order.voidedAt === null && !isClosedStatus(s.order.status))
        .map((s) => ({
          summary: s,
          allowance: machineAllowance(s.order),
          used: machineUsage(c, s.order.id)[machine.type],
        }))
        .filter((row) => row.used < row.allowance),
    [machine.type],
  );

  async function start(orderId: string) {
    const result = await action.run((c) => startOrderOnMachine(c, controller, actor, orderId, machine.id));
    if (!result.ok) return;
    report(result.value, machine.name);
    if (result.value === 'acked' || result.value === 'timeout') onClose();
    else setChosen(null);
  }

  const label = MACHINE_TYPE_LABELS[machine.type].toLowerCase();
  const actions = chosen ? (
    <>
      <Button label="Back" kind="secondary" onPress={() => setChosen(null)} />
      <Button label={`Start ${machine.name}`} icon="play" onPress={() => void start(chosen.orderId)} busy={action.busy} />
    </>
  ) : (
    <>
      <Button label="Owner override" kind="secondary" icon="shield-key-outline" onPress={onOverride} />
      <Button label="Close" kind="secondary" onPress={onClose} />
    </>
  );
  return (
    <Dialog visible title={`Start ${machine.name}`} onClose={onClose} actions={actions}>
      {chosen ? (
        <ConfirmStart machine={machine} orderId={chosen.orderId} customerName={chosen.customerName} />
      ) : (
        <>
          <Text tone="muted">Pick the order this load belongs to. No order, no start.</Text>
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

/** Owner-PIN start for rewashes, a machine that did not start, and maintenance. Always logged. */
export function OverrideDialog({
  machine,
  orderId = null,
  onClose,
}: {
  machine: MachineRow;
  orderId?: string | null;
  onClose: () => void;
}) {
  const actor = useActor();
  const { controller } = useApp();
  const action = useAction();
  const report = useReportStart();
  const [reason, setReason] = useState<OverrideReason>('Rewash');
  const [note, setNote] = useState('');
  const [pin, setPin] = useState('');

  async function submit() {
    const result = await action.run((c) =>
      overrideStart(c, controller, actor, { machineId: machine.id, pin, reason, note, orderId }),
    );
    setPin('');
    if (result.ok) {
      report(result.value, machine.name);
      if (result.value === 'acked') onClose();
    }
  }

  return (
    <Dialog
      visible
      title={`Owner override: ${machine.name}`}
      onClose={onClose}
      actions={
        <>
          <Button label="Cancel" kind="secondary" onPress={onClose} />
          <Button label="Start with PIN" icon="play" onPress={submit} busy={action.busy} disabled={pin.length < 4} />
        </>
      }
    >
      <Text tone="muted">
        Starts the machine without an order, even while it is in use. The owner enters the PIN. This start and any
        wrong PIN are recorded with your name.
      </Text>
      <Choice
        label="Reason"
        value={reason}
        onChange={setReason}
        options={OVERRIDE_REASONS.map((r) => ({ value: r, label: r }))}
      />
      <TextField
        label={reason === 'Other' ? 'What happened?' : 'Note (optional)'}
        value={note}
        onChangeText={setNote}
        multiline
      />
      <TextField
        label="Owner PIN"
        value={pin}
        onChangeText={(text) => setPin(text.replace(/\D/g, ''))}
        keyboardType="number-pad"
        secureTextEntry
        maxLength={6}
      />
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
