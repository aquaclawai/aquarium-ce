/**
 * HTTP client for the Phase 19 `/api/daemon/*` surface (Plan 21-02, CLI-02 / BACKEND-05).
 *
 * Thin wrapper over the Node 22 global `fetch` that adds:
 *   • Bearer auth header (token passed at construction, never echoed).
 *   • Retry with exponential backoff on 429 / 500 / 502 / 503 / 504.
 *   • Idempotency-honouring `{ discarded: true }` success semantics for
 *     `/tasks/:id/{complete,fail}`.
 *   • AbortSignal threaded into every fetch call (PG5).
 *
 * OWNED pitfall + threat mitigations:
 *   • PG2 — every fetch call wrapped in try/catch; no unhandled rejection
 *     can escape the client. Retry loop has a hard cap (default 3 attempts).
 *   • PG5 — `signal: this.signal` on every outbound fetch; AbortError
 *     short-circuits the retry loop and propagates upstream.
 *   • T-21-01 — token lives only in the `Authorization` header value;
 *     `DaemonHttpError.message` surfaces server's `error` body field, never
 *     the outbound token. Verified by unit test.
 *   • T-21-10 — `maxAttempts` bound prevents infinite retry on server 5xx
 *     storms; after exhaustion a typed error surfaces.
 *
 * Never retries on 2xx (obvious), 3xx (follow-redirects is fetch's job), or
 * 4xx other than 429.
 */

import type {
  ApiResponse,
  DaemonRegisterRequest,
  DaemonRegisterResponse,
  ClaimedTask,
  TaskStatus,
} from '@aquarium/shared';

export interface TerminalResult {
  discarded: boolean;
  status: TaskStatus;
}

/**
 * Pending-message wire shape (Phase 18 `PendingTaskMessage`, restated here to
 * avoid pulling the server-side batcher type into the daemon module graph).
 */
export interface PendingTaskMessageWire {
  type: 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'error';
  tool?: string | null;
  content?: string | null;
  input?: unknown;
  output?: unknown;
  metadata?: Record<string, unknown>;
  workspaceId: string;
  issueId: string;
}

export class DaemonHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly bodyError: string | null,
    msg: string,
  ) {
    super(msg);
    this.name = 'DaemonHttpError';
  }
}

export interface DaemonHttpClientOpts {
  server: string;
  token: string;
  signal?: AbortSignal;
  /** Test seams. */
  _fetch?: typeof fetch;
  _setTimeout?: (fn: () => void, ms: number) => unknown;
  _clearTimeout?: (h: unknown) => void;
  /** Override retry policy (test only). */
  _maxAttempts?: number;
  _baseBackoffMs?: number;
}

const RETRIABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

export class DaemonHttpClient {
  private readonly server: string;
  private readonly token: string;
  private readonly signal: AbortSignal | undefined;
  private readonly fetchFn: typeof fetch;
  private readonly setTimeoutFn: (fn: () => void, ms: number) => unknown;
  private readonly clearTimeoutFn: (h: unknown) => void;
  private readonly maxAttempts: number;
  private readonly baseBackoffMs: number;

  constructor(opts: DaemonHttpClientOpts) {
    this.server = opts.server.replace(/\/$/, '');
    this.token = opts.token;
    this.signal = opts.signal;
    this.fetchFn = opts._fetch ?? ((...args) => fetch(...args));
    this.setTimeoutFn = opts._setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimeoutFn = opts._clearTimeout ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    this.maxAttempts = opts._maxAttempts ?? 3;
    this.baseBackoffMs = opts._baseBackoffMs ?? 100;
  }

  // ── Phase 19 endpoints (10 total) ──

  async register(body: DaemonRegisterRequest): Promise<DaemonRegisterResponse> {
    return this.post<DaemonRegisterResponse>('/api/daemon/register', body);
  }

  async heartbeat(runtimeIds: string[]): Promise<{ pendingPings: unknown[]; pendingUpdates: unknown[] }> {
    return this.post('/api/daemon/heartbeat', { runtimeIds });
  }

