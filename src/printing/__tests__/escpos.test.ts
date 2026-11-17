import { Buffer } from 'node:buffer';

import { buildReceipt, LINE_WIDTH, receiptLines, toBase64, toPrintable, twoColumns, type ReceiptData } from '../escpos';

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

  it('base64-encodes like Node does', () => {
    for (const sample of [[], [1], [1, 2], [1, 2, 3], [255, 0, 128, 7]]) {
      const data = Uint8Array.from(sample);
      expect(toBase64(data)).toBe(Buffer.from(data).toString('base64'));
    }
  });
});
