import { CURRENT_SERVICE } from './pricing';
import { isClosedStatus } from './statuses';

export const MACHINE_TYPES = ['WASHER', 'DRYER'] as const;
export type MachineType = (typeof MACHINE_TYPES)[number];

export const MACHINE_TYPE_LABELS: Record<MachineType, string> = {
  WASHER: 'Washer',
  DRYER: 'Dryer',
};

export interface UnlockOrder {
  service: string;
  loadCount: number;
  status: string;
  voided: boolean;
}

export interface UnlockMachine {
  type: MachineType;
  enabled: boolean;
}

/**
 * Each load of Wash-Dry-Fold allows one washer unlock and one dryer unlock. Orders imported from
 * the old app with other services are history and allow none. Payment is deliberately not a
 * condition: pay-later orders unlock the same as paid ones.
 */
export function unlockAllowance(order: Pick<UnlockOrder, 'service' | 'loadCount'>): number {
  return order.service === CURRENT_SERVICE ? order.loadCount : 0;
}

export type UnlockDenial =
  | 'no-order'
  | 'voided'
  | 'closed'
  | 'machine-disabled'
  | 'allowance-used'
  | 'not-connected';

export type UnlockDecision = { allowed: true } | { allowed: false; reason: UnlockDenial; message: string };

export interface UnlockCheck {
  order: UnlockOrder | null;
  machine: UnlockMachine;
  /** Unlocks of this machine type already counted against the order. */
  usedOfType: number;
  controllerReady: boolean;
}

function deny(reason: UnlockDenial, message: string): UnlockDecision {
  return { allowed: false, reason, message };
}

export function decideOrderUnlock(check: UnlockCheck): UnlockDecision {
  const { order, machine } = check;
  const typeLabel = MACHINE_TYPE_LABELS[machine.type].toLowerCase();
  if (order === null) return deny('no-order', 'Pick an order first. No order, no unlock.');
  if (order.voided) return deny('voided', 'This order was voided.');
  if (isClosedStatus(order.status)) {
    return deny('closed', 'This order is already completed.');
  }
  if (!machine.enabled) return deny('machine-disabled', 'This machine is switched off in settings.');
  const allowance = unlockAllowance(order);
  if (check.usedOfType >= allowance) {
    const message =
      allowance === 0
        ? `This order does not include ${typeLabel} use.`
        : `No ${typeLabel} unlocks left on this order (${check.usedOfType} of ${allowance} used). ` +
          'Use an owner override for an extra cycle.';
    return deny('allowance-used', message);
  }
  if (!check.controllerReady) {
    return deny('not-connected', 'The lock controller is not connected. Check the USB cable.');
  }
  return { allowed: true };
}
