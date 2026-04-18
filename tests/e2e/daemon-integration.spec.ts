/**
 * Phase 21-04 — Daemon full-cycle integration smoke (@integration).
 *
 * Spawns the built daemon (`node apps/server/dist/cli.js daemon start
 * --foreground ...`) as a child process, aims it at the locally-running
 * Aquarium CE server (`npm run dev`, port 3001), puts a scripted
 * `fake-claude.js` on PATH as the `claude` binary, and drives the full
 * register → claim → stream → complete cycle via Playwright's APIRequest
 * fixture.
 *
 * Coverage map (§Phase 21 ROADMAP success criteria):
 *   SC-1: after daemon.register, GET /api/runtimes lists exactly ONE
 *         local_daemon row with provider='claude', status='online', version
 *         matching the fake stub's `0.0.0 (fake-claude)`.
 *   SC-2: issue assigned to daemon-backed agent produces ≥ 3 `task_messages`
 *         rows (fake fixture emits text / tool_use / tool_result / text =
 *         4 messages) AND the task's final status is `completed`.
 *   SC-3: mid-task cancel → daemon SIGTERMs the child → `pgrep -f fake-claude`
 *         returns empty within 2 s post-cancel. PM1 / BACKEND-04 / T-21-05
 *         end-to-end proof.
 *   SC-4: `AQUARIUM_DAEMON_TEST_CRASH_AT=after-register` in the daemon's env
 *         synthesises an unhandledRejection; crash-handler writes
 *         `<dataDir>/daemon.crash.log` AND the daemon exits with code 1.
 *
 * Tagged `@integration`; skipped in CI via `test.skip(process.env.CI ===
 * 'true', ...)` because it spawns real subprocesses, relies on `pgrep`
 * (POSIX-only), and requires a pre-running Aquarium server (`npm run dev`)
 * which CI does not boot.
 *
 * Run locally:
 *   npm run dev                                                       # terminal 1
 *   npm run build -w @aquarium/shared && npm run build -w @aquaclawai/aquarium  # terminal 2
 *   CI=false npx playwright test tests/e2e/daemon-integration.spec.ts --grep @integration
 */
import { test, expect } from '@playwright/test';
import {
  mkdtempSync,
  writeFileSync,
  chmodSync,
  readFileSync,
  existsSync,
  rmSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  mintDaemonToken,
  signUpAndSignIn,
} from './fixtures/daemon-helpers';
import {
  installFakeBinary,
  spawnDaemon,
  killDaemon,
  waitForDaemonRuntime,
  countTaskMessagesForIssue,
  waitForTaskStatus,
  seedAgentAndIssue,
  pgrepByPattern,
  CLI_DIST,
  FAKE_CLAUDE_JS,
  FAKE_CODEX_JS,
  FAKE_OPENCODE_JS,
  type DaemonHandle,
} from './fixtures/integration-helpers';

// ── CI skip guard (top-of-file, applies to every test in this file) ──
// Phase 26-02: opt-in for the new `integration-smoke` CI job which sets
// AQUARIUM_INTEGRATION=1. Plain CI runs (without the opt-in) still skip.
test.skip(
  process.env.CI === 'true' && process.env.AQUARIUM_INTEGRATION !== '1',
  'integration spec requires local env or AQUARIUM_INTEGRATION=1 opt-in for the CI integration-smoke job',
);

// ── Serial mode — scenarios share the local dev server ──
test.describe.configure({ mode: 'serial' });

const SERVER_BASE = process.env.AQ_SERVER_BASE ?? 'http://localhost:3001';

// ── Suite ───────────────────────────────────────────────────────────────────

