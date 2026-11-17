import { decideOrderUnlock, unlockAllowance, type UnlockCheck } from '../unlockPolicy';

const openOrder = { service: 'WASH_DRY_FOLD', loadCount: 2, status: 'PENDING', voided: false };
const washer = { type: 'WASHER' as const, enabled: true };

function check(overrides: Partial<UnlockCheck>): UnlockCheck {
  return { order: openOrder, machine: washer, usedOfType: 0, controllerReady: true, ...overrides };
}

describe('unlock allowance', () => {
  it('gives one washer and one dryer unlock per load of wash-dry-fold', () => {
    expect(unlockAllowance(openOrder)).toBe(2);
  });

  it('gives imported old-service orders nothing', () => {
    expect(unlockAllowance({ service: 'WASH', loadCount: 3 })).toBe(0);
    expect(unlockAllowance({ service: 'WASH_DRY', loadCount: 3 })).toBe(0);
  });
});

describe('decideOrderUnlock', () => {
  it('allows while allowance remains', () => {
    expect(decideOrderUnlock(check({ usedOfType: 1 }))).toEqual({ allowed: true });
  });

  it.each([
    [{ order: null }, 'no-order'],
    [{ order: { ...openOrder, voided: true } }, 'voided'],
    [{ order: { ...openOrder, status: 'COMPLETED' } }, 'closed'],
    [{ order: { ...openOrder, status: 'audited' } }, 'closed'],
    [{ machine: { ...washer, enabled: false } }, 'machine-disabled'],
    [{ usedOfType: 2 }, 'allowance-used'],
    [{ order: { ...openOrder, service: 'WASH' } }, 'allowance-used'],
    [{ controllerReady: false }, 'not-connected'],
  ] as const)('denies %o with %s', (overrides, reason) => {
    const decision = decideOrderUnlock(check(overrides));
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toBe(reason);
      expect(decision.message.length).toBeGreaterThan(0);
    }
  });

  it('a third washer unlock on a 2-load order is refused, the first dryer one is not', () => {
    expect(decideOrderUnlock(check({ usedOfType: 2 })).allowed).toBe(false);
    expect(
      decideOrderUnlock(check({ machine: { type: 'DRYER', enabled: true }, usedOfType: 0 })).allowed,
    ).toBe(true);
  });
});
