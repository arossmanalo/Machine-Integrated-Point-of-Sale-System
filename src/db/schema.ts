import { sql } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/*
 * Money columns are integer centavos. Time columns are epoch milliseconds.
 * Amount paid and balance are not stored: they are summed from `payments`.
 */

const bool = (name: string) => integer(name, { mode: 'boolean' });

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    username: text('username').notNull(),
    /** Null for accounts imported from the old app until the owner sets a password. */
    passwordHash: text('password_hash'),
    role: text('role', { enum: ['OWNER', 'ADMIN', 'EMPLOYEE'] }).notNull(),
    active: bool('active').notNull().default(true),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [uniqueIndex('users_username_unique').on(sql`lower(${t.username})`)],
);

export const customers = sqliteTable('customers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  phone: text('phone').notNull().default(''),
  address: text('address').notNull().default(''),
  notes: text('notes').notNull().default(''),
  loyaltyLoads: integer('loyalty_loads').notNull().default(0),
  createdAt: integer('created_at').notNull(),
  /** Customers are archived, not deleted, so their orders keep a name. */
  archivedAt: integer('archived_at'),
});

export const inventoryItems = sqliteTable('inventory_items', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  currentStock: integer('current_stock').notNull(),
  lowStockThreshold: integer('low_stock_threshold').notNull().default(5),
  unit: text('unit').notNull(),
  autoConsume: bool('auto_consume').notNull().default(false),
  /** Offered on the New order screen at addOnPrice. */
  isAddOn: bool('is_add_on').notNull().default(false),
  addOnPrice: integer('add_on_price').notNull().default(0),
  archivedAt: integer('archived_at'),
});

export const orders = sqliteTable(
  'orders',
  {
    id: text('id').primaryKey(),
    customerId: text('customer_id')
      .notNull()
      .references(() => customers.id),
    service: text('service').notNull(),
    placedAt: integer('placed_at').notNull(),
    weightKg: real('weight_kg').notNull(),
    loadCount: integer('load_count').notNull(),
    promoApplied: bool('promo_applied').notNull().default(false),
    /** Price per load at the time of sale, so later price changes do not rewrite history. */
    pricePerLoad: integer('price_per_load').notNull(),
    total: integer('total').notNull(),
    status: text('status').notNull(),
    initialPaymentMethod: text('initial_payment_method').notNull(),
    createdByUserId: text('created_by_user_id'),
    createdByName: text('created_by_name').notNull(),
    voidedAt: integer('voided_at'),
    voidedByName: text('voided_by_name'),
    voidReason: text('void_reason'),
    /** Free text carried over from the old app (its add-on list). */
    legacyNote: text('legacy_note'),
    /** Random token in the receipt's QR code; scanning it is what lets a machine run for this order. */
    qrToken: text('qr_token').notNull().default(''),
  },
  (t) => [
    index('orders_placed_at').on(t.placedAt),
    index('orders_customer').on(t.customerId),
    uniqueIndex('orders_qr_token').on(t.qrToken),
  ],
);

export const orderItems = sqliteTable('order_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  orderId: text('order_id')
    .notNull()
    .references(() => orders.id),
  inventoryItemId: text('inventory_item_id'),
  name: text('name').notNull(),
  quantity: integer('quantity').notNull(),
  unitPrice: integer('unit_price').notNull(),
});

export const payments = sqliteTable(
  'payments',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    orderId: text('order_id')
      .notNull()
      .references(() => orders.id),
    amount: integer('amount').notNull(),
    channel: text('channel', { enum: ['CASH', 'GCASH'] }).notNull(),
    gcashReference: text('gcash_reference'),
    cashReceived: integer('cash_received'),
    receivedAt: integer('received_at').notNull(),
    receivedByName: text('received_by_name').notNull(),
  },
  (t) => [index('payments_order').on(t.orderId), index('payments_received_at').on(t.receivedAt)],
);

export const expenses = sqliteTable('expenses', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  category: text('category').notNull(),
  cost: integer('cost').notNull(),
  incurredAt: integer('incurred_at').notNull(),
  /** Who typed it in; null for expenses from before this was kept and from the old app. */
  recordedByName: text('recorded_by_name'),
});

