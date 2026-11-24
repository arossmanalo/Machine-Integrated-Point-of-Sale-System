import { autoConsumeAmount, isLowStock } from '../inventory';
import { formatId, parseIdNumber } from '../ids';
import { isPromoEligible, loyaltyAfterOrder, loyaltyAfterVoid } from '../loyalty';
import { centavosToInput, formatPeso, parsePesoInput, pesosToCentavos } from '../money';
import { amountToApply, balanceDue, changeDue, fullyPaidAt } from '../payments';
import { assignableRoles, can, canDeleteAccount, canEditAccount, canSeeAccount } from '../permissions';
import { computeOrderTotal, loadRangeForWeight } from '../pricing';
import { isClosedStatus, normalizeStatus, selectableStatuses, statusLabel } from '../statuses';

describe('money', () => {
  it('converts pesos without float drift', () => {
    expect(pesosToCentavos(0.1 + 0.2)).toBe(30);
    expect(pesosToCentavos(220)).toBe(22000);
  });

  it.each([
    ['150', 15000],
    ['150.5', 15050],
    ['1,250.75', 125075],
    [' 0 ', 0],
  ])('parses %s', (text, expected) => {
    expect(parsePesoInput(text)).toBe(expected);
  });

  it.each(['', 'abc', '-5', '1.234', '1.2.3'])('rejects %p', (text) => {
    expect(parsePesoInput(text)).toBeNull();
  });

  it('formats for screen and input', () => {
    expect(formatPeso(123450)).toBe('₱1,234.50');
    expect(formatPeso(-500)).toBe('-₱5.00');
    expect(centavosToInput(22000)).toBe('220');
    expect(centavosToInput(125075)).toBe('1250.75');
  });
});

describe('ids', () => {
  it('formats and parses sequential ids', () => {
    expect(formatId('order', 1)).toBe('T0001');
    expect(formatId('customer', 10000)).toBe('C10000');
    expect(parseIdNumber('T0042')).toBe(42);
    expect(parseIdNumber('X-1')).toBeNull();
  });
});

describe('loads from weight (old app: min ceil(kg/10), recommended ceil(kg/8))', () => {
  it.each([
    [0, { min: 1, max: 1, recommended: 1 }],
    [-3, { min: 1, max: 1, recommended: 1 }],
    [7, { min: 1, max: 1, recommended: 1 }],
    [8, { min: 1, max: 1, recommended: 1 }],
    [9, { min: 1, max: 2, recommended: 2 }],
    [10, { min: 1, max: 2, recommended: 2 }],
    [10.5, { min: 2, max: 2, recommended: 2 }],
    [18, { min: 2, max: 3, recommended: 3 }],
    [20, { min: 2, max: 3, recommended: 3 }],
    [40, { min: 4, max: 5, recommended: 5 }],
  ])('%d kg', (kg, expected) => {
    expect(loadRangeForWeight(kg)).toEqual(expected);
  });
});

describe('order total', () => {
  it('charges per load plus add-ons', () => {
    const total = computeOrderTotal({
      loads: 3,
      pricePerLoad: 22000,
      promoApplied: false,
      addOns: [{ unitPrice: 1500, quantity: 2 }],
    });
    expect(total).toEqual({ billableLoads: 3, loadsSubtotal: 66000, addOnsTotal: 3000, total: 69000 });
  });

  it('makes one load free with the promo', () => {
    const total = computeOrderTotal({ loads: 2, pricePerLoad: 22000, promoApplied: true, addOns: [] });
    expect(total.billableLoads).toBe(1);
    expect(total.total).toBe(22000);
  });

  it('a single promo load costs nothing', () => {
    expect(computeOrderTotal({ loads: 1, pricePerLoad: 22000, promoApplied: true, addOns: [] }).total)
      .toBe(0);
  });
});

describe('10+1 loyalty', () => {
  it('qualifies at 10 loads', () => {
    expect(isPromoEligible(9)).toBe(false);
    expect(isPromoEligible(10)).toBe(true);
  });

  it('earns billable loads and spends 10 on a promo order', () => {
    expect(loyaltyAfterOrder(4, 3, false)).toBe(7);
    expect(loyaltyAfterOrder(12, 2, true)).toBe(4);
    expect(loyaltyAfterOrder(10, 0, true)).toBe(0);
  });

  it('a void undoes the order', () => {
    const afterOrder = loyaltyAfterOrder(12, 2, true);
    expect(loyaltyAfterVoid(afterOrder, 2, true)).toBe(12);
    expect(loyaltyAfterVoid(1, 3, false)).toBe(0);
  });
});

