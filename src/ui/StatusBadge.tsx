import { statusLabel } from '@/domain/statuses';

import { Badge, type BadgeTone } from './controls';

const tones: Record<string, BadgeTone> = {
  PENDING: 'warning',
  WASHING: 'accent',
  READY: 'success',
  COMPLETED: 'neutral',
  AUDITED: 'neutral',
};

export function StatusBadge({ status, voided = false }: { status: string; voided?: boolean }) {
  if (voided) return <Badge label="Voided" tone="danger" />;
  return <Badge label={statusLabel(status)} tone={tones[status] ?? 'accent'} />;
}

export function BalanceBadge({ balance }: { balance: number }) {
  return balance > 0 ? <Badge label="Unpaid" tone="danger" /> : <Badge label="Paid" tone="success" />;
}
