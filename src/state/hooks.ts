import { useCallback, useRef, useState, type DependencyList } from 'react';

import { errorMessage, type ServiceContext } from '@/db/types';

import { useApp } from './AppProvider';

function sameDeps(a: DependencyList, b: DependencyList): boolean {
  return a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
}

/**
 * Reads from the database during render and re-reads after any write in the app or when one
 * of `deps` changes. Queries are synchronous SQLite calls on small tables, so this stays quick.
 */
export function useData<T>(read: (ctx: ServiceContext) => T, deps: DependencyList = []): T {
  const { ctx, version } = useApp();
  const [cache, setCache] = useState<{ version: number; deps: DependencyList; value: T } | null>(
    null,
  );
  if (cache && cache.version === version && sameDeps(cache.deps, deps)) return cache.value;
  const value = read(ctx);
  setCache({ version, deps, value });
  return value;
}

export interface Action {
  busy: boolean;
  error: string | null;
  clearError: () => void;
  /** Runs a write, refreshes screens on success. Ignores taps while one is running. */
  run: <T>(work: (ctx: ServiceContext) => T | Promise<T>) => Promise<{ ok: true; value: T } | { ok: false }>;
}

export function useAction(): Action {
  const { ctx, refresh } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);

  const run = useCallback(
    async <T,>(work: (ctx: ServiceContext) => T | Promise<T>) => {
      if (running.current) return { ok: false as const };
      running.current = true;
      setBusy(true);
      setError(null);
      try {
        const value = await work(ctx);
        refresh();
        return { ok: true as const, value };
      } catch (caught: unknown) {
        setError(errorMessage(caught));
        return { ok: false as const };
      } finally {
        running.current = false;
        setBusy(false);
      }
    },
    [ctx, refresh],
  );

  const clearError = useCallback(() => setError(null), []);
  return { busy, error, clearError, run };
}
