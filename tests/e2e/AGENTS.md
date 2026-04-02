# E2E Tests — AGENTS.md

> Parent: `../../AGENTS.md`

## Framework

Playwright with `fullyParallel: true`. CI uses `workers: 1`. Dev server auto-starts via `webServer` config in `playwright.config.ts`.

## Test Structure

14+ test files. Each `test.describe.serial` group manages its own auth:
- First test in group: `signup` or `login` to get auth cookie
- Cookie shared across tests in the group via in-memory `cookie` string from `signupAndGetCookie()` helper (not Playwright `storageState`)
- Cleanup in `afterAll` (delete instances, etc.)

## Helpers (`helpers.ts`)

```typescript
uniqueEmail()           // generates unique test email
signup(page, email)     // creates account, returns cookie
signupAndGetCookie()    // signup + extract cookie for API tests
waitForRunning(id)      // polls until instance status = running
cleanupInstance(id)     // stops + deletes instance
```

## Test Files

| File | What it Tests |
|------|---------------|
| `api.spec.ts` | Auth, instance CRUD, credentials API |
| `instance-lifecycle.spec.ts` | Browser-based start/stop/restart flows |
| `channel-api.spec.ts` | Discord, Slack, Signal, Telegram, WhatsApp config |
| `user-credentials.spec.ts` | User vault CRUD |
| `wizard-flow.spec.ts` | Creation wizard with provider/channel selection |
| `chat-streaming.spec.ts` | WebSocket chat, group chat message routing |
| `library-persistence.spec.ts` | Workspace file persistence across restarts |
| `oauth-smoke.spec.ts` | GitHub OAuth device-code flow |
| `github-copilot-flow.spec.ts` | GitHub Copilot OAuth flow |
| `litellm-lifecycle.spec.ts` | LiteLLM billing mode lifecycle |
| `usage-api.spec.ts` | Usage tracking API |
| `milestone-validation.spec.ts` | Phase 1-7 feature validation |
| `production.spec.ts` | Basic production smoke test |
| `production-full.spec.ts` | Comprehensive production E2E |

## Patterns

- `test.setTimeout(120_000)` minimum for operations involving container start (gateway needs ~150s)
- Serial groups for stateful flows (create → start → verify → stop → delete)
- Production tests require env vars: `PROD_URL`, `PROD_EMAIL`, `PROD_PASSWORD` — `test.skip()` if absent
- Some tests conditionally skip based on env (`LITELLM_PROXY_URL`, deployment target)

## Coverage Gaps

No E2E coverage for:
- Admin dashboard UI interactions
- RPC proxy edge cases
- WebSocket event broadcasting (unit-level)
- Health monitor auto-recovery scenario
- Template forking/export UI flows
- Sub-agent spawning via `sessions_spawn`
- Config snapshot restore flows
