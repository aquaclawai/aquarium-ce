import { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import type { GatewayModel, InstanceModelsResponse } from '@aquarium/shared';

interface UseInstanceModelsResult {
  models: GatewayModel[];
  configuredProviders: string[];
  loading: boolean;
}

export function useInstanceModels(
  instanceId: string,
  instanceStatus: string,
): UseInstanceModelsResult {
  const [data, setData] = useState<{ models: GatewayModel[]; configuredProviders: string[] } | null>(null);
  const [loading, setLoading] = useState(false);

  const isRunning = instanceStatus === 'running';

  const fetchModels = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.get<InstanceModelsResponse>(`/instances/${instanceId}/models`);
      setData({ models: result.models, configuredProviders: result.configuredProviders });
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [instanceId]);

  useEffect(() => {
    if (isRunning) {
      fetchModels();
    } else {
      setData(null);
    }
  }, [isRunning, fetchModels]);

  return {
    models: data?.models ?? [],
    configuredProviders: data?.configuredProviders ?? [],
    loading,
  };
}
