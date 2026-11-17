import { router } from 'expo-router';
import { useState } from 'react';

import { formatShopDate, formatShopDayShort, inRange, isSameShopDay } from '@/domain/dates';
import { formatPeso } from '@/domain/money';
import { can } from '@/domain/permissions';
import { periodRange, type ReportPeriod } from '@/domain/reports';
import { selectableStatuses, statusLabel } from '@/domain/statuses';
import { listOrderSummaries } from '@/services/orders';
import { getAllSettings } from '@/services/settings';
import { useActor, useApp } from '@/state/AppProvider';
import { useData } from '@/state/hooks';
import { Button } from '@/ui/Button';
import { Choice } from '@/ui/controls';
import { EmptyState, ListRow, Panel, Row, Screen, Section } from '@/ui/layout';
import { BalanceBadge, StatusBadge } from '@/ui/StatusBadge';
import { Text } from '@/ui/Text';
import { TextField } from '@/ui/TextField';

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
                right={
                  <Row>
                    {s.order.voidedAt === null && <BalanceBadge balance={s.balance} />}
                    <StatusBadge status={s.order.status} voided={s.order.voidedAt !== null} />
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
    </Screen>
  );
}
