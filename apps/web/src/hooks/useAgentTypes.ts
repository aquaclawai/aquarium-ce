import { useState, useEffect } from 'react';
import { api } from '../api';
import type { AgentTypeInfo } from '@aquarium/shared';

interface UseAgentTypesResult {
  agentTypes: AgentTypeInfo[];
  loading: boolean;
  error: string | null;
}

/**
 * Fetches all available agent types from /api/agent-types.
 * Results are cached for the lifetime of the component.
 */
export function useAgentTypes(): UseAgentTypesResult {
  const [agentTypes, setAgentTypes] = useState<AgentTypeInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    api.get<AgentTypeInfo[]>('/agent-types')
      .then(data => {
        if (!cancelled) setAgentTypes(data);
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load agent types');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, []);

  return { agentTypes, loading, error };
}
