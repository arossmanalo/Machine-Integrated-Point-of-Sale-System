export const BUILT_IN_STATUSES = ['PENDING', 'WASHING', 'READY', 'COMPLETED', 'AUDITED'] as const;

/** Orders in these statuses are finished: no more machine unlocks, not counted as open work. */
export const CLOSED_STATUSES: readonly string[] = ['COMPLETED', 'AUDITED'];

export const INITIAL_STATUS = 'PENDING';

export function isClosedStatus(status: string): boolean {
  return CLOSED_STATUSES.includes(status.toUpperCase());
}

/** "out for delivery " -> "OUT_FOR_DELIVERY" */
export function normalizeStatus(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, '_');
}

/** "OUT_FOR_DELIVERY" -> "Out for delivery" */
export function statusLabel(status: string): string {
  const words = status.toLowerCase().replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Statuses offered in pickers and filters, in a stable order. */
export function selectableStatuses(
  custom: readonly string[],
  hidden: readonly string[],
  includeAudited: boolean,
): string[] {
  const all = [...BUILT_IN_STATUSES, ...custom].filter((s, i, list) => list.indexOf(s) === i);
  return all.filter((s) => !hidden.includes(s) && (includeAudited || s !== 'AUDITED'));
}
