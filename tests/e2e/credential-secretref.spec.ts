/**
 * CIT-170 Phase 1: Credential Injection Security — SecretRef Tests
 *
 * Verifies that:
 * - New tags (2026.3.13+) generate SecretRef-based auth-profiles.json (keyRef/tokenRef)
 * - Old tags (2026.3.2-p1) fall back to plaintext apiKey/token
 * - openclaw.json includes secrets.providers.default when SecretRef is active
 * - Platform mode injects LITELLM_API_KEY env var
 * - BYOK mode uses keyRef per provider
 * - OAuth profiles always remain plaintext (SecretRef unsupported for oauth type)
 * - Snapshots exclude auth-profiles.json from workspaceFiles
 *
 * These tests require a running server (port 3001) with Docker runtime.
 * Container start tests use 180s timeout (gateway needs ~150s).
 */
import { test, expect, type APIRequestContext } from '@playwright/test';
import { execSync } from 'child_process';

const API = 'http://localhost:3001/api';

function uniqueEmail() {
  return `cit170-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@e2e.test`;
}

async function signupAndGetCookie(request: APIRequestContext): Promise<string> {
  const email = uniqueEmail();
  const password = 'CIT170Test!';
  const displayName = 'CIT170 Tester';

  // Try signup first, fall back to login if 409
  const signupRes = await request.post(`${API}/auth/test-signup`, {
    data: { email, password, displayName },
  });
  if (signupRes.ok()) {
    const setCookie = signupRes.headers()['set-cookie'];
    const match = setCookie?.match(/token=([^;]+)/);
    if (match?.[1]) return `token=${match[1]}`;
  }
  if (signupRes.status() === 409) {
    const loginRes = await request.post(`${API}/auth/test-login`, {
      data: { email, password },
    });
    expect(loginRes.ok()).toBeTruthy();
    const setCookie = loginRes.headers()['set-cookie'];
    const match = setCookie?.match(/token=([^;]+)/);
    expect(match).toBeTruthy();
    return `token=${match![1]}`;
  }
  throw new Error(`Signup failed: ${signupRes.status()}`);
}

async function createInstance(
  request: APIRequestContext,
  cookie: string,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string; [key: string]: unknown }> {
  const res = await request.post(`${API}/instances`, {
    headers: { Cookie: cookie },
    data: {
      name: `cit170-${Date.now()}`,
      agentType: 'openclaw',
      ...overrides,
    },
  });
  expect(res.status()).toBe(201);
  const body = await res.json();
  return body.data;
}

async function addInstanceCredential(
  request: APIRequestContext,
  cookie: string,
  instanceId: string,
  data: { provider: string; credentialType: string; value: string; metadata?: unknown },
) {
  const res = await request.post(`${API}/instances/${instanceId}/credentials`, {
    headers: { Cookie: cookie },
    data,
  });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).data;
}

async function startInstance(request: APIRequestContext, cookie: string, instanceId: string) {
  const res = await request.post(`${API}/instances/${instanceId}/start`, {
    headers: { Cookie: cookie },
  });
  expect(res.ok()).toBeTruthy();
}

async function waitForRunning(
  request: APIRequestContext,
  cookie: string,
  instanceId: string,
  timeoutMs = 180_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await request.get(`${API}/instances/${instanceId}`, {
      headers: { Cookie: cookie },
    });
    if (res.ok()) {
      const body = await res.json();
      const status = body.data?.status;
      if (status === 'running') return;
      if (status === 'error') throw new Error(`Instance entered error state: ${body.data?.statusMessage}`);
    }
    await new Promise(r => setTimeout(r, 5_000));
  }
  throw new Error(`Instance ${instanceId} did not reach running state within ${timeoutMs}ms`);
}

async function stopInstance(request: APIRequestContext, cookie: string, instanceId: string) {
  await request.post(`${API}/instances/${instanceId}/stop`, {
    headers: { Cookie: cookie },
  }).catch(() => {});
}

async function deleteInstance(request: APIRequestContext, cookie: string, instanceId: string) {
  await request.delete(`${API}/instances/${instanceId}`, {
    headers: { Cookie: cookie },
  }).catch(() => {});
}

/**
 * Read a file from the running gateway container via `docker exec`.
 * Files are written to the volume at /home/node/.openclaw/{path}.
 * Container name format: openclaw-{instanceId.slice(0,8)}.
 */
