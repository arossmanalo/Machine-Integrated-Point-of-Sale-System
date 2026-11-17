export interface StockLevel {
  currentStock: number;
  lowStockThreshold: number;
}

export function isLowStock(item: StockLevel): boolean {
  return item.currentStock <= item.lowStockThreshold;
}

/**
 * Auto-consume items (detergent, fabric softener) lose one unit per load. When there is not
 * enough stock for the whole order the item is left alone, as the old app did, so stock never
 * goes negative; the low-stock alert already flags it.
 */
export function autoConsumeAmount(currentStock: number, loads: number): number {
  return currentStock >= loads ? loads : 0;
}
