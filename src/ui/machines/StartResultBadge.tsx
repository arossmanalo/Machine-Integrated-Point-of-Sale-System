import type { UnlockResultCode } from '@/db/schema';

import { Badge, type BadgeTone } from '../controls';

const looks: Record<UnlockResultCode, { label: string; tone: BadgeTone }> = {
  PENDING: { label: 'No reply yet', tone: 'warning' },
  ACKED: { label: 'Started', tone: 'success' },
  REJECTED: { label: 'Refused', tone: 'danger' },
  BUSY: { label: 'Busy', tone: 'warning' },
  FAILED: { label: 'Not sent', tone: 'danger' },
  TIMEOUT: { label: 'No answer', tone: 'danger' },
  NOT_CONNECTED: { label: 'Offline', tone: 'danger' },
  DENIED: { label: 'Wrong PIN', tone: 'danger' },
  NO_SIGNAL: { label: 'Did not start', tone: 'danger' },
};

export function StartResultBadge({ result }: { result: UnlockResultCode }) {
  const look = looks[result];
  return <Badge label={look.label} tone={look.tone} />;
}
