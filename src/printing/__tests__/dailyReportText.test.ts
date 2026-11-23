import { buildDailyReport } from '@/domain/dailyReport';

import { dailyReportLines, wrap } from '../dailyReportText';
import { LINE_WIDTH } from '../escpos';

const DAY = { start: Date.UTC(2026, 10, 20, 16, 0), end: Date.UTC(2026, 10, 21, 16, 0) };

describe('daily report printout', () => {
  it('wraps long text at spaces', () => {
    expect(wrap('aaaa bbbb cccc', '  ', 10)).toEqual(['aaaa bbbb', '  cccc']);
  });

  it('fits every line on the 58 mm paper and lists loads, machines and checks', () => {
    const report = buildDailyReport({
      range: DAY,
      orders: [
        {
          id: 'T0012',
          customerName: 'Maria Clara de los Santos-Reyes',
          placedAt: DAY.start + 3600000,
          loadCount: 2,
          service: 'WASH_DRY_FOLD',
          status: 'PENDING',
          total: 46000,
          paid: 46000,
          balance: 0,
          voided: false,
        },
      ],
      payments: [{ orderId: 'T0012', amount: 46000, channel: 'CASH', receivedAt: DAY.start + 3600000 }],
      expenses: [],
      machines: [
        { id: 1, name: 'Washer 1', type: 'WASHER' },
        { id: 2, name: 'Dryer 1', type: 'DRYER' },
      ],
      events: [
        {
          id: 1,
          at: DAY.start + 4000000,
          machineId: 1,
          machineName: 'Washer 1',
          machineType: 'WASHER',
          orderId: 'T0012',
          employeeName: 'ana',
          kind: 'ORDER',
          result: 'ACKED',
          charge: null,
          overrideReason: null,
        },
        {
          id: 2,
          at: DAY.start + 8000000,
          machineId: 2,
          machineName: 'Dryer 1',
          machineType: 'DRYER',
          orderId: 'T0012',
          employeeName: 'ana',
          kind: 'ORDER',
          result: 'ACKED',
          charge: null,
          overrideReason: null,
        },
        {
          id: 3,
          at: DAY.start + 9000000,
          machineId: 2,
          machineName: 'Dryer 1',
          machineType: 'DRYER',
          orderId: 'T0012',
          employeeName: 'ana',
          kind: 'TOP_UP',
          result: 'ACKED',
          charge: 2000,
          overrideReason: null,
        },
      ],
    });
    const lines = dailyReportLines(report, 'Nov 21, 2026');
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(LINE_WIDTH);
    const text = lines.join('\n');
    expect(text).toContain('Load 1 W: Washer 1');
    expect(text).toContain('D: Dryer 1');
    expect(text).toContain('D: Dryer 1 2:13 AM +1\n    top-up');
    expect(text).toContain('Load 2 W: -');
    expect(text).toContain('Dryer 1: 1 start, 1 top-up');
    expect(text).toContain('  2:30 AM TOP-UP T0012 Php 20.00\n    ana');
    expect(text).toContain('\n  Load 1 W: Washer 1');
    expect(text).toContain('! T0012 load 2 has no washer or');
  });
});
