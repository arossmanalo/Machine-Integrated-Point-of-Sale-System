import { eq } from 'drizzle-orm';

import { formatId, type IdKind } from '@/domain/ids';
import { sequences } from '@/db/schema';
import type { Db } from '@/db/types';

/** Takes the next ID for a kind. Call inside the same transaction that inserts the row. */
export function takeNextId(db: Db, kind: IdKind): string {
  const row = db.select().from(sequences).where(eq(sequences.name, kind)).get();
  const n = row?.next ?? 1;
  db.insert(sequences)
    .values({ name: kind, next: n + 1 })
    .onConflictDoUpdate({ target: sequences.name, set: { next: n + 1 } })
    .run();
  return formatId(kind, n);
}

/** Makes sure the next ID is above `usedNumber` (after importing rows with their own IDs). */
export function bumpSequence(db: Db, kind: IdKind, usedNumber: number): void {
  const row = db.select().from(sequences).where(eq(sequences.name, kind)).get();
  const next = Math.max(row?.next ?? 1, usedNumber + 1);
  db.insert(sequences)
    .values({ name: kind, next })
    .onConflictDoUpdate({ target: sequences.name, set: { next } })
    .run();
}
