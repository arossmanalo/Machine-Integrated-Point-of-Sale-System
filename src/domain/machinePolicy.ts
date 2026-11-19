import { CURRENT_SERVICE } from './pricing';
import { isClosedStatus } from './statuses';

export const MACHINE_TYPES = ['WASHER', 'DRYER'] as const;
export type MachineType = (typeof MACHINE_TYPES)[number];

export const MACHINE_TYPE_LABELS: Record<MachineType, string> = {
  WASHER: 'Washer',
  DRYER: 'Dryer',
};

export interface PolicyOrder {
  id: string;
  service: string;
  loadCount: number;
  status: string;
  voided: boolean;
}

export interface PolicyMachine {
  name: string;
  type: MachineType;
  enabled: boolean;
  assignedOrderId: string | null;
}

/**
 * Each load of Wash-Dry-Fold allows one washer start and one dryer start. Orders imported from
 * the old app with other services are history and allow none. Payment is deliberately not a
 * condition: pay-later orders run the same as paid ones.
 */
export function machineAllowance(order: Pick<PolicyOrder, 'service' | 'loadCount'>): number {
  return order.service === CURRENT_SERVICE ? order.loadCount : 0;
}

export type MachineDenial =
  | 'no-order'
  | 'voided'
  | 'closed'
  | 'machine-disabled'
  | 'machine-taken'
  | 'allowance-used'
  | 'not-assigned';

export type MachineDecision = { allowed: true } | { allowed: false; reason: MachineDenial; message: string };

function deny(reason: MachineDenial, message: string): MachineDecision {
  return { allowed: false, reason, message };
}

const NO_ORDER = deny('no-order', 'Pick an order first. No order, no machine.');

function orderProblem(order: PolicyOrder): MachineDecision | null {
  if (order.voided) return deny('voided', `Order ${order.id} was voided.`);
  if (isClosedStatus(order.status)) return deny('closed', `Order ${order.id} is already completed.`);
  return null;
}

export interface AssignCheck {
  order: PolicyOrder | null;
  machine: PolicyMachine;
  /**
   * Machines of this type already counted against the order: confirmed starts, starts still
   * waiting for an answer or never answered, and other machines it is assigned to right now.
   */
  usedOfType: number;
}

export function decideAssignment(check: AssignCheck): MachineDecision {
  const { order, machine } = check;
  if (order === null) return NO_ORDER;
  const problem = orderProblem(order);
  if (problem) return problem;
  if (!machine.enabled) return deny('machine-disabled', `${machine.name} is switched off in settings.`);
  if (machine.assignedOrderId !== null) {
    return deny(
      'machine-taken',
      machine.assignedOrderId === order.id
        ? `${machine.name} already has order ${order.id}.`
        : `${machine.name} already has order ${machine.assignedOrderId}. Start it or remove that order first.`,
    );
  }
  const allowance = machineAllowance(order);
  if (check.usedOfType >= allowance) {
    const typeLabel = MACHINE_TYPE_LABELS[machine.type].toLowerCase();
    return deny(
      'allowance-used',
      allowance === 0
        ? `Order ${order.id} does not include ${typeLabel} use.`
        : `Order ${order.id} has used all its ${typeLabel}s (${check.usedOfType} of ${allowance}). ` +
            'Use an owner override for an extra cycle.',
    );
  }
  return { allowed: true };
}

/** A machine starts only for the order assigned to it, while that order is still open. */
export function decideStart(machine: PolicyMachine, order: PolicyOrder | null): MachineDecision {
  if (machine.assignedOrderId === null) {
    return deny('not-assigned', `Assign an order to ${machine.name} before starting it.`);
  }
  if (order === null) return NO_ORDER;
  const problem = orderProblem(order);
  if (problem) return problem;
  if (!machine.enabled) return deny('machine-disabled', `${machine.name} is switched off in settings.`);
  return { allowed: true };
}
