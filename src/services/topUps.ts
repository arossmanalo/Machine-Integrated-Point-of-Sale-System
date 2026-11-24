import { and, asc, eq, inArray } from 'drizzle-orm';

import {
  DEFAULT_TOP_UP_MINUTES,
  MAX_TOP_UP_PRICE,
  RUN_MINUTES_LIMITS,
  shopPriceFor,
  type ShopTopUpPrice,
} from '@/domain/machinePolicy';
import { formatPeso } from '@/domain/money';
import { can } from '@/domain/permissions';
import { PULSE_LIMITS, pulsesProblem } from '@/machines/protocol';
import { dryerTopUps, machines, type DryerTopUpRow, type MachineRow } from '@/db/schema';
import { UserFacingError, type Actor, type Db, type ServiceContext } from '@/db/types';

import { getSetting, setSetting } from './settings';

export interface TopUpInput {
  name: string;
  minutes: number;
  pulses: number;
  price: number;
}

export interface TopUpEdit extends TopUpInput {
  id: number;
  enabled: boolean;
}

const NAME_MAX_LENGTH = 30;

function requireDeveloper(actor: Actor): void {
  if (!can.manageMachines(actor.role)) throw new UserFacingError('Machine setup is managed by support.');
}

/** Every dryer's top-up types, in the order they are shown. */
export function listTopUps(ctx: ServiceContext): DryerTopUpRow[] {
  return allTopUps(ctx.db);
}

function allTopUps(db: Db): DryerTopUpRow[] {
  return db
    .select()
    .from(dryerTopUps)
    .orderBy(asc(dryerTopUps.machineId), asc(dryerTopUps.sortOrder), asc(dryerTopUps.id))
    .all();
}

/** The top-ups staff are offered on this dryer. */
export function offeredTopUpsOf(db: Db, machineId: number): DryerTopUpRow[] {
  return db
    .select()
    .from(dryerTopUps)
    .where(and(eq(dryerTopUps.machineId, machineId), eq(dryerTopUps.enabled, true)))
    .orderBy(asc(dryerTopUps.sortOrder), asc(dryerTopUps.id))
    .all();
}

/** A top-up that may be added on this dryer now: it belongs to the dryer and is offered. */
export function requireTopUp(db: Db, machine: Pick<MachineRow, 'id' | 'name'>, topUpId: number): DryerTopUpRow {
  const topUp = db.select().from(dryerTopUps).where(eq(dryerTopUps.id, topUpId)).get();
  if (!topUp || topUp.machineId !== machine.id) {
    throw new UserFacingError(`That top-up is not on ${machine.name}. Pick one of its top-ups.`);
  }
  if (!topUp.enabled) throw new UserFacingError(`The ${topUp.name} top-up on ${machine.name} is switched off.`);
  return topUp;
}

/** The dryer's offered top-up of this length, for a top-up paid with the order. */
export function offeredTopUpWithMinutes(db: Db, machineId: number, minutes: number): DryerTopUpRow | null {
  return offeredTopUpsOf(db, machineId).find((topUp) => topUp.minutes === minutes) ?? null;
}

/** Problems with one top-up type, checked against the dryer's pulse length and gap. */
export function topUpProblem(
  machine: Pick<MachineRow, 'pulseOnMs' | 'pulseOffMs'>,
  input: TopUpInput & { enabled: boolean },
): string | null {
  const name = input.name.trim();
  if (!name) return 'Give the top-up a name, such as "Extra dry".';
  if (name.length > NAME_MAX_LENGTH) return `Keep the top-up name under ${NAME_MAX_LENGTH} characters.`;
  const { min, max } = RUN_MINUTES_LIMITS;
  if (!Number.isInteger(input.minutes) || input.minutes < min || input.minutes > max) {
    return `Minutes must be a whole number from ${min} to ${max}.`;
  }
  if (!Number.isInteger(input.pulses) || input.pulses < 1 || input.pulses > PULSE_LIMITS.maxCount) {
    return `Coins must be from 1 to ${PULSE_LIMITS.maxCount}.`;
  }
  const problem = pulsesProblem({ count: input.pulses, onMs: machine.pulseOnMs, offMs: machine.pulseOffMs });
  if (problem) return problem;
  if (!Number.isInteger(input.price) || input.price < 0 || input.price > MAX_TOP_UP_PRICE) {
    return `The price must be from ${formatPeso(0)} to ${formatPeso(MAX_TOP_UP_PRICE)}.`;
  }
  if (input.enabled && input.price === 0) return 'An offered top-up needs a price. Untick it or enter a price.';
  return null;
}

function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** A new dryer's starting top-ups: 5, 10, 15 and 20 minutes at the shop's prices. */
export function addDefaultTopUps(db: Db, machine: Pick<MachineRow, 'id' | 'type' | 'pulseCount'>): void {
  if (machine.type !== 'DRYER') return;
  const shop = getSetting(db, 'shopTopUps');
  DEFAULT_TOP_UP_MINUTES.forEach((minutes, sortOrder) => {
    const price = shopPriceFor(shop, minutes);
    db.insert(dryerTopUps)
      .values({
        machineId: machine.id,
        name: `${minutes} min`,
        minutes,
        pulses: Math.min(machine.pulseCount * (sortOrder + 1), PULSE_LIMITS.maxCount),
        price,
        enabled: price > 0,
        sortOrder,
      })
      .run();
  });
}

