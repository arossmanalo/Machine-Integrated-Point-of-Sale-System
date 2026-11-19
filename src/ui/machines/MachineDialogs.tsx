import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { MachineRow } from '@/db/schema';
import { MACHINE_TYPE_LABELS, machineAllowance, type MachineType } from '@/domain/machinePolicy';
import { isClosedStatus } from '@/domain/statuses';
import type { StartResult } from '@/machines/MachineController';
import {
  assignOrder,
  listMachines,
  machineUsage,
  OVERRIDE_REASONS,
  overrideStart,
  RESULT_MESSAGES,
  unassignMachine,
  type OverrideReason,
} from '@/services/machines';
import { getOrderDetail, listOrderSummaries } from '@/services/orders';
import { useActor, useApp } from '@/state/AppProvider';
import { useAction, useData } from '@/state/hooks';
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

/**
 * From an order: put it on machines. Shows the registered dryers on top and washers below, the
 * way they are stacked in the shop. Starting happens on the Machines tab.
 */
export function AssignMachineDialog({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const actor = useActor();
  const action = useAction();
  const toast = useToast();
  const data = useData(
    (c) => {
      const detail = getOrderDetail(c, orderId);
      return {
        machines: listMachines(c),
        usage: machineUsage(c, orderId),
        allowance: detail ? machineAllowance(detail.order) : 0,
      };
    },
    [orderId],
  );

  async function assign(machine: MachineRow) {
    const result = await action.run((c) => assignOrder(c, actor, orderId, machine.id));
    if (result.ok) toast(`${orderId} is on ${machine.name}. Start it from the Machines tab.`);
  }

  async function remove(machine: MachineRow) {
    const result = await action.run((c) => unassignMachine(c, machine.id));
    if (result.ok) toast(`${orderId} taken off ${machine.name}`);
  }

  return (
    <Dialog
      visible
      title={`Assign ${orderId} to a machine`}
      onClose={onClose}
      actions={<Button label="Done" onPress={onClose} />}
    >
      <Text tone="muted">
        {`Each load allows one washer and one dryer. Used: ${data.usage.WASHER} of ${data.allowance} washers, ` +
          `${data.usage.DRYER} of ${data.allowance} dryers.`}
      </Text>
      {data.machines.length === 0 ? (
        <EmptyState icon="washing-machine-off" title="No machines set up" body="The owner adds machines in Manage, Machines." />
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
                    busy={action.busy}
                    onAssign={() => void assign(machine)}
                    onRemove={() => void remove(machine)}
                  />
                ))}
              </View>
            </View>
          );
        })
      )}
      {action.error && <Notice tone="danger">{action.error}</Notice>}
    </Dialog>
  );
}

function MachineTile({
  machine,
  orderId,
  busy,
  onAssign,
  onRemove,
}: {
  machine: MachineRow;
  orderId: string;
  busy: boolean;
  onAssign: () => void;
  onRemove: () => void;
}) {
  const mine = machine.assignedOrderId === orderId;
  const free = machine.enabled && machine.assignedOrderId === null;
  const state = !machine.enabled
    ? 'Switched off'
    : mine
      ? 'Assigned to this order'
      : machine.assignedOrderId !== null
        ? `Has ${machine.assignedOrderId}`
        : 'Free';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${machine.name}, ${state}`}
      disabled={!free || busy}
      onPress={onAssign}
      style={({ pressed }) => [
        styles.tile,
        mine && styles.tileMine,
        !free && !mine && styles.tileOff,
        pressed && { backgroundColor: colors.surfaceSunken },
      ]}
    >
      <MaterialCommunityIcons
        name={machine.type === 'WASHER' ? 'washing-machine' : 'tumble-dryer'}
        size={28}
        color={mine ? colors.accent : free ? colors.text : colors.textMuted}
      />
      <Text variant="bodyStrong">{machine.name}</Text>
      <Text variant="caption" tone={mine ? 'accent' : 'muted'}>
        {state}
      </Text>
      {mine && <Button label="Remove" kind="quiet" onPress={onRemove} busy={busy} />}
    </Pressable>
  );
}

/** From the machine grid: pick the order this machine will run. */
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
  const action = useAction();
  const toast = useToast();
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

  async function assign(orderId: string) {
    const result = await action.run((c) => assignOrder(c, actor, orderId, machine.id));
    if (result.ok) {
      toast(`${orderId} is on ${machine.name}. Tap Start machine when it is loaded.`);
      onClose();
    }
  }

  const label = MACHINE_TYPE_LABELS[machine.type].toLowerCase();
  return (
    <Dialog
      visible
      title={`Assign an order to ${machine.name}`}
      onClose={onClose}
      actions={
        <>
          <Button label="Owner override" kind="secondary" icon="shield-key-outline" onPress={onOverride} />
          <Button label="Close" kind="secondary" onPress={onClose} />
        </>
      }
    >
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
              onPress={() => void assign(summary.order.id)}
              last={index === list.length - 1}
            />
          ))}
        </Panel>
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
        Starts the machine without an order. The owner enters the PIN. This start and any wrong PIN are recorded with
        your name.
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
});
