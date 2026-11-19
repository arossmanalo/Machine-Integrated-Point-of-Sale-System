import { decideAssignment, decideStart, machineAllowance, type AssignCheck } from '../machinePolicy';

const openOrder = { id: 'T0001', service: 'WASH_DRY_FOLD', loadCount: 2, status: 'PENDING', voided: false };
const washer = { name: 'Washer 1', type: 'WASHER' as const, enabled: true, assignedOrderId: null };

function check(overrides: Partial<AssignCheck>): AssignCheck {
  return { order: openOrder, machine: washer, usedOfType: 0, ...overrides };
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
    expect(decideStart(assigned, openOrder)).toEqual({ allowed: true });
    expect(decideStart(washer, null)).toMatchObject({ allowed: false, reason: 'not-assigned' });
    expect(decideStart(assigned, { ...openOrder, voided: true })).toMatchObject({ allowed: false, reason: 'voided' });
    expect(decideStart(assigned, { ...openOrder, status: 'COMPLETED' })).toMatchObject({ allowed: false, reason: 'closed' });
    expect(decideStart({ ...assigned, enabled: false }, openOrder)).toMatchObject({
      allowed: false,
      reason: 'machine-disabled',
    });
  });
});
