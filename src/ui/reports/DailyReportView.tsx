import { useState } from 'react';
import { Share, StyleSheet, View } from 'react-native';

import { describeRun, type DayCheck, type MachineEntry } from '@/domain/dailyReport';
import { addShopDays, formatShopDate, formatShopTime, shopDayRange, startOfShopDay } from '@/domain/dates';
import { formatPeso } from '@/domain/money';
import { dailyReportLines } from '@/printing/dailyReportText';
import { buildTextDocument } from '@/printing/escpos';
import { dailyReport } from '@/services/dailyReport';
import { getAllSettings } from '@/services/settings';
import { useData } from '@/state/hooks';
import { usePrinter } from '@/state/usePrintReceipt';

import { Button } from '../Button';
import { Badge, type BadgeTone } from '../controls';
import { EmptyState, ListRow, Panel, Row, Section, Stat } from '../layout';
import { Text } from '../Text';
import { space } from '../theme';

const CHECK_LOOKS: Record<DayCheck['tone'], { label: string; tone: BadgeTone }> = {
  ok: { label: 'OK', tone: 'success' },
  warning: { label: 'Check', tone: 'warning' },
  danger: { label: 'Look into', tone: 'danger' },
};

const ENTRY_LABELS: Record<MachineEntry['kind'], string> = {
  ORDER: 'Order',
  OVERRIDE: 'Owner override',
  OVERRIDE_DENIED: 'Wrong owner PIN',
  TEST: 'Test start',
  TOP_UP: 'Top-up',
};

const NOT_RUN: Partial<Record<MachineEntry['result'], string>> = {
  REJECTED: 'refused, did not run',
  BUSY: 'busy, did not run',
  FAILED: 'not sent, did not run',
  NOT_CONNECTED: 'offline, did not run',
  TIMEOUT: 'no answer, may have run',
  PENDING: 'no reply, may have run',
};

function entryLabel(entry: MachineEntry): string {
  const parts = [
    formatShopTime(entry.at),
    ENTRY_LABELS[entry.kind],
    entry.orderId ? `${entry.orderId}${entry.customerName ? ` ${entry.customerName}` : ''}` : null,
    entry.loadNumber !== null ? `load ${entry.loadNumber}` : null,
    entry.overrideReason,
    entry.charge ? formatPeso(entry.charge) : null,
    entry.employeeName,
    NOT_RUN[entry.result] ?? null,
  ];
  return parts.filter(Boolean).join(' · ');
}

/**
 * One shop day: the money, which machines ran each load, what each machine did, and the checks
 * that show whether the counts agree. Printable on the receipt printer.
 */
