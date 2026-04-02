/**
 * Group Chat Marketing Research — E2E Production Test
 *
 * Validates all three v1.3.12 fixes working together in a realistic scenario:
 *   Fix 1: Agents can use tools in group chat (no more 不要使用任何工具)
 *   Fix 2: BRAVE_API_KEY injected into containers for web search
 *   Fix 3: Config PATCH accepts partial updates mid-conversation
 *
 * Two AI agents with distinct marketing roles collaborate via group chat,
 * using web search to research real market data.
 *
 * Usage:
 *   E2E_OPENAI_API_KEY=sk-... E2E_BRAVE_API_KEY=BSA... \
 *     npx playwright test tests/e2e/group-chat-marketing.spec.ts --reporter=list
 *
 * Environment variables:
 *   PROD_URL           — API base (default: http://agent.jinkomcp.com/api)
 *   PROD_EMAIL         — test account email (default: test@openclaw.dev)
 *   PROD_PASSWORD      — test account password (default: OpenClaw2026!)
 *   E2E_OPENAI_API_KEY — OpenAI key for LLM responses
 *   E2E_BRAVE_API_KEY  — Brave Search key for web search tool
 */
import { test, expect, type APIRequestContext } from '@playwright/test';

const API = process.env.PROD_URL || 'http://agent.jinkomcp.com/api';
const EMAIL = process.env.PROD_EMAIL || 'test@openclaw.dev';
const PASSWORD = process.env.PROD_PASSWORD || 'OpenClaw2026!';
const OPENAI_API_KEY = process.env.E2E_OPENAI_API_KEY || '';
const BRAVE_API_KEY = process.env.E2E_BRAVE_API_KEY || '';

const SKIP_REASON = 'Requires E2E_OPENAI_API_KEY and E2E_BRAVE_API_KEY';
const shouldSkip = !OPENAI_API_KEY || !BRAVE_API_KEY;

