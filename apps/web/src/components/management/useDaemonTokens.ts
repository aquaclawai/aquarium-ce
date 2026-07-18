import { useCallback, useEffect, useState } from 'react';
import type { DaemonToken } from '@aquarium/shared';
import { api, ApiError } from '../../api';

/**
 * Phase 25 Plan 25-03 — Daemon-tokens data hook.
 *
 * Wraps GET /api/daemon-tokens (hashed-only projection) + DELETE
 * /api/daemon-tokens/:id (soft revoke). There is deliberately NO `create`
 * method on this hook — the POST response's sensitive adt_* string lives
 * solely in the local React state of `DaemonTokenCreateModal`. Routing
 * the sensitive string through this hook's state would expose it to the
 * parent page and widen the surface in violation of the MGMT-03 HARD
 * invariant.
 *
 * Refetch strategy: full refetch on revoke. The create flow triggers
 * refetch from the page after the modal dismisses, so the new row appears
 * without the hook ever holding the sensitive string.
 */

export interface UseDaemonTokensResult {
  tokens: DaemonToken[];
  isLoading: boolean;
  error: ApiError | null;
  refetch: () => Promise<void>;
  revoke: (id: string) => Promise<void>;
}

export function useDaemonTokens(): UseDaemonTokensResult {
  const [tokens, setTokens] = useState<DaemonToken[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    try {
      const list = await api.get<DaemonToken[]>('/daemon-tokens');
      setTokens(list);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err);
      } else {
        setError(
          new ApiError(
            err instanceof Error ? err.message : 'Failed to load daemon tokens',
          ),
        );
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const revoke = useCallback(
    async (id: string): Promise<void> => {
      await api.delete<{ ok: boolean }>(`/daemon-tokens/${id}`);
      await refetch();
    },
    [refetch],
  );

  return { tokens, isLoading, error, refetch, revoke };
}
