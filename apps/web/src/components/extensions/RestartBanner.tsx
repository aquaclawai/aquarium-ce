import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api';
import type { InstancePlugin } from '@aquarium/shared';

interface RestartBannerProps {
  pluginName: string;
  instanceId: string;
  pluginId: string;
  onComplete: (success: boolean, error?: string) => void;
}

interface PluginStatusResponse {
  managed: InstancePlugin[];
  gatewayBuiltins: unknown[];
}

export function RestartBanner({ pluginName, instanceId, pluginId, onComplete }: RestartBannerProps) {
  const { t } = useTranslation();

  useEffect(() => {
    let active = true;

    const intervalId = setInterval(() => {
      void (async () => {
        if (!active) return;
        try {
          const data = await api.get<PluginStatusResponse>(`/instances/${instanceId}/plugins`);
          if (!active) return;
          const plugin = data.managed.find(p => p.pluginId === pluginId);
          if (!plugin) return;

          if (plugin.status === 'active') {
            clearInterval(intervalId);
            onComplete(true);
          } else if (plugin.status === 'failed') {
            clearInterval(intervalId);
            onComplete(false, plugin.errorMessage ?? undefined);
          }
          // status === 'installed' | 'pending' | 'degraded' => keep polling
        } catch {
          // Transient error during restart — keep polling
        }
      })();
    }, 2000);

    return () => {
      active = false;
      clearInterval(intervalId);
    };
  }, [instanceId, pluginId, onComplete]);

  return (
    <div className="restart-banner" role="status" aria-live="polite">
      <span className="restart-banner__spinner" aria-hidden="true" />
      <span className="restart-banner__message">
        {t('extensions.restart.banner', { name: pluginName })}
      </span>
      <span className="restart-banner__hint">
        {t('extensions.restart.actionsDisabled')}
      </span>
    </div>
  );
}
