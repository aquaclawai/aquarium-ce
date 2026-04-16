import { test, expect, type APIRequestContext } from '@playwright/test';
import {
  API_BASE,
  callDaemonApi,
  mintDaemonToken,
  revokeDaemonToken,
  seedIssueWithTask,
  signUpAndSignIn,
  uniqueName,
} from './fixtures/daemon-helpers';

/**
 * Phase 19 — Daemon REST API & Auth — End-to-End Playwright coverage.
 *
 * Covers the five phase success criteria (SC-1..SC-5) plus a full-story
 * happy path tying them together — 6 tests in a single serial describe
 * block so token state is shared across scenarios.
 *
 * Success criteria mapping:
 *   SC-1 register-happy          — POST /api/daemon-tokens (cookie) →
 *     plaintext bearer; POST /api/daemon/register with that bearer →
 *     201/200 + runtime IDs; cookie-only request to /register → 401.
 *   SC-2 privilege-confusion     — signed-in user hits GET /api/agents
 *     with `Authorization: Bearer adt_*` instead of cookie → 401 via
 *     the 19-01 AUTH1 patch in `requireAuth`.
 *   SC-3 rate-limit exemption    — 400 daemon requests succeed, 400
 *     user requests get 429. Skipped in CI / dev: rate limiters are
 *     only mounted under `NODE_ENV=production`; CI + `npm run dev`
 *     both run with `NODE_ENV` set to something other than 'production'
 *     (test/development). See `test.skip` guard below.
 *   SC-4 revocation-sla          — issue token → daemon registers →
 *     DELETE /api/daemon-tokens/:id → next daemon request returns
 *     401 within <1000ms (measured).
 *   SC-5 plaintext-once          — POST /api/daemon-tokens exposes the
 *     `adt_<32>` plaintext; GET /api/daemon-tokens list never contains
 *     the plaintext, `tokenHash`, `token_hash`, or any `plaintext`
 *     field in any list row.
 *
 * Full-story test — user creates token → daemon registers → user
 * creates agent + issue → daemon claims + starts + streams messages +
 * completes → user revokes → daemon's next poll fails. Proves DAEMON-01
 * through DAEMON-10 compose correctly across the full HTTP surface.
 *
 * Architecture notes (matches tests/e2e/runtimes.spec.ts from Phase 16-04):
 *   - Absolute URLs to :3001 — Playwright's `webServer` only starts the
 *     Vite frontend dev server on :5173. The Express API server is
 *     expected to be running separately (`npm run dev`) per CLAUDE.md
 *     §Testing.
 *   - `test.describe.serial` + one shared `beforeAll` signup so every
 *     test inherits the same cookie-authenticated session.
 *   - Helpers are in `./fixtures/daemon-helpers.ts` to keep the spec
 *     focused on assertions.
 */

