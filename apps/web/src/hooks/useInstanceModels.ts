import { useState, useEffect } from 'react';
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
  const [models, setModels] = useState<GatewayModel[]>([]);
  const [configuredProviders, setConfiguredProviders] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (instanceStatus !== 'running') {
      setModels([]);
      setConfiguredProviders([]);
      return;
    }

    let cancelled = false;
    setLoading(true);

    api.get<InstanceModelsResponse>(`/instances/${instanceId}/models`)
      .then(data => {
        if (!cancelled) {
          setModels(data.models);
          setConfiguredProviders(data.configuredProviders);
        }
      })
      .catch(() => {
        if (!cancelled) setModels([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [instanceId, instanceStatus]);

  return { models, configuredProviders, loading };
}
