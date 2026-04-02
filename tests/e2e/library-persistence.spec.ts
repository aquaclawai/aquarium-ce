import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const DOCKERFILE = readFileSync(join(ROOT, 'openclaw/docker/base/Dockerfile'), 'utf8');
const ENTRYPOINT = readFileSync(join(ROOT, 'openclaw/docker/base/docker-entrypoint.sh'), 'utf8');
const MANIFEST_SRC = readFileSync(
  join(ROOT, 'apps/server/src/agent-types/openclaw/manifest.ts'),
  'utf8',
);

// ── Dockerfile: Runtime Dependencies ───────────────────

test.describe('Library Persistence — Dockerfile', () => {
  test('installs python3 and pip in production stage', () => {
    const stage2 = DOCKERFILE.split('Stage 2')[1];
    expect(stage2).toBeDefined();
    expect(stage2).toContain('python3');
    expect(stage2).toContain('python3-pip');
  });

  test('sets NPM_CONFIG_PREFIX to PVC-backed path', () => {
    expect(DOCKERFILE).toContain('NPM_CONFIG_PREFIX="/home/node/.openclaw/npm-global"');
  });

  test('sets PYTHONUSERBASE to PVC-backed path', () => {
    expect(DOCKERFILE).toContain('PYTHONUSERBASE="/home/node/.openclaw/python-user"');
  });

  test('enables pip user mode', () => {
    expect(DOCKERFILE).toContain('PIP_USER="1"');
  });

  test('prepends user lib bin dirs to PATH', () => {
    expect(DOCKERFILE).toContain('/home/node/.openclaw/npm-global/bin');
    expect(DOCKERFILE).toContain('/home/node/.openclaw/python-user/bin');
  });

  test('sets NODE_PATH for user npm packages', () => {
    expect(DOCKERFILE).toContain('NODE_PATH="/home/node/.openclaw/npm-global/lib/node_modules"');
  });

  test('creates npm-global and python-user dirs in image layer', () => {
    expect(DOCKERFILE).toContain('/home/node/.openclaw/npm-global/lib');
    expect(DOCKERFILE).toContain('/home/node/.openclaw/python-user');
  });

  test('OpenClaw packages stay at /usr/local (immutable image layer)', () => {
    expect(DOCKERFILE).toContain('COPY --from=builder /usr/local/lib/node_modules /usr/local/lib/node_modules');
    expect(DOCKERFILE).toContain('COPY --from=builder /usr/local/bin/openclaw /usr/local/bin/openclaw');
  });
});

// ── Entrypoint: Boot-time Directory Creation ───────────

test.describe('Library Persistence — Entrypoint', () => {
  test('creates npm-global directory on boot', () => {
    expect(ENTRYPOINT).toContain('npm-global/lib');
  });

  test('creates python-user directory on boot', () => {
    expect(ENTRYPOINT).toContain('python-user');
  });

  test('retains existing boot directories', () => {
    expect(ENTRYPOINT).toContain('credentials');
    expect(ENTRYPOINT).toContain('workspace');
    expect(ENTRYPOINT).toContain('agents');
  });
});

// ── Manifest: PVC Volume Size ──────────────────────────

test.describe('Library Persistence — Manifest', () => {
  test('PVC default size is 2Gi', () => {
    expect(MANIFEST_SRC).toContain("defaultSize: '2Gi'");
  });

  test('PVC mount path is /home/node/.openclaw', () => {
    expect(MANIFEST_SRC).toContain("mountPath: '/home/node/.openclaw'");
  });

  test('volume name is openclaw-data', () => {
    expect(MANIFEST_SRC).toContain("name: 'openclaw-data'");
  });
});
