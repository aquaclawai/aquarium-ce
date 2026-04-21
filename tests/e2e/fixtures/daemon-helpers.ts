import type { APIRequestContext, APIResponse } from '@playwright/test';

/**
 * Phase 19-04 — Playwright E2E helpers for the Daemon REST API & Auth surface.
 *
 * Exports:
 *   - `signUpAndSignIn(request)`   : Create a disposable test user via
 *     `/api/auth/test-signup`; the cookie jar attached to the provided
 *     `request` context is the authenticated session from that point on.
 *   - `mintDaemonToken(request, name)` : POST /api/daemon-tokens with the
 *     caller's cookie-auth session; returns `{ id, plaintext }`. The
 *     plaintext is a fresh `adt_<32 base64url>` bearer (36 chars total)
 *     and is only visible in the POST response — subsequent GETs never
 *     expose it (SC-5 contract).
 *   - `callDaemonApi(request, plaintext, method, path, body?)` : Minimal
 *     typed fetch wrapper that attaches the `Authorization: Bearer
 *     adt_…` header. Never throws on non-2xx; returns `{ status, body }`
 *     so tests can assert explicit status codes on authentication
 *     failures (SC-1 cookie-rejected branch, SC-2 privilege-confusion,
 *     SC-4 post-revoke 401, etc.).
 *   - `seedIssueWithTask(request, args)` : Create an Issue assigned to a
 *     given agent, then PATCH status=`in_progress` to trigger the Phase
 *     17-03 enqueue side-effect (agent_task_queue row). Returns the
 *     resulting `{ issueId, taskId }` so the full-story test can CLAIM
 *     it via the daemon.
 *   - `revokeDaemonToken(request, tokenId)` : DELETE /api/daemon-tokens/:id.
 *
 * Design decisions (Phase 19-04 plan, §Helper file scope):
 *   • Absolute URLs (`http://localhost:3001/api`) — mirrors
 *     tests/e2e/runtimes.spec.ts (Phase 16-04). Playwright `webServer`
 *     starts the Vite web dev server on :5173, not the API server, so
 *     tests MUST hit :3001 directly. Per CLAUDE.md §Testing, the Express
 *     server is expected to be running separately (`npm run dev`).
 *   • Never throw on API failure — tests do the assertion, helpers do the
 *     plumbing. Except `signUpAndSignIn` and `mintDaemonToken` which
 *     throw on failure (setup errors should fail loudly).
 */

export const API_BASE = 'http://localhost:3001/api';

