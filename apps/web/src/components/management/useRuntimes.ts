import { useCallback, useEffect, useRef, useState } from 'react';
import type { Runtime } from '@aquarium/shared';
import { api, ApiError } from '../../api';

/**
 * Phase 25 Plan 25-02 — Runtimes data hook.
 *
 * Wraps `GET /api/runtimes` (single unified endpoint — see MGMT-02 HARD
 * invariant: we never split hosted vs daemon into separate routes) and sets
 * up a 30-second polling interval so status changes surface without a manual
 * refresh.
 *
 * Diff-apply: compare the new list by id and preserve reference identity for
 * rows that are materially unchanged. This keeps React.memo stable on the
 * row components (RuntimeList memoizes per-row by id + status + heartbeat +
 * updatedAt) through idle polls.
 *
 * Errors: ApiError instances are captured into `error`; polling continues
 * regardless. MGMT-02 is read-only — no mutations are exposed.
 */

const POLL_INTERVAL_MS = 30_000;

export interface UseRuntimesResult {
  runtimes: Runtime[];
  isLoading: boolean;
  error: ApiError | null;
  refetch: () => Promise<void>;
}

function shallowEqualRuntime(a: Runtime, b: Runtime): boolean {
  return (
    a.id === b.id &&
    a.status === b.status &&
    a.lastHeartbeatAt === b.lastHeartbeatAt &&
    a.updatedAt === b.updatedAt &&
    a.name === b.name &&
    a.kind === b.kind &&
    a.provider === b.provider &&
    a.daemonId === b.daemonId &&
    a.instanceId === b.instanceId
  );
}

export function useRuntimes(): UseRuntimesResult {
  const [runtimes, setRuntimes] = useState<Runtime[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const mountedRef = useRef(true);

  const refetch = useCallback(async () => {
    try {
      const newList = await api.get<Runtime[]>('/runtimes');
      if (!mountedRef.current) return;
      setRuntimes((prev) => {
        // Diff-apply: preserve old reference when content is unchanged so
        // React.memo comparators in RuntimeRow stay stable.
        return newList.map((n) => {
          const old = prev.find((p) => p.id === n.id);
          return old && shallowEqualRuntime(old, n) ? old : n;
        });
      });
      setError(null);
    } catch (err) {
      if (!mountedRef.current) return;
      if (err instanceof ApiError) {
        setError(err);
      } else {
        setError(
          new ApiError(err instanceof Error ? err.message : 'Failed to load runtimes'),
        );
      }
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void refetch();
    const interval = setInterval(() => {
      void refetch();
    }, POLL_INTERVAL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [refetch]);

  return { runtimes, isLoading, error, refetch };
}
