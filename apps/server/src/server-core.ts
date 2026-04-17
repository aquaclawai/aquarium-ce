import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createServer } from 'node:http';
import type { Server as HttpServer } from 'node:http';
import { config } from './config.js';
import { db } from './db/index.js';
import { setupWebSocket } from './ws/index.js';
import { reconcileInstances } from './services/instance-manager.js';
import { recoverOrphanedOperations } from './services/extension-lifecycle.js';
import { getRuntimeEngine } from './runtime/factory.js';
import { startHealthMonitor } from './services/health-monitor.js';
import { startGatewayEventRelay } from './services/gateway-event-relay.js';
import { runDailySnapshots } from './services/snapshot-store.js';
import { reconcileFromInstances as runtimeBridgeReconcile } from './task-dispatch/runtime-bridge.js';
import { startRuntimeOfflineSweeper } from './task-dispatch/offline-sweeper.js';
import { startTaskReaper } from './task-dispatch/task-reaper.js';
import { startTaskMessageBatcher } from './task-dispatch/task-message-batcher.js';
import { failOrphanedHostedTasks } from './task-dispatch/hosted-orphan-sweep.js';
import { startHostedTaskWorker } from './task-dispatch/hosted-task-worker.js';
import {
  dynamicCors,
  dynamicGeneralLimiter,
  dynamicLoginLimiter,
  dynamicCredentialsLimiter,
  reloadDynamicMiddleware,
} from './middleware/dynamic-middleware.js';
import authRoutes from './routes/auth.js';
import instanceRoutes from './routes/instances.js';
import credentialRoutes from './routes/credentials.js';
import agentTypeRoutes from './routes/agent-types.js';
import rpcProxyRoutes from './routes/rpc-proxy.js';
import oauthRoutes from './routes/oauth.js';
import channelRoutes from './routes/channels.js';
import adminRoutes from './routes/admin.js';
import templateRoutes from './routes/templates.js';
import userCredentialRoutes from './routes/user-credentials.js';
import groupChatRoutes from './routes/group-chats.js';
import metadataRoutes from './routes/metadata.js';
import userRoutes from './routes/users.js';
import notificationsRoutes from './routes/notifications.js';
import skillRoutes from './routes/skills.js';
import pluginRoutes from './routes/plugins.js';
import extensionCredentialRoutes from './routes/extension-credentials.js';
import oauthProxyRoutes from './routes/oauth-proxy.js';
import trustOverrideRoutes from './routes/trust-overrides.js';
import execApprovalRoutes from './routes/exec-approval.js';
import securityRoutes from './routes/security.js';
import dashboardRoutes from './routes/dashboard.js';
import systemConfigRoutes from './routes/system-config.js';
import snapshotRoutes from './routes/snapshots.js';
import instanceFilesRoutes from './routes/instance-files.js';
import uiProxyRoutes from './routes/ui-proxy.js';
import runtimeRoutes from './routes/runtimes.js';
import agentRoutes from './routes/agents.js';
import issueRoutes from './routes/issues.js';
import commentRoutes, { issueCommentRouter } from './routes/comments.js';
import daemonRoutes from './routes/daemon.js';
import daemonTokenRoutes from './routes/daemon-tokens.js';
import { attachWebSocketProxy } from './routes/instance-proxy.js';
import { getInstance } from './services/instance-manager.js';
import type { AuthPayload } from './middleware/auth.js';

export interface CreateAppOptions {
  /** Additional CSP domains for EE (e.g. Clerk). */
  extraCspDomains?: {
    scriptSrc?: string[];
    connectSrc?: string[];
    imgSrc?: string[];
    frameSrc?: string[];
  };
  /** Token verifier for the WebSocket proxy. CE can pass a simple JWT verifier; EE passes verifyClerkToken. */
  tokenVerifier?: (token: string) => Promise<AuthPayload | null> | AuthPayload | null;
}

export interface StartServerOptions {
  /** Called after migrations complete (e.g. EE seeds LiteLLM models). */
  onAfterMigrate?: () => Promise<void>;
  /** Called just before the server starts listening (e.g. EE starts budget enforcer). */
  onBeforeListen?: () => Promise<void>;
}

