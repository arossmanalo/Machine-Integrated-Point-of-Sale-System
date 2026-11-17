import { pbkdf2Async } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';

/**
 * Passwords and the owner PIN are stored as "pbkdf2-sha256$<iterations>$<salt hex>$<hash hex>".
 * The iteration count is kept in the string so it can be raised later without breaking
 * existing accounts.
 */
const ALGORITHM = 'pbkdf2-sha256';
// Pure-JS hashing on the tablet: 20,000 rounds took several seconds per check in testing. In the
// app a 4-6 digit PIN is protected by the 5-try lockout; offline it is only as safe as the
// backup file, which is why backups are owner-only (can.manageBackups).
export const DEFAULT_ITERATIONS = 5000;
const KEY_LENGTH = 32;

export async function hashSecret(
  secret: string,
  salt: Uint8Array,
  iterations: number = DEFAULT_ITERATIONS,
): Promise<string> {
  const key = await pbkdf2Async(sha256, utf8ToBytes(secret), salt, {
    c: iterations,
    dkLen: KEY_LENGTH,
  });
  return [ALGORITHM, iterations, bytesToHex(salt), bytesToHex(key)].join('$');
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifySecret(secret: string, stored: string): Promise<boolean> {
  const [algorithm, iterationsText, saltHex, expectedHex] = stored.split('$');
  const iterations = Number(iterationsText);
  if (algorithm !== ALGORITHM || !Number.isInteger(iterations) || !saltHex || !expectedHex) {
    return false;
  }
  const recomputed = await hashSecret(secret, hexToBytes(saltHex), iterations);
  return constantTimeEqual(recomputed, stored);
}

export const PIN_PATTERN = /^\d{4,6}$/;
export const MIN_PASSWORD_LENGTH = 6;

export function pinProblem(pin: string): string | null {
  return PIN_PATTERN.test(pin) ? null : 'The PIN must be 4 to 6 digits.';
}

export function passwordProblem(password: string): string | null {
  return password.length >= MIN_PASSWORD_LENGTH
    ? null
    : `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
}

/** Overrides lock after this many wrong PINs in a row, for this long. */
export const PIN_MAX_FAILURES = 5;
export const PIN_LOCKOUT_MS = 5 * 60 * 1000;

export interface PinLockState {
  failures: number;
  lockedUntil: number | null;
}

export function isPinLocked(state: PinLockState, now: number): boolean {
  return state.lockedUntil !== null && now < state.lockedUntil;
}

export function afterPinFailure(state: PinLockState, now: number): PinLockState {
  const failures = isPinLocked(state, now) ? state.failures : state.failures + 1;
  if (failures >= PIN_MAX_FAILURES) return { failures: 0, lockedUntil: now + PIN_LOCKOUT_MS };
  return { failures, lockedUntil: null };
}

export const PIN_UNLOCKED: PinLockState = { failures: 0, lockedUntil: null };
