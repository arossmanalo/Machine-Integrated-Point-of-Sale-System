import { useState } from 'react';
import { ScrollView, Share, StyleSheet, View } from 'react-native';

import { formatShopDate, formatShopDayShort, MONTH_NAMES, toShopDate } from '@/domain/dates';
import { formatPeso, parsePesoInput } from '@/domain/money';
import { can } from '@/domain/permissions';
import {
  ALL_TIME,
  periodFigures,
  periodRange,
  REPORT_PERIODS,
  sumFigures,
  yearFigures,
  type PeriodFigures,
  type ReportData,
  type ReportPeriod,
} from '@/domain/reports';
import { addExpense, deleteExpense, EXPENSE_CATEGORIES, listExpenses } from '@/services/expenses';
import { listAllPayments, listOrderSummaries } from '@/services/orders';
import { useApp } from '@/state/AppProvider';
import { useAction, useData } from '@/state/hooks';
import { Button } from '@/ui/Button';
import { Choice, Dialog, Stepper } from '@/ui/controls';
import { EmptyState, ListRow, Notice, Panel, Row, Screen, Section, Stat } from '@/ui/layout';
import { ManageScreen } from '@/ui/ManagerGate';
import { DailyReportView } from '@/ui/reports/DailyReportView';
import { Text } from '@/ui/Text';
import { TextField } from '@/ui/TextField';
import { colors, space } from '@/ui/theme';

type Tab = 'daily' | 'summary' | 'year' | 'expenses';

function figuresText(title: string, f: PeriodFigures): string {
  return [
    title,
    `Orders: ${f.orders} (${f.loads} loads, ${f.audited} audited)`,
    `Money received: ${formatPeso(f.revenue)}`,
    f.revenueFromEarlierOrders > 0 ? `  of which for orders placed earlier: ${formatPeso(f.revenueFromEarlierOrders)}` : null,
    `Expenses: ${formatPeso(f.expenses)}`,
    `Net: ${formatPeso(f.net)}`,
  ]
    .filter(Boolean)
    .join('\n');
}

export default function Reports() {
  const { ctx } = useApp();
  const [tab, setTab] = useState<Tab>('daily');
  const data = useData((c): ReportData & { expenseRows: ReturnType<typeof listExpenses> } => {
    const expenseRows = listExpenses(c);
    return {
      orders: listOrderSummaries(c).map((s) => ({
        id: s.order.id,
        placedAt: s.order.placedAt,
        loadCount: s.order.loadCount,
        status: s.order.status,
        voided: s.order.voidedAt !== null,
      })),
      payments: listAllPayments(c),
      expenses: expenseRows,
      expenseRows,
    };
  });

  return (
    <ManageScreen title="Reports" allowed={can.viewReports}>
      <Screen>
        <Choice
          value={tab}
          onChange={setTab}
          options={[
            { value: 'daily', label: 'Daily report' },
            { value: 'summary', label: 'Summary' },
            { value: 'year', label: 'By month' },
            { value: 'expenses', label: 'Expenses' },
          ]}
        />
        <Text variant="caption" tone="muted">
          Money is counted on the day it was paid. Orders and loads are counted on the day they were placed. Voided
          orders are left out.
        </Text>
        {tab === 'daily' && <DailyReportView now={ctx.now()} />}
        {tab === 'summary' && <Summary data={data} now={ctx.now()} />}
        {tab === 'year' && <YearTable data={data} now={ctx.now()} />}
        {tab === 'expenses' && <Expenses rows={data.expenseRows} />}
      </Screen>
    </ManageScreen>
  );
}

function Summary({ data, now }: { data: ReportData; now: number }) {
  const [period, setPeriod] = useState<ReportPeriod>('Today');
  const range = periodRange(period, now);
  const f = periodFigures(data, range);
  const allTime = periodFigures(data, ALL_TIME);
  const label = `${period} (${formatShopDayShort(range.start)}${period === 'Today' ? '' : ` to ${formatShopDayShort(range.end - 1)}`})`;

  return (
    <>
      <Choice value={period} onChange={setPeriod} options={REPORT_PERIODS.map((p) => ({ value: p, label: p }))} />
      <Section title={label}>
        <Row wrap>
          <Stat label="Orders" value={String(f.orders)} note={`${f.loads} loads · ${f.audited} audited`} />
          <Stat
            label="Money received"
            value={formatPeso(f.revenue)}
            tone="success"
            note={f.revenueFromEarlierOrders > 0 ? `${formatPeso(f.revenueFromEarlierOrders)} paid for orders placed earlier` : undefined}
          />
          <Stat label="Expenses" value={formatPeso(f.expenses)} tone="danger" />
          <Stat label="Net" value={formatPeso(f.net)} tone={f.net >= 0 ? 'success' : 'danger'} />
        </Row>
      </Section>
      <Section title="All time">
        <Row wrap>
          <Stat label="Money received" value={formatPeso(allTime.revenue)} />
          <Stat label="Expenses" value={formatPeso(allTime.expenses)} />
          <Stat label="Net" value={formatPeso(allTime.net)} tone={allTime.net >= 0 ? 'success' : 'danger'} />
        </Row>
      </Section>
      <Button
        label="Share this summary"
        kind="secondary"
        icon="share-variant-outline"
        onPress={() =>
          void Share.share({
            title: 'Laundry report',
            message: `${figuresText(`AR Laundry, ${label}`, f)}\n\n${figuresText('All time', allTime)}`,
          })
        }
      />
    </>
  );
}

