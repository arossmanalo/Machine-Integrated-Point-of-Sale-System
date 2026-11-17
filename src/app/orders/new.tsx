import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { formatShopDate } from '@/domain/dates';
import { LOADS_PER_FREE_LOAD } from '@/domain/loyalty';
import { centavosToInput, formatPeso, parsePesoInput } from '@/domain/money';
import {
  changeDue,
  PAYMENT_CHANNEL_LABELS,
  PAYMENT_CHANNELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  type PaymentChannel,
  type PaymentMethod,
} from '@/domain/payments';
import { can } from '@/domain/permissions';
import { loadRangeForWeight } from '@/domain/pricing';
import { getCustomer, listCustomers, matchesCustomer } from '@/services/customers';
import { listInventory } from '@/services/inventory';
import { createOrder, quoteOrder } from '@/services/orders';
import { getSetting } from '@/services/settings';
import { useActor, useApp } from '@/state/AppProvider';
import { useAction, useData } from '@/state/hooks';
import { useToast } from '@/state/toast';
import { usePrintReceipt } from '@/state/usePrintReceipt';
import { Button } from '@/ui/Button';
import { Choice, Stepper } from '@/ui/controls';
import { CustomerDialog } from '@/ui/CustomerDialog';
import { Divider, ListRow, Notice, Panel, Row, Screen, Section } from '@/ui/layout';
import { Text } from '@/ui/Text';
import { TextField } from '@/ui/TextField';
import { space } from '@/ui/theme';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_BACKDATE_DAYS = 60;

