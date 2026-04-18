import { test, expect } from '@playwright/test';
import {
  mkdtempSync,
  writeFileSync,
  chmodSync,
  mkdirSync,
  rmSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  installFakeBinary,
  spawnDaemon,
  killDaemon,
  waitForDaemonRuntime,
  countTaskMessagesForIssue,
  waitForTaskStatus,
  seedAgentAndIssue,
  FAKE_CLAUDE_JS,
  CLI_DIST,
  type DaemonHandle,
} from './fixtures/integration-helpers';
import { API_BASE, mintDaemonToken, signUpAndSignIn } from './fixtures/daemon-helpers';

/**
 * Phase 26-04 — Release-smoke @integration spec covering the daemon half of
 * REL-01 (v1.4 release gate):
 *   (b)               daemon-runtime claim-to-complete happy path via the
 *                     `fake-claude` stub
 *   (e, daemon half)  cancel propagation on a daemon-runtime task leaves no
 *                     zombie child processes
 *
 * Tier: **@integration** — CI-skipped by default; the new `integration-smoke`
 * CI job (Plan 26-02) opts in via the env var documented at the skip guard
 * below. The larger proof surface for these paths lives in
 * `tests/e2e/daemon-integration.spec.ts` (Plan 21-04 SC-1/SC-2/SC-3); this
 * spec is the lean release-gate that keeps the REL-01 smoke run under ~2 min.
 *
 * Preconditions (mirrors the CI integration-smoke job + operator workflow):
 *   - Aquarium server live on :3001 (`npm run dev` locally; CI job spawns a
 *     built-server subprocess and waits on `/api/health`).
 *   - `apps/server/dist/cli.js` built:
 *       `npm run build -w @aquarium/shared && npm run build -w @aquaclawai/aquarium`
 *   - `fake-claude.js` stub at `apps/server/tests/unit/fixtures/fake-claude.js`
 *     (shipped since Plan 21-01, unchanged).
 *
 * Reference: `tests/e2e/daemon-integration.spec.ts` SC-1/SC-2 (happy path) +
 * SC-3 (cancel propagation). This spec intentionally narrows the assertions
 * to the REL-01 contract so release smoke is fast: no crash-log branch
 * (21-04 SC-4 owns that), no cross-backend scenarios (22-04 owns those).
 */

// ── @integration tier guard (matches Plan 26-02's daemon-integration.spec.ts) ─
//
// Plain `CI=true` (the existing `check` job + any PR that didn't trigger the
// integration-smoke job) still skips. The new `integration-smoke` CI job sets
// `AQUARIUM_INTEGRATION=1` in its `env:` block, unlocking this tier.
test.skip(
  process.env.CI === 'true' && process.env.AQUARIUM_INTEGRATION !== '1',
  '@integration tier — opt in via AQUARIUM_INTEGRATION=1 (CI integration-smoke job) or run locally',
);

// ── Serial mode — scenarios share the local dev server + DB state ──
test.describe.configure({ mode: 'serial' });

const SERVER_BASE = process.env.AQ_SERVER_BASE ?? 'http://localhost:3001';

