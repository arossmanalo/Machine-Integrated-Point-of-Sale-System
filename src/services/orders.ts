import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

import { autoConsumeAmount } from '@/domain/inventory';
import { isPromoEligible, loyaltyAfterOrder, loyaltyAfterVoid } from '@/domain/loyalty';
import {
  amountToApply,
  balanceDue,
  fullyPaidAt,
  sumPaid,
  type PaymentChannel,
  type PaymentMethod,
} from '@/domain/payments';
import { isTopUpMinutes, topUpPriceFor, type TopUpMinutes } from '@/domain/machinePolicy';
import { can } from '@/domain/permissions';
import {
  computeOrderTotal,
  CURRENT_SERVICE,
  DRY_ONLY_SERVICE,
  loadRangeForWeight,
  type OrderTotal,
} from '@/domain/pricing';
import { newReceiptToken } from '@/domain/receiptCode';
import { INITIAL_STATUS, isClosedStatus, normalizeStatus, selectableStatuses } from '@/domain/statuses';
import {
  customers,
  inventoryItems,
  machines,
  machineUnlocks,
  orderItems,
  orders,
  payments,
  type CustomerRow,
  type InventoryItemRow,
  type MachineUnlockRow,
  type OrderItemRow,
  type OrderRow,
  type PaymentRow,
} from '@/db/schema';
import { UserFacingError, type Actor, type Db, type ServiceContext } from '@/db/types';

import { createCustomer } from './customers';
import { takeNextId } from './sequences';
import { getSetting } from './settings';

const MAX_LOADS = 50;
const FUTURE_TOLERANCE_MS = 60 * 1000;

export interface PaymentInput {
  amount: number;
  channel: PaymentChannel;
  gcashReference: string;
  /** Cash handed over, for working out change. Null when not entered. */
  cashReceived: number | null;
}

export interface AddOnSelection {
  itemId: string;
  quantity: number;
}

export interface NewOrderInput {
  customerId: string;
  weightKg: number;
  loads: number;
  addOns: AddOnSelection[];
  paymentMethod: PaymentMethod;
  /** Amount for a down payment; ignored for full payment (always the total) and pay later. */
  downPayment: number;
  channel: PaymentChannel;
  gcashReference: string;
  cashReceived: number | null;
  /** Owner only: when the order was really placed. */
  placedAt: number | null;
  /** A dryer top-up paid for now and added when the order's dryers start. */
  topUp?: PrepaidTopUpSelection | null;
  /** The customer only wants the laundry dried: dryers only, at the dry-only price per load. */
  dryOnly?: boolean;
}

/** Extra drying time for some of the order's loads, chosen when the order is taken. */
export interface PrepaidTopUpSelection {
  minutes: TopUpMinutes;
  loads: number;
}

export interface OrderQuote extends OrderTotal {
  promoApplied: boolean;
  pricePerLoad: number;
  addOnLines: { item: InventoryItemRow; quantity: number }[];
  /** The top-up's price per load and its total, already in `total`. */
  topUp: (PrepaidTopUpSelection & { unitPrice: number; total: number }) | null;
}

function resolveTopUp(db: Db, loads: number, topUp: PrepaidTopUpSelection | null): OrderQuote['topUp'] {
  if (topUp === null || topUp.loads === 0) return null;
  if (!isTopUpMinutes(topUp.minutes)) throw new UserFacingError('Pick a top-up of 5, 10, 15 or 20 minutes.');
  if (!Number.isInteger(topUp.loads) || topUp.loads < 1 || topUp.loads > loads) {
    throw new UserFacingError(`The top-up can cover 1 to ${loads} load${loads === 1 ? '' : 's'}.`);
  }
  const unitPrice = topUpPriceFor(getSetting(db, 'orderTopUpPrices'), topUp.minutes);
  if (unitPrice <= 0) {
    throw new UserFacingError(`A ${topUp.minutes}-minute top-up has no price. Set it in Manage, Shop settings.`);
  }
  return { ...topUp, unitPrice, total: unitPrice * topUp.loads };
}

function requireCustomer(db: Db, id: string): CustomerRow {
  const customer = db.select().from(customers).where(eq(customers.id, id)).get();
  if (!customer || customer.archivedAt !== null) {
    throw new UserFacingError('Pick a customer for this order.');
  }
  return customer;
}

