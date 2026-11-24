import { Buffer } from 'node:buffer';

import {
  buildReceipt,
  LINE_WIDTH,
  qrBitmap,
  qrRasterBytes,
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
  overrideCode: null,
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

  it('draws the QR code with a white border, small enough for a 58 mm printer', () => {
    const bitmap = qrBitmap(receipt.machineCode);
    expect(bitmap.size).toBeGreaterThan(160);
    expect(bitmap.size).toBeLessThanOrEqual(224);
    // Quiet zone: the corners are white; the top-left finder pattern starts dark just inside it.
    expect(bitmap.isDark(0, 0)).toBe(false);
    expect(bitmap.isDark(bitmap.size - 1, bitmap.size - 1)).toBe(false);
    let firstDark = 0;
    while (!bitmap.isDark(firstDark, firstDark)) firstDark += 1;
    expect(bitmap.isDark(firstDark, firstDark)).toBe(true);
    expect(firstDark).toBeGreaterThan(0);
  });

  it('sends the QR code as raster bands whose sizes match the picture', () => {
    const bitmap = qrBitmap('LPOS1:T0001:' + 'a'.repeat(32));
    const bytes = qrRasterBytes('LPOS1:T0001:' + 'a'.repeat(32));
    const widthBytes = Math.ceil(bitmap.size / 8);
    let offset = 0;
    let rows = 0;
    while (offset < bytes.length) {
      expect(bytes.slice(offset, offset + 4)).toEqual([0x1d, 0x76, 0x30, 0x00]);
      expect(bytes[offset + 4] + 256 * bytes[offset + 5]).toBe(widthBytes);
      const band = bytes[offset + 6] + 256 * bytes[offset + 7];
      // The first data byte of each band row matches the picture's first 8 dots.
      const first = bytes[offset + 8];
      let expected = 0;
      for (let bit = 0; bit < 8; bit += 1) if (bitmap.isDark(bit, rows)) expected |= 0x80 >> bit;
      expect(first).toBe(expected);
      rows += band;
      offset += 8 + band * widthBytes;
    }
    expect(offset).toBe(bytes.length);
    expect(rows).toBe(bitmap.size);
  });

  it("prints the order's QR code as a picture, but not on a voided receipt", () => {
    const text = (data: ReceiptData) => Buffer.from(buildReceipt(data)).toString('latin1');
    const raster = String.fromCharCode(0x1d, 0x76, 0x30);
    expect(text(receipt)).toContain('Scan at the machines');
    expect(text(receipt)).toContain(raster);
    expect(text({ ...receipt, voided: true })).not.toContain(raster);
  });

  it('prints the override code instead of the machine code on an override receipt', () => {
    const text = (data: ReceiptData) => Buffer.from(buildReceipt(data)).toString('latin1');
    const override = text({ ...receipt, overrideCode: 'LPOS1X:T0007:abcdefabcdefabcdefabcdefabcdefab' });
    expect(override).toContain('OWNER OVERRIDE');
    expect(override).toContain('One machine start for T0007');
    expect(override).not.toContain('Scan at the machines');
    expect(Buffer.from(buildReceipt(receipt)).equals(Buffer.from(buildReceipt({ ...receipt, overrideCode: null })))).toBe(
      true,
    );
  });

  it('base64-encodes like Node does', () => {
    for (const sample of [[], [1], [1, 2], [1, 2, 3], [255, 0, 128, 7]]) {
      const data = Uint8Array.from(sample);
      expect(toBase64(data)).toBe(Buffer.from(data).toString('base64'));
    }
  });
});
