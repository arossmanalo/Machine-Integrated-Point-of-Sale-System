import { buildDailyReport } from '@/domain/dailyReport';

import { dailyReportHtml, escapeHtml } from '../dailyReportHtml';

const DAY = { start: Date.UTC(2026, 10, 20, 16, 0), end: Date.UTC(2026, 10, 21, 16, 0) };

describe('daily report PDF page', () => {
  it('escapes names typed in by staff', () => {
    expect(escapeHtml(`<b>"Tom" & Jerry's</b>`)).toBe('&lt;b&gt;&quot;Tom&quot; &amp; Jerry&#39;s&lt;/b&gt;');
  });

  it('lists sales, each load with its machines, and every machine event', () => {
    const report = buildDailyReport({
      range: DAY,
      orders: [
        {
          id: 'T0012',
          customerName: '<script>x</script>',
          placedAt: DAY.start + 3600000,
          loadCount: 1,
          status: 'PENDING',
          total: 22000,
          paid: 0,
          balance: 22000,
          voided: false,
        },
      ],
      payments: [],
      expenses: [],
      machines: [{ id: 1, name: 'Washer 1', type: 'WASHER' }],
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
          result: 'BUSY',
          charge: null,
          overrideReason: null,
        },
        {
          id: 2,
          at: DAY.start + 4100000,
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
      ],
    });
    const html = dailyReportHtml(report, 'Nov 21, 2026', 'AR Laundry', DAY.start + 5000000);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;');
    expect(html).toContain('Daily report · Nov 21, 2026');
    expect(html).toContain('Washer 1 1:08 AM');
    expect(html).toContain('Busy, did not run');
    expect(html).toContain('Washer 1 · 1 order start');
    expect(html).toContain('T0012 load 1 has no dryer start yet.');
  });
});
