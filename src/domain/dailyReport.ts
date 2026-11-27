import { formatShopTime, inRange, type TimeRange } from './dates';
import { machineAllowance, type MachineType } from './machinePolicy';
import type { Centavos } from './money';
import type { PaymentChannel } from './payments';
import { periodFigures, type PeriodFigures } from './reports';

/*
 * The daily report ties the money to the machines so the counts can be checked against each
 * other: every load sold should show one washer start and one dryer start, and every start
 * should belong to an order. Orders count on the day they were placed; machine starts count on
 * the day they ran.
 */

export type MachineEventKind = 'ORDER' | 'OVERRIDE' | 'OVERRIDE_DENIED' | 'TEST' | 'TOP_UP';
export type MachineEventResult =
  | 'PENDING'
  | 'ACKED'
  | 'REJECTED'
  | 'BUSY'
  | 'FAILED'
  | 'TIMEOUT'
  | 'NOT_CONNECTED'
  | 'DENIED'
  | 'NO_SIGNAL';

export interface DayOrder {
  id: string;
  customerName: string;
  placedAt: number;
  loadCount: number;
  /** Dry-only orders have no washer starts to expect. */
  service: string;
  status: string;
  total: Centavos;
  paid: Centavos;
  balance: Centavos;
  voided: boolean;
}

export interface DayPayment {
  orderId: string;
  amount: Centavos;
  channel: PaymentChannel;
  receivedAt: number;
}

export interface DayExpense {
  cost: Centavos;
  incurredAt: number;
}

export interface DayMachine {
  id: number;
  name: string;
  type: MachineType;
}

export interface DayMachineEvent {
  id: number;
  at: number;
  machineId: number | null;
  machineName: string;
  machineType: MachineType;
  orderId: string | null;
  employeeName: string;
  kind: MachineEventKind;
  result: MachineEventResult;
  charge: Centavos | null;
  overrideReason: string | null;
}

export interface DailyReportInput {
  range: TimeRange;
  orders: readonly DayOrder[];
  payments: readonly DayPayment[];
  expenses: readonly DayExpense[];
  machines: readonly DayMachine[];
  /** Every logged machine event, so loads of orders placed earlier still get their numbers. */
  events: readonly DayMachineEvent[];
}

/** The machine may have run: the start went out, or nobody knows if it did. */
export function eventCounts(event: Pick<DayMachineEvent, 'result'>): boolean {
  return event.result === 'ACKED' || event.result === 'TIMEOUT' || event.result === 'PENDING';
}

export interface LoadRun {
  machineName: string;
  at: number;
  employeeName: string;
  result: MachineEventResult;
  topUps: number;
  topUpCharge: Centavos;
}

export interface OrderLoads {
  order: DayOrder;
  placedToday: boolean;
  loads: { number: number; washer: LoadRun | null; dryer: LoadRun | null }[];
  /** Owner overrides that named this order (rewashes and the like). */
  overrides: LoadRun[];
}

export interface MachineEntry {
  id: number;
  at: number;
  kind: MachineEventKind;
  orderId: string | null;
  customerName: string | null;
  /** Which load of the order this start ran, for order starts that went out. */
  loadNumber: number | null;
  employeeName: string;
  result: MachineEventResult;
  charge: Centavos | null;
  overrideReason: string | null;
}

export interface MachineDay {
  name: string;
  type: MachineType;
  entries: MachineEntry[];
  orderStarts: number;
  topUps: number;
  overrides: number;
  tests: number;
}

export interface DayCheck {
  tone: 'ok' | 'warning' | 'danger';
  text: string;
}

export interface DailyReport {
  figures: PeriodFigures;
  cash: Centavos;
  gcash: Centavos;
  voidedOrders: number;
  /** Still owed on today's orders. */
  unpaid: Centavos;
  topUps: { count: number; amount: Centavos };
  orders: OrderLoads[];
  machines: MachineDay[];
  checks: DayCheck[];
}

function toRun(event: DayMachineEvent): LoadRun {
  return {
    machineName: event.machineName,
    at: event.at,
    employeeName: event.employeeName,
    result: event.result,
    topUps: 0,
    topUpCharge: 0,
  };
}

export interface OrderMachineHistory {
  loads: OrderLoads['loads'];
  overrides: LoadRun[];
  loadNumbers: Map<number, number>;
}

/**
 * The nth washer start of an order that went out ran load n, and so did the nth dryer start.
 * A top-up belongs to the latest dryer run of the order on that dryer before it.
 */
