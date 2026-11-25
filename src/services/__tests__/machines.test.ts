import { createTestContext, receiptOf, testDeveloperLogin, testEmployee } from '@/db/testing';
import { receiptCodeFor, TEST_RECEIPT_CODE } from '@/domain/receiptCode';
import { machineUnlocks } from '@/db/schema';
import { MockMachineController } from '@/machines/MockMachineController';

import { completeFirstRunSetup, logIn } from '../auth';
import { createCustomer } from '../customers';
import {
  addMachine,
  applyPulsesToMachines,
  assignOrder,
  listMachineLog,
  listMachines,
  machineUsage,
  issueOverrideCode,
  machineEarningsFor,
  markRunDone,
  overrideStart,
  readReceiptCode,
  saveLockController,
  saveOwnerMachineChanges,
  setMultiCycle,
  setReceiptScanRequired,
  setSimulateMachines,
  startMachine,
  startOrderOnMachine,
  testStart,
  testTopUp,
  topUpDryer,
  unassignMachine,
  updateMachine,
  type MachineInput,
} from '../machines';
import { addCycle, listCycles, updateCycles } from '../cycles';
import { createOrder, getOrderDetail, updateOrderStatus, voidOrder } from '../orders';
import { getSetting, setSetting } from '../settings';
import { addTopUp, listTopUps, orderTopUpChoices, saveShopTopUpPrices, updateTopUps } from '../topUps';

const PULSES = { pulseCount: 1, pulseOnMs: 500, pulseOffMs: 500, runMinutes: 30 };
const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;

function machine(name: string, type: 'WASHER' | 'DRYER', hardwareChannel: number): MachineInput {
  return { name, type, hardwareChannel, enabled: true, ...PULSES };
}

async function setup() {
  const ctx = createTestContext();
  const owner = await completeFirstRunSetup(ctx, {
    username: 'owner',
    password: 'owner123',
    pin: '2468',
  });
  const developer = await logIn(ctx, 'dev', 'dev-passphrase', await testDeveloperLogin('dev', 'dev-passphrase'));
  const washer1 = addMachine(ctx, developer, { ...machine('Washer 1', 'WASHER', 1), pulseCount: 3 });
  const washer2 = addMachine(ctx, developer, machine('Washer 2', 'WASHER', 2));
  const washer3 = addMachine(ctx, developer, machine('Washer 3', 'WASHER', 3));
  const dryer1 = addMachine(ctx, developer, machine('Dryer 1', 'DRYER', 4));
  const dryer2 = addMachine(ctx, developer, machine('Dryer 2', 'DRYER', 5));
  const dryer3 = addMachine(ctx, developer, machine('Dryer 3', 'DRYER', 6));
  /** A dryer's top-up of this length (every dryer starts with 5, 10, 15 and 20 minutes). */
  const topUpId = (machineId: number, minutes: number) => {
    const topUp = listTopUps(ctx).find((row) => row.machineId === machineId && row.minutes === minutes);
    if (!topUp) throw new Error(`No ${minutes}-minute top-up`);
    return topUp.id;
  };
  // Dryer 1 offers 5 minutes (2 pulses, ₱20) and 15 minutes (7 pulses, ₱50); the others offer none.
  updateTopUps(
    ctx,
    developer,
    dryer1,
    listTopUps(ctx)
      .filter((row) => row.machineId === dryer1)
      .map((row) => {
        const settings: Record<number, [number, number]> = { 5: [2, 2000], 10: [4, 0], 15: [7, 5000], 20: [4, 0] };
        const [pulses, price] = settings[row.minutes] ?? [1, 0];
        return { ...row, pulses, price, enabled: price > 0 };
      }),
  );
  const customer = createCustomer(ctx, { name: 'Juan', phone: '', address: '', notes: '' });
  const controller = new MockMachineController(0);
  await controller.connect();
  const order = createOrder(ctx, testEmployee, {
    customerId: customer.id,
    weightKg: 15,
    loads: 2,
    addOns: [],
    paymentMethod: 'PAY_LATER',
    downPayment: 0,
    channel: 'CASH',
    gcashReference: '',
    cashReceived: null,
    placedAt: null,
  });
  const machineById = (id: number) => listMachines(ctx).find((m) => m.id === id);
  const log = () => listMachineLog(ctx, { start: 0, end: ctx.now() + 1 });
  /** Records washer starts for an order, so its dryers may run, without using a test washer. */
  const markWashed = (orderId: string, loads = 1) => {
    for (let i = 0; i < loads; i += 1) {
      ctx.db
        .insert(machineUnlocks)
        .values({
          at: ctx.now(),
          machineId: null,
          machineName: 'Washer (earlier)',
          machineType: 'WASHER',
          hardwareChannel: 1,
          orderId,
          employeeName: 'ana',
          kind: 'ORDER',
          result: 'ACKED',
        })
        .run();
    }
  };
  const newOrder = () =>
    createOrder(ctx, testEmployee, {
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
    });
  return {
    ctx,
    owner,
    developer,
    controller,
    customer,
    order,
    newOrder,
    washers: [washer1, washer2, washer3],
    dryers: [dryer1, dryer2, dryer3],
    machineById,
    topUpId,
    log,
    markWashed,
  };
}

describe('assigning orders to machines', () => {
  it('an unpaid 2-load order can take exactly 2 washers and 2 dryers', async () => {
    const { ctx, order, washers, dryers, machineById, markWashed } = await setup();
    assignOrder(ctx, testEmployee, order.id, washers[0]);
    assignOrder(ctx, testEmployee, order.id, washers[1]);
    expect(() => assignOrder(ctx, testEmployee, order.id, washers[2])).toThrow('used all its washers');
    expect(() => assignOrder(ctx, testEmployee, order.id, dryers[0])).toThrow('Run a washer');
    // The two washers run: their assignments become started loads.
    unassignMachine(ctx, washers[0]);
    unassignMachine(ctx, washers[1]);
    markWashed(order.id, 2);
    assignOrder(ctx, testEmployee, order.id, dryers[0]);
    assignOrder(ctx, testEmployee, order.id, dryers[1]);
    expect(() => assignOrder(ctx, testEmployee, order.id, dryers[2])).toThrow('used all its dryers');
    expect(machineUsage(ctx, order.id)).toEqual({ WASHER: 2, DRYER: 2 });
    expect(machineById(dryers[0])).toMatchObject({ assignedOrderId: order.id, assignedByName: 'ana' });
  });

  it('one machine holds one order at a time, and removing frees the allowance', async () => {
    const { ctx, order, washers } = await setup();
    assignOrder(ctx, testEmployee, order.id, washers[0]);
    expect(() => assignOrder(ctx, testEmployee, order.id, washers[0])).toThrow('already has order');
    unassignMachine(ctx, washers[0]);
    expect(machineUsage(ctx, order.id).WASHER).toBe(0);
  });

  it('refuses voided, completed and unknown orders, and machines switched off', async () => {
    const { ctx, owner, developer, order, washers } = await setup();
    expect(() => assignOrder(ctx, testEmployee, 'T9999', washers[0])).toThrow('No order');
    updateMachine(ctx, developer, washers[0], { ...machine('Washer 1', 'WASHER', 1), enabled: false });
    expect(() => assignOrder(ctx, testEmployee, order.id, washers[0])).toThrow('switched off');
    updateOrderStatus(ctx, owner, order.id, 'COMPLETED');
    expect(() => assignOrder(ctx, testEmployee, order.id, washers[1])).toThrow('completed');
    updateOrderStatus(ctx, owner, order.id, 'READY');
    voidOrder(ctx, owner, order.id, 'Test');
    expect(() => assignOrder(ctx, testEmployee, order.id, washers[1])).toThrow('voided');
  });

  it('frees machines when their order is voided or completed, or the machine is switched off', async () => {
    const { ctx, owner, developer, order, washers, dryers, machineById, markWashed } = await setup();
    markWashed(order.id);
    assignOrder(ctx, testEmployee, order.id, washers[0]);
    updateMachine(ctx, developer, washers[0], { ...machine('Washer 1', 'WASHER', 1), enabled: false });
    expect(machineById(washers[0])?.assignedOrderId).toBeNull();
    assignOrder(ctx, testEmployee, order.id, washers[1]);
    updateOrderStatus(ctx, owner, order.id, 'COMPLETED');
    expect(machineById(washers[1])?.assignedOrderId).toBeNull();
    updateOrderStatus(ctx, owner, order.id, 'READY');
    assignOrder(ctx, testEmployee, order.id, dryers[0]);
    voidOrder(ctx, owner, order.id, 'Entered twice');
    expect(machineById(dryers[0])?.assignedOrderId).toBeNull();
  });
});

