import {
  formatReceiptDateTime,
  formatShopDateTime,
  shopDayRange,
  shopMonthRange,
  startOfShopDay,
  toShopDate,
} from '../dates';
import {
  afterPinFailure,
  hashSecret,
  isPinLocked,
  PIN_LOCKOUT_MS,
  PIN_UNLOCKED,
  pinProblem,
  verifySecret,
} from '../secrets';

describe('shop dates use Philippine time regardless of device zone', () => {
  // 2026-11-17 23:30 in Manila is 15:30 UTC the same day.
  const lateEvening = Date.UTC(2026, 10, 17, 15, 30);
  // 2026-11-18 00:30 in Manila is 16:30 UTC on the 17th.
  const afterMidnight = Date.UTC(2026, 10, 17, 16, 30);

  it('splits days at Manila midnight', () => {
    expect(toShopDate(lateEvening)).toEqual({ year: 2026, month: 10, day: 17 });
    expect(toShopDate(afterMidnight)).toEqual({ year: 2026, month: 10, day: 18 });
    expect(startOfShopDay(afterMidnight)).toBe(Date.UTC(2026, 10, 17, 16, 0));
  });

  it('builds half-open day and month ranges', () => {
    const day = shopDayRange(lateEvening);
    expect(day.end - day.start).toBe(24 * 60 * 60 * 1000);
    expect(lateEvening >= day.start && lateEvening < day.end).toBe(true);
    const december = shopMonthRange(2026, 11);
    expect(december.end).toBe(Date.UTC(2026, 11, 31, 16, 0));
  });

  it('formats times', () => {
    expect(formatShopDateTime(lateEvening)).toBe('Nov 17, 2026 · 11:30 PM');
    expect(formatReceiptDateTime(afterMidnight)).toBe('11/18/2026 00:30');
  });
});

describe('secrets', () => {
  const salt = new Uint8Array(16).fill(7);

  it('verifies the right secret and rejects a wrong one', async () => {
    const stored = await hashSecret('1234', salt, 1000);
    expect(stored.startsWith('pbkdf2-sha256$1000$')).toBe(true);
    await expect(verifySecret('1234', stored)).resolves.toBe(true);
    await expect(verifySecret('1235', stored)).resolves.toBe(false);
    await expect(verifySecret('1234', 'garbage')).resolves.toBe(false);
  });

  it('checks PIN shape', () => {
    expect(pinProblem('1234')).toBeNull();
    expect(pinProblem('123')).not.toBeNull();
    expect(pinProblem('12a4')).not.toBeNull();
  });

  it('locks overrides after five wrong PINs, then unlocks after five minutes', () => {
    let state = PIN_UNLOCKED;
    for (let i = 0; i < 4; i += 1) state = afterPinFailure(state, 1000);
    expect(isPinLocked(state, 1000)).toBe(false);
    state = afterPinFailure(state, 1000);
    expect(isPinLocked(state, 1000)).toBe(true);
    expect(isPinLocked(state, 1000 + PIN_LOCKOUT_MS)).toBe(false);
  });
});
