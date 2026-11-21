/**
 * The shop is in the Philippines. Day boundaries for reports and filters use Philippine time
 * (UTC+8, no daylight saving) whatever the tablet's own time zone setting says.
 */
export const SHOP_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

const SHORT_MONTHS = MONTH_NAMES.map((name) => name.slice(0, 3));

export interface ShopDate {
  year: number;
  /** 0-11 */
  month: number;
  day: number;
}

function shiftedDate(ms: number): Date {
  return new Date(ms + SHOP_UTC_OFFSET_MS);
}

export function toShopDate(ms: number): ShopDate {
  const d = shiftedDate(ms);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate() };
}

/** Epoch ms of 00:00 shop time on the given calendar date. Month may overflow (13 -> next year). */
export function shopMidnight(year: number, month: number, day: number): number {
  return Date.UTC(year, month, day) - SHOP_UTC_OFFSET_MS;
}

export function startOfShopDay(ms: number): number {
  const { year, month, day } = toShopDate(ms);
  return shopMidnight(year, month, day);
}

export function startOfShopMonth(ms: number): number {
  const { year, month } = toShopDate(ms);
  return shopMidnight(year, month, 1);
}

export function startOfShopYear(year: number): number {
  return shopMidnight(year, 0, 1);
}

export function addShopDays(dayStartMs: number, days: number): number {
  return dayStartMs + days * DAY_MS;
}

/** Half-open range [start, end). */
export interface TimeRange {
  start: number;
  end: number;
}

export function inRange(ms: number, range: TimeRange): boolean {
  return ms >= range.start && ms < range.end;
}

export function shopDayRange(ms: number): TimeRange {
  const start = startOfShopDay(ms);
  return { start, end: addShopDays(start, 1) };
}

/** Whole shop days from the first day's start to the end of the last day, inclusive. */
export function shopDaysRange(firstDayMs: number, lastDayMs: number): TimeRange {
  const start = startOfShopDay(Math.min(firstDayMs, lastDayMs));
  const end = addShopDays(startOfShopDay(Math.max(firstDayMs, lastDayMs)), 1);
  return { start, end };
}

export function shopMonthRange(year: number, month: number): TimeRange {
  return { start: shopMidnight(year, month, 1), end: shopMidnight(year, month + 1, 1) };
}

export function isSameShopDay(a: number, b: number): boolean {
  return startOfShopDay(a) === startOfShopDay(b);
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

/** "Nov 17, 2026" */
export function formatShopDate(ms: number): string {
  const { year, month, day } = toShopDate(ms);
  return `${SHORT_MONTHS[month]} ${day}, ${year}`;
}

/** "2026-11-17", for file names that sort by date. */
export function formatShopDateStamp(ms: number): string {
  const { year, month, day } = toShopDate(ms);
  return `${year}-${pad2(month + 1)}-${pad2(day)}`;
}

/** "Nov 17" */
export function formatShopDayShort(ms: number): string {
  const { month, day } = toShopDate(ms);
  return `${SHORT_MONTHS[month]} ${day}`;
}

/** "2:05 PM" */
export function formatShopTime(ms: number): string {
  const d = shiftedDate(ms);
  const hours = d.getUTCHours();
  const suffix = hours < 12 ? 'AM' : 'PM';
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${pad2(d.getUTCMinutes())} ${suffix}`;
}

/** "Nov 17, 2026 · 2:05 PM" */
export function formatShopDateTime(ms: number): string {
  return `${formatShopDate(ms)} · ${formatShopTime(ms)}`;
}

/** "11/17/2026 14:05" (receipt format, as on the old receipts) */
export function formatReceiptDateTime(ms: number): string {
  const d = shiftedDate(ms);
  const date = `${pad2(d.getUTCMonth() + 1)}/${pad2(d.getUTCDate())}/${d.getUTCFullYear()}`;
  return `${date} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}
