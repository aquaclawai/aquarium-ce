import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../../api';
import type { Agent } from '@aquarium/shared';

/**
 * Phase 25 Plan 25-01 — Agents data hook.
 *
 * Wraps the shipped `/api/agents` REST endpoints (GET list, POST create,
 * PATCH update, DELETE archive, POST /:id/restore) into a single hook
 * returning active + archived splits plus mutation methods.
 *
 * Refetch strategy: full refetch on every mutation (per UI-SPEC — WebSocket
 * reconciliation is an optional Wave 2 enhancement). Errors are swallowed
 * into `error` state; callers toast as appropriate.
 */

export interface AgentCreatePayload {
  name: string;
  instructions?: string;
  runtimeId?: string | null;
  customEnv?: Record<string, string>;
  customArgs?: string[];
  maxConcurrentTasks?: number;
}

export interface AgentUpdatePayload {
  name?: string;
  instructions?: string;
  runtimeId?: string | null;
  customEnv?: Record<string, string>;
  customArgs?: string[];
  maxConcurrentTasks?: number;
}

export interface UseAgentsResult {
  active: Agent[];
  archived: Agent[];
  isLoading: boolean;
  error: ApiError | null;
  refetch: () => Promise<void>;
  create: (payload: AgentCreatePayload) => Promise<Agent>;
  update: (id: string, payload: AgentUpdatePayload) => Promise<Agent>;
  archive: (id: string) => Promise<Agent>;
  restore: (id: string) => Promise<Agent>;
}

export function useAgents(): UseAgentsResult {
  const [active, setActive] = useState<Agent[]>([]);
  const [archived, setArchived] = useState<Agent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [activeList, includeArchivedList] = await Promise.all([
        api.get<Agent[]>('/agents'),
        api.get<Agent[]>('/agents?includeArchived=true'),
      ]);
      setActive(activeList);
      // Derive archived = includeArchived minus active-id set.
      const activeIds = new Set(activeList.map((a) => a.id));
      setArchived(includeArchivedList.filter((a) => !activeIds.has(a.id)));
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err);
      } else {
        setError(new ApiError(err instanceof Error ? err.message : 'Failed to load agents'));
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const create = useCallback(async (payload: AgentCreatePayload): Promise<Agent> => {
    const created = await api.post<Agent>('/agents', payload);
    await refetch();
    return created;
  }, [refetch]);

  const update = useCallback(async (id: string, payload: AgentUpdatePayload): Promise<Agent> => {
    const updated = await api.patch<Agent>(`/agents/${id}`, payload);
    await refetch();
    return updated;
  }, [refetch]);

  const archive = useCallback(async (id: string): Promise<Agent> => {
    const archivedAgent = await api.delete<Agent>(`/agents/${id}`);
    await refetch();
    return archivedAgent;
  }, [refetch]);

  const restore = useCallback(async (id: string): Promise<Agent> => {
    const restored = await api.post<Agent>(`/agents/${id}/restore`);
    await refetch();
    return restored;
  }, [refetch]);

  return { active, archived, isLoading, error, refetch, create, update, archive, restore };
}
