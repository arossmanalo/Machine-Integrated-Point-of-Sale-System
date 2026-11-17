import type { Centavos } from './money';

/** The only service sold. Orders imported from the old app may carry WASH or WASH_DRY. */
export const CURRENT_SERVICE = 'WASH_DRY_FOLD';
export const SERVICES = ['WASH', 'WASH_DRY', 'WASH_DRY_FOLD'] as const;
export type Service = (typeof SERVICES)[number];

export const SERVICE_LABELS: Record<Service, string> = {
  WASH: 'Wash',
  WASH_DRY: 'Wash & dry',
  WASH_DRY_FOLD: 'Wash, dry & fold',
};

export const DEFAULT_PRICE_PER_LOAD: Centavos = 22000;

export interface LoadRange {
  min: number;
  max: number;
  recommended: number;
}

/** A machine takes at most 10 kg; 8 kg per load is the comfortable fill the shop recommends. */
export function loadRangeForWeight(weightKg: number): LoadRange {
  if (!(weightKg > 0)) return { min: 1, max: 1, recommended: 1 };
  const min = Math.max(1, Math.ceil(weightKg / 10));
  const recommended = Math.max(min, Math.ceil(weightKg / 8));
  return { min, max: recommended, recommended };
}

export interface AddOnLine {
  unitPrice: Centavos;
  quantity: number;
}

export interface OrderTotalInput {
  loads: number;
  pricePerLoad: Centavos;
  promoApplied: boolean;
  addOns: readonly AddOnLine[];
}

export interface OrderTotal {
  billableLoads: number;
  loadsSubtotal: Centavos;
  addOnsTotal: Centavos;
  total: Centavos;
}

export function computeOrderTotal(input: OrderTotalInput): OrderTotal {
  const billableLoads = input.promoApplied && input.loads > 0 ? input.loads - 1 : input.loads;
  const loadsSubtotal = billableLoads * input.pricePerLoad;
  const addOnsTotal = input.addOns.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
  return { billableLoads, loadsSubtotal, addOnsTotal, total: loadsSubtotal + addOnsTotal };
}
