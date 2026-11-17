import { NativeModule, requireNativeModule } from 'expo';

export interface PairedPrinter {
  name: string;
  address: string;
}

declare class ReceiptPrinterNativeModule extends NativeModule {
  listPairedPrinters(): Promise<PairedPrinter[]>;
  print(address: string, base64Bytes: string): Promise<void>;
}

export default requireNativeModule<ReceiptPrinterNativeModule>('ReceiptPrinter');
