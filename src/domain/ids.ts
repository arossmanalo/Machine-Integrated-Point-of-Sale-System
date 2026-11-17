export const ID_PREFIX = {
  order: 'T',
  customer: 'C',
  inventory: 'I',
  user: 'U',
  expense: 'E',
} as const;

export type IdKind = keyof typeof ID_PREFIX;

/** "T0001". Numbers past 9999 simply get longer ("T10000"). */
export function formatId(kind: IdKind, n: number): string {
  return `${ID_PREFIX[kind]}${n.toString().padStart(4, '0')}`;
}

/** Numeric part of an ID like "T0042", or null if it does not have that shape. */
export function parseIdNumber(id: string): number | null {
  const match = /^[A-Z](\d+)$/.exec(id);
  return match ? Number(match[1]) : null;
}
