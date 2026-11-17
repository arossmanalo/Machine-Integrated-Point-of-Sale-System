import { NativeModule, requireNativeModule } from 'expo';

export type OpenResult = 'opened' | 'no-device' | 'permission-denied' | 'failed';

type MachineSerialEvents = {
  onData: (event: { text: string }) => void;
  onDevice: (event: { event: 'attached' | 'detached' }) => void;
};

declare class MachineSerialNativeModule extends NativeModule<MachineSerialEvents> {
  open(baudRate: number): Promise<OpenResult>;
  write(text: string): Promise<void>;
  close(): Promise<void>;
}

export default requireNativeModule<MachineSerialNativeModule>('MachineSerial');