function parseWeight(text: string): number {
  const value = Number(text.replace(',', '.'));
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export default function NewOrder() {
  const actor = useActor();
  const { ctx } = useApp();
  const action = useAction();
  const toast = useToast();
  const { print } = usePrintReceipt();

  const [customerId, setCustomerId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [addingCustomer, setAddingCustomer] = useState(false);
  const [weightText, setWeightText] = useState('');
  const [loads, setLoads] = useState(1);
  const [loadsEdited, setLoadsEdited] = useState(false);
  const [addOns, setAddOns] = useState<Record<string, number>>({});
  const [method, setMethod] = useState<PaymentMethod>('FULL_PAYMENT');
  const [channel, setChannel] = useState<PaymentChannel>('CASH');
  const [downText, setDownText] = useState('');
  const [cashText, setCashText] = useState('');
  const [gcashRef, setGcashRef] = useState('');
  const [daysBack, setDaysBack] = useState(0);

  const customers = useData(listCustomers);
  const customer = useData((c) => (customerId ? (getCustomer(c, customerId) ?? null) : null), [customerId]);
  const addOnItems = useData((c) => listInventory(c).filter((item) => item.addOnPrice > 0));
  const printingEnabled = useData((c) => getSetting(c.db, 'printingEnabled'));
  const selections = Object.entries(addOns).map(([itemId, quantity]) => ({ itemId, quantity }));
  const quote = useData(
    (c) => quoteOrder(c, customer, loads, selections),
    [customer, loads, JSON.stringify(addOns)],
  );

  const weight = parseWeight(weightText);
  const range = loadRangeForWeight(weight);
  const downPayment = parsePesoInput(downText);
  const cashReceived = cashText.trim() ? parsePesoInput(cashText) : null;
  const paying = quote.total > 0 && method !== 'PAY_LATER';
  const payingNow = method === 'FULL_PAYMENT' ? quote.total : (downPayment ?? 0);
  const matches = customers.filter((c) => matchesCustomer(c, search)).slice(0, 6);
  const placedAt = daysBack === 0 ? null : ctx.now() - daysBack * DAY_MS;

  function changeWeight(text: string) {
    setWeightText(text);
    if (!loadsEdited) setLoads(loadRangeForWeight(parseWeight(text)).recommended);
  }

  async function save() {
    if (!customerId) return;
    const result = await action.run((c) =>
      createOrder(c, actor, {
        customerId,
        weightKg: weight,
        loads,
        addOns: selections,
        paymentMethod: method,
        downPayment: downPayment ?? 0,
        channel,
        gcashReference: gcashRef,
        cashReceived: channel === 'CASH' ? cashReceived : null,
        placedAt,
      }),
    );
    if (!result.ok) return;
    toast(`Order ${result.value.id} saved`);
    if (printingEnabled) void print(result.value.id);
    router.replace({ pathname: '/orders/[id]', params: { id: result.value.id, fresh: '1' } });
  }

  const canSave =
    customerId !== null &&
    weight > 0 &&
    (!paying || channel !== 'GCASH' || gcashRef.trim() !== '') &&
    (method !== 'DOWN_PAYMENT' || !paying || (downPayment ?? 0) > 0);

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'New order' }} />
      <Screen>
        <Section title="Customer">
          {customer ? (
            <Panel>
              <ListRow
                title={customer.name}
                subtitle={[customer.id, customer.phone].filter(Boolean).join(' · ')}
                meta={
                  <Text variant="caption" tone={quote.promoApplied ? 'success' : 'muted'}>
                    {quote.promoApplied
                      ? '10+1 promo: one load is free on this order'
                      : `${customer.loyaltyLoads} of ${LOADS_PER_FREE_LOAD} loads toward a free load`}
                  </Text>
                }
                right={<Button label="Change" kind="quiet" onPress={() => setCustomerId(null)} />}
                last
              />
            </Panel>
          ) : (
            <>
              <TextField
                label="Find customer"
                value={search}
                onChangeText={setSearch}
                placeholder="Name or phone number"
                autoCapitalize="words"
              />
              <Panel>
                {matches.map((c, index) => (
                  <ListRow
                    key={c.id}
                    title={c.name}
                    subtitle={[c.id, c.phone].filter(Boolean).join(' · ')}
                    onPress={() => {
                      setCustomerId(c.id);
                      setSearch('');
                    }}
                    last={index === matches.length - 1}
                  />
                ))}
                {matches.length === 0 && (
                  <View style={styles.pad}>
                    <Text tone="muted">{customers.length === 0 ? 'No customers yet.' : 'No customer matches that.'}</Text>
                  </View>
                )}
              </Panel>
              <Button
                label={search.trim() ? `Add "${search.trim()}" as a new customer` : 'Add a new customer'}
                kind="secondary"
                icon="account-plus-outline"
                onPress={() => setAddingCustomer(true)}
              />
            </>
          )}
        </Section>

        <Section title="Laundry" description="Wash, dry & fold, priced per load.">
          <Row wrap style={styles.top}>
            <TextField
              label="Weight"
              value={weightText}
              onChangeText={changeWeight}
              keyboardType="decimal-pad"
              placeholder="0.0"
              hint="Kilograms"
              style={styles.weight}
            />
            <View style={styles.loads}>
              <Text variant="label">Loads</Text>
              <Stepper
                label="loads"
                value={loads}
                min={1}
                max={50}
                onChange={(value) => {
                  setLoads(value);
                  setLoadsEdited(true);
                }}
              />
              <Text variant="caption" tone="muted">
                {weight > 0
                  ? range.min === range.max
                    ? `${range.min} load${range.min === 1 ? '' : 's'} suggested for ${weight} kg`
                    : `${range.min} to ${range.max} loads suggested for ${weight} kg`
                  : 'Up to 8 kg per load'}
              </Text>
            </View>
          </Row>
          {addOnItems.length > 0 && (
            <Panel>
              {addOnItems.map((item, index) => (
                <ListRow
                  key={item.id}
                  title={item.name}
                  subtitle={`${formatPeso(item.addOnPrice)} each · ${item.currentStock} ${item.unit} in stock`}
                  right={
                    <Stepper
                      label={item.name}
                      value={addOns[item.id] ?? 0}
                      max={item.currentStock}
                      onChange={(quantity) => setAddOns((current) => ({ ...current, [item.id]: quantity }))}
                    />
                  }
                  last={index === addOnItems.length - 1}
                />
              ))}
            </Panel>
          )}
          {can.backdateOrder(actor.role) && (
            <Row wrap>
              <View style={styles.flex}>
                <Text variant="label">Order date</Text>
                <Text tone="muted">
                  {daysBack === 0 ? 'Today' : formatShopDate(ctx.now() - daysBack * DAY_MS)}
                  {daysBack > 0 ? ` (${daysBack} day${daysBack === 1 ? '' : 's'} ago)` : ''}
                </Text>
              </View>
              <Stepper label="days back" value={daysBack} min={0} max={MAX_BACKDATE_DAYS} onChange={setDaysBack} />
            </Row>
          )}
        </Section>

        <Section title="Payment">
          <Panel style={styles.summary}>
            <Row>
              <Text style={styles.flex}>
                {quote.billableLoads} load{quote.billableLoads === 1 ? '' : 's'} × {formatPeso(quote.pricePerLoad)}
                {quote.promoApplied ? ' (1 free)' : ''}
              </Text>
              <Text numeric>{formatPeso(quote.loadsSubtotal)}</Text>
            </Row>
            {quote.addOnsTotal > 0 && (
              <Row>
                <Text style={styles.flex}>Add-ons</Text>
                <Text numeric>{formatPeso(quote.addOnsTotal)}</Text>
              </Row>
            )}
            <Divider />
            <Row>
              <Text variant="heading" style={styles.flex}>
                Total
              </Text>
              <Text variant="figure" numeric>
                {formatPeso(quote.total)}
              </Text>
            </Row>
          </Panel>

          {quote.total > 0 && (
            <Choice
              label="How is the customer paying?"
              value={method}
              onChange={(next) => {
                setMethod(next);
                if (next === 'DOWN_PAYMENT' && !downText) setDownText(centavosToInput(Math.round(quote.total / 2)));
              }}
              options={PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABELS[m] }))}
            />
          )}
          {paying && (
            <>
              {method === 'DOWN_PAYMENT' && (
                <TextField
                  label="Down payment"
                  value={downText}
                  onChangeText={setDownText}
                  keyboardType="decimal-pad"
                  prefix="₱"
                  error={downText && downPayment === null ? 'Enter an amount like 150 or 150.50.' : null}
                  hint={
                    downPayment !== null ? `${formatPeso(Math.max(0, quote.total - downPayment))} left to pay later` : undefined
                  }
                />
              )}
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
                  error={cashText && cashReceived === null ? 'Enter an amount like 500.' : null}
                  hint={
                    cashReceived !== null && cashReceived >= payingNow
                      ? `Change: ${formatPeso(changeDue(cashReceived, payingNow))}`
                      : cashReceived !== null
                        ? `Short by ${formatPeso(payingNow - cashReceived)}`
                        : undefined
                  }
                />
              ) : (
                <TextField
                  label="GCash reference number"
                  value={gcashRef}
                  onChangeText={setGcashRef}
                  keyboardType="number-pad"
                  error={gcashRef.trim() ? null : 'Required for GCash payments.'}
                />
              )}
            </>
          )}
        </Section>

        {action.error && <Notice tone="danger">{action.error}</Notice>}
        <Row wrap>
          <Button label="Cancel" kind="secondary" onPress={() => router.back()} />
          <Button
            label={paying ? `Save order and take ${formatPeso(payingNow)}` : 'Save order'}
            icon="check"
            onPress={save}
            busy={action.busy}
            disabled={!canSave}
            style={styles.flex}
          />
        </Row>
        {!customerId && <Text tone="muted">Pick a customer to save the order.</Text>}
      </Screen>

      {addingCustomer && (
        <CustomerDialog
          visible
          customer={null}
          initialName={search.trim()}
          onClose={() => setAddingCustomer(false)}
          onSaved={(id) => {
            setCustomerId(id);
            setSearch('');
          }}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pad: { padding: space.lg },
  top: { alignItems: 'flex-start' },
  weight: { width: 180 },
  loads: { gap: space.xs, flex: 1, minWidth: 220 },
  summary: { padding: space.lg, gap: space.sm },
});
