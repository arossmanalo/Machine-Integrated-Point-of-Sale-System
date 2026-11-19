import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { z } from 'zod';

/**
 * The HTTP contract with the ESP32 sketch in lock_controller/lock_controller.ino.
 * Keep this file, the sketch and CLAUDE.md in step.
 *
 *   GET  /status     -> {"device":"laundry-locks","channels":6}
 *   GET  /challenge  -> {"challenge":"<32 hex chars>"}   single use, expires after 10 s
 *   POST /pulse      form body channel=<n>&challenge=<hex>&signature=<hex>
 *                    -> 200 {"ok":true,"channel":n}
 *                    -> 4xx {"ok":false,"error":"bad-channel"|"bad-signature"|"stale-challenge"}
 *
 * signature = hex(HMAC-SHA256(key, "P<n>:<challenge>")). The key is a passphrase set in both the
 * app and the sketch, so a phone on the same Wi-Fi cannot open doors without the POS.
 */
export const DEVICE_NAME = 'laundry-locks';
export const MAX_CHANNEL = 99;
export const MIN_KEY_LENGTH = 12;

export function isValidChannel(channel: number): boolean {
  return Number.isInteger(channel) && channel >= 1 && channel <= MAX_CHANNEL;
}

export function signPulse(key: string, channel: number, challenge: string): string {
  return bytesToHex(hmac(sha256, utf8ToBytes(key), utf8ToBytes(`P${channel}:${challenge}`)));
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
});

export const challengeResponse = z.object({ challenge: z.string().regex(/^[0-9a-f]{32}$/) });

export const pulseResponse = z.union([
  z.object({ ok: z.literal(true), channel: z.number().int() }),
  z.object({ ok: z.literal(false), error: z.enum(['bad-channel', 'bad-signature', 'stale-challenge']) }),
]);

export type PulseResponse = z.infer<typeof pulseResponse>;
