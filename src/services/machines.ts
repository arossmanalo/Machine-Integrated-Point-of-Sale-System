import { and, asc, desc, eq, gte, inArray, lt, ne, or, sql } from 'drizzle-orm';

import { can } from '@/domain/permissions';
import {
  decideAssignment,
  decideStart,
  decideTopUp,
  endAfterTopUp,
  isRunning,
  MACHINE_TYPES,
  RUN_MINUTES_LIMITS,
  TOP_UP_MINUTES,
  type MachineType,
  type PolicyOrder,
} from '@/domain/machinePolicy';
import { formatPeso } from '@/domain/money';
import { isValidChannel, MAX_CHANNEL, MIN_KEY_LENGTH, normalizeAddress, pulsesProblem } from '@/machines/protocol';
import type { MachineController, PulseSettings, StartResult } from '@/machines/MachineController';
import {
  machines,
  machineUnlocks,
  orderItems,
  orders,
  type MachineRow,
  type MachineUnlockRow,
  type OrderRow,
  type UnlockKind,
  type UnlockResultCode,
} from '@/db/schema';
import { UserFacingError, type Actor, type Db, type ServiceContext } from '@/db/types';

import { checkOwnerPin } from './auth';
import { setSetting } from './settings';

/** A pending row younger than this still holds its allowance (the reply may be on its way). */
const PENDING_HOLD_MS = 30 * 1000;

export const OVERRIDE_REASONS = ['Rewash', 'Machine did not start', 'Maintenance', 'Other'] as const;
export type OverrideReason = (typeof OVERRIDE_REASONS)[number];

const RESULT_CODES: Record<StartResult, UnlockResultCode> = {
  acked: 'ACKED',
  rejected: 'REJECTED',
  busy: 'BUSY',
  failed: 'FAILED',
  timeout: 'TIMEOUT',
  'not-connected': 'NOT_CONNECTED',
};

/** Results that mean no pulse went out, so the order's assignment can be given back. */
const NOTHING_SENT: readonly StartResult[] = ['rejected', 'busy', 'failed', 'not-connected'];

export const RESULT_MESSAGES: Record<StartResult, string> = {
  acked: 'Started.',
  rejected: 'The machine controller refused the start. Check the channel, pulse settings and key in Manage.',
  busy: 'This machine is still receiving the pulses of the last start. Wait a moment and try again.',
  failed: 'The machine controller did not get the start, so nothing happened. Try again.',
  timeout:
    'The machine controller did not answer, so the machine may or may not have started. Check the machine; ' +
    'if it did not start, ask the owner for an override.',
  'not-connected': 'Cannot reach the machine controller. Check that it has power and is on the shop Wi-Fi.',
};

export function pulsesOf(machine: MachineRow): PulseSettings {
  return { count: machine.pulseCount, onMs: machine.pulseOnMs, offMs: machine.pulseOffMs };
}

/** A top-up uses the dryer's own pulse length and gap, with its own count. */
export function topUpPulsesOf(machine: MachineRow): PulseSettings {
  return { count: machine.topUpPulseCount, onMs: machine.pulseOnMs, offMs: machine.pulseOffMs };
}

/** Top-ups cost at most this much, to catch a price typed in centavos by mistake. */
const MAX_TOP_UP_PRICE = 100000;

// ---------- Machine list ----------

export interface MachineInput {
  name: string;
  type: MachineType;
  hardwareChannel: number;
  enabled: boolean;
  pulseCount: number;
  pulseOnMs: number;
  pulseOffMs: number;
  runMinutes: number;
  /** Checked for dryers only; washers keep whatever is stored. */
  topUpPulseCount: number;
  topUpPrice: number;
}

export function listMachines(ctx: ServiceContext): MachineRow[] {
  return ctx.db.select().from(machines).orderBy(asc(machines.sortOrder), asc(machines.id)).all();
}

