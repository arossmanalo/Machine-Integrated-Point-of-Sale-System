/**
 * The only way the app reaches the door locks. Screens and services use this interface and
 * never the network code directly, so the lock controller can be swapped or simulated.
 * The controller knows nothing about orders, staff or PINs: it pulses a hardware channel.
 */
export type ControllerStatus = 'disconnected' | 'connecting' | 'ready' | 'error';

export type ConnectResult = 'connected' | 'not-configured' | 'unreachable' | 'failed';

export type UnlockResult = 'acked' | 'rejected' | 'timeout' | 'not-connected';

export interface ControllerState {
  status: ControllerStatus;
  /** Plain-language reason for 'error' or 'disconnected', for the status chip. */
  detail: string | null;
  /** Channels unlocked right now, each for the lock controller's pulse length after an unlock. */
  openChannels: readonly number[];
}

export type Unsubscribe = () => void;

export interface MachineController {
  readonly kind: 'mock' | 'wifi';
  connect(): Promise<ConnectResult>;
  disconnect(): Promise<void>;
  state(): ControllerState;
  onStateChange(listener: (state: ControllerState) => void): Unsubscribe;
  unlock(hardwareChannel: number): Promise<UnlockResult>;
}

export const STATUS_LABELS: Record<ControllerStatus, string> = {
  disconnected: 'Locks offline',
  connecting: 'Connecting to locks',
  ready: 'Locks ready',
  error: 'Lock controller error',
};
