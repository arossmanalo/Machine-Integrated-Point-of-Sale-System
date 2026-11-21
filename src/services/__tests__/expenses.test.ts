import { createTestContext, testEmployee, testOwner } from '@/db/testing';
import type { Actor } from '@/db/types';

import { addExpense, canRecordExpenses, deleteExpense, listExpenses, setEmployeesRecordExpenses } from '../expenses';

const admin: Actor = { id: 'U0003', username: 'ben', role: 'ADMIN' };
const DAY = 24 * 60 * 60 * 1000;

function bill(incurredAt: number) {
  return { name: 'Meralco', category: 'Utilities', cost: 150000, incurredAt };
}

describe('recording expenses', () => {
  it('employees can record only after the owner allows it', () => {
    const ctx = createTestContext();
    expect(canRecordExpenses(ctx, 'EMPLOYEE')).toBe(false);
    expect(() => addExpense(ctx, testEmployee, bill(ctx.now()))).toThrow('Only the owner or an admin');

    expect(() => setEmployeesRecordExpenses(ctx, admin, true)).toThrow('Only the owner');
    expect(() => setEmployeesRecordExpenses(ctx, testEmployee, true)).toThrow('Only the owner');
    setEmployeesRecordExpenses(ctx, testOwner, true);
    expect(canRecordExpenses(ctx, 'EMPLOYEE')).toBe(true);
    addExpense(ctx, testEmployee, bill(ctx.now()));
    expect(listExpenses(ctx)).toHaveLength(1);

    setEmployeesRecordExpenses(ctx, testOwner, false);
    expect(() => addExpense(ctx, testEmployee, bill(ctx.now()))).toThrow('Only the owner or an admin');
  });

  it("saves who entered it, and dates an employee's expense today", () => {
    const ctx = createTestContext();
    setEmployeesRecordExpenses(ctx, testOwner, true);
    addExpense(ctx, testEmployee, bill(ctx.now() - 5 * DAY));
    addExpense(ctx, admin, bill(ctx.now() - 5 * DAY));
    const [employeeRow, adminRow] = [...listExpenses(ctx)].sort((a, b) => b.incurredAt - a.incurredAt);
    expect(employeeRow).toMatchObject({ recordedByName: 'ana', incurredAt: ctx.now() });
    expect(adminRow).toMatchObject({ recordedByName: 'ben', incurredAt: ctx.now() - 5 * DAY });
  });

  it('employees can never delete expenses', () => {
    const ctx = createTestContext();
    setEmployeesRecordExpenses(ctx, testOwner, true);
    const id = addExpense(ctx, testEmployee, bill(ctx.now()));
    expect(() => deleteExpense(ctx, testEmployee, id)).toThrow('Only the owner or an admin');
    deleteExpense(ctx, admin, id);
    expect(listExpenses(ctx)).toEqual([]);
  });
});
