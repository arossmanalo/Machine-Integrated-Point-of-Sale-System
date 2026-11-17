import { PermissionsAndroid, Platform } from 'react-native';

import ReceiptPrinterModule from '../../modules/receipt-printer';

import { toBase64 } from './escpos';
import type { PrinterInfo, ReceiptPrinter } from './ReceiptPrinter';

const ANDROID_12 = 31;

export const bluetoothReceiptPrinter: ReceiptPrinter = {
  async ensurePermission() {
    if (Platform.OS !== 'android' || Number(Platform.Version) < ANDROID_12) return true;
    const permission = PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT;
    if (await PermissionsAndroid.check(permission)) return true;
    const result = await PermissionsAndroid.request(permission, {
      title: 'Bluetooth for the receipt printer',
      message: 'Laundry POS needs Bluetooth to print receipts on the paired printer.',
      buttonPositive: 'Allow',
    });
    return result === PermissionsAndroid.RESULTS.GRANTED;
  },
  listPrinters(): Promise<PrinterInfo[]> {
    return ReceiptPrinterModule.listPairedPrinters();
  },
  print(address, receipt) {
    return ReceiptPrinterModule.print(address, toBase64(receipt));
  },
};