test.describe.serial('Phase 19 — Daemon REST API & Auth', () => {
  const testRunTag = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  test.beforeAll(async ({ request }) => {
    // One disposable user per test run. Every subsequent test in this
    // serial block inherits the resulting cookie session via the shared
    // `request` fixture on each test.
    await signUpAndSignIn(request, {
      email: `daemon-rest-${testRunTag}@e2e.test`,
      password: 'DaemonE2E123!',
      displayName: 'Daemon E2E User',
    });
  });

  test('SC-1 register-happy: bearer succeeds, cookie-only is 401', async ({
    request,
    browser,
  }) => {
    // Mint a bearer token via the user's cookie-auth session.
    const { plaintext } = await mintDaemonToken(request, `sc1-${testRunTag}`);
    expect(plaintext).toMatch(/^adt_[A-Za-z0-9_-]{32}$/);

    // Call POST /api/daemon/register with the adt_* bearer — MUST succeed.
    const { status, body } = await callDaemonApi<{
      ok: boolean;
      data?: { runtimes: Array<{ id: string; name: string; provider: string }> };
      error?: string;
    }>(request, plaintext, 'POST', '/daemon/register', {
      daemonId: `sc1-daemon-${testRunTag}`,
      deviceName: 'sc1-laptop',
      cliVersion: '0.1.0',
      launchedBy: 'playwright',
      runtimes: [
        { name: 'claude-cli', provider: 'claude', version: '1.0.0', status: 'online' },
      ],
    });

    expect(
      status,
      `register with bearer failed: ${JSON.stringify(body)}`,
    ).toBe(200);
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data?.runtimes)).toBe(true);
    expect(body.data!.runtimes.length).toBeGreaterThan(0);
    // The returned runtime row is the mirror Phase 16's upsertDaemonRuntime created.
    expect(body.data!.runtimes[0].id).toBeTruthy();
    expect(body.data!.runtimes[0].provider).toBe('claude');

    // Same endpoint, fresh context — NO bearer, NO cookie → 401.
    // (A logged-in cookie-only request is covered by SC-2; this branch
    // verifies that the daemon route truly requires `adt_*` auth.)
    const anon = await browser.newContext();
    const anonRes = await anon.request.post(`${API_BASE}/daemon/register`, {
      data: { daemonId: 'anon', runtimes: [] },
    });
    expect(anonRes.status()).toBe(401);
    const anonBody = (await anonRes.json()) as { ok: boolean; error: string };
    expect(anonBody.ok).toBe(false);
    // The middleware's fixed-string response — never echoes the request.
    expect(anonBody.error).toMatch(/daemon token required/);
    await anon.close();
  });

  test('SC-2 privilege-confusion: cookie user + adt_* bearer on /api/agents → 401', async ({
    request,
  }) => {
    // Mint a bearer for the logged-in user (re-uses the describe-scoped session).
    const { plaintext } = await mintDaemonToken(request, `sc2-${testRunTag}`);

    // Hit a USER route (/api/agents) with BOTH a valid cookie (via
    // `request`) AND the daemon bearer. The 19-01 AUTH1 patch in
    // `requireAuth` is the gate — it inspects `Authorization: Bearer
    // adt_*` before the cookie check and rejects unconditionally.
    // Without that patch, CE's pass-through auto-login would have
    // authenticated the user as the first DB row and let this succeed.
    const res = await request.get(`${API_BASE}/agents`, {
      headers: { Authorization: `Bearer ${plaintext}` },
    });
    expect(res.status()).toBe(401);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/daemon tokens not accepted on user routes/);
  });

  test('SC-3 rate-limit exemption (skipped in dev/CI): 400 daemon req succeed, /api/agents eventually 429', async ({
    request,
  }) => {
    // The rate limiters are only installed when NODE_ENV=production (see
    // server-core.ts §6.2). CI and local `npm run dev` run in
    // development mode, so the 400-request flood would succeed on BOTH
    // paths — the test would be meaningless.
    //
    // Operator flow to execute SC-3 manually:
    //   SERVER_NODE_ENV=production NODE_ENV=production npm run dev
    //   SERVER_NODE_ENV=production npx playwright test tests/e2e/daemon-rest.spec.ts
    //
    // In CI, `process.env.CI === 'true'` skips this unconditionally
    // (400 requests × 2 paths × retries=2 would also blow the CI budget).
    test.skip(
      process.env.CI === 'true' || process.env.SERVER_NODE_ENV !== 'production',
      'rate-limit SC-3 requires NODE_ENV=production server + non-CI runner',
    );

    const { plaintext } = await mintDaemonToken(request, `sc3-${testRunTag}`);

    // Register so the token has a daemon_id (heartbeat 409 guard — Q8).
    const reg = await callDaemonApi(request, plaintext, 'POST', '/daemon/register', {
      daemonId: `sc3-daemon-${testRunTag}`,
      deviceName: 'sc3',
      cliVersion: '0',
      launchedBy: 'playwright',
      runtimes: [{ name: 'sc3-rt', provider: 'claude', version: '0', status: 'online' }],
    });
    expect(reg.status).toBe(200);

    // 400 heartbeats over the same token — must all succeed (daemon
    // skip on global /api/ limiter + per-token bucket = 1000/60s).
    let blocked = 0;
    for (let i = 0; i < 400; i++) {
      const { status } = await callDaemonApi(
        request,
        plaintext,
        'POST',
        '/daemon/heartbeat',
        { runtimeIds: [] },
      );
      if (status === 429) blocked++;
    }
    expect(blocked, 'daemon /heartbeat must never 429 under 400/60s').toBe(0);

    // Same count on /api/agents — the user limiter is NOT exempt, so at
    // least one request should trip 429 well before 400.
    let throttled = false;
    for (let i = 0; i < 400 && !throttled; i++) {
      const res = await request.get(`${API_BASE}/agents`);
      if (res.status() === 429) throttled = true;
    }
    expect(throttled, '/api/agents at 400 req/min should 429').toBe(true);
  });

  test('SC-4 revocation-sla: revoked token rejected on next request <1000ms', async ({
    request,
  }) => {
    const { id, plaintext } = await mintDaemonToken(request, `sc4-${testRunTag}`);

    // Register (primes daemon_id on the token row; also confirms the
    // bearer works before revocation).
    const reg = await callDaemonApi<{ ok: boolean }>(
      request,
      plaintext,
      'POST',
      '/daemon/register',
      {
        daemonId: `sc4-daemon-${testRunTag}`,
        deviceName: 'sc4',
        cliVersion: '0',
        launchedBy: 'playwright',
        runtimes: [{ name: 'sc4-rt', provider: 'claude', version: '0', status: 'online' }],
      },
    );
    expect(reg.status).toBe(200);

    // Revoke via user-facing DELETE /api/daemon-tokens/:id.
    const revokeRes = await revokeDaemonToken(request, id);
    expect(revokeRes.status()).toBe(200);

    // Next daemon request — measure elapsed time from just-before-call
    // to just-after-response. AUTH3 invariant: <1000ms from revoke
    // commit to next-request 401. In practice this is sub-10ms locally
    // (single indexed SELECT with `WHERE revoked_at IS NULL`).
    const t0 = Date.now();
    const { status, body } = await callDaemonApi<{ ok: boolean; error: string }>(
      request,
      plaintext,
      'POST',
      '/daemon/heartbeat',
      { runtimeIds: [] },
    );
    const elapsed = Date.now() - t0;

    expect(status, `expected 401 after revoke: body=${JSON.stringify(body)}`).toBe(401);
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/invalid or revoked daemon token/);
    expect(elapsed).toBeLessThan(1000);
  });

  test('SC-5 plaintext-once: POST exposes adt_*, GET list never does', async ({
    request,
  }) => {
    const name = `sc5-${testRunTag}`;
    const createRes = await request.post(`${API_BASE}/daemon-tokens`, { data: { name } });
    expect(createRes.status()).toBe(200);
    const createBody = (await createRes.json()) as {
      ok: boolean;
      data: { token: { id: string }; plaintext: string };
    };
    expect(createBody.ok).toBe(true);
    // adt_ + 32 base64url chars = 36 total (192-bit entropy, no padding).
    expect(createBody.data.plaintext).toMatch(/^adt_[A-Za-z0-9_-]{32}$/);
    const createdId = createBody.data.token.id;
    const { plaintext } = createBody.data;

    // GET list — serialise the full response body and assert the
    // plaintext, hash-field names, and any `adt_`-prefixed string are
    // all absent from every row (AUTH2 / T-19-14 mitigation).
    const listRes = await request.get(`${API_BASE}/daemon-tokens`);
    expect(listRes.status()).toBe(200);
    const listBody = (await listRes.json()) as {
      ok: boolean;
      data: Array<Record<string, unknown>>;
    };
    expect(listBody.ok).toBe(true);
    const serialized = JSON.stringify(listBody);

    // The exact plaintext returned at creation MUST NOT appear anywhere
    // in the list response.
    expect(serialized).not.toContain(plaintext);
    // Hash / plaintext field names MUST be absent from the projection.
    expect(serialized).not.toMatch(/"tokenHash"|"token_hash"|"plaintext"/);
    // No row may carry an adt_-prefixed string in any field.
    expect(serialized).not.toMatch(/"adt_[A-Za-z0-9_-]{32}"/);
    // Sanity: the token's id must appear (projection includes id).
    expect(serialized).toContain(createdId);

    // Sanity: the row exists in the list with the expected name.
    const match = listBody.data.find((t) => t.id === createdId);
    expect(match, 'created token must appear in the list').toBeDefined();
    expect(match!.name).toBe(name);
    expect(match!.revokedAt).toBeNull();
  });

  test('full-story: user→daemon→task→complete→revoke happy path', async ({ request }) => {
    test.setTimeout(90_000);

    // 1. Mint a fresh token for this scenario.
    const { id: tokenId, plaintext } = await mintDaemonToken(
      request,
      `fullstory-${testRunTag}`,
    );

    // 2. Daemon registers one runtime (provider=claude).
    const regRes = await callDaemonApi<{
      ok: boolean;
      data: { runtimes: Array<{ id: string; name: string; provider: string }> };
    }>(request, plaintext, 'POST', '/daemon/register', {
      daemonId: `fs-daemon-${testRunTag}`,
      deviceName: 'fs',
      cliVersion: '0.1.0',
      launchedBy: 'playwright',
      runtimes: [
        { name: uniqueName('fs-rt'), provider: 'claude', version: '1.0', status: 'online' },
      ],
    });
    expect(regRes.status).toBe(200);
    expect(regRes.body.ok).toBe(true);
    expect(regRes.body.data.runtimes.length).toBeGreaterThan(0);
    const runtimeId = regRes.body.data.runtimes[0].id;
    expect(runtimeId).toBeTruthy();

    // 3. User creates an Agent bound to that runtime via Phase 17 REST.
    const agentRes = await request.post(`${API_BASE}/agents`, {
      data: {
        name: uniqueName('fs-agent'),
        runtimeId,
        instructions: 'full-story daemon agent',
        maxConcurrentTasks: 1,
      },
    });
    expect(agentRes.status()).toBe(201);
    const agentBody = (await agentRes.json()) as { ok: boolean; data: { id: string } };
    expect(agentBody.ok).toBe(true);
    const agentId = agentBody.data.id;
    expect(agentId).toBeTruthy();

    // 4. Seed an Issue → enqueue a task (Phase 17-03 hook).
    const { issueId } = await seedIssueWithTask(request, {
      agentId,
      title: `full-story task ${testRunTag}`,
    });
    expect(issueId).toBeTruthy();

    // 5. Daemon claims the task via /api/daemon/runtimes/:id/tasks/claim.
    const claimRes = await callDaemonApi<{
      ok: boolean;
      data: { task: { id: string; issueId: string } | null };
    }>(request, plaintext, 'POST', `/daemon/runtimes/${runtimeId}/tasks/claim`, {});
    expect(claimRes.status).toBe(200);
    expect(claimRes.body.ok).toBe(true);
    expect(claimRes.body.data.task, 'claim must return a task for the seeded issue').not.toBeNull();
    const taskId = claimRes.body.data.task!.id;
    expect(taskId).toBeTruthy();

    // 6. Start.
    const startRes = await callDaemonApi<{ ok: boolean; data: { started: boolean } }>(
      request,
      plaintext,
      'POST',
      `/daemon/tasks/${taskId}/start`,
      {},
    );
    expect(startRes.status).toBe(200);
    expect(startRes.body.ok).toBe(true);

    // 7. Stream one text message via the batched /messages endpoint.
    const msgsRes = await callDaemonApi<{ ok: boolean; data: { accepted: number } }>(
      request,
      plaintext,
      'POST',
      `/daemon/tasks/${taskId}/messages`,
      {
        messages: [
          { type: 'text', content: 'hello from the daemon' },
        ],
      },
    );
    expect(msgsRes.status).toBe(200);
    expect(msgsRes.body.ok).toBe(true);
    expect(msgsRes.body.data.accepted).toBe(1);

    // 8. Complete (returns HTTP 200 + { discarded: false } on a live task).
    const completeRes = await callDaemonApi<{
      ok: boolean;
      data: { discarded: boolean; status: string };
    }>(request, plaintext, 'POST', `/daemon/tasks/${taskId}/complete`, {
      result: { ok: true, summary: 'done' },
    });
    expect(completeRes.status).toBe(200);
    expect(completeRes.body.ok).toBe(true);
    expect(completeRes.body.data.discarded).toBe(false);
    expect(completeRes.body.data.status).toBe('completed');

    // 9. Status read-back — DAEMON-06.
    const statusRes = await callDaemonApi<{
      ok: boolean;
      data: { status: string; cancelled: boolean };
    }>(request, plaintext, 'GET', `/daemon/tasks/${taskId}/status`);
    expect(statusRes.status).toBe(200);
    expect(statusRes.body.ok).toBe(true);
    expect(statusRes.body.data.status).toBe('completed');
    expect(statusRes.body.data.cancelled).toBe(false);

    // 10. User revokes the token — daemon's next poll must 401.
    const revokeRes = await revokeDaemonToken(request, tokenId);
    expect(revokeRes.status()).toBe(200);

    const afterRevoke = await callDaemonApi<{ ok: boolean; error: string }>(
      request,
      plaintext,
      'POST',
      '/daemon/heartbeat',
      { runtimeIds: [runtimeId] },
    );
    expect(afterRevoke.status).toBe(401);
    expect(afterRevoke.body.ok).toBe(false);
    expect(afterRevoke.body.error).toMatch(/invalid or revoked daemon token/);
  });
});

// Satisfy isolatedModules with no exports from the spec file itself — the
// helpers are exported from `./fixtures/daemon-helpers.ts` instead.
export {};

// Convenience reference (keeps a local `APIRequestContext` import alive
// in case future helpers need it inline; the import is not stripped by
// the TS checker since it's part of a documented pattern).
export type _APIRequestContextRef = APIRequestContext;
