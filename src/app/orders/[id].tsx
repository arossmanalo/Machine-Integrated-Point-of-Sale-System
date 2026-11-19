import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { formatShopDateTime, isSameShopDay } from '@/domain/dates';
import { formatPeso, parsePesoInput } from '@/domain/money';
import {
  changeDue,
  PAYMENT_CHANNEL_LABELS,
  PAYMENT_CHANNELS,
  PAYMENT_METHOD_LABELS,
  type PaymentChannel,
  type PaymentMethod,
} from '@/domain/payments';
import { can } from '@/domain/permissions';
import { serviceLabel } from '@/domain/pricing';
import { selectableStatuses, statusLabel } from '@/domain/statuses';
import { MACHINE_TYPE_LABELS, machineAllowance } from '@/domain/machinePolicy';
import { machinesAssignedTo, machineUsage } from '@/services/machines';
import { getOrderDetail, receivePayment, updateOrderStatus, voidOrder } from '@/services/orders';
import { getAllSettings } from '@/services/settings';
import { useActor } from '@/state/AppProvider';
import { useAction, useData } from '@/state/hooks';
import { useToast } from '@/state/toast';
import { usePrintReceipt } from '@/state/usePrintReceipt';
import { Button } from '@/ui/Button';
import { Choice, Dialog } from '@/ui/controls';
import { Divider, EmptyState, ListRow, Notice, Panel, Row, Screen, Section } from '@/ui/layout';
import { AssignMachineDialog } from '@/ui/machines/MachineDialogs';
import { StartResultBadge } from '@/ui/machines/StartResultBadge';
import { BalanceBadge, StatusBadge } from '@/ui/StatusBadge';
import { Text } from '@/ui/Text';
import { TextField } from '@/ui/TextField';
import { space } from '@/ui/theme';

function methodLabel(method: string): string {
  return method in PAYMENT_METHOD_LABELS ? PAYMENT_METHOD_LABELS[method as PaymentMethod] : method;
}

