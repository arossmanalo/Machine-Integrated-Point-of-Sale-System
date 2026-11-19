import { createTestContext, testEmployee } from '@/db/testing';
import { MockMachineController } from '@/machines/MockMachineController';

import { completeFirstRunSetup } from '../auth';
import { createCustomer } from '../customers';
import {
  addMachine,
  listUnlocks,
  overrideUnlock,
  saveLockController,
  testPulse,
  unlockForOrder,
  unlockUsage,
  updateMachine,
} from '../machines';
import { createOrder, updateOrderStatus, voidOrder } from '../orders';
import { getSetting } from '../settings';

async function setup() {
  const ctx = createTestContext();
  const owner = await completeFirstRunSetup(ctx, {
    username: 'owner',
    password: 'owner123',
    pin: '2468',
  });
  const washer1 = addMachine(ctx, owner, { name: 'Washer 1', type: 'WASHER', hardwareChannel: 1, enabled: true });
  const washer2 = addMachine(ctx, owner, { name: 'Washer 2', type: 'WASHER', hardwareChannel: 2, enabled: true });
  const washer3 = addMachine(ctx, owner, { name: 'Washer 3', type: 'WASHER', hardwareChannel: 3, enabled: true });
  const dryer1 = addMachine(ctx, owner, { name: 'Dryer 1', type: 'DRYER', hardwareChannel: 4, enabled: true });
  const dryer2 = addMachine(ctx, owner, { name: 'Dryer 2', type: 'DRYER', hardwareChannel: 5, enabled: true });
  const dryer3 = addMachine(ctx, owner, { name: 'Dryer 3', type: 'DRYER', hardwareChannel: 6, enabled: true });
  const customer = createCustomer(ctx, { name: 'Juan', phone: '', address: '', notes: '' });
  const controller = new MockMachineController(0);
  await controller.connect();
  const payLaterOrder = createOrder(ctx, testEmployee, {
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
  return {
    ctx,
    owner,
    controller,
    order: payLaterOrder,
    washers: [washer1, washer2, washer3],
    dryers: [dryer1, dryer2, dryer3],
  };
}

describe('order unlocks (LED prototype acceptance, run against the mock)', () => {
  it('an unpaid 2-load order unlocks exactly 2 washers and 2 dryers', async () => {
    const { ctx, controller, order, washers, dryers } = await setup();
    await expect(unlockForOrder(ctx, controller, testEmployee, order.id, washers[0])).resolves.toBe('acked');
    await expect(unlockForOrder(ctx, controller, testEmployee, order.id, washers[1])).resolves.toBe('acked');
    await expect(unlockForOrder(ctx, controller, testEmployee, order.id, washers[2])).rejects.toThrow(
      'No washer unlocks left',
    );
    await unlockForOrder(ctx, controller, testEmployee, order.id, dryers[0]);
    await unlockForOrder(ctx, controller, testEmployee, order.id, dryers[1]);
    await expect(unlockForOrder(ctx, controller, testEmployee, order.id, dryers[2])).rejects.toThrow(
      'No dryer unlocks left',
    );
    expect(controller.pulses).toEqual([1, 2, 4, 5]);
    expect(unlockUsage(ctx, order.id)).toEqual({ WASHER: 2, DRYER: 2 });

    const log = listUnlocks(ctx, { start: 0, end: ctx.now() + 1 });
    expect(log).toHaveLength(4);
    expect(log.every((row) => row.result === 'ACKED' && row.employeeName === 'ana')).toBe(true);
    expect(log[0]).toMatchObject({ orderId: order.id, kind: 'ORDER', machineName: 'Dryer 2' });
  });

  it('a failed pulse is logged and does not use up allowance', async () => {
    const { ctx, controller, order, washers } = await setup();
    controller.failNextUnlock('timeout');
    await expect(unlockForOrder(ctx, controller, testEmployee, order.id, washers[0])).resolves.toBe('timeout');
    expect(unlockUsage(ctx, order.id).WASHER).toBe(0);
    expect(listUnlocks(ctx, { start: 0, end: ctx.now() + 1 })[0].result).toBe('TIMEOUT');
  });

  it('when the controller is offline the attempt is logged as NOT_CONNECTED', async () => {
    const { ctx, controller, order, washers } = await setup();
    await controller.disconnect();
    await expect(unlockForOrder(ctx, controller, testEmployee, order.id, washers[0])).resolves.toBe(
      'not-connected',
    );
    expect(listUnlocks(ctx, { start: 0, end: ctx.now() + 1 })[0].result).toBe('NOT_CONNECTED');
    expect(controller.pulses).toEqual([]);
  });

  it('refuses voided, completed and unknown orders, and disabled machines', async () => {
    const { ctx, owner, controller, order, washers } = await setup();
    await expect(unlockForOrder(ctx, controller, testEmployee, 'T9999', washers[0])).rejects.toThrow(
      'No order',
    );
    updateMachine(ctx, owner, washers[0], { name: 'Washer 1', type: 'WASHER', hardwareChannel: 1, enabled: false });
    await expect(unlockForOrder(ctx, controller, testEmployee, order.id, washers[0])).rejects.toThrow(
      'switched off',
    );
    updateOrderStatus(ctx, owner, order.id, 'COMPLETED');
    await expect(unlockForOrder(ctx, controller, testEmployee, order.id, washers[1])).rejects.toThrow(
      'completed',
    );
    updateOrderStatus(ctx, owner, order.id, 'READY');
    voidOrder(ctx, owner, order.id, 'Test');
    await expect(unlockForOrder(ctx, controller, testEmployee, order.id, washers[1])).rejects.toThrow(
      'voided',
    );
    expect(controller.pulses).toEqual([]);
  });
});

describe('owner override', () => {
  it('pulses with the right PIN and logs reason; wrong PINs are logged and lock out', async () => {
    const { ctx, controller, washers } = await setup();
    const input = { machineId: washers[2], reason: 'Stuck door' as const, note: '', orderId: null };
    await expect(overrideUnlock(ctx, controller, testEmployee, { ...input, pin: '2468' })).resolves.toBe(
      'acked',
    );
    for (let i = 0; i < 4; i += 1) {
      await expect(overrideUnlock(ctx, controller, testEmployee, { ...input, pin: '0000' })).rejects.toThrow(
        'Wrong owner PIN',
      );
    }
    await expect(overrideUnlock(ctx, controller, testEmployee, { ...input, pin: '0000' })).rejects.toThrow(
      'locked',
    );
    await expect(overrideUnlock(ctx, controller, testEmployee, { ...input, pin: '2468' })).rejects.toThrow(
      'locked',
    );

    const log = listUnlocks(ctx, { start: 0, end: ctx.now() + 1 });
    expect(log.filter((row) => row.kind === 'OVERRIDE_DENIED')).toHaveLength(6);
    const granted = log.find((row) => row.kind === 'OVERRIDE');
    expect(granted).toMatchObject({ overrideReason: 'Stuck door', result: 'ACKED', orderId: null });
    expect(controller.pulses).toEqual([3]);
  });

  it('requires a note for "Other"', async () => {
    const { ctx, controller, washers } = await setup();
    await expect(
      overrideUnlock(ctx, controller, testEmployee, {
        machineId: washers[0],
        reason: 'Other',
        note: ' ',
        orderId: null,
        pin: '2468',
      }),
    ).rejects.toThrow('Describe');
  });
});

describe('machine settings', () => {
  it('keeps channels unique and lets only the owner change machines or test', async () => {
    const { ctx, owner, controller, washers } = await setup();
    expect(() =>
      addMachine(ctx, owner, { name: 'Dup', type: 'WASHER', hardwareChannel: 1, enabled: true }),
    ).toThrow('already used by Washer 1');
    expect(() =>
      addMachine(ctx, testEmployee, { name: 'X', type: 'WASHER', hardwareChannel: 9, enabled: true }),
    ).toThrow('owner');
    await expect(testPulse(ctx, controller, testEmployee, washers[0])).rejects.toThrow('owner');
    await expect(testPulse(ctx, controller, owner, washers[0])).resolves.toBe('acked');
    expect(listUnlocks(ctx, { start: 0, end: ctx.now() + 1 })[0].kind).toBe('TEST');
  });

  it('saves the lock controller address and key for the owner only, after checking them', async () => {
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
