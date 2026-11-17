import type { Centavos } from './money';

export const PAYMENT_METHODS = ['FULL_PAYMENT', 'DOWN_PAYMENT', 'PAY_LATER'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  FULL_PAYMENT: 'Full payment',
  DOWN_PAYMENT: 'Down payment',
  PAY_LATER: 'Pay later',
};

export const PAYMENT_CHANNELS = ['CASH', 'GCASH'] as const;
export type PaymentChannel = (typeof PAYMENT_CHANNELS)[number];

export const PAYMENT_CHANNEL_LABELS: Record<PaymentChannel, string> = {
  CASH: 'Cash',
  GCASH: 'GCash',
};

export function sumPaid(payments: readonly { amount: Centavos }[]): Centavos {
  return payments.reduce((sum, p) => sum + p.amount, 0);
}

export function balanceDue(total: Centavos, paid: Centavos): Centavos {
  return Math.max(0, total - paid);
}

/** A payment never takes more than what is still owed. */
export function amountToApply(requested: Centavos, outstanding: Centavos): Centavos {
  return Math.max(0, Math.min(requested, outstanding));
}

export function changeDue(cashReceived: Centavos, amount: Centavos): Centavos {
  return Math.max(0, cashReceived - amount);
}

export interface PaymentRecord {
  amount: Centavos;
  receivedAt: number;
}

/** When the balance first reached zero, or null while something is still owed. */
export function fullyPaidAt(total: Centavos, payments: readonly PaymentRecord[]): number | null {
  const ordered = [...payments].sort((a, b) => a.receivedAt - b.receivedAt);
  if (total <= 0) return ordered[0]?.receivedAt ?? null;
  let running = 0;
  for (const payment of ordered) {
    running += payment.amount;
    if (running >= total) return payment.receivedAt;
  }
  return null;
}
