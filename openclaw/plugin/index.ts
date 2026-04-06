import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";

const plugin = {
  id: "platform-bridge",
  name: "Platform Bridge",
  description: "Bridge for platform management: health check and runtime info",
  configSchema: emptyPluginConfigSchema(),

  register(api: OpenClawPluginApi) {
    api.registerGatewayMethod("platform.ping", async ({ respond }: any) => {
      respond(true, { ts: Date.now(), ok: true });
    });

    api.registerGatewayMethod("platform.runtime", async ({ respond }: any) => {
      respond(true, {
        uptime: process.uptime(),
        nodeVersion: process.version,
        platform: process.platform,
        memoryUsage: process.memoryUsage().rss,
        ts: Date.now(),
      });
    });
  },
};

export default plugin;
