import { router } from 'expo-router';
import { useState } from 'react';

import { formatShopTime, inRange, shopDayRange } from '@/domain/dates';
import { isLowStock } from '@/domain/inventory';
import { formatPeso } from '@/domain/money';
import { can } from '@/domain/permissions';
import { periodFigures } from '@/domain/reports';
import { isClosedStatus } from '@/domain/statuses';
import { listExpenses } from '@/services/expenses';
import { listInventory } from '@/services/inventory';
import { listAllPayments, listOrderSummaries } from '@/services/orders';
import { useActor, useApp } from '@/state/AppProvider';
import { useData } from '@/state/hooks';
import { Button } from '@/ui/Button';
import { Dialog } from '@/ui/controls';
import { EmptyState, ListRow, Notice, Panel, Row, Screen, Section, Stat } from '@/ui/layout';
import { BalanceBadge, StatusBadge } from '@/ui/StatusBadge';
import { Text } from '@/ui/Text';

export default function Today() {
  const actor = useActor();
  const { ctx, controllerState } = useApp();
  const [lowStockDismissed, setLowStockDismissed] = useState(false);
  const data = useData((c) => {
    const summaries = listOrderSummaries(c);
    return {
      summaries,
      payments: listAllPayments(c),
      expenses: listExpenses(c),
      lowStock: listInventory(c).filter(isLowStock),
    };
  });

  const today = shopDayRange(ctx.now());
  const todays = data.summaries.filter((s) => s.order.voidedAt === null && inRange(s.order.placedAt, today));
  const open = data.summaries.filter((s) => s.order.voidedAt === null && !isClosedStatus(s.order.status));
  const figures = periodFigures(
    {
      orders: data.summaries.map((s) => ({
        id: s.order.id,
        placedAt: s.order.placedAt,
        loadCount: s.order.loadCount,
        status: s.order.status,
        voided: s.order.voidedAt !== null,
      })),
      payments: data.payments,
      expenses: data.expenses,
    },
    today,
  );

  return (
    <Screen>
      {controllerState.status !== 'ready' && (
        <Notice tone="warning">
          {controllerState.detail ?? 'The machine controller is not connected. Machines cannot be started.'}
        </Notice>
      )}

      <Row wrap style={{ alignItems: 'flex-start' }}>
        <Stat label="Orders today" value={String(todays.length)} />
        <Stat label="Loads today" value={String(figures.loads)} />
        <Stat label="Open jobs" value={String(open.length)} note="All days, not yet completed" />
        {can.seeRevenue(actor.role) && (
          <Stat
            label="Received today"
            value={formatPeso(figures.revenue)}
            tone="success"
            note={
              figures.revenueFromEarlierOrders > 0
                ? `Includes ${formatPeso(figures.revenueFromEarlierOrders)} for orders placed earlier`
                : undefined
            }
          />
        )}
      </Row>

      <Section
        title="Today's orders"
        action={<Button label="All orders" kind="quiet" onPress={() => router.push('/orders')} />}
      >
        <Panel>
          {todays.length === 0 ? (
            <EmptyState
              icon="receipt-text-outline"
              title="No orders yet today"
              body="Orders taken today show up here. Start one with New order at the top."
            />
          ) : (
            todays.slice(0, 8).map((s, index) => (
              <ListRow
                key={s.order.id}
                title={s.customerName}
                subtitle={`${s.order.id} · ${formatShopTime(s.order.placedAt)} · ${s.order.loadCount} load${s.order.loadCount === 1 ? '' : 's'}`}
                right={
                  <Row>
                    <BalanceBadge balance={s.balance} />
                    <StatusBadge status={s.order.status} />
                  </Row>
                }
                onPress={() => router.push(`/orders/${s.order.id}`)}
                last={index === Math.min(todays.length, 8) - 1}
              />
            ))
          )}
        </Panel>
      </Section>

      <Dialog
        visible={data.lowStock.length > 0 && !lowStockDismissed}
        title="Low stock"
        onClose={() => setLowStockDismissed(true)}
        actions={
          <>
            <Button label="Dismiss" kind="secondary" onPress={() => setLowStockDismissed(true)} />
            <Button
              label="Open stock"
              onPress={() => {
                setLowStockDismissed(true);
                router.push('/stock');
              }}
            />
          </>
        }
      >
        <Text>These items are at or below their low-stock level:</Text>
        {data.lowStock.map((item) => (
          <Row key={item.id}>
            <Text style={{ flex: 1 }}>{item.name}</Text>
            <Text variant="bodyStrong" tone="danger" numeric>
              {item.currentStock} {item.unit} left
            </Text>
          </Row>
        ))}
      </Dialog>
    </Screen>
  );
}
