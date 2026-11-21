import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { formatShopDate, formatShopDayShort, inRange, isSameShopDay } from '@/domain/dates';
import { formatPeso } from '@/domain/money';
import { can } from '@/domain/permissions';
import { periodRange, type ReportPeriod } from '@/domain/reports';
import { selectableStatuses, statusLabel } from '@/domain/statuses';
import { listOrderSummaries, updateOrderStatus } from '@/services/orders';
import { getAllSettings } from '@/services/settings';
import { useActor, useApp } from '@/state/AppProvider';
import { useAction, useData } from '@/state/hooks';
import { useToast } from '@/state/toast';
import { Button } from '@/ui/Button';
import { Choice, Dialog } from '@/ui/controls';
import { EmptyState, ListRow, Notice, Panel, Row, Screen, Section } from '@/ui/layout';
import { PaymentDialog } from '@/ui/orders/PaymentDialog';
import { BalanceBadge, StatusBadge } from '@/ui/StatusBadge';
import { Text } from '@/ui/Text';
import { TextField } from '@/ui/TextField';
import { colors, MIN_TOUCH, radius, space } from '@/ui/theme';

type PaymentFilter = 'all' | 'unpaid' | 'paid' | 'voided';
type DateFilter = 'all' | ReportPeriod;
const PAGE = 50;

export default function Orders() {
  const actor = useActor();
  const { ctx } = useApp();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('ALL');
  const [payment, setPayment] = useState<PaymentFilter>('all');
  const [dates, setDates] = useState<DateFilter>('all');
  const [shown, setShown] = useState(PAGE);
  const [auditing, setAuditing] = useState<{ id: string; customerName: string } | null>(null);
  const [paying, setPaying] = useState<{ id: string; balance: number } | null>(null);
  const canAudit = can.setAuditedStatus(actor.role);
  const { summaries, statuses } = useData((c) => {
    const settings = getAllSettings(c.db);
    return {
      summaries: listOrderSummaries(c),
      statuses: selectableStatuses(settings.customStatuses, settings.hiddenStatuses, true),
    };
  });

  const q = query.trim().toLowerCase();
  const range = dates === 'all' ? null : periodRange(dates, ctx.now());
  const filtered = summaries.filter((s) => {
    const voided = s.order.voidedAt !== null;
    if (payment === 'voided' ? !voided : voided) return false;
    if (payment === 'unpaid' && s.balance <= 0) return false;
    if (payment === 'paid' && s.balance > 0) return false;
    if (status !== 'ALL' && s.order.status !== status) return false;
    if (range && !inRange(s.order.placedAt, range)) return false;
    return !q || s.order.id.toLowerCase().includes(q) || s.customerName.toLowerCase().includes(q);
  });
  const total = filtered.reduce((sum, s) => sum + s.order.total, 0);
  const balance = filtered.reduce((sum, s) => sum + s.balance, 0);
  const filtersActive = q !== '' || status !== 'ALL' || payment !== 'all' || dates !== 'all';

  function clearFilters() {
    setQuery('');
    setStatus('ALL');
    setPayment('all');
    setDates('all');
  }

  return (
    <Screen>
      <Section title="Find orders" action={filtersActive ? <Button label="Clear filters" kind="quiet" onPress={clearFilters} /> : undefined}>
        <TextField
          label="Search"
          value={query}
          onChangeText={(text) => {
            setQuery(text);
            setShown(PAGE);
          }}
          placeholder="Customer name or order number"
          autoCapitalize="none"
          returnKeyType="search"
        />
        <Choice
          label="Placed"
          value={dates}
          onChange={setDates}
          options={[
            { value: 'all', label: 'Any time' },
            { value: 'Today', label: 'Today' },
            { value: 'Last 7 days', label: 'Last 7 days' },
            { value: 'This month', label: 'This month' },
          ]}
        />
        <Choice
          label="Payment"
          value={payment}
          onChange={setPayment}
          options={[
            { value: 'all', label: 'All' },
            { value: 'unpaid', label: 'Unpaid' },
            { value: 'paid', label: 'Paid' },
            { value: 'voided', label: 'Voided' },
          ]}
        />
        <Choice
          label="Status"
          value={status}
          onChange={setStatus}
          options={[{ value: 'ALL', label: 'All' }, ...statuses.map((s) => ({ value: s, label: statusLabel(s) }))]}
        />
      </Section>

      <Section
        title={`${filtered.length} order${filtered.length === 1 ? '' : 's'}`}
        action={
          can.seeRevenue(actor.role) ? (
            <Text tone="muted" numeric>
              {formatPeso(total)} total · {formatPeso(balance)} unpaid
            </Text>
          ) : undefined
        }
      >
        <Panel>
          {filtered.length === 0 ? (
            <EmptyState
              icon="magnify"
              title={summaries.length === 0 ? 'No orders yet' : 'No orders match'}
              body={
                summaries.length === 0
                  ? 'Orders appear here once you take one with New order.'
                  : 'Try a different name, or clear the filters.'
              }
            />
          ) : (
            filtered.slice(0, shown).map((s, index, list) => (
              <ListRow
                key={s.order.id}
                title={s.customerName}
                subtitle={`${s.order.id} · placed ${formatShopDate(s.order.placedAt)}${
                  s.paidAt !== null && !isSameShopDay(s.paidAt, s.order.placedAt)
                    ? ` · paid ${formatShopDayShort(s.paidAt)}`
                    : ''
                } · ${s.order.loadCount} load${s.order.loadCount === 1 ? '' : 's'}`}
                meta={
                  s.balance > 0 && s.order.voidedAt === null ? (
                    <Text variant="caption" tone="danger" numeric>
                      {formatPeso(s.balance)} still to pay
                    </Text>
                  ) : undefined
                }
                trailing={
                  <Row>
                    {s.order.voidedAt === null && s.balance > 0 ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`${s.order.id} is unpaid, ${formatPeso(s.balance)} due. Receive payment`}
                        onPress={() => setPaying({ id: s.order.id, balance: s.balance })}
                        hitSlop={space.md}
                        style={({ pressed }) => [styles.statusButton, pressed && styles.pressed]}
                      >
                        <BalanceBadge balance={s.balance} />
                        <MaterialCommunityIcons name="chevron-down" size={18} color={colors.textMuted} />
                      </Pressable>
                    ) : (
                      s.order.voidedAt === null && <BalanceBadge balance={s.balance} />
                    )}
                    {canAudit && s.order.voidedAt === null && s.order.status === 'PENDING' ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`${s.order.id} is pending. Mark as audited`}
                        onPress={() => setAuditing({ id: s.order.id, customerName: s.customerName })}
                        hitSlop={space.md}
                        style={({ pressed }) => [styles.statusButton, pressed && styles.pressed]}
                      >
                        <StatusBadge status={s.order.status} />
                        <MaterialCommunityIcons name="chevron-down" size={18} color={colors.textMuted} />
                      </Pressable>
                    ) : (
                      <StatusBadge status={s.order.status} voided={s.order.voidedAt !== null} />
                    )}
                  </Row>
                }
                onPress={() => router.push(`/orders/${s.order.id}`)}
                last={index === list.length - 1}
              />
            ))
          )}
        </Panel>
        {filtered.length > shown && (
          <Button label={`Show ${Math.min(PAGE, filtered.length - shown)} more`} kind="secondary" onPress={() => setShown(shown + PAGE)} />
        )}
      </Section>
      {auditing && <AuditDialog order={auditing} onClose={() => setAuditing(null)} />}
      {paying && <PaymentDialog orderId={paying.id} balance={paying.balance} onClose={() => setPaying(null)} />}
    </Screen>
  );
}

