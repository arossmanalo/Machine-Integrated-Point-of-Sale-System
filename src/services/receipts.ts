import { formatAmount } from '@/domain/money';
import { receiptCodeFor } from '@/domain/receiptCode';
import type { ReceiptData } from '@/printing/escpos';
import type { ServiceContext } from '@/db/types';

import { getOrderDetail } from './orders';
import { getAllSettings } from './settings';

/**
 * Everything the printer needs for one order, read fresh from the database. With an override
 * code, the receipt carries that code instead of the order's machine code.
 */
export function receiptForOrder(
  ctx: ServiceContext,
  orderId: string,
  overrideCode: string | null = null,
): ReceiptData | null {
  const detail = getOrderDetail(ctx, orderId);
  if (!detail) return null;
  const settings = getAllSettings(ctx.db);
  const { order } = detail;
  const billableLoads = order.promoApplied ? order.loadCount - 1 : order.loadCount;
  const lines = [
    {
      label: `${billableLoads} load${billableLoads === 1 ? '' : 's'} x Php ${formatAmount(order.pricePerLoad)}`,
      amount: billableLoads * order.pricePerLoad,
    },
    ...detail.items.map((item) => ({ label: `${item.name} x${item.quantity}`, amount: item.unitPrice * item.quantity })),
  ];
  const last = detail.payments[detail.payments.length - 1];
  return {
    header: settings.receiptHeader,
    footer: settings.receiptFooter,
    orderId: order.id,
    placedAt: order.placedAt,
    customerName: detail.customerName,
    service: order.service,
    weightKg: order.weightKg,
    loads: order.loadCount,
    promoApplied: order.promoApplied,
    lines,
    total: order.total,
    paid: detail.paid,
    balance: detail.balance,
    lastPayment: last ? { channel: last.channel, amount: last.amount, cashReceived: last.cashReceived } : null,
    voided: order.voidedAt !== null,
    machineCode: receiptCodeFor(order.id, order.qrToken),
    overrideCode,
  };
}
