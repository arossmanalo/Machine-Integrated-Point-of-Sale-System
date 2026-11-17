import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import type { Actor, ServiceContext } from '@/db/types';
import type { ControllerState, MachineController } from '@/machines/MachineController';
import { MockMachineController } from '@/machines/MockMachineController';
import type { SerialMachineController } from '@/machines/SerialMachineController';
import { createUsbSerialMachineController } from '@/machines/UsbSerialMachineController';
import type { ReceiptPrinter } from '@/printing/ReceiptPrinter';
import { restoreSession } from '@/services/auth';
import { getSetting } from '@/services/settings';

interface AppState {
  ctx: ServiceContext;
  printer: ReceiptPrinter;
  controller: MachineController;
  controllerState: ControllerState;
  user: Actor | null;
  setUser: (user: Actor | null) => void;
  /** Bumped after every write so screens re-read the database. */
  version: number;
  refresh: () => void;
  /** Swap between the real USB controller and the simulated one (owner setting). */
  setSimulatedLocks: (simulate: boolean) => void;
}

const AppContext = createContext<AppState | null>(null);

function makeController(simulate: boolean): MachineController {
  return simulate ? new MockMachineController() : createUsbSerialMachineController();
}

function isSerial(controller: MachineController): controller is SerialMachineController {
  return controller.kind === 'usb';
}

export function AppProvider({
  ctx,
  printer,
  children,
}: {
  ctx: ServiceContext;
  printer: ReceiptPrinter;
  children: ReactNode;
}) {
  const [user, setUser] = useState<Actor | null>(() => restoreSession(ctx));
  const [version, setVersion] = useState(0);
  const [controller, setController] = useState<MachineController>(() =>
    makeController(getSetting(ctx.db, 'simulateMachines')),
  );
  const subscribe = useCallback(
    (onChange: () => void) => controller.onStateChange(onChange),
    [controller],
  );
  const controllerState = useSyncExternalStore(subscribe, () => controller.state());

  useEffect(() => {
    void controller.connect();
  }, [controller]);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  const setSimulatedLocks = useCallback(
    (simulate: boolean) => {
      if ((controller.kind === 'mock') === simulate) return;
      if (isSerial(controller)) void controller.dispose();
      else void controller.disconnect();
      setController(makeController(simulate));
    },
    [controller],
  );

  const value = useMemo<AppState>(
    () => ({
      ctx,
      printer,
      controller,
      controllerState,
      user,
      setUser,
      version,
      refresh,
      setSimulatedLocks,
    }),
    [ctx, printer, controller, controllerState, user, version, refresh, setSimulatedLocks],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppState {
  const state = useContext(AppContext);
  if (!state) throw new Error('useApp must be used inside AppProvider');
  return state;
}

/** The logged-in user. Only use on screens behind the login guard. */
export function useActor(): Actor {
  const { user } = useApp();
  if (!user) throw new Error('No one is logged in');
  return user;
}
