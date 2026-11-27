import { describeRun, type DailyReport, type MachineEntry } from '@/domain/dailyReport';
import { formatShopDateTime, formatShopTime } from '@/domain/dates';
import { formatPeso } from '@/domain/money';

/** A4 at 72 points per inch, the size the PDF is rendered at. */
export const PDF_PAGE = { width: 595, height: 842 } as const;

/** Customer and staff names are typed in by people, so everything is escaped before it goes in. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const KIND_LABELS: Record<MachineEntry['kind'], string> = {
  ORDER: 'Order',
  OVERRIDE: 'Owner override',
  OVERRIDE_DENIED: 'Wrong owner PIN',
  TEST: 'Test start',
  TOP_UP: 'Top-up',
};

const RESULT_LABELS: Record<MachineEntry['result'], string> = {
  ACKED: 'Ran',
  PENDING: 'No reply, may have run',
  TIMEOUT: 'No answer, may have run',
  REJECTED: 'Refused, did not run',
  BUSY: 'Busy, did not run',
  FAILED: 'Not sent, did not run',
  NOT_CONNECTED: 'Offline, did not run',
  DENIED: 'Refused',
  NO_SIGNAL: 'No running signal, did not run',
};

const CHECK_LABELS = { ok: 'OK', warning: 'Check', danger: 'Look into' } as const;

function row(cells: readonly string[], className = ''): string {
  return `<tr${className ? ` class="${className}"` : ''}>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`;
}

function head(cells: readonly string[]): string {
  return `<thead><tr>${cells.map((c) => `<th>${c}</th>`).join('')}</tr></thead>`;
}

const STYLE = `
  @page { size: A4; margin: 14mm 12mm; }
  * { box-sizing: border-box; }
  body { font-family: sans-serif; color: #1c2533; font-size: 10pt; line-height: 1.4; margin: 0; }
  h1 { font-size: 17pt; margin: 0; }
  h2 { font-size: 12pt; margin: 18pt 0 6pt; border-bottom: 1px solid #c9d1dc; padding-bottom: 3pt; }
  .meta { color: #5b6676; margin: 2pt 0 0; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 8.5pt; color: #5b6676; font-weight: 600; padding: 3pt 5pt; border-bottom: 1px solid #c9d1dc; }
  td { padding: 3pt 5pt; border-bottom: 1px solid #e6eaf0; vertical-align: top; }
  tr, tbody.order { page-break-inside: avoid; break-inside: avoid; }
  .num { font-variant-numeric: tabular-nums; white-space: nowrap; }
  .sales td:last-child, .orders td:last-child, .orders th:last-child { text-align: right; }
  .sales td:first-child { color: #5b6676; }
  .total td { font-weight: 700; }
  .warning td:first-child { color: #8f5600; font-weight: 600; }
  .danger td:first-child { color: #b42318; font-weight: 600; }
  .ok td:first-child { color: #0f7a4a; font-weight: 600; }
  .muted { color: #5b6676; }
  .notrun td { color: #b42318; }
  .machine { margin-top: 10pt; font-weight: 700; }
`;

/** The daily report as an A4 page, for saving as a PDF and sending to the owner. */
export function dailyReportHtml(report: DailyReport, dayLabel: string, shopName: string, generatedAt: number): string {
  const f = report.figures;
  const e = escapeHtml;
  const sales = [
    ['Orders placed', String(f.orders)],
    ['Loads', String(f.loads)],
    ['Voided orders', String(report.voidedOrders)],
    ['Cash received', formatPeso(report.cash)],
    ['GCash received', formatPeso(report.gcash)],
    ...(f.revenueFromEarlierOrders > 0 ? [['  of which for orders placed earlier', formatPeso(f.revenueFromEarlierOrders)]] : []),
    [`Dryer top-ups (${report.topUps.count})`, formatPeso(report.topUps.amount)],
    ['Expenses', formatPeso(f.expenses)],
    ['Still owed on this day\'s orders', formatPeso(report.unpaid)],
  ];

  const checks = report.checks
    .map((check) => row([CHECK_LABELS[check.tone], e(check.text)], check.tone))
    .join('');

  const orderRows = report.orders
    .map((entry) => {
      const notes = [entry.order.voided ? 'Voided' : '', entry.placedToday ? '' : 'Earlier order'].filter(Boolean).join(', ');
      const label = `${e(entry.order.id)}<br><span class="muted">${e(entry.order.customerName)}${notes ? ` · ${notes}` : ''}</span>`;
      const loads = entry.loads.map((load, index) =>
        row([
          index === 0 ? label : '',
          String(load.number),
          e(describeRun(load.washer)),
          e(describeRun(load.dryer)),
          index === 0 ? `<span class="num">${formatPeso(entry.order.balance)}</span>` : '',
        ]),
      );
      const overrides = entry.overrides.map((run) => row(['', 'Override', e(describeRun(run)), '', '']));
      // One tbody per order so its loads stay on one page with the order number.
      return `<tbody class="order">${[...loads, ...overrides].join('')}</tbody>`;
    })
    .join('');

  const machines = report.machines
    .map((machine) => {
      const counts = [
        `${machine.orderStarts} order start${machine.orderStarts === 1 ? '' : 's'}`,
        machine.topUps ? `${machine.topUps} top-up${machine.topUps === 1 ? '' : 's'}` : '',
        machine.overrides ? `${machine.overrides} override${machine.overrides === 1 ? '' : 's'}` : '',
        machine.tests ? `${machine.tests} test${machine.tests === 1 ? '' : 's'}` : '',
      ].filter(Boolean);
      const body =
        machine.entries.length === 0
          ? '<p class="muted">Not used.</p>'
          : `<table>${head(['Time', 'What', 'Order', 'Load', 'By', 'Result'])}<tbody>${machine.entries
              .map((entry) =>
                row(
                  [
                    formatShopTime(entry.at),
                    e(
                      [KIND_LABELS[entry.kind], entry.overrideReason, entry.charge ? formatPeso(entry.charge) : null]
                        .filter(Boolean)
                        .join(' · '),
                    ),
                    entry.orderId ? `${e(entry.orderId)}${entry.customerName ? ` ${e(entry.customerName)}` : ''}` : '',
                    entry.loadNumber === null ? '' : String(entry.loadNumber),
                    e(entry.employeeName),
                    RESULT_LABELS[entry.result],
                  ],
                  entry.result === 'ACKED' ? '' : 'notrun',
                ),
              )
              .join('')}</tbody></table>`;
      return `<div class="machine">${e(machine.name)} · ${counts.join(', ')}</div>${body}`;
    })
    .join('');

  return `<!doctype html>
<html><head><meta charset="utf-8"><style>${STYLE}</style></head>
<body>
  <h1>Daily report · ${e(dayLabel)}</h1>
  <p class="meta">${e(shopName)} · made ${e(formatShopDateTime(generatedAt))}</p>

  <h2>Sales</h2>
  <table class="sales"><tbody>
    ${sales.map(([label, value]) => row([e(label), `<span class="num">${value}</span>`])).join('')}
    ${row(['Money received', `<span class="num">${formatPeso(f.revenue)}</span>`], 'total')}
    ${row(['Net (received minus expenses)', `<span class="num">${formatPeso(f.net)}</span>`], 'total')}
  </tbody></table>

  <h2>Checks</h2>
  <table><tbody>${checks}</tbody></table>

  <h2>Loads by order</h2>
  ${
    report.orders.length === 0
      ? '<p class="muted">Nothing was ordered or run on this day.</p>'
      : `<table class="orders">${head(['Order', 'Load', 'Washer', 'Dryer', 'Owes'])}${orderRows}</table>`
  }

  <h2>Machines</h2>
  ${machines}
</body></html>`;
}
