import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

import { startCheck } from '@/services/machines';
import { Button } from '@/ui/Button';
import { Dialog } from '@/ui/controls';
import { Notice } from '@/ui/layout';
import { Text } from '@/ui/Text';

import { useApp } from './AppProvider';
import { useData } from './hooks';
import { useToast } from './toast';

interface Watched {
  machineId: number;
  name: string;
}

const StartWatchContext = createContext<(machineId: number, name: string) => void>(() => {});

/**
 * Real-time sync: once a start's coins are sent, tells staff to press Start on the machine and
 * waits, for as long as it takes, for the machine's running signal. Shown over whichever screen
 * started the machine.
 */
export function StartWatchProvider({ children }: { children: ReactNode }) {
  const [watched, setWatched] = useState<Watched | null>(null);
  const watch = useCallback((machineId: number, name: string) => setWatched({ machineId, name }), []);
  const close = useCallback(() => setWatched(null), []);
  return (
    <StartWatchContext.Provider value={watch}>
      {children}
      {watched && <PressStartDialog key={watched.machineId} watched={watched} onClose={close} />}
    </StartWatchContext.Provider>
  );
}

export function useWatchStart(): (machineId: number, name: string) => void {
  return useContext(StartWatchContext);
}

function PressStartDialog({ watched, onClose }: { watched: Watched; onClose: () => void }) {
  const toast = useToast();
  const { controllerState } = useApp();
  const check = useData((c) => startCheck(c, watched.machineId), [watched.machineId]);
  // Running: staff pressed Start. Neither: the wait was ended (Mark as done, switched off).
  const finished = !check.awaitingStart;

  useEffect(() => {
    if (!finished) return;
    if (check.running) toast(`${watched.name} is running`);
    onClose();
  }, [finished, check.running, toast, watched.name, onClose]);

  if (finished) return null;
  return (
    <Dialog
      visible
      title={`Press Start on ${watched.name}`}
      onClose={onClose}
      actions={<Button label="Hide" kind="secondary" onPress={onClose} />}
    >
      <Text>{`The coins were sent to ${watched.name}. Choose the program on the machine and press its Start button.`}</Text>
      <Text tone="muted">This closes by itself as soon as the machine reports that it is running.</Text>
      {controllerState.status !== 'ready' && (
        <Notice tone="warning">
          The machines are not answering right now. The app keeps waiting and updates once they answer again.
        </Notice>
      )}
    </Dialog>
  );
}
