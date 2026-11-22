import { useState } from 'react';

import { centavosToInput, formatPeso, parsePesoInput } from '@/domain/money';
import { TOP_UP_CHOICES, topUpPriceFor, type TopUpMinutes, type TopUpPrices } from '@/domain/machinePolicy';
import { can } from '@/domain/permissions';
import { BUILT_IN_STATUSES, normalizeStatus, statusLabel } from '@/domain/statuses';
import type { PrinterInfo } from '@/printing/ReceiptPrinter';
import { setEmployeesRecordExpenses } from '@/services/expenses';
import { getAllSettings, setSetting } from '@/services/settings';
import { useActor, useApp } from '@/state/AppProvider';
import { useAction, useData } from '@/state/hooks';
import { useToast } from '@/state/toast';
import { Button } from '@/ui/Button';
import { Toggle } from '@/ui/controls';
import { Divider, ListRow, Notice, Panel, Row, Screen, Section } from '@/ui/layout';
import { ManageScreen } from '@/ui/ManagerGate';
import { GcashQrSetting } from '@/ui/orders/GcashQr';
import { Text } from '@/ui/Text';
import { TextField } from '@/ui/TextField';
import { space } from '@/ui/theme';

export default function Settings() {
  const settings = useData((c) => getAllSettings(c.db));
  return (
    <ManageScreen title="Shop settings" allowed={can.changeSettings}>
      <Screen>
        <PriceSection current={settings.pricePerLoad} />
        <OrderTopUpSection current={settings.orderTopUpPrices} />
        <StatusSection custom={settings.customStatuses} hidden={settings.hiddenStatuses} />
        <ExpenseEntrySection allowed={settings.employeesRecordExpenses} />
        <GcashSection />
        <PrinterSection
          printerName={settings.printerName}
          printerAddress={settings.printerAddress}
          header={settings.receiptHeader}
          footer={settings.receiptFooter}
        />
      </Screen>
    </ManageScreen>
  );
}

/** Owner only: whose account customers pay into. */
function GcashSection() {
  const actor = useActor();
  if (actor.role !== 'OWNER') return null;
  return (
    <Section title="GCash payments">
      <GcashQrSetting />
    </Section>
  );
}

/** Owner only. Employees who may record expenses still never see the list or the totals. */
function ExpenseEntrySection({ allowed }: { allowed: boolean }) {
  const actor = useActor();
  const action = useAction();
  if (actor.role !== 'OWNER') return null;
  return (
    <Section title="Expenses">
      <Toggle
        label="Employees can record expenses"
        description={
          allowed
            ? 'Employees see Record expense on the Today screen. They can only enter today\'s expenses, which are saved under their name. They cannot see, change or delete expenses.'
            : 'Off: only you and admins can record expenses, in Reports and expenses.'
        }
        value={allowed}
        onChange={(value) => void action.run((c) => setEmployeesRecordExpenses(c, actor, value))}
      />
      {action.error && <Notice tone="danger">{action.error}</Notice>}
    </Section>
  );
}

/** Prices for a dryer top-up added when the order is taken; each dryer's own prices apply later. */
function OrderTopUpSection({ current }: { current: TopUpPrices }) {
  const action = useAction();
  const toast = useToast();
  const [texts, setTexts] = useState<Record<TopUpMinutes, string>>(() => ({
    5: centavosToInput(current.topUpPrice),
    10: centavosToInput(current.topUpPrice10),
    15: centavosToInput(current.topUpPrice15),
    20: centavosToInput(current.topUpPrice20),
  }));
  const parsed = TOP_UP_CHOICES.map((minutes) => (texts[minutes].trim() === '' ? 0 : parsePesoInput(texts[minutes])));
  const invalid = parsed.some((price) => price === null);
  const prices: TopUpPrices = {
    topUpPrice: parsed[0] ?? 0,
    topUpPrice10: parsed[1] ?? 0,
    topUpPrice15: parsed[2] ?? 0,
    topUpPrice20: parsed[3] ?? 0,
  };
  const changed = TOP_UP_CHOICES.some((minutes) => topUpPriceFor(prices, minutes) !== topUpPriceFor(current, minutes));
  return (
    <Section
      title="Dryer top-ups on new orders"
      description="Staff can add extra drying time when taking an order; it is added when the load starts in a dryer. Leave a length blank to not offer it."
    >
      <Row wrap style={{ alignItems: 'flex-start' }}>
        {TOP_UP_CHOICES.map((minutes) => (
          <TextField
            key={minutes}
            label={`${minutes} min price`}
            value={texts[minutes]}
            onChangeText={(text) => setTexts({ ...texts, [minutes]: text })}
            keyboardType="decimal-pad"
            prefix="₱"
            style={{ flex: 1, minWidth: 120 }}
          />
        ))}
      </Row>
      {invalid && <Text tone="danger">Enter prices like 20 or 20.50, or leave blank.</Text>}
      <Row>
        <Button
          label="Save top-up prices"
          disabled={invalid || !changed}
          busy={action.busy}
          onPress={async () => {
            const result = await action.run((c) => setSetting(c.db, 'orderTopUpPrices', prices));
            if (result.ok) toast('Top-up prices for new orders saved');
          }}
        />
      </Row>
      {action.error && <Notice tone="danger">{action.error}</Notice>}
    </Section>
  );
}

