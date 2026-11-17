import type {
  ConnectResult,
  ControllerState,
  MachineController,
  UnlockResult,
  Unsubscribe,
} from './MachineController';
import { isValidChannel } from './protocol';

/** Stands in for the Arduino during development, tests and demos. */
export class MockMachineController implements MachineController {
  readonly kind = 'mock' as const;
  readonly pulses: number[] = [];
  private current: ControllerState = { status: 'disconnected', detail: null };
  private listeners = new Set<(state: ControllerState) => void>();
  private nextResult: UnlockResult | null = null;

  constructor(private readonly latencyMs = 150) {}

  /** Make the next unlock return this result instead of 'acked'. */
  failNextUnlock(result: Exclude<UnlockResult, 'acked'>): void {
    this.nextResult = result;
  }

  async connect(): Promise<ConnectResult> {
    this.setState({ status: 'ready', detail: 'Simulated locks (no hardware)' });
    return 'connected';
  }

  async disconnect(): Promise<void> {
    this.setState({ status: 'disconnected', detail: null });
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

  async unlock(hardwareChannel: number): Promise<UnlockResult> {
    if (this.current.status !== 'ready') return 'not-connected';
    if (!isValidChannel(hardwareChannel)) return 'rejected';
    if (this.latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
    const result = this.nextResult ?? 'acked';
    this.nextResult = null;
    if (result === 'acked') this.pulses.push(hardwareChannel);
    return result;
  }

  private setState(next: ControllerState): void {
    this.current = next;
    this.listeners.forEach((listener) => listener(next));
  }
}