export default function OrderDetails() {
  const { id, fresh } = useLocalSearchParams<{ id: string; fresh?: string }>();
  const actor = useActor();
  const { print, printing } = usePrintReceipt();
  const [dialog, setDialog] = useState<'pay' | 'status' | 'void' | null>(null);
  const [assigning, setAssigning] = useState(false);
  const data = useData(
    (c) => {
      const detail = getOrderDetail(c, id);
      const settings = getAllSettings(c.db);
      return {
        detail,
        usage: detail ? machineUsage(c, detail.order.id) : { WASHER: 0, DRYER: 0 },
        assigned: detail ? machinesAssignedTo(c, detail.order.id) : [],
        statuses: selectableStatuses(settings.customStatuses, settings.hiddenStatuses, can.setAuditedStatus(actor.role)),
      };
    },
    [id],
  );

  const { detail } = data;
  if (!detail) {
    return (
      <>
        <Stack.Screen options={{ headerShown: true, title: 'Order' }} />
        <Screen>
          <EmptyState icon="receipt-text-outline" title="Order not found" body={`There is no order ${id}.`} />
        </Screen>
      </>
    );
  }

  const { order } = detail;
  const voided = order.voidedAt !== null;
  const allowance = machineAllowance(order);
  const machinesOpen = !voided && allowance > 0 && order.status !== 'COMPLETED' && order.status !== 'AUDITED';

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: `Order ${order.id}` }} />
      <Screen>
        {voided && (
          <Notice tone="danger">
            {`Voided by ${order.voidedByName ?? 'unknown'} on ${formatShopDateTime(order.voidedAt ?? 0)}: ${order.voidReason ?? ''}`}
          </Notice>
        )}
        {fresh === '1' && !voided && (
          <Notice tone="success">Order saved. Next, assign it to a washer, then start the washer from Machines.</Notice>
        )}

        <View style={styles.head}>
          <View style={styles.flex}>
            <Text variant="title">{detail.customerName}</Text>
            <Text tone="muted">
              {`Placed ${formatShopDateTime(order.placedAt)} by ${order.createdByName}`}
            </Text>
          </View>
          <Row>
            {!voided && <BalanceBadge balance={detail.balance} />}
            <StatusBadge status={order.status} voided={voided} />
          </Row>
        </View>

        <Row wrap>
          {!voided && detail.balance > 0 && (
            <Button label="Receive payment" icon="cash-plus" onPress={() => setDialog('pay')} />
          )}
          {!voided && <Button label="Change status" kind="secondary" onPress={() => setDialog('status')} />}
          <Button label="Print receipt" kind="secondary" icon="printer-outline" busy={printing} onPress={() => void print(order.id)} />
          {allowance > 0 && (
            <Button
              label="Assign to machine"
              icon="washing-machine"
              kind={data.usage.WASHER === 0 && machinesOpen ? 'primary' : 'secondary'}
              disabled={!machinesOpen}
              onPress={() => setAssigning(true)}
            />
          )}
          {!voided && can.voidOrder(actor.role) && (
            <Button label="Void order" kind="danger" onPress={() => setDialog('void')} />
          )}
        </Row>

        <Section
          title="Machines"
          description={`Each load allows one washer and one dryer. Used: ${data.usage.WASHER} of ${allowance} washers, ${data.usage.DRYER} of ${allowance} dryers.`}
        >
          {allowance === 0 && (
            <Text tone="muted">
              {`This ${serviceLabel(order.service).toLowerCase()} order came from the old app and does not use the machines.`}
            </Text>
          )}
          {data.assigned.length > 0 && (
            <Panel>
              {data.assigned.map((machine, index) => (
                <ListRow
                  key={machine.id}
                  title={machine.name}
                  subtitle={`${MACHINE_TYPE_LABELS[machine.type]} · waiting to start · assigned by ${machine.assignedByName ?? 'someone'}`}
                  last={index === data.assigned.length - 1}
                />
              ))}
            </Panel>
          )}
          {detail.unlocks.length > 0 && (
            <Panel>
              {detail.unlocks.map((start, index) => (
                <ListRow
                  key={start.id}
                  title={start.machineName}
                  subtitle={`${formatShopDateTime(start.at)} · ${start.employeeName}${start.kind === 'OVERRIDE' ? ` · override: ${start.overrideReason ?? ''}` : ''}`}
                  right={<StartResultBadge result={start.result} />}
                  last={index === detail.unlocks.length - 1}
                />
              ))}
            </Panel>
          )}
        </Section>

        <Section title="Laundry">
          <Panel style={styles.pad}>
            <Line label="Service" value={serviceLabel(order.service)} />
            <Line label="Weight" value={`${order.weightKg} kg`} />
            <Line
              label="Loads"
              value={`${order.loadCount}${order.promoApplied ? ' (1 free with 10+1 promo)' : ''} × ${formatPeso(order.pricePerLoad)}`}
            />
            {detail.items.map((item) => (
              <Line key={item.id} label={`${item.name} × ${item.quantity}`} value={formatPeso(item.unitPrice * item.quantity)} />
            ))}
            {order.legacyNote && <Line label="Add-ons (old app)" value={order.legacyNote} />}
            <Divider />
            <Line label="Total" value={formatPeso(order.total)} strong />
            <Line label="Paid" value={formatPeso(detail.paid)} />
            <Line label="Balance" value={formatPeso(detail.balance)} strong tone={detail.balance > 0 ? 'danger' : 'success'} />
            <Text variant="caption" tone="muted">
              {`First payment: ${methodLabel(order.initialPaymentMethod)}`}
            </Text>
          </Panel>
        </Section>

        <Section title="Payments">
          <Panel>
            {detail.payments.length === 0 ? (
              <EmptyState icon="cash-remove" title="No payments yet" body="Use Receive payment when the customer pays." />
            ) : (
              detail.payments.map((payment, index) => (
                <ListRow
                  key={payment.id}
                  title={
                    <Text variant="bodyStrong" numeric>
                      {`${formatPeso(payment.amount)} · ${PAYMENT_CHANNEL_LABELS[payment.channel]}`}
                    </Text>
                  }
                  subtitle={`Paid ${formatShopDateTime(payment.receivedAt)}${
                    isSameShopDay(payment.receivedAt, order.placedAt) ? '' : ` · placed ${formatShopDateTime(order.placedAt)}`
                  } · ${payment.receivedByName}`}
                  meta={
                    payment.gcashReference ? (
                      <Text variant="caption" tone="muted">{`GCash ref ${payment.gcashReference}`}</Text>
                    ) : payment.cashReceived !== null ? (
                      <Text variant="caption" tone="muted">
                        {`Cash ${formatPeso(payment.cashReceived)} · change ${formatPeso(changeDue(payment.cashReceived, payment.amount))}`}
                      </Text>
                    ) : undefined
                  }
                  last={index === detail.payments.length - 1}
                />
              ))
            )}
          </Panel>
        </Section>
      </Screen>

      {dialog === 'pay' && <PaymentDialog orderId={order.id} balance={detail.balance} onClose={() => setDialog(null)} />}
      {dialog === 'status' && (
        <StatusDialog orderId={order.id} current={order.status} statuses={data.statuses} onClose={() => setDialog(null)} />
      )}
      {dialog === 'void' && <VoidDialog orderId={order.id} paid={detail.paid} onClose={() => setDialog(null)} />}
      {assigning && <AssignMachineDialog orderId={order.id} onClose={() => setAssigning(false)} />}
    </>
  );
}

function Line({
  label,
  value,
  strong = false,
  tone = 'default',
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: 'default' | 'danger' | 'success';
}) {
  return (
    <Row>
      <Text tone="muted" style={styles.flex}>
        {label}
      </Text>
      <Text variant={strong ? 'bodyStrong' : 'body'} tone={tone} numeric>
        {value}
      </Text>
    </Row>
  );
}

