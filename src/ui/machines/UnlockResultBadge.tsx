import type { UnlockResultCode } from '@/db/schema';

import { Badge, type BadgeTone } from '../controls';

const looks: Record<UnlockResultCode, { label: string; tone: BadgeTone }> = {
  PENDING: { label: 'No reply yet', tone: 'warning' },
  ACKED: { label: 'Unlocked', tone: 'success' },
  REJECTED: { label: 'Refused', tone: 'danger' },
  TIMEOUT: { label: 'No answer', tone: 'danger' },
  NOT_CONNECTED: { label: 'Offline', tone: 'danger' },
  DENIED: { label: 'Wrong PIN', tone: 'danger' },
};

export function UnlockResultBadge({ result }: { result: UnlockResultCode }) {
  const look = looks[result];
  return <Badge label={look.label} tone={look.tone} />;
}