export function uniqueEmail(prefix = 'daemon'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@e2e.test`;
}

export function uniqueName(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Signs up a disposable test user via `/api/auth/test-signup`.
 * The cookie jar attached to `request` becomes an authenticated session.
 * Mirrors the pattern from tests/e2e/runtimes.spec.ts (Phase 16-04).
 */
export async function signUpAndSignIn(
  request: APIRequestContext,
  opts?: { email?: string; password?: string; displayName?: string },
): Promise<{ email: string; password: string; displayName: string }> {
  const email = opts?.email ?? uniqueEmail();
  const password = opts?.password ?? 'DaemonE2E123!';
  const displayName = opts?.displayName ?? 'Daemon E2E User';
  const res = await request.post(`${API_BASE}/auth/test-signup`, {
    data: { email, password, displayName },
  });
  if (res.status() !== 201) {
    throw new Error(
      `signUpAndSignIn: /auth/test-signup returned ${res.status()}: ${await res.text()}`,
    );
  }
  return { email, password, displayName };
}

/**
 * Creates a daemon token via POST /api/daemon-tokens (cookie-auth on the
 * caller's `request` context). Returns `{ id, plaintext }` — the plaintext
 * is exposed ONCE here (DAEMON-10, SC-5); subsequent list responses never
 * re-expose it (asserted in SC-5 test).
 *
 * Throws on non-200 — token issuance is a prerequisite for every other
 * scenario in the suite, so a failure here should fail loudly.
 */
export async function mintDaemonToken(
  request: APIRequestContext,
  name: string,
): Promise<{ id: string; plaintext: string }> {
  const res = await request.post(`${API_BASE}/daemon-tokens`, { data: { name } });
  if (res.status() !== 200) {
    throw new Error(
      `mintDaemonToken: POST /api/daemon-tokens returned ${res.status()}: ${await res.text()}`,
    );
  }
  const body = (await res.json()) as {
    ok: boolean;
    data?: { token: { id: string }; plaintext: string };
    error?: string;
  };
  if (!body.ok || !body.data) {
    throw new Error(`mintDaemonToken: ok=false: ${JSON.stringify(body)}`);
  }
  return { id: body.data.token.id, plaintext: body.data.plaintext };
}

/**
 * Revoke a daemon token via DELETE /api/daemon-tokens/:id (cookie-auth).
 * Returns the raw Playwright response so tests can assert status + elapsed
 * time (SC-4 revocation SLA).
 */
export async function revokeDaemonToken(
  request: APIRequestContext,
  tokenId: string,
): Promise<APIResponse> {
  return request.delete(`${API_BASE}/daemon-tokens/${tokenId}`);
}

/**
 * Calls a daemon endpoint with `Authorization: Bearer <plaintext>` bearer
 * auth. Returns `{ status, body }` — never throws on non-2xx, because
 * tests assert the explicit status code (e.g. SC-4 expects 401 after
 * revocation).
 *
 * `body` is the parsed JSON ApiResponse wrapper; callers can narrow to
 * their expected shape at the call site via the generic parameter.
 */
export async function callDaemonApi<T = unknown>(
  request: APIRequestContext,
  plaintext: string,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<{ status: number; body: T }> {
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
  const headers = { Authorization: `Bearer ${plaintext}` };
  let res: APIResponse;
  if (method === 'GET') {
    res = await request.get(url, { headers });
  } else if (method === 'POST') {
    res = await request.post(url, { headers, data: body ?? {} });
  } else {
    res = await request.delete(url, { headers });
  }
  const text = await res.text();
  let parsed: T;
  try {
    parsed = JSON.parse(text) as T;
  } catch {
    parsed = text as unknown as T;
  }
  return { status: res.status(), body: parsed };
}

/**
 * Seed an Issue + trigger task enqueue via Phase 17 REST so the full-story
 * test has something for the daemon to claim.
 *
 * Flow:
 *   1. POST /api/issues  → create issue assigned to `args.agentId`
 *   2. PATCH /api/issues/:id  → status='in_progress' triggers the Phase
 *      17-03 enqueue hook → a new row in `agent_task_queue`
 *   3. Returns `{ issueId, taskId }`. Task id is read from the queued row
 *      via the daemon `/claim` endpoint — pre-claim identification via
 *      user-side API is unavailable in CE (no GET /api/tasks exposed).
 *      The full-story caller therefore only needs `issueId`; callers who
 *      need the task id MUST claim first.
 *
 * Throws on non-2xx responses — fixture setup errors should fail loudly.
 *
 * Note: Phase 17's PATCH returns the Issue only (not its tasks). We return
 * `{ issueId, taskId: null }` and let the caller discover `taskId` via the
 * daemon CLAIM response.
 */
export async function seedIssueWithTask(
  request: APIRequestContext,
  args: { agentId: string; title: string },
): Promise<{ issueId: string; taskId: string | null }> {
  const issueRes = await request.post(`${API_BASE}/issues`, {
    data: {
      title: args.title,
      description: null,
      status: 'todo',
      priority: 'medium',
      assigneeId: args.agentId,
    },
  });
  if (issueRes.status() !== 201) {
    throw new Error(
      `seedIssueWithTask: POST /api/issues returned ${issueRes.status()}: ${await issueRes.text()}`,
    );
  }
  const issueBody = (await issueRes.json()) as {
    ok: boolean;
    data?: { id: string };
    error?: string;
  };
  if (!issueBody.ok || !issueBody.data) {
    throw new Error(`seedIssueWithTask: POST /api/issues ok=false: ${JSON.stringify(issueBody)}`);
  }
  const issueId = issueBody.data.id;

  // Transition status → in_progress triggers Phase 17-03 task enqueue.
  const patchRes = await request.patch(`${API_BASE}/issues/${issueId}`, {
    data: { status: 'in_progress' },
  });
  if (patchRes.status() !== 200) {
    throw new Error(
      `seedIssueWithTask: PATCH /api/issues/${issueId} returned ${patchRes.status()}: ${await patchRes.text()}`,
    );
  }

  return { issueId, taskId: null };
}
