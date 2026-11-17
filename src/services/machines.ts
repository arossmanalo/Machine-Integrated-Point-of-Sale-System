import { and, asc, desc, eq, gte, inArray, lt, ne, or } from 'drizzle-orm';

import { can } from '@/domain/permissions';
import { decideOrderUnlock, MACHINE_TYPES, type MachineType } from '@/domain/unlockPolicy';
import { isValidChannel, MAX_CHANNEL } from '@/machines/protocol';
import type { MachineController, UnlockResult } from '@/machines/MachineController';
import {
  machines,
  machineUnlocks,
  orders,
  type MachineRow,
  type MachineUnlockRow,
  type UnlockKind,
  type UnlockResultCode,
} from '@/db/schema';
import { UserFacingError, type Actor, type Db, type ServiceContext } from '@/db/types';

import { checkOwnerPin } from './auth';

/** A pending row younger than this still holds its allowance (the reply may be on its way). */
const PENDING_HOLD_MS = 30 * 1000;

export const OVERRIDE_REASONS = ['Rewash', 'Stuck door', 'Maintenance', 'Other'] as const;
export type OverrideReason = (typeof OVERRIDE_REASONS)[number];

const RESULT_CODES: Record<UnlockResult, UnlockResultCode> = {
  acked: 'ACKED',
  rejected: 'REJECTED',
  timeout: 'TIMEOUT',
  'not-connected': 'NOT_CONNECTED',
};

export const RESULT_MESSAGES: Record<UnlockResult, string> = {
  acked: 'Door unlocked.',
  rejected: 'The lock controller refused the command. Check the machine channel in Settings.',
  timeout: 'The lock controller did not answer. Check the cable and try again.',
  'not-connected': 'The lock controller is not connected. Check the USB cable.',
};

// ---------- Machine list ----------

export interface MachineInput {
  name: string;
  type: MachineType;
  hardwareChannel: number;
  enabled: boolean;
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
    throw new UserFacingError(`The lock channel must be a whole number from 1 to ${MAX_CHANNEL}.`);
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
  ctx.db.update(machines).set(values).where(eq(machines.id, id)).run();
}

function requireMachine(db: Db, id: number): MachineRow {
  const machine = db.select().from(machines).where(eq(machines.id, id)).get();
  if (!machine) throw new UserFacingError('That machine no longer exists.');
  return machine;
}

// ---------- Allowance ----------

export interface UnlockUsage {
  WASHER: number;
  DRYER: number;
}

/** Unlocks counted against an order: confirmed ones, plus very recent ones still waiting. */
export function unlockUsage(ctx: ServiceContext, orderId: string): UnlockUsage {
  const rows = ctx.db
    .select()
    .from(machineUnlocks)
    .where(
      and(
        eq(machineUnlocks.orderId, orderId),
        eq(machineUnlocks.kind, 'ORDER'),
        or(
          eq(machineUnlocks.result, 'ACKED'),
          and(eq(machineUnlocks.result, 'PENDING'), gte(machineUnlocks.at, ctx.now() - PENDING_HOLD_MS)),
        ),
      ),
    )
    .all();
  return {
    WASHER: rows.filter((r) => r.machineType === 'WASHER').length,
    DRYER: rows.filter((r) => r.machineType === 'DRYER').length,
  };
}

// ---------- Unlocking ----------

interface LogEntry {
  machine: MachineRow;
  actor: Actor;
  kind: UnlockKind;
  orderId: string | null;
  result: UnlockResultCode;
  overrideReason?: string | null;
  overrideNote?: string | null;
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
    })
    .returning({ id: machineUnlocks.id })
    .get();
  return row.id;
}

/** Logs first, then sends, then records what the Arduino said. */
async function sendAndRecord(
  ctx: ServiceContext,
  controller: MachineController,
  logId: number,
  channel: number,
): Promise<UnlockResult> {
  let result: UnlockResult;
  try {
    result = await controller.unlock(channel);
  } catch {
    // Controllers report failures as results; an exception here means the link broke mid-send.
    result = 'not-connected';
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

/** Unlocks a machine for an order, if the order still has allowance for that machine type. */
export async function unlockForOrder(
  ctx: ServiceContext,
  controller: MachineController,
  actor: Actor,
  orderId: string,
  machineId: number,
): Promise<UnlockResult> {
  const ready = isReady(controller);
  const prepared = ctx.db.transaction((tx) => {
    const txCtx = { ...ctx, db: tx };
    const machine = requireMachine(tx, machineId);
    const order = tx.select().from(orders).where(eq(orders.id, orderId)).get();
    const usage = unlockUsage(txCtx, orderId);
    const decision = decideOrderUnlock({
      order: order
        ? {
            service: order.service,
            loadCount: order.loadCount,
            status: order.status,
            voided: order.voidedAt !== null,
          }
        : null,
      machine,
      usedOfType: usage[machine.type],
      controllerReady: true,
    });
    if (!decision.allowed) throw new UserFacingError(decision.message);
    const logId = writeLog(txCtx, {
      machine,
      actor,
      kind: 'ORDER',
      orderId,
      result: ready ? 'PENDING' : 'NOT_CONNECTED',
    });
    return { logId, channel: machine.hardwareChannel };
  });
  if (!ready) return 'not-connected';
  return sendAndRecord(ctx, controller, prepared.logId, prepared.channel);
}

export interface OverrideInput {
  machineId: number;
  pin: string;
  reason: OverrideReason;
  note: string;
  orderId: string | null;
}

/** Owner-PIN unlock outside an order's allowance. Wrong PINs are logged too. */
export async function overrideUnlock(
  ctx: ServiceContext,
  controller: MachineController,
  actor: Actor,
  input: OverrideInput,
): Promise<UnlockResult> {
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
  return sendAndRecord(ctx, controller, logId, machine.hardwareChannel);
}

/** Owner test pulse from Settings, logged as TEST. */
export async function testPulse(
  ctx: ServiceContext,
  controller: MachineController,
  actor: Actor,
  machineId: number,
): Promise<UnlockResult> {
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
  return sendAndRecord(ctx, controller, logId, machine.hardwareChannel);
}

// ---------- Log ----------

export function listUnlocks(ctx: ServiceContext, range: { start: number; end: number }): MachineUnlockRow[] {
  return ctx.db
    .select()
    .from(machineUnlocks)
    .where(and(gte(machineUnlocks.at, range.start), lt(machineUnlocks.at, range.end)))
    .orderBy(desc(machineUnlocks.id))
    .all();
}

/** Last confirmed unlock per machine, for the machine grid. */
export function lastUnlocks(ctx: ServiceContext, machineIds: number[]): Map<number, MachineUnlockRow> {
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