function readContainerFile(
  instanceId: string,
  path: string,
): string | null {
  const containerName = `openclaw-${instanceId.slice(0, 8)}`;
  const fullPath = `/home/node/.openclaw/${path}`;
  try {
    const output = execSync(`docker exec ${containerName} cat ${fullPath}`, {
      encoding: 'utf8',
      timeout: 10_000,
    });
    return output;
  } catch {
    return null;
  }
}


// ═══════════════════════════════════════════════════════════════════
// TC-1xx: SecretRef — Platform Mode with Default Tag (2026.3.13)
// ═══════════════════════════════════════════════════════════════════

test.describe.serial('CIT-170: SecretRef Platform Mode (default tag)', () => {
  test.setTimeout(300_000); // 5 min for container startup + verification

  let cookie: string;
  let instanceId: string;

  test.beforeAll(async ({ request }) => {
    cookie = await signupAndGetCookie(request);
  });

  test.afterAll(async ({ request }) => {
    if (instanceId) {
      await stopInstance(request, cookie, instanceId);
      // Wait briefly for stop to complete
      await new Promise(r => setTimeout(r, 5_000));
      await deleteInstance(request, cookie, instanceId);
    }
  });

  test('TC-101: create platform-mode instance with default tag', async ({ request }) => {
    const instance = await createInstance(request, cookie, {
      billingMode: 'platform',
      // Default tag is 2026.3.13, which supports SecretRef
    });
    instanceId = instance.id;
    expect(instance.id).toBeTruthy();
  });

  test('TC-102: add api_key credential and start instance', async ({ request }) => {
    // Add a credential so we have something in auth-profiles.json
    await addInstanceCredential(request, cookie, instanceId, {
      provider: 'openrouter',
      credentialType: 'api_key',
      value: 'sk-test-openrouter-key-12345',
    });

    await startInstance(request, cookie, instanceId);
    await waitForRunning(request, cookie, instanceId);
  });

  test('TC-103: openclaw.json contains secrets.providers.default', async () => {
    const content = readContainerFile(instanceId, 'openclaw.json');
    expect(content).toBeTruthy();

    const cfg = JSON.parse(content!);
    expect(cfg.secrets).toBeDefined();
    expect(cfg.secrets.providers).toBeDefined();
    expect(cfg.secrets.providers.default).toBeDefined();
    expect(cfg.secrets.providers.default.source).toBe('env');
  });

  test('TC-104: auth-profiles.json uses keyRef (no plaintext apiKey)', async () => {
    const content = readContainerFile(instanceId, 'auth-profiles.json');
    expect(content).toBeTruthy();

    const authProfiles = JSON.parse(content!);
    expect(authProfiles.version).toBe(1);
    expect(authProfiles.profiles).toBeDefined();

    // In platform mode, there should be a litellm:default profile
    const litellmProfile = authProfiles.profiles['litellm:default'];
    expect(litellmProfile).toBeDefined();
    expect(litellmProfile.type).toBe('api_key');
    expect(litellmProfile.provider).toBe('litellm');

    // Must use keyRef, NOT plaintext apiKey
    expect(litellmProfile.keyRef).toBeDefined();
    expect(litellmProfile.keyRef.source).toBe('env');
    expect(litellmProfile.keyRef.provider).toBe('default');
    expect(litellmProfile.keyRef.id).toBe('LITELLM_API_KEY');

    // Must NOT contain plaintext apiKey
    expect(litellmProfile.apiKey).toBeUndefined();
  });
});


// ═══════════════════════════════════════════════════════════════════
// TC-2xx: SecretRef — BYOK Mode with Default Tag
// ═══════════════════════════════════════════════════════════════════