function requireOwner(actor: Actor): void {
  if (!can.manageMachines(actor.role)) throw new UserFacingError('Only the owner can do this.');
}

function checkMachine(db: Db, input: MachineInput, editingId: number | null): MachineInput {
  const name = input.name.trim();
  if (!name) throw new UserFacingError('Give the machine a name, such as "Washer 1".');
  if (!MACHINE_TYPES.includes(input.type)) throw new UserFacingError('Pick washer or dryer.');
  if (!isValidChannel(input.hardwareChannel)) {
    throw new UserFacingError(`The channel must be a whole number from 1 to ${MAX_CHANNEL}.`);
  }
  const problem = pulsesProblem({ count: input.pulseCount, onMs: input.pulseOnMs, offMs: input.pulseOffMs });
  if (problem) throw new UserFacingError(problem);
  const { min, max } = RUN_MINUTES_LIMITS;
  if (!Number.isInteger(input.runMinutes) || input.runMinutes < min || input.runMinutes > max) {
    throw new UserFacingError(`Run time must be a whole number of minutes from ${min} to ${max}.`);
  }
  if (input.type === 'DRYER') {
    const topUpProblem = pulsesProblem({
      count: input.topUpPulseCount,
      onMs: input.pulseOnMs,
      offMs: input.pulseOffMs,
    });
    if (topUpProblem) throw new UserFacingError(`Top-up: ${topUpProblem}`);
    if (!Number.isInteger(input.topUpPrice) || input.topUpPrice < 0 || input.topUpPrice > MAX_TOP_UP_PRICE) {
      throw new UserFacingError(
        `The top-up price must be from ${formatPeso(0)} to ${formatPeso(MAX_TOP_UP_PRICE)}.`,
      );
    }
  }
  const clash = db
    .select()
    .from(machines)
    .where(
      editingId === null
        ? eq(machines.hardwareChannel, input.hardwareChannel)
        : and(eq(machines.hardwareChannel, input.hardwareChannel), ne(machines.id, editingId)),
    )
    .get();
  if (clash) throw new UserFacingError(`Channel ${input.hardwareChannel} is already used by ${clash.name}.`);
  return { ...input, name };
}

export function addMachine(ctx: ServiceContext, actor: Actor, input: MachineInput): number {
  requireOwner(actor);
  const values = checkMachine(ctx.db, input, null);
  const sortOrder = listMachines(ctx).length;
  const result = ctx.db.insert(machines).values({ ...values, sortOrder }).returning().get();
  return result.id;
}

export function updateMachine(ctx: ServiceContext, actor: Actor, id: number, input: MachineInput): void {
  requireOwner(actor);
  const values = checkMachine(ctx.db, input, id);
  // A machine switched off cannot run the order waiting on it.
  const release = values.enabled ? {} : { assignedOrderId: null, assignedAt: null, assignedByName: null };
  ctx.db.update(machines).set({ ...values, ...release }).where(eq(machines.id, id)).run();
}

/** Gives several machines the same start pulses (count, length and gap) in one step. */
export function applyPulsesToMachines(
  ctx: ServiceContext,
  actor: Actor,
  pulses: PulseSettings,
  machineIds: readonly number[],
): void {
  requireOwner(actor);
  const problem = pulsesProblem(pulses);
  if (problem) throw new UserFacingError(problem);
  if (machineIds.length === 0) return;
  ctx.db
    .update(machines)
    .set({ pulseCount: pulses.count, pulseOnMs: pulses.onMs, pulseOffMs: pulses.offMs })
    .where(inArray(machines.id, [...machineIds]))
    .run();
}

export interface LockControllerInput {
  address: string;
  key: string;
}

