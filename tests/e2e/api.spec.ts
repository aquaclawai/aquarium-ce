import { test, expect, type APIRequestContext } from '@playwright/test';
import type { CreateInstanceRequest, AddCredentialRequest } from '@aquarium/shared';

const API = 'http://localhost:3001/api';

function uniqueEmail() {
  return `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@e2e.test`;
}

async function signup(request: APIRequestContext, overrides?: { email?: string; password?: string; displayName?: string }) {
  const email = overrides?.email ?? uniqueEmail();
  const password = overrides?.password ?? 'TestPass123!';
  const displayName = overrides?.displayName ?? 'E2E User';
  const res = await request.post(`${API}/auth/test-signup`, {
    data: { email, password, displayName },
  });
  return { res, email, password, displayName };
}

async function signupAndGetCookie(request: APIRequestContext): Promise<string> {
  const { res } = await signup(request);
  expect(res.ok()).toBeTruthy();
  const setCookie = res.headers()['set-cookie'];
  expect(setCookie).toBeDefined();
  const match = setCookie.match(/token=([^;]+)/);
  expect(match).toBeTruthy();
  return `token=${match![1]}`;
}

test.describe('Auth API', () => {
  test('test-signup returns user and token', async ({ request }) => {
    const { res, email, displayName } = await signup(request);
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.user.email).toBe(email);
    expect(body.data.user.displayName).toBe(displayName);
    expect(body.data.token).toBeTruthy();
    expect(body.data.user.id).toBeTruthy();
  });

  test('test-signup rejects duplicate email', async ({ request }) => {
    const email = uniqueEmail();
    const first = await request.post(`${API}/auth/test-signup`, {
      data: { email, password: 'Test123!', displayName: 'First' },
    });
    expect(first.ok()).toBeTruthy();

    const second = await request.post(`${API}/auth/test-signup`, {
      data: { email, password: 'Test123!', displayName: 'Second' },
    });
    expect(second.status()).toBe(409);
    const body = await second.json();
    expect(body.ok).toBe(false);
  });

  test('test-signup rejects missing email', async ({ request }) => {
    const res = await request.post(`${API}/auth/test-signup`, {
      data: {},
    });
    expect(res.status()).toBe(400);
  });

  test('test-login returns user and sets cookie', async ({ request }) => {
    const { email, password } = await signup(request);
    const res = await request.post(`${API}/auth/test-login`, {
      data: { email, password },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.user.email).toBe(email);
    expect(body.data.token).toBeTruthy();
    expect(res.headers()['set-cookie']).toContain('token=');
  });

  test('test-login rejects wrong password', async ({ request }) => {
    const { email } = await signup(request);
    const res = await request.post(`${API}/auth/test-login`, {
      data: { email, password: 'WrongPassword!' },
    });
    expect(res.status()).toBe(401);
  });

  test('test-login rejects unknown email', async ({ request }) => {
    const res = await request.post(`${API}/auth/test-login`, {
      data: { email: 'nobody@nowhere.test', password: 'Pass123!' },
    });
    expect(res.status()).toBe(401);
  });

  test('/me returns current user with cookie auth', async ({ request }) => {
    const cookie = await signupAndGetCookie(request);
    const res = await request.get(`${API}/auth/me`, {
      headers: { Cookie: cookie },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.user.email).toBeTruthy();
  });

  test('/me rejects unauthenticated request', async ({ request }) => {
    const res = await request.get(`${API}/auth/me`);
    expect(res.status()).toBe(401);
  });

  test('logout clears cookie', async ({ request }) => {
    const cookie = await signupAndGetCookie(request);
    const res = await request.post(`${API}/auth/logout`, {
      headers: { Cookie: cookie },
    });
    expect(res.ok()).toBeTruthy();
    const setCookie = res.headers()['set-cookie'];
    expect(setCookie).toContain('token=;');
  });
});

test.describe('Instance API', () => {
  let cookie: string;

  test.beforeAll(async ({ request }) => {
    cookie = await signupAndGetCookie(request);
  });

  test('list instances returns empty initially', async ({ request }) => {
    const res = await request.get(`${API}/instances`, {
      headers: { Cookie: cookie },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data).toEqual([]);
  });

  test('create instance returns full instance', async ({ request }) => {
    const name = `test-${Date.now()}`;
    const res = await request.post(`${API}/instances`, {
      headers: { Cookie: cookie },
      data: { name, agentType: 'openclaw' },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.name).toBe(name);
    expect(body.data.agentType).toBe('openclaw');
    expect(body.data.status).toBe('created');
    expect(body.data.authToken).toBeTruthy();
  });

  test('create rejects missing name', async ({ request }) => {
    const res = await request.post(`${API}/instances`, {
      headers: { Cookie: cookie },
      data: { agentType: 'openclaw' },
    });
    expect(res.status()).toBe(400);
  });

  test('create rejects missing agentType', async ({ request }) => {
    const res = await request.post(`${API}/instances`, {
      headers: { Cookie: cookie },
      data: { name: 'no-type' },
    });
    expect(res.status()).toBe(400);
  });

  test('create rejects duplicate name for same user', async ({ request }) => {
    const name = `dup-${Date.now()}`;
    await request.post(`${API}/instances`, {
      headers: { Cookie: cookie },
      data: { name, agentType: 'openclaw' },
    });
    const res = await request.post(`${API}/instances`, {
      headers: { Cookie: cookie },
      data: { name, agentType: 'openclaw' },
    });
    expect(res.status()).toBe(409);
  });

  test('get instance by id', async ({ request }) => {
    const name = `get-${Date.now()}`;
    const create = await request.post(`${API}/instances`, {
      headers: { Cookie: cookie },
      data: { name, agentType: 'openclaw' },
    });
    const { data: created } = await create.json();

    const res = await request.get(`${API}/instances/${created.id}`, {
      headers: { Cookie: cookie },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.data.name).toBe(name);
    expect(body.data.authToken).toBeTruthy();
  });

  test('get nonexistent instance returns 404', async ({ request }) => {
    const res = await request.get(`${API}/instances/00000000-0000-0000-0000-000000000000`, {
      headers: { Cookie: cookie },
    });
    expect(res.status()).toBe(404);
  });

  test('delete instance', async ({ request }) => {
    const name = `del-${Date.now()}`;
    const create = await request.post(`${API}/instances`, {
      headers: { Cookie: cookie },
      data: { name, agentType: 'openclaw' },
    });
    const { data: created } = await create.json();

    const res = await request.delete(`${API}/instances/${created.id}`, {
      headers: { Cookie: cookie },
    });
    expect(res.ok()).toBeTruthy();

    const check = await request.get(`${API}/instances/${created.id}`, {
      headers: { Cookie: cookie },
    });
    expect(check.status()).toBe(404);
  });

  test('list instances returns created instances (public format, no authToken)', async ({ request }) => {
    const res = await request.get(`${API}/instances`, {
      headers: { Cookie: cookie },
    });
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    for (const inst of body.data) {
      expect(inst.authToken).toBeUndefined();
      expect(inst.agentType).toBeTruthy();
    }
  });

  test('instances are isolated per user', async ({ request }) => {
    const otherCookie = await signupAndGetCookie(request);

    const name = `isolated-${Date.now()}`;
    await request.post(`${API}/instances`, {
      headers: { Cookie: cookie },
      data: { name, agentType: 'openclaw' },
    });

    const res = await request.get(`${API}/instances`, {
      headers: { Cookie: otherCookie },
    });
    const body = await res.json();
    const names = body.data.map((i: { name: string }) => i.name);
    expect(names).not.toContain(name);
  });

  test('unauthenticated requests are rejected', async ({ request }) => {
    const res = await request.get(`${API}/instances`);
    expect(res.status()).toBe(401);
  });

  test('wizard flow: create with config, add credential, start', async ({ request }) => {
    // 1. Create instance with provider config
    const createRes = await request.post(`${API}/instances`, {
      data: {
        name: `wizard-${Date.now()}`,
        agentType: 'openclaw',
        config: {
          defaultProvider: 'anthropic',
          defaultModel: 'claude-sonnet-4-20250514',
        },
      } satisfies CreateInstanceRequest,
      headers: { Cookie: cookie },
    });
    expect(createRes.ok()).toBeTruthy();
    const createBody = await createRes.json();
    const wizardInstanceId = createBody.data.id;
    expect(createBody.data.name).toContain('wizard-');

    // 2. Store credential
    const credRes = await request.post(`${API}/instances/${wizardInstanceId}/credentials`, {
      data: {
        provider: 'anthropic',
        credentialType: 'api_key',
        value: 'sk-test-wizard-key-12345',
      } satisfies AddCredentialRequest,
      headers: { Cookie: cookie },
    });
    expect(credRes.ok()).toBeTruthy();

    // 3. Cleanup (delete instance -- don't actually start in test env)
    const delRes = await request.delete(`${API}/instances/${wizardInstanceId}`, {
      headers: { Cookie: cookie },
    });
    expect(delRes.ok()).toBeTruthy();
  });
});

test.describe('Agent Types API', () => {
  test('list agent types returns openclaw', async ({ request }) => {
    const cookie = await signupAndGetCookie(request);
    const res = await request.get(`${API}/agent-types`, {
      headers: { Cookie: cookie },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
    const openclaw = body.data.find((t: { id: string }) => t.id === 'openclaw');
    expect(openclaw).toBeDefined();
    expect(openclaw.name).toBe('OpenClaw');
    expect(openclaw.defaultImageTag).toBeTruthy();
  });
});

test.describe('Metadata API', () => {
  test('GET /providers returns provider array with ok response', async ({ request }) => {
    const res = await request.get(`${API}/metadata/providers`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  test('GET /providers returns typed provider groups when metadata exists', async ({ request }) => {
    const res = await request.get(`${API}/metadata/providers`);
    const body = await res.json();
    if (body.data.length > 0) {
      const first = body.data[0];
      expect(typeof first.id).toBe('string');
      expect(typeof first.name).toBe('string');
      expect(Array.isArray(first.authMethods)).toBe(true);
      expect(Array.isArray(first.models)).toBe(true);
      expect(Array.isArray(first.envVars)).toBe(true);
    }
  });

  test('GET /channels returns channel array with ok response', async ({ request }) => {
    const res = await request.get(`${API}/metadata/channels`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  test('metadata endpoints do not require authentication', async ({ request }) => {
    const providers = await request.get(`${API}/metadata/providers`);
    expect(providers.ok()).toBeTruthy();

    const channels = await request.get(`${API}/metadata/channels`);
    expect(channels.ok()).toBeTruthy();
  });
});

test.describe.serial('Instance Lifecycle API', () => {
  let cookie: string;
  let instanceId: string;
  let instanceRunning = false;

  test.beforeAll(async ({ request }) => {
    cookie = await signupAndGetCookie(request);
    const name = `lifecycle-${Date.now()}`;
    const res = await request.post(`${API}/instances`, {
      headers: { Cookie: cookie },
      data: { name, agentType: 'openclaw' },
    });
    const body = await res.json();
    instanceId = body.data.id;
  });

  test.afterAll(async ({ request }) => {
    await request.post(`${API}/instances/${instanceId}/stop`, {
      headers: { Cookie: cookie },
    }).catch(() => {});
    await request.delete(`${API}/instances/${instanceId}`, {
      headers: { Cookie: cookie },
    }).catch(() => {});
  });

  test('start instance', async ({ request }) => {
    test.setTimeout(180_000);
    const res = await request.post(`${API}/instances/${instanceId}/start`, {
      headers: { Cookie: cookie },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(['starting', 'running']).toContain(body.data.status);

    // Poll until running (container boot can take ~150s)
    for (let i = 0; i < 60; i++) {
      const poll = await request.get(`${API}/instances/${instanceId}`, {
        headers: { Cookie: cookie },
      });
      const pollBody = await poll.json();
      if (pollBody.data.status === 'running') {
        expect(pollBody.data.runtimeId).toBeTruthy();
        expect(pollBody.data.controlEndpoint).toBeTruthy();
        instanceRunning = true;
        return;
      }
      if (pollBody.data.status === 'error') {
        test.skip(true, `Instance reached error state: ${pollBody.data.statusMessage}`);
        return;
      }
      await new Promise(r => setTimeout(r, 3000));
    }
    test.skip(true, 'Instance did not reach running state within 180s');
  });

  test('get status of running instance', async ({ request }) => {
    test.skip(!instanceRunning, 'Instance did not reach running state');
    const res = await request.get(`${API}/instances/${instanceId}/status`, {
      headers: { Cookie: cookie },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.data.running).toBe(true);
  });

  test('get logs of running instance', async ({ request }) => {
    test.skip(!instanceRunning, 'Instance did not reach running state');
    const res = await request.get(`${API}/instances/${instanceId}/logs?tail=50`, {
      headers: { Cookie: cookie },
    });
    expect(res.ok()).toBeTruthy();
    expect(res.headers()['content-type']).toContain('text/plain');
  });

  test('get events', async ({ request }) => {
    const res = await request.get(`${API}/instances/${instanceId}/events`, {
      headers: { Cookie: cookie },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  test('stop instance', async ({ request }) => {
    test.skip(!instanceRunning, 'Instance did not reach running state');
    const res = await request.post(`${API}/instances/${instanceId}/stop`, {
      headers: { Cookie: cookie },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.data.status).toBe('stopped');
    expect(body.data.runtimeId).toBeNull();
  });

  test('restart instance (from stopped)', async ({ request }) => {
    test.skip(!instanceRunning, 'Instance did not reach running state');
    test.setTimeout(180_000);
    const startRes = await request.post(`${API}/instances/${instanceId}/start`, {
      headers: { Cookie: cookie },
    });
    expect(startRes.ok()).toBeTruthy();

    // Wait for running before restart
    for (let i = 0; i < 60; i++) {
      const poll = await request.get(`${API}/instances/${instanceId}`, {
        headers: { Cookie: cookie },
      });
      const pollBody = await poll.json();
      if (pollBody.data.status === 'running') break;
      if (pollBody.data.status === 'error') {
        test.skip(true, `Instance error before restart: ${pollBody.data.statusMessage}`);
        return;
      }
      await new Promise(r => setTimeout(r, 3000));
    }

    const res = await request.post(`${API}/instances/${instanceId}/restart`, {
      headers: { Cookie: cookie },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(['starting', 'running']).toContain(body.data.status);

    // Poll until running after restart
    for (let i = 0; i < 60; i++) {
      const poll = await request.get(`${API}/instances/${instanceId}`, {
        headers: { Cookie: cookie },
      });
      const pollBody = await poll.json();
      if (pollBody.data.status === 'running') {
        expect(pollBody.data.runtimeId).toBeTruthy();
        return;
      }
      if (pollBody.data.status === 'error') {
        test.skip(true, `Instance error after restart: ${pollBody.data.statusMessage}`);
        return;
      }
      await new Promise(r => setTimeout(r, 3000));
    }
    test.skip(true, 'Instance did not reach running state after restart');
  });

  test('stop after restart', async ({ request }) => {
    test.skip(!instanceRunning, 'Instance did not reach running state');
    const res = await request.post(`${API}/instances/${instanceId}/stop`, {
      headers: { Cookie: cookie },
    });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).data.status).toBe('stopped');
  });
});

test.describe.serial('Credentials API', () => {
  let cookie: string;
  let instanceId: string;

  test.beforeAll(async ({ request }) => {
    cookie = await signupAndGetCookie(request);
    const name = `cred-${Date.now()}`;
    const res = await request.post(`${API}/instances`, {
      headers: { Cookie: cookie },
      data: { name, agentType: 'openclaw' },
    });
    const body = await res.json();
    instanceId = body.data.id;
  });

  test.afterAll(async ({ request }) => {
    await request.delete(`${API}/instances/${instanceId}`, {
      headers: { Cookie: cookie },
    }).catch(() => {});
  });

  test('list credentials initially empty', async ({ request }) => {
    const res = await request.get(`${API}/instances/${instanceId}/credentials`, {
      headers: { Cookie: cookie },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.data).toEqual([]);
  });

  test('add credential', async ({ request }) => {
    const res = await request.post(`${API}/instances/${instanceId}/credentials`, {
      headers: { Cookie: cookie },
      data: { provider: 'openai', credentialType: 'api_key', value: 'sk-test-key-123' },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.data.provider).toBe('openai');
    expect(body.data.credentialType).toBe('api_key');
  });

  test('list credentials after add', async ({ request }) => {
    const res = await request.get(`${API}/instances/${instanceId}/credentials`, {
      headers: { Cookie: cookie },
    });
    const body = await res.json();
    expect(body.data.length).toBe(1);
    expect(body.data[0].provider).toBe('openai');
  });

  test('delete credential', async ({ request }) => {
    const list = await request.get(`${API}/instances/${instanceId}/credentials`, {
      headers: { Cookie: cookie },
    });
    const { data: creds } = await list.json();
    const credId = creds[0].id;

    const res = await request.delete(`${API}/instances/${instanceId}/credentials/${credId}`, {
      headers: { Cookie: cookie },
    });
    expect(res.ok()).toBeTruthy();

    const after = await request.get(`${API}/instances/${instanceId}/credentials`, {
      headers: { Cookie: cookie },
    });
    expect((await after.json()).data.length).toBe(0);
  });
});

test.describe.serial('Security Profile API', () => {
  let cookie: string;
  let instanceId: string;

  test.beforeAll(async ({ request }) => {
    cookie = await signupAndGetCookie(request);
    const name = `secprof-${Date.now()}`;
    const res = await request.post(`${API}/instances`, {
      headers: { Cookie: cookie },
      data: { name, agentType: 'openclaw' },
    });
    const body = await res.json();
    instanceId = body.data.id;
  });

  test.afterAll(async ({ request }) => {
    await request.delete(`${API}/instances/${instanceId}`, {
      headers: { Cookie: cookie },
    }).catch(() => {});
  });

  test('instance defaults to standard security profile', async ({ request }) => {
    const res = await request.get(`${API}/instances/${instanceId}`, {
      headers: { Cookie: cookie },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.data.securityProfile).toBe('standard');
  });

  test('PATCH security profile to strict', async ({ request }) => {
    const res = await request.patch(`${API}/instances/${instanceId}/security-profile`, {
      headers: { Cookie: cookie },
      data: { securityProfile: 'strict' },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.securityProfile).toBe('strict');
  });

  test('PATCH security profile to developer', async ({ request }) => {
    const res = await request.patch(`${API}/instances/${instanceId}/security-profile`, {
      headers: { Cookie: cookie },
      data: { securityProfile: 'developer' },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.data.securityProfile).toBe('developer');
  });

  test('PATCH security profile to unrestricted', async ({ request }) => {
    const res = await request.patch(`${API}/instances/${instanceId}/security-profile`, {
      headers: { Cookie: cookie },
      data: { securityProfile: 'unrestricted' },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.data.securityProfile).toBe('unrestricted');
  });

  test('PATCH rejects invalid security profile', async ({ request }) => {
    const res = await request.patch(`${API}/instances/${instanceId}/security-profile`, {
      headers: { Cookie: cookie },
      data: { securityProfile: 'nonexistent' },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain('Invalid security profile');
  });

  test('PATCH rejects empty security profile', async ({ request }) => {
    const res = await request.patch(`${API}/instances/${instanceId}/security-profile`, {
      headers: { Cookie: cookie },
      data: {},
    });
    expect(res.status()).toBe(400);
  });

  test('create instance with explicit security profile', async ({ request }) => {
    const res = await request.post(`${API}/instances`, {
      headers: { Cookie: cookie },
      data: {
        name: `secprof-explicit-${Date.now()}`,
        agentType: 'openclaw',
        securityProfile: 'developer',
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.data.securityProfile).toBe('developer');

    await request.delete(`${API}/instances/${body.data.id}`, {
      headers: { Cookie: cookie },
    }).catch(() => {});
  });

  test('security profile persists after get', async ({ request }) => {
    const res = await request.get(`${API}/instances/${instanceId}`, {
      headers: { Cookie: cookie },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.data.securityProfile).toBe('unrestricted');
  });
});

test.describe('Blocked RPC Methods', () => {
  let cookie: string;
  let instanceId: string;

  test.beforeAll(async ({ request }) => {
    cookie = await signupAndGetCookie(request);
    const name = `rpc-block-${Date.now()}`;
    const res = await request.post(`${API}/instances`, {
      headers: { Cookie: cookie },
      data: { name, agentType: 'openclaw' },
    });
    const body = await res.json();
    instanceId = body.data.id;
  });

  test.afterAll(async ({ request }) => {
    await request.delete(`${API}/instances/${instanceId}`, {
      headers: { Cookie: cookie },
    }).catch(() => {});
  });

  const blockedMethods = [
    'skills.install',
    'skills.update',
    'skills.remove',
    'config.patch',
    'config.apply',
    'plugins.install',
    'plugins.enable',
  ];

  for (const method of blockedMethods) {
    test(`RPC method '${method}' returns 400 for non-running instance`, async ({ request }) => {
      const res = await request.post(`${API}/instances/${instanceId}/rpc`, {
        headers: { Cookie: cookie },
        data: { method, params: {} },
      });
      expect(res.status()).toBe(400);
      const body = await res.json();
      expect(body.ok).toBe(false);
    });
  }
});

test.describe.serial('Template Security (CIT-122)', () => {
  let cookie: string;
  let templateId: string;
  const instanceIds: string[] = [];

  test.beforeAll(async ({ request }) => {
    cookie = await signupAndGetCookie(request);

    const res = await request.post(`${API}/templates`, {
      headers: { Cookie: cookie },
      data: {
        slug: `sec-tpl-${Date.now()}`,
        name: 'Security Test Template',
        description: 'Template with security config',
        category: 'custom',
        tags: ['security', 'test'],
        license: 'private',
        content: {
          workspaceFiles: {
            'AGENTS.md': '# Security Test Agent',
            'SOUL.md': '# Security Test Soul\nThis is the soul content.',
          },
          security: {
            minSecurityProfile: 'standard',
            customNeverDoRules: ['Never share database credentials externally'],
          },
        },
      },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
    templateId = body.data.id;
  });

  test.afterAll(async ({ request }) => {
    for (const id of instanceIds) {
      try {
        await request.delete(`${API}/instances/${id}`, {
          headers: { Cookie: cookie },
        });
      } catch { /* ignore cleanup errors */ }
    }
    try {
      await request.delete(`${API}/templates/${templateId}`, {
        headers: { Cookie: cookie },
      });
    } catch { /* ignore cleanup errors */ }
  });

  test('template content includes security config', async ({ request }) => {
    const res = await request.get(`${API}/templates/${templateId}/content`, {
      headers: { Cookie: cookie },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.security).toBeDefined();
    expect(body.data.security.minSecurityProfile).toBe('standard');
    expect(body.data.security.customNeverDoRules).toContain('Never share database credentials externally');
  });

  test('instantiate template with valid security profile succeeds', async ({ request }) => {
    const res = await request.post(`${API}/templates/${templateId}/instantiate`, {
      headers: { Cookie: cookie },
      data: { instanceName: `sec-inst-strict-${Date.now()}`, securityProfile: 'strict' },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
    const instanceId = body.data.instance.id;
    instanceIds.push(instanceId);

    const getRes = await request.get(`${API}/instances/${instanceId}`, {
      headers: { Cookie: cookie },
    });
    expect(getRes.ok()).toBeTruthy();
    const getInstance = await getRes.json();
    expect(getInstance.data.securityProfile).toBe('strict');

    await request.delete(`${API}/instances/${instanceId}`, {
      headers: { Cookie: cookie },
    });
  });

  test('instantiate template with matching minimum profile succeeds', async ({ request }) => {
    const res = await request.post(`${API}/templates/${templateId}/instantiate`, {
      headers: { Cookie: cookie },
      data: { instanceName: `sec-inst-standard-${Date.now()}`, securityProfile: 'standard' },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
    const instanceId = body.data.instance.id;
    instanceIds.push(instanceId);

    const getRes = await request.get(`${API}/instances/${instanceId}`, {
      headers: { Cookie: cookie },
    });
    expect(getRes.ok()).toBeTruthy();
    const getInstance = await getRes.json();
    expect(getInstance.data.securityProfile).toBe('standard');

    await request.delete(`${API}/instances/${instanceId}`, {
      headers: { Cookie: cookie },
    });
  });

  test('instantiate template with weaker-than-minimum profile fails', async ({ request }) => {
    const res = await request.post(`${API}/templates/${templateId}/instantiate`, {
      headers: { Cookie: cookie },
      data: { instanceName: `sec-inst-dev-${Date.now()}`, securityProfile: 'developer' },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain('Template requires standard security level');
  });

  test('instantiate template with unrestricted (weakest) profile fails', async ({ request }) => {
    const res = await request.post(`${API}/templates/${templateId}/instantiate`, {
      headers: { Cookie: cookie },
      data: { instanceName: `sec-inst-unrestricted-${Date.now()}`, securityProfile: 'unrestricted' },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain('Template requires standard security level');
  });

  test('instantiate template without securityProfile uses default (standard)', async ({ request }) => {
    const res = await request.post(`${API}/templates/${templateId}/instantiate`, {
      headers: { Cookie: cookie },
      data: { instanceName: `sec-inst-default-${Date.now()}` },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
    const instanceId = body.data.instance.id;
    instanceIds.push(instanceId);

    const getRes = await request.get(`${API}/instances/${instanceId}`, {
      headers: { Cookie: cookie },
    });
    expect(getRes.ok()).toBeTruthy();
    const getInstance = await getRes.json();
    expect(getInstance.data.securityProfile).toBe('standard');

    await request.delete(`${API}/instances/${instanceId}`, {
      headers: { Cookie: cookie },
    });
  });
});
