import { notInArray, sql } from 'drizzle-orm';
import { z } from 'zod';

import { parseIdNumber, type IdKind } from '@/domain/ids';
import { pesosToCentavos } from '@/domain/money';
import { newReceiptToken } from '@/domain/receiptCode';
import { normalizeStatus } from '@/domain/statuses';
import {
  customers,
  expenses,
  inventoryItems,
  machines,
  machineUnlocks,
  orderItems,
  orders,
  payments,
  sequences,
  settings,
  users,
} from '@/db/schema';
import { can } from '@/domain/permissions';
import { UserFacingError, type Actor, type Db, type ServiceContext } from '@/db/types';

import { bumpSequence, takeNextId } from './sequences';
import { DEVICE_ONLY_SETTINGS } from './settings';

// ---------- Full backup (this app's own format) ----------

export const BACKUP_FORMAT = 'laundry-pos-backup';
/** 2: machine run timers, dryer top-ups and the TOP_UP log kind. */
export const BACKUP_VERSION = 5;

function readAll(db: Db) {
  return {
    users: db.select().from(users).all(),
    customers: db.select().from(customers).all(),
    inventoryItems: db.select().from(inventoryItems).all(),
    orders: db.select().from(orders).all(),
    orderItems: db.select().from(orderItems).all(),
    payments: db.select().from(payments).all(),
    expenses: db.select().from(expenses).all(),
    settings: db.select().from(settings).where(notInArray(settings.key, [...DEVICE_ONLY_SETTINGS])).all(),
    sequences: db.select().from(sequences).all(),
    machines: db.select().from(machines).all(),
    machineUnlocks: db.select().from(machineUnlocks).all(),
  };
}

export type BackupTables = ReturnType<typeof readAll>;

export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: number;
  tables: BackupTables;
}

function requireOwner(actor: Actor): void {
  if (!can.manageBackups(actor.role)) throw new UserFacingError('Only the owner can back up or restore data.');
}

export function exportBackup(ctx: ServiceContext, actor: Actor): Backup {
  requireOwner(actor);
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: ctx.now(), tables: readAll(ctx.db) };
}

const int = z.number().int();
const text = z.string();
const maybeInt = int.nullable();
const maybeText = text.nullable();
const role = z.enum(['OWNER', 'ADMIN', 'EMPLOYEE']);
const machineType = z.enum(['WASHER', 'DRYER']);

/** Every row is checked against the table's shape before anything is written. */
const tableSchemas = {
  users: z.object({ id: text, username: text, passwordHash: maybeText, role, active: z.boolean(), createdAt: int }),
  customers: z.object({
    id: text,
    name: text,
    phone: text,
    address: text,
    notes: text,
    loyaltyLoads: int,
    createdAt: int,
    archivedAt: maybeInt,
  }),
  inventoryItems: z.object({
    id: text,
    name: text,
    currentStock: int,
    lowStockThreshold: int,
    unit: text,
    autoConsume: z.boolean(),
    // Backups made before the add-on switch existed sold every item priced above 0.
    isAddOn: z.boolean().optional(),
    addOnPrice: int,
    archivedAt: maybeInt,
  }).transform((item) => ({ ...item, isAddOn: item.isAddOn ?? item.addOnPrice > 0 })),
  orders: z.object({
    id: text,
    customerId: text,
    service: text,
    placedAt: int,
    weightKg: z.number(),
    loadCount: int,
    promoApplied: z.boolean(),
    pricePerLoad: int,
    total: int,
    status: text,
    initialPaymentMethod: text,
    createdByUserId: maybeText,
    createdByName: text,
    voidedAt: maybeInt,
    voidedByName: maybeText,
    voidReason: maybeText,
    legacyNote: maybeText,
    // Backups before version 3 had no receipt codes; restore gives those orders new ones.
    qrToken: z.string().optional(),
  }),
  orderItems: z.object({
    id: int,
    orderId: text,
    inventoryItemId: maybeText,
    name: text,
    quantity: int,
    unitPrice: int,
  }),
  payments: z.object({
    id: int,
    orderId: text,
    amount: int,
    channel: z.enum(['CASH', 'GCASH']),
    gcashReference: maybeText,
    cashReceived: maybeInt,
    receivedAt: int,
    receivedByName: text,
  }),
  expenses: z.object({
    id: text,
    name: text,
    category: text,
    cost: int,
    incurredAt: int,
    // Backups from before version 4 did not record who entered an expense.
    recordedByName: maybeText.default(null),
  }),
  settings: z.object({ key: text, value: text }),
  sequences: z.object({ name: text, next: int }),
  machines: z.object({
    id: int,
    name: text,
    type: machineType,
    hardwareChannel: int,
    enabled: z.boolean(),
    sortOrder: int,
    // Backups made before pulse starts lack these; they get the defaults of migration 0002.
    pulseCount: int.default(1),
    pulseOnMs: int.default(500),
    pulseOffMs: int.default(500),
    assignedOrderId: z.string().nullable().default(null),
    assignedAt: int.nullable().default(null),
    assignedByName: z.string().nullable().default(null),
    // Backups made before run timers and top-ups get the defaults of migration 0003.
    runMinutes: int.default(40),
    topUpPulseCount: int.default(1),
    topUpPrice: int.default(0),
    // Backups before version 5 had one top-up length (5 minutes) only.
    topUpPrice10: int.default(0),
    topUpPrice15: int.default(0),
    topUpPrice20: int.default(0),
    runOrderId: z.string().nullable().default(null),
    runEndsAt: int.nullable().default(null),
  }),
  machineUnlocks: z.object({
    id: int,
    at: int,
    machineId: maybeInt,
    machineName: text,
    machineType,
    hardwareChannel: int,
    orderId: maybeText,
    employeeUserId: maybeText,
    employeeName: text,
    kind: z.enum(['ORDER', 'OVERRIDE', 'OVERRIDE_DENIED', 'TEST', 'TOP_UP']),
    overrideReason: maybeText,
    overrideNote: maybeText,
    result: z.enum(['PENDING', 'ACKED', 'REJECTED', 'BUSY', 'FAILED', 'TIMEOUT', 'NOT_CONNECTED', 'DENIED']),
    resolvedAt: maybeInt,
    charge: int.nullable().default(null),
  }),
};

const backupSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.number().int().max(BACKUP_VERSION),
  exportedAt: z.number(),
  tables: z.object({
    users: z.array(tableSchemas.users),
    customers: z.array(tableSchemas.customers),
    inventoryItems: z.array(tableSchemas.inventoryItems),
    orders: z.array(tableSchemas.orders),
    orderItems: z.array(tableSchemas.orderItems),
    payments: z.array(tableSchemas.payments),
    expenses: z.array(tableSchemas.expenses),
    settings: z.array(tableSchemas.settings),
    sequences: z.array(tableSchemas.sequences),
    machines: z.array(tableSchemas.machines),
    machineUnlocks: z.array(tableSchemas.machineUnlocks),
  }),
});

export interface RestoreSummary {
  orders: number;
  customers: number;
  unlocks: number;
}

/**
 * Replaces all shop data with a backup. Every row is validated first, then everything is written
 * in one transaction: if anything fails, nothing changes.
 */
export function restoreBackup(ctx: ServiceContext, actor: Actor, parsed: unknown): RestoreSummary {
  requireOwner(actor);
  const result = backupSchema.safeParse(parsed);
  if (!result.success) throw new UserFacingError('This file is not a Laundry POS backup.');
  const { tables } = result.data;
  ctx.db.transaction((tx) => {
    tx.delete(machineUnlocks).run();
    // Machines can point at an order they are assigned to, so they go before orders.
    tx.delete(machines).run();
    tx.delete(payments).run();
    tx.delete(orderItems).run();
    tx.delete(orders).run();
    tx.delete(customers).run();
    tx.delete(inventoryItems).run();
    tx.delete(expenses).run();
    tx.delete(sequences).run();
    tx.delete(settings).where(notInArray(settings.key, [...DEVICE_ONLY_SETTINGS])).run();
    tx.delete(users).run();
    for (const values of tables.users) tx.insert(users).values(values).run();
    for (const values of tables.customers) tx.insert(customers).values(values).run();
    for (const values of tables.inventoryItems) tx.insert(inventoryItems).values(values).run();
    for (const values of tables.orders) {
      const qrToken = values.qrToken || newReceiptToken(ctx.randomBytes);
      tx.insert(orders).values({ ...values, qrToken }).run();
    }
    for (const values of tables.orderItems) tx.insert(orderItems).values(values).run();
    for (const values of tables.payments) tx.insert(payments).values(values).run();
    for (const values of tables.expenses) tx.insert(expenses).values(values).run();
    for (const values of tables.settings) tx.insert(settings).values(values).run();
    for (const values of tables.sequences) tx.insert(sequences).values(values).run();
    for (const values of tables.machines) tx.insert(machines).values(values).run();
    for (const values of tables.machineUnlocks) tx.insert(machineUnlocks).values(values).run();
  });
  return { orders: tables.orders.length, customers: tables.customers.length, unlocks: tables.machineUnlocks.length };
}

// ---------- Import from the old Kotlin app's "Export Data" file ----------

