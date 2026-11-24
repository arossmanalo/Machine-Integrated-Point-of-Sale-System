import { and, asc, eq, inArray } from 'drizzle-orm';

import { cycleNameProblem, DEFAULT_CYCLE_NAMES, needsCyclePick } from '@/domain/cycles';
import { RUN_MINUTES_LIMITS } from '@/domain/machinePolicy';
import { can } from '@/domain/permissions';
import { pulsesProblem } from '@/machines/protocol';
import { machineCycles, machines, type MachineCycleRow, type MachineRow } from '@/db/schema';
import { UserFacingError, type Actor, type Db, type ServiceContext } from '@/db/types';

import { getSetting } from './settings';

export interface CycleInput {
  name: string;
  pulses: number;
  minutes: number;
}

export interface CycleEdit extends CycleInput {
  id: number;
  enabled: boolean;
}

function requireDeveloper(actor: Actor): void {
  if (!can.manageMachines(actor.role)) throw new UserFacingError('Machine setup is managed by support.');
}

/** Every machine's cycles, in the order they are shown. */
export function listCycles(ctx: ServiceContext): MachineCycleRow[] {
  return ctx.db
    .select()
    .from(machineCycles)
    .orderBy(asc(machineCycles.machineId), asc(machineCycles.sortOrder), asc(machineCycles.id))
    .all();
}

export function enabledCyclesOf(db: Db, machineId: number): MachineCycleRow[] {
  return db
    .select()
    .from(machineCycles)
    .where(and(eq(machineCycles.machineId, machineId), eq(machineCycles.enabled, true)))
    .orderBy(asc(machineCycles.sortOrder), asc(machineCycles.id))
    .all();
}

/** The one rule for "this machine asks for a cycle", used by every start and test. */
export function machineUsesCycles(db: Db, machine: Pick<MachineRow, 'id' | 'type'>): boolean {
  return needsCyclePick(getSetting(db, 'multiCycle'), machine.type, enabledCyclesOf(db, machine.id).length);
}

/** A cycle that may run on this machine now: it belongs to the machine and is switched on. */
export function requireCycle(db: Db, machine: Pick<MachineRow, 'id' | 'name'>, cycleId: number): MachineCycleRow {
  const cycle = db.select().from(machineCycles).where(eq(machineCycles.id, cycleId)).get();
  if (!cycle || cycle.machineId !== machine.id) {
    throw new UserFacingError(`That cycle is not on ${machine.name}. Pick one of its cycles.`);
  }
  if (!cycle.enabled) throw new UserFacingError(`The ${cycle.name} cycle on ${machine.name} is switched off.`);
  return cycle;
}

function cycleProblem(machine: Pick<MachineRow, 'pulseOnMs' | 'pulseOffMs'>, input: CycleInput): string | null {
  const nameProblem = cycleNameProblem(input.name);
  if (nameProblem) return nameProblem;
  const problem = pulsesProblem({ count: input.pulses, onMs: machine.pulseOnMs, offMs: machine.pulseOffMs });
  if (problem) return problem;
  const { min, max } = RUN_MINUTES_LIMITS;
  if (!Number.isInteger(input.minutes) || input.minutes < min || input.minutes > max) {
    return `Run time must be a whole number of minutes from ${min} to ${max}.`;
  }
  return null;
}

function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** A new washer's four starting cycles, each with its own pulses and run time to begin with. */
export function addDefaultCycles(db: Db, machine: Pick<MachineRow, 'id' | 'type' | 'pulseCount' | 'runMinutes'>): void {
  if (machine.type !== 'WASHER') return;
  DEFAULT_CYCLE_NAMES.forEach((name, sortOrder) => {
    db.insert(machineCycles)
      .values({ machineId: machine.id, name, pulses: machine.pulseCount, minutes: machine.runMinutes, sortOrder })
      .run();
  });
}

/**
 * Owner only: adds a cycle to one or more washers in one step. Nothing is added unless it fits
 * every washer picked (pulse limits with each washer's pulse length, no duplicate name).
 */
export function addCycle(ctx: ServiceContext, actor: Actor, input: CycleInput, machineIds: readonly number[]): void {
  requireDeveloper(actor);
  if (machineIds.length === 0) throw new UserFacingError('Pick at least one washer for the new cycle.');
  ctx.db.transaction((tx) => {
    const targets = tx.select().from(machines).where(inArray(machines.id, [...machineIds])).all();
    if (targets.length !== new Set(machineIds).size) throw new UserFacingError('One of those machines no longer exists.');
    for (const machine of targets) {
      if (machine.type !== 'WASHER') throw new UserFacingError(`${machine.name} is a dryer. Cycles are for washers.`);
      const problem = cycleProblem(machine, input);
      if (problem) throw new UserFacingError(`${machine.name}: ${problem}`);
      const existing = tx.select().from(machineCycles).where(eq(machineCycles.machineId, machine.id)).all();
      if (existing.some((cycle) => sameName(cycle.name, input.name))) {
        throw new UserFacingError(`${machine.name} already has a cycle called ${input.name.trim()}.`);
      }
      const sortOrder = existing.reduce((max, cycle) => Math.max(max, cycle.sortOrder + 1), 0);
      tx.insert(machineCycles)
        .values({ machineId: machine.id, name: input.name.trim(), pulses: input.pulses, minutes: input.minutes, sortOrder })
        .run();
    }
  });
}

/** Owner only: saves a washer's cycles as edited in its settings (names, pulses, minutes, on/off). */
export function updateCycles(ctx: ServiceContext, actor: Actor, machineId: number, edits: readonly CycleEdit[]): void {
  requireDeveloper(actor);
  ctx.db.transaction((tx) => {
    const machine = tx.select().from(machines).where(eq(machines.id, machineId)).get();
    if (!machine) throw new UserFacingError('That machine no longer exists.');
    const own = tx.select().from(machineCycles).where(eq(machineCycles.machineId, machineId)).all();
    for (const edit of edits) {
      if (!own.some((cycle) => cycle.id === edit.id)) throw new UserFacingError(`That cycle is not on ${machine.name}.`);
      const problem = cycleProblem(machine, edit);
      if (problem) throw new UserFacingError(`${edit.name.trim() || 'A cycle'}: ${problem}`);
      if (edits.some((other) => other.id !== edit.id && sameName(other.name, edit.name))) {
        throw new UserFacingError(`${machine.name} has two cycles called ${edit.name.trim()}.`);
      }
    }
    for (const edit of edits) {
      tx.update(machineCycles)
        .set({ name: edit.name.trim(), pulses: edit.pulses, minutes: edit.minutes, enabled: edit.enabled })
        .where(eq(machineCycles.id, edit.id))
        .run();
    }
  });
}
