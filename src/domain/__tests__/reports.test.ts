import { shopDayRange, shopMidnight } from '../dates';
import { periodFigures, periodRange, sumFigures, yearFigures, type ReportData } from '../reports';

const nov10 = shopMidnight(2026, 10, 10) + 3600000;
const nov17 = shopMidnight(2026, 10, 17) + 3600000;

const data: ReportData = {
  orders: [
    { id: 'T0001', placedAt: nov10, loadCount: 2, status: 'COMPLETED', voided: false },
    { id: 'T0002', placedAt: nov17, loadCount: 3, status: 'AUDITED', voided: false },
    { id: 'T0003', placedAt: nov17, loadCount: 1, status: 'PENDING', voided: true },
  ],
  payments: [
    { orderId: 'T0001', amount: 10000, receivedAt: nov10 },
    { orderId: 'T0001', amount: 34000, receivedAt: nov17 },
    { orderId: 'T0002', amount: 66000, receivedAt: nov17 },
    { orderId: 'T0003', amount: 22000, receivedAt: nov17 },
  ],
  expenses: [{ cost: 5000, incurredAt: nov17 }],
};

describe('periodFigures', () => {
  it('counts revenue on the payment day and flags payments for earlier orders', () => {
    const today = periodFigures(data, shopDayRange(nov17));
    expect(today).toEqual({
      orders: 1,
      loads: 3,
      audited: 1,
      revenue: 100000,
      revenueFromEarlierOrders: 34000,
      expenses: 5000,
      net: 95000,
    });
  });

  it('counts the down payment on the day it was taken', () => {
    const day = periodFigures(data, shopDayRange(nov10));
    expect(day.revenue).toBe(10000);
    expect(day.orders).toBe(1);
  });

  it('ignores voided orders and their payments', () => {
    const month = sumFigures(yearFigures(data, 2026));
    expect(month.orders).toBe(2);
    expect(month.revenue).toBe(110000);
  });
});

describe('periodRange', () => {
  it('builds today, last 7 days and this month in shop time', () => {
    expect(periodRange('Today', nov17)).toEqual(shopDayRange(nov17));
    expect(periodRange('Last 7 days', nov17).start).toBe(shopMidnight(2026, 10, 11));
    expect(periodRange('This month', nov17).start).toBe(shopMidnight(2026, 10, 1));
  });
});