// Gson leaves out null fields, so anything optional may be missing.
const legacySchema = z.object({
  customers: z
    .array(
      z.object({
        customerId: z.string(),
        customerName: z.string(),
        phoneNumber: z.string().default(''),
        address: z.string().default(''),
        loyaltyLoads: z.number().int().default(0),
        notes: z.string().default(''),
      }),
    )
    .default([]),
  expenses: z
    .array(
      z.object({
        expenseId: z.string(),
        expenseName: z.string(),
        category: z.string().default('Others'),
        cost: z.number(),
        dateIncurred: z.number(),
      }),
    )
    .default([]),
  inventoryItems: z
    .array(
      z.object({
        itemId: z.string(),
        itemName: z.string(),
        currentStock: z.number().int(),
        lowStockThreshold: z.number().int().default(5),
        unit: z.string().default('pcs'),
        autoConsume: z.boolean().default(false),
        addOnPrice: z.number().default(0),
      }),
    )
    .default([]),
  transactions: z
    .array(
      z.object({
        transactionId: z.string(),
        customerId: z.string(),
        service: z.string(),
        datePlaced: z.number(),
        weightKg: z.number(),
        loadCount: z.number().int(),
        totalCost: z.number(),
        amountPaid: z.number().default(0),
        laundryStatus: z.string(),
        initialPaymentMethod: z.string().default('FULL_PAYMENT'),
        paymentChannel: z.string().default('CASH'),
        gcashReference: z.string().nullish(),
        cashReceived: z.number().default(0),
        createdBy: z.string().default('old app'),
        addOns: z.string().nullish(),
        datePaid: z.number().nullish(),
      }),
    )
    .default([]),
  users: z
    .array(z.object({ userId: z.string(), username: z.string(), role: z.string() }))
    .default([]),
});

export interface LegacyImportSummary {
  customers: number;
  orders: number;
  payments: number;
  inventoryItems: number;
  expenses: number;
  users: number;
  renumbered: number;
}

function freeId(db: Db, kind: IdKind, wanted: string, exists: (id: string) => boolean): { id: string; changed: boolean } {
  if (!exists(wanted)) {
    const n = parseIdNumber(wanted);
    if (n !== null) bumpSequence(db, kind, n);
    return { id: wanted, changed: false };
  }
  let id = takeNextId(db, kind);
  while (exists(id)) id = takeNextId(db, kind);
  return { id, changed: true };
}

function legacyChannel(channel: string): 'CASH' | 'GCASH' {
  return channel.toUpperCase() === 'GCASH' ? 'GCASH' : 'CASH';
}

/**
 * Brings in the old app's export. Money is converted from pesos to centavos. IDs are kept unless
 * they clash with existing rows, in which case they get new numbers. Passwords are not imported:
 * the owner sets new ones in Staff. Runs in one transaction.
 */
