// For standard AI provider OAuth (GitHub, Google, etc.), see oauth.ts.
// This file handles extension-scoped OAuth flows where a plugin/skill requires
// browser-redirect OAuth authentication (e.g., a plugin declaring GitHub/Slack OAuth).

import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { requireAuth } from '../middleware/auth.js';
import { getInstance } from '../services/instance-manager.js';
import { addCredential } from '../services/credential-store.js';
import { GatewayRPCClient } from '../agent-types/openclaw/gateway-rpc.js';
import { config } from '../config.js';
import { db } from '../db/index.js';
import type { ApiResponse, ExtensionKind } from '@aquarium/shared';

const router = Router();
router.use(requireAuth);

// ─── In-memory OAuth session store ────────────────────────────────────────────

interface OAuthProxySession {
  instanceId: string;
  userId: string;
  extensionId: string;
  extensionKind: ExtensionKind;
  provider: string;
  createdAt: number;
}

const oauthSessions = new Map<string, OAuthProxySession>();
const SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes

/** Remove expired sessions to prevent unbounded memory growth. */
function cleanupOAuthSessions(): void {
  const now = Date.now();
  for (const [state, session] of oauthSessions.entries()) {
    if (now - session.createdAt > SESSION_TTL_MS) {
      oauthSessions.delete(state);
    }
  }
}

// ─── POST /:id/oauth-proxy/initiate ──────────────────────────────────────────
// Initiates an OAuth browser redirect flow for an extension-scoped credential.
// Returns an authUrl that the frontend should open in a popup window.

router.post('/:id/oauth-proxy/initiate', async (req, res) => {
  const instanceId = req.params.id;

  const instance = await getInstance(instanceId, req.auth!.userId);
  if (!instance) {
    res.status(404).json({ ok: false, error: 'Instance not found' } satisfies ApiResponse);
    return;
  }

  if (instance.status !== 'running' || !instance.controlEndpoint) {
    res.status(400).json({ ok: false, error: 'Instance must be running to initiate OAuth flow' } satisfies ApiResponse);
    return;
  }

  const { extensionId, extensionKind, provider } = req.body as {
    extensionId: unknown;
    extensionKind: unknown;
    provider: unknown;
  };

  if (!extensionId || typeof extensionId !== 'string') {
    res.status(400).json({ ok: false, error: 'Missing or invalid extensionId' } satisfies ApiResponse);
    return;
  }
  if (!extensionKind || (extensionKind !== 'skill' && extensionKind !== 'plugin')) {
    res.status(400).json({ ok: false, error: 'Missing or invalid extensionKind — must be "skill" or "plugin"' } satisfies ApiResponse);
    return;
  }
  if (!provider || typeof provider !== 'string') {
    res.status(400).json({ ok: false, error: 'Missing or invalid provider' } satisfies ApiResponse);
    return;
  }

  // Cleanup old sessions before creating a new one
  cleanupOAuthSessions();

  const state = randomBytes(16).toString('hex');
  const callbackUrl = `${config.corsOrigin}/api/instances/${instanceId}/oauth-proxy/callback?state=${state}`;

  oauthSessions.set(state, {
    instanceId,
    userId: req.auth!.userId,
    extensionId,
    extensionKind: extensionKind as ExtensionKind,
    provider,
    createdAt: Date.now(),
  });

  // Attempt to get the OAuth authorization URL from the gateway via RPC.
  // Older gateway versions may not support auth.getOAuthUrl — fall back gracefully.
  let authUrl: string;
  const rpc = new GatewayRPCClient(instance.controlEndpoint!, instance.authToken);
  try {
    const result = await rpc.call('auth.getOAuthUrl', { provider, callbackUrl }, 15_000) as { url?: string } | null;
    if (result && typeof result === 'object' && typeof result.url === 'string') {
      authUrl = result.url;
    } else {
      // Gateway returned unexpected shape — fall back to generic URL
      authUrl = callbackUrl;
    }
  } catch (_err: unknown) {
    // RPC not supported or failed — fall back to callback URL directly
    // (Older gateways / gateways without OAuth support)
    authUrl = callbackUrl;
  } finally {
    rpc.close();
  }

  res.json({ ok: true, data: { authUrl, state } } satisfies ApiResponse<{ authUrl: string; state: string }>);
});

// ─── GET /:id/oauth-proxy/callback ───────────────────────────────────────────
// OAuth callback endpoint. After the user authorizes in the browser, the OAuth
// provider redirects here with ?state=...&code=.... This route relays the code
// to the gateway for token exchange and writes an oauth_token credential row.