/** Where the ESP32 is on the shop Wi-Fi and the passphrase that signs every start. */
export function saveLockController(ctx: ServiceContext, actor: Actor, input: LockControllerInput): void {
  requireOwner(actor);
  if (normalizeAddress(input.address) === null) {
    throw new UserFacingError('Enter the address shown by the machine controller, such as 192.168.1.50.');
  }
  if (input.key.length < MIN_KEY_LENGTH) {
    throw new UserFacingError(`The key needs at least ${MIN_KEY_LENGTH} characters.`);
  }
  ctx.db.transaction((tx) => {
    setSetting(tx, 'lockControllerAddress', input.address.trim());
    setSetting(tx, 'lockControllerKey', input.key);
  });
}

function requireMachine(db: Db, id: number): MachineRow {
  const machine = db.select().from(machines).where(eq(machines.id, id)).get();
  if (!machine) throw new UserFacingError('That machine no longer exists.');
  return machine;
}

function policyOrder(order: OrderRow | undefined): PolicyOrder | null {
  if (!order) return null;
  return {
    id: order.id,
    service: order.service,
    loadCount: order.loadCount,
    status: order.status,
    voided: order.voidedAt !== null,
  };
}

// ---------- Allowance ----------

export interface MachineUsage {
  WASHER: number;
  DRYER: number;
}

/**
 * Machines counted against an order: starts that went through, starts still waiting for an
 * answer, starts never answered (fail closed: the machine may have run), and machines the order
 * is assigned to right now.
 */
export function machineUsage(ctx: ServiceContext, orderId: string): MachineUsage {
  const starts = ctx.db
    .select({ type: machineUnlocks.machineType })
    .from(machineUnlocks)
    .where(
      and(
        eq(machineUnlocks.orderId, orderId),
        eq(machineUnlocks.kind, 'ORDER'),
        or(
          eq(machineUnlocks.result, 'ACKED'),
          eq(machineUnlocks.result, 'TIMEOUT'),
          and(eq(machineUnlocks.result, 'PENDING'), gte(machineUnlocks.at, ctx.now() - PENDING_HOLD_MS)),
        ),
      ),
    )
    .all();
  const assigned = ctx.db
    .select({ type: machines.type })
    .from(machines)
    .where(eq(machines.assignedOrderId, orderId))
    .all();
  const all = [...starts, ...assigned];
  return {
    WASHER: all.filter((r) => r.type === 'WASHER').length,
    DRYER: all.filter((r) => r.type === 'DRYER').length,
  };
}

/** Machines waiting to run this order. */
export function machinesAssignedTo(ctx: ServiceContext, orderId: string): MachineRow[] {
  return ctx.db
    .select()
    .from(machines)
    .where(eq(machines.assignedOrderId, orderId))
    .orderBy(asc(machines.sortOrder), asc(machines.id))
    .all();
}

// ---------- Assigning ----------

/** Puts an order on a machine, if the order still has that machine type left. */
export function assignOrder(ctx: ServiceContext, actor: Actor, orderId: string, machineId: number): void {
  ctx.db.transaction((tx) => {
    const txCtx = { ...ctx, db: tx };
    const machine = requireMachine(tx, machineId);
    const order = tx.select().from(orders).where(eq(orders.id, orderId)).get();
    const decision = decideAssignment({
      order: policyOrder(order),
      machine,
      usedOfType: machineUsage(txCtx, orderId)[machine.type],
      now: ctx.now(),
    });
    if (!decision.allowed) throw new UserFacingError(decision.message);
    tx.update(machines)
      .set({ assignedOrderId: orderId, assignedAt: ctx.now(), assignedByName: actor.username })
      .where(eq(machines.id, machineId))
      .run();
  });
}

/** Takes the order off a machine before it starts, for example when it went to the wrong one. */
export function unassignMachine(ctx: ServiceContext, machineId: number): void {
  requireMachine(ctx.db, machineId);
  ctx.db
    .update(machines)
    .set({ assignedOrderId: null, assignedAt: null, assignedByName: null })
    .where(eq(machines.id, machineId))
    .run();
}

// ---------- Starting ----------

