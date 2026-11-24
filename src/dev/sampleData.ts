import { createTestContext, receiptOf } from '@/db/testing';
import type { Actor } from '@/db/types';
import { addShopDays, startOfShopDay } from '@/domain/dates';
import { isRunning } from '@/domain/machinePolicy';
import { MockMachineController } from '@/machines/MockMachineController';
import { addStaff, completeFirstRunSetup } from '@/services/auth';
import { exportBackup, type Backup } from '@/services/backup';
import { createCustomer } from '@/services/customers';
import { addExpense, EXPENSE_CATEGORIES } from '@/services/expenses';
import { createInventoryItem } from '@/services/inventory';
import {
  addMachine,
  listMachines,
  markRunDone,
  overrideStart,
  startOrderOnMachine,
  topUpDryer,
  type MachineInput,
} from '@/services/machines';
import { createOrder, listOrderSummaries, receivePayment, updateOrderStatus } from '@/services/orders';
import { setSetting } from '@/services/settings';
import { listTopUps } from '@/services/topUps';

/**
 * Builds a backup full of made-up shop activity, for trying out the reports without touching
 * real data: restore it on the tablet, look around, then restore the real backup.
 * Development only; the app never imports this file.
 */

/** Sign-in details of the sample accounts (sample data only, not a real shop's). */
export const SAMPLE_ACCOUNTS = {
  owner: { username: 'owner', password: 'sample123', pin: '1234' },
  employee: { username: 'ana', password: 'sample123' },
} as const;

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;

/** Small seeded random numbers, so the same sample comes out every time. */
function seededRandom(seed: number) {
  let state = seed;
  const next = () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    pick: <T,>(items: readonly T[]): T => items[Math.floor(next() * items.length) % items.length],
    chance: (p: number) => next() < p,
  };
}

const CUSTOMER_NAMES = [
  'Maria Santos', 'Jose Reyes', 'Ana Cruz', 'Paolo Garcia', 'Liza Mendoza', 'Mark Bautista',
  'Grace Villanueva', 'Ramon Aquino', 'Joy Fernandez', 'Carlo Dizon', 'Rhea Navarro', 'Ben Ramos',
  'Tess Castillo', 'Nico Flores', 'Aileen Torres',
];

function machineInput(name: string, type: 'WASHER' | 'DRYER', hardwareChannel: number): MachineInput {
  const dryer = type === 'DRYER';
  return {
    name,
    type,
    hardwareChannel,
    enabled: true,
    pulseCount: 1,
    pulseOnMs: 500,
    pulseOffMs: 500,
    runMinutes: dryer ? 40 : 35,
  };
}

