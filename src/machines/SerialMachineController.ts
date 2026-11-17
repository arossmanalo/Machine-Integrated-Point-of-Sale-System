import type {
  ConnectResult,
  ControllerState,
  MachineController,
  UnlockResult,
  Unsubscribe,
} from './MachineController';
import { BAUD_RATE, encodePulse, isValidChannel, LineBuffer, parseLine } from './protocol';

export type OpenResult = 'opened' | 'no-device' | 'permission-denied' | 'failed';

/** What the controller needs from a serial port. The USB module provides one; tests fake it. */
export interface SerialTransport {
  open(baudRate: number): Promise<OpenResult>;
  close(): Promise<void>;
  write(text: string): Promise<void>;
  onData(listener: (chunk: string) => void): Unsubscribe;
  /** Device plugged in (attached) or pulled out (detached). */
  onDevice(listener: (event: 'attached' | 'detached') => void): Unsubscribe;
}

export interface SerialTimings {
  /** The Uno resets when the port opens; wait this long for READY before sending anyway. */
  bootWaitMs: number;
  replyTimeoutMs: number;
}

export const DEFAULT_TIMINGS: SerialTimings = { bootWaitMs: 2000, replyTimeoutMs: 1500 };

interface PendingReply {
  channel: number;
  resolve: (result: UnlockResult) => void;
}

const CONNECT_DETAILS: Record<Exclude<ConnectResult, 'connected'>, string> = {
  'no-device': 'No lock controller found. Check the USB cable and adapter.',
  'permission-denied': 'USB access was not allowed. Unplug and replug the cable, then allow it.',
  failed: 'Could not open the lock controller. Unplug and replug the cable.',
};

/**
 * Talks to the Arduino over any serial transport: waits for READY after opening, sends one
 * command at a time, and only reports success when the Arduino answers "OK P<n>".
 */
export class SerialMachineController implements MachineController {
  readonly kind = 'usb' as const;
  private current: ControllerState = { status: 'disconnected', detail: null };
  private listeners = new Set<(state: ControllerState) => void>();
  private lines = new LineBuffer();
  private pending: PendingReply | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private bootWaiter: (() => void) | null = null;
  private connecting: Promise<ConnectResult> | null = null;
  private readonly unsubscribers: Unsubscribe[];

  constructor(
    private readonly transport: SerialTransport,
    private readonly timings: SerialTimings = DEFAULT_TIMINGS,
  ) {
    this.unsubscribers = [
      transport.onData((chunk) => this.handleData(chunk)),
      transport.onDevice((event) => this.handleDevice(event)),
    ];
  }

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
    if (this.current.status === 'ready') return Promise.resolve('connected');
    if (this.connecting) return this.connecting;
    this.connecting = this.openAndWait().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  async disconnect(): Promise<void> {
    this.failPending('not-connected');
    await this.transport.close();
    this.setState({ status: 'disconnected', detail: null });
  }

  /** Stop listening to the transport. Used when the app switches to the mock controller. */
  async dispose(): Promise<void> {
    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
    await this.disconnect();
  }

  unlock(hardwareChannel: number): Promise<UnlockResult> {
    const run = () => this.sendPulse(hardwareChannel);
    const result = this.queue.then(run, run);
    this.queue = result;
    return result;
  }

  private async openAndWait(): Promise<ConnectResult> {
    this.setState({ status: 'connecting', detail: null });
    this.lines.clear();
    let opened: OpenResult;
    try {
      opened = await this.transport.open(BAUD_RATE);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.setState({ status: 'error', detail: `${CONNECT_DETAILS.failed} (${message})` });
      return 'failed';
    }
    if (opened !== 'opened') {
      const status = opened === 'no-device' ? 'disconnected' : 'error';
      this.setState({ status, detail: CONNECT_DETAILS[opened] });
      return opened;
    }
    await this.waitForBoot();
    this.setState({ status: 'ready', detail: null });
    return 'connected';
  }

  private waitForBoot(): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(done, this.timings.bootWaitMs);
      const self = this;
      function done() {
        clearTimeout(timer);
        self.bootWaiter = null;
        resolve();
      }
      this.bootWaiter = done;
    });
  }

  private async sendPulse(channel: number): Promise<UnlockResult> {
    if (this.current.status !== 'ready') return 'not-connected';
    if (!isValidChannel(channel)) return 'rejected';
    const reply = new Promise<UnlockResult>((resolve) => {
      const timer = setTimeout(() => {
        if (this.pending?.channel === channel) this.pending = null;
        resolve('timeout');
      }, this.timings.replyTimeoutMs);
      this.pending = {
        channel,
        resolve: (result) => {
          clearTimeout(timer);
          this.pending = null;
          resolve(result);
        },
      };
    });
    try {
      await this.transport.write(encodePulse(channel));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.failPending('not-connected');
      this.setState({ status: 'disconnected', detail: `Lost the lock controller (${message}).` });
      return 'not-connected';
    }
    return reply;
  }

  private handleData(chunk: string): void {
    for (const raw of this.lines.push(chunk)) {
      const line = parseLine(raw);
      if (line.kind === 'ready') {
        this.bootWaiter?.();
      } else if (line.kind === 'ok' && this.pending?.channel === line.channel) {
        this.pending.resolve('acked');
      } else if (line.kind === 'error' && this.pending) {
        this.pending.resolve('rejected');
      }
    }
  }

  private handleDevice(event: 'attached' | 'detached'): void {
    if (event === 'detached') {
      this.failPending('not-connected');
      this.bootWaiter?.();
      this.setState({ status: 'disconnected', detail: 'Lock controller unplugged.' });
      void this.transport.close();
      return;
    }
    if (this.current.status !== 'ready') void this.connect();
  }

  private failPending(result: UnlockResult): void {
    this.pending?.resolve(result);
  }

  private setState(next: ControllerState): void {
    this.current = next;
    this.listeners.forEach((listener) => listener(next));
  }
}
