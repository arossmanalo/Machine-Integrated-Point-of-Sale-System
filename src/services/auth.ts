import { and, eq, sql } from 'drizzle-orm';

import {
  afterPinFailure,
  hashSecret,
  isPinLocked,
  passwordProblem,
  PIN_UNLOCKED,
  pinProblem,
  verifySecret,
} from '@/domain/secrets';
import { assignableRoles, canDeleteAccount, canEditAccount, type Role } from '@/domain/permissions';
import { users, type UserRow } from '@/db/schema';
import { UserFacingError, type Actor, type ServiceContext } from '@/db/types';

import { takeNextId } from './sequences';
import { getSetting, setSetting } from './settings';

const SALT_BYTES = 16;

export function toActor(user: UserRow): Actor {
  return { id: user.id, username: user.username, role: user.role };
}

async function hashNew(ctx: ServiceContext, secret: string): Promise<string> {
  return hashSecret(secret, ctx.randomBytes(SALT_BYTES));
}

export function needsFirstRunSetup(ctx: ServiceContext): boolean {
  const owner = ctx.db.select().from(users).where(eq(users.role, 'OWNER')).get();
  return owner === undefined;
}

function findByUsername(ctx: ServiceContext, username: string): UserRow | undefined {
  return ctx.db
    .select()
    .from(users)
    .where(sql`lower(${users.username}) = lower(${username.trim()})`)
    .get();
}

function cleanUsername(username: string): string {
  const trimmed = username.trim();
  if (trimmed.length < 2) throw new UserFacingError('Usernames need at least 2 characters.');
  return trimmed;
}

function requireValid(problem: string | null): void {
  if (problem) throw new UserFacingError(problem);
}

export interface FirstRunInput {
  username: string;
  password: string;
  pin: string;
}

/** Creates the owner account and owner PIN on a new install. */
export async function completeFirstRunSetup(ctx: ServiceContext, input: FirstRunInput): Promise<Actor> {
  if (!needsFirstRunSetup(ctx)) throw new UserFacingError('This tablet is already set up.');
  const username = cleanUsername(input.username);
  requireValid(passwordProblem(input.password));
  requireValid(pinProblem(input.pin));
  const passwordHash = await hashNew(ctx, input.password);
  const pinHash = await hashNew(ctx, input.pin);
  return ctx.db.transaction((tx) => {
    const existing = findByUsername({ ...ctx, db: tx }, username);
    let id: string;
    if (existing) {
      // An imported account with this name becomes the owner.
      id = existing.id;
      tx.update(users)
        .set({ role: 'OWNER', passwordHash, active: true })
        .where(eq(users.id, id))
        .run();
    } else {
      id = takeNextId(tx, 'user');
      tx.insert(users)
        .values({ id, username, passwordHash, role: 'OWNER', active: true, createdAt: ctx.now() })
        .run();
    }
    setSetting(tx, 'ownerPinHash', pinHash);
    setSetting(tx, 'pinLock', PIN_UNLOCKED);
    return { id, username, role: 'OWNER' as const };
  });
}

export async function logIn(ctx: ServiceContext, username: string, password: string): Promise<Actor> {
  if (!username.trim() || !password) {
    throw new UserFacingError('Enter both username and password.');
  }
  const user = findByUsername(ctx, username);
  const wrong = new UserFacingError('Incorrect username or password. Please try again.');
  if (!user || !user.active) throw wrong;
  if (!user.passwordHash) {
    throw new UserFacingError('This account has no password yet. Ask the owner to set one in Staff.');
  }
  if (!(await verifySecret(password, user.passwordHash))) throw wrong;
  setSetting(ctx.db, 'sessionUserId', user.id);
  return toActor(user);
}

export function logOut(ctx: ServiceContext): void {
  setSetting(ctx.db, 'sessionUserId', null);
}

export function restoreSession(ctx: ServiceContext): Actor | null {
  const id = getSetting(ctx.db, 'sessionUserId');
  if (!id) return null;
  const user = ctx.db.select().from(users).where(eq(users.id, id)).get();
  return user && user.active && user.passwordHash ? toActor(user) : null;
}

export function listStaff(ctx: ServiceContext): UserRow[] {
  return ctx.db.select().from(users).where(eq(users.active, true)).orderBy(users.id).all();
}

