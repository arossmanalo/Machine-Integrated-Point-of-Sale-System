/**
 * The serial contract with the Arduino sketch in machine_pulser/machine_pulser.ino.
 * 9600 baud, 8N1, newline-terminated ASCII. Keep this file, the sketch and CLAUDE.md in step.
 */
export const BAUD_RATE = 9600;
export const MAX_CHANNEL = 99;

export function isValidChannel(channel: number): boolean {
  return Number.isInteger(channel) && channel >= 1 && channel <= MAX_CHANNEL;
}

export function encodePulse(channel: number): string {
  if (!isValidChannel(channel)) throw new RangeError(`Invalid machine channel: ${channel}`);
  return `P${channel}\n`;
}

export type ArduinoLine =
  | { kind: 'ready' }
  | { kind: 'ok'; channel: number }
  | { kind: 'error'; command: string }
  | { kind: 'other'; text: string };

export function parseLine(raw: string): ArduinoLine {
  const text = raw.trim();
  if (text === 'READY') return { kind: 'ready' };
  const ok = /^OK P(\d+)$/.exec(text);
  if (ok) return { kind: 'ok', channel: Number(ok[1]) };
  if (text.startsWith('ERR')) return { kind: 'error', command: text.slice(3).trim() };
  return { kind: 'other', text };
}

/** Collects serial chunks and hands back complete lines. Partial lines wait for the rest. */
export class LineBuffer {
  private pending = '';

  push(chunk: string): string[] {
    this.pending += chunk;
    const parts = this.pending.split(/\r?\n|\r/);
    this.pending = parts.pop() ?? '';
    if (this.pending.length > 256) this.pending = '';
    return parts.filter((line) => line.trim().length > 0);
  }

  clear(): void {
    this.pending = '';
  }
}