/** About `days` days of activity ending on the day of `now`, opening hours 8:00 to 20:00. */
export async function buildSampleBackup(now: number, days = 30): Promise<Backup> {
  const random = seededRandom(20261123);
  const firstDay = addShopDays(startOfShopDay(now), -(days - 1));
  const ctx = createTestContext(firstDay + 7 * HOUR);
  const owner = await completeFirstRunSetup(ctx, SAMPLE_ACCOUNTS.owner);
  const employeeId = await addStaff(ctx, owner, { ...SAMPLE_ACCOUNTS.employee, role: 'EMPLOYEE' });
  const employee: Actor = { id: employeeId, username: SAMPLE_ACCOUNTS.employee.username, role: 'EMPLOYEE' };
  // Sets up the machines only; the built-in developer is never part of a backup.
  const developer: Actor = { id: 'D0001', username: 'sample-setup', role: 'DEVELOPER' };
  setSetting(ctx.db, 'pricePerLoad', 16000);
  setSetting(ctx.db, 'dryOnlyPricePerLoad', 10000);
  // New dryers take these prices for their 5, 10, 15 and 20-minute top-ups.
  setSetting(ctx.db, 'shopTopUps', [
    { minutes: 5, price: 2000 },
    { minutes: 10, price: 3500 },
    { minutes: 15, price: 5000 },
    { minutes: 20, price: 6500 },
  ]);
  setSetting(ctx.db, 'receiptHeader', 'SAMPLE LAUNDRY (TEST DATA)');

  const fabcon = createInventoryItem(ctx, {
    name: 'Fabcon', currentStock: 500, lowStockThreshold: 20, unit: 'pcs', autoConsume: false, isAddOn: true, addOnPrice: 1500,
  });
  const bleach = createInventoryItem(ctx, {
    name: 'Bleach', currentStock: 300, lowStockThreshold: 10, unit: 'pcs', autoConsume: false, isAddOn: true, addOnPrice: 1000,
  });
  createInventoryItem(ctx, {
    name: 'Detergent', currentStock: 2000, lowStockThreshold: 50, unit: 'scoops', autoConsume: true, isAddOn: false, addOnPrice: 0,
  });

  const washers = [1, 2, 3, 4].map((n) => addMachine(ctx, developer, machineInput(`Washer ${n}`, 'WASHER', n)));
  const dryers = [1, 2, 3, 4].map((n) => addMachine(ctx, developer, machineInput(`Dryer ${n}`, 'DRYER', n + 4)));
  const customers = CUSTOMER_NAMES.map((name, i) =>
    createCustomer(ctx, { name, phone: `0917${String(1000000 + i * 7919).slice(0, 7)}`, address: '', notes: '' }),
  );
  const controller = new MockMachineController(0);
  await controller.connect();

  /** A machine still counting down is treated as finished, as staff would tap Mark as done. */
  const free = (ids: readonly number[]) => {
    const id = random.pick(ids);
    const machine = listMachines(ctx).find((m) => m.id === id);
    if (machine && isRunning(machine, ctx.now())) markRunDone(ctx, id);
    return id;
  };

  for (let day = 0; day < days; day += 1) {
    const dayStart = addShopDays(firstDay, day);
    const isToday = day === days - 1;
    const orderCount = random.int(4, 9);
    let clock = dayStart + 8 * HOUR;
    const setClock = (ms: number) => ctx.advance(Math.max(0, ms - ctx.now()));

    for (let n = 0; n < orderCount; n += 1) {
      clock += random.int(20, 80) * MINUTE;
      if (clock > dayStart + 20 * HOUR || (isToday && clock > now)) break;
      setClock(clock);
      const loads = random.int(1, 3);
      const dryOnly = random.chance(0.12);
      const method = random.chance(0.7) ? 'FULL_PAYMENT' : random.chance(0.5) ? 'DOWN_PAYMENT' : 'PAY_LATER';
      const channel = random.chance(0.75) ? 'CASH' : 'GCASH';
      const addOns = random.chance(0.4) ? [{ itemId: random.chance(0.6) ? fabcon : bleach, quantity: random.int(1, 2) }] : [];
      const topUpMinutes: number | null = !dryOnly && random.chance(0.15) ? random.pick([5, 10, 15, 20] as const) : null;
      const order = createOrder(ctx, employee, {
        customerId: random.pick(customers).id,
        weightKg: loads * 7,
        loads,
        addOns,
        paymentMethod: method,
        downPayment: method === 'DOWN_PAYMENT' ? 10000 : 0,
        channel,
        gcashReference: channel === 'GCASH' ? String(random.int(100000000, 999999999)) : '',
        cashReceived: null,
        placedAt: null,
        topUp: topUpMinutes ? { minutes: topUpMinutes, loads: 1 } : null,
        dryOnly,
      });

      // Each load washed (unless dry only), then dried; now and then a start fails and is retried.
      for (let load = 0; load < loads; load += 1) {
        if (!dryOnly) {
          if (random.chance(0.05)) {
            controller.failNextStart('failed');
            const washer = free(washers);
            await startOrderOnMachine(ctx, controller, employee, order.id, washer, receiptOf(order));
          }
          const washer = free(washers);
          await startOrderOnMachine(ctx, controller, employee, order.id, washer, receiptOf(order));
          ctx.advance(random.int(2, 6) * MINUTE);
          // The wash is over before the load goes in a dryer.
          markRunDone(ctx, washer);
        }
        const dryer = free(dryers);
        await startOrderOnMachine(ctx, controller, employee, order.id, dryer, receiptOf(order));
        if (random.chance(0.15)) {
          const minutes = random.pick([5, 10] as const);
          const topUp = listTopUps(ctx).find((row) => row.machineId === dryer && row.minutes === minutes);
          if (topUp) await topUpDryer(ctx, controller, employee, dryer, topUp.id);
        }
        ctx.advance(random.int(1, 4) * MINUTE);
      }

      if (random.chance(0.04)) {
        await overrideStart(ctx, controller, employee, {
          machineId: free(washers),
          pin: SAMPLE_ACCOUNTS.owner.pin,
          reason: 'Rewash',
          note: '',
          orderId: order.id,
        });
      }
    }

    // Close of day: unpaid orders from earlier days get paid, older jobs move along.
    setClock(Math.min(dayStart + 19 * HOUR + 30 * MINUTE, isToday ? now : Number.MAX_SAFE_INTEGER));
    for (const summary of listOrderSummaries(ctx)) {
      const age = (dayStart - startOfShopDay(summary.order.placedAt)) / (24 * HOUR);
      if (summary.order.voidedAt !== null) continue;
      if (summary.balance > 0 && age >= 1 && random.chance(0.6)) {
        receivePayment(ctx, employee, summary.order.id, {
          amount: summary.balance,
          channel: random.chance(0.8) ? 'CASH' : 'GCASH',
          gcashReference: String(random.int(100000000, 999999999)),
          cashReceived: null,
        });
      }
      if (age >= 2 && summary.order.status === 'PENDING') updateOrderStatus(ctx, employee, summary.order.id, 'COMPLETED');
      if (age >= 5 && summary.order.status === 'COMPLETED' && random.chance(0.5)) {
        updateOrderStatus(ctx, owner, summary.order.id, 'AUDITED');
      }
    }

    if (day % 7 === 3 || random.chance(0.15)) {
      addExpense(ctx, owner, {
        name: random.pick(['Meralco bill', 'Water bill', 'Detergent restock', 'Plastic bags', 'Machine repair']),
        category: random.pick(EXPENSE_CATEGORIES),
        cost: random.int(3, 40) * 10000,
        incurredAt: ctx.now(),
      });
    }
  }

  return exportBackup(ctx, owner);
}
