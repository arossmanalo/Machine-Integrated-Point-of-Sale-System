export interface PrinterInfo {
  name: string;
  address: string;
}

/** Receipt printing behind an interface so screens never touch Bluetooth directly. */
export interface ReceiptPrinter {
  /** Asks for Bluetooth permission if needed. False when the user refuses. */
  ensurePermission(): Promise<boolean>;
  listPrinters(): Promise<PrinterInfo[]>;
  print(address: string, receipt: Uint8Array): Promise<void>;
}
