import { Buffer } from 'node:buffer';

import {
  buildReceipt,
  LINE_WIDTH,
  qrCodeBytes,
  receiptLines,
  toBase64,
  toPrintable,
  twoColumns,
  type ReceiptData,
} from '../escpos';

const receipt: ReceiptData = {
  header: 'AR LAUNDRY SHOP',
  footer: 'Thank you!',
  orderId: 'T0007',
  placedAt: Date.UTC(2026, 10, 17, 6, 5),
  customerName: 'Peña',
  service: 'WASH_DRY_FOLD',
  weightKg: 12.5,
  loads: 2,
  promoApplied: false,
  lines: [
    { label: '2 loads x Php 220.00', amount: 44000 },
    { label: 'Fabcon x2', amount: 3000 },
  ],
  total: 47000,
  paid: 47000,
  balance: 0,
  lastPayment: { channel: 'CASH', amount: 47000, cashReceived: 50000 },
  voided: false,
  machineCode: 'LPOS1:T0007:0123456789abcdef0123456789abcdef',
};

describe('receipt layout', () => {
  it('keeps every line within the printer width and ASCII only', () => {
    const lines = receiptLines(receipt);
    expect(lines.every((line) => line.split('\n').every((part) => part.length <= LINE_WIDTH))).toBe(true);
    expect(lines.join('')).toMatch(/^[\x20-\x7e\n]*$/);
    expect(lines).toContain('Customer: Pena');
    expect(lines).toContain('Date: 11/17/2026 14:05');
    expect(lines).toContain(twoColumns('CHANGE', 'Php 30.00'));
  });

  it('pads two columns to the full width', () => {
    expect(twoColumns('TOTAL', 'Php 470.00')).toHaveLength(LINE_WIDTH);
    expect(toPrintable('₱5')).toBe('Php 5');
  });

  it('starts with printer init and marks voided receipts', () => {
    const bytes = buildReceipt({ ...receipt, voided: true });
    expect(Array.from(bytes.slice(0, 2))).toEqual([0x1b, 0x40]);
    expect(Buffer.from(bytes).toString('latin1')).toContain('*** VOIDED ***');
  });

  it('builds the ESC/POS QR commands: model 2, size, error level, store, print', () => {
    const store = [0x1d, 0x28, 0x6b, 0x06, 0x00, 0x31, 0x50, 0x30, 0x41, 0x42, 0x43];
    expect(qrCodeBytes('ABC')).toEqual([
      ...[0x1d, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00],
      ...[0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, 0x06],
      ...[0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31],
      ...store,
      ...[0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30],
    ]);
  });

  it("prints the order's QR code, but not on a voided receipt", () => {
    const text = (data: ReceiptData) => Buffer.from(buildReceipt(data)).toString('latin1');
    expect(text(receipt)).toContain(receipt.machineCode);
    expect(text({ ...receipt, voided: true })).not.toContain(receipt.machineCode);
  });

  it('base64-encodes like Node does', () => {
    for (const sample of [[], [1], [1, 2], [1, 2, 3], [255, 0, 128, 7]]) {
      const data = Uint8Array.from(sample);
      expect(toBase64(data)).toBe(Buffer.from(data).toString('base64'));
    }
  });
});
