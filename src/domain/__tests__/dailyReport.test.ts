import { buildDailyReport, type DayMachineEvent, type DayOrder } from '../dailyReport';

const DAY = { start: 1_000_000_000, end: 1_000_000_000 + 24 * 60 * 60 * 1000 };
const T = (minutes: number) => DAY.start + minutes * 60 * 1000;

function order(id: string, overrides: Partial<DayOrder> = {}): DayOrder {
  return {
    id,
    customerName: `Customer ${id}`,
    placedAt: T(60),
    loadCount: 2,
    status: 'PENDING',
    total: 44000,
    paid: 44000,
    balance: 0,
    voided: false,
    ...overrides,
  };
}

let nextId = 1;
function event(overrides: Partial<DayMachineEvent>): DayMachineEvent {
  return {
    id: nextId++,
    at: T(90),
    machineId: 1,
    machineName: 'Washer 1',
    machineType: 'WASHER',
    orderId: 'T0001',
    employeeName: 'ana',
    kind: 'ORDER',
    result: 'ACKED',
    charge: null,
    overrideReason: null,
    ...overrides,
  };
}

const machines = [
  { id: 1, name: 'Washer 1', type: 'WASHER' as const },
  { id: 2, name: 'Washer 2', type: 'WASHER' as const },
  { id: 3, name: 'Dryer 1', type: 'DRYER' as const },
];

describe('daily report', () => {
  it('numbers each load by washer and dryer start and attaches top-ups to their dryer run', () => {
    const report = buildDailyReport({
      range: DAY,
      orders: [order('T0001')],
      payments: [
        { orderId: 'T0001', amount: 40000, channel: 'CASH', receivedAt: T(60) },
        { orderId: 'T0001', amount: 4000, channel: 'GCASH', receivedAt: T(200) },
      ],
      expenses: [],
      machines,
      events: [
        event({ at: T(70), machineId: 1, machineName: 'Washer 1' }),
        event({ at: T(75), machineId: 2, machineName: 'Washer 2', result: 'FAILED' }),
        event({ at: T(76), machineId: 2, machineName: 'Washer 2' }),
        event({ at: T(120), machineId: 3, machineName: 'Dryer 1', machineType: 'DRYER' }),
        event({ at: T(170), machineId: 3, machineName: 'Dryer 1', machineType: 'DRYER', kind: 'TOP_UP', charge: 2000 }),
      ],
    });

    const [entry] = report.orders;
    expect(entry.loads.map((l) => [l.number, l.washer?.machineName, l.dryer?.machineName ?? null])).toEqual([
      [1, 'Washer 1', 'Dryer 1'],
      [2, 'Washer 2', null],
    ]);
    expect(entry.loads[0].dryer).toMatchObject({ topUps: 1, topUpCharge: 2000 });
    expect(report.topUps).toEqual({ count: 1, amount: 2000 });
    expect(report.cash).toBe(40000);
    expect(report.gcash).toBe(4000);
    expect(report.figures).toMatchObject({ orders: 1, loads: 2, revenue: 44000 });

    const washer2 = report.machines.find((m) => m.name === 'Washer 2');
    expect(washer2?.entries.map((e) => [e.result, e.loadNumber])).toEqual([
      ['FAILED', null],
      ['ACKED', 2],
    ]);
    expect(washer2?.orderStarts).toBe(1);
    expect(report.machines.map((m) => m.name)).toEqual(['Dryer 1', 'Washer 1', 'Washer 2']);

    expect(report.checks[0]).toEqual({ tone: 'warning', text: '2 loads sold today: 2 washer starts, 1 dryer start.' });
    expect(report.checks.map((c) => c.text)).toContain('T0001 load 2 has no dryer start yet.');
  });

  it('keeps load numbers of orders placed earlier and flags overrides, no-answer starts and voided orders', () => {
    const yesterday = order('T0001', { placedAt: DAY.start - 60 * 60 * 1000, loadCount: 1 });
    const voided = order('T0002', { voided: true, loadCount: 1 });
    const unpaid = order('T0003', { loadCount: 1, paid: 0, balance: 22000 });
    const report = buildDailyReport({
      range: DAY,
      orders: [yesterday, voided, unpaid],
      payments: [],
      expenses: [{ cost: 5000, incurredAt: T(10) }],
      machines,
      events: [
        event({ at: DAY.start - 30 * 60 * 1000, orderId: 'T0001' }),
        event({ at: T(30), orderId: 'T0001', machineId: 3, machineName: 'Dryer 1', machineType: 'DRYER' }),
        event({ at: T(80), orderId: 'T0002' }),
        event({ at: T(85), orderId: 'T0003', machineId: 2, machineName: 'Washer 2', result: 'TIMEOUT' }),
        event({ at: T(95), orderId: null, kind: 'OVERRIDE', overrideReason: 'Rewash' }),
      ],
    });

    expect(report.orders.map((o) => [o.order.id, o.placedToday])).toEqual([
      ['T0001', false],
      ['T0002', true],
      ['T0003', true],
    ]);
    expect(report.orders[0].loads[0].washer?.machineName).toBe('Washer 1');
    expect(report.voidedOrders).toBe(1);
    expect(report.unpaid).toBe(22000);
    expect(report.figures.net).toBe(-5000);
    const texts = report.checks.map((c) => c.text);
    expect(texts).toEqual(
      expect.arrayContaining([
        '1 load sold today: 1 washer start, 0 dryer starts.',
        '1 start today for orders placed on earlier days.',
        '1 owner override (no order allowance used).',
        '1 start got no answer; the machine may have run.',
        '1 start for orders that were later voided.',
        'Machines ran for 1 order not fully paid: T0003.',
      ]),
    );
  });
});
