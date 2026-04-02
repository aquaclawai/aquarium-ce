import { test, expect, type APIRequestContext } from '@playwright/test';

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

/**
 * Channel test data aligned with CHANNEL_REQUIRED_FIELDS in
 * apps/server/src/routes/channels.ts.
 *
 * Field names here must match the `fields` array for each channel
 * in the server route (not arbitrary credential names).
 */
const CHANNEL_TEST_DATA = [
  { channel: 'discord', body: { token: 'test-discord-token-123' } },
  { channel: 'slack', body: { appToken: 'xoxp-test-slack-app', botToken: 'xoxb-test-slack-bot' } },
  { channel: 'signal', body: { account: '+15551234567' } },
  { channel: 'googlechat', body: { serviceAccountJson: '{"type":"service_account","project_id":"test"}' } },
  { channel: 'imessage', body: { cliPath: '/usr/local/bin/imessage', dbPath: '/var/db/imessage.db' } },
  { channel: 'nostr', body: { privateKey: 'nsec1testkey123' } },
  { channel: 'irc', body: { host: 'irc.libera.chat', nick: 'testbot' } },
  { channel: 'msteams', body: { appId: 'test-app-id-123', appPassword: 'test-app-password', tenantId: 'test-tenant-id' } },
  { channel: 'matrix', body: { homeserver: 'https://matrix.org', accessToken: 'test-matrix-token' } },
  { channel: 'zalo', body: { botToken: 'test-zalo-bot-token' } },
  { channel: 'line', body: { channelAccessToken: 'test-line-token', channelSecret: 'test-line-secret' } },
  { channel: 'bluebubbles', body: { serverUrl: 'http://localhost:1234', password: 'test-bb-password' } },
];

test.describe.serial('Channel Configuration API', () => {
  let cookie: string;
  let instanceId: string;

  test.beforeAll(async ({ request }) => {
    cookie = await signupAndGetCookie(request);

    const createRes = await request.post(`${API}/instances`, {
      headers: { Cookie: cookie },
      data: { name: `chan-${Date.now()}`, agentType: 'openclaw' },
    });
    expect(createRes.ok()).toBeTruthy();
    const createBody = await createRes.json();
    expect(createBody.ok).toBe(true);
    instanceId = createBody.data.id;
  });

  for (const { channel, body } of CHANNEL_TEST_DATA) {
    test(`configure ${channel} channel`, async ({ request }) => {
      const res = await request.post(`${API}/instances/${instanceId}/channels/${channel}/configure`, {
        headers: { Cookie: cookie },
        data: body,
      });
      expect(res.ok()).toBeTruthy();
      const json = await res.json();
      expect(json.ok).toBe(true);
    });

    test(`disconnect ${channel} channel`, async ({ request }) => {
      const res = await request.post(`${API}/instances/${instanceId}/channels/${channel}/disconnect`, {
        headers: { Cookie: cookie },
      });
      expect(res.ok()).toBeTruthy();
      const json = await res.json();
      expect(json.ok).toBe(true);
    });
  }

  test.afterAll(async ({ request }) => {
    await request.delete(`${API}/instances/${instanceId}`, {
      headers: { Cookie: cookie },
    }).catch(() => {});
  });
});

test.describe('Channel API Error Cases', () => {
  let cookie: string;
  let instanceId: string;

  test.beforeAll(async ({ request }) => {
    cookie = await signupAndGetCookie(request);
    const createRes = await request.post(`${API}/instances`, {
      headers: { Cookie: cookie },
      data: { name: `chan-err-${Date.now()}`, agentType: 'openclaw' },
    });
    expect(createRes.ok()).toBeTruthy();
    const createBody = await createRes.json();
    instanceId = createBody.data.id;
  });

  test('configure unknown channel returns 400', async ({ request }) => {
    const res = await request.post(`${API}/instances/${instanceId}/channels/nonexistent/configure`, {
      headers: { Cookie: cookie },
      data: { token: 'test' },
    });
    expect(res.status()).toBe(400);
    const json = await res.json();
    expect(json.ok).toBe(false);
  });

  test('configure without auth returns 401', async ({ request }) => {
    const res = await request.post(`${API}/instances/${instanceId}/channels/discord/configure`, {
      data: { token: 'test-token' },
    });
    expect(res.status()).toBe(401);
  });

  test.afterAll(async ({ request }) => {
    await request.delete(`${API}/instances/${instanceId}`, {
      headers: { Cookie: cookie },
    }).catch(() => {});
  });
});
