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
import trustOverrideRoutes from './routes/trust-overrides.js';
import execApprovalRoutes from './routes/exec-approval.js';
import securityRoutes from './routes/security.js';
import dashboardRoutes from './routes/dashboard.js';
import systemConfigRoutes from './routes/system-config.js';
import snapshotRoutes from './routes/snapshots.js';
import instanceFilesRoutes from './routes/instance-files.js';
import uiProxyRoutes from './routes/ui-proxy.js';
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
    app.use('/api/', dynamicGeneralLimiter);
    app.use('/api/auth/login', dynamicLoginLimiter);
    app.use('/api/credentials', dynamicCredentialsLimiter);
  }

  // Shared routes (both CE and EE)
  app.use('/api/auth', authRoutes);
  app.use('/api/instances', instanceRoutes);
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

    // Detect whether we're running from compiled dist/ or source src/.
    // When running from dist/ (e.g. node dist/cli.js), migrations are .js files.
    // When running from src/ via tsx, migrations are .ts files.
    const runningFromDist = import.meta.url.includes('/dist/');
    await db.migrate.latest({
      directory: migrationDirs,
      loadExtensions: [runningFromDist ? '.js' : '.ts'],
    });

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
