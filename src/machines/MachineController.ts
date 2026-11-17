/**
 * The only way the app reaches the door locks. Screens and services use this interface and
 * never the USB module, so a Wi-Fi controller can replace the USB one later.
 * The controller knows nothing about orders, staff or PINs: it pulses a hardware channel.
 */
export type ControllerStatus = 'disconnected' | 'connecting' | 'ready' | 'error';

export type ConnectResult = 'connected' | 'no-device' | 'permission-denied' | 'failed';

export type UnlockResult = 'acked' | 'rejected' | 'timeout' | 'not-connected';

export interface ControllerState {
  status: ControllerStatus;
  /** Plain-language reason for 'error' or 'disconnected', for the status chip. */
  detail: string | null;
}

export type Unsubscribe = () => void;

export interface MachineController {
  readonly kind: 'mock' | 'usb';
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
