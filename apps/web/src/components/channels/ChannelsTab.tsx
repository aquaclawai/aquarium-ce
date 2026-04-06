import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api';
import type { ChannelRegistryItem, ChannelStatusDetail } from '@aquarium/shared';
import { ChannelGrid, ChannelGridSkeleton } from './ChannelGrid';
import { ChannelConfigDrawer } from './ChannelConfigDrawer';
import './ChannelsTab.css';

interface ChannelsTabProps {
  instanceId: string;
  instanceStatus: string;
}

const POLL_INTERVAL_MS = 30_000;

export function ChannelsTab({ instanceId, instanceStatus }: ChannelsTabProps) {
  const { t } = useTranslation();
  const [registry, setRegistry] = useState<ChannelRegistryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [applyingChannelId, setApplyingChannelId] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isRunning = instanceStatus === 'running';

  // Fetch full registry (initial load + after instance status changes)
  const fetchRegistry = useCallback(async () => {
    try {
      const result = await api.get<{ channels: ChannelRegistryItem[] }>(
        `/instances/${instanceId}/channels/registry`
      );
      setRegistry(result.channels);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load channels');
    } finally {
      setLoading(false);
    }
  }, [instanceId]);

  useEffect(() => {
    fetchRegistry();
  }, [fetchRegistry]);

  // Re-fetch when instance transitions to running
  useEffect(() => {
    if (isRunning) fetchRegistry();
  }, [isRunning, fetchRegistry]);

  // Poll status while running
  const fetchStatus = useCallback(async () => {
    if (!isRunning) return;
    try {
      const result = await api.get<{ details: ChannelStatusDetail[] }>(
        `/instances/${instanceId}/channels/status?probe=false`
      );
      setRegistry(prev => mergeStatusIntoRegistry(prev, result.details));
    } catch {
      // Swallow — next poll will retry
    }
  }, [instanceId, isRunning]);

  useEffect(() => {
    if (!isRunning) {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }
    pollRef.current = setInterval(fetchStatus, POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [isRunning, fetchStatus]);

  // Post-mutation refresh with applying state
  const handleChannelUpdate = useCallback(async (channelId: string) => {
    setApplyingChannelId(channelId);
    // Wait for gateway restart to settle
    await new Promise(r => setTimeout(r, 1500));
    await fetchStatus();
    await fetchRegistry();
    setApplyingChannelId(null);
  }, [fetchStatus, fetchRegistry]);

  const selectedChannel = registry.find(ch => ch.id === selectedChannelId) ?? null;

  if (loading) {
    return (
      <div className="channels-tab">
        <div className="channels-tab__header">
          <h2>{t('channels.title')}</h2>
          <p className="channels-tab__subtitle">{t('channels.subtitle')}</p>
        </div>
        <ChannelGridSkeleton />
      </div>
    );
  }

  return (
    <div className="channels-tab">
      <div className="channels-tab__header">
        <h2>{t('channels.title')}</h2>
        <p className="channels-tab__subtitle">{t('channels.subtitle')}</p>
      </div>

      {error && <div className="error-message" role="alert">{error}</div>}

      {!isRunning && (
        <div className="channels-tab__banner">
          {t('channels.instanceNotRunning')}
        </div>
      )}

      {registry.length === 0 && !loading && (
        <div className="channels-tab__empty">{t('channels.noChannelsAvailable')}</div>
      )}

      <ChannelGrid
        channels={registry}
        onSelect={setSelectedChannelId}
        disabled={!isRunning}
        applyingChannelId={applyingChannelId}
      />

      {selectedChannel && (
        <ChannelConfigDrawer
          channel={selectedChannel}
          instanceId={instanceId}
          onClose={() => setSelectedChannelId(null)}
          onUpdate={handleChannelUpdate}
        />
      )}
    </div>
  );
}

function mergeStatusIntoRegistry(
  registry: ChannelRegistryItem[],
  details: ChannelStatusDetail[],
): ChannelRegistryItem[] {
  const statusMap = new Map(details.map(d => [d.channelId, d]));
  return registry.map(entry => {
    const status = statusMap.get(entry.id);
    if (!status) return entry;
    return { ...entry, status };
  });
}