function PriceSection({ current }: { current: number }) {
  const action = useAction();
  const toast = useToast();
  const [text, setText] = useState(centavosToInput(current));
  const price = parsePesoInput(text);
  return (
    <Section title="Price per load" description="Wash, dry & fold. Existing orders keep the price they were sold at.">
      <Row wrap style={{ alignItems: 'flex-end' }}>
        <TextField
          label="Price"
          value={text}
          onChangeText={setText}
          keyboardType="decimal-pad"
          prefix="₱"
          error={price === null ? 'Enter an amount like 220.' : null}
          style={{ width: 200 }}
        />
        <Button
          label="Save price"
          disabled={price === null || price === current}
          busy={action.busy}
          onPress={async () => {
            if (price === null) return;
            const result = await action.run((c) => setSetting(c.db, 'pricePerLoad', price));
            if (result.ok) toast(`Price per load is now ${formatPeso(price)}`);
          }}
        />
      </Row>
      {action.error && <Notice tone="danger">{action.error}</Notice>}
    </Section>
  );
}

function StatusSection({ custom, hidden }: { custom: string[]; hidden: string[] }) {
  const action = useAction();
  const [newStatus, setNewStatus] = useState('');
  const all = [...BUILT_IN_STATUSES, ...custom.filter((s) => !(BUILT_IN_STATUSES as readonly string[]).includes(s))];
  const required = ['PENDING', 'COMPLETED'];
  return (
    <Section title="Order statuses" description="Hidden statuses stay on old orders but are not offered for new changes.">
      <Panel style={{ paddingHorizontal: space.lg }}>
        {all.map((status, index) => (
          <Row key={status} style={{ paddingVertical: space.xs }}>
            <Toggle
              label={statusLabel(status)}
              description={required.includes(status) ? 'Always shown' : undefined}
              value={!hidden.includes(status)}
              disabled={required.includes(status)}
              onChange={(show) =>
                void action.run((c) =>
                  setSetting(c.db, 'hiddenStatuses', show ? hidden.filter((s) => s !== status) : [...hidden, status]),
                )
              }
            />
            {index < all.length - 1 && <Divider />}
          </Row>
        ))}
      </Panel>
      <Row wrap style={{ alignItems: 'flex-end' }}>
        <TextField
          label="Add a status"
          value={newStatus}
          onChangeText={setNewStatus}
          placeholder="For example: For delivery"
          style={{ flex: 1, minWidth: 220 }}
        />
        <Button
          label="Add status"
          kind="secondary"
          disabled={!newStatus.trim() || all.includes(normalizeStatus(newStatus))}
          onPress={async () => {
            const status = normalizeStatus(newStatus);
            const result = await action.run((c) => setSetting(c.db, 'customStatuses', [...custom, status]));
            if (result.ok) setNewStatus('');
          }}
        />
      </Row>
      {action.error && <Notice tone="danger">{action.error}</Notice>}
    </Section>
  );
}

function PrinterSection({
  printerName,
  printerAddress,
  header,
  footer,
}: {
  printerName: string | null;
  printerAddress: string | null;
  header: string;
  footer: string;
}) {
  const { printer } = useApp();
  const action = useAction();
  const toast = useToast();
  const [printers, setPrinters] = useState<PrinterInfo[] | null>(null);
  const [headerText, setHeaderText] = useState(header);
  const [footerText, setFooterText] = useState(footer);

  async function findPrinters() {
    const result = await action.run(async () => {
      if (!(await printer.ensurePermission())) throw new Error('Bluetooth permission was not allowed.');
      return printer.listPrinters();
    });
    if (result.ok) setPrinters(result.value);
  }

  return (
    <Section
      title="Receipts"
      description="Every new order prints its receipt when it is saved, on a Bluetooth thermal printer paired in Android settings."
    >
      <Row wrap>
        <Text style={{ flex: 1 }}>{printerName ? `Printer: ${printerName}` : 'No printer chosen yet.'}</Text>
        <Button label="Find paired printers" kind="secondary" icon="printer-search" onPress={findPrinters} busy={action.busy} />
      </Row>
      {printers && (
        <Panel>
          {printers.length === 0 ? (
            <Text tone="muted" style={{ padding: space.lg }}>
              No paired printers. Pair the printer in Android Bluetooth settings first.
            </Text>
          ) : (
            printers.map((p, index) => (
              <ListRow
                key={p.address}
                title={p.name}
                subtitle={p.address === printerAddress ? 'Selected' : p.address}
                onPress={async () => {
                  const result = await action.run((c) => {
                    setSetting(c.db, 'printerAddress', p.address);
                    setSetting(c.db, 'printerName', p.name);
                  });
                  if (result.ok) toast(`${p.name} will print receipts`);
                }}
                last={index === printers.length - 1}
              />
            ))
          )}
        </Panel>
      )}
      <TextField label="Receipt heading" value={headerText} onChangeText={setHeaderText} />
      <TextField label="Receipt footer" value={footerText} onChangeText={setFooterText} multiline />
      <Button
        label="Save receipt text"
        kind="secondary"
        disabled={headerText === header && footerText === footer}
        onPress={async () => {
          const result = await action.run((c) => {
            setSetting(c.db, 'receiptHeader', headerText.trim());
            setSetting(c.db, 'receiptFooter', footerText.trim());
          });
          if (result.ok) toast('Receipt text saved');
        }}
      />
      {action.error && <Notice tone="danger">{action.error}</Notice>}
    </Section>
  );
}