function resolveAddOns(db: Db, selections: AddOnSelection[]): OrderQuote['addOnLines'] {
  const wanted = selections.filter((s) => s.quantity > 0);
  if (wanted.some((s) => !Number.isInteger(s.quantity))) {
    throw new UserFacingError('Add-on quantities must be whole numbers.');
  }
  if (wanted.length === 0) return [];
  const ids = wanted.map((s) => s.itemId);
  const items = db.select().from(inventoryItems).where(inArray(inventoryItems.id, ids)).all();
  return wanted.map((selection) => {
    const item = items.find((i) => i.id === selection.itemId);
    if (!item || item.archivedAt !== null || !item.isAddOn || item.addOnPrice <= 0) {
      throw new UserFacingError('One of the add-ons is no longer for sale. Remove it and try again.');
    }
    return { item, quantity: selection.quantity };
  });
}

/** Works out the price the same way createOrder will, for showing in the form. */
export function quoteOrder(
  ctx: ServiceContext,
  customer: Pick<CustomerRow, 'loyaltyLoads'> | null,
  loads: number,
  addOns: AddOnSelection[],
  topUpSelection: PrepaidTopUpSelection | null = null,
  dryOnly = false,
): OrderQuote {
  const pricePerLoad = getSetting(ctx.db, dryOnly ? 'dryOnlyPricePerLoad' : 'pricePerLoad');
  // The 10+1 promo is for wash, dry & fold loads only.
  const promoApplied = !dryOnly && customer !== null && isPromoEligible(customer.loyaltyLoads);
  const addOnLines = resolveAddOns(ctx.db, addOns);
  const topUp = resolveTopUp(ctx.db, loads, topUpSelection);
  const total = computeOrderTotal({
    loads,
    pricePerLoad,
    promoApplied,
    addOns: addOnLines.map((line) => ({ unitPrice: line.item.addOnPrice, quantity: line.quantity })),
  });
  return { ...total, total: total.total + (topUp?.total ?? 0), promoApplied, pricePerLoad, addOnLines, topUp };
}

function checkPayment(payment: PaymentInput): void {
  if (payment.channel === 'GCASH' && !payment.gcashReference.trim()) {
    throw new UserFacingError('Enter the GCash reference number.');
  }
  if (payment.cashReceived !== null && payment.cashReceived < payment.amount) {
    throw new UserFacingError('Cash received is less than the amount being paid.');
  }
}

function initialPayment(input: NewOrderInput, total: number): PaymentInput | null {
  if (total <= 0 || input.paymentMethod === 'PAY_LATER') return null;
  const amount = input.paymentMethod === 'FULL_PAYMENT' ? total : input.downPayment;
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new UserFacingError('Enter the down payment amount.');
  }
  if (amount > total) {
    throw new UserFacingError('The down payment is more than the total. Use full payment instead.');
  }
  const payment: PaymentInput = {
    amount,
    channel: input.channel,
    gcashReference: input.gcashReference.trim(),
    cashReceived: input.channel === 'CASH' ? input.cashReceived : null,
  };
  checkPayment(payment);
  return payment;
}

/** Creates the order, its first payment, loyalty and stock changes in one transaction. */
export interface CreateOrderOptions {
  /** Take "use one per load" supplies off stock. Off only for test orders. */
  useSupplies?: boolean;
}

