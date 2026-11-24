import { writeFileSync } from 'node:fs';

import { createTestContext } from '@/db/testing';
import { shopDayRange } from '@/domain/dates';
import { logIn } from '@/services/auth';
import { restoreBackup } from '@/services/backup';
import { dailyReport } from '@/services/dailyReport';
import { listOrderSummaries } from '@/services/orders';

import { buildSampleBackup, SAMPLE_ACCOUNTS } from '../sampleData';

const NOW = Date.UTC(2026, 10, 23, 9, 0);

/**
 * Checks the sample backup restores into a working report. To write the file for the tablet:
 * SAMPLE_BACKUP=path/to/file.json npx jest src/dev
 */
describe('sample data', () => {
  it('restores into a month of orders with full daily reports', async () => {
    const backup = await buildSampleBackup(NOW);
    const ctx = createTestContext(NOW);
    const owner = { id: 'U0001', username: 'owner', role: 'OWNER' as const };
    restoreBackup(ctx, owner, JSON.parse(JSON.stringify(backup)));

    await expect(logIn(ctx, SAMPLE_ACCOUNTS.owner.username, SAMPLE_ACCOUNTS.owner.password)).resolves.toMatchObject({
      role: 'OWNER',
    });
    const orders = listOrderSummaries(ctx);
    expect(orders.length).toBeGreaterThan(100);
    expect(orders.some((s) => s.order.service === 'DRY_ONLY')).toBe(true);

    const report = dailyReport(ctx, shopDayRange(NOW - 3 * 24 * 60 * 60 * 1000));
    expect(report.orders.length).toBeGreaterThan(0);
    expect(report.figures.revenue).toBeGreaterThan(0);
    expect(report.machines.some((m) => m.orderStarts > 0)).toBe(true);
    expect(report.topUps.count).toBeGreaterThanOrEqual(0);

    const out = process.env.SAMPLE_BACKUP;
    if (out) writeFileSync(out, JSON.stringify(backup));
  }, 120000);
});
