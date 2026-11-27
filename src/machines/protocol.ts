import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { z } from 'zod';

import type { PulseSettings } from './MachineController';

/**
 * The HTTP contract with the ESP32 sketch in lock_controller/lock_controller.ino.
 * Keep this file, the sketch and CLAUDE.md in step.
 *
 *   GET  /status     -> {"device":"laundry-locks","channels":11,"busy":[3],
 *                        "running":[{"channel":2,"ms":61000}],"lastAccepted":"<hex>"}
 *   GET  /challenge  -> {"challenge":"<32 hex chars>"}   single use, expires after 10 s
 *   POST /start      form body channel=<n>&pulses=<count>&onMs=<ms>&offMs=<ms>&challenge=<hex>&signature=<hex>
 *                    -> 200 {"ok":true,"channel":n}   accepted; the pulses follow
 *                    -> 4xx {"ok":false,"error":"bad-channel"|"bad-pulses"|"busy"|"bad-signature"|"stale-challenge"}
 *
 * A start sends `count` pulses of `onMs`, each followed by `offMs`, like a coin slot. Outputs are
 * idle otherwise. `busy` lists channels still pulsing; `lastAccepted` is the challenge of the last
 * start carried out, so a start whose reply was lost can be checked. `running` lists the machines
 * whose running signal is on, with how long it has been on.
 * signature = hex(HMAC-SHA256(key, "S<n>:<count>:<onMs>:<offMs>:<challenge>")). The key is a
 * passphrase set in both the app and the sketch, so a phone on the same Wi-Fi cannot start a
 * machine without the POS.
 */
export const DEVICE_NAME = 'laundry-locks';

/** The two board terminals of one machine channel: its start pulses go out, its running signal comes in. */
export interface ChannelTerminals {
  start: string;
  signal: string;
}

/**
 * The board terminals behind each channel (channel n is entry n - 1) on the ESP32-S3 board.
 * Matches OUTPUT_PINS and INPUT_PINS in the sketch: IO14 is the terminal labelled 14, GPIO 14.
 * Terminal 4 is the controller's link light, not a channel.
 */
export const MACHINE_CHANNEL_TERMINALS: readonly ChannelTerminals[] = [
  { start: 'IO14', signal: 'IO13' },
  { start: 'IO12', signal: 'IO11' },
  { start: 'IO10', signal: 'IO9' },
  { start: 'IO8', signal: 'IO18' },
  { start: 'IO17', signal: 'IO16' },
  { start: 'IO15', signal: 'IO7' },
  { start: 'IO6', signal: 'IO5' },
  { start: 'IO21', signal: 'IO47' },
  { start: 'IO39', signal: 'IO40' },
  { start: 'IO41', signal: 'IO42' },
  { start: 'IO2', signal: 'IO1' },
];
export const MAX_CHANNEL = MACHINE_CHANNEL_TERMINALS.length;
export const MIN_KEY_LENGTH = 12;

/** Bounds for one start. Keep in step with MAX_PULSES, MIN_PULSE_MS and MAX_PULSE_MS in the sketch. */
export const PULSE_LIMITS = { maxCount: 50, minMs: 20, maxMs: 5000 } as const;

export function isValidChannel(channel: number): boolean {
  return Number.isInteger(channel) && channel >= 1 && channel <= MAX_CHANNEL;
}

export function channelTerminals(channel: number): ChannelTerminals | null {
  return isValidChannel(channel) ? (MACHINE_CHANNEL_TERMINALS[channel - 1] ?? null) : null;
}

export function pulsesProblem(pulses: PulseSettings): string | null {
  const { maxCount, minMs, maxMs } = PULSE_LIMITS;
  if (!Number.isInteger(pulses.count) || pulses.count < 1 || pulses.count > maxCount) {
    return `The number of pulses must be from 1 to ${maxCount}.`;
  }
  for (const [label, ms] of [['Pulse length', pulses.onMs], ['Gap between pulses', pulses.offMs]] as const) {
    if (!Number.isInteger(ms) || ms < minMs || ms > maxMs) {
      return `${label} must be from ${minMs} to ${maxMs} milliseconds.`;
    }
  }
  return null;
}

export function signStart(key: string, channel: number, pulses: PulseSettings, challenge: string): string {
  const message = `S${channel}:${pulses.count}:${pulses.onMs}:${pulses.offMs}:${challenge}`;
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
  /** Channels still sending the pulses of a start. */
  busy: z.array(z.number().int()),
  /**
   * Machines whose running signal is on, and for how many milliseconds. A sketch from before the
   * running signals sends none.
   */
  running: z
    .array(z.object({ channel: z.number().int(), ms: z.number().int().nonnegative() }))
    .default([]),
  /** Challenge of the last start the ESP32 carried out; empty until the first one. */
  lastAccepted: z.string(),
});

export const challengeResponse = z.object({ challenge: z.string().regex(/^[0-9a-f]{32}$/) });

export const startResponse = z.union([
  z.object({ ok: z.literal(true), channel: z.number().int() }),
  z.object({
    ok: z.literal(false),
    error: z.enum(['bad-channel', 'bad-pulses', 'busy', 'bad-signature', 'stale-challenge']),
  }),
]);

