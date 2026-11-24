import { createTestContext, receiptOf, testDeveloper, testDeveloperLogin, testEmployee } from '@/db/testing';
import { NO_TOP_UP_PRICES } from '@/domain/machinePolicy';
import { MockMachineController } from '@/machines/MockMachineController';

import { completeFirstRunSetup, listStaff, logIn } from '../auth';
import { createCustomer, listCustomers } from '../customers';
import { detectBackupKind, exportBackup, importLegacyExport, restoreBackup } from '../backup';
import { listCycles } from '../cycles';
import { listExpenses } from '../expenses';
import { listInventory } from '../inventory';
import { addMachine, listMachineLog, listMachines, startOrderOnMachine, topUpDryer } from '../machines';
import { createOrder, getOrderDetail, listOrderSummaries } from '../orders';
import { getSetting, setSetting } from '../settings';

/**
 * Shaped like the Kotlin app's AppDatabaseBackup (Gson, nulls left out, money in pesos as
 * doubles). Built from the entity classes; no real export file was available.
 */
const legacyExport = {
  customers: [
    { customerId: 'C0001', customerName: 'Maria Santos', phoneNumber: '0917', address: 'Purok 2', loyaltyLoads: 7 },
    { customerId: 'C0002', customerName: 'Jose Cruz', phoneNumber: '', address: '', loyaltyLoads: 0, notes: 'VIP' },
  ],
  expenses: [{ expenseId: 'E0001', expenseName: 'Meralco', category: 'Utilities', cost: 1520.5, dateIncurred: 1760000000000 }],
  inventoryItems: [
    { itemId: 'I0001', itemName: 'Detergent', currentStock: 40, lowStockThreshold: 5, unit: 'scoops', autoConsume: true, addOnPrice: 0 },
    { itemId: 'I0002', itemName: 'Fabcon', currentStock: 12, lowStockThreshold: 3, unit: 'pcs', autoConsume: false, addOnPrice: 15 },
  ],
  transactions: [
    {
      transactionId: 'T0001',
      customerId: 'C0001',
      service: 'WASH_DRY_FOLD',
      datePlaced: 1760000000000,
      weightKg: 14.5,
      loadCount: 2,
      totalCost: 470.0,
      amountPaid: 470.0,
      outstandingBalance: 0,
      laundryStatus: 'COMPLETED',
      initialPaymentMethod: 'FULL_PAYMENT',
      paymentChannel: 'GCash',
      gcashReference: '998877',
      cashReceived: 0,
      createdBy: 'ARLaundry',
      syncStatus: 'PENDING',
      addOns: 'Fabcon x2',
      datePaid: 1760000100000,
    },
    {
      transactionId: 'T0002',
      customerId: 'C0099',
      service: 'WASH',
      datePlaced: 1760500000000,
      weightKg: 6,
      loadCount: 1,
      totalCost: 90,
      amountPaid: 40,
      outstandingBalance: 50,
      laundryStatus: 'pending',
      initialPaymentMethod: 'DOWN_PAYMENT',
      paymentChannel: 'CASH',
      cashReceived: 50,
      createdBy: 'staff1',
      syncStatus: 'SYNCED',
    },
  ],
  users: [
    { userId: 'U0001', username: 'ARLaundry', password: 'ARLaundry123', role: 'OWNER' },
    { userId: 'U0002', username: 'staff1', password: 'pw', role: 'EMPLOYEE' },
  ],
};

async function setup() {
  const ctx = createTestContext();
  const owner = await completeFirstRunSetup(ctx, { username: 'Aryl', password: 'secret123', pin: '2468' });
  return { ctx, owner };
}

