import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getInstance, patchGatewayConfig } from '../services/instance-manager.js';
import { getAgentType } from '../agent-types/registry.js';
import { addCredential, listCredentials, deleteCredential, getDecryptedCredentials } from '../services/credential-store.js';
import type { ApiResponse, Instance, ChannelStatusDetail, ChannelEnableRequest, ChannelPolicyUpdate } from '@aquarium/shared';

const router = Router();
router.use(requireAuth);

/**
 * Push channel config changes to the gateway via patchGatewayConfig.
 * Uses seedConfig to generate the full config, then extracts the channel-specific
 * delta (channels + plugins entries) and sends as a merge-patch.
 */
async function pushChannelConfigToGateway(instance: Instance, channel: string, userId: string): Promise<void> {
  try {
    let channelDelta: Record<string, unknown> = {};
    const { adapter } = getAgentType(instance.agentType);
    if (adapter?.seedConfig) {
      try {
        const creds = await getDecryptedCredentials(instance.id);
        const configFiles = await adapter.seedConfig({
          instance,
          userConfig: instance.config || {},
          credentials: creds,
        });
        const openclawJson = configFiles.get('openclaw.json');
        if (openclawJson) {
          const fullConfig = JSON.parse(openclawJson) as Record<string, unknown>;
          const channels = fullConfig.channels as Record<string, unknown> | undefined;
          if (channels?.[channel]) {
            channelDelta.channels = { [channel]: channels[channel] };
          }
          const plugins = fullConfig.plugins as { entries?: Record<string, unknown> } | undefined;
          if (plugins?.entries?.[channel]) {
            channelDelta.plugins = { entries: { [channel]: plugins.entries[channel] } };
          }
        }
      } catch (seedErr) {
        console.warn(`[channel-config] seedConfig failed for ${instance.id}, sending empty delta:`, seedErr);
        // Fall through with empty delta — patchGatewayConfig still triggers SIGUSR1 restart
      }
    }
    await patchGatewayConfig(instance.id, userId, channelDelta, `Platform: configure ${channel}`);
  } catch (err) {
    console.error(`[channel-config] config.patch failed for ${instance.id}:`, err);
  }
}