export function createApp(options: CreateAppOptions = {}): { app: express.Application; server: HttpServer } {
  const { extraCspDomains = {}, tokenVerifier } = options;

  const app = express();

  // Trust proxy headers from GKE ingress / load balancer
  app.set('trust proxy', 1);

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", ...(extraCspDomains.scriptSrc ?? [])],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        imgSrc: ["'self'", "data:", "blob:", ...(extraCspDomains.imgSrc ?? [])],
        connectSrc: ["'self'", "wss:", "ws:", ...(extraCspDomains.connectSrc ?? [])],
        workerSrc: ["'self'", "blob:"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        objectSrc: ["'none'"],
        frameAncestors: ["'self'"],
        frameSrc: ["'self'", ...(extraCspDomains.frameSrc ?? [])],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
  }));

  app.use(dynamicCors);
  app.use(cookieParser());
  app.use(express.json({ limit: '10mb' }));

  // Health check must be before any auth-guarded routers (e.g. securityRoutes on /api)
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, ts: Date.now() });
  });

  // §6.2 API rate limiting (disabled in development for E2E tests)
  if (config.nodeEnv === 'production') {
    app.use('/api/', rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 300,
      standardHeaders: true,
      legacyHeaders: false,
      validate: { trustProxy: false, xForwardedForHeader: false },
      // DAEMON-08: daemon polling must not be throttled by the global user-IP
      // bucket. /api/daemon/* has its own per-token bucket mounted inside
      // routes/daemon.ts (keyed on tokenHash, 1000/60s).
      skip: (req) => req.originalUrl.startsWith('/api/daemon/'),
    }));

    app.use('/api/auth/login', rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 100,
      skipSuccessfulRequests: true,
      standardHeaders: true,
      legacyHeaders: false,
      validate: { trustProxy: false, xForwardedForHeader: false },
    }));

    app.use('/api/credentials', rateLimit({
      windowMs: 60 * 1000,
      max: 30,
      standardHeaders: true,
      legacyHeaders: false,
      validate: { trustProxy: false, xForwardedForHeader: false },
    }));
  }

  // Dynamic rate limiters (admin-configurable) — also disabled in development for E2E tests
  if (config.nodeEnv === 'production') {
    // DAEMON-08: wrap the admin-configurable general limiter so `/api/daemon/*`
    // skips it. Daemon traffic uses the per-token bucket inside routes/daemon.ts.
    app.use('/api/', (req, res, next) => {
      if (req.originalUrl.startsWith('/api/daemon/')) {
        next();
        return;
      }
      dynamicGeneralLimiter(req, res, next);
    });
    app.use('/api/auth/login', dynamicLoginLimiter);
    app.use('/api/credentials', dynamicCredentialsLimiter);
  }

  // Shared routes (both CE and EE)
  app.use('/api/auth', authRoutes);
  app.use('/api/instances', instanceRoutes);
  app.use('/api/runtimes', runtimeRoutes);
  app.use('/api/agents', agentRoutes);
  app.use('/api/issues', issueRoutes);
  app.use('/api/issues/:issueId/comments', issueCommentRouter);
  app.use('/api/comments', commentRoutes);
  // Phase 19: daemon REST surface — authenticated with `adt_*` bearer only
  // (requireDaemonAuth is mounted inside the router). `/api/daemon/*` is
  // exempt from the two global `/api/` rate limiters above; its own
  // per-token bucket (DAEMON-08) is mounted inside routes/daemon.ts.
  app.use('/api/daemon', daemonRoutes);
  // Phase 19-03: user-facing daemon-token management (cookie-JWT authed via
  // `requireAuth` inside the router — AUTH1 rejects `adt_*` bearers here).
  app.use('/api/daemon-tokens', daemonTokenRoutes);
  app.use('/api/instances', credentialRoutes);
  app.use('/api/instances', rpcProxyRoutes);
  app.use('/api/agent-types', agentTypeRoutes);
  app.use('/api/oauth', oauthRoutes);
  app.use('/api/instances', channelRoutes);
  app.use('/api/admin/config', systemConfigRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/templates', templateRoutes);
  app.use('/api/credentials', userCredentialRoutes);
  app.use('/api/group-chats', groupChatRoutes);
  app.use('/api/metadata', metadataRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/notifications', notificationsRoutes);
  app.use('/api/instances', skillRoutes);
  app.use('/api/instances', pluginRoutes);
  app.use('/api/instances', extensionCredentialRoutes);
  app.use('/api/instances', oauthProxyRoutes);
  app.use('/api/instances', trustOverrideRoutes);
  app.use('/api/instances', execApprovalRoutes);
  app.use('/api', securityRoutes);
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/instances/:id/snapshots', snapshotRoutes);
  app.use('/api/instances', instanceFilesRoutes);
  app.use('/api/instances', uiProxyRoutes);
  // Note: instanceProxyRoutes registered LAST under /api/instances (catch-all patterns)
  // EE entry will register geoToolsRoutes before instanceProxyRoutes

  const __dirname = dirname(fileURLToPath(import.meta.url));
  // Try npm package path first (dist/web-dist/), then monorepo path (../../web/dist)
  const webDistCandidates = [
    join(__dirname, 'web-dist'),        // npm package layout
    join(__dirname, '../../web/dist'),  // monorepo layout
  ];
  const webDistPath = webDistCandidates.find(p => existsSync(p));
  if (webDistPath) {
    app.use(express.static(webDistPath));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/ws')) return next();
      res.sendFile(join(webDistPath, 'index.html'));
    });
  }

  const server = createServer(app);
  setupWebSocket(server);
  attachWebSocketProxy(
    server,
    (id, userId) => getInstance(id, userId),
    tokenVerifier ?? (async () => null),
  );

  return { app, server };
}