/** Key-value settings stored as JSON text. */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

/** Next number for each ID prefix, so IDs never repeat even after deletes. */
export const sequences = sqliteTable('sequences', {
  name: text('name').primaryKey(),
  next: integer('next').notNull(),
});

export const machines = sqliteTable('machines', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  type: text('type', { enum: ['WASHER', 'DRYER'] }).notNull(),
  /** Which machine controller channel (1 to 14, see LOCK_CHANNEL_TERMINALS) starts this machine. */
  hardwareChannel: integer('hardware_channel').notNull(),
  enabled: bool('enabled').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  /** One start sends pulseCount pulses of pulseOnMs, each followed by pulseOffMs. */
  pulseCount: integer('pulse_count').notNull().default(1),
  pulseOnMs: integer('pulse_on_ms').notNull().default(500),
  pulseOffMs: integer('pulse_off_ms').notNull().default(500),
  /**
   * The order picked for this machine whose start has not gone out yet. Assigning starts the
   * machine at once, so this only stays set when that start sent nothing and can be retried.
   */
  assignedOrderId: text('assigned_order_id').references(() => orders.id),
  assignedAt: integer('assigned_at'),
  assignedByName: text('assigned_by_name'),
  /** How long one start runs, for the in-use timer. */
  runMinutes: integer('run_minutes').notNull().default(40),
  /** Dryers: pulses sent for one 5-minute top-up (same pulse length and gap as a start). */
  topUpPulseCount: integer('top_up_pulse_count').notNull().default(1),
  /** Dryers: centavos added to the order's bill for each top-up. 0 means top-ups are not offered. */
  topUpPrice: integer('top_up_price').notNull().default(0),
  /** Order of the latest run, kept after the run ends so a dryer top-up can follow it. */
  runOrderId: text('run_order_id').references(() => orders.id),
  /** When the latest run ends. The machine is in use while this is in the future. */
  runEndsAt: integer('run_ends_at'),
});

/** Append-only. Nothing in the app edits or deletes these rows except the result update. */
export const machineUnlocks = sqliteTable(
  'machine_unlocks',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    at: integer('at').notNull(),
    machineId: integer('machine_id'),
    machineName: text('machine_name').notNull(),
    machineType: text('machine_type', { enum: ['WASHER', 'DRYER'] }).notNull(),
    hardwareChannel: integer('hardware_channel').notNull(),
    orderId: text('order_id'),
    employeeUserId: text('employee_user_id'),
    employeeName: text('employee_name').notNull(),
    kind: text('kind', { enum: ['ORDER', 'OVERRIDE', 'OVERRIDE_DENIED', 'TEST', 'TOP_UP'] }).notNull(),
    overrideReason: text('override_reason'),
    overrideNote: text('override_note'),
    result: text('result', {
      enum: ['PENDING', 'ACKED', 'REJECTED', 'BUSY', 'FAILED', 'TIMEOUT', 'NOT_CONNECTED', 'DENIED'],
    }).notNull(),
    resolvedAt: integer('resolved_at'),
    /** Top-ups: centavos added to the order's bill, kept here so the daily report can tally them. */
    charge: integer('charge'),
  },
  (t) => [index('unlocks_order').on(t.orderId), index('unlocks_at').on(t.at)],
);

export type UserRow = typeof users.$inferSelect;
export type CustomerRow = typeof customers.$inferSelect;
export type InventoryItemRow = typeof inventoryItems.$inferSelect;
export type OrderRow = typeof orders.$inferSelect;
export type OrderItemRow = typeof orderItems.$inferSelect;
export type PaymentRow = typeof payments.$inferSelect;
export type ExpenseRow = typeof expenses.$inferSelect;
export type MachineRow = typeof machines.$inferSelect;
export type MachineUnlockRow = typeof machineUnlocks.$inferSelect;
export type UnlockKind = MachineUnlockRow['kind'];
export type UnlockResultCode = MachineUnlockRow['result'];