  async deregister(runtimeIds: string[]): Promise<{ ok: boolean }> {
    return this.post('/api/daemon/deregister', { runtimeIds });
  }

  async claimTask(runtimeId: string): Promise<{ task: ClaimedTask | null }> {
    return this.post(`/api/daemon/runtimes/${encodeURIComponent(runtimeId)}/tasks/claim`, {});
  }

  async startTask(taskId: string): Promise<{ started: boolean; status: TaskStatus }> {
    return this.post(`/api/daemon/tasks/${encodeURIComponent(taskId)}/start`, {});
  }

  async postProgress(taskId: string, body: { progress?: number; note?: string }): Promise<{ ok: boolean }> {
    return this.post(`/api/daemon/tasks/${encodeURIComponent(taskId)}/progress`, body);
  }

  async postMessages(taskId: string, messages: PendingTaskMessageWire[]): Promise<{ accepted: number }> {
    return this.post(`/api/daemon/tasks/${encodeURIComponent(taskId)}/messages`, { messages });
  }

  async completeTask(taskId: string, result?: unknown): Promise<TerminalResult> {
    return this.post(`/api/daemon/tasks/${encodeURIComponent(taskId)}/complete`, { result });
  }

  async failTask(taskId: string, error?: string): Promise<TerminalResult> {
    return this.post(`/api/daemon/tasks/${encodeURIComponent(taskId)}/fail`, { error });
  }

  async getTaskStatus(taskId: string): Promise<{ status: TaskStatus; cancelled: boolean }> {
    return this.get(`/api/daemon/tasks/${encodeURIComponent(taskId)}/status`);
  }

  // ── internals ──

  private async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }
  private async get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path, undefined);
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body: unknown): Promise<T> {
    const url = `${this.server}${path}`;
    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: `Bearer ${this.token}`,
    };
    if (method === 'POST') headers['Content-Type'] = 'application/json';

    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        const response = await this.fetchFn(url, {
          method,
          headers,
          body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
          signal: this.signal,
        });
        if (response.ok) {
          const payload = (await response.json()) as ApiResponse<T>;
          if (!payload.ok) {
            // 2xx + { ok: false } — protocol violation; surface server error but do not retry.
            throw new DaemonHttpError(
              response.status,
              payload.error ?? null,
              `server rejected request: ${payload.error ?? 'unknown'}`,
            );
          }
          return payload.data as T;
        }
        // Non-2xx: attempt to read JSON error body (defensive — may not be JSON).
        const bodyErr = await safeReadJsonError(response);
        if (RETRIABLE_STATUSES.has(response.status) && attempt < this.maxAttempts) {
          await this.backoffWait(attempt);
          continue;
        }
        throw new DaemonHttpError(
          response.status,
          bodyErr,
          `HTTP ${response.status}: ${bodyErr ?? 'request failed'}`,
        );
      } catch (err) {
        // AbortError → propagate immediately, no retry (PG5).
        if (isAbortError(err)) throw err;
        // Typed protocol error from inside the try block → propagate without retry.
        if (err instanceof DaemonHttpError) throw err;
        // Network errors (fetch rejection) → retry up to maxAttempts.
        lastErr = err;
        if (attempt < this.maxAttempts) {
          await this.backoffWait(attempt);
          continue;
        }
        throw err;
      }
    }
    // Unreachable — loop either returned or threw.
    throw lastErr instanceof Error ? lastErr : new Error('daemon http client: exhausted retries');
  }

  private backoffWait(attempt: number): Promise<void> {
    const ms = this.baseBackoffMs * Math.pow(2, attempt - 1);
    return new Promise<void>((resolve) => {
      this.setTimeoutFn(() => resolve(), ms);
    });
  }
}

function isAbortError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: string }).name === 'AbortError';
}

async function safeReadJsonError(res: Response): Promise<string | null> {
  try {
    const payload = (await res.json()) as { error?: string };
    return typeof payload?.error === 'string' ? payload.error : null;
  } catch {
    return null;
  }
}