interface LogEntry {
  machine: MachineRow;
  actor: Actor;
  kind: UnlockKind;
  orderId: string | null;
  result: UnlockResultCode;
  overrideReason?: string | null;
  overrideNote?: string | null;
  charge?: number | null;
}

function writeLog(ctx: ServiceContext, entry: LogEntry): number {
  const row = ctx.db
    .insert(machineUnlocks)
    .values({
      at: ctx.now(),
      machineId: entry.machine.id,
      machineName: entry.machine.name,
      machineType: entry.machine.type,
      hardwareChannel: entry.machine.hardwareChannel,
      orderId: entry.orderId,
      employeeUserId: entry.actor.id,
      employeeName: entry.actor.username,
      kind: entry.kind,
      overrideReason: entry.overrideReason ?? null,
      overrideNote: entry.overrideNote ?? null,
      result: entry.result,
      resolvedAt: entry.result === 'PENDING' ? null : ctx.now(),
      charge: entry.charge ?? null,
    })
    .returning({ id: machineUnlocks.id })
    .get();
  return row.id;
}

/** Sends the start that was logged as PENDING, then records what the controller said. */
async function sendAndRecord(
  ctx: ServiceContext,
  controller: MachineController,
  logId: number,
  machine: MachineRow,
  pulses: PulseSettings = pulsesOf(machine),
): Promise<StartResult> {
  let result: StartResult;
  try {
    result = await controller.start(machine.hardwareChannel, pulses);
  } catch {
    // Controllers report failures as results; an exception here means the link broke mid-send.
    result = 'timeout';
  }
  ctx.db
    .update(machineUnlocks)
    .set({ result: RESULT_CODES[result], resolvedAt: ctx.now() })
    .where(eq(machineUnlocks.id, logId))
    .run();
  return result;
}

function isReady(controller: MachineController): boolean {
  return controller.state().status === 'ready';
}

/** In use from now for the machine's run time, for this order (null for an override without one). */
function runFields(machine: MachineRow, orderId: string | null, now: number) {
  return { runOrderId: orderId, runEndsAt: now + machine.runMinutes * 60000 };
}

/** Puts back the run that a start replaced, when the start sent nothing. */
function restoreRun(db: Db, machine: MachineRow): void {
  db.update(machines)
    .set({ runOrderId: machine.runOrderId, runEndsAt: machine.runEndsAt })
    .where(eq(machines.id, machine.id))
    .run();
}

/**
 * Starts a machine for the order assigned to it. The assignment is taken off the machine in the
 * same step that logs the start, so tapping Start twice cannot send two starts. It goes back
 * on the machine only when nothing was sent.
 */
export async function startMachine(
  ctx: ServiceContext,
  controller: MachineController,
  actor: Actor,
  machineId: number,
): Promise<StartResult> {
  if (!isReady(controller)) return 'not-connected';
  const claimed = ctx.db.transaction((tx) => {
    const machine = requireMachine(tx, machineId);
    const order =
      machine.assignedOrderId === null
        ? undefined
        : tx.select().from(orders).where(eq(orders.id, machine.assignedOrderId)).get();
    const decision = decideStart(machine, policyOrder(order), ctx.now());
    if (!decision.allowed || machine.assignedOrderId === null) {
      throw new UserFacingError(decision.allowed ? 'Assign an order first.' : decision.message);
    }
    tx.update(machines)
      .set({
        assignedOrderId: null,
        assignedAt: null,
        assignedByName: null,
        ...runFields(machine, machine.assignedOrderId, ctx.now()),
      })
      .where(eq(machines.id, machineId))
      .run();
    const logId = writeLog(
      { ...ctx, db: tx },
      { machine, actor, kind: 'ORDER', orderId: machine.assignedOrderId, result: 'PENDING' },
    );
    return { machine, logId };
  });
  const result = await sendAndRecord(ctx, controller, claimed.logId, claimed.machine);
  if (NOTHING_SENT.includes(result)) {
    // Nothing started, so the order goes back on the machine, unless someone reassigned it since.
    restoreRun(ctx.db, claimed.machine);
    ctx.db
      .update(machines)
      .set({
        assignedOrderId: claimed.machine.assignedOrderId,
        assignedAt: claimed.machine.assignedAt,
        assignedByName: claimed.machine.assignedByName,
      })
      .where(and(eq(machines.id, machineId), eq(machines.enabled, true)))
      .run();
  }
  return result;
}

