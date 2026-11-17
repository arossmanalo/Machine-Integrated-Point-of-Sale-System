import { asc, eq, isNull } from 'drizzle-orm';

import { customers, type CustomerRow } from '@/db/schema';
import { UserFacingError, type ServiceContext } from '@/db/types';

import { takeNextId } from './sequences';

export interface CustomerInput {
  name: string;
  phone: string;
  address: string;
  notes: string;
}

function clean(input: CustomerInput): CustomerInput {
  const name = input.name.trim().replace(/\s+/g, ' ');
  if (!name) throw new UserFacingError('Enter the customer name.');
  return {
    name,
    phone: input.phone.trim(),
    address: input.address.trim(),
    notes: input.notes.trim(),
  };
}

export function listCustomers(ctx: ServiceContext): CustomerRow[] {
  return ctx.db
    .select()
    .from(customers)
    .where(isNull(customers.archivedAt))
    .orderBy(asc(customers.name))
    .all();
}

export function getCustomer(ctx: ServiceContext, id: string): CustomerRow | undefined {
  return ctx.db.select().from(customers).where(eq(customers.id, id)).get();
}

export function matchesCustomer(customer: CustomerRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    customer.name.toLowerCase().includes(q) ||
    customer.phone.toLowerCase().includes(q) ||
    customer.id.toLowerCase() === q
  );
}

export function createCustomer(ctx: ServiceContext, input: CustomerInput): CustomerRow {
  const values = clean(input);
  return ctx.db.transaction((tx) => {
    const row: CustomerRow = {
      id: takeNextId(tx, 'customer'),
      ...values,
      loyaltyLoads: 0,
      createdAt: ctx.now(),
      archivedAt: null,
    };
    tx.insert(customers).values(row).run();
    return row;
  });
}

export function updateCustomer(ctx: ServiceContext, id: string, input: CustomerInput): void {
  const values = clean(input);
  ctx.db.update(customers).set(values).where(eq(customers.id, id)).run();
}

/** Hides the customer from lists. Their orders keep showing their name. */
export function archiveCustomer(ctx: ServiceContext, id: string): void {
  ctx.db.update(customers).set({ archivedAt: ctx.now() }).where(eq(customers.id, id)).run();
}
