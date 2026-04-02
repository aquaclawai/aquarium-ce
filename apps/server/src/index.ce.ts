import 'dotenv/config';
import { installLogRedaction } from './middleware/log-redaction.js';
installLogRedaction();

import { createApp, startServer } from './server-core.js';
import instanceProxyRoutes from './routes/instance-proxy.js';

const { app, server } = createApp({
  // CE: no Clerk CSP domains, no-op token verifier (uses cookie/JWT auth)
});

// Instance proxy catch-all (must be last under /api/instances)
app.use('/api/instances', instanceProxyRoutes);

await startServer(server);