/**
 * Assigning an order to a machine starts it straight away. If the start sends nothing (offline,
 * busy, refused), the order stays on the machine so Start machine on the Machines tab can retry.
 */
export async function startOrderOnMachine(
  ctx: ServiceContext,
  controller: MachineController,
  actor: Actor,
  orderId: string,
  machineId: number,
): Promise<StartResult> {
  const machine = requireMachine(ctx.db, machineId);
  if (machine.assignedOrderId !== orderId) {
    ctx.db.transaction((tx) => {
      // A start that sent nothing left the order waiting on another machine; staff chose this one instead.
      tx.update(machines)
        .set({ assignedOrderId: null, assignedAt: null, assignedByName: null })
        .where(
          and(eq(machines.assignedOrderId, orderId), eq(machines.type, machine.type), ne(machines.id, machineId)),
        )
        .run();
      assignOrder({ ...ctx, db: tx }, actor, orderId, machineId);
    });
  }
  return startMachine(ctx, controller, actor, machineId);
}

/**
 * Adds TOP_UP_MINUTES to a dryer for the order of its latest run, sends the dryer's top-up
 * pulses and puts the charge on that order's bill. The charge comes off again if nothing was sent.
 */
export async function topUpDryer(
  ctx: ServiceContext,
  controller: MachineController,
  actor: Actor,
  machineId: number,
): Promise<StartResult> {
  if (!isReady(controller)) return 'not-connected';
  const claimed = ctx.db.transaction((tx) => {
    const machine = requireMachine(tx, machineId);
    const order =
      machine.runOrderId === null
        ? undefined
        : tx.select().from(orders).where(eq(orders.id, machine.runOrderId)).get();
    const decision = decideTopUp(machine, policyOrder(order), machine.topUpPrice);
    if (!decision.allowed || !order) {
      throw new UserFacingError(decision.allowed ? 'There is no order to top up.' : decision.message);
    }
    const price = machine.topUpPrice;
    const item = tx
      .insert(orderItems)
      .values({
        orderId: order.id,
        inventoryItemId: null,
        name: `Dryer top-up ${TOP_UP_MINUTES} min (${machine.name})`,
        quantity: 1,
        unitPrice: price,
      })
      .returning({ id: orderItems.id })
      .get();
    tx.update(orders)
      .set({ total: sql`${orders.total} + ${price}` })
      .where(eq(orders.id, order.id))
      .run();
    tx.update(machines)
      .set({ runEndsAt: endAfterTopUp(machine, ctx.now()) })
      .where(eq(machines.id, machineId))
      .run();
    const logId = writeLog(
      { ...ctx, db: tx },
      { machine, actor, kind: 'TOP_UP', orderId: order.id, result: 'PENDING', charge: price },
    );
    return { machine, logId, itemId: item.id, orderId: order.id, price };
  });
  const result = await sendAndRecord(
    ctx,
    controller,
    claimed.logId,
    claimed.machine,
    topUpPulsesOf(claimed.machine),
  );
  if (NOTHING_SENT.includes(result)) {
    ctx.db.transaction((tx) => {
      tx.delete(orderItems).where(eq(orderItems.id, claimed.itemId)).run();
      tx.update(orders)
        .set({ total: sql`${orders.total} - ${claimed.price}` })
        .where(eq(orders.id, claimed.orderId))
        .run();
      tx.update(machineUnlocks).set({ charge: null }).where(eq(machineUnlocks.id, claimed.logId)).run();
      restoreRun(tx, claimed.machine);
    });
  }
  return result;
}

