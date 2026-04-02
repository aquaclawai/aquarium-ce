import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import * as fs from "fs";
import * as path from "path";

const DEFAULT_TEMPLATES: Record<string, string> = {
  "AGENTS.md": `# Agents

Define your AI agents here.

## Main Agent

The default agent for handling conversations.
`,
  "SOUL.md": `# Soul

The core identity and purpose of your system.
`,
  "TOOLS.md": `# Tools

External tools and integrations available to your agents.
`,
  "IDENTITY.md": `# Identity

Who your system is and how it presents itself.
`,
  "USER.md": `# User

Information about the user or context for personalization.
`,
  "BOOTSTRAP.md": `# Bootstrap

Initial setup and configuration for the agent.
`,
};

const plugin = {
  id: "platform-bridge",
  name: "Platform Bridge",
  description: "Minimal bridge for platform management operations with workspace initialization",
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

    api.registerGatewayMethod("agents.workspace.init", async ({ params, respond }: any) => {
      try {
        const agentId = params?.agentId || "main";
        const homeDir = process.env.HOME || "/home/node";
        const workspaceDir = path.join(homeDir, ".openclaw", "workspace", agentId);
        
        if (!fs.existsSync(workspaceDir)) {
          fs.mkdirSync(workspaceDir, { recursive: true });
        }
        
        const createdFiles: string[] = [];
        for (const [fileName, content] of Object.entries(DEFAULT_TEMPLATES)) {
          const filePath = path.join(workspaceDir, fileName);
          if (!fs.existsSync(filePath)) {
            fs.writeFileSync(filePath, content, "utf8");
            createdFiles.push(fileName);
          }
        }
        
        respond(true, {
          success: true,
          agentId,
          createdFiles,
          message: `Initialized workspace for agent '${agentId}' with ${createdFiles.length} default files`,
        });
      } catch (error: any) {
        const message = error instanceof Error ? error.message : String(error);
        respond(false, { error: `Failed to initialize workspace: ${message}` });
      }
    });
  },
};

export default plugin;
