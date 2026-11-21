import { createTestContext, testEmployee, testOwner } from '@/db/testing';
import type { Actor } from '@/db/types';

import { gcashQrFile, setGcashQrFile } from '../gcashQr';

const admin: Actor = { id: 'U0003', username: 'ben', role: 'ADMIN' };

describe('GCash QR code', () => {
  it('only the owner can set or remove it', () => {
    const ctx = createTestContext();
    expect(gcashQrFile(ctx)).toBeNull();
    expect(() => setGcashQrFile(ctx, admin, 'gcash-qr-1.jpg')).toThrow('Only the owner');
    expect(() => setGcashQrFile(ctx, testEmployee, 'gcash-qr-1.jpg')).toThrow('Only the owner');

    setGcashQrFile(ctx, testOwner, 'gcash-qr-1.jpg');
    expect(gcashQrFile(ctx)).toBe('gcash-qr-1.jpg');
    expect(() => setGcashQrFile(ctx, admin, null)).toThrow('Only the owner');
    setGcashQrFile(ctx, testOwner, null);
    expect(gcashQrFile(ctx)).toBeNull();
  });

  it('accepts only the file names the app itself makes', () => {
    const ctx = createTestContext();
    expect(() => setGcashQrFile(ctx, testOwner, '../secret.db')).toThrow('could not be saved');
  });
});