/** Ends the timer early, for a machine that finished before its set run time. */
export function markRunDone(ctx: ServiceContext, machineId: number): void {
  const machine = requireMachine(ctx.db, machineId);
  if (!isRunning(machine, ctx.now())) return;
  ctx.db.update(machines).set({ runEndsAt: ctx.now() }).where(eq(machines.id, machineId)).run();
}

export interface OverrideInput {
  machineId: number;
  pin: string;
  reason: OverrideReason;
  note: string;
  orderId: string | null;
}

/** Owner-PIN start outside an order's allowance. Wrong PINs are logged too. */
export async function overrideStart(
  ctx: ServiceContext,
  controller: MachineController,
  actor: Actor,
  input: OverrideInput,
): Promise<StartResult> {
  const machine = requireMachine(ctx.db, input.machineId);
  const note = input.note.trim();
  if (input.reason === 'Other' && !note) throw new UserFacingError('Describe the reason for the override.');
  const pin = await checkOwnerPin(ctx, input.pin);
  const base = {
    machine,
    actor,
    orderId: input.orderId,
    overrideReason: input.reason,
    overrideNote: note || null,
  };
  if (pin !== 'ok') {
    writeLog(ctx, { ...base, kind: 'OVERRIDE_DENIED', result: 'DENIED' });
    if (pin === 'not-set') throw new UserFacingError('No owner PIN is set. The owner must set one first.');
    if (pin === 'locked') throw new UserFacingError('Too many wrong PINs. Overrides are locked for 5 minutes.');
    throw new UserFacingError('Wrong owner PIN.');
  }
  const ready = isReady(controller);
  const logId = writeLog(ctx, { ...base, kind: 'OVERRIDE', result: ready ? 'PENDING' : 'NOT_CONNECTED' });
  if (!ready) return 'not-connected';
  ctx.db
    .update(machines)
    .set(runFields(machine, input.orderId, ctx.now()))
    .where(eq(machines.id, machine.id))
    .run();
  const result = await sendAndRecord(ctx, controller, logId, machine);
  if (NOTHING_SENT.includes(result)) restoreRun(ctx.db, machine);
  return result;
}

/** Owner test start from the machine settings or the Machines tab, logged as TEST. */
export async function testStart(
  ctx: ServiceContext,
  controller: MachineController,
  actor: Actor,
  machineId: number,
): Promise<StartResult> {
  requireOwner(actor);
  const machine = requireMachine(ctx.db, machineId);
  const ready = isReady(controller);
  const logId = writeLog(ctx, {
    machine,
    actor,
    kind: 'TEST',
    orderId: null,
    result: ready ? 'PENDING' : 'NOT_CONNECTED',
  });
  if (!ready) return 'not-connected';
  return sendAndRecord(ctx, controller, logId, machine);
}

// ---------- Log ----------

export function listMachineLog(ctx: ServiceContext, range: { start: number; end: number }): MachineUnlockRow[] {
  return ctx.db
    .select()
    .from(machineUnlocks)
    .where(and(gte(machineUnlocks.at, range.start), lt(machineUnlocks.at, range.end)))
    .orderBy(desc(machineUnlocks.id))
    .all();
}

/** Last start that went through, per machine, for the machine grid. */
export function lastStarts(ctx: ServiceContext, machineIds: number[]): Map<number, MachineUnlockRow> {
  const result = new Map<number, MachineUnlockRow>();
  if (machineIds.length === 0) return result;
  const rows = ctx.db
    .select()
    .from(machineUnlocks)
    .where(and(inArray(machineUnlocks.machineId, machineIds), eq(machineUnlocks.result, 'ACKED')))
    .orderBy(desc(machineUnlocks.id))
    .all();
  for (const row of rows) {
    if (row.machineId !== null && !result.has(row.machineId)) result.set(row.machineId, row);
  }
  return result;
}