export function orderHistory(
  order: Pick<DayOrder, 'id' | 'loadCount'>,
  events: readonly DayMachineEvent[],
): OrderMachineHistory {
  const mine = events.filter((e) => e.orderId === order.id && eventCounts(e)).sort((a, b) => a.at - b.at || a.id - b.id);
  const washers: LoadRun[] = [];
  const dryers: LoadRun[] = [];
  const dryerRuns: { machineName: string; run: LoadRun }[] = [];
  const overrides: LoadRun[] = [];
  const loadNumbers = new Map<number, number>();
  for (const event of mine) {
    if (event.kind === 'ORDER') {
      const list = event.machineType === 'WASHER' ? washers : dryers;
      const run = toRun(event);
      list.push(run);
      loadNumbers.set(event.id, list.length);
      if (event.machineType === 'DRYER') dryerRuns.push({ machineName: event.machineName, run });
    } else if (event.kind === 'OVERRIDE') {
      const run = toRun(event);
      overrides.push(run);
      if (event.machineType === 'DRYER') dryerRuns.push({ machineName: event.machineName, run });
    } else if (event.kind === 'TOP_UP') {
      const target = [...dryerRuns].reverse().find((d) => d.machineName === event.machineName);
      if (target) {
        target.run.topUps += 1;
        target.run.topUpCharge += event.charge ?? 0;
      }
    }
  }
  const count = Math.max(order.loadCount, washers.length, dryers.length);
  const loads = Array.from({ length: count }, (_, i) => ({
    number: i + 1,
    washer: washers[i] ?? null,
    dryer: dryers[i] ?? null,
  }));
  return { loads, overrides, loadNumbers };
}

export function buildDailyReport(input: DailyReportInput): DailyReport {
  const { range } = input;
  const figures = periodFigures(input, range);
  const orderById = new Map(input.orders.map((o) => [o.id, o]));
  const today = (ms: number) => inRange(ms, range);
  const dayEvents = input.events.filter((e) => today(e.at)).sort((a, b) => a.at - b.at || a.id - b.id);

  let cash = 0;
  let gcash = 0;
  for (const payment of input.payments) {
    const order = orderById.get(payment.orderId);
    if (!today(payment.receivedAt) || order?.voided) continue;
    if (payment.channel === 'CASH') cash += payment.amount;
    else gcash += payment.amount;
  }

  const placedToday = input.orders.filter((o) => today(o.placedAt));
  const ranToday = new Set(dayEvents.map((e) => e.orderId).filter((id): id is string => id !== null));
  const reportOrders = input.orders
    .filter((o) => today(o.placedAt) || ranToday.has(o.id))
    .sort((a, b) => a.placedAt - b.placedAt || a.id.localeCompare(b.id));

  const loadNumbers = new Map<number, number>();
  const orders: OrderLoads[] = reportOrders.map((order) => {
    const history = orderHistory(order, input.events);
    for (const [eventId, number] of history.loadNumbers) loadNumbers.set(eventId, number);
    return { order, placedToday: today(order.placedAt), loads: history.loads, overrides: history.overrides };
  });

  const machineKey = (e: { machineId: number | null; machineName: string }) =>
    e.machineId === null ? `name:${e.machineName}` : `id:${e.machineId}`;
  const machineDays = new Map<string, MachineDay>();
  for (const machine of input.machines) {
    machineDays.set(`id:${machine.id}`, {
      name: machine.name,
      type: machine.type,
      entries: [],
      orderStarts: 0,
      topUps: 0,
      overrides: 0,
      tests: 0,
    });
  }
  for (const event of dayEvents) {
    const key = machineKey(event);
    const day = machineDays.get(key) ?? {
      name: event.machineName,
      type: event.machineType,
      entries: [],
      orderStarts: 0,
      topUps: 0,
      overrides: 0,
      tests: 0,
    };
    machineDays.set(key, day);
    day.entries.push({
      id: event.id,
      at: event.at,
      kind: event.kind,
      orderId: event.orderId,
      customerName: event.orderId ? (orderById.get(event.orderId)?.customerName ?? null) : null,
      loadNumber: loadNumbers.get(event.id) ?? null,
      employeeName: event.employeeName,
      result: event.result,
      charge: event.charge,
      overrideReason: event.overrideReason,
    });
    if (!eventCounts(event)) continue;
    if (event.kind === 'ORDER') day.orderStarts += 1;
    else if (event.kind === 'TOP_UP') day.topUps += 1;
    else if (event.kind === 'OVERRIDE') day.overrides += 1;
    else if (event.kind === 'TEST') day.tests += 1;
  }
  const machines = [...machineDays.values()].sort(
    (a, b) => (a.type === b.type ? 0 : a.type === 'DRYER' ? -1 : 1) || a.name.localeCompare(b.name),
  );

  const topUpEvents = dayEvents.filter((e) => e.kind === 'TOP_UP' && eventCounts(e));
  const topUps = { count: topUpEvents.length, amount: topUpEvents.reduce((sum, e) => sum + (e.charge ?? 0), 0) };
  const liveToday = placedToday.filter((o) => !o.voided);

  return {
    figures,
    cash,
    gcash,
    voidedOrders: placedToday.filter((o) => o.voided).length,
    unpaid: liveToday.reduce((sum, o) => sum + o.balance, 0),
    topUps,
    orders,
    machines,
    checks: dayChecks(orders, dayEvents, orderById),
  };
}

