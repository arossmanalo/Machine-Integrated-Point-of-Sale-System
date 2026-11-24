import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { describeRun, orderHistory } from '@/domain/dailyReport';
import { formatShopDateTime, isSameShopDay } from '@/domain/dates';
import { formatPeso } from '@/domain/money';
import { changeDue, PAYMENT_CHANNEL_LABELS, PAYMENT_METHOD_LABELS, type PaymentMethod } from '@/domain/payments';
import { can } from '@/domain/permissions';
import { serviceLabel } from '@/domain/pricing';
import { selectableStatuses, statusLabel } from '@/domain/statuses';
import { MACHINE_TYPE_LABELS, machineAllowance } from '@/domain/machinePolicy';
import { machinesAssignedTo, machineUsage } from '@/services/machines';
import { getOrderDetail, updateOrderStatus, voidOrder } from '@/services/orders';
import { getAllSettings } from '@/services/settings';
import { useActor } from '@/state/AppProvider';
import { useAction, useData } from '@/state/hooks';
import { useToast } from '@/state/toast';
import { usePrintReceipt } from '@/state/usePrintReceipt';
import { Button } from '@/ui/Button';
import { Dialog } from '@/ui/controls';
import { Divider, EmptyState, ListRow, Notice, Panel, Row, Screen, Section } from '@/ui/layout';
import { StartMachineDialog } from '@/ui/machines/MachineDialogs';
import { PaymentDialog } from '@/ui/orders/PaymentDialog';
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
  const { print, printOverride, printing } = usePrintReceipt();
  const [dialog, setDialog] = useState<'pay' | 'status' | 'void' | null>(null);
  const [starting, setStarting] = useState(false);
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
  const washerAllowance = machineAllowance(order, 'WASHER');
  const dryerAllowance = machineAllowance(order, 'DRYER');
  const allowance = Math.max(washerAllowance, dryerAllowance);
  const machinesOpen = !voided && allowance > 0 && order.status !== 'COMPLETED' && order.status !== 'AUDITED';
  const runsLeft = data.usage.WASHER < washerAllowance || data.usage.DRYER < dryerAllowance;
  const loads = orderHistory(order, detail.unlocks).loads;

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
          <Notice tone="success">Order saved. Next, load a washer and tap Assign machine.</Notice>
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
          {!voided && can.issueOverrideReceipts(actor.role) && (
            <Button
              label="Print override receipt"
              kind="secondary"
              icon="shield-key-outline"
              busy={printing}
              onPress={() => void printOverride(order.id, actor)}
            />
          )}
          {allowance > 0 && (
            <Button
              label="Assign machine"
              icon="washing-machine"
              // Blue while the receipt's QR code still has washer or dryer runs left.
              kind={machinesOpen && runsLeft ? 'primary' : 'secondary'}
              disabled={!machinesOpen}
              onPress={() => setStarting(true)}
            />
          )}
          {!voided && can.voidOrder(actor.role) && (
            // Kept apart at the far end so it is not tapped by mistake next to the everyday actions.
            <Button label="Void order" kind="danger" onPress={() => setDialog('void')} style={styles.pushRight} />
          )}
        </Row>

        <Section
          title="Machines"
          description={
            washerAllowance === 0
              ? `Dry only: each load allows one dryer. Used: ${data.usage.DRYER} of ${dryerAllowance} dryers.`
              : `Each load allows one washer and one dryer. Used: ${data.usage.WASHER} of ${washerAllowance} washers, ${data.usage.DRYER} of ${dryerAllowance} dryers.`
          }
        >
          {allowance === 0 && (
            <Text tone="muted">
              {`This ${serviceLabel(order.service).toLowerCase()} order came from the old app and does not use the machines.`}
            </Text>
          )}
          {allowance > 0 && (
            <Panel>
              {loads.map((load, index) => (
                <ListRow
                  key={load.number}
                  title={`Load ${load.number}`}
                  subtitle={`Washer: ${describeRun(load.washer)} · Dryer: ${describeRun(load.dryer)}`}
                  last={index === loads.length - 1 && data.assigned.length === 0}
                />
              ))}
              {data.assigned.map((machine, index) => (
                <ListRow
                  key={machine.id}
                  title={machine.name}
                  subtitle={`${MACHINE_TYPE_LABELS[machine.type]} · did not run yet · try again from Machines or Assign machine`}
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
                  subtitle={`${formatShopDateTime(start.at)} · ${start.employeeName}${
                    start.kind === 'OVERRIDE'
                      ? ` · override: ${start.overrideReason ?? ''}`
                      : start.kind === 'TOP_UP'
                        ? ` · top-up ${formatPeso(start.charge ?? 0)}`
                        : ''
                  }`}
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
      {starting && <StartMachineDialog orderId={order.id} onClose={() => setStarting(false)} />}
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
  pushRight: { marginLeft: 'auto' },
});
