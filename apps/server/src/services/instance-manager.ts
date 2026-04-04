import { randomUUID, createHash } from 'crypto';
import { db } from '../db/index.js';
import { config } from '../config.js';
import { getAgentType, listAgentTypes } from '../agent-types/registry.js';
import { getRuntimeEngine } from '../runtime/factory.js';
import { getDecryptedCredentials } from './credential-store.js';
import { broadcast } from '../ws/index.js';
import { connectGateway, disconnectGateway } from './gateway-event-relay.js';
import { validateConfigPatch } from './config-validator.js';
import type { Instance, InstanceStatus, InstanceEvent, DeploymentTarget, CreateInstanceRequest, SetupCommand, BillingMode, SecurityProfile, PromptGuardResult, OutputFilterResult } from '@aquarium/shared';
import type { InstanceSpec, ExecResult } from '../runtime/types.js';
// CE stub — LiteLLM key management is EE-only
const litellmKeyManager = {
  async createKeyForInstance(_params: { instanceId: string; userId: string; userEmail: string }): Promise<{ virtualKey: string }> {
    return { virtualKey: '' };
  },
  async revokeKeyForInstance(_instanceId: string): Promise<void> { /* no-op */ },
};
import { safeAutoSnapshot } from './snapshot-store.js';
import { buildCredentialIndex, clearCredentialIndex, buildWorkspaceContentIndex, clearWorkspaceContentIndex } from './output-filter.js';
import { preloadDlpConfig, evictDlpConfig } from './gateway-event-relay.js';
import { scanContent } from './dlp-scanner.js';
import { createNotification } from './notification-store.js';
import { reconcileExtensions, replayPendingExtensions } from './extension-lifecycle.js';

// ── helpers ──

function computeConfigHash(configFiles: Map<string, string>): string | null {
  const openclawJson = configFiles.get('openclaw.json');
  if (!openclawJson) return null;
  return createHash('sha256').update(openclawJson).digest('hex');
}

