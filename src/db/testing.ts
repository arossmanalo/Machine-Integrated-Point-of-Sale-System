import { randomBytes } from 'node:crypto';
import path from 'node:path';

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

import * as schema from './schema';
import type { Actor, ServiceContext } from './types';

/** A fresh in-memory database with all migrations applied, for tests. */
export function createTestContext(start = Date.UTC(2026, 10, 17, 2, 0)): ServiceContext & {
  advance: (ms: number) => void;
} {
  const client = new Database(':memory:');
  client.pragma('foreign_keys = ON');
  const db = drizzle(client, { schema });
  migrate(db, { migrationsFolder: path.join(__dirname, '../../drizzle') });
  let clock = start;
  return {
    db,
    now: () => clock,
    randomBytes: (length) => new Uint8Array(randomBytes(length)),
    advance: (ms) => {
      clock += ms;
    },
  };
}

export const testOwner: Actor = { id: 'U0001', username: 'owner', role: 'OWNER' };
export const testEmployee: Actor = { id: 'U0002', username: 'ana', role: 'EMPLOYEE' };
