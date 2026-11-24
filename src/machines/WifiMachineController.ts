import type { z } from 'zod';

import type {
  ConnectResult,
  ControllerState,
  MachineController,
  PulseSettings,
  StartResult,
  Unsubscribe,
} from './MachineController';
import {
  challengeResponse,
  isValidChannel,
  MIN_KEY_LENGTH,
  pulsesProblem,
  signStart,
  startResponse,
  statusResponse,
} from './protocol';

export interface HttpRequest {
  method: 'GET' | 'POST';
  url: string;
  /** Sent as application/x-www-form-urlencoded. */
  body?: string;
  timeoutMs: number;
}

/** The parsed JSON body, or null when the body was not JSON. */
export interface HttpReply {
  status: number;
  json: unknown;
}

/** Rejects when the request could not complete (no route, refused, timed out). */
export type HttpClient = (request: HttpRequest) => Promise<HttpReply>;

export interface WifiConfig {
  /** From normalizeAddress, e.g. "http://192.168.1.50"; null until the owner sets it. */
  baseUrl: string | null;
  key: string;
}

export interface WifiTimings {
  requestTimeoutMs: number;
  /** Wi-Fi gives no unplug event, so the controller asks the ESP32 how it is this often. */
  healthIntervalMs: number;
}

export const DEFAULT_TIMINGS: WifiTimings = { requestTimeoutMs: 3000, healthIntervalMs: 20000 };

const DETAILS = {
  notConfigured: 'The machine connection is not set up yet. Ask the developer to set it up.',
  unreachable: 'Cannot reach the machine controller. Check that it has power and is on the shop Wi-Fi.',
  notOurs: 'The machine connection points at the wrong device. Ask the developer to check it.',
  badKey: 'The machine connection settings do not match. Ask the developer to check them.',
};

type CheckedReply<T> = { kind: 'ok'; data: T } | { kind: 'unreachable' } | { kind: 'not-ours' };

export const fetchHttp: HttpClient = async ({ method, url, body, timeoutMs }) => {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method,
      body,
      // The ESP32's small web server can close a kept-alive connection under Android's feet,
      // which reads as an empty reply. A fresh connection per request avoids that.
      headers:
        body === undefined
          ? { Connection: 'close' }
          : { Connection: 'close', 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: abort.signal,
    });
    const text = await response.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      // Non-JSON replies (a router login page, say) are reported as json: null.
    }
    return { status: response.status, json };
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Talks to the ESP32 machine controller over the shop Wi-Fi. Every start is signed with the shared
 * key over a single-use challenge from the ESP32, so it cannot be forged or replayed.
 * A start is never sent twice. If its reply is lost, the controller asks the ESP32 which start it
 * last carried out; only when the ESP32 cannot be reached at all is the result "timeout".
 */
export class WifiMachineController implements MachineController {
  readonly kind = 'wifi' as const;
  private current: ControllerState = { status: 'disconnected', detail: null };
  private listeners = new Set<(state: ControllerState) => void>();
  private queue: Promise<unknown> = Promise.resolve();
  private connecting: Promise<ConnectResult> | null = null;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  /** Set when the ESP32 refused a signature; cleared by the next start it accepts. */
  private keyRejected = false;

  constructor(
    private readonly config: WifiConfig,
    private readonly http: HttpClient = fetchHttp,
    private readonly timings: WifiTimings = DEFAULT_TIMINGS,
  ) {}

  state(): ControllerState {
    return this.current;
  }

