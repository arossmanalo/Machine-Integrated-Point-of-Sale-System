import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

import { startCheck } from '@/services/machines';
import { Button } from '@/ui/Button';
import { Dialog } from '@/ui/controls';
import { Notice } from '@/ui/layout';
import { Text } from '@/ui/Text';

import { useData, useNow } from './hooks';
import { useToast } from './toast';

/** How long past the deadline to wait for a reading before saying the start could not be checked. */
const NO_READING_GRACE_MS = 15 * 1000;

interface Watched {
  machineId: number;
  name: string;
}

const StartWatchContext = createContext<(machineId: number, name: string) => void>(() => {});

/**
 * Real-time sync: after a start the controller accepted, waits for the machine's running signal
 * and says whether the machine started, did not start (the run was given back), or could not be
 * checked. Shown over whichever screen started the machine.
 */
export function StartWatchProvider({ children }: { children: ReactNode }) {
  const [watched, setWatched] = useState<Watched | null>(null);
  const watch = useCallback((machineId: number, name: string) => setWatched({ machineId, name }), []);
  return (
    <StartWatchContext.Provider value={watch}>
      {children}
      {watched && <StartWaitDialog key={watched.machineId} watched={watched} onClose={() => setWatched(null)} />}
    </StartWatchContext.Provider>
  );
}

export function useWatchStart(): (machineId: number, name: string) => void {
  return useContext(StartWatchContext);
}

function StartWaitDialog({ watched, onClose }: { watched: Watched; onClose: () => void }) {
  const toast = useToast();
  const now = useNow();
  const check = useData((c) => startCheck(c, watched.machineId), [watched.machineId]);
  const started = check.waitingUntil === null && check.outcome === 'started';

  useEffect(() => {
    if (!started) return;
    toast(`${watched.name} started`);
    onClose();
  }, [started, toast, watched.name, onClose]);

  if (started) return null;

  if (check.waitingUntil === null && check.outcome === 'no-signal') {
    return (
      <Dialog
        visible
        title={`${watched.name} did not start`}
        onClose={onClose}
        actions={<Button label="OK" onPress={onClose} />}
      >
        <Text>
          The machine did not report that it is running, so this run was given back and does not count against the
          order.
        </Text>
        <Text tone="muted">
          Check the machine (door closed, power on), then tap Run machine on the Machines tab to try again.
        </Text>
      </Dialog>
    );
  }

  const until = check.waitingUntil ?? now;
  if (now > until + NO_READING_GRACE_MS) {
    return (
      <Dialog
        visible
        title={`Could not check ${watched.name}`}
        onClose={onClose}
        actions={<Button label="OK" onPress={onClose} />}
      >
        <Notice tone="warning">
          The machines are not answering, so the app cannot tell whether it started. It counts as started for now.
        </Notice>
        <Text tone="muted">If it did not start, the Machines tab shows it once the machines answer again.</Text>
      </Dialog>
    );
  }

  const seconds = Math.max(0, Math.ceil((until - now) / 1000));
  return (
    <Dialog
      visible
      title={`Waiting for ${watched.name} to start`}
      onClose={onClose}
      actions={<Button label="Hide" kind="secondary" onPress={onClose} />}
    >
      <Text>{`The start was sent. Waiting for the machine to report that it is running (${seconds} s left).`}</Text>
      <Text tone="muted">If it does not start, the run is given back and the order can try again.</Text>
    </Dialog>
  );
}