export function createOrder(
  ctx: ServiceContext,
  actor: Actor,
  input: NewOrderInput,
  { useSupplies = true }: CreateOrderOptions = {},
): OrderRow {
  if (!(input.weightKg > 0) || !Number.isFinite(input.weightKg)) {
    throw new UserFacingError('Enter the weight in kilograms.');
  }
  if (!Number.isInteger(input.loads) || input.loads < 1 || input.loads > MAX_LOADS) {
    throw new UserFacingError(`Loads must be a whole number from 1 to ${MAX_LOADS}.`);
  }
  const range = loadRangeForWeight(input.weightKg);
  if (input.loads < range.min || input.loads > range.max) {
    const allowed =
      range.min === range.max
        ? `${range.min}`
        : `${range.min} ${range.max - range.min === 1 ? 'or' : 'to'} ${range.max}`;
    throw new UserFacingError(
      `${input.weightKg} kg is ${allowed} load${range.max === 1 ? '' : 's'}. A load is 8 kg, up to 10 kg at most.`,
    );
  }
  const now = ctx.now();
  let placedAt = now;
  if (input.placedAt !== null && input.placedAt !== now) {
    if (!can.backdateOrder(actor.role)) throw new UserFacingError('Only the owner can change the date.');
    if (input.placedAt > now + FUTURE_TOLERANCE_MS) {
      throw new UserFacingError('The order date cannot be in the future.');
    }
    placedAt = input.placedAt;
  }

  return ctx.db.transaction((tx) => {
    const txCtx = { ...ctx, db: tx };
    const customer = requireCustomer(tx, input.customerId);
    const dryOnly = input.dryOnly ?? false;
    const quote = quoteOrder(txCtx, customer, input.loads, input.addOns, input.topUp ?? null, dryOnly);
    const payment = initialPayment(input, quote.total);
    for (const line of quote.addOnLines) {
      if (line.item.currentStock < line.quantity) {
        throw new UserFacingError(
          `Only ${line.item.currentStock} ${line.item.unit} of ${line.item.name} left. ` +
            'Restock it in Inventory or lower the quantity.',
        );
      }
    }

    const order: OrderRow = {
      id: takeNextId(tx, 'order'),
      customerId: customer.id,
      service: dryOnly ? DRY_ONLY_SERVICE : CURRENT_SERVICE,
      placedAt,
      weightKg: input.weightKg,
      loadCount: input.loads,
      promoApplied: quote.promoApplied,
      pricePerLoad: quote.pricePerLoad,
      total: quote.total,
      status: INITIAL_STATUS,
      initialPaymentMethod: input.paymentMethod,
      createdByUserId: actor.id,
      createdByName: actor.username,
      voidedAt: null,
      voidedByName: null,
      voidReason: null,
      legacyNote: null,
      qrToken: newReceiptToken(ctx.randomBytes),
      overrideToken: null,
      prepaidTopUpMinutes: quote.topUp?.minutes ?? null,
      prepaidTopUpLoads: quote.topUp?.loads ?? 0,
    };
    tx.insert(orders).values(order).run();

    for (const line of quote.addOnLines) {
      tx.insert(orderItems)
        .values({
          orderId: order.id,
          inventoryItemId: line.item.id,
          name: line.item.name,
          quantity: line.quantity,
          unitPrice: line.item.addOnPrice,
        })
        .run();
      tx.update(inventoryItems)
        .set({ currentStock: sql`${inventoryItems.currentStock} - ${line.quantity}` })
        .where(eq(inventoryItems.id, line.item.id))
        .run();
    }

    if (quote.topUp) {
      tx.insert(orderItems)
        .values({
          orderId: order.id,
          inventoryItemId: null,
          name: `Dryer top-up ${quote.topUp.minutes} min, paid ahead`,
          quantity: quote.topUp.loads,
          unitPrice: quote.topUp.unitPrice,
        })
        .run();
    }

    if (payment) {
      tx.insert(payments)
        .values({
          orderId: order.id,
          amount: payment.amount,
          channel: payment.channel,
          gcashReference: payment.channel === 'GCASH' ? payment.gcashReference : null,
          cashReceived: payment.cashReceived,
          receivedAt: placedAt,
          receivedByName: actor.username,
        })
        .run();
    }

    if (!dryOnly) {
      tx.update(customers)
        .set({
          loyaltyLoads: loyaltyAfterOrder(customer.loyaltyLoads, quote.billableLoads, quote.promoApplied),
        })
        .where(eq(customers.id, customer.id))
        .run();
    }

    // Detergent and other per-load supplies are for washing; a dry-only order takes none.
    const autoItems = !useSupplies || dryOnly
      ? []
      : tx
          .select()
          .from(inventoryItems)
          .where(eq(inventoryItems.autoConsume, true))
          .all()
          .filter((item) => item.archivedAt === null);
    for (const item of autoItems) {
      const used = autoConsumeAmount(item.currentStock, input.loads);
      if (used > 0) {
        tx.update(inventoryItems)
          .set({ currentStock: item.currentStock - used })
          .where(eq(inventoryItems.id, item.id))
          .run();
      }
    }
    return order;
  });
}

