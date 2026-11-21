import { UserFacingError, type Actor, type ServiceContext } from '@/db/types';

import { getSetting, setSetting } from './settings';

/** The image shown to customers paying by GCash, as a file name in the app's document folder. */
export function gcashQrFile(ctx: ServiceContext): string | null {
  return getSetting(ctx.db, 'gcashQrFile');
}

const FILE_NAME = /^gcash-qr-\d+\.(jpg|jpeg|png|webp)$/;

/**
 * Owner only: the shop's payment QR decides whose account customers pay into, so an admin or
 * employee must not be able to swap it for their own.
 */
export function setGcashQrFile(ctx: ServiceContext, actor: Actor, fileName: string | null): void {
  if (actor.role !== 'OWNER') throw new UserFacingError('Only the owner can change the GCash QR code.');
  if (fileName !== null && !FILE_NAME.test(fileName)) throw new UserFacingError('That image could not be saved.');
  setSetting(ctx.db, 'gcashQrFile', fileName);
}
