import { useCallback, useState } from 'react';

import { buildReceipt } from '@/printing/escpos';
import { receiptForOrder } from '@/services/receipts';
import { getAllSettings } from '@/services/settings';

import { useApp } from './AppProvider';
import { useToast } from './toast';

/** Sends ready-made printer bytes to the chosen printer and reports the outcome in a toast. */
export function usePrinter() {
  const { ctx, printer } = useApp();
  const toast = useToast();
  const [printing, setPrinting] = useState(false);

  const printBytes = useCallback(
    async (makeBytes: () => Uint8Array | null, doneMessage: string) => {
      const settings = getAllSettings(ctx.db);
      if (!settings.printerAddress) {
        toast('No receipt printer chosen. Pick one in Manage > Settings.', 'danger');
        return;
      }
      const bytes = makeBytes();
      if (!bytes) return;
      setPrinting(true);
      try {
        if (!(await printer.ensurePermission())) {
          toast('Bluetooth permission is needed to print.', 'danger');
          return;
        }
        await printer.print(settings.printerAddress, bytes);
        toast(doneMessage);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown printer error';
        toast(`Printing failed: ${message}`, 'danger');
      } finally {
        setPrinting(false);
      }
    },
    [ctx, printer, toast],
  );

  return { printBytes, printing };
}

/** Prints an order's receipt on the chosen printer. */
export function usePrintReceipt() {
  const { ctx } = useApp();
  const { printBytes, printing } = usePrinter();

  const print = useCallback(
    (orderId: string) =>
      printBytes(() => {
        const data = receiptForOrder(ctx, orderId);
        return data ? buildReceipt(data) : null;
      }, `Receipt for ${orderId} printed`),
    [ctx, printBytes],
  );

  return { print, printing };
}
