import type {
  ConnectResult,
  ControllerState,
  MachineController,
  UnlockResult,
  Unsubscribe,
} from './MachineController';
import { isValidChannel } from './protocol';

/** Stands in for the ESP32 lock controller during development, tests and demos. */
export class MockMachineController implements MachineController {
  readonly kind = 'mock' as const;
  /** Every channel unlocked, in order. */
  readonly pulses: number[] = [];
  private current: ControllerState = { status: 'disconnected', detail: null, unlockedChannels: [] };
  private listeners = new Set<(state: ControllerState) => void>();
  private nextResult: UnlockResult | null = null;

  constructor(private readonly latencyMs = 150) {}

  /** Make the next unlock or lock return this result instead of 'acked'. */
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
    const result = await this.command(hardwareChannel);
    if (result === 'acked') {
      this.pulses.push(hardwareChannel);
      this.setUnlocked(hardwareChannel, true);
    }
    return result;
  }

  async lock(hardwareChannel: number): Promise<UnlockResult> {
    const result = await this.command(hardwareChannel);
    if (result === 'acked') this.setUnlocked(hardwareChannel, false);
    return result;
  }

  private async command(hardwareChannel: number): Promise<UnlockResult> {
    if (this.current.status !== 'ready') return 'not-connected';
    if (!isValidChannel(hardwareChannel)) return 'rejected';
    if (this.latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
    const result = this.nextResult ?? 'acked';
    this.nextResult = null;
    return result;
  }

  private setUnlocked(channel: number, unlocked: boolean): void {
    const others = this.current.unlockedChannels.filter((c) => c !== channel);
    const next = unlocked ? [...others, channel].sort((a, b) => a - b) : others;
    this.setState(this.current, next);
  }

  private setState(
    next: Pick<ControllerState, 'status' | 'detail'>,
    unlockedChannels: readonly number[] = this.current.unlockedChannels,
  ): void {
    this.current = { status: next.status, detail: next.detail, unlockedChannels };
    this.listeners.forEach((listener) => listener(this.current));
  }
}
