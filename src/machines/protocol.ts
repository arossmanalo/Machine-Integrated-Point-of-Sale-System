import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { z } from 'zod';

/**
 * The HTTP contract with the ESP32 sketch in lock_controller/lock_controller.ino.
 * Keep this file, the sketch and CLAUDE.md in step.
 *
 *   GET  /status     -> {"device":"laundry-locks","channels":14,"unlocked":[2,5]}
 *   GET  /challenge  -> {"challenge":"<32 hex chars>"}   single use, expires after 10 s
 *   POST /unlock     form body channel=<n>&challenge=<hex>&signature=<hex>
 *   POST /lock       same body
 *                    -> 200 {"ok":true,"channel":n}
 *                    -> 4xx {"ok":false,"error":"bad-channel"|"bad-signature"|"stale-challenge"}
 *
 * A door stays unlocked until it is locked; every door is locked after the ESP32 restarts.
 * signature = hex(HMAC-SHA256(key, "U<n>:<challenge>")) to unlock, "L<n>:<challenge>" to lock.
 * The key is a passphrase set in both the app and the sketch, so a phone on the same Wi-Fi
 * cannot unlock or lock doors without the POS.
 */
export const DEVICE_NAME = 'laundry-locks';

/**
 * The board terminal behind each channel (channel n is entry n - 1). Matches LOCK_PINS in the
 * sketch: D25 is GPIO 25, RX2 is GPIO 16, TX2 is GPIO 17.
 */
export const LOCK_CHANNEL_TERMINALS = [
  'D25', 'D26', 'D27', 'D32', 'D33', 'D13', 'D18', 'D19', 'D21', 'D22', 'D23', 'D4', 'RX2', 'TX2',
] as const;
export const MAX_CHANNEL = LOCK_CHANNEL_TERMINALS.length;
export const MIN_KEY_LENGTH = 12;

export type LockCommand = 'unlock' | 'lock';
export const COMMAND_PATHS: Record<LockCommand, string> = { unlock: '/unlock', lock: '/lock' };
const COMMAND_LETTERS: Record<LockCommand, string> = { unlock: 'U', lock: 'L' };

export function isValidChannel(channel: number): boolean {
  return Number.isInteger(channel) && channel >= 1 && channel <= MAX_CHANNEL;
}

export function channelTerminal(channel: number): string | null {
  return isValidChannel(channel) ? LOCK_CHANNEL_TERMINALS[channel - 1] : null;
}

export function signCommand(key: string, command: LockCommand, channel: number, challenge: string): string {
  const message = `${COMMAND_LETTERS[command]}${channel}:${challenge}`;
  return bytesToHex(hmac(sha256, utf8ToBytes(key), utf8ToBytes(message)));
}

/**
 * Turns what the owner typed ("192.168.1.50", "192.168.1.50:8080", "http://laundry-locks.local")
 * into a base URL, or null if it is not a host the app can reach over plain HTTP.
 */
export function normalizeAddress(input: string): string | null {
  const trimmed = input.trim().replace(/^http:\/\//i, '').replace(/\/+$/, '');
  const match = /^([a-z0-9.-]+)(?::(\d{1,5}))?$/i.exec(trimmed);
  if (!match) return null;
  const [, host, port] = match;
  if (port !== undefined && (Number(port) < 1 || Number(port) > 65535)) return null;
  return `http://${host.toLowerCase()}${port ? `:${port}` : ''}`;
}

export const statusResponse = z.object({
  device: z.literal(DEVICE_NAME),
  channels: z.number().int().nonnegative(),
  /** Channels unlocked right now, as the ESP32 sees them. */
  unlocked: z.array(z.number().int()),
});

export const challengeResponse = z.object({ challenge: z.string().regex(/^[0-9a-f]{32}$/) });

export const commandResponse = z.union([
  z.object({ ok: z.literal(true), channel: z.number().int() }),
  z.object({ ok: z.literal(false), error: z.enum(['bad-channel', 'bad-signature', 'stale-challenge']) }),
]);