export const TEST_CUSTOMER_NAME = 'Test customer';

/**
 * A one-load Pay later order for "Test customer", so the owner can try the staff unlock flow on
 * the real locks. It takes no supplies off stock and no money; void it afterwards.
 */
export function createTestOrder(ctx: ServiceContext, actor: Actor): OrderRow {
  if (!can.manageMachines(actor.role)) throw new UserFacingError('Test orders are for support only.');
  const existing = ctx.db
    .select()
    .from(customers)
    .where(and(eq(customers.name, TEST_CUSTOMER_NAME), isNull(customers.archivedAt)))
    .get();
  const customer =
    existing ??
    createCustomer(ctx, {
      name: TEST_CUSTOMER_NAME,
      phone: '',
      address: '',
      notes: 'Used for testing the machines. Void its orders after testing.',
    });
  return createOrder(
    ctx,
    actor,
    {
      customerId: customer.id,
      weightKg: 8,
      loads: 1,
      addOns: [],
      paymentMethod: 'PAY_LATER',
      downPayment: 0,
      channel: 'CASH',
      gcashReference: '',
      cashReceived: null,
      placedAt: null,
    },
    { useSupplies: false },
  );
}

function requireOpenOrder(db: Db, id: string): OrderRow {
  const order = db.select().from(orders).where(eq(orders.id, id)).get();
  if (!order) throw new UserFacingError('That order no longer exists.');
  if (order.voidedAt !== null) throw new UserFacingError('This order was voided.');
  return order;
}

export function paidSoFar(db: Db, orderId: string): number {
  return sumPaid(db.select().from(payments).where(eq(payments.orderId, orderId)).all());
}

/** Records a later payment. Never takes more than the balance. Returns the amount applied. */
export function receivePayment(
  ctx: ServiceContext,
  actor: Actor,
  orderId: string,
  payment: PaymentInput,
): number {
  return ctx.db.transaction((tx) => {
    const order = requireOpenOrder(tx, orderId);
    const outstanding = balanceDue(order.total, paidSoFar(tx, orderId));
    if (outstanding <= 0) throw new UserFacingError('This order is already fully paid.');
    if (!Number.isInteger(payment.amount) || payment.amount <= 0) {
      throw new UserFacingError('Enter the amount being paid.');
    }
    const amount = amountToApply(payment.amount, outstanding);
    checkPayment({ ...payment, amount });
    tx.insert(payments)
      .values({
        orderId,
        amount,
        channel: payment.channel,
        gcashReference: payment.channel === 'GCASH' ? payment.gcashReference.trim() : null,
        cashReceived: payment.channel === 'CASH' ? payment.cashReceived : null,
        receivedAt: ctx.now(),
        receivedByName: actor.username,
      })
      .run();
    return amount;
  });
}

export function updateOrderStatus(
  ctx: ServiceContext,
  actor: Actor,
  orderId: string,
  status: string,
): void {
  const next = normalizeStatus(status);
  const allowed = selectableStatuses(
    getSetting(ctx.db, 'customStatuses'),
    [],
    can.setAuditedStatus(actor.role),
  );
  if (!allowed.includes(next)) throw new UserFacingError('You cannot set that status.');
  const order = requireOpenOrder(ctx.db, orderId);
  // An audit is the manager's sign-off, so only a manager can take an order out of it again.
  if (order.status === 'AUDITED' && !can.setAuditedStatus(actor.role)) {
    throw new UserFacingError('This order was audited. Only an admin or the owner can change its status.');
  }
  ctx.db.transaction((tx) => {
    tx.update(orders).set({ status: next }).where(eq(orders.id, orderId)).run();
    if (isClosedStatus(next)) releaseMachines(tx, orderId);
  });
}

/** A finished or voided order no longer waits on any machine. */
function releaseMachines(db: Db, orderId: string): void {
  db.update(machines)
    .set({ assignedOrderId: null, assignedAt: null, assignedByName: null })
    .where(eq(machines.assignedOrderId, orderId))
    .run();
}

