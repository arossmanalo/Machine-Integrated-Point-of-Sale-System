import { machineEarnings, machineShareOfLoad, type EarningStart } from '../machineEarnings';

describe('machine share of a load', () => {
  it('is half the price per load, dropping an odd centavo', () => {
    expect(machineShareOfLoad(16000)).toBe(8000);
    expect(machineShareOfLoad(16500)).toBe(8250);
    expect(machineShareOfLoad(16001)).toBe(8000);
    expect(machineShareOfLoad(0)).toBe(0);
  });
});

describe('machine earnings', () => {
  const start = (overrides: Partial<EarningStart>): EarningStart => ({
    at: 100,
    kind: 'ORDER',
    result: 'ACKED',
    pricePerLoad: 16000,
    orderVoided: false,
    ...overrides,
  });

  it('counts only order starts that may have run, for orders that still stand', () => {
    const starts = [
      start({}),
      start({ result: 'TIMEOUT' }),
      start({ result: 'FAILED' }),
      start({ kind: 'TOP_UP' }),
      start({ kind: 'OVERRIDE', pricePerLoad: null }),
      start({ orderVoided: true }),
      start({ at: 10 }),
    ];
    const ranges = { today: { start: 50, end: 200 }, month: { start: 0, end: 200 } };
    expect(machineEarnings(starts, ranges)).toEqual({
      today: { loads: 2, amount: 16000 },
      month: { loads: 3, amount: 24000 },
      allTime: { loads: 3, amount: 24000 },
    });
  });
});
