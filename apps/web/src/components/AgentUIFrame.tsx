import { useState, useRef, useCallback, useEffect, useContext } from 'react';
import { useTranslation } from 'react-i18next';
import type { Instance, AgentTypeInfo } from '@aquarium/shared';
import { Button } from '@/components/ui';
import { AuthContext } from '@/context/AuthContext';
import './AgentUIFrame.css';

interface AgentUIFrameProps {
  instance: Instance;
  agentType: AgentTypeInfo | null;
}

/**
 * Embeds the Gateway's native web UI inside an iframe.
 *
 * The iframe src points to `/api/instances/:id/ui/` (same-origin), so the
 * browser automatically forwards the platform session cookie to the proxy,
 * which then injects the Gateway auth token before forwarding to the Gateway.
 *
 * Requirements:
 *   - Instance must be in 'running' status
 *   - agentType.capabilities.hasWebUI must be true
 *   - agentType.webUI.iframeAllowed must be true
 */
export function AgentUIFrame({ instance, agentType }: AgentUIFrameProps) {
  const { t } = useTranslation();
  const auth = useContext(AuthContext);
  const [iframeError, setIframeError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // ── localStorage patch ────────────────────────────────────────────────
  // The Gateway Control UI persists its WebSocket URL in localStorage under
  // key 'openclaw.control.settings.v1'. Because all instance iframes share
  // the same origin, switching instances would connect to a stale URL.
  // We patch localStorage BEFORE the iframe loads so it reads the correct URL.
  //
  // The WebSocket proxy authenticates via ?token= query param because
  // browser WebSocket connections from iframes don't carry cookies.
  const iframeSrcReady = instance.status === 'running';

  useEffect(() => {
    if (instance.status !== 'running') return;

    const SETTINGS_KEY = 'openclaw.control.settings.v1';
    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

    void (async () => {
      const token = await auth?.getToken();
      const tokenParam = token ? `?token=${encodeURIComponent(token)}` : '';
      const correctGatewayUrl = `${wsProto}//${window.location.host}/api/instances/${instance.id}/ui${tokenParam}`;

      try {
        const raw = localStorage.getItem(SETTINGS_KEY);
        const existing: Record<string, unknown> = raw ? JSON.parse(raw) as Record<string, unknown> : {};
        if (existing.gatewayUrl !== correctGatewayUrl) {
          existing.gatewayUrl = correctGatewayUrl;
          localStorage.setItem(SETTINGS_KEY, JSON.stringify(existing));
        }
      } catch {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify({ gatewayUrl: correctGatewayUrl }));
      }
    })();
  }, [instance.id, instance.status, auth]);

  const handleLoad = useCallback(() => {
    setIsLoading(false);
    setIframeError(false);
  }, []);

  const handleError = useCallback(() => {
    setIsLoading(false);
    setIframeError(true);
  }, []);

  const handleReload = useCallback(() => {
    setIsLoading(true);
    setIframeError(false);
    if (iframeRef.current) {
      // Force reload by re-assigning src
      const src = iframeRef.current.src;
      iframeRef.current.src = '';
      iframeRef.current.src = src;
    }
  }, []);

  // Guard: instance must be running
  if (instance.status !== 'running') {
    return (
      <div className="agent-ui-frame-placeholder">
        <div className="agent-ui-frame-icon">⏸</div>
        <p className="agent-ui-frame-title">{t('agentUI.unavailable.title')}</p>
        <p className="agent-ui-frame-subtitle">
          {t('agentUI.unavailable.description')}
        </p>
      </div>
    );
  }

  // Guard: agentType must support web UI in an iframe
  const hasWebUI = agentType?.capabilities?.hasWebUI === true;
  const iframeAllowed = agentType?.webUI?.iframeAllowed === true;

  if (!hasWebUI || !iframeAllowed) {
    return (
      <div className="agent-ui-frame-placeholder">
        <div className="agent-ui-frame-icon">🚫</div>
        <p className="agent-ui-frame-title">{t('agentUI.notSupported.title')}</p>
        <p className="agent-ui-frame-subtitle">
          {t('agentUI.notSupported.description')}
        </p>
      </div>
    );
  }


  return (
    <div className="agent-ui-frame-container">
      {isLoading && (
        <div className="agent-ui-frame-loading">
          <span className="spinner" />
          <span>{t('chat.loadingAgentUI')}</span>
        </div>
      )}

      {iframeError && (
        <div className="agent-ui-frame-error">
          <div className="agent-ui-frame-icon">⚠️</div>
          <p className="agent-ui-frame-title">{t('agentUI.loadFailed.title')}</p>
          <p className="agent-ui-frame-subtitle">
            {t('agentUI.loadFailed.description')}
          </p>
          <Button variant="secondary" onClick={handleReload}>
            {t('common.buttons.retry')}
          </Button>
        </div>
      )}

      {iframeSrcReady && (
        <iframe
          ref={iframeRef}
          src={`/api/instances/${instance.id}/ui/`}
          title={t('agentUI.iframeTitle')}
          className={`agent-ui-frame-iframe${isLoading || iframeError ? ' agent-ui-frame-iframe--hidden' : ''}`}
          onLoad={handleLoad}
          onError={handleError}
          sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
          allow="clipboard-read; clipboard-write"
        />
      )}
    </div>
  );
}