export function DailyReportView({ now }: { now: number }) {
  const today = startOfShopDay(now);
  const [day, setDay] = useState(today);
  const range = shopDayRange(day);
  const report = useData((c) => dailyReport(c, range), [range.start]);
  const header = useData((c) => getAllSettings(c.db).receiptHeader);
  const { printBytes, printing } = usePrinter();
  const dayLabel = formatShopDate(day);
  const f = report.figures;

  const lines = () => dailyReportLines(report, dayLabel);

  return (
    <>
      <Row>
        <Button label="Previous day" kind="secondary" icon="chevron-left" onPress={() => setDay(addShopDays(day, -1))} />
        <Text variant="heading" style={styles.flex}>
          {day === today ? `Today, ${dayLabel}` : dayLabel}
        </Text>
        <Button
          label="Next day"
          kind="secondary"
          icon="chevron-right"
          disabled={day >= today}
          onPress={() => setDay(addShopDays(day, 1))}
        />
      </Row>

      <Section title="Sales">
        <Row wrap>
          <Stat
            label="Orders"
            value={String(f.orders)}
            note={`${f.loads} loads${report.voidedOrders > 0 ? ` · ${report.voidedOrders} voided` : ''}`}
          />
          <Stat
            label="Money received"
            value={formatPeso(f.revenue)}
            tone="success"
            note={`Cash ${formatPeso(report.cash)} · GCash ${formatPeso(report.gcash)}`}
          />
          <Stat label="Dryer top-ups" value={formatPeso(report.topUps.amount)} note={`${report.topUps.count} top-ups`} />
          <Stat label="Expenses" value={formatPeso(f.expenses)} tone="danger" />
          <Stat label="Net" value={formatPeso(f.net)} tone={f.net >= 0 ? 'success' : 'danger'} />
          <Stat label="Still owed" value={formatPeso(report.unpaid)} note="On this day's orders" />
        </Row>
        {f.revenueFromEarlierOrders > 0 && (
          <Text tone="muted">{`${formatPeso(f.revenueFromEarlierOrders)} of the money received paid for orders placed earlier.`}</Text>
        )}
      </Section>

      <Section title="Checks" description="Every load sold should have one washer start and one dryer start.">
        <Panel>
          {report.checks.map((check, index) => (
            <ListRow
              key={check.text}
              title={check.text}
              right={<Badge label={CHECK_LOOKS[check.tone].label} tone={CHECK_LOOKS[check.tone].tone} />}
              last={index === report.checks.length - 1}
            />
          ))}
        </Panel>
      </Section>

      <Section title="Loads by order" description="Orders placed this day, and earlier orders that used a machine this day.">
        <Panel>
          {report.orders.length === 0 ? (
            <EmptyState icon="receipt-text-outline" title="No orders" body="Nothing was ordered or run on this day." />
          ) : (
            report.orders.map((entry, index) => (
              <ListRow
                key={entry.order.id}
                title={`${entry.order.id} · ${entry.order.customerName}`}
                subtitle={
                  <View style={styles.lines}>
                    {entry.loads.map((load) => (
                      <Text key={load.number} tone="muted">
                        {`Load ${load.number}: washer ${describeRun(load.washer)} · dryer ${describeRun(load.dryer)}`}
                      </Text>
                    ))}
                    {entry.overrides.map((run) => (
                      <Text key={run.at} tone="warning">{`Override: ${describeRun(run)}`}</Text>
                    ))}
                  </View>
                }
                right={
                  <View style={styles.right}>
                    {entry.order.voided && <Badge label="Voided" tone="danger" />}
                    {!entry.placedToday && <Badge label="Earlier order" />}
                    {!entry.order.voided && entry.order.balance > 0 && (
                      <Text variant="caption" tone="danger" numeric>{`Owes ${formatPeso(entry.order.balance)}`}</Text>
                    )}
                  </View>
                }
                last={index === report.orders.length - 1}
              />
            ))
          )}
        </Panel>
      </Section>

      <Section title="Machines" description="Everything each machine did this day, including starts that did not go out.">
        <Panel>
          {report.machines.map((machine, index) => (
            <ListRow
              key={`${machine.type}-${machine.name}`}
              title={`${machine.name}: ${machine.orderStarts} order start${machine.orderStarts === 1 ? '' : 's'}${
                machine.topUps ? `, ${machine.topUps} top-up${machine.topUps === 1 ? '' : 's'}` : ''
              }${machine.overrides ? `, ${machine.overrides} override${machine.overrides === 1 ? '' : 's'}` : ''}${
                machine.tests ? `, ${machine.tests} test${machine.tests === 1 ? '' : 's'}` : ''
              }`}
              subtitle={
                machine.entries.length === 0 ? (
                  'Not used.'
                ) : (
                  <View style={styles.lines}>
                    {machine.entries.map((entry) => (
                      <Text key={entry.id} tone={NOT_RUN[entry.result] ? 'danger' : 'muted'}>
                        {entryLabel(entry)}
                      </Text>
                    ))}
                  </View>
                )
              }
              last={index === report.machines.length - 1}
            />
          ))}
        </Panel>
      </Section>

      <Row wrap>
        <Button
          label="Print report"
          icon="printer-outline"
          busy={printing}
          onPress={() => void printBytes(() => buildTextDocument(header, lines()), `Report for ${dayLabel} printed`)}
        />
        <Button
          label="Share as text"
          kind="secondary"
          icon="share-variant-outline"
          onPress={() => void Share.share({ title: `Daily report ${dayLabel}`, message: [header, ...lines()].join('\n') })}
        />
      </Row>
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, textAlign: 'center' },
  lines: { gap: space.xs },
  right: { alignItems: 'flex-end', gap: space.xs },
});
