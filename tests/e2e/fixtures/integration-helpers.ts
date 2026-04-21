/**
 * Phase 26-02 — Shared @integration helpers.
 *
 * Extracted from tests/e2e/daemon-integration.spec.ts so release-smoke
 * specs in Plans 26-03 (hosted runtime) and 26-04 (daemon runtime) share
 * one source of truth for:
 *   - fake-binary PATH hijacking for Claude/Codex/Opencode/OpenClaw
 *   - spawning the built daemon subprocess
 *   - polling /api/runtimes and the server DB
 *   - seeding agents + issues for the claim-happy path
 *
 * Per tests/e2e/AGENTS.md, helpers live under `tests/e2e/fixtures/`.
 *
 * Load-bearing constants (do not rebind in callers — re-import from here):
 *   - API_BASE (reused from ./daemon-helpers.ts)
 *   - WORKTREE_ROOT / CLI_DIST / FAKE_*_JS — the absolute paths to the
 *     daemon CLI build and the four fake-backend fixtures under
 *     `apps/server/tests/unit/fixtures/`.
 */
import { expect, type APIRequestContext } from '@playwright/test';
import { spawn, type ChildProcess, execSync } from 'node:child_process';
import { writeFileSync, chmodSync } from 'node:fs';
import { join, delimiter, resolve as resolvePath } from 'node:path';
import Database from 'better-sqlite3';
import { API_BASE, uniqueName } from './daemon-helpers';

// ── Path constants ────────────────────────────────────────────────────────
//
// Playwright's TypeScript transpiler compiles these files with CommonJS
// output by default, which makes `__dirname` a true global. The existing
// daemon-integration.spec.ts relies on the same assumption (Phase 21-04);
// re-using it here keeps the two files on identical resolution semantics.
export const WORKTREE_ROOT = resolvePath(__dirname, '..', '..', '..');
export const CLI_DIST = resolvePath(WORKTREE_ROOT, 'apps/server/dist/cli.js');
export const FAKE_CLAUDE_JS = resolvePath(
  WORKTREE_ROOT,
  'apps/server/tests/unit/fixtures/fake-claude.js',
);
export const FAKE_CODEX_JS = resolvePath(
  WORKTREE_ROOT,
  'apps/server/tests/unit/fixtures/fake-codex.js',
);
export const FAKE_OPENCODE_JS = resolvePath(
  WORKTREE_ROOT,
  'apps/server/tests/unit/fixtures/fake-opencode.js',
);
export const FAKE_OPENCLAW_JS = resolvePath(
  WORKTREE_ROOT,
  'apps/server/tests/unit/fixtures/fake-openclaw.js',
);

// ── Types ─────────────────────────────────────────────────────────────────

export interface DaemonHandle {
  proc: ChildProcess;
  stdout: string[];
  stderr: string[];
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}

export interface DaemonRuntimeRow {
  id: string;
  kind: string;
  provider: string;
  status: string;
  name: string;
  lastHeartbeatAt?: string | null;
}

// ── helpers ────────────────────────────────────────────────────────────────

/**
 * Write a shell wrapper at <fakeBinDir>/<binName> that execs
 * `node <fixtureJs> "$@"`. The daemon's `detectBackends()` uses PATH +
 * PATHEXT to resolve each provider binary — prepending `fakeBinDir` to PATH
 * hijacks resolution without mutating the real system. Honours per-scenario
 * extra args (e.g. `--hang` for the cross-backend cancel scenario).
 *
 * Generalised from 21-04's installFakeClaude so Plan 22-04 can provision
 * claude / codex / opencode / openclaw fakes with a uniform API.
 */
export function installFakeBinary(
  fakeBinDir: string,
  binName: 'claude' | 'codex' | 'opencode' | 'openclaw',
  fixtureJs: string,
  extraArgs: string[] = [],
): string {
  const wrapperPath = join(fakeBinDir, binName);
  const extra = extraArgs.map((a) => `"${a}"`).join(' ');
  writeFileSync(
    wrapperPath,
    `#!/usr/bin/env sh\nexec node "${fixtureJs}" ${extra} "$@"\n`,
    { mode: 0o755 },
  );
  chmodSync(wrapperPath, 0o755);
  return wrapperPath;
}

