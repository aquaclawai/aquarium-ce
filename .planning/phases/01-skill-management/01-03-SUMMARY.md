---
phase: 01-skill-management
plan: "03"
subsystem: api-routes
tags: [skills, extension-credentials, rest-api, lock-conflict, rpc]
dependency_graph:
  requires: ["01-01", "01-02"]
  provides: [skills-rest-api, extension-credentials-route]
  affects: [server-core, frontend-skills-tab]
tech_stack:
  added: []
  patterns: [lock-acquire-release, partial-success-response, scoped-namespace-injection]
key_files:
  created:
    - apps/server/src/routes/extension-credentials.ts
  modified:
    - apps/server/src/routes/skills.ts
    - apps/server/src/server-core.ts
decisions:
  - "Catalog route uses 30s timeout (same as skills.list for toggle ops) — consistent with INFRA-07 non-install operations"
  - "GET /skills returns gatewayBuiltins as empty array when instance not running — avoids 400 for list-only callers"
  - "SecretRef hash truncated to 16 hex chars (64 bits of SHA-256) — sufficient uniqueness for env var IDs"
  - "config.patch failure treated as partial success (credential stored, configPatched: false) — lock still released via finally"
metrics:
  duration_seconds: 160
  completed_date: "2026-04-03"
  tasks_completed: 2
  files_changed: 3
---

# Phase 1 Plan 03: Skill Routes + Extension Credentials API Summary

**One-liner:** Full skills CRUD REST API (list/catalog/install/toggle/uninstall) and extension-scoped credential endpoint with lock acquisition, config.patch RPC injection, and LockConflictError → 409 mapping.

## What Was Built

### Task 1 — `apps/server/src/routes/skills.ts` (replaced)

The previous file had only one route (`POST /:id/skills/install`) implemented as an RPC passthrough via the agent adapter. It was replaced with a full implementation backed by `skill-store.ts` service functions.

Five route handlers:

| Route | Handler | Key behavior |
|-------|---------|--------------|
| `GET /:id/skills` | List | DB managed skills + gateway built-ins separated |
| `GET /:id/skills/catalog` | Catalog | RPC `skills.list` → `SkillCatalogEntry[]` |
| `POST /:id/skills/install` | Install | `installSkill()` service, returns skill + requiredCredentials |
| `PUT /:id/skills/:skillId` | Toggle | `enableSkill()` / `disableSkill()` based on `enabled` boolean |
| `DELETE /:id/skills/:skillId` | Uninstall | `uninstallSkill()` service |

**GET /skills distinction:** Built-ins are `source: 'bundled'` items from the gateway that are NOT tracked in `instance_skills` DB. They are returned in a separate `gatewayBuiltins` array. When the instance is not running, `gatewayBuiltins` is an empty array.

All routes return 409 with `activeOperation` payload on `LockConflictError`.

### Task 2 — `apps/server/src/routes/extension-credentials.ts` (new)

Single `POST /:id/extension-credentials` route implementing:

1. Input validation (provider, credentialType, value, extensionKind, extensionId, targetField)
2. Lock acquisition via `acquireLock(instanceId, 'configure', extensionId, extensionKind)`
3. Credential storage via `addCredential()` with `{ extensionKind, extensionId, targetField }` metadata
4. SecretRef construction: `AQUARIUM_CRED_<16-char-SHA256-hex>` derived from `${kind}_${id}_${field}`
5. Config.patch RPC call with scoped namespace:
   - Skills: `skills.entries.<extensionId>.env.<targetField>`
   - Plugins: `plugins.entries.<extensionId>.config.<targetField>`
6. On patch success + skill kind: promotes DB status from `'installed'` → `'active'`
7. Partial success path: config.patch failure logs warning, returns `{ credentialStored: true, configPatched: false }`
8. Lock always released in finally block

### `apps/server/src/server-core.ts` (modified)

Added import and mount:
- `import extensionCredentialRoutes from './routes/extension-credentials.js';`
- `app.use('/api/instances', extensionCredentialRoutes);` (after skillRoutes mount)

## Deviations from Plan

None — plan executed exactly as written.

## Verification

- `npx tsc --noEmit -p apps/server/tsconfig.json` passes with zero errors
- All 5 skill route handlers present and verified by grep
- `extensionCredentialRoutes` imported and mounted at `/api/instances` in server-core.ts
- `addCredential()` called with extensionKind+extensionId metadata binding
- Config.patch uses scoped namespace path construction for both skill and plugin kinds
- LockConflictError → 409 in all mutation routes

## Commits

| Hash | Message |
|------|---------|
| b7bb256 | feat(01-03): implement full skills REST API with CRUD + catalog endpoints |
| 9244ddf | feat(01-03): create extension-credentials route and mount in server-core |

## Self-Check: PASS