test.describe.serial('CIT-170: SecretRef BYOK Mode (default tag)', () => {
  test.setTimeout(300_000);

  let cookie: string;
  let instanceId: string;

  test.beforeAll(async ({ request }) => {
    cookie = await signupAndGetCookie(request);
  });

  test.afterAll(async ({ request }) => {
    if (instanceId) {
      await stopInstance(request, cookie, instanceId);
      await new Promise(r => setTimeout(r, 5_000));
      await deleteInstance(request, cookie, instanceId);
    }
  });

  test('TC-201: create BYOK instance with api_key credentials', async ({ request }) => {
    const instance = await createInstance(request, cookie, {
      billingMode: 'byok',
    });
    instanceId = instance.id;

    // Add OpenRouter api_key credential
    await addInstanceCredential(request, cookie, instanceId, {
      provider: 'openrouter',
      credentialType: 'api_key',
      value: 'sk-test-openrouter-byok-key',
    });
  });

  test('TC-202: start BYOK instance', async ({ request }) => {
    await startInstance(request, cookie, instanceId);
    await waitForRunning(request, cookie, instanceId);
  });

  test('TC-203: auth-profiles.json uses keyRef for api_key provider', async () => {
    const content = readContainerFile(instanceId, 'auth-profiles.json');
    expect(content).toBeTruthy();

    const authProfiles = JSON.parse(content!);
    expect(authProfiles.version).toBe(1);

    // BYOK mode should have an openrouter:default profile
    const profile = authProfiles.profiles['openrouter:default'];
    expect(profile).toBeDefined();
    expect(profile.type).toBe('api_key');
    expect(profile.provider).toBe('openrouter');

    // Must use keyRef, not plaintext apiKey
    expect(profile.keyRef).toBeDefined();
    expect(profile.keyRef.source).toBe('env');
    expect(profile.keyRef.provider).toBe('default');
    // The env var name comes from metadata; for openrouter it's typically OPENROUTER_API_KEY
    expect(profile.keyRef.id).toBeTruthy();
    expect(typeof profile.keyRef.id).toBe('string');

    // No plaintext value
    expect(profile.apiKey).toBeUndefined();
  });

  test('TC-204: openclaw.json contains secrets config', async () => {
    const content = readContainerFile(instanceId, 'openclaw.json');
    expect(content).toBeTruthy();
    const cfg = JSON.parse(content!);
    expect(cfg.secrets?.providers?.default?.source).toBe('env');
  });
});


// ═══════════════════════════════════════════════════════════════════
// TC-3xx: SecretRef — GitHub Copilot tokenRef
// ═══════════════════════════════════════════════════════════════════

test.describe.serial('CIT-170: SecretRef GitHub Copilot tokenRef', () => {
  test.setTimeout(300_000);

  let cookie: string;
  let instanceId: string;

  test.beforeAll(async ({ request }) => {
    cookie = await signupAndGetCookie(request);
  });

  test.afterAll(async ({ request }) => {
    if (instanceId) {
      await stopInstance(request, cookie, instanceId);
      await new Promise(r => setTimeout(r, 5_000));
      await deleteInstance(request, cookie, instanceId);
    }
  });

  test('TC-301: create instance with github-copilot oauth_token', async ({ request }) => {
    const instance = await createInstance(request, cookie, {
      billingMode: 'byok',
    });
    instanceId = instance.id;

    await addInstanceCredential(request, cookie, instanceId, {
      provider: 'github-copilot',
      credentialType: 'oauth_token',
      value: 'gho_test_copilot_token_12345',
    });
  });

  test('TC-302: start instance', async ({ request }) => {
    await startInstance(request, cookie, instanceId);
    await waitForRunning(request, cookie, instanceId);
  });

  test('TC-303: auth-profiles.json uses tokenRef for github-copilot', async () => {
    const content = readContainerFile(instanceId, 'auth-profiles.json');
    expect(content).toBeTruthy();

    const authProfiles = JSON.parse(content!);
    expect(authProfiles.version).toBe(1);

    // github-copilot uses profile key github-copilot:github (AUTH_PROFILE_KEY_OVERRIDES)
    const profile = authProfiles.profiles['github-copilot:github'];
    expect(profile).toBeDefined();
    expect(profile.type).toBe('token');
    expect(profile.provider).toBe('github-copilot');

    // Must use tokenRef, not plaintext token
    expect(profile.tokenRef).toBeDefined();
    expect(profile.tokenRef.source).toBe('env');
    expect(profile.tokenRef.provider).toBe('default');
    expect(profile.tokenRef.id).toBe('COPILOT_GITHUB_TOKEN');

    // No plaintext token
    expect(profile.token).toBeUndefined();
  });
});


// ═══════════════════════════════════════════════════════════════════
// TC-4xx: Fallback — Old Tag (2026.3.2-p1) Uses Plaintext
// ═══════════════════════════════════════════════════════════════════

