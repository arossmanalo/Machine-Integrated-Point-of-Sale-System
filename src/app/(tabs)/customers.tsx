import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { CustomerRow } from '@/db/schema';
import { formatShopDate } from '@/domain/dates';
import { isPromoEligible, LOADS_PER_FREE_LOAD } from '@/domain/loyalty';
import { formatPeso } from '@/domain/money';
import { archiveCustomer, listCustomers, matchesCustomer } from '@/services/customers';
import { listOrderSummaries } from '@/services/orders';
import { useAction, useData } from '@/state/hooks';
import { Button } from '@/ui/Button';
import { Dialog } from '@/ui/controls';
import { CustomerDialog } from '@/ui/CustomerDialog';
import { EmptyState, ListRow, Notice, Panel, Row, Screen, Section } from '@/ui/layout';
import { StatusBadge } from '@/ui/StatusBadge';
import { Text } from '@/ui/Text';
import { TextField } from '@/ui/TextField';
import { colors, radius } from '@/ui/theme';

function PromoProgress({ loads }: { loads: number }) {
  const qualified = isPromoEligible(loads);
  const share = Math.min(1, loads / LOADS_PER_FREE_LOAD);
  return (
    <Row>
      <View style={styles.track} accessibilityLabel={`${loads} of ${LOADS_PER_FREE_LOAD} loads toward a free load`}>
        <View style={[styles.fill, { width: `${share * 100}%`, backgroundColor: qualified ? colors.success : colors.accent }]} />
      </View>
      <Text variant="caption" tone={qualified ? 'success' : 'muted'} numeric>
        {qualified ? 'Free load on next order' : `${loads}/${LOADS_PER_FREE_LOAD} loads`}
      </Text>
    </Row>
  );
}

export default function Customers() {
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<CustomerRow | 'new' | null>(null);
  const [viewing, setViewing] = useState<CustomerRow | null>(null);
  const customers = useData(listCustomers);
  const filtered = customers.filter((c) => matchesCustomer(c, query));

  return (
    <Screen>
      <Section
        title="Customers"
        action={<Button label="Add customer" icon="account-plus-outline" onPress={() => setEditing('new')} />}
      >
        <TextField label="Search" value={query} onChangeText={setQuery} placeholder="Name, phone or C-number" />
        <Panel>
          {filtered.length === 0 ? (
            <EmptyState
              icon="account-search-outline"
              title={customers.length === 0 ? 'No customers yet' : 'No one matches'}
              body={customers.length === 0 ? 'Add customers here or while taking an order.' : 'Check the spelling or search by phone.'}
            />
          ) : (
            filtered.map((customer, index) => (
              <ListRow
                key={customer.id}
                title={customer.name}
                subtitle={[customer.id, customer.phone].filter(Boolean).join(' · ')}
                meta={<PromoProgress loads={customer.loyaltyLoads} />}
                onPress={() => setViewing(customer)}
                last={index === filtered.length - 1}
              />
            ))
          )}
        </Panel>
      </Section>

      {editing && (
        <CustomerDialog
          visible
          customer={editing === 'new' ? null : editing}
          initialName={editing === 'new' ? query.trim() : undefined}
          onClose={() => setEditing(null)}
        />
      )}
      {viewing && (
        <CustomerSheet
          customer={viewing}
          onClose={() => setViewing(null)}
          onEdit={() => {
            setEditing(viewing);
            setViewing(null);
          }}
        />
      )}
    </Screen>
  );
}

function CustomerSheet({ customer, onClose, onEdit }: { customer: CustomerRow; onClose: () => void; onEdit: () => void }) {
  const action = useAction();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const orders = useData((c) => listOrderSummaries(c).filter((s) => s.order.customerId === customer.id), [customer.id]);
  const owed = orders.filter((s) => s.order.voidedAt === null).reduce((sum, s) => sum + s.balance, 0);

  return (
    <Dialog
      visible
      title={customer.name}
      onClose={onClose}
      actions={
        <>
          {confirmRemove ? (
            <Button
              label="Yes, remove"
              kind="danger"
              busy={action.busy}
              onPress={async () => {
                const result = await action.run((c) => archiveCustomer(c, customer.id));
                if (result.ok) onClose();
              }}
            />
          ) : (
            <Button label="Remove" kind="danger" onPress={() => setConfirmRemove(true)} />
          )}
          <Button label="Edit" kind="secondary" onPress={onEdit} />
        </>
      }
    >
      <Text tone="muted">{[customer.id, customer.phone, customer.address].filter(Boolean).join(' · ')}</Text>
      {customer.notes ? <Text>{customer.notes}</Text> : null}
      <PromoProgress loads={customer.loyaltyLoads} />
      {owed > 0 && <Notice tone="warning">{`Owes ${formatPeso(owed)} across unpaid orders.`}</Notice>}
      {confirmRemove && (
        <Notice tone="danger">They will be hidden from lists. Their past orders keep their name.</Notice>
      )}
      <Text variant="heading">Order history</Text>
      <Panel>
        {orders.length === 0 ? (
          <EmptyState icon="receipt-text-outline" title="No orders yet" body="Orders for this customer will appear here." />
        ) : (
          orders.slice(0, 20).map((s, index, list) => (
            <ListRow
              key={s.order.id}
              title={`${s.order.id} · ${formatPeso(s.order.total)}`}
              subtitle={`${formatShopDate(s.order.placedAt)} · ${s.order.loadCount} load${s.order.loadCount === 1 ? '' : 's'}`}
              right={<StatusBadge status={s.order.status} voided={s.order.voidedAt !== null} />}
              onPress={() => {
                onClose();
                router.push(`/orders/${s.order.id}`);
              }}
              last={index === list.length - 1}
            />
          ))
        )}
      </Panel>
      {action.error && <Notice tone="danger">{action.error}</Notice>}
    </Dialog>
  );
}

const styles = StyleSheet.create({
  track: { flex: 1, maxWidth: 160, height: 8, borderRadius: radius.sm, backgroundColor: colors.surfaceSunken, overflow: 'hidden' },
  fill: { height: '100%' },
});