function toInstance(row: Record<string, unknown>): Instance {
  const rawConfig = row.config;
  let config: Record<string, unknown> = {};
  if (typeof rawConfig === 'string') {
    try { config = JSON.parse(rawConfig); } catch { config = {}; }
  } else if (rawConfig && typeof rawConfig === 'object') {
    config = rawConfig as Record<string, unknown>;
  }

  return {
    id: row.id as string,
    userId: row.user_id as string,
    name: row.name as string,
    agentType: row.agent_type as string,
    imageTag: row.image_tag as string,
    status: row.status as InstanceStatus,
    statusMessage: (row.status_message as string) || null,
    deploymentTarget: row.deployment_target as DeploymentTarget,
    runtimeId: (row.runtime_id as string) || null,
    controlEndpoint: (row.control_endpoint as string) || null,
    authToken: row.auth_token as string,
    config,
    templateId: (row.template_id as string) || null,
    templateVersion: (row.template_version as string) || null,
    billingMode: (row.billing_mode as BillingMode) || undefined,
    securityProfile: (row.security_profile as SecurityProfile) || 'standard',
    proxyKeyId: (row.proxy_key_id as string) || null,
    litellmKeyHash: (row.litellm_key_hash as string) || null,
    avatar: (row.avatar as string) || null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

async function updateStatus(id: string, status: InstanceStatus, extra: Record<string, unknown> = {}, statusMessage?: string): Promise<void> {
  await db('instances').where({ id }).update({ status, status_message: statusMessage ?? null, updated_at: db.fn.now(), ...extra });
  broadcast(id, { type: 'instance:status', instanceId: id, payload: { status, statusMessage: statusMessage ?? null } });
}

async function addEvent(instanceId: string, eventType: string, metadata: Record<string, unknown> = {}): Promise<void> {
  await db('instance_events').insert({ instance_id: instanceId, event_type: eventType, metadata: JSON.stringify(metadata) });
}

export async function addSecurityEvent(
  instanceId: string,
  result: PromptGuardResult,
): Promise<void> {
  await addEvent(instanceId, 'security:prompt_injection_detected', {
    severity: result.maxSeverity,
    matchCount: result.matches.length,
    categories: [...new Set(result.matches.map(m => m.category))],
    patternIds: result.matches.map(m => m.patternId),
    durationMs: result.durationMs,
  });
}

export async function addOutputFilterEvent(
  instanceId: string,
  result: OutputFilterResult,
): Promise<void> {
  await addEvent(instanceId, 'security:output_filtered', {
    mode: result.mode,
    matchCount: result.matches.length,
    categories: [...new Set(result.matches.map(m => m.category))],
    durationMs: result.durationMs,
  });
}

function buildSpec(instance: Instance, manifest: ReturnType<typeof getAgentType>['manifest'], env: Record<string, string>): InstanceSpec {
  // Agent-type-specific image overrides via env vars (e.g. OPENCLAW_IMAGE=openclaw-gateway:2026.3.2-p1)
  const imageOverride = instance.agentType === 'openclaw' ? config.docker.openclawImage : '';

  // If imageTag contains ':' it's a custom image reference (e.g. "openclaw-gateway-clawra:2026.2.12-p1")
  // used by templates that require a specialised Docker image.
  const isCustomImage = instance.imageTag.includes(':');
  const image = imageOverride
    ? imageOverride
    : isCustomImage
      ? instance.imageTag
      : manifest.image.registry
        ? `${manifest.image.registry}${manifest.image.repository}:${instance.imageTag}`
        : `${manifest.image.repository}:${instance.imageTag}`;

  const containerName = `${instance.agentType}-${instance.id.slice(0, 8)}`;

  return {
    name: containerName,
    image,
    ports: manifest.ports.map(p => ({ name: p.name, containerPort: p.containerPort, protocol: p.protocol })),
    env: Object.fromEntries(Object.entries(env).filter(([_, v]) => v !== undefined)),
    secrets: {},
    volumes: manifest.volumes.map(v => ({ name: v.name, mountPath: v.mountPath, size: v.defaultSize })),
    resources: manifest.resources,
    securityContext: manifest.securityContext,
    healthCheck: manifest.healthCheck?.type === 'http' || manifest.healthCheck?.type === 'tcp'
      ? { type: manifest.healthCheck.type, port: manifest.healthCheck.port!, path: manifest.healthCheck.path, initialDelaySeconds: manifest.healthCheck.initialDelaySeconds, periodSeconds: manifest.healthCheck.periodSeconds }
      : undefined,
    labels: {
      'platform.io/agent-type': instance.agentType,
      'platform.io/instance-id': instance.id,
      'platform.io/user-id': instance.userId,
    },
  };
}

// ── public API ──

export async function createInstance(userId: string, req: CreateInstanceRequest): Promise<Instance> {
  const { manifest } = getAgentType(req.agentType);
  const imageTag = req.imageTag || manifest.image.defaultTag;
  const deploymentTarget = req.deploymentTarget || config.defaultDeploymentTarget;
  const authToken = randomUUID();

  const [row] = await db('instances')
    .insert({
      id: randomUUID(),
      user_id: userId,
      name: req.name,
      agent_type: req.agentType,
      image_tag: imageTag,
      deployment_target: deploymentTarget,
      billing_mode: req.billingMode === 'byok' ? 'byok' : 'platform',
      security_profile: req.securityProfile || (config.isCE ? 'unrestricted' : 'standard'),
      auth_token: authToken,
      config: JSON.stringify(req.config || {}),
      avatar: req.avatar || null,
    })
    .returning('*');

  const instance = toInstance(row);
  await addEvent(instance.id, 'created');
  return instance;
}

const WORKSPACE_FILE_KEYS = [
  { key: 'agentsmd', filename: 'workspace/AGENTS.md' },
  { key: 'soulmd', filename: 'workspace/SOUL.md' },
  { key: 'identitymd', filename: 'workspace/IDENTITY.md' },
  { key: 'usermd', filename: 'workspace/USER.md' },
  { key: 'toolsmd', filename: 'workspace/TOOLS.md' },
  { key: 'bootstrapmd', filename: 'workspace/BOOTSTRAP.md' },
  { key: 'heartbeatmd', filename: 'workspace/HEARTBEAT.md' },
  { key: 'memorymd', filename: 'workspace/MEMORY.md' },
] as const;

export async function syncWorkspaceFromContainer(instanceId: string): Promise<void> {
  const row = await db('instances').where({ id: instanceId }).first();
  if (!row) return;
  const instance = toInstance(row);
  if (!instance.runtimeId || instance.status !== 'running') return;

  try {
    const { manifest } = getAgentType(instance.agentType);
    const engine = getRuntimeEngine(instance.deploymentTarget);
    if (!engine.readFile) return;

    const volumeMountPath = manifest.volumes[0]?.mountPath || '/home/node/.openclaw';
    const currentConfig = (instance.config || {}) as Record<string, unknown>;
    let changed = false;

    for (const wf of WORKSPACE_FILE_KEYS) {
      try {
        const content = await engine.readFile(instance.runtimeId, `${volumeMountPath}/${wf.filename}`);
        if (content !== null && content !== currentConfig[wf.key]) {
          currentConfig[wf.key] = content;
          changed = true;
        }
      } catch {
        // skip — file may not exist yet
      }
    }

    if (changed) {
      await db('instances').where({ id: instanceId }).update({ config: JSON.stringify(currentConfig), updated_at: db.fn.now() });
    }

    // DLP scan workspace files for leaked secrets
    for (const wf of WORKSPACE_FILE_KEYS) {
      const fileContent = currentConfig[wf.key];
      if (typeof fileContent !== 'string' || !fileContent) continue;

      const findings = scanContent(fileContent, wf.filename);
      if (findings.length > 0) {
        const findingSummary = findings.map(f => `${f.patternName} (line ${f.lineNumber})`).join(', ');
        await addEvent(instanceId, 'security:dlp_alert', {
          filename: wf.filename,
          findingCount: findings.length,
          patterns: findings.map(f => ({ pattern: f.patternName, line: f.lineNumber, redacted: f.redacted })),
        });
        await createNotification({
          userId: instance.userId,
          instanceId,
          type: 'dlp_alert',
          severity: 'warn',
          title: `Potential secret detected in ${wf.filename}`,
          body: `DLP scan found ${findings.length} potential secret(s): ${findingSummary}`,
        });
        console.warn(`[syncWorkspace] DLP alert for ${instanceId}: ${findingSummary}`);
      }
    }
  } catch (err) {
     console.error(`[syncWorkspace] Failed for ${instanceId}:`, err);
  }
}

export async function reseedConfigFiles(instanceId: string): Promise<void> {
  const row = await db('instances').where({ id: instanceId }).first();
  if (!row) return;
  const instance = toInstance(row);
  if (!instance.runtimeId || instance.status !== 'running') return;

  try {
    const { manifest, adapter } = getAgentType(instance.agentType);
    const engine = getRuntimeEngine(instance.deploymentTarget);
    if (!adapter?.seedConfig || !engine.writeFiles) return;

    const creds = await getDecryptedCredentials(instanceId);
    const userConfig = instance.config || {};

    // Platform-mode: the LiteLLM virtual key is only available at startup
    // (it's generated by litellm-key-manager and not persisted in the DB).
    // During reseed, recover it from the on-disk auth-profiles.json so that
    // seedConfig can produce a correct litellm-routed openclaw.json instead
    // of falling back to the BYOK/openrouter code path.
    let litellmKey: string | undefined;
    if (instance.billingMode === 'platform' && engine.readFile) {
      try {
        const volumeMountPath = manifest.volumes[0]?.mountPath || '/home/node/.openclaw';
        const raw = await engine.readFile(instance.runtimeId!, `${volumeMountPath}/auth-profiles.json`);
        if (raw) {
          const parsed = JSON.parse(raw) as { profiles?: Record<string, { apiKey?: string; keyRef?: unknown }> };
          const litellmProfile = parsed.profiles?.['litellm:default'];
          if (litellmProfile) {
            // For images that use secretRef, the actual key lives in the
            // container env var — seedConfig only needs a truthy value to
            // enter the platform code path (it writes keyRef, not the raw key).
            litellmKey = litellmProfile.apiKey || (litellmProfile.keyRef ? 'secret-ref-placeholder' : undefined);
          }
        }
      } catch {
        // Can't read auth-profiles.json — litellmKey stays undefined,
        // seedConfig will fall back to BYOK path.
      }
    }

    const configFiles = await adapter.seedConfig({ instance, userConfig, credentials: creds, litellmKey });
    if (configFiles.size === 0) return;

    const volumeMountPath = manifest.volumes[0]?.mountPath || '/home/node/.openclaw';
    let filesToWrite = configFiles;
    if (adapter.categorizeConfigFiles) {
      const { alwaysOverwrite } = adapter.categorizeConfigFiles(configFiles);
      filesToWrite = alwaysOverwrite;
    }

    if (filesToWrite.size > 0) {
      await engine.writeFiles(instance.runtimeId, volumeMountPath, filesToWrite);
      console.log(`[reseedConfig] Re-seeded ${filesToWrite.size} config file(s) for ${instanceId}`);
    }

    // Read back the on-disk openclaw.json to compute the hash.
    // The gateway may normalise the file after we write it (e.g. inject
    // plugins.load.paths), so hashing our in-memory version can drift.
    let configHash: string | null = null;
    if (engine.readFile) {
      try {
        await new Promise(r => setTimeout(r, 3000));
        const diskContent = await engine.readFile(instance.runtimeId!, `${volumeMountPath}/openclaw.json`);
        if (diskContent) {
          configHash = createHash('sha256').update(diskContent).digest('hex');
        }
      } catch {
        configHash = computeConfigHash(configFiles);
      }
    } else {
      configHash = computeConfigHash(configFiles);
    }
    if (configHash) {
      await db('instances').where({ id: instanceId }).update({ config_hash: configHash });
    }

    // Refresh workspace content index with final seeded content (CIT-182)
    const seededWorkspaceFiles: Record<string, string> = {};
    for (const [path, content] of configFiles) {
      if (path.startsWith('workspace/') && content.length > 0) {
        seededWorkspaceFiles[path] = content;
      }
    }
    if (Object.keys(seededWorkspaceFiles).length > 0) {
      buildWorkspaceContentIndex(instanceId, seededWorkspaceFiles);
    }
  } catch (err) {
    console.error(`[reseedConfig] Failed for ${instanceId}:`, err);
  }
}


export async function cloneInstance(sourceId: string, userId: string): Promise<Instance> {
  const source = await getInstance(sourceId, userId);
  if (!source) throw new Error('Instance not found');

  const authToken = randomUUID();

  // Deep copy config but strip runtime-specific keys
  const sourceConfig = (source.config && typeof source.config === 'object')
    ? JSON.parse(JSON.stringify(source.config)) as Record<string, unknown>
    : {};
  delete sourceConfig.__setupCommands;

  const [row] = await db('instances')
    .insert({
      id: randomUUID(),
      user_id: userId,
      name: `Clone of ${source.name}`,
      agent_type: source.agentType,
      image_tag: source.imageTag,
      deployment_target: source.deploymentTarget,
      billing_mode: source.billingMode || 'platform',
      security_profile: source.securityProfile || (config.isCE ? 'unrestricted' : 'standard'),
      auth_token: authToken,
      config: JSON.stringify(sourceConfig),
    })
    .returning('*');

  const cloned = toInstance(row);
  await addEvent(cloned.id, 'cloned', { sourceInstanceId: sourceId });
  return cloned;
}

export async function getInstance(id: string, userId: string): Promise<Instance | null> {
  const row = await db('instances').where({ id, user_id: userId }).first();
  return row ? toInstance(row) : null;
}

export async function listInstances(userId: string): Promise<Instance[]> {
  const rows = await db('instances').where({ user_id: userId }).orderBy('created_at', 'desc');
  return rows.map(toInstance);
}

export async function updateSecurityProfile(
  id: string, userId: string, profile: SecurityProfile
): Promise<Instance> {
  const instance = await getInstance(id, userId);
  if (!instance) throw new Error('Instance not found');

  await db('instances').where({ id, user_id: userId })
    .update({ security_profile: profile, updated_at: db.fn.now() });

  const updated = await getInstance(id, userId);
  if (!updated) throw new Error('Instance not found after update');

  if (updated.status === 'running') {
    await reseedConfigFiles(id);
    const { adapter } = getAgentType(updated.agentType);
    if (adapter?.translateRPC && updated.controlEndpoint) {
      try {
        const cfg = await adapter.translateRPC({
          method: 'config.get',
          params: {},
          endpoint: updated.controlEndpoint,
          token: updated.authToken,
          instanceId: id,
        }) as { hash?: string } | null;
        if (cfg?.hash) {
          // Gateway 2026.3.13+ expects { raw: <full JSON string> }
          const engine2 = getRuntimeEngine(updated.deploymentTarget);
          const { manifest: m2 } = getAgentType(updated.agentType);
          let rawConfig: string | null | undefined;
          if (engine2.readFile && updated.runtimeId) {
            const volPath = m2.volumes[0]?.mountPath || '/home/node/.openclaw';
            try {
              rawConfig = await engine2.readFile(updated.runtimeId, `${volPath}/openclaw.json`);
            } catch { /* fallback */ }
          }
          await adapter.translateRPC({
            method: 'config.patch',
            params: {
              ...(rawConfig ? { raw: rawConfig } : { patch: {} }),
              baseHash: cfg.hash,
              note: `Platform: security profile → ${profile}`,
              restartDelayMs: 2000,
            },
            endpoint: updated.controlEndpoint,
            token: updated.authToken,
            instanceId: id,
          });
        }
      } catch (err) {
        console.error(`[security-profile] config.patch failed for ${id}:`, err);
      }
    }
  }

  return updated;
}

export async function startInstance(id: string, userId: string): Promise<Instance> {
  const instance = await getInstance(id, userId);
  if (!instance) throw new Error('Instance not found');
  if (instance.status !== 'created' && instance.status !== 'stopped' && instance.status !== 'error') {
    throw new Error(`Cannot start instance in state: ${instance.status}`);
  }

  await updateStatus(id, 'starting');
  await addEvent(id, 'starting');

  // Run the heavy provisioning work in the background so the HTTP response
  // returns immediately.  The frontend already tracks status via WebSocket.
  startInstanceAsync(id, userId, instance).catch(() => {
    // errors handled inside — this catch prevents unhandled-rejection noise
  });

  return (await getInstance(id, userId))!;
}

async function startInstanceAsync(id: string, userId: string, instance: Instance): Promise<void> {
  const { manifest, adapter } = getAgentType(instance.agentType);
  const engine = getRuntimeEngine(instance.deploymentTarget);


  let litellmKey: string | undefined;
  try {
    const creds = await getDecryptedCredentials(id);

    buildCredentialIndex(id, creds.map(c => c.value));
    preloadDlpConfig(id, instance.securityProfile ?? 'standard');

    // Platform Mode: create LiteLLM virtual key for this instance.
    // This MUST succeed — without a valid key the adapter falls back to
    // BYOK mode which produces a broken config (no provider credentials).
    if (instance.billingMode === 'platform') {
      const userRow = await db('users').where('id', userId).select('email').first();
      if (!userRow?.email) {
        throw new Error('Platform billing requires a user email for LiteLLM key generation');
      }
      const result = await litellmKeyManager.createKeyForInstance({
        instanceId: id,
        userId,
        userEmail: userRow.email as string,
      });
      litellmKey = result.virtualKey;
    }

    let env: Record<string, string> = {};
    if (adapter?.resolveEnv) {
      env = await adapter.resolveEnv({ instance, credentials: creds, litellmKey });
    }

    // Build spec
    const spec = buildSpec(instance, manifest, env);

    // Start container
    const result = await engine.start(spec);

    // Record runtime info immediately so the health monitor can track it
    const controlEndpoint = result.endpoints[manifest.ports[0]?.name] || null;
    await updateStatus(id, 'starting', {
      runtime_id: result.runtimeId,
      control_endpoint: controlEndpoint,
    }, 'Provisioning pod...');

    // Phase 1: generate config for active/degraded extensions only (plugins + skills)
    // Pending extensions are excluded here — they are handled by Phase 3 replay below.
    const userConfig = instance.config || {};
    if (adapter?.seedConfig && engine.writeFiles) {
      await updateStatus(id, 'starting', {}, 'Waiting for pod ready...');
      const configFiles = await adapter.seedConfig({ instance, userConfig, credentials: creds, litellmKey });
      if (configFiles.size > 0) {
        const volumeMountPath = manifest.volumes[0]?.mountPath || '/home/node/.openclaw';

        let filesToWrite = configFiles;
        if (adapter.categorizeConfigFiles && engine.listFiles) {
          const { alwaysOverwrite, seedIfAbsent } = adapter.categorizeConfigFiles(configFiles);
          const existingFiles = await engine.listFiles(result.runtimeId, `${volumeMountPath}/workspace`).catch(() => [] as string[]);

          filesToWrite = new Map(alwaysOverwrite);
          for (const [path, content] of seedIfAbsent) {
            const filename = path.split('/').pop() || path;
            if (!existingFiles.includes(filename)) {
              filesToWrite.set(path, content);
            }
          }
        }

        if (filesToWrite.size > 0) {
          await updateStatus(id, 'starting', {}, 'Seeding config files...');
          await engine.writeFiles(result.runtimeId, volumeMountPath, filesToWrite);
        }

        // Create symlink so doubled workspace paths resolve correctly.
        // The gateway creates .openclaw/ inside workspace for state tracking.
        // The agent LLM sometimes constructs paths like ".openclaw/workspace/USER.md"
        // instead of just "USER.md", doubling the workspace prefix. This symlink
        // makes those paths resolve to the correct location.
        if (engine.exec) {
          const wsPath = `${volumeMountPath}/workspace`;
          await engine.exec(result.runtimeId, [
            'sh', '-c',
            `mkdir -p '${wsPath}/.openclaw' && ln -sfn '${wsPath}' '${wsPath}/.openclaw/workspace' 2>/dev/null || true`,
          ]).catch(() => { /* best-effort */ });
        }

        // Store SHA-256 hash of openclaw.json for integrity verification
        const configHash = computeConfigHash(configFiles);
        if (configHash) {
          await db('instances').where({ id }).update({ config_hash: configHash });
        }

        // Build workspace content index from final seeded files (CIT-182:
        // must use post-seedConfig content so injected security paragraphs are indexed)
        const seededWorkspaceFiles: Record<string, string> = {};
        for (const [path, content] of configFiles) {
          if (path.startsWith('workspace/') && content.length > 0) {
            seededWorkspaceFiles[path] = content;
          }
        }
        buildWorkspaceContentIndex(id, seededWorkspaceFiles);
      }
    }

    // Execute template setup commands inside the container
    const setupCommands = (userConfig as Record<string, unknown>).__setupCommands as SetupCommand[] | undefined;
    if (setupCommands && setupCommands.length > 0 && engine.exec) {
      await updateStatus(id, 'starting', {}, 'Running setup commands...');
      for (const cmd of setupCommands) {
        try {
          const execResult: ExecResult = await engine.exec(result.runtimeId, cmd.command, {
            workDir: cmd.workDir,
            timeout: cmd.timeout,
          });
          if (execResult.exitCode !== 0) {
            console.warn(`[startInstance] Setup command failed (exit ${execResult.exitCode}): ${cmd.command.join(' ')}`, execResult.stderr);
          }
        } catch (err) {
          console.warn(`[startInstance] Setup command error: ${cmd.command.join(' ')}`, err);
        }
      }
    }

    // K8s pods take minutes to become ready; health monitor transitions starting→running
    const isK8s = instance.deploymentTarget === 'kubernetes';
    if (!isK8s) {
      await updateStatus(id, 'running', {});
    }

    await addEvent(id, 'started', { runtimeId: result.runtimeId });

    // Eagerly establish persistent gateway connection (don't wait for 10s poll)
    if (controlEndpoint && instance.authToken) {
      connectGateway(id, controlEndpoint, instance.authToken);
    }

    // Phase 2: boot + reconcile extension state with gateway reality (non-blocking)
    if (controlEndpoint && instance.authToken) {
      try {
        const result = await reconcileExtensions(id, controlEndpoint, instance.authToken);
        console.log(`[extensions] Reconciliation for ${id}: promoted=${result.promoted.length}, demoted=${result.demoted.length}`);
      } catch (err) {
        console.warn(`[extensions] Reconciliation failed for ${id}:`, err);
        // Non-fatal — instance continues booting
      }
    }

    // Phase 3: replay remaining pending extensions (non-blocking)
    // Pending extensions come from template instantiation or crash recovery.
    // Trust was already evaluated at import/instantiation time.
    if (controlEndpoint && instance.authToken) {
      try {
        const replay = await replayPendingExtensions(id, controlEndpoint, instance.authToken, userId);
        if (replay.installed.length > 0 || replay.failed.length > 0) {
          console.log(`[extensions] Phase 3 replay for ${id}: installed=${replay.installed.length}, failed=${replay.failed.length}, needsCredentials=${replay.needsCredentials.length}`);
        }
      } catch (err) {
        console.warn(`[extensions] Phase 3 replay failed for ${id}:`, err);
        // Non-fatal — instance continues running
      }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[startInstance] Failed for ${id}:`, message);
    await updateStatus(id, 'error');
    await addEvent(id, 'error', { message });

    clearCredentialIndex(id);
    clearWorkspaceContentIndex(id);
    evictDlpConfig(id);

    if (litellmKey && instance.billingMode === 'platform') {
      try {
        await litellmKeyManager.revokeKeyForInstance(id);
      } catch (revokeErr) {
        console.warn('[startInstance] Failed to revoke LiteLLM key during error cleanup:', revokeErr);
      }
    }
  }
}

export async function stopInstance(id: string, userId: string): Promise<Instance> {
  const instance = await getInstance(id, userId);
  if (!instance) throw new Error('Instance not found');
  if (instance.status !== 'running' && instance.status !== 'starting' && instance.status !== 'error') {
    throw new Error(`Cannot stop instance in state: ${instance.status}`);
  }

  await updateStatus(id, 'stopping');

  stopInstanceAsync(id, userId, instance).catch(() => {});

  return (await getInstance(id, userId))!;
}

async function stopInstanceAsync(id: string, userId: string, instance: Instance): Promise<void> {
  disconnectGateway(id);
  clearCredentialIndex(id);
  clearWorkspaceContentIndex(id);
  evictDlpConfig(id);
  const engine = getRuntimeEngine(instance.deploymentTarget);
  try {
    if (instance.runtimeId) {
      await engine.stop(instance.runtimeId);
      await engine.delete(instance.runtimeId);
    }
    await updateStatus(id, 'stopped', { runtime_id: null, control_endpoint: null });
    await addEvent(id, 'stopped');

    // Platform Mode: revoke LiteLLM virtual key
    if (instance.billingMode === 'platform') {
      try {
        await litellmKeyManager.revokeKeyForInstance(id);
      } catch (err) {
        console.warn(`[stopInstance] LiteLLM key revocation failed for ${id}:`, err);
      }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[stopInstance] Failed for ${id}:`, message);
    await updateStatus(id, 'error');
    await addEvent(id, 'error', { message });
  }
}

export async function restartInstance(id: string, userId: string): Promise<Instance> {
  const instance = await getInstance(id, userId);
  if (!instance) throw new Error('Instance not found');
  await safeAutoSnapshot(id, userId, '重启实例');

  if (instance.status === 'running' || instance.status === 'starting' || instance.status === 'error') {
    // Stop synchronously so we don't start a new pod while the old one is still running
    const engine = getRuntimeEngine(instance.deploymentTarget);
    try {
      if (instance.runtimeId) {
        await engine.stop(instance.runtimeId);
        await engine.delete(instance.runtimeId);
      }
      await updateStatus(instance.id, 'stopped', { runtime_id: null, control_endpoint: null });
    } catch {
      // best effort — proceed to start anyway
    }
  }

  return startInstance(id, userId);
}

export async function updateInstanceConfig(id: string, userId: string, config: Record<string, unknown>): Promise<Instance> {
  const instance = await getInstance(id, userId);
  if (!instance) throw new Error('Instance not found');
  const changedFiles = Object.keys(config).join(', ');
  await safeAutoSnapshot(id, userId, '修改配置: ' + changedFiles);

  const patch: Record<string, unknown> = { config: JSON.stringify(config), updated_at: db.fn.now() };

  // Sync platform-level fields from config JSONB to their dedicated columns
  if (config.billingMode === 'platform' || config.billingMode === 'byok') {
    patch.billing_mode = config.billingMode;
  }

  // Sync agentName to the instance name column so dashboard reflects the updated name
  if (typeof config.agentName === 'string' && config.agentName.trim()) {
    patch.name = config.agentName;
  }

  await db('instances').where({ id }).update(patch);
  return (await getInstance(id, userId))!;
}

// ── config.patch hot-reload ──

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] && typeof source[key] === 'object' && !Array.isArray(source[key]) &&
      result[key] && typeof result[key] === 'object' && !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(result[key] as Record<string, unknown>, source[key] as Record<string, unknown>);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

export async function patchGatewayConfig(
  instanceId: string,
  userId: string,
  configPatch: Record<string, unknown>,
  note?: string,
): Promise<void> {
  // 1. DB-first: fetch instance, deep-merge config, persist
  const instance = await getInstance(instanceId, userId);
  if (!instance) throw new Error('Instance not found');
  await safeAutoSnapshot(instanceId, userId, '修改 Gateway 配置');

  const mergedConfig = deepMerge(
    (instance.config || {}) as Record<string, unknown>,
    configPatch,
  );

  // Validate merged config against gateway schema before persisting to DB
  const fetchSchema = async (): Promise<object | null> => {
    if (instance.status !== 'running' || !instance.controlEndpoint) return null;
    try {
      const { adapter } = getAgentType(instance.agentType);
      if (!adapter?.translateRPC) return null;
      const result = await adapter.translateRPC({
        method: 'config.schema',
        params: {},
        endpoint: instance.controlEndpoint,
        token: instance.authToken,
        instanceId,
      }) as { schema?: object } | null;
      return result?.schema ?? null;
    } catch { return null; }
  };

  const validation = await validateConfigPatch(instanceId, mergedConfig, fetchSchema, { skipFullSchemaValidation: true });
  if (!validation.valid) {
    throw new Error('Config validation failed: ' + (validation.errors?.join('; ') ?? 'Unknown error'));
  }

  await updateInstanceConfig(instanceId, userId, mergedConfig);

  // 2. Gateway push (only if running)
  if (instance.status !== 'running' || !instance.controlEndpoint) {
    return;
  }

  try {
    const { adapter } = getAgentType(instance.agentType);
    if (!adapter?.translateRPC) return;

    const endpoint = instance.controlEndpoint;
    const token = instance.authToken;
    const MAX_RETRIES = 3;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      // Fetch current config hash
      const cfgResult = await adapter.translateRPC({
        method: 'config.get',
        params: {},
        endpoint,
        token,
        instanceId,
      }) as { hash?: string } | null;

      const baseHash = cfgResult?.hash;

      // Gateway 2026.3.13+ expects { raw: <full JSON string> } instead of { patch: <object> }.
      // Re-seed config files to disk first, then read the full config to send as raw.
      await reseedConfigFiles(instanceId);

      // Read the seeded config file content
      const { manifest: m2, adapter: a2 } = getAgentType(instance.agentType);
      const engine2 = getRuntimeEngine(instance.deploymentTarget);
      let rawConfig: string | null | undefined;
      if (a2?.seedConfig && engine2.readFile && instance.runtimeId) {
        const volumeMountPath = m2.volumes[0]?.mountPath || '/home/node/.openclaw';
        try {
          rawConfig = await engine2.readFile(instance.runtimeId, `${volumeMountPath}/openclaw.json`);
        } catch { /* fallback: send without raw */ }
      }

      try {
        await adapter.translateRPC({
          method: 'config.patch',
          params: {
            ...(rawConfig ? { raw: rawConfig } : { patch: configPatch }),
            baseHash,
            note: note || 'Platform config update',
            restartDelayMs: 2000,
          },
          endpoint,
          token,
          instanceId,
        });
        console.log(`[config-patch] Pushed config.patch for ${instanceId}`);
        return;
      } catch (patchErr: unknown) {
        const errMsg = patchErr instanceof Error ? patchErr.message : String(patchErr);
        if ((errMsg.includes('config changed') || errMsg.includes('CONFLICT')) && attempt < MAX_RETRIES) {
          console.warn(`[config-patch] baseHash conflict for ${instanceId}, retrying (${attempt}/${MAX_RETRIES})`);
          continue;
        }
        throw patchErr;
      }
    }
  } catch (err: unknown) {
    // Gateway push failure is non-critical -- DB is already updated.
    // Config will be picked up on next reseedConfigFiles.
    console.error(`[config-patch] Gateway push failed for ${instanceId}:`, err);
  }
}

