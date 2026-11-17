import type { Centavos } from './money';
import { addShopDays, inRange, shopMonthRange, startOfShopDay, startOfShopMonth, type TimeRange } from './dates';

/*
 * Revenue is counted on the day each payment was received. Order and load counts are counted
 * on the day the order was placed. Voided orders count for neither.
 */

export interface ReportOrder {
  id: string;
  placedAt: number;
  loadCount: number;
  status: string;
  voided: boolean;
}

export interface ReportPayment {
  orderId: string;
  amount: Centavos;
  receivedAt: number;
}

export interface ReportExpense {
  cost: Centavos;
  incurredAt: number;
}

export interface ReportData {
  orders: readonly ReportOrder[];
  payments: readonly ReportPayment[];
  expenses: readonly ReportExpense[];
}

export interface PeriodFigures {
  orders: number;
  loads: number;
  audited: number;
  revenue: Centavos;
  /** Part of revenue that paid for orders placed before this period started. */
  revenueFromEarlierOrders: Centavos;
  expenses: Centavos;
  net: Centavos;
}

export function periodFigures(data: ReportData, range: TimeRange): PeriodFigures {
  const placedAt = new Map<string, number>();
  const voided = new Set<string>();
  let orders = 0;
  let loads = 0;
  let audited = 0;
  for (const order of data.orders) {
    placedAt.set(order.id, order.placedAt);
    if (order.voided) {
      voided.add(order.id);
      continue;
    }
    if (!inRange(order.placedAt, range)) continue;
    orders += 1;
    loads += order.loadCount;
    if (order.status === 'AUDITED') audited += 1;
  }
  let revenue = 0;
  let revenueFromEarlierOrders = 0;
  for (const payment of data.payments) {
    if (voided.has(payment.orderId) || !inRange(payment.receivedAt, range)) continue;
    revenue += payment.amount;
    const placed = placedAt.get(payment.orderId);
    if (placed !== undefined && placed < range.start) revenueFromEarlierOrders += payment.amount;
  }
  const expenses = data.expenses
    .filter((expense) => inRange(expense.incurredAt, range))
    .reduce((sum, expense) => sum + expense.cost, 0);
  return { orders, loads, audited, revenue, revenueFromEarlierOrders, expenses, net: revenue - expenses };
}

export const REPORT_PERIODS = ['Today', 'Last 7 days', 'This month'] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];

export function periodRange(period: ReportPeriod, now: number): TimeRange {
  const todayStart = startOfShopDay(now);
  const end = addShopDays(todayStart, 1);
  if (period === 'Today') return { start: todayStart, end };
  if (period === 'Last 7 days') return { start: addShopDays(todayStart, -6), end };
  return { start: startOfShopMonth(now), end };
}

export function yearFigures(data: ReportData, year: number): PeriodFigures[] {
  return Array.from({ length: 12 }, (_, month) => periodFigures(data, shopMonthRange(year, month)));
}

export function sumFigures(rows: readonly PeriodFigures[]): PeriodFigures {
  return rows.reduce<PeriodFigures>(
    (total, row) => ({
      orders: total.orders + row.orders,
      loads: total.loads + row.loads,
      audited: total.audited + row.audited,
      revenue: total.revenue + row.revenue,
      revenueFromEarlierOrders: total.revenueFromEarlierOrders + row.revenueFromEarlierOrders,
      expenses: total.expenses + row.expenses,
      net: total.net + row.net,
    }),
    { orders: 0, loads: 0, audited: 0, revenue: 0, revenueFromEarlierOrders: 0, expenses: 0, net: 0 },
  );
}

export const ALL_TIME: TimeRange = { start: Number.MIN_SAFE_INTEGER, end: Number.MAX_SAFE_INTEGER };