function getUser(ctx: ServiceContext, id: string): UserRow {
  const user = ctx.db.select().from(users).where(eq(users.id, id)).get();
  if (!user) throw new UserFacingError('That staff account no longer exists.');
  return user;
}

export interface StaffInput {
  username: string;
  /** Empty when editing means "keep the current password". */
  password: string;
  role: Role;
}

export async function addStaff(ctx: ServiceContext, actor: Actor, input: StaffInput): Promise<string> {
  if (!assignableRoles(actor, null).includes(input.role)) {
    throw new UserFacingError('You cannot create an account with that role.');
  }
  const username = cleanUsername(input.username);
  requireValid(passwordProblem(input.password));
  const passwordHash = await hashNew(ctx, input.password);
  return ctx.db.transaction((tx) => {
    const clash = findByUsername({ ...ctx, db: tx }, username);
    if (clash?.active) throw new UserFacingError(`The username "${username}" is already taken.`);
    if (clash) {
      // Re-activate a removed account rather than clash on the unique username.
      tx.update(users)
        .set({ role: input.role, passwordHash, active: true, username })
        .where(eq(users.id, clash.id))
        .run();
      return clash.id;
    }
    const id = takeNextId(tx, 'user');
    tx.insert(users)
      .values({ id, username, passwordHash, role: input.role, active: true, createdAt: ctx.now() })
      .run();
    return id;
  });
}

export async function updateStaff(
  ctx: ServiceContext,
  actor: Actor,
  id: string,
  input: StaffInput,
): Promise<void> {
  const target = getUser(ctx, id);
  if (!canEditAccount(actor, target)) throw new UserFacingError('You cannot edit this account.');
  const allowedRoles = assignableRoles(actor, target);
  if (input.role !== target.role && !allowedRoles.includes(input.role)) {
    throw new UserFacingError('You cannot give this account that role.');
  }
  const username = cleanUsername(input.username);
  let passwordHash = target.passwordHash;
  if (input.password) {
    requireValid(passwordProblem(input.password));
    passwordHash = await hashNew(ctx, input.password);
  }
  ctx.db.transaction((tx) => {
    const clash = findByUsername({ ...ctx, db: tx }, username);
    if (clash && clash.id !== id) {
      throw new UserFacingError(`The username "${username}" is already taken.`);
    }
    tx.update(users).set({ username, role: input.role, passwordHash }).where(eq(users.id, id)).run();
  });
}

/** Removes an account from the staff list. Past orders keep the name that was on them. */
export function removeStaff(ctx: ServiceContext, actor: Actor, id: string): void {
  const target = getUser(ctx, id);
  if (!canDeleteAccount(actor, target)) throw new UserFacingError('You cannot remove this account.');
  ctx.db.update(users).set({ active: false }).where(and(eq(users.id, id))).run();
}

/** Checks the owner PIN, counting wrong attempts and locking after too many. */
export async function checkOwnerPin(
  ctx: ServiceContext,
  pin: string,
): Promise<'ok' | 'wrong' | 'locked' | 'not-set'> {
  const hash = getSetting(ctx.db, 'ownerPinHash');
  if (!hash) return 'not-set';
  const lock = getSetting(ctx.db, 'pinLock');
  if (isPinLocked(lock, ctx.now())) return 'locked';
  if (await verifySecret(pin, hash)) {
    setSetting(ctx.db, 'pinLock', PIN_UNLOCKED);
    return 'ok';
  }
  const next = afterPinFailure(lock, ctx.now());
  setSetting(ctx.db, 'pinLock', next);
  return isPinLocked(next, ctx.now()) ? 'locked' : 'wrong';
}

export function pinLockedUntil(ctx: ServiceContext): number | null {
  const lock = getSetting(ctx.db, 'pinLock');
  return isPinLocked(lock, ctx.now()) ? lock.lockedUntil : null;
}

export async function changeOwnerPin(
  ctx: ServiceContext,
  actor: Actor,
  currentPin: string,
  newPin: string,
): Promise<void> {
  if (actor.role !== 'OWNER') throw new UserFacingError('Only the owner can change the PIN.');
  requireValid(pinProblem(newPin));
  const check = await checkOwnerPin(ctx, currentPin);
  if (check === 'locked') throw new UserFacingError('Too many wrong PINs. Try again in 5 minutes.');
  if (check === 'wrong') throw new UserFacingError('The current PIN is wrong.');
  setSetting(ctx.db, 'ownerPinHash', await hashNew(ctx, newPin));
}