  onStateChange(listener: (state: ControllerState) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  connect(): Promise<ConnectResult> {
    if (!this.configured()) {
      this.setState({ status: 'disconnected', detail: DETAILS.notConfigured });
      return Promise.resolve('not-configured');
    }
    this.startHealthChecks();
    if (this.current.status === 'ready') return Promise.resolve('connected');
    if (this.connecting) return this.connecting;
    this.setState({ status: 'connecting', detail: null });
    this.connecting = this.checkStatus().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  async disconnect(): Promise<void> {
    if (this.healthTimer !== null) clearInterval(this.healthTimer);
    this.healthTimer = null;
    this.setState({ status: 'disconnected', detail: null });
  }

  /** One start at a time, so challenges never cross. */
  start(hardwareChannel: number, pulses: PulseSettings): Promise<StartResult> {
    const run = () => this.send(hardwareChannel, pulses);
    const result = this.queue.then(run, run);
    this.queue = result;
    return result;
  }

  private configured(): boolean {
    return this.config.baseUrl !== null && this.config.key.length >= MIN_KEY_LENGTH;
  }

  private url(path: string): string {
    return `${this.config.baseUrl}${path}`;
  }

  private startHealthChecks(): void {
    if (this.healthTimer !== null) return;
    this.healthTimer = setInterval(() => {
      if (this.connecting === null) void this.checkStatus();
    }, this.timings.healthIntervalMs);
  }

  /**
   * GET that is safe to repeat (status, challenge): one retry when the request fails or the
   * reply is unreadable. "Not ours" only when something answered with readable data that is not
   * the machine controller's.
   */
  private async getChecked<T>(path: string, schema: z.ZodType<T>): Promise<CheckedReply<T>> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let reply: HttpReply;
      try {
        reply = await this.http({ method: 'GET', url: this.url(path), timeoutMs: this.timings.requestTimeoutMs });
      } catch {
        // No answer this time; the loop tries once more before calling it unreachable.
        continue;
      }
      if (reply.json === null) continue;
      const parsed = schema.safeParse(reply.json);
      if (reply.status === 200 && parsed.success) return { kind: 'ok', data: parsed.data };
      return { kind: 'not-ours' };
    }
    return { kind: 'unreachable' };
  }

  private async checkStatus(): Promise<ConnectResult> {
    const reply = await this.getChecked('/status', statusResponse);
    if (reply.kind === 'unreachable') {
      this.setState({ status: 'disconnected', detail: DETAILS.unreachable });
      return 'unreachable';
    }
    if (reply.kind === 'not-ours') {
      this.setState({ status: 'error', detail: DETAILS.notOurs });
      return 'failed';
    }
    this.setState(this.keyRejected ? { status: 'error', detail: DETAILS.badKey } : { status: 'ready', detail: null });
    return 'connected';
  }

  private async send(channel: number, pulses: PulseSettings): Promise<StartResult> {
    if (!isValidChannel(channel) || pulsesProblem(pulses) !== null) return 'rejected';
    const usable = this.current.status === 'ready' || this.keyRejected;
    if (!usable && (await this.connect()) !== 'connected') return 'not-connected';

    const issued = await this.getChecked('/challenge', challengeResponse);
    if (issued.kind !== 'ok') {
      this.setState(
        issued.kind === 'not-ours'
          ? { status: 'error', detail: DETAILS.notOurs }
          : { status: 'disconnected', detail: DETAILS.unreachable },
      );
      return 'not-connected';
    }
    const { challenge } = issued.data;

    const signature = signStart(this.config.key, channel, pulses, challenge);
    const body =
      `channel=${channel}&pulses=${pulses.count}&onMs=${pulses.onMs}&offMs=${pulses.offMs}` +
      `&challenge=${challenge}&signature=${signature}`;
    let reply: HttpReply;
    try {
      reply = await this.http({ method: 'POST', url: this.url('/start'), body, timeoutMs: this.timings.requestTimeoutMs });
    } catch {
      return this.resolveLost(challenge);
    }
    const parsed = startResponse.safeParse(reply.json);
    if (!parsed.success) return this.resolveLost(challenge);
    if (parsed.data.ok) {
      if (parsed.data.channel !== channel) return 'rejected';
      this.keyRejected = false;
      this.setState({ status: 'ready', detail: null });
      return 'acked';
    }
    if (parsed.data.error === 'busy') return 'busy';
    if (parsed.data.error === 'bad-signature') {
      this.keyRejected = true;
      this.setState({ status: 'error', detail: DETAILS.badKey });
    }
    return 'rejected';
  }

  /** The reply to a start was lost: ask the ESP32 whether it carried out this very start. */
  private async resolveLost(challenge: string): Promise<StartResult> {
    const status = await this.getChecked('/status', statusResponse);
    if (status.kind !== 'ok') {
      this.setState({ status: 'disconnected', detail: DETAILS.unreachable });
      return 'timeout';
    }
    return status.data.lastAccepted === challenge ? 'acked' : 'failed';
  }

  private setState(next: ControllerState): void {
    if (next.status === this.current.status && next.detail === this.current.detail) return;
    this.current = next;
    this.listeners.forEach((listener) => listener(next));
  }
}
