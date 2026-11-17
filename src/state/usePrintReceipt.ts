import { useCallback, useState } from 'react';

import { buildReceipt } from '@/printing/escpos';
import { receiptForOrder } from '@/services/receipts';
import { getAllSettings } from '@/services/settings';

import { useApp } from './AppProvider';
import { useToast } from './toast';

/** Prints an order's receipt on the chosen printer and reports the outcome in a toast. */
export function usePrintReceipt() {
  const { ctx, printer } = useApp();
  const toast = useToast();
  const [printing, setPrinting] = useState(false);

  const print = useCallback(
    async (orderId: string) => {
      const settings = getAllSettings(ctx.db);
      if (!settings.printerAddress) {
        toast('No receipt printer chosen. Pick one in Manage > Settings.', 'danger');
        return;
      }
      const data = receiptForOrder(ctx, orderId);
      if (!data) return;
      setPrinting(true);
      try {
        if (!(await printer.ensurePermission())) {
          toast('Bluetooth permission is needed to print.', 'danger');
          return;
        }
        await printer.print(settings.printerAddress, buildReceipt(data));
        toast(`Receipt for ${orderId} printed`);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown printer error';
        toast(`Printing failed: ${message}`, 'danger');
      } finally {
        setPrinting(false);
      }
    },
    [ctx, printer, toast],
  );

  return { print, printing };
}