/**
 * Developer only: adds a top-up type to one or more dryers in one step. Nothing is added unless it
 * fits every dryer picked (coin limits with each dryer's pulse length, no duplicate name).
 */
export function addTopUp(ctx: ServiceContext, actor: Actor, input: TopUpInput, machineIds: readonly number[]): void {
  requireDeveloper(actor);
  if (machineIds.length === 0) throw new UserFacingError('Pick at least one dryer for the new top-up.');
  ctx.db.transaction((tx) => {
    const targets = tx.select().from(machines).where(inArray(machines.id, [...machineIds])).all();
    if (targets.length !== new Set(machineIds).size) throw new UserFacingError('One of those machines no longer exists.');
    for (const machine of targets) {
      if (machine.type !== 'DRYER') throw new UserFacingError(`${machine.name} is a washer. Top-ups are for dryers.`);
      const problem = topUpProblem(machine, { ...input, enabled: input.price > 0 });
      if (problem) throw new UserFacingError(`${machine.name}: ${problem}`);
      const existing = tx.select().from(dryerTopUps).where(eq(dryerTopUps.machineId, machine.id)).all();
      if (existing.some((topUp) => sameName(topUp.name, input.name))) {
        throw new UserFacingError(`${machine.name} already has a top-up called ${input.name.trim()}.`);
      }
      const sortOrder = existing.reduce((max, topUp) => Math.max(max, topUp.sortOrder + 1), 0);
      tx.insert(dryerTopUps)
        .values({
          machineId: machine.id,
          name: input.name.trim(),
          minutes: input.minutes,
          pulses: input.pulses,
          price: input.price,
          enabled: input.price > 0,
          sortOrder,
        })
        .run();
    }
  });
}

/** Developer only: saves a dryer's top-ups as edited in its settings. */
export function updateTopUps(ctx: ServiceContext, actor: Actor, machineId: number, edits: readonly TopUpEdit[]): void {
  requireDeveloper(actor);
  saveTopUpEdits(ctx.db, machineId, edits);
}

/** Checks and saves edits to one dryer's top-ups, all or nothing. */
export function saveTopUpEdits(db: Db, machineId: number, edits: readonly TopUpEdit[]): void {
  db.transaction((tx) => {
    const machine = tx.select().from(machines).where(eq(machines.id, machineId)).get();
    if (!machine) throw new UserFacingError('That machine no longer exists.');
    const own = tx.select().from(dryerTopUps).where(eq(dryerTopUps.machineId, machineId)).all();
    for (const edit of edits) {
      if (!own.some((topUp) => topUp.id === edit.id)) throw new UserFacingError(`That top-up is not on ${machine.name}.`);
      const problem = topUpProblem(machine, edit);
      if (problem) throw new UserFacingError(`${edit.name.trim() || 'A top-up'}: ${problem}`);
      if (edits.some((other) => other.id !== edit.id && sameName(other.name, edit.name))) {
        throw new UserFacingError(`${machine.name} has two top-ups called ${edit.name.trim()}.`);
      }
    }
    for (const edit of edits) {
      tx.update(dryerTopUps)
        .set({
          name: edit.name.trim(),
          minutes: edit.minutes,
          pulses: edit.pulses,
          price: edit.price,
          enabled: edit.enabled,
        })
        .where(eq(dryerTopUps.id, edit.id))
        .run();
    }
  });
}

/** Every length any dryer has as a top-up type, shortest first: the rows of the shop's price list. */
export function topUpLengths(db: Db): number[] {
  return [...new Set(allTopUps(db).map((topUp) => topUp.minutes))].sort((a, b) => a - b);
}

/**
 * The top-ups a new order may include: lengths with a shop price that at least one dryer offers.
 * The dryer that runs the load must offer the same length.
 */
export function orderTopUpChoices(db: Db): ShopTopUpPrice[] {
  const shop = getSetting(db, 'shopTopUps');
  const offered = new Set(allTopUps(db).filter((topUp) => topUp.enabled).map((topUp) => topUp.minutes));
  return topUpLengths(db)
    .map((minutes) => ({ minutes, price: shopPriceFor(shop, minutes) }))
    .filter((choice) => choice.price > 0 && offered.has(choice.minutes));
}

/**
 * Owner or developer: the shop's top-up prices by length, for new orders. Each price is also
 * given to every dryer top-up of that length that is offered; 0 takes a length off new orders only.
 */
export function saveShopTopUpPrices(ctx: ServiceContext, actor: Actor, prices: readonly ShopTopUpPrice[]): void {
  if (!can.changeOwnerSettings(actor.role)) throw new UserFacingError('Only the owner can change these prices.');
  for (const entry of prices) {
    if (!Number.isInteger(entry.price) || entry.price < 0 || entry.price > MAX_TOP_UP_PRICE) {
      throw new UserFacingError(
        `The ${entry.minutes}-minute top-up price must be from ${formatPeso(0)} to ${formatPeso(MAX_TOP_UP_PRICE)}.`,
      );
    }
  }
  ctx.db.transaction((tx) => {
    for (const entry of prices) {
      if (entry.price === 0) continue;
      tx.update(dryerTopUps)
        .set({ price: entry.price })
        .where(and(eq(dryerTopUps.minutes, entry.minutes), eq(dryerTopUps.enabled, true)))
        .run();
    }
    setSetting(tx, 'shopTopUps', prices.map((entry) => ({ minutes: entry.minutes, price: entry.price })));
  });
}
