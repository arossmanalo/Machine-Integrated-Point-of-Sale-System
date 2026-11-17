/** 10+1 promo: every 10 paid loads earn one free load on the next order. */
export const LOADS_PER_FREE_LOAD = 10;

export function isPromoEligible(loyaltyLoads: number): boolean {
  return loyaltyLoads >= LOADS_PER_FREE_LOAD;
}

/** Counter after an order. The free load itself does not earn loyalty. */
export function loyaltyAfterOrder(
  current: number,
  billableLoads: number,
  promoApplied: boolean,
): number {
  const spent = promoApplied ? LOADS_PER_FREE_LOAD : 0;
  return Math.max(0, current - spent + billableLoads);
}

/** Counter after an order is voided: give back what it spent, take back what it earned. */
export function loyaltyAfterVoid(
  current: number,
  billableLoads: number,
  promoApplied: boolean,
): number {
  const refunded = promoApplied ? LOADS_PER_FREE_LOAD : 0;
  return Math.max(0, current - billableLoads + refunded);
}
