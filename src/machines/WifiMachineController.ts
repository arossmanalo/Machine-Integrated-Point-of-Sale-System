import type {
  ConnectResult,
  ControllerState,
  MachineController,
  UnlockResult,
  Unsubscribe,
} from './MachineController';
import {
  challengeResponse,
  isValidChannel,
  MIN_KEY_LENGTH,
  pulseResponse,
  signPulse,
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
  notConfigured: 'Set the lock controller address and key in Manage, Machines and locks.',
  unreachable: 'Cannot reach the lock controller. Check that it has power and is on the shop Wi-Fi.',
  notOurs: 'Something answered at that address, but it is not the lock controller. Check the address.',
  badKey: 'The lock key in the app does not match the one on the lock controller.',
};

export const fetchHttp: HttpClient = async ({ method, url, body, timeoutMs }) => {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method,
      body,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/x-www-form-urlencoded' },
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
 * Talks to the ESP32 lock controller over the shop Wi-Fi. Every pulse is signed with the shared
 * key over a single-use challenge from the ESP32, so it cannot be forged or replayed.
 * A pulse is never retried: if the reply is lost the door may already have opened.
 */
export class WifiMachineController implements MachineController {
  readonly kind = 'wifi' as const;
  private current: ControllerState = { status: 'disconnected', detail: null };
  private listeners = new Set<(state: ControllerState) => void>();
  private queue: Promise<unknown> = Promise.resolve();
  private connecting: Promise<ConnectResult> | null = null;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  /** Set when the ESP32 refused a signature; cleared by the next pulse it accepts. */
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

  unlock(hardwareChannel: number): Promise<UnlockResult> {
    const run = () => this.sendPulse(hardwareChannel);
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

  private async checkStatus(): Promise<ConnectResult> {
    let reply: HttpReply;
    try {
      reply = await this.http({ method: 'GET', url: this.url('/status'), timeoutMs: this.timings.requestTimeoutMs });
    } catch {
      this.setState({ status: 'disconnected', detail: DETAILS.unreachable });
      return 'unreachable';
    }
    if (reply.status !== 200 || !statusResponse.safeParse(reply.json).success) {
      this.setState({ status: 'error', detail: DETAILS.notOurs });
      return 'failed';
    }
    this.setState(this.keyRejected ? { status: 'error', detail: DETAILS.badKey } : { status: 'ready', detail: null });
    return 'connected';
  }

  private async sendPulse(channel: number): Promise<UnlockResult> {
    if (!isValidChannel(channel)) return 'rejected';
    const usable = this.current.status === 'ready' || this.keyRejected;
    if (!usable && (await this.connect()) !== 'connected') return 'not-connected';

    let challenge: string;
    try {
      const reply = await this.http({
        method: 'GET',
        url: this.url('/challenge'),
        timeoutMs: this.timings.requestTimeoutMs,
      });
      const parsed = challengeResponse.safeParse(reply.json);
      if (!parsed.success) {
        this.setState({ status: 'error', detail: DETAILS.notOurs });
        return 'not-connected';
      }
      challenge = parsed.data.challenge;
    } catch {
      this.setState({ status: 'disconnected', detail: DETAILS.unreachable });
      return 'not-connected';
    }

    const signature = signPulse(this.config.key, channel, challenge);
    let reply: HttpReply;
    try {
      reply = await this.http({
        method: 'POST',
        url: this.url('/pulse'),
        body: `channel=${channel}&challenge=${challenge}&signature=${signature}`,
        timeoutMs: this.timings.requestTimeoutMs,
      });
    } catch {
      void this.checkStatus();
      return 'timeout';
    }
    const parsed = pulseResponse.safeParse(reply.json);
    if (!parsed.success) return 'timeout';
    if (parsed.data.ok) {
      if (parsed.data.channel !== channel) return 'rejected';
      this.keyRejected = false;
      this.setState({ status: 'ready', detail: null });
      return 'acked';
    }
    if (parsed.data.error === 'bad-signature') {
      this.keyRejected = true;
      this.setState({ status: 'error', detail: DETAILS.badKey });
    }
    return 'rejected';
  }

  private setState(next: ControllerState): void {
    if (next.status === this.current.status && next.detail === this.current.detail) return;
    this.current = next;
    this.listeners.forEach((listener) => listener(next));
  }
}
