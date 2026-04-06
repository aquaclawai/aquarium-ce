import { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { api } from '../../api';
import { Button } from '@/components/ui';
import type { ChannelRegistryItem } from '@aquarium/shared';

interface QrSetupFlowProps {
  channel: ChannelRegistryItem;
  instanceId: string;
  onConnected: () => void;
  onDisconnect: () => void;
}

type QrState = 'idle' | 'requesting' | 'scanning' | 'connected' | 'expired' | 'error';

const QR_TIMEOUT_SECONDS = 60;
const MAX_RETRIES = 3;

export function QrSetupFlow({ channel, instanceId, onConnected, onDisconnect }: QrSetupFlowProps) {
  const { t } = useTranslation();
  const [state, setState] = useState<QrState>(channel.status?.connected ? 'connected' : 'idle');
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(QR_TIMEOUT_SECONDS);
  const [retryCount, setRetryCount] = useState(0);
  const abortRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortRef.current = true;
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const startLogin = useCallback(async () => {
    abortRef.current = false;
    setState('requesting');
    setMessage(null);
    setQrDataUrl(null);
    setCountdown(QR_TIMEOUT_SECONDS);

    try {
      // Step 1: Request QR code
      const startResult = await api.post<{ qrDataUrl?: string; message?: string }>(
        `/instances/${instanceId}/channels/whatsapp/start`,
        {}
      );

      if (abortRef.current) return;

      if (startResult.qrDataUrl) {
        setQrDataUrl(startResult.qrDataUrl);
        setState('scanning');

        // Start countdown timer
        if (timerRef.current) clearInterval(timerRef.current);
        let remaining = QR_TIMEOUT_SECONDS;
        setCountdown(remaining);
        timerRef.current = setInterval(() => {
          remaining -= 1;
          setCountdown(remaining);
          if (remaining <= 0) {
            if (timerRef.current) clearInterval(timerRef.current);
          }
        }, 1000);

        // Step 2: Wait for scan confirmation (long-poll)
        try {
          const waitResult = await api.post<{ connected?: boolean; message?: string; qrDataUrl?: string }>(
            `/instances/${instanceId}/channels/whatsapp/wait`,
            {}
          );

          if (abortRef.current) return;
          if (timerRef.current) clearInterval(timerRef.current);

          if (waitResult.connected) {
            setState('connected');
            setMessage(t('channels.whatsapp.connected'));
            toast.success(t('channels.whatsapp.connected'));
            onConnected();
          } else if (waitResult.qrDataUrl) {
            // Server generated a new QR (515 restart recovery)
            setQrDataUrl(waitResult.qrDataUrl);
            setMessage(waitResult.message ?? null);
            // Re-wait
            setState('scanning');
          } else {
            // Timeout or not completed
            if (retryCount < MAX_RETRIES) {
              setState('expired');
              setMessage(t('channels.whatsapp.qrExpired'));
            } else {
              setState('error');
              setMessage('Max retries reached. Please try again.');
            }
          }
        } catch (waitErr) {
          if (abortRef.current) return;
          if (timerRef.current) clearInterval(timerRef.current);
          // Wait timeout — QR expired
          if (retryCount < MAX_RETRIES) {
            setState('expired');
            setMessage(t('channels.whatsapp.qrExpired'));
          } else {
            setState('error');
            setMessage(waitErr instanceof Error ? waitErr.message : 'Connection failed');
          }
        }
      } else {
        setState('error');
        setMessage(startResult.message ?? 'Failed to generate QR code');
      }
    } catch (err) {
      if (abortRef.current) return;
      setState('error');
      setMessage(err instanceof Error ? err.message : 'Failed to start WhatsApp login');
    }
  }, [instanceId, retryCount, onConnected, t]);

  const handleRetry = () => {
    setRetryCount(prev => prev + 1);
    startLogin();
  };

  const handleDisconnect = async () => {
    if (!confirm(t('channels.drawer.disconnectConfirm', { channel: channel.label }))) return;
    try {
      await api.post(`/instances/${instanceId}/channels/whatsapp/disconnect`, {});
      toast.success('WhatsApp disconnected');
      setState('idle');
      setQrDataUrl(null);
      onDisconnect();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Disconnect failed');
    }
  };

  // Already connected
  if (state === 'connected' || (channel.status?.connected && state === 'idle')) {
    return (
      <section className="channel-drawer__section">
        <h4>{t('channels.drawer.configuration')}</h4>
        <div className="qr-connected">
          <span className="channel-status channel-status--connected">
            <span className="channel-status__dot" />
            {t('channels.whatsapp.connected')}
          </span>
          <p className="channel-drawer__help">{t('channels.whatsapp.sessionPersists', 'Session persists across restarts.')}</p>
        </div>
        <Button variant="ghost" onClick={handleDisconnect}>
          {t('channels.actions.disconnect')}
        </Button>
      </section>
    );
  }

  // Idle — show connect button
  if (state === 'idle') {
    return (
      <section className="channel-drawer__section">
        <h4>{t('channels.drawer.configuration')}</h4>
        <div className="qr-container">
          <p>{t('channels.whatsapp.scanInstructions', 'Open WhatsApp → Settings → Linked Devices → Link a Device')}</p>
          <Button onClick={startLogin}>
            {t('channels.whatsapp.connect', 'Connect WhatsApp')}
          </Button>
        </div>
      </section>
    );
  }

  // Requesting — loading
  if (state === 'requesting') {
    return (
      <section className="channel-drawer__section">
        <h4>{t('channels.drawer.configuration')}</h4>
        <div className="qr-container">
          <div className="qr-loading">
            <span className="spinner" />
            <p>{t('channels.whatsapp.connecting', 'Generating QR code...')}</p>
          </div>
        </div>
      </section>
    );
  }

  // Scanning — show QR code
  if (state === 'scanning' && qrDataUrl) {
    const progress = Math.max(0, (countdown / QR_TIMEOUT_SECONDS) * 100);
    return (
      <section className="channel-drawer__section">
        <h4>{t('channels.drawer.configuration')}</h4>
        <div className="qr-container">
          <img className="qr-code" src={qrDataUrl} alt="WhatsApp QR Code" />
          <div className="qr-timer">
            <div className="qr-timer__bar" style={{ width: `${progress}%` }} />
          </div>
          <p className="qr-instructions">
            {t('channels.whatsapp.scanInstructions', 'Open WhatsApp → Settings → Linked Devices → Link a Device')}
          </p>
          <p className="channel-drawer__help">
            {t('channels.whatsapp.connecting', 'Waiting for WhatsApp connection...')}
          </p>
        </div>
      </section>
    );
  }

  // Expired — show retry
  if (state === 'expired') {
    return (
      <section className="channel-drawer__section">
        <h4>{t('channels.drawer.configuration')}</h4>
        <div className="qr-container">
          <p className="channel-drawer__error">{message ?? t('channels.whatsapp.qrExpired')}</p>
          <Button onClick={handleRetry}>
            {t('channels.actions.retry')}
          </Button>
        </div>
      </section>
    );
  }

  // Error
  return (
    <section className="channel-drawer__section">
      <h4>{t('channels.drawer.configuration')}</h4>
      <div className="qr-container">
        <p className="channel-drawer__error">{message ?? 'An error occurred'}</p>
        <Button onClick={() => { setRetryCount(0); startLogin(); }}>
          {t('channels.actions.retry')}
        </Button>
      </div>
    </section>
  );
}