/**
 * Voids an order instead of deleting it, so its machine unlocks stay on record. Undoes the
 * loyalty change and returns add-on stock. Payments stay recorded but stop counting as revenue.
 */
export function voidOrder(ctx: ServiceContext, actor: Actor, orderId: string, reason: string): void {
  if (!can.voidOrder(actor.role)) throw new UserFacingError('Only an admin or the owner can void.');
  const why = reason.trim();
  if (!why) throw new UserFacingError('Say why the order is being voided.');
  ctx.db.transaction((tx) => {
    const order = requireOpenOrder(tx, orderId);
    tx.update(orders)
      .set({ voidedAt: ctx.now(), voidedByName: actor.username, voidReason: why })
      .where(eq(orders.id, orderId))
      .run();
    releaseMachines(tx, orderId);
    const customer = tx.select().from(customers).where(eq(customers.id, order.customerId)).get();
    if (customer && order.service === CURRENT_SERVICE) {
      const billable = order.promoApplied ? order.loadCount - 1 : order.loadCount;
      tx.update(customers)
        .set({ loyaltyLoads: loyaltyAfterVoid(customer.loyaltyLoads, billable, order.promoApplied) })
        .where(eq(customers.id, customer.id))
        .run();
    }
    const items = tx.select().from(orderItems).where(eq(orderItems.orderId, orderId)).all();
    for (const item of items) {
      if (item.inventoryItemId === null) continue;
      tx.update(inventoryItems)
        .set({ currentStock: sql`${inventoryItems.currentStock} + ${item.quantity}` })
        .where(eq(inventoryItems.id, item.inventoryItemId))
        .run();
    }
  });
}

export interface OrderSummary {
  order: OrderRow;
  customerName: string;
  paid: number;
  balance: number;
  /** When the balance reached zero; null while money is owed. */
  paidAt: number | null;
}

function summarize(order: OrderRow, customerName: string, orderPayments: PaymentRow[]): OrderSummary {
  const paid = sumPaid(orderPayments);
  return {
    order,
    customerName,
    paid,
    balance: balanceDue(order.total, paid),
    paidAt: fullyPaidAt(order.total, orderPayments),
  };
}

/** Every order, newest first, with its customer name and payment totals. */
export function listOrderSummaries(ctx: ServiceContext): OrderSummary[] {
  const rows = ctx.db
    .select({ order: orders, customerName: customers.name })
    .from(orders)
    .leftJoin(customers, eq(orders.customerId, customers.id))
    .orderBy(desc(orders.placedAt), desc(orders.id))
    .all();
  const byOrder = new Map<string, PaymentRow[]>();
  for (const payment of ctx.db.select().from(payments).all()) {
    const list = byOrder.get(payment.orderId) ?? [];
    list.push(payment);
    byOrder.set(payment.orderId, list);
  }
  return rows.map((row) =>
    summarize(row.order, row.customerName ?? 'Unknown customer', byOrder.get(row.order.id) ?? []),
  );
}

export function listAllPayments(ctx: ServiceContext): PaymentRow[] {
  return ctx.db.select().from(payments).orderBy(asc(payments.receivedAt)).all();
}

export interface OrderDetail extends OrderSummary {
  customer: CustomerRow | null;
  items: OrderItemRow[];
  payments: PaymentRow[];
  unlocks: MachineUnlockRow[];
}

export function getOrderDetail(ctx: ServiceContext, orderId: string): OrderDetail | null {
  const order = ctx.db.select().from(orders).where(eq(orders.id, orderId)).get();
  if (!order) return null;
  const customer = ctx.db.select().from(customers).where(eq(customers.id, order.customerId)).get();
  const orderPayments = ctx.db
    .select()
    .from(payments)
    .where(eq(payments.orderId, orderId))
    .orderBy(asc(payments.receivedAt))
    .all();
  return {
    ...summarize(order, customer?.name ?? 'Unknown customer', orderPayments),
    customer: customer ?? null,
    items: ctx.db.select().from(orderItems).where(eq(orderItems.orderId, orderId)).all(),
    payments: orderPayments,
    unlocks: ctx.db
      .select()
      .from(machineUnlocks)
      .where(eq(machineUnlocks.orderId, orderId))
      .orderBy(desc(machineUnlocks.id))
      .all(),
  };
}
