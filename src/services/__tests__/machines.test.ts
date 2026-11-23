import { createTestContext, receiptOf, testEmployee } from '@/db/testing';
import { sameForEveryCycle } from '@/domain/cycles';
import { NO_TOP_UP_PRICES } from '@/domain/machinePolicy';
import { receiptCodeFor, TEST_RECEIPT_CODE } from '@/domain/receiptCode';
import { machineUnlocks } from '@/db/schema';
import { MockMachineController } from '@/machines/MockMachineController';

import { completeFirstRunSetup } from '../auth';
import { createCustomer } from '../customers';
import {
  addMachine,
  applyPulsesToMachines,
  applyTopUpPricesToDryers,
  assignOrder,
  listMachineLog,
  listMachines,
  machineUsage,
  machineEarningsFor,
  markRunDone,
  overrideStart,
  readReceiptCode,
  saveLockController,
  saveShopTopUpPrices,
  setMultiCycle,
  setReceiptScanRequired,
  startMachine,
  startOrderOnMachine,
  testStart,
  testTopUp,
  topUpDryer,
  unassignMachine,
  updateMachine,
  type MachineInput,
} from '../machines';
import { createOrder, getOrderDetail, updateOrderStatus, voidOrder } from '../orders';
import { getSetting, setSetting } from '../settings';

const PULSES = { pulseCount: 1, pulseOnMs: 500, pulseOffMs: 500, runMinutes: 30, topUpPulseCount: 1, topUpPulses10: 2, topUpPulses15: 3, topUpPulses20: 4, ...NO_TOP_UP_PRICES, ...sameForEveryCycle(1, 30) };
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
  const washer1 = addMachine(ctx, owner, { ...machine('Washer 1', 'WASHER', 1), pulseCount: 3 });
  const washer2 = addMachine(ctx, owner, machine('Washer 2', 'WASHER', 2));
  const washer3 = addMachine(ctx, owner, machine('Washer 3', 'WASHER', 3));
  const dryer1 = addMachine(ctx, owner, { ...machine('Dryer 1', 'DRYER', 4), topUpPulseCount: 2, topUpPulses10: 4, topUpPulses15: 7, topUpPrice: 2000, topUpPrice15: 5000 });
  const dryer2 = addMachine(ctx, owner, machine('Dryer 2', 'DRYER', 5));
  const dryer3 = addMachine(ctx, owner, machine('Dryer 3', 'DRYER', 6));
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
    controller,
    customer,
    order,
    newOrder,
    washers: [washer1, washer2, washer3],
    dryers: [dryer1, dryer2, dryer3],
    machineById,
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
    const { ctx, owner, order, washers } = await setup();
    expect(() => assignOrder(ctx, testEmployee, 'T9999', washers[0])).toThrow('No order');
    updateMachine(ctx, owner, washers[0], { ...machine('Washer 1', 'WASHER', 1), enabled: false });
    expect(() => assignOrder(ctx, testEmployee, order.id, washers[0])).toThrow('switched off');
    updateOrderStatus(ctx, owner, order.id, 'COMPLETED');
    expect(() => assignOrder(ctx, testEmployee, order.id, washers[1])).toThrow('completed');
    updateOrderStatus(ctx, owner, order.id, 'READY');
    voidOrder(ctx, owner, order.id, 'Test');
    expect(() => assignOrder(ctx, testEmployee, order.id, washers[1])).toThrow('voided');
  });

  it('frees machines when their order is voided or completed, or the machine is switched off', async () => {
    const { ctx, owner, order, washers, dryers, machineById, markWashed } = await setup();
    markWashed(order.id);
    assignOrder(ctx, testEmployee, order.id, washers[0]);
    updateMachine(ctx, owner, washers[0], { ...machine('Washer 1', 'WASHER', 1), enabled: false });
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

  it('requires a note for "Other"', async () => {
    const { ctx, controller, washers } = await setup();
    await expect(
      overrideStart(ctx, controller, testEmployee, { machineId: washers[0], reason: 'Other', note: ' ', orderId: null, pin: '2468' }),
    ).rejects.toThrow('Describe');
  });
});

