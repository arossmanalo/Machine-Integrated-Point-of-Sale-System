/**
 * The only way the app reaches the machines. Screens and services use this interface and never
 * the network code directly, so the machine controller can be swapped or simulated.
 * The controller knows nothing about orders, staff or PINs: it sends pulses to a hardware channel.
 */
export type ControllerStatus = 'disconnected' | 'connecting' | 'ready' | 'error';

export type ConnectResult = 'connected' | 'not-configured' | 'unreachable' | 'failed';

/**
 * What happened to a start:
 * - acked: the controller accepted it and is sending the pulses.
 * - rejected: the controller refused it (wrong key, bad channel or pulse settings).
 * - busy: that machine is still receiving the pulses of an earlier start.
 * - failed: the controller confirmed it did not get the command; nothing was started.
 * - timeout: no answer and no way to check, so the machine may or may not have started.
 * - not-connected: the controller could not be reached; nothing was sent.
 */
export type StartResult = 'acked' | 'rejected' | 'busy' | 'failed' | 'timeout' | 'not-connected';

/** One start: `count` pulses of `onMs`, each followed by `offMs`. */
export interface PulseSettings {
  count: number;
  onMs: number;
  offMs: number;
}

export interface ControllerState {
  status: ControllerStatus;
  /** Plain-language reason for 'error' or 'disconnected', for the status chip. */
  detail: string | null;
}

export type Unsubscribe = () => void;

/** A machine whose running signal is on, and for how long it has been on. */
export interface RunningSignal {
  channel: number;
  runningMs: number;
}

export interface MachineController {
  readonly kind: 'mock' | 'wifi';
  connect(): Promise<ConnectResult>;
  disconnect(): Promise<void>;
  state(): ControllerState;
  onStateChange(listener: (state: ControllerState) => void): Unsubscribe;
  start(hardwareChannel: number, pulses: PulseSettings): Promise<StartResult>;
  /**
   * Called with every fresh reading of the machines' running signals: the machines whose signal
   * is on. Not called while the controller cannot be reached, so silence never reads as "stopped".
   */
  onRunningSignals(listener: (signals: readonly RunningSignal[]) => void): Unsubscribe;
}

export const STATUS_LABELS: Record<ControllerStatus, string> = {
  disconnected: 'Machines offline',
  connecting: 'Connecting to machines',
  ready: 'Machines ready',
  error: 'Machine controller error',
};
