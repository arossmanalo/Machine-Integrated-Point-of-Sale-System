import { desc, eq } from 'drizzle-orm';

import { can, type Role } from '@/domain/permissions';
import { expenses, type ExpenseRow } from '@/db/schema';
import { UserFacingError, type Actor, type ServiceContext } from '@/db/types';

import { takeNextId } from './sequences';
import { getSetting, setSetting } from './settings';

export const EXPENSE_CATEGORIES = [
  'Utilities',
  'Supplies',
  'Rent',
  'Maintenance',
  'Marketing',
  'Others',
] as const;

export interface ExpenseInput {
  name: string;
  category: string;
  cost: number;
  incurredAt: number;
}

export function listExpenses(ctx: ServiceContext): ExpenseRow[] {
  return ctx.db.select().from(expenses).orderBy(desc(expenses.incurredAt)).all();
}

/** Managers always; employees only while the owner allows it in Shop settings. */
export function canRecordExpenses(ctx: ServiceContext, role: Role): boolean {
  return can.manageExpenses(role) || (role === 'EMPLOYEE' && getSetting(ctx.db, 'employeesRecordExpenses'));
}

/** Owner only: lets employees enter expenses, without seeing or changing the expense list. */
export function setEmployeesRecordExpenses(ctx: ServiceContext, actor: Actor, allowed: boolean): void {
  if (actor.role !== 'OWNER') throw new UserFacingError('Only the owner can change this.');
  setSetting(ctx.db, 'employeesRecordExpenses', allowed);
}

/**
 * Records an expense under the name of whoever entered it. Employees can only enter today's
 * expenses: the date is set to now, so they cannot place one in an earlier day's report.
 */
export function addExpense(ctx: ServiceContext, actor: Actor, input: ExpenseInput): string {
  if (!canRecordExpenses(ctx, actor.role)) {
    throw new UserFacingError('Only the owner or an admin can record expenses.');
  }
  const name = input.name.trim();
  if (!name) throw new UserFacingError('Enter what the expense was for.');
  if (!Number.isInteger(input.cost) || input.cost <= 0) {
    throw new UserFacingError('Enter a cost above zero.');
  }
  const incurredAt = can.manageExpenses(actor.role) ? input.incurredAt : ctx.now();
  return ctx.db.transaction((tx) => {
    const id = takeNextId(tx, 'expense');
    tx.insert(expenses)
      .values({ id, name, category: input.category, cost: input.cost, incurredAt, recordedByName: actor.username })
      .run();
    return id;
  });
}

export function deleteExpense(ctx: ServiceContext, actor: Actor, id: string): void {
  if (!can.manageExpenses(actor.role)) throw new UserFacingError('Only the owner or an admin can delete expenses.');
  ctx.db.delete(expenses).where(eq(expenses.id, id)).run();
}
