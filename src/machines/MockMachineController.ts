import type {
  ConnectResult,
  ControllerState,
  MachineController,
  PulseSettings,
  RunningSignal,
  StartResult,
  Unsubscribe,
} from './MachineController';
import { isValidChannel, pulsesProblem } from './protocol';

/** Stands in for the ESP32 machine controller during development, tests and demos. */
export class MockMachineController implements MachineController {
  readonly kind = 'mock' as const;
  /** Every accepted start, in order. */
  readonly starts: { channel: number; pulses: PulseSettings }[] = [];
  private current: ControllerState = { status: 'disconnected', detail: null };
  private listeners = new Set<(state: ControllerState) => void>();
  private signalListeners = new Set<(signals: readonly RunningSignal[]) => void>();
  private nextResult: StartResult | null = null;

  constructor(private readonly latencyMs = 150) {}

  /** Make the next start return this result instead of 'acked'. */
  failNextStart(result: Exclude<StartResult, 'acked'>): void {
    this.nextResult = result;
  }

  async connect(): Promise<ConnectResult> {
    this.setState({ status: 'ready', detail: 'Simulated machines (no hardware)' });
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

  onRunningSignals(listener: (signals: readonly RunningSignal[]) => void): Unsubscribe {
    this.signalListeners.add(listener);
    return () => {
      this.signalListeners.delete(listener);
    };
  }

  /** Report these running signals, as the ESP32 would on its next status check. */
  reportRunning(signals: readonly RunningSignal[]): void {
    this.signalListeners.forEach((listener) => listener(signals));
  }

  async start(hardwareChannel: number, pulses: PulseSettings): Promise<StartResult> {
    if (this.current.status !== 'ready') return 'not-connected';
    if (!isValidChannel(hardwareChannel) || pulsesProblem(pulses) !== null) return 'rejected';
    if (this.latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
    const result = this.nextResult ?? 'acked';
    this.nextResult = null;
    if (result === 'acked') this.starts.push({ channel: hardwareChannel, pulses });
    return result;
  }

  private setState(next: ControllerState): void {
    this.current = next;
    this.listeners.forEach((listener) => listener(next));
  }
}
