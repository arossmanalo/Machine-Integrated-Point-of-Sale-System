import { desc, eq } from 'drizzle-orm';

import { expenses, type ExpenseRow } from '@/db/schema';
import { UserFacingError, type ServiceContext } from '@/db/types';

import { takeNextId } from './sequences';

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

export function addExpense(ctx: ServiceContext, input: ExpenseInput): string {
  const name = input.name.trim();
  if (!name) throw new UserFacingError('Enter what the expense was for.');
  if (!Number.isInteger(input.cost) || input.cost <= 0) {
    throw new UserFacingError('Enter a cost above zero.');
  }
  return ctx.db.transaction((tx) => {
    const id = takeNextId(tx, 'expense');
    tx.insert(expenses)
      .values({ id, name, category: input.category, cost: input.cost, incurredAt: input.incurredAt })
      .run();
    return id;
  });
}

export function deleteExpense(ctx: ServiceContext, id: string): void {
  ctx.db.delete(expenses).where(eq(expenses.id, id)).run();
}