test.describe.serial('CIT-170: Plaintext Fallback (old tag 2026.3.2-p1)', () => {
  test.setTimeout(300_000);

  const oldTagAvailable = (() => {
    try {
      execSync('docker image inspect openclaw-gateway:2026.3.2-p1', { stdio: 'ignore' });
      return true;
    } catch { return false; }
  })();

  let cookie: string;
  let instanceId: string;

  test.beforeAll(async ({ request }) => {
    test.skip(!oldTagAvailable, 'openclaw-gateway:2026.3.2-p1 image not available locally');
    cookie = await signupAndGetCookie(request);
  });

  test.afterAll(async ({ request }) => {
    if (instanceId) {
      await stopInstance(request, cookie, instanceId);
      await new Promise(r => setTimeout(r, 5_000));
      await deleteInstance(request, cookie, instanceId);
    }
  });

  test('TC-401: create instance with old tag 2026.3.2-p1', async ({ request }) => {
    const instance = await createInstance(request, cookie, {
      billingMode: 'byok',
      imageTag: '2026.3.2-p1',
    });
    instanceId = instance.id;

    await addInstanceCredential(request, cookie, instanceId, {
      provider: 'openrouter',
      credentialType: 'api_key',
      value: 'sk-test-plaintext-key-fallback',
    });
  });

  test('TC-402: start instance with old tag', async ({ request }) => {
    await startInstance(request, cookie, instanceId);
    await waitForRunning(request, cookie, instanceId);
  });

  test('TC-403: auth-profiles.json uses plaintext apiKey (no keyRef)', async () => {
    const content = readContainerFile(instanceId, 'auth-profiles.json');
    expect(content).toBeTruthy();

    const authProfiles = JSON.parse(content!);

    // Old tag should use plaintext
    const profile = authProfiles.profiles['openrouter:default'];
    expect(profile).toBeDefined();
    expect(profile.type).toBe('api_key');

    // Must use plaintext apiKey, NOT keyRef
    expect(profile.apiKey).toBe('sk-test-plaintext-key-fallback');
    expect(profile.keyRef).toBeUndefined();
  });

  test('TC-404: openclaw.json does NOT contain secrets config', async () => {
    const content = readContainerFile(instanceId, 'openclaw.json');
    expect(content).toBeTruthy();
    const cfg = JSON.parse(content!);
    expect(cfg.secrets).toBeUndefined();
  });
});


// ═══════════════════════════════════════════════════════════════════
// TC-5xx: OAuth Profiles Always Plaintext
// ═══════════════════════════════════════════════════════════════════

test.describe.serial('CIT-170: OAuth Profiles Plaintext (SecretRef unsupported)', () => {
  test.setTimeout(300_000);

  let cookie: string;
  let instanceId: string;

  test.beforeAll(async ({ request }) => {
    cookie = await signupAndGetCookie(request);
  });

  test.afterAll(async ({ request }) => {
    if (instanceId) {
      await stopInstance(request, cookie, instanceId);
      await new Promise(r => setTimeout(r, 5_000));
      await deleteInstance(request, cookie, instanceId);
    }
  });

  test('TC-501: create instance with OpenAI OAuth credential', async ({ request }) => {
    const instance = await createInstance(request, cookie, {
      billingMode: 'byok',
    });
    instanceId = instance.id;

    await addInstanceCredential(request, cookie, instanceId, {
      provider: 'openai',
      credentialType: 'oauth_token',
      value: 'test-oauth-access-token',
      metadata: {
        refreshToken: 'test-oauth-refresh-token',
        expiresIn: 3600,
      },
    });
  });

  test('TC-502: start instance', async ({ request }) => {
    await startInstance(request, cookie, instanceId);
    await waitForRunning(request, cookie, instanceId);
  });

  test('TC-503: auth-profiles.json uses plaintext oauth fields (no SecretRef)', async () => {
    const content = readContainerFile(instanceId, 'auth-profiles.json');
    expect(content).toBeTruthy();

    const authProfiles = JSON.parse(content!);

    // OpenAI OAuth routes through openai-codex provider
    const profile = authProfiles.profiles['openai-codex:default'];
    expect(profile).toBeDefined();
    expect(profile.type).toBe('oauth');
    expect(profile.provider).toBe('openai-codex');

    // OAuth profiles MUST use plaintext access/refresh (SecretRef doesn't support oauth type)
    expect(profile.access).toBe('test-oauth-access-token');
    expect(profile.refresh).toBe('test-oauth-refresh-token');
    expect(profile.expires).toBeDefined();
    expect(typeof profile.expires).toBe('number');

    // Must NOT have keyRef or tokenRef
    expect(profile.keyRef).toBeUndefined();
    expect(profile.tokenRef).toBeUndefined();
  });
});


