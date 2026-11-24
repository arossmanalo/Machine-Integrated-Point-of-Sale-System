import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import type { Role } from '@/domain/permissions';

import type * as schema from './schema';

/**
 * A synchronous SQLite database or transaction with the app schema. The app uses expo-sqlite,
 * tests use better-sqlite3; services accept either.
 */
export type Db = BaseSQLiteDatabase<'sync', unknown, typeof schema>;

export interface ServiceContext {
  db: Db;
  now: () => number;
  randomBytes: (length: number) => Uint8Array;
}

/** The person doing something, for permission checks and "created by" fields. */
export interface Actor {
  id: string;
  username: string;
  role: Role;
}

/** A rule was broken in a way the user can fix. The message is shown as is. */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserFacingError';
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof UserFacingError) return error.message;
  if (error instanceof Error) return `Something went wrong: ${error.message}`;
  return 'Something went wrong.';
}