function dayChecks(
  orders: readonly OrderLoads[],
  dayEvents: readonly DayMachineEvent[],
  orderById: ReadonlyMap<string, DayOrder>,
): DayCheck[] {
  const checks: DayCheck[] = [];
  const sold = orders.filter((o) => o.placedToday && !o.order.voided);
  const loads = sold.reduce((sum, o) => sum + o.order.loadCount, 0);
  const washLoads = sold.reduce((sum, o) => sum + machineAllowance(o.order, 'WASHER'), 0);
  const washed = sold.reduce((sum, o) => sum + o.loads.filter((l) => l.number <= o.order.loadCount && l.washer).length, 0);
  const dried = sold.reduce((sum, o) => sum + o.loads.filter((l) => l.number <= o.order.loadCount && l.dryer).length, 0);
  checks.push({
    tone: washed === washLoads && dried === loads ? 'ok' : 'warning',
    text: `${loads} load${loads === 1 ? '' : 's'} sold today: ${washed} washer start${washed === 1 ? '' : 's'}, ${dried} dryer start${dried === 1 ? '' : 's'}.`,
  });
  for (const entry of sold) {
    for (const load of entry.loads) {
      if (load.number > entry.order.loadCount) continue;
      const needsWasher = machineAllowance(entry.order, 'WASHER') > 0;
      const missing = [load.washer || !needsWasher ? null : 'washer', load.dryer ? null : 'dryer'].filter(Boolean);
      if (missing.length > 0) {
        checks.push({
          tone: 'warning',
          text: `${entry.order.id} load ${load.number} has no ${missing.join(' or ')} start yet.`,
        });
      }
    }
  }

  const counted = dayEvents.filter(eventCounts);
  const orderStarts = counted.filter((e) => e.kind === 'ORDER');
  const earlier = orderStarts.filter((e) => {
    const order = e.orderId ? orderById.get(e.orderId) : undefined;
    return order !== undefined && !orders.find((o) => o.order.id === order.id)?.placedToday;
  });
  if (earlier.length > 0) {
    checks.push({ tone: 'ok', text: `${earlier.length} start${earlier.length === 1 ? '' : 's'} today for orders placed on earlier days.` });
  }
  const count = (list: readonly unknown[], one: string, many: string) => `${list.length} ${list.length === 1 ? one : many}`;
  const overrides = counted.filter((e) => e.kind === 'OVERRIDE');
  if (overrides.length > 0) checks.push({ tone: 'warning', text: `${count(overrides, 'owner override', 'owner overrides')} (no order allowance used).` });
  const tests = counted.filter((e) => e.kind === 'TEST');
  if (tests.length > 0) checks.push({ tone: 'warning', text: `${count(tests, 'test start', 'test starts')}.` });
  const noAnswer = dayEvents.filter((e) => e.result === 'TIMEOUT');
  if (noAnswer.length > 0) checks.push({ tone: 'danger', text: `${count(noAnswer, 'start', 'starts')} got no answer; the machine may have run.` });
  const denied = dayEvents.filter((e) => e.kind === 'OVERRIDE_DENIED');
  if (denied.length > 0) checks.push({ tone: 'danger', text: `${count(denied, 'wrong owner PIN', 'wrong owner PINs')}.` });
  const onVoided = orderStarts.filter((e) => e.orderId !== null && orderById.get(e.orderId)?.voided);
  if (onVoided.length > 0) checks.push({ tone: 'danger', text: `${count(onVoided, 'start', 'starts')} for orders that were later voided.` });
  const unpaidIds = new Set(
    orderStarts
      .map((e) => (e.orderId ? orderById.get(e.orderId) : undefined))
      .filter((o): o is DayOrder => o !== undefined && !o.voided && o.balance > 0)
      .map((o) => o.id),
  );
  if (unpaidIds.size > 0) {
    checks.push({ tone: 'warning', text: `Machines ran for ${unpaidIds.size} order${unpaidIds.size === 1 ? '' : 's'} not fully paid: ${[...unpaidIds].join(', ')}.` });
  }
  return checks;
}

/** "Washer 1 9:05 AM (+1 top-up)", or "not started", for one load's washer or dryer run. */
export function describeRun(run: LoadRun | null): string {
  if (!run) return 'not started';
  const topUps = run.topUps > 0 ? ` (+${run.topUps} top-up${run.topUps === 1 ? '' : 's'})` : '';
  const unsure = run.result === 'ACKED' ? '' : ' (no answer)';
  return `${run.machineName} ${formatShopTime(run.at)}${topUps}${unsure}`;
}
