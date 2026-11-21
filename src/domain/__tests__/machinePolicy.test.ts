import {
  decideAssignment,
  decideStart,
  decideTopUp,
  endAfterTopUp,
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

  it('a top-up extends a running dryer and restarts a finished one for 5 minutes', () => {
    expect(endAfterTopUp({ runEndsAt: NOW + 10 * MIN }, NOW)).toBe(NOW + 15 * MIN);
    expect(endAfterTopUp({ runEndsAt: NOW - 30 * MIN }, NOW)).toBe(NOW + 5 * MIN);
    expect(endAfterTopUp({ runEndsAt: null }, NOW)).toBe(NOW + 5 * MIN);
  });
});

describe('decideTopUp', () => {
  const dryer = { ...washer, name: 'Dryer 1', type: 'DRYER' as const, runOrderId: 'T0001', runEndsAt: NOW - MIN };

  it("tops up the order of the dryer's latest run, during or after it, while the order is open", () => {
    expect(decideTopUp(dryer, openOrder, 2000)).toEqual({ allowed: true });
    expect(decideTopUp({ ...dryer, runEndsAt: NOW + MIN }, openOrder, 2000)).toEqual({ allowed: true });
  });

  it.each([
    [{ ...washer, runOrderId: 'T0001' }, openOrder, 2000, 'not-a-dryer'],
    [dryer, openOrder, 0, 'no-top-up-price'],
    [{ ...dryer, runOrderId: null }, openOrder, 2000, 'no-run'],
    [{ ...dryer, enabled: false }, openOrder, 2000, 'machine-disabled'],
    [dryer, { ...openOrder, voided: true }, 2000, 'voided'],
    [dryer, { ...openOrder, status: 'COMPLETED' }, 2000, 'closed'],
  ] as const)('refuses %#: %s', (machine, order, price, reason) => {
    expect(decideTopUp(machine, order, price)).toMatchObject({ allowed: false, reason });
  });
});