export async function deleteInstance(id: string, userId: string, purge = false): Promise<void> {
  const instance = await getInstance(id, userId);
  if (!instance) throw new Error('Instance not found');

  disconnectGateway(id);
  clearCredentialIndex(id);
  clearWorkspaceContentIndex(id);
  evictDlpConfig(id);
  const engine = getRuntimeEngine(instance.deploymentTarget);

  if (instance.runtimeId) {
    try {
      if (purge) {
        await engine.purge(instance.runtimeId);
      } else {
        await engine.stop(instance.runtimeId);
        await engine.delete(instance.runtimeId);
      }
    } catch {
      // Best effort cleanup
    }
  }

  await addEvent(id, purge ? 'purged' : 'deleted');
  await db('instances').where({ id, user_id: userId }).delete();
}

export async function getInstanceEvents(id: string, userId: string, eventType?: string): Promise<InstanceEvent[]> {
  const instance = await getInstance(id, userId);
  if (!instance) throw new Error('Instance not found');
  let query = db('instance_events').where({ instance_id: id });
  if (eventType) {
    query = query.where('event_type', eventType);
  }
  const rows = await query.orderBy('created_at', 'desc').limit(100);
  return rows.map((row: Record<string, unknown>) => ({
    id: row.id as string,
    instanceId: row.instance_id as string,
    eventType: row.event_type as string,
    metadata: (typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata ?? {}) as Record<string, unknown>,
    createdAt: String(row.created_at),
  }));
}