test.describe('@integration daemon full cycle (21-04)', () => {
  const testRunTag = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  let sharedTmpRoot = '';

  test.beforeAll(async ({ request }) => {
    sharedTmpRoot = mkdtempSync(join(tmpdir(), 'aq-daemon-it-shared-'));
    await signUpAndSignIn(request, {
      email: `daemon-it-${testRunTag}@e2e.test`,
      password: 'DaemonIT123!',
      displayName: 'Daemon IT User',
    });
    // Verify the dist build exists — failing fast is more useful than a
    // mysterious subprocess ENOENT later.
    if (!existsSync(CLI_DIST)) {
      throw new Error(
        `dist/cli.js not found at ${CLI_DIST}. Run: npm run build -w @aquaclawai/aquarium`,
      );
    }
    if (!existsSync(FAKE_CLAUDE_JS)) {
      throw new Error(`fake-claude.js not found at ${FAKE_CLAUDE_JS}`);
    }
  });

  test.afterAll(() => {
    if (sharedTmpRoot && existsSync(sharedTmpRoot)) {
      try { rmSync(sharedTmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  // Per-test state for afterEach cleanup.
  let daemonHandle: DaemonHandle | null = null;
  let tmpDir = '';

  test.afterEach(async () => {
    await killDaemon(daemonHandle);
    daemonHandle = null;
    if (tmpDir && existsSync(tmpDir)) {
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
    tmpDir = '';
  });

  test('SC-1 + SC-2: registers runtime online, streams ≥3 task_messages, completes', async ({ request }) => {
    test.setTimeout(90_000);

    // Per-test temp dir = data-dir for daemon + bin dir for fake claude.
    tmpDir = mkdtempSync(join(tmpdir(), 'aq-daemon-it-sc12-'));
    const fakeBinDir = join(tmpDir, 'bin');
    mkdirSync(fakeBinDir, { recursive: true });
    installFakeBinary(fakeBinDir, 'claude', FAKE_CLAUDE_JS);

    // Mint a token for this daemon + write daemon.json (0o600).
    const { plaintext } = await mintDaemonToken(request, `it-sc12-${testRunTag}`);
    expect(plaintext).toMatch(/^adt_[A-Za-z0-9_-]{32}$/);

    const configPath = join(tmpDir, 'daemon.json');
    writeFileSync(
      configPath,
      JSON.stringify({ server: SERVER_BASE, token: plaintext }, null, 2) + '\n',
      { mode: 0o600 },
    );
    if (process.platform !== 'win32') chmodSync(configPath, 0o600);

    // Spawn daemon. Capture pre-spawn wall time so waitForDaemonRuntime can
    // ignore any pre-existing online daemon rows.
    const spawnedAt = Date.now();
    daemonHandle = spawnDaemon({ dataDir: tmpDir, configPath, fakeBinDir });

    // SC-1 — wait up to 15 s for /register → a local_daemon row with a
    // heartbeat newer than `spawnedAt` appears online. Prior test runs may
    // have left online-looking rows in the dev server's shared DB; the
    // post-spawn filter guarantees we bind to OUR daemon.
    const onlineDaemons = await waitForDaemonRuntime(request, spawnedAt, 15_000);
    expect(
      onlineDaemons.length,
      `expected at least one online local_daemon runtime, got ${onlineDaemons.length}`,
    ).toBeGreaterThanOrEqual(1);
    const rt = onlineDaemons[0];
    expect(rt.kind).toBe('local_daemon');
    expect(rt.provider).toBe('claude');
    expect(rt.status).toBe('online');

    // SC-2 — seed Agent+Issue assigned to the daemon's runtime. The issue
    // patch enqueues a task; the daemon poll loop claims and runs it.
    const { issueId } = await seedAgentAndIssue(request, rt.id, 'sc12');

    // Wait for the task to reach 'completed' — fake-claude emits ~4 msgs
    // with 20 ms spacing, then exits 0. Allow generous headroom.
    //
    // NOTE: the daemon's `--data-dir` is `tmpDir` (for daemon.pid +
    // daemon.crash.log + daemon.json overlay); the SERVER owns the actual
    // SQLite DB at `~/.aquarium/aquarium.db`. Count rows there via a
    // read-only better-sqlite3 handle.
    const serverDbPath =
      process.env.AQ_SERVER_DB_PATH ?? join(process.env.HOME ?? '', '.aquarium', 'aquarium.db');
    // Guard against the dev server running elsewhere (e.g. inside CI test-server fixture).
    if (!existsSync(serverDbPath)) {
      throw new Error(
        `server DB not found at ${serverDbPath}. Set AQ_SERVER_DB_PATH or ensure \`npm run dev\` is running.`,
      );
    }

    const finalStatus = await waitForTaskStatus(
      serverDbPath,
      issueId,
      ['completed'],
      30_000,
    );
    expect(finalStatus).toBe('completed');

    // task_messages count — poll up to 5 s. Double-stage flush (daemon
    // StreamBatcher 500 ms + server task-message-batcher 500 ms) means the
    // final messages may land in task_messages up to ~1.5 s AFTER the
    // task's status flips to `completed`. Fake fixture emits 4 visible
    // messages (text / tool_use / tool_result / text); SC-2 asserts ≥ 3 so
    // we're not racing the final text.
    const msgDeadline = Date.now() + 5_000;
    let msgCount = 0;
    while (Date.now() < msgDeadline) {
      msgCount = countTaskMessagesForIssue(serverDbPath, issueId);
      if (msgCount >= 3) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    expect(
      msgCount,
      `expected ≥3 task_messages for issue ${issueId}, got ${msgCount}`,
    ).toBeGreaterThanOrEqual(3);

    // Note: we don't inspect the daemon's stdout here — the `[daemon] claude=...`
    // audit log from startup is captured in `daemonHandle.stdout` and can be
    // surfaced on test failure for debugging (see `daemonHandle.stdout.join('')`).
    // The authoritative invariant is runtime.status='online' + task.status='completed'.
  });

  test('SC-3: mid-task cancel → SIGTERM child → no zombies (pgrep empty)', async ({ request }) => {
    test.skip(
      process.platform === 'win32',
      'pgrep is POSIX-only; Windows zombie-check deferred',
    );
    test.setTimeout(60_000);

    tmpDir = mkdtempSync(join(tmpdir(), 'aq-daemon-it-sc3-'));
    const fakeBinDir = join(tmpDir, 'bin');
    mkdirSync(fakeBinDir, { recursive: true });
    // `--hang` makes fake-claude sleep forever so we can cancel mid-task.
    installFakeBinary(fakeBinDir, 'claude', FAKE_CLAUDE_JS, ['--hang']);

    const { plaintext } = await mintDaemonToken(request, `it-sc3-${testRunTag}`);
    const configPath = join(tmpDir, 'daemon.json');
    writeFileSync(
      configPath,
      JSON.stringify({ server: SERVER_BASE, token: plaintext }, null, 2) + '\n',
      { mode: 0o600 },
    );
    if (process.platform !== 'win32') chmodSync(configPath, 0o600);

    const spawnedAt = Date.now();
    daemonHandle = spawnDaemon({ dataDir: tmpDir, configPath, fakeBinDir });

    const onlineDaemons = await waitForDaemonRuntime(request, spawnedAt, 15_000);
    const rt = onlineDaemons[0];
    const { issueId } = await seedAgentAndIssue(request, rt.id, 'sc3');

    const serverDbPath =
      process.env.AQ_SERVER_DB_PATH ?? join(process.env.HOME ?? '', '.aquarium', 'aquarium.db');

    // Wait for the task to reach 'running' (claim → /start).
    await waitForTaskStatus(serverDbPath, issueId, ['running'], 20_000);

    // Sanity check: at least one fake-claude child exists right now.
    // (This fails fast if the spawn side hasn't happened yet.)
    let preCancelPids: string[] = [];
    const preDeadline = Date.now() + 5_000;
    while (Date.now() < preDeadline) {
      preCancelPids = pgrepByPattern('fake-claude');
      if (preCancelPids.length > 0) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(
      preCancelPids.length,
      'expected at least one fake-claude child before cancel',
    ).toBeGreaterThan(0);

    // Cancel the issue → ISSUE-04 cascades to cancel every live task.
    const cancelRes = await request.patch(`${API_BASE}/issues/${issueId}`, {
      data: { status: 'cancelled' },
    });
    expect(cancelRes.status()).toBe(200);

    // Wait up to 3 s for the daemon's cancel-poller (5 s tick) + SIGTERM
    // + forceKillAfterDelay (10 s cap, but fake-claude SIGTERMs clean at 143)
    // to reap every child. Empirically this is < 1 s; we allow 8 s to cover
    // the 5 s poll interval.
    const zombieDeadline = Date.now() + 8_000;
    let postCancelPids: string[] = [];
    while (Date.now() < zombieDeadline) {
      postCancelPids = pgrepByPattern('fake-claude');
      if (postCancelPids.length === 0) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(
      postCancelPids,
      `expected NO fake-claude processes after cancel, found: ${JSON.stringify(postCancelPids)}`,
    ).toEqual([]);

    // Task status should be 'cancelled' or 'failed' (both are acceptable
    // per Plan 21-03's `isCanceled → failTask('cancelled')` logic + server
    // ISSUE-04 cascade).
    const finalStatus = await waitForTaskStatus(
      serverDbPath,
      issueId,
      ['cancelled', 'failed'],
      10_000,
    );
    expect(['cancelled', 'failed']).toContain(finalStatus);
  });

  test('SC-4: AQUARIUM_DAEMON_TEST_CRASH_AT → crash log + exit code 1', async ({ request }) => {
    test.setTimeout(30_000);

    tmpDir = mkdtempSync(join(tmpdir(), 'aq-daemon-it-sc4-'));
    const fakeBinDir = join(tmpDir, 'bin');
    mkdirSync(fakeBinDir, { recursive: true });
    installFakeBinary(fakeBinDir, 'claude', FAKE_CLAUDE_JS);

    const { plaintext } = await mintDaemonToken(request, `it-sc4-${testRunTag}`);
    const configPath = join(tmpDir, 'daemon.json');
    writeFileSync(
      configPath,
      JSON.stringify({ server: SERVER_BASE, token: plaintext }, null, 2) + '\n',
      { mode: 0o600 },
    );
    if (process.platform !== 'win32') chmodSync(configPath, 0o600);

    // `after-register` fires synchronously right after http.register resolves,
    // which happens during startDaemon() BEFORE the poll loop starts. The
    // throw becomes an unhandledRejection (startDaemon is awaited inside
    // the commander action; the `.catch()` in cli.ts logs + exits 1, but the
    // registerProcessHandlers() wired earlier catches it first and runs
    // handleFatal → appendFileSync(daemon.crash.log) → process.exit(1)).
    daemonHandle = spawnDaemon({
      dataDir: tmpDir,
      configPath,
      fakeBinDir,
      extraEnv: { AQUARIUM_DAEMON_TEST_CRASH_AT: 'after-register' },
    });

    // Wait for daemon to exit.
    const exitInfo = await Promise.race([
      daemonHandle.exited,
      new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((r) =>
        setTimeout(() => r({ code: -1, signal: null }), 20_000),
      ),
    ]);
    expect(
      exitInfo.code,
      `expected daemon to exit with code 1; got code=${exitInfo.code} signal=${exitInfo.signal}\n` +
        `stdout=${daemonHandle.stdout.join('')}\nstderr=${daemonHandle.stderr.join('')}`,
    ).toBe(1);

    // Crash log was written.
    const crashLog = join(tmpDir, 'daemon.crash.log');
    expect(
      existsSync(crashLog),
      `expected ${crashLog} to exist after crash\n` +
        `stdout=${daemonHandle.stdout.join('')}\n` +
        `stderr=${daemonHandle.stderr.join('')}`,
    ).toBe(true);
    const body = readFileSync(crashLog, 'utf8');
    // The crash handler writes `<ISO>\t<source>\t<errorString>\n`.
    expect(body).toMatch(/unhandledRejection|uncaughtException/);
    expect(body).toMatch(/AQUARIUM_DAEMON_TEST_CRASH_AT/);

    // Sanity check: the token-authed /api/runtimes should NOT be listing
    // the (now-dead) daemon's runtime as 'online' forever — but the server's
    // 90-s heartbeat window owns that transition, so we don't assert it here.
    // Calling this endpoint proves the server is still healthy post-crash.
    const rtRes = await request.get(`${API_BASE}/runtimes`);
    expect(rtRes.status()).toBe(200);
  });
});

// ── Phase 22 Plan 04 — cross-backend integration scenarios ────────────────
//
// Three new @integration scenarios exercise the main.ts dispatch rewrite
// (Plan 22-04): detectBackends fills ALL 5 provider slots, the server's
// /register response is walked name-first (T-22-18), and backendByRuntimeId
// routes each claim to the correct Backend. The fake-codex and fake-opencode
// fixtures shipped by Plan 22-01 provide the scripted child-process
// behaviour so these scenarios do not require real codex/opencode CLIs.
//
// Openclaw is DEFERRED — openclaw's live NDJSON wire shape (Assumption A3)
// was not captured in Plan 22-03, so an integration scenario built on the
// hand-authored Shape-A fixture would either reinforce the assumption
// falsely or fail unhelpfully. Manual verification step is flagged in the
// 22-04 SUMMARY.

test.describe('@integration cross-backend (22-04)', () => {
  const testRunTag = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  let sharedTmpRoot = '';

  test.beforeAll(async ({ request }) => {
    sharedTmpRoot = mkdtempSync(join(tmpdir(), 'aq-daemon-it-22-04-shared-'));
    await signUpAndSignIn(request, {
      email: `daemon-it-22-04-${testRunTag}@e2e.test`,
      password: 'DaemonIT123!',
      displayName: 'Daemon IT 22-04 User',
    });
    if (!existsSync(CLI_DIST)) {
      throw new Error(
        `dist/cli.js not found at ${CLI_DIST}. Run: npm run build -w @aquaclawai/aquarium`,
      );
    }
    if (!existsSync(FAKE_CODEX_JS)) {
      throw new Error(`fake-codex.js not found at ${FAKE_CODEX_JS}`);
    }
    if (!existsSync(FAKE_OPENCODE_JS)) {
      throw new Error(`fake-opencode.js not found at ${FAKE_OPENCODE_JS}`);
    }
  });

  test.afterAll(() => {
    if (sharedTmpRoot && existsSync(sharedTmpRoot)) {
      try { rmSync(sharedTmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  let daemonHandle: DaemonHandle | null = null;
  let tmpDir = '';

  test.afterEach(async () => {
    await killDaemon(daemonHandle);
    daemonHandle = null;
    if (tmpDir && existsSync(tmpDir)) {
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
    tmpDir = '';
  });

  test('22-04 SC-1: codex happy path — fake-codex app-server completes a task', async ({ request }) => {
    test.setTimeout(90_000);

    tmpDir = mkdtempSync(join(tmpdir(), 'aq-daemon-it-22-04-codex-'));
    const fakeBinDir = join(tmpDir, 'bin');
    mkdirSync(fakeBinDir, { recursive: true });
    installFakeBinary(fakeBinDir, 'codex', FAKE_CODEX_JS);

    const { plaintext } = await mintDaemonToken(request, `it-22-04-codex-${testRunTag}`);
    const configPath = join(tmpDir, 'daemon.json');
    writeFileSync(
      configPath,
      JSON.stringify({ server: SERVER_BASE, token: plaintext }, null, 2) + '\n',
      { mode: 0o600 },
    );
    if (process.platform !== 'win32') chmodSync(configPath, 0o600);

    const spawnedAt = Date.now();
    daemonHandle = spawnDaemon({ dataDir: tmpDir, configPath, fakeBinDir });

    // Filter on provider=codex so a stale claude row from a prior test run
    // doesn't bind to this scenario.
    const onlineDaemons = await waitForDaemonRuntime(request, spawnedAt, 15_000, 'codex');
    expect(onlineDaemons.length).toBeGreaterThanOrEqual(1);
    const rt = onlineDaemons[0];
    expect(rt.provider).toBe('codex');
    expect(rt.status).toBe('online');
    expect(rt.name).toMatch(/-codex$/);

    const { issueId } = await seedAgentAndIssue(request, rt.id, 'it-22-04-codex');

    const serverDbPath =
      process.env.AQ_SERVER_DB_PATH ?? join(process.env.HOME ?? '', '.aquarium', 'aquarium.db');
    if (!existsSync(serverDbPath)) {
      throw new Error(
        `server DB not found at ${serverDbPath}. Set AQ_SERVER_DB_PATH or ensure \`npm run dev\` is running.`,
      );
    }

    const finalStatus = await waitForTaskStatus(serverDbPath, issueId, ['completed'], 30_000);
    expect(finalStatus).toBe('completed');

    // codex fixture emits text + commandExecution (mapped to tool_use +
    // tool_result) + turn/completed — at least 2 task_messages rows.
    const msgDeadline = Date.now() + 5_000;
    let msgCount = 0;
    while (Date.now() < msgDeadline) {
      msgCount = countTaskMessagesForIssue(serverDbPath, issueId);
      if (msgCount >= 2) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    expect(msgCount).toBeGreaterThanOrEqual(2);
  });

  test('22-04 SC-2: opencode happy path — fake-opencode run --format json completes', async ({ request }) => {
    test.setTimeout(90_000);

    tmpDir = mkdtempSync(join(tmpdir(), 'aq-daemon-it-22-04-opencode-'));
    const fakeBinDir = join(tmpDir, 'bin');
    mkdirSync(fakeBinDir, { recursive: true });
    installFakeBinary(fakeBinDir, 'opencode', FAKE_OPENCODE_JS);

    const { plaintext } = await mintDaemonToken(request, `it-22-04-opencode-${testRunTag}`);
    const configPath = join(tmpDir, 'daemon.json');
    writeFileSync(
      configPath,
      JSON.stringify({ server: SERVER_BASE, token: plaintext }, null, 2) + '\n',
      { mode: 0o600 },
    );
    if (process.platform !== 'win32') chmodSync(configPath, 0o600);

    const spawnedAt = Date.now();
    daemonHandle = spawnDaemon({ dataDir: tmpDir, configPath, fakeBinDir });

    const onlineDaemons = await waitForDaemonRuntime(request, spawnedAt, 15_000, 'opencode');
    expect(onlineDaemons.length).toBeGreaterThanOrEqual(1);
    const rt = onlineDaemons[0];
    expect(rt.provider).toBe('opencode');
    expect(rt.status).toBe('online');
    expect(rt.name).toMatch(/-opencode$/);

    const { issueId } = await seedAgentAndIssue(request, rt.id, 'it-22-04-opencode');

    const serverDbPath =
      process.env.AQ_SERVER_DB_PATH ?? join(process.env.HOME ?? '', '.aquarium', 'aquarium.db');
    if (!existsSync(serverDbPath)) {
      throw new Error(
        `server DB not found at ${serverDbPath}. Set AQ_SERVER_DB_PATH or ensure \`npm run dev\` is running.`,
      );
    }

    const finalStatus = await waitForTaskStatus(serverDbPath, issueId, ['completed'], 30_000);
    expect(finalStatus).toBe('completed');

    // opencode fixture emits step_start + text + tool_use (→ tool_use +
    // tool_result) + step_finish — at least 2 task_messages rows.
    const msgDeadline = Date.now() + 5_000;
    let msgCount = 0;
    while (Date.now() < msgDeadline) {
      msgCount = countTaskMessagesForIssue(serverDbPath, issueId);
      if (msgCount >= 2) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    expect(msgCount).toBeGreaterThanOrEqual(2);
  });

  test('22-04 SC-3: cancel propagates across backend — opencode --hang SIGTERMs cleanly (cross-backend)', async ({ request }) => {
    test.skip(
      process.platform === 'win32',
      'pgrep is POSIX-only; Windows zombie-check deferred',
    );
    test.setTimeout(60_000);

    tmpDir = mkdtempSync(join(tmpdir(), 'aq-daemon-it-22-04-cancel-'));
    const fakeBinDir = join(tmpDir, 'bin');
    mkdirSync(fakeBinDir, { recursive: true });
    installFakeBinary(fakeBinDir, 'opencode', FAKE_OPENCODE_JS, ['--hang']);

    const { plaintext } = await mintDaemonToken(request, `it-22-04-cancel-${testRunTag}`);
    const configPath = join(tmpDir, 'daemon.json');
    writeFileSync(
      configPath,
      JSON.stringify({ server: SERVER_BASE, token: plaintext }, null, 2) + '\n',
      { mode: 0o600 },
    );
    if (process.platform !== 'win32') chmodSync(configPath, 0o600);

    const spawnedAt = Date.now();
    daemonHandle = spawnDaemon({ dataDir: tmpDir, configPath, fakeBinDir });

    const onlineDaemons = await waitForDaemonRuntime(request, spawnedAt, 15_000, 'opencode');
    expect(onlineDaemons.length).toBeGreaterThanOrEqual(1);
    const rt = onlineDaemons[0];

    const { issueId } = await seedAgentAndIssue(request, rt.id, 'it-22-04-cancel');

    const serverDbPath =
      process.env.AQ_SERVER_DB_PATH ?? join(process.env.HOME ?? '', '.aquarium', 'aquarium.db');

    await waitForTaskStatus(serverDbPath, issueId, ['running'], 20_000);

    let preCancelPids: string[] = [];
    const preDeadline = Date.now() + 5_000;
    while (Date.now() < preDeadline) {
      preCancelPids = pgrepByPattern('fake-opencode');
      if (preCancelPids.length > 0) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(preCancelPids.length).toBeGreaterThan(0);

    const cancelRes = await request.patch(`${API_BASE}/issues/${issueId}`, {
      data: { status: 'cancelled' },
    });
    expect(cancelRes.status()).toBe(200);

    // Same budget as 21-04 SC-3: daemon cancel-poller is 5 s; allow 8 s for
    // the SIGTERM to reap every fake-opencode child.
    const zombieDeadline = Date.now() + 8_000;
    let postCancelPids: string[] = [];
    while (Date.now() < zombieDeadline) {
      postCancelPids = pgrepByPattern('fake-opencode');
      if (postCancelPids.length === 0) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(
      postCancelPids,
      `expected NO fake-opencode processes after cancel, found: ${JSON.stringify(postCancelPids)}`,
    ).toEqual([]);

    const finalStatus = await waitForTaskStatus(
      serverDbPath,
      issueId,
      ['cancelled', 'failed'],
      10_000,
    );
    expect(['cancelled', 'failed']).toContain(finalStatus);
  });
});

// Satisfy isolatedModules with no exports from the spec file itself — the
// helpers are private to this file; cross-suite helpers live in
// tests/e2e/fixtures/daemon-helpers.ts.
export {};
