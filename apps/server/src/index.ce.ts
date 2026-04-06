import 'dotenv/config';
import { installLogRedaction } from './middleware/log-redaction.js';
installLogRedaction();

import { createApp, startServer } from './server-core.js';
import instanceProxyRoutes from './routes/instance-proxy.js';
import { db } from './db/index.js';

const { app, server } = createApp({
  tokenVerifier: async (token: string) => {
    // CE cookie format: "test:<userId>"
    if (token.startsWith('test:')) {
      const userId = token.slice(5);
      const row = await db('users').where({ id: userId }).select('id', 'email').first() as { id: string; email: string } | undefined;
      return row ? { userId: row.id, email: row.email } : null;
    }
    // Fallback: auto-auth as first user (single-user self-hosted)
    const firstUser = await db('users').select('id', 'email').first() as { id: string; email: string } | undefined;
    return firstUser ? { userId: firstUser.id, email: firstUser.email } : null;
  },
});

// Instance proxy catch-all (must be last under /api/instances)
app.use('/api/instances', instanceProxyRoutes);

await startServer(server);
