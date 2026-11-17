import { drizzle } from 'drizzle-orm/expo-sqlite';
import { getRandomBytes } from 'expo-crypto';
import { openDatabaseSync } from 'expo-sqlite';

import * as schema from './schema';
import type { ServiceContext } from './types';

const sqlite = openDatabaseSync('laundry-pos.db');
sqlite.execSync('PRAGMA foreign_keys = ON;');

export const appDb = drizzle(sqlite, { schema });

export const appContext: ServiceContext = {
  db: appDb,
  now: () => Date.now(),
  randomBytes: (length) => getRandomBytes(length),
};