// ═══════════════════════════════════════════════════════════════════
// TC-6xx: Snapshot Excludes auth-profiles.json
// ═══════════════════════════════════════════════════════════════════

test.describe.serial('CIT-170: Snapshot Excludes Sensitive Files', () => {
  test.setTimeout(300_000);

  let cookie: string;
  let instanceId: string;

  test.beforeAll(async ({ request }) => {
    cookie = await signupAndGetCookie(request);
  });

  test.afterAll(async ({ request }) => {
    if (instanceId) {
      await stopInstance(request, cookie, instanceId);
      await new Promise(r => setTimeout(r, 5_000));
      await deleteInstance(request, cookie, instanceId);
    }
  });

  test('TC-601: create and start instance with credentials', async ({ request }) => {
    const instance = await createInstance(request, cookie);
    instanceId = instance.id;

    await addInstanceCredential(request, cookie, instanceId, {
      provider: 'openrouter',
      credentialType: 'api_key',
      value: 'sk-test-snapshot-key',
    });

    await startInstance(request, cookie, instanceId);
    await waitForRunning(request, cookie, instanceId);
  });

  test('TC-602: create snapshot', async ({ request }) => {
    const res = await request.post(`${API}/instances/${instanceId}/snapshots`, {
      headers: { Cookie: cookie },
      data: {
        description: 'CIT-170 test snapshot',
        triggerType: 'manual',
      },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.data.id).toBeTruthy();
  });

  test('TC-603: snapshot workspaceFiles does NOT contain auth-profiles.json', async ({ request }) => {
    // List snapshots and get the most recent one
    const listRes = await request.get(`${API}/instances/${instanceId}/snapshots?page=1&limit=1`, {
      headers: { Cookie: cookie },
    });
    expect(listRes.ok()).toBeTruthy();
    const listBody = await listRes.json();
    expect(listBody.data.items.length).toBeGreaterThan(0);

    const snapshotId = listBody.data.items[0].id;

    // Get full snapshot detail
    const detailRes = await request.get(`${API}/instances/${instanceId}/snapshots/${snapshotId}`, {
      headers: { Cookie: cookie },
    });
    expect(detailRes.ok()).toBeTruthy();
    const detailBody = await detailRes.json();
    const workspaceFiles = detailBody.data.workspaceFiles as Record<string, string>;

    // auth-profiles.json MUST NOT appear in workspace files
    const sensitiveFiles = Object.keys(workspaceFiles).filter(
      f => f.includes('auth-profiles.json')
    );
    expect(sensitiveFiles).toEqual([]);
  });
});


// ═══════════════════════════════════════════════════════════════════
// TC-7xx: Platform Mode Environment Variables
// ═══════════════════════════════════════════════════════════════════

test.describe.serial('CIT-170: Environment Variable Injection', () => {
  // This test group verifies that the gateway receives correct env vars
  // by checking that the gateway can start and reach running state.
  // Direct env var inspection is not possible via API, so we verify
  // indirectly: if auth-profiles.json uses keyRef pointing to LITELLM_API_KEY
  // and the gateway starts successfully, the env var must be present.
  test.setTimeout(300_000);

  let cookie: string;
  let instanceId: string;

  test.beforeAll(async ({ request }) => {
    cookie = await signupAndGetCookie(request);
  });

  test.afterAll(async ({ request }) => {
    if (instanceId) {
      await stopInstance(request, cookie, instanceId);
      await new Promise(r => setTimeout(r, 5_000));
      await deleteInstance(request, cookie, instanceId);
    }
  });

  test('TC-701: platform mode instance starts successfully with SecretRef', async ({ request }) => {
    // If the env vars are wrong, the gateway will fail to resolve SecretRef
    // and either crash or fail health checks, staying in 'starting' state.
    const instance = await createInstance(request, cookie, {
      billingMode: 'platform',
    });
    instanceId = instance.id;

    await startInstance(request, cookie, instanceId);
    await waitForRunning(request, cookie, instanceId);

    // If we reach here, the gateway resolved LITELLM_API_KEY from env successfully
  });

  test('TC-702: verify gateway is functional via health RPC', async ({ request }) => {
    const res = await request.post(`${API}/instances/${instanceId}/rpc`, {
      headers: { Cookie: cookie },
      data: { method: 'health', params: {} },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});
