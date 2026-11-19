import { router } from 'expo-router';
import { useState } from 'react';

import type { MachineUnlockRow } from '@/db/schema';
import { formatShopDateTime } from '@/domain/dates';
import { can } from '@/domain/permissions';
import { ALL_TIME, periodRange, type ReportPeriod } from '@/domain/reports';
import { listMachineLog } from '@/services/machines';
import { listOrderSummaries } from '@/services/orders';
import { useApp } from '@/state/AppProvider';
import { useData } from '@/state/hooks';
import { Badge, Choice } from '@/ui/controls';
import { EmptyState, ListRow, Panel, Row, Screen, Section } from '@/ui/layout';
import { StartResultBadge } from '@/ui/machines/StartResultBadge';
import { ManageScreen } from '@/ui/ManagerGate';
import { Text } from '@/ui/Text';

type Show = 'all' | 'flagged' | 'overrides';

interface Flags {
  unpaid: boolean;
  voided: boolean;
}

/** Things the owner should look at: overrides, wrong PINs, failed starts and money questions. */
function needsReview(row: MachineUnlockRow, flags: Flags | undefined): boolean {
  if (row.kind === 'OVERRIDE' || row.kind === 'OVERRIDE_DENIED') return true;
  if (row.result !== 'ACKED') return true;
  return flags !== undefined && (flags.unpaid || flags.voided);
}

const KIND_LABELS: Record<MachineUnlockRow['kind'], string> = {
  ORDER: 'Order',
  OVERRIDE: 'Override',
  OVERRIDE_DENIED: 'Override refused',
  TEST: 'Test start',
};

export default function MachineLog() {
  const { ctx } = useApp();
  const [period, setPeriod] = useState<ReportPeriod | 'All'>('Today');
  const [show, setShow] = useState<Show>('all');
  const range = period === 'All' ? ALL_TIME : periodRange(period, ctx.now());
  const data = useData(
    (c) => {
      const flags = new Map<string, Flags>();
      for (const s of listOrderSummaries(c)) {
        flags.set(s.order.id, { unpaid: s.balance > 0, voided: s.order.voidedAt !== null });
      }
      return { rows: listMachineLog(c, range), flags };
    },
    [range.start, range.end],
  );

  const rows = data.rows.filter((row) => {
    if (show === 'overrides') return row.kind === 'OVERRIDE' || row.kind === 'OVERRIDE_DENIED';
    if (show === 'flagged') return needsReview(row, row.orderId ? data.flags.get(row.orderId) : undefined);
    return true;
  });

  return (
    <ManageScreen title="Machine log" allowed={can.viewUnlockLog}>
      <Screen>
        <Choice
          value={period}
          onChange={setPeriod}
          options={[
            { value: 'Today', label: 'Today' },
            { value: 'Last 7 days', label: 'Last 7 days' },
            { value: 'This month', label: 'This month' },
            { value: 'All', label: 'All' },
          ]}
        />
        <Choice
          value={show}
          onChange={setShow}
          options={[
            { value: 'all', label: 'Everything' },
            { value: 'flagged', label: 'Needs a look' },
            { value: 'overrides', label: 'Overrides only' },
          ]}
        />
        <Section title={`${rows.length} entr${rows.length === 1 ? 'y' : 'ies'}`}>
          <Panel>
            {rows.length === 0 ? (
              <EmptyState icon="history" title="Nothing here" body="Machine starts, overrides and wrong PINs for this period appear here." />
            ) : (
              rows.map((row, index) => {
                const flags = row.orderId ? data.flags.get(row.orderId) : undefined;
                return (
                  <ListRow
                    key={row.id}
                    title={`${row.machineName} · ${KIND_LABELS[row.kind]}`}
                    subtitle={`${formatShopDateTime(row.at)} · ${row.employeeName}${row.orderId ? ` · ${row.orderId}` : ''}`}
                    meta={
                      <Row wrap>
                        {row.overrideReason && (
                          <Text variant="caption" tone="muted">
                            {`Reason: ${row.overrideReason}${row.overrideNote ? ` (${row.overrideNote})` : ''}`}
                          </Text>
                        )}
                        {flags?.unpaid && !flags.voided && <Badge label="Order unpaid" tone="warning" />}
                        {flags?.voided && <Badge label="Order voided" tone="danger" />}
                      </Row>
                    }
                    right={<StartResultBadge result={row.result} />}
                    onPress={row.orderId ? () => router.push(`/orders/${row.orderId}`) : undefined}
                    last={index === rows.length - 1}
                  />
                );
              })
            )}
          </Panel>
        </Section>
      </Screen>
    </ManageScreen>
  );
}
