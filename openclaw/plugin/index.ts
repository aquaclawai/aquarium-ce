import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import * as fs from "fs";
import * as path from "path";

// ─── Workspace Templates ──────────────────────────────────────────────────────

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

// ─── Extension State ──────────────────────────────────────────────────────────

interface InstalledExtension {
  id: string;
  name: string;
  description: string;
  version: string;
  category: string;
  kind: "skill" | "plugin";
  source: Record<string, unknown>;
  integrityHash: string;
  enabled: boolean;
  installedAt: string;
}

interface ExtensionState {
  skills: InstalledExtension[];
  plugins: InstalledExtension[];
}

function getStatePath(): string {
  const homeDir = process.env.HOME || "/home/node";
  return path.join(homeDir, ".openclaw", "extension-state.json");
}

function loadState(): ExtensionState {
  try {
    const raw = fs.readFileSync(getStatePath(), "utf8");
    return JSON.parse(raw) as ExtensionState;
  } catch {
    return { skills: [], plugins: [] };
  }
}


// ─── Built-in Registry (CE catalog) ──────────────────────────────────────────

interface RegistryEntry {
  id: string;
  name: string;
  description: string;
  version: string;
  kind: "skill" | "plugin";
  publisher: string;
  category: string;
  trustSignals: {
    verifiedPublisher: boolean;
    downloadCount: number;
    ageInDays: number;
    virusTotalPassed: boolean | null;
  };
  requiredCredentials: Array<{
    field: string;
    label: string;
    type: "api_key" | "env_var" | "oauth_token";
    required: boolean;
    description?: string;
  }>;
  capabilities?: string[];
  requiredBinaries?: string[];
  hasScripts?: boolean;
}

const BUILTIN_REGISTRY: RegistryEntry[] = [
  {
    id: "web-search",
    name: "Web Search",
    description: "Search the web using DuckDuckGo or Google. Enables the agent to find current information, articles, and documentation.",
    version: "1.0.0",
    kind: "skill",
    publisher: "openclaw",
    category: "search",
    trustSignals: { verifiedPublisher: true, downloadCount: 12400, ageInDays: 180, virusTotalPassed: true },
    requiredCredentials: [],
    requiredBinaries: [],
  },
  {
    id: "web-browse",
    name: "Web Browser",
    description: "Fetch and read web pages, extract content from URLs. Enables the agent to browse documentation, articles, and online resources.",
    version: "1.0.0",
    kind: "skill",
    publisher: "openclaw",
    category: "search",
    trustSignals: { verifiedPublisher: true, downloadCount: 9800, ageInDays: 160, virusTotalPassed: true },
    requiredCredentials: [],
    requiredBinaries: [],
  },
  {
    id: "code-interpreter",
    name: "Code Interpreter",
    description: "Execute Python code in a sandboxed environment. Run scripts, analyze data, generate charts, and process files.",
    version: "1.0.0",
    kind: "skill",
    publisher: "openclaw",
    category: "development",
    trustSignals: { verifiedPublisher: true, downloadCount: 15200, ageInDays: 200, virusTotalPassed: true },
    requiredCredentials: [],
    requiredBinaries: ["python3"],
  },
  {
    id: "file-manager",
    name: "File Manager",
    description: "Read, write, and manage files in the agent workspace. Supports text, JSON, CSV, and binary files.",
    version: "1.0.0",
    kind: "skill",
    publisher: "openclaw",
    category: "utility",
    trustSignals: { verifiedPublisher: true, downloadCount: 11000, ageInDays: 190, virusTotalPassed: true },
    requiredCredentials: [],
    requiredBinaries: [],
  },
  {
    id: "image-generation",
    name: "Image Generation",
    description: "Generate images from text prompts using OpenAI DALL-E or Stability AI. Create illustrations, diagrams, and visual content.",
    version: "1.0.0",
    kind: "skill",
    publisher: "openclaw",
    category: "media",
    trustSignals: { verifiedPublisher: true, downloadCount: 7600, ageInDays: 140, virusTotalPassed: true },
    requiredCredentials: [
      { field: "openai_api_key", label: "OpenAI API Key", type: "api_key", required: true, description: "API key for DALL-E image generation" },
    ],
    requiredBinaries: [],
  },
  {
    id: "spreadsheet",
    name: "Spreadsheet",
    description: "Read and write Excel (.xlsx) and CSV files. Analyze tabular data, create reports, and manipulate spreadsheets.",
    version: "1.0.0",
    kind: "skill",
    publisher: "openclaw",
    category: "data",
    trustSignals: { verifiedPublisher: true, downloadCount: 5400, ageInDays: 120, virusTotalPassed: true },
    requiredCredentials: [],
    requiredBinaries: ["python3"],
    hasScripts: true,
  },
  {
    id: "email-sender",
    name: "Email Sender",
    description: "Send emails via SMTP or API. Supports HTML content, attachments, and template-based emails.",
    version: "1.0.0",
    kind: "skill",
    publisher: "openclaw",
    category: "communication",
    trustSignals: { verifiedPublisher: true, downloadCount: 4200, ageInDays: 100, virusTotalPassed: true },
    requiredCredentials: [
      { field: "smtp_password", label: "SMTP Password", type: "api_key", required: true, description: "SMTP server password or app-specific password" },
    ],
    requiredBinaries: [],
  },
  {
    id: "webhook-plugin",
    name: "Webhook Integration",
    description: "Receive and process incoming webhooks. Trigger agent actions from external services like GitHub, Stripe, or Zapier.",
    version: "1.0.0",
    kind: "plugin",
    publisher: "openclaw",
    category: "integration",
    trustSignals: { verifiedPublisher: true, downloadCount: 6300, ageInDays: 150, virusTotalPassed: true },
    requiredCredentials: [],
    capabilities: ["webhook-receiver", "event-trigger"],
  },
  {
    id: "scheduler-plugin",
    name: "Task Scheduler",
    description: "Schedule recurring tasks and cron jobs for the agent. Automate periodic checks, reports, and maintenance.",
    version: "1.0.0",
    kind: "plugin",
    publisher: "openclaw",
    category: "automation",
    trustSignals: { verifiedPublisher: true, downloadCount: 4800, ageInDays: 130, virusTotalPassed: true },
    requiredCredentials: [],
    capabilities: ["cron-scheduler", "task-queue"],
  },
  {
    id: "knowledge-base-plugin",
    name: "Knowledge Base",
    description: "Index and search documents for RAG (Retrieval-Augmented Generation). Upload PDFs, docs, and text files to build a searchable knowledge base.",
    version: "1.0.0",
    kind: "plugin",
    publisher: "openclaw",
    category: "data",
    trustSignals: { verifiedPublisher: true, downloadCount: 8900, ageInDays: 170, virusTotalPassed: true },
    requiredCredentials: [],
    capabilities: ["document-index", "vector-search", "rag"],
  },
  {
    id: "api-connector-plugin",
    name: "API Connector",
    description: "Connect to external REST APIs with configurable authentication. Define custom API endpoints the agent can call.",
    version: "1.0.0",
    kind: "plugin",
    publisher: "openclaw",
    category: "integration",
    trustSignals: { verifiedPublisher: true, downloadCount: 7100, ageInDays: 155, virusTotalPassed: true },
    requiredCredentials: [],
    capabilities: ["rest-client", "oauth-flow", "api-proxy"],
  },
];