function YearTable({ data, now }: { data: ReportData; now: number }) {
  const [year, setYear] = useState(toShopDate(now).year);
  const months = yearFigures(data, year);
  const total = sumFigures(months);
  const columns = ['Month', 'Orders', 'Loads', 'Received', 'Expenses', 'Net'];
  const rows = [
    ...months.map((m, i) => [MONTH_NAMES[i], m.orders, m.loads, formatPeso(m.revenue), formatPeso(m.expenses), formatPeso(m.net)]),
    ['Year', total.orders, total.loads, formatPeso(total.revenue), formatPeso(total.expenses), formatPeso(total.net)],
  ];
  return (
    <>
      <Row>
        <Text variant="heading" style={{ flex: 1 }}>
          {String(year)}
        </Text>
        <Stepper label="year" value={year} min={2020} max={toShopDate(now).year} onChange={setYear} />
      </Row>
      <Panel>
        <ScrollView horizontal>
          <View>
            {[columns, ...rows].map((row, r) => (
              <View key={r} style={[styles.tableRow, r === 0 && styles.tableHead, r === rows.length && styles.tableTotal]}>
                {row.map((cell, c) => (
                  <Text
                    key={c}
                    variant={r === 0 || r === rows.length ? 'label' : 'body'}
                    numeric
                    style={[styles.cell, c === 0 ? styles.firstCell : styles.numberCell]}
                  >
                    {String(cell)}
                  </Text>
                ))}
              </View>
            ))}
          </View>
        </ScrollView>
      </Panel>
    </>
  );
}

function Expenses({ rows }: { rows: ReturnType<typeof listExpenses> }) {
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  const action = useAction();
  const q = query.trim().toLowerCase();
  const filtered = rows.filter((e) => !q || e.name.toLowerCase().includes(q) || e.category.toLowerCase().includes(q));
  return (
    <Section title="Expenses" action={<Button label="Record expense" icon="plus" onPress={() => setAdding(true)} />}>
      <TextField label="Search" value={query} onChangeText={setQuery} placeholder="Name or category" />
      <Panel>
        {filtered.length === 0 ? (
          <EmptyState icon="cash-minus" title="No expenses" body="Record rent, utilities and supplies to see the shop's net." />
        ) : (
          filtered.map((expense, index) => (
            <ListRow
              key={expense.id}
              title={expense.name}
              subtitle={`${expense.category} · ${formatShopDate(expense.incurredAt)}`}
              right={
                <Row>
                  <Text variant="bodyStrong" tone="danger" numeric>
                    {formatPeso(expense.cost)}
                  </Text>
                  <Button
                    label="Delete"
                    kind="quiet"
                    onPress={() => void action.run((c) => deleteExpense(c, expense.id))}
                  />
                </Row>
              }
              last={index === filtered.length - 1}
            />
          ))
        )}
      </Panel>
      {action.error && <Notice tone="danger">{action.error}</Notice>}
      {adding && <ExpenseDialog onClose={() => setAdding(false)} />}
    </Section>
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;

function ExpenseDialog({ onClose }: { onClose: () => void }) {
  const { ctx } = useApp();
  const action = useAction();
  const [name, setName] = useState('');
  const [category, setCategory] = useState<string>(EXPENSE_CATEGORIES[0]);
  const [costText, setCostText] = useState('');
  const [daysBack, setDaysBack] = useState(0);
  const cost = parsePesoInput(costText);
  const incurredAt = ctx.now() - daysBack * DAY_MS;
  return (
    <Dialog
      visible
      title="Record expense"
      onClose={onClose}
      actions={
        <>
          <Button label="Cancel" kind="secondary" onPress={onClose} />
          <Button
            label="Save expense"
            busy={action.busy}
            disabled={cost === null || !name.trim()}
            onPress={async () => {
              const result = await action.run((c) => addExpense(c, { name, category, cost: cost ?? 0, incurredAt }));
              if (result.ok) onClose();
            }}
          />
        </>
      }
    >
      <TextField label="What for" value={name} onChangeText={setName} placeholder="For example: Meralco bill" />
      <Choice label="Category" value={category} onChange={setCategory} options={EXPENSE_CATEGORIES.map((c) => ({ value: c, label: c }))} />
      <TextField label="Cost" value={costText} onChangeText={setCostText} keyboardType="decimal-pad" prefix="₱" />
      <Row>
        <View style={{ flex: 1 }}>
          <Text variant="label">Date</Text>
          <Text tone="muted">{daysBack === 0 ? 'Today' : formatShopDate(incurredAt)}</Text>
        </View>
        <Stepper label="days back" value={daysBack} min={0} max={365} onChange={setDaysBack} />
      </Row>
      {action.error && <Notice tone="danger">{action.error}</Notice>}
    </Dialog>
  );
}

const styles = StyleSheet.create({
  tableRow: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  tableHead: { backgroundColor: colors.surfaceSunken },
  tableTotal: { backgroundColor: colors.accentSoft },
  cell: { paddingVertical: space.sm, paddingHorizontal: space.md },
  firstCell: { width: 130 },
  numberCell: { width: 130, textAlign: 'right' },
});
