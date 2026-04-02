# Services — AGENTS.md

> Parent: `../AGENTS.md` (route→service boundary, entry point)

## Service Map

| Service | Role | Singleton? | Startup? |
|---------|------|-----------|----------|
| `instance-manager.ts` | Instance lifecycle orchestration | Stateless functions | No |
| `health-monitor.ts` | Dual-speed health polling | Yes (start/stop) | Yes — after reconciliation |
| `gateway-event-relay.ts` | WS relay to gateway instances | Yes (start/stop) | Yes — after health monitor |
| `credential-store.ts` | AES-256-GCM encrypt/decrypt | Stateless functions | No |
| `user-credential-store.ts` | User vault + 3-layer resolution | Stateless functions | No |
| `template-store.ts` | Template CRUD, fork, instantiate | Stateless functions | No |
| `group-chat-manager.ts` | Multi-agent chat routing | Stateless functions | No |
| `litellm-client.ts` | HTTP client to LiteLLM proxy | Stateless functions | No |
| `litellm-key-manager.ts` | Virtual key create/revoke | Stateless functions | No |
| `metadata-store.ts` | Instance metadata CRUD | Stateless functions | No |
| `config-validator.ts` | Config file validation | Stateless functions | No |
| `snapshot-store.ts` | Config snapshots for rollback | Stateless functions | No |

## instance-manager.ts (Core)

Orchestrates: credential resolution → LiteLLM key → env vars → config seeding → container start.

Key flows:
- `startInstance`: resolveCredentials → createLiteLLMKey → adapter.resolveEnv → adapter.seedConfig → runtime.startContainer
- `stopInstance`: runtime.stopContainer → revokeLiteLLMKey → update status
- `reseedConfigFiles`: re-generates config without restart (used by health-monitor auto-recovery)

**Critical**: Only place that transitions instance state. Never update `instances.status` directly via knex.

## health-monitor.ts

Two polling loops:
- **Fast (5s)**: `starting` instances — checks `/health` endpoint, transitions to `running` on success
- **Slow (30s)**: `running`/`error` instances — detects crashes, triggers auto-recovery

Auto-recovery: if instance is `error` but runtime container is healthy → flip to `running` + re-seed `alwaysOverwrite` config files (openclaw.json, auth-profiles.json). Does NOT overwrite workspace files (SOUL.md etc.) since agent may have modified them.

## LiteLLM Integration

Two billing modes drive different env var injection:

```
platform mode: LITELLM_PROXY_URL + virtual key → adapter writes key into auth-profiles.json and injects LITELLM_PROXY_URL env var
byok mode:     user's own API key → adapter sets provider-native env vars directly
```

- `litellm-client.ts`: wraps HTTP calls to `LITELLM_PROXY_URL` (/key/generate, /key/delete, /global/spend/logs)
- `litellm-key-manager.ts`: creates virtual key on start, revokes on stop. Key metadata includes instanceId + userId for spend tracking.

## Credential Resolution (3-Layer)

Template `${CREDENTIAL:provider:type}` placeholders resolve in order:
1. Instance-level credential (encrypted in `instance_credentials`)
2. User vault credential (encrypted in `user_credentials`)
3. Error — missing credential reported to user

Resolution happens in `user-credential-store.ts` → called by `instance-manager.ts` during start.

## gateway-event-relay.ts

Maintains persistent WS connections to ALL running gateway instances.
- `client.id` MUST be `'gateway-client'` — hardcoded constant (gateway schema rejects others)
- Relays events (QR codes, channel status, chat messages) to platform WS → frontend
- Reconnects on disconnect with exponential backoff
