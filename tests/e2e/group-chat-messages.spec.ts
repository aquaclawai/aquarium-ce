import { test, expect } from '@playwright/test';
import WebSocket from 'ws';
import { API, signup, signupAndGetCookie } from './helpers';

test.describe.serial('Group Chat Messages', () => {
  let cookie: string;
  let token: string;
  let instanceId: string;
  let groupChatId: string;

  test('setup: signup and create instance', async ({ request }) => {
    const { res, email, password } = await signup(request);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    token = body.data.token;

    const setCookie = res.headers()['set-cookie'];
    const match = setCookie.match(/token=([^;]+)/);
    cookie = `token=${match![1]}`;

    const createRes = await request.post(`${API}/instances`, {
      headers: { Cookie: cookie },
      data: { name: `gc-test-${Date.now()}`, agentType: 'openclaw' },
    });
    expect(createRes.ok()).toBeTruthy();
    const createBody = await createRes.json();
    instanceId = createBody.data.id;
  });

  test('setup: create group chat with bot member', async ({ request }) => {
    const res = await request.post(`${API}/group-chats`, {
      headers: { Cookie: cookie },
      data: {
        name: 'Test Group',
        instanceIds: [instanceId],
        displayNames: { [instanceId]: 'TestBot' },
        defaultMentionMode: 'broadcast',
      },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    groupChatId = body.data.id;
    expect(groupChatId).toBeTruthy();
  });

  test('sent message appears via GET', async ({ request }) => {
    const sendRes = await request.post(`${API}/group-chats/${groupChatId}/messages`, {
      headers: { Cookie: cookie },
      data: { content: 'hello from e2e test' },
    });
    expect(sendRes.ok()).toBeTruthy();
    const sendBody = await sendRes.json();
    const messageId = sendBody.data.messageId;
    expect(messageId).toBeTruthy();

    const getRes = await request.get(`${API}/group-chats/${groupChatId}/messages?limit=10`, {
      headers: { Cookie: cookie },
    });
    expect(getRes.ok()).toBeTruthy();
    const getBody = await getRes.json();
    const messages = getBody.data.messages;
    expect(messages.length).toBeGreaterThanOrEqual(1);

    const found = messages.find((m: { id: string }) => m.id === messageId);
    expect(found).toBeTruthy();
    expect(found.content).toBe('hello from e2e test');
    expect(found.senderType).toBe('user');
  });

  test('sent message arrives via WebSocket', async () => {
    test.setTimeout(15_000);

    const wsUrl = API.replace(/^http/, 'ws').replace(/\/api$/, '/ws');
    const ws = new WebSocket(wsUrl);

    const receivedMessages: Array<Record<string, unknown>> = [];

    const wsReady = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('WS auth timeout')), 10_000);

      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'auth', token }));
      });

      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());

        if (msg.type === 'auth' && msg.ok) {
          ws.send(JSON.stringify({ type: 'subscribe_group_chat', groupChatId }));
          clearTimeout(timeout);
          resolve();
          return;
        }
        if (msg.type === 'auth' && !msg.ok) {
          clearTimeout(timeout);
          reject(new Error('WS auth failed'));
          return;
        }

        if (msg.type === 'group_chat:message' && msg.groupChatId === groupChatId) {
          receivedMessages.push(msg);
        }
      });

      ws.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    await wsReady;

    // Wait a tick for subscription to be processed
    await new Promise(r => setTimeout(r, 200));

    // Send message via HTTP
    const sendRes = await fetch(`${API}/group-chats/${groupChatId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ content: 'ws test message' }),
    });
    const sendBody = await sendRes.json() as { ok: boolean; data: { messageId: string } };
    expect(sendBody.ok).toBe(true);

    // Wait for WS message to arrive
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('WS message not received within 5s')), 5_000);

      const check = () => {
        if (receivedMessages.some(m => (m.payload as Record<string, unknown>)?.messageId === sendBody.data.messageId)) {
          clearTimeout(timeout);
          resolve();
        } else {
          setTimeout(check, 100);
        }
      };
      check();
    });

    const wsMsg = receivedMessages.find(m => (m.payload as Record<string, unknown>)?.messageId === sendBody.data.messageId);
    expect(wsMsg).toBeTruthy();
    const payload = wsMsg!.payload as Record<string, unknown>;
    expect(payload.content).toBe('ws test message');
    expect(payload.senderType).toBe('user');

    ws.close();
  });

  test('cleanup: delete instance', async ({ request }) => {
    if (instanceId) {
      await request.delete(`${API}/instances/${instanceId}`, {
        headers: { Cookie: cookie },
      });
    }
  });
});