export async function startServer(server: HttpServer, options: StartServerOptions = {}): Promise<void> {
  try {
    const migrationDirs = [
      fileURLToPath(new URL('./db/migrations', import.meta.url)),
    ];
    if (config.isEE) {
      migrationDirs.push(
        fileURLToPath(new URL('./db/migrations/ee', import.meta.url)),
      );
    }

    // Load .ts when running from source (tsx), .js when running from dist/.
    const runningFromDist = import.meta.url.includes('/dist/');
    await db.migrate.latest({
      directory: migrationDirs,
      loadExtensions: [runningFromDist ? '.js' : '.ts'],
    });

    // CE: apply + assert SQLite concurrency PRAGMAs (SCH-09; pitfalls SQ1, SQ5).
    // Must run after migrations (so DB file exists) and before downstream
    // reconciliation / health monitor / instance work touches the DB.
    if (config.isCE) {
      const { getAdapter } = await import('./db/adapter.js');
      const adapter = getAdapter();
      if (adapter.applyBootPragmas) {
        await adapter.applyBootPragmas(db);
      }
    }

    await options.onAfterMigrate?.();

    // CE mode: ensure a default admin user exists (single-user self-hosted)
    if (config.isCE) {
      const existingUser = await db('users').first();
      if (!existingUser) {
        const { getAdapter } = await import('./db/adapter.js');
        const adapter = getAdapter();
        await db('users').insert({
          id: adapter.generateId(),
          email: 'admin@localhost',
          password_hash: 'ce-no-auth',
          display_name: 'Admin',
          role: 'admin',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        console.log('[CE] Created default admin user: admin@localhost');
      }
    }

    await reloadDynamicMiddleware();

    await recoverOrphanedOperations();
    console.log('[startup] Extension orphan recovery complete');

    await reconcileInstances();

    const engine = getRuntimeEngine(config.defaultDeploymentTarget);
    if (engine.cleanupOrphanNetworks) {
      await engine.cleanupOrphanNetworks();
    }

    startHealthMonitor();
    startGatewayEventRelay();

    // Step 9a: initial runtime-bridge reconcile (mirrors existing instances into the
    // `runtimes` table as `hosted_instance` rows). Awaited so the first HTTP request
    // after server.listen sees the full mirror (RT-03 "within 2s" SLA).
    try {
      await runtimeBridgeReconcile();
    } catch (err) {
      console.warn('[startup] initial runtime-bridge reconcile failed:', err instanceof Error ? err.message : String(err));
    }

    // Step 9a (continued): 10s safety-net loop. Catches any instance write path
    // that forgets to call the explicit hooks (16-RESEARCH §"Why hybrid (hook + poll)").
    // The interval lives in server-core (not inside runtime-bridge.ts) so every
    // platform timer is visible in one file.
    setInterval(() => {
      runtimeBridgeReconcile().catch((err) => {
        console.warn('[runtime-bridge] reconcile failed:', err instanceof Error ? err.message : String(err));
      });
    }, 10_000);

    // Step 9b: hosted-orphan sweep — fails all hosted_instance tasks in
    // dispatched/running state with reason 'hosted-orphan-on-boot'. Must run
    // BEFORE startTaskReaper (Step 9c) so hosted orphans don't get the
    // generic "Reaper: dispatched > 5 min without start" error after the
    // 5-min threshold elapses (HOSTED-04 + 20-RESEARCH §Boot Orphan Cleanup).
    // Inner try/catch: a failed sweep must NOT block server.listen; the
    // task-reaper will eventually catch any missed rows with the generic
    // error as a fallback.
    try {
      const { failed } = await failOrphanedHostedTasks();
      if (failed > 0) {
        console.log(`[startup] failed ${failed} hosted-orphan task(s) on boot`);
      }
    } catch (err) {
      console.warn(
        '[startup] hosted-orphan sweep failed:',
        err instanceof Error ? err.message : String(err),
      );
    }

    // Step 9c: task reaper — fails tasks stuck in dispatched > 5 min or running > 2.5 h
    // (cleans up after daemon crashes between claim and start, or mid-task deadlocks).
    // Must start BEFORE server.listen so a stale task from a previous server crash
    // is already being reaped when the first daemon registers.
    startTaskReaper();

    // Step 9c.1: task_messages batcher — 500 ms tick that flushes the
    // in-memory buffer populated by the daemon /tasks/:id/messages endpoint
    // to the `task_messages` table. Without this, the batcher's internal
    // Map grows unbounded and no messages are ever persisted. Discovered as
    // a pre-existing gap during Phase 21-04 integration testing (Rule 3
    // blocker — SC-2 asserts ≥ 3 task_messages rows, which is only possible
    // once this ticker runs).
    startTaskMessageBatcher();

    // Step 9d: hosted-task worker — 2s tick that dispatches queued tasks for
    // online hosted_instance runtimes via gatewayCall('chat.send', ...)
    // (HOSTED-01/02/03). Must start AFTER startTaskReaper (Step 9c) so by
    // the time the first tick fires, the DB is clean (Step 9b fails boot
    // orphans; Step 9c's initial sweep reaps any residual daemon staleness).
    startHostedTaskWorker();

    // Step 9e: offline sweeper — flips daemon runtimes whose last_heartbeat_at
    // is > 90s old to status='offline'. Does NOT touch hosted_instance rows (ST1).
    startRuntimeOfflineSweeper();

    // Boot-order recap after Phase 20:
    //   9a runtimeBridgeReconcile    — mirrors instances → runtimes.hosted_instance
    //   9b failOrphanedHostedTasks   — Phase 20: HOSTED-04 boot cleanup
    //   9c startTaskReaper           — Phase 18 generic stale-task reaper
    //   9d startHostedTaskWorker     — Phase 20: HOSTED-01..03,05,06 dispatch
    //   9e startRuntimeOfflineSweeper — Phase 16: daemon heartbeat → offline

    setInterval(async () => {
      console.log('[Scheduler] Running daily snapshots...');
      const result = await runDailySnapshots();
      console.log(`[Scheduler] Daily snapshots: ${result.created} created, ${result.failed} failed`);
    }, 24 * 60 * 60 * 1000);

    await options.onBeforeListen?.();

    server.listen(config.port, () => {
      console.log(`Server listening on port ${config.port}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}
