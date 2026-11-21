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
  runOrderId: string | null;
  runEndsAt: number | null;
}

/** A dryer top-up adds this much time; the price per top-up is set per dryer. */
export const TOP_UP_MINUTES = 5;
export const RUN_MINUTES_LIMITS = { min: 1, max: 240 } as const;

export function isRunning(machine: Pick<PolicyMachine, 'runEndsAt'>, now: number): boolean {
  return machine.runEndsAt !== null && machine.runEndsAt > now;
}

/** Whole minutes left, rounded up, so "1 min" shows until the run really ends. */
export function minutesLeft(machine: Pick<PolicyMachine, 'runEndsAt'>, now: number): number {
  return machine.runEndsAt === null ? 0 : Math.max(0, Math.ceil((machine.runEndsAt - now) / 60000));
}

/** When a run ends after a top-up: it extends a running dryer, or restarts a finished one. */
export function endAfterTopUp(machine: Pick<PolicyMachine, 'runEndsAt'>, now: number): number {
  return Math.max(machine.runEndsAt ?? now, now) + TOP_UP_MINUTES * 60000;
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
  | 'machine-running'
  | 'allowance-used'
  | 'not-assigned'
  | 'not-a-dryer'
  | 'no-top-up-price'
  | 'no-run';

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

function runningProblem(machine: PolicyMachine, now: number): MachineDecision | null {
  if (!isRunning(machine, now)) return null;
  const left = minutesLeft(machine, now);
  return deny(
    'machine-running',
    `${machine.name} is still running${machine.runOrderId ? ` ${machine.runOrderId}` : ''} ` +
      `(${left} min left). Wait for it, or tap Mark as done if it already finished.`,
  );
}

export interface AssignCheck {
  order: PolicyOrder | null;
  machine: PolicyMachine;
  /**
   * Machines of this type already counted against the order: confirmed starts, starts still
   * waiting for an answer or never answered, and other machines it is assigned to right now.
   */
  usedOfType: number;
  now: number;
}

export function decideAssignment(check: AssignCheck): MachineDecision {
  const { order, machine } = check;
  if (order === null) return NO_ORDER;
  const problem = orderProblem(order);
  if (problem) return problem;
  if (!machine.enabled) return deny('machine-disabled', `${machine.name} is switched off in settings.`);
  const running = runningProblem(machine, check.now);
  if (running) return running;
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
export function decideStart(machine: PolicyMachine, order: PolicyOrder | null, now: number): MachineDecision {
  if (machine.assignedOrderId === null) {
    return deny('not-assigned', `Assign an order to ${machine.name} before starting it.`);
  }
  if (order === null) return NO_ORDER;
  const problem = orderProblem(order);
  if (problem) return problem;
  if (!machine.enabled) return deny('machine-disabled', `${machine.name} is switched off in settings.`);
  return runningProblem(machine, now) ?? { allowed: true };
}

/**
 * A dryer top-up goes to the order of the dryer's latest run, while that order is open. It works
 * during the run and after it ended (laundry found damp), until the dryer runs something else.
 */
export function decideTopUp(machine: PolicyMachine, order: PolicyOrder | null, price: number): MachineDecision {
  if (machine.type !== 'DRYER') return deny('not-a-dryer', 'Only dryers take top-ups.');
  if (!machine.enabled) return deny('machine-disabled', `${machine.name} is switched off in settings.`);
  if (price <= 0) {
    return deny('no-top-up-price', `Top-ups on ${machine.name} have no price yet. The owner sets it in Manage, Machines.`);
  }
  if (machine.runOrderId === null) return deny('no-run', `${machine.name} has not dried an order yet.`);
  if (order === null) return NO_ORDER;
  return orderProblem(order) ?? { allowed: true };
}
