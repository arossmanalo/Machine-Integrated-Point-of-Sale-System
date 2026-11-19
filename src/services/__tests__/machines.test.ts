import { createTestContext, testEmployee } from '@/db/testing';
import { MockMachineController } from '@/machines/MockMachineController';

import { completeFirstRunSetup } from '../auth';
import { createCustomer } from '../customers';
import {
  addMachine,
  assignOrder,
  listMachineLog,
  listMachines,
  machineUsage,
  overrideStart,
  saveLockController,
  startMachine,
  testStart,
  unassignMachine,
  updateMachine,
  type MachineInput,
} from '../machines';
import { createOrder, updateOrderStatus, voidOrder } from '../orders';
import { getSetting } from '../settings';

const PULSES = { pulseCount: 1, pulseOnMs: 500, pulseOffMs: 500 };

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
  const dryer1 = addMachine(ctx, owner, machine('Dryer 1', 'DRYER', 4));
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
  return {
    ctx,
    owner,
    controller,
    order,
    washers: [washer1, washer2, washer3],
    dryers: [dryer1, dryer2, dryer3],
    machineById,
    log,
  };
}

describe('assigning orders to machines', () => {
  it('an unpaid 2-load order can take exactly 2 washers and 2 dryers', async () => {
    const { ctx, order, washers, dryers, machineById } = await setup();
    assignOrder(ctx, testEmployee, order.id, washers[0]);
    assignOrder(ctx, testEmployee, order.id, washers[1]);
    expect(() => assignOrder(ctx, testEmployee, order.id, washers[2])).toThrow('used all its washers');
    assignOrder(ctx, testEmployee, order.id, dryers[0]);
    assignOrder(ctx, testEmployee, order.id, dryers[1]);
    expect(() => assignOrder(ctx, testEmployee, order.id, dryers[2])).toThrow('used all its dryers');
    expect(machineUsage(ctx, order.id)).toEqual({ WASHER: 2, DRYER: 2 });
    expect(machineById(washers[0])).toMatchObject({ assignedOrderId: order.id, assignedByName: 'ana' });
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
    const { ctx, owner, order, washers, dryers, machineById } = await setup();
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