export async function reconcileInstances(): Promise<void> {
  const activeInstances = await db('instances').whereIn('status', ['running', 'starting']);

  for (const row of activeInstances) {
    const instance = toInstance(row);
    if (!instance.runtimeId) {
      await updateStatus(instance.id, 'stopped', { runtime_id: null, control_endpoint: null });
      continue;
    }

    try {
      const engine = getRuntimeEngine(instance.deploymentTarget);
      const status = await engine.getStatus(instance.runtimeId);

      if (status.phase === 'running') {
        await engine.ensureLiteLLMConnected?.(instance.id);
      } else if (status.phase === 'stopped' || status.phase === 'not_found') {
        await updateStatus(instance.id, 'stopped', { runtime_id: null, control_endpoint: null });
      } else if (status.phase === 'error') {
        await updateStatus(instance.id, 'error');
      }
    } catch {
      await updateStatus(instance.id, 'error');
    }
  }
}

export async function verifyLiveStatus(instance: Instance): Promise<Instance> {
  if (instance.status !== 'running' && instance.status !== 'starting') {
    return instance;
  }
  if (!instance.runtimeId) {
    return instance;
  }

  try {
    const engine = getRuntimeEngine(instance.deploymentTarget);
    const runtimeStatus = await engine.getStatus(instance.runtimeId);

    if (runtimeStatus.phase === 'running') {
      if (instance.status === 'running') return instance;
      if (instance.status === 'starting') {
        await updateStatus(instance.id, 'running');
        return { ...instance, status: 'running', statusMessage: null };
      }
    }

    if (runtimeStatus.phase === 'starting') {
      const statusMessage = runtimeStatus.message || 'Starting...';
      if (instance.status !== 'starting' || instance.statusMessage !== statusMessage) {
        await updateStatus(instance.id, 'starting', {}, statusMessage);
      }
      return { ...instance, status: 'starting', statusMessage };
    }

    if (runtimeStatus.phase === 'stopped' || runtimeStatus.phase === 'not_found') {
      await updateStatus(instance.id, 'stopped', { runtime_id: null, control_endpoint: null });
      return { ...instance, status: 'stopped', runtimeId: null, controlEndpoint: null, statusMessage: null };
    }
    if (runtimeStatus.phase === 'error') {
      const statusMessage = runtimeStatus.message || null;
      await updateStatus(instance.id, 'error', {}, statusMessage ?? undefined);
      return { ...instance, status: 'error', statusMessage };
    }
  } catch (err) {
    console.error(`[verifyLiveStatus] Runtime check failed for ${instance.id}:`, err);
  }

  return instance;
}
