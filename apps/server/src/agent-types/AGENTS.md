# Agent Types — AGENTS.md

> Parent: `../AGENTS.md` (route→service boundary)

## Extension Pattern

Each agent type = directory under `agent-types/` with:

```
agent-types/
├── types.ts           ← AgentTypeManifest + AgentTypeAdapter interfaces
├── registry.ts        ← Map<string, RegisteredAgentType> — central registration
├── openclaw/          ← FULL implementation (manifest + adapter)
│   ├── manifest.ts
│   ├── adapter.ts
│   ├── workspace-templates.ts
│   └── gateway-rpc.ts
├── opencode/          ← STUB (manifest only, no adapter)
│   └── manifest.ts
└── claude-code/       ← STUB (manifest only, no adapter)
    └── manifest.ts
```

## Adding a New Agent Type

1. Create `agent-types/<name>/manifest.ts` — export `const manifest: AgentTypeManifest`
2. (Optional) Create `adapter.ts` — export `const adapter: AgentTypeAdapter`
3. Create `index.ts` — barrel export both
4. Register in `registry.ts`: `registry.set('<name>', { manifest, adapter })`

Frontend wizard, iframe proxy, and usage collector all adapt automatically from manifest fields.

## Manifest Drives Everything

The `AgentTypeManifest.wizard` field controls the creation wizard UI:
- `providers[]`: available AI providers + auth methods + models
- `channelSupport`: which channels to show in setup
- `configFields[]`: additional form fields (dynamic, no frontend hardcoding)

Other manifest sections:
- `webUI`: iframe reverse proxy config (port, basePath, authMethod)
- `usageTracking`: how platform collects LLM token usage (rpc/http/none)
- `image`: container image spec (repository, tag, ports, volumes, healthCheck)

## Adapter Interface (5 Methods)

| Method | Called By | Purpose |
|--------|-----------|---------|
| `seedConfig` | instance-manager `startInstanceAsync`, `reseedConfigFiles` | Generate config files from instance config + credentials |
| `categorizeConfigFiles` | instance-manager `startInstanceAsync` | Split into `alwaysOverwrite` vs `seedIfAbsent` |
| `resolveEnv` | instance-manager `startInstanceAsync` | Map credentials → container env vars. Dual-mode: platform (LiteLLM key) vs byok (raw API keys) |
| `translateRPC` | instance-manager `patchGatewayConfig` | Translate platform RPC → gateway-specific format |
| `checkReady` | health-monitor | Custom readiness beyond HTTP health check |

## Gotcha: Stub Types

`opencode` and `claude-code` have manifests but NO adapters. Code that calls `adapter.seedConfig()` must null-check: `agentType.adapter?.seedConfig?.(...)`. The registry returns `{ manifest, adapter?: AgentTypeAdapter }`.