export function importLegacyExport(
  ctx: ServiceContext,
  actor: Actor,
  parsed: unknown,
): LegacyImportSummary {
  requireOwner(actor);
  const result = legacySchema.safeParse(parsed);
  if (!result.success) throw new UserFacingError('This file is not an export from the old Laundry app.');
  const data = result.data;
  const summary: LegacyImportSummary = {
    customers: 0,
    orders: 0,
    payments: 0,
    inventoryItems: 0,
    expenses: 0,
    users: 0,
    renumbered: 0,
  };

  ctx.db.transaction((tx) => {
    const has = <T extends { id: string }>(list: T[]) => {
      const ids = new Set(list.map((item) => item.id));
      return { ids, exists: (id: string) => ids.has(id) };
    };
    const customerIds = has(tx.select({ id: customers.id }).from(customers).all());
    const customerMap = new Map<string, string>();
    for (const c of data.customers) {
      const { id, changed } = freeId(tx, 'customer', c.customerId, customerIds.exists);
      customerIds.ids.add(id);
      customerMap.set(c.customerId, id);
      if (changed) summary.renumbered += 1;
      tx.insert(customers)
        .values({
          id,
          name: c.customerName.trim() || 'Unnamed customer',
          phone: c.phoneNumber,
          address: c.address,
          notes: c.notes,
          loyaltyLoads: Math.max(0, c.loyaltyLoads),
          createdAt: ctx.now(),
          archivedAt: null,
        })
        .run();
      summary.customers += 1;
    }

    const itemIds = has(tx.select({ id: inventoryItems.id }).from(inventoryItems).all());
    for (const item of data.inventoryItems) {
      const { id, changed } = freeId(tx, 'inventory', item.itemId, itemIds.exists);
      itemIds.ids.add(id);
      if (changed) summary.renumbered += 1;
      tx.insert(inventoryItems)
        .values({
          id,
          name: item.itemName,
          currentStock: Math.max(0, item.currentStock),
          lowStockThreshold: Math.max(0, item.lowStockThreshold),
          unit: item.unit,
          autoConsume: item.autoConsume,
          isAddOn: item.addOnPrice > 0,
          addOnPrice: pesosToCentavos(Math.max(0, item.addOnPrice)),
          archivedAt: null,
        })
        .run();
      summary.inventoryItems += 1;
    }

    const expenseIds = has(tx.select({ id: expenses.id }).from(expenses).all());
    for (const e of data.expenses) {
      const { id, changed } = freeId(tx, 'expense', e.expenseId, expenseIds.exists);
      expenseIds.ids.add(id);
      if (changed) summary.renumbered += 1;
      tx.insert(expenses)
        .values({ id, name: e.expenseName, category: e.category, cost: pesosToCentavos(e.cost), incurredAt: e.dateIncurred })
        .run();
      summary.expenses += 1;
    }

    const orderIds = has(tx.select({ id: orders.id }).from(orders).all());
    for (const t of data.transactions) {
      let customerId = customerMap.get(t.customerId) ?? t.customerId;
      if (!customerIds.exists(customerId)) {
        // The old app let customers be deleted while their orders stayed.
        customerId = freeId(tx, 'customer', t.customerId, customerIds.exists).id;
        customerIds.ids.add(customerId);
        customerMap.set(t.customerId, customerId);
        tx.insert(customers)
          .values({ id: customerId, name: 'Unknown customer', createdAt: ctx.now(), archivedAt: ctx.now() })
          .run();
      }
      const { id, changed } = freeId(tx, 'order', t.transactionId, orderIds.exists);
      orderIds.ids.add(id);
      if (changed) summary.renumbered += 1;
      const total = pesosToCentavos(Math.max(0, t.totalCost));
      tx.insert(orders)
        .values({
          id,
          customerId,
          service: t.service.toUpperCase(),
          placedAt: t.datePlaced,
          weightKg: t.weightKg,
          loadCount: Math.max(1, t.loadCount),
          promoApplied: false,
          // Unknown for old orders: the old app did not store the price per load.
          pricePerLoad: 0,
          total,
          status: normalizeStatus(t.laundryStatus) || 'PENDING',
          initialPaymentMethod: t.initialPaymentMethod,
          createdByUserId: null,
          createdByName: t.createdBy,
          voidedAt: null,
          voidedByName: null,
          voidReason: null,
          legacyNote: t.addOns ?? null,
          qrToken: newReceiptToken(ctx.randomBytes),
        })
        .run();
      summary.orders += 1;
      const paid = Math.min(total, pesosToCentavos(Math.max(0, t.amountPaid)));
      if (paid > 0) {
        const channel = legacyChannel(t.paymentChannel);
        tx.insert(payments)
          .values({
            orderId: id,
            amount: paid,
            channel,
            gcashReference: channel === 'GCASH' ? (t.gcashReference ?? null) : null,
            cashReceived: channel === 'CASH' && t.cashReceived > 0 ? pesosToCentavos(t.cashReceived) : null,
            receivedAt: t.datePaid ?? t.datePlaced,
            receivedByName: t.createdBy,
          })
          .run();
        summary.payments += 1;
      }
    }

    const takenNames = new Set(
      tx
        .select({ name: sql<string>`lower(${users.username})` })
        .from(users)
        .all()
        .map((u) => u.name),
    );
    const userIds = has(tx.select({ id: users.id }).from(users).all());
    for (const u of data.users) {
      const name = u.username.trim();
      if (!name || takenNames.has(name.toLowerCase())) continue;
      const { id, changed } = freeId(tx, 'user', u.userId, userIds.exists);
      userIds.ids.add(id);
      takenNames.add(name.toLowerCase());
      if (changed) summary.renumbered += 1;
      const role = u.role.toUpperCase() === 'EMPLOYEE' ? 'EMPLOYEE' : 'ADMIN';
      tx.insert(users).values({ id, username: name, passwordHash: null, role, active: true, createdAt: ctx.now() }).run();
      summary.users += 1;
    }
  });
  return summary;
}

/** Works out which kind of file was picked. */
export function detectBackupKind(parsed: unknown): 'backup' | 'legacy' | 'unknown' {
  if (backupSchema.safeParse(parsed).success) return 'backup';
  if (typeof parsed === 'object' && parsed !== null && 'transactions' in parsed && legacySchema.safeParse(parsed).success) {
    return 'legacy';
  }
  return 'unknown';
}