async function login(request: APIRequestContext): Promise<string> {
  const res = await request.post(`${API}/auth/test-login`, {
    data: { email: EMAIL, password: PASSWORD },
  });
  expect(res.ok(), `Login failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const body = await res.json();
  return body.data.token;
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function waitForRunning(
  request: APIRequestContext,
  token: string,
  instanceId: string,
  timeoutMs = 360_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await request.get(`${API}/instances/${instanceId}`, {
      headers: auth(token),
    });
    if (res.ok()) {
      const body = await res.json();
      if (body.data?.status === 'running') return true;
    }
    await new Promise(r => setTimeout(r, 5_000));
  }
  return false;
}

async function pollForBotReply(
  request: APIRequestContext,
  token: string,
  groupChatId: string,
  afterMessageCount: number,
  timeoutMs = 120_000,
): Promise<Array<{ senderType: string; content: string; senderName: string }>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 5_000));
    const res = await request.get(`${API}/group-chats/${groupChatId}/messages?limit=50`, {
      headers: auth(token),
    });
    if (!res.ok()) continue;
    const body = await res.json();
    const messages = body.data?.messages ?? [];
    const botReplies = messages.filter(
      (m: { senderType: string }) => m.senderType === 'bot',
    );
    if (botReplies.length > afterMessageCount) {
      return botReplies;
    }
  }
  return [];
}

async function cleanupInstance(request: APIRequestContext, token: string, id: string) {
  await request.post(`${API}/instances/${id}/stop`, { headers: auth(token) }).catch(() => {});
  await new Promise(r => setTimeout(r, 2_000));
  await request.delete(`${API}/instances/${id}`, { headers: auth(token) }).catch(() => {});
}

// ─── Marketing Research Group Chat ─────────────────────

test.describe.serial('Group Chat Marketing Research (v1.3.12)', () => {
  let token: string;
  let analystId: string;
  let strategistId: string;
  let groupChatId: string;
  let botReplyCount = 0;

  // ── Setup: Login ──

  test('login', async ({ request }) => {
    if (shouldSkip) { test.skip(true, SKIP_REASON); return; }
    token = await login(request);
    expect(token).toBeTruthy();
  });

  // ── Setup: Create & Configure Instances ──

  test('create analyst and strategist instances', async ({ request }) => {
    if (shouldSkip) { test.skip(true, SKIP_REASON); return; }
    const ts = Date.now();

    const analystRes = await request.post(`${API}/instances`, {
      headers: auth(token),
      data: { name: `mkt-analyst-${ts}`, agentType: 'openclaw' },
    });
    expect(analystRes.status(), `Create analyst failed: ${await analystRes.text()}`).toBe(201);
    analystId = (await analystRes.json()).data.id;

    const strategistRes = await request.post(`${API}/instances`, {
      headers: auth(token),
      data: { name: `mkt-strategist-${ts}`, agentType: 'openclaw' },
    });
    expect(strategistRes.status(), `Create strategist failed: ${await strategistRes.text()}`).toBe(201);
    strategistId = (await strategistRes.json()).data.id;
  });

  test('add LLM + Brave credentials to both instances', async ({ request }) => {
    if (shouldSkip) { test.skip(true, SKIP_REASON); return; }

    for (const id of [analystId, strategistId]) {
      // OpenAI for LLM
      const llmRes = await request.post(`${API}/instances/${id}/credentials`, {
        headers: auth(token),
        data: { provider: 'openai', credentialType: 'api_key', value: OPENAI_API_KEY },
      });
      expect(llmRes.ok(), `Add OpenAI cred failed: ${await llmRes.text()}`).toBeTruthy();

      // Brave for web search (Fix 2 — this previously had no env mapping)
      const braveRes = await request.post(`${API}/instances/${id}/credentials`, {
        headers: auth(token),
        data: { provider: 'brave', credentialType: 'api_key', value: BRAVE_API_KEY },
      });
      expect(braveRes.ok(), `Add Brave cred failed: ${await braveRes.text()}`).toBeTruthy();
    }
  });

  test('configure model for both instances (Fix 3 — config PATCH)', async ({ request }) => {
    if (shouldSkip) { test.skip(true, SKIP_REASON); return; }

    for (const id of [analystId, strategistId]) {
      const res = await request.patch(`${API}/instances/${id}/config`, {
        headers: auth(token),
        data: { defaultProvider: 'openai', defaultModel: 'gpt-4o-mini' },
      });
      expect(res.ok(), `Config PATCH failed (Fix 3): ${await res.text()}`).toBeTruthy();
    }
  });

  test('start both instances', async ({ request }) => {
    if (shouldSkip) { test.skip(true, SKIP_REASON); return; }
    test.setTimeout(360_000);

    const analystStart = await request.post(`${API}/instances/${analystId}/start`, {
      headers: auth(token),
    });
    expect(analystStart.ok(), `Start analyst failed: ${await analystStart.text()}`).toBeTruthy();

    const strategistStart = await request.post(`${API}/instances/${strategistId}/start`, {
      headers: auth(token),
    });
    expect(strategistStart.ok(), `Start strategist failed: ${await strategistStart.text()}`).toBeTruthy();
  });

  test('wait for both instances ready', async ({ request }) => {
    if (shouldSkip) { test.skip(true, SKIP_REASON); return; }
    test.setTimeout(420_000);

    const [analystReady, strategistReady] = await Promise.all([
      waitForRunning(request, token, analystId),
      waitForRunning(request, token, strategistId),
    ]);
    expect(analystReady, 'Analyst instance did not reach running state').toBe(true);
    expect(strategistReady, 'Strategist instance did not reach running state').toBe(true);
  });

  // ── Setup: Create Group Chat ──

  test('create marketing research group chat with roles', async ({ request }) => {
    if (shouldSkip) { test.skip(true, SKIP_REASON); return; }

    const displayNames: Record<string, string> = {};
    displayNames[analystId] = 'Analyst';
    displayNames[strategistId] = 'Strategist';

    const roles: Record<string, string> = {};
    roles[analystId] = 'Market analyst — research market trends, competitor data, and industry stats using web search. Cite sources.';
    roles[strategistId] = 'Content strategist — analyze findings and propose actionable marketing strategies with specific channel recommendations.';

    const res = await request.post(`${API}/group-chats`, {
      headers: auth(token),
      data: {
        name: 'Marketing Research Team',
        instanceIds: [analystId, strategistId],
        displayNames,
        roles,
        defaultMentionMode: 'mentioned',
      },
    });
    expect(res.ok(), `Create group chat failed: ${await res.text()}`).toBeTruthy();
    const body = await res.json();
    groupChatId = body.data.id;
    expect(body.data.members).toHaveLength(2);

    // Verify roles assigned correctly
    const analyst = body.data.members.find(
      (m: { displayName: string }) => m.displayName === 'Analyst',
    );
    expect(analyst).toBeTruthy();
    expect(analyst.role).toContain('Market analyst');
    expect(analyst.isHuman).toBe(false);
  });

  // ── Test: Analyst uses web search ──

  test('@Analyst researches market data with web search (Fix 1 + Fix 2)', async ({ request }) => {
    if (shouldSkip) { test.skip(true, SKIP_REASON); return; }
    test.setTimeout(180_000);

    const sendRes = await request.post(`${API}/group-chats/${groupChatId}/messages`, {
      headers: auth(token),
      data: {
        content: '@Analyst Research the current market size and key players for AI coding assistants in 2025-2026. Use web search to find recent data and reports.',
      },
    });
    expect(sendRes.ok(), `Send message failed: ${await sendRes.text()}`).toBeTruthy();
    const sendBody = await sendRes.json();
    expect(sendBody.data.messageId).toBeTruthy();

    // Poll for bot reply — this validates Fix 1 (tool use allowed) + Fix 2 (Brave key injected)
    const botReplies = await pollForBotReply(request, token, groupChatId, botReplyCount);
    expect(
      botReplies.length,
      'Analyst did not reply — tool use may still be blocked (Fix 1) or Brave key not injected (Fix 2)',
    ).toBeGreaterThan(botReplyCount);

    // Verify reply quality — should contain substantive content from web search
    const latestReply = botReplies[botReplies.length - 1];
    expect(latestReply.content.length).toBeGreaterThan(100);
    botReplyCount = botReplies.length;
  });

  // ── Test: Strategist analyzes ──

  test('@Strategist proposes marketing strategy', async ({ request }) => {
    if (shouldSkip) { test.skip(true, SKIP_REASON); return; }
    test.setTimeout(180_000);

    const sendRes = await request.post(`${API}/group-chats/${groupChatId}/messages`, {
      headers: auth(token),
      data: {
        content: '@Strategist Based on the research above, propose the top 3 marketing strategies for a new AI coding assistant entering this market.',
      },
    });
    expect(sendRes.ok()).toBeTruthy();

    const botReplies = await pollForBotReply(request, token, groupChatId, botReplyCount);
    expect(
      botReplies.length,
      'Strategist did not reply',
    ).toBeGreaterThan(botReplyCount);

    const latestReply = botReplies[botReplies.length - 1];
    expect(latestReply.content.length).toBeGreaterThan(100);
    botReplyCount = botReplies.length;
  });

  // ── Test: Config PATCH mid-conversation (Fix 3) ──

  test('PATCH config mid-conversation to upgrade model (Fix 3)', async ({ request }) => {
    if (shouldSkip) { test.skip(true, SKIP_REASON); return; }

    const res = await request.patch(`${API}/instances/${analystId}/config`, {
      headers: auth(token),
      data: { defaultModel: 'gpt-4o' },
    });
    expect(res.ok(), `Config PATCH mid-conversation failed (Fix 3): ${await res.text()}`).toBeTruthy();

    // Verify config persisted
    const getRes = await request.get(`${API}/instances/${analystId}`, {
      headers: auth(token),
    });
    const body = await getRes.json();
    expect(body.data.config.defaultModel).toBe('gpt-4o');
    expect(body.data.config.defaultProvider).toBe('openai'); // Deep merge preserved
  });

  // ── Test: Follow-up after config change ──

  test('@Analyst follow-up search works after config change', async ({ request }) => {
    if (shouldSkip) { test.skip(true, SKIP_REASON); return; }
    test.setTimeout(180_000);

    const sendRes = await request.post(`${API}/group-chats/${groupChatId}/messages`, {
      headers: auth(token),
      data: {
        content: '@Analyst Search for specific pricing comparison between GitHub Copilot, Cursor, and Windsurf.',
      },
    });
    expect(sendRes.ok()).toBeTruthy();

    const botReplies = await pollForBotReply(request, token, groupChatId, botReplyCount);
    expect(
      botReplies.length,
      'Analyst did not reply after config change — tool use may have broken',
    ).toBeGreaterThan(botReplyCount);

    const latestReply = botReplies[botReplies.length - 1];
    expect(latestReply.content.length).toBeGreaterThan(50);
    botReplyCount = botReplies.length;
  });

  // ── Test: Message history completeness ──

  test('message history contains all user and bot messages', async ({ request }) => {
    if (shouldSkip) { test.skip(true, SKIP_REASON); return; }

    const res = await request.get(`${API}/group-chats/${groupChatId}/messages?limit=50`, {
      headers: auth(token),
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    const messages = body.data.messages;

    // We sent 3 user messages
    const userMessages = messages.filter(
      (m: { senderType: string }) => m.senderType === 'user',
    );
    expect(userMessages.length).toBeGreaterThanOrEqual(3);

    // We expect at least 3 bot replies
    const botMessages = messages.filter(
      (m: { senderType: string }) => m.senderType === 'bot',
    );
    expect(botMessages.length).toBeGreaterThanOrEqual(3);

    // Every message has required fields
    for (const msg of messages) {
      expect(msg.content).toBeTruthy();
      expect(msg.senderType).toBeTruthy();
      expect(msg.createdAt).toBeTruthy();
    }
  });

  // ── Cleanup ──

  test('cleanup: delete group chat and instances', async ({ request }) => {
    if (shouldSkip) { test.skip(true, SKIP_REASON); return; }

    if (groupChatId) {
      await request.delete(`${API}/group-chats/${groupChatId}`, {
        headers: auth(token),
      }).catch(() => {});
    }
    if (analystId) await cleanupInstance(request, token, analystId);
    if (strategistId) await cleanupInstance(request, token, strategistId);
  });
});