function PaymentDialog({ orderId, balance, onClose }: { orderId: string; balance: number; onClose: () => void }) {
  const actor = useActor();
  const action = useAction();
  const toast = useToast();
  const [amountText, setAmountText] = useState(String(balance / 100));
  const [channel, setChannel] = useState<PaymentChannel>('CASH');
  const [cashText, setCashText] = useState('');
  const [reference, setReference] = useState('');
  const amount = parsePesoInput(amountText);
  const cash = cashText.trim() ? parsePesoInput(cashText) : null;

  async function submit() {
    if (amount === null) return;
    const result = await action.run((c) =>
      receivePayment(c, actor, orderId, { amount, channel, gcashReference: reference, cashReceived: channel === 'CASH' ? cash : null }),
    );
    if (result.ok) {
      toast(`${formatPeso(result.value)} recorded for ${orderId}`);
      onClose();
    }
  }

  return (
    <Dialog
      visible
      title="Receive payment"
      onClose={onClose}
      actions={
        <>
          <Button label="Cancel" kind="secondary" onPress={onClose} />
          <Button
            label={amount !== null ? `Record ${formatPeso(Math.min(amount, balance))}` : 'Record payment'}
            onPress={submit}
            busy={action.busy}
            disabled={amount === null || amount <= 0 || (channel === 'GCASH' && !reference.trim())}
          />
        </>
      }
    >
      <Text>{`Balance due: ${formatPeso(balance)}`}</Text>
      <TextField
        label="Amount"
        value={amountText}
        onChangeText={setAmountText}
        keyboardType="decimal-pad"
        prefix="₱"
        error={amountText && amount === null ? 'Enter an amount like 150 or 150.50.' : null}
        hint={amount !== null && amount > balance ? `Only ${formatPeso(balance)} will be recorded.` : undefined}
      />
      <Choice
        label="Paid with"
        value={channel}
        onChange={setChannel}
        options={PAYMENT_CHANNELS.map((c) => ({ value: c, label: PAYMENT_CHANNEL_LABELS[c] }))}
      />
      {channel === 'CASH' ? (
        <TextField
          label="Cash received (optional)"
          value={cashText}
          onChangeText={setCashText}
          keyboardType="decimal-pad"
          prefix="₱"
          hint={
            cash !== null && amount !== null ? `Change: ${formatPeso(changeDue(cash, Math.min(amount, balance)))}` : undefined
          }
        />
      ) : (
        <TextField label="GCash reference number" value={reference} onChangeText={setReference} keyboardType="number-pad" />
      )}
      {action.error && <Notice tone="danger">{action.error}</Notice>}
    </Dialog>
  );
}

function StatusDialog({
  orderId,
  current,
  statuses,
  onClose,
}: {
  orderId: string;
  current: string;
  statuses: string[];
  onClose: () => void;
}) {
  const actor = useActor();
  const action = useAction();
  return (
    <Dialog visible title="Change status" onClose={onClose} actions={<Button label="Cancel" kind="secondary" onPress={onClose} />}>
      <Panel>
        {statuses.map((status, index) => (
          <ListRow
            key={status}
            title={statusLabel(status)}
            subtitle={status === current ? 'Current status' : undefined}
            onPress={async () => {
              const result = await action.run((c) => updateOrderStatus(c, actor, orderId, status));
              if (result.ok) onClose();
            }}
            last={index === statuses.length - 1}
          />
        ))}
      </Panel>
      {action.error && <Notice tone="danger">{action.error}</Notice>}
    </Dialog>
  );
}

function VoidDialog({ orderId, paid, onClose }: { orderId: string; paid: number; onClose: () => void }) {
  const actor = useActor();
  const action = useAction();
  const toast = useToast();
  const [reason, setReason] = useState('');
  return (
    <Dialog
      visible
      title={`Void ${orderId}?`}
      onClose={onClose}
      actions={
        <>
          <Button label="Keep order" kind="secondary" onPress={onClose} />
          <Button
            label="Void order"
            kind="danger"
            busy={action.busy}
            disabled={!reason.trim()}
            onPress={async () => {
              const result = await action.run((c) => voidOrder(c, actor, orderId, reason));
              if (result.ok) {
                toast(`${orderId} voided`);
                onClose();
              }
            }}
          />
        </>
      }
    >
      <Text>
        The order stays on record, marked as voided. Loyalty loads and add-on stock are given back. Machine starts
        already made stay in the log, and any machine still waiting on this order is freed.
      </Text>
      {paid > 0 && (
        <Notice tone="warning">{`${formatPeso(paid)} was paid on this order. It stops counting as revenue; refund the customer if needed.`}</Notice>
      )}
      <TextField label="Reason" value={reason} onChangeText={setReason} placeholder="For example: entered twice" />
      {action.error && <Notice tone="danger">{action.error}</Notice>}
    </Dialog>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  head: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: space.md },
  pad: { padding: space.lg, gap: space.sm },
});
