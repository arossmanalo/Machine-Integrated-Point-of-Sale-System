import { createTestContext, testEmployee, testOwner } from '@/db/testing';

import { createCustomer, getCustomer } from '../customers';
import { adjustStock, createInventoryItem, listInventory, updateInventoryItem } from '../inventory';
import {
  createOrder,
  createTestOrder,
  getOrderDetail,
  listOrderSummaries,
  quoteOrder,
  receivePayment,
  updateOrderStatus,
  voidOrder,
  type NewOrderInput,
} from '../orders';
import { setSetting } from '../settings';

function setup() {
  const ctx = createTestContext();
  const customer = createCustomer(ctx, { name: 'Maria Santos', phone: '0917', address: '', notes: '' });
  const fabcon = createInventoryItem(ctx, {
    name: 'Fabcon',
    currentStock: 10,
    lowStockThreshold: 2,
    unit: 'pcs',
    autoConsume: false,
    isAddOn: true,
    addOnPrice: 1500,
  });
  const detergent = createInventoryItem(ctx, {
    name: 'Detergent',
    currentStock: 20,
    lowStockThreshold: 5,
    unit: 'scoops',
    autoConsume: true,
    isAddOn: false,
    addOnPrice: 0,
  });
  const order = (overrides: Partial<NewOrderInput> = {}): NewOrderInput => ({
    customerId: customer.id,
    weightKg: 16,
    loads: 2,
    addOns: [],
    paymentMethod: 'FULL_PAYMENT',
    downPayment: 0,
    channel: 'CASH',
    gcashReference: '',
    cashReceived: null,
    placedAt: null,
    ...overrides,
  });
  return { ctx, customer, fabcon, detergent, order };
}