describe('machine settings', () => {
  it('keeps channels unique, checks pulses, and lets only the owner change machines or test', async () => {
    const { ctx, owner, controller, washers, log } = await setup();
    expect(() => addMachine(ctx, owner, machine('Dup', 'WASHER', 1))).toThrow('already used by Washer 1');
    expect(() => addMachine(ctx, owner, machine('Washer 15', 'WASHER', 15))).toThrow('from 1 to 14');
    expect(() => addMachine(ctx, owner, { ...machine('W', 'WASHER', 9), pulseCount: 0 })).toThrow('pulses');
    expect(() => addMachine(ctx, owner, { ...machine('W', 'WASHER', 9), pulseOnMs: 10 })).toThrow('Pulse length');
    expect(addMachine(ctx, owner, machine('Dryer 7', 'DRYER', 14))).toBeGreaterThan(0);
    expect(() => addMachine(ctx, testEmployee, machine('X', 'WASHER', 9))).toThrow('owner');
    await expect(testStart(ctx, controller, testEmployee, washers[0])).rejects.toThrow('owner');
    await expect(testStart(ctx, controller, owner, washers[0])).resolves.toBe('acked');
    expect(log()[0].kind).toBe('TEST');
  });

  it('copies start pulses to chosen machines only, for the owner, after checking them', async () => {
    const { ctx, owner, washers, dryers, machineById } = await setup();
    const pulses = { count: 12, onMs: 80, offMs: 70 };
    expect(() => applyPulsesToMachines(ctx, testEmployee, pulses, washers)).toThrow('owner');
    expect(() => applyPulsesToMachines(ctx, owner, { ...pulses, onMs: 5 }, washers)).toThrow('Pulse length');
    applyPulsesToMachines(ctx, owner, pulses, [washers[1], dryers[0]]);
    expect(machineById(washers[1])).toMatchObject({ pulseCount: 12, pulseOnMs: 80, pulseOffMs: 70 });
    expect(machineById(dryers[0])).toMatchObject({ pulseCount: 12, pulseOnMs: 80, pulseOffMs: 70, topUpPulseCount: 2 });
    expect(machineById(washers[0])).toMatchObject({ pulseCount: 3, pulseOnMs: 500 });
    expect(machineById(dryers[1])).toMatchObject({ pulseCount: 1, pulseOnMs: 500 });
  });

  it('saves the controller address and key for the owner only, after checking them', async () => {
    const { ctx, owner } = await setup();
    const good = { address: ' 192.168.1.50 ', key: 'correct horse battery' };
    expect(() => saveLockController(ctx, testEmployee, good)).toThrow('owner');
    expect(() => saveLockController(ctx, owner, { ...good, address: 'not an address!' })).toThrow('192.168.1.50');
    expect(() => saveLockController(ctx, owner, { ...good, key: 'short' })).toThrow('at least 12');
    expect(getSetting(ctx.db, 'lockControllerAddress')).toBe('');

    saveLockController(ctx, owner, good);
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
    const { ctx, owner, controller, order, washers, machineById } = await setup();
    await testStart(ctx, controller, owner, washers[1]);
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
    const { ctx, controller, order, dryers, machineById, log , markWashed } = await setup();
    markWashed(order.id, 2);
    await startOrderOnMachine(ctx, controller, testEmployee, order.id, dryers[0], receiptOf(order));
    const endsAt = machineById(dryers[0])?.runEndsAt ?? 0;
    await expect(topUpDryer(ctx, controller, testEmployee, dryers[0], 5)).resolves.toBe('acked');
    expect(controller.starts[1]).toEqual({ channel: 4, pulses: { count: 2, onMs: 500, offMs: 500 } });
    expect(machineById(dryers[0])?.runEndsAt).toBe(endsAt + 5 * MIN);

    await expect(topUpDryer(ctx, controller, testEmployee, dryers[0], 15)).resolves.toBe('acked');
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

  it('is gone once the dryer finishes or is marked as done', async () => {
    const { ctx, controller, order, newOrder, dryers, markWashed } = await setup();
    markWashed(order.id, 2);
    await startOrderOnMachine(ctx, controller, testEmployee, order.id, dryers[0], receiptOf(order));
    markRunDone(ctx, dryers[0]);
    await expect(topUpDryer(ctx, controller, testEmployee, dryers[0], 5)).rejects.toThrow('not running');

    const other = newOrder();
    markWashed(other.id);
    await startOrderOnMachine(ctx, controller, testEmployee, other.id, dryers[0], receiptOf(other));
    ctx.advance(31 * MIN);
    await expect(topUpDryer(ctx, controller, testEmployee, dryers[0], 5)).rejects.toThrow('not running');
  });

  it('refuses a length the dryer does not offer', async () => {
    const { ctx, controller, order, dryers , markWashed } = await setup();
    markWashed(order.id, 2);
    await startOrderOnMachine(ctx, controller, testEmployee, order.id, dryers[0], receiptOf(order));
    await expect(topUpDryer(ctx, controller, testEmployee, dryers[0], 10)).rejects.toThrow('no price');
  });

  it('takes the charge off again when nothing was sent', async () => {
    const { ctx, controller, order, dryers, machineById, log , markWashed } = await setup();
    markWashed(order.id, 2);
    await startOrderOnMachine(ctx, controller, testEmployee, order.id, dryers[0], receiptOf(order));
    const endsAt = machineById(dryers[0])?.runEndsAt;
    controller.failNextStart('busy');
    await expect(topUpDryer(ctx, controller, testEmployee, dryers[0], 5)).resolves.toBe('busy');
    expect(getOrderDetail(ctx, order.id)?.order.total).toBe(order.total);
    expect(getOrderDetail(ctx, order.id)?.items).toEqual([]);
    expect(machineById(dryers[0])?.runEndsAt).toBe(endsAt);
    expect(log()[0]).toMatchObject({ kind: 'TOP_UP', result: 'BUSY', charge: null });
  });

  it('refuses washers, dryers without a price, and closed orders', async () => {
    const { ctx, owner, controller, order, washers, dryers, markWashed } = await setup();
    await startOrderOnMachine(ctx, controller, testEmployee, order.id, washers[0], receiptOf(order));
    markRunDone(ctx, washers[0]);
    markWashed(order.id);
    await expect(topUpDryer(ctx, controller, testEmployee, washers[0], 5)).rejects.toThrow('Only dryers');
    await startOrderOnMachine(ctx, controller, testEmployee, order.id, dryers[1], receiptOf(order));
    await expect(topUpDryer(ctx, controller, testEmployee, dryers[1], 5)).rejects.toThrow('no price');
    await expect(topUpDryer(ctx, controller, testEmployee, dryers[0], 5)).rejects.toThrow('not running');
    await startOrderOnMachine(ctx, controller, testEmployee, order.id, dryers[0], receiptOf(order));
    updateOrderStatus(ctx, owner, order.id, 'COMPLETED');
    await expect(topUpDryer(ctx, controller, testEmployee, dryers[0], 5)).rejects.toThrow('completed');
  });

  it('the owner can test each top-up length on a dryer, with no order or charge', async () => {
    const { ctx, owner, controller, washers, dryers, log, machineById } = await setup();
    await expect(testTopUp(ctx, controller, testEmployee, dryers[0], 10)).rejects.toThrow('Only the owner');
    await expect(testTopUp(ctx, controller, owner, washers[0], 10)).rejects.toThrow('Only dryers');
    await expect(testTopUp(ctx, controller, owner, dryers[0], 15)).resolves.toBe('acked');
    expect(controller.starts[0]).toEqual({ channel: 4, pulses: { count: 7, onMs: 500, offMs: 500 } });
    expect(log()[0]).toMatchObject({ kind: 'TEST', orderId: null, charge: null, overrideNote: '15-minute top-up' });
    expect(machineById(dryers[0])?.runEndsAt).toBeNull();
  });

  it('the owner can give all or some dryers the same top-up prices', async () => {
    const { ctx, owner, washers, dryers, machineById } = await setup();
    const prices = { topUpPrice: 2500, topUpPrice10: 4500, topUpPrice15: 6500, topUpPrice20: 8000 };
    expect(() => applyTopUpPricesToDryers(ctx, testEmployee, prices, [dryers[1]])).toThrow('Only the owner');

    applyTopUpPricesToDryers(ctx, owner, prices, [dryers[1], washers[0]]);
    expect(machineById(dryers[1])).toMatchObject(prices);
    expect(machineById(dryers[2])).toMatchObject(NO_TOP_UP_PRICES);
    expect(machineById(washers[0])).toMatchObject(NO_TOP_UP_PRICES);

    // Dryer 3's 20-minute top-up sends 51 pulses, over the limit of 50.
    updateMachine(ctx, owner, dryers[2], { ...machine('Dryer 3', 'DRYER', 6), topUpPulses20: 51 });
    expect(() => applyTopUpPricesToDryers(ctx, owner, prices, [dryers[1], dryers[2]])).toThrow('Dryer 3: 20-minute');
    expect(machineById(dryers[1])).toMatchObject(prices);
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

  it('the owner can turn receipt scans off and on', async () => {
    const { ctx, owner, controller, order, washers } = await setup();
    const run = (machineId: number) =>
      startOrderOnMachine(ctx, controller, testEmployee, order.id, machineId, null);
    await expect(run(washers[0])).rejects.toThrow('not a Laundry POS receipt');

    expect(() => setReceiptScanRequired(ctx, testEmployee, false)).toThrow('Only the owner');
    setReceiptScanRequired(ctx, owner, false);
    await expect(run(washers[0])).resolves.toBe('acked');

    setReceiptScanRequired(ctx, owner, true);
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
  const prices = { topUpPrice: 2000, topUpPrice10: 3500, topUpPrice15: 0, topUpPrice20: 6000 };

  async function setupPrepaid(topUp: { minutes: 5 | 10 | 15 | 20; loads: number } | null) {
    const env = await setup();
    setSetting(env.ctx.db, 'orderTopUpPrices', prices);
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

  it('refuses a length without a shop price, or more loads than the order has', async () => {
    const { ctx, customer } = await setup();
    setSetting(ctx.db, 'orderTopUpPrices', prices);
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
    expect(() => createOrder(ctx, testEmployee, { ...base, topUp: { minutes: 15, loads: 1 } })).toThrow('no price');
    expect(() => createOrder(ctx, testEmployee, { ...base, topUp: { minutes: 10, loads: 2 } })).toThrow('1 to 1 load');
  });

  it('saving the shop prices gives every dryer the same prices (owner only)', async () => {
    const { ctx, owner, washers, dryers, machineById } = await setup();
    expect(() => saveShopTopUpPrices(ctx, testEmployee, prices)).toThrow('Only the owner');
    saveShopTopUpPrices(ctx, owner, prices);
    expect(getSetting(ctx.db, 'orderTopUpPrices')).toEqual(prices);
    for (const dryer of dryers) expect(machineById(dryer)).toMatchObject(prices);
    expect(machineById(washers[0])).toMatchObject(NO_TOP_UP_PRICES);
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
  const cycles = {
    delicatesPulses: 2,
    delicatesMinutes: 25,
    lightPulses: 3,
    lightMinutes: 30,
    mediumPulses: 4,
    mediumMinutes: 40,
    heavyPulses: 6,
    heavyMinutes: 55,
  };

  async function setupCycles() {
    const env = await setup();
    updateMachine(env.ctx, env.owner, env.washers[0], { ...machine('Washer 1', 'WASHER', 1), ...cycles });
    setMultiCycle(env.ctx, env.owner, true);
    return env;
  }

  it('only the owner turns it on, and while off a start ignores cycles', async () => {
    const { ctx, owner, controller, order, washers } = await setup();
    expect(() => setMultiCycle(ctx, testEmployee, true)).toThrow('Only the owner');
    await startOrderOnMachine(ctx, controller, testEmployee, order.id, washers[0], receiptOf(order), 'HEAVY');
    expect(controller.starts[0].pulses.count).toBe(3);
    setMultiCycle(ctx, owner, true);
    expect(getSetting(ctx.db, 'multiCycle')).toBe(true);
  });

  it("needs a cycle, then sends that cycle's pulses and counts down its minutes", async () => {
    const { ctx, controller, order, washers, machineById, log } = await setupCycles();
    const run = (cycle: 'DELICATES' | 'HEAVY' | null) =>
      startOrderOnMachine(ctx, controller, testEmployee, order.id, washers[0], receiptOf(order), cycle);
    await expect(run(null)).rejects.toThrow('Pick a cycle');
    expect(controller.starts).toEqual([]);

    await expect(run('HEAVY')).resolves.toBe('acked');
    expect(controller.starts[0]).toEqual({ channel: 1, pulses: { count: 6, onMs: 500, offMs: 500 } });
    expect(machineById(washers[0])?.runEndsAt).toBe(ctx.now() + 55 * MIN);
    expect(log()[0]).toMatchObject({ kind: 'ORDER', cycle: 'HEAVY' });
  });

  it('dryers have no cycles: they start with their own pulses and run time', async () => {
    const { ctx, owner, controller, order, washers, dryers, machineById } = await setupCycles();
    await startOrderOnMachine(ctx, controller, testEmployee, order.id, washers[0], receiptOf(order), 'LIGHT');
    markRunDone(ctx, washers[0]);
    await expect(
      startOrderOnMachine(ctx, controller, testEmployee, order.id, dryers[0], receiptOf(order)),
    ).resolves.toBe('acked');
    expect(controller.starts[1].pulses.count).toBe(1);
    expect(machineById(dryers[0])?.runEndsAt).toBe(ctx.now() + 30 * MIN);
    await testStart(ctx, controller, owner, dryers[1], 'HEAVY');
    expect(controller.starts[2].pulses.count).toBe(1);
  });

  it('a retry after a start that sent nothing runs the cycle that was picked', async () => {
    const { ctx, controller, order, washers } = await setupCycles();
    controller.failNextStart('failed');
    await expect(
      startOrderOnMachine(ctx, controller, testEmployee, order.id, washers[0], receiptOf(order), 'DELICATES'),
    ).resolves.toBe('failed');
    await expect(startMachine(ctx, controller, testEmployee, washers[0])).resolves.toBe('acked');
    expect(controller.starts[0].pulses.count).toBe(2);
  });

  it('owner overrides and test starts run the Medium cycle unless a test picks another', async () => {
    const { ctx, owner, controller, washers, log } = await setupCycles();
    await testStart(ctx, controller, owner, washers[0]);
    expect(controller.starts[0].pulses.count).toBe(4);
    for (const cycle of ['DELICATES', 'LIGHT', 'HEAVY'] as const) await testStart(ctx, controller, owner, washers[0], cycle);
    expect(controller.starts.map((start) => start.pulses.count)).toEqual([4, 2, 3, 6]);
    expect(log().map((row) => row.cycle)).toEqual(['HEAVY', 'LIGHT', 'DELICATES', 'MEDIUM']);
  });

  it("checks each cycle's pulses and minutes, and copies cycle pulses to other machines", async () => {
    const { ctx, owner, washers, machineById } = await setupCycles();
    expect(() =>
      updateMachine(ctx, owner, washers[1], { ...machine('Washer 2', 'WASHER', 2), ...cycles, heavyPulses: 51 }),
    ).toThrow('Heavy');
    expect(() =>
      updateMachine(ctx, owner, washers[1], { ...machine('Washer 2', 'WASHER', 2), ...cycles, lightMinutes: 0 }),
    ).toThrow('Light: run time');
    applyPulsesToMachines(ctx, owner, { count: 1, onMs: 300, offMs: 300 }, [washers[1]], {
      delicatesPulses: 2,
      lightPulses: 3,
      mediumPulses: 4,
      heavyPulses: 6,
    });
    expect(machineById(washers[1])).toMatchObject({ pulseOnMs: 300, heavyPulses: 6, heavyMinutes: 30 });
  });
});
