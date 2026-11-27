import { CURRENT_SERVICE, DRY_ONLY_SERVICE } from './pricing';
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
  /** Real-time sync: when the machine's running signal came on, while it is on. */
  signalSince: number | null;
  /** Real-time sync: coins sent at this time; the machine waits for staff to press Start. */
  awaitingStartAt: number | null;
}

/**
 * Dryer top-ups are types the developer sets up on each dryer (name, minutes, coins, price).
 * Every new dryer starts with these lengths; the shop's price list for top-ups taken with a new
 * order is kept by minutes, because the dryer is not known yet.
 */
export const DEFAULT_TOP_UP_MINUTES = [5, 10, 15, 20] as const;

/** Top-ups cost at most this much, to catch a price typed in centavos by mistake. */
export const MAX_TOP_UP_PRICE = 100000;

/** One price on the shop's list for top-ups taken with a new order. */
export interface ShopTopUpPrice {
  minutes: number;
  price: number;
}

export function shopPriceFor(list: readonly ShopTopUpPrice[], minutes: number): number {
  return list.find((entry) => entry.minutes === minutes)?.price ?? 0;
}

export const RUN_MINUTES_LIMITS = { min: 1, max: 240 } as const;

/**
 * In use while it waits for staff to press Start or its running signal is on (real-time sync), or
 * while its countdown has time left.
 */
export function isRunning(
  machine: Pick<PolicyMachine, 'runEndsAt' | 'signalSince' | 'awaitingStartAt'>,
  now: number,
): boolean {
  return (
    machine.awaitingStartAt !== null ||
    machine.signalSince !== null ||
    (machine.runEndsAt !== null && machine.runEndsAt > now)
  );
}

/** Whole minutes the machine has been running by its signal, rounded down. */
export function minutesRunning(machine: Pick<PolicyMachine, 'signalSince'>, now: number): number {
  return machine.signalSince === null ? 0 : Math.max(0, Math.floor((now - machine.signalSince) / 60000));
}

/** Whole minutes left, rounded up, so "1 min" shows until the run really ends. */
export function minutesLeft(machine: Pick<PolicyMachine, 'runEndsAt'>, now: number): number {
  return machine.runEndsAt === null ? 0 : Math.max(0, Math.ceil((machine.runEndsAt - now) / 60000));
}

/** When a run ends after a top-up: the extra minutes go on the end of the running dryer. */
export function endAfterTopUp(machine: Pick<PolicyMachine, 'runEndsAt'>, now: number, minutes: number): number {
  return Math.max(machine.runEndsAt ?? now, now) + minutes * 60000;
}

/**
 * Each load of Wash-Dry-Fold allows one washer start and one dryer start; a dry-only load allows
 * one dryer start and no washer. Orders imported from the old app with other services are history
 * and allow none. Payment is deliberately not a condition: pay-later orders run the same.
 */
export function machineAllowance(order: Pick<PolicyOrder, 'service' | 'loadCount'>, type: MachineType): number {
  if (order.service === CURRENT_SERVICE) return order.loadCount;
  if (order.service === DRY_ONLY_SERVICE) return type === 'DRYER' ? order.loadCount : 0;
  return 0;
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
  | 'no-run'
  | 'not-running'
  | 'washer-first';

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
  const running = `${machine.name} is still running${machine.runOrderId ? ` ${machine.runOrderId}` : ''}`;
  if (machine.awaitingStartAt !== null) {
    return deny(
      'machine-running',
      `${machine.name} has its coins${machine.runOrderId ? ` for ${machine.runOrderId}` : ''} and is waiting for ` +
        'someone to press Start on it. Start it, or tap Mark as done if it will not be used.',
    );
  }
  if (machine.signalSince !== null) {
    return deny('machine-running', `${running} (for ${minutesRunning(machine, now)} min). Wait for it to finish.`);
  }
  return deny(
    'machine-running',
    `${running} (${minutesLeft(machine, now)} min left). Wait for it, or tap Mark as done if it already finished.`,
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
  /** Loads of the order whose wash is over (started, and that washer is no longer counting down). */
  washedLoads: number;
  /** Loads of the order still in a washer right now. */
  washingLoads: number;
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
  const allowance = machineAllowance(order, machine.type);
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
  // A load is washed before it is dried, so a receipt cannot run a dryer ahead of its wash.
  if (machine.type === 'DRYER' && order.service === CURRENT_SERVICE && check.usedOfType >= check.washedLoads) {
    const load = check.usedOfType + 1;
    return deny(
      'washer-first',
      check.usedOfType < check.washedLoads + check.washingLoads
        ? `Load ${load} of ${order.id} is still in the washer. Wait until it is done, or tap Mark as done on the washer.`
        : `Run a washer for ${order.id} first: load ${load} has not been washed yet.`,
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
/**
 * A dryer can be topped up only while it is still drying an order: once its timer runs out or
 * staff mark it as done, the top-up is gone. `price` is the price of the chosen top-up.
 */
export function decideTopUp(
  machine: PolicyMachine,
  order: PolicyOrder | null,
  price: number,
  now: number,
): MachineDecision {
  if (machine.type !== 'DRYER') return deny('not-a-dryer', 'Only dryers take top-ups.');
  if (!machine.enabled) return deny('machine-disabled', `${machine.name} is switched off in settings.`);
  if (price <= 0) {
    return deny('no-top-up-price', `That top-up on ${machine.name} has no price. The owner sets it in Manage, Machines.`);
  }
  if (!isRunning(machine, now)) {
    return deny('not-running', `${machine.name} is not running. Top-ups can only be added while it dries.`);
  }
  if (machine.runOrderId === null) return deny('no-run', `${machine.name} is not drying an order.`);
  if (order === null) return NO_ORDER;
  return orderProblem(order) ?? { allowed: true };
}