test.describe('@integration Phase 26 release-smoke (daemon) — REL-01', () => {
  const runTag = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  let daemonHandle: DaemonHandle | null = null;
  let tmpDir = '';

  test.beforeAll(async ({ request }) => {
    // Disposable test user — cookie jar on `request` becomes the authenticated
    // session for every subsequent POST/PATCH in this describe block.
    await signUpAndSignIn(request, {
      email: `release-smoke-daemon-${runTag}@e2e.test`,
      password: 'ReleaseSmoke123!',
      displayName: 'Release Smoke Daemon',
    });

    // Fail fast if the dist bundle or stub is missing — otherwise `spawnDaemon`
    // would die with a mysterious ENOENT deep inside a 30 s wait loop.
    if (!existsSync(CLI_DIST)) {
      throw new Error(
        `CLI_DIST not found at ${CLI_DIST}. Run: npm run build -w @aquaclawai/aquarium`,
      );
    }
    if (!existsSync(FAKE_CLAUDE_JS)) {
      throw new Error(
        `fake-claude stub not found at ${FAKE_CLAUDE_JS} — shipped by Plan 21-01`,
      );
    }
  });

  test.afterEach(async () => {
    await killDaemon(daemonHandle);
    daemonHandle = null;
    if (tmpDir && existsSync(tmpDir)) {
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        /* ignore cleanup races */
      }
    }
    tmpDir = '';
  });

  test('sub-criterion 2b: daemon-runtime claim-to-complete happy path via fake-claude', async ({
    request,
  }) => {
    test.setTimeout(120_000);

    // Per-scenario tmpdir doubles as daemon --data-dir AND the fake-binary
    // PATH prefix. Cleaned up in afterEach.
    tmpDir = mkdtempSync(join(tmpdir(), 'aq-rs-2b-'));
    const fakeBinDir = join(tmpDir, 'bin');
    mkdirSync(fakeBinDir, { recursive: true });
    installFakeBinary(fakeBinDir, 'claude', FAKE_CLAUDE_JS);

    // Mint a fresh daemon token + write daemon.json (0o600 per 19-04 SC-5).
    const { plaintext } = await mintDaemonToken(request, `rs-2b-${runTag}`);
    expect(plaintext).toMatch(/^adt_[A-Za-z0-9_-]{32}$/);

    const configPath = join(tmpDir, 'daemon.json');
    writeFileSync(
      configPath,
      JSON.stringify({ server: SERVER_BASE, token: plaintext }, null, 2) + '\n',
      { mode: 0o600 },
    );
    if (process.platform !== 'win32') chmodSync(configPath, 0o600);

    // Capture the wall-clock just BEFORE spawn so waitForDaemonRuntime can
    // ignore any stale online row left behind by a prior local run within the
    // server's 90 s heartbeat window.
    const spawnedAt = Date.now();
    daemonHandle = spawnDaemon({ dataDir: tmpDir, configPath, fakeBinDir });

    // REL-01 step 1: /register lands a local_daemon row with
    // provider='claude' and status='online' within 15 s. Filter on
    // provider=claude so a stale codex/opencode runtime from an earlier
    // local test run can't bind to this scenario.
    const onlineDaemons = await waitForDaemonRuntime(request, spawnedAt, 15_000, 'claude');
    expect(
      onlineDaemons.length,
      `expected at least one online local_daemon runtime (provider=claude), got ${onlineDaemons.length}`,
    ).toBeGreaterThanOrEqual(1);
    const rt = onlineDaemons[0];
    expect(rt.kind).toBe('local_daemon');
    expect(rt.provider).toBe('claude');
    expect(rt.status).toBe('online');

    // REL-01 step 2: assign an issue to a daemon-runtime agent and observe
    // the full claim → stream → complete cycle.
    const { issueId } = await seedAgentAndIssue(request, rt.id, `rs-2b-${runTag}`);

    const serverDbPath =
      process.env.AQ_SERVER_DB_PATH ?? join(process.env.HOME ?? '', '.aquarium', 'aquarium.db');
    if (!existsSync(serverDbPath)) {
      throw new Error(
        `server DB not found at ${serverDbPath}. Set AQ_SERVER_DB_PATH or ensure \`npm run dev\` is running.`,
      );
    }

    const finalStatus = await waitForTaskStatus(serverDbPath, issueId, ['completed'], 30_000);
    expect(finalStatus).toBe('completed');

    // REL-01 step 3: task_messages rows persisted. fake-claude emits 4
    // visible messages (text / tool_use / tool_result / text). Double-stage
    // flush (daemon StreamBatcher 500 ms + server task-message-batcher
    // 500 ms) means the final rows may land up to ~1.5 s after
    // status='completed'; poll for up to 5 s. Assert >= 3 to leave headroom
    // for the final text row without racing it.
    const msgDeadline = Date.now() + 5_000;
    let msgCount = 0;
    while (Date.now() < msgDeadline) {
      msgCount = countTaskMessagesForIssue(serverDbPath, issueId);
      if (msgCount >= 3) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    expect(
      msgCount,
      `expected >=3 task_messages rows for daemon-run issue ${issueId}, got ${msgCount}`,
    ).toBeGreaterThanOrEqual(3);
  });

  // Scenario 2e-daemon (cancel propagation) — implemented by Task 2.
  // The placeholder reserves the describe-block slot + signals intent without
  // running. Replaced by a real test body in Plan 26-04 Task 2.
  test.skip('sub-criterion 2e (daemon): cancel propagation — placeholder replaced by Task 2', () => {
    /* intentionally empty — see Plan 26-04 Task 2 */
  });
});

// Satisfy isolatedModules: the spec does not re-export anything; helpers
// live in `tests/e2e/fixtures/integration-helpers.ts` + `daemon-helpers.ts`.
export {};
