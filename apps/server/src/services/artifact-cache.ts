import { getRuntimeEngine } from '../runtime/factory.js';
import type { DeploymentTarget, ExtensionKind } from '@aquarium/shared';

// ─── Constants ─────────────────────────────────────────────────────────────────

export const CACHE_BASE = '/home/node/.openclaw/plugin-cache';

// ─── Path Helpers ─────────────────────────────────────────────────────────────

/**
 * Compute the expected cache path for an artifact without performing any I/O.
 *
 * - Plugin: `{CACHE_BASE}/plugin/{extensionId}/{version}.tgz`
 * - Skill:  `{CACHE_BASE}/skill/{extensionId}/{version}/`
 */
export function getCachedArtifactPath(
  kind: ExtensionKind,
  extensionId: string,
  version: string,
): string {
  if (kind === 'plugin') {
    return `${CACHE_BASE}/plugin/${extensionId}/${version}.tgz`;
  }
  // skill
  return `${CACHE_BASE}/skill/${extensionId}/${version}/`;
}

// ─── Cache Probe ──────────────────────────────────────────────────────────────

/**
 * Check whether a cached artifact exists inside the container.
 * Returns false on any error (network, container down, etc.) or if exec is unsupported.
 */
export async function isArtifactCached(
  kind: ExtensionKind,
  extensionId: string,
  version: string,
  runtimeId: string,
  deploymentTarget: DeploymentTarget,
): Promise<boolean> {
  try {
    const cachePath = getCachedArtifactPath(kind, extensionId, version);
    const engine = getRuntimeEngine(deploymentTarget);
    if (!engine.exec) return false;
    const result = await engine.exec(runtimeId, ['test', '-e', cachePath], { timeout: 5000 });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

// ─── Cache Writer ─────────────────────────────────────────────────────────────

/**
 * Cache an installed artifact inside the container's persistent volume.
 *
 * - Plugin: runs `npm pack` in the plugin's install directory and renames
 *   the output to `{version}.tgz` inside `{CACHE_BASE}/plugin/{extensionId}/`.
 * - Skill: copies the skill directory to `{CACHE_BASE}/skill/{extensionId}/{version}/`.
 *
 * All errors are caught and warn-logged. Cache failure NEVER blocks the install flow.
 * Bundled extensions are skipped (they ship with the image).
 */
export async function cacheArtifact(
  kind: ExtensionKind,
  extensionId: string,
  version: string,
  runtimeId: string,
  deploymentTarget: DeploymentTarget,
): Promise<void> {
  try {
    const engine = getRuntimeEngine(deploymentTarget);
    if (!engine.exec) {
      console.warn(`[artifact-cache] exec not supported by ${deploymentTarget} engine — skipping cache for ${kind} ${extensionId}@${version}`);
      return;
    }
    const exec = engine.exec.bind(engine);

    if (kind === 'plugin') {
      const cacheDir = `${CACHE_BASE}/plugin/${extensionId}`;
      const cachePath = `${cacheDir}/${version}.tgz`;
      const installPath = `/home/node/.openclaw/plugins/${extensionId}`;

      // npm pack outputs a file named `{name}-{version}.tgz` — we rename it to the
      // canonical `{version}.tgz` so look-ups are deterministic.
      const cmd = [
        'sh',
        '-c',
        `mkdir -p '${cacheDir}' && cd '${installPath}' && npm pack --pack-destination '${cacheDir}' && mv '${cacheDir}'/*.tgz '${cachePath}' 2>/dev/null || true`,
      ];
      await exec(runtimeId, cmd, { timeout: 30000 });
    } else {
      // skill
      const cachePath = getCachedArtifactPath(kind, extensionId, version);
      const installPath = `/home/node/.openclaw/skills/${extensionId}`;

      const cmd = [
        'sh',
        '-c',
        `mkdir -p '${cachePath}' && cp -r '${installPath}/.' '${cachePath}'`,
      ];
      await exec(runtimeId, cmd, { timeout: 30000 });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[artifact-cache] Failed to cache ${kind} ${extensionId}@${version}: ${message}`);
    // Never re-throw — cache failure must never block the install flow
  }
}