describe('payments', () => {
  it('caps a payment at the balance', () => {
    expect(amountToApply(50000, 30000)).toBe(30000);
    expect(amountToApply(-5, 30000)).toBe(0);
    expect(balanceDue(30000, 45000)).toBe(0);
    expect(changeDue(50000, 44000)).toBe(6000);
    expect(changeDue(1000, 44000)).toBe(0);
  });

  it('finds when an order became fully paid', () => {
    const payments = [
      { amount: 20000, receivedAt: 300 },
      { amount: 10000, receivedAt: 100 },
    ];
    expect(fullyPaidAt(30000, payments)).toBe(300);
    expect(fullyPaidAt(40000, payments)).toBeNull();
    expect(fullyPaidAt(0, [])).toBeNull();
  });
});

describe('inventory', () => {
  it('treats stock at the threshold as low', () => {
    expect(isLowStock({ currentStock: 5, lowStockThreshold: 5 })).toBe(true);
    expect(isLowStock({ currentStock: 6, lowStockThreshold: 5 })).toBe(false);
  });

  it('auto-consumes one per load only when stock covers the order', () => {
    expect(autoConsumeAmount(10, 3)).toBe(3);
    expect(autoConsumeAmount(2, 3)).toBe(0);
  });
});

describe('roles', () => {
  const developer = { id: 'U0004', role: 'DEVELOPER' as const };
  const owner = { id: 'U0001', role: 'OWNER' as const };
  const admin = { id: 'U0002', role: 'ADMIN' as const };
  const employee = { id: 'U0003', role: 'EMPLOYEE' as const };

  it('limits money and machine controls', () => {
    expect(can.seeRevenue('EMPLOYEE')).toBe(false);
    expect(can.voidOrder('ADMIN')).toBe(true);
    expect(can.manageMachines('ADMIN')).toBe(false);
    expect(can.backdateOrder('OWNER')).toBe(true);
  });

  it('gives the developer every owner right, and only the developer the machine setup', () => {
    for (const right of Object.values(can)) {
      if (right(owner.role)) expect(right(developer.role)).toBe(true);
    }
    expect(can.manageMachines('DEVELOPER')).toBe(true);
    expect(can.manageMachines('OWNER')).toBe(false);
    expect(can.viewMachineSettings('OWNER')).toBe(true);
    expect(can.viewMachineSettings('ADMIN')).toBe(false);
  });

  it('owner assigns admin or employee, admin only employee', () => {
    expect(assignableRoles(owner, null, true)).toEqual(['ADMIN', 'EMPLOYEE']);
    expect(assignableRoles(admin, null, true)).toEqual(['EMPLOYEE']);
    expect(assignableRoles(admin, owner, true)).toEqual([]);
    expect(assignableRoles(admin, admin, true)).toEqual([]);
    expect(assignableRoles(employee, null, true)).toEqual([]);
  });

  it('the owner may add the developer only while there is none, and never edits it', () => {
    expect(assignableRoles(owner, null, false)).toEqual(['DEVELOPER', 'ADMIN', 'EMPLOYEE']);
    expect(assignableRoles(owner, admin, false)).toEqual(['ADMIN', 'EMPLOYEE']);
    expect(assignableRoles(owner, developer, true)).toEqual([]);
    expect(canEditAccount(owner, developer)).toBe(false);
    expect(canDeleteAccount(owner, developer)).toBe(false);
    expect(canSeeAccount('OWNER', 'DEVELOPER')).toBe(false);
    expect(canSeeAccount('DEVELOPER', 'DEVELOPER')).toBe(true);
  });

  it('the developer manages every account but never removes the owner', () => {
    expect(assignableRoles(developer, null, true)).toEqual(['DEVELOPER', 'ADMIN', 'EMPLOYEE']);
    expect(assignableRoles(developer, owner, true)).toEqual([]);
    expect(canEditAccount(developer, owner)).toBe(true);
    expect(canDeleteAccount(developer, owner)).toBe(false);
    expect(canDeleteAccount(developer, admin)).toBe(true);
  });

  it('nobody deletes themselves or the owner', () => {
    expect(canEditAccount(admin, employee)).toBe(true);
    expect(canEditAccount(admin, owner)).toBe(false);
    expect(canDeleteAccount(owner, owner)).toBe(false);
    expect(canDeleteAccount(owner, admin)).toBe(true);
  });
});

describe('statuses', () => {
  it('merges custom statuses and hides hidden ones', () => {
    expect(selectableStatuses(['FOR_DELIVERY', 'READY'], ['WASHING'], false)).toEqual([
      'PENDING',
      'READY',
      'COMPLETED',
      'FOR_DELIVERY',
    ]);
  });

  it('formats and classifies', () => {
    expect(normalizeStatus(' for  delivery ')).toBe('FOR_DELIVERY');
    expect(statusLabel('FOR_DELIVERY')).toBe('For delivery');
    expect(isClosedStatus('audited')).toBe(true);
    expect(isClosedStatus('READY')).toBe(false);
  });
});
