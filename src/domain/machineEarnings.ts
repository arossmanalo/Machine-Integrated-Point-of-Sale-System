import { eventCounts, type MachineEventKind, type MachineEventResult } from './dailyReport';
import { inRange, type TimeRange } from './dates';

/**
 * A rough figure for what each machine brings in: a load's price is split evenly between its
 * washer and its dryer, so each counted order start earns the machine half the price per load
 * the order was sold at. An odd centavo is dropped. Top-ups, overrides and tests are left out.
 */
export function machineShareOfLoad(pricePerLoad: number): number {
  return Math.floor(pricePerLoad / 2);
}

export interface EarningStart {
  at: number;
  kind: MachineEventKind;
  result: MachineEventResult;
  /** The order's price per load, or null when the start has no order (or it was deleted). */
  pricePerLoad: number | null;
  orderVoided: boolean;
}

export interface Earned {
  loads: number;
  amount: number;
}

export interface MachineEarnings {
  today: Earned;
  month: Earned;
  allTime: Earned;
}

function earnedIn(starts: readonly EarningStart[], range: TimeRange | null): Earned {
  const counted = starts.filter(
    (s) =>
      s.kind === 'ORDER' &&
      eventCounts(s) &&
      s.pricePerLoad !== null &&
      !s.orderVoided &&
      (range === null || inRange(s.at, range)),
  );
  return {
    loads: counted.length,
    amount: counted.reduce((sum, s) => sum + machineShareOfLoad(s.pricePerLoad ?? 0), 0),
  };
}

export function machineEarnings(
  starts: readonly EarningStart[],
  ranges: { today: TimeRange; month: TimeRange },
): MachineEarnings {
  return {
    today: earnedIn(starts, ranges.today),
    month: earnedIn(starts, ranges.month),
    allTime: earnedIn(starts, null),
  };
}