// ─── ClawHub Proxy ────────────────────────────────────────────────────────────

const CLAWHUB_API_URL = process.env.CLAWHUB_API_URL || "";

async function fetchClawHub(endpoint: string, params: Record<string, unknown>): Promise<unknown> {
  if (!CLAWHUB_API_URL) return null;
  const url = new URL(endpoint, CLAWHUB_API_URL);
  const resp = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) return null;
  return resp.json();
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

const plugin = {
  id: "platform-bridge",
  name: "Platform Bridge",
  description: "Bridge for platform management: workspace init, extension lifecycle, and marketplace integration",
  configSchema: emptyPluginConfigSchema(),

  register(api: OpenClawPluginApi) {
    // ── Platform Methods ────────────────────────────────────────────────────

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

    // ── Skills Methods ──────────────────────────────────────────────────────

    api.registerGatewayMethod("skills.list", async ({ respond }: any) => {
      try {
        const state = loadState();
        const entries = state.skills.map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          version: s.version,
          category: s.category,
          source: "installed",
          enabled: s.enabled,
        }));
        respond(true, entries);
      } catch (error: any) {
        respond(false, { error: error.message });
      }
    });

    // ── Plugins Methods ─────────────────────────────────────────────────────
    // NOTE: skills.install and skills.uninstall removed -- gateway handles these natively.
    // Registering them here caused method name conflicts that prevented plugin loading (PLUGFIX-01).

    api.registerGatewayMethod("plugins.list", async ({ respond }: any) => {
      try {
        const state = loadState();
        const entries = state.plugins.map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          version: p.version,
          category: p.category,
          source: "installed",
          enabled: p.enabled,
        }));
        respond(true, entries);
      } catch (error: any) {
        respond(false, { error: error.message });
      }
    });

    // NOTE: plugins.install and plugins.uninstall removed -- gateway handles these natively.
    // The plugin version was also corrupting gateway config by writing bad paths (PLUGFIX-02).

    // ── ClawHub Marketplace Methods ─────────────────────────────────────────

    api.registerGatewayMethod("clawhub.search", async ({ params, respond }: any) => {
      try {
        const { query, category, kind, limit = 20, offset = 0 } = params || {};

        // Try remote ClawHub API first
        if (CLAWHUB_API_URL) {
          const remote = await fetchClawHub("/api/search", params);
          if (remote && typeof remote === "object") {
            respond(true, remote);
            return;
          }
        }

        // Fall back to built-in registry
        let entries = BUILTIN_REGISTRY.filter((e) => {
          if (kind && e.kind !== kind) return false;
          if (category && e.category !== category) return false;
          if (query) {
            const q = query.toLowerCase();
            return (
              e.name.toLowerCase().includes(q) ||
              e.description.toLowerCase().includes(q) ||
              e.id.toLowerCase().includes(q)
            );
          }
          return true;
        });

        const total = entries.length;
        entries = entries.slice(offset, offset + limit);

        respond(true, { entries, total });
      } catch (error: any) {
        respond(false, { error: error.message });
      }
    });

    api.registerGatewayMethod("clawhub.info", async ({ params, respond }: any) => {
      try {
        const { extensionId, kind } = params || {};
        if (!extensionId) {
          respond(false, { error: "extensionId is required" });
          return;
        }

        // Try remote ClawHub API first
        if (CLAWHUB_API_URL) {
          const remote = await fetchClawHub("/api/info", params);
          if (remote && typeof remote === "object") {
            respond(true, remote);
            return;
          }
        }

        // Fall back to built-in registry
        const entry = BUILTIN_REGISTRY.find(
          (e) => e.id === extensionId && (!kind || e.kind === kind),
        );

        if (!entry) {
          respond(false, { error: `Extension not found: ${extensionId}` });
          return;
        }

        respond(true, entry);
      } catch (error: any) {
        respond(false, { error: error.message });
      }
    });
  },
};

export default plugin;