describe('starting machines (LED prototype acceptance, run against the mock)', () => {
  it('starts only an assigned machine, with its own pulses, and uses up the assignment', async () => {
    const { ctx, controller, order, washers, machineById, log } = await setup();
    await expect(startMachine(ctx, controller, testEmployee, washers[0])).rejects.toThrow('Assign an order');
    assignOrder(ctx, testEmployee, order.id, washers[0]);
    await expect(startMachine(ctx, controller, testEmployee, washers[0])).resolves.toBe('acked');
    expect(controller.starts).toEqual([{ channel: 1, pulses: { count: 3, onMs: 500, offMs: 500 } }]);
    expect(machineById(washers[0])?.assignedOrderId).toBeNull();
    await expect(startMachine(ctx, controller, testEmployee, washers[0])).rejects.toThrow('Assign an order');
    expect(machineUsage(ctx, order.id).WASHER).toBe(1);
    expect(log()[0]).toMatchObject({ orderId: order.id, kind: 'ORDER', result: 'ACKED', employeeName: 'ana' });
  });

  it('a 2-load order runs exactly 2 washers in total', async () => {
    const { ctx, controller, order, washers } = await setup();
    for (const id of [washers[0], washers[1]]) {
      assignOrder(ctx, testEmployee, order.id, id);
      await startMachine(ctx, controller, testEmployee, id);
    }
    expect(() => assignOrder(ctx, testEmployee, order.id, washers[2])).toThrow('used all its washers');
    expect(controller.starts.map((s) => s.channel)).toEqual([1, 2]);
  });

  it('gives the assignment back when nothing was sent', async () => {
    const { ctx, controller, order, washers, machineById, log } = await setup();
    assignOrder(ctx, testEmployee, order.id, washers[1]);
    for (const failure of ['failed', 'busy', 'rejected'] as const) {
      controller.failNextStart(failure);
      await expect(startMachine(ctx, controller, testEmployee, washers[1])).resolves.toBe(failure);
      expect(machineById(washers[1])?.assignedOrderId).toBe(order.id);
    }
    expect(log().map((row) => row.result)).toEqual(['REJECTED', 'BUSY', 'FAILED']);
    expect(machineUsage(ctx, order.id).WASHER).toBe(1);
  });

  it('counts an unanswered start as used, so a lost reply cannot give a free cycle', async () => {
    const { ctx, controller, order, washers, machineById } = await setup();
    assignOrder(ctx, testEmployee, order.id, washers[0]);
    controller.failNextStart('timeout');
    await expect(startMachine(ctx, controller, testEmployee, washers[0])).resolves.toBe('timeout');
    expect(machineById(washers[0])?.assignedOrderId).toBeNull();
    assignOrder(ctx, testEmployee, order.id, washers[1]);
    expect(() => assignOrder(ctx, testEmployee, order.id, washers[2])).toThrow('used all its washers');
  });

  it('leaves the assignment alone when the controller is offline', async () => {
    const { ctx, controller, order, washers, machineById, log } = await setup();
    assignOrder(ctx, testEmployee, order.id, washers[0]);
    await controller.disconnect();
    await expect(startMachine(ctx, controller, testEmployee, washers[0])).resolves.toBe('not-connected');
    expect(machineById(washers[0])?.assignedOrderId).toBe(order.id);
    expect(log()).toHaveLength(0);
  });

  it('two taps on Start send one start', async () => {
    const { ctx, controller, order, washers } = await setup();
    assignOrder(ctx, testEmployee, order.id, washers[0]);
    const results = await Promise.allSettled([
      startMachine(ctx, controller, testEmployee, washers[0]),
      startMachine(ctx, controller, testEmployee, washers[0]),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(controller.starts).toHaveLength(1);
  });
});

describe('owner override', () => {
  it('starts with the right PIN and logs the reason; wrong PINs are logged and lock out', async () => {
    const { ctx, controller, washers, log } = await setup();
    const input = { machineId: washers[2], reason: 'Machine did not start' as const, note: '', orderId: null };
    await expect(overrideStart(ctx, controller, testEmployee, { ...input, pin: '2468' })).resolves.toBe('acked');
    for (let i = 0; i < 4; i += 1) {
      await expect(overrideStart(ctx, controller, testEmployee, { ...input, pin: '0000' })).rejects.toThrow(
        'Wrong owner PIN',
      );
    }
    await expect(overrideStart(ctx, controller, testEmployee, { ...input, pin: '0000' })).rejects.toThrow('locked');
    await expect(overrideStart(ctx, controller, testEmployee, { ...input, pin: '2468' })).rejects.toThrow('locked');

    expect(log().filter((row) => row.kind === 'OVERRIDE_DENIED')).toHaveLength(6);
    expect(log().find((row) => row.kind === 'OVERRIDE')).toMatchObject({
      overrideReason: 'Machine did not start',
      result: 'ACKED',
      orderId: null,
    });
    expect(controller.starts.map((s) => s.channel)).toEqual([3]);
  });

  it('an override receipt allows one start for its order without the PIN, even with its runs used up', async () => {
    const { ctx, owner, controller, order, washers, log } = await setup();
    const rewash = (code: string | null, machineId = washers[2]) =>
      overrideStart(ctx, controller, testEmployee, {
        machineId,
        reason: 'Rewash',
        note: '',
        orderId: order.id,
        pin: '',
        overrideCode: code,
      });
    // Use up the order's two washers.
    await startOrderOnMachine(ctx, controller, testEmployee, order.id, washers[0], receiptOf(order));
    await startOrderOnMachine(ctx, controller, testEmployee, order.id, washers[1], receiptOf(order));

    expect(() => issueOverrideCode(ctx, testEmployee, order.id)).toThrow('Only the owner');
    const first = issueOverrideCode(ctx, owner, order.id);
    const code = issueOverrideCode(ctx, owner, order.id);
    await expect(rewash(first)).rejects.toThrow('already used or replaced');
    // The override receipt is not a normal receipt.
    await expect(
      startOrderOnMachine(ctx, controller, testEmployee, order.id, washers[2], code),
    ).rejects.toThrow('override receipt');

    await expect(rewash(code)).resolves.toBe('acked');
    expect(log()[0]).toMatchObject({ kind: 'OVERRIDE', orderId: order.id, overrideNote: 'override receipt' });
    expect(controller.starts).toHaveLength(3);
    await expect(rewash(code, washers[0])).rejects.toThrow('already used or replaced');
    // Without a code it falls back to the PIN.
    await expect(rewash(null, washers[0])).rejects.toThrow('Wrong owner PIN');
  });

  it('gives an override receipt back when nothing reached the machine', async () => {
    const { ctx, owner, controller, order, washers } = await setup();
    const code = issueOverrideCode(ctx, owner, order.id);
    const input = { machineId: washers[0], reason: 'Rewash' as const, note: '', orderId: null, pin: '', overrideCode: code };
    controller.failNextStart('failed');
    await expect(overrideStart(ctx, controller, testEmployee, input)).resolves.toBe('failed');
    await expect(overrideStart(ctx, controller, testEmployee, input)).resolves.toBe('acked');
    await expect(overrideStart(ctx, controller, testEmployee, input)).rejects.toThrow('already used');
  });

  it('refuses an override receipt for another order or a voided one', async () => {
    const { ctx, owner, controller, order, newOrder, washers } = await setup();
    const other = newOrder();
    const code = issueOverrideCode(ctx, owner, order.id);
    const input = { machineId: washers[0], reason: 'Rewash' as const, note: '', pin: '', overrideCode: code };
    await expect(overrideStart(ctx, controller, testEmployee, { ...input, orderId: other.id })).rejects.toThrow(
      `is for ${order.id}`,
    );
    voidOrder(ctx, owner, order.id, 'Test');
    await expect(overrideStart(ctx, controller, testEmployee, { ...input, orderId: null })).rejects.toThrow('voided');
    expect(() => issueOverrideCode(ctx, owner, order.id)).toThrow('voided');
    expect(controller.starts).toEqual([]);
  });

  it('requires a note for "Other"', async () => {
    const { ctx, controller, washers } = await setup();
    await expect(
      overrideStart(ctx, controller, testEmployee, { machineId: washers[0], reason: 'Other', note: ' ', orderId: null, pin: '2468' }),
    ).rejects.toThrow('Describe');
  });
});

describe('machine settings', () => {
  it('keeps channels unique, checks pulses, and lets only the developer change machines or test', async () => {
    const { ctx, developer, controller, washers, log } = await setup();
    expect(() => addMachine(ctx, developer, machine('Dup', 'WASHER', 1))).toThrow('already used by Washer 1');
    expect(() => addMachine(ctx, developer, machine('Washer 24', 'WASHER', 24))).toThrow('from 1 to 23');
    expect(() => addMachine(ctx, developer, { ...machine('W', 'WASHER', 9), pulseCount: 0 })).toThrow('pulses');
    expect(() => addMachine(ctx, developer, { ...machine('W', 'WASHER', 9), pulseOnMs: 10 })).toThrow('Pulse length');
    expect(addMachine(ctx, developer, machine('Dryer 7', 'DRYER', 14))).toBeGreaterThan(0);
    expect(() => addMachine(ctx, testEmployee, machine('X', 'WASHER', 9))).toThrow('support');
    await expect(testStart(ctx, controller, testEmployee, washers[0])).rejects.toThrow('support');
    await expect(testStart(ctx, controller, developer, washers[0])).resolves.toBe('acked');
    expect(log()[0].kind).toBe('TEST');
  });

  it('shows the owner the machine setup but lets only the developer change or test it', async () => {
    const { ctx, owner, controller, washers, dryers } = await setup();
    const denied = 'managed by support';
    expect(() => addMachine(ctx, owner, machine('Washer 9', 'WASHER', 9))).toThrow(denied);
    expect(() => updateMachine(ctx, owner, washers[0], machine('Washer 1', 'WASHER', 1))).toThrow(denied);
    expect(() => saveLockController(ctx, owner, { address: '192.168.1.50', key: 'a-long-enough-key' })).toThrow(denied);
    expect(() => addCycle(ctx, owner, { name: 'Quick', pulses: 1, minutes: 20 }, [washers[0]])).toThrow(denied);
    await expect(testStart(ctx, controller, owner, washers[0])).rejects.toThrow(denied);
    await expect(testTopUp(ctx, controller, owner, dryers[0], 5)).rejects.toThrow(denied);
    expect(controller.starts).toEqual([]);
  });

  it('lets the owner switch machines and cycles off and set coins and top-up prices, and nothing else', async () => {
    const { ctx, owner, controller, order, washers, dryers, machineById, markWashed } = await setup();
    const washerCycles = listCycles(ctx).filter((c) => c.machineId === washers[0]);
    const keep = (id: number) => {
      const m = machineById(id);
      if (!m) throw new Error('No machine');
      return { enabled: true, coins: m.pulseCount, cycles: [], topUps: [] };
    };
    const before = machineById(dryers[0]);
    const dryerTopUps = listTopUps(ctx).filter((t) => t.machineId === dryers[0]);
    const [five, ten] = dryerTopUps;

    assignOrder(ctx, testEmployee, order.id, washers[0]);
    saveOwnerMachineChanges(ctx, owner, washers[0], {
      ...keep(washers[0]),
      enabled: false,
      coins: 5,
      cycles: [{ id: washerCycles[0].id, enabled: false, coins: 7 }],
    });
    expect(machineById(washers[0])).toMatchObject({ enabled: false, assignedOrderId: null, pulseCount: 5 });
    expect(listCycles(ctx).find((c) => c.id === washerCycles[0].id)).toMatchObject({ enabled: false, pulses: 7 });

    // Switch off 5 minutes (its price stays for later) and offer 10 minutes at ₱30 with 6 coins.
    saveOwnerMachineChanges(ctx, owner, dryers[0], {
      ...keep(dryers[0]),
      coins: 4,
      topUps: [
        { id: five.id, enabled: false, coins: five.pulses, price: five.price },
        { id: ten.id, enabled: true, coins: 6, price: 3000 },
      ],
    });
    expect(machineById(dryers[0])).toMatchObject({ pulseCount: 4, pulseOnMs: before?.pulseOnMs, runMinutes: before?.runMinutes });
    expect(listTopUps(ctx).filter((t) => t.machineId === dryers[0]).map((t) => [t.name, t.enabled, t.pulses, t.price])).toEqual([
      ['5 min', false, 2, 2000],
      ['10 min', true, 6, 3000],
      ['15 min', true, 7, 5000],
      ['20 min', false, 4, 0],
    ]);
    // The new coins are what a start sends.
    markWashed(order.id);
    await startOrderOnMachine(ctx, controller, testEmployee, order.id, dryers[0], receiptOf(order));
    expect(controller.starts[0].pulses.count).toBe(4);

    expect(() => saveOwnerMachineChanges(ctx, testEmployee, dryers[0], keep(dryers[0]))).toThrow('Only the owner');
    expect(() => saveOwnerMachineChanges(ctx, owner, washers[1], { ...keep(washers[1]), coins: 0 })).toThrow(
      'Washer 2: enter 1 to 50 coins',
    );
    expect(() =>
      saveOwnerMachineChanges(ctx, owner, washers[0], {
        ...keep(washers[0]),
        cycles: [{ id: washerCycles[1].id, enabled: true, coins: 51 }],
      }),
    ).toThrow(`${washerCycles[1].name}: enter 1 to 50 coins`);
    expect(() =>
      saveOwnerMachineChanges(ctx, owner, washers[1], {
        ...keep(washers[1]),
        cycles: [{ id: washerCycles[1].id, enabled: false, coins: 1 }],
      }),
    ).toThrow('not on Washer 2');
    const change = (coins: number, price: number, enabled = true) => [{ id: ten.id, enabled, coins, price }];
    expect(() => saveOwnerMachineChanges(ctx, owner, washers[1], { ...keep(washers[1]), topUps: change(1, 3000) })).toThrow(
      'Only dryers',
    );
    expect(() => saveOwnerMachineChanges(ctx, owner, dryers[1], { ...keep(dryers[1]), topUps: change(1, 3000) })).toThrow(
      'not on Dryer 2',
    );
    expect(() => saveOwnerMachineChanges(ctx, owner, dryers[0], { ...keep(dryers[0]), topUps: change(0, 3000) })).toThrow(
      '10 min: enter 1 to 50 coins',
    );
    expect(() => saveOwnerMachineChanges(ctx, owner, dryers[0], { ...keep(dryers[0]), topUps: change(2, -100) })).toThrow(
      'price must be from',
    );
    expect(() => saveOwnerMachineChanges(ctx, owner, dryers[0], { ...keep(dryers[0]), topUps: change(2, 0) })).toThrow(
      'needs a price',
    );
  });

  it('copies start pulses to chosen machines only, for the developer, after checking them', async () => {
    const { ctx, developer, washers, dryers, machineById } = await setup();
    const pulses = { count: 12, onMs: 80, offMs: 70 };
    expect(() => applyPulsesToMachines(ctx, testEmployee, pulses, washers)).toThrow('support');
    expect(() => applyPulsesToMachines(ctx, developer, { ...pulses, onMs: 5 }, washers)).toThrow('Pulse length');
    applyPulsesToMachines(ctx, developer, pulses, [washers[1], dryers[0]]);
    expect(machineById(washers[1])).toMatchObject({ pulseCount: 12, pulseOnMs: 80, pulseOffMs: 70 });
    expect(machineById(dryers[0])).toMatchObject({ pulseCount: 12, pulseOnMs: 80, pulseOffMs: 70 });
    expect(machineById(washers[0])).toMatchObject({ pulseCount: 3, pulseOnMs: 500 });
    expect(machineById(dryers[1])).toMatchObject({ pulseCount: 1, pulseOnMs: 500 });
  });

  it('saves the controller address and key for the developer only, after checking them', async () => {
    const { ctx, developer } = await setup();
    const good = { address: ' 192.168.1.50 ', key: 'correct horse battery' };
    expect(() => saveLockController(ctx, testEmployee, good)).toThrow('support');
    expect(() => saveLockController(ctx, developer, { ...good, address: 'not an address!' })).toThrow('192.168.1.50');
    expect(() => saveLockController(ctx, developer, { ...good, key: 'short' })).toThrow('at least 12');
    expect(getSetting(ctx.db, 'lockControllerAddress')).toBe('');

    saveLockController(ctx, developer, good);
    expect(getSetting(ctx.db, 'lockControllerAddress')).toBe('192.168.1.50');
    expect(getSetting(ctx.db, 'lockControllerKey')).toBe('correct horse battery');
  });
});

describe('assigning starts the machine', () => {
  it('sends the pulses at once and keeps the machine in use for its run time', async () => {
    const { ctx, controller, order, newOrder, washers, machineById } = await setup();
    await expect(startOrderOnMachine(ctx, controller, testEmployee, order.id, washers[0], receiptOf(order))).resolves.toBe('acked');
    expect(controller.starts).toEqual([{ channel: 1, pulses: { count: 3, onMs: 500, offMs: 500 } }]);
    expect(machineById(washers[0])).toMatchObject({
      assignedOrderId: null,
      runOrderId: order.id,
      runEndsAt: ctx.now() + 30 * MIN,
    });

    const other = newOrder();
    await expect(startOrderOnMachine(ctx, controller, testEmployee, other.id, washers[0], receiptOf(other))).rejects.toThrow(
      'still running',
    );
    ctx.advance(30 * MIN);
    await expect(startOrderOnMachine(ctx, controller, testEmployee, other.id, washers[0], receiptOf(other))).resolves.toBe('acked');
  });

  it('Mark as done frees a machine that finished early', async () => {
    const { ctx, controller, order, newOrder, washers } = await setup();
    await startOrderOnMachine(ctx, controller, testEmployee, order.id, washers[0], receiptOf(order));
    ctx.advance(10 * MIN);
    markRunDone(ctx, washers[0]);
    const fresh = newOrder();
    await expect(startOrderOnMachine(ctx, controller, testEmployee, fresh.id, washers[0], receiptOf(fresh))).resolves.toBe('acked');
  });

  it('keeps the order on the machine for a retry when nothing was sent, without a timer', async () => {
    const { ctx, controller, order, washers, machineById } = await setup();
    controller.failNextStart('failed');
    await expect(startOrderOnMachine(ctx, controller, testEmployee, order.id, washers[0], receiptOf(order))).resolves.toBe('failed');
    expect(machineById(washers[0])).toMatchObject({ assignedOrderId: order.id, runEndsAt: null });
    await expect(startOrderOnMachine(ctx, controller, testEmployee, order.id, washers[0], receiptOf(order))).resolves.toBe('acked');
    expect(machineUsage(ctx, order.id).WASHER).toBe(1);
  });

  it('after a start that sent nothing, the order can go to another machine of that type', async () => {
    const { ctx, controller, newOrder, washers, machineById } = await setup();
    const oneLoad = newOrder();
    controller.failNextStart('busy');
    await expect(startOrderOnMachine(ctx, controller, testEmployee, oneLoad.id, washers[0], receiptOf(oneLoad))).resolves.toBe('busy');
    await expect(startOrderOnMachine(ctx, controller, testEmployee, oneLoad.id, washers[1], receiptOf(oneLoad))).resolves.toBe('acked');
    expect(machineById(washers[0])?.assignedOrderId).toBeNull();
    expect(machineUsage(ctx, oneLoad.id).WASHER).toBe(1);
  });

  it('an override starts a machine that is in use; a test start sets no timer', async () => {
    const { ctx, developer, controller, order, washers, machineById } = await setup();
    await testStart(ctx, controller, developer, washers[1]);
    expect(machineById(washers[1])?.runEndsAt).toBeNull();
    await startOrderOnMachine(ctx, controller, testEmployee, order.id, washers[0], receiptOf(order));
    const endsAt = machineById(washers[0])?.runEndsAt;
    const rewash = { machineId: washers[0], reason: 'Rewash' as const, note: '', orderId: order.id, pin: '2468' };
    ctx.advance(MIN);
    controller.failNextStart('failed');
    await expect(overrideStart(ctx, controller, testEmployee, rewash)).resolves.toBe('failed');
    expect(machineById(washers[0])?.runEndsAt).toBe(endsAt);
    await expect(overrideStart(ctx, controller, testEmployee, rewash)).resolves.toBe('acked');
    expect(machineById(washers[0])?.runEndsAt).toBe(ctx.now() + 30 * MIN);
  });
});

describe('dryer top-ups', () => {
  it('adds the chosen minutes, sends pulses for them and charges that price', async () => {
    const { ctx, controller, order, dryers, machineById, topUpId, log, markWashed } = await setup();
    markWashed(order.id, 2);
    await startOrderOnMachine(ctx, controller, testEmployee, order.id, dryers[0], receiptOf(order));
    const endsAt = machineById(dryers[0])?.runEndsAt ?? 0;
    await expect(topUpDryer(ctx, controller, testEmployee, dryers[0], topUpId(dryers[0], 5))).resolves.toBe('acked');
    expect(controller.starts[1]).toEqual({ channel: 4, pulses: { count: 2, onMs: 500, offMs: 500 } });
    expect(machineById(dryers[0])?.runEndsAt).toBe(endsAt + 5 * MIN);

    await expect(topUpDryer(ctx, controller, testEmployee, dryers[0], topUpId(dryers[0], 15))).resolves.toBe('acked');
    expect(controller.starts[2]).toEqual({ channel: 4, pulses: { count: 7, onMs: 500, offMs: 500 } });
    expect(machineById(dryers[0])?.runEndsAt).toBe(endsAt + 20 * MIN);

    const detail = getOrderDetail(ctx, order.id);
    expect(detail?.order.total).toBe(order.total + 2000 + 5000);
    expect(detail?.items.map((i) => [i.name, i.unitPrice])).toEqual([
      ['Dryer top-up 5 min (Dryer 1)', 2000],
      ['Dryer top-up 15 min (Dryer 1)', 5000],
    ]);
    expect(log().filter((row) => row.kind === 'TOP_UP').map((row) => row.charge)).toEqual([5000, 2000]);
    // Top-ups do not use up the order's dryers.
    expect(machineUsage(ctx, order.id).DRYER).toBe(1);
  });

  it('can be added on the start screen: sent with the start and charged, undone if nothing went out', async () => {
    const { ctx, controller, order, dryers, machineById, topUpId, log, markWashed } = await setup();
    markWashed(order.id, 2);
    const fifteen = topUpId(dryers[0], 15);
    const run = (dryer: number, topUp: number) =>
      startOrderOnMachine(ctx, controller, testEmployee, order.id, dryer, receiptOf(order), null, topUp);

    controller.failNextStart('failed');
    await expect(run(dryers[0], fifteen)).resolves.toBe('failed');
    expect(getOrderDetail(ctx, order.id)?.order.total).toBe(order.total);
    expect(log().find((row) => row.kind === 'TOP_UP')).toMatchObject({ result: 'FAILED', charge: null });

    await expect(startMachine(ctx, controller, testEmployee, dryers[0], fifteen)).resolves.toBe('acked');
    // Dryer 1: 1 start pulse + 7 pulses for 15 minutes, in one go.
    expect(controller.starts[0]).toEqual({ channel: 4, pulses: { count: 8, onMs: 500, offMs: 500 } });
    expect(machineById(dryers[0])?.runEndsAt).toBe(ctx.now() + 45 * MIN);
    expect(getOrderDetail(ctx, order.id)?.order.total).toBe(order.total + 5000);
    expect(log().find((row) => row.kind === 'TOP_UP' && row.result === 'ACKED')).toMatchObject({ charge: 5000 });

    // Dryer 2 does not offer its 15 minutes, and Dryer 1's top-up is not Dryer 2's.
    await expect(run(dryers[1], topUpId(dryers[1], 15))).rejects.toThrow('switched off');
    await expect(run(dryers[1], fifteen)).rejects.toThrow('not on Dryer 2');
  });

  it('is gone once the dryer finishes or is marked as done', async () => {
    const { ctx, controller, order, newOrder, dryers, topUpId, markWashed } = await setup();
    const five = topUpId(dryers[0], 5);
    markWashed(order.id, 2);
    await startOrderOnMachine(ctx, controller, testEmployee, order.id, dryers[0], receiptOf(order));
    markRunDone(ctx, dryers[0]);
    await expect(topUpDryer(ctx, controller, testEmployee, dryers[0], five)).rejects.toThrow('not running');

    const other = newOrder();
    markWashed(other.id);
    await startOrderOnMachine(ctx, controller, testEmployee, other.id, dryers[0], receiptOf(other));
    ctx.advance(31 * MIN);
    await expect(topUpDryer(ctx, controller, testEmployee, dryers[0], five)).rejects.toThrow('not running');
  });

  it('refuses a top-up the dryer does not offer', async () => {
    const { ctx, controller, order, dryers, topUpId, markWashed } = await setup();
    markWashed(order.id, 2);
    await startOrderOnMachine(ctx, controller, testEmployee, order.id, dryers[0], receiptOf(order));
    await expect(topUpDryer(ctx, controller, testEmployee, dryers[0], topUpId(dryers[0], 10))).rejects.toThrow(
      'switched off',
    );
  });

  it('takes the charge off again when nothing was sent', async () => {
    const { ctx, controller, order, dryers, machineById, topUpId, log, markWashed } = await setup();
    markWashed(order.id, 2);
    await startOrderOnMachine(ctx, controller, testEmployee, order.id, dryers[0], receiptOf(order));
    const endsAt = machineById(dryers[0])?.runEndsAt;
    controller.failNextStart('busy');
    await expect(topUpDryer(ctx, controller, testEmployee, dryers[0], topUpId(dryers[0], 5))).resolves.toBe('busy');
    expect(getOrderDetail(ctx, order.id)?.order.total).toBe(order.total);
    expect(getOrderDetail(ctx, order.id)?.items).toEqual([]);
    expect(machineById(dryers[0])?.runEndsAt).toBe(endsAt);
    expect(log()[0]).toMatchObject({ kind: 'TOP_UP', result: 'BUSY', charge: null });
  });

  it('refuses washers, top-ups that are switched off, and closed orders', async () => {
    const { ctx, owner, controller, order, washers, dryers, topUpId, markWashed } = await setup();
    const five = topUpId(dryers[0], 5);
    await startOrderOnMachine(ctx, controller, testEmployee, order.id, washers[0], receiptOf(order));
    markRunDone(ctx, washers[0]);
    markWashed(order.id);
    await expect(topUpDryer(ctx, controller, testEmployee, washers[0], five)).rejects.toThrow('Only dryers');
    await startOrderOnMachine(ctx, controller, testEmployee, order.id, dryers[1], receiptOf(order));
    await expect(topUpDryer(ctx, controller, testEmployee, dryers[1], topUpId(dryers[1], 5))).rejects.toThrow(
      'switched off',
    );
    await expect(topUpDryer(ctx, controller, testEmployee, dryers[0], five)).rejects.toThrow('not running');
    await startOrderOnMachine(ctx, controller, testEmployee, order.id, dryers[0], receiptOf(order));
    updateOrderStatus(ctx, owner, order.id, 'COMPLETED');
    await expect(topUpDryer(ctx, controller, testEmployee, dryers[0], five)).rejects.toThrow('completed');
  });

  it('the developer can test each top-up on a dryer, even one not offered, with no order or charge', async () => {
    const { ctx, developer, controller, washers, dryers, topUpId, log, machineById } = await setup();
    await expect(testTopUp(ctx, controller, testEmployee, dryers[0], topUpId(dryers[0], 10))).rejects.toThrow(
      'managed by support',
    );
    await expect(testTopUp(ctx, controller, developer, washers[0], topUpId(dryers[0], 10))).rejects.toThrow('Only dryers');
    await expect(testTopUp(ctx, controller, developer, dryers[0], topUpId(dryers[1], 10))).rejects.toThrow('not on Dryer 1');
    await expect(testTopUp(ctx, controller, developer, dryers[0], topUpId(dryers[0], 10))).resolves.toBe('acked');
    expect(controller.starts[0]).toEqual({ channel: 4, pulses: { count: 4, onMs: 500, offMs: 500 } });
    expect(log()[0]).toMatchObject({ kind: 'TEST', orderId: null, charge: null, overrideNote: '10 min top-up (10 min)' });
    expect(machineById(dryers[0])?.runEndsAt).toBeNull();
  });

  it('the developer adds a top-up type to one, all or selected dryers, all or nothing', async () => {
    const { ctx, developer, controller, order, washers, dryers, machineById, markWashed } = await setup();
    const extra = { name: 'Extra dry', minutes: 30, pulses: 6, price: 9000 };
    expect(() => addTopUp(ctx, testEmployee, extra, [dryers[0]])).toThrow('managed by support');
    expect(() => addTopUp(ctx, developer, extra, [dryers[0], washers[0]])).toThrow('Washer 1 is a washer');
    expect(() => addTopUp(ctx, developer, { ...extra, pulses: 51 }, [dryers[0]])).toThrow('Dryer 1');
    expect(() => addTopUp(ctx, developer, { ...extra, name: '5 MIN' }, [dryers[1], dryers[0]])).toThrow(
      'already has a top-up called 5 MIN',
    );
    expect(listTopUps(ctx).some((t) => t.name === 'Extra dry')).toBe(false);

    addTopUp(ctx, developer, extra, [dryers[0], dryers[2]]);
    expect(listTopUps(ctx).filter((t) => t.name === 'Extra dry').map((t) => [t.machineId, t.enabled])).toEqual([
      [dryers[0], true],
      [dryers[2], true],
    ]);
    // Without a price it is added switched off.
    addTopUp(ctx, developer, { ...extra, name: 'Cool down', price: 0 }, [dryers[1]]);
    expect(listTopUps(ctx).find((t) => t.name === 'Cool down')).toMatchObject({ enabled: false, price: 0 });

    markWashed(order.id, 2);
    await startOrderOnMachine(ctx, controller, testEmployee, order.id, dryers[0], receiptOf(order));
    const endsAt = machineById(dryers[0])?.runEndsAt ?? 0;
    const extraDry = listTopUps(ctx).find((t) => t.machineId === dryers[0] && t.name === 'Extra dry');
    await expect(topUpDryer(ctx, controller, testEmployee, dryers[0], extraDry?.id ?? 0)).resolves.toBe('acked');
    expect(controller.starts[1].pulses.count).toBe(6);
    expect(machineById(dryers[0])?.runEndsAt).toBe(endsAt + 30 * MIN);
    expect(getOrderDetail(ctx, order.id)?.items.map((i) => i.name)).toEqual(['Dryer top-up Extra dry (Dryer 1)']);
  });

  it("checks each top-up's name, minutes, pulses and price when the dryer is saved", async () => {
    const { ctx, developer, dryers } = await setup();
    const own = listTopUps(ctx).filter((t) => t.machineId === dryers[0]);
    const edit = (change: Partial<(typeof own)[number]>) => own.map((t, i) => ({ ...t, ...(i === 0 ? change : {}) }));
    expect(() => updateTopUps(ctx, developer, dryers[0], edit({ pulses: 51 }))).toThrow('5 min');
    expect(() => updateTopUps(ctx, developer, dryers[0], edit({ minutes: 0 }))).toThrow('Minutes');
    expect(() => updateTopUps(ctx, developer, dryers[0], edit({ price: 0, enabled: true }))).toThrow('needs a price');
    expect(() => updateTopUps(ctx, developer, dryers[0], edit({ name: '10 min' }))).toThrow('two top-ups called 10 min');
    expect(() => updateTopUps(ctx, developer, dryers[1], own)).toThrow('not on Dryer 2');
    updateTopUps(ctx, developer, dryers[0], edit({ name: 'Quick', minutes: 7 }));
    expect(listTopUps(ctx).find((t) => t.id === own[0].id)).toMatchObject({ name: 'Quick', minutes: 7 });
  });
});

describe('washer before dryer', () => {
  it('a receipt cannot run a dryer for a load that has not been washed', async () => {
    const { ctx, controller, order, washers, dryers } = await setup();
    const run = (machineId: number) =>
      startOrderOnMachine(ctx, controller, testEmployee, order.id, machineId, receiptOf(order));
    await expect(run(dryers[0])).rejects.toThrow('Run a washer for');
    await run(washers[0]);
    await expect(run(dryers[0])).rejects.toThrow('Load 1 of T0001 is still in the washer');
    ctx.advance(30 * MIN);
    await expect(run(dryers[0])).resolves.toBe('acked');
    await expect(run(dryers[1])).rejects.toThrow('load 2 has not been washed');
    expect(controller.starts).toHaveLength(2);
  });

  it('a dry-only order runs dryers only, with no washer needed', async () => {
    const { ctx, controller, customer, washers, dryers } = await setup();
    const dry = createOrder(ctx, testEmployee, {
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
      dryOnly: true,
    });
    const run = (machineId: number) =>
      startOrderOnMachine(ctx, controller, testEmployee, dry.id, machineId, receiptOf(dry));
    await expect(run(washers[0])).rejects.toThrow('does not include washer use');
    await expect(run(dryers[0])).resolves.toBe('acked');
  });
});

describe('receipt QR codes', () => {
  it('runs a machine only with the receipt of that order', async () => {
    const { ctx, controller, order, newOrder, washers, machineById, log } = await setup();
    const other = newOrder();
    const run = (code: string) => startOrderOnMachine(ctx, controller, testEmployee, order.id, washers[0], code);

    await expect(run('hello')).rejects.toThrow('not a Laundry POS receipt');
    await expect(run(receiptCodeFor(order.id, 'f'.repeat(32)))).rejects.toThrow(`does not match order ${order.id}`);
    await expect(run(receiptOf(other))).rejects.toThrow(`This receipt is for ${other.id}, not ${order.id}`);
    expect(controller.starts).toEqual([]);
    expect(log()).toEqual([]);
    expect(machineById(washers[0])?.assignedOrderId).toBeNull();

    await expect(run(` ${receiptOf(order)}\n`)).resolves.toBe('acked');
  });

  it('allows as many washer and dryer runs as the order has loads, and no more', async () => {
    const { ctx, controller, order, washers, dryers } = await setup();
    const code = receiptOf(order);
    for (const id of [washers[0], washers[1], dryers[0], dryers[1]]) {
      await expect(startOrderOnMachine(ctx, controller, testEmployee, order.id, id, code)).resolves.toBe('acked');
      // Staff tap Mark as done when a wash finishes early, so its load can go in a dryer.
      markRunDone(ctx, id);
    }
    await expect(startOrderOnMachine(ctx, controller, testEmployee, order.id, washers[2], code)).rejects.toThrow(
      'used all its washers',
    );
    await expect(startOrderOnMachine(ctx, controller, testEmployee, order.id, dryers[2], code)).rejects.toThrow(
      'used all its dryers',
    );
  });

  it("a voided order's receipt no longer runs a machine", async () => {
    const { ctx, owner, controller, order, washers } = await setup();
    voidOrder(ctx, owner, order.id, 'Test');
    await expect(
      startOrderOnMachine(ctx, controller, testEmployee, order.id, washers[0], receiptOf(order)),
    ).rejects.toThrow('voided');
  });

  it('the temporary test code works for any open order', async () => {
    const { ctx, controller, order, washers } = await setup();
    expect(readReceiptCode(ctx, TEST_RECEIPT_CODE)).toEqual({ kind: 'test' });
    await expect(
      startOrderOnMachine(ctx, controller, testEmployee, order.id, washers[0], TEST_RECEIPT_CODE),
    ).resolves.toBe('acked');
  });

  it('identifies the order from its receipt', async () => {
    const { ctx, order } = await setup();
    expect(readReceiptCode(ctx, receiptOf(order))).toEqual({ kind: 'order', orderId: order.id });
    expect(() => readReceiptCode(ctx, receiptCodeFor('T9999', 'a'.repeat(32)))).toThrow('does not match order T9999');
  });

  it('the owner or developer can turn receipt scans off and on', async () => {
    const { ctx, owner, developer, controller, order, washers } = await setup();
    const run = (machineId: number) =>
      startOrderOnMachine(ctx, controller, testEmployee, order.id, machineId, null);
    await expect(run(washers[0])).rejects.toThrow('not a Laundry POS receipt');

    expect(() => setReceiptScanRequired(ctx, testEmployee, false)).toThrow('Only the owner');
    setReceiptScanRequired(ctx, owner, false);
    await expect(run(washers[0])).resolves.toBe('acked');

    setReceiptScanRequired(ctx, developer, true);
    await expect(run(washers[1])).rejects.toThrow('not a Laundry POS receipt');
  });

  it('gives every order its own code', async () => {
    const { order, newOrder } = await setup();
    const other = newOrder();
    expect(order.qrToken).toMatch(/^[0-9a-f]{32}$/);
    expect(other.qrToken).not.toBe(order.qrToken);
  });
});

describe('machine earnings', () => {
  it('counts half the price per load for each wash or dry the machine ran', async () => {
    const { ctx, owner, controller, order, newOrder, washers, dryers } = await setup();
    const half = Math.floor(order.pricePerLoad / 2);
    const run = (o: typeof order, machineId: number) =>
      startOrderOnMachine(ctx, controller, testEmployee, o.id, machineId, receiptOf(o));

    await run(order, washers[0]);
    ctx.advance(DAY);
    markRunDone(ctx, washers[0]);
    await run(order, washers[0]);
    await run(order, dryers[0]);

    const voided = newOrder();
    markRunDone(ctx, washers[0]);
    await run(voided, washers[0]);
    voidOrder(ctx, owner, voided.id, 'Test');

    controller.failNextStart('failed');
    markRunDone(ctx, washers[1]);
    await run(newOrder(), washers[1]);

    expect(machineEarningsFor(ctx, washers[0])).toEqual({
      today: { loads: 1, amount: half },
      month: { loads: 2, amount: 2 * half },
      allTime: { loads: 2, amount: 2 * half },
    });
    expect(machineEarningsFor(ctx, dryers[0]).today).toEqual({ loads: 1, amount: half });
    expect(machineEarningsFor(ctx, washers[1]).allTime).toEqual({ loads: 0, amount: 0 });
  });
});

describe('top-ups paid with the order', () => {
  const prices = [
    { minutes: 5, price: 2000 },
    { minutes: 10, price: 3500 },
    { minutes: 15, price: 0 },
    { minutes: 20, price: 6000 },
  ];

  /** Every dryer offers its 10-minute top-up (Dryer 1: 4 pulses; the others: 2). */
  function offerTenMinutes(env: Awaited<ReturnType<typeof setup>>) {
    for (const dryer of env.dryers) {
      const own = listTopUps(env.ctx).filter((t) => t.machineId === dryer);
      updateTopUps(
        env.ctx,
        env.developer,
        dryer,
        own.map((t) => (t.minutes === 10 ? { ...t, enabled: true, price: 3500 } : t)),
      );
    }
  }

  async function setupPrepaid(topUp: { minutes: number; loads: number } | null) {
    const env = await setup();
    setSetting(env.ctx.db, 'shopTopUps', prices);
    offerTenMinutes(env);
    const order = createOrder(env.ctx, testEmployee, {
      customerId: env.customer.id,
      weightKg: 24,
      loads: 3,
      addOns: [],
      paymentMethod: 'PAY_LATER',
      downPayment: 0,
      channel: 'CASH',
      gcashReference: '',
      cashReceived: null,
      placedAt: null,
      topUp,
    });
    const run = (machineId: number) =>
      startOrderOnMachine(env.ctx, env.controller, testEmployee, order.id, machineId, receiptOf(order));
    return { ...env, order, run };
  }

  it('charges the shop top-up price per load and puts it on the bill', async () => {
    const { ctx, order } = await setupPrepaid({ minutes: 10, loads: 2 });
    const plain = createOrder(ctx, testEmployee, {
      customerId: order.customerId,
      weightKg: 24,
      loads: 3,
      addOns: [],
      paymentMethod: 'PAY_LATER',
      downPayment: 0,
      channel: 'CASH',
      gcashReference: '',
      cashReceived: null,
      placedAt: null,
    });
    expect(order.total).toBe(plain.total + 2 * 3500);
    expect(getOrderDetail(ctx, order.id)?.items.map((i) => [i.name, i.quantity, i.unitPrice])).toEqual([
      ['Dryer top-up 10 min, paid ahead', 2, 3500],
    ]);
  });

  it('refuses a length without a shop price or that no dryer offers, or more loads than the order has', async () => {
    const env = await setup();
    const { ctx, customer } = env;
    setSetting(ctx.db, 'shopTopUps', prices);
    offerTenMinutes(env);
    const base = {
      customerId: customer.id,
      weightKg: 8,
      loads: 1,
      addOns: [],
      paymentMethod: 'PAY_LATER' as const,
      downPayment: 0,
      channel: 'CASH' as const,
      gcashReference: '',
      cashReceived: null,
      placedAt: null,
    };
    expect(orderTopUpChoices(ctx.db)).toEqual([
      { minutes: 5, price: 2000 },
      { minutes: 10, price: 3500 },
    ]);
    expect(() => createOrder(ctx, testEmployee, { ...base, topUp: { minutes: 15, loads: 1 } })).toThrow('not offered');
    // 20 minutes has a shop price, but no dryer offers it.
    expect(() => createOrder(ctx, testEmployee, { ...base, topUp: { minutes: 20, loads: 1 } })).toThrow('not offered');
    expect(() => createOrder(ctx, testEmployee, { ...base, topUp: { minutes: 10, loads: 2 } })).toThrow('1 to 1 load');
  });

  it("saving the shop prices gives every dryer's offered top-up of that length the price (owner only)", async () => {
    const { ctx, owner, dryers } = await setup();
    expect(() => saveShopTopUpPrices(ctx, testEmployee, prices)).toThrow('Only the owner');
    saveShopTopUpPrices(ctx, owner, [...prices, { minutes: 15, price: 5500 }]);
    expect(getSetting(ctx.db, 'shopTopUps')).toEqual([...prices, { minutes: 15, price: 5500 }]);
    const price = (dryer: number, minutes: number) =>
      listTopUps(ctx).find((t) => t.machineId === dryer && t.minutes === minutes)?.price;
    // Dryer 1 offers 5 and 15 minutes; its switched-off 10 minutes, and the other dryers, keep their prices.
    expect([5, 10, 15].map((m) => price(dryers[0], m))).toEqual([2000, 0, 5500]);
    expect([5, 10, 15].map((m) => price(dryers[1], m))).toEqual([0, 0, 0]);
  });

  it('refuses a dryer that does not offer the length paid for, before it is assigned', async () => {
    const { ctx, developer, order, run, washers, dryers, machineById, markWashed } = await setupPrepaid({
      minutes: 10,
      loads: 1,
    });
    await run(washers[0]);
    markRunDone(ctx, washers[0]);
    markWashed(order.id);
    const own = listTopUps(ctx).filter((t) => t.machineId === dryers[2]);
    updateTopUps(ctx, developer, dryers[2], own.map((t) => ({ ...t, enabled: false })));
    await expect(run(dryers[2])).rejects.toThrow('does not offer');
    expect(machineById(dryers[2])?.assignedOrderId).toBeNull();
    await expect(run(dryers[1])).resolves.toBe('acked');
  });

  it('adds the minutes and pulses to the first dryer starts it covers, and not to washers', async () => {
    const { ctx, controller, order, run, washers, dryers, machineById, markWashed } = await setupPrepaid({
      minutes: 10,
      loads: 2,
    });
    await run(washers[0]);
    expect(controller.starts[0].pulses.count).toBe(3);
    markRunDone(ctx, washers[0]);
    markWashed(order.id, 2);

    // Dryer 1: 1 start pulse + 2 top-up pulses per 5 minutes x 2.
    await run(dryers[0]);
    expect(controller.starts[1]).toEqual({ channel: 4, pulses: { count: 5, onMs: 500, offMs: 500 } });
    expect(machineById(dryers[0])?.runEndsAt).toBe(ctx.now() + 40 * MIN);

    // A start that sent nothing does not use the top-up up.
    controller.failNextStart('failed');
    await expect(run(dryers[1])).resolves.toBe('failed');
    await expect(startMachine(ctx, controller, testEmployee, dryers[1])).resolves.toBe('acked');
    expect(controller.starts[2].pulses.count).toBe(3);
    expect(machineById(dryers[1])?.runEndsAt).toBe(ctx.now() + 40 * MIN);

    // The third load was not paid ahead.
    await run(dryers[2]);
    expect(controller.starts[3].pulses.count).toBe(1);
    expect(machineById(dryers[2])?.runEndsAt).toBe(ctx.now() + 30 * MIN);
  });
});

describe('multi-cycle', () => {
  /** Turns Multi-cycle on and gives Washer 1 cycles with distinct pulses and minutes. */
  async function setupCycles() {
    const env = await setup();
    const cycles = listCycles(env.ctx).filter((cycle) => cycle.machineId === env.washers[0]);
    const byName = (name: string) => {
      const cycle = cycles.find((c) => c.name === name);
      if (!cycle) throw new Error(`No ${name} cycle`);
      return cycle.id;
    };
    updateCycles(env.ctx, env.developer, env.washers[0], [
      { id: byName('Delicates'), name: 'Delicates', pulses: 2, minutes: 25, enabled: true },
      { id: byName('Light'), name: 'Light', pulses: 3, minutes: 30, enabled: true },
      { id: byName('Medium'), name: 'Medium', pulses: 4, minutes: 40, enabled: true },
      { id: byName('Heavy'), name: 'Heavy', pulses: 6, minutes: 55, enabled: true },
    ]);
    setMultiCycle(env.ctx, env.developer, true);
    return { ...env, byName };
  }

  it('gives every new washer the four starting cycles, and dryers none', async () => {
    const { ctx, washers, dryers } = await setup();
    const names = (id: number) => listCycles(ctx).filter((c) => c.machineId === id).map((c) => c.name);
    expect(names(washers[1])).toEqual(['Delicates', 'Light', 'Medium', 'Heavy']);
    expect(names(dryers[0])).toEqual([]);
  });

  it('only the owner or developer turns it on, and while off a start ignores cycles', async () => {
    const { ctx, owner, developer, controller, order, washers } = await setup();
    expect(() => setMultiCycle(ctx, testEmployee, true)).toThrow('Only the owner');
    const heavy = listCycles(ctx).find((c) => c.machineId === washers[0] && c.name === 'Heavy')?.id ?? null;
    await startOrderOnMachine(ctx, controller, testEmployee, order.id, washers[0], receiptOf(order), heavy);
    expect(controller.starts[0].pulses.count).toBe(3);
    setMultiCycle(ctx, owner, true);
    expect(getSetting(ctx.db, 'multiCycle')).toBe(true);
    setMultiCycle(ctx, developer, false);
    expect(getSetting(ctx.db, 'multiCycle')).toBe(false);
  });

  it('only the developer can simulate the machines', async () => {
    const { ctx, owner, developer } = await setup();
    expect(() => setSimulateMachines(ctx, testEmployee, true)).toThrow('managed by support');
    expect(() => setSimulateMachines(ctx, owner, true)).toThrow('managed by support');
    setSimulateMachines(ctx, developer, true);
    expect(getSetting(ctx.db, 'simulateMachines')).toBe(true);
  });

  it("needs a cycle, then sends that cycle's pulses and counts down its minutes", async () => {
    const { ctx, controller, order, washers, machineById, log, byName } = await setupCycles();
    const run = (cycleId: number | null) =>
      startOrderOnMachine(ctx, controller, testEmployee, order.id, washers[0], receiptOf(order), cycleId);
    await expect(run(null)).rejects.toThrow('Pick a cycle');
    expect(controller.starts).toEqual([]);

    await expect(run(byName('Heavy'))).resolves.toBe('acked');
    expect(controller.starts[0]).toEqual({ channel: 1, pulses: { count: 6, onMs: 500, offMs: 500 } });
    expect(machineById(washers[0])?.runEndsAt).toBe(ctx.now() + 55 * MIN);
    expect(log()[0]).toMatchObject({ kind: 'ORDER', cycle: 'Heavy' });
  });

  it("refuses a switched-off cycle or another washer's cycle", async () => {
    const { ctx, developer, controller, order, washers, byName } = await setupCycles();
    const all = listCycles(ctx).filter((c) => c.machineId === washers[0]);
    updateCycles(ctx, developer, washers[0], all.map((c) => ({ ...c, enabled: c.name !== 'Heavy' })));
    const run = (machineId: number, cycleId: number) =>
      startOrderOnMachine(ctx, controller, testEmployee, order.id, machineId, receiptOf(order), cycleId);
    await expect(run(washers[0], byName('Heavy'))).rejects.toThrow('switched off');
    await expect(run(washers[1], byName('Light'))).rejects.toThrow('not on Washer 2');
    expect(controller.starts).toEqual([]);
  });

  it('a washer with every cycle switched off starts with its own pulses', async () => {
    const { ctx, developer, controller, order, washers } = await setupCycles();
    const all = listCycles(ctx).filter((c) => c.machineId === washers[0]);
    updateCycles(ctx, developer, washers[0], all.map((c) => ({ ...c, enabled: false })));
    await expect(
      startOrderOnMachine(ctx, controller, testEmployee, order.id, washers[0], receiptOf(order)),
    ).resolves.toBe('acked');
    expect(controller.starts[0].pulses.count).toBe(3);
  });

  it('dryers have no cycles: they start with their own pulses and run time', async () => {
    const { ctx, developer, controller, order, washers, dryers, machineById, byName } = await setupCycles();
    await startOrderOnMachine(ctx, controller, testEmployee, order.id, washers[0], receiptOf(order), byName('Light'));
    markRunDone(ctx, washers[0]);
    await expect(
      startOrderOnMachine(ctx, controller, testEmployee, order.id, dryers[0], receiptOf(order)),
    ).resolves.toBe('acked');
    expect(controller.starts[1].pulses.count).toBe(1);
    expect(machineById(dryers[0])?.runEndsAt).toBe(ctx.now() + 30 * MIN);
    await testStart(ctx, controller, developer, dryers[1]);
    expect(controller.starts[2].pulses.count).toBe(1);
  });

  it('a retry after a start that sent nothing runs the cycle that was picked', async () => {
    const { ctx, controller, order, washers, byName } = await setupCycles();
    controller.failNextStart('failed');
    await expect(
      startOrderOnMachine(ctx, controller, testEmployee, order.id, washers[0], receiptOf(order), byName('Delicates')),
    ).resolves.toBe('failed');
    await expect(startMachine(ctx, controller, testEmployee, washers[0])).resolves.toBe('acked');
    expect(controller.starts[0].pulses.count).toBe(2);
  });

  it('tests and overrides run the cycle picked, or the first one switched on', async () => {
    const { ctx, developer, controller, washers, log, byName } = await setupCycles();
    await testStart(ctx, controller, developer, washers[0]);
    await testStart(ctx, controller, developer, washers[0], byName('Heavy'));
    expect(controller.starts.map((start) => start.pulses.count)).toEqual([2, 6]);
    expect(log().map((row) => row.cycle)).toEqual(['Heavy', 'Delicates']);
  });

  it('the developer adds a cycle to one, all or selected washers, all or nothing', async () => {
    const { ctx, developer, washers, dryers } = await setupCycles();
    const quick = { name: 'Quick wash', pulses: 1, minutes: 20 };
    expect(() => addCycle(ctx, testEmployee, quick, [washers[0]])).toThrow('managed by support');
    expect(() => addCycle(ctx, developer, quick, [washers[0], dryers[0]])).toThrow('Dryer 1 is a dryer');
    expect(() => addCycle(ctx, developer, { ...quick, pulses: 51 }, [washers[0]])).toThrow('Washer 1');
    expect(() => addCycle(ctx, developer, { ...quick, name: 'heavy' }, [washers[1], washers[0]])).toThrow(
      'already has a cycle called heavy',
    );
    expect(listCycles(ctx).some((c) => c.name === 'Quick wash')).toBe(false);

    addCycle(ctx, developer, quick, [washers[0], washers[2]]);
    const withQuick = listCycles(ctx).filter((c) => c.name === 'Quick wash').map((c) => c.machineId);
    expect(withQuick).toEqual([washers[0], washers[2]]);
    expect(listCycles(ctx).filter((c) => c.machineId === washers[0]).map((c) => c.name)).toEqual([
      'Delicates',
      'Light',
      'Medium',
      'Heavy',
      'Quick wash',
    ]);
  });

  it("checks each cycle's pulses, minutes and name when the washer is saved", async () => {
    const { ctx, developer, washers } = await setupCycles();
    const all = listCycles(ctx).filter((c) => c.machineId === washers[0]);
    const edit = (change: Partial<(typeof all)[number]>) =>
      all.map((c, i) => ({ ...c, ...(i === 0 ? change : {}) }));
    expect(() => updateCycles(ctx, developer, washers[0], edit({ pulses: 51 }))).toThrow('Delicates');
    expect(() => updateCycles(ctx, developer, washers[0], edit({ minutes: 0 }))).toThrow('Run time');
    expect(() => updateCycles(ctx, developer, washers[0], edit({ name: 'Light' }))).toThrow('two cycles called Light');
    expect(() => updateCycles(ctx, developer, washers[1], all)).toThrow('not on Washer 2');
  });
});

