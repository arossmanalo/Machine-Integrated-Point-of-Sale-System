import { asc } from 'drizzle-orm';

import type { TimeRange } from '@/domain/dates';
import { buildDailyReport, type DailyReport } from '@/domain/dailyReport';
import { machineUnlocks } from '@/db/schema';
import type { ServiceContext } from '@/db/types';

import { listExpenses } from './expenses';
import { listMachines } from './machines';
import { listAllPayments, listOrderSummaries } from './orders';

/** Everything that happened in one shop day, money and machines together. */
export function dailyReport(ctx: ServiceContext, range: TimeRange): DailyReport {
  return buildDailyReport({
    range,
    orders: listOrderSummaries(ctx).map((s) => ({
      id: s.order.id,
      customerName: s.customerName,
      placedAt: s.order.placedAt,
      loadCount: s.order.loadCount,
      status: s.order.status,
      total: s.order.total,
      paid: s.paid,
      balance: s.balance,
      voided: s.order.voidedAt !== null,
    })),
    payments: listAllPayments(ctx),
    expenses: listExpenses(ctx),
    machines: listMachines(ctx),
    events: ctx.db.select().from(machineUnlocks).orderBy(asc(machineUnlocks.id)).all(),
  });
}
