import { asc, eq, isNull, sql } from 'drizzle-orm';

import { inventoryItems, type InventoryItemRow } from '@/db/schema';
import { UserFacingError, type ServiceContext } from '@/db/types';

import { takeNextId } from './sequences';

export interface InventoryInput {
  name: string;
  currentStock: number;
  lowStockThreshold: number;
  unit: string;
  autoConsume: boolean;
  addOnPrice: number;
}

function clean(input: InventoryInput): InventoryInput {
  const name = input.name.trim();
  if (!name) throw new UserFacingError('Enter the item name.');
  if (!input.unit.trim()) throw new UserFacingError('Enter a unit, such as pcs, L or kg.');
  const counts = [input.currentStock, input.lowStockThreshold];
  if (counts.some((n) => !Number.isInteger(n) || n < 0)) {
    throw new UserFacingError('Stock and threshold must be whole numbers, 0 or more.');
  }
  if (!Number.isInteger(input.addOnPrice) || input.addOnPrice < 0) {
    throw new UserFacingError('The add-on price cannot be negative.');
  }
  return { ...input, name, unit: input.unit.trim() };
}

export function listInventory(ctx: ServiceContext): InventoryItemRow[] {
  return ctx.db
    .select()
    .from(inventoryItems)
    .where(isNull(inventoryItems.archivedAt))
    .orderBy(asc(inventoryItems.name))
    .all();
}

export function createInventoryItem(ctx: ServiceContext, input: InventoryInput): string {
  const values = clean(input);
  return ctx.db.transaction((tx) => {
    const id = takeNextId(tx, 'inventory');
    tx.insert(inventoryItems).values({ id, ...values, archivedAt: null }).run();
    return id;
  });
}

export function updateInventoryItem(ctx: ServiceContext, id: string, input: InventoryInput): void {
  ctx.db.update(inventoryItems).set(clean(input)).where(eq(inventoryItems.id, id)).run();
}

/** Restock (positive) or consume (negative). Stock cannot go below zero. */
export function adjustStock(ctx: ServiceContext, id: string, delta: number): void {
  if (!Number.isInteger(delta) || delta === 0) {
    throw new UserFacingError('Enter a whole number quantity.');
  }
  ctx.db.transaction((tx) => {
    const item = tx.select().from(inventoryItems).where(eq(inventoryItems.id, id)).get();
    if (!item) throw new UserFacingError('That item no longer exists.');
    if (item.currentStock + delta < 0) {
      throw new UserFacingError(`Only ${item.currentStock} ${item.unit} left.`);
    }
    tx.update(inventoryItems)
      .set({ currentStock: sql`${inventoryItems.currentStock} + ${delta}` })
      .where(eq(inventoryItems.id, id))
      .run();
  });
}

export function archiveInventoryItem(ctx: ServiceContext, id: string): void {
  ctx.db.update(inventoryItems).set({ archivedAt: ctx.now() }).where(eq(inventoryItems.id, id)).run();
}