router.get('/:id/oauth-proxy/callback', async (req, res) => {
  const instanceId = req.params.id;
  const { state, code, error: oauthError } = req.query as {
    state?: string;
    code?: string;
    error?: string;
  };

  const sendHtmlPage = (status: 'success' | 'error', extensionId: string, message?: string): void => {
    const scriptContent = status === 'success'
      ? `window.opener?.postMessage({type:'oauth-callback',status:'success',extensionId:${JSON.stringify(extensionId)}}, '*'); window.close();`
      : `window.opener?.postMessage({type:'oauth-callback',status:'error',extensionId:${JSON.stringify(extensionId)},message:${JSON.stringify(message ?? 'OAuth failed')}}, '*'); window.close();`;

    res.send(`<!DOCTYPE html>
<html>
<head><title>OAuth ${status === 'success' ? 'Complete' : 'Error'}</title></head>
<body>
<p>${status === 'success' ? 'Authentication complete. You may close this window.' : `Authentication failed: ${message ?? 'Unknown error'}. You may close this window.`}</p>
<script>${scriptContent}</script>
</body>
</html>`);
  };

  if (!state) {
    res.status(400).send('Missing state parameter');
    return;
  }

  const session = oauthSessions.get(state);
  if (!session) {
    sendHtmlPage('error', '', 'OAuth session expired or invalid. Please try again.');
    return;
  }

  // One-time use — delete immediately
  oauthSessions.delete(state);

  if (session.instanceId !== instanceId) {
    sendHtmlPage('error', session.extensionId, 'Instance mismatch in OAuth callback.');
    return;
  }

  // Check for OAuth provider error
  if (oauthError) {
    sendHtmlPage('error', session.extensionId, `OAuth provider returned error: ${oauthError}`);
    return;
  }

  if (!code) {
    sendHtmlPage('error', session.extensionId, 'No authorization code received from OAuth provider.');
    return;
  }

  // Verify session hasn't expired
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    sendHtmlPage('error', session.extensionId, 'OAuth session expired. Please initiate again.');
    return;
  }

  const instance = await getInstance(instanceId, session.userId);
  if (!instance || instance.status !== 'running' || !instance.controlEndpoint) {
    sendHtmlPage('error', session.extensionId, 'Instance is no longer running.');
    return;
  }

  const callbackUrl = `${config.corsOrigin}/api/instances/${instanceId}/oauth-proxy/callback?state=${state}`;

  const rpc = new GatewayRPCClient(instance.controlEndpoint, instance.authToken);
  try {
    // Relay auth code to gateway for token exchange. Gateway stores the token
    // in auth-profiles.json internally.
    await rpc.call('auth.exchangeToken', { provider: session.provider, code, callbackUrl }, 30_000);

    // CRITICAL: Write an oauth_token sentinel credential row so template export
    // can detect OAuth-backed extensions and set requiresReAuth=true.
    // The actual token lives in gateway's auth-profiles.json, not here.
    await addCredential(
      session.instanceId,
      session.provider,
      'oauth_token',       // credential_type — must be 'oauth_token'
      'GATEWAY_MANAGED',   // value — actual token lives in gateway's auth-profiles.json
      {
        extensionId: session.extensionId,
        extensionKind: session.extensionKind,
      },
    );

    // Update extension status from 'installed' → 'active' if applicable
    if (session.extensionKind === 'plugin') {
      await db('instance_plugins')
        .where({
          instance_id: session.instanceId,
          plugin_id: session.extensionId,
          status: 'installed',
        })
        .update({ status: 'active', updated_at: db.fn.now() });
    } else if (session.extensionKind === 'skill') {
      await db('instance_skills')
        .where({
          instance_id: session.instanceId,
          skill_id: session.extensionId,
          status: 'installed',
        })
        .update({ status: 'active', updated_at: db.fn.now() });
    }

    sendHtmlPage('success', session.extensionId);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    sendHtmlPage('error', session.extensionId, `Token exchange failed: ${message}`);
  } finally {
    rpc.close();
  }
});

// ─── GET /:id/oauth-proxy/status/:extensionId ────────────────────────────────
// Quick poll endpoint for the frontend to check if an extension has been
// OAuth-connected (status = 'active').

router.get('/:id/oauth-proxy/status/:extensionId', async (req, res) => {
  const instanceId = req.params.id;
  const extensionId = req.params.extensionId;
  const { kind } = req.query as { kind?: string };

  const instance = await getInstance(instanceId, req.auth!.userId);
  if (!instance) {
    res.status(404).json({ ok: false, error: 'Instance not found' } satisfies ApiResponse);
    return;
  }

  let status: string | undefined;

  if (kind === 'skill') {
    const row = await db('instance_skills')
      .where({ instance_id: instanceId, skill_id: extensionId })
      .first('status');
    status = row?.status as string | undefined;
  } else {
    // Default to plugin lookup
    const row = await db('instance_plugins')
      .where({ instance_id: instanceId, plugin_id: extensionId })
      .first('status');
    status = row?.status as string | undefined;
  }

  if (status === undefined) {
    res.status(404).json({ ok: false, error: 'Extension not found' } satisfies ApiResponse);
    return;
  }

  res.json({
    ok: true,
    data: { connected: status === 'active' },
  } satisfies ApiResponse<{ connected: boolean }>);
});

export default router;
