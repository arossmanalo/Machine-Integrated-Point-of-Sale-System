import { formatReceiptDateTime } from '@/domain/dates';
import { formatAmount } from '@/domain/money';
import { PAYMENT_CHANNEL_LABELS, type PaymentChannel } from '@/domain/payments';
import { serviceLabel } from '@/domain/pricing';

/** 58 mm thermal printers fit 32 characters per line in the default font. */
export const LINE_WIDTH = 32;

const ESC = 0x1b;
const INIT = [ESC, 0x40];
const ALIGN_LEFT = [ESC, 0x61, 0x00];
const ALIGN_CENTER = [ESC, 0x61, 0x01];
const BOLD_ON = [ESC, 0x45, 0x01];
const BOLD_OFF = [ESC, 0x45, 0x00];
const FEED_3 = [ESC, 0x64, 0x03];
const GS = 0x1d;

/** QR module size in dots; 6 makes a symbol about 2.5 cm wide on a 58 mm printer. */
const QR_MODULE_SIZE = 6;

/** One GS ( k packet for a QR code (cn = 0x31): function byte, then its parameters. */
function qrPacket(fn: number, params: readonly number[]): number[] {
  const length = params.length + 2;
  return [GS, 0x28, 0x6b, length & 0xff, length >> 8, 0x31, fn, ...params];
}

/** Native ESC/POS QR code: model 2, module size, error correction M, store the data, print it. */
export function qrCodeBytes(text: string): number[] {
  return [
    ...qrPacket(0x41, [0x32, 0x00]),
    ...qrPacket(0x43, [QR_MODULE_SIZE]),
    ...qrPacket(0x45, [0x31]),
    ...qrPacket(0x50, [0x30, ...bytes(text)]),
    ...qrPacket(0x51, [0x30]),
  ];
}

export interface ReceiptData {
  header: string;
  footer: string;
  orderId: string;
  placedAt: number;
  customerName: string;
  service: string;
  weightKg: number;
  loads: number;
  promoApplied: boolean;
  lines: { label: string; amount: number }[];
  total: number;
  paid: number;
  balance: number;
  /** The latest payment, if any, to show cash and change. */
  lastPayment: { channel: PaymentChannel; amount: number; cashReceived: number | null } | null;
  voided: boolean;
  /** What the receipt's QR code holds; staff scan it to run a machine for this order. */
  machineCode: string;
}

/** Thermal printers only know plain ASCII; replace anything else so the line still prints. */
export function toPrintable(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/₱/g, 'Php ')
    .replace(/[^\x20-\x7e\n]/g, '?');
}

/** "Label ........ amount" padded to the line width; long labels wrap. */
export function twoColumns(label: string, value: string, width = LINE_WIDTH): string {
  const room = width - value.length - 1;
  if (label.length <= room) return `${label}${' '.repeat(width - label.length - value.length)}${value}`;
  return `${label.slice(0, width)}\n${' '.repeat(Math.max(0, width - value.length))}${value}`;
}

/** The receipt as text, one entry per printed line (exported for tests and preview). */
export function receiptLines(data: ReceiptData): string[] {
  const rule = '-'.repeat(LINE_WIDTH);
  const php = (centavos: number) => `Php ${formatAmount(centavos)}`;
  const lines: string[] = [
    `Date: ${formatReceiptDateTime(data.placedAt)}`,
    `Order: ${data.orderId}`,
    `Customer: ${data.customerName}`,
    `Service: ${serviceLabel(data.service)}`,
    `Weight: ${data.weightKg} kg`,
    `Loads: ${data.loads}${data.promoApplied ? ' (1 free, 10+1 promo)' : ''}`,
    rule,
    ...data.lines.map((line) => twoColumns(line.label, php(line.amount))),
    rule,
    twoColumns('TOTAL', php(data.total)),
  ];
  const last = data.lastPayment;
  if (last && last.channel === 'CASH' && last.cashReceived !== null) {
    lines.push(twoColumns('CASH', php(last.cashReceived)));
    lines.push(twoColumns('CHANGE', php(Math.max(0, last.cashReceived - last.amount))));
  } else if (last) {
    lines.push(twoColumns(`Paid via ${PAYMENT_CHANNEL_LABELS[last.channel]}`, php(last.amount)));
  }
  lines.push(twoColumns('PAID', php(data.paid)));
  lines.push(twoColumns('BALANCE', php(data.balance)));
  return lines.map(toPrintable);
}

function bytes(text: string): number[] {
  return Array.from(toPrintable(text), (ch) => ch.charCodeAt(0));
}

export function buildReceipt(data: ReceiptData): Uint8Array {
  const out: number[] = [...INIT, ...ALIGN_CENTER, ...BOLD_ON, ...bytes(`${data.header}\n`), ...BOLD_OFF];
  if (data.voided) out.push(...BOLD_ON, ...bytes('*** VOIDED ***\n'), ...BOLD_OFF);
  out.push(...bytes(`${'-'.repeat(LINE_WIDTH)}\n`), ...ALIGN_LEFT);
  for (const line of receiptLines(data)) {
    const isBalance = line.startsWith('BALANCE') || line.startsWith('TOTAL');
    if (isBalance) out.push(...BOLD_ON);
    out.push(...bytes(`${line}\n`));
    if (isBalance) out.push(...BOLD_OFF);
  }
  out.push(...ALIGN_CENTER);
  if (!data.voided) {
    out.push(...bytes('\nScan at the machines\n'), ...qrCodeBytes(data.machineCode), ...bytes('\n'));
  }
  out.push(...bytes(`\n${data.footer}\n`), ...FEED_3);
  return Uint8Array.from(out);
}

/** A plain printout (such as the daily report): bold centred header, then left-aligned lines. */
export function buildTextDocument(header: string, lines: readonly string[]): Uint8Array {
  const out: number[] = [...INIT, ...ALIGN_CENTER, ...BOLD_ON, ...bytes(`${header}\n`), ...BOLD_OFF, ...ALIGN_LEFT];
  for (const line of lines) out.push(...bytes(`${line}\n`));
  out.push(...FEED_3);
  return Uint8Array.from(out);
}

export function toBase64(data: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  for (let i = 0; i < data.length; i += 3) {
    const [a, b = 0, c = 0] = [data[i], data[i + 1], data[i + 2]];
    const triple = (a << 16) | (b << 8) | c;
    result += alphabet[(triple >> 18) & 63] + alphabet[(triple >> 12) & 63];
    result += i + 1 < data.length ? alphabet[(triple >> 6) & 63] : '=';
    result += i + 2 < data.length ? alphabet[triple & 63] : '=';
  }
  return result;
}