/**
 * Spawn `node dist/cli.js daemon start --foreground --data-dir ... --config ...`.
 * Returns a handle that captures stdout/stderr lines and a promise that
 * resolves on child exit.
 *
 * SECURITY: PATH is COMPOSED into the spawn env map (never mutates
 * process.env.PATH of the test-runner itself). See threat T-26-02-01.
 */
export function spawnDaemon(args: {
  dataDir: string;
  configPath: string;
  fakeBinDir: string;
  extraEnv?: Record<string, string>;
}): DaemonHandle {
  const proc = spawn(
    'node',
    [
      CLI_DIST,
      'daemon',
      'start',
      '--foreground',
      '--data-dir',
      args.dataDir,
      '--config',
      args.configPath,
    ],
    {
      env: {
        ...process.env,
        PATH: args.fakeBinDir + delimiter + (process.env.PATH ?? ''),
        ...(args.extraEnv ?? {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  const stdout: string[] = [];
  const stderr: string[] = [];
  proc.stdout?.setEncoding('utf8').on('data', (chunk: string) => {
    stdout.push(chunk);
  });
  proc.stderr?.setEncoding('utf8').on('data', (chunk: string) => {
    stderr.push(chunk);
  });

  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((r) => {
    proc.once('exit', (code, signal) => r({ code, signal }));
  });

  return { proc, stdout, stderr, exited };
}

/**
 * Kill daemon handle — SIGTERM, wait up to 2 s, then SIGKILL. Idempotent.
 */
export async function killDaemon(handle: DaemonHandle | null): Promise<void> {
  if (!handle || handle.proc.killed || handle.proc.exitCode !== null) return;
  try {
    handle.proc.kill('SIGTERM');
  } catch {
    /* already dead */
  }
  const timeout = new Promise<void>((r) => setTimeout(r, 2_000));
  await Promise.race([
    handle.exited.then(() => {
      /* noop */
    }),
    timeout,
  ]);
  if (handle.proc.exitCode === null && !handle.proc.killed) {
    try {
      handle.proc.kill('SIGKILL');
    } catch {
      /* ignore */
    }
  }
  await Promise.race([
    handle.exited.then(() => {
      /* noop */
    }),
    new Promise<void>((r) => setTimeout(r, 1_000)),
  ]);
}

/**
 * Poll GET /api/runtimes until at least one ONLINE `local_daemon` row
 * appears that was created AFTER `minCreatedAt` (which callers pass as the
 * wall-clock time just before they spawned the daemon). Returns online
 * daemons sorted by `lastHeartbeatAt` DESC so the caller's `[0]` is the
 * most-recently-active runtime — i.e. the one we just spawned.
 *
 * Filtering by created-after-spawn prevents the spec from binding to a
 * stale `online` row from a parallel/prior run that happens to be within
 * the server's 90 s heartbeat window.
 */
export async function waitForDaemonRuntime(
  request: APIRequestContext,
  minCreatedAt: number,
  timeoutMs: number,
  providerFilter?: string,
): Promise<DaemonRuntimeRow[]> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await request.get(`${API_BASE}/runtimes`);
    if (res.status() === 200) {
      const body = (await res.json()) as {
        ok: boolean;
        data?: DaemonRuntimeRow[];
      };
      if (body.ok && Array.isArray(body.data)) {
        const online = body.data.filter(
          (r) =>
            r.kind === 'local_daemon' &&
            r.status === 'online' &&
            typeof r.lastHeartbeatAt === 'string' &&
            Date.parse(r.lastHeartbeatAt) >= minCreatedAt &&
            (!providerFilter || r.provider === providerFilter),
        );
        if (online.length >= 1) {
          online.sort(
            (a, b) => Date.parse(b.lastHeartbeatAt ?? '0') - Date.parse(a.lastHeartbeatAt ?? '0'),
          );
          return online;
        }
      }
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(
    `timeout waiting for online local_daemon runtime${
      providerFilter ? ` (provider=${providerFilter})` : ''
    } after ${timeoutMs}ms`,
  );
}

/**
 * Poll the DB directly for task_messages rows keyed off the (task_id,
 * which we resolve from the given issueId). Used by SC-2 to assert the
 * fake-claude fixture's emissions flushed through the daemon batcher →
 * server /messages endpoint → task_messages table.
 *
 * Read-only; opens a separate better-sqlite3 handle so the dev server's
 * connection is undisturbed.
 */
export function countTaskMessagesForIssue(dbPath: string, issueId: string): number {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    // task_messages.task_id → agent_task_queue.id (FK); agent_task_queue
    // carries issue_id. Aggregate across every task ever created for this
    // issue (there should be exactly one in CE).
    const row = db
      .prepare(
        'SELECT COUNT(*) AS n FROM task_messages WHERE task_id IN (SELECT id FROM agent_task_queue WHERE issue_id = ?)',
      )
      .get(issueId) as { n: number };
    return row.n;
  } finally {
    db.close();
  }
}

/**
 * Same DB handle, fetch task status by issueId (there is at most one
 * in-flight task per issue/agent in CE).
 */
export function fetchTaskByIssue(
  dbPath: string,
  issueId: string,
): { id: string; status: string } | null {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const row = db
      .prepare(
        'SELECT id, status FROM agent_task_queue WHERE issue_id = ? ORDER BY created_at DESC LIMIT 1',
      )
      .get(issueId) as { id: string; status: string } | undefined;
    return row ?? null;
  } finally {
    db.close();
  }
}

/**
 * Poll fetchTaskByIssue until status matches one of `accept` or timeout.
 */
export async function waitForTaskStatus(
  dbPath: string,
  issueId: string,
  accept: string[],
  timeoutMs: number,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let last = 'unknown';
  while (Date.now() < deadline) {
    try {
      const row = fetchTaskByIssue(dbPath, issueId);
      if (row) {
        last = row.status;
        if (accept.includes(row.status)) return row.status;
      }
    } catch {
      /* DB lock mid-write; retry */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(
    `timeout waiting for task(issue=${issueId}) status in ${JSON.stringify(accept)}; last=${last}`,
  );
}

/**
 * Create an Agent wired to the daemon's runtime + an Issue assigned to it.
 * PATCH status='in_progress' triggers the Phase 17-03 enqueue hook so the
 * daemon's poll loop will claim the resulting agent_task_queue row.
 *
 * Returns { agentId, issueId }.
 */
export async function seedAgentAndIssue(
  request: APIRequestContext,
  runtimeId: string,
  nameTag: string,
): Promise<{ agentId: string; issueId: string }> {
  // 1. Create the Agent.
  const agentRes = await request.post(`${API_BASE}/agents`, {
    data: {
      name: uniqueName(`it-${nameTag}-agent`),
      runtimeId,
      instructions: 'integration test agent',
      maxConcurrentTasks: 1,
    },
  });
  expect(agentRes.status(), `agent creation failed: ${await agentRes.text()}`).toBe(201);
  const agentBody = (await agentRes.json()) as { ok: boolean; data: { id: string } };
  const agentId = agentBody.data.id;

  // 2. Create the Issue assigned to the agent, in the `backlog` state.
  //    The task-queue enqueue hook (ISSUE-02 in issue-store.applyIssueSideEffects)
  //    only fires on a `backlog → non-backlog` transition or on
  //    assignee-change — creating in backlog is the reliable trigger.
  const issueRes = await request.post(`${API_BASE}/issues`, {
    data: {
      title: uniqueName(`it-${nameTag}-task`),
      description: 'integration test issue',
      status: 'backlog',
      priority: 'medium',
      assigneeId: agentId,
    },
  });
  expect(issueRes.status(), `issue creation failed: ${await issueRes.text()}`).toBe(201);
  const issueBody = (await issueRes.json()) as { ok: boolean; data: { id: string } };
  const issueId = issueBody.data.id;

  // 3. Transition status: backlog → in_progress triggers ISSUE-02 enqueue.
  const patchRes = await request.patch(`${API_BASE}/issues/${issueId}`, {
    data: { status: 'in_progress' },
  });
  expect(patchRes.status(), `issue patch failed: ${await patchRes.text()}`).toBe(200);

  return { agentId, issueId };
}

/**
 * Platform-aware `pgrep -f <pattern>` — returns the list of pids matching
 * the pattern. Empty array on POSIX means no matches (pgrep exits 1 on no
 * matches; we swallow). Windows returns [] unconditionally (no pgrep
 * available — callers `test.skip(platform==='win32')` for any zombie-check
 * scenarios).
 */
export function pgrepByPattern(pattern: string): string[] {
  try {
    const out = execSync(`pgrep -f ${pattern}`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out
      .trim()
      .split(/\s+/)
      .filter((s) => s.length > 0);
  } catch {
    // exit 1 = no matches
    return [];
  }
}