describe('legacy import', () => {
  it('brings in customers, stock, expenses, orders and payments in centavos', async () => {
    const { ctx, owner } = await setup();
    expect(detectBackupKind(legacyExport)).toBe('legacy');
    const summary = importLegacyExport(ctx, owner, legacyExport);
    expect(summary).toMatchObject({ customers: 2, orders: 2, payments: 2, inventoryItems: 2, expenses: 1, users: 2 });

    expect(listExpenses(ctx)[0].cost).toBe(152050);
    expect(listInventory(ctx).find((i) => i.name === 'Fabcon')).toMatchObject({ addOnPrice: 1500, isAddOn: true });
    expect(listInventory(ctx).find((i) => i.name === 'Detergent')?.isAddOn).toBe(false);

    const first = getOrderDetail(ctx, 'T0001');
    expect(first?.order.total).toBe(47000);
    expect(first?.payments[0]).toMatchObject({ channel: 'GCASH', gcashReference: '998877', receivedAt: 1760000100000 });
    expect(first?.order.legacyNote).toBe('Fabcon x2');

    const second = getOrderDetail(ctx, 'T0002');
    expect(second?.order.status).toBe('PENDING');
    expect(second?.balance).toBe(5000);
    expect(second?.customerName).toBe('Unknown customer');
  });

  it('never imports passwords and does not create a second owner', async () => {
    const { ctx, owner } = await setup();
    importLegacyExport(ctx, owner, legacyExport);
    const staff = listStaff(ctx);
    expect(staff.filter((u) => u.role === 'OWNER').map((u) => u.username)).toEqual(['Aryl']);
    expect(staff.find((u) => u.username === 'ARLaundry')).toMatchObject({ role: 'ADMIN', passwordHash: null });
    await expect(logIn(ctx, 'ARLaundry', 'ARLaundry123')).rejects.toThrow('no password');
  });

  it('renumbers clashing IDs and keeps new IDs above imported ones', async () => {
    const { ctx, owner } = await setup();
    createCustomer(ctx, { name: 'Already here', phone: '', address: '', notes: '' });
    const summary = importLegacyExport(ctx, owner, legacyExport);
    expect(summary.renumbered).toBeGreaterThan(0);
    const maria = listCustomers(ctx).find((c) => c.name === 'Maria Santos');
    expect(maria?.id).not.toBe('C0001');
    expect(getOrderDetail(ctx, 'T0001')?.order.customerId).toBe(maria?.id);
    expect(createCustomer(ctx, { name: 'Next', phone: '', address: '', notes: '' }).id).not.toMatch(/^C000[12]$/);
  });

  it('changes nothing when the file is broken', async () => {
    const { ctx, owner } = await setup();
    expect(() => importLegacyExport(ctx, owner, { transactions: [{ transactionId: 5 }] })).toThrow('not an export');
    expect(listOrderSummaries(ctx)).toHaveLength(0);
  });
});

describe('who may use backups', () => {
  it('only the owner can export, restore or import', async () => {
    const { ctx, owner } = await setup();
    const admin = { id: 'U0009', username: 'bea', role: 'ADMIN' as const };
    expect(() => exportBackup(ctx, admin)).toThrow('Only the owner');
    expect(() => restoreBackup(ctx, admin, exportBackup(ctx, owner))).toThrow('Only the owner');
    expect(() => importLegacyExport(ctx, testEmployee, legacyExport)).toThrow('Only the owner');
  });
});

