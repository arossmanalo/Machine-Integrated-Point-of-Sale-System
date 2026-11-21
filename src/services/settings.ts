import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { PIN_UNLOCKED } from '@/domain/secrets';
import { DEFAULT_PRICE_PER_LOAD } from '@/domain/pricing';
import { settings } from '@/db/schema';
import type { Db } from '@/db/types';

const settingSchemas = {
  pricePerLoad: z.number().int().nonnegative(),
  customStatuses: z.array(z.string()),
  hiddenStatuses: z.array(z.string()),
  printerAddress: z.string().nullable(),
  printerName: z.string().nullable(),
  receiptHeader: z.string(),
  receiptFooter: z.string(),
  ownerPinHash: z.string().nullable(),
  pinLock: z.object({ failures: z.number().int(), lockedUntil: z.number().nullable() }),
  sessionUserId: z.string().nullable(),
  simulateMachines: z.boolean(),
  /** What the owner typed, e.g. "192.168.1.50"; turned into a URL by normalizeAddress. */
  lockControllerAddress: z.string(),
  /** Shared passphrase that signs every pulse; must match LOCK_KEY in the ESP32 sketch. */
  lockControllerKey: z.string(),
  /** When on, running a machine for an order needs that order's receipt QR code scanned. */
  requireReceiptScan: z.boolean(),
  /** When on, employees can enter expenses (today's only); they still cannot see or delete them. */
  employeesRecordExpenses: z.boolean(),
  /** File in the app's document folder with the shop's GCash QR, shown when a customer pays by GCash. */
  gcashQrFile: z.string().nullable(),
};

export type SettingKey = keyof typeof settingSchemas;
export type Settings = { [K in SettingKey]: z.infer<(typeof settingSchemas)[K]> };

export const DEFAULT_SETTINGS: Settings = {
  pricePerLoad: DEFAULT_PRICE_PER_LOAD,
  customStatuses: [],
  hiddenStatuses: [],
  printerAddress: null,
  printerName: null,
  receiptHeader: 'AR LAUNDRY SHOP',
  receiptFooter: 'Thank you for choosing\nAR LAUNDRY!\nCleanliness is our Priority',
  ownerPinHash: null,
  pinLock: PIN_UNLOCKED,
  sessionUserId: null,
  simulateMachines: false,
  lockControllerAddress: '',
  lockControllerKey: '',
  requireReceiptScan: true,
  employeesRecordExpenses: false,
  gcashQrFile: null,
};

function parseStored<K extends SettingKey>(key: K, raw: string | undefined): Settings[K] {
  if (raw === undefined) return DEFAULT_SETTINGS[key];
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    // A corrupt value falls back to the default rather than blocking the whole app.
    return DEFAULT_SETTINGS[key];
  }
  const parsed = settingSchemas[key].safeParse(json);
  return parsed.success ? (parsed.data as Settings[K]) : DEFAULT_SETTINGS[key];
}

export function getSetting<K extends SettingKey>(db: Db, key: K): Settings[K] {
  const row = db.select().from(settings).where(eq(settings.key, key)).get();
  return parseStored(key, row?.value);
}

export function getAllSettings(db: Db): Settings {
  const rows = db.select().from(settings).all();
  const stored = new Map(rows.map((row) => [row.key, row.value]));
  const result = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(settingSchemas) as SettingKey[]) {
    Object.assign(result, { [key]: parseStored(key, stored.get(key)) });
  }
  return result;
}

export function setSetting<K extends SettingKey>(db: Db, key: K, value: Settings[K]): void {
  const checked = settingSchemas[key].parse(value);
  const text = JSON.stringify(checked);
  db.insert(settings)
    .values({ key, value: text })
    .onConflictDoUpdate({ target: settings.key, set: { value: text } })
    .run();
}

/** Settings that belong to this tablet session, not to the shop's data, so backups skip them. */
export const DEVICE_ONLY_SETTINGS: readonly SettingKey[] = ['sessionUserId', 'pinLock'];