/** Admins and the owner sign off a pending order straight from the list. Unpaid opens Receive payment. */
function AuditDialog({ order, onClose }: { order: { id: string; customerName: string }; onClose: () => void }) {
  const actor = useActor();
  const action = useAction();
  const toast = useToast();

  async function audit() {
    const result = await action.run((c) => updateOrderStatus(c, actor, order.id, 'AUDITED'));
    if (result.ok) {
      toast(`${order.id} marked as audited`, 'success');
      onClose();
    }
  }

  return (
    <Dialog
      visible
      title={`Mark ${order.id} as audited?`}
      onClose={onClose}
      actions={
        <>
          <Button label="Cancel" kind="secondary" onPress={onClose} />
          <Button label="Mark as audited" onPress={() => void audit()} busy={action.busy} />
        </>
      }
    >
      <Text>{order.customerName}</Text>
      <Text tone="muted">
        The order closes: it leaves the open jobs and can no longer run machines. Only an admin or the owner can
        change it back.
      </Text>
      {action.error && <Notice tone="danger">{action.error}</Notice>}
    </Dialog>
  );
}

const styles = StyleSheet.create({
  statusButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    minHeight: MIN_TOUCH,
    paddingHorizontal: space.xs,
    borderRadius: radius.sm,
  },
  pressed: { backgroundColor: colors.surfaceSunken },
});
