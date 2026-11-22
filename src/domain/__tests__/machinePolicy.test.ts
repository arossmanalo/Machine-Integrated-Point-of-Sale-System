import {
  decideAssignment,
  decideStart,
  decideTopUp,
  endAfterTopUp,
  isTopUpMinutes,
  NO_TOP_UP_PRICES,
  topUpOptions,
  topUpPulseCountFor,
  isRunning,
  machineAllowance,
  minutesLeft,
  type AssignCheck,
} from '../machinePolicy';

const NOW = 1_000_000_000;
const MIN = 60 * 1000;

const openOrder = { id: 'T0001', service: 'WASH_DRY_FOLD', loadCount: 2, status: 'PENDING', voided: false };
const washer = {
  name: 'Washer 1',
  type: 'WASHER' as const,
  enabled: true,
  assignedOrderId: null,
  runOrderId: null,
  runEndsAt: null,
};

function check(overrides: Partial<AssignCheck>): AssignCheck {
  return { order: openOrder, machine: washer, usedOfType: 0, now: NOW, ...overrides };
}

describe('machine allowance', () => {
  it('gives one washer and one dryer per load of wash-dry-fold', () => {
    expect(machineAllowance(openOrder)).toBe(2);
  });

  it('gives imported old-service orders nothing', () => {
    expect(machineAllowance({ service: 'WASH', loadCount: 3 })).toBe(0);
    expect(machineAllowance({ service: 'WASH_DRY', loadCount: 3 })).toBe(0);
  });
});

describe('decideAssignment', () => {
  it('allows while allowance remains', () => {
    expect(decideAssignment(check({ usedOfType: 1 }))).toEqual({ allowed: true });
  });

  it.each([
    [{ order: null }, 'no-order'],
    [{ order: { ...openOrder, voided: true } }, 'voided'],
    [{ order: { ...openOrder, status: 'COMPLETED' } }, 'closed'],
    [{ order: { ...openOrder, status: 'audited' } }, 'closed'],
    [{ machine: { ...washer, enabled: false } }, 'machine-disabled'],
    [{ machine: { ...washer, assignedOrderId: 'T0009' } }, 'machine-taken'],
    [{ machine: { ...washer, runOrderId: 'T0009', runEndsAt: NOW + MIN } }, 'machine-running'],
    [{ usedOfType: 2 }, 'allowance-used'],
    [{ order: { ...openOrder, service: 'WASH' } }, 'allowance-used'],
  ] as const)('denies %o with %s', (overrides, reason) => {
    const decision = decideAssignment(check(overrides));
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toBe(reason);
      expect(decision.message.length).toBeGreaterThan(0);
    }
  });

  it('a third washer on a 2-load order is refused, the first dryer is not', () => {
    expect(decideAssignment(check({ usedOfType: 2 })).allowed).toBe(false);
    expect(decideAssignment(check({ machine: { ...washer, type: 'DRYER' }, usedOfType: 0 })).allowed).toBe(true);
  });
});

describe('decideStart', () => {
  const assigned = { ...washer, assignedOrderId: 'T0001' };

  it('starts only a machine with an open order on it', () => {
    expect(decideStart(assigned, openOrder, NOW)).toEqual({ allowed: true });
    expect(decideStart(washer, null, NOW)).toMatchObject({ allowed: false, reason: 'not-assigned' });
    expect(decideStart(assigned, { ...openOrder, voided: true }, NOW)).toMatchObject({ allowed: false, reason: 'voided' });
    expect(decideStart(assigned, { ...openOrder, status: 'COMPLETED' }, NOW)).toMatchObject({ allowed: false, reason: 'closed' });
    expect(decideStart({ ...assigned, enabled: false }, openOrder, NOW)).toMatchObject({
      allowed: false,
      reason: 'machine-disabled',
    });
  });
});

describe('machine runs', () => {
  it('is in use until the run ends, and a finished run frees the machine', () => {
    const running = { ...washer, assignedOrderId: 'T0001', runOrderId: 'T0002', runEndsAt: NOW + 90 * 1000 };
    expect(isRunning(running, NOW)).toBe(true);
    expect(minutesLeft(running, NOW)).toBe(2);
    expect(decideStart(running, openOrder, NOW)).toMatchObject({ allowed: false, reason: 'machine-running' });
    expect(isRunning(running, NOW + 90 * 1000)).toBe(false);
    expect(decideStart(running, openOrder, NOW + 90 * 1000)).toEqual({ allowed: true });
  });

  it('a top-up adds its minutes to the end of the run', () => {
    expect(endAfterTopUp({ runEndsAt: NOW + 10 * MIN }, NOW, 5)).toBe(NOW + 15 * MIN);
    expect(endAfterTopUp({ runEndsAt: NOW + 10 * MIN }, NOW, 20)).toBe(NOW + 30 * MIN);
  });

  it('offers only the top-up lengths with a price, and scales the pulses with the minutes', () => {
    const prices = { topUpPrice: 2000, topUpPrice10: 0, topUpPrice15: 5000, topUpPrice20: 6000 };
    expect(topUpOptions(prices)).toEqual([
      { minutes: 5, price: 2000 },
      { minutes: 15, price: 5000 },
      { minutes: 20, price: 6000 },
    ]);
    expect(topUpOptions(NO_TOP_UP_PRICES)).toEqual([]);
    expect([5, 10, 15, 20].map((m) => (isTopUpMinutes(m) ? topUpPulseCountFor(2, m) : null))).toEqual([2, 4, 6, 8]);
    expect(isTopUpMinutes(7)).toBe(false);
  });
});

describe('decideTopUp', () => {
  const dryer = { ...washer, name: 'Dryer 1', type: 'DRYER' as const, runOrderId: 'T0001', runEndsAt: NOW + MIN };

  it('tops up a dryer only while it is still drying an open order', () => {
    expect(decideTopUp(dryer, openOrder, 2000, NOW)).toEqual({ allowed: true });
  });

  it.each([
    [{ ...washer, runOrderId: 'T0001' }, openOrder, 2000, 'not-a-dryer'],
    [dryer, openOrder, 0, 'no-top-up-price'],
    [{ ...dryer, runOrderId: null }, openOrder, 2000, 'no-run'],
    [{ ...dryer, runEndsAt: NOW }, openOrder, 2000, 'not-running'],
    [{ ...dryer, runEndsAt: null }, openOrder, 2000, 'not-running'],
    [{ ...dryer, enabled: false }, openOrder, 2000, 'machine-disabled'],
    [dryer, { ...openOrder, voided: true }, 2000, 'voided'],
    [dryer, { ...openOrder, status: 'COMPLETED' }, 2000, 'closed'],
  ] as const)('refuses %#: %s', (machine, order, price, reason) => {
    expect(decideTopUp(machine, order, price, NOW)).toMatchObject({ allowed: false, reason });
  });
});