describe('createOrder', () => {
  it('charges the configured price, records payment, loyalty and stock in one go', () => {
    const { ctx, customer, fabcon, detergent, order } = setup();
    const created = createOrder(
      ctx,
      testEmployee,
      order({ addOns: [{ itemId: fabcon, quantity: 2 }], cashReceived: 50000 }),
    );
    expect(created.id).toBe('T0001');
    expect(created.total).toBe(2 * 22000 + 2 * 1500);
    expect(created.service).toBe('WASH_DRY_FOLD');

    const detail = getOrderDetail(ctx, created.id);
    expect(detail?.paid).toBe(created.total);
    expect(detail?.balance).toBe(0);
    expect(detail?.payments[0].cashReceived).toBe(50000);
    expect(detail?.items).toHaveLength(1);
    expect(getCustomer(ctx, customer.id)?.loyaltyLoads).toBe(2);

    const stock = Object.fromEntries(listInventory(ctx).map((i) => [i.id, i.currentStock]));
    expect(stock[fabcon]).toBe(8);
    expect(stock[detergent]).toBe(18);
  });

  it('allows up to 2 kg over per load, but no fewer or extra loads', () => {
    const { ctx, order } = setup();
    expect(createOrder(ctx, testEmployee, order({ weightKg: 10, loads: 1 })).loadCount).toBe(1);
    expect(createOrder(ctx, testEmployee, order({ weightKg: 10, loads: 2 })).loadCount).toBe(2);
    expect(createOrder(ctx, testEmployee, order({ weightKg: 18, loads: 2 })).loadCount).toBe(2);
    expect(() => createOrder(ctx, testEmployee, order({ weightKg: 10.5, loads: 1 }))).toThrow('2 loads');
  });

  it('uses a new price per load when the setting changes', () => {
    const { ctx, order } = setup();
    setSetting(ctx.db, 'pricePerLoad', 25000);
    expect(createOrder(ctx, testEmployee, order({ loads: 1, weightKg: 8 })).total).toBe(25000);
  });

  it('applies the 10+1 promo automatically and spends 10 loyalty loads', () => {
    const { ctx, customer, order } = setup();
    createOrder(ctx, testEmployee, order({ loads: 10, weightKg: 80 }));
    expect(quoteOrder(ctx, getCustomer(ctx, customer.id) ?? null, 2, []).promoApplied).toBe(true);
    const promo = createOrder(ctx, testEmployee, order({ loads: 2 }));
    expect(promo.promoApplied).toBe(true);
    expect(promo.total).toBe(22000);
    expect(getCustomer(ctx, customer.id)?.loyaltyLoads).toBe(1);
  });

  it('pay later leaves the full balance and no payment row', () => {
    const { ctx, order } = setup();
    const created = createOrder(ctx, testEmployee, order({ paymentMethod: 'PAY_LATER' }));
    const summary = listOrderSummaries(ctx)[0];
    expect(summary.order.id).toBe(created.id);
    expect(summary.paid).toBe(0);
    expect(summary.balance).toBe(44000);
    expect(summary.paidAt).toBeNull();
  });

  it('validates the order before saving anything', () => {
    const { ctx, order, fabcon } = setup();
    expect(() => createOrder(ctx, testEmployee, order({ weightKg: 0 }))).toThrow('weight');
    expect(() => createOrder(ctx, testEmployee, order({ loads: 0 }))).toThrow('Loads');
    expect(() => createOrder(ctx, testEmployee, order({ weightKg: 1, loads: 8 }))).toThrow('1 kg is 1 load.');
    expect(() => createOrder(ctx, testEmployee, order({ weightKg: 21, loads: 2 }))).toThrow('21 kg is 3 loads');
    expect(() => createOrder(ctx, testEmployee, order({ weightKg: 18, loads: 4 }))).toThrow('2 or 3 loads');
    expect(() => createOrder(ctx, testEmployee, order({ weightKg: 80, loads: 11 }))).toThrow('8 to 10 loads');
    expect(() => createOrder(ctx, testEmployee, order({ channel: 'GCASH' }))).toThrow('GCash');
    expect(() =>
      createOrder(ctx, testEmployee, order({ paymentMethod: 'DOWN_PAYMENT', downPayment: 0 })),
    ).toThrow('down payment');
    expect(() =>
      createOrder(ctx, testEmployee, order({ paymentMethod: 'DOWN_PAYMENT', downPayment: 99999 })),
    ).toThrow('more than the total');
    expect(() => createOrder(ctx, testEmployee, order({ cashReceived: 100 }))).toThrow('Cash');
    expect(() =>
      createOrder(ctx, testEmployee, order({ addOns: [{ itemId: fabcon, quantity: 11 }] })),
    ).toThrow('Only 10 pcs');
    expect(listOrderSummaries(ctx)).toHaveLength(0);
  });

  it('only the owner can backdate, never into the future', () => {
    const { ctx, order } = setup();
    const yesterday = ctx.now() - 24 * 60 * 60 * 1000;
    expect(() => createOrder(ctx, testEmployee, order({ placedAt: yesterday }))).toThrow('owner');
    expect(() => createOrder(ctx, testOwner, order({ placedAt: ctx.now() + 3600000 }))).toThrow(
      'future',
    );
    const backdated = createOrder(ctx, testOwner, order({ placedAt: yesterday }));
    expect(backdated.placedAt).toBe(yesterday);
    expect(getOrderDetail(ctx, backdated.id)?.payments[0].receivedAt).toBe(yesterday);
  });
});

describe('payments after the order', () => {
  it('takes a down payment then the rest, capped at the balance', () => {
    const { ctx, order } = setup();
    const created = createOrder(
      ctx,
      testEmployee,
      order({ paymentMethod: 'DOWN_PAYMENT', downPayment: 10000 }),
    );
    ctx.advance(2 * 24 * 60 * 60 * 1000);
    const applied = receivePayment(ctx, testEmployee, created.id, {
      amount: 50000,
      channel: 'GCASH',
      gcashReference: '1234567890',
      cashReceived: null,
    });
    expect(applied).toBe(34000);
    const detail = getOrderDetail(ctx, created.id);
    expect(detail?.balance).toBe(0);
    expect(detail?.paidAt).toBe(ctx.now());
    expect(detail?.payments.map((p) => p.channel)).toEqual(['CASH', 'GCASH']);
    expect(() =>
      receivePayment(ctx, testEmployee, created.id, {
        amount: 100,
        channel: 'CASH',
        gcashReference: '',
        cashReceived: null,
      }),
    ).toThrow('already fully paid');
  });
});

