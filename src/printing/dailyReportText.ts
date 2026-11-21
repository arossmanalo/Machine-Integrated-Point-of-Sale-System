import type { DailyReport, LoadRun, MachineEntry } from '@/domain/dailyReport';
import { formatShopTime } from '@/domain/dates';
import { formatAmount } from '@/domain/money';

import { LINE_WIDTH, toPrintable, twoColumns } from './escpos';

const php = (centavos: number) => `Php ${formatAmount(centavos)}`;
const rule = '-'.repeat(LINE_WIDTH);

/** Breaks text at spaces so no line is wider than the paper; later lines get the indent. */
export function wrap(text: string, indent = '', width = LINE_WIDTH): string[] {
  const lead = /^ */.exec(text)?.[0] ?? '';
  const lines: string[] = [];
  let line = '';
  for (const word of text.slice(lead.length).split(' ')) {
    const prefix = lines.length === 0 ? lead : indent;
    const candidate = line ? `${line} ${word}` : `${prefix}${word}`;
    if (candidate.length <= width || !line) {
      line = candidate;
    } else {
      lines.push(line);
      line = `${indent}${word}`;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function runText(label: string, run: LoadRun | null): string {
  if (!run) return `${label}: -`;
  const sentNothing = run.result === 'TIMEOUT' ? ' (no answer)' : run.result === 'PENDING' ? ' (no reply)' : '';
  const topUps = run.topUps > 0 ? ` +${run.topUps} top-up${run.topUps === 1 ? '' : 's'}` : '';
  return `${label}: ${run.machineName} ${formatShopTime(run.at)}${topUps}${sentNothing}`;
}

const ENTRY_KINDS: Record<MachineEntry['kind'], string> = {
  ORDER: '',
  OVERRIDE: 'OVERRIDE',
  OVERRIDE_DENIED: 'WRONG PIN',
  TEST: 'TEST',
  TOP_UP: 'TOP-UP',
};

const RESULT_NOTES: Partial<Record<MachineEntry['result'], string>> = {
  REJECTED: 'refused',
  BUSY: 'busy, not sent',
  FAILED: 'not sent',
  TIMEOUT: 'no answer',
  NOT_CONNECTED: 'offline, not sent',
  PENDING: 'no reply',
};

function entryText(entry: MachineEntry): string {
  const parts = [
    formatShopTime(entry.at),
    ENTRY_KINDS[entry.kind],
    entry.orderId ?? '',
    entry.loadNumber !== null ? `load ${entry.loadNumber}` : '',
    entry.kind === 'OVERRIDE' && entry.overrideReason ? entry.overrideReason : '',
    entry.charge ? php(entry.charge) : '',
    entry.employeeName,
    RESULT_NOTES[entry.result] ? `(${RESULT_NOTES[entry.result]})` : '',
  ];
  return parts.filter(Boolean).join(' ');
}

/** The daily report as plain lines for the 58 mm printer, also used for sharing as text. */
export function dailyReportLines(report: DailyReport, dayLabel: string): string[] {
  const f = report.figures;
  const lines: string[] = [
    'DAILY REPORT',
    dayLabel,
    rule,
    'SALES',
    twoColumns('Orders', String(f.orders)),
    twoColumns('Loads', String(f.loads)),
    twoColumns('Voided orders', String(report.voidedOrders)),
    twoColumns('Money received', php(f.revenue)),
    twoColumns('  Cash', php(report.cash)),
    twoColumns('  GCash', php(report.gcash)),
  ];
  if (f.revenueFromEarlierOrders > 0) lines.push(twoColumns('  For earlier orders', php(f.revenueFromEarlierOrders)));
  lines.push(
    twoColumns(`Dryer top-ups (${report.topUps.count})`, php(report.topUps.amount)),
    twoColumns('Expenses', php(f.expenses)),
    twoColumns('Net', php(f.net)),
    twoColumns('Still owed today', php(report.unpaid)),
    rule,
    'LOADS BY ORDER',
  );
  if (report.orders.length === 0) lines.push('No orders.');
  for (const entry of report.orders) {
    const flags = [entry.order.voided ? 'VOIDED' : '', entry.placedToday ? '' : 'earlier order'].filter(Boolean);
    lines.push(...wrap(`${entry.order.id} ${entry.order.customerName}${flags.length ? ` (${flags.join(', ')})` : ''}`, '  '));
    for (const load of entry.loads) {
      lines.push(...wrap(`  Load ${load.number} ${runText('W', load.washer)}`, '    '));
      lines.push(...wrap(`         ${runText('D', load.dryer)}`, '    '));
    }
    for (const run of entry.overrides) lines.push(...wrap(`  ${runText('Override', run)}`, '    '));
  }
  lines.push(rule, 'MACHINES');
  for (const machine of report.machines) {
    const counts = [
      `${machine.orderStarts} start${machine.orderStarts === 1 ? '' : 's'}`,
      machine.topUps ? `${machine.topUps} top-up${machine.topUps === 1 ? '' : 's'}` : '',
      machine.overrides ? `${machine.overrides} override${machine.overrides === 1 ? '' : 's'}` : '',
      machine.tests ? `${machine.tests} test${machine.tests === 1 ? '' : 's'}` : '',
    ].filter(Boolean);
    lines.push(...wrap(`${machine.name}: ${counts.join(', ')}`, '  '));
    for (const entry of machine.entries) lines.push(...wrap(`  ${entryText(entry)}`, '    '));
  }
  lines.push(rule, 'CHECKS');
  for (const check of report.checks) {
    const mark = check.tone === 'ok' ? '' : '! ';
    lines.push(...wrap(`${mark}${check.text}`, '  '));
  }
  return lines.map(toPrintable);
}