router.post('/:id/channels/whatsapp/start', async (req, res) => {
  try {
    const instance = await getInstance(req.params.id, req.auth!.userId);
    if (!instance) {
      res.status(404).json({ ok: false, error: 'Instance not found' } satisfies ApiResponse);
      return;
    }
    if (instance.status !== 'running' || !instance.controlEndpoint) {
      res.status(400).json({ ok: false, error: 'Instance must be running' } satisfies ApiResponse);
      return;
    }

    const { adapter } = getAgentType(instance.agentType);
    if (!adapter?.translateRPC) {
      res.status(400).json({ ok: false, error: 'Agent type does not support RPC' } satisfies ApiResponse);
      return;
    }

    const result = await adapter.translateRPC({
      method: 'web.login.start',
      params: { force: true, timeoutMs: 30_000 },
      endpoint: instance.controlEndpoint,
      token: instance.authToken,
      instanceId: instance.id,
    });

    res.json({ ok: true, data: result } satisfies ApiResponse);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

router.post('/:id/channels/whatsapp/wait', async (req, res) => {
  try {
    const instance = await getInstance(req.params.id, req.auth!.userId);
    if (!instance) {
      res.status(404).json({ ok: false, error: 'Instance not found' } satisfies ApiResponse);
      return;
    }
    if (instance.status !== 'running' || !instance.controlEndpoint) {
      res.status(400).json({ ok: false, error: 'Instance must be running' } satisfies ApiResponse);
      return;
    }

    const { adapter } = getAgentType(instance.agentType);
    if (!adapter?.translateRPC) {
      res.status(400).json({ ok: false, error: 'Agent type does not support RPC' } satisfies ApiResponse);
      return;
    }

    const rpc = (method: string, params: Record<string, unknown>) =>
      adapter.translateRPC!({
        method,
        params,
        endpoint: instance.controlEndpoint!,
        token: instance.authToken,
        instanceId: instance.id,
      }) as Promise<{ connected?: boolean; message?: string; qrDataUrl?: string } | undefined>;

    const maxRetries = 3;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const result = await rpc('web.login.wait', { timeoutMs: 120_000 });

      if (result?.connected) {
        res.json({ ok: true, data: result } satisfies ApiResponse);
        return;
      }

      const msg = result?.message ?? '';
      const is515 = msg.includes('515') || msg.includes('Stream Errored');

      if (!is515 || attempt === maxRetries) {
        res.json({ ok: true, data: result ?? { connected: false, message: msg || 'Login not completed' } } satisfies ApiResponse);
        return;
      }

      // 515 = Baileys internal socket restart — requires fresh QR
      await new Promise(r => setTimeout(r, 3_000));
      const startResult = await rpc('web.login.start', { force: true, timeoutMs: 30_000 });

      if (startResult?.qrDataUrl) {
        res.json({ ok: true, data: { ...startResult, connected: false, message: 'New QR code after 515 restart' } } satisfies ApiResponse);
        return;
      }
    }

    res.json({ ok: true, data: { connected: false, message: 'Login not completed after retries' } } satisfies ApiResponse);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

router.post('/:id/channels/whatsapp/disconnect', async (req, res) => {
  try {
    const instance = await getInstance(req.params.id, req.auth!.userId);
    if (!instance) {
      res.status(404).json({ ok: false, error: 'Instance not found' } satisfies ApiResponse);
      return;
    }
    if (instance.status !== 'running' || !instance.controlEndpoint) {
      res.status(400).json({ ok: false, error: 'Instance must be running' } satisfies ApiResponse);
      return;
    }

    const { adapter } = getAgentType(instance.agentType);
    if (!adapter?.translateRPC) {
      res.status(400).json({ ok: false, error: 'Agent type does not support RPC' } satisfies ApiResponse);
      return;
    }

    await adapter.translateRPC({
      method: 'channels.logout',
      params: { channel: 'whatsapp' },
      endpoint: instance.controlEndpoint,
      token: instance.authToken,
      instanceId: instance.id,
    });

    res.json({ ok: true, data: { message: 'WhatsApp disconnected.' } } satisfies ApiResponse);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

router.get('/:id/channels/status', async (req, res) => {
  try {
    const instance = await getInstance(req.params.id, req.auth!.userId);
    if (!instance) {
      res.status(404).json({ ok: false, error: 'Instance not found' } satisfies ApiResponse);
      return;
    }
    if (instance.status !== 'running' || !instance.controlEndpoint) {
      res.json({ ok: true, data: { channels: {}, details: [] } } satisfies ApiResponse);
      return;
    }

    const { adapter } = getAgentType(instance.agentType);
    if (!adapter?.translateRPC) {
      res.json({ ok: true, data: { channels: {}, details: [] } } satisfies ApiResponse);
      return;
    }

    try {
      const shouldProbe = req.query.probe !== 'false';
      const result = await adapter.translateRPC({
        method: 'channels.status',
        params: { probe: shouldProbe, timeoutMs: shouldProbe ? 8_000 : 3_000 },
        endpoint: instance.controlEndpoint,
        token: instance.authToken,
        instanceId: instance.id,
      }) as { channels?: Record<string, Record<string, unknown>> } | undefined;

      const raw = result?.channels ?? {};
      const details: ChannelStatusDetail[] = [];
      for (const [id, ch] of Object.entries(raw)) {
        const probe = ch.probe as { ok?: boolean; latencyMs?: number; error?: string } | undefined;
        const connected =
          typeof ch.connected === 'boolean'
            ? ch.connected
            : !!(ch.running && ch.configured && (probe == null || probe.ok));

        // Extract known fields, put the rest in extra
        const { connected: _c, running, configured, lastInboundAt, lastOutboundAt,
                lastError, lastErrorAt, authStatus, displayName, probe: _p,
                accountId: _accountId, ...extra } = ch as Record<string, unknown>;

        details.push({
          channelId: id,
          connected,
          running: !!running,
          configured: !!configured,
          lastInboundAt: typeof lastInboundAt === 'number' ? lastInboundAt : null,
          lastOutboundAt: typeof lastOutboundAt === 'number' ? lastOutboundAt : null,
          lastError: typeof lastError === 'string' ? lastError : null,
          lastErrorAt: typeof lastErrorAt === 'number' ? lastErrorAt : null,
          authStatus: typeof authStatus === 'string' ? authStatus : null,
          displayName: typeof displayName === 'string' ? displayName : null,
          probe: probe ? { ok: !!probe.ok, latencyMs: probe.latencyMs, error: probe.error } : null,
          extra,
        });
      }

      // Build backward-compatible channels object AND new detailed array
      const channelsCompat: Record<string, { connected: boolean } & Record<string, unknown>> = {};
      for (const d of details) {
        channelsCompat[d.channelId] = { connected: d.connected, ...d.extra, running: d.running, configured: d.configured };
      }
      res.json({ ok: true, data: { channels: channelsCompat, details } } satisfies ApiResponse);
    } catch {
      res.json({ ok: true, data: { channels: {}, details: [] } } satisfies ApiResponse);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

/* ─── Channel Enable/Disable ─── */

router.patch('/:id/channels/:channel/enable', async (req, res) => {
  try {
    const { channel } = req.params;
    const { enabled } = req.body as ChannelEnableRequest;
    if (typeof enabled !== 'boolean') {
      res.status(400).json({ ok: false, error: 'enabled must be a boolean' } satisfies ApiResponse);
      return;
    }
    const instance = await getInstance(req.params.id, req.auth!.userId);
    if (!instance) {
      res.status(404).json({ ok: false, error: 'Instance not found' } satisfies ApiResponse);
      return;
    }

    // CRITICAL: Must set both channels.<id>.enabled AND plugins.entries.<id>.enabled
    // Missing the plugins entry leaves the channel in a broken state.
    await patchGatewayConfig(instance.id, req.auth!.userId, {
      channels: { [channel]: { enabled } },
      plugins: { entries: { [channel]: { enabled } } },
    }, `${enabled ? 'Enable' : 'Disable'} ${channel}`);

    res.json({ ok: true, data: { message: `${channel} ${enabled ? 'enabled' : 'disabled'}` } } satisfies ApiResponse);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

/* ─── Channel Policy Updates ─── */

// Channels that use nested dm: { policy, allowFrom } instead of flat dmPolicy
const NESTED_DM_POLICY_CHANNELS = new Set(['discord', 'slack', 'googlechat', 'matrix']);

router.patch('/:id/channels/:channel/policies', async (req, res) => {
  try {
    const { channel } = req.params;
    const { dmPolicy, groupPolicy } = req.body as ChannelPolicyUpdate;
    if (!dmPolicy && !groupPolicy) {
      res.status(400).json({ ok: false, error: 'At least one of dmPolicy or groupPolicy required' } satisfies ApiResponse);
      return;
    }
    const instance = await getInstance(req.params.id, req.auth!.userId);
    if (!instance) {
      res.status(404).json({ ok: false, error: 'Instance not found' } satisfies ApiResponse);
      return;
    }

    const channelPatch: Record<string, unknown> = {};
    if (dmPolicy) {
      if (NESTED_DM_POLICY_CHANNELS.has(channel)) {
        channelPatch.dm = { policy: dmPolicy };
      } else {
        channelPatch.dmPolicy = dmPolicy;
      }
    }
    if (groupPolicy) {
      channelPatch.groupPolicy = groupPolicy;
    }

    await patchGatewayConfig(instance.id, req.auth!.userId, {
      channels: { [channel]: channelPatch },
    }, `Update ${channel} policies`);

    res.json({ ok: true, data: { message: `${channel} policies updated` } } satisfies ApiResponse);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

/* ─── Generic Channel Configuration ─── */

/**
 * Defines required fields and credential mappings per channel.
 * Used by the generic configure/disconnect routes below.
 */
const CHANNEL_REQUIRED_FIELDS: Record<string, {
  fields: string[];
  credentialFields: { provider: string; envKey: string }[];
}> = {
  discord: {
    fields: ['token'],
    credentialFields: [{ provider: 'discord', envKey: 'token' }],
  },
  slack: {
    fields: ['appToken', 'botToken'],
    credentialFields: [
      { provider: 'slack_app', envKey: 'appToken' },
      { provider: 'slack_bot', envKey: 'botToken' },
    ],
  },
  signal: {
    fields: ['account'],
    credentialFields: [{ provider: 'signal', envKey: 'account' }],
  },
  googlechat: {
    fields: ['serviceAccountJson'],
    credentialFields: [{ provider: 'googlechat', envKey: 'serviceAccountJson' }],
  },
  imessage: {
    fields: ['cliPath', 'dbPath'],
    credentialFields: [], // config-only, no secrets
  },
  nostr: {
    fields: ['privateKey'],
    credentialFields: [{ provider: 'nostr', envKey: 'privateKey' }],
  },
  irc: {
    fields: ['host', 'nick'],
    credentialFields: [{ provider: 'irc', envKey: 'host' }],
  },
  msteams: {
    fields: ['appId', 'appPassword', 'tenantId'],
    credentialFields: [
      { provider: 'msteams_app', envKey: 'appId' },
      { provider: 'msteams_password', envKey: 'appPassword' },
      { provider: 'msteams_tenant', envKey: 'tenantId' },
    ],
  },
  matrix: {
    fields: ['homeserver', 'accessToken'],
    credentialFields: [{ provider: 'matrix', envKey: 'homeserver' }],
  },
  zalo: {
    fields: ['botToken'],
    credentialFields: [{ provider: 'zalo', envKey: 'botToken' }],
  },
  line: {
    fields: ['channelAccessToken', 'channelSecret'],
    credentialFields: [
      { provider: 'line_token', envKey: 'channelAccessToken' },
      { provider: 'line_secret', envKey: 'channelSecret' },
    ],
  },
  bluebubbles: {
    fields: ['serverUrl', 'password'],
    credentialFields: [{ provider: 'bluebubbles', envKey: 'serverUrl' }],
  },
};

router.post('/:id/channels/:channel/configure', async (req, res) => {
  try {
    const { channel } = req.params;

    // Validate channel is supported
    const channelDef = CHANNEL_REQUIRED_FIELDS[channel];
    if (!channelDef) {
      res.status(400).json({ ok: false, error: `Unsupported channel: ${channel}` } satisfies ApiResponse);
      return;
    }

    const instance = await getInstance(req.params.id, req.auth!.userId);
    if (!instance) {
      res.status(404).json({ ok: false, error: 'Instance not found' } satisfies ApiResponse);
      return;
    }

    // Validate required fields present in body
    const body = req.body as Record<string, string>;
    for (const field of channelDef.fields) {
      if (!body[field] || typeof body[field] !== 'string' || !body[field].trim()) {
        res.status(400).json({ ok: false, error: `Missing required field: ${field}` } satisfies ApiResponse);
        return;
      }
    }

    // Delete existing credentials for this channel
    const existing = await listCredentials(instance.id);
    for (const cred of existing) {
      const isChannelCred = channelDef.credentialFields.some(cf => cf.provider === cred.provider)
        || cred.provider === channel; // catch config-only channels stored with channel name
      if (isChannelCred) {
        await deleteCredential(cred.id, instance.id);
      }
    }

    // Store new credentials
    for (const cf of channelDef.credentialFields) {
      const value = body[cf.envKey];
      if (value) {
        await addCredential(instance.id, cf.provider, 'api_key', value.trim());
      }
    }

    // For config-only channels (imessage), store config as credential metadata
    if (channel === 'imessage') {
      await addCredential(instance.id, 'imessage', 'api_key', JSON.stringify({
        cliPath: body.cliPath,
        dbPath: body.dbPath,
      }));
    }

    // IRC: server config stored as JSON credential blob
    if (channel === 'irc') {
      const ircConfig: Record<string, unknown> = {
        host: body.host,
        nick: body.nick,
      };
      if (body.port) ircConfig.port = parseInt(body.port, 10);
      if (body.tls) ircConfig.tls = body.tls === 'true';
      if (body.channels) ircConfig.channels = body.channels.split(',').map((s: string) => s.trim()).filter(Boolean);
      if (body.password) ircConfig.password = body.password;
      await addCredential(instance.id, 'irc', 'api_key', JSON.stringify(ircConfig));
    }

    // Matrix: homeserver + accessToken stored as JSON credential blob
    if (channel === 'matrix') {
      await addCredential(instance.id, 'matrix', 'api_key', JSON.stringify({
        homeserver: body.homeserver,
        accessToken: body.accessToken,
        ...(body.userId ? { userId: body.userId } : {}),
      }));
    }

    // BlueBubbles: serverUrl + password stored as JSON credential blob
    if (channel === 'bluebubbles') {
      await addCredential(instance.id, 'bluebubbles', 'api_key', JSON.stringify({
        serverUrl: body.serverUrl,
        password: body.password,
      }));
    }

    // Push channel config to gateway via merge-patch
    if (instance.status === 'running' && instance.controlEndpoint) {
      await pushChannelConfigToGateway(instance, channel, req.auth!.userId);
    }

    res.json({ ok: true, data: { message: `${channel} configured. Changes applied.` } } satisfies ApiResponse);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

router.post('/:id/channels/:channel/disconnect', async (req, res) => {
  try {
    const { channel } = req.params;

    const channelDef = CHANNEL_REQUIRED_FIELDS[channel];
    if (!channelDef) {
      res.status(400).json({ ok: false, error: `Unsupported channel: ${channel}` } satisfies ApiResponse);
      return;
    }

    const instance = await getInstance(req.params.id, req.auth!.userId);
    if (!instance) {
      res.status(404).json({ ok: false, error: 'Instance not found' } satisfies ApiResponse);
      return;
    }

    // Delete all credentials for this channel
    const existing = await listCredentials(instance.id);
    for (const cred of existing) {
      const isChannelCred = channelDef.credentialFields.some(cf => cf.provider === cred.provider)
        || cred.provider === channel; // catch config-only channels stored with channel name
      if (isChannelCred) {
        await deleteCredential(cred.id, instance.id);
      }
    }

    // Push channel config to gateway via merge-patch
    if (instance.status === 'running' && instance.controlEndpoint) {
      await pushChannelConfigToGateway(instance, channel, req.auth!.userId);
    }

    res.json({ ok: true, data: { message: `${channel} disconnected. Changes applied.` } } satisfies ApiResponse);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

/* ─── Telegram ─── */

router.post('/:id/channels/telegram/configure', async (req, res) => {
  try {
    const instance = await getInstance(req.params.id, req.auth!.userId);
    if (!instance) {
      res.status(404).json({ ok: false, error: 'Instance not found' } satisfies ApiResponse);
      return;
    }

    const { botToken } = req.body as { botToken?: string };
    if (!botToken || typeof botToken !== 'string' || !botToken.trim()) {
      res.status(400).json({ ok: false, error: 'Missing or invalid botToken' } satisfies ApiResponse);
      return;
    }

    const existing = await listCredentials(instance.id);
    for (const cred of existing) {
      if (cred.provider === 'telegram') {
        await deleteCredential(cred.id, instance.id);
      }
    }

    await addCredential(instance.id, 'telegram', 'api_key', botToken.trim());

    // Push channel config to gateway via merge-patch
    if (instance.status === 'running' && instance.controlEndpoint) {
      await pushChannelConfigToGateway(instance, 'telegram', req.auth!.userId);
    }

    res.json({ ok: true, data: { message: 'Telegram bot token configured. Changes applied.' } } satisfies ApiResponse);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

router.post('/:id/channels/telegram/disconnect', async (req, res) => {
  try {
    const instance = await getInstance(req.params.id, req.auth!.userId);
    if (!instance) {
      res.status(404).json({ ok: false, error: 'Instance not found' } satisfies ApiResponse);
      return;
    }

    const existing = await listCredentials(instance.id);
    for (const cred of existing) {
      if (cred.provider === 'telegram') {
        await deleteCredential(cred.id, instance.id);
      }
    }

    // Push channel config to gateway via merge-patch
    if (instance.status === 'running' && instance.controlEndpoint) {
      await pushChannelConfigToGateway(instance, 'telegram', req.auth!.userId);
    }

    res.json({ ok: true, data: { message: 'Telegram disconnected. Changes applied.' } } satisfies ApiResponse);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message } satisfies ApiResponse);
  }
});

export default router;