describe('status and void', () => {
  it('only managers set AUDITED', () => {
    const { ctx, order } = setup();
    const created = createOrder(ctx, testEmployee, order());
    expect(() => updateOrderStatus(ctx, testEmployee, created.id, 'AUDITED')).toThrow();
    updateOrderStatus(ctx, testOwner, created.id, 'audited');
    expect(getOrderDetail(ctx, created.id)?.order.status).toBe('AUDITED');
    expect(() => updateOrderStatus(ctx, testEmployee, created.id, 'PENDING')).toThrow('was audited');
    updateOrderStatus(ctx, testOwner, created.id, 'PENDING');
    expect(getOrderDetail(ctx, created.id)?.order.status).toBe('PENDING');
  });

  it('voiding undoes loyalty and returns add-on stock, and needs a reason', () => {
    const { ctx, customer, fabcon, order } = setup();
    const created = createOrder(ctx, testEmployee, order({ addOns: [{ itemId: fabcon, quantity: 3 }] }));
    expect(() => voidOrder(ctx, testEmployee, created.id, 'mistake')).toThrow('admin');
    expect(() => voidOrder(ctx, testOwner, created.id, '  ')).toThrow('why');
    voidOrder(ctx, testOwner, created.id, 'Entered twice');
    expect(getCustomer(ctx, customer.id)?.loyaltyLoads).toBe(0);
    expect(listInventory(ctx).find((i) => i.id === fabcon)?.currentStock).toBe(10);
    expect(getOrderDetail(ctx, created.id)?.order.voidReason).toBe('Entered twice');
    expect(() => updateOrderStatus(ctx, testOwner, created.id, 'READY')).toThrow('voided');
  });
});

describe('test orders', () => {
  it('lets only the owner make one, with no money and no supplies taken', () => {
    const { ctx, detergent } = setup();
    expect(() => createTestOrder(ctx, testEmployee)).toThrow('owner');
    const first = createTestOrder(ctx, testOwner);
    const detail = getOrderDetail(ctx, first.id);
    expect(detail).toMatchObject({ customerName: 'Test customer', paid: 0 });
    expect(detail?.order.loadCount).toBe(1);
    expect(listInventory(ctx).find((i) => i.id === detergent)?.currentStock).toBe(20);

    const second = createTestOrder(ctx, testOwner);
    expect(second.customerId).toBe(first.customerId);
    voidOrder(ctx, testOwner, first.id, 'Test order');
    expect(getOrderDetail(ctx, first.id)?.order.voidedAt).not.toBeNull();
  });

  it('real orders still take supplies', () => {
    const { ctx, detergent, order } = setup();
    createOrder(ctx, testEmployee, order());
    expect(listInventory(ctx).find((i) => i.id === detergent)?.currentStock).toBe(18);
  });
});

describe('add-ons', () => {
  it('only items marked as add-ons can be sold, and they need a price', () => {
    const { ctx, order, detergent } = setup();
    const supplyWithPrice = createInventoryItem(ctx, {
      name: 'Bleach',
      currentStock: 5,
      lowStockThreshold: 1,
      unit: 'pcs',
      autoConsume: false,
      isAddOn: false,
      addOnPrice: 2000,
    });
    for (const itemId of [detergent, supplyWithPrice]) {
      expect(() => createOrder(ctx, testEmployee, order({ addOns: [{ itemId, quantity: 1 }] }))).toThrow(
        'no longer for sale',
      );
    }
    expect(() =>
      createInventoryItem(ctx, {
        name: 'Plastic bag',
        currentStock: 50,
        lowStockThreshold: 10,
        unit: 'pcs',
        autoConsume: false,
        isAddOn: true,
        addOnPrice: 0,
      }),
    ).toThrow('above ₱0');
  });

  it('turning the switch off keeps the price for next time', () => {
    const { ctx, fabcon, order } = setup();
    updateInventoryItem(ctx, fabcon, {
      name: 'Fabcon',
      currentStock: 10,
      lowStockThreshold: 2,
      unit: 'pcs',
      autoConsume: false,
      isAddOn: false,
      addOnPrice: 1500,
    });
    expect(listInventory(ctx).find((i) => i.id === fabcon)).toMatchObject({ isAddOn: false, addOnPrice: 1500 });
    expect(() => createOrder(ctx, testEmployee, order({ addOns: [{ itemId: fabcon, quantity: 1 }] }))).toThrow(
      'no longer for sale',
    );
  });
});

describe('inventory adjustments', () => {
  it('never lets stock go below zero', () => {
    const { ctx, fabcon } = setup();
    adjustStock(ctx, fabcon, 5);
    expect(() => adjustStock(ctx, fabcon, -16)).toThrow('Only 15');
    adjustStock(ctx, fabcon, -15);
    expect(listInventory(ctx).find((i) => i.id === fabcon)?.currentStock).toBe(0);
  });
});
