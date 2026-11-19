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

import type { Actor, Db, ServiceContext } from '@/db/types';
import type { ControllerState, MachineController } from '@/machines/MachineController';
import { MockMachineController } from '@/machines/MockMachineController';
import { normalizeAddress } from '@/machines/protocol';
import { WifiMachineController } from '@/machines/WifiMachineController';
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
  /** Rebuild the machine controller after its settings (simulate, address, key) change. */
  reloadLockController: () => void;
}

const AppContext = createContext<AppState | null>(null);

function makeController(db: Db): MachineController {
  if (getSetting(db, 'simulateMachines')) return new MockMachineController();
  return new WifiMachineController({
    baseUrl: normalizeAddress(getSetting(db, 'lockControllerAddress')),
    key: getSetting(db, 'lockControllerKey'),
  });
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
  const [controller, setController] = useState<MachineController>(() => makeController(ctx.db));
  const subscribe = useCallback(
    (onChange: () => void) => controller.onStateChange(onChange),
    [controller],
  );
  const controllerState = useSyncExternalStore(subscribe, () => controller.state());

  useEffect(() => {
    void controller.connect();
    return () => {
      void controller.disconnect();
    };
  }, [controller]);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  const reloadLockController = useCallback(() => setController(makeController(ctx.db)), [ctx.db]);

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
      reloadLockController,
    }),
    [ctx, printer, controller, controllerState, user, version, refresh, reloadLockController],
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
