import { useState } from 'react';

import type { MachineRow } from '@/db/schema';
import { formatShopTime } from '@/domain/dates';
import { MACHINE_TYPE_LABELS, unlockAllowance, type MachineType } from '@/domain/unlockPolicy';
import { isClosedStatus } from '@/domain/statuses';
import {
  lastUnlocks,
  listMachines,
  OVERRIDE_REASONS,
  overrideUnlock,
  RESULT_MESSAGES,
  unlockForOrder,
  unlockUsage,
  type OverrideReason,
} from '@/services/machines';
import { listOrderSummaries } from '@/services/orders';
import type { UnlockResult } from '@/machines/MachineController';
import { useActor, useApp } from '@/state/AppProvider';
import { useAction, useData } from '@/state/hooks';
import { useToast } from '@/state/toast';

import { Button } from '../Button';
import { Choice, Dialog } from '../controls';
import { EmptyState, ListRow, Notice, Panel } from '../layout';
import { Text } from '../Text';
import { TextField } from '../TextField';

function useReportResult() {
  const toast = useToast();
  return (result: UnlockResult, machineName: string) => {
    if (result === 'acked') toast(`${machineName} unlocked`);
    else toast(`${machineName}: ${RESULT_MESSAGES[result]}`, 'danger');
  };
}

/** From an order: pick which machine of the needed type to open. */
export function MachinePickerDialog({
  orderId,
  type,
  onClose,
}: {
  orderId: string;
  type: MachineType;
  onClose: () => void;
}) {
  const actor = useActor();
  const { controller } = useApp();
  const action = useAction();
  const report = useReportResult();
  const machines = useData((c) => {
    const list = listMachines(c).filter((m) => m.type === type && m.enabled);
    return { list, last: lastUnlocks(c, list.map((m) => m.id)) };
  }, [type]);

  async function open(machine: MachineRow) {
    const result = await action.run((c) => unlockForOrder(c, controller, actor, orderId, machine.id));
    if (result.ok) {
      report(result.value, machine.name);
      if (result.value === 'acked') onClose();
    }
  }

  const label = MACHINE_TYPE_LABELS[type].toLowerCase();
  return (
    <Dialog
      visible
      title={`Unlock a ${label} for ${orderId}`}
      onClose={onClose}
      actions={<Button label="Close" kind="secondary" onPress={onClose} />}
    >
      {machines.list.length === 0 ? (
        <EmptyState
          icon="washing-machine-off"
          title={`No ${label}s set up`}
          body="The owner adds machines in Manage > Machines."
        />
      ) : (
        <Panel>
          {machines.list.map((machine, index) => {
            const last = machines.last.get(machine.id);
            return (
              <ListRow
                key={machine.id}
                title={machine.name}
                subtitle={last ? `Last opened ${formatShopTime(last.at)} for ${last.orderId ?? 'an override'}` : 'Not opened yet'}
                onPress={() => void open(machine)}
                last={index === machines.list.length - 1}
                accessibilityLabel={`Unlock ${machine.name}`}
              />
            );
          })}
        </Panel>
      )}
      {action.busy && <Notice tone="info">Unlocking…</Notice>}
      {action.error && <Notice tone="danger">{action.error}</Notice>}
    </Dialog>
  );
}

/** From the machine grid: pick the order this machine is being opened for. */
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
  const report = useReportResult();
  const candidates = useData(
    (c) =>
      listOrderSummaries(c)
        .filter((s) => s.order.voidedAt === null && !isClosedStatus(s.order.status))
        .map((s) => {
          const allowance = unlockAllowance(s.order);
          const used = unlockUsage(c, s.order.id)[machine.type];
          return { summary: s, allowance, used };
        })
        .filter((row) => row.used < row.allowance),
    [machine.type],
  );

  async function open(orderId: string) {
    const result = await action.run((c) => unlockForOrder(c, controller, actor, orderId, machine.id));
    if (result.ok) {
      report(result.value, machine.name);
      if (result.value === 'acked') onClose();
    }
  }

  const label = MACHINE_TYPE_LABELS[machine.type].toLowerCase();
  return (
    <Dialog
      visible
      title={`Open ${machine.name}`}
      onClose={onClose}
      actions={
        <>
          <Button label="Owner override" kind="secondary" icon="shield-key-outline" onPress={onOverride} />
          <Button label="Close" kind="secondary" onPress={onClose} />
        </>
      }
    >
      <Text tone="muted">Pick the order this load belongs to. No order, no unlock.</Text>
      {candidates.length === 0 ? (
        <EmptyState
          icon="receipt-text-outline"
          title={`No open orders need a ${label}`}
          body="Take the order first with New order. For a rewash or a stuck door, use the owner override."
        />
      ) : (
        <Panel>
          {candidates.slice(0, 12).map(({ summary, allowance, used }, index, list) => (
            <ListRow
              key={summary.order.id}
              title={summary.customerName}
              subtitle={`${summary.order.id} · ${used} of ${allowance} ${label} unlocks used`}
              meta={
                summary.balance > 0 ? (
                  <Text variant="caption" tone="warning">
                    Not fully paid
                  </Text>
                ) : undefined
              }
              onPress={() => void open(summary.order.id)}
              last={index === list.length - 1}
            />
          ))}
        </Panel>
      )}
      {action.busy && <Notice tone="info">Unlocking…</Notice>}
      {action.error && <Notice tone="danger">{action.error}</Notice>}
    </Dialog>
  );
}

/** Owner-PIN unlock for rewashes, stuck doors and maintenance. Always logged. */
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
  const report = useReportResult();
  const [reason, setReason] = useState<OverrideReason>('Rewash');
  const [note, setNote] = useState('');
  const [pin, setPin] = useState('');

  async function submit() {
    const result = await action.run((c) =>
      overrideUnlock(c, controller, actor, { machineId: machine.id, pin, reason, note, orderId }),
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
          <Button label="Unlock with PIN" icon="lock-open-variant-outline" onPress={submit} busy={action.busy} disabled={pin.length < 4} />
        </>
      }
    >
      <Text tone="muted">
        For unlocks outside an order. The owner enters the PIN. This unlock and any wrong PIN are recorded with your name.
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