describe('full backup', () => {
  it('round-trips every table, including the machine log and a machine waiting on an order', async () => {
    const { ctx, owner } = await setup();
    importLegacyExport(ctx, owner, legacyExport);
    setSetting(ctx.db, 'pricePerLoad', 25000);
    const pulses = { pulseCount: 2, pulseOnMs: 300, pulseOffMs: 400, runMinutes: 35, topUpPulseCount: 2, topUpPulses10: 4, topUpPulses15: 6, topUpPulses20: 8, topUpPrice: 2000, topUpPrice10: 3500, topUpPrice15: 0, topUpPrice20: 0 };
    const machineId = addMachine(ctx, testDeveloper, { name: 'Washer 1', type: 'WASHER', hardwareChannel: 1, enabled: true, ...pulses });
    const dryerId = addMachine(ctx, testDeveloper, { name: 'Dryer 1', type: 'DRYER', hardwareChannel: 2, enabled: true, ...pulses });
    const order = createOrder(ctx, testEmployee, {
      customerId: 'C0002',
      weightKg: 8,
      loads: 1,
      addOns: [],
      paymentMethod: 'PAY_LATER',
      downPayment: 0,
      channel: 'CASH',
      gcashReference: '',
      cashReceived: null,
      placedAt: null,
    });
    const controller = new MockMachineController(0);
    await controller.connect();
    await startOrderOnMachine(ctx, controller, testEmployee, order.id, machineId, receiptOf(order));
    ctx.advance(35 * 60 * 1000);
    await startOrderOnMachine(ctx, controller, testEmployee, order.id, dryerId, receiptOf(order));
    await topUpDryer(ctx, controller, testEmployee, dryerId, 10);

    const backup = JSON.parse(JSON.stringify(exportBackup(ctx, owner)));
    expect(detectBackupKind(backup)).toBe('backup');

    const fresh = createTestContext();
    const summary = restoreBackup(fresh, owner, backup);
    expect(summary).toEqual({ orders: 3, customers: 3, unlocks: 3 });
    expect(listOrderSummaries(fresh)).toEqual(listOrderSummaries(ctx));
    expect(listMachineLog(fresh, { start: 0, end: Number.MAX_SAFE_INTEGER })).toEqual(
      listMachineLog(ctx, { start: 0, end: Number.MAX_SAFE_INTEGER }),
    );
    expect(listMachines(fresh)).toEqual(listMachines(ctx));
    expect(listMachines(fresh).find((m) => m.id === dryerId)).toMatchObject({
      runOrderId: order.id,
      runMinutes: 35,
      topUpPrice: 2000,
    });

    // Restoring over data whose machines point at orders must also work.
    expect(() => restoreBackup(fresh, owner, backup)).not.toThrow();
    expect(getSetting(fresh.db, 'pricePerLoad')).toBe(25000);
    await expect(logIn(fresh, 'Aryl', 'secret123')).resolves.toMatchObject({ role: 'OWNER' });
  });

  it('gives machines from a backup made before pulse starts the default pulses', async () => {
    const { ctx, owner } = await setup();
    addMachine(ctx, testDeveloper, {
      name: 'Washer 1',
      type: 'WASHER',
      hardwareChannel: 1,
      enabled: true,
      pulseCount: 4,
      pulseOnMs: 100,
      pulseOffMs: 100,
      runMinutes: 30,
      topUpPulseCount: 1,
      topUpPulses10: 2,
      topUpPulses15: 3,
      topUpPulses20: 4,
      ...NO_TOP_UP_PRICES,
    });
    const backup = JSON.parse(JSON.stringify(exportBackup(ctx, owner)));
    for (const row of backup.tables.machines) {
      for (const key of [
        'pulseCount',
        'pulseOnMs',
        'pulseOffMs',
        'assignedOrderId',
        'assignedAt',
        'assignedByName',
        'runMinutes',
        'topUpPulseCount',
        'topUpPrice',
        'topUpPrice10',
        'topUpPrice15',
        'topUpPrice20',
        'topUpPulses10',
        'topUpPulses15',
        'topUpPulses20',
        'delicatesPulses',
        'delicatesMinutes',
        'lightPulses',
        'lightMinutes',
        'mediumPulses',
        'mediumMinutes',
        'heavyPulses',
        'heavyMinutes',
        'assignedCycle',
        'runOrderId',
        'runEndsAt',
      ]) {
        delete row[key];
      }
    }
    const fresh = createTestContext();
    restoreBackup(fresh, owner, backup);
    expect(listMachines(fresh)[0]).toMatchObject({
      pulseCount: 1,
      pulseOnMs: 500,
      pulseOffMs: 500,
      assignedOrderId: null,
      runMinutes: 40,
      ...NO_TOP_UP_PRICES,
      topUpPulses10: 2,
      topUpPulses20: 4,
      runEndsAt: null,
    });
  });

  it('leaves the built-in developer out of backups and ignores one written into a backup', async () => {
    const { ctx, owner } = await setup();
    await logIn(ctx, 'support', 'long dev passphrase', await testDeveloperLogin('support', 'long dev passphrase'));
    const backup = JSON.parse(JSON.stringify(exportBackup(ctx, owner)));
    expect(backup.tables.users.map((u: { role: string }) => u.role)).not.toContain('DEVELOPER');

    backup.tables.users.push({ ...backup.tables.users[0], id: 'U0099', username: 'sneaky', role: 'DEVELOPER' });
    const fresh = createTestContext();
    restoreBackup(fresh, owner, backup);
    expect(listStaff(fresh).map((u) => u.username)).toEqual(['Aryl']);
    await expect(logIn(fresh, 'sneaky', 'secret123', null)).rejects.toThrow('Incorrect');
  });

  it('rebuilds the four fixed cycles of a backup from before cycles had their own table', async () => {
    const { ctx, owner } = await setup();
    const washer = addMachine(ctx, testDeveloper, {
      name: 'Washer 1',
      type: 'WASHER',
      hardwareChannel: 1,
      enabled: true,
      pulseCount: 1,
      pulseOnMs: 500,
      pulseOffMs: 500,
      runMinutes: 30,
      topUpPulseCount: 1,
      topUpPulses10: 2,
      topUpPulses15: 3,
      topUpPulses20: 4,
      ...NO_TOP_UP_PRICES,
    });
    const backup = JSON.parse(JSON.stringify(exportBackup(ctx, owner)));
    backup.version = 8;
    delete backup.tables.machineCycles;
    Object.assign(backup.tables.machines[0], {
      delicatesPulses: 2,
      delicatesMinutes: 25,
      lightPulses: 3,
      lightMinutes: 30,
      mediumPulses: 4,
      mediumMinutes: 40,
      heavyPulses: 6,
      heavyMinutes: 55,
    });

    const fresh = createTestContext();
    restoreBackup(fresh, owner, backup);
    expect(listCycles(fresh).map((c) => [c.machineId, c.name, c.pulses, c.minutes, c.enabled])).toEqual([
      [washer, 'Delicates', 2, 25, true],
      [washer, 'Light', 3, 30, true],
      [washer, 'Medium', 4, 40, true],
      [washer, 'Heavy', 6, 55, true],
    ]);
  });

  it('treats priced items in a backup from before the add-on switch as add-ons', async () => {
    const { ctx, owner } = await setup();
    importLegacyExport(ctx, owner, legacyExport);
    const backup = JSON.parse(JSON.stringify(exportBackup(ctx, owner)));
    for (const item of backup.tables.inventoryItems) delete item.isAddOn;

    const fresh = createTestContext();
    restoreBackup(fresh, owner, backup);
    const flags = Object.fromEntries(listInventory(fresh).map((i) => [i.name, i.isAddOn]));
    expect(flags).toEqual({ Detergent: false, Fabcon: true });
  });

  it('gives orders from a backup made before receipt codes a code of their own', async () => {
    const { ctx, owner } = await setup();
    importLegacyExport(ctx, owner, legacyExport);
    const backup = JSON.parse(JSON.stringify(exportBackup(ctx, owner)));
    backup.version = 2;
    for (const order of backup.tables.orders) delete order.qrToken;

    const fresh = createTestContext();
    restoreBackup(fresh, owner, backup);
    const tokens = listOrderSummaries(fresh).map((s) => s.order.qrToken);
    expect(tokens.length).toBeGreaterThan(1);
    for (const token of tokens) expect(token).toMatch(/^[0-9a-f]{32}$/);
    expect(new Set(tokens).size).toBe(tokens.length);
  });

  it('rejects a file with a bad row and leaves data alone', async () => {
    const { ctx, owner } = await setup();
    const backup = JSON.parse(JSON.stringify(exportBackup(ctx, owner)));
    backup.tables.customers.push({ id: 'C0500', name: 42 });
    expect(() => restoreBackup(ctx, owner, backup)).toThrow('not a Laundry POS backup');
    expect(listStaff(ctx)).toHaveLength(1);
    expect(detectBackupKind({ hello: 'world' })).toBe('unknown');
  });
});
